/**
 * bars-edge-router tests — Phase 1 (shadow).
 *
 * ⭐⭐ THE TEST THAT MATTERS IS `routing is IDENTICAL for every classification`.
 * Everything else here checks that the verifier is correct; that one checks that
 * being correct COSTS NOTHING YET. Phase 1's whole promise is "not a single
 * chart request blocked", and a promise with no rail is a hope.
 *
 * Run: node --test   (from edge/bars-edge-router/)
 * Also run by tests/test_chart_edge_worker_interop.py so it lands in the normal
 * pytest suite rather than waiting for someone to remember a second command.
 */
import test from "node:test";
import assert from "node:assert/strict";

import worker, {
  classifyRequest, SERVICE_VALID, SERVICE_EXPIRED, SERVICE_INVALID,
  classifyToken, readCookie, stripEdgeCookie,
  VALID, MISSING, EXPIRED, INVALID,
} from "./worker.js";

const SECRET = "test-edge-secret";
const BARS = "https://bars-api-production-1052.up.railway.app";
const WEB = "https://web-production-05cb6.up.railway.app";

const b64u = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Mint exactly as api/chart_edge_token.py does. */
async function mint({ secret = SECRET, v = 1, iat, exp, ent = "bars" } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { ent, exp: exp ?? now + 900, iat: iat ?? now, v };
  // Python uses sort_keys + compact separators; match byte-for-byte.
  const json = JSON.stringify(payload, Object.keys(payload).sort());
  const payloadB64 = b64u(new TextEncoder().encode(json));
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  return `v${v}.${payloadB64}.${b64u(sig)}`;
}

/** Mint a MACHINE capability — same signer and secret, different entitlement. */
const mintService = (o = {}) => mint({ ent: "service", ...o });

