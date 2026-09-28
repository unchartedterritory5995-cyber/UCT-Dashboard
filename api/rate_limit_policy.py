"""RATE_LIMIT_POLICY -- per-route-family HTTP rate limits (TERM-080 / FB-S9-03).

WHY THIS EXISTS
---------------
Measured 2026-09-28 over `api.main:app`: 1,453 route entries, and the only HTTP
limits were 41 `@limiter.limit` decorators hand-applied across six router
modules (`grep -rn "^@limiter.limit" api`) plus the inline Notebook scopes. A terminal with programmatic clients needs a limit on
every route, and 1,400 hand-applied decorators would be DOC-1 in code (a roster
nobody can keep current). So this is a DEFAULT-PLUS-OVERRIDE policy:

  * ONE table, `FAMILIES`, maps route-template PREFIXES to a family and each
    family to one limit. A route is in the family of its LONGEST declared
    prefix, matched on a path-segment boundary (`/api/bars` covers
    `/api/bars/{t}`, never `/api/bars-history`). A new route under a declared
    prefix inherits that family's limit with no code; a route under a NEW
    prefix fails the census rail BY NAME until someone declares it.
  * `EXEMPT` names what is deliberately never limited, each with a reason.
  * ONE pure-ASGI middleware applies it (never BaseHTTPMiddleware -- it
    buffers, and the tape and the price feed are SSE). It sits where the
    policy can be applied to the partner-owned routers without editing them.
  * THE SHARED LIMITER (`api/limiter.py`), never a second one: each family is a
    scope `route-policy:<family>` in that Limiter's in-memory storage, beside
    the Notebook personal-API and share/publish scopes.

KEYS
----
  * a signed-in caller (a valid `uct_session`) -> `member:<user id>`, so a
    member is one bucket however many sessions they hold. The session lookup
    is the same `validate_session` every auth path uses, CACHED per session
    token for `_MEMBER_TTL_S` so this adds at most one read per session per
    minute -- never a read per request (PERF-1: the per-request auth-path DB
    write was the 2026-07-01 outage; this path writes nothing).
  * anyone else -> `ip:<16 hex>`, a salted SHA-256 of the client IP from the
    Limiter's OWN key function (`request_ip.client_ip`), never a second copy
    of that logic. The raw IP is never logged or stored; the salt is random
    per process, so a hash is meaningful within one pod's life only.
  * `Authorization: Bearer <PUSH_SECRET>` -> EXEMPT. It is the credential every
    internal caller already holds (engine pushes, ops curls, pollers), and
    internal callers must never be rate-limited out. The comparison is
    `open_reads_gate._bearer_is_push_secret` (constant-time, blank secret
    exempts nobody) -- one authority for "is this the internal bearer".

THE FLAG -- `RATE_LIMIT_POLICY`, read PER REQUEST (no rebuild to change it)
---------------------------------------------------------------------------
    unset / "off" -> exactly today's behaviour. The middleware returns before
                     it classifies a path, reads a cookie or touches the store.
    "shadow"      -> nothing is ever blocked. Every request is COUNTED against
                     its family's limit; a would-limit is logged at most once
                     per (family, key, minute) as `[rate-limit-policy]
                     would-limit ...` and counted in the admin status read.
    "enforce"     -> past the limit: 429 with `Retry-After` (whole seconds to
                     the window reset), `X-RateLimit-Limit/-Remaining/-Reset`,
                     and a JSON body naming the family -- a limit a client can
                     OBEY, not merely one that refuses.
    anything else -> "shadow" (a typo must never block, and never be silent).

Default OFF, so deploying this changes nothing for anyone.

⛔ FAILS OPEN. Unlike a gate, a limiter that errors must not take the site
down: any exception while evaluating is logged and the request proceeds.

⚠️ PER-PROCESS STATE: the counters live in the shared Limiter's in-memory
storage, so a second web process would double every family's budget (the
CLAUDE.md single-process roster).

⚠️ THE NUMBERS ARE STARTING CEILINGS, NOT MEASUREMENTS. They are set well above
what one member's browser does (the tiers below say why), so shadow mode can
show what real traffic looks like before any of them blocks anyone. Read the
would-limit lines, then tune a tier, then enforce.
"""
from __future__ import annotations

