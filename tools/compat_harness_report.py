#!/usr/bin/env python3
"""Compatibility harness — aggregate report over Layer A + Layer B results.

Step 5 of the bounded implementation sequence
(`docs/superpowers/specs/universal-indicator-ecosystem/
PUBLIC_SCRIPT_VISUAL_COMPATIBILITY_HARNESS_READINESS_REPORT.md`). Reads every
Section-3-schema result file under
`tests/fixtures/compat_harness/results/**/*.json` (written by
`compatHarness.publicScript.test.js`, `compatHarness.level2Fixture.test.js`,
`tools/compat_harness_visual.py`, and any future layer) and prints a
classification breakdown per lane, plus the full failure-taxonomy tally
across everything measured so far.

⛔ THIS DOES NOT RE-RUN ANYTHING. It is a pure aggregator over already-written
result files -- exactly the same "read the artifact, don't recompute it"
discipline `ast_conformance.py --coverage` and `chart_parity.py`'s
`report.json` already follow in this repo. Run the underlying suites first
(`npx vitest run src/components/chart/engine/ast/compatHarness.publicScript.test.js
src/components/chart/builder/compatHarness.level2Fixture.test.js`) to refresh
the files this reads.
"""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RESULTS_ROOT = ROOT / "tests" / "fixtures" / "compat_harness" / "results"


def load_all_results() -> list[dict]:
    results = []
    if not RESULTS_ROOT.exists():
        return results
    for path in sorted(RESULTS_ROOT.rglob("*.json")):
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise SystemExit(f"{path}: not valid JSON ({exc}) -- a broken result file "
                              "is a harness defect, not a script to skip")
        doc["_path"] = str(path.relative_to(ROOT))
        results.append(doc)
    return results


def build_report(results: list[dict]) -> dict:
    by_lane: dict[str, Counter] = defaultdict(Counter)
    taxonomy_tally: Counter = Counter()
    for r in results:
        lane = r.get("lane", "unknown")
        cls = r.get("final_classification", "UNKNOWN")
        by_lane[lane][cls] += 1
        for tag in r.get("failure_taxonomy", []):
            taxonomy_tally[tag] += 1

    return {
        "total_results": len(results),
        "by_lane": {lane: dict(counter) for lane, counter in by_lane.items()},
        "failure_taxonomy_tally": dict(taxonomy_tally),
        "results": [{"id": r.get("id"), "lane": r.get("lane"),
                     "final_classification": r.get("final_classification"),
                     "failure_taxonomy": r.get("failure_taxonomy", []),
                     "path": r["_path"]} for r in results],
    }


def print_report(report: dict) -> None:
    print(f"compat harness aggregate — {report['total_results']} result(s)\n")
    for lane, counts in report["by_lane"].items():
        total = sum(counts.values())
        parts = ", ".join(f"{k}={v}" for k, v in sorted(counts.items()))
        print(f"  {lane:16s} {total:2d} total  ({parts})")
    print()
    if report["failure_taxonomy_tally"]:
        print("failure taxonomy tally (across every result, not per-lane):")
        for tag, count in sorted(report["failure_taxonomy_tally"].items(), key=lambda kv: -kv[1]):
            print(f"  {count:2d}  {tag}")
    else:
        print("failure taxonomy tally: empty (nothing failed anything, or nothing has been measured)")
    print()
    for row in report["results"]:
        print(f"  [{row['final_classification']:20s}] {row['id']:55s} {row['path']}")


def main() -> int:
    results = load_all_results()
    if not results:
        print("no compat_harness result files found under "
              f"{RESULTS_ROOT.relative_to(ROOT)} -- run the harness suites first",
              file=sys.stderr)
        return 1
    report = build_report(results)
    print_report(report)
    # ⛔ NON-VACUITY: a report over zero results printed the same shape as a
    # report over real ones would, which is exactly the silent-empty-corpus
    # trap this program has hit before (`assert_corpus_covers_the_table`,
    # `test_scannableCols_length`). Refuse rather than print a hollow "0 total".
    if report["total_results"] == 0:
        raise SystemExit("0 results loaded -- refusing to report a summary of nothing")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
