/**
 * The entitled /api/bars tail, shared at the edge for a few seconds (tail.js, `BarsTail` behind Workers
 * Cache). The entrypoint runs behind a stand-in that keeps exactly what Workers Cache keeps
 * (__fixtures__/workers_cache.mjs), so "was it kept?" is asked by asking twice and counting tier calls.
 *
 * Run: node --test   (from edge/bars-edge-router/)
 */
import test from "node:test";
import assert from "node:assert/strict";

import worker, { TIER_BREAKER, BARS_HISTORY_REV_HEDGE_MS, isDeliberateTierShed as workerShed } from "./worker.js";
import {
  serveTail, readTail, tailCachePlan, tailAnswerCacheable, TAIL_ENTRY, TAIL_TTL_S, BARS_TIER_ORIGIN,
  TAIL_TIER_TIMEOUT_MS, TIER_FAILED, isDeliberateTierShed,
} from "./tail.js";
import { cachedEntry } from "./__fixtures__/workers_cache.mjs";

const SECRET = "test-edge-secret";
const b64u = (bytes) => Buffer.from(new Uint8Array(bytes)).toString("base64")
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function mint({ ent = "bars" } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { ent, exp: now + 900, iat: now, v: 1 };
  const payloadB64 = b64u(new TextEncoder().encode(JSON.stringify(payload, Object.keys(payload).sort())));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `v1.${payloadB64}.${b64u(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64)))}`;
}

const GOOD = { ticker: "KLIC", tf: "D", bars: [{ t: "2026-11-27", o: 60.4, h: 60.8, l: 57.26, c: 59.58, v: 315361 }],
  contract: 1, history_rev: 1795641800000, series_rev: 1795826249126 };

/** The tier: answers every URL with `answer(url)` ({status, body, headers}) and records what it was sent. */
function tier(answer = () => ({ status: 200, body: GOOD })) {
  const calls = [];
  const impl = async (u, init = {}) => {
    calls.push({ url: String(u), headers: new Headers(init.headers || {}) });
    const a = answer(String(u));
    if (a instanceof Error) throw a;
    return new Response(typeof a.body === "string" ? a.body : JSON.stringify(a.body), {
      status: a.status, headers: { "content-type": "application/json", "x-railway-request-id": "req-1", ...(a.headers || {}) },
    });
  };
  return { calls, impl };
}

/** The production shape: ctx.exports.BarsTail is serveTail behind Workers Cache, on one clock. */
function rig({ answer, clock = { t: Date.now() }, ignoreMaxAge = false, entry } = {}) {
  const t = tier(answer);
  const now = () => clock.t;
  const env = { CHART_EDGE_SECRET: SECRET };
  const tail = entry || cachedEntry((req) => serveTail(req, env, { fetchImpl: t.impl, now }), { now, ignoreMaxAge });
  const ctx = { waitUntil() {}, exports: { [TAIL_ENTRY]: tail } };
  return { env, ctx, tail, tier: t, clock, now };
}

/** A member (or anonymous) request through the routed Worker; the old path's origin calls are recorded. */
async function ask(path, r, { cookie = true, method = "GET" } = {}) {
  const h = {};
  if (cookie === true) h.cookie = `uct_session=abc; uct_chart_edge=${await mint()}`;
  else if (cookie) h.cookie = cookie;
  const realFetch = globalThis.fetch;
  const realNow = Date.now;
  const origins = [];
  globalThis.fetch = async (u) => { origins.push(String(u.url || u)); return new Response('{"bars":[]}', { status: 200 }); };
  Date.now = r.now;
  try {
    const res = await worker.fetch(new Request("https://uctintelligence.com" + path, { method, headers: h }), r.env, r.ctx);
    return { res, origins };
  } finally {
    globalThis.fetch = realFetch;
    Date.now = realNow;
  }
}

test.beforeEach(() => TIER_BREAKER.reset());

