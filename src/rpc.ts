import type { Chain } from "./chains.ts";
import { HttpError, type Ctx } from "./core.ts";

export class RpcError extends Error {}

export async function rpcCall(ctx: Ctx, url: string, method: string, params: unknown[] = []): Promise<any> {
  let res: Response;
  try {
    res = await ctx.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(ctx.timeoutMs),
    });
  } catch {
    throw new RpcError("unreachable");
  }
  let j: any;
  try {
    j = JSON.parse(await res.text());
  } catch {
    throw new RpcError("not_json");
  }
  if (res.status !== 200 || !j || j.error || !("result" in j)) throw new RpcError(String(j?.error?.message ?? res.status).slice(0, 80));
  return j.result;
}

export const hexToBig = (h: unknown): bigint => {
  if (typeof h !== "string" || !/^0x[0-9a-fA-F]*$/.test(h)) throw new RpcError("bad_hex");
  return h === "0x" ? 0n : BigInt(h);
};

/**
 * Run `fn` against the first `want` RPCs in parallel; if fewer than `need` succeed, walk the remaining
 * RPCs one at a time. Returns every success (at least `need`) or throws sources_unavailable.
 */
export async function gather<T>(chain: Chain, fn: (url: string) => Promise<T>, need = 2, want = 3): Promise<{ url: string; value: T }[]> {
  const first = chain.rpcs.slice(0, want);
  const settled = await Promise.allSettled(first.map((u) => fn(u)));
  const ok: { url: string; value: T }[] = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") ok.push({ url: first[i]!, value: s.value });
  });
  for (const u of chain.rpcs.slice(want)) {
    if (ok.length >= need) break;
    try {
      ok.push({ url: u, value: await fn(u) });
    } catch {
      /* try the next one */
    }
  }
  if (ok.length < need) throw new HttpError(503, "sources_unavailable", { chain: chain.key, answered: ok.length, needed: need });
  return ok;
}

export const MAX_BLOCK_AGE_S = 180;

export interface Pinned<T> {
  block: number;
  timestamp: number;
  value: T;
  sources: number;
}

/**
 * Read the same block on at least two independent public RPCs. The block is the second-highest head
 * reported, so at least two nodes have it. Every answer must be identical, otherwise the read is refused.
 */
export async function pinnedRead<T>(
  ctx: Ctx,
  chain: Chain,
  read: (url: string, blockHex: string) => Promise<T>,
  same: (a: T, b: T) => boolean = (a, b) => JSON.stringify(a) === JSON.stringify(b),
): Promise<Pinned<T>> {
  const heads = (await gather(chain, async (u) => hexToBig(await rpcCall(ctx, u, "eth_blockNumber")))).sort((a, b) =>
    a.value === b.value ? 0 : a.value < b.value ? 1 : -1,
  );
  const pin = heads[1]!.value;
  const blockHex = "0x" + pin.toString(16);
  const eligible = heads.filter((h) => h.value >= pin).map((h) => h.url);
  let answers: { url: string; value: T }[];
  try {
    answers = await gather({ ...chain, rpcs: eligible }, (u) => read(u, blockHex), 2, eligible.length);
  } catch {
    throw new HttpError(503, "sources_unavailable", { chain: chain.key });
  }
  for (const a of answers.slice(1)) {
    if (!same(answers[0]!.value, a.value)) throw new HttpError(502, "sources_disagree", { chain: chain.key, block: Number(pin) });
  }
  let timestamp = 0;
  for (const u of eligible) {
    try {
      const b = await rpcCall(ctx, u, "eth_getBlockByNumber", [blockHex, false]);
      timestamp = Number(hexToBig(b?.timestamp));
      if (timestamp) break;
    } catch {
      /* next */
    }
  }
  if (!timestamp) throw new HttpError(503, "block_time_unavailable", { chain: chain.key });
  const age = ctx.now() / 1000 - timestamp;
  if (age > MAX_BLOCK_AGE_S) throw new HttpError(503, "chain_data_stale", { chain: chain.key, block_age_s: Math.round(age) });
  return { block: Number(pin), timestamp, value: answers[0]!.value, sources: answers.length };
}
