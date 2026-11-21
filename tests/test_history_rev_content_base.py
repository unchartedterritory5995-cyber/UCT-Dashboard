"""The content-derived base history_rev (2026-11-21): the same number on every store for the same content.

history_rev is what a browser compares (it refuses a LOWER one and re-reads on a HIGHER one), and one browser
reads one series from more than one store. Measured that day: 70 of 70 series served a different base on web and
bars-api, because each store's base is its own clock and its own floor. This unit:
  Q1(b) a ONE-TIME shared floor T, a committed constant: served base = max(history_rev, store floor, T);
  D1    a delta ships the worker's per-series history_rev and every pod adopts max(its own, shipped);
  D4    an install floor persists at once (not after the 1 s flusher) and the clock never starts below the store;
  D6    the adjustment-basis stamp binds to the series' own history_rev, so a floor never voids it.
Synthetic stores only."""
import sqlite3
import time

import pytest

from api.services import adjustment_basis as ab
from api.services import bars_sqlite as bs
from api.services import data_sync

#: ⛔ APPEND-ONLY. Every value HISTORY_REV_SHARED_FLOOR_MS has ever shipped with, oldest first. Raising T is a
#: deliberate PR that appends here; lowering it would make every browser refuse every store's answers as stale.
T_LEDGER = [1795231800000]          # 2026-11-21T03:30:00Z, above every floor and series measured that day


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(bs, "_DB_PATH", str(tmp_path / "bars.db"))
    bs.bump_db_epoch()
    bs.reset_meta_state_for_tests()
    bs.init_db()
    yield tmp_path
    bs.reset_meta_state_for_tests()
    bs.bump_db_epoch()


def _use(path, monkeypatch):
    monkeypatch.setattr(bs, "_DB_PATH", str(path))
    bs.bump_db_epoch()
    bs.reset_meta_state_for_tests()


def _set_meta(path, rows=(), floor=None):
    c = sqlite3.connect(path)
    for t, tf, rev, hrev in rows:
        c.execute("INSERT OR REPLACE INTO series_meta(ticker, tf, rev, history_rev) VALUES (?,?,?,?)", (t, tf, rev, hrev))
    if floor is not None:
        c.execute("INSERT OR REPLACE INTO store_meta(k, v) VALUES ('rev_floor_ms', ?)", (float(floor),))
    c.commit()
    c.close()


def _row_hrev(path, t, tf):
    c = sqlite3.connect(path)
    try:
        r = c.execute("SELECT history_rev FROM series_meta WHERE ticker=? AND tf=?", (t, tf)).fetchone()
        return None if r is None else int(r[0])
    finally:
        c.close()


T = bs.HISTORY_REV_SHARED_FLOOR_MS


# ── Q1(b): the shared floor ───────────────────────────────────────────────────────────────────────────────
def test_the_shared_floor_is_the_ledgers_last_value_and_never_fell():
    assert T == T_LEDGER[-1]
    assert all(a < b for a, b in zip(T_LEDGER, T_LEDGER[1:]))


def test_two_stores_with_different_floors_and_old_rows_serve_one_number(tmp_path, monkeypatch):
    """web's and bars-api's floors were 7.7 h apart, and every untouched series inherited the gap."""
    served = []
    for name, floor, row in (("web", T - 10_000_000, T - 50_000_000), ("api", T - 37_000_000, T - 1)):
        _use(tmp_path / f"{name}.db", monkeypatch)
        bs.init_db()
        _set_meta(tmp_path / f"{name}.db", [("SPY", "D", row, row)], floor)
        served.append(bs.series_meta("SPY", "D")["history_rev"])
    assert served == [T, T]


def test_a_series_written_after_T_keeps_its_own_rising_number(store):
    _set_meta(store / "bars.db", [("SPY", "D", T + 5, T + 5)])
    assert bs.series_meta("SPY", "D")["history_rev"] == T + 5
    c = bs._conn()
    with bs._WRITE_LOCK:
        bs.bump_series_revs(c, [("SPY", "D")], history=True)
        c.commit()
    assert bs.series_meta("SPY", "D")["history_rev"] > T + 5


def test_series_rev_is_never_below_history_rev(store):
    _set_meta(store / "bars.db", [("SPY", "D", 7, 7)])
    m = bs.series_meta("SPY", "D")
    assert m["rev"] >= m["history_rev"] == T


# ── D6: the stamp binds to the series' own history_rev ─────────────────────────────────────────────────────
def _stamped(path, hrev_row, bound, floor=None):
    c = sqlite3.connect(path)
    c.execute("INSERT OR REPLACE INTO ohlcv VALUES ('SPY','D',20260102,1,2,0.5,1.5,10)")
    c.execute("INSERT OR REPLACE INTO series_meta(ticker, tf, rev, history_rev, adj_basis) VALUES ('SPY','D',?,?,?)",
              (hrev_row, hrev_row, ab.bind_stamp([("2026-01-05", 2.0)], bound, 20260102)))
    if floor is not None:
        c.execute("INSERT OR REPLACE INTO store_meta(k, v) VALUES ('rev_floor_ms', ?)", (float(floor),))
    c.commit()
    c.close()


