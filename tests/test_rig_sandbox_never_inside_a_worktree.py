"""⭐⭐ THE RIG SANDBOX MAY NEVER LAND INSIDE A GIT WORKTREE.

⚰️ `boot_rig.py` resolved its sandbox as ``__file__.parent / "rig-data"``. That
was correct while the script lived in a session scratchpad and became a trap the
moment it was committed to ``docs/pine/wip/rig/``: running it in place would have
written ``auth.db``, a bars cache and a dozen marker files INTO THE REPO —
untracked, and dirtying a tree whose cleanliness is the whole resume contract
(``git status`` is how the next session decides whether anything touched the
checkout while it was down).

⛔ IT WAS CAUGHT BEFORE IT RAN, WHICH IS NOT A GUARANTEE ABOUT NEXT TIME. So the
resolution is a REFUSAL with a test, the same shape ``conftest.py`` uses for
``C:\\data`` — a guard somebody has seen fire, not a comment asking politely.
"""
import importlib.util
import pathlib

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
BOOT = REPO / "docs" / "pine" / "wip" / "rig" / "boot_rig.py"


def _load():
    spec = importlib.util.spec_from_file_location("uct_boot_rig", BOOT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_the_script_is_where_the_runbook_says_it_is():
    # ⛔ Without this the whole file skips silently the day somebody moves it,
    # and a guard that cannot load is indistinguishable from a guard that passed.
    assert BOOT.is_file(), f"boot_rig.py is not at {BOOT}"


def test_a_sandbox_inside_this_worktree_is_REFUSED():
    mod = _load()
    inside = REPO / "docs" / "pine" / "wip" / "rig" / "rig-data"
    with pytest.raises(SystemExit) as exc:
        mod.rig_sandbox({"UCT_RIG_DATA": str(inside)})
    msg = str(exc.value)
    # ⭐ NAMED, not merely refused: the message carries the worktree it found and
    # the path it resolved, because "REFUSED" alone sends nobody anywhere.
    assert "REFUSED" in msg
    assert "UCT_RIG_DATA" in msg
    assert str(REPO) in msg.replace("/", "\\")


def test_the_repo_root_itself_is_REFUSED():
    mod = _load()
    with pytest.raises(SystemExit):
        mod.rig_sandbox({"UCT_RIG_DATA": str(REPO)})


def test_a_sandbox_OUTSIDE_every_worktree_is_allowed(tmp_path):
    # ⛔ THE NON-VACUITY HALF. A resolver that refused everything would pass both
    # cases above while making the rig unstartable.
    mod = _load()
    out = tmp_path / "rig-data"
    got = mod.rig_sandbox({"UCT_RIG_DATA": str(out)})
    assert pathlib.Path(got) == pathlib.Path(out).resolve() or str(out) in str(got)


def test_the_DEFAULT_is_outside_the_repo(tmp_path):
    # The default has to be safe on its own, because the failure mode this guards
    # is somebody running the script with no env set at all — which is exactly how
    # it would be run from a fresh checkout.
    mod = _load()
    got = mod.rig_sandbox({"LOCALAPPDATA": str(tmp_path)})
    assert str(REPO) not in str(got)
