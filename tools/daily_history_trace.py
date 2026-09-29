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


def _bar(d, i):
    px = round(100.0 + (i % 997) / 40.0, 2)
    return {"t": d.isoformat(), "o": px, "h": round(px + 1, 2),
            "l": round(px - 1, 2), "c": round(px + 0.5, 2), "v": 1000 + i}


# ⛔⛔ THE CLOCK IS AN INPUT (2026-09-28). Every run of this file used to happen at ONE
# instant, FAKE_NOW = Tue 13:17 ET, inside RTH. The regression it then failed to see --
# from the bell until midnight ET the post-server render arm refused the deep set and
# drew the 600-row tail -- exists ONLY after the close, so an RTH-only trace passed it
# (d2e08e04b was accepted on exactly that). Each clock gets its OWN fixtures: the
# server's frontier and sealed set move with the clock, and a pre-open or weekend run
# must not be served a bar dated today.
CLOCKS = {
    "RTH": FAKE_NOW,                                                    # Tue 13:17 ET
    "POST": FAKE_NOW.replace(hour=19, minute=30),                       # Tue 19:30 ET, after the bell
    "NIGHT": FAKE_NOW.replace(hour=23, minute=30),                      # Tue 23:30 ET, same ET day
    "PRE": (FAKE_NOW + timedelta(days=1)).replace(hour=8, minute=0),    # Wed 08:00 ET
    "SAT": (FAKE_NOW + timedelta(days=4)).replace(hour=12, minute=0),   # Sat 12:00 ET
}


def _fixtures_for(now):
    """(FULL, SEALED, frontier) as production would serve them at `now` (ET)."""
    d, mins = now.date(), now.hour * 60 + now.minute
    if d.weekday() < 5 and mins >= 570:        # a session has opened today
        frontier = d
    else:                                      # pre-open or weekend: the previous session
        frontier = d - timedelta(days=1)
        while frontier.weekday() >= 5:
            frontier -= timedelta(days=1)
    full = [_bar(x, i) for i, x in enumerate(_sessions(ORIGIN, frontier))]
    # Sealed = every session strictly before today's calendar date: production's
    # `last_sealed` is yesterday all through today, after the bell included.
    sealed = [b for b in full if b["t"] < d.isoformat()]
    return full, sealed, frontier


FULL, SEALED, TODAY = _fixtures_for(FAKE_NOW)


def set_clock(now):
    global FULL, SEALED, TODAY
    FULL, SEALED, TODAY = _fixtures_for(now)


# ⛔⛔ THE RACE HAS TO BE CONTROLLABLE OR THE HARNESS ONLY EVER PROVES THE HAPPY
# PATH. The first cut served the deep set instantly from localhost, so it landed
# before any click and EVERY scenario passed -- including the one that is broken
# in production. Deep history in the real world is a CDN round trip that can be
# slow, can fail, and can lose a race with a member's click.
CTL = {"hist_delay_ms": 0, "hist_fail_times": 0, "hist_calls": 0, "primary_calls": 0}


def daily_router(fixture):
    """Daily-aware routes; everything else falls through to the shared fixture."""
    base = route_handler(fixture)

    def handle(route, request):
        url = request.url
        if "/api/bars-history/" in url:
            import time as _t
            CTL["hist_calls"] += 1
            if CTL["hist_fail_times"] > 0:
                CTL["hist_fail_times"] -= 1
                route.fulfill(status=500, content_type="application/json",
                              body=json.dumps({"error": "deep history unavailable"}))
                return
            if CTL["hist_delay_ms"]:
                _t.sleep(CTL["hist_delay_ms"] / 1000.0)
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
            CTL["primary_calls"] += 1
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


def scenario(page, base, name, *, delay_ms=0, fail_times=0, click=None,
             click_at_ms=400, seed=None, settle_ms=9000, compare=None, followup=False):
    """One deterministic race. `click` fires at `click_at_ms` -- BEFORE the deep
    leg can land when `delay_ms` exceeds it, which is the production shape."""
    CTL.update(hist_delay_ms=delay_ms, hist_fail_times=fail_times,
               hist_calls=0, primary_calls=0)
    page.goto(f"{base}/scan-harness.html?blank=1", wait_until="domcontentloaded")
    page.evaluate(CLEAR_IDB)
    # ⛔⛔ CLEARING IDB IS NOT CLEARING STATE. All 8 scenarios share ONE page, and
    # /charts view-lock persistence writes the framing to localStorage, where it
    # survives the reload -- so a deep window framed by an EARLIER scenario can be
    # the window a LATER one is scored on, and a scenario that never re-framed at
    # all would still pass. Caught because S5b, which does not click, reported
    # S4's 5Y bounds to the digit while S1/S2 reported the 6-month default.
    page.evaluate("() => { try { localStorage.clear(); sessionStorage.clear() } "
                  "catch (e) {} }")
    if seed:
        page.evaluate(SEED_JS, [SYM, "D", seed, CACHE_LOGIC_VERSION])
    page.evaluate("() => { try { window.__probe.fetches.length = 0 } catch (e) {} }")
    page.goto(f"{base}/scan-harness.html?tf=D&syms={SYM}"
              + (f"&compare={compare}" if compare else ""), wait_until="domcontentloaded")
    clicked = None
    if click:
        page.wait_for_timeout(click_at_ms)
        pre = page.evaluate(SNAP_JS)
        clicked = click_range(page, click)
        pre_rendered = pre.get("rendered")
    else:
        pre_rendered = None
    page.wait_for_timeout(settle_ms)
    fin = page.evaluate(SNAP_JS)
    r, v = fin.get("rendered"), fin.get("visible")
    ok = bool(r and r.get("first") == FULL[0]["t"])
    view_ok = True
    if click == "Origin":
        view_ok = bool(v and str(v.get("from")) <= "2007-01-01")
    elif click == "5Y":
        # five years back from the fixture's today
        five = (TODAY - timedelta(days=365 * 5)).isoformat()
        view_ok = bool(v and str(v.get("from")) <= five)
    verdict = "PASS" if (ok and view_ok) else "FAIL"
    # ⚠️ FOLLOW-UP rows describe a KNOWN, separately-tracked defect (a shallow cache
    # grown past 600 rows reads as "deep" to `_idbAlreadyDeep` and Origin's loaded-row
    # test; with an overlay the dwell-warm is skipped, so nothing else fetches the deep
    # leg). They are measured and printed, never counted toward this file's verdict.
    if followup:
        verdict = "F-" + verdict
    print(f"  {name:<44} {verdict:<6} series={r and r['n']} earliest={r and r['first']} "
          f"visible={v and v['from']}..{v and v['to']} histCalls={CTL['hist_calls']}", flush=True)
    return {"scenario": name, "verdict": verdict, "delay_ms": delay_ms,
            "fail_times": fail_times, "click": click, "clicked": clicked,
            "preClickRendered": pre_rendered, "rendered": r, "visible": v,
            "histCalls": CTL["hist_calls"], "seriesDeep": ok, "viewOk": view_ok,
            "compare": compare, "followup": followup}


