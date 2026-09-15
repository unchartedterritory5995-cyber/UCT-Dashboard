"""The breadth METRIC catalogue — what a measurement IS, independent of universe.

⭐⭐ THE OTHER HALF OF `UNIVERSE × METRIC`. `breadth_universes` says what a
population is; this says what a measurement is. Neither knows about the other, and
the catalogue projection (`breadth_symbols.library_rows`) is the only place they
meet. That is what keeps "% above the 50-day MA over Nasdaq" from being a separate
thing from "% above the 50-day MA over UCT": it is one metric and two populations.

⛔ METADATA ONLY. Nothing here computes anything. `breadth_live.compute_metrics`
owns every definition; this file describes what those numbers MEAN — the unit, the
domain, how a chart should draw them, and whether the measurement even makes sense
over a different population.

⚠️ THE `code` COLUMN IS NOT YET A PUBLIC NAME. It is the namespaced half of a
future canonical identity (`NASDAQ:A50`), and the owner has explicitly NOT locked
the abbreviations. It is here because the projection needs a stable internal key
per metric; renaming one is a data edit in this file plus an alias row, not a
migration, precisely because the rendered symbol is never parsed to recover
identity (see `breadth_symbols.LEGACY_SYMBOL_BY_METRIC`).
"""
from __future__ import annotations

import os
from typing import Optional

# ── Vocabulary ───────────────────────────────────────────────────────────────

#: What the number counts. Drives the axis, the readout precision, and — this is
#: the load-bearing one — whether the exchange universes may publish it before the
#: attribution data is trustworthy (see PORTABILITY below).
UNIT_PERCENT = "percent"        # 0-100, a share of the universe
UNIT_COUNT = "count"            # a number of securities; scales with universe size
UNIT_RATIO = "ratio"            # a quotient of two counts; universe-size invariant
UNIT_INDEX = "index"            # an externally-scaled index value
UNIT_POINTS = "points"          # an oscillator in its own units

#: The shape of the number line the metric lives on. `signed` is the one a chart
#: has to know about: it needs a meaningful zero, not a 0-100 axis.
DOMAIN_PCT = "pct_0_100"
DOMAIN_NONNEG = "nonneg"
DOMAIN_SIGNED = "signed"
DOMAIN_RATIO = "ratio"

#: How a chart should draw it ABSENT a member's own choice. A preference, never a
#: rule — `presentation.js` still lets a member pick anything.
PRES_LINE = "line"
PRES_HISTOGRAM = "histogram"

# ── Portability ──────────────────────────────────────────────────────────────
#
# ⛔⛔ PORTABILITY IS A DATA CLAIM, NOT A CONVENIENCE FLAG, and it is the reason
# this column exists rather than "just run every metric everywhere".
#
#   PORTABLE      — the measurement is a function of the universe's constituents,
#                   so it means the same thing over any population.
#   NOT_PORTABLE  — the number does not come from constituents at all (an external
#                   survey, an ETF pair ratio, a proprietary composite), so a
#                   "Nasdaq CNN Fear & Greed" would be a label over UCT's number.
#                   These stay UCT-only forever, not until some later phase.
#
# ⚠️ AND PORTABILITY IS NOT THE SAME QUESTION AS PUBLISHABILITY. A COUNT metric is
# perfectly portable and still must not be published for NASDAQ/NYSE before 2011 —
# Phase 1 measured exchange misattribution at ~±20 % on counts there while
# percentages moved ≤0.8 pp. That floor lives in `breadth_universes.HISTORY_FLOOR`
# and applies to the UNIVERSE; this column applies to the METRIC. Two different
# facts, deliberately in two different files.
PORTABLE = "portable"
NOT_PORTABLE = "not_portable"

