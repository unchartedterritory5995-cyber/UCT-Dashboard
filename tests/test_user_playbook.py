"""HTTP-level tests for the My Playbook backend (/api/upb).

Spins up a minimal FastAPI app with just the upb router against a temp
auth.db (the broker-router test pattern), overrides get_current_user,
and exercises CRUD, cross-user isolation, cascades, caps, note-link
ownership/liveness, clone-setup idempotency, and partial-patch PUTs.
"""

from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import auth_db
from api.services.journal_two.db import ensure_schema as j2_ensure_schema
from api.services.journal_two import notes as notes_service
from api.services.user_playbook import service as upb_service
from api.services.user_playbook.db import ensure_schema as upb_ensure_schema
from api.middleware import auth_middleware as authmw
from api.routers import user_playbook as upb_router

USER_A = "userA"
USER_B = "userB"


@pytest.fixture
def client(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))  # j2 migration flag files
    conn = auth_db.get_connection()
    j2_ensure_schema(conn)  # j2_notes — the note-link target
    upb_ensure_schema(conn)
    conn.close()

    app = FastAPI()
    app.include_router(upb_router.router)
    app.dependency_overrides[authmw.get_current_user] = lambda: {"id": USER_A, "role": "member"}

    c = TestClient(app)
    c._app = app  # expose for per-test user switching
    yield c


def _as_user(client, user_id):
    client._app.dependency_overrides[authmw.get_current_user] = (
        lambda: {"id": user_id, "role": "member"}
    )


def _doc(text="hello world"):
    return {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": text}]}
        ],
    }


def _mk_section(client, title="Breakouts", **kw):
    r = client.post("/api/upb/sections", json={"title": title, **kw})
    assert r.status_code == 200, r.text
    return r.json()["section"]


def _mk_entry(client, section_id, title="HTF study", body=None):
    r = client.post(
        f"/api/upb/sections/{section_id}/entries",
        json={"title": title, "body_json": body or _doc()},
    )
    assert r.status_code == 200, r.text
    return r.json()["entry"]


def _mk_chart(client, entry_id, symbol="NVDA", **kw):
    r = client.post(
        f"/api/upb/entries/{entry_id}/charts",
        json={"symbol": symbol, **kw},
    )
    assert r.status_code == 200, r.text
    return r.json()["chart"]


# ── CRUD happy paths ─────────────────────────────────────────────────────────

def test_overview_empty(client):
    r = client.get("/api/upb/overview")
    assert r.status_code == 200
    body = r.json()
    assert body["sections"] == []
    assert body["totals"] == {"sections": 0, "entries": 0, "charts": 0}


def test_section_crud(client):
    sec = _mk_section(client, title="Breakouts", blurb="my best", accent="green")
    assert sec["title"] == "Breakouts"
    assert sec["accent"] == "green"

    r = client.put(f"/api/upb/sections/{sec['id']}", json={"title": "Bases"})
    assert r.status_code == 200
    updated = r.json()["section"]
    assert updated["title"] == "Bases"
    assert updated["blurb"] == "my best"  # untouched by partial patch

    assert client.delete(f"/api/upb/sections/{sec['id']}").status_code == 200
    assert client.get("/api/upb/overview").json()["totals"]["sections"] == 0
    # Second delete → 404.
    assert client.delete(f"/api/upb/sections/{sec['id']}").status_code == 404


def test_section_invalid_accent_rejected(client):
    r = client.post("/api/upb/sections", json={"title": "X", "accent": "magenta"})
    assert r.status_code == 400
    sec = _mk_section(client)
    r = client.put(f"/api/upb/sections/{sec['id']}", json={"accent": "hotpink"})
    assert r.status_code == 400


