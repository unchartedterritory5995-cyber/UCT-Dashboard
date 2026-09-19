# -*- coding: utf-8 -*-
"""OOS visual-complexity classifier — implements OOS_2_MEASUREMENT_PROTOCOL.md section 2.

SOURCE-ONLY. This tool reads Pine Script text and nothing else. It has no knowledge of,
and makes no reference to, what any downstream system can render. Its tiers were
predeclared before any OOS script touched a UCT surface.

Usage:
    python tools/oos_visual_classify.py <dir-or-file> [<dir-or-file> ...] [--json OUT]
"""
import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

# ── comment stripping ────────────────────────────────────────────────────────
# Pine has // line comments. It has no /* */ block comments in v4+, but earlier
# dialects and pasted text sometimes carry them, so we strip both. String
# literals containing "//" are protected first.
_STR = re.compile(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'')


def strip_comments(src: str) -> str:
    holes = []

    def hide(m):
        holes.append(m.group(0))
        return f"\x00S{len(holes) - 1}\x00"

    s = _STR.sub(hide, src)
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
    s = re.sub(r"//[^\n]*", "", s)

    def restore(m):
        return holes[int(m.group(1))]

    return re.sub(r"\x00S(\d+)\x00", restore, s)


# ── primitive families (protocol section 2) ──────────────────────────────────
FAMILY_PATTERNS = {
    "P": [r"\bplot\s*\("],
    "L": [r"\bhline\s*\("],
    "F": [r"\bfill\s*\("],
    "B": [r"\bbgcolor\s*\(", r"\bbarcolor\s*\("],
    "M": [r"\bplotshape\s*\(", r"\bplotchar\s*\(", r"\bplotarrow\s*\("],
    "C": [r"\bplotcandle\s*\(", r"\bplotbar\s*\("],
    "O": [
        r"\blabel\s*\.\s*\w+",
        r"\bline\s*\.\s*\w+",
        r"\bbox\s*\.\s*\w+",
        r"\btable\s*\.\s*\w+",
        r"\bpolyline\s*\.\s*\w+",
        r"\blinefill\s*\.\s*\w+",
    ],
}

# `line.new` etc. must not be confused with the *type keyword* usage
# (`var line myline = na`) or with `line.all`. We keep `.all` — it is still an
# object-model use — but exclude bare type declarations, which have no `.`.

# A colour literal or plain named colour constant. Anything else in a `color=`
# argument is DYNAMIC (family D).
_COLOR_LITERAL = re.compile(
    r"^\s*(?:"
    r"#[0-9a-fA-F]{6,8}"                       # #RRGGBB / #RRGGBBAA
    r"|color\s*\.\s*[a-z_]+"                   # color.red, color.new? (see below)
    r"|na"
    r")\s*$"
)
# `color.new(...)` is dynamic only if its arguments are computed; `color.new(color.red, 50)`
# is still a constant. We treat `color.new(` with a literal first arg and numeric second
# arg as STATIC, anything else as DYNAMIC.
_COLOR_NEW_STATIC = re.compile(
    r"^\s*color\s*\.\s*new\s*\(\s*(?:#[0-9a-fA-F]{6,8}|color\s*\.\s*[a-z_]+)\s*,\s*[\d.]+\s*\)\s*$"
)

_COLOR_ARG = re.compile(r"\bcolor\s*=\s*", re.I)

# A bare identifier passed as `color=` may be a constant colour variable (static) or a
# per-bar computed colour (dynamic). Resolving it against its own binding sites in the
# same source removes most of the ambiguity without any semantic execution.
_ASSIGN = re.compile(
    r"^[ \t]*(?:var[ \t]+|varip[ \t]+)?(?:color[ \t]+)?([A-Za-z_]\w*)[ \t]*:?=[ \t]*(.+?)[ \t]*$",
    re.M,
)


def _binding_map(src: str):
    """name -> list of right-hand-side texts assigned to it at any indent level."""
    out = defaultdict(list)
    for m in _ASSIGN.finditer(src):
        out[m.group(1)].append(m.group(2).strip())
    return out


