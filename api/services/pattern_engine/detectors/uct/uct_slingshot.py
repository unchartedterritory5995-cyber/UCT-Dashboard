"""UCT Slingshot detector — pattern_id `uct_slingshot`.

A slingshot is a strong stock's first close back above a short, fast average of
its highs after a brief pullback: momentum pauses for three sessions, then
resumes. The average is E4H = EMA(high, 4).

Fires (the scan kept after blind adjudication):
  S1 close > E4H
  S2 the three prior closes were each below their E4H
  S3 a strength day in the last 25 sessions: a > 4% up close on volume above
     its 50-day average                                          [trader rule]
     OR S3b a > 20% five-session run (close > 5, 3-day min volume > 300K)
     within the last 5 sessions                                  [trader rule]
  S4 liquidity: close > 5 and the prior three sessions' minimum volume > 100K
                                                                 [trader rule]
  S5 uptrend: close > SMA50 (added by the blind review: 52% -> 94% precision)

Labels only (geometry.extras):
  cross_only — first close over E4H after a single close below it
  intraday_trigger — the high crossed E4H after the pullback but the close did
                     not (never fires here: S1 is required)
  tight pullback (3-session range <= 1.5 ATR), trend (above / rising SMA50),
  a kicker on the same session, a recent high-volume close just below price.

Entry: the trigger close. Stop: the trigger session's low; the prior session's
low is recorded as the alternative stop.
"""
from __future__ import annotations

from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.detectors.uct import uct_kicker
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.primitives.liquidity import liquidity_floor


_PATTERN_ID = "uct_slingshot"
_PATTERN_NAME = "UCT Slingshot"

# [P] proposed defaults
SLING_TIGHT_ATR = 1.5
SLING_TREND_SLOPE_BARS = 10
SLING_HVE_STACK_ATR = 1.0
SLING_REQUIRE_ABOVE_SMA50 = True
# [T] trader thresholds — not tunable
_SLING_GAP, _SLING_WIN = 1.04, 25
_SLING_RUN, _SLING_RUN_WIN, _SLING_RUN_MINV = 1.20, 5, 300000
_SLING_LIQ_PRICE, _SLING_LIQ_MINV = 5, 100000
_HVE_TRADE_WINDOW = 25
_MIN_BARS = 31


