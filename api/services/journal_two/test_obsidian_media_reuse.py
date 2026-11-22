"""L4 (live Obsidian probe, 2026-11-03): an edit no longer re-copies a note's media.

`mediaUploaded` was 5 on every push of the probe note, and its unchanged probe.pdf got a new file
id each time, so storage grew with every edit. Now a media ref whose CONTENT is named by the ref
(an Obsidian blob ref, `obsidian-att:<sha256>/...`) and that this note already stored is reused
on an update: same URL, nothing fetched, nothing copied (`engine._reuse_stored_media`). A changed
file is a new sha, so a new ref, and is copied as before.

Same real-door harness as `test_obsidian_attachments_e2e.py`.
"""

from __future__ import annotations

import io
import json

from PIL import Image

from api.services import auth_db
from api.services.journal_two import notes as notes_svc
from api.services.journal_two.test_obsidian_attachments_e2e import (  # noqa: F401 -- fixture
    _BIN, _connect, _ingest, _of_type, _ref, _served, _stored_note, _upload, client,
)
from api.services.journal_two.note_connectors import engine as sync_engine


def _png(color: tuple[int, int, int]) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (8, 6), color).save(buf, format="PNG")
    return buf.getvalue()


def _media() -> list[tuple[str, bytes, str]]:
    return [(f"p{i}.png", _png((40 * i, 90, 200 - 30 * i)), "image/png") for i in range(4)] + [
        ("probe.pdf", (_BIN / "report.pdf").read_bytes(), "application/pdf")]


def _body(text: str, media) -> str:
    return text + "\n\n" + "\n\n".join(f"![[{name}]]" for name, _d, _m in media)


def _refs(media) -> list[dict]:
    return [_ref(f"![[{name}]]", f"att/{name}", data) for name, data, _m in media]


async def _sync(source_id: str) -> dict:
    r = await sync_engine.sync_source(source_id, full=False, manual=True)
    assert r["status"] == "ok", r
    return r


def _urls(doc) -> list[str]:
    return ([n["attrs"]["src"] for n in _of_type(doc, "image")]
            + [n["attrs"]["href"] for n in _of_type(doc, "attachmentChip")])


def _files_on_disk(note_id: str) -> int:
    root = notes_svc._ATTACHMENT_ROOT / "user-a" / "notes" / note_id
    return sum(1 for p in root.rglob("*") if p.is_file())


async def _setup(client):
    token, source_id = _connect(client)
    media = _media()
    for name, data, mime in media:
        _upload(client, token, data, name, mime)
    _ingest(client, token, _body("Version 0", media), _refs(media), content_hash="v0")
    first = await _sync(source_id)
    assert first["mediaUploaded"] == 5
    return token, source_id, media


async def test_three_edits_with_five_unchanged_media_copy_nothing(client):
    token, source_id, media = await _setup(client)
    note = _stored_note()
    urls = _urls(note["doc"])
    assert len(urls) == 5 and all("import-ref://" not in u for u in urls)
    files = _files_on_disk(note["id"])

    for edit in (1, 2, 3):
        _ingest(client, token, _body(f"Version {edit}", media), _refs(media), content_hash=f"v{edit}")
        r = await _sync(source_id)
        assert r["updated"] == 1
        assert r["mediaUploaded"] == 0, f"edit {edit} re-copied media"
        after = _stored_note()
        assert after["id"] == note["id"]
        assert _urls(after["doc"]) == urls, f"edit {edit} moved a URL"
        assert f"Version {edit}" in after["plain"]
        assert after["pending"] == 0
    assert _files_on_disk(note["id"]) == files                   # storage did not grow
    for (_n, data, _m), url in zip(media[4:], urls[4:]):
        assert _served(url) == data                               # the pdf still serves its bytes


async def test_a_changed_file_is_copied_and_the_rest_reused(client):
    token, source_id, media = await _setup(client)
    urls = _urls(_stored_note()["doc"])
    changed = list(media)
    changed[1] = ("p1.png", _png((1, 2, 3)), "image/png")
    _upload(client, token, changed[1][1], "p1.png", "image/png")
    _ingest(client, token, _body("Version 1", changed), _refs(changed), content_hash="v1")
    r = await _sync(source_id)
    assert r["mediaUploaded"] == 1
    new_urls = _urls(_stored_note()["doc"])
    assert new_urls[0] == urls[0] and new_urls[2:] == urls[2:]
    assert new_urls[1] != urls[1]


async def test_a_stored_file_that_is_gone_is_copied_again(client):
    """Reuse needs the file on disk: one the attachment GC collected (or anything else removed)
    is fetched and stored again, never pointed at."""
    token, source_id, media = await _setup(client)
    note = _stored_note()
    pdf_url = _urls(note["doc"])[4]
    _sub, filename = pdf_url.rsplit("/", 2)[1:]
    notes_svc.serve_note_image_path("user-a", note["id"], _sub, filename).unlink()
    _ingest(client, token, _body("Version 1", media), _refs(media), content_hash="v1")
    r = await _sync(source_id)
    assert r["mediaUploaded"] == 1
    new_pdf = _urls(_stored_note()["doc"])[4]
    assert _served(new_pdf) == media[4][1]


