"""Audit 2026-11-05, S19 -- "Hide my P&L and position size" on a share link really hides them, server-side, and
the preview is the stranger's read of the member's own note.

The account kinds (`myPnlStats`, `myPositionsRisk`, ...) are "member-optin": a stranger sees their figures only when
the member switched the widget's `share` on. A link minted with `hidePnl: true` shows the private line for every one
of them, `share` or not. A link minted without the field (an older client) serves exactly as before.
"""
from __future__ import annotations

import importlib
import json
import os
import sqlite3
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw

A, B = "user-alpha-s19", "user-bravo-s19"
PNL = {"type": "widgetEmbed", "attrs": {"v": 1, "widgetId": "myPnlStats", "mode": "snapshot",
                                         "params": {"share": True, "netPnl": 4321.5, "winRate": 0.61,
                                                    "tradeCount": 12, "asOf": "2026-11-04"}}}
RISK = {"type": "widgetEmbed", "attrs": {"v": 1, "widgetId": "myPositionsRisk", "mode": "snapshot",
                                          "params": {"share": True, "accountSize": 250000,
                                                     "rows": [{"symbol": "NVDA", "sizePct": 12.5, "openPnl": 900}]}}}
BODY = {"type": "doc", "content": [
    {"type": "paragraph", "content": [{"type": "text", "text": "My plan for NVDA."}]}, PNL, RISK]}


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    monkeypatch.setenv("J2_SHARE_LINKS_ENABLED", "1")
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + suffix)
        except OSError:
            pass


@pytest.fixture(autouse=True)
def _fresh_limiter():
    from api.limiter import limiter
    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture
def client(db_path):
    from api.routers import notebook_shares
    fa = FastAPI()
    fa.include_router(notebook_shares.router)
    c = TestClient(fa)
    c.app_ref = fa
    yield c
    fa.dependency_overrides.clear()


def as_member(client, uid):
    user = {"id": uid, "role": "member", "plan": "pro"}
    client.app_ref.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    client.app_ref.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)


def signed_out(client):
    client.app_ref.dependency_overrides.clear()


def _note(uid=A):
    from api.services.journal_two import notes
    return notes.create_note(uid, {"title": "NVDA flag into earnings", "bodyJson": BODY})["id"]


def _text(payload) -> str:
    return json.dumps(payload)


def _widget_ids(payload) -> list:
    out = []

    def walk(n):
        if isinstance(n, dict):
            if n.get("type") == "widgetEmbed":
                out.append(n.get("attrs", {}).get("widgetId"))
            for c in n.get("content") or []:
                walk(c)
    walk(payload["bodyJson"])
    return out


def test_hide_pnl_true_hides_every_account_figure_even_one_switched_to_share(client):
    nid = _note()
    as_member(client, A)
    r = client.post(f"/api/j2/notes/{nid}/share", json={"expiresInDays": 7, "hidePnl": True})
    assert r.status_code == 200 and r.json()["share"]["hidePnl"] is True
    token = r.json()["share"]["token"]
    signed_out(client)
    page = client.get(f"/api/j2/shared/{token}").json()["note"]
    text = _text(page)
    assert "My plan for NVDA." in text                      # the member's words still travel
    assert "4321" not in text and "250000" not in text and "12.5" not in text
    assert _widget_ids(page) == []
    from api.services.journal_two.public_note_payload import ACCOUNT_NEUTRAL_LINE
    assert ACCOUNT_NEUTRAL_LINE in text


def test_CONTROL_without_hide_pnl_a_switched_widget_still_shows_as_before(client):
    nid = _note()
    as_member(client, A)
    token = client.post(f"/api/j2/notes/{nid}/share", json={"expiresInDays": 7}).json()["share"]["token"]
    signed_out(client)
    page = client.get(f"/api/j2/shared/{token}").json()["note"]
    assert "myPnlStats" in _widget_ids(page) and "4321" in _text(page)


def test_hide_pnl_must_be_a_boolean(client):
    nid = _note()
    as_member(client, A)
    from api.services.journal_two import note_shares
    for bad in ("true", 1, None, [True]):
        r = client.post(f"/api/j2/notes/{nid}/share", json={"expiresInDays": 7, "hidePnl": bad})
        assert r.status_code == 422, (bad, r.text)
        assert note_shares.get_share(A, nid) is None, bad


