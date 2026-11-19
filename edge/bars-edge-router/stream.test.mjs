/** stream.js: the live chart stream's canary routing to stream-edge, with fallback to web. */
import test from "node:test";
import assert from "node:assert/strict";
import { handleStream, wantsStreamEdge, edgeRequestInit, STREAM_BARS_PATH } from "./stream.js";

const URL0 = "https://uctintelligence.com/api/stream/bars?bars=ZZA:1&v=2";
const ENV = { STREAM_EDGE_ORIGIN: "https://edge.example" };
const req = (cookie, url = URL0) => new Request(url, { headers: cookie ? { cookie } : {} });
const sse = (status = 200) => new Response("event: heartbeat\ndata: {}\n\n",
  { status, headers: { "content-type": status === 200 ? "text/event-stream" : "application/json" } });

function recorder(edgeResp) {
  const calls = [];
  const f = async (u, init) => {
    const target = typeof u === "string" ? u : u.url;
    calls.push({ target, init, isOriginal: typeof u !== "string" });
    if (typeof u !== "string") return sse();                       // web (the zone origin)
    if (edgeResp instanceof Error) throw edgeResp;
    return edgeResp;
  };
  return { f, calls };
}

test("no canary cookie and no global flag: untouched to web", async () => {
  const { f, calls } = recorder(sse());
  await handleStream(req("uct_session=s"), ENV, f);
  assert.equal(calls.length, 1); assert.equal(calls[0].isOriginal, true);
});

test("no origin configured: nobody goes to stream-edge, even with the cookie", () => {
  assert.equal(wantsStreamEdge(req("uct_stream_edge=1"), {}), false);
});

test("the canary goes to stream-edge with ONLY the edge cookie", async () => {
  const { f, calls } = recorder(sse());
  const r = await handleStream(req("uct_session=SECRET; uct_stream_edge=1; uct_chart_edge=v1.a.b"), ENV, f);
  assert.equal(r.status, 200); assert.equal(r.headers.get("X-Stream-Edge"), "edge");
  assert.equal(calls[0].target, "https://edge.example/api/stream/bars?bars=ZZA:1&v=2");
  assert.equal(calls[0].init.headers.get("cookie"), "uct_chart_edge=v1.a.b");
  assert.ok(!String(calls[0].init.headers.get("cookie")).includes("SECRET"));
});

test("STREAM_EDGE_ALL sends everyone", async () => {
  const { f, calls } = recorder(sse());
  await handleStream(req("uct_chart_edge=t"), { ...ENV, STREAM_EDGE_ALL: "1" }, f);
  assert.equal(calls[0].isOriginal, false);
});

for (const [name, resp] of [["a 401 (expired edge cookie)", sse(401)], ["a 503", sse(503)], ["a network error", new Error("down")]]) {
  test(`${name} from stream-edge falls back to web`, async () => {
    const { f, calls } = recorder(resp);
    const r = await handleStream(req("uct_stream_edge=1; uct_chart_edge=t"), ENV, f);
    assert.equal(r.status, 200); assert.equal(r.headers.get("X-Stream-Edge"), "web-fallback");
    assert.equal(calls.length, 2); assert.equal(calls[1].isOriginal, true);
  });
}

test("other stream paths are never routed", async () => {
  const { f, calls } = recorder(sse());
  await handleStream(req("uct_stream_edge=1", "https://uctintelligence.com/api/stream/prices?tickers=ZZA"), ENV, f);
  assert.equal(calls[0].isOriginal, true);
  assert.equal(STREAM_BARS_PATH, "/api/stream/bars");
});

test("Last-Event-ID survives the hop (resume declarations)", () => {
  const init = edgeRequestInit(new Request(URL0, { headers: { "last-event-id": "bars-7", cookie: "uct_chart_edge=t" } }));
  assert.equal(init.headers.get("last-event-id"), "bars-7");
});
