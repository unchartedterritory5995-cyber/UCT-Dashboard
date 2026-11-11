import time, json, re, sys
from playwright.sync_api import sync_playwright
ENV = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\sandbox_env.json"
OUT = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\hunt"
import os; os.makedirs(OUT, exist_ok=True)
BASE = "http://127.0.0.1:5232"
env = json.load(open(ENV))
W = int(sys.argv[1]) if len(sys.argv) > 1 else 1366
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": W, "height": 900})
    ctx.request.post("http://127.0.0.1:8077/api/auth/login", data={"email": env["EMAIL"], "password": env["UCT_SANDBOX_PASSWORD"]})
    page = ctx.new_page(); errs = []
    page.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)[:300]))
    page.on("console", lambda m: errs.append(f"CONSOLE[{m.type}] " + m.text[:220]) if m.type in ("error", "warning") and "503" not in m.text and "DevTools" not in m.text else None)
    page.on("response", lambda r: errs.append("HTTP " + str(r.status) + " " + r.url[:120]) if r.status >= 400 and "live-prices" not in r.url and "stream/bars" not in r.url else None)
    def go(n, wait=5): errs.clear(); page.goto(BASE + f"/lab.html?piece={n}", wait_until="load", timeout=30000); time.sleep(wait)
    def shot(name): page.screenshot(path=OUT + rf"\{W}_{name}.png", full_page=True)
    def chart_box():
        for c in page.locator("canvas").all():
            bb = c.bounding_box()
            if bb and bb["width"] > 300: return bb
        return None
    def overflow(): return page.evaluate("() => ({sw: document.scrollingElement.scrollWidth, iw: window.innerWidth})")
    def click(name, t=5000): page.get_by_role("button", name=re.compile(name)).first.click(timeout=t)
    def report(tag):
        ov = overflow(); print(f"[{W}] {tag}: overflow={'YES' if ov['sw'] > ov['iw'] + 1 else 'no'} errs={errs[:4]}"); errs.clear()
    # 54 Boss: wrong path then retry, then right path x2
    go(54); shot("54a"); report("boss intro")
    click("Face the boss"); time.sleep(6); shot("54b"); report("boss q1 loaded")
    page.keyboard.press("2"); click("Check"); time.sleep(3); shot("54c"); report("boss after check (No)")
    btn = page.get_by_role("button", name=re.compile("See what to review|Next")).first; txt = btn.inner_text(); btn.click(); time.sleep(2); shot("54d"); report("boss after " + txt)
    if "review" in txt.lower():
        click("Try the boss again"); time.sleep(6); shot("54e"); report("boss retry q1")
    page.keyboard.press("1"); click("Check"); time.sleep(3); report("boss check (Yes)")
    click("See what to review|Next"); time.sleep(5); shot("54f"); report("boss after q")
    # 55 Hard: wrong name, wrong entry tap, wrong stop, run, finish, again
    go(55); click("Start hard mode"); time.sleep(6); shot("55a"); report("hard q loaded")
    page.keyboard.press("1"); click("Check"); time.sleep(1.5); shot("55b"); report("hard wrong name")
    click("Next"); time.sleep(2); box = chart_box()
    page.mouse.move(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.85); time.sleep(0.3); page.mouse.click(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.85); time.sleep(0.8)
    click("Check"); time.sleep(1.5); shot("55c"); report("hard wrong entry")
    click("Next"); time.sleep(2)
    page.mouse.move(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.2); time.sleep(0.3); page.mouse.click(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.2); time.sleep(0.8)
    click("Check"); time.sleep(1.5); shot("55d"); report("hard wrong stop (above entry)")
    click("Watch it run"); time.sleep(8); shot("55e"); report("hard run")
    click("Finish"); time.sleep(2); shot("55f"); report("hard done")
    click("Again"); time.sleep(6); shot("55g"); report("hard again")
    # 56 Draw-it: tap, toggle ray, draw, toggle back, type, check, draw again
    go(56, 7); box = chart_box()
    page.mouse.move(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.6); time.sleep(0.3); page.mouse.click(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.6); time.sleep(0.8)
    report("draw tap"); click("draw it with the ray tool"); time.sleep(2); shot("56a"); report("draw ray mode")
    hr = page.locator("button[title='Horizontal Ray (Alt+J)']"); print("ray buttons", hr.count())
    if hr.count(): hr.first.click(); time.sleep(0.4); page.mouse.click(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.55); time.sleep(1); report("draw ray placed")
    click("back to tapping"); time.sleep(1.5); report("draw back to tap")
    page.fill("input[type=number]", "10.80"); time.sleep(0.5); click("Check my stop"); time.sleep(5); shot("56b"); report("draw check typed 10.80")
    click("Draw again"); time.sleep(2); shot("56c"); report("draw again")
    # 57 Trap: wrong pick then again then right
    go(57, 7); box = chart_box()
    page.locator("button[class*=cand]").nth(0).click(); time.sleep(0.8); click("Check"); time.sleep(5); shot("57a"); report("trap wrong A")
    click("Again"); time.sleep(2); report("trap again"); page.locator("button[class*=cand]").nth(2).click(); time.sleep(0.5); click("Check"); time.sleep(5); shot("57b"); report("trap right C")
    # 53 Blitz: play 8 answers
    go(53, 2); page.evaluate("() => localStorage.setItem('study.blitz.tutorialSeen','1')"); go(53, 7); click("Start the clock"); time.sleep(6)
    for k in range(8): page.keyboard.press(str(1 + k % 2)); time.sleep(2.2)
    shot("53a"); report("blitz 8 answers")
    # 52 logo
    go(52, 4); report("logo lab")
    b.close()
