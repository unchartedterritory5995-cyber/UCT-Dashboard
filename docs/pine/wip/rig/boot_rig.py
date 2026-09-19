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

#: ⛔⛔ A PORT ASSIGNMENT IS NOT A SERVER IDENTITY, AND THIS SCRIPT LEARNED IT THE
#: EXPENSIVE WAY. `PORT` was the bare constant 8129 with no pre-bind check, so on
#: 2026-09-17 a boot collided with a rig **another session had left running since
#: 09-13** — four days old, booted from a checkout that predates R33a, R35c/R35d
#: and R36. uvicorn died with a raw `[Errno 10048]` buried in the log while the
#: INCUMBENT kept answering `/api/health` with **200**, so the obvious health
#: check read as a successful boot.
#:
#: ⚰️ A capture taken then would have measured code four days stale — Clouds with
#: no colour fold — and been reported as today's. The only thing that caught it
#: was reading the listener's **start time**, not that something answered.
#:
#: ⭐ SO THE CHECK CONNECTS RATHER THAN BINDS, AND IT NEVER KILLS THE INCUMBENT —
#: the same shape `hub_sandbox_boot.py` already uses: refuse, name the command
#: that finds the owner, and let the operator decide.
PORT = int(os.environ.get("UCT_RIG_PORT", "8129"))


def _refuse_if_port_busy(port: int) -> None:
    """Refuse to boot on a port somebody else holds. Connect, never bind."""
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(1.5)
    try:
        busy = s.connect_ex(("127.0.0.1", port)) == 0
    finally:
        s.close()
    if not busy:
        return
    raise SystemExit(
        f"[rig] REFUSING TO BOOT: something is already listening on 127.0.0.1:{port}.\n"
        f"[rig] It is NOT this session's and will NOT be killed. Find its owner:\n"
        f"[rig]   Get-NetTCPConnection -LocalPort {port} -State Listen |\n"
        f"[rig]     ForEach-Object {{ Get-Process -Id $_.OwningProcess | "
        f"Select-Object Id,ProcessName,StartTime }}\n"
        f"[rig] Then either stop it deliberately, or boot elsewhere:\n"
        f"[rig]   UCT_RIG_PORT=<free port> python docs/pine/wip/rig/boot_rig.py\n"
        f"[rig] ⛔ A server that merely ANSWERS is not this run's server: check its\n"
        f"[rig]    START TIME. A stale one serves 200s from code you are not testing."
    )


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

    # ⛔⛔ `DATA_DIR` IS NOT AN AUTHORITY, AND THIS SCRIPT WAS RELYING ON IT.
    # Until 2026-09-18 the only pins here were `DATA_DIR` and `AUTH_DB_PATH`,
    # while the census over `api/**` names **77** environment variables that
    # resolve paths inside the shared root — each of them INDEPENDENTLY. On this
    # box `/data` is a real directory, so every unpinned one resolved to the
    # owner's LIVE files. `USER_DEFINITIONS_DB_PATH` is the one that mattered for
    # this rig: the member door's "Add this script to my chart" POSTs to
    # `/api/user-definitions`, whose store defaulted to `/data/user_definitions.db`
    # — i.e. `C:\\data\\user_definitions.db`. A successful attach on the rig would
    # have written a definition into production.
    #
    # ⭐ IT DID NOT, AND THAT WAS LUCK, NOT DESIGN. The 2026-09-17 capture never
    # completed a save (the pane flag was off, so only the Formula tab's Save was
    # on screen), and that file's mtime is still 09-13. The next run is the one
    # that would have done it, which is why this is fixed before Part 2 rather
    # than recorded.
    #
    # ⭐ SO THE PINS ARE DERIVED AND THE TRIPWIRE IS ARMED — the same door
    # `scripts/hub_sandbox_boot.py` already opens, imported rather than copied.
    # `apply_sandbox_env` re-points every census pin at this sandbox AND imports
    # `conftest`, which makes `sqlite3.connect`/`open`/`makedirs`/`remove`/… raise
    # AND RECORD on any path inside the shared root. A hand-picked list here would
    # be a second authority over which vars exist, and it already went stale once.
    sys.path.insert(0, str(REPO))
    os.chdir(REPO)
    import importlib
    hub = importlib.import_module("scripts.hub_sandbox_boot")
    pins = hub.apply_sandbox_env(str(sb), test_email="panetest@local.dev")
    print(f"[rig] {len(pins)} shared-root pins applied; tripwire armed", flush=True)

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

    _refuse_if_port_busy(PORT)
    print(f"[rig] sandbox {sb}", flush=True)
    print(f"[rig] http://127.0.0.1:{PORT}", flush=True)
    import uvicorn
    uvicorn.run("api.main:app", host="127.0.0.1", port=PORT, log_level="warning")


if __name__ == "__main__":
    main()
