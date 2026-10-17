"""The `j2_note_checkins` sidecar (P2 Tier 3, Task 4): one row per mood and focus check-in block.

`notes._sync_note_sidecars` collects every `widgetEmbed` whose `widgetId` is `moodCheckIn` in the
one walk it already makes, and rebuilds the note's rows inside the caller's transaction (DELETE,
then an executemany insert), the same shape as `j2_note_mentions`. A block is kept only when its
`day` is a real `YYYY-MM-DD` date, at least one of mood / focus is a level, and it has an
`embedId`. Anything else is skipped and the note still saves.

Ruling R-T3-V3: trash and restore leave every sidecar alone (a trashed note is excluded by the
`j2_notes.deleted_at IS NULL` join, and counts again on restore). Hard delete removes the rows
explicitly, beside embeds and mentions. The account purge removes the member's rows by name.

⛔ ONE FACT IN TWO FILES: the levels the server accepts are the levels the client's
`nextCheckinParams` keeps (`lib/blocks/checkinWords.js`). The client's answer is read by RUNNING
that module through Node, never retyped here.
"""
from __future__ import annotations

import importlib
import json
import os
import shutil
import sqlite3
import subprocess
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

REPO = Path(__file__).resolve().parents[1]
CLIENT_WORDS = REPO / "app" / "src" / "pages" / "journal-2-0" / "lib" / "blocks" / "checkinWords.js"


# ── fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture
def conn():
    from api.services.journal_two.db import ensure_schema
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    yield c
    c.close()


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


@pytest.fixture
def client(db_path):
    from api.middleware import auth_middleware as authmw
    from api.routers import journal_two as journal_two_router
    app = FastAPI()
    app.include_router(journal_two_router.router)
    app.dependency_overrides[authmw.get_current_user] = lambda: {"id": "u1", "role": "member"}
    yield TestClient(app)
    app.dependency_overrides.clear()


# ── helpers ──────────────────────────────────────────────────────────────────

def _checkin(mood="", focus="", day="", embed_id="ci-1", widget_id="moodCheckIn"):
    """A check-in node in the shape the server's own builder makes (trader_blocks._node)."""
    return {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": widget_id, "embedId": embed_id, "mode": "snapshot",
        "params": {"mood": mood, "focus": focus, "day": day},
        "searchText": "[mood and focus check-in]",
    }}


def _doc(*nodes):
    return {"type": "doc", "content": list(nodes)}


def _rows(conn, note_id):
    return [dict(r) for r in conn.execute(
        "SELECT embed_id, user_id, day, mood, focus FROM j2_note_checkins"
        " WHERE note_id = ? ORDER BY embed_id", (note_id,)).fetchall()]


def _live_rows(conn, user_id):
    """What a reader sees: check-ins joined to their LIVE note (the R-T3-V3 trash rule)."""
    return [dict(r) for r in conn.execute(
        "SELECT c.note_id, c.day, c.mood, c.focus FROM j2_note_checkins c"
        " JOIN j2_notes n ON n.id = c.note_id"
        " WHERE c.user_id = ? AND n.deleted_at IS NULL ORDER BY c.note_id", (user_id,)).fetchall()]


def _note(conn, *nodes, user_id="u1", title="Day"):
    from api.services.journal_two import notes as svc
    return svc.create_note(user_id, {"title": title, "bodyJson": _doc(*nodes)}, conn=conn)


# ── 1. one block, one row ────────────────────────────────────────────────────

def test_a_check_in_block_saves_one_row(conn):
    n = _note(conn, _checkin(mood="4", focus="", day="2026-10-17"))
    assert _rows(conn, n["id"]) == [
        {"embed_id": "ci-1", "user_id": "u1", "day": "2026-10-17", "mood": 4, "focus": None}]
    created = conn.execute("SELECT created_at FROM j2_note_checkins WHERE note_id = ?",
                           (n["id"],)).fetchone()[0]
    assert isinstance(created, str) and created                           # NOT NULL, a real stamp


def test_only_the_check_in_widget_is_recorded(conn):
    """A different widget that happens to carry mood / focus / day params is not a check-in."""
    n = _note(conn, _checkin(mood="4", day="2026-10-17", widget_id="chart"),
              _checkin(mood="2", focus="5", day="2026-10-16", embed_id="ci-2"))
    assert _rows(conn, n["id"]) == [
        {"embed_id": "ci-2", "user_id": "u1", "day": "2026-10-16", "mood": 2, "focus": 5}]


def test_a_nested_block_and_two_blocks_are_each_recorded(conn):
    """The walk is the sidecar walk: a check-in inside another node is found, and each block is
    its own row, keyed by its embedId."""
    nested = {"type": "blockquote", "content": [_checkin(focus="3", day="2026-10-15", embed_id="ci-b")]}
    n = _note(conn, _checkin(mood="1", day="2026-10-14", embed_id="ci-a"), nested)
    assert _rows(conn, n["id"]) == [
        {"embed_id": "ci-a", "user_id": "u1", "day": "2026-10-14", "mood": 1, "focus": None},
        {"embed_id": "ci-b", "user_id": "u1", "day": "2026-10-15", "mood": None, "focus": 3}]