/** Run the worker with fetch stubbed; return which origins it called. */
async function run(path, { cookie, secret = SECRET, extra } = {}) {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push(url);
    return new Response('{"bars":[]}', {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  try {
    const headers = { ...(cookie ? { cookie } : {}), ...(extra || {}) };
    const req = new Request("https://uctintelligence.com" + path, { headers });
    const res = await worker.fetch(req, { CHART_EDGE_SECRET: secret });
    return { calls, res };
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ── the verifier ────────────────────────────────────────────────────────────

test("a freshly minted token is VALID", async () => {
  assert.equal(await classifyToken(await mint(), SECRET), VALID);
});

test("no cookie is MISSING, not INVALID — they are different facts", async () => {
  assert.equal(await classifyToken(null, SECRET), MISSING);
  assert.equal(await classifyToken("", SECRET), MISSING);
});

test("an expired token is EXPIRED", async () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(await classifyToken(await mint({ iat: now - 7200, exp: now - 60 }), SECRET), EXPIRED);
});

test("⛔ a TAMPERED PAYLOAD is INVALID — the signature is over the payload", async () => {
  const token = await mint();
  const [v, payload, sig] = token.split(".");
  const forged = b64u(new TextEncoder().encode(
    JSON.stringify({ ent: "bars", exp: 4102444800, iat: 0, v: 1 })));
  assert.notEqual(forged, payload);
  assert.equal(await classifyToken(`${v}.${forged}.${sig}`, SECRET), INVALID);
});

test("⛔ a TAMPERED SIGNATURE is INVALID", async () => {
  const [v, payload] = (await mint()).split(".");
  assert.equal(await classifyToken(`${v}.${payload}.YWJjZA`, SECRET), INVALID);
});

test("⛔ a token signed with ANOTHER SECRET is INVALID", async () => {
  assert.equal(await classifyToken(await mint({ secret: "not-the-secret" }), SECRET), INVALID);
});

test("an UNKNOWN VERSION is INVALID", async () => {
  const [, payload, sig] = (await mint()).split(".");
  assert.equal(await classifyToken(`v9.${payload}.${sig}`, SECRET), INVALID);
});

test("malformed shapes are INVALID, never a crash", async () => {
  for (const bad of ["", "x", "a.b", "a.b.c.d", "v1..", "v1.%%%.%%%"]) {
    const cls = await classifyToken(bad || null, SECRET);
    assert.ok(cls === INVALID || cls === MISSING, `${JSON.stringify(bad)} -> ${cls}`);
  }
});

test("a token stamped in the FUTURE beyond skew is INVALID", async () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(await classifyToken(await mint({ iat: now + 600, exp: now + 1500 }), SECRET), INVALID);
});

test("⭐ a token inside the skew window is still VALID — two clouds, two clocks", async () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(await classifyToken(await mint({ iat: now + 30, exp: now + 900 }), SECRET), VALID);
});

test("a wrong entitlement class is INVALID", async () => {
  assert.equal(await classifyToken(await mint({ ent: "something-else" }), SECRET), INVALID);
});

test("⛔ NO SECRET BOUND admits nobody — a present token cannot be judged", async () => {
  assert.equal(await classifyToken(await mint(), ""), INVALID);
  assert.equal(await classifyToken(await mint(), undefined), INVALID);
});

// ── cookie handling ─────────────────────────────────────────────────────────

test("readCookie picks the right value out of a crowded header", () => {
  const h = "uct_session=abc; uct_chart_edge=v1.x.y; other=1";
  assert.equal(readCookie(h, "uct_chart_edge"), "v1.x.y");
  assert.equal(readCookie(h, "nope"), null);
  assert.equal(readCookie(null, "uct_chart_edge"), null);
});

test("⛔ stripEdgeCookie removes ONLY ours — uct_session must survive", () => {
  assert.equal(stripEdgeCookie("uct_session=abc; uct_chart_edge=tok"), "uct_session=abc");
  assert.equal(stripEdgeCookie("uct_chart_edge=tok"), null);
  assert.equal(stripEdgeCookie("uct_session=abc"), "uct_session=abc");
});

// ── ⭐⭐ THE SHADOW GUARANTEE ────────────────────────────────────────────────

test("⭐⭐ routing is IDENTICAL for every classification — Phase 1 blocks nothing", async () => {
  const now = Math.floor(Date.now() / 1000);
  const cases = {
    VALID: await mint(),
    MISSING: null,
    EXPIRED: await mint({ iat: now - 7200, exp: now - 60 }),
    INVALID: await mint({ secret: "wrong" }),
  };
  for (const [name, token] of Object.entries(cases)) {
    const { calls, res } = await run("/api/bars/AAPL?tf=D&bars=10",
      { cookie: token ? `uct_session=s; uct_chart_edge=${token}` : "uct_session=s" });
    assert.equal(calls.length, 1, `${name}: wrong number of upstream calls`);
    assert.ok(calls[0].startsWith(BARS),
      `${name}: went to ${calls[0]} instead of the bars tier — Phase 1 changed routing`);
    assert.equal(res.status, 200, `${name}: returned ${res.status} — Phase 1 must never deny`);
    assert.equal(res.headers.get("X-Bars-Edge"), "tier");
  }
});

test("⭐⭐ BREADTH still goes to web for every classification", async () => {
  const now = Math.floor(Date.now() / 1000);
  for (const [name, token] of Object.entries({
    VALID: await mint(),
    MISSING: null,
    EXPIRED: await mint({ iat: now - 7200, exp: now - 60 }),
    INVALID: "v1.garbage.garbage",
  })) {
    const { calls, res } = await run("/api/bars/UCTA50?tf=D&bars=10",
      { cookie: token ? `uct_chart_edge=${token}` : undefined });
    assert.equal(calls.length, 1, `${name}: wrong number of upstream calls`);
    assert.ok(calls[0].startsWith(WEB),
      `${name}: breadth went to ${calls[0]} — it must stay on the web pod`);
    assert.equal(res.status, 200);
  }
});

test("⛔ an unbound secret still routes normally — shadow failure is not a denial", async () => {
  // ⚰️ `secret: undefined` DOES NOT WORK HERE and the first version of this test
  // used it: a JS default parameter fires on `undefined`, so `run` helpfully
  // supplied the real secret and the case classified VALID while claiming to
  // test an unbound binding. It passed, asserting nothing. `null` skips the
  // default — and the shadow log line is the proof, which is why the classifier
  // is asserted here rather than only the routing.
  const token = await mint();
  assert.equal(await classifyToken(token, null), INVALID,
    "an unbound secret must judge a present token INVALID");
  const { calls, res } = await run("/api/bars/AAPL?tf=D&bars=10",
    { cookie: `uct_chart_edge=${token}`, secret: null });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].startsWith(BARS));
  assert.equal(res.status, 200);
});

