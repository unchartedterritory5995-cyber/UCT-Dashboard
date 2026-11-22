"""Brand asset export for the decided Study mark (step 12, glow down). Renders lab piece 59 (the bare export stage)
headlessly with software WebGL and writes:
  app/public/brand/study-mark-256.png, study-mark-512.png        (transparent; the product's still fallback)
  docs/brand/study-mark/study-mark-{1024,128,64}.png              (transparent)
  docs/brand/study-mark/study-mark-discord-512.png                (on the brand near-black)
  docs/brand/study-mark/study-mark-favicon-32.png + study-mark.ico (16/32/48/64)
  docs/brand/study-mark/study-mark-spin-256.gif                   (60 frames, one full turn, on the brand near-black)
Preconditions: the Vite lab on 127.0.0.1:5232 (piece 59 registered), Pillow on this Python.
"""
import io, math, time, sys
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

APP = Path(r"C:\Users\pgosz\uct-worktrees\study-hve-overlay\app")
PUB = APP / "public" / "brand"; DOC = APP.parent / "docs" / "brand" / "study-mark"
PUB.mkdir(parents=True, exist_ok=True); DOC.mkdir(parents=True, exist_ok=True)
URL = "http://127.0.0.1:5232/lab.html?piece=59"
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
DARK = (11, 11, 11, 255)
PHASE0 = 0.55

def shot(page, omit):
    el = page.locator("[data-export]").first
    return Image.open(io.BytesIO(el.screenshot(omit_background=omit, type="png"))).convert("RGBA")

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errs = []
    # ── the still, big, transparent ──
    ctx = b.new_context(viewport={"width": 1200, "height": 1200}, device_scale_factor=1)
    page = ctx.new_page(); page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(f"{URL}&size=1024&bg=transparent&phase={PHASE0}", wait_until="load"); time.sleep(5)
    big = shot(page, omit=True)
    assert big.size == (1024, 1024), big.size
    # the corners must be transparent (a non-transparent corner = the page background leaked into the asset)
    assert big.getpixel((2, 2))[3] == 0 and big.getpixel((1021, 1021))[3] == 0, "background leaked"
    big.save(DOC / "study-mark-1024.png", optimize=True)
    for n, where in ((512, PUB), (256, PUB), (128, DOC), (64, DOC)):
        big.resize((n, n), Image.LANCZOS).save(where / f"study-mark-{n}.png", optimize=True)
    disc = Image.new("RGBA", (512, 512), DARK); m = big.resize((440, 440), Image.LANCZOS); disc.alpha_composite(m, (36, 36))
    disc.convert("RGB").save(DOC / "study-mark-discord-512.png", optimize=True)
    big.resize((32, 32), Image.LANCZOS).save(DOC / "study-mark-favicon-32.png", optimize=True)
    big.resize((64, 64), Image.LANCZOS).save(DOC / "study-mark.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    ctx.close()
    # ── the spin ──
    N = 60
    ctx = b.new_context(viewport={"width": 400, "height": 400}, device_scale_factor=1)
    page = ctx.new_page(); page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(f"{URL}&size=256&bg=%230b0b0b&phase={PHASE0}", wait_until="load"); time.sleep(4)
    frames = []
    for i in range(N):
        page.evaluate(f"window.__uctLogoPhase = {PHASE0 + i * 2 * math.pi / N}")
        time.sleep(0.08)
        fr = shot(page, omit=False).convert("RGB")
        frames.append(fr.quantize(colors=128, method=Image.MEDIANCUT, dither=Image.FLOYDSTEINBERG))
    frames[0].save(DOC / "study-mark-spin-256.gif", save_all=True, append_images=frames[1:], duration=50, loop=0, optimize=True)
    ctx.close(); b.close()
    print("page errors:", errs[:5])
for f in sorted(list(PUB.glob("study-mark*")) + list(DOC.glob("study-mark*"))):
    print(f"{f.stat().st_size:>8}  {f}")
print("ok")