def test_the_preview_is_the_strangers_read_and_writes_nothing(client):
    nid = _note()
    as_member(client, A)
    from api.services.auth_db import get_connection
    before = get_connection().execute("SELECT COUNT(*) FROM j2_note_shares").fetchone()[0]
    hidden = client.get(f"/api/j2/notes/{nid}/share/preview?hidePnl=true")
    shown = client.get(f"/api/j2/notes/{nid}/share/preview?hidePnl=false")
    assert hidden.status_code == 200 and shown.status_code == 200
    assert "4321" not in _text(hidden.json()) and "4321" in _text(shown.json())
    assert hidden.headers.get("cache-control") == "no-store, private"
    assert get_connection().execute("SELECT COUNT(*) FROM j2_note_shares").fetchone()[0] == before
    # The default (no query) is the safe one: hidden.
    assert "4321" not in _text(client.get(f"/api/j2/notes/{nid}/share/preview").json())


def test_the_preview_is_owner_only_and_a_foreign_note_is_the_missing_answer(client):
    nid = _note(A)
    as_member(client, B)
    on_a = client.get(f"/api/j2/notes/{nid}/share/preview")
    on_missing = client.get("/api/j2/notes/no-such-note/share/preview")
    assert on_a.status_code == 404 and on_a.content == on_missing.content
    signed_out(client)
    assert client.get(f"/api/j2/notes/{nid}/share/preview").status_code == 401


def test_the_column_is_added_to_an_older_table_and_old_rows_read_as_not_hidden(db_path):
    from api.services.auth_db import get_connection
    from api.services.journal_two import note_shares
    conn = get_connection()
    cols = {r[1] for r in conn.execute("PRAGMA table_info(j2_note_shares)").fetchall()}
    assert cols, "the j2 schema made the share table"
    if "hide_pnl" in cols:
        # Simulate a table from before S19: rebuild it without the column.
        conn.execute("ALTER TABLE j2_note_shares RENAME TO j2_note_shares_new")
        keep = [c for c in cols if c != "hide_pnl"]
        conn.execute(f"CREATE TABLE j2_note_shares AS SELECT {', '.join(keep)} FROM j2_note_shares_new WHERE 0")
        conn.execute("DROP TABLE j2_note_shares_new")
        conn.commit()
    nid = _note()
    conn.execute("INSERT INTO j2_note_shares (token, note_id, user_id, created_at)"
                 " VALUES ('old-token-s19', ?, ?, '2026-11-01T00:00:00Z')", (nid, A))
    conn.commit()
    note_shares._SCHEMA_READY.clear()
    share = note_shares.get_share(A, nid, conn=conn)
    assert share["token"] == "old-token-s19" and share["hidePnl"] is False
    cols = {r[1] for r in conn.execute("PRAGMA table_info(j2_note_shares)").fetchall()}
    assert {"expires_at", "hide_pnl"} <= cols
    conn.close()


# ── Fix round 1 ─────────────────────────────────────────────────────────────────────────────

def test_I1_asking_to_hide_over_an_existing_SHOWN_link_tightens_it_and_keeps_its_url(client):
    nid = _note()
    as_member(client, A)
    old = client.post(f"/api/j2/notes/{nid}/share", json={"expiresInDays": 7}).json()["share"]
    assert old["hidePnl"] is False                                   # non-vacuity: a link that shows P&L
    again = client.post(f"/api/j2/notes/{nid}/share", json={"expiresInDays": 7, "hidePnl": True}).json()["share"]
    assert again["token"] == old["token"] and again["hidePnl"] is True and again["reused"] is True
    signed_out(client)
    page = client.get(f"/api/j2/shared/{old['token']}").json()["note"]
    assert "4321" not in _text(page) and "250000" not in _text(page)


def test_I1_asking_to_show_over_a_HIDDEN_link_returns_it_hidden_and_says_so_in_the_answer(client):
    nid = _note()
    as_member(client, A)
    old = client.post(f"/api/j2/notes/{nid}/share", json={"expiresInDays": 7, "hidePnl": True}).json()["share"]
    again = client.post(f"/api/j2/notes/{nid}/share", json={"expiresInDays": 7, "hidePnl": False}).json()["share"]
    assert again["token"] == old["token"] and again["hidePnl"] is True and again["reused"] is True
    signed_out(client)
    assert "4321" not in _text(client.get(f"/api/j2/shared/{old['token']}").json()["note"])


