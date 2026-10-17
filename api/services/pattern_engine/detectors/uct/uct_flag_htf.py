"""UCT Flag / High Tight Flag detector - pattern_id `uct_flag_htf`. INTERNAL (admin-only).

A flag is a strong move up (the pole) followed by a shallow, orderly pause
(the flag) that holds above a rising 21 EMA; it fires while price presses the
top of that pause or on the session that closes through it. A pole of +90% or
more is labelled the high-tight-flag variant.

This is a NEW detector beside `bull_flag`, `high_tight_flag` and `pennant`; it
does not change any of them. It is a port of the offline lab's team-setup
recognition rule `flag_htf` (feats_flag_htf / decide_flag_htf), at the grid
point chosen on the DEV half of the traders' scored calls by a selection rule
written down before the grid ran, and frozen before the TEST half ran, PLUS the
lab's shared guard (G1 | G2, version 1). The unguarded rule was NOT confirmed
(its second blind packet fell under the bar); the guarded rule was then
pre-registered as a new rule and judged on two fresh blind packets of 25 fires
each: 19 yes / 4 no and 16 yes / 5 no, pooled precision of decided 79.5%
(Wilson 95% CI 65-89). Only the guarded rule is ported. The guard's later
"version 2" (a longer gap look-back) was measured on the DEV half only and is
NOT used here.

The rule at session i (uses bars[:i+1] only). ATR = 14-session simple average
true range (always the ATR at session i); e21 is an EMA, s200 a simple average.
  * i >= 65, ATR > 0, the 50 SMA exists                (the lab's shared warm-up)
  * flag measured at a session k (k = i for `forming`, k = i - 1 for `breakout`):
      - pole high = the highest high of sessions k-25 .. k (latest on a tie),
        followed by >= 2 flag sessions
      - pole low = the lowest low of the 40 sessions before the pole high
        (inclusive of it); gain = pole high / pole low - 1
      - depth = (pole high - lowest low since the pole high) / (pole high - pole low)
      - close[k] >= e21[k] (tolerance 0 ATR) and e21[k] > e21[k-5]
  * `breakout`: close[i] > the highest high of the 10 sessions before i, no more
    than 2 ATR past it, with the flag measured at k = i - 1
  * `forming`: close[i] within 1.0 ATR of the highest high of sessions i-9 .. i
  * gain >= 0.40 and depth <= 0.62; `breakout` is tried first, then `forming`;
    a `_htf` suffix when gain >= 0.90 (label only)
  * guard, SUPPRESS when either holds:
      G1  close[i] < s200[i] and s200[i] < s200[i-20]   (False when either 200 SMA
          value does not exist)
      G2  a session in the last 60 (incl. i) opened >= 10% away from the prior
          close, AND the last 10 sessions' (highest high - lowest low) <= 3% of
          close[i]
Frozen grid point: gain 0.40, depth 0.62, e21tol 0.0, tight None, near 1.0.

Levels: the trigger is the top of the flag (the highest high of the 10
sessions ending at the flag session k); entry = that line for `forming` and
the close for `breakout`; stop = the flag's low (the lowest low since the pole
high), the team's own invalidation. Neither was tested as a risk anchor in the
lab: they are drawn levels. Geometry is the shared UCT idiom: a `candle_mark`
whose two anchors (with `anchor_roles`) are the pole high and the flag low,
plus display-only `geometry.secondary` lines for the flag top and the stop.

Wrapper (shared with the other UCT trader-setup detectors, not part of the lab
rule): the liquidity floor, the newest of the last `MAX_TRIGGER_AGE` sessions
that qualifies, and a prior-session trigger is reported only while no later
session has traded through its stop. ONE departure from the lab, on purpose:
the detector needs `_MIN_BARS` (220) bars, so G1 can always be evaluated. On a
shorter history the lab rule still answers, with G1 silently False, i.e. the
unguarded rule, which is the one that was NOT confirmed. Every blind packet
sampled sessions at bar index >= 260. The parity test pins the rule itself
against the lab code, bar for bar, at every session.

History depth: G1 reads the 200 SMA 20 sessions back, so session i needs
i >= 219. The detector declares `MIN_BARS` (222, so the two prior trigger
sessions are evaluable too); the daily scan hands it its own 222-bar slice.
The 21 EMA is seeded at the slice's first bar rather than at the start of the
ticker's history; 200+ sessions later that difference is ~1e-9 of the price,
so only an exact near-tie can resolve differently (measured by the parity
test's scan-window check).
"""
from __future__ import annotations

from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.primitives.liquidity import liquidity_floor


