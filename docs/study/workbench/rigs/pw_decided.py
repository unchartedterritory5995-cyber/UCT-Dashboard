import time
from playwright.sync_api import sync_playwright
OUT = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\show"
A = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
with sync_playwright() as p:
    b = p.chromium.launch(args=A); errs = []
    for name, vp, dsf, mobile in (("pc", {"width": 1366, "height": 960}, 2, False), ("phone", {"width": 390, "height": 844}, 3, True)):
        ctx = b.new_context(viewport=vp, device_scale_factor=dsf, is_mobile=mobile, has_touch=mobile)
        ctx.add_init_script("window.__uctLogoPhase = 0.55")
        for piece in (52, 60, 54):
            page = ctx.new_page(); page.on("pageerror", lambda e, piece=piece: errs.append(f"p{piece}: {e}"))
            page.goto(f"http://127.0.0.1:5232/lab.html?piece={piece}", wait_until="load"); time.sleep(5)
            page.screenshot(path=OUT + rf"\decided_{piece}_{name}.png", full_page=True)
            page.close()
        ctx.close()
    b.close()
print("errors:", errs[:6]); print("ok")
