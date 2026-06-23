/**
 * Partial VK Community API payload shapes used by the gateway.
 * Only the fields we read are typed. Both Long Poll and Callback API deliver the
 * same event objects, so a single set of types covers both transports.
 */

export interface VkPhotoSize {
  url: string;
  width: number;
  height: number;
  type?: string;
}

export interface VkAttachment {
  type: string;
  photo?: { sizes?: VkPhotoSize[] };
  doc?: { url?: string; title?: string; ext?: string };
  audio_message?: { link_ogg?: string; link_mp3?: string; duration?: number };
  sticker?: { images?: VkPhotoSize[] };
  video?: { title?: string; player?: string };
  link?: { url?: string; title?: string };
}

export interface VkMessage {
  id: number;
  date?: number;
  peer_id: number;
  from_id: number;
  text: string;
  attachments?: VkAttachment[];
  conversation_message_id?: number;
}

export interface VkUpdate {
  type: string;
  object: { message?: VkMessage } & Record<string, unknown>;
  group_id?: number;
  event_id?: string;
}

/** A Callback API request body is a {@link VkUpdate} plus an optional secret. */
export interface VkCallbackBody extends VkUpdate {
  secret?: string;
}
