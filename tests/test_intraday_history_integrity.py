"""W-F — stored intraday history integrity (2026-11-10).

Synthetic stores and fake providers only; every price here is an invented round
number. Covers: intraday split-cliff heal (proven cliffs rescaled; see test_intraday_split_heal_basis.py), the R2 merge (holes / corrections / chunks),
the fallback-provider basis + history-complete guard, half-day `_is_market_open`,
null-volume delta parsing, the prior-session gap-fill reach, and the RTH gap audit.
"""
from __future__ import annotations

import datetime as _dt
import logging
import sqlite3
from zoneinfo import ZoneInfo

import pytest

from api.services import bars_fetch, bars_sqlite, data_sync
from api.services import intraday_gap_audit as gap
from api.services import intraday_split_heal as ish
from api.services import bars_sanitize as bs
from api.services.cache import cache

ET = ZoneInfo("America/New_York")


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("INTRADAY_SPLIT_HEAL_MODE", "write")
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(tmp_path / "bars.db"))
    bars_sqlite.bump_db_epoch()
    bars_sqlite.init_db()
    yield
    bars_sqlite.bump_db_epoch()


def _et(y, m, d, hh, mm):
    return int(_dt.datetime(y, m, d, hh, mm, tzinfo=ET).timestamp())


SESSIONS = [(2026, 10, 5), (2026, 10, 6), (2026, 10, 7), (2026, 10, 8), (2026, 10, 9),
            (2026, 10, 12)]
SPLIT_DAY = "2026-10-08"


def _series(pre_px: float, post_px: float, tf="5"):
    """Six sessions of 5m RTH bars; sessions on/after SPLIT_DAY trade at post_px."""
    out = []
    for (y, m, d) in SESSIONS:
        px = post_px if _dt.date(y, m, d).isoformat() >= SPLIT_DAY else pre_px
        for k in range(6):
            t = _et(y, m, d, 10, 0) + k * 300
            out.append({"t": t, "o": px, "h": px + 1, "l": px - 1, "c": px, "v": 1000})
    return out


def _daily(ticker, px):
    """Stored daily closes on the CURRENT basis (the independent proof the heal asks for)."""
    bars_sqlite.put_bars(ticker, "D", [{"t": _dt.date(y, m, d).isoformat(), "o": px, "h": px,
                                        "l": px, "c": px, "v": 1} for (y, m, d) in SESSIONS],
                         date_tf=True)


def _stored(ticker, tf):
    return bars_sqlite.get_bars(ticker, tf, 100000)


# ── 1. Intraday split cliff: a PROVEN cliff is healed; anything else is never written ──

SPLITS = [(SPLIT_DAY, 2.0)]


def test_a_proven_split_cliff_is_healed_in_the_store(store, caplog):
    bars_sqlite.put_bars("SPLT", "5", _series(100.0, 50.0))
    _daily("SPLT", 50.0)
    with caplog.at_level(logging.WARNING, logger=ish._log.name):
        res = ish.heal_series("SPLT", "5", splits=SPLITS)
    assert res["cliffs"] == [(SPLIT_DAY, 2.0)] and res["written"] == 18
    assert _stored("SPLT", "5") == [tuple(r) for r in bars_sqlite.get_bars("SPLT", "5", 100000)]
    assert {r[4] for r in _stored("SPLT", "5")} == {50.0}    # one basis, no cliff
    assert "intraday-split-heal" in caplog.text and "RESCALED" in caplog.text


