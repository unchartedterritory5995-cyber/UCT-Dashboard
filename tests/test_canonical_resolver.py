"""D2 CP3 (TERM-020) — the resolver's rails.

Every store is exercised through its REAL public reader against a throwaway
file (bars via `bars_sqlite._DB_PATH`, the screener via `SCREENER_DB_PATH`,
breadth via `BREADTH_MONITOR_DB`). Only Entity Master is stubbed, because its
answer is the independent variable of the entity tests.

The acceptance criteria, by name:
  (a) `test_the_ten_desk_figures_each_resolve_with_a_stable_id_an_as_of_and_inputs`
  (b) `test_an_unknown_address_returns_a_status_and_NEVER_a_plausible_value`
      (+ the clamp and the ordinal traps below it)
  (c) lives in `tests/test_canonical_address_book.py` (the named-reader rail)
"""
from __future__ import annotations

import json

import pytest

from api.services import bars_sqlite, breadth_monitor
from api.services.cache import cache
from api.services.canonical import address_book, resolver
from api.services.entity_master import api as em
from api.services.screener import snapshot_db

TICKER = "AAPL"

# Values chosen so that NO two columns of the fixture bar share a value — a
# wrong ordinal cannot land on the right number by accident.
_BARS_D = [
    {"t": "2026-09-23", "o": 101.0, "h": 104.0, "l": 99.0, "c": 103.0, "v": 1_000_001},
    {"t": "2026-09-24", "o": 111.0, "h": 114.0, "l": 109.0, "c": 113.0, "v": 1_000_002},
    {"t": "2026-09-25", "o": 121.0, "h": 124.0, "l": 119.0, "c": 123.0, "v": 1_000_003},
]
_SCREENER_ROW = {
    "ticker": TICKER, "chg_pct_1d": 1.25, "pct_vs_sma50": 7.5,
    "dist_52w_high_pct": -3.2, "adr_pct": 2.9, "market_cap": 3.1e12,
    "rs_rank": 88.0, "above_50sma": 1, "bars_asof": "20260925",
    "snapshot_date": "2026-09-26",
}
_BREADTH = {
    "2026-09-24": {"pct_above_50sma": 55.5, "uct_exposure": 70, "up_4pct_today": 10,
                   "down_4pct_today": 20, "new_52w_highs_list": ["X"]},
    "2026-09-25": {"pct_above_50sma": 61.25, "uct_exposure": 85, "up_4pct_today": 30,
                   "down_4pct_today": 5, "new_52w_highs_list": ["Y"]},
}


def _resolved_entity(symbol, as_of=None, **_):
    return em.ResolveResult(status="resolved", entity=em.Entity(
        entity_id=f"ent_{symbol.lower()}", entity_type="equity",
        lifecycle_state="active", lifecycle_since=None))


@pytest.fixture
def stores(tmp_path, monkeypatch):
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(tmp_path / "bars.db"))
    bars_sqlite.bump_db_epoch()
    bars_sqlite.init_db()
    bars_sqlite.put_bars(TICKER, "D", [dict(b) for b in _BARS_D], date_tf=True)

    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    snapshot_db.init_db()
    snapshot_db.upsert_rows([dict(_SCREENER_ROW)])

    monkeypatch.setenv("BREADTH_MONITOR_DB", str(tmp_path / "breadth.db"))
    breadth_monitor.init_db()
    for d, m in _BREADTH.items():
        assert breadth_monitor.store_snapshot(d, dict(m))
    cache.delete_prefix("breadth_history_")

    monkeypatch.setattr(em, "resolve", _resolved_entity)
    resolver.reset_status_counts()
    yield tmp_path
    cache.delete_prefix("breadth_history_")
    bars_sqlite.bump_db_epoch()


def _addr(metric: str) -> str:
    """The address a desk answer would use for each figure — built from the
    book's own store declaration, never from a typed list of which figure is
    which kind."""
    store = address_book.metric(metric)["store"]
    if store == "bars_sqlite":
        return f"uct://{metric}@{TICKER}/D"
    if store == "breadth_snapshot_numeric":
        return f"uct://{metric}"
    return f"uct://{metric}@{TICKER}"


# ─────────────────────────────────────────────────────────────────────────────
# (a) THE TEN
# ─────────────────────────────────────────────────────────────────────────────

