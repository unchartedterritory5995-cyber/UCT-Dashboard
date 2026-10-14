"""Tier 2 part A (R-T2A-6): the one ticker check the chips use -- buzz_extract, never a browser guess."""
from __future__ import annotations

import importlib
import os
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.routers import notebook_smart_chips as sc

URL = "/api/j2/smart-chips/tickers"


def test_a_plain_symbol_in_a_sentence_is_found():
    assert {"symbol": "NVDA", "tier": "exact"} in sc.tickers_in("alert me if NVDA closes below 120")


@pytest.mark.parametrize("word", ["RS", "EMA", "MA", "GAP", "PEG"])
def test_trading_words_are_not_tickers_without_a_cashtag(word):
    assert all(t["symbol"] != word for t in sc.tickers_in(f"alert me if {word} closes below 120"))


def test_a_cashtag_makes_any_word_a_ticker():
    assert {"symbol": "RS", "tier": "cashtag"} in sc.tickers_in("alert me if $RS closes below 120")


def test_text_is_capped_and_never_empty():
    with pytest.raises(sc.TextRefused):
        sc.tickers_in("   ")
    with pytest.raises(sc.TextRefused):
        sc.tickers_in("x" * (sc.MAX_TEXT + 1))
    with pytest.raises(sc.TextRefused):
        sc.tickers_in(None)


def test_the_cap_is_on_the_text_as_sent_and_exactly_at_the_cap_passes():
    # Exactly MAX_TEXT characters is allowed (the refusal is "over", not "at").
    assert sc.tickers_in("a" * sc.MAX_TEXT) == []
    # A non-string is refused, never coerced (the number 120 is not text).
    with pytest.raises(sc.TextRefused):
        sc.tickers_in(120)


# ── the route: gate (404 before anything), session (401), plan (402), then the body ───────────

@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + suffix)
        except OSError:
            pass


@pytest.fixture
def client(db_path, monkeypatch):
    monkeypatch.setenv(sc.FLAG, "1")
    app = FastAPI()
    app.include_router(sc.router)
    c = TestClient(app)
    c.app_ref = app
    yield c
    app.dependency_overrides.clear()


def _as(client, uid="u1", plan="pro"):
    """The route resolves the user through `get_current_user_with_plan` (the plan rides on the user it
    returns), exactly as the journal-styles router does, so that dependency is the one to override.
    `get_current_user` is overridden too: the real session check must not be reachable behind it."""
    user = {"id": uid, "role": "member", "plan": plan}
    client.app_ref.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    client.app_ref.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)


def test_switch_off_is_the_one_404(client, monkeypatch):
    monkeypatch.delenv(sc.FLAG, raising=False)
    r = client.post(URL, json={"text": "NVDA"})              # signed out, flag unset
    assert (r.status_code, r.json()) == (404, {"detail": "Not found"})


def test_switch_off_answers_before_the_session_the_plan_or_the_body(client, monkeypatch):
    """Signed in and paid, a malformed body: with the switch OFF the answer is the one 404, never the
    body's 422 and never a 402. The gate runs before every other dependency."""
    _as(client)
    assert client.post(URL, content=b"[1]").status_code == 422                       # control: switch on
    monkeypatch.setenv(sc.FLAG, "0")
    r = client.post(URL, content=b"[1]")
    assert (r.status_code, r.json()) == (404, {"detail": "Not found"})
    _as(client, plan="free")
    assert client.post(URL, json={"text": "NVDA"}).status_code == 404                # not a 402 either


def test_signed_out_is_401(client):
    assert client.post(URL, json={"text": "alert me if NVDA closes below 120"}).status_code == 401


def test_the_session_and_the_plan_are_checked_before_the_body_is_read(client):
    """A malformed body from a signed-out caller is a 401, and from a free member a 402 -- never the
    body's 422, and never read at all (gate, then plan, then the capped body)."""
    assert client.post(URL, content=b"[1]").status_code == 401
    _as(client, plan="free")
    assert client.post(URL, content=b"[1]").status_code == 402
    assert client.post(URL, content=b"x" * 200_000).status_code == 402        # not a 413 either


def test_free_plan_is_402(client):
    _as(client, plan="free")
    r = client.post(URL, json={"text": "alert me if NVDA closes below 120"})
    assert r.status_code == 402 and r.json()["detail"] == "Smart chips require a paid plan"


def test_round_trip(client):
    _as(client)
    r = client.post(URL, json={"text": "alert me if NVDA closes below 120"})
    assert r.status_code == 200
    assert {"symbol": "NVDA", "tier": "exact"} in r.json()["tickers"]
    # A sentence naming nothing is a 200 with an empty list, not an error.
    r = client.post(URL, json={"text": "alert me if EMA closes below 120"})
    assert (r.status_code, r.json()) == (200, {"tickers": []})


def test_over_long_text_is_422(client):
    _as(client)
    r = client.post(URL, json={"text": "x" * (sc.MAX_TEXT + 1)})
    assert r.status_code == 422 and r.json()["detail"] == f"Send at most {sc.MAX_TEXT} characters."


@pytest.mark.parametrize("body", [{}, {"text": ""}, {"text": "   "}, {"text": 120}, {"text": None},
                                  {"text": ["NVDA"]}])
def test_empty_or_non_string_text_is_422_with_the_sentence(client, body):
    _as(client)
    r = client.post(URL, json=body)
    assert r.status_code == 422 and r.json()["detail"] == "Send some text to check."


def test_a_body_that_is_not_an_object_is_422(client):
    _as(client)
    assert client.post(URL, content=b"[1]", headers={"content-type": "application/json"}).status_code == 422


def test_an_oversized_body_is_cut_off_at_the_cap(client):
    _as(client)
    r = client.post(URL, json={"text": "x" * 200_000})
    assert r.status_code == 413 and r.json()["detail"] == sc.TOO_LARGE_SENTENCE


def test_the_text_is_never_stored_or_logged(client, caplog, db_path):
    """R-T2A-6: the route is a pure function of the text. Nothing is logged, and no table gained a row."""
    import sqlite3
    _as(client)
    marker = "ZZQ-secret-sentence NVDA"
    with caplog.at_level("DEBUG"):
        assert client.post(URL, json={"text": marker}).status_code == 200
    assert marker not in caplog.text
    con = sqlite3.connect(db_path)
    try:
        for (name,) in con.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall():
            if name.startswith("sqlite_"):
                continue
            rows = con.execute(f'SELECT * FROM "{name}"').fetchall()
            assert marker not in repr(rows), f"the text reached table {name}"
    finally:
        con.close()
