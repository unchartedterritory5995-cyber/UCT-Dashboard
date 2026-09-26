"""The REAL Markdown exporter, callable from a JS rail.

Reads one TipTap document as JSON on stdin and prints
`{"markdown": tiptap_to_markdown(doc)}` on stdout. Used by the wave-6 editor
rails (e.g. `lib/calloutNode.variant.test.js`) to push a document the editor
built through `api/services/journal_two/notes_export.py` and read the result
back through the importer -- the round trip crosses both runtimes, so neither
half is a hand-typed stand-in for the other (the gap
`importer/exportRoundtrip.test.js` exists to close, per its own header).

⛔ No resolver is passed, so nothing here touches an attachment root, a
database, or any path under the shared data root: it is a pure function of the
document on stdin.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))


def main() -> int:
    from api.services.journal_two.notes_export import tiptap_to_markdown

    doc = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    sys.stdout.buffer.write(json.dumps({"markdown": tiptap_to_markdown(doc)}).encode("utf-8"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
