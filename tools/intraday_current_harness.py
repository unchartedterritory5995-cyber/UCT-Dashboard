r"""Measure T0 -> TC: the FIRST CURRENT-ENOUGH VISIBLE PAINT.

The metric this replaces was actively misleading. `T0 -> paint` records when
candles reach the canvas and says nothing about WHICH SESSION they describe, so
the fastest switch in the previous run -- 11 ms -- was a cache that stopped at
10:00 painted at 15:55. A 10 ms paint of a six-hour-stale chart is a FAILURE,
and the old harness scored it as the best result it had.

Scenarios, all against the SAME server (which always holds bars up to now), so
the only variable is what the browser had cached:

  A  cache at the frontier          -- should paint instantly AND be current
  B  cache 2 buckets behind         -- the borderline the tolerance governs
  C  cache hours behind (MU)        -- must NOT paint stale, whatever it costs
  D  cold                           -- honest network cost, no faking
  E  rapid mixed scan               -- the real workflow, distributions not bests

Isolation is inherited wholesale from intraday_tail_harness: no backend, every
/api/** route-mocked, /r/chart, a SHIFTED (not frozen) clock. No C:\data, no
session cookie, no secret.

Usage:  <venv>\python.exe tools\intraday_current_harness.py
"""
from __future__ import annotations

import json
import os
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
RATES = "() => window.__uctChartTiming.rates()"
CLEAR_IDB = ("() => new Promise(res => { const r = indexedDB.deleteDatabase('uct_bars_v1'); "
             "r.onsuccess = r.onerror = r.onblocked = () => res(true) })")

SCAN = ["MU", "MP", "UUUU", "TMC", "NB", "IDR", "USAR", "CRML", "TMRC", "AREC",
        "PPTA", "UAMY", "GSM", "LAC", "REEMF", "NIOBF", "SRCRF", "TRXA", "ARRNF", "LYSDY"]


def _pct(vals, q):
    v = sorted(x for x in vals if isinstance(x, (int, float)))
    return v[min(len(v) - 1, int(q * len(v)))] if v else None


def _tails(tf: str, kind: str):
    """The cache tail for a scenario, or None for cold."""
    tf_min = int(tf)
    if kind == "current":  return FAKE_NOW
    if kind == "slight":   return FAKE_NOW - timedelta(minutes=2 * tf_min)
    if kind == "hours":    return FAKE_NOW.replace(hour=10, minute=0, second=0, microsecond=0)
    return None            # cold


def seed(page, syms, tf, kind):
    tail = _tails(tf, kind)
    if tail is None:
        return
    bars = make_bars(int(tf), tail)
    for sym in syms:
        page.evaluate(SEED_JS, [sym, tf, bars, CACHE_LOGIC_VERSION])


def run(page, fixture, base, tf, syms, kind, label, dwell_ms=700):
    fixture.requests.clear()
    page.goto(f"{base}/blank.html", wait_until="domcontentloaded")
    page.evaluate(CLEAR_IDB)
    seed(page, syms, tf, kind)
    page.evaluate("() => { try { localStorage.setItem('uct.chartTiming','1') } catch {} }")

    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(f"{base}/r/chart?sym={syms[0]}&tf={tf}&w=1100&h=560", wait_until="domcontentloaded")
    page.wait_for_timeout(2500)
    page.evaluate("() => window.__uctChartTiming.clear()")
    for sym in syms[1:]:
        page.evaluate(NAV, f"/r/chart?sym={sym}&tf={tf}&w=1100&h=560")
        page.wait_for_timeout(dwell_ms)
    page.wait_for_timeout(1500)

    rows = page.evaluate(REPORT)
    rates = page.evaluate(RATES) or {}
    g = lambda k: [r[k] for r in rows if r.get(k) is not None]   # noqa: E731
    t4, tc, t7 = g("T0\u2192paint"), g("T0\u2192TC"), g("T0\u2192T3")
    print(f"\n=== {label}   tf={tf}m  cache={kind}  n={len(rows)} ===")
    for nm, v in (("T0->T4 (any paint) ", t4), ("T0->TC (current)   ", tc), ("T0->T7 (fully cur) ", t7)):
        print(f"  {nm} n={len(v):3} p50={_pct(v,.5)}  p90={_pct(v,.9)}  p95={_pct(v,.95)}")
    print(f"  STALE FIRST PAINT : {rates.get('staleFirstPaint')}/{rates.get('switches')} "
          f"({rates.get('staleFirstPaintPct')}%)   worst={rates.get('worstBarsBehind')} bars behind")
    print(f"  teardown fired    : {rates.get('blackFrame')}/{rates.get('switches')} "
          f"({rates.get('blackFramePct')}%)")
    print(f"  VISIBLE BLACK(>1f): {rates.get('visibleBlackFrame')}/{rates.get('switches')} "
          f"({rates.get('visibleBlackFramePct')}%)  empty window p50={rates.get('emptyWindowP50')} "
          f"p95={rates.get('emptyWindowP95')} ms")
    print(f"  never reached current: {rates.get('neverReachedCurrent')}   no paint: {rates.get('noPaintRecorded')}")
    print(f"  requests FULL={sum(1 for q in fixture.requests if not q['delta'])} "
          f"TAIL={sum(1 for q in fixture.requests if q['delta'])}   errors={errs or 'none'}")
    return {"label": label, "tf": tf, "cache": kind, "rows": rows, "rates": rates,
            "t4": t4, "tc": tc, "t7": t7, "errors": errs,
            "full": sum(1 for q in fixture.requests if not q["delta"]),
            "tail": sum(1 for q in fixture.requests if q["delta"])}


def main():
    if not os.path.isfile(os.path.join(DIST, "index.html")):
        print("FAIL: app/dist not built"); return 1
    with open(os.path.join(DIST, "blank.html"), "w", encoding="utf-8") as f:
        f.write("<!doctype html><title>blank</title>")
    port = free_port()
    httpd = ThreadingHTTPServer(("127.0.0.1", port), partial(SPAHandler, directory=DIST))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}"
    print(f"[current] {base}  clock={FAKE_NOW.isoformat()}  no backend / no /data / no cookie")

    fixture = Fixture()
    out = []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            ctx = b.new_context(viewport={"width": 1280, "height": 720})
            ctx.add_init_script(CLOCK_JS % int(FAKE_NOW.timestamp() * 1000))
            ctx.route("**/api/**", route_handler(fixture))
            page = ctx.new_page()

            for kind, label in (("current", "A  cache AT the frontier"),
                                ("slight",  "B  cache 2 buckets behind"),
                                ("hours",   "C  cache HOURS behind (the MU case)"),
                                (None,      "D  COLD cache")):
                out.append(run(page, fixture, base, "5", SCAN, kind, label))

            for tf in ("1", "15", "30", "60"):
                out.append(run(page, fixture, base, tf, SCAN[:8], "hours",
                               f"spot-check HOURS-behind", dwell_ms=600))
            b.close()
    finally:
        httpd.shutdown()
        try: os.remove(os.path.join(DIST, "blank.html"))
        except OSError: pass

    dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), "intraday_current_out.json")
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print(f"\n[current] wrote {dst}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
