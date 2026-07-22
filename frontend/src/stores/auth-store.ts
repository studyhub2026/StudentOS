'use client';

import { create } from 'zustand';
import {
  apiClient,
  setAccessToken,
  setUnauthorizedHandler,
} from '@/lib/api-client';
import type { ApiEnvelope, AuthPayload, User } from '@/types/api';

interface AuthState {
  user: User | null;
  /** False until the initial refresh attempt settles, so guards don't flash. */
  initialised: boolean;
  /** True while the bootstrap refresh is in flight; dedupes concurrent calls. */
  bootstrapping: boolean;
  loading: boolean;

  setUser: (user: User | null) => void;
  login: (email: string, password: string, totp?: string, rememberMe?: boolean) => Promise<void>;
  register: (input: {
    email: string;
    username: string;
    name: string;
    password: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  /** Restores the session from the httpOnly refresh cookie on page load. */
  bootstrap: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  initialised: false,
  bootstrapping: false,
  loading: false,

  setUser: (user) => set({ user }),

  login: async (email, password, totp, rememberMe) => {
    set({ loading: true });
    try {
      const { data } = await apiClient.post<ApiEnvelope<AuthPayload>>('/auth/login', {
        email,
        password,
        ...(totp ? { totp } : {}),
        rememberMe: rememberMe ?? false,
      });
      setAccessToken(data.data.accessToken);
      set({ user: data.data.user });
    } finally {
      set({ loading: false });
    }
  },

  register: async (input) => {
    set({ loading: true });
    try {
      const { data } = await apiClient.post<ApiEnvelope<AuthPayload>>('/auth/register', input);
      setAccessToken(data.data.accessToken);
      set({ user: data.data.user });
    } finally {
      set({ loading: false });
    }
  },

  logout: async () => {
    try {
      await apiClient.post('/auth/logout');
    } catch {
      // A failed logout call must still clear local state — the user asked to
      // sign out and the refresh cookie expires on its own.
    } finally {
      setAccessToken(null);
      set({ user: null });
    }
  },

  bootstrap: async () => {
    // The guard lives in store state rather than a module-level promise.
    // A module variable can desync from the store it guards — under hot
    // reload the module re-evaluates while components still read the old
    // store — leaving `initialised` false forever and the app stuck on its
    // loading screen. `bootstrapping` is set synchronously before the first
    // await, so React Strict Mode's double effect still only fires one
    // request: two concurrent refreshes would rotate the token twice, which
    // the backend treats as reuse and punishes by revoking the family.
    const { initialised, bootstrapping } = get();
    if (initialised || bootstrapping) return;

    set({ bootstrapping: true });

    try {
      const { data } = await apiClient.post<ApiEnvelope<{ accessToken: string }>>(
        '/auth/refresh',
        {},
      );
      setAccessToken(data.data.accessToken);

      const me = await apiClient.get<ApiEnvelope<User>>('/auth/me');
      set({ user: me.data.data });
    } catch {
      // No valid refresh cookie — an ordinary signed-out visit.
      setAccessToken(null);
      set({ user: null });
    } finally {
      set({ initialised: true, bootstrapping: false });
    }
  },

  refreshUser: async () => {
    const { data } = await apiClient.get<ApiEnvelope<User>>('/auth/me');
    set({ user: data.data });
  },
}));

// When a refresh ultimately fails, drop the user so route guards redirect.
setUnauthorizedHandler(() => {
  useAuthStore.setState({ user: null, initialised: true });
});
