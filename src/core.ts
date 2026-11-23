import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface Ctx {
  fetch: FetchFn;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  timeoutMs: number;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export interface Reply {
  status: number;
  body: Record<string, unknown>;
}

export const keccakHex = (s: string | Uint8Array): string =>
  bytesToHex(keccak_256(typeof s === "string" ? utf8ToBytes(s) : s));

export const isAddress = (s: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(s);
export const isTxHash = (s: string): boolean => /^0x[0-9a-fA-F]{64}$/.test(s);

export function toChecksum(addr: string): string {
  const a = addr.slice(2).toLowerCase();
  const h = keccakHex(a);
  return "0x" + [...a].map((c, i) => (parseInt(h[i]!, 16) >= 8 ? c.toUpperCase() : c)).join("");
}

/** All-lower or all-upper hex is accepted; mixed case must carry a valid EIP-55 checksum. */
export function normalizeAddress(raw: string): string {
  const s = raw.trim();
  if (!isAddress(s)) throw new HttpError(400, "invalid_address");
  const body = s.slice(2);
  if (body !== body.toLowerCase() && body !== body.toUpperCase() && toChecksum(s) !== s) {
    throw new HttpError(400, "bad_address_checksum");
  }
  return toChecksum(s);
}

/** Exact decimal string of raw / 10^decimals, no rounding. */
export function fmtUnits(raw: bigint, decimals: number): string {
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  const s = abs.toString().padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return (neg ? "-" : "") + int + (frac ? "." + frac : "");
}

export const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

export class TtlCache<V> {
  private m = new Map<string, { v: V; at: number }>();
  constructor(
    private ttlMs: number,
    private now: () => number,
    private max = 2000,
  ) {}
  get(k: string): V | undefined {
    const e = this.m.get(k);
    if (!e) return undefined;
    if (this.now() - e.at >= this.ttlMs) {
      this.m.delete(k);
      return undefined;
    }
    return e.v;
  }
  set(k: string, v: V): void {
    if (this.m.size >= this.max) this.m.clear();
    this.m.set(k, { v, at: this.now() });
  }
}

export async function fetchJson(ctx: Ctx, url: string, init?: RequestInit): Promise<{ status: number; json: any }> {
  let res: Response;
  try {
    res = await ctx.fetch(url, { ...init, signal: AbortSignal.timeout(ctx.timeoutMs) });
  } catch {
    throw new HttpError(502, "source_unreachable");
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body: leave null */
  }
  return { status: res.status, json };
}
