"""THE DURABLE V5 RUNNER -- a lifecycle around ONE pinned fundamentals V5 rebuild.

It computes nothing. It continues exactly one run, `v5-20260925T124921Z`, by launching the
PINNED code on this service's volume (`/data/fundamentals_pit_v5/code/7dfda83de6a7`) the way
the worker's `launch.py` did:

    python -m api.services.fundamentals_pit.v5_rebuild acquire --dir /data/fundamentals_pit_v5/run
    python -m api.services.fundamentals_pit.v5_rebuild derive  --dir /data/fundamentals_pit_v5/run

⚰️ WHY IT EXISTS. The run was launched detached on the WORKER on 2026-09-25. The worker
redeploys on every `api/**` push; the run died at ~19:16Z with the redeploy, and the only
relauncher was a loop inside a Claude session that had already ended. 36,329 of 236,913
filings were checkpointed, then nothing for three days. This service redeploys only when
someone deploys it on purpose, and it resumes the SAME run after its own restarts.

⛔ NOT A SCHEDULER. It knows one run id and refuses anything else. It never initialises a run,
never publishes, never touches a production store, index, catalogue or flag.

EVERY LAUNCH IS PRECEDED BY THE EXACT-RUN IDENTITY CHECK (`identity()`, executed by the
PINNED code in a subprocess): run id, code SHA, code-tree hash, methodology digest,
derivation version, output store, source-store sha256, filing census (count + digest of
checked UNION unchecked, overlap 0), company census, raw snapshot-content digest. Any
mismatch -> FAILED (identity), parked, never launched.

STATES (control dir `/data/_runner`, ledger `status.json`, append-only `events.jsonl`,
per-leg SEC counters `legs.json`):
    AWAITING_TRANSFER  run material absent -> park
    HOLD               `HOLD` file present -> identity is checked, nothing is launched
    RUNNING            acquisition leg alive and checkpoints advancing
    STALLED            alive, no new checkpoint for STALL_WARN_S (after STALL_KILL_S the leg
                       is terminated and resumed -- checkpoints make that lossless)
    PROCESS_EXITED     a leg died unexpectedly -> identity again -> resume (bounded)
    ACQUISITION_COMPLETE  acquire rc 0 and acquisition.json: complete == census, 0 unresolved
    DERIVING / DERIVATION_COMPLETE
    FAILED             identity mismatch, or bounded retries exhausted -> park
PARK, NEVER EXIT: railway.json restarts every service ALWAYS, so a terminal state that
exited would restart-loop. It keeps serving its state on `/` and `/api/health` instead.

SINGLETON: `flock` on `/data/_runner/runner.lock` (released by the kernel on any death).
"""
from __future__ import annotations

import hashlib
import json
import os
import signal
import sqlite3
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

RUN_ID = "v5-20260925T124921Z"
ROOT = "/data/fundamentals_pit_v5"
RUN = ROOT + "/run"
CODE = ROOT + "/code/7dfda83de6a7"
DB = RUN + "/v5.db"
SOURCE = "/data/fundamentals_pit.db"
CTL = "/data/_runner"
HOLD = CTL + "/HOLD"
STATUS = CTL + "/status.json"
EVENTS = CTL + "/events.jsonl"
LEGS = CTL + "/legs.json"
ACQUIRED = CTL + "/ACQUISITION_COMPLETE"
DERIVED = CTL + "/DERIVATION_COMPLETE"
FAILED = CTL + "/FAILED"

PINNED = {
    "run_id": RUN_ID,
    "code_sha": "7dfda83de6a78da0eb48fedc3d05ca588cf840b4",
    "code_tree_sha256": "3787895026799889798716e74734b513ce500c7ccf790229219e091dd45a8962",
    "methodology_sha256": "556cbada8c64094984c303004deea0556344529d892e6d26a9b03f96010d54d4",
    "derivation_version": 5,
    "output_store": DB,
    "source_store": SOURCE,
    "source_sha256": "ae494e3623a8aeb74bc32bdef99215619f356ad3226a0a57a11e634166084592",
    "census_filings": 236913,
    "census_digest": "5d239fd933be60f1c607e10c00fc0a0b6d1f88ee6004bc535d8668be61fa376e",
    "companies": 6605,
    "snapshot_digest": "f8564d848ee06717cfe05903c6bae7197fb9f8b76ba5fc399fca6b45dcb346c1",
}
SNAPSHOT_EXCLUDE = {"filing_signal", "signal_check", "series_point", "series_build", "pending_refresh", "publish_log"}

