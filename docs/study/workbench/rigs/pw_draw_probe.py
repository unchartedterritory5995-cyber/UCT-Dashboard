import time, json
from playwright.sync_api import sync_playwright
ENV = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\sandbox_env.json"
OUT = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study"
env = json.load(open(ENV))
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1366, "height": 960})
    ctx.request.post("http://127.0.0.1:8077/api/auth/login", data={"email": env["EMAIL"], "password": env["UCT_SANDBOX_PASSWORD"]})
    page = ctx.new_page(); errs = []
    page.on("pageerror", lambda e: errs.append(str(e)[:200]))
    page.goto("http://127.0.0.1:5232/lab.html?piece=44", wait_until="load"); time.sleep(7)
    # count toolbars and list tool buttons with titles
    btns = page.evaluate("""() => Array.from(document.querySelectorAll('button')).map(b => (b.getAttribute('title')||b.getAttribute('aria-label')||b.textContent||'').trim()).filter(Boolean)""")
    print("BUTTONS", [x for x in btns if 'ray' in x.lower() or 'horiz' in x.lower()][:12])
    print("N horizontal-ray buttons:", page.locator("button[title*='orizontal'], button[aria-label*='orizontal']").count())
    hr = page.locator("button[title*='orizontal ray'], button[aria-label*='orizontal ray']")
    print("hray count", hr.count())
    if hr.count():
        for k in range(hr.count()):
            bb = hr.nth(k).bounding_box(); print("hray", k, bb)
        hr.first.click(); time.sleep(0.5)
    box = page.locator("canvas").first.bounding_box(); print("canvas", box)
    # click at 60% height on the chart, read crosshair price afterwards by hovering there
    x = box["x"] + box["width"] * 0.6; y = box["y"] + box["height"] * 0.6
    page.mouse.move(x, y); time.sleep(0.3); page.mouse.click(x, y); time.sleep(1.0)
    txt = page.evaluate("() => document.body.innerText")
    import re
    m = re.search(r"YOUR STOP\s*\n\s*([^\n]+)", txt); print("YOUR STOP ->", m.group(1) if m else None)
    page.screenshot(path=OUT + r"\probe44.png")
    # second click higher
    page.mouse.click(x - 100, y - 80); time.sleep(1.0)
    txt = page.evaluate("() => document.body.innerText"); m = re.search(r"YOUR STOP\s*\n\s*([^\n]+)", txt); print("YOUR STOP 2 ->", m.group(1) if m else None)
    page.screenshot(path=OUT + r"\probe44b.png")
    print("ERRS", errs[:3])
    b.close()
