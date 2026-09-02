"""Entity Master seed script — Checkpoint 4 "local/safe testing" (idempotency,
duplicate handling, collision behavior, type normalization, mappings,
rollback/recovery), against entirely SYNTHETIC data. No network call, no
real Massive/cap_universe/delisted_registry data — every source function is
monkeypatched. This is the safety gate before any real seed run: run and
green BEFORE `entity_master_seed.py --dry-run` or a real invocation touches
anything.

Colocated with the script, mirroring `scripts/test_massive_ws.py`.
"""
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts import entity_master_seed as seed
from api.services.entity_master import api as em_api
from api.services.entity_master import store


@pytest.fixture
def db_path(tmp_path):
    return str(tmp_path / "seed_test.db")


def _patch_sources(monkeypatch, *, symbols=(), etf_symbols=(), ref_rows=None, delisted=()):
    """Monkeypatch every external source `run_seed` reads, at the exact
    call sites `entity_master_seed.py` imports them from."""
    import api.services.cap_universe as cap_universe
    import api.services.delisted_registry as delisted_registry
    import api.services.massive as massive

    monkeypatch.setattr(cap_universe, "symbols", lambda: frozenset(symbols))
    monkeypatch.setattr(cap_universe, "etf_symbols", lambda: frozenset(etf_symbols))
    monkeypatch.setattr(delisted_registry, "all_entries", lambda: list(delisted))

    ref_rows = ref_rows or []

    def _fake_list_reference_tickers(active=True, market="stocks", limit=1000, max_pages=60):
        return [r for r in ref_rows if r.get("_market", "stocks") == market]

    monkeypatch.setattr(massive, "list_reference_tickers", _fake_list_reference_tickers)


def test_dry_run_writes_nothing(monkeypatch, tmp_path):
    _patch_sources(
        monkeypatch,
        symbols=["AAPL", "NVDA"],
        ref_rows=[{"ticker": "AAPL", "type": "CS", "composite_figi": "BBG000B9XRY4"}],
    )
    db_path = str(tmp_path / "should_not_exist.db")
    result = seed.run_seed(db_path=db_path, dry_run=True)
    assert result["dry_run"] is True
    assert result["stats"]["distinct_active_symbols"] == 2
    assert result["stats"]["would_populate_figi"] == 1
    import os
    assert not os.path.exists(db_path)


def test_real_run_creates_entities_and_is_idempotent(monkeypatch, db_path):
    _patch_sources(
        monkeypatch,
        symbols=["AAPL", "NVDA"],
        ref_rows=[
            {"ticker": "AAPL", "type": "CS", "list_date": "1980-12-12", "composite_figi": "BBG000B9XRY4"},
            {"ticker": "NVDA", "type": "CS", "list_date": "1999-01-22"},
        ],
    )
    r1 = seed.run_seed(db_path=db_path)
    assert r1["stats"]["entities_created"] == 2
    assert r1["stats"]["figi_populated"] == 1
    assert r1["anomalies"] == []
    assert em_api.resolve("AAPL", db_path=db_path).status == "resolved"
    assert em_api.resolve("NVDA", db_path=db_path).status == "resolved"

    conn = store._conn(db_path)
    entities_after_1 = conn.execute("SELECT COUNT(*) FROM entities").fetchone()[0]
    aliases_after_1 = conn.execute("SELECT COUNT(*) FROM entity_aliases").fetchone()[0]

    # Re-run against the SAME data — idempotent, nothing duplicated.
    r2 = seed.run_seed(db_path=db_path)
    assert r2["stats"]["entities_created"] == 0
    assert r2["stats"]["skipped_already_seeded"] == 2
    entities_after_2 = conn.execute("SELECT COUNT(*) FROM entities").fetchone()[0]
    aliases_after_2 = conn.execute("SELECT COUNT(*) FROM entity_aliases").fetchone()[0]
    assert (entities_after_1, aliases_after_1) == (entities_after_2, aliases_after_2)


def test_symbol_present_in_both_universe_and_massive_creates_one_entity(monkeypatch, db_path):
    """Duplicate-handling: AAPL appears in BOTH cap_universe.symbols() and
    the Massive reference feed — must produce exactly one entity, not two."""
    _patch_sources(
        monkeypatch,
        symbols=["AAPL"],
        ref_rows=[{"ticker": "AAPL", "type": "CS", "list_date": "1980-12-12"}],
    )
    r = seed.run_seed(db_path=db_path)
    assert r["stats"]["entities_created"] == 1
    conn = store._conn(db_path)
    count = conn.execute("SELECT COUNT(*) FROM entities").fetchone()[0]
    assert count == 1


