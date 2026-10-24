"""Textbook withhold gate for member drawings (recert B, round 2).

A member drawing row is served only when the chart also meets the textbook context the strict blind rubric scores:
the row's own geometry is NOT changed, the gate only withholds. Pure functions on completed daily bars
({t,o,h,l,c,v}, oldest first, the last one the as-of session); no I/O. Byte-for-byte the lab rule that passed its
pre-registered blind round (tests/test_textbook_gate.py carries the parity rail).

Gates (each released by its own member literal in auto_structures):
  * the inside-day drawing (draw:inside-day), INSIDE_DAY_GATE_ROUND -- passed recert B round 2 (pooled 2.585);
  * the flat top (uct_flat_top_breakout), the shelf pivot (draw:shelf-pivot) and the double bottom
    (draw:double-bottom), PIVOT_GATE_ROUND -- INTERIM removal-only guards (coordinator ruling 2026-10-24): each
    failed the strict round 1 as served (pooled 2.01 / 1.57 / 2.005); with this gate, report-only blind packets
    scored 2.46 / 2.52 / 2.55 (2 judges, n 25 / 25 / 20). Their formal fix round is pending.
  TREND (Minervini trend template; O'Neil): close > SMA200; SMA200 above its value 20 AND 60 sessions earlier and at
     least 2% above the 60-session-old value; SMA50 > SMA200; SMA50 not below its value 10 sessions earlier; close
     within 15% of the 252-session high.
  INSIDE DAY: a true inside bar (high <= mother high, low >= mother low); inside range <= 60% of the mother range;
     close <= 6% above the SMA50; trigger - stop <= 1.0 ATR(14); the stop within 0.05 ATR of today's or the mother's
     low, the trigger within 0.05 ATR of today's or the mother's high.
"""

#: The gate round the blind check confirmed for the inside-day drawing (lab recert B round 2).
INSIDE_DAY_GATE_ROUND = 1

MIN_BARS = 261


def _sma(c, n, end):
    if end + 1 < n:
        return None
    return sum(c[end - n + 1:end + 1]) / n


def _atr(b, end, n=14):
    trs = []
    for i in range(max(1, end - n + 1), end + 1):
        trs.append(max(b[i]["h"] - b[i]["l"], abs(b[i]["h"] - b[i - 1]["c"]), abs(b[i]["l"] - b[i - 1]["c"])))
    return sum(trs) / len(trs) if trs else None


def common(bars) -> dict:
    """The trend facts of the as-of bar (the last one)."""
    c = [x["c"] for x in bars]
    i = len(bars) - 1
    f = {"close": c[i]}
    f["sma50"], f["sma200"] = _sma(c, 50, i), _sma(c, 200, i)
    f["sma50_10"], f["sma200_20"] = _sma(c, 50, i - 10), _sma(c, 200, i - 20)
    f["sma200_60"] = _sma(c, 200, i - 60)
    f["tt_200_rising_3m"] = f["sma200_60"] is not None and f["sma200"] is not None and f["sma200"] > f["sma200_60"]
    f["sma200_slope_3m"] = (f["sma200"] / f["sma200_60"] - 1) if (f["sma200_60"] and f["sma200"]) else None
    w = bars[max(0, i - 251):i + 1]
    f["hi252"] = max(x["h"] for x in w)
    f["atr"] = _atr(bars, i)
    ok = None not in (f["sma50"], f["sma200"], f["sma50_10"], f["sma200_20"])
    f["tt_50_over_200"] = ok and f["sma50"] > f["sma200"]
    f["tt_50_rising"] = ok and f["sma50"] >= f["sma50_10"]
    f["tt_200_rising"] = ok and f["sma200"] > f["sma200_20"]
    f["tt_close_over_200"] = ok and c[i] > f["sma200"]
    f["off_high"] = 1 - c[i] / f["hi252"]
    f["vol50"] = sum(x["v"] for x in bars[max(0, i - 50):i]) / max(1, min(50, i))
    f["rvol"] = bars[i]["v"] / f["vol50"] if f["vol50"] else None
    return f


def trend_fails(f, strict=True) -> list:
    r = []
    if not f["tt_close_over_200"]:
        r.append("close<=sma200")
    if not f["tt_200_rising"]:
        r.append("sma200_not_rising")
    if not f["tt_200_rising_3m"]:
        r.append("sma200_not_rising_3m")
    if f["sma200_slope_3m"] is None or f["sma200_slope_3m"] < 0.02:
        r.append("sma200_slope<2%")
    if not f["tt_50_over_200"]:
        r.append("sma50<=sma200")
    if strict:
        if not f["tt_50_rising"]:
            r.append("sma50_falling")
        if f["off_high"] > 0.15:
            r.append("off_high>15%")
    elif f["off_high"] > 0.35:
        r.append("off_high>35%")
    return r


