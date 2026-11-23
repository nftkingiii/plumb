// Probe candidate public RPCs: eth_chainId, eth_blockNumber, eth_gasPrice, latency.
const chains = {
  ethereum: [1, ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org", "https://1rpc.io/eth", "https://cloudflare-eth.com", "https://eth.llamarpc.com", "https://rpc.mevblocker.io", "https://eth-mainnet.public.blastapi.io"]],
  base: [8453, ["https://base-rpc.publicnode.com", "https://mainnet.base.org", "https://base.drpc.org", "https://1rpc.io/base", "https://base.llamarpc.com"]],
  arbitrum: [42161, ["https://arbitrum-one-rpc.publicnode.com", "https://arb1.arbitrum.io/rpc", "https://arbitrum.drpc.org", "https://1rpc.io/arb"]],
  optimism: [10, ["https://optimism-rpc.publicnode.com", "https://mainnet.optimism.io", "https://optimism.drpc.org", "https://1rpc.io/op"]],
  polygon: [137, ["https://polygon-bor-rpc.publicnode.com", "https://polygon-rpc.com", "https://polygon.drpc.org", "https://1rpc.io/matic"]],
  bsc: [56, ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed.bnbchain.org", "https://bsc.drpc.org", "https://1rpc.io/bnb"]],
  avalanche: [43114, ["https://avalanche-c-chain-rpc.publicnode.com", "https://api.avax.network/ext/bc/C/rpc", "https://avalanche.drpc.org", "https://1rpc.io/avax/c"]],
  gnosis: [100, ["https://gnosis-rpc.publicnode.com", "https://rpc.gnosischain.com", "https://gnosis.drpc.org", "https://1rpc.io/gnosis"]],
  linea: [59144, ["https://linea-rpc.publicnode.com", "https://rpc.linea.build", "https://linea.drpc.org", "https://1rpc.io/linea"]],
  scroll: [534352, ["https://scroll-rpc.publicnode.com", "https://rpc.scroll.io", "https://scroll.drpc.org", "https://1rpc.io/scroll"]],
  zksync: [324, ["https://mainnet.era.zksync.io", "https://zksync.drpc.org", "https://1rpc.io/zksync2-era"]],
  celo: [42220, ["https://forno.celo.org", "https://celo.drpc.org", "https://1rpc.io/celo"]],
  mantle: [5000, ["https://rpc.mantle.xyz", "https://mantle-rpc.publicnode.com", "https://mantle.drpc.org", "https://1rpc.io/mantle"]],
  blast: [81457, ["https://rpc.blast.io", "https://blast-rpc.publicnode.com", "https://blast.drpc.org"]],
  sepolia: [11155111, ["https://ethereum-sepolia-rpc.publicnode.com", "https://sepolia.drpc.org", "https://1rpc.io/sepolia"]],
  basesepolia: [84532, ["https://base-sepolia-rpc.publicnode.com", "https://sepolia.base.org", "https://base-sepolia.drpc.org"]],
};
async function rpc(url, method, params = []) {
  const t = Date.now();
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    return { ms: Date.now() - t, result: j.result, error: j.error ? (j.error.message ?? "err").slice(0, 60) : undefined, http: r.status };
  } catch (e) { return { ms: Date.now() - t, error: String(e.message ?? e).slice(0, 60) }; }
}
for (const [name, [id, urls]] of Object.entries(chains)) {
  for (const u of urls) {
    const c = await rpc(u, "eth_chainId");
    const g = await rpc(u, "eth_gasPrice");
    const b = await rpc(u, "eth_blockNumber");
    console.log(name.padEnd(12), u.padEnd(52), c.error ? "ERR " + c.error : (parseInt(c.result, 16) === id ? "id ok" : "ID MISMATCH " + c.result), "gas", g.result ? Number(BigInt(g.result)) / 1e9 : g.error, "blk", b.result ? parseInt(b.result, 16) : b.error, c.ms + "ms");
  }
}
