"""Wave L Slice 2b — phone-width certification for the capture dialog.

⛔ WHY THIS EXISTS SEPARATELY FROM `tools/mobile_audit.py`. That harness visits
ROUTES. The capture dialog is not a route — it is opened by a shortcut or a
palette command over whatever page the member is on. A route sweep would load
`/journal/notebook`, find no dialog, measure the page behind it, and report a
clean phone pass for a surface it never rendered. That is the vacuous-pass shape
`mobile_audit` itself documents three times over, so this drives the real thing.

Run against the FAIL-CLOSED sandbox, never a live backend:

    python tools/local_backend_sandbox.py --port 8077        # terminal 1
    python tools/capture_phone_audit.py --base http://localhost:8077

Exits non-zero on any finding. Writes tools/capture_phone_out/report.json plus a
screenshot per state, because a number without a picture has been wrong here
before.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

OUT_DIR = pathlib.Path(__file__).parent / "capture_phone_out"

# iPhone-ish. 390 is the width the program's own mobile lessons are written at.
PHONE = {"width": 390, "height": 844}

# Probes run INSIDE the page. Each returns numbers a human can check against the
# screenshot beside it.
MEASURE_JS = """
() => {
  const dlg = document.querySelector('[role="dialog"]');
  if (!dlg) return { found: false };
  const doc = document.documentElement;
  const small = [];
  for (const el of dlg.querySelectorAll('button, input, textarea, select, a[href]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;      // genuinely hidden
    if (r.width < 44 || r.height < 44) {
      small.push({
        tag: el.tagName.toLowerCase(),
        name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
        w: Math.round(r.width), h: Math.round(r.height),
      });
    }
  }
  const save = dlg.querySelector('[data-testid="capture-save"]');
  const saveRect = save ? save.getBoundingClientRect() : null;
  const dlgRect = dlg.getBoundingClientRect();
  // A control the member cannot reach is not a control. Save must be inside the
  // viewport, not below the fold behind a software keyboard.
  return {
    found: true,
    docScrollW: doc.scrollWidth,
    docClientW: doc.clientWidth,
    horizontalOverflow: doc.scrollWidth > doc.clientWidth,
    dialogRight: Math.round(dlgRect.right),
    dialogLeft: Math.round(dlgRect.left),
    viewportW: window.innerWidth,
    saveVisible: !!saveRect && saveRect.top >= 0 && saveRect.bottom <= window.innerHeight + 1,
    saveBottom: saveRect ? Math.round(saveRect.bottom) : null,
    smallTargets: small,
    // Font size >= 16px on inputs, or iOS zooms the whole viewport on focus.
    inputFontPx: (() => {
      const i = dlg.querySelector('textarea, input');
      return i ? Math.round(parseFloat(getComputedStyle(i).fontSize)) : null;
    })(),
    destinationText: (dlg.querySelector('[data-testid="capture-destination"]')
                   || dlg.querySelector('[data-testid="capture-destination-picker"]')
                   || {}).textContent?.trim().slice(0, 60) || null,
  };
}
"""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base", default="http://localhost:8077")
    ap.add_argument("--email", default="mobtest@local.dev")
    ap.add_argument("--password", default="LocalTest2026!")
    args = ap.parse_args()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright is not installed in this interpreter")
        return 2

    OUT_DIR.mkdir(exist_ok=True)
    findings: list[str] = []
    report: dict = {"base": args.base, "viewport": PHONE, "states": []}

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport=PHONE, device_scale_factor=2, is_mobile=True,
                                  has_touch=True)
        # Cookie auth through the API so the intro overlay cannot eat the login.
        r = ctx.request.post(f"{args.base}/api/auth/login",
                             data={"email": args.email, "password": args.password})
        if not r.ok:
            print(f"login failed: {r.status}")
            return 2

        page = ctx.new_page()
        page.goto(f"{args.base}/journal/notebook", wait_until="domcontentloaded")
        page.wait_for_timeout(1500)
        # Dismiss the cinematic intro if it is up.
        try:
            page.keyboard.press("Escape")
        except Exception:
            pass
        page.wait_for_timeout(400)

        for state, prep in (
            ("thought", lambda: None),
            ("source", lambda: page.get_by_role("button", name="Capture a source").click()),
        ):
            page.keyboard.press("Control+Shift+KeyY")
            page.wait_for_timeout(600)
            if page.query_selector('[role="dialog"]') is None:
                findings.append(f"{state}: the capture dialog did not open — nothing was measured")
                break
            try:
                prep()
                page.wait_for_timeout(300)
            except Exception as e:      # noqa: BLE001 — a missing switch is a finding, not a crash
                findings.append(f"{state}: could not reach the state ({e})")
            m = page.evaluate(MEASURE_JS)
            m["state"] = state
            page.screenshot(path=str(OUT_DIR / f"phone390-{state}.png"), full_page=False)
            report["states"].append(m)

            if not m.get("found"):
                findings.append(f"{state}: no dialog present when measured")
            else:
                if m["horizontalOverflow"]:
                    findings.append(f"{state}: horizontal overflow "
                                    f"({m['docScrollW']} > {m['docClientW']})")
                if m["dialogRight"] > m["viewportW"] + 1 or m["dialogLeft"] < -1:
                    findings.append(f"{state}: dialog escapes the viewport "
                                    f"[{m['dialogLeft']}, {m['dialogRight']}] vs {m['viewportW']}")
                if not m["saveVisible"]:
                    findings.append(f"{state}: Save is not reachable in the viewport "
                                    f"(bottom={m['saveBottom']})")
                if m["smallTargets"]:
                    findings.append(f"{state}: {len(m['smallTargets'])} sub-44px targets: "
                                    f"{m['smallTargets']}")
                if (m["inputFontPx"] or 0) < 16:
                    findings.append(f"{state}: input font {m['inputFontPx']}px — iOS will zoom")
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)

        browser.close()

    # ⛔ ANTI-VACUITY: a pass that measured nothing is not a pass.
    measured = [s for s in report["states"] if s.get("found")]
    if len(measured) < 2:
        findings.append(f"VACUOUS: only {len(measured)} dialog state(s) were actually measured")

    report["findings"] = findings
    (OUT_DIR / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    for s in report["states"]:
        print(f"  {s.get('state')}: found={s.get('found')} overflow={s.get('horizontalOverflow')} "
              f"saveVisible={s.get('saveVisible')} small={len(s.get('smallTargets') or [])} "
              f"font={s.get('inputFontPx')} dest={s.get('destinationText')!r}")
    if findings:
        print("\nFINDINGS:")
        for f in findings:
            print(f"  - {f}")
        return 1
    print("\nphone-width capture certification: PASS (2 states measured)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
