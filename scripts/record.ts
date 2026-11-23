// Records live responses for each scenario into test/fixtures/recorded.json. Run on the VM: npm run record
import { writeFileSync } from "node:fs";
import { createApp } from "../src/app.ts";
import { rpcCall } from "../src/rpc.ts";
import { defaultCtx } from "../src/app.ts";
import { ctxFor, recordingFetch, type Entry, type Scenario } from "../test/replay.ts";

const real = defaultCtx();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function latestTx(rpc: string): Promise<string> {
  const b = await rpcCall(real, rpc, "eth_getBlockByNumber", ["latest", false]);
  const h = b.transactions?.[0];
  if (!h) throw new Error("empty block");
  return h;
}

/** Find a reverted transaction on Base by scanning recent block receipts. */
async function revertedTx(rpc: string): Promise<string | null> {
  const head = Number(BigInt(await rpcCall(real, rpc, "eth_blockNumber")));
  for (let n = head - 3; n > head - 40; n--) {
    try {
      const rc = await rpcCall(real, rpc, "eth_getBlockReceipts", ["0x" + n.toString(16)]);
      const bad = rc.find((r: any) => r.status === "0x0");
      if (bad) return bad.transactionHash;
    } catch {
      return null;
    }
  }
  return null;
}

const scenarios: { name: string; path: string; query: Record<string, string>; delayMs?: number }[] = [];
const add = (name: string, path: string, query: Record<string, string>, delayMs = 0) => scenarios.push({ name, path, query, delayMs });

const ethTx = await latestTx("https://ethereum-rpc.publicnode.com");
const baseTx = await latestTx("https://base-rpc.publicnode.com");
const badTx = await revertedTx("https://base-rpc.publicnode.com");

add("gas ethereum", "/gas", { chain: "ethereum" });
add("gas base", "/gas", { chain: "Base" });
add("gas polygon", "/gas", { chain: "polygon" });
add("gas arbitrum one", "/gas", { chain: "Arbitrum One" });
add("gas bnb", "/gas", { chain: "BNB Chain" });
add("gas unknown", "/gas", { chain: "dogechain" });

add("balance ens native", "/balance", { address: "vitalik.eth", chain: "ethereum", token: "" });
add("balance base native", "/balance", { address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", chain: "base", token: "" });
add("balance usdc ethereum", "/balance", { address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", chain: "ethereum", token: "USDC" });
add("balance usdt polygon zero", "/balance", { address: "0x0000000000000000000000000000000000000000", chain: "polygon", token: "USDT" });
add("balance not a token", "/balance", { address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", chain: "ethereum", token: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" });

add("supply usdc ethereum", "/supply", { token: "USDC on Ethereum" });
add("supply usdc base", "/supply", { token: "total supply of USDC on Base" });
add("supply dai no chain", "/supply", { token: "DAI" });
add("supply link by address", "/supply", { token: "0x514910771AF9Ca656af840dff83E8264EcF986CA ethereum" });
add("supply usdc solana", "/supply", { token: "USDC on Solana" });
add("supply unknown symbol", "/supply", { token: "NOTATOKEN on ethereum" });

add("tx eth confirmed", "/tx", { tx_hash: ethTx, chain: "ethereum" });
add("tx base confirmed", "/tx", { tx_hash: baseTx, chain: "base" });
if (badTx) add("tx base reverted", "/tx", { tx_hash: badTx, chain: "base" });
add("tx not found", "/tx", { tx_hash: "0x" + "ab".repeat(32), chain: "ethereum" });

for (const id of ["CVE-2021-44228", "CVE-2024-3094", "CVE-2014-0160", "CVE-2023-4863", "CVE-2099-99999"]) add("cve " + id, "/cve", { cve_id: id }, 7000);

const out: Scenario[] = [];
for (const s of scenarios) {
  if (s.delayMs) await sleep(s.delayMs);
  const entries: Record<string, Entry> = {};
  const now = Date.now();
  const app = createApp({ ...ctxFor(recordingFetch(real.fetch, entries), now), now: () => Date.now() });
  // freshness checks compare block time with "now"; replay uses the moment the recording finished
  const r = await app(s.path, new URLSearchParams(s.query));
  out.push({ name: s.name, path: s.path, query: s.query, now: Date.now(), entries, status: r.status, body: r.body });
  console.log(s.name.padEnd(28), r.status, JSON.stringify(r.body).slice(0, 150));
}
writeFileSync(new URL("../test/fixtures/recorded.json", import.meta.url), JSON.stringify(out, null, 1));
console.log("scenarios", out.length);
