"""Score the Notebook user study — SUS, the 90% CI, and the ruled verdict.

    python tools/notebook_study_score.py docs/notebook/user-study/results-template.csv

Reads the results CSV (`docs/notebook/user-study/results-template.csv` — one row per
participant, columns below) and prints each participant's SUS, the mean with its 90%
confidence interval, and ONE verdict with its reasons:

  INCOMPLETE  fewer than 5 rows, any missing or out-of-range cell (each one named), or a CORE
              task recorded NT for anyone. Exit 2.
  PASS        the mean SUS is at least 80 (the POINT mean, ruling D-9C6 — the CI is printed
              beside it, not used as the bar); every core task (T1, T2, T4, T6, T8) is U for
              every participant; every other task is U for at least 80% of the participants it
              was eligible for (NT is left out of that denominator); T1 under 120 s for
              everyone (standard #16, `NOTEBOOK-10-OF-10-PLAN.md:38`); zero silent failures.
              Exit 0.
  FIX-LIST    anything else: one line per miss, naming the P numbers. Exit 1.

⛔ IT NEVER IMPUTES. A blank SUS answer, a blank task cell or a blank time is a named
problem that makes the study INCOMPLETE — never a 3, never a U, never a zero. A study
that fills its own gaps reports a score nobody gave.

SUS (Brooke, 1986): odd items give (answer − 1), even items give (5 − answer); the sum
times 2.5 is a score from 0 to 100 (`docs/notebook/user-study-kit.md` §6).

The 90% CI is mean ± t · s / √n, with s the sample standard deviation and t the
two-sided 90% critical value of Student's t on n − 1 degrees of freedom — the one-sided
0.95 quantile. The table below is committed so this needs no new dependency; its values
are the standard ones, e.g. NIST/SEMATECH e-Handbook of Statistical Methods,
§1.3.6.7.2 "Critical Values of the Student's t Distribution", column 0.95.
"""
from __future__ import annotations

import csv
import io
import math
import re
import sys

TASKS = tuple(f"T{i}" for i in range(1, 11))
CORE = ("T1", "T2", "T4", "T6", "T8")             # ruling D-9C6
MARKS = ("U", "H", "F", "NT")
SUS_ITEMS = tuple(f"sus_{i}" for i in range(1, 11))
COLUMNS = ("participant", "tool_today", "session_date", "t1_seconds", *TASKS,
           "silent_failures", *SUS_ITEMS)
PARTICIPANTS = tuple(f"P{i}" for i in range(1, 9))
MIN_PARTICIPANTS = 5
SUS_BAR = 80.0
OTHER_TASK_BAR = 0.80
T1_LIMIT_S = 120

# Student's t, one-sided 0.95 quantile (= two-sided 90%), by degrees of freedom.
T_95 = {
    1: 6.314, 2: 2.920, 3: 2.353, 4: 2.132, 5: 2.015, 6: 1.943, 7: 1.895, 8: 1.860,
    9: 1.833, 10: 1.812, 11: 1.796, 12: 1.782, 13: 1.771, 14: 1.761, 15: 1.753,
    16: 1.746, 17: 1.740, 18: 1.734, 19: 1.729, 20: 1.725, 25: 1.708, 30: 1.697,
}


def sus_score(answers) -> float:
    """Ten answers, each 1..5, in item order -> 0..100."""
    if len(answers) != 10:
        raise ValueError("SUS needs exactly ten answers")
    odd = sum(a - 1 for a in answers[0::2])      # items 1, 3, 5, 7, 9
    even = sum(5 - a for a in answers[1::2])     # items 2, 4, 6, 8, 10
    return (odd + even) * 2.5


def t_critical_90(df: int) -> float:
    """The committed table; a df between listed values uses the next LOWER listed df
    (a larger t, so the interval can only be wider — never falsely narrow)."""
    if df < 1:
        raise ValueError("a confidence interval needs at least two scores")
    return T_95[max(k for k in T_95 if k <= df)]


def mean_ci90(scores) -> tuple[float, float | None, float | None]:
    n = len(scores)
    mean = sum(scores) / n
    if n < 2:
        return mean, None, None
    s = math.sqrt(sum((x - mean) ** 2 for x in scores) / (n - 1))
    half = t_critical_90(n - 1) * s / math.sqrt(n)
    return mean, mean - half, mean + half