import hashlib
import logging
import math
import os
import secrets
import threading
import time
from collections import Counter
from typing import NamedTuple

from fastapi import APIRouter, Depends
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse

from api.limiter import limiter
from api.middleware.auth_middleware import require_admin

logger = logging.getLogger(__name__)

FLAG = "RATE_LIMIT_POLICY"
MODE_OFF = "off"
MODE_SHADOW = "shadow"
MODE_ENFORCE = "enforce"

# ⭐ Declared as a MODE table so `api/services/feature_flag_index.mode_flags()`
# derives the flag, its default and its vocabulary from THIS expression -- the
# same literals `mode()` falls back to.
RATE_LIMIT_MODE_FLAGS = {
    "RATE_LIMIT_POLICY": (MODE_OFF, (MODE_OFF, MODE_SHADOW, MODE_ENFORCE)),
}

#: The limiter scope every family's counter lives under (`route-policy:<family>`).
SCOPE_PREFIX = "route-policy:"

#: The SPA catch-all api/main.py mounts only when app/dist is built -- one
#: definition, the auditor's.
from api.auth_surface_check import SPA_CATCH_ALL  # noqa: E402

STATUS_PATH = "/api/admin/rate-limit-policy"

KIND_FAMILY = "family"
KIND_EXEMPT = "exempt"


# ─────────────────────────────────────────────────────────────────────────────
# THE TIERS. Each is a ceiling per KEY (one member, or one client IP) per family.
# ─────────────────────────────────────────────────────────────────────────────

#: Market data the SPA fans out on its own: a 16-cell chart grid warms up to 8
#: timeframes per cell through the bounded prefetch queue, each chart re-polls
#: its delta every 30 s, and the live-price hooks poll every 15 s. 20 a second
#: sustained is several full grids at once.
TIER_BULK = "1200/minute"
#: Ordinary app reads and writes: a page mounts a handful of SWR hooks, the
#: workspace autosave is debounced to 500 ms (<= 120/minute while dragging).
TIER_STANDARD = "600/minute"
#: Opening a long-lived SSE stream. One member's pooled price/bar/tape streams
#: reconnect on a debounced union change; 2 a second is far past that.
TIER_STREAM = "120/minute"
#: Routes whose every call can spend a model or a metered vendor. Their own
#: per-route decorators and daily caps stay the real cost control; this is the
#: family ceiling above them.
TIER_COSTLY = "120/minute"
#: Anonymous-writable intake (waitlist, page analytics, client error reports).
#: A browser posts these a few times per page view at most.
TIER_INTAKE = "60/minute"


class Family(NamedTuple):
    limit: str
    reason: str
    prefixes: tuple[str, ...]


