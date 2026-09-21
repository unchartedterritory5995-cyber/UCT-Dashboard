"""Browser acceptance for the intraday session-tail architecture — fully isolated.

⛔⛔ WHY THIS EXISTS RATHER THAN A LOCAL BACKEND. The two obvious ways to put the
changed client in a browser both cross a line this repo has already paid for:

  1. Booting `api.main` resolves `/data` to the owner's LIVE `C:\\data`. The
     repo-root `conftest.py` says in its own words that an env override is NOT
     enough — 8 of the 55 `/data` literals have no override at all, and a daemon
     thread resolves paths after any `monkeypatch` has been undone. `C:\\data\\auth.db`
     reached 1.01 GB / 20,640 users that way.
  2. Proxying production needs the member's session cookie inside a local process.

So this harness has NO BACKEND AT ALL. Playwright route-mocks every `/api/**` call
with deterministic fixtures, and the page under test is `/r/chart` — which
`lib/renderToken.js` documents as open when `VITE_CHART_RENDER_TOKEN` is unset
("a local `npm run dev` build sets no token, and these pages must still open"),
so no auth, no cookie and no secret is involved. Nothing outside `app/dist` and
this file is read, and nothing at all is written.

⭐ AND THE FIXTURES ARE THE POINT, not a limitation. FRESH / BEHIND / GAPPED are
defined by the relationship between the cache tail and the clock, so driving both
deterministically is the only way to exercise all three on demand — on a Sunday
the real clock can only ever produce two of them.

Usage:  .venv\\Scripts\\python.exe tools\\intraday_tail_harness.py
"""
from __future__ import annotations

import json
import os
import re
import socket
import sys
import threading
import time
from datetime import datetime, timedelta
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from zoneinfo import ZoneInfo

from playwright.sync_api import sync_playwright

ET = ZoneInfo("America/New_York")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "app", "dist")

#: The clock the BROWSER believes. Tue 2026-09-15 13:17 ET — mid-session, and the
#: exact wall time from the bug report ("at 1 PM the chart ends around 10 AM").
FAKE_NOW = datetime(2026, 9, 15, 13, 17, 0, tzinfo=ET)

RTH_OPEN_MIN, RTH_CLOSE_MIN = 570, 960          # 09:30 / 16:00 ET
#: Must match `barsIDB.CACHE_LOGIC_VERSION` or every seeded record is ignored.
CACHE_LOGIC_VERSION = 7
EXT_OPEN_MIN, EXT_CLOSE_MIN = 240, 1200         # 04:00 / 20:00 ET


# ── fixture bars ─────────────────────────────────────────────────────────────
def _session_days(end: datetime, n: int):
    """The `n` most recent weekdays at/before `end`, oldest first."""
    days, d = [], end.date()
    while len(days) < n:
        if datetime(d.year, d.month, d.day).weekday() < 5:
            days.append(d)
        d -= timedelta(days=1)
    return list(reversed(days))


