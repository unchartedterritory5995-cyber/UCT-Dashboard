"""OPEN_READS_GATE — the staged gate over TERM-026's anonymous reads.

WHY THIS EXISTS
---------------
TERM-026's auditor (`api/auth_surface_check.py`) recorded 158 GET/HEAD routes
that answer an anonymous caller (`kind=open` in
`api/auth_surface_read_baseline.json`). The owner confirmed three of them on
production with a cookieless request (`/api/live/massive/recent`,
`/openapi.json`, `/api/fundamentals/NVDA` -> 200). The ruling is ONE paid tier;
no free tier beyond the single already-free page. So paid market/member data
answering an anonymous caller is a leak.

WHAT IT IS
----------
ONE dependency, `open_reads_gate`, and ONE table, `GATED_READS`, which is the
single authority for which route template belongs to which family:

    paid   -> a paid member (the same predicate every `require_paid` uses:
              `is_paid_user` — admin OR paid plan OR in-trial)
    admin  -> an admin session (the same rule as `require_admin`)
    member -> any signed-in session (the same rule as `get_current_user`).
              ONLY for reads the one free page (`FREE_PAGES = ['/morning-wire']`)
              makes on every load — a free member must keep that page, and an
              anonymous caller has no page that needs them.

The dependency is attached where the routers are MOUNTED (`include_router(...,
dependencies=[Depends(open_reads_gate)])` in `api/main.py`) — including the two
partner-owned routers, whose files are not edited — and on flow_proxy's
forwarders, so the tape is gated on web BEFORE it is proxied to flow-worker.
A route of a mounted router that is NOT in the table passes straight through;
a non-GET/HEAD method passes straight through (mutating routes keep their own
gates and are audited separately).

THE FLAG — `OPEN_READS_GATE`, read PER REQUEST (no redeploy to change it)
------------------------------------------------------------------------
    unset / "off"  -> exactly today's behaviour. The dependency returns before
                      it reads a cookie or touches a database.
    "shadow"       -> the request proceeds unchanged; every would-deny is COUNTED
                      and LOGGED at most once per (route, minute).
    "enforce"      -> a would-deny is refused with the same status/body the
                      existing gates return: 401 "Not authenticated" (no
                      session), 402 (session, not paid), 403 "Admin access
                      required" (session, not admin).
    anything else  -> treated as "shadow" (a typo must never block a member,
                      and must never be silently OFF either), warned once.

The default is OFF so that DEPLOYING changes nothing for members. The owner
turns shadow on, reads the `[open-reads-gate] would-deny` lines, then enforces.

⛔ WHAT IS NEVER LOGGED: a token, a cookie value, an Authorization value, an IP,
a query string or a full referer. The log carries the route TEMPLATE, the
method, the family, the would-be status, a UA CLASS, the referer HOST and first
path segment, and two booleans (session cookie present, bearer present).

THE ONE BYPASS: `Authorization: Bearer <PUSH_SECRET>` (constant-time compare).
It is the credential every server-to-server caller in this app already holds
(engine pushes, ops curl endpoints, `_check_admin_auth`), so it widens access to
nobody who could not already do strictly more.
"""
from __future__ import annotations

import hmac
import logging
import os
import re
import threading
import time
from collections import Counter
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from api.middleware.auth_middleware import require_admin

logger = logging.getLogger(__name__)

FLAG = "OPEN_READS_GATE"
MODE_OFF = "off"
MODE_SHADOW = "shadow"
MODE_ENFORCE = "enforce"

# ⭐ Declared as a MODE table so `api/services/feature_flag_index.mode_flags()`
# derives the flag, its default and its vocabulary from THIS expression — the
# same literals the code falls back to (see `mode()`).
OPEN_READS_MODE_FLAGS = {
    "OPEN_READS_GATE": (MODE_OFF, (MODE_OFF, MODE_SHADOW, MODE_ENFORCE)),
}

