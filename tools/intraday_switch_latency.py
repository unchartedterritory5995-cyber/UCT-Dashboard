"""T0 -> TC for an intraday symbol switch, through the REAL ChartWidget.

⭐ THE ONLY METRIC THAT COUNTS. T0 is the Enter keystroke; TC is the first frame
where the DISPLAYED ticker, the PAINTED candles and CURRENT-ENOUGH all agree. A
commit is not a chart: `useSymbolHandoff` can commit B onto nothing, and an
earlier cut of this measurement would have scored that as a win.

⛔⛔ NO PRODUCTION LOAD. Every /api call is answered by the fixture below, for two
reasons and not one: the market is open and burst-probing a live product is how I
manufactured a phantom 8-second latency once already, AND the nine cache classes
this has to separate are only reachable if the server's behaviour is something I
can dictate. A fixture is the instrument, not a shortcut.

⛔ THE HARNESS DRIVES THE REAL DOOR. `window.__scan.typeEnter` opens the real
`SymbolSearch` in the real `ChartIdentityRow`, sets the real input and dispatches
a real Enter; `select()` is the list click. Both exist because they are DIFFERENT
paths and the owner's complaint names the typed one.
"""
from __future__ import annotations

import json
import os
import socket
import statistics
import sys
import time as _time
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from playwright.sync_api import sync_playwright          # noqa: E402
from intraday_tail_harness import (                       # noqa: E402
    CACHE_LOGIC_VERSION, CLOCK_JS, SEED_JS, ET, make_bars,
)
from scan_handoff_harness import CLEAR_IDB, start_dev_server   # noqa: E402

TF = "5"
# A weekday mid-session instant, so `isCurrentEnoughForPaint` has a live frontier
# to measure against rather than a weekend's frozen one.
FAKE_NOW = datetime(2026, 9, 23, 14, 30, tzinfo=ET)

LIST = ["AAPL", "NVDA", "AMD", "MU", "AMAT", "AVGO", "TSLA", "META", "PLTR", "QQQ"]
TYPED = ["SPY", "BFRG", "SNGX", "GRRR", "CNEY", "VRME"]


class Fixture:
    """Per-symbol server behaviour. `mode` is the CACHE CLASS being staged."""

    def __init__(self):
        self.mode = {}          # sym -> 'ok' | 'warming' | 'nodata' | 'slow'
        self.delay_ms = {}      # sym -> extra server latency
        self.calls = []         # every /api/bars request, in order
        self.warm_hits = {}     # sym -> how many warming 503s already served

    def bars_for(self, sym, tf, n=260):
        return make_bars(int(tf) if tf.isdigit() else 5, FAKE_NOW, n_sessions=3)[-n:]


