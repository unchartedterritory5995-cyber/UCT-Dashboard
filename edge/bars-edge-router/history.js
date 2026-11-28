/**
 * Deep intraday history at the edge: `/api/hist/v1/...` served straight from R2.
 *
 *   /api/hist/v1/index/<s-SYMBOL>.json                           which pieces a symbol has, and where
 *   /api/hist/v1/<series>/<s-SYMBOL>/<period>.ubh?c=&o=&n=       one piece (tools/history_lake/FORMAT.md)
 *
 * No origin is involved: an entitled request is answered from the `HISTORY` R2 bucket, so a chart's
 * deep history does not depend on the web pod or the bars tier being up, warm or unloaded.
 *
 * WHERE A PIECE LIVES. Pieces are stored in PACKS (tools/history_lake/pack.py): every symbol's piece
 * of one series and one period in one object, `packs/<series>/<period>.pack`. The symbol's index
 * gives each piece's offset (`off`) and length (`bytes`); the client sends them as `o` and `n`, and
 * the piece is ONE ranged read of the pack. Nothing from the client is trusted: the bytes read must
 * be a whole piece whose own header names this symbol, series and period (and `c`, its CRC), or the
 * answer is 409 (the client's index is older than the pack: it re-reads the index).
 *
 * HOW A PIECE IS SENT. A piece is a small plain header followed by ONE Brotli stream of columns.
 * Page code in Chrome cannot inflate Brotli (`new DecompressionStream('brotli')` throws, measured on
 * Chrome 157, 2026-11-16), but every browser's HTTP layer can. So for a client that accepts `br` the
 * response BODY is the piece's Brotli stream, as stored, with `Content-Encoding: br`, and the piece's
 * header rides in `X-Ubh-Header` (compact JSON, ASCII). `fetch()` then hands the page the inflated
 * columns: native speed, off the main thread, no decoder shipped in the app.
 * `app/src/data/historyLake/piece.js` `decodeColumns` reads that pair, and the column CRC in the header
 * still proves every value end to end. `?raw=1` (or a client without `br`) gets the piece unchanged.
 *
 * CACHING. `c` (the piece's column CRC), `o` and `n` name one exact content: answered `immutable` for
 * a year. Everything is `private`: entitled data never sits in a shared cache. Indexes are short-lived.
 * The Worker keeps its own copy of each validated piece in the data center's Cache API, read only after
 * the entitlement check (readObject, below: "THE EDGE'S OWN COPY OF A PIECE").
 *
 * ENTITLEMENT IS ENFORCED HERE (unlike the shadow block on /api/bars): this is a new surface with no
 * anonymous traffic to break. A valid member cookie or a valid service header, or 401.
 *
 * `env.HISTORY_PREFIX` (optional) is prepended to every object key, so the lake can share a bucket.
 */

export const HIST_PREFIX = "/api/hist/";
export const HEADER_NAME = "X-Ubh-Header";
export const COLUMNS_TYPE = "application/vnd.uct.ubh-columns";
export const PIECE_TYPE = "application/vnd.uct.ubh";
/** The largest piece a request may ask for (a month of 1m bars of the busiest symbol is ~0.3 MB). */
export const MAX_PIECE_BYTES = 16 * 1024 * 1024;

const SERIES = new Set(["1", "5", "15", "30", "60", "60e"]);
const PERIOD_RE = { "1": /^\d{4}-(0[1-9]|1[0-2])$/, "5": /^\d{4}Q[1-4]$/ };
const YEAR_RE = /^\d{4}$/;
// `s-` + A-Z / 0-9, any other byte as `_` + two upper-case hex digits (piece.js encodeSymbol).
const SYMBOL_RE = /^s-(?:[A-Z0-9]|_[0-9A-F]{2}){1,64}$/;
const UINT_RE = /^(0|[1-9]\d{0,14})$/;

