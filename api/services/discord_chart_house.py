"""House chart image for /chart: the dashboard's OWN /r/chart page (the real
StockChart widget, branded header/footer, watermark, MAs, last-price tag),
screenshotted by the `chart-renderer` Railway service at 2x device scale.

This is the same picture the Sunday Scans / Substack renderers produce from
the owner's PC (`morning-wire/substack/chartwidget.py`), so a Discord chart
and a newsletter chart agree. The extra stats travel to the page as a
`?stats=` base64url JSON payload computed server-side (one authority:
`discord_chart_render.compute_stats`); the page only renders them.

Everything here degrades to None; the caller falls back to the mplfinance
renderer, so a renderer outage never turns into a failed reply.
"""
from __future__ import annotations

import base64
import json
import logging
import os
from urllib.parse import urlencode

log = logging.getLogger(__name__)

# The Share-Chart export format every house renderer matches (owner, 2026-08-01).
HOUSE_W, HOUSE_H = 1296, 670
# Extra header strip ChartRender adds when ?stats= is present.
STATS_STRIP_H = 28
# Same composition, twice the pixels: 2592 x (1340 | 1396).
HOUSE_SCALE = 2
RENDER_TIMEOUT_S = 60.0
_VIEWPORT_PAD = 40
# ChartRender sets window.__chartReady only once the canvases inside
# #chart-export have held still (never before 3.5 s) — a far better "done"
# than "a canvas exists", which is true the instant the widget mounts.
HOUSE_READY_JS = "() => window.__chartReady === true"
# A sized-but-EMPTY canvas still passes every DOM predicate (bars late after a
# deploy, empty series): judge the pixels like the Substack harness does —
# grayscale std-dev of the chart body with the chrome bands dropped. Measured
# 2026-08-25: blank body ≈ 1.3, drawn body ≈ 30+.
_MIN_BODY_STDDEV = 6.0
# (settle_ms, ready_timeout_ms) per attempt; the retry gives late bars time.
_ATTEMPTS = ((800, 40000), (5000, 45000))


def has_chart_content(png: bytes) -> bool:
    """False for a frame whose chart body is near-uniform (nothing drew) or for
    bytes that are not an image; True for a body with real variance."""
    try:
        import io
        from PIL import Image, ImageStat
        im = Image.open(io.BytesIO(png)).convert("L")
        w, h = im.size
        body = im.crop((0, int(h * 0.11), w, int(h * 0.91)))
        return ImageStat.Stat(body).stddev[0] >= _MIN_BODY_STDDEV
    except Exception:  # noqa: BLE001
        return False


def house_enabled() -> bool:
    return bool(os.environ.get("CHART_RENDERER_URL", "").strip())


def _b64url(obj) -> str:
    raw = json.dumps(obj, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def build_render_url(sym: str, tf: str, stats: dict | None, *, base_url: str, token: str) -> str:
    h = HOUSE_H + (STATS_STRIP_H if stats else 0)
    params = {"sym": sym, "tf": tf, "w": HOUSE_W, "h": h}
    if token:
        params["token"] = token
    if stats:
        params["stats"] = _b64url(stats)
    return base_url.rstrip("/") + "/r/chart?" + urlencode(params)


def render_house_chart(sym: str, tf: str, stats: dict | None, *, client=None) -> bytes | None:
    """PNG bytes of the house chart, or None (unconfigured, renderer down,
    non-PNG body, any exception). Never raises."""
    renderer = os.environ.get("CHART_RENDERER_URL", "").strip().rstrip("/")
    if not renderer:
        return None
    secret = os.environ.get("CHART_RENDERER_SECRET", "")
    token = os.environ.get("CHART_RENDER_TOKEN", "")
    base = os.environ.get("CHART_RENDER_BASE_URL", "https://uctintelligence.com")
    page_url = build_render_url(sym, tf, stats, base_url=base, token=token)
    try:
        import httpx
        own = client is None
        c = client or httpx.Client(timeout=RENDER_TIMEOUT_S)
        try:
            for attempt, (settle_ms, ready_timeout_ms) in enumerate(_ATTEMPTS, 1):
                body = {
                    "url": page_url, "selector": "#chart-export",
                    "width": HOUSE_W + _VIEWPORT_PAD, "height": HOUSE_H + STATS_STRIP_H + _VIEWPORT_PAD,
                    "scale": HOUSE_SCALE, "settle_ms": settle_ms,
                    "ready_js": HOUSE_READY_JS, "ready_timeout_ms": ready_timeout_ms,
                }
                r = c.post(f"{renderer}/render", json=body, headers={"X-Render-Secret": secret})
                if not r.is_success:
                    log.warning("[discord-chart] house render HTTP %s for %s %s (attempt %d): %s",
                                r.status_code, sym, tf, attempt, r.text[:160])
                    continue
                if not r.content.startswith(b"\x89PNG"):
                    log.warning("[discord-chart] house render returned non-PNG for %s %s (attempt %d)", sym, tf, attempt)
                    continue
                if not has_chart_content(r.content):
                    log.warning("[discord-chart] house render body BLANK for %s %s (attempt %d)", sym, tf, attempt)
                    continue
                return r.content
            return None
        finally:
            if own:
                c.close()
    except Exception as e:  # noqa: BLE001 — fallback, never a failure
        log.warning("[discord-chart] house render failed for %s %s: %s", sym, tf, e)
        return None
