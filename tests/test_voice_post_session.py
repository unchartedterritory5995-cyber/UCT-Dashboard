"""A voice session's post-processing is DURABLE: recorded per step, finished by a sweep after a restart,
and never doubled (api/services/voice_post_session.py, api/routers/voice.py POST_SESSION_STEPS).

Before 2026-11-21 the four steps were Starlette BackgroundTasks only: a deploy (every master merge
redeploys web) or a crash in the window lost them for good, member data included."""
from __future__ import annotations

import ast
import sqlite3
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from api.routers import voice
from api.services import voice_post_session as vps
from api.services.auth_db import get_connection, init_db
from api.services.auth_service import create_user
from api.services.journal_two.coach_chat import list_messages
from api.services.trader_memory import get_default_account_id
from api.services.voice_session_service import append_transcript, create_session, end_session

ROOT = Path(__file__).resolve().parent.parent


def _user() -> str:
    init_db()
    return create_user(f"vpost_{uuid.uuid4()}@x.com", "p")["id"]


def _ended_session(uid: str, ago_s: float = 0, talk: bool = True) -> int:
    sid = create_session(user_id=uid, mode="c", source="orb")
    if talk:
        append_transcript(sid, role="user", text="Check NVDA for me")
        append_transcript(sid, role="assistant", text="NVDA is extended off the 20 EMA.")
    end_session(sid, duration_seconds=30)
    _set_ended(sid, datetime.now(timezone.utc) - timedelta(seconds=ago_s))
    return sid


def _set_ended(sid: int, when: datetime) -> None:
    c = get_connection()
    try:
        c.execute("UPDATE voice_sessions SET ended_at = ? WHERE id = ?", (when.isoformat(), sid))
        c.commit()
    finally:
        c.close()


def _arm_at(when: datetime) -> None:
    c = get_connection()
    try:
        vps.ensure_schema(c)
        c.execute("UPDATE voice_session_post_meta SET v = ? WHERE k = 'armed_at'", (when.isoformat(),))
        c.commit()
    finally:
        c.close()


def _forget_markers(sid: int) -> None:
    c = get_connection()
    try:
        c.execute("DELETE FROM voice_session_post WHERE session_id = ?", (sid,))
        c.commit()
    finally:
        c.close()


class _Steps:
    """Fake steps that record (step, session) calls, in order."""

    def __init__(self, names=vps.STEPS):
        self.calls: list = []
        self.steps = tuple((n, self._mk(n)) for n in names)

    def _mk(self, name):
        def fn(sid, uid):
            self.calls.append((name, sid))
        return fn

    def for_session(self, sid):
        return [n for n, s in self.calls if s == sid]


def test_a_run_does_every_step_in_order_once_and_records_each():
    uid = _user()
    sid = _ended_session(uid)
    fake = _Steps()
    out = vps.run(sid, uid, fake.steps)
    assert fake.for_session(sid) == list(vps.STEPS) and out["ran"] == list(vps.STEPS)
    c = get_connection()
    try:
        assert vps.done_steps(c, sid) == set(vps.STEPS)
    finally:
        c.close()
    vps.run(sid, uid, fake.steps)
    assert fake.for_session(sid) == list(vps.STEPS)                       # nothing ran twice


def test_a_step_that_raised_is_not_recorded_and_the_rest_still_run():
    uid = _user()
    sid = _ended_session(uid)
    fake = _Steps()

    def boom(s, u):
        raise RuntimeError("model down")
    steps = tuple((n, boom if n == "audit" else fn) for n, fn in fake.steps)
    out = vps.run(sid, uid, steps)
    assert out["ran"] == ["summary", "bridge", "profile"]
    c = get_connection()
    try:
        assert "audit" not in vps.done_steps(c, sid)
    finally:
        c.close()


def test_a_session_cut_short_by_a_restart_is_finished_by_the_sweep_and_only_its_missing_steps():
    now = datetime.now(timezone.utc)
    _arm_at(now - timedelta(days=1))
    uid = _user()
    sid = _ended_session(uid, ago_s=180)
    fake = _Steps()
    vps.run(sid, uid, fake.steps[:1])                                     # the process died after "summary"
    assert fake.for_session(sid) == ["summary"]
    assert vps.sweep(steps=fake.steps, now=now) >= 1
    assert fake.for_session(sid) == ["summary", "audit", "bridge", "profile"]
    vps.sweep(steps=fake.steps, now=now)
    assert fake.for_session(sid) == ["summary", "audit", "bridge", "profile"]   # done: never swept again
    c = get_connection()
    try:
        assert sid not in {s for s, _ in vps.due_sessions(c, now, limit=10_000)}   # nor even selected
    finally:
        c.close()


def test_the_sweep_waits_two_minutes_and_skips_history_and_old_sessions():
    now = datetime.now(timezone.utc)
    _arm_at(now - timedelta(days=30))
    uid = _user()
    fresh = _ended_session(uid, ago_s=30)                                 # its own after-response run may be going
    due = _ended_session(uid, ago_s=vps.SWEEP_AFTER_S + 5)
    old = _ended_session(uid, ago_s=(vps.SWEEP_WINDOW_DAYS + 1) * 86400)
    c = get_connection()
    try:
        got = {s for s, _ in vps.due_sessions(c, now, limit=10_000)}
    finally:
        c.close()
    assert due in got and fresh not in got and old not in got
    _arm_at(now - timedelta(seconds=vps.SWEEP_AFTER_S))                   # armed after `due` ended: history
    c = get_connection()
    try:
        assert due not in {s for s, _ in vps.due_sessions(c, now, limit=10_000)}
    finally:
        c.close()