def test_entry_crud_and_lean_list(client):
    sec = _mk_section(client)
    long_text = "x" * 500
    entry = _mk_entry(client, sec["id"], title="Long one", body=_doc(long_text))
    assert entry["body_plain"] == long_text

    r = client.get(f"/api/upb/sections/{sec['id']}/entries")
    assert r.status_code == 200
    rows = r.json()["entries"]
    assert len(rows) == 1
    lean = rows[0]
    assert lean["title"] == "Long one"
    assert lean["snippet"] == long_text[:200]  # body_plain truncated to 200
    assert "body_json" not in lean  # lean rows only
    assert lean["chart_count"] == 0
    assert lean["note_link_count"] == 0

    detail = client.get(f"/api/upb/entries/{entry['id']}").json()["entry"]
    assert detail["body_json"]["type"] == "doc"
    assert detail["charts"] == []
    assert detail["note_links"] == []

    assert client.delete(f"/api/upb/entries/{entry['id']}").status_code == 200
    assert client.get(f"/api/upb/entries/{entry['id']}").status_code == 404


def test_chart_crud(client):
    sec = _mk_section(client)
    entry = _mk_entry(client, sec["id"])
    chart = _mk_chart(
        client, entry["id"],
        symbol="nvda ",  # normalized upper().strip()
        timeframe="W", year=2024, label_date="2024-03-14",
        entry_price=120.0, stop_price=110.0, target_price=150.0,
        grade="A+", notes="textbook", scale_mode="log",
        drawings_json=json.dumps([{"type": "trendline"}]),
    )
    assert chart["symbol"] == "NVDA"
    assert chart["timeframe"] == "W"
    assert chart["grade"] == "A+"
    assert json.loads(chart["drawings_json"]) == [{"type": "trendline"}]

    detail = client.get(f"/api/upb/entries/{entry['id']}").json()["entry"]
    assert [c["id"] for c in detail["charts"]] == [chart["id"]]

    r = client.put(f"/api/upb/charts/{chart['id']}", json={"grade": "B"})
    assert r.status_code == 200
    assert r.json()["chart"]["grade"] == "B"

    assert client.delete(f"/api/upb/charts/{chart['id']}").status_code == 200
    assert client.delete(f"/api/upb/charts/{chart['id']}").status_code == 404


def test_chart_validation_rejects_bad_fields(client):
    sec = _mk_section(client)
    entry = _mk_entry(client, sec["id"])
    base = f"/api/upb/entries/{entry['id']}/charts"
    assert client.post(base, json={"symbol": "BAD SYM!"}).status_code == 400
    assert client.post(base, json={"symbol": "NVDA", "timeframe": "H"}).status_code == 400
    assert client.post(base, json={"symbol": "NVDA", "grade": "S"}).status_code == 400
    assert client.post(base, json={"symbol": "NVDA", "label_date": "03/14/2024"}).status_code == 400
    assert client.post(base, json={"symbol": "NVDA", "year": 1850}).status_code == 400
    assert client.post(base, json={"symbol": "NVDA", "scale_mode": "linear"}).status_code == 400
    assert client.post(base, json={"symbol": "NVDA", "notes": "x" * 5001}).status_code == 400


def test_overview_counts(client):
    s1 = _mk_section(client, title="One")
    s2 = _mk_section(client, title="Two")
    e1 = _mk_entry(client, s1["id"])
    e2 = _mk_entry(client, s1["id"], title="second")
    _mk_chart(client, e1["id"])
    _mk_chart(client, e1["id"], symbol="PLTR")
    _mk_chart(client, e2["id"], symbol="SMCI")

    body = client.get("/api/upb/overview").json()
    by_id = {s["id"]: s for s in body["sections"]}
    assert by_id[s1["id"]]["entry_count"] == 2
    assert by_id[s1["id"]]["chart_count"] == 3
    assert by_id[s2["id"]]["entry_count"] == 0
    assert by_id[s2["id"]]["chart_count"] == 0
    assert body["totals"] == {"sections": 2, "entries": 2, "charts": 3}


# ── Cross-user isolation ─────────────────────────────────────────────────────

