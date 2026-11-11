"""Browser proof: do saved intraday drawings render on the bar they were drawn on,
on both sides of a DST change? (W-E, 2026-11-10)

No backend (same isolation as tools/intraday_tail_harness.py): Playwright
route-mocks /api/**, the page is /r/chart (open without a render token in a local
build), the browser clock is shifted to Mon 2026-11-02 12:05 ET (the day after the
fall-back change). Three VERTICAL-line drawings are seeded in localStorage, each
aimed at a bar whose HIGH is a distinctive spike:

  magenta  manual (raw unix)        Fri 2026-10-30 09:30 EDT   spike 190
  cyan     legacy Agent (chart time) Thu 2026-10-29 09:30 EDT   spike 170
  yellow   manual (raw unix)        Mon 2026-11-02 09:30 EST   spike 150

From the screenshot it finds each line's column (by colour) and each spike's
column (the highest candle pixels), and reports the line-to-spike distance in
bars. 0 means the drawing sits on its bar; ~+4 or ~+5 means it renders 4/5 hours late.

Usage: python tools/drawing_dst_harness.py <dist dir> <label> <out dir>
Prints numbers and booleans only — no market data is involved.
"""
from __future__ import annotations

import json
import os
import re
import socket
import sys
import threading
from datetime import datetime, timedelta
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from zoneinfo import ZoneInfo

from PIL import Image
from playwright.sync_api import sync_playwright

ET = ZoneInfo("America/New_York")
FAKE_NOW = datetime(2026, 11, 2, 12, 5, tzinfo=ET)
DAYS = [(2026, 10, 28), (2026, 10, 29), (2026, 10, 30), (2026, 11, 2)]
# the TradingView session grid (pre clock hours, 09:30 … 15:30, post clock hours)
GRID = sorted(set([(h, 0) for h in range(4, 10)] + [(9, 30)] + [(h, 30) for h in range(10, 16)]
                  + [(h, 0) for h in range(16, 20)]))

def ts(y, mo, d, h, mi):
    return int(datetime(y, mo, d, h, mi, tzinfo=ET).timestamp())

TARGETS = {
    "magenta": {"t": ts(2026, 10, 30, 9, 30), "kind": "manual", "spike": 190.0, "rgb": (255, 0, 255)},
    "cyan": {"t": ts(2026, 10, 29, 9, 30), "kind": "legacy-agent", "spike": 170.0, "rgb": (0, 255, 255)},
    "yellow": {"t": ts(2026, 11, 2, 9, 30), "kind": "manual", "spike": 150.0, "rgb": (255, 255, 0)},
}

def chart_time(u):   # ET wall clock read as UTC (what the old agent stored)
    d = datetime.fromtimestamp(u, ET)
    return int(datetime(d.year, d.month, d.day, d.hour, d.minute, tzinfo=ZoneInfo("UTC")).timestamp())

def bars60():
    out = []
    spikes = {v["t"]: v["spike"] for v in TARGETS.values()}
    for (y, mo, d) in DAYS:
        for (h, mi) in GRID:
            t = ts(y, mo, d, h, mi)
            if t > int(FAKE_NOW.timestamp()):
                break
            hi = spikes.get(t, 101.0)
            out.append({"t": t, "o": 100.0, "h": hi, "l": 99.0, "c": 100.5, "v": 1000})
    return out

def drawings():
    out = []
    for name, v in TARGETS.items():
        t = v["t"] if v["kind"] == "manual" else chart_time(v["t"])
        out.append({"id": f"h-{name}", "type": "vertical", "points": [{"time": t, "price": 120.0}],
                    "color": "#%02x%02x%02x" % v["rgb"], "lineWidth": 3, "lineStyle": "solid"})
    return {"AAPL": out}

CLOCK_JS = """
(() => {
  const OFFSET = %d - Date.now();
  const RealDate = Date;
  function FakeDate(...a) { return a.length ? new RealDate(...a) : new RealDate(RealDate.now() + OFFSET) }
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = () => RealDate.now() + OFFSET;
  FakeDate.parse = RealDate.parse; FakeDate.UTC = RealDate.UTC;
  window.Date = FakeDate;
})();
"""

def route_handler(bars):
    def handle(route, request):
        url = request.url
        path = url.split("?", 1)[0]
        send = lambda obj: route.fulfill(status=200, content_type="application/json", body=json.dumps(obj))
        m = re.search(r"/api/bars/([^/?]+)$", path)
        if m:
            qs = dict(re.findall(r"[?&]([^=&]+)=([^&]*)", url))
            tf = qs.get("tf", "D")
            if tf != "60":
                return send({"ticker": m.group(1), "tf": tf, "bars": []})
            since = qs.get("since")
            rows = [b for b in bars if not since or b["t"] > int(since)]
            return send({"ticker": m.group(1), "tf": "60", "bars": rows, **({"delta": True} if since else {})})
        if "/api/auth/me" in path:
            return send({"email": "harness@local", "plan": "pro", "role": "user"})
        return send({})
    return handle

