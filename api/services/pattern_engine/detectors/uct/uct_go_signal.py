"""UCT Go Signal detector (daily footprint) — pattern_id `uct_go_signal`. INTERNAL (admin-only).

The Go Signal is an intraday entry: in a stock that has already shown it can
move, the session opens weak, sweeps a nearby support, and buyers step in and
turn it. This detector reads its DAILY footprint only; the real trigger is on
the 30/65-minute chart, which the daily bar cannot see.

Fires (the variants kept after blind adjudication), on session i:
  G0  the 20-day EMA is rising over 5 sessions (blind review: bounces inside a
      downtrend were judged no)
  G1  location: a notable recent move — a 13% gain over 5 sessions within the
      last 20, OR a 4% gap on 2x volume within the last 30, OR a tight 10-bar base
      (range <= 2.5 ATR) above the 50-day
  G2  a weak open: open below the prior close
  G3  a sweep of support: the low trades under the prior low, the 5-bar low, or
      an EMA9/EMA20/SMA50 the prior close was above
  G4  buyers stepped in: a lower wick of >= 40% of the range, or the low under
      the open with the close in the upper half
  G6  a strong close: in the upper 40% of the range (a gate since the blind review)
  variants: red_to_green (also closes above the prior close) and daily_proxy

Labels only: the same shape without the location test. The bearish mirror (a
tight box under the 20-day broken on volume) was not blind-adjudicated and is
not fired.

Entry: the prior close when it traded that session (red to green), else the
close. Stop: the session low.
"""
from __future__ import annotations

from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.primitives.liquidity import liquidity_floor


_PATTERN_ID = "uct_go_signal"
_PATTERN_NAME = "UCT Go Signal"

# [P] proposed defaults (the only lab-tunable values)
GO_RUN_X, GO_RUN_WIN = 1.13, 20
GO_EVENT_WIN, GO_EVENT_VOL, GO_EVENT_GAP = 30, 2.0, 0.04
GO_BASE_BARS, GO_BASE_ATR = 10, 2.5
GO_WICK = 0.4
GO_FOOT_DCR = 0.5
GO_STRONG_DCR = 0.6
GO_TREND_E20_BARS = 5
GO_INV_BOX_BARS, GO_INV_BOX_ATR = 10, 2.0
_MIN_IDX = 60
_MIN_BARS = _MIN_IDX + 1


def evaluate(bars: list, S: dict, i: int) -> Optional[dict]:
    if i < _MIN_IDX or not (U.valid_bar(bars[i]) and U.valid_bar(bars[i - 1])):
        return None
    a = S["atr"][i]
    if not a or S["s50"][i] is None:
        return None
    b, p = bars[i], bars[i - 1]
    o, h, l, c, v = b["o"], b["h"], b["l"], b["c"], float(b["v"] or 0.0)
    l1, c1 = p["l"], p["c"]
    cc = S["c"]
    g1a = any(cc[k] / cc[k - 5] >= GO_RUN_X for k in range(i - GO_RUN_WIN + 1, i + 1))
    g1b = any(S["v50"][k - 1] and S["v"][k] >= GO_EVENT_VOL * S["v50"][k - 1]
              and bars[k]["o"] / cc[k - 1] - 1 >= GO_EVENT_GAP
              for k in range(i - GO_EVENT_WIN + 1, i + 1))
    seg = bars[i - GO_BASE_BARS:i]
    g1c = ((max(x["h"] for x in seg) - min(x["l"] for x in seg)) <= GO_BASE_ATR * a
           and c1 > S["s50"][i - 1])
    g1 = g1a or g1b or g1c
    g2 = o < c1
    swept = []
    if l < l1:
        swept.append("prior_low")
    if l < min(x["l"] for x in bars[i - 5:i]):
        swept.append("5bar_low")
    for name, key in (("ema9", "e9"), ("ema20", "e20"), ("sma50", "s50")):
        m1, m = S[key][i - 1], S[key][i]
        if m1 and m and c1 > m1 and l < m:
            swept.append(name)
    rng = h - l
    g4 = rng > 0 and ((min(o, c) - l) >= GO_WICK * rng or (l < o and (c - l) / rng >= GO_FOOT_DCR))
    g5 = c > c1
    g6 = rng > 0 and (c - l) / rng >= GO_STRONG_DCR
    g0 = S["e20"][i] > S["e20"][i - GO_TREND_E20_BARS]
    strict = g0 and g1 and g2 and bool(swept) and g4 and g6
    if not strict:
        return None
    fired = ["red_to_green", "daily_proxy"] if g5 else ["daily_proxy"]
    v50 = S["v50"][i]
    return {
        "idx": i, "variant": fired[0], "fired_variants": fired, "label_variants": ["no_location"],
        "swept": swept, "red_to_green": g5, "loc_run": g1a, "loc_event": g1b, "loc_base": g1c,
        "wick_frac": round((min(o, c) - l) / rng, 3) if rng else 0.0,
        "dcr": round((c - l) / rng, 3) if rng else 0.5,
        "oops_overlap": g2 and l < l1 and g5,
        "rvol50": round(v / v50, 2) if v50 else None,
        "trigger": c1 if o < c1 <= h else c, "stop": l, "prior_close": c1,
        "open": o, "close": c, "low": l,
    }


