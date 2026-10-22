import { pino } from 'pino';
import type { VK } from 'vk-io';
import { afterEach, expect, it, vi } from 'vitest';
import { startLongPoll } from '../src/vk/updates.js';
import type { VkUpdate } from '../src/vk/types.js';

const server = { key: 'synthetic-key', server: 'https://poll.example.invalid', ts: '1' };
const logger = pino({ level: 'silent' });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('stops after an in-flight server lookup without starting a new poll', async () => {
  let finish!: (value: typeof server) => void;
  const lookup = new Promise<typeof server>((resolve) => {
    finish = resolve;
  });
  const getLongPollServer = vi.fn().mockReturnValue(lookup);
  const vk = { api: { groups: { getLongPollServer } } } as unknown as VK;
  const fetchStub = vi.fn();
  vi.stubGlobal('fetch', fetchStub);
  const abort = new AbortController();
  const loop = startLongPoll(vk, 1, vi.fn(), logger, abort.signal);
  abort.abort();
  finish(server);
  await loop;
  expect(getLongPollServer).toHaveBeenCalledOnce();
  expect(fetchStub).not.toHaveBeenCalled();
});

it('aborts retry backoff promptly during shutdown', async () => {
  let logged!: () => void;
  const failed = new Promise<void>((resolve) => {
    logged = resolve;
  });
  vi.spyOn(logger, 'error').mockImplementation(() => {
    logged();
  });
  const getLongPollServer = vi.fn().mockRejectedValue(new Error('synthetic failure'));
  const vk = { api: { groups: { getLongPollServer } } } as unknown as VK;
  const abort = new AbortController();
  const loop = startLongPoll(vk, 1, vi.fn(), logger, abort.signal);
  await failed;
  abort.abort();
  await loop;
  expect(getLongPollServer).toHaveBeenCalledOnce();
}, 1000);

it('dispatches the complete received batch before the producer stops', async () => {
  const updates: VkUpdate[] = [
    { type: 'message_new', event_id: '1', object: {} },
    { type: 'message_new', event_id: '2', object: {} },
  ];
  const fetchStub = vi.fn().mockResolvedValue({ json: async () => ({ ts: '2', updates }) });
  vi.stubGlobal('fetch', fetchStub);
  const vk = {
    api: { groups: { getLongPollServer: vi.fn().mockResolvedValue(server) } },
  } as unknown as VK;
  const abort = new AbortController();
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const onUpdate = vi.fn(() => {
    abort.abort();
    return pending;
  });
  try {
    await startLongPoll(vk, 1, onUpdate, logger, abort.signal);
    expect(onUpdate.mock.calls).toHaveLength(2);
    expect(onUpdate).toHaveBeenNthCalledWith(1, updates[0]);
    expect(onUpdate).toHaveBeenNthCalledWith(2, updates[1]);
    expect(fetchStub).toHaveBeenCalledOnce();
  } finally {
    finish();
    await pending;
  }
});
