"""tools/ci_cost_report.py: offline from a saved snapshot. Nothing here calls GitHub."""
from __future__ import annotations

import datetime as dt
import json
import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import ci_cost_report as ccr  # noqa: E402

FIXTURE = ROOT / "tests" / "fixtures" / "ci_cost_snapshot.json"
UTC = dt.timezone.utc
NOW = dt.datetime(2026, 11, 4, 12, tzinfo=UTC)
MONTH = dt.datetime(2026, 11, 1, tzinfo=UTC)


@pytest.fixture()
def snap() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def job(**kw) -> dict:
    base = {"conclusion": "success", "runner_name": "r", "labels": ["ubuntu-latest"], "status": "completed",
            "started_at": "2026-11-01T00:00:00Z", "completed_at": "2026-11-01T00:00:01Z"}
    return {**base, **kw}


def test_one_second_rounds_up_to_a_minute():
    assert ccr.billed_minutes(job()) == 1


def test_exact_minutes_do_not_round_up_again():
    assert ccr.billed_minutes(job(completed_at="2026-11-01T00:10:00Z")) == 10
    assert ccr.billed_minutes(job(completed_at="2026-11-01T00:10:01Z")) == 11


def test_skipped_and_never_started_cost_nothing():
    assert ccr.billed_minutes(job(conclusion="skipped")) == 0
    assert ccr.billed_minutes(job(runner_name="", conclusion="failure")) == 0


def test_backwards_timestamps_cost_nothing():
    assert ccr.billed_minutes(job(started_at="2026-11-01T01:00:00Z")) == 0


@pytest.mark.parametrize("labels,rate", [
    (["ubuntu-latest"], 0.006), (["windows-latest"], 0.010), (["macos-14"], 0.062), (["ubuntu-24.04-arm"], 0.005),
])
def test_hosted_rates(labels, rate):
    assert ccr.rate_for({"labels": labels}) == rate


def test_self_hosted_is_free_until_the_postponed_charge():
    row = {"labels": ["self-hosted", "linux"]}
    assert ccr.rate_for(row) == 0.0
    assert ccr.rate_for(row, 0.002) == 0.002


def test_custom_runner_group_counts_as_self_hosted():
    assert ccr.is_self_hosted({"labels": ["vps"], "runner_group_name": "Default"})
    assert not ccr.is_self_hosted({"labels": ["ubuntu-latest"], "runner_group_name": "GitHub Actions"})


def test_report_totals_split_hosted_and_self_hosted(snap):
    result = ccr.analyze(snap, now=NOW)
    # 11 + 10 agent ci, 9 gate = 30 hosted; 15 self-hosted; the skipped and stopped jobs add nothing
    assert result["by_runner"]["hosted"]["minutes"] == 30
    assert result["by_runner"]["self-hosted"]["minutes"] == 15
    assert result["total_usd"] == pytest.approx(0.18)
    assert ccr.analyze(snap, 0.002, NOW)["total_usd"] == pytest.approx(0.21)
    assert not result["sampled"]


def test_matrix_legs_share_one_job_line(snap):
    assert "agent ci / shard (shard N/N)" in ccr.analyze(snap, now=NOW)["by_job"]


def test_sample_scales_each_stratum_and_is_labelled():
    runs = [{"id": i, "name": "w", "event": "push", "conclusion": "success", "status": "completed"} for i in range(1, 5)]
    snapshot = {"runs": runs, "jobs_by_run": {"1": [job(completed_at="2026-11-01T00:10:00Z")]}}
    result = ccr.analyze(snapshot, now=NOW)
    assert result["total_minutes"] == 40
    assert result["sampled"]
    assert "ESTIMATED" in ccr.render({}, result, ccr.forecast(result, NOW, None, MONTH), [])


def test_runs_with_no_job_data_are_declared_not_silently_zero():
    runs = [{"id": 1, "name": "w", "event": "push", "conclusion": "success", "status": "completed"}]
    result = ccr.analyze({"runs": runs, "jobs_by_run": {}}, now=NOW)
    assert result["uncovered_runs"] == 1
    assert "NOT in these totals" in ccr.render({}, result, ccr.forecast(result, NOW, None, MONTH), [])


