"""V5 ACCEPTANCE INSTANT: the authoritative moment SEC accepted a filing, and the correction of stored ones.

⛔ MEASURED 2026-10-01 (live, against filings accepted that morning, and CAG 0001104659-26-112354 one day later):
  data.sec.gov/submissions `acceptanceDateTime` serves a filing accepted TODAY with the EDGAR Eastern wall clock and a
  "Z" suffix (accepted 10:44:23 ET -> "2026-10-01T10:44:23.000Z"; header 20261001104423; feed 10:44:23-04:00). The
  same field is later re-served as true UTC (CAG, accepted 16:30:38 ET: stored at capture as 16:30:38Z, served the
  next day as 20:30:38Z). The frozen methodology (filings._parse_accepted) correctly reads "Z" as UTC, so every
  filing first ingested while SEC served it that way became effective 4 h (EDT) / 5 h (EST) BEFORE it was public.
  The frozen base carries the same defect for companies whose submissions were served that way at bulk time
  (filing_anomaly: CIK 16875, 829224, 312069 -- whole histories, +14400 s in EDT, +18000 s in EST).

AUTHORITY (deterministic): EDGAR's acceptance record -- the filing header `<ACCEPTANCE-DATETIME>YYYYMMDDHHMMSS`
(Archives/edgar/data/<cik>/<accn>/<accn>.hdr.sgml), or, only where that header carries no such line, the same
stamp on the filing index page ('Accepted'). Eastern wall clock without a zone, identical on the filing day and
ever after. It is interpreted with America/New_York (zoneinfo: real DST rules,
never a fixed offset) and normalised to UTC. Submissions' value is never trusted for a NEW filing. If the header
cannot be read, the company is NOT ingested this cycle (fail closed; the queue retries it).

A wall clock that is ambiguous (the hour repeated when DST ends) or nonexistent (the hour skipped when it starts)
resolves to the LATER instant and is recorded as such: the effective time can only be late, never early.

The frozen methodology files are untouched: the acquisition step normalises its INPUT (the submissions pages) before
`ingest_company` parses them, and a correction rewrites live.db filing rows through an explicit, evidenced batch.
"""
from __future__ import annotations

import copy
import datetime as dt
import json
import re
import time
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
_HDR = re.compile(rb"<ACCEPTANCE-DATETIME>\s*(\d{14})")
_IDX = re.compile(rb'Accepted</div>\s*<div class="info">(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)')

ACCEPTANCE_SCHEMA = """
CREATE TABLE IF NOT EXISTS v5_acceptance (
    accn TEXT PRIMARY KEY, cik INTEGER NOT NULL, header_eastern TEXT NOT NULL, accepted_at INTEGER NOT NULL,
    status TEXT NOT NULL, submissions_raw TEXT, resolved_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS v5_acceptance_correction (
    accn TEXT PRIMARY KEY, cik INTEGER NOT NULL, old_accepted_at INTEGER, new_accepted_at INTEGER NOT NULL,
    old_public_at INTEGER NOT NULL, new_public_at INTEGER NOT NULL, header_eastern TEXT NOT NULL,
    header_status TEXT NOT NULL, batch_id TEXT NOT NULL, reason TEXT NOT NULL, at INTEGER NOT NULL);
"""


class AcceptanceUnavailable(RuntimeError):
    """The authoritative acceptance instant could not be established; the caller must not ingest the filing."""


def eastern_to_utc(raw14: str) -> tuple[dt.datetime, str]:
    """EDGAR Eastern wall clock 'YYYYMMDDHHMMSS' -> (aware UTC datetime, 'exact' | 'ambiguous_later')."""
    naive = dt.datetime.strptime(raw14, "%Y%m%d%H%M%S")
    a, b = naive.replace(tzinfo=ET, fold=0), naive.replace(tzinfo=ET, fold=1)
    ua, ub = a.astimezone(dt.timezone.utc), b.astimezone(dt.timezone.utc)
    round_trip = ua.astimezone(ET).replace(tzinfo=None)
    if ua != ub or round_trip != naive:
        return max(ua, ub), "ambiguous_later"
    return ua, "exact"


def header_url(cik: int, accn: str) -> str:
    from .sec_client import WWW
    return f"{WWW}/Archives/edgar/data/{int(cik)}/{accn.replace('-', '')}/{accn}.hdr.sgml"


def parse_header(body: bytes | None) -> str | None:
    m = _HDR.search(body or b"")
    return m.group(1).decode() if m else None


def index_url(cik: int, accn: str) -> str:
    from .sec_client import WWW
    return f"{WWW}/Archives/edgar/data/{int(cik)}/{accn.replace('-', '')}/{accn}-index.htm"


