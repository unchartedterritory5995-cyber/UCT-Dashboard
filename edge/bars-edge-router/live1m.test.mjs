/**
 * live1m.js: universe minute frames from R2 at the edge. Run: node --test (this directory).
 *
 * The frame served here is the PYTHON encoder's (tests/fixtures/minute_frames/codec_plain.bin),
 * gzipped as the publisher stores it, sent over real HTTP with the Worker's headers and decoded by
 * the BROWSER's decoder (app/src/lib/minuteFrames/codec.js): publisher -> R2 -> edge -> browser,
 * value for value.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import zlib from "node:zlib";

import worker from "./worker.js";
import { parseLive1mPath, handleLive1m, LIVE1M_PREFIX, EDGE_KEY_PATH } from "./live1m.js";
import { HIST_PREFIX } from "./history.js";
import { decodeFrame, frameRows } from "../../app/src/lib/minuteFrames/codec.js";

const SECRET = "test-edge-secret";
const RAW = new Uint8Array(fs.readFileSync(new URL("../../tests/fixtures/minute_frames/codec_plain.bin", import.meta.url)));
const GZ = new Uint8Array(zlib.gzipSync(RAW));
const CASE = JSON.parse(fs.readFileSync(new URL("../../tests/fixtures/minute_frames/codec_cases.json", import.meta.url), "utf8"))
  .cases.find((c) => c.name === "plain");

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

const DAY = "2026-11-18";
function bucket(prefix = "live1m/") {
  const store = new Map([
    [`${prefix}${DAY}/0930.bin`, GZ],
    [`${prefix}${DAY}/today.bin`, GZ],
    [`${prefix}${DAY}/head.json`, new TextEncoder().encode('{"day":20261118,"seq":330,"today_seq":329}')],
  ]);
  const asked = [];
  return {
    asked, store,
    async get(key) {
      asked.push(key);
      const v = store.get(key);
      if (v === undefined) return null;
      if (v instanceof Error) throw v;
      return { arrayBuffer: async () => v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) };
    },
  };
}

function fakeCache() {
  const store = new Map();
  const log = { match: [], put: [] };
  return {
    store, log,
    async match(k) { log.match.push(String(k)); const v = store.get(String(k)); return v ? new Response(v.slice()) : undefined; },
    async put(k, res) { log.put.push(String(k)); store.set(String(k), new Uint8Array(await res.arrayBuffer())); },
  };
}

/** Through the real Worker entry, with `cache` as caches.default and waitUntil awaited. */
async function ask(path, { cookie = true, method = "GET", env, cache = fakeCache() } = {}) {
  const had = Object.getOwnPropertyDescriptor(globalThis, "caches");
  Object.defineProperty(globalThis, "caches", { value: { default: cache }, configurable: true, writable: true });
  const h = { "accept-encoding": "gzip, deflate, br" };
  if (cookie === true) h.cookie = `uct_session=abc; uct_chart_edge=${await mint()}`;
  else if (cookie) h.cookie = cookie;
  const e = env || { CHART_EDGE_SECRET: SECRET, LIVE1M: bucket() };
  const waits = [];
  const realFetch = globalThis.fetch;
  const origins = [];
  globalThis.fetch = async (input) => { origins.push(String(input.url || input)); return new Response("origin"); };
  try {
    const res = await worker.fetch(new Request("https://uctintelligence.com" + path, { method, headers: h }), e,
      { waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
    return { res, env: e, cache, origins };
  } finally {
    globalThis.fetch = realFetch;
    if (had) Object.defineProperty(globalThis, "caches", had); else delete globalThis.caches;
  }
}

/** Send a Worker response over real HTTP and fetch it back (what a browser's HTTP layer does). */
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
    return { got, body: new Uint8Array(await got.arrayBuffer()) };
  } finally {
    server.close();
  }
}

const P = (file) => `${LIVE1M_PREFIX}v1/${DAY}/${file}`;

test("the surface sits inside /api/hist/ (the member cookie's scope) and the Worker sends it here first", async () => {
  assert.ok(LIVE1M_PREFIX.startsWith(HIST_PREFIX));
  const { res, origins } = await ask(P("0930.bin"));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-bars-edge"), "live1m");
  assert.deepEqual(origins, []);                                  // no origin asked
});

test("publisher bytes -> R2 -> edge -> HTTP gzip -> the browser's decoder, value for value", async () => {
  const { res } = await ask(P("0930.bin"));
  assert.equal(res.headers.get("content-encoding"), "gzip");
  assert.equal(res.headers.get("cache-control"), "private, max-age=86400, immutable");
  const { got, body } = await overTheWire(res);
  assert.equal(got.status, 200);
  assert.deepEqual(Array.from(body), Array.from(RAW));              // the HTTP layer inflated it
  const f = decodeFrame(body);
  assert.equal(f.seq, CASE.header.seq);
  const rows = Object.fromEntries(frameRows(f).map((r) => [r.sym, [r.o, r.h, r.l, r.c, r.v]]));
  assert.deepEqual(rows, CASE.blocks[0].rows);
});

test("?raw=1 hands the gzip bytes over as they are stored", async () => {
  const { res } = await ask(P("0930.bin") + "?raw=1");
  assert.equal(res.headers.get("content-encoding"), null);
  assert.equal(res.headers.get("content-type"), "application/gzip");
  assert.deepEqual(Array.from(new Uint8Array(await res.arrayBuffer())), Array.from(GZ));
});

