import time, json
from playwright.sync_api import sync_playwright
ENV = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\sandbox_env.json"
OUT = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study"
BASE = "http://127.0.0.1:5232"
env = json.load(open(ENV))
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1366, "height": 960})
    ctx.request.post("http://127.0.0.1:8077/api/auth/login", data={"email": env["EMAIL"], "password": env["UCT_SANDBOX_PASSWORD"]})
    page = ctx.new_page(); errs = []
    page.on("console", lambda m: errs.append(m.text[:160]) if m.type == "error" and "503" not in m.text else None)
    page.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)[:200]))
    def go(n, wait=7):
        errs.clear(); page.goto(BASE + f"/lab.html?piece={n}", wait_until="load", timeout=30000); time.sleep(wait)
    go(36); page.get_by_role("button", name="2 Kicker").click(); page.get_by_role("button", name="Check").click(); time.sleep(1.2); page.screenshot(path=OUT + r"\p36.png"); print("36", errs[:3])
    go(37); page.get_by_role("button", name="Play · space").click(); time.sleep(2.2); page.get_by_role("button", name="BUY · space").click(); time.sleep(1); page.screenshot(path=OUT + r"\p37.png"); print("37", errs[:3])
    go(38, 3); page.screenshot(path=OUT + r"\p38a.png"); page.get_by_role("button", name="Start today's set").click(); time.sleep(6); page.get_by_role("button", name="2 Kicker").click(); page.get_by_role("button", name="Check").click(); time.sleep(1); page.screenshot(path=OUT + r"\p38b.png"); print("38", errs[:3])
    go(39, 3); page.screenshot(path=OUT + r"\p39a.png"); page.get_by_role("button", name="Start").click(); time.sleep(6); page.mouse.click(500, 420); time.sleep(0.5); page.get_by_role("button", name="Check").click(); time.sleep(3); page.screenshot(path=OUT + r"\p39b.png"); print("39", errs[:3])
    go(40, 4); page.screenshot(path=OUT + r"\p40.png"); print("40", errs[:3])
    b.close()
