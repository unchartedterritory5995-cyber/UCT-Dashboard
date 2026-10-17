"""UCT Gap Support detector — pattern_id `uct_gap_support`. INTERNAL (admin-only).

A stock gaps up on volume and holds the gap; weeks later it pulls back into the
gap area and buyers defend it. The unfilled gap is support because everyone who
bought it on the day still has a profit there.

Fires (the rule kept after blind adjudication), on session i:
  the gap    an up-gap g within the last 60 sessions: a TRUE gap (gap-day low
             above the prior high), at least 4%, on volume >= 2x the 50-day
             average, that held on the gap day (close above the prior high)
  T1         price came back down at least 1 ATR from its post-gap high
  unfilled   no close back into the gap since the gap day
  T2         the low touches (within 0.25 ATR) one of the gap's levels — the gap
             top (prior high), the gap-day low or the gap midpoint — and the
             close is above that level. Touching ONLY the gap-day open is a
             label, not a test (blind review: those were judged no)
  T3         the close is above the gap top: the gap is still unfilled

Labels only: a looser gap (any open above the prior high by >= 2%, no volume
test), which level was tested, first test, confluence with EMA9/EMA20/SMA50/SMA200.

Entry: the close. Stop: the gap top or the session low, whichever is lower.
"""
from __future__ import annotations

from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.primitives.liquidity import liquidity_floor


_PATTERN_ID = "uct_gap_support"
_PATTERN_NAME = "UCT Gap Support"

# [P] proposed defaults (the only lab-tunable values)
GS_WINDOW = 60
GS_MIN_GAP = 0.04
GS_VOL_X = 2.0
GS_PULLBACK_ATR = 1.0
GS_TOUCH_ATR = 0.25
GS_CONFLUENCE_ATR = 0.5
GS_LOOSE_MIN_GAP = 0.02
_MIN_IDX = 60
_MIN_BARS = _MIN_IDX + 1


def _gap_events(bars, S, i, loose):
    """Up-gaps g in [i-GS_WINDOW, i-2] that held on the gap day. Uses bars <= i only."""
    out = []
    for g in range(i - 2, max(51, i - GS_WINDOW) - 1, -1):
        b, p = bars[g], bars[g - 1]
        o, l, c = b["o"], b["l"], b["c"]
        h1, c1 = p["h"], p["c"]
        if not c1:
            continue
        true_gap = l > h1
        size = o / c1 - 1
        v50 = S["v50"][g - 1]
        vol_ok = bool(v50) and S["v"][g] >= GS_VOL_X * v50
        held = c > h1
        if loose:
            ok = o > h1 and size >= GS_LOOSE_MIN_GAP and held
        else:
            ok = true_gap and size >= GS_MIN_GAP and vol_ok and held
        if ok:
            out.append({"g": g, "top": h1, "glow": l, "gopen": o,
                        "mid": (h1 + l) / 2 if true_gap else None,
                        "size": size, "vol_ok": vol_ok, "true_gap": true_gap})
    return out


def _gap_test(bars, S, i, ev, a):
    g = ev["g"]
    lo_, c = bars[i]["l"], bars[i]["c"]
    t1 = max(b["h"] for b in bars[g:i]) - S["c"][i - 1] >= GS_PULLBACK_ATR * a
    unfilled = min(S["c"][g:i]) > ev["top"]
    levels = [(n, ev[n]) for n in ("top", "glow", "gopen", "mid") if ev[n] is not None]
    touched = [n for n, lv in levels if lo_ <= lv + GS_TOUCH_ATR * a and c > lv]
    if touched == ["gopen"]:
        touched = []
    return t1, unfilled, touched, c > ev["top"]


def _first_passing(bars, S, i, a, loose):
    for ev in _gap_events(bars, S, i, loose):
        t1, unfilled, touched, t3 = _gap_test(bars, S, i, ev, a)
        if t1 and unfilled and touched and t3:
            return ev, touched
    return None


