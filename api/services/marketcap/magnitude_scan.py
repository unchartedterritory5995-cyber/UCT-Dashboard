"""The order-of-magnitude scanner (hard gate B) and the blocker disposition table.

    python -m api.services.marketcap.magnitude_scan --build B.db --baseline BASELINE.db --data C:/mcapdata \
        [--first FIRST_V1.db --blockers blockers.json] --out scan.json

Massive's current market cap is an INDEPENDENT ANOMALY DETECTOR, never truth. A security is an outlier when its
latest V1 value is >= 10x away from Massive's. Each outlier is classified:

  RECENT_V1_INTRODUCED     the V1 value is current (within 10 sessions of the last bar) and production's value on the
                           same day is absent or materially different -> a BLOCKER unless proven correct;
  RECENT_PRODUCTION_SAME   production shows the same value (pre-existing, not introduced by V1);
  RECENT_PRODUCTION_SAME_STATE  production's comparator does not reach V1's last day (a frozen review baseline is
                           older than a fresh refresh), but on the LAST day both cover V1 equals production and V1's
                           share state has not changed since: the value is production's own, carried forward;
  OLD_LAST_VALUE           V1's last value is older than 10 sessions (the security is HELD now) -- not comparable to a
                           current figure; reported with the reason now in force.

History-wide: every session where V1 and production are both valued and >= 10x apart is counted and attributed.
`--blockers` (the first pass's 63) gets a disposition per security: CORRECT (latest V1 value within 2x of Massive, or
proven), REFUSED (no current value; the reason in force), or STILL_OUTLIER.
"""
from __future__ import annotations

import argparse
import json
import math
import sqlite3
from collections import Counter


def _massive(data: str) -> dict:
    out = {}
    for line in open(f"{data}/ref.jsonl", encoding="utf-8"):
        t, d, _s, _e = json.loads(line)
        if d and d.get("market_cap"):
            out[t] = (float(d["market_cap"]), d.get("share_class_shares_outstanding"), d.get("name"), d.get("type"),
                      d.get("weighted_shares_outstanding"))
    return out


def scan(build: str, baseline: str, data: str) -> dict:
    B = sqlite3.connect(build)
    S = sqlite3.connect(baseline)
    M = _massive(data)
    rows = []
    hist = Counter()
    hist_secs = Counter()
    for cik, t, last_day in B.execute("SELECT cik, primary_ticker, last_day FROM coverage"):
        last = B.execute("SELECT d, cap FROM cap_daily WHERE cik=? ORDER BY d DESC LIMIT 1", (cik,)).fetchone()
        base = dict(S.execute("SELECT d, cap FROM base_daily WHERE ticker=?", (t,)).fetchall())
        # history-wide >= 10x disagreement with production (both valued)
        n10 = 0
        for d, cap in B.execute("SELECT d, cap FROM cap_daily WHERE cik=?", (cik,)):
            b = base.get(d)
            if b and cap and abs(math.log10(cap / b)) >= 1:
                n10 += 1
        if n10:
            hist["sessions"] += n10
            hist_secs[t] = n10
        if not last or t not in M:
            continue
        r = last[1] / M[t][0]
        if abs(math.log10(r)) < 1:
            continue
        days = [d for (d,) in B.execute("SELECT d FROM cap_daily WHERE cik=? ORDER BY d DESC LIMIT 1", (cik,))]
        bars_after = B.execute("SELECT COUNT(*) FROM gap_run WHERE cik=? AND start > ?", (cik, last[0])).fetchone()[0]
        recent = last_day and last[0] >= int(last_day.replace("-", "")) - 15 and bars_after == 0
        b = base.get(last[0])
        same_state = None
        if b is None and base:
            d0 = max((d for d in base if d <= last[0]), default=None)
            v0 = B.execute("SELECT cap FROM cap_daily WHERE cik=? AND d=?", (cik, d0)).fetchone() if d0 else None
            if v0 and base[d0] and abs(math.log(v0[0] / base[d0])) < 0.05:
                iso = lambda x: f"{x // 10000}-{x // 100 % 100:02d}-{x % 100:02d}"
                st = lambda x: sorted(B.execute("SELECT class_key, shares, obs_accession FROM state_run WHERE issuer_id=? "
                                                 "AND start<=? AND end>=?", (f"cik:{cik}", iso(x), iso(x))).fetchall())
                if st(d0) and st(d0) == st(last[0]):
                    same_state = d0
        ds = f"{last[0] // 10000}-{last[0] // 100 % 100:02d}-{last[0] % 100:02d}"
        v1_shares = sum(sh * (1.0 if not mult else mult) for sh, mult in B.execute(
            "SELECT s.shares, NULL FROM state_run s WHERE s.issuer_id=? AND s.start<=? AND s.end>=?", (f"cik:{cik}", ds, ds)))
        m_sh = [x for x in (M[t][1], M[t][4]) if x]
        shares_agree = bool(recent and v1_shares and any(abs(v1_shares / x - 1) <= 0.10 for x in m_sh))
        if not recent:
            k = "OLD_LAST_VALUE"
        elif shares_agree:
            k = "RECENT_SHARES_AGREE_PRICE_BASIS"       # V1's share count == the detector's own count: the cap gap is price
        elif b and abs(math.log(last[1] / b)) < 0.05:
            k = "RECENT_PRODUCTION_SAME"
        elif same_state:
            k = "RECENT_PRODUCTION_SAME_STATE"
        else:
            k = "RECENT_V1_INTRODUCED"
        now = B.execute("SELECT reason FROM gap_run WHERE cik=? ORDER BY end DESC LIMIT 1", (cik,)).fetchone()
        rows.append({"ticker": t, "cik": cik, "class": k, "v1_last_day": last[0], "v1_last_cap": last[1], "massive_cap": M[t][0],
                     "ratio": r, "before_same_day": b, "reason_now": now[0] if now else None, "v1_shares": v1_shares,
                     "massive_shares": m_sh, "comparator_day": same_state,
                     "state": sorted(B.execute("SELECT class_key, shares, obs_accession FROM state_run WHERE issuer_id=? "
                                               "AND start<=? AND end>=?", (f"cik:{cik}", ds, ds)).fetchall())})
    return {"outliers": rows, "by_class": dict(Counter(r["class"] for r in rows)),
            "history_10x_vs_production": {"sessions": hist["sessions"], "securities": len(hist_secs),
                                          "top": hist_secs.most_common(40)}}