_PATTERN_ID = "uct_flag_htf"
_PATTERN_NAME = "UCT Flag / High Tight Flag"

# Lab constants (team_rules.py / team_rules_r2.py [P] values + the frozen tune
# result). Do not tune here; the parity test pins them to the lab.
FL_MAXLEN = 25          # [P] the flag lasts 2..25 sessions after the pole high
FL_MIN_LEN = 2          # [P] at least 2 flag sessions after the pole high
FL_POLE = 40            # [P] pole low = lowest low of the 40 sessions before the pole high
FL_HTF = 0.90           # [P] label only: pole >= +90% = the high-tight-flag variant
FL_E21_SLOPE = 5        # [P] the 21 EMA is rising vs 5 sessions back
FL_RANGE = 10           # [P] the 10-day range high (breakout line, forming distance)
FL_TIGHT_N = 5          # [P] tightness window (only read when FL_TIGHT is set)
FL_EXT_ATR = 2.0        # [P] a breakout no more than 2 ATR past the line
FL_GAIN = 0.40          # frozen: pole gain >= 40%
FL_DEPTH = 0.62         # frozen: flag retraces <= 62% of the pole
FL_E21_TOL = 0.0        # frozen: close at or above the 21 EMA (0 ATR tolerance)
FL_TIGHT = None         # frozen: no 5-day tightness cap
FL_NEAR_ATR = 1.0       # frozen: forming = close within 1.0 ATR of the 10-day high

# Shared guard, version 1 (team_rules_r2.py), exactly as the blind packets ran it.
G1_SLOPE = 20           # [P] the 200 SMA is falling when s200[i] < s200[i-20]
G2_GAP = 0.10           # [P] a gap = |open / prior close - 1| >= 10% ...
G2_LOOK = 60            # [P] ... on one of the last 60 sessions (incl. session i)
G2_PIN_N = 10           # [P] pinned = the last 10 sessions' range ...
G2_PIN_PCT = 0.03       # [P] ... <= 3% of the close

_WARMUP = 65            # the lab's shared warm-up (_base: i >= 65)
_MIN_IDX = 199 + G1_SLOPE   # G1 can be evaluated (s200 exists 20 sessions back)
_MIN_BARS = _MIN_IDX + 1
#: History declared to the scan (registry `min_bars`): enough for the newest
#: session AND the two prior sessions the wrapper may report (MAX_TRIGGER_AGE).
MIN_BARS = _MIN_BARS + U.MAX_TRIGGER_AGE - 1


def _hh(bars, lo, hi):
    return max(x["h"] for x in bars[lo:hi + 1])


def _ll(bars, lo, hi):
    return min(x["l"] for x in bars[lo:hi + 1])


def _flag_at(bars, S, a, k) -> Optional[dict]:
    """The lab's _flag_at: the flag measured at session k (a = ATR at session i)."""
    lo = k - FL_MAXLEN
    if lo < 0:
        return None
    jh = max(range(lo, k + 1), key=lambda j: (bars[j]["h"], j))
    fl = k - jh
    if fl < FL_MIN_LEN:
        return None
    H = bars[jh]["h"]
    if jh - FL_POLE < 0:
        return None
    pl = _ll(bars, jh - FL_POLE, jh)
    if pl <= 0 or H <= pl:
        return None
    fmin = _ll(bars, jh + 1, k)
    e21 = S["e21"]
    return {"len": fl, "gain": H / pl - 1, "depth": (H - fmin) / (H - pl),
            "c_e21": (bars[k]["c"] - e21[k]) / a,
            "e21_up": e21[k] > e21[k - FL_E21_SLOPE],
            "tight5": (_hh(bars, k - FL_TIGHT_N + 1, k) - _ll(bars, k - FL_TIGHT_N + 1, k)) / a,
            "dist10": (_hh(bars, k - FL_RANGE + 1, k) - bars[k]["c"]) / a}


def features(bars: list, S: dict, i: int) -> Optional[dict]:
    """The lab's feats_flag_htf at session i: None when the core precondition
    fails, else {'forming': ..., 'breakout': ...} (either may be absent)."""
    if i < 0 or i >= len(bars):
        return None
    a = S["atr"][i]
    if i < _WARMUP or a is None or a <= 0 or S["s50"][i] is None:
        return None
    f = {}
    x = _flag_at(bars, S, a, i)
    if x:
        f["forming"] = x
    line = _hh(bars, i - FL_RANGE, i - 1)
    if bars[i]["c"] > line:                     # 10-day range-high break on session i
        y = _flag_at(bars, S, a, i - 1)
        if y:
            y["ext"] = (bars[i]["c"] - line) / a
            f["breakout"] = y
    return f or None


