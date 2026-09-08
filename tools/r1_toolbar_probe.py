"""Settle the portrait-toolbar discrepancy WITHOUT burning a device minute.

⛔ WHY A PLAIN BROWSER CANNOT ANSWER THIS, and why this file exists anyway.
The rule under test is gated on `(pointer: coarse)`, which desktop Chrome
reports FALSE at any width — measured on this branch: at 844x390 the landscape
media query matched WITHOUT the pointer clause and failed WITH it. So a
`resize_window` probe reports success against a rule that never applied.
Playwright's `is_mobile=True, has_touch=True` context is the one local
instrument that makes Chromium report `pointer: coarse`, so the query can be
evaluated honestly off-device. The probe PRINTS what the pointer actually
resolves to and refuses to conclude anything if it is not coarse.

⛔ AND IT WAITS FOR SETTLEMENT, NEVER SAMPLES IMMEDIATELY. The device reading
this exists to explain was taken moments after boot; a computed style read
during layout settling is exactly the artifact we are trying to rule out. Each
measurement polls to TWO IDENTICAL READS before it is believed, and says so.

Usage: python tools/r1_toolbar_probe.py [--base http://127.0.0.1:8091]
"""
from __future__ import annotations

import argparse
import json

from playwright.sync_api import sync_playwright

CRED = {"email": "e2e-sandbox@local.dev", "password": "SandboxDevice2026!"}

# The boxes that matter. The device ran the app inside a 150px-shorter iframe,
# so BOTH the raw device viewport and the iframe's box are measured — if they
# disagree, the iframe box is the one the device actually rendered.
CASES = [
    ("portrait · device viewport", 428, 745),
    ("portrait · iframe box (device ran this)", 428, 595),
    ("landscape · device viewport", 926, 378),
    ("landscape · iframe box (device ran this)", 926, 228),
]

READ = """() => {
  const tb = document.querySelector('[aria-label="Chart controls"]')
  if (!tb) return { found: false }
  const cs = getComputedStyle(tb), r = tb.getBoundingClientRect()
  return {
    found: true,
    position: cs.position, flexDirection: cs.flexDirection,
    left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height),
    coarse: matchMedia('(pointer: coarse)').matches,
    gate: matchMedia('(pointer: coarse) and (orientation: landscape) and (max-height: 500px)').matches,
    orientationLandscape: matchMedia('(orientation: landscape)').matches,
    maxH500: matchMedia('(max-height: 500px)').matches,
    vw: innerWidth, vh: innerHeight,
  }
}"""


def settled(page, tries: int = 40, gap_ms: int = 150):
    """Two identical reads, or a named failure. Never a single sample."""
    prev = None
    for _ in range(tries):
        cur = page.evaluate(READ)
        if prev is not None and json.dumps(prev, sort_keys=True) == json.dumps(cur, sort_keys=True) \
                and cur.get("found"):
            return cur
        prev = cur
        page.wait_for_timeout(gap_ms)
    raise SystemExit("the toolbar never settled to two identical reads — "
                     f"last: {json.dumps(prev, sort_keys=True)}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8091")
    args = ap.parse_args()

    with sync_playwright() as p:
        browser = p.chromium.launch()
        rows = []
        for label, w, h in CASES:
            ctx = browser.new_context(viewport={"width": w, "height": h},
                                      is_mobile=True, has_touch=True, device_scale_factor=3)
            r = ctx.request.post(f"{args.base}/api/auth/login", data=CRED)
            if r.status != 200:
                raise SystemExit(f"sandbox login failed: HTTP {r.status}")
            page = ctx.new_page()
            page.goto(f"{args.base}/charts", wait_until="domcontentloaded")
            # The intro is a full-screen takeover; press its own control.
            try:
                page.click('[aria-label="Skip intro"]', timeout=6000)
            except Exception:
                pass
            page.wait_for_selector('[aria-label="Chart controls"]', timeout=25000)
            got = settled(page)
            got["case"] = label
            rows.append(got)
            ctx.close()
        browser.close()

    print(f"{'case':42} {'coarse':7} {'gate':6} {'position':9} {'flexDir':8} {'left':>5} {'width':>6}")
    for r in rows:
        print(f"{r['case']:42} {str(r['coarse']):7} {str(r['gate']):6} "
              f"{r['position']:9} {r['flexDirection']:8} {r['left']:>5} {r['width']:>6}")

    if not all(r["coarse"] for r in rows):
        print("\n⛔ pointer did NOT resolve coarse in every case — this instrument "
              "cannot evaluate the rule, and no conclusion may be drawn from it.")
        return 2

    bad = [r for r in rows
           if (not r["gate"]) and (r["position"] == "absolute" or r["flexDirection"] == "column")]
    print()
    if bad:
        print("PORTRAIT_TOOLBAR = DEFECT — the rail shape appears where the gate is FALSE:")
        for r in bad:
            print(f"   {r['case']}: gate={r['gate']} {r['position']}/{r['flexDirection']} "
                  f"left={r['left']} w={r['width']} (vw={r['vw']} vh={r['vh']})")
        return 1
    print("PORTRAIT_TOOLBAR = CORRECT — absolute/column appears ONLY where the gate is true.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
