/**
 * /api/hist/ (history.js): pieces built by the PYTHON encoder (the app's synthetic fixture) are put
 * into packs in a stand-in bucket, asked for through the real Worker entry point by their place in
 * the pack, sent over a REAL HTTP connection, inflated by the HTTP client's own `Content-Encoding: br`
 * handling (the step a browser does), and decoded by the app's reader. Values must equal the fixture's.
 *
 * Run: node --test   (from edge/bars-edge-router/)
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";

import worker from "./worker.js";
import {
  parseHistoryPath, splitPiece, handleHistory, crc32, encodeSymbol, HEADER_NAME, COLUMNS_TYPE, PIECE_TYPE, MAX_PIECE_BYTES,
  HIST_PREFIX, edgeCacheKey, readObject,
} from "./history.js";
import { decodeColumns, decodePiece, encodeSymbol as appEncodeSymbol } from "../../app/src/data/historyLake/piece.js";

const FIX = JSON.parse(readFileSync(
  new URL("../../app/src/data/historyLake/__fixtures__/pieces.json", import.meta.url), "utf8"));
const CASES = FIX.cases;
const SECRET = "test-edge-secret";
const bytesOf = (b64) => new Uint8Array(Buffer.from(b64, "base64"));

// packs/<series>/<period>.pack: the fixture's pieces of each period, one after the other
const PACKS = new Map();
const PLACE = new Map();           // case name -> { key, off, n }
for (const c of CASES) {
  const key = `packs/${c.series}/${c.period}.pack`;
  const prev = PACKS.get(key) || new Uint8Array(0);
  const blob = bytesOf(c.b64);
  const next = new Uint8Array(prev.length + blob.length);
  next.set(prev); next.set(blob, prev.length);
  PACKS.set(key, next);
  PLACE.set(c.name, { key, off: prev.length, n: blob.length });
}
const pathOf = (c, { crc = c.header.crc, off = PLACE.get(c.name).off, n = PLACE.get(c.name).n } = {}) =>
  `/api/hist/${c.relpath}?c=${crc}&o=${off}&n=${n}`;

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

function bucket(extra = {}, prefix = "") {
  const store = new Map([...PACKS].map(([k, v]) => [prefix + k, v]));
  store.set(`${prefix}v1/index/s-ZZTEST.json`, new TextEncoder().encode('{"symbol":"ZZTEST","series":{},"v":1}'));
  for (const [k, v] of Object.entries(extra)) store.set(k, v);
  const asked = [];
  return {
    asked,
    async get(key, opts) {
      asked.push(opts && opts.range ? `${key}@${opts.range.offset}+${opts.range.length}` : key);
      let v = store.get(key);
      if (v === undefined) return null;
      if (v instanceof Error) throw v;
      if (opts && opts.range) v = v.subarray(opts.range.offset, opts.range.offset + opts.range.length);   // what exists of the range
      return { arrayBuffer: async () => v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) };
    },
  };
}

async function ask(path, { cookie = true, headers = {}, method = "GET", env } = {}) {
  const h = { "accept-encoding": "gzip, deflate, br", ...headers };
  if (cookie === true) h.cookie = `uct_session=abc; uct_chart_edge=${await mint()}`;
  else if (cookie) h.cookie = cookie;
  const e = env || { CHART_EDGE_SECRET: SECRET, HISTORY: bucket() };
  const realFetch = globalThis.fetch;
  const origins = [];
  globalThis.fetch = async (input) => { origins.push(String(input.url || input)); return new Response("origin"); };
  try {
    const res = await worker.fetch(new Request("https://uctintelligence.com" + path, { method, headers: h }), e);
    return { res, origins, env: e };
  } finally {
    globalThis.fetch = realFetch;
  }
}

/** Send a Worker response's status, headers and exact body bytes over real HTTP, fetch it back. */
async function overTheWire(res) {
  const raw = Buffer.from(await res.arrayBuffer());
  const server = http.createServer((_req, out) => {
    const headers = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    out.writeHead(res.status, headers);
    out.end(raw);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const got = await fetch(`http://127.0.0.1:${server.address().port}/`);
    return { got, body: new Uint8Array(await got.arrayBuffer()), sent: raw };
  } finally {
    server.close();
  }
}

test("the fixture puts two pieces in one pack, so offsets are really exercised", () => {
  const inNov = CASES.filter((c) => c.series === "1" && c.period === "2026-11");
  assert.equal(inNov.length, 2);
  assert.ok(PLACE.get(inNov[1].name).off > 0);
});

test("every fixture piece survives pack -> worker range read -> HTTP br -> reader, value for value", async () => {
  for (const c of CASES) {
    const { res, origins, env } = await ask(pathOf(c));
    assert.equal(res.status, 200, c.name);
    assert.deepEqual(origins, [], "history never asks an origin");
    const pl = PLACE.get(c.name);
    assert.deepEqual(env.HISTORY.asked, [`${pl.key}@${pl.off}+${pl.n}`]);
    assert.equal(res.headers.get("content-encoding"), "br");
    assert.equal(res.headers.get("content-type"), COLUMNS_TYPE);
    assert.equal(res.headers.get("cache-control"), "private, max-age=31536000, immutable");
    assert.equal(res.headers.get("x-bars-edge"), "history");
    assert.match(res.headers.get("vary"), /accept-encoding/i);

    const { got, body, sent } = await overTheWire(res);
    assert.deepEqual(new Uint8Array(sent), splitPiece(bytesOf(c.b64)).body, "the wire carries the stored stream");
    if (c.header.bars > 100) assert.ok(sent.length < body.length, "and it is smaller than what the page receives");
    assert.equal(body.length, c.header.body, "the HTTP layer inflated the body");
    const d = decodeColumns(got.headers.get(HEADER_NAME), body);
    assert.deepEqual(d.header, c.header);
    for (const col of ["t", "o", "h", "l", "c", "v", "n"]) {
      assert.deepEqual(Array.from(d[col]), c.columns[col], `${c.name}: column ${col}`);
    }
  }
});

test("raw form and a client without br get the piece unchanged", async () => {
  const c = CASES[1];
  const stored = bytesOf(c.b64);
  for (const [path, headers] of [
    [pathOf(c) + "&raw=1", {}],
    [pathOf(c), { "accept-encoding": "gzip" }],
    [pathOf(c), { "accept-encoding": "gzip, br;q=0" }],
  ]) {
    const { res } = await ask(path, { headers });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-encoding"), null);
    assert.equal(res.headers.get(HEADER_NAME), null);
    assert.equal(res.headers.get("content-type"), PIECE_TYPE);
    const got = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual(got, stored);
    const d = await decodePiece(got, (b) => new Uint8Array(brotliDecompressSync(b)));
    assert.deepEqual(Array.from(d.c), c.columns.c);
  }
});

test("only an entitled caller gets anything, and the bucket is not even asked otherwise", async () => {
  const path = pathOf(CASES[0]);
  const expired = await mint({ exp: Math.floor(Date.now() / 1000) - 5 });
  const wrongEnt = await mint({ ent: "service" });
  for (const cookie of [false, "uct_session=abc", `uct_chart_edge=${expired}`, `uct_chart_edge=${wrongEnt}`,
    "uct_chart_edge=v1.e30.AAAA"]) {
    const { res, env, origins } = await ask(path, { cookie });
    assert.equal(res.status, 401, String(cookie));
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(env.HISTORY.asked, []);
    assert.deepEqual(origins, []);
    assert.equal(res.headers.get(HEADER_NAME), null);
  }
  // a check that throws, or answers anything but true, is a no
  for (const fn of [async () => { throw new Error("boom"); }, async () => "yes", async () => 1]) {
    const b = bucket();
    const r = await handleHistory(new Request("https://uctintelligence.com" + path), { HISTORY: b }, fn);
    assert.equal(r.status, 401);
    assert.deepEqual(b.asked, []);
  }
  // a render capability in its header is entitled; the same token as a member cookie is not (above)
  const { res } = await ask(path, { cookie: false, headers: { "x-chart-edge-token": wrongEnt } });
  assert.equal(res.status, 200);
  const noSecret = await ask(path, { env: { HISTORY: bucket() } });
  assert.equal(noSecret.res.status, 401);
});

test("the bytes at (o, n) must be exactly this piece, or the index is out of date: 409", async () => {
  const [a, b] = CASES.filter((c) => c.series === "1" && c.period === "2026-11");
  const pb = PLACE.get(b.name);
  for (const path of [
    pathOf(a, { crc: a.header.crc + 1 }),                         // another CRC
    pathOf(a, { off: pb.off, n: pb.n }),                          // B's bytes under A's name and CRC
    pathOf(b, { off: pb.off + 1 }),                               // not the start of a piece
    pathOf(b, { n: pb.n + 100000 }),                              // past the end of the pack: a short read
    pathOf(CASES.find((c) => c.series === "60")).replace("/60/", "/60e/"),   // another series' pack
  ]) {
    const { res } = await ask(path);
    assert.equal(res.status, 409, path);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("content-encoding"), null);
  }
  assert.equal((await ask(pathOf(a))).res.status, 200);           // control: A asked properly
  assert.equal((await ask(pathOf(b))).res.status, 200);           // and B, which does not start the pack
});

