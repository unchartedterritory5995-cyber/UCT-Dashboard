"""Round-5 render + interaction probe."""
import time, json
from playwright.sync_api import sync_playwright
ENV = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\sandbox_env.json"
OUT = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study"
BASE = "http://127.0.0.1:5232"
env = json.load(open(ENV))
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1280, "height": 900})
    r = ctx.request.post("http://127.0.0.1:8077/api/auth/login", data={"email": env["EMAIL"], "password": env["UCT_SANDBOX_PASSWORD"]})
    print("login", r.status)
    page = ctx.new_page()
    errs = []
    page.on("console", lambda m: errs.append(m.text[:160]) if m.type == "error" and "503" not in m.text else None)
    page.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)[:200]))
    def go(n, wait=7):
        errs.clear(); page.goto(BASE + f"/lab.html?piece={n}", wait_until="load", timeout=30000); time.sleep(wait)
    go(21); page.get_by_role("button", name="2 Kicker").click(); time.sleep(0.3); page.screenshot(path=OUT + r"\p21a.png")
    page.get_by_role("button", name="Check").click(); time.sleep(0.8); page.screenshot(path=OUT + r"\p21b.png"); print("21", errs[:3])
    go(22); page.screenshot(path=OUT + r"\p22a.png")
    page.get_by_role("button", name="Day 1 · 30-min ORB").click(); time.sleep(1); page.get_by_role("button", name="30m", exact=True).first.click(); time.sleep(6); page.screenshot(path=OUT + r"\p22b.png"); print("22", errs[:3])
    go(23); page.get_by_role("button", name="Play the story").click(); time.sleep(9.5); page.screenshot(path=OUT + r"\p23.png"); print("23", errs[:3])
    go(24, 3); page.screenshot(path=OUT + r"\p24a.png"); page.get_by_role("button", name="Continue").click(); time.sleep(2); page.screenshot(path=OUT + r"\p24b.png"); print("24", errs[:3])
    go(25, 3); page.screenshot(path=OUT + r"\p25.png"); print("25", errs[:3])
    b.close()
