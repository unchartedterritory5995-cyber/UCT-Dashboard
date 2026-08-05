#!/usr/bin/env python3
"""Generate every parity case's ``regions`` block FROM THE LAYOUT, not by eye.

B5 Task 11 has to say WHERE the Flip-C cutover's pixels land, per case. The
harness supports that (``regions``: named rectangles counted from the same mask
the headline number came from, plus a computed ``rest`` nobody may declare), but
somebody has to write ~46 rectangles into ``chart_parity_cases.json``.

⛔ A HAND-DRAWN BOX IS A HAND-COPY, which is the defect this branch has shipped
twice. So the boxes are DERIVED, and this file is committed so they can be
REGENERATED rather than re-typed::

    python tools/spa_server.py .parity-dist-a 5931      # PANE_MODE = 'bands'
    python tools/spa_server.py .parity-dist-b 5932      # PANE_MODE = 'panes'
    python tools/gen_parity_regions.py \
        --bands http://127.0.0.1:5931 --panes http://127.0.0.1:5932 --write

──────────────────────────────────────────────────────────────────────────────
WHERE THE NUMBERS COME FROM, AND WHY NOT `computePaneLayout` DIRECTLY
──────────────────────────────────────────────────────────────────────────────

The brief said "import ``computePaneLayout`` for each case's settings". That
function is pure and would answer, but its INPUTS are not: it takes the merged
``chart_settings`` and the ENGINE INSTANCE LIST, and those are produced by
``mergeChartSettings`` (settingsVersion 2 folds ``indicators.<id>`` into
``indicatorInstances``) composed with ``mergeSettingsOverride`` and
``csForPaneMargins``, inside ``StockChart``. Reproducing that pipeline in a
generator would be a SECOND implementation of the very merge the gate exists to
protect — a hand-copy wearing a script's clothes.

So the boxes are read off the thing the layout actually PRODUCED: the pane
manifest (``window.__paneManifest``), which ``paneLayout.paneManifest`` builds by
reading the renderer back. It carries the pane stack's height, the separator
height, and every pane's realised pixel height. That is strictly closer to the
pixels than the pure function is, and it is the same artefact the harness already
diffs as JSON.

FIVE rectangles per case that TILE the export, plus the ``rest`` the harness
computes and nobody may declare:

  * ``export_header`` — the band ABOVE the chart inside ``#chart-export``.
    ⚠️ **40 px on every case, and Task 11's boxes did not know it was there** —
    every rectangle it derived was 40 px too high, so its ``time_axis`` box
    started 40 px INSIDE the volume pane. The offset is read off the page now.
  * ``price_plot`` — **THE CANDLE PANE**: the candles, the MA and price overlays,
    and the price axis. **This is the region the cutover's design claims reads
    ABSOLUTE 0**, and it is the §A6 identity's whole subject.
  * ``mid_panes``  — the panes BETWEEN the candles and the oscillator stack: the
    separate volume pane, and Model Book's index pane. ⚠️ **ADDED AT TASK 11b,
    AND IT IS THE HONEST HALF OF THE ANSWER.** Task 11's ``price_plot`` ran from
    the top of the canvas to the top of the stack, so it contained the volume
    pane — and the cutover MOVES the volume pane (the oscillators become panes
    BELOW it), so that rectangle could never read 0 no matter how the candles
    were fitted. One number was answering two different questions: "did the
    candles hold still" and "did the reordering cost anything". They are separate
    rectangles now, and only the first one is the identity.
  * ``osc_strip``  — the oscillator stack the cutover creates.
  * ``time_axis``  — the time axis and the export footer, below the pane stack.
  * ``rest``       — computed by mask subtraction, never declarable. With four
    rectangles tiling the export it has nowhere left to hide a pixel.

The boundary is ``Σ heights of the panes that existed BEFORE the cutover +
their separators``. The panes the cutover ADDS are appended after them
(``computePaneLayout``'s ``firstPaneIndex``), so "the panes side B has that side
A does not" is exactly the oscillator stack — derived, not assumed, and asserted
below (side B may not have FEWER panes, and the two sides must agree on the
stack height and the separator).

A case whose two sides have the SAME pane count creates no stack (every price
overlay: bb, vwap, sar, ichimoku, donchian, …). It gets ONE rectangle covering
the whole pane stack; a second, zero-area one would be refused by
``validate_regions`` and would read exactly like a region that is holding the
line.

⛔ ONLY ``--gate`` CASES GET AN ``expect``, AND THE DEFAULT IS THE ONE CASE THAT
ALREADY HAD ONE. Every other case's rectangles are MEASURED AND REPORTED BUT NOT
GATED, which is the case file's own documented way of giving a new rectangle its
number before anyone signs off on it. Two reasons, and the second is a rail:

  * ``rsi_only`` shipped three gated ``expect: 0`` regions. Replacing them with
    ungated ones would have WEAKENED the tree, so its replacements keep the 0 —
    which is the true, currently-holding expectation under ``PANE_MODE = 'bands'``
    — and, because declaring any region expectation also gates the computed
    ``rest``, that case's ``rest`` still gates too.
  * ``tests/test_chart_parity_harness.py::
    test_a_case_that_declares_NOTHING_still_collapses_on_its_tolerance`` asserts
    that AT LEAST 24 cases declare nothing at all — it is the backwards-
    compatibility rail for "zero survives twelve of thirteen tasks". Declaring an
    expectation on all 46 would have taken that rail's subject away at Task 11
    instead of Task 12, and it would have gone red saying so.

Task 12 writes the cutover's own per-region numbers, once the owner has answered
``docs/decisions/2026-08-04-flip-c-pane-geometry.md``.
"""
from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import chart_parity as cp  # noqa: E402  (same directory, deliberately)

