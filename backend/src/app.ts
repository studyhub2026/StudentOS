import crypto from 'node:crypto';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './config/prisma.js';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware.js';
import { globalRateLimit } from './middlewares/rate-limit.middleware.js';
import { apiRouter } from './routes/index.js';

export function createApp(): Express {
  const app = express();

  // Required for correct client IPs (and therefore rate limiting) behind
  // Railway/Render/Vercel proxies.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The API serves JSON only; CSP is enforced by the Next.js frontend.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(
    cors({
      origin: env.isProduction ? [env.APP_URL] : true,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    }),
  );

  app.use(compression());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(cookieParser());

  app.use((req, _res, next) => {
    req.requestId = req.get('x-request-id') ?? crypto.randomUUID();
    next();
  });

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId ?? crypto.randomUUID(),
      // Health checks would otherwise dominate the logs.
      autoLogging: { ignore: (req) => req.url === '/health' },
    }),
  );

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
  });

  /** Readiness probe — verifies the database is actually reachable. */
  app.get('/health/ready', (_req, res) => {
    void (async () => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        res.json({ status: 'ready', database: 'up' });
      } catch {
        res.status(503).json({ status: 'not-ready', database: 'down' });
      }
    })();
  });

  app.use('/api/v1', globalRateLimit, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
