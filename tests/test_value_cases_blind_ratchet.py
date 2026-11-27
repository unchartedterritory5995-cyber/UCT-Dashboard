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
from tools.value_cases import rules as R

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
EQUIV_SELF = ("equivalent: on the newest bar the inner loop compares a close with itself raised by a positive "
              "percent, never true, so the guard only saves the loop")
REASONS = {NO_WINDOW, OWN_READING, MEASURE_ZERO, DISPLAY, GUARD, EQUIV_TIME, EQUIV_STREAK, EQUIV_SEED, EQUIV_DENOM,
           NEVER_ZERO, EQUIV_SELF}

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
    # unit 2 (2026-11-25): cap-08, count-on-bars-01 and l04 see every flip on their tie edges; what the other three
    # still cannot see is a close against a percent-scaled price (no copied tie lands on it) or h03's loop guard
    "h03": [(2, MEASURE_ZERO), (1, EQUIV_SELF)], "h05": [(2, MEASURE_ZERO)], "i03": [(1, MEASURE_ZERO)],
}
#: the formula-lane edges of 2026-11-25 and the slip each was set for
EDGED = {"d17": "window", "f02": "window", "h10": "window", "cap-09": "strict", "d25": "strict", "date-start-03": "strict"}
#: the script-lane tie edges of unit 2 (2026-11-25) and the single flips each was set for (by their index in
#: `audit.script_single_flips`, with the line each flips named beside it)
SCRIPT_EDGED = {
    "l04": {0: "high <= high[1]", 1: "low >= low[1]"},
    "count-on-bars-01": {0: "close >= close[lookback]"},
    "cap-08": {0: "isGap = low >= high[1]", 3: "low <= array.get(tops, i)"},
    "h03": {1: "volume >= volume[1]"},
    "i03": {1: "volume >= volume[1]", 2: "count > alertAt"},
    "h05": {1: "low <= startLow", 2: "close >= close[1] and inCorrection", 5: "volume >= volume[1]"},
}


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


@pytest.mark.parametrize("cid", sorted(SCRIPT_EDGED), ids=sorted(SCRIPT_EDGED))
def test_each_script_edge_keeps_its_answer_right_and_turns_each_flip_it_was_set_for_wrong(cid):
    """Each unit 2 edge does its job on the script lane, with all its ties present (they were chosen together:
    alone, one of h05's would land on the bar another moves)."""
    from tools.value_cases import script_grade
    case = BY[cid]
    assert set(case["edge"]) == {"ties"}, cid
    flips = list(A.script_single_flips(case["answer"]["script"]["pine"]))
    jobs = [case] + [{**case, "id": f"{cid}#flip{j}", "holds": cid} for j in SCRIPT_EDGED[cid]]
    answers = {cid: case["answer"], **{f"{cid}#flip{j}": {"turn": "script", "script": {"pine": flips[j]}} for j in SCRIPT_EDGED[cid]}}
    try:
        got = script_grade.grade_all(jobs, answers)
    except LaneUnavailable as exc:
        pytest.skip(f"the script lane is not available here: {str(exc)[:200]}")
    assert got[cid]["verdict"] == "right", got[cid]["lines"]
    for j, line in SCRIPT_EDGED[cid].items():
        assert line in flips[j] and line not in case["answer"]["script"]["pine"], (cid, j, line)   # the flip named
        assert got[f"{cid}#flip{j}"]["verdict"] == "wrong", (cid, j, line)


def test_a_shift_moves_the_whole_bar_so_one_price_lands_exactly():
    """The lane's `shift` tie: the bar keeps its own range (high minus low) and its price lands EXACTLY on the
    value. Without it, a tie that lifted one bar's low above that bar's own close broke the bar, and was refused."""
    from tools.value_cases import script_lane
    src = '//@version=5\nindicator("probe")\nplot(low, "low")\nplot(high - low, "range")'
    tie = {"field": "l", "back": 3, "as": 9, "shift": True}
    try:
        out = script_lane.run([{"id": "plain", "source": src, "chart": "daily"},
                               {"id": "shifted", "source": src, "chart": "daily", "edge": {"ties": [tie]}}])
    except LaneUnavailable as exc:
        pytest.skip(f"the script lane is not available here: {str(exc)[:200]}")
    plain, shifted = out["scripts"]["plain"], out["scripts"]["shifted"]
    assert plain.get("ok") is not False and shifted.get("ok") is not False, (plain, shifted)
    low = lambda r, k: r["columns"]["value"][k]                            # noqa: E731   (the first plot)
    rng = lambda r, k: r["columns"]["out2"][k]                             # noqa: E731   (the second)
    n = len(plain["columns"]["value"])
    a, b = n - 1 - 3, n - 1 - 9
    assert low(shifted, a) == low(plain, b) and low(shifted, a) != low(plain, a)   # EXACTLY the other bar's low
    assert abs(rng(shifted, a) - rng(plain, a)) < 1e-9 * max(1.0, abs(rng(plain, a)))  # the whole bar moved


def test_the_edge_chart_is_restored_after_grading():
    """`edges.on` itself, whatever any grade says: inside, the chart AND the rules read the edge bars; after, the SAME
    list comes back to both, not one equal to it. ⚰️ Two earlier versions were blind to their own break: one compared
    an edge chart with itself once an earlier test had left the chart edged; the next went through `grade_case`, which
    never reaches the edge pass when the recorded answer is not right on such a chart, so nothing moved."""
    before = G.CHARTS["daily"]["bars"]
    tail = copy.deepcopy(before[-3:])
    with E.on([{"extreme": {"field": "c", "back": 10}}]) as bars:
        assert G.CHARTS["daily"]["bars"] is bars and R.BARS is bars and bars is not before
    assert G.CHARTS["daily"]["bars"] is before and R.BARS is before and before[-3:] == tail
