import time, json, re
from playwright.sync_api import sync_playwright
ENV = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\sandbox_env.json"
OUT = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\phone"
env = json.load(open(ENV))
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    ctx.request.post("http://127.0.0.1:8077/api/auth/login", data={"email": env["EMAIL"], "password": env["UCT_SANDBOX_PASSWORD"]})
    page = ctx.new_page()
    def shot(n): page.screenshot(path=OUT + rf"\s{n}.png", full_page=False)
    def chart():
        for c in page.locator("canvas").all():
            bb = c.bounding_box()
            if bb and bb["width"] > 200: return bb
    # 53 blitz in play
    page.goto("http://127.0.0.1:5232/lab.html?piece=53", wait_until="load"); time.sleep(2); page.evaluate("() => localStorage.setItem('study.blitz.tutorialSeen','1')")
    page.goto("http://127.0.0.1:5232/lab.html?piece=53", wait_until="load"); time.sleep(7); page.get_by_role("button", name=re.compile("Start the clock")).tap(); time.sleep(6); shot("53play")
    # 54 boss q1 + after check
    page.goto("http://127.0.0.1:5232/lab.html?piece=54", wait_until="load"); time.sleep(6); page.get_by_role("button", name=re.compile("Face the boss")).tap(); time.sleep(6); shot("54q")
    page.locator("button[class*=card]").nth(0).tap(); time.sleep(0.3); page.get_by_role("button", name="Check").tap(); time.sleep(3.5); shot("54after")
    # 55 hard enter + stop + run
    page.goto("http://127.0.0.1:5232/lab.html?piece=55", wait_until="load"); time.sleep(4); page.get_by_role("button", name=re.compile("Start hard mode")).tap(); time.sleep(6); shot("55name")
    page.locator("button[class*=card]").nth(1).tap(); time.sleep(0.3); page.get_by_role("button", name="Check").tap(); time.sleep(1.5); page.get_by_role("button", name="Next").tap(); time.sleep(2); shot("55enter")
    bb = chart(); page.touchscreen.tap(bb["x"] + bb["width"] * 0.5, bb["y"] + bb["height"] * 0.42); time.sleep(0.8); page.get_by_role("button", name="Check").tap(); time.sleep(1.5); shot("55enterok"); page.get_by_role("button", name="Next").tap(); time.sleep(2)
    page.touchscreen.tap(bb["x"] + bb["width"] * 0.5, bb["y"] + bb["height"] * 0.6); time.sleep(0.8); shot("55stop"); page.get_by_role("button", name="Check").tap(); time.sleep(1.5); page.get_by_role("button", name=re.compile("Watch it run")).tap(); time.sleep(8); shot("55run")
    # 56 draw after tap + after check
    page.goto("http://127.0.0.1:5232/lab.html?piece=56", wait_until="load"); time.sleep(7); bb = chart(); page.touchscreen.tap(bb["x"] + bb["width"] * 0.5, bb["y"] + bb["height"] * 0.62); time.sleep(1); shot("56tap")
    page.get_by_role("button", name=re.compile("Check my stop")).tap(); time.sleep(5); shot("56check")
    # 57 trap pick + check
    page.goto("http://127.0.0.1:5232/lab.html?piece=57", wait_until="load"); time.sleep(7); shot("57ask"); page.locator("button[class*=cand]").nth(0).tap(); time.sleep(0.5); page.get_by_role("button", name="Check").tap(); time.sleep(5); shot("57check")
    b.close()
