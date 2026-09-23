"""WHERE DOES PRE-2024 DAILY HISTORY GO?

⛔⛔ THE PRODUCTION REGRESSION THIS TRACES (2026-09-22). QQQ/SPY/AAPL/MSFT on
1D + Origin all begin at exactly 2024-05-01 -- the 600th trading day back, the
same calendar date for every symbol, which is the signature of a row cap rather
than missing data. Measured against production the same evening:

    /api/bars/QQQ?tf=D&bars=600     -> 600 rows,   earliest 2024-05-01
    /api/bars/QQQ?tf=D&bars=20000   -> 5,063 rows, earliest 2006-08-07, 117 ms
    /api/bars-history/QQQ?tf=D      -> 5,062 rows, earliest 2006-08-07, sealed
                                       (15 ms on a CDN hit)

So the server, the auth and the CDN are fine and the 600-row primary is
DELIBERATE: the split-history architecture pairs a shallow fast primary with a
deep sealed history leg. The chart behaves as though only the primary exists.

⭐ WHAT THIS HARNESS OBSERVES, AND WHY IT NEEDS NO NEW PRODUCTION CODE. The
interesting predicates (`_histFire`, `_splitDeepPaintable`, `idbStaleDaily`) are
module-private consts, but the four cases are separable from OUTSIDE:

    no /api/bars-history request        -> CASE A  the leg never fires
    request fires, IDB never grows      -> CASE B  the merge never commits
    IDB grows deep, render stays 600    -> CASE C  the selector rejects it
    render goes deep then shrinks       -> CASE D  something truncates later

So the trace records the REQUESTS, the IDB CONTENTS and the RENDERED SERIES, and
lets those three disagree with each other.

⚠️ THE SHIPPED FIXTURE COULD NOT BE USED AS-IS. `intraday_tail_harness`'s
`/api/bars-history/` stub returns `{"ticker":"X", "bars":[], "sealed":True}` --
empty, wrong ticker. Against that stub the chart would show 600 bars and the run
would "reproduce" the bug for a reason that has nothing to do with production.
This tool serves a real deep sealed set instead.

Usage:  python tools\\daily_history_trace.py
"""
from __future__ import annotations

import json
import os
import socket
import sys
from datetime import datetime, timedelta

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from intraday_tail_harness import (   # noqa: E402
    CACHE_LOGIC_VERSION, CLOCK_JS, FAKE_NOW, Fixture, SEED_JS, route_handler,
)
from scan_handoff_harness import CLEAR_IDB, start_dev_server  # noqa: E402

SYM = "QQQ"
TODAY = FAKE_NOW.date()                      # the fixture's "today"
ORIGIN = datetime(2006, 8, 7).date()         # production's real QQQ origin
PRIMARY_ROWS = 600                           # FIRST_PAINT_BARS


def _sessions(start, end):
    """Business days, deterministic -- no holiday calendar needed for a fixture."""
    out, d = [], start
    while d <= end:
        if d.weekday() < 5:
            out.append(d)
        d += timedelta(days=1)
    return out


_ALL = _sessions(ORIGIN, TODAY)


def _bar(d, i):
    px = round(100.0 + (i % 997) / 40.0, 2)
    return {"t": d.isoformat(), "o": px, "h": round(px + 1, 2),
            "l": round(px - 1, 2), "c": round(px + 0.5, 2), "v": 1000 + i}


FULL = [_bar(d, i) for i, d in enumerate(_ALL)]
# The sealed history ends at the last CLOSED session, exactly as production's
# endpoint does (`last_sealed` = yesterday while today is still forming).
SEALED = FULL[:-1]


def daily_router(fixture):
    """Daily-aware routes; everything else falls through to the shared fixture."""
    base = route_handler(fixture)

    def handle(route, request):
        url = request.url
        if "/api/bars-history/" in url:
            from urllib.parse import urlparse, parse_qs
            q = parse_qs(urlparse(url).query)
            sym = url.split("/api/bars-history/")[1].split("?")[0]
            route.fulfill(status=200, content_type="application/json",
                          body=json.dumps({
                              "ticker": sym.upper(), "tf": q.get("tf", ["D"])[0],
                              "bars": SEALED, "sealed": True,
                              "count": len(SEALED),
                              "last_sealed": SEALED[-1]["t"],
                              "version": SEALED[-1]["t"],
                          }))
            return
        if "/api/bars/" in url and "tf=D" in url:
            from urllib.parse import urlparse, parse_qs
            q = parse_qs(urlparse(url).query)
            sym = url.split("/api/bars/")[1].split("?")[0]
            n = int(q.get("bars", ["600"])[0])
            rows = FULL[-n:] if n < len(FULL) else FULL
            route.fulfill(status=200, content_type="application/json",
                          body=json.dumps({"ticker": sym.upper(), "tf": "D",
                                           "bars": rows,
                                           "newest_bar_is_forming": False}))
            return
        return base(route, request)
    return handle