def test_an_unprovable_cliff_is_detected_and_logged_but_nothing_is_written(store, caplog):
    """A second split-sized step anywhere in the series (a bad print) makes the step count
    != 1: refused, byte-identical store, basis unknown."""
    bars = _series(100.0, 50.0)
    bars[3] = dict(bars[3], o=200.0, h=201.0, l=199.0, c=200.0)   # a lone 2x print
    bars_sqlite.put_bars("SPLT", "5", bars)
    before = _stored("SPLT", "5")
    with caplog.at_level(logging.WARNING, logger=ish._log.name):
        res = ish.heal_series("SPLT", "5", splits=SPLITS)
    assert res["cliffs"] == [(SPLIT_DAY, 2.0)] and res["written"] == 0
    assert _stored("SPLT", "5") == before                    # byte-identical store
    assert bars_sqlite.series_meta("SPLT", "5")["adj_basis"] is None
    assert "intraday-split-cliff" in caplog.text and "NOT rewritten" in caplog.text


def test_partially_rewritten_or_mixed_series_is_never_modified(store):
    """N1/N2: a mixed store (new-basis rows below old-basis ones) shows its junction as a
    1/r step — never rewritten."""
    mixed = _series(100.0, 50.0)
    mixed[:6] = [dict(b, o=50.0, h=51.0, l=49.0, c=50.0) for b in mixed[:6]]   # new basis deep
    bars_sqlite.put_bars("MIX", "5", mixed)
    before = _stored("MIX", "5")
    ish.heal_ticker("MIX", splits=SPLITS)
    assert _stored("MIX", "5") == before


def test_continuous_series_reports_no_cliff(store):
    bars_sqlite.put_bars("OK", "5", _series(50.0, 50.0))
    assert ish.heal_series("OK", "5", splits=SPLITS)["cliffs"] == []


def test_detection_streams_closes_in_pages(store):
    bars_sqlite.put_bars("SPLT", "5", _series(100.0, 50.0))
    seen = list(bars_sqlite.iter_ts_close("SPLT", "5", batch=7))
    assert len(seen) == 36 and [t for t, _ in seen] == sorted(t for t, _ in seen)


def test_no_declared_split_never_reads(store, monkeypatch):
    bars_sqlite.put_bars("FLAT", "5", _series(100.0, 50.0))
    monkeypatch.setattr(bars_sqlite, "iter_ts_close", lambda *a, **k: pytest.fail("read"))
    assert ish.heal_series("FLAT", "5", splits=[])["cliffs"] == []


def test_heal_ticker_checks_every_intraday_tf(store):
    for tf in ("5", "15"):
        bars_sqlite.put_bars("SPLT", tf, _series(100.0, 50.0))
    _daily("SPLT", 50.0)
    by_tf = {r["tf"]: r for r in ish.heal_ticker("SPLT", splits=SPLITS)}
    assert set(by_tf) == {"1", "5", "15", "30", "60"}
    assert by_tf["5"]["cliffs"] and by_tf["15"]["cliffs"] and not by_tf["1"]["cliffs"]
    assert by_tf["5"]["written"] == 18 and by_tf["15"]["written"] > 0 and by_tf["1"]["written"] == 0


def test_note_served_schedules_a_check_only_when_the_stamp_is_not_the_target(store, monkeypatch):
    """A check is scheduled when the series' stored adj_basis is not the ticker's target
    basis (never checked, or a split it was not checked against), at most once per
    (ticker, tf, target) per TTL; never on a cold metadata cache, never for D/W/M."""
    from api.services import adjustment_basis as ab
    submitted = []
    monkeypatch.setattr(ish._pool, "submit", lambda fn: submitted.append(fn))
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    ish._checked.clear()
    ish._inflight.clear()
    bars = _series(100.0, 50.0)
    cache.set(bs._META_KEY.format("NOTE"), {"ipo": None, "splits": [(SPLIT_DAY, 2.0)]}, ttl=60)
    cache.set(bs._META_KEY.format("DONE"), {"ipo": None, "splits": [(SPLIT_DAY, 2.0)]}, ttl=60)
    cache.delete_prefix(bs._META_KEY.format("COLD"))
    monkeypatch.setattr(bs, "_meta_cached", lambda t: cache.get(bs._META_KEY.format(t)))
    bars_sqlite.put_bars("DONE", "5", bars[-3:])
    bars_sqlite.apply_split_basis("DONE", {"5": {"rev": bars_sqlite.series_meta("DONE", "5")["rev"],
                                                 "adj_events": [(SPLIT_DAY, 2.0)], "rescale": []}})
    assert bars_sqlite.series_meta("DONE", "5")["adj_basis"] == ab.target_basis_id([(SPLIT_DAY, 2.0)])
    assert ish.note_served("NOTE", "5", bars) is True
    ish._inflight.clear()
    assert ish.note_served("NOTE", "5", bars) is False      # memoised for the TTL
    assert ish.note_served("DONE", "5", bars) is False      # already on the target basis
    assert ish.note_served("COLD", "5", bars) is False      # splits unknown: nothing judged
    assert ish.note_served("NOTE", "D", bars) is False      # daily has its own repair
    assert len(submitted) == 1
    ish._checked.clear()
    ish._inflight.clear()