def test_forecast_is_spend_plus_rate_times_time_left():
    result = {"points": [(MONTH + dt.timedelta(days=1), 100, 3.0)]}
    cast = ccr.forecast(result, MONTH + dt.timedelta(days=3), None, MONTH)
    assert cast["gross"] == pytest.approx(30.0)
    assert cast["basis_days"] == pytest.approx(3.0)
    assert not cast["low_confidence"]


def test_rate_from_ignores_days_before_the_change():
    points = [(MONTH + dt.timedelta(days=1), 1000, 300.0), (MONTH + dt.timedelta(days=9), 10, 1.0)]
    change = MONTH + dt.timedelta(days=8)
    cast = ccr.forecast({"points": points}, MONTH + dt.timedelta(days=10), change, MONTH)
    assert cast["rate_per_day"] == pytest.approx(0.5)
    assert cast["gross"] == pytest.approx(301 + 0.5 * 20)


def test_short_window_is_low_confidence():
    change = NOW - dt.timedelta(hours=2)
    assert ccr.forecast({"points": []}, NOW, change, MONTH)["low_confidence"]


def test_allowance_comes_off_the_net_only():
    cast = ccr.forecast({"points": [(MONTH, 1, 5.0)]}, MONTH + dt.timedelta(days=30), None, MONTH, 12.0)
    assert cast["gross"] == pytest.approx(5.0)
    assert cast["net"] == 0.0


def alerts_for(net: float, spent: float, queued: list | None = None, stopped: int = 0) -> list[str]:
    cast = {"net": net, "spent_net": spent, "low_confidence": False}
    return ccr.alerts({"queued_self": queued or [], "stopped_jobs": stopped}, cast, 100, 0.75, 30)


def test_threshold_is_75_percent_of_100_by_default():
    assert alerts_for(74.99, 0) == []
    assert any("forecast" in line for line in alerts_for(75.0, 0))
    assert any("spend" in line for line in alerts_for(0, 75.0))


def test_self_hosted_queue_alert_uses_the_limit():
    assert alerts_for(0, 0, [{"workflow": "w", "job": "j", "minutes": 30.0}]) == []
    lines = alerts_for(0, 0, [{"workflow": "w", "job": "j", "minutes": 31.0}])
    assert "self-hosted job queued" in lines[0]


def test_fixture_flags_a_queued_self_hosted_job_and_a_budget_stop(snap, capsys):
    code = ccr.main(["report", "--snapshot", str(FIXTURE), "--queue-alert-min", "60", "--exit-nonzero-on-alert"])
    out = capsys.readouterr().out
    assert code == 1
    assert "self-hosted job queued 600 min" in out
    assert "never got a runner" in out
    assert "Not the invoice" in out


def test_quiet_fixture_prints_ok_and_exits_zero(snap, tmp_path, capsys):
    snap["runs"] = snap["runs"][:2]
    snap["jobs_by_run"] = {key: value for key, value in snap["jobs_by_run"].items() if key in ("1", "3")}
    path = tmp_path / "s.json"
    path.write_text(json.dumps(snap), encoding="utf-8")
    assert ccr.main(["report", "--snapshot", str(path), "--exit-nonzero-on-alert"]) == 0
    assert "OK: no alert" in capsys.readouterr().out


def test_old_budget_stop_stops_alerting_but_stays_recorded(snap):
    result = ccr.analyze(snap, now=NOW + dt.timedelta(days=10))
    assert result["stopped_jobs"] == 0
    assert result["first_stop"] == "2026-11-04T01:43:50Z"


def test_artifact_month_cost_nets_the_plan_allowance(snap):
    assert ccr.artifact_month_usd(snap["storage"]) == pytest.approx(5.0)
    assert ccr.artifact_month_usd(snap["storage"], "pro") == pytest.approx(4.875)


