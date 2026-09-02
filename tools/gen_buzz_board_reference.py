r"""Write the /buzz board's design-of-record by CAPTURING THE SHIPPED PAGE.

⛔ WHY THIS REPLACED gen_board_v2..v8.py. Every previous version hand-wrote a
second copy of the design in raw HTML/CSS, and the file's own header had to
warn that the copy and the component "MUST change in the same commit" -- which
is the definition of a second authority over one value, the defect class this
repo has already paid for three times (the writer index, the COT router's "4
routes", the setup catalog's "24"). A reference that can disagree with the
product eventually does, silently, and then it teaches the next engineer the
design the product no longer has.

So this does not RE-AUTHOR anything. It opens the real page, takes the real
#buzz-export subtree and the real compiled stylesheets, and inlines them. The
class names in the markup are css-modules hashes from the same build that
produced the rules, so the captured file renders byte-for-byte what Discord
gets. It cannot drift, because there is nothing here to keep in step.

Run:  python tools/gen_buzz_board_reference.py <url> <out.html>

`url` is a running /r/buzz. Against production:
  https://uctintelligence.com/r/buzz?token=$CHART_RENDER_TOKEN
Locally, boot the app with a seeded sandbox store first -- a bare local run
resolves /data to the owner's LIVE C:\data (see the repo-root conftest's
SHARED_DATA_ENV_PINS, and lesson_browser_verify_needs_the_conftest_pins_redirected).

It writes docs/superpowers/design/2026-09-01-buzz-board-reference.html.
"""
import base64
import datetime
import pathlib
import re
import sys

from playwright.sync_api import sync_playwright

# ⚠️ NL is String.fromCharCode(10), not a backslash escape, on purpose: this
# script is written through a shell heredoc, which eats one level of
# backslash and turned '\n' into a REAL newline inside the JS string literal
# -- "SyntaxError: Invalid or unexpected token" from a file that reads fine.
CAPTURE = """() => {
  const NL = String.fromCharCode(10)
  // Every rule the page actually loaded, in load order. Same-origin only,
  // which is all of them -- the board loads no third-party stylesheet.
  const css = [...document.styleSheets].map((s) => {
    try { return [...s.cssRules].map((r) => r.cssText).join(NL) }
    catch (e) { return '/* unreadable sheet: ' + (s.href || 'inline') + ' */' }
  }).join(NL)
  const el = document.querySelector('#buzz-export')
  return { css, html: el.outerHTML, w: el.getBoundingClientRect().width,
           h: el.getBoundingClientRect().height }
}"""

url, out = sys.argv[1], pathlib.Path(sys.argv[2])

with sync_playwright() as pw:
    b = pw.chromium.launch()
    p = b.new_page(viewport={"width": 1400, "height": 1400}, device_scale_factor=2)
    p.goto(url, wait_until="networkidle", timeout=60000)
    p.wait_for_function("() => window.__buzzReady === true", timeout=30000)
    cap = p.evaluate(CAPTURE)
    # The lockup mark is a hashed build asset; inline it so the file opens
    # standalone. Fonts stay as /fonts/* -- they are served by the same app
    # this reference is reviewed against, and inlining two woff2 files would
    # add ~90KB of base64 to a document meant to be read as a diff.
    imgs = set(re.findall(r'<img src="([^"]+)"', cap["html"]))
    for src in imgs:
        try:
            raw = p.request.get(p.url.split("/r/")[0] + src).body()
            cap["html"] = cap["html"].replace(
                src, "data:image/png;base64," + base64.b64encode(raw).decode())
        except Exception as e:                     # a missing mark must not
            print("  ! could not inline %s (%s)" % (src, e))   # kill the capture
    b.close()

stamp = datetime.date.today().isoformat()
out.write_text(
    "<!doctype html>\n<!--\n"
    "  DESIGN OF RECORD for the Discord /buzz board image.\n"
    "  CAPTURED %s from the shipped page at %s -- %dx%d.\n"
    "  Regenerate: tools/gen_buzz_board_reference.py <url> <out.html>\n\n"
    "  This file is DERIVED, not authored. The markup below is the real\n"
    "  #buzz-export subtree and the CSS is the real compiled stylesheet, both\n"
    "  taken from one build, so it cannot disagree with\n"
    "  app/src/pages/BuzzRender.{jsx,module.css}. Do NOT hand-edit it -- an\n"
    "  edit here changes nothing about the product and re-creates exactly the\n"
    "  drift the previous hand-written references suffered from (they had to\n"
    "  carry a warning that they must be changed in the same commit; this one\n"
    "  does not, because there is no second copy to keep in step).\n\n"
    "  Fonts resolve against the running app (/fonts/*). Open it beside a\n"
    "  local server, or accept the system-font fallback for a layout diff.\n"
    "-->\n"
    "<html><head><meta charset=\"utf-8\">\n"
    "<title>READ THE ROOM \u2014 buzz board design of record</title>\n"
    "<style>\nbody{background:#000;margin:0}\n%s\n</style></head>\n"
    "<body>\n%s\n</body></html>\n"
    % (stamp, url.split("?")[0], round(cap["w"]), round(cap["h"]),
       cap["css"], cap["html"]),
    encoding="utf-8")
print("wrote %s  (%dx%d, %.0f KB)"
      % (out.name, round(cap["w"]), round(cap["h"]), out.stat().st_size / 1024))
