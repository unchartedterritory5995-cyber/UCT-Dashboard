"""chart-renderer: a tiny headless-Chromium screenshot service (Railway).

POST /render  {url, selector?, width?, height?, scale?, settle_ms?, ready_js?, probe_js?}
  → image/png of `selector` (default "#chart-export") on `url`, plus
    X-Chart-Ready (did `ready_js` ever pass?) and X-Chart-Probe (the JSON value
    of `probe_js`, read from the page at capture time).

⭐ The two report headers exist because a screenshot cannot be judged from its
pixels alone. This service used to swallow the readiness timeout — "a timeout is
not a verdict; the caller judges the image" — and the caller judged it by the
grey-level variance of the chart body. On 2026-08-31 that judgement passed three
charts with NO CANDLES IN THEM to a public channel: once /r/chart resolves a
symbol it paints a large centred watermark, a subtitle, grid lines and a stats
strip, which is 8-17 std-dev of ink with no data in it. Ink is not data. So the
page now STAMPS what it drew and this service carries that answer back, instead
of discarding the one fact it had. See `discord_chart_house.render_house_chart`.

Exists because the house chart image is a screenshot of the dashboard's own
/r/chart page (the same thing the Sunday Scans / Substack renderers do from
the owner's PC) and the `web` service has no browser. Only hosts in
RENDER_ALLOWED_HOSTS may be rendered; every call needs X-Render-Secret.
Listens on :: so Railway's IPv6-only private network can reach it.

Step 2.3 of docs/discord-render/03-architecture.md (§3.7), in two tiers.

UNCONDITIONAL — none of these changes a render that keeps to its own budgets:
  * log hygiene (C-13): no query string is ever logged or returned. Playwright's error
    text carries its call log, and the call log printed the navigation URL — render token
    included — 142 times in 14 days; `render failed: …` put the same text in the 502 body,
    which web then logged too;
  * a hard ceiling around the whole render (504 with a reason): by default the sum of the
    budgets the request itself declares, so only a hang is cut. RENDER_HARD_TIMEOUT_S lowers it;
  * `X-Correlation-Id` read and printed on one render log line (the path, never the query);
  * /health reports `ready` and counters.

BEHIND RENDER_POOL_ENABLED (default off): Chromium launched and warmed at boot before
`ready`, a pre-created fresh context per viewport, a browser recycle after
RENDER_RECYCLE_AFTER renders or RENDER_RSS_CEILING_MB, and `X-Render-Priority: background`
capped at RENDER_BACKGROUND_SLOTS of RENDER_MAX_CONCURRENT so the warm cycle yields to members.

BEHIND RENDER_ADMIN_ENDPOINTS=1 (default off, and 404 — not 403 — when off, so the route is
indistinguishable from one that was never written): POST /admin/pool/recycle, bearer-gated on
RENDER_ADMIN_TOKEN, recycles EXACTLY ONE pooled page so determinism-across-recycle and the
self-heal chaos row have a real trigger with zero member impact. Owner ruling B1, 2026-09-14.
Both recycle paths are documented in docs/runbooks/discord-render-operations.md §9e.
"""
from __future__ import annotations

import asyncio
import contextvars
import hmac
import itertools
import json
import logging
import math
import os
import re
import time
import traceback
from collections import deque
from urllib.parse import urlparse

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

# ⚠️ FLAT IMPORT, AND THE DOCKERFILE MUST COPY IT. The image has WORKDIR /app and
# starts `uvicorn app:app`, so siblings are top-level modules — and it copies
# files INDIVIDUALLY, so a new module that is not added to the Dockerfile is an
# ImportError on boot, not a missing feature.
from edge_scope import EDGE_TOKEN_HEADER, edge_token_targets

log = logging.getLogger("chart-renderer")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

SECRET = os.environ.get("CHART_RENDERER_SECRET", "")
ALLOWED_HOSTS = {h.strip().lower() for h in os.environ.get(
    "RENDER_ALLOWED_HOSTS", "uctintelligence.com,web-production-05cb6.up.railway.app").split(",") if h.strip()}
MAX_CONCURRENT = int(os.environ.get("RENDER_MAX_CONCURRENT", "2"))
DEFAULT_READY_JS = (
    "() => { const e = document.querySelector(SEL); if (!e) return false;"
    " const cs = [...e.querySelectorAll('canvas')];"
    " return cs.some(c => c.width > 200 && c.height > 100); }"
)
HARD_MARGIN_S = 10.0

_OFF = ("0", "false", "off", "no", "")
_CID = re.compile(r"^[0-9a-f]{8}$")


