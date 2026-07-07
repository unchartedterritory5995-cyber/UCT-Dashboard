"""Tests for liveflow deploy-survival: boot rehydration + stop() safety.

No network, no threads started, no Bullflow key used — everything runs
against a temp sqlite file via live_alerts_db's DB_PATH mechanism and the
worker module's pure in-memory state.
"""
import os
import tempfile

# Point the user-blocklist file at temp BEFORE importing the worker module —
# its import-time _load_user_blocklist() would otherwise try to seed
# /data/liveflow_user_blocklist.json (creates a stray \data dir on Windows).
os.environ.setdefault(
    "USER_BLOCKLIST_FILE",
    os.path.join(tempfile.gettempdir(), "liveflow_user_blocklist_test.json"),
)

from datetime import datetime, timedelta, timezone  # noqa: E402

import pytest  # noqa: E402

from api import live_alerts_db  # noqa: E402
from api import liveflow_worker as lw  # noqa: E402
from api import liveflow_worker_threaded as lwt  # noqa: E402


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _worker_alert(
    alert_id,
    ticker,
    ingested_dt,
    name="UCT Bullish",
    cp="C",
    strike=100.0,
    exp="2026-12-18",
    premium=600_000.0,
    fill=2.50,
    repeat=1,
    superseded=False,
):
    """Build a worker-shaped (camelCase) enriched alert dict, the same shape
    _ingest_alert persists via live_alerts_db.insert_alert."""
    return {
        "id": alert_id,
        "alertType": "custom",
        "alertName": name,
        "symbol": f"O:{ticker}261218{cp}00{int(strike):06d}0",
        "ticker": ticker,
        "cp": cp,
        "strike": strike,
        "exp": exp,
        "dte": 30,
        "alertPremium": premium,
        "averageFillPrice": fill,
        "timestamp": ingested_dt.timestamp(),
        "receivedAt": ingested_dt.timestamp(),
        "latency": 0.5,
        "deliveryLatency": 0.2,
        "ingestedAt": ingested_dt.astimezone(timezone.utc).isoformat(),
        "tradeSize": 100,
        "priorOI": 50,
        "volumeOIRatio": 2.0,
        "oiExceeded": True,
        "oiSnapshotDate": "2026-07-03",
        "spot": 95.0,
        "moneynessPct": 5.0,
        "moneynessLabel": "OTM",
        "contractRepeatCount": repeat,
        "_superseded": superseded,
    }


def _clear_worker_state():
    lw._alerts.clear()
    lw._alerts_posted_today.clear()
    lw._global_posted_today.clear()
    lw._contract_repeats.clear()
    lw._follow_through_tracker.clear()
    lw._dedup_cache.clear()
    lw._contract_aggregates.clear()


@pytest.fixture()
def temp_db(tmp_path, monkeypatch):
    """Fresh temp sqlite for live_alerts_db + pristine worker in-memory state."""
    db_path = str(tmp_path / "flow_test.db")
    monkeypatch.setattr(live_alerts_db, "DB_PATH", db_path)
    monkeypatch.setattr(live_alerts_db, "_initialized", False)
    live_alerts_db.init_db()
    _clear_worker_state()
    yield db_path
    _clear_worker_state()


def _now_et():
    return datetime.now(lw.ET)


def _today_et_iso():
    return _now_et().date().isoformat()


# ─── Rehydration ─────────────────────────────────────────────────────────────

def test_rehydrate_empty_db_is_noop(temp_db):
    lw._rehydrate_from_db()
    assert len(lw._alerts) == 0
    assert lw._alerts_posted_today == {}
    assert lw._global_posted_today == {}
    assert lw._contract_repeats == {}
    assert lw._contract_aggregates == {}


def test_rehydrate_loads_only_today_in_chronological_order(temp_db):
    now = _now_et()

    # Three today-rows, newest last; two yesterday-rows that must be ignored.
    a1 = _worker_alert("t1", "NVDA", now - timedelta(seconds=30), strike=120.0)
    a2 = _worker_alert("t2", "AMD", now - timedelta(seconds=20), strike=150.0)
    a3 = _worker_alert("t3", "MU", now - timedelta(seconds=10), strike=90.0)
    y1 = _worker_alert("y1", "TSLA", now - timedelta(days=1), strike=400.0)
    y2 = _worker_alert("y2", "COIN", now - timedelta(days=1, hours=2), strike=300.0)

    # Insert deliberately out of order — query_alerts orders by ingested_at.
    for a in (a3, y1, a1, y2, a2):
        live_alerts_db.insert_alert(a)

    lw._rehydrate_from_db()

    ids = [a.get("id") for a in lw._alerts]
    assert ids == ["t1", "t2", "t3"], "only today's rows, oldest-first"
    # Buffer entries are frontend-shaped dicts (camelCase, superseded filter works)
    assert lw.get_recent_alerts(limit=10)[0]["id"] == "t3"  # newest-first API view
    # Yesterday's rows are not buffered anywhere
    assert "y1" not in ids and "y2" not in ids


