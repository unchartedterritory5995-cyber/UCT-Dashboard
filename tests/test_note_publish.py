"""Wave 8 lane 8B, B4 -- publish-to-web, the service's own rules
(`api/services/journal_two/note_publish.py`). Who may call which door is
tests/test_share_publish_authorization.py; this file is WHAT a publication serves.

  * ruling D-B6: a folder's public set is the snapshot ∩ the folder tree NOW, minus trashed
    and archived notes -- it shrinks at once, and grows only on Update; locked notes are in;
    at most MEMBER_CAP notes, and the owner is told the cap;
  * a note publication stops serving when its note is trashed or archived, and a folder
    publication when its folder is deleted;
  * one active publication per target, by the index;
  * `noindex` is stored as 1 and nothing can set it;
  * the in-app page path is the SAME fact as `PUBLISHED_PATH` in notePublishLink.js.
"""
from __future__ import annotations

import importlib
import os
import re
import sqlite3
import tempfile
from pathlib import Path

import pytest

A, B = "user-pub-a1", "user-pub-b2"
ROOT = Path(__file__).resolve().parents[1]


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
def svc(db_path):
    from api.services.journal_two import note_publish
    return note_publish


def _note(user, title, **kw):
    from api.services.journal_two import notes
    return notes.create_note(user, {"title": title, **kw})["id"]


def _folder(user, name, parent=""):
    from api.services.journal_two import notes
    return notes.create_folder(user, name, parent_id=parent)["id"]


def _index_titles(svc, slug):
    return [n["title"] for n in svc.resolve(slug)["notes"]]


# ── ruling D-B6: the folder's public set ────────────────────────────────────────────────

def test_a_folder_serves_its_notes_and_its_subfolders_notes(svc):
    f = _folder(A, "Research")
    sub = _folder(A, "Deep", parent=f)
    _note(A, "top", folderId=f)
    _note(A, "nested", folderId=sub)
    _note(A, "elsewhere")                          # control: not in the tree
    slug = svc.publish_folder(A, f)["slug"]
    assert sorted(_index_titles(svc, slug)) == ["nested", "top"]


def test_the_set_shrinks_at_once_and_grows_only_on_update(svc):
    from api.services.journal_two import notes
    f = _folder(A, "Research")
    keep, move, trash, archive = (_note(A, t, folderId=f) for t in ("keep", "move", "trash", "archive"))
    slug = svc.publish_folder(A, f)["slug"]
    assert sorted(_index_titles(svc, slug)) == ["archive", "keep", "move", "trash"]
    notes.update_note(A, move, {"folderId": None})
    notes.delete_note(A, trash)
    notes.set_note_archived(A, archive, True)
    assert _index_titles(svc, slug) == ["keep"]                     # shrinks at once
    later = _note(A, "added later", folderId=f)
    notes.update_note(A, move, {"folderId": f})                     # moved back in
    # "move" was in the snapshot, so back in the tree it serves again; "added later" was not.
    assert sorted(_index_titles(svc, slug)) == ["keep", "move"]
    assert "added later" not in _index_titles(svc, slug)            # NOT public until Update
    svc.refresh(A, slug)
    assert "added later" in _index_titles(svc, slug)                # Update grows it
    assert svc.resolve_member(slug, svc.pid_for(slug, later)) is not None


def test_locked_notes_are_published(svc):
    from api.services.auth_db import get_connection
    f = _folder(A, "Research")
    n = _note(A, "locked one", folderId=f)
    c = get_connection()
    try:
        c.execute("UPDATE j2_notes SET locked = 1 WHERE id = ?", (n,))
        c.commit()
    finally:
        c.close()
    slug = svc.publish_folder(A, f)["slug"]
    assert _index_titles(svc, slug) == ["locked one"]
    assert svc.resolve_member(slug, svc.pid_for(slug, n))["note"]["title"] == "locked one"


def test_the_cap_holds_and_the_owner_is_told(svc, monkeypatch):
    monkeypatch.setattr(svc, "MEMBER_CAP", 3)
    f = _folder(A, "Big")
    for i in range(5):
        _note(A, f"n{i}", folderId=f)
    pub = svc.publish_folder(A, f)
    assert pub["memberCount"] == 3 and pub["memberCap"] == 3
    assert len(svc.resolve(pub["slug"])["notes"]) == 3


