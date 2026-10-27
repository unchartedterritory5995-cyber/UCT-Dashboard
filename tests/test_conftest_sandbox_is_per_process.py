"""The repo-root conftest's sandbox is per PROCESS: a child that inherits a pytest
session's environment (an xdist worker, exactly) must not land on the parent's files.

⛔ WHAT THIS RAILS. An xdist controller imports `conftest.py` first and pins ~115 data
env vars into ITS `uct_tests_datadir_*`. The workers it spawns inherit those values, and
`_redirect_shared_root_env_vars` skipped every one as "already safe" (safe for C:\\data,
yes; not safe from the other worker). So both workers shared one set of files, and their
import-time schema writers raced while collecting `api.main` -- intermittently, as
`sqlite3.OperationalError: database is locked` at `api/flow_db.py`'s
`PRAGMA journal_mode=WAL` (two processes, one fresh file: 30 of 80 failed; one file each:
0 of 80).

The child here is spawned the way a worker is: this session's environment, unchanged,
then `import pytest, conftest`. A developer's own override (a pin pointed somewhere that is
no sandbox) is the control: it must survive untouched, or the fix just repoints everything.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import conftest as rootconf

ROOT = Path(__file__).resolve().parents[1]

#: The pin whose shared file raced (`api/flow_router.py` -> `FlowDB(DB_PATH)` at import).
RACED = "FLOW_DB_PATH"
#: The control: pointed by hand at a non-sandbox path, which the child must keep.
OVERRIDDEN = "BREADTH_MONITOR_DB"

CHILD = r'''
import json, os, sys
sys.path.insert(0, sys.argv[1])
import pytest  # noqa: F401 -- an xdist worker has pytest loaded before conftest
import conftest
print(json.dumps({
    "root": conftest.SANDBOX_DATA_ROOT,
    "auth_dir": os.path.dirname(conftest.ISOLATED_AUTH_DB),
    "pins": {k: os.environ.get(k) for k in conftest.SHARED_DATA_ENV_PINS},
}))
'''


def _inside(path, root) -> bool:
    if not path:
        return False
    p = os.path.normcase(os.path.abspath(path))
    r = os.path.normcase(os.path.abspath(root))
    return p == r or p.startswith(r + os.sep)


def test_a_child_of_this_session_gets_its_own_sandbox_not_this_ones(tmp_path):
    assert RACED in rootconf.SHARED_DATA_ENV_PINS and OVERRIDDEN in rootconf.SHARED_DATA_ENV_PINS
    parent_root = rootconf.SANDBOX_DATA_ROOT
    parent_auth = os.path.dirname(rootconf.ISOLATED_AUTH_DB)
    inherited = {k: os.environ.get(k) for k in rootconf.SHARED_DATA_ENV_PINS}
    in_parent = sorted(k for k, v in inherited.items()
                       if _inside(v, parent_root) or _inside(v, parent_auth))
    # NON-VACUITY: the inheritance under test is real -- this session's own pins point
    # into its own sandbox, the raced one included, so the child DOES inherit them.
    assert RACED in in_parent, f"{RACED}={inherited[RACED]!r} is not in {parent_root}"
    assert len(in_parent) >= 50, in_parent

    override = str(tmp_path / "developer_override" / "breadth_monitor.db")
    env = dict(os.environ)
    env.pop("PYTEST_CURRENT_TEST", None)
    env[OVERRIDDEN] = override
    script = tmp_path / "child.py"
    script.write_text(CHILD, encoding="utf-8")
    out = subprocess.run([sys.executable, str(script), str(ROOT)], cwd=str(tmp_path), env=env,
                         capture_output=True, text=True, encoding="utf-8", errors="replace",
                         timeout=600)
    assert out.returncode == 0, out.stderr[-3000:]
    got = json.loads(out.stdout.strip().splitlines()[-1])
    try:
        assert os.path.normcase(got["root"]) != os.path.normcase(parent_root)
        shared = sorted(k for k, v in got["pins"].items()
                        if _inside(v, parent_root) or _inside(v, parent_auth))
        assert shared == [], (
            f"{len(shared)} pins in the child still point into the PARENT's sandbox "
            f"(two xdist workers would share these files): {shared[:12]}")
        assert _inside(got["pins"][RACED], got["root"]), got["pins"][RACED]
        # CONTROL: an override that is no sandbox's is the developer's, and is kept.
        assert got["pins"][OVERRIDDEN] == override
    finally:
        for d in (got["root"], got["auth_dir"]):
            if os.path.basename(d).startswith(rootconf.SANDBOX_PREFIXES):
                shutil.rmtree(d, ignore_errors=True)


def test_the_foreign_sandbox_predicate_names_only_another_sessions_sandbox(tmp_path):
    tmp = tempfile.gettempdir()
    own_root = rootconf.SANDBOX_DATA_ROOT
    own_auth = os.path.dirname(rootconf.ISOLATED_AUTH_DB)
    f = rootconf._in_foreign_sandbox
    assert f(os.path.join(tmp, "uct_tests_datadir_SOMEONEELSE", "flow.db"))
    assert f(os.path.join(tmp, "uct_tests_authdb_SOMEONEELSE", "auth.db"))
    assert not f(os.path.join(own_root, "flow.db"))
    assert not f(os.path.join(own_auth, "auth.db"))
    assert not f(str(tmp_path / "flow.db"))                       # pytest's tmp_path
    assert not f(os.path.join(tmp, "not_a_sandbox", "flow.db"))
    assert not f(os.path.join(os.path.dirname(os.path.abspath(tmp)) or "/", "elsewhere.db"))