def safe_cid(raw: str | None) -> str:
    """A correlation id is echoed into logs, so it is validated before it is echoed — ONE copy.

    ⛔⛔ THERE WAS BRIEFLY A SECOND COPY AND THE ANCHOR CHECK IS WHAT FOUND IT. B1's admin lever
    repeated this line verbatim, which made `mutation_harness_renderer.py :: A4` match two places:
    an exact single replacement became impossible, so that control could no longer be applied at
    all and would have reported NOT APPLIED at the end of an 18-minute run.

    ⭐ A GUARD REPEATED IS A GUARD UNPROVED. The fix is one definition, not a longer anchor —
    lengthening the anchor would have restored the mutation while leaving two copies of a
    log-injection guard that can drift apart silently."""
    return raw if _CID.match(raw or "") else "-"


_URL_QUERY = re.compile(r"((?:https?|wss?)://[^\s\"'?#<>\\]+)\?[^\s\"'#<>\\]*")
# ⛔ THE PREFIX HALF MATTERS: `\b(secret)=` does NOT match `CHART_RENDERER_SECRET=`, because the
# character before SECRET is `_`, which is a word character, so there is no boundary there. An
# env-var-shaped name therefore slipped through. No call site in this file formats `os.environ` into
# text today, so this is DEFENCE IN DEPTH rather than a reported leak — but the shape is one line
# away (a config error, a startup dump) and the cost of covering it now is this comment.
# ⚠️ Each underscore-separated segment is required, so `CHART_RENDERER_SECRET=` matches while
# `monkey=` still does not — over-redaction is safe but it teaches people to distrust the output.
_SECRET_PARAM = re.compile(
    r"(?:^|[^A-Za-z0-9_])((?:[A-Za-z0-9]+_)*(?:token|secret|key|sig|signature))=[^&\s\"'<>\\]+",
    re.IGNORECASE)
#: HEADER and DICT shapes: `X-Render-Token: v`, `'x-chart-edge-token': 'v'`, `"authorization": "v"`.
#: ⛔ The name may be hyphenated OR underscored and may be quoted; the separator is `:` with optional
#: quoting and whitespace either side. Group 1 is the name as written, group 2 the separator plus any
#: opening quote, so the redacted output stays readable as the same shape it replaced.
_SECRET_HEADER = re.compile(
    r"([\"']?[A-Za-z0-9][A-Za-z0-9_-]*(?:token|secret|key|sig|signature|authorization)[\"']?)"
    r"(\s*:\s*[\"']?)[^\s\"',}{)\]]+",
    re.IGNORECASE)

app = FastAPI(title="chart-renderer")
_pw = None
_browser = None                 # the legacy (pool off) shared browser
_current = None                 # pool on: the _BrowserSlot new renders go to
_slots: asyncio.Semaphore | None = None
_bg_slots: asyncio.Semaphore | None = None
_launch_lock: asyncio.Lock | None = None
_launch_error: str | None = None
_warm_done = False
_priority: contextvars.ContextVar[str] = contextvars.ContextVar("render_priority", default="interactive")

# ⭐ A CONTEXTVAR, DELIBERATELY — the same mechanism `_priority` uses, and for a
# stronger reason. The chart-edge capability must reach `_drive` WITHOUT becoming
# a field on `RenderRequest`: that model is echoed in error paths and `scrub()`ed
# log lines, and a credential that lives in a request body is a credential that
# eventually gets logged. This one never leaves memory.
_edge_token: contextvars.ContextVar[str] = contextvars.ContextVar("chart_edge_token", default="")


def _env_int(name: str, default: int, lo: int, hi: int) -> int:
    try:
        v = int(os.environ.get(name, ""))
        return v if lo <= v <= hi else default
    except (TypeError, ValueError):
        return default


def _env_float(name: str, default: float, lo: float, hi: float) -> float:
    try:
        v = float(os.environ.get(name, ""))
        return v if lo <= v <= hi else default
    except (TypeError, ValueError):
        return default


def pool_enabled() -> bool:
    return os.environ.get("RENDER_POOL_ENABLED", "0").strip().lower() not in _OFF


def admin_endpoints_enabled() -> bool:
    """⭐ An ENABLEMENT gate, so unset means OFF: /admin/pool/recycle ADDS a lever and must not
    switch itself on in every environment the moment it merges. Read PER REQUEST so the operator
    can arm it with a variable; strictly "1" so a typo fails closed."""
    return os.environ.get("RENDER_ADMIN_ENDPOINTS", "").strip() == "1"


def admin_token() -> str:
    """Read per request, for the same reason. Deliberately NOT CHART_RENDERER_SECRET: that one is
    handed to `web` on every render, and an operator lever must not be reachable with a credential
    the render path already carries."""
    return os.environ.get("RENDER_ADMIN_TOKEN", "").strip()


