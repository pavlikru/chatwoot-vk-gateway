import { pino } from 'pino';
import { Writable } from 'node:stream';
import type { VK } from 'vk-io';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { InMemoryDedupStore } from '../src/core/dedup.js';
import { processChatwootWebhook } from '../src/core/outbound.js';
import { processVkUpdate } from '../src/core/inbound.js';
import type { ChatwootWebhookPayload } from '../src/chatwoot/types.js';
import type { ChatwootClient } from '../src/chatwoot/client.js';
import type { VkUpdate } from '../src/vk/types.js';

const config = loadConfig({
  VK_TOKEN: 'test',
  VK_GROUP_ID: '1',
  CHATWOOT_URL: 'https://example.invalid',
  CHATWOOT_ACCOUNT_ID: '1',
  CHATWOOT_TOKEN: 'test',
  CHATWOOT_INBOX_ID: '7',
});
const logger = pino({ level: 'silent' });

function clients() {
  const send = vi.fn().mockResolvedValue(1);
  const messagePhoto = vi.fn().mockResolvedValue({ toString: () => 'photo1_2' });
  const messageDocument = vi.fn().mockResolvedValue({ toString: () => 'doc1_3' });
  const usersGet = vi.fn().mockRejectedValue(new Error('unexpected profile API call'));
  const vk = {
    api: { messages: { send }, users: { get: usersGet } },
    upload: { messagePhoto, messageDocument },
  } as unknown as VK;
  const chatwoot = {
    searchContacts: vi.fn().mockResolvedValue([{ id: 10, identifier: '42' }]),
    listContactConversations: vi.fn().mockResolvedValue([{ id: 20, status: 'open' }]),
    createTextMessage: vi.fn().mockResolvedValue({ id: 30 }),
    createMessageWithAttachments: vi.fn().mockResolvedValue({ id: 30 }),
  };
  const fetchStub = vi
    .fn()
    .mockImplementation(
      async () =>
        new Response('synthetic-file', { headers: { 'content-type': 'application/octet-stream' } }),
    );
  vi.stubGlobal('fetch', fetchStub);
  return { vk, send, messagePhoto, messageDocument, chatwoot, fetchStub, usersGet };
}

afterEach(() => vi.unstubAllGlobals());

const outbound: ChatwootWebhookPayload = {
  event: 'message_created',
  message_type: 'outgoing',
  private: false,
  inbox: { id: 7 },
  content: 'synthetic-text',
  conversation: { id: 20, contact_inbox: { source_id: '42' } },
  attachments: [
    { id: 1, file_type: 'image', data_url: 'https://files.example.invalid/photo.jpg' },
    { id: 2, file_type: 'file', data_url: 'https://files.example.invalid/file.pdf' },
  ],
};

describe('outbound pipeline without real sends', () => {
  it('uploads photo/document attachments and deduplicates the send', async () => {
    const c = clients();
    const deps = { vk: c.vk, config, logger, dedup: new InMemoryDedupStore() };
    await processChatwootWebhook(deps, outbound);
    await processChatwootWebhook(deps, outbound);
    expect(c.fetchStub).toHaveBeenCalledTimes(2);
    expect(c.messagePhoto).toHaveBeenCalledOnce();
    expect(c.messageDocument).toHaveBeenCalledOnce();
    expect(c.send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        peer_id: 42,
        message: 'synthetic-text',
        attachment: 'photo1_2,doc1_3',
      }),
    );
  });

  it.each([
    { message_type: 'incoming' },
    { private: true },
    { inbox: { id: 99 } },
    { event: 'message_updated' },
    { inbox: undefined },
  ])('ignores echo/private/other inbox events before uploads or sends: %j', async (patch) => {
    const c = clients();
    await processChatwootWebhook(
      { vk: c.vk, config, logger, dedup: new InMemoryDedupStore() },
      { ...outbound, ...patch },
    );
    expect(c.send).not.toHaveBeenCalled();
    expect(c.fetchStub).not.toHaveBeenCalled();
    expect(c.messagePhoto).not.toHaveBeenCalled();
    expect(c.messageDocument).not.toHaveBeenCalled();
  });
});

it('relays inbound attachments once and ignores a VK reply event', async () => {
  const c = clients();
  const deps = {
    vk: c.vk,
    chatwoot: c.chatwoot as unknown as ChatwootClient,
    config,
    logger,
    dedup: new InMemoryDedupStore(),
  };
  const update: VkUpdate = {
    type: 'message_new',
    event_id: 'synthetic-event',
    object: {
      message: {
        id: 1,
        peer_id: 42,
        from_id: 42,
        text: 'synthetic-text',
        attachments: [
          {
            type: 'doc',
            doc: { url: 'https://files.example.invalid/file.pdf', title: 'file.pdf' },
          },
        ],
      },
    },
  };
  await processVkUpdate(deps, { ...update, type: 'message_reply' });
  expect(c.chatwoot.searchContacts).not.toHaveBeenCalled();
  await processVkUpdate(deps, update);
  await processVkUpdate(deps, update);
  expect(c.chatwoot.searchContacts).toHaveBeenCalledOnce();
  expect(c.chatwoot.createMessageWithAttachments).toHaveBeenCalledExactlyOnceWith(
    20,
    'synthetic-text',
    [expect.objectContaining({ filename: 'file.pdf', bytes: Buffer.from('synthetic-file') })],
  );
  expect(c.chatwoot.createTextMessage).not.toHaveBeenCalled();
  expect(c.usersGet).not.toHaveBeenCalled();
});

it('keeps downstream attachment error bodies/URLs out of application logs', async () => {
  const c = clients();
  const logs: string[] = [];
  const captured = pino(
    new Writable({
      write(chunk, _encoding, done) {
        logs.push(String(chunk));
        done();
      },
    }),
  );
  const marker = 'SYNTHETIC_ATTACHMENT_SECRET_3a21';
  c.fetchStub.mockRejectedValue(new Error(marker));
  const dedup = new InMemoryDedupStore();
  await processChatwootWebhook(
    { vk: c.vk, config, logger: captured, dedup },
    {
      ...outbound,
      attachments: [
        { id: 5, file_type: 'image', data_url: `https://files.example.invalid/${marker}` },
      ],
    },
  );
  await processVkUpdate(
    {
      vk: c.vk,
      chatwoot: c.chatwoot as unknown as ChatwootClient,
      config,
      logger: captured,
      dedup,
    },
    {
      type: 'message_new',
      event_id: 'synthetic-download-failure',
      object: {
        message: {
          id: 2,
          peer_id: 42,
          from_id: 42,
          text: '',
          attachments: [{ type: 'doc', doc: { url: `https://files.example.invalid/${marker}` } }],
        },
      },
    },
  );
  expect(logs.join('')).toContain('failed to upload attachment to VK');
  expect(logs.join('')).toContain('failed to download VK attachment');
  expect(logs.join('')).not.toContain(marker);
  // Keep the established best-effort relay behavior after an attachment failure.
  expect(c.send).toHaveBeenCalledOnce();
  expect(c.chatwoot.createTextMessage).toHaveBeenCalledWith(
    20,
    `https://files.example.invalid/${marker}`,
  );
});