def test_every_desk_figure_is_declared_in_the_book():
    """The selection may not point nowhere. Non-vacuity: the tuple is ten long
    and names at least one member of each addressable store kind."""
    assert len(resolver.DESK_FIGURES) == 10 and len(set(resolver.DESK_FIGURES)) == 10
    missing = [f for f in resolver.DESK_FIGURES if address_book.metric(f) is None]
    assert missing == [], f"desk figures the book does not declare: {missing}"
    stores = {address_book.metric(f)["store"] for f in resolver.DESK_FIGURES}
    assert {"bars_sqlite", "screener_rows", "breadth_snapshot_numeric"} <= stores


def test_the_ten_desk_figures_each_resolve_with_a_stable_id_an_as_of_and_inputs(stores):
    expected = {
        "ohlcv.c": 123.0, "ohlcv.v": 1_000_003, "chg_pct_1d": 1.25,
        "pct_vs_sma50": 7.5, "dist_52w_high_pct": -3.2, "adr_pct": 2.9,
        "market_cap": 3.1e12, "rs_rank": 88.0,
        "breadth_snapshot_numeric.pct_above_50sma": 61.25,
        "breadth_snapshot_numeric.uct_exposure": 85,
    }
    assert set(expected) == set(resolver.DESK_FIGURES)
    report = []
    for fig in resolver.DESK_FIGURES:
        r1 = resolver.resolve(_addr(fig))
        r2 = resolver.resolve(_addr(fig))
        report.append((fig, r1.status, r1.value, r1.address))
        assert r1.status == resolver.RESOLVED, (fig, r1.detail)
        assert r1.value == expected[fig], (fig, r1.value)
        # stable id: same address in, same id out, and it names the metric
        assert r1.address and r1.address == r2.address and fig in r1.address
        # as-of: an instant, and the store's own stamp beside it
        assert isinstance(r1.as_of, float) and r1.inputs.get("as_of_value")
        # inputs: where it was read from, derived from the book
        decl = address_book.metric(fig)
        assert r1.inputs["store"] == decl["store"]
        assert r1.inputs["column"] == decl["column"]
        assert r1.inputs["as_of_column"] == decl["as_of_column"]
        assert r1.inputs["read_by"]
        # typed provenance, D1's record — never a second shape
        assert r1.provenance is not None and r1.provenance.source_observed_at == r1.as_of
        assert r1.authority == decl["authority"]
    print("\n[ten-figure report]")
    for row in report:
        print("  ", row)


def test_the_stable_id_uses_the_entity_id_not_the_ticker(stores):
    r = resolver.resolve("uct://ohlcv.c@aapl/1D")
    assert r.status == resolver.RESOLVED
    assert r.address == "uct://ohlcv.c@ent_aapl/D", "label and case must canonicalise"
    assert r.inputs["entity_alias"] == "AAPL" and r.inputs["entity_id"] == "ent_aapl"


def test_as_of_selects_the_newest_value_at_or_before_the_instant(stores):
    r = resolver.resolve("uct://ohlcv.c@AAPL/D?as_of=2026-09-24")
    assert r.status == resolver.RESOLVED and r.value == 113.0
    assert r.inputs["as_of_value"] == 20260924
    b = resolver.resolve("uct://breadth_snapshot_numeric.pct_above_50sma?as_of=2026-09-24")
    assert b.status == resolver.RESOLVED and b.value == 55.5


def test_the_bars_ordinal_comes_from_the_book_not_a_literal(stores, monkeypatch):
    """The close is position 4 in the DECLARED projection. Move the book's
    answer and the resolver's answer moves with it — proof it asks the book."""
    assert resolver.resolve("uct://ohlcv.c@AAPL/D").value == 123.0
    monkeypatch.setattr(address_book, "row_position", lambda name: 1)   # the OPEN
    assert resolver.resolve("uct://ohlcv.c@AAPL/D").value == 121.0


# ─────────────────────────────────────────────────────────────────────────────
# THE FIVE-STATUS BOUNDARY
# ─────────────────────────────────────────────────────────────────────────────

def _five(stores_fixture, monkeypatch):
    """One fixture address per status, each one step from its neighbour."""
    snapshot_db.upsert_rows([dict(_SCREENER_ROW, ticker="NULLRS", rs_rank=None)])

    def em_resolve(symbol, as_of=None, **_):
        if symbol == "ZZZZQ":
            return em.ResolveResult(status="not_found")
        return _resolved_entity(symbol)
    monkeypatch.setattr(em, "resolve", em_resolve)
    return {
        resolver.RESOLVED: "uct://rs_rank@AAPL",
        resolver.NOT_COMPUTABLE: "uct://rs_rank@NULLRS",
        resolver.EMPTY: "uct://ohlcv.c@AAPL/D?as_of=2020-01-02",
        resolver.UNKNOWN_METRIC: "uct://rs_rnak@AAPL",
        resolver.UNRESOLVED_ENTITY: "uct://rs_rank@ZZZZQ",
    }


