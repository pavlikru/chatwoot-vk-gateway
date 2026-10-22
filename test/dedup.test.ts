import { describe, expect, it } from 'vitest';
import {
  InMemoryDedupStore,
  RedisDedupStore,
  randomId,
  type RedisDedupClient,
  type RedisSetOptions,
} from '../src/core/dedup.js';

describe('InMemoryDedupStore', () => {
  it('reports a key as unseen once, then seen', async () => {
    const store = new InMemoryDedupStore();
    expect(await store.seen('a')).toBe(false);
    expect(await store.seen('a')).toBe(true);
    expect(await store.seen('b')).toBe(false);
  });

  it('expires entries after the TTL', async () => {
    const store = new InMemoryDedupStore(1);
    expect(await store.seen('a')).toBe(false);
    await new Promise((r) => setTimeout(r, 5));
    expect(await store.seen('a')).toBe(false);
  });
});

class FakeRedisDedupClient implements RedisDedupClient {
  readonly writes: Array<{ key: string; value: string; options: RedisSetOptions }> = [];
  closed = false;
  private readonly entries = new Set<string>();

  async set(key: string, value: string, options: RedisSetOptions): Promise<string | null> {
    this.writes.push({ key, value, options });
    if (this.entries.has(key)) return null;
    this.entries.add(key);
    return 'OK';
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

describe('RedisDedupStore', () => {
  it('uses atomic Redis SET NX PX semantics', async () => {
    const client = new FakeRedisDedupClient();
    const store = new RedisDedupStore(client, 12_000);

    expect(await store.seen('vk:event-1')).toBe(false);
    expect(await store.seen('vk:event-1')).toBe(true);
    expect(await store.seen('cw:event-2')).toBe(false);
    expect(client.writes).toEqual([
      {
        key: 'chatwoot-vk-gateway:dedup:vk:event-1',
        value: '1',
        options: { expiration: { type: 'PX', value: 12_000 }, condition: 'NX' },
      },
      {
        key: 'chatwoot-vk-gateway:dedup:vk:event-1',
        value: '1',
        options: { expiration: { type: 'PX', value: 12_000 }, condition: 'NX' },
      },
      {
        key: 'chatwoot-vk-gateway:dedup:cw:event-2',
        value: '1',
        options: { expiration: { type: 'PX', value: 12_000 }, condition: 'NX' },
      },
    ]);
  });

  it('closes the Redis client', async () => {
    const client = new FakeRedisDedupClient();
    const store = new RedisDedupStore(client);

    await store.close();
    expect(client.closed).toBe(true);
  });
});

describe('randomId', () => {
  it('returns a positive 31-bit integer', () => {
    for (let i = 0; i < 100; i++) {
      const id = randomId();
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeGreaterThan(0);
      expect(id).toBeLessThan(2_147_483_647);
    }
  });
});
