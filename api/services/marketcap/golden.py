"""Golden-case acceptance over one build (Gate K). Every check is explicit and prints its evidence.

    python -m api.services.marketcap.golden --build B.db --data C:/mcapdata --out golden.json
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import date


def _i(s: str) -> int:
    return int(s.replace("-", ""))


class G:
    def __init__(self, build: str, data: str):
        self.db = sqlite3.connect(build)
        self.px = sqlite3.connect(f"{data}/prices.db")
        self.inp = sqlite3.connect(f"{data}/inputs.db")
        self.results = []

    def cik(self, ticker):
        r = self.db.execute("SELECT cik FROM ticker_map WHERE ticker=? ORDER BY start DESC LIMIT 1", (ticker,)).fetchone()
        return r[0] if r else None

    def cov(self, cik):
        r = self.db.execute("SELECT * FROM coverage WHERE cik=?", (cik,)).fetchone()
        if not r:
            return None
        cols = [d[0] for d in self.db.execute("SELECT * FROM coverage LIMIT 0").description]
        return dict(zip(cols, r))

    def cap(self, cik, d):
        r = self.db.execute("SELECT cap FROM cap_daily WHERE cik=? AND d=?", (cik, _i(d))).fetchone()
        return r[0] if r else None

    def cap_near(self, cik, d, after=True):
        op, order = (">=", "ASC") if after else ("<=", "DESC")
        return self.db.execute(f"SELECT d, cap FROM cap_daily WHERE cik=? AND d {op} ? ORDER BY d {order} LIMIT 1", (cik, _i(d))).fetchone()

    def close(self, t, d):
        r = self.px.execute("SELECT c FROM bar WHERE ticker=? AND d=?", (t, _i(d))).fetchone()
        return r[0] if r else None

    def gaps(self, cik):
        return self.db.execute("SELECT start, end, reason, n_days FROM gap_run WHERE cik=? ORDER BY start", (cik,)).fetchall()

    def check(self, case, name, ok, evidence):
        self.results.append({"case": case, "check": name, "pass": bool(ok), "evidence": evidence})


def run(build: str, data: str) -> list:
    g = G(build, data)

    # ARM: Arm Holdings from its listing, IPO evidence, no ArvinMeritor, no 200-day lapse
    c = g.cik("ARM")
    if c:
        cv = g.cov(c)
        pre = g.db.execute("SELECT COUNT(*) FROM cap_daily WHERE cik=? AND d < 20230914", (c,)).fetchone()[0]
        g.check("ARM", "no value before 2023-09-14 (ArvinMeritor era refused)", pre == 0, {"values_before": pre})
        g.check("ARM", "listing start 2023-09-14", cv and cv["listing_start"] == "2023-09-14", cv and cv["listing_start"])
        g.check("ARM", "first value within 5 trading days of listing (IPO prospectus)", cv and cv["first_value"] and cv["first_value"] <= "2023-09-21",
                cv and cv["first_value"])
        g.check("ARM", "zero internal gaps (no 200-day lapse)", cv and cv["internal_gap_days"] == 0, cv and cv["internal_gap_days"])
        g.check("ARM", "pre-listing days coded TICKER_REUSE", any(r[2] == "TICKER_REUSE_DIFFERENT_ISSUER" for r in g.gaps(c)), g.gaps(c)[:3])
    # old domestic issuers: evidence starts pre-XBRL, no internal gaps
    for t, lo in (("AMD", "1997-01-01"), ("MU", "1997-01-01"), ("AAPL", "1997-01-01"), ("KO", "1997-01-01"), ("NVDA", "1999-12-31")):
        c = g.cik(t)
        cv = g.cov(c) if c else None
        g.check(t, f"first value on/before {lo} (pre-XBRL text evidence)", cv and cv["first_value"] and cv["first_value"] <= lo, cv and cv["first_value"])
        g.check(t, "zero internal gaps", cv and cv["internal_gap_days"] == 0, cv and (cv["internal_gap_days"], cv["reasons"]))
    # split continuity: NVDA 10:1 2024-06-10, GE 1:8 reverse 2021-08-02, AAPL 4:1 2020-08-31
    for t, pre_d, post_d in (("NVDA", "2024-06-07", "2024-06-10"), ("GE", "2021-07-30", "2021-08-02"), ("AAPL", "2020-08-28", "2020-08-31")):
        c = g.cik(t)
        if not c:
            g.check(t, "split continuity", False, "ticker not in build")
            continue
        a, b = g.cap(c, pre_d), g.cap(c, post_d)
        pa, pb = g.close(t, pre_d), g.close(t, post_d)
        ok = a and b and pa and pb and abs((b / a) / (pb / pa) - 1) < 0.02
        g.check(t, f"split {post_d}: cap ratio == price ratio (no discontinuity)", ok, {"cap": [a, b], "close": [pa, pb]})
        # and across the first post-split share-state change
        after = g.db.execute("SELECT start, shares FROM state_run WHERE issuer_id=? AND start > ? ORDER BY start LIMIT 1", (f"cik:{c}", post_d)).fetchone()
        before = g.db.execute("SELECT start, shares FROM state_run WHERE issuer_id=? AND start <= ? ORDER BY start DESC LIMIT 1", (f"cik:{c}", post_d)).fetchone()
        if after and before:
            g.check(t, "first post-split state within 25% of the pre-split state (today's basis)", 0.8 <= after[1] / before[1] <= 1.25,
                    {"before": before, "after": after})
    # GOOG / GOOGL: one company number; = A*GOOGL + B*GOOGL + C*GOOG
    c1, c2 = g.cik("GOOG"), g.cik("GOOGL")
    g.check("GOOG/GOOGL", "same issuer", c1 is not None and c1 == c2, (c1, c2))
    if c1:
        d = g.db.execute("SELECT MAX(d) FROM cap_daily WHERE cik=?", (c1,)).fetchone()[0]
        if d:
            ds = f"{d // 10000}-{d // 100 % 100:02d}-{d % 100:02d}"
            parts = {ck: sh for ck, sh in g.db.execute("SELECT class_key, shares FROM state_run WHERE issuer_id=? AND start<=? AND end>=?",
                                                       (f"cik:{c1}", ds, ds))}
            exp = (parts.get("A", 0) + parts.get("B", 0)) * g.close("GOOGL", ds) + parts.get("C", 0) * g.close("GOOG", ds)
            got = g.cap(c1, ds)
            g.check("GOOG/GOOGL", "company cap = (A+B)*GOOGL + C*GOOG (no double count)", got and abs(got / exp - 1) < 1e-6,
                    {"date": ds, "classes": parts, "cap": got})
        cv = g.cov(c1)
        g.check("GOOG/GOOGL", "multi-listed structure", cv and any("MULTI_LISTED" in s for s in json.loads(cv["structure"])), cv and cv["structure"])
    # META / ABNB / PLTR / COIN: unlisted classes by authoritative conversion
    for t, need in (("META", {"A", "B"}), ("ABNB", {"A", "B"}), ("PLTR", {"A", "B"}), ("COIN", {"A", "B"})):
        c = g.cik(t)
        cv = g.cov(c) if c else None
        comps = g.db.execute("SELECT components FROM regime WHERE issuer_id=? ORDER BY end DESC LIMIT 1", (f"cik:{c}",)).fetchone() if c else None
        ks = {x[0] for x in json.loads(comps[0])} if comps else set()
        g.check(t, f"latest regime counts classes {sorted(need)} at the listed price", need <= ks, {"components": comps and json.loads(comps[0])})
        g.check(t, "has current value", cv and cv["valued_days"] > 0, cv and cv["reasons"])
    # V: no old-ticker contamination, complex economics quarantined
    c = g.cik("V")
    if c:
        pre = g.db.execute("SELECT COUNT(*) FROM cap_daily WHERE cik=? AND d < 20080319", (c,)).fetchone()[0]
        g.check("V", "no value before the 2008-03-19 listing", pre == 0, pre)
        cv = g.cov(c)
        g.check("V", "class economics quarantined (COMPLEX or MULTI_CLASS unresolved)",
                cv and all("UNRESOLVED" in s for s in json.loads(cv["structure"])) , cv and cv["structure"])
    # ADR: TSM ratio 5 ordinary per ADS; ADS-equivalent never ADS price x ordinary
    c = g.cik("TSM")
    if c:
        cv = g.cov(c)
        last = g.db.execute("SELECT d, cap FROM cap_daily WHERE cik=? ORDER BY d DESC LIMIT 1", (c,)).fetchone()
        g.check("TSM", "ADR structure with a value", cv and "ADR" in cv["structure"] and last, {"cov": cv and cv["structure"], "last": last})
        if last:
            obs = g.db.execute("SELECT tag FROM observation WHERE issuer_id=? AND tag LIKE '%/ADS%' LIMIT 1", (f"cik:{c}",)).fetchone()
            g.check("TSM", "observations converted at ADS ratio 5", obs and "/ADS5@" in obs[0], obs)
    for t in ("SONY", "NVS", "SHOP", "SAP", "TM", "RIO", "SHEL"):
        c = g.cik(t)
        cv = g.cov(c) if c else None
        g.check(t, "foreign filer: value present and zero internal gaps",
                cv and cv["valued_days"] > 0 and cv["internal_gap_days"] == 0, cv and (cv["structure"], cv["first_value"], cv["internal_gap_days"], cv["reasons"]))
    # ticker change META (FB -> META 2022-06-09): continuous
    c = g.cik("META")
    if c:
        a, b = g.cap(c, "2022-06-08"), g.cap(c, "2022-06-09")
        g.check("META", "ticker change FB->META continuous", a and b and abs(b / a - 1) < 0.1, (a, b))
    # pre-EDGAR issuer: KO before 1993 is PRE_EDGAR-coded, never valued
    c = g.cik("KO")
    if c:
        v = g.db.execute("SELECT COUNT(*) FROM cap_daily WHERE cik=? AND d < 19930101", (c,)).fetchone()[0]
        codes = {r[2] for r in g.gaps(c) if r[0] < 19930101}
        g.check("KO", "pre-EDGAR days never valued, coded PRE_EDGAR", v == 0 and codes <= {"PRE_EDGAR_NO_AUTHORITATIVE_SHARE_EVIDENCE"}, codes)
    return g.results


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", required=True)
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    res = run(a.build, a.data)
    json.dump(res, open(a.out, "w"), indent=1, default=str)
    for r in res:
        print(("PASS " if r["pass"] else "FAIL ") + f"{r['case']:<11} {r['check']}" + ("" if r["pass"] else f"  -> {str(r['evidence'])[:220]}"))
    print(f"{sum(r['pass'] for r in res)}/{len(res)} passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
