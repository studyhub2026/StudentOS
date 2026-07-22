import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { requireRole } from './auth.middleware.js';
import { ForbiddenError, UnauthorizedError } from '../utils/errors.js';

/**
 * Role gating is what stands between a student and the admin panel, so it is
 * exercised directly rather than only through the route layer (which cannot
 * be reached without a database).
 */

type Role = 'STUDENT' | 'TEACHER' | 'ADMIN';

/** Runs the middleware and reports what it passed to `next`. */
function invoke(handlerRoles: Role[], userRole: Role | null): unknown {
  const middleware = requireRole(...(handlerRoles as never[]));

  const req = {
    ...(userRole
      ? { user: { id: 'u1', email: 'a@b.com', role: userRole, sessionId: 's1' } }
      : {}),
  } as Request;

  let captured: unknown = 'NOT_CALLED';
  const next: NextFunction = (error?: unknown) => {
    captured = error ?? null;
  };

  middleware(req, {} as Response, next);
  return captured;
}

describe('requireRole', () => {
  it('admits a user holding the required role', () => {
    expect(invoke(['ADMIN'], 'ADMIN')).toBeNull();
  });

  it('rejects a student from an admin-only route', () => {
    const result = invoke(['ADMIN'], 'STUDENT');
    expect(result).toBeInstanceOf(ForbiddenError);
    expect((result as ForbiddenError).statusCode).toBe(403);
  });

  it('rejects a teacher from an admin-only route', () => {
    expect(invoke(['ADMIN'], 'TEACHER')).toBeInstanceOf(ForbiddenError);
  });

  it('rejects an anonymous request with 401, not 403', () => {
    // The distinction matters: 401 tells the client to authenticate,
    // 403 tells it that authenticating again will not help.
    const result = invoke(['ADMIN'], null);
    expect(result).toBeInstanceOf(UnauthorizedError);
    expect((result as UnauthorizedError).statusCode).toBe(401);
  });

  it('admits any of several accepted roles', () => {
    expect(invoke(['TEACHER', 'ADMIN'], 'TEACHER')).toBeNull();
    expect(invoke(['TEACHER', 'ADMIN'], 'ADMIN')).toBeNull();
    expect(invoke(['TEACHER', 'ADMIN'], 'STUDENT')).toBeInstanceOf(ForbiddenError);
  });

  it('does not treat roles as a hierarchy', () => {
    // ADMIN is not implicitly a STUDENT: a route restricted to STUDENT only
    // must not silently admit administrators.
    expect(invoke(['STUDENT'], 'ADMIN')).toBeInstanceOf(ForbiddenError);
  });

  it('rejects every role when the accepted list is empty', () => {
    for (const role of ['STUDENT', 'TEACHER', 'ADMIN'] as Role[]) {
      expect(invoke([], role)).toBeInstanceOf(ForbiddenError);
    }
  });

  it('never leaks the required role in the error message', () => {
    const result = invoke(['ADMIN'], 'STUDENT') as ForbiddenError;
    expect(result.message.toLowerCase()).not.toContain('admin');
  });
});