test("the piece's own header must name the path: right CRC and place, wrong symbol, series or period is 409", async () => {
  const [a, b] = CASES.filter((c) => c.series === "1" && c.period === "2026-11");
  const pb = PLACE.get(b.name);
  const sixty = CASES.find((c) => c.series === "60");
  const p60 = PLACE.get(sixty.name);
  // the same bytes stored under other names, so the read itself succeeds
  const env = { CHART_EDGE_SECRET: SECRET, HISTORY: bucket({
    "packs/60e/2026.pack": PACKS.get(p60.key),
    "packs/1/2026-10.pack": PACKS.get(pb.key),
  }) };
  const q = (c, pl) => `?c=${c.header.crc}&o=${pl.off}&n=${pl.n}`;
  for (const path of [
    `/api/hist/${a.relpath}${q(b, pb)}`,                                        // B's piece asked as A
    `/api/hist/${sixty.relpath.replace("/60/", "/60e/")}${q(sixty, p60)}`,       // a 60 piece asked as 60e
    `/api/hist/${b.relpath.replace("2026-11", "2026-10")}${q(b, pb)}`,           // November asked as October
  ]) {
    const { res } = await ask(path, { env });
    assert.equal(res.status, 409, path);
  }
  assert.equal((await ask(`/api/hist/${b.relpath}${q(b, pb)}`, { env })).res.status, 200);   // control
});

