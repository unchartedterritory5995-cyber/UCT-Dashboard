/**
 * The entitled `/api/bars/<symbol>` tail, briefly shared at the edge (2026-11-28, owner decision).
 *
 * WHY. The origin answers `/api/bars/<symbol>` with `no-store` (api/routers/bars.py), so every first paint
 * waited on a bars-api round trip: measured 2026-11-28 from MSP, browser TTFB 58-88 ms even when the server
 * spent 2-6 ms, against 11-27 ms for an edge hit. Here an ENTITLED read is answered from a copy at most a few
 * seconds old, kept by Workers Cache (tiered) in front of the `BarsTail` entrypoint (entry.js), keyed WITHOUT
 * any cookie. The browser still gets `no-store`; only the edge keeps the copy. Live ticks keep arriving
 * through the stream, exactly as before.
 *
 * WHY ONE COPY CAN SERVE EVERY MEMBER. The answer comes from bars-api's `/api/bars/{ticker}` route
 * (api/bars_api_main.py `bars_route`), which takes NO identity at all: no cookie, no header, no session, no
 * user (it is deliberately ungated; the edge is where entitlement is decided). Its answer is a function of the
 * URL and the store, nothing else. `tests/test_bars_tail_edge_cache.py` pins that the route keeps taking no
 * identity input, so the day it starts to, this cache goes red before it can hand one member another's answer.
 * Measured too, 2026-11-28: a signed-in and an anonymous KLIC D tail were field-for-field identical.
 *
 * THE RULES, each one load-bearing:
 *  - ONLY AN ENTITLED REQUEST reaches the copy (a valid member cookie or service header; worker.js decides it
 *    before calling here). Everyone else takes exactly the path they took before.
 *  - ONLY A COMPLETE, CURRENT, TIER ANSWER IS KEPT: a 200 JSON answer from bars-api with bars in it, and none
 *    of `no_data`, `error`, `tail_status: "unverified"`, `Retry-After` or `Set-Cookie`. A 401/403/404/503, a
 *    no_data answer, a pending tail and a web-pod answer (another store, another `history_rev`) are never kept.
 *  - NEVER OLDER THAN ITS TTL. The copy carries the time it was made (`x-tail-filled`); the gateway refuses
 *    one older than the TTL whatever the cache says, and asks the tier itself.
 *  - ONLY THE QUERY THE CLIENT ACTUALLY SENDS FOR A CHART: tf, bars, since, to, session. Any other parameter
 *    (`warm=1`, a `_cb` cache-buster, anything new) is not cacheable: it goes the old way.
 *  - ANY FAILURE HERE IS THE OLD PATH: the copy can make a read faster, never wrong or missing.
 *  - `env.TAIL_CACHE === "0"` turns it off (a plain variable, no code change).
 *
 * THE CONTRACT FOR THE CLIENT (also in the PR body):
 *   GET /api/bars/<SYM>?tf=<tf>&bars=<n>[&since=][&to=][&session=]   with the member's cookie, as today.
 *   A hit answers `X-Bars-Edge: tail-cache` and `X-Tail-Age-Ms: <age>` (<= TTL), a fill `tail-fill`.
 *   TTL (the hard age ceiling): D/W/M 5 s (max-age 3 + stale-while-revalidate 2), intraday 3 s (2 + 1). The cache key is the path plus the SORTED query, so a prefetch and the paint
 *   share a copy only when they send the same parameters (and no `warm=1`).
 */

export const TAIL_ENTRY = "BarsTail";
export const TAIL_ORIGIN = "https://bars-tail.internal";
export const BARS_TIER_ORIGIN = "https://bars-api-production-1052.up.railway.app";
/** Seconds a shared copy may be served for, per timeframe: the HARD ceiling on a copy's age. */
export const TAIL_TTL_S = { D: 5, W: 5, M: 5, "1": 3, "5": 3, "15": 3, "30": 3, "60": 3 };
/** The last seconds of that ceiling are `stale-while-revalidate`: a copy past `max-age` (TTL - SWR) is still
 *  served, at most until the ceiling, while ONE background refresh runs. With Workers Cache's request collapsing
 *  that is what keeps 500 members on one symbol at about one tier read per key per (TTL - SWR) seconds, with no
 *  herd at expiry: nobody waits on the refresh, and nobody is handed a copy older than the TTL. */
export const TAIL_SWR_S = { D: 2, W: 2, M: 2, "1": 1, "5": 1, "15": 1, "30": 1, "60": 1 };
/** How long the cached entrypoint waits for the tier before giving up (the old path then runs). */
export const TAIL_TIER_TIMEOUT_MS = 1200;

