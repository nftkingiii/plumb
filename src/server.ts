import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { createApp } from "./app.ts";
import { requestLine } from "./log.ts";

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

function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-real-ip"] ?? req.headers["x-forwarded-for"];
  const raw = (Array.isArray(forwarded) ? forwarded[0] : forwarded) ?? req.socket.remoteAddress ?? "unknown";
  return raw.split(",")[0]!.trim();
}

const server = createServer(async (req, res) => {
  const started = performance.now();
  const url = new URL(req.url ?? "/", "http://plumb");
  const ip = clientIp(req);
  let status = 0;
  let error: string | undefined;
  const send = (code: number, body: unknown) => {
    status = code;
    if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
      error = (body as { error: string }).error;
    }
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  try {
    if (req.method !== "GET") return send(405, { error: "method_not_allowed" });
    if (url.pathname === "/health") return send(200, { status: "ok" });
    if (url.pathname === "/plumb.yaml") {
      status = 200;
      res.writeHead(200, { "content-type": "application/yaml" });
      return res.end(minerYaml);
    }
    if (!allowed(ip)) return send(429, { error: "rate_limited" });
    const reply = await handle(url.pathname, url.searchParams);
    send(reply.status, reply.body);
  } catch {
    if (!res.headersSent) send(500, { error: "internal_error" });
  } finally {
    console.log(
      requestLine({ at: new Date(), route: url.pathname, query: url.searchParams, status, error, ms: performance.now() - started, ip }),
    );
  }
});

const port = Number(process.env.PORT ?? 8080);
server.listen(port, process.env.HOST ?? "0.0.0.0", () => console.log(`plumb listening on ${port}`));
