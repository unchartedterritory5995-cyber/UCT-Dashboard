"""chart_edge_token.py — the CHART EDGE ENTITLEMENT token (Phase 1: mint only).

WHY THIS EXISTS
---------------
Production routes member `/api/bars/{ticker}` traffic through a Cloudflare
Worker (`bars-edge-router`) straight to the bars-api tier — the web pod is not
in that path at all. So the web pod's `require_bars_access` cannot see those
requests, and the 2026-09-13 outage proved the converse: putting a
service-credential gate on the tier gates every paying member instead.

The only place that CAN answer "is this request entitled?" for that traffic is
the edge itself. This module mints the artifact that lets it: a short-lived,
HMAC-signed statement that the bearer's session satisfied the canonical chart
entitlement at mint time.

⛔⛔ PHASE 1 MINTS AND NOTHING ELSE. The Worker verifies in SHADOW MODE and
routes identically no matter what it finds. Nothing here can deny a request.

⛔ NOT `PUSH_SECRET`, AND THAT IS THE POINT. `PUSH_SECRET` is UCT's canonical
INTERNAL service credential and also signs webcal export tokens, capture tokens
and OAuth state — rotating it breaks every member's calendar subscription. This
token travels to a BROWSER-held cookie and is verified by third-party edge
infrastructure, so it gets its own secret with one job. A separate key means
rotating the chart edge key costs nothing else, and a compromise of it grants
exactly "may read bars" rather than the run of the service surface.

⛔ WHAT THE TOKEN DELIBERATELY DOES NOT CARRY. No email, no username, no session
id, no user id. The question the edge asks is "is this request entitled to chart
bars?", not "who is this?" — bars are not user-scoped, so an identifier would be
data the edge does not need, cannot use, and could leak. Adding one later needs a
concrete security requirement (e.g. per-user revocation lists), not convenience.

⭐ AND IT MUST NEVER ENTER A CACHE KEY. The token is per-member and short-lived;
the market data it guards is identical for everybody. If it ever reached the
cache identity it would shard one shared object into one object per member and
destroy the global chart performance the CDN exists to provide. Hence the
transport below (a cookie the edge reads and strips) rather than a query
parameter.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Optional, Tuple

from api.middleware.auth_middleware import PAID_PLANS, meets_plan_gate

#: Wire format version. The Worker rejects anything it does not know, so this is
#: the lever that retires a format without a flag day: mint v2, let v1 expire.
TOKEN_VERSION = 1

#: The cookie the browser carries. HttpOnly — the frontend never reads it.
COOKIE_NAME = "uct_chart_edge"

#: ⭐ PATH SCOPE IS A SECURITY CONTROL, NOT TIDINESS, and it is exact.
#: RFC 6265 path-matching sends a `Path=/api/bars` cookie to `/api/bars` and
#: `/api/bars/<anything>` — the remainder must start with `/`. It therefore does
#: NOT go to `/api/bars-history/...` or `/api/bars-today-pack` (remainder starts
#: with `-`). That is exactly the Worker Route's scope
#: (`uctintelligence.com/api/bars/*`) and no wider: the token is never sent to
#: the many endpoints that have no use for it, and Phase 1 cannot accidentally
#: influence the historical edge cache this phase is forbidden to touch.
COOKIE_PATH = "/api/bars"

#: Entitlement class — WHO the bearer is, not what they may read.
#:
#: ⛔⛔ TWO TRUST PATHS, TWO VALUES, AND THEY MUST NEVER BE INTERCHANGEABLE.
#: `bars` is a MEMBER whose session satisfied the canonical entitlement. `service`
#: is ONE trusted machine render. They travel differently (cookie vs header),
#: live for different lengths of time, and `verify()` below refuses a token whose
#: `ent` is not the one the caller asked for — so a service token pasted into the
#: member cookie is INVALID, and vice versa. Collapsing them into one value would
#: make a long-lived member token a renderer credential the moment either
#: transport leaked.
ENTITLEMENT_BARS = "bars"
ENTITLEMENT_SERVICE = "service"

#: Default TTL. DELIBERATELY CONSERVATIVE AND DELIBERATELY NOT THE FINAL
#: PRODUCTION VALUE — the owner approves that before enforcement. 15 minutes is
#: chosen because refresh is free here: the client already polls `/api/auth/me`,
#: which re-mints, so a short life costs no extra round trip while capping how
#: long a downgraded/cancelled member keeps edge access.
DEFAULT_TTL_SECONDS = 900

#: Default TTL for a RENDER (machine) token — deliberately much shorter than the
#: member's, because a service token is a capability for ONE render rather than a
#: session.
#:
#: ⭐ MEASURED, NOT COPIED. Production renders of `/r/chart` complete in ~1.7-2.2 s
#: warm; the slow paths observed were 15.5 s and 28.1 s (a readiness timeout),
#: against a render budget whose own ceiling is `ready_timeout_ms` (34 s default)
#: plus settle. 120 s covers the whole worst-case render — request, Chromium
#: startup, page load, the all-timeframe warm chain and capture — with room to
#: spare, while keeping the replay window two orders of magnitude below the
#: member token's 900 s.
DEFAULT_RENDER_TTL_SECONDS = 120

#: Tolerance for clock skew between the web pod and Cloudflare's edge. Small,
#: and applied only to "not yet valid", never to expiry.
CLOCK_SKEW_LEEWAY_SECONDS = 60


def ttl_seconds() -> int:
    """TTL from the environment, so the production value is a config decision.

    ⚠️ READ AT CALL TIME, NOT IMPORT TIME — the same rule `_access_payload`'s
    kill switch documents: a module-level capture would need a redeploy to
    change, which is exactly the knob we want to turn without one.
    """
    raw = (os.environ.get("CHART_EDGE_TOKEN_TTL_SECONDS") or "").strip()
    if not raw:
        return DEFAULT_TTL_SECONDS
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_TTL_SECONDS
    # A non-positive TTL would mint pre-expired tokens for everyone; treat a
    # nonsense value as "unset" rather than as an outage.
    return value if value > 0 else DEFAULT_TTL_SECONDS


def render_ttl_seconds() -> int:
    """TTL for a per-render service token. Same read-at-call-time rule as above."""
    raw = (os.environ.get("CHART_EDGE_RENDER_TOKEN_TTL_SECONDS") or "").strip()
    if not raw:
        return DEFAULT_RENDER_TTL_SECONDS
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_RENDER_TTL_SECONDS
    return value if value > 0 else DEFAULT_RENDER_TTL_SECONDS


def _secret() -> str:
    return (os.environ.get("CHART_EDGE_SECRET") or "").strip()


def _b64u(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64u_decode(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(payload_b64: str, secret: str) -> str:
    return _b64u(hmac.new(secret.encode("utf-8"),
                          payload_b64.encode("ascii"),
                          hashlib.sha256).digest())


def mint_service(now: Optional[int] = None) -> Optional[str]:
    """A capability for ONE trusted render, minted by the web backend.

    ⛔⛔ THE TRUST BELONGS TO THE INVOCATION, NOT THE ROUTE. `/r/chart` is a
    PUBLIC page — anyone can load it — so the page itself can never be trusted and
    is never handed this. Only the backend that decided to render mints one, and
    it reaches the headless browser as a request header for that render alone.
    Anybody who opens `/r/chart` themselves still classifies MISSING, which is a
    rail in `tests/test_chart_edge_render_handoff.py`.

    ⭐ SAME SIGNER, SAME SECRET, DIFFERENT ENTITLEMENT — no second crypto system.
    """
    return mint(ENTITLEMENT_SERVICE, now=now, ttl=render_ttl_seconds())


def mint(entitlement: str = ENTITLEMENT_BARS, now: Optional[int] = None,
         ttl: Optional[int] = None) -> Optional[str]:
    """Return a signed token, or None when no secret is configured.

    ⚠️ NONE IS THE SAFE ANSWER, NOT AN EXCEPTION. An unconfigured
    `CHART_EDGE_SECRET` must mean "this member simply gets no edge token" —
    which in Phase 1 is invisible and in Phase 2 would be a denial. Raising here
    would turn a missing environment variable into a 500 on `/api/auth/me`, i.e.
    a login outage, which is a far worse failure than a missing optimisation.
    """
    secret = _secret()
    if not secret:
        return None
    issued = int(now if now is not None else time.time())
    lifetime = ttl if ttl is not None else ttl_seconds()
    payload = {"v": TOKEN_VERSION, "iat": issued, "exp": issued + lifetime,
               "ent": entitlement}
    # `separators` keeps the token compact; `sort_keys` makes it byte-stable so
    # a test can compare two mints of the same instant.
    payload_b64 = _b64u(json.dumps(payload, separators=(",", ":"),
                                   sort_keys=True).encode("utf-8"))
    return f"v{TOKEN_VERSION}.{payload_b64}.{_sign(payload_b64, secret)}"


def is_entitled(user: dict, plan: Optional[str] = None) -> bool:
    """THE entitlement predicate — the canonical one, not a second opinion.

    ⛔⛔ `meets_plan_gate` IS DELIBERATE AND `paid_equiv` IS DELIBERATELY NOT
    USED. `_access_payload`'s `paid_equiv` is admin OR a paid plan OR an active
    trial — it does NOT include `comped`, and the chart-data policy does. Minting
    from `paid_equiv` would produce exactly the split this phase's brief forbids:
    a comped member whom `require_bars_access` admits at the origin and whom the
    edge would later refuse. One predicate, shared with `bars_auth`.
    """
    resolved = dict(user)
    if plan is not None:
        resolved["plan"] = plan
    return meets_plan_gate(resolved, list(PAID_PLANS))


def verify(token: Optional[str], now: Optional[int] = None,
           expect: str = ENTITLEMENT_BARS) -> Tuple[str, Optional[dict]]:
    """Classify a token exactly as the Worker does. Returns (classification, payload).

    ⭐ THIS EXISTS SO THE TWO IMPLEMENTATIONS CAN BE PROVEN EQUAL. The verifier
    that matters in production is the JavaScript one in
    `edge/bars-edge-router/worker.js`; this is its Python twin, and
    `tests/test_chart_edge_worker_interop.py` mints here and classifies THERE so
    a drift between them fails a test instead of a member's chart.

    Classifications are the four the shadow logs record:
      VALID | MISSING | EXPIRED | INVALID
    """
    if not token:
        return "MISSING", None
    secret = _secret()
    if not secret:
        # No key: nothing can be trusted. Not "MISSING" — the token was present.
        return "INVALID", None

    parts = token.split(".")
    if len(parts) != 3:
        return "INVALID", None
    version_tag, payload_b64, sig = parts
    if version_tag != f"v{TOKEN_VERSION}":
        return "INVALID", None

    # ⛔ SIGNATURE FIRST, ALWAYS. Parsing attacker-controlled JSON before proving
    # it is ours would let an unsigned payload steer the code that runs next.
    if not hmac.compare_digest(sig, _sign(payload_b64, secret)):
        return "INVALID", None

    try:
        payload = json.loads(_b64u_decode(payload_b64).decode("utf-8"))
    except Exception:  # noqa: BLE001 — any malformed body is simply not a token
        return "INVALID", None
    if not isinstance(payload, dict) or payload.get("v") != TOKEN_VERSION:
        return "INVALID", None

    exp = payload.get("exp")
    iat = payload.get("iat")
    if not isinstance(exp, int) or not isinstance(iat, int):
        return "INVALID", None

    current = int(now if now is not None else time.time())
    if current >= exp:
        return "EXPIRED", payload
    # A token stamped in the future is not expired, it is wrong — but a minute
    # of clock skew between two clouds is normal and must not read as an attack.
    if iat > current + CLOCK_SKEW_LEEWAY_SECONDS:
        return "INVALID", payload
    # ⛔ THE ENTITLEMENT MUST BE THE ONE THE CALLER ASKED FOR. This is what keeps
    # the two trust paths from becoming one: the member cookie is verified with
    # expect="bars" and the render header with expect="service", so neither
    # transport can carry the other's credential.
    if payload.get("ent") != expect:
        return "INVALID", payload
    return "VALID", payload
