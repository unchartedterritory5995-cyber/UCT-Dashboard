"""`intraday_recon_1m` (the V2 re-grind) in the merge and on the serving path.

⚰️⚰️ THE FAILURE THESE PIN. Before this, `_MERGE_SQL`'s `source IN (...)` gate and
`_TRUSTED_SOURCES` both listed only ('live','intraday_recon','close_recon'). A V2
snapshot — 568,694 rows, every one tagged `intraday_recon_1m` — therefore merged
ZERO rows while `_merge_from` returned normally, and had the merge been fixed alone
the readers would still have served none of them. Both doors are pinned here, and
`test_negative_control_*` is the test that fails if either regresses.
"""
import sqlite3

import pytest

from api.services import breadth_daily_ohlc as store
from api.services import breadth_ohlc_sync as bridge


@pytest.fixture()
def fresh_store(tmp_path, monkeypatch):
    monkeypatch.setenv("BREADTH_OHLC_DB", str(tmp_path / "web_ohlc.db"))
    store._INIT_DONE = False
    yield
    store._INIT_DONE = False


def _make_snap(path, rows):
    """A worker/V2 snapshot carrying the universe column (post-migration shape).
    `rows` = [(universe, date, metric, o, h, l, c, source)]."""
    c = sqlite3.connect(path)
    try:
        c.execute(
            """CREATE TABLE breadth_daily_ohlc (
                universe TEXT NOT NULL DEFAULT 'uct',
                date TEXT NOT NULL, metric TEXT NOT NULL,
                o REAL, h REAL, l REAL, c REAL,
                source TEXT DEFAULT 'live',
                updated_at TEXT DEFAULT (datetime('now')),
                PRIMARY KEY (universe, date, metric))"""
        )
        c.executemany(
            "INSERT INTO breadth_daily_ohlc"
            "(universe,date,metric,o,h,l,c,source,updated_at) "
            "VALUES(?,?,?,?,?,?,?,?, datetime('now'))", rows)
        c.commit()
    finally:
        c.close()


def _rows(universe="uct"):
    with store._conn() as c:
        return {(d, m): (o, h, l, cc, src) for d, m, o, h, l, cc, src in c.execute(
            "SELECT date,metric,o,h,l,c,source FROM breadth_daily_ohlc WHERE universe=?",
            (universe,))}


def test_negative_control_v2_rows_are_adopted_not_silently_dropped(fresh_store, tmp_path):
    """⛔ THE REGRESSION GUARD. Remove `intraday_recon_1m` from either the merge
    gate or `_RANK` and this fails with `adopted == 0` — exactly the production
    failure mode, which previously looked like success."""
    snap = str(tmp_path / "v2.db")
    _make_snap(snap, [("uct", "2011-06-01", "pct_above_50sma",
                       40.0, 41.0, 22.0, 24.0, "intraday_recon_1m")])
    adopted = bridge._merge_from(snap)
    assert adopted == 1, "the V2 source was filtered out of the merge"
    got = _rows()[("2011-06-01", "pct_above_50sma")]
    assert got == (40.0, 41.0, 22.0, 24.0, "intraday_recon_1m")


def test_v2_upgrades_close_recon_and_intraday_recon(fresh_store, tmp_path):
    store.write_bulk([("2011-06-01", "pct_above_50sma", 30.0, 30.0, 30.0, 30.0)],
                     source="close_recon")
    store.write_bulk([("2012-06-11", "pct_above_50sma", 31.0, 33.0, 29.0, 30.0)],
                     source="intraday_recon")
    snap = str(tmp_path / "v2.db")
    _make_snap(snap, [
        ("uct", "2011-06-01", "pct_above_50sma", 40.0, 41.0, 22.0, 24.0, "intraday_recon_1m"),
        ("uct", "2012-06-11", "pct_above_50sma", 44.0, 45.0, 20.0, 21.0, "intraday_recon_1m"),
    ])
    assert bridge._merge_from(snap) == 2
    r = _rows()
    assert r[("2011-06-01", "pct_above_50sma")][4] == "intraday_recon_1m"
    assert r[("2012-06-11", "pct_above_50sma")][4] == "intraday_recon_1m"