def test_cross_user_isolation(client):
    sec = _mk_section(client)
    entry = _mk_entry(client, sec["id"])
    chart = _mk_chart(client, entry["id"])

    _as_user(client, USER_B)
    # Reads
    assert client.get(f"/api/upb/sections/{sec['id']}/entries").status_code == 404
    assert client.get(f"/api/upb/entries/{entry['id']}").status_code == 404
    # Writes on A's rows
    assert client.put(f"/api/upb/sections/{sec['id']}", json={"title": "hax"}).status_code == 404
    assert client.delete(f"/api/upb/sections/{sec['id']}").status_code == 404
    assert client.post(f"/api/upb/sections/{sec['id']}/entries", json={"title": "hax"}).status_code == 404
    assert client.put(f"/api/upb/entries/{entry['id']}", json={"title": "hax"}).status_code == 404
    assert client.delete(f"/api/upb/entries/{entry['id']}").status_code == 404
    assert client.post(f"/api/upb/entries/{entry['id']}/charts", json={"symbol": "EVIL"}).status_code == 404
    assert client.put(f"/api/upb/charts/{chart['id']}", json={"grade": "F"}).status_code == 404
    assert client.delete(f"/api/upb/charts/{chart['id']}").status_code == 404
    assert client.put(f"/api/upb/entries/{entry['id']}/note-links", json={"note_ids": []}).status_code == 404
    # B's overview is untouched.
    assert client.get("/api/upb/overview").json()["totals"]["sections"] == 0

    # A's data survived the attempts intact.
    _as_user(client, USER_A)
    detail = client.get(f"/api/upb/entries/{entry['id']}").json()["entry"]
    assert detail["title"] == "HTF study"
    assert detail["charts"][0]["grade"] is None


# ── Cascade delete ───────────────────────────────────────────────────────────

def test_section_delete_cascades_to_entries_charts_links(client):
    note = notes_service.create_note(USER_A, {"title": "linked note"})
    sec = _mk_section(client)
    entry = _mk_entry(client, sec["id"])
    _mk_chart(client, entry["id"])
    r = client.put(
        f"/api/upb/entries/{entry['id']}/note-links",
        json={"note_ids": [note["id"]]},
    )
    assert r.status_code == 200

    assert client.delete(f"/api/upb/sections/{sec['id']}").status_code == 200

    conn = auth_db.get_connection()
    try:
        for table in ("upb_sections", "upb_entries", "upb_charts", "upb_note_links"):
            n = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            assert n == 0, f"{table} not cascaded"
        # The Notebook note itself is NOT touched (soft ref only).
        assert conn.execute("SELECT COUNT(*) FROM j2_notes").fetchone()[0] == 1
    finally:
        conn.close()


# ── Caps ─────────────────────────────────────────────────────────────────────

def test_section_count_cap(client):
    for i in range(upb_service.MAX_SECTIONS_PER_USER):
        _mk_section(client, title=f"Section {i}")
    r = client.post("/api/upb/sections", json={"title": "one too many"})
    assert r.status_code == 400
    assert "limit" in r.json()["detail"].lower()
    # Another user is unaffected by A's cap.
    _as_user(client, USER_B)
    assert client.post("/api/upb/sections", json={"title": "mine"}).status_code == 200


def test_entries_per_user_cap(client, monkeypatch):
    monkeypatch.setattr(upb_service, "MAX_ENTRIES_PER_USER", 2)
    sec = _mk_section(client)
    _mk_entry(client, sec["id"], title="one")
    _mk_entry(client, sec["id"], title="two")
    r = client.post(f"/api/upb/sections/{sec['id']}/entries", json={"title": "three"})
    assert r.status_code == 400


def test_body_json_byte_cap(client):
    sec = _mk_section(client)
    huge = _doc("x" * (upb_service.MAX_BODY_JSON_BYTES + 100))
    r = client.post(
        f"/api/upb/sections/{sec['id']}/entries",
        json={"title": "huge", "body_json": huge},
    )
    assert r.status_code == 400
    # Non-doc shape also rejected.
    r = client.post(
        f"/api/upb/sections/{sec['id']}/entries",
        json={"title": "bad", "body_json": {"type": "paragraph"}},
    )
    assert r.status_code == 400


