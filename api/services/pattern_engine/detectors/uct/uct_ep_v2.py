"""UCT Episodic Pivot v2 detector - pattern_id `uct_episodic_pivot_v2`. INTERNAL (admin-only).

An episodic pivot is a gap-up session on heavy volume and an expanded range that
announces a change in what the market thinks the stock is worth. This v2 keeps
the gap, volume and range tests of the production `episodic_pivot` detector and
changes two gates, both measured on the traders' own scored calls:

  * the prior-base requirement becomes a LABEL (records t13505 and t10541 treat
    a prior base as a preference rather than a precondition);
  * the close-strength floor drops 0.70 -> 0.50 (record t14339: day-2 and day-4
    entries after an EP day that closed mid-range).

This is a NEW detector beside `episodic_pivot` and `power_earnings_gap`; it does
not change either. It is a port of the offline lab rule `ep_v2` (detector recall
v2, 2026-10-16). On the test half it lifted recall 21.1% -> 47.4% with the fire
rate moving 0.87% -> 1.20% of random ticker-days; a blind review of its fires on
random days judged 13 yes / 4 no / 8 ambiguous, and 0 of 10 decoys yes.

The rule at session i (uses bars[:i+1] only), newest qualifying gap day g first,
g in i, i-1, ..., i-4:
  * open[g] / close[g-1] - 1 >= 4%
  * volume[g] >= 2x the 20-session average volume before g
  * range[g] >= 2x the 20-session average range before g
  * close strength (close - low) / range >= 0.50
  * base label: the longest n in 60..15 whose prior-n-session range is <= 25%
    of its high and whose high the gap day closed above (None if none).

Levels: entry = the latest close; pivot = the gap edge (the close before the
gap); stop = the gap-day low. Geometry is the shared UCT idiom: a `candle_mark`
whose two anchors (with `anchor_roles`) are the gap edge on the pre-gap session
and the gap-day low on the gap session, plus display-only `geometry.secondary`
horizontal lines for the gap edge and the stop.

Wrapper: the liquidity floor shared by the UCT trader-setup detectors. The lab
rule already carries its own 5-session age window, so the rule is evaluated on
the newest session only, and the parity test pins it bar for bar.
"""
from __future__ import annotations

from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.primitives.liquidity import liquidity_floor


_PATTERN_ID = "uct_episodic_pivot_v2"
_PATTERN_NAME = "UCT Episodic Pivot v2"

# Lab constants (recall_v2.py, frozen before the test half ran). Do not tune here.
EP_AGE = 5                     # [T] EP day within the last 5 sessions (t10541)
EP_GAP = 0.04                  # production _MIN_GAP_PCT (unchanged)
EP_VOL_X = 2.0                 # [T] volume >= 2x the 20-session average (t10541)
EP_RANGE_X = 2.0               # production _MIN_RANGE_RATIO (unchanged)
EP_CLOSE_STRENGTH = 0.5        # [P] production 0.70 (t14339)
EP_REQUIRE_BASE = False        # [T] base is a label, not a gate (t13505)
EP_AVG_N = 20
EP_BASE_MAX, EP_BASE_MIN, EP_BASE_DEPTH = 60, 15, 0.25
_MIN_IDX = 81
_MIN_BARS = _MIN_IDX + 1


def _vol(b) -> float:
    return float(b["v"] or 0.0)


def evaluate(bars: list, i: int) -> Optional[dict]:
    """The lab rule at session i. Returns a candidate dict or None.

    Mirrors `ep_v2(b, i)` exactly (default close strength and base gate).
    The only additions are division guards that the lab never reaches on
    cleaned data (a non-positive prior close or base high is skipped)."""
    if i < _MIN_IDX or i >= len(bars):
        return None
    for g in range(i, i - EP_AGE, -1):
        pc = bars[g - 1]["c"]
        if not pc or pc <= 0:
            continue
        gp = bars[g]["o"] / pc - 1
        if gp < EP_GAP:
            continue
        lb = bars[g - EP_AVG_N:g]
        av = sum(_vol(x) for x in lb) / EP_AVG_N
        ar = sum(x["h"] - x["l"] for x in lb) / EP_AVG_N
        bg = bars[g]
        rng = bg["h"] - bg["l"]
        if av <= 0 or ar <= 0 or rng <= 0 or _vol(bg) < EP_VOL_X * av or rng < EP_RANGE_X * ar:
            continue
        cs = (bg["c"] - bg["l"]) / rng
        if cs < EP_CLOSE_STRENGTH:
            continue
        base = None
        for n in range(EP_BASE_MAX, EP_BASE_MIN - 1, -1):
            seg = bars[g - n:g]
            bh, bl = max(x["h"] for x in seg), min(x["l"] for x in seg)
            if bh > 0 and (bh - bl) / bh <= EP_BASE_DEPTH and bg["c"] > bh:
                base = n
                break
        if EP_REQUIRE_BASE and base is None:
            continue
        after = bars[g + 1:i + 1]
        return {
            "idx": i, "gap_idx": g, "variant": "gap_day_%d" % (i - g),
            "gap": round(gp, 3), "vol_x": round(_vol(bg) / av, 1),
            "close_strength": round(cs, 2), "base_bars": base,
            "gap_edge": pc, "gap_open": bg["o"], "gap_low": bg["l"], "gap_close": bg["c"],
            "gap_low_broken": any(x["l"] < bg["l"] for x in after),
            "gap_filled": any(x["l"] <= pc for x in after),
            "close": bars[i]["c"], "trigger": bars[i]["c"], "stop": bg["l"],
        }
    return None


