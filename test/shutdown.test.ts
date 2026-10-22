import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createHttpServer, type ServerResponse } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it.each(['idle', 'pending', 'failed-and-pending', 'timeout'])(
  'stops an isolated real gateway safely: %s',
  async (mode) => {
    const directory = await mkdtemp(join(tmpdir(), 'chatwoot-vk-shutdown-'));
    let pendingReply: ServerResponse | undefined;
    let started!: () => void;
    const deliveryStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const messageBodies: string[] = [];
    const stub = createHttpServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url?.includes('/contacts/search?')) {
        res.end(JSON.stringify({ payload: [{ id: 1, identifier: '4242' }] }));
      } else if (req.url?.endsWith('/contacts/1/conversations')) {
        res.end(JSON.stringify({ payload: [{ id: 1, status: 'open', inbox_id: 7 }] }));
      } else if (req.method === 'POST' && req.url?.endsWith('/conversations/1/messages')) {
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk: string) => {
          body += chunk;
        });
        req.on('end', () => {
          messageBodies.push(body);
          if (body.includes('fail-this-delivery')) {
            res.statusCode = 500;
            res.end('SYNTHETIC_DOWNSTREAM_PRIVATE_BODY');
          } else {
            pendingReply = res;
            started();
          }
        });
      } else {
        res.statusCode = 404;
        res.end('{}');
      }
    });
    stub.listen(0, '127.0.0.1');
    await once(stub, 'listening');
    const stubAddress = stub.address();
    if (!stubAddress || typeof stubAddress === 'string') throw new Error('missing stub port');
    const reservation = createServer();
    reservation.listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const address = reservation.address();
    if (!address || typeof address === 'string') throw new Error('missing test port');
    await new Promise<void>((resolve, reject) =>
      reservation.close((error) => (error ? reject(error) : resolve())),
    );

    // Only loopback stubs, an empty cwd and synthetic env; no live dotenv/Redis/VK requests.
    const child = spawn(
      process.execPath,
      [
        '--import',
        import.meta.resolve('tsx'),
        fileURLToPath(new URL('../src/index.ts', import.meta.url)),
      ],
      {
        cwd: directory,
        env: {
          NODE_ENV: 'test',
          PORT: String(address.port),
          LOG_LEVEL: 'info',
          VK_MODE: 'callback',
          SHUTDOWN_TIMEOUT_MS: mode === 'timeout' ? '200' : '3000',
          VK_TOKEN: 'synthetic-token',
          VK_CONFIRMATION: 'synthetic-confirmation',
          VK_CALLBACK_SECRET: 'synthetic-secret',
          PUBLIC_URL: 'https://gateway.example.invalid',
          CHATWOOT_URL: `http://127.0.0.1:${stubAddress.port}`,
          CHATWOOT_ACCOUNT_ID: '1',
          CHATWOOT_INBOX_ID: '7',
          CHATWOOT_TOKEN: 'synthetic-token',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const exited = once(child, 'close');
    let logs = '';
    let errors = '';
    child.stdout.on('data', (chunk) => {
      logs += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      errors += String(chunk);
    });
    const waitForLog = (marker: string): Promise<void> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error(`missing log: ${marker}`));
        }, 3000);
        const cleanup = (): void => {
          clearTimeout(timer);
          child.stdout.off('data', check);
          child.off('exit', earlyExit);
        };
        const check = (): void => {
          if (logs.includes(marker)) {
            cleanup();
            resolve();
          }
        };
        const earlyExit = (): void => {
          cleanup();
          reject(new Error('gateway exited before expected log'));
        };
        child.stdout.on('data', check);
        child.once('exit', earlyExit);
        check();
      });
    const post = (payload: unknown) =>
      fetch(`http://127.0.0.1:${address.port}/vk/callback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(2000),
      });
    const update = (id: number, text: string) => ({
      type: 'message_new',
      event_id: `synthetic-${id}`,
      secret: 'synthetic-secret',
      object: { message: { id, peer_id: 4242, from_id: 4242, text } },
    });
    try {
      await waitForLog('gateway listening');
      const confirmation = await post({ type: 'confirmation', secret: 'synthetic-secret' });
      expect(await confirmation.text()).toBe('synthetic-confirmation');
      if (mode !== 'idle') {
        if (mode === 'failed-and-pending')
          expect((await post(update(1, 'fail-this-delivery'))).status).toBe(200);
        const response = await post(update(2, 'slow-delivery'));
        expect(response.status).toBe(200);
        expect(await response.text()).toBe('ok');
        await deliveryStarted;
      }
      child.kill('SIGTERM');
      if (mode !== 'idle') {
        await waitForLog('draining background deliveries');
        expect(child.exitCode).toBeNull();
        child.kill('SIGINT');
        if (mode !== 'timeout') {
          await post(update(3, 'must-not-be-accepted')).then(
            (response) => expect(response.status).toBe(503),
            () => {},
          );
          expect(messageBodies.some((body) => body.includes('must-not-be-accepted'))).toBe(false);
          pendingReply?.end(JSON.stringify({ id: 123 }));
        }
      }
      expect(await exited).toEqual([mode === 'timeout' ? 1 : 0, null]);
      expect(logs.match(/"msg":"shutting down"/g)).toHaveLength(1);
      if (mode === 'timeout') {
        expect(logs).toContain('shutdown timed out');
        expect(logs).toContain('"pendingTasks":1');
        expect(logs).not.toContain('shutdown complete');
      } else {
        expect(logs).toContain('shutdown complete');
        if (mode !== 'idle') expect(logs).toContain('relayed VK -> Chatwoot');
        if (mode === 'failed-and-pending') expect(logs).toContain('callback handler failed');
      }
      expect(logs).not.toContain('SYNTHETIC_DOWNSTREAM_PRIVATE_BODY');
      expect(logs).not.toContain('synthetic-secret');
      expect(errors).toBe('');
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited;
      pendingReply?.destroy();
      await new Promise<void>((resolve, reject) => {
        stub.close((error) => (error ? reject(error) : resolve()));
        stub.closeAllConnections();
      });
      await rm(directory, { recursive: true, force: true });
    }
  },
);