def scrub(text) -> str:
    """Every query string, any token=/secret=/key= pair, and any header- or dict-shaped credential,
    removed from text bound for a log line or a response body. Applied to exception text, which is
    where the URL hides.

    ⛔ THE THIRD SUBSTITUTION IS NEW AND IT COVERS THE SHAPE THE TOKEN ACTUALLY TRAVELS IN. The
    render token and the chart-edge token are **headers**, not query params, and this function only
    knew `name=value`. `X-Render-Token: <token>` and a Playwright request-header dict
    (`{'x-chart-edge-token': '<token>'}`) both survived it untouched. Not proven reachable — the
    header-attaching route swallows its own exception (`:338`) — but the token's own transport is
    the least defensible thing to leave uncovered, and `page.route` hands Playwright a dict it is
    free to quote in any future error string."""
    s = _URL_QUERY.sub(lambda m: m.group(1) + "?[redacted]", str(text))
    s = _SECRET_PARAM.sub(lambda m: m.group(1) + "=[redacted]", s)
    return _SECRET_HEADER.sub(lambda m: m.group(1) + m.group(2) + "[redacted]", s)


def url_path(url: str) -> str:
    try:
        return urlparse(url).path or "/"
    except Exception:  # noqa: BLE001
        return "?"


class _Stats:
    def __init__(self):
        self.renders_total = 0          # successful renders
        self.failures = 0
        self.timeouts = 0
        self.active = 0
        self.queued = 0
        self.recycles = 0           # BROWSER recycles — the organic RSS / RENDER_RECYCLE_AFTER path
        self.page_recycles = 0      # POOLED-PAGE recycles — POST /admin/pool/recycle, one page each
        self.pool_hits = 0
        self.pool_misses = 0
        self.last_render_ms: float | None = None
        self._recent: deque = deque(maxlen=200)

    def record(self, ms: float) -> None:
        self.renders_total += 1
        self.last_render_ms = round(ms, 1)
        self._recent.append(ms)

    def p95(self) -> float | None:
        xs = sorted(self._recent)
        if not xs:
            return None
        return round(xs[max(0, math.ceil(0.95 * len(xs)) - 1)], 1)


_stats = _Stats()


class RenderRequest(BaseModel):
    url: str
    selector: str = "#chart-export"
    width: int = Field(1336, ge=200, le=4000)
    height: int = Field(710, ge=200, le=4000)
    scale: float = Field(2.0, ge=1.0, le=4.0)
    settle_ms: int = Field(1600, ge=0, le=10000)
    ready_timeout_ms: int = Field(34000, ge=1000, le=60000)
    ready_js: str | None = None
    # Read from the page AFTER the capture and returned in X-Chart-Probe. The
    # caller uses it to ask the page a question the pixels cannot answer -
    # "how many bars did you actually draw?". Optional: an older caller that
    # sends none simply gets no header.
    probe_js: str | None = None


def hard_timeout_s(req: RenderRequest) -> float:
    """The whole-render ceiling. By default it is the sum of what the request already allows —
    navigation (ready + 6 s, the page's default timeout), readiness, settle — plus 10 s for the
    screenshot and probe, so a render that keeps to its own timeouts is never cut; only a hang
    is. RENDER_HARD_TIMEOUT_S lowers it (03 §3.7 proposes 20 s, which would 504 renders web
    currently budgets 25 s of readiness for — OI-18)."""
    implied = (2 * req.ready_timeout_ms + 6000 + req.settle_ms) / 1000.0 + HARD_MARGIN_S
    cap = _env_float("RENDER_HARD_TIMEOUT_S", 0.0, 0.0, 3600.0)
    return min(implied, cap) if cap > 0 else implied


def check_url(url: str) -> None:
    """Refuse anything but https URLs on the allowlisted hosts."""
    try:
        u = urlparse(url)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"bad url: {scrub(e)}")
    if u.scheme != "https" or not u.hostname:
        raise HTTPException(400, "url must be https")
    if u.hostname.lower() not in ALLOWED_HOSTS:
        raise HTTPException(400, f"host not allowed: {u.hostname}")


def check_secret(given: str | None) -> None:
    if not SECRET:
        raise HTTPException(503, "renderer not configured")
    if not given or given != SECRET:
        raise HTTPException(401, "bad secret")