def test_I2_text_the_member_typed_is_shared_as_written_even_when_hidden(client):
    """The documented pass-through: the reducer never rewrites the member's words (a figure in a paragraph or a
    table cell travels). The sheet says so ("Text you typed is shared as written.")."""
    from api.services.journal_two import notes
    nid = _note()
    notes.update_note(A, nid, {"bodyJson": {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "Closed NVDA +$4,200 on 500 shares."}]},
        {"type": "table", "content": [{"type": "tableRow", "content": [
            {"type": "tableCell", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "P&L $9,876"}]}]}]}]},
    ]}})
    as_member(client, A)
    tok = client.post(f"/api/j2/notes/{nid}/share", json={"hidePnl": True}).json()["share"]["token"]
    signed_out(client)
    text = _text(client.get(f"/api/j2/shared/{tok}").json()["note"])
    assert "Closed NVDA +$4,200 on 500 shares." in text and "P&L $9,876" in text


def test_I2_the_members_own_stated_fact_is_the_account_line_when_hidden_and_shown_otherwise():
    from api.services.journal_two import public_note_payload as public
    body = {"type": "doc", "content": [{"type": "financialFact", "attrs": {"factId": "f1"}}]}
    facts = {"f1": {"source": "user", "fact_type": "custom", "value_text": "my size: 500 sh", "rights_class": "ok"}}
    kw = dict(mode="share", owner_id=A, note_id="n1", attachment_base="/api/j2/shared/t/att/", facts=facts)
    assert "my size: 500 sh" in json.dumps(public.reduce(body, **kw))                       # CONTROL: shown
    hidden = json.dumps(public.reduce(body, hide_account=True, **kw))
    assert "my size: 500 sh" not in hidden and public.ACCOUNT_NEUTRAL_LINE in hidden


@pytest.fixture
def att_root(tmp_path, monkeypatch):
    from api.services.journal_two import notes as notes_svc
    r = tmp_path / "att"
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", r)
    monkeypatch.setattr(notes_svc, "_read_candidates", lambda rel: [r / rel])
    monkeypatch.setattr(notes_svc, "_read_candidates_with_roots", lambda rel: [(r, r / rel)])
    return r


def _note_with_image(att_root):
    from api.services.journal_two import notes
    nid = _note()
    d = att_root / A / "notes" / nid / "inline"
    d.mkdir(parents=True, exist_ok=True)
    (d / "pnl.png").write_bytes(b"\x89PNG\r\n\x1a\nfake")
    src = f"/api/j2/notes/attachments/{A}/{nid}/inline/pnl.png"
    notes.update_note(A, nid, {"bodyJson": {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "My week."}]},
        {"type": "image", "attrs": {"src": src}},
        {"type": "imageFigure", "content": [{"type": "image", "attrs": {"src": src}},
                                            {"type": "imageCaption", "content": [{"type": "text", "text": "broker P&L"}]}]},
    ]}})
    return nid


def test_I2_a_hidden_link_drops_every_image_behind_one_line_and_its_image_route_serves_nothing(client, att_root):
    from api.services.journal_two.public_note_payload import IMAGE_HIDDEN_LINE
    nid = _note_with_image(att_root)
    as_member(client, A)
    tok = client.post(f"/api/j2/notes/{nid}/share", json={"hidePnl": True}).json()["share"]["token"]
    preview = client.get(f"/api/j2/notes/{nid}/share/preview?hidePnl=true").json()["note"]
    signed_out(client)
    page = client.get(f"/api/j2/shared/{tok}").json()["note"]
    text = _text(page)
    assert "pnl.png" not in text and "broker P&L" not in text and IMAGE_HIDDEN_LINE in text
    assert text.count(IMAGE_HIDDEN_LINE) == 1                         # adjacent lines collapse into one
    assert page["heroImageUrl"] is None
    assert client.get(f"/api/j2/shared/{tok}/att/inline/pnl.png").status_code == 404
    assert preview == page                                            # the preview IS the stranger's read


