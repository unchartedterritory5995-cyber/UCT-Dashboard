r"""DAILY type-to-search benchmark — Enter -> the new symbol's daily candles painted.

The owner's report (2026-11-11): on the web /charts, typing a ticker and pressing Enter
on a DAILY chart sometimes lags ~0.5 s before the chart shows, even for liquid names.
This drives exactly that member path in a real browser — the /charts workspace, the
chart pane focused, letters typed into type-to-search, Enter — against a built
`app/dist` with every `/api/**` route-mocked (no backend, no /data, no cookie), and
reads the chart's own instrumentation to time Enter -> first candles of the new symbol.

Latencies are production-measured from this PC (2026-11-11, IPv4, 30 liquid names):
/api/bars?tf=D full 600 bars p50 ~165 ms; the whole-market today-pack is origin-served
(cookie => `cf-cache-status: BYPASS`), modelled at 250 ms.

Arms (each a fresh browser context):
  COLD         nothing cached for the scanned names
  PACK         IndexedDB holds the D/W/M pack entry (tail = the previous session) —
               what every member has for every liquid name — and the today-pack is
               FRESH (< 90 s old) when Enter lands
  PACK_PAUSED  as PACK, but the member paused > 90 s before typing (the today-pack has
               aged past its seed ceiling and refreshes only on the first keystroke)
  RECENT       IndexedDB holds a TODAY-dated entry saved 10 min ago (a name opened
               earlier in the session), today-pack paused as above

Usage:
  .venv\Scripts\python.exe tools\daily_type_search_bench.py <dist_dir> <label> [arms]
Prints one JSON line per arm: p50/p90/max of Enter->paint plus counts.
"""
from __future__ import annotations

import json
import os
import re
import sys
import threading
import time
from datetime import date, datetime, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from zoneinfo import ZoneInfo

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from intraday_tail_harness import CACHE_LOGIC_VERSION, free_port  # noqa: E402

ET = ZoneInfo("America/New_York")
#: Wed 2026-11-11 11:05 ET — mid-session (the owner's report window).
FAKE_NOW = datetime(2026, 11, 11, 11, 5, 0, tzinfo=ET)
FULL_MS = 165          # /api/bars?tf=D full (prod p50 from this PC)
TODAY_PACK_MS = 250    # /api/bars-today-pack (origin, uncached)
START = "SPY"
SCAN = ["AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA", "AMD", "AVGO", "NFLX",
        "PLTR", "SOFI", "INTC", "MU", "COIN"]

# Offset clock with a bump hook so an arm can age the today-pack past its 90 s
# ceiling without waiting 90 real seconds (timers keep running; only "now" moves).
CLOCK_JS = """
(() => {
  let OFFSET = %d - Date.now();
  const RealDate = Date;
  function FakeDate(...a) { return a.length ? new RealDate(...a) : new RealDate(RealDate.now() + OFFSET) }
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = () => RealDate.now() + OFFSET;
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;
  window.Date = FakeDate;
  window.__clockBump = (ms) => { OFFSET += ms };
  // Enter time, captured before any app handler runs.
  window.__enterAt = [];
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') window.__enterAt.push(performance.now());
  }, true);
})();
"""

SEED_D_JS = """
async ([sym, bars, savedAt, ver]) => {
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
    tx.objectStore('bars').put({ key: `${sym}_D`, bars, lastT: bars[bars.length - 1].t, savedAt, v: ver });
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
  db.close();
  return bars.length;
}
"""


def _sessions(upto: date, n: int):
    out, d = [], upto
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d -= timedelta(days=1)
    return list(reversed(out))


def _lvl(sym: str) -> float:
    return 50.0 + (sum(map(ord, sym)) % 200)


def daily_bars(sym: str, upto: date, n: int = 600):
    base = _lvl(sym)
    out = []
    for i, d in enumerate(_sessions(upto, n)):
        b = base + (i % 17) * 0.3
        out.append({"t": d.isoformat(), "o": round(b, 2), "h": round(b + 1.2, 2),
                    "l": round(b - 1.1, 2), "c": round(b + 0.4, 2), "v": 1_000_000 + i})
    return out


class Fixture:
    def __init__(self):
        self.requests = []

    def handle(self, route, request):
        url = request.url
        path = url.split("?", 1)[0]
        qs = dict(re.findall(r"[?&]([^=&]+)=([^&]*)", url))

        def send(obj, status=200, delay_ms=0):
            if delay_ms:
                time.sleep(delay_ms / 1000.0)
            route.fulfill(status=status, content_type="application/json", body=json.dumps(obj))

        m = re.search(r"/api/bars/([^/?]+)$", path)
        if m:
            sym = m.group(1).upper()
            tf = qs.get("tf", "D")
            self.requests.append({"sym": sym, "tf": tf, "warm": "warm" in qs, "at": time.time()})
            if tf in ("D", "W", "M"):
                bars = daily_bars(sym, FAKE_NOW.date(), int(qs.get("bars", "600")))
                if tf != "D":
                    bars = bars[-200:]
                return send({"ticker": sym, "tf": tf, "bars": bars}, delay_ms=FULL_MS)
            return send({"ticker": sym, "tf": tf, "bars": []}, delay_ms=FULL_MS)
        if path.endswith("/api/bars-today-pack"):
            self.requests.append({"sym": "*todaypack", "tf": "-", "warm": False, "at": time.time()})
            bars = {}
            for s in [START] + SCAN:
                b = _lvl(s) + (599 % 17) * 0.3
                bars[s] = [round(b, 2), round(b + 1.2, 2), round(b - 1.1, 2), round(b + 0.4, 2), 1_000_000]
            return send({"d": FAKE_NOW.date().isoformat(), "bars": bars}, delay_ms=TODAY_PACK_MS)
        if "/api/bars-history/" in path:
            return send({"ticker": "X", "tf": qs.get("tf", "D"), "bars": [], "sealed": True})
        if "/api/auth/me" in path:
            return send({"user": {"id": 1, "email": "bench@local", "role": "user", "name": "Bench"},
                         "plan": "pro"})
        if "/api/maintenance" in path:
            return send({"maintenance": False})
        if "/api/ticker-search" in path:
            q = (qs.get("q") or "").upper()
            return send({"results": [{"ticker": q, "name": q + " Inc", "type": "stock"}]}, delay_ms=170)
        if "/api/live-prices" in path:
            return send({})
        if path.endswith("/manifest"):
            return send({"available": False})
        return send({})


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
    return round(v[min(len(v) - 1, int(q * len(v)))]) if v else None