TICK_S = 60
STALL_WARN_S = 45 * 60
STALL_KILL_S = 120 * 60
MAX_CRASH_RESUMES = 6            # consecutive leg deaths with NO checkpoint progress in between
UNRESOLVED_BACKOFF_S = (15 * 60, 30 * 60, 60 * 60, 120 * 60, 240 * 60)

_state = {"state": "BOOTING", "run_id": RUN_ID, "boot_at": None, "pid": os.getpid()}
_lock = threading.Lock()


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _log(msg: str) -> None:
    sys.stdout.write("[v5-runner %s] %s\n" % (_now(), msg))
    sys.stdout.flush()


def _write_json(path: str, doc) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(doc, f, indent=1, default=str)
    os.replace(tmp, path)


def _event(kind: str, **kw) -> None:
    rec = {"at": _now(), "event": kind, "pid": os.getpid()} | kw
    with open(EVENTS, "a") as f:
        f.write(json.dumps(rec, default=str) + "\n")
    _log("%s %s" % (kind, json.dumps(kw, default=str)[:600]))


def _set(**kw) -> None:
    with _lock:
        _state.update(kw)
        _state["updated_at"] = _now()
        doc = dict(_state)
    try:
        _write_json(STATUS, doc)
    except OSError:
        pass


# ------------------------------------------------------------------ identity (PINNED code)

