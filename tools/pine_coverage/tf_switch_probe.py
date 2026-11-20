"""Measure a member's timeframe SWITCH on /charts (1D -> 5m) with one Pine script attached, on the REAL page.

docs/pine/evidence/2026-11-19-host-lane-learned-route/EVIDENCE.md. The production case it reproduces
(2026-11-19, patrick-54's CDP trace): RDDT 1D -> 5m with Fred RS attached, 18 main-thread long tasks and
4.2 s of them, the worst 525 ms, against 7 / 1.6 s with no script. The question: how long does the main
thread stop for, and how much of it is the script's values, from the click to the settled 5m picture.

WHAT IS REAL: the production bundle (`npm run build`, served by a local sandboxed backend), the `/charts`
page, the member door (the same clicks `host_lane_browser_probe.py` makes: Chart settings -> Indicators ->
Create indicator -> Paste a script -> attach), StockChart, the binder, both lanes and both workers, and the
switch itself: a real click on the chart widget's `5m` button.

WHAT IS ANSWERED HERE, AT THE NETWORK (nothing reaches a market-data vendor, no production data is read):
  * the chart symbol (whatever the workspace holds) at D: the committed RDDT daily capture
    (`tests/fixtures/vendor/harness/rs-rating-fred6724-pc-rddt-1d-2026-11-17.json`, 668 sessions), ISO dates;
  * the chart symbol at 5: synthetic regular-session 5-minute bars (78 a session, America/New_York with its
    daylight saving), `--sessions` of them (360 by default: 28,080 rows, the production chart's 28,006);
  * SPX at 5: the same grid on the newest `--spx-sessions` (105: about 8,190 rows, so Fred RS's series is
    `na` before them, as on production); SPX at D: 700 synthetic sessions;
  * the Pine seed `SEED_FRED6725_RS_RATING:RSRATING`: 34 daily rows;
  * `/api/ticker-ipo/*` (the listing day) and `/api/ticker-meta/*` (SPX on `SP`, the chart symbol on NYSE).

THE PROBE: `host_lane_browser_probe.PROBE_JS` (long tasks, long animation frames, frame gaps, the legend chip),
the host lane's timeline (`host-lane:worker-run`), and a V8 CPU profile of the main thread from the click to
the settle (`<label>.switch.cpuprofile`, map it with `profile_by_source.mjs`).

    python tools/pine_coverage/tf_switch_probe.py --base http://127.0.0.1:8171 \
        --script docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine --label after-fred-1 --out <dir>
    python tools/pine_coverage/tf_switch_probe.py --base http://127.0.0.1:8171 --no-script --label control-1 --out <dir>

⛔ LOOPBACK ONLY: it signs in as a throwaway local account (`host_lane_browser_probe.sign_in`) and deletes
that account's scripts. A production run is a separate rig with the synthetic account.
Exit 0 measured, 1 the door refused or nothing drew, 2 inconclusive (rig not reachable).
"""
from __future__ import annotations

import argparse
import datetime
import json
import math
import pathlib
import sys
import time
import urllib.parse
from zoneinfo import ZoneInfo

REPO = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "tools"))
sys.path.insert(0, str(REPO / "tools" / "pine_coverage"))
import host_lane_browser_probe as hlp  # noqa: E402  (the same door, the same probe)

RDDT_D = REPO / "tests" / "fixtures" / "vendor" / "harness" / "rs-rating-fred6724-pc-rddt-1d-2026-11-17.json"
NY = ZoneInfo("America/New_York")
SEED = "SEED_FRED6725_RS_RATING:RSRATING"
LISTING_DAY = "2024-03-21"


def _sessions(n: int, end: str = "2026-11-18") -> list[datetime.date]:
    out = []
    d = datetime.date.fromisoformat(end)
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d -= datetime.timedelta(days=1)
    return out[::-1]


def five_minute(sessions: int, spx_sessions: int):
    """Regular-session 5-minute rows (unix seconds) for the chart symbol and for SPX."""
    chart, spx = [], []
    days = _sessions(sessions)
    for di, d in enumerate(days):
        open_ = datetime.datetime(d.year, d.month, d.day, 9, 30, tzinfo=NY)
        for k in range(78):
            t = int((open_ + datetime.timedelta(minutes=5 * k)).timestamp())
            i = len(chart)
            c = round(60 + 30 * math.sin(i / 700) + 5 * math.sin(i / 37) + i * 0.0008, 4)
            chart.append({"t": t, "o": round(c - 0.2, 4), "h": round(c + 0.5, 4), "l": round(c - 0.6, 4), "c": c,
                          "v": 10000 + (i % 97)})
            if di >= sessions - spx_sessions:
                s = round(6500 + 200 * math.sin(i / 900) + i * 0.01, 2)
                spx.append({"t": t, "o": s - 1, "h": s + 2, "l": s - 2, "c": s, "v": 1000000})
    return chart, spx