def inside_day_fails(bars, row) -> list:
    """The failed rule names for one draw:inside-day row on `bars` (ending at its as-of bar); [] = served.
    Too short a history, a malformed row or any arithmetic failure fails closed."""
    try:
        if len(bars or []) < MIN_BARS:
            return ["short_history"]
        d = ((row.get("geometry") or {}).get("extras") or {})["draw_inside_day"]
        f = common(bars)
        a = f["atr"]
        m, x = bars[-2], bars[-1]
        r = trend_fails(f)
        if not (x["h"] <= m["h"] and x["l"] >= m["l"]):
            r.append("I1_not_inside")
        ratio = (x["h"] - x["l"]) / (m["h"] - m["l"]) if m["h"] > m["l"] else None
        if ratio is None or ratio > 0.60:
            r.append("I3_wide")
        ext50 = bars[-1]["c"] / f["sma50"] - 1 if f["sma50"] else None
        if ext50 is None or ext50 > 0.06:
            r.append("I6_extended")
        risk = (d["trigger"] - d["stop"]) / a if a else None
        if risk is None or risk > 1.0:
            r.append("I5_risk")
        so = min(abs(d["stop"] - x["l"]), abs(d["stop"] - m["l"])) / a if a else None
        if so is None or so > 0.05:
            r.append("I5_stop_not_at_a_low")
        to = min(abs(d["trigger"] - x["h"]), abs(d["trigger"] - m["h"])) / a if a else None
        if to is None or to > 0.05:
            r.append("I4_trigger_not_at_a_high")
        return r
    except Exception:  # noqa: BLE001 -- an unreadable row is not served
        return ["unreadable"]


# ------------------------------------------------------------------ the pivot family (recert B fix round 1)

#: The interim gate round for the flat top, the shelf pivot and the double bottom (lab recert B gate_r2, final).
PIVOT_GATE_ROUND = 1


def _idx_of(bars, t):
    t = int(t)
    for j, x in enumerate(bars):
        if x["t"] >= t:
            return j
    return len(bars) - 1


def _level_facts(bars, level, start_t):
    s = _idx_of(bars, start_t)
    i = len(bars) - 1
    seg = bars[s:i + 1]
    cross = sum(1 for a, b in zip(seg, seg[1:]) if (a["c"] - level) * (b["c"] - level) < 0)
    cut = sum(1 for x in seg[:-1] if min(x["o"], x["c"]) < level < max(x["o"], x["c"]))
    hi = max(x["h"] for x in seg[:-1]) if len(seg) > 1 else level
    return {"span": i - s, "cross": cross, "bodies_cut": cut, "max_above_pct": hi / level - 1,
            "dist_pct": bars[i]["c"] / level - 1}


def _tests(bars, level, start_t, atr, tol=0.015, sw=3):
    """Separate tests of a ceiling: swing highs (the high of +-sw bars) from start_t to yesterday within tol of the
    level, each >= 5 bars after the previous counted test with a retreat of >= 1 ATR below the level in between.
    (count, offset of the first test from start_t)."""
    s = max(_idx_of(bars, start_t) - 2, sw)
    i = len(bars) - 1
    got = []
    for j in range(s, i):
        lo_, hi_ = max(0, j - sw), min(i, j + sw)
        h = bars[j]["h"]
        if h < max(x["h"] for x in bars[lo_:hi_ + 1]) or abs(h / level - 1) > tol:
            continue
        if got:
            k = got[-1]
            if j - k < 5 or min(x["l"] for x in bars[k:j + 1]) > level - atr:
                continue
        got.append(j)
    if not got:
        return 0, None
    return len(got), got[0] - _idx_of(bars, start_t)


def _left_high(bars, level, start_t, pad=20):
    s = max(0, _idx_of(bars, start_t) - pad)
    seg = bars[s:len(bars) - 1]
    return max(x["h"] for x in seg) / level - 1 if seg else 0.0


def _flat_top(bars, ex, f):
    d = ex["draw_flat_top"]
    a = f["atr"]
    lv = _level_facts(bars, d["price"], d["start_t"])
    ts = sorted(int(m["t"]) for m in d.get("touches") or [])
    ix = [_idx_of(bars, t) for t in ts]
    first_to_now = len(bars) - 1 - ix[0] if ts else 0
    min_gap = min((q - p for p, q in zip(ix, ix[1:])), default=0)
    n_tests, _off = _tests(bars, d["price"], d["start_t"], a)
    r = trend_fails(f, True)
    if first_to_now < 25:
        r.append("F2_short")
    if len(ts) < 3 or min_gap < 5:
        r.append("F2_cluster")
    if n_tests < 3:
        r.append("F2_tests")
    if _left_high(bars, d["price"], d["start_t"]) > 0.0075:
        r.append("F3_left_high")
    if lv["max_above_pct"] > 0.015:
        r.append("F3_higher_high")
    bd = ex.get("base_depth")
    if bd is None or not (0.03 <= bd <= 0.20):
        r.append("F4_depth")
    if not (-0.03 <= lv["dist_pct"] <= 0.05):
        r.append("F5_dist")
    if lv["dist_pct"] > 0 and (f["rvol"] or 0) < 1.5:
        r.append("F6_volume")
    return r


