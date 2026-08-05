#!/usr/bin/env python3
"""The exact source of every build B5 Task 11 measured — as a script, not prose.

Task 11 prices Flip C and its three sub-choices. Each price is a pair of builds
that differ by ONE thing, so each build has to be describable to the byte. A
decision record that says "we added a separator colour" is a record nobody can
reproduce; this file IS the description, and it applies and reverts in place.

    python tools/flipc_variant_patch.py --list
    python tools/flipc_variant_patch.py --apply panes_fixed
    cd app && npm run build && cp -r dist ../.parity-dist-b
    python tools/flipc_variant_patch.py --revert          # git checkout + sha256

⛔ NOTHING HERE IS SHIPPED, AND NOTHING HERE IS COMMITTED INTO `app/src`. Every
variant is applied to a scratch tree, built, and reverted; `--revert` refuses to
return unless every touched file is byte-identical to HEAD.

──────────────────────────────────────────────────────────────────────────────
⚠️  `panes` ALONE DOES NOT RENDER. THAT IS A MEASURED FACT, NOT AN OPINION.
──────────────────────────────────────────────────────────────────────────────

`PANE_MODE = 'panes'` on its own throws

    paneLayout: panes 0-1 total is 451px, expected 452px

into StockChart's ErrorBoundary on EVERY chart whose oscillator stack does not
start at pane index 1 — which is every chart with a separate volume pane, i.e.
the shipped default and every one of the 46 parity cases. `__chartReady` never
becomes true and the harness times out at 60 s.

The cause is arithmetic and it is off by exactly `firstPaneIndex - 1`:
`computePaneLayout` treats `chartHeight` (the pane stack INCLUDING its
separators) as the pane-height budget and then removes only `oscCount`
separators from it. That is exact when the stack starts at pane 1 — the case
Task 3's totality proof covers — and over-allocates by one pixel per PRE-EXISTING
separator otherwise. `pane0Only` (a chart with no oscillator at all) has the same
bug with no oscillator to shave, so a price-overlay-only chart throws too.

`panes_fixed` carries the minimal correction, and it is the build every number in
the decision record was measured against. **Landing it is Task 12's job, not
Task 11's** — Task 11 measures and prices; it does not apply.
"""
from __future__ import annotations

import argparse
import hashlib
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PANE_LAYOUT = "app/src/components/chart/engine/paneLayout.js"
PLACEMENT = "app/src/components/chart/engine/placement.js"
STOCK_CHART = "app/src/components/StockChart.jsx"

# ── the individual edits, each a (file, old, new) with a UNIQUE `old` ─────────

FLIP = (PANE_LAYOUT,
        "export const PANE_MODE = 'bands'",
        "export const PANE_MODE = 'panes'")

# (1) the separator budget must cover the separators of the panes that ALREADY
#     exist above the stack, not only the ones the stack adds.
FIX_STACK = (PANE_LAYOUT,
             "for (let budget = oscCount * separatorPx; budget > 0; budget--) {",
             "for (let budget = (oscCount + Math.max(0, firstPaneIndex - 1)) * separatorPx; "
             "budget > 0; budget--) {")

# (2) the same off-by-one on the no-oscillator path, where there is nothing to
#     shave it off and it has to come out of the price-pane budget.
FIX_PANE0_ONLY = (PANE_LAYOUT,
                  "    pane0: {\n      heightPx: h,\n      stretchFactor: h,",
                  "    pane0: {\n      heightPx: h,\n"
                  "      stretchFactor: h - Math.max(0, firstPaneIndex - 1) * separatorPx,")

# (a) the separator gets the chart's OWN token instead of the library's default
#     `#2B2B43`. `separatorColors` is already derived from the canvas at the
#     separator's own height and is what the Model Book / bold-candle surfaces use.
SEPARATOR_TOKEN = (
    STOCK_CHART,
    ": paneMode() === 'panes' ? { panes: { enableResize: !frozen } } : {}),",
    ": paneMode() === 'panes' ? { panes: { separatorColor: separatorColors.color, "
    "separatorHoverColor: separatorColors.hover, enableResize: !frozen } } : {}),")

# (b) the oscillator's series goes on the pane's VISIBLE right scale instead of
#     an overlay scale named after the definition — i.e. it grows a price axis
#     with its own numbers.
RIGHT_AXIS = (PLACEMENT,
              "      paneIndex: pane.index,\n      scaleId: key,",
              "      paneIndex: pane.index,\n      scaleId: 'right',")

# (c) LWC's own stretch defaults. `DEFAULT_STRETCH_FACTOR = 1` (5.2.0 dev bundle
#     :5225), so a chart that never calls `setStretchFactor` has EQUAL panes.
#     The height check goes with it: the factors are no longer pixel heights, so
#     comparing them to heights would throw by construction.
EQUAL_PANES = (
    PANE_LAYOUT,
    "export function paneStretchPlan(layout, currentStretch) {",
    "export function paneStretchPlan(layout, currentStretch) {\n"
    "  // MEASUREMENT VARIANT (c)-B: LWC's own default stretch factor is 1, so a\n"
    "  // chart that never sets one has EQUAL panes. Priced, never shipped.\n"
    "  if (layout && Array.isArray(layout.panes)) {\n"
    "    return (Array.isArray(currentStretch) ? currentStretch : []).map(() => 1)\n"
    "  }")