test("the query string is preserved verbatim on the upstream call", async () => {
  const { calls } = await run("/api/bars/AAPL?tf=D&bars=10&d=2026-09-11");
  assert.ok(calls[0].endsWith("/api/bars/AAPL?tf=D&bars=10&d=2026-09-11"), calls[0]);
});

test("a non-matching path passes straight through, untouched", async () => {
  const { calls } = await run("/api/coverage");
  assert.equal(calls.length, 1);
  assert.ok(calls[0].startsWith("https://uctintelligence.com/"), calls[0]);
});

test("⛔ the entitlement cookie is NOT forwarded upstream, but the session is", async () => {
  const captured = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    captured.push(new Headers(init?.headers).get("cookie"));
    return new Response("{}", { status: 200 });
  };
  try {
    const req = new Request("https://uctintelligence.com/api/bars/AAPL", {
      headers: { cookie: `uct_session=abc; uct_chart_edge=${await mint()}` },
    });
    await worker.fetch(req, { CHART_EDGE_SECRET: SECRET });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(captured.length, 1);
  assert.equal(captured[0], "uct_session=abc");
  assert.ok(!String(captured[0]).includes("uct_chart_edge"),
    "the entitlement token was forwarded to an origin that has no use for it");
});

// ── the MACHINE trust path (Phase 1.5) ──────────────────────────────────────

const SVC = "x-chart-edge-token";
const svcHdr = (t) => ({ [SVC]: t });

test("⭐⭐ a valid service capability classifies EDGE_SERVICE_VALID", async () => {
  const req = new Request("https://uctintelligence.com/api/bars/AAPL",
    { headers: svcHdr(await mintService()) });
  assert.equal(await classifyRequest(req, SECRET), SERVICE_VALID);
});

test("⛔ a MEMBER token in the service header is NOT service-valid", async () => {
  const req = new Request("https://uctintelligence.com/api/bars/AAPL",
    { headers: svcHdr(await mint()) });   // ent:"bars" presented as a machine
  assert.equal(await classifyRequest(req, SECRET), SERVICE_INVALID);
});

test("⛔ a SERVICE token in the member cookie is NOT member-valid", async () => {
  const req = new Request("https://uctintelligence.com/api/bars/AAPL",
    { headers: { cookie: `uct_chart_edge=${await mintService()}` } });
  assert.equal(await classifyRequest(req, SECRET), INVALID);
});

test("an expired service capability is EDGE_SERVICE_EXPIRED", async () => {
  const now = Math.floor(Date.now() / 1000);
  const req = new Request("https://uctintelligence.com/api/bars/AAPL",
    { headers: svcHdr(await mintService({ iat: now - 7200, exp: now - 60 })) });
  assert.equal(await classifyRequest(req, SECRET), SERVICE_EXPIRED);
});

test("a forged service capability is EDGE_SERVICE_INVALID", async () => {
  const req = new Request("https://uctintelligence.com/api/bars/AAPL",
    { headers: svcHdr(await mintService({ secret: "wrong" })) });
  assert.equal(await classifyRequest(req, SECRET), SERVICE_INVALID);
});

// ── ⛔⛔ SHAPE IS NEVER AUTHORITY ────────────────────────────────────────────
// The renderer's requests are indistinguishable from a member's by shape. These
// are the exact signatures that led the Phase 1 audit to guess "prewarm", and
// none of them may buy a gram of trust.