# ── 2. re-save rebuilds, never duplicates ────────────────────────────────────

def test_resaving_rebuilds_the_row_and_never_duplicates_it(conn):
    from api.services.journal_two import notes as svc
    n = _note(conn, _checkin(mood="4", day="2026-10-17"))
    changed = _doc(_checkin(mood="", focus="2", day="2026-10-17"))
    for _ in range(3):
        svc.update_note("u1", n["id"], {"bodyJson": changed}, conn=conn)
    assert _rows(conn, n["id"]) == [
        {"embed_id": "ci-1", "user_id": "u1", "day": "2026-10-17", "mood": None, "focus": 2}]
    # A metadata-only write leaves the projection as it was.
    svc.update_note("u1", n["id"], {"title": "Renamed"}, conn=conn)
    assert len(_rows(conn, n["id"])) == 1
    # Removing the block from the body removes its row.
    svc.update_note("u1", n["id"], {"bodyJson": _doc()}, conn=conn)
    assert _rows(conn, n["id"]) == []


# ── 3. a bad block degrades: no row, the save still succeeds ─────────────────

@pytest.mark.parametrize("node", [
    _checkin(mood="4", focus="", day=""),             # no day
    _checkin(mood="4", focus="", day="2026-02-30"),   # the right shape, not a real date
    _checkin(mood="", focus="", day="2026-10-17"),    # both levels empty
], ids=["empty-day", "impossible-date", "no-level"])
def test_a_bad_block_writes_no_row_and_the_save_returns_200(client, node):
    from api.services.auth_db import get_connection
    r = client.post("/api/j2/notes", json={"title": "Day", "bodyJson": _doc(node)})
    assert r.status_code == 200, r.text
    note = r.json()["note"]
    base = note["updatedAt"]
    r = client.put(f"/api/j2/notes/{note['id']}", json={"bodyJson": _doc(node), "baseUpdatedAt": base})
    assert r.status_code == 200, r.text
    c = get_connection()
    try:
        assert c.execute("SELECT COUNT(*) FROM j2_note_checkins WHERE note_id = ?",
                         (note["id"],)).fetchone()[0] == 0
        # Control: the same door with a good block DOES write a row, so a zero above is the
        # skip, not a sidecar that never runs.
        good = _doc(_checkin(mood="4", day="2026-10-17"))
        r = client.put(f"/api/j2/notes/{note['id']}",
                       json={"bodyJson": good, "baseUpdatedAt": r.json()["note"]["updatedAt"]})
        assert r.status_code == 200, r.text
        assert c.execute("SELECT COUNT(*) FROM j2_note_checkins WHERE note_id = ?",
                         (note["id"],)).fetchone()[0] == 1
    finally:
        c.close()


@pytest.mark.parametrize("node", [
    _checkin(mood="4", day="2026-10-17\n"),           # a trailing newline is not the day
    _checkin(mood="4", day="2026-1-7"),               # not zero-padded
    _checkin(mood="4", day="17-10-2026"),
    _checkin(mood="4", day=20261017),                 # not a string
    _checkin(mood="6", day="2026-10-17"),             # out of range
    _checkin(mood="0", day="2026-10-17"),
    _checkin(mood=4, day="2026-10-17"),               # a number, which the client never writes
    _checkin(mood=" 4", day="2026-10-17"),
    _checkin(mood="04", day="2026-10-17"),
    _checkin(mood="4", day="2026-10-17", embed_id=""),
    {"type": "widgetEmbed", "attrs": {"widgetId": "moodCheckIn",
                                      "params": {"mood": "4", "day": "2026-10-17"}}},   # no embedId
    {"type": "widgetEmbed", "attrs": {"widgetId": "moodCheckIn", "embedId": "x", "params": "junk"}},
    {"type": "widgetEmbed", "attrs": "junk"},
], ids=["newline-day", "unpadded-day", "dmy-day", "int-day", "mood-6", "mood-0", "int-mood",
        "space-mood", "padded-mood", "empty-embed", "no-embed", "params-not-dict", "attrs-not-dict"])
def test_every_other_bad_shape_is_skipped_and_the_note_saves(conn, node):
    n = _note(conn, node, _checkin(focus="5", day="2026-10-17", embed_id="ci-ok"))
    assert [r["embed_id"] for r in _rows(conn, n["id"])] == ["ci-ok"]


def test_a_duplicated_embed_id_keeps_the_first_block_and_does_not_fail_the_save(conn):
    """A copied block can carry its source's embedId. The primary key is (note_id, embed_id), so
    two rows would fail the INSERT and with it the note write; the first one in document order is
    the one kept."""
    n = _note(conn, _checkin(mood="2", day="2026-10-16", embed_id="dup"),
              _checkin(mood="5", day="2026-10-17", embed_id="dup"))
    assert _rows(conn, n["id"]) == [
        {"embed_id": "dup", "user_id": "u1", "day": "2026-10-16", "mood": 2, "focus": None}]


