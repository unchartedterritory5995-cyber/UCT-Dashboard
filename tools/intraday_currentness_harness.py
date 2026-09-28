"""AVGO 2026-09-28 regression, in a real browser — fully isolated.

⛔⛔ THE FAILURE IT REPLAYS. Monday 2026-09-28 11:33 ET, AVGO 5m: the browser held a
Friday cache (tail Fri 19:55), the server shed every tail repair for capacity and
answered with Friday's rows as a plain 200, the client classified the Friday tail
'fresh', and the chart settled on Friday under a green ● LIVE badge.

Same isolation as `tools/intraday_tail_harness.py`: NO backend, NO /data, NO cookie.
Playwright route-mocks every `/api/**`, the page is `/r/chart` (open when
VITE_CHART_RENDER_TOKEN is unset), and the browser's clock is shifted (not frozen) to
Monday 11:33 ET so SWR timers still run. Main Trading is never involved.

⭐ The price feed is made genuinely LIVE with a fake always-open EventSource, because
the defect is precisely "feed live + bars stale reads LIVE". A harness whose feed
reads RECONNECTING could never show that lie, so it could never prove it is gone.

Phases (one page, no reload):
  1. SHED    — server answers Friday rows, `tail_status:'unverified'`, Retry-After 3.
               Expect: Friday history PAINTED; state UPDATING then DELAYED; never LIVE.
  2. HEAL    — server now has Monday bars through 11:25 (+11:30 forming).
               Expect: the chart's own retry picks them up; tail advances; CURRENT; LIVE;
               IDB persisted.

Usage:  python tools/intraday_currentness_harness.py [--expect-fail]
  --expect-fail  run against a bundle WITHOUT the fix (mutation proof): exits 0 only
                 if the harness DETECTS the defect.
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
DIST = os.environ.get("HARNESS_DIST") or os.path.join(ROOT, "app", "dist")
FAKE_NOW = datetime(2026, 9, 28, 11, 33, 0, tzinfo=ET)
CACHE_LOGIC_VERSION = 7
EXT_OPEN_MIN, EXT_CLOSE_MIN = 240, 1200


def _days(end, n):
    out, d = [], end.date()
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d -= timedelta(days=1)
    return list(reversed(out))


def make_bars(tf_min, upto, n_sessions=6):
    out = []
    for day in _days(upto, n_sessions):
        m = EXT_OPEN_MIN
        while m < EXT_CLOSE_MIN:
            t = datetime(day.year, day.month, day.day, m // 60, m % 60, tzinfo=ET)
            if t > upto:
                break
            ts = int(t.timestamp())
            base = 350.0 + (ts % 997) / 400.0
            out.append({"t": ts, "o": round(base, 2), "h": round(base + .3, 2),
                        "l": round(base - .25, 2), "c": round(base + .1, 2), "v": 1000 + ts % 500})
            m += tf_min
    return out


FRI_TAIL = datetime(2026, 9, 25, 19, 55, tzinfo=ET)
MON_TAIL = datetime(2026, 9, 28, 11, 30, tzinfo=ET)      # the forming 11:30 bar


class Server:
    def __init__(self):
        self.mode = "shed"
        self.log = []

    def bars(self, sym, tf, want, since):
        tail = FRI_TAIL if self.mode == "shed" else MON_TAIL
        rows_all = make_bars(int(tf), tail)
        if since:
            rows = [b for b in rows_all if b["t"] > int(since)]
            body = {"ticker": sym, "tf": tf, "bars": rows, "delta": True}
        else:
            rows = rows_all[-want:]
            body = {"ticker": sym, "tf": tf, "bars": rows}
        if self.mode == "shed":
            body.update(tail_status="unverified", verified_through=None, retry_after=3)
        else:
            body.update(tail_status="current", verified_through=int(time.time()))
        self.log.append({"mode": self.mode, "since": since, "n": len(rows), "want": want,
                         "at": round(time.time(), 1)})
        return body


def handler(srv: Server):
    def handle(route, request):
        url = request.url
        path = url.split("?", 1)[0]
        qs = dict(re.findall(r"[?&]([^=&]+)=([^&]*)", url))

        def send(obj, status=200, headers=None):
            route.fulfill(status=status, content_type="application/json",
                          body=json.dumps(obj), headers=headers or {})

        m = re.search(r"/api/bars/([^/?]+)$", path)
        if m and not qs.get("tf", "5").isdigit():
            return send({"ticker": m.group(1).upper(), "tf": qs.get("tf"), "bars": []})
        if m:
            body = srv.bars(m.group(1).upper(), qs.get("tf", "5"),
                            int(qs.get("bars", "600")), qs.get("since") or None)
            return send(body, headers={"Retry-After": "3"} if body.get("tail_status") == "unverified" else None)
        if "/api/auth/me" in path:
            return send({"email": "harness@local", "plan": "pro", "role": "user"})
        return send({})
    return handle


class SPA(SimpleHTTPRequestHandler):
    def do_GET(self):
        p = self.path.split("?", 1)[0]
        if not os.path.isfile(os.path.join(DIST, p.lstrip("/"))):
            self.path = "/index.html"
        return SimpleHTTPRequestHandler.do_GET(self)

    def log_message(self, *a):
        pass


CLOCK_JS = """
(() => {
  const OFFSET = %d - Date.now();
  const RealDate = Date;
  function FakeDate(...a) { return a.length ? new RealDate(...a) : new RealDate(RealDate.now() + OFFSET) }
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = () => RealDate.now() + OFFSET;
  FakeDate.parse = RealDate.parse; FakeDate.UTC = RealDate.UTC;
  window.Date = FakeDate;
  // A feed that is genuinely CONNECTED — the defect is "feed live, bars stale".
  class FakeES {
    constructor(url) { this.url = url; this.readyState = 0;
      setTimeout(() => { this.readyState = 1; this.onopen && this.onopen({}) }, 50) }
    addEventListener() {} removeEventListener() {} close() { this.readyState = 2 }
  }
  window.EventSource = FakeES;
})();
"""

SEED_JS = """
async ([sym, tf, bars, ver]) => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('uct_bars_v1', 2);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    r.onupgradeneeded = () => { const d = r.result;
      if (d.objectStoreNames.contains('bars')) d.deleteObjectStore('bars');
      d.createObjectStore('bars', { keyPath: 'key' }); };
  });
  await new Promise((res, rej) => {
    const tx = db.transaction('bars', 'readwrite');
    tx.objectStore('bars').put({ key: `${sym}_${tf}`, bars, lastT: bars[bars.length-1].t, savedAt: Date.now(), v: ver });
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
  db.close(); return bars[bars.length-1].t;
}
"""

READ_IDB = """
async ([sym, tf]) => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('uct_bars_v1', 2);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const rec = await new Promise((res) => { const tx = db.transaction('bars', 'readonly');
    const g = tx.objectStore('bars').get(`${sym}_${tf}`); g.onsuccess = () => res(g.result); g.onerror = () => res(null); });
  db.close(); return rec ? rec.lastT : null;
}
"""

STATE_JS = """() => {
  const w = document.querySelector('[data-bar-currentness]');
  const b = document.querySelector('[data-testid="chart-live-state"]');
  const live = [...document.querySelectorAll('div')].find(d => /●\\s*LIVE/.test(d.textContent || '') && d.children.length === 0);
  return {
    currentness: w ? w.getAttribute('data-bar-currentness') : null,
    tail: w ? Number(w.getAttribute('data-bar-tail')) || null : null,
    badge: b ? b.textContent.trim() : (live ? live.textContent.trim() : null),
    liveBadge: w ? w.getAttribute('data-live-badge') : null,
    drawn: window.__chartBarCount ?? null,
  }
}"""


def fmt(ts):
    return datetime.fromtimestamp(ts, ET).strftime("%a %H:%M") if ts else None


def main():
    expect_fail = "--expect-fail" in sys.argv
    if not os.path.isfile(os.path.join(DIST, "index.html")):
        print(f"FAIL: {DIST} not built")
        return 2
    with open(os.path.join(DIST, "blank.html"), "w") as f:
        f.write("<!doctype html><title>b</title>")
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    httpd = ThreadingHTTPServer(("127.0.0.1", port), partial(SPA, directory=DIST))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}"
    srv = Server()
    samples, problems = [], []
    try:
        with sync_playwright() as p:
            br = p.chromium.launch()
            ctx = br.new_context(viewport={"width": 1280, "height": 760})
            ctx.add_init_script(CLOCK_JS % int(FAKE_NOW.timestamp() * 1000))
            ctx.route("**/api/**", handler(srv))
            page = ctx.new_page()
            page.goto(f"{base}/blank.html")
            seeded = page.evaluate(SEED_JS, ["AVGO", "5", make_bars(5, FRI_TAIL), CACHE_LOGIC_VERSION])
            print(f"[harness] clock {FAKE_NOW:%a %Y-%m-%d %H:%M} ET · IDB seed tail {fmt(seeded)} · {DIST}")
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(f"{base}/r/chart?sym=AVGO&tf=5&w=1200&h=620", wait_until="domcontentloaded")

            # ── Phase 1: SHED ───────────────────────────────────────────────
            t0 = time.time()
            saw = set()
            while time.time() - t0 < 24:
                st = page.evaluate(STATE_JS)
                samples.append({"phase": "shed", "t": round(time.time() - t0, 1), **st})
                saw.add(st["currentness"])
                if st["badge"] and "LIVE" in st["badge"] and "●" in st["badge"]:
                    problems.append(f"SHED: badge read LIVE at +{time.time()-t0:.1f}s over tail {fmt(st['tail'])}")
                if st["currentness"] in ("current", "no_expectation"):
                    problems.append(f"SHED: currentness={st['currentness']} over tail {fmt(st['tail'])}")
                page.wait_for_timeout(1000)
            last = samples[-1]
            print(f"[shed]  states seen {sorted(x for x in saw if x)} · final {last['currentness']} · "
                  f"badge {last['badge']!r} · drawn {last['drawn']} · tail {fmt(last['tail'])}")
            if not last["drawn"]:
                problems.append("SHED: Friday history was NOT painted (blank chart)")
            if last["tail"] != int(FRI_TAIL.replace(hour=15, minute=55).timestamp()) and last["tail"] != int(FRI_TAIL.timestamp()):
                problems.append(f"SHED: unexpected tail {fmt(last['tail'])}")
            if "delayed" not in saw:
                problems.append("SHED: never reached DELAYED after the fast retries")
            shed_reqs = [r for r in srv.log if r["mode"] == "shed"]
            print(f"[shed]  requests {len(shed_reqs)} (since= {sum(1 for r in shed_reqs if r['since'])}) "
                  f"visibility={page.evaluate('() => document.visibilityState')}")

            # ── Phase 2: HEAL ───────────────────────────────────────────────
            srv.mode = "heal"
            t1 = time.time()
            healed_at = None
            while time.time() - t1 < 45:
                st = page.evaluate(STATE_JS)
                samples.append({"phase": "heal", "t": round(time.time() - t1, 1), **st})
                if st["currentness"] == "current" and healed_at is None:
                    healed_at = time.time() - t1
                if healed_at is not None and time.time() - t1 > healed_at + 2:
                    break
                page.wait_for_timeout(1000)
            last = samples[-1]
            idb_tail = page.evaluate(READ_IDB, ["AVGO", "5"])
            print(f"[heal]  currentness {last['currentness']} after {healed_at and round(healed_at,1)}s · "
                  f"badge {last['badge']!r} · tail {fmt(last['tail'])} · IDB tail {fmt(idb_tail)}")
            if last["currentness"] != "current":
                problems.append(f"HEAL: never became CURRENT (final {last['currentness']})")
            # ⚠️ `/r/chart` mounts StockChart with liveUpdates={false}: no price feed, so
            # the badge never renders here and `data-live-badge` reads the FEED state
            # ('reconnecting'). Badge-vs-currentness is railed by `liveBadgeState`
            # (intradayCatchupPoll.test.js); this harness proves the currentness input.
            if (last["tail"] or 0) < int(datetime(2026, 9, 28, 11, 25, tzinfo=ET).timestamp()):
                problems.append(f"HEAL: rendered tail did not advance ({fmt(last['tail'])})")
            if (idb_tail or 0) < int(datetime(2026, 9, 28, 11, 25, tzinfo=ET).timestamp()):
                problems.append(f"HEAL: IDB not persisted ({fmt(idb_tail)})")
            if errors:
                problems.append(f"page errors: {errors[:3]}")
            br.close()
    finally:
        httpd.shutdown()
        try:
            os.remove(os.path.join(DIST, "blank.html"))
        except OSError:
            pass
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "intraday_currentness_harness_out.json")
    with open(out, "w") as f:
        json.dump({"problems": problems, "samples": samples, "server": srv.log}, f, indent=1)
    if expect_fail:
        print(f"[mutation] defect detected: {bool(problems)} -> {problems[:3]}")
        return 0 if problems else 1
    print("PASS" if not problems else "FAIL:\n  " + "\n  ".join(problems))
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())
