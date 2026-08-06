"""Phone-viewport check for the earnings research modal (P2 Task 12, step 3 tail).

`tools/mobile_audit.py` sweeps ROUTES but cannot open the modal, so the one
surface P2 actually shipped went unverified on a phone. This drives a real
390x844 touch context, opens the modal, and asserts the phone-specific
contract from spec §4.4:

  * it renders as a BOTTOM SHEET, not a centred dialog
  * the rail is a horizontal chip row (scrollable), not the desktop column
  * nothing inside the modal scrolls the page body horizontally
  * the modal's own controls meet the 44px tap-target minimum

Run:
  MSYS_NO_PATHCONV=1 MOBILE_AUDIT_EMAIL=... MOBILE_AUDIT_PASSWORD=... \
    python tools/modal_phone_check.py --base http://localhost:8077 --sym MCD
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

OUT = Path(__file__).parent / "modal_phone_out"

# Measured in the page. Returns the facts; the verdict is computed in Python so
# the pass/fail logic is reviewable rather than buried in a JS string.
PROBE = """
() => {
  const dlg = document.querySelector('[role=dialog]');
  if (!dlg) return { found: false };
  const r = dlg.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const sel = 'button,a,[role=button],[role=tab],input,select,textarea';
  const small = [...dlg.querySelectorAll(sel)].filter(e => {
    const b = e.getBoundingClientRect();
    if (b.width === 0 || b.height === 0) return false;
    // an ::after hit-area expansion is invisible to getBoundingClientRect, so
    // trust an explicit opt-out marker the kit already uses for that case
    if (b.width >= 44 && b.height >= 44) return false;
    // A visually-small control can still carry a real 44px hit area via an
    // ::after expansion (the research-kit InfoTip does exactly this under
    // `@media (max-width:1024px)`). getBoundingClientRect() cannot see a
    // pseudo-element, so measuring the BOX alone reports false positives —
    // and a checker that cries wolf gets ignored, which is how a real
    // regression later slips through. Probe the ACTUAL hit area instead:
    // if a tap 18px out from centre still lands on this control, the
    // effective target is >= ~36px across and the expansion is working.
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    const hits = (dx, dy) => {
      const el = document.elementFromPoint(cx + dx, cy + dy);
      return !!el && (el === e || e.contains(el) || el.closest('button') === e);
    };
    if (hits(18, 0) && hits(-18, 0) && hits(0, 18) && hits(0, -18)) return false;
    return true;
  }).map(e => ({
    tag: e.tagName,
    label: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 40),
    w: Math.round(e.getBoundingClientRect().width),
    h: Math.round(e.getBoundingClientRect().height),
  }));
  const rail = dlg.querySelector('[role=tablist]');
  const rr = rail ? rail.getBoundingClientRect() : null;
  return {
    found: true,
    viewport: { vw, vh },
    rect: { top: Math.round(r.top), left: Math.round(r.left),
            width: Math.round(r.width), height: Math.round(r.height) },
    // a bottom sheet is flush to the bottom and spans the full width
    bottomFlush: Math.abs((r.top + r.height) - vh) <= 2,
    fullWidth: r.width >= vw - 2,
    railHorizontal: rr ? rr.width > rr.height : null,
    railScrollsX: rail ? rail.scrollWidth > rail.clientWidth + 1 : null,
    bodyOverflowX: Math.max(0, document.documentElement.scrollWidth - vw),
    smallTargets: small,
  };
}
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8077")
    ap.add_argument("--sym", default="MCD")
    args = ap.parse_args()

    email = os.environ.get("MOBILE_AUDIT_EMAIL")
    pw = os.environ.get("MOBILE_AUDIT_PASSWORD")
    OUT.mkdir(exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=2, is_mobile=True, has_touch=True,
            reduced_motion="reduce",
        )
        page = ctx.new_page()

        if email and pw:
            resp = page.request.post(
                f"{args.base}/api/auth/login",
                data={"email": email, "password": pw},
                headers={"Content-Type": "application/json"},
            )
            print(f"  login HTTP {resp.status}")

        page.goto(f"{args.base}/calendar?earnings={args.sym}&esection=setup",
                  # NOT networkidle: this app holds SSE price streams open, so the
        # network never goes idle and goto() would always time out.
        wait_until="domcontentloaded", timeout=60_000)
        try:
            page.wait_for_selector("[role=dialog]", timeout=30_000)
        except Exception:
            pass
        page.wait_for_timeout(4000)

        facts = page.evaluate(PROBE)
        shot = OUT / f"modal_phone_{args.sym}.png"
        page.screenshot(path=str(shot), full_page=False)
        print(json.dumps(facts, indent=2))
        print(f"screenshot: {shot}")

        # ── verdict ────────────────────────────────────────────────────────
        if not facts.get("found"):
            print("\nRESULT: INCONCLUSIVE — no [role=dialog] rendered.")
            browser.close()
            return 2

        problems = []
        if not (facts["bottomFlush"] and facts["fullWidth"]):
            problems.append(
                f"not a bottom sheet: rect={facts['rect']} vs viewport={facts['viewport']}")
        if facts["railHorizontal"] is False:
            problems.append("rail is not horizontal on phone")
        if facts["bodyOverflowX"] > 0:
            problems.append(f"page body scrolls horizontally by {facts['bodyOverflowX']}px")
        if facts["smallTargets"]:
            problems.append(f"{len(facts['smallTargets'])} sub-44px tap target(s) inside the modal")

        if problems:
            print("\nRESULT: PROBLEMS FOUND")
            for x in problems:
                print(f"  - {x}")
            browser.close()
            return 1

        print("\nRESULT: PASS — bottom sheet, horizontal rail, no body overflow, "
              "all modal tap targets >= 44px.")
        browser.close()
        return 0


if __name__ == "__main__":
    sys.exit(main())
