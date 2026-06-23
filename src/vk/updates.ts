import type { VK } from 'vk-io';
import type { Config } from '../config.js';
import type { Logger } from '../logger.js';
import type { VkCallbackBody, VkUpdate } from './types.js';

export type UpdateHandler = (update: VkUpdate) => Promise<void>;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface LongPollServer {
  key: string;
  server: string;
  ts: string;
}

interface LongPollResponse {
  ts?: string;
  updates?: VkUpdate[];
  failed?: number;
}

/**
 * Bots Long Poll loop. Polls the VK server and dispatches each update to
 * `onUpdate`. Re-initializes the server on `failed` codes and backs off on
 * network errors. Stops when `signal` is aborted.
 */
export async function startLongPoll(
  vk: VK,
  groupId: number,
  onUpdate: UpdateHandler,
  logger: Logger,
  signal: AbortSignal,
): Promise<void> {
  const getServer = async (): Promise<LongPollServer> => {
    const s = await vk.api.groups.getLongPollServer({ group_id: groupId });
    return { key: s.key, server: s.server, ts: s.ts };
  };

  let server: LongPollServer | null = null;
  logger.info('VK long poll started');

  while (!signal.aborted) {
    try {
      if (!server) server = await getServer();

      const url = `${server.server}?act=a_check&key=${server.key}&ts=${server.ts}&wait=25`;
      const res = await fetch(url, { signal });
      const data = (await res.json()) as LongPollResponse;

      if (data.failed) {
        if (data.failed === 1 && data.ts) {
          server.ts = String(data.ts);
        } else {
          server = null; // re-init key/ts on the next iteration
        }
        continue;
      }

      if (data.ts) server.ts = data.ts;
      for (const update of data.updates ?? []) {
        void onUpdate(update).catch((err) => logger.error({ err }, 'update handler failed'));
      }
    } catch (err) {
      if (signal.aborted) break;
      logger.error({ err }, 'long poll error, retrying in 3s');
      server = null;
      await sleep(3000);
    }
  }
  logger.info('VK long poll stopped');
}

/**
 * Build a Callback API handler. Returns the body/status the gateway should send
 * back to VK: the confirmation string for `type=confirmation`, otherwise `ok`.
 * Updates are processed asynchronously so VK gets its fast acknowledgement.
 */
export function buildCallbackHandler(
  config: Config,
  onUpdate: UpdateHandler,
  logger: Logger,
): (body: VkCallbackBody) => Promise<{ status: number; body: string }> {
  return async (body) => {
    if (config.vkCallbackSecret && body.secret !== config.vkCallbackSecret) {
      logger.warn('VK callback rejected: bad secret');
      return { status: 403, body: 'forbidden' };
    }
    if (body.type === 'confirmation') {
      return { status: 200, body: config.vkConfirmation ?? '' };
    }
    void onUpdate(body).catch((err) => logger.error({ err }, 'callback handler failed'));
    return { status: 200, body: 'ok' };
  };
}
