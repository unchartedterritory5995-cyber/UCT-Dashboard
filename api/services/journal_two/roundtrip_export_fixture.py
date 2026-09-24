"""CLI fixture builder for the frontend importer's round-trip test.

Consumed by `app/src/pages/journal-2-0/lib/importer/exportRoundtrip.test.js`
(2026-09-02 adversarial audit, finding A4 -- "our own export cannot be
imported back into our own product"). That test needs a REAL archive built
by the REAL backend exporter, not a hand-typed stand-in -- the whole point
being that no test in this repo had ever introduced the export's actual
output to the importer's actual input before. Since the exporter is Python
and the importer is JS, this script is the bridge: it builds one realistic
note (tags, a subtitle, a ticker, a hero image, an inline image, a file
attachment, a title containing a colon, and a tag needing quoting) through
`build_export_zip` -- the exact function `api/routers/journal_two.py`'s
export route calls -- and hands the archive to the JS side, which unzips it
and feeds it through the real `detectAdapter()` + adapter `parse()` path.

⛔ THE ARCHIVE NEVER TRAVELS THROUGH STDOUT (wave-5 re-review, round 4). It
used to be printed base64-encoded, so ANY other output of this process -- a
`print()` in a module this imports, a warning, a background thread -- landed
inside the payload and the test died on "unknown compression type 8628" in
beforeAll, twice in seven runs while another session had notes.py half
edited. Now the archive is written to a FILE, proved readable here first
(`zipfile.testzip`, every member's CRC), and stdout carries only a FRAME:

    UCT-EXPORT-FIXTURE-ZIP-BEGIN
    <path of the archive>
    <sha256 of its bytes>
    UCT-EXPORT-FIXTURE-ZIP-END

The test reads only what is inside the frame, so stray output around it is
harmless, a broken frame is reported as exactly that, and the sha256 proves
the file it reads is the one written here.

Usage: python roundtrip_export_fixture.py <attachment-root-dir>
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import sqlite3
import sys
import tempfile
import zipfile
from pathlib import Path

# Make `api.*` importable when this script is invoked directly (not as
# `python -m ...`) from any working directory.
_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))


FRAME_BEGIN = "UCT-EXPORT-FIXTURE-ZIP-BEGIN"
FRAME_END = "UCT-EXPORT-FIXTURE-ZIP-END"


class CorruptArchive(ValueError):
    """The exporter's archive does not read back: never hand it to the test."""


