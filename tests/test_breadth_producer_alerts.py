"""Runner-side #breadth-alerts for the V2 producer's own failure states
(`api/services/breadth_producer_alerts.py`) and its wiring into the runner loop.

Regression for 2026-10-13..16: 10-12..10-15 sat REVIEW_REQUIRED for three days and no alert named
it. No network: posts are captured. All dates and reasons are synthetic."""
from __future__ import annotations

import datetime as dt
import json
from zoneinfo import ZoneInfo

import pytest

from api.services import breadth_alerts
from api.services import breadth_authority as ba
from api.services import breadth_producer_alerts as bpa
from api.services import breadth_v2_producer as prod

ET = ZoneInfo("America/New_York")
SAT = dt.datetime(2026, 10, 17, 12, 0, tzinfo=ET)


class _R:
    def __init__(self, code=204):
        self.status_code = code


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(prod, "ROOT", str(tmp_path / "producer"))
    monkeypatch.setenv("BREADTH_ALERTS_STATE", str(tmp_path / "alerts.json"))
    monkeypatch.setenv("DISCORD_BREADTH_WEBHOOK_URL", "https://discord.test/breadth")
    monkeypatch.delenv(bpa.ENABLED_ENV, raising=False)
    posts = []
    return posts, (lambda url, **k: posts.append(k["json"]["content"]) or _R())


def _done_through(last: str) -> set:
    return set(prod.trading_days(ba.LIVE_START, last))


def _store(sessions=None, done=None, conflicts=(), hold=False):
    """Default: every session through Friday 10-16 published except the ones under test — so on
    SAT nothing is overdue unless a test says so (10-16 itself is due Monday night)."""
    sessions = sessions or {}
    if done is None:
        done = _done_through("2026-10-16") - set(sessions)
    return {"sessions": sessions, "done": done, "conflicts": list(conflicts), "hold": hold}


def _parked(*dates, reason='{"gate": "STOP"}'):
    return {d: {"state": prod.REVIEW_REQUIRED, "attempts": 0, "reason": reason, "updated_at": None}
            for d in dates}


GATE_REASON = json.dumps({"reviewed_sha": "a" * 64, "export": "pit_export.json",
                          "export_sha256": "3fbb89b02480763d5eb616e168102eee5da833cca0b3735077ed68b950d009db",
                          "source_rows_exported": 196, "previously_accepted": 141,
                          "source_row_mutations": ["2026-10-12"], "backfill_exclusion_unchanged": True,
                          "rejected": {f"2026-01-{i:02d}": {"reasons": ["x" * 300]} for i in range(1, 29)}})


# ── review_required: the incident's own condition ────────────────────────────

def test_a_parked_session_alerts_from_the_real_store_and_names_the_gates_cause(env):
    posts, post = env
    reason = GATE_REASON[:4000]                          # exactly what tick() stores
    assert len(GATE_REASON) > 4000                       # non-vacuity: the stored JSON IS truncated
    for d in ("2026-10-12", "2026-10-13"):
        prod._set(d, prod.REVIEW_REQUIRED, reason=reason)
    with prod._canon() as c:                             # everything before is published
        for d in sorted(_done_through("2026-10-09")):
            c.execute("INSERT INTO v2_session VALUES(?,?,?,?,?)", (d, "p", "s", "{}", "t"))
    out = bpa.check(SAT, post=post)
    assert out["found"]["review"] == ["2026-10-12", "2026-10-13"]
    assert len([p for p in posts if "parked for review" in p]) == 1
    body = next(p for p in posts if "parked for review" in p)
    assert "2026-10-12, 2026-10-13" in body
    assert "mutated source rows" in body and "2026-10-12" in body
    assert "3fbb89b0" in body and "3fbb89b02480" not in body          # a prefix, never the whole sha
    assert "pit_reviewed_rejections.json" in body


def test_the_same_parked_set_does_not_repost_until_the_reminder(env):
    posts, post = env
    st = _store(_parked("2026-10-12"))
    bpa.check(SAT, post=post, store=st)
    bpa.check(SAT + dt.timedelta(minutes=10), post=post, store=st)
    bpa.check(SAT + dt.timedelta(hours=23), post=post, store=st)
    assert len(posts) == 1
    bpa.check(SAT + dt.timedelta(hours=25), post=post, store=st)
    assert len(posts) == 2 and "(still unresolved)" in posts[1]


