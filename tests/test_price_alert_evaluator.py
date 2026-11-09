"""Task 7 (desktop Stage 1): a scheduled server evaluator for armed price alerts.

Before this, alerts were evaluated only inside /api/live-prices for the symbols in
that request, so an alert on a symbol nobody polled never fired.
"""
import pytest

from api.services import auth_db
from api.services import price_alert_evaluator as ev
from api.services import watchlist_alert_service as wls

FLAG = "PRICE_ALERT_EVALUATOR_ENABLED"


@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    db_path = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(db_path))
    monkeypatch.setattr(auth_db, "_DB_PATH", str(db_path))
    auth_db.init_db()
    conn = auth_db.get_connection()
    conn.execute("INSERT INTO users (id, email, password_hash) VALUES (?,?,?)",
                 ("u1", "u1@local.test", "x"))
    conn.commit()
    conn.close()
    monkeypatch.setenv(FLAG, "1")
    ev._reset_for_tests()
    return db_path


@pytest.fixture
def delivered(monkeypatch):
    calls = []

    def fake(alert, price, **kw):
        calls.append(alert["id"])
        return {"claimed": True, "channels": {}, "channels_ok": 1,
                "channels_failed": 0, "errors": {}}
    monkeypatch.setattr(wls, "_deliver_alert", fake)
    return calls


def _row(price, **extra):
    return {"price": price, **extra}


def test_armed_alert_on_unrequested_symbol_fires_exactly_once_in_two_cycles(tmp_db, delivered):
    a = wls.create_alert("u1", "ZZZQ", 100.0, "above")
    fetch = lambda syms: {"ZZZQ": _row(101.0)}
    r1 = ev.run_cycle(fetch, 1000.0)
    r2 = ev.run_cycle(fetch, 1060.0)
    assert delivered == [a["id"]]
    assert r1["triggered"] == 1 and r2["triggered"] == 0


def test_request_path_and_evaluator_racing_fire_once(tmp_db, delivered, monkeypatch):
    """Both checkers read the row as armed before either deactivates it."""
    a = wls.create_alert("u1", "ZZZQ", 100.0, "above")
    real_level = wls._alert_level_now
    state = {"inner": False}

    def level_then_race(alert, now_sec):
        if not state["inner"]:
            state["inner"] = True
            # the OTHER path (the /api/live-prices request) runs to completion
            # while this checker is between its SELECT and its UPDATE
            wls.check_alerts_against_prices({"ZZZQ": 101.0})
        return real_level(alert, now_sec)

    monkeypatch.setattr(wls, "_alert_level_now", level_then_race)
    got = ev.run_cycle(lambda syms: {"ZZZQ": _row(101.0)}, 1000.0)
    assert delivered == [a["id"]], "the same alert was delivered twice"
    assert got["triggered"] == 0  # the request path won the compare-and-set


def test_market_closed_rows_do_not_evaluate(tmp_db, delivered):
    wls.create_alert("u1", "ZZZQ", 100.0, "above")
    r = ev.run_cycle(lambda s: {"ZZZQ": _row(150.0, market_closed=True)}, 1000.0)
    assert delivered == [] and r["triggered"] == 0
    # still armed: a later live row fires it
    r = ev.run_cycle(lambda s: {"ZZZQ": _row(150.0)}, 1060.0)
    assert len(delivered) == 1


def test_fetch_failure_logs_fires_nothing_and_next_cycle_runs(tmp_db, delivered, caplog):
    wls.create_alert("u1", "ZZZQ", 100.0, "above")

    def boom(syms):
        raise RuntimeError("vendor down")
    r = ev.run_cycle(boom, 1000.0)
    assert delivered == [] and r["error"]
    assert any("vendor down" in m for m in caplog.messages)
    r = ev.run_cycle(lambda s: {"ZZZQ": _row(101.0)}, 1060.0)
    assert len(delivered) == 1 and r["triggered"] == 1


def test_kill_switch_stops_the_next_cycle(tmp_db, delivered, monkeypatch):
    wls.create_alert("u1", "ZZZQ", 100.0, "above")
    calls = []

    def fetch(syms):
        calls.append(list(syms))
        return {"ZZZQ": _row(99.0)}
    assert ev.run_cycle(fetch, 1.0)["skipped"] is None
    monkeypatch.setenv(FLAG, "0")
    assert ev.run_cycle(fetch, 2.0)["skipped"] == "disabled"
    monkeypatch.delenv(FLAG)
    assert ev.run_cycle(fetch, 3.0)["skipped"] == "disabled"
    assert len(calls) == 1


def test_nothing_armed_means_no_fetch(tmp_db):
    def fetch(syms):
        raise AssertionError("must not fetch with no armed alerts")
    r = ev.run_cycle(fetch, 1.0)
    assert r["symbols"] == 0 and r["skipped"] == "no_armed_alerts"


def test_batches_caps_and_rotates(tmp_db, delivered, monkeypatch):
    monkeypatch.setattr(ev, "BATCH_SIZE", 3)
    monkeypatch.setattr(ev, "MAX_SYMBOLS_PER_CYCLE", 6)
    syms = [f"S{i:02d}" for i in range(10)]
    for s in syms:
        wls.create_alert("u1", s, 1000.0, "above")   # armed, never crossing
    seen = []

    def fetch(batch):
        assert len(batch) <= 3
        seen.append(list(batch))
        return {}
    r1 = ev.run_cycle(fetch, 1.0)
    assert r1["symbols"] == 6 and [len(b) for b in seen] == [3, 3]
    first = {s for b in seen for s in b}
    seen.clear()
    ev.run_cycle(fetch, 2.0)
    second = {s for b in seen for s in b}
    assert first | second == set(syms), "the cap must rotate, not starve the tail"


def test_cycle_has_a_bounded_runtime(tmp_db, delivered, monkeypatch):
    monkeypatch.setattr(ev, "BATCH_SIZE", 1)
    monkeypatch.setattr(ev, "MAX_CYCLE_SEC", 10.0)
    for s in ("AAA", "BBB", "CCC", "DDD"):
        wls.create_alert("u1", s, 1000.0, "above")
    clock = {"t": 0.0}
    monkeypatch.setattr(ev, "_monotonic", lambda: clock["t"])
    calls = []

    def slow(batch):
        calls.append(batch)
        clock["t"] += 6.0
        return {}
    r = ev.run_cycle(slow, 1.0)
    assert len(calls) == 2 and r["deadline_hit"] is True


def test_overlapping_cycle_is_skipped_not_stacked(tmp_db):
    wls.create_alert("u1", "ZZZQ", 100.0, "above")
    inner = {}

    def fetch(syms):
        inner["r"] = ev.run_cycle(lambda s: {}, 2.0)   # re-entered while running
        return {}
    ev.run_cycle(fetch, 1.0)
    assert inner["r"]["skipped"] == "cycle_in_progress"


def test_tick_never_raises(tmp_db, monkeypatch):
    monkeypatch.setattr(ev, "run_cycle", lambda *a, **k: (_ for _ in ()).throw(ValueError("x")))
    ev._tick()  # must swallow


def test_start_is_idempotent_and_stoppable(tmp_db, monkeypatch):
    monkeypatch.setattr(ev, "_tick", lambda: None)
    ev.start_evaluator(interval_sec=1)
    t = ev._thread
    ev.start_evaluator(interval_sec=1)
    assert ev._thread is t and ev.is_running()
    ev.stop_evaluator()
    t.join(timeout=5)
    assert not t.is_alive()
