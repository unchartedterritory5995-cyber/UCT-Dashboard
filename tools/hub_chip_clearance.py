"""G3-15 on a real layout engine — does the Actions button still cover the mode chip?

⛔⛔ WHY THIS EXISTS AS A SEPARATE INSTRUMENT FROM THE UNIT RAIL. `hubChipActionsClearance.test.jsx`
measures DECLARED boxes: jsdom performs no layout, so it can prove the two anchors are far enough
apart and nothing more. The defect it is railing was found by `elementFromPoint` on real glass,
and `elementFromPoint` is a question only a browser that has actually laid the page out can
answer — paint order, `z-index`, an ancestor stacking context and a transform can each put the
wrong element on top while every declared offset stays exactly where the rail expects it.

⭐ WHAT "THE FORMER OVERLAP" MEANS HERE, because the phrase is ambiguous and the ambiguity matters.
Before the fix the chip's rightmost 40px were underneath the button. After it, that BAND OF SCREEN
belongs to the button alone — asking whether that rectangle returns the chip would be asking the
chip to be in two places. The property the row actually wants is that **no part of the chip is
covered any more**, so this sweeps the chip's own box — with the rightmost 40px, the exact strip
that was swallowed, sampled hardest — and requires every point to resolve inside the chip.

Usage:
    python tools/hub_chip_clearance.py --base https://uctintelligence.com   # + SMOKE_EMAIL/PASSWORD
    python tools/hub_chip_clearance.py --self-check
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from hub_nav_smoke import login, route_to_mode, say  # noqa: E402

# The widths the standing rails already use. 375/430 are the spec's own pair; 360 (a common small
# Android layout width) was added at the Phase 1 gate.
WIDTHS = (360, 375, 430)

# The strip that was swallowed on the device, in CSS px. Sampled at every pixel rather than at a
# midpoint: a 40px band checked once at its centre would have passed on a 41px overlap.
SWALLOWED_BAND_PX = 40


def rect_overlap(a: dict, b: dict) -> tuple[float, float]:
    """(x, y) overlap in px between two DOMRect-shaped dicts. <= 0 on either axis means clear."""
    return (
        min(a["right"], b["right"]) - max(a["left"], b["left"]),
        min(a["bottom"], b["bottom"]) - max(a["top"], b["top"]),
    )


def evaluate(mode: str, width: int, chip: dict | None, btn: dict | None,
             hits: list[dict]) -> list[str]:
    """The whole verdict for one (mode, width), as a list of failure strings. Pure — the browser
    work happens above it — so `--self-check` can drive it on fixtures and prove it can fail."""
    fails: list[str] = []
    if chip is None:
        # Not a pass. A mode that renders no chip may be legitimate (notebook renders none), but
        # that is the CALLER's decision to skip; reaching here with no chip means the sweep was
        # asked to measure something that was not there.
        return [f"{mode} @{width}: no chip rect — nothing was measured"]
    if btn is None:
        return [f"{mode} @{width}: no Actions button rect — nothing was measured"]

    ox, oy = rect_overlap(chip, btn)
    if ox > 0 and oy > 0:
        fails.append(f"{mode} @{width}: chip and Actions button overlap by {ox:.0f} x {oy:.0f} px")

    # ⛔ AN EMPTY SWEEP IS A FAILED INVOCATION, NEVER A CLEAN ONE. Without this, a selector typo or
    # a chip of zero width reports "no point returned the wrong element" — which is true, and is
    # the same sentence a healthy run prints. Absence is not a pass.
    if not hits:
        fails.append(f"{mode} @{width}: the elementFromPoint sweep produced NO samples")
        return fails

    covered = [h for h in hits if not h["isChip"]]
    if covered:
        where = ", ".join(f"x={h['x']:.0f}->{h['what']}" for h in covered[:6])
        fails.append(
            f"{mode} @{width}: {len(covered)}/{len(hits)} points inside the chip resolve to "
            f"something else ({where})"
        )
    return fails


# ── the browser half ─────────────────────────────────────────────────────────────────────────
PROBE = """() => {
  const chip = document.querySelector('[data-testid="hub-chip"]');
  const btn = [...document.querySelectorAll('button[aria-label]')]
    .find((b) => /actions$/i.test(b.getAttribute('aria-label')));
  const R = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
  };
  const out = { chip: R(chip), btn: R(btn), hits: [] };
  if (!chip) return out;
  const r = chip.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return out;
  const y = r.top + r.height / 2;
  // Sample every pixel of the chip's rightmost BAND px (the strip the device found swallowed),
  // plus a coarse sweep of the rest so a chip covered anywhere else is caught too.
  const xs = [];
  for (let x = Math.max(r.left, r.right - BAND); x < r.right; x += 1) xs.push(x);
  for (let x = r.left + 1; x < r.right - BAND; x += 8) xs.push(x);
  for (const x of xs) {
    const el = document.elementFromPoint(x, y);
    out.hits.push({
      x,
      isChip: Boolean(el && (el === chip || chip.contains(el))),
      what: el ? (el.getAttribute('data-testid') || el.getAttribute('aria-label')
                  || el.tagName.toLowerCase()) : 'null',
    });
  }
  return out;
}"""


def run(base: str, headed: bool) -> int:
    import os  # noqa: PLC0415

    from playwright.sync_api import sync_playwright  # noqa: PLC0415

    routes = route_to_mode()
    # CONTROL: a silently empty route table would sweep nothing and report a clean run.
    if len(routes) < 9:
        say(f"⛔ INCONCLUSIVE — the registry yielded only {len(routes)} routed modes; "
            "this sweep is supposed to cover nine.", err=True)
        return 2
    say(f"  routed modes derived from registry.js: {len(routes)} — {sorted(routes.values())}")

    # ⛔ TWO DIFFERENT REASONS, TWO DIFFERENT SENTENCES. `hub_nav_smoke.login` returns False both
    # when the credentials are absent and when the POST fails, and the first draft of this file
    # printed "no SMOKE_EMAIL / SMOKE_PASSWORD" at a run whose real problem was a 502 from a pod
    # mid-redeploy. A diagnostic that names the wrong cause sends the next reader to the wrong box.
    if not os.environ.get("SMOKE_EMAIL") or not os.environ.get("SMOKE_PASSWORD"):
        say("⛔ INCONCLUSIVE — SMOKE_EMAIL / SMOKE_PASSWORD are not in the environment, so the "
            "hub is not exposed and there is nothing to measure.", err=True)
        return 2

    all_fails: list[str] = []
    measured = 0
    no_chip: list[str] = []
    with sync_playwright() as pw:
        br = pw.chromium.launch(headless=not headed)
        # ⭐ ONE CONTEXT, ONE SIGN-IN, RESIZED PER WIDTH. A context per width meant three logins,
        # and the run that found this died on the second when the pod answered 502 — three round
        # trips to prove one fact is three chances to lose it. `is_mobile`/`has_touch` are
        # context-level, so they survive every `set_viewport_size`.
        ctx = br.new_context(
            viewport={"width": WIDTHS[0], "height": 780},
            device_scale_factor=3,
            # ⛔ BOTH, OR THE HUB NEVER MOUNTS. `useHubEligible` gates on
            # `(max-width: 1023px) and (pointer: coarse)`; without `has_touch` Chromium reports
            # `pointer: fine` and every route would report "no chip" — a clean sweep of a
            # product that was never eligible (`lesson_pointer_fine_does_not_mean_desktop`).
            is_mobile=True,
            has_touch=True,
        )
        page = ctx.new_page()
        if not login(page, base):
            say("⛔ INCONCLUSIVE — the credentials are present but sign-in did not succeed "
                "(see the HTTP status above). Nothing was measured.", err=True)
            br.close()
            return 2
        for width in WIDTHS:
            page.set_viewport_size({"width": width, "height": 780})
            for route, mode in sorted(routes.items()):
                page.goto(f"{base}{route}", wait_until="domcontentloaded", timeout=45000)
                # ⛔ WAIT FOR THE HUB, DO NOT SLEEP AT IT. A fixed 2.5s pause reported "no chip"
                # for /screener — a route that demonstrably renders one on a real device — because
                # 3,745 rows had not finished arriving. That reads in the log exactly like a mode
                # that has no chip by design, which is a different fact.
                try:
                    page.wait_for_selector('[data-testid="hub-root"]', timeout=15000)
                except Exception:  # noqa: BLE001 - absence is the finding, not an error
                    say(f"  ⛔ {mode} @{width}: the hub never mounted — INCONCLUSIVE, not a pass",
                        err=True)
                    all_fails.append(f"{mode} @{width}: hub-root never appeared")
                    continue
                page.wait_for_timeout(1200)
                out = page.evaluate(PROBE.replace("BAND", str(SWALLOWED_BAND_PX)))
                if out["chip"] is None:
                    # The hub IS mounted and this mode still renders no chip — a real product
                    # fact (notebook is one), distinguishable now from "the page was not ready".
                    no_chip.append(f"{mode}@{width}")
                    say(f"  – {mode} @{width}: hub mounted, no chip (recorded, not a failure)")
                    continue
                measured += 1
                fails = evaluate(mode, width, out["chip"], out["btn"], out["hits"])
                if fails:
                    all_fails.extend(fails)
                    for f in fails:
                        say(f"  ✗ {f}")
                else:
                    say(f"  ✓ {mode} @{width}: {len(out['hits'])} points, all chip; "
                        f"chip.left {out['chip']['left']:.0f} is "
                        f"{out['chip']['left'] - out['btn']['right']:.0f}px clear of the button")
        ctx.close()
        br.close()

    if measured == 0:
        say("⛔ INCONCLUSIVE — no mode rendered a chip at any width. Nothing was measured.",
            err=True)
        return 2
    if no_chip:
        say(f"  modes with the hub up but no chip: {', '.join(no_chip)}")
    say(f"\n  {measured} (mode, width) pairs measured")
    if all_fails:
        say(f"⛔ G3-15 FAILS on {len(all_fails)} count(s).", err=True)
        return 1
    say("✅ G3-15 PASSES — no point of the chip is covered by the Actions button, on any "
        "routed mode at any of the three widths.")
    return 0


# ── the instrument's own control, in a real engine ───────────────────────────────────────────
#
# ⛔ A TOOL THAT HAS ONLY EVER PRINTED ✗ HAS NOT BEEN SHOWN TO BE ABLE TO PRINT ✓. The production
# run above goes red on all 27 pairs, which proves the sweep SEES the defect and proves nothing
# about whether it can clear a healthy page — and the fixed build cannot be swept until it
# deploys. So the browser half gets its own pair of cases on a synthetic page laid out by real
# Chromium: one where the two boxes are clear and one where they overlap by the amount the device
# measured. ⚠️ This asserts nothing about the PRODUCT's geometry — the numbers are the fixture's,
# not the components' — it asserts that `elementFromPoint` + `evaluate()` can return both answers.
FIXTURE = """<!doctype html><meta name=viewport content="width=device-width">
<style>
  body { margin:0; height:100vh; background:#111; }
  #chip, #btn { position:fixed; bottom:96px; z-index:360; }
  #chip { right:%(chipRight)dpx; height:28px; padding:0 12px; background:#333; color:#eee;
          white-space:nowrap; display:flex; align-items:center; font:14px sans-serif; }
  #btn  { right:114px; width:44px; height:44px; bottom:88px; background:#555; border:0; }
