import { describe, expect, it } from 'vitest';
import { normalizeVkMessage } from '../src/vk/attachments.in.js';
import type { VkMessage } from '../src/vk/types.js';

describe('normalizeVkMessage', () => {
  it('maps core fields and picks the largest photo', () => {
    const message: VkMessage = {
      id: 10,
      from_id: 555,
      peer_id: 555,
      text: 'hi',
      attachments: [
        {
          type: 'photo',
          photo: {
            sizes: [
              { url: 'small.jpg', width: 100, height: 100 },
              { url: 'big.jpg', width: 1000, height: 1000 },
            ],
          },
        },
      ],
    };

    const result = normalizeVkMessage(message);
    expect(result.vkUserId).toBe(555);
    expect(result.peerId).toBe(555);
    expect(result.text).toBe('hi');
    expect(result.vkMessageId).toBe(10);
    expect(result.attachments).toEqual([
      { kind: 'image', url: 'big.jpg', title: 'photo.jpg', mimeType: 'image/jpeg' },
    ]);
  });

  it('maps documents and voice messages', () => {
    const message: VkMessage = {
      id: 1,
      from_id: 1,
      peer_id: 1,
      text: '',
      attachments: [
        { type: 'doc', doc: { url: 'http://f/file.pdf', title: 'file.pdf', ext: 'pdf' } },
        { type: 'audio_message', audio_message: { link_ogg: 'http://f/v.ogg' } },
      ],
    };

    const result = normalizeVkMessage(message);
    expect(result.attachments[0]).toMatchObject({ kind: 'file', url: 'http://f/file.pdf' });
    expect(result.attachments[1]).toMatchObject({ kind: 'audio', url: 'http://f/v.ogg' });
  });

  it('represents unsupported attachments as text', () => {
    const message: VkMessage = {
      id: 1,
      from_id: 1,
      peer_id: 1,
      text: '',
      attachments: [{ type: 'wall' }],
    };
    const result = normalizeVkMessage(message);
    expect(result.attachments[0]).toEqual({ kind: 'link', text: '[wall]' });
  });
});
