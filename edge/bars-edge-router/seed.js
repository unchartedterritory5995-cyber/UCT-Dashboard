/**
 * First-frame seed at the edge: `/api/seed/v1/...` served straight from R2, never through the web pod.
 *
 *   /api/seed/v1/latest.json              the manifest: build id, as-of session, per-timeframe url/bytes/sha256
 *   /api/seed/v1/<build>/<tf>.ffs         one timeframe's whole pack (docs/charts/first-frame-seed-format.md)
 *
 * WHY THE EDGE. Every member downloads every pack (tens of MB) once per build. The web pod is one Python
 * process; a download that size per member would hold it for seconds each. Here an entitled request is one
 * R2 read (or this data center's Cache API copy), and no origin is asked at all.
 *
 * WHAT IS TRUSTED. Nothing from the URL reaches the bucket except through the two exact patterns below
 * (`<build>` = YYYYMMDDTHHMMZ, `<tf>` one of 1 5 15 30 60 D). The pack carries its own integrity: the
 * manifest's sha256 for the whole file and a column CRC per symbol, both checked on the device.
 *
 * CACHING. A pack URL names one immutable build: `private, max-age=31536000, immutable`. `private`
 * because it is entitled data and must never sit in a SHARED HTTP cache; the Worker keeps its own copy of
 * a whole pack in the data center's Cache API under /api/seed/__edge/ (a path only this Worker serves, so
 * the copy is reachable only through handleSeed, i.e. after the entitlement check, exactly as history.js
 * does for pieces). The manifest changes every build: `private, max-age=60`, never copied.
 *
 * RANGES. A single `Range: bytes=a-b` / `a-` / `-n` is answered 206 from R2 (resuming an interrupted
 * download); an unsatisfiable one 416. Ranged reads bypass the edge copy.
 *
 * ENTITLEMENT IS ENFORCED HERE, like /api/hist/: a valid member cookie or a valid service header, or 401.
 *
 * Bindings: `env.SEED` (R2 bucket; falls back to `env.HISTORY`), `env.SEED_PREFIX` (default "ffseed/",
 * the key prefix the worker's builder uploads under, api/services/ffseed.py).
 */

export const SEED_PREFIX_PATH = "/api/seed/";
export const PACK_TYPE = "application/vnd.uct.ffseed";
export const EDGE_KEY_PATH = "/api/seed/__edge/";
export const DEFAULT_PREFIX = "ffseed/";
export const PACK_EDGE_TTL = 31536000;
const FOREVER = "private, max-age=31536000, immutable";
const SHORT = "private, max-age=60";
const BUILD_RE = /^\d{8}T\d{4}Z$/;
const TFS = new Set(["1", "5", "15", "30", "60", "D"]);

/** What a seed path names, or null when it is not exactly one of the two forms. */
export function parseSeedPath(pathname) {
  if (typeof pathname !== "string" || !pathname.startsWith(SEED_PREFIX_PATH)) return null;
  const parts = pathname.slice(SEED_PREFIX_PATH.length).split("/");
  if (parts[0] !== "v1") return null;
  if (parts.length === 2 && parts[1] === "latest.json") return { kind: "manifest", key: "latest.json" };
  if (parts.length === 3 && BUILD_RE.test(parts[1]) && parts[2].endsWith(".ffs")) {
    const tf = parts[2].slice(0, -4);
    if (!TFS.has(tf)) return null;
    return { kind: "pack", key: `${parts[1]}/${tf}.ffs`, build: parts[1], tf };
  }
  return null;
}

/** One `bytes=` range of an object of `size` bytes: {offset, length}, null (no Range header), or
 *  "unsatisfiable". Multi-range and malformed headers are treated as no Range (the whole object). */
export function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") {                                   // suffix: the last n bytes
    const n = Number(m[2]);
    if (!Number.isSafeInteger(n) || n <= 0) return "unsatisfiable";
    const len = Math.min(n, size);
    return { offset: size - len, length: len };
  }
  const a = Number(m[1]);
  const b = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a >= size || b < a) return "unsatisfiable";
  return { offset: a, length: b - a + 1 };
}

function plain(status, error, extra = {}) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", "x-bars-edge": "seed", ...extra },
  });
}

