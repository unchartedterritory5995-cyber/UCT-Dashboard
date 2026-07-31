"""SQLite store for the earnings wire.

The two invariants here are load-bearing for the feed's readability:
  • `first_seen_at` is IMMUTABLE — the feed sorts on it, so an upgrade that
    rewrote it would make a row jump while the user is reading it.
  • `peak_move_pct` only RATCHETS UP — it drives ranking/emphasis, so a pullback
    must not erase the spike that made the row matter.
"""
import importlib

import pytest


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("WIRE_DB_PATH", str(tmp_path / "wire.db"))
    import api.services.wire.store as s
    importlib.reload(s)
    s._init_db()
    return s


def _row(sym="NVDA", seen=1000.0, **kw):
    base = dict(market_date="2026-07-31", sym=sym, timing="amc",
                first_seen_at=seen, trigger="price",
                eps_act=None, eps_est=1.11, rev_act=None, rev_est=49.8e9,
                eps_src=None, rev_src=None, confirmed=0, peak_move_pct=6.4)
    base.update(kw)
    return base


def test_roundtrip(store):
    store.upsert_print(_row())
    got = store.get_print("2026-07-31", "NVDA")
    assert got["sym"] == "NVDA"
    assert got["trigger"] == "price"
    assert got["confirmed"] == 0


def test_first_seen_at_is_immutable_across_upserts(store):
    """Row order is by first_seen_at. If an upgrade moved it, rows would jump."""
    store.upsert_print(_row(seen=1000.0))
    store.upsert_print(_row(seen=9999.0, eps_act=1.24, confirmed=1))
    got = store.get_print("2026-07-31", "NVDA")
    assert got["first_seen_at"] == 1000.0, "an upgrade rewrote the arrival time"
    assert got["eps_act"] == 1.24, "the upgrade did not land"
    assert got["confirmed"] == 1


def test_get_prints_is_ordered_by_arrival(store):
    store.upsert_print(_row(sym="AMD", seen=3000.0))
    store.upsert_print(_row(sym="NVDA", seen=1000.0))
    store.upsert_print(_row(sym="SBUX", seen=2000.0))
    assert [r["sym"] for r in store.get_prints("2026-07-31")] == ["NVDA", "SBUX", "AMD"]


def test_days_are_isolated(store):
    store.upsert_print(_row(sym="NVDA"))
    store.upsert_print(_row(sym="AMD", market_date="2026-08-03"))
    assert [r["sym"] for r in store.get_prints("2026-07-31")] == ["NVDA"]


def test_peak_move_only_ratchets_upward(store):
    """peak_move_pct drives ranking; a pullback must not erase the spike."""
    store.upsert_print(_row(peak_move_pct=9.0))
    store.upsert_print(_row(peak_move_pct=2.0))
    assert store.get_print("2026-07-31", "NVDA")["peak_move_pct"] == 9.0


def test_confirmed_never_regresses(store):
    """Once a structured source confirmed the numbers, a later price-only tick
    must not drop the row back to unconfirmed."""
    store.upsert_print(_row(eps_act=1.24, confirmed=1))
    store.upsert_print(_row(confirmed=0))
    assert store.get_print("2026-07-31", "NVDA")["confirmed"] == 1


def test_an_upgrade_never_blanks_a_field_it_does_not_carry(store):
    """A price-only tick after actuals landed must not null the numbers out."""
    store.upsert_print(_row(eps_act=1.24, rev_act=51.2e9, eps_src="provider"))
    store.upsert_print(_row(eps_act=None, rev_act=None, eps_src=None))
    got = store.get_print("2026-07-31", "NVDA")
    assert got["eps_act"] == 1.24
    assert got["rev_act"] == 51.2e9
    assert got["eps_src"] == "provider"


def test_missing_day_is_empty_not_an_error(store):
    assert store.get_prints("2026-01-01") == []
    assert store.get_print("2026-01-01", "NVDA") is None


# ── the DARK state: table never created ──────────────────────────────────────

def test_reads_work_before_init_db_has_ever_run(tmp_path, monkeypatch):
    """The Wire tab is visible to every user, but `_init_db()` only runs when
    WIRE_ENABLED=1. So in the shipped-dark state the very first read hits a
    table that does not exist — which 500ed the endpoint in production on
    2026-07-31. Reads must lazily create the schema instead.
    """
    monkeypatch.setenv("WIRE_DB_PATH", str(tmp_path / "never_inited.db"))
    import api.services.wire.store as s
    importlib.reload(s)                      # deliberately NO _init_db() call
    assert s.get_prints("2026-07-31") == []
    assert s.get_print("2026-07-31", "NVDA") is None


def test_writes_work_before_init_db_has_ever_run(tmp_path, monkeypatch):
    monkeypatch.setenv("WIRE_DB_PATH", str(tmp_path / "never_inited2.db"))
    import api.services.wire.store as s
    importlib.reload(s)
    s.upsert_print(_row())
    assert s.get_print("2026-07-31", "NVDA")["sym"] == "NVDA"
