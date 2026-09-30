"""Rails for wave 10 lane 10A's three additions to the Notebook performance instruments.

1. The 10k-attachment tier (clause 14b): `--attachments N` seeds extracted documents over the
   notes and times the document reads through the routes a browser calls. Its correctness
   checks must be able to FAIL, and a budget that names an attachment count holds only on a
   tier that carried that many.
2. The curve (clause 14d): the log-log slope of every op's p50 across the curve tiers, bounded
   by hand in `docs/notebook/perf-budgets.json`. A super-linear op, a bend at the top, an op
   missing at one tier and a tier that was not run are all breaches.
3. The runner-noise-robust CI check (ruling R-10): every op as a ratio to an in-run calibration
   op, the median of interleaved rounds, re-measured before it can breach. The check must go
   RED when it is fed a slowed op (the brief's mutation), end to end through `main`.
"""
from __future__ import annotations

import json
import math
from functools import partial
from pathlib import Path

import pytest

from tools import notebook_perf_budgets as pb
from tools import notebook_scale_benchmark as bench

REPO = Path(__file__).resolve().parents[1]


@pytest.fixture
def quiet_sink(monkeypatch):
    monkeypatch.setattr(bench, "_prepare_activity_sink", lambda: None)


# ── 1. the attachment tier ────────────────────────────────────────────────────

def test_an_attachment_tier_times_the_document_reads_and_every_check_passes(tmp_path):
    r = bench.run_tier(300, reps=1, warmup=0, paragraphs=1, work_dir=str(tmp_path), attachments=120)
    assert list(r["ops"]) == bench.TIMED_OPS + bench.ATTACHMENT_OPS
    assert r["attachments"] == 120 and r["attachment_pages"] == 120 * bench._PAGES_PER_DOC
    failed = [k for k, ok in r["correctness"].items() if not ok]
    assert failed == []
    # non-vacuity: the four attachment checks are really among them
    assert sum("document" in k for k in r["correctness"]) == 4


def test_a_tier_without_attachments_times_exactly_what_it_always_did(tmp_path):
    r = bench.run_tier(200, reps=1, warmup=0, paragraphs=1, work_dir=str(tmp_path))
    assert list(r["ops"]) == bench.TIMED_OPS and r["attachments"] == 0
    assert not any("document" in k for k in r["correctness"])


def test_CONTROL_a_document_search_that_shows_trash_turns_its_check_red(tmp_path, monkeypatch):
    """A fast wrong answer is not a pass: answer the trash-only marker with live hits and the
    'hides a trashed note's documents' check must notice."""
    from api.services.journal_two import document_search
    real = document_search.search_document_pages

    def leaky(user_id, q, *, limit=20, conn=None):
        if q == bench._DOC_TRASH_MARKER:
            q = bench._DOC_COMMON_MARKER
        return real(user_id, q, limit=limit, conn=conn)

    monkeypatch.setattr(document_search, "search_document_pages", leaky)
    r = bench.run_tier(300, reps=1, warmup=0, paragraphs=1, work_dir=str(tmp_path), attachments=120)
    assert r["correctness"]["document search hides a trashed note's documents"] is False


def test_the_route_connection_points_at_the_tier_only_for_the_call(tmp_path):
    from api.services import auth_db
    before = auth_db._DB_PATH
    bench.run_tier(200, reps=1, warmup=0, paragraphs=1, work_dir=str(tmp_path), attachments=60)
    assert auth_db._DB_PATH == before


# ── 1b. the connection model (clause 14d ruling, 2026-09-29) ─────────────────

def _count_production_opens(monkeypatch):
    from api.services import auth_db
    real = auth_db.get_connection
    opened = []

    def spy():
        c = real()
        # Record every statement this connection runs: a connection that is opened and then
        # never read from is the per-call model in name only (mutation M1).
        rec = {"path": auth_db._DB_PATH, "statements": 0}

        def traced(_sql):
            rec["statements"] += 1
        c.set_trace_callback(traced)
        opened.append(rec)
        return c
    monkeypatch.setattr(auth_db, "get_connection", spy)
    return opened