def evaluate(bars: list, S: dict, i: int) -> Optional[dict]:
    if i < 30:
        return None
    if not all(U.valid_bar(bars[k]) for k in range(i - 5, i + 1)):
        return None
    c, v, e4h, v50, s50 = S["c"], S["v"], S["e4h"], S["v50"], S["s50"]
    s1 = c[i] > e4h[i]
    s2 = all(c[i - k] < e4h[i - k] for k in (1, 2, 3))
    s3_k = [k for k in range(max(1, i - _SLING_WIN), i + 1)
            if c[k - 1] > 0 and c[k] / c[k - 1] > _SLING_GAP
            and v50[k] is not None and v[k] > v50[k]]
    s3b_k = [k for k in range(max(5, i - _SLING_RUN_WIN), i + 1)
             if c[k - 5] > 0 and c[k] / c[k - 5] > _SLING_RUN and c[k] > 5
             and min(v[k - 2:k + 1]) > _SLING_RUN_MINV]
    s4 = c[i] > _SLING_LIQ_PRICE and min(v[i - 3:i]) > _SLING_LIQ_MINV
    s5 = (not SLING_REQUIRE_ABOVE_SMA50) or (s50[i] is not None and c[i] > s50[i])
    v1 = s1 and s2 and bool(s3_k) and s4 and s5
    v2 = s1 and s2 and bool(s3b_k) and s4 and s5
    if not (v1 or v2):
        return None
    cross = s1 and c[i - 1] < e4h[i - 1] and s4
    a = S["atr"][i]
    rng3 = max(bars[k]["h"] for k in range(i - 3, i)) - min(bars[k]["l"] for k in range(i - 3, i))
    s50b = s50[i - SLING_TREND_SLOPE_BARS]
    kick = uct_kicker.evaluate(bars, S, i)
    hvcs = []
    for g in range(max(0, i - _HVE_TRADE_WINDOW), i):
        hb = U.hve_bar(bars, S, g)
        if hb and a and 0 <= c[i] - hb["hvc"] <= SLING_HVE_STACK_ATR * a:
            hvcs.append(round(hb["hvc"], 2))
    labels = [n for n, f in (("v2_run_20in5", v1 and v2), ("cross_only", cross),
                             ("stack_kicker", kick is not None),
                             ("stack_hve_close", bool(hvcs))) if f]
    strength_k = s3_k[-1] if s3_k else None
    return {
        "idx": i, "variant": "v1_strength_day" if v1 else "v2_run_20in5",
        "label_variants": labels, "e4h": round(e4h[i], 4),
        "prior_closes_below": sum(1 for k in range(1, 6) if c[i - k] < e4h[i - k]),
        "strength_day_bars_ago": (i - strength_k) if strength_k is not None else None,
        "strength_day_gain_pct": (round((c[strength_k] / c[strength_k - 1] - 1) * 100, 2)
                                  if strength_k is not None else None),
        "tight_pullback": bool(a and rng3 <= SLING_TIGHT_ATR * a),
        "trend": bool((s50[i] and c[i] > s50[i]) or (s50[i] and s50b and s50[i] > s50b)),
        "sma50": round(s50[i], 2) if s50[i] else None,
        "hve_closes_below": hvcs, "prev_day_low": bars[i - 1]["l"],
        "rvol50": round(v[i] / v50[i], 2) if v50[i] else None,
        "trigger": c[i], "stop": bars[i]["l"], "close": c[i], "low": bars[i]["l"],
        # display-only: the 3-bar pullback box the tight_pullback label measures,
        # and the unrounded 4-EMA-of-highs level the cross is judged against.
        "pb_high": max(bars[k]["h"] for k in range(i - 3, i)),
        "pb_low": min(bars[k]["l"] for k in range(i - 3, i)),
        "e4h_level": e4h[i],
    }


def _geometry_score(c: dict) -> float:
    g = 70.0
    g += 10.0 if "v2_run_20in5" in c["label_variants"] else 0.0
    g += 10.0 if c["tight_pullback"] else 0.0
    g += 5.0 if c["trend"] else 0.0
    g += 5.0 if "stack_hve_close" in c["label_variants"] or "stack_kicker" in c["label_variants"] else 0.0
    return round(min(100.0, g), 2)


def detect_uct_slingshot(bars: List[dict], context: dict) -> List[dict]:
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
    i = c["idx"]
    levels = U.make_levels(c["trigger"], c["stop"], "bullish",
                           entry_condition=f"close back above the 4-period EMA of highs ({c['e4h']:.2f})",
                           stop_basis="trigger_session_low")
    anchors = [
        {"t": int(bars[i - 3]["t"]), "price": float(bars[i - 3]["c"])},
        {"t": int(bars[i]["t"]), "price": float(c["close"])},
    ]
    extras = {
        "variant": c["variant"], "label_variants": c["label_variants"],
        "e4h": c["e4h"], "prior_closes_below_e4h": c["prior_closes_below"],
        "strength_day_bars_ago": c["strength_day_bars_ago"],
        "strength_day_gain_pct": c["strength_day_gain_pct"],
        "tight_pullback": c["tight_pullback"], "trend": c["trend"], "sma50": c["sma50"],
        "hve_closes_below": c["hve_closes_below"],
        "alt_stop_prev_day_low": round(c["prev_day_low"], 2), "rvol50": c["rvol50"],
    }
    secondary = [
        U.rect(bars, i - 3, i - 1, c["pb_high"], c["pb_low"], "pullback", "Pullback 3 bars"),
        U.hline(bars, i - 3, i, c["e4h_level"], "ma", f"4-EMA highs {c['e4h_level']:.2f}"),
    ]
    return U.build_detection(
        pattern_id=_PATTERN_ID, pattern_name=_PATTERN_NAME, direction="bullish",
        bars=bars, trig_idx=i, start_idx=i - 3, anchors=anchors,
        anchor_roles=["pullback_start", "slingshot_close"], extras=extras,
        levels=levels, context=context, narrative=_narrative(c, levels, context),
        geom=geom, vol=vol, ctx=ctx, secondary=secondary)


