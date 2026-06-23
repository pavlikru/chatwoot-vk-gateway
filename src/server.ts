import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { Logger } from './logger.js';
import type { VkCallbackBody } from './vk/types.js';
import type { ChatwootWebhookPayload } from './chatwoot/types.js';
import { verifySignature } from './chatwoot/webhook.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

export interface ServerDeps {
  config: Config;
  logger: Logger;
  onChatwootWebhook: (payload: ChatwootWebhookPayload) => Promise<void>;
  onVkCallback?: (body: VkCallbackBody) => Promise<{ status: number; body: string }>;
}

/** Build the Fastify app with `/health`, `/vk/callback` and `/chatwoot/webhook`. */
export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 25 * 1024 * 1024 });

  // Keep the raw JSON body so Chatwoot HMAC signatures can be verified.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    const raw = typeof body === 'string' ? body : body.toString('utf8');
    req.rawBody = raw;
    try {
      done(null, raw.length > 0 ? JSON.parse(raw) : {});
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.get('/health', async () => ({ status: 'ok' }));

  const vkCallback = deps.onVkCallback;
  if (deps.config.vkMode === 'callback' && vkCallback) {
    app.post('/vk/callback', async (req, reply) => {
      const result = await vkCallback(req.body as VkCallbackBody);
      await reply.code(result.status).type('text/plain').send(result.body);
    });
  }

  app.post('/chatwoot/webhook', async (req, reply) => {
    const secret = deps.config.chatwootWebhookSecret;
    if (secret) {
      const ok = verifySignature(
        req.rawBody ?? '',
        headerString(req.headers['x-chatwoot-timestamp']),
        headerString(req.headers['x-chatwoot-signature']),
        secret,
      );
      if (!ok) {
        await reply.code(401).send({ error: 'invalid signature' });
        return;
      }
    }
    // Acknowledge fast; process asynchronously.
    await reply.code(200).send({ status: 'ok' });
    void deps
      .onChatwootWebhook(req.body as ChatwootWebhookPayload)
      .catch((err) => deps.logger.error({ err }, 'chatwoot webhook processing failed'));
  });

  return app;
}

function headerString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
