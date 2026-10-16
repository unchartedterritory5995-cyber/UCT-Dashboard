"""Fixture generator for the four UCT trader-setup detectors.

    uct_kicker · uct_oops_reversal · uct_slingshot · uct_hve

Fixtures are cut from REAL daily bars (price/volume only) read from the local
bars store, opened read-only and immutable so nothing is written to it. Each
fixture is a window of daily bars ending on the session that matters, with `t`
converted from YYYYMMDD to unix seconds (00:00 UTC). Data is capped at
_DATA_END so a rerun on a later day selects the same sessions, as long as the
store's history for those sessions is unchanged.

Usage (local only — the committed JSON files are what the tests read):

    python tests/fixtures/_gen_uct_setups.py --bars-db C:/data/bars.db

Categories:
  positive — the detector fires on the window's last session (a real trigger)
  negative — a real near-miss: the setup's rule fails on one named condition
             in the last 3 sessions, and the detector returns nothing
  edge     — a trigger 1-2 sessions back that is still intact (fires); the
             same trigger after a later session traded through the stop (does
             not fire); the same window priced as a penny stock (the engine's
             liquidity floor refuses it); and per-family boundary cases.
"""
from __future__ import annotations

import argparse
import calendar
import datetime
import json
import os
import sqlite3
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.abspath(os.path.join(_HERE, "..", ".."))
if _REPO not in sys.path:
    sys.path.insert(0, _REPO)

from api.services.pattern_engine.detectors.uct import (  # noqa: E402
    uct_hve, uct_kicker, uct_oops_reversal, uct_slingshot,
)
from api.services.pattern_engine.detectors.uct import uct_setups_common as U  # noqa: E402
from api.services.pattern_engine.primitives.context import build_context  # noqa: E402

_DATA_START, _DATA_END = 20220103, 20260930
_TICKERS = (
    "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA", "AMD", "AVGO", "NFLX",
    "CRM", "ORCL", "ADBE", "INTC", "MU", "QCOM", "SHOP", "UBER", "PLTR", "COIN",
    "SNOW", "CRWD", "PANW", "NOW", "LLY", "UNH", "JPM", "GS", "XOM", "CVX",
    "CAT", "DE", "BA", "GE", "HD", "LOW", "COST", "WMT", "NKE", "SBUX",
)

_DETECTORS = {
    "uct_kicker": (uct_kicker.detect_uct_kicker, uct_kicker.evaluate, 120),
    "uct_oops_reversal": (uct_oops_reversal.detect_uct_oops_reversal, uct_oops_reversal.evaluate, 120),
    "uct_slingshot": (uct_slingshot.detect_uct_slingshot, uct_slingshot.evaluate, 120),
    "uct_hve": (uct_hve.detect_uct_hve, uct_hve.evaluate, 300),
}


def _unix(ymd: int) -> int:
    d = datetime.date(ymd // 10000, ymd // 100 % 100, ymd % 100)
    return calendar.timegm(d.timetuple())


def _load(db_path: str) -> dict:
    conn = sqlite3.connect(f"file:{db_path}?immutable=1", uri=True)
    out = {}
    for t in _TICKERS:
        rows = conn.execute(
            "SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker=? AND tf='D' AND ts BETWEEN ? AND ? "
            "ORDER BY ts", (t, _DATA_START, _DATA_END)).fetchall()
        rows = [r for r in rows if None not in r]
        out[t] = [{"t": _unix(r[0]), "o": round(r[1], 4), "h": round(r[2], 4),
                   "l": round(r[3], 4), "c": round(r[4], 4), "v": float(r[5]), "_ymd": r[0]}
                  for r in rows]
    conn.close()
    return out


def _strip(bars):
    return [{k: b[k] for k in ("t", "o", "h", "l", "c", "v")} for b in bars]


def _fires(fn, bars) -> bool:
    return bool(fn(_strip(bars), build_context(_strip(bars), sym="TEST")))


def _write(pid, fname, name, category, bars, fires, note):
    exp = {"fires": fires}
    if fires:
        exp.update({"min_confidence": 50.0, "max_confidence": 100.0, "geometry_shape": "candle_mark"})
    doc = {"name": name, "category": category, "note": note, "expected": exp}
    head = json.dumps(doc, indent=2)[:-2]
    body = ",\n".join("    " + json.dumps(b, separators=(",", ":")) for b in _strip(bars))
    text = head + ',\n  "bars": [\n' + body + "\n  ]\n}\n"
    d = os.path.join(_HERE, pid)
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, fname), "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


