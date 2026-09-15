"""Discovery over the library: the query shapes the eventual UX must support.

⭐ The UX principle under test is HUMAN METRIC FIRST, UNIVERSE SECOND, SYMBOL
AVAILABLE BUT NOT DOMINANT — so these rails check ORDER and SHAPE, not just
membership. A result set that contains the right rows in ticker-soup order has
failed the thing the library exists to fix.
"""
import pytest

from api.services import breadth_metrics as bm
from api.services import breadth_symbols as bs
from api.services import breadth_universes as bu


def names(rows):
    return [r["name"] for r in rows]


def syms(rows):
    return [r["symbol"] for r in rows]


# ── the owner's worked query shapes ──────────────────────────────────────────

def test_50_MA_finds_the_A50_family_across_every_universe_first():
    rows = bs.library_search("50 MA", limit=8)
    assert syms(rows)[:4] == ["UCTA50", "US:A50", "NASDAQ:A50", "NYSE:A50"]
    assert all(r["name"] == "% of Stocks Above 50-Day MA" for r in rows[:4])


def test_above_50_finds_the_same_family_by_human_words():
    assert syms(bs.library_search("above 50")) == [
        "UCTA50", "US:A50", "NASDAQ:A50", "NYSE:A50"]


def test_A50_finds_every_A50_universe_and_nothing_else():
    rows = bs.library_search("A50")
    assert syms(rows) == ["UCTA50", "US:A50", "NASDAQ:A50", "NYSE:A50"]
    assert all(r["symbol_hit"] for r in rows)


def test_nasdaq_breadth_lists_the_nasdaq_library():
    rows = bs.library_search("NASDAQ breadth", limit=200)
    assert rows and all(r["universe"] == "nasdaq" for r in rows)
    # ⚠️ "breadth" names the LIBRARY, not a metric — requiring it inside a metric's
    # own text would return the one metric called "UCT Breadth Health Score".
    assert len(rows) == len(bm.metrics_for("nasdaq"))


def test_a_bare_universe_word_lists_that_universe():
    for uni in ("US", "NYSE", "NASDAQ"):
        rows = bs.library_search(uni, limit=200)
        assert rows and all(r["universe_label"] == uni for r in rows)


def test_high_low_finds_the_family_metric_first_universe_second():
    rows = bs.library_search("high low", limit=16)
    # ⭐ Net New High-Low leads: its OWN name carries both words, and the
    # metric-own-text tier outranks a family-label match. New Highs and New Lows
    # follow through the family label they share ("Highs / Lows") — the query still
    # finds all three, which is what the member asked for.
    assert names(rows)[:3] == ["Net New 52-Week Highs-Lows"] * 3
    assert "New 52-Week Highs" in names(rows)
    assert "New 52-Week Lows" in names(rows)
    # and within a metric, the universes stay adjacent and in canonical order
    nh = [r for r in rows if r["metric"] == "new_52w_highs"]
    assert [r["universe_label"] for r in nh] == ["UCT", "US", "NASDAQ", "NYSE"]


def test_the_metrics_own_name_outranks_its_familys(tmp_path=None):
    """⭐ The tier that makes "new lows" answer with New Lows.

    Without it both New Highs and New Lows match only through the family label they
    share, the tie breaks on catalogue order, and the member who typed "lows" is
    shown "New 52-Week Highs" first."""
    assert names(bs.library_search("new lows"))[0] == "New 52-Week Lows"
    assert names(bs.library_search("new highs"))[0] == "New 52-Week Highs"


def test_an_exact_identity_returns_exactly_that_series():
    for q, sym in (("NASDAQ:A50", "NASDAQ:A50"), ("US:NETHL", "US:NETHL"),
                   ("NYSE:A200", "NYSE:A200"), ("UCTA50", "UCTA50")):
        rows = bs.library_search(q)
        assert syms(rows) == [sym], q
        assert rows[0]["score"] == 0 and rows[0]["symbol_hit"] is True


def test_the_uct_alias_spelling_resolves_to_the_canonical_symbol():
    rows = bs.library_search("UCT:A50")
    assert syms(rows) == ["UCTA50"]


def test_an_unregistered_colon_token_finds_nothing():
    for bad in ("NASDAQ:AAPL", "FOO:BAR", "US:NOPE"):
        assert bs.library_search(bad) == [], bad


# ── shape, metadata and determinism ──────────────────────────────────────────

def test_a_result_leads_with_the_human_metric_and_carries_the_universe_badge():
    row = bs.library_search("NASDAQ:A50")[0]
    assert row["name"] == "% of Stocks Above 50-Day MA"   # dominant
    assert row["universe_label"] == "NASDAQ"              # compact qualifier
    assert row["symbol"] == "NASDAQ:A50"                  # available, secondary
    assert row["group_label"] == "MA Breadth"             # family, for grouping
    assert row["short_name"] == "A50"


def test_every_result_carries_the_metadata_a_chart_needs():
    for row in bs.library_search("high low", limit=50):
        assert row["unit"] in {"percent", "count", "ratio", "index", "points"}
        assert row["domain"] in {"pct_0_100", "nonneg", "signed", "ratio"}
        assert row["presentation"] in {"line", "histogram"}
        assert "floor" in row and "legacy" in row


def test_the_historical_floor_travels_with_the_result():
    floors = {r["universe_label"]: r["floor"] for r in bs.library_search("A50")}
    assert floors == {"UCT": None, "US": "2008-01-02",
                      "NASDAQ": "2011-01-01", "NYSE": "2011-01-01"}
    # ⛔ so nothing downstream can imply NASDAQ has pre-2011 history


def test_search_is_deterministic_and_free_of_duplicate_identities():
    for q in ("high low", "50 MA", "NASDAQ", "A50", ""):
        a, b = bs.library_search(q, limit=50), bs.library_search(q, limit=50)
        assert syms(a) == syms(b), q
        keys = [(r["universe"], r["metric"]) for r in a]
        assert len(keys) == len(set(keys)), q


def test_an_empty_query_returns_nothing_rather_than_the_whole_library():
    assert bs.library_search("") == []
    assert bs.library_search("   ") == []


def test_limit_is_honoured():
    assert len(bs.library_search("high low", limit=3)) == 3


# ── applicability and the dark gate ──────────────────────────────────────────

def test_non_portable_metrics_never_appear_under_a_pit_universe():
    for q in ("fear", "put call", "AAII", "exposure", "all-time"):
        for row in bs.library_search(q, limit=50):
            assert row["universe"] == "uct", (q, row["symbol"])


def test_published_only_is_what_a_live_surface_would_use(monkeypatch):
    monkeypatch.delenv("BREADTH_LIBRARY_UNIVERSES", raising=False)
    assert bs.library_search("A50", published_only=True) and all(
        r["universe"] == "uct"
        for r in bs.library_search("A50", published_only=True))
    # the catalogue still knows the rest
    assert len(bs.library_search("A50")) == 4

    monkeypatch.setenv("BREADTH_LIBRARY_UNIVERSES", "us")
    got = {r["universe"] for r in bs.library_search("A50", published_only=True)}
    assert got == {"uct", "us"}


def test_the_live_search_surface_is_still_unchanged_and_dark():
    """⛔ `search()` is what /api/ticker-search calls. It must still answer with the
    44 shipped UCT symbols and no colon."""
    for q in ("A50", "NASDAQ", "50", "high"):
        for r in bs.search(q, 40):
            assert ":" not in r["ticker"], (q, r["ticker"])
