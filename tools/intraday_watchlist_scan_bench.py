r"""Watchlist SCAN benchmark on the real /charts page (W-L, 2026-11-11) -- no backend.

Serves a built `app/dist` plus a THREADED mock `/api/**` whose per-request latency is drawn
from a production keep-alive probe of the S&P 100 on 5m (full p50 71 ms / p90 85 ms with
~1.5% 0.5-0.6 s edge stalls; `since=` p50 62 ms). It mocks a member session and one user
list (the prebuilt S&P 100 tickers), opens that list in the workspace Watchlist widget,
clicks the chart's 5m (optionally EXTENDED HOURS), then presses ArrowDown through every row.

Per switch it reports keypress -> first non-context frame whose tail is current
(StockChart's `__uctFrameLog`), and StockChart's own rows (`__uctChartTiming`:
first paint current? / T0->TC). NOTE: T0 is the chart's own load start, which comes AFTER
the symbol handoff, so keypress-based numbers are the product metric.

Arms: COLD (no IDB), BEHIND (IDB 2 h behind the clock), CURRENT (IDB at the clock).
`jump_min` advances browser + mock-server clocks between the list opening and the scan --
a list opened long before the member scans it (its prewarm has aged past the paint rule).

Usage:
  python tools/intraday_watchlist_scan_bench.py <dist> <label> <COLD|BEHIND|CURRENT> <cadence_ms>
      [rth|eth] ["YYYY-mm-dd HH:MM" ET clock] [jump_min]
"""
from __future__ import annotations

import collections
import json
import os
import random
import re
import sys
import threading
import time
import zlib
from datetime import datetime, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from zoneinfo import ZoneInfo

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from intraday_tail_harness import (  # noqa: E402
    CLOCK_JS, SEED_JS, CACHE_LOGIC_VERSION, FAKE_NOW, free_port, make_bars,
)

ET = ZoneInfo("America/New_York")
# HONAV (a when-issued symbol with no bars on production) is skipped: it never paints.
SP100 = [t for t in next(
    l for l in json.load(open(os.path.join(ROOT, "api", "data", "prebuilt_lists.json"), encoding="utf-8"))
    if l["name"] == "S&P 100")["tickers"] if t != "HONAV"]

LOG: list[dict] = []
CLK = {"fake": FAKE_NOW, "t0": time.time()}
_cnt: collections.Counter = collections.Counter()


def server_now():
    return CLK["fake"] + timedelta(seconds=time.time() - CLK["t0"])


def latency_ms(sym: str, since) -> float:
    """Deterministic per (sym, kind, nth request) draw from the production-measured shape."""
    k = (sym, since is not None)
    _cnt[k] += 1
    r = random.Random(zlib.crc32(f"{sym}|{k[1]}|{_cnt[k]}".encode()))
    if since:
        return 200 if r.random() < 0.01 else max(40, r.gauss(62, 6))
    return r.uniform(480, 620) if r.random() < 0.015 else max(50, r.gauss(72, 8))


def handler_for(dist):
    class H(SimpleHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def __init__(self, *a, **k):
            super().__init__(*a, directory=dist, **k)

        def log_message(self, *a):
            pass

        def _send(self, obj, status=200):
            b = json.dumps(obj).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)

        def do_GET(self):
            path, _, q = self.path.partition("?")
            qs = dict(re.findall(r"([^=&]+)=([^&]*)", q))
            if path.startswith("/api/"):
                return self.api(path, qs)
            if not os.path.isfile(os.path.join(dist, path.lstrip("/"))):
                self.path = "/index.html"
            return SimpleHTTPRequestHandler.do_GET(self)

        def do_POST(self):
            self.rfile.read(int(self.headers.get("Content-Length") or 0))
            return self._send({})
        do_PUT = do_POST

        def api(self, path, qs):
            m = re.match(r"/api/bars/([^/]+)$", path)
            if m:
                sym, tf, since = m.group(1).upper(), qs.get("tf", "D"), qs.get("since")
                t0 = time.time()
                time.sleep(latency_ms(sym, since) / 1000.0)
                if not tf.isdigit():
                    return self._send({"ticker": sym, "tf": tf, "bars": []})
                allb = make_bars(int(tf), server_now(), 12)
                if since:
                    body = {"ticker": sym, "tf": tf, "bars": [b for b in allb if b["t"] > int(since)], "delta": True}
                else:
                    body = {"ticker": sym, "tf": tf, "bars": allb[-int(qs.get("bars", "600")):]}
                body["tail_status"] = "current"
                LOG.append({"sym": sym, "tf": tf, "since": bool(since), "warm": qs.get("warm") == "1",
                            "ms": (time.time() - t0) * 1000})
                return self._send(body)
            if "/api/auth/me" in path:
                return self._send({"user": {"email": "harness@local", "role": "admin", "id": 1, "name": "H"}, "plan": "pro"})
            if path == "/api/watchlists":
                return self._send([{"id": 7, "name": "S&P 100", "user_id": 1, "is_public": False, "description": "",
                                    "items": [{"id": 1000 + i, "watchlist_id": 7, "sym": s, "notes": "", "position": i}
                                              for i, s in enumerate(SP100)]}])
            if path.startswith("/api/watchlists"):
                return self._send([])
            return self._send({})
    return H