# ── What the PIT PRODUCER can actually make ──────────────────────────────────
#
# ⛔⛔ PORTABILITY IS A CLAIM ABOUT THE MEASUREMENT; THIS IS A CLAIM ABOUT THE
# PRODUCER. A metric can be perfectly portable in principle and still be
# unproducible — or, worse, WRONGLY producible — by the point-in-time sweep that
# builds the new universes, and that is a different fact needing its own column.
# It was found by measurement, not by reading: a 5-session control over
# 2015-03-09..13 wrote 40 of the 42 portable metrics, and one of the 40 was wrong.
#
#   atr_ext_7        NOTHING IS WRITTEN. It needs intraday high/low for the ATR,
#                    which is why `breadth_live.NOT_LIVE` already lists it — and
#                    the sweep runs through that same live engine. The grouped
#                    frame now carries o/h/l, so this is buildable later; today it
#                    would be an identity a member can find and never chart.
#
#   adv_decline_cum  NOTHING IS WRITTEN. A cumulative line needs a SEED, and
#                    `derive_live_row` takes it from `recent[0]`, which is empty at
#                    the start of every sweep chunk — so the first row is None and
#                    every row after it inherits None. It also could not simply be
#                    seeded per chunk: the grind walks BACKWARD, so each chunk
#                    would start its own accumulation and the line would step at
#                    every chunk boundary.
#
#   mcclellan_osc    ⚰️ VALUES ARE WRITTEN AND THEY ARE WRONG, which is the one
#                    that had to be caught before a grind rather than after.
#                    `build_levels` is called over the WHOLE MATRIX — correct for
#                    every other level, because a 50-day average of a member is the
#                    same number whoever else is in the frame — but `mcc_ema19` /
#                    `mcc_ema39` are the only levels that are NOT per-ticker. They
#                    are EMAs of the whole market's net advances, while today's
#                    `net = adv - dec` IS universe-restricted, so the oscillator
#                    mixes two populations.
#
#                    Measured 2015-03-09, same sweep, three universes:
#
#                        universe   count   net adv   McClellan
#                        US         2,936     +507      -232.9
#                        NASDAQ     1,195     +268      -244.8
#                        NYSE       1,712     +243      -246.1
#
#                    Populations differing by 2.5x produce oscillators 1.3 points
#                    apart, and all three read deeply negative on a day every one
#                    of them advanced broadly. Both tells say the same thing: the
#                    history is not theirs. A ratio-adjusted McClellan
#                    ((adv-dec)/(adv+dec)) built per universe is the real fix, and
#                    it is a product decision rather than a defect repair.
#
# ⚠️ UCT IS UNAFFECTED at every entry: it is measured by the collector, not by this
# sweep, and `applies_to` returns True for it unconditionally.
PIT_UNPRODUCIBLE = frozenset({"atr_ext_7", "adv_decline_cum", "mcclellan_osc"})

