"""UCT Flat-Top Breakout detector - pattern_id `uct_flat_top_breakout`. INTERNAL (admin-only).

A flat-top breakout is a base under a flat ceiling: the same high has turned
price back at least twice, the first time well before today, and price now
closes either just under that line (pressing it) or just through it, inside an
uptrend.

This is a NEW detector beside `flat_base`, `rectangle`, `donchian_breakout`,
`ascending_triangle` and `vcp`; it does not change any of them. It is a port
of the offline lab's team-setup recognition rule `flat_top_breakout`
(feats_flat_top_breakout / decide_flat_top_breakout), whose grid point was
chosen on the DEV half of the traders' scored calls by a selection rule written
down before the grid ran, and frozen before the TEST half ran. TEST half: recall
21.2% at a dense random ticker-day fire rate of 2.84% (lift 7.50; the best
production detector, donchian_breakout: 29.4% at 8.16%, lift 3.60). Two
independent blind packets of 25 fires each were judged 15 yes / 2 no and
13 yes / 4 no; pooled precision of decided 82.4% (Wilson 95% CI 66-92). The
`at_line` variant carries the misses; `breakout` was clean in both packets.

The rule at session i (uses bars[:i+1] only). ATR = 14-session simple average
true range; s50 / s200 are simple averages.
  * i >= 65, ATR > 0, the 50 SMA exists                (the lab's shared warm-up)
  * close > s50                                        (fixed uptrend gate)
  * s50 > s200, with the 200 SMA existing at i         (frozen trend "c>s50>s200")
  * ceiling H = the highest high of the L = 40 sessions before session i
  * touches: sessions in that window whose high >= H - 0.5 ATR; they form >= 2
    separate groups (a new group starts >= 3 sessions after the previous
    touch), and the first touch is >= 10 sessions before session i
  * base depth (H - lowest low of the window) / H <= 0.35
  * pos = (close - H) / ATR:  0 < pos <= 2.0 -> `breakout`;
                             -1.0 <= pos <= 0 -> `at_line`
Frozen grid point: L = 40, tol = 0.5 ATR, depth = 0.35, near = 1.0 ATR,
trend = "c>s50>s200". No other gate. In particular the shared
falling-200-SMA / pinned-price guard the lab tried afterwards is NOT part of
this rule: it was measured post hoc and never pre-registered for it.

Levels: pivot = the ceiling H. Entry = H for `at_line` (the break of the line)
and the close for `breakout`; stop = the marked session's low. Neither was
tested as a risk anchor in the lab: they are drawn levels. Geometry is the
shared UCT idiom: a `candle_mark` whose two anchors (with `anchor_roles`) are
the ceiling at its first touch and the marked session's low, plus
display-only `geometry.secondary` horizontal lines for the ceiling (from its
first touch) and the stop.

Wrapper (shared with the other UCT trader-setup detectors, not part of the lab
rule): the liquidity floor, the newest of the last `MAX_TRIGGER_AGE` sessions
that qualifies, and a prior-session trigger is reported only while no later
session has traded through its stop. The parity test pins the rule itself
against the lab code, bar for bar.

History depth: the 200 SMA must exist on the marked session, i.e. at least
`_MIN_BARS` (200) daily bars. The detector declares `MIN_BARS` (202, so the two
prior trigger sessions are evaluable too) at registration; the daily scan
hands it its own 202-bar slice. Every input of this rule is a windowed
average or extreme, so a 202-bar slice reproduces the lab's full-history
values exactly.
"""
from __future__ import annotations

from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.primitives.liquidity import liquidity_floor


_PATTERN_ID = "uct_flat_top_breakout"
_PATTERN_NAME = "UCT Flat-Top Breakout"

# Lab constants (team_rules.py [P] values + the frozen tune result). Do not
# tune here; the parity test pins them to the lab.
FT_GAP = 3              # [P] touches count as separate groups when >= 3 sessions apart
FT_MATURE = 10          # [P] first touch of the ceiling >= 10 sessions before session i
FT_EXT_ATR = 2.0        # [P] a breakout no more than 2 ATR past the ceiling
FT_L = 40               # frozen: ceiling window, sessions before session i
FT_TOL_ATR = 0.5        # frozen: a touch is a high within 0.5 ATR of the ceiling
FT_DEPTH = 0.35         # frozen: base depth <= 35% of the ceiling
FT_NEAR_ATR = 1.0       # frozen: at_line = close within 1.0 ATR under the ceiling
FT_TREND = "c>s50>s200"  # frozen: the 50 SMA above the 200 SMA as well

