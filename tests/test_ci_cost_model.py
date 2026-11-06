"""tools/ci_cost_model.py: the queue replay and the money arithmetic, on small hand-checked inputs."""
from __future__ import annotations

import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import ci_cost_model as model  # noqa: E402

UNIT = {"heavy": 60.0, "gate_job": 9.0, "verdict": 1.0, "gate_total": 70.0, "split_saving": 3.0}
DAY = {"gates": 10.0, "agent_runs": 20.0, "agent_min": 1000.0, "rails_min": 100.0, "other_min": 300.0,
       "promote_min": 20.0, "pr_share": 0.7}
PROFILE = {"normal": DAY, "busy": DAY}
MONTH = {"normal": 30, "busy": 0}


def test_today_prices_every_minute_as_hosted():
    row = model.month_cost("A today after #877", MONTH, PROFILE, UNIT, False, 20.0, 0.0)
    assert row["hosted"] == (700 + 20 + 100 + 300 + 1000) * 30
    assert row["net_hosted"] == pytest.approx(row["hosted"] * 0.006 - 12)
    assert row["vps_usd"] == 0.0


def test_allowance_never_makes_hosted_negative():
    quiet = {**DAY, "gates": 0.0, "agent_min": 0.0, "rails_min": 0.0, "other_min": 0.0, "promote_min": 0.0}
    row = model.month_cost("A today after #877", MONTH, {"normal": quiet, "busy": quiet}, UNIT, False, 20.0, 0.0)
    assert row["net_hosted"] == 0.0


def test_split_moves_three_minutes_a_gate_off_hosted():
    whole = model.day_cost("B(b) PC+VPS gate only", DAY, UNIT, False, 20.0)
    split = model.day_cost("B(b) PC+VPS gate only", DAY, UNIT, True, 20.0)
    assert whole["hosted"] - split["hosted"] == pytest.approx(30.0)


def test_pre_merge_check_doubles_vps_work_and_nothing_else():
    gate_only = model.day_cost("B(b) PC+VPS gate only", DAY, UNIT, False, 20.0)
    pre_merge = model.day_cost("B(a) PC+VPS pre-merge", DAY, UNIT, False, 20.0)
    assert pre_merge["vps_min"] == 2 * gate_only["vps_min"] == 400
    assert pre_merge["hosted"] == gate_only["hosted"]


def test_postponed_charge_prices_every_self_hosted_minute():
    row = model.month_cost("B(b) PC+VPS gate only", MONTH, PROFILE, UNIT, False, 20.0, 0.0, self_hosted_rate=0.002)
    assert row["surcharge"] == pytest.approx(row["self_min"] * 0.002)
    assert row["total"] > model.month_cost("B(b) PC+VPS gate only", MONTH, PROFILE, UNIT, False, 20.0, 0.0)["total"]


def test_outage_with_manual_fallback_adds_hosted_heavy_minutes():
    calm = model.month_cost("B(b) PC+VPS gate only", MONTH, PROFILE, UNIT, False, 20.0, 0.0)
    down = model.month_cost("B(b) PC+VPS gate only", MONTH, PROFILE, UNIT, False, 20.0, 0.0, outage=True)
    assert down["hosted"] - calm["hosted"] == pytest.approx(60 * 10 * model.OUTAGE_DAYS)


def test_serial_queue_waits_for_the_job_ahead():
    result = model.simulate([1.0, 1.0, 1.0], 20.0)
    assert result["wait_max"] == 40
    assert result["wait_p50"] == 20


def test_two_servers_take_two_at_once():
    assert model.simulate([1.0, 1.0], 20.0, servers=2)["wait_max"] == 0


def test_pre_merge_check_puts_each_gate_behind_its_own_check():
    result = model.simulate([1.0], 20.0, premerge=True)
    assert result["jobs"] == 2
    assert result["busy_hours"] == pytest.approx(40 / 60)
    assert result["wait_max"] == 0


def test_a_load_over_24_hours_cannot_drain_in_a_day():
    arrivals = [hour / 2 for hour in range(48)]
    assert model.simulate(arrivals, 20.0, premerge=True)["drained_hours"] > 24


def test_gates_at_budget_lands_on_the_budget():
    gates = model.gates_at_budget("B(b) PC+VPS gate only", PROFILE, UNIT, True, 0.0, 0.7)
    ratio = gates / DAY["gates"]
    day = {**DAY, "gates": gates, "agent_runs": 20 * ratio, "agent_min": 1000 * ratio, "rails_min": 100 * ratio,
           "promote_min": 20 * ratio}
    cost = model.month_cost("B(b) PC+VPS gate only", {"d": 30}, {"d": day}, UNIT, True, 20.0, 0.0, levers=0.7)
    assert cost["total"] == pytest.approx(100.0, abs=0.01)


def test_saved_inputs_still_produce_every_scenario():
    results = model.run()
    assert set(results["months"]) == set(model.MONTHS)
    for rows in results["months"].values():
        assert rows["A today after #877"]["base"]["total"] > 0
