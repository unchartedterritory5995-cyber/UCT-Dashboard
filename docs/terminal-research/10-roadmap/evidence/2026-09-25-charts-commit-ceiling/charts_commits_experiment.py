"""Is /charts' idle React commit rate the LIVE TAPE or a loop? Same build, same minute, two
fresh Playwright contexts as the smoke account (creds from env, never printed):
  A) control      -- the app's normal feeds
  B) feeds OFF    -- the app's own documented per-browser kill switches set BEFORE load:
                     uct.barsPush.enabled='0' (bars push feed) and uct.ssePool.disabled='1'
                     (the pooled live-price SSE); the page then repaints only on REST polls.
A loop does not care about the feeds; live data does. Commits are counted the way the rig
counts them: a __REACT_DEVTOOLS_GLOBAL_HOOK__ shim installed before the app boots, sampling
onCommitFiberRoot over a 5 s idle after the board settles. Nothing is persisted server-side
(the keys live in the throwaway context's localStorage)."""
import json, os, sys, time
from playwright.sync_api import sync_playwright

BASE = "https://uctintelligence.com"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 charts-commits-experiment"
email, pw = os.environ.get("SMOKE_EMAIL"), os.environ.get("SMOKE_PASSWORD")
if not (email and pw):
    print("INCONCLUSIVE: credentials not in env"); sys.exit(2)

HOOK = """
(() => {
  const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || { supportsFiber: true, inject(){return 1}, on(){}, off(){}, emit(){}, renderers: new Map(), onCommitFiberUnmount(){}, onPostCommitFiberRoot(){} };
  window.__uctCommits = 0;
  const prev = hook.onCommitFiberRoot;
  hook.onCommitFiberRoot = function (...a) { window.__uctCommits++; if (typeof prev === 'function') return prev.apply(this, a); };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
})();
"""

def run(label, feeds_off, p):
    b = p.chromium.launch(headless=True)
    ctx = b.new_context(viewport={"width": 1440, "height": 900}, user_agent=UA)
    ctx.add_init_script(HOOK)
    page = ctx.new_page()
    if feeds_off:
        # ⛔ NOT the app's kill switches -- those only re-route live data (pool -> per-instance SSE,
        # bars push -> Finnhub poll). A no-tape arm has to remove it at the NETWORK: abort every
        # stream and live-price request so the page repaints on nothing but its REST polls.
        page.route("**/api/stream/**", lambda route: route.abort())
        page.route("**/api/live-prices**", lambda route: route.abort())
        page.route("**/api/snapshot**", lambda route: route.abort())
    r = page.request.post(f"{BASE}/api/auth/login", data=json.dumps({"email": email, "password": pw}), headers={"Content-Type": "application/json"})
    if r.status != 200:
        print(label, "INCONCLUSIVE: login", r.status); ctx.close(); b.close(); return None
    page.goto(f"{BASE}/charts", wait_until="domcontentloaded", timeout=90000)
    try:
        page.wait_for_selector("canvas", timeout=60000)   # a chart painted
    except Exception:
        print(label, "INCONCLUSIVE: no chart canvas within 60 s"); ctx.close(); b.close(); return None
    time.sleep(12)  # let the board settle (layout hydrate, streams engage or not)
    samples = []
    for _ in range(3):
        c0 = page.evaluate("window.__uctCommits"); time.sleep(5); c1 = page.evaluate("window.__uctCommits")
        samples.append(c1 - c0)
    sse = page.evaluate("(() => { try { return performance.getEntriesByType('resource').filter(e => e.name.includes('/api/stream/')).length } catch (e) { return -1 } })()")
    canvases = page.evaluate("document.querySelectorAll('canvas').length")
    ctx.close(); b.close()
    print(f"{label}: commits per 5 s idle x3 = {samples} | canvases {canvases} | stream resources seen {sse}")
    return samples

with sync_playwright() as p:
    a = run("A control (feeds ON) ", False, p)
    b_ = run("B tape BLOCKED (net) ", True, p)
if a and b_:
    ma, mb = max(a), max(b_)
    print("VERDICT:", "LIVE DATA — commits track the feeds" if mb <= ma * 0.5 else ("NOT the feeds — a loop or another source" if mb >= ma * 0.8 else "AMBIGUOUS"), f"(max A {ma}, max B {mb})")
