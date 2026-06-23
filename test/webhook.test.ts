import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig, type Config } from '../src/config.js';
import { extractPeerId, shouldForwardOutbound, verifySignature } from '../src/chatwoot/webhook.js';
import type { ChatwootWebhookPayload } from '../src/chatwoot/types.js';

const config: Config = loadConfig({
  VK_TOKEN: 'vk',
  VK_GROUP_ID: '1',
  CHATWOOT_URL: 'https://c.example.com',
  CHATWOOT_ACCOUNT_ID: '1',
  CHATWOOT_TOKEN: 't',
  CHATWOOT_INBOX_ID: '7',
} as NodeJS.ProcessEnv);

describe('verifySignature', () => {
  const secret = 'shh';
  const body = '{"event":"message_created"}';
  const ts = '1700000000';

  it('accepts a correctly signed payload', () => {
    const sig = 'sha256=' + createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    expect(verifySignature(body, ts, sig, secret)).toBe(true);
  });

  it('rejects a tampered payload', () => {
    const sig = 'sha256=' + createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    expect(verifySignature('{"event":"x"}', ts, sig, secret)).toBe(false);
  });

  it('rejects a missing signature', () => {
    expect(verifySignature(body, ts, undefined, secret)).toBe(false);
  });
});

describe('shouldForwardOutbound', () => {
  it('forwards agent outgoing messages on the configured inbox', () => {
    const payload: ChatwootWebhookPayload = {
      event: 'message_created',
      message_type: 'outgoing',
      private: false,
      inbox: { id: 7 },
    };
    expect(shouldForwardOutbound(payload, config)).toBe(true);
  });

  it('ignores incoming, private and other-inbox messages', () => {
    expect(shouldForwardOutbound({ message_type: 'incoming', inbox: { id: 7 } }, config)).toBe(
      false,
    );
    expect(
      shouldForwardOutbound({ message_type: 'outgoing', private: true, inbox: { id: 7 } }, config),
    ).toBe(false);
    expect(shouldForwardOutbound({ message_type: 'outgoing', inbox: { id: 99 } }, config)).toBe(
      false,
    );
  });
});

describe('extractPeerId', () => {
  it('reads the peer id from contact_inbox.source_id', () => {
    const payload: ChatwootWebhookPayload = {
      conversation: { contact_inbox: { source_id: '4242' } },
    };
    expect(extractPeerId(payload)).toBe(4242);
  });

  it('returns undefined when no source id is present', () => {
    expect(extractPeerId({})).toBeUndefined();
  });
});
