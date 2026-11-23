// Live smoke: node scripts/smoke.mjs http://127.0.0.1:PORT
// Calls every endpoint on a running Plumb and compares with independent sources (Blockscout, CIRCL, other RPCs).
const base = process.argv[2];
const J = async (url, init) => {
  const t = Date.now();
  let r, text;
  try { r = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) }); text = await r.text(); } catch (e) { return { status: 0, json: null, ms: Date.now() - t }; }
  let j = null;
  try { j = JSON.parse(text); } catch {}
  return { status: r.status, json: j, ms: Date.now() - t };
};
const P = async (path, q) => J(`${base}${path}?${new URLSearchParams(q)}`);
const rpc = async (url, method, params = []) => (await J(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json?.result;
const line = (k, v) => console.log(k.padEnd(34), v);
const lat = [];

// GAS: compare with RPCs that are not in Plumb's list
for (const [chain, other] of [["ethereum", ["https://rpc.flashbots.net", "https://eth.merkle.io"]], ["base", ["https://base.meowrpc.com", "https://base-mainnet.public.blastapi.io"]], ["polygon", ["https://polygon-mainnet.public.blastapi.io", "https://polygon.meowrpc.com"]], ["arbitrum", ["https://arbitrum.meowrpc.com", "https://arbitrum-one.public.blastapi.io"]]]) {
  const r = await P("/gas", { chain }); lat.push(r.ms);
  let indep = null, src = "";
  for (const u of other) { try { const g = await rpc(u, "eth_gasPrice"); if (g) { indep = Number(BigInt(g)) / 1e9; src = u; break; } } catch {} }
  line(`gas ${chain} (${r.ms}ms)`, `plumb ${r.json?.gas_price_gwei} gwei, fee $${r.json?.transfer_fee_usd}; independent ${indep} gwei (${src.replace("https://", "")}); status ${r.status}`);
}

// Independent RPCs that are not in Plumb's source lists
const IND = { ethereum: ["https://rpc.flashbots.net", "https://eth.merkle.io"], base: ["https://base.meowrpc.com", "https://base-mainnet.public.blastapi.io"] };
const indep = async (chain, method, params) => { for (const u of IND[chain]) { try { const r = await rpc(u, method, params); if (r !== undefined && r !== null) return { r, u }; } catch {} } return { r: null, u: "" }; };
const pad = (a) => a.slice(2).toLowerCase().padStart(64, "0");
const V = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
{
  const r = await P("/balance", { address: "vitalik.eth", chain: "ethereum", token: "" }); lat.push(r.ms);
  const i = await indep("ethereum", "eth_getBalance", [V, "latest"]);
  line(`balance vitalik.eth ETH (${r.ms}ms)`, `plumb ${r.json?.balance} @block ${r.json?.block_number}; independent ${i.r ? Number(BigInt(i.r)) / 1e18 : "n/a"} (${i.u.replace("https://", "")})`);
}
{
  const r = await P("/balance", { address: V, chain: "base", token: "" }); lat.push(r.ms);
  const i = await indep("base", "eth_getBalance", [V, "latest"]);
  line(`balance base ETH (${r.ms}ms)`, `plumb ${r.json?.balance}; independent ${i.r ? Number(BigInt(i.r)) / 1e18 : "n/a"} (${i.u.replace("https://", "")})`);
}
{
  const r = await P("/balance", { address: V, chain: "ethereum", token: "USDC" }); lat.push(r.ms);
  const i = await indep("ethereum", "eth_call", [{ to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", data: "0x70a08231" + pad(V) }, "latest"]);
  line(`balance USDC (${r.ms}ms)`, `plumb ${r.json?.balance}; independent ${i.r ? Number(BigInt(i.r)) / 1e6 : "n/a"}`);
}
for (const [tok, chain, addr, dec] of [["USDC on Ethereum", "ethereum", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6], ["USDC on Base", "base", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", 6], ["LINK", "ethereum", "0x514910771AF9Ca656af840dff83E8264EcF986CA", 18]]) {
  const r = await P("/supply", { token: tok }); lat.push(r.ms);
  const i = await indep(chain, "eth_call", [{ to: addr, data: "0x18160ddd" }, "latest"]);
  line(`supply ${tok} (${r.ms}ms)`, `plumb ${r.json?.total_supply}; independent ${i.r ? Number(BigInt(i.r)) / 10 ** dec : "n/a"}`);
}
{
  const r = await P("/supply", { token: "USDC on Solana" }); lat.push(r.ms);
  const s = await rpc("https://api.mainnet-beta.solana.com", "getTokenSupply", ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", { commitment: "finalized" }]);
  line(`supply USDC Solana (${r.ms}ms)`, `plumb ${r.json?.total_supply}; solana getTokenSupply ${s?.value?.uiAmountString}`);
}
for (const chain of ["ethereum", "base"]) {
  const node = chain === "base" ? "https://base-rpc.publicnode.com" : "https://ethereum-rpc.publicnode.com";
  const head = await rpc(node, "eth_getBlockByNumber", ["latest", false]);
  const n = Number(BigInt(head.number)) - 6;
  const old = await rpc(node, "eth_getBlockByNumber", ["0x" + n.toString(16), false]);
  const h = old.transactions[1] ?? old.transactions[0];
  const r = await P("/tx", { tx_hash: h, chain }); lat.push(r.ms);
  const i = await indep(chain, "eth_getTransactionReceipt", [h]);
  const t = await indep(chain, "eth_getTransactionByHash", [h]);
  line(`tx ${chain} (${r.ms}ms)`, `plumb ${r.json?.status} block ${r.json?.block_number} value ${r.json?.value_eth} from ${r.json?.from?.slice(0, 10)}; independent ${i.r?.status === "0x1" ? "confirmed" : i.r?.status} block ${i.r ? parseInt(i.r.blockNumber, 16) : "n/a"} value ${t.r ? Number(BigInt(t.r.value)) / 1e18 : "n/a"} from ${t.r?.from?.slice(0, 10)}`);
}
{
  const r = await P("/tx", { tx_hash: "0x" + "cd".repeat(32), chain: "base" }); lat.push(r.ms);
  line(`tx unknown hash (${r.ms}ms)`, JSON.stringify(r.json));
}

// CVE: CIRCL vulnerability-lookup as the independent view
for (const id of ["CVE-2021-44228", "CVE-2024-3094", "CVE-2017-0144"]) {
  const r = await P("/cve", { cve_id: id }); lat.push(r.ms);
  const c = await J(`https://vulnerability.circl.lu/api/cve/${id}`);
  const txt = JSON.stringify(c.json ?? {});
  const scores = [...txt.matchAll(/"baseScore":\s*([0-9.]+)/g)].map((m) => m[1]);
  line(`cve ${id} (${r.ms}ms)`, `plumb ${r.json?.cvss_score} ${r.json?.severity} (${r.json?.cvss_version}, ${r.json?.cross_check}); circl baseScores ${[...new Set(scores)].join(",") || "n/a"}`);
  await new Promise((s) => setTimeout(s, 3000));
}

// fail-closed probes
for (const [name, path, q] of [["unknown chain", "/gas", { chain: "dogechain" }], ["bad checksum", "/balance", { address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96046", chain: "ethereum", token: "" }], ["unknown token", "/supply", { token: "FAKEUSD on base" }], ["bad hash", "/tx", { tx_hash: "0x12", chain: "ethereum" }], ["no such CVE", "/cve", { cve_id: "CVE-2099-99999" }]]) {
  const r = await P(path, q);
  line(`closed: ${name}`, `${r.status} ${JSON.stringify(r.json).slice(0, 110)}`);
}
// cache hit latency
const c1 = await P("/gas", { chain: "ethereum" }); const c2 = await P("/gas", { chain: "ethereum" });
line("gas cached repeat", `${c1.ms}ms then ${c2.ms}ms`);
lat.sort((a, b) => a - b);
line("latency cold (ms)", `n=${lat.length} median ${lat[Math.floor(lat.length / 2)]} p90 ${lat[Math.floor(lat.length * 0.9)]} max ${lat[lat.length - 1]}`);
// rate limit
let limited = 0, ok = 0;
for (let i = 0; i < 70; i++) { const r = await J(`${base}/gas?chain=ethereum`); if (r.status === 429) limited++; else ok++; }
line("rate limit (70 rapid cached /gas)", `${ok} ok, ${limited} limited (429)`);
const y = await fetch(`${base}/plumb.yaml`); line("yaml", `${y.status} ${y.headers.get("content-type")} ${(await y.text()).length} bytes`);
