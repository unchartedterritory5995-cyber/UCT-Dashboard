import time, json, re
from playwright.sync_api import sync_playwright
ENV = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\sandbox_env.json"
OUT = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\hunt"
env = json.load(open(ENV))
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    ctx.request.post("http://127.0.0.1:8077/api/auth/login", data={"email": env["EMAIL"], "password": env["UCT_SANDBOX_PASSWORD"]})
    page = ctx.new_page(); errs = []
    page.on("pageerror", lambda e: errs.append(str(e)[:200]))
    def chart_box():
        for c in page.locator("canvas").all():
            bb = c.bounding_box()
            if bb and bb["width"] > 200: return bb
    # 56 Draw-it: tap the chart with a TOUCH
    page.goto("http://127.0.0.1:5232/lab.html?piece=56", wait_until="load"); time.sleep(7)
    box = chart_box(); print("chart box", box)
    page.touchscreen.tap(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.6); time.sleep(1.0)
    print("draw-it touch tap ->", page.evaluate("() => (document.querySelector('input[type=number]')||{}).value"))
    page.touchscreen.tap(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.6); time.sleep(1.0)
    print("draw-it second tap ->", page.evaluate("() => (document.querySelector('input[type=number]')||{}).value"))
    page.screenshot(path=OUT + r"\touch56.png")
    # 55 Hard: through to the Enter step, then touch tap
    page.goto("http://127.0.0.1:5232/lab.html?piece=55", wait_until="load"); time.sleep(4)
    page.get_by_role("button", name=re.compile("Start hard mode")).click(); time.sleep(6)
    page.locator("button[class*=card]").nth(1).tap(); time.sleep(0.4); page.get_by_role("button", name="Check").tap(); time.sleep(1.5); page.get_by_role("button", name="Next").tap(); time.sleep(2)
    box = chart_box(); page.touchscreen.tap(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.5); time.sleep(1.0)
    print("hard touch tap -> check enabled:", page.get_by_role("button", name="Check").is_enabled())
    page.screenshot(path=OUT + r"\touch55.png")
    # 57 trap touch on a gold candle (the last bar at ~90%)
    page.goto("http://127.0.0.1:5232/lab.html?piece=57", wait_until="load"); time.sleep(7)
    box = chart_box(); page.touchscreen.tap(box["x"] + box["width"] * 0.94, box["y"] + box["height"] * 0.4); time.sleep(1.0)
    print("trap touch tap -> check enabled:", page.get_by_role("button", name="Check").is_enabled())
    print("errs", errs[:3])
    b.close()