def _geometry_score(c: dict) -> float:
    g = 70.0
    g += 10.0 if c["red_to_green"] else 0.0
    g += 5.0 if c["loc_event"] else 0.0
    g += 5.0 if c["wick_frac"] >= 0.4 else 0.0
    g += 5.0 if len(c["swept"]) >= 2 else 0.0
    return round(min(100.0, g), 2)


def detect_uct_go_signal(bars: List[dict], context: dict) -> List[dict]:
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
                           entry_condition=(f"trade back over the prior close {c['prior_close']:.2f}"
                                            if c["trigger"] == c["prior_close"]
                                            else f"close {c['close']:.2f} off the swept low"),
                           stop_basis="session_low")
    anchors = [
        {"t": int(bars[i - 1]["t"]), "price": float(c["prior_close"])},
        {"t": int(bars[i]["t"]), "price": float(c["low"])},
    ]
    extras = {
        "variant": c["variant"], "fired_variants": c["fired_variants"],
        "label_variants": c["label_variants"], "swept": c["swept"],
        "red_to_green": c["red_to_green"], "loc_run": c["loc_run"], "loc_event": c["loc_event"],
        "loc_base": c["loc_base"], "wick_frac": c["wick_frac"], "dcr": c["dcr"],
        "oops_overlap": c["oops_overlap"], "rvol50": c["rvol50"],
        "daily_footprint_only": True,
    }
    return U.build_detection(
        pattern_id=_PATTERN_ID, pattern_name=_PATTERN_NAME, direction="bullish",
        bars=bars, trig_idx=i, start_idx=i - 1, anchors=anchors,
        anchor_roles=["prior_close", "swept_low"], extras=extras, levels=levels, context=context,
        narrative=_narrative(c, levels, context), geom=geom, vol=vol, ctx=ctx)


_SWEEP_WORDS = {"prior_low": "the prior day's low", "5bar_low": "the five-day low",
                "ema9": "the 9-day EMA", "ema20": "the 20-day EMA", "sma50": "the 50-day average"}


