"""Browser rail: the newest candle stays LOCKED IN PLACE across symbol + timeframe switches.

Owner report (2026-11-11, live 12:08 ET, 5m): NVDA -> TZA moved the newest candle — NVDA's
sat well left of the price axis with empty future slots, TZA's sat at the axis. TC2000 keeps
the newest candle at the same x (constant right margin, constant bar spacing) on every
switch. This harness records the visible logical range on EVERY animation frame while it
switches symbols and timeframes in-app (pushState, the same StockChart instance — a member's
switch), and checks that in every frame with a drawn candle

    right margin  = visibleRange().to - newestIndex()     (bars)
    zoom width    = visibleRange().to - visibleRange().from

are identical. Symbols differ in history depth (bar counts differ, as NVDA's and TZA's do),
one symbol's SERVER answer is behind (the prod 'stale-swr' first answer), and one symbol
has a behind IndexedDB cache seeded before the run.

Same isolation as tools/intraday_tail_harness.py: no backend, every /api/** call is
route-mocked with synthetic bars, the page is /r/chart (open without a render token on a
local build). Nothing outside app/dist is read; nothing is written except the result JSON.

Usage:  (cd app && npx vite build) && .venv\\Scripts\\python.exe tools\\intraday_symswitch_framing_harness.py
Exit 0 = every frame identical; 1 = a frame moved (details printed: counts/indices only).
"""
from __future__ import annotations

import json
import os
import re
import sys
import threading
import time
from datetime import datetime
from functools import partial
from http.server import ThreadingHTTPServer

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from intraday_tail_harness import (  # noqa: E402  (same fixtures, same shims)
    CACHE_LOGIC_VERSION, CLOCK_JS, DIST, ET, SEED_JS, SPAHandler, free_port, make_bars,
)

#: The browser clock: Wed 2026-11-11 12:08 ET — the owner's report time (after the DST end).
FAKE_NOW = datetime(2026, 11, 11, 12, 8, 0, tzinfo=ET)
#: History depth per symbol (sessions) — different bar counts per symbol.
DEPTH = {"NVDA": 6, "TZA": 9, "AAPL": 4, "SOFI": 7}
#: SOFI's SERVER answer ends 1h40m ago (behind first answer).
STALE_SERVER = {"SOFI": FAKE_NOW.replace(hour=10, minute=25)}
#: AAPL has a behind IDB cache for 5m (the provisional paint path).
SEEDED_CACHE = {("AAPL", "5"): FAKE_NOW.replace(hour=11, minute=0)}

SEQUENCE = [  # (sym, tf) — symbol switches and timeframe switches interleaved
    ("NVDA", "5"), ("TZA", "5"), ("AAPL", "5"), ("SOFI", "5"), ("NVDA", "5"),
    ("NVDA", "15"), ("TZA", "15"), ("TZA", "1"), ("SOFI", "1"), ("SOFI", "60"),
    ("NVDA", "60"), ("NVDA", "5"), ("TZA", "5"),
]

SAMPLER_JS = """
() => {
  window.__wrFrames = [];
  const tick = () => {
    const d = window.__uctChartDebug && window.__uctChartDebug.main;
    if (d && d.newestIndex) {
      const r = d.visibleRange(), i = d.newestIndex();
      if (r && i != null && i >= 0) {
        const f = { ro: Math.round((r.to - i) * 1000) / 1000, w: Math.round((r.to - r.from) * 1000) / 1000,
                    sym: new URLSearchParams(location.search).get('sym'), tf: new URLSearchParams(location.search).get('tf') };
        const p = window.__wrFrames[window.__wrFrames.length - 1];
        if (!p || p.ro !== f.ro || p.w !== f.w || p.sym !== f.sym || p.tf !== f.tf) window.__wrFrames.push(f);
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
"""
NAV = ("(u) => { window.history.pushState({}, '', u); "
       "window.dispatchEvent(new PopStateEvent('popstate')); }")


def handler(route, request):
    url = request.url
    path = url.split("?", 1)[0]
    qs = dict(re.findall(r"[?&]([^=&]+)=([^&]*)", url))

    def send(obj):
        route.fulfill(status=200, content_type="application/json", body=json.dumps(obj))

    m = re.search(r"/api/bars/([^/?]+)$", path)
    if m:
        sym, tf = m.group(1).upper(), qs.get("tf", "5")
        upto = STALE_SERVER.get(sym, FAKE_NOW)
        rows = make_bars(int(tf) if tf.isdigit() else 5, upto, DEPTH.get(sym, 5))
        if qs.get("since"):
            rows = [b for b in rows if b["t"] > int(qs["since"])]
        time.sleep(0.15)
        return send({"ticker": sym, "tf": tf, "bars": rows, **({"delta": True} if qs.get("since") else {})})
    if "/api/bars-history/" in path:
        return send({"ticker": "X", "tf": qs.get("tf", "D"), "bars": [], "sealed": True})
    if "/api/auth/me" in path:
        return send({"email": "harness@local", "plan": "pro", "role": "user"})
    return send({})


def main():
    if not os.path.isfile(os.path.join(DIST, "index.html")):
        print("FAIL: app/dist not built. Run `npx vite build` in app/ first.")
        return 1
    with open(os.path.join(DIST, "blank.html"), "w", encoding="utf-8") as f:
        f.write("<!doctype html><title>blank</title>")
    port = free_port()
    httpd = ThreadingHTTPServer(("127.0.0.1", port), partial(SPAHandler, directory=DIST))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}"
    frames, ok = [], True
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(viewport={"width": 1280, "height": 760})
            ctx.add_init_script(CLOCK_JS % int(FAKE_NOW.timestamp() * 1000))
            ctx.route("**/api/**", handler)
            page = ctx.new_page()
            page.goto(f"{base}/blank.html", wait_until="domcontentloaded")
            for (sym, tf), tail in SEEDED_CACHE.items():
                page.evaluate(SEED_JS, [sym, tf, make_bars(int(tf), tail, DEPTH.get(sym, 5)), CACHE_LOGIC_VERSION])
            sym0, tf0 = SEQUENCE[0]
            page.goto(f"{base}/r/chart?sym={sym0}&tf={tf0}&w=1200&h=620", wait_until="domcontentloaded")
            page.wait_for_timeout(3000)
            page.evaluate(SAMPLER_JS)
            page.wait_for_timeout(300)
            for sym, tf in SEQUENCE[1:]:
                page.evaluate(NAV, f"/r/chart?sym={sym}&tf={tf}&w=1200&h=620")
                page.wait_for_timeout(1500)
            frames = page.evaluate("() => window.__wrFrames")
            browser.close()
    finally:
        httpd.shutdown()
        try:
            os.remove(os.path.join(DIST, "blank.html"))
        except OSError:
            pass
    if not frames:
        print("FAIL: no frames sampled (debug handle missing?)")
        return 1
    ref = frames[0]
    print(f"[harness] {len(frames)} distinct frames; reference right margin={ref['ro']} width={ref['w']} bars")
    for f in frames:
        same = abs(f["ro"] - ref["ro"]) < 1e-6 and abs(f["w"] - ref["w"]) < 1e-6
        if not same:
            ok = False
        print(f"  {'ok ' if same else 'MOVED'} {f['sym']:>5} {f['tf']:>3}m  right margin={f['ro']}  width={f['w']}")
    out = os.path.join(DIST, "intraday_symswitch_framing_out.json")   # build output dir, not the tree
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(frames, fh, indent=1)
    print(("PASS" if ok else "FAIL") + ": newest candle " + ("locked in place in every frame" if ok else "moved"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