def parse_index_accepted(body: bytes | None) -> str | None:
    """The filing index page's 'Accepted' field (EDGAR Eastern wall clock, 'YYYY-MM-DD HH:MM:SS') as 14 digits."""
    m = _IDX.search(body or b"")
    return b"".join(m.groups()).decode() if m else None


def header_acceptance(cik: int, accn: str, *, get=None) -> tuple[str, dt.datetime, str]:
    """(eastern_14, accepted_at UTC, status) from EDGAR's acceptance record. Raises AcceptanceUnavailable.

    Deterministic order: 1) the filing header `.hdr.sgml` <ACCEPTANCE-DATETIME>; 2) only when the header carries no
    such line (MEASURED: pre-2001 headers, e.g. 0000950159-97-000194) or is absent, the filing index page's
    'Accepted' field -- the same EDGAR Eastern acceptance stamp rendered as a page. Nothing else."""
    if get is None:
        from .sec_client import get_bytes as get
    errs = []
    for url, parse in ((header_url(cik, accn), parse_header), (index_url(cik, accn), parse_index_accepted)):
        try:
            raw = parse(get(url))
        except Exception as e:                                # 404 / network: try the next record, else fail closed
            errs.append(str(e)[:80]); continue
        if raw is not None:
            at, status = eastern_to_utc(raw)
            return raw, at, status
        errs.append("no acceptance stamp")
    raise AcceptanceUnavailable(f"{accn}: no EDGAR acceptance record ({'; '.join(errs)})")


def utc_z(at: dt.datetime) -> str:
    """The submissions-format string the frozen parser reads as UTC."""
    return at.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def ensure_schema(conn) -> None:
    conn.executescript(ACCEPTANCE_SCHEMA)


def normalize_new_filings(conn, cik: int, pages: list[dict], accns, *, resolve=None, now: float | None = None) -> tuple[list[dict], list[dict]]:
    """Return (pages', evidence): pages with acceptanceDateTime replaced by the header instant for every accession in
    `accns` that live.db does not hold yet. Stored filings are never touched here (they freeze at first sight; a
    stored error is fixed only by `run_correction`). Raises AcceptanceUnavailable (nothing is written)."""
    resolve = resolve or header_acceptance
    known = {a for (a,) in conn.execute("SELECT accn FROM filing WHERE cik=?", (cik,))}
    todo = sorted(a for a in set(accns) if a not in known)
    if not todo:
        return pages, []
    raw_sub = {}
    for pg in pages:
        for a, v in zip(pg.get("accessionNumber") or [], pg.get("acceptanceDateTime") or []):
            raw_sub.setdefault(a, v)
    resolved = {}
    for a in todo:
        raw, at, status = resolve(cik, a)
        resolved[a] = (raw, at, status)
    out = copy.deepcopy(pages)
    for pg in out:
        acc = pg.get("acceptanceDateTime")
        if acc is None:
            continue
        for i, a in enumerate(pg.get("accessionNumber") or []):
            if a in resolved:
                acc[i] = utc_z(resolved[a][1])
    now = int(time.time() if now is None else now)
    ev = [{"accn": a, "cik": cik, "header_eastern": r[0], "accepted_at": int(r[1].timestamp()), "status": r[2],
           "submissions_raw": raw_sub.get(a), "resolved_at": now} for a, r in resolved.items()]
    return out, ev


def record_evidence(conn, evidence: list[dict]) -> None:
    if not evidence:
        return
    ensure_schema(conn)
    with conn:
        conn.executemany("INSERT OR REPLACE INTO v5_acceptance VALUES (?,?,?,?,?,?,?)",
                         [(e["accn"], e["cik"], e["header_eastern"], e["accepted_at"], e["status"], e["submissions_raw"],
                           e["resolved_at"]) for e in evidence])


# ── correction of stored filings ────────────────────────────────────────────────────────────────────────────────
def _asof(rows: list, t: int):
    best = None
    for r in rows:
        if r[0] <= t:
            best = r
        else:
            break
    return None if best is None else tuple(best[1:])


def correction_windows(moves: list[tuple[int, int]]) -> list[tuple[int, int, frozenset]]:
    """[(old_t, end, allowed_step_times)]: from a corrected filing's OLD effective time to the LATEST true time of
    every corrected filing that shared it. Inside a window the company's knowledge is legitimately different
    (the filings were not yet public, or became public one at a time)."""
    by: dict[int, set] = {}
    for o, n in moves:
        if o != n:
            by.setdefault(o, set()).add(n)
    return [(o, max(ns), frozenset(ns)) for o, ns in sorted(by.items())]