# ─────────────────────────────────────────────────────────────────────────────
# THE TABLE -- the single authority. Route-template PREFIX -> family. Every
# route of `api.main:app` must classify into a family or into EXEMPT
# (tests/test_rate_limit_policy.py derives the route set from the app itself),
# and every prefix here must match a real route (a typo is stale, and fails).
# ─────────────────────────────────────────────────────────────────────────────
FAMILIES: dict[str, Family] = {
    "market-data": Family(
        TIER_BULK,
        "Bars, quotes and ticker reference data the SPA fetches on its own "
        "schedule (chart warm-up, 15 s price polls, 30 s bar deltas).",
        ("/api/bars", "/api/bars-history", "/api/bars-today-pack", "/api/barspack",
         "/api/intradaypack", "/api/intraday-update", "/api/live-prices",
         "/api/snapshot", "/api/movers", "/api/extended-movers", "/api/chart",
         "/api/chart-markers", "/api/ticker-search", "/api/ticker-meta",
         "/api/ticker-logo", "/api/ticker-ipo", "/api/ticker-types", "/api/logos",
         "/api/quote-of-the-day", "/api/market-calendar", "/api/massive",
         "/api/provenance", "/api/etf", "/api/single-stock-etfs", "/api/delisted",
         "/api/maintenance"),
    ),
    "render": Family(
        TIER_BULK,
        "Headless render-page reads (CHART_RENDER_TOKEN, not a session), so every "
        "Discord render from the chart-renderer shares ONE IP key: bulk ceiling.",
        ("/api/r",),
    ),
    "options-flow": Family(
        TIER_BULK,
        "The Options Flow / Live Flow / dark-pool family (partner routers "
        "included, covered here at their prefix, never by editing them); the "
        "flow page polls several of these concurrently.",
        ("/api/flow", "/api/flow-scoreboard", "/api/flow-reconcile", "/api/live",
         "/api/liveflow", "/api/schwab", "/api/gex", "/api/oi", "/api/oi-snapshot",
         "/api/darkpool", "/api/dealer-positioning", "/api/notable-flow",
         "/api/top-flow", "/Darkpool-data.csv", "/Indexes-data.csv"),
    ),
    "stream": Family(
        TIER_STREAM,
        "Long-lived SSE feeds: a hit is a CONNECT, not a message, so the ceiling "
        "bounds reconnect storms rather than data.",
        ("/api/stream", "/api/live/massive/stream", "/api/live/massive/curated-stream",
         "/api/community/chat/stream"),
    ),
    "market-analytics": Family(
        TIER_STANDARD,
        "Breadth, regime, themes, leadership and the other computed market "
        "reads a dashboard page mounts once and re-polls slowly.",
        ("/api/breadth", "/api/breadth-monitor", "/api/breadth-symbols", "/api/nhnl",
         "/api/rs-rankings", "/api/sector-strength", "/api/volume-scan",
         "/api/scatter", "/api/market-indicators", "/api/regime", "/api/cot",
         "/api/analogs", "/api/leader-persistence", "/api/confluence",
         "/api/confidence-scores", "/api/theme-index", "/api/theme-performance",
         "/api/theme-rotation", "/api/theme-sets", "/api/themes", "/api/groups",
         "/api/compare", "/api/uct20", "/api/leadership", "/api/rundown",
         "/api/candidates", "/api/dashboard", "/api/traders", "/api/signature",
         "/api/entity", "/api/terminal-next"),
    ),
    "research": Family(
        TIER_STANDARD,
        "Per-ticker research, fundamentals, filings, earnings, calendar and news "
        "-- cached vendor reads behind the research pages and the calendar.",
        ("/api/research", "/api/about", "/api/fundamentals", "/api/fundamentals-full",
         "/api/fundamentals-statements", "/api/filings", "/api/insider",
         "/api/analyst", "/api/analyst-actions", "/api/ownership", "/api/earnings",
         "/api/earnings-analysis", "/api/earnings-gaps", "/api/earnings-intel",
         "/api/calendar", "/api/catalysts", "/api/news", "/api/news-catalysts",
         "/api/company-news", "/api/chart-news", "/api/tweets"),
    ),
    "screener": Family(
        TIER_STANDARD,
        "Screener, scans, patterns, backtests, user definitions and indicator "
        "alerts -- member-driven, one request per action.",
        ("/api/screener", "/api/scanner", "/api/scans", "/api/patterns",
         "/api/backtest", "/api/user-definitions", "/api/setup-templates",
         "/api/setup-performance", "/api/model-examples", "/api/indicator-alerts",
         "/api/indicator-telemetry"),
    ),
    "member-workspace": Family(
        TIER_STANDARD,
        "The member's own state: Journal 2.0 / Notebook, watchlists, tags, "
        "alerts, the hub, the chart workspace (autosave is debounced).",
        ("/api/j2", "/api/watchlists", "/api/watchlist", "/api/watchlist-alerts",
         "/api/watchlist-performance", "/api/ticker-tags", "/api/alerts", "/api/hub",
         "/api/upb", "/api/member", "/api/portfolio", "/api/risk-summary",
         "/api/pre-trade-checklist", "/api/psychology-events", "/api/coaching-notes",
         "/api/skill-assessments", "/api/wire-feedback", "/api/charts",
         "/api/workspace", "/api/tracings"),
    ),
    "community-content": Family(
        TIER_STANDARD,
        "Community, The Desk, education, Model Book, support status and the "
        "Discord ops routes (the interactions endpoint is exempt below).",
        ("/api/community", "/api/desk", "/api/education", "/api/modelbook",
         "/api/support", "/api/discord"),
    ),
    "ai": Family(
        TIER_COSTLY,
        "Model-backed answers (AI search, flow explain, indicator vision, stock "
        "brief, transcript summaries): each call can spend tokens.",
        ("/api/ai-search", "/api/flow-explain", "/api/indicator-vision",
         "/api/stock-brief", "/api/transcripts"),
    ),
    "voice": Family(
        TIER_STANDARD,
        "Voice / Compass. Its routes carry their own per-route decorators (up to "
        "180/minute on the transcript post), so this ceiling sits above them.",
        ("/api/voice",),
    ),
    "auth": Family(
        TIER_STANDARD,
        "Session, account and preferences routes. Login/signup/reset keep their "
        "own tight per-route decorators; preferences writes are debounced.",
        ("/api/auth",),
    ),
    "public-intake": Family(
        TIER_INTAKE,
        "Writes an anonymous browser can make (waitlist, landing analytics, client "
        "error reports, the Q1 probe sink): a few per page view at most.",
        ("/api/waitlist", "/api/landing-analytics", "/api/client-errors",
         "/api/q1-probe-result", "/api/q1-probe-results"),
    ),
    "admin-ops": Family(
        TIER_STANDARD,
        "Admin and ops reads/writes. Internal pollers carry the PUSH_SECRET bearer "
        "and are exempt; this bounds a human admin or an unauthenticated prober.",
        ("/api/admin", "/api/debug", "/api/company-news-ops", "/api/flow-gap-fill",
         "/api/flow-backup", "/api/watchdog", "/api/theme-engine"),
    ),
    "internal": Family(
        TIER_STANDARD,
        "Engine pushes and internal bridges. Their callers carry PUSH_SECRET and "
        "are exempt; the ceiling bounds anyone guessing at the secret.",
        ("/api/push", "/api/internal"),
    ),
    "docs": Family(
        TIER_STANDARD,
        "FastAPI's schema and docs pages, re-served behind OPEN_READS_GATE.",
        ("/openapi.json", "/docs", "/redoc"),
    ),
}

