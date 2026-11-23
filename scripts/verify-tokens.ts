// Checks every symbol in src/tokens.ts against the contract's own symbol() on two RPCs. Run on the VM.
import { defaultCtx } from "../src/app.ts";
import { findChain } from "../src/chains.ts";
import { decodeSymbol, ethCall, SEL } from "../src/erc20.ts";
import { TOKENS } from "../src/tokens.ts";

const ctx = defaultCtx();
let bad = 0;
for (const [chainKey, table] of Object.entries(TOKENS)) {
  const chain = findChain(chainKey)!;
  for (const [sym, addr] of Object.entries(table)) {
    const seen: string[] = [];
    for (const url of chain.rpcs.slice(0, 2)) {
      try {
        seen.push(decodeSymbol(await ethCall(ctx, url, addr, SEL.symbol, "latest")) ?? "?");
      } catch {
        seen.push("ERR");
      }
    }
    const ok = seen.every((s) => s.toUpperCase() === sym);
    if (!ok) bad++;
    console.log(ok ? "ok  " : "BAD ", chainKey.padEnd(10), sym.padEnd(6), addr, seen.join(" / "));
  }
}
console.log(bad ? `${bad} mismatches` : "all symbols match");
