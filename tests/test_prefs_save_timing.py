"""Per-step timing of SLOW preference saves (api/services/save_timing.py, 2026-11-16).

What must stay true:
  * a fast save logs nothing (the normal case);
  * a slow save logs ONE line with every step it ran, wall and CPU per step, the key and the value's
    size, and never the value or anything naming the member;
  * a refused save still reports (the timing wraps the whole handler) and still answers as before;
  * the instrument can never break a save.
Drives the REAL router through a real client, like tests/test_preference_value_validation.py.
"""
from __future__ import annotations

import logging
import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import auth as auth_router
from api.services import save_timing
from tests.authclients import PAID_MEMBER, authorize

THEME = auth_router._APP_THEME_BASE[0]   # a stored theme is a base ("light"/"dark")


@pytest.fixture(scope="module")
def client():
    from api.services import auth_db

    auth_db.init_db()
    app = FastAPI()
    app.include_router(auth_router.router)
    authorize(app, PAID_MEMBER)
    return TestClient(app)


def _lines(caplog):
    return [r.getMessage() for r in caplog.records if r.getMessage().startswith("[prefs-slow]")]


def test_a_fast_save_logs_nothing(client, caplog):
    caplog.set_level(logging.WARNING, logger="api.prefs_timing")
    assert client.post("/api/auth/preferences", json={"key": "theme", "value": THEME}).status_code == 200
    assert _lines(caplog) == []


def test_a_slow_save_logs_every_step_and_nothing_about_the_member(client, caplog, monkeypatch):
    monkeypatch.setattr(save_timing, "SLOW_S", 0.0)
    caplog.set_level(logging.WARNING, logger="api.prefs_timing")
    r = client.post("/api/auth/preferences", json={"key": "theme", "value": THEME})
    assert r.status_code == 200 and r.json() == {"ok": True}
    lines = _lines(caplog)
    assert len(lines) == 1
    line = lines[0]
    assert line.startswith("[prefs-slow] key=theme bytes=%d " % len(THEME))
    steps = re.findall(r" ([a-z_]+)=(\d+)/(\d+)", line)
    assert [s[0] for s in steps] == ["validate", "bound", "doc_begin", "write", "doc_finish", "rest"]
    assert THEME not in line.split("bytes=")[1]                       # the value is never logged
    for ident in (PAID_MEMBER.get("id"), PAID_MEMBER.get("email")):
        if ident:
            assert str(ident) not in line


def test_a_refused_save_still_reports_and_answers_as_before(client, caplog, monkeypatch):
    monkeypatch.setattr(save_timing, "SLOW_S", 0.0)
    caplog.set_level(logging.WARNING, logger="api.prefs_timing")
    r = client.post("/api/auth/preferences", json={"key": "theme", "value": "not-a-theme"})
    assert r.status_code == 400
    lines = _lines(caplog)
    assert len(lines) == 1 and " validate=" not in lines[0] and " rest=" in lines[0]


def test_the_key_is_sanitised():
    ph = save_timing.Phases()
    save_timing.SLOW_S, saved = 0.0, save_timing.SLOW_S
    try:
        line = ph.report("bad key\n[forged] line", 3)
    finally:
        save_timing.SLOW_S = saved
    assert "\n" not in line and "[forged]" not in line and line.startswith("[prefs-slow] key=bad?key?")


def test_the_instrument_never_breaks_a_save(client, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("instrument failure")
    monkeypatch.setattr(save_timing._log, "warning", boom)
    monkeypatch.setattr(save_timing, "SLOW_S", 0.0)
    assert client.post("/api/auth/preferences", json={"key": "theme", "value": THEME}).status_code == 200
