"""PNG of the buzz board, via the existing chart-renderer service.

Same contract as discord_chart_house.render_house_chart: POST /render with a
url + selector + ready_js, get PNG bytes back. Never raises -- a failed render
degrades to a text board, it does not cost the member their answer.

⛔ Readiness is not drawn-ness. `ready_js` gates on `window.__buzzReady`, which
BuzzRender.jsx flips true from its `nothingToMeasure` branch too -- i.e. a
board with ZERO rows and ZERO tail chips is "ready" by that flag's own
definition. `probe_js` counts `[data-buzz-row]` elements at capture time; the
renderer echoes it back as the `X-Chart-Probe` header, and a 0 there is
discarded as a failed render rather than delivered as a blank image. This
repo shipped blank chart PNGs twice by trusting a readiness flag instead of
counting the artifact (discord_chart_house.py's PROBE_JS is the same fix,
applied there to /chart).
"""
from __future__ import annotations

import json
import logging
import os

log = logging.getLogger(__name__)

# 1400 wide because the board carries EVERY ticker: a ranked column plus the
# themed tail in three sub-columns. Height is a generous VIEWPORT -- the
# renderer screenshots the #buzz-export element's own box, so a day with more
# tickers simply produces a taller PNG.
BOARD_W, BOARD_H, SCALE = 1400, 1400, 2
RENDER_TIMEOUT_S = 45.0

READY_JS = "() => window.__buzzReady === true"
# Count the artifact, do not trust the flag. Comes back as the X-Chart-Probe
# header; 0 rows means "ready but empty" -> discard.
PROBE_JS = "document.querySelectorAll('[data-buzz-row]').length"


def image_enabled() -> bool:
    if os.environ.get("BUZZ_IMAGE_ENABLED", "1").strip().lower() in ("0", "false", "off", ""):
        return False
    return bool(os.environ.get("CHART_RENDERER_URL", "").strip())


def _probe_rows(resp) -> int | None:
    """Rows the page says it drew, or None when the renderer did not say (an
    older renderer/bundle without X-Chart-Probe). Unknown falls through to
    "keep the image" -- exactly the behaviour that existed before the probe."""
    raw = resp.headers.get("X-Chart-Probe")
    if raw is None:
        return None
    try:
        v = json.loads(raw)
    except (TypeError, ValueError):
        return None
    return v if isinstance(v, int) and not isinstance(v, bool) else None


def render_board_png(window: str = "open", *, client=None) -> bytes | None:
    renderer = os.environ.get("CHART_RENDERER_URL", "").strip().rstrip("/")
    if not renderer:
        return None
    base = os.environ.get("CHART_RENDER_BASE_URL", "https://uctintelligence.com")
    token = os.environ.get("CHART_RENDER_TOKEN", "")
    secret = os.environ.get("CHART_RENDERER_SECRET", "")
    url = f"{base}/r/buzz?token={token}&window={window}"
    try:
        import httpx
        own = client is None
        c = client or httpx.Client(timeout=RENDER_TIMEOUT_S)
        try:
            r = c.post(f"{renderer}/render", headers={"X-Render-Secret": secret}, json={
                "url": url, "selector": "#buzz-export",
                "width": BOARD_W, "height": BOARD_H, "scale": SCALE,
                "settle_ms": 400, "ready_js": READY_JS, "ready_timeout_ms": 15000,
                "probe_js": PROBE_JS,
            })
            if not r.is_success:
                log.warning("[buzz] render HTTP %s: %s", r.status_code, r.text[:160])
                return None
            if not r.content.startswith(b"\x89PNG"):
                log.warning("[buzz] render returned non-PNG")
                return None
            rows = _probe_rows(r)
            if rows == 0:
                log.warning("[buzz] render ready but empty (0 rows) -- discarding")
                return None
            return r.content
        finally:
            if own:
                c.close()
    except Exception as e:  # noqa: BLE001
        log.warning("[buzz] render failed: %s", e)
        return None
