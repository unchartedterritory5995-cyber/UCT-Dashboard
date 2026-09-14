"""A missing bound must mean the window is CLOSED, never "no constraint, so open".

⚰️ **F-S7-TICK-1, 2026-09-14.** `s7_price_level_report._window(hours)` read
`hours is None` as *"the whole weekday"*. Three sweeps that fire at FIXED TIMES —
`event-proximity` (07:05/18:05), `scan-membership` (~05:20 nightly), `catalyst-match`
(17:30) — therefore read as **inside their window at any hour**, and the liveness report
called three **healthy** sweeps dead: every flag read `'1'` in-process, nothing had errored,
they simply had not yet been scheduled to fire. ⛔ It was **weekly, not a one-off**:
`catalyst-match` fires 17:30, so every Monday both the 09:12 monitor post and the 16:30
gate check alarmed on a healthy sweep. **A rail that cries wolf weekly gets muted, and then
it is not a rail.**

⭐ **THE SHAPE, WHICH IS WHAT THIS AUDITS — not the instance.** A predicate that decides
*"are we inside the window?"* is handed a bound that is absent (`None`, empty, missing key)
and treats the absence as *"the constraint is satisfied"* rather than *"the constraint is
unknown"*. The two readings are opposite and both are one keystroke from each other.

⛔ **AST, NEVER GREP.** A regex over source finds the shape in a comment, in a docstring
explaining the shape, and in this file's own prose — six separate instances of exactly that
are recorded in `CLAUDE.md` under "CODE NEVER PROSE". `ast` excludes comments by
construction; docstrings are excluded explicitly below.

⛔⛔ **THIS IS A TRIAGE INSTRUMENT, NOT A RAIL, AND THE FIRST RUN IS WHY.**

v1 was built to FAIL on any `ABSENT-GUARDED-AND` row. Run over the tree it produced **30**
of them — and triaging all 30 by hand found **zero defects**. The class is dominated by the
ordinary, correct Python optional-guard idiom:

    if retry_after is not None and ...      # absent = the server sent no Retry-After
    if deadline is not None and ...         # absent = no deadline was set
    if age_days is not None and age_days > _STALE_DAYS   # absent = age UNKNOWN, not stale
    if cap_after is not None and ...        # absent = no cap, deliberately

⭐ **The syntactic shape does not distinguish the defect from the idiom.** What made
F-S7-TICK-1 a defect was not `X is not None and …` — it was that shape inside a predicate
**whose caller reads "the guard did not fire" as "inside the window"**. That is a property
of the CALLER, and no pattern over the predicate alone can see it.

⛔ So this tool **does not fail the build**. Shipping it as a failing rail would red 30
correct sites, and a rail that cries wolf gets muted — which is precisely the lesson
F-S7-TICK-1 itself teaches (*"a rail that cries wolf weekly gets muted, and then it is not
a rail"*). It prints a roster for a human to triage and exits 0 unless it could not measure.

⚰️ **Third instance in one day of an instrument reporting a property of ITSELF as a finding
about the repo** — after `audit_scope_vs_checkpoints`' three retired derived versions
(F-AUDIT-2) and the backslash-s block counter. The class is live, and it is not rare.

Classification, and the third state is load-bearing:

  ABSENT-GUARDED-AND  absence short-circuits the guard  -> LOOK, usually the correct idiom
  CLOSED-ON-ABSENT    absence makes the test true       -> safe by construction
  NOT-A-BOUND         a bound-ish name that is not a window bound
  UNREADABLE          could not be decided statically   -> never counted as safe

Exit 0 = measured · 2 = UNREADABLE (nothing parsed, or a zero roster: the derivation is
broken, not the codebase).
"""
from __future__ import annotations

import argparse
import ast
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent

#: A value is a BOUND if its name contains one of these. Declared, so widening it is a
#: reviewable act rather than a regex that quietly grows.
BOUND_WORDS = ("start", "end", "hours", "days", "window", "minutes", "cutoff",
               "before", "after", "since", "until", "deadline", "expires", "bound")

#: A module participates in a schedule decision if it mentions one of these AT ALL. This is
#: a cheap pre-filter, not the finding — every hit is still AST-checked below.
SCHEDULE_WORDS = ("schedule", "window", "sweep", "tick", "cron", "cadence", "fires",
                  "heartbeat", "due", "stale")

SKIP_DIRS = {"node_modules", ".git", "dist", "build", "__pycache__", ".venv", "venv"}

OPEN, CLOSED, NOT_BOUND, UNREADABLE = "ABSENT-GUARDED-AND", "CLOSED-ON-ABSENT", "NOT-A-BOUND", "UNREADABLE"
PASS, FAIL, UNREADABLE_EXIT = 0, 1, 2


def _is_bound_name(name: str) -> bool:
    n = name.lower()
    return any(w in n for w in BOUND_WORDS)


def _name_of(node) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return None


def _docstring_ids(tree) -> set[int]:
    out = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            body = getattr(node, "body", None)
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) \
                    and isinstance(body[0].value.value, str):
                out.add(id(body[0].value))
    return out