# The height ASSERTION, removed. Two different variants need it gone and for two
# different reasons:
#
#   * (c) sets the factors to LWC's default 1, so they stop being pixel heights
#     and comparing them to heights would throw by construction;
#   * `panes_fixed_nocheck` isolates a MEASURED intermittent: with the check in,
#     `paneLayout: pane 2 is 77px, expected 78px` reaches the ErrorBoundary on
#     ~20 % of cold loads (3 of 14, then 1 of 8) and `__chartReady` never fires.
#     The variant answers whether the GEOMETRY is unstable or only the assertion
#     is: same build, check removed, read the manifest back N times.
NO_HEIGHT_THROW = (
    PANE_LAYOUT,
    "export function paneHeightMismatch(chart, layout) {\n"
    "  if (!layout || !Array.isArray(layout.panes)) return null",
    "export function paneHeightMismatch(chart, layout) {\n"
    "  // MEASUREMENT VARIANT: the height assertion does not throw. Priced, never\n"
    "  // shipped. The manifest still reports the heights the renderer produced,\n"
    "  // so a real drift is still visible -- as pixels and as a manifest diff.\n"
    "  return null\n"
    "  // eslint-disable-next-line no-unreachable\n"
    "  if (!layout || !Array.isArray(layout.panes)) return null")

VARIANTS = {
    "panes": [FLIP],
    "panes_fixed": [FLIP, FIX_STACK, FIX_PANE0_ONLY],
    "panes_fixed_nocheck": [FLIP, FIX_STACK, FIX_PANE0_ONLY, NO_HEIGHT_THROW],
    "panes_fixed_sep_token": [FLIP, FIX_STACK, FIX_PANE0_ONLY, NO_HEIGHT_THROW,
                              SEPARATOR_TOKEN],
    "panes_fixed_right_axis": [FLIP, FIX_STACK, FIX_PANE0_ONLY, NO_HEIGHT_THROW,
                               RIGHT_AXIS],
    "panes_fixed_equal_panes": [FLIP, FIX_STACK, FIX_PANE0_ONLY, NO_HEIGHT_THROW,
                                EQUAL_PANES],
}


# ⚠️ `core.autocrlf` IS TRUE IN THIS CHECKOUT: the blob is LF and the worktree is
# CRLF, so a raw sha256 of the file NEVER equals a raw sha256 of `git show HEAD:`
# — and a patch written with `\n` matches ZERO times in the file it is aimed at.
# Both are silent: the first reads as "the tree is dirty" forever, the second as
# "the anchor moved". Task 10 lost time to the same class twice (five sha256s
# FAILED while `git status` was clean; a mutation pattern matched zero times
# because the file had flipped LF->CRLF). So: every comparison is made on
# LINE-ENDING-NORMALISED bytes, which is what git itself compares, and every
# patch is translated into the file's OWN convention before it is looked for.
def _norm(raw: bytes) -> bytes:
    return raw.replace(b"\r\n", b"\n")


def _eol(raw: bytes, s: str) -> bytes:
    """`s` in the newline convention `raw` actually uses."""
    b = s.encode()
    return b.replace(b"\n", b"\r\n") if b"\r\n" in raw else b


def _sha(path: Path) -> str:
    return hashlib.sha256(_norm(path.read_bytes())).hexdigest()[:16]


def _raw_sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def head_shas(files):
    """Each file's normalised sha256 AT HEAD, read through git so a dirty tree
    cannot lie about what it is being compared with."""
    out = {}
    for rel in files:
        blob = subprocess.run(["git", "show", f"HEAD:{rel}"], cwd=ROOT,
                              capture_output=True, check=True).stdout
        out[rel] = hashlib.sha256(_norm(blob)).hexdigest()[:16]
    return out


def apply(variant: str) -> int:
    edits = VARIANTS[variant]
    files = sorted({rel for rel, _, _ in edits})
    before = head_shas(files)
    for rel in files:
        p = ROOT / rel
        if _sha(p) != before[rel]:
            raise SystemExit(f"{rel} is not at HEAD — revert before applying a variant.")
    for rel, old, new in edits:
        p = ROOT / rel
        raw = p.read_bytes()
        o, n = _eol(raw, old), _eol(raw, new)
        if raw.count(o) != 1:
            raise SystemExit(
                f"{rel}: the anchor for this edit occurs {raw.count(o)} times, not once.\n"
                f"  {old[:90]!r}\n"
                "A patch that matches zero times is a build that measures nothing, and a "
                "patch that matches twice is a build nobody can describe.")
        p.write_bytes(raw.replace(o, n))
    for rel in files:
        print(f"  patched {rel}  {before[rel]} -> {_sha(ROOT / rel)}")
    print(f"applied `{variant}` ({len(edits)} edit(s), {len(files)} file(s))")
    return 0


def revert() -> int:
    files = sorted({rel for edits in VARIANTS.values() for rel, _, _ in edits})
    subprocess.run(["git", "checkout", "--", *files], cwd=ROOT, check=True)
    before = head_shas(files)
    bad = [rel for rel in files if _sha(ROOT / rel) != before[rel]]
    if bad:
        raise SystemExit(
            "REVERT DID NOT RESTORE: " + ", ".join(bad) +
            "\n(a line-ending flip does this and `git status` stays clean — B5 Task 10 hit it)")
    for rel in files:
        print(f"  {rel}  sha256[:16] {before[rel]} (normalised) == HEAD "
              f"| worktree bytes {_raw_sha(ROOT / rel)}")
    print("reverted; every touched file matches HEAD line-ending-normalised "
          "(what git compares)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", choices=sorted(VARIANTS))
    ap.add_argument("--revert", action="store_true")
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()
    if args.list or (not args.apply and not args.revert):
        for name, edits in VARIANTS.items():
            print(f"{name:24} {len(edits)} edit(s): "
                  + ", ".join(sorted({Path(r).name for r, _, _ in edits})))
        return 0
    if args.revert:
        return revert()
    return apply(args.apply)


if __name__ == "__main__":
    sys.exit(main())