def test_fmt_sqlite_bars_calls_the_split_hook_for_intraday_only(monkeypatch):
    seen = []
    monkeypatch.setattr(ish, "note_served", lambda tk, tf, b: seen.append((tk, tf, len(b))))
    rows = [(1_760_000_100 + i * 300, 1.0, 2.0, 0.5, 1.5, 10) for i in range(3)]
    bars_fetch._fmt_sqlite_bars(rows, "5", "HOOK")
    bars_fetch._fmt_sqlite_bars(rows, "5")                  # no ticker: never
    assert seen == [("HOOK", "5", 3)]


# ── 2. R2 merge: holes, corrections, partial bar, chunks ─────────────────────

def _mkdb(path, rows):
    c = sqlite3.connect(str(path))
    c.execute("CREATE TABLE ohlcv (ticker TEXT NOT NULL, tf TEXT NOT NULL, ts INTEGER NOT NULL, "
              "o REAL, h REAL, l REAL, c REAL, v INTEGER, PRIMARY KEY (ticker, tf, ts))")
    c.executemany("INSERT INTO ohlcv VALUES (?,?,?,?,?,?,?,?)", rows)
    c.commit()
    c.close()


def _all(path, tk="AAA", tf="5"):
    c = sqlite3.connect(str(path))
    try:
        return c.execute("SELECT ts, c, v FROM ohlcv WHERE ticker=? AND tf=? ORDER BY ts",
                         (tk, tf)).fetchall()
    finally:
        c.close()


T0 = 1_760_000_100   # a 5m bucket start (the store keys intraday rows on the grid)


def _r(tk, tf, ts, c=10.0, v=100):
    return (tk, tf, ts, c, c + 1, c - 1, c, v)


def test_merge_fills_holes_and_replaces_the_partial_tail(tmp_path):
    local, snap = tmp_path / "bars.db", tmp_path / "snap.db"
    _mkdb(local, [_r("AAA", "5", T0), _r("AAA", "5", T0 + 600),
                  _r("AAA", "5", T0 + 900, v=40)])           # tail stored mid-formation
    _mkdb(snap, [_r("AAA", "5", T0), _r("AAA", "5", T0 + 300),   # the hole
                 _r("AAA", "5", T0 + 600),
                 _r("AAA", "5", T0 + 900, c=10.5, v=120),       # the finished bar
                 _r("AAA", "5", T0 + 1200)])                   # forward
    n = data_sync._merge_ohlcv_from(str(snap), local_db=str(local))
    assert n == 3
    rows = _all(local)
    assert [r[0] for r in rows] == [T0, T0 + 300, T0 + 600, T0 + 900, T0 + 1200]
    assert rows[3][1:] == (10.5, 120)


