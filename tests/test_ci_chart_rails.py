"""The chart lane (.github/workflows/chart-rails.yml) follows its tool (tools/ci_chart_rails.py).

WHY (2026-11-21): the StockChart merges of 2026-11-20 broke StockChart.liveCandle (12 tests), neighborFrames,
onChartTap and dailyFirstPaintAcceptance with every PR check and the deploy gate green: no job ran the chart's own
tests. The family is derived by the tool; this file holds the workflow to it:
  * every StockChart*.test.* under app/src runs in a lane (this one, or pine heavy's roots);
  * every family file triggers the job (GitHub's path filter, negations included, evaluated here);
  * the shards partition the family: every file in exactly one shard;
  * the job runs the tool's list, on pull requests only, with the PR-cancel concurrency.

Run ONLY this file:  python -m pytest tests/test_ci_chart_rails.py -q   (stdlib + PyYAML)
"""
from __future__ import annotations

import importlib.util
import re
import pathlib

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "chart-rails.yml"

_spec = importlib.util.spec_from_file_location("ci_chart_rails_under_test", ROOT / "tools" / "ci_chart_rails.py")
T = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(T)


def _doc() -> dict:
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))


def _glob_re(pattern: str) -> re.Pattern:
    out, i = "", 0
    while i < len(pattern):
        if pattern.startswith("**", i):
            out += ".*"
            i += 2
        elif pattern[i] == "*":
            out += "[^/]*"
            i += 1
        elif pattern[i] == "?":
            out += "[^/]"
            i += 1
        else:
            out += re.escape(pattern[i])
            i += 1
    return re.compile(out + r"\Z")


def triggers(paths: list[str], path: str) -> bool:
    """GitHub's `paths:` filter: the LAST pattern that matches decides; a `!` pattern excludes."""
    hit = False
    for p in paths:
        neg = p.startswith("!")
        if _glob_re(p[1:] if neg else p).match(path):
            hit = not neg
    return hit


def _pr_paths() -> list[str]:
    on = _doc().get("on", _doc().get(True))
    return list(on["pull_request"]["paths"])


def test_the_family_is_the_chart_and_not_pine_heavys():
    fam = T.family()
    assert len(fam) >= 300, len(fam)                       # non-vacuity: the derivation sees app/src/components
    assert "src/components/StockChart.liveCandle.test.jsx" in fam
    assert "src/components/dailyFirstPaintAcceptance.test.jsx" in fam      # an importer of ./StockChart
    assert any(f.startswith("src/components/chart/legend/") for f in fam)
    assert not [f for f in fam if f.startswith(T.PINE_HEAVY_ROOTS)]
    assert T.problems() == []


def test_every_stockchart_test_runs_in_a_lane():
    fam, owned = set(T.family()), tuple(T.pine_heavy_roots())
    homeless = [f for f in T.stockchart_tests() if f not in fam and not f.startswith(owned)]
    assert not homeless, homeless
    assert T.stockchart_tests(), "non-vacuity: no StockChart test found"


def test_every_family_file_triggers_the_job():
    paths = _pr_paths()
    missing = [f for f in T.family() if not triggers(paths, f"app/{f}")]
    assert not missing, f"family files that do not trigger chart-rails.yml (add them to its paths): {missing}"
    for own in ("tools/ci_chart_rails.py", "tools/chart_rails_timings.json", "tests/test_ci_chart_rails.py",
                ".github/workflows/chart-rails.yml", "app/src/components/StockChart.jsx"):
        assert triggers(paths, own), own
    # pine heavy's roots stay out (they are its legs), and an unrelated file does not trigger
    assert not triggers(paths, "app/src/components/chart/engine/binder.js")
    assert not triggers(paths, "app/src/components/chart/builder/BuilderSheet.jsx")
    assert not triggers(paths, "app/src/pages/Dashboard.jsx")


def test_the_shards_partition_the_family():
    fam, timings = T.family(), T.load_timings()
    n = T.shard_count(fam, timings)
    assert 1 <= n <= T.MAX_SHARDS
    parts = T.shards(fam, n, timings)
    flat = [f for p in parts for f in p]
    assert sorted(flat) == sorted(fam) and len(flat) == len(set(flat))
    assert all(parts), "an empty shard would start a runner for nothing"
    assert len(timings) >= 400, "the recorded timings are missing: every shard would be cut blind"


def test_the_job_runs_the_tools_list_on_pull_requests_only():
    doc = _doc()
    on = doc.get("on", doc.get(True))
    assert set(on) == {"pull_request"}
    text = WORKFLOW.read_text(encoding="utf-8")
    runs = {job: "\n".join(str(s.get("run", "")) for s in spec["steps"]) for job, spec in doc["jobs"].items()}
    assert "python tools/ci_chart_rails.py --write-files" in runs["chart"]      # the commands, not a step's name
    assert "python tools/ci_chart_rails.py --plan" in runs["plan"]
    assert "tests/test_ci_chart_rails.py" in runs["plan"]                    # this rail runs in the lane it guards
    assert "cancel-in-progress: ${{ github.event_name == 'pull_request' }}" in text


def test_the_path_filter_evaluator_can_tell_the_cases_apart():
    paths = ["app/src/components/chart/**", "!app/src/components/chart/engine/**", "app/src/components/StockChart*"]
    assert triggers(paths, "app/src/components/chart/legend/x.test.jsx")
    assert not triggers(paths, "app/src/components/chart/engine/x.test.js")
    assert triggers(paths, "app/src/components/StockChart.liveCandle.test.jsx")
    assert not triggers(paths, "app/src/components/StockChartish/x.js")             # `*` stops at a slash
    assert not triggers(paths, "app/src/components/TickerPopup.jsx")