test("⛔⛔ warm=1 / bars=600 / bars=2 WITHOUT a credential are all MISSING", async () => {
  for (const q of ["?tf=D&bars=600", "?tf=D&bars=2", "?tf=5&bars=600&warm=1",
                   "?tf=D&bars=600&warm=1"]) {
    const req = new Request("https://uctintelligence.com/api/bars/AAPL" + q);
    assert.equal(await classifyRequest(req, SECRET), MISSING,
      `${q} was granted trust by its SHAPE`);
  }
});

test("⛔⛔ a renderer-looking User-Agent buys nothing", async () => {
  const req = new Request("https://uctintelligence.com/api/bars/AAPL?tf=D&bars=600", {
    headers: { "user-agent": "Mozilla/5.0 HeadlessChrome/120 chart-renderer Playwright" },
  });
  assert.equal(await classifyRequest(req, SECRET), MISSING);
});

test("⛔ an empty or junk service header is not trust", async () => {
  for (const t of ["", "   ", "garbage", "v1.x.y"]) {
    const req = new Request("https://uctintelligence.com/api/bars/AAPL",
      { headers: svcHdr(t) });
    const cls = await classifyRequest(req, SECRET);
    assert.ok(cls === MISSING || cls === SERVICE_INVALID, `${JSON.stringify(t)} -> ${cls}`);
  }
});

// ── precedence ──────────────────────────────────────────────────────────────

test("⭐ valid member + valid service → the MEMBER wins (a real person)", async () => {
  const req = new Request("https://uctintelligence.com/api/bars/AAPL", {
    headers: { cookie: `uct_chart_edge=${await mint()}`, ...svcHdr(await mintService()) },
  });
  assert.equal(await classifyRequest(req, SECRET), VALID);
});

test("⭐ INVALID member + valid service → EDGE_SERVICE_VALID", async () => {
  const req = new Request("https://uctintelligence.com/api/bars/AAPL", {
    headers: { cookie: "uct_chart_edge=garbage", ...svcHdr(await mintService()) },
  });
  assert.equal(await classifyRequest(req, SECRET), SERVICE_VALID);
});

test("⭐ EXPIRED member + valid service → EDGE_SERVICE_VALID", async () => {
  const now = Math.floor(Date.now() / 1000);
  const stale = await mint({ iat: now - 7200, exp: now - 60 });
  const req = new Request("https://uctintelligence.com/api/bars/AAPL", {
    headers: { cookie: `uct_chart_edge=${stale}`, ...svcHdr(await mintService()) },
  });
  assert.equal(await classifyRequest(req, SECRET), SERVICE_VALID);
});

test("⭐ valid member + INVALID service → EDGE_ENTITLEMENT_VALID", async () => {
  const req = new Request("https://uctintelligence.com/api/bars/AAPL", {
    headers: { cookie: `uct_chart_edge=${await mint()}`, ...svcHdr("garbage") },
  });
  assert.equal(await classifyRequest(req, SECRET), VALID);
});

test("no credentials at all → MISSING", async () => {
  const req = new Request("https://uctintelligence.com/api/bars/AAPL");
  assert.equal(await classifyRequest(req, SECRET), MISSING);
});

// ── shadow guarantee, now across SEVEN classifications ──────────────────────

test("⭐⭐ routing is IDENTICAL for every classification INCLUDING the service ones", async () => {
  const now = Math.floor(Date.now() / 1000);
  const cases = {
    MEMBER_VALID:    { cookie: `uct_chart_edge=${await mint()}` },
    MEMBER_EXPIRED:  { cookie: `uct_chart_edge=${await mint({ iat: now - 7200, exp: now - 60 })}` },
    MEMBER_INVALID:  { cookie: "uct_chart_edge=garbage" },
    SERVICE_VALID:   svcHdr(await mintService()),
    SERVICE_EXPIRED: svcHdr(await mintService({ iat: now - 7200, exp: now - 60 })),
    SERVICE_INVALID: svcHdr("garbage"),
    MISSING:         {},
  };
  for (const [name, extra] of Object.entries(cases)) {
    const { calls, res } = await run("/api/bars/AAPL?tf=D&bars=600", { extra });
    assert.equal(calls.length, 1, `${name}: wrong upstream call count`);
    assert.ok(calls[0].startsWith(BARS), `${name}: routed to ${calls[0]}`);
    assert.equal(res.status, 200, `${name}: returned ${res.status} — Phase 1.5 must never deny`);
  }
});

