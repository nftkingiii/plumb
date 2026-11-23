import { findChain, type Chain } from "./chains.ts";
import { fetchJson, fmtUnits, HttpError, iso, TtlCache, type Ctx } from "./core.ts";
import { gather, hexToBig, MAX_BLOCK_AGE_S, rpcCall } from "./rpc.ts";

const TOL_REL = 0.25;
const TOL_ABS_WEI = 1000n;

export function createGas(ctx: Ctx) {
  const cache = new TtlCache<Record<string, unknown>>(4000, ctx.now);
  const priceCache = new TtlCache<number | null>(30_000, ctx.now);

  async function nativeUsd(chain: Chain): Promise<number | null> {
    if (!chain.priceSymbol || !chain.krakenPair) return null;
    const hit = priceCache.get(chain.priceSymbol);
    if (hit !== undefined) return hit;
    let price: number | null = null;
    try {
      const [cb, kr] = await Promise.all([
        fetchJson(ctx, `https://api.coinbase.com/v2/prices/${chain.priceSymbol}-USD/spot`),
        fetchJson(ctx, `https://api.kraken.com/0/public/Ticker?pair=${chain.krakenPair}`),
      ]);
      const a = Number(cb.json?.data?.amount);
      const res = kr.json?.result;
      const b = Number(res ? res[Object.keys(res)[0]!]?.c?.[0] : NaN);
      if (a > 0 && b > 0 && Math.abs(a - b) / Math.max(a, b) <= 0.02) price = a;
    } catch {
      price = null;
    }
    priceCache.set(chain.priceSymbol, price);
    return price;
  }

  return async function gas(chainRaw: string): Promise<Record<string, unknown>> {
    const chain = findChain(chainRaw ?? "");
    if (!chain) throw new HttpError(400, "unknown_chain", { supported: ["ethereum", "base", "arbitrum", "optimism", "polygon", "bsc", "avalanche", "gnosis", "linea", "scroll", "zksync", "celo", "mantle", "sepolia", "base-sepolia"] });
    const hit = cache.get(chain.key);
    if (hit) return hit;

    const readings = await gather(
      chain,
      async (u) => {
        const [price, block] = await Promise.all([rpcCall(ctx, u, "eth_gasPrice"), rpcCall(ctx, u, "eth_getBlockByNumber", ["latest", false])]);
        return { wei: hexToBig(price), ts: Number(hexToBig(block?.timestamp)), block: Number(hexToBig(block?.number)) };
      },
      2,
      3,
    );
    const nowS = ctx.now() / 1000;
    const fresh = readings.filter((r) => r.value.ts > 0 && nowS - r.value.ts <= MAX_BLOCK_AGE_S);
    if (fresh.length < 2) throw new HttpError(503, "chain_data_stale", { chain: chain.key });
    const wei = fresh.map((r) => r.value.wei).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const lo = wei[0]!;
    const hi = wei[wei.length - 1]!;
    const spread = hi - lo;
    const allowed = BigInt(Math.floor(Number(hi) * TOL_REL));
    if (spread > allowed && spread > TOL_ABS_WEI) throw new HttpError(502, "sources_disagree", { chain: chain.key });
    const mid = wei[Math.floor(wei.length / 2)]!;
    const newest = fresh.reduce((m, r) => (r.value.block > m.value.block ? r : m));

    const body: Record<string, unknown> = {
      chain: chain.key,
      gas_price_gwei: Number(fmtUnits(mid, 9)),
      gas_price_wei: mid.toString(),
      as_of: iso(ctx.now()),
      block_number: newest.value.block,
      sources: fresh.length,
    };
    const usd = await nativeUsd(chain);
    if (usd !== null) {
      body.transfer_fee_usd = Number(((Number(mid) * 21000 * usd) / 1e18).toFixed(6));
      body.native_usd = usd;
    }
    cache.set(chain.key, body);
    return body;
  };
}
