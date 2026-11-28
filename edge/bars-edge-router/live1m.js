/**
 * Universe minute frames at the edge: `/api/hist/live1m/v1/...` served straight from R2.
 *
 *   /api/hist/live1m/v1/<YYYY-MM-DD>/head.json    newest frame published, newest inside today.bin
 *   /api/hist/live1m/v1/<YYYY-MM-DD>/<HHMM>.bin   one minute: every symbol's closed 1m bar
 *   /api/hist/live1m/v1/<YYYY-MM-DD>/today.bin    every frame of the day so far
 *
 * stream-ingest publishes them (api/services/minute_frame_publisher.py, format in
 * api/services/minute_frames.py) to the R2 bucket bound here as `LIVE1M`, under
 * `live1m/<date>/...` (`env.LIVE1M_PREFIX` overrides the prefix). The browser reads them once a
 * minute (app/src/lib/minuteFrames/consumer.js) to keep every symbol on the device current.
 *
 * WHY UNDER /api/hist/. The member's edge entitlement cookie is path-scoped (api/chart_edge_token.py:
 * `Path=/api/bars`, `/api/hist`, `/api/stream/bars`, each exactly one Worker route), and the
 * `/api/hist/*` Worker Route is already live. Under it, this surface needs NO new cookie scope
 * and NO new route: only this file deployed with worker.js and the bucket bound. A path of its
 * own would mean widening the cookie's scope, which is a security-reviewed change.
 *
 * WHAT IS SENT. Objects are stored gzip. A browser gets the stored bytes with `Content-Encoding:
 * gzip` (`encodeBody: "manual"`, so Cloudflare passes them through) and its HTTP layer inflates
 * them natively; `?raw=1` returns the gzip bytes as a plain body for a client that inflates
 * itself. No Brotli anywhere.
 *
 * CACHING. A minute file is written ONCE (the publisher never republishes a seq), so it is
 * answered `immutable` and the Worker keeps a copy in the data center's Cache API, read only
 * after the entitlement check (the history.js pattern): every member of a data center costs
 * R2 one read per minute, not one each. A 404 is never cached anywhere (the minute is simply not out yet).
 *
 * ⭐ head.json and today.bin CHANGE, and at 500 members polling once a minute an uncached head was ~22M R2
 * reads a month (2026-11-28 capacity plan). So the data center keeps head.json for HEAD_EDGE_TTL (2 s: a head
 * is at most 2 s late) and today.bin for TODAY_EDGE_TTL (60 s) KEYED BY THE HEAD'S `today_seq`: the publisher
 * writes today.bin BEFORE the head that names it (api/services/minute_frame_publisher.py flush order), so a
 * copy filed under seq S holds at least S, and a new roll is a new key at once. A head that cannot be read or
 * names no seq means today.bin is read from R2 and not kept. The BROWSER still gets `no-store` for both.
 *
 * ENTITLEMENT IS ENFORCED (valid member cookie or valid service header, else 401), exactly as on
 * the history lake.
 */

export const LIVE1M_PREFIX = "/api/hist/live1m/";
export const EDGE_KEY_PATH = "/api/hist/live1m/__edge/";
export const FRAME_TYPE = "application/vnd.uct.umf";
export const TODAY_TYPE = "application/vnd.uct.umt";
/** A minute file's edge copy: a day is plenty (the date is in the key; the bucket expires it). */
export const FRAME_EDGE_TTL = 86400;
/** head.json's edge copy (seconds): the most a head can be late. */
export const HEAD_EDGE_TTL = 2;
/** today.bin's edge copy (seconds), filed under the head's `today_seq`. */
export const TODAY_EDGE_TTL = 60;

const DATE_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const HHMM_RE = /^([01]\d|2[0-3])([0-5]\d)\.bin$/;

/** What a live1m path names, or null. Nothing from the URL reaches the bucket except through
 *  these patterns. Minute files exist only for 04:00-19:59 ET. */
export function parseLive1mPath(pathname) {
  if (typeof pathname !== "string" || !pathname.startsWith(LIVE1M_PREFIX)) return null;
  const parts = pathname.slice(LIVE1M_PREFIX.length).split("/");
  if (parts.length !== 3 || parts[0] !== "v1" || !DATE_RE.test(parts[1])) return null;
  const [, date, file] = parts;
  if (file === "head.json") return { kind: "head", rel: `${date}/head.json` };
  if (file === "today.bin") return { kind: "today", rel: `${date}/today.bin` };
  const m = HHMM_RE.exec(file);
  if (!m) return null;
  const mod = Number(m[1]) * 60 + Number(m[2]);
  if (mod < 240 || mod >= 1200) return null;
  return { kind: "frame", rel: `${date}/${file}` };
}

function plain(status, error, extra = {}) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", "x-bars-edge": "live1m", ...extra },
  });
}

