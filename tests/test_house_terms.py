"""⭐ L4 wiring: a Screener term the member writes on a chart is given its house chart formula.

Measured 2026-11-15: asked for "ADR %", the dock built a 20-bar average where the Screener's ADR %
is 21. With the twin registry the assistant is handed the Screener's own formula as data.
"""
from __future__ import annotations

from api.services import ast_table
from api.services import chart_twins
from api.services import definition_concierge as dc
from api.services import definition_conversation as conv


def test_the_door_reads_the_one_registry():
    assert conv.CHART_TWINS is chart_twins.TWINS
    assert "rsi14" in conv.CHART_TWINS and "adr_pct" in conv.CHART_TWINS


def test_a_term_with_a_twin_carries_the_house_formula_and_one_without_does_not():
    notes = conv._language_notes({"terms": [
        {"matched_as": "ADR %", "name": "adr_pct"},
        {"matched_as": "market cap", "name": "market_cap"},
    ]})
    adr, cap = notes["matched_terms"]
    assert adr["chart_formula"] == dc.formula_for(chart_twins.TWINS["adr_pct"])
    assert "21" in adr["chart_formula"] and "high" in adr["chart_formula"]
    assert "use this formula" in adr["rule"]
    assert cap == {"wrote": "market cap", "entry": "market_cap"}        # unchanged: no chart form


def test_a_firm_concept_still_takes_its_chart_form_from_the_same_registry():
    """`overbought` reads the nightly rsi14; its chart form comes from the twin, as before."""
    notes = conv._language_notes({"concepts": [{"word": "overbought"}]})
    (c,) = [c for c in notes["firm_concepts"] if c["word"] == "overbought"]
    assert c["chart_formula"] == "(rsi(close, 14) >= 70)"


# ═══ 2026-11-17 — the words members use for a house term ══════════════════════════════════════

def _terms(message):
    return [t["name"] for t in dc.plan(message, dc.INDICATOR_KIND, lexicon=conv.CHART_LEXICON).get("terms") or []]


def test_every_spoken_phrase_reaches_its_column_and_every_column_has_a_twin():
    """ASKED: "relative volume", "distance from the 52 week high". Each phrase, inside a sentence,
    is read as the ONE column it names; and a phrase is only ever listed for a column with a twin."""
    pairs = chart_twins.spoken_phrases()
    assert len(pairs) > 100 and set(chart_twins.SPOKEN) <= set(chart_twins.TWINS)
    assert len({p for p, _ in pairs}) == len(pairs), "one phrase names two columns"
    missed = [(p, c) for p, c in pairs if c not in _terms(f"Plot the {p} in a lower pane")]
    assert not missed, missed[:5]


def test_a_spoken_house_term_is_handed_its_house_formula():
    understanding = dc.plan("Show relative volume and the distance from the 52 week high",
                            dc.INDICATOR_KIND, lexicon=conv.CHART_LEXICON)
    by = {t["entry"]: t for t in conv._language_notes(understanding)["matched_terms"]}
    assert by["vol_ratio"]["chart_formula"] == dc.formula_for(chart_twins.TWINS["vol_ratio"])
    assert "30" in by["vol_ratio"]["chart_formula"]
    assert "252" in by["dist_52w_high_pct"]["chart_formula"]
    assert "the member gave their own number" in by["vol_ratio"]["rule"]


def test_CONTROL_words_that_only_look_like_a_house_term_match_none():
    """A new 52-week high is not a distance; an ATR extension from the member's OWN average is
    the member's measure, not the firm's 50-day one."""
    for message in ("Mark when the RS line makes a new 52 week high while price is below its own 52 week high",
                    "ATR extension from the 21 EMA",
                    "volume above its 50 day average"):
        assert not (set(_terms(message)) & set(chart_twins.SPOKEN)), message


def test_CONTROL_the_screeners_own_planner_is_unchanged():
    """The phrases join the chart door's lexicon only: a screen's plain-words box reads them as before."""
    names = [t["name"] for t in dc.plan("distance from the 52 week high", dc.INDICATOR_KIND).get("terms") or []]
    assert "dist_52w_high_pct" not in names
    new = 0
    for phrase, column in chart_twins.spoken_phrases():
        stems, _cost = dc._stem_key(dc._form_tokens(phrase))
        rows = dc.LEXICON["index"].get(stems)
        if rows is None:
            new += 1                      # this door's own addition
        else:                             # the firm's own label already says it ("Dist from 52W High")
            assert {r["key"] for r in rows} == {column}, phrase
    assert new > 600


def test_a_phrase_never_replaces_what_the_shared_lexicon_already_reads():
    """ADDED, NEVER REPLACED: every bucket the shared lexicon holds is the same bucket here unless a
    chart function word replaced it (that rule is older and has its own test)."""
    function_stems = {dc._stem_key(dc._form_tokens(p))[0] for p, _ in conv.EXPANSION_PHRASES}
    converted = 0
    for stems, rows in dc.LEXICON["index"].items():
        if stems in function_stems:
            continue
        here = conv.CHART_LEXICON["index"][stems]
        if here is rows:
            continue
        # the one other difference: a chart-only twin's own label, read as a term (backlog 47)
        assert all(r["kind"] == dc.EXCLUDED_ENTRY and r["key"] in chart_twins.CHART_ONLY for r in rows), stems
        assert [(r["key"], r["words"]) for r in here] == [(r["key"], r["words"]) for r in rows]
        assert all(r["kind"] == dc.TABLE_ENTRY for r in here)
        converted += 1
    assert converted >= len(chart_twins.CHART_ONLY)


def test_a_column_the_chart_computes_exactly_is_a_term_not_unavailable():
    """ASKED on a chart: "show the EMA9 Distance". CLAIMED before: "not available". DID: a term with
    the Screener's own formula. The Screener's planner still answers what is true for a screen."""
    assert chart_twins.CHART_ONLY <= set(chart_twins.TWINS)
    for message, column in (("show the EMA9 Distance", "pct_vs_ema9"),
                            ("Plot Avg Volume (50d) in a pane", "avg_volume_50d"),
                            ("Volume Trend (5d vs 20d) as a line", "vol_trend_pct")):
        understanding = dc.plan(message, dc.INDICATOR_KIND, lexicon=conv.CHART_LEXICON)
        assert not understanding["unavailable"], (message, understanding["unavailable"])
        (term,) = [t for t in conv._language_notes(understanding)["matched_terms"] if t["entry"] == column]
        assert term["chart_formula"] == dc.formula_for(chart_twins.TWINS[column])
        screen = dc.plan(message, dc.INDICATOR_KIND)
        assert [u["name"] for u in screen["unavailable"]] == [column]        # unchanged for a screen


def test_CONTROL_a_column_with_no_exact_chart_form_is_still_unavailable_on_a_chart():
    excluded = sorted(set(dc._excluded(ast_table.TABLE)) - set(chart_twins.TWINS))
    assert excluded
    left = [r for rows in conv.CHART_LEXICON["index"].values() for r in rows
            if r["kind"] == dc.EXCLUDED_ENTRY]
    assert {r["key"] for r in left} & set(excluded)
    assert not ({r["key"] for r in left} & chart_twins.CHART_ONLY)