#: Never limited. Prefix (or, for the SPA catch-all, the exact template) -> why.
EXEMPT: dict[str, str] = {
    "/api/health": "Platform healthchecks and uptime monitors; they must answer "
                   "while the pod is under exactly the load a limit would react to.",
    "/api/ready": "Readiness probe; same reason as /api/health.",
    "/api/webhooks": "Stripe's webhook sender, from shared egress IPs with its own "
                     "retry schedule; a 429 costs a payment event.",
    "/api/desk/zoom-webhook": "Zoom's recording.completed sender; a 429 loses a "
                              "session publish.",
    "/api/discord/interactions": "Discord posts every member's slash command from "
                                 "its own IPs; a 429 is a failed command. The "
                                 "per-member /chart budget lives in the handler.",
    # ── app/dist only (see DIST_ONLY) ─────────────────────────────────────────
    "/assets": "Hashed static bundle from app/dist, edge-cacheable; a page load "
               "fetches dozens, and limiting them throttles page loads, not API use.",
    "/fonts": "Static fonts from app/dist; same reason as /assets.",
    "/manifest.json": "Static SPA shell file from app/dist; same reason as /assets.",
    "/sw.js": "The self-uninstalling legacy service-worker kill switch; static.",
    "/favicon.svg": "Static SPA shell file from app/dist; same reason as /assets.",
    "/vite.svg": "Static SPA shell file from app/dist; same reason as /assets.",
    "/og-image.png": "Static social-card image fetched by link unfurlers.",
    "/og-coming-soon.png": "Static social-card image fetched by link unfurlers.",
    "/robots.txt": "Static crawler file from app/dist.",
    "/sitemap.xml": "Static crawler file from app/dist.",
    "/pip-embed": "Static picture-in-picture embed page from app/dist.",
    "/q1-probe.html": "Static browser-probe page from app/dist.",
    SPA_CATCH_ALL: "The SPA shell (index.html) for every client-side route; a "
                   "page, not an API call.",
}