def test_drawings_object_and_byte_caps(client):
    sec = _mk_section(client)
    entry = _mk_entry(client, sec["id"])
    base = f"/api/upb/entries/{entry['id']}/charts"

    too_many = json.dumps([{"i": i} for i in range(upb_service.MAX_DRAWING_OBJECTS + 1)])
    r = client.post(base, json={"symbol": "NVDA", "drawings_json": too_many})
    assert r.status_code == 400

    too_big = json.dumps([{"points": "p" * (upb_service.MAX_DRAWINGS_BYTES + 100)}])
    r = client.post(base, json={"symbol": "NVDA", "result_drawings_json": too_big})
    assert r.status_code == 400

    not_a_list = json.dumps({"type": "trendline"})
    r = client.post(base, json={"symbol": "NVDA", "drawings_json": not_a_list})
    assert r.status_code == 400

    # Same validators on the partial PUT path (the annotate save).
    chart = _mk_chart(client, entry["id"])
    r = client.put(f"/api/upb/charts/{chart['id']}", json={"drawings_json": too_many})
    assert r.status_code == 400


def test_charts_per_entry_cap(client):
    sec = _mk_section(client)
    entry = _mk_entry(client, sec["id"])
    for i in range(upb_service.MAX_CHARTS_PER_ENTRY):
        _mk_chart(client, entry["id"], symbol=f"T{i}")
    r = client.post(
        f"/api/upb/entries/{entry['id']}/charts", json={"symbol": "OVER"}
    )
    assert r.status_code == 400


def test_note_links_cap(client):
    sec = _mk_section(client)
    entry = _mk_entry(client, sec["id"])
    ids = [
        notes_service.create_note(USER_A, {"title": f"n{i}"})["id"]
        for i in range(upb_service.MAX_NOTE_LINKS_PER_ENTRY + 1)
    ]
    r = client.put(f"/api/upb/entries/{entry['id']}/note-links", json={"note_ids": ids})
    assert r.status_code == 400
    # Exactly at the cap is fine.
    r = client.put(
        f"/api/upb/entries/{entry['id']}/note-links",
        json={"note_ids": ids[: upb_service.MAX_NOTE_LINKS_PER_ENTRY]},
    )
    assert r.status_code == 200


# ── Note links: ownership + liveness ─────────────────────────────────────────

def test_note_link_ownership_rejected(client):
    other = notes_service.create_note(USER_B, {"title": "not yours"})
    sec = _mk_section(client)
    entry = _mk_entry(client, sec["id"])
    r = client.put(
        f"/api/upb/entries/{entry['id']}/note-links",
        json={"note_ids": [other["id"]]},
    )
    assert r.status_code == 400


def test_note_links_replace_set_and_liveness(client):
    n1 = notes_service.create_note(USER_A, {"title": "Alpha"})
    n2 = notes_service.create_note(USER_A, {"title": "Beta"})
    sec = _mk_section(client)
    entry = _mk_entry(client, sec["id"])

    r = client.put(
        f"/api/upb/entries/{entry['id']}/note-links",
        json={"note_ids": [n1["id"], n2["id"]]},
    )
    assert r.status_code == 200
    links = r.json()["note_links"]
    assert [(l["noteId"], l["title"], l["live"]) for l in links] == [
        (n1["id"], "Alpha", True),
        (n2["id"], "Beta", True),
    ]

    # Replace-set: shrink to just n2.
    r = client.put(
        f"/api/upb/entries/{entry['id']}/note-links",
        json={"note_ids": [n2["id"]]},
    )
    assert [l["noteId"] for l in r.json()["note_links"]] == [n2["id"]]

    # Delete the target note → link goes dead but keeps the snapshot title.
    notes_service.delete_note(USER_A, n2["id"])
    detail = client.get(f"/api/upb/entries/{entry['id']}").json()["entry"]
    assert detail["note_links"] == [
        {"noteId": n2["id"], "title": "Beta", "live": False}
    ]


