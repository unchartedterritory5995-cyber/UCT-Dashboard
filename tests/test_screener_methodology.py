"""The composite columns publish how they are computed — metric 552.

Family 32 (honesty / transparency) is one of the four we finished LAST of
thirteen in, and the scorecard's sharpest line about us is about these columns:
"the composites the benchmark already scored LACKS for having no published
methodology are ALSO the ones we cannot check — a member must simply trust
them, and so must we."
"""
import pytest

from api.services.research import ratings as R
from api.services.screener import methodology as M


# ── the property that makes this publishable at all ──────────────────────────

def test_the_published_weights_ARE_the_live_constant(monkeypatch):
    """⛔ THE ONE TEST THAT MATTERS. A published methodology that can drift from
    the code it describes is worse than none: it is a claim the member CAN
    check, that is wrong. Proven by MOVING the real constant and watching the
    published document follow — a retyped copy would not."""
    monkeypatch.setattr(R, "_COMPOSITE_WEIGHTS",
                        (("eps", 0.5), ("rs", 0.5)), raising=True)
    import importlib
    importlib.reload(M)
    try:
        comp = M.composite_method()
        assert [(c["key"], c["weight"]) for c in comp["components"]] == \
            [("eps", 0.5), ("rs", 0.5)]
        assert [c["share_pct"] for c in comp["components"]] == [50.0, 50.0]
    finally:
        importlib.reload(M)          # restore the real document


def test_the_shares_are_derived_and_sum_to_a_hundred():
    comp = M.composite_method()
    assert sum(c["share_pct"] for c in comp["components"]) == pytest.approx(100.0)
    for c in comp["components"]:
        live = dict(R._COMPOSITE_WEIGHTS)[c["key"]]
        assert c["weight"] == live


def test_the_band_tables_are_the_live_tables():
    comp = M.composite_method()
    assert len(comp["bands"]["rs"]) == len(R._RS_BANDS)
    assert comp["bands"]["eps"][0]["at_least"] == float(R._EPS_BANDS[0][0])
    assert comp["bands"]["growth"][0]["score"] == int(R._GROWTH_BANDS[0][1])


def test_every_weighted_component_has_prose():
    """A component added to the weights without a description must FAIL here
    rather than render a blank beside a number."""
    for key, _w in R._COMPOSITE_WEIGHTS:
        assert key in M._COMPONENT_PROSE, f"{key} carries weight and no words"


# ── what it publishes ────────────────────────────────────────────────────────

def test_it_covers_every_composite_the_benchmark_named():
    published = {m["column"] for m in M.all_methods()["methods"]}
    for named in ("uct_composite", "rs_rank", "accdis", "sponsorship",
                  "rating_eps", "rating_growth", "rating_value", "rating_smr"):
        assert named in published, f"{named} still ships without a method"


def test_every_entry_says_what_it_is_and_what_it_is_not():
    for m in M.all_methods()["methods"]:
        assert m.get("one_line"), m["column"]
        assert m.get("scale"), m["column"]
        assert m.get("how") or m.get("components"), m["column"]
        assert m.get("caveat") or m.get("not_claimed"), (
            f"{m['column']} publishes a method with no stated limit — the "
            "half that makes a methodology honest")


def test_the_composite_publishes_the_renormalisation_caveat():
    """🔴 The single most important thing a member can know about the number,
    and it is a FIELD rather than a footnote: two scores of 72 are not always
    the same measurement."""
    comp = M.composite_method()
    assert "renormalis" in comp["caveat"] or "renormaliz" in comp["caveat"]
    assert "not always the same measurement" in comp["caveat"]
    assert any("not comparable" in n or "not always" in n or "not a price"
               in n for n in comp["not_claimed"])


def test_it_never_claims_to_be_intraday():
    doc = M.all_methods()
    note = doc["as_of_note"]
    assert "03:00" in note and "intraday" in note
    assert "None of them" in note, "the disclaimer must cover EVERY method here"


def test_an_unknown_column_returns_None_not_an_empty_shell():
    assert M.for_column("not_a_column") is None
    assert M.for_column("") is None
    assert M.for_column(None) is None


def test_a_known_column_round_trips():
    assert M.for_column("uct_composite")["column"] == "uct_composite"
    assert M.for_column("rs_rank")["label"] == "RS Rank"


