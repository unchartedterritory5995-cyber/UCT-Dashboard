"""v2-readiness-2 (Mission 3): the deterministic v1-vs-v2 cost estimate over the capability-regression corpus
(tools/agent_v2_corpus_cost.py). NO model call. Pins, on the current production model (claude-haiku-4-5) and the kept
$0.25 per-turn cap:
  * the v2 "index" layout (default) finishes EVERY corpus intent, every canonical step accepted by the server, with the
    runtime gate (spent + worst case of the next request, checked before each call) under the cap — with a margin;
  * the Wave 1 "search" layout cannot (its first request alone reserves most of the cap): why index is the default;
  * v1's single call stays under the cap for every intent."""
from __future__ import annotations

import importlib.util
import json
import logging
import os

import pytest

from tools import agent_v2_corpus_cost as cc


@pytest.fixture(scope="module")
def index():
    return cc.measure("claude-haiku-4-5", "index")


def test_index_layout_finishes_every_corpus_intent_under_the_cap_with_margin(index):
    s = index["summary"]
    assert index["turn_cap_usd"] == 0.25 and s["intents"] == 158
    assert s["v2_finished"] == s["intents"] and s["v2_stopped"] == []
    assert all(r["v2"]["steps_done"] == r["v2"]["steps"] for r in index["rows"])           # no step refused (args / target)
    # over the real Screener section: measured $0.1409 → margin $0.1091. This is the RUNTIME gate (spent + next worst); the
    # summed worst case is the stricter figure, $0.3387 here, and it is over the cap (see test_uct_agent_v2_cost_measure.py)
    assert s["v2_gate_peak_usd_max"] < 0.25 and s["v2_margin_usd"] >= 0.10
    assert all(r["v2"]["rounds"] <= index["rounds_cap"] for r in index["rows"])


def test_the_fixture_boards_carry_the_real_screener_section():
    with open(cc.EXPORT, encoding="utf-8") as f:
        boards = json.load(f)["boards"]
    assert boards and all(len(b["screener"][0]["fields"]) > 4_000 and b["screener"][0]["savedScreens"] for b in boards.values())


def test_v1_one_call_is_under_the_cap_for_every_intent(index):
    assert index["summary"]["v1_worst_call_usd_max"] < 0.25
    assert all(r["v1"]["calls"] >= 1 and r["v1"]["tokens_in"] > 0 for r in index["rows"])


def test_the_wave1_search_layout_stops_at_the_turn_cap_which_is_why_index_is_the_default():
    s = cc.measure("claude-haiku-4-5", "search")["summary"]
    assert s["v2_finished"] == 0 and s["v2_stopped"] == ["turn_cap"]


def test_the_token_approximation_is_bpe_like():
    assert cc.approx_tokens("") == 0
    assert cc.approx_tokens("switch to weekly") == 2 + 1 + 2
    assert cc.approx_tokens('{"a":12345}') == 1 + 1 + 1 + 1 + 1 + 2 + 1


def test_the_tool_never_records_a_cost_and_restores_the_recorder(monkeypatch):
    """review #775: the cost guard's recorder is patched BEFORE the first (v1) call and restored afterwards."""
    from api.services.uct_agent import turn as t1
    seen = []
    sentinel = lambda r: seen.append(r) or 0.0          # noqa: E731
    monkeypatch.setattr(t1, "_record_cost", sentinel)
    cc.measure("claude-haiku-4-5", "index")
    assert seen == [] and t1._record_cost is sentinel


def test_the_tool_restores_the_process_logging_level():
    before = logging.root.manager.disable
    cc.measure("claude-haiku-4-5", "index")
    assert logging.root.manager.disable == before == logging.NOTSET


def test_the_tool_restores_the_logging_level_when_the_measurement_fails_and_keeps_a_callers_own(monkeypatch):
    seen = []

    def boom(*a):
        seen.append(logging.root.manager.disable)
        raise RuntimeError("boom")
    monkeypatch.setattr(cc, "_measure", boom)
    with pytest.raises(RuntimeError):
        cc.measure()
    assert seen == [logging.WARNING] and logging.root.manager.disable == logging.NOTSET
    logging.disable(logging.INFO)
    try:
        with pytest.raises(RuntimeError):
            cc.measure()
        assert logging.root.manager.disable == logging.INFO
    finally:
        logging.disable(logging.NOTSET)


def test_the_contract_skew_log_is_still_seen_after_the_tool_ran(caplog):
    """The order that failed: this module before test_uct_agent_contract.py silenced that file's logged-skew test."""
    cc.measure("claude-haiku-4-5", "index")
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_uct_agent_contract.py")
    spec = importlib.util.spec_from_file_location("contract_after_the_cost_tool", path)
    contract = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(contract)
    contract.test_manifest_version_skew_is_served_and_logged(caplog)


def test_the_tool_refuses_unless_the_auth_db_is_a_temp_file(monkeypatch):
    monkeypatch.setenv("AUTH_DB_PATH", os.path.join(os.path.abspath(os.sep), "data", "auth.db"))
    with pytest.raises(SystemExit, match="refusing"):
        cc.measure()
    monkeypatch.delenv("AUTH_DB_PATH")
    with pytest.raises(SystemExit, match="refusing"):
        cc.measure()
