/**
 * The live chart stream at the edge: `/api/stream/bars` to stream-edge, or to web.
 * docs/plans/2026-11-17-stream-edge.md.
 *
 * stream-edge is a small Railway service that serves ONLY this stream, so its delivery never waits
 * on the web pod's other work. Measured 2026-11-17: in web, the stream paused 1.5-5 s about every
 * 6 s, because the pod's interpreter is shared with dozens of CPU-heavy jobs.
 *
 * WHO GOES THERE (the canary). A request goes to STREAM_EDGE_ORIGIN when that variable is set AND
 * either `STREAM_EDGE_ALL` is "1" (everyone) or the browser carries `uct_stream_edge=1` (one person
 * opting in). Every other request passes through untouched to the zone's origin (web), exactly as
 * before this file existed.
 *
 * FALLBACK. stream-edge must answer 200 with an event stream within STREAM_EDGE_CONNECT_MS. A
 * network error, a timeout, a 5xx or a 401 (an expired edge cookie: web still accepts the member's
 * session) and the SAME request is passed to web instead. After the stream has started, a drop
 * is the browser's own reconnect (lib/barsStreamManager), which lands back here.
 *
 * ⛔ ONLY THE EDGE COOKIE TRAVELS. stream-edge admits a member by `uct_chart_edge` alone; the
 * session cookie and every other cookie are stripped, so the new service never holds a credential it
 * has no use for.
 */

export const STREAM_BARS_PATH = "/api/stream/bars";
export const CANARY_COOKIE = "uct_stream_edge";
export const EDGE_COOKIE = "uct_chart_edge";
export const STREAM_EDGE_CONNECT_MS = 4000;

function readCookieValue(cookieHeader, name) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** Does this request go to stream-edge? */
export function wantsStreamEdge(request, env) {
  if (!env || !env.STREAM_EDGE_ORIGIN) return false;
  if (env.STREAM_EDGE_ALL === "1") return true;
  return readCookieValue(request.headers.get("cookie"), CANARY_COOKIE) === "1";
}

/** The request as stream-edge receives it: same path and query, the edge cookie only. */
export function edgeRequestInit(request) {
  const headers = new Headers();
  for (const h of ["accept", "last-event-id", "user-agent", "cache-control"]) {
    const v = request.headers.get(h);
    if (v !== null) headers.set(h, v);
  }
  const tok = readCookieValue(request.headers.get("cookie"), EDGE_COOKIE);
  if (tok) headers.set("cookie", `${EDGE_COOKIE}=${tok}`);
  return { method: "GET", headers, redirect: "manual" };
}

/**
 * @param {Request} request
 * @param {object} env
 * @param {(url: string|Request, init?: object) => Promise<Response>} fetchImpl
 */
export async function handleStream(request, env, fetchImpl = fetch) {
  const url = new URL(request.url);
  if (url.pathname !== STREAM_BARS_PATH || request.method !== "GET" || !wantsStreamEdge(request, env)) {
    return fetchImpl(request);
  }
  const target = env.STREAM_EDGE_ORIGIN.replace(/\/+$/, "") + url.pathname + url.search;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), STREAM_EDGE_CONNECT_MS);
  let r = null;
  try {
    r = await fetchImpl(target, { ...edgeRequestInit(request), signal: ctl.signal });
  } catch (_e) {
    r = null;                                   // network error / timeout: web serves it
  } finally {
    clearTimeout(timer);
  }
  const ok = r && r.status === 200 && (r.headers.get("content-type") || "").startsWith("text/event-stream");
  if (!ok) {
    if (r && r.body) { try { await r.body.cancel(); } catch (_e) { /* already closed */ } }
    console.log(JSON.stringify({ evt: "stream_edge_fallback", status: r ? r.status : 0 }));
    const back = await fetchImpl(request);
    const h = new Headers(back.headers);
    h.set("X-Stream-Edge", "web-fallback");
    return new Response(back.body, { status: back.status, headers: h });
  }
  const h = new Headers(r.headers);
  h.set("X-Stream-Edge", "edge");
  return new Response(r.body, { status: 200, headers: h });
}