test("⛔ an unentitled /api/bars read never reaches the shared copy and takes exactly the old path", async () => {
  const r = rig();
  await ask("/api/bars/KLIC?tf=D&bars=2000", r);                     // an entitled read fills the copy
  assert.equal(r.tail.log.requests.length, 1);
  for (const cookie of [false, "uct_session=abc", "uct_chart_edge=v1.forged.sig"]) {
    const { res, origins } = await ask("/api/bars/KLIC?tf=D&bars=2000", r, { cookie });
    assert.equal(r.tail.log.requests.length, 1, `the copy was asked for ${cookie}`);
    assert.equal(origins.length, 1, "the old path asked the tier itself");
    assert.ok(origins[0].startsWith(BARS_TIER_ORIGIN + "/api/bars/KLIC"), origins[0]);
    assert.notEqual(res.headers.get("x-bars-edge"), "tail-cache");
  }
});

test("an entitled read fills the copy, the next within the TTL is a hit, and the browser never caches it", async () => {
  const r = rig();
  const a = await ask("/api/bars/KLIC?tf=D&bars=2000", r);
  assert.equal(a.res.status, 200);
  assert.equal(a.res.headers.get("x-bars-edge"), "tail-fill");
  assert.equal(a.res.headers.get("cache-control"), "no-store, must-revalidate");
  assert.deepEqual(a.origins, [], "the routed Worker asked no origin itself");
  r.clock.t += 2000;
  const b = await ask("/api/bars/KLIC?bars=2000&tf=D", r);               // same query, other order: one copy
  assert.equal(b.res.headers.get("x-bars-edge"), "tail-cache");
  assert.equal(b.res.headers.get("x-tail-age-ms"), "2000");
  assert.equal(b.res.headers.get("cache-control"), "no-store, must-revalidate");
  assert.equal(r.tier.calls.length, 1, "the tier was asked once for two reads");
  assert.deepEqual(await b.res.json(), GOOD);
  // past max-age, inside the TTL: the copy is still served and ONE refresh runs behind it
  r.clock.t += 2000;
  const c = await ask("/api/bars/KLIC?tf=D&bars=2000", r);
  assert.equal(c.res.headers.get("x-bars-edge"), "tail-cache");
  assert.equal(c.res.headers.get("x-tail-age-ms"), "4000");
  assert.equal(r.tier.calls.length, 2, "one background refresh");
  // a full TTL after that refresh, the copy is gone and the read fills it again
  r.clock.t += TAIL_TTL_S.D * 1000;
  const d = await ask("/api/bars/KLIC?tf=D&bars=2000", r);
  assert.equal(d.res.headers.get("x-bars-edge"), "tail-fill");
  assert.equal(r.tier.calls.length, 3);
});

test("⭐ 500 members on one symbol: about one tier read per key per max-age, and no copy older than the TTL", async () => {
  const r = rig();
  const ages = [];
  // 500 members open the same chart at the same moment, then keep re-reading it every 100 ms for 10 s
  for (let i = 0; i < 500; i++) await ask("/api/bars/NVDA?tf=D&bars=2000", r);
  assert.equal(r.tier.calls.length, 1, "500 simultaneous reads, one tier read");
  for (let step = 0; step < 100; step++) {
    r.clock.t += 100;
    const { res } = await ask("/api/bars/NVDA?tf=D&bars=2000", r);
    ages.push(Number(res.headers.get("x-tail-age-ms") || 0));
  }
  const maxAge = TAIL_TTL_S.D - 2;
  assert.ok(r.tier.calls.length <= Math.ceil(10 / maxAge) + 1, `tier reads in 10 s: ${r.tier.calls.length}`);
  assert.ok(Math.max(...ages) <= TAIL_TTL_S.D * 1000, `oldest copy served: ${Math.max(...ages)} ms`);
});

