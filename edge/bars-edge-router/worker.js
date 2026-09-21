/**
 * bars-edge-router — the Cloudflare Worker on `uctintelligence.com/api/bars/*`.
 *
 * ⚰️⚰️ THIS FILE WAS NOT IN GIT UNTIL 2026-09-13. The only copy of the code
 * serving ~17k member chart requests a day lived in the Cloudflare dashboard,
 * hand-deployed. That is how a repository-only audit concluded "no browser ever
 * calls bars-api" and shipped a service-credential gate that refused every
 * paying member: the routing that contradicted it was not in the repository to
 * read. The body below is the deployed logic, transcribed verbatim from version
 * `70bf0e0f`, plus the SHADOW verification block. Deploying from here from now
 * on is the point.
 *
 * ⛔⛔ PHASE 1 IS SHADOW-ONLY. The entitlement check below classifies and logs.
 * It MUST NOT influence routing. Every request — VALID, MISSING, EXPIRED or
 * INVALID — takes exactly the path it took before this block existed. The
 * enforcement branch is deliberately absent rather than flagged off: there is no
 * variable to flip by accident.
 *
 * ROUTING (unchanged, and its quirks are known — see README):
 *   /api/bars/UCT*  → WEB_ORIGIN   (breadth lives in the web pod's tables)
 *   /api/bars/US:*  → WEB_ORIGIN   (and every other namespaced breadth identity)
 *   /api/bars/<sym> → BARS_ORIGIN  (the bars-api tier)
 *   anything else   → pass through to the zone's default origin (web)
 *   BARS_ORIGIN >=500 or timeout → fall back to WEB_ORIGIN
 *
 * ⛔ NOTE WHAT THE FALLBACK DOES **NOT** COVER: 401/403 pass straight through to
 * the member. That single line is why the 2026-09-13 tier gate was a visible
 * outage rather than a silent degradation. Do not "fix" it here in Phase 1 — the
 * tier is ungated today, and changing fallback semantics is a routing change.
 */

const BARS_ORIGIN = "https://bars-api-production-1052.up.railway.app";
const WEB_ORIGIN  = "https://web-production-05cb6.up.railway.app";
const BARS_TIMEOUT_MS = 8000;

// ⛔⛔ MARKET INDICATORS THAT CARRY NO COLON — the second half of the same lesson the
// colon rule above records. Those series are served from WEB-POD stores
// (`cboe_indices.db`, `naaim_series.db`, a derivation over `breadth_daily_ohlc`) that
// the bars tier does not have, exactly like breadth. Their member-facing symbols are
// bare words, so neither `startsWith("UCT")` nor `includes(":")` catches them, and all
// eight were forwarded to the tier and answered `bars: []` — a valid, cacheable 200
// carrying nothing. Measured on production 2026-09-21: every one of them, blank chart,
// no error.
//
// ⚠️ A LIST, BECAUSE THERE IS NO SYNTAX TO TEST. `VXN` and `SKEW` are shaped exactly
// like ordinary tickers; only the registry knows the difference, and the edge has no
// registry. `tests/test_market_indicators_edge_routing.py` pins this list against
// `registry.published_rows()` so a newly published bare-word series cannot ship without
// it — the failure mode is silent and member-visible, so it gets a rail, not a comment.
//
// ⛔ SYNTAX GRANTS NOTHING DOWNSTREAM. Being on this list only means "ask web"; web
// answers from its own registry, so a stale entry costs a redirect and nothing more.
const MARKET_INDICATOR_SYMBOLS = new Set([
  "VIX9D", "VIX3M", "VIX6M", "VVIX", "VXN", "RVX", "SKEW", "NAAIM",
]);

// ── chart edge entitlement (shadow) ─────────────────────────────────────────
// Mirrors api/chart_edge_token.py. The two are proven equal by
// tests/test_chart_edge_worker_interop.py, which mints in Python and classifies
// HERE — drift fails a test instead of a member's chart.
const TOKEN_VERSION = 1;
const COOKIE_NAME = "uct_chart_edge";
const ENTITLEMENT_BARS = "bars";
const ENTITLEMENT_SERVICE = "service";
const CLOCK_SKEW_LEEWAY_SECONDS = 60;

/**
 * The header carrying a per-render MACHINE capability.
 *
 * ⛔ A HEADER, NEVER THE COOKIE, AND NEVER THE URL. The cookie is the MEMBER
 * transport; reusing it for machines would make a leaked render token a member
 * token. A query parameter would put the credential into every log, analytics
 * row and cache key on the path.
 */
const SERVICE_HEADER = "x-chart-edge-token";

