"""W2-A2 cost follow-up — tools/agent_v2_cost_measure.py: the scripted acceptance set through the REAL v2 loop, priced
with the eval ledger's worst-case math. No key, no call, no ledger. Pins the owner's target: under the KEPT $0.25
per-turn cap, the flagship finishes on Haiku 4.5 with the index layout and its summed worst case stays under the cap;
the Wave 1 search layout stops after round 1 (the whole catalog rides every request)."""
from __future__ import annotations

import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tools import agent_eval_ledger as led  # noqa: E402
from tools import agent_v2_cost_measure as meas  # noqa: E402
from tools.agent_v2_cost_dryrun import SAMPLE_CONTEXT, _manifest  # noqa: E402
from api.services.uct_agent import turn as t1, turn_v2 as v2  # noqa: E402


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    monkeypatch.delenv(led.EVAL_KEY_ENV, raising=False)
    monkeypatch.delenv(led.PROD_KEY_ENV, raising=False)
    monkeypatch.delenv(v2.TURN_USD_ENV, raising=False)
    monkeypatch.delenv(v2.ROUNDS_ENV, raising=False)
    monkeypatch.delenv("UCT_AGENT_EFFORT", raising=False)
    monkeypatch.setattr(led, "_connect", lambda *a, **k: (_ for _ in ()).throw(AssertionError("the measurement opened the ledger")))
    monkeypatch.setattr(t1, "_record_cost", lambda r: 0.0)


def _one(case_id: str, layout: str, model: str) -> dict:
    case = next(c for c in meas._cases() if c["id"] == case_id)
    return meas.measure_case(case, layout, model, led=led, v2=v2, t1=t1, ctx=SAMPLE_CONTEXT, manifest=_manifest())


def test_the_flagship_finishes_under_the_kept_cap_on_haiku_4_5_with_the_index_layout():
    r = _one("FLAGSHIP", "index", "claude-haiku-4-5")
    assert r["completed"] and r["stopped"] is None and r["steps_sent"] == r["steps"] == 9
    assert r["rounds"] <= v2.DEFAULT_ROUNDS and r["pauses"] == 2
    assert r["worst_turn_usd"] < v2.DEFAULT_TURN_USD                  # the SUM of every round's reservation
    assert r["tool_search_calls"] == 1 and r["tool_search_misses"] == 0
    assert r["bytes_per_round"][0] < 20_000


def test_the_wave_1_search_layout_stops_after_round_one_on_haiku_4_5():
    r = _one("FLAGSHIP", "search", "claude-haiku-4-5")
    assert r["stopped"] == "turn_cap" and r["rounds"] == 1 and r["bytes_per_round"][0] > 150_000


def test_haiku_5_5_prices_the_same_index_turn_at_a_tenth():
    a = _one("F01", "index", "claude-haiku-4-5")
    b = _one("F01", "index", "claude-haiku-5-5")
    assert b["completed"] and b["worst_turn_usd"] < a["worst_turn_usd"] / 5


def test_grouping_keeps_dependent_steps_apart():
    steps = next(c for c in meas._cases() if c["id"] == "FLAGSHIP")["script"][:-1]
    g = meas._groups(steps)
    # screen | create (card) | add + charts | the four EMAs (on the new charts) + the save (card; runs after them, in order)
    assert g == [[0], [1], [2, 3], [4, 5, 6, 7, 8]]