def test_I2_CONTROL_a_link_that_shows_serves_the_image(client, att_root):
    nid = _note_with_image(att_root)
    as_member(client, A)
    tok = client.post(f"/api/j2/notes/{nid}/share", json={"hidePnl": False}).json()["share"]["token"]
    signed_out(client)
    assert "pnl.png" in _text(client.get(f"/api/j2/shared/{tok}").json()["note"])
    assert client.get(f"/api/j2/shared/{tok}/att/inline/pnl.png").status_code == 200


def test_minor11_settings_lists_each_links_real_setting(client):
    from api.services.journal_two import note_shares
    a, b = _note(), _note()
    as_member(client, A)
    client.post(f"/api/j2/notes/{a}/share", json={"hidePnl": True})
    client.post(f"/api/j2/notes/{b}/share", json={})
    got = {s["noteId"]: s["hidePnl"] for s in note_shares.list_shares(A)}
    assert got == {a: True, b: False}


# ── Fix round 2 ─────────────────────────────────────────────────────────────────────────────

def test_R1_tightening_a_link_404s_its_images_at_once_never_from_the_cached_set(client, att_root):
    from api.services.journal_two import public_note_payload as public
    public._REF_SETS.clear()
    nid = _note_with_image(att_root)
    as_member(client, A)
    tok = client.post(f"/api/j2/notes/{nid}/share", json={"hidePnl": False}).json()["share"]["token"]
    signed_out(client)
    assert client.get(f"/api/j2/shared/{tok}/att/inline/pnl.png").status_code == 200   # primes the 60 s set
    as_member(client, A)
    tight = client.post(f"/api/j2/notes/{nid}/share", json={"hidePnl": True}).json()["share"]
    assert tight["token"] == tok and tight["hidePnl"] is True
    signed_out(client)
    assert client.get(f"/api/j2/shared/{tok}/att/inline/pnl.png").status_code == 404   # at once, not in 60 s


def test_R2_a_link_revoked_between_the_read_and_the_tighten_is_never_answered_as_live(db_path, monkeypatch):
    from api.services.journal_two import note_shares
    nid = _note()
    old = note_shares.create_share(A, nid, hide_pnl=False)
    stale = dict(old)                                      # what the mint read, before a revoke landed
    note_shares.revoke_share(A, nid)
    real = note_shares.get_share
    calls = {"n": 0}

    def racing(user_id, note_id, conn=None):
        calls["n"] += 1
        return stale if calls["n"] == 1 else real(user_id, note_id, conn=conn)
    monkeypatch.setattr(note_shares, "get_share", racing)
    got = note_shares.create_share(A, nid, hide_pnl=True)
    assert got["token"] != old["token"]                    # a new, live link -- never the dead URL "copied"
    assert got["hidePnl"] is True
    from api.services.auth_db import get_connection
    conn = get_connection()
    row = conn.execute("SELECT hide_pnl, revoked_at FROM j2_note_shares WHERE token = ?", (old["token"],)).fetchone()
    conn.close()
    assert row["revoked_at"] is not None and row["hide_pnl"] == 0   # the dead row was not touched


def test_R3_a_hidden_link_carries_no_link_card_picture_and_no_widget_fallback_image():
    from api.services.journal_two import public_note_payload as public
    own = f"/api/j2/notes/attachments/{A}/n1/inline/shot.png"
    body = {"type": "doc", "content": [
        {"type": "linkPreview", "attrs": {"url": "https://example.com/a", "title": "A page", "image": own}},
        {"type": "widgetEmbed", "attrs": {"v": 1, "widgetId": "fundamentals", "mode": "snapshot",
                                          "params": {"symbol": "NVDA"}, "fallback": {"url": own, "w": 10, "h": 10}}},
    ]}
    kw = dict(mode="share", owner_id=A, note_id="n1", attachment_base="/api/j2/shared/t/att/")
    shown = json.dumps(public.reduce(body, **kw))
    assert "/api/j2/shared/t/att/inline/shot.png" in shown                 # CONTROL: both travel on a showing link
    hidden = json.dumps(public.reduce(body, hide_account=True, **kw))
    assert "att/" not in hidden and "shot.png" not in hidden
    assert public.referenced_images(public.reduce(body, hide_account=True, **kw), "/api/j2/shared/t/att/") == frozenset()
