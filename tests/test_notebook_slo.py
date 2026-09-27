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


def _log(auth_db, event, details, *, n=1, hours_ago=1.0, uid="u1"):
    stamp = (NOW - timedelta(hours=hours_ago)).strftime("%Y-%m-%d %H:%M:%S")
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
    mod.run_check(NOW + timedelta(hours=mod.REPAGE_HOURS, minutes=1), post=pager)
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