test("⛔ a 401/403/404/5xx from the tier is never kept: each read asks again", async () => {
  for (const status of [401, 403, 404, 500, 503]) {
    const r = rig({ answer: () => ({ status, body: { error: "x" } }) });
    for (let i = 0; i < 2; i++) {
      TIER_BREAKER.reset();
      const { res, origins } = await ask("/api/bars/KLIC?tf=D&bars=2000", r);
      assert.notEqual(res.headers.get("x-bars-edge"), "tail-cache");
      if (status < 500) {
        // the tier ANSWERED: handed over exactly as the old path would, without asking it a second time
        assert.equal(res.status, status);
        assert.deepEqual(origins, [], `${status}: asked again`);
      } else {
        // a tier FAILURE: breaker open, web asked, the tier never asked twice for one read
        assert.equal(origins.length, 1);
        assert.ok(origins[0].startsWith("https://web-production"), origins[0]);
      }
    }
    assert.equal(r.tail.store.size, 0, `${status} was kept`);
    assert.equal(r.tier.calls.length, 2, `${status}: the copy's tier ask ran every time`);
  }
});

test("⭐ a tier the copy could not read is a tier FAILURE: the breaker opens and web answers, never a second tier wait", async () => {
  const r = rig({ answer: () => new Error("aborted after the hedge") });
  const { res, origins } = await ask("/api/bars/KLIC?tf=D&bars=2000", r);
  assert.equal(res.status, 200);
  assert.equal(origins.length, 1, "exactly one more ask");
  assert.ok(origins[0].startsWith("https://web-production"), `went to ${origins[0]}`);
  assert.equal(res.headers.get("x-bars-edge"), "web-breaker");
  assert.ok(TIER_BREAKER.isOpen(true), "the breaker is open for the reads behind it");
  assert.equal(TAIL_TIER_TIMEOUT_MS, BARS_HISTORY_REV_HEDGE_MS, "the copy waits exactly the old path's hedge");
});

test("a deliberate tier shed (503 warming + Retry-After) is the tier's answer, handed over, never kept", async () => {
  const r = rig({ answer: () => ({ status: 503, body: { error: "warming", warming: true },
    headers: { "retry-after": "3", "x-bars-shed": "warming" } }) });
  const { res, origins } = await ask("/api/bars/KLIC?tf=1&bars=1152", r);
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("retry-after"), "3");
  assert.equal(res.headers.get("x-bars-shed"), "warming");
  assert.deepEqual(origins, []);
  assert.equal(TIER_BREAKER.isOpen(), false, "an answer is not a failure");
  assert.equal(r.tail.store.size, 0);
  assert.equal(workerShed, isDeliberateTierShed, "one rule, re-exported by worker.js");
});

test("⛔ a tier answer can never carry the copy's own markers past the gateway", async () => {
  const r = rig({ answer: () => ({ status: 200, body: GOOD,
    headers: { "x-tail-pass": "1", "x-tail-filled": "1", "x-tail-tier-failed": "1", "x-tail-age-ms": "0" } }) });
  const { res } = await ask("/api/bars/KLIC?tf=D&bars=2000", r);
  assert.equal(res.headers.get("x-bars-edge"), "tail-fill", "a spoofed x-tail-pass would have skipped the TTL check");
  assert.equal(res.headers.get("x-tail-tier-failed"), null);
  assert.ok(Number(res.headers.get("x-tail-filled")) > 1);
});

test("⛔ no_data, an unverified tail, an empty series, Retry-After or Set-Cookie are never kept (served as the tier's answer)", async () => {
  const cases = [
    { status: 200, body: { ticker: "ZZZ", tf: "D", bars: [], no_data: true, reason: "symbol_not_carried" } },
    { status: 200, body: { ...GOOD, no_data: true, reason: "no_provider_data" } },          // no_data alone decides
    { status: 200, body: { ...GOOD, tail_status: "unverified" }, headers: { "retry-after": "2" } },
    { status: 200, body: { ...GOOD, tail_status: "unverified" } },
    { status: 200, body: { ...GOOD, bars: [] } },
    { status: 200, body: GOOD, headers: { "retry-after": "3" } },
    { status: 200, body: GOOD, headers: { "set-cookie": "a=b" } },
    { status: 200, body: { ...GOOD, error: "transient" } },
    { status: 200, body: "not json" },
  ];
  for (const a of cases) {
    const r = rig({ answer: () => a });
    for (let i = 0; i < 2; i++) {
      const { res } = await ask("/api/bars/ZZZ?tf=D&bars=2000", r);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("x-bars-edge"), "tier", JSON.stringify(a));
      assert.equal(res.headers.get("cache-control"), "no-store, must-revalidate");
      assert.equal(res.headers.get("set-cookie"), null);
    }
    assert.equal(r.tail.store.size, 0, JSON.stringify(a));
    assert.equal(r.tier.calls.length, 2);
  }
});

