"""W2-A2 cost follow-up — tools/agent_v2_cost_measure.py: the scripted acceptance set through the REAL v2 loop, priced
with the eval ledger's worst-case math, over a context carrying the REAL Screener section. No key, no call, no ledger.

The owner's target is a flagship under the KEPT $0.25 per-turn cap. Measured honestly it is NOT met on Haiku 4.5: this
test used to pass only because its context stubbed the Screener section down to 113 bytes (about 6 KB in production).
Planner v2 is OFF, so nothing is exposed today; the figure is pinned against FLAGSHIP_BASELINE_USD and may not grow.
The Wave 1 search layout is refused before its first call (the whole catalog rides every request)."""
from __future__ import annotations

import os
import sys
import warnings

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tools import agent_eval_ledger as led  # noqa: E402
from tools import agent_v2_cost_measure as meas  # noqa: E402
from tools.agent_v2_cost_dryrun import _manifest, real_context  # noqa: E402
from api.services.uct_agent import turn as t1, turn_v2 as v2  # noqa: E402

#: ⛔ PLANNER V2 CANNOT BE ENABLED UNTIL AN OWNER DECISION. The flagship's summed worst case on Haiku 4.5, measured over the
#: real Screener section, is OVER the kept $0.25 per-turn cap. That is recorded here, not fixed: do not raise the cap and do
#: not re-stub the context to get back under it. Lower this when the planner gets cheaper; raise it only with the owner.
#: Moved from $0.2956: #834 widened the screener section; v2 is off; activation requires the owner's v2 cost decision.
FLAGSHIP_BASELINE_USD = 0.3454
#: room for ordinary registry growth, so a new field or Charts action does not fail a test for a planner that is off.
#: Raised $0.005 → $0.03 on 2026-11-11 by the owner (answered in the Lead's session: "Raise growth room"), because the queued
#: Charts action families (~13 actions, ~+$0.006) would otherwise fail it while v2 is off. The $0.25 cap and the
#: "v2 cannot be enabled until an owner decision" rule are unchanged; this is NOT a v2 activation decision.
FLAGSHIP_GROWTH_USD = 0.03


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
    return meas.measure_case(case, layout, model, led=led, v2=v2, t1=t1, ctx=real_context(), manifest=_manifest())


def test_the_context_carries_the_real_screener_section():
    sec = real_context()["screener"]
    assert len(sec) == 1 and len(sec[0]["fields"]) > 4_000 and sec[0]["savedScreens"]
    catalog = sec[0]["fields"].split(";")
    keys = {f.split(":")[0] for f in catalog}
    assert {"price", "market_cap", "dist_52w_high_pct", "dollar_volume_1d"} <= keys        # the registry and the session measures
    assert not keys & {"rs_rank", "accdis", "opt_net_premium_1d"}                          # hidden fields stay hidden
    assert "5% below the high" in next(f for f in catalog if f.startswith("dist_52w_high_pct:"))


def test_the_flagship_worst_case_is_over_the_cap_and_may_not_grow_while_v2_is_off(record_property):
    """Not a pass on the cap: see FLAGSHIP_BASELINE_USD. The turn still finishes (the runtime rule is spent + next worst)."""
    r = _one("FLAGSHIP", "index", "claude-haiku-4-5")
    assert r["completed"] and r["stopped"] is None and r["steps_sent"] == r["steps"] == 9
    assert r["rounds"] <= v2.DEFAULT_ROUNDS and r["pauses"] == 2
    assert r["tool_search_calls"] == 1 and r["tool_search_misses"] == 0
    # records the real section, not a cost or request limit: #834 widened the screener section; v2 is off; activation requires
    # the owner's v2 cost decision
    # 29_000 → 29_500 (2026-11-12, AUDIT ruling on #1070): the measured section grew 28739 B (master 478ed3c1d9) → 29078 B with
    # the four Drawing Boards actions; cost stays inside the owner's #1107 growth room (worst $0.3542 vs 0.3454 + 0.03). Each later
    # family moves this pin in its own commit with its own measured number — never pre-allocated.
    # 29_500 → 29_950 (2026-11-12, #1106 right-click parity, AUDIT rule: each family moves it with its own measured number):
    # measured 29408 B (master 4d6c43659c, after #1104) → 29515 B with chartMenu.askAi / resetWatermark; worst $0.3575, still inside
    # the owner's #1107 growth room (0.3454 + 0.03). The $ bar, the 0.25 cap and FLAGSHIP_BASELINE are unchanged.
    assert r["bytes_per_round"][0] < 29_950
    record_property("flagship_worst_usd", r["worst_turn_usd"])
    if r["worst_turn_usd"] >= v2.DEFAULT_TURN_USD:
        warnings.warn(f"planner v2 flagship worst case ${r['worst_turn_usd']:.4f} is over the ${v2.DEFAULT_TURN_USD} cap: "
                      "v2 cannot be enabled until an owner decision", stacklevel=1)
    assert v2.DEFAULT_TURN_USD == 0.25                                # the owner's kept cap: this test never moves it
    assert r["worst_turn_usd"] <= FLAGSHIP_BASELINE_USD + FLAGSHIP_GROWTH_USD      # the SUM of every round's reservation


def test_the_wave_1_search_layout_is_refused_before_its_first_call_on_haiku_4_5():
    r = _one("FLAGSHIP", "search", "claude-haiku-4-5")
    assert r["stopped"] == "turn_cap" and r["rounds"] == 0 and not r["completed"]


def test_haiku_5_5_prices_the_same_index_turn_at_a_tenth():
    a = _one("F01", "index", "claude-haiku-4-5")
    b = _one("F01", "index", "claude-haiku-5-5")
    assert b["completed"] and b["worst_turn_usd"] < a["worst_turn_usd"] / 5


def test_grouping_keeps_dependent_steps_apart():
    steps = next(c for c in meas._cases() if c["id"] == "FLAGSHIP")["script"][:-1]
    g = meas._groups(steps)
    # screen | create (card) | add + charts | the four EMAs (on the new charts) + the save (card; runs after them, in order)
    assert g == [[0], [1], [2, 3], [4, 5, 6, 7, 8]]