def _classify_test(test, src_line: str) -> str:
    """Given an `if` test that mentions an absent-bound check, is absence OPEN or CLOSED?

    ⭐ The decision rests on a structural fact, not on reading English: does the
    absent-branch of the boolean make the whole test TRUE (open) or FALSE (closed)?

      `if hours is not None and not (lo <= h <= hi): return OUTSIDE`
          absent -> the `and` short-circuits FALSE -> falls through to "inside"  -> OPEN
      `if hours is None: return OUTSIDE`
          absent -> returns OUTSIDE                                             -> CLOSED
      `if hours is None or not (lo <= h <= hi): return OUTSIDE`
          absent -> returns OUTSIDE                                             -> CLOSED
    """
    if isinstance(test, ast.BoolOp):
        kinds = []
        for v in test.values:
            if isinstance(v, ast.Compare) and len(v.ops) == 1:
                if isinstance(v.ops[0], ast.IsNot) and isinstance(v.comparators[0], ast.Constant) \
                        and v.comparators[0].value is None:
                    kinds.append("isnot")
                elif isinstance(v.ops[0], ast.Is) and isinstance(v.comparators[0], ast.Constant) \
                        and v.comparators[0].value is None:
                    kinds.append("is")
        if isinstance(test.op, ast.And) and "isnot" in kinds:
            # absence short-circuits the guard FALSE -> the caller proceeds as if unbounded
            return OPEN
        if isinstance(test.op, ast.Or) and "is" in kinds:
            return CLOSED
    if isinstance(test, ast.Compare) and len(test.ops) == 1 \
            and isinstance(test.comparators[0], ast.Constant) and test.comparators[0].value is None:
        return CLOSED if isinstance(test.ops[0], ast.Is) else UNREADABLE
    return UNREADABLE


def roster(root: pathlib.Path = REPO) -> tuple[list[dict], int, list[str]]:
    """(rows, files scanned, unreadable files). One row per absent-bound predicate."""
    rows: list[dict] = []
    scanned = 0
    bad: list[str] = []
    for p in sorted(root.rglob("*.py")):
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        try:
            src = p.read_text(encoding="utf-8")
        except Exception:                                # noqa: BLE001
            bad.append(str(p)); continue
        low = src.lower()
        if not any(w in low for w in SCHEDULE_WORDS):
            continue
        try:
            tree = ast.parse(src)
        except SyntaxError as e:
            bad.append("%s: %s" % (p, e)); continue
        scanned += 1
        docs = _docstring_ids(tree)
        lines = src.splitlines()
        for node in ast.walk(tree):
            if not isinstance(node, (ast.If, ast.IfExp)):
                continue
            if id(node) in docs:
                continue
            names = set()
            for sub in ast.walk(node.test):
                if isinstance(sub, ast.Compare) and len(sub.ops) == 1 \
                        and isinstance(sub.ops[0], (ast.Is, ast.IsNot)) \
                        and isinstance(sub.comparators[0], ast.Constant) \
                        and sub.comparators[0].value is None:
                    nm = _name_of(sub.left)
                    if nm:
                        names.add(nm)
            bounds = {n for n in names if _is_bound_name(n)}
            if not bounds:
                continue
            line = lines[node.lineno - 1].strip() if node.lineno <= len(lines) else ""
            rows.append({
                "file": str(p.relative_to(root)).replace("\\", "/"),
                "line": node.lineno,
                "names": sorted(bounds),
                "verdict": _classify_test(node.test, line),
                "src": line[:110],
            })
    return rows, scanned, bad


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--all", action="store_true", help="print every row, not just OPEN")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args([] if (argv is None and "pytest" in sys.modules) else argv)
    if a.self_check:
        return _self_check()

    rows, scanned, bad = roster()
    counts: dict[str, int] = {}
    for r in rows:
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1

    for r in rows:
        if a.all or r["verdict"] == OPEN:
            print("%-14s %s:%d  %s  -- %s" % (r["verdict"], r["file"], r["line"],
                                              ",".join(r["names"]), r["src"]))
    # ⛔ NON-VACUITY, printed: an empty roster must read as ZERO, never as a silent pass.
    print("\n[absent-bound] files parsed: %d | rows: %d | %s"
          % (scanned, len(rows), " ".join("%s=%d" % kv for kv in sorted(counts.items()))))
    if bad:
        print("[absent-bound] UNREADABLE files: %d" % len(bad))
        for b in bad[:5]:
            print("    %s" % b)
    if scanned == 0 or not rows:
        print("[absent-bound] ZERO rows derived — the derivation is broken, not the codebase.")
        return UNREADABLE_EXIT
    n_open = counts.get(OPEN, 0)
    # ⛔ REPORTS, NEVER FAILS. Triage of all 30 rows on 2026-09-14 found ZERO defects: the
    # class is the ordinary optional-guard idiom. Failing here would red correct code and
    # get the tool muted — the exact fate F-S7-TICK-1 warns about.
    print("[absent-bound] %d row(s) to LOOK at. This tool does not fail the build: the shape "
          "is usually correct, and only the CALLER decides whether absence means 'open'."
          % n_open)
    return PASS


def _self_check() -> int:
    """⛔ A check nobody has seen fail is not a check."""
    ok = True
    open_src = "if hours is not None and not (lo <= h <= hi):\n    return OUTSIDE\n"
    closed_src = "if hours is None or not (lo <= h <= hi):\n    return OUTSIDE\n"
    for src, want, label in ((open_src, OPEN, "POSITIVE (the F-S7-TICK-1 shape)"),
                             (closed_src, CLOSED, "NEGATIVE (the fixed shape)")):
        node = ast.parse(src).body[0]
        got = _classify_test(node.test, src)
        print("  %-34s -> %-18s %s" % (label, got, "ok" if got == want else "WRONG"))
        ok &= got == want
    print("  %-34s -> %-16s %s" % ("NOT-A-BOUND control", _is_bound_name("colour"),
                                   "ok" if not _is_bound_name("colour") else "WRONG"))
    ok &= not _is_bound_name("colour")
    print("  %-34s -> %-16s %s" % ("bound-name control", _is_bound_name("hours"),
                                   "ok" if _is_bound_name("hours") else "WRONG"))
    ok &= _is_bound_name("hours")
    print("SELF-CHECK: %s" % ("PASS" if ok else "FAIL"))
    return PASS if ok else FAIL


if __name__ == "__main__":
    raise SystemExit(main())
