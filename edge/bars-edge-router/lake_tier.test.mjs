/**
 * The network's copy of a lake piece (history.js `LakePiece`, Workers Cache in front, 2026-11-28).
 * The entrypoint is driven through a stand-in for Workers Cache (__fixtures__/workers_cache.mjs) that keeps
 * exactly what the real one keeps, so "is it cached?" is asked by asking twice and counting R2 reads.
 *
 * Run: node --test   (from edge/bars-edge-router/)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import worker from "./worker.js";
import {
  serveLakePiece, lakePiecePath, lakeCacheKey, parseLakePiecePath, lakeTier, readObject, splitPiece, LAKE_ENTRY,
  LAKE_PIECE_ORIGIN, HIST_PREFIX, encodeSymbol,
} from "./history.js";
import { cachedEntry } from "./__fixtures__/workers_cache.mjs";

const FIX = JSON.parse(readFileSync(
  new URL("../../app/src/data/historyLake/__fixtures__/pieces.json", import.meta.url), "utf8"));
const CASES = FIX.cases;
const SECRET = "test-edge-secret";
const PREFIX = "hist/";
const bytesOf = (b64) => new Uint8Array(Buffer.from(b64, "base64"));

const PACKS = new Map();
const PLACE = new Map();
for (const c of CASES) {
  const key = `${PREFIX}packs/${c.series}/${c.period}.pack`;
  const prev = PACKS.get(key) || new Uint8Array(0);
  const blob = bytesOf(c.b64);
  const next = new Uint8Array(prev.length + blob.length);
  next.set(prev); next.set(blob, prev.length);
  PACKS.set(key, next);
  PLACE.set(c.name, { key, off: prev.length, n: blob.length });
}
const pathOf = (c, { crc = c.header.crc, off = PLACE.get(c.name).off, n = PLACE.get(c.name).n } = {}) =>
  `/api/hist/${c.relpath}?c=${crc}&o=${off}&n=${n}`;
const rangeOf = (c) => { const p = PLACE.get(c.name); return { offset: p.off, length: p.n, crc: c.header.crc, enc: encodeSymbol(c.header.symbol) }; };

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

function bucket(overrides = new Map()) {
  const asked = [];
  return {
    asked,
    async get(key, opts) {
      asked.push(opts && opts.range ? `${key}@${opts.range.offset}+${opts.range.length}` : key);
      let v = overrides.has(key) ? overrides.get(key) : PACKS.get(key);
      if (v === undefined) return null;
      if (v instanceof Error) throw v;
      if (opts && opts.range) v = v.subarray(opts.range.offset, opts.range.offset + opts.range.length);
      return { arrayBuffer: async () => v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) };
    },
  };
}

/** The production shape: env, and ctx whose `exports.LakePiece` is the entrypoint behind Workers Cache. */
function rig({ entry } = {}) {
  const env = { CHART_EDGE_SECRET: SECRET, HISTORY: bucket(), HISTORY_PREFIX: PREFIX };
  const lake = entry || cachedEntry((req) => serveLakePiece(req, env));
  const ctx = { waitUntil() {}, exports: { [LAKE_ENTRY]: lake } };
  return { env, ctx, lake };
}

async function ask(path, { env, ctx, cookie = true, headers = {} }) {
  const h = { "accept-encoding": "gzip, deflate, br", ...headers };
  if (cookie === true) h.cookie = `uct_session=abc; uct_chart_edge=${await mint()}`;
  else if (cookie) h.cookie = cookie;
  const had = Object.getOwnPropertyDescriptor(globalThis, "caches");
  delete globalThis.caches;                       // no data-center copy: the network's copy is under test
  try {
    return await worker.fetch(new Request("https://uctintelligence.com" + path, { headers: h }), env, ctx);
  } finally {
    if (had) Object.defineProperty(globalThis, "caches", had);
  }
}

