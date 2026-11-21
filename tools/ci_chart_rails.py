"""The chart test family, and its PR lane: .github/workflows/chart-rails.yml.

WHY (2026-11-21). The StockChart merges of 2026-11-20 (#2251, #2276, #2278) broke StockChart.liveCandle (12 tests),
neighborFrames, onChartTap, dailyFirstPaintAcceptance and ChartEmbed.touchTargets, and every PR check and the master
deploy gate stayed green: no job ran the chart's own tests. pine heavy runs app/src/components/chart/engine/ and
builder/ (its VITEST_ROOTS); nothing ran the rest.

THE FAMILY IS DERIVED, never listed: every vitest file named app/src/components/StockChart*.test.*, every other vitest
file directly in app/src/components/ that imports ./StockChart (the daily first-paint rails, TickerPopup's), and every
vitest file under app/src/components/chart/, minus the two roots pine heavy owns. `family()` is the one definition; the
workflow runs `--write-files`, and tests/test_ci_chart_rails.py holds the workflow to it.

  python tools/ci_chart_rails.py --check          # 0 problems, or each one by name
  python tools/ci_chart_rails.py --plan           # count= n= shards= for $GITHUB_OUTPUT
  python tools/ci_chart_rails.py --write-files out.txt --shard 2/3

Shards are cut by recorded time (tools/chart_rails_timings.json, measured on the remote tests lane; a file not there
costs UNKNOWN_MS), largest first onto the lightest shard, so every shard gets the same partition. Stdlib only.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
APP = "app"
CHART = "src/components/chart/"
STOCKCHART_GLOB = "src/components/StockChart*"
#: the chart folders pine heavy runs (its VITEST_ROOTS); `problems()` fails if pine heavy stops naming one
PINE_HEAVY_ROOTS = ("src/components/chart/engine/", "src/components/chart/builder/")
WORKFLOW = ".github/workflows/chart-rails.yml"
PINE_HEAVY = ".github/workflows/pine-heavy.yml"
TIMINGS = "tools/chart_rails_timings.json"
UNKNOWN_MS = 3000
SHARD_TARGET_MS = 6 * 60 * 1000       # recorded test time per shard; the job adds checkout, setup and vitest start
MAX_SHARDS = 6
TEST_FILE = re.compile(r"\.test\.(?:js|jsx|ts|tsx|mjs)$")
IMPORTS_STOCKCHART = re.compile(r"""(?:from\s+|import\s*\(\s*)['"]\./StockChart(?:\.jsx)?['"]""")


def _is_test(name: str) -> bool:
    return bool(TEST_FILE.search(name))


def family(root: pathlib.Path = ROOT) -> list[str]:
    """Every chart vitest file this lane runs, app-relative (`src/...`), sorted."""
    app = root / APP
    out = {p.relative_to(app).as_posix() for p in app.glob(STOCKCHART_GLOB)
           if p.is_file() and p.name.startswith("StockChart") and _is_test(p.name)}
    for p in (app / "src" / "components").glob("*"):
        if (p.is_file() and _is_test(p.name) and not p.name.startswith("StockChart")
                and IMPORTS_STOCKCHART.search(p.read_text(encoding="utf-8", errors="replace"))):
            out.add(p.relative_to(app).as_posix())
    for p in (app / CHART).rglob("*"):
        rel = p.relative_to(app).as_posix()
        if p.is_file() and _is_test(p.name) and not rel.startswith(PINE_HEAVY_ROOTS) and "node_modules" not in rel:
            out.add(rel)
    return sorted(out)


def load_timings(root: pathlib.Path = ROOT) -> dict[str, int]:
    try:
        raw = json.loads((root / TIMINGS).read_text(encoding="utf-8"))["files_ms"]
    except (OSError, ValueError, KeyError, TypeError):
        return {}
    return {k[len(APP) + 1:] if k.startswith(APP + "/") else k: int(v) for k, v in raw.items()}


def shard_count(files: list[str], timings: dict[str, int]) -> int:
    if not files:
        return 0
    total = sum(timings.get(f, UNKNOWN_MS) for f in files)
    return max(1, min(MAX_SHARDS, len(files), -(-total // SHARD_TARGET_MS)))


def shards(files: list[str], n: int, timings: dict[str, int]) -> list[list[str]]:
    """`n` shards, largest file first onto the lightest shard (ties: the lower index, then the name)."""
    bins: list[list] = [[0, i, []] for i in range(n)]
    for f in sorted(files, key=lambda f: (-timings.get(f, UNKNOWN_MS), f)):
        b = min(bins, key=lambda b: (b[0], b[1]))
        b[0] += timings.get(f, UNKNOWN_MS)
        b[2].append(f)
    return [sorted(b[2]) for b in bins]


def pine_heavy_roots(root: pathlib.Path = ROOT) -> set[str]:
    m = re.search(r"^\s*VITEST_ROOTS:\s*(.+)$", (root / PINE_HEAVY).read_text(encoding="utf-8"), re.M)
    return set(m.group(1).split()) if m else set()


def stockchart_tests(root: pathlib.Path = ROOT) -> list[str]:
    """Every StockChart.*.test.* anywhere under app/src (the coordinator's rail: each is in a lane)."""
    app = root / APP
    # the name test is spelled out: Windows globs ignore case, and `stockChartWiring` (engine/) is not one
    return sorted(p.relative_to(app).as_posix() for p in (app / "src").rglob("*")
                  if p.is_file() and p.name.startswith("StockChart") and _is_test(p.name)
                  and "node_modules" not in p.parts)


def problems(root: pathlib.Path = ROOT) -> list[str]:
    out = []
    fam = set(family(root))
    if len(fam) < 100:
        out.append(f"the family has {len(fam)} files: the derivation cannot be seeing app/src/components")
    owned = pine_heavy_roots(root)
    for r in PINE_HEAVY_ROOTS:
        if r not in owned:
            out.append(f"pine heavy no longer runs {r} (its VITEST_ROOTS): the chart lane must take it back")
    for f in stockchart_tests(root):
        if f not in fam and not f.startswith(tuple(owned)):
            out.append(f"{f} is a StockChart test that runs in no lane")
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--plan", action="store_true", help="count=, n=, shards= for $GITHUB_OUTPUT")
    ap.add_argument("--print-list", action="store_true")
    ap.add_argument("--write-files", type=pathlib.Path, help="one shard's files, app-relative, one per line")
    ap.add_argument("--shard", default="1/1")
    a = ap.parse_args(argv)
    fam = family()
    timings = load_timings()
    n = shard_count(fam, timings)
    if a.check:
        bad = problems()
        for p in bad:
            print(f"PROBLEM: {p}")
        print(f"chart rails: {len(fam)} files in the family, {n} shard(s); {len(bad)} problem(s)")
        return 1 if bad else 0
    if a.plan:
        print(f"count={len(fam)}")
        print(f"n={n}")
        print(f"shards={json.dumps(list(range(1, n + 1)))}")
        return 0
    if a.print_list:
        print(" ".join(fam))
        return 0
    if a.write_files:
        m = re.fullmatch(r"(\d+)/(\d+)", a.shard)
        if not m or not 1 <= int(m.group(1)) <= int(m.group(2)):
            ap.error(f"--shard {a.shard!r}: want K/N with 1 <= K <= N")
        k, total = int(m.group(1)), int(m.group(2))
        mine = shards(fam, total, timings)[k - 1]
        a.write_files.write_text("".join(f"{f}\n" for f in mine), encoding="utf-8")
        ms = sum(timings.get(f, UNKNOWN_MS) for f in mine)
        print(f"chart rails, shard {k}/{total}: {len(mine)} of {len(fam)} files, ~{ms // 1000} s recorded")
        return 0
    ap.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
