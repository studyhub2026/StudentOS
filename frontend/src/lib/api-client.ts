import axios, {
  AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios';
import type { ApiErrorBody } from '@/types/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * The access token is held in memory only.
 *
 * localStorage would make it readable by any injected script; the refresh
 * token lives in an httpOnly cookie the backend sets, and a page reload
 * recovers the session by calling /auth/refresh.
 */
let accessToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Registered by the auth store so a failed refresh can clear client state. */
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

export const apiClient: AxiosInstance = axios.create({
  baseURL: `${API_URL}/api/v1`,
  // Required for the refresh cookie to travel with requests.
  withCredentials: true,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

apiClient.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

/**
 * Concurrent 401s must not each trigger their own refresh — the first rotation
 * would invalidate the rest and the backend would revoke the token family as
 * suspected reuse. Subsequent callers queue on the in-flight refresh instead.
 */
let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  refreshPromise ??= (async () => {
    try {
      const response = await axios.post<{ data: { accessToken: string } }>(
        `${API_URL}/api/v1/auth/refresh`,
        {},
        { withCredentials: true },
      );
      const token = response.data.data.accessToken;
      setAccessToken(token);
      return token;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorBody>) => {
    const config = error.config as RetriableConfig | undefined;

    const shouldRefresh =
      error.response?.status === 401 &&
      config &&
      !config._retried &&
      // Never retry the refresh call itself, or a failed sign-in.
      !config.url?.includes('/auth/refresh') &&
      !config.url?.includes('/auth/login');

    if (shouldRefresh) {
      config._retried = true;
      try {
        const token = await refreshAccessToken();
        config.headers.Authorization = `Bearer ${token}`;
        return await apiClient.request(config);
      } catch {
        setAccessToken(null);
        onUnauthorized?.();
      }
    }

    return Promise.reject(error);
  },
);

/** Extracts a displayable message from an axios error. */
export function apiErrorMessage(error: unknown): string {
  if (axios.isAxiosError<ApiErrorBody>(error)) {
    const body = error.response?.data;
    if (body?.error?.details?.length) {
      return body.error.details.map((detail) => detail.message).join(', ');
    }
    if (body?.error?.message) return body.error.message;
    if (error.code === 'ECONNABORTED') return 'The request timed out. Please try again.';
    if (!error.response) return 'Cannot reach the server. Check your connection.';
  }
  return error instanceof Error ? error.message : 'Something went wrong';
}

/** Machine-readable error code, for branching on specific failures. */
export function apiErrorCode(error: unknown): string | null {
  return axios.isAxiosError<ApiErrorBody>(error)
    ? (error.response?.data?.error?.code ?? null)
    : null;
}
