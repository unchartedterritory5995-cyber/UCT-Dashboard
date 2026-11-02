"""End to end: Obsidian vault images and files land in synced notes (connector fidelity
Plan C, Task 3).

Drives the REAL plugin doors (`/obsidian/redeem`, `/obsidian/attachments/{sha}`,
`/obsidian/ingest`) and then the REAL sync engine (`engine.sync_source`), the pattern of
`test_obsidian_ingest.py::test_delete_detection_still_fires_through_the_real_sync_engine`.
Nothing between the plugin's request and the stored note is faked: the provider's attachment
pass, `fetch_media` over the staged blob store, plan A's media policy (`normalize_media`) and
the engine's rewrite all run as in production. The auto-drain after a `final` push is off
(`_start_initial_sync`), so each test runs its own sync and reads its own result.

Fixture bytes live in `note_connectors/convert/obsidian_fixtures_in/bin/`: `chart.png` (a
37x23 PNG written once with Pillow), `report.pdf` (a minimal valid PDF) and `photo.heic`
(plan A's HEIC fixture, `tests/fixtures/media/rotated_32x16_orient6.heic`).
"""

from __future__ import annotations

import hashlib
import io
import json
import pathlib

import pytest
from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from api.routers import note_sync as note_sync_router
from api.services import auth_db
from api.services.journal_two import media_policy, notes as notes_svc
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.note_connectors import engine as sync_engine, obsidian_link

_BIN = pathlib.Path(__file__).resolve().parent / "note_connectors" / "convert" / "obsidian_fixtures_in" / "bin"
_REDEEM = "/api/j2/notes/connectors/obsidian/redeem"
_INGEST = "/api/j2/notes/connectors/obsidian/ingest"
_VAULT = "vault-e2e"