test("c, o and n are required whole numbers within bounds, checked before entitlement or the bucket", async () => {
  const c = CASES[0];
  const base = `/api/hist/${c.relpath}`;
  for (const q of ["", `?c=${c.header.crc}`, `?c=${c.header.crc}&o=0`, `?o=0&n=10`, `?c=x&o=0&n=10`, `?c=1&o=-1&n=10`,
    `?c=1&o=0&n=9`, `?c=1&o=0&n=${MAX_PIECE_BYTES + 1}`, `?c=1&o=01&n=10`, `?c=1&o=0&n=1e3`, `?c=1&o=0.5&n=10`]) {
    const { res, env } = await ask(base + q, { cookie: false });
    assert.equal(res.status, 400, q);
    assert.deepEqual(env.HISTORY.asked, []);
  }
  assert.equal((await ask(`${base}?c=${c.header.crc}&o=0&n=${MAX_PIECE_BYTES}`)).res.status, 409);   // allowed size, wrong bytes
});

test("index, missing, unconfigured, failing bucket, prefix, wrong method, HEAD", async () => {
  const idx = await ask("/api/hist/v1/index/s-ZZTEST.json");
  assert.equal(idx.res.status, 200);
  assert.equal(idx.res.headers.get("content-type"), "application/json");
  assert.equal(idx.res.headers.get("cache-control"), "private, max-age=60");
  assert.equal((await idx.res.json()).symbol, "ZZTEST");
  assert.deepEqual(idx.env.HISTORY.asked, ["v1/index/s-ZZTEST.json"]);

  const missing = await ask("/api/hist/v1/5/s-NOPE/2020Q1.ubh?c=1&o=0&n=100");
  assert.equal(missing.res.status, 404);
  assert.deepEqual(missing.env.HISTORY.asked, ["packs/5/2020Q1.pack@0+100"]);

  const failEnv = { CHART_EDGE_SECRET: SECRET, HISTORY: bucket({ "packs/60/2020.pack": new Error("r2 down") }) };
  const failed = await ask("/api/hist/v1/60/s-ERR/2020.ubh?c=1&o=0&n=100", { env: failEnv });
  assert.equal(failed.res.status, 503);
  assert.ok(failed.res.headers.get("retry-after"));

  const unbound = await ask(pathOf(CASES[0]), { env: { CHART_EDGE_SECRET: SECRET } });
  assert.equal(unbound.res.status, 503);
  assert.equal((await unbound.res.json()).error, "history_not_configured");

  const prefixed = { CHART_EDGE_SECRET: SECRET, HISTORY: bucket({}, "hist/"), HISTORY_PREFIX: "hist/" };
  const viaPrefix = await ask(pathOf(CASES[0]), { env: prefixed });
  assert.equal(viaPrefix.res.status, 200);
  assert.match(prefixed.HISTORY.asked[0], /^hist\/packs\//);

  const post = await ask(pathOf(CASES[0]), { method: "POST" });
  assert.equal(post.res.status, 405);
  assert.deepEqual(post.env.HISTORY.asked, []);

  const head = await ask(pathOf(CASES[0]), { method: "HEAD" });
  assert.equal(head.res.status, 200);
  assert.equal(head.res.headers.get("content-encoding"), "br");
  assert.equal((await head.res.arrayBuffer()).byteLength, 0);
});

test("nothing but the two path forms reaches the bucket", async () => {
  const good = [
    ["/api/hist/v1/1/s-AAPL/2015-01.ubh", "packs/1/2015-01.pack"],
    ["/api/hist/v1/5/s-BRK_2EB/2015Q4.ubh", "packs/5/2015Q4.pack"],
    ["/api/hist/v1/60e/s-A/2003.ubh", "packs/60e/2003.pack"],
    ["/api/hist/v1/index/s-BAC_70B.json", "v1/index/s-BAC_70B.json"],
  ];
  for (const [path, key] of good) assert.equal(parseHistoryPath(path).key, key, path);
  assert.equal(parseHistoryPath("/api/hist/v1/5/s-BRK_2EB/2015Q4.ubh").enc, "s-BRK_2EB");
  const bad = [
    "/api/hist/v1/1/s-AAPL/2015.ubh", "/api/hist/v1/1/s-AAPL/2015-13.ubh", "/api/hist/v1/5/s-AAPL/2015-01.ubh",
    "/api/hist/v1/5/s-AAPL/2015Q5.ubh", "/api/hist/v1/15/s-AAPL/2015Q1.ubh", "/api/hist/v1/7/s-AAPL/2015.ubh",
    "/api/hist/v2/1/s-AAPL/2015-01.ubh", "/api/hist/v1/1/AAPL/2015-01.ubh", "/api/hist/v1/1/s-aapl/2015-01.ubh",
    "/api/hist/v1/1/s-AAPL/../2015-01.ubh", "/api/hist/v1/1/s-A%2F..%2Fx/2015-01.ubh", "/api/hist/v1/1/s-/2015-01.ubh",
    "/api/hist/v1/1/s-AAPL/2015-01.ubh/x", "/api/hist/v1/1/s-AAPL/2015-01", "/api/hist/v1/index/s-AAPL",
    "/api/hist/v1/index/s-AAPL.json/x", "/api/hist/ledger.json", "/api/hist/v1/_spill/x", "/api/hist/",
    "/api/hist/v1/1/s-A_2e/2015-01.ubh", "/api/history/v1/1/s-AAPL/2015-01.ubh",
    "/api/hist/v1/index/s-aapl.json", "/api/hist/v1/index/ledger.json", "/api/hist/v1/index/s-A.B.json",
    "/api/hist/packs/1/2015-01.pack", "/api/hist/v1/packs/1/2015-01.pack",
  ];
  for (const path of bad) assert.equal(parseHistoryPath(path), null, path);
  const { res, env } = await ask("/api/hist/v1/1/s-AAPL/..%2F..%2Fledger.json");
  assert.equal(res.status, 404);
  assert.deepEqual(env.HISTORY.asked, []);
});

test("the symbol encoding and the CRC agree with the app's", () => {
  for (const s of ["AAPL", "BRK.B", "BACpB", "A", "X-Y", "ÄB"]) assert.equal(encodeSymbol(s), appEncodeSymbol(s), s);
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xCBF43926);
});

