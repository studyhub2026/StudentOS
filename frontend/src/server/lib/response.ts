import 'server-only';
import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { env } from '@/server/env';
import { logger } from '@/server/lib/logger';
import { AppError } from '@/server/lib/errors';

/** Shape returned by every list endpoint. */
export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ success: true, data }, { status });
}

export function created<T>(data: T): NextResponse {
  return ok(data, 201);
}

export function paginated<T>(items: T[], pagination: Pagination): NextResponse {
  return NextResponse.json({ success: true, data: items, pagination });
}

interface Normalised {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Maps any thrown value to the JSON error envelope. Mirrors the old Express
 * error middleware so the frontend's error handling is unchanged.
 */
function normalise(error: unknown): Normalised {
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

export function errorResponse(error: unknown): NextResponse {
  const normalised = normalise(error);

  if (normalised.statusCode >= 500) {
    logger.error({ err: error }, 'unhandled route error');
  }

  return NextResponse.json(
    {
      success: false,
      error: {
        code: normalised.code,
        message: normalised.message,
        ...(normalised.details ? { details: normalised.details } : {}),
        ...(env.isProduction || !(error instanceof Error) ? {} : { stack: error.stack }),
      },
    },
    { status: normalised.statusCode },
  );
}
