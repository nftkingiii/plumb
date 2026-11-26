import assert from "node:assert/strict";
import { test } from "node:test";
import { requestLine } from "../src/log.ts";

test("request log line is greppable JSON with the fixed fields", () => {
  const line = requestLine({
    at: new Date("2026-11-26T04:30:00Z"),
    route: "/gas",
    query: new URLSearchParams({ chain: "ethereum" }),
    status: 400,
    error: "unknown_chain",
    ms: 12.4,
    ip: "13.237.89.59",
  });
  assert.ok(line.startsWith("req {"));
  assert.ok(!line.includes("\n"));
  assert.deepEqual(JSON.parse(line.slice(4)), {
    ts: "2026-11-26T04:30:00.000Z",
    route: "/gas",
    query: { chain: "ethereum" },
    status: 400,
    error: "unknown_chain",
    ms: 12,
    ip: "13.237.89.59",
  });
});

test("request log truncates values to 200 characters, bounds parameters and stays on one line", () => {
  const query = new URLSearchParams({ address: "x".repeat(500), note: "a\nb\r\nc" });
  for (let i = 0; i < 40; i++) query.append(`p${i}`, "v");
  const line = requestLine({ at: new Date(0), route: "/balance", query, status: 200, ms: 1, ip: "::1" });
  assert.ok(!/[\r\n]/.test(line));
  const parsed = JSON.parse(line.slice(4));
  assert.equal(parsed.query.address.length, 200);
  assert.ok(Object.keys(parsed.query).length <= 20);
  assert.equal(parsed.error, undefined);
});