def test_the_real_bridge_is_never_posted_twice_even_when_its_marker_was_lost():
    uid = _user()
    sid = _ended_session(uid)
    acc = get_default_account_id(uid)
    before = len(list_messages(user_id=uid, account_id=acc, limit=200)["messages"])
    steps = (("bridge", voice._bridge_session_to_compass_thread),)
    vps.run(sid, uid, steps)
    assert len(list_messages(user_id=uid, account_id=acc, limit=200)["messages"]) == before + 1
    _forget_markers(sid)                                                  # died between the write and the marker
    out = vps.run(sid, uid, steps)
    assert out["skipped"] == ["bridge"] and out["ran"] == []
    assert len(list_messages(user_id=uid, account_id=acc, limit=200)["messages"]) == before + 1


def test_a_summary_already_written_is_not_written_again(monkeypatch):
    uid = _user()
    sid = _ended_session(uid)
    monkeypatch.setattr(voice, "summarize_transcripts", lambda t: {"summary": "Talked NVDA.", "key_topics": ["NVDA"]})
    monkeypatch.setattr("api.services.voice_embeddings_service.index_text", lambda *a, **k: None, raising=False)
    steps = (("summary", voice._summarize_session_background),)

    def count():
        c = get_connection()
        try:
            return c.execute("SELECT count(*) FROM voice_session_summaries WHERE session_id = ?", (sid,)).fetchone()[0]
        finally:
            c.close()
    vps.run(sid, uid, steps)
    assert count() == 1
    _forget_markers(sid)
    vps.run(sid, uid, steps)
    assert count() == 1


def test_the_suggestion_and_audit_keys_name_this_session_and_this_member_only():
    c = sqlite3.connect(":memory:")
    c.execute("CREATE TABLE j2_profile_suggestions (user_id TEXT, source_type TEXT, source_id TEXT)")
    c.execute("CREATE TABLE voice_hallucinations (session_id INTEGER)")
    c.execute("INSERT INTO j2_profile_suggestions VALUES ('u1', 'voice_session', '7')")
    c.execute("INSERT INTO j2_profile_suggestions VALUES ('u1', 'chat', '8')")
    c.execute("INSERT INTO voice_hallucinations VALUES (7)")
    assert vps.already_written(c, 7, "u1", "profile") is True
    assert vps.already_written(c, 7, "u2", "profile") is False            # another member's session 7
    assert vps.already_written(c, 8, "u1", "profile") is False            # not a voice-session suggestion
    assert vps.already_written(c, 7, "u1", "audit") is True and vps.already_written(c, 8, "u1", "audit") is False
    assert vps.already_written(c, 7, "u1", "bridge") is False             # no such table yet: nothing written


def test_one_process_never_runs_one_session_twice_at_once():
    uid = _user()
    sid = _ended_session(uid)
    gate, entered = threading.Event(), threading.Event()
    calls = []

    def slow(s, u):
        calls.append(s)
        entered.set()
        gate.wait(5)
    th = threading.Thread(target=vps.run, args=(sid, uid, (("summary", slow),)))
    th.start()
    assert entered.wait(5)
    assert vps.run(sid, uid, (("summary", slow),)).get("busy") is True    # the sweep meets the running one
    gate.set()
    th.join(5)
    assert calls == [sid]


def test_the_route_hands_the_session_to_the_one_durable_run():
    src = (ROOT / "api" / "routers" / "voice.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    fn = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "session_end_post")
    tasks = [ast.unparse(c.args[0]) for c in ast.walk(fn)
             if isinstance(c, ast.Call) and getattr(c.func, "attr", "") == "add_task"]
    assert tasks == ["_post_session_background"]
    assert tuple(n for n, _ in voice.POST_SESSION_STEPS) == vps.STEPS
    assert [f.__name__ for _, f in voice.POST_SESSION_STEPS] == [
        "_summarize_session_background", "_audit_session_background",
        "_bridge_session_to_compass_thread", "_auto_populate_profile_background"]


def test_the_sweep_is_registered_on_the_web_scheduler_soon_after_boot():
    src = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
    assert "_voice_post.register(_scheduler, IntervalTrigger)" in src
    added = {}

    class _Sched:
        def add_job(self, fn, trigger, **kw):
            added.update(fn=fn, trigger=trigger, **kw)

    vps.register(_Sched(), lambda **kw: kw)
    assert added["fn"] is vps.sweep and added["trigger"] == {"minutes": vps.SWEEP_EVERY_MIN}
    assert added["id"] == "voice_post_session_sweep" and added["max_instances"] == 1
    lead = (added["next_run_time"] - datetime.now(timezone.utc)).total_seconds()
    assert 0 < lead <= vps.SWEEP_FIRST_AFTER_S