def correction_guard(parent: dict | None, new: dict, moves) -> list[str]:
    """[] iff `new` differs from `parent` ONLY by the corrected effective times:
      - outside every correction window, every metric's as-of value (value, period, method) is identical at every
        breakpoint of either series (so values before the old time and from the latest true time on are unchanged);
      - inside a window the new series steps ONLY at the corrected filings' true acceptance times;
      - split status and company-wide withholding are identical.
    When one filing moves, this is exactly 'the parent with its effective time remapped'. When several filings that
    shared an old time (e.g. the 06:00 ET floor) separate, the intermediate knowledge between their true times is the
    one thing allowed to be new."""
    if parent is None:
        return ["no parent object"]
    moves = list(moves.items()) if isinstance(moves, dict) else list(moves)
    errs = []
    if bool(parent.get("withheld_split_sensitive")) != bool(new.get("withheld_split_sensitive")):
        errs.append("withholding changed")
    if parent.get("split_status") != new.get("split_status"):
        errs.append("split_status changed")
    wins = correction_windows(moves)
    inside = lambda t: next((w for w in wins if w[0] <= t < w[1]), None)
    pm, nm = parent.get("metrics") or {}, new.get("metrics") or {}
    for m in sorted(set(pm) | set(nm)):
        a, b = sorted(pm.get(m) or [], key=lambda r: r[0]), sorted(nm.get(m) or [], key=lambda r: r[0])
        for r in b:
            w = inside(r[0])
            if w is not None and r[0] not in w[2] and r[0] != w[0]:
                errs.append(f"series {m} steps inside a correction window at a time that is no corrected filing's"); break
            if w is not None and r[0] == w[0] and r[0] not in w[2]:
                errs.append(f"series {m} still steps at a corrected filing's OLD effective time"); break
        else:
            for t in sorted({r[0] for r in a} | {r[0] for r in b}):
                if inside(t) is None and _asof(a, t) != _asof(b, t):
                    errs.append(f"series {m} differs outside the correction windows"); break
    return errs


def intermediate_points(parent: dict, new: dict, moves) -> int:
    """New-series points inside correction windows that are NOT a plain remap of a parent point (reported)."""
    moves = list(moves.items()) if isinstance(moves, dict) else list(moves)
    wins = correction_windows(moves)
    n = 0
    for m, rows in (new.get("metrics") or {}).items():
        prow = {tuple(r[1:]) for r in (parent.get("metrics") or {}).get(m, [])}
        n += sum(1 for r in rows if any(w[0] <= r[0] < w[1] for w in wins) and tuple(r[1:]) not in prow)
    return n


def load_evidence(path_or_doc) -> list[dict]:
    doc = json.load(open(path_or_doc)) if isinstance(path_or_doc, str) else path_or_doc
    rows = doc["rows"] if isinstance(doc, dict) else doc
    return [r for r in rows if r.get("cls") == "affected"]


