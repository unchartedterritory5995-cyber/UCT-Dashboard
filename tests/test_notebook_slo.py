"""The Notebook SLOs and their alerts (wave 10, lane 10D — clause 15c, ruling R-15).

What these pin, each over a real (temporary) auth.db and the real `activity_log`
rows the telemetry door writes:

  * a HEALTHY fixture reads OK on all three SLOs and pages nobody;
  * a CONTROL fixture that breaches every SLO is SEEN to fire — the save-success
    breach pages exactly once, and the two latency breaches are recorded and
    NEVER reach the pager (R-15 / D-9C3: speed is reported, never paged);
  * a retry streak that began and a 409 fork are not failed saves;
  * too few samples is INSUFFICIENT, never a verdict either way;
  * a breach pages when it begins, is not re-paged inside REPAGE_HOURS, and a
    recovery clears it so the next breach pages at once;
  * with no webhook (a sandbox) the page is a logged row, `delivered='log'`;
  * the digest writes one row and posts nowhere;
  * the admin doors are admin-only, and "run" writes the rows.

Fix round 1 (review I-1, I-2, M-4, M-5, M-6; Concern 3):
  * a FAILED delivery is recorded as failed and the next run pages again (I-1);
  * a second auth.db writer during `post()` is not locked out (I-2 — the
    reviewer's probe, as a rail);
  * a DELIVERED page still suppresses the re-page inside the window;
  * a breach whose last final failure is over an hour old is not re-paged (M-4);
  * a designed refusal does not move the rate and is counted as `refused`; a real
    5xx give-up does move it (M-5);
  * `activity_log(action, created_at)` exists after init and the SLO's COUNT
    uses it (M-6);
  * the scheduler registers both SLO jobs, by id, in `api/main.py` (Concern 3).

Fix round 2 (re-review D.1, D.2, N-1, N-2):
  * the measured save-door 5xx outage (120 morning saves, then three hours of
    streaks that begin and never recover) reads STALL and pages once, saying so;
  * a whole-window outage is a STALL, not INSUFFICIENT;
  * CONTROLS: a blip (2 streaks beside 40 saves), 2 streaks with no saves, and 3
    streaks against 10 saves are not stalls;
  * a slow outage whose hourly streak count dips is HELD, not re-paged every half
    hour, and a real recovery still re-arms;
  * a stall that turns into a breach is one incident — one page;
  * a refused spike is a named digest line and never a page (D.2);
  * both jobs carry their misfire grace (N-1);
  * a run forced inside another run's `post()` sends no second page, and a failed
    page's claim ages out so a later run pages (N-2).

Fix round 3 (controller ruling on concern 2):
  * CONTROL: three OFFLINE streaks and no save in the hour is not a stall — the
    browser said it had no connection, which is the member's network;
  * three NETWORK streaks and no save in the hour IS a stall — a fetch that threw
    can be our server dropping connections;
  * the offline word is the one the client source sends, the allow-list holds it,
    the SLO reads it from there, and `network` is not it.
"""
from __future__ import annotations

import importlib
import json
import os
import re
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw

NOW = datetime(2026, 9, 27, 12, 0, 0, tzinfo=timezone.utc)


