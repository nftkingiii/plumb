import { findChain, type Chain } from "./chains.ts";
import { fmtUnits, HttpError, isAddress, iso, keccakHex, normalizeAddress, TtlCache, type Ctx } from "./core.ts";
import { ethCall, padAddr, readToken, SEL } from "./erc20.ts";
import { hexToBig, pinnedRead, rpcCall } from "./rpc.ts";
import { TOKENS } from "./tokens.ts";

const ENS_REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";

export function namehash(name: string): string {
  let node = "00".repeat(32);
  if (name) {
    for (const label of name.split(".").reverse()) {
      node = keccakHex(Buffer.from(node + keccakHex(label), "hex"));
    }
  }
  return node;
}

const SUPPORTED = ["ethereum", "base", "arbitrum", "optimism", "polygon", "bsc", "avalanche", "gnosis", "linea", "scroll", "zksync", "celo", "mantle", "sepolia", "base-sepolia"];

export function createBalance(ctx: Ctx) {
  const cache = new TtlCache<Record<string, unknown>>(4000, ctx.now);
  const ethereum = findChain("ethereum")!;

  async function resolveEns(name: string): Promise<{ address: string; block: number }> {
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/.test(name)) throw new HttpError(400, "unsupported_ens_name", { detail: "only lower-case ASCII .eth names are resolved" });
    const node = namehash(name);
    const r = await pinnedRead(ctx, ethereum, async (u, blk) => {
      const resolver = await ethCall(ctx, u, ENS_REGISTRY, "0x0178b8bf" + node, blk);
      const rAddr = "0x" + resolver.slice(-40);
      if (resolver.length < 66 || /^0x0+$/.test(rAddr)) return "NO_RESOLVER";
      const out = await ethCall(ctx, u, rAddr, "0x3b3b57de" + node, blk);
      if (out.length < 66) return "NO_ADDRESS";
      const a = "0x" + out.slice(-40);
      return /^0x0+$/.test(a) ? "NO_ADDRESS" : a.toLowerCase();
    });
    if (!isAddress(r.value)) throw new HttpError(404, "ens_name_not_resolved", { name });
    return { address: normalizeAddress(r.value), block: r.block };
  }

  return async function balance(addressRaw: string, chainRaw: string, tokenRaw: string): Promise<Record<string, unknown>> {
    const chain: Chain | undefined = findChain(chainRaw ?? "");
    if (!chain) throw new HttpError(400, "unknown_chain", { supported: SUPPORTED });
    const input = (addressRaw ?? "").trim();
    if (!input) throw new HttpError(400, "address_required");
    const tokenIn = (tokenRaw ?? "").trim();
    const key = `${chain.key}|${input.toLowerCase()}|${tokenIn.toLowerCase()}`;
    const hit = cache.get(key);
    if (hit) return hit;

    let address: string;
    let ens: string | undefined;
    if (input.toLowerCase().endsWith(".eth")) {
      ens = input.toLowerCase();
      address = (await resolveEns(ens)).address;
    } else {
      address = normalizeAddress(input);
    }

    // token: empty or the chain's own coin means native
    const upper = tokenIn.toUpperCase();
    let contract: string | null = null;
    if (tokenIn && upper !== chain.native.toUpperCase() && upper !== "NATIVE") {
      if (isAddress(tokenIn)) contract = normalizeAddress(tokenIn);
      else {
        const hitTok = TOKENS[chain.key]?.[upper];
        if (!hitTok) throw new HttpError(400, "unknown_token", { token: tokenIn, chain: chain.key, detail: "give the contract address" });
        contract = hitTok;
      }
    }

    let body: Record<string, unknown>;
    if (!contract) {
      const r = await pinnedRead(ctx, chain, async (u, blk) => hexToBig(await rpcCall(ctx, u, "eth_getBalance", [address, blk])).toString());
      body = {
        address,
        chain: chain.key,
        balance: Number(fmtUnits(BigInt(r.value), 18)),
        token_symbol: chain.native,
        as_of: iso(r.timestamp * 1000),
        block_number: r.block,
        sources: r.sources,
      };
    } else {
      const r = await pinnedRead(ctx, chain, (u, blk) => readToken(ctx, u, contract!, blk, { sel: SEL.balanceOf, arg: padAddr(address) }));
      if (r.value === "NOT_A_TOKEN") throw new HttpError(404, "not_an_erc20_contract", { contract });
      const [raw, dec, sym] = r.value.split("|") as [string, string, string];
      body = {
        address,
        chain: chain.key,
        balance: Number(fmtUnits(BigInt(raw), Number(dec))),
        token_symbol: sym || null,
        token_contract: contract,
        as_of: iso(r.timestamp * 1000),
        block_number: r.block,
        sources: r.sources,
      };
    }
    if (ens) body.ens_name = ens;
    cache.set(key, body);
    return body;
  };
}
