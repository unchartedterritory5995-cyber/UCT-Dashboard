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
# The page's own held-still flag, gated on its bars-landed flag: an EMPTY
# chart holds still too (5-minute renders shipped blank twice on 2026-08-25
# while the 5,000-bar fetch was still in flight).
HOUSE_READY_JS = "() => window.__chartBarsReady === true && window.__chartReady === true"
# A sized-but-EMPTY canvas still passes every DOM predicate (bars late after a
# deploy, empty series): judge the pixels like the Substack harness does —
# grayscale std-dev of the chart body with the chrome bands dropped. Measured
# 2026-08-25: blank body ≈ 1.3, drawn body ≈ 30+.
_MIN_BODY_STDDEV = 6.0
# (settle_ms, ready_timeout_ms) per attempt; the retry gives late bars time.
_ATTEMPTS = ((300, 30000), (3000, 45000))


def house_ready_js(sym: str) -> str:
    """Readiness without the page flag's 3.5 s floor. True when the export node
    names the symbol, the chart canvases downsampled to 32x18 show real colour
    variety (a blank/uniform canvas yields 1-2 colours; candles, MAs and grid
    yield dozens), and that downsampled signature is unchanged across two
    samples >=250 ms apart. `window.__chartReady` (the page's own held-still
    flag) is accepted too, whichever comes first - but neither before the page's
    `window.__chartBarsReady` says StockChart has its bars. Measured 2026-08-25
    on the live page: drawn at ~1.2 s, stable at ~1.5 s, vs 4.2 s for the flag."""
    sym_js = repr(str(sym).upper())
    return (
        "() => {"
        # No bars, not ready - whatever the pixels say. The header + watermark
        # alone satisfy the colour-variety test below, and the page's held-still
        # flag is true of an empty chart, so this guard comes before both.
        " if (window.__chartBarsReady !== true) return false;"
        " if (window.__chartReady === true) return true;"
        " const e = document.querySelector('#chart-export'); if (!e) return false;"
        f" if (!(e.innerText || '').toUpperCase().includes({sym_js})) return false;"
        " const cs = [...e.querySelectorAll('canvas')].filter(c => c.width > 200 && c.height > 100);"
        " if (!cs.length) return false;"
        " const off = window.__uctOff || (window.__uctOff = document.createElement('canvas'));"
        " off.width = 32; off.height = 18; const o = off.getContext('2d', { willReadFrequently: true }); if (!o) return false;"
        " let sig = ''; const seen = new Set();"
        " for (const c of cs) { o.clearRect(0, 0, 32, 18); try { o.drawImage(c, 0, 0, 32, 18); } catch (err) { return false; }"
        "   let d; try { d = o.getImageData(0, 0, 32, 18).data; } catch (err) { return false; }"
        "   for (let i = 0; i < d.length; i += 4) { const px = (d[i] >> 3) + ',' + (d[i+1] >> 3) + ',' + (d[i+2] >> 3); sig += px + ';'; seen.add(px); } }"
        " if (seen.size < 6) return false;"
        " const now = performance.now(); const prev = window.__uctChartSample;"
        " if (!prev || now - prev.t >= 250) { window.__uctChartSample = { s: sig, t: now }; return !!prev && prev.s === sig; }"
        " return false; }"
    )


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


DEFAULT_OPTIONS = {"indicators": None, "ext": False, "stats": True, "exttag": None, "preset": None, "instances": None,
                   "breadth": None, "bars": None, "to": None}

# Visible bars for intraday renders. The page's own default zoom counts
# pre/post-market candles, and ~60% of a live 5/15/30-minute payload IS
# extended hours, so the default squeezed a session's candles into a strip of
# flat overnight bars (member: "intraday charts need to be readjusted"). With
# extended hours on, 110 five-minute bars = ~9h = the pre-market plus the whole
# regular session; 90 fifteen-minute bars = ~1.4 extended days; 80 thirty-minute
# bars = ~2.5. Hourly keeps the page's own default (65 bars, about 4 days).
INTRADAY_VISIBLE_BARS = {"5": 110, "15": 90, "30": 80}


def build_render_url(sym: str, tf: str, stats: dict | None, *, base_url: str, token: str,
                     options: dict | None = None) -> str:
    """`options` = discord_chart_prefs.render_options(prefs): a partial
    chart-settings override (`?indicators=`), and the ext / stats switches."""
    opts = {**DEFAULT_OPTIONS, **(options or {})}
    show_stats = bool(stats) and bool(opts["stats"])
    h = HOUSE_H + (STATS_STRIP_H if show_stats else 0)
    params = {"sym": sym, "tf": tf, "w": HOUSE_W, "h": h}
    if tf not in ("D", "W", "M"):
        # Pre/post-market candles + session shading, exactly like the Charts
        # widget's Extended-hours switch. Explicit rather than inherited so a
        # bot chart never depends on whatever the saved setting happens to be.
        params["ext"] = 1 if opts["ext"] else 0
        if tf in INTRADAY_VISIBLE_BARS:
            params["bars"] = INTRADAY_VISIBLE_BARS[tf]
    if opts.get("bars"):
        params["bars"] = int(opts["bars"])          # an explicit zoom beats the intraday default
    if opts.get("to"):
        # "Earlier" panning: the page hides every bar after this day and frames
        # the window ending there (StockChart replayCutoff; the bars API serves
        # a pre-cutoff window fast from SQLite).
        params["to"] = str(opts["to"])
    if token:
        params["token"] = token
    if show_stats:
        params["stats"] = _b64url(stats)
    if opts.get("indicators"):
        params["indicators"] = _b64url(opts["indicators"])
    if opts.get("preset"):
        params["preset"] = str(opts["preset"])          # one of the app's own theme presets
    if opts.get("instances"):
        params["instances"] = _b64url(opts["instances"])  # engine indicator instances (RSI, MACD)
    if opts.get("breadth"):
        # A UCT breadth metric. The page then mirrors the app's ChartPane breadth
        # treatment (symbol + metric name watermark, single-ink line, blank volume
        # pane) - the bot already resolved the record, so the page needs no fetch
        # and there is no catalog race before the capture.
        params["breadth"] = 1
        params["bname"] = str(opts["breadth"])[:80]
    tag = opts.get("exttag")
    if tag:
        # The live pre/post-market print as the orange right-axis chip (see
        # ChartRender ?exttag=). Every timeframe: on D/W it sits beside the
        # locked close, on intraday it is the one number that matters.
        sess, px = tag
        params["exttag"] = f"{sess}:{float(px):.2f}"
    return base_url.rstrip("/") + "/r/chart?" + urlencode(params)


def render_house_chart(sym: str, tf: str, stats: dict | None, options: dict | None = None, *, client=None) -> bytes | None:
    """PNG bytes of the house chart, or None (unconfigured, renderer down,
    non-PNG body, any exception). Never raises."""
    renderer = os.environ.get("CHART_RENDERER_URL", "").strip().rstrip("/")
    if not renderer:
        return None
    secret = os.environ.get("CHART_RENDERER_SECRET", "")
    token = os.environ.get("CHART_RENDER_TOKEN", "")
    base = os.environ.get("CHART_RENDER_BASE_URL", "https://uctintelligence.com")
    page_url = build_render_url(sym, tf, stats, base_url=base, token=token, options=options)
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
                    "ready_js": house_ready_js(sym), "ready_timeout_ms": ready_timeout_ms,
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
