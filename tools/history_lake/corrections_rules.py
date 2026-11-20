"""The rules that decide every entry of the daily corrections ledger (price-data unit; owner decisions D1-D6 and the
rulings of 2026-11-20). PURE: no network, no store, no files. tools/history_lake/daily_corrections.py feeds it and
publishes what it returns; api/services/bars_corrections.py applies the published entries by compare-and-set.

THE STANDARD (D3): right = two independent sources agreeing, never TradingView. The vendor's own minute file is the
same vendor but a different product, and every entry built on it says so in its label.

  D2   a day's high/low is ONE lone minute print (>= 1% beyond its own minute's body and beyond every other minute), the
       next-most-extreme minute agrees with Yahoo within 0.15%, and the day is >= 1% outside Yahoo with its open and
       close within 0.5% and both neighbours within 0.2%: the field becomes Yahoo's value.
  D2b  the day's high/low is in NO minute of the vendor's file and the minute extreme agrees with Yahoo: likewise.
  D6   an isolated close >= 1% off Yahoo: the vendor's last regular-hours minute close agrees with Yahoo within 0.5% and
       not with ours -> Yahoo's close. Minute agrees with ours -> "unresolved, kept". Long runs are a series-level
       class (another security under the ticker), never D6.
  D5   a stored pre-vendor row whose o/h/l/c ALL equal Yahoo's rounded to 2 dp -> Yahoo's values at 4 dp.
  D4   in the Yahoo-sourced segment, a zero-volume bar with o = h = l = c = the previous close (the stock did not trade
       that day) is dropped.
  D1   a wick the serve-time clamp would trim, which a SECOND vendor shows independently (Yahoo's bar is not a copy of
       ours: its volume differs), is kept. Pre-vendor bars: "pre-vendor, status quo" (trimmed as today).
  W/M  stored weekly/monthly rows are re-derived from the corrected dailies only where they derive from the stored
       dailies today; rebuilt W/M derive at serve time.
Minute files are RAW prices: every comparison is scaled by f = ours / raw on an undisputed field of the vendor's raw
day bar. Rows priced under MIN_PRICE are never corrected (a corrupt series is a data-identity case, not D2/D6).
"""
from __future__ import annotations

import datetime as dt
import statistics
from collections import Counter

FLOOR = "2003-09-10"          # the vendor's minute/day archive starts here
WICK = 1.40                   # bars_sanitize._WICK
D2_MIN, BODY_TOL, NB_TOL = 0.01, 0.005, 0.002
LONE_GAP, D2_AGREE = 0.01, 0.0015
D6_MIN, D6_AGREE = 0.01, 0.005
D1_CONFIRM = 0.02
MIN_PRICE = 0.05
F = "ohlc"
RULES = {"D2": "d2-lone-minute+yahoo v1", "D2b": "d2b-in-no-minute+yahoo v1", "D6": "d6-minute-close+yahoo v1",
         "D5": "d5-2dp-yahoo-refetch v1", "D4": "d4-zero-volume-filler v1", "D1": "d1-second-vendor-confirms v1"}
LABEL_MINUTE = "the vendor's minute file (same vendor, different product) + Yahoo, against the vendor's day value"


def vend(sym: str) -> str:
    return sym.replace("-", ".")


def minute_sym(sym: str, rec, d: str) -> str:
    """The vendor symbol a date's minute rows are filed under (the rebuild's lineage segments)."""
    for seg in (rec or {}).get("segments") or ():
        if seg["from"] <= d < seg["until"]:
            return seg["sym"]
    return vend(sym)


def vendor_start(rec) -> str:
    if not rec or not rec.get("bars"):
        return FLOOR
    pre = rec.get("pre") or {}
    n = int(pre.get("bars") or 0) if pre.get("joined") else 0
    b = rec["bars"]
    return max(FLOOR, b[n][0]) if n < len(b) else FLOOR


def store_vendor_start(bars, yf):
    """Where a STORED series' Yahoo-sourced head ends: the first of 5 consecutive shared rows (non-zero volume) whose
    volume is not Yahoo's exactly. None: the stored series is Yahoo's throughout."""
    flags = [(i, abs(b[5] - yf[b[0]][4]) < 0.5) for i, b in enumerate(bars) if b[0] in yf and b[5] > 0 and yf[b[0]][4] > 0]
    for j in range(len(flags) - 4):
        if not any(fl for _, fl in flags[j:j + 5]):
            return bars[flags[j][0]][0]
    return None


