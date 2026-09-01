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
The browser is launched once and shared; each render gets its own context.
Listens on :: so Railway's IPv6-only private network can reach it.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from urllib.parse import urlparse

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

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

app = FastAPI(title="chart-renderer")
_pw = None
_browser = None
_slots: asyncio.Semaphore | None = None


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


def check_url(url: str) -> None:
    """Refuse anything but https URLs on the allowlisted hosts."""
    try:
        u = urlparse(url)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"bad url: {e}")
    if u.scheme != "https" or not u.hostname:
        raise HTTPException(400, "url must be https")
    if u.hostname.lower() not in ALLOWED_HOSTS:
        raise HTTPException(400, f"host not allowed: {u.hostname}")


def check_secret(given: str | None) -> None:
    if not SECRET:
        raise HTTPException(503, "renderer not configured")
    if not given or given != SECRET:
        raise HTTPException(401, "bad secret")


async def _get_browser():
    global _pw, _browser, _slots
    if _slots is None:
        _slots = asyncio.Semaphore(MAX_CONCURRENT)
    if _browser is None or not _browser.is_connected():
        from playwright.async_api import async_playwright
        if _pw is None:
            _pw = await async_playwright().start()
        _browser = await _pw.chromium.launch(args=["--disable-dev-shm-usage", "--no-sandbox"])
        log.info("chromium launched")
    return _browser


async def render_png(req: RenderRequest) -> tuple[bytes, dict]:
    """(png, meta) where meta = {"ready": bool, "probe": <json-able or None>}.

    `ready` is whether `ready_js` ever passed — a timed-out predicate still gets
    screenshotted (a slow-but-fine chart should not be thrown away), but the fact
    that it timed out travels with the image now instead of being swallowed.
    `probe` is whatever `probe_js` evaluated to on the page, read after the
    capture so it describes the frame that was actually taken."""
    browser = await _get_browser()
    ready_js = (req.ready_js or DEFAULT_READY_JS).replace("SEL", repr(req.selector))
    meta = {"ready": False, "probe": None}
    async with _slots:
        ctx = await browser.new_context(viewport={"width": req.width, "height": req.height},
                                        device_scale_factor=req.scale)
        try:
            page = await ctx.new_page()
            page.set_default_timeout(req.ready_timeout_ms + 6000)
            await page.goto(req.url, wait_until="load")
            try:
                await page.wait_for_function(ready_js, timeout=req.ready_timeout_ms)
                meta["ready"] = True
            except Exception:  # noqa: BLE001 — not fatal, but no longer silent: it rides back in X-Chart-Ready
                log.warning("ready predicate timed out for %s", req.url.split("?")[0])
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
                    log.warning("probe_js failed for %s: %s", req.url.split("?")[0], e)
            return png, meta
        finally:
            await ctx.close()


@app.get("/health")
async def health():
    return {"ok": True, "browser": bool(_browser and _browser.is_connected()), "allowed": sorted(ALLOWED_HOSTS)}


@app.post("/render")
async def render(req: RenderRequest, request: Request, x_render_secret: str | None = Header(default=None)):
    check_secret(x_render_secret)
    check_url(req.url)
    try:
        png, meta = await render_png(req)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        log.exception("render failed")
        raise HTTPException(502, f"render failed: {type(e).__name__}: {e}")
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


@app.on_event("shutdown")
async def _shutdown():
    global _browser, _pw
    try:
        if _browser:
            await _browser.close()
        if _pw:
            await _pw.stop()
    except Exception:  # noqa: BLE001
        pass
