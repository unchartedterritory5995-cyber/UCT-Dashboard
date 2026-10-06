"""Market Cap HISTORY comparison (owner decision 2026-10-06, Decision 4): a candidate build vs the ACCEPTED authority.

Accepted history is a release-gate object. Categories (each (cik, session) on or before the authority's latest
valued session):
    VALUE_REMOVED                  an accepted valued day is a gap / hold / missing in the candidate     -> FAIL (any)
    VALUE_MOVED                    an accepted value changed                     -> FAIL at a factor >= 2 (listed always)
    VALUE_ADDED                    a historical day the authority did not value is valued now            (listed)
    GAP_REASON_CHANGED             an accepted gap keeps being a gap under another reason                (listed)
    SPLIT_INTERPRETATION_CHANGED   an accepted split-gap interpretation was replaced                     -> FAIL
    EVIDENCE_CITATION_CHANGED      a held split gap cites another statement (same status / days)         (listed)
An approved historical correction ATTACHED to the candidate (in its input lineage, not in the authority's) authorizes
exactly its own sealed impact rows: a removal / move it lists (same new value) and split changes of its issuers.
Nothing else -- a reason code is never an authorization.
"""
from __future__ import annotations

import gzip
import json
import os
import sqlite3


def iso(u) -> str:
    u = str(u or "9999-12-31")
    return f"{u[:4]}-{u[4:6]}-{u[6:8]}" if len(u) == 8 and u.isdigit() else u


def load_allowances(paths: list[str]) -> tuple[dict, set, list]:
    """impact_rows.jsonl.gz files of the attached approved corrections -> ({(cik, d): new cap | None}, {cik}, ids)."""
    allowed, ciks, ids = {}, set(), []
    for p in paths:
        ids.append(p)
        with gzip.open(p, "rt", encoding="utf-8") as f:
            for ln in f:
                cik, d, _old, new = json.loads(ln)
                allowed[(int(cik), int(d))] = new
                ciks.add(int(cik))
    return allowed, ciks, ids


