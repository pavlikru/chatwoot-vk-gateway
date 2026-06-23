import { describe, expect, it } from 'vitest';
import { InMemoryDedupStore, randomId } from '../src/core/dedup.js';

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
