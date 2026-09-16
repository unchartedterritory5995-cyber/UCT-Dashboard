"""IMPORTING AN AUDITED PIT UNIVERSE — additive, idempotent, and UCT never moves.

⭐⭐ THE CLAIM: `import_universe` adds exactly the artifact's rows for exactly the
universe asked for, and a UCT fingerprint taken before and after is IDENTICAL. Everything
else it can do is refuse.
"""
import sqlite3

import pytest

from api.services import breadth_daily_ohlc as store
from api.services import breadth_us_import as imp

ART_SCHEMA = """CREATE TABLE breadth_daily_ohlc (
    universe TEXT NOT NULL DEFAULT 'uct', date TEXT NOT NULL, metric TEXT NOT NULL,
    o REAL, h REAL, l REAL, c REAL, source TEXT DEFAULT 'live',
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (universe, date, metric))"""


def _artifact(path, *, universe="us", n=50, extra=None, c_value=None):
    con = sqlite3.connect(path)
    con.execute(ART_SCHEMA)
    rows = [(universe, "2020-03-%02d" % (i % 28 + 1), "m%d" % (i // 28),
             1.0, 2.0, 0.5, (1.5 if c_value is None else c_value), "close_recon")
            for i in range(n)]
    con.executemany("INSERT INTO breadth_daily_ohlc"
                    "(universe,date,metric,o,h,l,c,source) VALUES(?,?,?,?,?,?,?,?)", rows)
    if extra:
        con.executemany("INSERT INTO breadth_daily_ohlc"
                        "(universe,date,metric,o,h,l,c,source) VALUES(?,?,?,?,?,?,?,?)",
                        extra)
    con.commit(); con.close()
    return path


@pytest.fixture()
def live(tmp_path, monkeypatch):
    """A migrated UCT-only store with the interlock ALREADY DROPPED — which is the real
    precondition for any import, and the test says so rather than assuming it."""
    monkeypatch.setenv("BREADTH_OHLC_DB", str(tmp_path / "live.db"))
    store._INIT_DONE = False
    store._ensure_init()
    store.write_bulk([("2020-03-10", "pct_above_50sma", 45, 70, 30, 55),
                      ("2020-03-11", "pct_above_50sma", 55, 60, 40, 47)],
                     source="close_recon", universe="uct")
    store.drop_compat_index()
    yield str(tmp_path / "live.db")
    store._INIT_DONE = False


def test_a_the_interlock_blocks_the_import_until_it_is_deliberately_removed(
        tmp_path, monkeypatch):
    """⛔⛔ THE SEQUENCING GATE, AS CODE. `write_bulk` already guards the ordinary path;
    this one uses raw SQL for speed, so it has to ask the same question rather than
    inherit the answer — otherwise the fast path would be the unguarded one."""
    # ⚠️ A MIGRATED store, not a fresh one — and the difference is the design.
    # `_ensure_compat_index` creates the interlock only for a database that
    # PRE-MIGRATION CODE USED TO OWN, because that is the only state a code rollback
    # can strand. A database new code created never was that, so it has no interlock
    # and needs none. Production is the migrated case; this test has to be too.
    db = str(tmp_path / "guarded.db")
    con = sqlite3.connect(db)
    con.execute("""CREATE TABLE breadth_daily_ohlc (
        date TEXT NOT NULL, metric TEXT NOT NULL, o REAL, h REAL, l REAL, c REAL,
        source TEXT DEFAULT 'live', updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (date, metric))""")
    con.execute("INSERT INTO breadth_daily_ohlc(date,metric,o,h,l,c,source) "
                "VALUES('2020-03-10','pct_above_50sma',45,70,30,55,'close_recon')")
    con.commit(); con.close()
    monkeypatch.setenv("BREADTH_OHLC_DB", db)
    store._INIT_DONE = False
    store._ensure_init()
    assert store.compat_index_present()
    art = _artifact(str(tmp_path / "a.db"))
    with pytest.raises(store.CompatIndexBlocksUniverse, match="deliberate"):
        imp.import_universe(art, "us")
    store._INIT_DONE = False


def test_b_it_imports_exactly_the_artifact_and_uct_does_not_move(live, tmp_path):
    before = imp.uct_fingerprint()
    art = _artifact(str(tmp_path / "a.db"), n=50)
    res = imp.import_universe(art, "us")
    assert res["imported"] == 50 and res["rows_after"] == 50
    assert res["uct_parity"] is True
    assert imp.uct_fingerprint() == before, "the import moved a UCT value"


def test_c_re_importing_is_idempotent(live, tmp_path):
    art = _artifact(str(tmp_path / "a.db"), n=50)
    imp.import_universe(art, "us")
    again = imp.import_universe(art, "us")
    assert again["imported"] == 0 and again["rows_after"] == 50
    assert again["uct_parity"] is True


def test_d_an_unregistered_universe_is_refused(live, tmp_path):
    """⭐ BL-008: membership is REGISTRY-BACKED, never inferred from a string."""
    art = _artifact(str(tmp_path / "a.db"), universe="atlantis")
    with pytest.raises(imp.ImportRefused, match="not a REGISTERED universe"):
        imp.import_universe(art, "atlantis")


def test_e_an_artifact_carrying_the_wrong_universe_is_refused(live, tmp_path):
    art = _artifact(str(tmp_path / "a.db"), universe="nasdaq")
    with pytest.raises(imp.ImportRefused, match="not exactly"):
        imp.import_universe(art, "us")
    assert "us" not in dict(_universes())


def test_f_an_artifact_MIXING_universes_is_refused(live, tmp_path):
    """⛔ One artifact, one universe. A mixed file is how a NASDAQ row silently becomes
    a US row, and this session is explicitly not ingesting NASDAQ."""
    art = _artifact(str(tmp_path / "a.db"), universe="us", n=20,
                    extra=[("nasdaq", "2020-03-10", "m0", 1, 2, 3, 4, "close_recon")])
    with pytest.raises(imp.ImportRefused, match="not exactly"):
        imp.import_universe(art, "us")


def test_g_a_row_count_that_is_not_the_audited_one_is_refused(live, tmp_path):
    art = _artifact(str(tmp_path / "a.db"), n=50)
    with pytest.raises(imp.ImportRefused, match="not the audited object"):
        imp.import_universe(art, "us", expect_rows=183417)


def test_h_a_fingerprint_mismatch_refuses_a_substituted_dataset(live, tmp_path):
    """⛔ THE ANTI-SUBSTITUTION RAIL. Our evidence was gathered against ONE object; a
    recomputed dataset with the same row count is a different object wearing its size."""
    art = _artifact(str(tmp_path / "a.db"), n=50)
    with pytest.raises(imp.ImportRefused, match="refusing to substitute"):
        imp.import_universe(art, "us", expect_fingerprint="0" * 64)


def test_i_a_non_finite_value_is_refused(live, tmp_path):
    """⛔ `_render_json` serialises with allow_nan=False and RAISES on a non-finite — so
    one bad value would not be a wrong cell, it would 500 the Monitor for every member.

    ⚰️ AND IT USES INFINITY, NOT NaN, ON PURPOSE. SQLite has no NaN: it stores one as
    NULL (`typeof(x)` -> 'null'), so an artifact simply cannot carry a NaN and a `c != c`
    rail would pass forever while checking nothing. Infinity DOES survive as a REAL."""
    p = str(tmp_path / "nan.db")
    con = sqlite3.connect(p)
    con.execute(ART_SCHEMA)
    con.execute("INSERT INTO breadth_daily_ohlc(universe,date,metric,o,h,l,c,source) "
                "VALUES('us','2020-03-10','m0',1,2,3,?, 'close_recon')", (float("inf"),))
    con.commit(); con.close()
    with pytest.raises(imp.ImportRefused, match="non-finite"):
        imp.import_universe(p, "us")


def test_j_a_corrupt_artifact_is_refused(live, tmp_path):
    import os
    art = _artifact(str(tmp_path / "a.db"), n=4000)
    with open(art, "r+b") as fh:
        fh.seek(os.path.getsize(art) // 2)
        fh.write(b"\x00" * 8192)
    with pytest.raises(Exception):
        imp.import_universe(art, "us")


def test_k_dry_run_decides_without_writing(live, tmp_path):
    art = _artifact(str(tmp_path / "a.db"), n=50)
    res = imp.import_universe(art, "us", dry_run=True)
    assert res["imported"] == 0 and res["artifact"]["rows"] == 50
    assert "us" not in dict(_universes())


def test_l_imported_rows_are_STORED_and_still_not_PUBLISHED(live, tmp_path):
    """⭐⭐ THE INVARIANT THE WHOLE PHASE RESTS ON: stored != published. Rows existing
    changes nothing about reachability, which only `is_published()` decides."""
    from api.services import breadth_symbols as bs
    art = _artifact(str(tmp_path / "a.db"), n=50)
    imp.import_universe(art, "us")
    assert dict(_universes())["us"] == 50
    assert bs.is_published("us", "pct_above_50sma") is False
    assert bs.resolve("US:A50") is None
    assert [r["symbol"] for r in bs.list_breadth_symbols()] == \
           [r["symbol"] for r in bs.legacy_symbol_rows()]
    assert bs.build_breadth_bars("US:A50", "D", 400)["bars"] == []


def _universes():
    with store._conn() as c:
        return c.execute("SELECT universe, COUNT(*) FROM breadth_daily_ohlc "
                         "GROUP BY universe").fetchall()