def router(fx: Fixture):
    def handle(route):
        req = route.request
        url = req.url
        path = url.split("?")[0].split("/api/", 1)[-1] if "/api/" in url else ""
        qs = url.split("?", 1)[1] if "?" in url else ""

        if path.startswith("bars/"):
            sym = path.split("bars/", 1)[1].split("/")[0].upper()
            tf = "5"
            for kv in qs.split("&"):
                if kv.startswith("tf="):
                    tf = kv.split("=", 1)[1]
            fx.calls.append({"sym": sym, "tf": tf, "warm": "warm=1" in qs,
                             "since": "since=" in qs})
            mode = fx.mode.get(sym, "ok")
            delay = fx.delay_ms.get(sym, 0)

            if mode == "warming":
                # ⭐ PROBLEM B'S SHAPE, END TO END. The server says "I have started
                # looking"; the client's `barsSwrOnErrorRetry` warming branch must
                # come back and collect. Second ask serves real bars.
                seen = fx.warm_hits.get(sym, 0)
                fx.warm_hits[sym] = seen + 1
                if seen == 0:
                    route.fulfill(status=503, headers={"Retry-After": "1",
                                                       "content-type": "application/json"},
                                  body=json.dumps({"ticker": sym, "tf": tf,
                                                   "bars": [], "error": "warming"}))
                    return
            if mode == "nodata":
                route.fulfill(status=200, content_type="application/json",
                              body=json.dumps({"ticker": sym, "tf": tf, "bars": [],
                                               "no_data": True,
                                               "reason": "symbol_not_carried"}))
                return
            if delay:
                # ⚠️ time.sleep, NOT page.wait_for_timeout. A route handler runs on
                # Playwright's dispatch path; calling a sync PAGE api from inside it
                # re-enters the same channel and can deadlock the run. The handler
                # thread is the right place to spend the latency being simulated.
                _time.sleep(delay / 1000.0)
            route.fulfill(status=200, content_type="application/json",
                          body=json.dumps({"ticker": sym, "tf": tf,
                                           "bars": fx.bars_for(sym, tf)}))
            return

        if path.startswith("ticker-search"):
            q = ""
            for kv in qs.split("&"):
                if kv.startswith("q="):
                    q = kv.split("=", 1)[1].upper()
            route.fulfill(status=200, content_type="application/json",
                          body=json.dumps({"results": [
                              {"ticker": q, "name": f"{q} Inc", "type": "stock",
                               "exchange": "NASDAQ"}]}))
            return

        # Everything else the widget subtree touches answers benignly and fast —
        # it must not be able to add latency the metric would blame on the chart.
        route.fulfill(status=200, content_type="application/json", body="{}")
    return handle


def _open(page, base, tf, syms, seed=None, fx=None):
    """Fresh page. ⚠️ SEED ON ?blank=1 FIRST — an IDB version change BLOCKS
    FOREVER while the app holds a connection (the harness says so in as many
    words, measured at 30+ minutes of silence)."""
    page.goto(f"{base}/scan-harness.html?blank=1", wait_until="domcontentloaded")
    page.evaluate(CLEAR_IDB)
    page.evaluate("() => { try { localStorage.clear(); sessionStorage.clear() } catch (e) {} }")
    page.evaluate("() => { localStorage.setItem('uct.chartTiming','1') }")
    for (s, bars) in (seed or []):
        page.evaluate(SEED_JS, [s, tf, bars, CACHE_LOGIC_VERSION])
    page.goto(f"{base}/scan-harness.html?tf={tf}&syms={','.join(syms)}",
              wait_until="domcontentloaded")
    page.wait_for_function("() => !!window.__scan", timeout=30000)
    page.wait_for_timeout(2500)          # let A settle so we measure a SWITCH
    if fx is not None:
        fx.calls.clear()


def _switch(page, target, how):
    """One measured switch. Returns the watcher record."""
    ready = page.evaluate("(s) => window.__scan.readiness(s)", target)
    if how == "typed":
        r = page.evaluate("async (s) => await window.__scan.typeEnter(s)", target)
        if not r or not r.get("ok"):
            return {"error": (r or {}).get("why", "typeEnter failed"), "readiness": ready}
        page.evaluate("([s,t]) => window.__scan.watchFull(s,t)", [target, r["t0"]])
    else:
        page.evaluate("(s) => { window.__scan.watchFull(s); window.__scan.select(s) }", target)
    # ⚠️ IDENTITY, NOT JUST PRESENCE. The wait must name the symbol it is waiting
    # for, or a leftover record satisfies it immediately.
    page.wait_for_function(
        "(s) => window.__scanWatchFull && window.__scanWatchFull.target === s"
        "       && (window.__scanWatchFull.tCoherent != null"
        "           || window.__scanWatchFull.total != null)",
        arg=target, timeout=20000)
    out = page.evaluate("() => window.__scan.watchFullResult()")
    out["readiness"] = ready
    out["how"] = how
    return out


def _fmt(rs):
    got = [r["tCoherent"] for r in rs if r.get("tCoherent") is not None]
    if not got:
        return "no coherent frame"
    got.sort()
    p = lambda q: got[min(len(got) - 1, int(len(got) * q))]      # noqa: E731
    return (f"n={len(got):<3} p50={statistics.median(got):>6.0f}ms "
            f"p90={p(0.9):>6.0f}ms p95={p(0.95):>6.0f}ms max={max(got):>6.0f}ms")


