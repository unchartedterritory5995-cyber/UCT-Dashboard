"""Review finding #3 (2026-11-07): an interrupted evidence run must not lose the
open-session checkpoints, and partial rows must never reach the artifact.

The old run cleared the rows AND checkpoints of every wanted pair (committed at
once), committed rows every 50 tickers and wrote checkpoints only after the whole
loop. A run killed mid-loop left the still-open sessions with no checkpoint, so a
nightly ``--sessions 5`` never asked for them again, and the rows of the tickers
measured before the kill stayed in the store the artifact is built from.
"""

from __future__ import annotations

import random
import sqlite3
from datetime import date, timedelta

import pytest

from api.services import rs_evidence as ev
from api.services.rs_evidence import job as J
from api.services.rs_evidence import store as S


@pytest.fixture(autouse=True)
def _no_provider(monkeypatch):
    """No run here reaches the corporate-action provider (the split guard's default
    reader, N5): its fetch refuses and its brake is a local no-op."""
    from api.services import declared_splits as ds

    def refuse(ticker):
        raise RuntimeError("no provider in tests")
    monkeypatch.setattr(ds, "_default_fetch", refuse)
    monkeypatch.setattr(ds, "_default_gate", lambda: (lambda: True, lambda: 0.0, lambda: None))
    monkeypatch.setattr(ds, "_default_cache_get", lambda t: None)
    monkeypatch.setattr(ds, "_default_cache_set", lambda t, meta: None)
    monkeypatch.setattr(ds, "FETCH_PAUSE_S", 0)

N_SESSIONS = 470
N_TICKERS = 55            # > 50, so the old loop had committed a batch of rows before the kill
KILL_AT = "T52"           # the 53rd ticker: 52 measured, 50 of them committed by the old loop


def _weekdays(n: int, start: date = date(2020, 1, 2)) -> list:
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(int(d.strftime("%Y%m%d")))
        d += timedelta(days=1)
    return out


def _walk(seed: int, n: int, start: float, drift: float, vol: float = 0.015) -> list:
    rng = random.Random(seed)
    out, c = [], start
    for _ in range(n):
        c = c * (1.0 + drift + rng.gauss(0.0, vol))
        out.append(round(max(c, 1.0), 4))
    return out


def _universe():
    ts = _weekdays(N_SESSIONS)
    series = {"SPY": _walk(1, N_SESSIONS, 300.0, 0.0003, 0.01)}
    names = [f"T{i:02d}" for i in range(N_TICKERS)]
    for i, name in enumerate(names):
        series[name] = _walk(100 + i, N_SESSIONS, 20.0 + i, 0.0002 * ((i % 7) - 3))
    rows = {t: [(k, c, c, c, c, 1000) for k, c in zip(ts, closes)] for t, closes in series.items()}

    def reader(ticker, n, to_key):
        got = [r for r in rows.get(ticker.upper(), []) if r[0] <= int(to_key)]
        return got[-int(n):]
    return ts, names, reader


def _killing(reader, at: str):
    def r(ticker, n, to_key):
        if ticker == at:
            raise RuntimeError("worker killed mid-run (timeout / redeploy)")
        return reader(ticker, n, to_key)
    return r


def _all_rows(path):
    conn = sqlite3.connect(str(path))
    try:
        return conn.execute(f"SELECT * FROM {S.ROWS_TABLE} ORDER BY session, signal, ticker").fetchall()
    finally:
        conn.close()


def _checkpoints(path):
    conn = sqlite3.connect(str(path))
    try:
        return sorted(conn.execute(f"SELECT session, signal, status, rows FROM {S.CHECKPOINT_TABLE}").fetchall())
    finally:
        conn.close()


def _rows_without_checkpoint(path):
    conn = sqlite3.connect(str(path))
    try:
        return conn.execute(
            f"SELECT COUNT(*) FROM {S.ROWS_TABLE} r LEFT JOIN {S.CHECKPOINT_TABLE} c "
            f"ON c.session = r.session AND c.signal = r.signal WHERE c.session IS NULL").fetchone()[0]
    finally:
        conn.close()


