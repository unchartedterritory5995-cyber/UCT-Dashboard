import time, json, re
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
    page.on("console", lambda m: errs.append("CONSOLE " + m.text[:160]) if m.type == "error" else None)
    page.on("response", lambda r: errs.append("HTTP " + str(r.status) + " " + r.url[:120]) if r.status >= 500 else None)
    def go(n, wait=4):
        errs.clear(); page.goto(BASE + f"/lab.html?piece={n}", wait_until="load", timeout=30000); time.sleep(wait)
    def shot(name): page.screenshot(path=OUT + rf"\{name}.png")
    def step(name, fn):
        try: fn(); print(name, "ok", errs[:3])
        except Exception as e: print(name, "FAIL", str(e)[:160], errs[:3])
    def stop_of():
        return page.evaluate("() => { const i = document.querySelector('input[type=number]'); return i ? i.value : null }")
    def r46():
        go(46, 3); shot("p46"); page.get_by_role("button", name="fire").click(); time.sleep(1); shot("p46b")
    def r47():
        page.evaluate("() => localStorage.removeItem('study.blitz.tutorialSeen')")
        go(47, 3); shot("p47a")
        page.get_by_role("button", name=re.compile("Try one, no clock")).click(); time.sleep(5); shot("p47b")
        page.keyboard.press("2"); time.sleep(2.5); shot("p47c")
        page.get_by_role("button", name=re.compile("Start the clock")).click(); time.sleep(5); page.keyboard.press("1"); time.sleep(4); shot("p47d")
        go(47, 3); shot("p47e")
    def r48():
        go(48, 3); shot("p48a")
        page.get_by_role("button", name=re.compile("Face the boss")).click(); time.sleep(6); shot("p48b")
        page.keyboard.press("1"); time.sleep(0.3); page.get_by_role("button", name="Check").click(timeout=5000); time.sleep(2.2); shot("p48c")
        page.get_by_role("button", name="Next").click(timeout=5000); time.sleep(6)
        page.keyboard.press("4"); time.sleep(0.3); page.get_by_role("button", name="Check").click(timeout=5000); time.sleep(1.2); shot("p48d")
        page.get_by_role("button", name=re.compile("See what to review")).click(timeout=5000); time.sleep(1.5); shot("p48e")
    def r49():
        go(49, 3); shot("p49a")
        page.get_by_role("button", name=re.compile("Start hard mode")).click(); time.sleep(5.2); shot("p49b"); time.sleep(2); shot("p49c")
        page.keyboard.press("2"); time.sleep(0.3); page.get_by_role("button", name="Check").click(timeout=5000); time.sleep(2.2); shot("p49d")
    def r50():
        go(50, 7); shot("p50a")
        box = page.locator("canvas").first.bounding_box()
        x = box["x"] + box["width"] * 0.55; y = box["y"] + box["height"] * 0.62
        page.mouse.move(x, y); time.sleep(0.4); page.mouse.click(x, y); time.sleep(1.2); print("tap stop ->", stop_of()); shot("p50b")
        hr = page.locator("button[title='Horizontal Ray (Alt+J)']"); print("ray buttons", hr.count())
        if hr.count(): hr.first.click(); time.sleep(0.4); page.mouse.move(x, y - 40); time.sleep(0.3); page.mouse.click(x, y - 40); time.sleep(1.2); print("ray stop ->", stop_of())
        page.get_by_role("button", name=re.compile("Check my stop")).click(timeout=5000); time.sleep(2.5); shot("p50c")
    def r51():
        go(51, 7); shot("p51a"); time.sleep(0.4); shot("p51a2")
        box = page.locator("canvas").first.bounding_box(); page.mouse.move(box["x"] + box["width"] * 0.905, box["y"] + box["height"] * 0.4); time.sleep(0.4); page.mouse.click(box["x"] + box["width"] * 0.905, box["y"] + box["height"] * 0.4); time.sleep(0.8); shot("p51b")
        page.get_by_role("button", name="Check").click(timeout=5000); time.sleep(2.5); shot("p51c")
    import sys
    only = sys.argv[1:]
    for nm, fn in [x for x in [("46", r46), ("47", r47), ("48", r48), ("49", r49), ("50", r50), ("51", r51)] if not only or x[0] in only]: step(nm, fn)
    b.close()
