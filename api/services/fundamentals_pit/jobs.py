"""Scheduled fundamentals jobs, run on the WORKER (the process that holds the store).

    tick              every 10 min, 06:00-22:59 ET weekdays: EDGAR "latest filings"
                      -> pending_refresh -> ingest / signals / derive / publish
    daily_beta        18:40 ET weekdays: Beta for every company whose closes moved
    weekly_reconcile  Sun 06:10 ET: fresh bulk archives (+ the latest FS quarters)
                      through the SAME idempotent backfill, then publish what changed

Registered only when FUNDAMENTALS_PIT_INCREMENTAL_ENABLED=1 AND the store exists
(api/main.py register_fundamentals_pit_jobs) -- so a web pod, or a worker without
the store, registers nothing. Publishing to R2 still needs
FUNDAMENTALS_PIT_PUBLISH_R2=1 (publish.r2_enabled); without it the jobs update the
store and publish nowhere.

Every run writes /data/fundamentals_pit_work/jobs_status.json (last run, counts,
errors) and one "[fundamentals_pit]" log line, so a job that stopped is visible.

    python -m api.services.fundamentals_pit.jobs publish-all [--r2]   # one-off
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
import traceback
from datetime import date

from . import incremental as INC, publish as P, store as S

WORK = os.environ.get("FUNDAMENTALS_PIT_WORK_DIR", "/data/fundamentals_pit_work")
STATUS = os.path.join(WORK, "jobs_status.json")
log = logging.getLogger("fundamentals_pit.jobs")


def _status(job: str, **fields) -> None:
    os.makedirs(WORK, exist_ok=True)
    try:
        cur = json.load(open(STATUS))
    except Exception:
        cur = {}
    cur[job] = {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **fields}
    tmp = STATUS + ".tmp"
    with open(tmp, "w") as f:
        json.dump(cur, f, indent=1, default=str)
    os.replace(tmp, STATUS)
    print(f"[fundamentals_pit] {job}: " + json.dumps(fields, default=str)[:600], flush=True)


def _conn():
    return S.connect(S.default_path())


def _universe(conn) -> set[int]:
    return {r[0] for r in conn.execute("SELECT cik FROM security")}


def publish_all(conn, ciks=None) -> dict:
    """Publish every company's artifact + Beta (each skipped when its etag is
    unchanged) and the ticker index."""
    out = {"published": 0, "unchanged": 0, "not_built": 0, "beta_published": 0}
    for cik in (ciks if ciks is not None else sorted(_universe(conn))):
        r = P.publish_company(conn, cik)
        if r.get("reason") == "not built":
            out["not_built"] += 1
        elif r.get("published"):
            out["published"] += 1
        else:
            out["unchanged"] += 1
        if (r.get("beta") or {}).get("published"):
            out["beta_published"] += 1
    out["index"] = P.publish_index(conn)
    return out


def tick() -> dict:
    """Detect -> enqueue -> drain -> (publish per company inside refresh) -> index."""
    t0 = time.time()
    try:
        conn = _conn()
        try:
            events = INC.poll()
            queued = INC.enqueue(conn, events, _universe(conn))
            rep = INC.drain(conn)
            if rep["done"]:
                P.publish_index(conn)
            pending = conn.execute("SELECT count(*), sum(attempts >= ?) FROM pending_refresh",
                                   (INC.MAX_ATTEMPTS,)).fetchone()
        finally:
            conn.close()
        res = {"events": len(events), "queued": queued, "done": len(rep["done"]), "retry": len(rep["retry"]),
               "failed_now": len(rep["failed"]), "pending": pending[0], "exhausted": pending[1] or 0,
               "elapsed_s": round(time.time() - t0, 1)}
        _status("tick", ok=True, **res)
        return res
    except Exception:
        _status("tick", ok=False, error=traceback.format_exc()[-1500:])
        raise


def daily_beta() -> dict:
    t0 = time.time()
    try:
        conn = _conn()
        try:
            res = INC.refresh_beta_all(conn)
            P.publish_index(conn)
        finally:
            conn.close()
        res["elapsed_s"] = round(time.time() - t0, 1)
        _status("daily_beta", ok=True, **res)
        return res
    except Exception:
        _status("daily_beta", ok=False, error=traceback.format_exc()[-1500:])
        raise


def weekly_reconcile() -> dict:
    """Fresh bulk archives + the current and previous FS quarter through the
    idempotent backfill (unchanged companies skip by content hash), then publish."""
    from . import backfill as BF, bulk_inputs as BI
    t0 = time.time()
    try:
        for name in ("companyfacts.zip", "submissions.zip"):          # re-fetch: these change daily
            p = os.path.join(WORK, name)
            if os.path.exists(p):
                os.replace(p, p + ".prev")
        today = date.today()
        q_now = f"{today.year}q{(today.month - 1) // 3 + 1}"
        y, n = today.year, (today.month - 1) // 3 + 1
        q_prev = f"{y - 1}q4" if n == 1 else f"{y}q{n - 1}"
        man = BI.fetch(WORK, q_prev, q_now)
        argv = ["--db", S.default_path(), "--bulk-companyfacts", man["companyfacts"],
                "--bulk-submissions", man["submissions"], "--listed", "--workers", "4", "--beta",
                "--splits-massive", f"{today.year - 1}-01-01", today.isoformat()]
        for z in man["fs"]:
            argv += ["--fs-zip", z]
        rep = BF.run(argv)
        conn = _conn()
        try:
            pub = publish_all(conn)
        finally:
            conn.close()
        for name in ("companyfacts.zip", "submissions.zip"):
            p = os.path.join(WORK, name + ".prev")
            if os.path.exists(p):
                os.remove(p)
        res = {"scope": rep.get("scope"), "ingested": rep.get("ingested"), "skipped": rep.get("skipped"),
               "failed": len(rep.get("failed") or []), "derive_failed": len(rep.get("derive_failed") or []),
               "published": pub["published"], "beta_published": pub["beta_published"],
               "elapsed_s": round(time.time() - t0, 1)}
        _status("weekly_reconcile", ok=True, **res)
        return res
    except Exception:
        _status("weekly_reconcile", ok=False, error=traceback.format_exc()[-1500:])
        raise


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="fundamentals jobs (worker)")
    ap.add_argument("job", choices=["tick", "daily-beta", "weekly-reconcile", "publish-all"])
    ap.add_argument("--r2", action="store_true",
                    help="publish to R2 in THIS process only (sets FUNDAMENTALS_PIT_PUBLISH_R2 locally)")
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    from .backfill import quiet_http_loggers
    quiet_http_loggers()
    if a.r2:
        os.environ["FUNDAMENTALS_PIT_PUBLISH_R2"] = "1"
    if a.job == "publish-all":
        t0 = time.time()
        conn = _conn()
        try:
            res = publish_all(conn)
        finally:
            conn.close()
        res["elapsed_s"] = round(time.time() - t0, 1)
        _status("publish_all", ok=True, r2=P.r2_enabled(), **res)
    else:
        {"tick": tick, "daily-beta": daily_beta, "weekly-reconcile": weekly_reconcile}[a.job]()
    return 0


if __name__ == "__main__":
    sys.exit(main())
