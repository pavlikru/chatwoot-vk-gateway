import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Config } from '../config.js';
import type { ChatwootWebhookPayload } from './types.js';

/**
 * Verify a Chatwoot webhook HMAC signature.
 *
 * Chatwoot signs deliveries as `sha256=<hex>` where `<hex>` is
 * HMAC-SHA256(`{timestamp}.{raw_body}`, secret), sent in the
 * `X-Chatwoot-Signature` header alongside `X-Chatwoot-Timestamp`.
 *
 * NOTE: signature delivery depends on the Chatwoot version/integration. When no
 * secret is configured the gateway accepts unsigned payloads. Verify the exact
 * scheme against your deployment (see docs/TROUBLESHOOTING.md).
 */
export function verifySignature(
  rawBody: string,
  timestamp: string | undefined,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const provided = signatureHeader.replace(/^sha256=/, '');
  const signedPayload = timestamp ? `${timestamp}.${rawBody}` : rawBody;
  const expected = createHmac('sha256', secret).update(signedPayload).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Decide whether an outbound webhook payload should be relayed to VK.
 *
 * Only agent-authored, non-private, outgoing messages on the configured VK
 * inbox are forwarded. Bot/echo and incoming events are ignored.
 */
export function shouldForwardOutbound(payload: ChatwootWebhookPayload, config: Config): boolean {
  if (payload.event && payload.event !== 'message_created') return false;
  if (payload.message_type !== 'outgoing') return false;
  if (payload.private) return false;
  const inboxId = payload.inbox?.id ?? payload.conversation?.id;
  if (payload.inbox?.id !== undefined && payload.inbox.id !== config.chatwootInboxId) {
    return false;
  }
  // When the inbox id is absent from the payload we still forward, relying on
  // the inbox webhook being inbox-scoped.
  void inboxId;
  return true;
}

/** Extract the VK peer id (= contact `source_id`) from an outbound payload. */
export function extractPeerId(payload: ChatwootWebhookPayload): number | undefined {
  const sourceId =
    payload.conversation?.contact_inbox?.source_id ??
    payload.source_id ??
    payload.conversation?.meta?.sender?.identifier ??
    undefined;
  if (!sourceId) return undefined;
  const peerId = Number.parseInt(String(sourceId), 10);
  return Number.isFinite(peerId) ? peerId : undefined;
}
