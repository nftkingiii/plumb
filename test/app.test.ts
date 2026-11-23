import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createApp } from "../src/app.ts";
import { namehash } from "../src/balance.ts";
import { fmtUnits, normalizeAddress, toChecksum } from "../src/core.ts";
import { severityOf } from "../src/cve.ts";
import { decodeSymbol } from "../src/erc20.ts";
import { parseToken } from "../src/supply.ts";
import { extractChain, findChain } from "../src/chains.ts";
import { ctxFor, replayFetch, type Entry, type Scenario } from "./replay.ts";

const recorded: Scenario[] = JSON.parse(readFileSync(new URL("./fixtures/recorded.json", import.meta.url), "utf8"));
const by = (name: string): Scenario => {
  const s = recorded.find((x) => x.name === name);
  assert.ok(s, `no recorded scenario ${name}`);
  return s;
};

async function replay(name: string) {
  const s = by(name);
  const { fetch, misses } = replayFetch(s.entries);
  const app = createApp(ctxFor(fetch, s.now));
  const r = await app(s.path, new URLSearchParams(s.query));
  return { s, r, misses };
}

const strip = (b: Record<string, unknown>) => {
  const { as_of: _a, ...rest } = b;
  return rest;
};

// ---- recorded real responses: replay must reproduce what the live run answered, without any network ----

test("every recorded live scenario replays to the same answer", async () => {
  assert.ok(recorded.length >= 20);
  for (const s of recorded) {
    const { fetch, misses } = replayFetch(s.entries);
    const r = await createApp(ctxFor(fetch, s.now))(s.path, new URLSearchParams(s.query));
    assert.equal(r.status, s.status, s.name);
    assert.deepEqual(strip(r.body), strip(s.body), s.name);
    assert.deepEqual(misses, [], `${s.name} asked for something that was not recorded`);
  }
});

