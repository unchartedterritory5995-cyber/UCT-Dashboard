"""PRODUCTS — one member-facing thing made of several canonical series.

⭐⭐ THE TWO CASES THAT MATTER MOST HERE WERE BOTH FOUND IN A BROWSER, NOT BY A UNIT
TEST, and both are the same mistake in different clothes: "hidden from the list" was
implemented as "absent from the payload", which is a different and much stronger
claim. One of them offered CANDLES ON A WEEKLY SURVEY. They are railed first.

⛔ AND THE AAII SOURCE GATE IS ASSERTED AS A PROPERTY, not as a row count: the three
components must be READ from their own stored keys and must never be recoverable from
the Bull-Bear Spread. One equation, three unknowns — the arithmetic forbids it, and
`aaii_store` cannot even see the spread. This test states that in code.
"""
from __future__ import annotations

import pytest

from api.services.market_indicators import discovery as disc
from api.services.market_indicators import registry as reg


# ── The two browser-found defects ───────────────────────────────────────────

def test_components_are_hidden_from_the_list_but_still_shipped():
    """⚰️ MEASURED IN A BROWSER. Dropping components from the payload made them
    invisible to the CLIENT CLASSIFIER too, so `canonicalFamily('AAII:BULLS')`
    answered `security` and Candles were offered over a weekly survey."""
    cat = disc.catalogue(include_breadth=False)
    listed = {r["id"] for r in cat["rows"]}
    shipped = {r["id"] for r in cat.get("components", [])}

    assert reg.PRODUCT_COMPONENT_IDS, "no products registered — this rail is vacuous"
    for cid in reg.PRODUCT_COMPONENT_IDS:
        assert cid not in listed, f"{cid} must not be browsable — its product is"
        assert cid in shipped, (
            f"{cid} must still SHIP so the client can CLASSIFY it; absent, every "
            f"capability gate falls through to 'ordinary security'")


def test_a_shipped_component_carries_what_a_capability_gate_reads():
    """A classifier needs the fields the gate actually branches on, not just an id."""
    cat = disc.catalogue(include_breadth=False)
    by_id = {r["id"]: r for r in cat.get("components", [])}
    for cid in reg.PRODUCT_COMPONENT_IDS:
        row = by_id[cid]
        assert row["source_type"] == reg.SRC_SURVEY
        assert row["ohlc_capable"] is False, f"{cid} is a survey and cannot mean candles"
        assert row["presentation"], f"{cid} must say how it wants to be drawn"


def test_the_product_row_carries_its_components_member_facing_names():
    """⚰️ MEASURED IN A BROWSER. Without these the client derives each label from the
    SOURCE and the pane legend prints `AAII:BULLS` — an internal address in the one
    place a member reads."""
    row = next(r for r in disc.catalogue(include_breadth=False)["rows"]
               if r.get("kind") == "product")
    names = row["component_rows"]
    assert [c["id"] for c in names] == row["components"]
    for c in names:
        assert c["display"] and ":" not in c["display"]
        assert c["short"] and ":" not in c["short"]


# ── The product model ───────────────────────────────────────────────────────

def test_searching_the_product_returns_exactly_one_row():
    """The whole product decision, in one assertion."""
    hits = disc.search("AAII", limit=20, include_breadth=False)
    assert len(hits) == 1, [h["display"] for h in hits]
    assert hits[0]["id"] == "AAII:SURVEY"


@pytest.mark.parametrize("q", ["bullish", "bearish", "neutral", "individual investor"])
def test_a_components_own_words_find_its_product(q):
    """⭐ The component row that carries the word is deliberately unlisted, so without
    the product inheriting its components' tokens the most specific query returns
    nothing at all."""
    hits = disc.search(q, limit=20, include_breadth=False)
    assert any(h["id"] == "AAII:SURVEY" for h in hits), q


def test_components_still_resolve_even_though_they_are_unlisted():
    """⛔ Browsability and resolution are different questions. `/api/bars/AAII:BULLS`
    must serve."""
    for cid in reg.PRODUCT_COMPONENT_IDS:
        assert reg.resolve(cid) is not None
        assert reg.get(cid) is not None