# ── 4. trash and restore leave the sidecar alone; hard delete removes it ──────

def test_trash_keeps_the_row_out_of_live_reads_and_restore_brings_it_back(conn):
    from api.services.journal_two import notes as svc
    n = _note(conn, _checkin(mood="3", focus="4", day="2026-10-17"))
    assert [r["note_id"] for r in _live_rows(conn, "u1")] == [n["id"]]

    svc.delete_note("u1", n["id"], conn=conn)
    assert len(_rows(conn, n["id"])) == 1, "R-T3-V3: trash leaves the sidecar row physically intact"
    assert _live_rows(conn, "u1") == [], "a trashed note's check-in is excluded by its join"

    svc.restore_note("u1", n["id"], conn=conn)
    assert _live_rows(conn, "u1") == [
        {"note_id": n["id"], "day": "2026-10-17", "mood": 3, "focus": 4}]


def test_the_hard_delete_sweep_removes_the_check_in_rows(conn):
    from api.services.journal_two import notes as svc
    gone = _note(conn, _checkin(mood="3", day="2026-10-17"), title="Expired")
    kept = _note(conn, _checkin(mood="5", day="2026-10-17", embed_id="ci-kept"), title="Live")
    svc.delete_note("u1", gone["id"], conn=conn)
    future = datetime.now(timezone.utc) + timedelta(days=svc.TRASH_RETENTION_DAYS + 1)
    assert svc.purge_expired_deleted_notes(now=future, conn=conn) == 1
    assert _rows(conn, gone["id"]) == []
    assert [r["embed_id"] for r in _rows(conn, kept["id"])] == ["ci-kept"]


# ── 5. the account purge removes the member's rows, by name ──────────────────

def test_the_account_purge_removes_j2_note_checkins_for_the_member_only(conn):
    """Named here, independent of `_DIRECT_USER_TABLES`: the generic manifest rail seeds and checks
    off that same tuple, so a table missing from it would be invisible to it too."""
    from api.services.journal_two import account_purge as ap
    assert "j2_note_checkins" in ap._DIRECT_USER_TABLES
    mine = _note(conn, _checkin(mood="1", day="2026-10-17"), user_id="u1")
    theirs = _note(conn, _checkin(mood="5", day="2026-10-17"), user_id="u2")
    conn.commit()
    report = ap.purge_user_data("u1", conn)
    assert report["errors"] == [], report["errors"]
    assert report["rows_deleted"].get("j2_note_checkins") == 1
    assert conn.execute("SELECT COUNT(*) FROM j2_note_checkins WHERE user_id = 'u1'").fetchone()[0] == 0
    assert _rows(conn, theirs["id"]) == [
        {"embed_id": "ci-1", "user_id": "u2", "day": "2026-10-17", "mood": 5, "focus": None}]
    assert _rows(conn, mine["id"]) == []


# ── the levels: the server accepts exactly what the client keeps ─────────────

# Near misses the client has to refuse. The LEVELS themselves are not typed here: they come from
# the client's own CHECKIN_LEVELS and the server's own set, and every one is probed.
_NEAR_MISSES = ["", "0", "6", "10", " 1", "1 ", "01", "1.0", "x", "١", "one", None, 1, 5, 3.0, False]


def _client_accepted(candidates):
    """Run checkinWords.js in Node: CHECKIN_LEVELS, and which candidates nextCheckinParams KEEPS
    when a member presses mood or focus with that value."""
    node = shutil.which("node")
    assert node, "node is not on PATH"
    js = (f"import({json.dumps(CLIENT_WORDS.resolve().as_uri())}).then((m) => {{"
          f"  const cands = {json.dumps(candidates)};"
          "  const keep = (key) => cands.filter((v) => m.nextCheckinParams({}, key, v, '2026-10-17')[key] !== '');"
          "  process.stdout.write(JSON.stringify({levels: m.CHECKIN_LEVELS, mood: keep('mood'), focus: keep('focus')}));"
          "})")
    r = subprocess.run([node, "--input-type=module", "-e", js], capture_output=True, timeout=120)
    assert r.returncode == 0, (r.stderr or b"").decode("utf-8", "replace")[:2000]
    return json.loads(r.stdout.decode("utf-8"))


def test_the_server_accepts_exactly_the_levels_the_client_keeps():
    from api.services.journal_two import notes as svc
    server_levels = sorted(svc.CHECKIN_LEVELS)
    first = _client_accepted(_NEAR_MISSES)
    candidates = list(dict.fromkeys(list(first["levels"]) + server_levels + _NEAR_MISSES))
    client = _client_accepted(candidates)

    # Non-vacuity: Node really ran the module, and the probe can tell a level from a near miss.
    assert client["levels"] and "3" in client["levels"], client
    assert "3" in client["mood"] and "6" not in client["mood"], client

    assert sorted(client["levels"]) == server_levels, (client["levels"], server_levels)
    server_kept = [v for v in candidates if svc._checkin_level(v) is not None]
    assert client["mood"] == server_kept, (client["mood"], server_kept)
    assert client["focus"] == server_kept, (client["focus"], server_kept)