test("gas: ethereum answer is in gwei with the intent fields and three agreeing sources", async () => {
  const { r } = await replay("gas ethereum");
  assert.equal(r.status, 200);
  assert.equal(r.body.chain, "ethereum");
  assert.equal(typeof r.body.gas_price_gwei, "number");
  assert.equal(r.body.gas_price_wei, String(Math.round((r.body.gas_price_gwei as number) * 1e9)));
  assert.ok((r.body.sources as number) >= 2);
  assert.match(String(r.body.as_of), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
});

test("gas: chain names are normalised, unknown chains are refused", async () => {
  assert.equal((await replay("gas arbitrum one")).r.body.chain, "arbitrum");
  assert.equal((await replay("gas bnb")).r.body.chain, "bsc");
  const u = await replay("gas unknown");
  assert.equal(u.r.status, 400);
  assert.equal(u.r.body.error, "unknown_chain");
});

test("balance: ENS name resolves on-chain and the native balance is in whole ETH", async () => {
  const { r } = await replay("balance ens native");
  assert.equal(r.status, 200);
  assert.equal(r.body.address, "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
  assert.equal(r.body.ens_name, "vitalik.eth");
  assert.equal(r.body.token_symbol, "ETH");
  assert.ok((r.body.balance as number) >= 0 && (r.body.balance as number) < 1e9);
});

test("balance: ERC-20 balance applies the token's decimals; a non-token contract is refused", async () => {
  const ok = await replay("balance usdc ethereum");
  assert.equal(ok.r.body.token_symbol, "USDC");
  assert.equal(ok.r.body.token_contract, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
  const bad = await replay("balance not a token");
  assert.equal(bad.r.status, 404);
  assert.equal(bad.r.body.error, "not_an_erc20_contract");
});

test("supply: symbol plus chain, default chain flagged, address form, Solana mint read from two RPCs", async () => {
  assert.equal((await replay("supply usdc base")).r.body.chain, "base");
  const dai = await replay("supply dai no chain");
  assert.equal(dai.r.body.chain, "ethereum");
  assert.equal(dai.r.body.chain_assumed, true);
  assert.equal((await replay("supply link by address")).r.body.total_supply, 1000000000);
  const sol = await replay("supply usdc solana");
  assert.equal(sol.r.body.chain, "solana");
  assert.equal(sol.r.body.sources, 2);
  const unk = await replay("supply unknown symbol");
  assert.equal(unk.r.status, 400);
});

test("tx: confirmed, reverted and not_found come from the receipt, never inferred", async () => {
  const c = await replay("tx eth confirmed");
  assert.equal(c.r.body.status, "confirmed");
  assert.equal(typeof c.r.body.block_number, "number");
  assert.match(String(c.r.body.from), /^0x[0-9a-f]{40}$/);
  const nf = await replay("tx not found");
  assert.equal(nf.r.status, 200);
  assert.equal(nf.r.body.status, "not_found");
  assert.equal(nf.r.body.block_number, undefined);
  if (recorded.some((s) => s.name === "tx base reverted")) assert.equal((await replay("tx base reverted")).r.body.status, "reverted");
});

test("cve: NVD primary score, severity from the score, cve.org cross-check, unknown id is 404", async () => {
  const log4shell = (await replay("cve CVE-2021-44228")).r;
  assert.equal(log4shell.body.cvss_score, 10);
  assert.equal(log4shell.body.severity, "CRITICAL");
  assert.equal(log4shell.body.cross_check, "cve.org_agrees");
  assert.match(String(log4shell.body.published), /^2021-12-10$/);
  assert.ok(Array.isArray(log4shell.body.references) && (log4shell.body.references as unknown[]).length > 0);
  assert.equal((await replay("cve CVE-2014-0160")).r.body.cvss_score, 7.5);
  const missing = await replay("cve CVE-2099-99999");
  assert.equal(missing.r.status, 404);
});

// ---- pure helpers ----

test("severity bands follow the CVSS rating scale", () => {
  assert.deepEqual([0, 0.1, 3.9, 4, 6.9, 7, 8.9, 9, 10].map(severityOf), ["NONE", "LOW", "LOW", "MEDIUM", "MEDIUM", "HIGH", "HIGH", "CRITICAL", "CRITICAL"]);
});

test("units are exact decimals, addresses are checksummed, ENS namehash matches the spec", () => {
  assert.equal(fmtUnits(1n, 18), "0.000000000000000001");
  assert.equal(fmtUnits(1234500000n, 6), "1234.5");
  assert.equal(fmtUnits(0n, 6), "0");
  assert.equal(toChecksum("0xd8da6bf26964af9d7eed9e03e53415d37aa96045"), "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
  assert.throws(() => normalizeAddress("0xd8DA6BF26964aF9D7eEd9e03E53415D37aA96045"));
  assert.equal(namehash("eth"), "93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae");
  assert.equal(namehash("foo.eth"), "de9b09fd7c5f901e23a3f19fecc54828e9c848539801e86591bd9801b019f84f");
});

test("symbol decoding handles string and bytes32 returns", () => {
  const str = "0x" + "20".padStart(64, "0") + "4".padStart(64, "0") + Buffer.from("USDC").toString("hex").padEnd(64, "0");
  assert.equal(decodeSymbol(str), "USDC");
  assert.equal(decodeSymbol("0x" + Buffer.from("MKR").toString("hex").padEnd(64, "0")), "MKR");
  assert.equal(decodeSymbol("0x"), null);
});

test("chain and token free text is parsed without guessing", () => {
  assert.equal(findChain("Ethereum Mainnet")?.key, "ethereum");
  assert.equal(findChain("Arbitrum One")?.key, "arbitrum");
  assert.equal(findChain("dogechain"), undefined);
  assert.equal(extractChain("USDC on Base").chain?.key, "base");
  const eth = findChain("ethereum")!;
  assert.deepEqual(parseToken("USDC on Base", eth).token, "USDC");
  assert.throws(() => parseToken("USDC and DAI", eth));
  assert.throws(() => parseToken("", eth));
});

// ---- fail-closed behaviour on synthetic upstreams (not recorded: these model faults the live run did not show) ----

const hex = (n: number | bigint) => "0x" + BigInt(n).toString(16);
type Handler = (url: string, method: string, params: unknown[]) => unknown | Promise<unknown>;

function fake(handler: Handler, now = 2_000_000_000_000) {
  const f = async (url: string, init?: RequestInit): Promise<Response> => {
    if (typeof init?.body !== "string") return new Response("{}", { status: 404 });
    const j = JSON.parse(init.body);
    const out = await handler(url, j.method, j.params);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: out }), { status: 200 });
  };
  return createApp(ctxFor(f, now));
}
const q = (o: Record<string, string>) => new URLSearchParams(o);
const NOW = 2_000_000_000_000;
const freshBlock = { number: hex(100), timestamp: hex(NOW / 1000 - 5) };

test("fails closed when two sources disagree on a balance", async () => {
  const app = fake((url, m) => {
    if (m === "eth_blockNumber") return hex(100);
    if (m === "eth_getBlockByNumber") return freshBlock;
    if (m === "eth_getBalance") return url.includes("publicnode") ? hex(1000) : hex(2000);
    return null;
  });
  const r = await app("/balance", q({ address: "0x0000000000000000000000000000000000000001", chain: "ethereum", token: "" }));
  assert.equal(r.status, 502);
  assert.equal(r.body.error, "sources_disagree");
  assert.equal(r.body.balance, undefined);
});

test("fails closed when fewer than two sources answer", async () => {
  const app = fake((url, m) => {
    if (!url.includes("publicnode")) return new Response("rate limited", { status: 429 });
    if (m === "eth_blockNumber") return hex(100);
    return null;
  });
  const r = await app("/balance", q({ address: "0x0000000000000000000000000000000000000001", chain: "ethereum", token: "" }));
  assert.equal(r.status, 503);
  assert.equal(r.body.error, "sources_unavailable");
});

test("fails closed on stale chain data", async () => {
  const old = { number: hex(100), timestamp: hex(NOW / 1000 - 3600) };
  const app = fake((_u, m) => (m === "eth_blockNumber" ? hex(100) : m === "eth_getBlockByNumber" ? old : hex(5)));
  const r = await app("/balance", q({ address: "0x0000000000000000000000000000000000000001", chain: "base", token: "" }));
  assert.equal(r.status, 503);
  assert.equal(r.body.error, "chain_data_stale");
  const g = await app("/gas", q({ chain: "base" }));
  assert.equal(g.status, 503);
});

test("gas: sources that differ by more than the tolerance are refused, close ones are answered", async () => {
  const mk = (a: number, b: number) =>
    fake((url, m) => {
      if (m === "eth_getBlockByNumber") return freshBlock;
      if (m === "eth_gasPrice") return hex(url.includes("publicnode") ? a : b);
      return null;
    });
  const far = await mk(1_000_000_000, 3_000_000_000)("/gas", q({ chain: "sepolia" }));
  assert.equal(far.status, 502);
  const near = await mk(1_000_000_000, 1_100_000_000)("/gas", q({ chain: "sepolia" }));
  assert.equal(near.status, 200);
});

test("tx: a node that has not seen the transaction yet does not produce a false not_found", async () => {
  const hash = "0x" + "11".repeat(32);
  const tx = { hash, from: "0x" + "aa".repeat(20), to: "0x" + "bb".repeat(20), value: hex(10n ** 18n) };
  const rc = { transactionHash: hash, status: "0x1", blockNumber: hex(55), blockHash: "0x" + "22".repeat(32), contractAddress: null };
  const app = fake((url, m) => {
    const seen = url.includes("publicnode");
    if (m === "eth_getTransactionByHash") return seen ? tx : null;
    if (m === "eth_getTransactionReceipt") return seen ? rc : null;
    return null;
  });
  const r = await app("/tx", q({ tx_hash: hash, chain: "sepolia" }));
  assert.equal(r.body.status !== "not_found", true);
  // sepolia has two sources: one sees it, one does not, even after the retry -> refuse rather than guess
  assert.equal(r.status, 502);
  assert.equal(r.body.error, "sources_disagree");
});

test("tx: a transaction without a receipt is pending, value converted from wei", async () => {
  const hash = "0x" + "33".repeat(32);
  const tx = { hash, from: "0x" + "aa".repeat(20), to: "0x" + "bb".repeat(20), value: hex(25n * 10n ** 17n) };
  const app = fake((_u, m) => (m === "eth_getTransactionByHash" ? tx : null));
  const r = await app("/tx", q({ tx_hash: hash, chain: "sepolia" }));
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "pending");
  assert.equal(r.body.value_eth, 2.5);
  assert.equal(r.body.block_number, undefined);
});

