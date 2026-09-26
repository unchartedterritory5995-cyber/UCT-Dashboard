"""The REAL task extractor, callable from a JS rail (wave 6, lane D item 7).

Reads one TipTap document as JSON on stdin and prints
`{"tasks": note_tasks.extract_tasks(doc)}` on stdout, so a rail can push a
document the EDITOR built (a `dateMention` typed as `@tomorrow`) through lane
F's server-side reader and assert the due date it reads -- the contract checked
across both runtimes rather than against a hand-typed fixture on one side.

⛔ `extract_tasks` is a pure function of the document. Its module imports
`auth_db`, whose path is captured at import, so AUTH_DB_PATH is pointed at a
throwaway location FIRST: nothing here can resolve to the shared data root.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))


def main() -> int:
    os.environ["AUTH_DB_PATH"] = os.path.join(tempfile.gettempdir(), "note_tasks_bridge_never_opened.db")
    from api.services.journal_two.note_tasks import extract_tasks

    doc = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    sys.stdout.buffer.write(json.dumps({"tasks": extract_tasks(doc)}).encode("utf-8"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
