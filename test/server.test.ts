import { createHmac } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { pino } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { buildCallbackHandler } from '../src/vk/updates.js';

const marker = 'SYNTHETIC_PRIVATE_BODY_9d43';
const secret = 'SYNTHETIC_HMAC_SECRET_82c1';
const timestamp = '1700000000';
const endpoints = ['/chatwoot/webhook', '/vk/callback'];
const apps: ReturnType<typeof buildServer>[] = [];

function fixture(signed = false) {
  const logs: string[] = [];
  const logger = pino(
    new Writable({
      write(chunk, _encoding, done) {
        logs.push(String(chunk));
        done();
      },
    }),
  );
  const config = loadConfig({
    VK_TOKEN: 'synthetic-vk-token',
    VK_MODE: 'callback',
    VK_CONFIRMATION: 'synthetic-confirmation',
    VK_CALLBACK_SECRET: 'synthetic-vk-secret',
    PUBLIC_URL: 'https://gateway.example.invalid',
    CHATWOOT_URL: 'https://chatwoot.example.invalid',
    CHATWOOT_ACCOUNT_ID: '1',
    CHATWOOT_TOKEN: 'synthetic-chatwoot-token',
    CHATWOOT_INBOX_ID: '7',
    ...(signed ? { CHATWOOT_WEBHOOK_SECRET: secret } : {}),
  });
  const onChatwootWebhook = vi
    .fn<Parameters<typeof buildServer>[0]['onChatwootWebhook']>()
    .mockResolvedValue();
  const onUpdate = vi.fn<Parameters<typeof buildCallbackHandler>[1]>().mockResolvedValue();
  const onVkCallback = vi.fn(buildCallbackHandler(config, onUpdate, logger));
  const app = buildServer({ config, logger, onChatwootWebhook, onVkCallback });
  apps.push(app);
  return { app, logs, onChatwootWebhook, onVkCallback, onUpdate };
}

function signature(body: string | Buffer) {
  return (
    'sha256=' +
    createHmac('sha256', secret)
      .update(timestamp + '.')
      .update(body)
      .digest('hex')
  );
}

function expectNoCalls(f: ReturnType<typeof fixture>) {
  expect(f.onChatwootWebhook).not.toHaveBeenCalled();
  expect(f.onVkCallback).not.toHaveBeenCalled();
  expect(f.onUpdate).not.toHaveBeenCalled();
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe.each(endpoints)('%s request boundaries', (url) => {
  it.each([`{"private":"${marker}",`, `{"token":"${marker}" BROKEN}`])(
    'rejects malformed JSON before handlers',
    async (payload) => {
      const f = fixture(true);
      const res = await f.app.inject({
        method: 'POST',
        url,
        headers: { 'content-type': 'application/json' },
        payload,
      });
      expect(res.statusCode).toBe(400);
      expectNoCalls(f);
      expect(res.body + f.logs.join('')).not.toContain(marker);
      expect(res.body + f.logs.join('')).not.toContain('SyntaxError');
    },
  );

  it.each(['', ' ', 'null', '[]', '[{}]', '42', 'true', `"${marker}"`])(
    'rejects a non-object body: %s',
    async (payload) => {
      const f = fixture();
      const res = await f.app.inject({
        method: 'POST',
        url,
        headers: { 'content-type': 'application/json' },
        payload,
      });
      expect(res.statusCode).toBe(400);
      expectNoCalls(f);
      expect(res.body + f.logs.join('')).not.toContain(marker);
    },
  );

  it('rejects a missing body', async () => {
    const f = fixture();
    const res = await f.app.inject({ method: 'POST', url });
    expect(res.statusCode).toBe(400);
    expectNoCalls(f);
  });

  it.each(['text/plain', 'application/xml', 'application/octet-stream'])(
    'rejects unsupported %s',
    async (contentType) => {
      const f = fixture();
      const res = await f.app.inject({
        method: 'POST',
        url,
        headers: { 'content-type': contentType },
        payload: marker,
      });
      expect(res.statusCode).toBe(415);
      expectNoCalls(f);
      expect(res.body + f.logs.join('')).not.toContain(marker);
    },
  );

  it('preserves the 25 MiB limit with a bounded stream', async () => {
    const f = fixture();
    const chunk = Buffer.alloc(64 * 1024, ' ');
    const payload = Readable.from(
      (function* () {
        for (let i = 0; i < 401; i++) yield chunk;
      })(),
    );
    const res = await f.app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/json' },
      payload,
    });
    expect(res.statusCode).toBe(413);
    expectNoCalls(f);
  });
});

