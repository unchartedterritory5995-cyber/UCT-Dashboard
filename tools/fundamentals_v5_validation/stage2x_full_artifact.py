"""POST-GRIND STAGE 2X (runner, pinned V5 code): FULL-ARTIFACT checks that complement the established stage 2.
  A. invariants over EVERY V5 point (source-time no-lookahead, provenance, chronology, no-regress, gaps, finiteness)
  B. determinism: re-derive ALL companies on a COPY and compare every stored column
  C. PIT prefix-truncation: on the copy, delete everything a company published after a cutoff T, rebuild,
     and require the truncated series to equal the full series up to T (nothing later can move the past)
  D. gap reproduction: explain() a stratified sample of gaps (the gap must reproduce from raw truth at t)
The V5 store itself is opened READ-ONLY; all rebuilding happens on validation/stage2x_copy.db."""
import sys
CODE = "/data/fundamentals_pit_v5/code/7dfda83de6a7"
sys.path.insert(0, CODE)
import collections, datetime as dt, hashlib, json, math, os, random, sqlite3, time, traceback
from concurrent.futures import ProcessPoolExecutor

ROOT = "/data/fundamentals_pit_v5"; RUN = ROOT + "/run"; VAL = ROOT + "/validation"
V5DB, SRC = RUN + "/v5.db", "/data/fundamentals_pit.db"
COPY = VAL + "/stage2x_copy.db"
rep = {"stage": "2x", "started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}


def save():
    json.dump(rep, open(VAL + "/stage2x.json", "w"), indent=1, default=str)


def ro(p):
    return sqlite3.connect(f"file:{p}?mode=ro", uri=True, timeout=60)


def day(t):
    return dt.datetime.utcfromtimestamp(t).date()


def d8(x):
    x = str(x)
    return dt.date(int(x[:4]), int(x[4:6]), int(x[6:8]))


def full_rows(conn, cik=None):
    q = ("SELECT cik, metric, derivation_version, t_eff, v, period_end, method, sources FROM series_point "
         "WHERE derivation_version=5" + (" AND cik=?" if cik is not None else "") + " ORDER BY cik, metric, t_eff")
    return conn.execute(q, (cik,) if cik is not None else ()).fetchall()


# ---------------------------------------------------------------- A. invariants
def inv_one(cik):
    c = ro(V5DB)
    fil = {a: (p, f) for a, p, f in c.execute("SELECT accn, public_at, form FROM filing WHERE cik=?", (cik,))}
    pubs = {p for p, _ in fil.values()}
    r = collections.Counter(); ex = collections.defaultdict(list)
    last = {}
    for _, m, _, t, v, pe, meth, src in full_rows(c, cik):
        r["points"] += 1
        gap = meth == "gap"
        accns = [a for a in src.split(",") if a]
        prev = last.get(m)
        if d8(pe) >= day(t):
            r["PERIOD_NOT_ENDED_BY_T"] += 1; ex["PERIOD_NOT_ENDED_BY_T"].append([cik, m, t, pe])
        if t not in pubs:
            r["t_eff_not_a_filing_public_at"] += 1; ex["t_eff_not_a_filing_public_at"].append([cik, m, t, pe, meth])
        if prev and pe < prev[1]:
            r["PERIOD_REGRESSED"] += 1; ex["PERIOD_REGRESSED"].append([cik, m, t, pe, prev[1]])
        if gap:
            r["gaps"] += 1
            if accns:
                r["GAP_WITH_SOURCES"] += 1; ex["GAP_WITH_SOURCES"].append([cik, m, t])
            if prev is None:
                r["GAP_AS_FIRST_POINT"] += 1; ex["GAP_AS_FIRST_POINT"].append([cik, m, t, pe])
            elif pe <= prev[1]:     # series.py: a gap closes a NEWER filed period, once per period
                r["GAP_NOT_NEWER_THAN_PREVIOUS"] += 1; ex["GAP_NOT_NEWER_THAN_PREVIOUS"].append([cik, m, t, pe, prev[1], prev[2]])
            r["gap_after_gap" if prev and prev[2] == "gap" else "gap_after_value"] += 1
        else:
            if not math.isfinite(v):
                r["NONFINITE_VALUE"] += 1; ex["NONFINITE_VALUE"].append([cik, m, t, v])
            if not accns:
                r["VALUE_WITHOUT_SOURCES"] += 1; ex["VALUE_WITHOUT_SOURCES"].append([cik, m, t])
            for a in accns:
                if a not in fil:
                    r["SOURCE_NOT_A_FILING_OF_CIK"] += 1; ex["SOURCE_NOT_A_FILING_OF_CIK"].append([cik, m, t, a])
                elif fil[a][0] > t:
                    r["LOOKAHEAD_SOURCE_AFTER_T"] += 1; ex["LOOKAHEAD_SOURCE_AFTER_T"].append([cik, m, t, a, fil[a][0]])
                else:
                    r["source_refs_ok"] += 1
            if prev and prev[1] == pe and (prev[0] == v or abs(prev[0] - v) <= 1e-9 * max(1.0, abs(v), abs(prev[0]))) and prev[2] != "gap":
                r["REDUNDANT_REPEAT_POINT"] += 1; ex["REDUNDANT_REPEAT_POINT"].append([cik, m, t, pe])
            if prev and prev[2] == "gap" and pe == prev[1]:
                r["value_fills_gap_period"] += 1
        last[m] = (v, pe, meth)
    c.close()
    return cik, r, {k: v[:5] for k, v in ex.items()}


# ---------------------------------------------------------------- C. prefix truncation
def prefix_one(args):
    cik, T = args
    from api.services.fundamentals_pit import derive as D, store as S
    try:
        conn = S.connect(COPY)
        ids = [r[0] for r in conn.execute("SELECT filing_id FROM filing WHERE cik=? AND public_at>?", (cik, T))]
        acc = [r[0] for r in conn.execute("SELECT accn FROM filing WHERE cik=? AND public_at>?", (cik, T))]
        with S.tx(conn):
            for i in range(0, len(ids), 500):
                chunk = ids[i:i + 500]
                conn.execute(f"DELETE FROM fact WHERE cik=? AND filing_id IN ({','.join('?' * len(chunk))})", (cik, *chunk))
            for i in range(0, len(acc), 500):
                chunk = acc[i:i + 500]; q = ",".join("?" * len(chunk))
                for tb in ("filing_signal", "signal_check", "filing"):
                    conn.execute(f"DELETE FROM {tb} WHERE accn IN ({q})", chunk)
        D.build_company(conn, cik, version=5, force=True)
        trunc = [r[1:] for r in full_rows(conn, cik)]
        conn.close()
        c = ro(V5DB)
        full = [r[1:] for r in full_rows(c, cik) if r[3] <= T]
        c.close()
        ok = trunc == full
        diff = []
        if not ok:
            a = {(r[0], r[2]): r for r in full}; b = {(r[0], r[2]): r for r in trunc}
            diff = [[k, a.get(k), b.get(k)] for k in sorted(set(a) | set(b)) if a.get(k) != b.get(k)][:5]
        return {"cik": cik, "T": T, "removed_filings": len(acc), "prefix_points": len(full), "ok": ok, "diff": diff}
    except Exception:
        return {"cik": cik, "T": T, "error": traceback.format_exc()[-800:]}


if __name__ == "__main__":
    t0 = time.time()
    v5 = ro(V5DB)
    ciks = [r[0] for r in v5.execute("SELECT cik FROM series_build WHERE derivation_version=5 ORDER BY cik")]
    stage0 = json.load(open(VAL + "/stage0.json"))

    # A
    tot, exs = collections.Counter(), collections.defaultdict(list)
    per_co = {}
    with ProcessPoolExecutor(8) as ex:
        for cik, r, e in ex.map(inv_one, ciks, chunksize=16):
            tot.update(r); per_co[cik] = r
            for k, v in e.items():
                if len(exs[k]) < 25:
                    exs[k] += v[:25 - len(exs[k])]
    hard = ["PERIOD_NOT_ENDED_BY_T", "PERIOD_REGRESSED", "GAP_WITH_SOURCES", "NONFINITE_VALUE", "VALUE_WITHOUT_SOURCES",
            "SOURCE_NOT_A_FILING_OF_CIK", "LOOKAHEAD_SOURCE_AFTER_T", "GAP_AS_FIRST_POINT", "GAP_NOT_NEWER_THAN_PREVIOUS",
            "REDUNDANT_REPEAT_POINT"]
    rep["A_invariants"] = {"counts": dict(tot), "examples": dict(exs), "hard": {k: tot.get(k, 0) for k in hard},
                           "PASS": all(tot.get(k, 0) == 0 for k in hard) and tot["points"] == stage0["derive"]["points"],
                           "elapsed_s": round(time.time() - t0)}
    # gap population breakdowns
    g = rep["A_invariants"]["gaps"] = {}
    g["by_year"] = dict(v5.execute("SELECT strftime('%Y', t_eff, 'unixepoch') y, count(*) FROM series_point "
                                   "WHERE derivation_version=5 AND method='gap' GROUP BY y").fetchall())
    g["by_metric"] = dict(v5.execute("SELECT metric, count(*) FROM series_point WHERE derivation_version=5 AND method='gap' GROUP BY 1").fetchall())
    gc = [per_co[c]["gaps"] for c in ciks]
    pc = [per_co[c]["points"] for c in ciks]
    g["companies_with_gaps"] = sum(1 for x in gc if x)
    g["gaps_per_company_pctl"] = {p: sorted(gc)[min(len(gc) - 1, int(len(gc) * p / 100))] for p in (50, 90, 99, 100)}
    g["gap_share_per_company_pctl"] = {p: round(sorted((a / b) if b else 0 for a, b in zip(gc, pc))[min(len(gc) - 1, int(len(gc) * p / 100))], 4)
                                       for p in (50, 90, 99, 100)}
    g["top_companies"] = sorted(([c, per_co[c]["gaps"], per_co[c]["points"]] for c in ciks), key=lambda x: -x[1])[:25]
    s4 = ro(SRC)
    g["v4_gaps_by_metric"] = dict(s4.execute("SELECT metric, count(*) FROM series_point WHERE derivation_version=4 AND method='gap' GROUP BY 1").fetchall())
    g["v4_gaps"] = sum(g["v4_gaps_by_metric"].values())
    s4.close()
    save()

    # B. determinism on a COPY
    t1 = time.time()
    if os.path.exists(COPY):
        os.remove(COPY)
    src = ro(V5DB); dst = sqlite3.connect(COPY); src.backup(dst); dst.close(); src.close()
    from api.services.fundamentals_pit import v5_rebuild as R
    failed = []
    with ProcessPoolExecutor(8) as ex:
        for r in ex.map(R._derive_one, [(COPY, c) for c in ciks], chunksize=8):
            if r.get("error"):
                failed.append([r["cik"], r["error"][-300:]])
    h_orig, h_copy = hashlib.sha256(), hashlib.sha256()
    c1, c2 = ro(V5DB), ro(COPY)
    n1 = n2 = 0
    for r in full_rows(c1):
        h_orig.update(repr(r).encode()); n1 += 1
    for r in full_rows(c2):
        h_copy.update(repr(r).encode()); n2 += 1
    ih1 = dict(c1.execute("SELECT cik, input_hash FROM series_build WHERE derivation_version=5").fetchall())
    ih2 = dict(c2.execute("SELECT cik, input_hash FROM series_build WHERE derivation_version=5").fetchall())
    c1.close(); c2.close()
    rep["B_determinism"] = {"rebuilt": len(ciks) - len(failed), "failed": failed[:10], "points_orig": n1, "points_rebuilt": n2,
                            "digest_orig": h_orig.hexdigest(), "digest_rebuilt": h_copy.hexdigest(),
                            "input_hashes_equal": ih1 == ih2,
                            "digest_equals_stage0": h_orig.hexdigest() == stage0["v5_logical"]["full_digest_with_sources"],
                            "PASS": not failed and n1 == n2 and h_orig.hexdigest() == h_copy.hexdigest() and ih1 == ih2,
                            "elapsed_s": round(time.time() - t1)}
    save()

    # C. PIT prefix truncation (on the same copy, which B proved equals the original)
    t2 = time.time()
    rnd = random.Random(20260929)
    GOLD = {1341766: ["2022-05-10", "2022-08-09", "2023-03-01"], 1318605: ["2025-04-23", "2025-07-24"], 1639438: ["2024-03-01"],
            1045810: ["2024-06-10"], 19617: ["2020-01-15"], 320193: ["2010-08-01"], 789019: ["2023-08-01"], 21344: ["2021-10-27"]}
    cc = ro(V5DB)
    jobs = []
    for cik in GOLD:            # a golden cutoff = the last filing public BY the end of that day (so the day's filing is kept)
        d = GOLD[cik][0]
        T = cc.execute("SELECT max(public_at) FROM filing WHERE cik=? AND public_at < strftime('%s', ?, '+1 day')", (cik, d)).fetchone()[0]
        if T:
            jobs.append((cik, T))
    pool = [c for c in ciks if c not in GOLD]
    for cik in rnd.sample(pool, min(1500, len(pool))):
        pubs = [r[0] for r in cc.execute("SELECT DISTINCT public_at FROM filing WHERE cik=? ORDER BY 1", (cik,))]
        if len(pubs) >= 3:
            jobs.append((cik, pubs[rnd.randrange(1, len(pubs) - 1)]))   # never the last filing: something must be cut
    cc.close()
    res = []
    with ProcessPoolExecutor(6) as ex:
        for r in ex.map(prefix_one, jobs, chunksize=4):
            res.append(r)
    bad = [r for r in res if not r.get("ok")]
    rep["C_prefix_truncation"] = {"n": len(res), "ok": sum(1 for r in res if r.get("ok")), "errors": sum(1 for r in res if r.get("error")),
                                  "removed_filings_total": sum(r.get("removed_filings", 0) for r in res),
                                  "prefix_points_total": sum(r.get("prefix_points", 0) for r in res),
                                  "goldens": [r for r in res if r["cik"] in GOLD],
                                  "failures": bad[:40], "PASS": not bad, "elapsed_s": round(time.time() - t2)}
    save()

    # D. gap reproduction from raw truth (explain on the ORIGINAL, read-only)
    t3 = time.time()
    from api.services.fundamentals_pit import derive as D
    rnd = random.Random(20260930)
    allg = v5.execute("SELECT cik, metric, t_eff FROM series_point WHERE derivation_version=5 AND method='gap'").fetchall()
    samp = rnd.sample(allg, min(1500, len(allg)))
    out = collections.Counter(); fails = []
    for cik, m, t in samp:
        try:
            r = D.explain(v5, cik, m, t, 5)
            out["reproduced" if r["matches_served"] else "NOT_REPRODUCED"] += 1
            if not r["matches_served"] and len(fails) < 30:
                fails.append([cik, m, t, r.get("rederived")])
        except Exception:
            out["ERROR"] += 1
            if len(fails) < 30:
                fails.append([cik, m, t, traceback.format_exc()[-300:]])
    rep["D_gap_reproduction"] = {"sampled": len(samp), "of": len(allg), **out, "failures": fails,
                                 "PASS": out["reproduced"] == len(samp), "elapsed_s": round(time.time() - t3)}
    v5.close()
    rep["PASS"] = all(rep[k]["PASS"] for k in ("A_invariants", "B_determinism", "C_prefix_truncation", "D_gap_reproduction"))
    rep["finished"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    save()
    print(json.dumps({k: (v.get("PASS") if isinstance(v, dict) else v) for k, v in rep.items()}, default=str))
