"""tools/ci_cost_model.py under AUDIT's 11-06 rulings: money and queue arithmetic on small hand-checked inputs."""
from __future__ import annotations

import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import ci_cost_gates as gates  # noqa: E402
import ci_cost_model as model  # noqa: E402
import ci_cost_steps as steps  # noqa: E402

UNIT = {"heavy": 60.0, "gate_whole": 9.0, "gate_split": 6.0, "verdict": 1.0, "promote": 2.0, "rails_hosted": 6.0,
        "rails_movable": 9.0, "clock_parity": 0.0, "agent_run": 60.0, "pr_rails_per_gate": 40.0, "agent_min_per_push": 50.0}
DAY = model.Day(n_pr=10.0, n_direct=2.0, a_batch=9.0, a_solo=1.0, agent_pushes=0.0)


def test_only_agent_batchable_prs_share_a_gate():
    assert DAY.gates(3.0) == 10 + 2 + 1 + 3
    assert DAY.gates(1.0) == 22
    assert DAY.heavy_candidates(3.0) == 4


def test_direct_pushes_get_no_candidate_run_and_prs_do():
    with_pr = model.month_cost("B1", model.Day(1, 0, 0, 0, 0), UNIT)
    direct = model.month_cost("B1", model.Day(0, 1, 0, 0, 0), UNIT)
    assert with_pr["hosted_min"] - direct["hosted_min"] == pytest.approx(6.0 * 30)


def test_vps_carries_gates_candidates_and_movable_rails():
    row = model.month_cost("B1", DAY, UNIT, 3.0, gate_min=20.0)
    assert row["vps_min"] == pytest.approx(((16 + 4) * 20 + (16 + 4 + 10) * 9) * 30)


def test_hosted_stays_for_gate_verdict_promote_and_unmovable_rails():
    row = model.month_cost("B1", DAY, UNIT, 3.0)
    expected = (16 * (6 + 1 + 2) + (16 + 4 + 10) * 6) * 30 + model.fixed_hosted_month(UNIT)
    assert row["hosted_min"] == pytest.approx(expected)


def test_watcher_is_in_the_fixed_hosted_minutes():
    assert model.fixed_hosted_month(UNIT, 27.0) - model.fixed_hosted_month(UNIT, 14.0) == pytest.approx(13 * model.WEEKDAYS)


def test_terms_only_change_the_vps_line():
    one = model.month_cost("B1", DAY, UNIT, 3.0, "1-month")
    long = model.month_cost("B1", DAY, UNIT, 3.0, "24-month")
    assert one["total"] - long["total"] == pytest.approx((52.00 - 39.79) * model.EUR_USD)


def test_two_vps_cost_twice_one():
    assert model.month_cost("B2", DAY, UNIT)["vps_usd"] == 2 * model.month_cost("B1", DAY, UNIT)["vps_usd"]


def test_postponed_charge_prices_every_self_hosted_minute():
    row = model.month_cost("B1", DAY, UNIT, self_hosted_rate=0.002)
    assert row["surcharge"] == pytest.approx(row["self_min"] * 0.002)


def test_allowance_never_makes_hosted_negative():
    assert model.month_cost("B1", model.Day(0, 0, 0, 0, 0), UNIT)["net_hosted"] == 0.0


def test_gate_only_arrivals_queue_serially():
    result = model.simulate([[1.0, "non-agent-pr"], [1.0, "non-agent-pr"], [1.0, "non-agent-direct"]], 20.0)
    assert result["gates"] == 3
    assert result["wait_max"] == pytest.approx(40, abs=0.5)


def test_agent_pr_runs_a_candidate_then_a_gate():
    result = model.simulate([[1.0, "agent-solo"]], 20.0)
    assert (result["candidates"], result["gates"]) == (1, 1)
    assert result["busy_hours"] == pytest.approx(40 / 60)