/** piece.js encodeSymbol: `s-` + the ticker, every byte outside A-Z / 0-9 as `_` + two hex digits. */
export function encodeSymbol(symbol) {
  let out = "s-";
  for (const b of new TextEncoder().encode(String(symbol))) {
    out += (b >= 48 && b <= 57) || (b >= 65 && b <= 90) ? String.fromCharCode(b) : "_" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

/** What a history path names, or null when the path is not exactly one of the two forms. Nothing
 *  from the URL reaches the bucket except through these patterns. */
export function parseHistoryPath(pathname) {
  if (typeof pathname !== "string" || !pathname.startsWith(HIST_PREFIX)) return null;
  const parts = pathname.slice(HIST_PREFIX.length).split("/");
  if (parts[0] !== "v1") return null;
  if (parts.length === 3 && parts[1] === "index") {
    if (!parts[2].endsWith(".json")) return null;
    const enc = parts[2].slice(0, -5);
    if (!SYMBOL_RE.test(enc)) return null;
    return { kind: "index", key: `v1/index/${enc}.json` };
  }
  if (parts.length === 4 && SERIES.has(parts[1])) {
    const [, series, enc, file] = parts;
    if (!SYMBOL_RE.test(enc) || !file.endsWith(".ubh")) return null;
    const period = file.slice(0, -4);
    if (!(PERIOD_RE[series] || YEAR_RE).test(period)) return null;
    return { kind: "piece", key: `packs/${series}/${period}.pack`, series, period, enc };
  }
  return null;
}

let CRC_TABLE = null;
/** Standard CRC-32 (the one the piece prefix carries). */
export function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/** Split a piece into its header JSON text and its Brotli body, without inflating. Returns null when
 *  the bytes do not start with a whole version 1 piece header: on the `br` path the client never sees
 *  the prefix, so the header (and its CRC) is proven HERE; the column CRC inside it proves the body
 *  in the browser. */
export function splitPiece(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 10) return null;
  if (bytes[0] !== 0x55 || bytes[1] !== 0x42 || bytes[2] !== 0x48 || bytes[3] !== 1) return null;
  const end = 6 + bytes[4] + 256 * bytes[5];
  if (bytes.length <= end + 4) return null;
  const stored = (bytes[end] + 256 * bytes[end + 1] + 65536 * bytes[end + 2] + 16777216 * bytes[end + 3]) >>> 0;
  if (crc32(bytes.subarray(0, end)) !== stored) return null;
  let headerJson;
  let header;
  try {
    headerJson = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(6, end));
    header = JSON.parse(headerJson);
  } catch (_e) {
    return null;
  }
  if (!header || typeof header !== "object" || !Number.isSafeInteger(header.crc)) return null;
  if (!/^[\x20-\x7e]+$/.test(headerJson)) return null;
  return { headerJson, header, body: bytes.subarray(end + 4) };
}

const acceptsBrotli = (request) =>
  (request.headers.get("accept-encoding") || "").split(",")
    .some((p) => { const [name, q] = p.trim().toLowerCase().split(";q="); return name === "br" && q !== "0"; });

function plain(status, error, extra = {}) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", "x-bars-edge": "history", ...extra },
  });
}

const SHORT = "private, max-age=60";
const FOREVER = "private, max-age=31536000, immutable";

/**
 * Answer one `/api/hist/` request.
 * `entitled` is `async (request) => boolean`: the caller's cryptographic check (worker.js).
 */
// ── THE EDGE'S OWN COPY OF A PIECE (2026-11-17) ────────────────────────────────────────────────────
// Pieces are answered `private` (entitled data never sits in a SHARED HTTP cache), so the CDN never kept
// one and every first read of a piece went to R2: measured through the live edge, 60-400 ms a piece,
// most of the time a chart's first deep window takes. The Workers Cache API keeps the RAW piece bytes
// in this data center, and the response is built from them exactly as from R2.
//
// What makes it safe, each one load-bearing:
//  - PIECES ONLY. An index changes on every republish and a client that gets 409 re-reads it; an edge
//    copy of an index would hand it the same stale index again. Indexes always come from R2.
//  - THE KEY CARRIES THE PIECE'S CRC (`c`), not only its place (o, n): a republished pack can put a new
//    piece at an old place, and a key without `c` would serve the old bytes against the new index for a
//    year (409 forever). With `c`, a new piece is a new key.
//  - ONLY BYTES THAT VALIDATED ARE KEPT (whole piece, this series, period and CRC), and cached bytes are
//    validated again on every read, exactly as R2's are.
//  - THE KEY LIVES UNDER /api/hist/, the path this Worker owns: a Worker runs IN FRONT of the CDN cache,
//    so no client request can reach the copy except through handleHistory, i.e. after the entitlement
//    check. (A key on an unrouted path could be answered by the CDN cache to anyone who asked for it.)
export const PIECE_EDGE_TTL = 31536000;
export const EDGE_KEY_PATH = "/api/hist/__edge/";

