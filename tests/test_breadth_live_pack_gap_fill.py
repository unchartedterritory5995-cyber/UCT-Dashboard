"""A bars pack that lists the session but is a session behind for some names (2026-11-19).

The 11-18 evening pack carried 11-18 for SPY — so it passed the "pack contains L" check —
while 303 of the 2,592 UCT names still ended at 11-17. Taken whole, the live levels and the
anchor priced 2,289 names, coverage fell to 0.89, the live read went `degraded`, and every
UCT breadth chart (UCTA5, UCTA50, ...) lost today's live bar for the whole session.
"""
import math
import sqlite3

import numpy as np

from api.services import breadth_live as bl
from api.services import breadth_live_universes as blu

DATES = [20261113, 20261116, 20261117, 20261118]


def _bars_db(tmp_path, rows):
    c = sqlite3.connect(tmp_path / "bars.db")
    c.execute("CREATE TABLE ohlcv (ticker TEXT, tf TEXT, ts INTEGER, c REAL, v REAL, "
              "PRIMARY KEY (ticker, tf, ts))")
    c.executemany("INSERT INTO ohlcv VALUES (?, 'D', ?, ?, ?)", rows)
    c.commit()
    return c


def _pack(tickers, behind):
    """Synthetic pack frame: every name has every date except `behind`, which ends a session early."""
    n, m = len(tickers), len(DATES)
    closes = np.full((n, m), 10.0)
    vols = np.full((n, m), 1000.0)
    for i, t in enumerate(tickers):
        if t in behind:
            closes[i, -1] = np.nan
            vols[i, -1] = np.nan
    return closes, vols


def test_names_behind_the_pack_are_reread_from_bars_db(tmp_path, monkeypatch):
    tickers = ["AAA", "BBB", "CCC", "HALT"]
    # bars.db is current for BBB; HALT genuinely has no bar on the newest session
    conn = _bars_db(tmp_path, [("BBB", d, 20.0 + k, 500.0) for k, d in enumerate(DATES)]
                    + [("HALT", d, 5.0, 50.0) for d in DATES[:-1]])
    monkeypatch.setattr(bl, "_frame_from_pack", lambda t, d: _pack(t, {"BBB", "HALT"}))

    closes, vols = bl._load_frame(conn, tickers, DATES)

    assert not math.isnan(closes[1, -1])            # BBB filled from bars.db
    assert list(closes[1]) == [20.0, 21.0, 22.0, 23.0]
    assert list(closes[0]) == [10.0] * 4            # a current pack row is untouched
    assert math.isnan(closes[3, -1])                # a name that did not trade stays NaN
    assert closes[3, 0] == 10.0                     # …and keeps its pack history


def test_a_current_pack_never_touches_bars_db(monkeypatch):
    class Boom:
        def execute(self, *a, **k):
            raise AssertionError("bars.db read on a current pack")
    monkeypatch.setattr(bl, "_frame_from_pack", lambda t, d: _pack(t, set()))
    closes, _v = bl._load_frame(Boom(), ["AAA", "BBB"], DATES)
    assert not np.isnan(closes).any()


def test_a_failed_fill_still_serves_the_pack_frame(monkeypatch):
    class Boom:
        def execute(self, *a, **k):
            raise RuntimeError("disk")
    monkeypatch.setattr(bl, "_frame_from_pack", lambda t, d: _pack(t, {"BBB"}))
    closes, _v = bl._load_frame(Boom(), ["AAA", "BBB"], DATES)
    assert closes[0, -1] == 10.0 and math.isnan(closes[1, -1])


def test_single_date_anchor_read_is_filled_too(tmp_path, monkeypatch):
    """The anchor re-prices the universe at ONE date (`_load_frame(conn, tickers, [L])`)."""
    conn = _bars_db(tmp_path, [("BBB", 20261118, 30.0, 9.0)])
    monkeypatch.setattr(bl, "_frame_from_pack",
                        lambda t, d: (np.array([[10.0], [np.nan]]), np.array([[1.0], [np.nan]])))
    closes, vols = bl._load_frame(conn, ["AAA", "BBB"], [20261118])
    assert closes[1, 0] == 30.0 and vols[1, 0] == 9.0


def test_by_key_reader_accepts_unsorted_dates(tmp_path):
    conn = _bars_db(tmp_path, [("BBB", d, float(k), 1.0) for k, d in enumerate(DATES)])
    c, _v = blu._load_frame_by_key(conn, ["BBB"], list(reversed(DATES)))
    assert list(c[0]) == [3.0, 2.0, 1.0, 0.0]


def test_levels_pin_bar_matches_the_anchor_bar():
    """0.88 of the universe (the 11-18 stale pack) must not be pinned as the session's levels
    while the anchor built from the same frame is judged thin at 0.95."""
    assert bl._LEVELS_MIN_FRACTION >= bl._ANCHOR_MIN_CACHE_FRACTION
    lv = {"tickers": [f"T{i}" for i in range(2592)],
          "sma_ok": {200: np.array([True] * 2281 + [False] * 311)}}
    assert not bl._levels_build_is_good(lv)
    lv["sma_ok"][200] = np.array([True] * 2560 + [False] * 32)
    assert bl._levels_build_is_good(lv)
