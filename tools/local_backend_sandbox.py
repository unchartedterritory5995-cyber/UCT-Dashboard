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
    # ⛔⛔ AND `USE_REMOTE_BARS=0` WAS NOT ENOUGH — MEASURED 2026-09-08 (O6).
    #
    # ⚰️ ONE BEHAVIOUR, TWO DOORS, AND THE FLAG CLOSED ONE. Wave N found the
    # snapshot pull and turned off the flag that reaches it through the bars
    # prewarmer. The boot-time INTEGRITY SMOKE PROBE in `api/main.py` calls
    # `data_sync.force_resync()` on its own, without consulting
    # `USE_REMOTE_BARS` at all — and a sandbox always starts with an empty
    # DATA_DIR, so the probe fails EVERY boot and pulls EVERY boot. Two O6
    # sandbox restarts leaked ~69 GB in `data_sync_*` staging directories and
    # took this machine from 80.7 GB free to 11 GB. The fingerprint is one
    # line in the sandbox log:
    #
    #     [startup] bars.db FAILED integrity smoke probe (0.02s)
    #               -- pulling fresh snapshot from R2
    #
    # ⛔ SO THE FIX IS AT THE CREDENTIAL, NOT AT A SECOND FLAG. `data_sync`
    # builds its S3 client lazily and returns None when the endpoint or either
    # key is missing, so a blanked credential makes EVERY door to that pull —
    # this one, the prewarmer's, and any future third — a no-op that costs one
    # function call. Chasing callers one at a time is how a second door gets
    # missed, which is exactly what happened here.
    #
    # ⛔ BLANKED, NEVER POPPED. An empty string is falsy to `os.environ.get`
    # and, unlike a deleted key, it cannot be silently refilled by `.env`
    # (load_dotenv does not override an existing variable). Production
    # resolves byte-identically with nothing set here.
    #
    # ⛔ AND NOTHING THE NOTEBOOK VERIFIES NEEDS REAL BARS. If a future check
    # ever does, it must seed the handful of series it needs — not restore a
    # 23 GB production snapshot onto a developer's system drive.
    "DATA_SYNC_ENDPOINT_URL": "", "DATA_SYNC_ACCESS_KEY": "",
    "DATA_SYNC_SECRET_KEY": "", "DATA_SYNC_BUCKET": "",
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


def _verify_no_remote_sync() -> None:
    """⛔⛔ FAIL CLOSED: this sandbox may not be ABLE to pull the R2 snapshot.

    ⚰️ WHY A CAPABILITY CHECK AND NOT A FLAG. `USE_REMOTE_BARS=0` closed the
    bars-prewarmer door. It did not close `api/main.py`'s boot-time integrity
    smoke probe, which calls `data_sync.force_resync()` without consulting that
    flag — and a sandbox always boots with an empty DATA_DIR, so the probe
    failed and pulled on EVERY boot. Two O6 boots leaked ~46 GB.

    Blanking the credentials closes every door at once, including doors nobody
    has written yet. This asserts the RESULT of that rather than the spelling
    of the pins: `data_sync._client()` is the one function every pull path goes
    through, and it returns None when the endpoint or either key is missing.

    ⛔ IT RAISES RATHER THAN WARNS. A sandbox that CAN restore a multi-GB
    production snapshot onto a developer's system drive should not start, and a
    printed warning in a 400-line boot log is not a guard — the line that said
    `bars.db FAILED integrity smoke probe -- pulling fresh snapshot from R2`
    was there for both leaked boots and nobody read it.

    ⛔ AND IT PROVES IT CAN FIRE. The check is run twice: once with a dummy
    credential set, where the client MUST come back non-None, and then for real.
    A guard whose condition can never be true is not a guard
    (`lesson_gate_that_cannot_fail`).
    """
    from api.services import data_sync

    # Non-vacuity: with credentials present, this function DOES build a client.
    _saved = {k: os.environ.get(k) for k in
              ("DATA_SYNC_ENDPOINT_URL", "DATA_SYNC_ACCESS_KEY",
               "DATA_SYNC_SECRET_KEY")}
    try:
        os.environ["DATA_SYNC_ENDPOINT_URL"] = "https://example.invalid"
        os.environ["DATA_SYNC_ACCESS_KEY"] = "probe"
        os.environ["DATA_SYNC_SECRET_KEY"] = "probe"
        if data_sync._client() is None:
            raise SystemExit(
                "SANDBOX GUARD IS VACUOUS: data_sync._client() returned None "
                "even WITH credentials present, so its returning None below "
                "would prove nothing. The capability check has moved; fix this "
                "guard before trusting a boot.")
    finally:
        for k, v in _saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    client = data_sync._client()
    if client is not None:
        raise SystemExit(
            "REFUSING TO START: this sandbox can reach R2. A boot-time "
            "integrity probe would restore a multi-GB production bars snapshot "
            "into TEMP, and a killed sandbox leaks the staging directory. "
            "Blank DATA_SYNC_ENDPOINT_URL / _ACCESS_KEY / _SECRET_KEY.")
    print("remote data-sync : UNAVAILABLE (data_sync._client() is None) "
          "— no R2 pull can start, from any caller")


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
    # ⛔ AFTER `_load_env()`, for the same reason `_verify_sandbox` is: the
    # point is that nothing — including a credential file — restores the
    # capability the pins above removed.
    _verify_no_remote_sync()
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
