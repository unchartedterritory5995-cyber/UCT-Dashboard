"""THROWAWAY (never merged): each mutant of the bars-history origin change must turn its rail red."""
import os
import shutil
import subprocess
import sys
import tempfile
import pathlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAILS = ["tests/test_bars_history_origin_fast.py", "tests/test_history_prewarm.py"]

MUTANTS = {
    "M1 origin build on the DEFAULT pool": ("api/routers/bars.py",
        "    resp = await _history_thread(_serve_and_pack)\n",
        "    from starlette.concurrency import run_in_threadpool as _rit\n    resp = await _rit(_serve_and_pack)\n"),
    "M2 service gate back to sync": ("api/bars_auth.py",
        "async def require_bars_service(", "def require_bars_service("),
    "M3 no single-flight": ("api/routers/bars.py",
        "    fut = flights.get(key)\n    if fut is not None:", "    fut = None\n    if fut is not None:"),
    "M4 memo keeps a non-public answer": ("api/routers/bars.py",
        ' or not cc.startswith("public"):', ':'),
    "M5 fallback not marked": ("api/routers/bars.py",
        "            fell_back = True  #", "            fell_back = False  #"),
    "M6 fallback partial keeps immutable": ("api/routers/bars.py",
        "        out.headers[\"Cache-Control\"] = \"no-store\"\n        out.headers[\"X-Bars-History\"] = \"partial\"",
        "        out.headers[\"X-Bars-History\"] = \"partial\""),
    "M7 prewarm M restated 2000": ("api/services/history_prewarm.py",
        "from api.services.deep_history_warm import _DEEP_TARGET as _FULL  # noqa: E402",
        "_FULL = {\"D\": 12500, \"W\": 4000, \"M\": 2000}"),
}


def _run(tree):
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    return subprocess.run([sys.executable, "-m", "pytest", "-q", "-x", "-p", "no:cacheprovider", *RAILS],
                          cwd=tree, env=env, capture_output=True, text=True, timeout=600)


@pytest.fixture(scope="module")
def tree():
    d = tempfile.mkdtemp(prefix="mut-")
    shutil.copytree(ROOT, d, dirs_exist_ok=True, symlinks=True,
                    ignore=shutil.ignore_patterns(".git", "node_modules", "__pycache__", "dist", "external"))
    (pathlib.Path(d) / "tests" / "test_zz_mutants_tmp.py").unlink()
    yield pathlib.Path(d)
    shutil.rmtree(d, ignore_errors=True)


def test_control_the_rails_are_green_unmutated(tree):
    r = _run(tree)
    assert r.returncode == 0, r.stdout[-3000:]


@pytest.mark.parametrize("name", list(MUTANTS))
def test_mutant_is_killed(tree, name):
    rel, a, b = MUTANTS[name]
    p = tree / rel
    orig = p.read_text(encoding="utf-8")
    assert orig.count(a) == 1, f"{name}: anchor not found once"
    p.write_text(orig.replace(a, b), encoding="utf-8")
    try:
        r = _run(tree)
    finally:
        p.write_text(orig, encoding="utf-8")
    print(name, "->", r.stdout.strip().splitlines()[-1] if r.stdout.strip() else r.stderr[-300:])
    assert r.returncode != 0, f"{name} SURVIVED:\n{r.stdout[-2000:]}"
