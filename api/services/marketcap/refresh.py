"""Market Cap V1 SCHEDULED FULL REFRESH -- one durable, singleton, checkpointed run per scheduled tick.

    python -m api.services.marketcap.refresh run    --root ROOT [--run-id ID]      # one run (resumes ID if given)
    python -m api.services.marketcap.refresh status --root ROOT
    python -m api.services.marketcap.refresh hold   --root ROOT --reason TEXT       # park every future run
    python -m api.services.marketcap.refresh release --root ROOT

A RUN (every stage idempotent, recorded in ROOT/ledger.db with timings, CPU and peak memory):
  sources     universe, prices, reference (production-only sources, or pinned files)  -> runs/<id>/data
              the universe is DURABLE: today's universe + every issuer / ticker the identity ledger attributed earlier
  sec_bulk    SEC companyfacts + submissions (public; Last-Modified recorded)
  inputs      inputs.db, acceptance.db, lineage (fileno.db, lineage.db), predecessors (pred_*.db)
  identity    the previous evidence state's identity.db (identity_ledger.py) + this run's SEC snapshot recorded
  evidence    previous run's evidence DBs copied; every harvest RESUMED (new filings only); completeness checked
  build       full build (build.py, pinned methodology); build-dependent evidence (econ, held splits) harvested;
              rebuilt once if that evidence changed. The release build DB is made read-only and hashed.
  suite       the report suite (validation.run_suite) and the automated gates (gates.py) -> validation.json
  publish     PASS only: private immutable publication + full verification (publication.publish_build)
  advance     only by policy (auto_advance): never the first authority, never across a methodology change
FINAL STATES: ADVANCED | PUBLISHED_NOT_ADVANCED | GATES_FAILED | FAILED | WAITING_UPSTREAM | HOLD | BUSY.
A failed run never touches the pointer: the previous authority keeps serving, and status.json says why.

SINGLE OWNER: an OS lock on ROOT/refresh.lock for the whole run (a second process -- an overlapping deploy, a
second replica, a manual run -- gets BUSY); HOLD file parks runs without a deploy.
"""
from __future__ import annotations

import argparse
import ctypes
import gzip
import json
import os
import shutil
import socket
import sqlite3
import stat
import subprocess
import sys
import threading
import time
import traceback
from datetime import datetime, timezone

from . import acquire as Q, identity_ledger as IL, methodology as M, publication as P, release_contract as C

