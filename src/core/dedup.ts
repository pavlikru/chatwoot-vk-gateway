import { randomInt } from 'node:crypto';
import type { Config } from '../config.js';
import type { Logger } from '../logger.js';

/**
 * Small TTL-based deduplication cache.
 *
 * Used to drop VK/Chatwoot events that are delivered more than once (Callback
 * API retries, overlapping long-poll windows, webhook re-deliveries).
 *
 * The default implementation is in-memory. A Redis-backed implementation can be
 * used behind the same {@link DedupStore} interface when REDIS_URL is set; the
 * rest of the code only depends on the interface.
 */
export interface DedupStore {
  /** Returns true if `key` was already seen within the TTL window. */
  seen(key: string): Promise<boolean>;
}

export interface ManagedDedupStore extends DedupStore {
  close(): Promise<void>;
}

export class InMemoryDedupStore implements ManagedDedupStore {
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

  async close(): Promise<void> {}
}

export interface RedisSetOptions {
  expiration: {
    type: 'PX';
    value: number;
  };
  condition: 'NX';
}

export interface RedisDedupClient {
  set(key: string, value: string, options: RedisSetOptions): Promise<string | null>;
  close(): Promise<void>;
}

interface RedisRuntimeClient {
  isOpen: boolean;
  set(key: string, value: string, options: RedisSetOptions): Promise<string | null>;
  on(event: 'error', listener: (err: Error) => void): void;
  connect(): Promise<RedisRuntimeClient>;
  quit(): Promise<string>;
}

interface RedisRuntimeModule {
  createClient(options: { url: string; socket: { reconnectStrategy: false } }): RedisRuntimeClient;
}

export class RedisDedupStore implements ManagedDedupStore {
  private readonly prefix = 'chatwoot-vk-gateway:dedup:';

  constructor(
    private readonly client: RedisDedupClient,
    private readonly ttlMs = 5 * 60 * 1000,
  ) {}

  async seen(key: string): Promise<boolean> {
    const result = await this.client.set(`${this.prefix}${key}`, '1', {
      expiration: { type: 'PX', value: this.ttlMs },
      condition: 'NX',
    });
    return result === null;
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

export async function createDedupStore(config: Config, logger: Logger): Promise<ManagedDedupStore> {
  if (!config.redisUrl) {
    logger.info('using in-memory dedup store');
    return new InMemoryDedupStore();
  }

  let redisModule: RedisRuntimeModule;
  try {
    redisModule = (await import('redis')) as RedisRuntimeModule;
  } catch (err) {
    throw new Error(
      "REDIS_URL is set but optional package 'redis' is not installed. " +
        'Install optional dependencies or unset REDIS_URL to use the in-memory dedup store.',
      { cause: err },
    );
  }

  const redis = redisModule.createClient({
    url: config.redisUrl,
    socket: { reconnectStrategy: false },
  });
  redis.on('error', (err: Error) => logger.error({ err }, 'redis dedup client error'));
  await redis.connect();
  logger.info('using Redis dedup store');

  return new RedisDedupStore({
    set: async (key, value, options) => {
      const result = await redis.set(key, value, options);
      return result === null ? null : String(result);
    },
    close: async () => {
      if (redis.isOpen) await redis.quit();
    },
  });
}

/**
 * VK's `messages.send` requires a unique `random_id` per message for its own
 * deduplication. A 31-bit positive integer is within VK's accepted range.
 */
export function randomId(): number {
  return randomInt(1, 2_147_483_647);
}