def run_correction(target, evidence: list[dict], *, reason: str, p: dict | None = None, now: float | None = None,
                   resolve=None, publish: bool = True, exclude_ciks=()) -> dict:
    """ONE evidenced acceptance-time correction batch.

    For every audited accession: re-read the EDGAR header (it must equal the audit's authoritative instant), require
    the live row to still hold the audited stored value, rewrite accepted_at / public_at (public_at by the frozen rule
    filings.public_at), record old -> new, re-derive ONLY the companies whose effective times moved, and accept a
    company only if its new object is EXACTLY its parent object with those effective times remapped (no value,
    period, method, split or withholding change). Any failure reverts every row and publishes nothing.
    RESUMABLE: a batch killed after rewriting rows (a worker redeploy) is completed by re-running it -- a row already
    holding the audited new instant WITH its recorded old values counts as applied."""
    from . import derive as D, publish as P, store as S, v5_live as L, v5_pipeline as PL, v5_prod as VP
    from . import v5_publish as PUB, v5_validate as VAL
    from .filings import public_at as frozen_public_at
    p = p or VP.paths()
    now = time.time() if now is None else now
    resolve = resolve or header_acceptance
    if L.held(p):
        return {"state": "HOLD"}
    lease = L.Lease(p)
    if not lease.acquire():
        return {"state": "BUSY"}
    conn = b = None
    applied: list[tuple] = []
    built0: dict = {}
    try:
        L.verify_base(p)
        conn = L.connect_live(p)
        ensure_schema(conn)
        b = PL.Batch(conn, "correction", p, now)
        b.rec["correction"] = {"kind": "acceptance_time", "reason": reason, "audited_rows": len(evidence)}
        parent_vid, parent = PL.parent_state(target)
        if parent is None:
            b.state("FAILED", error="no published V5 version", finished_at=int(time.time()))
            return b.rec
        b.rec["parent_version"] = parent_vid
        b.state("ACQUIRING")
        plan, problems = [], []
        for e in evidence:
            accn, cik = e["accn"], int(e["cik"])
            if cik in exclude_ciks:
                continue
            row = conn.execute("SELECT accepted_at, public_at, filing_date FROM filing WHERE accn=? AND cik=?", (accn, cik)).fetchone()
            if row is None:
                problems.append([accn, "not in live.db"]); continue
            done = conn.execute("SELECT old_accepted_at, old_public_at FROM v5_acceptance_correction WHERE accn=?",
                                (accn,)).fetchone()
            resumed = done is not None and tuple(done) == (e["stored_accepted_at"], e["old_public_at"])                 and row[0] == e["authoritative_accepted_at"]
            if not resumed and (row[0] != e["stored_accepted_at"] or row[1] != e["old_public_at"]):
                problems.append([accn, "live row differs from the audited stored value", row[:2]]); continue
            raw, at, status = resolve(cik, accn)
            new_acc = int(at.timestamp())
            if raw != e["header_eastern"] or new_acc != e["authoritative_accepted_at"]:
                problems.append([accn, "header re-read disagrees with the audit", raw, new_acc]); continue
            fd = dt.date(row[2] // 10000, row[2] // 100 % 100, row[2] % 100)
            new_pub = int(frozen_public_at(at, fd).timestamp())
            if new_pub < new_acc:
                problems.append([accn, "public_at before acceptance"]); continue
            if resumed and row[1] != new_pub:
                problems.append([accn, "resumed row public_at differs from the rule"]); continue
            plan.append((accn, cik, e["stored_accepted_at"], new_acc, e["old_public_at"], new_pub, raw, status))
        b.rec["correction"].update({"planned": len(plan), "problems": problems[:50], "problems_n": len(problems)})
        if problems:
            b.state("FAILED", error=f"{len(problems)} audited rows do not reproduce; nothing changed", finished_at=int(time.time()))
            return b.rec
        moved = sorted({c for _, c, _, _, op, np_, _, _ in plan if op != np_})
        busy = [c for (c,) in conn.execute("SELECT cik FROM v5_pending") if c in set(moved)]
        if busy:
            b.state("FAILED", error=f"companies with pending pipeline work: {busy[:20]}", finished_at=int(time.time()))
            return b.rec
        with conn:
            for accn, cik, oa, na, op, np_, raw, status in plan:
                conn.execute("UPDATE filing SET accepted_at=?, public_at=? WHERE accn=? AND cik=?", (na, np_, accn, cik))
                conn.execute("INSERT OR REPLACE INTO v5_acceptance_correction VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                             (accn, cik, oa, na, op, np_, raw, status, b.id, reason, int(now)))
        applied = plan
        # DERIVING (only companies whose effective times moved)
        b.state("DERIVING")
        built0 = {c: (S.build_info(conn, c, VP.V5) or {}).get("built_at") for c in moved}
        for cik in moved:
            D.build_company(conn, cik, version=VP.V5, force=True, now=now)
        b.state("VALIDATING")
        companies = {int(c): s for c, s in parent["companies"].items()}
        bodies, changed, failures, unchanged, intermediate = {}, [], {}, [], {}
        for cik in moved:
            doc = P.artifact(conn, cik, VP.V5)
            body, _ = P.encode(doc)
            s = PUB.sha(body)
            if companies.get(cik) == s:
                unchanged.append(cik); continue
            parent_obj = PUB.read_json(target, PUB.obj_key(companies[cik])) if cik in companies else None
            mine = [x for x in plan if x[1] == cik and x[4] != x[5]]
            moves = [(x[4], x[5]) for x in mine]
            errs = []
            others = {pa for (pa,) in conn.execute(
                "SELECT public_at FROM filing WHERE cik=? AND accn NOT IN (%s)" % ",".join("?" * len(mine)),
                (cik, *[x[0] for x in mine]))} if mine else set()
            if others & {o for o, _ in moves}:
                errs.append("an uncorrected filing shares a corrected filing's old effective time")
            rows = VAL.stored_rows(conn, cik)
            inv = {k: v for k, v in VAL.invariants(conn, cik, rows).items() if k in VAL.HARD and v}
            if inv:
                errs.append(f"invariants: {inv}")
            if VAL.derive_rows(conn, cik) != rows:
                errs.append("nondeterministic")
            errs += correction_guard(parent_obj, doc, moves)
            if errs:
                failures[str(cik)] = errs
            else:
                bodies[s] = body; companies[cik] = s; changed.append(cik)
                k = intermediate_points(parent_obj, doc, moves)
                if k:
                    intermediate[str(cik)] = k
        b.rec["validation"] = {"changed": len(changed), "unchanged_after_derive": len(unchanged),
                               "failures": failures, "quarantined": [], "retro_allowed": {}, "batch_errors": [],
                               "withholding_events": [], "impossible_dates_new": {},
                               "acceptance_correction": {"companies_moved": len(moved), "filings": len(plan),
                                                         "public_at_moved": sum(1 for x in plan if x[4] != x[5]),
                                                         "intermediate_points_by_company": intermediate}}
        if failures:
            _revert(conn, applied, moved, built0)
            applied = []
            b.state("FAILED", error=f"{len(failures)} companies are not a pure acceptance-time correction; reverted, "
                                    "nothing published", finished_at=int(time.time()))
            return b.rec
        if not changed:
            if not publish:
                _revert(conn, applied, moved, built0)
                applied = []
            b.state("NO_CHANGE", finished_at=int(time.time()))
            if publish:
                PL.write_status(conn, target, p, b.rec)
            return b.rec
        vid = "v5-" + dt.datetime.fromtimestamp(now, dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-c"
        manifest = PUB.build_manifest(version_id=vid, parent=parent_vid, companies=companies, tickers=parent["tickers"], fields={
            "batch_id": b.id, "kind": "correction", "horizon": parent.get("horizon"),
            "code": {"methodology_commit": VP.METHODOLOGY_COMMIT, "pipeline_commit": b.rec["pipeline_commit"],
                     "base_sha256": VP.FROZEN_SHA256, "base_run_id": VP.RUN_ID},
            "changed": sorted(changed), "quarantined": [],
            "correction": {"kind": "acceptance_time", "reason": reason, "filings": len(plan),
                           "public_at_moved": sum(1 for x in plan if x[4] != x[5]),
                           "rule": "EDGAR header ACCEPTANCE-DATETIME, America/New_York -> UTC; public_at = frozen filings.public_at"},
            "validation": {"ok": True, "changed": len(changed), "intermediate_points_by_company": intermediate,
                           "basis": "every changed object equals its parent outside the correction windows; inside a "
                                    "window it steps only at corrected filings' true acceptance times"}})
        b.state("READY_TO_PUBLISH", version=vid)
        if not publish:
            b.rec["candidate_manifest"] = {k: v for k, v in manifest.items() if k not in ("companies", "tickers")}
            _revert(conn, applied, moved, built0)
            applied = []
            b.state("READY_TO_PUBLISH", finished_at=int(time.time()))
            return b.rec
        res = PUB.publish_version(target, manifest, bodies, expect_parent=parent_vid, parent_manifest=parent)
        applied = []                                             # published: the rows are the new truth
        import os
        with conn:
            conn.execute("INSERT INTO v5_version VALUES (?,?,?,?,?,?,?)",
                         (vid, parent_vid, res["manifest_sha256"], res["published_at"], b.id, None, json.dumps(res)))
        os.makedirs(p["versions"], exist_ok=True)
        open(os.path.join(p["versions"], vid + ".json"), "wb").write(PUB.encode(manifest))
        snap = L.snapshot(conn, vid, p)
        with conn:
            conn.execute("UPDATE v5_version SET snapshot=? WHERE version_id=?", (snap, vid))
        b.state("PUBLISHED", version=vid, publish=res, finished_at=int(time.time()))
        PL.write_status(conn, target, p, b.rec)
        return b.rec
    except Exception:
        if conn is not None and applied:
            try:
                _revert(conn, applied, sorted({x[1] for x in applied}), built0)
            except Exception:
                pass
        if b is not None:
            import traceback
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


def _revert(conn, applied: list[tuple], ciks: list[int], built0: dict) -> None:
    """Put every corrected row back and re-derive with the ORIGINAL built_at (derivation is deterministic, so the
    stored series and the company object return byte for byte)."""
    from . import derive as D, v5_prod as VP
    with conn:
        for accn, cik, oa, na, op, np_, raw, status in applied:
            conn.execute("UPDATE filing SET accepted_at=?, public_at=? WHERE accn=? AND cik=?", (oa, op, accn, cik))
            conn.execute("DELETE FROM v5_acceptance_correction WHERE accn=?", (accn,))
    for cik in ciks:
        if built0.get(cik) is not None:
            D.build_company(conn, cik, version=VP.V5, force=True, now=built0[cik])