describe('Chatwoot authentication and acknowledgement', () => {
  const raw = Buffer.from(
    ' { "event" : "message_created", "content" : "Привет 😀 é", "future_field": true }\r\n',
  );
  it('verifies exact whitespace, UTF-8 and trailing newline bytes; allows unknown fields', async () => {
    const f = fixture(true);
    const res = await f.app.inject({
      method: 'POST',
      url: endpoints[0],
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-chatwoot-timestamp': timestamp,
        'x-chatwoot-signature': signature(raw),
      },
      payload: raw,
    });
    expect(res.statusCode).toBe(200);
    expect(f.onChatwootWebhook).toHaveBeenCalledWith(JSON.parse(raw.toString()));
  });

  it.each([
    { body: Buffer.concat([raw, Buffer.from(' ')]), ts: timestamp, sig: signature(raw) },
    { body: Buffer.from(raw.toString().normalize('NFC')), ts: timestamp, sig: signature(raw) },
    { body: raw, ts: undefined, sig: signature(raw) },
    { body: raw, ts: timestamp, sig: undefined },
    { body: raw, ts: timestamp, sig: 'sha256=' + '0'.repeat(64) },
    { body: raw, ts: timestamp, sig: signature(raw).slice(7) },
    { body: raw, ts: timestamp, sig: 'sha256=zz' },
  ])(
    'rejects changed bytes or invalid headers without logging sensitive values',
    async ({ body, ts, sig }) => {
      const f = fixture(true);
      const res = await f.app.inject({
        method: 'POST',
        url: endpoints[0],
        headers: {
          'content-type': 'application/json',
          ...(ts ? { 'x-chatwoot-timestamp': ts } : {}),
          ...(sig ? { 'x-chatwoot-signature': sig } : {}),
        },
        payload: body,
      });
      expect(res.statusCode).toBe(401);
      expectNoCalls(f);
      expect(f.logs.join('')).toContain('invalid signature');
      for (const value of [secret, signature(raw), raw.toString()])
        expect(res.body + f.logs.join('')).not.toContain(value);
    },
  );

  it('acknowledges before processing finishes and close does not drain background work', async () => {
    const f = fixture();
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    f.onChatwootWebhook.mockReturnValue(pending);
    try {
      const res = await f.app.inject({
        method: 'POST',
        url: endpoints[0],
        payload: { event: 'message_created' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
      await f.app.close();
      expect(f.onChatwootWebhook).toHaveBeenCalledOnce();
    } finally {
      finish();
      await pending;
    }
  });
});

describe('VK callback contract', () => {
  it.each([undefined, 'wrong-secret'])(
    'rejects a missing/wrong callback secret',
    async (provided) => {
      const f = fixture();
      const res = await f.app.inject({
        method: 'POST',
        url: endpoints[1],
        payload: { type: 'message_new', object: {}, secret: provided },
      });
      expect(res.statusCode).toBe(403);
      expect(f.onUpdate).not.toHaveBeenCalled();
      expect(res.body + f.logs.join('')).not.toContain('wrong-secret');
    },
  );

  it('returns confirmation without processing', async () => {
    const f = fixture();
    const res = await f.app.inject({
      method: 'POST',
      url: endpoints[1],
      payload: { type: 'confirmation', secret: 'synthetic-vk-secret' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('synthetic-confirmation');
    expect(f.onUpdate).not.toHaveBeenCalled();
  });

  it('acknowledges asynchronously; close does not drain callback work', async () => {
    const f = fixture();
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    f.onUpdate.mockReturnValue(pending);
    try {
      const payload = {
        type: 'message_new',
        object: {},
        secret: 'synthetic-vk-secret',
        future_field: true,
      };
      const res = await f.app.inject({ method: 'POST', url: endpoints[1], payload });
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe('ok');
      expect(f.onUpdate).toHaveBeenCalledWith(payload);
      await f.app.close();
    } finally {
      finish();
      await pending;
    }
  });
});

it('preserves health and keeps internal errors as sanitized 500 responses', async () => {
  const f = fixture();
  expect((await f.app.inject({ method: 'GET', url: '/health' })).json()).toEqual({ status: 'ok' });
  f.onVkCallback.mockRejectedValue(new Error(marker));
  const res = await f.app.inject({
    method: 'POST',
    url: endpoints[1],
    payload: { type: 'confirmation' },
  });
  expect(res.statusCode).toBe(500);
  expect(res.body + f.logs.join('')).not.toContain(marker);
  expect(f.logs.join('')).toContain('500');
});

it('does not expose a callback endpoint in longpoll mode', async () => {
  const f = fixture();
  const config = loadConfig({
    VK_TOKEN: 'test',
    VK_GROUP_ID: '1',
    CHATWOOT_URL: 'https://example.invalid',
    CHATWOOT_ACCOUNT_ID: '1',
    CHATWOOT_TOKEN: 'test',
    CHATWOOT_INBOX_ID: '7',
  });
  const app = buildServer({
    config,
    logger: pino({ level: 'silent' }),
    onChatwootWebhook: f.onChatwootWebhook,
    onVkCallback: f.onVkCallback,
  });
  apps.push(app);
  expect((await app.inject({ method: 'POST', url: '/vk/callback', payload: {} })).statusCode).toBe(
    404,
  );
  expectNoCalls(f);
});

it.each(endpoints)('logs asynchronous %s failures without request data', async (url) => {
  const f = fixture();
  if (url === '/chatwoot/webhook') f.onChatwootWebhook.mockRejectedValue(new Error(marker));
  else f.onUpdate.mockRejectedValue(new Error(marker));
  const res = await f.app.inject({
    method: 'POST',
    url,
    payload: { type: 'message_new', object: {}, secret: 'synthetic-vk-secret', content: marker },
  });
  expect(res.statusCode).toBe(200);
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(f.logs.join('')).toContain('failed');
  expect(res.body + f.logs.join('')).not.toContain(marker);
  expect(f.logs.join('')).not.toContain('synthetic-vk-secret');
});
