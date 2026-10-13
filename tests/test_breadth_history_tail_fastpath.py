"""Small-limit history fast path (2026-10-13): `universe_history(limit<=60)` must return EXACTLY
the rows the full read returns for the same limit — exchange (NYSE/Nasdaq) and US V2. Synthetic
same-schema stores; values are synthetic."""
from __future__ import annotations

import sqlite3
from datetime import date, timedelta

import pytest

from api.services import breadth_authority as ba
from api.services import breadth_exchange_authority as ea

SCHEMA = ("CREATE TABLE breadth_daily_ohlc (universe TEXT, date TEXT, metric TEXT, o REAL, h REAL, "
          "l REAL, c REAL, source TEXT, PRIMARY KEY (universe, date, metric))")
METRICS = ["pct_above_50sma", "pct_above_200sma", "advancing", "new_52w_highs"]


def _days(start, end):
    d, out = date.fromisoformat(start), []
    while d <= date.fromisoformat(end):
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def _db(path, universes, days, skip=None):
    c = sqlite3.connect(path)
    c.execute(SCHEMA)
    for u in universes:
        for i, d in enumerate(days):
            for j, m in enumerate(METRICS):
                if skip and skip(u, d, m):
                    continue
                v = float(i * 10 + j)
                c.execute("INSERT INTO breadth_daily_ohlc VALUES (?,?,?,?,?,?,?,?)",
                          (u, d, m, v, v + 1, v - 1, v + 0.5, "v1"))
    c.commit()
    c.close()


@pytest.fixture
def exch(tmp_path, monkeypatch):
    hist, live = str(tmp_path / "hist.db"), str(tmp_path / "live.db")
    # historical straddles START for nasdaq/nyse; live begins after FROZEN_END
    _db(hist, ["nyse", "nasdaq"], _days("2007-12-10", ea.FROZEN_END),
        skip=lambda u, d, m: m == "new_52w_highs" and d.endswith("-15"))
    _db(live, ["nyse", "nasdaq"], _days("2026-09-25", "2026-10-09"))
    monkeypatch.setattr(ea, "_view", lambda: {"pointer_sha256": "t", "paths": {
        "historical": hist, "live": live, "derived": hist}})
    monkeypatch.setattr(ea, "mode", lambda: "v1")
    ea._MEMO.clear()
    return hist, live


@pytest.mark.parametrize("u", ["nyse", "nasdaq"])
@pytest.mark.parametrize("m", METRICS + ["no_such_metric"])
@pytest.mark.parametrize("limit", [1, 5, 11, 12, 15, 30, 60])
def test_exchange_fast_path_equals_the_full_read(exch, u, m, limit):
    fast = ea.universe_history(m, u, limit, with_source=True)
    full_rows = ea._rows(u, m)
    keep = sorted(full_rows)[-limit:]
    full = {d: {"o": full_rows[d][0], "h": full_rows[d][1], "l": full_rows[d][2],
                "c": full_rows[d][3], "src": full_rows[d][4]} for d in keep}
    assert fast == full


def test_exchange_fast_path_spans_the_frozen_live_seam_and_memoises_nothing(exch):
    ea._MEMO.clear()
    out = ea.universe_history("advancing", "nasdaq", 15)
    ds = sorted(out)
    assert len(ds) == 15 and ds[0] <= ea.FROZEN_END < ds[-1]           # 11 live + 4 frozen
    assert not ea._MEMO                                                 # no full-load memo churn


def test_exchange_large_limit_still_uses_the_full_read(exch):
    assert len(ea.universe_history("advancing", "nyse", 6000)) == len(ea._rows("nyse", "advancing"))


def test_exchange_start_boundary_is_respected(exch):
    """nasdaq history before START (2008-01-02) is never served, on either path."""
    full = ea._rows("nasdaq", "advancing")
    assert min(full) >= ea.START["nasdaq"]


@pytest.fixture
def us(tmp_path, monkeypatch):
    frozen = str(tmp_path / "frozen.db")
    _db(frozen, ["us", "uct"], _days("2026-03-23", ba.FROZEN_END))
    live = {d: {m: (1.0, 2.0, 0.5, 1.5, "v2live") for m in METRICS} for d in _days("2026-09-25", "2026-10-09")}
    monkeypatch.setattr(ba, "frozen_path", lambda: frozen)
    monkeypatch.setattr(ba, "_load_frozen", lambda: {"ok": True})
    monkeypatch.setattr(ba, "serves", lambda u: u == "us")
    monkeypatch.setattr(ba, "_live_universe", lambda u: live)
    monkeypatch.setattr(ba, "US_WITHHELD", ())
    monkeypatch.setattr(ba, "V2_METRICS", set(METRICS))
    ba._US_MEMO.clear()


@pytest.mark.parametrize("m", METRICS)
@pytest.mark.parametrize("limit", [1, 11, 12, 15, 60])
def test_us_fast_path_equals_the_full_read(us, monkeypatch, m, limit):
    fast = ba.universe_history(m, "us", limit, with_source=True)
    monkeypatch.setattr(ba, "TAIL_FAST_MAX", 0)                         # force the full path
    full = ba.universe_history(m, "us", limit, with_source=True)
    assert fast == full and len(fast) == limit


def test_us_large_limit_unchanged(us):
    assert len(ba.universe_history("advancing", "us", 6000)) == len(
        _days("2026-03-23", "2026-10-09"))