def test_merge_never_regresses_a_more_complete_local_row(tmp_path):
    local, snap = tmp_path / "bars.db", tmp_path / "snap.db"
    _mkdb(local, [_r("AAA", "5", T0), _r("AAA", "5", T0 + 300, c=11.0, v=500)])
    _mkdb(snap, [_r("AAA", "5", T0), _r("AAA", "5", T0 + 300, c=10.0, v=200)])
    assert data_sync._merge_ohlcv_from(str(snap), local_db=str(local)) == 0
    assert _all(local)[1][1:] == (11.0, 500)


def test_merge_with_a_different_price_basis_is_forward_only(tmp_path):
    """A snapshot on another split basis must not be interleaved into the series."""
    local, snap = tmp_path / "bars.db", tmp_path / "snap.db"
    _mkdb(local, [_r("AAA", "5", T0, c=50.0), _r("AAA", "5", T0 + 600, c=50.0)])
    _mkdb(snap, [_r("AAA", "5", T0, c=100.0), _r("AAA", "5", T0 + 300, c=100.0),
                 _r("AAA", "5", T0 + 600, c=100.0, v=999), _r("AAA", "5", T0 + 900, c=50.0)])
    assert data_sync._merge_ohlcv_from(str(snap), local_db=str(local)) == 1
    assert [r[0] for r in _all(local)] == [T0, T0 + 600, T0 + 900]


def test_merge_skips_interior_when_old_basis_rows_hide_below_agreeing_recent_rows(tmp_path):
    """F2: the newest common rows agree (post-split) but the window's oldest common
    rows are on the snapshot's OLD basis — nothing may be interleaved or replaced."""
    local, snap = tmp_path / "bars.db", tmp_path / "snap.db"
    recent = [T0 + 900 + k * 300 for k in range(8)]           # > the 5-row newest sample
    mx = recent[-1] + 300
    _mkdb(local, [_r("AAA", "5", T0, c=50.0)] + [_r("AAA", "5", t, c=50.0) for t in recent]
          + [_r("AAA", "5", mx, c=50.0, v=40)])
    _mkdb(snap, [_r("AAA", "5", T0, c=100.0, v=999),          # pre-split, old basis
                 _r("AAA", "5", T0 + 300, c=100.0)]           # old-basis "hole"
          + [_r("AAA", "5", t, c=50.0) for t in recent] + [_r("AAA", "5", mx, c=50.0, v=120)])
    assert data_sync._merge_ohlcv_from(str(snap), local_db=str(local)) == 0
    assert {r[1] for r in _all(local)} == {50.0} and len(_all(local)) == 10


def test_merge_skips_interior_near_a_declared_split(tmp_path, monkeypatch):
    """F2: a reverse split's higher old-basis volume must never REPLACE a healed row."""
    local, snap = tmp_path / "bars.db", tmp_path / "snap.db"
    _mkdb(local, [_r("AAA", "5", T0), _r("AAA", "5", T0 + 600), _r("AAA", "5", T0 + 900, v=40)])
    _mkdb(snap, [_r("AAA", "5", T0), _r("AAA", "5", T0 + 300), _r("AAA", "5", T0 + 600),
                 _r("AAA", "5", T0 + 900, v=120)])
    day = _dt.datetime.fromtimestamp(T0, ET).date().isoformat()
    cache.set(bs._META_KEY.format("AAA"), {"ipo": None, "splits": [(day, 0.1)]}, ttl=60)
    try:
        assert data_sync._merge_ohlcv_from(str(snap), local_db=str(local)) == 0
    finally:
        cache.invalidate(bs._META_KEY.format("AAA"))
    assert [r[0] for r in _all(local)] == [T0, T0 + 600, T0 + 900]
    assert _all(local)[-1][2] == 40


def test_merge_daily_stays_forward_only(tmp_path):
    local, snap = tmp_path / "bars.db", tmp_path / "snap.db"
    _mkdb(local, [_r("AAA", "D", 20261001), _r("AAA", "D", 20261005, v=10)])
    _mkdb(snap, [_r("AAA", "D", 20261001), _r("AAA", "D", 20261002),
                 _r("AAA", "D", 20261005, v=99)])
    assert data_sync._merge_ohlcv_from(str(snap), local_db=str(local)) == 0