PAID = "paid"
ADMIN = "admin"
MEMBER = "member"
FAMILIES = (PAID, ADMIN, MEMBER)

READ_METHODS = frozenset({"GET", "HEAD"})

#: The dependency's `__name__`, which is how the auditor recognises it.
GATE_NAME = "open_reads_gate"

# Status/body parity with the existing gates.
_DENY_NO_SESSION = (401, "Not authenticated")                 # get_current_user
_DENY_NOT_PAID = (402, "This data requires a paid plan")      # require_paid (402)
_DENY_NOT_ADMIN = (403, "Admin access required")              # require_admin


# ─────────────────────────────────────────────────────────────────────────────
# THE TABLE — the single authority. Route TEMPLATE (as FastAPI registers it)
# -> family. Every entry here must match a real route in `api.main:app`
# (railed by tests/test_open_reads_gate.py), and every entry LEAVES
# api/auth_surface_read_baseline.json — the auditor counts a route as gated only
# when this table classifies it AND the dependency is in its tree.
# ─────────────────────────────────────────────────────────────────────────────
GATED_READS: dict[str, str] = {}   # filled below, grouped by family


def _add(family: str, *paths: str) -> None:
    for p in paths:
        if p in GATED_READS:
            raise ValueError(f"open_reads_gate: {p} classified twice")
        GATED_READS[p] = family


def family_of(path: str) -> str | None:
    """The family a route TEMPLATE is classified into, or None."""
    return GATED_READS.get(path)


# ── concrete-path classification, for catch-all forwarders (flow_proxy) ──────

_PARAM = re.compile(r"\{([^}:]+)(?::([^}]+))?\}")


def _template_regex(template: str) -> re.Pattern:
    out, pos = [], 0
    for m in _PARAM.finditer(template):
        out.append(re.escape(template[pos:m.start()]))
        out.append(".+" if m.group(2) == "path" else "[^/]+")
        pos = m.end()
    out.append(re.escape(template[pos:]))
    return re.compile("^" + "".join(out) + "$")


_COMPILED: list[tuple[re.Pattern, str, str]] | None = None
_COMPILED_LOCK = threading.Lock()


def classify_concrete(path: str) -> tuple[str, str] | None:
    """(template, family) for a CONCRETE request path, or None. Exact templates
    win over parameterised ones, so `/api/live/massive/status` never matches a
    `{x}` template by accident."""
    global _COMPILED
    fam = GATED_READS.get(path)
    if fam:
        return path, fam
    if _COMPILED is None:
        with _COMPILED_LOCK:
            if _COMPILED is None:
                _COMPILED = [(_template_regex(t), t, f) for t, f in GATED_READS.items()
                             if "{" in t]
    for rx, tmpl, f in _COMPILED:
        if rx.match(path):
            return tmpl, f
    return None


def _is_flow_proxy_forwarder(route) -> bool:
    ep = getattr(route, "endpoint", None)
    return (getattr(ep, "__name__", "") == "_proxy"
            and getattr(ep, "__module__", "") == "api.flow_proxy")


def classify_request(request: Request) -> tuple[str, str] | None:
    """(template, family) for the request, or None when it is not gated.

    The matched route's own template is the key. Only flow_proxy's catch-all
    forwarders fall back to classifying the CONCRETE path, because their
    template (`/api/live/massive/{path:path}`) names a prefix, not a route."""
    route = request.scope.get("route")
    tmpl = getattr(route, "path", None)
    if tmpl and tmpl in GATED_READS:
        return tmpl, GATED_READS[tmpl]
    if route is not None and _is_flow_proxy_forwarder(route):
        return classify_concrete(request.url.path)
    return None


# ── the mode ─────────────────────────────────────────────────────────────────

_warned_modes: set[str] = set()


