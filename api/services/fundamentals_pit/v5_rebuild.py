"""V5 FULL RE-DERIVATION -- isolated, pinned, detached, resumable.

    python -m api.services.fundamentals_pit.v5_rebuild init    --dir D --source /data/fundamentals_pit.db --code-sha SHA
    python -m api.services.fundamentals_pit.v5_rebuild acquire --dir D
    python -m api.services.fundamentals_pit.v5_rebuild derive  --dir D
    python -m api.services.fundamentals_pit.v5_rebuild status  --dir D

ISOLATION. `init` snapshots the production store (read-only, sqlite backup API) into
D/v5.db and strips from THE COPY every piece of v4 evidence and derived output
(filing_signal, signal_check, series_point/series_build of other versions, publish and
pending queues). Facts, filings, splits and Beta are the shared raw truth and are kept.
The production store, R2, the index and the catalogue are never opened for writing.

RUN IDENTITY. D/run.json pins the code (git SHA + a sha256 over every module this
package imports), the methodology, the source-store digest and the filing CENSUS
(the exact list of fact-bearing filings, digested). `acquire` and `derive` REFUSE to run
if the code on disk no longer hashes to the pinned value: a resume continues THIS
rebuild or nothing. The source is frozen at init: nothing is ingested during the run.

CHECKPOINT. A filing's evidence record (signal_check row) IS the checkpoint:
incremental.instance_signal_pass skips every recorded filing. A transient SEC/network
failure is NOT recorded, so it is retried; nothing is ever recorded as "no restatement"
because a request failed. `acquire` re-runs passes until the failure set stops
shrinking, then lists every still-unresolved filing in D/acquisition.json.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
import time
from concurrent.futures import ProcessPoolExecutor

from . import derive as D, incremental as INC, sec_client as SEC, store as S

V5 = 5
METHODOLOGY = ("v5: restatement evidence from each filing's OWN XBRL instance; exact context periods "
               "(no reconstructed starts, no month-end rounding); value-aware (a previously-reported value "
               "that differs, or a non-zero adjustment; a multi-axis context counts only through a non-zero "
               "adjustment); scope = every filing contributing XBRL facts, any form; note placement is not a "
               "filter; knowledge time = SEC public/acceptance time; one evidence seam for full and incremental")
PKG = os.path.dirname(os.path.abspath(__file__))
DEPS = ("data_sync.py", "log_redaction.py")


def _rss_gb() -> float | None:
    try:
        import resource                                  # Linux (the worker); absent on Windows dev
        return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1e6, 2)
    except ImportError:
        return None


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def code_tree_sha256() -> str:
    """Every .py of this package + the two services it reaches, by path and content."""
    h = hashlib.sha256()
    files = sorted(f for f in os.listdir(PKG) if f.endswith(".py"))
    for f in files:
        h.update(f.encode()); h.update(open(os.path.join(PKG, f), "rb").read())
    svc = os.path.dirname(PKG)
    for f in DEPS:
        p = os.path.join(svc, f)
        h.update(f.encode()); h.update(open(p, "rb").read() if os.path.exists(p) else b"<absent>")
    return h.hexdigest()


def _write(path: str, doc: dict) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(doc, f, indent=1, default=str)
    os.replace(tmp, path)


def _load_run(d: str) -> dict:
    run = json.load(open(os.path.join(d, "run.json")))
    have = code_tree_sha256()
    if have != run["code_tree_sha256"]:
        sys.exit(f"REFUSED: code on disk ({have[:12]}) is not the pinned V5 code ({run['code_tree_sha256'][:12]}); "
                 "a resume must continue THIS rebuild -- start a new run or decide a migration explicitly")
    return run


def census(conn) -> dict:
    by_form, accns = {}, []
    for cik, accn in INC._unchecked(conn):        # before acquisition: every fact-bearing filing
        accns.append(accn)
    forms = dict(conn.execute("SELECT accn, form FROM filing").fetchall())
    for a in accns:
        by_form[forms.get(a, "?")] = by_form.get(forms.get(a, "?"), 0) + 1
    companies = conn.execute("SELECT count(DISTINCT cik) FROM fact").fetchone()[0]
    return {"filings": len(accns), "companies_with_facts": companies,
            "by_form": dict(sorted(by_form.items(), key=lambda kv: -kv[1])),
            "accn_list_sha256": hashlib.sha256("\n".join(sorted(accns)).encode()).hexdigest(),
            "definition": "every filing with >=1 fact in the store (SELECT DISTINCT filing_id FROM fact per cik)"}


def cmd_init(a) -> int:
    os.makedirs(a.dir, exist_ok=True)
    db = os.path.join(a.dir, "v5.db")
    if os.path.exists(os.path.join(a.dir, "run.json")):
        sys.exit("REFUSED: run.json exists -- this directory already holds a V5 run")
    t0 = time.time()
    src = sqlite3.connect(f"file:{a.source}?mode=ro", uri=True)
    dst = sqlite3.connect(db)
    src.backup(dst)
    dst.close(); src.close()
    conn = S.connect(db)
    with S.tx(conn):
        conn.execute("DELETE FROM filing_signal")
        conn.execute("DELETE FROM signal_check")
        conn.execute("DELETE FROM series_point WHERE derivation_version != ?", (V5,))
        conn.execute("DELETE FROM series_build WHERE derivation_version != ?", (V5,))
        conn.execute("DELETE FROM pending_refresh")
        conn.execute("DELETE FROM publish_log")
    conn.execute("VACUUM")
    cen = census(conn)
    conn.close()
    run = {"run_id": f"v5-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}", "created_at": _now(),
           "derivation_version": V5, "methodology": METHODOLOGY,
           "code_sha": a.code_sha, "code_tree_sha256": code_tree_sha256(),
           "source_store": a.source, "source_sha256": _sha256_file(a.source),
           "output_store": db, "checkpoint": "signal_check rows in output_store (one per acquired filing)",
           "census": cen, "sec_max_rps": os.environ.get("SEC_MAX_RPS", "5"),
           "goldens": "tests/fundamentals_pit/test_v5_evidence.py + test_scheduler_owner.py @ code_sha",
           "init_s": round(time.time() - t0, 1)}
    _write(os.path.join(a.dir, "run.json"), run)
    print(json.dumps({k: run[k] for k in ("run_id", "code_sha", "census")}, default=str))
    return 0


def cmd_acquire(a) -> int:
    run = _load_run(a.dir)
    conn = S.connect(run["output_store"])
    resumes_path = os.path.join(a.dir, "resumes.json")
    resumes = json.load(open(resumes_path)) if os.path.exists(resumes_path) else []
    resumes.append({"at": _now(), "pid": os.getpid(), "code_tree_sha256": run["code_tree_sha256"]})
    _write(resumes_path, resumes)
    t0, prog_path = time.time(), os.path.join(a.dir, "progress.json")
    total = run["census"]["filings"]

    def progress(out):
        done = conn.execute("SELECT count(*) FROM signal_check").fetchone()[0]
        el = time.time() - t0
        rate = out["checked"] / (el / 60) if el > 0 else 0
        _write(prog_path, {"run_id": run["run_id"], "at": _now(), "total": total, "complete": done,
                           "remaining": total - done, "this_process": out | {"failed": len(out["failed"])},
                           "per_min": round(rate, 1), "eta_h": round((total - done) / rate / 60, 1) if rate else None,
                           "sec": SEC.stats(), "resumes": len(resumes),
                           "rss_gb": _rss_gb()})

    passes, last_failed = [], None
    while True:
        out = INC.instance_signal_pass(conn, None, workers=a.workers, progress=progress)
        progress(out)
        passes.append({k: (len(v) if k == "failed" else v) for k, v in out.items()} | {"at": _now()})
        if not out["failed"] or (last_failed is not None and len(out["failed"]) >= last_failed):
            break
        last_failed = len(out["failed"])
        time.sleep(60)
    done = conn.execute("SELECT count(*) FROM signal_check").fetchone()[0]
    _write(os.path.join(a.dir, "acquisition.json"), {
        "run_id": run["run_id"], "finished_at": _now(), "total": total, "complete": done,
        "unresolved": [{"cik": c, "accn": acc, "error": e} for c, acc, e in out["failed"]],
        "passes": passes, "sec": SEC.stats(), "resumes": len(resumes),
        "no_instance_recorded": conn.execute("SELECT count(*) FROM signal_check WHERE n_signals=0").fetchone()[0],
        "signals": conn.execute("SELECT count(*) FROM filing_signal").fetchone()[0]})
    print(json.dumps({"complete": done, "total": total, "unresolved": len(out["failed"])}))
    return 0 if (not out["failed"] and done >= total) else 2       # anything unresolved = incomplete, loudly


def _derive_one(args):
    db, cik = args
    try:
        conn = S.connect(db)
        try:
            return D.build_company(conn, cik, version=V5, force=True)
        finally:
            conn.close()
    except Exception:
        import traceback
        return {"cik": cik, "error": traceback.format_exc()[-800:]}


def cmd_derive(a) -> int:
    run = _load_run(a.dir)
    db = run["output_store"]
    conn = S.connect(db)
    ciks = [r[0] for r in conn.execute("SELECT cik FROM security ORDER BY cik")]
    conn.close()
    t0, res = time.time(), {"derived": 0, "failed": []}
    with ProcessPoolExecutor(a.workers) as ex:
        for r in ex.map(_derive_one, [(db, c) for c in ciks], chunksize=8):
            if r.get("error"):
                res["failed"].append({"cik": r["cik"], "error": r["error"][-300:]})
            else:
                res["derived"] += 1
    conn = S.connect(db, readonly=True)
    res.update({"run_id": run["run_id"], "finished_at": _now(), "companies": len(ciks), "elapsed_s": round(time.time() - t0, 1),
                "points": conn.execute("SELECT count(*) FROM series_point WHERE derivation_version=?", (V5,)).fetchone()[0],
                "gaps": conn.execute("SELECT count(*) FROM series_point WHERE derivation_version=? AND method='gap'", (V5,)).fetchone()[0],
                "metrics": conn.execute("SELECT count(DISTINCT metric) FROM series_point WHERE derivation_version=?", (V5,)).fetchone()[0],
                "companies_with_points": conn.execute("SELECT count(DISTINCT cik) FROM series_point WHERE derivation_version=?", (V5,)).fetchone()[0]})
    conn.close()
    res["store_bytes"] = os.path.getsize(db)
    _write(os.path.join(a.dir, "derive.json"), res)
    print(json.dumps({k: (len(v) if k == "failed" else v) for k, v in res.items()}, default=str))
    return 0 if not res["failed"] else 2


def cmd_status(a) -> int:
    for f in ("run.json", "progress.json", "acquisition.json", "derive.json"):
        p = os.path.join(a.dir, f)
        if os.path.exists(p):
            print(f, json.dumps(json.load(open(p)), default=str)[:1500])
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="fundamentals_pit.v5_rebuild")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("init", "acquire", "derive", "status"):
        p = sub.add_parser(name)
        p.add_argument("--dir", required=True)
        if name == "init":
            p.add_argument("--source", required=True)
            p.add_argument("--code-sha", required=True)
        if name in ("acquire", "derive"):
            p.add_argument("--workers", type=int, default=8 if name == "acquire" else 6)
    a = ap.parse_args(argv)
    from .backfill import quiet_http_loggers
    quiet_http_loggers()
    return {"init": cmd_init, "acquire": cmd_acquire, "derive": cmd_derive, "status": cmd_status}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
