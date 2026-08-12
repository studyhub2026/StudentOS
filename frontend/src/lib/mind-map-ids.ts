/**
 * ID generator for mind-map nodes/edges. Same format on client and server so
 * ids created by an AI generation on the server round-trip through the editor
 * without any translation layer.
 */
export function newMindId(prefix: 'n' | 'e' = 'n'): string {
  const g = (globalThis as { crypto?: Crypto }).crypto;
  const rand = g?.randomUUID
    ? g.randomUUID().replace(/-/g, '').slice(0, 15)
    : Math.random().toString(36).slice(2, 17);
  return `mm${prefix}_${rand}`;
}
