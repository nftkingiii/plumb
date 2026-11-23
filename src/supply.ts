import { extractChain, type Chain } from "./chains.ts";
import { fmtUnits, HttpError, isAddress, iso, normalizeAddress, TtlCache, type Ctx } from "./core.ts";
import { readToken, SEL } from "./erc20.ts";
import { pinnedRead, rpcCall } from "./rpc.ts";
import { SOLANA_MINTS, SOLANA_RPCS, TOKENS } from "./tokens.ts";

const FILLER = new Set(["on", "the", "of", "token", "total", "supply", "for", "in", "network", "mainnet", "chain", "what", "is", "tokens", "circulating", "a", "an", "verify", "check"]);
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

interface Parsed {
  chain: Chain | "solana";
  token: string;
  assumed: boolean;
}

export function parseToken(raw: string, ethereum: Chain): Parsed {
  const text = (raw ?? "").trim();
  if (!text) throw new HttpError(400, "token_required");
  if (text.length > 256) throw new HttpError(400, "token_too_long");
  const lower = text.toLowerCase();
  const solanaNamed = /\bsolana\b|\bsol\b/.test(lower);
  const ext = extractChain(text.replace(/0x[0-9a-fA-F]{40}/g, " "));
  const addr = text.match(/0x[0-9a-fA-F]{40}/g) ?? [];
  if (addr.length > 1) throw new HttpError(400, "ambiguous_token");
  const rest = ext.rest.replace(/\bsolana\b|\bsol\b/gi, " ");
  const words = rest.split(/[^A-Za-z0-9]+/).filter((w) => w && !FILLER.has(w.toLowerCase()));
  const mint = text.split(/[\s,()]+/).filter((w) => BASE58.test(w) && !/^0x/.test(w));
  if (solanaNamed && ext.chain) throw new HttpError(400, "ambiguous_chain");
  if (addr.length === 1) {
    if (solanaNamed) throw new HttpError(400, "ambiguous_chain");
    return { chain: ext.chain ?? ethereum, token: addr[0]!, assumed: !ext.chain };
  }
  if (mint.length === 1) return { chain: "solana", token: mint[0]!, assumed: false };
  if (words.length !== 1) throw new HttpError(400, "token_not_understood", { detail: "give one symbol or contract address and, optionally, its chain" });
  const sym = words[0]!.toUpperCase();
  if (solanaNamed) return { chain: "solana", token: sym, assumed: false };
  return { chain: ext.chain ?? ethereum, token: sym, assumed: !ext.chain };
}

export function createSupply(ctx: Ctx) {
  const cache = new TtlCache<Record<string, unknown>>(5000, ctx.now);
  const ethereum = extractChain("ethereum").chain!;

  async function solana(mintIn: string): Promise<Record<string, unknown>> {
    const mint = SOLANA_MINTS[mintIn.toUpperCase()] ?? mintIn;
    if (!BASE58.test(mint)) throw new HttpError(400, "unknown_token", { token: mintIn, chain: "solana" });
    const settled = await Promise.allSettled(
      SOLANA_RPCS.map(async (u) => {
        const r = await rpcCall(ctx, u, "getAccountInfo", [mint, { encoding: "base64", commitment: "finalized" }]);
        const v = r?.value;
        if (!v || (v.owner !== TOKEN_PROGRAM && v.owner !== TOKEN_2022) || !Array.isArray(v.data) || v.data[1] !== "base64") throw new Error("not a mint");
        const raw = Buffer.from(String(v.data[0]), "base64");
        if (raw.length < 82 || raw[45] !== 1) throw new Error("not an initialised mint");
        return { amount: raw.readBigUInt64LE(36), decimals: raw[44]!, slot: Number(r?.context?.slot) };
      }),
    );
    const ok = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
    if (ok.length < 2) throw new HttpError(503, "sources_unavailable", { chain: "solana" });
    const [a, b] = ok as [(typeof ok)[number], (typeof ok)[number]];
    const diff = a.amount > b.amount ? a.amount - b.amount : b.amount - a.amount;
    const big = a.amount > b.amount ? a.amount : b.amount;
    if (a.decimals !== b.decimals || diff * 10000n > big) throw new HttpError(502, "sources_disagree", { chain: "solana" });
    const best = a.slot >= b.slot ? a : b;
    return {
      token: mint,
      chain: "solana",
      total_supply: Number(fmtUnits(best.amount, best.decimals)),
      decimals: best.decimals,
      contract: mint,
      as_of: iso(ctx.now()),
      slot: best.slot,
      sources: 2,
    };
  }

  return async function supply(tokenRaw: string): Promise<Record<string, unknown>> {
    const key = (tokenRaw ?? "").trim().toLowerCase();
    const hit = cache.get(key);
    if (hit) return hit;
    const p = parseToken(tokenRaw, ethereum);
    let body: Record<string, unknown>;
    if (p.chain === "solana") {
      body = await solana(p.token);
    } else {
      const chain = p.chain;
      let contract: string;
      if (isAddress(p.token)) contract = normalizeAddress(p.token);
      else {
        const t = TOKENS[chain.key]?.[p.token];
        if (!t) throw new HttpError(400, "unknown_token", { token: p.token, chain: chain.key, detail: "give the contract address" });
        contract = t;
      }
      const r = await pinnedRead(ctx, chain, (u, blk) => readToken(ctx, u, contract, blk, { sel: SEL.totalSupply }));
      if (r.value === "NOT_A_TOKEN") throw new HttpError(404, "not_an_erc20_contract", { contract, chain: chain.key });
      const [raw, dec, sym] = r.value.split("|") as [string, string, string];
      body = {
        token: sym || p.token,
        chain: chain.key,
        total_supply: Number(fmtUnits(BigInt(raw), Number(dec))),
        decimals: Number(dec),
        contract,
        as_of: iso(r.timestamp * 1000),
        block_number: r.block,
        sources: r.sources,
      };
      if (p.assumed) body.chain_assumed = true;
    }
    cache.set(key, body);
    return body;
  };
}
