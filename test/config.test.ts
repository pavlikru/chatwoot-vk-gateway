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
    expect(config.shutdownTimeoutMs).toBe(30_000);
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

  it('parses a valid Redis URL', () => {
    const config = loadConfig({ ...base, REDIS_URL: 'redis://localhost:6379/0' });
    expect(config.redisUrl).toBe('redis://localhost:6379/0');
  });

  it('rejects a non-Redis REDIS_URL', () => {
    expect(() => loadConfig({ ...base, REDIS_URL: 'https://localhost:6379' })).toThrow(/REDIS_URL/);
  });
});

it('accepts a custom shutdown deadline', () => {
  expect(loadConfig({ ...base, SHUTDOWN_TIMEOUT_MS: '5000' }).shutdownTimeoutMs).toBe(5000);
});

it.each(['0', '-1', '1.5', '2147483648', 'invalid'])(
  'rejects invalid shutdown deadline %s',
  (value) => {
    expect(() => loadConfig({ ...base, SHUTDOWN_TIMEOUT_MS: value })).toThrow(
      /SHUTDOWN_TIMEOUT_MS/,
    );
  },
);