def test_a_run_killed_mid_loop_keeps_open_checkpoints_and_the_next_night_matches_an_unbroken_store(tmp_path):
    ts, names, reader = _universe()
    kw = dict(universe=names, delisted_fn=lambda a, b: None)
    night1, night2, night3 = J.ymd_to_iso(ts[440]), J.ymd_to_iso(ts[450]), J.ymd_to_iso(ts[460])

    # reference: night 1 then a normal night 3, nothing interrupted
    ref = tmp_path / "ref.db"
    ev.run(db=str(ref), sessions=300, asof=night1, bars_reader=reader, **kw)
    ref3 = ev.run(db=str(ref), sessions=5, asof=night3, bars_reader=reader, **kw)
    assert ref3["ok"]

    # the same nights with night 2 killed at the 53rd ticker
    db = tmp_path / "ev.db"
    r1 = ev.run(db=str(db), sessions=300, asof=night1, bars_reader=reader, **kw)
    assert r1["artifact"]["sessions_open"] == 126
    rows_after_1, cps_after_1 = _all_rows(db), _checkpoints(db)

    with pytest.raises(RuntimeError):
        ev.run(db=str(db), sessions=5, asof=night2, bars_reader=_killing(reader, KILL_AT), **kw)

    # the kill changed nothing a member can see: night 1's rows and checkpoints are intact
    assert _checkpoints(db) == cps_after_1, "the open-session checkpoints survive an interrupted run"
    assert _all_rows(db) == rows_after_1, "no partial row of the killed run is in the published table"

    r3 = ev.run(db=str(db), sessions=5, asof=night3, bars_reader=reader, **kw)
    assert r3["ok"]
    # every open session of night 1 was re-measured on night 3 (126 + the 5 new sessions)
    assert r3["sessions_measured"] == ref3["sessions_measured"] == 131
    assert r3["artifact"] == ref3["artifact"], "the artifact counts exactly what an unbroken store counts"
    assert _all_rows(db) == _all_rows(ref)
    assert [c[:3] for c in _checkpoints(db)] == [c[:3] for c in _checkpoints(ref)]
    assert _rows_without_checkpoint(db) == 0


def test_a_store_already_holding_unchecked_rows_is_repaired_by_a_normal_night(tmp_path):
    """Belt and braces for a store the old code already damaged: rows with no
    checkpoint (some tickers of some open sessions) are re-requested, re-measured
    in full, and anything left without a checkpoint never reaches the artifact."""
    ts, names, reader = _universe()
    kw = dict(universe=names, delisted_fn=lambda a, b: None)
    night1, night3 = J.ymd_to_iso(ts[440]), J.ymd_to_iso(ts[460])

    ref = tmp_path / "ref.db"
    ev.run(db=str(ref), sessions=300, asof=night1, bars_reader=reader, **kw)
    ref3 = ev.run(db=str(ref), sessions=5, asof=night3, bars_reader=reader, **kw)

    db = tmp_path / "ev.db"
    ev.run(db=str(db), sessions=300, asof=night1, bars_reader=reader, **kw)
    # what the old interrupted run left behind: open checkpoints gone, a partial set of rows
    conn = sqlite3.connect(str(db))
    open_sessions = sorted(s for (s,) in conn.execute(
        f"SELECT DISTINCT session FROM {S.CHECKPOINT_TABLE} WHERE status = ?", (S.OPEN,)))
    assert len(open_sessions) == 126
    conn.execute(f"DELETE FROM {S.CHECKPOINT_TABLE} WHERE status = ?", (S.OPEN,))
    conn.execute(f"DELETE FROM {S.ROWS_TABLE} WHERE session >= ? AND ticker >= ?", (open_sessions[0], "T50"))
    # and an orphan on a session the calendar no longer reaches: it must not be published
    conn.execute(f"INSERT INTO {S.ROWS_TABLE}(session, signal, ticker) VALUES (?, ?, ?)",
                 (19990104, ev.BASELINE_KEY, "T00"))
    conn.commit()
    conn.close()

    r3 = ev.run(db=str(db), sessions=5, asof=night3, bars_reader=reader, **kw)
    assert r3["ok"]
    assert r3["sessions_measured"] == 131
    assert r3["artifact"] == ref3["artifact"]
    assert _all_rows(db) == _all_rows(ref)
    assert _rows_without_checkpoint(db) == 0
