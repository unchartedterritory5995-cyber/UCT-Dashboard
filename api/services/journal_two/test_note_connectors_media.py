"""TDD tests for Task 3: bytes-level media save functions.

Tests the new save_note_image_bytes() and save_note_attachment_bytes() sync
functions, plus wrapper-parity between async UploadFile wrappers and the
bytes implementations.
"""

from __future__ import annotations

import asyncio
import sqlite3
from pathlib import Path

import pytest

from api.services.journal_two import notes as notes_svc
from api.services.journal_two.db import ensure_schema


@pytest.fixture
def conn(tmp_path, monkeypatch):
    """Fresh sandboxed J2 db."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    c = sqlite3.connect(tmp_path / "j2_test.db")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    yield c
    c.close()


class _FakeUpload:
    """Mock FastAPI UploadFile for testing async wrappers."""
    def __init__(self, data: bytes, content_type="application/pdf", filename="report.pdf"):
        self._data = data
        self.content_type = content_type
        self.filename = filename

    async def read(self):
        return self._data


# ── Image bytes function tests ──────────────────────────────────────────

def test_save_note_image_bytes_happy_path(conn, tmp_path, monkeypatch):
    """PNG image bytes store correctly with width/height."""
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)

    # Create a minimal valid PNG (1x1 pixel)
    png_bytes = (
        b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01'
        b'\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01'
        b'\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82'
    )

    result = notes_svc.save_note_image_bytes(
        "u1", note["id"], png_bytes, "test.png", "image/png"
    )

    assert result["url"].startswith(f"/api/j2/notes/attachments/u1/{note['id']}/inline/")
    assert result["url"].endswith(".png")
    assert result["width"] == 1
    assert result["height"] == 1
    # Verify file exists on disk
    url_parts = result["url"].split("/")
    filename = url_parts[-1]
    file_path = tmp_path / "att" / "u1" / "notes" / note["id"] / "inline" / filename
    assert file_path.exists()


def test_save_note_image_bytes_hero_kind(conn, tmp_path, monkeypatch):
    """Hero images use 'hero' subdirectory."""
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)

    png_bytes = (
        b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01'
        b'\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01'
        b'\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82'
    )

    result = notes_svc.save_note_image_bytes(
        "u1", note["id"], png_bytes, "hero.jpg", "image/jpeg", kind="hero"
    )

    assert "/hero/" in result["url"]
    assert result["url"].endswith(".jpg")


def test_save_note_image_bytes_jpeg(conn, tmp_path, monkeypatch):
    """JPEG images handled correctly."""
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)

    # Minimal valid JPEG (SOI marker + EOI marker)
    jpeg_bytes = b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xd9'

    result = notes_svc.save_note_image_bytes(
        "u1", note["id"], jpeg_bytes, "photo.jpg", "image/jpeg"
    )

    assert result["url"].endswith(".jpg")


def test_save_note_image_bytes_gif(conn, tmp_path, monkeypatch):
    """GIF images handled correctly."""
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)

    # Minimal valid GIF
    gif_bytes = b'GIF89a\x01\x00\x01\x00\x00\x00\x00\x00\x00\xff\xff\xff\x00\x00\x00\x21\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x01\x00\x3b'

    result = notes_svc.save_note_image_bytes(
        "u1", note["id"], gif_bytes, "ani.gif", "image/gif"
    )

    assert result["url"].endswith(".gif")


def test_save_note_image_bytes_webp(conn, tmp_path, monkeypatch):
    """WebP images handled correctly."""
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)

    # Minimal valid WebP
    webp_bytes = (
        b'RIFF\x1a\x00\x00\x00WEBPVP8 \x0e\x00\x00\x00'
        b'\x30\x01\x00\x9d\x01\x2a\x01\x00\x01\x00'
    )

    result = notes_svc.save_note_image_bytes(
        "u1", note["id"], webp_bytes, "image.webp", "image/webp"
    )

    assert result["url"].endswith(".webp")


def test_save_note_image_bytes_mime_rejection(conn, tmp_path, monkeypatch):
    """Invalid MIME types rejected."""
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)

    with pytest.raises(notes_svc.NoteValidationError, match="PNG/JPG/GIF/WebP"):
        notes_svc.save_note_image_bytes(
            "u1", note["id"], b"not-an-image", "bad.txt", "text/plain"
        )


def test_save_note_image_bytes_size_cap(conn, tmp_path, monkeypatch):
    """Images >5MB rejected."""
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)

    oversized = b"x" * (notes_svc._MAX_IMAGE_BYTES + 1)
    with pytest.raises(notes_svc.NoteValidationError, match="< 5 MB"):
        notes_svc.save_note_image_bytes(
            "u1", note["id"], oversized, "huge.jpg", "image/jpeg"
        )


def test_save_note_image_bytes_empty_rejection(conn, tmp_path, monkeypatch):
    """Empty files rejected."""
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)

    with pytest.raises(notes_svc.NoteValidationError, match="Empty file"):
        notes_svc.save_note_image_bytes(
            "u1", note["id"], b"", "empty.jpg", "image/jpeg"
        )


# ── Attachment bytes function tests ──────────────────────────────────────

def test_save_note_attachment_bytes_happy_path(conn, tmp_path, monkeypatch):
    """PDF attachment bytes store correctly."""
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)

    pdf_bytes = b"%PDF-1.4 x"
    result = notes_svc.save_note_attachment_bytes(
        "u1", note["id"], pdf_bytes, "report.pdf", "application/pdf"
    )

    assert result["url"].startswith(f"/api/j2/notes/attachments/u1/{note['id']}/file/")
    assert result["url"].endswith(".pdf")
    assert result["name"] == "report.pdf"
    assert result["size"] == 10
    # Verify file exists
    url_parts = result["url"].split("/")
    filename = url_parts[-1]
    file_path = tmp_path / "att" / "u1" / "notes" / note["id"] / "file" / filename
    assert file_path.exists()


def test_save_note_attachment_bytes_text(conn, tmp_path, monkeypatch):
    """Text file attachment."""
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)

    text_bytes = b"Hello, world!"
    result = notes_svc.save_note_attachment_bytes(
        "u1", note["id"], text_bytes, "notes.txt", "text/plain"
    )

    assert result["url"].endswith(".txt")
    assert result["name"] == "notes.txt"
    assert result["size"] == 13


def test_save_note_attachment_bytes_csv(conn, tmp_path, monkeypatch):
    """CSV file attachment."""
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)

    csv_bytes = b"sym,price\nNVDA,120\nAAPL,180"
    result = notes_svc.save_note_attachment_bytes(
        "u1", note["id"], csv_bytes, "data.csv", "text/csv"
    )

    assert result["url"].endswith(".csv")


def test_save_note_attachment_bytes_markdown(conn, tmp_path, monkeypatch):
    """Markdown file attachment."""
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)

    md_bytes = b"# Title\n\nContent here"
    result = notes_svc.save_note_attachment_bytes(
        "u1", note["id"], md_bytes, "README.md", "text/markdown"
    )

    assert result["url"].endswith(".md")


def test_save_note_attachment_bytes_zip(conn, tmp_path, monkeypatch):
    """ZIP file attachment."""
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)

    zip_bytes = b"PK\x03\x04..."  # ZIP header
    result = notes_svc.save_note_attachment_bytes(
        "u1", note["id"], zip_bytes, "archive.zip", "application/zip"
    )

    assert result["url"].endswith(".zip")


def test_save_note_attachment_bytes_audio(conn, tmp_path, monkeypatch):
    """Audio file attachment."""
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)

    mp3_bytes = b"ID3" + b"x" * 10
    result = notes_svc.save_note_attachment_bytes(
        "u1", note["id"], mp3_bytes, "podcast.mp3", "audio/mpeg"
    )

    assert result["url"].endswith(".mp3")


def test_save_note_attachment_bytes_docx(conn, tmp_path, monkeypatch):
    """DOCX file attachment."""
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)

    docx_bytes = b"PK\x03\x04..."
    result = notes_svc.save_note_attachment_bytes(
        "u1", note["id"], docx_bytes, "document.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )

    assert result["url"].endswith(".docx")


def test_save_note_attachment_bytes_xlsx(conn, tmp_path, monkeypatch):
    """XLSX file attachment."""
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)

    xlsx_bytes = b"PK\x03\x04..."
    result = notes_svc.save_note_attachment_bytes(
        "u1", note["id"], xlsx_bytes, "data.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )

    assert result["url"].endswith(".xlsx")


def test_save_note_attachment_bytes_mime_rejection(conn, tmp_path, monkeypatch):
    """Invalid MIME types rejected."""
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)

    with pytest.raises(notes_svc.NoteValidationError, match="not allowed"):
        notes_svc.save_note_attachment_bytes(
            "u1", note["id"], b"script content", "hack.exe", "application/x-msdownload"
        )


def test_save_note_attachment_bytes_size_cap(conn, tmp_path, monkeypatch):
    """Files >25MB rejected."""
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)

    oversized = b"x" * (notes_svc._MAX_FILE_BYTES + 1)
    with pytest.raises(notes_svc.NoteValidationError, match="< 25 MB"):
        notes_svc.save_note_attachment_bytes(
            "u1", note["id"], oversized, "huge.pdf", "application/pdf"
        )


def test_save_note_attachment_bytes_empty_rejection(conn, tmp_path, monkeypatch):
    """Empty files rejected."""
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)

    with pytest.raises(notes_svc.NoteValidationError, match="Empty file"):
        notes_svc.save_note_attachment_bytes(
            "u1", note["id"], b"", "empty.pdf", "application/pdf"
        )


def test_save_note_attachment_bytes_no_extension(conn, tmp_path, monkeypatch):
    """Attachment without extension defaults to .bin."""
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)

    result = notes_svc.save_note_attachment_bytes(
        "u1", note["id"], b"data", "noext", "application/pdf"
    )

    assert result["url"].endswith(".bin")


# ── Wrapper parity tests: async wrapper vs bytes function ──────────────

def test_wrapper_parity_image_produces_identical_results(conn, tmp_path, monkeypatch):
    """Async UploadFile wrapper and bytes function produce identical results."""
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)

    png_bytes = (
        b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01'
        b'\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01'
        b'\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82'
    )

    # Call bytes function
    bytes_result = notes_svc.save_note_image_bytes(
        "u1", note["id"], png_bytes, "test.png", "image/png"
    )

    # Call async wrapper with fake UploadFile
    fake_upload = _FakeUpload(png_bytes, "image/png", "test.png")
    async_result = asyncio.run(notes_svc.save_note_image(
        "u1", note["id"], fake_upload
    ))

    # Results should have identical shapes and values
    assert bytes_result["width"] == async_result["width"]
    assert bytes_result["height"] == async_result["height"]
    # URLs will differ because different files were created, but format is identical
    assert bytes_result["url"].split("/")[-2] == async_result["url"].split("/")[-2]  # same subdir


def test_wrapper_parity_attachment_produces_identical_results(conn, tmp_path, monkeypatch):
    """Async UploadFile wrapper and bytes function produce identical results."""
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)

    pdf_bytes = b"%PDF-1.4 x"

    # Call bytes function
    bytes_result = notes_svc.save_note_attachment_bytes(
        "u1", note["id"], pdf_bytes, "report.pdf", "application/pdf"
    )

    # Call async wrapper with fake UploadFile
    fake_upload = _FakeUpload(pdf_bytes, "application/pdf", "report.pdf")
    async_result = asyncio.run(notes_svc.save_note_attachment(
        "u1", note["id"], fake_upload
    ))

    # Results should have identical shapes and values
    assert bytes_result["name"] == async_result["name"]
    assert bytes_result["size"] == async_result["size"]
    # URLs will differ because different files were created, but format is identical
    assert bytes_result["url"].split("/")[-2] == async_result["url"].split("/")[-2]  # same subdir


def test_wrapper_parity_validation_errors_match(conn, tmp_path, monkeypatch):
    """Both paths reject invalid MIME types identically."""
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)

    # Bytes function should reject
    with pytest.raises(notes_svc.NoteValidationError):
        notes_svc.save_note_image_bytes(
            "u1", note["id"], b"x", "bad.txt", "text/plain"
        )

    # Async wrapper should reject identically
    fake_upload = _FakeUpload(b"x", "text/plain", "bad.txt")
    with pytest.raises(notes_svc.NoteValidationError):
        asyncio.run(notes_svc.save_note_image("u1", note["id"], fake_upload))


def test_wrapper_image_validates_mime_before_reading(conn, tmp_path, monkeypatch):
    """Image wrapper validates MIME type BEFORE calling read().
    This ensures bad-MIME uploads don't buffer large bodies and read errors
    surface as clean NoteValidationError, not unhandled exceptions."""
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)

    class BadReadUpload:
        def __init__(self):
            self.content_type = "text/plain"
            self.filename = "bad.txt"
            self.read_called = False

        async def read(self):
            self.read_called = True
            raise AssertionError("must not read body")

    upload = BadReadUpload()
    with pytest.raises(notes_svc.NoteValidationError, match="PNG/JPG/GIF/WebP"):
        asyncio.run(notes_svc.save_note_image("u1", note["id"], upload))

    # Verify read() was NEVER called
    assert not upload.read_called


def test_wrapper_attachment_validates_mime_before_reading(conn, tmp_path, monkeypatch):
    """Attachment wrapper validates MIME type BEFORE calling read().
    This ensures bad-MIME uploads don't buffer large bodies."""
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)

    class BadReadUpload:
        def __init__(self):
            self.content_type = "application/x-msdownload"
            self.filename = "hack.exe"
            self.read_called = False

        async def read(self):
            self.read_called = True
            raise AssertionError("must not read body")

    upload = BadReadUpload()
    with pytest.raises(notes_svc.NoteValidationError, match="not allowed"):
        asyncio.run(notes_svc.save_note_attachment("u1", note["id"], upload))

    # Verify read() was NEVER called
    assert not upload.read_called


def test_wrapper_attachment_filename_none_fallback(conn, tmp_path, monkeypatch):
    """Attachment wrapper with filename=None defaults to 'attachment'."""
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)

    pdf_bytes = b"%PDF-1.4 x"
    fake_upload = _FakeUpload(pdf_bytes, "application/pdf", None)
    result = asyncio.run(notes_svc.save_note_attachment(
        "u1", note["id"], fake_upload
    ))

    # Should use "attachment" as fallback
    assert result["name"] == "attachment"
    assert result["url"].endswith(".bin")


def test_save_note_attachment_bytes_filename_none_fallback(conn, tmp_path, monkeypatch):
    """Bytes function with empty filename defaults to 'attachment'."""
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)

    pdf_bytes = b"%PDF-1.4 x"
    result = notes_svc.save_note_attachment_bytes(
        "u1", note["id"], pdf_bytes, "", "application/pdf"
    )

    assert result["name"] == "attachment"
    assert result["url"].endswith(".bin")
