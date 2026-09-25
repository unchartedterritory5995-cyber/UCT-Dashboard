"""The REAL task extractor, callable from a JS rail (wave 6, lane D item 7).

Reads one TipTap document as JSON on stdin and prints
`{"tasks": note_tasks.extract_tasks(doc)}` on stdout, so a rail can push a
document the EDITOR built (a `dateMention` typed as `@tomorrow`) through lane
F's server-side reader and assert the due date it reads -- the contract checked
across both runtimes rather than against a hand-typed fixture on one side.

⛔ THE CENSUS, NOT A HAND-PICKED VARIABLE (CLAUDE.md, "`C:\\data` IS REAL ON THIS
BOX"; wave 7 lane J, J1). `extract_tasks` is a pure function of the document, but
its module imports `auth_db`, whose path is captured at import. This used to pin
`AUTH_DB_PATH` alone -- root cause 1, "`DATA_DIR` IS NOT AN AUTHORITY": the paths
resolve independently, so one hand-picked variable is the same defect with one
variable instead of zero. Importing the repo-root `conftest` pins EVERY variable
the AST census finds and arms the tripwire, before any `api.*` import.
`tests/test_notebook_bridges_pin_the_root.py` runs this bridge from a clean
environment and reads the tripwire's record.
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
    from api.services.journal_two.note_tasks import extract_tasks

    doc = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    sys.stdout.buffer.write(json.dumps({"tasks": extract_tasks(doc)}).encode("utf-8"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
