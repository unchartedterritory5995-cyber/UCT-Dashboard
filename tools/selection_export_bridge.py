"""The REAL selection exporter, callable from a JS rail (wave 6 lane D, fix round 1 -- I2).

Reads a small library as JSON on stdin --

    {"folders": [{"id", "name", "parent"}],
     "notes":   [{"id", "title", "folder", "doc"}],
     "ids":     ["<note id>", ...]}

-- builds it in an IN-MEMORY SQLite database with the real schema
(`journal_two.db.ensure_schema`), runs `notes_export.build_selection_export_to_tempfile`
(the writer `POST /api/j2/notes/batch/export` calls) over `ids`, and prints ONE
JSON line, last, `{"files": {name: text}, "exported": n, "skipped": [...]}`.
The JS side feeds those files to our own importer (`lib/importer`) and checks
that a link between two exported notes still resolves: the round trip crosses
both runtimes, so neither half is a hand-typed stand-in for the other.

⛔ THE CENSUS, NOT A HAND-PICKED VARIABLE (CLAUDE.md, "`C:\\data` IS REAL ON THIS
BOX"). Importing the repo-root `conftest` pins every environment variable the
AST census finds naming a path under the shared data root to a sandbox, and arms
the tripwire that raises on a write there -- both BEFORE any `api.*` import,
because those paths are captured at module import. It costs a few seconds, paid
once per rail file (the rail calls this once, in `beforeAll`). The only I/O here
is the in-memory database and one `mkstemp` archive in the system temp
directory, which is deleted before this exits.
"""
from __future__ import annotations

import json
import sqlite3
import sys
import zipfile
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import conftest  # noqa: E402,F401 -- the census and the tripwire, before any api.* import
from tools.bridge_sandbox import run_bridge  # noqa: E402 -- releases the census sandboxes on exit


def main() -> int:
    from api.services.journal_two.db import ensure_schema
    from api.services.journal_two.notes_export import build_selection_export_to_tempfile

    spec = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    ensure_schema(conn)
    stamp = "2026-09-01T00:00:00Z"
    for f in spec.get("folders", []):
        conn.execute(
            "INSERT INTO j2_note_folders (id, user_id, name, parent_id, created_at) VALUES (?,?,?,?,?)",
            (f["id"], "u1", f["name"], f.get("parent") or "", stamp))
    for n in spec.get("notes", []):
        conn.execute(
            "INSERT INTO j2_notes (id, user_id, folder_id, title, body_json, body_plain, tags,"
            " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (n["id"], "u1", n.get("folder"), n["title"], json.dumps(n["doc"]), "", "[]", stamp, stamp))
    conn.commit()
    path, _name, exported, skipped = build_selection_export_to_tempfile("u1", spec.get("ids", []), conn=conn)
    try:
        with zipfile.ZipFile(path) as zf:
            files = {name: zf.read(name).decode("utf-8") for name in zf.namelist()}
    finally:
        path.unlink(missing_ok=True)
        conn.close()
    sys.stdout.write("\n" + json.dumps({"files": files, "exported": exported, "skipped": skipped}) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(run_bridge(main))