# (metric_key, code, name, short_name, group, unit, domain, presentation, portability)
_ROWS = [
    # ── MA breadth — proportions, the most trustworthy family ────────────────
    ("pct_above_5sma",    "A5",   "% of Stocks Above 5-Day MA",   "A5",   "ma", UNIT_PERCENT, DOMAIN_PCT, PRES_LINE, PORTABLE),
    ("pct_above_10sma",   "A10",  "% of Stocks Above 10-Day MA",  "A10",  "ma", UNIT_PERCENT, DOMAIN_PCT, PRES_LINE, PORTABLE),
    ("pct_above_20ema",   "A20",  "% of Stocks Above 20-Day EMA", "A20",  "ma", UNIT_PERCENT, DOMAIN_PCT, PRES_LINE, PORTABLE),
    ("pct_above_40sma",   "A40",  "% of Stocks Above 40-Day MA",  "A40",  "ma", UNIT_PERCENT, DOMAIN_PCT, PRES_LINE, PORTABLE),
    ("pct_above_50sma",   "A50",  "% of Stocks Above 50-Day MA",  "A50",  "ma", UNIT_PERCENT, DOMAIN_PCT, PRES_LINE, PORTABLE),
    ("pct_above_100sma",  "A100", "% of Stocks Above 100-Day MA", "A100", "ma", UNIT_PERCENT, DOMAIN_PCT, PRES_LINE, PORTABLE),
    ("pct_above_200sma",  "A200", "% of Stocks Above 200-Day MA", "A200", "ma", UNIT_PERCENT, DOMAIN_PCT, PRES_LINE, PORTABLE),

    # ── Momentum / primary breadth — counts, plus two ratios ─────────────────
    ("up_4pct_today",     "U4",    "Stocks Up 4%+ Today",           "Up 4%",     "momentum", UNIT_COUNT, DOMAIN_NONNEG, PRES_LINE, PORTABLE),
    ("down_4pct_today",   "D4",    "Stocks Down 4%+ Today",         "Down 4%",   "momentum", UNIT_COUNT, DOMAIN_NONNEG, PRES_LINE, PORTABLE),
    ("up_20pct_5d",       "U20W",  "Stocks Up 20%+ in 5 Days",      "Up 20%/5d", "momentum", UNIT_COUNT, DOMAIN_NONNEG, PRES_LINE, PORTABLE),
    ("down_20pct_5d",     "D20W",  "Stocks Down 20%+ in 5 Days",    "Dn 20%/5d", "momentum", UNIT_COUNT, DOMAIN_NONNEG, PRES_LINE, PORTABLE),
    ("up_25pct_month",    "U25M",  "Stocks Up 25%+ in a Month",     "Up 25%/mo", "momentum", UNIT_COUNT, DOMAIN_NONNEG, PRES_LINE, PORTABLE),
    ("down_25pct_month",  "D25M",  "Stocks Down 25%+ in a Month",   "Dn 25%/mo", "momentum", UNIT_COUNT, DOMAIN_NONNEG, PRES_LINE, PORTABLE),
    ("up_50pct_month",    "U50M",  "Stocks Up 50%+ in a Month",     "Up 50%/mo", "momentum", UNIT_COUNT, DOMAIN_NONNEG, PRES_LINE, PORTABLE),
    ("down_50pct_month",  "D50M",  "Stocks Down 50%+ in a Month",   "Dn 50%/mo", "momentum", UNIT_COUNT, DOMAIN_NONNEG, PRES_LINE, PORTABLE),
    ("up_25pct_quarter",  "U25Q",  "Stocks Up 25%+ in a Quarter",   "Up 25%/qtr","momentum", UNIT_COUNT, DOMAIN_NONNEG, PRES_LINE, PORTABLE),
    ("down_25pct_quarter","D25Q",  "Stocks Down 25%+ in a Quarter", "Dn 25%/qtr","momentum", UNIT_COUNT, DOMAIN_NONNEG, PRES_LINE, PORTABLE),
    ("magna_up",          "MU",    "Momentum Up (13% in 34 Days)",  "Mom Up",    "momentum", UNIT_COUNT, DOMAIN_NONNEG, PRES_LINE, PORTABLE),
    ("magna_down",        "MD",    "Momentum Down (13% in 34 Days)","Mom Dn",    "momentum", UNIT_COUNT, DOMAIN_NONNEG, PRES_LINE, PORTABLE),
    ("ratio_5day",        "R5",    "5-Day Up/Down Ratio",           "5d U/D",    "momentum", UNIT_RATIO, DOMAIN_RATIO, PRES_LINE, PORTABLE),
    ("ratio_10day",       "R10",   "10-Day Up/Down Ratio",          "10d U/D",   "momentum", UNIT_RATIO, DOMAIN_RATIO, PRES_LINE, PORTABLE),
    ("up_vol_ratio",      "UV",    "Up/Down Volume Ratio",          "U/D Vol",   "momentum", UNIT_RATIO, DOMAIN_RATIO, PRES_LINE, PORTABLE),

    # ── Highs / lows ─────────────────────────────────────────────────────────
    ("new_52w_highs",     "NH",    "New 52-Week Highs",             "New Highs", "highs_lows", UNIT_COUNT, DOMAIN_NONNEG, PRES_LINE, PORTABLE),
    ("new_52w_lows",      "NL",    "New 52-Week Lows",              "New Lows",  "highs_lows", UNIT_COUNT, DOMAIN_NONNEG, PRES_LINE, PORTABLE),
    # ⭐ THE SIGNED ONE. Its domain and presentation are DATA here so the renderer
    # never learns a ticker: a chart asks the catalogue how to draw a metric.
    ("net_new_high_low",  "NETHL", "Net New 52-Week Highs-Lows",    "Net H-L",   "highs_lows", UNIT_COUNT, DOMAIN_SIGNED, PRES_HISTOGRAM, PORTABLE),
    ("new_20d_highs",     "NH20",  "New 20-Day Highs",              "20d Highs", "highs_lows", UNIT_COUNT, DOMAIN_NONNEG, PRES_LINE, PORTABLE),
    ("new_20d_lows",      "NL20",  "New 20-Day Lows",               "20d Lows",  "highs_lows", UNIT_COUNT, DOMAIN_NONNEG, PRES_LINE, PORTABLE),
    ("hi_ratio",          "PH",    "% of Stocks at 52-Week Highs",  "% at Highs","highs_lows", UNIT_PERCENT, DOMAIN_PCT, PRES_LINE, PORTABLE),
    ("lo_ratio",          "PL",    "% of Stocks at 52-Week Lows",   "% at Lows", "highs_lows", UNIT_PERCENT, DOMAIN_PCT, PRES_LINE, PORTABLE),
    ("near_52w_high",     "NRH",   "Stocks Within 5% of 52W High",  "Near High", "highs_lows", UNIT_COUNT, DOMAIN_NONNEG, PRES_LINE, PORTABLE),
    ("hvc_52w",           "HVC",   "High-Volume Closes (52W Vol Hi)", "HVC",     "highs_lows", UNIT_COUNT, DOMAIN_NONNEG, PRES_LINE, PORTABLE),
    ("atr_ext_7",         "XR",    "Stocks >7x ATR Extended (50MA)", "ATR Ext",  "highs_lows", UNIT_COUNT, DOMAIN_NONNEG, PRES_LINE, PORTABLE),
    # ⛔ NOT PORTABLE FOR A DATA REASON, not a semantic one: an all-time high needs
    # full-depth per-ticker history the frame does not carry, which is why
    # `breadth_history_recon._NEVER_SWEEP_STORE` refuses it and `compute_metrics`
    # publishes None rather than a 52-week count wearing the ATH label.
    ("new_ath",           "ATH",   "New All-Time Highs",            "New ATH",   "highs_lows", UNIT_COUNT, DOMAIN_NONNEG, PRES_LINE, NOT_PORTABLE),

    # ── Base / component counts ──────────────────────────────────────────────
    # ⭐ THESE ARE STORED BY THE SWEEP AND WERE NOT CATALOGUED, which made them
    # invisible to `applies_to` — and applicability is what decides whether a metric
    # may be written for a PIT universe. They are pure constituent counts over the
    # measured population, so they port exactly as the rest of the family does.
    ("universe_count",    "UNI",   "Universe Count",                "Universe",  "score_regime", UNIT_COUNT, DOMAIN_NONNEG, PRES_LINE, PORTABLE),
    ("advancing",         "ADV",   "Advancing Issues",              "Advancing", "score_regime", UNIT_COUNT, DOMAIN_NONNEG, PRES_LINE, PORTABLE),
    ("declining",         "DEC",   "Declining Issues",              "Declining", "score_regime", UNIT_COUNT, DOMAIN_NONNEG, PRES_LINE, PORTABLE),
    ("up_on_volume",      "UPV",   "Up-Volume Issues",              "Up Vol",    "momentum", UNIT_COUNT, DOMAIN_NONNEG, PRES_LINE, PORTABLE),
    ("down_on_volume",    "DNV",   "Down-Volume Issues",            "Dn Vol",    "momentum", UNIT_COUNT, DOMAIN_NONNEG, PRES_LINE, PORTABLE),
    # ⛔ A Follow-Through Day is a statement about an INDEX's session, not about a
    # universe's constituents — `derive_live_row` refuses to set it intraday for the
    # same reason. "NASDAQ is_ftd" would be the index's flag under another name.
    ("is_ftd",            "FTD",   "Follow-Through Day",            "FTD",       "score_regime", UNIT_POINTS, DOMAIN_NONNEG, PRES_LINE, NOT_PORTABLE),

    # ── Score / regime ───────────────────────────────────────────────────────
    ("mcclellan_osc",     "MC",    "McClellan Oscillator",          "McClellan", "score_regime", UNIT_POINTS, DOMAIN_SIGNED, PRES_LINE, PORTABLE),
    ("adv_decline_cum",   "AD",    "Advance/Decline Line",          "A/D Line",  "score_regime", UNIT_COUNT, DOMAIN_SIGNED, PRES_LINE, PORTABLE),
    ("adv_decline",       "NA",    "Net Advancers (Daily)",         "Net Adv",   "score_regime", UNIT_COUNT, DOMAIN_SIGNED, PRES_HISTOGRAM, PORTABLE),
    ("stage2_count",      "S2",    "Stage 2 Uptrend Count",         "Stage 2",   "score_regime", UNIT_COUNT, DOMAIN_NONNEG, PRES_LINE, PORTABLE),
    ("stage4_count",      "S4",    "Stage 4 Downtrend Count",       "Stage 4",   "score_regime", UNIT_COUNT, DOMAIN_NONNEG, PRES_LINE, PORTABLE),
    # ⛔ The five below are NOT functions of a universe's constituents. An ETF pair
    # ratio is two instruments; a survey is a survey; the composite consumes both
    # plus VIX. "NASDAQ Fear & Greed" would be UCT's number with a different label.
    ("breadth_score",     "HS",    "UCT Breadth Health Score",      "Health",    "score_regime", UNIT_POINTS, DOMAIN_NONNEG, PRES_LINE, NOT_PORTABLE),
    ("uct_exposure",      "X",     "UCT Exposure Rating",           "Exposure",  "score_regime", UNIT_POINTS, DOMAIN_NONNEG, PRES_LINE, NOT_PORTABLE),
    ("rsp_spy_ratio",     "EW",    "Equal-Weight vs Cap-Weight (RSP/SPY)", "RSP/SPY", "score_regime", UNIT_RATIO, DOMAIN_RATIO, PRES_LINE, NOT_PORTABLE),
    ("iwm_qqq_ratio",     "SC",    "Small-Cap vs Nasdaq (IWM/QQQ)", "IWM/QQQ",   "score_regime", UNIT_RATIO, DOMAIN_RATIO, PRES_LINE, NOT_PORTABLE),
    ("cnn_fear_greed",    "FG",    "CNN Fear & Greed Index",        "Fear/Greed","score_regime", UNIT_INDEX, DOMAIN_PCT, PRES_LINE, NOT_PORTABLE),
    ("cboe_putcall",      "PC",    "CBOE Put/Call Ratio",           "Put/Call",  "score_regime", UNIT_RATIO, DOMAIN_RATIO, PRES_LINE, NOT_PORTABLE),
    ("aaii_spread",       "AAII",  "AAII Bull-Bear Spread",         "AAII",      "score_regime", UNIT_PERCENT, DOMAIN_SIGNED, PRES_LINE, NOT_PORTABLE),
]

