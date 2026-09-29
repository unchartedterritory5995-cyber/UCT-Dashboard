"""COUNTERFACTUAL causal attribution (runner, pinned code) on a SCRATCH COPY of v5.db -- the artifact is read-only.
For every company with a V4-value -> V5-gap point or an UNEXPLAINED stage-1 point:
  A  = V5 evidence minus the V5-only rows          -> does the V5 gap / change disappear?  (caused by NEW V5 evidence)
  B  = V5 evidence plus the V4-only rows           -> does it disappear?                     (caused by V5 LACKING FS evidence)
  C  = V4 evidence exactly (minus only5, plus only4) -> must reproduce V4 at EVERY differing point (derivation identical)
Evidence identity for knowledge = (accn, tag, period_start, period_end). Writes validation/cf.json only."""
import sys
CODE = "/data/fundamentals_pit_v5/code/7dfda83de6a7"
sys.path.insert(0, CODE)
import collections, datetime as dt, json, os, sqlite3, traceback
from concurrent.futures import ProcessPoolExecutor

VAL = "/data/fundamentals_pit_v5/validation"
V5DB, SRC = "/data/fundamentals_pit_v5/run/v5.db", "/data/fundamentals_pit.db"
COPY = VAL + "/cf_copy.db"


def in_force(rows, metric, t):
    cur = None
    for m, te, v, pe, me in rows:
        if m == metric and te <= t:
            cur = (None if me == "gap" else v, pe, me)
    return cur


def one(args):
    cik, pts, allpts = args
    from api.services.fundamentals_pit import derive as D, store as S
    try:
        v4 = sqlite3.connect(f"file:{SRC}?mode=ro", uri=True, timeout=60)
        q = ("SELECT s.accn, s.tag, s.period_start, s.period_end, s.kind, s.source, s.first_seen_at FROM filing_signal s "
             "JOIN filing f ON f.accn=s.accn WHERE f.cik=?")
        r4 = {r[:4]: r for r in v4.execute(q, (cik,))}
        s4 = v4.execute("SELECT metric, t_eff, v, period_end, method FROM series_point WHERE cik=? AND derivation_version=4 ORDER BY 1, 2", (cik,)).fetchall()
        v4.close()
        conn = S.connect(COPY)
        r5 = {r[:4]: r for r in conn.execute(q, (cik,))}
        only5 = [r5[k] for k in set(r5) - set(r4)]
        only4 = [r4[k] for k in set(r4) - set(r5)]
        s5 = conn.execute("SELECT metric, t_eff, v, period_end, method FROM series_point WHERE cik=? AND derivation_version=5 ORDER BY 1, 2", (cik,)).fetchall()
        ins = "INSERT OR REPLACE INTO filing_signal VALUES (?,?,?,?,?,?,?)"
        dele = "DELETE FROM filing_signal WHERE accn=? AND tag=? AND period_start=? AND period_end=?"
        rows = lambda: conn.execute("SELECT metric, t_eff, v, period_end, method FROM series_point WHERE cik=? AND derivation_version=5 ORDER BY 1, 2", (cik,)).fetchall()

        def rebuild():
            D.build_company(conn, cik, version=5, force=True)
            return rows()
        with S.tx(conn):
            conn.executemany(dele, [r[:4] for r in only5])
        A = rebuild()
        with S.tx(conn):
            conn.executemany(ins, [r[:4] + (r[4], "cf_v4", r[6]) for r in only4])
        C = rebuild()
        with S.tx(conn):
            conn.executemany(ins, only5)
        B = rebuild()
        with S.tx(conn):
            conn.executemany(dele, [r[:4] for r in only4])
        R = rebuild()                                           # restored: must equal the artifact again
        out = []
        for metric, t, kind, why in pts:
            v4p, v5p = in_force(s4, metric, t), in_force(s5, metric, t)
            a, b = in_force(A, metric, t), in_force(B, metric, t)
            if a == v4p:
                cause = "NEW_V5_EVIDENCE"
            elif b == v4p:
                cause = "V5_LACKS_FS_EVIDENCE"
            else:
                cause = "JOINT"
            out.append({"cik": cik, "metric": metric, "t": t, "day": dt.datetime.utcfromtimestamp(t).date().isoformat(), "kind": kind,
                        "why": why, "cause": cause, "v4": v4p, "v5": v5p, "A": a, "B": b,
                        "only5_by_t": sum(1 for r in only5 if True), "only4": len(only4)})
        c_ok = all(in_force(C, m, t) == in_force(s4, m, t) for m, t in allpts)
        return {"cik": cik, "rows": out, "C_reproduces_v4_at_all_diff_points": c_ok, "C_equals_v4_series": C == s4,
                "restored_equals_artifact": R == s5, "only5": len(only5), "only4": len(only4)}
    except Exception:
        return {"cik": cik, "error": traceback.format_exc()[-1000:]}


if __name__ == "__main__":
    if os.path.exists(COPY):
        os.remove(COPY)
    src = sqlite3.connect(f"file:{V5DB}?mode=ro", uri=True); dst = sqlite3.connect(COPY); src.backup(dst); dst.close(); src.close()
    dd = sqlite3.connect(f"file:{VAL}/v4v5_diff.db?mode=ro", uri=True)
    sel = dd.execute("SELECT cik, metric, t_eff, kind, classes, truth FROM diff WHERE kind='v4value_to_v5gap' OR classes LIKE '%UNEXPLAINED%'").fetchall()
    by = collections.defaultdict(list)
    for cik, m, t, k, cl, tr in sel:
        by[cik].append((m, t, k, "UNEXPLAINED" if "UNEXPLAINED" in (cl or "") else "V4VALUE_TO_V5GAP"))
    allp = collections.defaultdict(list)
    for cik, m, t in dd.execute("SELECT cik, metric, t_eff FROM diff"):
        if cik in by:
            allp[cik].append((m, t))
    res = []
    with ProcessPoolExecutor(8) as ex:
        for r in ex.map(one, [(c, by[c], allp[c]) for c in sorted(by)]):
            res.append(r)
    rows = [x for r in res for x in r.get("rows", [])]
    cnt = collections.Counter((x["why"], x["cause"]) for x in rows)
    out = {"companies": len(res), "points": len(rows), "by_why_cause": {f"{a}|{b}": n for (a, b), n in cnt.items()},
           "errors": [r for r in res if "error" in r],
           "C_reproduces_v4_all": all(r.get("C_reproduces_v4_at_all_diff_points") for r in res if "error" not in r),
           "C_equals_v4_series_all": all(r.get("C_equals_v4_series") for r in res if "error" not in r),
           "C_not_equal_companies": [r["cik"] for r in res if "error" not in r and not r.get("C_equals_v4_series")],
           "restored_all": all(r.get("restored_equals_artifact") for r in res if "error" not in r),
           "companies_detail": res}
    json.dump(out, open(VAL + "/cf.json", "w"), indent=1, default=str)
    print(json.dumps({k: v for k, v in out.items() if k != "companies_detail"}, default=str))