PY = sys.executable
LEDGER_DDL = """
CREATE TABLE IF NOT EXISTS run(run_id TEXT PRIMARY KEY, state TEXT, stage TEXT, started_at TEXT, finished_at TEXT,
  build_id TEXT, manifest_sha256 TEXT, error TEXT, host TEXT, pid INTEGER, result TEXT);
CREATE TABLE IF NOT EXISTS stage(run_id TEXT, stage TEXT, state TEXT, started_at TEXT, finished_at TEXT, seconds REAL,
  cpu_seconds REAL, peak_rss_mb REAL, result TEXT, PRIMARY KEY(run_id, stage));
CREATE TABLE IF NOT EXISTS event(at TEXT, run_id TEXT, kind TEXT, detail TEXT);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class Config:
    """ROOT/refresh.json -- sources, review inputs, publication target and policy. Example in the lifecycle doc."""

    def __init__(self, root: str):
        self.root = root
        p = os.path.join(root, "refresh.json")
        self.raw = json.load(open(p)) if os.path.exists(p) else {}
        self.sources = self.raw.get("sources", {})
        self.review = self.raw.get("review", {})
        self.policy = self.raw.get("policy", {})
        self.target_spec = self.raw.get("target", "")          # only the provisioned config decides where to publish
        self.workers = int(self.raw.get("workers", 16))

    def target(self):
        t = self.target_spec
        if t == "r2":
            return P.R2Target()
        if t.startswith("local:"):
            return P.LocalTarget(t[6:])
        raise P.PublishError("no publication target configured")


# ── measurement ──────────────────────────────────────────────────────────────────────────────────────────────────────
class _WinJob:
    """Windows: the venv python.exe is a launcher that spawns the real interpreter, so the direct child's counters
    measure nothing. The child starts SUSPENDED inside a job object; the job accounts CPU and peak memory for the
    whole process tree."""

    def __init__(self):
        from ctypes import wintypes as W
        self.k = ctypes.WinDLL("kernel32", use_last_error=True)
        self.k.CreateJobObjectW.restype = W.HANDLE
        self.job = self.k.CreateJobObjectW(None, None)

    def adopt(self, proc):
        h = ctypes.c_void_p(int(proc._handle))
        self.k.AssignProcessToJobObject(ctypes.c_void_p(self.job), h)
        ctypes.WinDLL("ntdll").NtResumeProcess(h)

    def stats(self) -> tuple[float, float]:
        class IO(ctypes.Structure):
            _fields_ = [(n, ctypes.c_ulonglong) for n in ("r", "w", "o", "rb", "wb", "ob")]

        class BASIC(ctypes.Structure):
            _fields_ = [("PerProcessUserTimeLimit", ctypes.c_longlong), ("PerJobUserTimeLimit", ctypes.c_longlong),
                        ("LimitFlags", ctypes.c_ulong), ("MinimumWorkingSetSize", ctypes.c_size_t),
                        ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", ctypes.c_ulong),
                        ("Affinity", ctypes.c_size_t), ("PriorityClass", ctypes.c_ulong), ("SchedulingClass", ctypes.c_ulong)]

        class EXT(ctypes.Structure):
            _fields_ = [("Basic", BASIC), ("Io", IO), ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                        ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]

        class ACCT(ctypes.Structure):
            _fields_ = [("TotalUserTime", ctypes.c_longlong), ("TotalKernelTime", ctypes.c_longlong),
                        ("ThisPeriodTotalUserTime", ctypes.c_longlong), ("ThisPeriodTotalKernelTime", ctypes.c_longlong),
                        ("TotalPageFaultCount", ctypes.c_ulong), ("TotalProcesses", ctypes.c_ulong),
                        ("ActiveProcesses", ctypes.c_ulong), ("TotalTerminatedProcesses", ctypes.c_ulong)]
        e, a = EXT(), ACCT()
        q = self.k.QueryInformationJobObject
        q(ctypes.c_void_p(self.job), 9, ctypes.byref(e), ctypes.sizeof(e), None)
        q(ctypes.c_void_p(self.job), 1, ctypes.byref(a), ctypes.sizeof(a), None)
        self.k.CloseHandle(ctypes.c_void_p(self.job))
        return e.PeakProcessMemoryUsed / 1e6, (a.TotalUserTime + a.TotalKernelTime) / 1e7


def run_cmd(args: list[str], log: str, env: dict | None = None, cwd: str | None = None) -> dict:
    """Run a stage subprocess; returns wall seconds, CPU seconds and peak memory (MB) of the whole process tree
    (Linux: VmHWM of the child, CPU from RUSAGE_CHILDREN deltas; Windows: a job object). Non-zero exit raises."""
    t0 = time.time()
    peak = [0.0]
    cpu = None
    job = None
    ru0 = None
    if os.name != "nt":
        try:
            import resource
            r = resource.getrusage(resource.RUSAGE_CHILDREN)
            ru0 = r.ru_utime + r.ru_stime
        except Exception:  # noqa: BLE001
            pass
    with open(log, "ab") as lf:
        lf.write(("\n$ " + " ".join(args) + "\n").encode())
        lf.flush()
        flags = 0
        if os.name == "nt":
            try:
                job = _WinJob()
                flags = 0x00000004                      # CREATE_SUSPENDED: in the job before it can spawn anything
            except Exception:  # noqa: BLE001
                job = None
        proc = subprocess.Popen(args, stdout=lf, stderr=subprocess.STDOUT, env=env, cwd=cwd, creationflags=flags)
        if job is not None:
            job.adopt(proc)
        stop = threading.Event()

        def poll():                                 # Linux: high-water mark from /proc while it runs
            while not stop.is_set():
                try:
                    for line in open(f"/proc/{proc.pid}/status"):
                        if line.startswith("VmHWM:"):
                            peak[0] = max(peak[0], int(line.split()[1]) / 1e3)
                except OSError:
                    pass
                stop.wait(1.0)
        if os.path.exists("/proc"):
            threading.Thread(target=poll, daemon=True).start()
        rc = proc.wait()
        stop.set()
        if job is not None:
            try:
                peak[0], cpu = job.stats()
            except Exception:  # noqa: BLE001
                pass
        elif ru0 is not None:
            import resource
            r = resource.getrusage(resource.RUSAGE_CHILDREN)
            cpu = r.ru_utime + r.ru_stime - ru0
    out = {"rc": rc, "seconds": round(time.time() - t0, 1), "cpu_seconds": round(cpu, 1) if cpu is not None else None,
           "peak_rss_mb": round(peak[0], 1)}
    if rc != 0:
        raise RuntimeError(f"{args[2] if len(args) > 2 else args} exited {rc} (log {log})")
    return out


def mod(name: str, *a) -> list[str]:
    return [PY, "-m", f"api.services.marketcap.{name}", *map(str, a)]


# ── the ledger ──────────────────────────────────────────────────────────────────────────────────────────────────────
# an interrupted run younger than this is resumed (checkpoints); the schedule's own window is far shorter
RESUME_HOURS = float(os.environ.get("MCAP_PIT_RESUME_HOURS", "20"))


class Ledger:
    def __init__(self, root: str):
        self.db = sqlite3.connect(os.path.join(root, "ledger.db"), timeout=30)
        self.db.executescript(LEDGER_DDL)

    def run(self, run_id):
        r = self.db.execute("SELECT * FROM run WHERE run_id=?", (run_id,)).fetchone()
        return dict(zip([d[0] for d in self.db.execute("SELECT * FROM run LIMIT 0").description], r)) if r else None

    def start_run(self, run_id):
        with self.db:
            self.db.execute("INSERT OR IGNORE INTO run(run_id, state, started_at, host, pid) VALUES (?,?,?,?,?)",
                            (run_id, "RUNNING", now_iso(), socket.gethostname(), os.getpid()))
            self.db.execute("UPDATE run SET state='RUNNING', pid=?, error=NULL, finished_at=NULL WHERE run_id=?", (os.getpid(), run_id))

    def finish_run(self, run_id, state, **kw):
        with self.db:
            self.db.execute("UPDATE run SET state=?, finished_at=?, build_id=COALESCE(?, build_id), "
                            "manifest_sha256=COALESCE(?, manifest_sha256), error=?, result=? WHERE run_id=?",
                            (state, now_iso(), kw.get("build_id"), kw.get("manifest_sha256"), kw.get("error"),
                             json.dumps(kw.get("result"), default=str), run_id))

    def stage_done(self, run_id, stage):
        r = self.db.execute("SELECT result FROM stage WHERE run_id=? AND stage=? AND state='DONE'", (run_id, stage)).fetchone()
        return json.loads(r[0]) if r else None

    def record(self, run_id, stage, state, started, res: dict):
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO stage VALUES (?,?,?,?,?,?,?,?,?)",
                            (run_id, stage, state, started, now_iso(), res.get("seconds"), res.get("cpu_seconds"),
                             res.get("peak_rss_mb"), json.dumps(res, default=str)))
            self.db.execute("UPDATE run SET stage=? WHERE run_id=?", (stage, run_id))

    def event(self, run_id, kind, detail):
        with self.db:
            self.db.execute("INSERT INTO event VALUES (?,?,?,?)", (now_iso(), run_id, kind, json.dumps(detail, default=str)[:4000]))

    def last(self, states=None):
        q = "SELECT run_id FROM run" + (f" WHERE state IN ({','.join('?' * len(states))})" if states else "") + \
            " ORDER BY started_at DESC LIMIT 1"
        r = self.db.execute(q, tuple(states or ())).fetchone()
        return self.run(r[0]) if r else None


# ── the run ─────────────────────────────────────────────────────────────────────────────────────────────────────────
class Refresh:
    def __init__(self, root: str, run_id: str | None = None):
        self.root = root
        self.cfg = Config(root)
        self.ledger = Ledger(root)
        self.explicit_run_id = run_id is not None
        if run_id is None:                    # a generated id never re-plays an existing run's checkpoints
            base = "run-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            run_id, n = base, 1
            while self.ledger.run(run_id) is not None or os.path.exists(os.path.join(root, "runs", run_id)):
                n += 1
                run_id = f"{base}-{n}"
        self._set_run(run_id)
        self.env = {**os.environ, "MCAP_CACHE": self.cfg.raw.get("cache_dir") or os.path.join(root, "cache"), "PYTHONUTF8": "1",
                    "SEC_MAX_RPS": str(self.cfg.raw.get("sec_max_rps", os.environ.get("SEC_MAX_RPS", "4")))}
        self.repo = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

    def _set_run(self, run_id: str) -> None:
        self.run_id = run_id
        self.rdir = os.path.join(self.root, "runs", run_id)
        self.data = os.path.join(self.rdir, "data")
        self.logs = os.path.join(self.rdir, "logs")

    def _adopt_interrupted(self) -> dict | None:
        """Called holding the run lock, so every run still marked RUNNING is DEAD (a deploy / restart / OOM killed it).
        The newest one that started within RESUME_HOURS is RESUMED under its own run id: its DONE stages are
        checkpoints, so a worker restart costs only the interrupted stage. Older ones are closed as CRASHED."""
        dead = [r for (r,) in self.ledger.db.execute("SELECT run_id FROM run WHERE state='RUNNING' ORDER BY started_at DESC")]
        adopted = None
        for rid in dead:
            r = self.ledger.run(rid)
            age_h = (datetime.now(timezone.utc) - datetime.fromisoformat(r["started_at"].replace("Z", "+00:00"))).total_seconds() / 3600
            if adopted is None and age_h <= RESUME_HOURS:
                adopted = r
            else:
                self.ledger.finish_run(rid, "CRASHED", error=f"interrupted at {r.get('stage')}; not resumed (age {age_h:.1f} h)")
        if adopted is not None:
            self.ledger.event(adopted["run_id"], "resumed", {"stage": adopted.get("stage"), "pid_was": adopted.get("pid")})
            self._set_run(adopted["run_id"])
        return adopted

    # one stage: skipped if already DONE in this run (checkpoint), recorded either way
    def stage(self, name, fn):
        prev = self.ledger.stage_done(self.run_id, name)
        if prev is not None:
            return prev
        started = now_iso()
        self.heartbeat(stage=name)
        t0 = time.time()
        try:
            res = fn() or {}
        except Exception as e:
            self.ledger.record(self.run_id, name, "FAILED", started, {"error": f"{type(e).__name__}: {e}"[:2000],
                                                                      "seconds": round(time.time() - t0, 1)})
            raise
        res.setdefault("seconds", round(time.time() - t0, 1))
        self.ledger.record(self.run_id, name, "DONE", started, res)
        return res

    def cmd(self, args, log):
        return run_cmd(args, os.path.join(self.logs, log), env=self.env, cwd=self.repo)

    def _prev_identity(self) -> str | None:
        prev = self.prev_success_data()
        p = os.path.join(prev, "identity.db") if prev else None
        return p if p and os.path.exists(p) else None

    def _identity(self):
        """Carry the durable identity ledger forward and record this run's SEC snapshot. Fails closed: a previous evidence
        state without a ledger would make every no-longer-current issuer vanish (seed it: identity_ledger seed)."""
        out = os.path.join(self.data, "identity.db")
        prev = self._prev_identity()
        if prev is None and not self.cfg.policy.get("identity_bootstrap"):
            raise RuntimeError("no identity.db in the previous evidence state: refusing to build without durable identity")
        if os.path.exists(out):
            os.remove(out)
        if prev:
            shutil.copyfile(prev, out)
        rec = IL.record(out, os.path.join(self.data, "inputs.db"))
        return {"from": prev, **rec, "counts": Q.evidence_counts(out)}

    def prev_success_data(self) -> str | None:
        r = self.ledger.last(("ADVANCED", "PUBLISHED_NOT_ADVANCED"))
        if r and os.path.isdir(os.path.join(self.root, "runs", r["run_id"], "data")):
            return os.path.join(self.root, "runs", r["run_id"], "data")
        seed = os.path.join(self.root, "seed")
        return seed if os.path.isdir(seed) else None

    # ── sources ────────────────────────────────────────────────────────────────────────────────────────────────────
    def _source_file(self, kind: str, name: str):
        s = self.cfg.sources.get(kind, {})
        out = os.path.join(self.data, name)
        if s.get("kind") == "file":
            shutil.copyfile(s["path"], out)
            return {"source": "file", "path": s["path"], "sha256": P.file_sha(out)[0]}
        return None

    def sources(self):
        os.makedirs(self.data, exist_ok=True)
        os.makedirs(self.logs, exist_ok=True)
        S = self.cfg.sources
        res = {}
        uni = os.path.join(self.data, "sec_t.json.gz")
        cur = os.path.join(self.data, "universe_current.json.gz")
        su = S.get("universe", {})
        res["universe"] = self._source_file("universe", "universe_current.json.gz") or (
            {"source": "v5_published", **Q.universe_from_v5_published(cur)} if su.get("kind") == "v5_published" else
            {"source": "v5_security", **Q.universe_from_v5(su["db"], cur)})
        # ⭐ an issuer leaving today's universe keeps its prices / reference / SEC inputs (identity_ledger.py)
        res["universe"]["durable"] = IL.durable_universe(self._prev_identity(), cur, uni)
        bound = self.cfg.policy.get("universe_ciks")
        if bound:                             # PARITY HARNESS ONLY: the same pipeline over a named issuer set
            u = json.loads(gzip.decompress(open(uni, "rb").read()))
            keep = {str(int(c)) for c in bound}
            u = {k: v for k, v in u.items() if k in keep}
            open(uni, "wb").write(gzip.compress(json.dumps(u, sort_keys=True).encode(), mtime=0))
            res["universe"]["bounded_to"] = len(u)
        res["prices"] = self._source_file("prices", "prices.db") or \
            {"source": "bars_db", **Q.prices_from_bars(S["prices"]["db"], uni, os.path.join(self.data, "prices.db"))}
        res["reference"] = self._source_file("reference", "ref.jsonl") or \
            {"source": "massive", **Q.reference_from_massive(uni, os.path.join(self.data, "ref.jsonl"))}
        return res

    def sec(self):
        s = self.cfg.sources.get("sec_bulk", {})
        d = os.path.join(self.rdir, "sec")
        if s.get("kind") == "file":
            os.makedirs(d, exist_ok=True)
            out = {}
            for n in Q.SEC_BULK:
                if not os.path.exists(os.path.join(d, n)):
                    os.link(os.path.join(s["dir"], n), os.path.join(d, n))
                out[n] = {"path": os.path.join(d, n), "sha256": P.file_sha(os.path.join(d, n))[0],
                          "last_modified": (s.get("last_modified") or {}).get(n)}
            return out
        return Q.sec_bulk(d)

    # ── run ────────────────────────────────────────────────────────────────────────────────────────────────────────
    def heartbeat(self, **kw):
        hb = {"in_progress": True, "run_id": self.run_id, "stage": kw.get("stage"), "at": now_iso(),
              "last_run": self._last_summary(), "host": socket.gethostname()}
        self._write_status(hb)

    def _last_summary(self):
        r = self.ledger.last(("ADVANCED", "PUBLISHED_NOT_ADVANCED", "GATES_FAILED", "FAILED", "WAITING_UPSTREAM", "HOLD"))
        if not r:
            return None
        return {k: r.get(k) for k in ("run_id", "state", "stage", "started_at", "finished_at", "build_id", "error")}

    def _write_status(self, hb):
        body = json.dumps(hb, indent=1, default=str).encode()
        open(os.path.join(self.root, "status.json"), "wb").write(body)
        try:
            self.cfg.target().put_mutable(C.STATUS_KEY, body)
        except Exception as e:  # noqa: BLE001 -- the heartbeat never fails a run
            self.ledger.event(self.run_id, "status_write_failed", str(e))

    def execute(self) -> dict:
        if os.path.exists(os.path.join(self.root, "HOLD")):
            self.ledger.start_run(self.run_id)
            self.ledger.finish_run(self.run_id, "HOLD", error=open(os.path.join(self.root, "HOLD")).read()[:500])
            return {"state": "HOLD"}
        from api.services.fundamentals_pit.schedule import _try_lock
        fd = _try_lock(os.path.join(self.root, "refresh.lock"))
        if fd is None:
            return {"state": "BUSY", "detail": "another refresh holds the lock"}
        try:
            if not self.explicit_run_id:
                self._adopt_interrupted()
            return self._execute_locked()
        finally:
            fd.close()

    def _execute_locked(self) -> dict:
        L = self.ledger
        L.start_run(self.run_id)
        result: dict = {"run_id": self.run_id}
        try:
            drift = M.drift()
            if drift:
                raise RuntimeError(f"methodology drift {drift}: this code cannot produce a V1 release")
            src = self.stage("sources", self.sources)
            sec = {k: v for k, v in self.stage("sec_bulk", self.sec).items() if k in Q.SEC_BULK}
            result["sources"] = src
            prev = self.prev_success_data()
            if prev and self.cfg.policy.get("skip_when_inputs_unchanged", True):
                same = all(P.file_sha(os.path.join(prev, n))[0] == P.file_sha(os.path.join(self.data, n))[0]
                           for n in ("prices.db",) if os.path.exists(os.path.join(prev, n)))
                prev_sec = (self.ledger.last(("ADVANCED", "PUBLISHED_NOT_ADVANCED")) or {}).get("result")
                if same and prev_sec and json.loads(prev_sec or "{}").get("sec_sha") == {k: v["sha256"] for k, v in sec.items()}:
                    self.ledger.finish_run(self.run_id, "WAITING_UPSTREAM", error="no new prices and no new SEC bulk")
                    self._final()
                    return {"state": "WAITING_UPSTREAM"}
            cf, sub = sec["companyfacts.zip"]["path"], sec["submissions.zip"]["path"]
            uni = os.path.join(self.data, "sec_t.json.gz")
            self.stage("inputs", lambda: self.cmd(mod("inputs", "--companyfacts", cf, "--submissions", sub, "--universe", uni,
                                                      "--out", os.path.join(self.data, "inputs.db")), "inputs.log"))
            self.stage("identity", self._identity)
            self.stage("acceptance", self._acceptance)
            fresh = bool(self.cfg.policy.get("fresh_evidence"))   # FULL: every harvest re-derives (through the cache)
            self.stage("evidence_seed", lambda: {"copied": Q.seed_evidence(prev, self.data) if prev and not fresh else {},
                                                 "from": None if fresh else prev, "fresh_evidence": fresh})
            self.stage("lineage", lambda: self._lineage(sub))
            self.stage("predecessors", lambda: self._predecessors(cf, sub))
            self.stage("plan", lambda: self.cmd(mod("plan_harvests", "--data", self.data), "plan.log"))
            self.stage("harvests", self._harvests)
            b1 = self.stage("build_1", lambda: {**self._build("build_1.log"), "stage": "build_1"})
            dep = self.stage("dependent_evidence", lambda: self._dependent(b1["build_path"]))
            final = b1
            if dep["changed"]:
                final = self.stage("build_2", lambda: {**self._build("build_2.log"), "stage": "build_2"})
            bpath = final["build_path"]
            self.stage("seal", lambda: self._seal(bpath))
            self.stage("suite", lambda: self._suite(bpath))
            val = self.stage("gates", lambda: self._gates(bpath))
            result.update(build_id=final["build_id"], gates=val["status"], failed=val.get("failed"))
            if val["status"] != "PASS":
                L.finish_run(self.run_id, "GATES_FAILED", build_id=final["build_id"], error=f"gates failed: {val.get('failed')}",
                             result=result)
                self._final()
                return {"state": "GATES_FAILED", **result}
            pub = self.stage("publish", lambda: self._publish(bpath, final, src, sec))
            result.update(manifest_sha256=pub["manifest_sha256"], sec_sha={k: v["sha256"] for k, v in sec.items()})
            adv = self.stage("advance", lambda: self._advance(final["build_id"], pub["manifest_sha256"]))
            state = "ADVANCED" if adv.get("advanced") else "PUBLISHED_NOT_ADVANCED"
            result["advance"] = adv
            L.finish_run(self.run_id, state, build_id=final["build_id"], manifest_sha256=pub["manifest_sha256"], result=result)
            self._final()
            return {"state": state, **result}
        except Exception as e:  # noqa: BLE001 -- recorded; the authority is untouched
            r = L.run(self.run_id) or {}
            L.event(self.run_id, "failure", traceback.format_exc()[-3000:])
            L.finish_run(self.run_id, "FAILED", error=f"{r.get('stage')}: {type(e).__name__}: {e}"[:1500], result=result)
            self._final()
            return {"state": "FAILED", "stage": r.get("stage"), "error": str(e)[:500], **result}

    def _final(self):
        hb = {"in_progress": False, "run_id": None, "at": now_iso(), "last_run": self._last_summary(),
              "last_success_at": (self.ledger.last(("ADVANCED", "PUBLISHED_NOT_ADVANCED")) or {}).get("finished_at"),
              "host": socket.gethostname()}
        self._write_status(hb)

    # ── stage bodies ──────────────────────────────────────────────────────────────────────────────────────────────────
    def _acceptance(self):
        r = self.cfg.review
        from .acceptance import build
        return build(os.path.join(self.data, "acceptance.db"), r["v5_acceptance_export"], r["edgar_acceptance_dir"])

    def _lineage(self, sub):
        fileno = os.path.join(self.rdir, "fileno.db")
        a = self.cmd(mod("lineage", "index", "--submissions", sub, "--out", fileno), "lineage.log")
        b = self.cmd(mod("lineage", "harvest", "--inputs", os.path.join(self.data, "inputs.db"), "--fileno", fileno,
                         "--out", os.path.join(self.data, "lineage.db")), "lineage.log")
        return {"index": a, "harvest": b, "counts": Q.evidence_counts(os.path.join(self.data, "lineage.db"))}

    def _predecessors(self, cf, sub):
        pu = Q.predecessor_universe(os.path.join(self.data, "lineage.db"), os.path.join(self.data, "inputs.db"))
        upath = os.path.join(self.rdir, "pred_universe.json.gz")
        open(upath, "wb").write(__import__("gzip").compress(json.dumps(pu).encode()))
        cpath = os.path.join(self.rdir, "pred_ciks.json")
        json.dump(sorted(int(k) for k in pu), open(cpath, "w"))
        pin = os.path.join(self.data, "pred_inputs.db")
        if os.path.exists(pin):
            os.remove(pin)
        out = {"predecessors": sorted(int(k) for k in pu)}
        out["inputs"] = self.cmd(mod("inputs", "--companyfacts", cf, "--submissions", sub, "--universe", upath, "--out", pin), "pred.log")
        out["covers"] = self.cmd(mod("harvest_covers", "--inputs", pin, "--out", os.path.join(self.data, "pred_covers.db"),
                                     "--ciks-file", cpath, "--workers", 4), "pred.log")
        out["text"] = self.cmd(mod("harvest_text", "--mode", "text", "--inputs", pin, "--out",
                                   os.path.join(self.data, "pred_text.db"), "--workers", 4), "pred.log")
        out["econ"] = self.cmd(mod("harvest_text", "--mode", "econ", "--inputs", pin, "--out",
                                   os.path.join(self.data, "pred_econ.db"), "--arg", cpath, "--workers", 4), "pred.log")
        return out

    def _harvests(self):
        d, w, inp = self.data, self.cfg.workers, os.path.join(self.data, "inputs.db")
        out = {}
        out["covers"] = self.cmd(mod("harvest_covers", "--inputs", inp, "--out", os.path.join(d, "covers.db"), "--workers", w), "harvest.log")
        out["covers_multiclass"] = self.cmd(mod("harvest_covers", "--inputs", inp, "--out", os.path.join(d, "covers.db"),
                                                "--workers", w, "--ciks-file", os.path.join(d, "multiclass_ciks.json")), "harvest.log")
        for mode, db, arg in (("text", "text.db", None), ("ipo", "ipo.db", "ipo_list.json"), ("adr", "adr.db", "adr_ciks.json")):
            a = ["--arg", os.path.join(d, arg)] if arg else []
            out[mode] = self.cmd(mod("harvest_text", "--mode", mode, "--inputs", inp, "--out", os.path.join(d, db), "--workers", w, *a),
                                 "harvest.log")
        out["prosp"] = Q.harvest_prosp_windowed(inp, os.path.join(d, "prosp.db"), workers=w)
        # M3: offering status evidence (already-public market statements, pricing, priced composition), from the cache
        out["offering"] = self.cmd(mod("offering_status", "--inputs", inp, "--ipo", os.path.join(d, "ipo.db"),
                                       "--out", os.path.join(d, "offering.db"), "--workers", w,
                                       "--submissions", os.path.join(self.rdir, "sec", "submissions.zip")), "harvest.log")
        miss = {"covers": Q.missing_after("covers", d, json.load(open(os.path.join(d, "multiclass_ciks.json")))),
                "text": Q.missing_after("text", d),
                "ipo": Q.missing_after("ipo", d, json.load(open(os.path.join(d, "ipo_list.json")))),
                "adr": Q.missing_after("adr", d, json.load(open(os.path.join(d, "adr_ciks.json")))),
                "prosp": Q.missing_after("prosp", d)}
        out["missing"] = miss
        if any(miss.values()):
            raise RuntimeError(f"evidence incomplete after harvest (fetch failures): {miss}")
        return out

    def _build(self, log):
        bdir = os.path.join(self.data, "builds")
        os.makedirs(bdir, exist_ok=True)
        before = set(os.listdir(bdir))
        res = self.cmd(mod("build", "--data", self.data, "--out", bdir), log)
        new = sorted(set(os.listdir(bdir)) - before)
        dbs = [n for n in new if n.startswith("MCAP_V1-") and n.endswith(".db")]
        if len(dbs) != 1:
            raise RuntimeError(f"build produced {dbs}")
        p = os.path.join(bdir, dbs[0])
        return {**res, "build_path": p, "build_id": dbs[0][:-3]}

    def _dependent(self, build_path):
        d, w = self.data, self.cfg.workers
        inp = os.path.join(d, "inputs.db")
        before = {n: Q.evidence_counts(os.path.join(d, n)) for n in ("econ.db", "splitev.db")}
        el = Q.econ_list(build_path)
        json.dump(el, open(os.path.join(d, "econ_list.json"), "w"))
        out = {"econ_requests": len(el)}
        out["econ"] = self.cmd(mod("harvest_text", "--mode", "econ", "--inputs", inp, "--out", os.path.join(d, "econ.db"),
                                   "--arg", os.path.join(d, "econ_list.json"), "--workers", 8), "dependent.log")
        cands = Q.split_candidates(build_path)
        cpath = os.path.join(self.rdir, "split_candidates.json")
        json.dump(cands, open(cpath, "w"))
        ciks = sorted({c["cik"] for c in cands} | Q.evidence_ciks(os.path.join(d, "splitev.db")))
        xpath = os.path.join(self.rdir, "split_xbrl_ciks.json")
        json.dump([{"cik": c} for c in ciks], open(xpath, "w"))
        cf = os.path.join(self.rdir, "sec", "companyfacts.zip")
        out["splitev_xbrl"] = self.cmd(mod("splitev", "xbrl", "--companyfacts", cf, "--candidates", xpath,
                                           "--out", os.path.join(d, "splitev.db")), "dependent.log")
        out["splitev_text"] = self.cmd(mod("splitev", "text", "--inputs", inp, "--candidates", cpath,
                                           "--out", os.path.join(d, "splitev.db"), "--workers", 8), "dependent.log")
        out["candidates"] = len(cands)
        after = {n: Q.evidence_counts(os.path.join(d, n)) for n in ("econ.db", "splitev.db")}
        out["changed"] = before != after
        out["evidence_before"], out["evidence_after"] = before, after
        miss = Q.missing_after("econ", d, el)
        if miss:
            raise RuntimeError(f"econ evidence incomplete: {miss}")
        return out

    def _seal(self, bpath):
        os.chmod(bpath, stat.S_IREAD | stat.S_IRGRP | stat.S_IROTH)
        s, n = P.file_sha(bpath)
        return {"build_path": bpath, "db_sha256": s, "db_bytes": n, "inputs": {
            nm: {"sha256": P.file_sha(os.path.join(self.data, nm))[0], "bytes": os.path.getsize(os.path.join(self.data, nm))}
            for nm in Q.BUILD_INPUTS if os.path.exists(os.path.join(self.data, nm))}}

    def _suite(self, bpath):
        from .validation import run_suite
        return run_suite(bpath, self.data, os.path.join(self.rdir, "reports"), self.cfg.review, self.cmd)

    def _gates(self, bpath):
        from .gates import evaluate
        v = evaluate(bpath, os.path.join(self.rdir, "reports"), self.cfg.review.get("adjudication_dir"))
        sealed = self.ledger.stage_done(self.run_id, "seal")
        after = P.file_sha(bpath)[0]
        v["gates"]["SEALED"] = {"pass": after == sealed["db_sha256"], "value": {"sealed": sealed["db_sha256"], "after_suite": after},
                                "definition": "the build DB is byte-identical before and after the report suite"}
        v["status"] = "PASS" if all(x["pass"] for x in v["gates"].values()) else "FAIL"
        v["failed"] = [k for k, x in v["gates"].items() if not x["pass"]]
        json.dump(v, open(os.path.join(self.rdir, "validation.json"), "w"), indent=1, default=str)
        return {"status": v["status"], "failed": v["failed"], "path": os.path.join(self.rdir, "validation.json")}

    def manifest_fields(self, bpath, build, src, sec) -> dict:
        sealed = self.ledger.stage_done(self.run_id, "seal")
        kn = Q.knowledge(self.data)
        import sqlite3 as _s
        B = _s.connect(f"file:{bpath}?mode=ro", uri=True)
        man = dict(B.execute("SELECT key, value FROM manifest"))
        last = B.execute("SELECT MAX(d) FROM cap_daily").fetchone()[0]
        B.close()
        files = sealed["inputs"]
        snap = P.A.sha("\n".join(f"{k}={v['sha256']}" for k, v in sorted(files.items())).encode())
        stages = {r[0]: (r[1], r[2]) for r in self.ledger.db.execute(
            "SELECT stage, started_at, finished_at FROM stage WHERE run_id=?", (self.run_id,))}
        git = lambda *a: subprocess.run(["git", *a], cwd=self.repo, capture_output=True, text=True).stdout.strip()
        return {"format": C.MANIFEST_FORMAT, "dataset": "MCAP_V1", "build_id": build["build_id"], "methodology": M.identity(),
                "code": {"commit": man.get("code_commit"), "tree": git("rev-parse", "HEAD^{tree}") or None,
                         "dirty": bool(git("status", "--porcelain", "--", "api/services/marketcap"))},
                "inputs": {"snapshot_id": snap, "files": files,
                           "provenance": {"sources": src, "sec_bulk": {k: {x: v.get(x) for x in ("last_modified", "sha256", "bytes")}
                                                                      for k, v in sec.items()},
                                          "prosp_evidence_from": Q.PROSP_EVIDENCE_FROM, "run_id": self.run_id}},
                "build": {"started_at": stages.get(build["stage"], (None,))[0] or man.get("built_at"),
                          "finished_at": man.get("built_at"), "db_sha256": sealed["db_sha256"], "db_bytes": sealed["db_bytes"]},
                "knowledge": {"latest_valued_session": f"{last // 10000:04d}-{last // 100 % 100:02d}-{last % 100:02d}",
                              "filing_knowledge_cutoff": kn["filing_knowledge_cutoff"],
                              "latest_price_session": kn["latest_price_session"],
                              "latest_harvest_at": stages.get("harvests", (None, None))[1],
                              "sec_bulk_last_modified": {k: v.get("last_modified") for k, v in sec.items()}}}

    def _publish(self, bpath, build, src, sec):
        val = json.load(open(os.path.join(self.rdir, "validation.json")))
        fields = self.manifest_fields(bpath, build, src, sec)
        prices = os.path.join(self.data, "prices.db")
        return P.publish_build(self.cfg.target(), build_db=bpath, prices_db=prices, manifest_fields=fields, validation=val,
                               workers=self.cfg.workers)

    def _advance(self, build_id, manifest_sha):
        """AUTOMATED advance policy -- every condition must hold, else the build stays published but NOT authority:
          * policy.auto_advance is true (default false);
          * an authority already exists and its root was a HUMAN_CUTOVER (the first authority is always a human act);
          * the authority's methodology digest == this build's (no methodology change without review);
          * the new build is not behind the authority on either clock."""
        t = self.cfg.target()
        cur = P.read_pointer(t)
        why = []
        if not self.cfg.policy.get("auto_advance"):
            why.append("auto_advance is off")
        if cur is None:
            why.append("no authority yet: the first authority is a human cutover")
        else:
            cm = P.read_manifest(t, cur["build_id"], cur["manifest_sha256"])
            nm = P.read_manifest(t, build_id, manifest_sha)
            if cm["methodology"].get("files_digest") != nm["methodology"].get("files_digest"):
                why.append("methodology differs from the authority's")
            if nm["knowledge"]["latest_valued_session"] < cm["knowledge"]["latest_valued_session"] or \
                    nm["knowledge"]["filing_knowledge_cutoff"] < cm["knowledge"]["filing_knowledge_cutoff"]:
                why.append("new build is behind the authority")
            if not self._human_rooted(t, cur):
                why.append("authority lineage has no human cutover")
        if why:
            return {"advanced": False, "why": why}
        p = P.advance(t, build_id, manifest_sha, expect_current=cur["build_id"], by=f"refresh:{self.run_id}",
                      reason="scheduled refresh: all automated gates passed", acceptance="AUTOMATED_REFRESH")
        return {"advanced": True, "pointer": p}

    @staticmethod
    def _human_rooted(t, cur) -> bool:
        return bool(cur.get("human_rooted"))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=("run", "status", "hold", "release"))
    ap.add_argument("--root", required=True)
    ap.add_argument("--run-id")
    ap.add_argument("--reason", default="")
    a = ap.parse_args(argv)
    os.makedirs(a.root, exist_ok=True)
    if a.cmd == "hold":
        open(os.path.join(a.root, "HOLD"), "w").write(f"{now_iso()} {a.reason}")
        print("HOLD set")
        return 0
    if a.cmd == "release":
        if os.path.exists(os.path.join(a.root, "HOLD")):
            os.remove(os.path.join(a.root, "HOLD"))
        print("HOLD released")
        return 0
    if a.cmd == "status":
        L = Ledger(a.root)
        rows = L.db.execute("SELECT run_id, state, stage, started_at, finished_at, build_id, error FROM run "
                            "ORDER BY started_at DESC LIMIT 10").fetchall()
        print(json.dumps({"hold": os.path.exists(os.path.join(a.root, "HOLD")), "runs": rows}, indent=1))
        return 0
    res = Refresh(a.root, a.run_id).execute()
    print(json.dumps(res, indent=1, default=str)[:20000])
    return 0 if res["state"] in ("ADVANCED", "PUBLISHED_NOT_ADVANCED", "WAITING_UPSTREAM", "HOLD") else 2


if __name__ == "__main__":
    raise SystemExit(main())