_FIELDS = ("metric", "code", "name", "short_name", "group", "unit", "domain",
           "presentation", "portability")

METRICS = {r[0]: dict(zip(_FIELDS, r)) for r in _ROWS}
METRIC_KEYS = [r[0] for r in _ROWS]
CODE_TO_METRIC = {r[1]: r[0] for r in _ROWS}

#: Metrics that may be measured over ANY universe.
PORTABLE_METRICS = [k for k, m in METRICS.items() if m["portability"] == PORTABLE]


def get(metric: str) -> Optional[dict]:
    """The metric's metadata, or None. Unknown is None rather than a raise: a
    metric key can legitimately arrive from a stored row written before this
    catalogue existed, and a chart should degrade to defaults rather than fail."""
    return METRICS.get(metric)


def is_portable(metric: str) -> bool:
    m = METRICS.get(metric)
    return bool(m) and m["portability"] == PORTABLE


def applies_to(metric: str, universe: str) -> bool:
    """May this metric be measured over this universe?

    ⭐ UCT KEEPS EVERYTHING, including the non-portable metrics, because UCT is
    where they are actually measured — the collector computes the survey and
    composite values and stores them beside the constituent ones. A PIT universe
    gets the portable set and nothing else.

    ⚠️ This answers APPLICABILITY, not availability by date. Whether a universe may
    publish a given date is `breadth_universes.sweepable_range`.
    """
    from api.services import breadth_universes as bu
    uni = bu.normalize(universe)
    if metric not in METRICS:
        return False
    if uni == bu.DEFAULT_UNIVERSE:
        return True
    # ⛔ TWO GATES, TWO FACTS. Portability asks whether the measurement MEANS the
    # same thing over another population; `PIT_UNPRODUCIBLE` asks whether the sweep
    # that builds that population can actually produce it. A metric must clear both
    # before a PIT universe may store it OR offer it — this one function is what
    # `library_rows` and the sweep's `_applies` both read, so a metric excluded here
    # cannot be written to the store and cannot appear in the catalogue.
    return is_portable(metric) and metric not in PIT_UNPRODUCIBLE


