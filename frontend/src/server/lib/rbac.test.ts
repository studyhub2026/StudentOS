import type { Role } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { requireRole, type AuthUser } from './auth';
import { ForbiddenError } from './errors';

/**
 * Role gating is what stands between a student and the admin panel. In the
 * Next.js app it is a plain guard called at the top of a route handler once
 * `requireAuth` has resolved the session — so it is exercised directly here
 * rather than through the route layer (which cannot be reached without a
 * database). The anonymous case belongs to `requireAuth` and is covered by the
 * live end-to-end auth suite.
 */

function user(role: Role): AuthUser {
  return { id: 'u1', email: 'a@b.com', role, sessionId: 's1' };
}

/** Runs the guard and reports what it threw, or null when it admitted. */
function gate(userRole: Role, accepted: Role[]): unknown {
  try {
    requireRole(user(userRole), ...accepted);
    return null;
  } catch (error) {
    return error;
  }
}

describe('requireRole', () => {
  it('admits a user holding the required role', () => {
    expect(gate('ADMIN', ['ADMIN'])).toBeNull();
  });

  it('rejects a student from an admin-only route', () => {
    const result = gate('STUDENT', ['ADMIN']);
    expect(result).toBeInstanceOf(ForbiddenError);
    expect((result as ForbiddenError).statusCode).toBe(403);
  });

  it('rejects a teacher from an admin-only route', () => {
    expect(gate('TEACHER', ['ADMIN'])).toBeInstanceOf(ForbiddenError);
  });

  it('admits any of several accepted roles', () => {
    expect(gate('TEACHER', ['TEACHER', 'ADMIN'])).toBeNull();
    expect(gate('ADMIN', ['TEACHER', 'ADMIN'])).toBeNull();
    expect(gate('STUDENT', ['TEACHER', 'ADMIN'])).toBeInstanceOf(ForbiddenError);
  });

  it('does not treat roles as a hierarchy', () => {
    // ADMIN is not implicitly a STUDENT: a route restricted to STUDENT only
    // must not silently admit administrators.
    expect(gate('ADMIN', ['STUDENT'])).toBeInstanceOf(ForbiddenError);
  });

  it('rejects every role when the accepted list is empty', () => {
    for (const role of ['STUDENT', 'TEACHER', 'ADMIN'] as Role[]) {
      expect(gate(role, [])).toBeInstanceOf(ForbiddenError);
    }
  });

  it('never leaks the required role in the error message', () => {
    const result = gate('STUDENT', ['ADMIN']) as ForbiddenError;
    expect(result.message.toLowerCase()).not.toContain('admin');
  });
});
