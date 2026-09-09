"""Wave K Slice 8 — the Ask panel in a real browser, at real widths.

⛔ THE BROWSER SEES WHAT NO TEST CAN. jsdom has no layout: it cannot report a
horizontal overflow, a 22px tap target, or an input that triggers iOS zoom.
`tools/mobile_audit.py` sweeps ROUTES, and the Ask panel is not a route -- it
lives inside the note editor, behind a click. This opens it and measures it.

What it checks, per viewport:
  - the panel does not overflow the viewport horizontally
  - every interactive control in the panel meets the 44px touch floor
    (TOUCH TIER IS <=1024, so tablet counts, not just phone)
  - the input is >=16px, or iOS zooms the page on focus
  - the active scope is present as TEXT, not an icon-only affordance
  - the question input carries an accessible name
  - focus lands in the input when the panel opens

Then, once, at desktop: a real question, and the citation chip it produces.

USAGE
    python tools/ask_browser_audit.py --base http://127.0.0.1:8077 \
        --email mobtest@local.dev --password 'LocalTest2026!'
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent / "ask_audit_out"

VIEWPORTS = [
    ("phone390", 390, 844, True),
    ("tablet820", 820, 1180, True),
    ("desktop", 1440, 900, False),
]

TAP_MIN = 44
NOTE_BODY = ("Datacenter demand stays ahead of supply through 2027. "
             "Risk: gross margins compressed in Q3 as hyperscalers negotiated harder.")

MEASURE_JS = """
() => {
  const panel = document.querySelector('[role="dialog"][aria-label^="Ask"]');
  if (!panel) return {found: false};
  const r = panel.getBoundingClientRect();
  const small = [];
  for (const el of panel.querySelectorAll('button, input, a, [role="button"]')) {
    const b = el.getBoundingClientRect();
    if (b.width === 0 && b.height === 0) continue;
    if (b.height < 44 || b.width < 44) {
      small.push({tag: el.tagName.toLowerCase(),
                  name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
                  w: Math.round(b.width), h: Math.round(b.height)});
    }
  }
  const input = panel.querySelector('input');
  const scope = panel.querySelector('[data-testid="ask-scope"]');
  return {
    found: true,
    panelRight: Math.round(r.right), panelLeft: Math.round(r.left),
    viewportW: window.innerWidth,
    docOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    small,
    inputFontPx: input ? parseFloat(getComputedStyle(input).fontSize) : null,
    inputAccessibleName: input ? (input.getAttribute('aria-label') ||
       (input.id && document.querySelector(`label[for="${input.id}"]`)?.textContent) || '') : '',
    scopeText: scope ? scope.textContent.trim() : null,
    focusIsInput: document.activeElement === input,
  };
}
"""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base", default="http://127.0.0.1:8077")
    ap.add_argument("--email", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--ask", action="store_true",
                    help="also send one REAL question at desktop width")
    args = ap.parse_args()

    from playwright.sync_api import sync_playwright

    OUT.mkdir(exist_ok=True)
    rows = []
    failures = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for name, w, h, touch in VIEWPORTS:
            ctx = browser.new_context(viewport={"width": w, "height": h},
                                      has_touch=touch, is_mobile=touch,
                                      device_scale_factor=2 if touch else 1)
            page = ctx.new_page()
            resp = page.request.post(f"{args.base}/api/auth/login",
                                     data={"email": args.email,
                                           "password": args.password})
            if not resp.ok:
                print(f"REFUSING TO CONTINUE: login failed ({resp.status})")
                return 2

            note = page.request.post(f"{args.base}/api/j2/notes", data={
                "title": "NVDA thesis",
                "bodyJson": {"type": "doc", "content": [
                    {"type": "paragraph",
                     "content": [{"type": "text", "text": NOTE_BODY}]}]},
            })
            note_id = note.json()["note"]["id"]

            page.goto(f"{args.base}/journal/notebook?note={note_id}",
                      wait_until="networkidle")
            # Dismiss the cinematic intro, which plays on every page load.
            page.keyboard.press("Escape")
            page.wait_for_timeout(600)

            toggle = page.locator('button[aria-label^="Ask a question about"]')
            if toggle.count() == 0:
                failures.append(f"{name}: the Ask affordance is not on the page")
                rows.append({"viewport": name, "found": False})
                page.screenshot(path=str(OUT / f"{name}-no-ask.png"), full_page=True)
                ctx.close()
                continue
            toggle.first.click()
            page.wait_for_timeout(400)

            m = page.evaluate(MEASURE_JS)
            m["viewport"] = name
            rows.append(m)
            page.screenshot(path=str(OUT / f"{name}-ask-open.png"), full_page=False)

            if not m.get("found"):
                failures.append(f"{name}: the panel did not open")
            else:
                if m["docOverflow"] > 0:
                    failures.append(f"{name}: page overflows horizontally by "
                                    f"{m['docOverflow']}px with Ask open")
                if m["panelRight"] > m["viewportW"] + 1 or m["panelLeft"] < -1:
                    failures.append(f"{name}: panel escapes the viewport "
                                    f"(left={m['panelLeft']} right={m['panelRight']} "
                                    f"vw={m['viewportW']})")
                if touch and m["small"]:
                    names = ", ".join(f"{s['name'] or s['tag']} {s['w']}x{s['h']}"
                                      for s in m["small"])
                    failures.append(f"{name}: controls below the {TAP_MIN}px "
                                    f"touch floor -- {names}")
                if touch and (m["inputFontPx"] or 0) < 16:
                    failures.append(f"{name}: input font {m['inputFontPx']}px "
                                    "-- iOS zooms the page below 16px")
                if not m["scopeText"] or "Asking:" not in m["scopeText"]:
                    failures.append(f"{name}: the active scope is not legible "
                                    f"as text (got {m['scopeText']!r})")
                if not (m["inputAccessibleName"] or "").strip():
                    failures.append(f"{name}: the question input has no "
                                    "accessible name")
                if not m["focusIsInput"]:
                    failures.append(f"{name}: focus did not land in the input")

            if args.ask and name == "desktop":
                page.fill('[role="dialog"] input', "what did I say about margins?")
                page.click('[role="dialog"] button:has-text("Ask")')
                try:
                    page.wait_for_selector('[data-testid="ask-answer"]', timeout=60000)
                    page.wait_for_timeout(2500)
                    answer = page.inner_text('[data-testid="ask-answer"]')
                    chips = page.locator('[data-citation]').count()
                    sources = page.locator('[data-testid="ask-sources"] button').count()
                    print(f"\n  live answer: {answer[:200]}")
                    print(f"  citation chips: {chips}   listed sources: {sources}")
                    if chips == 0:
                        failures.append("desktop: a real answer rendered no citation chip")
                    page.screenshot(path=str(OUT / "desktop-answered.png"))
                except Exception as e:  # noqa: BLE001
                    failures.append(f"desktop: no answer rendered -- {e}")

            ctx.close()
        browser.close()

    print("\n" + "=" * 66)
    for r in rows:
        if not r.get("found"):
            print(f"[{r['viewport']:10}] PANEL NOT FOUND")
            continue
        print(f"[{r['viewport']:10}] overflow={r['docOverflow']:3}px  "
              f"panel={r['panelLeft']}..{r['panelRight']} of {r['viewportW']}  "
              f"sub-44px={len(r['small'])}  input={r['inputFontPx']}px  "
              f"scope={r['scopeText']!r}")
    (OUT / "report.json").write_text(json.dumps(rows, indent=1), encoding="utf-8")

    if failures:
        print(f"\n{len(failures)} FAILURE(S):")
        for f in failures:
            print("  - " + f)
        return 1
    print("\nAll viewports pass. Screenshots in " + str(OUT))
    return 0


if __name__ == "__main__":
    sys.exit(main())
