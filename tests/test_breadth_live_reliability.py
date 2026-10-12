"""US / NYSE / Nasdaq live-breadth reliability — the 2026-10-12 incident (13:41→14:31 ET the live
payload went unrefreshed: its kick rode the UCT sampler's minute job, which sat ~25 min in the UCT
chart rebuild). Synthetic values only."""
from __future__ import annotations

import pathlib
import threading
import time
from datetime import datetime

import pytest

from api.services import breadth_alerts
from api.services import breadth_current as bc
from api.services import breadth_live_universes as blu

ET = bc._ET
ROOT = pathlib.Path(__file__).resolve().parents[1]


@pytest.fixture(autouse=True)
def _clean_refresh_state():
    blu._refreshing.clear()
    blu._inflight.clear()
    saved = dict(blu._payload)
    yield
    t = blu._inflight.get("thread")
    if t is not None:
        t.join(timeout=5)
    blu._refreshing.clear()
    blu._inflight.clear()
    blu._payload.clear()
    blu._payload.update(saved)


# ── 1. independent refresh scheduling ────────────────────────────────────────

def test_the_live_universes_kick_has_its_own_scheduler_job():
    src = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
    sampler = src[src.index("def _breadth_live_sample"):src.index('id="breadth_live_intraday_sample"')]
    assert "breadth_live_universes" not in sampler          # no longer behind the UCT sample
    assert 'id="breadth_live_universes_tick"' in src and "_blu.tick()" in src
    job = src[src.index("def _breadth_live_universes_tick"):src.index('id="breadth_live_universes_tick"') + 120]
    assert "max_instances=1" in job and "coalesce=True" in job


def test_a_blocked_uct_sample_cannot_block_the_universes_refresh(monkeypatch):
    """Hold the UCT live path's flight lock (what a stuck UCT sample holds) and tick."""
    from api.services import breadth_live as bl
    done = threading.Event()

    def compute(force=False):
        done.set()
        return {"ok": True, "as_of": "x", "universes": {"us": {"ok": True, "rows": []}}}
    monkeypatch.setattr(blu, "serving", lambda: True)
    monkeypatch.setattr(blu, "compute", compute)
    monkeypatch.setattr(blu, "_save_last_good", lambda p: None)
    monkeypatch.setattr(blu, "_record_intraday", lambda p: None)
    monkeypatch.setattr(blu, "check_health", lambda now=None, post=None: {"checked": False})
    blu._payload.clear()
    with bl._live_flight:                                  # the UCT sample is "stuck"
        blu.tick()
        assert done.wait(5), "the universes refresh never ran while the UCT path was blocked"
    blu._inflight["thread"].join(5)
    assert blu._payload["value"]["ok"]


def test_overlapping_kicks_run_one_refresh(monkeypatch):
    gate, calls = threading.Event(), []

    def refresh(force=False):
        calls.append(1)
        gate.wait(5)
    monkeypatch.setattr(blu, "refresh", refresh)
    assert blu._kick() is True
    assert blu._kick() is False and blu._kick() is False     # in flight: no second compute
    assert blu.inflight_seconds() is not None
    gate.set()
    blu._inflight["thread"].join(5)
    assert calls == [1] and not blu._refreshing.is_set() and blu.inflight_seconds() is None


def test_a_thread_that_fails_to_start_never_wedges_the_flag(monkeypatch):
    monkeypatch.setattr(blu, "refresh", lambda force=False: None)
    real_start = threading.Thread.start

    def boom(self):
        raise RuntimeError("can't start new thread")
    monkeypatch.setattr(threading.Thread, "start", boom)
    assert blu._kick() is False and not blu._refreshing.is_set()
    monkeypatch.setattr(threading.Thread, "start", real_start)
    assert blu._kick() is True                                # the next kick works


def test_a_flag_left_set_by_a_dead_thread_is_recovered(monkeypatch):
    monkeypatch.setattr(blu, "refresh", lambda force=False: None)
    dead = threading.Thread(target=lambda: None)
    dead.start(); dead.join()
    blu._refreshing.set()                                     # e.g. an exit that skipped `finally`
    blu._inflight.update(thread=dead, since=time.time() - 3600)
    assert blu._kick() is True


# ── 2. bounded split lookup ──────────────────────────────────────────────────

def test_the_split_lookup_passes_an_explicit_bound(monkeypatch):
    from api.services import breadth_nhnl_intraday as nhi
    from api.services import massive_adapter
    seen = {}

    class R:
        value = []

    def get_pages(path, **kw):
        seen.update(kw)
        return R()
    monkeypatch.setattr(massive_adapter, "get_pages", get_pages)
    nhi._split_rows("2026-10-12", "2026-10-12")
    assert seen["timeout"] == nhi.SPLITS_TIMEOUT_S == 10.0


