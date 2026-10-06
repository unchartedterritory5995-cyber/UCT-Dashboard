"""⛔ The live server must never load the test ``conftest``.

``tools/ast_conformance.py`` is ALSO a production library:
``alert_user_series._conformance()`` imports it at user-formula alert-arm time,
inside the web process. Its former unconditional ``import conftest`` redirected
~100 data-path env vars (AUTH_DB_PATH, ALERT_SHADOW_DB_PATH, breadth DBs, …) to
temp sandboxes and armed the /data sqlite tripwire in PRODUCTION (since
0e7d0561a, 2026-10-01; hotfix 2d5080d5b).

The import is exercised in a FRESH interpreter, because under pytest the repo
conftest is already loaded and the bug cannot show.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

PROBE = r"""
import json, os, sys
sys.path.insert(0, {root!r})
sys.path.insert(0, os.path.join({root!r}, "tools"))
before = dict(os.environ)
import ast_conformance  # the server's own import, by path (alert_user_series._conformance)
moved = sorted(k for k in set(before) | set(os.environ) if before.get(k) != os.environ.get(k))
print(json.dumps({{"conftest": "conftest" in sys.modules, "moved": moved}}))
"""


def _probe(env_extra=None):
    env = {k: v for k, v in os.environ.items() if not k.startswith("PYTEST")}
    env.update(env_extra or {})
    out = subprocess.run([sys.executable, "-c", PROBE.format(root=str(ROOT))],
                         cwd=str(ROOT), env=env, capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr[-2000:]
    return json.loads(out.stdout.strip().splitlines()[-1])


def test_importing_ast_conformance_as_a_library_does_not_load_conftest():
    got = _probe({"AUTH_DB_PATH": "/data/auth.db"})
    assert got["conftest"] is False
    assert got["moved"] == [], f"a server-side import moved env vars: {got['moved'][:10]}"


def test_the_guard_still_loads_conftest_when_run_as_the_tool():
    # As a script the census + tripwire still apply (the tool's own contract).
    src = (ROOT / "tools" / "ast_conformance.py").read_text(encoding="utf-8")
    assert 'if __name__ == "__main__" or "pytest" in _uct_sys.modules' in src
