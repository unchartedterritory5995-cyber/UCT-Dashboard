"""Measure the SYMBOL-SWITCH experience — the ~0.5 s black frame between stocks.

⛔ THE METRIC IS T0 -> PAINT, NOT A REQUEST TIME. A member scanning a theme judges
"click -> chart", so this drives real in-app symbol changes on a live component and
reads the per-switch marks `StockChart` now emits. Request latency is one input to
that number, never the number itself.

Reuses `intraday_tail_harness`'s isolation wholesale: no backend, every `/api/**`
route-mocked, `/r/chart` (open when VITE_CHART_RENDER_TOKEN is unset), so no
C:\data, no session cookie, no secret. The fixture sleeps for the PRODUCTION-measured
origin latency (111 ms full / 59 ms tail) — a 0 ms server would hide the wait.

Usage:  .venv\Scripts\python.exe tools\intraday_scan_harness.py
"""
from __future__ import annotations

import json
import os
import statistics
import sys
import threading
from datetime import timedelta
from functools import partial
from http.server import ThreadingHTTPServer

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from intraday_tail_harness import (   # noqa: E402
    CLOCK_JS, DIST, FAKE_NOW, Fixture, SEED_JS, SPAHandler, CACHE_LOGIC_VERSION,
    free_port, make_bars, route_handler,
)

NAV = ("(u) => { window.history.pushState({}, '', u); "
       "window.dispatchEvent(new PopStateEvent('popstate')); }")
REPORT = "() => window.__uctChartTiming.report()"
PCTL = "(p) => window.__uctChartTiming.percentiles(p)"

# A Rare-Earth-shaped list: the workflow is a theme's members, not one megacap.
SCAN = ["MP", "UUUU", "TMC", "REEMF", "NB", "IDR", "USAR", "CRML", "ARRNF", "TMRC",
        "LYSDY", "ILUKY", "AREC", "PPTA", "NIOBF", "SRCRF", "UAMY", "TRXA", "GSM", "LAC"]


def _pct(vals, q):
    v = sorted(x for x in vals if isinstance(x, (int, float)))
    return v[min(len(v) - 1, int(q * len(v)))] if v else None


NATIVE_TFS = ("1", "5", "15", "30", "60", "D", "W", "M")


def native_base(code):
    """The tf the bars cache is KEYED by for a display code.

    Mirrors app/src/components/chart/timeframes.js `fetchTf`: a custom intraday
    code (2m, 45m, 4h …) is client-resampled from the coarsest native base that
    divides it, so warming the display code warms nothing.
    """
    if code in NATIVE_TFS:
        return code
    m = int(code)
    return str(next(b for b in (60, 30, 15, 5, 1) if m % b == 0 and m > b))


CLEAR_IDB = ("() => new Promise(res => { const r = indexedDB.deleteDatabase('uct_bars_v1'); "
             "r.onsuccess = r.onerror = r.onblocked = () => res(true) })")


