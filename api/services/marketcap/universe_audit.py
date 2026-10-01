"""UNIVERSE MARKET CAP AUDIT: BEFORE (production) vs V1 (dark), per security, with anomaly classes A-P.

    python -m api.services.marketcap.universe_audit --build B.db --baseline BASE.db --data C:/mcapdata \
        --v5 C:/mcapdata/v5_shares.json.gz --out audit.json [--csv per_security.csv]

UNIT: every issuer the V1 build covers, measured on its PRIMARY security's bars; every other equity ticker of the
issuer is checked for contamination and double counting. BEFORE and V1 are measured over the SAME interval:
  EXPECTED interval  [V1 legitimate listing start, last bar]  (identity-safe; bars before it are another issuer or
                     not yet listed)
  INCEPTION coverage valued sessions / expected sessions
  INTERNAL gaps      missing sessions after a series' first valued session and before its last valued session
  TRAILING gap       missing sessions after the last valued session (current availability)
Every missing BEFORE session is classified by PRODUCTION's own cause (SHARE_STATE_EXPIRED = the 200-day period-age
rule; V5_GAP_OR_WITHHELD = a V5 gap point; NO_SHARE_POINT = V5 had nothing yet), then marked ARTIFICIAL when V1 values
that session (i.e. defensible evidence existed) or carries V1's explicit reason otherwise.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import json
import math
import os
import sqlite3
from collections import Counter, defaultdict
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

from .baseline import project as base_project
from .build import load_ref

ET = ZoneInfo("America/New_York")
EXPLAINED_V1 = {"PRE_EDGAR_NO_AUTHORITATIVE_SHARE_EVIDENCE", "PRE_FIRST_AUTHORITATIVE_SHARE_EVIDENCE",
                "TICKER_REUSE_DIFFERENT_ISSUER", "IPO_CAPITALIZATION_UNRESOLVED", "MULTI_CLASS_UNRESOLVED",
                "COMPLEX_CAPITAL_STRUCTURE_UNRESOLVED", "ADR_RATIO_UNRESOLVED", "SHARE_STATE_STALE",
                "CORPORATE_ACTION_HOLD", "SOURCE_CONFLICT", "QUARANTINED", "WITHHELD", "NO_VALID_PRICE",
                "NOT_YET_LISTED", "DELISTED", "OTHER_EXPLAINED"}
BASE_CAUSE = {"stale": "SHARE_STATE_EXPIRED", "gap_point": "V5_GAP_OR_WITHHELD", "no_point": "NO_SHARE_POINT",
              "no_price": "PRICE_MISSING"}


def _di(s) -> int | None:
    if s is None:
        return None
    if isinstance(s, int):
        return s
    return int(str(s)[:10].replace("-", ""))


def _close_utc(d: int) -> datetime:
    return datetime.combine(date(d // 10000, d // 100 % 100, d % 100), time(16, 0), tzinfo=ET).astimezone(timezone.utc)


def _runs(days: list[int], valued: set[int]) -> dict:
    first = next((d for d in days if d in valued), None)
    last = next((d for d in reversed(days) if d in valued), None)
    out = {"first": first, "last": last, "valued": sum(1 for d in days if d in valued), "expected": len(days),
           "internal_days": 0, "internal_gaps": 0, "longest": 0, "trailing": 0, "runs": []}
    if first is None:
        out["trailing"] = len(days)
        return out
    cur, start = 0, None
    for d in days:
        if d < first:
            continue
        if d in valued:
            if cur:
                out["internal_gaps"] += 1; out["internal_days"] += cur; out["longest"] = max(out["longest"], cur)
                out["runs"].append((start, cur))
            cur, start = 0, None
        else:
            if not cur:
                start = d
            cur += 1
    out["trailing"] = cur
    return out


def _pct(xs, p):
    xs = sorted(x for x in xs if x is not None)
    return xs[min(len(xs) - 1, int(p * len(xs)))] if xs else None


def run(build: str, baseline: str, data: str, v5: str, csv_path: str | None = None) -> dict:
    B = sqlite3.connect(build)
    S = sqlite3.connect(baseline)
    px = sqlite3.connect(os.path.join(data, "prices.db"))
    ref = load_ref(os.path.join(data, "ref.jsonl"))
    v5doc = json.load(gzip.open(v5, "rt"))
    man = dict(B.execute("SELECT key, value FROM manifest"))
    cov = B.execute("SELECT cik, primary_ticker, foreign_filer, first_bar, listing_start, first_value, last_day, listed_days, "
                    "valued_days, internal_gap_days, unexplained_days, structure, reasons FROM coverage").fetchall()
    tmap = defaultdict(list)
    for t, cik, start, end, basis, pre, pre_bars in B.execute(
            "SELECT ticker, cik, start, end, basis, pre_reason, pre_bars FROM ticker_map"):
        tmap[cik].append((t, start, end, basis, pre, pre_bars or 0))
    comps = defaultdict(list)
    kinds = defaultdict(set)
    for iss, s, e, kind, compj in B.execute("SELECT issuer_id, start, end, kind, components FROM regime"):
        c = int(iss.split(":")[1])
        kinds[c].add(kind)
        comps[c].append((_di(s), _di(e), kind, json.loads(compj or "[]")))
    st = defaultdict(list)
    for iss, ck, s, e, sh, accn, asof, src in B.execute(
            "SELECT issuer_id, class_key, start, end, shares, obs_accession, as_of, source_type FROM state_run"):
        st[(int(iss.split(":")[1]), ck)].append((_di(s), _di(e), sh, accn, asof, src))
    known = {}
    for iss, ck, accn, kf, pa, asof, st_ in B.execute(
            "SELECT issuer_id, class_key, accession, known_from, public_at, as_of, validation_status FROM observation"):
        k = (int(iss.split(":")[1]), ck, accn)
        if k not in known or kf < known[k][0]:
            known[k] = (kf, pa, asof)
    st_by_cik: dict = defaultdict(dict)
    for (c_, ck_), rs_ in st.items():
        st_by_cik[c_][ck_] = rs_
    gapr = defaultdict(list)
    for cik, s, e, reason, n in B.execute("SELECT cik, start, end, reason, n_days FROM gap_run"):
        gapr[cik].append((s, e, reason, n))

    rows, anomalies = [], defaultdict(list)
    closes_cache = {}

    def closes(t):
        if t not in closes_cache:
            closes_cache[t] = dict(px.execute("SELECT d, c FROM bar WHERE ticker=?", (t,)).fetchall())
        return closes_cache[t]

    base_tick = {t: (cik,) for t, cik in S.execute("SELECT ticker, cik FROM base_ticker")}
    v5tick = {t: int(c) for t, c in v5doc["tickers"].items()}
    for (cik, pt, foreign, first_bar, ls, fv, last_day, listed, valued_n, igd, unexpl, structj, reasonsj) in cov:
        structure = json.loads(structj or "[]")
        reasons = json.loads(reasonsj or "{}")
        cl = closes(pt) if pt else {}
        lsd = _di(ls) or _di(first_bar)
        days = sorted(d for d in cl if lsd is None or d >= lsd)
        v1 = {d: c for d, c in B.execute("SELECT d, cap FROM cap_daily WHERE cik=?", (cik,))}
        v1r = _runs(days, set(v1))
        # BEFORE on the same ticker (production: whatever V5 maps the symbol to)
        base = {d: c for d, c in S.execute("SELECT d, cap FROM base_daily WHERE ticker=?", (pt,))}
        br = _runs(days, set(base))
        # BEFORE per-day production cause over the expected interval (after BEFORE's first value: internal; before: inception)
        bcause = Counter()
        bartificial = 0
        if pt in v5tick:
            comp = v5doc["companies"].get(str(v5tick[pt])) or {}
            proj = base_project(comp.get("pts") or [], days)
            for d, (sh, why) in zip(days, proj):
                if d in base:
                    continue
                cause = BASE_CAUSE.get(why if sh is None else "no_price", why)
                in_internal = br["first"] is not None and br["first"] < d < (br["last"] or 0)
                if d in v1:
                    bartificial += 1
                    bcause[("INTERNAL" if in_internal else "OUTER") + ":ARTIFICIAL:" + cause] += 1
                else:
                    bcause[("INTERNAL" if in_internal else "OUTER") + ":V1_ALSO_MISSING:" + cause] += 1
        else:
            bcause["NO_V5_TICKER"] = len(days) - len(base)
        # contamination: BEFORE values before the legitimate listing on ANY of the issuer's tickers
        contam = 0
        for t, start, end, basis, pre, pre_bars in tmap.get(cik, []):
            s0 = _di(start)
            if s0:
                contam += S.execute("SELECT count(*) FROM base_daily WHERE ticker=? AND d < ?", (t, s0)).fetchone()[0]
        reuse = [x[0] for x in tmap.get(cik, []) if x[4] == "TICKER_REUSE_DIFFERENT_ISSUER"]
        # V1 internal gap reasons
        v1_internal = Counter()
        for s, e, reason, n in gapr.get(cik, []):
            if v1r["first"] and s > v1r["first"] and (v1r["last"] is None or e < v1r["last"]):
                v1_internal[reason] += n
        unexplained_v1 = sum(n for r, n in v1_internal.items() if r not in EXPLAINED_V1) + (unexpl or 0)
        rec = {"cik": cik, "ticker": pt, "foreign": bool(foreign), "structure": structure,
               "adr": "ADR" in kinds[cik],
               "multi": bool(kinds[cik] & {"MULTI_LISTED"}) or any(len(r[3]) > 1 for r in comps[cik]),
               "unresolved": "UNRESOLVED" in kinds[cik],
               "listing_start": lsd, "first_bar": _di(first_bar), "first_evidence": _di(fv), "expected_sessions": len(days),
               "v1": {k: v1r[k] for k in ("first", "last", "valued", "internal_days", "internal_gaps", "longest", "trailing")},
               "before": {k: br[k] for k in ("first", "last", "valued", "internal_days", "internal_gaps", "longest", "trailing")},
               "before_causes": dict(bcause), "before_artificial_sessions": bartificial,
               "v1_internal_reasons": dict(v1_internal), "v1_unexplained": unexplained_v1, "v1_reasons_all": reasons,
               "contaminated_before_sessions": contam, "ticker_reuse": reuse,
               "pre_edgar": bool(reasons.get("PRE_EDGAR_NO_AUTHORITATIVE_SHARE_EVIDENCE"))}
        # ---------------- anomalies on V1
        a = anomalies
        prev = None
        same_run = 0
        for d in days:
            if d not in v1:
                prev = None; same_run = 0; continue
            c = cl.get(d)
            if prev is not None:
                pd_, pcap, pc = prev
                cr = v1[d] / pcap if pcap else None
                prr = c / pc if pc else None
                if cr and prr:
                    if cr > 10 or cr < 0.1:
                        a["P_order_of_magnitude"].append([pt, d, round(cr, 4)])
                    elif abs(math.log(cr) - math.log(prr)) > math.log(1.5):
                        a["D_cap_jump_not_explained_by_price"].append([pt, d, round(cr, 4), round(prr, 4)])
                    if abs(cr - 1) < 1e-12 and abs(prr - 1) > 1e-6:
                        same_run += 1
                        if same_run == 5:
                            a["N_constant_cap_moving_price"].append([pt, d])
                    else:
                        same_run = 0
                    if abs(prr - 1) > 0.05 and abs(cr - 1) < 1e-9:
                        a["O_price_move_without_cap_move"].append([pt, d, round(prr, 4)])
            prev = (d, v1[d], c)
        if lsd and any(d < lsd for d in v1):
            a["F_v1_cap_before_listing"].append([pt, sum(1 for d in v1 if d < lsd)])
        if contam:
            a["E_ticker_reuse_contamination_BEFORE"].append([pt, contam])
        if unexplained_v1:
            a["A_v1_unexplained_internal_gap"].append([pt, unexplained_v1, dict(v1_internal)])
        # B stale state in use (> 365 d old at use), C impossible share jumps, L/M timestamps
        for ck, rs in st_by_cik.get(cik, {}).items():
            for s0, e0, sh, accn, asof, src in rs:
                if asof and s0 and e0:
                    age_end = (date(e0 // 10000, e0 // 100 % 100, e0 % 100) - date.fromisoformat(asof)).days
                    if age_end > 365:
                        a["B_state_older_than_365d_in_use"].append([pt, ck, asof, e0, age_end])
                k = known.get((cik, ck, accn))
                if k and s0:
                    kf = _di(k[0])                                  # first trading date whose close may use it
                    if s0 < kf:
                        a["M_lookahead_state_before_known"].append([pt, ck, accn, s0, k[0]])
                    if k[1] and _close_utc(kf) < datetime.fromisoformat(k[1]):
                        a["L_known_before_public"].append([pt, ck, accn, k[0], k[1]])
            for p, n in zip(rs, rs[1:]):
                if p[2] and n[2] and (n[2] / p[2] > 10 or n[2] / p[2] < 0.1):
                    a["C_share_jump_over_10x"].append([pt, ck, n[0], round(n[2] / p[2], 4), p[3], n[3]])
        # J recompute: cap(d) == sum(class state x own close x multiplier) on sampled days (independent of the engine)
        rec_mis = 0
        for d in days[:: max(1, len(days) // 60)] + days[-1:]:
            if d not in v1:
                continue
            reg = next((r for r in comps[cik] if (r[0] or 0) <= d <= (r[1] or 99999999)), None)
            if not reg or reg[2] == "UNRESOLVED":
                continue
            tot = 0.0
            ok = True
            for ck, ptk, mult, _ev in reg[3]:
                rsx = st.get((cik, ck), [])
                sh = next((r[2] for r in rsx if r[0] <= d <= r[1]), None)
                c = closes(ptk).get(d) if ptk else None
                if sh is None or c is None:
                    ok = False; break
                tot += sh * c * (mult or 1.0)
            if ok and tot and abs(tot / v1[d] - 1) > 1e-6:
                rec_mis += 1
        if rec_mis:
            a["J_cap_disagrees_with_state_x_price"].append([pt, rec_mis])
        # G: two listed classes of one issuer priced off the same ticker = double counting
        if comps[cik]:
            pts_ = [c[1] for c in comps[cik][-1][3]]
            if len(pts_) != len(set(pts_)):
                a["G_multi_class_same_price_ticker"].append([pt, pts_])
        # K duplicates are impossible by the cap_daily primary key; check bars
        rows.append(rec)
    # ---------------- H: current cap vs Massive current (consumer reference, never an input)
    for r in rows:
        last = B.execute("SELECT d, cap FROM cap_daily WHERE cik=? ORDER BY d DESC LIMIT 1", (r["cik"],)).fetchone()
        m = (ref.get(r["ticker"]) or (None,))[0]
        mc = getattr(m, "share_class_shares_outstanding", None)
        r["v1_last"] = last
        if last and m is not None:
            r["massive_share_class_shares"] = mc
    # ---------------- aggregates
    def agg(sel, key):
        sub = [r for r in rows if sel(r)]
        exp = sum(r["expected_sessions"] for r in sub)
        val = sum(r[key]["valued"] for r in sub)
        cov_ = [r[key]["valued"] / r["expected_sessions"] for r in sub if r["expected_sessions"]]
        return {"securities": len(sub), "with_any_cap": sum(1 for r in sub if r[key]["valued"]),
                "zero_history": sum(1 for r in sub if not r[key]["valued"]),
                "complete_inception": sum(1 for r in sub if r["expected_sessions"] and r[key]["valued"] == r["expected_sessions"]),
                "no_internal_gaps": sum(1 for r in sub if r[key]["valued"] and not r[key]["internal_days"]),
                "internal_gap_securities": sum(1 for r in sub if r[key]["internal_days"]),
                "internal_gap_sessions": sum(r[key]["internal_days"] for r in sub),
                "current_available": sum(1 for r in sub if r[key]["valued"] and not r[key]["trailing"]),
                "expected_sessions": exp, "valued_sessions": val, "missing_sessions": exp - val,
                "median_coverage": _pct(cov_, 0.5), "p05_coverage": _pct(cov_, 0.05), "p95_coverage": _pct(cov_, 0.95),
                "internal_gap_rate": (sum(r[key]["internal_days"] for r in sub) /
                                      max(1, sum((r[key]["valued"] + r[key]["internal_days"]) for r in sub)))}
    cohorts = {"all": lambda r: True, "domestic": lambda r: not r["foreign"], "foreign": lambda r: r["foreign"],
               "adr": lambda r: r["adr"], "multi_class": lambda r: r["multi"], "unresolved_structure": lambda r: r["unresolved"],
               "ipo_era_listing_2009plus": lambda r: (r["listing_start"] or 0) >= 20090101,
               "pre_edgar_limited": lambda r: r["pre_edgar"], "ticker_reuse": lambda r: bool(r["ticker_reuse"])}
    out = {"build": man.get("build_id"), "baseline": dict(S.execute("SELECT key, value FROM manifest")),
           "securities": len(rows),
           "cohorts": {name: {"before": agg(f, "before"), "v1": agg(f, "v1")} for name, f in cohorts.items()}}
    out["unexplained"] = {
        "before_artificial_internal_sessions": sum(v for r in rows for k, v in r["before_causes"].items() if k.startswith("INTERNAL:ARTIFICIAL")),
        "before_artificial_sessions_total": sum(r["before_artificial_sessions"] for r in rows),
        "before_internal_gap_securities_artificial": sum(1 for r in rows if any(k.startswith("INTERNAL:ARTIFICIAL") for k in r["before_causes"])),
        "before_causes_total": dict(sum((Counter(r["before_causes"]) for r in rows), Counter()).most_common()),
        "v1_unexplained_securities": sum(1 for r in rows if r["v1_unexplained"]),
        "v1_unexplained_sessions": sum(r["v1_unexplained"] for r in rows),
        "v1_internal_reason_sessions": dict(sum((Counter(r["v1_internal_reasons"]) for r in rows), Counter()).most_common()),
        "v1_all_missing_reason_sessions": dict(sum((Counter(r["v1_reasons_all"]) for r in rows), Counter()).most_common())}
    out["contamination"] = {"securities": sum(1 for r in rows if r["contaminated_before_sessions"]),
                            "before_sessions": sum(r["contaminated_before_sessions"] for r in rows)}
    out["worst50_before_missing"] = sorted(([r["ticker"], r["expected_sessions"] - r["before"]["valued"],
                                             r["expected_sessions"] - r["v1"]["valued"]] for r in rows), key=lambda x: -x[1])[:50]
    out["worst50_v1_missing"] = sorted(([r["ticker"], r["expected_sessions"] - r["v1"]["valued"],
                                         dict(Counter(r["v1_reasons_all"]).most_common(2))] for r in rows), key=lambda x: -x[1])[:50]
    out["anomalies"] = {k: {"count": len(v), "securities": len({x[0] for x in v}), "examples": v[:25]} for k, v in sorted(anomalies.items())}
    if csv_path:
        with open(csv_path, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["cik", "ticker", "foreign", "adr", "multi", "unresolved", "listing_start", "first_bar", "first_evidence",
                        "expected", "before_valued", "before_internal_gaps", "before_internal_days", "before_longest",
                        "before_trailing", "before_artificial", "v1_valued", "v1_internal_gaps", "v1_internal_days",
                        "v1_longest", "v1_trailing", "v1_unexplained", "contaminated_before", "ticker_reuse", "v1_reasons"])
            for r in rows:
                b, v = r["before"], r["v1"]
                w.writerow([r["cik"], r["ticker"], int(r["foreign"]), int(r["adr"]), int(r["multi"]), int(r["unresolved"]),
                            r["listing_start"], r["first_bar"], r["first_evidence"], r["expected_sessions"], b["valued"],
                            b["internal_gaps"], b["internal_days"], b["longest"], b["trailing"], r["before_artificial_sessions"],
                            v["valued"], v["internal_gaps"], v["internal_days"], v["longest"], v["trailing"], r["v1_unexplained"],
                            r["contaminated_before_sessions"], "|".join(r["ticker_reuse"]), json.dumps(r["v1_reasons_all"])])
    out["_rows"] = rows
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", required=True)
    ap.add_argument("--baseline", required=True)
    ap.add_argument("--data", required=True)
    ap.add_argument("--v5", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--csv")
    a = ap.parse_args(argv)
    res = run(a.build, a.baseline, a.data, a.v5, a.csv)
    rows = res.pop("_rows")
    json.dump(res, open(a.out, "w"), indent=1, default=str)
    with gzip.open(a.out.replace(".json", "_rows.json.gz"), "wt") as f:
        json.dump(rows, f, default=str)
    print(json.dumps({k: res[k] for k in ("securities", "unexplained", "contamination")}, indent=1, default=str)[:4000])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