def metrics_for(universe: str) -> list[str]:
    """Metric keys applicable to `universe`, in catalogue order."""
    return [k for k in METRIC_KEYS if applies_to(k, universe)]


def signed_metrics() -> list[str]:
    """Metrics whose values legitimately cross zero — the ones a chart must not
    put on a 0-100 axis and should offer a zero baseline for."""
    return [k for k, m in METRICS.items() if m["domain"] == DOMAIN_SIGNED]


# ── Publication sets ──────────────────────────────────────────────
#
# ⭐⭐ FIVE DIFFERENT QUESTIONS, AND THEY ARE NOT THE SAME QUESTION. Conflating any
# two of them is how a member finds an identity that can never have rows, or how a
# metric nobody signed off on reaches a chart.
#
#   REGISTERED   the catalogue knows it                    `metric in METRICS`
#   APPLICABLE   the measurement MEANS the same thing      `is_applicable()`
#                over that population (portability)
#   PRODUCIBLE   the producer for that universe can        `is_producible()`  (BL-012)
#                actually make it, correctly
#   STORED       rows exist in breadth_daily_ohlc          `breadth_symbols.availability()`
#   PUBLISHED    a member may discover and chart it        `is_published_metric()`
#
# A V1.1 metric is registered + applicable + producible + STORED and deliberately NOT
# published. That is the whole of BL-014: grind once at the full producible set,
# publish a focused V1, promote later with a flag flip rather than a second grind.
#
# ⛔⛔ UCT IS NOT GATED BY A PUBLICATION SET. Its 44 symbols have been shipped and
# charted for a year; a V1 list drawn up for the NEW universes must never take one of
# them off the air. `is_published_metric` says so in one place rather than relying on
# every caller to remember.

