import time, json, re, sys
from playwright.sync_api import sync_playwright
ENV = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\sandbox_env.json"
OUT = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study"
BASE = "http://127.0.0.1:5232"
env = json.load(open(ENV))
only = sys.argv[1:]
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1366, "height": 960})
    ctx.request.post("http://127.0.0.1:8077/api/auth/login", data={"email": env["EMAIL"], "password": env["UCT_SANDBOX_PASSWORD"]})
    page = ctx.new_page(); errs = []
    page.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)[:200]))
    page.on("console", lambda m: errs.append("CONSOLE " + m.text[:160]) if m.type == "error" and "503" not in m.text else None)
    def go(n, wait=4):
        errs.clear(); page.goto(BASE + f"/lab.html?piece={n}", wait_until="load", timeout=30000); time.sleep(wait)
    def shot(name): page.screenshot(path=OUT + rf"\{name}.png")
    def step(name, fn):
        try: fn(); print(name, "ok", errs[:3])
        except Exception as e: print(name, "FAIL", str(e)[:160], errs[:3])
    def chart_box(page):
        for c in page.locator("canvas").all():
            bb = c.bounding_box()
            if bb and bb["width"] > 300: return bb
        return None
    def font(): return page.evaluate("() => getComputedStyle(document.querySelector('button') || document.body).fontFamily")
    def r52():
        go(52, 3); print("font:", font()); shot("p52"); page.get_by_role("button", name="fire").click(); time.sleep(1); shot("p52b")
    def r53():
        go(53, 2); page.evaluate("() => localStorage.setItem('study.blitz.tutorialSeen','1')"); go(53, 6); shot("p53a")
        page.get_by_role("button", name=re.compile("Start the clock")).click(); time.sleep(6); shot("p53b")
        for k in range(6):
            tag = page.evaluate("() => { const e = document.querySelector('[class*=qSetup]'); return e ? e.textContent : '' }"); print("  q", k, tag)
            page.keyboard.press("1"); time.sleep(2.6)
            if k == 1: shot("p53c")
            if k == 3: shot("p53d")
        txt = page.evaluate("() => document.body.innerText"); print("blitz points line:", re.findall(r"(\d+)\s*\n\s*POINTS", txt)[:1])
    def r54():
        go(54, 6); shot("p54a")
        page.get_by_role("button", name=re.compile("Face the boss")).click(); time.sleep(6); shot("p54b")
        page.keyboard.press("1"); time.sleep(0.3); page.get_by_role("button", name="Check").click(timeout=5000); time.sleep(3.5); shot("p54c")
    def r55():
        go(55, 3); shot("p55a")
        page.get_by_role("button", name=re.compile("Start hard mode")).click(); time.sleep(6)
        page.keyboard.press("2"); time.sleep(0.3); page.get_by_role("button", name="Check").click(timeout=5000); time.sleep(1.2); shot("p55b")
        page.get_by_role("button", name="Next").click(timeout=5000); time.sleep(2); shot("p55c")
        box = chart_box(page)
        # tap on the entry line: find the y of price 11.05 by probing — click at 55% x, then read the live Entry cell
        for fy in (0.45, 0.5, 0.55, 0.6):
            page.mouse.move(box["x"] + box["width"] * 0.55, box["y"] + box["height"] * fy); time.sleep(0.25); page.mouse.click(box["x"] + box["width"] * 0.55, box["y"] + box["height"] * fy); time.sleep(0.6)
            v = page.evaluate("() => { const b = Array.from(document.querySelectorAll('b')).map(x => x.textContent); return b.join('|') }")
            m = re.search(r"\$(1[01]\.\d\d)\|", v)
            print("tap", fy, "->", m.group(1) if m else v[:60])
            if m and abs(float(m.group(1)) - 11.05) < 0.08: break
        page.get_by_role("button", name="Check").click(timeout=5000); time.sleep(1.2); shot("p55d")
        page.get_by_role("button", name="Next").click(timeout=5000); time.sleep(1.5)
        page.mouse.move(box["x"] + box["width"] * 0.55, box["y"] + box["height"] * 0.7); time.sleep(0.25); page.mouse.click(box["x"] + box["width"] * 0.55, box["y"] + box["height"] * 0.7); time.sleep(0.6)
        page.get_by_role("button", name="Check").click(timeout=5000); time.sleep(1.2); shot("p55e")
        page.get_by_role("button", name=re.compile("Watch it run")).click(timeout=5000); time.sleep(5); shot("p55f")
    def r56():
        go(56, 7); shot("p56a")
        box = chart_box(page)
        x = box["x"] + box["width"] * 0.5; y = box["y"] + box["height"] * 0.7
        page.mouse.move(x, y); time.sleep(0.4); page.mouse.click(x, y); time.sleep(1.0); print("tap stop ->", page.evaluate("() => (document.querySelector('input[type=number]')||{}).value"))
        up = page.locator("button[title='hold to slide up']"); bb = up.bounding_box(); page.mouse.move(bb["x"] + 10, bb["y"] + 10); page.mouse.down(); time.sleep(1.4); page.mouse.up(); time.sleep(0.3)
        print("after hold ->", page.evaluate("() => (document.querySelector('input[type=number]')||{}).value")); shot("p56b")
        page.get_by_role("button", name=re.compile("Check my stop")).click(timeout=5000); time.sleep(4); shot("p56c")
    def r57():
        go(57, 7); shot("p57a")
        box = chart_box(page); page.mouse.move(box["x"] + box["width"] * 0.905, box["y"] + box["height"] * 0.4); time.sleep(0.4); page.mouse.click(box["x"] + box["width"] * 0.905, box["y"] + box["height"] * 0.4); time.sleep(0.8); shot("p57b")
        page.get_by_role("button", name="Check").click(timeout=5000); time.sleep(4); shot("p57c")
    for nm, fn in [x for x in [("52", r52), ("53", r53), ("54", r54), ("55", r55), ("56", r56), ("57", r57)] if not only or x[0] in only]: step(nm, fn)
    b.close()
