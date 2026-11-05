import time, json
from playwright.sync_api import sync_playwright
ENV = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\sandbox_env.json"
OUT = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study"
BASE = "http://127.0.0.1:5232"
env = json.load(open(ENV))
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1280, "height": 960})
    ctx.request.post("http://127.0.0.1:8077/api/auth/login", data={"email": env["EMAIL"], "password": env["UCT_SANDBOX_PASSWORD"]})
    page = ctx.new_page(); errs = []
    page.on("console", lambda m: errs.append(m.text[:160]) if m.type == "error" and "503" not in m.text else None)
    page.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)[:200]))
    def go(n, wait=7):
        errs.clear(); page.goto(BASE + f"/lab.html?piece={n}", wait_until="load", timeout=30000); time.sleep(wait)
    go(26); page.screenshot(path=OUT + r"\p26.png"); print("26", errs[:3])
    go(27); page.screenshot(path=OUT + r"\p27a.png"); page.get_by_role("button", name="1h", exact=True).first.click(); time.sleep(5); page.screenshot(path=OUT + r"\p27b.png"); print("27", errs[:3])
    go(28); page.get_by_role("button", name="Play the story").click(); time.sleep(4); page.screenshot(path=OUT + r"\p28a.png"); time.sleep(9); page.screenshot(path=OUT + r"\p28b.png"); print("28", errs[:3])
    go(29, 3); page.get_by_role("button", name="Continue").click(); time.sleep(0.5); page.get_by_role("button", name="Continue").click(); time.sleep(0.5); page.get_by_role("button", name="Continue").click(); time.sleep(3); page.screenshot(path=OUT + r"\p29.png"); print("29", errs[:3])
    go(30, 3); page.mouse.wheel(0, 420); time.sleep(1); page.screenshot(path=OUT + r"\p30.png"); print("30", errs[:3])
    b.close()