def test_why_the_bound_must_be_explicit():
    """httpx (pinned 0.28.1) reads an explicit timeout=None as NO timeout at all."""
    import httpx
    c = httpx.Client(timeout=httpx.Timeout(connect=3.0, read=25.0, write=5.0, pool=10.0))
    assert set(c.build_request("GET", "https://x.invalid/", timeout=None)
               .extensions["timeout"].values()) == {None}
    assert c.build_request("GET", "https://x.invalid/", timeout=10.0).extensions["timeout"]["read"] == 10.0


def test_a_stalled_split_lookup_is_cut_off_and_retried_later_never_cached_as_none(monkeypatch):
    from api.services import breadth_nhnl_intraday as nhi
    from api.services import massive_adapter

    class Timeout(Exception):
        pass

    def stalled(path, **kw):
        raise Timeout(f"read timed out after {kw.get('timeout')}s")
    monkeypatch.setattr(massive_adapter, "get_pages", stalled)
    nhi._LIVE_SPLITS.clear()
    assert nhi.todays_splits("2026-10-12") == {}
    got, ok, at = nhi._LIVE_SPLITS["2026-10-12"]
    assert ok is False                                        # a failure, retried in 30 min


def test_a_real_stalled_socket_returns_within_the_bound():
    """End to end at the transport: a server that accepts and never answers."""
    import socket
    import httpx
    srv = socket.socket(); srv.bind(("127.0.0.1", 0)); srv.listen(1)
    port = srv.getsockname()[1]
    t0 = time.time()
    with pytest.raises(httpx.TimeoutException):
        httpx.get(f"http://127.0.0.1:{port}/", timeout=0.5)
    assert time.time() - t0 < 5
    srv.close()


# ── 3. chart freshness (shared with the Agent rule) ──────────────────────────

BODY = [{"t": "2026-10-07", "o": 1, "h": 1, "l": 1, "c": 1.0, "v": 0},
        {"t": "2026-10-08", "o": 1, "h": 1, "l": 1, "c": 1.0, "v": 0}]


def _p(data_as_of="2026-10-12T14:00:12-04:00", carried=False, today=True):
    rows = [{"date": "2026-10-09", "final": True, "metrics": {"pct_above_50sma": 2.0}}]
    if today:
        rows.append({"date": "2026-10-12", "final": False, "metrics": {"pct_above_50sma": 3.0}})
    p = {"ok": True, "as_of": "2026-10-12T14:00:20-04:00", "data_as_of": data_as_of,
         "universes": {"us": {"ok": True, "population_drift": 0.01, "rows": rows}}}
    if carried:
        p.update(carried=True, carried_reason="boot grace")
    return p


def _append(monkeypatch, p, now):
    monkeypatch.setattr(blu, "serving", lambda: True)
    monkeypatch.setattr(blu, "payload", lambda cached_only=True: p)
    monkeypatch.setattr(blu, "_intraday_path", lambda *a: None)
    st = {}
    out = blu.append_library_bars(list(BODY), "us", "pct_above_50sma", state_out=st, now=now)
    return out, st


def test_a_fresh_live_bar_is_drawn(monkeypatch):
    out, st = _append(monkeypatch, _p(), datetime(2026, 10, 12, 14, 0, 30, tzinfo=ET))
    assert [b["t"] for b in out] == ["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-12"]
    assert st["live"] == "drawn" and st["status"] == "intraday"


def test_a_stale_live_bar_is_withheld_but_completed_sessions_stay(monkeypatch):
    out, st = _append(monkeypatch, _p(), datetime(2026, 10, 12, 14, 30, tzinfo=ET))
    assert [b["t"] for b in out] == ["2026-10-07", "2026-10-08", "2026-10-09"]
    assert out[:2] == BODY                                   # finalized history untouched
    assert st["live"] == "withheld" and "old" in st["reason"]


def test_a_carried_unstamped_payload_never_draws_today(monkeypatch):
    """The incident's exact shape: carried from before the deploy, no data_as_of."""
    out, st = _append(monkeypatch, _p(data_as_of=None, carried=True),
                      datetime(2026, 10, 12, 14, 25, 52, tzinfo=ET))
    assert out[-1]["t"] == "2026-10-09" and st["live"] == "withheld"
    assert "observation time unavailable" in st["reason"]


def test_after_the_close_todays_row_is_a_provisional_close(monkeypatch):
    out, st = _append(monkeypatch, _p(data_as_of="2026-10-12T16:00:30-04:00"),
                      datetime(2026, 10, 12, 18, 0, tzinfo=ET))
    assert out[-1]["t"] == "2026-10-12" and st["status"] == "provisional"


def test_no_live_row_leaves_history_exactly_as_it_was(monkeypatch):
    out, st = _append(monkeypatch, _p(today=False), datetime(2026, 10, 11, 12, 0, tzinfo=ET))
    assert out[:2] == BODY and out[-1]["t"] == "2026-10-09" and st["live"] == "none"


