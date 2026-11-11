# LIVE-SITE CHECK of the daily drill after the #792 deploy: its OWN Playwright context signed in as the synthetic
# smoke account (never the owner's Chrome, never the owner's login), opens Desk > Courses > Today's drill on PC and
# phone and screenshots the question screen. It answers NOTHING (the smoke account must not accumulate study state
# beyond the day's session row the drill itself creates on open).
import os, sys, time, json, winreg
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "show")
SITE = "https://uctintelligence.com"

def user_env(name):
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as k:
        return winreg.QueryValueEx(k, name)[0]

EMAIL, PASSWORD = user_env("SMOKE_EMAIL"), user_env("SMOKE_PASSWORD")
assert EMAIL.endswith("@uctintelligence.internal"), "only the synthetic smoke account may sign in on production"
errs = []

with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    for tag, vp, dsf, touch in (("pc", {"width": 1366, "height": 960}, 2, False), ("phone", {"width": 390, "height": 844}, 3, True)):
        ctx = b.new_context(viewport=vp, device_scale_factor=dsf, is_mobile=touch, has_touch=touch)
        ctx.add_init_script("window.__uctLogoPhase = 0.55")
        r = ctx.request.post(SITE + "/api/auth/login", data={"email": EMAIL, "password": PASSWORD})
        me = ctx.request.get(SITE + "/api/auth/me")
        who = (me.json().get("email") if me.ok else "") or ""
        print(tag, "login", r.status, "me", me.status, "domain", who.split("@")[-1])
        assert who.endswith("@uctintelligence.internal"), "signed-in identity is not the smoke account; stopping"
        page = ctx.new_page(); page.on("pageerror", lambda e: errs.append(f"{tag}: {e}"))
        page.goto(SITE + "/desk?section=courses&study=today", wait_until="load"); time.sleep(10)
        # the intro overlay, if it plays, takes a click anywhere; Escape is also wired
        page.keyboard.press("Escape"); time.sleep(1)
        if not page.locator("[data-testid=primary-action]").count():
            time.sleep(8)
        page.screenshot(path=os.path.join(OUT, f"live_{tag}_drill.png"), full_page=False)
        has = {
            "primary-action": page.locator("[data-testid=primary-action]").count(),
            "bubble(d5.ask)": page.locator("[class*=ask]").count(),
            "chart": page.locator("[class*=chartBox]").count(),
            "choices": page.locator("[class*=choices]").count(),
            "mark(3D canvas or still)": page.locator("[data-study-mark], canvas").count(),
            "loading": page.locator("[data-testid=study-loading]").count(),
        }
        print(tag, json.dumps(has))
        ctx.request.post(SITE + "/api/auth/logout")
        ctx.close()
    b.close()
print("page errors:", errs[:5]); print("done")