def test_per_call_opens_every_read_through_production_and_every_check_passes(tmp_path, monkeypatch):
    """The per-call model is only production's model if production's own opener runs, once per
    timed call, against the TIER's database -- and the answers must be the ones the shared
    model gives (every correctness check is computed from the per-call results)."""
    opened = _count_production_opens(monkeypatch)
    r = bench.run_tier(200, reps=2, warmup=1, paragraphs=1, work_dir=str(tmp_path),
                       connection="per-call")
    assert r["connection"] == "per-call"
    assert [k for k, ok in r["correctness"].items() if not ok] == []
    tier_opens = [o for o in opened if o["path"] and o["path"].endswith("bench.db")]
    # warmup 1 + reps 2 timed, plus the one traced pass: 4 opens per op, at least
    assert len(tier_opens) >= 4 * len(bench.TIMED_OPS)
    # ...and every one of them is where the read actually ran
    assert all(o["statements"] > 0 for o in tier_opens), "a per-call connection carried no read"


def test_the_shared_model_is_the_default_and_never_opens_a_connection_per_read(tmp_path, monkeypatch):
    opened = _count_production_opens(monkeypatch)
    r = bench.run_tier(200, reps=1, warmup=0, paragraphs=1, work_dir=str(tmp_path))
    assert r["connection"] == "shared"
    assert [o for o in opened if o["path"] and o["path"].endswith("bench.db")] == []


def test_an_unknown_connection_model_is_refused(tmp_path):
    with pytest.raises(ValueError):
        bench.run_tier(50, reps=1, warmup=0, paragraphs=1, work_dir=str(tmp_path),
                       connection="pooled")


def test_an_attachment_budget_holds_only_on_a_tier_that_carried_the_attachments():
    spec = {"tier": 1000, "attachments": 10000, "p95_ms_max": 100, "ops": ["x"]}
    ran_without = {"tiers": [{"n": 1000, "attachments": 0, "ops": {"x": {"p95_ms": 1.0}}}]}
    ran_with = {"tiers": [{"n": 1000, "attachments": 10000, "ops": {"x": {"p95_ms": 1.0}}}]}
    out = pb.check_search(ran_without, spec)
    assert len(out) == 1 and "needs 10,000 attachments" in out[0]
    assert pb.check_search(ran_with, spec) == []


# ── 2. the curve ──────────────────────────────────────────────────────────────

TIERS = [1000, 5000, 10000, 25000, 50000]
CURVE = {"tiers": TIERS, "max_slope": 1.1, "max_last_segment_slope": 1.3, "stat": "p50_ms"}


def _curve_report(**series):
    return {"tiers": [{"n": n, "ops": {op: {"p50_ms": f(n)} for op, f in series.items()}} for n in TIERS]}


def test_the_slope_is_the_log_log_least_squares_fit():
    assert math.isclose(pb._slope([(n, 0.002 * n) for n in TIERS]), 1.0, abs_tol=1e-9)
    assert math.isclose(pb._slope([(n, 1e-6 * n * n) for n in TIERS]), 2.0, abs_tol=1e-9)
    assert math.isclose(pb._slope([(n, 3.0) for n in TIERS]), 0.0, abs_tol=1e-9)


def test_a_super_linear_op_breaches_and_a_linear_one_does_not():
    rep = _curve_report(lin=lambda n: 0.002 * n, quad=lambda n: 1e-7 * n * n, flat=lambda n: 2.0)
    breaches, table = pb.check_curve(rep, CURVE, ["lin", "quad", "flat"])
    assert [b.split(":")[0] for b in breaches] == ["'quad'", "'quad'"], breaches
    assert math.isclose(table["lin"]["slope"], 1.0, abs_tol=1e-3)
    assert table["flat"]["slope"] == 0.0