def _rss_mb() -> float | None:
    """Resident memory of every process in the container (Chromium runs as children), or None
    where /proc does not exist."""
    total, seen = 0, False
    try:
        pids = [d for d in os.listdir("/proc") if d.isdigit()]
    except OSError:
        return None
    for pid in pids:
        try:
            with open(f"/proc/{pid}/status", encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    if line.startswith("VmRSS:"):
                        total += int(line.split()[1])
                        seen = True
                        break
        except (OSError, ValueError, IndexError):
            continue
    return round(total / 1024.0, 1) if seen else None


def _locks() -> None:
    global _slots, _bg_slots, _launch_lock
    if _slots is None:
        _slots = asyncio.Semaphore(MAX_CONCURRENT)
        _bg_slots = asyncio.Semaphore(max(1, min(MAX_CONCURRENT, _env_int("RENDER_BACKGROUND_SLOTS", 2, 1, 64))))
        _launch_lock = asyncio.Lock()


async def _launch_browser():
    """Start Playwright once and launch one Chromium. Tests replace this."""
    global _pw
    from playwright.async_api import async_playwright
    if _pw is None:
        _pw = await async_playwright().start()
    return await _pw.chromium.launch(args=["--disable-dev-shm-usage", "--no-sandbox"])


async def _close_quiet(thing) -> None:
    try:
        await thing.close()
    except Exception:  # noqa: BLE001
        pass


async def _get_browser():
    global _browser, _launch_error
    _locks()
    if _browser is None or not _browser.is_connected():
        async with _launch_lock:
            if _browser is None or not _browser.is_connected():
                try:
                    _browser = await _launch_browser()
                except Exception as e:  # noqa: BLE001
                    _launch_error = type(e).__name__
                    raise
                _launch_error = None
                log.info("chromium launched")
    return _browser


async def _drive(ctx, req: RenderRequest, meta: dict) -> bytes:
    """One render on a fresh context: load, wait for readiness, settle, capture, probe."""
    ready_js = (req.ready_js or DEFAULT_READY_JS).replace("SEL", repr(req.selector))
    page = await ctx.new_page()
    page.set_default_timeout(req.ready_timeout_ms + 6000)

    # ── the chart-edge render capability ────────────────────────────────────
    # ⛔ PER-REQUEST ROUTING, NOT `set_extra_http_headers`. That would attach the
    # credential to EVERY request this page makes — fonts, images, analytics, any
    # third-party origin the page ever gains. The predicate below is the only
    # thing that decides, and it says: same origin as the page, path under
    # `/api/bars/`. Nothing else ever sees it.
    _tok = _edge_token.get()
    if _tok:
        async def _attach_edge_token(route):
            try:
                await route.continue_(headers={**route.request.headers,
                                               EDGE_TOKEN_HEADER: _tok})
            except Exception:  # noqa: BLE001 — a render must never die for this
                await route.continue_()
        await page.route(lambda u: edge_token_targets(u, req.url), _attach_edge_token)

    await page.goto(req.url, wait_until="load")
    try:
        await page.wait_for_function(ready_js, timeout=req.ready_timeout_ms)
        meta["ready"] = True
    except Exception:  # noqa: BLE001 — not fatal, but no longer silent: it rides back in X-Chart-Ready
        log.warning("ready predicate timed out for %s", url_path(req.url))
    await page.wait_for_timeout(req.settle_ms)
    el = page.locator(req.selector)
    if await el.count() == 0:
        raise HTTPException(422, f"selector not found: {req.selector}")
    png = await el.first.screenshot(type="png")
    if req.probe_js:
        # After the shot, so it reports the frame we took. A page that
        # never defined the value yields None, which the caller reads as
        # "unknown" and not as "empty" — an older page must not start
        # failing renders the moment this service ships.
        try:
            meta["probe"] = await page.evaluate(req.probe_js)
        except Exception as e:  # noqa: BLE001
            log.warning("probe_js failed for %s: %s", url_path(req.url), scrub(e))
    return png


async def render_png(req: RenderRequest) -> tuple[bytes, dict]:
    """(png, meta) where meta = {"ready": bool, "probe": <json-able or None>}.

    `ready` is whether `ready_js` ever passed — a timed-out predicate still gets
    screenshotted (a slow-but-fine chart should not be thrown away), but the fact
    that it timed out travels with the image now instead of being swallowed.
    `probe` is whatever `probe_js` evaluated to on the page, read after the
    capture so it describes the frame that was actually taken. The priority comes from
    the request context (`X-Render-Priority`), so the call shape is unchanged."""
    meta = {"ready": False, "probe": None}
    if pool_enabled():
        return await _render_pooled(req, meta), meta
    browser = await _get_browser()
    async with _slots:
        _stats.active += 1
        try:
            ctx = await browser.new_context(viewport={"width": req.width, "height": req.height},
                                            device_scale_factor=req.scale)
            try:
                return await _drive(ctx, req, meta), meta
            finally:
                await ctx.close()
        finally:
            _stats.active -= 1


# ── the pool (RENDER_POOL_ENABLED) ──────────────────────────────────────────

_browser_seq = itertools.count(1)
_page_seq = itertools.count(1)


class _BrowserSlot:
    def __init__(self, browser):
        self.browser = browser
        # ⭐ The identity that proves a recycle did NOT restart Chromium. `_current_slot()` builds a
        # NEW _BrowserSlot for every launch, so an unchanged `id` across an operation is evidence
        # the same browser is still serving — stronger than `is_connected()`, which a replacement
        # also answers True to.
        self.id = f"browser-{next(_browser_seq):04d}"
        self.inflight = 0
        self.renders = 0
        self.retired = False
        self.closed = False
        self.spare: dict = {}       # viewport key -> _PooledPage


class _PooledPage:
    """One pre-created context standing by in `slot.spare`.

    It is "a pooled page" in this service's sense: a spare context serves exactly ONE render's page
    and is then closed (`_render_pooled`'s `finally` always `_close_quiet`s it, and the pool's test
    double asserts a context is never asked for a second page). So `renders` is 0 while the page is
    idle in the pool and 1 from the moment it leaves — the cumulative count the organic ceiling
    reads is `slot.renders`, not this.
    """
    __slots__ = ("ctx", "id", "key", "created_at", "renders")

    def __init__(self, ctx, key):
        self.ctx = ctx
        self.key = key
        self.id = f"page-{next(_page_seq):05d}"
        self.created_at = time.time()
        self.renders = 0

    def describe(self) -> dict:
        w, h, scale = self.key
        return {"id": self.id, "width": w, "height": h, "scale": scale,
                "renders": self.renders, "age_s": round(time.time() - self.created_at, 3)}


async def _current_slot() -> _BrowserSlot:
    global _current, _launch_error
    _locks()
    slot = _current
    if slot is not None and not slot.retired and slot.browser.is_connected():
        return slot
    async with _launch_lock:
        slot = _current
        if slot is None or slot.retired or not slot.browser.is_connected():
            try:
                browser = await _launch_browser()
            except Exception as e:  # noqa: BLE001
                _launch_error = type(e).__name__
                raise
            _launch_error = None
            if slot is not None and not slot.retired:          # disconnected under us
                slot.retired = True
                if slot.inflight == 0:
                    await _close_slot(slot)
            slot = _current = _BrowserSlot(browser)
            log.info("chromium launched (pool)")
        return slot


async def _acquire(priority: str) -> None:
    """A background render needs a background token before a render slot, so background work
    never holds more than RENDER_BACKGROUND_SLOTS of the slots members use."""
    _locks()
    _stats.queued += 1
    try:
        if priority == "background":
            await _bg_slots.acquire()
            try:
                await _slots.acquire()
            except BaseException:
                _bg_slots.release()
                raise
        else:
            await _slots.acquire()
    finally:
        _stats.queued -= 1


def _release(priority: str) -> None:
    _slots.release()
    if priority == "background":
        _bg_slots.release()


async def _replenish(slot: _BrowserSlot, key: tuple) -> None:
    """Pre-create the next render's context so a member's render does not pay for creating one."""
    if slot.retired or key in slot.spare:
        return
    width, height, scale = key
    try:
        ctx = await slot.browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=scale)
    except Exception as e:  # noqa: BLE001
        log.warning("pool: spare context failed: %s", scrub(e))
        return
    if slot.retired or key in slot.spare:
        await _close_quiet(ctx)
    else:
        slot.spare[key] = _PooledPage(ctx, key)