def test_a_stamp_bound_before_T_is_still_honoured(store):
    """Bound to the served number of its day, max(row, floor): T must not void every stamp on the deploy."""
    _stamped(store / "bars.db", hrev_row=100, bound=500, floor=500)
    assert bs.series_meta("SPY", "D")["adj_events"] is not None
    _stamped(store / "bars.db", hrev_row=100, bound=100)
    bs.bump_db_epoch()
    assert bs.series_meta("SPY", "D")["adj_events"] is not None


def test_a_stamp_from_another_history_is_void(store):
    _stamped(store / "bars.db", hrev_row=100, bound=99)
    assert bs.series_meta("SPY", "D")["adj_events"] is None


def test_apply_split_basis_binds_to_the_rows_own_history_rev(store):
    import inspect
    src = inspect.getsource(bs.apply_split_basis)
    assert "_ab.bind_stamp(p[\"adj_events\"], hrev, first)" in src
    assert "SELECT history_rev FROM series_meta WHERE ticker=? AND tf=?" in src          # the row, never the floored value


# ── D1: a delta ships the worker's history_rev, and a pod adopts max(own, shipped) ─────────────────────────
def _ohlcv_db(path, rows, ship=None):
    c = sqlite3.connect(path)
    c.execute("CREATE TABLE IF NOT EXISTS ohlcv (ticker TEXT NOT NULL, tf TEXT NOT NULL, ts INTEGER NOT NULL, "
              "o REAL, h REAL, l REAL, c REAL, v INTEGER, PRIMARY KEY (ticker, tf, ts))")
    c.executemany("INSERT OR REPLACE INTO ohlcv VALUES (?,?,?,?,?,?,?,?)",
                  [(t, tf, ts, x, x + 1, x - 1, x, 10) for t, tf, ts, x in rows])
    if ship is not None:
        c.execute(data_sync.SHIP_META_DDL)
        c.executemany(f"INSERT INTO {data_sync.SHIP_META_TABLE} VALUES (?,?,?)", ship)
    c.commit()
    c.close()


def test_the_worker_ships_its_served_history_rev_for_every_exported_pair(store, monkeypatch):
    monkeypatch.setattr(data_sync, "_DATA_DIR", str(store))
    today = int(time.strftime("%Y%m%d"))
    _ohlcv_db(store / "bars.db", [("AAA", "D", today, 10.0), ("BBB", "D", today, 20.0)])
    _set_meta(store / "bars.db", [("AAA", "D", T + 9, T + 9)])
    out = store / "delta.db"
    assert data_sync._export_delta_db(str(out)) == 2
    c = sqlite3.connect(out)
    got = dict(((t, tf), h) for t, tf, h in c.execute(f"SELECT ticker, tf, history_rev FROM {data_sync.SHIP_META_TABLE}"))
    c.close()
    assert got == {("AAA", "D"): T + 9}                               # BBB: never written on the worker, nothing to ship


def test_two_pods_that_apply_the_same_delta_serve_the_shipped_number(tmp_path, monkeypatch):
    shipped = T + 1_000
    snap = tmp_path / "delta.db"
    _ohlcv_db(snap, [("AAA", "D", 20261120, 10.0)], ship=[("AAA", "D", shipped)])
    served = []
    for name, own in (("web", T + 400), ("api", T - 9_000_000)):
        p = tmp_path / f"{name}.db"
        _use(p, monkeypatch)
        bs.init_db()
        _ohlcv_db(p, [("AAA", "D", 20261119, 9.0)])
        _set_meta(p, [("AAA", "D", own, own)])
        data_sync._merge_ohlcv_from(str(snap), local_db=str(p), skip_unchanged=True)
        bs.bump_db_epoch()
        served.append(bs.series_meta("AAA", "D")["history_rev"])
    assert served == [shipped, shipped]


def test_a_shipped_number_never_lowers_a_pod(tmp_path, monkeypatch):
    snap = tmp_path / "delta.db"
    _ohlcv_db(snap, [("AAA", "D", 20261120, 10.0)], ship=[("AAA", "D", T + 5)])
    p = tmp_path / "web.db"
    _use(p, monkeypatch)
    bs.init_db()
    _set_meta(p, [("AAA", "D", T + 50, T + 50)])
    data_sync._merge_ohlcv_from(str(snap), local_db=str(p), skip_unchanged=True)
    assert _row_hrev(p, "AAA", "D") == T + 50