test("⭐⭐ BREADTH still goes to web even with a valid service capability", async () => {
  const { calls, res } = await run("/api/bars/UCTA50?tf=D&bars=5",
    { extra: svcHdr(await mintService()) });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].startsWith(WEB), `breadth went to ${calls[0]}`);
  assert.equal(res.status, 200);
});

test("⛔ the service capability is NOT forwarded upstream", async () => {
  const captured = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    captured.push(new Headers(init?.headers));
    return new Response("{}", { status: 200 });
  };
  try {
    const req = new Request("https://uctintelligence.com/api/bars/AAPL", {
      headers: { cookie: "uct_session=abc", ...svcHdr(await mintService()) },
    });
    await worker.fetch(req, { CHART_EDGE_SECRET: SECRET });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(captured.length, 1);
  assert.equal(captured[0].get(SVC), null,
    "the render capability was forwarded to an origin that cannot verify it");
  assert.equal(captured[0].get("cookie"), "uct_session=abc");
});

// ── namespaced breadth identities route to WEB, not the tier ────────────────

const routeOf = async (path) => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    calls.push(typeof input === "string" ? input : input.url);
    return new Response("{}", { status: 200 });
  };
  try {
    await worker.fetch(new Request("https://uctintelligence.com" + path), {});
  } finally {
    globalThis.fetch = realFetch;
  }
  return calls[0];
};

test("⛔ US:A50 goes to WEB — the tier's breadth database is 16 KB and EMPTY", async () => {
  const to = await routeOf("/api/bars/US:A50?tf=D&bars=400");
  assert.ok(to.startsWith(WEB), `US:A50 went to ${to}`);
});

test("⛔ the URL-ENCODED colon routes identically — browsers may send either", async () => {
  const to = await routeOf("/api/bars/US%3AA50?tf=D&bars=400");
  assert.ok(to.startsWith(WEB), `US%3AA50 went to ${to}`);
});

test("⭐ NASDAQ:/NYSE: are covered before they are ever published", async () => {
  for (const sym of ["NASDAQ:A50", "NYSE:NETHL"]) {
    const to = await routeOf(`/api/bars/${sym}`);
    assert.ok(to.startsWith(WEB), `${sym} went to ${to}`);
  }
});

test("⭐ UCT breadth still goes to WEB — the original rule is untouched", async () => {
  const to = await routeOf("/api/bars/UCTA50");
  assert.ok(to.startsWith(WEB), `UCTA50 went to ${to}`);
});

test("⛔⛔ ORDINARY TICKERS STILL GO TO THE TIER — the control that matters most", async () => {
  // Widening `isBreadth` too far sends equities to web: that is the 2026-09-13
  // outage in reverse, and it is the failure this test exists to catch.
  for (const sym of ["AAPL", "SPY", "BRK.B", "^IXIC", "USB", "USO", "US"]) {
    const to = await routeOf(`/api/bars/${sym}`);
    assert.ok(to.startsWith(BARS), `${sym} went to ${to} — it must reach the tier`);
  }
});

test("⚰️ KNOWN QUIRK, PRE-EXISTING: `UCTT` is a REAL ticker caught by the UCT prefix", async () => {
  // ⚠️ Not introduced by the colon rule and not fixed by it. The SERVER is careful
  // here — `is_breadth_symbol` is a membership test "NOT a bare 'UCT' prefix, so a real
  // ticker like UCTT never collides" — but this edge check is a bare prefix, so UCTT is
  // forwarded to WEB instead of the tier. Harmless today: web holds bars.db too and
  // serves it normally, which is why nobody has noticed. Recorded rather than fixed,
  // because narrowing the prefix is a routing change and belongs in its own step.
  const to = await routeOf("/api/bars/UCTT");
  assert.ok(to.startsWith(WEB),
    "if UCTT now reaches the tier the prefix rule changed — re-read this note");
});
