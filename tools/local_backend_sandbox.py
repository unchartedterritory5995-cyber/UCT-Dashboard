"""Start the backend locally with EVERY data path redirected into a sandbox.

⛔ `/data` EXISTS on this box as `C:\\data`, so a locally-started backend
resolves the product's real paths to the owner's LIVE files -- that is how
`C:\\data\\auth.db` grew to ~1 GB, and how one daemon thread made the
member-facing screener label month-old rows "today". A browser-verification
backend is exactly the thing that runs for a long time, with schedulers, while
nobody is watching it.

So this does not invent its own pin list. It imports the repo-root `conftest`,
whose pins are DERIVED BY AST over `api/**`, `scripts/` and `tools/` -- 69 env
vars at the time of writing -- and which installs the write tripwire alongside
them. A hand-maintained list here would be a second authority over one value,
and would silently miss the next path somebody adds.

    python tools/local_backend_sandbox.py [--port 8077]

Heavy background work is off: no worker, no catalyst engine, no twitter poll,
no bars prewarm. ADMIN_EMAILS promotes the seeded account so every route is
reachable.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHARED_ROOTS = ("c:\\data", "/data")

# ⛔ BEFORE ANY api.* IMPORT. The pins are captured at module import inside the
# product code, so a fixture-style setenv after the fact reaches none of them.
sys.path.insert(0, str(ROOT))
import conftest  # noqa: E402,F401  (imported for its side effects)

OFF = {
    "WORKER_ENABLED": "0", "CATALYST_ENGINE_ENABLED": "0",
    "TWITTERAPI_IO_ENABLED": "0", "BARS_PREWARM_DISABLED": "1",
    "TICKER_NAMES_PREWARM_DISABLED": "1", "COMPASS_AUTOMATION_ENABLED": "0",
    "AWARENESS_ENGINE_ENABLED": "0", "BRAIN_PACK_ENABLED": "0",
    "SCAN_SWEEP_ENABLED": "0", "COT_PREWARM_ENABLED": "0",
    "DESK_DAILY_SESSION_ENABLED": "0", "BROKER_SYNC_ENABLED": "0",
    "NOTE_SYNC_ENABLED": "0", "MASSIVE_WS_ENABLED": "0",
    "FUNDAMENTALS_MONITOR_ENABLED": "0", "RECONCILE_ENABLED": "0",
    # ⛔⛔ THE EXPENSIVE ONE, AND IT WAS MISSING. `USE_REMOTE_BARS=1` arrives
    # from `.env` (load_dotenv does not override, and this dict runs first, so
    # setting it here WINS). With it on, boot pulls the R2 bars snapshot: a
    # multi-GB tarball streamed into a `data_sync_*` TEMP directory and then
    # extracted, ~25 GB per run. The "skip the boot pull, local SQLite already
    # has bars" guard cannot help here — every sandbox boot starts with a FRESH
    # EMPTY DATA_DIR, so the probe always says pull. And a sandbox that is
    # force-killed (the normal way a verification run ends) never reaches the
    # `finally: rmtree`, so the directory LEAKS.
    #
    # Measured 2026-09-08: 23 leaked `data_sync_*` directories, ~215 GB, all
    # from one day of Wave N browser verification — the system drive went from
    # 13.5 GB free to 160 MB across a handful of sandbox restarts. A browser
    # check of the Notebook needs no real bars at all.
    "USE_REMOTE_BARS": "0",
}

# ⛔ NOT A GUARD BEING DISABLED — it is the guard's OWN documented override,
# pointed at a sandbox. `notes_quota` refuses an upload that would leave the
# ATTACHMENT VOLUME under `(1 - disk_watchdog.CRIT_PCT/100) x total`, derived
# for Railway's 78 GB volume. This sandbox's DATA_DIR is a temp directory on
# the developer's system drive, so the derivation asks for ~10% of a 499 GB
# disk — ~50 GB — and every attachment upload 400s on a machine with less than
# that free, which reads as a product defect and is not one (it cost this wave
# an hour). Production resolves byte-identically with nothing set.
SANDBOX_ONLY = {"NOTE_IMPORT_RESERVE_BYTES": str(64 * 1024**2)}


def _load_env() -> None:
    """Credentials, the same way scripts/ does it -- and ONLY credentials: the
    69 data-path pins above already came from conftest and `load_dotenv` does
    not override an existing variable, so a .env cannot drag a live path back
    in. Without this the Ask route fails authentication and a browser check
    reports "no answer rendered" for a reason that has nothing to do with the
    UI it was written to test.
    """
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    for base in (ROOT, ROOT.parent, ROOT.parent.parent,
                 ROOT.parent.parent / "uct-dashboard"):
        p = base / ".env"
        if p.is_file():
            load_dotenv(p, override=False)


def _verify_sandbox() -> None:
    """Refuse to start if anything still points at the shared root."""
    leaks = []
    for key, value in os.environ.items():
        if not isinstance(value, str) or len(value) < 3:
            continue
        low = value.lower().replace("/", "\\")
        for shared in SHARED_ROOTS:
            s = shared.replace("/", "\\")
            if low == s or low.startswith(s + "\\"):
                leaks.append(f"{key}={value}")
    if leaks:
        print("REFUSING TO START -- these still resolve inside the shared root:")
        for leak in sorted(leaks):
            print("   " + leak)
        raise SystemExit(2)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--port", type=int, default=8077)
    ap.add_argument("--log-level", default="warning",
                    choices=["critical", "error", "warning", "info", "debug"],
                    help="uvicorn log level. Use 'info' to get the ACCESS LOG, "
                         "which is what production runs and the only way to "
                         "verify anything about what we log per request.")
    ap.add_argument("--email", default="mobtest@local.dev")
    args = ap.parse_args()

    os.environ.update(OFF)
    os.environ.update(SANDBOX_ONLY)
    os.environ["ADMIN_EMAILS"] = args.email
    _load_env()
    # ⛔ VERIFY AFTER loading the .env, not before: the point of the check is
    # that nothing -- including a credential file -- points at the shared root.
    _verify_sandbox()
    print(f"anthropic key    : "
          f"{'present' if os.environ.get('ANTHROPIC_API_KEY') else 'MISSING'}")

    print(f"sandbox DATA_DIR : {os.environ.get('DATA_DIR')}")
    print(f"sandbox AUTH_DB  : {os.environ.get('AUTH_DB_PATH')}")
    print(f"shared-root guard: {os.environ.get('UCT_TEST_SHARED_ROOT_GUARD', 'enforce')}")
    print(f"listening on     : http://127.0.0.1:{args.port}")

    import uvicorn
    # ⛔ `warning` is the default here so a long-running dev backend does not
    # bury its own errors under a request-per-line access log. But PRODUCTION
    # runs uvicorn at its default level (railway.json passes no --log-level), so
    # the access log IS on there — and a sandbox at `warning` emits no request
    # lines at all, which silently makes any access-log assertion vacuous. That
    # is how "0 occurrences of the shared text" first read as a clean pass with
    # nothing to be clean about. `--log-level info` reproduces production.
    uvicorn.run("api.main:app", host="127.0.0.1", port=args.port,
                log_level=args.log_level)
    return 0


if __name__ == "__main__":
    sys.exit(main())
