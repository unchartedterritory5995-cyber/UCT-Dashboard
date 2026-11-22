import time, json
from playwright.sync_api import sync_playwright
ENV = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\sandbox_env.json"
env = json.load(open(ENV))
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    ctx.request.post("http://127.0.0.1:8077/api/auth/login", data={"email": env["EMAIL"], "password": env["UCT_SANDBOX_PASSWORD"]})
    page = ctx.new_page()
    page.goto("http://127.0.0.1:5232/lab.html?piece=56", wait_until="load"); time.sleep(7)
    bb = [c.bounding_box() for c in page.locator("canvas").all() if c.bounding_box() and c.bounding_box()["width"] > 200][0]
    for fx, fy in ((0.25, 0.8), (0.3, 0.3), (0.6, 0.9), (0.5, 0.5)):
        page.evaluate("() => { window.__xh = null; window.__lastTap = null }")
        page.touchscreen.tap(bb["x"] + bb["width"] * fx, bb["y"] + bb["height"] * fy); time.sleep(0.9)
        print("tap", fx, fy, "xh", page.evaluate("() => JSON.stringify(window.__xh)"), "input", page.evaluate("() => (document.querySelector('input[type=number]')||{}).value"))
    b.close()
