# The daily drill in the workbench look (lab piece 64): question, reveal (stamp, run-on, card colours, lesson card),
# and the end card, on PC and phone, against the sandbox's Today set.
import time, json, os, sys
from playwright.sync_api import sync_playwright
ONLY = sys.argv[1] if len(sys.argv) > 1 else None
HERE = os.path.dirname(os.path.abspath(__file__))
ENV = json.load(open(os.path.join(HERE, "sandbox_env.json")))
OUT = os.path.join(HERE, "show")
A = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
errs = []

def answer_one(page, touch, shot=None):
    """Answer the current item however it asks, Check, wait for the reveal, optionally screenshot, then Continue."""
    click = (lambda loc: loc.tap()) if touch else (lambda loc: loc.click())
    radios = page.locator("[role=radio]")
    if radios.count():
        click(radios.nth(0)); time.sleep(0.4)
    elif page.locator("[data-testid=tap-hud]").count():
        for c in page.locator("canvas").all():
            bb = c.bounding_box()
            if bb and bb["width"] > 200:
                x, y = bb["x"] + bb["width"] * 0.6, bb["y"] + bb["height"] * 0.5
                (page.touchscreen.tap(x, y) if touch else page.mouse.click(x, y)); time.sleep(0.6); break
    else:
        inputs = page.locator("input[type=number], input[type=text]")
        for k in range(inputs.count()): inputs.nth(k).fill("100"); time.sleep(0.2)
    btn = page.get_by_test_id("primary-action")
    if btn.count() and btn.is_enabled():
        click(btn); time.sleep(3.5)
        if shot: shot()
        btn = page.get_by_test_id("primary-action")
        if btn.count(): click(btn); time.sleep(1.5)
    else:
        return False
    return True

def run(ctx, tag, touch):
    page = ctx.new_page(); page.on("pageerror", lambda e: errs.append(f"{tag}: {e}"))
    def shot(n): page.screenshot(path=os.path.join(OUT, f"drill_{tag}_{n}.png"), full_page=True)
    page.goto("http://127.0.0.1:5232/lab.html?piece=64&set=free", wait_until="load"); time.sleep(7)
    shot("1_question")
    answer_one(page, touch, shot=lambda: shot("2_reveal"))
    for i in range(14):
        if page.get_by_test_id("end-card").count(): break
        if not answer_one(page, touch): break
    time.sleep(1.5); shot("3_end")
    page.close()

with sync_playwright() as p:
    b = p.chromium.launch(args=A)
    for tag, vp, dsf, touch in (("pc", {"width": 1366, "height": 960}, 2, False), ("phone", {"width": 390, "height": 844}, 3, True)):
        if ONLY and ONLY != tag: continue
        ctx = b.new_context(viewport=vp, device_scale_factor=dsf, is_mobile=touch, has_touch=touch)
        ctx.add_init_script("window.__uctLogoPhase = 0.55")
        r = ctx.request.post("http://127.0.0.1:8077/api/auth/login", data={"email": ENV["EMAIL"], "password": ENV["UCT_SANDBOX_PASSWORD"]})
        print(tag, "login", r.status)
        run(ctx, tag, touch); ctx.close()
    b.close()
print("page errors:", errs[:6]); print("done")