def test_a_product_is_not_a_SERIES_but_is_a_chart_identity():
    """⭐⭐ THIS RULE CHANGED, DELIBERATELY, AND THE OLD HALF IS KEPT.

    V1 said "a product is not a ticker" and refused it everywhere, because a product
    has no bars of its own and typing it would have produced an empty chart. The
    accepted requirement is now that `AAII Sentiment Survey` opens AS A PRIMARY CHART,
    so the refusal moved rather than disappeared:

      `resolve()`              still None — it is not a SERIES, and a caller that
                               wanted one must not silently receive this
      `is_market_indicator()`  now True   — it IS a chart identity, and every routing
                               decision must send it to the library rather than to
                               bars.db, which has no rows for it

    ⛔ The bars it serves are its PRIMARY COMPONENT's, under its own ticker. Nothing
    anywhere invents a bar for a product.
    """
    assert reg.resolve("AAII:SURVEY") is None
    from api.routers.bars import _is_market_indicator
    assert _is_market_indicator("AAII:SURVEY") is True
    for cid in reg.PRODUCT_COMPONENT_IDS:
        assert _is_market_indicator(cid) is True


def test_a_product_refuses_to_exist_if_its_components_disagree():
    """⛔ One pane and one scale is a claim about the DATA. `product_row` reports a
    unit only when every component agrees, so a mixed product cannot silently claim
    a shared axis."""
    row = next(r for r in disc.catalogue(include_breadth=False)["rows"]
               if r.get("kind") == "product")
    units = {reg.get(c).unit for c in row["components"]}
    domains = {reg.get(c).domain for c in row["components"]}
    assert len(units) == 1 and row["unit"] == units.pop()
    assert len(domains) == 1 and row["domain"] == domains.pop()


# ── The survey stream seam ──────────────────────────────────────────────────

def test_every_survey_declares_its_own_stream():
    """⚰️ `daily_bars` dispatched `SRC_SURVEY` to `naaim_store` outright. With a second
    survey that becomes AAII served NAAIM's numbers under AAII's name — a plausible
    line, on a chart, with no error anywhere."""
    surveys = [s for s in reg._ROWS if s.source_type == reg.SRC_SURVEY]
    assert len(surveys) > 1, "one survey makes this rail vacuous"
    keys = [s.survey_key for s in surveys]
    assert all(keys), "a survey with no stream serves silence"
    assert len(set(keys)) == len(keys), f"two surveys share a stream: {keys}"


def test_a_survey_without_a_stream_is_refused_at_construction():
    with pytest.raises(ValueError, match="survey_key"):
        reg.Series(id="X:Y", family=reg.FAM_SENTIMENT, source_type=reg.SRC_SURVEY,
                   frequency=reg.FREQ_WEEKLY, unit=reg.UNIT_PERCENT,
                   domain=reg.DOMAIN_PCT, display="X", short="X")


def test_a_non_survey_may_not_declare_a_stream():
    with pytest.raises(ValueError, match="not a survey"):
        reg.Series(id="X:Y", family=reg.FAM_SENTIMENT,
                   source_type=reg.SRC_BREADTH_DERIVED,
                   frequency=reg.FREQ_DAILY, unit=reg.UNIT_PERCENT,
                   domain=reg.DOMAIN_PCT, display="X", short="X",
                   survey_key="aaii_bulls")


def test_an_unknown_stream_serves_nothing_rather_than_another_surveys_numbers():
    from api.services.market_indicators import series as ms

    class _Row:
        id = "X:Y"
        survey_key = "not_a_real_stream"
    assert ms.survey_observations(_Row()) == []


# ── The AAII source gate, as a property ─────────────────────────────────────

def test_the_aaii_reader_cannot_see_the_spread():
    """⛔⛔ THE ONE FORBIDDEN MOVE, MADE UNAVAILABLE RATHER THAN MERELY AVOIDED.
    Deriving three components from one spread is one equation in three unknowns; this
    asserts the reader is not even wired to the spread it would have to start from."""
    from api.services.market_indicators import aaii_store
    assert "aaii_spread" not in aaii_store.COMPONENT_KEYS
    assert aaii_store.observations("aaii_spread") == []


