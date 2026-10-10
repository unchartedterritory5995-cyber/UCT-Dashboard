"""The breadth row's non-price keys, produced on the server (`api/services/breadth_eod_extras.py`).

Each key reproduces the PC collector's definition. Everything runs over a synthetic bars.db;
the network sources (Cboe, yfinance, CNN) are exercised through injected answers only.
"""
from __future__ import annotations

import sqlite3
from datetime import date, timedelta

import pytest

from api.services import breadth_eod_extras as bee
from api.services import breadth_live as bl


def _weekdays(end: date, n: int) -> list:
    out, d = [], end
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d -= timedelta(days=1)
    return sorted(out)


DAYS = _weekdays(date(2026, 10, 9), 300)
LAST = DAYS[-1]


@pytest.fixture
def conn(tmp_path):
    c = sqlite3.connect(tmp_path / "bars.db")
    c.execute("CREATE TABLE ohlcv (ticker TEXT, tf TEXT, ts INTEGER, o REAL, h REAL, "
              "l REAL, c REAL, v REAL)")
    rows = []
    for j, d in enumerate(DAYS):
        ts = bl._ts_int(d)
        # FLAT: never extended, never at a high after its early peak
        rows.append(("FLAT", "D", ts, 50, 50.5, 49.5, 100.0 if j == 5 else 50.0, 1e6))
        # RUN: grinds up every day, then rips on the last session -> at ATH, extended
        px = 20 + j * 0.05 + (20 if j == len(DAYS) - 1 else 0)
        rows.append(("RUN", "D", ts, px, px + 0.1, px - 0.1, px, 1e6))
        for sym, px0 in (("SPY", 600.0), ("QQQ", 500.0), ("RSP", 180.0), ("IWM", 240.0)):
            rows.append((sym, "D", ts, px0, px0 + 1, px0 - 1, px0, 1e7))
    c.executemany("INSERT INTO ohlcv VALUES (?,?,?,?,?,?,?,?)", rows)
    c.commit()
    yield c
    c.close()


def test_index_closes_and_ratios(conn):
    out = bee.index_closes(conn, bl._ts_int(LAST))
    assert out == {"rsp_close": 180.0, "rsp_spy_ratio": 0.3, "iwm_close": 240.0,
                   "iwm_qqq_ratio": 0.48}


def test_new_ath_counts_closes_at_their_all_time_high(conn):
    assert bee.new_ath(conn, ["FLAT", "RUN", "NOPE"], bl._ts_int(LAST)) == 1
    # a session before RUN's rip: RUN still makes a fresh high (it grinds up daily)
    assert bee.new_ath(conn, ["FLAT", "RUN"], bl._ts_int(DAYS[-2])) == 1
    assert bee.new_ath(conn, ["NOPE"], bl._ts_int(LAST)) is None


def test_atr_extension_is_strictly_above_seven(conn):
    assert bee.atr_extended(conn, ["FLAT", "RUN"], bl._ts_int(LAST)) == 1
    assert bee.atr_extended(conn, ["FLAT", "RUN"], bl._ts_int(DAYS[-2])) == 0


def test_dist_day_port_matches_the_wire_rule():
    # 60 flat sessions, then a -1% day on double volume (a distribution day), then flat
    c = [100.0] * 60 + [99.0] + [99.0] * 3
    v = [1e6] * 60 + [2e6] + [1e6] * 3
    assert bee._count_dist(c, v, [x + 1 for x in c], [x - 1 for x in c]) == 1
    # the same day on BELOW-average volume is not one
    v2 = [1e6] * 60 + [0.5e6] + [1e6] * 3
    assert bee._count_dist(c, v2, [x + 1 for x in c], [x - 1 for x in c]) == 0
    # expired: the index rallied >= 5% off that close
    c3 = c[:-1] + [104.0]
    assert bee._count_dist(c3, v, [x + 1 for x in c3], [x - 1 for x in c3]) == 0
    # a stalling day: up close in the bottom quarter of its range, above-average volume
    c4 = [100.0] * 60 + [100.1] + [100.1] * 3
    h4 = [x + 1 for x in c4]
    l4 = [x - 1 for x in c4]
    h4[60], l4[60] = 104.0, 100.0
    assert bee._count_dist(c4, v, h4, l4) == 1


def test_dist_days_reads_through_the_prior_session(conn):
    out = bee.dist_days(conn, bl._ts_int(LAST))
    assert out == {"spy_dist_days": 0, "qqq_dist_days": 0}