def test_v2_never_overwrites_a_live_row(fresh_store, tmp_path):
    """⭐ The accumulator's own same-day record outranks any reconstruction."""
    store.update_intraday("2026-08-07", {"pct_above_50sma": 30.0})
    before = _rows()[("2026-08-07", "pct_above_50sma")]
    assert before[4] == "live"
    snap = str(tmp_path / "v2.db")
    _make_snap(snap, [("uct", "2026-08-07", "pct_above_50sma",
                       1.0, 2.0, 0.5, 1.5, "intraday_recon_1m")])
    bridge._merge_from(snap)
    assert _rows()[("2026-08-07", "pct_above_50sma")] == before


def test_a_later_lower_rank_sweep_cannot_downgrade_v2(fresh_store, tmp_path):
    """⛔ A retry must never demote a trusted row. `intraday_recon`(2) and
    `close_recon`(1) both sit below `intraday_recon_1m`(3), so a routine sweep
    shipping the same key later leaves it alone."""
    snap = str(tmp_path / "v2.db")
    _make_snap(snap, [("uct", "2011-06-01", "pct_above_50sma",
                       40.0, 41.0, 22.0, 24.0, "intraday_recon_1m")])
    bridge._merge_from(snap)
    later = str(tmp_path / "sweep.db")
    _make_snap(later, [
        ("uct", "2011-06-01", "pct_above_50sma", 9.0, 9.0, 9.0, 9.0, "intraday_recon"),
    ])
    bridge._merge_from(later)
    assert _rows()[("2011-06-01", "pct_above_50sma")][4] == "intraday_recon_1m"


def test_a_corrected_v2_rerun_still_propagates(fresh_store, tmp_path):
    """Same rank + newer updated_at wins, so a corrected re-grind can fix itself."""
    snap = str(tmp_path / "v2.db")
    _make_snap(snap, [("uct", "2011-06-01", "pct_above_50sma",
                       40.0, 41.0, 22.0, 24.0, "intraday_recon_1m")])
    bridge._merge_from(snap)
    with store._conn() as c:                       # age the local row
        c.execute("UPDATE breadth_daily_ohlc SET updated_at='2000-01-01 00:00:00'")
    fixed = str(tmp_path / "v2b.db")
    _make_snap(fixed, [("uct", "2011-06-01", "pct_above_50sma",
                        40.0, 41.0, 30.0, 31.0, "intraday_recon_1m")])
    bridge._merge_from(fixed)
    assert _rows()[("2011-06-01", "pct_above_50sma")][3] == 31.0


def test_v2_rows_are_actually_SERVED(fresh_store, tmp_path):
    """⛔ THE SECOND DOOR. Adoption is not delivery: `history()` and friends filter
    on `_TRUSTED_SOURCES`, so a merge-only fix would store the rows and serve none."""
    snap = str(tmp_path / "v2.db")
    _make_snap(snap, [("uct", "2011-06-01", "pct_above_50sma",
                       40.0, 41.0, 22.0, 24.0, "intraday_recon_1m")])
    bridge._merge_from(snap)
    h = store.history("pct_above_50sma", universe="uct")
    assert "2011-06-01" in h, "V2 row adopted but NOT served"
    assert h["2011-06-01"]["h"] == 41.0
    assert "2011-06-01" in store.distinct_dates_by_scan(universe="uct")
    assert "2011-06-01" in store.dates_since(universe="uct", since="2011-01-01")
    assert store.closes_for_dates(["2011-06-01"], universe="uct")


def test_geometry_gate_still_rejects_an_inverted_v2_candle(fresh_store, tmp_path):
    """The new source buys no exemption from the OHLC gate."""
    snap = str(tmp_path / "v2.db")
    _make_snap(snap, [("uct", "2011-06-02", "pct_above_50sma",
                       40.0, 10.0, 22.0, 24.0, "intraday_recon_1m")])   # h < o
    assert bridge._merge_from(snap) == 0
    assert ("2011-06-02", "pct_above_50sma") not in _rows()
