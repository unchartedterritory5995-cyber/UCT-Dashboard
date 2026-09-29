"""Read-only refined justification of every V4-value -> V5-gap point (all 475, not only the 86 flagged).
Stage 1 matched V5 evidence against the TAG FAMILY of each fact V4 used, but FCF facts carry COMPOSITE tags
("OCF-CapEx") that are in no family, and a gap can also come from evidence on the NEWEST period itself.
Justified (PIT) iff V5-only instance evidence, PUBLIC BY t, on a primitive family touched by the metric either
 (a) overlaps (exactly, tol 0) a fact V4 used (composite tags split into components), or
 (b) overlaps the gap's own newest anchor period window (the period V5 refuses to state).
Writes validation/gapjust2.json only."""
import sys
CODE = "/data/fundamentals_pit_v5/code/7dfda83de6a7"
sys.path.insert(0, CODE)
import collections, datetime as dt, json, sqlite3
from concurrent.futures import ProcessPoolExecutor

VAL = "/data/fundamentals_pit_v5/validation"
V5DB, SRC = "/data/fundamentals_pit_v5/run/v5.db", "/data/fundamentals_pit.db"


def d8(x):
    x = str(x).replace("-", "")
    return dt.date(int(x[:4]), int(x[4:6]), int(x[6:8]))


def ov(s0, e0, ps, pe):
    return d8(s0 or e0) <= d8(pe) and d8(ps or pe) <= d8(e0)


def one(args):
    cik, pts = args
    from api.services.fundamentals_pit import derive as D, store as S
    from api.services.fundamentals_pit.concepts import PRIMITIVES
    from api.services.fundamentals_pit.metrics import METRICS
    FAM = {tg: frozenset(p.tags) for p in PRIMITIVES.values() for tg in p.tags}
    v4 = S.connect(SRC, readonly=True); v5 = S.connect(V5DB, readonly=True)
    pub = dict(v5.execute("SELECT accn, public_at FROM filing WHERE cik=?", (cik,)).fetchall())
    form = dict(v5.execute("SELECT accn, form FROM filing WHERE cik=?", (cik,)).fetchall())
    sig = lambda c: {(a, t, str(s), str(e), k) for a, t, s, e, k in c.execute(
        "SELECT s.accn, s.tag, s.period_start, s.period_end, s.kind FROM filing_signal s JOIN filing f ON f.accn=s.accn WHERE f.cik=?", (cik,))}
    only5 = sig(v5) - sig(v4)
    res = []
    for metric, t in pts:
        e4 = D.explain(v4, cik, metric, t, 4)
        served = v5.execute("SELECT period_end FROM series_point WHERE cik=? AND metric=? AND derivation_version=5 AND t_eff=?",
                            (cik, metric, t)).fetchone()
        anchor = METRICS[metric][1]
        anchor_fam = frozenset(PRIMITIVES[anchor].tags) if anchor in PRIMITIVES else frozenset()
        ev = [e for e in only5 if pub.get(e[0], 1e18) <= t]
        how = None
        for f in e4["facts"]:
            if not f.get("period_end"):
                continue
            fam = set()
            for comp in f["tag"].split("-"):
                fam |= FAM.get(comp, {comp})
            if any(e[1] in fam and ov(e[2], e[3], f.get("period_start"), f["period_end"]) for e in ev):
                how = "evidence_on_fact_v4_used"; break
        if how is None and served:
            pe = d8(served[0]); lo = pe - dt.timedelta(days=370)
            if any(e[1] in anchor_fam | {tg for f in e4["facts"] for c in f["tag"].split("-") for tg in FAM.get(c, {c})}
                   and d8(e[3]) >= lo for e in ev):
                how = "evidence_on_newest_period_window"
        rec = {"cik": cik, "metric": metric, "t": t, "day": dt.datetime.utcfromtimestamp(t).date().isoformat(), "how": how or "UNJUSTIFIED",
               "v4": e4["served"], "gap_period": served[0] if served else None,
               "v5_only_evidence_by_t": len(ev),
               "nearest_evidence": sorted([list(e) + [form.get(e[0]), dt.datetime.utcfromtimestamp(pub[e[0]]).date().isoformat()] for e in ev],
                                          key=lambda e: e[-1])[-4:]}
        res.append(rec)
    return res


if __name__ == "__main__":
    dd = sqlite3.connect(f"file:{VAL}/v4v5_diff.db?mode=ro", uri=True)
    rows = dd.execute("SELECT cik, metric, t_eff FROM diff WHERE kind='v4value_to_v5gap'").fetchall()
    by = collections.defaultdict(list)
    for cik, m, t in rows:
        by[cik].append((m, t))
    out = []
    with ProcessPoolExecutor(8) as ex:
        for r in ex.map(one, sorted(by.items())):
            out += r
    cnt = collections.Counter(r["how"] for r in out)
    json.dump({"n": len(out), "counts": cnt, "unjustified": [r for r in out if r["how"] == "UNJUSTIFIED"], "rows": out},
              open(VAL + "/gapjust2.json", "w"), indent=1, default=str)
    print(json.dumps({"n": len(out), "counts": cnt}))
