/**
 * The live bar stream (`/api/stream/bars`) to the stream gateway (api/stream_gateway_main.py), 2026-11-17.
 *
 * The gateway runs web's own bar stream route in a process of its own, so a web restart or a burst of
 * page loads cannot delay a live candle (measured: 2-12 s behind for ~5 minutes after each web restart).
 *
 * Who goes there: a GET whose request carries a valid member chart cookie (or service token), while
 * `env.STREAM_GATEWAY_ORIGIN` is set; `env.STREAM_GATEWAY_PCT` (0-100, default 100) sends only that share
 * of such connections. EVERYTHING ELSE GOES TO WEB, exactly as before this file existed: no origin set (the
 * switch), no or an invalid cookie (a member whose cookie predates the stream path), anything but GET, and
 * any gateway failure (it cannot be reached, or answers 401 / 404 / 5xx, e.g. 503 while its own feed is not
 * connected). A member can therefore never be left without a stream by the gateway.
 */

export const STREAM_BARS_PATH = "/api/stream/bars";
export const EDGE_HEADER = "x-bars-edge";

/** The gateway origin from the Worker's environment, without a trailing slash, or "" (switched off). */
export function gatewayOrigin(env) {
  const v = env && typeof env.STREAM_GATEWAY_ORIGIN === "string" ? env.STREAM_GATEWAY_ORIGIN.trim() : "";
  return /^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/*$/.test(v) ? v.replace(/\/+$/, "") : "";
}

/** The share of entitled connections sent to the gateway (0-100); unset or unreadable is 100. */
export function gatewayShare(env) {
  const raw = env && env.STREAM_GATEWAY_PCT;
  if (raw === undefined || raw === null || raw === "") return 100;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 100;
}

/**
 * @param {Request} request
 * @param {object} env
 * @param {(req: Request) => Promise<boolean>} entitled  true only for a valid member cookie / service token
 * @param {{ random?: () => number }} [o]
 */
export async function routeBarStream(request, env, entitled, { random = Math.random } = {}) {
  const origin = gatewayOrigin(env);
  if (!origin || request.method !== "GET") return fetch(request);
  const share = gatewayShare(env);
  if (share <= 0 || (share < 100 && random() * 100 >= share)) return fetch(request);
  let ok = false;
  try { ok = (await entitled(request)) === true; } catch (_e) { ok = false; }
  if (!ok) return fetch(request);

  const url = new URL(request.url);
  let res;
  try {
    res = await fetch(new Request(origin + url.pathname + url.search, request));
  } catch (_e) {
    return fetch(request);
  }
  if (res.status === 401 || res.status === 404 || res.status >= 500) {
    try { await res.body?.cancel(); } catch (_e) { /* nothing to release */ }
    return fetch(request);
  }
  const out = new Response(res.body, res);
  out.headers.set(EDGE_HEADER, "stream-gateway");
  return out;
}