PROBE_JS = r"""
(() => {
  window.__probe = { fetches: [] };
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/api/bars') !== -1) {
      const u = new URL(url, location.origin);
      const rec = { path: u.pathname, tf: u.searchParams.get('tf'),
                    nbars: u.searchParams.get('bars'), d: u.searchParams.get('d'),
                    at: Math.round(performance.now()), rows: null, status: null };
      window.__probe.fetches.push(rec);
      return realFetch(input, init).then(r => {
        rec.status = r.status;
        rec.ms = Math.round(performance.now() - rec.at);
        r.clone().json().then(j => { rec.rows = (j && j.bars && j.bars.length) || 0; })
                        .catch(() => {});
        return r;
      });
    }
    return realFetch(input, init);
  };
})();
"""

SNAP_JS = """
(async () => {
  const out = {};
  const d = window.__uctChartDebug || {};
  const k = Object.keys(d)[0];
  try {
    const t = k ? d[k].renderedTail(999999) : null;
    out.rendered = t && t.length
      ? { n: t.length, first: String(t[0].time), last: String(t[t.length-1].time) }
      : null;
  } catch (e) { out.rendered = 'err:' + e.name; }
  // ⛔⛔ THE MEMBER SEES A WINDOW, NOT A SERIES. Every run so far scored the
  // SERIES (5,247 rows back to 2006) and called the pipeline healthy -- but the
  // screenshot is a VIEW. A chart holding 20 years while framing only the last
  // 600 bars looks exactly like a chart that only has 600.
  try {
    const vr = k ? d[k].visibleTimeRange() : null;
    out.visible = vr ? { from: String(vr.from), to: String(vr.to) } : null;
  } catch (e) { out.visible = 'err:' + e.name; }
  try {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('uct_bars_v1');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const v = await new Promise((res, rej) => {
      const t = db.transaction('bars','readonly').objectStore('bars').get('QQQ_D');
      t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error);
    });
    db.close();
    const b = v && v.bars;
    out.idb = b && b.length
      ? { n: b.length, first: String(b[0].t), last: String(b[b.length-1].t),
          lastT: String(v.lastT), savedAt: v.savedAt }
      : null;
  } catch (e) { out.idb = 'err:' + e.name; }
  out.fetches = (window.__probe && window.__probe.fetches) || [];
  return out;
})()
"""


def snap(page, label):
    s = page.evaluate(SNAP_JS)
    r, i = s.get("rendered"), s.get("idb")
    hist = [f for f in s["fetches"] if "bars-history" in f["path"]]
    prim = [f for f in s["fetches"] if f["path"].startswith("/api/bars/")]
    print(f"  [{label}]", flush=True)
    print(f"      rendered: {r}", flush=True)
    print(f"      VISIBLE : {s.get('visible')}", flush=True)
    print(f"      idb     : {i}", flush=True)
    print(f"      primary reqs: {[(f['nbars'], f['status'], f['rows']) for f in prim]}", flush=True)
    print(f"      history reqs: {[(f['nbars'], f['status'], f['rows']) for f in hist]}", flush=True)
    return {"label": label, **s}


def click_range(page, text):
    """Click a lookback pill by its visible label (3M/6M/YTD/1Y/5Y/Origin)."""
    try:
        el = page.query_selector(f"text=\"{text}\"")
        if not el:
            return False
        el.click()
        return True
    except Exception:                                   # noqa: BLE001
        return False


