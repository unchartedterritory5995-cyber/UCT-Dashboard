"""COV-10 follow-up — a saved screen and a theme's holdings as list SOURCES for a /charts Watchlist
widget (``CHARTS_LIST_SUBSCRIBE_ENABLED``).

REAL stores: the sandbox auth.db the repo-root conftest pins (``screener_saved_screens``, the
``theme_db`` tables), a screener snapshot in ``tmp_path`` seeded through ``snapshot_db.upsert_rows``
(the recipe ``tests/test_screener_query.py`` uses), and the theme engine's overlay written through
its own ``theme_engine.store.upsert_add``. The REAL router is mounted on a bare app.

⭐ THE LOAD-BEARING RAIL: a source that does not exist is a 404 WITH ITS REASON, never
``{"results": []}`` — the client renders an empty ``results`` as "the source holds no stocks".
"""
from __future__ import annotations

import importlib
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import theme_db
from api.services.auth_db import get_connection, init_db
from api.services.screener import saved_screens
from tests.authclients import authorize

FLAG = "CHARTS_LIST_SUBSCRIBE_ENABLED"


def _user(plan="pro"):
    return {"id": f"cls-{uuid.uuid4().hex[:10]}", "email": "c@example.test", "role": "member", "plan": plan}


def _client(user):
    from api.routers import charts_list_sources
    app = FastAPI()
    app.include_router(charts_list_sources.router)
    authorize(app, user)
    return TestClient(app)


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv(FLAG, "1")


@pytest.fixture
def snapshot(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    import api.services.screener.snapshot_db as db
    importlib.reload(db)
    db.init_db()
    db.upsert_rows([
        {"ticker": "AAA", "rsi14": 50, "sector": "Tech", "uct_composite": 90, "snapshot_date": "2026-09-30", "built_at": 1},
        {"ticker": "BRK.B", "rsi14": 55, "sector": "Fin", "uct_composite": 80, "snapshot_date": "2026-09-30", "built_at": 1},
        {"ticker": "CCC", "rsi14": 80, "sector": "Tech", "uct_composite": 70, "snapshot_date": "2026-09-30", "built_at": 1},
    ])
    from api.services.screener import query
    importlib.reload(query)
    yield
    monkeypatch.undo()
    importlib.reload(db)
    importlib.reload(query)


@pytest.fixture
def theme():
    """One owner theme with two members, plus an engine overlay row that ADDS one and an engine
    row that tries to re-tier an owner member (the owner must win)."""
    init_db()
    theme_db.init_theme_tables()
    from api.services.theme_engine import store as engine
    engine.init_engine_tables()
    tid = f"t-{uuid.uuid4().hex[:8]}"
    with get_connection() as c:
        c.execute("INSERT OR IGNORE INTO theme_sectors (id, name) VALUES ('cov10-sec', 'Cov10')")
        c.execute("INSERT INTO themes (id, name, sector_id) VALUES (?, 'Quantum Computing', 'cov10-sec')", (tid,))
        c.execute("INSERT INTO theme_memberships (theme_id, sym, tier) VALUES (?, 'IONQ', 'core')", (tid,))
        c.execute("INSERT INTO theme_memberships (theme_id, sym, tier) VALUES (?, 'BRK.B', 'peripheral')", (tid,))
        c.commit()
    engine.upsert_add(tid, "RGTI", "relevant", None, 0.9, "engine add", "run-cov10")
    engine.upsert_add(tid, "IONQ", "peripheral", None, 0.9, "engine retier", "run-cov10")
    return tid


def test_dark_both_sources_are_404(monkeypatch, theme):
    monkeypatch.delenv(FLAG, raising=False)
    u = _user()
    saved_screens.init()
    rec = saved_screens.create(u["id"], "Leaders", {"filters": []})
    c = _client(u)
    assert c.get(f"/api/charts/list-sources/screen/{rec['id']}").status_code == 404
    assert c.get(f"/api/charts/list-sources/theme/{theme}").status_code == 404


def test_a_saved_screen_answers_its_nightly_results_in_board_form(on, snapshot):
    u = _user()
    saved_screens.init()
    rec = saved_screens.create(u["id"], "RSI under 60", {"filters": [{"key": "rsi14", "op": "lte", "max": 60}]})
    r = _client(u).get(f"/api/charts/list-sources/screen/{rec['id']}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert sorted(x["sym"] for x in body["results"]) == ["AAA", "BRK-B"]
    assert (body["label"], body["as_of"], body["total"]) == ("RSI under 60", "2026-09-30", 2)


def test_a_screen_that_is_gone_or_not_mine_is_404_and_free_is_402(on, snapshot):
    owner, other = _user(), _user()
    saved_screens.init()
    rec = saved_screens.create(owner["id"], "Mine", {"filters": []})
    r = _client(other).get(f"/api/charts/list-sources/screen/{rec['id']}")
    assert r.status_code == 404 and "no longer exists" in r.json()["detail"]
    saved_screens.delete(rec["id"], owner["id"])
    r = _client(owner).get(f"/api/charts/list-sources/screen/{rec['id']}")
    assert r.status_code == 404 and r.json()["detail"] == "That saved screen no longer exists."
    assert _client({**owner, "plan": "free"}).get(f"/api/charts/list-sources/screen/{rec['id']}").status_code == 402


def test_a_screen_whose_spec_no_longer_runs_is_400_with_the_reason(on, snapshot):
    u = _user()
    saved_screens.init()
    rec = saved_screens.create(u["id"], "Broken", {"filters": [{"key": "drop_table", "op": "eq", "value": 1}]})
    r = _client(u).get(f"/api/charts/list-sources/screen/{rec['id']}")
    assert r.status_code == 400 and r.json()["detail"].startswith("The screen could not be run")


def test_a_theme_answers_owner_plus_overlay_holdings_with_the_owner_winning(on, theme):
    r = _client(_user(plan="free")).get(f"/api/charts/list-sources/theme/{theme}")
    assert r.status_code == 200, r.text
    body = r.json()
    syms = [x["sym"] for x in body["results"]]
    assert sorted(syms) == ["BRK-B", "IONQ", "RGTI"]          # overlay add merged, dot -> hyphen
    assert len(syms) == len(set(syms))                        # the engine re-tier is not a second IONQ
    assert (body["label"], body["total"]) == ("Quantum Computing", 3)
    held = {h["sym"]: h for h in theme_db.get_theme_holdings(theme)}
    assert held["IONQ"]["tier"] == "core" and held["IONQ"]["source"] == "owner"


def test_an_unknown_theme_is_404_never_an_empty_list(on, theme):
    assert theme_db.get_theme_holdings("no-such-theme") == []   # why the existence check exists
    r = _client(_user()).get("/api/charts/list-sources/theme/no-such-theme")
    assert r.status_code == 404 and r.json()["detail"] == "That theme no longer exists."
