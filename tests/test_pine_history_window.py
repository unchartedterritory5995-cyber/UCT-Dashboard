"""W9-T11-F1 rails: ``GET /api/pine/history-window`` (the chart lane's strategy window).

  * signed-in only (401 anonymous), plain ``def`` (the async-route census);
  * it answers ``bars_window.HISTORY_WINDOW_BARS`` and moves when that constant moves (the
    one-authority rail parses the module; this proves the VALUE follows the source at runtime);
  * the real app mounts it (the chart's fetch must resolve, not fall into the SPA catch-all).
No network; no flag is set.
"""
from __future__ import annotations

import inspect

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user
from api.routers import pine_history_window as phw
from api.services import bars_window

PATH = "/api/pine/history-window"


def _app(user=None) -> TestClient:
    app = FastAPI()
    app.include_router(phw.router)
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def test_anonymous_is_refused():
    assert _app().get(PATH).status_code == 401


def test_a_signed_in_member_reads_the_one_window():
    r = _app({"id": "m1", "role": "member"}).get(PATH)
    assert r.status_code == 200
    assert r.json() == {"historyWindowBars": bars_window.HISTORY_WINDOW_BARS}


def test_the_answer_follows_the_constant_not_a_copy(monkeypatch):
    # moving the one authority moves the answer (D9: a longer window is a change to that constant only)
    monkeypatch.setattr(phw, "HISTORY_WINDOW_BARS", bars_window.HISTORY_WINDOW_BARS + 1)
    r = _app({"id": "m1", "role": "member"}).get(PATH)
    assert r.json()["historyWindowBars"] == bars_window.HISTORY_WINDOW_BARS + 1


def test_the_handler_is_plain_def():
    assert not inspect.iscoroutinefunction(phw.history_window)


def test_the_real_app_mounts_it():
    from api.main import app
    paths = {getattr(r, "path", None) for r in app.routes}
    assert PATH in paths