#: Registered by api/main.py ONLY `if os.path.exists(DIST)`. A bare checkout has
#: none of them, so their absence is excused unless the SPA catch-all is served
#: (read from the app itself, never the filesystem) -- auth_surface_check's
#: `requires_dist`, mirrored. The rail derives this set from main.py's AST.
DIST_ONLY = frozenset({
    "/assets", "/fonts", "/manifest.json", "/sw.js", "/favicon.svg", "/vite.svg",
    "/og-image.png", "/og-coming-soon.png", "/api/q1-probe-result",
    "/api/q1-probe-results", "/q1-probe.html", "/robots.txt", "/sitemap.xml",
    "/pip-embed", SPA_CATCH_ALL,
})


def build_index(families: dict[str, Family] | None = None,
                exempt: dict[str, str] | None = None) -> dict[str, tuple[str, str]]:
    """`{prefix: (kind, name)}`. A prefix declared twice is a ValueError -- two
    answers to "which limit applies here" is the defect a table exists to end."""
    families = FAMILIES if families is None else families
    exempt = EXEMPT if exempt is None else exempt
    index: dict[str, tuple[str, str]] = {}
    for name, fam in families.items():
        for p in fam.prefixes:
            if p in index:
                raise ValueError(f"rate_limit_policy: {p} declared twice")
            index[p] = (KIND_FAMILY, name)
    for p in exempt:
        if p in index:
            raise ValueError(f"rate_limit_policy: {p} is both a family and exempt")
        index[p] = (KIND_EXEMPT, "exempt")
    return index


_INDEX = build_index()


def _candidates(path: str):
    """The path itself, then each shorter segment-boundary prefix of it."""
    p = path.rstrip("/") or "/"
    yield p
    while True:
        cut = p.rfind("/")
        if cut <= 0:
            return
        p = p[:cut]
        yield p


def classify(path: str, index: dict | None = None) -> tuple[str, str, str] | None:
    """`(kind, name, matched_prefix)` for a route TEMPLATE or a CONCRETE path
    -- longest declared prefix wins -- or None when nothing is declared."""
    index = _INDEX if index is None else index
    for cand in _candidates(path or ""):
        hit = index.get(cand)
        if hit is not None:
            return hit[0], hit[1], cand
    return None


# ── the mode ─────────────────────────────────────────────────────────────────

_warned_modes: set[str] = set()


def mode() -> str:
    """Read PER REQUEST. Unset/blank/'off'/'0'/'false' -> off; 'shadow';
    'enforce'; anything else -> shadow (warned once)."""
    default, allowed = RATE_LIMIT_MODE_FLAGS[FLAG]
    raw = (os.environ.get(FLAG) or "").strip().lower()
    if raw in ("", "0", "false", "no", "none"):
        return default
    if raw in allowed:
        return raw
    if raw not in _warned_modes:
        _warned_modes.add(raw)
        logger.warning("[rate-limit-policy] %s=%r is not one of %s; treating it as "
                       "'shadow' (never blocks, never silent)", FLAG, raw, allowed)
    return MODE_SHADOW


# ── keys ─────────────────────────────────────────────────────────────────────

_SALT = secrets.token_bytes(16)
_MEMBER_TTL_S = 60.0
_MEMBER_MAX = 20_000
_member_cache: dict[str, tuple[float, str | None]] = {}


