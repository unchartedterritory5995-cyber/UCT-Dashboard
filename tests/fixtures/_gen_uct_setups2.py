"""Fixture generator for the second set of UCT trader-setup detectors.

    uct_launch_pad · uct_gap_support · uct_capitulation · uct_go_signal

Same method as `_gen_uct_setups.py` (whose loaders and writer this reuses): real
daily bars read from the local bars store, opened read-only and immutable, cut
into windows ending on the session that matters, capped at a fixed end date so
a rerun selects the same sessions.

Usage (local only — the committed JSON files are what the tests read):

    python tests/fixtures/_gen_uct_setups2.py --bars-db C:/data/bars.db

Categories: positive (fires on the window's last session) · negative (a real
near-miss that fails ONE named condition, and the detector returns nothing) ·
edge (an intact trigger 1-2 sessions back, the same trigger stopped out, the
window re-priced as a penny stock, and a one-condition edit of a real positive).
"""
from __future__ import annotations

import argparse
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.abspath(os.path.join(_HERE, "..", ".."))
if _REPO not in sys.path:
    sys.path.insert(0, _REPO)

from api.services.pattern_engine.detectors.uct import (  # noqa: E402
    uct_capitulation, uct_gap_support, uct_go_signal, uct_launch_pad,
)
from api.services.pattern_engine.detectors.uct import uct_setups_common as U  # noqa: E402
from tests.fixtures._gen_uct_setups import _TICKERS, _fires, _load, _strip, _write  # noqa: E402

# Windows are as long as production's daily scan (200 bars) or longer where a
# rule needs the history (the four-MA launch pad needs SMA200; record volume
# needs 190 prior sessions).
_DETECTORS = {
    "uct_launch_pad": (uct_launch_pad.detect_uct_launch_pad, uct_launch_pad.evaluate, 210),
    "uct_gap_support": (uct_gap_support.detect_uct_gap_support, uct_gap_support.evaluate, 130),
    "uct_capitulation": (uct_capitulation.detect_uct_capitulation, uct_capitulation.evaluate, 210),
    "uct_go_signal": (uct_go_signal.detect_uct_go_signal, uct_go_signal.evaluate, 130),
}


def _series(bars):
    S = U.series(bars)
    S["bbl"] = U.bb_lower(S["c"])
    return S


# --- per-family near-miss predicates (each names ONE failing condition) ------

def _lp_miss(bars, S, i):
    if i < 70:
        return None
    a, c = S["atr"][i], S["c"][i]
    trio = (S["e8"][i], S["e21"][i], S["s50"][i])
    if not a or None in trio:
        return None
    spread = (max(trio) - min(trio)) / c
    above = c > max(trio) and c - max(trio) <= uct_launch_pad.LP_ABOVE_ATR * a
    curl = uct_launch_pad._s50_curling(S, i)
    conv = spread <= uct_launch_pad.LP_SPREAD_PCT
    if above and curl and uct_launch_pad.LP_SPREAD_PCT < spread <= 0.06:
        return "not_converged", "averages 3.5-6% apart: close above them and the 50 curling, but not a tight cluster"
    if conv and curl and c - max(trio) > 1.2 * a:
        return "extended_above", "tight cluster and a curling 50, but the close is stretched more than 1 ATR above it"
    if conv and above and not curl and S["s50"][i] < S["s50"][i - 10]:
        return "sma50_falling", "tight cluster with the close just above it, but the 50-day is still falling"
    return None


def _gs_miss(bars, S, i):
    if i < 70 or not S["atr"][i]:
        return None
    a = S["atr"][i]
    evs = uct_gap_support._gap_events(bars, S, i, loose=False)
    for ev in evs[:1]:
        t1, unfilled, touched, t3 = uct_gap_support._gap_test(bars, S, i, ev, a)
        if t1 and touched and t3 and not unfilled:
            return "gap_filled", "a volume gap tested and closed above, but the gap was already closed into earlier"
        if t1 and unfilled and t3 and not touched:
            lo_, c = bars[i]["l"], bars[i]["c"]
            if lo_ <= ev["gopen"] + uct_gap_support.GS_TOUCH_ATR * a and c > ev["gopen"]:
                return "open_only_touch", "the low reached only the gap day's open, judged not a gap test in the blind review"
            return "no_touch", "an unfilled volume gap and a pullback, but the low never reached the gap"
    if not evs:
        for ev in uct_gap_support._gap_events(bars, S, i, loose=True)[:1]:
            t1, unfilled, touched, t3 = uct_gap_support._gap_test(bars, S, i, ev, a)
            if t1 and unfilled and touched and t3:
                return "small_gap", "a held gap test, but the gap was under 4% or not a true gap on 2x volume"
    return None


