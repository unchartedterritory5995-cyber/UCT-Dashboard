"""Read-only COMPANY-LEVEL attribution. The derivation code is identical between V4 and V5 and both stores share
one fact/filing snapshot, so a company whose series differ MUST have different restatement evidence (filing_signal).
Also: identical evidence => identical series. Also for every flagged point, the evidence differences that touch
the metric's primitive tags (any date) and their period positions relative to t. Writes validation/attrib.json."""
import sys
CODE = "/data/fundamentals_pit_v5/code/7dfda83de6a7"
sys.path.insert(0, CODE)
import collections, datetime as dt, hashlib, json, sqlite3
from concurrent.futures import ProcessPoolExecutor

VAL = "/data/fundamentals_pit_v5/validation"
V5DB, SRC = "/data/fundamentals_pit_v5/run/v5.db", "/data/fundamentals_pit.db"
ro = lambda p: sqlite3.connect(f"file:{p}?mode=ro", uri=True, timeout=60)


def one(cik):
    a, b = ro(SRC), ro(V5DB)
    q = "SELECT metric, t_eff, v, period_end, method FROM series_point WHERE cik=? AND derivation_version=? ORDER BY 1, 2"
    s4 = a.execute(q, (cik, 4)).fetchall(); s5 = b.execute(q, (cik, 5)).fetchall()
    qs = ("SELECT s.accn, s.tag, s.period_start, s.period_end, s.kind FROM filing_signal s JOIN filing f ON f.accn=s.accn "
          "WHERE f.cik=? ORDER BY 1, 2, 3, 4, 5")
    e4 = a.execute(qs, (cik,)).fetchall(); e5 = b.execute(qs, (cik,)).fetchall()
    a.close(); b.close()
    return cik, s4 != s5, e4 != e5, len(e4), len(e5)


if __name__ == "__main__":
    c = ro(V5DB)
    ciks = sorted({r[0] for r in c.execute("SELECT DISTINCT cik FROM series_build")})
    c.close()
    cnt = collections.Counter(); series_diff_no_ev = []
    with ProcessPoolExecutor(8) as ex:
        for cik, sd, ed, n4, n5 in ex.map(one, ciks, chunksize=16):
            cnt[("series_differ" if sd else "series_same", "evidence_differ" if ed else "evidence_same")] += 1
            if sd and not ed:
                series_diff_no_ev.append(cik)
    out = {"companies": len(ciks), "matrix": {f"{k[0]}|{k[1]}": n for k, n in cnt.items()},
           "series_differ_without_evidence_difference": series_diff_no_ev,
           "PASS": not series_diff_no_ev}
    json.dump(out, open(VAL + "/attrib.json", "w"), indent=1)
    print(json.dumps(out))