</style>
<div id=chip data-testid="hub-chip"><b>SCREENER</b><span>&nbsp;tap: next result</span></div>
<button id=btn aria-label="Scan actions"><svg width=18 height=18></svg></button>"""


def fixture_control(headed: bool) -> int:
    from playwright.sync_api import sync_playwright  # noqa: PLC0415

    fails: list[str] = []
    with sync_playwright() as pw:
        br = pw.chromium.launch(headless=not headed)
        page = br.new_context(viewport={"width": 393, "height": 780},
                              is_mobile=True, has_touch=True).new_page()
        for label, chip_right, want_fail in (("clear", 166, False), ("overlapping", 118, True)):
            page.set_content(FIXTURE % {"chipRight": chip_right})
            page.wait_for_timeout(120)
            out = page.evaluate(PROBE.replace("BAND", str(SWALLOWED_BAND_PX)))
            got = evaluate("fixture", 393, out["chip"], out["btn"], out["hits"])
            ox, _ = rect_overlap(out["chip"], out["btn"]) if out["chip"] and out["btn"] else (0, 0)
            say(f"  fixture[{label}] chipRight={chip_right} overlapX={ox:.0f} "
                f"samples={len(out['hits'])} -> {'FAIL' if got else 'PASS'}")
            if bool(got) is not want_fail:
                fails.append(f"fixture[{label}] expected {'FAIL' if want_fail else 'PASS'}, "
                             f"got {got or 'PASS'}")
            if not out["hits"]:
                fails.append(f"fixture[{label}] swept no points — the probe measured nothing")
        br.close()
    if fails:
        say("⛔ FIXTURE CONTROL FAILED:\n  " + "\n  ".join(fails), err=True)
        return 1
    say("✅ FIXTURE CONTROL PASS — in real Chromium the sweep returns PASS on clearing boxes and "
        "FAIL on the 40px overlap the device measured, so a green production run would mean "
        "something.")
    return 0


def self_check() -> int:
    fails: list[str] = []
    # ⭐ THE FIXTURES ARE THE DEVICE'S OWN NUMBERS, not invented ones. iPhone 15 Pro / iOS 17.6,
    # 2026-09-12: button {left 235, right 279, top 527, bottom 571}; the pre-fix chip
    # {left 46, right 275, top 535, bottom 563}. `clear_chip` is that same chip moved to where the
    # fix puts it (right edge 227, 8px clear of the button's left edge), so a change to the fix's
    # arithmetic shows up here as a changed number rather than as a fixture that agrees with
    # whatever the code now does.
    btn = {"left": 235, "right": 279, "top": 527, "bottom": 571, "width": 44}
    clear_chip = {"left": 100, "right": 227, "top": 535, "bottom": 563, "width": 127}
    good_hits = [{"x": x, "isChip": True, "what": "hub-chip"} for x in range(187, 227)]

    def case(name, got, want_empty):
        if bool(got) == want_empty:
            fails.append(f"{name}: expected {'no' if want_empty else 'a'} failure, got {got}")

    case("a clear chip with a clean sweep passes",
         evaluate("scan", 393, clear_chip, btn, good_hits), want_empty=True)

    # The pre-fix geometry, verbatim from the device: chip right 275, button [235, 279].
    pre_fix = {"left": 46, "right": 275, "top": 535, "bottom": 563, "width": 229}
    case("the measured pre-fix rects are reported as overlapping",
         evaluate("scan", 393, pre_fix, btn, good_hits), want_empty=False)

    # ⭐ THE CASE THE DEVICE ACTUALLY FOUND: rects that look clear while a point in the chip's own
    # right-hand band resolves to something painted on top. A rect-only check would miss it.
    covered = good_hits[:-3] + [{"x": x, "isChip": False, "what": "svg"} for x in range(224, 227)]
    case("a point inside the chip resolving to another element is a failure",
         evaluate("scan", 393, clear_chip, btn, covered), want_empty=False)

    # ⛔ THE CONTROL THAT KEEPS THE WHOLE FILE HONEST.
    case("an empty sweep is a FAILURE, not a clean run",
         evaluate("scan", 393, clear_chip, btn, []), want_empty=False)
    case("a missing chip is a failure, not a skip",
         evaluate("scan", 393, None, btn, good_hits), want_empty=False)
    case("a missing Actions button is a failure, not a skip",
         evaluate("scan", 393, clear_chip, None, good_hits), want_empty=False)

    # The overlap arithmetic itself, against the numbers the device returned.
    ox, oy = rect_overlap(pre_fix, btn)
    if (round(ox), round(oy)) != (40, 28):
        fails.append(f"rect_overlap disagrees with the device measurement: got {ox} x {oy}, "
                     "expected 40 x 28")

    if fails:
        say("SELF-CHECK FAILED:\n  " + "\n  ".join(fails), err=True)
        return 1
    say("SELF-CHECK PASS — 6 verdict cases plus the arithmetic, including the two that matter: "
        "an empty sweep reads as a FAILURE, and a chip whose rects look clear while a point "
        "inside it resolves to another element is still caught.")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default="https://uctintelligence.com")
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--self-check", action="store_true")
    ap.add_argument("--fixture-control", action="store_true",
                    help="prove in a real engine that the sweep can return PASS as well as FAIL")
    args = ap.parse_args(argv)
    if args.self_check:
        rc = self_check()
        return rc if rc else fixture_control(args.headed)
    if args.fixture_control:
        return fixture_control(args.headed)
    say(f"G3-15 chip clearance — {args.base}, widths {json.dumps(list(WIDTHS))}")
    return run(args.base, args.headed)


if __name__ == "__main__":
    raise SystemExit(main())
