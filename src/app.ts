import { createBalance } from "./balance.ts";
import { createCve } from "./cve.ts";
import { HttpError, type Ctx, type Reply } from "./core.ts";
import { createGas } from "./gas.ts";
import { createSupply } from "./supply.ts";
import { createTx } from "./tx.ts";

export const defaultCtx = (): Ctx => ({
  fetch: (url, init) => fetch(url, init),
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  timeoutMs: 5000,
});

export function createApp(ctx: Ctx = defaultCtx()) {
  const gas = createGas(ctx);
  const balance = createBalance(ctx);
  const supply = createSupply(ctx);
  const tx = createTx(ctx);
  const cve = createCve(ctx);
  const p = (q: URLSearchParams, k: string): string => q.get(k) ?? "";

  const routes: Record<string, (q: URLSearchParams) => Promise<Record<string, unknown>>> = {
    "/gas": (q) => gas(p(q, "chain")),
    "/balance": (q) => balance(p(q, "address"), p(q, "chain"), p(q, "token")),
    "/supply": (q) => supply(p(q, "token")),
    "/tx": (q) => tx(p(q, "tx_hash"), p(q, "chain")),
    "/cve": (q) => cve(p(q, "cve_id")),
  };

  return async function handle(path: string, query: URLSearchParams): Promise<Reply> {
    const route = routes[path];
    if (!route) return { status: 404, body: { error: "not_found" } };
    for (const v of query.values()) {
      if (v.length > 256) return { status: 400, body: { error: "param_too_long", max: 256 } };
    }
    try {
      return { status: 200, body: await route(query) };
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, body: { error: e.code, ...e.extra } };
      return { status: 502, body: { error: "upstream_failure" } };
    }
  };
}