async def _close_slot(slot: _BrowserSlot) -> None:
    slot.closed = True
    for page in list(slot.spare.values()):
        await _close_quiet(page.ctx)
    slot.spare.clear()
    try:
        await slot.browser.close()
    except Exception as e:  # noqa: BLE001
        log.warning("pool: closing a retired chromium failed: %s", type(e).__name__)


async def _after_render(slot: _BrowserSlot) -> None:
    """Retire the browser after RENDER_RECYCLE_AFTER renders or over the RSS ceiling. New renders
    go to a fresh browser; the old one closes when its last in-flight render finishes."""
    global _current
    if not slot.retired:
        after = _env_int("RENDER_RECYCLE_AFTER", 500, 1, 1_000_000)
        ceiling = _env_float("RENDER_RSS_CEILING_MB", 2500.0, 50.0, 256_000.0)
        rss = await asyncio.to_thread(_rss_mb)
        if slot.renders >= after or (rss is not None and rss > ceiling):
            slot.retired = True
            if _current is slot:
                _current = None
            _stats.recycles += 1
            log.info("pool: recycling chromium after %d renders (rss_mb=%s)", slot.renders, rss)
            # Launch the replacement now: measured 2026-09-13, a Chromium start (~1.1-1.5 s locally)
            # landed on the NEXT member's render when it waited for that render to need a browser.
            asyncio.ensure_future(_prelaunch())
    if slot.retired and slot.inflight == 0 and not slot.closed:
        await _close_slot(slot)