def make_bars(tf_min: int, upto: datetime, n_sessions: int = 40):
    """Deterministic extended-hours bars ending at `upto`.

    Extended hours are INCLUDED on purpose: the client filters to RTH after the
    fetch, and that filter is the whole reason the depth budget exists.
    """
    out = []
    for day in _session_days(upto, n_sessions):
        m = EXT_OPEN_MIN
        while m < EXT_CLOSE_MIN:
            t = datetime(day.year, day.month, day.day, m // 60, m % 60, tzinfo=ET)
            if t > upto:
                break
            ts = int(t.timestamp())
            base = 100.0 + (ts % 997) / 400.0          # stable, no randomness
            out.append({
                "t": ts,
                "o": round(base, 2),
                "h": round(base + 0.30, 2),
                "l": round(base - 0.25, 2),
                "c": round(base + 0.10, 2),
                "v": 1000 + (ts % 500),
            })
            m += tf_min
    return out


class Fixture:
    """Records every /api/bars request and answers it like bars-api would."""

    def __init__(self):
        self.requests = []          # {sym, tf, bars, since, returned, delta}
        self.server_now = FAKE_NOW

    def bars_response(self, sym, tf, want, since):
        tf_min = int(tf) if tf.isdigit() else 5
        all_bars = make_bars(tf_min, self.server_now)
        if since:
            # ⭐ The tail contract: EVERY row past the threshold, not just the
            # newest — which is what makes one small request carry the whole gap.
            rows = [b for b in all_bars if b["t"] > int(since)]
            body = {"ticker": sym, "tf": tf, "bars": rows, "delta": True}
        else:
            rows = all_bars[-want:]
            body = {"ticker": sym, "tf": tf, "bars": rows}
        self.requests.append({
            "sym": sym, "tf": tf, "bars": want,
            "since": int(since) if since else None,
            "returned": len(rows), "delta": bool(since),
        })
        return body


def route_handler(fixture: Fixture):
    def handle(route, request):
        url = request.url
        path = url.split("?", 1)[0]
        qs = dict(re.findall(r"[?&]([^=&]+)=([^&]*)", url))

        def send(obj, status=200):
            route.fulfill(status=status, content_type="application/json",
                          body=json.dumps(obj))

        m = re.search(r"/api/bars/([^/?]+)$", path)
        if m:
            return send(fixture.bars_response(
                m.group(1).upper(), qs.get("tf", "D"),
                int(qs.get("bars", "600")), qs.get("since") or None))
        if "/api/bars-history/" in path:
            return send({"ticker": "X", "tf": qs.get("tf", "D"), "bars": [], "sealed": True})
        if "/api/auth/me" in path:
            return send({"email": "harness@local", "plan": "pro", "role": "user"})
        if "/api/live-prices" in path:
            return send({})
        if "/api/r/chart-settings" in path:
            return send({})
        if "/api/ticker-meta" in path or "/api/ticker-logo" in path:
            return send({})
        return send({})                     # catch-all: never hit the network
    return handle


# ── static server for app/dist (SPA fallback) ────────────────────────────────
class SPAHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        p = self.path.split("?", 1)[0]
        target = os.path.join(DIST, p.lstrip("/"))
        if not os.path.isfile(target):
            self.path = "/index.html"       # SPA routes resolve to the shell
        return SimpleHTTPRequestHandler.do_GET(self)

    def log_message(self, *a):              # quiet
        pass


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


# ── the clock shim ───────────────────────────────────────────────────────────
# OFFSET, not freeze: SWR intervals, the catch-up poll and the watchdogs all need
# a clock that still advances. A frozen Date would deadlock the very timers this
# harness exists to observe.
CLOCK_JS = """
(() => {
  const OFFSET = %d - Date.now();
  const RealDate = Date;
  const shifted = () => new RealDate(RealDate.now() + OFFSET);
  function FakeDate(...a) { return a.length ? new RealDate(...a) : shifted() }
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = () => RealDate.now() + OFFSET;
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;
  window.Date = FakeDate;
})();
"""

SEED_JS = """
async ([sym, tf, bars, ver]) => {
  // ⛔ THE REAL SCHEMA, NOT AN ASSUMED ONE. `barsIDB` opens uct_bars_v1 at
  // DB_VERSION 2 with `createObjectStore('bars', { keyPath: 'key' })` — IN-LINE
  // keys — and stamps every record with CACHE_LOGIC_VERSION. A record written
  // with an out-of-line key, or a stale `v`, is silently ignored by idbGet, so the
  // seed would look successful while the app read nothing.
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('uct_bars_v1', 2);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (d.objectStoreNames.contains('bars')) d.deleteObjectStore('bars');
      d.createObjectStore('bars', { keyPath: 'key' });
    };
  });
  await new Promise((res, rej) => {
    const tx = db.transaction('bars', 'readwrite');
    tx.objectStore('bars').put({
      key: `${sym.toUpperCase()}_${tf}`,
      bars,
      lastT: bars[bars.length - 1].t,
      savedAt: Date.now(),
      v: ver,
    });
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
  db.close();
  return 'seeded:' + bars.length + ' lastT=' + bars[bars.length - 1].t;
}
"""


def run_case(page, fixture, name, sym, tf, cache_tail: datetime | None, base_url):
    """Seed a cache tail, load the chart, and report what the client asked for."""
    fixture.requests.clear()
    page.goto(f"{base_url}/blank.html", wait_until="domcontentloaded")
    seeded = "none"
    if cache_tail is not None:
        bars = make_bars(int(tf), cache_tail)
        seeded = page.evaluate(SEED_JS, [sym, tf, bars, CACHE_LOGIC_VERSION])
    page.evaluate("() => { try { localStorage.setItem('uct.chartTiming','1') } catch {} }")

    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}")
            if m.type == "error" else None)

    page.goto(f"{base_url}/r/chart?sym={sym}&tf={tf}&w=1200&h=620",
              wait_until="domcontentloaded")
    page.wait_for_timeout(4000)

    timing = page.evaluate("() => (window.__uctChartTiming ? window.__uctChartTiming.report() : [])")
    drawn = page.evaluate("() => window.__chartBarCount ?? null")
    return {
        "case": name, "sym": sym, "tf": tf, "seeded": seeded,
        "requests": list(fixture.requests), "timing": timing,
        "drawn": drawn, "errors": errors,
    }


