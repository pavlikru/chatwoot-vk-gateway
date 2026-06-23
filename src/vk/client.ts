import { VK } from 'vk-io';
import type { Config } from '../config.js';
import type { VkUserProfile } from '../types.js';
import { randomId } from '../core/dedup.js';

/** Minimal shape of a `users.get` result row (only fields we read). */
interface VkApiUser {
  id: number;
  first_name?: string;
  last_name?: string;
  photo_max?: string;
}

export function createVkClient(config: Config): VK {
  return new VK({ token: config.vkToken, apiVersion: config.vkApiVersion });
}

/** Fetch a VK user's display name and avatar to enrich the Chatwoot contact. */
export async function getUserProfile(vk: VK, userId: number): Promise<VkUserProfile> {
  const users = (await vk.api.users.get({
    user_ids: [String(userId)],
    fields: ['photo_max'],
  })) as unknown as VkApiUser[];
  const user = users[0];
  const name = user ? `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() : '';
  return { id: userId, name: name || `vk_${userId}`, avatarUrl: user?.photo_max };
}

/** Send a message to a VK peer. Returns the new VK message id. */
export async function sendVkMessage(
  vk: VK,
  peerId: number,
  message: string,
  attachment: string[] = [],
): Promise<number> {
  const result = await vk.api.messages.send({
    peer_id: peerId,
    random_id: randomId(),
    message: message.length > 0 ? message : undefined,
    attachment: attachment.length > 0 ? attachment.join(',') : undefined,
  });
  // For a single peer VK returns the new message id as a number.
  return result as unknown as number;
}

/** Best-effort "typing…" indicator. Never throws. */
export async function setTyping(vk: VK, peerId: number): Promise<void> {
  try {
    await vk.api.messages.setActivity({ peer_id: peerId, type: 'typing' });
  } catch {
    /* best-effort */
  }
}
