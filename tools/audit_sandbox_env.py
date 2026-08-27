"""Derive a COMPLETE sandbox environment for a local backend, so nothing it does
can reach the shared data root.

⛔ WHY THIS EXISTS. On this box `/data` is `C:\\data` — the owner's LIVE files.
That is how `C:\\data\\auth.db` reached ~1 GB / 20,640 users, and how one daemon
thread wrote into `C:\\data\\screener.db` and made the member-facing screener label
3,583 month-old rows "today". A local backend started with nothing set resolves
every product path straight onto those files, and several modules WRITE — one of
them (`theme_performance`) computes in the background **on boot**, so merely
starting the server is enough.

⭐ THE PIN SET IS DERIVED, NEVER TYPED. `conftest.shared_data_root_census()`
already walks `api/**` by AST and answers "which env var redirects which shared
literal". Re-listing those vars here would be a second authority over the exact
question that census exists to answer — and it would go stale the first time a new
`/data` path lands. This reads the census and refuses if it reports anything it
cannot redirect.

Usage::

    python tools/audit_sandbox_env.py --print          # inspect the block
    python tools/audit_sandbox_env.py --ps1            # PowerShell $env: lines
    python tools/audit_sandbox_env.py --json           # {VAR: value}

Nothing here starts a server; it only produces the environment one should be
started with. Keeping those separate is deliberate — the thing that decides
"where may this write" should be readable on its own.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

#: Extra vars that are not shared-root paths but must be off for an audit run:
#: heavy background work that would fight the browser for the box, and anything
#: that would reach a vendor. ⚠️ These are a DELIBERATE hand list, unlike the
#: paths — they are not derivable, and each is here for a stated reason.
QUIET = {
    "WORKER_ENABLED": ("0", "the bars prewarmer would saturate the box"),
    "CATALYST_ENGINE_ENABLED": ("0", "an LLM pipeline on a scheduler"),
    "TWITTERAPI_IO_ENABLED": ("0", "a paid third-party poller"),
    "BARS_PREWARM_DISABLED": ("1", "a full-universe warm loop"),
    "TICKER_NAMES_PREWARM_DISABLED": ("1", "a 30-minute yfinance walk"),
    "COMPASS_AUTOMATION_ENABLED": ("0", "scheduled model calls"),
    "AWARENESS_ENGINE_ENABLED": ("0", "scheduled model calls"),
    "NOTE_SYNC_ENABLED": ("0", "outbound connector syncs"),
    "BROKER_SYNC_ENABLED": ("0", "outbound SnapTrade calls"),
    "DESK_DAILY_SESSION_ENABLED": ("0", "Zoom/YouTube uploads"),
    "CALENDAR_ALERTS_ENABLED": ("0", "outbound member email"),
    "CATALYST_ALERTS_ENABLED": ("0", "outbound member email"),
    "DISCORD_WEBHOOK_URL": ("", "⛔ BLANK, never popped — a blank webhook posts nothing; "
                                "removing the var lets a default re-appear"),
    "DISCORD_TSDR_WEBHOOK_URL": ("", "⛔ BLANK — the public community channel"),
}


def sandbox_env(root: pathlib.Path) -> dict[str, str]:
    """Every shared-root pin redirected under ``root``, plus the quiet flags.

    Raises if the census reports a literal it cannot redirect — an audit that
    starts with an unpinnable path is exactly the thing this file prevents.
    """
    import conftest  # noqa: E402  (repo root is on sys.path above)

    literals, pins, unpinnable = conftest.shared_data_root_census()
    if unpinnable:
        raise SystemExit(
            "REFUSING to build a sandbox environment: the census reports "
            f"{len(unpinnable)} shared literal(s) with no env override, so a local "
            "backend would still reach the live data root.\n  "
            + "\n  ".join(sorted(unpinnable))
            + "\n\nGive each an override whose default is the literal already there "
              "(that is how the other pins work), then re-run."
        )

    env: dict[str, str] = {}
    for var, literal in sorted(pins.items()):
        norm = str(literal).replace("\\", "/").rstrip("/")
        # ⛔ THE BARE-ROOT CASE, AND IT IS NOT AN EDGE CASE. Three vars — `DATA_DIR`,
        # `DESK_CREATIVE_DATA_DIR`, `RAILWAY_VOLUME_MOUNT_PATH` — have `/data` ITSELF
        # as their literal, not `/data/<something>`. A naive `split("/data/")` leaves
        # those unchanged, so the sandbox would hand the backend the LIVE root under
        # the name of a safety feature. Caught by this file's own final check, which
        # is the only reason it is not still true.
        tail = norm.split("/data/", 1)[1] if "/data/" in norm else ""
        env[var] = str(root / tail) if tail else str(root)
    for var, (value, _why) in QUIET.items():
        env[var] = value
    env["UCT_TEST_SHARED_ROOT_GUARD"] = "report"
    return env


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", default=None,
                    help="sandbox directory (default: a sibling of the repo, never /data)")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--print", dest="plain", action="store_true")
    g.add_argument("--ps1", action="store_true")
    g.add_argument("--json", dest="as_json", action="store_true")
    args = ap.parse_args()

    root = pathlib.Path(args.root) if args.root else REPO.parent / "_audit_sandbox"
    resolved = root.resolve()
    # ⛔ The one check that matters more than the rest of this file.
    for bad in ("c:/data", "c:\\data", "/data"):
        if str(resolved).lower().rstrip("/\\").endswith(bad.rstrip("/\\")):
            raise SystemExit(f"REFUSING: the sandbox root resolves to the shared data root ({resolved})")
    resolved.mkdir(parents=True, exist_ok=True)

    env = sandbox_env(resolved)
    if args.as_json:
        print(json.dumps(env, indent=2, sort_keys=True))
    elif args.ps1:
        for k, v in sorted(env.items()):
            print(f'$env:{k} = "{v}"')
    else:
        print(f"# sandbox root: {resolved}")
        print(f"# {len(env)} variables — every shared-root pin the census derives, plus {len(QUIET)} quiet flags")
        for k, v in sorted(env.items()):
            print(f"{k}={v}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