def decide(f: dict) -> Optional[str]:
    """The lab's decide_flag_htf at the frozen grid point."""
    for v in ("breakout", "forming"):
        x = f.get(v)
        if not x:
            continue
        if x["gain"] < FL_GAIN or x["depth"] > FL_DEPTH or x["c_e21"] < -FL_E21_TOL or not x["e21_up"]:
            continue
        if v == "forming" and (x["dist10"] > FL_NEAR_ATR or
                               (FL_TIGHT is not None and x["tight5"] > FL_TIGHT)):
            continue
        if v == "breakout" and x["ext"] > FL_EXT_ATR:
            continue
        return v + ("_htf" if x["gain"] >= FL_HTF else "")
    return None


def falling_200_overhead(bars: list, S: dict, i: int) -> bool:
    """G1: close under a falling 200 SMA. False when the 200 SMA (now or
    G1_SLOPE sessions back) does not exist."""
    m = S["s200"]
    if i - G1_SLOPE < 0 or m[i] is None or m[i - G1_SLOPE] is None:
        return False
    return bars[i]["c"] < m[i] and m[i] < m[i - G1_SLOPE]


def pinned_post_gap(bars: list, i: int) -> bool:
    """G2 (version 1): a >= 10% opening gap in the last 60 sessions and a flat,
    pinned last 10 sessions (deal-like tape)."""
    gap = any(bars[k - 1]["c"] > 0 and abs(bars[k]["o"] / bars[k - 1]["c"] - 1) >= G2_GAP
              for k in range(max(1, i - G2_LOOK + 1), i + 1))
    if not gap:
        return False
    w = bars[max(0, i - G2_PIN_N + 1):i + 1]
    hh = max(x["h"] for x in w)
    ll = min(x["l"] for x in w)
    return (hh - ll) / bars[i]["c"] <= G2_PIN_PCT


def guard(bars: list, S: dict, i: int):
    """The shared guard: (suppress, reasons), as the lab's team_rules_r2.guard."""
    r = []
    if falling_200_overhead(bars, S, i):
        r.append("falling200")
    if pinned_post_gap(bars, i):
        r.append("pinned")
    return bool(r), r


def evaluate_unguarded(bars: list, S: dict, i: int) -> Optional[dict]:
    """The frozen round-1 rule alone (the lab's team_rules.rule): variant + facts."""
    f = features(bars, S, i)
    if f is None:
        return None
    v = decide(f)
    return None if v is None else {"variant": v, "facts": f}


def evaluate(bars: list, S: dict, i: int) -> Optional[dict]:
    """The confirmed rule at session i: the round-1 rule AND NOT the guard.
    Returns a candidate dict or None."""
    r = evaluate_unguarded(bars, S, i)
    if r is None or guard(bars, S, i)[0]:
        return None
    v, f = r["variant"], r["facts"]
    kind = "breakout" if v.startswith("breakout") else "forming"
    k = i - 1 if kind == "breakout" else i
    x = f[kind]
    jh = k - x["len"]
    jfl = min(range(jh + 1, k + 1), key=lambda j: (bars[j]["l"], j))
    jpl = min(range(jh - FL_POLE, jh + 1), key=lambda j: (bars[j]["l"], j))
    top = _hh(bars, k - FL_RANGE + 1, k)
    b = bars[i]
    v50 = S["v50"][i]
    return {
        "idx": i, "variant": v, "kind": kind, "facts": f,
        "pole_high_idx": jh, "pole_high": bars[jh]["h"], "pole_low_idx": jpl,
        "pole_low": bars[jpl]["l"], "flag_low_idx": jfl, "flag_low": bars[jfl]["l"],
        "flag_top": top, "gain": round(x["gain"], 4), "depth": round(x["depth"], 4),
        "flag_len": x["len"], "close": b["c"], "e21": S["e21"][i],
        "rvol50": round(S["v"][i] / v50, 2) if v50 else None,
        "trigger": top if kind == "forming" else b["c"], "stop": bars[jfl]["l"],
    }


def lab_facts(c: dict) -> dict:
    """The candidate in the lab's own result shape (team_rules.rule)."""
    return {"variant": c["variant"], "facts": c["facts"]}


def _geometry_score(c: dict) -> float:
    g = 70.0
    g += 10.0 if c["kind"] == "breakout" else 0.0
    g += 5.0 if c["variant"].endswith("_htf") else 0.0
    g += 5.0 if c["depth"] <= 0.38 else 0.0
    return round(min(100.0, g), 2)