def _narrative(c, levels, context) -> dict:
    labels = ", ".join(c["label_variants"]) or "none"
    if c["strength_day_bars_ago"] is not None:
        strength = (f"a {c['strength_day_gain_pct']:.1f}% up day on above-average volume "
                    f"{c['strength_day_bars_ago']} sessions ago")
    else:
        strength = "a 20%-plus five-session run within the last week"
    headline = (
        f"UCT Slingshot - first close back over the 4-period EMA of highs (${c['e4h']:.2f}) after "
        f"a three-session pullback, following {strength}; stop ${levels['stop']:.2f}."
    )
    what_it_is = (
        f"A slingshot is a strong stock resuming after a short pause. The reference line is a "
        f"4-period exponential average of the daily HIGHS, which hugs a trending stock tightly; "
        f"three closes in a row under it mark a pullback, and the first close back over it marks "
        f"the resumption. This session closed at ${c['close']:.2f}, above that line at "
        f"${c['e4h']:.2f}, after {c['prior_closes_below']} of the previous five closes sat below "
        f"it. The rule also requires recent proof of strength - here {strength} - plus basic "
        f"liquidity (a close above $5 and at least 100K shares on each of the prior three days), "
        f"and, after a blind review, a close above the 50-day average so the setup is taken only "
        f"inside an uptrend. Labels present on this session: {labels}. {U.PROVENANCE_NOTE}"
    )
    why_it_matters = (
        f"The setup is forming in {U.context_phrase(context)}. The pullback was "
        f"{'tight (the three-session range was within 1.5 ATR)' if c['tight_pullback'] else 'wider than 1.5 ATR'}, "
        f"and a tight pause after a strength day is the cleanest form: sellers had three sessions "
        f"to push the stock lower and could not, so the first close back over the average of highs "
        f"shows buyers taking control again. The 50-day average sits at "
        f"{('$' + format(c['sma50'], '.2f')) if c['sma50'] else 'an unmeasured level'}, below "
        f"price, which is the uptrend condition the review found most predictive. Stacking with a "
        f"kicker or with a recent high-volume close just below price adds weight, because each "
        f"marks a level where large buyers recently committed and are likely to defend. The setup "
        f"is a continuation trade, so it is only as good as the trend it continues."
    )
    what_to_watch_for = (
        f"The entry is the trigger close at ${levels['entry']:.2f}; an aggressive entry takes it "
        f"intraday as the high crosses the average of highs, a conservative one waits for the "
        f"close. Follow-through should come within one to three sessions with the stock making "
        f"new short-term highs and volume expanding on up days. The stop is the trigger session's "
        f"low at ${levels['stop']:.2f}; the prior session's low "
        f"(${c['prev_day_low']:.2f}) is a common alternative. Targets in R from the stop are "
        f"${levels['target_primary']:.2f} (2R) and ${levels['target_secondary']:.2f} (3R). Once "
        f"the stock is moving, trailing under the 10-day average or under each higher low keeps "
        f"the trend trade open without giving back the initial edge on a routine pullback. Note "
        f"the market backdrop too: slingshots in leading stocks work best when the indexes trend."
    )
    failure_signal = (
        f"The setup fails on a trade below the trigger session's low of ${levels['stop']:.2f}, and "
        f"is weakened by a close back under the 4-period average of highs on the next session, "
        f"which says the resumption did not hold and the pullback is still in progress. A close "
        f"under the 50-day average would remove the uptrend condition entirely and turn a "
        f"pullback into a possible trend change. Because the stop sits close to the entry, losses "
        f"are small and frequent by design; size so that a stop is routine, never widen it, and "
        f"do not re-enter the same pullback repeatedly - wait for a fresh three-close pause and a "
        f"new close back over the average before taking the setup again on the same name. A "
        f"gap down through the trigger low is the clearest failure of all and needs no second look."
    )
    return {"headline": headline, "what_it_is": what_it_is, "why_it_matters": why_it_matters,
            "what_to_watch_for": what_to_watch_for, "failure_signal": failure_signal}


register(_PATTERN_ID, detect_uct_slingshot)
