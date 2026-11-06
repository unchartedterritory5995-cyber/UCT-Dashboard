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
    from api.services.screener import rs_columns, snapshot_builder
    return [*rs_columns.COLUMNS, *snapshot_builder._RS_HISTORY_COLUMNS]


def test_every_rs_column_publishes_a_method_with_a_stated_limit():
    """Derived from the two writers: a column either gains tomorrow fails here
    until it says what it is, on what scale, how, and what it is not."""
    doc = M.all_methods()
    published = {m["column"]: m for m in doc["methods"]}
    cols = _rs_columns()
    assert len(cols) == 17, cols
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
