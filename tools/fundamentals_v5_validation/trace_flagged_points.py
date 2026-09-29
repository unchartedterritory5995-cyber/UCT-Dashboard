"""Read-only trace of every flagged stage-1 point (UNEXPLAINED / WRONG / GAP_UNJUSTIFIED).
For each: V4 and V5 re-derived provenance at t, every V4-vs-V5 evidence difference on relevant tags public by t
(NO date window), and for WRONG the full later-report chain with forms. Writes validation/trace.json only."""
import sys
CODE = "/data/fundamentals_pit_v5/code/7dfda83de6a7"
sys.path.insert(0, CODE)
import collections, datetime as dt, json, sqlite3, traceback
from concurrent.futures import ProcessPoolExecutor

VAL = "/data/fundamentals_pit_v5/validation"
V5DB, SRC = "/data/fundamentals_pit_v5/run/v5.db", "/data/fundamentals_pit.db"


def trace_company(args):
    cik, pts = args
    from api.services.fundamentals_pit import derive as D, store as S
    from api.services.fundamentals_pit.concepts import PRIMITIVES
    REL = frozenset(t for p in PRIMITIVES.values() for t in p.tags)
    out = []
    try:
        v4 = S.connect(SRC, readonly=True); v5 = S.connect(V5DB, readonly=True)
        fil = {a: (p, f, fd) for a, p, f, fd in v5.execute("SELECT accn, public_at, form, filing_date FROM filing WHERE cik=?", (cik,))}
        sig = lambda c: {(a, t, int(s), int(e), k) for a, t, s, e, k in c.execute(
            "SELECT s.accn, s.tag, s.period_start, s.period_end, s.kind FROM filing_signal s JOIN filing f ON f.accn=s.accn WHERE f.cik=?", (cik,))}
        s4, s5 = sig(v4), sig(v5)
        for metric, t, kind, why in pts:
            r = {"cik": cik, "metric": metric, "t": t, "day": dt.datetime.utcfromtimestamp(t).date().isoformat(), "kind": kind, "why": why}
            e4 = D.explain(v4, cik, metric, t, 4); e5 = D.explain(v5, cik, metric, t, 5)
            for k, e in (("v4", e4), ("v5", e5)):
                r[k] = {"served": e["served"], "rederived": e["rederived"], "matches": e["matches_served"],
                        "facts": [[f["tag"], f["period_start"], f["period_end"], f["accn"], f["form"], f["reported_value"], f["public_at"]] for f in e["facts"]]}
            pub = lambda a: fil.get(a, (1e18,))[0]
            only4 = sorted([list(x) + [fil.get(x[0], ("?", "?"))[1]] for x in s4 - s5 if x[1] in REL and pub(x[0]) <= t], key=lambda x: pub(x[0]))
            only5 = sorted([list(x) + [fil.get(x[0], ("?", "?"))[1]] for x in s5 - s4 if x[1] in REL and pub(x[0]) <= t], key=lambda x: pub(x[0]))
            r["evidence_only_v4_fs"] = only4[-12:]; r["evidence_only_v5_instance"] = only5[-12:]
            r["n_only_v4"], r["n_only_v5"] = len(only4), len(only5)
            if why == "WRONG":
                chains = []
                for f in e5["facts"]:
                    if not f.get("period_end"):
                        continue
                    ps = int(f["period_start"].replace("-", "")) if f.get("period_start") else 0
                    pe = int(f["period_end"].replace("-", ""))
                    ch = v5.execute("SELECT x.val, fi.accn, fi.form, fi.public_at FROM fact x JOIN concept c ON c.concept_id=x.concept_id "
                                    "JOIN filing fi ON fi.filing_id=x.filing_id WHERE x.cik=? AND c.tag=? AND x.period_start=? AND x.period_end=? "
                                    "ORDER BY fi.public_at", (cik, f["tag"], ps, pe)).fetchall()
                    chains.append({"fact": [f["tag"], ps, pe, f["reported_value"], f["accn"]],
                                   "chain": [[v, a, fm, dt.datetime.utcfromtimestamp(p).isoformat(), p <= t] for v, a, fm, p in ch]})
                r["chains"] = chains
            out.append(r)
    except Exception:
        out.append({"cik": cik, "error": traceback.format_exc()[-1200:]})
    return out


if __name__ == "__main__":
    dd = sqlite3.connect(f"file:{VAL}/v4v5_diff.db?mode=ro", uri=True)
    rows = dd.execute("SELECT cik, metric, t_eff, kind, classes, truth FROM diff WHERE classes LIKE '%UNEXPLAINED%' "
                      "OR truth IN ('WRONG', 'GAP_UNJUSTIFIED')").fetchall()
    by = collections.defaultdict(list)
    for cik, m, t, k, cl, tr in rows:
        why = "WRONG" if tr == "WRONG" else "GAP_UNJUSTIFIED" if tr == "GAP_UNJUSTIFIED" else "UNEXPLAINED"
        by[cik].append((m, t, k, why))
    res = []
    with ProcessPoolExecutor(8) as ex:
        for r in ex.map(trace_company, sorted(by.items())):
            res += r
    json.dump({"n": len(rows), "companies": len(by), "by_why": collections.Counter(x.get("why") for x in res), "rows": res},
              open(VAL + "/trace.json", "w"), indent=1, default=str)
    print(len(rows), len(by), sum(1 for x in res if "error" in x))
