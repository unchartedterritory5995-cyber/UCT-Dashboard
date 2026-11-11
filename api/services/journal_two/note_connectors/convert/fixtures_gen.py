"""Cross-language schema-rail fixture generator.

Walks every `*.md` and `*.html` file in `convert/fixtures_in/` (sorted by
filename across both extensions together), runs each through the matching
converter — `mddoc.md_to_tiptap` for `.md`, `mddoc.html_to_tiptap` for
`.html` (the Dropbox connector's own walker; same `{doc, media, links}`
output shape, see that function's docstring) — and writes the full result as
JSON to:

    app/src/pages/journal-2-0/lib/importer/__fixtures__/server_convert/<stem>.json

`serverConvert.contract.test.js` (vitest) then loads every one of those JSON
files through the REAL editor schema (`getSchema(resolveExtensions(
buildExtensions()))` + `schema.nodeFromJSON(fixture.doc)`) and a render smoke
via `generateHTML` — so a Python converter change that emits a node/mark/attr
shape the JS schema doesn't recognize turns CI red on the JS side, not just
silently drifts. `test_note_convert_fixtures.py` (pytest) is the other half:
it asserts regenerating into a temp dir reproduces the COMMITTED fixtures
byte-for-byte, so an uncommitted regeneration (drift) is caught on the Python
side too.

Determinism: `md_to_tiptap` itself is deterministic per input (media/links
are appended in encounter order; the only `set` in its `_Ctx` — `media_refs`
— is a membership guard, never iterated for output order). This module adds
`sort_keys=True` + a fixed `indent`/newline convention on top so regeneration
is BYTE-IDENTICAL across runs/machines regardless of any future change to
that ordering guarantee — the byte-stability the drift detector depends on.

Runnable directly:
    python -m api.services.journal_two.note_connectors.convert.fixtures_gen
"""

from __future__ import annotations

import json
import pathlib

from .mddoc import html_to_tiptap, md_to_tiptap

_HERE = pathlib.Path(__file__).resolve().parent
FIXTURES_IN_DIR = _HERE / "fixtures_in"
# Plan E Task 4: the ENML parity rail's inputs (`<stem>.enml` + `<stem>.note.json`), run through
# `enml.enml_to_tiptap` and written as `enml-<stem>.json`, so every node the Evernote converter
# emits also passes the real editor schema. One copy of the inputs, shared with that rail.
ENML_FIXTURES_IN_DIR = _HERE / "enml_fixtures_in"

# api/services/journal_two/note_connectors/convert/fixtures_gen.py
#   -> convert -> note_connectors -> journal_two -> services -> api -> <repo root>
_REPO_ROOT = _HERE.parents[4]
FIXTURES_OUT_DIR = (
    _REPO_ROOT
    / "app"
    / "src"
    / "pages"
    / "journal-2-0"
    / "lib"
    / "importer"
    / "__fixtures__"
    / "server_convert"
)


def _render(result: dict) -> str:
    return json.dumps(result, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def generate(
    out_dir: pathlib.Path = FIXTURES_OUT_DIR,
    in_dir: pathlib.Path = FIXTURES_IN_DIR,
    enml_dir: pathlib.Path = ENML_FIXTURES_IN_DIR,
) -> list[pathlib.Path]:
    """Regenerates every fixture JSON under `out_dir` from every `*.md`/
    `*.html` file under `in_dir`. Returns the sorted list of paths written
    (sorted by filename across both extensions together, so e.g. a future
    `05b-*.html` would still land between `05-*.md` and `06-*.md`). `out_dir`
    is created if missing; existing files not matching a current input stem
    are left alone (a removed fixture input is a deliberate follow-up
    deletion, not something this function silently prunes)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[pathlib.Path] = []
    in_paths = sorted(
        (*in_dir.glob("*.md"), *in_dir.glob("*.html")), key=lambda p: p.name,
    )
    for in_path in in_paths:
        text = in_path.read_text(encoding="utf-8")
        result = html_to_tiptap(text) if in_path.suffix == ".html" else md_to_tiptap(text)
        out_path = out_dir / f"{in_path.stem}.json"
        out_path.write_text(_render(result), encoding="utf-8", newline="\n")
        written.append(out_path)
    written.extend(_generate_enml(out_dir, enml_dir))
    return written


def _generate_enml(out_dir: pathlib.Path, enml_dir: pathlib.Path) -> list[pathlib.Path]:
    """The `.enml` branch (Plan E Task 4)."""
    from .enml import enml_to_tiptap  # local: keeps this module's import cost for md/html callers

    written: list[pathlib.Path] = []
    for in_path in sorted(enml_dir.glob("*.enml")):
        note = json.loads((enml_dir / f"{in_path.stem}.note.json").read_text(encoding="utf-8"))
        resources = [{"id": str(i), "hash": r["hash"], "mime": r["mime"], "name": r.get("name")}
                     for i, r in enumerate(note.get("resources") or [])]
        text = in_path.read_text(encoding="utf-8").replace("\r\n", "\n").rstrip("\n")
        result = enml_to_tiptap(text, resources or None, note_guid=note["guid"],
                                source_url=note.get("sourceUrl"))
        out_path = out_dir / f"enml-{in_path.stem}.json"
        out_path.write_text(_render(result), encoding="utf-8", newline="\n")
        written.append(out_path)
    return written


if __name__ == "__main__":
    for path in generate():
        print(f"wrote {path}")