def test_a_curve_that_bends_up_at_the_top_breaches_on_its_last_segment():
    # flat to 25k, then 3x at 50k: the fit is diluted, the last segment is not
    rep = _curve_report(bend=lambda n: 10.0 if n < 50000 else 30.0)
    breaches, table = pb.check_curve(rep, CURVE, ["bend"])
    assert table["bend"]["slope"] < 1.1                      # the fit alone would pass it
    assert any("last segment" in b for b in breaches), breaches


def test_an_op_missing_at_one_tier_or_a_tier_not_run_is_a_breach():
    rep = _curve_report(a=lambda n: 1.0)
    del rep["tiers"][2]["ops"]["a"]
    breaches, table = pb.check_curve(rep, CURVE, ["a"])
    assert breaches and "not measured at [10000]" in breaches[0] and table["a"]["slope"] is None
    rep2 = _curve_report(a=lambda n: 1.0)
    rep2["tiers"].pop()
    breaches2, _ = pb.check_curve(rep2, CURVE, ["a"])
    assert breaches2 and "were not run" in breaches2[0]
    with pytest.raises(pb.Unevaluable):
        pb.check_curve(_curve_report(a=lambda n: 1.0), CURVE, [])


def test_the_curve_tiers_are_the_briefs_five_and_the_budget_names_them():
    assert bench.CURVE_TIERS == (1000, 5000, 10000, 25000, 50000)
    budgets = json.loads(pb.DEFAULT_BUDGETS.read_text(encoding="utf-8"))
    curve = budgets["curve"]
    assert tuple(curve["tiers"]) == bench.CURVE_TIERS
    # "no super-linear curve": the fit bound is linear plus a stated noise allowance, never
    # raised past it to fit a reading (perf-budgets.md §7 says why 1.1 / 1.3)
    assert float(curve["max_slope"]) <= 1.1 and float(curve["max_last_segment_slope"]) <= 1.3
    assert curve["why"]


def test_main_curve_on_tiers_the_committed_curve_does_not_name_is_a_breach(tmp_path, capsys, quiet_sink):
    # With no thresholds file the committed budget's curve applies -- tiers 1k..50k -- and a
    # run over 100/200 notes measured none of them: a breach, never a pass.
    code = bench.main(["--curve", "--tiers", "100,200", "--reps", "1", "--warmup", "0",
                       "--paragraphs", "1", "--work-dir", str(tmp_path)])
    text = capsys.readouterr().out
    assert code == 2 and "were not run" in text


def test_main_curve_against_a_thresholds_file(tmp_path, capsys, quiet_sink):
    th = tmp_path / "th.json"
    th.write_text(json.dumps({
        "search": {"tier": 200, "p95_ms_max": 1e9, "ops": ["GET /notes q=common (list+count)"]},
        "curve": {"tiers": [100, 200], "max_slope": 1000, "max_last_segment_slope": 1000, "why": "t"},
    }), encoding="utf-8")
    code = bench.main(["--curve", "--tiers", "100,200", "--reps", "1", "--warmup", "0", "--paragraphs", "1",
                       "--work-dir", str(tmp_path), "--thresholds", str(th)])
    text = capsys.readouterr().out
    assert code == 0, text
    assert "=== Curve" in text and text.count(" slope ") >= len(bench.TIMED_OPS)
    th.write_text(json.dumps({
        "search": {"tier": 200, "p95_ms_max": 1e9, "ops": ["GET /notes q=common (list+count)"]},
        "curve": {"tiers": [100, 200], "max_slope": -1000, "max_last_segment_slope": 1000, "why": "t"},
    }), encoding="utf-8")
    code = bench.main(["--curve", "--tiers", "100,200", "--reps", "1", "--warmup", "0", "--paragraphs", "1",
                       "--work-dir", str(tmp_path), "--thresholds", str(th)])
    assert code == 2 and "BREACH [curve]" in capsys.readouterr().out


# ── 2b. D22 (controller, owner-delegated 2026-09-30): the curve's default connection model ────
#
# Standard 14's "no super-linear curve" clause reads the model production actually opens its
# notes-store connections under -- a fresh one per call (auth_db.get_connection), not the
# benchmark's own long-lived one. The bench/shared model -- what every curve reading up to and
# including PR #252 ran under -- is kept as a DIAGNOSTIC: reported beside the primary reading,
# its breach recorded, never hidden, and never gating.