# --- per-family near-miss predicates (each names ONE failing condition) ------

def _kicker_miss(bars, S, i):
    b, p = bars[i], bars[i - 1]
    if not (U.valid_bar(b) and U.valid_bar(p)):
        return None
    dcr1, o, h, c1, h1, l1, o1 = U.dcr(p), b["o"], b["h"], p["c"], p["h"], p["l"], p["o"]
    weak = dcr1 <= uct_kicker.KICKER_WEAK_DCR or (c1 < o1 and dcr1 <= uct_kicker.KICKER_RED_DCR)
    gap = (o - c1) >= uct_kicker.KICKER_MIN_GAP_RANGE * max(h1 - l1, 1e-9) and o > c1
    brk = h > h1
    if gap and brk and not weak and dcr1 >= 0.70:
        return "strong_prior_close", "gap up and break of the prior high, but the prior day closed strong"
    if weak and gap and not brk:
        return "no_break_of_prior_high", "weak prior close and gap up, but no break of the prior high"
    if weak and brk and o < c1:
        return "no_gap_up", "weak prior close and break of the prior high, but it opened below the prior close"
    if weak and brk and o > c1 and not gap:
        return "gap_too_small", "weak prior close, gap up and break, but the gap is under a tenth of the prior range"
    if c1 < o1 and dcr1 > uct_kicker.KICKER_RED_DCR and gap and brk:
        return "red_prior_closed_high", "red prior day that closed in the top 40% of its range is not a weak close"
    return None


def _oops_miss(bars, S, i):
    b, p, p2 = bars[i], bars[i - 1], bars[i - 2]
    if not (U.valid_bar(b) and U.valid_bar(p)):
        return None
    o, l, c, h = b["o"], b["l"], b["c"], b["h"]
    c1, l1, c2 = p["c"], p["l"], p2["c"]
    if o < c1 and l < o and c > c1 and c1 < c2 and not l < l1:
        return "no_undercut_v3", "open below prior close and close above it, but no undercut of the prior low (dropped by the blind review)"
    if o < c1 and l < l1 and h > c1 and c <= c1:
        return "closed_back_under", "undercut and traded over the prior close but closed back under it"
    if o > c1 and l < l1 and c > c1:
        return "opened_above", "undercut and reclaim but the open was above the prior close"
    if o < c1 and l < l1 and l1 < c <= c1:
        return "reclaimed_low_not_close", "reclaimed the prior low but not the prior close"
    return None


def _sling_miss(bars, S, i):
    c, e4h, s50 = S["c"], S["e4h"], S["s50"]
    if i < 31:
        return None
    s1 = c[i] > e4h[i]
    s2 = all(c[i - k] < e4h[i - k] for k in (1, 2, 3))
    if s1 and s2 and s50[i] is not None and c[i] <= s50[i]:
        return "below_sma50", "a slingshot close but under the 50-day average (the S5 uptrend gate)"
    if s1 and not s2 and c[i - 1] < e4h[i - 1] and c[i - 2] >= e4h[i - 2]:
        return "pullback_too_short", "first close over the average of highs after only one close below"
    if s1 and s2 and s50[i] is not None and c[i] > s50[i]:
        return "no_strength_day", "pullback and reclaim in an uptrend but no qualifying strength day"
    return None


def _hve_miss(bars, S, i):
    if i < U.HVE_MIN_PRIOR_BARS:
        return None
    v = S["v"]
    prior = v[max(0, i - 252):i]
    hb = U.hve_bar(bars, S, i)
    if hb and not hb["a1_252"] and hb["a26_26wk"]:
        return "only_26wk_high", "highest volume in 26 weeks but not in 252 sessions (label variant only)"
    srt = sorted(prior)
    if len(srt) > 2 and srt[-2] < v[i] <= srt[-1]:
        return "second_highest", "second-highest volume of the year, not the highest"
    return None


_NEG_CAP = {"quiet_session": 4}