# ── 2026-10-18 screener column audit: the published method must be the live one

def test_the_ratings_are_percentiles_first():
    """🔴 The rating rows said "Mapped through a fixed band table". Measured on
    the prod snapshot, ~93% of `rating_eps`/`rating_growth` values are NOT a
    band score, because the computation ranks against the universe first. This
    holds the published sentence against the computation: with a distribution
    present the score is a percentile (not a band value), and the method says
    percentile and names the band table only as the fallback."""
    from api.services.research import ratings_db
    from api.services.screener import enrich
    vals = [float(i) for i in range(ratings_db.MIN_SAMPLE + 50)]
    dists = {m: {"values": vals, "n": len(vals)}
             for m in ("earnings_growth", "blended_growth")}
    out = enrich.ratings_fields({"earnings_growth": 37.0, "blended_growth": 37.0}, dists)
    band_scores = {s for _t, s in R._EPS_BANDS} | {s for _t, s in R._GROWTH_BANDS}
    assert out["rating_eps"] not in band_scores
    assert out["rating_growth"] not in band_scores
    for key in ("rating_eps", "rating_growth", "rating_smr", "rating_value"):
        how = M.for_column(key)["how"]
        assert how.startswith("Ranked as a 1-99 percentile"), (key, how)
        assert "only when no universe distribution" in how, (key, how)
    for k in ("eps", "growth"):
        assert "band table" not in M._COMPONENT_PROSE[k][1], k


def test_the_eps_rating_names_the_quarterly_definition():
    """The EPS input is yfinance `earningsGrowth`: latest quarter vs the
    year-ago quarter (measured 30/34 against FMP statements; TTM-over-TTM
    matched 4/34). The prose must not leave a member to assume TTM."""
    assert "same quarter a year earlier" in M._COMPONENT_PROSE["eps"][1]


def test_the_value_and_smr_ratings_say_whose_inputs_they_rank():
    """Measured: `rating_value` vs the PEG column, Spearman -0.33 (it ranks
    Yahoo's PEG, not FMP's); `rating_smr` vs the Op Mgn column 0.67."""
    assert "NOT the PEG column" in M._COMPONENT_PROSE["value"][1]
    assert "not from the Op Mgn and ROE" in M._COMPONENT_PROSE["smr"][1]


def test_the_sector_rs_scale_is_measured_off_the_rank_function(monkeypatch):
    """It said "0-100 percentile"; `ratings_db._rank` clamps to 1..99 and the
    prod range is exactly 1..99. Proven derived by MOVING `_rank`."""
    assert M.for_column("sector_rs_pct")["scale"].startswith("1-99 ")
    from api.services.research import ratings_db
    monkeypatch.setattr(ratings_db, "_rank",
                        lambda values, value: 5 if value < 0 else 95)
    assert M.for_column("sector_rs_pct")["scale"].startswith("5-95 ")


def test_the_rs_rank_weighting_is_read_from_the_formula(monkeypatch):
    """It said "trailing return"; the rank is of a 4-window weighted return.
    Proven derived by MOVING `RS_TERMS`."""
    from api.services import rs_weighted_return as rsw
    how = M.for_column("rs_rank")["how"]
    for label, _n, w in rsw.RS_TERMS:
        assert f"{round(100 * w)}% {label}" in how
    monkeypatch.setattr(rsw, "RS_TERMS", (("3m", 63, 0.7), ("1w", 5, 0.3)))
    how = M.for_column("rs_rank")["how"]
    assert "70% 3m, 30% 1w" in how


# ── 2026-11-06, Phase 2a unit 2a-08: the seventeen UCT Relative Strength columns

def _rs_columns():
    from api.services.screener import rs_columns, rs_post_pass, snapshot_builder
    return [*rs_columns.COLUMNS, *snapshot_builder._RS_HISTORY_COLUMNS,
            *rs_columns.PHASE3_COLUMNS, *rs_columns.EXIT_COLUMNS,
            *rs_post_pass.OWNED_COLUMNS]       # 2026-11-14: the RS screens post-pass, a fourth writer