def test_rehydrate_rebuilds_caps_and_global_counters(temp_db):
    now = _now_et()
    today = _today_et_iso()

    # Two forwarded Alpha Gold posts on TSLA (different contracts) — Alpha Gold
    # has max_per_ticker_per_day configured, so the (alert, ticker) mark AND
    # the global counter must come back.
    g1 = _worker_alert("g1", "TSLA", now - timedelta(seconds=40),
                       name="UCT Alpha Gold", strike=400.0, premium=1_500_000.0)
    g2 = _worker_alert("g2", "TSLA", now - timedelta(seconds=30),
                       name="UCT Alpha Gold", strike=450.0, premium=2_500_000.0)
    # Forwarded UCT Bullish on NVDA — no per-alert cap configured, so global
    # counter only (no (alert, ticker) mark).
    b1 = _worker_alert("b1", "NVDA", now - timedelta(seconds=20),
                       name="UCT Bullish", strike=120.0)
    # Gate-blocked row on AMD — must contribute to NOTHING.
    x1 = _worker_alert("x1", "AMD", now - timedelta(seconds=10),
                       name="UCT Bullish", strike=150.0)

    for a in (g1, g2, b1, x1):
        live_alerts_db.insert_alert(a)

    live_alerts_db.update_alert_state("g1", grade="A", gate_passed=1,
                                      forwarded_to_discord=1,
                                      discord_message_id="msg-1")
    live_alerts_db.update_alert_state("g2", grade="A", gate_passed=1,
                                      forwarded_to_discord=1,
                                      discord_message_id="msg-2")
    live_alerts_db.update_alert_state("b1", grade="B", gate_passed=1,
                                      forwarded_to_discord=1,
                                      discord_message_id="msg-3")
    live_alerts_db.update_alert_state("x1", grade="C", gate_passed=0)

    lw._rehydrate_from_db()

    # Per-(alert, ticker) daily marks — only for alerts with a configured cap.
    marks = lw._alerts_posted_today.get(today, set())
    assert ("UCT Alpha Gold", "TSLA") in marks
    assert ("UCT Bullish", "NVDA") not in marks  # no max_per_ticker gate config
    assert not any(t == "AMD" for _, t in marks)
    # The live read helpers see the restored state (same ET date keying).
    assert lw._has_alert_posted_for_ticker_today("UCT Alpha Gold", "TSLA") is True
    assert lw._has_alert_posted_for_ticker_today("UCT Alpha Gold", "NVDA") is False

    # Global per-ticker NEW-post counters — forwarded rows only.
    assert lw._global_ticker_post_count_today("TSLA") == 2
    assert lw._global_ticker_post_count_today("NVDA") == 1
    assert lw._global_ticker_post_count_today("AMD") == 0


