import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = {
  VK_TOKEN: 'vk-token',
  VK_GROUP_ID: '123',
  CHATWOOT_URL: 'https://chat.example.com/',
  CHATWOOT_ACCOUNT_ID: '1',
  CHATWOOT_TOKEN: 'cw-token',
  CHATWOOT_INBOX_ID: '7',
};

describe('loadConfig', () => {
  it('parses a valid longpoll config and strips the trailing slash', () => {
    const config = loadConfig({ ...base } as NodeJS.ProcessEnv);
    expect(config.vkMode).toBe('longpoll');
    expect(config.vkGroupId).toBe(123);
    expect(config.chatwootUrl).toBe('https://chat.example.com');
    expect(config.maxAttachmentBytes).toBe(50 * 1024 * 1024);
  });

  it('requires VK_GROUP_ID in longpoll mode', () => {
    const { VK_GROUP_ID: _omit, ...rest } = base;
    expect(() => loadConfig(rest as NodeJS.ProcessEnv)).toThrow(/VK_GROUP_ID/);
  });

  it('requires confirmation and public url in callback mode', () => {
    expect(() => loadConfig({ ...base, VK_MODE: 'callback' } as NodeJS.ProcessEnv)).toThrow(
      /VK_CONFIRMATION|PUBLIC_URL/,
    );
  });

  it('rejects an invalid CHATWOOT_URL', () => {
    expect(() => loadConfig({ ...base, CHATWOOT_URL: 'not-a-url' } as NodeJS.ProcessEnv)).toThrow(
      /CHATWOOT_URL/,
    );
  });
});