export const VALID = "EDGE_ENTITLEMENT_VALID";
export const MISSING = "EDGE_ENTITLEMENT_MISSING";
export const EXPIRED = "EDGE_ENTITLEMENT_EXPIRED";
export const INVALID = "EDGE_ENTITLEMENT_INVALID";
export const SERVICE_VALID = "EDGE_SERVICE_VALID";
export const SERVICE_EXPIRED = "EDGE_SERVICE_EXPIRED";
export const SERVICE_INVALID = "EDGE_SERVICE_INVALID";

/** Read one cookie out of a Cookie header without a parser dependency. */
export function readCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/**
 * Remove ONLY our entitlement cookie from a Cookie header.
 *
 * ⛔ ONLY OURS. `uct_session` is forwarded today and removing it would be a
 * behaviour change; this filters one name and leaves the header otherwise
 * byte-identical (and deletes the header entirely if nothing remains).
 *
 * ⭐ WHY STRIP AT ALL: the origins have no use for it, and an entitlement
 * artifact should not travel further than the component that verifies it. It is
 * also the groundwork for the shared cache — whatever eventually forms a cache
 * key must never contain a per-member value.
 */
export function stripEdgeCookie(cookieHeader) {
  if (!cookieHeader) return null;
  const kept = cookieHeader
    .split(";")
    .filter((part) => {
      const eq = part.indexOf("=");
      const key = eq < 0 ? part.trim() : part.slice(0, eq).trim();
      return key !== COOKIE_NAME;
    })
    .map((p) => p.trim())
    .filter(Boolean);
  return kept.length ? kept.join("; ") : null;
}

function b64uToBytes(text) {
  const pad = text.length % 4 === 0 ? "" : "=".repeat(4 - (text.length % 4));
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Classify an entitlement token. Returns one of the four constants above.
 *
 * ⭐ `crypto.subtle.verify` IS THE COMPARISON, deliberately. It is the runtime's
 * own constant-time HMAC check — hand-rolling a byte loop over a signature is
 * how timing oracles get written.
 *
 * ⛔ SIGNATURE BEFORE PARSE. The payload is attacker-controlled until the HMAC
 * says otherwise, so nothing reads it until then.
 */
export async function classifyToken(token, secret, nowSeconds, expectEnt = ENTITLEMENT_BARS) {
  if (!token) return MISSING;
  if (!secret) return INVALID;      // token present, no key to judge it with

  const parts = token.split(".");
  if (parts.length !== 3) return INVALID;
  const [versionTag, payloadB64, sigB64] = parts;
  if (versionTag !== `v${TOKEN_VERSION}`) return INVALID;

  let ok = false;
  try {
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
    );
    ok = await crypto.subtle.verify(
      "HMAC", key, b64uToBytes(sigB64), new TextEncoder().encode(payloadB64),
    );
  } catch (_e) {
    return INVALID;                 // malformed base64 in the signature, etc.
  }
  if (!ok) return INVALID;

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64uToBytes(payloadB64)));
  } catch (_e) {
    return INVALID;
  }
  if (!payload || typeof payload !== "object") return INVALID;
  if (payload.v !== TOKEN_VERSION) return INVALID;
  if (!Number.isInteger(payload.exp) || !Number.isInteger(payload.iat)) return INVALID;

  const now = Number.isFinite(nowSeconds) ? nowSeconds : Math.floor(Date.now() / 1000);
  if (now >= payload.exp) return EXPIRED;
  if (payload.iat > now + CLOCK_SKEW_LEEWAY_SECONDS) return INVALID;
  // ⛔ The entitlement must be the one the CALLER asked for — this is what stops
  // a render capability being replayed as a member session, and vice versa.
  if (payload.ent !== expectEnt) return INVALID;
  return VALID;
}

/**
 * The single classification for one request: member first, then machine.
 *
 * ⛔⛔ ROUTE SHAPE IS NEVER AUTHORITY. Nothing here reads `warm=1`, `bars=600`,
 * `bars=2`, the User-Agent, the ticker or the path — only cryptographic proof.
 * The renderer's requests look EXACTLY like a member's, which is precisely why
 * shape cannot be allowed to mean trust.
 *
 * PRECEDENCE, deterministic and asserted:
 *   1. valid member cookie            → EDGE_ENTITLEMENT_VALID  (a real person wins)
 *   2. valid service header           → EDGE_SERVICE_VALID
 *   3. a service header that was PRESENT but did not verify → SERVICE_EXPIRED/INVALID
 *   4. a member cookie that was PRESENT but did not verify   → EXPIRED/INVALID
 *   5. nothing at all                 → EDGE_ENTITLEMENT_MISSING
 *
 * ⭐ Failure is reported against whichever credential was actually PRESENTED, so
 * the shadow logs say which trust path is breaking rather than collapsing both
 * into one number.
 */
