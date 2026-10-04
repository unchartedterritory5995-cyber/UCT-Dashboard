"""2026-10-02 flow freeze: the consumer's write path must never wait long on a
metadata lookup, and flow_watchdog must not restart a writer that is alive
inside a slow batch.

What happened: the MktCap/Sector cache is filled at consumer start and every
entry expires 24h later. A flow-worker that had not restarted in ~39h reached
the open with the whole cache expired, the first batch re-fetched every symbol
synchronously (121.5s; 1-80ms on the four prior opens), the watchdog restarted
the worker, and each cold restart's first batch took ~10 minutes - longer than
the watchdog waited. ~30 restarts, no inserts for the whole session.

Run: python -m pytest tests/test_flow_meta_cold_cache_freeze.py -v
"""
import sqlite3
import time
import types

import pytest

from api import flow_watchdog as fw
from api import massive_ws_worker as mww


# --- fixtures ----------------------------------------------------------------

def _make_flow_db(path, rows):
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE flow (Symbol TEXT, MktCap TEXT, Sector TEXT)")
    conn.executemany("INSERT INTO flow (Symbol, MktCap, Sector) VALUES (?,?,?)", rows)
    conn.commit()
    conn.close()


@pytest.fixture
def flow_db(tmp_path, monkeypatch):
    path = str(tmp_path / "flow.db")
    _make_flow_db(path, [
        ("AAPL", "3100000000000", "Technology"),
        ("NVDA", "", "Technology"),
        ("NVDA", "4000000000000", ""),
        ("SPY", "", ""),            # an ETF: never carries a MktCap
    ])
    import api.flow_db as flow_db_mod
    monkeypatch.setattr(flow_db_mod, "FlowDB",
                        lambda: types.SimpleNamespace(db_path=path))
    return path


@pytest.fixture(autouse=True)
def _isolate_cache(monkeypatch):
    monkeypatch.setattr(mww, "_META_CACHE", {})
    queued = []
    monkeypatch.setattr(mww, "_queue_meta_refresh", lambda syms: queued.extend(syms))
    return queued


# --- the metadata loader -----------------------------------------------------

def test_missing_symbols_are_looked_up_and_cached(flow_db):
    out = mww._load_ticker_metadata(["AAPL", "NVDA", "SPY"])
    assert out["AAPL"] == {"mktcap": 3100000000000, "sector": "Technology"}
    assert out["NVDA"] == {"mktcap": 4000000000000, "sector": "Technology"}
    assert "SPY" not in out                      # looked up, nothing there
    assert mww._META_CACHE["SPY"][0] == {}       # ...and cached as empty


def test_an_expired_entry_is_served_and_refreshed_in_the_background(
        flow_db, monkeypatch, _isolate_cache):
    expired = time.time() - mww._META_TTL_SEC - 60
    mww._META_CACHE["AAPL"] = ({"mktcap": 1, "sector": "Old"}, expired)

    # Recorded, not raised: the loader swallows fetch errors, so a raise here
    # would be caught and the test would pass with the inline fetch happening.
    calls = []
    monkeypatch.setattr(mww, "_fetch_ticker_metadata",
                        lambda *a, **k: calls.append(a) or {})

    out = mww._load_ticker_metadata(["AAPL"])
    assert calls == [], "an expired entry must not be re-fetched inline"
    assert out["AAPL"] == {"mktcap": 1, "sector": "Old"}
    assert _isolate_cache == ["AAPL"]


def test_a_fresh_entry_is_neither_fetched_nor_queued(flow_db, monkeypatch, _isolate_cache):
    mww._META_CACHE["AAPL"] = ({"mktcap": 1}, time.time())
    monkeypatch.setattr(mww, "_fetch_ticker_metadata",
                        lambda *a, **k: pytest.fail("fresh entry fetched"))
    assert mww._load_ticker_metadata(["AAPL"]) == {"AAPL": {"mktcap": 1}}
    assert _isolate_cache == []


def test_symbols_past_the_inline_budget_go_to_the_background(
        flow_db, monkeypatch, _isolate_cache):
    monkeypatch.setattr(mww, "_META_SYNC_BUDGET_SEC", -1.0)   # already spent
    out = mww._load_ticker_metadata(["AAPL", "NVDA"])
    assert out == {}
    assert sorted(_isolate_cache) == ["AAPL", "NVDA"]
    assert "AAPL" not in mww._META_CACHE        # not looked up != looked up empty


