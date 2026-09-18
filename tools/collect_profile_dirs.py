"""E7 — what does IMPORTING the backend test tree cost? Measured, per directory.

⛔⛔ **REPORT-ONLY. THIS GATES NOTHING.** It exists because every OOM this repository has
recorded happened at COLLECTION, not during tests: `pytest tests/` reached **18 GB** on the
dev box and `--collect-only` **alone** reached **6.6 GB**. Those numbers are in `CLAUDE.md`
as warnings; nobody has ever measured WHICH directories carry the cost.

⭐ **Collection cost is an import-time property**, so what it really measures is what runs
when a module is imported — a DB opened, a model loaded, a fixture touching a volume. That
is why the top-RSS directories get their `conftest.py` read afterwards.

⚠️ **A directory that hits its 10-minute cap is a RESULT, not a gap.** It is recorded as
`result: "capped"` with whatever partial numbers exist, never as zero.

Usage:
    python tools/collect_profile_dirs.py                       # JSON array for the matrix
    python tools/collect_profile_dirs.py --row tests/api --collect-log c.log \\
                                         --time-log t.log --out row.json
    python tools/collect_profile_dirs.py --aggregate profile/ --out collect_profile.json
    python tools/collect_profile_dirs.py --self-check
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re

OK, FAIL = 0, 1

_COLLECTED = re.compile(r"(\d+)\s+tests?\s+collected", re.I)
_COLLECTED2 = re.compile(r"collected\s+(\d+)\s+item", re.I)
#: GNU time -v
_RSS = re.compile(r"Maximum resident set size \(kbytes\):\s*(\d+)")
_WALL = re.compile(r"Elapsed \(wall clock\) time \(h:mm:ss or m:ss\):\s*([0-9:.]+)")


def profile_dirs(root: pathlib.Path | None = None) -> list:
    """Top-level test directories, plus the whole tree.

    ⭐ The whole tree is included deliberately: *"does collection alone fit in ten
    minutes?"* is the question the 18 GB warning actually raises, and a cap hit answers it.
    """
    base = root or (pathlib.Path(__file__).resolve().parent.parent / "tests")
    out = []
    for p in sorted(base.iterdir()):
        if p.is_dir() and p.name != "__pycache__" and any(p.rglob("test_*.py")):
            out.append((base.name + "/" + p.name))
    out.append(base.name)
    return out


def _wall_seconds(text: str):
    m = _WALL.search(text or "")
    if not m:
        return None
    parts = m.group(1).split(":")
    try:
        parts = [float(x) for x in parts]
    except ValueError:
        return None
    sec = 0.0
    for x in parts:
        sec = sec * 60 + x
    return sec


def row(dirname: str, collect_log: str, time_log: str) -> dict:
    """One measured row. ⛔ Unreadable fields are None, never 0."""
    m = _COLLECTED.search(collect_log or "") or _COLLECTED2.search(collect_log or "")
    collected = int(m.group(1)) if m else None
    r = _RSS.search(time_log or "")
    rss_mb = round(int(r.group(1)) / 1024.0, 1) if r else None
    secs = _wall_seconds(time_log)
    if collected is None:
        result = "capped-or-failed"
    else:
        result = "ok"
    return {"dir": dirname, "collected": collected, "seconds": secs,
            "rss_mb": rss_mb, "result": result}


def aggregate_rows(rows: list) -> dict:
    good = [r for r in rows if r.get("collected") is not None]
    return {
        "dirs_total": len(rows),
        "dirs_measured": len(good),
        "dirs_unmeasured": [r["dir"] for r in rows if r.get("collected") is None],
        "sum_collected": sum(r["collected"] for r in good),
        "rows": sorted(rows, key=lambda r: (r.get("rss_mb") or -1), reverse=True),
    }


def _self_check() -> int:
    ok = True

    def show(label, got, want):
        nonlocal ok
        good = got == want
        ok &= good
        print("  %-56s -> %-10s %s" % (label, got, "ok" if good else "WRONG (want %s)" % (want,)))

    clog = "tests/api/test_a.py::test_x\n\n26 tests collected in 3.21s\n"
    tlog = ("\tElapsed (wall clock) time (h:mm:ss or m:ss): 0:04.55\n"
            "\tMaximum resident set size (kbytes): 524288\n")
    r = row("tests/api", clog, tlog)
    show("collected is parsed", r["collected"], 26)
    show("RSS converts kbytes -> MB", r["rss_mb"], 512.0)
    show("wall clock m:ss parses", round(r["seconds"], 2), 4.55)
    show("result ok", r["result"], "ok")

    show("h:mm:ss parses too", round(_wall_seconds(
        "\tElapsed (wall clock) time (h:mm:ss or m:ss): 1:02:03\n"), 0), 3723.0)

    # ⛔ a capped run: no totals in the collect log -> UNMEASURED, never zero
    r2 = row("tests", "", tlog)
    show("a capped dir has collected None, NOT 0", r2["collected"], None)
    show("...and is marked", r2["result"], "capped-or-failed")

    agg = aggregate_rows([r, r2])
    show("aggregate counts only measured dirs", agg["dirs_measured"], 1)
    show("aggregate NAMES the unmeasured", agg["dirs_unmeasured"], ["tests"])
    show("sum_collected excludes the unmeasured", agg["sum_collected"], 26)
    show("rows sort by RSS desc", agg["rows"][0]["dir"] in ("tests/api", "tests"), True)

    # ⛔ NON-VACUITY against the real tree
    dirs = profile_dirs()
    show("the real tree yields more than one dir", len(dirs) > 1, True)
    show("the whole tree is included last", dirs[-1], "tests")

    print("SELF-CHECK:", "PASS" if ok else "FAIL")
    return OK if ok else FAIL


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--row")
    ap.add_argument("--collect-log")
    ap.add_argument("--time-log")
    ap.add_argument("--aggregate")
    ap.add_argument("--out")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)

    if a.self_check:
        return _self_check()

    if a.row:
        c = pathlib.Path(a.collect_log).read_text(encoding="utf-8", errors="replace") \
            if a.collect_log and pathlib.Path(a.collect_log).is_file() else ""
        t = pathlib.Path(a.time_log).read_text(encoding="utf-8", errors="replace") \
            if a.time_log and pathlib.Path(a.time_log).is_file() else ""
        blob = json.dumps(row(a.row, c, t), indent=2)
        if a.out:
            pathlib.Path(a.out).write_text(blob + "\n", encoding="utf-8")
        print(blob)
        return OK

    if a.aggregate:
        base = pathlib.Path(a.aggregate)
        rows = []
        for p in sorted(base.rglob("row.json")):
            try:
                rows.append(json.loads(p.read_text(encoding="utf-8")))
            except ValueError:
                pass
        blob = json.dumps(aggregate_rows(rows), indent=2)
        if a.out:
            pathlib.Path(a.out).write_text(blob + "\n", encoding="utf-8")
        print(blob)
        return OK

    # ⚰️ E CP10 — EMITTED AS {dir, id} PAIRS, because GitHub Actions has NO
    # `replace()` EXPRESSION FUNCTION. E CP7 used one to sanitise the artifact name and
    # the WHOLE WORKFLOW was rejected before a single job started: run #7, 0 jobs,
    # created == updated. The matrix carries a pre-sanitised id instead, so the workflow
    # needs no string manipulation at all.
    print(json.dumps([{"dir": d, "id": d.replace("/", "--")} for d in profile_dirs()]))
    return OK


if __name__ == "__main__":
    raise SystemExit(main())
