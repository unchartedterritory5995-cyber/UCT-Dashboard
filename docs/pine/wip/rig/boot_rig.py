"""Boot the app on port 8129 with every data path pinned into a sandbox.

⛔ NOT PORT 8077. That port has held a stale backend on the owner's LIVE
`C:\\data`, and `C:\\data` exists on this box — a rig that reaches it is writing
to production files for the length of a screenshot.

⛔⛔ AND THE SANDBOX MAY NOT LIVE INSIDE A GIT WORKTREE. This script used to
resolve it as `__file__.parent / "rig-data"`, which was correct while it lived in
a session scratchpad and became a trap the moment it was committed here: running
it in place would have written `auth.db`, a bars cache and a dozen marker files
into `docs/pine/wip/rig/rig-data/` — inside the repo, untracked, dirtying a tree
whose cleanliness is the resume contract. Caught before it ran, on the first
resume after the reboot that committed it.

⭐ SO THE PATH IS AN ENV VAR WITH AN OUTSIDE-THE-REPO DEFAULT, AND THE CHECK IS A
REFUSAL RATHER THAN A CONVENTION — the same blast-radius rule the pytest runner
follows for `C:\\data`: a guard that can fire, not a comment asking politely.

    UCT_RIG_DATA=<dir>   where the sandbox goes
                         (default: %LOCALAPPDATA%\\Temp\\uct-rig-8129\\rig-data)

Run it from anywhere:

    python docs/pine/wip/rig/boot_rig.py

`rig_sandbox()` is importable and pure so the refusal has a test
(`tests/test_rig_sandbox_never_inside_a_worktree.py`).
"""
import os
import pathlib
import subprocess
import sys

REPO = pathlib.Path(r"C:\Users\Patrick\uct-worktrees\indicator-r0r1")
PORT = 8129


def _worktree_root(path: pathlib.Path):
    """The git worktree `path` sits inside, or None.

    ⭐ ASKED OF GIT, NOT PATTERN-MATCHED. A string test against a hard-coded
    worktree list is a second authority over which directories are repositories,
    and it goes stale the day somebody adds one. `--show-toplevel` answers for
    whatever is actually there.
    ⚠️ A path that does not exist yet still has to be judged, so the question is
    asked of the nearest EXISTING ancestor.
    """
    probe = path
    while not probe.exists() and probe != probe.parent:
        probe = probe.parent
    try:
        out = subprocess.run(
            ["git", "-C", str(probe), "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, timeout=15,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0:
        return None
    top = out.stdout.strip()
    return pathlib.Path(top) if top else None


def rig_sandbox(env=None):
    """Resolve the sandbox directory, refusing one inside a git worktree."""
    env = os.environ if env is None else env
    raw = env.get("UCT_RIG_DATA")
    if raw:
        sb = pathlib.Path(raw).expanduser()
    else:
        base = env.get("LOCALAPPDATA") or env.get("TEMP") or "/tmp"
        sb = pathlib.Path(base) / "Temp" / "uct-rig-8129" / "rig-data"
        if not (pathlib.Path(base) / "Temp").exists():
            sb = pathlib.Path(base) / "uct-rig-8129" / "rig-data"
    sb = sb.resolve() if sb.exists() else pathlib.Path(os.path.abspath(str(sb)))

    root = _worktree_root(sb)
    if root is not None:
        raise SystemExit(
            "REFUSED: the rig sandbox would sit inside the git worktree at\n"
            f"  {root}\n"
            f"  resolved sandbox: {sb}\n"
            "A rig that writes auth.db and a bars cache into a worktree dirties a\n"
            "tree whose cleanliness is the resume contract, and `git status` is how\n"
            "the next session decides whether anything touched this checkout.\n"
            "Set UCT_RIG_DATA to a directory outside every worktree."
        )
    return sb


def main():
    sb = rig_sandbox()
    sb.mkdir(parents=True, exist_ok=True)

    os.environ["DATA_DIR"] = str(sb)
    os.environ["AUTH_DB_PATH"] = str(sb / "auth.db")
    os.environ["ADMIN_EMAILS"] = "panetest@local.dev"
    for k in ("WORKER_ENABLED", "CATALYST_ENGINE_ENABLED", "TWITTERAPI_IO_ENABLED",
              "SCAN_SWEEP_ENABLED", "NOTE_SYNC_ENABLED", "BROKER_SYNC_ENABLED",
              "COMPASS_AUTOMATION_ENABLED", "AWARENESS_ENGINE_ENABLED",
              "DESK_DAILY_SESSION_ENABLED", "BUZZ_DIGEST_ENABLED",
              "RECONCILE_ENABLED", "FUNDAMENTALS_MONITOR_ENABLED",
              "MASSIVE_WS_ENABLED", "BRAIN_PACK_ENABLED"):
        os.environ[k] = "0"
    os.environ["BARS_PREWARM_DISABLED"] = "1"
    os.environ["TICKER_NAMES_PREWARM_DISABLED"] = "1"
    os.environ["THEME_ENGINE_ENABLED"] = "0"

    sys.path.insert(0, str(REPO))
    os.chdir(REPO)
    print(f"[rig] sandbox {sb}", flush=True)
    print(f"[rig] http://127.0.0.1:{PORT}", flush=True)
    import uvicorn
    uvicorn.run("api.main:app", host="127.0.0.1", port=PORT, log_level="warning")


if __name__ == "__main__":
    main()
