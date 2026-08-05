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
✅  `panes` NOW RENDERS ON ITS OWN. IT DID NOT WHEN TASK 11 MEASURED IT.
──────────────────────────────────────────────────────────────────────────────

Task 11's numbers were all measured against a PATCHED build: `PANE_MODE = 'panes'`
alone threw

    paneLayout: panes 0-1 total is 451px, expected 452px

into StockChart's ErrorBoundary on every one of the 46 cases, so the variants
below carried a `FIX_STACK` + `FIX_PANE0_ONLY` correction and a downgraded height
assertion just to get a frame to photograph. **Those three patches are gone**,
because the defects are fixed AT ROOT in the tree (commit `bd388aa2`): one
substitution in `computePaneLayout` — every band fraction is a fraction of the
CANDLE PANE's height rather than the whole stack's — plus a binder that converges
on a height disagreement instead of throwing.

So `panes` is now ONE edit, which is what the cutover was always supposed to be,
and every number in the decision record is measured against a build that could
ship. **Landing the flip is still Task 12's job** — this file measures.

⚠️ THE OLD ANCHORS ARE DELETED, NOT COMMENTED OUT. A stale patch whose anchor no
longer exists exits 1 by design (`apply` refuses anything matching != 1 time), so
a variant list nobody updated cannot silently measure the wrong build.
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

# ⛔ `FIX_STACK` AND `FIX_PANE0_ONLY` STOOD HERE AND ARE GONE. They were Task 11's
#    minimal correction for D1, applied to a scratch tree so there would be a
#    frame to photograph. D1 is fixed at root in `computePaneLayout` (the frame of
#    reference), so there is nothing left to correct — and `NO_HEIGHT_THROW` went
#    with them, because the binder no longer throws on a height disagreement.

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
#     ⚠️ IT NO LONGER NEEDS THE HEIGHT ASSERTION REMOVED WITH IT. Under LWC's
#     defaults the factors stop being pixel heights, so the check disagrees by
#     construction — which used to mean a throw and a blank chart, and now means
#     a `console.warn` and a chart. That the sub-choice can be priced with the
#     shipped assertion in place is itself a result of the D2 ruling.
EQUAL_PANES = (
    PANE_LAYOUT,
    "export function paneStretchPlan(layout, currentStretch) {",
    "export function paneStretchPlan(layout, currentStretch) {\n"
    "  // MEASUREMENT VARIANT (c)-B: LWC's own default stretch factor is 1, so a\n"
    "  // chart that never sets one has EQUAL panes. Priced, never shipped.\n"
    "  if (layout && Array.isArray(layout.panes)) {\n"
    "    return (Array.isArray(currentStretch) ? currentStretch : []).map(() => 1)\n"
    "  }")

VARIANTS = {
    "panes": [FLIP],
    "panes_sep_token": [FLIP, SEPARATOR_TOKEN],
    "panes_right_axis": [FLIP, RIGHT_AXIS],
    "panes_equal_panes": [FLIP, EQUAL_PANES],
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
