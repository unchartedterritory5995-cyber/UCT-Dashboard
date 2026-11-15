"""RS screens, the first night: the saved-screens payload says the lists are not built yet.

Every RS screen filters on a column only the rating post-pass writes. Until the first pass
under the flag each of them is empty, and the page's ordinary empty state blamed the
member's filters ("No stocks match all 12 filters") while the coverage line said 11,176
stocks "have no RS Rating" (the live site, 2026-11-15, the night the owner preview was
set). `rs_post_pass.pending()` names exactly that state and the saved-screens route
carries it as ``rs_pending`` for a user the screens are shown to.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
the key present once one row has a place; the key present with the flag off, with no
table, with no rows or without the column; the key served to a member under the owner
preview; a failed read raising instead of saying nothing; the sentence drifting from the
one the page test holds.
"""
from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

import pytest

from api.services.screener import rs_post_pass as pp
from api.services.screener import snapshot_db

ROOT = Path(__file__).resolve().parent.parent
ADMIN = {"id": "a1", "role": "admin", "plan": "pro"}
MEMBER = {"id": "u1", "role": "member", "plan": "pro"}
TEXT = "This list is not ready yet. It fills after the overnight rating run, at about 4:15 AM Eastern."


@pytest.fixture
def db(tmp_path, monkeypatch):
    path = tmp_path / "screener.db"
    monkeypatch.setattr(snapshot_db, "get_db_path", lambda: str(path))
    monkeypatch.setenv(pp.FLAG, "1")
    return path


def _table(path, rows, *, column=True):
    with closing(sqlite3.connect(path)) as conn:
        conn.execute("CREATE TABLE screener_rows (ticker TEXT PRIMARY KEY, price REAL"
                     + (", rs_rating_pos INTEGER" if column else "") + ")")
        for ticker, pos in rows:
            if column:
                conn.execute("INSERT INTO screener_rows VALUES (?, ?, ?)", (ticker, 10.0, pos))
            else:
                conn.execute("INSERT INTO screener_rows VALUES (?, ?)", (ticker, 10.0))
        conn.commit()


def test_rows_with_no_place_at_all_are_pending_and_say_so(db):
    _table(db, [("AAA", None), ("BBB", None), ("CCC", None)])
    assert pp.pending() == {"text": TEXT}
    assert pp.PENDING_TEXT == TEXT and "—" not in TEXT


def test_one_placed_row_ends_it(db):
    _table(db, [("AAA", None), ("BBB", 7), ("CCC", None)])
    assert pp.pending() is None


@pytest.mark.parametrize("value", [None, "0", "off", "nonsense"])
def test_nothing_is_said_while_the_screens_are_off(db, monkeypatch, value):
    _table(db, [("AAA", None)])
    assert pp.pending() == {"text": TEXT}, "control: pending with the flag on"
    if value is None:
        monkeypatch.delenv(pp.FLAG)
    else:
        monkeypatch.setenv(pp.FLAG, value)
    assert pp.pending() is None


def test_the_owner_preview_computes_the_data_so_it_is_pending_there_too(db, monkeypatch):
    _table(db, [("AAA", None)])
    monkeypatch.setenv(pp.FLAG, "admin")
    assert pp.pending() == {"text": TEXT}


def test_no_table_no_rows_and_no_column_say_nothing(db):
    assert pp.pending() is None, "no table: a pod with no snapshot has its own states"
    _table(db, [])
    assert pp.pending() is None, "no rows"


def test_a_table_from_before_the_column_says_nothing(db):
    _table(db, [("AAA", None)], column=False)
    assert pp.pending() is None


def test_a_failed_read_says_nothing_and_never_raises(db, monkeypatch):
    _table(db, [("AAA", None)])

    def broken():
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(snapshot_db, "connect", broken)
    assert pp.pending() is None


# ───────────────────────── the saved-screens payload ─────────────────────────

@pytest.fixture
def read(monkeypatch):
    """`read(value, user, pending)` -> the saved-screens body, over the screener router."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
    from api.routers import screener as screener_mod
    from api.services.screener import rs_market_state, rs_screen_alerts
    monkeypatch.setattr(screener_mod.scr_saved, "init", lambda: None)
    monkeypatch.setattr(screener_mod.scr_saved, "list_for", lambda uid: [])
    monkeypatch.setattr(rs_market_state, "served", lambda: None)
    monkeypatch.setattr(rs_screen_alerts, "payload", lambda user: None)
    who = {}
    app = FastAPI()
    app.include_router(screener_mod.router)
    app.dependency_overrides[get_current_user] = lambda: dict(who["user"])
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(who["user"])
    client = TestClient(app)

    def _read(value, user, pending):
        if value is None:
            monkeypatch.delenv(pp.FLAG, raising=False)
        else:
            monkeypatch.setenv(pp.FLAG, value)
        monkeypatch.setattr(pp, "pending", lambda: pending)
        who["user"] = user
        r = client.get("/api/screener/saved-screens")
        assert r.status_code == 200
        return r.json()

    return _read


def test_the_payload_carries_the_sentence_only_while_pending(read):
    body = read("1", MEMBER, {"text": TEXT})
    assert body["rs_pending"] == {"text": TEXT}
    assert "rs_pending" not in read("1", MEMBER, None), "every other day the payload is the one it was"


def test_the_key_is_only_for_a_user_the_screens_are_shown_to(read):
    pending = {"text": TEXT}
    assert "rs_pending" not in read(None, MEMBER, pending)
    assert "rs_pending" not in read(None, ADMIN, pending)
    assert "rs_pending" not in read("admin", MEMBER, pending), "a member under the owner preview is served the flag-off payload"
    assert read("admin", ADMIN, pending)["rs_pending"] == pending
    assert read("1", MEMBER, pending)["rs_pending"] == pending


def test_the_page_test_holds_the_same_sentence():
    page = (ROOT / "app" / "src" / "pages" / "screener" / "focus" / "__tests__"
            / "rsFirstNight.test.jsx").read_text(encoding="utf-8")
    assert TEXT in page
