import time, json, re
from playwright.sync_api import sync_playwright
ENV = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\sandbox_env.json"
env = json.load(open(ENV))
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    ctx.request.post("http://127.0.0.1:8077/api/auth/login", data={"email": env["EMAIL"], "password": env["UCT_SANDBOX_PASSWORD"]})
    page = ctx.new_page()
    def boxes(): return [c.bounding_box() for c in page.locator("canvas").all()]
    for n in (56, 55):
        page.goto(f"http://127.0.0.1:5232/lab.html?piece={n}", wait_until="load"); time.sleep(4)
        if n == 55:
            page.get_by_role("button", name=re.compile("Start hard mode")).click(); time.sleep(6)
            page.locator("button[class*=card]").nth(1).tap(); time.sleep(0.4); page.get_by_role("button", name="Check").tap(); time.sleep(1.5); page.get_by_role("button", name="Next").tap(); time.sleep(2)
        else: time.sleep(3)
        print(n, "canvases:", [(round(x["x"]), round(x["y"]), round(x["width"]), round(x["height"])) if x else None for x in boxes()])
        bb = [x for x in boxes() if x and x["width"] > 200][0]
        x, y = bb["x"] + bb["width"] * 0.5, bb["y"] + bb["height"] * 0.5
        print(n, "element at point:", page.evaluate("([x,y]) => { const e = document.elementFromPoint(x,y); return e ? e.tagName + '.' + (e.className||'').toString().slice(0,40) + ' ' + e.getAttribute('width') : null }", [x, y]))
        page.touchscreen.tap(x, y); time.sleep(0.8); print(n, "after touch tap: xh =", page.evaluate("() => JSON.stringify(window.__xh)"), "lastTap =", page.evaluate("() => JSON.stringify(window.__lastTap)"))
        page.evaluate("([x,y]) => { const e = document.elementFromPoint(x,y); e.dispatchEvent(new MouseEvent('mousemove', {clientX:x, clientY:y, bubbles:true})) }", [x, y]); time.sleep(0.5)
        print(n, "after synthetic mousemove: xh =", page.evaluate("() => JSON.stringify(window.__xh)"))
        page.mouse.move(x, y); time.sleep(0.5); print(n, "after real mouse move: xh =", page.evaluate("() => JSON.stringify(window.__xh)"))
    b.close()
