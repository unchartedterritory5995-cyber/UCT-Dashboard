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
from . import reasons as RC

ET = ZoneInfo("America/New_York")
EXPLAINED_V1 = {"PRE_EDGAR_NO_AUTHORITATIVE_SHARE_EVIDENCE", "PRE_FIRST_AUTHORITATIVE_SHARE_EVIDENCE",
                "TICKER_REUSE_DIFFERENT_ISSUER", "IPO_CAPITALIZATION_UNRESOLVED", "MULTI_CLASS_UNRESOLVED",
                "COMPLEX_CAPITAL_STRUCTURE_UNRESOLVED", "ADR_RATIO_UNRESOLVED", "SHARE_STATE_STALE",
                "CORPORATE_ACTION_HOLD", "SOURCE_CONFLICT", "QUARANTINED", "WITHHELD", "NO_VALID_PRICE",
                "NOT_YET_LISTED", "DELISTED", "OTHER_EXPLAINED"} | (set(RC.REASON_CODES) - {RC.BUG})
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
    inp = sqlite3.connect(os.path.join(data, "inputs.db"))
    txt = sqlite3.connect(os.path.join(data, "text.db"))
    PERIODIC = ("10-K", "10-Q", "10-K405", "10-KSB", "10-QSB", "20-F", "40-F", "10-KT")
    stale_sub = Counter()
    stale_sub_sec = defaultdict(set)
    stale_examples = defaultdict(list)
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
        lost = Counter()                     # BEFORE valued, V1 not: by V1 reason
        diff = Counter()                     # both valued: |V1/BEFORE - 1| bucket
        mat_cause = Counter()                # material (> 5%) difference: attributed cause
        cur_cmp = None
        v1_reason_day = {}
        for s_, e_, reason_, n_ in gapr.get(cik, []):
            for d_ in days:
                if s_ <= d_ <= e_:
                    v1_reason_day[d_] = reason_
        state_asof = {}
        for ck_, rs_ in st_by_cik.get(cik, {}).items():
            for r_ in rs_:
                state_asof.setdefault(ck_, []).append(r_)
        if pt in v5tick:
            comp = v5doc["companies"].get(str(v5tick[pt])) or {}
            proj = base_project(comp.get("pts") or [], days, with_pe=True)
            for d, (sh, why, pe) in zip(days, proj):
                if d in base and d not in v1:
                    lost[v1_reason_day.get(d, "UNKNOWN")] += 1
                if d in base and d in v1 and base[d]:
                    q = v1[d] / base[d]
                    dq = abs(q - 1)
                    diff["<0.5%" if dq < 0.005 else "0.5-5%" if dq < 0.05 else "5-20%" if dq < 0.2 else ">20%"] += 1
                    if dq >= 0.05:
                        if "MULTI_LISTED" in kinds[cik] or any(len(r[3]) > 1 for r in comps[cik] if (r[0] or 0) <= d <= (r[1] or 99999999)):
                            mat_cause["MULTI_CLASS_COMPANY_TOTAL"] += 1
                        elif "ADR" in kinds[cik]:
                            mat_cause["ADR_RATIO_APPLIED"] += 1
                        else:
                            cur = next((r_ for rs_ in state_asof.values() for r_ in rs_ if r_[0] <= d <= r_[1]), None)
                            if cur and pe and cur[4] and cur[4] > pe:
                                mat_cause["V1_NEWER_EVIDENCE"] += 1
                            elif cur and pe and cur[4] and cur[4] < pe:
                                mat_cause["V1_OLDER_EVIDENCE"] += 1
                            else:
                                mat_cause["SAME_PERIOD_DIFFERENT_VALUE"] += 1
                if d in base and d in v1 and base[d] > 0:
                    cur_cmp = (d, v1[d], base[d])
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
        # every INTERNAL SHARE_STATE_STALE run gets an honest sub-reason
        my_sub = Counter()
        for s, e, reason, n in gapr.get(cik, []):
            if reason != "SHARE_STATE_STALE" or not v1r["first"] or not (s > v1r["first"] and e < (v1r["last"] or 0)):
                continue
            sd = f"{s // 10000:04d}-{s // 100 % 100:02d}-{s % 100:02d}"
            ed = f"{e // 10000:04d}-{e // 100 % 100:02d}-{e % 100:02d}"
            fl = inp.execute("SELECT accn, form FROM filing WHERE cik=? AND filing_date BETWEEN ? AND ? AND form IN "
                             "(" + ",".join("?" * len(PERIODIC)) + ")", (cik, sd, ed, *PERIODIC)).fetchall()
            if not fl:
                sub = "NO_PERIODIC_FILINGS_IN_WINDOW"
            else:
                sts = {r[0] for a_, _f in fl for r in txt.execute("SELECT status FROM text_obs WHERE accn=?", (a_,))}
                annual_only = all(f_.startswith(("20-F", "40-F", "10-K")) for _a, f_ in fl)
                if annual_only and n <= 90:
                    sub = "ANNUAL_FILER_CYCLE_EXCEEDS_15M_CEILING"
                elif sts and "OK" not in sts:
                    sub = "FILED_BUT_TEXT_UNPARSED:" + "/".join(sorted(sts))
                elif not sts:
                    sub = "FILED_NO_SHARE_EVIDENCE_EXTRACTED"
                else:
                    sub = "FILED_EVIDENCE_REFUSED_OR_CONFLICTING"
            stale_sub[sub] += n
            my_sub[sub] += n
            stale_sub_sec[sub].add(cik)
            if len(stale_examples[sub]) < 12:
                stale_examples[sub].append([pt, s, e, n, [f for _a, f in fl][:6]])
        rec = {"cik": cik, "ticker": pt, "foreign": bool(foreign), "structure": structure,
               "adr": "ADR" in kinds[cik],
               "multi": bool(kinds[cik] & {"MULTI_LISTED"}) or any(len(r[3]) > 1 for r in comps[cik]),
               "unresolved": "UNRESOLVED" in kinds[cik],
               "listing_start": lsd, "first_bar": _di(first_bar), "first_evidence": _di(fv), "expected_sessions": len(days),
               "v1": {k: v1r[k] for k in ("first", "last", "valued", "internal_days", "internal_gaps", "longest", "trailing")},
               "before": {k: br[k] for k in ("first", "last", "valued", "internal_days", "internal_gaps", "longest", "trailing")},
               "before_causes": dict(bcause), "before_artificial_sessions": bartificial,
               "v1_internal_reasons": dict(v1_internal), "v1_unexplained": unexplained_v1, "v1_reasons_all": reasons,
               "stale_internal_subreasons": dict(my_sub),
               "contaminated_before_sessions": contam, "ticker_reuse": reuse,
               "shadow": {"before_valued_v1_missing": dict(lost), "both_valued_diff": dict(diff),
                          "material_diff_cause": dict(mat_cause),
                          "current": None if not cur_cmp else {"d": cur_cmp[0], "v1": cur_cmp[1], "before": cur_cmp[2],
                                                               "rel": cur_cmp[1] / cur_cmp[2] - 1}},
               "pre_edgar": bool(reasons.get("PRE_EDGAR_NO_AUTHORITATIVE_SHARE_EVIDENCE"))}
        # ---------------- anomalies on V1
        a = anomalies
        starts = {r[0] for rs in st_by_cik.get(cik, {}).values() for r in rs}
        nxt_close = {days[i]: cl.get(days[i + 1]) for i in range(len(days) - 1)}
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
                    nc = nxt_close.get(d)
                    spike = bool(abs(math.log(prr)) > math.log(3) and nc and c and abs(math.log(nc / c)) > math.log(3)
                                 and (math.log(nc / c) > 0) != (math.log(prr) > 0))
                    cause = ("PRICE_SPIKE_REVERTING" if spike else "SHARE_STATE_CHANGE" if d in starts else
                             "PRICE_MOVE" if abs(math.log(prr)) > math.log(3) else "OTHER")
                    if cr > 10 or cr < 0.1:
                        a["P_order_of_magnitude"].append([pt, d, round(cr, 4), cause])
                    elif abs(math.log(cr) - math.log(prr)) > math.log(1.5):
                        a["D_cap_jump_not_explained_by_price"].append([pt, d, round(cr, 4), round(prr, 4), cause])
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
                    i0 = next((i for i, x in enumerate(days) if x >= n[0]), None)
                    cont = "NO_ADJACENT_VALUES"
                    if i0 and days[i0 - 1] in v1 and days[i0] in v1 and cl.get(days[i0 - 1]) and cl.get(days[i0]):
                        capr = v1[days[i0]] / v1[days[i0 - 1]]
                        pr = cl[days[i0]] / cl[days[i0 - 1]]
                        cont = "CAP_CONTINUOUS" if abs(math.log(capr) - math.log(pr)) < math.log(1.5) else "CAP_DISCONTINUOUS"
                    a["C_share_jump_over_10x"].append([pt, ck, n[0], round(n[2] / p[2], 4), p[3], n[3], p[5], n[5], cont])
            # SPLIT-LEDGER GAP SUSPECT: a split-like state ratio (k or 1/k, k in 2..100) that the adjusted PRICE does not
            # mirror (price continuous) while the CAP jumps, with no ledger split between the two as-of dates. The
            # bars are adjusted for a split the ledger lacks (BXMT 2013 1:10): every earlier state is on the old basis.
            for p, n in zip(rs, rs[1:]):
                if not (p[2] and n[2]):
                    continue
                r = n[2] / p[2]
                lr = abs(math.log(r))
                if lr < math.log(1.9):
                    continue
                k = round(r if r > 1 else 1 / r)
                if not (2 <= k <= 100 and abs(math.log(r if r > 1 else 1 / r) - math.log(k)) < 0.02):
                    continue
                i0 = next((i for i, x in enumerate(days) if x >= n[0]), None)
                if not (i0 and days[i0 - 1] in v1 and days[i0] in v1 and cl.get(days[i0 - 1]) and cl.get(days[i0])):
                    continue
                pr = cl[days[i0]] / cl[days[i0 - 1]]
                capr = v1[days[i0]] / v1[days[i0 - 1]]
                if abs(math.log(pr)) < math.log(1.5) and abs(math.log(capr)) > math.log(1.9):
                    earlier = sum(1 for d in days if d < n[0] and d in v1)
                    a["S_split_ledger_gap_suspect"].append([pt, ck, n[0], round(r, 4), k, p[3], n[3], earlier])
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
            pts_ = [c[1] for c in comps[cik][-1][3] if (c[3] or "") == "listed"]
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
    sh = [r["shadow"] for r in rows]
    tot = lambda key: dict(sum((Counter(x[key]) for x in sh), Counter()).most_common())
    cur = [x["current"] for x in sh if x["current"]]
    out["shadow"] = {"before_valued_v1_missing_by_reason": tot("before_valued_v1_missing"),
                     "both_valued_diff_buckets": tot("both_valued_diff"),
                     "material_diff_cause_sessions": tot("material_diff_cause"),
                     "current_compared": len(cur),
                     "current_within_0_5pct": sum(1 for c in cur if abs(c["rel"]) < 0.005),
                     "current_within_5pct": sum(1 for c in cur if abs(c["rel"]) < 0.05),
                     "current_material": sorted(([r["ticker"], round(r["shadow"]["current"]["rel"], 4)] for r in rows
                                                 if r["shadow"]["current"] and abs(r["shadow"]["current"]["rel"]) >= 0.05),
                                                key=lambda x: -abs(x[1]))[:60],
                     "securities_losing_all_history": sorted(r["ticker"] for r in rows if r["before"]["valued"] and not r["v1"]["valued"])}
    out["contamination"] = {"securities": sum(1 for r in rows if r["contaminated_before_sessions"]),
                            "before_sessions": sum(r["contaminated_before_sessions"] for r in rows)}
    out["worst50_before_missing"] = sorted(([r["ticker"], r["expected_sessions"] - r["before"]["valued"],
                                             r["expected_sessions"] - r["v1"]["valued"]] for r in rows), key=lambda x: -x[1])[:50]
    out["worst50_v1_missing"] = sorted(([r["ticker"], r["expected_sessions"] - r["v1"]["valued"],
                                         dict(Counter(r["v1_reasons_all"]).most_common(2))] for r in rows), key=lambda x: -x[1])[:50]
    for k in ("A_v1_unexplained_internal_gap", "B_state_older_than_365d_in_use", "C_share_jump_over_10x",
              "D_cap_jump_not_explained_by_price", "E_ticker_reuse_contamination_BEFORE", "F_v1_cap_before_listing",
              "G_multi_class_same_price_ticker", "J_cap_disagrees_with_state_x_price", "L_known_before_public",
              "M_lookahead_state_before_known", "N_constant_cap_moving_price", "O_price_move_without_cap_move",
              "P_order_of_magnitude", "S_split_ledger_gap_suspect"):
        anomalies.setdefault(k, [])
    out["anomalies"] = {k: {"count": len(v), "securities": len({x[0] for x in v}), "examples": v[:25]} for k, v in sorted(anomalies.items())}
    for k in ("P_order_of_magnitude", "D_cap_jump_not_explained_by_price"):
        out["anomalies"][k]["by_cause"] = dict(Counter(x[-1] for x in anomalies[k]))
        out["anomalies"][k]["securities_by_cause"] = {c: len({x[0] for x in anomalies[k] if x[-1] == c})
                                                       for c in {x[-1] for x in anomalies[k]}}
    out["anomalies"]["C_share_jump_over_10x"]["by_continuity"] = dict(Counter(x[-1] for x in anomalies["C_share_jump_over_10x"]))
    out["anomalies"]["C_share_jump_over_10x"]["discontinuous_examples"] = [
        x for x in anomalies["C_share_jump_over_10x"] if x[-1] == "CAP_DISCONTINUOUS"][:30]
    out["anomalies"]["K_duplicate_dates"] = {"count": 0, "note": "impossible by the cap_daily (cik, d) primary key"}
    sp = anomalies["S_split_ledger_gap_suspect"]
    first_by_sec = {}
    for x in sp:
        first_by_sec.setdefault(x[0], x)
    out["anomalies"]["S_split_ledger_gap_suspect"]["valued_sessions_before_first_suspect"] = sum(x[-1] for x in first_by_sec.values())
    out["anomalies"]["S_split_ledger_gap_suspect"]["by_factor"] = dict(Counter(x[4] for x in sp).most_common(12))
    out["stale_internal_subreasons"] = {k: {"sessions": v, "securities": len(stale_sub_sec[k]), "examples": stale_examples[k]}
                                        for k, v in stale_sub.most_common()}
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
