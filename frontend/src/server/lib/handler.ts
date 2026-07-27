import 'server-only';
import type { NextRequest, NextResponse } from 'next/server';
import type { ZodType } from 'zod';
import { errorResponse } from '@/server/lib/response';

/**
 * Wraps a route handler so any thrown value becomes the JSON error envelope,
 * exactly as the old Express error middleware did. Also normalises Next 15's
 * async dynamic `params` into a resolved object for the handler.
 */
export function route<P extends Record<string, string> = Record<string, string>>(
  handler: (req: NextRequest, ctx: { params: P }) => Promise<NextResponse>,
) {
  // The returned signature must match Next's generated RouteContext exactly —
  // `context.params` is a Promise in Next 15, and the parameter must not be a
  // union (a `| undefined` here fails Next's ParamCheck type validation).
  return async (
    req: NextRequest,
    context: { params: Promise<P> },
  ): Promise<NextResponse> => {
    try {
      const params = (await context.params) as P;
      return await handler(req, { params });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

/**
 * Extracts the caller's user agent and IP for session records. On Vercel the
 * real client IP is the first entry of `x-forwarded-for`.
 */
export function requestContext(req: NextRequest): {
  userAgent?: string;
  ipAddress?: string;
} {
  const userAgent = req.headers.get('user-agent') ?? undefined;
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ipAddress = forwarded ?? req.headers.get('x-real-ip') ?? undefined;
  return {
    ...(userAgent ? { userAgent } : {}),
    ...(ipAddress ? { ipAddress } : {}),
  };
}

/** Parses and validates the JSON body. An absent body validates as `{}`. */
export async function readJson<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  return schema.parse(body);
}

/**
 * Parses and validates the query string. Repeated keys collapse to the last
 * value; the validators accept comma-separated lists for multi-value filters,
 * matching how the client serialises arrays.
 */
export function readQuery<T>(req: NextRequest, schema: ZodType<T>): T {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  return schema.parse(params);
}