def evaluate(bars: list, S: dict, i: int) -> Optional[dict]:
    if i < _MIN_IDX or not U.valid_bar(bars[i]):
        return None
    a = S["atr"][i]
    if not a:
        return None
    strict = _first_passing(bars, S, i, a, loose=False)
    if strict is None:
        return None
    loose = _first_passing(bars, S, i, a, loose=True)
    ev, touched = strict
    c, lo_ = bars[i]["c"], bars[i]["l"]
    conf = U.near(lo_, (("ema9", S["e9"][i]), ("ema20", S["e20"][i]), ("sma50", S["s50"][i]),
                        ("sma200", S["s200"][i])), GS_CONFLUENCE_ATR * a)
    first = not any(b["l"] <= ev[touched[0]] + GS_TOUCH_ATR * a for b in bars[ev["g"] + 1:i])
    v50 = S["v50"][i]
    return {
        "idx": i, "variant": "gap_test", "label_variants": ["loose_gap_test"] if loose else [],
        "gap_t": int(bars[ev["g"]]["t"]), "gap_idx": ev["g"], "gap_pct": round(ev["size"] * 100.0, 2),
        "gap_vol_2x": ev["vol_ok"], "true_gap": ev["true_gap"], "levels_touched": touched,
        "gap_top": ev["top"], "gap_day_low": ev["glow"], "first_test": first, "confluence": conf,
        "bars_since_gap": i - ev["g"], "rvol50": round(S["v"][i] / v50, 2) if v50 else None,
        "trigger": c, "stop": min(ev["top"], lo_), "close": c, "low": lo_,
    }


def _geometry_score(c: dict) -> float:
    g = 70.0
    g += 10.0 if c["first_test"] else 0.0
    g += 10.0 if c["confluence"] else 0.0
    g += 5.0 if c["gap_pct"] >= 8.0 else 0.0
    g += 5.0 if "top" in c["levels_touched"] else 0.0
    return round(min(100.0, g), 2)


def detect_uct_gap_support(bars: List[dict], context: dict) -> List[dict]:
    if len(bars) < _MIN_BARS or not liquidity_floor(bars).passes:
        return []
    S = U.series(bars)
    n = len(bars)
    for off in range(U.MAX_TRIGGER_AGE):
        cand = evaluate(bars, S, n - 1 - off)
        if cand is None or U.stopped_out_since(bars, cand["idx"], cand["stop"]):
            continue
        geom = _geometry_score(cand)
        vol = U.volume_score(cand["rvol50"])
        ctx = U.context_score(context, "bullish")
        if U.confidence(geom, vol, ctx) < U.CONFIDENCE_FLOOR:
            continue
        return [_build(bars, cand, context, geom, vol, ctx)]
    return []


def _build(bars, c, context, geom, vol, ctx) -> dict:
    i, g = c["idx"], c["gap_idx"]
    levels = U.make_levels(c["trigger"], c["stop"], "bullish",
                           entry_condition=f"hold above the gap top {c['gap_top']:.2f}",
                           stop_basis="gap_top_or_session_low")
    anchors = [
        {"t": int(bars[g]["t"]), "price": float(c["gap_top"])},
        {"t": int(bars[i]["t"]), "price": float(c["close"])},
    ]
    extras = {
        "variant": c["variant"], "label_variants": c["label_variants"], "gap_t": c["gap_t"],
        "gap_pct": c["gap_pct"], "gap_vol_2x": c["gap_vol_2x"], "true_gap": c["true_gap"],
        "levels_touched": c["levels_touched"], "gap_top": round(c["gap_top"], 2),
        "gap_day_low": round(c["gap_day_low"], 2), "first_test": c["first_test"],
        "confluence": c["confluence"], "bars_since_gap": c["bars_since_gap"], "rvol50": c["rvol50"],
    }
    secondary = [
        U.hline(bars, g - 1, i, c["gap_top"], "gap_edge", f"Gap edge {c['gap_top']:.2f}"),
        U.hline(bars, g, i, c["gap_day_low"], "gap_low", f"Gap-day low {c['gap_day_low']:.2f}"),
    ]
    return U.build_detection(
        pattern_id=_PATTERN_ID, pattern_name=_PATTERN_NAME, direction="bullish",
        bars=bars, trig_idx=i, start_idx=g - 1, anchors=anchors,
        anchor_roles=["gap_day", "gap_test_session"], extras=extras, levels=levels,
        context=context, narrative=_narrative(c, levels, context), geom=geom, vol=vol, ctx=ctx,
        secondary=secondary)


_LEVEL_WORDS = {"top": "the gap top (the prior day's high)", "glow": "the gap day's low",
                "mid": "the middle of the gap", "gopen": "the gap day's open"}