def test_merge_is_chunked_and_logs_start_end_and_lock_time(tmp_path, monkeypatch, caplog):
    local, snap = tmp_path / "bars.db", tmp_path / "snap.db"
    _mkdb(local, [_r("AAA", "5", T0)])
    _mkdb(snap, [_r(f"T{i:02d}", "5", T0) for i in range(7)])
    monkeypatch.setattr(data_sync, "_MERGE_CHUNK_PAIRS", 3)
    begins = []
    real = sqlite3.connect

    class _Spy:
        def __init__(self, c):
            self._c = c

        def execute(self, sql, *a):
            if sql.strip().upper().startswith("BEGIN"):
                begins.append(sql)
            return self._c.execute(sql, *a)

        def __getattr__(self, k):
            return getattr(self._c, k)

    monkeypatch.setattr(data_sync.sqlite3, "connect", lambda *a, **k: _Spy(real(*a, **k)))
    with caplog.at_level(logging.INFO, logger=data_sync.logger.name):
        assert data_sync._merge_ohlcv_from(str(snap), local_db=str(local)) == 7
    assert len(begins) == 3                                   # 3 + 3 + 1 pairs
    text = caplog.text
    assert "merge start: 7 pairs" in text and "merge end:" in text and "lock max" in text


def test_merge_statements_seek_by_primary_key():
    c = sqlite3.connect(":memory:")
    c.execute("ATTACH ':memory:' AS snap")
    for db in ("main", "snap"):
        c.execute(f"CREATE TABLE {db}.ohlcv (ticker TEXT NOT NULL, tf TEXT NOT NULL, "
                  "ts INTEGER NOT NULL, o REAL, h REAL, l REAL, c REAL, v INTEGER, "
                  "PRIMARY KEY (ticker, tf, ts))")
    for sql in (data_sync._MERGE_ADD_SQL, data_sync._MERGE_CORRECT_SQL):
        plan = " | ".join(r[3] for r in c.execute("EXPLAIN QUERY PLAN " + sql, ("A", "5", 0)))
        assert "SCAN" not in plan, plan
    for sql in (data_sync._MERGE_BASIS_NEWEST_SQL, data_sync._MERGE_BASIS_OLDEST_SQL):
        plan = [r[3] for r in c.execute("EXPLAIN QUERY PLAN " + sql, (0,) * sql.count("?"))]
        assert not any(p.startswith(("SCAN main.ohlcv", "SCAN ohlcv", "SCAN s")) for p in plan), plan


# ── 3. Fallback providers ────────────────────────────────────────────────────

def test_yfinance_intraday_is_split_only_with_extended_hours_and_survives_nan(monkeypatch):
    import pandas as pd
    seen = {}
    idx = pd.DatetimeIndex([pd.Timestamp("2026-10-06 09:30", tz=ET),
                            pd.Timestamp("2026-10-06 09:35", tz=ET),
                            pd.Timestamp("2026-10-06 09:40", tz=ET)])
    df = pd.DataFrame({"Open": [1.0, float("nan"), 1.0], "High": [2.0, 2.0, 2.0],
                       "Low": [0.5, 0.5, 0.5], "Close": [1.5, 1.5, 1.5],
                       "Volume": [10, 10, float("nan")]}, index=idx)

    def fake(sym, **kw):
        seen.update(kw)
        return df
    monkeypatch.setattr("api.services.yfinance_pool.fetch_history", fake)
    out = bars_fetch._fetch_intraday_yfinance("ABC", "5", 100)
    assert seen["auto_adjust"] is False and seen["prepost"] is True
    assert len(out) == 2 and out[-1]["v"] == 0


