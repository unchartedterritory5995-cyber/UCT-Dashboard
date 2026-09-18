"""WCAG contrast for the hub's bubble labels, COMPUTED FROM RENDERED PIXELS.

⛔ The point of this tool is that it does not trust CSS. The bubble is a translucent
material over a `backdrop-filter`, so the colour a member's eye receives behind a
label is a COMPOSITE — of the label plate, the accent wash, the blurred backdrop and
whatever the page is drawing underneath. No stylesheet states that number, and any
ratio derived from the declared `background` would be a different quantity wearing
the same name.

HOW THE BACKGROUND IS SAMPLED, and why it is not glyph detection: the page is shot
twice from the same scroll position — once normally, once with every bubble label set
to `visibility: hidden`. The second shot is the exact composited ground behind the
text. Cropping the label's own box out of it gives the background with no glyph
pixels in it at all.

⛔ REGIONS ARE NOT ASSUMED. `hub-scrim` deliberately excludes the bottom of the screen
(`CHART_SCRIM_EXCLUDE_BOTTOM`), so a fan spans a dimmed region and an UN-dimmed one and
those are different legibility problems. The scrim's real box is measured and each
bubble is assigned by where it actually sits.

⛔ AND IT CARRIES A CONTROL. A contrast function that cannot report a failure is
decoration; `--self-check` runs a known-failing pair and a known-passing pair through
the same code path that judges the product.
"""
from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hub_critique_capture import PROFILES, PTR_JS  # noqa: E402  — one authority

WCAG_AA_NORMAL = 4.5
WCAG_AA_LARGE = 3.0


def _srgb_to_lin(c: float) -> float:
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def luminance(rgb) -> float:
    r, g, b = (_srgb_to_lin(x) for x in rgb[:3])
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(fg, bg) -> float:
    l1, l2 = luminance(fg), luminance(bg)
    if l1 < l2:
        l1, l2 = l2, l1
    return (l1 + 0.05) / (l2 + 0.05)


def parse_rgb(css: str):
    """'rgb(1, 2, 3)' / 'rgba(1, 2, 3, 0.5)' -> (1, 2, 3). Alpha is dropped deliberately:
    the RENDERED pixel already carries the compositing, so re-applying alpha would
    double-count it."""
    nums = css.replace("rgba", "").replace("rgb", "").strip("() ").split(",")
    return tuple(int(float(n.strip())) for n in nums[:3])


