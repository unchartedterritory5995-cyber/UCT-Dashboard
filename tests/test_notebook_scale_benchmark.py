"""Rails for tools/notebook_scale_benchmark.py -- the instrument the Notebook search budget
is read from (wave 7, lane I).

The benchmark's numbers only mean something if (a) its p95 is the p95, (b) its
correctness checks can FAIL, (c) its network stub is scoped to the measurement, and
(d) a breach turns into a non-zero exit that names the op. Each of those is pinned
here against a real, tiny seeded library (a few hundred notes, one rep), never a mock
of the query functions it exists to time.
"""
from __future__ import annotations

import json
import sys

import pytest

from tools import notebook_scale_benchmark as bench


def test_percentile_is_nearest_rank():
    samples = [float(x) for x in range(1, 21)]  # 1..20
    assert bench.percentile(samples, 95) == 19.0
    assert bench.percentile(samples, 50) == 10.0
    assert bench.percentile(samples, 100) == 20.0
    assert bench.percentile([7.0], 95) == 7.0
    assert bench.percentile([4.0, 1.0, 3.0, 2.0], 50) == 2.0  # order of arrival does not matter
    with pytest.raises(ValueError):
        bench.percentile([], 95)


def test_a_tiny_tier_measures_every_op_and_every_check_passes(tmp_path):
    r = bench.run_tier(300, reps=2, warmup=0, paragraphs=1, work_dir=str(tmp_path))
    assert list(r["ops"]) == bench.TIMED_OPS
    for label, st in r["ops"].items():
        assert st["reps"] == 2, label
        assert 0 <= st["min_ms"] <= st["p50_ms"] <= st["p95_ms"] <= st["max_ms"], label
    failed = [k for k, ok in r["correctness"].items() if not ok]
    assert failed == []
    # the seed really carries the shapes the new reads exist for
    assert r["trashed"] > 0 and r["archived"] > 0
    assert r["active"] == 300 - r["trashed"] - r["archived"]


def test_CONTROL_a_wrong_answer_turns_a_correctness_check_red(tmp_path, monkeypatch):
    """A fast wrong answer is not a pass: drop one tag from tag_counts and the
    truth comparison must notice."""
    real = bench.notes_svc.tag_counts

    def lossy(user_id, conn=None):
        return real(user_id, conn=conn)[1:]

    monkeypatch.setattr(bench.notes_svc, "tag_counts", lossy)
    r = bench.run_tier(300, reps=1, warmup=0, paragraphs=1, work_dir=str(tmp_path))
    assert r["correctness"]["tag_counts equals the recomputed truth for every tag (flat and nested)"] is False


def test_no_timed_call_runs_under_tracemalloc(tmp_path, monkeypatch):
    """tracemalloc hooks every Python allocation. Timing inside it inflated the
    switcher x7 on the 50k seed (62 -> 435 ms) and left the SQL-bound reads alone, so
    the instrument pointed the fix work at a slowness the product does not have. Every
    warm-up and timed call must run untraced; only the separate memory pass is traced."""
    import tracemalloc
    seen = []
    real = bench.notes_svc.folder_note_counts

    def spy(user_id, conn=None):
        seen.append(tracemalloc.is_tracing())
        return real(user_id, conn=conn)

    monkeypatch.setattr(bench.notes_svc, "folder_note_counts", spy)
    r = bench.run_tier(200, reps=3, warmup=1, paragraphs=1, work_dir=str(tmp_path))
    assert seen[:4] == [False, False, False, False], seen   # 1 warm-up + 3 timed
    assert seen[4:] == [True], seen                          # the memory pass, and only it
    assert r["peak_tracemalloc_bytes"] > 0


def test_the_ticker_meta_stub_is_scoped_to_the_measurement(tmp_path):
    key = "api.services.ticker_meta"
    before = sys.modules.get(key)
    seen = {}
    real_backlinks = bench.notes_svc.get_symbol_backlinks

    def spy(*a, **kw):
        seen["mod"] = sys.modules.get(key)
        return real_backlinks(*a, **kw)

    bench.notes_svc.get_symbol_backlinks = spy
    try:
        bench.run_tier(200, reps=1, warmup=0, paragraphs=1, work_dir=str(tmp_path))
    finally:
        bench.notes_svc.get_symbol_backlinks = real_backlinks
    # during the measurement the lookup was the stub (no network) ...
    assert seen["mod"] is not before
    assert seen["mod"].get_ticker_meta("AMD") == {"sector": None, "industry": None, "theme": None}
    # ... and afterwards the process has whatever it had before
    assert sys.modules.get(key) is before


def _report(n, ops):
    return {"tiers": [{"n": n, "ops": {k: {"p95_ms": v} for k, v in ops.items()}}]}


def test_check_thresholds_names_the_op_the_tier_and_both_numbers():
    th = {"search": {"p95_ms_max": 100, "tier": 50000, "ops": ["a", "b"]}}
    assert bench.check_thresholds(_report(50000, {"a": 12.0, "b": 99.9}), th) == []
    out = bench.check_thresholds(_report(50000, {"a": 12.0, "b": 140.25}), th)
    assert out == ["'b' at 50,000 notes: p95 140.2 ms >= budget 100 ms"]


