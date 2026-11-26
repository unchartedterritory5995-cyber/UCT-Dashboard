"""Every catalogued indicator name lands on an honest outcome, in either capitals (coordinator ruling B, 2026-11-25).

Measured before (understand_turn over every row of `api/data/indicator_name_catalogue.json`): 56 catalogued names were
BUILT FROM MEMORY when written in lower case, with no word that UCT had not checked them, and 45 of them were REFUSED
in Title Case as "not an indicator UCT knows by name", which the catalogue itself says is false. Now:

  * G1, 28 names that are one specific calculation, are `distinctive`: built from what the name is understood to
    compute, the name withheld from the chart, and the door's own note that it is not in the checked library;
  * G3, 9 names that were missing, join the same way;
  * G2, methods, drawings, chart types and data series (no single formula), go to the script turn, where every script
    no value-checked recipe stands behind carries UCT's own UNCHECKED_LINE;
  * a longer name holding a library name ("Williams Accumulation Distribution" holds Chaikin's "accumulation
    distribution") is another indicator, not the library's.

The five honest outcomes: the library's checked formula, the door's answer by name (a built-in or a held name),
withheld + disclosed, the script turn (disclosed), and nothing else. Never a plain build.
⛔ One row is exempt, BY ITS SPELLING: QQE's only short form is a bare three-letter acronym, which is never looked up
as a name (several are tickers: `indicator_names.is_short_acronym`); its long form is withheld. No paid calls.
"""
from __future__ import annotations

import pytest

from api.services import indicator_names as names
from api.services import named_indicators
from api.services import pine_authoring
from api.services import script_conversation as sc
from tests.test_p2_truth_server import conv, model  # noqa: F401 -- fixtures by name
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name
from tests.test_script_conversation import ask, lane, writes  # noqa: F401 -- fixtures by name

CHART = {"sym": "NVDA", "tf": "D"}
G1 = ("least_squares_moving_average triangular_moving_average rainbow_moving_average range_filter volatility_stop "
      "trend_intensity_index vertical_horizontal_filter random_walk_index polarized_fractal_efficiency standard_error_bands "
      "acceleration_bands fractal_chaos_bands projection_bands relative_vigor_index center_of_gravity relative_momentum_index "
      "intraday_momentum_index disparity_index psychological_line projection_oscillator volume_weighted_macd "
      "fractal_dimension_index mcclellan_oscillator mcclellan_summation_index arms_index advance_decline_line "
      "bullish_percent_index high_low_index").split()
G3 = ("true_range net_volume chop_zone hull_suite rob_booker_pivots williams_variable_accumulation_distribution "
      "williams_accumulation_distribution symmetrically_weighted_moving_average intraday_intensity_index").split()
G2 = ("cumulative_volume_delta volume_profile market_profile pivot_points fibonacci_retracement fibonacci_extension gann_fan "
      "gann_square andrews_pitchfork elliott_wave wolfe_wave harmonic_patterns order_blocks fair_value_gap break_of_structure "
      "market_structure_shift liquidity_sweep supply_and_demand_zones smart_money_concepts volume_spread_analysis "
      "wyckoff_method stage_analysis renko kagi point_and_figure three_line_break put_call_ratio").split()
#: rows whose NAME is a bare short acronym (never looked up as a name, by the acronym rule)
ACRONYM_NAMED = {"qqe"}


def outcome(conv, words):
    u = conv.understand_turn(words, CHART)
    if conv.door_answers_by_name(words, CHART, frozenset()):
        return "door"
    if sc.wants_script(words) or sc.names_a_method(words):
        return "script"
    # a held name whose published form only a script holds is refused by name and then written as a script
    # (`definition_conversation._with_script_lane`, `named_indicators.needs_script`)
    held = [named_indicators.entry(i) for i in u.get("held") or []]
    if u.get("refusal") is not None and any(named_indicators.needs_script(e) for e in held):
        return "script"
    if u.get("named"):
        return "library"
    if u.get("withheld") and u.get("refusal") is None:
        return "withheld"
    return "PLAIN BUILD" if u.get("refusal") is None else f"REFUSED {u['refusal'].get('gate')}"


