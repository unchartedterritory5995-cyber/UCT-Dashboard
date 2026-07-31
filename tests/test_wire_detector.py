"""The detector tick — the wire's only network-touching module.

It runs on a scheduler every ~20s inside the print windows, so the two things
that matter most are that it NEVER raises into the scheduler and that an
unchanged tick writes nothing.
"""
import importlib
from unittest import mock

import pytest


@pytest.fixture
def mod(tmp_path, monkeypatch):
    monkeypatch.setenv("WIRE_DB_PATH", str(tmp_path / "wire.db"))
    import api.services.wire.store as s
    importlib.reload(s)
    s._init_db()
    import api.services.wire.detector as d
    importlib.reload(d)
    return d, s


def _snap(last, prev, vol=10**6):
    return {"last_price": last, "prev_close": prev,
            "today_vol": vol, "prev_vol": 10**6}


def _rep(sym="NVDA", **kw):
    base = dict(sym=sym, timing="amc", eps_est=1.11, rev_est=49.8e9,
                eps_act=None, rev_act=None)
    base.update(kw)
    return base


def test_a_tick_writes_a_mover_and_is_idempotent(mod):
    detector, store = mod
    with mock.patch.object(detector, "todays_reporters", return_value=[_rep()]), \
         mock.patch.object(detector, "_market_snapshot",
                           return_value={"NVDA": _snap(106.4, 100.0)}):
        first = detector.run_wire_tick(now_ts=1000.0)
        second = detector.run_wire_tick(now_ts=2000.0)

    assert first["written"] == 1
    assert second["written"] == 0, "an unchanged tick rewrote the row"
    rows = store.get_prints(first["market_date"])
    assert len(rows) == 1
    assert rows[0]["first_seen_at"] == 1000.0


def test_a_provider_failure_never_raises_into_the_scheduler(mod):
    detector, _ = mod
    with mock.patch.object(detector, "todays_reporters",
                           side_effect=RuntimeError("finnhub down")):
        result = detector.run_wire_tick(now_ts=1000.0)
    assert result["written"] == 0
    assert result.get("error")


def test_a_snapshot_failure_still_lets_actuals_through(mod):
    """Degrade to what we have — never blank."""
    detector, store = mod
    rep = _rep("AMD", eps_act=0.98, rev_act=7.1e9)
    with mock.patch.object(detector, "todays_reporters", return_value=[rep]), \
         mock.patch.object(detector, "_market_snapshot",
                           side_effect=RuntimeError("massive down")):
        result = detector.run_wire_tick(now_ts=1000.0)
    assert result["written"] == 1
    assert store.get_print(result["market_date"], "AMD")["confirmed"] == 1


def test_no_reporters_is_a_quiet_no_op(mod):
    """A holiday or a Friday evening — correct, not an error."""
    detector, _ = mod
    with mock.patch.object(detector, "todays_reporters", return_value=[]):
        result = detector.run_wire_tick(now_ts=1000.0)
    assert result["scanned"] == 0
    assert result["written"] == 0
    assert "error" not in result


def test_an_upgrade_preserves_arrival_order_across_ticks(mod):
    """The row appears on price, then the numbers land two ticks later."""
    detector, store = mod
    with mock.patch.object(detector, "todays_reporters", return_value=[_rep()]), \
         mock.patch.object(detector, "_market_snapshot",
                           return_value={"NVDA": _snap(106.4, 100.0)}):
        r1 = detector.run_wire_tick(now_ts=1000.0)

    printed = _rep(eps_act=1.24, rev_act=51.2e9)
    with mock.patch.object(detector, "todays_reporters", return_value=[printed]), \
         mock.patch.object(detector, "_market_snapshot",
                           return_value={"NVDA": _snap(106.4, 100.0)}):
        detector.run_wire_tick(now_ts=5000.0)

    row = store.get_print(r1["market_date"], "NVDA")
    assert row["first_seen_at"] == 1000.0, "the upgrade moved the row"
    assert row["eps_act"] == 1.24
    assert row["confirmed"] == 1
    assert row["trigger"] == "price", "the original trigger was overwritten"
