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
"""
from __future__ import annotations

import importlib
import json
import os
import tempfile
from datetime import datetime, timedelta, timezone

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


def test_both_slo_jobs_are_registered_on_the_scheduler_in_main():
    """Concern 3 — a pager nobody schedules reads as coverage. (Mutation: delete
    either add_job, or point it at a different function -> red.)"""
    import ast
    import pathlib
    main = pathlib.Path(__file__).resolve().parent.parent / "api" / "main.py"
    calls = _add_job_calls(ast.parse(main.read_text(encoding="utf-8")))
    # NON-VACUITY: the probe must see a sibling Notebook job it is not looking for.
    assert "notebook_semantic_sweep" in calls, "the add_job AST scan is broken; its verdict means nothing"
    for job_id, fn in (("notebook_slo_check", "scheduled_check"),
                       ("notebook_slo_digest", "scheduled_digest")):
        assert job_id in calls, f"{job_id} is scheduled nowhere in api/main.py"
        target = calls[job_id].args[0]
        assert isinstance(target, ast.Attribute) and target.attr == fn, (
            f"{job_id} must run notebook_slo.{fn}, got {ast.dump(target)}")