CLOCK_MUTABLE_JS = (CLOCK_JS.replace("const OFFSET = %d - Date.now();", "window.__fakeOff = %d - Date.now();")
                    .replace("RealDate.now() + OFFSET", "RealDate.now() + window.__fakeOff"))
KEYLOG_JS = ("() => { window.__keyLog = []; window.addEventListener('keydown', e => { "
             "if (e.key === 'ArrowDown') window.__keyLog.push(Math.round(performance.now())) }, true) }")


def _q(v, p):
    return v[min(len(v) - 1, int(p * len(v)))] if v else None


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    dist, label, arm, cad = argv[0], argv[1], argv[2], int(argv[3])
    sess = argv[4] if len(argv) > 4 else "rth"
    fake = (datetime.strptime(argv[5], "%Y-%m-%d %H:%M").replace(tzinfo=ET) if len(argv) > 5
            else datetime(2026, 11, 11, 10, 12, tzinfo=ET))
    jump_min = int(argv[6]) if len(argv) > 6 else 0
    CLK["fake"] = fake
    LOG.clear()
    _cnt.clear()
    port = free_port()
    httpd = ThreadingHTTPServer(("127.0.0.1", port), handler_for(dist))
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}"
    errs = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 1600, "height": 900})
        ctx.add_init_script(CLOCK_MUTABLE_JS % int(fake.timestamp() * 1000))
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errs.append(str(e)[:300]))
        pg.goto(f"{base}/blank.html", wait_until="domcontentloaded")
        pg.evaluate("() => { localStorage.setItem('uct.chartTiming','1'); localStorage.setItem('barspack.version','2026-11-10') }")
        if arm != "COLD":
            tail = fake - timedelta(hours=2) if arm == "BEHIND" else fake
            for s in SP100:
                pg.evaluate(SEED_JS, [s, "5", make_bars(5, tail, 12), CACHE_LOGIC_VERSION])
        CLK["t0"] = time.time()
        pg.goto(f"{base}/charts", wait_until="domcontentloaded")
        pg.wait_for_selector("text=S&P 100", timeout=30000)
        pg.wait_for_timeout(1500)
        pg.get_by_role("button", name="5m", exact=True).first.click()
        if sess == "eth":
            pg.get_by_text(re.compile(r"^extended hours$", re.I)).first.click()
        pg.wait_for_timeout(800)
        pg.get_by_text("S&P 100", exact=True).first.click()
        pg.wait_for_selector(f'[data-watch-sym="{SP100[0]}"]', timeout=15000, state="attached")
        pg.wait_for_timeout(3000)                  # the member looks at the list for a moment
        if jump_min:
            pg.wait_for_timeout(4000)              # let the list-open prewarm settle, then age it
            pg.evaluate(f"() => {{ window.__fakeOff += {jump_min} * 60000 }}")
            CLK["t0"] -= jump_min * 60
        pg.locator(f'[data-watch-sym="{SP100[0]}"]').first.click()
        pg.wait_for_timeout(1500)
        pg.evaluate(KEYLOG_JS)
        pg.evaluate("() => { window.__uctChartTiming && window.__uctChartTiming.clear(); window.__uctFrameLog = [] }")
        n0 = len(LOG)
        for _ in range(1, len(SP100)):
            pg.keyboard.press("ArrowDown")
            pg.wait_for_timeout(cad)
        pg.wait_for_timeout(2500)
        frames = pg.evaluate("() => window.__uctFrameLog || []")
        keys = pg.evaluate("() => window.__keyLog")
        rows = pg.evaluate("() => window.__uctChartTiming ? window.__uctChartTiming.report() : []")
        ctx.close()
        b.close()
    httpd.shutdown()
    res = []
    for i, k in enumerate(keys):
        sym = SP100[i + 1]
        fr = [f for f in frames if f["sym"] == sym and f["at"] >= k]
        cur = [f for f in fr if f["current"] and not f.get("context")]
        res.append({"sym": sym, "k2cur": (cur[0]["at"] - k) if cur else None})
    v = sorted(r["k2cur"] for r in res if r["k2cur"] is not None)
    reqs = LOG[n0:]
    out = {
        "label": label, "arm": arm, "sess": sess, "cadence_ms": cad, "clock": f"{fake:%H:%M}", "jump_min": jump_min,
        "switches": len(res),
        "key2current_p50": _q(v, .5), "p90": _q(v, .9), "max": v[-1] if v else None,
        "gt100": sum(x > 100 for x in v), "gt300": sum(x > 300 for x in v),
        "neverCurrent": sum(r["k2cur"] is None for r in res),
        # StockChart's own verdict on the RTH/ETH-filtered tail it painted first.
        "firstPaintNotCurrent": sum(1 for r in rows if r.get("paintWasCurrent") is False),
        "req_total": len(reqs),
        "req_5m_full": sum(1 for r in reqs if r["tf"] == "5" and not r["since"]),
        "req_5m_since": sum(1 for r in reqs if r["tf"] == "5" and r["since"]),
        "req_other_tf": sum(1 for r in reqs if r["tf"] != "5"),
        "pageErrors": len(errs),
    }
    print(json.dumps(out))
    return out


if __name__ == "__main__":
    main()
