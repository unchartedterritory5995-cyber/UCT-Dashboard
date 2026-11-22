# "show me": viewport screenshots of the key screens, desktop and phone, saved under show/
import time, json, re, os, sys
ONLY = sys.argv[1] if len(sys.argv) > 1 else None
from playwright.sync_api import sync_playwright
ENV = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\sandbox_env.json"
OUT = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\show"
os.makedirs(OUT, exist_ok=True)
env = json.load(open(ENV))
def chart(page):
    for c in page.locator("canvas").all():
        bb = c.bounding_box()
        if bb and bb["width"] > 200: return bb
def run(ctx, tag, touch):
    page = ctx.new_page()
    tap = (lambda x, y: page.touchscreen.tap(x, y)) if touch else (lambda x, y: (page.mouse.move(x, y), time.sleep(0.3), page.mouse.click(x, y)))
    click = (lambda loc: loc.tap()) if touch else (lambda loc: loc.click())
    def shot(n): page.screenshot(path=os.path.join(OUT, f"{tag}_{n}.png"))
    page.goto("http://127.0.0.1:5232/lab.html?piece=52", wait_until="load"); time.sleep(5); shot("1_logo")
    page.goto("http://127.0.0.1:5232/lab.html?piece=53", wait_until="load"); time.sleep(2); page.evaluate("() => localStorage.setItem('study.blitz.tutorialSeen','1')")
    page.goto("http://127.0.0.1:5232/lab.html?piece=53", wait_until="load"); time.sleep(7); shot("2_blitz_start")
    click(page.get_by_role("button", name=re.compile("Start the clock"))); time.sleep(6); shot("3_blitz_play")
    page.goto("http://127.0.0.1:5232/lab.html?piece=54", wait_until="load"); time.sleep(6); shot("4_boss_start")
    page.goto("http://127.0.0.1:5232/lab.html?piece=55", wait_until="load"); time.sleep(4); click(page.get_by_role("button", name=re.compile("Start hard mode"))); time.sleep(6)
    click(page.locator("button[class*=card]").nth(1)); time.sleep(0.3); click(page.get_by_role("button", name="Check")); time.sleep(1.5); click(page.get_by_role("button", name="Next")); time.sleep(2); shot("5_hard_enter")
    bb = chart(page); tap(bb["x"] + bb["width"] * 0.5, bb["y"] + bb["height"] * 0.42); time.sleep(0.8); click(page.get_by_role("button", name="Check")); time.sleep(1.5); shot("6_hard_enter_checked")
    page.goto("http://127.0.0.1:5232/lab.html?piece=56", wait_until="load"); time.sleep(7); bb = chart(page); tap(bb["x"] + bb["width"] * 0.5, bb["y"] + bb["height"] * 0.62); time.sleep(1); shot("7_draw_tap")
    click(page.get_by_role("button", name=re.compile("Check my stop"))); time.sleep(5); shot("8_draw_check")
    page.goto("http://127.0.0.1:5232/lab.html?piece=57", wait_until="load"); time.sleep(7); shot("9_trap_ask"); click(page.locator("button[class*=cand]").nth(0)); time.sleep(0.5); click(page.get_by_role("button", name="Check")); time.sleep(5); shot("10_trap_check")
    page.close()
with sync_playwright() as p:
    b = p.chromium.launch()
    if ONLY in (None, "pc"):
     ctx = b.new_context(viewport={"width": 1366, "height": 960}); ctx.request.post("http://127.0.0.1:8077/api/auth/login", data={"email": env["EMAIL"], "password": env["UCT_SANDBOX_PASSWORD"]}); run(ctx, "pc", False); ctx.close()
    if ONLY in (None, "phone"):
     ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True); ctx.request.post("http://127.0.0.1:8077/api/auth/login", data={"email": env["EMAIL"], "password": env["UCT_SANDBOX_PASSWORD"]}); run(ctx, "phone", True); ctx.close()
    b.close()
print("done")
