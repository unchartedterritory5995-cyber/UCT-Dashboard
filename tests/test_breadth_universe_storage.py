"""Universe-keyed storage: the migration, and the promise that UCT is untouched.

The migration is the highest-risk change in the phase — it rewrites a table that
holds 174,263 published rows — so these rails assert the two things that matter:
every pre-existing value survives BIT FOR BIT, and two universes can no longer
collide on one key.
"""
import sqlite3

import pytest

from api.services import breadth_daily_ohlc as store
from api.services import breadth_universes as bu


@pytest.fixture()
def fresh_store(tmp_path, monkeypatch):
    monkeypatch.setenv("BREADTH_OHLC_DB", str(tmp_path / "ohlc.db"))
    store._INIT_DONE = False
    yield str(tmp_path / "ohlc.db")
    store._INIT_DONE = False


def _legacy_db(path):
    """A pre-universe database, exactly as it exists in production today."""
    c = sqlite3.connect(path)
    c.execute("""CREATE TABLE breadth_daily_ohlc (
                    date TEXT NOT NULL, metric TEXT NOT NULL,
                    o REAL, h REAL, l REAL, c REAL,
                    source TEXT DEFAULT 'live',
                    updated_at TEXT DEFAULT (datetime('now')),
                    PRIMARY KEY (date, metric))""")
    rows = [
        ("2008-01-02", "pct_above_50sma", 51.1, 53.2, 50.0, 52.5, "close_recon", "2026-01-01 00:00:00"),
        ("2008-01-03", "pct_above_50sma", 52.5, 52.9, 48.0, 48.4, "close_recon", "2026-01-01 00:00:01"),
        ("2008-01-02", "adv_decline", -310.0, -310.0, -412.0, -412.0, "close_recon", "2026-01-01 00:00:02"),
        ("2026-09-12", "pct_above_50sma", 44.0, 47.0, 43.0, 46.2, "live", "2026-09-12 20:05:00"),
    ]
    c.executemany("INSERT INTO breadth_daily_ohlc VALUES (?,?,?,?,?,?,?,?)", rows)
    c.commit()
    c.close()
    return rows


def test_migration_moves_every_legacy_row_to_uct_without_changing_a_value(fresh_store):
    legacy = _legacy_db(fresh_store)
    before = sqlite3.connect(fresh_store).execute(
        "SELECT date, metric, o, h, l, c, source, updated_at "
        "FROM breadth_daily_ohlc ORDER BY date, metric").fetchall()

    store._ensure_init()                       # triggers the migration

    c = sqlite3.connect(fresh_store)
    cols = {r[1] for r in c.execute("PRAGMA table_info(breadth_daily_ohlc)").fetchall()}
    assert "universe" in cols
    after = c.execute(
        "SELECT date, metric, o, h, l, c, source, updated_at "
        "FROM breadth_daily_ohlc ORDER BY date, metric").fetchall()
    # ⭐ Identical tuples: a key widening, never a reinterpretation.
    assert after == before == sorted(
        [(d, m, o, h, l, cl, s, u) for (d, m, o, h, l, cl, s, u) in legacy],
        key=lambda r: (r[0], r[1]))
    assert {r[0] for r in c.execute("SELECT DISTINCT universe FROM breadth_daily_ohlc")} == {"uct"}