async def _prelaunch() -> None:
    try:
        await _current_slot()
    except Exception as e:  # noqa: BLE001
        log.warning("pool: replacement chromium failed to launch: %s", scrub(e))


async def _render_pooled(req: RenderRequest, meta: dict) -> bytes:
    global _warm_done
    priority = _priority.get()
    await _acquire(priority)
    try:
        slot = await _current_slot()
        slot.inflight += 1
        _stats.active += 1
        key = (req.width, req.height, round(float(req.scale), 2))
        ctx = None
        try:
            pooled = slot.spare.pop(key, None)
            if pooled is None:
                _stats.pool_misses += 1
                ctx = await slot.browser.new_context(viewport={"width": req.width, "height": req.height},
                                                     device_scale_factor=req.scale)
            else:
                pooled.renders += 1      # a pooled page's own count, true the moment it leaves the pool
                ctx = pooled.ctx
                _stats.pool_hits += 1
            png = await _drive(ctx, req, meta)
            _warm_done = True                    # a real render proves the browser is warm
            return png
        finally:
            if ctx is not None:
                await _close_quiet(ctx)          # never reused: every render gets a fresh context
            _stats.active -= 1
            slot.inflight -= 1
            slot.renders += 1
            if not slot.retired and len(slot.spare) < _env_int("RENDER_POOL_KEYS", 4, 0, 32):
                asyncio.ensure_future(_replenish(slot, key))
            await _after_render(slot)
    finally:
        _release(priority)


# ── the admin lever: recycle ONE pooled page on demand (RENDER_ADMIN_ENDPOINTS) ─────────────
#
# ⛔ THERE ARE TWO RECYCLE PATHS AND THEY RECYCLE DIFFERENT THINGS. Keep it that way:
#   * ORGANIC — `_after_render` retires the whole BROWSER at RENDER_RECYCLE_AFTER renders or over
#     RENDER_RSS_CEILING_MB, launches the replacement immediately, and closes the old one when its
#     last in-flight render finishes. It bumps `_stats.recycles`.
#   * ON DEMAND — this lever takes ONE idle pooled page, disposes of it through `_close_quiet` (the
#     same disposal every other context on this service goes through) and re-creates its
#     replacement through `_replenish` (the same creation every spare context goes through). It
#     bumps `_stats.page_recycles`, never `_stats.recycles` — conflating them would make
#     `renders_since_recycle` and the `recycles` counter on /health stop meaning "a new browser".
#
# ⭐ It cannot disturb an in-flight render BY CONSTRUCTION, not by checking: a context handed to a
# render is `pop`ped out of `slot.spare` before the render starts, so everything still in
# `slot.spare` is idle by definition. Nothing here launches, retires or closes a browser.


def _pool_state() -> dict:
    """What the pool holds right now. Reported before and after a recycle so the operator can see
    exactly one page change and the browser not change at all."""
    slot = _current
    pages = [p.describe() for p in slot.spare.values()] if slot is not None else []
    return {
        "pool_enabled": pool_enabled(),
        "browser": None if slot is None else {
            "id": slot.id,
            "connected": bool(slot.browser is not None and slot.browser.is_connected()),
            "retired": slot.retired,
            "renders_since_launch": slot.renders,
        },
        "size": len(pages) + (slot.inflight if slot is not None else 0),
        "in_use": slot.inflight if slot is not None else 0,
        "idle": len(pages),
        "pages": pages,
        "recycles": _stats.recycles,            # browser recycles (organic)
        "page_recycles": _stats.page_recycles,  # pooled-page recycles (this lever)
        "pool_hits": _stats.pool_hits,
        "pool_misses": _stats.pool_misses,
    }


def _bearer_ok(authorization: str | None) -> bool:
    """⛔ CONSTANT TIME, never `==`. A byte-by-byte `==` on a secret leaks its prefix to anyone who
    can time this endpoint, and an operator lever is exactly the thing worth grinding at."""
    token = admin_token()
    given = ""
    if authorization:
        scheme, _, rest = authorization.partition(" ")
        if scheme.strip().lower() == "bearer":
            given = rest.strip()
    # An unset RENDER_ADMIN_TOKEN matches nothing: fail closed rather than open a lever with no lock.
    ok = hmac.compare_digest(given.encode("utf-8", "replace"), token.encode("utf-8", "replace"))
    return bool(token) and ok


