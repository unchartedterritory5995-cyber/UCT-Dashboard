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
    go(31); page.screenshot(path=OUT + r"\p31a.png"); page.get_by_role("button", name="2 Kicker").click(); page.get_by_role("button", name="Check").click(); time.sleep(1.5); page.screenshot(path=OUT + r"\p31b.png"); print("31", errs[:3])
    go(32); page.screenshot(path=OUT + r"\p32.png"); print("32", errs[:3])
    go(33); page.get_by_role("button", name="Play the story").click(); time.sleep(12); page.screenshot(path=OUT + r"\p33a.png"); print("33", errs[:3])
    go(34, 3); time.sleep(1.5); page.screenshot(path=OUT + r"\p34a.png"); page.get_by_role("button", name="Continue").click(); page.get_by_role("button", name="Continue").click(); time.sleep(2.5); page.screenshot(path=OUT + r"\p34b.png"); print("34", errs[:3])
    go(35, 4); page.screenshot(path=OUT + r"\p35a.png"); page.mouse.wheel(0, 700); time.sleep(1); page.screenshot(path=OUT + r"\p35b.png"); page.mouse.wheel(0, 1400); time.sleep(1); page.screenshot(path=OUT + r"\p35c.png"); print("35", errs[:3])
    b.close()
