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

# ⭐ THE CONDITION FUNCTION AND THE OPERAND GRAMMAR NOW LIVE IN ONE MODULE, AND
# THEY ARE RE-EXPORTED HERE ON PURPOSE. `check_condition` was MOVED VERBATIM —
# two committed oracles (the 5,040-row `indicator_alert_baseline.json` and the
# 691,195-fire `fire_log_forming.json`) are pointed at this NAME, and every
# consumer — `tools/alert_replay.py`, `tests/test_alert_replay.py`, this module's
# own tests — reaches it as `indicator_alert_evaluator.check_condition`. A move
# that also renamed the door would have been a rename wearing a refactor's hat.
from api.services.alert_conditions import (  # noqa: F401  (re-exported)
    OPERAND_KINDS,
    check_condition,
    resolve_operand,
)

_logger = logging.getLogger(__name__)
_running = threading.Event()
_thread: Optional[threading.Thread] = None


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
# reports the CLOSE and looks the band up as a dynamic threshold (a bb-only
# override until Phase C, one row of `THRESHOLD_OPERAND` since) — a price-vs-band
# relation, not a plot's value. `bb.upper`/`bb.middle`/`bb.lower` are the band
# VALUES, which is a different (and also useful) question. Collapsing them would
# silently change what every armed `bb` alert means.
#
# ⛔ `sar` HAS NO FIXED-THRESHOLD ADDRESS, AND HAS TWO EVENT ADDRESSES. See
# `_SAR_IS_NOT_A_THRESHOLD` below — the reason is written down there because a
# missing entry explains nothing.


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

# Dispatch map: PLOT ADDRESS → value function, for every address that names a
# LEVEL. A condition's right-hand side comes from `THRESHOLD_OPERAND` when one is
# declared for (address, condition); for everything else the user-supplied
# threshold from the alert row is used verbatim.
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


# ─── PHASE C TASK 3: EVENT ADDRESSES — A COLUMN THAT IS NOT A LEVEL ──────────
#
# ⭐ A SECOND TABLE, NOT SEVENTEEN MORE ROWS IN THE FIRST, AND THE SPLIT IS THE
# POINT. Every key in `INDICATOR_FUNCS` answers "what number is this plot at?" —
# a LEVEL, which a user compares against a threshold they choose. An EVENT column
# answers "did this happen on this bar?" and is valued {0, 1, None}: comparing it
# to a level the user typed would be meaningless in both directions.
#
# Keeping them apart is what lets the refusal below stay a REFUSAL rather than
# becoming a filter over one merged dict — `THRESHOLD_ADDRESSES` and
# `EVENT_ADDRESSES` are two tables with different questions behind them, and
# `sar` is in exactly one of them.
#
# ⚠️ CONSUMED BY KEY, NEVER BY REACHING INTO THE ENGINE REGISTRY. The event
# columns come from `indicator_compute.compute_sar_events`, whose contract is
# `(bars, step, max_step) -> (price_crossed_sar, trend_flipped)`, each aligned to
# input length and valued 0.0 / 1.0 / None. That function is DERIVED from
# `compute_sar_raw`'s already-pinned ±1 trend column, so nothing is reseeded and
# there is no second SAR loop anywhere.
EVENT_FUNCS: dict[str, Callable[[list[dict], dict], Optional[float]]] = {
    "sar.priceCrossedSar": _plot_of("compute_sar_events", 0, step=0.02, max_step=0.2),
    "sar.trendFlipped": _plot_of("compute_sar_events", 1, step=0.02, max_step=0.2),
}

# The two vocabularies, named. Read by `alert_catalog`, by `_evaluate_one`, and
# by `test_sar_has_no_fixed_threshold_address_and_says_why` — which asserts
# membership of one and absence from the other, so neither can be answered twice.
THRESHOLD_ADDRESSES: tuple[str, ...] = tuple(INDICATOR_FUNCS)
EVENT_ADDRESSES: tuple[str, ...] = tuple(EVENT_FUNCS)