/** The cache key for one piece: the object, its symbol, its length and its CRC (2026-11-28: its CONTENT, not
 *  its place: a daily refresh moves unchanged pieces inside the rewritten pack, and an offset in the key made
 *  every one of them a miss), on a path only this Worker serves. Without a symbol (an older caller), the place. */
export function edgeCacheKey(origin, key, range) {
  const who = range.enc ? `s=${range.enc}` : `o=${range.offset}`;
  return `${origin}${EDGE_KEY_PATH}${encodeURI(key)}?${who}&n=${range.length}&c=${range.crc}`;
}

function defaultCache() {
  try { return typeof caches !== "undefined" && caches.default ? caches.default : null; } catch (_e) { return null; }
}

// ── THE NETWORK'S COPY OF A PIECE: WORKERS CACHE, TIERED (2026-11-28) ─────────────────────────────
// The data center's copy above is per data center: measured 2026-11-28 through the live edge, a piece
// read first at a data center cost 166-578 ms (R2: the lake's old periods are cold in R2 itself), and
// 16-21 ms once that data center held it. Cache Reserve and the zone's Tiered Cache never see a Worker's
// R2 reads or the Cache API. WORKERS CACHE does: a cache in front of a named entrypoint of THIS Worker,
// tiered by default (a lower tier per data center, an upper tier that every lower tier asks on a miss),
// so a piece read once anywhere is an upper-tier hit at every other data center.
//
// What makes it safe, each one load-bearing:
//  - THE CACHED ENTRYPOINT HAS NO ROUTE. `LakePiece` (entry.js) is reachable only through
//    `ctx.exports.LakePiece`, called by handleHistory AFTER the entitlement check. No hostname, route or
//    workers.dev URL reaches it, so nothing anonymous can read the cache behind it.
//  - ITS KEY IS THE EXACT CONTENT, NOT ITS PLACE: object, symbol, length and CRC (`cf.cacheKey`, below).
//    A daily refresh rewrites the current period's pack and moves almost every piece in it; a key with the
//    offset would send every one of them cold to R2 after each refresh. Without it, only a piece whose bytes
//    changed (a new CRC) is a new key. The offset rides in the request path, for a fill only.
//  - LakePiece checks the bytes it fills with are THIS symbol's piece of that series and period with that
//    CRC, so no request can file another symbol's bytes under a symbol's key.
//  - ONLY A VALIDATED WHOLE PIECE IS CACHEABLE (200, `public`, a year). Everything else is `no-store`:
//    Workers Cache would otherwise keep a 404 for 3 minutes by default.
//  - THE GATEWAY STILL VALIDATES what comes back (symbol, series, period, CRC) exactly as from R2, and
//    any failure of this path is a plain R2 read: it can make a piece faster, never wrong or missing.
//  - `env.LAKE_TIER === "0"` turns it off (a plain variable, no code change).
export const LAKE_ENTRY = "LakePiece";
export const LAKE_PIECE_ORIGIN = "https://lake-piece.internal";
const LAKE_PATH_RE = /^\/p\/((?:(?!\.{1,2}\/)[A-Za-z0-9_.-]+\/)*packs\/(1|5|15|30|60|60e)\/([0-9Q-]+)\.pack)\/(s-(?:[A-Z0-9]|_[0-9A-F]{2}){1,64})\/(0|[1-9]\d{0,14})\/([1-9]\d{0,14})\/(0|[1-9]\d{0,14})$/;

/** The cached entrypoint's path for one piece: the object, the symbol, its place and its CRC. */
export function lakePiecePath(key, range) {
  return `/p/${key}/${range.enc}/${range.offset}/${range.length}/${range.crc}`;
}

