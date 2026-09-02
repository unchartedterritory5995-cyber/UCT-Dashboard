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
export route calls -- and prints the resulting zip, base64-encoded, on
stdout. The JS side decodes it, unzips it, and feeds it through the real
`detectAdapter()` + adapter `parse()` path.

Usage: python roundtrip_export_fixture.py <attachment-root-dir>
"""
from __future__ import annotations

import base64
import json
import os
import sqlite3
import sys
from pathlib import Path

# Make `api.*` importable when this script is invoked directly (not as
# `python -m ...`) from any working directory.
_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))


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
            {"type": "image", "attrs": {
                "src": "/api/j2/notes/attachments/u1/n1/inline/chart.png", "alt": ""}},
            {"type": "attachmentChip", "attrs": {
                "href": "/api/j2/notes/attachments/u1/n1/file/report.pdf",
                "name": "report.pdf"}},
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
    conn.commit()

    blob, _filename = build_export_zip("u1", conn=conn)
    sys.stdout.write(base64.b64encode(blob).decode("ascii"))


if __name__ == "__main__":
    main()
