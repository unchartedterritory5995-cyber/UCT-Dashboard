"""mm21 — EXPLAIN every non-exact golden4 cell of the FINAL V2c2 artifact, name by name.

Inputs: corr_<D>_<u>.npz (mm21_corr: the correction's own EMA + every compared price) and
orc_<D>_<u>.npz (mm21_oracle: the independent oracle's). Nothing is tuned and no tolerance
decides a pass: the per-name comparisons of both sides are REPLAYED and must reproduce, to the
digit, the artifact's stored cell AND the oracle's cell. Then every (name, bucket) whose
above-EMA verdict differs is listed with both EMAs, both prices, and an EXACT-ARITHMETIC EMA
(fractions.Fraction over the same frame closes and dividend ratios) to say which side the true
number is on.

Classification (declared before looking):
  EXPLAINED — NUMERIC/EMA TIE  iff (a) both replays reproduce their cells exactly, (b) the two
     sides agree on WHO is comparable (valid masks identical) and on every price bitwise,
     (c) every differing verdict is a name whose price and EMA are within 1e-9 relative on BOTH
     sides, and the two EMAs differ only in float rounding (|Δ| ≤ 1e-9 relative).
  anything else → UNEXPLAINED (with the evidence), never forced.
"""
import bisect, collections, json, math, os, sqlite3, sys
from fractions import Fraction
import mm21_common as mc
os.environ["V2C2_TAG"] = mc.TAG
os.environ["GUARD_BOUNDARIES"] = "/data/_audit/validation/v2c_final/out/guard_oracle_boundaries_%s.json" % mc.TAG
mc.arm_guard()
import numpy as np
import oracle2, oracle3

A = 2.0 / 21
REL = 1e-9


def pct_series(PXb, cls, ema):
    """PXb: names x buckets, cls: names (official close). Returns (o,h,l,c) + per-column counts."""
    def col(v):
        have = np.isfinite(v) & (v > 0)
        valid = have & np.isfinite(ema)
        with np.errstate(invalid="ignore"):
            ab = (v > ema) & valid
        t = int(valid.sum())
        return (round(float(ab.sum() / t * 100), 1) if t else None), int(ab.sum()), t, ab, valid
    ser = [col(PXb[:, j]) for j in range(PXb.shape[1])]
    c = col(cls)
    vals = [s[0] for s in ser if s[0] is not None]
    o, h, l = vals[0], max(vals), min(vals)
    return {"o": o, "h": max(h, o, c[0]), "l": min(l, o, c[0]), "c": c[0]}, ser, c


def exact_ema(t, D, dapp):
    i = bisect.bisect_left(oracle3.CAL, D)
    fr = oracle3.CAL[max(0, i - 380):i]
    pos = {d: k for k, d in enumerate(fr)}
    xs = [oracle2.gfile(d, True).get(t) for d in fr]
    fac = [Fraction(1)] * len(fr)
    for s, ratio in dapp.get(t, ()):
        if fr[0] < s <= fr[-1]:
            for k in range(pos[s]):
                fac[k] *= Fraction(ratio)
    a = Fraction(2, 21)
    out, w = None, Fraction(1)
    for x, f in zip(xs, fac):
        if out is None:
            if x is not None:
                out, w = Fraction(x) * f, Fraction(1)
            continue
        w *= (1 - a)
        if x is not None:
            out = (w * out + a * Fraction(x) * f) / (w + a)
            w = Fraction(1)
    flat = 0
    for x in reversed(xs):
        if x is None or x != xs[-1]:
            break
        flat += 1
    return out, flat, xs[-25:], [(s, r) for s, r in dapp.get(t, ()) if fr[0] < s <= fr[-1]], (fr[0], fr[-1])