def test_the_five_statuses_are_distinguishable_each_on_its_own_fixture(stores, monkeypatch):
    cases = _five(stores, monkeypatch)
    got = {want: resolver.resolve(a) for want, a in cases.items()}
    for want, r in got.items():
        assert r.status == want, (want, cases[want], r.status, r.detail)
    assert len({r.status for r in got.values()}) == 5
    for want, r in got.items():
        if want != resolver.RESOLVED:
            assert r.value is None and r.provenance is None, want
            assert r.detail, f"{want} must say why in a sentence"


def test_status_counts_distinguish_could_not_compute_from_zero(stores, monkeypatch):
    cases = _five(stores, monkeypatch)
    resolver.reset_status_counts()
    for a in cases.values():
        resolver.resolve(a)
    counts = resolver.status_counts()
    assert set(counts) == set(resolver.STATUSES)
    assert all(counts[s] == 1 for s in resolver.STATUSES), counts
    resolver.reset_status_counts()
    assert resolver.status_counts() == {s: 0 for s in resolver.STATUSES}


def test_an_EMPTY_resolution_always_carries_the_as_of_of_the_read(stores):
    """SPEC §3.3. And the downgrade: an empty that cannot say when it looked is
    NOT an empty."""
    r = resolver.resolve("uct://ohlcv.c@AAPL/D?as_of=2020-01-02")
    assert r.status == resolver.EMPTY and isinstance(r.as_of, float)
    forged = resolver._finish(resolver.Resolution(status=resolver.EMPTY, as_of=None))
    assert forged.status == resolver.NOT_COMPUTABLE


def test_a_NULL_column_is_not_computable_never_empty_and_never_zero(stores):
    """The measured case (SPEC §3.2): `rs_rank` NULL in every screener row
    produced `answered=0, not_computable=2615`. A NULL is a gap we hold, not a
    quiet market."""
    snapshot_db.upsert_rows([dict(_SCREENER_ROW, rs_rank=None)])
    r = resolver.resolve("uct://rs_rank@AAPL")
    assert r.status == resolver.NOT_COMPUTABLE and r.value is None


def test_a_zero_is_a_value_not_a_miss(stores):
    snapshot_db.upsert_rows([dict(_SCREENER_ROW, chg_pct_1d=0.0)])
    r = resolver.resolve("uct://chg_pct_1d@AAPL")
    assert r.status == resolver.RESOLVED and r.value == 0.0


# ─────────────────────────────────────────────────────────────────────────────
# (b) THE NEGATIVE — a miss returns a status, never a plausible value
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("address", [
    "uct://ohlcv.close@AAPL/D",      # a near-miss typo of ohlcv.c
    "uct://close@AAPL/D",            # the legacy spelling (indicator_axis's rename)
    "uct://ohlcv@AAPL/D",
    "uct://ohlcv.c@AAPL/Daily",      # an undeclared timeframe
    "uct://ohlcv.c@AAPL/1m?asof=2026-09-24",   # an undeclared query key
    "uct://ohlcv.c@AAPL/D?as_of=yesterday",    # an instant that does not parse
    "ohlcv.c@AAPL/D",                # no scheme
    "",
    None,
])
def test_an_unknown_address_returns_a_status_and_NEVER_a_plausible_value(stores, address):
    r = resolver.resolve(address)
    assert r.status == resolver.UNKNOWN_METRIC, (address, r.status, r.detail)
    assert r.value is None and r.provenance is None and r.as_of is None


def test_bars_with_no_timeframe_are_refused_not_defaulted_to_daily(stores):
    r = resolver.resolve("uct://ohlcv.c@AAPL")
    assert r.status == resolver.UNKNOWN_METRIC and r.value is None


def test_a_daily_store_refuses_an_intraday_timeframe(stores):
    r = resolver.resolve("uct://rs_rank@AAPL/60")
    assert r.status == resolver.UNKNOWN_METRIC and r.value is None


def test_an_as_of_before_the_oldest_breadth_row_is_EMPTY_not_the_clamped_row(stores):
    """⛔⛔ `get_history(anchor='le')` CLAMPS a date before the oldest session to
    the EARLIEST stored row. That row is plausible, real, and from the wrong
    date. The resolver must refuse it."""
    hist = breadth_monitor.get_history(1, end="2001-01-02", anchor="le")
    assert hist and hist[0]["date"] == "2026-09-24", "the clamp this rail exists for"
    r = resolver.resolve("uct://breadth_snapshot_numeric.pct_above_50sma?as_of=2001-01-02")
    assert r.status == resolver.EMPTY and r.value is None and isinstance(r.as_of, float)