_D22_TH = lambda max_slope=1000: {  # noqa: E731 -- a tiny fixture, not a public name
    "curve": {"tiers": [80, 150], "max_slope": max_slope, "max_last_segment_slope": 1000, "why": "t"},
}


def test_curve_defaults_to_per_call_and_the_bench_model_runs_as_a_diagnostic(tmp_path, capsys, quiet_sink):
    """A bare --curve (no --connection) gates clause 14d in the per-call model, and the bench
    model runs automatically beside it in the SAME report, reported and never gating."""
    th = tmp_path / "th.json"
    th.write_text(json.dumps(_D22_TH()), encoding="utf-8")
    out_json = tmp_path / "report.json"
    code = bench.main(["--curve", "--tiers", "80,150", "--reps", "1", "--warmup", "0", "--paragraphs", "1",
                       "--work-dir", str(tmp_path), "--thresholds", str(th), "--json", str(out_json)])
    text = capsys.readouterr().out
    assert code == 0, text
    report = json.loads(out_json.read_text(encoding="utf-8"))
    # the report NAMES which model it measured, in the machine-readable form and in prose
    assert report["meta"]["connection"] == "per-call"
    assert report["meta"]["connection_explicit"] is False
    assert report["meta"]["connection_diagnostic"] == "shared"
    assert "connection model: per-call" in text and "D22" in text
    # the bench model's own curve is IN THE SAME REPORT, beside the primary one -- not hidden
    assert "curve_diagnostic" in report and report["curve_diagnostic"]["connection"] == "shared"
    assert report["curve_diagnostic"]["breaches"] == []          # recorded either way; here: none
    assert "=== Curve DIAGNOSTIC (connection=shared" in text
    assert "diagnostic shared: 0 breach(es) recorded, not gating" in text


def test_the_bench_model_stays_explicitly_selectable_and_disables_the_diagnostic(tmp_path, capsys, quiet_sink):
    """`--connection shared`, given explicitly, is honored exactly as asked: ONLY that model
    runs (no automatic per-call diagnostic pass) -- the bench model is still selectable on its
    own, same as before D22."""
    th = tmp_path / "th.json"
    th.write_text(json.dumps(_D22_TH()), encoding="utf-8")
    out_json = tmp_path / "report.json"
    code = bench.main(["--curve", "--tiers", "80,150", "--reps", "1", "--warmup", "0", "--paragraphs", "1",
                       "--work-dir", str(tmp_path), "--thresholds", str(th), "--connection", "shared",
                       "--json", str(out_json)])
    text = capsys.readouterr().out
    assert code == 0, text
    report = json.loads(out_json.read_text(encoding="utf-8"))
    assert report["meta"]["connection"] == "shared"
    assert report["meta"]["connection_explicit"] is True
    assert report["meta"]["connection_diagnostic"] is None
    assert "curve_diagnostic" not in report
    assert "DIAGNOSTIC" not in text


def test_an_explicit_per_call_also_disables_the_automatic_diagnostic(tmp_path, capsys, quiet_sink):
    th = tmp_path / "th.json"
    th.write_text(json.dumps(_D22_TH()), encoding="utf-8")
    code = bench.main(["--curve", "--tiers", "80,150", "--reps", "1", "--warmup", "0", "--paragraphs", "1",
                       "--work-dir", str(tmp_path), "--thresholds", str(th), "--connection", "per-call"])
    text = capsys.readouterr().out
    assert code == 0, text
    assert "connection model: per-call (explicit)" in text
    assert "DIAGNOSTIC" not in text


