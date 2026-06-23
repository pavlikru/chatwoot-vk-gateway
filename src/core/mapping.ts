import type { VK } from 'vk-io';
import type { ChatwootClient } from '../chatwoot/client.js';
import type { Logger } from '../logger.js';
import { getUserProfile } from '../vk/client.js';

/**
 * Resolve (or create) the Chatwoot contact for a VK user.
 * The VK numeric user id is used as both `source_id` and `identifier`.
 */
export async function resolveContactId(
  chatwoot: ChatwootClient,
  vk: VK,
  vkUserId: number,
  logger: Logger,
): Promise<number> {
  const sourceId = String(vkUserId);
  const existing = await chatwoot.searchContacts(sourceId);
  const match = existing.find(
    (c) =>
      c.identifier === sourceId ||
      (c.contact_inboxes?.some((ci) => ci.source_id === sourceId) ?? false),
  );
  if (match) return match.id;

  const profile = await getUserProfile(vk, vkUserId);
  const created = await chatwoot.createContact({
    sourceId,
    name: profile.name,
    avatarUrl: profile.avatarUrl,
  });
  logger.info({ contactId: created.id, vkUserId }, 'created Chatwoot contact');
  return created.id;
}

/**
 * Resolve (or create) an open conversation for the contact in the VK inbox.
 * Reuses any non-resolved conversation to keep the dialog continuous.
 */
export async function resolveConversationId(
  chatwoot: ChatwootClient,
  contactId: number,
  vkUserId: number,
): Promise<number> {
  const conversations = await chatwoot.listContactConversations(contactId);
  const open = conversations.find((c) => c.status !== 'resolved');
  if (open) return open.id;

  const created = await chatwoot.createConversation({
    sourceId: String(vkUserId),
    contactId,
  });
  return created.id;
}