from playwright.sync_api import sync_playwright  # noqa: E402


# 🔴 THE PANE STACK DOES NOT START AT y = 0 OF THE EXPORT, AND TASK 11's BOXES
# ASSUMED IT DID. `#chart-export` — the ELEMENT the harness screenshots — carries
# a header band above the chart, MEASURED at 40 px on every case: the LWC table
# sits at `top = 40`, pane 0's canvas at 40, the volume pane's at 455, the time
# axis' at 572. So every rectangle Task 11 derived was 40 px too high, and the
# consequence was not cosmetic: its `time_axis` box ran from 532, which is 40 px
# INSIDE the volume pane. The 35,471 px it attributed to "the time axis, because
# the price-axis labels moved" were the BOTTOM OF THE VOLUME PANE moving — the
# reordering, measured in the wrong rectangle and explained by the wrong chain.
#
# ⛔ SO THE OFFSET IS READ OFF THE PAGE, per case, from the pane canvases
# themselves. Not hard-coded: 40 is what this box measures today, and a number
# nobody can re-derive is the hand-copy this generator exists to refuse.
_STACK_TOP_JS = """() => {
  const root = document.getElementById('chart-export');
  if (!root) return null;
  const rr = root.getBoundingClientRect();
  const tops = [...root.querySelectorAll('canvas')]
    .map((c) => c.getBoundingClientRect())
    .filter((r) => r.width > 200 && r.height > 20)
    .map((r) => Math.round(r.top - rr.top));
  if (!tops.length) return null;
  return {top: Math.min(...tops), height: Math.round(rr.height), width: Math.round(rr.width)};
}"""


def read_manifest_for(page, base, case, token, ready_timeout_ms):
    """Load one case on one base and return its pane manifest PLUS the pixel row
    the pane stack starts on inside `#chart-export`.

    ``instances_mode="none"`` on purpose: the boxes must describe the LEGACY
    render both sides share, not one side's engine rehearsal.
    """
    url = cp.case_url(base, case, token, None, side="a",
                      instances_mode="none", perturb_instances=None)
    page.goto(url, wait_until="domcontentloaded")
    page.wait_for_function("() => window.__chartReady === true", timeout=ready_timeout_ms)
    m = page.evaluate("() => window.__paneManifest ?? null")
    if not isinstance(m, dict):
        raise SystemExit(
            f"{case['name']}: {base} published no pane manifest. The boxes are derived from "
            f"it, so a missing manifest is a refusal, not a guess.")
    geom = page.evaluate(_STACK_TOP_JS)
    if not isinstance(geom, dict):
        raise SystemExit(
            f"{case['name']}: {base} would not say where the pane stack starts inside "
            f"#chart-export. Every rectangle is measured from that row; guessing 0 is "
            f"what put 35,471 px in the wrong region at Task 11.")
    m = dict(m)
    m["_stackTop"] = geom["top"]
    return m