def test_the_budget_interrupts_a_slow_query_mid_scan(tmp_path):
    """One slow query must not overrun the budget: no Symbol index and a large
    table make the lookup a full scan, and the deadline must cut it short."""
    path = str(tmp_path / "big.db")
    _make_flow_db(path, (("SPY", "", "") for _ in range(400_000)))
    control = mww._fetch_ticker_metadata(path, ["SPY"])
    assert control == {"SPY": {}}                # without a deadline it completes

    t0 = time.monotonic()
    out = mww._fetch_ticker_metadata(path, ["SPY"], deadline=time.monotonic() + 0.01)
    assert time.monotonic() - t0 < 1.0
    assert "SPY" not in out


def test_lookups_only_search_the_newest_window(tmp_path, monkeypatch):
    path = str(tmp_path / "window.db")
    _make_flow_db(path, [("OLD", "500", "Energy")] + [("X", "", "")] * 50)
    monkeypatch.setattr(mww, "_META_LOOKUP_ROWID_WINDOW", 10)
    assert mww._fetch_ticker_metadata(path, ["OLD"]) == {"OLD": {}}
    monkeypatch.setattr(mww, "_META_LOOKUP_ROWID_WINDOW", 1000)   # control
    assert mww._fetch_ticker_metadata(path, ["OLD"]) == {
        "OLD": {"mktcap": 500, "sector": "Energy"}}


# --- the watchdog ------------------------------------------------------------

class _Stop(Exception):
    pass


class _Exited(BaseException):
    """Stands in for os._exit, which nothing can catch - the watchdog's own
    `except Exception` must not swallow it either."""


def _drive_watchdog(monkeypatch, *, batch_started_offset, iterations=40):
    """Run fw._run on a fake clock with a tape that never advances.

    batch_started_offset: None for no batch in progress, else seconds before
    the watchdog started that the current write batch began."""
    clock = {"t": 1_000_000.0, "sleeps": 0}

    def _sleep(secs):
        clock["sleeps"] += 1
        if clock["sleeps"] > iterations:
            raise _Stop()
        clock["t"] += secs

    fake_time = types.SimpleNamespace(time=lambda: clock["t"], sleep=_sleep)
    monkeypatch.setattr(fw, "time", fake_time)
    monkeypatch.setattr(fw, "MIN_UPTIME_SEC", 0.0)
    monkeypatch.setattr(fw, "_in_watch_window", lambda now: True)
    monkeypatch.setattr(fw, "_newest_row", lambda: (100, "TODAY"))
    monkeypatch.setattr(fw, "_today_mdyyyy", lambda now: "TODAY")
    monkeypatch.setitem(fw._live_hb, "ts", 0.0)
    alerts = []
    monkeypatch.setattr(fw, "_alert_discord", alerts.append)

    def _exit(code):
        raise _Exited(code)
    monkeypatch.setattr(fw.os, "_exit", _exit)

    started = None if batch_started_offset is None else clock["t"] - batch_started_offset
    monkeypatch.setitem(mww._state, "write_started_ts", started)
    monkeypatch.setitem(mww._state, "last_trade_ts", None)
    monkeypatch.setitem(mww._state, "last_write_ts", None)

    exited = False
    try:
        fw._run("flow-worker")
    except _Exited:
        exited = True
    except _Stop:
        pass
    return exited, alerts


def test_a_frozen_tape_with_no_batch_running_still_force_exits(monkeypatch):
    exited, alerts = _drive_watchdog(monkeypatch, batch_started_offset=None)
    assert exited
    assert any("tape FROZEN" in a for a in alerts)


def test_a_slow_batch_in_progress_alerts_once_and_never_exits(monkeypatch):
    exited, alerts = _drive_watchdog(monkeypatch, batch_started_offset=0, iterations=40)
    assert not exited                              # 40 x 30s = 20 min, under the cap
    batch_alerts = [a for a in alerts if "write batch has been running" in a]
    assert len(batch_alerts) == 1
    assert not any("tape FROZEN" in a for a in alerts)


def test_a_batch_older_than_the_cap_is_treated_as_wedged(monkeypatch):
    exited, _ = _drive_watchdog(
        monkeypatch, batch_started_offset=fw.MAX_BATCH_SEC + 60)
    assert exited


def test_write_events_clears_the_in_progress_marker_even_on_failure(monkeypatch):
    import api.flow_db as flow_db_mod

    def _boom():
        raise RuntimeError("db unavailable")
    monkeypatch.setattr(flow_db_mod, "FlowDB", _boom)
    monkeypatch.setattr(mww, "DRY_RUN", False)
    evt = types.SimpleNamespace(root="AAPL")
    monkeypatch.setitem(mww._state, "write_started_ts", None)
    mww._write_events([evt])
    assert mww._state["write_started_ts"] is None
