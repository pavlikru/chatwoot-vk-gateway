// Feed via stdin to node in the candidate; only loopback stubs and synthetic env.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout, clearTimeout } from 'node:timers';

const deadline = setTimeout(() => {
  process.stderr.write('shutdown verification timed out\n');
  process.exit(1);
}, 15000);
const results = [];
for (const mode of ['complete', 'timeout']) {
  const directory = await mkdtemp(join(tmpdir(), 'vk-drain-check-'));
  let pending;
  let deliveryStarted;
  const started = new Promise((resolve) => {
    deliveryStarted = resolve;
  });
  const stub = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url.includes('/contacts/search?'))
      res.end(JSON.stringify({ payload: [{ id: 1, identifier: '4242' }] }));
    else if (req.url.endsWith('/contacts/1/conversations'))
      res.end(JSON.stringify({ payload: [{ id: 1, status: 'open', inbox_id: 7 }] }));
    else if (req.method === 'POST' && req.url.endsWith('/conversations/1/messages')) {
      pending = res;
      deliveryStarted();
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  stub.listen(0, '127.0.0.1');
  await once(stub, 'listening');
  const stubPort = stub.address().port;
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, ['/app/dist/index.js'], {
    cwd: directory,
    env: {
      NODE_ENV: 'test',
      PORT: String(port),
      VK_MODE: 'callback',
      VK_TOKEN: 'synthetic-token',
      VK_CONFIRMATION: 'synthetic-confirmation',
      VK_CALLBACK_SECRET: 'synthetic-secret',
      PUBLIC_URL: 'https://gateway.example.invalid',
      CHATWOOT_URL: `http://127.0.0.1:${stubPort}`,
      CHATWOOT_ACCOUNT_ID: '1',
      CHATWOOT_INBOX_ID: '7',
      CHATWOOT_TOKEN: 'synthetic-token',
      SHUTDOWN_TIMEOUT_MS: mode === 'timeout' ? '200' : '5000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  let logs = '';
  let errors = '';
  child.stdout.on('data', (data) => {
    logs += String(data);
  });
  child.stderr.on('data', (data) => {
    errors += String(data);
  });
  const waitForLog = (marker) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('missing log: ' + marker));
      }, 10000);
      const cleanup = () => {
        clearTimeout(timer);
        child.stdout.off('data', check);
        child.off('exit', earlyExit);
      };
      const check = () => {
        if (logs.includes(marker)) {
          cleanup();
          resolve();
        }
      };
      const earlyExit = () => {
        cleanup();
        reject(new Error('unexpected gateway exit'));
      };
      child.stdout.on('data', check);
      child.once('exit', earlyExit);
      check();
    });
  try {
    await waitForLog('gateway listening');
    const response = await globalThis.fetch(`http://127.0.0.1:${port}/vk/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'message_new',
        event_id: mode,
        secret: 'synthetic-secret',
        object: {
          message: { id: 1, peer_id: 4242, from_id: 4242, text: 'synthetic-pending-delivery' },
        },
      }),
      signal: globalThis.AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'ok');
    await started;
    child.kill('SIGTERM');
    await waitForLog('draining background deliveries');
    assert.equal(child.exitCode, null);
    child.kill('SIGINT');
    if (mode === 'complete') pending.end(JSON.stringify({ id: 1 }));
    assert.deepEqual(await exited, [mode === 'timeout' ? 1 : 0, null]);
    assert.equal((logs.match(/"msg":"shutting down"/g) || []).length, 1);
    if (mode === 'complete') {
      assert.ok(logs.includes('relayed VK -> Chatwoot'));
      assert.ok(logs.includes('shutdown complete'));
    } else {
      assert.ok(logs.includes('shutdown timed out'));
      assert.ok(logs.includes('"pendingTasks":1'));
      assert.ok(!logs.includes('shutdown complete'));
    }
    assert.equal(errors, '');
    assert.ok(!logs.includes('synthetic-secret'));
    results.push({ mode, passed: true, exitCode: child.exitCode });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
    pending?.destroy();
    await new Promise((resolve, reject) => {
      stub.close((error) => (error ? reject(error) : resolve()));
      stub.closeAllConnections();
    });
    await rm(directory, { recursive: true, force: true });
  }
}
const memory = {};
for (const name of [
  'memory.current',
  'memory.peak',
  'memory.max',
  'memory.events',
  'memory.swap.max',
  'cpu.max',
])
  memory[name] = (await readFile('/sys/fs/cgroup/' + name, 'utf8')).trim();
assert.equal(memory['memory.max'], '134217728');
assert.equal(memory['cpu.max'], '50000 100000');
assert.match(memory['memory.events'], /oom_kill 0/);
clearTimeout(deadline);
process.stdout.write(
  JSON.stringify({ passed: true, node: process.version, results, memory }) + '\n',
);
