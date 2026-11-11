"""Sign the local sandbox account in (headless Chromium), open a route, dismiss the intro, save a screenshot.
usage: pw_study.py <route> <out.png> [phone]"""
import sys, time, json
from playwright.sync_api import sync_playwright

ENV = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\sandbox_env.json"
BASE = __import__("os").environ.get("LAB_BASE", "http://127.0.0.1:8077")
route = sys.argv[1] if len(sys.argv) > 1 else "/desk?section=courses"
out = sys.argv[2] if len(sys.argv) > 2 else r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\study.png"
phone = len(sys.argv) > 3 and sys.argv[3] == "phone"
env = json.load(open(ENV))
with sync_playwright() as p:
    b = p.chromium.launch()
    vp = {"width": 390, "height": 844} if phone else {"width": 1280, "height": 860}
    ctx = b.new_context(viewport=vp, device_scale_factor=2 if phone else 1, is_mobile=phone, has_touch=phone)
    r = ctx.request.post(BASE + "/api/auth/login", data={"email": env["EMAIL"], "password": env["UCT_SANDBOX_PASSWORD"]})
    print("login", r.status)
    page = ctx.new_page()
    errs = []
    page.on("console", lambda m: errs.append(m.text[:160]) if m.type in ("error", "warning") else None)
    page.goto(BASE + route, wait_until="load", timeout=30000)
    time.sleep(2)
    for sel in ("text=SKIP", "text=Skip", "text=Got it"):
        try:
            page.locator(sel).first.click(timeout=1500)
            time.sleep(0.8)
        except Exception:
            pass
    time.sleep(4)
    print("url", page.url)
    page.screenshot(path=out, full_page=False)
    print("shot", out)
    for e in errs[:8]: print("  console:", e)
    b.close()