test("⛔ an unentitled piece request is refused 401 and never reaches the network's copy or R2", async () => {
  const { env, ctx, lake } = rig();
  const c = CASES[1];
  await ask(pathOf(c), { env, ctx });             // an entitled read fills the copy first
  const runs = lake.log.runs, reqs = lake.log.requests.length, r2 = env.HISTORY.asked.length;
  for (const cookie of [false, "uct_session=abc", "uct_chart_edge=v1.forged.sig"]) {
    const res = await ask(pathOf(c), { env, ctx, cookie });
    assert.equal(res.status, 401, String(cookie));
    assert.equal((await res.json()).error, "not_entitled");
  }
  assert.equal(lake.log.requests.length, reqs, "the cached entrypoint was never asked for an unentitled read");
  assert.equal(lake.log.runs, runs);
  assert.equal(env.HISTORY.asked.length, r2);
});

test("an entitled piece is read from R2 ONCE, then from the network's copy, with the same bytes", async () => {
  const { env, ctx, lake } = rig();
  const c = CASES[1];
  const first = await ask(pathOf(c), { env, ctx });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("x-bars-edge"), "history-tier");
  assert.equal(env.HISTORY.asked.length, 1);
  const second = await ask(pathOf(c), { env, ctx });
  assert.equal(second.status, 200);
  assert.equal(second.headers.get("x-bars-edge"), "history-tier");
  assert.equal(env.HISTORY.asked.length, 1, "the second read never reached R2");
  assert.equal(lake.log.runs, 1);
  assert.equal(second.headers.get("x-lake-filled"), first.headers.get("x-lake-filled"), "the same copy");
  assert.deepEqual(new Uint8Array(await second.arrayBuffer()), new Uint8Array(await first.arrayBuffer()));
  // and the member's answer is exactly what the plain R2 path answers
  const plainEnv = { CHART_EDGE_SECRET: SECRET, HISTORY: bucket(), HISTORY_PREFIX: PREFIX };
  const plain = await ask(pathOf(c), { env: plainEnv, ctx: { waitUntil() {} } });
  assert.equal(plain.headers.get("x-bars-edge"), "history");
  for (const h of ["content-type", "content-encoding", "cache-control", "x-ubh-header"]) {
    assert.equal(second.headers.get(h), plain.headers.get(h), h);
  }
});

test("⛔ only a validated whole piece is cacheable: every other answer of LakePiece is no-store", async () => {
  const env = { HISTORY: bucket() };
  const [a, b] = CASES.filter((c) => c.series === "1" && c.period === "2026-11");
  const ok = await serveLakePiece(new Request(LAKE_PIECE_ORIGIN + lakePiecePath(PLACE.get(a.name).key, rangeOf(a))), env);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.ok(splitPiece(new Uint8Array(await ok.arrayBuffer())));
  const pb = PLACE.get(b.name);
  const bad = [
    [lakePiecePath(PLACE.get(a.name).key, { ...rangeOf(a), crc: a.header.crc + 1 }), 409],   // CRC moved
    [lakePiecePath(PLACE.get(a.name).key, { ...rangeOf(a), offset: pb.off, length: pb.n }), 409],
    [lakePiecePath(PLACE.get(b.name).key, { ...rangeOf(b), enc: rangeOf(a).enc }), 409],                // B's bytes, A's name
    [lakePiecePath(PLACE.get(b.name).key, { ...rangeOf(b), length: pb.n + 100000 }), 409],   // short read
    [lakePiecePath(`${PREFIX}packs/1/2001-01.pack`, rangeOf(a)), 404],                          // no object
    ["/p/hist/v1/index/s-AAPL.json/s-AAPL/0/100/1", 404],                                         // not a pack
    ["/p/../packs/1/2026-11.pack/s-AAPL/0/100/1", 404],
    ["/anything", 404],
  ];
  for (const [path, status] of bad) {
    const res = await serveLakePiece(new Request(LAKE_PIECE_ORIGIN + path), env);
    assert.equal(res.status, status, path);
    assert.equal(res.headers.get("cache-control"), "no-store", path);
  }
  const post = await serveLakePiece(new Request(LAKE_PIECE_ORIGIN + "/p/x", { method: "POST" }), env);
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("cache-control"), "no-store");
  const unbound = await serveLakePiece(new Request(LAKE_PIECE_ORIGIN + lakePiecePath(PLACE.get(a.name).key, rangeOf(a))), {});
  assert.equal(unbound.status, 503);
  assert.equal(unbound.headers.get("cache-control"), "no-store");
  const failing = await serveLakePiece(new Request(LAKE_PIECE_ORIGIN + lakePiecePath(PLACE.get(a.name).key, rangeOf(a))),
    { HISTORY: bucket(new Map([[PLACE.get(a.name).key, new Error("r2 down")]])) });
  assert.equal(failing.status, 503);
  assert.equal(failing.headers.get("cache-control"), "no-store");
});

