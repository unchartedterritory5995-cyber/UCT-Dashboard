"""The REAL Markdown exporter, callable from a JS rail.

Reads one TipTap document as JSON on stdin and prints
`{"markdown": tiptap_to_markdown(doc)}` on stdout. Used by the wave-6 editor
rails (e.g. `lib/calloutNode.variant.test.js`) to push a document the editor
built through `api/services/journal_two/notes_export.py` and read the result
back through the importer -- the round trip crosses both runtimes, so neither
half is a hand-typed stand-in for the other (the gap
`importer/exportRoundtrip.test.js` exists to close, per its own header).

No resolver is passed, so the exporter itself touches no attachment root and no
database: it is a pure function of the document on stdin -- TODAY.

⛔ THE CENSUS, NOT A HAND-PICKED VARIABLE (CLAUDE.md, "`C:\\data` IS REAL ON THIS
BOX"; wave 7 lane J, J1). "Pure today" is one import away from not being: this
process is not under pytest, so nothing else pins the paths `api.*` modules
capture at import. Importing the repo-root `conftest` pins every environment
variable the AST census finds naming a path under the shared data root to a
sandbox and arms the tripwire -- BEFORE any `api.*` import, the way
`selection_export_bridge.py` does. It costs a few seconds per spawn.
`tests/test_notebook_bridges_pin_the_root.py` fails if a bridge stops doing this.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import conftest  # noqa: E402,F401 -- the census and the tripwire, before any api.* import


def main() -> int:
    from api.services.journal_two.notes_export import tiptap_to_markdown

    doc = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    sys.stdout.buffer.write(json.dumps({"markdown": tiptap_to_markdown(doc)}).encode("utf-8"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
