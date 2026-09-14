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
