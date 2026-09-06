"""Non-vacuity for the compat harness aggregate reporter."""
from __future__ import annotations

import sys
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parent.parent / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import compat_harness_report as chr_  # noqa: E402


def test_build_report_tallies_by_lane_and_taxonomy():
    results = [
        {"id": "a", "lane": "public_script", "final_classification": "SUPPORTED", "failure_taxonomy": []},
        {"id": "b", "lane": "public_script", "final_classification": "UNSUPPORTED", "failure_taxonomy": ["unsupported_builtin"]},
        {"id": "c", "lane": "visual_fixture", "final_classification": "SUPPORTED", "failure_taxonomy": []},
        {"id": "d", "_path": "x"},
    ]
    for r in results:
        r.setdefault("_path", "x")
    report = chr_.build_report(results)
    assert report["total_results"] == 4
    assert report["by_lane"]["public_script"] == {"SUPPORTED": 1, "UNSUPPORTED": 1}
    assert report["by_lane"]["visual_fixture"] == {"SUPPORTED": 1}
    assert report["failure_taxonomy_tally"] == {"unsupported_builtin": 1}


def test_MUTATION_zero_results_is_refused_not_silently_reported(monkeypatch, capsys):
    # main() returns a nonzero exit code (rather than 0, which would read as
    # "ran fine, nothing to report") when the results directory is empty --
    # proven by mutating the loader to return nothing and confirming the
    # return value actually changes, not merely that the function runs.
    monkeypatch.setattr(chr_, "load_all_results", lambda: [])
    assert chr_.main() != 0


def test_real_result_files_currently_on_disk_load_without_error():
    # ⛔ NON-VACUITY: this must find MORE THAN ZERO real result files, or the
    # test above (mocked to zero) would be indistinguishable from "the real
    # loader always returns nothing too."
    results = chr_.load_all_results()
    assert len(results) > 0, "expected real compat_harness result files on disk"
    report = chr_.build_report(results)
    assert report["total_results"] == len(results)