def identity() -> dict:
    """Runs INSIDE the pinned code tree (PYTHONPATH=CODE). Read-only."""
    sys.path.insert(0, CODE)
    from api.services.fundamentals_pit import incremental as INC, v5_rebuild as R
    run = json.load(open(RUN + "/run.json"))
    h = hashlib.sha256()
    with open(SOURCE, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    conn = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
    checked = [r[0] for r in conn.execute("SELECT accn FROM signal_check")]
    sources = dict(conn.execute("SELECT source, count(*) FROM signal_check GROUP BY source").fetchall())
    unchecked = [a for _, a in INC._unchecked(conn)]
    allc = sorted(set(checked) | set(unchecked))
    tables = sorted(r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
                    if r[0] not in SNAPSHOT_EXCLUDE and not r[0].startswith("sqlite_"))
    snap = hashlib.sha256()
    for t in tables:
        cols = [c[1] for c in conn.execute("PRAGMA table_info(%s)" % t)]
        snap.update(("#%s:%s\n" % (t, ",".join(cols))).encode())
        for row in conn.execute("SELECT * FROM %s" % t):
            snap.update(repr(row).encode())
    got = {
        "run_id": run["run_id"], "code_sha": run["code_sha"], "code_tree_sha256": R.code_tree_sha256(),
        "code_tree_sha256_in_run_json": run["code_tree_sha256"],
        "methodology_sha256": hashlib.sha256(run["methodology"].encode()).hexdigest(),
        "methodology_equals_module": run["methodology"] == R.METHODOLOGY,
        "derivation_version": run["derivation_version"], "module_version": R.V5,
        "output_store": run["output_store"], "source_store": run["source_store"],
        "source_sha256": h.hexdigest(), "source_sha256_in_run_json": run["source_sha256"],
        "census_filings": len(allc), "census_filings_in_run_json": run["census"]["filings"],
        "census_digest": hashlib.sha256("\n".join(allc).encode()).hexdigest(),
        "census_digest_in_run_json": run["census"]["accn_list_sha256"],
        "companies": conn.execute("SELECT count(DISTINCT cik) FROM fact").fetchone()[0],
        "snapshot_digest": snap.hexdigest(),
        "checked": len(checked), "unchecked": len(unchecked), "overlap": len(set(checked) & set(unchecked)),
        "checkpoint_sources": sources,
        "v5_points": conn.execute("SELECT count(*) FROM series_point WHERE derivation_version=5").fetchone()[0],
        "v5_builds": conn.execute("SELECT count(*) FROM series_build WHERE derivation_version=5").fetchone()[0],
        "other_version_points": conn.execute("SELECT count(*) FROM series_point WHERE derivation_version!=5").fetchone()[0],
    }
    conn.close()
    bad = [k for k, v in PINNED.items() if got.get(k) != v]
    for a, b in (("code_tree_sha256", "code_tree_sha256_in_run_json"), ("source_sha256", "source_sha256_in_run_json"),
                 ("census_filings", "census_filings_in_run_json"), ("census_digest", "census_digest_in_run_json")):
        if got[a] != got[b]:
            bad.append(b)
    if not got["methodology_equals_module"]:
        bad.append("methodology_equals_module")
    if got["module_version"] != 5:
        bad.append("module_version")
    if got["overlap"] != 0 or got["checked"] + got["unchecked"] != PINNED["census_filings"]:
        bad.append("checkpoint_partition")
    if set(sources) - {"instance"}:
        bad.append("checkpoint_sources")
    if got["other_version_points"]:
        bad.append("other_version_points")
    got["mismatches"] = bad
    got["ok"] = not bad
    return got


def _run_identity() -> dict:
    env = dict(os.environ, PYTHONPATH=CODE)
    t0 = time.time()
    p = subprocess.run([sys.executable, os.path.abspath(__file__), "--identity"], cwd=CODE, env=env,
                       capture_output=True, text=True, timeout=3600)
    try:
        res = json.loads(p.stdout.strip().splitlines()[-1])
    except Exception:
        res = {"ok": False, "mismatches": ["identity_crashed"], "rc": p.returncode, "stderr": p.stderr[-1500:]}
    res["elapsed_s"] = round(time.time() - t0, 1)
    return res


# ------------------------------------------------------------------ progress

def _checkpoints() -> tuple[int | None, float | None]:
    try:
        c = sqlite3.connect("file:%s?mode=ro" % DB, uri=True, timeout=10)
        try:
            n = c.execute("SELECT count(*) FROM signal_check").fetchone()[0]
            last = c.execute("SELECT max(rowid) FROM signal_check").fetchone()[0]
            accn = c.execute("SELECT accn FROM signal_check WHERE rowid=?", (last,)).fetchone() if last else None
            return n, (accn[0] if accn else None)
        finally:
            c.close()
    except sqlite3.Error:
        return None, None


def _progress_json() -> dict:
    try:
        return json.load(open(RUN + "/progress.json"))
    except Exception:
        return {}


def _record_leg(leg_key: str, snap: dict) -> None:
    legs = {}
    try:
        legs = json.load(open(LEGS))
    except Exception:
        pass
    legs[leg_key] = snap
    _write_json(LEGS, legs)


# ------------------------------------------------------------------ legs

def _launch(phase: str) -> subprocess.Popen:
    env = dict(os.environ)
    env.update({"PYTHONPATH": CODE, "SEC_MAX_RPS": "5", "FUNDAMENTALS_PIT_PUBLISH_R2": "0"})
    env.pop("FUNDAMENTALS_PIT_INCREMENTAL_ENABLED", None)
    log = open(RUN + "/%s.log" % phase, "ab")
    return subprocess.Popen([sys.executable, "-m", "api.services.fundamentals_pit.v5_rebuild", phase, "--dir", RUN],
                            cwd=CODE, env=env, stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL)


def _park(state: str, **kw) -> None:
    _set(state=state, parked=True, **kw)
    _event("park", state=state, **kw)
    while True:
        time.sleep(3600)


def _fail(reason: str, **kw) -> None:
    with open(FAILED, "w") as f:
        json.dump({"at": _now(), "reason": reason} | kw, f, default=str)
    _park("FAILED", reason=reason, **kw)


def _guarded_identity(purpose: str) -> dict:
    _set(state="CHECKING_IDENTITY", purpose=purpose)
    ident = _run_identity()
    _event("identity", purpose=purpose, ok=ident.get("ok"), mismatches=ident.get("mismatches"),
           checked=ident.get("checked"), unchecked=ident.get("unchecked"), elapsed_s=ident.get("elapsed_s"))
    _set(last_identity={k: ident.get(k) for k in ("ok", "mismatches", "checked", "unchecked", "overlap", "v5_points",
                                                  "v5_builds", "elapsed_s")} | {"at": _now(), "purpose": purpose})
    if not ident.get("ok"):
        _fail("identity", identity=ident)
    return ident


def acquire_loop() -> None:
    crash_streak, unresolved_round = 0, 0
    while True:
        _guarded_identity("before acquire leg")
        if os.path.exists(HOLD):
            _park("HOLD", note="identity verified; HOLD present -> nothing launched")
        start_n, _ = _checkpoints()
        proc = _launch("acquire")
        leg_started = time.time()
        _event("leg_start", phase="acquire", child_pid=proc.pid, checkpoints=start_n)
        last_n, last_move = start_n, time.time()
        window = [(time.time(), start_n)]
        while proc.poll() is None:
            time.sleep(TICK_S)
            n, last_accn = _checkpoints()
            now = time.time()
            if n is not None and last_n is not None and n > last_n:
                last_n, last_move = n, now
            if n is not None:
                window.append((now, n))
                window[:] = [w for w in window if now - w[0] <= 30 * 60]
            rate = ((window[-1][1] - window[0][1]) / ((window[-1][0] - window[0][0]) / 60)
                    if len(window) > 1 and window[-1][0] > window[0][0] else None)
            prog = _progress_json()
            leg_key = "leg_%s" % prog.get("resumes", "?")
            leg_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(leg_started))
            if prog and prog.get("at", "") >= leg_iso:          # never re-label an earlier leg's ledger
                _record_leg(leg_key, {"host": "fundamentals-v5-runner", "child_pid": proc.pid,
                                      "sec": prog.get("sec"), "this_process": prog.get("this_process"),
                                      "progress_at": prog.get("at")})
            idle = now - last_move
            state = "RUNNING" if idle < STALL_WARN_S else "STALLED"
            total = PINNED["census_filings"]
            _set(state=state, phase="acquire", child_pid=proc.pid, completed=n, remaining=(total - n) if n else None,
                 total=total, last_checkpoint_accn=last_accn,
                 last_checkpoint_seen_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(last_move)),
                 per_min_recent_30m=round(rate, 1) if rate is not None else None,
                 eta_h=round((total - n) / rate / 60, 1) if rate and n else None,
                 leg_started_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(leg_started)),
                 leg_checkpoints=(n - start_n) if (n is not None and start_n is not None) else None,
                 sec_this_leg=prog.get("sec"), parked=False)
            if idle >= STALL_KILL_S:
                _event("stall_kill", idle_s=round(idle), child_pid=proc.pid, checkpoints=n)
                proc.terminate()
                try:
                    proc.wait(120)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()
        rc = proc.returncode
        end_n, _ = _checkpoints()
        progressed = (end_n or 0) > (start_n or 0)
        _event("leg_exit", phase="acquire", rc=rc, checkpoints=end_n, leg_checkpoints=(end_n or 0) - (start_n or 0))
        if rc == 0:
            acq = json.load(open(RUN + "/acquisition.json"))
            if acq.get("complete") == PINNED["census_filings"] and not acq.get("unresolved"):
                with open(ACQUIRED, "w") as f:
                    json.dump({"at": _now(), "complete": acq["complete"]}, f)
                _event("acquisition_complete", complete=acq["complete"])
                return
            _fail("acquire rc 0 but acquisition.json incomplete", acquisition={k: acq.get(k) for k in ("complete", "total")})
        if rc == 2 and os.path.exists(RUN + "/acquisition.json"):
            acq = json.load(open(RUN + "/acquisition.json"))
            if acq.get("finished_at", "") >= time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(leg_started)):
                # the pass loop ended with failures that stopped shrinking: transient SEC trouble is retried
                # later, never recorded as absence; bounded, then a human decides.
                if unresolved_round >= len(UNRESOLVED_BACKOFF_S):
                    _fail("unresolved filings after bounded retries", unresolved=len(acq.get("unresolved") or []))
                wait = UNRESOLVED_BACKOFF_S[unresolved_round]
                unresolved_round += 1
                _set(state="UNRESOLVED_BACKOFF", unresolved=len(acq.get("unresolved") or []), retry_in_s=wait)
                _event("unresolved_backoff", unresolved=len(acq.get("unresolved") or []), wait_s=wait, round=unresolved_round)
                time.sleep(wait)
                continue
        crash_streak = 0 if progressed else crash_streak + 1
        if crash_streak >= MAX_CRASH_RESUMES:
            _fail("acquire leg keeps dying without progress", rc=rc, streak=crash_streak)
        _set(state="PROCESS_EXITED", rc=rc)
        time.sleep(30 if progressed else min(1800, 60 * 2 ** crash_streak))


