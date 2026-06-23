import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

/** Coerce a possibly-empty string env var into an optional trimmed string. */
const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
    PORT: z.coerce.number().int().positive().default(3000),
    PUBLIC_URL: optionalString,
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    MAX_ATTACHMENT_MB: z.coerce.number().positive().default(50),

    VK_MODE: z.enum(['longpoll', 'callback']).default('longpoll'),
    VK_TOKEN: z.string().min(1, 'VK_TOKEN is required'),
    VK_GROUP_ID: z.coerce.number().int().positive().optional(),
    VK_API_VERSION: z.string().min(1).default('5.199'),
    VK_CONFIRMATION: optionalString,
    VK_CALLBACK_SECRET: optionalString,

    CHATWOOT_URL: z.string().url('CHATWOOT_URL must be a valid URL'),
    CHATWOOT_ACCOUNT_ID: z.coerce.number().int().positive(),
    CHATWOOT_TOKEN: z.string().min(1, 'CHATWOOT_TOKEN is required'),
    CHATWOOT_INBOX_ID: z.coerce.number().int().positive(),
    CHATWOOT_WEBHOOK_SECRET: optionalString,

    REDIS_URL: optionalString,
  })
  .superRefine((cfg, ctx) => {
    if (cfg.VK_MODE === 'longpoll' && cfg.VK_GROUP_ID === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['VK_GROUP_ID'],
        message: 'VK_GROUP_ID is required when VK_MODE=longpoll',
      });
    }
    if (cfg.VK_MODE === 'callback' && !cfg.VK_CONFIRMATION) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['VK_CONFIRMATION'],
        message: 'VK_CONFIRMATION is required when VK_MODE=callback',
      });
    }
    if (cfg.VK_MODE === 'callback' && !cfg.PUBLIC_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PUBLIC_URL'],
        message: 'PUBLIC_URL is required when VK_MODE=callback',
      });
    }
  });

/** Strongly-typed, validated configuration object. */
export interface Config {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  publicUrl?: string;
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  maxAttachmentBytes: number;

  vkMode: 'longpoll' | 'callback';
  vkToken: string;
  vkGroupId?: number;
  vkApiVersion: string;
  vkConfirmation?: string;
  vkCallbackSecret?: string;

  chatwootUrl: string;
  chatwootAccountId: number;
  chatwootToken: string;
  chatwootInboxId: number;
  chatwootWebhookSecret?: string;

  redisUrl?: string;
}

/**
 * Parse and validate `process.env` into a {@link Config}.
 * Throws a readable error (and the caller should exit) when validation fails.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const c = parsed.data;
  return {
    nodeEnv: c.NODE_ENV,
    port: c.PORT,
    publicUrl: c.PUBLIC_URL,
    logLevel: c.LOG_LEVEL,
    maxAttachmentBytes: Math.round(c.MAX_ATTACHMENT_MB * 1024 * 1024),
    vkMode: c.VK_MODE,
    vkToken: c.VK_TOKEN,
    vkGroupId: c.VK_GROUP_ID,
    vkApiVersion: c.VK_API_VERSION,
    vkConfirmation: c.VK_CONFIRMATION,
    vkCallbackSecret: c.VK_CALLBACK_SECRET,
    chatwootUrl: c.CHATWOOT_URL.replace(/\/+$/, ''),
    chatwootAccountId: c.CHATWOOT_ACCOUNT_ID,
    chatwootToken: c.CHATWOOT_TOKEN,
    chatwootInboxId: c.CHATWOOT_INBOX_ID,
    chatwootWebhookSecret: c.CHATWOOT_WEBHOOK_SECRET,
    redisUrl: c.REDIS_URL,
  };
}