def main():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]
    print(f"[daily] dev server on :{port}", flush=True)
    print(f"[daily] fixture: FULL={len(FULL)} rows {FULL[0]['t']}..{FULL[-1]['t']}  "
          f"SEALED={len(SEALED)} ends {SEALED[-1]['t']}  primary depth={PRIMARY_ROWS}", flush=True)
    proc = start_dev_server(port)
    steps = []
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctx = browser.new_context(viewport={"width": 1500, "height": 900})
            ctx.add_init_script(CLOCK_JS % int(FAKE_NOW.timestamp() * 1000))
            ctx.add_init_script(PROBE_JS)
            fixture = Fixture()
            ctx.route("**/api/**", daily_router(fixture))
            page = ctx.new_page()
            base = f"http://127.0.0.1:{port}"

            # ── COLD: no usable daily cache for this fixture ──
            page.goto(f"{base}/scan-harness.html?blank=1", wait_until="domcontentloaded")
            page.evaluate(CLEAR_IDB)
            page.goto(f"{base}/scan-harness.html?tf=D&syms={SYM}", wait_until="domcontentloaded")
            print("[daily] COLD LOAD (tf=D):", flush=True)
            for wait, label in ((1500, "t+1.5s"), (3000, "t+4.5s"), (4000, "t+8.5s")):
                page.wait_for_timeout(wait)
                steps.append(snap(page, label))

            # ── WARM + STALE TAIL: the case the cold run cannot create ──
            # ⛔⛔ THE CONDITION THAT MATTERS IN PRODUCTION. A member who has ever
            # loaded this chart already holds a DEEP daily cache, and
            # `_histFirstPaint` requires `!_idbAlreadyDeep` -- so the automatic leg
            # that just rescued the cold run CANNOT re-fire for them. If the
            # selector then refuses that deep cache because its TAIL needs repair
            # (`_splitDeepPaintable = _splitDeepUsable && !idbStaleDaily`), depth and
            # tail-freshness are conflated and 20 years collapse to the 600-row
            # primary. Seed exactly that: deep rows, tail several sessions stale.
            print("[daily] WARM + STALE TAIL (deep cache, tail 5 sessions old):", flush=True)
            page.goto(f"{base}/scan-harness.html?blank=1", wait_until="domcontentloaded")
            page.evaluate(CLEAR_IDB)
            stale_deep = FULL[:-5]                      # deep, but ends 5 sessions ago
            page.evaluate(SEED_JS, [SYM, "D", stale_deep, CACHE_LOGIC_VERSION])
            page.goto(f"{base}/scan-harness.html?tf=D&syms={SYM}", wait_until="domcontentloaded")
            print(f"      seeded idb: {len(stale_deep)} rows ending {stale_deep[-1]['t']}", flush=True)
            for wait, label in ((2000, "warm t+2s"), (4000, "warm t+6s")):
                page.wait_for_timeout(wait)
                steps.append(snap(page, label))
            print("[daily] click Origin (warm):", flush=True)
            print(f"      clicked={click_range(page, 'Origin')}", flush=True)
            page.wait_for_timeout(3500)
            steps.append(snap(page, "warm after Origin"))

            # ── ORIGIN CLICKED EARLY: before the deep leg can land ──
            # ⛔ EVERY EARLIER RUN CLICKED ORIGIN AFTER THE DEEP SET HAD MERGED, so
            # every earlier run passed. `applyRange('origin')` short-circuits on
            # `deepLoaded = barCount === _fullTarget && ...`, and `_deepFirstPaint`
            # forces `barCount === _fullTarget` on ANY standalone daily chart -- so
            # that test is true from the first frame, `startNavLoad` never runs, and
            # Origin centres on whatever happens to be loaded AT THAT INSTANT.
            print("[daily] ORIGIN CLICKED EARLY (cold, ~400ms, before deep merge):", flush=True)
            page.goto(f"{base}/scan-harness.html?blank=1", wait_until="domcontentloaded")
            page.evaluate(CLEAR_IDB)
            page.goto(f"{base}/scan-harness.html?tf=D&syms={SYM}", wait_until="domcontentloaded")
            page.wait_for_timeout(400)
            steps.append(snap(page, "early t+0.4s (pre-click)"))
            print(f"      clicked Origin={click_range(page, 'Origin')}", flush=True)
            page.wait_for_timeout(1200)
            steps.append(snap(page, "early +1.2s after Origin"))
            page.wait_for_timeout(5000)
            steps.append(snap(page, "early +6s after Origin"))

            # ── ORIGIN ──
            print("[daily] click Origin:", flush=True)
            ok = click_range(page, "Origin")
            print(f"      clicked={ok}", flush=True)
            page.wait_for_timeout(4000)
            steps.append(snap(page, "after Origin"))

            # ── 5Y ──
            print("[daily] click 5Y:", flush=True)
            ok5 = click_range(page, "5Y")
            print(f"      clicked={ok5}", flush=True)
            page.wait_for_timeout(3000)
            steps.append(snap(page, "after 5Y"))
            browser.close()
    finally:
        try: proc.terminate()
        except Exception: pass                          # noqa: BLE001

    dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), "daily_history_trace_out.json")
    with open(dst, "w", encoding="utf-8") as f:
        json.dump({"fixture": {"full": len(FULL), "sealed": len(SEALED),
                               "origin": FULL[0]["t"], "today": FULL[-1]["t"]},
                   "steps": steps}, f, indent=2, default=str)
    print(f"\n[daily] wrote {dst}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
