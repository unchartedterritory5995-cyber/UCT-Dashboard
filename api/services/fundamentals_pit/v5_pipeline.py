"""V5 PRODUCTION PIPELINE: one batch = DISCOVERING -> ACQUIRING -> DERIVING -> VALIDATING -> READY -> PUBLISHED.

Nothing is member-visible until publish_version moves the pointer, and the pointer moves only after validation passed.
Every step is keyed on accession / CIK and restart-safe; a killed batch leaves the pointer where it was.

    kinds
      cycle     feed -> queue -> process                                   (every 10 min in filing hours)
      daily     splits + EDGAR daily form index for complete days -> process; advances verified-through
      sweep     every universe company's submissions -> process             (catch-up / weekly repair)
      replay    an explicit accession list (controlled tests)

Evidence completeness: a company is NEVER re-derived while any of its fact-bearing filings lacks an evidence record.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import time
import traceback
from zoneinfo import ZoneInfo

from . import derive as D, incremental as INC, ingest as I, publish as P, sec_client as SEC, store as S
from . import v5_discovery as DISC, v5_live as L, v5_prod as VP, v5_publish as PUB, v5_validate as VAL
from .filings import parse_submission_pages
from .split_ledger import PRODUCTION_SOURCES

ET = ZoneInfo("America/New_York")
PERIODIC = frozenset({"10-K", "10-Q", "10-K/A", "10-Q/A", "10-KT", "10-QT", "10-KT/A", "10-QT/A"})
LAG_S = 3600                    # companyfacts may trail a filing; before this, "no facts yet" is not an answer
PERIODIC_FACTS_DEADLINE_S = 48 * 3600
MAX_ATTEMPTS = 20
MAX_WITHHOLDING_FLIPS = 3


class Batch:
    def __init__(self, conn, kind: str, p: dict, now: float):
        self.conn, self.kind, self.p, self.now = conn, kind, p, now
        self.id = f"{kind}-{dt.datetime.fromtimestamp(now, dt.timezone.utc):%Y%m%dT%H%M%SZ}"
        self.rec: dict = {"batch_id": self.id, "kind": kind, "started_at": int(now), "state": "DISCOVERING",
                          "pipeline_commit": os.environ.get("RAILWAY_GIT_COMMIT_SHA"),
                          "methodology_commit": VP.METHODOLOGY_COMMIT}
        with conn:
            conn.execute("INSERT OR REPLACE INTO v5_batch VALUES (?,?,?,?,?,?,?,?)",
                         (self.id, kind, int(now), None, "DISCOVERING", None, None, None))

    def state(self, st: str, **kw) -> None:
        self.rec["state"] = st
        self.rec.update(kw)
        self.save()

    def save(self) -> None:
        os.makedirs(self.p["batches"], exist_ok=True)
        body = json.dumps(self.rec, default=str, indent=1)
        with self.conn:
            self.conn.execute("UPDATE v5_batch SET state=?, finished_at=?, parent_version=?, version=?, record=? "
                              "WHERE batch_id=?", (self.rec["state"], self.rec.get("finished_at"),
                                                   self.rec.get("parent_version"), self.rec.get("version"), body, self.id))
        tmp = os.path.join(self.p["batches"], self.id + ".json.tmp")
        open(tmp, "w").write(body)
        os.replace(tmp, os.path.join(self.p["batches"], self.id + ".json"))


# ── company fingerprint (what is NEW for a company in this batch) ─────────────────────────────────────────────
def fingerprint(conn, cik: int) -> dict:
    sec = S.security(conn, cik)
    return {"filings": dict(conn.execute("SELECT accn, public_at FROM filing WHERE cik=?", (cik,)).fetchall()),
            "facts": dict(conn.execute("SELECT filing_id, count(*) FROM fact WHERE cik=? GROUP BY filing_id", (cik,)).fetchall()),
            "signals": set(conn.execute("SELECT s.accn, s.tag, s.period_start, s.period_end FROM filing_signal s "
                                        "JOIN filing f ON f.accn=s.accn WHERE f.cik=?", (cik,)).fetchall()),
            "splits": sorted(map(tuple, S.load_splits(conn, sec["tickers"] if sec else [], PRODUCTION_SOURCES)))}


def changes(conn, before: dict, after: dict) -> dict:
    """The earliest public_at of anything new (the PIT boundary) and whether the split ledger moved."""
    fid_pub = dict(conn.execute("SELECT filing_id, public_at FROM filing WHERE filing_id IN (%s)" %
                                ",".join(str(int(f)) for f in after["facts"]) or "NULL").fetchall()) if after["facts"] else {}
    new_times = [p for a, p in after["filings"].items() if a not in before["filings"]]
    new_times += [fid_pub[f] for f, n in after["facts"].items() if n > before["facts"].get(f, 0) and f in fid_pub]
    new_times += [after["filings"].get(s[0]) for s in after["signals"] - before["signals"] if after["filings"].get(s[0])]
    return {"boundary": min(new_times) if new_times else None, "split_changed": before["splits"] != after["splits"],
            "new_filings": len([a for a in after["filings"] if a not in before["filings"]]),
            "new_fact_rows": sum(max(0, n - before["facts"].get(f, 0)) for f, n in after["facts"].items()),
            "new_signals": len(after["signals"] - before["signals"])}


def evidence_complete(conn, cik: int) -> bool:
    return not INC._unchecked(conn, [cik])


# ── acquisition ───────────────────────────────────────────────────────────────────────────────────────────────
def acquire_company(conn, cik: int, *, now: float, fetch_company=None, fetch_instance=None) -> dict:
    if fetch_company is None:
        def fetch_company(c):
            main, pages = SEC.submission_pages(c)
            return SEC.companyfacts(c), main, pages
    cf, main, pages = fetch_company(cik)
    st = I.ingest_company(conn, cik, cf, main, pages, now=now)
    sig = INC.check_signals(conn, cik, fetch_instance=fetch_instance, now=now)
    subs = parse_submission_pages(pages)
    cited = {f["accn"] for units in (cf.get("facts") or {}).values() for c in units.values()
             for rows in (c.get("units") or {}).values() for f in rows if f.get("accn")}
    return {"ingest": st, "signals": sig, "submissions": subs, "cited": cited}


def classify(conn, entry: tuple, acq: dict, now: float) -> tuple[str, str | None]:
    """Terminal or retry state for one queued accession after its company was acquired."""
    accn, form = entry[0], entry[2]
    fil = conn.execute("SELECT filing_id FROM filing WHERE accn=?", (accn,)).fetchone()
    has_facts = bool(fil and conn.execute("SELECT 1 FROM fact WHERE filing_id=? LIMIT 1", (fil[0],)).fetchone())
    sub = acq["submissions"].get(accn)
    age = now - sub.public_at.timestamp() if sub else None
    if has_facts:
        return "ARRIVED", None
    if sub is None:
        return "RETRY", "not yet in submissions"
    if form in PERIODIC:
        if age is not None and age > PERIODIC_FACTS_DEADLINE_S:
            return "FAILED", "periodic filing still has no facts in companyfacts after 48h"
        return "RETRY", "periodic filing: facts not yet in companyfacts"
    if accn in acq["cited"]:
        return "RETRY", "cited by companyfacts but not stored"
    if age is not None and age > LAG_S:
        return "NO_FINANCIAL_FACTS", None
    return "RETRY", "inside the companyfacts lag window"


# ── splits ────────────────────────────────────────────────────────────────────────────────────────────────────
def sync_splits(conn, *, days: int = 21, now: float, rows_fn=None) -> dict:
    """New Massive split rows for the recent window -> the companies whose ledger they touch."""
    if rows_fn is None:
        from .split_ledger import massive_rows_chunked
        rows_fn = massive_rows_chunked
    today = dt.datetime.fromtimestamp(now, ET).date()
    rows = rows_fn((today - dt.timedelta(days=days)).isoformat(), (today + dt.timedelta(days=30)).isoformat())
    have = set(conn.execute("SELECT ticker, ex_date, ratio FROM split_event WHERE source='massive'").fetchall())
    new = [r for r in rows if (r[0].upper(), r[1], float(r[2])) not in have]
    n = I.ingest_splits(conn, new, "massive", now=now) if new else 0
    tick = {r[0].upper() for r in new}
    ciks: set[int] = set()
    for t in tick:
        ciks |= {c for (c,) in conn.execute("SELECT cik FROM ticker_map WHERE ticker=?", (t,))}
    return {"fetched": len(rows), "new_rows": n, "tickers": sorted(tick), "ciks": sorted(ciks)}


# ── discovery by kind ─────────────────────────────────────────────────────────────────────────────────────────
def discover(conn, kind: str, *, now: float, entries=None, get=None, days_fn=None, sweep_fn=None,
             sweep_floor: dt.datetime | None = None, max_days: int = 10) -> dict:
    uni = DISC.universe(conn)
    out: dict = {}
    if kind == "cycle":
        ents = DISC.feed(get=get)
        out["feed"] = DISC.enqueue(conn, ents, uni=uni, now=now)
        L.meta_set(conn, "sec_checked_at", int(now))
    elif kind == "daily":
        vt = L.meta_get(conn, "daily_index_verified_through")
        last = dt.date.fromisoformat(vt) if vt else dt.date(2026, 9, 21)
        yday = dt.datetime.fromtimestamp(now, ET).date() - dt.timedelta(days=1)
        pending = L.meta_get(conn, "daily_pending", {})
        read = []
        for day in DISC.business_days(last, yday)[:max_days]:
            if day.isoformat() in pending:
                continue
            idx = (days_fn or DISC.daily_index)(day, **({"get": get} if get else {}))
            if idx is None:
                later = [d for d in DISC.business_days(day, yday)]
                if later and any((days_fn or DISC.daily_index)(d, **({"get": get} if get else {})) is not None for d in later[:3]):
                    pending[day.isoformat()] = []                     # holiday: no index, later days exist
                    read.append([day.isoformat(), "holiday"])
                    continue
                break                                                 # not posted yet
            ents = [dict(e, source="daily") for e in idx]
            q = DISC.enqueue(conn, ents, uni=uni, now=now)
            pending[day.isoformat()] = sorted(e["accn"] for e in ents if e["cik"] in uni and e["form"] in VP.EVIDENCE_FORMS)
            read.append([day.isoformat(), q])
        L.meta_set(conn, "daily_pending", pending)
        L.meta_set(conn, "sec_checked_at", int(now))
        out["daily"] = read
    elif kind == "sweep":
        floor = sweep_floor or dt.datetime(2026, 9, 20, tzinfo=dt.timezone.utc)
        ents, failed = [], []
        for cik in sorted(uni):
            try:
                ents += (sweep_fn or DISC.sweep_company)(cik, floor)
            except Exception as e:
                failed.append([cik, str(e)[:200]])
        out["sweep"] = DISC.enqueue(conn, ents, uni=uni, now=now)
        out["sweep_failed"] = failed[:50]
        out["sweep_failed_n"] = len(failed)
        L.meta_set(conn, "sec_checked_at", int(now))
        L.meta_set(conn, "sweep_last", {"at": int(now), "floor": floor.isoformat(), "failed": len(failed)})
    elif kind == "replay":
        out["replay"] = DISC.enqueue(conn, [dict(e, source="replay") for e in entries or []], uni=uni, now=now)
    return out


def advance_verified_through(conn) -> str | None:
    """A day is VERIFIED when every universe filing on its index is in a terminal state (or already held)."""
    pending = L.meta_get(conn, "daily_pending", {})
    vt = L.meta_get(conn, "daily_index_verified_through")
    for day in sorted(pending):
        accns = pending[day]
        open_ = [a for a in accns if (conn.execute("SELECT state FROM v5_queue WHERE accn=?", (a,)).fetchone() or ("HELD",))[0]
                 not in ("ARRIVED", "NO_FINANCIAL_FACTS", "HELD")]
        if open_:
            break
        vt = day
        pending.pop(day)
    L.meta_set(conn, "daily_pending", pending)
    if vt:
        L.meta_set(conn, "daily_index_verified_through", vt)
    return vt


# ── the batch ─────────────────────────────────────────────────────────────────────────────────────────────────
def parent_state(target) -> tuple[str | None, dict | None]:
    cur = PUB.read_current(target)
    if cur is None:
        return None, None
    return cur["version"], PUB.read_manifest(target, cur["version"], verify_sha=cur["manifest_sha256"])


def run_batch(kind: str, *, target, p: dict | None = None, now: float | None = None, entries=None,
              fetch_company=None, fetch_instance=None, get=None, days_fn=None, sweep_fn=None, split_rows_fn=None,
              sync_split=None, max_companies: int | None = None, publish: bool = True, sweep_floor=None) -> dict:
    p = p or VP.paths()
    now = time.time() if now is None else now
    if L.held(p):
        return {"state": "HOLD"}
    lease = L.Lease(p)
    if not lease.acquire():
        return {"state": "BUSY"}
    conn = b = None
    try:
        L.verify_base(p)
        conn = L.connect_live(p)
        b = Batch(conn, kind, p, now)
        parent_vid, parent = parent_state(target)
        if parent is None:
            b.state("FAILED", error="no published V5 version to build on", finished_at=int(time.time()))
            return b.rec
        b.rec["parent_version"] = parent_vid
        # DISCOVERING
        try:
            b.rec["discovery"] = discover(conn, kind, now=now, entries=entries, get=get, days_fn=days_fn,
                                          sweep_fn=sweep_fn, sweep_floor=sweep_floor)
        except Exception:
            b.state("RETRYING", error="discovery: " + traceback.format_exc()[-800:], finished_at=int(time.time()))
            return b.rec
        split_ciks: set[int] = set()
        if (kind == "daily" if sync_split is None else sync_split):
            try:
                sp = sync_splits(conn, now=now, rows_fn=split_rows_fn)
                b.rec["splits"] = sp
                split_ciks = set(sp["ciks"])
            except Exception:
                b.rec["splits_error"] = traceback.format_exc()[-600:]
        # ACQUIRING
        b.state("ACQUIRING")
        queued = conn.execute("SELECT accn, cik, form, attempts FROM v5_queue WHERE state='QUEUED' AND attempts < ? "
                              "ORDER BY discovered_at", (MAX_ATTEMPTS,)).fetchall()
        by_cik: dict[int, list] = {}
        for e in queued:
            by_cik.setdefault(e[1], []).append(e)
        ciks = sorted(by_cik)[:max_companies] if max_companies else sorted(by_cik)
        pending = dict(conn.execute("SELECT cik, boundary FROM v5_pending").fetchall())
        pend_split = {c for (c,) in conn.execute("SELECT cik FROM v5_pending WHERE split_changed=1")}
        acq_rep = {"companies": 0, "failed": [], "outcomes": {}}
        touched: dict[int, dict] = {}
        for cik in sorted(set(ciks) | split_ciks):
            before = fingerprint(conn, cik)
            try:
                if cik in by_cik:
                    acq = acquire_company(conn, cik, now=now, fetch_company=fetch_company, fetch_instance=fetch_instance)
                    for e in by_cik[cik]:
                        st, err = classify(conn, e, acq, now)
                        new_state = "QUEUED" if st == "RETRY" else st
                        with conn:
                            conn.execute("UPDATE v5_queue SET state=?, attempts=attempts+1, last_error=?, batch_id=?, updated_at=? "
                                         "WHERE accn=?", (new_state, err, b.id, int(now), e[0]))
                        acq_rep["outcomes"][st] = acq_rep["outcomes"].get(st, 0) + 1
                acq_rep["companies"] += 1
            except Exception:
                err = traceback.format_exc()[-600:]
                acq_rep["failed"].append([cik, err[-200:]])
                with conn:
                    for e in by_cik.get(cik, []):
                        conn.execute("UPDATE v5_queue SET attempts=attempts+1, last_error=?, batch_id=?, updated_at=? WHERE accn=?",
                                     (err, b.id, int(now), e[0]))
            after = fingerprint(conn, cik)
            ch = changes(conn, before, after)
            if ch["boundary"] is not None or ch["split_changed"]:
                prev_b = pending.get(cik)
                bnd = min(x for x in (ch["boundary"], prev_b) if x is not None) if (ch["boundary"] or prev_b) else None
                sc = ch["split_changed"] or cik in pend_split
                with conn:
                    conn.execute("INSERT OR REPLACE INTO v5_pending VALUES (?,?,?,?)", (cik, bnd, int(sc), int(now)))
                touched[cik] = ch
        b.rec["acquisition"] = {**acq_rep, "failed": acq_rep["failed"][:30], "failed_n": len(acq_rep["failed"]),
                                "companies_with_new_inputs": len(touched)}
        # DERIVING (every pending company whose evidence is complete)
        b.state("DERIVING")
        todo = [c for (c,) in conn.execute("SELECT cik FROM v5_pending ORDER BY cik")]
        derived, deferred = [], []
        for cik in todo:
            if not evidence_complete(conn, cik):
                deferred.append(cik)
                continue
            D.build_company(conn, cik, version=VP.V5, now=now)
            derived.append(cik)
        b.rec["derive"] = {"derived": len(derived), "deferred_evidence_incomplete": deferred[:50],
                           "deferred_n": len(deferred)}
        # VALIDATING
        b.state("VALIDATING")
        companies = {int(c): s for c, s in parent["companies"].items()}
        bodies, changed, quarantined, unchanged, results = {}, [], [], [], {}
        pend = {c: (bd, bool(sc)) for c, bd, sc in conn.execute("SELECT cik, boundary, split_changed FROM v5_pending")}
        flips = []
        for cik in derived:
            doc = P.artifact(conn, cik, VP.V5)
            if doc is None:
                continue
            body, _ = P.encode(doc)
            s = PUB.sha(body)
            if companies.get(cik) == s:
                unchanged.append(cik)
                continue
            parent_obj = PUB.read_json(target, PUB.obj_key(companies[cik])) if cik in companies else None
            bd, sc = pend.get(cik, (None, False))
            r = VAL.validate_company(conn, cik, parent=parent_obj, new=doc, boundary=bd, split_changed=sc)
            results[cik] = r
            if r["guard"].get("withholding_flip"):
                flips.append(cik)
            if r["ok"]:
                bodies[s] = body
                companies[cik] = s
                changed.append(cik)
            else:
                quarantined.append(cik)
                with conn:
                    conn.execute("INSERT OR REPLACE INTO v5_quarantine VALUES (?,?,?,?)",
                                 (cik, int(now), b.id, json.dumps(r["errors"])))
        tickers = P.ticker_index(conn)
        batch_errors = []
        if len(flips) > MAX_WITHHOLDING_FLIPS:
            batch_errors.append(f"{len(flips)} split-sensitive withholding flips in one batch (> {MAX_WITHHOLDING_FLIPS})")
        if len(tickers) < 0.99 * len(parent.get("tickers") or {}):
            batch_errors.append(f"ticker index shrank {len(parent.get('tickers') or {})} -> {len(tickers)}")
        if len(companies) < len(parent["companies"]):
            batch_errors.append("companies disappeared")
        vt = advance_verified_through(conn)
        latest = conn.execute("SELECT accn, public_at FROM filing WHERE public_at = (SELECT max(public_at) FROM filing)").fetchone()
        horizon = {"sec_checked_at": L.meta_get(conn, "sec_checked_at"), "daily_index_verified_through": vt,
                   "latest_filing": {"accn": latest[0], "public_at": latest[1]} if latest else None,
                   "queue": dict(conn.execute("SELECT state, count(*) FROM v5_queue GROUP BY state").fetchall())}
        b.rec["validation"] = {"changed": len(changed), "unchanged_after_derive": len(unchanged), "quarantined": quarantined,
                               "withholding_flips": flips, "batch_errors": batch_errors,
                               "failures": {str(c): r["errors"] for c, r in results.items() if not r["ok"]},
                               "retro_allowed": {str(c): r["guard"]["retro_allowed"] for c, r in results.items() if r["guard"]["retro_allowed"]},
                               "impossible_dates_new": {str(c): r["warnings"]["impossible_dates_new"] for c, r in results.items()
                                                        if r["warnings"]["impossible_dates_new"]}}
        b.rec["horizon"] = horizon
        if batch_errors:
            b.state("WITHHELD", finished_at=int(time.time()))
            return b.rec
        if not changed:
            if unchanged:
                with conn:
                    conn.execute("DELETE FROM v5_pending WHERE cik IN (%s)" % ",".join(str(c) for c in unchanged))
            b.state("NO_CHANGE", finished_at=int(time.time()))
            write_status(conn, target, p, b.rec)
            return b.rec
        # READY -> PUBLISHED
        vid = "v5-" + dt.datetime.fromtimestamp(now, dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        manifest = PUB.build_manifest(version_id=vid, parent=parent_vid, companies=companies, tickers=tickers, fields={
            "batch_id": b.id, "kind": kind, "horizon": horizon,
            "code": {"methodology_commit": VP.METHODOLOGY_COMMIT, "pipeline_commit": b.rec["pipeline_commit"],
                     "base_sha256": VP.FROZEN_SHA256, "base_run_id": VP.RUN_ID},
            "changed": sorted(changed), "quarantined": sorted(quarantined),
            "validation": {"ok": True, "changed": len(changed), "retro_allowed": len(b.rec["validation"]["retro_allowed"]),
                           "withholding_flips": flips}})
        b.state("READY_TO_PUBLISH", version=vid)
        if not publish:
            b.rec["candidate_manifest"] = {k: v for k, v in manifest.items() if k not in ("companies", "tickers")}
            b.state("READY_TO_PUBLISH", finished_at=int(time.time()))
            return b.rec
        res = PUB.publish_version(target, manifest, bodies, expect_parent=parent_vid)
        with conn:
            conn.execute("INSERT INTO v5_version VALUES (?,?,?,?,?,?,?)",
                         (vid, parent_vid, res["manifest_sha256"], res["published_at"], b.id, None, json.dumps(res)))
            conn.execute("DELETE FROM v5_pending WHERE cik IN (%s)" % ",".join(str(c) for c in changed + unchanged))
            conn.execute("DELETE FROM v5_quarantine WHERE cik IN (%s)" % ",".join(str(c) for c in changed))
        os.makedirs(p["versions"], exist_ok=True)
        open(os.path.join(p["versions"], vid + ".json"), "wb").write(PUB.encode(manifest))
        snap = L.snapshot(conn, vid, p)
        with conn:
            conn.execute("UPDATE v5_version SET snapshot=? WHERE version_id=?", (snap, vid))
        b.state("PUBLISHED", version=vid, publish=res, finished_at=int(time.time()))
        write_status(conn, target, p, b.rec)
        return b.rec
    except Exception:
        if b is not None:
            try:
                b.state("FAILED", error=traceback.format_exc()[-1500:], finished_at=int(time.time()))
                return b.rec
            except Exception:
                pass
        raise
    finally:
        if conn is not None:
            conn.close()
        lease.release()


# ── currentness ───────────────────────────────────────────────────────────────────────────────────────────────
def currentness(conn, target, *, now: float | None = None) -> dict:
    now = time.time() if now is None else now
    cur = PUB.read_current(target) or {}
    last = conn.execute("SELECT batch_id, kind, state, finished_at FROM v5_batch ORDER BY started_at DESC LIMIT 1").fetchone()
    last_ok = conn.execute("SELECT max(finished_at) FROM v5_batch WHERE state IN ('PUBLISHED','NO_CHANGE')").fetchone()[0]
    held = conn.execute("SELECT count(*) FROM v5_batch WHERE state='WITHHELD' AND started_at > coalesce("
                        "(SELECT max(started_at) FROM v5_batch WHERE state IN ('PUBLISHED','NO_CHANGE')), 0)").fetchone()[0]
    oldest = conn.execute("SELECT min(discovered_at) FROM v5_queue WHERE state='QUEUED'").fetchone()[0]
    vt = L.meta_get(conn, "daily_index_verified_through")
    et = dt.datetime.fromtimestamp(now, ET)
    prev_bd = et.date() - dt.timedelta(days=1)
    while prev_bd.weekday() >= 5:
        prev_bd -= dt.timedelta(days=1)
    in_hours = et.weekday() < 5 and 6 <= et.hour < 23
    reasons = []
    if not cur:
        reasons.append("no V5 version published")
    if last_ok is None or now - last_ok > (1800 if in_hours else 26 * 3600):
        reasons.append("no successful cycle recently")
    if oldest and now - oldest > 7200:
        reasons.append("a discovered filing has been pending > 2h")
    if (vt is None or vt < (prev_bd - dt.timedelta(days=1)).isoformat()) and et.hour >= 8:
        reasons.append(f"daily index verified-through {vt} behind {prev_bd}")
    state = "WITHHELD" if held else ("CURRENT" if not reasons else "STALE")
    return {"state": state, "reasons": reasons, "version": cur.get("version"), "published_at": cur.get("published_at"),
            "last_batch": list(last) if last else None, "last_success_at": last_ok, "daily_index_verified_through": vt,
            "sec_checked_at": L.meta_get(conn, "sec_checked_at"), "oldest_pending_discovered_at": oldest,
            "queue": dict(conn.execute("SELECT state, count(*) FROM v5_queue GROUP BY state").fetchall()),
            "quarantined": [c for (c,) in conn.execute("SELECT cik FROM v5_quarantine")], "at": int(now)}


def write_status(conn, target, p: dict, rec: dict | None = None) -> dict:
    st = currentness(conn, target)
    body = json.dumps(st, default=str, indent=1)
    tmp = p["status"] + ".tmp"
    open(tmp, "w").write(body)
    os.replace(tmp, p["status"])
    try:
        target.put(PUB.STATUS_KEY, PUB.encode(st))
    except Exception as e:
        print(f"[fundamentals_v5] status publish failed: {e}")
    return st
