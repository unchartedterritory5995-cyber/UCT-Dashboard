"""Phone pass: 390 px wide, every piece 31-45: horizontal overflow, the main button inside the viewport, console warnings."""
import time, json
from playwright.sync_api import sync_playwright
ENV = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\sandbox_env.json"
OUT = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\phone"
import os; os.makedirs(OUT, exist_ok=True)
env = json.load(open(ENV))
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    ctx.request.post("http://127.0.0.1:8077/api/auth/login", data={"email": env["EMAIL"], "password": env["UCT_SANDBOX_PASSWORD"]})
    page = ctx.new_page(); warns = []
    page.on("console", lambda m: warns.append(m.text[:140]) if m.type in ("warning", "error") and "503" not in m.text and "Download the React DevTools" not in m.text else None)
    for n in [52, 53, 54, 55, 56, 57]:
        warns.clear()
        try:
            page.goto(f"http://127.0.0.1:5232/lab.html?piece={n}", wait_until="load", timeout=30000); time.sleep(6)
            over = page.evaluate("() => ({sw: document.scrollingElement.scrollWidth, iw: window.innerWidth, sh: document.scrollingElement.scrollHeight})")
            btns = page.locator("button").all()
            main = None
            for bt in btns:
                try:
                    t = (bt.inner_text() or "").strip().upper().split(chr(10))[0]
                    if t in ("CHECK", "CONTINUE", "START", "I'M READY", "START THE CLOCK", "START HARD MODE", "PLAY THE STORY", "PLAY · SPACE", "TRY ONE, NO CLOCK", "FACE THE BOSS", "CHECK MY STOP", "AGAIN"):
                        bb = bt.bounding_box(); main = (t, bb and round(bb["y"]), bb and round(bb["y"] + bb["height"])); break
                except Exception: pass
            page.screenshot(path=OUT + fr"\m{n}.png", full_page=True)
            print(n, "overflow" if over["sw"] > over["iw"] + 1 else "ok", over, "button", main, "warn", warns[:2])
        except Exception as e:
            print(n, "FAIL", str(e)[:120])
    b.close()
