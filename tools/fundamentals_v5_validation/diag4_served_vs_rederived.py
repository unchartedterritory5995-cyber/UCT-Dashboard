"""SERVED vs RE-DERIVED-AT-t (explain) over (1) EVERY V5 point that differs from V4 and (2) a 30,000-point random
sample of all V5 points; the same check on V4 for the same keys; and for each V5 mismatch a PIT truncation test on the
scratch copy (delete everything the company published after t, rebuild) to decide which value is point-in-time.
The artifact is read-only; truncation runs on validation/cf_copy.db. Writes validation/diag4.json."""
import sys
CODE = "/data/fundamentals_pit_v5/code/7dfda83de6a7"
sys.path.insert(0, CODE)
import collections, json, random, sqlite3, traceback
from concurrent.futures import ProcessPoolExecutor

VAL = "/data/fundamentals_pit_v5/validation"
V5DB, SRC, COPY = "/data/fundamentals_pit_v5/run/v5.db", "/data/fundamentals_pit.db", VAL + "/cf_copy.db"


def check(args):
    cik, pts = args
    from api.services.fundamentals_pit import derive as D, store as S
    v5 = S.connect(V5DB, readonly=True); v4 = S.connect(SRC, readonly=True)
    out = []
    for m, t in pts:
        try:
            e5 = D.explain(v5, cik, m, t, 5)
            has4 = v4.execute("SELECT 1 FROM series_point WHERE cik=? AND metric=? AND derivation_version=4 AND t_eff=?", (cik, m, t)).fetchone()
            e4 = D.explain(v4, cik, m, t, 4) if has4 else None
            out.append([cik, m, t, e5["matches_served"], e5["served"], e5["rederived"], None if e4 is None else e4["matches_served"]])
        except Exception:
            out.append([cik, m, t, "ERROR", traceback.format_exc()[-300:], None, None])
    return out


def trunc(args):
    cik, pts = args
    from api.services.fundamentals_pit import derive as D, store as S
    res = []
    try:
        conn = S.connect(COPY)
        for m, t, served, red in sorted(pts, key=lambda x: -x[1]):       # latest first: each cut removes MORE
            ids = [r[0] for r in conn.execute("SELECT filing_id FROM filing WHERE cik=? AND public_at>?", (cik, t))]
            acc = [r[0] for r in conn.execute("SELECT accn FROM filing WHERE cik=? AND public_at>?", (cik, t))]
            with S.tx(conn):
                for i in range(0, len(ids), 500):
                    ch = ids[i:i + 500]
                    conn.execute(f"DELETE FROM fact WHERE cik=? AND filing_id IN ({','.join('?' * len(ch))})", (cik, *ch))
                for i in range(0, len(acc), 500):
                    ch = acc[i:i + 500]; q = ",".join("?" * len(ch))
                    for tb in ("filing_signal", "signal_check", "filing"):
                        conn.execute(f"DELETE FROM {tb} WHERE accn IN ({q})", ch)
            D.build_company(conn, cik, version=5, force=True)
            r = conn.execute("SELECT v, period_end, method FROM series_point WHERE cik=? AND metric=? AND derivation_version=5 AND t_eff<=? "
                             "ORDER BY t_eff DESC LIMIT 1", (cik, m, t)).fetchone()
            tv = None if r is None else (None if r[2] == "gap" else r[0])
            sv = served["v"] if served else None
            rv = red["v"] if red else None
            close = lambda a, b: a is not None and b is not None and abs(a - b) <= 1e-9 * max(1, abs(a), abs(b))
            res.append({"cik": cik, "metric": m, "t": t, "served": sv, "rederived": rv, "truncated": tv,
                        "verdict": "SERVED_IS_PIT" if close(tv, sv) else "REDERIVED_IS_PIT" if close(tv, rv) else "NEITHER"})
    except Exception:
        res.append({"cik": cik, "error": traceback.format_exc()[-600:]})
    return res


if __name__ == "__main__":
    v5 = sqlite3.connect(f"file:{V5DB}?mode=ro", uri=True)
    dd = sqlite3.connect(f"file:{VAL}/v4v5_diff.db?mode=ro", uri=True)
    diffk = {(c, m, t) for c, m, t in dd.execute("SELECT cik, metric, t_eff FROM diff WHERE v5 != 'null'")}
    allk = v5.execute("SELECT cik, metric, t_eff FROM series_point WHERE derivation_version=5").fetchall()
    rnd = random.Random(20260929)
    samp = set(rnd.sample(allk, 30000))
    keys = diffk | samp
    by = collections.defaultdict(list)
    for c, m, t in keys:
        by[c].append((m, t))
    rows = []
    with ProcessPoolExecutor(10) as ex:
        for r in ex.map(check, sorted(by.items()), chunksize=4):
            rows += r
    mism = [r for r in rows if r[3] is False]
    err = [r for r in rows if r[3] == "ERROR"]
    in_diff = lambda r: (r[0], r[1], r[2]) in diffk
    summary = {"checked": len(rows), "diff_points_checked": sum(1 for r in rows if in_diff(r)),
               "random_checked": sum(1 for r in rows if (r[0], r[1], r[2]) in samp),
               "v5_mismatch_total": len(mism), "v5_mismatch_in_diff": sum(1 for r in mism if in_diff(r)),
               "v5_mismatch_in_random": sum(1 for r in mism if (r[0], r[1], r[2]) in samp),
               "v5_mismatch_random_not_diff": sum(1 for r in mism if (r[0], r[1], r[2]) in samp and not in_diff(r)),
               "v4_mismatch_same_keys": sum(1 for r in rows if r[6] is False),
               "errors": len(err), "by_metric": collections.Counter(r[1] for r in mism),
               "companies": len({r[0] for r in mism})}
    tb = collections.defaultdict(list)
    for r in mism:
        tb[r[0]].append((r[1], r[2], r[4], r[5]))
    tr = []
    with ProcessPoolExecutor(8) as ex:
        for r in ex.map(trunc, sorted(tb.items())):
            tr += r
    summary["truncation_verdicts"] = collections.Counter(x.get("verdict", "ERROR") for x in tr)
    json.dump({"summary": summary, "mismatches": mism[:400], "errors": err[:20], "truncation": tr}, open(VAL + "/diag4.json", "w"), indent=1, default=str)
    print(json.dumps(summary, default=str))
