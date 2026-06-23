import type { VK } from 'vk-io';
import type { Config } from '../config.js';
import type { Logger } from '../logger.js';
import type { ChatwootWebhookPayload } from '../chatwoot/types.js';
import { extractPeerId, shouldForwardOutbound } from '../chatwoot/webhook.js';
import { sendVkMessage } from '../vk/client.js';
import { uploadAttachmentsToVk } from '../vk/attachments.out.js';
import type { DedupStore } from './dedup.js';

export interface OutboundDeps {
  vk: VK;
  config: Config;
  logger: Logger;
  dedup: DedupStore;
}

/**
 * Outbound pipeline: Chatwoot `message_created` webhook -> VK message.
 *
 * Only agent-authored outgoing messages on the VK inbox are relayed. Attachments
 * are uploaded to VK first, then a single `messages.send` carries text + media.
 */
export async function processChatwootWebhook(
  deps: OutboundDeps,
  payload: ChatwootWebhookPayload,
): Promise<void> {
  if (!shouldForwardOutbound(payload, deps.config)) return;

  const peerId = extractPeerId(payload);
  if (!peerId) {
    deps.logger.warn('outbound message without a resolvable VK peer id, skipping');
    return;
  }

  const attachmentIds = (payload.attachments ?? []).map((a) => a.id).join(',');
  const dedupKey = `cw:${payload.conversation?.id ?? ''}:${payload.content ?? ''}:${attachmentIds}`;
  if (await deps.dedup.seen(dedupKey)) return;

  const attachmentStrings = payload.attachments?.length
    ? await uploadAttachmentsToVk(
        deps.vk,
        peerId,
        payload.attachments,
        deps.config.maxAttachmentBytes,
        deps.logger,
      )
    : [];

  await sendVkMessage(deps.vk, peerId, payload.content ?? '', attachmentStrings);
  deps.logger.info({ peerId, attachments: attachmentStrings.length }, 'relayed Chatwoot -> VK');
}