def _cap_miss(bars, S, i):
    if i < 70:
        return None
    d = uct_capitulation._cap_day(bars, S, i)
    if d is None:
        return None
    fuel = d["c3"] or d["c4_hard"] or d["c4_soft"]
    veto = d["falling_vol"] and not d["c4_hard"]
    if d["c1"] and d["c2"] and fuel and not veto and not d["cascade"]:
        return "no_cascade", "a wide flush under the band on heavy volume, but out of nowhere (no prior cascade)"
    if d["gate"] and d["c2"] and d["cascade"] and fuel and not veto and not d["c1"]:
        return "not_below_band_by_1atr", "a cascade and a wide range, but the close is within 1 ATR of the lower band"
    if d["c1"] and d["c2"] and d["cascade"] and fuel and veto:
        return "falling_volume", "every extreme present, but the decline came on falling volume (distribution, not capitulation)"
    return None


def _go_miss(bars, S, i):
    if i < 70 or not S["atr"][i] or S["s50"][i] is None:
        return None
    b, p = bars[i], bars[i - 1]
    o, h, l, c = b["o"], b["h"], b["l"], b["c"]
    rng = h - l
    if rng <= 0:
        return None
    g0 = S["e20"][i] > S["e20"][i - 5]
    g2 = o < p["c"]
    swept = l < p["l"] or l < min(x["l"] for x in bars[i - 5:i])
    g4 = (min(o, c) - l) >= 0.4 * rng or (l < o and (c - l) / rng >= 0.5)
    g6 = (c - l) / rng >= 0.6
    if not g0 and g2 and swept and g4 and g6:
        return "ema20_falling", "weak open, sweep and a strong close, but the 20-day is falling (a downtrend bounce)"
    if g0 and g2 and swept and g4 and not g6 and (c - l) / rng >= 0.45:
        return "weak_close", "weak open, sweep and rejection, but the close finished outside the upper 40% of the range"
    if g0 and not g2 and swept and g4 and g6:
        return "opened_above", "a sweep and a strong close, but the session opened above the prior close"
    return None


_MISS = {"uct_launch_pad": _lp_miss, "uct_gap_support": _gs_miss,
         "uct_capitulation": _cap_miss, "uct_go_signal": _go_miss}
_NEG_CAP = {"quiet_session": 4}


def _boundary_edges(pid, fn, ev, pos):
    """A one-condition edit of a real positive that must NOT fire."""
    out = []
    for tk, ymd, w in pos:
        w = [dict(b) for b in w]
        S = _series(_strip(w))
        i = len(w) - 1
        cand = ev(_strip(w), S, i)
        if cand is None:
            continue
        last, a = w[-1], S["atr"][i]
        if pid == "uct_launch_pad":
            top = max(S["e8"][i], S["e21"][i], S["s50"][i])
            c = top + 2.0 * a
            last.update(c=c, h=max(last["h"], c), o=min(last["o"], c))
            name, note = f"extended_close_{tk}_{ymd}", "a real launch pad with its close moved 2 ATR above the cluster"
        elif pid == "uct_gap_support":
            floor = max(cand["gap_day_low"], cand["gap_top"]) + 0.6 * a
            last.update(l=floor, o=max(last["o"], floor), c=max(last["c"], floor), h=max(last["h"], floor))
            name, note = f"low_above_gap_{tk}_{ymd}", "a real gap test with its low lifted clear of every gap level"
        elif pid == "uct_capitulation":
            if cand["fired_variants"] != ["setup_day"]:
                continue
            c = S["bbl"][i] - 0.5 * a
            last.update(c=c, h=max(last["h"], c))
            name, note = f"close_within_1atr_of_band_{tk}_{ymd}", "a real flush with its close moved to 0.5 ATR under the lower band"
        else:
            rng = last["h"] - last["l"]
            c = last["l"] + 0.5 * rng
            last.update(c=c, o=min(last["o"], w[-2]["c"] - 0.01))
            name, note = f"close_mid_range_{tk}_{ymd}", "a real Go signal with its close moved to the middle of the range"
        fires = _fires(fn, w)
        if fires is False:
            out.append((name, "edge", w, False, note))
            break
    return out


