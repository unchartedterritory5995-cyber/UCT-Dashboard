"""Does /live-massive block the main thread when a member STAYS on it? (diagnostic, read-only)

Headless Playwright in its OWN context, signed in as the synthetic smoke account through the API
(SMOKE_EMAIL / SMOKE_PASSWORD from the environment, never printed). Opens /live-massive, stays
DWELL_S seconds, and records, raw, before any summary (R-RAW):
  * every longtask (start, duration) from navigation, via a buffered PerformanceObserver set up
    in an init script, so nothing before the first evaluate is missed;
  * every /api/ response (time since navigation, status, method, path, content-length);
  * a 1 s heartbeat: how long a trivial page.evaluate took to come back (a blocked main thread
    shows as a heartbeat that takes seconds);
  * a CDP JS CPU profile of the whole dwell, saved as .cpuprofile, plus the top self-time
    functions by name + script URL.
Creates nothing in the product. Exit 0 measured · 2 INCONCLUSIVE (could not sign in / measure).
Usage: python live_flow_probe.py <base> <out-dir> [dwell_s]
"""
import collections
import json
import os
import pathlib
import sys
import time

BASE, OUT = sys.argv[1].rstrip("/"), pathlib.Path(sys.argv[2])
DWELL_S = int(sys.argv[3]) if len(sys.argv) > 3 else 75
OUT.mkdir(parents=True, exist_ok=True)

INIT_JS = """
window.__lt = [];
try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__lt.push({start: e.startTime, dur: e.duration});
  }).observe({type: 'longtask', buffered: true});
} catch (e) { window.__ltErr = String(e); }
"""

email, pw = os.environ.get("SMOKE_EMAIL"), os.environ.get("SMOKE_PASSWORD")
if not (email and pw and email.endswith("@uctintelligence.internal")):
    print("INCONCLUSIVE: no synthetic credentials in the environment")
    sys.exit(2)

from playwright.sync_api import sync_playwright  # noqa: E402
sys.path.insert(0, "C:/Users/Patrick/uct-worktrees/notebook-p2b/tools")
from mobile_audit import _dismiss_intro  # noqa: E402

rec = {"base": BASE, "dwell_s": DWELL_S, "started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
       "responses": [], "heartbeat": [], "longtasks": [], "page_errors": []}


def write():
    (OUT / "probe.json").write_text(json.dumps(rec, indent=1), encoding="utf-8")


with sync_playwright() as p:
    br = p.chromium.launch(headless=True)
    ctx = br.new_context(viewport={"width": 1280, "height": 900})
    ctx.add_init_script(INIT_JS)
    try:
        r = ctx.request.post(BASE + "/api/auth/login", data={"email": email, "password": pw}, timeout=60000)
        if r.status != 200:
            print(f"INCONCLUSIVE: login {r.status}")
            sys.exit(2)
        me = ctx.request.get(BASE + "/api/auth/me").json()
        if not ((me.get("user") or me).get("email", "")).endswith("@uctintelligence.internal"):
            print("INCONCLUSIVE: not the synthetic account; stopping")
            sys.exit(2)
        page = ctx.new_page()
        t0 = [None]

        def rel():
            return None if t0[0] is None else round(time.monotonic() - t0[0], 3)

        def on_resp(resp):
            u = resp.url
            if "/api/" in u:
                rec["responses"].append({"t": rel(), "status": resp.status, "method": resp.request.method,
                                         "path": u.split(BASE)[-1][:140],
                                         "len": resp.headers.get("content-length")})
        page.on("response", on_resp)
        page.on("pageerror", lambda e: rec["page_errors"].append(str(e)[:300]))

        cdp = ctx.new_cdp_session(page)
        cdp.send("Profiler.enable")
        cdp.send("Profiler.setSamplingInterval", {"interval": 1000})
        cdp.send("Profiler.start")

        t0[0] = time.monotonic()
        rec["nav_wall"] = time.strftime("%H:%M:%SZ", time.gmtime())
        page.goto(f"{BASE}/live-massive", wait_until="domcontentloaded", timeout=60000)
        _dismiss_intro(page)
        while time.monotonic() - t0[0] < DWELL_S:
            a = time.monotonic()
            try:
                page.evaluate("() => 1", timeout=60000)
                ok = True
            except Exception as e:  # noqa: BLE001
                ok = type(e).__name__
            rec["heartbeat"].append({"t": rel(), "rtt_ms": round((time.monotonic() - a) * 1000), "ok": ok})
            page.wait_for_timeout(1000)  # pumps Playwright events; time.sleep does not

        prof = cdp.send("Profiler.stop")["profile"]
        (OUT / "live-massive.cpuprofile").write_text(json.dumps(prof), encoding="utf-8")
        rec["longtasks"] = page.evaluate("() => window.__lt || []")
        rec["lt_err"] = page.evaluate("() => window.__ltErr || null")
        write()

        # top self-time functions (profile samples are equal-interval; count them per node)
        nodes = {n["id"]: n for n in prof["nodes"]}
        hits = collections.Counter(prof.get("samples", []))
        dt = prof.get("timeDeltas", [])
        interval_ms = (sum(dt) / len(dt) / 1000) if dt else 1.0
        by_fn = collections.Counter()
        for nid, c in hits.items():
            cf = nodes[nid]["callFrame"]
            key = f'{cf["functionName"] or "(anonymous)"} @ {cf["url"].split("/")[-1]}:{cf["lineNumber"]}:{cf["columnNumber"]}'
            by_fn[key] += c
        rec["top_self_ms"] = [[k, round(v * interval_ms)] for k, v in by_fn.most_common(25)]
        write()
    finally:
        br.close()

lt = rec["longtasks"]
tot = sum(x["dur"] for x in lt)
big = sorted(lt, key=lambda x: -x["dur"])[:5]
hb = max((h["rtt_ms"] for h in rec["heartbeat"]), default=None)
print(f"nav {rec.get('nav_wall')}  longtasks={len(lt)} total={tot/1000:.1f}s  biggest="
      + ", ".join(f'{x["dur"]/1000:.1f}s@{x["start"]/1000:.1f}s' for x in big)
      + f"  worst heartbeat={hb}ms  page_errors={len(rec['page_errors'])}")
for k, v in rec.get("top_self_ms", [])[:8]:
    print(f"   {v:7d} ms  {k}")
sys.exit(0)
