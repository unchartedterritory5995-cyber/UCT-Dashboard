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
    page.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)[:200]))
    try:
        page.goto(BASE + "/lab.html?piece=42", wait_until="load", timeout=30000); time.sleep(4); page.get_by_role("button", name="I'm ready").click(timeout=5000); time.sleep(6)
        page.locator("button", has_text="Slingshot").first.click(timeout=5000); time.sleep(0.3); page.get_by_role("button", name="Check").click(timeout=5000); time.sleep(1); page.screenshot(path=OUT + r"\p42a.png")
        page.get_by_role("button", name="See what to review").click(timeout=5000); time.sleep(2); page.screenshot(path=OUT + r"\p42b.png"); print("42 ok", errs[:2])
    except Exception as e: print("42 FAIL", str(e)[:140], errs[:2])
    try:
        page.goto(BASE + "/lab.html?piece=45", wait_until="load", timeout=30000); time.sleep(7)
        cands = page.locator("button", has_text="2023-"); print("cands", cands.count())
        cands.last.click(timeout=5000); time.sleep(0.4); page.get_by_role("button", name="Check").click(timeout=5000); time.sleep(1.5); page.screenshot(path=OUT + r"\p45b.png"); print("45 ok", errs[:2])
    except Exception as e: print("45 FAIL", str(e)[:140], errs[:2])
    b.close()