def derive_once() -> None:
    ident = _guarded_identity("before derive")
    if ident["checked"] != PINNED["census_filings"]:
        _fail("derive requested with incomplete acquisition", checked=ident["checked"])
    _set(state="DERIVING", phase="derive")
    t0 = time.time()
    proc = _launch("derive")
    _event("leg_start", phase="derive", child_pid=proc.pid)
    while proc.poll() is None:
        time.sleep(TICK_S)
        _set(state="DERIVING", phase="derive", child_pid=proc.pid, derive_elapsed_s=round(time.time() - t0))
    _event("leg_exit", phase="derive", rc=proc.returncode, elapsed_s=round(time.time() - t0))
    if proc.returncode != 0:
        _fail("derive failed", rc=proc.returncode)
    with open(DERIVED, "w") as f:
        json.dump({"at": _now(), "elapsed_s": round(time.time() - t0)}, f)


# ------------------------------------------------------------------ http

class _H(BaseHTTPRequestHandler):
    def do_GET(self):
        with _lock:
            body = json.dumps(_state, indent=1, default=str).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body if self.path != "/api/health" else b'{"ok": true}')

    def log_message(self, *a):
        pass


def _serve() -> None:
    port = int(os.environ.get("PORT", "8080"))
    ThreadingHTTPServer(("0.0.0.0", port), _H).serve_forever()