def _seed_user(conn, user_id: str) -> None:
    conn.execute("INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, 'pw', ?)",
                 (user_id, f"{user_id}@example.test", user_id))
    conn.execute("INSERT INTO subscriptions (id, user_id, plan, status) VALUES (?, ?, 'pro', 'active')",
                 (f"sub-{user_id}", user_id))
    conn.commit()


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    auth_db.init_db()
    conn = auth_db.get_connection()
    ensure_schema(conn)
    _seed_user(conn, "user-a")
    conn.close()
    monkeypatch.setenv("PUSH_SECRET", "test-push-secret")
    monkeypatch.setenv("NOTE_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("NOTE_SYNC_OBSIDIAN_ENABLED", "1")
    monkeypatch.setenv("J2_OBSIDIAN_BLOB_ROOT", str(tmp_path / "blobs"))
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    monkeypatch.setenv("J2_ATTACHMENT_ROOT", str(tmp_path / "att"))
    media_policy._USAGE_MEMO.clear()
    monkeypatch.setattr(note_sync_router, "_start_initial_sync", lambda *_a, **_k: None)
    app = FastAPI()
    app.include_router(note_sync_router.router)
    yield TestClient(app)
    media_policy._USAGE_MEMO.clear()


def _headers(token: str, version: str | None) -> dict:
    h = {"Authorization": f"Bearer {token}"}
    if version is not None:
        h["X-UCT-Plugin-Version"] = version
    return h


def _connect(client) -> tuple[str, str]:
    """A device token and the vault's source id, through the real redeem door."""
    code = obsidian_link.mint_connect_code("user-a")
    r = client.post(_REDEEM, json={"code": code, "vaultId": _VAULT, "label": "Trading"})
    assert r.status_code == 200, r.text
    return r.json()["token"], r.json()["source"]["id"]


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _upload(client, token: str, data: bytes, name: str, mime: str) -> None:
    r = client.put(f"/api/j2/notes/connectors/obsidian/attachments/{_sha(data)}", content=data,
                   headers={**_headers(token, "0.2.0"), "Content-Type": mime,
                            "X-UCT-Attachment-Name": name})
    assert r.status_code == 200, r.text


def _ingest(client, token: str, body_md: str, refs: list[dict] | None, *, version: str | None = "0.2.0",
            content_hash: str = "h1") -> None:
    note = {"vault_path": "a.md", "content_hash": content_hash, "body_md": body_md,
            "updated_at": "2026-11-01T00:00:00Z"}
    if refs is not None:
        note["attachments"] = refs
    r = client.post(_INGEST, headers=_headers(token, version),
                    json={"consent": True, "notes": [note], "manifest": ["a.md"], "final": True})
    assert r.status_code == 200, r.text


def _ref(original: str, path: str, data: bytes, *, embed: bool = True) -> dict:
    return {"original": original, "embed": embed, "path": path, "size": len(data),
            "sha256": _sha(data), "status": "ok"}


async def _sync(source_id: str) -> dict:
    result = await sync_engine.sync_source(source_id, full=True, manual=True)
    assert result["status"] == "ok", result
    return result


def _stored_note() -> dict:
    conn = auth_db.get_connection()
    try:
        row = conn.execute(
            "SELECT id, body_json, body_plain, import_media_pending FROM j2_notes"
            " WHERE user_id = ? AND import_key = ? AND deleted_at IS NULL",
            ("user-a", f"obsidian:{_VAULT}/a.md")).fetchone()
    finally:
        conn.close()
    assert row is not None, "the synced note was not stored"
    return {"id": row["id"], "doc": json.loads(row["body_json"]), "plain": row["body_plain"],
            "pending": row["import_media_pending"]}


def _nodes(node, out=None):
    out = [] if out is None else out
    if isinstance(node, dict):
        out.append(node)
        for c in node.get("content") or []:
            _nodes(c, out)
    return out


def _of_type(doc, type_):
    return [n for n in _nodes(doc) if n.get("type") == type_]


def _served(url: str) -> bytes:
    """The bytes the attachment door serves for a stored UCT attachment URL
    (`/api/j2/notes/attachments/{user}/{note}/{sub}/{file}`), through the same path
    resolver `journal_two.serve_note_attachment` uses."""
    prefix = "/api/j2/notes/attachments/"
    assert url.startswith(prefix), url
    user_id, note_id, sub, filename = url[len(prefix):].split("/")
    path = notes_svc.serve_note_image_path(user_id, note_id, sub, filename)
    assert path is not None, url
    return path.read_bytes()


async def test_wiki_embed_png_lands_as_a_served_image_with_its_natural_size(client):
    token, source_id = _connect(client)
    png = (_BIN / "chart.png").read_bytes()
    _upload(client, token, png, "chart.png", "image/png")
    _ingest(client, token, "Above\n\n![[chart.png]]\n\nBelow", [_ref("![[chart.png]]", "att/chart.png", png)])
    await _sync(source_id)

    note = _stored_note()
    [image] = _of_type(note["doc"], "image")
    src = image["attrs"]["src"]
    assert src.startswith("/api/j2/notes/attachments/user-a/") and "import-ref://" not in src
    with Image.open(io.BytesIO(_served(src))) as im:
        assert im.size == (37, 23)
    assert note["pending"] == 0
    assert "chart.png" not in note["plain"]
    assert _of_type(note["doc"], "importNotice") == []


async def test_pdf_embed_lands_as_a_downloadable_chip_with_identical_bytes(client):
    token, source_id = _connect(client)
    pdf = (_BIN / "report.pdf").read_bytes()
    _upload(client, token, pdf, "report.pdf", "application/pdf")
    _ingest(client, token, "![[report.pdf]]", [_ref("![[report.pdf]]", "docs/report.pdf", pdf)])
    await _sync(source_id)

    note = _stored_note()
    [chip] = _of_type(note["doc"], "attachmentChip")
    assert chip["attrs"]["name"] == "report.pdf"
    assert _sha(_served(chip["attrs"]["href"])) == _sha(pdf)
    assert note["pending"] == 0


async def test_heic_goes_through_plan_a_policy(client):
    heic_path = _BIN / "photo.heic"
    if not heic_path.exists():
        pytest.skip("plan A HEIC fixture absent")
    token, source_id = _connect(client)
    heic = heic_path.read_bytes()
    _upload(client, token, heic, "photo.heic", "image/heic")
    _ingest(client, token, "![[photo.heic]]", [_ref("![[photo.heic]]", "att/photo.heic", heic)])
    await _sync(source_id)

    note = _stored_note()
    images = _of_type(note["doc"], "image")
    assert images, note["doc"]
    src = images[0]["attrs"]["src"]
    assert src.endswith(".jpg"), src  # converted by normalize_media, stored as image/jpeg
    with Image.open(io.BytesIO(_served(src))) as im:
        assert Image.MIME[im.format] == "image/jpeg"


async def test_note_pushed_before_its_blob_heals_on_a_later_sync(client):
    """The plugin's upload of the blob failed (a network blip), but the note went over with
    its `ok` ref: the first sync leaves a "retrying" notice. The next run uploads the blob
    and pushes NO note change; the next sync must still reach the staged blob (plan A's
    I-7 retry) and the image appears."""
    token, source_id = _connect(client)
    png = (_BIN / "chart.png").read_bytes()
    _ingest(client, token, "![[chart.png]]", [_ref("![[chart.png]]", "att/chart.png", png)])
    await _sync(source_id)
    first = _stored_note()
    [notice] = _of_type(first["doc"], "importNotice")
    assert notice["attrs"]["reason"] == "fetch_failed" and notice["attrs"]["attempts"] == 1
    assert first["pending"] == 1

    _upload(client, token, png, "chart.png", "image/png")
    _ingest(client, token, "![[chart.png]]", [_ref("![[chart.png]]", "att/chart.png", png)])  # unchanged
    await _sync(source_id)

    healed = _stored_note()
    assert healed["id"] == first["id"]
    assert _of_type(healed["doc"], "importNotice") == []
    [image] = _of_type(healed["doc"], "image")
    with Image.open(io.BytesIO(_served(image["attrs"]["src"]))) as im:
        assert im.size == (37, 23)
    assert healed["pending"] == 0


async def test_a_blob_uploaded_after_three_passes_still_heals(client):
    """Fix round 1 (I2): passes that run while the blob is still absent (the hourly tick, a
    sync another push triggered, the nightly pass) must not spend the retry budget. Three
    such passes, then the upload, then one pass: the image is served."""
    token, source_id = _connect(client)
    png = (_BIN / "chart.png").read_bytes()
    refs = [_ref("![[chart.png]]", "att/chart.png", png)]
    _ingest(client, token, "![[chart.png]]", refs)
    for _ in range(3):
        await _sync(source_id)
    waiting = _stored_note()
    [notice] = _of_type(waiting["doc"], "importNotice")
    assert notice["attrs"]["reason"] == "fetch_failed" and notice["attrs"]["attempts"] == 1
    assert waiting["pending"] == 1

    _upload(client, token, png, "chart.png", "image/png")
    await _sync(source_id)
    healed = _stored_note()
    assert _of_type(healed["doc"], "importNotice") == []
    [image] = _of_type(healed["doc"], "image")
    with Image.open(io.BytesIO(_served(image["attrs"]["src"]))) as im:
        assert im.size == (37, 23)
    assert healed["pending"] == 0


async def test_old_plugin_payload_still_imports_text_with_outdated_notice(client):
    token, source_id = _connect(client)
    _ingest(client, token, "# Trade plan\n\nEntry above the pivot.\n\n![[chart.png]]\n", None,
            version=None)
    await _sync(source_id)

    note = _stored_note()
    assert "Entry above the pivot." in note["plain"]
    [notice] = _of_type(note["doc"], "importNotice")
    assert notice["attrs"]["reason"] == "obsidian-plugin-outdated"
    assert notice["attrs"]["name"] == "chart.png"
    assert _of_type(note["doc"], "image") == []
    assert note["pending"] == 0
