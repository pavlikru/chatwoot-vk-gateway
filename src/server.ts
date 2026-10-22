import Fastify, { type FastifyInstance } from 'fastify';
import { STATUS_CODES } from 'node:http';
import type { Config } from './config.js';
import type { Logger } from './logger.js';
import type { VkCallbackBody } from './vk/types.js';
import type { ChatwootWebhookPayload } from './chatwoot/types.js';
import { verifySignature } from './chatwoot/webhook.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
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

  // Verify HMAC against the received bytes; let Fastify classify JSON errors.
  const parseJson = app.getDefaultJsonParser('error', 'error');
  app.removeContentTypeParser('text/plain');
  app.addContentTypeParser<Buffer>('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    req.rawBody = body;
    parseJson(req, body.toString('utf8'), done);
  });

  app.addHook('preValidation', async (req, reply) => {
    if (
      req.method === 'POST' &&
      (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body))
    ) {
      await reply.code(400).send({ error: 'JSON body must be an object' });
    }
  });

  app.setErrorHandler<{ statusCode?: number }>((error, req, reply) => {
    const statusCode =
      error.statusCode && error.statusCode >= 400 && error.statusCode < 600
        ? error.statusCode
        : 500;
    // Error messages/stacks can contain request bodies or downstream credentials.
    if (statusCode >= 500) {
      deps.logger.error({ statusCode, requestId: req.id }, 'HTTP request failed');
    }
    const message = STATUS_CODES[statusCode] ?? 'Internal Server Error';
    void reply.code(statusCode).send({ statusCode, error: message, message });
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
        deps.logger.warn(
          {
            hasTimestamp: Boolean(headerString(req.headers['x-chatwoot-timestamp'])),
            hasSignature: Boolean(headerString(req.headers['x-chatwoot-signature'])),
          },
          'Chatwoot webhook rejected: invalid signature',
        );
        await reply.code(401).send({ error: 'invalid signature' });
        return;
      }
    }
    // Acknowledge fast; process asynchronously.
    await reply.code(200).send({ status: 'ok' });
    void deps
      .onChatwootWebhook(req.body as ChatwootWebhookPayload)
      .catch(() => deps.logger.error('chatwoot webhook processing failed'));
  });

  return app;
}

function headerString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
