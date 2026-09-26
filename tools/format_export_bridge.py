"""The REAL export formats (HTML, JSON, Word), callable from a JS rail (wave 8, lane 8C, C4).

Reads a JSON LIST of jobs on stdin -- every job a rail file needs, answered from ONE spawn
(a spawn costs the census import, ~7 s; `lib/testing/exportBridge.js` calls this once per
rail file, in a budgeted `beforeAll`) -- and prints ONE JSON line, last,
`{"answers": [...]}`, one answer per job, in order:

  {"kind": "md", "doc": {...}}
      -> {"markdown": "..."}                         (the ONE writer, for comparison)
  {"kind": "html", "doc": {...}}
      -> {"html": "<the sanitized body fragment>"}   (the writer's Markdown, rendered)
  {"kind": "page", "doc": {...}, "title": "..."}
      -> {"html": "<the standalone page>"}
  {"kind": "docx", "doc": {...}, "title": "..."}
      -> {"docx": "<base64 .docx>"}
  {"kind": "archive", "fmt": "md|html|json|docx",
   "folders": [{"id", "name", "parent"}],
   "notes": [{"id", "title", "folder", "doc", "tags"?, "ticker"?, "subtitle"?}],
   "attachments": [{"note", "sub", "name", "b64"}]}
      -> {"files": {name: base64}, "name": "<archive file name>"}

The archive job builds the library in an IN-MEMORY SQLite database with the real schema and
runs `notes_export.build_export_zip(..., fmt=)` -- the writer the export route calls.

⛔ THE CENSUS, NOT A HAND-PICKED VARIABLE (CLAUDE.md, "`C:\\data` IS REAL ON THIS BOX").
`import conftest` comes first: it pins every environment variable the AST census finds
naming a path under the shared data root to a per-process sandbox and arms the tripwire,
before any `api.*` import (`tests/test_notebook_bridges_pin_the_root.py` holds every bridge
to that). This bridge sets NO variable of its own: an archive job's attachment files are
written under `attachment_root()`, which the census has already pointed into the sandbox --
checked before the first write, and refused if it is not -- and they are deleted again
before the job answers, so `run_bridge` can release the empty sandbox.
"""
from __future__ import annotations

import base64
import json
import shutil
import sqlite3
import sys
import zipfile
from io import BytesIO
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import conftest  # noqa: E402,F401 -- the census and the tripwire, before any api.* import
from tools.bridge_sandbox import run_bridge  # noqa: E402 -- releases the census sandboxes on exit

_STAMP = "2026-09-01T00:00:00Z"
_USER = "u1"


def _archive(job) -> dict:
    from api.services.journal_two.attachment_root import attachment_root
    from api.services.journal_two.db import ensure_schema
    from api.services.journal_two.notes_export import build_export_zip

    root = Path(attachment_root()).resolve()
    sandbox = Path(conftest.SANDBOX_DATA_ROOT).resolve()
    if sandbox not in root.parents and root != sandbox:
        raise SystemExit(f"format_export_bridge: attachment root {root} is not inside the census sandbox")
    # `ensure_schema` stamps its one-shot migration flags into DATA_DIR -- the sandbox here.
    # Those, and the attachment tree this job writes, are removed again afterwards; anything
    # ELSE written into the sandbox is left where it is, as evidence (tools/bridge_sandbox.py).
    before = set(p.name for p in sandbox.iterdir())
    written: list[Path] = []
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    try:
        ensure_schema(conn)
        for a in job.get("attachments", []):
            target = root / _USER / "notes" / a["note"] / a["sub"] / a["name"]
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(base64.b64decode(a["b64"]))
            written.append(target)
        for f in job.get("folders", []):
            conn.execute(
                "INSERT INTO j2_note_folders (id, user_id, name, parent_id, created_at) VALUES (?,?,?,?,?)",
                (f["id"], _USER, f["name"], f.get("parent") or "", _STAMP))
        for n in job.get("notes", []):
            conn.execute(
                "INSERT INTO j2_notes (id, user_id, folder_id, title, subtitle, body_json, body_plain, tags,"
                " ticker, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (n["id"], _USER, n.get("folder"), n["title"], n.get("subtitle"), json.dumps(n["doc"]), "",
                 json.dumps(n.get("tags") or []), n.get("ticker"), _STAMP, _STAMP))
        conn.commit()
        blob, name = build_export_zip(_USER, conn=conn, fmt=job.get("fmt", "md"))
        with zipfile.ZipFile(BytesIO(blob)) as zf:
            files = {n: base64.b64encode(zf.read(n)).decode("ascii") for n in zf.namelist()}
        return {"files": files, "name": name}
    finally:
        conn.close()
        user_dir = root / _USER
        for path in written:
            path.unlink(missing_ok=True)
        if user_dir.exists():
            shutil.rmtree(user_dir, ignore_errors=True)
        try:
            root.rmdir()
        except OSError:
            pass
        for p in sandbox.iterdir():
            if p.name not in before and p.is_file() and p.name.startswith(".notebook_migration_v"):
                p.unlink(missing_ok=True)


def _answer(job) -> dict:
    from api.services.journal_two import notes_export_formats as formats
    from api.services.journal_two.notes_export import tiptap_to_markdown

    kind = job.get("kind")
    if kind == "md":
        return {"markdown": tiptap_to_markdown(job["doc"])}
    if kind == "html":
        return {"html": formats.markdown_to_html(tiptap_to_markdown(job["doc"]))}
    if kind == "page":
        return {"html": formats.note_html(job["doc"], resolver=None, title=job.get("title") or "Untitled")}
    if kind == "docx":
        blob = formats.note_docx(job["doc"], title=job.get("title") or "Untitled")
        return {"docx": base64.b64encode(blob).decode("ascii")}
    if kind == "archive":
        return _archive(job)
    raise SystemExit(f"format_export_bridge: unknown job kind {kind!r}")


def main() -> int:
    jobs = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    if not isinstance(jobs, list):
        raise SystemExit("format_export_bridge: send a JSON LIST of jobs")
    answers = [_answer(job) for job in jobs]
    sys.stdout.write("\n" + json.dumps({"answers": answers}) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(run_bridge(main))
