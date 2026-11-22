"""A full pass with a complete listing retries pending media copies (Plan E Task 9).

Found by the messy Evernote corpus (`test_note_connectors_evernote_engine.py`): a provider with
`list_present_refs` keeps its stored cursor on a full pass, so a note whose remote never changes
was never listed again and an image that failed to copy on it stayed "retrying on the next sync"
forever. `engine._pending_media_refs` adds those notes to the fetch of a SCHEDULER full pass, and
only for a provider that declares `fetch_is_listing_independent` (Evernote). Task 9 fix round 1:

  * C1: a provider whose `fetch` reads listing state (OneNote's `_page_meta`) would rebuild a
    retried note without its title and folder and overwrite it. Opt-in only, and a retry-only ref
    whose payload hash differs from the stored one is skipped and named, never confirmed.
  * C2: a member's removal-check pass never retries (it is an incremental pass).
  * I1: a note the member edited is never retried (`engine._is_conflict`, the one predicate).
  * I2: at most `MEDIA_RETRY_NOTES_PER_PASS` retries per pass, stalest import first.
Retried refs never move or hold the cursor.
"""
from __future__ import annotations

from typing import Any

import pytest
from cryptography.fernet import Fernet

from api.services import auth_db
from api.services.journal_two import import_notice
from api.services.journal_two import notes as notes_svc
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.note_connectors import connections, engine, errors
from api.services.journal_two.note_connectors.providers.base import (
    AccountInfo, NoteProvider, RemoteNote, RemoteRef,
)

USER = "u1"


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    monkeypatch.setenv("NOTE_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    monkeypatch.setattr(engine, "MEMBER_FULL_PASS_MIN_INTERVAL_S", 0)

    async def creds(_u, _p):
        return {"accessToken": "t"}

    monkeypatch.setattr(engine, "_resolve_credentials", creds)


def _png() -> bytes:
    from api.services.journal_two.note_connectors.corpora.corpora_gen import _media_body
    return _media_body({"kind": "png", "w": 4, "h": 4, "seed": 1})


def _doc(text: str, rid: str | None = None) -> dict:
    content: list[dict] = [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]
    if rid:
        content.append({"type": "image", "attrs": {"src": f"import-ref://res-{rid}"}})
    return {"type": "doc", "content": content}


def ref(rid: str, day: int) -> RemoteRef:
    return RemoteRef(remote_id=rid, updated_at=f"2026-01-{day:02d}T00:00:00.000+00:00")


class Fake(NoteProvider):
    """Every note has one image `res-<id>`. `fail_media`: ids whose image download fails this
    pass. `fail_fetch`: ids whose fetch raises. `unstorable`: ids fetched with a body over the
    size limit. `titles`: a title override per id (a fetch that lost its listing metadata)."""
    name = "fake"
    fetch_is_listing_independent = True

    def __init__(self, delta, present=None, *, fail_media=(), fail_fetch=(), unstorable=(), titles=None):
        self.delta, self.present = list(delta), list(present if present is not None else delta)
        self.fail_media, self.fail_fetch, self.unstorable = set(fail_media), set(fail_fetch), set(unstorable)
        self.titles = titles or {}
        self.fetched: list[str] = []

    def import_key(self, source_remote_id, remote_id):
        return f"fake:{remote_id}"

    async def validate(self, credentials):
        return AccountInfo(label="Fake")

    async def list_changed(self, credentials, cursor=None):
        return list(self.delta)

    async def list_present_refs(self, credentials):
        return list(self.present)

    async def fetch(self, credentials, r):
        rid = r.remote_id
        self.fetched.append(rid)
        if rid in self.fail_fetch:
            raise errors.NoteConnTransient("get_note timed out")
        if rid in self.unstorable:
            return RemoteNote(remote_id=rid, title=rid, doc=_doc("x" * (notes_svc.MAX_BODY_JSON_BYTES + 10)),
                              updated_at=r.updated_at)
        return RemoteNote(remote_id=rid, title=self.titles.get(rid, f"Note {rid}"), doc=_doc(f"body {rid}", rid),
                          media=[{"ref": f"res-{rid}", "kind": "image", "name": f"{rid}.png"}],
                          updated_at=r.updated_at)

    async def fetch_media(self, credentials, media_ref):
        rid = media_ref[len("res-"):]
        if rid in self.fail_media:
            raise errors.NoteConnTransient("expired")
        return _png(), "image/png"


class ListingBound(Fake):
    """The same provider without the opt-in: its fetch may read listing state."""
    fetch_is_listing_independent = False


def _source() -> dict:
    connections.upsert_connector(USER, "fake", {"accessToken": "t"}, account_label="Fake")
    return connections.create_source(USER, "fake", "acct", display_name="Fake")


async def _pass(monkeypatch, src, provider, **kw) -> dict:
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: provider)
    return await engine.sync_source(src["id"], manual=True, **kw)


