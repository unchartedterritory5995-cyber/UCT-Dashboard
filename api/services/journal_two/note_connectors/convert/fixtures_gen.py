"""Cross-language schema-rail fixture generator.

Walks every `*.md` file in `convert/fixtures_in/` (sorted by filename), runs
each through `mddoc.md_to_tiptap`, and writes the full `{doc, media, links}`
result as JSON to:

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

from .mddoc import md_to_tiptap

_HERE = pathlib.Path(__file__).resolve().parent
FIXTURES_IN_DIR = _HERE / "fixtures_in"

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
) -> list[pathlib.Path]:
    """Regenerates every fixture JSON under `out_dir` from every `*.md` file
    under `in_dir`. Returns the sorted list of paths written. `out_dir` is
    created if missing; existing files not matching a current input stem are
    left alone (a removed fixture input is a deliberate follow-up deletion,
    not something this function silently prunes)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[pathlib.Path] = []
    for md_path in sorted(in_dir.glob("*.md")):
        result = md_to_tiptap(md_path.read_text(encoding="utf-8"))
        out_path = out_dir / f"{md_path.stem}.json"
        out_path.write_text(_render(result), encoding="utf-8", newline="\n")
        written.append(out_path)
    return written


if __name__ == "__main__":
    for path in generate():
        print(f"wrote {path}")