def is_filler(bars, i) -> bool:
    if i == 0:
        return False
    o, h, l, c, v = bars[i][1:6]
    return v == 0 and o == h == l == c and abs(bars[i - 1][4] - c) <= 1e-9 * max(1.0, c)


def is_2dp(x) -> bool:
    return abs(x * 100 - round(x * 100)) < 1e-6


def clamp_hits(bars):
    """bars_sanitize._clamp_wicks's own test: [(i, field, trimmed value)]."""
    n, out = len(bars), []
    for i in range(n):
        o, h, l, c = bars[i][1:5]
        if h <= 0 or l <= 0:
            continue
        bh, bl = max(o, c), min(o, c)
        ph = bars[i - 1][2] if i > 0 else h
        nh = bars[i + 1][2] if i < n - 1 else h
        pl = bars[i - 1][3] if i > 0 else l
        nl = bars[i + 1][3] if i < n - 1 else l
        if bh > 0 and h > bh * WICK and h > max(ph, nh) * WICK:
            out.append((i, "h", round(max(bh, ph, nh), 4)))
        if bl > 0 and l < bl / WICK and l < min(pl, nl) / WICK:
            out.append((i, "l", round(min(bl, pl, nl), 4)))
    return out


def rolling_basis(ratios, half=10):
    out = []
    for i in range(len(ratios)):
        w = ratios[max(0, i - half): i + half + 1]
        out.append(statistics.median(w))
    return out


def raw_factor(raw, ours, ref, check):
    """f with adjusted = raw x f, from the undisputed field `ref`; None when the stored row is not the vendor's day bar."""
    if not raw or not raw[ref] or not ours[ref]:
        return None
    f = ours[ref] / raw[ref]
    if not raw[check] or abs(ours[check] / (raw[check] * f) - 1) > 0.005:
        return None
    return f


def d2_verdict(m, field, ours_bar, yk, raw):
    """("D2" | "D2b" | a reason, evidence). `ours_bar` = [o, h, l, c, v]; `yk` = Yahoo's value on our basis."""
    if not m or not m.get("n"):
        return "no_minutes", None
    f = raw_factor(raw, ours_bar, 3, 0)
    if f is None:
        return ("no_raw_day_bar" if not raw else "stored_row_not_the_vendor_day_bar"), {"raw": raw}
    lo = field == "l"
    ours_val = ours_bar[2] if lo else ours_bar[1]
    sets = []
    for pre in ("rth_", ""):
        ext = m.get(pre + ("low" if lo else "high"))
        if ext is not None and abs(ext * f - ours_val) <= max(5e-4 * ours_val, 0.006):
            sec = m.get(pre + ("low2" if lo else "high2"))
            bar = m.get(pre + ("low_bar" if lo else "high_bar"))
            sets.append((pre or "all_", ext * f, [x * f for x in bar], sec * f if sec else None, m.get(pre + ("low_at" if lo else "high_at"))))
    if not sets:
        rx = m.get("rth_low" if lo else "rth_high")
        ev = {"rth_extreme": round(rx * f, 4) if rx else None, "f": round(f, 6), "label": LABEL_MINUTE,
              "why": "the day value is in NO minute of the vendor's minute file"}
        if rx and abs(rx * f / yk - 1) <= D2_AGREE:
            return "D2b", ev
        return "day_value_not_in_minutes", ev
    which, ext, bar, sec, at = sets[0]
    gb = (1 - ext / min(bar[0], bar[3])) if lo else (ext / max(bar[0], bar[3]) - 1)
    g2 = ((1 - ext / sec) if lo else (ext / sec - 1)) if sec else 0
    ev = {"set": which.rstrip("_"), "ext": round(ext, 4), "at": at, "minute_body": [round(bar[0], 4), round(bar[3], 4)],
          "gap_body": round(gb, 4), "gap_2nd": round(g2, 4), "next": round(sec, 4) if sec else None, "f": round(f, 6),
          "label": LABEL_MINUTE}
    if not (gb >= LONE_GAP and g2 >= LONE_GAP):
        return "spread_real_move", ev
    if not (sec and abs(sec / yk - 1) <= D2_AGREE):
        return "lone_but_no_yahoo_agreement", ev
    return "D2", ev