def compare(new_db: str, old_db: str, allowed: dict | None = None, allowed_ciks: set | None = None) -> dict:
    from .refresh import split_reinterpretations
    allowed, allowed_ciks = allowed or {}, allowed_ciks or set()
    c = sqlite3.connect(f"file:{new_db}?mode=ro", uri=True)
    c.execute("ATTACH DATABASE ? AS a", (f"file:{old_db}?mode=ro",))
    upto = c.execute("SELECT MAX(d) FROM a.cap_daily").fetchone()[0]
    try:
        tick = dict(c.execute("SELECT cik, primary_ticker FROM main.coverage"))
        tick.update({k: v for k, v in c.execute("SELECT cik, primary_ticker FROM a.coverage") if k not in tick})
    except sqlite3.OperationalError:
        tick = {}
    moved = c.execute("SELECT n.cik, n.d, o.cap, n.cap FROM main.cap_daily n JOIN a.cap_daily o ON o.cik=n.cik AND o.d=n.d "
                      "WHERE n.d<=? AND ABS(n.cap/o.cap-1) > 1e-9 ORDER BY n.cik, n.d", (upto,)).fetchall()
    removed = c.execute("SELECT o.cik, o.d, o.cap FROM a.cap_daily o WHERE NOT EXISTS (SELECT 1 FROM main.cap_daily n "
                        "WHERE n.cik=o.cik AND n.d=o.d) ORDER BY o.cik, o.d").fetchall()
    added = c.execute("SELECT n.cik, n.d FROM main.cap_daily n WHERE n.d<=? AND NOT EXISTS (SELECT 1 FROM a.cap_daily o "
                      "WHERE o.cik=n.cik AND o.d=n.d) ORDER BY n.cik, n.d", (upto,)).fetchall()
    # gap reasons per accepted gap day are runs; compare the run sets over the authority's span
    try:
        gr_old = set(c.execute("SELECT cik, start, end, reason FROM a.gap_run WHERE start<=?", (upto,)))
        gr_new = set(c.execute("SELECT cik, start, end, reason FROM main.gap_run WHERE start<=?", (upto,)))
    except sqlite3.OperationalError:
        gr_old = gr_new = set()
    try:
        q = "SELECT cik, d, status, accn FROM {s}.split_gap WHERE d<=? AND status LIKE 'HELD%'"
        cit_old = {(r[0], r[1], r[2]): r[3] for r in c.execute(q.format(s="a"), (iso(upto),))}
        cit_new = {(r[0], r[1], r[2]): r[3] for r in c.execute(q.format(s="main"), (iso(upto),))}
    except sqlite3.OperationalError:
        cit_old = cit_new = {}
    c.close()

    def ok_move(cik, d, n):
        e = allowed.get((cik, d), "absent")
        return e != "absent" and e is not None and abs(n / e - 1) <= 1e-9

    rem_bad = [(k, d, o) for k, d, o in removed if not ((k, d) in allowed and allowed[(k, d)] is None)]
    mov_bad = [(k, d, o, n) for k, d, o, n in moved if not ok_move(k, d, n)]
    f2 = [x for x in mov_bad if x[3] / x[2] >= 2 or x[3] / x[2] <= 0.5]
    sr = [x for x in split_reinterpretations(new_db, old_db, upto) if x["cik"] not in allowed_ciks]
    cit = [{"cik": k[0], "d": k[1], "status": k[2], "accepted": v, "candidate": cit_new[k]}
           for k, v in cit_old.items() if k in cit_new and cit_new[k] != v]
    gap_old_by = {}
    for k, s_, e_, r_ in gr_old:
        gap_old_by.setdefault((k, s_, e_), set()).add(r_)
    reason_changed = sorted({(k, s_, e_) for k, s_, e_, r_ in gr_new if (k, s_, e_) in gap_old_by and r_ not in gap_old_by[(k, s_, e_)]})

    def by_issuer(rows, val=None):
        out = {}
        for r in rows:
            x = out.setdefault(r[0], {"cik": r[0], "ticker": tick.get(r[0]), "days": 0, "from": r[1], "to": r[1]})
            x["days"] += 1
            x["to"] = r[1]
            if val:
                rr = val(r)
                x["min_ratio"] = min(x.get("min_ratio", rr), rr)
                x["max_ratio"] = max(x.get("max_ratio", rr), rr)
        return sorted(out.values(), key=lambda v: -v["days"])

    cats = {
        "VALUE_REMOVED": {"unapproved": len(rem_bad), "approved": len(removed) - len(rem_bad), "by_issuer": by_issuer(rem_bad)[:60]},
        "VALUE_MOVED": {"unapproved": len(mov_bad), "approved": len(moved) - len(mov_bad), "factor2_unapproved": len(f2),
                        "by_issuer": by_issuer(mov_bad, lambda r: r[3] / r[2])[:60]},
        "VALUE_ADDED": {"days": len(added), "by_issuer": by_issuer(added)[:60]},
        "GAP_REASON_CHANGED": {"runs": len(reason_changed), "sample": [list(x) for x in reason_changed[:40]]},
        "SPLIT_INTERPRETATION_CHANGED": {"unapproved": len(sr), "rows": sr[:40]},
        "EVIDENCE_CITATION_CHANGED": {"rows": len(cit), "sample": cit[:40]},
    }
    passed = not rem_bad and not f2 and not sr
    return {"pass": passed, "authority_latest_session": upto, "categories": cats,
            "failing": [k for k, v in (("VALUE_REMOVED", rem_bad), ("VALUE_MOVED>=2x", f2), ("SPLIT_INTERPRETATION_CHANGED", sr)) if v]}


def impact_rows(new_db: str, old_db: str, out_gz: str) -> int:
    """Every changed accepted (cik, session) of a correction candidate: [cik, d, old, new] (new None = removed,
    old None = added). Sealed with an approval; HISTORY authorizes exactly these."""
    c = sqlite3.connect(f"file:{new_db}?mode=ro", uri=True)
    c.execute("ATTACH DATABASE ? AS a", (f"file:{old_db}?mode=ro",))
    upto = c.execute("SELECT MAX(d) FROM a.cap_daily").fetchone()[0]
    rows = c.execute("SELECT n.cik, n.d, o.cap, n.cap FROM main.cap_daily n JOIN a.cap_daily o ON o.cik=n.cik AND o.d=n.d "
                     "WHERE n.d<=? AND ABS(n.cap/o.cap-1) > 1e-12", (upto,)).fetchall()
    rows += c.execute("SELECT o.cik, o.d, o.cap, NULL FROM a.cap_daily o WHERE NOT EXISTS (SELECT 1 FROM main.cap_daily n "
                      "WHERE n.cik=o.cik AND n.d=o.d)").fetchall()
    rows += c.execute("SELECT n.cik, n.d, NULL, n.cap FROM main.cap_daily n WHERE n.d<=? AND NOT EXISTS (SELECT 1 FROM "
                      "a.cap_daily o WHERE o.cik=n.cik AND o.d=n.d)", (upto,)).fetchall()
    c.close()
    rows.sort()
    if os.path.exists(out_gz):
        os.remove(out_gz)
    with open(out_gz, "wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as f:
        for r in rows:
            f.write((json.dumps(list(r)) + "\n").encode())
    return len(rows)
