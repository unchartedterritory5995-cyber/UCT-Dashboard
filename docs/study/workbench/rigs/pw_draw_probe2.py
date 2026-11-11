import time, json, re
from playwright.sync_api import sync_playwright
ENV = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\sandbox_env.json"
OUT = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study"
env = json.load(open(ENV))
def stop_of(page):
    txt = page.evaluate("() => document.body.innerText"); m = re.search(r"YOUR STOP\s*\n\s*([^\n]+)", txt); return m.group(1) if m else None
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1366, "height": 960})
    ctx.request.post("http://127.0.0.1:8077/api/auth/login", data={"email": env["EMAIL"], "password": env["UCT_SANDBOX_PASSWORD"]})
    page = ctx.new_page(); errs = []
    page.on("pageerror", lambda e: errs.append(str(e)[:200]))
    for which in (0, 1):
        page.goto("http://127.0.0.1:5232/lab.html?piece=44", wait_until="load"); time.sleep(7)
        hr = page.locator("button[title='Horizontal Ray (Alt+J)']"); print("hray buttons", hr.count(), [hr.nth(k).bounding_box() for k in range(hr.count())])
        hr.nth(which).click(); time.sleep(0.5)
        box = page.locator("canvas").first.bounding_box()
        x = box["x"] + box["width"] * 0.6; y = box["y"] + box["height"] * 0.6
        page.mouse.move(x, y); time.sleep(0.3); page.mouse.click(x, y); time.sleep(1.2)
        print("toolbar", which, "after click ->", stop_of(page))
        page.mouse.click(x - 120, y - 70); time.sleep(1.2)
        print("toolbar", which, "after 2nd click ->", stop_of(page))
        page.screenshot(path=OUT + rf"\probe44_{which}.png")
    print("ERRS", errs[:3])
    b.close()
