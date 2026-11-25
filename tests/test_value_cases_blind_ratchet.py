"""THE BLIND-SPOT RATCHET: a value case recorded RIGHT must be able to have been graded WRONG (2026-11-25).

`tools/value_cases/audit.py` grades two slips of every recorded right answer by the case's own rule (on its edge chart
too): every length one bar longer, and every comparison flipped ALONE between strict and not. A slip the rule cannot
see is a blind spot: the record says "right" about something it could not have caught.

Coordinator's ruling: a RATCHET that FAILS, not a report. Every blind spot that exists today is ACCEPTED below, by
name, with its count and its REASON. The rail fails when:
  * a case recorded right has a blind spot that is not accepted (a NEW case must come with an edge, or a reason);
  * an accepted entry is STALE (fewer blind spots than accepted): the list only ever goes down, never stays loose.
The reasons are a closed list. "pending: unit 2" names the script cases whose tie edges are the next unit's work.

The script half needs node and `app/node_modules`; where they are missing it SKIPS, and the lanes that run this file
treat a skip as a failure.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from tools.converse_eval import LaneUnavailable
from tools.value_cases import audit as A
from tools.value_cases import edges as E
from tools.value_cases import grade as G

from tests.test_value_cases_scripts import SHORT_WINDOWS, _every_window_one_longer

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / "tests" / "fixtures" / "authoring" / "value_cases.json").read_text(encoding="utf-8"))
BY = {c["id"]: c for c in DATA["cases"]}

# ── the reasons, a closed list ──
NO_WINDOW = "the words name no window: the number made one longer is a cap or an anchor"
OWN_READING = "one bar longer IS one of the rule's own honest readings (with this bar, or the bars before)"
MEASURE_ZERO = "continuous values: an exact tie has measure zero"
DISPLAY = "the sign of a continuous value, for display only: differs only at exactly 0"
GUARD = "a sanity guard, not the member's words"
EQUIV_TIME = "equivalent: a daily bar's time is its session open and an anchor the day's start, never equal"
EQUIV_STREAK = "equivalent: at self == 0 both branches give the same value (0 + 1 is 1)"
EQUIV_SEED = "equivalent: the accumulator's seed is overwritten at the anchor bar, before any bar the case shows"
EQUIV_DENOM = "equivalent: the count of the last 10 admitted values is 10 whatever the condition admits"
NEVER_ZERO = "the count it guards is never 0 on the built market: a gap of the market, not of the rule"
PENDING = "pending: unit 2 (a tie edge in script_lane.mjs, then each comparison resolved or given its reason)"
REASONS = {NO_WINDOW, OWN_READING, MEASURE_ZERO, DISPLAY, GUARD, EQUIV_TIME, EQUIV_STREAK, EQUIV_SEED, EQUIV_DENOM,
           NEVER_ZERO, PENDING}

ACCEPTED_WINDOW = {
    **{cid: NO_WINDOW for cid in ("d09", "d24", "date-start-02", "date-start-03", "h04", "h08", "p02", "p03", "p04",
                                  "p05", "p06")},
    "f15": OWN_READING, "s02": OWN_READING,
}
#: case -> [(how many single flips go unseen, why)], the counts summing to the case's unseen flips
ACCEPTED_STRICT = {
    "cap-05": [(1, DISPLAY)], "cap-06": [(2, DISPLAY)], "i05": [(3, DISPLAY)], "intraday-04": [(1, DISPLAY)],
    "cap-07": [(1, MEASURE_ZERO)], "d08": [(1, MEASURE_ZERO)], "d13": [(1, MEASURE_ZERO)], "d24": [(1, MEASURE_ZERO)],
    "f06": [(1, MEASURE_ZERO)], "f15": [(1, MEASURE_ZERO)], "f19": [(5, MEASURE_ZERO)], "g04": [(1, MEASURE_ZERO)],
    "g08": [(2, MEASURE_ZERO)], "g11": [(1, MEASURE_ZERO)], "g12": [(1, MEASURE_ZERO)], "g13": [(1, MEASURE_ZERO)],
    "g14": [(2, MEASURE_ZERO)], "g18": [(2, MEASURE_ZERO)], "h01": [(1, MEASURE_ZERO)], "h02": [(1, MEASURE_ZERO)],
    "h04": [(1, MEASURE_ZERO)], "h11": [(4, MEASURE_ZERO)], "k02": [(1, MEASURE_ZERO)], "k03": [(1, MEASURE_ZERO)],
    "m05": [(1, MEASURE_ZERO)], "p02": [(1, MEASURE_ZERO)], "s06": [(1, MEASURE_ZERO)],
    "d04": [(2, MEASURE_ZERO), (1, NEVER_ZERO)],
    "d25": [(2, NEVER_ZERO)],
    "m07": [(2, GUARD)],
    "date-start-01": [(2, EQUIV_TIME)], "date-start-02": [(2, EQUIV_TIME)],
    "date-start-03": [(2, EQUIV_TIME), (1, EQUIV_SEED)],
    "h08": [(2, EQUIV_STREAK)], "p03": [(2, EQUIV_STREAK)],
    "cap-09": [(1, EQUIV_DENOM)],
    "cap-08": [(2, PENDING)], "count-on-bars-01": [(1, PENDING)], "h03": [(4, PENDING)], "h05": [(5, PENDING)],
    "i03": [(3, PENDING)], "l04": [(2, PENDING)],
}
#: the formula-lane edges of 2026-11-25 and the slip each was set for
EDGED = {"d17": "window", "f02": "window", "h10": "window", "cap-09": "strict", "d25": "strict", "date-start-03": "strict"}


@pytest.fixture(scope="module")
def audited():
    try:
        return A.audit(DATA["cases"], lambda src, c: _every_window_one_longer(src, SHORT_WINDOWS.get(c["id"])))
    except LaneUnavailable as exc:
        pytest.skip(f"the script lane is not available here: {str(exc)[:200]}")


def _ratchet(audited):
    window = {cid for cid, r in audited.items() if r["window"] == "unseen"}
    strict = {cid: r["strict"][0] for cid, r in audited.items() if r["strict"][0]}
    unaccepted_window = sorted(window - set(ACCEPTED_WINDOW))
    stale_window = sorted(set(ACCEPTED_WINDOW) - window)
    accepted_strict = {cid: sum(n for n, _r in parts) for cid, parts in ACCEPTED_STRICT.items()}
    over = sorted(f"{cid}: {n} unseen, {accepted_strict.get(cid, 0)} accepted" for cid, n in strict.items()
                  if n > accepted_strict.get(cid, 0))
    stale = sorted(f"{cid}: {strict.get(cid, 0)} unseen, {n} accepted" for cid, n in accepted_strict.items()
                   if strict.get(cid, 0) < n)
    assert unaccepted_window == [], f"a case cannot see a window one bar longer: give it an edge, or a reason: {unaccepted_window}"
    assert over == [], f"a case cannot see a strict comparison flipped: give it an edge, or a reason: {over}"
    assert stale_window == [] and stale == [], f"accepted blind spots no longer blind: take them OFF the list: {stale_window} {stale}"


def test_THE_RATCHET_no_blind_spot_is_unaccepted_and_none_accepted_is_stale(audited):
    _ratchet(audited)


def _as_accepted():
    """The audit's answer exactly as the lists accept it, with no lane run: the ratchet's own control."""
    out = {cid: {"window": "seen", "strict": (0, 0)} for cid in BY}
    for cid in ACCEPTED_WINDOW:
        out[cid]["window"] = "unseen"
    for cid, parts in ACCEPTED_STRICT.items():
        n = sum(k for k, _r in parts)
        out[cid]["strict"] = (n, n)
    return out


def test_the_ratchet_passes_its_control_and_fails_each_way_it_is_built_to():
    """A gate that cannot fail proves nothing: the lists as they stand pass, and each of the four drifts fails."""
    _ratchet(_as_accepted())
    new_window, new_strict, healed_window, healed_strict = (_as_accepted() for _ in range(4))
    plain = next(cid for cid in sorted(BY) if cid not in ACCEPTED_WINDOW and cid not in ACCEPTED_STRICT)
    new_window[plain]["window"] = "unseen"
    new_strict[plain]["strict"] = (1, 1)
    healed_window[sorted(ACCEPTED_WINDOW)[0]]["window"] = "seen"
    healed_strict[sorted(ACCEPTED_STRICT)[0]]["strict"] = (0, 1)
    for drift in (new_window, new_strict, healed_window, healed_strict):
        with pytest.raises(AssertionError):
            _ratchet(drift)


def test_every_accepted_entry_names_a_reason_from_the_list():
    assert set(ACCEPTED_WINDOW.values()) <= REASONS
    for cid, parts in ACCEPTED_STRICT.items():
        assert parts and all(n > 0 and why in REASONS for n, why in parts), cid
    for cid in set(ACCEPTED_WINDOW) | set(ACCEPTED_STRICT):
        assert cid in BY and BY[cid].get("recorded_verdict") != "wrong", cid


@pytest.mark.parametrize("cid", sorted(EDGED), ids=sorted(EDGED))
def test_an_edged_case_stays_right_and_its_slip_turns_wrong_on_its_edge(cid):
    """Each formula-lane edge does its job: the recorded answer is RIGHT on the plain bars and on the edge, and the
    slip it was set for is WRONG on the edge (a window one bar longer; or a `close vs close[1]` comparison flipped)."""
    case = BY[cid]
    assert isinstance(case["edge"], list) and case["edge"]
    plain = {k: v for k, v in case.items() if k != "edge"}
    assert G.grade_case(plain, case["answer"])["verdict"] == "right"
    assert G.grade_case(case, case["answer"])["verdict"] == "right"
    if EDGED[cid] == "window":
        slips = [A.formula_window_mutant(case["answer"])[0]]
        assert G.grade_case(plain, slips[0])["verdict"] == "right"          # why the edge exists: unseen on the plain bars
    else:
        close, prior = {"type": "series", "name": "close"}, {"type": "offset", "value": 1, "args": [{"type": "series", "name": "close"}]}
        slips = [m for m in A.formula_single_flips(case["answer"]) if _flips_close_vs_prior(case["answer"], m, close, prior)]
    assert slips and any(G.grade_case(case, m)["verdict"] == "wrong" for m in slips), cid


def _flips_close_vs_prior(answer, mutant, close, prior):
    a, b = json.dumps(answer, sort_keys=True), json.dumps(mutant, sort_keys=True)
    return a != b and json.dumps({"type": "op", "name": ">=", "args": [close, prior]}, sort_keys=True) in b or \
        a != b and json.dumps({"type": "op", "name": "<=", "args": [close, prior]}, sort_keys=True) in b


# ── the edge chart itself ──

def test_an_extreme_marks_the_bar_outside_the_window_and_the_end_bar_below_it():
    bars = [{"o": 10.0, "h": 11.0, "l": 9.0, "c": 10.0 + (i % 7) * 0.1, "v": 1000.0 + i} for i in range(40)]
    out = E.edge_bars(bars, [{"extreme": {"field": "c", "back": 10}}])
    top = max(b["c"] for b in bars)
    assert out[-11]["c"] == top * 1.5 and out[-1]["c"] == top * 1.25
    assert max(b["c"] for b in out[-10:]) == out[-1]["c"] and max(b["c"] for b in out[-11:]) == out[-11]["c"]
    second = E.edge_bars(bars, [{"extreme": {"field": "c", "back": 5, "at": 3, "factor": 1.1}}])
    assert second[-9]["c"] == top * 1.1 < second[-4]["c"] == top * 1.25
    assert all(b["h"] >= max(b["o"], b["c"]) and b["l"] <= min(b["o"], b["c"]) for b in out + second)
    assert bars[-1]["c"] != out[-1]["c"]                                   # a copy: the plain bars are not touched


def test_a_tie_is_exact_and_one_that_would_break_a_bar_is_refused():
    bars = [{"o": 10.0, "h": 12.0, "l": 8.0, "c": 10.0 + i * 0.01, "v": 100.0 + i} for i in range(20)]
    out = E.edge_bars(bars, [{"tie": {"field": "c", "back": 0, "as": 1}}])
    assert out[-1]["c"] == out[-2]["c"]
    broken = [dict(b) for b in bars]
    broken[-2]["c"] = 50.0
    broken[-2]["h"] = 50.0
    with pytest.raises(AssertionError):
        E.edge_bars(broken, [{"tie": {"field": "c", "back": 0, "as": 1}}])
    with pytest.raises(ValueError):
        E.edge_bars(bars, [{"wobble": {}}])


def test_a_formula_edge_has_a_script_form_for_its_ties_only():
    ties = [{"tie": {"field": "c", "back": 5, "as": 6}}, {"tie": {"field": "c", "back": 58, "as": 59}}]
    assert E.script_form(ties) == {"ties": [{"field": "c", "back": 5, "as": 6}, {"field": "c", "back": 58, "as": 59}]}
    assert E.script_form({"back": 3, "low": True}) == {"back": 3, "low": True} and E.script_form(None) is None
    with pytest.raises(ValueError):
        E.script_form([{"extreme": {"field": "c", "back": 10}}])            # refused, never dropped


def test_the_script_lane_refuses_a_formula_edge_and_reads_its_own_ties():
    """⚰️ A formula-lane edge (a list) read by the script lane found no `back` and graded the PLAIN bars under a new
    key, saying nothing. It is refused by name now; the same ties in the lane's own form run."""
    from tools.value_cases import script_lane
    ref = next(r for r in DATA["reference_scripts"] if r["id"] == "ref-while")
    ties = [{"tie": {"field": "c", "back": 5, "as": 6}}]
    src = ref["answer"]["script"]["pine"]
    try:
        out = script_lane.run([{"id": "as-list", "source": src, "chart": "daily", "edge": ties},
                               {"id": "own-form", "source": src, "chart": "daily", "edge": E.script_form(ties)}])
    except LaneUnavailable as exc:
        pytest.skip(f"the script lane is not available here: {str(exc)[:200]}")
    refused, ran = out["scripts"]["as-list"], out["scripts"]["own-form"]
    assert refused.get("ok") is False and "a formula-lane edge on the script lane" in refused.get("reason", ""), refused
    assert ran.get("ok") is not False, ran


def test_the_edge_chart_is_restored_after_grading():
    """The SAME list comes back, not one equal to it: an earlier test that left the chart edged would make an equality
    check compare an edge chart with itself (the first version of this test was blind to its own break that way)."""
    before = G.CHARTS["daily"]["bars"]
    tail = copy.deepcopy(before[-3:])
    G.grade_case(BY["d17"], BY["d17"]["answer"])
    assert G.CHARTS["daily"]["bars"] is before and before[-3:] == tail