def daily_rows():
    cap = json.loads(RDDT_D.read_text(encoding="utf-8"))
    rows = cap["bars"]["rows"]
    own = [{"t": hlp._iso(t), "o": o, "h": h, "l": l, "c": c, "v": v} for t, o, h, l, c, v in rows]
    spx = [{"t": d.isoformat(), "o": 1, "h": 1, "l": 1, "c": round(5000 + i * 3 + 100 * math.sin(i / 30), 2), "v": 1}
           for i, d in enumerate(_sessions(700))]
    seed = [{"t": d.isoformat(), "o": 0, "h": 1000, "l": 0, "c": 300 - 7 * i, "v": 0}
            for i, d in enumerate(_sessions(35)[:-1])]
    return own, spx, seed


class SwitchServer:
    """Answers every bars request the switch makes, in the server's payload shapes."""

    def __init__(self, sessions: int, spx_sessions: int):
        self.own_d, self.spx_d, self.seed = daily_rows()
        self.own_5, self.spx_5 = five_minute(sessions, spx_sessions)
        self.log = []

    def series(self, sym: str, tf: str):
        if sym.startswith("SEED_"):
            return self.seed if tf in ("D", "1D") else []
        if sym == "SPX":
            return self.spx_d if tf in ("D", "1D") else (self.spx_5 if tf == "5" else [])
        return self.own_d if tf in ("D", "1D") else (self.own_5 if tf == "5" else [])

    def handle(self, route, request):
        url = urllib.parse.urlparse(request.url)
        q = urllib.parse.parse_qs(url.query)
        path = url.path
        sym = urllib.parse.unquote(path.rsplit("/", 1)[-1]).upper()
        if path.startswith("/api/ticker-ipo/"):
            return route.fulfill(json={"symbol": sym, "list_date": LISTING_DAY, "first_trade_date": LISTING_DAY,
                                       "first_trade_final": True})
        if path.startswith("/api/ticker-meta/"):
            ex = "SP" if sym == "SPX" else "NYSE"
            return route.fulfill(json={"symbol": sym, "exchange": ex, "industry": "Internet Software/Services",
                                       "sector": "Technology Services", "type": "stock"})
        tf = (q.get("tf") or ["D"])[0].upper()
        rows = self.series(sym, tf)
        self.log.append((time.time(), path.split("/")[2], f"{sym} {tf} bars={(q.get('bars') or [''])[0]}"))
        if not rows:
            return route.fulfill(json={"ticker": sym, "tf": tf, "bars": [], "no_data": True, "reason": "rig: D and 5 only"})
        n = int((q.get("bars") or ["200"])[0])
        since = (q.get("since") or [""])[0]
        if path.startswith("/api/bars-history/"):
            out = rows[:-1][-n:]
            return route.fulfill(json={"ticker": sym, "tf": tf, "bars": out, "sealed": True})
        if since:
            keep = rows[-1:]
            return route.fulfill(json={"ticker": sym, "tf": tf, "bars": keep, "delta": True})
        out = rows[-n:]
        return route.fulfill(json={"ticker": sym, "tf": tf, "bars": out, "newest_bar_is_forming": False,
                                   "tail_status": "verified", "verified_through": out[-1]["t"]})


def route_all(ctx, server):
    def wanted(url: str) -> bool:
        p = urllib.parse.urlparse(url).path
        if "/adjustment-basis" in p:
            return False
        return p.startswith(("/api/bars/", "/api/bars-history/", "/api/ticker-ipo/", "/api/ticker-meta/"))
    ctx.route(lambda url: wanted(url), server.handle)


CLICK_TF_JS = """(label) => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || x.textContent || '').trim() === label);
  if (!b) return false;
  const r = b.getBoundingClientRect();
  return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)];
}"""

MARK_JS = """() => { window.__probe.switchAt = performance.now(); return window.__probe.switchAt }"""


def tf_target(page, label):
    """Where to click for the `label` timeframe: its button on the bar, or (a bar too narrow to show it) the row in
    the "More timeframes" menu, which is opened first. Returns [x, y] or None."""
    xy = page.evaluate(CLICK_TF_JS, label)
    if xy:
        return xy
    more = page.evaluate(CLICK_TF_JS, "More timeframes")
    if not more:
        return None
    page.mouse.click(more[0], more[1])
    page.wait_for_timeout(600)
    return page.evaluate(CLICK_TF_JS, label)