async def test_reuse_is_recorded_per_note_and_only_for_content_named_refs(client):
    _token, _source_id, _media_list = await _setup(client)
    note = _stored_note()
    conn = auth_db.get_connection()
    try:
        rows = conn.execute("SELECT ref, stored_json FROM j2_note_import_media WHERE user_id = ?"
                            " AND note_id = ?", ("user-a", note["id"])).fetchall()
    finally:
        conn.close()
    assert len(rows) == 5
    assert all(r["ref"].startswith(("obsidian-att:", "obsidian-file:")) for r in rows)
    assert {json.loads(r["stored_json"])["url"] for r in rows} == set(_urls(note["doc"]))


async def test_a_media_retry_does_not_forget_what_resolved_before(client):
    """One blob is late: the first sync stores four and leaves a retrying notice. The upload then
    lands and the retry resolves only that one. The next edit must still reuse all five."""
    token, source_id = _connect(client)
    media = _media()
    for name, data, mime in media[:4]:
        _upload(client, token, data, name, mime)
    _ingest(client, token, _body("Version 0", media), _refs(media), content_hash="v0")
    r0 = await _sync(source_id)
    assert r0["mediaUploaded"] == 4
    _upload(client, token, media[4][1], media[4][0], media[4][2])
    _ingest(client, token, _body("Version 0", media), _refs(media), content_hash="v0")  # unchanged
    r1 = await _sync(source_id)
    assert r1["mediaUploaded"] == 1
    assert _stored_note()["pending"] == 0
    _ingest(client, token, _body("Version 1", media), _refs(media), content_hash="v1")
    r2 = await _sync(source_id)
    assert r2["mediaUploaded"] == 0


def test_only_staged_blob_refs_name_their_content():
    from api.services.journal_two.note_connectors.providers.obsidian import ObsidianProvider
    p = ObsidianProvider(user_id="u", vault_id="v")
    sha = "a" * 64
    assert p.media_ref_names_content(f"obsidian-att:{sha}/chart.png")
    assert p.media_ref_names_content(f"obsidian-file:{sha}/report.pdf")
    assert not p.media_ref_names_content("https://example.com/chart.png")
    assert not p.media_ref_names_content("obsidian-att:not-a-sha/chart.png")
    assert not p.media_ref_names_content(None)


async def test_a_kept_original_that_is_gone_means_the_image_is_copied_again(client):
    """A HEIC is stored as a JPEG plus its original (a chip). Reuse needs BOTH files: with the
    original gone, the image is fetched and stored again rather than leaving a dead chip."""
    token, source_id = _connect(client)
    heic = (_BIN / "photo.heic").read_bytes()
    _upload(client, token, heic, "photo.heic", "image/heic")
    refs = [_ref("![[photo.heic]]", "att/photo.heic", heic)]
    _ingest(client, token, "V0\n\n![[photo.heic]]", refs, content_hash="v0")
    await _sync(source_id)
    note = _stored_note()
    [chip] = _of_type(note["doc"], "attachmentChip")
    sub, filename = chip["attrs"]["href"].rsplit("/", 2)[1:]
    _ingest(client, token, "V1\n\n![[photo.heic]]", refs, content_hash="v1")
    assert (await _sync(source_id))["mediaUploaded"] == 0           # both there: reused
    notes_svc.serve_note_image_path("user-a", note["id"], sub, filename).unlink()
    _ingest(client, token, "V2\n\n![[photo.heic]]", refs, content_hash="v2")
    assert (await _sync(source_id))["mediaUploaded"] == 1
    [chip2] = _of_type(_stored_note()["doc"], "attachmentChip")
    assert _served(chip2["attrs"]["href"]) == heic


async def test_media_left_out_of_the_written_body_is_not_recorded(client, monkeypatch):
    """L4 fix round 1: when the resolved body fails validation, `_final_body_without_media`
    writes notices instead of the copied files. Those files are in no body, so no row may say the
    note "has" them, or a later update would reuse files nothing shows."""
    real = notes_svc._validate_body_json

    def refuse_resolved(body):
        if "/api/j2/notes/attachments/" in json.dumps(body):
            raise notes_svc.NoteValidationError("too big, say")
        return real(body)

    monkeypatch.setattr(notes_svc, "_validate_body_json", refuse_resolved)
    token, source_id = _connect(client)
    media = _media()
    for name, data, mime in media:
        _upload(client, token, data, name, mime)
    _ingest(client, token, _body("Version 0", media), _refs(media), content_hash="v0")
    await sync_engine.sync_source(source_id, full=False, manual=True)
    note = _stored_note()
    assert _of_type(note["doc"], "image") == []                     # notices, not the files
    conn = auth_db.get_connection()
    try:
        n = conn.execute("SELECT COUNT(*) FROM j2_note_import_media WHERE note_id = ?",
                         (note["id"],)).fetchone()[0]
    finally:
        conn.close()
    assert n == 0
