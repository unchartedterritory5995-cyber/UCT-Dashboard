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


def _one(case_id: str, layout: str, model: str, manifest: list[dict] | None = None) -> dict:
    case = next(c for c in meas._cases() if c["id"] == case_id)
    return meas.measure_case(case, layout, model, led=led, v2=v2, t1=t1, ctx=real_context(),
                             manifest=_manifest() if manifest is None else manifest)

#: the round-1 request WITHOUT the action index (system prompt, real Screener section, tools, loaded schemas), measured
#: 19_666 B on master 6c373e0300. It does not scale with registered actions; move it only for a deliberate prompt/section
#: change, in its own commit with its measured number. Slack 128 B (< the few-hundred-byte bloat it must catch).
#: RAISING THIS CONSTANT IS A DELIBERATE ACT: it needs AUDIT review in the PR that raises it. A master change that
#: legitimately grows the system prompt or Screener section turns this test red ON PURPOSE (not a flake). A PR that moves
#: both this constant and the $ figures below is AUDIT T2, not T1. The $ assertion stays the gate.
NON_INDEX_BUDGET_BYTES = 19_666 + 128


def _line_bound(cap: dict) -> int:
    """JSON bytes one action may cost in the index: `tool: summary` capped at INDEX_SUMMARY_CHARS (+ '…'), + '\n'."""
    s = " ".join(str(cap.get("summary") or "").split())
    summ = len(s[:v2.INDEX_SUMMARY_CHARS].encode("utf-8")) + (len("…".encode("utf-8")) if len(s) > v2.INDEX_SUMMARY_CHARS else 0)
    return len(v2.tool_name(cap["name"]).encode("utf-8")) + 2 + summ + 2      # ": " and the JSON-escaped newline


def _round1_bound(manifest: list[dict]) -> dict:
    """Measure round 1 twice through the real loop: as shipped, and with action_index → "" (the non-index base)."""
    actual = _one("FLAGSHIP", "index", "claude-haiku-4-5", manifest)["bytes_per_round"][0]
    real = v2.action_index
    try:
        v2.action_index = lambda caps: ""
        base = _one("FLAGSHIP", "index", "claude-haiku-4-5", manifest)["bytes_per_round"][0]
    finally:
        v2.action_index = real
    domains = {v2.domain_for(c["name"]) for c in manifest}
    headers = sum(len(f"[{d}]".encode()) + 2 for d in domains)                 # "[domain]\n" per present domain
    per = [_line_bound(c) for c in manifest]
    n = len(manifest)
    index_bound = sum(per) + headers
    return {"base": base, "n": n, "per_action_avg": round(sum(per) / n, 1), "headers": headers,
            "index_bound": index_bound, "index_actual": actual - base, "bound": base + index_bound, "actual": actual}



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
    # Round-1 bytes: a MEASURED bound, not a hand-set pin (D11-A; the pin went 20k → 23k → 29k → 29.5k → 29.95k by hand).
    # round 1 = the non-index part (system prompt, Screener section, tools, the loaded schemas) + action_index(caps), which is
    # one capped line per registered action. A new action family adds its own measured line cost; nobody edits a number.
    # A regression in the non-index part still fails against NON_INDEX_BUDGET_BYTES. The $ assertion below stays the gate.
    b = _round1_bound(_manifest())
    record_property("round1_bound", b)
    assert b["base"] <= NON_INDEX_BUDGET_BYTES, b               # the non-index part did not bloat
    assert b["index_actual"] <= b["index_bound"], b             # every index line obeys the INDEX_SUMMARY_CHARS cap
    assert r["bytes_per_round"][0] == b["actual"] <= b["bound"], b
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


def test_the_round1_bound_scales_with_a_new_action_and_catches_an_uncapped_line(monkeypatch):
    """Mutants (D11-A): an added action moves the bound by its own line cost and still passes; a line past the cap fails.

    Resolution: the index bound counts each line at its CAP, while real summaries are trimmed at word boundaries, so on
    master 6c373e0300 the index sits 712 B under its bound (10_150 vs 10_862). An index overrun smaller than that slack is
    not caught here; that is acceptable only because the $ assertion stays the gate."""
    m = _manifest()
    b0 = _round1_bound(m)
    extra = dict(m[0], name="chart.mutantProbeAction", summary="A new action added by a later family, longer than the cap")
    b1 = _round1_bound(m + [extra])
    assert b1["n"] == b0["n"] + 1 and b1["actual"] <= b1["bound"] and b1["base"] == b0["base"]
    assert b1["bound"] - b0["bound"] == _line_bound(extra) and 0 < b1["actual"] - b0["actual"] <= _line_bound(extra)
    real = v2.action_index
    monkeypatch.setattr(v2, "action_index", lambda caps: real(caps) + "x" * 1_000)  # one line far past the cap
    actual = _one("FLAGSHIP", "index", "claude-haiku-4-5", m)["bytes_per_round"][0]
    assert actual > b0["bound"]