test("splitPiece refuses what does not start with a whole piece header", () => {
  const good = bytesOf(CASES[0].b64);
  const s = splitPiece(good);
  assert.deepEqual(s.header, CASES[0].header);
  assert.equal(new Uint8Array(brotliDecompressSync(s.body)).length, CASES[0].header.body);
  const flip = (i, v) => { const b = good.slice(); b[i] = v; return b; };
  assert.equal(splitPiece(flip(0, 0x56)), null);
  assert.equal(splitPiece(flip(3, 2)), null);
  assert.equal(splitPiece(flip(8, 0x00)), null);
  const at = Buffer.from(good).indexOf('"pscale":1') + 9;
  assert.equal(splitPiece(flip(at + 1, 0x31)), null);                 // "pscale":10000 -> 11000: wrong CRC
  const end = 6 + good[4] + 256 * good[5];
  const resign = (b) => { const c = crc32(b.subarray(0, end)); b[end] = c & 255; b[end + 1] = (c >>> 8) & 255; b[end + 2] = (c >>> 16) & 255; b[end + 3] = c >>> 24; return b; };
  assert.deepEqual(splitPiece(resign(good.slice())).header, CASES[0].header);   // control: re-signing is sound
  assert.equal(splitPiece(resign(flip(0, 0x56))), null);
  assert.equal(splitPiece(resign(flip(3, 2))), null);
  assert.equal(splitPiece(good.subarray(0, end + 4)), null);          // no body
  assert.equal(splitPiece(good.subarray(0, 9)), null);
  assert.equal(splitPiece("UBH"), null);
});