def _bad(rs):
    return (sum(r.get("invalidEmptyMs", 0) for r in rs),
            sum(r.get("invalidMixedMs", 0) for r in rs),
            sum(r.get("invalidStaleMs", 0) for r in rs))


def scenario(page, base, name, *, tf=TF, how="typed", syms=None, targets=None,
             seed=None, fx=None, modes=None, delays=None):
    fx.mode = dict(modes or {})
    fx.delay_ms = dict(delays or {})
    fx.warm_hits = {}
    syms = syms or LIST
    _open(page, base, tf, syms, seed=seed, fx=fx)
    rows = []
    for t in (targets or TYPED):
        rows.append(_switch(page, t, how))
        page.wait_for_timeout(700)       # human cadence, never a burst
    empty, mixed, stale = _bad(rows)
    reqs = len(fx.calls)
    print(f"  {name:<44} {_fmt(rows)}  empty={empty:.0f}ms mixed={mixed:.0f}ms "
          f"stale={stale:.0f}ms req/switch={reqs / max(1, len(rows)):.1f}", flush=True)
    return {"scenario": name, "tf": tf, "how": how, "rows": rows,
            "invalidEmptyMs": empty, "invalidMixedMs": mixed, "invalidStaleMs": stale,
            "requests": reqs, "perSwitch": reqs / max(1, len(rows))}


def main():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]
    print(f"[switch] dev server on :{port}", flush=True)
    proc = start_dev_server(port)
    out = []
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctx = browser.new_context(viewport={"width": 1500, "height": 900})
            ctx.add_init_script(CLOCK_JS % int(FAKE_NOW.timestamp() * 1000))
            fx = Fixture()
            ctx.route("**/api/**", router(fx))
            page = ctx.new_page()
            base = f"http://127.0.0.1:{port}"
            warm3 = make_bars(5, FAKE_NOW, n_sessions=3)

            print("[switch] BASELINE — the owner's exact workflow:", flush=True)
            out.append(scenario(page, base, "5m typed Enter, COLD targets", fx=fx))
            out.append(scenario(page, base, "5m list click, COLD targets",
                                how="click", syms=LIST + TYPED, fx=fx))
            out.append(scenario(page, base, "D  typed Enter (daily control)",
                                tf="D", fx=fx))

            print("[switch] CACHE CLASSES (5m):", flush=True)
            out.append(scenario(page, base, "B. IDB current (seeded)", fx=fx,
                                seed=[(s, warm3) for s in TYPED]))
            out.append(scenario(page, base, "F. cold + 300ms server", fx=fx,
                                delays={s: 300 for s in TYPED}))
            out.append(scenario(page, base, "G. cold small-cap WARMING 503", fx=fx,
                                modes={s: "warming" for s in TYPED}))
            out.append(scenario(page, base, "I. genuine no-data (terminal)", fx=fx,
                                modes={s: "nodata" for s in TYPED}))

            print("[switch] A. memory current (revisit):", flush=True)
            _open(page, base, TF, LIST + TYPED, fx=fx)
            fx.mode = {}
            first = [_switch(page, t, "typed") for t in TYPED[:3]]
            page.wait_for_timeout(500)
            again = []
            for t in TYPED[:3]:
                page.evaluate("(s) => window.__scan.select(s)", "AAPL")
                page.wait_for_timeout(600)
                again.append(_switch(page, t, "typed"))
            print(f"  {'A. first visit':<44} {_fmt(first)}", flush=True)
            print(f"  {'A. revisit (memory)':<44} {_fmt(again)}", flush=True)
            out.append({"scenario": "A. memory revisit", "rows": again,
                        "firstRows": first})
            browser.close()
    finally:
        try: proc.terminate()
        except Exception: pass                    # noqa: BLE001

    dst = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       "intraday_switch_latency_out.json")
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, default=str)
    print(f"\n[switch] wrote {dst}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
