"""W2-A2 part 4 — tools/agent_v2_cost_dryrun.py: the paid v2 eval cost table WITHOUT a key, a run or a ledger
reservation. Pins: it needs no key (and reads none), builds the real v2 request shape, prices every verified
model with the ledger's worst-case math, the worst case is never below the expected figure, and it never opens
the cumulative ledger (no reservation, no row)."""
from __future__ import annotations

import json
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tools import agent_eval_ledger as led  # noqa: E402
from tools import agent_v2_cost_dryrun as dry  # noqa: E402


@pytest.fixture(autouse=True)
def _no_key(monkeypatch):
    monkeypatch.delenv(led.EVAL_KEY_ENV, raising=False)
    monkeypatch.delenv(led.PROD_KEY_ENV, raising=False)
    # the ledger must never be opened by a dry run
    monkeypatch.setattr(led, "_connect", lambda *a, **k: (_ for _ in ()).throw(AssertionError("the dry run opened the ledger")))
    monkeypatch.setattr(led.Ledger, "__init__", lambda *a, **k: (_ for _ in ()).throw(AssertionError("the dry run built a Ledger")), raising=False)


def test_the_table_prices_every_verified_model_without_a_key_or_a_ledger():
    d = dry.dry_run()
    models = set(json.load(open(led.PRICES_FILE, encoding="utf-8"))["models"])
    assert set(d["models"]) == models
    assert d["acceptance_cases"] >= 30
    for m, row in d["models"].items():
        for n in dry.ROUNDS_TABLE:
            r = row["per_turn"][str(n)]
            assert r["worst_usd"] > 0 and r["expected_usd"] > 0
            assert r["worst_usd"] >= r["expected_usd"], (m, n)
            assert r["rounds"] == n
        # more rounds cost more, both ways
        w = [row["per_turn"][str(n)]["worst_usd"] for n in dry.ROUNDS_TABLE]
        assert w == sorted(w)
        assert row["set_worst_usd_4_rounds"] == pytest.approx(row["per_turn"]["4"]["worst_usd"] * d["acceptance_cases"], abs=0.02)
        assert row["cases_under_cumulative_cap_worst_4_rounds"] >= 1
    assert d["request_bytes_round1"]["claude-haiku-4-5"] > 50_000          # the full deferred-tools catalog rides every call


def test_the_request_prices_the_real_screener_section_never_a_stub():
    assert "screener" not in dry.SAMPLE_CONTEXT
    text = dry.build_request("claude-haiku-4-5", 0)["messages"][0]["content"]
    assert len(dry.real_context()["screener"][0]["fields"]) > 4_000
    assert "market_cap:Market Cap($);price:Price($)" in text and "dollar_volume_1d:" in text and len(text) > 5_000


def test_the_worst_case_is_the_ledgers_own_math():
    kw = dry.build_request("claude-haiku-4-5", 0)
    assert kw["tools"][0]["name"] == "tool_search_tool_regex" and kw["messages"][0]["role"] == "user"
    assert dry.price_model("claude-haiku-4-5", 1, led)["worst_usd"] == pytest.approx(led.worst_case_usd(kw), abs=1e-4)   # the table rounds to 4 places


def test_the_markdown_names_the_caps_and_the_no_run_rule(capsys):
    assert dry.main(["--json"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert "no call was made" in out["about"]
    assert dry.main([]) == 0
    text = capsys.readouterr().out
    assert "NO run" in text and "$21" in text and "| claude-haiku-4-5 | 4 |" in text


def test_a_round_two_reservation_on_the_default_cap_is_a_finding_not_a_crash():
    # the acceptance-set readiness finding: with the full catalog the ledger's worst case for ONE round on the
    # production model is close to the per-turn cap, so a real v2 turn may stop after its first round (turn_cap)
    d = dry.dry_run()
    one = d["models"]["claude-haiku-4-5"]["per_turn"]["1"]["worst_usd"]
    assert one > d["turn_cap_usd"] * 0.5
    assert d["models"]["claude-haiku-4-5"]["rounds_under_turn_cap_worst"] <= 2