// ── the edge's own copy of a piece (Cache API) ──────────────────────────────────────────────────────

/** A stand-in for `caches.default`: one data center's cache, keyed by URL. */
function fakeCache({ broken = false } = {}) {
  const store = new Map();
  const log = { match: [], put: [] };
  return {
    store, log,
    async match(k) {
      log.match.push(String(k));
      if (broken) throw new Error("cache down");
      const v = store.get(String(k));
      return v ? new Response(v.slice()) : undefined;
    },
    async put(k, res) {
      log.put.push(String(k));
      if (broken) throw new Error("cache down");
      store.set(String(k), new Uint8Array(await res.arrayBuffer()));
    },
  };
}

/** `ask`, with `cache` installed as `caches.default` and the Worker's `ctx.waitUntil` awaited. */
async function askEdge(path, cache, opts = {}) {
  const had = Object.getOwnPropertyDescriptor(globalThis, "caches");
  Object.defineProperty(globalThis, "caches", { value: { default: cache }, configurable: true, writable: true });
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(p) };
  const h = { "accept-encoding": "gzip, deflate, br", ...(opts.headers || {}) };
  if (opts.cookie !== false) h.cookie = `uct_session=abc; uct_chart_edge=${await mint()}`;
  const e = opts.env || { CHART_EDGE_SECRET: SECRET, HISTORY: bucket() };
  try {
    const res = await worker.fetch(new Request("https://uctintelligence.com" + path, { headers: h }), e, ctx);
    await Promise.all(waits);
    return { res, env: e };
  } finally {
    if (had) Object.defineProperty(globalThis, "caches", had); else delete globalThis.caches;
  }
}

test("edge copy: a piece is read from R2 once, then from the copy, and the member gets the same reply", async () => {
  const c = CASES[1];
  const cache = fakeCache();
  const env = { CHART_EDGE_SECRET: SECRET, HISTORY: bucket() };
  const first = await askEdge(pathOf(c), cache, { env });
  assert.equal(first.res.status, 200);
  assert.equal(first.res.headers.get("x-bars-edge"), "history");
  assert.equal(env.HISTORY.asked.length, 1);
  assert.equal(cache.store.size, 1, "a piece that validated is kept");
  const [key] = cache.store.keys();
  assert.ok(key.startsWith("https://uctintelligence.com/api/hist/__edge/"), key);
  assert.ok(key.includes(`c=${c.header.crc}`), "the key carries the CRC");

  const second = await askEdge(pathOf(c), cache, { env });
  assert.equal(second.res.status, 200);
  assert.equal(second.res.headers.get("x-bars-edge"), "history-edge");
  assert.equal(env.HISTORY.asked.length, 1, "the second read never reached R2");
  for (const h of ["content-type", "content-encoding", "cache-control", HEADER_NAME]) {
    assert.equal(second.res.headers.get(h), first.res.headers.get(h), h);
  }
  assert.deepEqual(new Uint8Array(await second.res.arrayBuffer()), new Uint8Array(await first.res.arrayBuffer()));
});

