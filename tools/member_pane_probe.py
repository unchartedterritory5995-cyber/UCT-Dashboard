"""⭐⭐ R-M — DOES THE MEMBER PANE FOLLOW ITS CONTAINER? Measured in a real browser.

Owner ruling, 2026-09-12: *"the pane must resize with its container … add a test
that a container height change moves the pane height. The 29px black rectangle is
the exact mobile failure the 390×844 audit would have caught; it must not survive
to session 3."*

⛔⛔ WHY THIS IS A HEADLESS PROBE AND NOT A `vitest` CASE. The question is
**layout**, and jsdom has none: every element is 0×0 there, so a jsdom test would
pass against a pane that never resized and against one that could not exist. The
same question asked through the Chrome extension on the rig is worse than
useless — the tab that answers is HIDDEN, and a hidden tab defers paint and
throttles `requestAnimationFrame`, which is exactly the loop Lightweight Charts'
`autoSize` runs on. ⚰️ THAT IS NOT HYPOTHETICAL: T5's first answer to this
question — "the pane does not resize" — was taken on a tab measured `hidden`
afterwards, so it measured the instrument.

⭐ THREE EXIT CODES, THREE DIFFERENT FACTS — the `CoverageLine` idiom this repo
already uses, because "it failed" and "it could not be asked" are different
things to whoever reads the run:

    0  PASS          the pane moved with its container
    1  MEASURED FAIL the container moved and the pane did not
    2  INCONCLUSIVE  no dev server, not signed in, or the flag is off

Usage:

    python tools/member_pane_probe.py --base http://localhost:5173
    python tools/member_pane_probe.py --self-check      # proves it can FAIL
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tests" / "fixtures" / "member" / "uncharted-volume-v2.pine"

PASS, FAIL, INCONCLUSIVE = 0, 1, 2

#: The heights the frame is driven to. ⭐ 240 IS THE ONE THAT MATTERS: it is
#: below the height at which T5 measured the panes collapsing to 29px, so a pane
#: that ignores its container reproduces the black rectangle here.
HEIGHTS = (420, 640, 240)


def _log(msg: str) -> None:
    print(msg, flush=True)


# ─── the page-side probes, kept as source so both the tool and a reader see the
#     same code the browser runs ────────────────────────────────────────────────

GATE_JS = """() => ({
  enabled: !!(window.__memberPaneEnabledProbe),
  visibility: document.visibilityState,
})"""

#: ⛔ MEASURE THE CANVASES, NOT THE WRAPPER. The wrapper is the thing being
#: driven; asking it whether it changed is asking the input. The canvases are
#: Lightweight Charts' own backing stores, so they answer whether the CHART
#: re-laid out — which is the actual question.
MEASURE_JS = """() => {
  const pane = document.querySelector('[data-testid="pine-member-pane"]');
  if (!pane) return null;
  const frame = pane.firstElementChild;
  // ⛔ LIGHTWEIGHT CHARTS' OWN CANVASES ONLY. The drawing and callout overlays
  // are canvases too — 604x418 and 300x150 here — and they live under elements
  // carrying CSS-module classes while LWC's sit in unclassed divs. Counting
  // them put a 150px overlay in the pane list and made the member's sub-pane
  // read as half the plot.
  const own = [...pane.querySelectorAll('canvas')].filter((c) => {
    let n = c.parentElement;
    for (let i = 0; i < 3 && n; i += 1, n = n.parentElement) {
      if ((n.className || '').toString().trim()) return false;
    }
    return true;
  });
  if (!own.length) return { frame: Math.round(frame.getBoundingClientRect().height), rows: [] };
  // Each pane row draws a WIDE plot canvas and a narrow price-scale one, twice
  // over (main + top layer). The plot column is the widest; one row per height.
  const wide = Math.max(...own.map(c => c.width));
  const rows = [];
  for (const c of own) {
    if (c.width !== wide) continue;
    if (rows.length && rows[rows.length - 1] === c.height) continue;
    rows.push(c.height);
  }
  return { frame: Math.round(frame.getBoundingClientRect().height), rows, width: wide };
}"""

SET_HEIGHT_JS = """(h) => {
  const pane = document.querySelector('[data-testid="pine-member-pane"]');
  pane.firstElementChild.style.height = h + 'px';
  return true;
}"""


def run(base: str, self_check: bool = False, headed: bool = False) -> int:
    try:
        from playwright.sync_api import sync_playwright
    except Exception as exc:                                    # pragma: no cover
        _log(f"INCONCLUSIVE: playwright is not importable ({exc})")
        return INCONCLUSIVE

    source = SCRIPT.read_text(encoding="utf-8")
    _log(f"script: {SCRIPT.name}, {len(source)} chars")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not headed)
        # ⛔ A PINNED VIEWPORT. The `NavBar` does not exist below 1025px, and an
        # unpinned window has bitten this repo's mobile audit before by reporting
        # every route "not rendered for this account".
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        try:
            r = page.request.post(f"{base}/api/auth/login", data=json.dumps({
                "email": "mobtest@local.dev", "password": "LocalTest2026!",
            }), headers={"Content-Type": "application/json"})
            if r.status != 200:
                _log(f"INCONCLUSIVE: login returned {r.status} — is the local backend up?")
                return INCONCLUSIVE

            page.goto(f"{base}/charts", wait_until="domcontentloaded")
            page.keyboard.press("Escape")           # the intro animation

            gate = page.evaluate("""async () => {
              const G = await import('/src/components/chart/engine/memberPaneGate.js');
              return { enabled: G.memberPaneEnabled(), visibility: document.visibilityState };
            }""")
            _log(f"gate: {gate}")
            if not gate.get("enabled"):
                _log("INCONCLUSIVE: VITE_PINE_MEMBER_PANE_ENABLED is not '1' on this server")
                return INCONCLUSIVE
            # ⭐ AND THE VISIBILITY IS RECORDED, NOT ASSUMED. A headless page is
            # 'visible'; if it ever reads 'hidden' the rAF loop this measures is
            # throttled and the answer is about the harness.
            if gate.get("visibility") != "visible":
                _log(f"INCONCLUSIVE: page reads {gate.get('visibility')} — rAF is throttled")
                return INCONCLUSIVE

            page.wait_for_selector('button[title*="Indicators"], button[aria-label*="Indicators"]',
                                   timeout=45_000)
            page.evaluate("""() => {
              const b = [...document.querySelectorAll('button')].find(
                x => (x.title || x.getAttribute('aria-label') || '').includes('Indicators'));
              b.click();
            }""")
            # ⛔ WAIT FOR THE TARGET, NEVER FOR A DURATION. A fixed sleep here
            # made this probe fail on a cold dev server with `Cannot read
            # properties of undefined (reading 'click')` — an error about the
            # harness, reported as if the product had no Import tab.
            page.wait_for_function("""() => [...document.querySelectorAll('*')].some(
              n => n.children.length === 0 && n.textContent.trim() === 'New formula')""",
              timeout=30_000)
            page.evaluate("""() => {
              const e = [...document.querySelectorAll('*')].find(
                n => n.children.length === 0 && n.textContent.trim() === 'New formula');
              (e.closest('button') || e.closest('[role="button"]') || e.parentElement).click();
            }""")
            page.wait_for_function("""() => [...document.querySelectorAll('button')].some(
              b => b.textContent.trim() === 'Import')""", timeout=30_000)
            page.evaluate("""() => {
              [...document.querySelectorAll('button')]
                .find(b => b.textContent.trim() === 'Import').click();
            }""")
            page.wait_for_selector('textarea[placeholder^="//@version"]', timeout=30_000)
            page.evaluate("""(src) => {
              const ta = document.querySelector('textarea[placeholder^="//@version"]');
              const d = Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype, 'value');
              d.set.call(ta, src);
              ta.dispatchEvent(new Event('input', { bubbles: true }));
            }""", source)
            page.wait_for_selector('[data-testid="pine-member-pane"]', timeout=30_000)
            page.wait_for_timeout(2500)

            readings = []
            for h in HEIGHTS:
                page.evaluate(SET_HEIGHT_JS, h)
                # ⭐ TWO FRAMES AND A BEAT. `autoSize` runs off a ResizeObserver
                # into rAF; one frame is the observer, the next is the redraw.
                page.evaluate("""() => new Promise(r =>
                  requestAnimationFrame(() => requestAnimationFrame(r)))""")
                page.wait_for_timeout(700)
                m = page.evaluate(MEASURE_JS)
                if m is None:
                    _log("INCONCLUSIVE: the pane vanished mid-measurement")
                    return INCONCLUSIVE
                if self_check:
                    # ⛔ THE SELF-CHECK FREEZES THE READING, not the page: it
                    # reports the FIRST measurement for every height, which is
                    # exactly what a pane that ignored its container would look
                    # like. A self-check that could not fail is the thing this
                    # whole file exists to avoid.
                    m = readings[0][1] if readings else m
                readings.append((h, m))
                _log(f"  frame {h:>4}px  ->  measured {m['frame']:>4}px   "
                     f"rows {m['rows']}")

            frames = [m["frame"] for _, m in readings]
            _log("")
            if len(set(frames)) != len(HEIGHTS):
                _log(f"VERDICT: MEASURED FAIL — the frame itself did not take the "
                     f"heights it was given: {frames}")
                return FAIL

            # ⛔ THE ROWS ARE `[price, member, time-axis]`. Two rows means the
            # member's series is sharing the price pane — the D1/placement rule
            # broken — and that reads as a pass to any check that only compared
            # totals, which is why the count is asserted before the arithmetic.
            plots = []
            for h, m in readings:
                rows = m["rows"]
                if len(rows) < 3:
                    _log(f"VERDICT: MEASURED FAIL — at {h}px the chart shows "
                         f"{len(rows)} row(s) {rows}; the member's series needs a "
                         f"pane of its own beneath the price pane")
                    return FAIL
                price, member = rows[0], rows[1]
                share = member / (price + member)
                plots.append((h, price, member, share))
                _log(f"  at {h:>4}px  price {price:>4}  member {member:>4}  "
                     f"axis {rows[-1]:>3}  share {share:.3f}")

            if len({(p, m) for _, p, m, _ in plots}) != len(HEIGHTS):
                _log(f"VERDICT: MEASURED FAIL — the container moved {frames} and the "
                     f"chart's own panes did not: {[(p, m) for _, p, m, _ in plots]}")
                return FAIL

            # ⭐ AND THE QUARTER-HEIGHT RULE SURVIVES THE MOVE. `MEMBER_PANE_HEIGHT`
            # is a FRACTION, so the member's sub-pane must stay a quarter at every
            # size — a chart that resized but redistributed its panes evenly would
            # pass the test above and still be wrong.
            for h, _price, _member, share in plots:
                if not (0.18 <= share <= 0.32):
                    _log(f"VERDICT: MEASURED FAIL — at {h}px the member pane is "
                         f"{share:.3f} of the plot, not the declared 0.25")
                    return FAIL

            _log("VERDICT: PASS — the pane follows its container and keeps its quarter")
            return PASS
        finally:
            ctx.close()
            browser.close()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base", default="http://localhost:5173")
    ap.add_argument("--self-check", action="store_true",
                    help="freeze the readings so a working pane still FAILS")
    ap.add_argument("--headed", action="store_true")
    a = ap.parse_args()
    code = run(a.base, self_check=a.self_check, headed=a.headed)
    if a.self_check:
        # ⛔ INVERTED ON PURPOSE. `--self-check` succeeds only by FAILING.
        ok = code == FAIL
        _log(f"SELF-CHECK: {'ok — the probe can fail' if ok else 'BROKEN — it passed a frozen reading'}")
        return PASS if ok else FAIL
    return code


if __name__ == "__main__":
    sys.exit(main())