test("⛔ never older than the TTL: a copy the cache hands back past its TTL is refused and the old path runs", async () => {
  const r = rig({ ignoreMaxAge: true });
  await ask("/api/bars/KLIC?tf=5&bars=1152", r);
  r.clock.t += TAIL_TTL_S["5"] * 1000 + 1;
  const { res, origins } = await ask("/api/bars/KLIC?tf=5&bars=1152", r);
  assert.equal(origins.length, 1, "the stale copy was refused");
  assert.notEqual(res.headers.get("x-bars-edge"), "tail-cache");
  // and exactly AT the TTL it is still served
  const r2 = rig({ ignoreMaxAge: true });
  await ask("/api/bars/KLIC?tf=D&bars=2000", r2);
  r2.clock.t += TAIL_TTL_S.D * 1000;
  assert.equal((await ask("/api/bars/KLIC?tf=D&bars=2000", r2)).res.headers.get("x-bars-edge"), "tail-cache");
});

test("the copy asks the tier with NO cookie or credential, and keeps no per-request header", async () => {
  const r = rig();
  const { res } = await ask("/api/bars/KLIC?tf=D&bars=2000", r);
  const sent = r.tier.calls[0];
  assert.equal(sent.url, BARS_TIER_ORIGIN + "/api/bars/KLIC?bars=2000&tf=D");
  assert.equal(sent.headers.get("cookie"), null);
  assert.equal(sent.headers.get("authorization"), null);
  assert.equal(sent.headers.get("x-chart-edge-token"), null);
  assert.equal(res.headers.get("x-railway-request-id"), null);
});

test("which requests may use the copy: chart parameters only, GET only, never breadth or other routes", () => {
  const u = (p) => new URL("https://uctintelligence.com" + p);
  assert.deepEqual(tailCachePlan(u("/api/bars/AAPL?tf=D&bars=2000")), { ttl: 5, swr: 2, path: "/api/bars/AAPL?bars=2000&tf=D" });
  assert.deepEqual(tailCachePlan(u("/api/bars/AAPL")), { ttl: 5, swr: 2, path: "/api/bars/AAPL" });
  assert.equal(tailCachePlan(u("/api/bars/AAPL?tf=1&bars=1152&session=eth")).ttl, 3);
  assert.equal(tailCachePlan(u("/api/bars/AAPL?tf=W&since=2026-11-01")).ttl, 5);
  for (const p of ["/api/bars/AAPL?tf=D&warm=1", "/api/bars/AAPL?tf=D&warm=0", "/api/bars/AAPL?tf=D&_cb=x",
    "/api/bars/AAPL?tf=D&tf=W", "/api/bars/AAPL?tf=2", "/api/bars/AAPL?tf=D&foo=1", "/api/bars/UCTA50?tf=D",
    "/api/bars/US:A50?tf=D", "/api/bars/US%3AA50?tf=D", "/api/bars-history/AAPL?tf=D", "/api/bars/AAPL/adjustment-basis",
    "/api/bars/warm?tf=D&warm=1", "/api/bars/AAPL?tf=D&bars=1%202"]) {
    assert.equal(tailCachePlan(u(p)), null, p);
  }
  assert.equal(tailCachePlan(u("/api/bars/AAPL?tf=D"), "HEAD"), null);
  assert.equal(tailCachePlan(u("/api/bars/AAPL?tf=D"), "POST"), null);
});

