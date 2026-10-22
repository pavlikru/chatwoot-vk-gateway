// Run via stdin in the candidate image, with the synthetic fixture mounted read-only.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { Readable, Writable } from 'node:stream';
import { pino } from 'pino';
import { buildServer } from './dist/server.js';
import { loadConfig } from './dist/config.js';
import { buildCallbackHandler } from './dist/vk/updates.js';

const fixture = JSON.parse(readFileSync('/tmp/actual-trigger-fixture.json', 'utf8'));
assert.equal(fixture.synthetic, true);
const marker = 'CANDIDATE_PRIVATE_BODY_MARKER_20261022';
const logs = [];
const logger = pino(
  new Writable({
    write(chunk, _encoding, done) {
      logs.push(String(chunk));
      done();
    },
  }),
);
const config = loadConfig({
  NODE_ENV: 'test',
  VK_MODE: 'callback',
  VK_TOKEN: 'synthetic-vk-token',
  VK_CALLBACK_SECRET: 'synthetic-vk-secret',
  VK_CONFIRMATION: 'synthetic-confirmation',
  PUBLIC_URL: 'https://gateway.example.invalid',
  CHATWOOT_URL: 'https://chatwoot.example.invalid',
  CHATWOOT_TOKEN: 'synthetic-chatwoot-token',
  CHATWOOT_ACCOUNT_ID: '4',
  CHATWOOT_INBOX_ID: '12',
  CHATWOOT_WEBHOOK_SECRET: fixture.secret,
});
let cwCalls = 0;
let vkCalls = 0;
let callbackCalls = 0;
let fail = false;
const callback = buildCallbackHandler(
  config,
  async () => {
    vkCalls++;
  },
  logger,
);
const app = buildServer({
  config,
  logger,
  onChatwootWebhook: async () => {
    cwCalls++;
  },
  onVkCallback: async (body) => {
    callbackCalls++;
    if (fail) throw new Error(marker);
    return callback(body);
  },
});
const results = [];
async function reject(url, payload, status, headers = { 'content-type': 'application/json' }) {
  const before = [cwCalls, vkCalls];
  const response = await app.inject({ method: 'POST', url, payload, headers });
  assert.equal(response.statusCode, status, `${url} boundary`);
  assert.deepEqual([cwCalls, vkCalls], before, 'rejection called business handler');
  assert.ok(!response.body.includes(marker));
  results.push({ url, status });
}
try {
  assert.equal((await app.inject({ url: '/health' })).statusCode, 200);
  for (const url of ['/vk/callback', '/chatwoot/webhook']) {
    const before = callbackCalls;
    for (const body of [`{"private":"${marker}",`, '', 'null', '[]', '42', 'true', '"scalar"']) {
      await reject(url, body, 400);
    }
    await reject(url, marker, 415, { 'content-type': 'text/plain' });
    await reject(url, marker, 415, { 'content-type': 'application/xml' });
    const chunk = Buffer.alloc(64 * 1024, ' ');
    const stream = Readable.from(
      (function* () {
        for (let i = 0; i < 401; i++) yield chunk;
      })(),
    );
    await reject(url, stream, 413);
    assert.equal(callbackCalls, before, 'parser rejection called VK callback');
  }
  await reject('/vk/callback', JSON.stringify({ type: 'confirmation', secret: 'wrong' }), 403);
  const confirmation = await app.inject({
    method: 'POST',
    url: '/vk/callback',
    payload: { type: 'confirmation', secret: config.vkCallbackSecret },
  });
  assert.equal(confirmation.statusCode, 200);
  assert.equal(confirmation.body, 'synthetic-confirmation');
  assert.equal(vkCalls, 0);
  const ack = await app.inject({
    method: 'POST',
    url: '/vk/callback',
    payload: { type: 'message_new', object: {}, secret: config.vkCallbackSecret },
  });
  assert.equal(ack.statusCode, 200);
  assert.equal(ack.body, 'ok');
  assert.equal(vkCalls, 1);

  const signed = await app.inject({
    method: 'POST',
    url: '/chatwoot/webhook',
    headers: fixture.headers,
    payload: Buffer.from(fixture.raw_body),
  });
  assert.equal(signed.statusCode, 200);
  assert.equal(cwCalls, 1);
  await reject('/chatwoot/webhook', fixture.raw_body + ' ', 401, fixture.headers);
  await reject('/chatwoot/webhook', fixture.raw_body, 401);
  const noTimestamp = { ...fixture.headers };
  delete noTimestamp['X-Chatwoot-Timestamp'];
  await reject('/chatwoot/webhook', fixture.raw_body, 401, noTimestamp);
  const noSignature = { ...fixture.headers };
  delete noSignature['X-Chatwoot-Signature'];
  await reject('/chatwoot/webhook', fixture.raw_body, 401, noSignature);
  fail = true;
  await reject('/vk/callback', '{}', 500);
  await app.close();
  for (const value of [
    marker,
    fixture.raw_body,
    fixture.secret,
    fixture.headers['X-Chatwoot-Signature'],
    config.vkCallbackSecret,
  ]) {
    assert.ok(!logs.join('').includes(value), 'sensitive marker in logs');
  }
  const forbidden = ['.env', '.env.production', 'src', 'test', 'docs', '.git', 'scripts'];
  for (const path of forbidden)
    assert.equal(existsSync(path), false, `unexpected image path ${path}`);
  assert.deepEqual(readdirSync('.').sort(), [
    'dist',
    'node_modules',
    'package-lock.json',
    'package.json',
  ]);
  assert.equal(existsSync('node_modules/vitest'), false);
  assert.equal(existsSync('node_modules/typescript'), false);
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const installed = {};
  for (const name of [...Object.keys(pkg.dependencies), ...Object.keys(pkg.optionalDependencies)]) {
    const actual = JSON.parse(readFileSync(`node_modules/${name}/package.json`, 'utf8')).version;
    assert.equal(actual, lock.packages[`node_modules/${name}`].version);
    installed[name] = actual;
  }
  const sha256 = {};
  function hashFiles(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) hashFiles(path);
      else sha256[path] = createHash('sha256').update(readFileSync(path)).digest('hex');
    }
  }
  hashFiles('dist');
  sha256['package-lock.json'] = createHash('sha256')
    .update(readFileSync('package-lock.json'))
    .digest('hex');
  const memory = {};
  for (const name of [
    'memory.current',
    'memory.peak',
    'memory.max',
    'memory.events',
    'memory.swap.max',
    'cpu.max',
  ]) {
    memory[name] = readFileSync(`/sys/fs/cgroup/${name}`, 'utf8').trim();
  }
  assert.equal(memory['memory.max'], '134217728');
  assert.equal(memory['memory.swap.max'], '0');
  assert.equal(memory['cpu.max'], '50000 100000');
  assert.match(memory['memory.events'], /oom_kill 0/);
  process.stdout.write(
    JSON.stringify({
      passed: true,
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      cases: results.length + 4,
      businessCalls: { chatwoot: cwCalls, vk: vkCalls },
      memory,
      installed,
      sha256,
    }) + '\n',
  );
} finally {
  await app.close();
}
