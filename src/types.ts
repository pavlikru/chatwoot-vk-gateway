/**
 * Internal, transport-agnostic types shared across the gateway.
 *
 * VK-specific and Chatwoot-specific payload shapes live in their respective
 * modules (`src/vk/*`, `src/chatwoot/types.ts`). Everything in `core/` should
 * speak in terms of the normalized types defined here.
 */

/** Kind of a normalized attachment, mapped from both VK and Chatwoot. */
export type AttachmentKind = 'image' | 'file' | 'audio' | 'video' | 'sticker' | 'link' | 'location';

/**
 * A normalized attachment.
 *
 * - When flowing VK -> Chatwoot, `url` is a remote VK URL to download.
 * - When flowing Chatwoot -> VK, `url` is the Chatwoot `data_url` to download.
 * - `text` carries a human-readable fallback for kinds that cannot be
 *   re-uploaded (e.g. `video`, `link`, `location`).
 */
export interface NormalizedAttachment {
  kind: AttachmentKind;
  url?: string;
  title?: string;
  mimeType?: string;
  text?: string;
}

/** A message coming from VK, normalized for the inbound pipeline. */
export interface IncomingMessage {
  /** VK user id (positive). Used as the Chatwoot contact `source_id`. */
  vkUserId: number;
  /** VK peer id. Equals `vkUserId` for direct dialogs. */
  peerId: number;
  /** Plain text content (may be empty when only attachments are present). */
  text: string;
  attachments: NormalizedAttachment[];
  /** VK message id, used for deduplication. */
  vkMessageId: number;
}

/** A VK user profile used to enrich the Chatwoot contact. */
export interface VkUserProfile {
  id: number;
  name: string;
  avatarUrl?: string;
}

/** A binary payload ready to be uploaded somewhere. */
export interface DownloadedFile {
  filename: string;
  mimeType: string;
  bytes: Buffer;
}
