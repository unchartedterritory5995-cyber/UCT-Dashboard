"""V5 operations CLI (run on the WORKER unless noted).

    python -m api.services.fundamentals_pit.v5_ops verify-frozen
    python -m api.services.fundamentals_pit.v5_ops install-base            # R2 archive -> base/ (verified)
    python -m api.services.fundamentals_pit.v5_ops init-live               # base -> live/live.db (byte copy)
    python -m api.services.fundamentals_pit.v5_ops publish-base            # the frozen artifacts as version v5-base-...
    python -m api.services.fundamentals_pit.v5_ops batch --kind cycle|daily|sweep|replay [--accn A --cik C ...]
    python -m api.services.fundamentals_pit.v5_ops status
    python -m api.services.fundamentals_pit.v5_ops serve v4|v5 [--pin VERSION] --reason TEXT   # MEMBER SWITCH
    python -m api.services.fundamentals_pit.v5_ops pointer VERSION --expect CURRENT --reason TEXT   # V5 rollback
    python -m api.services.fundamentals_pit.v5_ops shadow --symbols AAPL,TSLA --series ...     # (WEB) v4 vs v5
    python -m api.services.fundamentals_pit.v5_ops rollback-drill --dir /tmp/x                 # local, dark
    python -m api.services.fundamentals_pit.v5_ops quarantine --cik C [--cik C2] --version V --reason TEXT
    python -m api.services.fundamentals_pit.v5_ops acceptance-correct AUDIT.json --reason TEXT [--no-publish] [--exclude-cik C]

Every write goes through v5_publish (immutable objects/manifests, pointer last). `serve` is the ONLY command that
changes what members see.
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time

from . import publish as P, v5_live as L, v5_prod as VP, v5_publish as PUB


def _target(a):
    return PUB.LocalTarget(a.local) if getattr(a, "local", None) else PUB.R2Target()


def publish_base(target, p: dict | None = None) -> dict:
    """Version 1: the frozen artifacts, byte for byte. Refuses if any V5 pointer exists."""
    p = p or VP.paths()
    L.verify_base(p)
    if PUB.read_current(target) is not None:
        raise PUB.PublishError("a V5 pointer already exists; the base is published once")
    bodies_by_cik = L.base_artifact_bodies(p)
    bodies = {PUB.sha(b): b for b in bodies_by_cik.values()}
    base = sqlite3.connect(f"file:{p['base_db']}?mode=ro", uri=True)
    try:
        tickers = P.ticker_index(base)
        latest = base.execute("SELECT accn, public_at FROM filing WHERE public_at=(SELECT max(public_at) FROM filing)").fetchone()
    finally:
        base.close()
    manifest = PUB.build_manifest(version_id=VP.BASE_VERSION_ID, parent=None,
                                  companies={c: PUB.sha(b) for c, b in bodies_by_cik.items()}, tickers=tickers, fields={
        "kind": "base", "batch_id": None,
        "horizon": {"basis": "frozen artifact (SEC bulk companyfacts/submissions of 2026-09-23 + instance evidence)",
                    "latest_filing": {"accn": latest[0], "public_at": latest[1]}},
        "code": {"methodology_commit": VP.METHODOLOGY_COMMIT, "base_sha256": VP.FROZEN_SHA256, "base_run_id": VP.RUN_ID,
                 "freeze_json_sha256": VP.FREEZE_JSON_SHA256, "artifact_manifest_sha256": VP.FROZEN_ARTIFACT_MANIFEST_SHA256},
        "validation": {"ok": True, "basis": "post-grind validation + freeze (fundamentals/v5-validation @ 1d26b5d76)"}})
    res = PUB.publish_version(target, manifest, bodies, expect_parent=None)
    os.makedirs(p["versions"], exist_ok=True)
    open(os.path.join(p["versions"], VP.BASE_VERSION_ID + ".json"), "wb").write(PUB.encode(manifest))
    if os.path.exists(p["live_db"]):
        conn = L.connect_live(p)
        try:
            with conn:
                conn.execute("INSERT OR REPLACE INTO v5_version VALUES (?,?,?,?,?,?,?)",
                             (VP.BASE_VERSION_ID, None, res["manifest_sha256"], res["published_at"], None, p["base_db"],
                              json.dumps(res)))
        finally:
            conn.close()
    L.verify_base(p)
    return res


def quarantine_companies(target, ciks: list[int], to_version: str, reason: str, p: dict | None = None) -> dict:
    """Publish a new version = CURRENT with `ciks` restored to their object in `to_version` (their last valid
    version); record the quarantine. Used when a published change is found unsound after the fact. Never deletes."""
    import datetime as dt
    p = p or VP.paths()
    L.verify_base(p)
    lease = L.Lease(p)
    if not lease.acquire():
        raise PUB.PublishError("pipeline lease is held; retry")
    try:
        cur = PUB.read_current(target)
        parent = PUB.read_manifest(target, cur["version"], verify_sha=cur["manifest_sha256"])
        src = PUB.read_manifest(target, to_version)
        if src is None:
            raise PUB.PublishError(f"version {to_version} does not exist")
        companies = {int(c): s for c, s in parent["companies"].items()}
        restored = {}
        for c in ciks:
            if str(c) not in src["companies"]:
                raise PUB.PublishError(f"cik {c} not in {to_version}")
            restored[c] = [companies.get(c), src["companies"][str(c)]]
            companies[c] = src["companies"][str(c)]
        vid = "v5-" + dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-q"
        manifest = PUB.build_manifest(version_id=vid, parent=cur["version"], companies=companies, tickers=parent["tickers"], fields={
            "kind": "quarantine", "batch_id": None, "horizon": parent.get("horizon"), "code": parent.get("code"),
            "changed": sorted(ciks), "quarantined": sorted(ciks), "restored_from": to_version, "reason": reason,
            "validation": {"ok": True, "basis": "restores each company's object from an earlier validated version"}})
        res = PUB.publish_version(target, manifest, {}, expect_parent=cur["version"], parent_manifest=parent)
        conn = L.connect_live(p)
        try:
            with conn:
                for c in ciks:
                    conn.execute("INSERT OR REPLACE INTO v5_quarantine VALUES (?,?,?,?)", (c, int(res["published_at"]), vid, reason))
                conn.execute("INSERT INTO v5_version VALUES (?,?,?,?,?,?,?)",
                             (vid, cur["version"], res["manifest_sha256"], res["published_at"], None, None, json.dumps(res)))
        finally:
            conn.close()
        os.makedirs(p["versions"], exist_ok=True)
        open(os.path.join(p["versions"], vid + ".json"), "wb").write(PUB.encode(manifest))
        L.verify_base(p)
        return {**res, "restored": {str(k): v for k, v in restored.items()}}
    finally:
        lease.release()


def shadow(symbols: list[str], series: list[str], version_id: str | None = None) -> list[dict]:
    """The REAL serving path, twice: V4 source and V5 source (the web container's R2 reads). Read-only."""
    from . import serving as SV
    v4, v5 = SV.v4_source(), SV.v5_source(version_id)
    out = []
    for sym in symbols:
        s4, b4, _ = SV.series_response(sym, series, source=v4)
        s5, b5, _ = SV.series_response(sym, series, source=v5)
        diff = {}
        for m in series:
            p4, p5 = (b4.get("metrics") or {}).get(m), (b5.get("metrics") or {}).get(m)
            if p4 != p5:
                k4 = {r[0]: r for r in p4 or []}
                k5 = {r[0]: r for r in p5 or []}
                diff[m] = {"n4": len(k4), "n5": len(k5), "keys": sorted(t for t in set(k4) | set(k5) if k4.get(t) != k5.get(t))}
        out.append({"symbol": sym, "status": [s4, s5], "cik": [b4.get("cik"), b5.get("cik")], "version": b5.get("version"),
                    "derivation_version": [b4.get("derivation_version"), b5.get("derivation_version")], "diff": diff})
    return out


def rollback_drill(root: str) -> dict:
    """DARK drill on a local bucket: base -> v2 -> serve v5 -> serve v4 -> pin v2's parent -> serve v5. Checks every
    step through the real serving seam. Never touches R2."""
    from . import serving as SV
    t = PUB.LocalTarget(root)
    a = {"v": 1, "cik": 1, "tickers": ["AAA"], "name": "A", "derivation_version": 5, "input_hash": "h1", "built_at": 1,
         "split_status": "verified", "withheld_split_sensitive": False, "metrics": {"revenue_ttm": [[100, 1.0, 20200331, "direct"]]}}
    b = dict(a, input_hash="h2", metrics={"revenue_ttm": [[100, 1.0, 20200331, "direct"], [200, 2.0, 20200630, "direct"]]})
    v4 = dict(a, derivation_version=4, metrics={"revenue_ttm": [[100, 9.0, 20200331, "direct"]]})
    t.put(P.key_for(1, 4), P.encode(v4)[0]); t.put(P.index_key(4), P.encode({"v": 1, "derivation_version": 4, "tickers": {"AAA": 1}})[0])
    ab, bb = PUB.encode(a), PUB.encode(b)
    PUB.publish_version(t, PUB.build_manifest(version_id="v5-base", parent=None, companies={1: PUB.sha(ab)}, tickers={"AAA": 1}, fields={}),
                        {PUB.sha(ab): ab}, expect_parent=None)
    PUB.publish_version(t, PUB.build_manifest(version_id="v5-2", parent="v5-base", companies={1: PUB.sha(bb)}, tickers={"AAA": 1}, fields={}),
                        {PUB.sha(bb): bb}, expect_parent="v5-base")
    env = {"FUNDAMENTALS_PIT_SOURCE": os.environ.get("FUNDAMENTALS_PIT_SOURCE"),
           "FUNDAMENTALS_PIT_ARTIFACT_DIR": os.environ.get("FUNDAMENTALS_PIT_ARTIFACT_DIR"),
           "FUNDAMENTALS_PIT_SERVE": os.environ.get("FUNDAMENTALS_PIT_SERVE")}
    os.environ.update({"FUNDAMENTALS_PIT_SOURCE": "local", "FUNDAMENTALS_PIT_ARTIFACT_DIR": root})
    os.environ.pop("FUNDAMENTALS_PIT_SERVE", None)
    steps = []

    def look(label):
        SV.clear_cache()
        st, body, etag = SV.series_response("AAA", ["revenue_ttm"])
        steps.append({"step": label, "derivation_version": body.get("derivation_version"), "version": body.get("version"),
                      "points": body["metrics"]["revenue_ttm"], "etag": etag})
    try:
        look("no control -> v4 default")
        PUB.write_serving(t, "v5", by="drill", reason="drill"); look("serve v5 -> CURRENT v5-2")
        PUB.write_serving(t, "v4", by="drill", reason="drill"); look("serve v4 (rollback)")
        PUB.write_serving(t, "v5", pin="v5-base", by="drill", reason="drill"); look("serve v5 pinned to v5-base")
        PUB.set_pointer(t, "v5-base", expect_current="v5-2", reason="drill")
        PUB.write_serving(t, "v5", by="drill", reason="drill"); look("pointer rolled back to v5-base")
        os.environ["FUNDAMENTALS_PIT_SERVE"] = "v4"; look("env override v4")
    finally:
        for k, v in env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        SV.clear_cache()
    want = [4, 5, 4, 5, 5, 4]
    ok = [s["derivation_version"] for s in steps] == want and steps[1]["version"] == "v5-2" and \
        steps[3]["version"] == "v5-base" and steps[4]["version"] == "v5-base" and len(steps[1]["points"]) == 2 and \
        steps[2]["points"] == [[100, 9.0, 20200331, "direct"]]
    return {"ok": ok, "steps": steps, "objects_intact": all(t.exists(PUB.obj_key(PUB.sha(x))) for x in (ab, bb))}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="v5_ops")
    ap.add_argument("cmd")
    ap.add_argument("arg", nargs="?")
    ap.add_argument("--local", help="a local bucket directory instead of R2 (dark drills)")
    ap.add_argument("--kind", default="cycle")
    ap.add_argument("--accn", action="append", default=[])
    ap.add_argument("--cik", action="append", type=int, default=[])
    ap.add_argument("--form", action="append", default=[])
    ap.add_argument("--pin")
    ap.add_argument("--expect")
    ap.add_argument("--reason", default="")
    ap.add_argument("--symbols", default="")
    ap.add_argument("--series", default="")
    ap.add_argument("--version")
    ap.add_argument("--dir")
    ap.add_argument("--no-publish", action="store_true")
    ap.add_argument("--max-companies", type=int)
    ap.add_argument("--sweep-floor")
    ap.add_argument("--exclude-cik", action="append", type=int, default=[])
    a = ap.parse_args(argv)
    from .backfill import quiet_http_loggers
    quiet_http_loggers()
    out: object
    if a.cmd == "verify-frozen":
        out = L.verify_base()
    elif a.cmd == "install-base":
        out = L.install_base()
    elif a.cmd == "init-live":
        out = L.init_live()
    elif a.cmd == "publish-base":
        out = publish_base(_target(a))
    elif a.cmd == "batch":
        from . import v5_pipeline as PL
        import datetime as dt
        entries = [{"accn": x, "cik": c, "form": f} for x, c, f in zip(a.accn, a.cik, a.form or [None] * len(a.accn))]
        out = PL.run_batch(a.kind, target=_target(a), entries=entries, publish=not a.no_publish,
                           max_companies=a.max_companies,
                           sweep_floor=dt.datetime.fromisoformat(a.sweep_floor) if a.sweep_floor else None)
    elif a.cmd == "status":
        from . import v5_pipeline as PL
        conn = L.connect_live()
        try:
            out = PL.write_status(conn, _target(a), VP.paths())
        finally:
            conn.close()
    elif a.cmd == "serve":
        out = PUB.write_serving(_target(a), a.arg, pin=a.pin, by=os.environ.get("USER") or "ops", reason=a.reason)
    elif a.cmd == "pointer":
        out = PUB.set_pointer(_target(a), a.arg, expect_current=a.expect, reason=a.reason)
    elif a.cmd == "quarantine":
        out = quarantine_companies(_target(a), a.cik, a.version, a.reason)
    elif a.cmd == "shadow":
        out = shadow([s for s in a.symbols.split(",") if s], [s for s in a.series.split(",") if s], a.version)
    elif a.cmd == "acceptance-correct":
        from . import v5_acceptance as ACC
        if not a.reason:
            ap.error("--reason is required")
        out = ACC.run_correction(_target(a), ACC.load_evidence(a.arg), reason=a.reason, publish=not a.no_publish,
                                 exclude_ciks=set(a.exclude_cik))
    elif a.cmd == "rollback-drill":
        out = rollback_drill(a.dir)
    else:
        ap.error(f"unknown command {a.cmd}")
        return 2
    print(json.dumps(out, indent=1, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
