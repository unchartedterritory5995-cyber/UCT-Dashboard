"""Round-3 interaction probe: replay mid-play shots, finish card, and the failed requests on the widget piece."""
import time, json
from playwright.sync_api import sync_playwright
ENV = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\sandbox_env.json"
OUT = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study"
BASE = "http://127.0.0.1:5232"
env = json.load(open(ENV))
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1280, "height": 860})
    r = ctx.request.post("http://127.0.0.1:8077/api/auth/login", data={"email": env["EMAIL"], "password": env["UCT_SANDBOX_PASSWORD"]})
    print("login", r.status)
    page = ctx.new_page()
    bad = []
    page.on("response", lambda res: bad.append((res.status, res.url[:120])) if res.status >= 400 else None)
    page.goto(BASE + "/lab.html?piece=11", wait_until="load", timeout=30000); time.sleep(6)
    print("piece 11 failed responses:"); [print("  ", s, u) for s, u in bad]
    page.goto(BASE + "/lab.html?piece=14", wait_until="load", timeout=30000); time.sleep(4)
    page.get_by_role("button", name="Play", exact=True).click(); time.sleep(2.6)
    page.screenshot(path=OUT + r"\p14a.png")
    time.sleep(3.0)
    page.screenshot(path=OUT + r"\p14b.png")
    print("day text:", page.locator("text=/day \d+ of/").first.inner_text())
    page.goto(BASE + "/lab.html?piece=15", wait_until="load", timeout=30000); time.sleep(2)
    page.get_by_role("button", name="Finish the lesson").click(); time.sleep(2.5)
    page.screenshot(path=OUT + r"\p15b.png")
    b.close()
