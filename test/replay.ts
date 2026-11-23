import type { Ctx, FetchFn } from "../src/core.ts";

export interface Entry {
  status: number;
  body: string;
}

export function keyOf(url: string, init?: RequestInit): string {
  const method = init?.method ?? "GET";
  let body = "";
  if (typeof init?.body === "string") {
    try {
      const j = JSON.parse(init.body);
      body = JSON.stringify([j.method, j.params]);
    } catch {
      body = init.body;
    }
  }
  return `${method} ${url} ${body}`;
}

const mk = (e: Entry): Response => new Response(e.body, { status: e.status });

/** Serves only what was recorded from the live services; anything else counts as a miss and fails like a dead network. */
export function replayFetch(entries: Record<string, Entry>): { fetch: FetchFn; misses: string[] } {
  const misses: string[] = [];
  const f: FetchFn = async (url, init) => {
    const k = keyOf(url, init);
    const e = entries[k];
    if (!e) {
      misses.push(k);
      throw new TypeError("not recorded");
    }
    return mk(e);
  };
  return { fetch: f, misses };
}

export function recordingFetch(real: FetchFn, entries: Record<string, Entry>): FetchFn {
  return async (url, init) => {
    const res = await real(url, init);
    const text = await res.text();
    entries[keyOf(url, init)] = { status: res.status, body: text };
    return mk({ status: res.status, body: text });
  };
}

export function ctxFor(f: FetchFn, now: number): Ctx {
  return { fetch: f, now: () => now, sleep: async () => {}, timeoutMs: 5000 };
}

export interface Scenario {
  name: string;
  path: string;
  query: Record<string, string>;
  now: number;
  entries: Record<string, Entry>;
  status: number;
  body: Record<string, unknown>;
}