#: ⭐ THE PRODUCTION DEPTH. The trace this reproduces drew Fred RS over 28,006 five-minute rows: the whole-depth
#: warm (`StockChart`'s dwell-warm, `fullBarsFor('5')` = 30,000) that runs when the intraday smooth switch is off
#: for the browser (`uct.intradaySmooth.enabled` = '0'). With it on (the default bucket), a 5m chart deepens by
#: left windows to `HISTORY_PREFETCH_TARGET_BARS` instead: `--depth window` measures that path.
DEEP_JS = "try { localStorage.setItem('uct.intradaySmooth.enabled', '0') } catch (e) {}"


def measure_switch(browser, base, storage, out_dir, label, title, server, to_tf, settle_s, deep=True):
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce", storage_state=storage)
    route_all(ctx, server)
    if deep:
        ctx.add_init_script(DEEP_JS)
    ctx.add_init_script(hlp.PROBE_JS + (f"\nwindow.__probe.title = {json.dumps(title)};" if title else ""))
    page = ctx.new_page()
    cdp = ctx.new_cdp_session(page)
    cdp.send("Profiler.enable")
    cdp.send("Profiler.setSamplingInterval", {"interval": 1000})
    page.goto(f"{base}/charts", wait_until="domcontentloaded")
    hlp.wait_for_workspace(page)
    # ── the daily chart, settled: the script's values drawn and five quiet seconds ──
    deadline = time.time() + 240
    while time.time() < deadline:
        page.wait_for_timeout(1000)
        p = page.evaluate("() => ({ d: window.__probe.firstDigit, now: performance.now(),"
                          " last: window.__probe.lt.length ? window.__probe.lt[window.__probe.lt.length-1] : null })")
        quiet = (p["now"] - (p["last"][0] + p["last"][1])) if p["last"] else p["now"]
        if (p["d"] is not None or not title) and quiet > 5000 and p["now"] > 15000:
            break
    daily_drawn = page.evaluate("() => window.__probe.firstDigit")
    # ── the switch: a real click on the timeframe button ──
    xy = tf_target(page, to_tf)
    if not xy:
        ctx.close()
        return {"label": label, "error": f"no `{to_tf}` button"}
    lt_before = page.evaluate("() => window.__probe.lt.length")
    gaps_before = page.evaluate("() => window.__probe.gaps.length")
    runs_before = len(page.evaluate(hlp.HOST_RUNS_JS))
    server.log.clear()
    cdp.send("Profiler.start")
    t_click = page.evaluate(MARK_JS)
    page.mouse.click(xy[0], xy[1])
    # settle: the 5m deep history asked for and answered, and `settle_s` quiet seconds with no long task
    deadline = time.time() + 300
    while time.time() < deadline:
        page.wait_for_timeout(1000)
        p = page.evaluate("() => ({ now: performance.now(),"
                          " last: window.__probe.lt.length ? window.__probe.lt[window.__probe.lt.length-1] : null })")
        quiet = (p["now"] - max(t_click, (p["last"][0] + p["last"][1]) if p["last"] else 0))
        deep = any(("bars=" in d and int(d.split("bars=")[1] or 0) >= 5000) for _, _k, d in server.log if " 5 " in d)
        if deep and quiet > settle_s * 1000 and p["now"] - t_click > 10000:
            break
        if quiet > 30000:   # no deep request: the switch settled on what it had
            break
    prof = cdp.send("Profiler.stop")["profile"]
    (out_dir / f"{label}.switch.cpuprofile").write_text(json.dumps(prof), encoding="utf-8")
    probe = page.evaluate("() => JSON.parse(JSON.stringify(window.__probe))")
    runs = page.evaluate(hlp.HOST_RUNS_JS)[runs_before:]
    page.screenshot(path=str(out_dir / f"{label}.png"))
    ctx.close()
    lt = [x for x in probe["lt"][lt_before:] if x[0] >= t_click - 5]
    gaps = [g for g in probe["gaps"][gaps_before:] if g[0] >= t_click - 5]
    loaf = [x for x in probe.get("loaf", []) if x[0] >= t_click - 5]
    return {"label": label, "toTf": to_tf, "depth": "full" if deep else "window", "dailyDrawnMs": daily_drawn, "clickAt": t_click,
            "longTasks": [[round(s - t_click), round(d)] for s, d in lt], "frameGaps": [[round(s - t_click), round(g)] for s, g in gaps],
            "loaf": [[round(x[0] - t_click), round(x[1]), round(x[2])] for x in loaf],
            "hostLaneRuns": [[round(r[0] - t_click), r[1], r[2]] for r in runs],
            "requests": [(k, d) for _t, k, d in server.log],
            "chips": probe.get("chips", [])[-3:]}


