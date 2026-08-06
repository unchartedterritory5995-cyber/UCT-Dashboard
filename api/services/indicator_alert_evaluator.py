"""Indicator alert evaluation loop.

Every 60s (configurable):
  1. List all active alerts (``indicator_alert_service.list_active``)
  2. Group by (sym, tf) to share bar fetches
  3. For each alert: compute the indicator value via ``indicator_compute``,
     evaluate condition vs last known value
  4. On trigger: record + dispatch delivery via the existing
     ``watchlist_alert_service.deliver_alert_payload`` hook (bell + email +
     Discord). On non-trigger but successful evaluation, persist the last
     value so the next cycle has a ``prev`` for cross-* conditions.

The evaluator runs in a single daemon thread. Each cycle is error-isolated
per alert so a single bad ticker does not block the rest. Bars are read
directly from the persistent SQLite store (``bars_sqlite.get_bars``); the
universe pre-warmer + background fetchers keep that store fresh, so we
never block on a remote API from this loop.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import defaultdict
from typing import Any, Callable, Optional

_logger = logging.getLogger(__name__)
_running = threading.Event()
_thread: Optional[threading.Thread] = None


# ─── pure condition matching ─────────────────────────────────────────────────

def check_condition(
    condition: str,
    current: Optional[float],
    prev: Optional[float],
    threshold: Optional[float],
) -> bool:
    """Does an alert fire given current + previous indicator values?

    ``current`` is the latest indicator value (last computed bar). ``prev``
    is the value persisted from the previous evaluation cycle — used only by
    cross-* conditions. ``threshold`` is the user-supplied trigger level for
    above / below / cross_above / cross_below.

    Returns ``False`` for unknown conditions, missing values, or any case
    where the condition is well-defined but not met. Pure function — no
    side effects, no I/O, no module imports.
    """
    if current is None:
        return False

    if condition == "above":
        return threshold is not None and current > threshold
    if condition == "below":
        return threshold is not None and current < threshold
    if condition == "cross_above":
        # Crossed UP through threshold: prev was at/below, current is strictly above.
        return (
            prev is not None
            and threshold is not None
            and prev <= threshold
            and current > threshold
        )
    if condition == "cross_below":
        # Crossed DOWN through threshold: prev was at/above, current is strictly below.
        return (
            prev is not None
            and threshold is not None
            and prev >= threshold
            and current < threshold
        )
    if condition == "cross_zero":
        # Crossed through zero in either direction.
        if prev is None:
            return False
        return (prev <= 0 < current) or (prev >= 0 > current)
    if condition == "touch_upper":
        # Used for Bollinger Band upper-touch — current is expected to be the
        # close, threshold is the upper-band value at the same bar.
        return threshold is not None and current >= threshold
    if condition == "touch_lower":
        # Mirror of touch_upper for the lower band.
        return threshold is not None and current <= threshold
    return False


# ─── indicator dispatch ──────────────────────────────────────────────────────

def _last_non_none(seq: list) -> Optional[float]:
    """Return the last non-None value from a list, or None if all None / empty."""
    for v in reversed(seq):
        if v is not None:
            return float(v)
    return None


def _value_rsi(bars: list[dict], params: dict) -> Optional[float]:
    from api.services import indicator_compute
    period = int(params.get("period", 14))
    closes = [b["c"] for b in bars]
    return _last_non_none(indicator_compute.compute_rsi(closes, period))


def _value_macd(bars: list[dict], params: dict) -> Optional[float]:
    from api.services import indicator_compute
    fast = int(params.get("fast", 12))
    slow = int(params.get("slow", 26))
    signal = int(params.get("signal", 9))
    closes = [b["c"] for b in bars]
    macd, _sig, _hist = indicator_compute.compute_macd(closes, fast, slow, signal)
    return _last_non_none(macd)


def _value_stoch(bars: list[dict], params: dict) -> Optional[float]:
    from api.services import indicator_compute
    k_period = int(params.get("k_period", 14))
    d_period = int(params.get("d_period", 3))
    k, _d = indicator_compute.compute_stoch(bars, k_period, d_period)
    return _last_non_none(k)


def _value_williams_r(bars: list[dict], params: dict) -> Optional[float]:
    from api.services import indicator_compute
    period = int(params.get("period", 14))
    return _last_non_none(indicator_compute.compute_williams_r(bars, period))


def _value_cci(bars: list[dict], params: dict) -> Optional[float]:
    from api.services import indicator_compute
    period = int(params.get("period", 20))
    return _last_non_none(indicator_compute.compute_cci(bars, period))


def _value_mfi(bars: list[dict], params: dict) -> Optional[float]:
    from api.services import indicator_compute
    period = int(params.get("period", 14))
    return _last_non_none(indicator_compute.compute_mfi(bars, period))


def _value_price_vs_ma(bars: list[dict], params: dict) -> Optional[float]:
    """Return the spread (close − MA) for ``price_vs_ma`` alerts.

    Frontend stores this as a single alert where the user picks an MA type
    (sma/ema) and a period; we publish ``close − ma`` so the user can set
    a threshold of 0 for "price above/below MA" or a positive number for
    "price more than $X above MA".
    """
    from api.services import indicator_compute
    period = int(params.get("period", 50))
    ma_type = (params.get("type") or "sma").lower()
    closes = [b["c"] for b in bars]
    if not closes:
        return None
    if ma_type == "ema":
        ma_series = indicator_compute.compute_ema(closes, period)
    else:
        ma_series = indicator_compute.compute_sma(closes, period)
    last_ma = _last_non_none(ma_series)
    if last_ma is None:
        return None
    return float(closes[-1]) - last_ma


def _value_bb(bars: list[dict], params: dict) -> Optional[float]:
    """For BB alerts the ``current`` we return is the latest close; the
    caller looks up the appropriate band as the threshold (touch_upper /
    touch_lower) from the same compute pass.
    """
    if not bars:
        return None
    return float(bars[-1]["c"])


# indicator name → (callable that returns current value, callable that returns
# threshold override for touch_upper/touch_lower or None)
def _bb_threshold_override(bars: list[dict], params: dict, condition: str) -> Optional[float]:
    """For BB touch_upper/touch_lower: dynamic threshold = current band value."""
    if condition not in ("touch_upper", "touch_lower"):
        return None
    from api.services import indicator_compute
    period = int(params.get("period", 20))
    stddev = float(params.get("stddev", 2.0))
    closes = [b["c"] for b in bars]
    upper, _mid, lower = indicator_compute.compute_bb(closes, period, stddev)
    if condition == "touch_upper":
        return _last_non_none(upper)
    return _last_non_none(lower)


# ─── B5: THE OTHER SIX DEFINITIONS, AND HOW A PLOT IS NAMED ──────────────────
#
# Seven engine definitions could not be alerted on at all (`vwap`, `atr`, `sar`,
# `ichimoku`, `adx`, `obv`, `donchian`) because this lane evaluates in PYTHON and
# `indicator_compute` had no Python for them. They are ported now, so the only
# thing left is naming.
#
# ⭐ THE ADDRESSING SCHEME. "Alert me on Ichimoku" is ambiguous — it has five
# plots; `adx` and `donchian` have three, `macd` three, `bb` three, `stoch` two.
# So the stored `indicator` field is a PLOT ADDRESS:
#
#     <base>            a base that carries exactly one alertable plot,
#                       OR the legacy spelling of a base's DEFAULT plot
#     <base>.<plot>     any other plot of that base
#
# ⛔ THE BARE FORM IS WHAT MAKES THIS BACKWARD-COMPATIBLE, AND IT IS NOT A
# SPECIAL CASE BOLTED ON. All eight pre-B5 keys are bare, and three of them
# (`macd`, `bb`, `stoch`) name a base with several plots — so a bare address is
# DEFINED as the base's first plot, and the eight legacy entries keep their exact
# spelling, their exact position, and the exact same callable object. A row
# already in `indicator_alerts` therefore resolves through the identical function
# it always did; `tests/fixtures/indicator_alert_baseline.json` replays 5,040
# recorded evaluations to prove that rather than assert it.
#
# ⚠️ `bb` IS NOT `bb.middle`, AND THAT IS DELIBERATE. The legacy `bb` alert
# reports the CLOSE and looks the band up as a dynamic threshold
# (`_bb_threshold_override`) — a price-vs-band relation, not a plot's value.
# `bb.upper`/`bb.middle`/`bb.lower` are the band VALUES, which is a different
# (and also useful) question. Collapsing them would silently change what every
# armed `bb` alert means.
#
# ⛔ `sar` IS PORTED BUT NOT OFFERED. See `_SAR_IS_NOT_OFFERED` below — the
# reason is written down there because a missing entry explains nothing.


def _plot_of(compute_name: str, index: Optional[int] = None,
             on_closes: bool = False, **defaults):
    """Build a value function for one plot of one indicator.

    Reads the DELIVERY wrapper (`compute_atr`, not `compute_atr_raw`) because
    that is the rounding both live consumers of this module have always compared
    user thresholds against — see `indicator_compute`'s module docstring. `index`
    selects a column from a multi-output compute; `None` means single-output.

    ⚠️ `on_closes` IS NOT DECORATION. `indicator_compute` has two input shapes and
    the difference is invisible at the call site: `compute_macd` and `compute_bb`
    take a list of CLOSES, everything else takes the bar dicts. Passing bars to a
    closes-taking function raises `TypeError`, which `_evaluate_one` catches and
    logs and turns into `(None, False)` — i.e. an alert that is offered and
    silently never fires, the exact defect this task closes, reintroduced by a
    one-word slip. `test_every_new_address_produces_a_number` is the gate, and it
    caught precisely this while the change was being written.

    ⚠️ AN OFF-BY-ONE IN `index` IS INVISIBLE TO ANY "the value changed" TEST — a
    swapped +DI/-DI still returns a plausible number. The gate is
    `test_every_plot_address_resolves_to_the_column_it_names`, which asserts
    ORDERING invariants a swap has to violate (upper >= middle >= lower, -DI == 0
    on a pure uptrend, tenkan > kijun > spanB on a rising series).
    """
    def fn(bars: list[dict], params: dict) -> Optional[float]:
        from api.services import indicator_compute
        kwargs = {k: type(v)(params.get(k, v)) for k, v in defaults.items()}
        series = [b["c"] for b in bars] if on_closes else bars
        out = getattr(indicator_compute, compute_name)(series, **kwargs)
        return _last_non_none(out if index is None else out[index])
    fn.__name__ = f"_value_{compute_name}_{index}"
    return fn

# Dispatch map: PLOT ADDRESS → value function. The threshold override hook is
# applied only for BB; for everything else the user-supplied threshold from
# the alert row is used verbatim.
# ⚠️ INSERTION ORDER IS THE DROPDOWN'S ORDER since B4 Task 9, and it is pinned.
# The first eight are ordered to match the order the retired
# `IndicatorAlertPopover.INDICATORS` literal shipped, so collapsing the twin
# changed what a user sees by NOTHING — and B5 APPENDS, so it still does not.
# `alert_catalog` groups by the part before the dot, in this order, which is why
# `macd.signal` joins the `macd` group where it already sits rather than opening
# a fifteenth one at the end.
INDICATOR_FUNCS: dict[str, Callable[[list[dict], dict], Optional[float]]] = {
    # ── the eight that existed before B5. DO NOT REORDER, DO NOT REBIND. ──
    "rsi": _value_rsi,
    "macd": _value_macd,
    "bb": _value_bb,
    "stoch": _value_stoch,
    "williams_r": _value_williams_r,
    "cci": _value_cci,
    "mfi": _value_mfi,
    "price_vs_ma": _value_price_vs_ma,
    # ── B5: the remaining plots of bases that were already alertable ──
    # ⚠️ `on_closes=True` on macd/bb — those two computes take CLOSES, not bars.
    "macd.signal": _plot_of("compute_macd", 1, on_closes=True, fast=12, slow=26, signal=9),
    "macd.histogram": _plot_of("compute_macd", 2, on_closes=True, fast=12, slow=26, signal=9),
    "bb.upper": _plot_of("compute_bb", 0, on_closes=True, period=20, stddev=2.0),
    "bb.middle": _plot_of("compute_bb", 1, on_closes=True, period=20, stddev=2.0),
    "bb.lower": _plot_of("compute_bb", 2, on_closes=True, period=20, stddev=2.0),
    "stoch.d": _plot_of("compute_stoch", 1, k_period=14, d_period=3),
    # ── B5: the six definitions that could not be alerted on at all ──
    "vwap": _plot_of("compute_vwap"),
    "atr": _plot_of("compute_atr", None, period=14),
    "adx.adx": _plot_of("compute_adx", 0, period=14),
    "adx.plusDI": _plot_of("compute_adx", 1, period=14),
    "adx.minusDI": _plot_of("compute_adx", 2, period=14),
    "obv": _plot_of("compute_obv"),
    "donchian.upper": _plot_of("compute_donchian", 0, period=20),
    "donchian.middle": _plot_of("compute_donchian", 1, period=20),
    "donchian.lower": _plot_of("compute_donchian", 2, period=20),
    "ichimoku.tenkan": _plot_of("compute_ichimoku", 0, tenkan_period=9, kijun_period=26, senkou_b_period=52),
    "ichimoku.kijun": _plot_of("compute_ichimoku", 1, tenkan_period=9, kijun_period=26, senkou_b_period=52),
    "ichimoku.spanA": _plot_of("compute_ichimoku", 2, tenkan_period=9, kijun_period=26, senkou_b_period=52),
    "ichimoku.spanB": _plot_of("compute_ichimoku", 3, tenkan_period=9, kijun_period=26, senkou_b_period=52),
    "ichimoku.chikou": _plot_of("compute_ichimoku", 4, tenkan_period=9, kijun_period=26, senkou_b_period=52),
}


# ⛔ WHY `sar` IS PORTED AND STILL NOT OFFERED.
#
# `compute_sar` exists and agrees with the chart at 1e-9 — the compute gap is
# closed for it like the rest. What it does NOT have is a meaningful threshold
# question, and offering one anyway would re-open the exact defect this task
# closes: an alert a user can arm that never tells them anything true.
#
# SAR's plot style is `markers`, and its value is a stop level that JUMPS to the
# OTHER SIDE of price at every trend flip. So "SAR crosses above 250" is a claim
# about where the stop happens to sit in absolute terms, which is not a trading
# event: the same number means "trailing below an uptrend" one bar and "trailing
# above a downtrend" the next.
#
# The two questions that ARE meaningful — "price crossed the SAR" and "the trend
# flipped" — are both RELATIONAL, and this module has exactly one relational
# primitive (`_bb_threshold_override`), which is bb-only. Building a second is a
# change to the EVALUATION lane, and that is spec §8's, in Phase C. This module
# already makes that call once, for the same reason, about comparing MACD to its
# signal LINE (see the `macd` note in `ALERT_CONDITIONS`); making it differently
# here would be inconsistent, not more helpful.
#
# So: no `sar` address. `test_sar_is_deliberately_not_offered_and_says_why`
# asserts the absence AND that this reasoning is still here, so the entry cannot
# be added without someone reading it.
_SAR_IS_NOT_OFFERED = (
    "sar is a markers plot whose value alternates above and below price at every "
    "trend flip, so a fixed threshold names no trading event. The meaningful SAR "
    "questions (price crossed SAR, the trend flipped) are relational, and a "
    "second relational primitive is a change to the evaluation lane — spec §8, "
    "Phase C."
)


# ─── THE CATALOG — ONE AUTHORITY FOR "WHAT CAN BE ALERTED ON" ────────────────
#
# `IndicatorAlertPopover.jsx` used to hand-write INDICATORS (8 entries) and
# CONDITIONS (a per-indicator map). They were a TWIN of the dict above, and they
# already disagreed with reality: the create path validates nothing at any of its
# three layers — the router types `indicator` as a bare `str`, the service
# inserts it verbatim, the DDL is `TEXT NOT NULL` with no CHECK — so a `vwap`
# alert can be STORED and can never FIRE (`_evaluate_one` returns `(None, False)`
# on an `INDICATOR_FUNCS` miss), and no surface reported it.
#
# Deriving the dropdown from `INDICATOR_FUNCS` makes that OFFER unrepresentable.
# It deliberately does NOT validate the create path: an existing stored row keeps
# behaving exactly as it did (accepted, silently never firing), and closing that
# hole belongs to the rebuild below, not to a dropdown change.
#
# ⭐ B5 CLOSED THE OTHER HALF, THE ONE THE DROPDOWN COULD NOT. B4 could only stop
# the offer; a `vwap` alert still could not fire, because there was no Python
# `compute_vwap` for it to fire from. `indicator_compute` now carries all seven
# missing natives, so `vwap` is an ADDRESS in the dict above and an alert naming
# it fires. The create path is STILL not validated — an address this dict has
# never heard of is still accepted and still silently never fires, and the
# popover still reports such a row as "cannot fire". That hole is Phase C's.
#
# ⛔ SPEC §8 STILL REBUILDS THIS EVALUATOR IN PHASE C (closed-bar evaluation,
# `prev` from the computed series, `last_value` demoted to delivery-dedup), and
# B5 DOES NOT TOUCH ANY OF THAT. What B5 changed is WHAT CAN BE COMPUTED; WHEN it
# is judged — the forming bar, with cycle-granularity crossings — is byte for
# byte what it was. `INDICATOR_FUNCS` stays HAND-WRITTEN and its retirement is
# still fated 'C' in the enumeration ledger.
#
# ⚠️ §9.5's "no eager 15-indicator port" was a B4 constraint about doing the work
# in the wrong phase, and the seven ports here are the DELIBERATE, measured
# version of it: each one is pinned to the shipped JS lane at rel-tol 1e-9 by a
# fixture BOTH lanes read, so the lane Phase C replaces cannot drift from the
# chart in the meantime.
#
# ⚠️ AND THE FIRES THESE PRODUCE ARE NOT LEDGER-GRADE. This evaluator reads the
# FORMING bar with cycle-granularity crossings; nothing here may feed the
# Signature receipts ledger until the closed-bar rebuild lands.

_OSCILLATOR_CONDITIONS: list[dict] = [
    {"value": "above",       "label": "Above threshold", "needs_threshold": True},
    {"value": "below",       "label": "Below threshold", "needs_threshold": True},
    {"value": "cross_above", "label": "Crosses above",   "needs_threshold": True},
    {"value": "cross_below", "label": "Crosses below",   "needs_threshold": True},
]

# ⚠️ GROUPED BY SHAPE — the five oscillators that share one condition list, then
# the three that do not — which is DELIBERATELY NOT `INDICATOR_FUNCS`' order.
# That is what makes "which dict does `alert_catalog` iterate?" observable: the
# two have identical KEY SETS by assertion, so iterating the wrong one is an
# equivalent mutant on every set-based check and only the ORDER can see it.
ALERT_CONDITIONS: dict[str, list[dict]] = {
    "rsi": _OSCILLATOR_CONDITIONS,
    "stoch": _OSCILLATOR_CONDITIONS,
    "williams_r": _OSCILLATOR_CONDITIONS,
    "cci": _OSCILLATOR_CONDITIONS,
    "mfi": _OSCILLATOR_CONDITIONS,
    # 🔴 TWO DELIBERATE CORRECTIONS TO THE RETIRED FRONTEND LITERAL, BOTH MEASURED.
    #
    # 1. `needs_threshold` is TRUE for both crosses. The B4 brief specified False.
    #    It cannot be: `_value_macd` returns the MACD LINE, `_bb_threshold_override`
    #    is the only dynamic threshold in this module and it is `bb`-only, and
    #    `check_condition("cross_above", …)` returns False whenever `threshold is
    #    None`. A False here would offer an alert that can never fire — the exact
    #    `vwap` class this task exists to close, re-opened inside the fix.
    # 2. The LABEL says "level", not "signal". The retired popover collected a
    #    threshold for these two (its `THRESHOLD_CONDITIONS` was keyed on the
    #    CONDITION, not on indicator+condition), so the shipped behaviour has
    #    always been "MACD crosses the number you typed" while the shipped label
    #    said "signal". The naming authority may not carry that lie. Comparing
    #    against the signal LINE would need a macd threshold override, which is a
    #    change to the evaluation lane — spec §8's, in Phase C.
    "macd": [
        {"value": "cross_above", "label": "Crosses above level", "needs_threshold": True},
        {"value": "cross_below", "label": "Crosses below level", "needs_threshold": True},
        {"value": "cross_zero",  "label": "Crosses zero line",   "needs_threshold": False},
    ],
    "bb": [
        {"value": "touch_upper", "label": "Price touches upper band", "needs_threshold": False},
        {"value": "touch_lower", "label": "Price touches lower band", "needs_threshold": False},
    ],
    "price_vs_ma": [
        {"value": "above", "label": "Price above MA", "needs_threshold": True},
        {"value": "below", "label": "Price below MA", "needs_threshold": True},
    ],
    # ── B5 ───────────────────────────────────────────────────────────────────
    # Every new address is a LEVEL — a price, a 0-100 reading, or a running
    # volume total — so it takes the same four threshold conditions the
    # oscillators do. The list is shared, not copied; `alert_catalog` hands out a
    # copy per entry so a consumer that mutated what it was handed cannot edit
    # every other entry through it.
    "macd.signal": _OSCILLATOR_CONDITIONS,
    "bb.upper": _OSCILLATOR_CONDITIONS,
    "bb.middle": _OSCILLATOR_CONDITIONS,
    "bb.lower": _OSCILLATOR_CONDITIONS,
    "stoch.d": _OSCILLATOR_CONDITIONS,
    "vwap": _OSCILLATOR_CONDITIONS,
    "atr": _OSCILLATOR_CONDITIONS,
    "adx.adx": _OSCILLATOR_CONDITIONS,
    "adx.plusDI": _OSCILLATOR_CONDITIONS,
    "adx.minusDI": _OSCILLATOR_CONDITIONS,
    "donchian.upper": _OSCILLATOR_CONDITIONS,
    "donchian.middle": _OSCILLATOR_CONDITIONS,
    "donchian.lower": _OSCILLATOR_CONDITIONS,
    "ichimoku.tenkan": _OSCILLATOR_CONDITIONS,
    "ichimoku.kijun": _OSCILLATOR_CONDITIONS,
    "ichimoku.spanA": _OSCILLATOR_CONDITIONS,
    "ichimoku.spanB": _OSCILLATOR_CONDITIONS,
    "ichimoku.chikou": _OSCILLATOR_CONDITIONS,
    # The two whose ZERO LINE is itself the event, so they get `cross_zero` on
    # top of the four. The MACD histogram crossing zero IS the signal-line cross
    # — the relation `macd` itself cannot express (see the note above) reached
    # from the other side, and reached with arithmetic this lane already has.
    # OBV crossing zero is meaningful only because of the pinned zero seed.
    "macd.histogram": _OSCILLATOR_CONDITIONS + [
        {"value": "cross_zero", "label": "Crosses zero line", "needs_threshold": False},
    ],
    "obv": _OSCILLATOR_CONDITIONS + [
        {"value": "cross_zero", "label": "Crosses zero line", "needs_threshold": False},
    ],
}

# ⚠️ NOT DERIVED FROM THE JS CATALOG, ON PURPOSE. These are ALERT-LANE ids — the
# names of the compute functions above — not chart definition ids. `williams_r`
# is `williamsR` there, and `price_vs_ma` has no definition at ALL: it is a
# spread (close − MA) this module synthesises. Mapping one onto the other would
# be a lookup that lies for two of the eight.
# ONE LABEL PER ADDRESS. It is what the plot dropdown shows AND what an alert
# ROW reads, so the two can never describe the same alert differently.
ALERT_LABELS: dict[str, str] = {
    "rsi": "RSI",
    "macd": "MACD",
    "bb": "Bollinger Bands",
    "stoch": "Stochastic",
    "williams_r": "Williams %R",
    "cci": "CCI",
    "mfi": "MFI",
    "price_vs_ma": "Price vs MA",
    # ── B5 ──
    "macd.signal": "MACD Signal",
    "macd.histogram": "MACD Histogram",
    "bb.upper": "Bollinger Upper Band",
    "bb.middle": "Bollinger Basis",
    "bb.lower": "Bollinger Lower Band",
    "stoch.d": "Stochastic %D",
    "vwap": "VWAP",
    "atr": "ATR",
    "adx.adx": "ADX",
    "adx.plusDI": "+DI",
    "adx.minusDI": "−DI",
    "obv": "OBV",
    "donchian.upper": "Donchian Upper",
    "donchian.middle": "Donchian Mid",
    "donchian.lower": "Donchian Lower",
    "ichimoku.tenkan": "Tenkan-sen",
    "ichimoku.kijun": "Kijun-sen",
    "ichimoku.spanA": "Senkou Span A",
    "ichimoku.spanB": "Senkou Span B",
    "ichimoku.chikou": "Chikou Span",
}

# The GROUP name in the indicator dropdown, for the three bases that are not
# themselves an address. Every other base IS an address and reuses its own label
# — deliberately a fallback rather than a full second table, so this stays three
# rows instead of becoming a parallel copy of `ALERT_LABELS`.
ALERT_BASE_LABELS: dict[str, str] = {
    "adx": "ADX / DMI",
    "donchian": "Donchian Channels",
    "ichimoku": "Ichimoku Cloud",
}

_DEFAULT_THRESHOLDS: dict[str, float] = {
    "rsi": 70.0,
    "mfi": 70.0,
    "williams_r": -20.0,
    "cci": 100.0,
    "stoch": 80.0,
    # ADX's own definition draws a guide at 25 — the conventional "is there a
    # trend at all" line — so that is the honest default. Nothing else here gets
    # one: a price-scale level (vwap, atr, the bands, the Ichimoku lines) has no
    # meaningful default without knowing the symbol, and inventing one would put
    # a number in the box that is wrong for every ticker.
    "adx.adx": 25.0,
}


def plot_base(address: str) -> str:
    """The base an address belongs to: everything before the first dot.

    ONE implementation of the grammar. `alert_catalog` groups with it and the
    tests read it, so "what counts as a base" cannot be answered two ways.
    """
    return address.split(".", 1)[0]


# ⛔ CASE-FOLDING IS WHY THIS MAP EXISTS, AND IT IS NOT COSMETIC.
#
# `_evaluate_one` has always done `(alert.get("indicator") or "").lower()`. All
# eight pre-B5 keys are lowercase, so that was a no-op and nobody could see it.
# Plot addresses are NOT: the engine spells its plots `plusDI`, `minusDI`,
# `spanA`, `spanB`, and `"adx.plusDI".lower()` is `"adx.plusdi"`, which is not a
# key. The lookup missed, `_evaluate_one` returned `(None, False)`, and four
# brand-new addresses were offered and could never fire — this task's own defect,
# reproduced inside the fix. `test_every_new_address_produces_a_number` caught it.
#
# The addresses keep the engine's spelling (an address should name a plot exactly
# as the definition does, or there are two vocabularies again) and resolution
# folds case instead. Storing an already-lowercased legacy key still lands on the
# identical function object, which the recorded baseline replay proves.
_CANONICAL_ADDRESS: dict[str, str] = {a.lower(): a for a in INDICATOR_FUNCS}


def resolve_address(raw: Optional[str]) -> str:
    """A stored `indicator` string → its canonical plot address.

    Case-insensitive, because the stored value is whatever the create path was
    handed and that path validates nothing. Returns the lowercased input
    unchanged when nothing matches, so an unknown address stays an
    `INDICATOR_FUNCS` miss — a silent no-op, exactly as before.
    """
    lowered = (raw or "").lower()
    return _CANONICAL_ADDRESS.get(lowered, lowered)


def alert_catalog() -> list[dict]:
    """What the alert dropdown may offer, grouped by indicator.

    Keyed off ``INDICATOR_FUNCS``, so an entry cannot exist for something that
    cannot be evaluated. Raises ``KeyError`` on a value function with no
    condition list — a new address has to fail HERE rather than render an empty
    condition dropdown and an un-submittable form.

    Each entry is one INDICATOR and carries its `plots`, because several plots
    per indicator is the whole point: "alert me on Ichimoku" names five different
    series and the user has to say which.

        {indicator, label, conditions, default_threshold, plots: [
            {value, label, conditions, default_threshold}, …
        ]}

    ⚠️ `plots[i]["value"]` IS THE ADDRESS TO STORE — never `indicator`, which for
    `adx`/`donchian`/`ichimoku` is a group name with no value function behind it.

    ⚠️ THE TOP-LEVEL `conditions` / `default_threshold` MIRROR `plots[0]` AND
    MUST KEEP DOING SO. That is what makes this shape backward-compatible: for
    all eight pre-B5 indicators `plots[0]` IS the legacy address, so a client
    that never looks at `plots` reads exactly the entry it read before.
    """
    groups: dict[str, list[str]] = {}
    for address in INDICATOR_FUNCS:
        groups.setdefault(plot_base(address), []).append(address)

    entries = []
    for base, addresses in groups.items():
        plots = [
            {
                "value": address,
                "label": ALERT_LABELS.get(address, address),
                # A COPY of the list: many addresses share
                # `_OSCILLATOR_CONDITIONS`, so a consumer that mutated what it
                # was handed would edit every one of them.
                "conditions": list(ALERT_CONDITIONS[address]),
                "default_threshold": _DEFAULT_THRESHOLDS.get(address),
            }
            for address in addresses
        ]
        entries.append({
            "indicator": base,
            "label": ALERT_BASE_LABELS.get(base) or ALERT_LABELS.get(base) or base,
            "conditions": list(plots[0]["conditions"]),
            "default_threshold": plots[0]["default_threshold"],
            "plots": plots,
        })
    return entries


# ─── bar fetch ───────────────────────────────────────────────────────────────

def _fetch_bars_for_alert(sym: str, tf: str, count: int = 200) -> list[dict]:
    """Return the latest ``count`` bars for (sym, tf) from the SQLite store.

    Bars come as dicts with keys ``h``, ``l``, ``c``, ``v`` so they plug
    directly into ``indicator_compute``. We read from the persistent store
    (not the HTTP endpoint) to avoid a round-trip and to keep the loop
    isolated from web-layer concerns.

    Empty list is returned (and silently absorbed by the caller) when the
    store has no rows for the (sym, tf) — typical for a fresh deploy or a
    ticker that nobody has yet requested.
    """
    try:
        from api.services import bars_sqlite as _sqlite
        rows = _sqlite.get_bars(sym.upper(), tf, int(count))
    except Exception:
        _logger.exception("[alert-eval] bars_sqlite.get_bars failed for %s/%s", sym, tf)
        return []
    bars: list[dict] = []
    for r in rows:
        # rows are (ts, o, h, l, c, v)
        try:
            bars.append({
                "t": r[0],
                "o": float(r[1]) if r[1] is not None else 0.0,
                "h": float(r[2]) if r[2] is not None else 0.0,
                "l": float(r[3]) if r[3] is not None else 0.0,
                "c": float(r[4]) if r[4] is not None else 0.0,
                "v": int(r[5]) if r[5] is not None else 0,
            })
        except Exception:
            continue
    return bars


# ─── per-alert evaluation ────────────────────────────────────────────────────

def _parse_params(alert: dict) -> dict:
    """Best-effort decode of the alert's ``params_json`` blob → dict.

    The CRUD service stores params as a JSON string; legacy / future rows
    may also pass it through as a real dict. Either way we return a dict
    that the indicator funcs can ``.get(...)`` on safely.
    """
    raw = alert.get("params_json")
    if not raw:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        import json
        return json.loads(raw)
    except Exception:
        return {}


def _evaluate_one(alert: dict, bars: Optional[list[dict]] = None) -> tuple[Optional[float], bool]:
    """Compute the indicator value for one alert and return (value, triggered).

    ``bars`` may be passed in pre-fetched (so a (sym, tf) group of alerts
    shares the same fetch); if None we fetch them ourselves. We need at
    least a handful of bars to compute most indicators — the indicator
    funcs themselves return None for short inputs, in which case we report
    (None, False) so the cycle records nothing and moves on.
    """
    # Case-folded to the canonical plot address. This used to be a bare
    # `.lower()`, which is a no-op on the eight lowercase legacy keys and DROPS
    # every camelCase plot address (`adx.plusDI`, `ichimoku.spanA`). See
    # `_CANONICAL_ADDRESS`.
    indicator = resolve_address(alert.get("indicator"))
    fn = INDICATOR_FUNCS.get(indicator)
    if fn is None:
        return None, False

    if bars is None:
        bars = _fetch_bars_for_alert(alert["sym"], alert["tf"], 200)
    if not bars:
        return None, False

    params = _parse_params(alert)
    try:
        value = fn(bars, params)
    except Exception:
        _logger.exception(
            "[alert-eval] compute failed for alert %s (%s/%s/%s)",
            alert.get("id"), alert.get("sym"), indicator, alert.get("tf"),
        )
        return None, False

    if value is None:
        return None, False

    condition = alert.get("condition") or ""
    threshold = alert.get("threshold")

    # BB touch conditions: the threshold is dynamic (current upper/lower band).
    if indicator == "bb":
        dyn = _bb_threshold_override(bars, params, condition)
        if dyn is not None:
            threshold = dyn

    prev_value = alert.get("last_value")
    triggered = check_condition(condition, value, prev_value, threshold)
    return value, triggered


# ─── cycle + delivery ────────────────────────────────────────────────────────

def _dispatch_delivery(alert: dict, value: float) -> None:
    """Send the alert through the multi-channel watchlist delivery hook.

    Uses ``watchlist_alert_service.deliver_alert_payload`` — exposed as a
    public function alongside the original watchlist-price delivery so
    indicator alerts reuse the identical AlertBell + email + Discord
    pipeline without re-implementing any of the channel-specific code.
    """
    try:
        from api.services import watchlist_alert_service as wls
        sym = alert.get("sym", "")
        indicator = (alert.get("indicator") or "").upper()
        condition = (alert.get("condition") or "").replace("_", " ")
        threshold = alert.get("threshold")
        thr_str = f"{threshold:.2f}" if isinstance(threshold, (int, float)) else "—"
        val_str = f"{value:.2f}" if isinstance(value, (int, float)) else str(value)
        title = f"{sym} {indicator} alert"
        message = (
            f"{sym} {indicator} {condition} {thr_str} (now: {val_str}) on {alert.get('tf', '')}"
        )
        wls.deliver_alert_payload(
            user_id=alert["user_id"],
            sym=sym,
            title=title,
            message=message,
            source="indicator_alert",
            extra_data={
                "indicator": alert.get("indicator"),
                "condition": alert.get("condition"),
                "threshold": threshold,
                "value": value,
                "tf": alert.get("tf"),
                "alert_id": alert.get("id"),
            },
        )
    except Exception:
        _logger.exception("[alert-eval] dispatch failed for alert %s", alert.get("id"))


def _run_one_cycle() -> dict[str, Any]:
    """One pass: evaluate every active alert, record + dispatch as needed.

    Returns a small summary dict (counts) useful for tests and ad-hoc
    debugging via the evaluator's REPL.
    """
    summary = {"considered": 0, "evaluated": 0, "triggered": 0, "errors": 0}
    try:
        from api.services import indicator_alert_service as ias
        alerts = ias.list_active()
    except Exception:
        _logger.exception("[alert-eval] failed to list active alerts")
        summary["errors"] += 1
        return summary

    summary["considered"] = len(alerts)
    if not alerts:
        return summary

    # Group by (sym, tf) so we fetch bars once per group, then evaluate each
    # alert in the group against the same series.
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for a in alerts:
        groups[(a["sym"], a["tf"])].append(a)

    from api.services import indicator_alert_service as ias

    for (sym, tf), alerts_in_group in groups.items():
        try:
            bars = _fetch_bars_for_alert(sym, tf, 200)
        except Exception:
            _logger.exception("[alert-eval] fetch failed for %s/%s", sym, tf)
            summary["errors"] += 1
            continue

        for alert in alerts_in_group:
            try:
                value, triggered = _evaluate_one(alert, bars=bars)
                if value is None:
                    continue
                summary["evaluated"] += 1
                if triggered:
                    summary["triggered"] += 1
                    ias.record_trigger(alert["id"], last_value=value)
                    _dispatch_delivery(alert, value)
                else:
                    ias.record_evaluation(alert["id"], last_value=value)
            except Exception:
                _logger.exception(
                    "[alert-eval] eval failed for alert %s", alert.get("id"),
                )
                summary["errors"] += 1
    return summary


# ─── background thread ───────────────────────────────────────────────────────

def start_evaluator(interval_sec: int = 60) -> None:
    """Start the background evaluator thread.

    Idempotent: a second call while the thread is already running is a
    no-op. The thread polls ``_running`` every second so ``stop_evaluator``
    returns quickly even if the configured interval is long.
    """
    global _thread
    if _running.is_set():
        return
    _running.set()

    def _loop() -> None:
        while _running.is_set():
            try:
                _run_one_cycle()
            except Exception:
                _logger.exception("[alert-eval] cycle failed")
            # Sleep in 1-second slices so stop_evaluator wakes us promptly.
            for _ in range(max(1, int(interval_sec))):
                if not _running.is_set():
                    return
                time.sleep(1)

    _thread = threading.Thread(target=_loop, daemon=True, name="indicator-alert-eval")
    _thread.start()


def stop_evaluator() -> None:
    """Signal the background thread to exit at its next 1-second check."""
    _running.clear()


def is_running() -> bool:
    """Test helper: ``True`` if the evaluator thread is currently active."""
    return _running.is_set()