def boxes_for(case, man_a, man_b, gated):
    """The rectangles, from the two manifests. Refuses rather than guesses."""
    exp = {"expect": 0} if case["name"] in gated else {}
    w = case.get("w", 1200)
    h = case.get("h", 620)
    if man_a["chartHeight"] != man_b["chartHeight"]:
        raise SystemExit(
            f"{case['name']}: the two sides disagree about the pane stack's height "
            f"({man_a['chartHeight']} vs {man_b['chartHeight']}). The boundary between "
            f"price_plot and osc_strip is only meaningful if they agree.")
    if man_a["separatorPx"] != man_b["separatorPx"]:
        raise SystemExit(f"{case['name']}: separatorPx differs "
                         f"({man_a['separatorPx']} vs {man_b['separatorPx']}).")
    if man_a["_stackTop"] != man_b["_stackTop"]:
        raise SystemExit(
            f"{case['name']}: the two sides put the pane stack at different rows inside "
            f"#chart-export ({man_a['_stackTop']} vs {man_b['_stackTop']}). Every rectangle "
            f"is measured from that row, so they cannot share one.")
    top = man_a["_stackTop"]
    chart_height = man_a["chartHeight"]
    sep = man_a["separatorPx"]
    n_a, n_b = len(man_a["panes"]), len(man_b["panes"])
    if n_b < n_a:
        raise SystemExit(
            f"{case['name']}: the panes build has FEWER panes than the bands build "
            f"({n_b} < {n_a}). The cutover only ever appends; this is not a stack.")
    if chart_height <= 0 or chart_height > h:
        raise SystemExit(f"{case['name']}: implausible pane-stack height {chart_height} "
                         f"for a {w}x{h} export.")

    # THE THIRD RECTANGLE IS NOT DECORATION AND IT WAS NOT PLANNED. The first
    # measurement put 35,471 changed pixels into `rest` on `rsi_only` alone, all of
    # them in y[532,572) across the full width: THE TIME AXIS. The cutover re-fits
    # the candles into a shorter pane 0, which changes the visible price range,
    # which changes the price-axis label widths, which moves the plot area's left
    # edge -- and every time-axis label with it. A pixel nobody named is exactly
    # what `rest` exists to catch, so it is NAMED here rather than tolerated, and
    # the three rectangles then TILE the export (the shape `rsi_only` shipped with:
    # "rest has nowhere to hide a pixel").
    if not 0 <= top or top + chart_height > h:
        raise SystemExit(f"{case['name']}: pane stack [{top}, {top + chart_height}) does not "
                         f"fit inside a {w}x{h} export.")
    time_axis = {"name": "time_axis", "box": [0, top + chart_height, w, h], **exp}
    # The export's own header band, above the chart. Named so the five rectangles
    # TILE and `rest` has nowhere left to hide a pixel. Zero-area is impossible to
    # declare (`validate_regions`), so a header-less export simply omits it.
    header = ([{"name": "export_header", "box": [0, 0, w, top], **exp}] if top > 0 else [])

    # ── the candle pane, on the side that has the MOST panes ──
    # The rectangle has to be the SMALLER of the two sides' pane 0, or it would
    # contain a strip that is candles on one side and something else on the
    # other, and a region that mixes two things cannot say which one moved.
    candle_h = min(man_a["panes"][0]["height"], man_b["panes"][0]["height"])
    if not 0 < candle_h <= chart_height:
        raise SystemExit(f"{case['name']}: derived candle-pane height {candle_h} is not "
                         f"inside the pane stack (height {chart_height}).")

    if n_b == n_a:
        # No stack was created. There is still a volume pane below the candles on
        # every chart this app draws, and it is still a different question from
        # "did the candles hold still" -- so it is still its own rectangle.
        if candle_h >= chart_height:
            return header + [{"name": "price_plot", "box": [0, top, w, top + chart_height], **exp},
                             time_axis], chart_height
        return header + [
            {"name": "price_plot", "box": [0, top, w, top + candle_h], **exp},
            {"name": "mid_panes", "box": [0, top + candle_h, w, top + chart_height], **exp},
            time_axis], chart_height

    osc_top = sum(p["height"] for p in man_b["panes"][:n_a]) + n_a * sep
    if not 0 < osc_top < chart_height:
        raise SystemExit(f"{case['name']}: derived oscillator-stack top {osc_top} is not "
                         f"inside the pane stack (height {chart_height}).")
    if candle_h > osc_top:
        raise SystemExit(f"{case['name']}: the candle pane ({candle_h}) reaches past the "
                         f"oscillator stack's top ({osc_top}); the boxes would overlap.")
    out = header + [{"name": "price_plot", "box": [0, top, w, top + candle_h], **exp}]
    if candle_h < osc_top:
        out.append({"name": "mid_panes", "box": [0, top + candle_h, w, top + osc_top], **exp})
    out.append({"name": "osc_strip", "box": [0, top + osc_top, w, top + chart_height], **exp})
    out.append(time_axis)
    return out, chart_height


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bands", required=True, help="base URL serving the PANE_MODE='bands' dist")
    ap.add_argument("--panes", required=True, help="base URL serving the PANE_MODE='panes' dist")
    ap.add_argument("--cases", nargs="*", help="subset of case names (default: every live case)")
    ap.add_argument("--token", default="")
    ap.add_argument("--ready-timeout", type=int, default=60_000)
    ap.add_argument("--gate", nargs="*", default=["rsi_only"],
                    help="cases whose regions get a gated `expect: 0` (see the module docstring: the DEFAULT is the one case that already had one, and widening it takes the subject away from the harness suite's undeclared-case rail)")
    ap.add_argument("--write", action="store_true",
                    help="write the blocks back into chart_parity_cases.json")
    args = ap.parse_args()

    ident_a = cp.read_build_identity(args.bands)
    ident_b = cp.read_build_identity(args.panes)
    if ident_a["id"] == ident_b["id"]:
        raise SystemExit(
            f"both bases serve the SAME build ({ident_a['id']}). The boundary is the "
            f"difference between the two pane stacks; one build cannot be two.")
    print(f"bands = {ident_a['id']}  panes = {ident_b['id']}")

    cases = cp.load_cases(cp.CASES_PATH, args.cases, False)
    gated = set(args.gate or [])
    derived = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--force-color-profile=srgb", "--font-render-hinting=none", "--disable-lcd-text"])
        for case in cases:
            w, h = case.get("w", 1200), case.get("h", 620)
            mans = {}
            for label, base in (("a", args.bands), ("b", args.panes)):
                # ⚠️ ONE RETRY, AND ONLY ONE. Six single-threaded `spa_server`s and
                # a browser on one box occasionally starve a load past the ready
                # timeout; a manifest read is not a measurement, so a retry here
                # cannot launder a result. A SECOND failure is a refusal.
                for attempt in (1, 2):
                    ctx = browser.new_context(viewport={"width": w + 60, "height": h + 60},
                                              device_scale_factor=1, reduced_motion="reduce")
                    page = ctx.new_page()
                    try:
                        mans[label] = read_manifest_for(page, base, case, args.token,
                                                        args.ready_timeout)
                        break
                    except Exception as e:                       # noqa: BLE001
                        if attempt == 2:
                            raise SystemExit(
                                f"{case['name']} on {base}: never became ready, twice "
                                f"({type(e).__name__}). Boxes are not guessed.") from e
                        print(f"[{case['name']:28}] {base} retry after {type(e).__name__}")
                    finally:
                        ctx.close()
            regions, chart_height = boxes_for(case, mans["a"], mans["b"], gated)
            ha = [p_["height"] for p_ in mans["a"]["panes"]]
            hb = [p_["height"] for p_ in mans["b"]["panes"]]
            derived[case["name"]] = {
                "regions": regions,
                "from": (f"gen_parity_regions.py -- bands {ident_a['id']} panes {ident_b['id']}: "
                         f"stackTop={mans['a']['_stackTop']} chartHeight={chart_height} "
                         f"separatorPx={mans['a']['separatorPx']} "
                         f"paneHeights bands={ha} panes={hb}"),
            }
            print(f"[{case['name']:28}] bands={ha} panes={hb} -> "
                  + " ".join(f"{r['name']}{r['box'][1]}..{r['box'][3]}" for r in regions))
        browser.close()

    if not args.write:
        print("\n(dry run — pass --write to update tools/chart_parity_cases.json)")
        return 0

    raw = json.loads(io.open(cp.CASES_PATH, encoding="utf-8").read())
    seen = 0
    for case in raw["cases"]:
        d = derived.get(case["name"])
        if not d:
            continue
        seen += 1
        # Rebuild the case dict so `_regionsFrom`/`regions` sit in a stable place
        # (immediately after `why`) instead of wherever a dict update lands them.
        #
        # ⚠️ `_regionsReason` IS PRESERVED, NEVER REGENERATED. It is prose a human
        # wrote about how a boundary was established — `rsi_only`'s records three
        # single-perturbation measurements that proved its rectangles
        # DISCRIMINATE — and a generator that silently deleted it would destroy
        # evidence on every re-run while looking like a formatting change.
        keep_reason = case.get("_regionsReason")
        rebuilt = {}
        for k, v in case.items():
            if k in ("regions", "_regionsFrom", "_regionsReason"):
                continue
            rebuilt[k] = v
            if k == "why":
                if keep_reason is not None:
                    rebuilt["_regionsReason"] = keep_reason
                rebuilt["_regionsFrom"] = d["from"]
                rebuilt["regions"] = d["regions"]
        case.clear()
        case.update(rebuilt)
    text = json.dumps(raw, indent=2, ensure_ascii=False) + "\n"
    io.open(cp.CASES_PATH, "w", encoding="utf-8", newline="\n").write(text)
    print(f"\nwrote {seen} case(s) into {cp.CASES_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
