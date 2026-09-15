"""BL-008 — THE REGISTRY DECIDES MEMBERSHIP. SYNTAX NEVER DOES.

The rule these rails exist to pin: `NASDAQ:A50` is a Breadth Library symbol because
the registry CONTAINS that identity. `NASDAQ:AAPL` has the identical shape and is
not one. A test that can be satisfied by a string split has missed the point, so
every case below pairs a registered identity with an unregistered look-alike.
"""
import pytest

from api.services import breadth_metrics as bm
from api.services import breadth_symbols as bs
from api.services import breadth_universes as bu


@pytest.fixture()
def published_all(monkeypatch):
    """Publish every universe — what a future deploy flips, with no code change."""
    monkeypatch.setenv("BREADTH_LIBRARY_UNIVERSES", "*")
    return None


# ── membership comes from the registry ───────────────────────────────────────

def test_registered_identities_resolve_and_look_alikes_do_not(published_all):
    for good in ("NASDAQ:A50", "NYSE:NETHL", "US:A200", "US:A50", "NYSE:A50"):
        row = bs.resolve(good)
        assert row is not None, good
        assert row["symbol"] == good

    # ⛔ Same shape. Same colon. Not in the registry, so not a breadth symbol.
    for bad in ("NASDAQ:AAPL", "NYSE:MSFT", "FOO:BAR", "US:NOPE", "NASDAQ:",
                ":A50", "US:A50:EXTRA", "NASDAQ:A999"):
        assert bs.resolve(bad) is None, bad
        assert bs.is_breadth_symbol(bad) is False, bad


def test_a_metric_that_does_not_apply_to_a_universe_is_not_an_identity(published_all):
    # `cnn_fear_greed` is a survey; `new_ath` is not reconstructable. Both are UCT's
    # alone, so their namespaced spellings were never minted.
    assert bs.resolve("UCTFG") is not None
    assert bs.resolve("NASDAQ:FG") is None
    assert bs.resolve("US:ATH") is None
    assert bs.resolve("NYSE:HS") is None


def test_the_published_gate_is_what_makes_the_library_dark(monkeypatch):
    monkeypatch.delenv("BREADTH_LIBRARY_UNIVERSES", raising=False)
    # Dark: the catalogue knows the identity, the serve path does not admit it.
    assert bs.resolve("NASDAQ:A50", published_only=False) is not None
    assert bs.resolve("NASDAQ:A50") is None
    assert bs.is_breadth_symbol("NASDAQ:A50") is False

    monkeypatch.setenv("BREADTH_LIBRARY_UNIVERSES", "us")
    assert bs.is_breadth_symbol("US:A50") is True
    assert bs.is_breadth_symbol("NASDAQ:A50") is False     # still unpublished

    # ⛔ And publishing NEVER admits an unregistered look-alike.
    monkeypatch.setenv("BREADTH_LIBRARY_UNIVERSES", "*")
    assert bs.is_breadth_symbol("NASDAQ:AAPL") is False


def test_a_typo_in_the_flag_cannot_take_the_shipped_symbols_off_the_air(monkeypatch):
    monkeypatch.setenv("BREADTH_LIBRARY_UNIVERSES", "nasdac,gibberish")
    assert bu.published_universe_ids() == ["uct"]
    assert bs.is_breadth_symbol("UCTA50") is True


# ── UCT backward compatibility ───────────────────────────────────────────────

def test_every_shipped_uct_symbol_still_resolves_exactly_as_before(monkeypatch):
    monkeypatch.delenv("BREADTH_LIBRARY_UNIVERSES", raising=False)
    assert len(bs.SYMBOLS) == 44
    for sym, rec in bs.SYMBOLS.items():
        assert bs.is_breadth_symbol(sym) is True, sym
        assert bs._METRIC_OF[sym] == rec["metric"]
    # and the public catalogue endpoint's payload is unchanged
    listed = bs.list_breadth_symbols()
    assert len(listed) == 44
    assert all(":" not in r["symbol"] for r in listed)