def test_a_new_parked_session_reposts_at_once_but_a_shrinking_set_does_not(env):
    posts, post = env
    bpa.check(SAT, post=post, store=_store(_parked("2026-10-12", "2026-10-13")))
    bpa.check(SAT + dt.timedelta(minutes=10), post=post,
              store=_store(_parked("2026-10-12", "2026-10-13", "2026-10-14")))
    assert len(posts) == 2 and "2026-10-14" in posts[1] and "still unresolved" not in posts[1]
    bpa.check(SAT + dt.timedelta(minutes=20), post=post, store=_store(_parked("2026-10-14")))
    assert len(posts) == 2                                # progress is not news


def test_recovery_posts_one_resolution_naming_what_published_then_a_recurrence_alerts_at_once(env):
    posts, post = env
    bpa.check(SAT, post=post, store=_store(_parked("2026-10-12", "2026-10-13")))
    healed = _store()
    bpa.check(SAT + dt.timedelta(minutes=10), post=post, store=healed)
    assert len(posts) == 2 and posts[1].startswith("✅")
    assert "2026-10-12: published" in posts[1] and "2026-10-13: published" in posts[1]
    bpa.check(SAT + dt.timedelta(minutes=20), post=post, store=healed)
    assert len(posts) == 2                                # one resolution, then silence
    bpa.check(SAT + dt.timedelta(minutes=30), post=post,
              store=_store(_parked("2026-10-14")))
    assert len(posts) == 3 and "parked for review" in posts[2]   # no cooldown left behind


def test_nothing_resolves_a_condition_that_never_alerted(env):
    posts, post = env
    bpa.check(SAT, post=post, store=_store())
    assert posts == []


# ── failed / overdue / conflict ──────────────────────────────────────────────

def test_a_failed_session_alerts_and_says_it_is_never_retried(env):
    posts, post = env
    st = _store({"2026-10-12": {"state": prod.FAILED, "attempts": 6, "reason": "validation: x",
                                "updated_at": None}})
    out = bpa.check(SAT, post=post, store=st)
    assert out["found"] == {"failed": ["2026-10-12"]}     # FAILED is not ALSO reported overdue
    assert len(posts) == 1 and "FAILED" in posts[0] and "6 attempts" in posts[0]
    assert "never retried automatically" in posts[0]


def test_overdue_is_measured_from_the_next_sessions_close(env):
    posts, post = env
    waiting = {"2026-10-16": {"state": prod.WAITING, "attempts": 0,
                              "reason": "PIT hindsight gate needs the next session's collector row (2026-10-19)",
                              "updated_at": None}}
    st = _store(waiting, done=_done_through("2026-10-15"))
    for now in (SAT, dt.datetime(2026, 10, 19, 21, 59, tzinfo=ET)):     # Friday waits for Monday
        assert "overdue" not in bpa.check(now, post=post, store=st)["found"]
    assert posts == []
    out = bpa.check(dt.datetime(2026, 10, 19, 22, 1, tzinfo=ET), post=post, store=st,
                    last_result={"error": "HTTPError: HTTP Error 502: Bad Gateway"})
    assert out["found"]["overdue"] == ["2026-10-16"]
    assert "WAITING" in posts[0] and "2026-10-19" in posts[0] and "502" in posts[0]


def test_a_never_attempted_session_and_a_HOLD_park_are_reported_overdue(env):
    posts, post = env
    st = _store({}, done=_done_through("2026-10-14"), hold=True)
    out = bpa.check(dt.datetime(2026, 10, 19, 12, 0, tzinfo=ET), post=post, store=st)
    assert out["found"]["overdue"] == ["2026-10-15"]     # 10-16 is not due until 22:00 ET Monday
    assert "never attempted" in posts[0] and "HOLD" in posts[0]