@pytest.mark.parametrize("data_as_of,now", [
    ("2026-10-12T14:00:12-04:00", datetime(2026, 10, 12, 14, 1, tzinfo=ET)),
    ("2026-10-12T14:00:12-04:00", datetime(2026, 10, 12, 14, 6, tzinfo=ET)),
    (None, datetime(2026, 10, 12, 14, 1, tzinfo=ET)),
    ("2026-10-12T13:37:00-04:00", datetime(2026, 10, 12, 13, 52, tzinfo=ET)),
])
def test_chart_and_agent_agree_on_what_is_live(monkeypatch, data_as_of, now):
    p = _p(data_as_of=data_as_of)
    _out, st = _append(monkeypatch, p, now)
    r = bc.choose("us", "pct_above_50sma", now, p, {"2026-10-08": 1.0})
    assert (st["live"] == "drawn") == r["current"]


# ── 4. alerting ──────────────────────────────────────────────────────────────

@pytest.fixture
def alerts(monkeypatch, tmp_path):
    monkeypatch.setenv("BREADTH_ALERTS_STATE", str(tmp_path / "s.json"))
    monkeypatch.setenv("DISCORD_BREADTH_WEBHOOK_URL", "https://discord.test/b")
    monkeypatch.setattr(blu, "_process_uptime", lambda: 99999)
    posts = []

    class R:
        status_code = 204
    return posts, (lambda url, **k: posts.append(k["json"]["content"]) or R())


def _publish(p):
    blu._payload.clear()
    blu._payload.update(value=p, at=time.time())


def test_stale_alerts_once_and_resolves_once(alerts):
    posts, post = alerts
    _publish(_p(data_as_of=None, carried=True))
    t = datetime(2026, 10, 12, 14, 25, tzinfo=ET)
    r = blu.check_health(t, post=post)
    assert not r["ok"] and len(posts) == 1 and "not current" in posts[0]
    blu.check_health(t, post=post)
    assert len(posts) == 1                                    # deduplicated
    _publish(_p(data_as_of="2026-10-12T14:31:00-04:00"))
    blu.check_health(datetime(2026, 10, 12, 14, 31, 30, tzinfo=ET), post=post)
    assert len(posts) == 2 and "current again" in posts[1]
    blu.check_health(datetime(2026, 10, 12, 14, 32, tzinfo=ET), post=post)
    assert len(posts) == 2                                    # resolves once, then silent


def test_a_long_in_flight_refresh_is_a_problem(alerts, monkeypatch):
    posts, post = alerts
    _publish(_p(data_as_of="2026-10-12T14:00:12-04:00"))
    monkeypatch.setattr(blu, "inflight_seconds", lambda now=None: 900.0)
    r = blu.check_health(datetime(2026, 10, 12, 14, 0, 30, tzinfo=ET), post=post)
    assert any("in flight" in x for x in r["problems"]) and len(posts) == 1


@pytest.mark.parametrize("now,why", [
    (datetime(2026, 10, 11, 12, 0, tzinfo=ET), "not a trading day"),      # Sunday
    (datetime(2026, 11, 26, 12, 0, tzinfo=ET), "not a trading day"),      # Thanksgiving
    (datetime(2026, 10, 12, 9, 40, tzinfo=ET), "outside regular hours"),  # open grace
    (datetime(2026, 10, 12, 16, 5, tzinfo=ET), "outside regular hours"),  # after the close
    (datetime(2026, 11, 27, 13, 30, tzinfo=ET), "outside regular hours"),  # half-day close 13:00
])
def test_no_alerts_outside_a_live_session(alerts, now, why):
    posts, post = alerts
    _publish({"ok": False, "reason": "anything"})
    r = blu.check_health(now, post=post)
    assert r == {"checked": False, "reason": why} and posts == []


def test_no_alert_storm_during_process_warm_up(alerts, monkeypatch):
    posts, post = alerts
    monkeypatch.setattr(blu, "_process_uptime", lambda: 300)
    _publish({"ok": False, "reason": "boot grace"})
    assert blu.check_health(datetime(2026, 10, 12, 14, 5, tzinfo=ET), post=post)["reason"] == "process warm-up"
    assert posts == []


def test_resolve_without_a_prior_alert_posts_nothing(alerts):
    posts, post = alerts
    assert breadth_alerts.resolve("never", "t", [], post=post)["reason"] == "not alerted" and posts == []


def test_tick_never_raises(monkeypatch):
    monkeypatch.setattr(blu, "serving", lambda: True)
    monkeypatch.setattr(blu, "payload", lambda cached_only=True: (_ for _ in ()).throw(RuntimeError("x")))
    assert "error" in blu.tick()