def _rhs_is_static_color(rhs: str) -> bool:
    return bool(_COLOR_LITERAL.match(rhs) or _COLOR_NEW_STATIC.match(rhs))


def _rhs_is_dynamic_color(rhs: str) -> bool:
    """A ternary, a comparison, or a call over non-literal args makes the colour vary."""
    if "?" in rhs:
        return True
    if re.search(r"\b(?:color\s*\.\s*from_gradient|color\s*\.\s*rgb)\s*\(", rhs):
        return True
    if re.search(r"color\s*\.\s*new\s*\(", rhs) and not _COLOR_NEW_STATIC.match(rhs):
        return True
    return False


def _balanced_arg(text: str, start: int) -> str:
    """Read one argument starting at `start`, stopping at the comma or close-paren
    that is at depth 0 relative to where we began."""
    depth = 0
    out = []
    i = start
    while i < len(text):
        ch = text[i]
        if ch in "([":
            depth += 1
        elif ch in ")]":
            if depth == 0:
                break
            depth -= 1
        elif ch == "," and depth == 0:
            break
        elif ch == "\n" and depth == 0:
            break
        out.append(ch)
        i += 1
    return "".join(out)


def dynamic_color_sites(src: str):
    """Return (dynamic_count, ambiguous_count). A `color=` argument that is not a
    recognisable literal/constant is dynamic."""
    dyn = 0
    amb = 0
    binds = _binding_map(src)
    for m in _COLOR_ARG.finditer(src):
        arg = _balanced_arg(src, m.end())
        a = arg.strip()
        if not a:
            amb += 1
            continue
        if _COLOR_LITERAL.match(a) or _COLOR_NEW_STATIC.match(a):
            continue
        # A bare identifier could be a const colour variable (static in spirit) or a
        # per-bar computed series. Resolve it against its own binding sites before
        # falling back to AMBIGUOUS, per protocol.
        if re.match(r"^[A-Za-z_]\w*$", a):
            rhss = binds.get(a)
            if not rhss:
                amb += 1
            elif any(_rhs_is_dynamic_color(r) for r in rhss):
                dyn += 1
            elif all(_rhs_is_static_color(r) for r in rhss):
                pass  # genuinely a constant colour variable
            else:
                amb += 1
            continue
        dyn += 1
    return dyn, amb


_NA_TERNARY = re.compile(r"\?[^?:]*\bna\b|\bna\b[^?:]*:")


def conditional_visibility(src: str) -> bool:
    """Family H: a plot/marker whose series is conditionally `na`, or a `display=` arg."""
    if re.search(r"\bdisplay\s*=", src):
        return True
    for m in re.finditer(r"\b(?:plot|plotshape|plotchar|plotarrow|plotcandle|plotbar)\s*\(", src):
        arg = _balanced_arg(src, m.end())
        if "?" in arg and re.search(r"\bna\b", arg):
            return True
    return False


def count_family(src: str, fam: str) -> int:
    n = 0
    for pat in FAMILY_PATTERNS[fam]:
        n += len(re.findall(pat, src))
    return n


def classify(src: str):
    s = strip_comments(src)
    counts = {f: count_family(s, f) for f in FAMILY_PATTERNS}
    dyn, amb = dynamic_color_sites(s)
    vis_h = conditional_visibility(s)

    def tier_for(treat_ambiguous_as_dynamic: bool):
        d = dyn + (amb if treat_ambiguous_as_dynamic else 0)
        # V5 dominates
        if counts["O"] > 0:
            return "V5"
        emitting = counts["P"] + counts["L"] + counts["F"] + counts["B"] + counts["M"] + counts["C"]
        if emitting == 0:
            return "V0"
        v3 = (
            counts["F"] > 0
            or counts["B"] > 0
            or counts["C"] > 0
            or d > 0
            or (counts["M"] > 0 and counts["P"] > 0)
        )
        if v3:
            v4 = (
                emitting >= 5
                or counts["F"] >= 2
                or vis_h
                or d >= 3
            )
            return "V4" if v4 else "V3"
        # No conditional appearance. Static only.
        if counts["P"] + counts["L"] >= 2:
            return "V2"
        if counts["P"] + counts["M"] == 1:
            return "V1"
        # e.g. a single hline and nothing else, or several markers with no plot
        return "V2" if emitting >= 2 else "V1"

    lo = tier_for(False)
    hi = tier_for(True)
    return {
        "tier": hi if lo == hi else lo,
        "tier_low": lo,
        "tier_high": hi,
        "tier_ambiguous": lo != hi,
        "families": counts,
        "dynamic_color_sites": dyn,
        "ambiguous_color_sites": amb,
        "conditional_visibility": vis_h,
        "visual_emitting_calls": counts["P"] + counts["L"] + counts["F"] + counts["B"] + counts["M"] + counts["C"],
    }