def parse(text: str) -> tuple[list[dict], list[str]]:
    """Rows as typed values, and every problem named. Nothing is filled in."""
    problems: list[str] = []
    reader = csv.DictReader(io.StringIO(text or ""))
    header = tuple(h.strip() for h in (reader.fieldnames or ()))
    missing_cols = [c for c in COLUMNS if c not in header]
    if missing_cols:
        problems.append("the CSV has no column(s): " + ", ".join(missing_cols))
        return [], problems
    rows, seen = [], set()
    for line_no, raw in enumerate(reader, start=2):
        cell = {k.strip(): (v or "").strip() for k, v in raw.items() if k}
        if not any(cell.values()):
            continue
        p = cell["participant"]
        who = p or f"line {line_no}"
        row = {"participant": p, "problems": []}

        def bad(msg):
            row["problems"].append(f"{who}: {msg}")

        if p not in PARTICIPANTS:
            bad(f"participant {p!r} is not one of P1-P8")
        elif p in seen:
            bad("appears twice")
        seen.add(p)
        if not cell["tool_today"]:
            bad("tool_today is blank")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", cell["session_date"]):
            bad(f"session_date {cell['session_date']!r} is not YYYY-MM-DD")
        try:
            t1 = float(cell["t1_seconds"])
            if not math.isfinite(t1) or t1 < 0:
                raise ValueError
            row["t1_seconds"] = t1
        except ValueError:
            bad(f"t1_seconds {cell['t1_seconds']!r} is not a number of seconds")
        for t in TASKS:
            v = cell[t]
            if v not in MARKS:
                bad(f"{t} is {v!r}, not one of U / H / F / NT" if v else f"{t} is blank")
            row[t] = v
        try:
            sf = int(cell["silent_failures"])
            if sf < 0:
                raise ValueError
            row["silent_failures"] = sf
        except ValueError:
            bad(f"silent_failures {cell['silent_failures']!r} is not a count")
        answers = []
        for item in SUS_ITEMS:
            v = cell[item]
            if v in ("1", "2", "3", "4", "5"):
                answers.append(int(v))
            else:
                bad(f"{item} is {v!r}, not 1-5" if v else f"{item} is blank")
        if len(answers) == 10:
            row["sus"] = sus_score(answers)
        problems.extend(row["problems"])
        rows.append(row)
    return rows, problems


def verdict(rows: list[dict], problems: list[str]) -> dict:
    """`{word, reasons, notes, sus, mean, ci}` — the ruled decision rule and nothing more."""
    out = {"reasons": [], "notes": [], "sus": {}, "mean": None, "ci": (None, None)}
    for r in rows:
        if "sus" in r:
            out["sus"][r["participant"]] = r["sus"]
    scored = list(out["sus"].values())
    if len(scored) >= 1:
        m, lo, hi = mean_ci90(scored)
        out["mean"], out["ci"] = m, (lo, hi)

    incomplete = list(problems)
    if len(rows) < MIN_PARTICIPANTS:
        incomplete.append(f"{len(rows)} participant row(s); at least {MIN_PARTICIPANTS} are needed")
    for t in CORE:
        nt = [r["participant"] for r in rows if r.get(t) == "NT"]
        if nt:
            incomplete.append(f"core task {t} was not tested for {', '.join(nt)}")
    if incomplete:
        out["word"], out["reasons"] = "INCOMPLETE", incomplete
        return out

    misses = []
    for t in CORE:
        off = [f"{r['participant']} ({r[t]})" for r in rows if r[t] != "U"]
        if off:
            misses.append(f"{t} (core) not unaided for {', '.join(off)}")
    for t in TASKS:
        if t in CORE:
            continue
        eligible = [r for r in rows if r[t] != "NT"]
        if not eligible:
            out["notes"].append(f"{t} was not tested for anyone (NT throughout) — it says nothing yet")
            continue
        u = sum(1 for r in eligible if r[t] == "U")
        if u / len(eligible) < OTHER_TASK_BAR:
            off = [f"{r['participant']} ({r[t]})" for r in eligible if r[t] != "U"]
            misses.append(f"{t} unaided for {u} of {len(eligible)} eligible — below 80%: {', '.join(off)}")
    lo, hi = out["ci"]
    if out["mean"] < SUS_BAR:
        misses.append(f"SUS mean {out['mean']:.1f} is below {SUS_BAR:.0f}"
                      + (f" (90% CI {lo:.1f}-{hi:.1f})" if lo is not None else ""))
    slow = [f"{r['participant']} ({r['t1_seconds']:g} s)" for r in rows if r["t1_seconds"] >= T1_LIMIT_S]
    if slow:
        misses.append(f"T1 took {T1_LIMIT_S} s or more for {', '.join(slow)}")
    silent = [f"{r['participant']} ({r['silent_failures']})" for r in rows if r["silent_failures"] > 0]
    if silent:
        misses.append(f"silent failures: {', '.join(silent)}")
    out["word"] = "FIX-LIST" if misses else "PASS"
    out["reasons"] = misses
    return out


def render(v: dict) -> str:
    lines = []
    for p in sorted(v["sus"], key=lambda x: int(x[1:])):
        lines.append(f"{p}  SUS {v['sus'][p]:.1f}")
    if v["mean"] is not None:
        lo, hi = v["ci"]
        ci = f"90% CI {lo:.1f}-{hi:.1f}" if lo is not None else "90% CI needs two or more scores"
        lines.append(f"mean SUS {v['mean']:.1f}  ({ci}; the bar is the point mean, {SUS_BAR:.0f})")
    lines.append(f"VERDICT: {v['word']}")
    lines += [f"- {r}" for r in v["reasons"]]
    lines += [f"note: {n}" for n in v["notes"]]
    return "\n".join(lines)


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 1:
        print(__doc__.strip().splitlines()[2].strip())
        return 2
    with open(argv[0], encoding="utf-8", newline="") as fh:
        text = fh.read()
    v = verdict(*parse(text))
    print(render(v))
    return {"PASS": 0, "FIX-LIST": 1}.get(v["word"], 2)


if __name__ == "__main__":
    sys.exit(main())