class FakeGh:
    """Records every path. Serves 2,500 runs in a day so the 1,000-per-query cap has to be split."""

    def __init__(self) -> None:
        self.calls: list[str] = []

    def __call__(self, path: str):
        self.calls.append(path)
        if path == "rate_limit":
            return {"resources": {"core": {"remaining": 5000}}}
        if "/jobs?" in path:
            return {"total_count": 1, "jobs": [{"id": 1, "name": "j"}]}
        if "/cache/usage" in path:
            return {"active_caches_size_in_bytes": 1}
        return self.runs(path)

    @staticmethod
    def runs(path: str):
        window = path.split("created=")[1].split("&")[0]
        start, end = (ccr.parse_ts(part) for part in window.split(".."))
        base = dt.datetime(2026, 11, 1, tzinfo=UTC)
        ids = [i for i in range(2500) if start <= base + dt.timedelta(seconds=i * 30) <= end]
        page = int(path.split("page=")[-1])
        chunk = ids[(page - 1) * 100:page * 100]
        return {"total_count": len(ids), "workflow_runs": [
            {"id": i, "name": "w", "event": "push", "status": "completed", "conclusion": "success",
             "created_at": "2026-11-01T00:00:00Z"} for i in chunk]}


def test_a_window_over_the_api_cap_is_split_not_truncated():
    gh = FakeGh()
    rows = ccr.list_runs(gh, "o/r", dt.datetime(2026, 11, 1, tzinfo=UTC), dt.datetime(2026, 11, 2, tzinfo=UTC))
    assert len({row["id"] for row in rows}) == 2500


def test_sampling_keeps_the_census_workflows_whole():
    runs = [{"id": i, "name": "w", "event": "push", "conclusion": "success", "status": "completed",
             "created_at": str(i).zfill(3)} for i in range(30)]
    runs += [{"id": 100 + i, "name": "big", "event": "push", "conclusion": "success", "status": "completed",
              "created_at": str(i).zfill(3)} for i in range(5)]
    chosen = ccr.choose_sample(runs, 10, {"big"})
    assert sum(row["name"] == "big" for row in chosen) == 5
    assert sum(row["name"] == "w" for row in chosen) == 3


def test_fetch_stops_at_the_reserve_and_says_so():
    gh = FakeGh()

    def low(path: str):
        return {"resources": {"core": {"remaining": 10}}} if path == "rate_limit" else gh(path)

    since = dt.datetime(2026, 11, 1, tzinfo=UTC)
    snapshot = ccr.fetch_snapshot(low, "o/r", since, since + dt.timedelta(hours=1), reserve=1500)
    assert snapshot["stopped_early"]
    assert snapshot["jobs_by_run"] == {}


def test_every_call_is_a_get(monkeypatch):
    seen = {}

    class Done:
        returncode = 0
        stdout = "{}"
        stderr = ""

    def fake_run(argv, **_):
        seen["argv"] = argv
        return Done()

    monkeypatch.setattr(ccr.subprocess, "run", fake_run)
    ccr.gh_api("rate_limit")
    assert seen["argv"][:4] == ["gh", "api", "--method", "GET"]


def test_resume_reuses_unchanged_runs():
    gh = FakeGh()
    since = dt.datetime(2026, 11, 1, tzinfo=UTC)
    until = since + dt.timedelta(minutes=2)
    first = ccr.fetch_snapshot(gh, "o/r", since, until)
    gh.calls.clear()
    again = ccr.fetch_snapshot(gh, "o/r", since, until, prior=first)
    assert not [call for call in gh.calls if "/jobs?" in call]
    assert again["jobs_by_run"] == first["jobs_by_run"]


def test_invoice_compare_reads_the_usage_export():
    billing = {"usageItems": [
        {"product": "Actions", "date": "2026-11-02T00:00:00Z", "grossAmount": 10.0, "netAmount": 8.0},
        {"product": "Actions", "date": "2026-10-02T00:00:00Z", "grossAmount": 99.0, "netAmount": 99.0},
        {"product": "Copilot", "date": "2026-11-02T00:00:00Z", "grossAmount": 5.0, "netAmount": 5.0},
    ]}
    line = ccr.compare_invoice(billing, {"total_usd": 15.0}, 2026, 11)
    assert "gross $10.00" in line
    assert "1.50" in line