async def recycle_one_pooled_page(cid: str) -> dict:
    """Recycle EXACTLY ONE pooled page. Returns the report; never raises for a pool it cannot act
    on — "there was nothing idle to take" is an answer, not an error, and forcing it would be the
    one thing the ruling forbids."""
    before = _pool_state()
    report = {"ok": True, "corr_id": cid, "recycled": None, "replaced_by": None,
              "reason": None, "before": before, "after": before}
    slot = _current
    if not pool_enabled():
        report["reason"] = "pool disabled: RENDER_POOL_ENABLED is off, there is no pool to recycle"
    elif slot is None or slot.closed or not slot.browser.is_connected():
        report["reason"] = "no live browser: nothing has been pooled yet"
    elif not slot.spare:
        report["reason"] = ("pool empty: every pooled page is already in flight or none has been "
                            "created — not taking one would disturb a render")
    else:
        # Oldest first, so repeated calls walk the pool instead of fighting over one entry.
        key = min(slot.spare, key=lambda k: slot.spare[k].created_at)
        pooled = slot.spare.pop(key)                 # out of the pool ⇒ no render can claim it now
        report["recycled"] = pooled.describe()
        await _close_quiet(pooled.ctx)               # the ONE disposal path on this service
        await _replenish(slot, key)                  # the ONE creation path for a spare context
        fresh = slot.spare.get(key)
        report["replaced_by"] = fresh.describe() if fresh is not None else None
        if fresh is None:
            report["reason"] = "recycled, but the replacement context could not be created"
        _stats.page_recycles += 1
    report["after"] = _pool_state()
    log.info("pool recycle cid=%s recycled=%s replaced_by=%s idle=%s->%s browser=%s reason=%s",
             cid, (report["recycled"] or {}).get("id"), (report["replaced_by"] or {}).get("id"),
             before["idle"], report["after"]["idle"],
             (report["after"]["browser"] or {}).get("id"), report["reason"])
    return report


async def warm() -> None:
    """Pool boot: launch Chromium and run one hermetic render (no network), then, if
    RENDER_WARM_URL is set, one real page as a background render. `/health` reports ready after.
    The warm URL is logged by path only — a /r/chart URL carries the render token."""
    global _warm_done
    slot = await _current_slot()
    ctx = await slot.browser.new_context(viewport={"width": 400, "height": 240})
    try:
        page = await ctx.new_page()
        await page.set_content('<div id="warm"><canvas width="360" height="200"></canvas></div>')
        await page.locator("#warm").first.screenshot(type="png")
    finally:
        await _close_quiet(ctx)
    url = os.environ.get("RENDER_WARM_URL", "").strip()
    if url:
        token = _priority.set("background")
        try:
            check_url(url)
            await render_png(RenderRequest(url=url))
            log.info("warm render path=%s ok", url_path(url))
        except Exception as e:  # noqa: BLE001 — a failed warm page is logged, not fatal
            log.warning("warm render path=%s failed: %s", url_path(url),
                        scrub(getattr(e, "detail", None) or f"{type(e).__name__}: {e}"))
        finally:
            _priority.reset(token)
    _warm_done = True
    log.info("pool: warm complete")


async def _warm_at_boot() -> None:
    try:
        await warm()
    except Exception as e:  # noqa: BLE001
        log.error("pool: warm failed: %s", scrub(f"{type(e).__name__}: {e}"))


@app.on_event("startup")
async def _startup():
    if pool_enabled():
        asyncio.ensure_future(_warm_at_boot())


@app.get("/health")
async def health():
    """`ready` means "a render sent now can be served". Pool off: the browser launches on the
    first render, so ready = configured and no failed launch (reading `browser` instead would
    report a healthy idle renderer as down). Pool on: ready once the boot warm has run."""
    pool = pool_enabled()
    browser = (_current.browser if _current is not None else None) if pool else _browser
    connected = bool(browser is not None and browser.is_connected())
    ready = bool(SECRET) and _launch_error is None and (_warm_done if pool else True)
    return {
        "ok": True, "ready": ready, "browser": connected, "browser_connected": connected,
        "allowed": sorted(ALLOWED_HOSTS), "pool_enabled": pool,
        "renders_total": _stats.renders_total,
        "renders_since_recycle": (_current.renders if _current is not None else 0) if pool else _stats.renders_total,
        "active": _stats.active, "queued": _stats.queued, "rss_mb": await asyncio.to_thread(_rss_mb),
        "last_render_ms": _stats.last_render_ms, "p95_render_ms": _stats.p95(), "recycles": _stats.recycles,
        "page_recycles": _stats.page_recycles,
        "pool_hits": _stats.pool_hits, "pool_misses": _stats.pool_misses,
        "timeouts": _stats.timeouts, "failures": _stats.failures, "launch_error": _launch_error,
    }


