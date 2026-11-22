import time
from playwright.sync_api import sync_playwright
OUT = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\show"
URL = "http://127.0.0.1:5232/lab.html?piece=58"
A = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
with sync_playwright() as p:
    b = p.chromium.launch(args=A); errs = []
    ctx = b.new_context(viewport={"width": 1366, "height": 960}, device_scale_factor=2)
    ctx.add_init_script("window.__uctLogoPhase = 0.55")
    page = ctx.new_page(); page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(URL, wait_until="load"); time.sleep(6)
    page.screenshot(path=OUT + r"\ladder_pc.png", full_page=True)
    page.locator("[class*=coinStage]").first.screenshot(path=OUT + r"\ladder_pc_step12.png")
    page.locator("button[class*=wayBtn]", has_text="fire").click(); time.sleep(2.5)
    page.locator("[class*=coinStage]").first.screenshot(path=OUT + r"\ladder_pc_step12_fire.png")
    page.locator("button[class*=wayBtn]", has_text="idle").click(); time.sleep(1)
    for n in (1, 6):
        page.locator("[class*=ladderCell]").nth(n).click(); time.sleep(1.5)
        page.locator("[class*=coinStage]").first.screenshot(path=OUT + rf"\ladder_pc_step{n}.png")
    ctx.close()
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True)
    ctx.add_init_script("window.__uctLogoPhase = 0.55")
    page = ctx.new_page(); page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(URL, wait_until="load"); time.sleep(6)
    page.screenshot(path=OUT + r"\ladder_phone.png", full_page=True)
    ctx.close(); b.close()
print("errors:", errs[:5]); print("ok")
