/**
 * /api/hist/ (history.js): pieces built by the PYTHON encoder (the app's synthetic fixture) are put
 * in a stand-in bucket, asked for through the real Worker entry point, sent over a REAL HTTP
 * connection, inflated by the HTTP client's own `Content-Encoding: br` handling (the step a
 * browser does), and decoded by the app's reader. The values must equal the fixture's.
 *
 * Run: node --test   (from edge/bars-edge-router/)
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";

import worker from "./worker.js";
import {
  parseHistoryPath, splitPiece, handleHistory, crc32, HEADER_NAME, COLUMNS_TYPE, PIECE_TYPE,
} from "./history.js";
import { decodeColumns, decodePiece } from "../../app/src/data/historyLake/piece.js";
import { brotliDecompressSync } from "node:zlib";

const FIX = JSON.parse(readFileSync(
  new URL("../../app/src/data/historyLake/__fixtures__/pieces.json", import.meta.url), "utf8"));
const CASES = FIX.cases;
const SECRET = "test-edge-secret";
const bytesOf = (b64) => new Uint8Array(Buffer.from(b64, "base64"));

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

function bucket(extra = {}) {
  const store = new Map(CASES.map((c) => [c.relpath, bytesOf(c.b64)]));
  store.set("v1/index/s-ZZTEST.json", new TextEncoder().encode('{"symbol":"ZZTEST","series":{},"v":1}'));
  for (const [k, v] of Object.entries(extra)) store.set(k, v);
  const asked = [];
  return {
    asked,
    async get(key) {
      asked.push(key);
      const v = store.get(key);
      if (v === undefined) return null;
      if (v instanceof Error) throw v;
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

test("every fixture piece survives bucket -> worker -> HTTP br -> reader, value for value", async () => {
  assert.ok(CASES.length >= 7);
  for (const c of CASES) {
    const { res, origins, env } = await ask(`/api/hist/${c.relpath}?c=${c.header.crc}`);
    assert.equal(res.status, 200, c.name);
    assert.deepEqual(origins, [], "history never asks an origin");
    assert.deepEqual(env.HISTORY.asked, [c.relpath]);
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

test("raw form and a client without br get the stored file unchanged", async () => {
  const c = CASES[0];
  const stored = bytesOf(c.b64);
  for (const [path, headers] of [
    [`/api/hist/${c.relpath}?raw=1`, {}],
    [`/api/hist/${c.relpath}`, { "accept-encoding": "gzip" }],
    [`/api/hist/${c.relpath}`, { "accept-encoding": "gzip, br;q=0" }],
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
  const c = CASES[0];
  const path = `/api/hist/${c.relpath}`;
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
  // a render capability in its header is entitled; the same token as a member cookie is not (above)
  const { res } = await ask(path, { cookie: false, headers: { "x-chart-edge-token": wrongEnt } });
  assert.equal(res.status, 200);
  // a check that throws, or answers anything but true, is a no
  for (const fn of [async () => { throw new Error("boom"); }, async () => "yes", async () => 1]) {
    const b = bucket();
    const r = await handleHistory(new Request("https://uctintelligence.com" + path), { HISTORY: b }, fn);
    assert.equal(r.status, 401);
    assert.deepEqual(b.asked, []);
  }
  // no secret bound: nobody is entitled
  const noSecret = await ask(path, { env: { HISTORY: bucket() } });
  assert.equal(noSecret.res.status, 401);
});

test("the version key: right crc is immutable, wrong crc is 409, none is short-lived", async () => {
  const c = CASES[1];
  const none = await ask(`/api/hist/${c.relpath}`);
  assert.equal(none.res.headers.get("cache-control"), "private, max-age=60");
  const wrong = await ask(`/api/hist/${c.relpath}?c=${c.header.crc + 1}`);
  assert.equal(wrong.res.status, 409);
  assert.equal(wrong.res.headers.get("x-ubh-crc"), String(c.header.crc));
  assert.equal(wrong.res.headers.get("cache-control"), "no-store");
  assert.equal(wrong.res.headers.get("content-encoding"), null);
});

test("index, missing, unreadable, unconfigured, wrong method, HEAD", async () => {
  const idx = await ask("/api/hist/v1/index/s-ZZTEST.json");
  assert.equal(idx.res.status, 200);
  assert.equal(idx.res.headers.get("content-type"), "application/json");
  assert.equal(idx.res.headers.get("cache-control"), "private, max-age=60");
  assert.equal((await idx.res.json()).symbol, "ZZTEST");

  const missing = await ask("/api/hist/v1/5/s-NOPE/2020Q1.ubh");
  assert.equal(missing.res.status, 404);
  assert.deepEqual(missing.env.HISTORY.asked, ["v1/5/s-NOPE/2020Q1.ubh"]);

  const junkEnv = { CHART_EDGE_SECRET: SECRET, HISTORY: bucket({ "v1/60/s-JUNK/2020.ubh": new Uint8Array(40) }) };
  assert.equal((await ask("/api/hist/v1/60/s-JUNK/2020.ubh", { env: junkEnv })).res.status, 502);

  const failEnv = { CHART_EDGE_SECRET: SECRET, HISTORY: bucket({ "v1/60/s-ERR/2020.ubh": new Error("r2 down") }) };
  const failed = await ask("/api/hist/v1/60/s-ERR/2020.ubh", { env: failEnv });
  assert.equal(failed.res.status, 503);
  assert.ok(failed.res.headers.get("retry-after"));

  const unbound = await ask(`/api/hist/${CASES[0].relpath}`, { env: { CHART_EDGE_SECRET: SECRET } });
  assert.equal(unbound.res.status, 503);
  assert.equal((await unbound.res.json()).error, "history_not_configured");

  const post = await ask(`/api/hist/${CASES[0].relpath}`, { method: "POST" });
  assert.equal(post.res.status, 405);
  assert.deepEqual(post.env.HISTORY.asked, []);

  const head = await ask(`/api/hist/${CASES[0].relpath}`, { method: "HEAD" });
  assert.equal(head.res.status, 200);
  assert.equal(head.res.headers.get("content-encoding"), "br");
  assert.equal((await head.res.arrayBuffer()).byteLength, 0);
});

test("nothing but the two path forms reaches the bucket", async () => {
  const good = [
    ["/api/hist/v1/1/s-AAPL/2015-01.ubh", "v1/1/s-AAPL/2015-01.ubh"],
    ["/api/hist/v1/5/s-BRK_2EB/2015Q4.ubh", "v1/5/s-BRK_2EB/2015Q4.ubh"],
    ["/api/hist/v1/60e/s-A/2003.ubh", "v1/60e/s-A/2003.ubh"],
    ["/api/hist/v1/index/s-BAC_70B.json", "v1/index/s-BAC_70B.json"],
  ];
  for (const [path, key] of good) assert.equal(parseHistoryPath(path).key, key, path);
  const bad = [
    "/api/hist/v1/1/s-AAPL/2015.ubh", "/api/hist/v1/1/s-AAPL/2015-13.ubh", "/api/hist/v1/5/s-AAPL/2015-01.ubh",
    "/api/hist/v1/5/s-AAPL/2015Q5.ubh", "/api/hist/v1/15/s-AAPL/2015Q1.ubh", "/api/hist/v1/7/s-AAPL/2015.ubh",
    "/api/hist/v2/1/s-AAPL/2015-01.ubh", "/api/hist/v1/1/AAPL/2015-01.ubh", "/api/hist/v1/1/s-aapl/2015-01.ubh",
    "/api/hist/v1/1/s-AAPL/../2015-01.ubh", "/api/hist/v1/1/s-A%2F..%2Fx/2015-01.ubh", "/api/hist/v1/1/s-/2015-01.ubh",
    "/api/hist/v1/1/s-AAPL/2015-01.ubh/x", "/api/hist/v1/1/s-AAPL/2015-01", "/api/hist/v1/index/s-AAPL",
    "/api/hist/v1/index/s-AAPL.json/x", "/api/hist/ledger.json", "/api/hist/v1/_spill/x", "/api/hist/",
    "/api/hist/v1/1/s-A_2e/2015-01.ubh", "/api/history/v1/1/s-AAPL/2015-01.ubh",
    "/api/hist/v1/index/s-aapl.json", "/api/hist/v1/index/ledger.json", "/api/hist/v1/index/s-A.B.json",
  ];
  for (const path of bad) assert.equal(parseHistoryPath(path), null, path);
  const { res, env } = await ask("/api/hist/v1/1/s-AAPL/..%2F..%2Fledger.json");
  assert.equal(res.status, 404);
  assert.deepEqual(env.HISTORY.asked, []);
});

test("splitPiece refuses what is not a piece", () => {
  const good = bytesOf(CASES[0].b64);
  const s = splitPiece(good);
  assert.deepEqual(s.header, CASES[0].header);
  assert.deepEqual(new Uint8Array(brotliDecompressSync(s.body)).length, CASES[0].header.body);
  const flip = (i, v) => { const b = good.slice(); b[i] = v; return b; };
  assert.equal(splitPiece(flip(0, 0x56)), null);
  assert.equal(splitPiece(flip(3, 2)), null);
  assert.equal(splitPiece(flip(8, 0x00)), null);              // header no longer JSON
  // one digit of a header number changed: still JSON, still plausible, fails the prefix CRC
  const at = Buffer.from(good).indexOf('"pscale":1') + 9;
  assert.equal(String.fromCharCode(good[at]), "1");
  assert.equal(splitPiece(flip(at, 0x31 + 0)).header.pscale, CASES[0].header.pscale);   // control: same byte
  const zeroAt = at + 1;
  assert.equal(String.fromCharCode(good[zeroAt]), "0");
  const lied = splitPiece(flip(zeroAt, 0x31));                 // "pscale":10000 -> 11000: valid JSON, wrong CRC
  assert.equal(lied, null);
  // a file with a correct CRC over a wrong magic or version is still not a piece
  const end = 6 + good[4] + 256 * good[5];
  const resign = (b) => { const c = crc32(b.subarray(0, end)); b[end] = c & 255; b[end + 1] = (c >>> 8) & 255; b[end + 2] = (c >>> 16) & 255; b[end + 3] = c >>> 24; return b; };
  assert.deepEqual(splitPiece(resign(good.slice())).header, CASES[0].header);   // control: re-signing is sound
  assert.equal(splitPiece(resign(flip(0, 0x56))), null);
  assert.equal(splitPiece(resign(flip(3, 2))), null);
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xCBF43926);
  assert.equal(splitPiece(good.subarray(0, 6 + good[4] + 256 * good[5] + 4)), null);   // no body
  assert.equal(splitPiece(good.subarray(0, 9)), null);
  assert.equal(splitPiece("UBH"), null);
});

test("other paths are untouched by the history branch", async () => {
  const bars = await ask("/api/bars/AAPL?tf=5", { cookie: false });
  assert.equal(bars.origins.length, 1);
  assert.match(bars.origins[0], /bars-api/);
  const other = await ask("/api/histogram", { cookie: false });
  assert.equal(other.origins.length, 1);
  assert.equal(await other.res.text(), "origin");
});