def test_fmp_null_volume_does_not_empty_the_payload(monkeypatch):
    import io
    import json
    payload = [{"date": "2026-10-06 10:05:00", "open": 1, "high": 2, "low": 0.5, "close": 1.5,
                "volume": None},
               {"date": "2026-10-06 10:00:00", "open": 1, "high": 2, "low": 0.5, "close": 1.5,
                "volume": 7}]

    class _Resp(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False
    monkeypatch.setenv("FMP_API_KEY", "test-key")
    monkeypatch.setattr("urllib.request.urlopen",
                        lambda *a, **k: _Resp(json.dumps(payload).encode()))
    out = bars_fetch._fetch_intraday_fmp("ABC", "5", 100)
    assert [b["v"] for b in out] == [7, 0]


def _rth_payload():
    return [{"t": _et(2026, 10, 6, 10, 0) + i * 300, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 5}
            for i in range(3)]


def _ext_payload():
    return [{"t": _et(2026, 10, 6, 7, 0), "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 5}] + _rth_payload()


@pytest.fixture
def chain(monkeypatch):
    from api.services import source_circuit_breaker as scb
    monkeypatch.setattr(scb, "is_ok", lambda s: True)
    monkeypatch.setattr(scb, "record_attempt", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_payload_passes_validation", lambda p, pc: bool(p))
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_massive", lambda *a: [])
    return monkeypatch


def test_rth_only_fmp_yields_to_extended_hours_yfinance(chain):
    chain.setattr(bars_fetch, "_fetch_intraday_fmp", lambda *a: _rth_payload())
    chain.setattr(bars_fetch, "_fetch_intraday_yfinance", lambda *a: _ext_payload())
    out = bars_fetch.fetch_with_validation("ABC", "5", 100, expected_session=20261006)
    assert out == _ext_payload() and bars_fetch.last_intraday_source() == "yfinance"


def test_rth_only_fmp_is_still_used_when_nothing_else_answers(chain):
    chain.setattr(bars_fetch, "_fetch_intraday_fmp", lambda *a: _rth_payload())
    chain.setattr(bars_fetch, "_fetch_intraday_yfinance", lambda *a: [])
    out = bars_fetch.fetch_with_validation("ABC", "5", 100, expected_session=20261006)
    assert out == _rth_payload() and bars_fetch.last_intraday_source() == "fmp"


def test_massive_answer_is_tagged_massive(chain):
    chain.setattr(bars_fetch, "_fetch_intraday_massive", lambda *a: _ext_payload())
    bars_fetch.fetch_with_validation("ABC", "5", 100, expected_session=20261006)
    assert bars_fetch.last_intraday_source() == "massive"


def test_a_fallback_answer_never_marks_history_complete(monkeypatch):
    marked = []
    monkeypatch.setattr(bars_fetch.cache, "set", lambda k, v, ttl: marked.append(k))
    bars_fetch._set_intraday_source("yfinance")
    bars_fetch._mark_history_complete("ABC", "5")
    assert marked == []
    bars_fetch._mark_history_complete("ABC", "D")          # daily unaffected
    bars_fetch._set_intraday_source("massive")
    bars_fetch._mark_history_complete("ABC", "5")
    assert marked == ["histfull_ABC_D", "histfull_ABC_5"]
    bars_fetch._set_intraday_source(None)


def test_bounded_deep_fetch_from_a_fallback_is_add_only_and_not_complete(store, monkeypatch):
    bars_sqlite.put_bars("ABC", "5", [{"t": _rth_payload()[0]["t"], "o": 9, "h": 9, "l": 9,
                                       "c": 9, "v": 999}])

    def fake_fetch(tk, tf, n):
        bars_fetch._set_intraday_source("fmp")
        return _rth_payload()
    monkeypatch.setattr(bars_fetch, "_fetch_intraday", fake_fetch)
    monkeypatch.setattr(bars_fetch, "_is_intraday_stale", lambda b: False)
    cache.invalidate("histfull_ABC_5")
    assert bars_fetch._bounded_fetch_intraday("ABC", "5", 5000, deadline=5) is True
    rows = _stored("ABC", "5")
    assert len(rows) == 3
    assert [r for r in rows if r[0] == _rth_payload()[0]["t"]][0][4] == 9   # Massive row kept
    assert not bars_fetch._history_complete("ABC", "5")


# ── 4. Half-day market clock ─────────────────────────────────────────────────

@pytest.mark.parametrize("when, expected", [
    ((2026, 11, 27, 12, 59), True),     # half-day, before the 13:00 close
    ((2026, 11, 27, 13, 0), False),     # half-day close
    ((2026, 11, 27, 15, 0), False),     # used to read OPEN
    ((2026, 11, 25, 15, 0), True),      # ordinary day
    ((2026, 11, 25, 16, 0), False),
    ((2026, 11, 25, 9, 29), False),
    ((2026, 11, 25, 9, 30), True),
])
def test_is_market_open_honors_half_days(monkeypatch, when, expected):
    at = _dt.datetime(*when, tzinfo=ET)

    class _Frozen(_dt.datetime):
        @classmethod
        def now(cls, tz=None):
            return at.astimezone(tz) if tz else at.replace(tzinfo=None)
    monkeypatch.setattr(bars_fetch, "datetime", _Frozen)
    assert bars_fetch._is_market_open() is expected


# ── 5. Delta parsing: one bad bar never drops the delta ──────────────────────

class _Client:
    _api_key = "k"


def _delta_aggs():
    base = _et(2026, 10, 6, 10, 0) * 1000
    return [{"t": base + i * 900_000, "o": 1, "h": 2, "l": 0.5, "c": 1.5,
             "v": (None if i == 1 else 10)} for i in range(4)] + \
           [{"t": base + 4 * 900_000, "o": None, "h": 2, "l": 0.5, "c": 1.5, "v": 1}]


@pytest.mark.parametrize("tf", ["60", "5"])
def test_null_volume_or_price_in_a_delta_keeps_the_rest(monkeypatch, tf):
    monkeypatch.setattr(bars_fetch, "_get_client", lambda: _Client())
    monkeypatch.setattr(bars_fetch, "_paginate_massive_aggs", lambda c, u: _delta_aggs())
    status = {}
    out = bars_fetch._delta_intraday("ABC", tf, 0, status=status)
    assert status.get("ok") is True
    assert out, "the whole delta was dropped"
    assert sum(b["v"] for b in out) == 30


def test_safe_volume():
    assert [bars_fetch._safe_volume(v) for v in (None, float("nan"), "x", -3, 12.0, 7)] == \
        [0, 0, 0, 0, 12, 7]


# ── 6. Gap-fill reach + RTH gap audit ────────────────────────────────────────

def test_gapfill_reaches_the_prior_session_on_a_monday(monkeypatch):
    """1m's 2-day cap from a Monday morning reached Saturday — Friday's holes froze."""
    at = _dt.datetime(2026, 10, 12, 10, 0, tzinfo=ET)      # Monday

    class _Frozen(_dt.datetime):
        @classmethod
        def now(cls, tz=None):
            return at.astimezone(tz) if tz else at.replace(tzinfo=None)

        @classmethod
        def utcnow(cls):
            return at.astimezone(_dt.timezone.utc).replace(tzinfo=None)
    monkeypatch.setattr(bars_fetch, "datetime", _Frozen)
    monkeypatch.setattr(bars_fetch._time, "time", lambda: at.timestamp())
    monkeypatch.setattr(bars_fetch, "_get_client", lambda: _Client())
    monkeypatch.setattr(bars_fetch._sqlite, "get_bars_since", lambda *a: [])
    urls = []
    monkeypatch.setattr(bars_fetch, "_paginate_massive_aggs", lambda c, u: urls.append(u) or [])
    bars_fetch._delta_intraday("ABC", "1", int(at.timestamp()) - 600)
    from_date = urls[0].split("/minute/")[1].split("/")[0]
    assert from_date <= "2026-10-09", from_date


def test_prior_session_skips_weekends_and_holidays():
    assert bars_fetch._prior_session_iso(_dt.datetime(2026, 10, 12, 9, tzinfo=ET)) == "2026-10-09"
    assert bars_fetch._prior_session_iso(_dt.datetime(2026, 11, 27, 9, tzinfo=ET)) == "2026-11-25"


def test_expected_buckets_honor_half_days_and_the_60m_bucketer():
    full = gap.expected_rth_buckets("30", _dt.date(2026, 11, 25))
    half = gap.expected_rth_buckets("30", _dt.date(2026, 11, 27))
    assert len(full) == 13 and len(half) == 7
    assert half[-1] == _et(2026, 11, 27, 12, 30)
    assert gap.expected_rth_buckets("5", _dt.date(2026, 11, 26)) == []   # Thanksgiving
    h60 = gap.expected_rth_buckets("60", _dt.date(2026, 11, 25))
    assert h60 == sorted({bars_fetch.bucket_60_et_unix_seconds(t)
                          for t in range(_et(2026, 11, 25, 9, 30), _et(2026, 11, 25, 16, 0), 60)})
    # buckets that have not closed yet today are not expected
    now = _et(2026, 11, 25, 10, 45)
    assert gap.expected_rth_buckets("30", _dt.date(2026, 11, 25), now) == \
        [_et(2026, 11, 25, 9, 30), _et(2026, 11, 25, 10, 0)]


def _rth(day, tf_min=30):
    y, m, d = day
    return [{"t": t, "o": 1.0, "h": 2.0, "l": 0.5, "c": 1.5, "v": 10}
            for t in range(_et(y, m, d, 9, 30), _et(y, m, d, 16, 0), tf_min * 60)]


def test_gap_audit_scans_today_and_yesterday_and_heals_missing_only(store):
    now = _et(2026, 10, 12, 12, 1)                          # Monday midday
    fri, mon = _rth((2026, 10, 9)), _rth((2026, 10, 12))
    have = [b for b in fri if b["t"] != _et(2026, 10, 9, 14, 0)] + \
           [b for b in mon if b["t"] < _et(2026, 10, 12, 12, 0) and b["t"] != _et(2026, 10, 12, 10, 30)]
    bars_sqlite.put_bars("GAP", "30", have)
    scan = gap.scan_rth_gaps("GAP", "30", sessions=2, now=now)
    assert scan["gaps"] == {"2026-10-09": [_et(2026, 10, 9, 14, 0)],
                            "2026-10-12": [_et(2026, 10, 12, 10, 30)]}
    calls = []

    def fetch(tk, tf, lo, hi):
        calls.append((lo, hi))
        rows = fri + [b for b in mon if b["t"] < _et(2026, 10, 12, 12, 0)]
        return [dict(b, c=1.9) for b in rows]               # different values: must not overwrite
    res = gap.heal_gaps("GAP", "30", scan, fetch=fetch)
    assert calls == [("2026-10-09", "2026-10-12")]          # contiguous sessions: one fetch
    assert res["filled"] == 2
    assert gap.scan_rth_gaps("GAP", "30", sessions=2, now=now)["missing"] == 0
    closes = {r[0]: r[4] for r in _stored("GAP", "30")}
    assert closes[_et(2026, 10, 9, 9, 30)] == 1.5 and closes[_et(2026, 10, 9, 14, 0)] == 1.9


def test_gap_audit_reports_depth_not_holes_before_the_first_row(store):
    now = _et(2026, 10, 12, 17, 0)
    bars_sqlite.put_bars("NEW", "30", _rth((2026, 10, 12)))
    scan = gap.scan_rth_gaps("NEW", "30", sessions=5, now=now)
    assert scan["missing"] == 0 and scan["expected"] == 13