test("edge copy: a piece with another CRC at the same place is another key (a republished pack is never served stale)", async () => {
  const c = CASES[1];
  const pl = PLACE.get(c.name);
  const range = { offset: pl.off, length: pl.n, crc: c.header.crc };
  const cache = fakeCache();
  const b = bucket();
  // the OLD piece of this place, kept before a republish
  cache.store.set(edgeCacheKey("https://uctintelligence.com", pl.key, range), bytesOf(c.b64));
  const same = await readObject(b, pl.key, range, { origin: "https://uctintelligence.com", cache });
  assert.equal(same.cached, true);
  assert.deepEqual(b.asked, []);
  // the NEW index names a new CRC for the same (o, n): R2, never the old copy
  const moved = await readObject(b, pl.key, { ...range, crc: range.crc + 1 }, { origin: "https://uctintelligence.com", cache });
  assert.equal(moved.cached, false);
  assert.equal(b.asked.length, 1);
});

test("edge copy: bytes that did not validate are never kept, and kept bytes are validated again on every read", async () => {
  const [a, b] = CASES.filter((c) => c.series === "1" && c.period === "2026-11");
  const pb = PLACE.get(b.name);
  const cache = fakeCache();
  for (const path of [pathOf(a, { crc: a.header.crc + 1 }), pathOf(a, { off: pb.off, n: pb.n }), pathOf(b, { n: pb.n + 100000 })]) {
    const { res } = await askEdge(path, cache);
    assert.equal(res.status, 409, path);
  }
  assert.equal(cache.store.size, 0);
  assert.deepEqual(cache.log.put, []);
  // whatever sits under a key, a read still checks it: B's bytes under A's key are a 409, not B
  const pa = PLACE.get(a.name);
  cache.store.set(edgeCacheKey("https://uctintelligence.com", pa.key, { offset: pa.off, length: pa.n, crc: a.header.crc }),
    bytesOf(b.b64).subarray(0, pa.n));
  const env = { CHART_EDGE_SECRET: SECRET, HISTORY: bucket() };
  const { res } = await askEdge(pathOf(a), cache, { env });
  assert.equal(res.status, 409);
  assert.deepEqual(env.HISTORY.asked, []);
});

test("edge copy: an index is never kept (a 409 re-read must reach R2)", async () => {
  const cache = fakeCache();
  const env = { CHART_EDGE_SECRET: SECRET, HISTORY: bucket() };
  for (let i = 0; i < 2; i++) {
    const { res } = await askEdge("/api/hist/v1/index/s-ZZTEST.json", cache, { env });
    assert.equal(res.status, 200);
  }
  assert.equal(env.HISTORY.asked.length, 2);
  assert.equal(cache.store.size, 0);
  assert.deepEqual(cache.log.match, []);
});

test("edge copy: only an entitled caller reaches it, and its own URL is not a history path", async () => {
  const c = CASES[1];
  const cache = fakeCache();
  await askEdge(pathOf(c), cache);
  const [key] = cache.store.keys();
  const matches = cache.log.match.length;
  const anon = await askEdge(pathOf(c), cache, { cookie: false });
  assert.equal(anon.res.status, 401);
  assert.equal(cache.log.match.length, matches, "an unentitled request never consults the copy");
  // the copy lives under the path this Worker owns (a Worker runs in front of the CDN cache) ...
  assert.ok(new URL(key).pathname.startsWith(HIST_PREFIX));
  // ... and asking for that URL, even entitled, is a 404 that never touches the copy or R2
  assert.equal(parseHistoryPath(new URL(key).pathname), null);
  const env = { CHART_EDGE_SECRET: SECRET, HISTORY: bucket() };
  const direct = await askEdge(new URL(key).pathname + new URL(key).search, cache, { env });
  assert.equal(direct.res.status, 404);
  assert.equal(cache.log.match.length, matches);
  assert.deepEqual(env.HISTORY.asked, []);
});

test("edge copy: a broken cache is a miss, never an error", async () => {
  const cache = fakeCache({ broken: true });
  const env = { CHART_EDGE_SECRET: SECRET, HISTORY: bucket() };
  const { res } = await askEdge(pathOf(CASES[1]), cache, { env });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-bars-edge"), "history");
  assert.equal(env.HISTORY.asked.length, 1);
});

test("other paths are untouched by the history branch", async () => {
  const bars = await ask("/api/bars/AAPL?tf=5", { cookie: false });
  assert.equal(bars.origins.length, 1);
  assert.match(bars.origins[0], /bars-api/);
  const other = await ask("/api/histogram", { cookie: false });
  assert.equal(other.origins.length, 1);
  assert.equal(await other.res.text(), "origin");
});
