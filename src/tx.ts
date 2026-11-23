import { findChain } from "./chains.ts";
import { fmtUnits, HttpError, isTxHash, TtlCache, type Ctx } from "./core.ts";
import { gather, hexToBig, rpcCall } from "./rpc.ts";

interface View {
  state: "confirmed" | "reverted" | "pending" | "not_found";
  blockNumber?: number;
  blockHash?: string;
  from?: string;
  to?: string | null;
  contractAddress?: string | null;
  valueWei?: string;
}

const SUPPORTED = ["ethereum", "base", "arbitrum", "optimism", "polygon", "bsc", "avalanche", "gnosis", "linea", "scroll", "zksync", "celo", "mantle", "sepolia", "base-sepolia"];

async function view(ctx: Ctx, url: string, hash: string): Promise<View> {
  const [tx, rc] = await Promise.all([rpcCall(ctx, url, "eth_getTransactionByHash", [hash]), rpcCall(ctx, url, "eth_getTransactionReceipt", [hash])]);
  if (!tx) {
    if (rc) throw new Error("receipt without transaction");
    return { state: "not_found" };
  }
  if (typeof tx.hash !== "string" || tx.hash.toLowerCase() !== hash.toLowerCase()) throw new Error("hash mismatch");
  const base = { from: String(tx.from).toLowerCase(), to: tx.to ? String(tx.to).toLowerCase() : null, valueWei: hexToBig(tx.value).toString() };
  if (!rc) return { state: "pending", ...base };
  if (rc.transactionHash?.toLowerCase() !== hash.toLowerCase()) throw new Error("receipt hash mismatch");
  const status = rc.status === undefined ? undefined : hexToBig(rc.status);
  if (status !== 0n && status !== 1n) throw new Error("receipt without status");
  return {
    state: status === 1n ? "confirmed" : "reverted",
    blockNumber: Number(hexToBig(rc.blockNumber)),
    blockHash: String(rc.blockHash).toLowerCase(),
    contractAddress: rc.contractAddress ? String(rc.contractAddress).toLowerCase() : null,
    ...base,
  };
}

const sig = (v: View): string => JSON.stringify(v);

export function createTx(ctx: Ctx) {
  const cache = new TtlCache<Record<string, unknown>>(10_000, ctx.now);

  return async function tx(hashRaw: string, chainRaw: string): Promise<Record<string, unknown>> {
    const chain = findChain(chainRaw ?? "");
    if (!chain) throw new HttpError(400, "unknown_chain", { supported: SUPPORTED });
    const hash = (hashRaw ?? "").trim().toLowerCase();
    if (!isTxHash(hash)) throw new HttpError(400, "invalid_tx_hash");
    const key = `${chain.key}|${hash}`;
    const hit = cache.get(key);
    if (hit) return hit;

    let views = await gather(chain, (u) => view(ctx, u, hash));
    // A node that has not seen the block yet answers not_found or pending while another has the receipt. Give it one more look.
    if (new Set(views.map((v) => sig(v.value))).size > 1) {
      await ctx.sleep(1500);
      views = await gather(chain, (u) => view(ctx, u, hash));
    }
    const first = views[0]!.value;
    if (views.some((v) => sig(v.value) !== sig(first))) throw new HttpError(502, "sources_disagree", { chain: chain.key, tx_hash: hash });

    const body: Record<string, unknown> = { tx_hash: hash, chain: chain.key, status: first.state, sources: views.length };
    if (first.state !== "not_found") {
      body.from = first.from;
      body.to = first.to ?? first.contractAddress ?? null;
      if (first.to === null && first.contractAddress) body.contract_created = true;
      body.value_eth = Number(fmtUnits(BigInt(first.valueWei!), 18));
      if (first.blockNumber !== undefined) {
        body.block_number = first.blockNumber;
        body.block_hash = first.blockHash;
      }
    }
    // only settled answers are cached; pending changes quickly
    if (first.state === "confirmed" || first.state === "reverted") cache.set(key, body);
    return body;
  };
}
