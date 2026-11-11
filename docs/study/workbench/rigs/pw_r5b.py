import time, json
from playwright.sync_api import sync_playwright
ENV = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\sandbox_env.json"
OUT = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study"
BASE = "http://127.0.0.1:5232"
env = json.load(open(ENV))
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1280, "height": 900})
    ctx.request.post("http://127.0.0.1:8077/api/auth/login", data={"email": env["EMAIL"], "password": env["UCT_SANDBOX_PASSWORD"]})
    page = ctx.new_page(); errs = []
    page.on("pageerror", lambda e: errs.append(str(e)[:200]))
    page.goto(BASE + "/lab.html?piece=22", wait_until="load", timeout=30000); time.sleep(7)
    page.get_by_role("button", name="Day 1 · 30-min ORB").click(); time.sleep(1)
    page.get_by_role("button", name="30m", exact=True).first.click(); time.sleep(7); page.screenshot(path=OUT + r"\p22c.png")
    page.goto(BASE + "/lab.html?piece=25", wait_until="load", timeout=30000); time.sleep(3)
    page.mouse.wheel(0, 500); time.sleep(1); page.screenshot(path=OUT + r"\p25b.png")
    print("errs", errs[:3]); b.close()
