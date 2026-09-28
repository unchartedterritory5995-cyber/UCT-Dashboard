"""The quick switcher's body half (wave 10, follow-up F6).

The switcher answered titles only, and on the labelled set (docs/notebook/search-recall-set.json)
it found 0.41 of what a member was looking for against the search box's 0.88: 25 of its 28
misses were notes whose words are in the body (docs/notebook/switcher-recall-diagnosis.md).
When the title tiers leave room on the page, `notes.switcher_search` now fills it from the
search box's own relevance pass (`list_notes(q, sort="relevance")`), below every title.

What each rail pins:
  * the body half IS the search box's order: a differential over randomized libraries --
    title rows, then the search box's answer minus those, cut to the page -- never a
    second ranking;
  * titles stay first, and a body row is never `strong` or `exact`, so the palette keeps it
    under the tickers;
  * member isolation: another member's, a trashed and an archived note are never offered
    by the body half, each with a control proving the same words ARE found on the
    member's own live note;
  * it counts no search (no `notebook_search_used` per palette keystroke), with the search
    box's own call as the control;
  * a page the titles already fill never pays for the body pass.
Every rail here was mutation-proved red (recorded in the lane report).
"""
from __future__ import annotations

import json
import random
import sqlite3
import uuid

import pytest

from api.services.journal_two import db as j2db
from api.services.journal_two import notes as notes_svc

A, B = "member_a", "member_b"
_TS = "2026-09-{:02d}T{:02d}:00:00+00:00"


def _conn(tmp_path, name="sw.db"):
    c = sqlite3.connect(str(tmp_path / name))
    c.row_factory = sqlite3.Row
    j2db.ensure_schema(c)
    return c


def _add(c, user, title, body="", *, day=1, hour=0, deleted=False, archived=False, tags=None, ticker=None):
    nid = uuid.uuid4().hex
    ts = _TS.format(day, hour)
    doc = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": body}]}]}
    c.execute("INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags, ticker, created_at,"
              " updated_at, deleted_at, archived_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
              (nid, user, title, json.dumps(doc), body, json.dumps(tags or []), ticker, ts, ts,
               ts if deleted else None, ts if archived else None))
    c.commit()
    return nid


@pytest.fixture(autouse=True)
def _no_activity_writes(monkeypatch):
    """The search box's event goes to auth.db; these tests count it instead."""
    calls = []
    monkeypatch.setattr(notes_svc, "_log_notebook_event", lambda *a, **k: calls.append(a[1] if len(a) > 1 else None))
    return calls


def _ids(answer):
    return [n["id"] for n in answer["notes"]]


# ── the body half is the search box's order, derived ────────────────────────

_WORDS = ["breakout", "pullback", "volume", "earnings", "guidance", "semis", "rotation", "stop",
          "trim", "trimmed", "hedge", "puts", "nvda", "margin", "base", "pivot", "gap", "range"]


def _library(tmp_path, seed, n):
    rng = random.Random(seed)
    c = _conn(tmp_path, f"lib{seed}.db")
    for _ in range(n):
        user = A if rng.random() < 0.85 else B
        title = " ".join(rng.choice(_WORDS) for _ in range(rng.randint(1, 3))) if rng.random() < 0.9 else ""
        body = " ".join(rng.choice(_WORDS) for _ in range(rng.randint(0, 25)))
        roll = rng.random()
        _add(c, user, title, body, day=1 + rng.randint(0, 20), hour=rng.randint(0, 3),
             deleted=roll < 0.05, archived=0.05 <= roll < 0.1,
             tags=rng.sample(["setup", "review", "macro"], k=rng.randint(0, 1)),
             ticker=rng.choice([None, None, "NVDA", "AMD"]))
    return c, rng