def mode() -> str:
    """Read PER REQUEST. Unset/blank/'off'/'0'/'false' -> off; 'shadow';
    'enforce'; anything else -> shadow (warned once)."""
    default, allowed = OPEN_READS_MODE_FLAGS[FLAG]
    raw = (os.environ.get(FLAG) or "").strip().lower()
    if raw in ("", "0", "false", "no", "none"):
        return default
    if raw in allowed:
        return raw
    if raw not in _warned_modes:
        _warned_modes.add(raw)
        logger.warning("[open-reads-gate] %s=%r is not one of %s; treating it as "
                       "'shadow' (never blocks, never silent)", FLAG, raw, allowed)
    return MODE_SHADOW


# ── the decision ─────────────────────────────────────────────────────────────

def _bearer_is_push_secret(request: Request) -> bool:
    secret = (os.environ.get("PUSH_SECRET") or "").strip()
    if not secret:
        return False
    auth = request.headers.get("authorization") or ""
    return hmac.compare_digest(auth.encode(), f"Bearer {secret}".encode())


def decide(request: Request, family: str) -> tuple[int, str] | None:
    """None to allow, else (status, detail). Blocking (reads auth.db) — call it
    off the event loop."""
    if _bearer_is_push_secret(request):
        return None
    from api.services.auth_service import validate_session
    user = validate_session(request.cookies.get("uct_session"))
    if not user:
        return _DENY_NO_SESSION
    if family == MEMBER:
        return None
    if family == ADMIN:
        return None if user.get("role") == "admin" else _DENY_NOT_ADMIN
    from api.middleware.auth_middleware import is_paid_user
    from api.services.auth_service import get_user_plan
    user = dict(user)
    user["plan"] = get_user_plan(user["id"])
    return None if is_paid_user(user) else _DENY_NOT_PAID


# ── counting + the once-per-(route, minute) log ──────────────────────────────

_lock = threading.Lock()
_COUNTS: Counter = Counter()           # (mode, template, family, status) -> n
_LAST_LOGGED_MINUTE: dict[tuple[str, str], int] = {}
_STARTED_AT = time.time()

_UA_CLASSES = (
    ("discord", re.compile(r"discordbot", re.I)),
    ("headless", re.compile(r"headlesschrome|puppeteer|playwright|phantomjs", re.I)),
    ("bot", re.compile(r"bot\b|crawler|spider|slurp|facebookexternalhit|preview|monitor|uptime", re.I)),
    ("python", re.compile(r"python|httpx|aiohttp|urllib", re.I)),
    ("curl", re.compile(r"^curl/|^wget/", re.I)),
    ("node", re.compile(r"node-fetch|undici|axios|^node", re.I)),
    ("browser", re.compile(r"mozilla/", re.I)),
)


def ua_class(ua: str | None) -> str:
    if not ua:
        return "none"
    for name, rx in _UA_CLASSES:
        if rx.search(ua):
            return name
    return "other"


def referer_summary(referer: str | None) -> str:
    """HOST plus the FIRST path segment only. Never the query, never deeper
    segments: share links carry a secret in the path (`/s/<token>`), and a
    render URL carries its token in the query."""
    if not referer:
        return "-"
    try:
        parts = urlsplit(referer)
    except ValueError:
        return "unparseable"
    host = (parts.hostname or "-")[:80]
    seg = (parts.path or "/").split("/")
    first = ("/" + seg[1]) if len(seg) > 1 and seg[1] else "/"
    return f"{host}{first[:40]}"