def d6_verdict(m, ours_bar, yk, raw):
    if not m or not m.get("n") or m.get("rth_close") is None:
        return "unresolved_no_minutes", None
    f = raw_factor(raw, ours_bar, 0, 1)
    if f is None:
        return ("unresolved_no_raw_day_bar" if not raw else "unresolved_stored_row_not_the_vendor_day_bar"), {"raw": raw}
    x = m["rth_close"] * f
    ev = {"m": round(x, 4), "m_at": m.get("rth_close_at"), "vendor_day_close": round(raw[3] * f, 4), "f": round(f, 6),
          "label": LABEL_MINUTE}
    ay, ao = abs(x / yk - 1) <= D6_AGREE, abs(x / ours_bar[3] - 1) <= D6_AGREE
    if ay and not ao:
        return "D6", ev
    if ao:
        return "unresolved_kept_minute_agrees_ours", ev
    return "unresolved_kept_neither", ev


def _agg(rows):
    if not rows:
        return None
    return [rows[0][1], max(r[2] for r in rows), min(r[3] for r in rows), rows[-1][4], sum(r[5] for r in rows)]


def wkey(d: str) -> str:
    x = dt.date.fromisoformat(d)
    return (x + dt.timedelta(days=4 - x.weekday())).isoformat()


def mkey(d: str) -> str:
    return d[:8] + "01"


def _close(a, b, rel=1e-4):
    return abs(a - b) <= rel * max(1.0, abs(b))


