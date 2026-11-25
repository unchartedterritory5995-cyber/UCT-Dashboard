"""breadth_universe_extras_forward — the nightly Up Vol / HVC / >7xATR job (2026-11-23). Synthetic values only."""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta

import pytest

from api.services import breadth_universe_extras as uex
from api.services import breadth_universe_extras_engine as E
from api.services import breadth_universe_extras_forward as fwd

NIGHT = datetime(2026, 11, 23, 20, 0)          # a Monday evening
NOON = datetime(2026, 11, 23, 12, 0)


def _cal(n=300, end=date(2026, 11, 20)):
    out, d = [], end
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d -= timedelta(days=1)
    return sorted(out)


CAL = _cal()
NAMES = [f"T{i}" for i in range(40)]


def _fake_fetch(url):
    if "/v3/reference/splits" in url:
        return {"results": [], "next_url": None}
    d = url.split("/stocks/")[1][:10]
    j = CAL.index(d)
    res = []
    for i, t in enumerate(NAMES):
        c = 10 + i + (j * 0.05 if i % 2 else -j * 0.01)
        res.append({"T": t, "o": c, "h": c * 1.01, "l": c * 0.99, "c": c, "v": 1000 + j * (i + 1), "vw": c})
    return {"results": res}


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("BREADTH_UNIVERSE_EXTRAS", "1")
    monkeypatch.delenv("BREADTH_UNIVERSE_EXTRAS_FORWARD", raising=False)
    series = tmp_path / "series.json"
    series.write_text(json.dumps({"version": uex.VERSION, "rows": {"us": {CAL[-3]: {"up_vol_ratio": 1.0, "hvc_52w": 1, "atr_ext_7": 0}}}}))
    monkeypatch.setattr(uex, "SERIES_PATH", str(series))
    uex._view.clear()
    monkeypatch.setattr(fwd, "STORE_PATH", str(tmp_path / "fwd.json"))
    monkeypatch.setattr(fwd, "R2_KEY", "test/none")
    monkeypatch.setattr(fwd, "_restore_from_r2", lambda: False)
    monkeypatch.setattr(fwd, "_save", lambda rows: fwd._write_bytes(json.dumps({"version": fwd.VERSION, "rows": rows}).encode()))
    fwd._view.clear()
    fwd._attempts.clear()
    monkeypatch.setattr(E, "CACHE_DIR", str(tmp_path / "cache"))
    from api.services import breadth_dividends as bd
    monkeypatch.setattr(bd, "adjust", lambda tickers, dates, closes, as_of=None: closes)
    monkeypatch.setattr(fwd, "sessions", lambda u: CAL[-3:] if u == "us" else [])
    monkeypatch.setattr(fwd, "members", lambda u, d: NAMES if u == "us" else None)
    return tmp_path


def test_only_sessions_after_the_rebuilt_series_are_pending(env):
    assert fwd.pending() == [("us", CAL[-2]), ("us", CAL[-1])]


def test_a_night_tick_measures_and_serves_the_new_sessions(env):
    out = fwd.tick(now=NIGHT, fetch=_fake_fetch, calendar=CAL)
    assert out["written"] == [["us", CAL[-2]], ["us", CAL[-1]]] and not out["refused"]
    got = uex.values("us", CAL[-1])
    assert set(got) <= set(uex.KEYS) and "up_vol_ratio" in got
    assert uex.values("us", CAL[-3]) == {"up_vol_ratio": 1.0, "hvc_52w": 1, "atr_ext_7": 0}   # the series wins
    assert uex.token().startswith("_uex") and uex.token().count("f") >= 1
    assert fwd.pending() == []
    assert fwd.tick(now=NIGHT, fetch=_fake_fetch, calendar=CAL)["written"] == []            # idempotent


def test_the_job_waits_out_the_regular_session(env):
    assert fwd.tick(now=NOON, fetch=_fake_fetch, calendar=CAL) == {"ran": False, "reason": "regular session"}


def test_off_unless_the_extras_flag_is_on_and_the_kill_switch_stops_it(env, monkeypatch):
    monkeypatch.setenv("BREADTH_UNIVERSE_EXTRAS_FORWARD", "0")
    assert fwd.tick(now=NIGHT)["reason"] == "off" and fwd.start_job() is False
    monkeypatch.delenv("BREADTH_UNIVERSE_EXTRAS_FORWARD")
    monkeypatch.delenv("BREADTH_UNIVERSE_EXTRAS")
    assert fwd.tick(now=NIGHT)["reason"] == "off" and fwd.start_job() is False


def test_a_poorly_covered_session_is_refused_not_written(env, monkeypatch):
    monkeypatch.setattr(fwd, "members", lambda u, d: NAMES + [f"GONE{i}" for i in range(10)])
    out = fwd.tick(now=NIGHT, fetch=_fake_fetch, calendar=CAL)
    assert out["written"] == [] and all("coverage" in r[2] for r in out["refused"])
    assert uex.values("us", CAL[-1]) is None


def test_a_session_without_a_day_file_is_retried_at_most_max_attempts(env):
    def no_last_day(url):
        if CAL[-1] in url:
            return {"results": []}
        return _fake_fetch(url)
    for _ in range(fwd.MAX_ATTEMPTS + 2):
        fwd.tick(now=NIGHT, fetch=no_last_day, calendar=CAL)
    assert fwd._attempts[("us", CAL[-1])] == fwd.MAX_ATTEMPTS
    assert uex.values("us", CAL[-2]) is not None and uex.values("us", CAL[-1]) is None


def test_engine_split_adjusts_price_and_volume_before_the_execution_date():
    s = ["2026-01-02", "2026-01-05", "2026-01-06"]
    days = {d: {"X": [10, 10, 10, 10, 100, 10]} for d in s[:2]}
    days[s[2]] = {"X": [5, 5, 5, 5, 200, 5]}
    frame, tickers = E.build_frame(s, days, {"X": [(s[2], 2.0)]}, dividends=False)
    assert list(frame["closes"][0]) == [5, 5, 5] and list(frame["vols"][0]) == [200, 200, 200]
