import pino from 'pino';
import { env } from './env.js';

export const logger = pino({
  level: env.isProduction ? 'info' : 'debug',
  // Pretty output locally; structured JSON in production for log aggregators.
  transport: env.isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.refreshToken',
      '*.accessToken',
      '*.twoFactorSecret',
    ],
    censor: '[redacted]',
  },
});

export type Logger = typeof logger;