def _geometry_score(c: dict) -> float:
    g = 70.0
    g += 10.0 if c["base_bars"] is not None else 0.0
    g += 5.0 if c["close_strength"] >= 0.70 else 0.0
    g += 5.0 if c["gap"] >= 0.08 else 0.0
    g += 5.0 if c["vol_x"] >= 3.0 else 0.0
    return round(min(100.0, g), 2)


def detect_uct_episodic_pivot_v2(bars: List[dict], context: dict) -> List[dict]:
    if len(bars) < _MIN_BARS or not liquidity_floor(bars).passes:
        return []
    cand = evaluate(bars, len(bars) - 1)
    if cand is None:
        return []
    geom = _geometry_score(cand)
    vol = U.volume_score(cand["vol_x"])
    ctx = U.context_score(context, "bullish")
    return [_build(bars, cand, context, geom, vol, ctx)]


def _build(bars, c, context, geom, vol, ctx) -> dict:
    g = c["gap_idx"]
    levels = U.make_levels(c["trigger"], c["stop"], "bullish",
                           entry_condition=f"hold above the gap edge {c['gap_edge']:.2f}",
                           stop_basis="below_gap_day_low")
    levels["pivot"] = round(c["gap_edge"], 2)
    edge, low, i = float(c["gap_edge"]), float(c["gap_low"]), c["idx"]
    anchors = [{"t": int(bars[g - 1]["t"]), "price": edge},
               {"t": int(bars[g]["t"]), "price": low}]
    secondary = [U.hline(bars, g - 1, i, edge, "gap_edge", f"Gap edge {edge:.2f}"),
                 U.hline(bars, g, i, low, "stop", f"Gap-day low {low:.2f}")]
    labels = [n for n, f in (("based", c["base_bars"] is not None),
                             ("gap_low_broken", c["gap_low_broken"]),
                             ("gap_filled", c["gap_filled"])) if f]
    extras = {
        "variant": c["variant"], "fired_variants": [c["variant"]], "label_variants": labels,
        "gap_pct": round(c["gap"] * 100.0, 1), "vol_x": c["vol_x"],
        "close_strength": c["close_strength"], "base_bars": c["base_bars"],
        "gap_edge": round(edge, 2), "gap_day_low": round(c["gap_low"], 2),
        "gap_t": int(bars[g]["t"]), "bars_since_gap": c["idx"] - g,
        "gap_low_broken": c["gap_low_broken"], "gap_filled": c["gap_filled"],
        "lab_rule": "recall_v2.ep_v2",
    }
    det = U.build_detection(
        pattern_id=_PATTERN_ID, pattern_name=_PATTERN_NAME, direction="bullish",
        bars=bars, trig_idx=g, start_idx=g - 1, anchors=anchors,
        anchor_roles=["gap_edge", "gap_day_low"], extras=extras,
        levels=levels, context=context, narrative=_narrative(c, levels, context),
        geom=geom, vol=vol, ctx=ctx, secondary=secondary)
    return det


def _narrative(c, levels, context) -> dict:
    ago = c["idx"] - c["gap_idx"]
    when = "today" if ago == 0 else f"{ago} session{'s' if ago > 1 else ''} ago"
    base = (f"It broke out of a {c['base_bars']}-session base." if c["base_bars"] is not None
            else "There was no qualifying base before it; v2 does not require one.")
    headline = (
        f"UCT Episodic Pivot v2 - gapped up {c['gap'] * 100:.1f}% {when} on {c['vol_x']:.1f}x volume; "
        f"gap edge ${levels['pivot']:.2f}, stop ${levels['stop']:.2f} under the gap-day low."
    )
    what_it_is = (
        f"The gap session opened {c['gap'] * 100:.1f}% above the prior close of ${c['gap_edge']:.2f}, "
        f"traded at least twice its usual range on {c['vol_x']:.1f}x its 20-session average volume, and "
        f"closed at {c['close_strength']:.2f} of its range. {base} {U.PROVENANCE_NOTE}"
    )
    why_it_matters = (
        f"A gap on that much volume and range is the market re-pricing the stock in one session. "
        f"The setup sits in {U.context_phrase(context)}. This detector is experimental and admin-only: "
        f"on random days most fires were judged real, with a meaningful ambiguous share."
    )
    what_to_watch_for = (
        f"Price holding above the gap edge at ${levels['pivot']:.2f} and the gap-day low at "
        f"${levels['stop']:.2f}; tight action near the highs in the days after the gap. Targets in R: "
        f"${levels['target_primary']:.2f} (2R) and ${levels['target_secondary']:.2f} (3R)."
    )
    failure_signal = (
        f"A trade below the gap-day low at ${levels['stop']:.2f} fails the pivot; a fill back to the "
        f"gap edge at ${levels['pivot']:.2f} means the re-pricing did not hold."
    )
    return {"headline": headline, "what_it_is": what_it_is, "why_it_matters": why_it_matters,
            "what_to_watch_for": what_to_watch_for, "failure_signal": failure_signal}


register(_PATTERN_ID, detect_uct_episodic_pivot_v2)
