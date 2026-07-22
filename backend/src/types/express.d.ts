import type { Role } from '@prisma/client';

/** The identity attached to a request by `requireAuth`. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  sessionId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      requestId?: string;
    }
  }
}

export {};
