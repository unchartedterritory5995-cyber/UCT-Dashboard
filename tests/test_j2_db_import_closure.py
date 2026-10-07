"""The Journal schema layer imports no web framework.

`api/services/journal_two/db.py::ensure_schema` is called by every process that opens the
database: the web pod, the workers, and the session fixture in `tests/conftest.py` that every
test in this repo runs behind. The `master deploy gate` and `vite build args` workflows run
pytest with no fastapi installed, so one framework import anywhere in what `ensure_schema`
loads turns every test into a fixture error and blocks promotion.

That happened on the wave 12 to 15 landing: `ensure_schema` imported `template_gallery`,
which imported `public_note_payload`, which imported fastapi at module level (CI run
37307749617, 11 errors). The fix moved those imports into the four response helpers.

This rail runs `ensure_schema` in a child interpreter where importing fastapi or starlette
RAISES, so it reads the same on a box that has them installed and on one that does not.
It also checks the firm templates were seeded: the seed calls the public reducer and
swallows its own errors, so a blocked import there would otherwise pass silently.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
BLOCKED = ("fastapi", "starlette")

_BLOCKER = f"""
import sys
BLOCKED = {BLOCKED!r}

class _Refuse:
    def find_spec(self, name, path=None, target=None):
        if name.split('.')[0] in BLOCKED:
            raise ImportError('BLOCKED-BY-RAIL: ' + name)
        return None

for _m in [m for m in sys.modules if m.split('.')[0] in BLOCKED]:
    del sys.modules[_m]
sys.meta_path.insert(0, _Refuse())
"""

_SCHEMA = _BLOCKER + """
import sqlite3
from api.services.journal_two import db as j2db

conn = sqlite3.connect(':memory:')
conn.row_factory = sqlite3.Row
j2db.ensure_schema(conn)
seeded = conn.execute("SELECT COUNT(*) FROM j2_template_gallery WHERE kind = 'firm'").fetchone()[0]
reached = sorted(m for m in sys.modules if m.split('.')[0] in BLOCKED)
print('SEEDED=%d' % seeded)
print('REACHED=%r' % (reached,))
"""


def _run(code: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, "-c", code], cwd=str(REPO), capture_output=True,
                          text=True, encoding="utf-8", errors="replace", timeout=300)


def test_ensure_schema_runs_with_fastapi_and_starlette_unimportable():
    r = _run(_SCHEMA)
    out = r.stdout + r.stderr
    assert r.returncode == 0, f"ensure_schema needs a web framework to import:\n{out[-3000:]}"
    assert "BLOCKED-BY-RAIL" not in out, f"a swallowed framework import:\n{out[-3000:]}"
    assert "firm seed skipped" not in out, f"the firm-template seed did not run:\n{out[-3000:]}"
    assert "REACHED=[]" in r.stdout, out[-3000:]
    seeded = int(r.stdout.split("SEEDED=")[1].split()[0])
    assert seeded > 0, "no firm template was seeded, so the reducer path was not exercised"


def test_control_the_blocker_can_fire():
    """The same child, importing fastapi on purpose: it must fail, and say why."""
    r = _run(_BLOCKER + "\nimport fastapi\n")
    assert r.returncode != 0
    assert "BLOCKED-BY-RAIL: fastapi" in r.stderr
