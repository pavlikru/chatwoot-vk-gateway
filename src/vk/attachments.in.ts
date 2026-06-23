import type { IncomingMessage, NormalizedAttachment } from '../types.js';
import type { VkAttachment, VkMessage, VkPhotoSize } from './types.js';

/** Normalize a raw VK message (from Long Poll or Callback) into {@link IncomingMessage}. */
export function normalizeVkMessage(message: VkMessage): IncomingMessage {
  const attachments = (message.attachments ?? [])
    .map(mapAttachment)
    .filter((a): a is NormalizedAttachment => a !== null);
  return {
    vkUserId: message.from_id,
    peerId: message.peer_id,
    text: message.text ?? '',
    vkMessageId: message.id || message.conversation_message_id || 0,
    attachments,
  };
}

function mapAttachment(att: VkAttachment): NormalizedAttachment | null {
  switch (att.type) {
    case 'photo': {
      const url = largest(att.photo?.sizes);
      return url ? { kind: 'image', url, title: 'photo.jpg', mimeType: 'image/jpeg' } : null;
    }
    case 'doc': {
      const doc = att.doc;
      if (!doc?.url) return null;
      return { kind: 'file', url: doc.url, title: doc.title ?? `file.${doc.ext ?? 'bin'}` };
    }
    case 'audio_message': {
      const am = att.audio_message;
      const url = am?.link_ogg ?? am?.link_mp3;
      return url ? { kind: 'audio', url, title: 'voice.ogg', mimeType: 'audio/ogg' } : null;
    }
    case 'sticker': {
      const url = largest(att.sticker?.images);
      return url ? { kind: 'image', url, title: 'sticker.png', mimeType: 'image/png' } : null;
    }
    case 'video': {
      const title = att.video?.title ?? 'video';
      return { kind: 'video', text: `[видео] ${title}`.trim(), title };
    }
    case 'link': {
      const url = att.link?.url;
      return { kind: 'link', url, text: url ?? att.link?.title, title: att.link?.title };
    }
    default:
      return { kind: 'link', text: `[${att.type}]` };
  }
}

/** Pick the largest image variant by width. */
function largest(sizes?: VkPhotoSize[]): string | undefined {
  if (!sizes || sizes.length === 0) return undefined;
  return [...sizes].sort((a, b) => b.width - a.width)[0]?.url;
}