def test_a_latest_only_store_cannot_answer_an_earlier_instant(stores):
    r = resolver.resolve("uct://rs_rank@AAPL?as_of=2026-09-01")
    assert r.status == resolver.NOT_COMPUTABLE and r.value is None
    assert "newest row" in r.detail


def test_a_provider_qualified_address_is_not_computable_not_the_held_value(stores):
    r = resolver.resolve("uct://ohlcv.c@AAPL/D?provider=massive")
    assert r.status == resolver.NOT_COMPUTABLE and r.value is None


def test_an_ambiguous_alias_is_unresolved_even_though_the_store_holds_the_ticker(stores, monkeypatch):
    """A store hit under an ambiguous alias may be the OTHER company's value."""
    monkeypatch.setattr(em, "resolve", lambda s, as_of=None, **_: em.ResolveResult(
        status="ambiguous", candidates=("e1", "e2")))
    r = resolver.resolve("uct://ohlcv.c@AAPL/D")
    assert r.status == resolver.UNRESOLVED_ENTITY and r.value is None


def test_an_unknown_to_entity_master_ticker_the_store_HOLDS_resolves_by_alias(stores, monkeypatch):
    """SPEC §1.2 decision 1: a ticker is an alias and resolves as
    `resolve_entity_scope` does — S3's coverage is partial, and a known-held
    series must not become `unresolved_entity` because of it. The detail says so."""
    monkeypatch.setattr(em, "resolve", lambda s, as_of=None, **_: em.ResolveResult(status="not_found"))
    r = resolver.resolve("uct://ohlcv.c@AAPL/D")
    assert r.status == resolver.RESOLVED and r.value == 123.0
    assert r.address == "uct://ohlcv.c@AAPL/D" and "no record" in r.detail


def test_entity_rules_follow_the_store_key(stores):
    assert resolver.resolve("uct://ohlcv.c/D").status == resolver.UNRESOLVED_ENTITY
    assert resolver.resolve(
        "uct://breadth_snapshot_numeric.pct_above_50sma@AAPL").status == resolver.UNRESOLVED_ENTITY


def test_a_store_that_raises_is_not_computable_and_resolve_never_raises(stores, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("database is locked")
    monkeypatch.setattr(snapshot_db, "get_projected", boom)
    r = resolver.resolve("uct://rs_rank@AAPL")
    assert r.status == resolver.NOT_COMPUTABLE and r.value is None and "locked" in r.detail


# ─────────────────────────────────────────────────────────────────────────────
# DERIVED, NEVER RESTATED
# ─────────────────────────────────────────────────────────────────────────────

def test_every_store_in_the_book_is_read_or_named_unaddressable():
    """A store the book gains tomorrow fails here BY NAME until someone decides
    how it is read. Control: a known store IS found."""
    stores = set((address_book.book().get("stores") or {}))
    assert "bars_sqlite" in stores, "the walk found nothing — it is broken"
    covered = set(resolver._READERS) | set(resolver.UNADDRESSABLE_STORES)
    assert stores - covered == set(), f"stores with no reader and no reason: {stores - covered}"
    assert covered - stores == set(), f"readers for stores the book does not declare: {covered - stores}"


def test_the_daily_code_is_on_the_books_timeframe_axis():
    assert resolver.DAILY_CODE in resolver.timeframe_codes()


def test_the_timeframe_axis_is_read_from_the_book(monkeypatch):
    b = json.loads(address_book.BOOK_PATH.read_text(encoding="utf-8"))
    assert resolver.timeframe_codes() == b["axes"]["timeframe"]["code_to_label"]


def test_the_module_writes_nothing_and_reaches_no_vendor():
    """TIER-NONE is carried by the fact that there is no new state: no SQL
    write verb, no file write, no HTTP client in the resolver's code."""
    import ast
    import pathlib
    src = pathlib.Path(resolver.__file__).read_text(encoding="utf-8")
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant):
            node.value.value = ""
    code = ast.unparse(tree)
    assert "def resolve" in code, "the stripper removed real code — control failed"
    for needle in ("INSERT", "UPDATE ", "DELETE", "CREATE TABLE", "open(", "write_text",
                   "httpx", "requests", "urllib"):
        assert needle not in code, f"the resolver's code contains {needle!r}"