def test_uct_is_served_from_the_fast_path_not_from_the_registry(monkeypatch):
    """⭐ The backward-compatibility guarantee: no flag, no catalogue edit and no
    registry failure can take a shipped symbol off the air."""
    monkeypatch.setattr(bs, "resolve", lambda *a, **k: None)
    assert bs.is_breadth_symbol("UCTA50") is True
    assert bs.is_breadth_symbol("UCTNH") is True


def test_ordinary_tickers_are_untouched():
    for sym in ("AAPL", "QQQ", "SPY", "UCTT", "BRK.B", "RDS-A", "^VIX", ""):
        assert bs.is_breadth_symbol(sym) is False, sym


# ── aliases are an explicit table ────────────────────────────────────────────

def test_uct_namespaced_spelling_is_an_explicit_alias_to_the_legacy_symbol():
    aliases = bs.library_aliases()
    assert aliases["UCT:A50"] == "UCTA50"
    assert aliases["UCT:NH"] == "UCTNH"
    assert aliases["UCT:AAII"] == "UCTAAII"
    row = bs.resolve("UCT:A50")
    # ⭐ It resolves TO the canonical symbol — `UCTA50` stays canonical, nothing is
    # renamed, and no stored layout or formula has to change.
    assert row["symbol"] == "UCTA50"
    assert row["matched_alias"] == "UCT:A50"
    assert row["metric"] == "pct_above_50sma"


def test_an_alias_exists_only_where_the_registry_puts_one():
    assert bs.resolve("UCT:NETHL") is None      # UCT never published a Net H-L
    assert bs.resolve("UCT:AAPL") is None
    assert bs.resolve("UCT:NOPE") is None


# ── canonical rendering is deterministic ─────────────────────────────────────

def test_symbol_rendering_is_deterministic_and_collision_free():
    rows = bs.library_rows()
    syms = [r["symbol"] for r in rows if r["symbol"]]
    assert len(syms) == len(set(syms)), "two identities rendered the same symbol"
    # stable across calls
    assert [r["symbol"] for r in bs.library_rows()] == [r["symbol"] for r in rows]
    # identity → symbol is a function
    for r in rows:
        assert bs.symbol_for(r["universe"], r["metric"]) == r["symbol"]


def test_a_namespaced_identity_never_collides_with_a_shipped_uct_symbol():
    shipped = set(bs.SYMBOLS)
    minted = {r["symbol"] for r in bs.library_rows()
              if r["symbol"] and not r["legacy"]}
    assert not (shipped & minted)


def test_the_registry_is_the_product_of_universes_and_applicable_metrics():
    rows = bs.library_rows()
    assert len(rows) == sum(len(bm.metrics_for(u)) for u in bu.UNIVERSE_IDS)


# ── the hot path ─────────────────────────────────────────────────────────────

def test_an_ordinary_ticker_is_answered_without_rebuilding_the_catalogue():
    """⚰️ `is_breadth_symbol` sits on the /api/bars hot path and is asked about
    EVERY ticker. Falling through to a freshly-built 156-row projection measured
    404 us per call against 0.09 us for a UCT symbol — a ~4,500x regression paid on
    every chart request in the product, to answer "no"."""
    import time
    bs.is_breadth_symbol("AAPL")            # warm the memo
    t0 = time.perf_counter()
    for _ in range(5000):
        bs.is_breadth_symbol("AAPL")
    per_us = (time.perf_counter() - t0) / 5000 * 1e6
    # Generous bound: the point is "a dict lookup", not a specific machine's number.
    assert per_us < 25, f"{per_us:.1f} us/call — the projection is being rebuilt"


def test_the_memo_is_the_same_object_and_still_correct():
    first, second = bs._library_index(), bs._library_index()
    assert first is second
    assert first["NASDAQ:A50"]["metric"] == "pct_above_50sma"
    # ⛔ The PUBLISHED gate is applied per lookup, NOT baked into the memo — it
    # reads an env var, and a memoised gate would freeze the first test's setting.
    import os
    os.environ.pop("BREADTH_LIBRARY_UNIVERSES", None)
    assert bs.resolve("NASDAQ:A50") is None
    os.environ["BREADTH_LIBRARY_UNIVERSES"] = "*"
    try:
        assert bs.resolve("NASDAQ:A50") is not None
    finally:
        os.environ.pop("BREADTH_LIBRARY_UNIVERSES", None)