def _run_clock(browser, base, cname, now):
    """Every scenario at one wall-clock instant, on that instant's fixtures."""
    set_clock(now)
    ctx = browser.new_context(viewport={"width": 1500, "height": 900})
    ctx.add_init_script(CLOCK_JS % int(now.timestamp() * 1000))
    ctx.add_init_script(PROBE_JS)
    ctx.route("**/api/**", daily_router(Fixture()))
    page = ctx.new_page()
    print(f"[daily] CLOCK {cname} {now.isoformat()}  FULL={len(FULL)} "
          f"{FULL[0]['t']}..{FULL[-1]['t']}  SEALED ends {SEALED[-1]['t']}", flush=True)
    # A shallow cache grown past the first-paint depth: a 600-bar tail written one
    # session back plus the session merged since -- 601 rows, production's shape.
    shallow601 = FULL[-(PRIMARY_ROWS + 1):]
    rows = [
        scenario(page, base, "S1 immediate deep, no click"),
        scenario(page, base, "S2 deep delayed 4s, no click", delay_ms=4000),
        scenario(page, base, "S3 Origin BEFORE deep (4s delay)", delay_ms=4000, click="Origin"),
        scenario(page, base, "S4 5Y BEFORE deep (4s delay)", delay_ms=4000, click="5Y"),
        # ⚠️ 25s SETTLE, NOT 9s. `barsSwrOnErrorRetry` retries 5xx on a 15s FLOOR.
        scenario(page, base, "S5 first deep FAILS, retry (25s)",
                 fail_times=1, click="Origin", settle_ms=25000),
        scenario(page, base, "S5b deep FAILS, no click (25s)", fail_times=1, settle_ms=25000),
        scenario(page, base, "S6 warm deep cache", seed=FULL[:-1], click="Origin"),
        scenario(page, base, "S7 warm deep + stale tail", seed=FULL[:-5], click="Origin"),
        scenario(page, base, "S8 shallow 601-row cache, no click", seed=shallow601),
        scenario(page, base, "S9 shallow 601-row cache + Origin", seed=shallow601, click="Origin"),
        scenario(page, base, "S10 overlay, cold, no click", compare="SPY"),
        scenario(page, base, "S11 overlay + shallow 601, no click",
                 seed=shallow601, compare="SPY", followup=True),
        scenario(page, base, "S12 overlay + shallow 601 + Origin",
                 seed=shallow601, compare="SPY", click="Origin", followup=True),
    ]
    ctx.close()
    for r in rows:
        r["clock"] = cname
    return rows


def main(argv=None):
    """`python tools/daily_history_trace.py [RTH POST NIGHT PRE SAT]` -- every clock by default."""
    argv = sys.argv[1:] if argv is None else argv
    clocks = [c for c in (argv or list(CLOCKS)) if c in CLOCKS]
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]
    print(f"[daily] dev server on :{port}  clocks={clocks}", flush=True)
    proc = start_dev_server(port)
    out = []
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            base = f"http://127.0.0.1:{port}"
            for cname in clocks:
                out.extend(_run_clock(browser, base, cname, CLOCKS[cname]))
            browser.close()
    finally:
        try: proc.terminate()
        except Exception: pass                          # noqa: BLE001

    dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), "daily_history_trace_out.json")
    with open(dst, "w", encoding="utf-8") as f:
        json.dump({"clocks": {c: CLOCKS[c].isoformat() for c in clocks}, "scenarios": out},
                  f, indent=2, default=str)
    scored = [r for r in out if not r.get("followup")]
    bad = [r for r in scored if r["verdict"] != "PASS"]
    fu = [r for r in out if r.get("followup")]
    print("", flush=True)
    print(f"[daily] {len(scored) - len(bad)}/{len(scored)} PASS" +
          (f"  FAILING: {[(r['clock'], r['scenario']) for r in bad]}" if bad else ""), flush=True)
    print(f"[daily] follow-up rows (not scored): "
          f"{[(r['clock'], r['scenario'], r['verdict']) for r in fu]}", flush=True)
    print(f"[daily] wrote {dst}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
