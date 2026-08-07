import 'server-only';
import crypto from 'node:crypto';
import type { LmsProvider } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { env } from '@/server/env';
import { BadRequestError } from '@/server/lib/errors';

/**
 * OAuth state handling for LMS providers. Mirrors src/server/services/oauth.service.ts
 * but scoped to the University Sync flow so an LMS state can never be confused
 * with a sign-in state.
 *
 * State is a signed JWT rather than a server-side record so the callback can be
 * validated without shared storage — matches the existing auth OAuth pattern.
 */

const STATE_TTL_SECONDS = 600;
const STATE_ISSUER = 'omnelos-lms';
const STATE_AUDIENCE = 'lms-oauth-state';

export interface LmsStatePayload {
  provider: LmsProvider;
  userId: string;
  connectionId: string;
}

export function createLmsState(payload: LmsStatePayload): string {
  return jwt.sign(
    { ...payload, nonce: crypto.randomBytes(16).toString('hex') },
    env.JWT_ACCESS_SECRET,
    { expiresIn: STATE_TTL_SECONDS, issuer: STATE_ISSUER, audience: STATE_AUDIENCE },
  );
}

export function verifyLmsState(state: string): LmsStatePayload {
  try {
    const payload = jwt.verify(state, env.JWT_ACCESS_SECRET, {
      issuer: STATE_ISSUER,
      audience: STATE_AUDIENCE,
    }) as LmsStatePayload & { nonce: string };
    return {
      provider: payload.provider,
      userId: payload.userId,
      connectionId: payload.connectionId,
    };
  } catch {
    throw new BadRequestError('The OAuth request expired or was tampered with. Please try again.');
  }
}