def detect_uct_flag_htf(bars: List[dict], context: dict) -> List[dict]:
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
    i, jh, jfl = c["idx"], c["pole_high_idx"], c["flag_low_idx"]
    H, low, top = float(c["pole_high"]), float(c["flag_low"]), float(c["flag_top"])
    forming = c["kind"] == "forming"
    levels = U.make_levels(
        c["trigger"], low, "bullish",
        entry_condition=(f"break above the flag's 10-day high ({top:.2f})" if forming
                         else f"hold above the flag's 10-day high ({top:.2f}), broken this session"),
        stop_basis="below_flag_low")
    levels["pivot"] = round(top, 2)
    anchors = [{"t": int(bars[jh]["t"]), "price": H},
               {"t": int(bars[jfl]["t"]), "price": low}]
    secondary = [U.hline(bars, jh, i, top, "trigger", f"Flag high {top:.2f}"),
                 U.hline(bars, jh, i, low, "stop", f"Flag low {low:.2f}")]
    extras = {
        "variant": c["variant"], "fired_variants": [c["variant"]],
        "label_variants": ["high_tight_flag"] if c["variant"].endswith("_htf") else [],
        "pole_gain": c["gain"], "flag_depth": c["depth"], "flag_len": c["flag_len"],
        "pole_low": round(float(c["pole_low"]), 2), "pole_low_t": int(bars[c["pole_low_idx"]]["t"]),
        "pole_high": round(H, 2), "flag_low": round(low, 2), "flag_top": round(top, 2),
        "ema21": round(c["e21"], 2), "rvol50": c["rvol50"],
        "guard": "g1_falling200|g2_pinned_post_gap_v1",
        "lab_rule": "team_rules.flag_htf+team_rules_r2.guard",
    }
    return U.build_detection(
        pattern_id=_PATTERN_ID, pattern_name=_PATTERN_NAME, direction="bullish",
        bars=bars, trig_idx=i, start_idx=c["pole_low_idx"], anchors=anchors,
        anchor_roles=["pole_high", "flag_low"], extras=extras,
        levels=levels, context=context, narrative=_narrative(c, levels, context),
        geom=geom, vol=vol, ctx=ctx, secondary=secondary)


def _narrative(c, levels, context) -> dict:
    htf = c["variant"].endswith("_htf")
    kind = "high tight flag" if htf else "flag"
    top = c["flag_top"]
    if c["kind"] == "breakout":
        where = f"closed through the flag's 10-day high (${top:.2f})"
        watch = f"Follow-through above the session high, and any retest holding ${top:.2f}."
    else:
        where = f"is pressing the flag's 10-day high (${top:.2f})"
        watch = f"A close through ${top:.2f}."
    headline = (
        f"UCT {kind.title()} - a +{c['gain'] * 100:.0f}% pole, then a {c['flag_len']}-session flag "
        f"retracing {c['depth'] * 100:.0f}% of it; price {where}. Entry ${levels['entry']:.2f}, stop "
        f"${levels['stop']:.2f}."
    )
    what_it_is = (
        f"Price ran +{c['gain'] * 100:.0f}% into a high of ${c['pole_high']:.2f}, then paused for "
        f"{c['flag_len']} sessions without giving back more than {c['depth'] * 100:.0f}% of the move, "
        f"holding above a rising 21-day EMA. It is not under a falling 200-day SMA and not pinned flat "
        f"after a gap. {U.PROVENANCE_NOTE}"
    )
    why_it_matters = (
        f"A shallow, orderly pause after a strong move says holders are not selling into it; the "
        f"break of the flag's high is the trigger. The setup forms in {U.context_phrase(context)}. "
        f"This detector is experimental and admin-only: two blind reviews of its fires on random "
        f"days judged most of them real, on small samples; deep or loose pullbacks were the misses."
    )
    what_to_watch_for = (
        f"{watch} Targets are in R from the flag low: ${levels['target_primary']:.2f} (2R) and "
        f"${levels['target_secondary']:.2f} (3R)."
    )
    failure_signal = (
        f"A close under the 21-day EMA (${c['e21']:.2f}) is the first warning; a trade below the "
        f"flag low at ${levels['stop']:.2f} is the stop."
    )
    return {"headline": headline, "what_it_is": what_it_is, "why_it_matters": why_it_matters,
            "what_to_watch_for": what_to_watch_for, "failure_signal": failure_signal}


register(_PATTERN_ID, detect_uct_flag_htf, min_bars=MIN_BARS)