def value_function(address: str) -> Optional[Callable[[list[dict], dict], Optional[float]]]:
    """The value function for a canonical address, level or event.

    ⚠️ LOOKED UP LIVE, NEVER SNAPSHOTTED INTO A MERGED DICT. `INDICATOR_FUNCS`
    is re-pointed at runtime by two different controls — the replay's own
    `test_the_replay_fails_when_an_address_is_repointed` and Task 2's fire-log
    control both rebind a live entry — and a module-level `{**A, **B}` would
    keep serving the pre-mutation callable, which is a control that cannot fail.
    """
    fn = INDICATOR_FUNCS.get(address)
    return fn if fn is not None else EVENT_FUNCS.get(address)


def address_value(address: str, bars: list[dict], params: dict) -> Optional[float]:
    """One plot address → its number on the last bar of ``bars``.

    The resolver handed to `alert_conditions.resolve_operand` for an `address`
    operand, so the RIGHT side of a relation is computed by the exact same
    function that computes a LEFT side. That is what makes "compare a line to
    another line" impossible to get subtly wrong: there is no second code path
    for the right-hand operand to round differently in.
    """
    fn = value_function(resolve_address(address))
    if fn is None or not bars:
        return None
    return fn(bars, params)


# ⭐ THE OPERAND TABLE — WHERE `_bb_threshold_override` WENT.
#
# A condition's right-hand side used to be a number the user typed, with exactly
# ONE exception: a bb-only function that recomputed the band and substituted it
# for the threshold. That exception is now a DECLARATION. The behaviour is
# unchanged bit for bit — `bb.upper` is the same `compute_bb` delivery wrapper,
# read at the same index, through the same `_last_non_none` — and the proof is
# that `tools/alert_replay.py --check` reproduces all 691,195 frozen fires and
# `indicator_alert_baseline.json`'s 5,040 recorded pairs replay unmoved.
#
# ⛔ AND `bb` STILL IS NOT `bb.middle`. The legacy `bb` alert reports the CLOSE
# and looks the BAND up as the threshold — a price-vs-band RELATION, not a plot's
# value. Collapsing it into the band's own value would silently change what every
# armed `bb` alert means, and the 5,040 recorded rows say so.
#
# ⛔ AN EVENT'S 0.5 IS NOT A THRESHOLD, IT IS A DECODER. The column is valued
# {0, 1, None}; 0.5 is the only number that separates them and it is DECLARED
# here rather than typed by a user, which is precisely why the event addresses
# are offered while a fixed threshold on SAR's own value still is not. It also
# means `check_condition` needed no new branch and stayed verbatim.
THRESHOLD_OPERAND: dict[tuple[str, str], dict] = {
    ("bb", "touch_upper"): {"kind": "address", "address": "bb.upper"},
    ("bb", "touch_lower"): {"kind": "address", "address": "bb.lower"},
    ("sar.priceCrossedSar", "above"): {"kind": "const", "value": 0.5},
    ("sar.trendFlipped", "above"): {"kind": "const", "value": 0.5},
}


def threshold_operand_value(address: str, condition: str, bars: list[dict],
                            params: dict) -> Optional[float]:
    """The DECLARED right-hand side for (address, condition), as a number.

    ``None`` when nothing is declared — which is the common case and means "use
    the threshold the user typed". A declared operand that cannot be computed
    yet also returns ``None`` and the user's threshold stands, exactly as the
    bb-only override behaved.
    """
    spec = THRESHOLD_OPERAND.get((address, condition))
    if spec is None:
        return None
    return resolve_operand(spec, bars, params, address_value)