def test_rehydrate_repeat_follow_through_and_aggregates(temp_db):
    now = _now_et()

    # Same contract (MU P $90 2026-12-18) firing 3 times with escalating
    # stamped repeat counts and distinct premiums (distinct dedup keys).
    base = dict(name="UCT Size Bears", ticker="MU", cp="P", strike=90.0,
                exp="2026-12-18")
    r1 = _worker_alert("r1", base["ticker"], now - timedelta(seconds=45),
                       name=base["name"], cp=base["cp"], strike=base["strike"],
                       exp=base["exp"], premium=1_000_000.0, repeat=1)
    r2 = _worker_alert("r2", base["ticker"], now - timedelta(seconds=30),
                       name=base["name"], cp=base["cp"], strike=base["strike"],
                       exp=base["exp"], premium=1_200_000.0, repeat=2)
    r3 = _worker_alert("r3", base["ticker"], now - timedelta(seconds=15),
                       name=base["name"], cp=base["cp"], strike=base["strike"],
                       exp=base["exp"], premium=1_400_000.0, repeat=3)
    for a in (r1, r2, r3):
        live_alerts_db.insert_alert(a)

    # First fire created the Discord message; later fires patched it (so only
    # r1 carries forwarded_to_discord + the message id — mirrors live writes).
    live_alerts_db.update_alert_state("r1", grade="B", gate_passed=1,
                                      forwarded_to_discord=1,
                                      discord_message_id="mm-9")
    live_alerts_db.update_alert_state("r2", grade="B", gate_passed=1)
    live_alerts_db.update_alert_state("r3", grade="B", gate_passed=1)

    lw._rehydrate_from_db()

    ckey = lw._make_contract_key(
        {"ticker": "MU", "cp": "P", "strike": 90.0, "exp": "2026-12-18"}
    )

    # Repeat counter: max stamped count wins; first_seen = earliest ingest.
    entry = lw._contract_repeats.get(ckey)
    assert entry is not None
    assert entry["count"] == 3
    assert entry["first_alert_id"] == "r1"

    # Follow-through bucket: all three fires are inside the 15-min window.
    assert len(lw._follow_through_tracker.get(ckey, [])) == 3
    # The gate-facing read helper sees them too.
    probe = {"ticker": "MU", "cp": "P", "strike": 90.0, "exp": "2026-12-18"}
    assert lw._count_follow_through_in_window(probe, 900) == 3

    # Aggregate restored under the SAME key the live code uses (naive date),
    # with running totals and — critically — the Discord message id, so the
    # next fire PATCHes instead of POSTing a duplicate.
    agg_date = datetime.now().date().isoformat()
    agg = lw._contract_aggregates.get((ckey, agg_date))
    assert agg is not None
    assert agg["fire_count"] == 3
    assert agg["total_premium"] == pytest.approx(3_600_000.0)
    assert agg["max_premium"] == pytest.approx(1_400_000.0)
    assert agg["discord_message_id"] == "mm-9"
    assert agg["best_alert_name"] == "UCT Size Bears"
    assert "UCT Size Bears" in agg["alert_names_seen"]

    # Dedup cache: recent rows (within DEDUP_WINDOW_SEC) are remembered.
    dkey = lw._make_dedup_key(r3)
    assert lw._dedup_cache.get(dkey, {}).get("alert_id") == "r3"


def test_rehydrate_marks_superseded_rows_hidden_but_buffered(temp_db):
    now = _now_et()
    s1 = _worker_alert("s1", "PLTR", now - timedelta(seconds=20),
                       name="Sizable Sweep", strike=40.0, superseded=True)
    s2 = _worker_alert("s2", "PLTR", now - timedelta(seconds=19),
                       name="UCT Bullish", strike=40.0)
    for a in (s1, s2):
        live_alerts_db.insert_alert(a)

    lw._rehydrate_from_db()

    assert [a["id"] for a in lw._alerts] == ["s1", "s2"]
    visible = lw.get_recent_alerts(limit=10)
    assert [a["id"] for a in visible] == ["s2"], "superseded rows stay hidden"


def test_rehydrate_survives_db_errors(temp_db, monkeypatch):
    """Any exception inside rehydration is swallowed — startup never blocks."""
    def _boom(*args, **kwargs):
        raise RuntimeError("simulated volume failure")

    monkeypatch.setattr(live_alerts_db, "query_alerts", _boom)
    lw._rehydrate_from_db()  # must not raise
    assert len(lw._alerts) == 0


# ─── stop() safety ───────────────────────────────────────────────────────────

def test_stop_before_start_returns_cleanly():
    """stop() with no thread ever started: returns True, idempotent, and sets
    the worker's cooperative _STOP backup flag. Never raises."""
    prior_stop = lw._STOP
    prior_requested = lwt._state.get("stop_requested", False)
    try:
        assert lwt.is_running() is False
        assert lwt.stop() is True
        assert lw._STOP is True, "cooperative flag set even before start"
        # Idempotent double-stop
        assert lwt.stop() is True
        assert lwt.is_running() is False
    finally:
        # Restore module state so no other test inherits a stopped worker.
        lw._STOP = prior_stop
        lwt._state["stop_requested"] = prior_requested


def test_stop_never_raises_even_with_broken_state(monkeypatch):
    prior_stop = lw._STOP
    prior = dict(lwt._state)
    try:
        # Poison the state dict with a thread-like object whose join explodes.
        class _EvilThread:
            def is_alive(self):
                return True

            def join(self, timeout=None):
                raise RuntimeError("join exploded")

        lwt._state["thread"] = _EvilThread()
        lwt._state["stop_requested"] = True  # skip the cancel branch
        assert lwt.stop(timeout=0.01) is False  # swallowed, reported as not-clean
    finally:
        lwt._state.clear()
        lwt._state.update(prior)
        lw._STOP = prior_stop
