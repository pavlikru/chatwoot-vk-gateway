import type { VK } from 'vk-io';
import type { Logger } from '../logger.js';
import type { ChatwootWebhookAttachment } from '../chatwoot/types.js';
import { downloadFile } from '../util/download.js';

/**
 * Upload Chatwoot outbound attachments to VK and return attachment strings
 * (e.g. "photo123_456") ready for `messages.send`.
 *
 * vk-io's upload helpers handle the multi-step VK upload flow
 * (getMessagesUploadServer -> upload -> save) internally.
 */
export async function uploadAttachmentsToVk(
  vk: VK,
  peerId: number,
  attachments: ChatwootWebhookAttachment[],
  maxBytes: number,
  logger: Logger,
): Promise<string[]> {
  const result: string[] = [];
  for (const att of attachments) {
    if (!att.data_url) continue;
    try {
      const file = await downloadFile(att.data_url, maxBytes);
      if (att.file_type === 'image') {
        const photo = await vk.upload.messagePhoto({
          peer_id: peerId,
          source: { value: file.bytes },
        });
        result.push(photo.toString());
      } else {
        const doc = await vk.upload.messageDocument({
          peer_id: peerId,
          source: { value: file.bytes, filename: file.filename },
        });
        result.push(doc.toString());
      }
    } catch (err) {
      logger.error({ err, url: att.data_url }, 'failed to upload attachment to VK');
    }
  }
  return result;
}
