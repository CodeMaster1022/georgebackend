// Build a deterministic query string for BBB checksum signing.
// Important: the checksum uses the exact query string bytes.

export type QueryValue = string | number | boolean | undefined | null;

function encodeRFC3986(input: string): string {
  return encodeURIComponent(input)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function buildQuery(params: Record<string, QueryValue>): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => [k, String(v)] as const)
    .sort(([a], [b]) => a.localeCompare(b));

  return entries
    .map(([k, v]) => `${encodeRFC3986(k)}=${encodeRFC3986(v)}`)
    .join('&');
}

