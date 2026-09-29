"""Entrypoint of the dedicated economic-data ingestion service.

    python -m api.econ_main                 run forever (health/status HTTP on $PORT)
    python -m api.econ_main --once          boot + one tick, then exit
    python -m api.econ_main --backfill USCPI,USNFP | cohort | enabled
                                            full-history backfill of those series, then exit
    python -m api.econ_main --status        print the status snapshot JSON, then exit

Railway: started by the ECON_SERVICE_ENABLED=1 branch of railway.json's start
command; isolated from web / worker / bars-api (owner ruling #3). Reads
ECON_DB_PATH, ECON_ARCHIVE(_DIR), ECON_ARTIFACT_DIR, ECON_PUBLISH_R2 and the
provider key envs (never logged; the status carries presence booleans only).
Exit codes: 0 ok, 2 registry refused, 1 anything else.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import signal
import sys
import time

log = logging.getLogger("api.econ_main")


def _select(spec: str) -> list[dict]:
    from api.services.econ import registry
    spec = (spec or "").strip()
    if spec.lower() == "cohort":
        return [e for e in registry.cohort() if e.get("status") == "enabled"]
    if spec.lower() == "enabled":
        return registry.enabled()
    out = []
    for s in spec.split(","):
        e = registry.get(s.strip())
        if e is None:
            raise SystemExit(f"unknown econ symbol {s.strip()!r}")
        out.append(e)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m api.econ_main")
    ap.add_argument("--once", action="store_true", help="boot + one tick, then exit")
    ap.add_argument("--backfill", metavar="SYMBOLS", help="comma list | cohort | enabled")
    ap.add_argument("--status", action="store_true", help="print the status snapshot and exit")
    ap.add_argument("--db", help="econ.db path (default ECON_DB_PATH)")
    ap.add_argument("--no-feeds", action="store_true", help="do not fetch the BEA/Census/fiscaldata calendars")
    args = ap.parse_args(argv)

    from api.services.econ import ingest, store as st
    from api.services.econ.service import EconService, RefuseToStart, build_status, configure_logging

    configure_logging()
    try:
        db = st.connect(args.db)
    except Exception as e:  # noqa: BLE001
        from api.services.econ import secrets
        log.error("econ: cannot open store: %s", secrets.safe_exc(e))
        return 1

    if args.status:
        from api.services.econ import registry
        print(json.dumps(build_status(db, int(time.time()), entries=registry.load_registry()), indent=2))
        return 0

    svc = EconService(db, feeds=not args.no_feeds)
    try:
        svc.boot()
    except RefuseToStart as e:
        log.error("econ: %s", e)
        return 2

    if args.backfill:
        entries = _select(args.backfill)
        refused = [(e["symbol"], ingest.backfill_refusal(e)) for e in entries if ingest.backfill_refusal(e)]
        for sym, why in refused:
            log.error("econ backfill: REFUSED %s: %s", sym, why)
        outs = ingest.backfill(db, entries, http=svc.http, now=int(time.time()))
        for o in outs:
            log.info("econ backfill %s: ok=%s written=%d elapsed_s=%s requests=%s derived=%s error=%s", o.adapter,
                     o.ok, o.written, o.elapsed_s, o.requests, o.derived, o.error)
        log.info("econ backfill http stats: %s", json.dumps(svc.http.stats().get("by_host", {}), sort_keys=True))
        return 0 if all(o.ok for o in outs) and not refused else 1

    if args.once:
        svc.tick()
        print(json.dumps(svc.status()["states"]))
        svc.shutdown()
        return 0

    def _term(signum, frame):  # noqa: ARG001
        log.info("econ: signal %s -> finishing the current job, then exiting", signum)
        svc.stop()

    signal.signal(signal.SIGTERM, _term)
    signal.signal(signal.SIGINT, _term)
    port = int(os.environ.get("PORT") or 8080)
    svc.serve_http(port)
    log.info("econ: status HTTP on :%d", port)
    svc.run_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