_MIN_IDX = 199          # the 200 SMA exists (the frozen trend needs it; else no fire)
_MIN_BARS = _MIN_IDX + 1
#: History declared to the scan (registry `min_bars`): enough for the newest
#: session AND the two prior sessions the wrapper may report (MAX_TRIGGER_AGE).
MIN_BARS = _MIN_BARS + U.MAX_TRIGGER_AGE - 1


def features(bars: list, S: dict, i: int) -> Optional[dict]:
    """The lab's feats_flat_top_breakout at session i, for the frozen window
    L and tolerance only: None when the core precondition fails, else the raw
    measurements (bars[:i+1] only)."""
    if i < 0 or i >= len(bars):
        return None
    a = S["atr"][i]
    if i < 65 or a is None or a <= 0 or S["s50"][i] is None:
        return None
    c = bars[i]["c"]
    if c <= S["s50"][i]:
        return None
    lo = i - FT_L
    if lo < 0:
        return None
    H = max(x["h"] for x in bars[lo:i])
    if H <= 0:
        return None
    depth = (H - min(x["l"] for x in bars[lo:i])) / H
    idx = [j for j in range(lo, i) if bars[j]["h"] >= H - FT_TOL_ATR * a]
    groups, last = 0, -99
    for j in idx:
        if j - last >= FT_GAP:
            groups += 1
        last = j
    return {"s50_gt_s200": S["s200"][i] is not None and S["s50"][i] > S["s200"][i],
            "depth": depth, "groups": groups, "age": i - idx[0], "pos": (c - H) / a,
            "ceiling": H, "first_touch_idx": idx[0], "touch_idx": idx}


def decide(f: dict) -> Optional[str]:
    """The lab's decide_flat_top_breakout at the frozen grid point."""
    if FT_TREND == "c>s50>s200" and not f["s50_gt_s200"]:
        return None
    if f["groups"] < 2 or f["age"] < FT_MATURE or f["depth"] > FT_DEPTH:
        return None
    if 0 < f["pos"] <= FT_EXT_ATR:
        return "breakout"
    if -FT_NEAR_ATR <= f["pos"] <= 0:
        return "at_line"
    return None


def evaluate(bars: list, S: dict, i: int) -> Optional[dict]:
    """The lab rule at session i. Returns a candidate dict or None."""
    f = features(bars, S, i)
    if f is None:
        return None
    v = decide(f)
    if v is None:
        return None
    b = bars[i]
    H = f["ceiling"]
    v50 = S["v50"][i]
    return {
        "idx": i, "variant": v, "facts": f,
        "ceiling": H, "first_touch_idx": f["first_touch_idx"],
        "touch_groups": f["groups"], "base_depth": round(f["depth"], 4),
        "pos_atr": round(f["pos"], 2), "close": b["c"], "low": b["l"],
        "s50": S["s50"][i], "s200": S["s200"][i],
        "rvol50": round(S["v"][i] / v50, 2) if v50 else None,
        "trigger": H if v == "at_line" else b["c"], "stop": b["l"],
    }


def lab_facts(c: dict) -> dict:
    """The candidate in the lab's own result shape for the frozen L / tol:
    the variant, the trend flag and facts[str(L)] with its frozen touch row."""
    f = c["facts"]
    return {"variant": c["variant"], "s50_gt_s200": f["s50_gt_s200"],
            "depth": f["depth"], "touch": (f["groups"], f["age"]), "pos": f["pos"]}


def _geometry_score(c: dict) -> float:
    g = 70.0
    g += 10.0 if c["variant"] == "breakout" else 0.0
    g += min(10.0, 5.0 * (c["touch_groups"] - 2))
    g += 5.0 if c["base_depth"] <= 0.20 else 0.0
    return round(min(100.0, g), 2)