def summarise(res):
    lt = res.get("longTasks") or []
    return {"longTasks": len(lt), "longTaskMs": sum(d for _, d in lt), "maxLongTaskMs": max([d for _, d in lt] or [0]),
            "maxFrameGapMs": max([g for _, g in res.get("frameGaps") or []] or [0]),
            "hostLaneRuns": len(res.get("hostLaneRuns") or []),
            "deepValuesLandedMs": min([r[0] + r[1] for r in res.get("hostLaneRuns") or []
                                       if isinstance(r[2], dict) and r[2].get("kind") == "values" and (r[2].get("bars") or 0) >= 5000] or [None],
                                      key=lambda x: (x is None, x))}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--script")
    ap.add_argument("--no-script", action="store_true")
    ap.add_argument("--title", default=None)
    ap.add_argument("--label", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--email", default="tfswitch@local.dev")
    ap.add_argument("--password", default="TfSwitch2026!")
    ap.add_argument("--to", default="5m", help="the timeframe button to click")
    ap.add_argument("--sessions", type=int, default=360)
    ap.add_argument("--spx-sessions", type=int, default=105)
    ap.add_argument("--settle", type=float, default=8.0, help="quiet seconds that end the switch")
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--depth", choices=["full", "window"], default="full",
                    help="full: the whole-depth warm (production's 28,006 rows); window: the smooth switch's left windows")
    args = ap.parse_args()

    import synthetic_session  # noqa: PLC0415
    if not synthetic_session.is_loopback(args.base):
        print(f"[tf-switch] REFUSED: {args.base} is not a local sandbox (loopback only)")
        return 2
    from playwright.sync_api import sync_playwright
    out_dir = pathlib.Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    source = None
    title = None
    if not args.no_script:
        sp = pathlib.Path(args.script)
        source = (sp if sp.is_absolute() else REPO / sp).read_text(encoding="utf-8")
        import re
        m = re.search(r"""(?:indicator|study|strategy)\s*\(\s*(?:title\s*=\s*)?["']([^"']+)["']""", source)
        title = args.title or (m.group(1).strip() if m else None)
    server = SwitchServer(args.sessions, args.spx_sessions)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headed)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce")
        route_all(ctx, server)
        page = ctx.new_page()
        if not hlp.sign_in(page, args.base, args.email, args.password):
            print(f"[tf-switch] INCONCLUSIVE: sign-in failed at {args.base}")
            return 2
        defs = page.request.get(f"{args.base}/api/user-definitions").json().get("definitions", [])
        for d in defs:
            did = d.get("id") or (d.get("definition") or {}).get("id")
            if did:
                page.request.delete(f"{args.base}/api/user-definitions/{did}")
        installed = None
        if source is not None:
            installed = hlp.install(page, args.base, source)
            if not installed.get("ok"):
                print(f"[tf-switch] MEASURED FAILURE: {json.dumps(installed)[:600]}")
                return 1
        else:
            page.goto(f"{args.base}/charts", wait_until="domcontentloaded")
            hlp.wait_for_workspace(page)
            if not page.evaluate(hlp.ENSURE_CHART_JS).get("widgets"):
                print("[tf-switch] INCONCLUSIVE: no chart widget")
                return 2
            page.wait_for_timeout(5000)
        # the chart opens on 1D: put it there before the measured load (the workspace keeps the widget's tf)
        xy = tf_target(page, "1D")
        if xy:
            page.mouse.click(xy[0], xy[1])
            page.wait_for_timeout(4000)
        storage = ctx.storage_state()
        page.goto("about:blank")
        res = measure_switch(browser, args.base, {"cookies": storage["cookies"], "origins": []}, out_dir, args.label,
                             title, server, args.to, args.settle, deep=args.depth == "full")
        ctx.close()
        browser.close()
    res["installed"] = (installed or {}).get("defs")
    res["summary"] = summarise(res)
    (out_dir / f"{args.label}.json").write_text(json.dumps(res, indent=1), encoding="utf-8")
    print(json.dumps({"label": args.label, "summary": res["summary"], "installed": res["installed"]}, indent=1))
    return 0 if not res.get("error") else 1


if __name__ == "__main__":
    sys.exit(main())
