import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('starts an isolated callback process and exits cleanly on SIGTERM', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chatwoot-vk-shutdown-'));
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('missing test port');
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );

  // Empty cwd + explicit env prevent dotenv or Redis from reaching live services.
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
        VK_TOKEN: 'synthetic-token',
        VK_CONFIRMATION: 'synthetic-confirmation',
        VK_CALLBACK_SECRET: 'synthetic-secret',
        PUBLIC_URL: 'https://gateway.example.invalid',
        CHATWOOT_URL: 'https://chatwoot.example.invalid',
        CHATWOOT_ACCOUNT_ID: '1',
        CHATWOOT_INBOX_ID: '7',
        CHATWOOT_TOKEN: 'synthetic-token',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const exited = once(child, 'exit');
  let logs = '';
  let errors = '';
  child.stderr.on('data', (chunk) => {
    errors += String(chunk);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      child.stdout.on('data', (chunk) => {
        logs += String(chunk);
        if (logs.includes('gateway listening')) resolve();
      });
      child.once('error', reject);
      child.once('exit', () => reject(new Error('gateway exited before listening')));
    });
    const response = await fetch(`http://127.0.0.1:${address.port}/vk/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'confirmation', secret: 'synthetic-secret' }),
      signal: AbortSignal.timeout(2000),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('synthetic-confirmation');
    child.kill('SIGTERM');
    expect(await exited).toEqual([0, null]);
    expect(logs).toContain('shutting down');
    expect(errors).toBe('');
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
});