def main() -> None:
    os.makedirs(CTL, exist_ok=True)
    threading.Thread(target=_serve, daemon=True).start()
    _state["boot_at"] = _now()
    import fcntl
    fd = os.open(CTL + "/runner.lock", os.O_RDWR | os.O_CREAT, 0o644)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        _log("another supervisor holds the lock -- parking without touching anything")
        while True:
            time.sleep(3600)
    os.ftruncate(fd, 0)
    os.write(fd, ("pid=%d boot=%s\n" % (os.getpid(), _now())).encode())
    boots = 1
    try:
        boots = json.load(open(STATUS)).get("boot_count", 0) + 1
    except Exception:
        pass
    _set(state="BOOTING", boot_count=boots, parked=False)
    _event("boot", boot_count=boots, hold=os.path.exists(HOLD))
    signal.signal(signal.SIGTERM, lambda *a: (_event("sigterm"), os._exit(0)))
    if os.path.exists(FAILED):
        _park("FAILED", reason=json.load(open(FAILED)).get("reason"), note="FAILED marker present; a human clears it")
    if not (os.path.exists(RUN + "/run.json") and os.path.exists(DB) and os.path.isdir(CODE) and os.path.exists(SOURCE)):
        _park("AWAITING_TRANSFER")
    if not os.path.exists(ACQUIRED):
        acquire_loop()
    if not os.path.exists(DERIVED):
        derive_once()
    _guarded_identity("after derive")
    _park("DERIVATION_COMPLETE")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--identity":
        print(json.dumps(identity(), default=str))
    else:
        main()