def test_a_conflict_alerts_once_per_distinct_conflict(env):
    posts, post = env
    c1 = ("2026-10-12", "b" * 64, "c" * 64, "2026-10-17T02:23:03Z")
    bpa.check(SAT, post=post, store=_store(conflicts=[c1]))
    bpa.check(SAT + dt.timedelta(minutes=10), post=post, store=_store(conflicts=[c1]))
    assert len(posts) == 1 and "bbbbbbbb" in posts[0] and "nothing was republished" in posts[0]
    c2 = ("2026-10-13", "d" * 64, "e" * 64, "2026-10-17T03:00:00Z")
    bpa.check(SAT + dt.timedelta(minutes=20), post=post, store=_store(conflicts=[c1, c2]))
    assert len(posts) == 2 and "2026-10-13" in posts[1]


# ── failure handling ─────────────────────────────────────────────────────────

def test_a_failed_post_records_nothing_and_the_next_pass_retries(env):
    posts, post = env
    st = _store(_parked("2026-10-12"))

    def broken(url, **k):
        raise ConnectionError("discord down")
    out = bpa.check(SAT, post=broken, store=st)
    assert out["sent"]["review"]["sent"] is False and "ConnectionError" in out["sent"]["review"]["reason"]
    assert breadth_alerts.signature("producer:review") is None
    bpa.check(SAT + dt.timedelta(minutes=10), post=post, store=st)
    assert len(posts) == 1
    bpa.check(SAT + dt.timedelta(minutes=20), post=lambda u, **k: _R(500), store=_store())
    assert breadth_alerts.signature("producer:review") == "2026-10-12"   # an unsent resolution is kept


def test_check_never_raises(env, monkeypatch):
    def boom():
        raise OSError("state.db unreadable")
    monkeypatch.setattr(bpa, "_store", boom)
    out = bpa.check(SAT)
    assert out["error"].startswith("OSError")


def test_no_webhook_is_logged_not_raised(env, monkeypatch):
    monkeypatch.delenv("DISCORD_BREADTH_WEBHOOK_URL")
    from api.services import alert_destination
    monkeypatch.setattr(alert_destination, "ops_webhook", lambda *a, **k: "")
    out = bpa.check(SAT, store=_store(_parked("2026-10-12")))
    assert out["sent"]["review"]["reason"] == "no webhook"


def test_the_kill_switch_stops_everything(env, monkeypatch):
    posts, post = env
    monkeypatch.setenv(bpa.ENABLED_ENV, "0")
    assert bpa.check(SAT, post=post, store=_store(_parked("2026-10-12"))) == {"enabled": False}
    assert posts == []


# ── the wiring: an alert nobody calls is worse than none ─────────────────────

@pytest.fixture
def loop(env, monkeypatch):
    from api import breadth_v2_producer_main as main
    calls = []
    monkeypatch.setattr(bpa, "check", lambda **k: calls.append(k) or {"ok": True})
    monkeypatch.setitem(main._EXCH, "on", False)
    return main, calls


def test_the_runner_loop_checks_after_every_pass_even_a_failing_tick(loop, monkeypatch):
    main, calls = loop

    def failing_tick():
        raise RuntimeError("HTTP Error 502")
    monkeypatch.setattr(prod, "tick", failing_tick)
    main._iterate()
    assert len(calls) == 1 and "502" in calls[0]["last_result"]["error"]


def test_the_runner_loop_checks_while_parked_by_HOLD(loop, monkeypatch):
    import os
    main, calls = loop
    ticked = []
    monkeypatch.setattr(prod, "tick", lambda: ticked.append(1))
    os.makedirs(prod.ROOT, exist_ok=True)
    open(os.path.join(prod.ROOT, "HOLD"), "w").close()
    main._iterate()
    assert ticked == [] and len(calls) == 1


def test_an_alert_failure_never_reaches_the_runner_loop(loop, monkeypatch):
    main, _calls = loop
    monkeypatch.setattr(prod, "tick", lambda: {"idle": True})

    def boom(**k):
        raise RuntimeError("alerts broke")
    monkeypatch.setattr(bpa, "check", boom)
    main._iterate()                                       # must not raise
    assert "alerts broke" in main._STATE["alerts"]["error"]