#: The accepted V1 set (owner, 2026-09-15). 18 metrics. Order is catalogue order.
V1_METRICS = (
    # Participation — percent, universe-size invariant, the most trustworthy family
    "pct_above_5sma", "pct_above_10sma", "pct_above_20ema", "pct_above_40sma",
    "pct_above_50sma", "pct_above_100sma", "pct_above_200sma",
    # Highs / Lows — the two counts, their signed net, and the two percentages
    "new_52w_highs", "new_52w_lows", "net_new_high_low", "hi_ratio", "lo_ratio",
    # Momentum — the 4% movers and the two ratios built from them
    "up_4pct_today", "down_4pct_today", "ratio_5day", "ratio_10day",
    # Base — the denominator, and net advancers as a signed histogram
    "universe_count", "adv_decline",
)

#: Named publication sets. `*` is not a set — see `publication_set_name`.
PUBLICATION_SETS = {"v1": V1_METRICS}

DEFAULT_PUBLICATION_SET = "v1"


def is_applicable(metric: str, universe: str) -> bool:
    """Does the MEASUREMENT mean the same thing over this population?

    ⚠️ Portability alone. `applies_to` is the combined gate a writer or a catalogue
    should ask; this exists so the vocabulary above is inspectable and railable.
    """
    from api.services import breadth_universes as bu
    if metric not in METRICS:
        return False
    if bu.normalize(universe) == bu.DEFAULT_UNIVERSE:
        return True
    return is_portable(metric)


def is_producible(metric: str, universe: str) -> bool:
    """Can the PRODUCER for this universe actually make it, correctly? (BL-012)

    ⚠️ UCT answers True for everything: it is measured by the COLLECTOR, and the PIT
    sweep's limits are not the collector's.
    """
    from api.services import breadth_universes as bu
    if metric not in METRICS:
        return False
    if bu.normalize(universe) == bu.DEFAULT_UNIVERSE:
        return True
    return metric not in PIT_UNPRODUCIBLE


def publication_set_name() -> str:
    """The active set id, from `BREADTH_LIBRARY_METRICS`. Default `v1`.

    ⚠️ AN UNKNOWN NAME FALLS BACK TO THE DEFAULT rather than publishing nothing or
    everything — the same rule `published_universe_ids` uses for a typo'd universe. A
    bad flag must not be able to change what members see in EITHER direction.
    """
    raw = (os.environ.get("BREADTH_LIBRARY_METRICS") or "").strip().lower()
    if raw == "*":
        return "*"
    return raw if raw in PUBLICATION_SETS else DEFAULT_PUBLICATION_SET


def published_metric_keys() -> list[str]:
    """The metric keys the active publication set allows, in catalogue order."""
    name = publication_set_name()
    if name == "*":
        return list(METRIC_KEYS)
    want = set(PUBLICATION_SETS.get(name, ()))
    return [k for k in METRIC_KEYS if k in want]


def is_published_metric(metric: str, universe: str) -> bool:
    """May a member discover and chart `universe × metric`?

    ⭐ UCT ANSWERS YES FOR EVERYTHING IT HAS ALWAYS CARRIED. The publication set
    governs what the NEW universes expose; it is not a re-litigation of the 44 symbols
    already shipped.
    """
    from api.services import breadth_universes as bu
    if metric not in METRICS:
        return False
    if bu.normalize(universe) == bu.DEFAULT_UNIVERSE:
        return True
    return metric in set(published_metric_keys())
