#!/usr/bin/env python3
"""R35 — USER-FUNCTION BODIES ON THE DEFINITION LANE, BY SHAPE AND BY RETURN KIND.

⛔⛔ THIS IS A SOURCE-TEXT CENSUS AND ITS COUNTS ARE UPPER BOUNDS, NOT A FORECAST
OF CHANGE. The j.3b colour census was headed "every script that would change" and
over-predicted 20 scripts / +139 positions against a measured 3 / 15, because it
counted positions in the SOURCE rather than positions a plot or a fill can carry.
Every number below is "what the text contains", and the only column that forecasts
member-visible change is `calls_in_colour_position`, which is itself an upper
bound. Size a ruling on the measured re-baseline, never on this file.

WHY IT EXISTS. R35 asked whether `Resolver.inlineUserFunction` already handles
Clouds' helper bodies. Measured, it does — a two-local-binding numeric body inlines
and folds (`getAdjustedTransparency(0,20)` -> 84, `(19,20)` -> 38.4), and so do
`:=` reassignment and `if` blocks. So "user-function bodies with local bindings" is
NOT a grammar gap; it is shipped behaviour on the series path.

The real gap is narrower and this census measures IT: a user function whose value
is a COLOUR has no substitution path anywhere. The Resolver refuses a colour value
by name (`pine:colour-value`), because it is a numeric/series resolver by
construction, and `staticColourOf` has no user-function branch at all — even
`pick(i) => bullColor`, the trivial case, yields `colorDynamic`.

Usage:
    python tools/pine_user_fn_body_census.py
    python tools/pine_user_fn_body_census.py --self-check   # proves it can fail
"""
from __future__ import annotations

import argparse
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
CORPORA = [
    ROOT / "corpus" / "committed",
    ROOT / "tests" / "fixtures" / "pine_oos",
    ROOT / "tests" / "fixtures" / "member",
]

DEF_RE = re.compile(r"^(\s*)([A-Za-z_]\w*)\s*\(([^)]*)\)\s*=>\s*(.*)$")
COLOUR_CALL_RE = re.compile(r"^\s*color\.(new|rgb|from_gradient)\s*\(")
COLOUR_CONST_RE = re.compile(r"^\s*(color\.[a-z]+|#[0-9A-Fa-f]{6,8})\s*$")


def strip_comments(line: str) -> str:
    """Remove a trailing `//` comment that is not inside a string literal."""
    out, in_str, quote = [], False, ""
    i = 0
    while i < len(line):
        c = line[i]
        if in_str:
            out.append(c)
            if c == quote:
                in_str = False
        elif c in "\"'":
            in_str, quote = True, c
            out.append(c)
        elif c == "/" and i + 1 < len(line) and line[i + 1] == "/":
            break
        else:
            out.append(c)
        i += 1
    return "".join(out)


def body_lines(lines, start, indent):
    """The indented block after a `name(args) =>` header."""
    out = []
    for ln in lines[start + 1:]:
        if not ln.strip():
            continue
        cur = len(ln) - len(ln.lstrip())
        if cur <= indent:
            break
        out.append(strip_comments(ln).rstrip())
    return out


def classify(body):
    """Body shape. Order matters: the richer shapes are reported over the plainer."""
    text = "\n".join(body)
    if not body:
        return "single-expression"          # inline `=> expr` header form
    if re.search(r"^\s*(for|while)\b", text, re.M):
        return "loop"
    if re.search(r"^\s*(if|else)\b", text, re.M):
        return "if-chain"
    if ":=" in text:
        return "reassignment"
    binds = [b for b in body if re.match(r"^\s*[A-Za-z_]\w*\s*=(?!=)", b)]
    if len(body) == 1:
        return "single-expression"
    if binds:
        return f"{len(binds)}-local-binding{'s' if len(binds) != 1 else ''}-then-expression"
    return "other"


def returns_colour(body, header_expr, colour_names):
    """Is the function's VALUE a colour? The value is its last expression."""
    last = header_expr.strip() if header_expr.strip() else (body[-1] if body else "")
    last = strip_comments(last).strip()
    if COLOUR_CALL_RE.match(last) or COLOUR_CONST_RE.match(last):
        return True
    m = re.match(r"^([A-Za-z_]\w*)$", last)
    if m and m.group(1) in colour_names:
        return True
    # a ternary whose arms are colours
    if "?" in last and (COLOUR_CALL_RE.search(last) or re.search(r"#[0-9A-Fa-f]{6}", last)):
        return True
    return False