def _row(rid: str) -> dict[str, Any]:
    conn = auth_db.get_connection()
    try:
        row = conn.execute("SELECT id, title, folder_id, updated_at, imported_at, import_media_pending "
                           "FROM j2_notes WHERE import_key = ?", (f"fake:{rid}",)).fetchone()
        return dict(row) if row else {}
    finally:
        conn.close()


def _last_log_failures(src) -> list[dict]:
    import json
    conn = auth_db.get_connection()
    try:
        row = conn.execute("SELECT failures_json FROM j2_note_sync_log WHERE source_id = ? ORDER BY rowid DESC",
                           (src["id"],)).fetchone()
    finally:
        conn.close()
    return json.loads(row["failures_json"]) if row and row["failures_json"] else []


def _cursor(src) -> str | None:
    return connections.get_source_by_id(src["id"])["cursor"]


# ── the retry, and the cursor ──────────────────────────────────────────────────────

async def test_pending_media_retry_never_moves_or_holds_the_cursor(db, monkeypatch):
    """On a scheduler full pass, a listed-but-unchanged note waiting on a retryable copy is
    fetched; its (newer) listing time never becomes the cursor (OneNote's is a drain watermark),
    and neither its fetch failure nor a storage failure holds the cursor."""
    src = _source()
    a, b = ref("A", 1), ref("B", 9)
    await _pass(monkeypatch, src, Fake([a, b], fail_media={"B"}), full=True)
    connections.update_cursor(USER, src["id"], a.updated_at)  # a drain watermark
    assert _row("B")["import_media_pending"] == import_notice.MEDIA_PENDING_RETRY

    # B's fetch fails: attempted, never holds the cursor
    a2 = ref("A", 2)
    p = Fake([a2], [a2, b], fail_fetch={"B"})
    await _pass(monkeypatch, src, p, full=True)
    assert set(p.fetched) == {"A", "B"}   # a failing batch is retried item by item
    assert _row("B")["import_media_pending"] == import_notice.MEDIA_PENDING_RETRY
    assert _cursor(src) == a2.updated_at

    # B comes back different (here: too big to store): a retry-only ref is never confirmed
    # with new content (C1's belt guard); it is skipped and named, and never holds the cursor
    a3 = ref("A", 3)
    p = Fake([a3], [a3, b], unstorable={"B"})
    result = await _pass(monkeypatch, src, p, full=True)
    assert any("media retry skipped for 'Note B'" in f for f in result["failures"])
    assert _cursor(src) == a3.updated_at

    # B is unchanged but `import_confirm` cannot store it: named, never holds the cursor
    real_confirm = notes_svc.import_confirm

    def refuse_b(user_id, payload, **kw):
        keep = [n for n in payload["notes"] if n["importKey"] != "fake:B"]
        out = real_confirm(user_id, {**payload, "notes": keep}, **kw)
        if len(keep) != len(payload["notes"]):
            out.setdefault("failed", []).append({"importKey": "fake:B", "error": "disk full"})
        return out

    monkeypatch.setattr(notes_svc, "import_confirm", refuse_b)
    a4 = ref("A", 4)
    result = await _pass(monkeypatch, src, Fake([a4], [a4, b]), full=True)
    monkeypatch.setattr(notes_svc, "import_confirm", real_confirm)
    assert any("'fake:B' could not be stored" in f for f in result["failures"])
    # concern 4: a retried note that cannot be stored is named by its title for the member
    # (fix round 2, m1: "disk full" is raw text, so the member reads the generic sentence)
    assert _last_log_failures(src) == [{"noteTitle": "Note B", "reason": engine.NOT_STORED_RETRY_REASON,
                                        "name": None}]
    assert _cursor(src) == a4.updated_at
    a3 = a4

    # the retry lands; B's newer listing time never becomes the cursor
    p = Fake([a3], [a3, b])
    await _pass(monkeypatch, src, p, full=True)
    assert p.fetched == ["A", "B"]
    assert _row("B")["import_media_pending"] == import_notice.MEDIA_PENDING_NONE
    assert _cursor(src) == a3.updated_at

    # an incremental pass (no complete listing) adds nothing
    p = Fake([a3], [a3, b])
    await _pass(monkeypatch, src, p, full=False)
    assert p.fetched == ["A"]


# ── C1: opt-in, and the belt guard ─────────────────────────────────────────────────

async def test_retry_is_opt_in_per_provider(db, monkeypatch):
    src = _source()
    a, b = ref("A", 1), ref("B", 9)
    await _pass(monkeypatch, src, ListingBound([a, b], fail_media={"B"}), full=True)
    p = ListingBound([], [a, b])
    await _pass(monkeypatch, src, p, full=True)
    assert p.fetched == []
    assert _row("B")["import_media_pending"] == import_notice.MEDIA_PENDING_RETRY


