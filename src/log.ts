/** One grep-friendly line per request: `req {json}`. Only public market identifiers are logged, never headers or bodies. */
export interface RequestLog {
  at: Date;
  route: string;
  query: URLSearchParams;
  status: number;
  error?: string;
  ms: number;
  ip: string;
}

const MAX_VALUE = 200;
const MAX_KEY = 64;
const MAX_PARAMS = 20;

export function requestLine(entry: RequestLog): string {
  const query: Record<string, string> = {};
  for (const [key, value] of entry.query) {
    const name = key.slice(0, MAX_KEY);
    if (!(name in query) && Object.keys(query).length >= MAX_PARAMS) continue;
    query[name] = name in query ? `${query[name]},${value}`.slice(0, MAX_VALUE) : value.slice(0, MAX_VALUE);
  }
  return `req ${JSON.stringify({
    ts: entry.at.toISOString(),
    route: entry.route.slice(0, MAX_VALUE),
    query,
    status: entry.status,
    ...(entry.error ? { error: entry.error.slice(0, MAX_VALUE) } : {}),
    ms: Math.round(entry.ms),
    ip: entry.ip.slice(0, MAX_KEY),
  })}`;
}