def test_three_batchable_prs_share_one_candidate_and_gate_and_a_fourth_does_not():
    arrivals = [[1.0, "agent-batchable"] for _ in range(4)]
    result = model.simulate(arrivals, 20.0, hold=30.0)
    assert (result["candidates"], result["gates"]) == (2, 2)


def test_solo_prs_are_never_batched():
    result = model.simulate([[1.0, "agent-solo"] for _ in range(3)], 20.0, hold=30.0)
    assert result["gates"] == 3


def test_two_servers_take_two_at_once():
    assert model.simulate([[1.0, "non-agent-pr"], [1.0, "non-agent-pr"]], 20.0, servers=2)["wait_max"] == 0


def test_over_45_counts_gate_runs_only():
    arrivals = [[1.0, "non-agent-pr"] for _ in range(4)]
    assert model.simulate(arrivals, 20.0)["over_45"] == 1


def test_limit_lands_on_the_target():
    day = model.Day(1.0, 0.0, 0.0, 0.0, 0.0)
    scale = model.limit_scale(day, UNIT, 3.0, "24-month")
    cost = model.month_cost("B1", model.Day(scale, 0, 0, 0, 0), UNIT, 3.0, "24-month")
    assert cost["total"] == pytest.approx(200.0, abs=0.01)


def test_saved_inputs_still_produce_every_scenario():
    results = model.run()
    assert set(results["months"]) == set(model.MONTHS)
    assert results["replay_k"] <= 3.0


@pytest.mark.parametrize("subject,files,kind", [
    ("Merge pull request #1 from o/agent/pl/x", [], "agent-batchable"),
    ("Merge pull request #2 from o/agent/pl/spend-y", [], "agent-solo"),
    ("Merge pull request #3 from o/agent/fix/z", [".github/workflows/agent-ci.yml"], "agent-solo"),
    ("Merge pull request #4 from o/feat/pine", [], "non-agent-pr"),
    ("feat(chart-iq): something", [], "non-agent-direct"),
])
def test_gate_classification(subject, files, kind):
    assert gates.classify({"subject": subject, "files": files, "parents": []}) == kind


def test_gate_step_split_re_rounds_each_run():
    job = {"name": "deploy-correctness checks + Agent server tests", "conclusion": "success",
           "started_at": "2026-11-05T00:00:00Z", "completed_at": "2026-11-05T00:08:30Z",
           "steps": [{"name": "UCT Agent server tests (production dependency set)",
                      "started_at": "2026-11-05T00:04:00Z", "completed_at": "2026-11-05T00:06:40Z"}]}
    row = steps.rerounded_gate([job])
    assert (row["before"], row["after"]) == (9, 6)


def test_no_eligible_rails_share_a_trigger_shape_today():
    assert steps.trigger_groups(ROOT)["any_identical"] is False


import ci_cost_hosted as hosted  # noqa: E402


def test_coalescing_covers_every_push_with_fewer_runs():
    pushes = [0.0, 0.1, 0.2, 2.0]           # hours
    every = hosted.coalesce(pushes, 0.0, 20.0)
    hourly = hosted.coalesce(pushes, 60.0, 20.0)
    assert every["runs"] == 3              # the first run is busy for 20 min, so pushes 2 and 3 share the next
    assert hourly["runs"] == 3
    assert hosted.coalesce(pushes, 120.0, 20.0)["runs"] == 2


def test_reuse_needs_no_other_push_inside_the_window():
    days = {"2026-11-01": [[1.0, "non-agent-pr"], [1.2, "agent-batchable"], [5.0, "agent-solo"]]}
    assert hosted.reuse_rate(days, 30.0) == 0.5
    assert hosted.reuse_rate(days, 5.0) == 1.0


def test_hosted_only_cannot_reach_200_even_with_no_gates():
    results = hosted.run()
    assert results["rows"]["normal"]["floor: no gates at all"]["total"] > 190
    assert min(row["total"] for row in results["rows"]["nov5"].values()) > hosted.TARGET
