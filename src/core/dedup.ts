import { randomInt } from 'node:crypto';

/**
 * Small TTL-based deduplication cache.
 *
 * Used to drop VK/Chatwoot events that are delivered more than once (Callback
 * API retries, overlapping long-poll windows, webhook re-deliveries).
 *
 * The default implementation is in-memory. A Redis-backed implementation can be
 * added later behind the same {@link DedupStore} interface when REDIS_URL is set
 * (see plan milestone 6); the rest of the code only depends on the interface.
 */
export interface DedupStore {
  /** Returns true if `key` was already seen within the TTL window. */
  seen(key: string): Promise<boolean>;
}

export class InMemoryDedupStore implements DedupStore {
  private readonly entries = new Map<string, number>();

  constructor(private readonly ttlMs = 5 * 60 * 1000) {}

  async seen(key: string): Promise<boolean> {
    const now = Date.now();
    this.evict(now);
    if (this.entries.has(key)) return true;
    this.entries.set(key, now + this.ttlMs);
    return false;
  }

  private evict(now: number): void {
    for (const [key, expiresAt] of this.entries) {
      if (expiresAt <= now) this.entries.delete(key);
    }
  }
}

/**
 * VK's `messages.send` requires a unique `random_id` per message for its own
 * deduplication. A 31-bit positive integer is within VK's accepted range.
 */
export function randomId(): number {
  return randomInt(1, 2_147_483_647);
}