def test_a_pair_the_merge_skips_as_unchanged_still_adopts(tmp_path, monkeypatch):
    """skip_unchanged leaves a pair whose rows match; its shipped number is a fact about the worker all the same."""
    p, s1, s2 = tmp_path / "web.db", tmp_path / "d1.db", tmp_path / "d2.db"
    _use(p, monkeypatch)
    bs.init_db()
    _ohlcv_db(s1, [("AAA", "D", 20261120, 10.0)])
    data_sync._merge_ohlcv_from(str(s1), local_db=str(p), skip_unchanged=True)
    _ohlcv_db(s2, [("AAA", "D", 20261120, 10.0)], ship=[("AAA", "D", T + 77)])
    data_sync._merge_ohlcv_from(str(s2), local_db=str(p), skip_unchanged=True)
    assert _row_hrev(p, "AAA", "D") == T + 77


def test_an_old_format_delta_changes_nothing_about_history_rev(tmp_path, monkeypatch):
    p, snap = tmp_path / "web.db", tmp_path / "delta.db"
    _use(p, monkeypatch)
    bs.init_db()
    _set_meta(p, [("AAA", "D", T + 3, T + 3)])
    _ohlcv_db(p, [("AAA", "D", 20261119, 9.0)])
    _ohlcv_db(snap, [("AAA", "D", 20261120, 10.0)])                    # no ship table
    data_sync._merge_ohlcv_from(str(snap), local_db=str(p), skip_unchanged=True)
    assert _row_hrev(p, "AAA", "D") == T + 3


def test_a_merged_history_change_takes_the_shipped_number_when_it_rises(tmp_path, monkeypatch):
    """When the merge itself changes held history, the pod's new number must RISE above what it served. The
    worker's number does that when it is higher, and then both pods carry it; otherwise the pod's clock does."""
    monkeypatch.setattr(bs, "_history_keys", lambda *a, **k: True)
    monkeypatch.setattr(data_sync, "_merge_basis_agrees", lambda *a, **k: True)
    monkeypatch.setattr(data_sync, "_merge_split_near", lambda *a, **k: False)
    base = 1_790_000_100                                              # on the 5-minute grid
    # The realistic case: the worker's stamp is ABOVE what this pod served (T + 500) but BELOW this pod's clock
    # (now is past T): only the in-merge choice carries it; the adopt pass alone would leave the pod's clock.
    for shipped, expect_shipped in ((T + 600, True), (T + 1, False)):
        p, snap = tmp_path / f"p{shipped}.db", tmp_path / f"s{shipped}.db"
        _use(p, monkeypatch)
        bs.init_db()
        _ohlcv_db(p, [("AAA", "5", base, 9.0), ("AAA", "5", base + 600, 9.0)])
        _set_meta(p, [("AAA", "5", T + 500, T + 500)])
        _ohlcv_db(snap, [("AAA", "5", base + 300, 9.5)], ship=[("AAA", "5", shipped)])
        data_sync._merge_ohlcv_from(str(snap), local_db=str(p), skip_unchanged=True)
        got = _row_hrev(p, "AAA", "5")
        assert got > T + 500
        assert (got == shipped) is expect_shipped


# ── D4: the install floor persists at once; the clock never starts below the store ─────────────────────────
def test_an_install_floor_is_on_disk_before_the_call_returns(store):
    bs.bump_store_floor("snapshot installed", persist=True)
    c = sqlite3.connect(store / "bars.db")
    v = c.execute("SELECT v FROM store_meta WHERE k='rev_floor_ms'").fetchone()
    c.close()
    assert v is not None and v[0] >= T


def test_a_floor_that_cannot_be_persisted_never_raises(store, monkeypatch):
    def boom(*a, **k):
        raise sqlite3.OperationalError("database is locked")
    monkeypatch.setattr(bs, "_persist_floors_now", boom)
    bs.bump_store_floor("snapshot installed", persist=True)          # falls back to the flusher


def test_the_clock_never_starts_below_what_the_store_already_holds(store, monkeypatch):
    ahead = int(time.time() * 1000) + 600_000                         # a wall clock stepped back 10 minutes
    _set_meta(store / "bars.db", [("SPY", "D", ahead, ahead)], floor=ahead - 5)
    monkeypatch.setattr(bs, "_hlc_last_ms", 0)
    monkeypatch.setattr(bs, "_hlc_seeded", False)
    assert bs._now_ms() > ahead


def test_every_install_site_persists_its_floor_at_once():
    import inspect
    src = inspect.getsource(data_sync)
    for reason in ("adopted clustered store (boot swap)", "adopted clustered store", "snapshot installed",
                   "empty schema recreated"):
        assert f'bump_store_floor("{reason}", persist=True)' in src, reason
