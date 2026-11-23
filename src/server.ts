import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createApp } from "./app.ts";

const handle = createApp();
const minerYaml = readFileSync(new URL("../plumb.yaml", import.meta.url));

const LIMIT_PER_MINUTE = Number(process.env.PLUMB_LIMIT_PER_MINUTE ?? 240);
const hits = new Map<string, { count: number; reset: number }>();

function allowed(ip: string): boolean {
  const now = Date.now();
  const hit = hits.get(ip);
  if (!hit || hit.reset < now) {
    if (hits.size > 10_000) hits.clear();
    hits.set(ip, { count: 1, reset: now + 60_000 });
    return true;
  }
  return ++hit.count <= LIMIT_PER_MINUTE;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://plumb");
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method !== "GET") return send(405, { error: "method_not_allowed" });
  if (url.pathname === "/health") return send(200, { status: "ok" });
  if (url.pathname === "/plumb.yaml") {
    res.writeHead(200, { "content-type": "application/yaml" });
    return res.end(minerYaml);
  }
  const forwarded = req.headers["x-real-ip"] ?? req.headers["x-forwarded-for"];
  const raw = (Array.isArray(forwarded) ? forwarded[0] : forwarded) ?? req.socket.remoteAddress ?? "unknown";
  const ip = raw.split(",")[0]!.trim();
  if (!allowed(ip)) return send(429, { error: "rate_limited" });
  const { status, body } = await handle(url.pathname, url.searchParams);
  send(status, body);
});

const port = Number(process.env.PORT ?? 8080);
server.listen(port, process.env.HOST ?? "0.0.0.0", () => console.log(`plumb listening on ${port}`));