def run_arm(browser, base, arm, shots=None):
    fx = Fixture()
    ctx = browser.new_context(viewport={"width": 1400, "height": 860})
    ctx.add_init_script(CLOCK_JS % int(FAKE_NOW.timestamp() * 1000))
    ctx.route("**/api/**", fx.handle)
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)[:200]))
    page.goto(f"{base}/blank.html", wait_until="domcontentloaded")
    now_ms = int(FAKE_NOW.timestamp() * 1000)
    if arm != "COLD":
        prev = _sessions(FAKE_NOW.date() - timedelta(days=1), 1)[0]
        for s in [START] + SCAN:
            if arm == "RECENT":
                bars, saved = daily_bars(s, FAKE_NOW.date()), now_ms - 10 * 60_000
            else:
                bars, saved = daily_bars(s, prev), now_ms - 3 * 3600_000
            page.evaluate(SEED_D_JS, [s, bars, saved, CACHE_LOGIC_VERSION])
    page.evaluate("""() => { try {
        localStorage.setItem('uct.chartTiming','1');
        localStorage.setItem('barspack.version','2026-11-10');
        localStorage.setItem('intradaypack.version','2026-11-10');
        localStorage.setItem('breadthpack.version','x');
      } catch {} }""")
    page.goto(f"{base}/charts?sym={START}&tf=D", wait_until="domcontentloaded")
    region = page.locator('[role="region"][aria-label*="price chart"]').first
    region.wait_for(timeout=20000)
    page.wait_for_timeout(3000)
    rows_out = []
    for s in SCAN:
        if arm in ("PACK_PAUSED", "RECENT"):
            page.evaluate("() => window.__clockBump(100000)")   # the member paused > 90 s
        region.click(position={"x": 300, "y": 200})
        page.wait_for_timeout(60)
        page.evaluate("() => { window.__uctChartTiming.clear() }")
        for ch in s:
            page.keyboard.type(ch)
            page.wait_for_timeout(70)       # a fast typist: ~70 ms per key
        page.keyboard.press("Enter")
        page.wait_for_timeout(1500)
        r = page.evaluate("""(sym) => {
            const enter = window.__enterAt[window.__enterAt.length - 1];
            const rows = (window.__uctChartTiming.report() || []).filter(r => r.sym === sym);
            const row = rows[0];
            return { enter, row: row ? { t0: row.t0, paint: row['T0→paint'] } : null };
        }""", s)
        row = r.get("row") or {}
        if row.get("t0") is not None and row.get("paint") is not None:
            rows_out.append({"sym": s, "enterToT0": round(row["t0"] - r["enter"]),
                             "enterToPaint": round(row["t0"] + row["paint"] - r["enter"])})
        else:
            rows_out.append({"sym": s, "enterToT0": None, "enterToPaint": None})
        if shots:
            page.screenshot(path=os.path.join(shots, f"{arm}_{s}.png"))
    ctx.close()
    ep = [r["enterToPaint"] for r in rows_out]
    return {
        "arm": arm, "n": len(rows_out),
        "p50": _pct(ep, .5), "p90": _pct(ep, .9),
        "max": max([x for x in ep if x is not None], default=None),
        "noPaint": sum(1 for x in ep if x is None),
        "enterToT0_p50": _pct([r["enterToT0"] for r in rows_out], .5),
        "barsReqD": sum(1 for q in fx.requests if q["tf"] == "D" and not q["warm"]),
        "todayPackReq": sum(1 for q in fx.requests if q["sym"] == "*todaypack"),
        "pageErrors": len(errs),
        "rows": rows_out,
    }


def main():
    dist, label = sys.argv[1], sys.argv[2]
    arms = sys.argv[3].split(",") if len(sys.argv) > 3 else ["COLD", "PACK", "PACK_PAUSED", "RECENT"]
    shots = os.environ.get("BENCH_SHOTS") or None
    with open(os.path.join(dist, "blank.html"), "w", encoding="utf-8") as f:
        f.write("<!doctype html><title>blank</title>")
    port = free_port()
    httpd = ThreadingHTTPServer(("127.0.0.1", port), handler_for(dist))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}"
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            for arm in arms:
                r = run_arm(b, base, arm, shots)
                r["label"] = label
                rows = r.pop("rows")
                print(json.dumps(r))
                if os.environ.get("BENCH_ROWS"):
                    print(json.dumps(rows))
            b.close()
    finally:
        httpd.shutdown()


if __name__ == "__main__":
    main()
