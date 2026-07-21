"""Phone-viewport geometry check for the read-aloud AudioPlayerBar.

The player bar is the ONLY stop control for read-aloud, so on a phone it must be
fully on screen, clear of the bottom tab bar, and actually tappable. That is a
pure-CSS property (the JS cancellation logic has no viewport branching), and
jsdom applies no CSS — so it is untestable in vitest. This renders the real
AudioPlayerBar.module.css at real phone viewports and asserts the geometry.

Run:  python tools/audio_bar_mobile_check.py
Exit: 0 = all viewports pass, 1 = a failure (prints what and where).
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
CSS = ROOT / "app/src/components/voice/AudioPlayerBar.module.css"

# Real MobileTabBar facts (app/src/components/mobile/MobileTabBar.module.css +
# tokens.css): pinned to bottom:0, z-index var(--z-nav)=300, min-height 44px.
TAB_BAR_H = 44
Z_NAV = 300

VIEWPORTS = [
    ("iPhone SE",        375, 667),
    ("iPhone 12/13/14",  390, 844),
    ("iPhone Plus/Max",  428, 926),
    ("small Android",    360, 740),
    ("tablet portrait",  768, 1024),
]

PAGE = """
<!doctype html><html><head><meta name="viewport" content="width=device-width">
<style>
  :root {{ --z-nav: {z_nav}; --tap-min: 44px; --font-sans: system-ui, sans-serif; }}
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; background: #0f110e; height: 3000px; }}
  .tabbar {{
    position: fixed; bottom: 0; left: 0; right: 0;
    min-height: {tab_h}px; z-index: var(--z-nav); background: #14160f;
  }}
{css}
</style></head><body>
  <!-- Mirrors AudioPlayerBar.jsx in read-aloud ('a') mode while playing. -->
  <div class="bar" role="region" aria-label="Audio playback">
    <button class="iconBtn skipBtn" aria-label="Back 15 seconds">B</button>
    <button class="iconBtn" aria-label="Pause">P</button>
    <button class="iconBtn skipBtn" aria-label="Forward 15 seconds">F</button>
    <div class="label">Morning Wire</div>
    <span class="time">1:07</span>
    <input class="seek" type="range" min="0" max="434" value="67" aria-label="Seek">
    <span class="time">7:14</span>
    <select class="speedSel voiceSel" aria-label="Reader voice"><option>Alloy</option></select>
    <select class="speedSel" aria-label="Playback speed"><option>1.25x</option></select>
    <button class="iconBtn stopBtn" aria-label="Stop">X</button>
  </div>
  <nav class="tabbar"></nav>
</body></html>
"""


def check(page, name, w, h):
    fails = []
    bar = page.locator(".bar")
    stop = page.locator('[aria-label="Stop"]')
    b = bar.bounding_box()
    s = stop.bounding_box()

    if b is None or s is None:
        return [f"{name}: bar or Stop button did not render"]

    # 1. The whole bar must be on screen.
    if b["x"] < 0 or b["x"] + b["width"] > w + 0.5:
        fails.append(
            f"{name} ({w}x{h}): bar overflows horizontally — "
            f"x={b['x']:.0f} w={b['width']:.0f} viewport={w}"
        )
    if b["y"] < 0 or b["y"] + b["height"] > h + 0.5:
        fails.append(f"{name} ({w}x{h}): bar off-screen vertically — y={b['y']:.0f} h={b['height']:.0f}")

    # 2. The Stop button must be fully on screen — it is the only way to stop.
    if s["x"] < 0 or s["x"] + s["width"] > w + 0.5:
        fails.append(
            f"{name} ({w}x{h}): STOP BUTTON CLIPPED — "
            f"x={s['x']:.0f} right={s['x'] + s['width']:.0f} viewport={w}"
        )

    # 3. The bar must clear the bottom tab bar entirely.
    if b["y"] + b["height"] > h - TAB_BAR_H + 0.5:
        fails.append(
            f"{name} ({w}x{h}): bar overlaps the {TAB_BAR_H}px tab bar — "
            f"bar bottom={b['y'] + b['height']:.0f}, tab bar top={h - TAB_BAR_H}"
        )

    # 4. Hit-test: a real tap on Stop must land inside the Stop button.
    cx, cy = s["x"] + s["width"] / 2, s["y"] + s["height"] / 2
    hit = page.evaluate(
        """([x, y]) => {
            const el = document.elementFromPoint(x, y);
            if (!el) return 'nothing';
            const btn = el.closest('button');
            return btn ? (btn.getAttribute('aria-label') || 'button') : el.className || el.tagName;
        }""",
        [cx, cy],
    )
    if hit != "Stop":
        fails.append(f"{name} ({w}x{h}): tap at Stop centre hits '{hit}' — button is covered")

    # 5. On touch viewports the project mandates a 44px minimum tap target
    #    (--tap-min in tokens.css). Stop is the control that matters most.
    if w <= 640 and (s["width"] < 44 or s["height"] < 44):
        fails.append(
            f"{name} ({w}x{h}): Stop tap target {s['width']:.0f}x{s['height']:.0f} "
            f"is under the 44px --tap-min"
        )

    return fails


def main():
    css = CSS.read_text(encoding="utf-8")
    html = PAGE.format(css=css, tab_h=TAB_BAR_H, z_nav=Z_NAV)
    all_fails = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for name, w, h in VIEWPORTS:
            page = browser.new_page(viewport={"width": w, "height": h}, is_mobile=True, has_touch=True)
            page.set_content(html)
            page.wait_for_timeout(120)
            fails = check(page, name, w, h)
            print(("  FAIL " if fails else "  ok   ") + f"{name:<18} {w}x{h}")
            for f in fails:
                print("         " + f)
            all_fails += fails
            page.close()
        browser.close()
    print()
    if all_fails:
        print(f"{len(all_fails)} problem(s)")
        return 1
    print("all viewports pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