def test_a_curve_breach_under_the_default_per_call_model_still_gates_and_the_diagnostic_still_runs(
        tmp_path, capsys, quiet_sink):
    """A defaulted (not explicit) run still GATES on the per-call model's own breach, and the
    bench-model diagnostic still runs and is reported even when the primary reading already
    breached -- its breach (if any) is recorded, never gating, never silently skipped."""
    th = tmp_path / "th.json"
    th.write_text(json.dumps(_D22_TH(max_slope=-1000)), encoding="utf-8")   # impossible: forces a breach
    code = bench.main(["--curve", "--tiers", "80,150", "--reps", "1", "--warmup", "0", "--paragraphs", "1",
                       "--work-dir", str(tmp_path), "--thresholds", str(th)])
    text = capsys.readouterr().out
    assert code == 2 and "BREACH [curve]" in text
    assert "connection model: per-call" in text
    assert "=== Curve DIAGNOSTIC (connection=shared" in text          # still ran, still reported


# ── 3. the ratio check (R-10) ─────────────────────────────────────────────────

def test_the_ratio_line_is_the_budget_line_at_the_reference_boxs_speed():
    spec = {"line_ms": 100, "calibration_ref_ms": 20, "op_line_ms": {"t": 150}}
    assert pb.ratio_line(spec) == 5.0
    assert pb.ratio_line(spec, "t") == 7.5 and pb.ratio_line(spec, "other") == 5.0
    for bad in ({"line_ms": 100}, {"line_ms": 0, "calibration_ref_ms": 20},
                {"line_ms": 100, "calibration_ref_ms": -1}):
        with pytest.raises(pb.Unevaluable):
            pb.ratio_line(bad)


class _Scripted:
    """A `measure` stand-in: each call on a function returns that function's next scripted p50."""

    def __init__(self, script):
        self.script = {k: list(v) for k, v in script.items()}

    def __call__(self, fn, warmup, reps):
        return {"p50_ms": self.script[fn].pop(0)}, None


def _calib():
    return None


def _op():
    return None


def test_a_ratio_is_the_median_of_interleaved_rounds_and_is_re_measured_only_over_its_line():
    m = _Scripted({_calib: [10, 10, 50], _op: [5, 90, 6]})     # one round a burst split
    out = bench.measure_ratios({"op": _op}, {"op": 2.0}, _calib, rounds=3, reps=1, warmup=0, measure=m)
    assert out["op"]["rounds"] == [0.5, 9.0, 0.12] and out["op"]["median"] == 0.5
    assert "remeasure" not in out["op"]
    m2 = _Scripted({_calib: [10, 10, 10, 10, 10, 10], _op: [30, 30, 30, 5, 5, 5]})
    out2 = bench.measure_ratios({"op": _op}, {"op": 2.0}, _calib, rounds=3, reps=1, warmup=0, measure=m2)
    assert out2["op"]["median"] == 3.0 and out2["op"]["remeasure"]["median"] == 0.5


def _ratio_report(median, again=None, op="op"):
    r = {"median": median, "rounds": [median]}
    if again is not None:
        r["remeasure"] = {"median": again, "rounds": [again]}
    return {"tiers": [{"n": 10000, "ratio": {"ops": {op: r}}}]}


RSPEC = {"tier": 10000, "line_ms": 100, "calibration_ref_ms": 20, "rounds": 3, "reps": 3, "ops": ["op"]}


def test_a_ratio_breaches_only_when_its_re_measure_reproduces():
    assert pb.check_ratio(_ratio_report(4.9), RSPEC) == []
    assert pb.check_ratio(_ratio_report(6.0, again=4.0), RSPEC) == []
    assert pb.ratio_unreproduced_notes(_ratio_report(6.0, again=4.0), RSPEC)
    out = pb.check_ratio(_ratio_report(6.0, again=5.5), RSPEC)
    assert len(out) == 1 and "median ratio 6.000 >= line 5.000" in out[0] and "re-measured 5.500" in out[0]


def test_an_op_or_tier_without_a_ratio_reading_is_a_breach():
    assert "no ratio measured" in pb.check_ratio(_ratio_report(1.0, op="other"), RSPEC)[0]
    assert "was not run" in pb.check_ratio({"tiers": []}, RSPEC)[0]
    assert "no ratio reading" in pb.check_ratio({"tiers": [{"n": 10000, "ops": {}}]}, RSPEC)[0]
    with pytest.raises(pb.Unevaluable):
        pb.check_ratio(_ratio_report(1.0), dict(RSPEC, ops=[]))
    with pytest.raises(pb.Unevaluable):
        pb.check_ratio(_ratio_report(1.0), dict(RSPEC, op_line_ms={"typo": 150}))