def test_the_existing_bull_bear_spread_is_untouched():
    """§6A: members already use it. It stays a breadth pseudo-ticker, not a component."""
    from api.services import breadth_symbols as bs
    assert bs.resolve("UCTAAII") or "UCTAAII" in str(bs.__dict__.get("_METRIC_OF", {}))
    assert reg.resolve("UCTAAII") is None, "the spread must not become a market indicator"


def test_the_components_are_dated_by_the_survey_not_by_the_snapshot():
    """⛔ A snapshot is written every trading day and CARRIES the standing weekly
    reading. Keying on its date would manufacture five observations a week."""
    from api.services.market_indicators import aaii_store
    assert aaii_store._SURVEY_DATE_KEY == "aaii_survey_date"
    # An undated snapshot reading is skipped, never dated by its own row.
    assert aaii_store._iso10(None) is None
    assert aaii_store._iso10("2026-01-01T00:00:00") == "2026-01-01"
    assert aaii_store._iso10("not-a-date") is None


# ── A PRODUCT AS A PRIMARY-CHART IDENTITY ───────────────────────────────────

@pytest.mark.parametrize("spelling", [
    "AAII", "aaii", "AAII:SURVEY", "aaii:survey",
    "AAII Sentiment Survey", "  AAII   Sentiment   Survey  ", "AAII SENTIMENT",
])
def test_a_member_facing_spelling_resolves_to_the_product(spelling):
    """⭐ THE MEMBER TYPES A NAME, NOT AN INTERNAL ID. A primary-symbol search must
    accept the words a member actually knows."""
    p = reg.resolve_product(spelling)
    assert p is not None and p.id == "AAII:SURVEY", spelling


def test_a_product_spelling_is_never_mistaken_for_a_series():
    """⛔ `resolve()` is the SERIES authority and must keep refusing a product — a
    caller that wanted something with bars must not silently get something without."""
    for spelling in ("AAII", "AAII:SURVEY", "AAII Sentiment Survey"):
        assert reg.resolve(spelling) is None


def test_ordinary_symbols_are_not_products():
    for t in ("QQQ", "NAAIM", "US:MCO", "UCTAAII", "", None):
        assert reg.resolve_product(t) is None


def test_the_product_routes_as_a_market_indicator():
    """⛔⛔ EVERY ROUTING DECISION MUST SAY YES. `is_market_indicator` is the oracle
    all three doors in `api/routers/bars.py` consult; a no here sends the product down
    the ordinary bars path, which has no rows for it, and the member gets the
    cacheable `200 + bars: []` that blanked every market-indicator chart in V1."""
    from api.routers.bars import _is_market_indicator
    for t in ("AAII:SURVEY", "AAII"):
        assert _is_market_indicator(t) is True
    assert _is_market_indicator("QQQ") is False


def test_the_product_serves_its_primary_component_under_its_own_ticker():
    """⛔ THE TICKER STAYS THE PRODUCT'S. A chart that asked for `AAII:SURVEY` must get
    `AAII:SURVEY` back — the client matches the reply against its request, and handing
    back `AAII:BULLS` would read as a wrong-symbol answer and be discarded by the very
    guards the atomic handoff added."""
    from api.services.market_indicators import series as ms
    out = ms.build_bars("AAII:SURVEY", "D", 50)
    assert out["ticker"] == "AAII:SURVEY"
    prod = reg.get_product("AAII:SURVEY")
    assert prod.primary_component == prod.components[0]
    # Same numbers as the component it names — it serves that series, it invents none.
    comp = ms.build_bars(prod.primary_component, "D", 50)
    assert out["bars"] == comp["bars"]


def test_the_product_declares_the_aliases_its_search_ranking_depends_on():
    """⚰️ WHY THIS IS A RAIL. `discovery.search` scores an ALIAS match as tier 0, which
    `ticker_search` reads as `symbol_hit` to rank a row at the FRONT. With synonyms
    alone the product scored >= 2 and sat behind every general match — surviving only
    as long as nothing truncated the list."""
    p = reg.get_product("AAII:SURVEY")
    assert "AAII" in p.aliases
    hits = disc.search("AAII", limit=20, include_breadth=False)
    assert hits and hits[0]["id"] == "AAII:SURVEY"
    assert hits[0].get("symbol_hit") is True