def _shelf(bars, ex, f):
    d = ex["draw_shelf"]
    a = f["atr"]
    lv = _level_facts(bars, d["price"], d["start_t"])
    n_tests, off = _tests(bars, d["price"], d["start_t"], a)
    n_tests10, _o = _tests(bars, d["price"], d["start_t"], a, tol=0.010)
    r = trend_fails(f, True)
    if (d.get("touch_groups") or 0) < 3 or lv["span"] < 20:
        r.append("S2_loose")
    if n_tests < 3 or off is None or abs(off) > 3:
        r.append("S2_tests")
    if n_tests10 < 3:
        r.append("S2_tests10")
    if _left_high(bars, d["price"], d["start_t"]) > 0.010:
        r.append("S3_left_high")
    if lv["span"] > 130:
        r.append("S4_stale_span")
    if lv["max_above_pct"] > 0.015:
        r.append("S3_higher_high")
    if lv["cross"] > 2 or lv["bodies_cut"] > 3:
        r.append("S6_chop")
    if not (-0.05 <= lv["dist_pct"] <= 0.005):
        r.append("S5_dist")
    return r


def _double_bottom(bars, ex, f):
    d = ex["draw_shape"]
    mk = {m["kind"]: m for m in d.get("marks") or []}
    lip, l1, mp, l2 = (mk.get(k) for k in ("lip", "low1", "middle_peak", "low2"))
    g = {}
    if lip and l1 and mp and l2:
        lo = min(l1["price"], l2["price"])
        g["undercut"] = 1 - l2["price"] / l1["price"]
        g["mid_rally"] = mp["price"] / l1["price"] - 1
        g["mid_pos"] = (mp["price"] - lo) / (lip["price"] - lo) if lip["price"] > lo else None
        a_, b_, c_, d_ = (_idx_of(bars, m["t"]) for m in (lip, l1, mp, l2))
        g["gaps"] = min(b_ - a_, c_ - b_, d_ - c_)

        def seg(u, v):
            return bars[min(u, v):max(u, v) + 1]
        g["extremes"] = (max(x["h"] for x in seg(a_, b_)) <= lip["price"] * 1.005
                         and min(x["l"] for x in seg(a_, c_)) >= l1["price"] * 0.995
                         and max(x["h"] for x in seg(b_, d_)) <= mp["price"] * 1.005
                         and min(x["l"] for x in seg(c_, len(bars) - 1)) >= l2["price"] * 0.995)
        g["mp_below_lip"] = mp["price"] <= lip["price"] * 1.0
    dist = bars[-1]["c"] / d["pivot"] - 1
    li = _idx_of(bars, d["start_t"])
    pre = bars[max(0, li - 120):li + 1]
    prior_adv = (lip["price"] if lip else d["pivot"]) / min(x["l"] for x in pre) - 1 if pre else None
    r = trend_fails(f, False)
    u = g.get("undercut")
    if u is None or not (-0.02 <= u <= 0.06):
        r.append("D2_undercut")
    if (g.get("mid_rally") or 0) < 0.10:
        r.append("D2_mid_rally")
    if not (0.15 <= (d.get("depth") or 0) <= 0.35) or (d.get("len") or 0) < 35:
        r.append("D3_depth_len")
    if g.get("mid_pos") is None or g["mid_pos"] < 0.6:
        r.append("D4_mid_low")
    if g.get("gaps", 0) < 5:
        r.append("D5_cramped")
    if (prior_adv or 0) < 0.30:
        r.append("D1_prior_adv")
    if not (-0.05 <= dist <= 0.03):
        r.append("D6_dist")
    if not g.get("extremes"):
        r.append("D5_not_extremes")
    if not g.get("mp_below_lip", False):
        r.append("D4_peak_over_lip")
    if dist > 0 and (f["rvol"] or 0) < 1.4:
        r.append("D7_volume")
    return r


_PIVOT_GATES = {"uct_flat_top_breakout": ("draw_flat_top", _flat_top),
                "draw:shelf-pivot": ("draw_shelf", _shelf),
                "draw:double-bottom": ("draw_shape", _double_bottom)}
PIVOT_GATE_IDS = frozenset(_PIVOT_GATES)


def end_of(row):
    """The as-of session a gated row was drawn for (its drawing stamp's end_t), or None."""
    ex = ((row or {}).get("geometry") or {}).get("extras") or {}
    pid = (row or {}).get("pattern_id")
    if pid == "draw:inside-day":
        key = "draw_inside_day"
    elif pid in _PIVOT_GATES:
        key = _PIVOT_GATES[pid][0]
    else:
        return None
    d = ex.get(key) or {}
    return int(d["end_t"]) if d.get("end_t") is not None else None


def pivot_fails(bars, row) -> list:
    """The failed rule names for one flat-top / shelf / double-bottom row on `bars` (ending at its as-of bar);
    [] = served. Too short a history, a malformed row or any arithmetic failure fails closed."""
    try:
        if len(bars or []) < MIN_BARS:
            return ["short_history"]
        ex = (row.get("geometry") or {}).get("extras") or {}
        _key, fn = _PIVOT_GATES[row["pattern_id"]]
        return fn(bars, ex, common(bars))
    except Exception:  # noqa: BLE001 -- an unreadable row is not served
        return ["unreadable"]