test("a non-GET, a breaker that is open, TAIL_CACHE=0 or no ctx.exports all take the old path", async () => {
  const r = rig();
  const head = await ask("/api/bars/KLIC?tf=D", r, { method: "HEAD" });
  assert.equal(head.origins.length, 1);
  TIER_BREAKER.open("web-fallback");
  assert.equal((await ask("/api/bars/KLIC?tf=D", r)).origins.length, 1);
  TIER_BREAKER.reset();
  r.env.TAIL_CACHE = "0";
  assert.equal((await ask("/api/bars/KLIC?tf=D", r)).origins.length, 1);
  delete r.env.TAIL_CACHE;
  r.ctx.exports = {};
  assert.equal((await ask("/api/bars/KLIC?tf=D", r)).origins.length, 1);
  assert.equal(r.tail.log.requests.length, 0);
  assert.equal(await readTail(new URL("https://x/api/bars/A?tf=D"), { env: {}, ctx: r.ctx, entitled: false }), null);
});

test("the copy failing (throws, an unmarked answer) is the old path, never an error", async () => {
  for (const entry of [
    { fetch: async () => { throw new Error("loopback down"); } },
    { fetch: async () => new Response("x", { status: 502 }) },
    { fetch: async () => new Response("{}", { status: 200 }) },                    // no fill time: refused
  ]) {
    const r = rig({ entry });
    const { res, origins } = await ask("/api/bars/KLIC?tf=D", r);
    assert.equal(origins.length, 1);
    assert.equal(res.status, 200);
  }
  const slow = tier(() => new Error("aborted"));
  const res = await serveTail(new Request("https://bars-tail.internal/api/bars/KLIC?tf=D"), {}, { fetchImpl: slow.impl });
  assert.equal(res.status, 504);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("x-tail-tier-failed"), "1");
  assert.equal(TIER_FAILED.toString(), "Symbol(tier-failed)");
});

test("tailAnswerCacheable is the whole rule", () => {
  const h = (o = {}) => new Headers({ "content-type": "application/json", ...o });
  assert.equal(tailAnswerCacheable(200, h(), GOOD), true);
  assert.equal(tailAnswerCacheable(200, h(), { ...GOOD, tail_status: "current" }), true);
  assert.equal(tailAnswerCacheable(401, h(), GOOD), false);
  assert.equal(tailAnswerCacheable(200, h({ "content-type": "text/html" }), GOOD), false);
  assert.equal(tailAnswerCacheable(200, h(), { ...GOOD, warming: true }), false);
  assert.equal(tailAnswerCacheable(200, h(), null), false);
  assert.equal(tailAnswerCacheable(200, h(), [GOOD]), false);
});

test("⛔ while the tier breaker is open a warm=1 prefetch is shed 503 (no origin asked); a paint still goes to web", async () => {
  const r = rig();
  TIER_BREAKER.open("web-fallback");
  try {
    const shed = await ask("/api/bars/KLIC?tf=D&bars=2000&warm=1", r);
    assert.equal(shed.res.status, 503);
    assert.equal(shed.res.headers.get("x-bars-shed"), "warm-shed");
    assert.equal(shed.res.headers.get("retry-after"), "5");
    assert.equal(shed.res.headers.get("cache-control"), "no-store");
    assert.deepEqual(shed.origins, []);
    const anon = await ask("/api/bars/KLIC?tf=D&warm=1", r, { cookie: false });
    assert.equal(anon.res.status, 503, "shed for everyone: it is load, not entitlement");
    const paint = await ask("/api/bars/KLIC?tf=D&bars=2000", r);
    assert.equal(paint.origins.length, 1, "a real read is still served");
  } finally {
    TIER_BREAKER.reset();
  }
  const warm = await ask("/api/bars/KLIC?tf=D&warm=1", r);
  assert.equal(warm.res.status, 200, "breaker closed: the prefetch goes through");
  assert.equal(warm.origins.length, 1);
});