def test_every_rs_column_publishes_a_method_with_a_stated_limit():
    """Derived from the two writers: a column either gains tomorrow fails here
    until it says what it is, on what scale, how, and what it is not."""
    doc = M.all_methods()
    published = {m["column"]: m for m in doc["methods"]}
    cols = _rs_columns()
    assert len(cols) == 35, cols        # 21 -> 26 on 2026-11-13: the five RS Exit Warning columns
    #        # 26 -> 35 on 2026-11-14: the nine RS screens columns `rs_post_pass.run` writes (unit U1)
    #        # 17 -> 20 on 2026-11-07: the Phase 3 three (unit 3-11); 20 -> 21 on 2026-11-10: rs_rating_9m (S1)
    for col in cols:
        m = published.get(col)
        assert m is not None, f"{col} ships without a method"
        assert m["family"] == M.RS_FAMILY, col
        for field in ("one_line", "scale", "how", "caveat"):
            assert m.get(field), (col, field)
        assert "Blank" in m["how"] or "blank" in m["how"], (col, "the method must say when it is blank")
        assert M.for_column(col)["column"] == col
    section = doc["rs_columns"]
    assert set(section["columns"]) == set(cols)
    assert "03:00" in section["timing"] and "04:15" in section["timing"]
    assert "lags" in section["timing"] and "intraday" in section["timing"]
    notes = " ".join(section["notes"])
    assert "DAILY" in notes and "never on weekly" in notes       # Mansfield's reading
    assert "TWO-benchmark" in notes and "RSP" in notes            # the agree column's two legs
    assert "not MarketSurge" in notes and "IBD-style" in notes    # whose number it is not
    assert "Denominator" in notes                                 # map §2.5 risk: 3,640 vs 11,230
    assert "not when to buy" in section["honesty"]
    assert "04:15" in doc["as_of_note"] and "None of them is an intraday" in doc["as_of_note"]


def test_the_rs_methods_are_read_from_the_collector(monkeypatch):
    """⛔ THE ONE TEST THAT MATTERS, again: proven derived by MOVING the real
    constants and watching the published words follow. A retyped copy would
    not."""
    from api.services import rs_weighted_return as rsw
    from api.services.screener import rs_columns, rs_history
    assert "200-session simple average" in M.for_column("mansfield")["how"]
    monkeypatch.setattr(rs_columns, "MANSFIELD_LENGTH", 150)
    assert "150-session simple average" in M.for_column("mansfield")["how"]
    assert "150 DAILY bars" in " ".join(M.all_methods()["rs_columns"]["notes"])
    monkeypatch.setattr(rs_columns, "GREEN_ON_RED_WINDOW", 15)
    assert M.for_column("green_on_red_20")["scale"] == "0-15"
    assert M.for_column("rs_rating_ibd")["scale"].startswith("1-99")
    monkeypatch.setattr(rs_history, "RATING_MAX", 50)
    assert M.for_column("rs_rating_ibd")["scale"].startswith("1-50")
    assert M.for_column("rs_rating_chg_5")["scale"] == "-49 to +49 points"
    monkeypatch.setattr(rsw, "IBD_TERMS", (("q1", 63, 0.7), ("q4", 252, 0.3)))
    how = M.for_column("rs_rating_ibd")["how"]
    assert "70% of the close over the close 63 sessions earlier" in how
    assert "30% of the close over the close 252 sessions earlier" in how
    assert "63-session term is required" in how


def test_the_rs_rating_says_whose_number_it_is_NOT_and_claims_no_figure(monkeypatch):
    """Plan §6.12 struck "±3-5 points vs MarketSurge" from member copy until
    measured; §7 item 17 prints the measured difference once known. Until the
    constant is set the prose says so, and quotes no number."""
    cav = M.for_column("rs_rating_ibd")["caveat"]
    assert "our own calculation" in cav and "not MarketSurge" in cav
    assert M.RS_RATING_VS_MARKETSURGE is None
    assert "not yet measured" in cav
    assert "±" not in cav and "3-5" not in cav and "3–5" not in cav
    monkeypatch.setattr(M, "RS_RATING_VS_MARKETSURGE", "median 2 points over 40 names, 2026-12-01")
    cav = M.for_column("rs_rating_ibd")["caveat"]
    assert "median 2 points over 40 names, 2026-12-01" in cav and "not yet measured" not in cav


# ── 2026-11-07, Phase 2b unit 2b-09: the Evidence subsection of the RS section

def _evidence():
    return M.all_methods()["rs_columns"]["evidence"]