# ── Clone setup ──────────────────────────────────────────────────────────────

def test_clone_setup_find_or_create_idempotent(client):
    r = client.post("/api/upb/clone-setup", json={"setup_name": "High Tight Flag (Powerplay)"})
    assert r.status_code == 200
    first = r.json()
    assert first["section"]["title"] == "My Setups"
    assert first["entry"]["title"] == "High Tight Flag (Powerplay)"
    # Scaffold body carries the three prompt headings.
    plain = first["entry"]["body_plain"]
    for prompt in ("When I trade this", "My entry criteria", "My mistakes"):
        assert prompt in plain

    r2 = client.post("/api/upb/clone-setup", json={"setup_name": "VCP"})
    assert r2.status_code == 200
    second = r2.json()
    # Find-or-create: the SAME section is reused, no duplicate 'My Setups'.
    assert second["section"]["id"] == first["section"]["id"]

    body = client.get("/api/upb/overview").json()
    titles = [s["title"] for s in body["sections"]]
    assert titles.count("My Setups") == 1
    assert body["totals"] == {"sections": 1, "entries": 2, "charts": 0}


def test_clone_setup_requires_name(client):
    assert client.post("/api/upb/clone-setup", json={"setup_name": "  "}).status_code == 400


# ── PUT partial-patch semantics ──────────────────────────────────────────────

def test_entry_put_partial_does_not_null_unsent_fields(client):
    sec = _mk_section(client)
    entry = _mk_entry(client, sec["id"], title="Keep body", body=_doc("precious words"))

    r = client.put(f"/api/upb/entries/{entry['id']}", json={"title": "Renamed"})
    assert r.status_code == 200
    updated = r.json()["entry"]
    assert updated["title"] == "Renamed"
    assert updated["body_plain"] == "precious words"  # body untouched

    # body_json-only PUT re-extracts body_plain and keeps the title.
    r = client.put(
        f"/api/upb/entries/{entry['id']}", json={"body_json": _doc("new words")}
    )
    updated = r.json()["entry"]
    assert updated["title"] == "Renamed"
    assert updated["body_plain"] == "new words"


def test_chart_put_partial_annotate_save(client):
    sec = _mk_section(client)
    entry = _mk_entry(client, sec["id"])
    chart = _mk_chart(
        client, entry["id"],
        symbol="NVDA", grade="A", entry_price=120.0, label_date="2024-03-14",
    )
    # The annotate save: PUT ONLY the drawings field.
    draft = json.dumps([{"type": "hray", "y": 118.2}])
    r = client.put(f"/api/upb/charts/{chart['id']}", json={"drawings_json": draft})
    assert r.status_code == 200
    updated = r.json()["chart"]
    assert json.loads(updated["drawings_json"]) == [{"type": "hray", "y": 118.2}]
    # Everything else survives.
    assert updated["symbol"] == "NVDA"
    assert updated["grade"] == "A"
    assert updated["entry_price"] == 120.0
    assert updated["label_date"] == "2024-03-14"
    assert updated["result_drawings_json"] is None


# ── Admin stats ───────────────────────────────────────────────────────────────

def test_admin_stats_gated_and_counts(client):
    sec = _mk_section(client)
    ent = _mk_entry(client, sec["id"])
    _mk_chart(client, ent["id"])

    # member role → 403 (require_admin chains through get_current_user)
    r = client.get("/api/upb/admin/stats")
    assert r.status_code == 403

    client._app.dependency_overrides[authmw.get_current_user] = (
        lambda: {"id": "adminuser", "role": "admin"}
    )
    r = client.get("/api/upb/admin/stats")
    assert r.status_code == 200
    j = r.json()
    assert j["builders"] == 1
    assert j["sections"] == 1 and j["entries"] == 1 and j["charts"] == 1
    assert j["body_bytes"] > 0
