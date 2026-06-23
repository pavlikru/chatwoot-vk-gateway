import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { buildServer } from './server.js';
import { ChatwootClient } from './chatwoot/client.js';
import { createVkClient } from './vk/client.js';
import { buildCallbackHandler, startLongPoll } from './vk/updates.js';
import { InMemoryDedupStore } from './core/dedup.js';
import { processVkUpdate } from './core/inbound.js';
import { processChatwootWebhook } from './core/outbound.js';
import type { VkUpdate } from './vk/types.js';
import type { ChatwootWebhookPayload } from './chatwoot/types.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  const vk = createVkClient(config);
  const chatwoot = new ChatwootClient(config, logger);
  const dedup = new InMemoryDedupStore();
  const abort = new AbortController();

  const onUpdate = (update: VkUpdate): Promise<void> =>
    processVkUpdate({ vk, chatwoot, config, logger, dedup }, update);
  const onChatwootWebhook = (payload: ChatwootWebhookPayload): Promise<void> =>
    processChatwootWebhook({ vk, config, logger, dedup }, payload);
  const onVkCallback =
    config.vkMode === 'callback' ? buildCallbackHandler(config, onUpdate, logger) : undefined;

  const app = buildServer({ config, logger, onChatwootWebhook, onVkCallback });
  await app.listen({ host: '0.0.0.0', port: config.port });
  logger.info({ port: config.port, mode: config.vkMode }, 'gateway listening');

  if (config.vkMode === 'longpoll') {
    if (config.vkGroupId === undefined)
      throw new Error('VK_GROUP_ID is required for longpoll mode');
    void startLongPoll(vk, config.vkGroupId, onUpdate, logger, abort.signal).catch((err: unknown) =>
      logger.error({ err }, 'long poll terminated'),
    );
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    abort.abort();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  // The logger may not exist yet if config failed — use console for the fatal path.
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