def mean_rgb(img, box):
    """Mean colour of a crop, ignoring fully transparent pixels."""
    crop = img.crop(box).convert("RGB")
    px = list(crop.getdata())
    if not px:
        return None
    n = len(px)
    return (sum(p[0] for p in px) // n, sum(p[1] for p in px) // n, sum(p[2] for p in px) // n)


def self_check() -> int:
    """⛔ Prove the judgement can FAIL before anyone trusts a PASS."""
    fails = []
    # A known-FAILING pair: mid grey on mid grey. If this reports AA-pass, the maths is wrong.
    bad = contrast((119, 119, 119), (128, 128, 128))
    if bad >= WCAG_AA_LARGE:
        fails.append(f"a known-failing pair scored {bad:.2f} — the check cannot fail")
    # A known-PASSING pair: black on white is exactly 21.
    good = contrast((0, 0, 0), (255, 255, 255))
    if abs(good - 21.0) > 0.01:
        fails.append(f"black-on-white scored {good:.4f}, expected 21.00 — the maths is wrong")
    # Order must not matter.
    if abs(contrast((0, 0, 0), (255, 255, 255)) - contrast((255, 255, 255), (0, 0, 0))) > 1e-9:
        fails.append("contrast() is not symmetric")
    print(f"  known-failing pair  #777 on #808080 -> {bad:.2f}  (must be < {WCAG_AA_LARGE})")
    print(f"  known-passing pair  black on white  -> {good:.2f}  (must be 21.00)")
    for f in fails:
        print(f"  ⛔ {f}")
    print("  SELF-CHECK:", "FAILED" if fails else "ok — the instrument can report both verdicts")
    return 1 if fails else 0


MEASURE_JS = """
() => {
  const root = document.querySelector('[data-testid="hub-root"]');
  const scrim = document.querySelector('[data-testid="hub-scrim"]');
  const sb = scrim ? scrim.getBoundingClientRect() : null;
  const out = [];
  for (const el of document.querySelectorAll('[data-testid^="hub-bubble"]')) {
    const cs = getComputedStyle(el);
    const op = +cs.opacity;
    if (op < 0.05) continue;                           // not drawn at all
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    // the label is the text node's element; fall back to the bubble itself
    const label = el.querySelector('span, div') || el;
    const lr = label.getBoundingClientRect();
    const lcs = getComputedStyle(label);
    out.push({
      id: el.getAttribute('data-testid'),
      // ⛔ A DISABLED BUBBLE IS NOT A CONTRAST FAILURE. WCAG 1.4.3 exempts inactive
      // user-interface components, and `.bubbleDisabled` is 0.4 opacity BY DESIGN — it is
      // the one signal that says "this needs a symbol first". Grading it against AA would
      // manufacture a finding out of a deliberate affordance.
      disabled: op < 0.5,
      opacity: op,
      color: lcs.color,
      fontSize: lcs.fontSize,
      box: [r.x, r.y, r.width, r.height],
      labelBox: [lr.x, lr.y, lr.width, lr.height],
      // region: is this bubble inside the scrim's box, or below its bottom edge?
      region: (sb && r.y + r.height / 2 <= sb.y + sb.height) ? 'scrimmed' : 'un-scrimmed',
    });
  }
  return { scrim: sb ? [sb.x, sb.y, sb.width, sb.height] : null, bubbles: out,
           dpr: window.devicePixelRatio || 1 };
}
"""

HIDE_LABELS_JS = """
() => {
  for (const el of document.querySelectorAll('[data-testid^="hub-bubble"]')) {
    for (const kid of el.querySelectorAll('span, div')) kid.style.visibility = 'hidden';
  }
}
"""


def measure(page, theme, rows, out: Path):
    from PIL import Image

    info = page.evaluate(MEASURE_JS)
    if not info["bubbles"]:
        rows.append(dict(theme=theme, verdict="INCONCLUSIVE",
                         detail="no visible bubbles to measure — the fan did not open"))
        print(f"  [??  ] {theme}: no visible bubbles")
        return

    shot_text = Image.open(io.BytesIO(page.screenshot()))
    page.evaluate(HIDE_LABELS_JS)
    page.wait_for_timeout(120)
    shot_bg = Image.open(io.BytesIO(page.screenshot()))
    shot_text.save(out / f"contrast_{theme}_text.png")
    shot_bg.save(out / f"contrast_{theme}_bg.png")

    dpr = info["dpr"]
    for b in info["bubbles"]:
        x, y, w, h = b["labelBox"]
        if w < 2 or h < 2:
            continue
        box = (int(x * dpr), int(y * dpr), int((x + w) * dpr), int((y + h) * dpr))
        bg = mean_rgb(shot_bg, box)
        fg = parse_rgb(b["color"])
        if bg is None:
            continue
        ratio = contrast(fg, bg)
        size_px = float(b["fontSize"].replace("px", ""))
        # WCAG "large text" is >=18.66px bold or >=24px. These labels are neither, so the
        # bar is the NORMAL one. Stating it rather than quietly grading against the easier bar.
        bar = WCAG_AA_NORMAL
        if b["disabled"]:
            verdict = "EXEMPT"
        else:
            verdict = "PASS" if ratio >= bar else "FAIL"
        rows.append(dict(theme=theme, bubble=b["id"], region=b["region"],
                         fg=fg, bg=bg, ratio=round(ratio, 2), bar=bar,
                         font_px=size_px, disabled=b["disabled"],
                         opacity=round(b["opacity"], 2), verdict=verdict))
        mark = {"PASS": "ok  ", "FAIL": "FAIL", "EXEMPT": "n/a "}[verdict]
        tag = "  (disabled — WCAG 1.4.3 inactive-component exemption)" if b["disabled"] else ""
        print(f"  [{mark}] {theme:5s} {b['region']:11s} {b['id']:28s} "
              f"{ratio:5.2f}:1  fg={fg} bg={bg} {size_px:.0f}px{tag}")


def _prefs_route(theme):
    """⛔ A CLOSURE, NOT A DEFAULT ARGUMENT — Playwright INSPECTS THE HANDLER'S ARITY.

    ⚰️ `lambda route, t=theme: ...` looks like the ordinary fix for a late-bound loop
    variable. Playwright counts parameters and, seeing two, calls the handler with
    `(route, request)` — so `t` received a `Request` object and `json.dumps` raised
    inside the handler. The route was then never fulfilled, the harness's own
    preferences answer won, and the page came up in a THIRD theme (`oled`).

    ⭐ The tell was not the traceback. It was `theme not applied (oled)` — a value
    neither branch of the loop ever asks for. A wrong answer that is not one of your
    own options is pointing at something outside your options.
    """
    def handler(route):
        route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({
                "joystick_hub": json.dumps(
                    {"enabled": True, "handedness": "right", "surface": "simplified"}),
                "theme": theme,
            }),
        )
    return handler


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8131")
    ap.add_argument("--out", default="scratchpad/contrast")
    ap.add_argument("--profile", default="iphone", choices=sorted(PROFILES))
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args()

    if args.self_check:
        return self_check()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    rows: list[dict] = []

    # the instrument's own control runs FIRST, every time -- never opt-in
    print("  control:")
    if self_check() != 0:
        print("  ⛔ refusing to measure with a broken instrument")
        return 2
    print()

    from playwright.sync_api import sync_playwright

    prof = PROFILES[args.profile]
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--force-color-profile=srgb", "--disable-lcd-text"])
        try:
            for theme in ("dark", "light"):
                ctx = browser.new_context(**prof)
                ctx.route("**/api/auth/preferences", _prefs_route(theme))
                page = ctx.new_page()
                page.goto(f"{args.base}/charts", wait_until="domcontentloaded", timeout=45000)
                page.wait_for_timeout(2500)
                try:
                    page.keyboard.press("Escape")
                    page.wait_for_timeout(600)
                except Exception:
                    pass
                applied = page.evaluate(
                    "() => document.documentElement.dataset.theme || null")
                if applied != theme:
                    rows.append(dict(theme=theme, verdict="INCONCLUSIVE",
                                     detail=f"asked {theme}, page has {applied}"))
                    print(f"  [??  ] {theme}: theme not applied ({applied}) — nothing measured")
                    ctx.close()
                    continue
                # ⛔ MEASURED WHILE THE POINTER IS STILL DOWN, and that is not a shortcut.
                # ⚰️ `hub_critique_capture` says the state is photographed after release
                # "because stickyFan keeps it open". Probed on this build, at 600 ms after
                # pointerup the fan shows ZERO visible bubbles with stickyFan defaulted AND
                # with it stubbed true — the fan closes on release. The capture tool is
                # right, for a different reason than its comment gives: it measures BEFORE
                # releasing. A comment naming a mechanism is a claim about a run.
                #
                # Held at 700 ms the fan still shows 6 (probed), so waiting past the 0.3 s
                # backdrop-filter delay while held is safe and does not reclassify the
                # gesture as a HOLD — the move at 60 ms already settled that.
                page.evaluate(PTR_JS, ["pointerdown", 0, 0])
                page.wait_for_timeout(60)
                page.evaluate(PTR_JS, ["pointermove", 0, -46])
                page.wait_for_timeout(700)      # > the 0.3s backdrop-filter delay
                measure(page, theme, rows, out)
                page.evaluate(PTR_JS, ["pointerup", 0, -46])
                ctx.close()
        finally:
            browser.close()

    (out / "contrast.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")
    measured = [r for r in rows if "ratio" in r]
    graded = [r for r in measured if r["verdict"] in ("PASS", "FAIL")]
    fails = [r for r in graded if r["verdict"] == "FAIL"]

    # ⛔⛔ COVERAGE IS REPORTED BEFORE THE VERDICT, because "0 below AA" over a region with
    # NOTHING IN IT reads exactly like "this region passed". The owner's bar is BOTH regions
    # in BOTH themes; a cell with no graded label is an UNMEASURED cell and must say so.
    print("\n  coverage — graded (non-exempt) labels per cell:")
    holes = []
    for theme in ("dark", "light"):
        for region in ("scrimmed", "un-scrimmed"):
            cell = [r for r in graded if r["theme"] == theme and r["region"] == region]
            exempt = [r for r in measured if r["theme"] == theme and r["region"] == region
                      and r["verdict"] == "EXEMPT"]
            if cell:
                lo = min(r["ratio"] for r in cell)
                print(f"    {theme:5s} {region:11s} {len(cell)} graded, worst {lo:.2f}:1")
            else:
                holes.append((theme, region))
                print(f"    {theme:5s} {region:11s} ⛔ UNMEASURED — 0 graded "
                      f"({len(exempt)} disabled/exempt present)")

    print(f"\n  {len(graded)} label(s) graded, {len(fails)} below AA {WCAG_AA_NORMAL}:1")
    for r in fails:
        print(f"    {r['theme']} {r['region']} {r['bubble']} {r['ratio']}:1")
    if holes:
        print(f"  ⛔ {len(holes)} cell(s) UNMEASURED: {holes}")
        print("     A pass over an unmeasured cell is not a pass. Exit 2 = INCONCLUSIVE.")
    if fails:
        return 1
    return 2 if holes else 0


if __name__ == "__main__":
    raise SystemExit(main())