/** The piece's Workers Cache key: its CONTENT (object, symbol, length, CRC), never its offset. */
export function lakeCacheKey(key, range) {
  return `/p/${key}/${range.enc}/${range.length}/${range.crc}`;
}

/** What a cached-entrypoint path names, or null. Nothing else reaches the bucket from there. */
export function parseLakePiecePath(pathname) {
  const m = LAKE_PATH_RE.exec(String(pathname || ""));
  if (!m) return null;
  const [, key, series, period, enc, o, n, c] = m;
  if (!(PERIOD_RE[series] || YEAR_RE).test(period)) return null;
  const range = { offset: Number(o), length: Number(n), crc: Number(c), enc };
  if (range.length < 10 || range.length > MAX_PIECE_BYTES) return null;
  return { key, series, period, range };
}

function lakeRefusal(status, error) {
  return new Response(JSON.stringify({ error }), {
    status, headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** The `LakePiece` entrypoint (entry.js): one piece, read from R2 at its place, answered cacheable ONLY
 *  when the bytes are a whole piece of that series and period carrying that CRC. Never routed. */
export async function serveLakePiece(request, env) {
  if (request.method !== "GET" && request.method !== "HEAD") return lakeRefusal(405, "method_not_allowed");
  const what = parseLakePiecePath(new URL(request.url).pathname);
  if (!what) return lakeRefusal(404, "not_found");
  const bucket = env && env.HISTORY;
  if (!bucket) return lakeRefusal(503, "history_not_configured");
  let obj;
  try {
    obj = await bucket.get(what.key, { range: { offset: what.range.offset, length: what.range.length } });
  } catch (_e) {
    return lakeRefusal(503, "history_unavailable");
  }
  if (!obj) return lakeRefusal(404, "no_such_piece");
  const bytes = new Uint8Array(await obj.arrayBuffer());
  const piece = bytes.length === what.range.length ? splitPiece(bytes) : null;
  const h = piece && piece.header;
  if (!h || h.series !== what.series || h.period !== what.period || h.crc !== what.range.crc
      || encodeSymbol(h.symbol) !== what.range.enc) {
    return lakeRefusal(409, "piece_changed");
  }
  return new Response(request.method === "HEAD" ? null : bytes, {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": `public, max-age=${PIECE_EDGE_TTL}, immutable`,
      "x-lake-filled": String(Date.now()),
    },
  });
}

/** `(key, range) => Promise<Response>` through the cached entrypoint, or null when it is not there
 *  (an older runtime, the tests' plain Worker) or turned off. */
export function lakeTier(env, ctx) {
  if (env && env.LAKE_TIER === "0") return null;
  const entry = ctx && ctx.exports && ctx.exports[LAKE_ENTRY];
  if (!entry || typeof entry.fetch !== "function") return null;
  return (key, range) => entry.fetch(new Request(LAKE_PIECE_ORIGIN + lakePiecePath(key, range)),
    { cf: { cacheKey: lakeCacheKey(key, range) } });
}

/** The bytes for (key, range): a piece through this data center's copy, an index (range null) from R2
 *  always. `keep()` stores a piece's bytes once the caller has validated them. Null: R2 has no object.
 *  A cache that fails (or is absent) is simply not used. `lake`: the tiered copy (lakeTier), asked on a
 *  data-center miss; anything but a 200 from it is a plain R2 read. */
export async function readObject(bucket, key, range, { origin, ctx, cache = defaultCache(), lake = null } = {}) {
  const ck = cache && range ? edgeCacheKey(origin, key, range) : null;
  if (ck) {
    try {
      const hit = await cache.match(ck);
      if (hit) return { bytes: new Uint8Array(await hit.arrayBuffer()), cached: true, keep() {} };
    } catch (_e) { /* a broken cache is a miss */ }
  }
  let bytes = null;
  let tier = null;
  if (lake && range) {
    try {
      const r = await lake(key, range);
      if (r && r.status === 200) {
        bytes = new Uint8Array(await r.arrayBuffer());
        const filled = Number(r.headers.get("x-lake-filled"));
        tier = { filled: Number.isFinite(filled) ? filled : null };
      } else if (r && r.body) {
        try { await r.body.cancel(); } catch (_e) { /* nothing to release */ }
      }
    } catch (_e) { bytes = null; tier = null; }   // the tier failing is a plain R2 read
  }
  if (!bytes) {
    const obj = await bucket.get(key, range ? { range: { offset: range.offset, length: range.length } } : undefined);
    if (!obj) return null;
    bytes = new Uint8Array(await obj.arrayBuffer());
  }
  const keep = () => {
    if (!ck) return;
    const put = Promise.resolve().then(() => cache.put(ck, new Response(bytes, {
      headers: { "cache-control": `public, max-age=${PIECE_EDGE_TTL}`, "content-type": "application/octet-stream" },
    }))).catch(() => {});
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(put);
  };
  return { bytes, cached: false, tier, keep };
}

export async function handleHistory(request, env, entitled, ctx) {
  const url = new URL(request.url);
  if (request.method !== "GET" && request.method !== "HEAD") return plain(405, "method_not_allowed", { allow: "GET, HEAD" });
  const what = parseHistoryPath(url.pathname);
  if (!what) return plain(404, "not_found");
  let range = null;
  if (what.kind === "piece") {
    const o = url.searchParams.get("o"), n = url.searchParams.get("n"), c = url.searchParams.get("c");
    if (!UINT_RE.test(o || "") || !UINT_RE.test(n || "") || !UINT_RE.test(c || "")) return plain(400, "piece_needs_c_o_n");
    range = { offset: Number(o), length: Number(n), crc: Number(c), enc: what.enc };
    if (range.length < 10 || range.length > MAX_PIECE_BYTES) return plain(400, "piece_length_out_of_range");
  }
  let ok = false;
  try { ok = (await entitled(request)) === true; } catch (_e) { ok = false; }
  if (!ok) return plain(401, "not_entitled");
  const bucket = env && env.HISTORY;
  if (!bucket) return plain(503, "history_not_configured", { "retry-after": "30" });
  const key = (typeof env.HISTORY_PREFIX === "string" ? env.HISTORY_PREFIX : "") + what.key;

  let got;
  try {
    got = await readObject(bucket, key, range, { origin: url.origin, ctx, lake: lakeTier(env, ctx) });
  } catch (_e) {
    return plain(503, "history_unavailable", { "retry-after": "2" });
  }
  if (!got) return plain(404, "no_such_piece", { "cache-control": SHORT });
  const bytes = got.bytes;
  const head = request.method === "HEAD";

  if (what.kind === "index") {
    return new Response(head ? null : bytes, {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": SHORT, "x-bars-edge": "history" },
    });
  }

  // The bytes at (o, n) must be exactly this symbol's piece of this series and period, with this CRC.
  // Anything else means the client's index is older than the pack: 409, re-read the index.
  const piece = bytes.length === range.length ? splitPiece(bytes) : null;
  const h = piece && piece.header;
  if (!h || h.series !== what.series || h.period !== what.period || encodeSymbol(h.symbol) !== what.enc
      || h.crc !== range.crc) {
    return plain(409, "piece_changed");
  }
  got.keep();
  // history-edge: this data center's copy; history-tier: the network's copy (Workers Cache, a fill or a
  // hit); history: R2 itself. `x-lake-filled` says when the network's copy was made (a measurement aid).
  const via = got.cached ? "history-edge" : got.tier ? "history-tier" : "history";
  const base = { "cache-control": FOREVER, "x-bars-edge": via, vary: "Accept-Encoding" };
  if (got.tier && got.tier.filled != null) base["x-lake-filled"] = String(got.tier.filled);
  if (url.searchParams.get("raw") === "1" || !acceptsBrotli(request)) {
    return new Response(head ? null : bytes, { status: 200, headers: { ...base, "content-type": PIECE_TYPE } });
  }
  return new Response(head ? null : piece.body, {
    status: 200,
    // `encodeBody: "manual"`: the body is ALREADY Brotli; Cloudflare must pass it through untouched.
    encodeBody: "manual",
    headers: { ...base, "content-type": COLUMNS_TYPE, "content-encoding": "br", [HEADER_NAME]: piece.headerJson },
  });
}