const ALLOWED_PARAMS = new Set(["tf", "bars", "since", "to", "session"]);
const PATH_RE = /^\/api\/bars\/([^\/?#]+)$/;
const PARAM_VALUE_RE = /^[A-Za-z0-9._:-]{0,40}$/;
// Headers of the tier's answer the copy must not carry: per-request, per-connection or encoding facts.
const DROP_HEADERS = ["set-cookie", "cache-control", "pragma", "content-length", "content-encoding",
  "transfer-encoding", "connection", "x-railway-request-id", "x-railway-edge", "x-hikari-trace", "vary"];

/** The copy's TTL and canonical path for a request, or null when the request is not cacheable. */
export function tailCachePlan(url, method = "GET") {
  if (String(method).toUpperCase() !== "GET") return null;
  const u = url instanceof URL ? url : new URL(url);
  const m = PATH_RE.exec(u.pathname);
  if (!m) return null;
  let sym;
  try { sym = decodeURIComponent(m[1]); } catch (_e) { return null; }
  if (!sym || sym.includes(":") || sym.toUpperCase().startsWith("UCT")) return null;   // web-pod series
  const seen = new Set();
  const pairs = [];
  for (const [k, v] of u.searchParams) {
    if (!ALLOWED_PARAMS.has(k) || seen.has(k) || !PARAM_VALUE_RE.test(v)) return null;
    seen.add(k);
    pairs.push([k, v]);
  }
  const tf = u.searchParams.get("tf") || "D";
  const ttl = TAIL_TTL_S[tf];
  if (!ttl) return null;
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const q = new URLSearchParams(pairs).toString();
  return { ttl, swr: TAIL_SWR_S[tf] || 0, path: u.pathname + (q ? "?" + q : "") };
}

/** Is a tier answer one every entitled member may be handed for TTL seconds? */
export function tailAnswerCacheable(status, headers, body) {
  if (status !== 200) return false;
  if (headers.get("set-cookie") || headers.get("retry-after")) return false;
  if (!String(headers.get("content-type") || "").toLowerCase().startsWith("application/json")) return false;
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  if (!Array.isArray(body.bars) || body.bars.length === 0) return false;
  if (body.no_data || body.error || body.warming) return false;
  if (body.tail_status === "unverified") return false;
  return true;
}

function pass(status, headers, body) {
  const h = new Headers(headers);
  for (const k of DROP_HEADERS) h.delete(k);
  h.set("cache-control", "no-store");
  h.set("x-tail-pass", "1");
  return new Response(body, { status, headers: h });
}

/**
 * The `BarsTail` entrypoint (entry.js): ask bars-api for `request`'s path, answer it cacheable for its TTL
 * only when `tailAnswerCacheable`. No cookie or credential is ever sent: the route takes none.
 */
export async function serveTail(request, _env, { fetchImpl = fetch, now = () => Date.now(),
                                                  timeoutMs = TAIL_TIER_TIMEOUT_MS } = {}) {
  const plan = tailCachePlan(new URL(request.url), request.method);
  if (!plan) return pass(404, { "content-type": "application/json" }, '{"error":"not_cacheable"}');
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let r;
  try {
    r = await fetchImpl(BARS_TIER_ORIGIN + plan.path, {
      method: "GET", headers: { accept: "application/json" }, redirect: "manual", signal: ac.signal,
    });
  } catch (_e) {
    return pass(504, { "content-type": "application/json" }, '{"error":"tier_unanswered"}');
  } finally {
    clearTimeout(timer);
  }
  if (r.status !== 200) {
    try { await r.body?.cancel(); } catch (_e) { /* nothing to release */ }
    return pass(r.status === 504 ? 502 : r.status, { "content-type": "application/json" }, '{"error":"tier_status"}');
  }
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch (_e) { body = null; }
  if (!tailAnswerCacheable(r.status, r.headers, body)) return pass(200, r.headers, text);
  const h = new Headers(r.headers);
  for (const k of DROP_HEADERS) h.delete(k);
  h.set("content-type", "application/json");
  // max-age + stale-while-revalidate == the TTL: no copy is ever served older than it (readTail checks too).
  h.set("cache-control", plan.swr > 0
    ? `public, max-age=${plan.ttl - plan.swr}, stale-while-revalidate=${plan.swr}`
    : `public, max-age=${plan.ttl}`);
  h.set("x-tail-filled", String(now()));
  h.set("x-tail-ttl", String(plan.ttl));
  return new Response(text, { status: 200, headers: h });
}

/**
 * The gateway half (worker.js, AFTER the entitlement check): the shared copy for `url`, or null to take the
 * old path. `entitled` must already be proven; `breakerOpen` skips the copy while the tier is failing.
 */
export async function readTail(url, { env, ctx, entitled, breakerOpen = false, now = () => Date.now() } = {}) {
  if (entitled !== true || breakerOpen) return null;
  if (env && env.TAIL_CACHE === "0") return null;
  const entry = ctx && ctx.exports && ctx.exports[TAIL_ENTRY];
  if (!entry || typeof entry.fetch !== "function") return null;
  const plan = tailCachePlan(url, "GET");
  if (!plan) return null;
  const t0 = now();
  let r;
  try {
    r = await entry.fetch(new Request(TAIL_ORIGIN + plan.path));
  } catch (_e) {
    return null;
  }
  const drop = async () => { try { await r.body?.cancel(); } catch (_e) { /* nothing to release */ } return null; };
  if (r.status !== 200) return drop();
  const passed = r.headers.get("x-tail-pass") === "1";
  const filled = Number(r.headers.get("x-tail-filled"));
  if (!passed) {
    if (!Number.isFinite(filled) || filled <= 0) return drop();
    if (t0 - filled > plan.ttl * 1000) return drop();     // older than its TTL: never served
  }
  const h = new Headers(r.headers);
  h.set("cache-control", "no-store, must-revalidate");
  h.set("pragma", "no-cache");
  h.delete("x-tail-pass");
  if (passed) {
    h.set("x-bars-edge", "tier");
  } else {
    h.set("x-bars-edge", filled < t0 ? "tail-cache" : "tail-fill");
    h.set("x-tail-age-ms", String(Math.max(0, t0 - filled)));
  }
  return new Response(r.body, { status: 200, headers: h });
}
