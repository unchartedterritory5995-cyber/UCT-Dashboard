# The PRODUCT challenges (lab pieces 61-63 render the real components on the sandbox bank): start, play, verdict,
# on PC and phone. Signs the sandbox in through the API first (cookies are per host, shared by 8077 and 5232).
import time, json, os, re, sys
from playwright.sync_api import sync_playwright
ONLY = sys.argv[1] if len(sys.argv) > 1 else None
ENV = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\sandbox_env.json"
OUT = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\show"
A = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
env = json.load(open(ENV))
errs = []

def run(ctx, tag, touch):
    page = ctx.new_page()
    page.on("pageerror", lambda e: errs.append(f"{tag}: {e}"))
    click = (lambda loc: loc.tap()) if touch else (lambda loc: loc.click())
    def shot(n): page.screenshot(path=os.path.join(OUT, f"ch_{tag}_{n}.png"), full_page=True)
    # Blitz
    page.goto("http://127.0.0.1:5232/lab.html?piece=61", wait_until="load"); time.sleep(7); shot("1_blitz_start")
    click(page.get_by_role("button", name=re.compile("Start the clock"))); time.sleep(5); shot("2_blitz_play")
    cards = page.locator("[data-testid=blitz-choices] button")
    if cards.count(): click(cards.nth(0)); time.sleep(2.5); shot("3_blitz_next")
    # Boss
    page.goto("http://127.0.0.1:5232/lab.html?piece=62", wait_until="load"); time.sleep(7); shot("4_boss_start")
    click(page.get_by_role("button", name=re.compile("Face the boss"))); time.sleep(5); shot("5_boss_q")
    click(page.locator("[class*=cards] button").nth(0)); time.sleep(0.4); click(page.get_by_test_id("boss-check")); time.sleep(4); shot("6_boss_verdict")
    # Spot the Kicker
    page.goto("http://127.0.0.1:5232/lab.html?piece=63", wait_until="load"); time.sleep(7); shot("7_kicker_start")
    click(page.get_by_role("button", name=re.compile("^Start"))); time.sleep(6); shot("8_kicker_ask")
    kc = page.locator("[data-testid=kicker-cards] button")
    if kc.count(): click(kc.nth(kc.count() - 1)); time.sleep(0.5); click(page.get_by_test_id("kicker-check")); time.sleep(5); shot("9_kicker_verdict")
    page.close()

with sync_playwright() as p:
    b = p.chromium.launch(args=A)
    for tag, vp, dsf, touch in (("pc", {"width": 1366, "height": 960}, 2, False), ("phone", {"width": 390, "height": 844}, 3, True)):
        if ONLY and ONLY != tag: continue
        ctx = b.new_context(viewport=vp, device_scale_factor=dsf, is_mobile=touch, has_touch=touch)
        ctx.add_init_script("window.__uctLogoPhase = 0.55")
        r = ctx.request.post("http://127.0.0.1:8077/api/auth/login", data={"email": env["EMAIL"], "password": env["UCT_SANDBOX_PASSWORD"]})
        print(tag, "login", r.status)
        run(ctx, tag, touch); ctx.close()
    b.close()
print("page errors:", errs[:8])
print("done")