test("only an entitled caller gets anything, and the bucket is not even asked otherwise", async () => {
  const expired = await mint({ exp: Math.floor(Date.now() / 1000) - 5 });
  const wrongEnt = await mint({ ent: "service" });
  for (const cookie of [false, `uct_chart_edge=${expired}`, `uct_chart_edge=${wrongEnt}`, "uct_chart_edge=v1.x.y"]) {
    const env = { CHART_EDGE_SECRET: SECRET, LIVE1M: bucket() };
    const { res } = await ask(P("0930.bin"), { cookie, env });
    assert.equal(res.status, 401, String(cookie));
    assert.deepEqual(env.LIVE1M.asked, []);
  }
});

test("a minute file is kept at the edge after one R2 read; head and today never are", async () => {
  const cache = fakeCache();
  const env = { CHART_EDGE_SECRET: SECRET, LIVE1M: bucket() };
  await ask(P("0930.bin"), { cache, env });
  const second = await ask(P("0930.bin"), { cache, env });
  assert.deepEqual(env.LIVE1M.asked, [`live1m/${DAY}/0930.bin`]);
  assert.equal(second.res.headers.get("x-bars-edge"), "live1m-edge");
  assert.ok(cache.log.put[0].includes(EDGE_KEY_PATH));
  for (const f of ["head.json", "today.bin"]) {
    await ask(P(f), { cache, env });
    await ask(P(f), { cache, env });
  }
  assert.equal(env.LIVE1M.asked.filter((k) => k.endsWith("head.json")).length, 2);
  assert.equal(env.LIVE1M.asked.filter((k) => k.endsWith("today.bin")).length, 2);
  assert.equal(cache.log.put.length, 1);
});

test("head is JSON, no-store; today is gzip, no-store", async () => {
  const h = (await ask(P("head.json"))).res;
  assert.equal(h.headers.get("cache-control"), "no-store");
  assert.deepEqual(await h.json(), { day: 20261118, seq: 330, today_seq: 329 });
  const t = (await ask(P("today.bin"))).res;
  assert.equal(t.headers.get("cache-control"), "no-store");
  assert.equal(t.headers.get("content-encoding"), "gzip");
});

test("a minute not out yet is a 404 nobody caches; a missing bucket is 503; a bad object is 502", async () => {
  const cache = fakeCache();
  const r = (await ask(P("0931.bin"), { cache })).res;
  assert.equal(r.status, 404);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal(cache.log.put.length, 0);
  assert.equal((await ask(P("0930.bin"), { env: { CHART_EDGE_SECRET: SECRET } })).res.status, 503);
  const env = { CHART_EDGE_SECRET: SECRET, LIVE1M: bucket() };
  env.LIVE1M.store.set(`live1m/${DAY}/0930.bin`, RAW);            // not gzip: never served or kept
  assert.equal((await ask(P("0930.bin"), { env, cache })).res.status, 502);
  assert.equal(cache.log.put.length, 0);
  env.LIVE1M.store.set(`live1m/${DAY}/0930.bin`, new Error("r2 down"));
  assert.equal((await ask(P("0930.bin"), { env })).res.status, 503);
});

test("nothing but the three path forms, inside 04:00-19:59, reaches the bucket", async () => {
  const bad = ["v1/2026-11-18/0359.bin", "v1/2026-11-18/2000.bin", "v1/2026-13-01/0930.bin", "v1/2026-11-18/../x",
    "v1/2026-11-18/0930.bin/x", "v2/2026-11-18/0930.bin", "v1/2026-11-18/today.json", "v1/2026-11-18/930.bin", "__edge/x"];
  for (const p of bad) assert.equal(parseLive1mPath(LIVE1M_PREFIX + p), null, p);
  assert.deepEqual(parseLive1mPath(P("0400.bin")), { kind: "frame", rel: `${DAY}/0400.bin` });
  assert.deepEqual(parseLive1mPath(P("1959.bin")), { kind: "frame", rel: `${DAY}/1959.bin` });
  const env = { CHART_EDGE_SECRET: SECRET, LIVE1M: bucket() };
  for (const p of bad) assert.equal((await ask(LIVE1M_PREFIX + p, { env })).res.status, 404, p);
  assert.deepEqual(env.LIVE1M.asked, []);
  assert.equal((await ask(P("0930.bin"), { method: "POST" })).res.status, 405);
  const head = await ask(P("0930.bin"), { method: "HEAD" });
  assert.equal(head.res.status, 200);
});

test("LIVE1M_PREFIX overrides the object prefix", async () => {
  const env = { CHART_EDGE_SECRET: SECRET, LIVE1M: bucket("x/"), LIVE1M_PREFIX: "x/" };
  assert.equal((await ask(P("0930.bin"), { env })).res.status, 200);
  assert.deepEqual(env.LIVE1M.asked, [`x/${DAY}/0930.bin`]);
});

test("history paths are untouched by the live1m branch", async () => {
  const { res } = await ask("/api/hist/v1/index/s-ZZTEST.json", { env: { CHART_EDGE_SECRET: SECRET } });
  assert.equal(res.headers.get("x-bars-edge"), "history");
  assert.equal(typeof handleLive1m, "function");
});