@pytest.fixture
def slo(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = auth_db.get_connection()
    for uid in ("u1", "u2"):
        conn.execute("INSERT INTO users (id, email, password_hash, role) VALUES (?,?,?,?)",
                     (uid, f"{uid}@x.test", "x", "member"))
    conn.commit()
    conn.close()
    from api.services.journal_two import notebook_slo
    yield notebook_slo, auth_db
    os.unlink(tmp.name)


def _log(auth_db, event, details, *, n=1, hours_ago=1.0, uid="u1", at=None):
    stamp = (at or (NOW - timedelta(hours=hours_ago))).strftime("%Y-%m-%d %H:%M:%S")
    conn = auth_db.get_connection()
    conn.executemany(
        "INSERT INTO activity_log (id, user_id, action, details, created_at)"
        " VALUES (lower(hex(randomblob(8))), ?, ?, ?, ?)",
        [(uid, f"j2:{event}", json.dumps(details), stamp)] * n)
    conn.commit()
    conn.close()


def _healthy(auth_db):
    _log(auth_db, "save_success", {"door": "editor", "queued": False}, n=400)
    _log(auth_db, "save_failed", {"status": 404, "reason": "http", "retrying": False}, n=1)
    _log(auth_db, "ask_used", {"scope": "note", "ms": 8000}, n=12)
    _log(auth_db, "search_used", {"mode": "text", "results": 3, "ms": 240}, n=40)


def _breaching(auth_db):
    _log(auth_db, "save_success", {"door": "editor", "queued": False}, n=90)
    _log(auth_db, "save_failed", {"status": 500, "reason": "http", "retrying": False}, n=10)
    _log(auth_db, "ask_used", {"scope": "note", "ms": 61000}, n=12)
    _log(auth_db, "search_used", {"mode": "text", "results": 3, "ms": 4200}, n=40)


class _Pager:
    def __init__(self, answer="discord"):
        self.sent, self.answer = [], answer

    def __call__(self, text):
        self.sent.append(text)
        return self.answer


def test_a_healthy_notebook_reads_ok_everywhere_and_pages_nobody(slo):
    mod, auth_db = slo
    _healthy(auth_db)
    pager = _Pager()
    out = mod.run_check(NOW, post=pager)
    states = {k: v["state"] for k, v in out["slos"].items()}
    assert states == {"save_success": "ok", "ask_latency": "ok", "search_latency": "ok"}
    # Non-vacuity: the reads SAW the fixture (a query that matched nothing would also be quiet).
    assert out["slos"]["save_success"]["n"] == 401
    assert out["slos"]["search_latency"]["n"] == 40
    assert pager.sent == [] and out["pages"] == []


def test_CONTROL_every_slo_breaches_and_only_save_success_pages(slo):
    """⛔ The evaluator is SEEN to fire. (Mutation: invert the save-success
    comparison -> this reds; add a latency SLO to PAGING_SLOS -> this reds.)"""
    mod, auth_db = slo
    _breaching(auth_db)
    pager = _Pager()
    out = mod.run_check(NOW, post=pager)
    s = out["slos"]
    assert s["save_success"]["state"] == "breach" and s["save_success"]["value"] == pytest.approx(0.9)
    assert s["ask_latency"]["state"] == "breach" and s["ask_latency"]["value"] == 61000
    assert s["search_latency"]["state"] == "breach" and s["search_latency"]["value"] == 4200
    assert out["pages"] == [{"slo": "save_success", "delivered": "discord"}]
    assert len(pager.sent) == 1 and "save_success" in pager.sent[0]
    assert "latency" not in pager.sent[0]
    rows = mod.recent_events(50)
    assert sorted((r["kind"], r["slo"], r["state"]) for r in rows) == [
        ("evaluation", "ask_latency", "breach"),
        ("evaluation", "save_success", "breach"),
        ("evaluation", "search_latency", "breach"),
        ("page", "save_success", "breach"),
    ]


def test_speed_never_pages_is_a_pinned_routing_not_a_threshold(slo):
    mod, _ = slo
    assert mod.PAGING_SLOS == frozenset({"save_success"})


def test_a_retry_streak_that_began_and_a_409_fork_are_not_failed_saves(slo):
    mod, auth_db = slo
    _log(auth_db, "save_success", {"door": "editor", "queued": False}, n=100)
    _log(auth_db, "save_failed", {"status": 0, "reason": "network", "retrying": True}, n=30)
    _log(auth_db, "save_failed", {"status": 409, "reason": "conflict", "retrying": False}, n=5)
    s = mod.evaluate(NOW)["slos"]["save_success"]
    assert (s["failed"], s["n"], s["state"]) == (0, 100, "ok")
    # CONTROL: the same count of GIVE-UPS is a breach — the exclusion is not "ignore failures".
    _log(auth_db, "save_failed", {"status": 500, "reason": "http", "retrying": False}, n=5)
    assert mod.evaluate(NOW)["slos"]["save_success"]["state"] == "breach"


def test_too_few_samples_is_insufficient_never_a_verdict(slo):
    mod, auth_db = slo
    _log(auth_db, "save_success", {"door": "editor"}, n=3)
    _log(auth_db, "save_failed", {"reason": "http", "retrying": False}, n=3)
    _log(auth_db, "ask_used", {"ms": 90000}, n=2)
    pager = _Pager()
    out = mod.run_check(NOW, post=pager)
    assert {k: v["state"] for k, v in out["slos"].items()} == {
        "save_success": "insufficient", "ask_latency": "insufficient", "search_latency": "insufficient"}
    assert pager.sent == []


def test_rows_outside_the_window_do_not_count(slo):
    mod, auth_db = slo
    _log(auth_db, "save_failed", {"reason": "http", "retrying": False}, n=50, hours_ago=30)
    _log(auth_db, "save_success", {"door": "editor"}, n=50, hours_ago=2)
    assert mod.evaluate(NOW)["slos"]["save_success"]["state"] == "ok"


def test_a_breach_pages_once_is_repaged_after_the_interval_and_recovery_rearms(slo):
    mod, auth_db = slo
    _breaching(auth_db)
    pager = _Pager()
    mod.run_check(NOW, post=pager)
    mod.run_check(NOW + timedelta(minutes=15), post=pager)
    assert len(pager.sent) == 1, "a breach in progress is not re-paged every run"
    repage_at = NOW + timedelta(hours=mod.REPAGE_HOURS, minutes=1)
    # M-4: the breach is still live — a save gave up ten minutes before the re-page.
    _log(auth_db, "save_failed", {"status": 500, "reason": "http", "retrying": False},
         at=repage_at - timedelta(minutes=10))
    mod.run_check(repage_at, post=pager)
    assert len(pager.sent) == 2, "a breach that lasts is re-paged after REPAGE_HOURS"
    # Recovery: far past the breaching rows' window, with healthy rows only.
    later = NOW + timedelta(hours=40)
    stamp = (later - timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S")
    conn = auth_db.get_connection()
    conn.executemany("INSERT INTO activity_log (id, user_id, action, details, created_at)"
                     " VALUES (lower(hex(randomblob(8))), 'u1', 'j2:save_success', '{}', ?)",
                     [(stamp,)] * 50)
    conn.commit()
    conn.close()
    assert mod.run_check(later, post=pager)["slos"]["save_success"]["state"] == "ok"
    later2 = later + timedelta(minutes=15)
    stamp2 = (later2 - timedelta(minutes=5)).strftime("%Y-%m-%d %H:%M:%S")
    conn = auth_db.get_connection()
    conn.executemany("INSERT INTO activity_log (id, user_id, action, details, created_at)"
                     " VALUES (lower(hex(randomblob(8))), 'u1', 'j2:save_failed', ?, ?)",
                     [('{"reason": "http", "retrying": false}', stamp2)] * 10)
    conn.commit()
    conn.close()
    assert mod.run_check(later2, post=pager)["slos"]["save_success"]["state"] == "breach"
    assert len(pager.sent) == 3, "a NEW breach after a recovery pages at once"


def test_with_no_webhook_the_page_is_a_logged_row_not_a_silent_success(slo, monkeypatch, caplog):
    mod, auth_db = slo
    monkeypatch.delenv("DISCORD_WEBHOOK_URL", raising=False)
    _breaching(auth_db)
    with caplog.at_level("WARNING"):
        out = mod.run_check(NOW)
    assert out["pages"] == [{"slo": "save_success", "delivered": "log"}]
    assert any("PAGE" in r.getMessage() for r in caplog.records)
    page = [r for r in mod.recent_events(20) if r["kind"] == "page"]
    assert len(page) == 1 and page[0]["delivered"] == "log"


def test_the_digest_writes_one_row_and_posts_nowhere(slo, monkeypatch):
    mod, auth_db = slo
    _breaching(auth_db)
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://example.invalid/hook")

    def _boom(*a, **k):
        raise AssertionError("the digest must never post")
    import httpx
    monkeypatch.setattr(httpx, "post", _boom)
    out = mod.run_digest(NOW)
    assert "search_latency: BREACH 4200 ms" in out["digest"]
    assert "ask_latency: BREACH 61000 ms" in out["digest"]
    digests = [r for r in mod.recent_events(20) if r["kind"] == "digest"]
    assert len(digests) == 1 and digests[0]["delivered"] == "none"


def test_the_admin_doors_are_admin_only_and_run_writes_the_rows(slo, monkeypatch):
    mod, auth_db = slo
    monkeypatch.delenv("DISCORD_WEBHOOK_URL", raising=False)
    from api.routers import client_errors as router_mod
    fa = FastAPI()
    fa.include_router(router_mod.router)
    client = TestClient(fa)
    fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": "u1", "role": "member"}
    assert client.get("/api/admin/notebook-slo").status_code == 403
    assert client.post("/api/admin/notebook-slo/run").status_code == 403
    fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": "u1", "role": "admin"}
    _healthy(auth_db)
    r = client.post("/api/admin/notebook-slo/run")
    assert r.status_code == 200
    assert set(r.json()["slos"]) == {"save_success", "ask_latency", "search_latency"}
    body = client.get("/api/admin/notebook-slo").json()
    assert {e["slo"] for e in body["events"] if e["kind"] == "evaluation"} == {
        "save_success", "ask_latency", "search_latency"}
    assert client.post("/api/admin/notebook-slo/digest").status_code == 200


# ── Fix round 1 ──────────────────────────────────────────────────────────────


def _state(auth_db, slo="save_success"):
    conn = auth_db.get_connection()
    try:
        row = conn.execute("SELECT state, last_paged_at FROM notebook_slo_state WHERE slo = ?",
                           (slo,)).fetchone()
        return tuple(row) if row else None
    finally:
        conn.close()


def test_a_failed_delivery_is_recorded_as_failed_and_the_next_run_pages_again(slo):
    """I-1. (Mutation: stamp `last_paged_at` whatever `post` answered -> the second
    run computes not-due for REPAGE_HOURS and this reds.)"""
    mod, auth_db = slo
    _breaching(auth_db)
    down = _Pager(answer="failed")
    out = mod.run_check(NOW, post=down)
    assert len(down.sent) == 1
    assert out["pages"] == [{"slo": "save_success", "delivered": "failed"}]
    assert _state(auth_db) == ("breach", None), "a failed page must not stamp last_paged_at"
    kinds = [(r["kind"], r["delivered"]) for r in mod.recent_events(20) if r["kind"] != "evaluation"]
    assert kinds == [("page_failed", "failed")], "the failure is RECORDED, and not as a page"
    up = _Pager()
    out2 = mod.run_check(NOW + timedelta(minutes=15), post=up)
    assert len(up.sent) == 1 and out2["pages"] == [{"slo": "save_success", "delivered": "discord"}]
    assert _state(auth_db)[1] is not None


def test_a_pager_that_raises_is_a_failed_delivery_not_a_crash(slo):
    mod, auth_db = slo
    _breaching(auth_db)

    def boom(_text):
        raise RuntimeError("webhook exploded")
    out = mod.run_check(NOW, post=boom)
    assert out["pages"] == [{"slo": "save_success", "delivered": "failed"}]
    assert _state(auth_db) == ("breach", None)


def test_a_second_writer_during_the_page_is_not_locked_out(slo):
    """I-2 — the reviewer's probe A, as a rail: while `post()` is "on the network",
    another auth.db writer (a note save, the telemetry door) must get the lock. A
    writer with `timeout=0.2` fails `database is locked` if the evaluation's
    transaction is still open. (Mutation: drop the commit before `post()` -> red.)"""
    import sqlite3
    mod, auth_db = slo
    _breaching(auth_db)
    errors, wrote = [], []

    def post_while_another_writer_writes(_text):
        other = sqlite3.connect(os.environ["AUTH_DB_PATH"], timeout=0.2)
        try:
            other.execute("INSERT INTO activity_log (id, user_id, action, details, created_at)"
                          " VALUES ('probe-row', 'u2', 'j2:probe', '{}', '2026-09-27 11:59:00')")
            other.commit()
            wrote.append(True)
        except sqlite3.OperationalError as e:
            errors.append(str(e))
        finally:
            other.close()
        return "discord"
    out = mod.run_check(NOW, post=post_while_another_writer_writes)
    assert errors == [], f"a second writer was locked out during the page: {errors}"
    assert wrote == [True] and out["pages"] == [{"slo": "save_success", "delivered": "discord"}]
    conn = auth_db.get_connection()
    try:
        assert conn.execute("SELECT COUNT(*) FROM activity_log WHERE id = 'probe-row'").fetchone()[0] == 1
    finally:
        conn.close()


def test_a_delivered_page_still_suppresses_the_repage_inside_the_window(slo):
    """The I-1 fix must not turn into paging every run. (Mutation: never stamp
    `last_paged_at` -> every run pages and this reds.)"""
    mod, auth_db = slo
    _breaching(auth_db)
    pager = _Pager()
    mod.run_check(NOW, post=pager)
    for minutes in (5, 30, 120, 60 * mod.REPAGE_HOURS - 1):
        # saves keep failing, so only the interval can be what holds the page back
        _log(auth_db, "save_failed", {"status": 500, "reason": "http", "retrying": False},
             at=NOW + timedelta(minutes=minutes - 1))
        mod.run_check(NOW + timedelta(minutes=minutes), post=pager)
    assert len(pager.sent) == 1


def test_a_breach_whose_last_failure_is_over_an_hour_old_is_not_repaged(slo):
    """M-4. The rate covers 24 h, so after a fix the SLO stays in breach for up to a
    day; the re-page is held back unless saves are STILL failing. (Mutation: drop
    the recency condition -> the stale re-page fires and this reds.)"""
    mod, auth_db = slo
    _breaching(auth_db)                      # final failures stamped NOW - 1 h
    pager = _Pager()
    mod.run_check(NOW, post=pager)
    assert len(pager.sent) == 1, "the FIRST page is unchanged"
    repage_at = NOW + timedelta(hours=mod.REPAGE_HOURS, minutes=1)
    out = mod.run_check(repage_at, post=pager)
    assert out["slos"]["save_success"]["state"] == "breach", "the fixture must still be in breach"
    assert len(pager.sent) == 1, "last failure 7 h old: the incident is over, no re-page"
    # CONTROL: one fresh give-up inside the hour and the next run re-pages.
    later = repage_at + timedelta(minutes=5)
    _log(auth_db, "save_failed", {"status": 503, "reason": "http", "retrying": False},
         at=later - timedelta(minutes=30))
    mod.run_check(later, post=pager)
    assert len(pager.sent) == 2


def test_a_designed_refusal_does_not_move_the_rate_and_a_5xx_give_up_does(slo):
    """M-5 (ruling: designed refusals are not integrity failures). (Mutation: drop
    the refusal exclusion from the classifier -> the rate moves and this reds.)"""
    mod, auth_db = slo
    _log(auth_db, "save_success", {"door": "editor", "queued": False}, n=100)
    base = mod.evaluate(NOW)["slos"]["save_success"]
    assert (base["value"], base["failed"], base["refused"]) == (1.0, 0, 0)
    # the size cap (413 -> too-large), and the H14 depth refusal as the client sends it
    _log(auth_db, "save_failed", {"status": 413, "reason": "too-large", "retrying": False})
    _log(auth_db, "save_failed", {"status": 400, "reason": "http", "retrying": False})
    s = mod.evaluate(NOW)["slos"]["save_success"]
    assert (s["value"], s["failed"], s["n"]) == (1.0, 0, 100), "a refusal must not move the rate"
    assert s["refused"] == 2, "refusals stay visible in the readout"
    # CONTROL: one real give-up on a server error moves it.
    _log(auth_db, "save_failed", {"status": 503, "reason": "http", "retrying": False})
    c = mod.evaluate(NOW)["slos"]["save_success"]
    assert (c["failed"], c["n"], c["refused"]) == (1, 101, 2)
    assert c["value"] == pytest.approx(100 / 101)


def test_the_readout_carries_the_refused_count(slo):
    mod, auth_db = slo
    _log(auth_db, "save_failed", {"status": 413, "reason": "too-large", "retrying": False}, n=3)
    assert mod.evaluate(NOW)["slos"]["save_success"]["refused"] == 3
    assert "refused=3" in mod.run_digest(NOW)["digest"]


def test_the_activity_log_composite_index_exists_and_the_slo_count_uses_it(slo):
    """M-6. (Mutation: delete the index line from auth_db._SCHEMA -> red.)"""
    mod, auth_db = slo
    auth_db.init_db()                        # idempotent on a DB that already has the table
    conn = auth_db.get_connection()
    try:
        idx = {r[1]: [c[2] for c in conn.execute(f"PRAGMA index_info({r[1]})").fetchall()]
               for r in conn.execute("PRAGMA index_list(activity_log)").fetchall()}
        assert idx.get("idx_activity_action_created") == ["action", "created_at"], idx
        args = ("j2:save_success", "2026-09-26 12:00:00")
        plan = " ".join(str(r[-1]) for r in conn.execute("EXPLAIN QUERY PLAN " + mod._COUNT_SQL, args))
        assert "idx_activity_action_created" in plan, plan
        # CONTROL: the plan reader sees a DIFFERENT index once the composite one is
        # gone, so the assert above can fail on a real plan.
        conn.execute("DROP INDEX idx_activity_action_created")
        conn.commit()
        conn.close()
        conn = auth_db.get_connection()      # a fresh connection: no cached statement
        fallback = " ".join(str(r[-1]) for r in conn.execute("EXPLAIN QUERY PLAN " + mod._COUNT_SQL, args))
        assert "idx_activity_action_created" not in fallback and "INDEX" in fallback, fallback
    finally:
        conn.close()


def _add_job_calls(tree):
    """{literal id: the add_job Call node} for every `add_job(..., id=...)` in the
    tree. An AST, never a grep — a grep matches this docstring and the comment
    above the call (the desk_session_audit precedent)."""
    import ast
    out = {}
    for n in ast.walk(tree):
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == "add_job":
            for kw in n.keywords:
                if kw.arg == "id" and isinstance(kw.value, ast.Constant):
                    out[kw.value.value] = n
    return out


def _grace(call):
    """The literal `misfire_grace_time=` on an add_job Call, or None."""
    import ast
    for kw in call.keywords:
        if kw.arg == "misfire_grace_time" and isinstance(kw.value, ast.Constant):
            return kw.value.value
    return None


def test_both_slo_jobs_are_registered_on_the_scheduler_in_main():
    """Concern 3 — a pager nobody schedules reads as coverage — and N-1: each job
    carries a misfire grace, or a busy pool at the trigger minute drops the run
    silently. (Mutation: delete either add_job, point it at a different function,
    or drop / change either grace -> red.)"""
    import ast
    import pathlib
    main = pathlib.Path(__file__).resolve().parent.parent / "api" / "main.py"
    calls = _add_job_calls(ast.parse(main.read_text(encoding="utf-8")))
    # NON-VACUITY: the probe must see a sibling Notebook job it is not looking for,
    # and read a grace off a sibling that has one (1 s default would read None).
    assert "notebook_semantic_sweep" in calls, "the add_job AST scan is broken; its verdict means nothing"
    assert _grace(calls["screener_scan_sweep"]) == 3600, "the grace reader is broken; its verdict means nothing"
    for job_id, fn, grace in (("notebook_slo_check", "scheduled_check", 600),
                              ("notebook_slo_digest", "scheduled_digest", 3600)):
        assert job_id in calls, f"{job_id} is scheduled nowhere in api/main.py"
        target = calls[job_id].args[0]
        assert isinstance(target, ast.Attribute) and target.attr == fn, (
            f"{job_id} must run notebook_slo.{fn}, got {ast.dump(target)}")
        assert _grace(calls[job_id]) == grace, (
            f"{job_id} must carry misfire_grace_time={grace}; got {_grace(calls[job_id])}")


# ── Fix round 2 ──────────────────────────────────────────────────────────────


_STREAK = {"status": 503, "reason": "http", "retrying": True}
_GIVE_UP = {"status": 500, "reason": "http", "retrying": False}


def _log_at(auth_db, event, details, stamps, uid="u1"):
    conn = auth_db.get_connection()
    conn.executemany(
        "INSERT INTO activity_log (id, user_id, action, details, created_at)"
        " VALUES (lower(hex(randomblob(8))), ?, ?, ?, ?)",
        [(uid, f"j2:{event}", json.dumps(details), t.strftime("%Y-%m-%d %H:%M:%S")) for t in stamps])
    conn.commit()
    conn.close()


def _claim(auth_db, slo="save_success"):
    conn = auth_db.get_connection()
    try:
        row = conn.execute("SELECT page_attempt_at FROM notebook_slo_state WHERE slo = ?", (slo,)).fetchone()
        return row[0] if row else None
    finally:
        conn.close()


def _run_outage(mod, auth_db, start, minutes, every, pager):
    """Minute by minute from `start`: a retry streak BEGINS every `every` minutes
    (none recovers), and the scheduled check runs every 15 — rows are written as
    time passes, never ahead of the run that reads them. Returns the last result."""
    out = None
    for m in range(0, minutes + 1):
        t = start + timedelta(minutes=m)
        if m % every == 0 and m < minutes:
            _log_at(auth_db, "save_failed", _STREAK, [t])
        if m and m % 15 == 0:
            out = mod.run_check(t, post=pager)
    return out


def test_STALL_the_measured_save_door_outage_reads_stall_and_pages_once(slo):
    """Re-review D.1, measured: 120 saves in the morning, then a three-hour 5xx
    outage confined to the save door — 30 streaks begin, none recovers. The rate
    reads 1.0 (a retry is not a give-up) and, before this fix, nothing paged.
    (Mutation: delete the STALL assignment in `evaluate` -> no page -> red.)"""
    mod, auth_db = slo
    start = NOW - timedelta(hours=3)
    _log_at(auth_db, "save_success", {"door": "editor"}, [start - timedelta(hours=2)] * 120)
    pager = _Pager()
    out = _run_outage(mod, auth_db, start, 180, 6, pager)
    s = out["slos"]["save_success"]
    assert s["value"] == 1.0 and s["failed"] == 0, "the fixture must be the outage the rate cannot see"
    assert s["state"] == "stall", s
    assert s["stall"]["streaks"] >= mod.STALL_MIN_STREAKS and s["stall"]["succeeded"] == 0
    assert len(pager.sent) == 1, f"one incident, one page; got {len(pager.sent)}"
    assert "STALL" in pager.sent[0] and "breach" not in pager.sent[0].lower(), pager.sent[0]
    pages = [(r["kind"], r["state"]) for r in mod.recent_events(200) if r["kind"] == "page"]
    assert pages == [("page", "stall")]


def test_a_stall_that_lasts_is_repaged_after_the_interval(slo):
    """M-4 holds for a stall: its "still live" is a streak that BEGAN in the last
    hour (a stall has no give-ups to read). Seven hours of outage: the first page,
    then one re-page after REPAGE_HOURS. (Mutation: read a stall's recency off the
    give-ups -> it is never re-paged -> red.)"""
    mod, auth_db = slo
    start = NOW - timedelta(hours=7)
    _log_at(auth_db, "save_success", {"door": "editor"}, [start - timedelta(hours=2)] * 120)
    pager = _Pager()
    _run_outage(mod, auth_db, start, 7 * 60, 6, pager)
    assert len(pager.sent) == 2, f"first page + one re-page after {mod.REPAGE_HOURS} h; got {len(pager.sent)}"
    assert all("STALL" in t for t in pager.sent)


def test_STALL_a_whole_window_outage_is_a_stall_not_insufficient(slo):
    """No save lands all day, streaks keep beginning: zero attempts is INSUFFICIENT
    to the rate, and a stall must outrank it. (Mutation: let the stall outrank only
    OK -> this reads insufficient and pages nobody -> red.)"""
    mod, auth_db = slo
    stamps = [NOW - timedelta(minutes=10 + 20 * k) for k in range(72)]   # 3 in the last hour
    _log_at(auth_db, "save_failed", _STREAK, stamps)
    pager = _Pager()
    out = mod.run_check(NOW, post=pager)
    s = out["slos"]["save_success"]
    assert (s["n"], s["value"]) == (0, None), "zero attempts: the rate alone would read insufficient"
    assert s["state"] == "stall" and s["stall"]["streaks"] == 3, s
    assert len(pager.sent) == 1 and "n/a" in pager.sent[0]


def test_CONTROL_an_ordinary_blip_is_not_a_stall(slo):
    """Two streaks in an hour that also has forty saves; and — isolating the
    STALL_MIN_STREAKS clause — two streaks with no save at all in the hour.
    (Mutation: drop the minimum-streaks clause -> the second reading stalls -> red.)"""
    mod, auth_db = slo
    _log_at(auth_db, "save_success", {"door": "editor"}, [NOW - timedelta(minutes=30)] * 40)
    _log_at(auth_db, "save_failed", _STREAK, [NOW - timedelta(minutes=20), NOW - timedelta(minutes=40)])
    pager = _Pager()
    assert mod.run_check(NOW, post=pager)["slos"]["save_success"]["state"] == "ok"
    later = NOW + timedelta(hours=2)
    _log_at(auth_db, "save_failed", _STREAK, [later - timedelta(minutes=5), later - timedelta(minutes=25)])
    s = mod.run_check(later, post=pager)["slos"]["save_success"]
    assert (s["stall"]["streaks"], s["stall"]["succeeded"]) == (2, 0)
    assert s["state"] == "ok", "two streaks are a blip even with nothing landing"
    assert pager.sent == []


def test_CONTROL_three_streaks_against_ten_saves_is_not_a_stall(slo):
    """The threshold is met but the saves outnumber the streaks — saves ARE landing.
    Then the companion: the same three streaks against two saves is a stall.
    (Mutation: drop the `streaks > saves` clause -> the first reading stalls -> red.)"""
    mod, auth_db = slo
    _log_at(auth_db, "save_success", {"door": "editor"}, [NOW - timedelta(hours=5)] * 100)
    _log_at(auth_db, "save_success", {"door": "editor"}, [NOW - timedelta(minutes=15)] * 10)
    _log_at(auth_db, "save_failed", _STREAK, [NOW - timedelta(minutes=m) for m in (5, 25, 45)])
    pager = _Pager()
    s = mod.run_check(NOW, post=pager)["slos"]["save_success"]
    assert (s["stall"]["streaks"], s["stall"]["succeeded"], s["state"]) == (3, 10, "ok")
    assert pager.sent == []
    # companion: two hours on, three streaks and only two landed saves in the hour
    later = NOW + timedelta(hours=2)
    _log_at(auth_db, "save_success", {"door": "editor"}, [later - timedelta(minutes=15)] * 2)
    _log_at(auth_db, "save_failed", _STREAK, [later - timedelta(minutes=m) for m in (5, 25, 45)])
    s2 = mod.run_check(later, post=pager)["slos"]["save_success"]
    assert (s2["stall"]["streaks"], s2["stall"]["succeeded"], s2["state"]) == (3, 2, "stall")
    assert len(pager.sent) == 1


def test_a_slow_outage_whose_hourly_count_dips_is_held_not_repaged(slo):
    """One streak every 25 minutes: the hourly count swings 3, 3, 2, 3, 2 ... and
    the rate reads OK in every dip. Recovery is an OK reading WITH evidence; a dip
    where the streaks still outnumber the saves is held. Measured without the
    hold: four pages in three hours. Then a real recovery (the retries land)
    re-arms, and the next stall pages at once. (Mutations: `_recovered` always
    True -> repeated pages -> red; always False -> the later stall never pages -> red.)"""
    mod, auth_db = slo
    start = NOW - timedelta(hours=3)
    _log_at(auth_db, "save_success", {"door": "editor"}, [start - timedelta(hours=2)] * 120)
    pager = _Pager()
    _run_outage(mod, auth_db, start, 180, 25, pager)
    assert len(pager.sent) == 1, f"a dip is not a recovery; got {len(pager.sent)} pages"
    # the door comes back: the eight stuck saves land
    back = NOW + timedelta(minutes=5)
    _log_at(auth_db, "save_success", {"door": "editor"}, [back] * 8)
    assert mod.run_check(NOW + timedelta(minutes=15), post=pager)["slos"]["save_success"]["state"] == "ok"
    assert _state(auth_db)[0] == "ok", "a real recovery must end the incident"
    # a fresh outage two hours later pages at once
    _run_outage(mod, auth_db, NOW + timedelta(hours=2), 60, 6, pager)
    assert len(pager.sent) == 2, "after a recovery the next stall pages at once"


def test_a_stall_that_becomes_a_breach_is_one_incident_and_one_page(slo):
    """A stall pages; then saves start GIVING UP and the rate breaches. Same
    incident, so no second page — and the state row says what it now is.
    (Mutation: key `began` on a change of state instead of leaving the paging
    states -> the breach pages again -> red.)"""
    mod, auth_db = slo
    _log_at(auth_db, "save_success", {"door": "editor"}, [NOW - timedelta(hours=5)] * 100)
    _log_at(auth_db, "save_failed", _STREAK, [NOW - timedelta(minutes=m) for m in (5, 20, 35, 50)])
    pager = _Pager()
    assert mod.run_check(NOW, post=pager)["slos"]["save_success"]["state"] == "stall"
    later = NOW + timedelta(minutes=15)
    _log_at(auth_db, "save_failed", _GIVE_UP, [later - timedelta(minutes=2)] * 10)
    assert mod.run_check(later, post=pager)["slos"]["save_success"]["state"] == "breach"
    assert len(pager.sent) == 1
    assert _state(auth_db)[0] == "breach"


def test_a_refused_spike_is_a_named_digest_line_and_never_a_page(slo):
    """Re-review D.2: a server limit set wrong makes every affected save a designed
    refusal, which the rate excludes by ruling. The digest names the spike; the
    pager never hears of it. CONTROL: one under the line is not named.
    (Mutations: drop the line, or `>=` -> `>` -> red; lower the line -> the
    control reds.)"""
    mod, auth_db = slo
    _log_at(auth_db, "save_success", {"door": "editor"}, [NOW - timedelta(hours=2)] * 100)
    _log_at(auth_db, "save_failed", {"status": 413, "reason": "too-large", "retrying": False},
            [NOW - timedelta(hours=3)] * (mod.REFUSED_SPIKE_MIN - 1))
    assert "refused spike" not in mod.run_digest(NOW)["digest"], "the control must not be named"
    _log_at(auth_db, "save_failed", {"status": 400, "reason": "http", "retrying": False},
            [NOW - timedelta(hours=3)])
    digest = mod.run_digest(NOW)["digest"]
    assert f"refused spike: {mod.REFUSED_SPIKE_MIN} saves refused — check the server limits" in digest
    pager = _Pager()
    out = mod.run_check(NOW, post=pager)
    assert out["slos"]["save_success"]["state"] == "ok" and pager.sent == [], "a refusal never pages"


def test_a_run_forced_inside_another_runs_page_sends_no_second_page(slo):
    """N-2, the reviewer's measured race as a rail: an admin "run now" lands while
    a scheduled run is on the network with its page. Before the claim, both paged.
    (Mutation: drop the claim check -> the inner run pages too -> red.)"""
    mod, auth_db = slo
    _breaching(auth_db)
    inner_pager, inner = _Pager(), {}

    def outer_post(text):
        inner["out"] = mod.run_check(NOW + timedelta(seconds=5), post=inner_pager)
        return "discord"
    out = mod.run_check(NOW, post=outer_post)
    # NON-VACUITY: the inner run really ran, and read the breach.
    assert inner["out"]["slos"]["save_success"]["state"] == "breach"
    assert inner_pager.sent == [] and inner["out"]["pages"] == [], "a second page inside the window"
    assert out["pages"] == [{"slo": "save_success", "delivered": "discord"}]
    assert [r["kind"] for r in mod.recent_events(50)].count("page") == 1
    assert _claim(auth_db) is None, "a delivered page releases its claim"


def test_a_failed_pages_claim_ages_out_and_a_later_run_pages(slo):
    """N-2 with I-1: the failed delivery leaves its claim, which holds a run inside
    PAGE_CLAIM_SECONDS and not after. (Mutation: a claim that never expires -> the
    run past the minute is held too -> red.)"""
    mod, auth_db = slo
    _breaching(auth_db)
    mod.run_check(NOW, post=_Pager(answer="failed"))
    assert _state(auth_db) == ("breach", None) and _claim(auth_db) is not None
    held = _Pager()
    mod.run_check(NOW + timedelta(seconds=30), post=held)
    assert held.sent == [], "a claim under a minute old holds the page"
    later = _Pager()
    out = mod.run_check(NOW + timedelta(seconds=mod.PAGE_CLAIM_SECONDS + 1), post=later)
    assert len(later.sent) == 1 and out["pages"] == [{"slo": "save_success", "delivered": "discord"}]
    assert _state(auth_db)[1] is not None and _claim(auth_db) is None


def test_a_state_table_made_by_fix_round_1_gains_the_claim_column(slo):
    """`CREATE TABLE IF NOT EXISTS` never adds a column; an auth.db that ran fix
    round 1 would make every run raise inside the scheduler's catch-all — a dead
    pager. (Mutation: drop the ALTER in `_ensure` -> OperationalError -> red.)"""
    mod, auth_db = slo
    conn = auth_db.get_connection()
    conn.execute("CREATE TABLE notebook_slo_state (slo TEXT PRIMARY KEY, state TEXT NOT NULL,"
                 " since TEXT NOT NULL, last_paged_at TEXT)")
    conn.commit()
    conn.close()
    _breaching(auth_db)
    pager = _Pager()
    out = mod.run_check(NOW, post=pager)
    assert out["pages"] == [{"slo": "save_success", "delivered": "discord"}] and len(pager.sent) == 1


# ── Fix round 3 — an offline streak is the member's network ────────────────


_EDITOR = Path(__file__).resolve().parents[1] / "app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx"


def _client_no_status_reasons() -> tuple[str, str]:
    """(offline word, network word) PARSED out of `reportSaveFailed` — the words the
    client really sends for a failure with no status. Never retyped."""
    src = _EDITOR.read_text(encoding="utf-8")
    found = re.findall(r"!status \? \(offline \? '([a-z-]+)' : '([a-z-]+)'\)", src)
    # NON-VACUITY: exactly one mapping, or the parse is reading the wrong thing.
    assert len(found) == 1, f"reportSaveFailed's no-status branch not found exactly once: {found}"
    return found[0]


def _no_status_streak(reason: str) -> dict:
    """A retry streak that began on a failure with no status, shaped as the client
    sends it (`{status, reason, offline, retrying}`)."""
    offline_word, _ = _client_no_status_reasons()
    return {"status": 0, "reason": reason, "offline": reason == offline_word, "retrying": True}


def test_the_offline_word_is_the_clients_and_the_allow_lists_and_network_is_not_it(slo):
    """The word the stall sets aside is the one the client source sends, the one
    the server's arrival allow-list keeps (a word off that list is stored as
    'other' and the exclusion would never fire), and the one the SLO reads. And
    `network` — the other no-status word — is a different word, so it still counts.
    (Mutation: misspell `SAVE_FAILED_OFFLINE_REASON` -> red here.)"""
    mod, _ = slo
    from api.routers.journal_two import SAVE_FAILED_OFFLINE_REASON, _NOTEBOOK_PROP_SCHEMAS
    offline_word, network_word = _client_no_status_reasons()
    allowed = _NOTEBOOK_PROP_SCHEMAS["save_failed"]["reason"]
    assert offline_word == SAVE_FAILED_OFFLINE_REASON == mod._offline_reason()
    assert offline_word in allowed and network_word in allowed
    assert network_word != offline_word


def test_CONTROL_three_offline_streaks_and_no_saves_in_an_hour_is_not_a_stall(slo):
    """Controller ruling, fix round 3: the browser itself said it had no connection,
    so the streaks are the member's network, not our outage. The same three
    streaks with `network` are a stall (the rail below), so this reads the reason
    and nothing else. (Mutation: remove the exclusion in `_streaks_begun` -> this
    stalls and pages -> red.)"""
    mod, auth_db = slo
    offline_word, _ = _client_no_status_reasons()
    _log_at(auth_db, "save_success", {"door": "editor"}, [NOW - timedelta(hours=5)] * 100)
    _log_at(auth_db, "save_failed", _no_status_streak(offline_word),
            [NOW - timedelta(minutes=m) for m in (5, 25, 45)])
    pager = _Pager()
    s = mod.run_check(NOW, post=pager)["slos"]["save_success"]
    st = s["stall"]
    # ONE comparison, so a failure prints the whole reading. NON-VACUITY is inside
    # it: the three rows were read in the window (offline_streaks == 3) and set aside.
    reading = (s["state"], st["streaks"], st["offline_streaks"], st["succeeded"], len(pager.sent))
    assert reading == ("ok", 0, 3, 0, 0), (reading, s)


def test_STALL_three_network_streaks_and_no_saves_in_an_hour_is_a_stall(slo):
    """The companion: the identical fixture with `network` — a fetch that threw,
    which our server dropping connections also produces — is a stall and pages
    once. (Mutation: set `network` aside too -> no stall, no page -> red.)"""
    mod, auth_db = slo
    _, network_word = _client_no_status_reasons()
    _log_at(auth_db, "save_success", {"door": "editor"}, [NOW - timedelta(hours=5)] * 100)
    _log_at(auth_db, "save_failed", _no_status_streak(network_word),
            [NOW - timedelta(minutes=m) for m in (5, 25, 45)])
    pager = _Pager()
    s = mod.run_check(NOW, post=pager)["slos"]["save_success"]
    st = s["stall"]
    reading = (s["state"], st["streaks"], st["offline_streaks"], st["succeeded"], len(pager.sent))
    assert reading == ("stall", 3, 0, 0, 1), (reading, s)
    assert "STALL" in pager.sent[0]


# ── Fix round 4 — TERM-011 step 4: the SAME (OPS, critical) second transport ───
# `chart_health_alerts` pages with, mirrored here for the Notebook save pager.
# `docs/terminal-research/07-technical-architecture/term-011-routing-decisions.md`
# is the decision packet; `tests/test_ops_second_transport.py` is the sibling rail
# for `chart_health_alerts`' own leg and this file's `_ImmediateThread` shim mirrors
# its pattern (fire-and-forget threads must be collapsed or a test asserts over an
# empty recorder and passes on a race, not a fact).


class _ImmediateEmailThread:
    def __init__(self, target=None, daemon=None, name=None, **kwargs):
        self._target = target

    def start(self):
        if self._target is not None:
            self._target()


class _EmailThreadingShim:
    Thread = _ImmediateEmailThread


@pytest.fixture
def notebook_email(monkeypatch, slo):
    """The second transport's seam fake — `email_service.send_email`, faked exactly
    as `tests/test_ops_second_transport.py::sent` fakes it for `chart_health_alerts`
    — plus the synchronous thread shim on `notebook_slo` itself, so a test can read
    the calls a `run_check` it just made produced, not a race with a daemon thread."""
    mod, _ = slo
    from api.services import email_service
    calls: list = []

    def _send_email(to, subject, html):
        calls.append({"to": to, "subject": subject, "html": html})
        return True

    monkeypatch.setattr(email_service, "send_email", _send_email)
    monkeypatch.setattr(mod, "threading", _EmailThreadingShim)
    return calls


def test_with_OPS_ALERT_EMAIL_TO_unset_no_email_is_attempted(slo, monkeypatch, notebook_email):
    """⛔ STEP 3'S INVARIANT, RESTATED FOR STEP 4: `OPS_ALERT_EMAIL_TO` is set on no
    service today, so this pager's email leg must be INERT — no thread, no
    `email_service` call. (Mutation: drop the `if not recipients: return` guard in
    `_email_second_transport` -> this reds, because the guard is what stops it.)"""
    mod, auth_db = slo
    monkeypatch.delenv("OPS_ALERT_EMAIL_TO", raising=False)
    _breaching(auth_db)
    pager = _Pager()
    out = mod.run_check(NOW, post=pager)
    assert out["pages"] == [{"slo": "save_success", "delivered": "discord"}]
    assert notebook_email == [], "no OPS_ALERT_EMAIL_TO -> no email attempted"


def test_with_OPS_ALERT_EMAIL_TO_set_both_transports_are_called_once(slo, monkeypatch, notebook_email):
    """The acceptance shape: one page fires the Discord leg (via `post`) AND the
    email leg (via `_email_second_transport`), each exactly once, to every
    recipient `OPS_ALERT_EMAIL_TO` names. (Mutation: delete the
    `_email_second_transport(text)` call from `run_check`'s page loop ->
    `notebook_email` stays `[]` -> red.)"""
    mod, auth_db = slo
    monkeypatch.setenv("OPS_ALERT_EMAIL_TO", "ops-a@uct-ops.test, ops-b@uct-ops.test")
    _breaching(auth_db)
    pager = _Pager()
    out = mod.run_check(NOW, post=pager)
    assert out["pages"] == [{"slo": "save_success", "delivered": "discord"}]
    assert len(pager.sent) == 1, "the Discord leg fired exactly once"
    assert [c["to"] for c in notebook_email] == ["ops-a@uct-ops.test", "ops-b@uct-ops.test"], (
        "the email leg fired exactly once, to every OPS_ALERT_EMAIL_TO recipient")


def test_an_email_failure_never_suppresses_the_discord_page(slo, monkeypatch, notebook_email):
    """One leg's failure cannot touch the other's recorded outcome. (Mutation: let a
    raise from `_email_second_transport`'s call site propagate out of the page loop
    -> the Discord `delivered` row is never written -> red.)"""
    mod, auth_db = slo

    def _boom(to, subject, html):
        raise RuntimeError("Resend is down")
    from api.services import email_service
    monkeypatch.setattr(email_service, "send_email", _boom)
    monkeypatch.setenv("OPS_ALERT_EMAIL_TO", "ops-a@uct-ops.test")
    _breaching(auth_db)
    pager = _Pager()
    out = mod.run_check(NOW, post=pager)
    assert out["pages"] == [{"slo": "save_success", "delivered": "discord"}], (
        "an email failure must not change the Discord delivery outcome")
    assert len(pager.sent) == 1


def test_a_raise_AT_the_email_call_site_does_not_abort_the_discord_recording(slo, monkeypatch):
    """The narrower claim `test_an_email_failure_never_suppresses_the_discord_page`
    cannot make on its own: `_email_second_transport` catches a `send_email` failure
    INSIDE its own thread, so that test never exercises `run_check`'s own
    try/except around the call site. This one raises AT the call site itself (no
    thread involved) and proves `run_check`'s wrapping `try/except` is what keeps a
    fault there from aborting the Discord bookkeeping below it. (Mutation: delete
    the `try/except` around `_email_second_transport(text)` in `run_check` -> the
    raise propagates -> `run_check` never returns -> this errors instead of
    passing.)"""
    mod, auth_db = slo
    monkeypatch.setattr(mod, "_email_second_transport",
                        lambda text: (_ for _ in ()).throw(RuntimeError("boom")))
    _breaching(auth_db)
    pager = _Pager()
    out = mod.run_check(NOW, post=pager)
    assert out["pages"] == [{"slo": "save_success", "delivered": "discord"}]
    assert len(pager.sent) == 1


def test_a_discord_failure_never_suppresses_the_email_leg(slo, monkeypatch, notebook_email):
    """The mirror: the Discord `post` raising must not stop the email leg from being
    attempted. (Mutation: move the `_email_second_transport(text)` call inside the
    `try/except` above it, so a `post` raise short-circuits past it -> this reds on
    an empty `notebook_email`.)"""
    mod, auth_db = slo
    monkeypatch.setenv("OPS_ALERT_EMAIL_TO", "ops-a@uct-ops.test")
    _breaching(auth_db)

    def _boom(text):
        raise RuntimeError("discord is down")
    out = mod.run_check(NOW, post=_boom)
    assert out["pages"] == [{"slo": "save_success", "delivered": "failed"}]
    assert [c["to"] for c in notebook_email] == ["ops-a@uct-ops.test"], (
        "the email leg must still fire when the Discord leg raises")