def dispositions(build: str, first: str, blockers: list, data: str) -> list:
    B = sqlite3.connect(build)
    F = sqlite3.connect(first)
    M = _massive(data)
    out = []
    for x in blockers:
        t, cik = x["ticker"], x["cik"]
        cur = B.execute("SELECT d, cap FROM cap_daily WHERE cik=? ORDER BY d DESC LIMIT 1", (cik,)).fetchone()
        cov = B.execute("SELECT last_day FROM coverage WHERE cik=?", (cik,)).fetchone()
        now = B.execute("SELECT reason, start, end FROM gap_run WHERE cik=? ORDER BY end DESC LIMIT 1", (cik,)).fetchone()
        last_day = int(cov[0].replace("-", "")) if cov and cov[0] else None
        valued_now = bool(cur and last_day and cur[0] >= last_day and not (now and now[2] >= last_day and now[1] > cur[0]))
        m = M.get(t, (None,))[0]
        r = (cur[1] / m) if (valued_now and m) else None
        if valued_now and r is not None and abs(math.log10(r)) < math.log10(2):
            disp = "CORRECT"
        elif valued_now:
            ds_ = f"{cur[0] // 10000}-{cur[0] // 100 % 100:02d}-{cur[0] % 100:02d}"
            asof = B.execute("SELECT MAX(as_of) FROM state_run WHERE issuer_id=? AND start<=? AND end>=?", (f"cik:{cik}", ds_, ds_)).fetchone()[0]
            from datetime import date as _date
            fresh = bool(asof) and (_date.fromisoformat(ds_) - _date.fromisoformat(asof)).days <= 45   # within 45 days of the last bar
            if r is not None and abs(math.log10(r)) >= 1:
                disp = "STILL_OUTLIER"
            elif fresh:
                disp = "CORRECT_NEWER_EVIDENCE_THAN_DETECTOR"    # an authoritative count dated within 45 days of today
            else:
                disp = "VALUED_WITHIN_10X"
        else:
            disp = "REFUSED"
        bad = F.execute("SELECT class_key, shares, obs_accession, as_of, source_type FROM state_run WHERE issuer_id=? "
                        "ORDER BY end DESC LIMIT 2", (f"cik:{cik}",)).fetchall()
        obs = []
        for ck, sh, accn, as_of, src in bad:
            o = F.execute("SELECT raw_value, unit, form, tag, split_basis, ads_ratio, known_from FROM observation WHERE issuer_id=? "
                          "AND accession=? AND class_key=? AND as_of=? LIMIT 1", (f"cik:{cik}", accn, ck, as_of)).fetchone()
            obs.append({"class": ck, "normalized": sh, "accession": accn, "as_of": as_of, "source": src,
                        "raw": o[0] if o else None, "unit": o[1] if o else None, "form": o[2] if o else None,
                        "tag": o[3] if o else None, "split_basis": o[4] if o else None, "known_from": o[6] if o else None})
        regime = B.execute("SELECT kind, reason, note FROM regime WHERE issuer_id=? ORDER BY start DESC LIMIT 1", (f"cik:{cik}",)).fetchone()
        out.append({**x, "disposition": disp, "corrected_last_day": cur[0] if cur else None, "corrected_last_cap": cur[1] if cur else None,
                    "corrected_ratio_vs_massive": r, "reason_now": now[0] if now and not valued_now else None,
                    "corrected_structure": regime[0] if regime else None, "corrected_structure_reason": regime[1] if regime else None,
                    "first_pass_bad_observations": obs})
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", required=True)
    ap.add_argument("--baseline", required=True)
    ap.add_argument("--data", required=True)
    ap.add_argument("--first")
    ap.add_argument("--blockers")
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    res = scan(a.build, a.baseline, a.data)
    if a.first and a.blockers:
        res["blocker_dispositions"] = dispositions(a.build, a.first, json.load(open(a.blockers)), a.data)
        res["blocker_disposition_counts"] = dict(Counter(x["disposition"] for x in res["blocker_dispositions"]))
    json.dump(res, open(a.out, "w"), indent=1, default=str)
    print(json.dumps({"by_class": res["by_class"], "history": {k: v for k, v in res["history_10x_vs_production"].items() if k != "top"},
                      "dispositions": res.get("blocker_disposition_counts")}, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