def _record(request: Request, m: str, template: str, family: str,
            denial: tuple[int, str]) -> None:
    status = denial[0]
    minute = int(time.time() // 60)
    key = (template, request.method)
    with _lock:
        _COUNTS[(m, template, family, status)] += 1
        total = _COUNTS[(m, template, family, status)]
        if _LAST_LOGGED_MINUTE.get(key) == minute:
            return
        _LAST_LOGGED_MINUTE[key] = minute
    logger.warning(
        "[open-reads-gate] %s mode=%s route=%s method=%s family=%s status=%d "
        "ua=%s referer=%s session_cookie=%s bearer=%s count=%d",
        "would-deny" if m == MODE_SHADOW else "denied",
        m, template, request.method, family, status,
        ua_class(request.headers.get("user-agent")),
        referer_summary(request.headers.get("referer")),
        "present" if request.cookies.get("uct_session") else "absent",
        "present" if request.headers.get("authorization") else "absent",
        total,
    )


def status_snapshot() -> dict:
    with _lock:
        rows = [{"mode": m, "route": t, "family": f, "status": s, "count": n}
                for (m, t, f, s), n in sorted(_COUNTS.items())]
    return {"flag": FLAG, "mode": mode(), "since": _STARTED_AT,
            "gated_routes": len(GATED_READS),
            "by_family": dict(Counter(GATED_READS.values())),
            "denials": rows}


# ── THE dependency ───────────────────────────────────────────────────────────

async def open_reads_gate(request: Request) -> None:
    """The staged gate. `async` on purpose: in OFF mode (the default) it
    returns on the event loop without a threadpool hop, so attaching it to a
    whole router costs a dict lookup per request and nothing else."""
    if request.method not in READ_METHODS:
        return
    m = mode()
    if m == MODE_OFF:
        return
    hit = classify_request(request)
    if hit is None:
        return
    template, family = hit
    if m == MODE_SHADOW:
        try:
            denial = await run_in_threadpool(decide, request, family)
            if denial is not None:
                _record(request, m, template, family, denial)
        except Exception as e:  # noqa: BLE001 — shadow must never break a request
            logger.warning("[open-reads-gate] shadow evaluation failed on %s: %s",
                           template, type(e).__name__)
        return
    # enforce
    try:
        denial = await run_in_threadpool(decide, request, family)
    except Exception as e:  # noqa: BLE001 — fail CLOSED, never open
        logger.warning("[open-reads-gate] auth check failed on %s: %s",
                       template, type(e).__name__)
        raise HTTPException(status_code=503, detail="Auth check unavailable")
    if denial is None:
        # ⛔ a gated answer must never be stored by a SHARED cache (Cloudflare
        # caches .csv/.png by extension) and replayed to an anonymous caller.
        request.scope.setdefault("state", {})["open_reads_private"] = True
        return
    _record(request, m, template, family, denial)
    raise HTTPException(status_code=denial[0], detail=denial[1])


class PrivateCacheForGatedReads:
    """Pure-ASGI (never BaseHTTPMiddleware — it buffers, and the tape is SSE).

    Only when the gate ENFORCED and ALLOWED a request does it rewrite the
    response's Cache-Control to `private` (keeping any max-age), so an edge
    cache cannot replay a member's answer to an anonymous caller. In off and
    shadow mode the flag is never set and this passes every byte through."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            return await self.app(scope, receive, send)

        async def _send(message):
            if (message.get("type") == "http.response.start"
                    and (scope.get("state") or {}).get("open_reads_private")):
                headers = [(k, v) for k, v in message.get("headers", [])
                           if k.lower() != b"cache-control"]
                old = next((v for k, v in message.get("headers", [])
                            if k.lower() == b"cache-control"), b"")
                keep = [d.strip() for d in old.decode("latin-1").split(",")
                        if d.strip() and d.strip().lower() not in ("public", "private")]
                headers.append((b"cache-control",
                                ", ".join(["private"] + keep).encode("latin-1")))
                message = dict(message, headers=headers)
            await send(message)

        return await self.app(scope, receive, _send)


# ── /openapi.json, /docs, /redoc — the same pages, behind the same staging ───

DOCS_PATHS = ("/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc")


def install_docs(app) -> None:
    """Re-serve FastAPI's four built-in docs pages as ordinary routes carrying
    the gate. The app must be built with `openapi_url=None, docs_url=None,
    redoc_url=None`, which removes the built-ins (plain Starlette routes with no
    dependency tree, so they cannot carry a `Depends`).

    ⭐ Chosen over "disable in production" because it is the least surprising
    of the two: with the flag OFF the four pages answer byte-for-byte as before
    (same generator functions, same titles), so deploying changes nothing, and
    the owner's one switch moves them to admin-only along with everything else.
    `app.openapi()` itself is untouched — only the doors are."""
    from fastapi.openapi.docs import (get_redoc_html, get_swagger_ui_html,
                                      get_swagger_ui_oauth2_redirect_html)
    from fastapi.responses import JSONResponse

    deps = [Depends(open_reads_gate)]
    title = app.title

    async def openapi(req: Request):
        return JSONResponse(app.openapi())

    async def swagger_ui_html(req: Request):
        return get_swagger_ui_html(
            openapi_url="/openapi.json", title=f"{title} - Swagger UI",
            oauth2_redirect_url="/docs/oauth2-redirect",
            init_oauth=app.swagger_ui_init_oauth,
            swagger_ui_parameters=app.swagger_ui_parameters)

    async def swagger_ui_redirect(req: Request):
        return get_swagger_ui_oauth2_redirect_html()

    async def redoc_html(req: Request):
        return get_redoc_html(openapi_url="/openapi.json", title=f"{title} - ReDoc")

    for path, fn in zip(DOCS_PATHS, (openapi, swagger_ui_html, swagger_ui_redirect, redoc_html)):
        app.add_api_route(path, fn, methods=["GET", "HEAD"], include_in_schema=False,
                          dependencies=deps)


# ── the admin status read ────────────────────────────────────────────────────

router = APIRouter()


@router.get("/api/admin/open-reads-gate")
def open_reads_gate_status(_admin: dict = Depends(require_admin)):
    """Mode + per-route denial counts since this process started."""
    return status_snapshot()


# ═════════════════════════════════════════════════════════════════════════════
# THE CLASSIFICATION (TERM-026 follow-up, 2026-09-27). Derived route by route
# from the handler code and from which pages call each endpoint; the reason for
# every route that is NOT here is written in the baseline file.
# ═════════════════════════════════════════════════════════════════════════════

# ── (a) PAID: market / vendor / member data. Every one of these is read by a
#    page inside `AuthGuard` that is NOT the free page, or by nothing at all.
_add(PAID,
     # earnings + news (api/routers/earnings.py, news.py) — the only frontend
     # callers of /api/earnings and /api/earnings-gaps are in CatalystFlow.jsx,
     # which nothing imports; /api/news's one live caller is MyStocksHub (paid).
     "/api/earnings", "/api/earnings-gaps", "/api/earnings/intel/{ticker}",
     "/api/earnings-analysis/{sym}", "/api/news",
     # a yfinance-rendered PNG per ticker; FuturesStrip builds the URL and
     # TickerPopup never fetches it — no live caller, a provider call per hit.
     "/api/chart/{ticker}",
     # Flow Record — the page (/flow-scoreboard) is inside AuthGuard. The
     # handler's docstring calls it "public by design (a trust asset)"; no
     # anonymous page reads it, so that intent is recorded, not honoured, here.
     "/api/flow-scoreboard", "/api/flow-scoreboard/",
     # Schwab/options (PARTNER router, gated at its include site only)
     "/api/schwab/options-quote", "/api/schwab/market-summary",
     "/api/schwab/contract-history", "/api/schwab/chart-bounds",
     "/api/schwab/chart-ohlc", "/api/schwab/ytd-performance",
     "/api/schwab/oi-change-batch", "/api/schwab/mktcap-batch",
     # the paid Calendar page (useCalendarData / CalendarWidget / useWire*)
     "/api/calendar/ipos", "/api/calendar/reactions", "/api/calendar/day-metrics",
     "/api/calendar/day-metrics-batch", "/api/calendar/enrichment",
     "/api/calendar/implied-moves", "/api/calendar/enrichment-batch",
     "/api/calendar/most-anticipated.png", "/api/calendar/week-earnings.png",
     "/api/calendar/week-econ.png", "/api/calendar/wire",
     "/api/calendar/wire-coverage",
     # charts workspace + transcripts (LLM-summarised, a Claude call per miss)
     "/api/compare/groups", "/api/compare/group-members",
     "/api/transcripts/{symbol}",
     # the options-flow family
     "/api/gex/compare", "/api/oi-snapshot/lookup", "/api/oi-snapshot/history",
     "/api/live/alerts/recent", "/api/live/alerts/history",
     # Live Flow (PARTNER router + the SSE router). auto-push-config,
     # dormant-status and worker-history are PAID, not admin: LiveFlowMassive
     # (a member page) reads all three.
     "/api/live/massive/curated", "/api/live/massive/recent",
     "/api/live/massive/day-stats", "/api/live/massive/cream",
     "/api/live/massive/ticker-flow", "/api/live/massive/by-contract",
     "/api/live/massive/pushed", "/api/live/massive/auto-push-config",
     "/api/live/massive/dormant-status", "/api/live/massive/worker-history",
     "/api/live/massive/stream", "/api/live/massive/curated-stream",
     # data provenance (ProvenanceDemo — signed-in, not the free page)
     "/api/provenance/bar",
     # fundamentals / filings / research. ⚠️ /research/* is reachable by a free
     # member (AuthGuard.jsx:153) and its hooks FIRE before the paywall check,
     # but the page renders PaywallTeaser rather than this data — the teaser is
     # the paywall, so the data behind it is paid.
     "/api/fundamentals/{ticker}", "/api/fundamentals-full/{ticker}",
     "/api/fundamentals-statements/{ticker}", "/api/earnings-intel/{ticker}",
     "/api/filings/{ticker}", "/api/filings/{ticker}/primary",
     "/api/research/news/{sym}", "/api/research/company-news/{sym}",
     "/api/research/quote/{sym}", "/api/research/financial-history/{sym}",
     "/api/research/financials/{sym}", "/api/research/estimates/{sym}",
     "/api/research/analyst-ratings/{sym}", "/api/research/ownership/{sym}",
     "/api/research/ratings/{sym}", "/api/research/compare/{sym}/{comparator}",
     "/api/earnings/audio/{ticker}",
     # Options Flow's ETF/index classification + the two raw flow CSVs (their
     # only frontend reader is OptionsFlow_admin.jsx, which has no route).
     "/api/ticker-types/etf-index-symbols",
     "/Darkpool-data.csv", "/Indexes-data.csv",
     )

# ── (b) ADMIN: ops / status / diagnostic reads. No member page reads any of
#    them (the admin-only DataPipelineHealthPanel reads several, with an admin
#    session). Internal pollers carry the PUSH_SECRET bearer.
_add(ADMIN,
     "/api/admin/reconciliation-status", "/api/admin/bars-stream-status",
     "/api/admin/warm-universe-status", "/api/admin/calendar-date-integrity",
     "/api/admin/calendar-coverage-status", "/api/admin/calendar-enrichment-status",
     "/api/admin/implied-sweep-status", "/api/admin/provider-coverage",
     "/api/admin/fmp-adapter-status", "/api/admin/massive-adapter-status",
     "/api/admin/yfinance-guard", "/api/admin/fundamentals-health",
     "/api/admin/call-recap-status", "/api/admin/transcript-index-status",
     "/api/breadth-monitor/ohlc/status", "/api/breadth-monitor/universe",
     "/api/breadth-monitor/pit/calibrate-result", "/api/breadth-monitor/pit/validate-result",
     "/api/breadth-monitor/wicks/validate-result",
     "/api/breadth-monitor/history/sweep-status",
     "/api/breadth-monitor/history/recompute-deep-result",
     "/api/breadth-monitor/history/adv-dec-coverage",
     "/api/market-indicators/status", "/api/calendar/wire-status",
     "/api/j2/admin/excursion-status", "/api/stream/status",
     "/api/dealer-positioning/status", "/api/dealer-positioning/sample",
     "/api/dealer-positioning/flow-sources",
     "/api/flow/etf-replica-status", "/api/flow/aggregate-health",
     "/api/flow-gap-fill/status", "/api/flow-backup/status", "/api/watchdog/status",
     "/api/oi-snapshot/run-status", "/api/oi-snapshot/status",
     "/api/oi-snapshot/test-massive/{ticker}",      # a live Massive probe per hit
     "/api/notable-flow/settings", "/api/notable-flow/dedupe",
     "/api/live/user-blocklist", "/api/liveflow/consumer-state",
     "/api/live/massive/status", "/api/live/massive/diagnostic",
     "/api/live/massive/contract-debug", "/api/live/massive/nbbo-histogram",
     "/api/live/massive/side-diagnostic", "/api/live/massive/side-method-stats",
     "/api/live/massive/spot-check", "/api/live/massive/q-pool-history",
     "/api/live/massive/restart-log", "/api/live/massive/curated-stream-status",
     "/api/live/massive/stream-status",
     "/api/darkpool/massive-ingest/status", "/api/darkpool/flatfile-ingest/status",
     "/api/darkpool/intraday-ingest/status",
     "/api/research/ratings-percentile/status", "/api/logos/status",
     "/api/schwab/status", "/api/schwab/earnings-test",
     "/api/debug/earnings-sources/{sym}",           # probes FMP/AV/Finnhub per hit
     "/api/massive/status", "/api/massive/flatfiles/status",
     "/api/ticker-types/replica-push-status", "/api/ticker-types/generation",
     # (d) WRITE-SHAPED GETs — gated admin, never member-facing:
     "/api/schwab/backfill-contract",   # merges Polygon history INTO contract_history.json
     # FastAPI's own docs, re-served by install_docs() behind this gate
     *DOCS_PATHS,
     )

# ── MEMBER: what the free page loads for a free member on every visit.
#    Layout.jsx:77 -> lib/barsPackClient.js (every signed-in page, incl.
#    /morning-wire); NavBar.jsx:206 / MoreSheet.jsx:108 (the member's own
#    avatar). No anonymous page reads either.
_add(MEMBER,
     "/api/intradaypack/manifest", "/api/intradaypack/{date}/delta",
     "/api/intradaypack/{date}/{idx}",
     "/api/auth/avatar/{user_id}",
     )

#: The (d) write-shaped GETs, named so the report and the rail can find them.
WRITE_SHAPED_GETS = ("/api/schwab/backfill-contract",)

#: What the ONE free page (/morning-wire) and its TickerPopup read, derived
#: 2026-09-27 from MorningWire.jsx, Layout.jsx, NavBar.jsx, CatalystTable.jsx
#: and TickerPopup/ChartPane. A free member must keep every one of these; the
#: rail (tests/test_open_reads_gate.py) holds them out of PAID and ADMIN.
FREE_PAGE_READS = (
    "/api/rundown", "/api/wire-feedback/mine", "/api/quote-of-the-day",
    "/api/snapshot", "/api/tweets/feed", "/api/catalysts/today",
    "/api/catalysts/my-feedback", "/api/live-prices",
    "/api/intradaypack/manifest", "/api/intradaypack/{date}/delta",
    "/api/intradaypack/{date}/{idx}", "/api/auth/avatar/{user_id}",
    # TickerPopup / ChartPane / CommandPalette on the free page — these stay
    # anonymous as well (the Discord Activity and the /r/chart renderer read
    # them with no session), recorded as public/open in the baseline:
    "/api/ticker-search", "/api/ticker-meta/{ticker}", "/api/ticker-ipo/{ticker}",
    "/api/research/snapshot/{sym}", "/api/stream/prices",
    "/api/chart/markers/{ticker}",
)