def generate(db_path: str) -> None:
    data = _load(db_path)
    for pid, (fn, ev, win) in _DETECTORS.items():
        pos, neg, edge = [], {}, []
        stop_out_done = intact_done = penny_done = False
        for tk in _TICKERS:
            bars = data[tk]
            if len(bars) < win + 5:
                continue
            sb = _strip(bars)
            S = _series(sb)
            for i in range(win, len(bars) - 3):
                w = bars[i - win + 1:i + 1]
                cand = ev(sb, S, i)
                if cand is not None:
                    ymd = bars[i]["_ymd"]
                    if len(pos) < 6 and _fires(fn, w) and (not pos or pos[-1][0] != tk):
                        pos.append((tk, ymd, w))
                    w2 = bars[i - win + 3:i + 3]
                    later = bars[i + 1:i + 3]
                    stop = cand["stop"]
                    if not intact_done and all(x["l"] > stop for x in later) and _fires(fn, w2):
                        edge.append((f"intact_trigger_2_sessions_back_{tk}_{ymd}", "edge", w2, True,
                                     "the trigger is two sessions old and no later session traded through its stop"))
                        intact_done = True
                    if not stop_out_done and any(x["l"] < stop for x in later) and not _fires(fn, w2):
                        edge.append((f"stopped_out_after_trigger_{tk}_{ymd}", "edge", w2, False,
                                     "a later session traded below the trigger's stop, so it is no longer reported"))
                        stop_out_done = True
                    if not penny_done and _fires(fn, w):
                        scale = 0.5 / w[-1]["c"]
                        pw = [{**b, "o": b["o"] * scale, "h": b["h"] * scale, "l": b["l"] * scale,
                               "c": b["c"] * scale, "v": 1000.0} for b in w]
                        if not _fires(fn, pw):
                            edge.append((f"penny_scaled_{tk}_{ymd}", "edge", pw, False,
                                         "a real trigger re-priced to $0.50 on thin volume: the engine's liquidity floor refuses it"))
                            penny_done = True
                    continue
                miss = _MISS[pid](sb, S, i)
                if miss is None and i % 97 == 0:
                    miss = ("quiet_session", "an ordinary session with no trigger in the last three sessions")
                if (miss and len(neg.setdefault(miss[0], [])) < _NEG_CAP.get(miss[0], 2)
                        and all(x[0] != tk for x in neg[miss[0]]) and not _fires(fn, w)):
                    neg[miss[0]].append((tk, bars[i]["_ymd"], w, miss[1]))
        for k, (tk, ymd, w) in enumerate(pos):
            _write(pid, f"pos_{k + 1}_{tk}_{ymd}.json", f"{pid} real trigger {tk} {ymd}", "positive",
                   w, True, "real daily bars; the detector's rule holds on the last session")
        for key, lst in neg.items():
            for tk, ymd, w, note in lst:
                _write(pid, f"neg_{key}_{tk}_{ymd}.json", f"{pid} near-miss {key} {tk} {ymd}",
                       "negative", w, False, note)
        edge.extend(_boundary_edges(pid, fn, ev, pos))
        for name, cat, w, fires, note in edge:
            _write(pid, f"edge_{name}.json", f"{pid} {name}", cat, w, fires, note)
        print(pid, "pos", len(pos), "neg", {k: len(v) for k, v in neg.items()}, "edge", len(edge))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--bars-db", required=True)
    generate(ap.parse_args().bars_db)
