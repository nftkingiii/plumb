# Plumb sources, terms and limits

Everything is keyless. Terms below are from each provider's published policy as recalled when this was written;
none was re-fetched, so re-read them before any public launch. Rate limits marked "observed" were seen in testing.

| Source | Used for | Terms / licence | Rate limit |
|---|---|---|---|
| PublicNode (publicnode.com) JSON-RPC, all EVM chains and Solana | gas, balances, supply, tx | Free public endpoints, no key, fair use | Not published. Solana indexed methods (getTokenSupply) need a token (observed), so Plumb reads the mint account with getAccountInfo |
| dRPC public endpoints (*.drpc.org) | second/third RPC | Free public tier | Observed: "public endpoint rate limit" on BSC, and some chains are paid-only (Sepolia, Blast), so those are not used |
| 1RPC free tier (1rpc.io) | extra RPC where others are scarce | Free tier, privacy-focused relay | Per-IP limits, HTML limit page seen on Ethereum (observed), so not used there |
| Chain-operator RPCs: mainnet.base.org, arb1.arbitrum.io, mainnet.optimism.io, bsc-dataseed.bnbchain.org, api.avax.network, rpc.gnosischain.com, rpc.linea.build, rpc.scroll.io, mainnet.era.zksync.io, forno.celo.org, rpc.mantle.xyz, sepolia.base.org | independent second source | Provided for public use, not for heavy production traffic | Rate limited, not published per endpoint |
| MEV Blocker (rpc.mevblocker.io), Blast API public (eth-mainnet.public.blastapi.io) | Ethereum RPC | Free public endpoints | Not published |
| Solana Foundation RPC (api.mainnet-beta.solana.com) | Solana mint read | Public endpoint, not for production load | Published per-IP limits (about 100 requests per 10 s) |
| NVD CVE API 2.0 (services.nvd.nist.gov) | CVSS base score, description, references | NIST NVD data is US government work, free to use, attribution requested | 5 requests per rolling 30 s without a key. Plumb budgets 4 per 30 s, caches answers for 1 h, and falls back to the CVE.org record only when its scores agree |
| CVE.org / CVE Services (cveawg.mitre.org) | cross-check, fallback | CVE Program terms of use: free, royalty-free licence to use CVE records | Not published |
| Coinbase public spot price API (api.coinbase.com/v2/prices) | native coin USD price for transfer_fee_usd | Public market-data endpoint, no key | Public data limits (about 10,000 per hour per IP) |
| Kraken public ticker (api.kraken.com/0/public/Ticker) | second price for the same field | Public market-data endpoint, no key | Public endpoints are call-rate limited per IP |

Plumb's own limit: 240 requests per minute per client IP (PLUMB_LIMIT_PER_MINUTE), 5 s upstream timeout,
answers cached 4 to 10 s (balances, gas, supply, tx), 1 h (CVE).