def test_a_member_links_to_another_member_and_to_nothing_else(svc):
    f = _folder(A, "Linked")
    target = _note(A, "The target note", folderId=f)
    outside = _note(A, "Private outside")
    src = _note(A, "Source", folderId=f, bodyJson={"type": "doc", "content": [{"type": "paragraph", "content": [
        {"type": "noteLink", "attrs": {"noteId": target}}, {"type": "text", "text": " / "},
        {"type": "noteLink", "attrs": {"noteId": outside}}]}]})
    slug = svc.publish_folder(A, f)["slug"]
    payload = svc.resolve_member(slug, svc.pid_for(slug, src))
    runs = payload["note"]["bodyJson"]["content"][0]["content"]
    assert runs[0]["text"] == "The target note"
    assert runs[0]["marks"] == [{"type": "link", "attrs": {"href": f"/p/{slug}/n/{svc.pid_for(slug, target)}"}}]
    assert runs[-1] == {"type": "text", "text": "linked note"}
    assert "Private outside" not in str(payload) and outside not in str(payload) and target not in str(payload)


# ── a publication stops serving when its target goes ────────────────────────────────────

@pytest.mark.parametrize("how", ["trash", "archive"])
def test_a_note_publication_stops_when_its_note_is_trashed_or_archived(svc, how):
    from api.services.journal_two import notes
    n = _note(A, "Published")
    slug = svc.publish_note(A, n)["slug"]
    assert svc.resolve(slug)["note"]["title"] == "Published"          # control
    if how == "trash":
        notes.delete_note(A, n)
    else:
        notes.set_note_archived(A, n, True)
    assert svc.resolve(slug) is None
    assert svc.list_mine(A)["publications"][0]["state"] == ("note in trash" if how == "trash" else "note archived")


def test_a_folder_publication_stops_when_its_folder_is_deleted(svc):
    from api.services.journal_two import notes
    f = _folder(A, "Doomed")
    _note(A, "inside", folderId=f)
    slug = svc.publish_folder(A, f)["slug"]
    assert svc.resolve(slug) is not None                                # control
    notes.delete_folder(A, f)
    assert svc.resolve(slug) is None
    assert svc.list_mine(A)["publications"][0]["state"] == "folder deleted"


def test_publishing_a_trashed_or_foreign_note_or_folder_is_refused(svc):
    from api.services.journal_two import notes
    mine = _note(A, "mine")
    notes.delete_note(A, mine)
    assert svc.publish_note(A, mine) is None
    assert svc.publish_note(B, _note(A, "not B's")) is None
    assert svc.publish_folder(B, _folder(A, "not B's either")) is None


# ── one active publication per target; noindex is stored and fixed ──────────────────────

def test_one_active_publication_per_target(svc):
    n = _note(A, "once")
    first = svc.publish_note(A, n)["slug"]
    assert svc.publish_note(A, n)["slug"] == first                      # the live one again
    from api.services.auth_db import get_connection
    c = get_connection()
    try:
        with pytest.raises(sqlite3.IntegrityError):
            c.execute("INSERT INTO j2_note_publications (slug, user_id, kind, target_id, created_at, updated_at)"
                      " VALUES ('second', ?, 'note', ?, 'x', 'x')", (A, n))
        # ...a REVOKED one does not count.
        c.execute("UPDATE j2_note_publications SET revoked_at = 'x' WHERE slug = ?", (first,))
        c.execute("INSERT INTO j2_note_publications (slug, user_id, kind, target_id, created_at, updated_at)"
                  " VALUES ('second', ?, 'note', ?, 'x', 'x')", (A, n))
        c.commit()
    finally:
        c.close()


def test_noindex_is_stored_as_1_and_nothing_sets_it(svc):
    n = _note(A, "indexed?")
    pub = svc.publish_note(A, n)
    assert pub["noindex"] is True
    src = (ROOT / "api" / "services" / "journal_two" / "note_publish.py").read_text(encoding="utf-8")
    updates = re.findall(r"UPDATE j2_note_publications SET[^\"]*", src)
    assert updates, "found no UPDATE statements to inspect"                   # non-vacuity
    assert not [u for u in updates if "noindex" in u], "an UPDATE writes the noindex column"
    assert re.search(r"VALUES \(\?, \?, \?, \?, \?, 1, ", src), "the insert no longer stores noindex = 1"


def test_the_kind_column_refuses_anything_but_note_or_folder(svc):
    svc.publish_note(A, _note(A, "schema"))                              # ensures the table
    from api.services.auth_db import get_connection
    c = get_connection()
    try:
        with pytest.raises(sqlite3.IntegrityError):
            c.execute("INSERT INTO j2_note_publications (slug, user_id, kind, target_id, created_at, updated_at)"
                      " VALUES ('z', ?, 'page', 't', 'x', 'x')", (A,))
    finally:
        c.close()


# ── one fact in two files ───────────────────────────────────────────────────────────────

def test_the_page_path_is_the_same_fact_as_the_client_route():
    from api.services.journal_two import note_publish
    js = (ROOT / "app" / "src" / "pages" / "journal-2-0" / "lib" / "notePublishLink.js").read_text(encoding="utf-8")
    m = re.search(r"export const PUBLISHED_PATH = '([^']+)'", js)
    assert m, "PUBLISHED_PATH not found in notePublishLink.js"
    assert note_publish.PUBLISHED_PAGE_PATH == m.group(1)
    m2 = re.search(r"export const PUBLISHED_ENDPOINT = '([^']+)'", js)
    assert m2 and note_publish.PUBLISHED_API == m2.group(1)