def ip_label(ip: str) -> str:
    """A salted hash of the client IP -- the only form an IP takes here."""
    return "ip:" + hashlib.sha256(_SALT + (ip or "unknown").encode("utf-8")).hexdigest()[:16]


def _member_id_blocking(token: str) -> str | None:
    from api.services.auth_service import validate_session   # lazy: tests patch it here
    user = validate_session(token)
    return str(user["id"]) if user and user.get("id") else None


async def _member_id(token: str) -> str | None:
    """The member behind a session token, cached per token for `_MEMBER_TTL_S`
    (a negative answer too, so a garbage cookie cannot drive a read per
    request). The read runs off the event loop."""
    h = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = time.monotonic()
    hit = _member_cache.get(h)
    if hit is not None and hit[0] > now:
        return hit[1]
    mid = await run_in_threadpool(_member_id_blocking, token)
    if len(_member_cache) >= _MEMBER_MAX:
        _member_cache.clear()
    _member_cache[h] = (now + _MEMBER_TTL_S, mid)
    return mid


async def principal_key(request: Request) -> str:
    """`member:<id>` for a valid session, else a hashed client IP."""
    token = request.cookies.get("uct_session")
    if token:
        mid = await _member_id(token)
        if mid:
            return "member:" + mid
    return ip_label(str(limiter._key_func(request)))


def _is_internal(request: Request) -> bool:
    """The one exemption: `Authorization: Bearer <PUSH_SECRET>`, compared by the
    SAME function the open-reads gate uses -- one authority, not two copies."""
    from api.open_reads_gate import _bearer_is_push_secret
    return _bearer_is_push_secret(request)


# ── counting + the once-per-(family, key, minute) log ────────────────────────

_lock = threading.Lock()
_COUNTS: Counter = Counter()                      # (mode, family) -> over-limit hits
_LAST_LOGGED: dict[tuple[str, str], int] = {}
_LOG_KEYS_MAX = 10_000
_STARTED_AT = time.time()

_parsed_cache: dict[str, object] = {}


def _item(limit: str):
    it = _parsed_cache.get(limit)
    if it is None:
        from limits import parse
        it = _parsed_cache[limit] = parse(limit)
    return it