def main():
    art = sqlite3.connect("file:%s?mode=ro&immutable=1" % mc.ART, uri=True)
    corr_tab = json.load(open("/data/_audit/v2cc/inputs_%s/dividend_basis_table.json" % mc.TAG))["applied"]
    dapp, _wh = oracle3.build_dividends(json.load(open(oracle2.IN + "/pit_reference.json")))
    rows, report = [], []
    for x in mc.cells():
        D, u = x["date"], x["u"]
        cz = np.load(os.path.join(mc.OUTDIR, "corr_%s_%s.npz" % (D, u)))
        oz = np.load(os.path.join(mc.OUTDIR, "orc_%s_%s.npz" % (D, u)))
        cn, on = [str(s) for s in cz["names"]], [str(s) for s in oz["names"]]
        only_c, only_o = sorted(set(cn) - set(on)), sorted(set(on) - set(cn))
        oi = {t: k for k, t in enumerate(on)}
        common = [t for t in cn if t in oi]
        ci = np.array([cn.index(t) for t in common]) if len(common) != len(cn) else np.arange(len(cn))
        oj = np.array([oi[t] for t in common])
        ema_c, ema_o = cz["ema"][ci], oz["ema"][oj]
        PXc, Po, cpx = cz["PX"][ci], oz["P"][oj], oz["cpx"][oj]
        rc, serc, cc = pct_series(PXc[:, 1:], PXc[:, 0], ema_c)
        ro_, sero, co = pct_series(Po, cpx, ema_o)
        st = art.execute("SELECT o,h,l,c,source FROM breadth_daily_ohlc WHERE universe=? AND date=? AND metric='pct_above_20ema'",
                         (u, D)).fetchone()
        stored = {"o": st[0], "h": st[1], "l": st[2], "c": st[3]}
        g4s = {f: x["stored"][f] for f in "ohlc"}
        g4o = {f: x["oracle"][f] for f in "ohlc"}
        repro_c = all(abs(rc[f] - stored[f]) < 1e-9 for f in "ohlc") and stored == g4s
        repro_o = all(abs(ro_[f] - g4o[f]) < 1e-9 for f in "ohlc")
        nb = min(PXc.shape[1] - 1, Po.shape[1])
        diffs = collections.defaultdict(list)
        valid_mismatch = 0
        cols = [("close", cc, co, PXc[:, 0], cpx)] + [(j, serc[j], sero[j], PXc[:, 1 + j], Po[:, j]) for j in range(nb)]
        px_bitdiff = 0
        for lab, a_, b_, pc, po in cols:
            both = np.isfinite(pc) & np.isfinite(po)
            px_bitdiff += int((both & (pc != po)).sum()) + int((np.isfinite(pc) != np.isfinite(po)).sum())
            valid_mismatch += int((a_[4] != b_[4]).sum())
            for k in np.where(a_[3] != b_[3])[0]:
                diffs[common[k]].append((lab, float(pc[k]), float(po[k])))
        fields = [f for f in "ohlc" if abs(stored[f] - g4o[f]) > 1e-9]
        names_ev = []
        tie_ok = repro_c and repro_o and not only_c and not only_o and valid_mismatch == 0 and px_bitdiff == 0
        for t, evs in sorted(diffs.items()):
            k = common.index(t)
            ec, eo = float(ema_c[k]), float(ema_o[k])
            ex, flat, tail, divs, (f0, f1) = exact_ema(t, D, dapp)
            corr_divs = [list(v) for v in corr_tab.get(t, ()) if f0 < v[0] <= f1]
            first = evs[0]
            p = first[1]
            ok_name = (abs(ec - eo) <= REL * abs(ec)) and all(abs(pc - ec) <= REL * abs(pc) and abs(po - eo) <= REL * abs(po)
                                                              for _l, pc, po in evs)
            tie_ok &= ok_name
            ev = {"ticker": t, "buckets_flipped": len(evs), "first_bucket": first[0],
                  "price_corr": repr(first[1]), "price_oracle": repr(first[2]), "price_bitwise_equal": first[1] == first[2],
                  "ema_corr": repr(ec), "ema_oracle": repr(eo), "ema_bitwise_equal": ec == eo, "ema_delta": ec - eo,
                  "corr_verdict_above": p > ec, "oracle_verdict_above": first[2] > eo,
                  "price_minus_ema_corr": p - ec, "price_minus_ema_oracle": first[2] - eo,
                  "exact_ema": float(ex) if ex is not None else None,
                  "exact_price_minus_ema_sign": (0 if ex is None else (1 if Fraction(p) > ex else (-1 if Fraction(p) < ex else 0))),
                  "exact_agrees_with": ("both" if ex is not None and (Fraction(p) > ex) == (p > ec) == (first[2] > eo) else
                                        "correction" if ex is not None and (Fraction(p) > ex) == (p > ec) else
                                        "oracle" if ex is not None and (Fraction(p) > ex) == (first[2] > eo) else "neither"),
                  "trailing_constant_closes": flat, "last_closes": tail[-8:],
                  "in_frame_dividends_oracle": divs, "in_frame_dividends_correction": corr_divs,
                  "dividend_ratios_identical": [list(d) for d in divs] == corr_divs,
                  "tie_criteria_met": ok_name}
            names_ev.append(ev)
        # numerator / denominator on the differing field(s)
        nd = {}
        for f in fields:
            if f == "c":
                nd[f] = {"corr": [cc[1], cc[2]], "oracle": [co[1], co[2]]}
            else:
                tgt_c, tgt_o = stored[f], g4o[f]
                jc = next((j for j in range(nb) if serc[j][0] == tgt_c), None)
                jo = next((j for j in range(nb) if sero[j][0] == tgt_o), None)
                nd[f] = {"corr_bucket": jc, "corr": [serc[jc][1], serc[jc][2]] if jc is not None else None,
                         "oracle_bucket": jo, "oracle": [sero[jo][1], sero[jo][2]] if jo is not None else None,
                         "corr_at_oracle_bucket": [serc[jo][1], serc[jo][2]] if jo is not None else None,
                         "oracle_at_corr_bucket": [sero[jc][1], sero[jc][2]] if jc is not None else None}
        cls = "EXPLAINED — NUMERIC/EMA TIE" if (tie_ok and names_ev) else "UNEXPLAINED"
        row = {"date": D, "universe": u, "artifact": stored, "oracle": g4o,
               "difference": {f: round(stored[f] - g4o[f], 4) for f in "ohlc"}, "fields_differing": fields,
               "numerator_denominator": nd, "members_corr": len(cn), "members_oracle": len(on),
               "names_only_corr": only_c, "names_only_oracle": only_o, "valid_mask_mismatches": valid_mismatch,
               "price_bitwise_mismatches": px_bitdiff, "replay_reproduces_artifact": repro_c,
               "replay_reproduces_oracle": repro_o, "replay_corr": rc, "replay_oracle": ro_,
               "names": names_ev, "classification": cls}
        rows.append(row)
        print(D, u, fields, cls, [(e["ticker"], e["buckets_flipped"], e["ema_delta"], e["price_minus_ema_corr"],
                                   e["exact_agrees_with"], e["trailing_constant_closes"]) for e in names_ev], flush=True)
    summ = {"cells": len(rows), "classes": dict(collections.Counter(r["classification"] for r in rows)),
            "tickers": dict(collections.Counter(e["ticker"] for r in rows for e in r["names"])),
            "exact_arithmetic_sides": dict(collections.Counter(e["exact_agrees_with"] for r in rows for e in r["names"]))}
    print(json.dumps(summ, indent=1))
    p = os.path.join(mc.OUTDIR, "mm21_explain_%s.json" % mc.TAG)
    with open(p, "x") as f:
        json.dump({"summary": summ, "cells": rows}, f, indent=1, default=str)
    print(p)


main()