@app.post("/render")
async def render(req: RenderRequest, request: Request, x_render_secret: str | None = Header(default=None),
                 x_correlation_id: str | None = Header(default=None),
                 x_render_priority: str | None = Header(default=None),
                 x_chart_edge_token: str | None = Header(default=None)):
    check_secret(x_render_secret)
    check_url(req.url)
    cid = safe_cid(x_correlation_id)
    priority = "background" if (x_render_priority or "").strip().lower() == "background" else "interactive"
    ceiling = hard_timeout_s(req)
    started = time.perf_counter()
    status, ready, size = 500, None, None
    token = _priority.set(priority)
    # ⚠️ Set AFTER `check_secret` — only a caller that already proved it is the
    # trusted backend may hand this browser a capability.
    edge_token = _edge_token.set((x_chart_edge_token or "").strip())
    try:
        png, meta = await asyncio.wait_for(render_png(req), timeout=ceiling)
        status, ready, size = 200, bool(meta.get("ready")), len(png)
    except asyncio.TimeoutError:
        status = 504
        _stats.timeouts += 1
        raise HTTPException(504, f"render exceeded its hard timeout of {ceiling:.0f} s")
    except HTTPException as e:
        status = e.status_code
        raise HTTPException(e.status_code, scrub(e.detail))
    except Exception as e:  # noqa: BLE001
        status = 502
        _stats.failures += 1
        log.error("render failed cid=%s path=%s\n%s", cid, url_path(req.url), scrub(traceback.format_exc()))
        raise HTTPException(502, scrub(f"render failed: {type(e).__name__}: {e}"))
    finally:
        _priority.reset(token)
        _edge_token.reset(edge_token)
        ms = (time.perf_counter() - started) * 1000.0
        if status == 200:
            _stats.record(ms)
        log.info("render cid=%s path=%s status=%s ms=%.0f prio=%s ready=%s bytes=%s",
                 cid, url_path(req.url), status, ms, priority, ready, size)
    headers = {"X-Render-Bytes": str(len(png)),
               "X-Chart-Ready": "true" if meta.get("ready") else "false"}
    if meta.get("probe") is not None:
        # Compact JSON on one line: a header cannot carry a newline, and the
        # caller parses it with json.loads.
        try:
            headers["X-Chart-Probe"] = json.dumps(meta["probe"], separators=(",", ":"))[:512]
        except (TypeError, ValueError):
            pass
    return Response(content=png, media_type="image/png", headers=headers)


@app.post("/admin/pool/recycle")
async def admin_pool_recycle(authorization: str | None = Header(default=None),
                             x_correlation_id: str | None = Header(default=None)):
    """Recycle exactly one pooled page. Owner ruling B1, 2026-09-14.

    ⛔ 404 — NOT 403 — when RENDER_ADMIN_ENDPOINTS is not "1". With the gate off this route must be
    indistinguishable from one that was never written: a 403 tells an unauthenticated caller that
    an admin lever exists here and that the only thing between them and it is a credential.
    ⛔ The gate is checked BEFORE the bearer, or the 404 would leak through the timing of a
    credential check that only an armed service performs.
    """
    if not admin_endpoints_enabled():
        raise HTTPException(404, "Not Found")
    if not _bearer_ok(authorization):
        raise HTTPException(401, "bad admin bearer")
    cid = safe_cid(x_correlation_id)
    return await recycle_one_pooled_page(cid)


@app.api_route("/admin/pool/recycle", methods=["GET", "PUT", "PATCH", "DELETE", "OPTIONS"],
               include_in_schema=False)
async def _admin_pool_recycle_other_methods():
    """⭐ Registering a path makes every OTHER method answer 405, which is itself a tell: a path
    that does not exist answers 404 to everything. So every non-POST method answers 404 here too,
    armed or not, and the route is invisible to a prober in both states."""
    raise HTTPException(404, "Not Found")


@app.on_event("shutdown")
async def _shutdown():
    global _browser, _pw, _current
    try:
        if _current is not None:
            await _close_slot(_current)
            _current = None
        if _browser:
            await _browser.close()
        if _pw:
            await _pw.stop()
    except Exception:  # noqa: BLE001
        pass