def _record(m: str, family: str, prefix: str, method: str, key: str,
            limit: str, retry_after: int) -> None:
    minute = int(time.time() // 60)
    with _lock:
        _COUNTS[(m, family)] += 1
        total = _COUNTS[(m, family)]
        if _LAST_LOGGED.get((family, key)) == minute:
            return
        if len(_LAST_LOGGED) >= _LOG_KEYS_MAX:
            _LAST_LOGGED.clear()
        _LAST_LOGGED[(family, key)] = minute
    logger.warning(
        "[rate-limit-policy] %s mode=%s family=%s prefix=%s method=%s key=%s "
        "limit=%s retry_after=%d family_count=%d",
        "would-limit" if m == MODE_SHADOW else "limited",
        m, family, prefix, method, key, limit, retry_after, total,
    )


def _reset_state() -> None:
    """Tests only: forget counts, log throttles and cached member lookups."""
    with _lock:
        _COUNTS.clear()
        _LAST_LOGGED.clear()
    _member_cache.clear()


def status_snapshot() -> dict:
    with _lock:
        rows = [{"mode": m, "family": f, "count": n}
                for (m, f), n in sorted(_COUNTS.items())]
    return {
        "flag": FLAG,
        "mode": mode(),
        "since": _STARTED_AT,
        "families": {name: {"limit": f.limit, "prefixes": len(f.prefixes)}
                     for name, f in FAMILIES.items()},
        "exempt": sorted(EXEMPT),
        "over_limit": rows,
    }


# ── the decision ─────────────────────────────────────────────────────────────

async def evaluate(scope, m: str):
    """None to let the request through, else the 429 response to send. Never
    raises: an error while evaluating is logged and FAILS OPEN."""
    hit = classify(scope.get("path") or "")
    if hit is None or hit[0] != KIND_FAMILY or not limiter.enabled:
        return None
    _, family, prefix = hit
    try:
        request = Request(scope)
        if _is_internal(request):
            return None
        key = await principal_key(request)
        limit = FAMILIES[family].limit
        item = _item(limit)
        ns = SCOPE_PREFIX + family
        if limiter.limiter.hit(item, ns, key):
            return None
        reset = float(limiter.limiter.get_window_stats(item, ns, key).reset_time)
    except Exception as e:  # noqa: BLE001 -- a limiter must never take the site down
        logger.warning("[rate-limit-policy] evaluation failed open on %s: %s",
                       prefix, type(e).__name__)
        return None
    retry_after = max(1, math.ceil(reset - time.time()))
    _record(m, family, prefix, scope.get("method") or "", key, limit, retry_after)
    if m != MODE_ENFORCE:
        return None            # shadow (and an unknown mode) never blocks
    return JSONResponse(
        status_code=429,
        content={"detail": f"Too many requests. Retry after {retry_after} seconds.",
                 "family": family, "retry_after": retry_after},
        headers={"Retry-After": str(retry_after),
                 "X-RateLimit-Limit": str(item.amount),
                 "X-RateLimit-Remaining": "0",
                 "X-RateLimit-Reset": str(int(math.ceil(reset)))},
    )


class RateLimitPolicyMiddleware:
    """Pure ASGI. OFF (the default) costs one environment read per request and
    nothing else. Installed INSIDE CORS so a 429 still carries CORS headers."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            return await self.app(scope, receive, send)
        m = mode()
        if m == MODE_OFF:
            return await self.app(scope, receive, send)
        refusal = await evaluate(scope, m)
        if refusal is not None:
            return await refusal(scope, receive, send)
        return await self.app(scope, receive, send)


# ── the census ───────────────────────────────────────────────────────────────

def census(app) -> dict:
    """Every route of `app` classified, from `app.routes` -- never typed.

    Findings: `unclassified` (a route in no family and not exempt -- a new
    router nobody declared), `stale` (a declared prefix no route reaches), and
    `dist_only_undeclared`. A dist-only declaration is excused while the SPA
    catch-all is absent, and a flow-proxy prefix while no proxy forwarder is
    mounted -- both read off the app itself, so one missing route in a built,
    proxied app still fails."""
    from api import flow_proxy
    from api.auth_surface_check import _is_proxy_forwarder

    index = build_index()
    routes = 0
    by_family: Counter = Counter()
    exempt = 0
    matched: set[str] = set()
    unclassified: list[str] = []
    dist_served = proxy_served = False
    for route in getattr(app, "routes", []):
        path = getattr(route, "path", None)
        if not path:
            continue
        routes += 1
        dist_served = dist_served or path == SPA_CATCH_ALL
        proxy_served = proxy_served or _is_proxy_forwarder(route)
        hit = classify(path, index)
        if hit is None:
            unclassified.append(path)
            continue
        matched.add(hit[2])
        if hit[0] == KIND_EXEMPT:
            exempt += 1
        else:
            by_family[hit[1]] += 1
    excused: set[str] = set()
    if not dist_served:
        excused |= DIST_ONLY
    if not proxy_served:
        excused |= set(flow_proxy.PROXY_PREFIXES)
    stale = sorted(set(index) - matched - excused)
    dist_undeclared = sorted(p for p in DIST_ONLY if p not in index)
    return {
        "routes": routes,
        "by_family": dict(sorted(by_family.items())),
        "exempt": exempt,
        "unclassified": sorted(set(unclassified)),
        "stale": stale,
        "dist_only_undeclared": dist_undeclared,
        "dist_served": dist_served,
        "proxy_served": proxy_served,
        "ok": not (unclassified or stale or dist_undeclared),
    }


# ── the admin status read ────────────────────────────────────────────────────

router = APIRouter()


@router.get(STATUS_PATH)
def rate_limit_policy_status(_admin: dict = Depends(require_admin)):
    """Mode, the family table, and over-limit counts since this process started."""
    return status_snapshot()