export async function classifyRequest(request, secret, nowSeconds) {
  const cookieTok = readCookie(request.headers.get("cookie"), COOKIE_NAME);
  const serviceTok = request.headers.get(SERVICE_HEADER);

  const memberCls = await classifyToken(cookieTok, secret, nowSeconds, ENTITLEMENT_BARS);
  if (memberCls === VALID) return VALID;

  const serviceCls = await classifyToken(serviceTok, secret, nowSeconds, ENTITLEMENT_SERVICE);
  if (serviceCls === VALID) return SERVICE_VALID;

  if (serviceTok) return serviceCls === EXPIRED ? SERVICE_EXPIRED : SERVICE_INVALID;
  if (cookieTok) return memberCls === EXPIRED ? EXPIRED : INVALID;
  return MISSING;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/api\/bars(?:-history)?\/([^\/?#]+)/);
    if (!m) return fetch(request);

    const ticker = decodeURIComponent(m[1]).toUpperCase();
    // ⛔⛔ BREADTH IS `UCT*` **OR ANY NAMESPACED IDENTITY**, and the second half is not
    // cosmetic. The Breadth Library is a library of metrics ACROSS UNIVERSES: the same
    // `pct_above_50sma` is `UCTA50` in the shipped universe and `US:A50` in the
    // point-in-time US one. Only the first spelling starts with "UCT", so a colon-bearing
    // identity was being forwarded to the tier — whose breadth database is 16 KB and
    // EMPTY — and every US chart came back `symbol_not_carried` while the very same
    // symbol returned a proper 401 on WEB_ORIGIN. Measured 2026-09-16 on production.
    //
    // ⭐ A COLON IS THE RIGHT TEST, not a list of universe prefixes. No ordinary ticker
    // contains one, `decodeURIComponent` above has already turned `%3A` back into `:`, and
    // this covers `NASDAQ:*` and `NYSE:*` the day they are published without touching this
    // file again. Syntax still grants nothing downstream — `resolve()` is a dict lookup
    // against minted identities, so `FOO:BAR` reaches web and is answered with nothing.
    // ⭐ "SERVED BY THE WEB POD", which is what this flag has always actually meant:
    // breadth (`UCT*`), any namespaced identity (a colon), and the bare-word market
    // indicators that have no syntax to recognise them by.
    const isBreadth = ticker.startsWith("UCT")
      || ticker.includes(":")
      || MARKET_INDICATOR_SYMBOLS.has(ticker);

    const headers = new Headers(request.headers);
    headers.delete("host");

    // ── SHADOW ENTITLEMENT CHECK — observes, never decides ──────────────────
    // ⛔ WRAPPED SO IT CANNOT REACH THE ROUTING PATH. If anything in here throws
    // — a bad secret binding, a malformed header, a runtime quirk — the request
    // must still be served exactly as before. An observability feature that can
    // break traffic is worse than no observability.
    try {
      const cls = await classifyRequest(request, env && env.CHART_EDGE_SECRET);
      // ⚠️ SAFE FIELDS ONLY: a classification and a route family. No token, no
      // cookie, no secret, no session id, no user id, no email. The ticker is
      // already in the URL these logs accompany, so `family` is all that is
      // added, and it is the thing Phase 2 needs to read.
      console.log(JSON.stringify({
        evt: "edge_entitlement",
        cls,
        family: isBreadth ? "breadth" : "bars",
        method: request.method,
      }));
      const stripped = stripEdgeCookie(request.headers.get("cookie"));
      if (stripped === null) headers.delete("cookie");
      else headers.set("cookie", stripped);
      // ⛔ The render capability dies at the edge that verifies it. bars-api has
      // no use for it and must never become a place it can be replayed from.
      headers.delete(SERVICE_HEADER);
    } catch (_e) {
      // Deliberately silent: shadow mode owes production nothing.
    }

    const target = (origin) => origin + url.pathname + url.search;
    const opts = { method: request.method, headers, redirect: "manual" };

    if (isBreadth) return fetch(target(WEB_ORIGIN), opts);

    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), BARS_TIMEOUT_MS);
      const r = await fetch(target(BARS_ORIGIN), { ...opts, signal: ac.signal });
      clearTimeout(t);
      if (r.status >= 500) throw new Error("bars-api " + r.status);
      const out = new Response(r.body, r); out.headers.set("X-Bars-Edge", "tier"); return out;
    } catch (_e) {
      const r = await fetch(target(WEB_ORIGIN), opts);
      const out = new Response(r.body, r); out.headers.set("X-Bars-Edge", "web-fallback"); return out;
    }
  },
};
