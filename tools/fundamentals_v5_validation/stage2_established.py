"""POST-GRIND STAGE 2 (pinned V5 code): goldens, no-lookahead, full/incremental parity, idempotency.
The parity/idempotency work runs on a COPY of the V5 store; the V5 store itself is read-only here."""
import sys
CODE = "/data/fundamentals_pit_v5/code/7dfda83de6a7"
sys.path.insert(0, CODE)
import os, datetime as dt, json, random, sqlite3, time, traceback, zipfile
from api.services.fundamentals_pit import derive as D, incremental as INC, ingest as I, store as S

RUN = "/data/fundamentals_pit_v5/run"
OUT = "/data/fundamentals_pit_v5/validation"
V5DB = f"{RUN}/v5.db"
PROD = "/data/fundamentals_pit.db"
os.makedirs(OUT, exist_ok=True)
rep = {"started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
T = lambda iso: dt.datetime.fromisoformat(iso).replace(tzinfo=dt.timezone.utc).timestamp()


def save():
    json.dump(rep, open(f"{OUT}/stage2.json", "w"), indent=1, default=str)


def rows(c, cik, v, metric=None):
    q = "SELECT metric, t_eff, v, period_end, method FROM series_point WHERE cik=? AND derivation_version=?"
    a = (cik, v)
    if metric:
        q += " AND metric=?"; a += (metric,)
    return c.execute(q + " ORDER BY metric, t_eff", a).fetchall()


def at(pts, t):
    cur = None
    for p in pts:
        if p[1] <= t:
            cur = p
    return cur


v5 = S.connect(V5DB, readonly=True)
prod = S.connect(PROD, readonly=True)
G = {"TSLA": 1318605, "CELH": 1341766, "CAVA": 1639438, "NVDA": 1045810, "JPM": 19617, "AAPL": 320193, "MSFT": 789019, "KO": 21344}
g = {}
# CELH
pub = dict(v5.execute("SELECT accn, public_at FROM filing WHERE cik=?", (G["CELH"],)).fetchall())
q122 = v5.execute("SELECT public_at FROM filing WHERE cik=? AND form='10-Q' AND filing_date=20220510", (G["CELH"],)).fetchone()[0]
q222 = v5.execute("SELECT public_at FROM filing WHERE cik=? AND form='10-Q' AND filing_date=20220809", (G["CELH"],)).fetchone()[0]
ni = rows(v5, G["CELH"], 5, "net_income_ttm")
p1, p2 = at(ni, q122), at(ni, q222)
nq = rows(v5, G["CELH"], 5, "net_income_q")
bad_q4 = [p for p in nq if p[4] != "gap" and abs(p[2] - (3937273 - 7291559)) < 5000]
g["CELH"] = {"2022-05-10": p1, "2022-08-09": p2, "invalid_q4_points": bad_q4,
             "PASS": bool(p1 and p1[4] != "gap" and abs(p1[2] - 10.03e6) < 0.02e6 and p2 and p2[4] == "gap" and not bad_q4)}
# TSLA
tg = {}
for m in ("eps_diluted_ttm", "net_margin_ttm", "roe_ttm", "net_income_ttm"):
    gaps5 = [dt.datetime.utcfromtimestamp(p[1]).date().isoformat() for p in rows(v5, G["TSLA"], 5, m) if p[4] == "gap" and "2025-04-01" <= dt.datetime.utcfromtimestamp(p[1]).date().isoformat() <= "2025-12-31"]
    gaps4 = [dt.datetime.utcfromtimestamp(p[1]).date().isoformat() for p in rows(prod, G["TSLA"], 4, m) if p[4] == "gap" and "2025-04-01" <= dt.datetime.utcfromtimestamp(p[1]).date().isoformat() <= "2025-12-31"]
    tg[m] = {"v5": gaps5, "v4": gaps4}
g["TSLA"] = {"gaps": tg, "PASS": all(set(["2025-04-23", "2025-07-24", "2025-10-23"]) <= set(x["v5"]) and x["v5"] == x["v4"] for x in tg.values())}
# others: v5 vs v4 difference count, plus the accepted member-facing checks
for name in ("AAPL", "NVDA", "JPM", "CAVA", "MSFT", "KO"):
    a4 = {(m, t): (v, pe, me) for m, t, v, pe, me in rows(prod, G[name], 4)}
    b5 = {(m, t): (v, pe, me) for m, t, v, pe, me in rows(v5, G[name], 5)}
    diff = sorted(k for k in set(a4) | set(b5) if a4.get(k) != b5.get(k))
    g[name] = {"v4_points": len(a4), "v5_points": len(b5), "differences": len(diff),
               "diff_sample": [[m, dt.datetime.utcfromtimestamp(t).date().isoformat(), a4.get((m, t)), b5.get((m, t))] for m, t in diff[:6]]}
g["JPM"]["gross_margin_points_v5"] = len(rows(v5, G["JPM"], 5, "gross_margin_ttm"))
g["CAVA"]["first_point_v5"] = dt.datetime.utcfromtimestamp(min(p[1] for p in rows(v5, G["CAVA"], 5))).date().isoformat()
eps = [p for p in rows(v5, G["NVDA"], 5, "eps_diluted_ttm") if p[4] != "gap" and "2024-01-01" <= dt.datetime.utcfromtimestamp(p[1]).date().isoformat() <= "2024-12-31"]
g["NVDA"]["eps_2024_jumps"] = [[dt.datetime.utcfromtimestamp(b[1]).date().isoformat(), a[2], b[2]] for a, b in zip(eps, eps[1:]) if not (0.5 < b[2] / a[2] < 2)]
rep["goldens"] = g
save()

# no-lookahead / provenance: 1,000 random V5 points + 500 V5 points that differ from V4
rnd = random.Random(20260926)
allc = [r[0] for r in v5.execute("SELECT DISTINCT cik FROM series_point WHERE derivation_version=5")]
sample, changed = [], []
for cik in rnd.sample(allc, min(600, len(allc))):
    b5 = rows(v5, cik, 5)
    if not b5:
        continue
    sample += [(cik, m, t) for m, t, *_ in rnd.sample(b5, min(2, len(b5)))]
    a4 = {(m, t): (v, pe, me) for m, t, v, pe, me in rows(prod, cik, 4)}
    changed += [(cik, m, t) for m, t, v, pe, me in b5 if a4.get((m, t)) != (v, pe, me)]
sample = sample[:1000] + rnd.sample(changed, min(500, len(changed)))
prov = {"n": 0, "matches": 0, "lookahead": 0, "fail": []}
for cik, m, t in sample:
    r = D.explain(v5, cik, m, t, 5, ("massive",))
    when = dt.datetime.fromtimestamp(t, dt.timezone.utc).isoformat()
    look = [f for f in r["facts"] if f.get("public_at") and f["public_at"] > when]
    prov["n"] += 1; prov["matches"] += bool(r["matches_served"]); prov["lookahead"] += bool(look)
    if not r["matches_served"] or look:
        prov["fail"].append([cik, m, when, r["matches_served"], look[:2]])
prov["fail"] = prov["fail"][:30]
rep["provenance"] = prov
save()

# full vs incremental parity + idempotency, on a COPY
PDB = f"{OUT}/parity_copy.db"
if os.path.exists(PDB):
    os.remove(PDB)
src = sqlite3.connect(f"file:{V5DB}?mode=ro", uri=True); dst = sqlite3.connect(PDB); src.backup(dst); dst.close(); src.close()
conn = S.connect(PDB)
cfz = zipfile.ZipFile("/data/fundamentals_pit_work/companyfacts.zip")
subz = zipfile.ZipFile("/data/fundamentals_pit_work/submissions.zip"); subn = set(subz.namelist())
recent = [r[0] for r in v5.execute(
    "SELECT DISTINCT f.cik FROM filing_signal s JOIN filing f ON f.accn=s.accn WHERE f.public_at > strftime('%s','2024-06-01')")]
recent = sorted(set(recent) & set(allc))
pick = list(G.values()) + [c for c in rnd.sample(recent, min(60, len(recent))) if c not in G.values()][:32]
par = []
for cik in pick:
    r = {"cik": cik}
    try:
        name = f"CIK{cik:010d}.json"
        doc = json.loads(cfz.read(name)); main = json.loads(subz.read(name))
        pages = [main["filings"]["recent"]] + [json.loads(subz.read(f["name"])) for f in main["filings"].get("files", []) if f["name"] in subn]
        full_series = rows(conn, cik, 5)
        since = {G["CELH"]: "2022-01-01", G["TSLA"]: "2025-01-01"}.get(cik)
        with_facts = {x[0] for x in conn.execute("SELECT DISTINCT filing_id FROM fact WHERE cik=?", (cik,))}
        fl = conn.execute("SELECT filing_id, accn, public_at FROM filing WHERE cik=? ORDER BY public_at DESC", (cik,)).fetchall()
        fl = [x for x in fl if x[0] in with_facts]
        rb = [x for x in fl if since and x[2] >= T(since + "T00:00:00")] if since else fl[:3]
        ids, accns = [x[0] for x in rb], [x[1] for x in rb]
        q = ",".join("?" * len(accns))
        full_ev = sorted(conn.execute(f"SELECT accn, tag, period_start, period_end, kind FROM filing_signal WHERE accn IN ({q})", accns).fetchall())
        with S.tx(conn):
            conn.execute(f"DELETE FROM fact WHERE cik=? AND filing_id IN ({','.join('?' * len(ids))})", (cik, *ids))
            for tb in ("filing_signal", "signal_check", "filing"):
                conn.execute(f"DELETE FROM {tb} WHERE accn IN ({q})", accns)
            conn.execute("DELETE FROM ingest_state WHERE cik=?", (cik,))
        I.ingest_company(conn, cik, doc, main, pages)
        INC.check_signals(conn, cik)                        # THE incremental evidence path (fresh SEC fetch)
        D.build_company(conn, cik, version=5, force=True)
        inc_ev = sorted(conn.execute(f"SELECT accn, tag, period_start, period_end, kind FROM filing_signal WHERE accn IN ({q})", accns).fetchall())
        inc_series = rows(conn, cik, 5)
        # idempotency: the same refresh again
        n_sig = conn.execute("SELECT count(*) FROM filing_signal").fetchone()[0]
        st2 = I.ingest_company(conn, cik, doc, main, pages)
        s2 = INC.check_signals(conn, cik)
        b2 = D.build_company(conn, cik, version=5)
        r.update({"rolled_back": len(accns), "evidence_parity": inc_ev == full_ev, "series_parity": inc_series == full_series,
                  "gap_parity": [p for p in inc_series if p[4] == "gap"] == [p for p in full_series if p[4] == "gap"],
                  "t_eff_parity": [p[:2] for p in inc_series] == [p[:2] for p in full_series],
                  "idempotent": bool(st2.get("skipped") and s2 == 0 and b2.get("skipped") and rows(conn, cik, 5) == inc_series
                                     and conn.execute("SELECT count(*) FROM filing_signal").fetchone()[0] == n_sig)})
        if not r["series_parity"]:
            a = {(m, t): (v, pe, me) for m, t, v, pe, me in full_series}; b = {(m, t): (v, pe, me) for m, t, v, pe, me in inc_series}
            r["diff"] = [[m, t, a.get((m, t)), b.get((m, t))] for m, t in sorted(set(a) | set(b)) if a.get((m, t)) != b.get((m, t))][:5]
    except Exception:
        r["error"] = traceback.format_exc()[-800:]
    par.append(r)
    rep["parity"] = {"n": len(par), "evidence": sum(1 for x in par if x.get("evidence_parity")),
                     "series": sum(1 for x in par if x.get("series_parity")), "gaps": sum(1 for x in par if x.get("gap_parity")),
                     "t_eff": sum(1 for x in par if x.get("t_eff_parity")), "idempotent": sum(1 for x in par if x.get("idempotent")),
                     "errors": sum(1 for x in par if x.get("error")), "rows": par}
    save()
rep["finished"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
save()
print(json.dumps({"goldens": {k: v.get("PASS", v.get("differences")) for k, v in g.items()}, "provenance": {k: prov[k] for k in ("n", "matches", "lookahead")},
                  "parity": {k: v for k, v in rep["parity"].items() if k != "rows"}}, default=str))
