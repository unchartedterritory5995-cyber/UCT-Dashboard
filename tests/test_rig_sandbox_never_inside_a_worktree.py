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


# ─── ⛔⛔ AND A SANDBOX DIRECTORY IS NOT A SANDBOX (2026-09-18) ───────────────
#
# The tests above prove WHERE the sandbox goes. They say nothing about whether
# the app actually writes there, and until this was added the answer was mostly
# no: `main()` pinned `DATA_DIR` and `AUTH_DB_PATH` and nothing else, while the
# census over `api/**` names 77 environment variables that resolve shared-root
# paths INDEPENDENTLY of `DATA_DIR`. `/data` is a real directory on this box, so
# each unpinned one resolved to the owner's live files.
#
# ⚰️ The one that mattered here: the member door's "Add this script to my chart"
# POSTs to `/api/user-definitions`, whose store reads
# `USER_DEFINITIONS_DB_PATH` with the default `/data/user_definitions.db`. A
# successful attach on the rig would have written a member definition into
# production. It never happened — the pane flag was off during the 2026-09-17
# capture, so the button was not on screen — which is luck, not design.
#
# ⭐ THE CHECK IS ON THE APPLIED ENVIRONMENT, NOT ON THE SOURCE TEXT. A grep for
# `apply_sandbox_env` would pass on a call that was made and then overwritten
# two lines later; this runs the door and reads what the variables say.

def _pins(tmp_path):
    import importlib
    import sys
    sys.path.insert(0, str(REPO))
    hub = importlib.import_module("scripts.hub_sandbox_boot")
    return hub, hub.apply_sandbox_env(str(tmp_path / "rig-data"),
                                      test_email="panetest@local.dev",
                                      reclaim_conftest_temp=False)


def test_the_rig_uses_the_census_door_and_pins_the_store_the_member_door_writes(tmp_path):
    hub, pins = _pins(tmp_path)
    # ⛔ NON-VACUITY FIRST. An empty pin map satisfies every "none of them points
    # at C:\data" assertion ever written.
    assert len(pins) > 50, f"the census returned only {len(pins)} pins"
    assert "USER_DEFINITIONS_DB_PATH" in pins, sorted(pins)[:10]

    import conftest
    for var, target in pins.items():
        for root in conftest.SHARED_DATA_ROOTS:
            assert not str(target).lower().startswith(str(root).lower()), \
                f"{var} still resolves inside the shared root: {target}"


def test_boot_rig_applies_that_door_before_it_serves(tmp_path):
    """The rig's own `main()` must reach it — a door nobody opens is no door.

    ⛔ READ AS A CALL GRAPH, NOT AS A STRING. The assertion is that `main`
    contains a call to `apply_sandbox_env` and that the call happens BEFORE
    `uvicorn.run`: pinning after the app has imported reaches nothing, because
    these paths are captured at module import.
    """
    import ast
    tree = ast.parse(BOOT.read_text(encoding="utf-8"))
    main = next(n for n in tree.body
                if isinstance(n, ast.FunctionDef) and n.name == "main")
    calls = [(n.lineno, n.func.attr) for n in ast.walk(main)
             if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)]
    named = [c[1] for c in calls]
    # Non-vacuity: the probe can see the call that was always there.
    assert "run" in named, named
    assert "apply_sandbox_env" in named, named
    pin_line = min(l for l, a in calls if a == "apply_sandbox_env")
    serve_line = min(l for l, a in calls if a == "run")
    assert pin_line < serve_line, (pin_line, serve_line)