function defaultCache() {
  try { return typeof caches !== "undefined" && caches.default ? caches.default : null; } catch (_e) { return null; }
}

/** The Cache API key for one pack, on a path only this Worker serves. */
export function edgeCacheKey(origin, key) {
  return `${origin}${EDGE_KEY_PATH}${encodeURI(key)}`;
}

function packHeaders(extra) {
  return { "content-type": PACK_TYPE, "cache-control": FOREVER, "accept-ranges": "bytes", ...extra };
}

/**
 * Answer one `/api/seed/` request. `entitled` is `async (request) => boolean`: worker.js's cryptographic
 * check. `opts.cache` overrides the Cache API (tests).
 */
export async function handleSeed(request, env, entitled, ctx, { cache = defaultCache() } = {}) {
  const url = new URL(request.url);
  if (request.method !== "GET" && request.method !== "HEAD") return plain(405, "method_not_allowed", { allow: "GET, HEAD" });
  const what = parseSeedPath(url.pathname);
  if (!what) return plain(404, "not_found");
  let ok = false;
  try { ok = (await entitled(request)) === true; } catch (_e) { ok = false; }
  if (!ok) return plain(401, "not_entitled");
  const bucket = env && (env.SEED || env.HISTORY);
  if (!bucket) return plain(503, "seed_not_configured", { "retry-after": "30" });
  const key = (typeof env.SEED_PREFIX === "string" ? env.SEED_PREFIX : DEFAULT_PREFIX) + what.key;
  const head = request.method === "HEAD";

  try {
    if (what.kind === "manifest") {
      const obj = await bucket.get(key);
      if (!obj) return plain(404, "no_seed_published", { "cache-control": SHORT });
      return new Response(head ? null : obj.body, {
        status: 200, headers: { "content-type": "application/json", "cache-control": SHORT, "x-bars-edge": "seed" },
      });
    }

    const rangeHeader = request.headers.get("range");
    if (rangeHeader) {
      const meta = await bucket.head(key);
      if (!meta) return plain(404, "no_such_pack", { "cache-control": SHORT });
      const r = parseRange(rangeHeader, meta.size);
      if (r === "unsatisfiable") return plain(416, "range_not_satisfiable", { "content-range": `bytes */${meta.size}` });
      if (r) {
        const obj = await bucket.get(key, { range: { offset: r.offset, length: r.length } });
        if (!obj) return plain(404, "no_such_pack", { "cache-control": SHORT });
        return new Response(head ? null : obj.body, {
          status: 206,
          headers: packHeaders({
            "content-length": String(r.length), "content-range": `bytes ${r.offset}-${r.offset + r.length - 1}/${meta.size}`,
            "x-bars-edge": "seed",
          }),
        });
      }
    }

    const ck = cache ? edgeCacheKey(url.origin, key) : null;
    if (ck) {
      try {
        const hit = await cache.match(ck);
        if (hit) {
          return new Response(head ? null : hit.body, {
            status: 200,
            headers: packHeaders({ "content-length": hit.headers.get("content-length") || "", "x-bars-edge": "seed-edge" }),
          });
        }
      } catch (_e) { /* a broken cache is a miss */ }
    }
    if (head) {
      const meta = await bucket.head(key);
      if (!meta) return plain(404, "no_such_pack", { "cache-control": SHORT });
      return new Response(null, { status: 200, headers: packHeaders({ "content-length": String(meta.size), "x-bars-edge": "seed" }) });
    }
    const obj = await bucket.get(key);
    if (!obj) return plain(404, "no_such_pack", { "cache-control": SHORT });
    let body = obj.body;
    if (ck && body && typeof body.tee === "function") {
      const [toClient, toCache] = body.tee();
      body = toClient;
      const put = Promise.resolve().then(() => cache.put(ck, new Response(toCache, {
        headers: { "cache-control": `public, max-age=${PACK_EDGE_TTL}`, "content-type": PACK_TYPE, "content-length": String(obj.size) },
      }))).catch(() => {});
      if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(put);
    }
    return new Response(body, { status: 200, headers: packHeaders({ "content-length": String(obj.size), "x-bars-edge": "seed" }) });
  } catch (_e) {
    return plain(503, "seed_unavailable", { "retry-after": "2" });
  }
}
