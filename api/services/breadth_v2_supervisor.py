"""THE DURABLE V2 RUNNER — a process LIFECYCLE around the canonical combined pass.

⛔⛔ THIS IS NOT A NEW GRINDER. It computes nothing. It starts
`breadth_combined_pass.main()` — the exact accepted pass — and does the four things
the first V2 attempt had no way to do:

  1. holds a SINGLETON lease, so a second launch can never become a second writer;
  2. survives an infrastructure restart by simply being started again, because the
     pass is checkpointed and `skipped_existing` recomputes nothing;
  3. tells a PROCESS/INFRASTRUCTURE restart apart from a CANONICAL PASS FAILURE, and
     parks permanently on the latter instead of restart-looping over a data defect;
  4. writes a durable progress ledger, so "how far along is it" never again requires
     reading an HTTP log by eye.

⚰️⚰️ WHY THIS EXISTS. The first V2 run (2026-09-18 19:02:10Z) was `execve`'d detached
from an ssh session on the WORKER pod. The worker rebuilds on `api/**`, which on an
ordinary day is ~20 deployments. It died 31 minutes in, at 19:33:51Z, with 28 of ~4,878
checkpoints committed, no traceback, and nothing to restart it. The lesson is not
"checkpoint harder" — the checkpoints were perfect — it is that a multi-day job cannot
live on a pod that redeploys on every push.

⛔ THE OLD BOOT HOOK IS NOT THE ANSWER AND MUST STAY DISARMED.
`BREADTH_COMBINED_PASS_ENABLED` remains 0 everywhere. This runner has its own explicit
lifecycle on its own service; it is never armed by a worker boot.

⭐ RESTART SEMANTICS, and they are the whole design:

    infrastructure kills the container  -> the platform restarts us -> we resume
                                           from checkpoints, recomputing nothing
    pass completes                      -> DONE marker  -> PARK, serving the ledger
    canonical data failure              -> FAILED marker -> PARK, serving the ledger
    transient (web 502 during universe
    resolution -- the deferred defect)  -> bounded backoff retry, then FAILED

⛔ PARKING, NOT EXITING, IS DELIBERATE. `railway.json` sets `restartPolicyType: ALWAYS`
for every service in this repo, so ANY exit — zero or not — is restarted. A terminal
state that exits would therefore restart-loop the very failure a human needs to look
at. So the runner stays up and keeps answering with its terminal state instead. The
outcome lives in the marker file, the ledger and the HTTP endpoint, never in an exit
code that nothing would read.

⭐ It also serves `/api/health`, which is what the repo's shared `railway.json` health
check asks for. That is why this service needs no config divergence at all beyond one
inert `elif` in the start-command dispatcher — and it gives the progress ledger a live
URL, so checking on a five-day job is a `curl`, not an `ssh` and a `sqlite3`.

⚠️ The ledger is derived by READING `pass_checkpoint` out of the artifact on a timer.
Nothing in the accepted pass is instrumented, wrapped, or timed from the inside — the
methodology stays frozen and byte-identical to what the golden matrix accepted.
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import sys
import threading
import time
import traceback
from datetime import datetime, timezone

DATA_DIR = os.environ.get("DATA_DIR", "/data")
AUDIT_DIR = os.path.join(DATA_DIR, "_audit")
ARTIFACT = os.environ.get("BREADTH_V2_ARTIFACT",
                          os.path.join(AUDIT_DIR, "breadth_replacement_v2.db"))
LOCK_PATH = os.path.join(AUDIT_DIR, "v2_runner.lock")
DONE_PATH = os.path.join(AUDIT_DIR, "v2_runner.DONE")
FAILED_PATH = os.path.join(AUDIT_DIR, "v2_runner.FAILED")
#: ⭐ THE CONTROLLED-LAUNCH GATE. While this file exists the runner does everything
#: EXCEPT start the pass: preflight runs, `bars.db` is restored, the status endpoint
#: comes up — and then it parks. That is what makes the golden smoke a real gate rather
#: than a thing done afterwards and hoped about: the smoke runs in THIS container, on
#: THIS bars.db, against a separate artifact, and only then is the hold lifted.
HOLD_PATH = os.path.join(AUDIT_DIR, "v2_runner.HOLD")
LEDGER_PATH = os.path.join(AUDIT_DIR, "v2_status.json")

#: The accepted remediation, pinned by content digest so this runner cannot silently
#: drift onto a different build of the methodology.
#:
#: ⚠️⚰️ THE DIGESTS ARE OVER LF-NORMALISED CONTENT, AND THAT IS NOT A DETAIL.
#: `v2_manifest.json` records `breadth_combined_pass.py` as `7e0fa63e…`, which is the
#: md5 of the copy sitting on the worker's volume — 19,016 bytes carrying 391 CRLF
#: pairs, because it was scp'd out of a Windows worktree. The same file checked out on
#: Linux is 18,625 bytes of LF and hashes to `14e7a59d…`. Pinning the raw digest makes
#: preflight refuse the CORRECT code for a reason that has nothing to do with the code,
#: which is how a line ending gets to veto a five-day run. Normalise, then compare.
#:
#: Verified: `cp_accepted == cp_head` byte for byte after normalisation (zero changes
#: to the pass), and `wick_recon` differs from the accepted build by exactly the
#: `session_eod_closes` index fix — 25 insertions, 2 deletions, one file, proved
#: result-identical before it was allowed near this runner.
ACCEPTED_SHA = "6d7e4c0deaa8003491b0450a837e521afe020f39"
PINNED_COMBINED_MD5 = "14e7a59d935a8b891a58bbd5e0e8a00c"
ACCEPTED_WICK_RECON_MD5 = "cc041dba7dc16caec6c5de7e93360bb9"
PINNED_WICK_RECON_MD5 = "9422957bcfd5df65eebfb15b62c72370"

#: A `ArtifactRefused` from universe resolution is the deferred web-502 defect, not a
#: data defect (see the `breadth-pass-universe-resolution-502` note). The guard itself
#: is NOT weakened — the pass still dies — but the LIFECYCLE gets to try again, which
#: is precisely what the old boot hook could never do.
MAX_TRANSIENT_RETRIES = 5
BACKOFF_SECONDS = (60, 180, 420, 900, 1800)

LEDGER_INTERVAL_SECONDS = 60


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _log(msg: str) -> None:
    sys.stdout.write("[v2-supervisor %s] %s\n" % (_now(), msg))
    sys.stdout.flush()


def _md5(path: str) -> str:
    """md5 of the file's LF-NORMALISED bytes — see the digest note above. A CRLF copy
    of identical source must not read as a different build."""
    with open(path, "rb") as f:
        return hashlib.md5(f.read().replace(b"\r\n", b"\n")).hexdigest()


# ---------------------------------------------------------------- singleton lease

class _Lease:
    """An exclusive, self-releasing singleton lease.

    ⭐ `flock` is the proof, not a convention: the kernel holds it for the life of the
    file descriptor and releases it when the process dies for ANY reason, including
    SIGKILL from a container replacement. There is no stale-lock state to reap and no
    heartbeat to get wrong. A second launch either gets the lock or it does not run.

    The replica count is the other half (one instance), but a lease is what makes a
    stray manual `python -m api.services.breadth_v2_supervisor` over ssh harmless.
    """

    def __init__(self, path: str):
        self.path = path
        self._fd = None

    def acquire(self) -> bool:
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        self._fd = os.open(self.path, os.O_RDWR | os.O_CREAT, 0o644)
        try:
            import fcntl
            fcntl.flock(self._fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (ImportError, OSError):
            os.close(self._fd)
            self._fd = None
            return False
        os.ftruncate(self._fd, 0)
        os.write(self._fd, ("pid=%d started=%s\n" % (os.getpid(), _now())).encode())
        os.fsync(self._fd)
        return True


# ---------------------------------------------------------------- progress ledger

def _read_progress() -> dict:
    """Everything the ledger knows, read out of the artifact itself.

    ⚠️ Read-only and failure-tolerant by design: the pass is writing this database
    while we read it, so a transient `database is locked` must degrade to "no reading
    this tick", never to a crash of the supervisor.
    """
    out = {"artifact": ARTIFACT, "artifact_bytes": None, "rows": None,
           "checkpoints": None, "done": None, "missing_source": None, "failed": None,
           "last_session": None, "first_session": None, "universes": None}
    try:
        out["artifact_bytes"] = os.path.getsize(ARTIFACT)
    except OSError:
        return out
    try:
        con = sqlite3.connect("file:%s?mode=ro" % ARTIFACT, uri=True, timeout=5.0)
        try:
            c = con.cursor()
            by = dict(c.execute(
                "SELECT status, COUNT(*) FROM pass_checkpoint GROUP BY status"))
            out["done"] = by.get("done", 0)
            out["missing_source"] = by.get("missing_source", 0)
            out["failed"] = by.get("failed", 0)
            out["checkpoints"] = sum(by.values())
            row = c.execute("SELECT MIN(date), MAX(date) FROM pass_checkpoint").fetchone()
            out["first_session"], out["last_session"] = row[0], row[1]
            out["rows"] = c.execute(
                "SELECT COUNT(*) FROM breadth_daily_ohlc").fetchone()[0]
            out["universes"] = dict(c.execute(
                "SELECT universe, COUNT(*) FROM breadth_daily_ohlc GROUP BY universe"))
        finally:
            con.close()
    except Exception:                                  # noqa: BLE001 - never fatal
        pass
    return out


def _dir_bytes(path: str) -> int:
    total = 0
    for root, _dirs, files in os.walk(path):
        for fn in files:
            try:
                total += os.path.getsize(os.path.join(root, fn))
            except OSError:
                pass
    return total


def _write_ledger(state: str, started: str, boot_count: int, extra: dict) -> None:
    prog = _read_progress()
    elapsed = None
    try:
        elapsed = time.time() - datetime.strptime(
            started, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()
    except Exception:                                  # noqa: BLE001
        pass
    payload = {
        "state": state,
        "updated_at": _now(),
        "process_started_at": started,
        "boot_count": boot_count,
        "pid": os.getpid(),
        "accepted_sha": ACCEPTED_SHA,
        "elapsed_seconds_this_process": None if elapsed is None else round(elapsed, 1),
        "cache_bytes": _dir_bytes(os.path.join(DATA_DIR, "grouped_closes")),
    }
    payload.update(prog)
    payload.update(extra or {})
    try:
        free = os.statvfs(DATA_DIR)
        payload["disk_free_bytes"] = free.f_bavail * free.f_frsize
    except (OSError, AttributeError):
        pass
    tmp = LEDGER_PATH + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=1, sort_keys=True)
        os.replace(tmp, LEDGER_PATH)
    except OSError:
        pass


def _ledger_thread(stop: threading.Event, started: str, boot_count: int) -> None:
    while not stop.wait(LEDGER_INTERVAL_SECONDS):
        _write_ledger("running", started, boot_count, {})


# ---------------------------------------------------------------- status endpoint

def serve_status(port: int) -> None:
    """Answer the repo's shared health check, and publish the ledger over HTTP.

    ⭐ Two jobs in one tiny server. `railway.json`'s `healthcheckPath` is `/api/health`
    for every service built from this repo; without an answer the deploy never goes
    live. And because it is here anyway, the progress ledger gets a URL — checking a
    five-day job becomes a `curl`, with no ssh and no reader touching the artifact.
    """
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):                              # noqa: N802
            if self.path.rstrip("/") in ("/api/health", "/health"):
                body = b'{"ok":true}'
            else:
                try:
                    with open(LEDGER_PATH, "rb") as f:
                        body = f.read()
                except OSError:
                    body = b'{"state":"starting"}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_a):                    # noqa: D102 - silence the noise
            return

    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()


def _park(state: str, started: str, boots: int, extra: dict) -> int:
    """Hold the terminal state forever rather than hand it to a restart policy."""
    _write_ledger(state, started, boots, extra)
    _log("PARKED in terminal state %r — the ledger and /  hold the outcome. "
         "Nothing further will run in this container." % state)
    while True:
        time.sleep(3600)
        _write_ledger(state, started, boots, extra)


# ---------------------------------------------------------------- preflight

def preflight() -> dict:
    """Prove the environment before a multi-day run, and refuse rather than drift.

    ⛔⛔ THE ONE THAT MATTERS: this service must never be able to write production.
    `BREADTH_HISTORY_BACKFILL_ENABLED` is what gates `breadth_ohlc_sync.upload()`, and
    `BREADTH_WICKS_ENABLED` arms the wick sweep against the PRODUCER store. Both are 1
    on the worker and both must be 0 here — cloning a worker's environment wholesale is
    exactly how an isolated audit run turns into a production mutation.
    """
    from api.services import breadth_combined_pass as cp
    from api.services import breadth_wick_recon as wr

    checks = {}
    mod_dir = os.path.dirname(os.path.abspath(cp.__file__))
    checks["combined_md5"] = _md5(os.path.join(mod_dir, "breadth_combined_pass.py"))
    checks["wick_recon_md5"] = _md5(os.path.join(mod_dir, "breadth_wick_recon.py"))
    checks["methodology"] = cp.METHODOLOGY
    checks["gate_present"] = hasattr(wr, "drop_incoherent_levels")
    checks["session_basis_present"] = hasattr(wr, "session_basis")
    checks["near_52w_high_is_count"] = "near_52w_high" not in wr._PCT_METRICS
    checks["BREADTH_COMBINED_PASS_ENABLED"] = os.environ.get(
        "BREADTH_COMBINED_PASS_ENABLED")
    checks["BREADTH_DIVIDEND_BASIS"] = os.environ.get("BREADTH_DIVIDEND_BASIS")
    checks["BREADTH_HISTORY_BACKFILL_ENABLED"] = os.environ.get(
        "BREADTH_HISTORY_BACKFILL_ENABLED")
    checks["BREADTH_WICKS_ENABLED"] = os.environ.get("BREADTH_WICKS_ENABLED")
    checks["BREADTH_OHLC_REMOTE"] = os.environ.get("BREADTH_OHLC_REMOTE")

    problems = []
    if checks["combined_md5"] != PINNED_COMBINED_MD5:
        problems.append("breadth_combined_pass.py is not the accepted build "
                        "(%s != %s)" % (checks["combined_md5"], PINNED_COMBINED_MD5))
    if checks["wick_recon_md5"] != PINNED_WICK_RECON_MD5:
        problems.append(
            "breadth_wick_recon.py is neither the accepted build (%s) nor the accepted "
            "build plus the proved index fix (%s) — it is %s"
            % (ACCEPTED_WICK_RECON_MD5, PINNED_WICK_RECON_MD5, checks["wick_recon_md5"]))
    if checks["methodology"] != "rth-1m-composites-v1":
        problems.append("methodology drifted: %r" % (checks["methodology"],))
    if not checks["gate_present"] or not checks["session_basis_present"]:
        problems.append("remediation functions missing — this is not the V2 code")
    if not checks["near_52w_high_is_count"]:
        problems.append("near_52w_high is pct-filtered again (F2 regression)")
    if str(checks["BREADTH_COMBINED_PASS_ENABLED"] or "0") != "0":
        problems.append("BREADTH_COMBINED_PASS_ENABLED must be 0 here")
    for var in ("BREADTH_HISTORY_BACKFILL_ENABLED", "BREADTH_WICKS_ENABLED",
                "BREADTH_OHLC_REMOTE"):
        if str(checks[var] or "0") != "0":
            problems.append("%s must be 0 on the runner — it can write production" % var)
    # ⭐ F4 IS DEFERRED, WHICH MEANS IT MUST MATCH THE ACCEPTED RUN, NOT "be correct".
    # The accepted V2 methodology ran with `BREADTH_DIVIDEND_BASIS` UNSET on the worker.
    # Web has it at 1. Inheriting web's value would silently change F4 semantics.
    if checks["BREADTH_DIVIDEND_BASIS"] not in (None, "", "0"):
        problems.append("BREADTH_DIVIDEND_BASIS=%r changes F4 semantics; the accepted "
                        "V2 run had it UNSET" % (checks["BREADTH_DIVIDEND_BASIS"],))
    checks["problems"] = problems
    return checks


def ensure_bars_db() -> bool:
    """Restore `bars.db` from the established R2 snapshot if this volume has none.

    ⭐ Reuses `data_sync` exactly as the web and bars-api pods already do — the level
    source is then the same artifact production reads, which is the point. No new
    replication path was invented for this run.
    """
    path = os.path.join(DATA_DIR, "bars.db")
    if os.path.exists(path) and os.path.getsize(path) > (1 << 30):
        _log("bars.db present (%.1f GB)" % (os.path.getsize(path) / 1e9))
        return True
    _log("bars.db missing — restoring from the R2 snapshot via data_sync")
    from api.services import data_sync
    ts = data_sync.sync_if_newer()
    ok = os.path.exists(path) and os.path.getsize(path) > (1 << 30)
    _log("bars.db restore ts=%r ok=%s size=%s" % (
        ts, ok, os.path.getsize(path) if os.path.exists(path) else None))
    return ok


# ---------------------------------------------------------------- main

def _boot_count() -> int:
    try:
        with open(LEDGER_PATH, encoding="utf-8") as f:
            return int(json.load(f).get("boot_count") or 0) + 1
    except Exception:                                  # noqa: BLE001
        return 1


def main(argv=None) -> int:
    started = _now()
    os.makedirs(AUDIT_DIR, exist_ok=True)
    boots = _boot_count()
    _log("boot #%d  artifact=%s  accepted_sha=%s" % (boots, ARTIFACT, ACCEPTED_SHA))

    port = int(os.environ.get("PORT") or 8080)
    threading.Thread(target=serve_status, args=(port,), daemon=True).start()
    _log("status endpoint listening on :%d (/api/health, / = ledger)" % port)

    if os.path.exists(DONE_PATH):
        _log("DONE marker present — the pass already finished.")
        return _park("done", started, boots, {})
    if os.path.exists(FAILED_PATH):
        with open(FAILED_PATH, encoding="utf-8") as f:
            _log("FAILED marker present:\n" + f.read())
        return _park("failed", started, boots, {})

    lease = _Lease(LOCK_PATH)
    if not lease.acquire():
        _log("another runner holds the singleton lease — this process will NOT write")
        return _park("standby_not_lease_holder", started, boots, {})
    _log("singleton lease acquired")

    checks = preflight()
    for k, v in sorted(checks.items()):
        if k != "problems":
            _log("  preflight %-38s %s" % (k, v))
    if checks["problems"]:
        for p in checks["problems"]:
            _log("  ⛔ PREFLIGHT " + p)
        with open(FAILED_PATH, "w", encoding="utf-8") as f:
            f.write(_now() + " preflight refused:\n" + "\n".join(checks["problems"]))
        return _park("failed", started, boots, {"failure": "preflight",
                                                "problems": checks["problems"]})

    if not ensure_bars_db():
        # Not a data failure — the level source simply is not here yet. Let the
        # infrastructure restart us and try again rather than burning the FAILED marker.
        _log("bars.db unavailable; exiting non-zero so the platform retries")
        _write_ledger("waiting_for_bars_db", started, boots, {})
        return 3

    if os.path.exists(HOLD_PATH):
        with open(HOLD_PATH, encoding="utf-8") as f:
            _log("HOLD in place — preflight passed and bars.db is ready, but the pass "
                 "will NOT start until the hold is lifted:\n" + f.read())
        return _park("held_pre_launch", started, boots, {})

    stop = threading.Event()
    t = threading.Thread(target=_ledger_thread, args=(stop, started, boots), daemon=True)
    t.start()
    _write_ledger("running", started, boots, {})

    from api.services import breadth_combined_pass as cp

    attempt = 0
    try:
        while True:
            try:
                _log("starting canonical pass (attempt %d this process)" % (attempt + 1))
                rc = cp.main(["--artifact", ARTIFACT])
                _log("canonical pass returned rc=%r" % (rc,))
                prog = _read_progress()
                if (prog.get("failed") or 0) > 0:
                    msg = "%d FAILED checkpoints — canonical data failure" % prog["failed"]
                    _log("⛔ " + msg)
                    with open(FAILED_PATH, "w", encoding="utf-8") as f:
                        f.write(_now() + " " + msg + "\n" + json.dumps(prog, indent=1))
                    return _park("failed", started, boots, {"failure": msg})
                if rc == 0:
                    with open(DONE_PATH, "w", encoding="utf-8") as f:
                        f.write(_now() + " PASS COMPLETE\n" + json.dumps(prog, indent=1))
                    _log("🏁 PASS COMPLETE — frontier %s, %s rows, %s checkpoints"
                         % (prog.get("last_session"), prog.get("rows"),
                            prog.get("checkpoints")))
                    return _park("done", started, boots, {})
                raise RuntimeError("canonical pass returned rc=%r" % (rc,))
            except Exception as exc:                   # noqa: BLE001
                name = type(exc).__name__
                tb = traceback.format_exc()
                _log("pass raised %s: %s\n%s" % (name, exc, tb))
                # ⛔ The fail-closed guard is untouched: the pass DIED. What the
                # lifecycle adds is the retry the old boot hook never had. A refusal
                # driven by a web 502 during universe resolution is an infrastructure
                # event wearing a data-failure's clothes, so it is retried a bounded
                # number of times and then recorded as failed for a human.
                if attempt >= MAX_TRANSIENT_RETRIES - 1:
                    with open(FAILED_PATH, "w", encoding="utf-8") as f:
                        f.write("%s exhausted %d retries\n%s"
                                % (_now(), MAX_TRANSIENT_RETRIES, tb))
                    return _park("failed", started, boots,
                                 {"failure": name, "traceback": tb[-2000:]})
                delay = BACKOFF_SECONDS[min(attempt, len(BACKOFF_SECONDS) - 1)]
                _write_ledger("retrying", started, boots,
                              {"last_error": name, "retry_in_seconds": delay})
                _log("retrying in %ds (%d/%d)" % (delay, attempt + 1,
                                                  MAX_TRANSIENT_RETRIES))
                time.sleep(delay)
                attempt += 1
    finally:
        stop.set()


if __name__ == "__main__":
    sys.exit(main())