_SLOW_OP = "GET /notes q=rare (list+count)"


def _calibration_p50(tmp_path) -> float:
    """This box's calibration p50 now, so the end-to-end rail's line is relative to it."""
    conn, op = bench._build_calibration(str(tmp_path))
    try:
        st, _ = bench._measure(op, 1, 5)
        return st["p50_ms"]
    finally:
        conn.close()


def test_the_ci_ratio_check_goes_RED_on_a_slowed_op_and_green_without_it(tmp_path, capsys, quiet_sink):
    """The brief's mutation, end to end through `main`: feed the check a slowed op -> red.
    The line is 100 ms at THIS box's calibration speed, and the op is slowed by 300 ms, so the
    slowed reading sits ~3x over it while the unslowed one sits far under -- on any machine."""
    ref = _calibration_p50(tmp_path)
    th = tmp_path / "th.json"
    th.write_text(json.dumps({"ratio_t": {"tier": 200, "line_ms": 100, "calibration_ref_ms": ref,
                                          "rounds": 2, "reps": 1, "ops": [_SLOW_OP]}}), encoding="utf-8")
    base = ["--tiers", "200", "--reps", "1", "--warmup", "0", "--paragraphs", "1",
            "--work-dir", str(tmp_path), "--thresholds", str(th), "--ratio", "ratio_t"]
    assert bench.main(base) == 0, capsys.readouterr().out
    capsys.readouterr()
    code = bench.main(base + ["--slow-op", f"{_SLOW_OP}=300"])
    text = capsys.readouterr().out
    assert code == 2, text
    assert f"BREACH [ratio_t] '{_SLOW_OP}' at 200 notes: median ratio" in text


def test_the_committed_ratio_budget_covers_every_ci_budget_and_names_its_reference():
    budgets = json.loads(pb.DEFAULT_BUDGETS.read_text(encoding="utf-8"))
    spec = budgets["ratio_ci"]
    assert int(spec["tier"]) == 10000
    assert float(spec["calibration_ref_ms"]) > 0 and spec["calibration_ref"], "the reference must say where it was read"
    enforced = set(spec["ops"])
    for key in ("search_ci", "reads_ci", "tasks_ci"):
        assert set(budgets[key]["ops"]) | set(budgets[key].get("informational", [])) <= enforced, key
    assert enforced <= set(bench.TIMED_OPS)
    # the same MILLISECOND values as the p95 lines it replaces in CI -- but held to a p50
    # ratio (each round compares p50s; review M-2), so a tail-only regression passes CI on
    # purpose: a round p95 on a shared runner would flake a promotion gate. The tail is the
    # local 50k gate's.
    assert float(spec["line_ms"]) == float(budgets["search_ci"]["p95_ms_max"])
    for op, ms in (spec.get("op_line_ms") or {}).items():
        assert op in budgets["tasks_ci"]["ops"] and float(ms) == float(budgets["tasks_ci"]["p95_ms_max"])


def test_the_attachment_budget_is_the_10k_tier_at_the_50k_gate():
    budgets = json.loads(pb.DEFAULT_BUDGETS.read_text(encoding="utf-8"))
    spec = budgets["attachments"]
    assert int(spec["tier"]) == 50000 and int(spec["attachments"]) == 10000
    assert float(spec["p95_ms_max"]) == 100
    assert set(spec["ops"]) == set(bench.ATTACHMENT_OPS)


# ── the workflows (R-10: bytes gate now; the ratio check is promoted only after red + green) ──

def _workflow(name):
    import yaml
    return yaml.safe_load((REPO / ".github" / "workflows" / name).read_text(encoding="utf-8"))