def _narrative(c, levels, context) -> dict:
    tested = ", ".join(_LEVEL_WORDS[n] for n in c["levels_touched"])
    conf = ", ".join(c["confluence"]) or "no moving average"
    labels = ", ".join(c["label_variants"]) or "none"
    headline = (
        f"UCT Gap Support - a {c['gap_pct']:.1f}% volume gap from {c['bars_since_gap']} sessions ago "
        f"tested and held, close above the gap top ${c['gap_top']:.2f}; entry ${levels['entry']:.2f}, "
        f"stop ${levels['stop']:.2f}."
    )
    what_it_is = (
        f"{c['bars_since_gap']} sessions ago this stock opened {c['gap_pct']:.1f}% above the prior "
        f"close on at least twice its average volume, left a true gap (the whole day traded above the "
        f"prior day's high of ${c['gap_top']:.2f}) and held it into the close. Since then it ran, came "
        f"back down at least one ATR, and has not closed back into the gap. Today's low tested "
        f"{tested} and the session closed back above it, at ${c['close']:.2f}, which is the gap acting "
        f"as support. A test that only reached the gap day's open was judged not to be a gap test in "
        f"the blind review and does not fire this rule. This "
        f"{'is the first' if c['first_test'] else 'is not the first'} test of that level. Looser "
        f"readings are labels only; present here: {labels}. {U.PROVENANCE_NOTE}"
    )
    why_it_matters = (
        f"An unfilled volume gap marks the day the stock was repriced, and everyone who bought on that "
        f"day is still in profit at the gap. When price returns there, those buyers and the ones who "
        f"missed the gap tend to defend it, which is why the gap top is the level the setup is built on. "
        f"First tests usually carry the most weight; each later test uses up some of the demand that "
        f"was waiting. Confluence with a moving average adds support: here the low is near {conf}. The "
        f"setup is forming in {U.context_phrase(context)}. Relative volume on the test is "
        f"{c['rvol50'] if c['rvol50'] is not None else 'unmeasured'}x the 50-bar average; a quiet "
        f"pullback into the gap followed by a firm close is the version traders like best. A gap test "
        f"on heavy, rising selling volume deserves more caution than one that drifts in quietly, because "
        f"it means supply is arriving rather than simply drying up."
    )
    what_to_watch_for = (
        f"The entry is the close of ${levels['entry']:.2f}, above the gap top. Follow-through is a move "
        f"back toward the post-gap high on rising volume; a session that closes in the upper part of its "
        f"range confirms buyers are in control at the gap. Watch the gap top of ${c['gap_top']:.2f} on "
        f"any further dip: holding it on a closing basis keeps the setup alive, and a second test that "
        f"holds with less volume than the first is constructive. Targets are expressed in R from the "
        f"stop: ${levels['target_primary']:.2f} (2R) and ${levels['target_secondary']:.2f} (3R). The "
        f"post-gap high is the natural first area to take some off, since that is where the run that "
        f"followed the gap stalled before it pulled back into this test. If the stock instead drifts "
        f"sideways at the gap for several sessions, the level is still holding but the energy is fading, "
        f"and a tighter stop just under the gap top is a reasonable way to manage that."
    )
    failure_signal = (
        f"The setup fails on a trade below ${levels['stop']:.2f}, which is the lower of the gap top and "
        f"today's low. A close back inside the gap means the level that repriced the stock is no longer "
        f"being defended, and a full fill of the gap down to the gap day's low of "
        f"${c['gap_day_low']:.2f} usually means the gap was not real demand at all. Repeated tests that "
        f"each hold with more selling volume are an early warning even before the stop goes. Keep the "
        f"stop where it is rather than widening it under the gap, size the position so the loss is "
        f"routine, and treat a failed gap test as information about the stock rather than a reason to "
        f"buy the same level again the next morning. A gap that fills completely often turns into "
        f"resistance from below, because the buyers who were trapped there will sell into the first "
        f"rally back to their entry."
    )
    return {"headline": headline, "what_it_is": what_it_is, "why_it_matters": why_it_matters,
            "what_to_watch_for": what_to_watch_for, "failure_signal": failure_signal}


register(_PATTERN_ID, detect_uct_gap_support)