@pytest.mark.parametrize("seed,n", [(11, 120), (12, 400), (13, 60)])
def test_the_body_half_is_the_search_boxs_order_below_the_titles(tmp_path, seed, n):
    c, rng = _library(tmp_path, seed, n)
    try:
        queries = ["breakout", "pullback volume", "trim", "hedge puts", "semis rotation", "nvda",
                   "margin", "piv", "guidance earnings", "setup", "zzqnothing"]
        queries += [rng.choice(_WORDS)[: rng.randint(3, 8)] for _ in range(12)]
        compared = filled = 0
        for q in queries:
            for limit in (1, 3, 8, 50):
                got = notes_svc.switcher_search(A, q, limit=limit, conn=c)
                titles = notes_svc._switcher_title_search(A, q, limit, conn=c)
                title_ids = _ids(titles)
                box, _total = notes_svc.list_and_count_notes(A, q=q, sort="relevance", limit=500, conn=c)
                rest = [r["id"] for r in box if r["id"] not in set(title_ids)]
                room = 0 if titles["hasMore"] else limit - len(title_ids)
                want = title_ids + rest[:room]
                assert _ids(got) == want, (q, limit)
                # a page the titles fill does not ask the body half, so there `hasMore` is the titles'
                assert got["hasMore"] == (titles["hasMore"] or (room > 0 and len(rest) > room)), (q, limit)
                assert all(r["matchTier"] == notes_svc.SWITCHER_TIER_BODY and not r["strong"] and not r["exact"]
                           for r in got["notes"][len(title_ids):]), (q, limit)
                assert all(r["matchTier"] < notes_svc.SWITCHER_TIER_BODY and r["matched"] == "title"
                           for r in got["notes"][:len(title_ids)])
                assert all(r["matched"] == "text" for r in got["notes"][len(title_ids):])
                assert got["prefixExhausted"] is False
                compared += 1
                filled += len(got["notes"]) > len(title_ids)
        # non-vacuity: the corpus really reached body rows, and many of them
        assert compared == 4 * len(queries) and filled >= compared // 4, (compared, filled)
    finally:
        c.close()


def test_a_body_row_carries_the_same_fields_as_a_title_row(tmp_path):
    c = _conn(tmp_path)
    fid = notes_svc.create_folder(A, "Research", conn=c)["id"]
    nid = _add(c, A, "Weekly plan", "The data center revenue line carried the quarter.", ticker="NVDA")
    c.execute("UPDATE j2_notes SET folder_id = ? WHERE id = ?", (fid, nid))
    c.execute("INSERT INTO j2_note_favorites (user_id, note_id, created_at) VALUES (?,?,?)", (A, nid, _TS.format(1, 0)))
    c.execute("INSERT INTO j2_note_recents (user_id, note_id, opened_at) VALUES (?,?,?)", (A, nid, _TS.format(2, 0)))
    c.commit()
    got = notes_svc.switcher_search(A, "data center revenue", conn=c)
    assert got["notes"] == [{
        "id": nid, "title": "Weekly plan", "folderId": fid, "folderPath": "Research", "ticker": "NVDA",
        "updatedAt": _TS.format(1, 0), "isRecent": True, "isFavorite": True,
        "matchTier": notes_svc.SWITCHER_TIER_BODY, "strong": False, "exact": False, "matched": "text",
    }]
    title_row = notes_svc.switcher_search(A, "weekly plan", conn=c)["notes"][0]
    assert set(title_row) == set(got["notes"][0])
    assert title_row["matched"] == "title", "control: a title row says it matched the title"
    c.close()


def test_a_title_leads_a_body_match_even_when_the_search_box_ranks_the_body_first(tmp_path):
    c = _conn(tmp_path)
    body_heavy = _add(c, A, "Daily note", "breakout breakout breakout breakout", day=5)
    titled = _add(c, A, "Breakout journal", "", day=1)
    box, _ = notes_svc.list_and_count_notes(A, q="breakout", sort="relevance", limit=10, conn=c)
    assert [r["id"] for r in box][0] == body_heavy      # the control: the search box puts the body first
    got = notes_svc.switcher_search(A, "breakout", conn=c)
    assert _ids(got) == [titled, body_heavy]
    assert got["notes"][0]["strong"] is True and got["notes"][1]["strong"] is False
    c.close()