def test_the_sitemap_lists_no_public_note_and_robots_does_not_hide_them():
    """A published page and a share link are reached by their address only: the static sitemap
    names neither prefix. robots.txt must NOT disallow them either -- a crawler that may not fetch
    a page never sees its noindex, and a disallowed URL can still be indexed from a link."""
    public = ROOT / "app" / "public"
    sitemap = (public / "sitemap.xml").read_text(encoding="utf-8")
    assert "<loc>" in sitemap                                            # non-vacuity
    assert "/p/" not in sitemap and "/share/" not in sitemap
    robots = (public / "robots.txt").read_text(encoding="utf-8")
    disallowed = [ln.split(":", 1)[1].strip() for ln in robots.splitlines() if ln.lower().startswith("disallow:")]
    assert not [d for d in disallowed if d.startswith(("/p", "/share"))], disallowed


def test_the_editor_context_names_the_notes_folder(svc):
    f = _folder(A, "Weekly plans")
    n = _note(A, "in a folder", folderId=f)
    u = _note(A, "unfiled")
    assert svc.list_mine(A, note_id=n)["note"] == {"noteId": n, "exists": True, "publishable": True,
                                                    "folderId": f, "folderName": "Weekly plans"}
    assert svc.list_mine(A, note_id=u)["note"] == {"noteId": u, "exists": True, "publishable": True,
                                                    "folderId": None, "folderName": None}


def test_M3_the_editor_context_reports_an_archived_note_as_not_publishable(svc):
    """Wave-8 final review M-3: `exists` alone read true for an archived note that
    `publish_note` refuses (and a share link could never serve). The context now says so."""
    from api.services.journal_two import notes
    f = _folder(A, "Weekly plans")
    archived = _note(A, "archived", folderId=f)
    notes.set_note_archived(A, archived, True)
    ctx = svc.list_mine(A, note_id=archived)["note"]
    assert ctx["exists"] is True and ctx["publishable"] is False, ctx
    assert svc.publish_note(A, archived) is None                     # the door agrees
    trashed = _note(A, "trashed")
    notes.delete_note(A, trashed)
    ctx = svc.list_mine(A, note_id=trashed)["note"]
    assert ctx["exists"] is False and ctx["publishable"] is False, ctx
    notes.set_note_archived(A, archived, False)                      # CONTROL: unarchived is publishable
    assert svc.list_mine(A, note_id=archived)["note"]["publishable"] is True
    assert svc.publish_note(A, archived) is not None


# ── M-8: transaction scope (wave-8 final review) ─────────────────────────────────────────

def _raw(db_path: str, timeout: float = 5.0) -> sqlite3.Connection:
    c = sqlite3.connect(db_path, timeout=timeout)
    c.row_factory = sqlite3.Row
    return c


def _cols(conn: sqlite3.Connection, table: str) -> set[str]:
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}


def _objects(conn: sqlite3.Connection) -> set[str]:
    return {r[0] for r in conn.execute("SELECT name FROM sqlite_master").fetchall()}


def test_M8_ensure_share_schema_never_commits_the_callers_open_transaction(db_path):
    """⚰️ The ALTER was followed by `conn.commit()`: a caller that passed its own connection
    mid-transaction had its transaction committed for it. The ALTER now rides the caller's
    transaction -- a rollback takes both back -- and is re-ensured, uncached, next time."""
    from api.services.journal_two import note_shares
    conn = _raw(db_path)
    try:
        assert "expires_at" not in _cols(conn, "j2_note_shares"), "precondition: the ALTER path must run"
        conn.execute("CREATE TABLE m8_probe (x INTEGER)")
        conn.execute("INSERT INTO m8_probe VALUES (1)")                # the caller's open write
        assert conn.in_transaction
        note_shares.ensure_share_schema(conn)
        assert conn.in_transaction, "ensure_share_schema committed the caller's transaction"
        conn.rollback()
        assert conn.execute("SELECT COUNT(*) FROM m8_probe").fetchone()[0] == 0
        assert "expires_at" not in _cols(conn, "j2_note_shares")       # the ALTER rode the caller's work
        note_shares.ensure_share_schema(conn)                          # not cached: re-ensured, for good
        assert "expires_at" in _cols(conn, "j2_note_shares")
        # With the column present, an open transaction is left alone too.
        note_shares._SCHEMA_READY.discard(note_shares._db_key(conn))
        conn.execute("INSERT INTO m8_probe VALUES (2)")
        note_shares.ensure_share_schema(conn)
        assert conn.in_transaction
        conn.rollback()
        assert conn.execute("SELECT COUNT(*) FROM m8_probe").fetchone()[0] == 0
    finally:
        conn.close()