class SPA(SimpleHTTPRequestHandler):
    def do_GET(self):
        p = self.path.split("?", 1)[0]
        if not os.path.isfile(os.path.join(self.directory, p.lstrip("/"))):
            self.path = "/index.html"
        return SimpleHTTPRequestHandler.do_GET(self)
    def log_message(self, *a):
        pass

def cols_of(img, rgb, tol=40):
    w, h = img.size
    px = img.load()
    hits = []
    for x in range(w):
        n = 0
        for y in range(0, h, 2):
            r, g, b = px[x, y][:3]
            if abs(r - rgb[0]) < tol and abs(g - rgb[1]) < tol and abs(b - rgb[2]) < tol:
                n += 1
        if n > 40:
            hits.append(x)
    return (sum(hits) / len(hits)) if hits else None

def spike_cols(img, exclude):
    """Topmost 'candle' pixel per column (anything non-background that is not a line colour)."""
    w, h = img.size
    px = img.load()
    bg = px[5, h // 2][:3]
    top = {}
    for x in range(60, w - 90):
        for y in range(40, h - 60):
            r, g, b = px[x, y][:3]
            if abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) < 60:
                continue
            if any(abs(r - c[0]) < 60 and abs(g - c[1]) < 60 and abs(b - c[2]) < 60 for c in exclude):
                continue
            if max(r, g, b) - min(r, g, b) < 25:      # grey grid / text
                continue
            top[x] = y
            break
    return top

def main():
    dist, label, outdir = sys.argv[1], sys.argv[2], sys.argv[3]
    os.makedirs(outdir, exist_ok=True)
    with open(os.path.join(dist, "blank.html"), "w", encoding="utf-8") as f:
        f.write("<!doctype html><title>blank</title>")
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    httpd = ThreadingHTTPServer(("127.0.0.1", port), partial(SPA, directory=dist))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}"
    bars = bars60()
    result = {"label": label, "bars": len(bars)}
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(viewport={"width": 1280, "height": 760})
            ctx.add_init_script(CLOCK_JS % int(FAKE_NOW.timestamp() * 1000))
            ctx.route("**/api/**", route_handler(bars))
            page = ctx.new_page()
            page.goto(f"{base}/blank.html")
            page.evaluate("(d) => localStorage.setItem('uct-chart-drawings', JSON.stringify(d))", drawings())
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)[:200]))
            page.goto(f"{base}/r/chart?sym=AAPL&tf=60&w=1200&h=620&ext=1&bars=200", wait_until="domcontentloaded")
            page.wait_for_timeout(6000)
            shot = os.path.join(outdir, f"drawing-dst-{label}.png")
            page.screenshot(path=shot)
            result["drawn"] = page.evaluate("() => window.__chartBarCount ?? null")
            result["errors"] = errors[:5]
            browser.close()
    finally:
        httpd.shutdown()
    img = Image.open(shot).convert("RGB")
    # Bar i's x = the i-th volume column (one histogram column per bar, left to right).
    w, h = img.size
    px = img.load()
    def green(c):
        return c[1] > 120 and c[1] - c[0] > 40 and c[1] - c[2] > 20
    def clusters_at(y):
        out, run = [], []
        for x in range(w):
            if green(px[x, y]):
                run.append(x)
            elif run:
                out.append(sum(run) / len(run)); run = []
        if run:
            out.append(sum(run) / len(run))
        return out
    cols = []
    for y in range(h - 20, h // 2, -1):          # bottom-up: the histogram, not the dashed avg line
        c = clusters_at(y)
        if len(c) == len(bars):
            cols = c
            break
    result["volume_columns"] = len(cols)
    spacing = (cols[-1] - cols[0]) / (len(cols) - 1) if len(cols) > 1 else None
    result["bar_spacing_px"] = round(spacing, 2) if spacing else None
    index = {b["t"]: i for i, b in enumerate(bars)}
    for name, v in TARGETS.items():
        lx = cols_of(img, v["rgb"])
        i = index[v["t"]]
        xc = cols[i] if len(cols) == len(bars) else None
        off = None if (lx is None or xc is None) else round((lx - xc) / spacing, 2)
        result[name] = {"kind": v["kind"], "bar_index": i, "bar_x": None if xc is None else round(xc, 1),
                        "line_x": None if lx is None else round(lx, 1), "offset_bars": off,
                        "offset_hours_approx": off, "on_bar": off is not None and abs(off) < 0.5}
    result["screenshot"] = shot
    print(json.dumps(result, indent=1))

if __name__ == "__main__":
    main()
