/**
 * /api/seed/ (seed.js): first-frame seed packs built by the PYTHON encoder (tools/ffseed_make_js_fixture.py,
 * synthetic bars) are put in a stand-in bucket, asked for through the real Worker entry point with a real
 * member token, and decoded the way the browser will: trailer from the end of the file, one symbol's blob
 * inflated with DecompressionStream('gzip'), its body decoded by the history lake's own column decoder
 * (app/src/data/historyLake/piece.js decodeBody). Every value must equal the bar the Python side encoded.
 *
 * Run: node --test   (from edge/bars-edge-router/)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import worker from "./worker.js";
import { parseSeedPath, parseRange, edgeCacheKey, handleSeed, PACK_TYPE, DEFAULT_PREFIX } from "./seed.js";
import { decodeBody } from "../../app/src/data/historyLake/piece.js";

const FIX = JSON.parse(readFileSync(new URL("./__fixtures__/ffseed.json", import.meta.url), "utf8"));
const SECRET = "test-edge-secret";
const PACKS = Object.fromEntries(Object.entries(FIX.packs).map(([tf, b64]) => [tf, new Uint8Array(Buffer.from(b64, "base64"))]));
const MANIFEST = new TextEncoder().encode(JSON.stringify({ v: 1, kind: "ffseed", build: FIX.build, asof: FIX.asof }));

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

const streamOf = (bytes) => new Blob([bytes]).stream();

function bucket(prefix = DEFAULT_PREFIX) {
  const store = new Map([[`${prefix}latest.json`, MANIFEST]]);
  for (const [tf, bytes] of Object.entries(PACKS)) store.set(`${prefix}${FIX.build}/${tf}.ffs`, bytes);
  const asked = [];
  return {
    asked,
    store,
    async get(key, opts) {
      const r = opts && opts.range;
      asked.push(r ? `get ${key}@${r.offset}+${r.length}` : `get ${key}`);
      const v = store.get(key);
      if (v === undefined) return null;
      const part = r ? v.subarray(r.offset, r.offset + r.length) : v;
      return { size: v.length, body: streamOf(part), arrayBuffer: async () => part.slice().buffer };
    },
    async head(key) {
      asked.push(`head ${key}`);
      const v = store.get(key);
      return v === undefined ? null : { size: v.length };
    },
  };
}

function memCache() {
  const m = new Map();
  return {
    m,
    async match(k) { const v = m.get(k); return v ? new Response(v.bytes, { headers: v.headers }) : undefined; },
    async put(k, res) { m.set(k, { bytes: new Uint8Array(await res.arrayBuffer()), headers: Object.fromEntries(res.headers) }); },
  };
}

async function ask(path, { cookie = true, headers = {}, method = "GET", env, cache } = {}) {
  const h = { ...headers };
  if (cookie === true) h.cookie = `uct_session=abc; uct_chart_edge=${await mint()}`;
  else if (cookie) h.cookie = cookie;
  const e = env || { CHART_EDGE_SECRET: SECRET, SEED: bucket() };
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(p) };
  const realFetch = globalThis.fetch;
  const origins = [];
  globalThis.fetch = async (input) => { origins.push(String(input.url || input)); return new Response("origin"); };
  const realCaches = globalThis.caches;
  globalThis.caches = { default: cache || memCache() };
  try {
    const res = await worker.fetch(new Request("https://uctintelligence.com" + path, { method, headers: h }), e, ctx);
    const body = new Uint8Array(await res.arrayBuffer());
    await Promise.all(pending);
    return { res, body, origins, env: e, cache: globalThis.caches.default };
  } finally {
    globalThis.fetch = realFetch;
    globalThis.caches = realCaches;
  }
}

// ---- the browser's decode, step by step (docs/charts/first-frame-seed-format.md section 5) ----
function readTrailer(bytes) {
  const n = bytes.length;
  assert.equal(new TextDecoder().decode(bytes.subarray(n - 8)), "UFFSEED1");
  const tlen = Number(new DataView(bytes.buffer, bytes.byteOffset, n).getBigUint64(n - 16, true));
  const tr = JSON.parse(new TextDecoder().decode(bytes.subarray(n - 16 - tlen, n - 16)));
  assert.equal(tr.v, 1);
  return tr;
}
async function gunzip(blob) {
  const s = new Blob([blob]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function readSymbol(bytes, tr, sym) {
  const e = Object.fromEntries(tr.fields.map((k, i) => [k, tr.symbols[sym][i]]));
  const blob = bytes.subarray(e.off, e.off + e.len);
  const body = tr.comp === "gzip" ? await gunzip(blob) : blob;
  const d = decodeBody({ bars: e.bars, first: e.first, last: e.last, tunit: tr.tunit, vscale: e.vscale, body: e.body, crc: e.crc }, body);
  return Array.from(d.t, (t, i) => ({
    t: tr.tf === "D" ? new Date(t * 1000).toISOString().slice(0, 10) : t,
    o: d.o[i] / e.pscale, h: d.h[i] / e.pscale, l: d.l[i] / e.pscale, c: d.c[i] / e.pscale,
    v: e.vscale === 1 ? d.v[i] : d.v[i] / e.vscale,
  }));
}

test("every fixture pack: worker -> R2 -> bytes unchanged -> browser decode equals the Python bars", async () => {
  for (const tf of Object.keys(PACKS)) {
    const { res, body, origins, env } = await ask(`/api/seed/v1/${FIX.build}/${tf}.ffs`);
    assert.equal(res.status, 200, tf);
    assert.deepEqual(origins, [], "the seed never asks an origin");
    assert.deepEqual(env.SEED.asked, [`get ffseed/${FIX.build}/${tf}.ffs`]);
    assert.equal(res.headers.get("content-type"), PACK_TYPE);
    assert.equal(res.headers.get("cache-control"), "private, max-age=31536000, immutable");
    assert.equal(res.headers.get("content-length"), String(PACKS[tf].length));
    assert.equal(res.headers.get("x-bars-edge"), "seed");
    assert.deepEqual(body, PACKS[tf]);
    const tr = readTrailer(body);
    assert.equal(tr.tf, tf);
    assert.equal(tr.asof, FIX.asof);
    assert.deepEqual(Object.keys(tr.symbols).sort(), Object.keys(FIX.expected[tf]).sort());
    for (const [sym, bars] of Object.entries(FIX.expected[tf])) {
      const got = await readSymbol(body, tr, sym);
      assert.equal(got.length, bars.length);
      for (let i = 0; i < bars.length; i++) {
        for (const k of ["t", "o", "h", "l", "c", "v"]) {
          assert.ok(Object.is(got[i][k], bars[i][k]), `${tf} ${sym} bar ${i} ${k}: ${got[i][k]} != ${bars[i][k]}`);
        }
      }
    }
  }
});

test("the second read of a pack comes from this data center's copy, not R2", async () => {
  const cache = memCache();
  const env = { CHART_EDGE_SECRET: SECRET, SEED: bucket() };
  const path = `/api/seed/v1/${FIX.build}/D.ffs`;
  const first = await ask(path, { env, cache });
  assert.equal(first.res.headers.get("x-bars-edge"), "seed");
  assert.ok(cache.m.has(edgeCacheKey("https://uctintelligence.com", `ffseed/${FIX.build}/D.ffs`)));
  const second = await ask(path, { env, cache });
  assert.equal(second.res.status, 200);
  assert.equal(second.res.headers.get("x-bars-edge"), "seed-edge");
  assert.deepEqual(second.body, PACKS.D);
  assert.deepEqual(env.SEED.asked, [`get ffseed/${FIX.build}/D.ffs`], "R2 read once");
  // the copy never answers without entitlement
  const anon = await ask(path, { env, cache, cookie: false });
  assert.equal(anon.res.status, 401);
});

test("the manifest is short-lived and never copied at the edge", async () => {
  const cache = memCache();
  const { res, body } = await ask("/api/seed/v1/latest.json", { cache });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "private, max-age=60");
  assert.equal(JSON.parse(new TextDecoder().decode(body)).build, FIX.build);
  assert.equal(cache.m.size, 0);
});

test("no entitlement, no bytes: 401 and the bucket is never asked", async () => {
  for (const cookie of [false, "uct_chart_edge=v1.bad.sig", `uct_chart_edge=${await mint({ ent: "render" })}`]) {
    const { res, env } = await ask(`/api/seed/v1/${FIX.build}/5.ffs`, { cookie });
    assert.equal(res.status, 401, String(cookie));
    assert.deepEqual(env.SEED.asked, []);
  }
  const expired = await ask("/api/seed/v1/latest.json", { cookie: `uct_chart_edge=${await mint({ exp: 1 })}` });
  assert.equal(expired.res.status, 401);
});

test("only the two exact path forms reach the bucket", async () => {
  for (const p of [
    "/api/seed/v1/", "/api/seed/v2/latest.json", "/api/seed/v1/latest.json/x", `/api/seed/v1/${FIX.build}/W.ffs`,
    `/api/seed/v1/${FIX.build}/60e.ffs`, "/api/seed/v1/2026-11-19/D.ffs", `/api/seed/v1/${FIX.build}/D.pack`,
    `/api/seed/v1/../${FIX.build}/D.ffs`, `/api/seed/v1/${FIX.build}/..%2FD.ffs`, "/api/seed/v1/latest",
  ]) {
    const { res, env } = await ask(p);
    assert.equal(res.status, 404, p);
    assert.deepEqual(env.SEED.asked, [], p);
  }
  assert.deepEqual(parseSeedPath(`/api/seed/v1/${FIX.build}/60.ffs`), { kind: "pack", key: `${FIX.build}/60.ffs`, build: FIX.build, tf: "60" });
  assert.deepEqual(parseSeedPath(`/api/seed/v1/${FIX.build}/D.delta.ffs`),
    { kind: "pack", key: `${FIX.build}/D.delta.ffs`, build: FIX.build, tf: "D", delta: true });
  for (const bad of ["W.delta.ffs", "D.delta", "D.deltas.ffs", ".delta.ffs", "D.delta.delta.ffs", "D.full.ffs"]) {
    assert.equal(parseSeedPath(`/api/seed/v1/${FIX.build}/${bad}`), null, bad);
  }
});

test("method, configuration and a missing object", async () => {
  assert.equal((await ask("/api/seed/v1/latest.json", { method: "POST" })).res.status, 405);
  assert.equal((await ask("/api/seed/v1/latest.json", { env: { CHART_EDGE_SECRET: SECRET } })).res.status, 503);
  const gone = await ask("/api/seed/v1/20200101T0000Z/D.ffs");
  assert.equal(gone.res.status, 404);
  const broken = { CHART_EDGE_SECRET: SECRET, SEED: { async get() { throw new Error("r2 down"); }, async head() { throw new Error("r2 down"); } } };
  const down = await ask(`/api/seed/v1/${FIX.build}/D.ffs`, { env: broken });
  assert.equal(down.res.status, 503);
});

test("HISTORY binding and SEED_PREFIX", async () => {
  const env = { CHART_EDGE_SECRET: SECRET, HISTORY: bucket("seed-x/"), SEED_PREFIX: "seed-x/" };
  const { res, body } = await ask(`/api/seed/v1/${FIX.build}/5.ffs`, { env });
  assert.equal(res.status, 200);
  assert.deepEqual(body, PACKS["5"]);
  assert.deepEqual(env.HISTORY.asked, [`get seed-x/${FIX.build}/5.ffs`]);
});

test("a resumed download: single ranges answer 206 from R2, unsatisfiable ones 416", async () => {
  const pack = PACKS["60"];
  const path = `/api/seed/v1/${FIX.build}/60.ffs`;
  const a = await ask(path, { headers: { range: "bytes=10-109" } });
  assert.equal(a.res.status, 206);
  assert.equal(a.res.headers.get("content-range"), `bytes 10-109/${pack.length}`);
  assert.deepEqual(a.body, pack.subarray(10, 110));
  const tail = await ask(path, { headers: { range: "bytes=-16" } });
  assert.deepEqual(tail.body, pack.subarray(pack.length - 16));
  const open = await ask(path, { headers: { range: `bytes=${pack.length - 5}-` } });
  assert.deepEqual(open.body, pack.subarray(pack.length - 5));
  const bad = await ask(path, { headers: { range: `bytes=${pack.length}-` } });
  assert.equal(bad.res.status, 416);
  assert.equal(bad.res.headers.get("content-range"), `bytes */${pack.length}`);
  assert.equal(parseRange("bytes=0-1,5-6", 100), null, "multi-range: the whole object");
  assert.equal(parseRange(null, 100), null);
  assert.deepEqual(parseRange("bytes=90-500", 100), { offset: 90, length: 10 });
});

test("a daily delta is served from its own key, like a pack", async () => {
  const env = { CHART_EDGE_SECRET: SECRET, SEED: bucket() };
  const delta = new Uint8Array([1, 2, 3, 4, 5]);
  env.SEED.store.set(`ffseed/${FIX.build}/5.delta.ffs`, delta);
  const { res, body } = await ask(`/api/seed/v1/${FIX.build}/5.delta.ffs`, { env });
  assert.equal(res.status, 200);
  assert.deepEqual(body, delta);
  assert.deepEqual(env.SEED.asked, [`get ffseed/${FIX.build}/5.delta.ffs`]);
  assert.equal(res.headers.get("cache-control"), "private, max-age=31536000, immutable");
});

test("HEAD answers the size without a body", async () => {
  const { res, body } = await ask(`/api/seed/v1/${FIX.build}/D.ffs`, { method: "HEAD" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-length"), String(PACKS.D.length));
  assert.equal(body.length, 0);
});

test("handleSeed is reachable only through the entitlement callback it is given", async () => {
  let called = 0;
  const res = await handleSeed(new Request(`https://x/api/seed/v1/${FIX.build}/D.ffs`), { SEED: bucket() },
    async () => { called++; return "yes"; }, null, { cache: null });
  assert.equal(called, 1);
  assert.equal(res.status, 401, "anything but true is a refusal");
});