test("a 409 from the copy's path is never kept: the next read asks R2 again", async () => {
  const { env, ctx, lake } = rig();
  const a = CASES[1];
  for (let i = 0; i < 2; i++) {
    const res = await ask(pathOf(a, { crc: a.header.crc + 1 }), { env, ctx });
    assert.equal(res.status, 409);
  }
  assert.equal(lake.store.size, 0);
  assert.equal(lake.log.runs, 2);
});

test("whatever the copy hands back, the gateway validates it: another piece's bytes are a 409, never served", async () => {
  const [a, b] = CASES.filter((c) => c.series === "1" && c.period === "2026-11");
  const pa = PLACE.get(a.name);
  const lying = { fetch: async () => new Response(bytesOf(b.b64).subarray(0, pa.n), { status: 200 }) };
  const { env, ctx } = rig({ entry: lying });
  const res = await ask(pathOf(a), { env, ctx });
  assert.equal(res.status, 409);
});

test("the copy failing (throws, 503, 404) is a plain R2 read, never an error", async () => {
  const c = CASES[1];
  for (const entry of [
    { fetch: async () => { throw new Error("loopback down"); } },
    { fetch: async () => new Response("x", { status: 503 }) },
    { fetch: async () => new Response("x", { status: 404 }) },
  ]) {
    const { env, ctx } = rig({ entry });
    const res = await ask(pathOf(c), { env, ctx });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-bars-edge"), "history");
    assert.equal(env.HISTORY.asked.length, 1);
  }
});

test("LAKE_TIER=0 turns it off; no ctx.exports (older runtime) is the plain path", async () => {
  const { env, ctx, lake } = rig();
  env.LAKE_TIER = "0";
  const off = await ask(pathOf(CASES[1]), { env, ctx });
  assert.equal(off.headers.get("x-bars-edge"), "history");
  assert.equal(lake.log.requests.length, 0);
  assert.equal(lakeTier({}, {}), null);
  assert.equal(lakeTier({}, { exports: {} }), null);
  assert.equal(typeof lakeTier({}, { exports: { [LAKE_ENTRY]: { fetch() {} } } }), "function");
});

test("an index never goes through the copy (a 409 re-read must reach R2)", async () => {
  const { env, ctx, lake } = rig();
  env.HISTORY = bucket(new Map([[`${PREFIX}v1/index/s-ZZTEST.json`, new TextEncoder().encode('{"v":1}')]]));
  for (let i = 0; i < 2; i++) assert.equal((await ask("/api/hist/v1/index/s-ZZTEST.json", { env, ctx })).status, 200);
  assert.equal(lake.log.requests.length, 0);
  assert.equal(env.HISTORY.asked.length, 2);
});