def write_validated_archive(blob: bytes, directory) -> tuple[str, str]:
    """Prove `blob` is a readable zip -- every member decompresses and matches
    its CRC -- then write it to a new file in `directory`. Returns the file's
    path and the sha256 of its bytes. Raises CorruptArchive (or zipfile's own
    BadZipFile) instead of writing anything unreadable."""
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        bad = zf.testzip()
    if bad is not None:
        raise CorruptArchive(f"the export archive is corrupt: member {bad!r} fails its CRC")
    fd, path = tempfile.mkstemp(prefix="uct-export-", suffix=".zip", dir=str(directory))
    with os.fdopen(fd, "wb") as f:
        f.write(blob)
    return path, hashlib.sha256(blob).hexdigest()


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: roundtrip_export_fixture.py <attachment-root-dir>", file=sys.stderr)
        raise SystemExit(2)
    root = Path(sys.argv[1])
    os.environ["J2_ATTACHMENT_ROOT"] = str(root)

    from api.services.journal_two.db import ensure_schema
    from api.services.journal_two.notes_export import build_export_zip

    # Plant real files exactly where notes.py::save_note_image_bytes /
    # save_note_attachment_bytes would have written them -- mirrors the
    # `_plant()` helper in test_notes_export.py.
    def plant(sub: str, filename: str, data: bytes) -> None:
        p = root / "u1" / "notes" / "n1" / sub / filename
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    plant("hero", "cover.png", b"hero-bytes")
    plant("inline", "chart.png", b"inline-bytes")
    plant("file", "report.pdf", b"%PDF-fake")

    doc = {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "The thesis holds."}]},
            # N4: a trader's dollars in prose -- exported `\$`, read back as `$`.
            {"type": "paragraph", "content": [{"type": "text", "text": "Range $5-$10 on $NVDA."}]},
            # N4 (fix round 2): member text that arrives by ATTRIBUTE -- an
            # image's alt, an attachment's name -- is prose too.
            {"type": "image", "attrs": {
                "src": "/api/j2/notes/attachments/u1/n1/inline/chart.png", "alt": "NVDA $5 base"}},
            {"type": "attachmentChip", "attrs": {
                "href": "/api/j2/notes/attachments/u1/n1/file/report.pdf",
                "name": "report $Q3.pdf"}},
            # ...and so are a widget's label and an Ask answer's question and
            # source labels.
            {"type": "widgetEmbed", "attrs": {"searchText": "Chart $NVDA 1D", "widgetId": "chart"}},
            {"type": "askInsert",
             "attrs": {"insertedAt": "2026-09-22T14:03:00.000Z", "question": "Hold above $5?"},
             "content": [{"type": "paragraph", "content": [
                 {"type": "text", "text": "Yes "},
                 {"type": "askCitation", "attrs": {"n": 1, "label": "Deck $Q3"}}]}]},
            # R2-N4: a backslash the member typed before a `$` -- the note
            # says `cost \$5 and \$6`, and must come back saying exactly that.
            {"type": "paragraph", "content": [{"type": "text", "text": "cost \\$5 and \\$6"}]},
            # R2-N1: three things that used to put a BLANK LINE inside a raw
            # HTML island, ending it early -- an excerpt with an annotation
            # (this callout), two Shift+Enters in a row (the next one) and a
            # code block with an empty line (the toggle).
            {"type": "callout", "attrs": {"emoji": "\U0001F4A1"},
             "content": [{"type": "paragraph", "content": [
                 {"type": "text", "text": "a tip worth keeping"}]},
                 {"type": "paragraph", "content": [
                     {"type": "text", "text": "stop at $42"}]},
                 {"type": "documentExcerpt", "attrs": {"excerptId": "ex1"}}]},
            {"type": "callout", "attrs": {"emoji": "\U0001F4CC"},
             "content": [{"type": "paragraph", "content": [
                 {"type": "text", "text": "range"},
                 {"type": "hardBreak"}, {"type": "hardBreak"},
                 {"type": "text", "text": "$5-$10 now"}]}]},
            {"type": "toggle", "attrs": {"open": True}, "content": [
                {"type": "toggleSummary", "content": [
                    {"type": "text", "text": "More detail"}]},
                {"type": "toggleContent", "content": [
                    {"type": "paragraph", "content": [
                        {"type": "text", "text": "hidden until expanded"}]},
                    {"type": "codeBlock", "attrs": {"language": "python"}, "content": [
                        {"type": "text", "text": "total = $7\n\nprint(total)"}]}]},
            ]},
        ],
    }

    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    ensure_schema(conn)
    conn.execute(
        "INSERT INTO j2_notes (id, user_id, title, subtitle, body_json,"
        " body_plain, tags, ticker, hero_image_url, created_at, updated_at)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (
            "n1", "u1", "AAPL: the thesis", "Why I am long",
            json.dumps(doc), "The thesis holds.",
            json.dumps(["swing", "reclaim, tight"]), "AAPL",
            "/api/j2/notes/attachments/u1/n1/hero/cover.png",
            "2024-03-04T10:00:00Z", "2026-08-31T12:00:00Z",
        ),
    )
    # The excerpt the first callout cites: a document and one excerpt with an
    # annotation (the annotation is what writes the blank line).
    conn.execute(
        "INSERT INTO j2_note_documents (id, user_id, note_id, attachment_url, name, status, created_at)"
        " VALUES (?,?,?,?,?,?,?)",
        ("doc1", "u1", "n1", "/api/j2/notes/attachments/u1/n1/file/report.pdf", "Q3 deck.pdf",
         "ready", "2026-08-31T12:00:00Z"),
    )
    conn.execute(
        "INSERT INTO j2_note_excerpts (id, user_id, note_id, document_id, page_number,"
        " captured_text, annotation, created_at) VALUES (?,?,?,?,?,?,?,?)",
        ("ex1", "u1", "n1", "doc1", 3, "Guidance $5.2B-$6.1B for the year", "stop $4 then $6",
         "2026-08-31T12:00:00Z"),
    )
    conn.commit()

    blob, _filename = build_export_zip("u1", conn=conn)
    path, sha = write_validated_archive(blob, root)
    # The leading newline starts the frame on its own line even after a stray
    # write that did not end with one.
    sys.stdout.write(f"\n{FRAME_BEGIN}\n{path}\n{sha}\n{FRAME_END}\n")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
