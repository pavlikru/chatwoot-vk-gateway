import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { buildServer } from './server.js';
import { ChatwootClient } from './chatwoot/client.js';
import { createVkClient } from './vk/client.js';
import { buildCallbackHandler, startLongPoll } from './vk/updates.js';
import { createDedupStore } from './core/dedup.js';
import { processVkUpdate } from './core/inbound.js';
import { processChatwootWebhook } from './core/outbound.js';
import type { VkUpdate } from './vk/types.js';
import type { ChatwootWebhookPayload } from './chatwoot/types.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  const vk = createVkClient(config);
  const chatwoot = new ChatwootClient(config, logger);
  const dedup = await createDedupStore(config, logger);
  const abort = new AbortController();
  const pending = new Set<Promise<void>>();
  const track = (task: Promise<void>): Promise<void> => {
    pending.add(task);
    const settled = (): void => {
      pending.delete(task);
    };
    void task.then(settled, settled);
    return task;
  };

  const onUpdate = (update: VkUpdate): Promise<void> =>
    track(processVkUpdate({ vk, chatwoot, config, logger, dedup }, update));
  const onChatwootWebhook = (payload: ChatwootWebhookPayload): Promise<void> =>
    track(processChatwootWebhook({ vk, config, logger, dedup }, payload));
  const onVkCallback =
    config.vkMode === 'callback' ? buildCallbackHandler(config, onUpdate, logger) : undefined;

  const app = buildServer({ config, logger, onChatwootWebhook, onVkCallback });
  await app.listen({ host: '0.0.0.0', port: config.port });
  logger.info({ port: config.port, mode: config.vkMode }, 'gateway listening');

  let longPoll: Promise<void> | undefined;
  if (config.vkMode === 'longpoll') {
    if (config.vkGroupId === undefined)
      throw new Error('VK_GROUP_ID is required for longpoll mode');
    longPoll = startLongPoll(vk, config.vkGroupId, onUpdate, logger, abort.signal).catch(() => {
      logger.error('long poll terminated');
    });
  }

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'shutting down');
    const deadline = setTimeout(() => {
      logger.error({ pendingTasks: pending.size }, 'shutdown timed out');
      process.exit(1);
    }, config.shutdownTimeoutMs);
    try {
      abort.abort();
      await Promise.all([app.close(), longPoll]);
      // Ingress has stopped, so no producer can add another delivery after this snapshot.
      logger.info({ pendingTasks: pending.size }, 'draining background deliveries');
      await Promise.allSettled(pending);
      await dedup.close();
      clearTimeout(deadline);
      logger.info('shutdown complete');
      process.exit(0);
    } catch {
      clearTimeout(deadline);
      logger.error({ pendingTasks: pending.size }, 'shutdown failed');
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  // The logger may not exist yet if config failed — use console for the fatal path.
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