def detect_uct_flat_top_breakout(bars: List[dict], context: dict) -> List[dict]:
    if len(bars) < _MIN_BARS or not liquidity_floor(bars).passes:
        return []
    context = context or {}
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
    i, k0 = c["idx"], c["first_touch_idx"]
    H, low = float(c["ceiling"]), float(c["stop"])
    at_line = c["variant"] == "at_line"
    levels = U.make_levels(
        c["trigger"], low, "bullish",
        entry_condition=(f"break above the flat ceiling ({H:.2f})" if at_line
                         else f"hold above the flat ceiling ({H:.2f}), broken this session"),
        stop_basis="below_marked_session_low")
    levels["pivot"] = round(H, 2)
    anchors = [{"t": int(bars[k0]["t"]), "price": H},
               {"t": int(bars[i]["t"]), "price": low}]
    secondary = [U.hline(bars, k0, i, H, "ceiling", f"Flat ceiling {H:.2f}"),
                 U.hline(bars, k0, i, low, "stop", f"Session low {low:.2f}")]
    extras = {
        "variant": c["variant"], "fired_variants": [c["variant"]], "label_variants": [],
        "ceiling": round(H, 2), "touch_groups": c["touch_groups"],
        "first_touch_t": int(bars[k0]["t"]), "base_window": FT_L,
        "base_depth": c["base_depth"], "pos_atr": c["pos_atr"],
        "sma50": round(c["s50"], 2), "sma200": round(c["s200"], 2), "rvol50": c["rvol50"],
        "lab_rule": "team_rules.flat_top_breakout",
    }
    return U.build_detection(
        pattern_id=_PATTERN_ID, pattern_name=_PATTERN_NAME, direction="bullish",
        bars=bars, trig_idx=i, start_idx=k0, anchors=anchors,
        anchor_roles=["ceiling", "session_low"], extras=extras,
        levels=levels, context=context, narrative=_narrative(c, levels, context),
        geom=geom, vol=vol, ctx=ctx, secondary=secondary)


def _narrative(c, levels, context) -> dict:
    H = c["ceiling"]
    if c["variant"] == "breakout":
        where = f"closed {c['pos_atr']:.1f} ATR through it"
        watch = (f"Follow-through above the session high, and any retest holding the ceiling at "
                 f"${H:.2f}.")
    else:
        where = f"closed {abs(c['pos_atr']):.1f} ATR under it, pressing the line"
        watch = f"A close through the ceiling at ${H:.2f}."
    headline = (
        f"UCT Flat-Top Breakout - a {FT_L}-session base under a flat ceiling at ${H:.2f}, touched "
        f"{c['touch_groups']} times; price {where}. Entry ${levels['entry']:.2f}, stop "
        f"${levels['stop']:.2f}."
    )
    what_it_is = (
        f"Over the last {FT_L} sessions the highs kept stalling at the same level (${H:.2f}), in "
        f"{c['touch_groups']} separate touches, the first well before this session. The base is "
        f"{c['base_depth'] * 100:.0f}% deep, price is above its 50-day SMA and the 50-day is above the "
        f"200-day, so this is a flat base inside an uptrend. {U.PROVENANCE_NOTE}"
    )
    why_it_matters = (
        f"A ceiling that has rejected price more than once collects the supply of everyone selling "
        f"there; a close through it says that supply is gone. The setup forms in "
        f"{U.context_phrase(context)}. This detector is experimental and admin-only: two blind "
        f"reviews of its fires on random days judged most of them real, on small samples; fires "
        f"still under the line were the weaker kind."
    )
    what_to_watch_for = (
        f"{watch} Targets are in R from the stop: ${levels['target_primary']:.2f} (2R) and "
        f"${levels['target_secondary']:.2f} (3R)."
    )
    failure_signal = (
        f"A close back inside the base, under ${H:.2f}, after a break is the first warning; a trade "
        f"below ${levels['stop']:.2f} is the stop."
    )
    return {"headline": headline, "what_it_is": what_it_is, "why_it_matters": why_it_matters,
            "what_to_watch_for": what_to_watch_for, "failure_signal": failure_signal}


register(_PATTERN_ID, detect_uct_flat_top_breakout, min_bars=MIN_BARS)