def test_the_rs_section_publishes_the_five_statements_with_sources_and_cards():
    """Research base 03-evidence.md §b: five defensible statements, each with
    its source and the chart card that carries it."""
    ev = _evidence()
    assert ev["label"] == "Evidence"
    assert len(ev["statements"]) == 5
    for s in ev["statements"]:
        assert s["claim"] and s["source"] and s["card"], s
    assert {s["card"] for s in ev["statements"]} == {"rating", "regime", "benchmark", "sensitivity", "beforePrice"}
    sources = " ".join(s["source"] for s in ev["statements"])
    for name in ("Jegadeesh and Titman", "Asness, Frazzini, Israel and Moskowitz", "Daniel and Moskowitz",
                 "Dorsey Wright", "IBD", "Lyrical", "Bulkowski"):
        assert name in sources, name
    claims = " ".join(s["claim"] for s in ev["statements"])
    assert "not a guarantee" in claims and "falls faster" in claims and "78%" in claims and "41%" in claims


def test_the_measured_number_rule_is_read_from_the_pull_module(monkeypatch):
    """⛔ THE ONE TEST THAT MATTERS, a third time: the floor, the horizon, the
    honesty sentence and the survivorship note are the pull module's, proven by
    MOVING them and watching the published words follow."""
    from api.services import rs_evidence_pull as ep
    ev = _evidence()
    assert ev["measured"]["display_floor_n"] == ep.DISPLAY_FLOOR_N == 100
    assert ev["measured"]["horizon_bars"] == ep.DEFAULT_HORIZON == 63
    # Pin moved 2026-11-07 (unit VA3): "session", the sentence's own word, and the span rule.
    assert "at least 100 events" in ev["measured"]["rule"] and "complete 63-session window" in ev["measured"]["rule"]
    # 2026-11-07 (N6): the hit rate is stated with its base, in the pull's own phrase.
    assert ep.outcome_phrase("the benchmark", 63) in ev["measured"]["rule"]
    assert ep.outcome_phrase("<benchmark>", 63) in ev["measured"]["form"]
    assert "63 sessions later" in ev["measured"]["rule"] and "63 sessions later" in ev["measured"]["form"]
    assert ev["honesty"] == ep.HONESTY_SENTENCE
    assert ev["measured"]["rule"].endswith(ep.HONESTY_SENTENCE)
    assert ev["measured"]["survivorship"] == ep.SURVIVORSHIP_NOTE
    assert ev["measured"]["artifact"] == ep.ARTIFACT_KEY
    assert {(s["card"], s["signal"]) for s in ev["measured"]["signals"]} == set(ep.CARD_SIGNALS.items())
    assert all(s["label"] == ep.SIGNAL_LABELS[s["signal"]] for s in ev["measured"]["signals"])
    monkeypatch.setattr(ep, "DISPLAY_FLOOR_N", 250)
    monkeypatch.setattr(ep, "DEFAULT_HORIZON", 126)
    monkeypatch.setattr(ep, "HONESTY_SENTENCE", "Nothing measured.")
    monkeypatch.setattr(ep, "SURVIVORSHIP_NOTE", "universe as held, delistings restored")
    ev = _evidence()
    assert ev["measured"]["display_floor_n"] == 250 and "at least 250 events" in ev["measured"]["rule"]
    assert ev["measured"]["horizon_bars"] == 126 and "complete 126-session window" in ev["measured"]["rule"]
    assert "126 sessions later" in ev["measured"]["form"] and "63" not in ev["measured"]["form"]
    assert ev["honesty"] == "Nothing measured." and ev["measured"]["rule"].endswith("Nothing measured.")
    assert "universe as held, delistings restored" in ev["measured"]["rule"]
    assert ev["measured"]["form"].endswith("Universe as held, delistings restored.")


def test_the_rule_says_point_in_time_and_that_the_base_is_the_next_open():
    """`rs_evidence.measure`'s header: since owner decision N6 (2026-11-07) the
    base is the NEXT session's open, the first price a member who sees the dot
    after the close can act on (the signal close overstated what was tradeable),
    and a window holding an unadjusted split is left out (N5). The rule says so."""
    rule = _evidence()["measured"]["rule"]
    assert "point-in-time" in rule
    assert "starts at the next session's open" in rule and "can act on" in rule
    assert "signal bar's own close" not in rule and "cannot get" not in rule, "the old base is gone"
    assert "stock split" in rule and "left out and counted" in rule
    assert "not as a trade result" in rule
    assert "universe as held, survivorship not yet corrected" in rule
    assert "sample size" in rule and "dates" in rule and "median excess" in rule


