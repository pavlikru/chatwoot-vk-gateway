import { describe, expect, it, vi } from 'vitest';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import type { Logger } from '../src/logger.js';

describe('buildServer', () => {
  it('logs rejected Chatwoot webhook signatures without processing the payload', async () => {
    const warn = vi.fn();
    const onChatwootWebhook = vi.fn();
    const app = buildServer({
      config: loadConfig({
        VK_TOKEN: 'vk',
        VK_GROUP_ID: '1',
        CHATWOOT_URL: 'https://c.example.com',
        CHATWOOT_ACCOUNT_ID: '1',
        CHATWOOT_TOKEN: 't',
        CHATWOOT_INBOX_ID: '7',
        CHATWOOT_WEBHOOK_SECRET: 'secret',
      } as NodeJS.ProcessEnv),
      logger: { warn } as unknown as Logger,
      onChatwootWebhook,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/chatwoot/webhook',
      headers: {
        'content-type': 'application/json',
        'x-chatwoot-timestamp': '1700000000',
        'x-chatwoot-signature': `sha256=${'0'.repeat(64)}`,
      },
      payload: { event: 'message_created' },
    });

    expect(res.statusCode).toBe(401);
    expect(onChatwootWebhook).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      { hasTimestamp: true, hasSignature: true },
      'Chatwoot webhook rejected: invalid signature',
    );

    await app.close();
  });
});
