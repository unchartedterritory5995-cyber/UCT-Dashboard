"""Where the chart-edge render capability may travel — and nowhere else.

⛔⛔ THIS IS A SECURITY BOUNDARY, NOT A CONVENIENCE FILTER, and it is a separate
module for two reasons: it must be unit-testable without Playwright or a browser,
and the rule deserves to be read on its own rather than buried in a route handler.

The renderer drives a real headless browser over a PUBLIC page. Playwright's
`set_extra_http_headers` would attach a header to EVERY request that page makes —
fonts, analytics, images, any third-party origin the page ever gains. A short
lived credential sprayed at every host is still a credential sprayed at every
host. So the token is attached per-request, and only when this function says so.

THE RULE: same scheme, same host, same port as the page being rendered, AND a
path under `/api/bars/` — exactly the Worker Route's scope (`/api/bars/*`) and no
wider.

⭐ NOTE WHAT THIS DELIBERATELY EXCLUDES, each one asserted in
`tests/test_chart_edge_render_scope.py`:
  * `/api/bars-history/...` — a different path family with its own cached, shared
    edge behaviour that this phase must not touch. `"/api/bars-history/"` does
    NOT start with `"/api/bars/"`, which is the whole reason the prefix is
    written with its trailing slash.
  * `/api/auth/me`, `/api/bars-today-pack`, `/api/barspack/*` and every other UCT
    path — none of them are behind the Worker, so a token there is pure leak.
  * any other host, http, or a different port.
"""
from __future__ import annotations

from urllib.parse import urlparse

#: The request header the capability rides in. Mirrors `SERVICE_HEADER` in
#: `edge/bars-edge-router/worker.js`; a rail pins the two together.
EDGE_TOKEN_HEADER = "X-Chart-Edge-Token"

#: Trailing slash is load-bearing — see the module docstring.
_BARS_PREFIX = "/api/bars/"


def edge_token_targets(request_url: str, page_url: str) -> bool:
    """True when `request_url` is a bars request on the SAME origin as `page_url`.

    Fails CLOSED on anything it cannot parse: an unparseable URL is not a reason
    to attach a credential to it.
    """
    try:
        r = urlparse(request_url or "")
        p = urlparse(page_url or "")
    except Exception:  # noqa: BLE001 — a malformed URL simply gets no token
        return False

    # https only. The page is always https (`check_url` enforces it), and a
    # downgrade to http is exactly when a secret must not be sent.
    if r.scheme != "https" or p.scheme != "https":
        return False

    r_host = (r.hostname or "").lower()
    p_host = (p.hostname or "").lower()
    if not r_host or r_host != p_host:
        return False
    if (r.port or 443) != (p.port or 443):
        return False

    return (r.path or "/").startswith(_BARS_PREFIX)


# ── calls the rendered page makes that only a signed-in member can use ────────
#
# WHY (measured 2026-11-13, Cloudflare): every render loads the whole app signed out, so the app
# makes its member start-up calls and `web` answers each one 401. In one trading session that was
# 3,096 `/api/auth/preferences`, 1,484 `/api/auth/me`, about 1,470 each of `/api/j2/accounts`,
# `/positions` and `/trades`, 1,544 `/api/breadth-symbols`, 1,450 `/api/signature/definitions` and
# 1,448 `/api/market-indicators`: about 12,400 requests through the one busy `web` process for an
# answer that is always the same. The renderer now gives that answer itself and the request never
# leaves the browser.
#
# THE RULE: a GET on the SAME origin as the page, whose path is one of the member-only paths below.
# The answer is byte-for-byte what `web` sends a client with no session.
#
# NOT in the list, on purpose:
#   * `/api/bars/*`: carries the render capability (above) and is answered for real;
#   * `/api/bars-history/*`, `/api/bars-today-pack`, `/api/barspack/*`: the chart's own data
#     family, owned by the bars work; whether the renderer should be let in there is their call;
#   * `/api/r/*`, `/api/ticker-meta/*`, `/api/ticker-ipo/*`, `/api/chart/markers/*`: answered
#     for real today and drawn on the chart.
#
# Kill switch: `RENDER_SKIP_MEMBER_CALLS=0` on the chart-renderer service (default on).

#: Exactly what `web` answers a request with no session (read from production 2026-11-16).
SIGNED_OUT_STATUS = 401
SIGNED_OUT_BODY = '{"detail":"Not authenticated"}'
SIGNED_OUT_SWITCH = "RENDER_SKIP_MEMBER_CALLS"

_MEMBER_ONLY_PATHS = frozenset({
    "/api/auth/me",
    "/api/auth/preferences",
    "/api/breadth-symbols",
    "/api/signature/definitions",
    "/api/market-indicators",
})
#: Trailing slash is load-bearing here too: `/api/j2/` must not match `/api/j2x`.
_MEMBER_ONLY_PREFIXES = ("/api/j2/",)


def signed_out_enabled(environ=None) -> bool:
    import os
    env = os.environ if environ is None else environ
    return (env.get(SIGNED_OUT_SWITCH) or "1").strip().lower() not in ("0", "false", "off", "no")


def answered_signed_out(request_url: str, page_url: str, method: str = "GET") -> bool:
    """True when the renderer may answer this request itself with the signed-out 401.

    Fails toward the network: anything it cannot parse, any other origin, any method but GET
    and any path not named above goes out exactly as before."""
    if (method or "").upper() != "GET":
        return False
    try:
        r = urlparse(request_url or "")
        p = urlparse(page_url or "")
    except Exception:  # noqa: BLE001 - a malformed URL is simply left alone
        return False
    if r.scheme != "https" or p.scheme != "https":
        return False
    r_host = (r.hostname or "").lower()
    if not r_host or r_host != (p.hostname or "").lower():
        return False
    try:
        if (r.port or 443) != (p.port or 443):
            return False
    except ValueError:
        return False
    path = r.path or "/"
    return path in _MEMBER_ONLY_PATHS or any(path.startswith(x) for x in _MEMBER_ONLY_PREFIXES)
