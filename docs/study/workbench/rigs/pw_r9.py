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
    def go(n, wait=4):
        errs.clear(); page.goto(BASE + f"/lab.html?piece={n}", wait_until="load", timeout=30000); time.sleep(wait)
    def step(name, fn):
        try: fn(); print(name, "ok", errs[:2])
        except Exception as e: print(name, "FAIL", str(e)[:140], errs[:2])
    def r41():
        go(41); page.get_by_role("button", name="Start the clock").click(timeout=5000); time.sleep(6); page.keyboard.press("1"); time.sleep(5); page.screenshot(path=OUT + r"\p41.png")
    def r42():
        go(42); page.get_by_role("button", name="I'm ready").click(timeout=5000); time.sleep(6); page.get_by_role("button", name="Check").click(timeout=5000); time.sleep(1); page.screenshot(path=OUT + r"\p42a.png")
        page.locator("button", has_text="see what to review").or_(page.locator("button", has_text="Next")).first.click(timeout=5000); time.sleep(2); page.screenshot(path=OUT + r"\p42b.png")
    def r43():
        go(43); page.get_by_role("button", name="Start hard mode").click(timeout=5000); time.sleep(7); page.screenshot(path=OUT + r"\p43.png")
    def r44():
        go(44, 7); page.screenshot(path=OUT + r"\p44.png")
    def r45():
        go(45, 7); page.screenshot(path=OUT + r"\p45a.png")
        box = page.locator("canvas").first.bounding_box(); page.mouse.move(box["x"] + box["width"] * 0.93, box["y"] + box["height"] * 0.4); time.sleep(0.4); page.mouse.click(box["x"] + box["width"] * 0.93, box["y"] + box["height"] * 0.4); time.sleep(0.5)
        page.get_by_role("button", name="Check").click(timeout=5000); time.sleep(1.5); page.screenshot(path=OUT + r"\p45b.png")
    for nm, fn in [("41", r41), ("42", r42), ("43", r43), ("44", r44), ("45", r45)]: step(nm, fn)
    b.close()
