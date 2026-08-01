import { getAccessToken } from '@/lib/api-client';

/**
 * Minimal Server-Sent-Events client over `fetch`. The browser's native
 * EventSource can't send an Authorization header or a POST body, so we read the
 * stream by hand. Yields `{ event, data }` objects as they arrive.
 */
export interface SseMessage {
  event: string;
  data: string;
}

export async function* postSse(
  url: string,
  body: unknown,
  signal?: AbortSignal,
): AsyncGenerator<SseMessage, void, undefined> {
  const token = getAccessToken();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    credentials: 'include',
    ...(signal ? { signal } : {}),
  });

  if (!response.ok || !response.body) {
    let message = `Request failed (${response.status})`;
    try {
      const parsed = await response.json();
      message = parsed?.error?.message ?? message;
    } catch {
      /* keep default */
    }
    throw new Error(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line.
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      let event = 'message';
      const dataLines: string[] = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
      }
      if (dataLines.length > 0) yield { event, data: dataLines.join('\n') };

      boundary = buffer.indexOf('\n\n');
    }
  }
}
