"""Load the local site in headless Chromium and report what the page does (console, failed/hanging requests, load state)."""
import sys, time, json
from playwright.sync_api import sync_playwright

url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8077/login"
out = sys.argv[2] if len(sys.argv) > 2 else r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\probe.png"
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()
    console, pending, done, failed = [], {}, [], []
    page.on("console", lambda m: console.append(f"{m.type}: {m.text[:200]}"))
    page.on("request", lambda r: pending.__setitem__(r.url, time.time()))
    page.on("requestfinished", lambda r: (pending.pop(r.url, None), done.append(r.url)))
    page.on("requestfailed", lambda r: (pending.pop(r.url, None), failed.append(f"{r.url} {r.failure}")))
    t0 = time.time()
    try:
        page.goto(url, wait_until="load", timeout=30000)
        print("load event after %.1fs" % (time.time() - t0))
    except Exception as e:
        print("goto:", str(e)[:200])
    time.sleep(6)
    print("url now:", page.url)
    print("requests done:", len(done), "failed:", len(failed))
    for f in failed[:10]: print("  FAILED", f[:200])
    for u, t in list(pending.items())[:10]: print("  PENDING %.0fs %s" % (time.time() - t, u[:160]))
    print("console:", len(console))
    for c in console[:25]: print("  ", c)
    page.screenshot(path=out)
    print("shot", out)
    b.close()