def rows():
    return [r for r in names._file() if r["id"] not in ACRONYM_NAMED]


@pytest.mark.parametrize("row", rows(), ids=lambda r: r["id"])
def test_every_catalogued_name_in_both_capitals_lands_honestly(conv, row):
    for words in (f"plot the {row['name'].lower()}", f"Plot the {row['name']}"):
        assert outcome(conv, words) in {"library", "door", "withheld", "script"}, (words, outcome(conv, words))


def test_the_curation_is_what_was_ruled():
    by = {r["id"]: r for r in names._file()}
    assert all(by[i].get("distinctive") for i in G1 + G3), [i for i in G1 + G3 if not by[i].get("distinctive")]
    assert not any(by[i].get("distinctive") for i in G2), [i for i in G2 if by[i].get("distinctive")]


def test_the_acronym_exemption_is_only_an_acronym():
    by = {r["id"]: r for r in names._file()}
    for rid in ACRONYM_NAMED:
        assert names.is_short_acronym(by[rid]["name"].lower())
        longer = [a for a in by[rid]["aliases"] if not names.is_short_acronym(a)]
        assert longer and all((a, rid) in names.withheld_spellings() for a in longer)


@pytest.mark.parametrize("words,rid", [
    ("Plot the Elliott Wave", "elliott_wave"), ("plot renko bricks", "renko"),
    ("put call ratio for this stock", "put_call_ratio"), ("Show the Volume Profile", "volume_profile"),
])
def test_a_method_in_either_capitals_goes_to_the_script_turn(words, rid):
    assert sc.names_a_method(words) == rid and sc.names_a_method(words.lower()) == rid


@pytest.mark.parametrize("words", ["plot the cvd", "add the fvg", "add obv", "Plot the 20 day EMA",
                                   "add the accumulation distribution line", "Plot the Volatility Stop"])
def test_no_acronym_library_name_or_withheld_name_is_a_method(words):
    assert sc.names_a_method(words) is None, words


def test_the_script_turns_answer_says_it_is_unchecked():
    said = pine_authoring.said_with_disclosure("This draws Elliott wave counts.", None)
    assert said.endswith(pine_authoring.UNCHECKED_LINE)


def test_a_longer_name_holding_a_library_name_is_another_indicator(conv):
    known = names._library_spellings()
    assert names._answered("aroon up", known) and names._answered("kst oscillator", known)
    assert not names._answered("williams accumulation distribution", known)
    u = conv.understand_turn("Plot Williams Accumulation/Distribution in a pane below", CHART)
    assert u["named"] == [] and [w["id"] for w in u["withheld"]] == ["williams_accumulation_distribution"]
    u = conv.understand_turn("add the accumulation distribution line", CHART)
    assert [e["id"] for e in u["named"]] == ["accumulation_distribution_line"]


def test_a_catalogued_name_in_title_case_is_no_longer_called_unknown(conv):
    for words in ("Plot the Volatility Stop", "Plot the True Range", "Plot the Relative Vigor Index"):
        u = conv.understand_turn(words, CHART)
        # (builtin4, 2026-11-26: True Range is now the library's; a catalogued name is library OR withheld, never refused)
        assert u["refusal"] is None and (u["withheld"] or u["named"]), words


@pytest.mark.parametrize("words", ["Plot the Elliott Wave", "plot the elliott wave", "Show the Renko bricks of this stock"])
def test_a_method_reaches_the_script_turn_first_through_the_door_and_says_it_is_unchecked(conv, clean_env, model, lane, words):
    client = model([writes(reply="This draws it in a pane.")])
    r = ask(conv, words)
    assert [c["tools"][0]["name"] for c in client.calls] == [sc.TOOL_NAME], words
    assert r["ok"] is True and r["turn"] == "script" and r["reply"].endswith(pine_authoring.UNCHECKED_LINE)
