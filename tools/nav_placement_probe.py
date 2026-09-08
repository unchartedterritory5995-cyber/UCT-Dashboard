"""Measure the three review-transport placements against the REAL chart.

⛔ WHY MEASURE RATHER THAN PICK. This control is pressed dozens of times per
review session, so the choice is about muscle memory and obstruction — both of
which are geometry, and geometry can be measured instead of argued. What CANNOT
be measured here is stated as such at the end rather than quietly folded into a
score.

⛔ AND IT NEEDS A COARSE POINTER. The control's landscape rule is gated on
`(pointer: coarse)`; desktop Chrome reports fine at any width, so a plain browser
would measure a rule that never applied. Playwright's mobile context is the one
local instrument that answers honestly, and this refuses to report if the pointer
did not actually resolve coarse.

Usage: python tools/nav_placement_probe.py [--base http://127.0.0.1:8091]
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from sandbox_account import SANDBOX_EMAIL, new_password, ensure_account  # noqa: E402

PASSWORD = new_password()
CRED = {"email": SANDBOX_EMAIL, "password": PASSWORD}

VARIANTS = ["rail", "pill", "edge"]
ORIENTATIONS = [("portrait", 390, 844), ("landscape", 844, 390)]

# The price scale lives on the right edge; treat the rightmost strip as the zone
# a floating control must never enter.
PRICE_AXIS_W = 64

MEASURE = """(sel) => {
  const el = document.querySelector('[data-review-nav]')
  if (!el) return { found: false }
  const r = el.getBoundingClientRect()
  const btns = [...el.querySelectorAll('button')]
  const boxes = btns.map(b => { const q = b.getBoundingClientRect(); return { w: Math.round(q.width), h: Math.round(q.height), label: b.getAttribute('aria-label') } })
  const chart = document.querySelector('.tv-lightweight-charts')
  const c = chart ? chart.getBoundingClientRect() : null
  const cs = getComputedStyle(el)
  return {
    found: true,
    box: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    buttons: boxes,
    chart: c ? { x: Math.round(c.left), y: Math.round(c.top), w: Math.round(c.width), h: Math.round(c.height) } : null,
    opacity: cs.opacity,
    vw: innerWidth, vh: innerHeight,
    coarse: matchMedia('(pointer: coarse)').matches,
  }
}"""


def score(m):
    """Objective geometry only. Everything subjective is reported, not scored."""
    b, c = m["box"], m["chart"]
    area = b["w"] * b["h"]
    chart_area = (c["w"] * c["h"]) if c else 0
    obstruction = (area / chart_area * 100) if chart_area else float("nan")
    # Thumb pivot for a one-handed grip: the bottom corner on the holding side.
    # BOTH are reported because the control is left-anchored while the natural
    # right-handed pivot is the RIGHT corner — that tension is a finding, not a
    # detail to average away.
    cx, cy = b["x"] + b["w"] / 2, b["y"] + b["h"] / 2
    right_pivot = ((m["vw"] - cx) ** 2 + (m["vh"] - cy) ** 2) ** 0.5
    left_pivot = ((cx) ** 2 + (m["vh"] - cy) ** 2) ** 0.5
    smallest = min((x["w"] * x["h"]) ** 0.5 for x in m["buttons"]) if m["buttons"] else 0
    axis_overlap = max(0, (b["x"] + b["w"]) - (m["vw"] - PRICE_AXIS_W))
    return {
        "obstruction_pct": round(obstruction, 2),
        "min_target_px": round(smallest),
        "reach_right_hand": round(right_pivot),
        "reach_left_hand": round(left_pivot),
        "price_axis_overlap_px": axis_overlap,
    }


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8091")
    args = ap.parse_args()
    ensure_account(args.base, PASSWORD)

    from playwright.sync_api import sync_playwright
    rows = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        # ⛔ LOG IN ONCE. Six contexts each posting /api/auth/login tripped the
        # server's rate limiter (HTTP 429) — the probe was measuring its own
        # impatience rather than the product. One login, then every context is
        # seeded from that storage state.
        boot = browser.new_context()
        r = boot.request.post(f"{args.base}/api/auth/login", data=CRED)
        if r.status != 200:
            raise SystemExit(f"sandbox login failed: HTTP {r.status}")
        state = boot.storage_state()
        boot.close()
        for variant in VARIANTS:
            for oname, w, h in ORIENTATIONS:
                ctx = browser.new_context(viewport={"width": w, "height": h},
                                          is_mobile=True, has_touch=True, device_scale_factor=3,
                                          storage_state=state)
                page = ctx.new_page()
                page.set_default_navigation_timeout(90000)
                page.set_default_timeout(60000)
                page.goto(f"{args.base}/charts?navprobe={variant}", wait_until="domcontentloaded")
                try:
                    page.click('[aria-label="Skip intro"]', timeout=8000)
                except Exception:
                    pass
                page.wait_for_selector("[data-review-nav]", timeout=45000)
                page.wait_for_selector(".tv-lightweight-charts", timeout=45000)
                m = page.evaluate(MEASURE)
                ctx.close()
                if not m.get("found"):
                    raise SystemExit(f"{variant}/{oname}: the control never rendered")
                if not m.get("coarse"):
                    print("pointer did NOT resolve coarse - no conclusion may be drawn.")
                    browser.close()
                    return 2
                rows.append({"variant": variant, "orientation": oname, **score(m), "_raw": m})
        browser.close()

    print("")
    print("variant  orient     obstruct%  minTarget  reach(R)  reach(L)  axisOverlap")
    for r in rows:
        print("{:8} {:10} {:>9} {:>10} {:>9} {:>9} {:>12}".format(
            r["variant"], r["orientation"], r["obstruction_pct"], r["min_target_px"],
            r["reach_right_hand"], r["reach_left_hand"], r["price_axis_overlap_px"]))

    print("")
    bad = [r for r in rows if r["min_target_px"] < 44]
    print("44px minimum target honoured: " + ("NO -> " + str([r['variant'] for r in bad]) if bad else "yes, all"))
    print("price-axis intrusion: " + ("NONE" if all(r["price_axis_overlap_px"] == 0 for r in rows) else "SOME"))
    print("")
    print("NOT MEASURED HERE, and not scored: accidental activation while drawing,")
    print("discoverability, and how it FEELS one-handed. Those need a hand.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
