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
    def go(n, wait=7):
        errs.clear(); page.goto(BASE + f"/lab.html?piece={n}", wait_until="load", timeout=30000); time.sleep(wait)
    for n, steps in [(38, "set"), (39, "flow"), (40, "profile")]:
        try:
            go(n, 4)
            if steps == "set":
                page.screenshot(path=OUT + r"\p38a.png"); page.get_by_role("button", name="Start today's set").click(timeout=5000); time.sleep(6)
                page.get_by_role("button", name="2 Kicker").click(timeout=5000); time.sleep(0.3); page.get_by_role("button", name="Check").click(timeout=5000); time.sleep(1); page.screenshot(path=OUT + r"\p38b.png")
            elif steps == "flow":
                page.screenshot(path=OUT + r"\p39a.png"); page.get_by_role("button", name="Start").click(timeout=5000); time.sleep(7)
                box = page.locator("canvas").first.bounding_box(); print("canvas", box)
                page.mouse.move(box["x"] + box["width"] * 0.45, box["y"] + box["height"] * 0.5); time.sleep(0.4); page.mouse.click(box["x"] + box["width"] * 0.45, box["y"] + box["height"] * 0.5); time.sleep(0.6)
                page.screenshot(path=OUT + r"\p39t.png")
                page.get_by_role("button", name="Check").click(timeout=5000); time.sleep(3); page.screenshot(path=OUT + r"\p39b.png")
            else:
                page.screenshot(path=OUT + r"\p40.png")
            print(n, "ok", errs[:2])
        except Exception as e:
            print(n, "FAIL", str(e)[:160], errs[:2])
    b.close()
