import { Prisma } from '@prisma/client';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError } from '../utils/errors.js';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.originalUrl} not found` },
  });
};

interface NormalisedError {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
}

function normalise(error: unknown): NormalisedError {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }

  if (error instanceof ZodError) {
    return {
      statusCode: 422,
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      details: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002': {
        const target = error.meta?.target;
        const fields = Array.isArray(target) ? target.join(', ') : 'field';
        return {
          statusCode: 409,
          code: 'CONFLICT',
          message: `A record with this ${fields} already exists`,
        };
      }
      case 'P2025':
        return { statusCode: 404, code: 'NOT_FOUND', message: 'Record not found' };
      case 'P2003':
        return {
          statusCode: 400,
          code: 'FOREIGN_KEY_VIOLATION',
          message: 'Referenced record does not exist',
        };
      default:
        return { statusCode: 400, code: `PRISMA_${error.code}`, message: 'Database request failed' };
    }
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    return { statusCode: 400, code: 'BAD_REQUEST', message: 'Invalid database query' };
  }

  return { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Something went wrong' };
}

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const normalised = normalise(error);

  if (normalised.statusCode >= 500) {
    logger.error(
      { err: error, method: req.method, url: req.originalUrl, userId: req.user?.id },
      'unhandled request error',
    );
  } else {
    logger.debug(
      { code: normalised.code, method: req.method, url: req.originalUrl },
      'request error',
    );
  }

  res.status(normalised.statusCode).json({
    success: false,
    error: {
      code: normalised.code,
      message: normalised.message,
      ...(normalised.details ? { details: normalised.details } : {}),
      // Stack traces leak internals — development only.
      ...(env.isProduction || !(error instanceof Error) ? {} : { stack: error.stack }),
    },
  });
};