test("tx: malformed hash and unknown chain are rejected before any request", async () => {
  let calls = 0;
  const app = fake(() => {
    calls++;
    return null;
  });
  assert.equal((await app("/tx", q({ tx_hash: "0x12", chain: "ethereum" }))).status, 400);
  assert.equal((await app("/tx", q({ tx_hash: "0x" + "11".repeat(32), chain: "nochain" }))).status, 400);
  assert.equal(calls, 0);
});

test("balance: bad checksum, non-ASCII ENS and unknown token are refused", async () => {
  let calls = 0;
  const app = fake(() => {
    calls++;
    return null;
  });
  const badSum = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96046";
  assert.equal((await app("/balance", q({ address: badSum, chain: "ethereum", token: "" }))).body.error, "bad_address_checksum");
  assert.equal((await app("/balance", q({ address: "vitalík.eth", chain: "ethereum", token: "" }))).status, 400);
  assert.equal((await app("/balance", q({ address: "0x" + "00".repeat(20), chain: "ethereum", token: "FAKECOIN" }))).body.error, "unknown_token");
  assert.equal(calls, 0);
});

test("cve: bad ids are rejected; NVD rate limiting falls back only when the CVE record is unambiguous", async () => {
  const mkFetch = (nvdStatus: number, scores: number[]) =>
    createApp(
      ctxFor(async (url) => {
        if (url.includes("nvd.nist.gov")) return new Response("{}", { status: nvdStatus });
        const metrics = scores.map((s) => ({ cvssV3_1: { baseScore: s } }));
        return new Response(JSON.stringify({ cveMetadata: { cveId: "CVE-2024-0001", state: "PUBLISHED", datePublished: "2024-01-02T00:00:00Z" }, containers: { cna: { metrics: [metrics[0]].filter(Boolean), descriptions: [{ lang: "en", value: "d" }] }, adp: metrics.slice(1).length ? [{ metrics: metrics.slice(1) }] : [] } }), { status: 200 });
      }, NOW),
    );
  assert.equal((await mkFetch(200, [5])("/cve", q({ cve_id: "nope" }))).status, 400);
  const agree = await mkFetch(403, [7.5, 7.5])("/cve", q({ cve_id: "CVE-2024-0001" }));
  assert.equal(agree.status, 200);
  assert.equal(agree.body.cvss_score, 7.5);
  assert.equal(agree.body.cross_check, "nvd_unavailable_cve.org_only");
  const conflict = await mkFetch(403, [7.5, 9.8])("/cve", q({ cve_id: "CVE-2024-0001" }));
  assert.equal(conflict.status, 502);
  assert.equal(conflict.body.cvss_score, undefined);
});

