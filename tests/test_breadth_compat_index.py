"""BL-028 — the rollback compatibility index, and the interlock it doubles as.

⚰️ THE HAZARD IT ANSWERS. Widening the key to `(universe, date, metric)` leaves the
PREVIOUS generation of `breadth_daily_ohlc` unable to write: its UPSERTs name
`ON CONFLICT(date, metric)`, and afterwards no unique index matches that clause. SQLite
answers *"ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint"* and
the collector and intraday writers fail. That state is reachable by a FAILED HEALTH
CHECK, not only a deliberate rollback, and the migration DROPs the original table.

⭐ While UCT is the only universe, `(date, metric)` is still unique, so a UNIQUE index on
it makes the old clause match again at no cost — and CANNOT survive a second universe,
which is what turns a shim into an interlock.

⛔ These rails use master's ACTUAL deployed statements, copied verbatim, not a paraphrase
of them. A rail written against invented SQL would prove nothing about a rollback.
"""
import sqlite3

import pytest

from api.services import breadth_daily_ohlc as store
from api.services import breadth_ohlc_sync as sync

# ── verbatim from origin/master's api/services/breadth_daily_ohlc.py ────────
OLD_SCHEMA = """CREATE TABLE breadth_daily_ohlc (
    date TEXT NOT NULL, metric TEXT NOT NULL,
    o REAL, h REAL, l REAL, c REAL,
    source TEXT DEFAULT 'live', updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (date, metric))"""
OLD_UPSERT = ("INSERT INTO breadth_daily_ohlc(date, metric, o, h, l, c, source, updated_at) "
              "VALUES (?,?,?,?,?,?,?,datetime('now')) "
              "ON CONFLICT(date, metric) DO UPDATE SET o=excluded.o, h=excluded.h, "
              "l=excluded.l, c=excluded.c, source=excluded.source")
OLD_MERGE = ("INSERT INTO breadth_daily_ohlc(date,metric,o,h,l,c,source,updated_at) "
             "SELECT s.date,s.metric,s.o,s.h,s.l,s.c,s.source,s.updated_at "
             "FROM snap.breadth_daily_ohlc s LEFT JOIN breadth_daily_ohlc l "
             "ON l.date = s.date AND l.metric = s.metric WHERE l.date IS NULL")

ROW = ("2015-03-10", "pct_above_50sma", 47.2, 47.2, 47.2, 47.2)


@pytest.fixture
def fresh(monkeypatch, tmp_path):
    monkeypatch.setenv("BREADTH_OHLC_DB", str(tmp_path / "b.db"))
    store._INIT_DONE = False
    yield str(tmp_path / "b.db")
    store._INIT_DONE = False


@pytest.fixture
def premigration(monkeypatch, tmp_path):
    """A database in EXACTLY the shape production is in today."""
    p = str(tmp_path / "old.db")
    c = sqlite3.connect(p)
    c.execute(OLD_SCHEMA)
    c.execute(OLD_UPSERT, (*ROW, "close_recon"))
    c.execute(OLD_UPSERT, ("2015-03-11", "pct_above_50sma", 49.6, 49.6, 49.6, 49.6,
                           "close_recon"))
    c.commit()
    c.close()
    monkeypatch.setenv("BREADTH_OHLC_DB", p)
    store._INIT_DONE = False
    yield p
    store._INIT_DONE = False


def indexes(path):
    c = sqlite3.connect(path)
    try:
        return {r[0] for r in c.execute(
            "SELECT name FROM sqlite_master WHERE type='index'")}
    finally:
        c.close()


def rows(path):
    c = sqlite3.connect(path)
    try:
        return c.execute("SELECT universe, date, metric, c FROM breadth_daily_ohlc "
                         "ORDER BY universe, date").fetchall()
    finally:
        c.close()


# ── A · the migration produces the transitional schema ─────────────────────

def test_migrating_a_pre_migration_db_creates_the_compat_index(premigration):
    assert store.COMPAT_INDEX not in indexes(premigration)
    store._ensure_init()
    assert store.COMPAT_INDEX in indexes(premigration)
    # canonical identity is universe-aware…
    c = sqlite3.connect(premigration)
    sql = c.execute("SELECT sql FROM sqlite_master WHERE name='breadth_daily_ohlc'"
                    ).fetchone()[0]
    c.close()
    assert "PRIMARY KEY (universe, date, metric)" in sql
    # …and every pre-existing row is UCT, unchanged
    assert rows(premigration) == [
        ("uct", "2015-03-10", "pct_above_50sma", 47.2),
        ("uct", "2015-03-11", "pct_above_50sma", 49.6)]


