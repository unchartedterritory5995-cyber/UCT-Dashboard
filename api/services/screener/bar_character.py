"""What the newest bar DID — gaps, structural failures, reversals, volume.

⭐ WHY THIS IS A SECOND COLUMN AND NOT MORE CANDLE LABELS. `candle_catalog`
answers "what SHAPE is this bar" in the Japanese vocabulary. That vocabulary has
no word at all for a bar that gapped up 4% and closed on its low, for a new
20-day high that closed red on three times normal volume, or for a session that
traded a huge range on no volume. Those are the bars a swing trader most wants
to find, and they are described by the bar's relationship to the GAP, to recent
STRUCTURE, and to VOLUME — three things candle geometry cannot see.

⛔ THE CASCADE IS A STRICT PRIORITY ORDER, and that is the whole design: an
ordered list of predicates evaluated top to bottom, first match wins, with the
last predicate identically true. That makes the labels mutually exclusive BY
CONSTRUCTION (exactly one `return` runs) and collectively exhaustive BY THE
TERMINAL (there is no bar that reaches the end unnamed). Overlap between two
predicates is not a bug here — it is the ordering doing its job: a bar that is
both an Upthrust and a Wide Range Down Bar is reported as the Upthrust, which is
strictly the more informative of the two.

⛔ NO FORWARD-LOOKING GAP TYPE IS NAMED. Breakaway / runaway / exhaustion gaps
are defined entirely by what happens AFTER them (Bulkowski: a breakaway closes
within a week 1% of the time, an exhaustion gap 60%), so naming one on the gap
day is fabrication. This module names only what the session itself settled:
direction, whether the gap filled, and where it closed.

⚠️ FIVE HEADS NEVER FIRE ON A TYPICAL DAY, AND THAT IS THE DESIGN — measured
2026-08-24 over 3,707 tickers: `buying-climax` (3 bars satisfy it), `stopping-
volume` (7), `vacuum-move` (17), `range-expansion-up` (9), `range-expansion-down`
(5). Every one is absorbed by a HIGHER tier, almost always a gap label, because
the gap is the more informative account of the same session. ⭐ The evidence is
not lost: the volume suffix still carries it, so a stopping-volume bar reads
"Gap Down, Reversed, closed strong, on Huge Volume" — which says everything the
bare VSA name would and locates it in the session too. Do NOT promote these up
the cascade to make them appear; that trades a better label for a worse one.
(Contrast `upthrust`, which WAS a real ordering defect — see the note at its
entry: 11 bars satisfied it and 0 rendered because a more general label sat one
line above it in the SAME tier.)

Sources: `docs/superpowers/research/candles/09-notability-volatility-volume.md`
(VSA/Wyckoff via Tom Williams, Crabel on NR7/inside days, Bulkowski on key
reversals and gap statistics), plus 02/07 for the reversal-bar definitions.
"""
from dataclasses import dataclass
from typing import Callable

from . import technicals

# ── thresholds, all sourced ────────────────────────────────────────────────
GAP_ATR = 0.5          # a gap is "notable" at half an ATR ...
GAP_PCT = 0.02         # ... or 2% of the prior close, whichever fires first
WIDE = 1.8             # VSA wide-range bar, vs average SPREAD
NARROW = 0.8           # VSA narrow-range bar
EXPANSION = 3.0
TREND_DAY = 1.3
QUIET = 0.5
VOL_HEAVY = 1.8        # VSA high volume
VOL_HUGE = 3.0         # VSA ultra-high volume
VOL_CLIMACTIC = 4.0
VOL_LIGHT = 0.7
VOL_DRIED = 0.5
SPREAD_AVG_N = 20
LOOKBACK_20 = 20
LOOKBACK_10 = 10


@dataclass(frozen=True)
class Character:
    key: str
    label: str
    tier: int
    desc: str
    detect: Callable


# ── comparisons that survive a missing measurement ─────────────────────────
# ⛔ `rvol` and `r_tr` are None on short history or absent volume, and `None >=
# 1.8` raises while `0 >= 1.8` LIES. An unknown must fail every test it is asked,
# in both directions — "we don't know" is never evidence.
def _ge(x, t): return x is not None and x >= t
def _le(x, t): return x is not None and x <= t
def _lt(x, t): return x is not None and x < t
def _bt(x, a, b): return x is not None and a <= x < b