test("the copy's key is the exact content, and its path is not a routed path", () => {
  const c = CASES[1];
  const key = PLACE.get(c.name).key;
  const p = lakePiecePath(key, rangeOf(c));
  assert.deepEqual(parseLakePiecePath(p), { key, series: c.series, period: c.period, range: rangeOf(c) });
  assert.notEqual(lakePiecePath(key, { ...rangeOf(c), crc: c.header.crc + 1 }), p, "a new CRC is a new key");
  assert.ok(!p.startsWith(HIST_PREFIX), "never a path the routed Worker answers");
  assert.equal(lakeCacheKey(key, { ...rangeOf(c), offset: 999 }), lakeCacheKey(key, rangeOf(c)), "a moved piece keeps its key");
  for (const bad of ["/p/packs/1/2026-13.pack/s-A/0/100/1", "/p/packs/7/2026.pack/s-A/0/100/1", "/p/packs/1/2026-11.pack/s-A/0/9/1",
    "/p/packs/1/2026-11.pack/s-A/01/100/1", "/p/packs/1/2026-11.pack/s-A/0/100/1/x", "/p/x/../packs/1/2026-11.pack/s-A/0/100/1",
    "/p/packs/1/2026-11.pack/0/100/1", "/p/packs/1/2026-11.pack/s-a/0/100/1"]) {
    assert.equal(parseLakePiecePath(bad), null, bad);
  }
});

test("readObject: a data-center hit is used before the network's copy is asked", async () => {
  const c = CASES[1];
  const range = rangeOf(c);
  const stored = bytesOf(c.b64);
  const cache = { match: async () => new Response(stored.slice()), put: async () => {} };
  let asked = 0;
  const got = await readObject(bucket(), PLACE.get(c.name).key, range,
    { origin: "https://uctintelligence.com", cache, lake: async () => { asked += 1; return new Response("x"); } });
  assert.equal(got.cached, true);
  assert.equal(asked, 0);
});

test("⭐ a republished pack that MOVES a piece keeps its network copy: the key is the content, not the place", async () => {
  const c = CASES[1];
  const { env, ctx, lake } = rig();
  const first = await ask(pathOf(c), { env, ctx });
  assert.equal(first.status, 200);
  assert.equal(lake.log.runs, 1);
  // the daily refresh rewrites the pack: 777 bytes of other pieces now sit in front of this one
  const pl = PLACE.get(c.name);
  const old = PACKS.get(pl.key);
  const moved = new Uint8Array(old.length + 777);
  moved.set(old, 777);
  env.HISTORY = bucket(new Map([[pl.key, moved]]));
  const again = await ask(pathOf(c, { off: pl.off + 777 }), { env, ctx });
  assert.equal(again.status, 200);
  assert.equal(lake.log.runs, 1, "the moved piece was a network-copy hit");
  assert.deepEqual(env.HISTORY.asked, [], "R2 was not asked");
  assert.deepEqual(new Uint8Array(await again.arrayBuffer()), new Uint8Array(await first.arrayBuffer()));
  // and a CHANGED piece (new CRC) is a new key
  assert.notEqual(lakeCacheKey(pl.key, rangeOf(c)), lakeCacheKey(pl.key, { ...rangeOf(c), crc: c.header.crc + 1 }));
});

test("the data center's copy is keyed by content too: a moved piece is still a hit there", async () => {
  const c = CASES[1];
  const range = rangeOf(c);
  const store = new Map();
  const cache = { match: async (k) => (store.has(k) ? new Response(store.get(k).slice()) : undefined),
    put: async (k, r) => { store.set(k, new Uint8Array(await r.arrayBuffer())); } };
  const b = bucket();
  const first = await readObject(b, PLACE.get(c.name).key, range, { origin: "https://uctintelligence.com", cache });
  first.keep();
  await new Promise((r) => setTimeout(r, 0));
  const moved = await readObject(b, PLACE.get(c.name).key, { ...range, offset: range.offset + 777 },
    { origin: "https://uctintelligence.com", cache });
  assert.equal(moved.cached, true);
  assert.equal(b.asked.length, 1);
});
