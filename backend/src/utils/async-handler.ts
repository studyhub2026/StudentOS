import type { NextFunction, Request, Response, RequestHandler } from 'express';

/**
 * Wraps an async route handler so rejected promises reach Express's error
 * middleware. Express 4 does not await handlers, so without this an async
 * throw becomes an unhandled rejection and the request hangs.
 */
export function asyncHandler<
  Params = Record<string, string>,
  ResBody = unknown,
  ReqBody = unknown,
  ReqQuery = Record<string, unknown>,
>(
  handler: (
    req: Request<Params, ResBody, ReqBody, ReqQuery>,
    res: Response<ResBody>,
    next: NextFunction,
  ) => Promise<unknown>,
): RequestHandler<Params, ResBody, ReqBody, ReqQuery> {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
