import { pino, type Logger } from 'pino';

export type { Logger };

/**
 * Create the application logger. Pretty output in development, JSON in
 * production. The level is taken from config (or LOG_LEVEL as a fallback so the
 * logger can be created before config is loaded).
 */
export function createLogger(level: string = process.env.LOG_LEVEL ?? 'info'): Logger {
  const isDev = process.env.NODE_ENV === 'development';
  return pino({
    level,
    ...(isDev
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:standard' } } }
      : {}),
    // Never log secrets even if they sneak into a bound child logger.
    redact: {
      paths: ['vkToken', 'chatwootToken', 'token', 'secret', '*.token', '*.secret'],
      censor: '[redacted]',
    },
  });
}