def test_the_evidence_claims_none_of_the_forbidden_things():
    """The must-not-claim list (03-evidence.md §b) as a rail over the claims and
    the rule, and as a published `not_claimed` list that names what we refuse."""
    import re
    ev = _evidence()
    text = " ".join(s["claim"] for s in ev["statements"]) + " " + ev["measured"]["rule"] + " " + ev["honesty"]
    for pat in (r"\bpredicts?\b", "leading indicator", r"\b87\b", r"\b(80|85|90)\b", "validated", "win rate",
                r"\bguaranteed\b", "institutional buying"):
        assert not re.search(pat, text, re.I), pat
    assert "!" not in text
    assert len(ev["not_claimed"]) >= 5
    assert any("87" in n for n in ev["not_claimed"])
    assert any("validated threshold" in n for n in ev["not_claimed"])
    assert any("predicts" in n for n in ev["not_claimed"])
    assert any("net of" in n for n in ev["not_claimed"])


def test_the_evidence_subsection_rides_the_published_document():
    doc = M.all_methods()
    assert "evidence" in doc["rs_columns"]
    assert doc["rs_columns"]["evidence"]["honesty"]
    # and the RS section's own honesty line still stands beside it
    assert "not when to buy" in doc["rs_columns"]["honesty"]


# ── 2026-11-07, Phase 3 unit 3-11: the rotation quadrant, the Clenow score, VARS

def test_the_phase3_methods_print_whose_formula_and_say_they_are_empty_until_filled():
    from api.services.screener import rs_columns
    for col in rs_columns.PHASE3_COLUMNS:
        m = M.for_column(col)
        assert m is not None and m["family"] == M.RS_FAMILY, col
        assert "Empty until the nightly build fills it" in m["how"], col
        text = f" {m['how']} {m['caveat']} {m['one_line']} ".lower()
        for word in ("buy", "sell"):
            assert f" {word} " not in text, (col, word)
    rrg = M.for_column("rrg_quadrant")
    assert "RRG-style, UCT's formula" in rrg["how"]
    assert "RS = 100 x C / B" in rrg["how"]
    assert "RS-Ratio = 100 x RS / SMA(RS, 10)" in rrg["how"]
    assert "RS-Momentum = 100 x RS-Ratio / SMA(RS-Ratio, 5)" in rrg["how"]
    assert "split at 100" in rrg["how"] and "WEEKLY" in rrg["how"]
    assert rrg["scale"] == "Leading | Weakening | Lagging | Improving"
    clen = M.for_column("clenow_score")
    assert "Clenow-style, 90 trading days" in clen["how"] and "FRACTION" in clen["how"]
    vars_ = M.for_column("vars_state")
    assert "VARS-style" in vars_["how"] and "DAILY" in vars_["how"]
    assert vars_["scale"] == "Strong, rising | Strong, fading | Weak, improving | Weak, falling"
    notes = " ".join(M.all_methods()["rs_columns"]["notes"])
    assert "RRG-style, UCT's formula" in notes and "Clenow-style, 90 trading days" in notes
    assert "VARS-style" in notes and "empty until the nightly build fills them" in notes


def test_the_phase3_methods_are_read_from_the_writer(monkeypatch):
    """Proven derived by MOVING the writer's constants."""
    from api.services.screener import rs_columns
    monkeypatch.setattr(rs_columns, "RRG_RATIO_LEN", 12)
    monkeypatch.setattr(rs_columns, "CLENOW_WINDOW", 120)
    monkeypatch.setattr(rs_columns, "PHASE3_MIN_BARS",
                        {**rs_columns.PHASE3_MIN_BARS, "rrg_quadrant": 16})
    assert "SMA(RS, 12)" in M.for_column("rrg_quadrant")["how"]
    assert "Blank until 16 joined weeks" in M.for_column("rrg_quadrant")["how"]
    assert "Clenow-style, 120 trading days" in M.for_column("clenow_score")["how"]