def main():
    if not os.path.isfile(os.path.join(DIST, "index.html")):
        print("FAIL: app/dist not built. Run `npx vite build` in app/ first.")
        return 1
    # a tiny blank page so IDB can be seeded on the right origin before the SPA loads
    with open(os.path.join(DIST, "blank.html"), "w", encoding="utf-8") as f:
        f.write("<!doctype html><title>blank</title>")

    port = free_port()
    httpd = ThreadingHTTPServer(("127.0.0.1", port),
                                partial(SPAHandler, directory=DIST))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}"
    print(f"[harness] serving {DIST} at {base}")
    print(f"[harness] browser clock = {FAKE_NOW.isoformat()}  (no backend, no /data, no cookie)")

    fixture = Fixture()
    results = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(viewport={"width": 1280, "height": 760})
            ctx.add_init_script(CLOCK_JS % int(FAKE_NOW.timestamp() * 1000))
            ctx.route("**/api/**", route_handler(fixture))
            page = ctx.new_page()

            today = FAKE_NOW
            prior = FAKE_NOW - timedelta(days=4)        # previous Friday
            cases = [
                ("FRESH  (tail at the current bucket)", "AAPL", "5",
                 today.replace(hour=13, minute=10)),
                ("BEHIND (sound history, 3h short)", "AAPL", "5",
                 today.replace(hour=10, minute=0)),
                ("GAPPED (predates the last closed session)", "AAPL", "5",
                 prior.replace(hour=15, minute=55)),
                ("COLD   (no cache at all)", "NVDA", "5", None),
                ("BEHIND on 1h", "MSFT", "60", today.replace(hour=10, minute=0)),
            ]
            for name, sym, tf, tail in cases:
                r = run_case(page, fixture, name, sym, tf, tail, base)
                results.append(r)
                print(f"\n=== {name} — {sym} {tf}m ===")
                print(f"  seeded: {r['seeded']}")
                for q in r["requests"]:
                    kind = "TAIL since=" + str(q["since"]) if q["delta"] else f"FULL bars={q['bars']}"
                    print(f"  request: {kind}  -> {q['returned']} bars")
                for t in r["timing"]:
                    print(f"  timing: T1={t['T0→T1']} T2={t['T0→T2']} T3={t['T0→T3']} "
                          f"T4={t['T0→T4']} lag={t['freshnessLagSec']}s cache={t['cache']}")
                print(f"  drawn candles: {r['drawn']}")
                print(f"  errors: {r['errors'] or 'none'}")

            # rapid symbol + timeframe race
            # ⛔ IN-APP NAVIGATION, NOT page.goto. A full page load builds a NEW
            # component every time and so exercises no race at all; pushState keeps
            # the SPA alive and re-renders the SAME StockChart with new params,
            # which is what a member's symbol switch actually does.
            print("")
            print("=== RACE: rapid in-app symbol, then timeframe switching ===")
            NAV = ("(u) => { window.history.pushState({}, '', u); "
                   "window.dispatchEvent(new PopStateEvent('popstate')); }")
            CUR_SYM = "() => new URLSearchParams(location.search).get('sym')"
            CUR_TF = "() => new URLSearchParams(location.search).get('tf')"
            LAST_ROW = ("() => { const r = window.__uctChartTiming.report(); "
                        "return r[r.length - 1] || null }")
            DRAWN = "() => window.__chartBarCount ?? null"

            page.goto(f"{base}/r/chart?sym=AAPL&tf=5&w=1200&h=620", wait_until="domcontentloaded")
            page.wait_for_timeout(2500)

            fixture.requests.clear()
            for s in ["NVDA", "TSLA", "MSFT", "AAPL"]:
                page.evaluate(NAV, f"/r/chart?sym={s}&tf=5&w=1200&h=620")
                page.wait_for_timeout(160)          # overlap the in-flight requests
            page.wait_for_timeout(3500)
            asked = sorted({q["sym"] for q in fixture.requests})
            last = page.evaluate(LAST_ROW)
            print(f"  symbols requested during sweep: {asked}")
            print(f"  final URL symbol: {page.evaluate(CUR_SYM)}")
            print(f"  last timing row: sym={last and last['sym']} tf={last and last['tf']}")
            print(f"  final drawn candles: {page.evaluate(DRAWN)}")

            fixture.requests.clear()
            for tf in ["1", "5", "2", "60", "15", "30"]:
                page.evaluate(NAV, f"/r/chart?sym=AAPL&tf={tf}&w=1200&h=620")
                page.wait_for_timeout(160)
            page.wait_for_timeout(3500)
            asked_tf = sorted({q["tf"] for q in fixture.requests})
            last2 = page.evaluate(LAST_ROW)
            print(f"  timeframes requested during sweep: {asked_tf}")
            print(f"  final URL tf: {page.evaluate(CUR_TF)}")
            print(f"  last timing row: sym={last2 and last2['sym']} tf={last2 and last2['tf']}")
            print(f"  final drawn candles: {page.evaluate(DRAWN)}")
            browser.close()
    finally:
        httpd.shutdown()
        try:
            os.remove(os.path.join(DIST, "blank.html"))
        except OSError:
            pass

    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "intraday_tail_harness_out.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
    print(f"\n[harness] wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