class _Resp:
    def __init__(self, code, body):
        self.status_code, self._b = code, body

    def json(self):
        return self._b


def test_cnn_reads_the_point_dated_that_session():
    import calendar
    ms = calendar.timegm(date(2026, 10, 8).timetuple()) * 1000
    body = {"fear_and_greed": {"score": 51.04, "timestamp": "2026-10-10T00:00:00"},
            "fear_and_greed_historical": {"data": [{"x": ms, "y": 38.24}]}}
    get = lambda url, **k: _Resp(200, body)
    assert bee.cnn_fear_greed("2026-10-08", get=get) == 38.2
    assert bee.cnn_fear_greed("2026-10-10", get=get) == 51.0      # live score, same day
    assert bee.cnn_fear_greed("2026-10-07", get=get) is None      # never a neighbour
    assert bee.cnn_fear_greed("2026-10-08", get=lambda u, **k: _Resp(403, {})) is None


def test_wire_regime_answers_only_for_its_own_date(monkeypatch):
    from api.services import engine
    monkeypatch.setattr(engine, "_load_wire_data", lambda: {
        "date": "2026-10-09", "exposure": {"score": 72.5},
        "breadth": {"market_phase": "Confirmed Uptrend"}})
    assert bee.wire_regime("2026-10-09") == {"uct_exposure": 72.5}   # never market_phase
    assert bee.wire_regime("2026-10-08") == {}


def test_cboe_levels_from_the_store(monkeypatch):
    from api.services.market_indicators import cboe_store as cs
    series = {s: [{"t": (LAST - timedelta(days=13 - i)).isoformat(), "c": base + i}
                  for i in range(14)] for s, base in (("VIX", 10.0), ("VXN", 20.0),
                                                     ("VIX6M", 30.0))}
    monkeypatch.setattr(cs, "bars", lambda s: series[s])
    monkeypatch.setattr(cs, "refresh", lambda *a, **k: pytest.fail("no refresh needed"))
    out = bee.cboe_levels(LAST.isoformat())
    assert out["vix"] == 23.0 and out["vxn"] == 33.0 and out["vxmt"] == 43.0
    assert out["avg_10d_vix"] == round(sum(10.0 + i for i in range(4, 14)) / 10, 2)
    assert out["vix_term_structure"] == round(43.0 / 23.0, 3)


def test_a_missing_cboe_session_is_absent_not_carried(monkeypatch):
    from api.services.market_indicators import cboe_store as cs
    old = [{"t": "2026-10-01", "c": 15.0}]
    monkeypatch.setattr(cs, "bars", lambda s: old)
    calls = []
    monkeypatch.setattr(cs, "refresh", lambda *a, **k: calls.append(a))
    assert bee.cboe_levels("2026-10-09") == {} and len(calls) == 1


def test_one_failed_source_never_costs_the_others(conn, monkeypatch):
    bee._SESSION_CACHE.clear()
    monkeypatch.setattr(bee, "cboe_levels", lambda d: (_ for _ in ()).throw(RuntimeError("cdn")))
    monkeypatch.setattr(bee, "sp500_close", lambda d: 6123.45)
    monkeypatch.setattr(bee, "cnn_fear_greed", lambda d: None)
    monkeypatch.setattr(bee, "wire_regime", lambda d: {})
    out = bee.compute_extras(LAST.isoformat(), ["FLAT", "RUN"], conn)
    assert out["sp500_close"] == 6123.45 and out["new_ath"] == 1 and out["atr_ext_7"] == 1
    assert "vix" not in out and "cnn_fear_greed" not in out
    assert "cboe" in out["_extras_errors"]
    assert LAST.isoformat() not in bee._SESSION_CACHE      # a partial answer is not cached


def test_the_grader_tolerances_and_strings():
    assert bee.grade("vix", 17.24, 17.2)["pass"]
    assert not bee.grade("vix", 17.4, 17.2)["pass"]
    assert "market_phase" not in bee.TOLERANCE
    assert bee.grade("market_phase", "Uptrend", "uptrend ")["pass"]
    assert not bee.grade("market_phase", "Correction", "Uptrend")["pass"]
    assert bee.grade("new_ath", 30, 33)["pass"] and not bee.grade("new_ath", 20, 33)["pass"]
    assert bee.grade("vix", None, 17.2) is None