# ── member isolation ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("case", ["another member", "trashed", "archived"])
def test_the_body_half_never_offers_a_note_the_switcher_would_not(tmp_path, case):
    c = _conn(tmp_path)
    phrase = "inventory draw surprised"
    own = _add(c, A, "Crude oil note", phrase)                      # the control: found
    if case == "another member":
        hidden = _add(c, B, "Their oil note", phrase)
    else:
        hidden = _add(c, A, "My old oil note", phrase, deleted=case == "trashed", archived=case == "archived")
    got = notes_svc.switcher_search(A, "inventory draw", limit=50, conn=c)
    assert own in _ids(got), "control: the words are found on the member's own live note"
    assert hidden not in _ids(got), case
    if case == "another member":
        theirs = notes_svc.switcher_search(B, "inventory draw", limit=50, conn=c)
        assert _ids(theirs) == [hidden]
    c.close()


def test_the_route_scopes_the_body_half_to_the_signed_in_member(tmp_path, monkeypatch):
    """Two members through the real route: each finds only their own body match."""
    import importlib
    import os
    import tempfile
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.middleware import auth_middleware as authmw
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    from api.routers import journal_two as router
    app = FastAPI()
    app.include_router(router.router)
    client = TestClient(app)
    doc = {"type": "doc", "content": [{"type": "paragraph", "content": [
        {"type": "text", "text": "Net interest income beat the street."}]}]}
    made = {}
    try:
        for user in (A, B):
            app.dependency_overrides[authmw.get_current_user] = lambda u=user: {"id": u, "role": "member"}
            r = client.post("/api/j2/notes", json={"title": f"Bank earnings {user}", "bodyJson": doc})
            assert r.status_code == 200, r.text
            made[user] = r.json()["note"]["id"]
        for user in (A, B):
            app.dependency_overrides[authmw.get_current_user] = lambda u=user: {"id": u, "role": "member"}
            body = client.get("/api/j2/notes/switcher", params={"q": "net interest income"}).json()
            assert [n["id"] for n in body["notes"]] == [made[user]], user
            assert body["notes"][0]["matchTier"] == notes_svc.SWITCHER_TIER_BODY
    finally:
        app.dependency_overrides.clear()
        os.unlink(tmp.name)


# ── cost and telemetry ───────────────────────────────────────────────────────

def test_the_body_half_counts_no_search(tmp_path, _no_activity_writes):
    c = _conn(tmp_path)
    _add(c, A, "CPI print prep", "Core inflation is the number that matters.")
    got = notes_svc.switcher_search(A, "core inflation", conn=c)
    assert len(got["notes"]) == 1 and got["notes"][0]["matchTier"] == notes_svc.SWITCHER_TIER_BODY
    assert _no_activity_writes == []
    notes_svc.list_and_count_notes(A, q="core inflation", sort="relevance", limit=10, conn=c)
    assert _no_activity_writes == ["notebook_search_used"], "control: the search box itself counts one"
    c.close()


def test_a_page_the_titles_fill_never_runs_the_body_pass(tmp_path, monkeypatch):
    c = _conn(tmp_path)
    for i in range(4):
        _add(c, A, f"Journal {i}", "journal body")
    asked = []
    real = notes_svc.list_notes
    monkeypatch.setattr(notes_svc, "list_notes", lambda *a, **k: asked.append(k.get("q")) or real(*a, **k))
    full = notes_svc.switcher_search(A, "journal", limit=3, conn=c)
    assert len(full["notes"]) == 3 and full["hasMore"] is True and asked == []
    notes_svc.switcher_search(A, "journal", limit=8, conn=c)
    assert asked == ["journal"], "control: a page with room does ask"
    c.close()


def test_a_short_or_symbol_only_query_never_runs_the_body_pass(tmp_path, monkeypatch):
    c = _conn(tmp_path)
    _add(c, A, "Anything", "ab cd @@@ ab")
    asked = []
    real = notes_svc.list_notes
    monkeypatch.setattr(notes_svc, "list_notes", lambda *a, **k: asked.append(k.get("q")) or real(*a, **k))
    for q in ("ab", "a b", "@@", "@@@", "---"):
        notes_svc.switcher_search(A, q, conn=c)
    assert asked == [], asked
    notes_svc.switcher_search(A, "abc", conn=c)
    assert asked == ["abc"], "control: three letters do ask"
    c.close()