def test_type_normalization_maps_massive_types_correctly(monkeypatch, db_path):
    _patch_sources(
        monkeypatch,
        symbols=[],
        ref_rows=[
            {"ticker": "AAPL", "type": "CS"},          # STOCK -> equity
            {"ticker": "SPY", "type": "ETF"},           # ETF -> etf
            {"ticker": "SPX", "type": "", "_market": "indices"},  # INDEX -> index
            {"ticker": "WEIRD", "type": "ZZZZ"},        # OTHER -> equity (default)
        ],
    )
    seed.run_seed(db_path=db_path)
    conn = store._conn(db_path)
    rows = dict(conn.execute(
        "SELECT ea.alias, e.entity_type FROM entities e "
        "JOIN entity_aliases ea ON ea.entity_id = e.entity_id"
    ).fetchall())
    assert rows["AAPL"] == "equity"
    assert rows["SPY"] == "etf"
    assert rows["SPX"] == "index"
    assert rows["WEIRD"] == "equity"


def test_hyphenated_alias_gets_derived_vendor_symbol(monkeypatch, db_path):
    _patch_sources(
        monkeypatch,
        symbols=["BRK-B"],
        ref_rows=[{"ticker": "BRK-B", "type": "CS", "list_date": "1996-05-09"}],
    )
    r = seed.run_seed(db_path=db_path)
    assert r["stats"]["vendor_symbols_populated"] == 1
    resolved = em_api.resolve("BRK-B", db_path=db_path)
    vs = em_api.vendor_symbol(resolved.entity.entity_id, "massive", db_path=db_path)
    from api.services.massive import to_polygon_symbol
    assert vs == to_polygon_symbol("BRK-B") == "BRK.B"


def test_delisted_entity_seeded_with_closed_alias_and_delisted_state(monkeypatch, db_path):
    _patch_sources(
        monkeypatch,
        symbols=[],
        delisted=[{
            "ticker": "BSC-OLD", "provider_symbol": "BSC", "name": "Bear Stearns",
            "first_date": "1985-10-01", "last_date": "2008-05-30",
            "delisted_date": "2008-05-30",
        }],
    )
    r = seed.run_seed(db_path=db_path)
    assert r["stats"]["delisted_entities_created"] == 1
    assert r["anomalies"] == []

    historical = em_api.resolve("BSC-OLD", as_of="2000-01-01", db_path=db_path)
    assert historical.status == "resolved"
    assert historical.entity.lifecycle_state == "delisted"
    current = em_api.resolve("BSC-OLD", db_path=db_path)
    assert current.status == "not_found"  # closed alias


def test_delisted_record_missing_dates_is_an_anomaly_not_a_crash(monkeypatch, db_path):
    _patch_sources(
        monkeypatch,
        symbols=[],
        delisted=[{"ticker": "NODATE", "provider_symbol": "NODATE"}],  # no first_date/last_date
    )
    r = seed.run_seed(db_path=db_path)
    assert r["stats"].get("normalization_anomalies", 0) >= 1
    assert any(a["kind"] == "delisted_record_missing_date" for a in r["anomalies"])


def test_rerun_after_partial_failure_recovers_cleanly(monkeypatch, db_path):
    """Rollback/recovery validation: if a run is interrupted after creating
    SOME entities (simulated by only feeding half the universe the first
    time), a second run with the FULL universe completes the rest without
    disturbing what was already seeded."""
    _patch_sources(
        monkeypatch,
        symbols=["AAA"],
        ref_rows=[{"ticker": "AAA", "type": "CS", "list_date": "2000-01-01"}],
    )
    r1 = seed.run_seed(db_path=db_path)
    assert r1["stats"]["entities_created"] == 1
    first_entity_id = em_api.resolve("AAA", db_path=db_path).entity.entity_id

    # "Resume" with the full intended universe.
    _patch_sources(
        monkeypatch,
        symbols=["AAA", "BBB"],
        ref_rows=[
            {"ticker": "AAA", "type": "CS", "list_date": "2000-01-01"},
            {"ticker": "BBB", "type": "CS", "list_date": "2005-01-01"},
        ],
    )
    r2 = seed.run_seed(db_path=db_path)
    assert r2["stats"]["entities_created"] == 1  # only BBB is new
    assert r2["stats"]["skipped_already_seeded"] == 1  # AAA untouched, not recreated

    assert em_api.resolve("AAA", db_path=db_path).entity.entity_id == first_entity_id
    assert em_api.resolve("BBB", db_path=db_path).status == "resolved"