def _bb_threshold_override(bars: list[dict], params: dict,
                           condition: str) -> Optional[float]:
    """⚰️ TOMBSTONE. The module's ONE relational primitive, retired into the
    grammar — this is now a two-line delegation with no band arithmetic in it.

    ⚠️ THE NAME SURVIVES BECAUSE TWO FILES OUTSIDE THIS LANE BIND IT DIRECTLY:
    `tools/alert_replay.py::make_forming_evaluate` and
    `tests/test_alert_replay.py::_closed_bar_evaluate`. Both are the frozen fire
    log's own instrument, both were written in Task 2, and re-pointing them at
    `threshold_operand_value` belongs to the task that rebuilds the harness for
    the closed lane — not to the task whose gate is that the instrument's reading
    did not move. Deleting the symbol here would have broken the measurement
    being used to prove the change was safe.

    It is not a shim that hides a fork: `test_the_harness_agrees_with_the_evaluators_own_evaluate_one`
    drives BOTH this function's callers and `_evaluate_one` over every address ×
    condition × threshold × prev on the wick fixture and demands exact equality,
    so a divergence between the two lanes is red before any replay number moves.
    """
    return threshold_operand_value("bb", condition, bars, params)


# ⛔ WHY `sar` IS ALERTABLE BY EVENT AND STILL HAS NO FIXED-THRESHOLD ADDRESS.
#
# `compute_sar` exists and agrees with the chart at 1e-9 — the compute gap was
# closed for it in B5 like the rest. What it does NOT have is a meaningful
# threshold question, and offering one anyway would re-open the exact defect this
# programme closes: an alert a user can arm that never tells them anything true.
#
# SAR's plot style is `markers`, and its value is a stop level that JUMPS to the
# OTHER SIDE of price at every trend flip. So "SAR crosses above 250" is a claim
# about where the stop happens to sit in absolute terms, which is not a trading
# event: the same number means "trailing below an uptrend" one bar and "trailing
# above a downtrend" the next. THAT ARGUMENT HAS NOT CHANGED ONE WORD.
#
# What HAS changed is the premise underneath the old deferral. The two questions
# that ARE meaningful — "price crossed the SAR" and "the trend flipped" — are
# both RELATIONAL, and until Phase C this module had exactly one relational
# primitive (`_bb_threshold_override`), which was bb-only; building a second was
# a change to the EVALUATION lane and that was spec §8's, in Phase C. THIS IS
# PHASE C, the grammar above IS that primitive, and it is built once — so the
# same sentence that refused SAR then is what offers it now, as `EVENT_FUNCS`.
# The MACD-vs-signal-LINE refusal in `ALERT_CONDITIONS` was deferred with the
# identical sentence and is likewise expressible now, as
# `{"kind": "address", "address": "macd.signal"}`.
#
# So: two `sar` EVENT addresses, and still no `sar` in `THRESHOLD_ADDRESSES`.
# `test_sar_has_no_fixed_threshold_address_and_says_why` asserts the narrower
# absence AND that this reasoning is still here — with the two event addresses as
# its positive control, so it cannot pass on a tree where SAR simply went back to
# being un-alertable.
_SAR_IS_NOT_A_THRESHOLD = (
    "sar is a markers plot whose value jumps to the other side of price at every "
    "trend flip, so a fixed threshold names no trading event. The meaningful SAR "
    "questions (price crossed SAR, the trend flipped) are relational, and Phase C "
    "builds that relational primitive once — spec §8 — so they are offered as "
    "EVENT addresses while a fixed-threshold address is still refused."
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
    #    It cannot be: `_value_macd` returns the MACD LINE, and (AS OF B4/B5, past
    #    tense now) the module's only dynamic threshold was a bb-only override, and
    #    `check_condition("cross_above", …)` returns False whenever `threshold is
    #    None`. A False here would offer an alert that can never fire — the exact
    #    `vwap` class this task exists to close, re-opened inside the fix.
    # 2. The LABEL says "level", not "signal". The retired popover collected a
    #    threshold for these two (its `THRESHOLD_CONDITIONS` was keyed on the
    #    CONDITION, not on indicator+condition), so the shipped behaviour has
    #    always been "MACD crosses the number you typed" while the shipped label
    #    said "signal". The naming authority may not carry that lie.
    #    ⭐ PHASE C UPDATE, AND THE CLAUSE THAT STOPPED BEING TRUE: "comparing
    #    against the signal LINE would need a macd threshold override, which is a
    #    change to the evaluation lane — spec §8's, in Phase C." That change is
    #    BUILT (see `THRESHOLD_OPERAND`), so the relation is now EXPRESSIBLE as
    #    `{"kind": "address", "address": "macd.signal"}` and costs one row. It is
    #    deliberately not OFFERED in this commit: adding a row here changes what
    #    the dropdown means for an indicator eight legacy alerts are armed on, and
    #    that is a product decision with its own gate, not a side effect of
    #    building the grammar. The refusal above is now a CHOICE, not a limit.
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
    # ── PHASE C: the two EVENT addresses ─────────────────────────────────────
    # ONE condition each, and it is `above` rather than a new condition string —
    # the event column is {0, 1, None} and `THRESHOLD_OPERAND` declares the 0.5
    # that separates them, so this rides the grammar instead of adding a branch
    # to `check_condition` (whose two committed oracles are pointed at it
    # verbatim). `needs_threshold` is False because the operand is DECLARED, and
    # that is now the general rule rather than a bb-shaped exception:
    # a condition asks the user for a number exactly when nothing is declared
    # for it — see `test_needs_threshold_is_declared_per_condition_not_guessed`.
    "sar.priceCrossedSar": [
        {"value": "above", "label": "Price crossed SAR this bar", "needs_threshold": False},
    ],
    "sar.trendFlipped": [
        {"value": "above", "label": "SAR trend flipped this bar", "needs_threshold": False},
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
    # ── PHASE C: the two EVENT addresses ──
    "sar.priceCrossedSar": "Price / SAR cross",
    "sar.trendFlipped": "SAR trend flip",
}

# The GROUP name in the indicator dropdown, for the three bases that are not
# themselves an address. Every other base IS an address and reuses its own label
# — deliberately a fallback rather than a full second table, so this stays three
# rows instead of becoming a parallel copy of `ALERT_LABELS`.
ALERT_BASE_LABELS: dict[str, str] = {
    "adx": "ADX / DMI",
    "donchian": "Donchian Channels",
    "ichimoku": "Ichimoku Cloud",
    # `sar` is a group name and NOT an address — deliberately, and it is the
    # whole refusal: the base names no level you could threshold, only the two
    # events under it.
    "sar": "Parabolic SAR",
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
#
# ⚠️ IT COVERS THE EVENT ADDRESSES TOO, AND THEY ARE THE camelCase CASE AGAIN:
# `"sar.priceCrossedSar".lower()` is not a key either. Folding both tables here
# is what keeps ONE resolution rule for ONE address grammar.
_CANONICAL_ADDRESS: dict[str, str] = {
    a.lower(): a for a in list(INDICATOR_FUNCS) + list(EVENT_FUNCS)
}


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
    # ⚠️ LEVELS FIRST, THEN EVENTS — so the pre-B5 eight are still the first
    # eight groups, the B5 six still follow in their order, and Phase C APPENDS
    # `sar` at the end. An existing user's dropdown opens on the same option it
    # always did and every option they already knew is where it was.
    groups: dict[str, list[str]] = {}
    for address in list(INDICATOR_FUNCS) + list(EVENT_FUNCS):
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
    fn = value_function(indicator)
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

    # ⭐ THE DYNAMIC THRESHOLD IS NOW A DECLARED OPERAND, NOT A BRANCH.
    #
    # This used to read `if indicator == "bb": dyn = _bb_threshold_override(…)`,
    # which is why a relation could only ever be asked about one indicator. The
    # table is consulted by (address, condition), so a new relation is a new ROW
    # in `THRESHOLD_OPERAND` and no new code here — and an address with nothing
    # declared keeps the threshold the user typed, byte for byte as before.
    #
    # ⛔ DELIBERATELY OUTSIDE THE try/except ABOVE. That block absorbs a compute
    # failure into a silent no-fire, which is the right answer for a short bar
    # window and the WRONG answer for a malformed declaration: `resolve_operand`
    # RAISES on an operand kind nobody implements, and swallowing that would turn
    # a bug in a declaration into an alert that is offered and never fires — the
    # `vwap` defect, reached from a new direction. It propagates to the cycle's
    # per-alert handler, which logs it and counts an error.
    dyn = threshold_operand_value(indicator, condition, bars, params)
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