def features(bars: list[dict]) -> dict | None:
    """The whole feature vector, or None when there is no bar to describe."""
    if not bars:
        return None
    from api.services import indicator_compute

    b = bars[-1]
    o, h, l, c = b["o"], b["h"], b["l"], b["c"]
    v = technicals._volume(b)
    rng = h - l
    prev = bars[-2] if len(bars) >= 2 else None
    pc = prev["c"] if prev else None
    ph = prev["h"] if prev else None
    pl = prev["l"] if prev else None

    # ⛔ TRUE range against ATR for the range bands, high-low against average
    # SPREAD for the VSA tier. ATR14 averages the GAP-INCLUSIVE range, so
    # comparing a bare `h - l` to it systematically understates exactly the gap
    # days most worth naming; VSA's 1.8/0.8 multiples were calibrated on average
    # spread, not on ATR, so they get their own denominator.
    tr = rng if pc is None else max(rng, abs(h - pc), abs(l - pc))
    atr = None
    if len(bars) >= 15:
        try:
            atr = indicator_compute.compute_atr_raw(bars, 14)[-1]
        except Exception:                                      # noqa: BLE001
            atr = None
    spreads = [x["h"] - x["l"] for x in bars[-SPREAD_AVG_N - 1:-1]]
    avg_spread = sum(spreads) / len(spreads) if spreads else None

    f = {
        "o": o, "h": h, "l": l, "c": c, "v": v, "rng": rng,
        "pc": pc, "ph": ph, "pl": pl,
        "clv": (c - l) / rng if rng > 0 else None,
        "r_tr": tr / atr if atr else None,
        "r_hl": rng / avg_spread if avg_spread else None,
        "rvol": technicals.volume_ratio(bars),
        "atr": atr,
    }

    # gaps — measured against the prior CLOSE (the opening gap) and against the
    # prior RANGE (a chart gap / true island edge).
    f["gap_atr"] = (o - pc) / atr if (pc is not None and atr) else None
    f["gap_pct"] = (o - pc) / pc if (pc not in (None, 0)) else None
    up = _ge(f["gap_atr"], GAP_ATR) or _ge(f["gap_pct"], GAP_PCT)
    dn = _le(f["gap_atr"], -GAP_ATR) or _le(f["gap_pct"], -GAP_PCT)
    f["gap_up"], f["gap_dn"] = bool(up), bool(dn)
    f["gap_filled"] = (l <= pc if up else h >= pc) if (pc is not None and (up or dn)) else False
    f["chart_gap_up"] = ph is not None and l > ph
    f["chart_gap_dn"] = pl is not None and h < pl
    p2 = bars[-3] if len(bars) >= 3 else None
    f["chart_gap_up_1"] = bool(prev and p2 and prev["l"] > p2["h"])
    f["chart_gap_dn_1"] = bool(prev and p2 and prev["h"] < p2["l"])

    def _win(n, off=1):
        s = bars[-(n + off):-off] if off else bars[-n:]
        return s if len(s) == n else []

    w20, w20p = _win(LOOKBACK_20), _win(LOOKBACK_20, 2)
    w10 = _win(LOOKBACK_10)
    f["hi20"] = max((x["h"] for x in w20), default=None)
    f["lo20"] = min((x["l"] for x in w20), default=None)
    f["hi20p"] = max((x["h"] for x in w20p), default=None)
    f["lo20p"] = min((x["l"] for x in w20p), default=None)
    f["hi10"] = max((x["h"] for x in w10), default=None)
    f["lo10"] = min((x["l"] for x in w10), default=None)

    closes50 = [x["c"] for x in bars[-50:]]
    f["ma50"] = sum(closes50) / len(closes50) if len(closes50) == 50 else None

    last7 = [x["h"] - x["l"] for x in bars[-7:]]
    f["nr7"] = len(last7) == 7 and rng <= min(last7)
    f["inside"] = ph is not None and h < ph and l > pl

    f["v1"] = technicals._volume(prev) if prev else None
    f["v2"] = technicals._volume(p2) if p2 else None
    downs = [technicals._volume(x) for x in bars[-11:-1]
             if len(bars) >= 11 and x["c"] < x["o"]]
    downs = [x for x in downs if x is not None]
    f["down_vol_max_10"] = max(downs) if downs else None
    return f