def run(page, fixture, base, tf, syms, seed_idb, label, seed_tf=None, clear_idb=True):
    """Drive a scan and return the per-switch paint times.

    `seed_tf` is which cache key the LIST WARMED, which is not always the one the
    CHART READS. That difference is the whole defect: an embedded Theme Tracker /
    Watchlist keyed every warm on its own hidden `chartPeriod` (stuck at 'D'
    because the panel that moves it is hidden when embedded), so a member
    scanning on 5m had the warmer fill SYM_D while the chart asked for SYM_5.
    Seeding `seed_tf='D'` for a tf='5' scan reproduces that exactly.
    """
    fixture.requests.clear()
    page.goto(f"{base}/blank.html", wait_until="domcontentloaded")
    # ⚠️ RUNS SHARE A BROWSER CONTEXT, SO IndexedDB SURVIVES BETWEEN THEM. Without
    # this wipe the second run inherits the first run's bars and every arm after
    # "COLD" reads warm — which is exactly how a first draft of this harness made
    # the WRONG-KEY arm look fast (11 ms) when it is the defect being measured.
    # The mem cache needs no wipe: `goto` tears the module singleton down.
    if clear_idb:
        page.evaluate(CLEAR_IDB)
    if seed_idb:
        warm_tf = seed_tf or native_base(tf)
        for sym in syms:
            page.evaluate(SEED_JS, [sym, warm_tf,
                                    make_bars(int(warm_tf) if warm_tf.isdigit() else 5, FAKE_NOW, 8),
                                    CACHE_LOGIC_VERSION])
    page.evaluate("() => { try { localStorage.setItem('uct.chartTiming','1') } catch {} }")

    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(f"{base}/r/chart?sym={syms[0]}&tf={tf}&w=1100&h=560", wait_until="domcontentloaded")
    page.wait_for_timeout(2500)
    page.evaluate("() => window.__uctChartTiming.clear()")

    for sym in syms[1:]:
        page.evaluate(NAV, f"/r/chart?sym={sym}&tf={tf}&w=1100&h=560")
        page.wait_for_timeout(700)          # a brisk human scan cadence
    page.wait_for_timeout(1500)

    rows = page.evaluate(REPORT)
    paints = [r["T0→paint"] for r in rows if r["T0→paint"] is not None]
    t2s = [r["T0→T2"] for r in rows if r["T0→T2"] is not None]
    t3s = [r["T0→T3"] for r in rows if r["T0→T3"] is not None]
    fulls = sum(1 for q in fixture.requests if not q["delta"])
    tails = sum(1 for q in fixture.requests if q["delta"])
    print(f"\n=== {label}  tf={tf}m  n_switches={len(syms)-1} ===")
    print(f"  T0->paint   n={len(paints):3}  p50={_pct(paints,.5)}  p90={_pct(paints,.9)}  "
          f"p95={_pct(paints,.95)}  max={max(paints) if paints else None}")
    print(f"  T0->T2      p50={_pct(t2s,.5)}   T0->T3(current) p50={_pct(t3s,.5)}")
    print(f"  requests    FULL={fulls}  TAIL={tails}")
    print(f"  page errors {errs or 'none'}")
    return {"label": label, "tf": tf, "paints": paints, "t2": t2s, "t3": t3s,
            "full": fulls, "tail": tails, "errors": errs}


def main():
    if not os.path.isfile(os.path.join(DIST, "index.html")):
        print("FAIL: app/dist not built"); return 1
    with open(os.path.join(DIST, "blank.html"), "w", encoding="utf-8") as f:
        f.write("<!doctype html><title>blank</title>")
    port = free_port()
    httpd = ThreadingHTTPServer(("127.0.0.1", port), partial(SPAHandler, directory=DIST))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}"
    print(f"[scan] {base}  clock={FAKE_NOW.isoformat()}  no backend / no /data / no cookie")

    fixture = Fixture()
    out = []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            ctx = b.new_context(viewport={"width": 1280, "height": 720})
            ctx.add_init_script(CLOCK_JS % int(FAKE_NOW.timestamp() * 1000))
            ctx.route("**/api/**", route_handler(fixture))
            page = ctx.new_page()

            out.append(run(page, fixture, base, "5", SCAN, False, "COLD client cache (first visit)"))
            # ⛔ THE DEFECT, MODELLED: the list warmed, but under the WRONG KEY.
            # Warming is not a boolean — a full warm on 'D' buys a 5m scan nothing.
            out.append(run(page, fixture, base, "5", SCAN, True,
                           "WRONG-KEY WARM (list warmed D, chart reads 5m)", seed_tf="D"))
            out.append(run(page, fixture, base, "5", SCAN, True, "WARM client cache (IDB seeded)"))
            # the same list again in the SAME context: now genuinely revisited
            # The ONE arm that must NOT wipe: it is the same list, visited again.
            out.append(run(page, fixture, base, "5", SCAN, False, "REVISIT (same session)",
                           clear_idb=False))
            # Spot-checks across the rest of the intraday ladder, each BOTH ways,
            # so the win is shown to be a property of the scan and not of 5m.
            for tf in ("1", "2", "15", "30", "60"):
                out.append(run(page, fixture, base, tf, SCAN[:8], False, "COLD spot-check"))
                out.append(run(page, fixture, base, tf, SCAN[:8], True, "WARM spot-check"))
            b.close()
    finally:
        httpd.shutdown()
        try: os.remove(os.path.join(DIST, "blank.html"))
        except OSError: pass

    dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), "intraday_scan_out.json")
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print(f"\n[scan] wrote {dst}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