def _boundary_edges(pid, fn, pos):
    """Synthetic one-condition edits of a real positive window."""
    if not pos:
        return []
    tk, ymd, w = pos[0]
    w = [dict(b) for b in w]
    last, prev = w[-1], w[-2]
    out = []
    if pid == "uct_kicker":
        rng = prev["h"] - prev["l"]
        o = prev["c"] + 0.09 * rng
        last.update(o=o, l=min(last["l"], o), h=max(last["h"], o, prev["h"] * 1.001))
        out.append((f"gap_just_under_a_tenth_of_range_{tk}_{ymd}", "edge", w, _fires(fn, w),
                    "a real kicker with its open moved to 0.09 x the prior range above the prior close"))
    elif pid == "uct_hve":
        prior = max(b["v"] for b in w[-253:-1])
        last["v"] = prior
        out.append((f"volume_ties_prior_max_{tk}_{ymd}", "edge", w, _fires(fn, w),
                    "a real edge bar with its volume set EQUAL to the prior 252-session max (must beat it)"))
    elif pid == "uct_oops_reversal":
        last["l"] = prev["l"]
        out.append((f"low_equals_prior_low_{tk}_{ymd}", "edge", w, _fires(fn, w),
                    "a real oops with its low set EQUAL to the prior low (the undercut must be strict)"))
    elif pid == "uct_slingshot":
        c = 0.999 * sum(b["c"] for b in w[-50:-1]) / 49
        last.update(c=c, h=max(last["h"], c), l=min(last["l"], c))
        out.append((f"close_just_under_sma50_{tk}_{ymd}", "edge", w, _fires(fn, w),
                    "a real slingshot with its close moved just under the 50-day average (S5 gate)"))
    for name, _cat, _w, fires, _note in out:
        assert fires is False, f"boundary edit {name} unexpectedly still fires"
    return out


_MISS = {"uct_kicker": _kicker_miss, "uct_oops_reversal": _oops_miss,
         "uct_slingshot": _sling_miss, "uct_hve": _hve_miss}


def generate(db_path: str) -> None:
    data = _load(db_path)
    for pid, (fn, ev, win) in _DETECTORS.items():
        pos, neg, edge = [], {}, []
        stop_out_done = intact_done = penny_done = False
        for tk in _TICKERS:
            bars = data[tk]
            if len(bars) < win + 5:
                continue
            S = U.series(_strip(bars))
            for i in range(win, len(bars) - 3):
                w = bars[i - win + 1:i + 1]
                cand = ev(_strip(bars), S, i)
                if cand is not None:
                    ymd = bars[i]["_ymd"]
                    if len(pos) < 6 and _fires(fn, w) and (not pos or pos[-1][0] != tk):
                        pos.append((tk, ymd, w))
                    # edge: same trigger with 2 later sessions, still intact / stopped out
                    w2 = bars[i - win + 3:i + 3]
                    later = bars[i + 1:i + 3]
                    stop = cand["stop"]
                    if not intact_done and all(x["l"] > stop for x in later) and _fires(fn, w2):
                        edge.append((f"intact_trigger_2_sessions_back_{tk}_{ymd}", "edge", w2, True,
                                     "the trigger is two sessions old and no later session traded through its stop"))
                        intact_done = True
                    if (pid != "uct_hve" and not stop_out_done and any(x["l"] < stop for x in later)
                            and not _fires(fn, w2)):
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
                miss = _MISS[pid](_strip(bars), S, i)
                if miss is None and i % 97 == 0:
                    miss = ("quiet_session", "an ordinary session with no trigger in the last three sessions")
                if miss and len(neg.setdefault(miss[0], [])) < _NEG_CAP.get(miss[0], 2)                         and all(x[0] != tk for x in neg[miss[0]]) and not _fires(fn, w):
                    neg[miss[0]].append((tk, bars[i]["_ymd"], w, miss[1]))
        for k, (tk, ymd, w) in enumerate(pos):
            _write(pid, f"pos_{k + 1}_{tk}_{ymd}.json", f"{pid} real trigger {tk} {ymd}", "positive",
                   w, True, "real daily bars; the detector's rule holds on the last session")
        for key, lst in neg.items():
            for tk, ymd, w, note in lst:
                _write(pid, f"neg_{key}_{tk}_{ymd}.json", f"{pid} near-miss {key} {tk} {ymd}",
                       "negative", w, False, note)
        edge.extend(_boundary_edges(pid, fn, pos))
        for name, cat, w, fires, note in edge:
            _write(pid, f"edge_{name}.json", f"{pid} {name}", cat, w, fires, note)
        print(pid, "pos", len(pos), "neg", len(neg), sorted(neg), "edge", len(edge))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--bars-db", required=True)
    generate(ap.parse_args().bars_db)
