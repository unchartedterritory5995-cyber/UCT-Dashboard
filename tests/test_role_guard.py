"""The full application refuses to start inside the front-door service.

`docs/breadth/INC-1-second-app-instance.md`: a service whose start command did not take
effect came up SUCCESS as a second copy of the application. The front door runs the same
image as `web`, so the same mistake would do the same thing. `FRONT_UPSTREAM` exists only
on the front-door service, and `api/main.py` refuses to be imported where it is set.

Mutation proof (run before calling these done):
    1. make refuse_full_app_on_front_door a no-op      -> test_importing_the_full_app_fails... RED
    2. move the call below `app = FastAPI(`             -> test_the_guard_runs_before_the_app_exists RED
    3. treat a blank value as set                        -> test_blank_or_missing_is_not_the_front_door RED
"""
from __future__ import annotations

import ast
import os
import subprocess
import sys

import pytest

from api.services import role_guard

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_the_front_door_is_recognised_by_its_upstream():
    assert role_guard.is_front_door({"FRONT_UPSTREAM": "web.railway.internal:8080"}) is True
    with pytest.raises(RuntimeError, match="front door"):
        role_guard.refuse_full_app_on_front_door({"FRONT_UPSTREAM": "web.railway.internal:8080"})


@pytest.mark.parametrize("environ", [{}, {"FRONT_UPSTREAM": ""}, {"FRONT_UPSTREAM": "   "}, {"OTHER": "x"}])
def test_blank_or_missing_is_not_the_front_door(environ):
    assert role_guard.is_front_door(environ) is False
    role_guard.refuse_full_app_on_front_door(environ)      # must not raise


def test_the_module_needs_nothing_from_the_application():
    """It runs before everything else in api/main.py, so it may import nothing heavy."""
    with open(os.path.join(ROOT, "api", "services", "role_guard.py"), encoding="utf-8") as f:
        tree = ast.parse(f.read())
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported |= {a.name.split(".")[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom):
            imported.add((node.module or "").split(".")[0])
    assert imported <= {"os", "__future__"}, imported


def test_the_guard_runs_before_the_app_exists():
    """In api/main.py the call must come before the application object is created and
    before FastAPI is even imported: nothing may start first."""
    with open(os.path.join(ROOT, "api", "main.py"), encoding="utf-8") as f:
        tree = ast.parse(f.read())
    call_line = fastapi_line = app_line = None
    for node in tree.body:
        if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Call)
                and isinstance(node.value.func, ast.Name)
                and node.value.func.id == "_refuse_full_app_on_front_door" and call_line is None):
            call_line = node.lineno
        if isinstance(node, ast.ImportFrom) and (node.module or "").split(".")[0] == "fastapi" and fastapi_line is None:
            fastapi_line = node.lineno
        if (isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "app" for t in node.targets)
                and app_line is None):
            app_line = node.lineno
    assert call_line is not None, "api/main.py no longer calls the front-door guard at module level"
    assert fastapi_line is not None and app_line is not None, "the reader no longer finds FastAPI or `app` in api/main.py"
    assert call_line < fastapi_line < app_line, (call_line, fastapi_line, app_line)


def test_importing_the_full_app_fails_where_the_front_door_runs():
    """The real thing, in a real process: `import api.main` with FRONT_UPSTREAM set must exit
    non-zero with the message, and fast (before the heavy imports)."""
    env = {**os.environ, "FRONT_UPSTREAM": "web.railway.internal:8080", "PYTHONDONTWRITEBYTECODE": "1"}
    proc = subprocess.run([sys.executable, "-c", "import api.main"], cwd=ROOT, env=env,
                          capture_output=True, text=True, timeout=120)
    assert proc.returncode != 0
    assert "Refusing to start a second copy of the application" in proc.stderr
    assert "front_app" in proc.stderr