# ── the suffix ladders — each MECE, each total over its own coordinate ─────
_CLOSE_LADDER = [(0.90, "closed on the high"), (0.70, "closed strong"),
                 (0.55, "closed upper-half"), (0.45, "closed mid-range"),
                 (0.30, "closed lower-half"), (0.10, "closed weak")]
_VOL_LADDER = [(VOL_CLIMACTIC, "on Climactic Volume"), (VOL_HUGE, "on Huge Volume"),
               (VOL_HEAVY, "on Heavy Volume")]


def close_fragment(f) -> str | None:
    clv = f.get("clv")
    if clv is None:
        return None
    for cut, text in _CLOSE_LADDER:
        if clv >= cut:
            return text
    return "closed on the low"


def volume_fragment(f) -> str | None:
    """⚠️ OMITTED, NEVER "average". A missing fragment reads as unremarkable,
    which is exactly right for both an average day and an unmeasurable one — but
    `rvol` itself is None rather than 1.0 so nothing downstream mistakes an
    absent measurement for a normal one."""
    r = f.get("rvol")
    if r is None:
        return None
    for cut, text in _VOL_LADDER:
        if r >= cut:
            return text
    if r < VOL_DRIED:
        return "on Dried-Up Volume"
    if r < VOL_LIGHT:
        return "on Light Volume"
    return None


# ── direction, the TRADER's definition ─────────────────────────────────────
# ⭐ Up/down is close vs PRIOR close, not the body colour. A bar that opened
# down 3% and closed up 1% off the open is a DOWN day to everyone holding it;
# the body colour is surfaced separately through the close fragment.
def _up(f):   return f["pc"] is not None and f["c"] > f["pc"]
def _down(f): return f["pc"] is not None and f["c"] < f["pc"]


def _new_20d_high(f): return f["hi20"] is not None and f["h"] > f["hi20"]
def _new_20d_low(f):  return f["lo20"] is not None and f["l"] < f["lo20"]