def test_C_D_existing_rows_become_uct_with_no_value_change(premigration):
    before = sqlite3.connect(premigration).execute(
        "SELECT date, metric, o, h, l, c, source FROM breadth_daily_ohlc "
        "ORDER BY date").fetchall()
    store._ensure_init()
    after = sqlite3.connect(premigration).execute(
        "SELECT date, metric, o, h, l, c, source FROM breadth_daily_ohlc "
        "ORDER BY date").fetchall()
    assert after == before
    unis = {r[0] for r in rows(premigration)}
    assert unis == {"uct"}


def test_B_a_second_init_is_idempotent(premigration):
    store._ensure_init()
    first = (rows(premigration), indexes(premigration))
    for _ in range(3):
        store._INIT_DONE = False
        store._ensure_init()
    assert (rows(premigration), indexes(premigration)) == first


def test_a_database_NEW_CODE_CREATED_gets_no_interlock(fresh):
    """⚠️ THE HAZARD IS A MIGRATED DATABASE, not any database. A store new code created
    was never owned by pre-migration code, so a rollback strands nothing — and stamping
    an interlock on it would make every fresh database (a test, a staging copy, the grind
    artifact) refuse the second universe it exists to hold."""
    store._ensure_init()
    assert store.COMPAT_INDEX not in indexes(fresh)
    # …and a multi-universe store can therefore be built from scratch, as the grind does
    store.write_bulk([("2015-03-10", "pct_above_50sma", 47.2, 47.2, 47.2, 47.2)],
                     source="close_recon", universe="uct")
    store.write_bulk([("2015-03-10", "pct_above_50sma", 19.9, 19.9, 19.9, 19.9)],
                     source="close_recon", universe="us")
    assert len(rows(fresh)) == 2


def test_a_MIGRATED_store_DOES_get_it(premigration):
    """⭐ The production shape: existing UCT history, migrated in place."""
    store._ensure_init()
    assert store.COMPAT_INDEX in indexes(premigration)


# ── E/F · BOTH code generations can write UCT ──────────────────────────────

def test_F_the_OLD_upsert_still_works_against_the_transitional_schema(premigration):
    """⭐ THE WHOLE POINT. This is master's statement, verbatim, and before BL-028 it
    raised OperationalError."""
    store._ensure_init()
    c = sqlite3.connect(premigration)
    c.execute(OLD_UPSERT, ("2015-03-12", "pct_above_50sma", 51.0, 51.0, 51.0, 51.0, "live"))
    c.execute(OLD_UPSERT, ("2015-03-12", "pct_above_50sma", 52.0, 52.0, 52.0, 52.0, "live"))
    c.commit()
    got = c.execute("SELECT universe, c FROM breadth_daily_ohlc WHERE date='2015-03-12'"
                    ).fetchall()
    c.close()
    assert got == [("uct", 52.0)], "the old UPSERT must update in place, not duplicate"


def test_E_the_NEW_writer_still_works(premigration):
    store._ensure_init()
    n = store.write_bulk([("2015-03-13", "pct_above_50sma", 53.0, 53.0, 53.0, 53.0)],
                         source="close_recon")
    assert n == 1
    assert ("uct", "2015-03-13", "pct_above_50sma", 53.0) in rows(premigration)


def test_the_old_UPSERT_fails_WITHOUT_the_index(premigration):
    """⚰️ The bite-check: drop the interlock and master's statement dies again. If this
    ever passes, the index is not the thing making rollback safe."""
    store._ensure_init()
    store.drop_compat_index()
    c = sqlite3.connect(premigration)
    with pytest.raises(sqlite3.OperationalError, match="ON CONFLICT"):
        c.execute(OLD_UPSERT, ("2015-03-12", "pct_above_50sma", 51.0, 51.0, 51.0, 51.0,
                               "live"))
    c.close()