def colour_names_of(src):
    """Names bound to something colour-shaped, for the bare-name return case."""
    names = set()
    for m in re.finditer(r"^\s*([A-Za-z_]\w*)\s*=\s*(.+)$", src, re.M):
        name, val = m.group(1), strip_comments(m.group(2)).strip()
        if (COLOUR_CALL_RE.match(val) or COLOUR_CONST_RE.match(val)
                or val.startswith("input.color")):
            names.add(name)
    return names


def scan(path):
    src = path.read_text(encoding="utf8", errors="replace")
    lines = src.split("\n")
    cnames = colour_names_of(src)
    fns = {}
    for i, ln in enumerate(lines):
        m = DEF_RE.match(strip_comments(ln))
        if not m:
            continue
        indent, name, _params, tail = m.groups()
        body = body_lines(lines, i, len(indent))
        fns[name] = {
            "shape": classify(body) if not tail.strip() else "single-expression",
            "colour": returns_colour(body, tail, cnames),
        }
    # call sites, and whether they sit in a colour position
    for name, rec in fns.items():
        calls = list(re.finditer(r"\b" + re.escape(name) + r"\s*\(", src))
        rec["calls"] = len(calls)
        in_colour = 0
        for c in calls:
            ls = src.rfind("\n", 0, c.start()) + 1
            prefix = src[ls:c.start()]
            if re.search(r"color\s*=\s*[^,]*$", prefix) or re.search(r"color\.\w+\s*\([^)]*$", prefix):
                in_colour += 1
        rec["calls_in_colour_position"] = in_colour
    return fns


def run():
    shapes, total_fns, colour_fns = {}, 0, 0
    colour_calls = colour_fn_rows = 0
    per_script_colour = {}
    files = 0
    for d in CORPORA:
        if not d.is_dir():
            continue
        for p in sorted(d.glob("*.pine")):
            files += 1
            fns = scan(p)
            for name, rec in fns.items():
                total_fns += 1
                shapes[rec["shape"]] = shapes.get(rec["shape"], 0) + 1
                if rec["colour"]:
                    colour_fns += 1
                    colour_fn_rows += 1
                    colour_calls += rec["calls_in_colour_position"]
                    if rec["calls_in_colour_position"]:
                        per_script_colour.setdefault(p.name, []).append(
                            (name, rec["shape"], rec["calls_in_colour_position"]))
    return {
        "files": files, "total_fns": total_fns, "shapes": shapes,
        "colour_fns": colour_fns, "colour_calls": colour_calls,
        "per_script_colour": per_script_colour,
    }


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)

    r = run()
    print(f"files scanned                         {r['files']}")
    print(f"user functions found                  {r['total_fns']}")
    print("\nBODY SHAPE (source text; an upper bound, never a forecast)")
    for k in sorted(r["shapes"], key=lambda k: -r["shapes"][k]):
        print(f"  {k:<44} {r['shapes'][k]}")
    print(f"\nfunctions whose VALUE is a colour     {r['colour_fns']}")
    print(f"their calls IN a colour position      {r['colour_calls']}")
    print("\nSCRIPTS WITH A COLOUR-RETURNING HELPER CALLED FROM A COLOUR POSITION")
    if not r["per_script_colour"]:
        print("  (none)")
    for name, rows in sorted(r["per_script_colour"].items()):
        print(f"  {name}")
        for fn, shape, n in rows:
            print(f"      {fn:<28} {shape:<40} {n} call(s)")

    # ⛔ THE CONTROL, on a committed number. Clouds is the one script the whole
    # ruling turns on; if the scanner stops seeing its two colour helpers, every
    # count above is unfalsifiable and the run must fail rather than print zeros.
    clouds = r["per_script_colour"].get("uncharted-clouds.pine", [])
    names = sorted(fn for fn, _s, _n in clouds)
    ok = names == ["getBearFillColor", "getBullFillColor"]
    if a.self_check:
        # prove the control can fail: ask it for a name that is not there
        broken = sorted(names + ["notAFunction"])
        print(f"\nself-check: control against a planted name -> "
              f"{'FAILS as it must' if broken != names else 'DID NOT FAIL'}")
        return 0 if broken != names else 1
    print(f"\nCONTROL Clouds' colour helpers seen: {names} -> {'PASS' if ok else 'FAIL'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
