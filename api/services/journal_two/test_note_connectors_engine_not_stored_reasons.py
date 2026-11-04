"""A note that cannot be stored is named for the member in words, never raw exception text (Plan E
Task 9 fix round 2, m1). For every provider: `import_confirm` records `str(e)` for any failure,
a developer's `NoteValidationError` message or a raw DB error alike. The engine passes on only the
known member sentences (`notes.TOO_LONG_BODY_DETAIL`, `TOO_DEEP_BODY_DETAIL`,
`UNBUILDABLE_BODY_DETAIL`, `S_TITLE_TOO_LONG`); anything else reads `NOT_STORED_RETRY_REASON`, in
`failures_json` and in the pass's failure string alike, and the raw text goes to the server log.
"""
from __future__ import annotations

import json
import logging

import pytest
from cryptography.fernet import Fernet

from api.services import auth_db
from api.services.journal_two import notes as notes_svc
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.note_connectors import connections, engine
from api.services.journal_two.note_connectors.providers.base import (
    AccountInfo, NoteProvider, RemoteNote, RemoteRef,
)

USER = "u1"
RAW_DB = "sqlite3.OperationalError: no such column: j2_notes.secret_internal_column"


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    monkeypatch.setenv("NOTE_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")

    async def creds(_u, _p):
        return {"accessToken": "t"}

    monkeypatch.setattr(engine, "_resolve_credentials", creds)


class Notes(NoteProvider):
    """`Tagged` carries one tag past the cap; `Locked` is refused by the DB (simulated); `Long`
    is over the body limit (a known member sentence)."""
    name = "fake"

    def import_key(self, source_remote_id, remote_id):
        return f"fake:{remote_id}"

    async def validate(self, credentials):
        return AccountInfo(label="Fake")

    async def list_changed(self, credentials, cursor=None):
        return [RemoteRef(remote_id=r, updated_at="2026-01-01T00:00:00.000+00:00") for r in ("Tagged", "Locked", "Long")]

    async def fetch(self, credentials, ref):
        rid = ref.remote_id
        text = "x" * (notes_svc.MAX_BODY_JSON_BYTES + 10) if rid == "Long" else f"body {rid}"
        tags = [f"t{i}" for i in range(notes_svc.MAX_TAGS + 1)] if rid == "Tagged" else []
        return RemoteNote(remote_id=rid, title=f"Note {rid}", tags=tags, updated_at=ref.updated_at,
                          doc={"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]})

    async def fetch_media(self, credentials, ref):
        raise AssertionError("no media")


async def _sync(monkeypatch) -> tuple[dict, list[dict]]:
    real_confirm = notes_svc.import_confirm

    def db_refuses_locked(user_id, payload, **kw):
        keep = [n for n in payload["notes"] if n["importKey"] != "fake:Locked"]
        out = real_confirm(user_id, {**payload, "notes": keep}, **kw)
        if len(keep) != len(payload["notes"]):
            out.setdefault("failed", []).append({"importKey": "fake:Locked", "error": RAW_DB})
        return out

    monkeypatch.setattr(notes_svc, "import_confirm", db_refuses_locked)
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: Notes())
    connections.upsert_connector(USER, "fake", {"accessToken": "t"}, account_label="Fake")
    src = connections.create_source(USER, "fake", "acct", display_name="Fake")
    result = await engine.sync_source(src["id"], manual=True)
    conn = auth_db.get_connection()
    try:
        row = conn.execute("SELECT failures_json, error FROM j2_note_sync_log WHERE source_id = ?",
                           (src["id"],)).fetchone()
    finally:
        conn.close()
    result["_logError"] = row["error"]
    return result, json.loads(row["failures_json"])


async def test_raw_failures_reach_the_member_as_the_generic_sentence(db, monkeypatch, caplog):
    caplog.set_level(logging.WARNING)
    result, named = await _sync(monkeypatch)
    by_title = {f["noteTitle"]: f["reason"] for f in named}
    assert by_title["Note Tagged"] == engine.NOT_STORED_RETRY_REASON        # "tags exceeds cap of 30"
    assert by_title["Note Locked"] == engine.NOT_STORED_RETRY_REASON        # a raw DB error
    assert by_title["Note Long"] == notes_svc.TOO_LONG_BODY_DETAIL          # a member sentence: kept
    member_text = json.dumps(named) + json.dumps(result["failures"]) + (result["_logError"] or "")
    for raw in ("exceeds cap", "sqlite3", "secret_internal_column"):
        assert raw not in member_text
    # ...the raw text is in the server log, and nowhere else
    assert "secret_internal_column" in caplog.text and "tags exceeds cap" in caplog.text


def test_every_member_sentence_passes_through_and_nothing_else_does():
    for sentence in (notes_svc.TOO_LONG_BODY_DETAIL, notes_svc.TOO_DEEP_BODY_DETAIL,
                     notes_svc.UNBUILDABLE_BODY_DETAIL, notes_svc.S_TITLE_TOO_LONG):
        assert engine._member_reason(sentence, key="k") == sentence
    for raw in ("tags exceeds cap of 30", RAW_DB, "", None, 42):
        assert engine._member_reason(raw, key="k") == engine.NOT_STORED_RETRY_REASON
