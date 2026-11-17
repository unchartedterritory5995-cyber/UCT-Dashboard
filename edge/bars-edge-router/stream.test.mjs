/**
 * /api/stream/bars at the edge (stream.js): to the stream gateway only when it is switched on and the request
 * is entitled, and back to web on any gateway failure. Driven through the real Worker entry point.
 *
 * Run: node --test   (from edge/bars-edge-router/)
 */
import test from "node:test";
import assert from "node:assert/strict";

import worker from "./worker.js";
import { gatewayOrigin, gatewayShare, routeBarStream } from "./stream.js";

const SECRET = "test-edge-secret";
const GW = "https://stream-gateway-production.up.railway.app";

const b64u = (bytes) => Buffer.from(new Uint8Array(bytes)).toString("base64")
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function mint({ ent = "bars", exp } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { ent, exp: exp ?? now + 900, iat: now, v: 1 };
  const payloadB64 = b64u(new TextEncoder().encode(JSON.stringify(payload, Object.keys(payload).sort())));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `v1.${payloadB64}.${b64u(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64)))}`;
}

/** Run the Worker with a stand-in fetch: `gateway` answers requests to GW, everything else is "web". */
async function ask(path, { cookie = true, env = {}, method = "GET", gateway = () => new Response("gw-stream", { headers: { "content-type": "text/event-stream" } }) } = {}) {
  const headers = { "last-event-id": "abc:7" };
  if (cookie === true) headers.cookie = `uct_session=s; uct_chart_edge=${await mint()}`;
  else if (cookie) headers.cookie = cookie;
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const u = String(input.url || input);
    calls.push({ url: u, cookie: input.headers?.get?.("cookie") || null, lastEventId: input.headers?.get?.("last-event-id") || null });
    if (u.startsWith(GW)) return gateway(input);
    return new Response("web-stream", { headers: { "content-type": "text/event-stream" } });
  };
  try {
    const res = await worker.fetch(new Request("https://uctintelligence.com" + path, { method, headers }),
      { CHART_EDGE_SECRET: SECRET, ...env }, { waitUntil() {} });
    return { res, body: await res.text(), calls };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const ON = { STREAM_GATEWAY_ORIGIN: GW };

test("switched off (no origin): every stream goes to web, untouched", async () => {
  const { body, calls, res } = await ask("/api/stream/bars?bars=SPY:1");
  assert.equal(body, "web-stream");
  assert.deepEqual(calls.map((c) => c.url), ["https://uctintelligence.com/api/stream/bars?bars=SPY:1"]);
  assert.equal(res.headers.get("x-bars-edge"), null);
});

test("switched on: an entitled member's stream goes to the gateway, path, query and headers intact", async () => {
  const { body, calls, res } = await ask("/api/stream/bars?bars=SPY:1,QQQ:5&v=2", { env: ON });
  assert.equal(body, "gw-stream");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, GW + "/api/stream/bars?bars=SPY:1,QQQ:5&v=2");
  assert.match(calls[0].cookie, /uct_chart_edge=/, "the gateway checks the cookie itself");
  assert.equal(calls[0].lastEventId, "abc:7");
  assert.equal(res.headers.get("x-bars-edge"), "stream-gateway");
  assert.equal(res.headers.get("content-type"), "text/event-stream");
});

test("switched on: no cookie, an invalid or expired cookie, or a non-GET goes to web", async () => {
  const expired = await mint({ exp: Math.floor(Date.now() / 1000) - 5 });
  for (const opts of [{ cookie: false }, { cookie: "uct_session=only" }, { cookie: "uct_chart_edge=v1.e30.AAAA" },
    { cookie: `uct_chart_edge=${expired}` }, { cookie: `uct_chart_edge=${await mint({ ent: "service" })}` },
    { method: "POST" }]) {
    const { body, calls } = await ask("/api/stream/bars?bars=SPY:1", { env: ON, ...opts });
    assert.equal(body, "web-stream", JSON.stringify(opts));
    assert.ok(calls.every((c) => !c.url.startsWith(GW)), JSON.stringify(opts));
  }
});

test("switched on: any gateway failure falls back to web in the same request", async () => {
  for (const gateway of [
    () => { throw new TypeError("network down"); },
    () => new Response("feed_not_connected", { status: 503 }),
    () => new Response("boom", { status: 500 }),
    () => new Response("not_entitled", { status: 401 }),
    () => new Response("nope", { status: 404 }),
  ]) {
    const { body, calls } = await ask("/api/stream/bars?bars=SPY:1", { env: ON, gateway });
    assert.equal(body, "web-stream");
    assert.equal(calls.length, 2);
    assert.ok(calls[0].url.startsWith(GW));
    assert.equal(calls[1].url, "https://uctintelligence.com/api/stream/bars?bars=SPY:1");
  }
});

test("the share: 0 sends nobody, a share sends that fraction, an origin that is not https is off", async () => {
  const none = await ask("/api/stream/bars?bars=SPY:1", { env: { ...ON, STREAM_GATEWAY_PCT: "0" } });
  assert.equal(none.body, "web-stream");
  assert.equal(gatewayShare({}), 100);
  assert.equal(gatewayShare({ STREAM_GATEWAY_PCT: "25" }), 25);
  assert.equal(gatewayShare({ STREAM_GATEWAY_PCT: "x" }), 100);
  const yes = async () => true;
  const req = () => new Request("https://uctintelligence.com/api/stream/bars?bars=SPY:1");
  const realFetch = globalThis.fetch;
  const hits = [];
  globalThis.fetch = async (input) => { hits.push(String(input.url || input)); return new Response("ok"); };
  try {
    await routeBarStream(req(), { ...ON, STREAM_GATEWAY_PCT: "25" }, yes, { random: () => 0.10 });   // 10 < 25: gateway
    await routeBarStream(req(), { ...ON, STREAM_GATEWAY_PCT: "25" }, yes, { random: () => 0.60 });   // 60 >= 25: web
  } finally { globalThis.fetch = realFetch; }
  assert.ok(hits[0].startsWith(GW));
  assert.ok(hits[1].startsWith("https://uctintelligence.com/"));
  for (const bad of ["http://stream.example", "stream.example", "https://x.y/path", "javascript:alert(1)", ""]) {
    assert.equal(gatewayOrigin({ STREAM_GATEWAY_ORIGIN: bad }), "", bad);
  }
  assert.equal(gatewayOrigin({ STREAM_GATEWAY_ORIGIN: GW + "/" }), GW);
});

test("only /api/stream/bars is routed: the price stream and other paths are untouched", async () => {
  for (const path of ["/api/stream/prices?tickers=SPY", "/api/stream/status", "/api/stream/bars2", "/api/stream/bars/x"]) {
    const { calls } = await ask(path, { env: ON });
    assert.ok(calls.every((c) => !c.url.startsWith(GW)), path);
  }
});