def test_M8_ensure_publish_schema_never_commits_the_callers_open_transaction(db_path):
    from api.services.journal_two import note_publish
    conn = _raw(db_path)
    try:
        assert "j2_note_publications" not in _objects(conn), "precondition: the CREATE path must run"
        conn.execute("CREATE TABLE m8_probe (x INTEGER)")
        conn.execute("INSERT INTO m8_probe VALUES (1)")
        note_publish.ensure_publish_schema(conn)
        assert conn.in_transaction, "ensure_publish_schema committed the caller's transaction"
        conn.rollback()
        assert conn.execute("SELECT COUNT(*) FROM m8_probe").fetchone()[0] == 0
        assert "j2_note_publications" not in _objects(conn)            # the CREATEs rode it
        note_publish.ensure_publish_schema(conn)                       # re-ensured, uncached
        assert set(note_publish._SCHEMA_OBJECTS) <= _objects(conn)
        note_publish._SCHEMA_READY.discard(note_shares_key := note_publish.note_shares._db_key(conn))
        conn.execute("INSERT INTO m8_probe VALUES (2)")
        note_publish.ensure_publish_schema(conn)                       # present: creates and commits nothing
        assert conn.in_transaction
        conn.rollback()
        assert conn.execute("SELECT COUNT(*) FROM m8_probe").fetchone()[0] == 0
        assert note_shares_key in note_publish._SCHEMA_READY           # ...and caches the answer
    finally:
        conn.close()


def test_M8_publishing_again_leaves_no_write_transaction_open(svc, db_path):
    """⚰️ `_retire_expired` was a bare UPDATE on every publish: it took the write lock even
    when it matched nothing, and on the "already published" path nothing committed after
    it, so the caller's connection was left holding a write transaction."""
    f = _folder(A, "Research")
    _note(A, "in the folder", folderId=f)
    solo = _note(A, "solo")
    conn = _raw(db_path)
    try:
        assert svc.publish_folder(A, f, conn=conn) is not None
        assert svc.publish_note(A, solo, conn=conn) is not None
        assert not conn.in_transaction
        assert svc.publish_folder(A, f, conn=conn) is not None         # already published
        assert not conn.in_transaction, "publish_folder left a write transaction open"
        assert svc.publish_note(A, solo, conn=conn) is not None
        assert not conn.in_transaction, "publish_note left a write transaction open"
    finally:
        conn.close()


def test_M8_no_folder_scan_runs_under_the_auth_db_write_lock(svc, db_path, monkeypatch):
    """Every tree scan a publish runs (the snapshot, and the owner view's member count) is
    probed from a SECOND connection that tries to take the write lock without waiting: it
    must always get it -- on the already-published path and on the retire-then-republish
    path alike."""
    f = _folder(A, "Research")
    _note(A, "in the folder", folderId=f)
    first = svc.publish_folder(A, f)["slug"]
    seen: list[str] = []
    real = svc._live_notes_in_tree

    def probing(conn, *a, **k):
        other = _raw(db_path, timeout=0)
        try:
            other.execute("BEGIN IMMEDIATE")
            other.rollback()
            seen.append("free")
        except sqlite3.OperationalError:
            seen.append("LOCKED")
        finally:
            other.close()
        return real(conn, *a, **k)

    monkeypatch.setattr(svc, "_live_notes_in_tree", probing)
    assert svc.publish_folder(A, f)["slug"] == first                   # nothing to retire
    c = _raw(db_path)
    try:
        c.execute("UPDATE j2_note_publications SET expires_at = ? WHERE slug = ?",
                  ("2000-01-01T00:00:00.000000+00:00", first))
        c.commit()
    finally:
        c.close()
    assert svc.publish_folder(A, f)["slug"] != first                   # retired, then republished
    assert len(seen) >= 3, seen                                        # non-vacuity: the scans ran
    assert seen == ["free"] * len(seen), seen


def test_M8_CONTROL_the_lock_probe_sees_a_held_write_lock(db_path):
    """CONTROL: the probe above answers LOCKED while another connection holds the lock, so
    'free' is a measurement and not the probe's only answer."""
    holder = _raw(db_path)
    try:
        holder.execute("CREATE TABLE IF NOT EXISTS m8_probe (x INTEGER)")
        holder.execute("INSERT INTO m8_probe VALUES (1)")              # takes the write lock
        other = _raw(db_path, timeout=0)
        try:
            with pytest.raises(sqlite3.OperationalError):
                other.execute("BEGIN IMMEDIATE")
        finally:
            other.close()
    finally:
        holder.rollback()
        holder.close()
