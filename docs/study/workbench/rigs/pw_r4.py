"""Round-4 render + interaction probe."""
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
    page.on("console", lambda m: errs.append(m.text[:200]) if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)[:200]))
    def go(n, wait=7):
        errs.clear()
        page.goto(BASE + f"/lab.html?piece={n}", wait_until="load", timeout=30000); time.sleep(wait)
    go(16); page.screenshot(path=OUT + r"\p16.png"); print("16 errs", errs[:4])
    go(17); page.screenshot(path=OUT + r"\p17a.png")
    page.get_by_role("button", name="2 · Day 2 · previous day high").click(); time.sleep(5); page.screenshot(path=OUT + r"\p17b.png"); print("17 errs", errs[:4])
    go(18); page.get_by_role("button", name="Play", exact=True).click(); time.sleep(6.5); page.screenshot(path=OUT + r"\p18.png"); print("18 errs", errs[:4])
    go(19); page.get_by_role("button", name="3 Kicker").click(); page.get_by_role("button", name="Check").click(); time.sleep(1)
    page.get_by_role("button", name="See your result").click(); time.sleep(2.5); page.screenshot(path=OUT + r"\p19.png"); print("19 errs", errs[:4])
    go(20, 3); page.get_by_role("button", name="Method: Kicker").click(); time.sleep(1); page.screenshot(path=OUT + r"\p20.png"); print("20 errs", errs[:4])
    b.close()