def build_ticker(sym: str, *, served: bool, rec, end: str, store: dict, yf: dict, minutes, raw):
    """Every ledger decision for one ticker.

    store: {"D": [[iso, o, h, l, c, v], ...], "W": [...], "M": [...]} (ascending, the snapshot copy);
    served: the ticker is on the rebuild's serve list (its daily series is the rebuild through `end`);
    minutes / raw: {"VSYM|date": stats} from the vendor's minute and raw day files; None = candidates only.
    Returns (rows, entries, stats, candidates): private ledger rows (with evidence), payload entries for
    bars_corrections, counters, and the (vendor symbol, date) pairs whose minute files a decision needs."""
    S, rows, entries, cands = Counter(), [], [], []
    if served and rec:
        bars = [list(b[:6]) + ["rebuild"] for b in rec["bars"] if b[0] <= end]
        bars += [list(r) + ["store"] for r in store.get("D") or () if r[0] > end]
        npre = int((rec.get("pre") or {}).get("bars") or 0) if (rec.get("pre") or {}).get("joined") else 0
        is_pre = [i < npre for i in range(len(bars))]
    else:
        bars = [list(r) + ["store"] for r in store.get("D") or ()]
        svs = store_vendor_start(bars, yf)
        vs = svs if svs is not None else "9999-12-31"
        is_pre = [b[0] < vs for b in bars]
    if len(bars) < 3:
        return rows, entries, S, cands
    yahoo_copy = [bool(b[0] in yf and b[5] > 0 and abs(yf[b[0]][4] - b[5]) < 0.5) for b in bars]
    sets = {}                                    # i -> {field: (new, decision)}
    evid = {}                                    # i -> {field: evidence}

    def unresolved(decision, i, field, verdict, ev, yk=None):
        b = bars[i]
        rows.append({"sym": sym, "tf": "D", "d": b[0], "src": b[6], "op": "none", "decision": decision, "field": field,
                     "verdict": verdict, "old": b[1:6], "yahoo": yk, "evidence": ev})
        S[f"{decision}_{verdict}"] += 1

    # ── vendor era: D2 / D2b / D6 ──
    idx = [i for i, b in enumerate(bars) if not is_pre[i] and b[0] >= FLOOR and b[0] in yf and yf[b[0]][3]
           and b[4] > 0 and min(b[1:5]) >= MIN_PRICE]
    if len(idx) >= 3:
        k = rolling_basis([bars[i][4] / yf[bars[i][0]][3] for i in idx])
        dev = []
        for q, i in enumerate(idx):
            y = yf[bars[i][0]]
            dev.append([bars[i][1 + j] / (y[j] * k[q]) - 1 if y[j] else 0.0 for j in range(4)])
        n = len(idx)
        for j, f in ((1, "h"), (2, "l")):
            for q in range(n):
                x = dev[q][j]
                wide = x if f == "h" else -x
                if wide < D2_MIN or abs(dev[q][0]) > BODY_TOL or abs(dev[q][3]) > BODY_TOL:
                    continue
                if (q > 0 and abs(dev[q - 1][j]) > NB_TOL) or (q < n - 1 and abs(dev[q + 1][j]) > NB_TOL):
                    continue
                i = idx[q]
                b = bars[i]
                yk = yf[b[0]][j] * k[q]
                ms = minute_sym(sym, rec, b[0])
                S["D2_candidate"] += 1
                if minutes is None:
                    cands.append((ms, b[0]))
                    continue
                v, ev = d2_verdict(minutes.get(f"{ms}|{b[0]}"), f, b[1:6], yk, (raw or {}).get(f"{ms}|{b[0]}"))
                if v in ("D2", "D2b"):
                    new = round(yk, 4)
                    if (f == "l" and new > min(b[1], b[4])) or (f == "h" and new < max(b[1], b[4])):
                        unresolved("D2", i, f, "yahoo_inside_body", ev, round(yk, 4))
                        continue
                    sets.setdefault(i, {})[f] = (new, v)
                    evid.setdefault(i, {})[f] = ev
                    S[f"{v}_set"] += 1
                else:
                    unresolved("D2", i, f, v, ev, round(yk, 4))
        run_days = 0
        for q in range(n):
            x = dev[q][3]
            if abs(x) < D6_MIN:
                continue
            if (q > 0 and abs(dev[q - 1][3]) > BODY_TOL) or (q < n - 1 and abs(dev[q + 1][3]) > BODY_TOL):
                run_days += 1
                continue
            i = idx[q]
            b = bars[i]
            yk = yf[b[0]][3] * k[q]
            ms = minute_sym(sym, rec, b[0])
            S["D6_candidate"] += 1
            if minutes is None:
                cands.append((ms, b[0]))
                continue
            v, ev = d6_verdict(minutes.get(f"{ms}|{b[0]}"), b[1:6], yk, (raw or {}).get(f"{ms}|{b[0]}"))
            new = round(yk, 4)
            lo = sets.get(i, {}).get("l", (b[3],))[0]
            hi = sets.get(i, {}).get("h", (b[2],))[0]
            if v == "D6" and not (lo <= new <= hi):
                v = "unresolved_outside_range"
            if v == "D6":
                sets.setdefault(i, {})["c"] = (new, "D6")
                evid.setdefault(i, {})["c"] = ev
                S["D6_set"] += 1
            else:
                unresolved("D6", i, "c", v, ev, round(yk, 4))
        if run_days:
            S["D6_series_run_days"] += run_days
            rows.append({"sym": sym, "tf": "D", "op": "series_run", "days": run_days})
    if minutes is None:
        return rows, entries, S, cands

    # ── D5: stored pre-vendor rows that are 2-dp copies of Yahoo ──
    if not served:
        for i, b in enumerate(bars):
            if not is_pre[i] or is_filler(bars, i) or not all(is_2dp(x) for x in b[1:5]):
                continue
            y = yf.get(b[0])
            if not y:
                S["D5_no_yahoo_bar"] += 1
                continue
            if all(abs(b[1 + q] - round(y[q], 2)) < 1e-6 for q in range(4)):
                new = [round(float(y[q]), 4) for q in range(4)]
                ch = {F[q]: (new[q], "D5") for q in range(4) if not _close(new[q], b[1 + q], 1e-9)}
                if ch:
                    sets.setdefault(i, {}).update(ch)
                    S["D5_set"] += 1
            else:
                S["D5_not_rounded_yahoo"] += 1

    # ── D4: fillers in the Yahoo-sourced segment ──
    drops = {i for i in range(1, len(bars)) if is_pre[i] and is_filler(bars, i)}
    S["D4_drop"] += len(drops)

    # ── the corrected series, then D1 on it ──
    corr = []
    for i, b in enumerate(bars):
        if i in drops:
            continue
        nb = list(b) + [i]
        for f, (nv, _dec) in sets.get(i, {}).items():
            nb[1 + F.index(f)] = nv
        corr.append(nb)
    keeps = {}
    for j, f, trim_to in clamp_hits(corr):
        i = corr[j][7]
        b = bars[i]
        if is_pre[i] or b[0] < FLOOR:
            S["D1_trim_pre_vendor_status_quo"] += 1
            continue
        y = yf.get(b[0])
        if not y:
            S["D1_trim_no_yahoo_bar"] += 1
            continue
        if yahoo_copy[i]:
            S["D1_trim_yahoo_row_is_a_copy"] += 1
            continue
        lo_i, hi_i = max(0, i - 10), min(len(bars), i + 11)
        rr = [bars[q][4] / yf[bars[q][0]][3] for q in range(lo_i, hi_i) if bars[q][0] in yf and yf[bars[q][0]][3]]
        kk = statistics.median(rr) if rr else 1.0
        ours = corr[j][2 if f == "h" else 3]
        yx = (y[1] if f == "h" else y[2]) * kk
        if abs(yx / ours - 1) <= D1_CONFIRM:
            keeps[(i, f)] = ours
            S["D1_keep_second_vendor_confirms"] += 1
        else:
            S["D1_trim_yahoo_disagrees"] += 1

    # ── D entries ──
    for i in sorted(set(sets) | drops):
        b = bars[i]
        if i in drops:
            entries.append({"tf": "D", "src": b[6], "d": b[0], "op": "drop", "old": b[1:6]})
            rows.append({"sym": sym, "tf": "D", "d": b[0], "src": b[6], "op": "drop", "decision": "D4", "old": b[1:6],
                         "rule": RULES["D4"], "recent_key": b[0]})
            continue
        ch = sets[i]
        f_map = {f: [b[1 + F.index(f)], nv] for f, (nv, _d) in ch.items()}
        chk_fields = [x for x in ("c", "o") if x not in f_map]
        chk = {chk_fields[0]: b[1 + F.index(chk_fields[0])]} if chk_fields else {}
        entries.append({"tf": "D", "src": b[6], "d": b[0], "op": "set", "f": f_map, "chk": chk})
        decs = sorted({d for _nv, d in ch.values()})
        rows.append({"sym": sym, "tf": "D", "d": b[0], "src": b[6], "op": "set", "decisions": decs, "f": f_map, "chk": chk,
                     "rules": {f: RULES[d] for f, (_nv, d) in ch.items()}, "evidence": evid.get(i, {}), "recent_key": b[0]})
    for (i, f), v in sorted(keeps.items()):
        b = bars[i]
        entries.append({"tf": "D", "src": b[6], "d": b[0], "op": "keep_wick", "field": f, "value": v})
        rows.append({"sym": sym, "tf": "D", "d": b[0], "src": b[6], "op": "keep_wick", "decision": "D1", "field": f,
                     "value": v, "yahoo": list(yf[b[0]][:5]), "rule": RULES["D1"], "recent_key": b[0]})

    # ── W / M ──
    changed = {bars[i][0] for i in set(sets) | drops}
    if changed:
        for tf, keyf in (("W", wkey), ("M", mkey)):
            before, after = {}, {}
            for b in bars:
                before.setdefault(keyf(b[0]), []).append(b)
            for cb in corr:
                after.setdefault(keyf(cb[0]), []).append(cb)
            stored = {r[0]: r for r in store.get(tf) or ()} if not served else {}
            for pk in sorted({keyf(d) for d in changed}):
                U, C = _agg(before.get(pk)), _agg(after.get(pk))
                if U == C:
                    continue
                if served:
                    rows.append({"sym": sym, "tf": tf, "d": pk, "src": "rebuild", "op": "derived_at_serve", "old": U, "new": C,
                                 "recent_key": pk})
                    S[f"{tf}_rebuild_derived_at_serve"] += 1
                    continue
                s = stored.get(pk)
                if s is None:
                    S[f"{tf}_no_stored_row"] += 1
                    continue
                if C is not None and all(_close(s[1 + q], C[q]) for q in range(4)):
                    S[f"{tf}_already_consistent"] += 1
                    continue
                if C is None:
                    entries.append({"tf": tf, "src": "store", "d": pk, "op": "drop", "old": s[1:6]})
                    rows.append({"sym": sym, "tf": tf, "d": pk, "src": "store", "op": "drop", "old": s[1:6], "recent_key": pk})
                    S[f"{tf}_store_drop"] += 1
                    continue
                if not all(_close(s[1 + q], U[q]) for q in range(4) if U[q] != C[q]):
                    S[f"{tf}_stored_not_derived_from_its_dailies"] += 1   # R2: left unchanged
                    continue
                f_map = {F[q]: [s[1 + q], C[q]] for q in range(4) if U[q] != C[q]}
                chk_fields = [x for x in ("c", "o") if x not in f_map]
                chk = {chk_fields[0]: s[1 + F.index(chk_fields[0])]} if chk_fields else {}
                entries.append({"tf": tf, "src": "store", "d": pk, "op": "set", "f": f_map, "chk": chk})
                rows.append({"sym": sym, "tf": tf, "d": pk, "src": "store", "op": "set", "f": f_map, "chk": chk, "recent_key": pk})
                S[f"{tf}_store_set"] += 1
    return rows, entries, S, cands