def test_check_thresholds_counts_an_unmeasured_op_or_tier_as_a_breach():
    th = {"search": {"p95_ms_max": 100, "tier": 50000, "ops": ["a", "missing"]}}
    assert bench.check_thresholds(_report(50000, {"a": 1.0}), th) == [
        "'missing' at 50,000 notes: not measured by this run"]
    out = bench.check_thresholds(_report(10000, {"a": 1.0}), th)
    assert len(out) == 1 and "was not run" in out[0]


def test_check_thresholds_IS_the_budget_tool_not_a_copy(monkeypatch):
    """One comparison, two callers. The CI job reads the budget tool and a local run read
    the benchmark's own copy; two copies of one rule drift. The benchmark delegates."""
    from tools import notebook_perf_budgets as pb
    monkeypatch.setattr(pb, "check_search", lambda report, spec: ["sentinel", spec["tier"]])
    assert bench.check_thresholds({}, {"tasks": {"tier": 7}}, "tasks") == ["sentinel", 7]


def test_the_route_pairs_time_what_the_routes_call(tmp_path, monkeypatch):
    """`GET /notes` and `GET /notes/tags` each run ONE combined read; timing the separate
    functions would measure a request the product no longer makes."""
    calls = []
    real_lc, real_tt = bench.notes_svc.list_and_count_notes, bench.notes_svc.tag_counts_and_tree

    def lc(*a, **kw):
        calls.append("list_and_count_notes")
        return real_lc(*a, **kw)

    def tt(*a, **kw):
        calls.append("tag_counts_and_tree")
        return real_tt(*a, **kw)

    monkeypatch.setattr(bench.notes_svc, "list_and_count_notes", lc)
    monkeypatch.setattr(bench.notes_svc, "tag_counts_and_tree", tt)
    bench.run_tier(200, reps=1, warmup=0, paragraphs=1, work_dir=str(tmp_path))
    assert "list_and_count_notes" in calls and "tag_counts_and_tree" in calls


def _write_thresholds(path, p95_max, tier):
    path.write_text(json.dumps({"search": {"p95_ms_max": p95_max, "tier": tier,
                                           "ops": ["tag_counts (whole library)",
                                                   "GET /notes q=common (list+count)"]}}),
                    encoding="utf-8")
    return str(path)


@pytest.fixture
def quiet_sink(monkeypatch):
    # The activity sink writes a user row into the session's sandbox auth store; a test
    # run must not leave one behind for other tests to count.
    monkeypatch.setattr(bench, "_prepare_activity_sink", lambda: None)


def test_main_exits_2_and_names_the_breach_when_a_budget_is_missed(tmp_path, capsys, quiet_sink):
    th = _write_thresholds(tmp_path / "th.json", 0.000001, 200)
    out_json = tmp_path / "r.json"
    code = bench.main(["--tiers", "200", "--reps", "1", "--warmup", "0", "--paragraphs", "1",
                       "--work-dir", str(tmp_path), "--json", str(out_json), "--thresholds", th])
    text = capsys.readouterr().out
    assert code == 2
    assert "VERDICT: BUDGET BREACH" in text
    assert "BREACH [search] 'tag_counts (whole library)' at 200 notes: p95" in text
    report = json.loads(out_json.read_text(encoding="utf-8"))
    assert report["meta"]["shared_root_writes"] == []
    assert [t["n"] for t in report["tiers"]] == [200]


def test_main_exits_0_under_a_generous_budget(tmp_path, capsys, quiet_sink):
    th = _write_thresholds(tmp_path / "th.json", 1e9, 200)
    code = bench.main(["--tiers", "200", "--reps", "1", "--warmup", "0", "--paragraphs", "1",
                       "--work-dir", str(tmp_path), "--thresholds", th])
    assert code == 0
    assert "VERDICT: PASS -- every budgeted op" in capsys.readouterr().out


def test_main_applies_every_named_budget_and_names_which_one_breached(tmp_path, capsys, quiet_sink):
    th = tmp_path / "th.json"
    th.write_text(json.dumps({
        "search": {"p95_ms_max": 1e9, "tier": 200, "ops": ["GET /notes q=common (list+count)"]},
        "tasks": {"p95_ms_max": 0.000001, "tier": 200, "ops": ["list_tasks (open, ?view=tasks)"]},
    }), encoding="utf-8")
    code = bench.main(["--tiers", "200", "--reps", "1", "--warmup", "0", "--paragraphs", "1",
                       "--work-dir", str(tmp_path), "--thresholds", str(th),
                       "--budget", "search", "--budget", "tasks"])
    text = capsys.readouterr().out
    assert code == 2
    assert "BREACH [tasks] 'list_tasks (open, ?view=tasks)' at 200 notes: p95" in text
    assert "[search]" not in text


def test_main_exits_3_on_a_budget_file_it_cannot_evaluate(tmp_path, capsys, quiet_sink):
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({"search": {"tier": 200}}), encoding="utf-8")
    code = bench.main(["--tiers", "200", "--reps", "1", "--thresholds", str(bad)])
    assert code == 3
    assert "cannot read a search budget" in capsys.readouterr().out