function defaultCache() {
  try { return typeof caches !== "undefined" && caches.default ? caches.default : null; } catch (_e) { return null; }
}

const isGzip = (b) => b.length > 18 && b[0] === 0x1f && b[1] === 0x8b;

/**
 * Answer one `/api/hist/live1m/` request.
 * `entitled` is `async (request) => boolean`: the caller's cryptographic check (worker.js).
 */
export async function handleLive1m(request, env, entitled, ctx, { cache = defaultCache() } = {}) {
  const url = new URL(request.url);
  if (request.method !== "GET" && request.method !== "HEAD") return plain(405, "method_not_allowed", { allow: "GET, HEAD" });
  const what = parseLive1mPath(url.pathname);
  if (!what) return plain(404, "not_found");
  let ok = false;
  try { ok = (await entitled(request)) === true; } catch (_e) { ok = false; }
  if (!ok) return plain(401, "not_entitled");
  const bucket = env && env.LIVE1M;
  if (!bucket) return plain(503, "live1m_not_configured", { "retry-after": "30" });
  const prefix = typeof env.LIVE1M_PREFIX === "string" ? env.LIVE1M_PREFIX : "live1m/";
  const key = prefix + what.rel;
  const head = request.method === "HEAD";

  const edgeKey = (k, q = "") => `${url.origin}${EDGE_KEY_PATH}${encodeURI(k)}${q}`;
  const fromCache = async (ck) => {
    if (!ck || !cache) return null;
    try {
      const hit = await cache.match(ck);
      return hit ? new Uint8Array(await hit.arrayBuffer()) : null;
    } catch (_e) { return null; }                  // a broken cache is a miss
  };
  const keep = (ck, data, ttl) => {
    if (!ck || !cache) return;
    const put = Promise.resolve().then(() => cache.put(ck, new Response(data, {
      headers: { "cache-control": `public, max-age=${ttl}`, "content-type": "application/octet-stream" },
    }))).catch(() => {});
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(put);
  };
  const fromR2 = async (k) => {
    const obj = await bucket.get(k);
    return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
  };

  let ck = null;
  let ttl = FRAME_EDGE_TTL;
  if (what.kind === "frame") ck = edgeKey(key);
  else if (what.kind === "head") { ck = edgeKey(key); ttl = HEAD_EDGE_TTL; }
  else if (what.kind === "today" && cache) {
    // today.bin is filed under the seq the CURRENT head names (itself at most HEAD_EDGE_TTL late)
    const hk = prefix + what.rel.replace(/today\.bin$/, "head.json");
    let headBytes = await fromCache(edgeKey(hk));
    if (!headBytes) {
      try { headBytes = await fromR2(hk); if (headBytes) keep(edgeKey(hk), headBytes, HEAD_EDGE_TTL); } catch (_e) { headBytes = null; }
    }
    let seq = null;
    try { seq = headBytes ? JSON.parse(new TextDecoder().decode(headBytes)).today_seq : null; } catch (_e) { seq = null; }
    if (Number.isInteger(seq) && seq >= 0) { ck = edgeKey(key, `?today_seq=${seq}`); ttl = TODAY_EDGE_TTL; }
  }

  let bytes = await fromCache(ck);
  const fromEdge = !!bytes;
  if (!bytes) {
    try {
      bytes = await fromR2(key);
    } catch (_e) {
      return plain(503, "live1m_unavailable", { "retry-after": "2" });
    }
    if (!bytes) return plain(404, "not_published");
  }

  if (what.kind === "head") {
    if (!fromEdge) {
      let okHead = false;
      try { okHead = !!JSON.parse(new TextDecoder().decode(bytes)); } catch (_e) { okHead = false; }
      if (okHead) keep(ck, bytes, ttl);
    }
    return new Response(head ? null : bytes, {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store",
                 "x-bars-edge": fromEdge ? "live1m-edge" : "live1m" },
    });
  }
  if (!isGzip(bytes)) return plain(502, "live1m_bad_object");
  if (ck && !fromEdge) keep(ck, bytes, ttl);
  const cacheControl = what.kind === "frame" ? "private, max-age=86400, immutable" : "no-store";
  const base = { "cache-control": cacheControl, "x-bars-edge": fromEdge ? "live1m-edge" : "live1m" };
  if (url.searchParams.get("raw") === "1") {
    return new Response(head ? null : bytes, { status: 200, headers: { ...base, "content-type": "application/gzip" } });
  }
  return new Response(head ? null : bytes, {
    status: 200,
    // The body is ALREADY gzip: Cloudflare must pass it through untouched, the browser inflates it.
    encodeBody: "manual",
    headers: { ...base, "content-type": what.kind === "frame" ? FRAME_TYPE : TODAY_TYPE, "content-encoding": "gzip" },
  });
}