CASCADE = [
    # ── Tier 0: degenerate guards. MUST be first — every later tier divides
    # by a range or reads a close position that does not exist here.
    Character("no-trade", "No Trade", 0, detect=lambda f: not f["v"],
              desc="The session recorded no volume at all. Nothing traded, so there "
                   "is no behaviour to describe — the price marks are carried, not made."),
    Character("flat-bar", "Flat Bar", 0, detect=lambda f: f["rng"] <= 0,
              desc="High, low, open and close were all the same price — a halt, a "
                   "limit move, or a single print. The bar has no range to have a "
                   "character inside."),

    # ── Tier 1: the gap IS the story. Named by what the session settled —
    # never by a forward-looking gap TYPE, which only tomorrow can decide.
    Character("island-reversal-top", "Island Reversal Top", 1,
              detect=lambda f: f["chart_gap_up_1"] and f["chart_gap_dn"],
              desc="Gapped away from the chart on the way up, then gapped back down "
                   "— leaving a cluster of bars stranded above with clear air on "
                   "both sides. Genuinely rare."),
    Character("island-reversal-bottom", "Island Reversal Bottom", 1,
              detect=lambda f: f["chart_gap_dn_1"] and f["chart_gap_up"],
              desc="Gapped down away from the chart, then gapped back up, stranding "
                   "the bars between with clear air on both sides."),
    Character("gap-up-and-go", "Gap Up & Go", 1,
              detect=lambda f: f["gap_up"] and not f["gap_filled"]
              and f["c"] >= f["o"] and _ge(f["clv"], 0.60),
              desc="Opened with a real gap up, never filled it, and closed in the "
                   "upper part of the range. Buyers paid up at the open and kept "
                   "paying — the cleanest continuation shape a gap can print."),
    Character("gap-up-reversed", "Gap Up, Reversed", 1,
              detect=lambda f: f["gap_up"] and not f["gap_filled"]
              and f["c"] < f["o"] and _le(f["clv"], 0.40),
              desc="Gapped up, held the gap, but sold off from the open and closed "
                   "near the low. Everyone who bought the open is offside."),
    Character("gap-up-filled", "Gap Up, Filled", 1,
              detect=lambda f: f["gap_up"] and f["pc"] is not None
              and f["l"] <= f["pc"] <= f["c"],
              desc="Gapped up, traded all the way back to yesterday's close, then "
                   "recovered to finish above it. The gap was tested and held."),
    Character("gap-up-closed-red", "Gap Up → Closed Red", 1,
              detect=lambda f: f["gap_up"] and _down(f),
              desc="Gapped up and still finished BELOW yesterday's close. The whole "
                   "gap was given back and then some."),
    Character("gap-down-and-go", "Gap Down & Go", 1,
              detect=lambda f: f["gap_dn"] and not f["gap_filled"]
              and f["c"] <= f["o"] and _le(f["clv"], 0.40),
              desc="Opened with a real gap down, never filled it, and closed near "
                   "the low. Sellers hit the open and kept hitting it."),
    Character("gap-down-reversed", "Gap Down, Reversed", 1,
              detect=lambda f: f["gap_dn"] and not f["gap_filled"]
              and f["c"] > f["o"] and _ge(f["clv"], 0.60),
              desc="Gapped down, held below the gap, but rallied off the open to "
                   "close near the high. The panic open was bought."),
    Character("gap-down-filled", "Gap Down, Filled", 1,
              detect=lambda f: f["gap_dn"] and f["pc"] is not None
              and f["c"] <= f["pc"] <= f["h"],
              desc="Gapped down, traded all the way back up to yesterday's close, "
                   "then faded to finish below it."),
    Character("gap-down-closed-green", "Gap Down → Closed Green", 1,
              detect=lambda f: f["gap_dn"] and _up(f),
              desc="Gapped down and still finished ABOVE yesterday's close. The "
                   "entire gap was bought back — a red-to-green day with a gap in it."),
    Character("gap-up-stalled", "Gap Up, Stalled", 1, detect=lambda f: f["gap_up"],
              desc="A real gap up that went nowhere: the gap held but the session "
                   "closed mid-range. Neither side pressed the advantage."),
    Character("gap-down-stalled", "Gap Down, Stalled", 1, detect=lambda f: f["gap_dn"],
              desc="A real gap down that went nowhere — the gap held and the session "
                   "closed mid-range."),

    # ── Tier 2: structural failure or reclaim at a level the market watches.
    # The highest-value class here, and one candle geometry cannot see at all.
    # ⭐ THE VOLUME-CONFIRMED LABEL COMES FIRST. Upthrust and Failed
    # Breakout describe the SAME event — a poke above the 20-day high that
    # did not hold — but Upthrust carries three extra pieces of evidence
    # (heavy volume, a wide range, a close in the bottom third). Ordered the
    # other way round it can never fire: measured 2026-08-24, **11 bars were
    # Upthrusts and 0 rendered**, 5 of them absorbed by Failed Breakout one
    # line above. Same relationship for Spring vs Undercut & Reclaim (9
    # satisfied, 1 rendered). Most specific first, exactly as `classify_shape`
    # orders its sub-types.
    Character("upthrust", "Upthrust", 2,
              detect=lambda f: _new_20d_high(f) and _le(f["clv"], 0.30)
              and _ge(f["rvol"], VOL_HEAVY) and _ge(f["r_tr"], TREND_DAY),
              desc="A new 20-day high, rejected hard, closing in the bottom third on "
                   "heavy volume and a wide range. Wyckoff's signature of supply "
                   "meeting demand at the highs — the volume is what makes it one."),
    Character("failed-breakout", "Failed Breakout", 2,
              detect=lambda f: _new_20d_high(f) and f["hi20p"] is not None
              and f["c"] < f["hi20p"],
              desc="Poked above the 20-day high and closed back underneath it. The "
                   "breakout everyone was watching did not hold — the setup that "
                   "traps momentum buyers."),
    Character("spring-shakeout", "Spring / Shakeout", 2,
              detect=lambda f: _new_20d_low(f) and _ge(f["clv"], 0.70)
              and _ge(f["r_tr"], TREND_DAY),
              desc="Broke the 20-day low on a wide range and closed in the top third "
                   "— weak holders shaken out and the price immediately recovered."),
    Character("undercut-and-reclaim", "Undercut & Reclaim", 2,
              detect=lambda f: _new_20d_low(f) and f["lo20p"] is not None
              and f["c"] > f["lo20p"] and _up(f),
              desc="Broke the 20-day low, then closed back above it and above "
                   "yesterday. The breakdown failed and the sellers got trapped."),
    Character("reclaimed-50-day", "Reclaimed the 50-Day", 2,
              detect=lambda f: f["ma50"] is not None and f["pc"] is not None
              and f["l"] < f["ma50"] < f["c"] and f["pc"] < f["ma50"],
              desc="Traded below the 50-day moving average and closed back above it, "
                   "from a start below. The most-watched intermediate line, retaken."),
    Character("lost-50-day", "Lost the 50-Day", 2,
              detect=lambda f: f["ma50"] is not None and f["pc"] is not None
              and f["c"] < f["ma50"] < f["h"] and f["pc"] > f["ma50"],
              desc="Traded above the 50-day moving average and closed below it, from "
                   "a start above. The line gave way."),

    # ── Tier 3: named reversal bars from the Western practitioner canon.
    Character("key-reversal-up", "Key Reversal Up", 3,
              detect=lambda f: f["ph"] is not None
              and f["l"] < f["pl"] and f["o"] < f["pc"] and f["c"] > f["ph"],
              desc="Opened below yesterday's close, undercut yesterday's low, then "
                   "closed above yesterday's HIGH. Bulkowski's strict definition — "
                   "a full-day sentiment flip."),
    Character("key-reversal-down", "Key Reversal Down", 3,
              detect=lambda f: f["ph"] is not None
              and f["h"] > f["ph"] and f["o"] > f["pc"] and f["c"] < f["pl"],
              desc="Opened above yesterday's close, took out yesterday's high, then "
                   "closed below yesterday's LOW."),
    Character("outside-reversal-up", "Outside Reversal Up", 3,
              detect=lambda f: f["ph"] is not None and f["h"] > f["ph"]
              and f["l"] < f["pl"] and f["c"] > f["ph"],
              desc="Engulfed yesterday's entire range — both the high and the low — "
                   "and closed above its high."),
    Character("outside-reversal-down", "Outside Reversal Down", 3,
              detect=lambda f: f["ph"] is not None and f["h"] > f["ph"]
              and f["l"] < f["pl"] and f["c"] < f["pl"],
              desc="Engulfed yesterday's entire range and closed below its low."),
    Character("outside-day-unresolved", "Outside Day, Unresolved", 3,
              detect=lambda f: f["ph"] is not None and f["h"] > f["ph"] and f["l"] < f["pl"],
              desc="Traded beyond yesterday's high AND its low, then closed between "
                   "them. A wider, more volatile session that settled nothing."),
    Character("reversal-day-up", "Reversal Day Up", 3,
              detect=lambda f: f["lo10"] is not None and f["l"] < f["lo10"]
              and _up(f) and _ge(f["clv"], 0.70),
              desc="Made a fresh 10-day low, then closed up on the day and near the "
                   "high of its range."),
    Character("reversal-day-down", "Reversal Day Down", 3,
              detect=lambda f: f["hi10"] is not None and f["h"] > f["hi10"]
              and _down(f) and _le(f["clv"], 0.30),
              desc="Made a fresh 10-day high, then closed down on the day and near "
                   "the low of its range."),
    Character("red-to-green", "Red to Green", 3,
              detect=lambda f: f["pc"] is not None and f["o"] < f["pc"] and _up(f),
              desc="Opened below yesterday's close and finished above it. Bought all "
                   "day from a weak start."),
    Character("green-to-red", "Green to Red", 3,
              detect=lambda f: f["pc"] is not None and f["o"] > f["pc"] and _down(f),
              desc="Opened above yesterday's close and finished below it. Sold all "
                   "day from a strong start."),

    # ── Tier 4: volume-and-range anomalies (VSA), when nothing structural fired.
    # ⭐ EFFORT VS RESULT is the idea the Japanese canon has no word for: the
    # off-diagonal cases (huge volume with no range, big range with no volume)
    # are pure notability detectors.
    Character("selling-climax", "Selling Climax", 4,
              detect=lambda f: _ge(f["r_tr"], 2.0) and _ge(f["rvol"], VOL_HUGE)
              and _ge(f["clv"], 0.50) and _down(f),
              desc="A very wide range on enormous volume, closing down but in the "
                   "upper half — heavy selling absorbed by someone willing to take "
                   "all of it."),
    Character("buying-climax", "Buying Climax", 4,
              detect=lambda f: _ge(f["r_tr"], 2.0) and _ge(f["rvol"], VOL_HUGE)
              and _le(f["clv"], 0.50) and _up(f),
              desc="A very wide range on enormous volume, closing up but in the lower "
                   "half — heavy buying being sold into."),
    Character("stopping-volume", "Stopping Volume", 4,
              detect=lambda f: _ge(f["rvol"], VOL_HUGE) and _ge(f["r_tr"], TREND_DAY)
              and _ge(f["clv"], 0.50) and _down(f),
              desc="A down day on very heavy volume that still closed in the upper "
                   "half. Someone stepped in size against the decline."),
    Character("churn", "Churn (Effort, No Result)", 4,
              detect=lambda f: _ge(f["rvol"], VOL_HEAVY) and _le(f["r_tr"], NARROW)
              and f["clv"] is not None and 0.30 < f["clv"] < 0.70,
              desc="Heavy volume that produced almost no range and a middling close. "
                   "A great deal of effort for no result — usually two sides trading "
                   "size against each other."),
    Character("vacuum-move", "Vacuum Move", 4,
              detect=lambda f: _ge(f["r_tr"], WIDE) and _le(f["rvol"], VOL_LIGHT),
              desc="A big range on light volume — result without effort. Nobody was "
                   "there to take the other side, so price travelled easily."),
    Character("no-demand", "No Demand", 4,
              detect=lambda f: _up(f) and _lt(f["r_hl"], NARROW)
              and f["v"] is not None and f["v1"] is not None and f["v2"] is not None
              and f["v"] < f["v1"] and f["v"] < f["v2"],
              desc="An up day on a narrow range and less volume than either of the "
                   "prior two sessions. The rise is not being supported."),
    Character("no-supply", "No Supply", 4,
              detect=lambda f: _down(f) and _lt(f["r_hl"], NARROW)
              and f["v"] is not None and f["v1"] is not None and f["v2"] is not None
              and f["v"] < f["v1"] and f["v"] < f["v2"],
              desc="A down day on a narrow range and less volume than either of the "
                   "prior two sessions. Nobody is pressing the downside."),
    Character("test-bar", "Test Bar", 4,
              detect=lambda f: f["pl"] is not None and f["l"] < f["pl"]
              and _le(f["rvol"], VOL_LIGHT) and _lt(f["r_hl"], NARROW)
              and _ge(f["clv"], 0.50) and f["pc"] is not None and f["c"] >= f["pc"],
              desc="Dipped under yesterday's low on light volume and closed back in "
                   "the upper half. The market probed for sellers and found none."),
    Character("pocket-pivot", "Pocket Pivot", 4,
              detect=lambda f: _up(f) and f["v"] is not None
              and f["down_vol_max_10"] is not None and f["v"] > f["down_vol_max_10"],
              desc="An up day whose volume exceeds every DOWN day of the prior ten "
                   "sessions. Accumulation showing up before a breakout does."),

    # ── Tier 5: the terminal descriptive partition. Every remaining bar lands
    # here, and the last predicate is identically true.
    Character("inside-day-nr7", "Inside Day (NR7)", 5,
              detect=lambda f: f["inside"] and f["nr7"],
              desc="Held entirely inside yesterday's range AND printed the narrowest "
                   "range of the last seven sessions. Crabel's double compression — "
                   "the tightest coil a single bar can show."),
    Character("inside-day", "Inside Day", 5, detect=lambda f: f["inside"],
              desc="High and low both inside yesterday's. A pause: the market did not "
                   "find a reason to leave yesterday's range."),
    Character("compression-bar-nr7", "Compression Bar (NR7)", 5, detect=lambda f: f["nr7"],
              desc="The narrowest range of the last seven sessions. Volatility "
                   "contracting, which historically precedes expansion."),
    Character("range-expansion-up", "Range Expansion Up", 5,
              detect=lambda f: _ge(f["r_tr"], EXPANSION) and _up(f),
              desc="A range at least three times normal, closing up. Violent "
                   "expansion — something happened."),
    Character("range-expansion-down", "Range Expansion Down", 5,
              detect=lambda f: _ge(f["r_tr"], EXPANSION) and _down(f),
              desc="A range at least three times normal, closing down."),
    Character("wide-range-up-bar", "Wide Range Up Bar", 5,
              detect=lambda f: _bt(f["r_tr"], WIDE, EXPANSION) and _up(f),
              desc="A notably wide session — roughly two to three times normal range "
                   "— closing up."),
    Character("wide-range-down-bar", "Wide Range Down Bar", 5,
              detect=lambda f: _bt(f["r_tr"], WIDE, EXPANSION) and _down(f),
              desc="A notably wide session, closing down."),
    Character("trend-day-up", "Trend Day Up", 5,
              detect=lambda f: _bt(f["r_tr"], TREND_DAY, WIDE) and _ge(f["clv"], 0.85)
              and f["rng"] > 0 and (f["o"] - f["l"]) <= 0.25 * f["rng"],
              desc="Opened near the low, closed near the high, and travelled an "
                   "above-average range in between — one-way traffic all session."),
    Character("trend-day-down", "Trend Day Down", 5,
              detect=lambda f: _bt(f["r_tr"], TREND_DAY, WIDE) and _le(f["clv"], 0.15)
              and f["rng"] > 0 and (f["h"] - f["o"]) <= 0.25 * f["rng"],
              desc="Opened near the high and closed near the low across an "
                   "above-average range — one-way traffic lower."),
    Character("dead-bar", "Dead Bar", 5,
              detect=lambda f: _lt(f["r_tr"], QUIET) and f["atr"] and f["pc"] is not None
              and abs(f["c"] - f["pc"]) / f["atr"] < 0.1,
              desc="Barely any range and barely any net change. The session happened "
                   "and nothing came of it."),
    Character("quiet-up-bar", "Quiet Up Bar", 5,
              detect=lambda f: _bt(f["r_tr"], QUIET, NARROW) and _up(f),
              desc="A below-average range, closing up. A quiet advance."),
    Character("quiet-down-bar", "Quiet Down Bar", 5,
              detect=lambda f: _bt(f["r_tr"], QUIET, NARROW) and _down(f),
              desc="A below-average range, closing down. A quiet decline."),
    Character("up-bar", "Up Bar", 5, detect=_up,
              desc="Closed above yesterday's close on an unremarkable range. An "
                   "ordinary up day — the close fragment says where in the range it "
                   "finished."),
    Character("down-bar", "Down Bar", 5, detect=_down,
              desc="Closed below yesterday's close on an unremarkable range."),
    # ⛔ THE TERMINAL. Identically true, so the cascade is TOTAL by construction
    # — there is no bar that can reach the end of this list unnamed. It also
    # catches the genuinely unchanged close and the first bar of a series, which
    # has no prior close to be up or down against.
    Character("unchanged", "Unchanged", 5, detect=lambda f: True,
              desc="Finished at yesterday's close, or has no prior session to be "
                   "measured against."),
]

BY_KEY = {ch.key: ch for ch in CASCADE}
assert len(BY_KEY) == len(CASCADE), "duplicate character key"
assert CASCADE[-1].detect({}) is True, "the cascade must end in a total predicate"


def classify(bars: list[dict]) -> dict:
    """Name what the newest bar DID. Always answers — see the terminal above."""
    f = features(bars)
    if f is None:
        return {"bar_character": None, "bar_character_label": None}
    for ch in CASCADE:
        try:
            if ch.detect(f):
                break
        except (TypeError, KeyError, ZeroDivisionError):
            continue          # a missing measurement costs its label, not the row
    else:                                                       # pragma: no cover
        ch = BY_KEY["unchanged"]
    parts = [ch.label]
    if ch.tier > 0:           # a no-trade / flat bar has no close or volume story
        for frag in (close_fragment(f), volume_fragment(f)):
            if frag:
                parts.append(frag)
    return {"bar_character": ch.key, "bar_character_label": ", ".join(parts)}


def enum_options() -> list:
    """Filter presets, derived from the cascade — never hand-listed."""
    return [{"label": "Any"}] + [
        {"label": ch.label, "op": "eq", "value": ch.key} for ch in CASCADE]