def test_the_bytes_workflow_gates_promotion_and_runs_the_byte_check():
    from tools import promotion_gate as pg
    gating, unclassified = pg.read_workflow_dir(REPO)
    assert gating.get("notebook bytes") == "yes", sorted(gating)
    assert "notebook-bytes.yml" not in unclassified
    runs = [" ".join(str(s.get("run", "")).split())
            for job in _workflow("notebook-bytes.yml")["jobs"].values() for s in job["steps"]]
    assert any("notebook_perf_budgets.py --dist app/dist" in r for r in runs), runs
    assert not any("notebook_scale_benchmark.py" in r for r in runs), "a timing step in the gating workflow"


def _promotion_evidence_missing(text: str) -> list[str]:
    """What a `# promotion-gate: yes` header lacks: it must name a run SEEN RED and a run SEEN
    GREEN (ruling D-A2), with both run URLs, and say how a red is recovered. [] = complete."""
    head = "\n".join(text.splitlines()[:40])
    missing = []
    if "SEEN RED" not in head or "SEEN GREEN" not in head:
        missing.append("SEEN RED / SEEN GREEN")
    if head.count("actions/runs/") < 2:
        missing.append("the red and the green run URLs")
    if "gh run rerun" not in head:
        missing.append("the re-run recovery")
    return missing


@pytest.mark.parametrize("wf, name", [("notebook-latency.yml", "notebook latency"),
                                      ("notebook-bytes.yml", "notebook bytes")])
def test_a_promoted_notebook_workflow_carries_its_red_and_green_runs_and_its_recovery(wf, name):
    """Review M-3: the bytes gate was promoted with no SEEN RED run on record. Both gating
    Notebook workflows now carry the evidence in their headers, and the recovery."""
    from tools import promotion_gate as pg
    text = (REPO / ".github" / "workflows" / wf).read_text(encoding="utf-8")
    gating, _ = pg.read_workflow_dir(REPO)
    assert gating.get(name) in ("yes", "no"), sorted(gating)
    if gating.get(name) == "yes":
        assert _promotion_evidence_missing(text) == [], wf


def test_the_evidence_check_can_fail():
    """CONTROL: a promoted header with no runs, or one run, or no recovery, is refused."""
    assert _promotion_evidence_missing("# promotion-gate: yes -- because\nname: x\n")
    one = "# promotion-gate: yes\n# SEEN RED https://x/actions/runs/1\n# SEEN GREEN (no url)\n# gh run rerun 1\n"
    assert _promotion_evidence_missing(one) == ["the red and the green run URLs"]
    no_rerun = "# SEEN RED https://x/actions/runs/1\n# SEEN GREEN https://x/actions/runs/2\n"
    assert _promotion_evidence_missing(no_rerun) == ["the re-run recovery"]


def test_the_latency_workflow_times_the_10k_tier_as_ratios():
    runs = [" ".join(str(s.get("run", "")).split())
            for job in _workflow("notebook-latency.yml")["jobs"].values() for s in job["steps"]]
    bench_cmd = [r for r in runs if "notebook_scale_benchmark.py" in r]
    assert len(bench_cmd) == 1 and "--ratio ratio_ci" in bench_cmd[0], runs
    assert "--tiers 10000" in bench_cmd[0] or "--tiers 1000,10000" in bench_cmd[0], bench_cmd


def test_a_two_member_tier_times_the_first_members_reads_and_its_checks_hold(tmp_path):
    """Review M-4: the tier the benchmark can now seed -- a second member with a library of
    the same size and the same search terms. The first member's correctness checks (which
    count only that member's notes) must still hold, so the other's notes reached no read."""
    one = bench.run_tier(300, reps=1, warmup=0, paragraphs=1, work_dir=str(tmp_path))
    two = bench.run_tier(300, reps=1, warmup=0, paragraphs=1, work_dir=str(tmp_path), members=2)
    assert one["members"] == 1 and two["members"] == 2
    assert two["correctness"] == one["correctness"]
    assert two["notes_all_members"] == 2 * one["notes_all_members"] == 600   # the other member is there
    assert set(two["ops"]) == set(one["ops"])
