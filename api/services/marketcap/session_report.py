"""Session-level BEFORE / AFTER report for one security (ARM is the mandatory golden).

    python -m api.services.marketcap.session_report --ticker ARM --build B.db --baseline BASE.db --data C:/mcapdata \
        --v5 C:/mcapdata/v5_shares.json.gz --out arm.json [--csv arm.csv]

For every session of the ticker's bars: BEFORE (production) value or blank + production's cause, V1 value or reason,
and the V1 share state in force (shares, evidence type, accession, as-of, the first close it could be used). Every
BEFORE-blank SEGMENT inside V1's valued span is summarised: why production is blank, which authoritative state fills
it, why carrying it is defensible (public before the session, inside the 15-month safety ceiling, superseded only by
newer public evidence), and what supersedes it.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import json
import os
import sqlite3
from datetime import date

from .baseline import project

CAUSE = {"stale": "SHARE_STATE_EXPIRED (period end > 200 d)", "gap_point": "V5 gap / withheld point",
         "no_point": "no V5 share point yet"}


def _d(i: int) -> str:
    return f"{i // 10000:04d}-{i // 100 % 100:02d}-{i % 100:02d}"


def run(ticker: str, build: str, baseline: str, data: str, v5: str) -> dict:
    B, S = sqlite3.connect(build), sqlite3.connect(baseline)
    px = sqlite3.connect(os.path.join(data, "prices.db"))
    tm = B.execute("SELECT cik, start, basis, pre_reason, pre_bars FROM ticker_map WHERE ticker=? ORDER BY start DESC LIMIT 1",
                   (ticker,)).fetchone()
    if not tm:
        return {"ticker": ticker, "error": "not in build"}
    cik, lstart, basis, pre_reason, pre_bars = tm
    rows = px.execute("SELECT d, c FROM bar WHERE ticker=? ORDER BY d", (ticker,)).fetchall()
    days = [d for d, _ in rows]
    doc = json.load(gzip.open(v5, "rt"))
    vcik = doc["tickers"].get(ticker)
    proj = project(((doc["companies"].get(str(vcik)) or {}).get("pts") or []) if vcik else [], days)
    base = dict(S.execute("SELECT d, cap FROM base_daily WHERE ticker=?", (ticker,)))
    v1 = dict(B.execute("SELECT d, cap FROM cap_daily WHERE cik=?", (cik,)))
    gaps = B.execute("SELECT start, end, reason FROM gap_run WHERE cik=?", (cik,)).fetchall()
    runs = B.execute("SELECT class_key, start, end, shares, obs_accession, as_of, source_type FROM state_run WHERE issuer_id=? "
                     "ORDER BY start", (f"cik:{cik}",)).fetchall()
    kf = {}
    for acc, ck, k, pa in B.execute("SELECT accession, class_key, known_from, public_at FROM observation WHERE issuer_id=?",
                                    (f"cik:{cik}",)):
        kf.setdefault((acc, ck), (k, pa))
    ls = int(lstart.replace("-", "")) if lstart else None
    sess = []
    for (d, c), (sh, why) in zip(rows, proj):
        ds = _d(d)
        st = next((r for r in runs if r[1] <= ds <= r[2]), None)
        reason = next((g[2] for g in gaps if g[0] <= d <= g[1]), None)
        sess.append({"d": d, "close": c, "before": base.get(d), "before_cause": None if d in base else CAUSE.get(why, why),
                     "v1": v1.get(d), "v1_reason": None if d in v1 else reason,
                     "state": None if not st else {"class": st[0], "shares": st[3], "accession": st[4], "as_of": st[5],
                                                   "source": st[6], "known_from": kf.get((st[4], st[0]), (None,))[0],
                                                   "public_at": kf.get((st[4], st[0]), (None, None))[1]}})
    legit = [s for s in sess if ls is None or s["d"] >= ls]
    # BEFORE-blank segments inside V1's valued span
    segs, cur = [], None
    for s in legit:
        blank = s["before"] is None and s["v1"] is not None
        if blank and cur is None:
            cur = {"from": s["d"], "to": s["d"], "n": 0, "causes": {}, "states": []}
        if blank:
            cur["to"] = s["d"]; cur["n"] += 1
            cur["causes"][s["before_cause"]] = cur["causes"].get(s["before_cause"], 0) + 1
            k = (s["state"]["accession"], s["state"]["as_of"]) if s["state"] else None
            if k and (not cur["states"] or cur["states"][-1]["accession"] != k[0]):
                cur["states"].append(dict(s["state"], first_day=s["d"], last_day=s["d"]))
            elif k:
                cur["states"][-1]["last_day"] = s["d"]
        elif cur is not None:
            segs.append(cur); cur = None
    if cur:
        segs.append(cur)
    for g in segs:
        last = g["states"][-1] if g["states"] else None
        nxt = next((r for r in runs if last and r[1] > _d(g["to"]) and r[4] != last["accession"]), None)
        g["superseded_by"] = None if not nxt else {"accession": nxt[4], "as_of": nxt[5], "source": nxt[6], "from": nxt[1]}
        for st in g["states"]:
            age = (date.fromisoformat(_d(st["last_day"])) - date.fromisoformat(st["as_of"])).days
            st["defensible"] = {"public_before_first_use": bool(st["known_from"] and st["known_from"] <= _d(st["first_day"])),
                                "age_at_last_use_days": age, "within_456d_ceiling": age <= 456}
    out = {"ticker": ticker, "cik": cik, "listing_start": lstart, "listing_basis": basis, "pre_listing_reason": pre_reason,
           "pre_listing_bars": pre_bars, "sessions_total": len(sess), "legit_sessions": len(legit),
           "before_valued_legit": sum(1 for s in legit if s["before"] is not None),
           "v1_valued_legit": sum(1 for s in legit if s["v1"] is not None),
           "before_contaminated": sum(1 for s in sess if ls and s["d"] < ls and s["before"] is not None),
           "v1_before_listing": sum(1 for s in sess if ls and s["d"] < ls and s["v1"] is not None),
           "v1_missing_legit": [(s["d"], s["v1_reason"]) for s in legit if s["v1"] is None][:20],
           "before_blank_segments_filled_by_v1": segs,
           "max_rel_diff_where_both": max((abs(s["v1"] / s["before"] - 1) for s in legit if s["v1"] and s["before"]), default=None)}
    out["_sessions"] = sess
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    for k in ("--ticker", "--build", "--baseline", "--data", "--v5", "--out"):
        ap.add_argument(k, required=True)
    ap.add_argument("--csv")
    a = ap.parse_args(argv)
    r = run(a.ticker, a.build, a.baseline, a.data, a.v5)
    sess = r.pop("_sessions", [])
    json.dump(r, open(a.out, "w"), indent=1, default=str)
    if a.csv:
        with open(a.csv, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["date", "close", "before_cap", "before_cause", "v1_cap", "v1_reason", "shares", "source", "accession", "as_of", "known_from"])
            for s in sess:
                st = s["state"] or {}
                w.writerow([_d(s["d"]), s["close"], s["before"], s["before_cause"], s["v1"], s["v1_reason"], st.get("shares"),
                            st.get("source"), st.get("accession"), st.get("as_of"), st.get("known_from")])
    print(json.dumps({k: v for k, v in r.items() if k != "before_blank_segments_filled_by_v1"}, indent=1, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
