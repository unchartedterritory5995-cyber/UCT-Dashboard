"""The Breadth Library projection — and the promise that it is not yet public.

⛔ The load-bearing rail in this file is the LAST one: nothing a member can reach
has learned about namespaced symbols. The projection exists so the shape can be
proven before anything is published.
"""
from api.services import breadth_metrics as bm
from api.services import breadth_symbols as bs
from api.services import breadth_universes as bu


def test_uct_symbols_come_from_the_recorded_alias_table_not_from_a_rule():
    # ⭐ No naming rule produces these three from their metric keys; that is exactly
    # why the mapping is data.
    assert bs.symbol_for("uct", "pct_above_50sma") == "UCTA50"
    assert bs.symbol_for("uct", "new_20d_highs") == "UCTNH20"
    assert bs.symbol_for("uct", "aaii_spread") == "UCTAAII"
    # and every shipped symbol round-trips through the table
    for sym, rec in bs.SYMBOLS.items():
        assert bs.symbol_for("uct", rec["metric"]) == sym


def test_the_new_universes_derive_a_systematic_symbol():
    assert bs.symbol_for("us", "pct_above_50sma") == "US:A50"
    assert bs.symbol_for("nasdaq", "pct_above_50sma") == "NASDAQ:A50"
    assert bs.symbol_for("nyse", "pct_above_200sma") == "NYSE:A200"
    assert bs.symbol_for("us", "net_new_high_low") == "US:NETHL"


def test_a_metric_uct_never_published_has_no_uct_symbol():
    # ⛔ Net New High-Low is new. A freshly invented `UCTNHL` would be a public
    # naming decision nobody made.
    assert bs.symbol_for("uct", "net_new_high_low") is None
    assert "net_new_high_low" not in bs.LEGACY_SYMBOL_BY_METRIC


def test_a_non_portable_metric_has_no_symbol_in_a_pit_universe():
    for metric in ("cnn_fear_greed", "uct_exposure", "breadth_score", "new_ath"):
        assert bs.symbol_for("nasdaq", metric) is None, metric
        assert bs.symbol_for("uct", metric) is not None, metric


def test_the_projection_carries_universe_and_metric_as_the_truth():
    rows = bs.library_rows()
    row = next(r for r in rows if r["universe"] == "nasdaq"
               and r["metric"] == "pct_above_50sma")
    # The identity is the PAIR; the symbol is a rendering of it.
    assert row["universe"] == "nasdaq" and row["metric"] == "pct_above_50sma"
    assert row["symbol"] == "NASDAQ:A50"
    assert row["name"] == "% of Stocks Above 50-Day MA"
    assert row["unit"] == bm.UNIT_PERCENT and row["domain"] == bm.DOMAIN_PCT
    assert row["floor"] == "2011-01-01"
    assert row["legacy"] is False


def test_a_uct_row_is_flagged_legacy_and_keeps_its_floorless_history():
    rows = {(r["universe"], r["metric"]): r for r in bs.library_rows()}
    uct = rows[("uct", "pct_above_50sma")]
    assert uct["legacy"] is True and uct["symbol"] == "UCTA50"
    assert uct["floor"] is None          # this project does not recompute UCT


def test_the_signed_metric_declares_its_own_presentation_in_the_projection():
    row = next(r for r in bs.library_rows(["us"]) if r["metric"] == "net_new_high_low")
    assert row["domain"] == bm.DOMAIN_SIGNED
    assert row["presentation"] == bm.PRES_HISTOGRAM
    # ⛔ so a renderer asks the CATALOGUE how to draw it, never the ticker string
    assert row["symbol"] == "US:NETHL"


def test_the_projection_is_a_product_of_its_two_sources():
    rows = bs.library_rows()
    assert len(rows) == sum(len(bm.metrics_for(u)) for u in bu.UNIVERSE_IDS)
    # ⚠️ THE INVARIANT, NOT A SNAPSHOT. This pinned the exact set
    # `{"net_new_high_low"}` and went red the moment the catalogue legitimately grew
    # (Phase 6 added the base/component counts so applicability could be metadata
    # rather than a scattered exception). The rule that actually matters is: a row
    # lacks a symbol EXACTLY when it is a UCT row for a metric UCT never published
    # as a chartable pseudo-ticker.
    missing = [r for r in rows if r["symbol"] is None]
    assert all(r["universe"] == "uct" for r in missing)
    assert {r["metric"] for r in missing} == (
        set(bm.METRIC_KEYS) - set(bs.LEGACY_SYMBOL_BY_METRIC))
    assert "net_new_high_low" in {r["metric"] for r in missing}


def test_selecting_universes_narrows_the_projection():
    assert {r["universe"] for r in bs.library_rows(["us", "nyse"])} == {"us", "nyse"}
    # ⚠️ An EMPTY selection means "no filter", not "no rows" — `universes or ALL`.
    # Stated as a rail because the two readings differ by everything.
    assert bs.library_rows([]) == bs.library_rows(None) == bs.library_rows()


# ── the boundary ─────────────────────────────────────────────────────────────

def test_NOTHING_PUBLIC_has_learned_about_namespaced_symbols():
    """⛔⛔ The gate for this phase. The projection exists; the product does not."""
    # routing still answers only for the 44 shipped UCT symbols
    assert bs.is_breadth_symbol("UCTA50") is True
    for sym in ("US:A50", "NASDAQ:A50", "NYSE:A50", "US:NETHL"):
        assert bs.is_breadth_symbol(sym) is False, sym

    # the public catalogue endpoint's payload is unchanged
    listed = bs.list_breadth_symbols()
    assert len(listed) == len(bs.SYMBOLS) == 44
    assert all(":" not in r["symbol"] for r in listed)

    # and search cannot surface one
    for q in ("US:A50", "NASDAQ", "NETHL"):
        assert all(":" not in r["ticker"] for r in bs.search(q, 20))
