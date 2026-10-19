"""PNG of the site's COT Data page for Discord `/cot`, via the chart-renderer service.

Same contract as buzz_image: POST {renderer}/render with a url + selector +
ready_js, get PNG bytes back. Never raises -- a failed render returns None and the
caller answers in words.

The page is `/r/cot` (app/src/pages/CotRender.jsx), which mounts the SAME
CotData.jsx members see under Breadth -> COT Data, charts and positioning panel,
in its render mode. So the image is the site's own product, not a second drawing
of it that could drift.

⛔ Readiness is not drawn-ness. `ready_js` waits for `window.__cotReady`, which the
page sets to true (charts drawn, written read settled) or 'error' (no data, bad
symbol, bad token). `probe_js` then counts the canvases inside `#cot-export` and
checks the box is its declared width (published by the page as
`window.__cotBoardW`, so the width has one authority). 0 = not ready / nothing
drawn, negative = drawn at the wrong width: both are discarded, never posted.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time

log = logging.getLogger(__name__)

# The renderer's VIEWPORT, not the image: the page is a fixed 1560px element
# (CotRender.jsx) and the shot is `#cot-export`'s own box. Height is headroom for
# the positioning panel, which can run taller than the 860px chart.
VIEW_W, VIEW_H, SCALE = 1600, 2200, 2
# Readiness gets 45 s (the renderer allows up to 60): a market's first price read after
# a restart measured 10-27 s cold on 2026-10-19 (GC 5Y: 26.8 s), and the 25 s this
# started with lost the first /cot after a deploy. The HTTP wait covers readiness plus
# navigation and the screenshot.
READY_TIMEOUT_MS = 45000
RENDER_TIMEOUT_S = 75.0

LOOKBACKS = ("1Y", "2Y", "3Y", "5Y")
DEFAULT_LOOKBACK = "1Y"

# A COT report lands once a week, and the written read for it is stored by the
# Friday pre-warm; a 30-minute cache collapses a burst of the same request to one
# render while a fresh Friday report still shows up within the half hour.
_CACHE_TTL_S = float(os.environ.get("COT_IMAGE_CACHE_TTL_S", "1800"))
_FLIGHT_WAIT_S = float(os.environ.get("COT_IMAGE_FLIGHT_WAIT_S", "80"))   # outlasts one render
_SLOT_WAIT_S = float(os.environ.get("COT_IMAGE_SLOT_WAIT_S", "15"))

_CACHE: dict[tuple, tuple[float, bytes]] = {}
_CACHE_LOCK = threading.Lock()
_FLIGHT_LOCKS: dict[tuple, threading.Lock] = {}

READY_JS = "() => window.__cotReady === true || window.__cotReady === 'error'"

_PROBE_W_TOLERANCE_PX = 2
PROBE_JS = (
    "(() => {"
    " const el = document.getElementById('cot-export');"
    " if (!el || window.__cotReady !== true) return 0;"
    " const n = el.querySelectorAll('canvas').length;"
    " const want = window.__cotBoardW;"
    " if (!want) return n;"
    " const w = Math.round(el.getBoundingClientRect().width);"
    " return Math.abs(w - want) <= %d ? n : -w;"
    "})()" % _PROBE_W_TOLERANCE_PX
)

# Three trader-group panes + open interest; the price pane is a fifth when the
# market has a proxy. Fewer than four canvases is a page that did not finish.
MIN_CANVASES = 4


def image_enabled() -> bool:
    if os.environ.get("COT_IMAGE_ENABLED", "1").strip().lower() in ("0", "false", "off", ""):
        return False
    return bool(os.environ.get("CHART_RENDERER_URL", "").strip())


def normalize_lookback(value) -> str:
    v = str(value or "").strip().upper()
    return v if v in LOOKBACKS else DEFAULT_LOOKBACK


def _cache_get(key: tuple) -> bytes | None:
    with _CACHE_LOCK:
        hit = _CACHE.get(key)
        if not hit:
            return None
        made, png = hit
        if time.monotonic() - made > _CACHE_TTL_S:
            _CACHE.pop(key, None)
            return None
        return png


def _cache_put(key: tuple, png: bytes) -> None:
    with _CACHE_LOCK:
        _CACHE[key] = (time.monotonic(), png)


def _flight_lock(key: tuple) -> threading.Lock:
    with _CACHE_LOCK:
        return _FLIGHT_LOCKS.setdefault(key, threading.Lock())


def _reset_for_tests() -> None:
    with _CACHE_LOCK:
        _CACHE.clear()
        _FLIGHT_LOCKS.clear()


def _probe(resp) -> int | None:
    raw = resp.headers.get("X-Chart-Probe")
    if raw is None:
        return None
    try:
        v = json.loads(raw)
    except (TypeError, ValueError):
        return None
    return v if isinstance(v, int) and not isinstance(v, bool) else None


def render_cot_png(symbol: str, lookback: str = DEFAULT_LOOKBACK, *, cls: int, client=None) -> bytes | None:
    """Cached, single-flighted, slot-limited render of one market's COT page.
    None on every failure path."""
    key = (str(symbol or "").upper(), normalize_lookback(lookback))
    png = _cache_get(key)
    if png is not None:
        return png
    lock = _flight_lock(key)
    if not lock.acquire(timeout=_FLIGHT_WAIT_S):
        return _cache_get(key)
    try:
        png = _cache_get(key)
        if png is not None:
            return png
        png = _render_uncached(key[0], key[1], cls=cls, client=client)
        if png:
            _cache_put(key, png)
        return png
    finally:
        lock.release()


def _render_uncached(symbol: str, lookback: str, *, cls: int, client=None) -> bytes | None:
    renderer = os.environ.get("CHART_RENDERER_URL", "").strip().rstrip("/")
    if not renderer:
        return None
    base = os.environ.get("CHART_RENDER_BASE_URL", "https://uctintelligence.com")
    token = os.environ.get("CHART_RENDER_TOKEN", "")
    secret = os.environ.get("CHART_RENDERER_SECRET", "")
    from urllib.parse import urlencode
    url = f"{base}/r/cot?" + urlencode({"symbol": symbol, "lookback": lookback, "token": token})

    # The same bounded valve /chart and /buzz use, never a second lane at the renderer.
    from api.services.discord_interactions import RENDER_SLOTS
    if not RENDER_SLOTS.acquire(timeout=_SLOT_WAIT_S, cls=cls):
        log.info("[cot] no render slot within %.0fs for %s", _SLOT_WAIT_S, symbol)
        return None
    try:
        import httpx
        own = client is None
        c = client or httpx.Client(timeout=RENDER_TIMEOUT_S)
        try:
            from api.services.discord_render import ids as render_ids, observe as render_observe
            t0 = time.monotonic()
            r = c.post(f"{renderer}/render", headers={"X-Render-Secret": secret, **render_ids.render_headers()}, json={
                "url": url, "selector": "#cot-export",
                "width": VIEW_W, "height": VIEW_H, "scale": SCALE,
                "settle_ms": 500, "ready_js": READY_JS, "ready_timeout_ms": READY_TIMEOUT_MS,
                "probe_js": PROBE_JS,
            })
            if not r.is_success:
                log.warning("[cot] render HTTP %s for %s: %s", r.status_code, symbol,
                            render_observe.scrub(r.text)[:160])
                return None
            if not r.content.startswith(b"\x89PNG"):
                log.warning("[cot] render returned non-PNG for %s", symbol)
                return None
            probe = _probe(r)
            if probe is not None and probe < 0:
                log.warning("[cot] %s rendered %dpx wide, not its declared width -- discarding", symbol, -probe)
                return None
            if probe is not None and probe < MIN_CANVASES:
                log.warning("[cot] %s page not drawn (probe=%s) -- discarding", symbol, probe)
                return None
            log.info("[cot] rendered %s %s in %.1fs (%d bytes, probe=%s)",
                     symbol, lookback, time.monotonic() - t0, len(r.content), probe)
            return r.content
        finally:
            if own:
                c.close()
    except Exception as e:  # noqa: BLE001
        log.warning("[cot] render failed for %s: %s", symbol, e)
        return None
    finally:
        RENDER_SLOTS.release()