test("unknown routes and over-long parameters are refused", async () => {
  const app = createApp(ctxFor(async () => new Response("{}"), NOW));
  assert.equal((await app("/nope", q({}))).status, 404);
  assert.equal((await app("/gas", q({ chain: "x".repeat(300) }))).status, 400);
});

test("unrecorded network access is a miss, not a silent pass", async () => {
  const { fetch, misses } = replayFetch({} as Record<string, Entry>);
  const r = await createApp(ctxFor(fetch, NOW))("/gas", q({ chain: "ethereum" }));
  assert.equal(r.status, 503);
  assert.ok(misses.length > 0);
});

// ---- registration YAML ----

import { parse } from "yaml";

test("plumb.yaml: intents, endpoints and mapped output paths line up with what the service really returns", async () => {
  const y = parse(readFileSync(new URL("../plumb.yaml", import.meta.url), "utf8"));
  const intents = Object.keys(y.intent_mapping).sort();
  assert.deepEqual(intents, [...y.semantics.supported_intents].sort());
  for (const e of y.endpoints) for (const i of e.intents) assert.ok(intents.includes(i), i);
  const sample: Record<string, string> = {
    GAS_PRICE_GENERAL: "gas ethereum",
    WALLET_BALANCE_CHECK_GENERAL: "balance usdc ethereum",
    TOKEN_TOTAL_SUPPLY_VERIFY_GENERAL: "supply usdc ethereum",
    ONCHAIN_TX_LOOKUP_GENERAL: "tx eth confirmed",
    CVE_LOOKUP_CVSS: "cve CVE-2021-44228",
  };
  for (const [intent, m] of Object.entries<any>(y.intent_mapping)) {
    const ep = y.endpoints.find((e: any) => e.path === m.endpoint);
    assert.ok(ep, `${intent} endpoint ${m.endpoint}`);
    const body = (await replay(sample[intent]!)).r.body;
    for (const [field, spec] of Object.entries<any>(m.output)) assert.ok(spec.path in body, `${intent}.${field} -> ${spec.path} missing from the answer`);
    const declared = [...(ep.params.query.required ?? []), ...(ep.params.query.optional ?? [])].map((p: any) => p.name);
    for (const [param, spec] of Object.entries<any>(m.input)) {
      assert.ok(declared.includes(param), `${intent} input ${param} not a declared param`);
      assert.ok(["chain", "address", "token", "tx_hash", "cve_id"].includes(spec.from), `${intent} input ${param} reads ${spec.from}`);
    }
  }
});