def test_migration_is_idempotent_and_survives_a_second_init(fresh_store):
    _legacy_db(fresh_store)
    store._ensure_init()
    n1 = sqlite3.connect(fresh_store).execute(
        "SELECT COUNT(*) FROM breadth_daily_ohlc").fetchone()[0]
    store._INIT_DONE = False
    store._ensure_init()
    n2 = sqlite3.connect(fresh_store).execute(
        "SELECT COUNT(*) FROM breadth_daily_ohlc").fetchone()[0]
    assert n1 == n2 == 4
    # no stray scratch table left behind
    names = {r[0] for r in sqlite3.connect(fresh_store).execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    assert "breadth_daily_ohlc__v2" not in names


def test_existing_readers_keep_seeing_exactly_uct(fresh_store):
    _legacy_db(fresh_store)
    store._ensure_init()
    # The pre-universe call signature still works and still answers UCT.
    h = store.history("pct_above_50sma")
    assert h["2008-01-02"] == {"o": 51.1, "h": 53.2, "l": 50.0, "c": 52.5}
    assert store.stats()["first"] == "2008-01-02"
    assert store.stats()["rows"] == 4


def test_two_universes_share_a_date_and_metric_without_colliding(fresh_store):
    store._ensure_init()
    assert store.write_bulk([("2015-03-10", "pct_above_50sma", 47.0, 47.0, 47.0, 47.23)],
                            universe="us") == 1
    assert store.write_bulk([("2015-03-10", "pct_above_50sma", 55.0, 55.0, 55.0, 55.19)],
                            universe="nasdaq") == 1
    assert store.write_bulk([("2015-03-10", "pct_above_50sma", 41.0, 41.0, 41.0, 41.83)],
                            universe="uct") == 1
    # ⛔ Three rows, three answers. Under the old (date, metric) key this was ONE row
    # and the last writer silently won.
    assert store.history("pct_above_50sma", universe="us")["2015-03-10"]["c"] == 47.23
    assert store.history("pct_above_50sma", universe="nasdaq")["2015-03-10"]["c"] == 55.19
    assert store.history("pct_above_50sma")["2015-03-10"]["c"] == 41.83


def test_a_pit_universe_write_does_not_appear_in_the_uct_reader(fresh_store):
    _legacy_db(fresh_store)
    store._ensure_init()
    # ⛔ BL-028: a MIGRATED store carries the rollback compatibility index, and that
    # index refuses a second universe until it is deliberately removed. Dropping it here
    # is not the test working around a guard — it IS the precondition the future US
    # ingest has to satisfy, stated once in the place a reader will meet it.
    assert store.compat_index_present()
    store.drop_compat_index()
    store.write_bulk([("2008-01-02", "pct_above_50sma", 19.0, 19.0, 19.0, 19.92)],
                     universe="us")
    # UCT's published 2008-01-02 value is unchanged and still what it always was.
    assert store.history("pct_above_50sma")["2008-01-02"]["c"] == 52.5
    assert store.history("pct_above_50sma", universe="us")["2008-01-02"]["c"] == 19.92
    assert store.stats()["rows"] == 4                      # UCT-scoped
    assert store.stats("us")["rows"] == 1
    assert set(store.stats()["by_universe"]) == {"uct", "us"}


def test_the_uct_live_accumulator_is_unchanged_and_stays_in_uct(fresh_store):
    store._ensure_init()
    store.update_intraday("2026-08-10", {"pct_above_50sma": 50.0})
    store.update_intraday("2026-08-10", {"pct_above_50sma": 57.0})
    store.update_intraday("2026-08-10", {"pct_above_50sma": 44.0})
    assert store.history("pct_above_50sma")["2026-08-10"] == {
        "o": 50.0, "h": 57.0, "l": 44.0, "c": 44.0}
    assert store.history("pct_above_50sma", universe="us") == {}


def test_purge_reconstructed_cannot_reach_a_pit_universe(fresh_store):
    store._ensure_init()
    store.set_ohlc("2015-03-10", "x", 1, 2, 0, 1, source="reconstruct")
    store.set_ohlc("2015-03-10", "x", 1, 2, 0, 1, source="reconstruct", universe="us")
    assert store.purge_reconstructed() == 1                 # only UCT's
    c = sqlite3.connect(fresh_store)
    assert c.execute("SELECT COUNT(*) FROM breadth_daily_ohlc WHERE universe='us'"
                     ).fetchone()[0] == 1


def test_an_unknown_universe_is_refused_at_the_store_boundary(fresh_store):
    store._ensure_init()
    with pytest.raises(bu.UnknownUniverse):
        bu.get("nasdaq100")


def test_the_migration_reclaims_the_dropped_tables_pages(fresh_store):
    """⚠️ `breadth_ohlc_sync` ships this ENTIRE database over R2, so bloat from the
    rebuild would be paid on every transfer forever. Measured at production scale:
    33.7 MB -> 55.6 MB without the VACUUM, 34.4 MB with it."""
    import os
    _legacy_db(fresh_store)
    # pad the table so the freelist is measurable at test scale
    c = sqlite3.connect(fresh_store)
    c.executemany(
        "INSERT INTO breadth_daily_ohlc VALUES (?,?,?,?,?,?,?,?)",
        [(f"20{y:02d}-01-{d:02d}", f"metric_{m}", 1.0, 2.0, 0.5, 1.5,
          "close_recon", "2026-01-01 00:00:00")
         for y in range(10, 26) for d in range(1, 29) for m in range(12)])
    c.commit()
    c.close()
    before = os.path.getsize(fresh_store)

    store._ensure_init()

    after = os.path.getsize(fresh_store)
    assert after <= before * 1.10, (
        f"the rebuild left {after - before:,} bytes of freelist behind "
        f"({before:,} -> {after:,})")
    # and the data is still all there under 'uct'
    n = sqlite3.connect(fresh_store).execute(
        "SELECT COUNT(*) FROM breadth_daily_ohlc WHERE universe='uct'").fetchone()[0]
    assert n == 4 + 16 * 28 * 12


def test_a_failing_vacuum_never_fails_the_migration(fresh_store, monkeypatch):
    # ⛔ A VACUUM that cannot run leaves a CORRECT database that is merely larger.
    _legacy_db(fresh_store)
    monkeypatch.setattr(store, "_vacuum_after_migration",
                        lambda: (_ for _ in ()).throw(RuntimeError("disk full")))
    store._ensure_init()
    assert store.history("pct_above_50sma")["2008-01-02"]["c"] == 52.5
