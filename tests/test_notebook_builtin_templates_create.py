"""Wave 10 lane DR-C (design finding D-4, breadth) -- the CREATE-PATH half of
the guarantee that every built-in template is buildable.

`app/src/pages/journal-2-0/lib/notebookTemplates.buildable.test.js` proves
each template's body survives the real editor's `Schema.nodeFromJSON` (the
call TipTap makes when it OPENS a note). This file proves the other end: that
the SERVER accepts a note created from that exact body, through the real
`POST /api/j2/notes` route -- the same "wave 10 10C" refusal
(`notes.py::_refuse_unbuildable`) that turns a genuinely unbuildable body into
a failed create rather than a note the editor can never open again.

⛔ THE CATALOG IS READ, NEVER RESTATED. `notebookTemplates.js` has no static
imports it can be read with by plain Node (unlike `notebookSchema.js`, which
declares that constraint explicitly) -- it imports `tiptapDocBuilders.js` with
an extensionless relative specifier, which Vite resolves and Node's ESM loader
refuses. So this reads it the way the BUNDLE reads it: `esbuild` (already a
transitive dependency of this repo's own frontend build) bundles the module
and its import into one file, and Node evaluates that -- never a hand-copied
list of bodies that could drift from the source the picker actually renders.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.services import auth_db
from api.services.journal_two.db import ensure_schema as j2_ensure_schema
from api.services.journal_two.notes import UNBUILDABLE_BODY_DETAIL, _refuse_unbuildable

TEMPLATES_MODULE = Path("app/src/pages/journal-2-0/lib/notebookTemplates.js")


def _bundled_templates(path: Path = TEMPLATES_MODULE) -> list[dict]:
    """`[{key, body}]` for every built-in template's `build({})` -- read by
    bundling the real module with esbuild and importing the result, so this
    can NEVER see a body the picker itself would not produce."""
    node = shutil.which("node")
    assert node, "node is not on PATH -- this rail reads the real catalog, and a rail that cannot run is not a gate"
    esbuild = shutil.which("esbuild")
    if not esbuild:
        for candidate in ("app/node_modules/.bin/esbuild.cmd", "app/node_modules/.bin/esbuild"):
            if Path(candidate).exists():
                esbuild = str(Path(candidate).resolve())
                break
    assert esbuild, "esbuild is not reachable (checked PATH and app/node_modules/.bin) -- cannot bundle the real catalog"
    build = subprocess.run(
        [esbuild, str(path), "--bundle", "--format=esm", "--platform=neutral", "--target=es2022"],
        capture_output=True, timeout=120,
    )
    assert build.returncode == 0, f"esbuild could not bundle {path}: {build.stderr.decode('utf-8', errors='replace')[:2000]}"
    # ⛔ NOT a `-e` argument holding the (base64'd) bundle: at 25 templates the
    # bundle is ~29 KB, which blows Windows' ~32K CreateProcess command-line
    # ceiling (measured: `WinError 206`, "The filename or extension is too
    # long"). Two small FILES, one importing the other by a real relative
    # path, sidesteps the limit entirely.
    with tempfile.TemporaryDirectory() as tmp:
        bundle_path = Path(tmp) / "bundle.mjs"
        bundle_path.write_bytes(build.stdout)
        runner_path = Path(tmp) / "runner.mjs"
        runner_path.write_text(
            "import { TEMPLATES } from './bundle.mjs';\n"
            "process.stdout.write(JSON.stringify(TEMPLATES.map((t) => ({key: t.key, body: t.build({})}))));\n",
            encoding="utf-8",
        )
        r = subprocess.run([node, str(runner_path)], capture_output=True, timeout=120, cwd=tmp)
    err = r.stderr.decode("utf-8", errors="replace")
    assert r.returncode == 0, f"node could not evaluate the bundled catalog: {err[:2000]}"
    out = json.loads(r.stdout.decode("utf-8", errors="replace"))
    assert isinstance(out, list) and len(out) >= 20, f"suspiciously small catalog read: {len(out)}"
    return out


@pytest.fixture(scope="module")
def templates():
    return _bundled_templates()


def test_non_vacuity_the_real_catalog_was_read(templates):
    keys = {t["key"] for t in templates}
    # Non-vacuity against a HAND-TYPED anchor, never the module's own count --
    # a broken read that returned an empty array would make every check below
    # trivially true.
    for k in ("daily-prep", "tilt-log", "trade-plan", "mistake-log"):
        assert k in keys, sorted(keys)
    for t in templates:
        assert t["body"]["type"] == "doc"
        assert isinstance(t["body"].get("content"), list) and t["body"]["content"]


def test_every_built_in_template_passes_the_create_path_guard_directly(templates):
    """The exact function `POST /api/j2/notes` calls before it will store
    anything (`_refuse_unbuildable`) -- called directly, no HTTP round trip."""
    for t in templates:
        _refuse_unbuildable(t["body"])  # raises NoteValidationError on failure


def test_CONTROL_the_guard_can_actually_fail(templates):
    """Non-vacuity for the assertion above: a body shaped exactly like the H14
    hazard (an empty text node) is refused by the SAME function."""
    from api.services.journal_two.notes import NoteValidationError
    bad = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": ""}]}]}
    with pytest.raises(NoteValidationError):
        _refuse_unbuildable(bad)


# ── the create path itself -- POST /api/j2/notes, for real ───────────────────

@pytest.fixture
def client(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    conn = auth_db.get_connection()
    j2_ensure_schema(conn)
    conn.close()
    from api.routers import journal_two as j2_router
    fa = FastAPI()
    fa.include_router(j2_router.router)
    fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": "u1", "role": "member"}
    yield TestClient(fa)
    fa.dependency_overrides.clear()


def test_every_built_in_template_creates_a_note_through_the_real_route(client, templates):
    """The end-to-end guarantee: a member picking ANY built-in template gets a
    created note back, never a 400 -- through the identical door the gallery's
    `onPick` uses (`createNoteViaApi` -> `POST /api/j2/notes`)."""
    failures = []
    created_ids = []
    for t in templates:
        r = client.post("/api/j2/notes", json={"title": f"Template check — {t['key']}", "bodyJson": t["body"]})
        if r.status_code != 200:
            failures.append(f"{t['key']}: {r.status_code} {r.text[:200]}")
        else:
            created_ids.append(r.json()["note"]["id"])
    assert failures == []
    # non-vacuity: it actually created something, and every id is distinct
    assert len(created_ids) == len(templates)
    assert len(set(created_ids)) == len(created_ids)


def test_CONTROL_the_create_route_refuses_a_body_the_editor_cannot_open(client):
    """The same route, on a body shaped like the H14 hazard: 400, the
    member-facing sentence, and nothing stored."""
    bad = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": ""}]}]}
    r = client.post("/api/j2/notes", json={"title": "should not save", "bodyJson": bad})
    assert r.status_code == 400, r.text
    assert r.json()["detail"] == UNBUILDABLE_BODY_DETAIL
