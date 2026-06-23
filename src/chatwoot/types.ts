/**
 * Chatwoot Application API and webhook payload shapes.
 *
 * These are intentionally partial — only the fields the gateway relies on are
 * typed. See https://developers.chatwoot.com/api-reference for the full schemas.
 */

export interface ChatwootContactInbox {
  source_id: string;
  inbox?: { id: number };
}

export interface ChatwootContact {
  id: number;
  name?: string;
  identifier?: string | null;
  contact_inboxes?: ChatwootContactInbox[];
}

export interface ChatwootConversation {
  id: number;
  status?: string;
  inbox_id?: number;
}

export interface ChatwootMessage {
  id: number;
  content?: string;
  message_type?: number | string;
}

/** Attachment as it appears in an outbound `message_created` webhook payload. */
export interface ChatwootWebhookAttachment {
  id?: number;
  file_type?: string;
  data_url?: string;
  thumb_url?: string;
  extension?: string | null;
}

/**
 * The `message_created` webhook payload (flattened "message" event shape that
 * Chatwoot delivers to inbox/account webhooks).
 */
export interface ChatwootWebhookPayload {
  event?: string;
  /** "incoming" | "outgoing" | "template" | "activity" */
  message_type?: string;
  content?: string | null;
  private?: boolean;
  source_id?: string;
  attachments?: ChatwootWebhookAttachment[];
  sender?: { type?: string; name?: string };
  inbox?: { id?: number; name?: string };
  conversation?: {
    id?: number;
    contact_inbox?: { source_id?: string };
    meta?: { sender?: { id?: number; identifier?: string | null } };
  };
}
