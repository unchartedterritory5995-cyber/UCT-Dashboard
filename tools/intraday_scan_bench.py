r"""Light-speed intraday SCAN benchmark — before/after, fully isolated (W-D, 2026-11-10).

Drives a rapid in-app pushState scan of 20 tickers on 5m and 1m against a built
`app/dist` (pass the dist dir), with every `/api/**` route-mocked by
`intraday_tail_harness.Fixture` (production-measured latency 111 ms full / 59 ms tail).
No backend, no /data, no cookie.

Per switch it reads the chart's own instrumentation (`window.__uctChartTiming`):
  T0->TC        time to the first CURRENT-ENOUGH paint (the product metric)
  staleFirst    the first frame drawn was NOT current (a stale tail shown)
  visibleBlank  the canvas sat empty across >1 compositor frame after a clear
  neverCurrent  the switch never reached a current frame while it was on screen
and counts /api/bars requests (full vs since=) for the whole scan.

Cache arms (each in a fresh browser context, so nothing leaks between them):
  COLD      nothing cached
  BEHIND    IndexedDB seeded with a tail 3 hours behind the clock (sound, not current)
  CURRENT   IndexedDB seeded at the frontier

Usage:
  .venv\Scripts\python.exe tools\intraday_scan_bench.py <dist_dir> <label> [cadence_ms]
"""
from __future__ import annotations

import json
import os
import sys
import threading
from datetime import timedelta
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from intraday_tail_harness import (   # noqa: E402
    CLOCK_JS, FAKE_NOW, Fixture, SEED_JS, CACHE_LOGIC_VERSION,
    free_port, make_bars, route_handler,
)

NAV = ("(u) => { window.history.pushState({}, '', u); "
       "window.dispatchEvent(new PopStateEvent('popstate')); }")
SCAN = ["MP", "UUUU", "TMC", "REEMF", "NB", "IDR", "USAR", "CRML", "ARRNF", "TMRC",
        "LYSDY", "ILUKY", "AREC", "PPTA", "NIOBF", "SRCRF", "UAMY", "TRXA", "GSM", "LAC"]


def handler_for(dist):
    class H(SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=dist, **k)

        def do_GET(self):
            p = self.path.split("?", 1)[0]
            if not os.path.isfile(os.path.join(dist, p.lstrip("/"))):
                self.path = "/index.html"
            return SimpleHTTPRequestHandler.do_GET(self)

        def log_message(self, *a):
            pass
    return H


def _pct(vals, q):
    v = sorted(x for x in vals if isinstance(x, (int, float)))
    return v[min(len(v) - 1, int(q * len(v)))] if v else None


def run_arm(browser, base, tf, arm, cadence_ms):
    fixture = Fixture()
    ctx = browser.new_context(viewport={"width": 1280, "height": 720})
    ctx.add_init_script(CLOCK_JS % int(FAKE_NOW.timestamp() * 1000))
    ctx.route("**/api/**", route_handler(fixture))
    page = ctx.new_page()
    page.goto(f"{base}/blank.html", wait_until="domcontentloaded")
    tfm = int(tf)
    if arm != "COLD":
        tail = FAKE_NOW - timedelta(hours=3) if arm == "BEHIND" else FAKE_NOW
        for s in SCAN:
            page.evaluate(SEED_JS, [s, tf, make_bars(tfm, tail, 8), CACHE_LOGIC_VERSION])
    page.evaluate("() => { try { localStorage.setItem('uct.chartTiming','1'); "
                  "localStorage.setItem('barspack.version','2026-09-14') } catch {} }")
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)[:200]))
    # A neutral first symbol so every SCAN name is a real in-app switch.
    page.goto(f"{base}/r/chart?sym=SPY&tf={tf}&w=1100&h=560", wait_until="domcontentloaded")
    page.wait_for_timeout(2500)
    page.evaluate("() => { window.__uctChartTiming.clear(); window.__uctFrameLog = [] }")
    fixture.requests.clear()
    for s in SCAN:
        page.evaluate(NAV, f"/r/chart?sym={s}&tf={tf}&w=1100&h=560")
        page.wait_for_timeout(cadence_ms)
    page.wait_for_timeout(2000)
    rows = page.evaluate("() => window.__uctChartTiming.report()")
    frames = page.evaluate("() => window.__uctFrameLog || []")
    ctx.close()
    frames = [f for f in frames if f.get("sym") in SCAN]
    rows = [r for r in rows if r["sym"] in SCAN]
    tc = [r["T0→TC"] for r in rows]
    fp = [r["T0→paint"] for r in rows]
    out = {
        "tf": tf, "arm": arm, "n": len(rows),
        "TC_p50": _pct(tc, .5), "TC_p90": _pct(tc, .9), "TC_max": max([x for x in tc if x is not None], default=None),
        "neverCurrent": sum(1 for x in tc if x is None),
        "firstPaint_p50": _pct(fp, .5), "firstPaint_p90": _pct(fp, .9),
        "noPaint": sum(1 for x in fp if x is None),
        # frames: every intraday bars change the chart committed (diagnostic frame log)
        "frames": len(frames),
        "contextFrames": sum(1 for f in frames if f.get("context")),
        # ⛔ THE DEFECT METRIC: a frame whose tail is NOT current while the chart presents
        # itself as current (settled currentness → LIVE may light). Must be 0.
        "staleShownAsCurrent": sum(1 for f in frames if not f.get("current") and f.get("settled")),
        "staleFirstPaint": sum(1 for r in rows if r["staleFirstPaint"]),
        "blackFrame": sum(1 for r in rows if r["blackFrame"]),
        "visibleBlank": sum(1 for r in rows if (r["emptyWindowMs"] or 0) > 16.7),
        "barsReq_full": sum(1 for q in fixture.requests if not q["delta"]),
        "barsReq_tail": sum(1 for q in fixture.requests if q["delta"]),
        "pageErrors": len(errs),
    }
    return out


def main():
    dist, label = sys.argv[1], sys.argv[2]
    cadence = int(sys.argv[3]) if len(sys.argv) > 3 else 150
    with open(os.path.join(dist, "blank.html"), "w", encoding="utf-8") as f:
        f.write("<!doctype html><title>blank</title>")
    port = free_port()
    httpd = ThreadingHTTPServer(("127.0.0.1", port), handler_for(dist))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}"
    results = []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            for tf in (sys.argv[4].split(",") if len(sys.argv) > 4 else ("5", "1")):
                for arm in ("COLD", "BEHIND", "CURRENT"):
                    r = run_arm(b, base, tf, arm, cadence)
                    r["label"] = label
                    r["cadence_ms"] = cadence
                    print(json.dumps(r))
                    results.append(r)
            b.close()
    finally:
        httpd.shutdown()
    return results


if __name__ == "__main__":
    main()