def loc(src: str) -> int:
    return sum(1 for l in src.splitlines() if l.strip() and not l.strip().startswith("//"))


def bucket(n: int) -> str:
    return "short" if n <= 40 else ("medium" if n <= 90 else "long")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("paths", nargs="+")
    ap.add_argument("--json", dest="json_out")
    args = ap.parse_args()

    files = []
    for p in args.paths:
        pp = Path(p)
        if pp.is_dir():
            files.extend(sorted(pp.rglob("*.pine")))
        elif pp.is_file():
            files.append(pp)

    rows = []
    for f in files:
        src = f.read_text(encoding="utf-8", errors="replace")
        c = classify(src)
        n = loc(src)
        rows.append({
            "file": f.name,
            "tier_dir": f.parent.name,
            "path": str(f),
            "loc": n,
            "complexity_bucket": bucket(n),
            **c,
        })

    for r in rows:
        fam = "".join(k for k in "PLFBMCO" if r["families"][k] > 0) or "-"
        flag = "  <TIER_AMBIGUOUS>" if r["tier_ambiguous"] else ""
        print(f"{r['tier']:>3}  {r['tier_dir']:<16} {r['file']:<62} "
              f"loc={r['loc']:<4} emit={r['visual_emitting_calls']:<3} fam={fam:<7} "
              f"dyn={r['dynamic_color_sites']} amb={r['ambiguous_color_sites']}{flag}")

    print("\n=== VISUAL COMPLEXITY DISTRIBUTION ===")
    dist = Counter(r["tier"] for r in rows)
    for t in ["V0", "V1", "V2", "V3", "V4", "V5"]:
        print(f"  {t}: {dist.get(t, 0)}")
    print(f"  TIER_AMBIGUOUS needing adjudication: {sum(1 for r in rows if r['tier_ambiguous'])}")

    print("\n=== PRIMITIVE DEMAND (scripts using each family) ===")
    names = {"P": "plot()", "L": "hline()", "F": "fill()", "B": "bgcolor()/barcolor()",
             "M": "plotshape/char/arrow", "C": "plotcandle/plotbar", "O": "label/line/box/table objects"}
    for k in "PLFBMCO":
        used = sum(1 for r in rows if r["families"][k] > 0)
        total = sum(r["families"][k] for r in rows)
        print(f"  {names[k]:<32} {used:>3}/{len(rows)} scripts, {total} call sites")
    dyncol = sum(1 for r in rows if r["dynamic_color_sites"] > 0)
    condvis = sum(1 for r in rows if r["conditional_visibility"])
    print(f"  {'dynamic colour':<32} {dyncol:>3}/{len(rows)} scripts")
    print(f"  {'conditional visibility':<32} {condvis:>3}/{len(rows)} scripts")

    print("\n=== TIER x ENGAGEMENT ===")
    grid = defaultdict(Counter)
    for r in rows:
        grid[r["tier_dir"]][r["tier"]] += 1
    for d in sorted(grid):
        print(f"  {d}: {dict(sorted(grid[d].items()))}")

    if args.json_out:
        Path(args.json_out).write_text(json.dumps(rows, indent=2), encoding="utf-8")
        print(f"\nWrote {args.json_out}")


if __name__ == "__main__":
    sys.exit(main())
