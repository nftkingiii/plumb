import type { Ctx } from "./core.ts";
import { hexToBig, rpcCall } from "./rpc.ts";

export const SEL = {
  balanceOf: "0x70a08231",
  decimals: "0x313ce567",
  symbol: "0x95d89b41",
  totalSupply: "0x18160ddd",
};

export const padAddr = (a: string): string => a.slice(2).toLowerCase().padStart(64, "0");

export const ethCall = (ctx: Ctx, url: string, to: string, data: string, blockHex: string): Promise<string> =>
  rpcCall(ctx, url, "eth_call", [{ to, data }, blockHex]);

export function decodeSymbol(hex: string): string | null {
  if (typeof hex !== "string" || hex.length < 66) return null;
  const body = hex.slice(2);
  let bytes: string;
  if (body.length === 64) {
    bytes = body;
  } else {
    const len = Number(BigInt("0x" + body.slice(64, 128)));
    if (!Number.isFinite(len) || len > 64) return null;
    bytes = body.slice(128, 128 + len * 2);
  }
  const buf = Buffer.from(bytes.length % 2 ? bytes.slice(0, -1) : bytes, "hex");
  const end = buf.indexOf(0);
  const out = buf.subarray(0, end === -1 ? buf.length : end).toString("utf8");
  for (const ch of out) if (ch.charCodeAt(0) < 32 || ch === "�") return null;
  return out || null;
}

/** decimals(), symbol() and one uint256 view, read at a block. Returns a string so answers compare exactly. */
export async function readToken(ctx: Ctx, url: string, token: string, blockHex: string, view: { sel: string; arg?: string }): Promise<string> {
  const [dec, val, sym] = await Promise.all([
    ethCall(ctx, url, token, SEL.decimals, blockHex),
    ethCall(ctx, url, token, view.sel + (view.arg ?? ""), blockHex),
    ethCall(ctx, url, token, SEL.symbol, blockHex).catch(() => "0x"),
  ]);
  if (dec.length < 66 || val.length < 66) return "NOT_A_TOKEN";
  const d = hexToBig(dec);
  if (d > 255n) return "NOT_A_TOKEN";
  return `${hexToBig(val)}|${d}|${decodeSymbol(sym) ?? ""}`;
}
