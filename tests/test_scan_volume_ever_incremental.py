"""Rail: the all-time volume reference is remembered and folded forward, and always equals what
the old full query returns (2026-11-12). The full query read every daily row (185 s on a 3.3 GB
local store) every ET day and after every deploy."""
import json
import sqlite3
from datetime import date, timedelta

import pytest

from api.services import bars_sqlite as bs
from api.services import scan_volume as sv


def _ymd(d):
    return int(d.strftime("%Y%m%d"))


@pytest.fixture
def env(tmp_path, monkeypatch):
    c = sqlite3.connect(":memory:")
    c.execute(bs.ohlcv_ddl())
    monkeypatch.setattr(bs, "_conn", lambda: c)
    monkeypatch.setattr(sv, "_EVER_PATH", str(tmp_path / "ever.json"))
    calls = []
    real = bs.daily_volume_stats_in_range

    def spy(a, b):
        calls.append((a, b))
        return real(a, b)

    monkeypatch.setattr(bs, "daily_volume_stats_in_range", spy)
    return c, calls, tmp_path / "ever.json"


def _put(c, t, d, v):
    c.execute("INSERT OR REPLACE INTO ohlcv VALUES (?,?,?,?,?,?,?,?)", (t, "D", _ymd(d), 1, 1, 1, 1, v))


def _old(c, to_ymd):
    rows = c.execute("SELECT ticker, MAX(v) AS mv, COUNT(*) AS n FROM ohlcv WHERE tf='D' AND ts>=0 AND ts<? "
                     "GROUP BY ticker HAVING n>=2 AND mv>0", (to_ymd,)).fetchall()
    return {r[0]: int(r[1]) for r in rows}


D0 = date(2026, 10, 1)


def _seed(c):
    for i in range(40):
        _put(c, "AAA", D0 + timedelta(days=i), 100 + i)
        _put(c, "BBB", D0 + timedelta(days=i), 5000 - i)
        c.execute("INSERT INTO ohlcv VALUES ('AAA','5',?,1,1,1,1,999999)", (1790000000 + i,))  # intraday ignored
    _put(c, "ONE", D0, 7)                       # one session only: excluded
    _put(c, "SPLIT", D0 + timedelta(days=20), 300)   # one session in the remembered part ...


def test_first_build_equals_full_query(env):
    c, calls, _ = env
    _seed(c)
    to = _ymd(D0 + timedelta(days=40))
    assert sv._ever_reference(to) == _old(c, to)
    assert calls[0][0] == 0


def test_later_days_fold_forward_without_a_full_read(env):
    c, calls, _ = env
    _seed(c)
    sv._ever_reference(_ymd(D0 + timedelta(days=40)))
    _put(c, "AAA", D0 + timedelta(days=40), 10**9)          # a new all-time high
    _put(c, "SPLIT", D0 + timedelta(days=41), 1)            # ... and its second session arrives
    calls.clear()
    to = _ymd(D0 + timedelta(days=42))
    got = sv._ever_reference(to)
    assert got == _old(c, to)
    assert got["AAA"] == 10**9 and got["SPLIT"] == 300
    assert all(a != 0 for a, _ in calls)                     # never the whole history again


def test_a_correction_inside_the_tail_is_never_frozen_in(env):
    c, _, _ = env
    _seed(c)
    to = _ymd(D0 + timedelta(days=40))
    sv._ever_reference(to)
    _put(c, "BBB", D0 + timedelta(days=38), 9_000_000)      # late upward correction
    assert sv._ever_reference(to) == _old(c, to)
    _put(c, "BBB", D0 + timedelta(days=38), 1)              # and back down: still exact
    assert sv._ever_reference(to) == _old(c, to)


def test_weekly_full_rebuild_and_bad_file(env):
    c, calls, path = env
    _seed(c)
    sv._ever_reference(_ymd(D0 + timedelta(days=40)))
    calls.clear()
    sv._ever_reference(_ymd(D0 + timedelta(days=40 + sv._EVER_FULL_EVERY_DAYS)))
    assert calls[0][0] == 0
    path.write_text("{not json")
    calls.clear()
    to = _ymd(D0 + timedelta(days=48))
    assert sv._ever_reference(to) == _old(c, to)
    assert calls[0][0] == 0
    assert json.loads(path.read_text())["full_ymd"] == to


def test_clock_going_backwards_rebuilds(env):
    c, calls, _ = env
    _seed(c)
    sv._ever_reference(_ymd(D0 + timedelta(days=40)))
    calls.clear()
    to = _ymd(D0 + timedelta(days=30))
    assert sv._ever_reference(to) == _old(c, to)
    assert calls[0][0] == 0


def test_build_reference_routes_all_time_to_the_remembered_map(env, monkeypatch):
    c, _, _ = env
    _seed(c)
    seen = []
    monkeypatch.setattr(sv, "_ever_reference", lambda to: seen.append(to) or {"X": 1})
    assert sv._build_reference(None) == {"X": 1} and seen