async def test_retry_only_ref_whose_hash_moved_is_skipped_and_named_never_confirmed(db, monkeypatch):
    """A retry-only ref is a MEDIA retry, never a content sync: when what it fetched would
    hash differently from the stored note (here its title came back as the raw id, as a fetch
    without listing metadata does), the note is not written and the pass names it."""
    src = _source()
    a, b = ref("A", 1), ref("B", 9)
    await _pass(monkeypatch, src, Fake([a, b], fail_media={"B"}), full=True)
    before = _row("B")
    p = Fake([], [a, b], titles={"B": "B"})
    result = await _pass(monkeypatch, src, p, full=True)
    assert p.fetched == ["B"]
    assert _row("B") == before                     # title, folder, updated_at, pending: untouched
    assert any("Note B" in f and "media retry skipped" in f for f in result["failures"])
    # fix round 2, m2: named by its stored title in the Sync log too (Concern 4's path)
    assert _last_log_failures(src) == [{"noteTitle": "Note B", "reason": engine.RETRY_SKIPPED_REASON,
                                        "name": None}]


# ── C2: a member's removal-check pass never retries ─────────────────────────────────

async def test_removal_check_pass_never_retries(db, monkeypatch):
    src = _source()
    a, b = ref("A", 1), ref("B", 9)
    await _pass(monkeypatch, src, Fake([a, b], fail_media={"B"}), full=True)
    p = Fake([a], [a, b])
    result = await _pass(monkeypatch, src, p, full=True, member=True)
    assert result["removalCheck"]["ran"] is True
    assert p.fetched == ["A"]
    assert _row("B")["import_media_pending"] == import_notice.MEDIA_PENDING_RETRY


# ── I1: a note the member edited is never retried ───────────────────────────────────

async def test_member_edited_note_with_pending_media_is_not_refetched(db, monkeypatch):
    src = _source()
    a, b = ref("A", 1), ref("B", 9)
    await _pass(monkeypatch, src, Fake([a, b], fail_media={"B"}), full=True)
    notes_svc.update_note(USER, _row("B")["id"], {"bodyJson": _doc("my own words")})
    for _ in range(2):
        p = Fake([], [a, b])
        await _pass(monkeypatch, src, p, full=True)
        assert p.fetched == []


# ── I2: a cap per pass, stalest first ────────────────────────────────────────────────

async def test_retries_are_capped_per_pass_stalest_first(db, monkeypatch):
    monkeypatch.setattr(engine, "MEDIA_RETRY_NOTES_PER_PASS", 2)
    src = _source()
    refs = [ref("A", 1), ref("B", 2), ref("C", 3)]
    await _pass(monkeypatch, src, Fake(refs, fail_media={"A", "B", "C"}), full=True)
    conn = auth_db.get_connection()
    try:  # C is the stalest import, then A, then B (updated_at kept equal: never "edited")
        for rid, stamp in (("C", "2026-01-10T00:00:00+00:00"), ("A", "2026-01-11T00:00:00+00:00"),
                           ("B", "2026-01-12T00:00:00+00:00")):
            conn.execute("UPDATE j2_notes SET imported_at = ?, updated_at = ? WHERE import_key = ?",
                         (stamp, stamp, f"fake:{rid}"))
        conn.commit()
    finally:
        conn.close()
    p = Fake([], refs)
    await _pass(monkeypatch, src, p, full=True)
    assert sorted(p.fetched) == ["A", "C"]
    p = Fake([], refs)
    await _pass(monkeypatch, src, p, full=True)
    assert p.fetched == ["B"]


# ── C1: who opts in, read from the classes themselves ────────────────────────────────

def _provider_classes() -> dict[str, type]:
    import importlib
    import pkgutil

    from api.services.journal_two.note_connectors import providers
    for mod in pkgutil.iter_modules(providers.__path__):
        importlib.import_module(f"{providers.__name__}.{mod.name}")
    out: dict[str, type] = {}
    stack = list(NoteProvider.__subclasses__())
    while stack:
        cls = stack.pop()
        stack.extend(cls.__subclasses__())
        if cls.__module__.startswith(providers.__name__):
            out[cls.__name__] = cls
    return out


def test_only_evernote_opts_in_to_listing_independent_fetch_and_raster_promotion():
    """C1 and concern 5: both flags are per-provider declarations. Every provider but Evernote
    keeps the defaults (False), so a widened default would show here before it reached them."""
    classes = _provider_classes()
    assert {"EvernoteProvider", "NotionProvider", "ObsidianProvider", "RoamProvider", "CraftProvider"} <= set(classes)
    declared = {name: (cls.fetch_is_listing_independent, cls.promote_raster_files) for name, cls in classes.items()}
    assert {n for n, flags in declared.items() if any(flags)} == {"EvernoteProvider"}
    assert declared["EvernoteProvider"] == (True, True)