def test_the_old_MERGE_path_also_survives(premigration, tmp_path):
    """The web pod's gap-fill merge, as master runs it, against a migrated local DB."""
    store._ensure_init()
    snap = str(tmp_path / "snap.db")
    sc = sqlite3.connect(snap)
    sc.execute(OLD_SCHEMA)
    sc.execute(OLD_UPSERT, ("2015-03-14", "pct_above_50sma", 55.0, 55.0, 55.0, 55.0,
                            "close_recon"))
    sc.commit()
    sc.close()
    c = sqlite3.connect(premigration)
    c.execute("ATTACH DATABASE ? AS snap", (snap,))
    c.execute(OLD_MERGE)
    c.commit()
    c.close()
    assert ("uct", "2015-03-14", "pct_above_50sma", 55.0) in rows(premigration)


# ── G · the interlock ──────────────────────────────────────────────────────

def test_G_a_second_universe_is_REFUSED_while_the_index_stands(premigration):
    """⛔⛔ SECOND UNIVERSE CANNOT ENTER UNTIL THE COMPATIBILITY INDEX IS DELIBERATELY
    REMOVED. The refusal is the feature, not a limitation to work around."""
    store._ensure_init()
    assert store.compat_index_present()
    with pytest.raises(store.CompatIndexBlocksUniverse) as ei:
        store.write_bulk([("2015-03-10", "pct_above_50sma", 19.9, 19.9, 19.9, 19.9)],
                         source="close_recon", universe="us")
    assert store.COMPAT_INDEX in str(ei.value)
    assert "deliberate migration step" in str(ei.value)
    assert {r[0] for r in rows(premigration)} == {"uct"}


def test_the_merge_path_refuses_a_multi_universe_snapshot(premigration, tmp_path,
                                                          monkeypatch):
    store._ensure_init()
    snap = str(tmp_path / "us_snap.db")
    monkeypatch.setenv("BREADTH_OHLC_DB", snap)
    store._INIT_DONE = False
    store._ensure_init()
    store.drop_compat_index()          # the snapshot's own DB is allowed both universes
    store.write_bulk([("2015-03-10", "pct_above_50sma", 19.9, 19.9, 19.9, 19.9)],
                     source="close_recon", universe="us")
    monkeypatch.setenv("BREADTH_OHLC_DB", premigration)
    store._INIT_DONE = False
    with pytest.raises(store.CompatIndexBlocksUniverse) as ei:
        sync._merge_from(snap)
    assert "us" in str(ei.value)


def test_dropping_it_is_explicit_and_then_a_second_universe_fits(premigration):
    store._ensure_init()
    assert store.drop_compat_index() is True
    assert store.drop_compat_index() is False          # idempotent
    assert not store.compat_index_present()
    store.write_bulk([("2015-03-10", "pct_above_50sma", 19.9, 19.9, 19.9, 19.9)],
                     source="close_recon", universe="us")
    got = [r for r in rows(premigration) if r[1] == "2015-03-10"]
    assert got == [("uct", "2015-03-10", "pct_above_50sma", 47.2),
                   ("us", "2015-03-10", "pct_above_50sma", 19.9)]


def test_nothing_drops_it_automatically():
    """⛔ `drop_compat_index` must be called BY A HUMAN DECISION, never reached from the
    write path, the sweep, the seal or init."""
    import ast
    import inspect
    import textwrap

    # ⚠️ A CALL, NOT THE NAME. `write_bulk`'s refusal message names
    # `drop_compat_index()` on purpose — it tells the operator what the deliberate step
    # is. Grepping the source would flag that prose and prove nothing, so this walks the
    # AST and looks for an actual Call node.
    for mod, names in ((store, ("write_bulk", "_ensure_init", "_ensure_compat_index")),
                       (sync, ("_merge_from", "sync_if_new"))):
        for n in names:
            fn = getattr(mod, n, None)
            if fn is None:
                continue
            tree = ast.parse(textwrap.dedent(inspect.getsource(fn)))
            called = {node.func.id for node in ast.walk(tree)
                      if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)}
            called |= {node.func.attr for node in ast.walk(tree)
                       if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)}
            assert "drop_compat_index" not in called, f"{mod.__name__}.{n} CALLS it"


def test_the_index_is_not_created_once_a_second_universe_exists(fresh):
    store._ensure_init()
    store.drop_compat_index()
    store.write_bulk([("2015-03-10", "pct_above_50sma", 19.9, 19.9, 19.9, 19.9)],
                     source="close_recon", universe="us")
    store._INIT_DONE = False
    store._ensure_init()
    assert store.COMPAT_INDEX not in indexes(fresh), (
        "the interlock must not reappear under a multi-universe store — it would be "
        "uncreatable, and silently retrying it every boot would be noise")
