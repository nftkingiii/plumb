export interface Chain {
  key: string;
  id: number;
  native: string;
  rpcs: string[];
  aliases: string[];
  /** Coinbase and Kraken spot symbols for the native coin, when both list it. */
  priceSymbol?: string;
  krakenPair?: string;
}

export const CHAINS: Chain[] = [
  { key: "ethereum", id: 1, native: "ETH", priceSymbol: "ETH", krakenPair: "ETHUSD", aliases: ["eth", "ether", "mainnet", "ethereum mainnet", "eth mainnet"],
    rpcs: ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org", "https://rpc.mevblocker.io", "https://eth-mainnet.public.blastapi.io"] },
  { key: "base", id: 8453, native: "ETH", priceSymbol: "ETH", krakenPair: "ETHUSD", aliases: ["base mainnet"],
    rpcs: ["https://base-rpc.publicnode.com", "https://mainnet.base.org", "https://base.drpc.org", "https://1rpc.io/base"] },
  { key: "arbitrum", id: 42161, native: "ETH", priceSymbol: "ETH", krakenPair: "ETHUSD", aliases: ["arbitrum one", "arb", "arb1"],
    rpcs: ["https://arbitrum-one-rpc.publicnode.com", "https://arb1.arbitrum.io/rpc", "https://arbitrum.drpc.org", "https://1rpc.io/arb"] },
  { key: "optimism", id: 10, native: "ETH", priceSymbol: "ETH", krakenPair: "ETHUSD", aliases: ["op", "op mainnet", "optimism mainnet"],
    rpcs: ["https://optimism-rpc.publicnode.com", "https://mainnet.optimism.io", "https://optimism.drpc.org", "https://1rpc.io/op"] },
  { key: "polygon", id: 137, native: "POL", priceSymbol: "POL", krakenPair: "POLUSD", aliases: ["matic", "polygon pos", "pol", "polygon mainnet"],
    rpcs: ["https://polygon-bor-rpc.publicnode.com", "https://polygon.drpc.org", "https://1rpc.io/matic"] },
  { key: "bsc", id: 56, native: "BNB", aliases: ["bnb", "bnb chain", "bnb smart chain", "binance smart chain", "binance chain", "bnb mainnet"],
    rpcs: ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed.bnbchain.org", "https://1rpc.io/bnb"] },
  { key: "avalanche", id: 43114, native: "AVAX", priceSymbol: "AVAX", krakenPair: "AVAXUSD", aliases: ["avax", "avalanche c chain", "avalanche c", "c chain"],
    rpcs: ["https://avalanche-c-chain-rpc.publicnode.com", "https://api.avax.network/ext/bc/C/rpc", "https://avalanche.drpc.org", "https://1rpc.io/avax/c"] },
  { key: "gnosis", id: 100, native: "xDAI", aliases: ["xdai", "gnosis chain"],
    rpcs: ["https://gnosis-rpc.publicnode.com", "https://rpc.gnosischain.com", "https://gnosis.drpc.org"] },
  { key: "linea", id: 59144, native: "ETH", priceSymbol: "ETH", krakenPair: "ETHUSD", aliases: ["linea mainnet"],
    rpcs: ["https://linea-rpc.publicnode.com", "https://rpc.linea.build", "https://linea.drpc.org", "https://1rpc.io/linea"] },
  { key: "scroll", id: 534352, native: "ETH", priceSymbol: "ETH", krakenPair: "ETHUSD", aliases: [],
    rpcs: ["https://scroll-rpc.publicnode.com", "https://rpc.scroll.io", "https://scroll.drpc.org", "https://1rpc.io/scroll"] },
  { key: "zksync", id: 324, native: "ETH", priceSymbol: "ETH", krakenPair: "ETHUSD", aliases: ["zksync era", "zk sync", "zk sync era"],
    rpcs: ["https://mainnet.era.zksync.io", "https://zksync.drpc.org", "https://1rpc.io/zksync2-era"] },
  { key: "celo", id: 42220, native: "CELO", aliases: [],
    rpcs: ["https://forno.celo.org", "https://celo.drpc.org", "https://1rpc.io/celo"] },
  { key: "mantle", id: 5000, native: "MNT", aliases: [],
    rpcs: ["https://rpc.mantle.xyz", "https://mantle-rpc.publicnode.com", "https://mantle.drpc.org"] },
  { key: "sepolia", id: 11155111, native: "ETH", aliases: ["ethereum sepolia", "eth sepolia"],
    rpcs: ["https://ethereum-sepolia-rpc.publicnode.com", "https://1rpc.io/sepolia"] },
  { key: "base-sepolia", id: 84532, native: "ETH", aliases: ["base sepolia", "base testnet"],
    rpcs: ["https://base-sepolia-rpc.publicnode.com", "https://sepolia.base.org"] },
];

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const ALIAS = new Map<string, Chain>();
for (const c of CHAINS) {
  ALIAS.set(norm(c.key), c);
  for (const a of c.aliases) ALIAS.set(norm(a), c);
}

export function findChain(raw: string): Chain | undefined {
  let n = norm(raw);
  const hit = ALIAS.get(n);
  if (hit) return hit;
  n = n.replace(/ (network|chain|mainnet|blockchain)$/g, "").trim();
  return ALIAS.get(n);
}

/** Longest alias found as whole words inside free text, with the text left over. */
export function extractChain(text: string): { chain?: Chain; rest: string } {
  const n = " " + norm(text) + " ";
  let best: { alias: string; chain: Chain } | undefined;
  for (const [alias, chain] of ALIAS) {
    if (n.includes(" " + alias + " ") && (!best || alias.length > best.alias.length)) best = { alias, chain };
  }
  if (!best) return { rest: text };
  return { chain: best.chain, rest: n.replace(" " + best.alias + " ", " ").trim() };
}