def _narrative(c, levels, context) -> dict:
    swept = ", ".join(_SWEEP_WORDS[s] for s in c["swept"])
    loc = ", ".join(x for x, f in (("a 13% run within the last month", c["loc_run"]),
                                   ("a volume gap within the last six weeks", c["loc_event"]),
                                   ("a tight base above the 50-day", c["loc_base"])) if f)
    headline = (
        f"UCT Go Signal (daily footprint) - weak open swept {swept} and closed in the top "
        f"{(1 - c['dcr']) * 100:.0f}% of the range; entry ${levels['entry']:.2f}, stop ${levels['stop']:.2f}."
    )
    what_it_is = (
        f"The Go Signal is an intraday entry pattern; this is its footprint on the daily chart. It needs "
        f"three things. First, location: a stock that has already shown it can move, here {loc}, with "
        f"the 20-day average rising. Second, a weak open that sweeps a nearby support: the session "
        f"opened at ${c['open']:.2f} below the prior close and traded under {swept}. Third, buyers "
        f"stepping in: the low was rejected with a lower wick of {c['wick_frac'] * 100:.0f}% of the range "
        f"and the close landed in the upper part of the day. The session "
        f"{'went red to green, closing above the prior close' if c['red_to_green'] else 'did not quite reclaim the prior close'}. "
        f"Because the real trigger lives on the 30 to 65-minute chart, this daily reading says where the "
        f"setup occurred, not when the intraday entry fired. {U.PROVENANCE_NOTE}"
    )
    why_it_matters = (
        f"A sweep of an obvious support flushes the stops that sit under it; when that selling is absorbed "
        f"and the stock turns, the people who were shaken out become buyers above, and the low of the "
        f"sweep becomes a level with a clear reason to hold. Location is what separates this from any "
        f"bounce: a strong stock dipping into support is a different trade from a weak stock bouncing. "
        f"The setup is forming in {U.context_phrase(context)}. Relative volume today is "
        f"{c['rvol50'] if c['rvol50'] is not None else 'unmeasured'}x the 50-bar average. "
        f"{'This session also qualifies as an oops-style reversal (opened below the prior close, undercut the prior low, closed above the prior close), so the two readings agree.' if c['oops_overlap'] else 'It does not fully qualify as an oops reversal, so it rests on the sweep and the rejection alone.'} "
        f"Sweeps of a level that many traders watch (the prior day's low or a widely followed average) "
        f"tend to carry more weight than sweeps of an arbitrary price, because more stops sit beneath them."
    )
    what_to_watch_for = (
        f"The entry is ${levels['entry']:.2f}: "
        f"{'the prior close, reclaimed during the session' if c['trigger'] == c['prior_close'] else 'the close, since the prior close was not traded through'}. "
        f"Intraday, the version traders want is a higher low on the 30 or 65-minute chart after the sweep, "
        f"then a push back through the open and the prior close on rising volume. On the daily chart, "
        f"the next session holding above today's midpoint confirms it. Targets in R from the low-of-day "
        f"stop: ${levels['target_primary']:.2f} (2R) and ${levels['target_secondary']:.2f} (3R); the "
        f"recent high from the move that put the stock in this location is the natural place to take "
        f"some off, because that is where the stock last ran into sellers before this pullback began. "
        f"A Go Signal that needs several sessions to follow through is a weaker version of the setup; "
        f"the strongest ones move away from the swept low within a day or two and never look back at it."
    )
    failure_signal = (
        f"The setup fails on a trade below ${levels['stop']:.2f}, the low of the sweep. The whole thesis "
        f"is that the support which was swept held on a closing basis; a new low means it did not, and "
        f"the stops below it were not the last sellers. A session that gives back the reclaim and closes "
        f"back under the prior close is an early warning. Because the stop is the low of the day, risk is "
        f"usually small and should be sized so a loss is routine. Do not convert a failed Go Signal into "
        f"a longer-term hold; if the low breaks, the reason for the trade is gone and the next support "
        f"down is a separate decision to be made on its own evidence. "
        f"Also watch for a second sweep of the same low within a few sessions: if it breaks on volume, "
        f"the buyers who stepped in the first time were not enough, and the level should be given up."
    )
    return {"headline": headline, "what_it_is": what_it_is, "why_it_matters": why_it_matters,
            "what_to_watch_for": what_to_watch_for, "failure_signal": failure_signal}


register(_PATTERN_ID, detect_uct_go_signal)
