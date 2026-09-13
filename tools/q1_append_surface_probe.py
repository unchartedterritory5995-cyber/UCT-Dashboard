#!/usr/bin/env python3
"""Q1-F5 step 0 — WHERE ARE THE THREE APPEND DOORS, ON THE REAL SITE?

The rig can drive the four `update_note` doors because they are all on the note
editor page. The three APPEND families are not:

  append_widget_embed    "Send to Journal" — a chart/widget surface
  append_financial_fact  "Save price to Notebook" — a TickerPopup
  append_document_excerpt "Save excerpt" — a PDF preview inside a note

⛔⛔ THIS PROBE FINDS THE CONTROLS. IT DRIVES NOTHING AND ASSERTS NOTHING.
Building a driver against a guessed selector is how the hero door was "driven"
for a whole wave without ever being opened — the selector matched a different
input with a byte-identical accept list, and the rig reported its own
mis-selection as a product defect. So the controls are ENUMERATED from the live
DOM first, and the driver is written against what is actually there.

It never signs in, never deletes the profile, and creates nothing.
"""
from __future__ import annotations

import argparse
import importlib.util
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[1]

# What a control for each family plausibly says. Deliberately WIDE: this is a
# search, and a narrow pattern that finds nothing would read as "the control is
# not there" rather than "I looked for the wrong words".
WANTED = {
    "append_widget_embed": ["send to journal", "journal", "capture", "save to notebook", "notebook"],
    "append_financial_fact": ["save price", "price to notebook", "financial fact", "save to notebook"],
    "append_document_excerpt": ["save excerpt", "excerpt", "save selection"],
}

SCAN_JS = """
(needles) => {
  const seen = [];
  const els = document.querySelectorAll('button, [role=button], a, [role=menuitem], li, [data-testid]');
  for (const el of els) {
    const txt = (el.innerText || el.textContent || '').trim().slice(0, 80);
    const aria = el.getAttribute('aria-label') || '';
    const title = el.getAttribute('title') || '';
    const hay = (txt + ' ' + aria + ' ' + title).toLowerCase();
    if (!hay.trim()) continue;
    for (const n of needles) {
      if (hay.includes(n)) {
        seen.push({
          text: txt, aria, title, tag: el.tagName,
          testid: el.getAttribute('data-testid') || null,
          cls: (el.className && el.className.toString().slice(0, 60)) || null,
          visible: !!(el.offsetParent || getComputedStyle(el).position === 'fixed'),
        });
        break;
      }
    }
  }
  return seen.slice(0, 40);
}
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", required=True)
    ap.add_argument("--base", default="https://uctintelligence.com")
    args = ap.parse_args()

    spec = importlib.util.spec_from_file_location("window_check", REPO / "tools" / "window_check.py")
    rig = importlib.util.module_from_spec(spec)
    sys.modules["window_check"] = rig
    spec.loader.exec_module(rig)
    rig.PROFILE = pathlib.Path(args.profile)
    rig.MARKER = rig.PROFILE.name

    from playwright.sync_api import sync_playwright

    proc, endpoint, ver = rig.spawn_rig()
    if ver is None:
        print("⛔ the rig browser never answered on CDP — nothing measured.")
        return 4

    try:
        with sync_playwright() as pw:
            b = pw.chromium.connect_over_cdp(endpoint)
            page = b.contexts[0].pages[0] if b.contexts[0].pages else b.contexts[0].new_page()
            page.goto(args.base, wait_until="domcontentloaded")
            page.wait_for_timeout(2500)

            me = page.evaluate(
                "async (b) => { try { return (await fetch(b + '/api/auth/me',"
                " {credentials:'include'})).status } catch { return 0 } }", args.base)
            if me != 200:
                print(f"⛔ auth {me} — nothing measured (401 = signed out, 5xx = deploy blip).")
                return 2 if me == 401 else 6

            needles = sorted({n for v in WANTED.values() for n in v})
            for label, path in [("CHARTS", "/charts"), ("NOTEBOOK", "/journal?j2tab=notebook")]:
                print(f"\n═══ {label}  ({path}) ═══")
                page.goto(args.base + path, wait_until="domcontentloaded")
                page.wait_for_timeout(9000)
                hits = page.evaluate(SCAN_JS, needles)
                if not hits:
                    print("   no control matched any of the needles on first paint")
                for h in hits[:18]:
                    vis = "visible" if h["visible"] else "hidden "
                    print(f"   [{vis}] {h['tag']:6} {h['text']!r:44} aria={h['aria']!r} testid={h['testid']!r}")

            print("\n═══ needles searched ═══")
            for fam, ns in WANTED.items():
                print(f"   {fam}: {ns}")
            print("\n⛔ A control found here is a CANDIDATE, not a door. The driver that uses it")
            print("   must assert the endpoint it actually hits, the way the hero probe does.")
            return 0
    finally:
        rig.teardown()


if __name__ == "__main__":
    raise SystemExit(main())
