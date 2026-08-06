"""Indicator alert evaluation loop.

Every 60s (configurable):
  1. List all active alerts (``indicator_alert_service.list_active``)
  2. Group by (sym, tf) to share bar fetches
  3. For each alert: compute the indicator value via ``indicator_compute``,
     evaluate condition vs last known value
  4. On trigger: record + dispatch delivery via the existing
     ``watchlist_alert_service.deliver_alert_payload`` hook (bell + email +
     Discord). On non-trigger but successful evaluation, persist the last
     value so the next cycle has a ``prev`` for cross-* conditions — which is
     true of the FORMING lane, the one that is live. See the two-lane note at
     the bottom of this docstring: the closed lane takes ``prev`` from the
     series and does not read that column at all.

The evaluator runs in a single daemon thread. Each cycle is error-isolated
per alert so a single bad ticker does not block the rest. Bars are read
directly from the persistent SQLite store (``bars_sqlite.get_bars``); the
universe pre-warmer + background fetchers keep that store fresh, so we
never block on a remote API from this loop.

⭐ THERE ARE NOW TWO LANES, AND ONLY ONE OF THEM IS LIVE.

``ALERT_EVAL_MODE`` selects between them and it is ``"forming"``. Step 3 above
describes the forming lane exactly: it judges the bar that is still being built,
and ``prev`` is whatever the PREVIOUS 60-SECOND POLL happened to store in
``last_value`` — so "RSI crossed above 70" can fire on a wick that unwinds before
the bar closes, and whether it fires at all depends on when the loop happened to
look. Task 2 measured that as 636,205 keyed / 17,295 identity disagreements
across intra-bar granularities on frozen real bars.

The CLOSED lane (``_evaluate_one_closed``) judges the newest bar that has
actually closed, and takes ``prev`` from ``series[i-1]`` — the bar before it —
so a crossing is a comparison of two BARS rather than two CYCLES. Through the
same oracle, the same bars and the same grid it reads 0 / 0 at every k.

⛔ NOTHING SWITCHES THE LANE IN THIS COMMIT. ``ALERT_EVAL_MODE`` is ``"forming"``,
which is byte for byte what an armed alert did yesterday. The cutover is one
constant in its own commit, after the shadow-mode soak — spec §8. Until then the
closed lane is reachable only by asking for it explicitly (``mode="closed"``),
which is what the tests do.

⭐ AND THERE IS NOW A DOOR TO THE SIGNATURE RECEIPTS LEDGER, WITH A LOCK ON IT.
``admit_alert_fire`` is the only way a fire from this module reaches
``signature.ledger``, and it REFUSES — by raising, never by returning False —
unless the lane is ``closed`` and the bar it names has actually closed. This
paragraph used to assert the absence of such a write; an absence stops being a
control the moment it stops being true, so it names the gate instead, and
``tests/test_alert_ledger_admission.py`` goes red if the gate is removed.
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

# ⭐ IMPORTED AT MODULE LEVEL, NOT LAZILY, BECAUSE THE DISPATCH TABLE IS BUILT
# FROM IT AT IMPORT. `alert_series` imports nothing from this module (its own
# `indicator_compute` import is inside the closures), so there is no cycle —
# and a lazy import here would mean `INDICATOR_FUNCS` could not exist until
# somebody called something.
from api.services import alert_series

_logger = logging.getLogger(__name__)

#: One address → its number on the newest bar that has one.
ValueFn = Callable[[list[dict], dict], Optional[float]]
#: A partition of the address space. ⚠️ Deliberately NOT spelled inline as
#: `dict[str, Callable[...]]` at the assignments below: the enumeration ledger's
#: anchor for the LITERAL that retired here is that annotated form of
#: `INDICATOR_FUNCS`, and `enumerationSites.test.js` re-runs that anchor
#: demanding ZERO matches. An annotation that happened to re-spell it would
#: report the retirement as undone.
AddressFuncs = dict[str, ValueFn]
_running = threading.Event()
_thread: Optional[threading.Thread] = None


# ─── THE MODE, AND THE ONE FUNCTION THAT READS IT ────────────────────────────
#
# ⛔ THE MODE IS READ THROUGH ONE FUNCTION AND A SOURCE SCAN ENFORCES IT.
# `eval_mode()` is the only reader of `ALERT_EVAL_MODE`; a consumer comparing the
# constant directly is a reader the seam cannot reach, which is a branch no test
# can drive. B5 Task 10 shipped exactly this rule for `PANE_MODE` and it is why
# `flipCGeometry` could exercise a path production never took.
#
# ⚠️ B5 Task 10 ALSO MEASURED THE TRAP ON THE OTHER SIDE: the JS minifier folded
# `paneMode()` so hard that the panes branch was ABSENT from the shipped bundle —
# "landed dark" was not "the branch is not taken", it was "the branch is not
# present". Python is not minified, so the branch is genuinely here; it is
# asserted by IMPORTING this module and CALLING the closed lane directly
# (`tests/test_alert_closed_bar.py`), which is the evidence the JS side could not
# produce.
ALERT_EVAL_MODE = "forming"        # "forming" | "closed"

EVAL_MODES: tuple[str, ...] = ("forming", "closed")


def eval_mode() -> str:
    """Which lane an unqualified `_evaluate_one` runs. THE ONLY READER."""
    return ALERT_EVAL_MODE


# ─── indicator dispatch ──────────────────────────────────────────────────────

def _last_non_none(seq: list) -> Optional[float]:
    """Return the last non-None value from a list, or None if all None / empty."""
    for v in reversed(seq):
        if v is not None:
            return float(v)
    return None


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
# spelling and their exact position.
#
# ⚠️ WHAT PHASE C TASK 10 CHANGED IN THAT SENTENCE, AND IT MATTERED ENOUGH TO
# EDIT: this used to end "…and the exact same callable object". It is no longer
# the same OBJECT — the dict below is derived, so every entry is a fresh closure
# over `alert_series.SERIES_FUNCS`. It is the same NUMBER, which is the claim
# that was ever worth making, and it is the claim the evidence supports:
# `tests/fixtures/indicator_alert_baseline.json` replays 5,040 recorded
# evaluations and `tools/alert_replay.py --check` replays 691,195 recorded
# fires, both recorded against the retired closures. Identity was the proxy;
# those two are the measurement.
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


# ⭐⭐ PHASE C TASK 10 — THE HAND-WRITTEN DISPATCH DICT IS GONE.
#
# `INDICATOR_FUNCS` was 28 rows of `_plot_of("compute_adx", 1, period=14)`, and
# `alert_series.SERIES_FUNCS` was 28 rows of `_column("compute_adx", 1,
# period=14)` — the same compute, the same column index, the same `on_closes`
# input shape, the same defaults, differing only in a `_last_non_none` at the
# end. Task 5 added that twin DELIBERATELY (the 5,040-row recorded baseline pins
# those closures and a rebuild had to be provably identical first) and recorded
# the debt on the enumeration ledger. This is the payment.
#
# ⛔ THE DIRECTION WAS NEVER A CHOICE. A column determines its last value; a last
# value determines nothing about the column. So the closed-bar table is the one
# that survives and the value lane composes `_last_non_none` onto it.
#
# ⛔ THE NAME SURVIVES, THE LITERAL DOES NOT — AND THAT DISTINCTION IS THE WHOLE
# RETIREMENT. `tools/alert_replay.py` generates the frozen 691,195-fire grid by
# iterating `ev.INDICATOR_FUNCS`, `api/services/alert_shadow_log.py` bounds a
# diff declaration with it, and `tools/alert_soak_matrix.py` arms from the
# catalog behind it. All three read a MAPPING, none of them reads a literal, and
# the mapping they read is now computed. What is gone is the second place a
# person had to edit — which is what an enumeration site IS.
#
# ⚠️ LOOKED UP AT CALL TIME, NOT AT BUILD TIME. Two committed controls re-point a
# live entry at runtime (`test_the_replay_fails_when_an_address_is_repointed`,
# and Task 2's fire-log control rebinds `rsi` at `alert_series`), so the closure
# resolves `SERIES_FUNCS[address]` on every call. Capturing the column function
# once at import would keep serving the pre-mutation callable — a control that
# cannot fail.


def _value_of(address: str) -> ValueFn:
    """One address -> "what number is this plot at, on the newest bar with one".

    The exact composition the retired `_plot_of` performed inline. It returns
    `None` for an address the column table has never heard of rather than
    raising, because that is what `INDICATOR_FUNCS.get()` did and a stored typo
    has always been a silent no-fire (the create path validates the two cases
    that matter now; a legacy row predates that).
    """
    def fn(bars: list[dict], params: dict) -> Optional[float]:
        column = alert_series.SERIES_FUNCS.get(address)
        if column is None:
            return None
        return _last_non_none(column(bars, params))
    fn.__name__ = f"_value_{address}"
    return fn


# ─── THE THREE PARTITIONS OF THE ADDRESS SPACE ───────────────────────────────
#
# Not three tables of functions — three answers to "what QUESTION does this
# address answer", written down as closed sets of names. Everything not named
# here is a LEVEL, which is the overwhelming majority and the reason the
# classification is expressed as two short exclusion lists rather than as a
# 31-row `ADDRESS_KIND` map (which would have been the retired enumeration
# wearing a different hat).
#
# ⚠️ AN EVENT IS NOT A LEVEL: its column is {0, 1, None} and comparing it to a
# number a user typed is meaningless in both directions. Task 3's split.
#
# ⚠️ A PRICE IS A LEVEL BUT IT IS NOT AN INDICATOR, and it is separated for a
# measured reason, not a taxonomic one — see `_series_close`: the frozen replay
# grid is generated from `INDICATOR_FUNCS` in order, so a 29th entry there moves
# 691,195 recorded fires.
EVENT_ADDRESSES: tuple[str, ...] = ("sar.priceCrossedSar", "sar.trendFlipped")
PRICE_ADDRESSES: tuple[str, ...] = ("close",)

_ALL_VALUE_FUNCS: AddressFuncs = {
    address: _value_of(address) for address in alert_series.SERIES_FUNCS
}

# ⚠️ INSERTION ORDER IS THE DROPDOWN'S ORDER since B4 Task 9, and it is pinned by
# `test_catalog_order_is_the_dropdown_order_and_it_did_not_change`. The order
# authority moved WITH the table: it is `SERIES_FUNCS`' insertion order now,
# which lists the 28 levels first in exactly the order the retired dict did.
# `alert_catalog` groups by the part before the dot, in this order, which is why
# `macd.signal` joins the `macd` group where it already sits.
INDICATOR_FUNCS: AddressFuncs = {
    address: fn for address, fn in _ALL_VALUE_FUNCS.items()
    if address not in EVENT_ADDRESSES and address not in PRICE_ADDRESSES
}

# ─── PHASE C TASK 3: EVENT ADDRESSES — A COLUMN THAT IS NOT A LEVEL ──────────
#
# ⚠️ CONSUMED BY KEY, NEVER BY REACHING INTO THE ENGINE REGISTRY. The event
# columns come from `indicator_compute.compute_sar_events`, whose contract is
# `(bars, step, max_step) -> (price_crossed_sar, trend_flipped)`, each aligned to
# input length and valued 0.0 / 1.0 / None. That function is DERIVED from
# `compute_sar_raw`'s already-pinned ±1 trend column, so nothing is reseeded and
# there is no second SAR loop anywhere.
EVENT_FUNCS: AddressFuncs = {a: _ALL_VALUE_FUNCS[a] for a in EVENT_ADDRESSES}

# ─── PHASE C TASK 10: THE PRICE ADDRESS — A LEFT OPERAND AT LAST ─────────────
#
# ⭐ WHAT THIS UNBLOCKS. `alert_conditions.OPERAND_KINDS` has carried `"close"`
# since Task 3, but only as a RIGHT-hand operand: you could ask "VWAP crossed
# below price" and not "price crossed above VWAP", which is the same event and
# the wrong sentence. `close` is now an address, so it is a LEFT operand, and
# the relation reads the way a trader says it.
#
# ⛔ IT IS STILL NOT THE PRICE-ALERT PRODUCT. `watchlist_alerts` delivers a bare
# price level off the 15-second live-price poll; this is a closed-bar reading on
# the alert's own timeframe, with fire-once and a fired log. Task 11's router
# refusal is NARROWED, not deleted — see `_PRICE_ALIASES` there.
PRICE_FUNCS: AddressFuncs = {a: _ALL_VALUE_FUNCS[a] for a in PRICE_ADDRESSES}

# The vocabularies, named. Read by `alert_catalog`, by `_evaluate_one`, and by
# `test_sar_has_no_fixed_threshold_address_and_says_why` — which asserts
# membership of one and absence from the other, so neither can be answered twice.
THRESHOLD_ADDRESSES: tuple[str, ...] = tuple(INDICATOR_FUNCS)

# ⛔ THE ONE LIST EVERY "walk all the addresses" SITE READS, IN CATALOG ORDER.
# Task 6 found a live fork caused by hand-listing partitions at a call site: the
# replay adapter consulted `INDICATOR_FUNCS` alone, so the two `sar` EVENT
# addresses read `(None, False)` in the harness while the shipped lane fired one
# 39 times on spy_daily — *and it survived because the anti-fork rail iterated
# the same dict the bug was in*. A third partition is exactly when that happens
# again, so there is now one list and the rails iterate IT.
ADDRESS_PARTITIONS: tuple[AddressFuncs, ...] = (
    INDICATOR_FUNCS, EVENT_FUNCS, PRICE_FUNCS,
)


def all_addresses() -> list[str]:
    """Every alertable address, in catalog order. THE one enumeration."""
    return [a for partition in ADDRESS_PARTITIONS for a in partition]


def value_function(address: str) -> Optional[ValueFn]:
    """The value function for a canonical address: level, event or price.

    ⚠️ LOOKED UP LIVE, NEVER SNAPSHOTTED INTO A MERGED DICT. `INDICATOR_FUNCS`
    is re-pointed at runtime by two different controls — the replay's own
    `test_the_replay_fails_when_an_address_is_repointed` and Task 2's fire-log
    control both rebind a live entry — and a module-level `{**A, **B}` would
    keep serving the pre-mutation callable, which is a control that cannot fail.

    ⚠️ THREE PARTITIONS ARE CONSULTED, AND `_TOTALITY` IS WHY THAT LIST CANNOT
    ROT. `test_value_function_consults_every_partition` derives the partitions
    from the module and fails if one of them is unreachable from here — Task 6
    measured this exact defect for real (`make_forming_evaluate` consulted only
    `INDICATOR_FUNCS`, so both `sar` event addresses silently read `None` in the
    harness while the live lane fired one 39 times).
    """
    for partition in ADDRESS_PARTITIONS:
        fn = partition.get(address)
        if fn is not None:
            return fn
    return None


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


# ⚰️ `_bb_threshold_override` IS GONE, AND TASK 5 IS WHERE ITS NAME COULD FINALLY
# GO. Task 3 moved the band arithmetic into `THRESHOLD_OPERAND` but kept the
# symbol as a two-line delegation, because two files outside this lane bound it
# directly — `tools/alert_replay.py::make_forming_evaluate` and
# `tests/test_alert_replay.py::_closed_bar_evaluate` — and both are the frozen
# fire log's own instrument. Deleting the name in the same commit would have
# broken the measurement being used to prove that commit was safe.
#
# Task 5 owns `alert_replay.py`, so both binders were re-pointed at
# `threshold_operand_value` here, and the proof is unchanged and unmoved:
# `python tools/alert_replay.py --check` still reproduces all 691,195 frozen
# fires, digest for digest, and the 5,040-row baseline still replays exactly. A
# delegation nobody calls is a twin waiting to drift, which is the thing this
# programme retires.


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
# ⚠️ AND A FIRE FROM THESE IS LEDGER-GRADE ONLY THROUGH `admit_alert_fire`. The
# forming lane reads the bar that is still being built with cycle-granularity
# crossings, so its fires are not receipts — but that is now a GATE rather than a
# sentence: the door below raises on a forming-lane fire and on a bar that has
# not closed, and `test_alert_ledger_admission.py` fails if either refusal goes.

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
    # ── PHASE C TASK 10: the PRICE address ───────────────────────────────────
    # The same four a level gets, and no `touch_*`: those two are declared
    # operands belonging to `bb`, and offering them here would need a second
    # `THRESHOLD_OPERAND` row per band — i.e. a product decision about which
    # band "price touches the band" means, which nobody has made.
    "close": _OSCILLATOR_CONDITIONS,
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
    # ── PHASE C TASK 10: the PRICE address ──
    "close": "Price (Close)",
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
_CANONICAL_ADDRESS: dict[str, str] = {a.lower(): a for a in all_addresses()}


def resolve_address(raw: Optional[str]) -> str:
    """A stored `indicator` string → its canonical plot address.

    Case-insensitive, because the stored value is whatever the create path was
    handed and that path validates nothing. Returns the lowercased input
    unchanged when nothing matches, so an unknown address stays an
    `INDICATOR_FUNCS` miss — a silent no-op, exactly as before.
    """
    lowered = (raw or "").lower()
    return _CANONICAL_ADDRESS.get(lowered, lowered)


def instance_label(address: str, params: Optional[dict] = None) -> str:
    """⭐ SPEC §8 — "RSI(7) crossed 70" vs "RSI(14)", from ONE authority.

    An indicator alert has always named a DEFINITION (`"RSI"`) while evaluating
    an INSTANCE (`rsi` with `period=7`, because `params_json` said so). Two
    alerts one keystroke apart rendered identically on every surface, and the
    chart and the alert could disagree about the period with nothing to notice.

    ⛔ THE KNOBS ARE DERIVED, NEVER LISTED. `alert_series.address_inputs` reads
    them off the column function that actually consumes them, so this cannot
    name a parameter the compute ignores, and a compute that gains one is
    labelled without editing anything here. A hand-written
    `{"rsi": ["period"], …}` map is the retired dict's shape exactly.

    ⚠️ ONLY NON-DEFAULT-FREE ADDRESSES GET A SUFFIX. `vwap`, `obv`, `bb` and
    `close` take no parameters at all, so "VWAP()" would be noise: they render
    as the bare label, which is also what every existing surface already shows.
    """
    base = ALERT_LABELS.get(address, address)
    defaults = alert_series.address_inputs(address)
    if not defaults:
        return base
    resolved = dict(defaults)
    for key, default in defaults.items():
        if params and key in params and params[key] is not None:
            try:
                resolved[key] = type(default)(params[key])
            except (TypeError, ValueError):
                resolved[key] = params[key]
    parts = []
    for value in resolved.values():
        if isinstance(value, float) and value == int(value):
            parts.append(str(int(value)))
        else:
            parts.append(str(value))
    return f"{base}({', '.join(parts)})"


def alert_catalog() -> list[dict]:
    """What the alert dropdown may offer, grouped by indicator.

    Keyed off the three address partitions, so an entry cannot exist for
    something that cannot be evaluated. Raises ``KeyError`` on a value function
    with no condition list — a new address has to fail HERE rather than render
    an empty condition dropdown and an un-submittable form.

    ⭐ EACH PLOT CARRIES ITS `inputs` (PHASE C TASK 10). That is the INSTANCE's
    shape — the knobs whose values make `RSI(7)` a different alert from
    `RSI(14)`. Until this shipped the popover sent no params at all, so every
    alert a user could create was on the DEFAULT instance and spec §8's two
    sentences were literally unrepresentable. The values are read off the column
    functions (`alert_series.address_inputs`), so the dropdown cannot offer a
    knob the compute ignores.

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
    # ⚠️ LEVELS FIRST, THEN EVENTS, THEN PRICE — so the pre-B5 eight are still
    # the first eight groups, the B5 six still follow in their order, Phase C
    # appended `sar`, and Task 10 appends `close` after it. An existing user's
    # dropdown opens on the same option it always did and every option they
    # already knew is where it was. `ADDRESS_PARTITIONS` is that order.
    groups: dict[str, list[str]] = {}
    for address in all_addresses():
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
                # The instance's shape. `{}` means "this address takes no
                # parameters", which is a real answer and not a missing one.
                "inputs": alert_series.address_inputs(address),
                "instance_label": instance_label(address),
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


def _evaluate_one(alert: dict, bars: Optional[list[dict]] = None, *,
                  mode: Optional[str] = None,
                  now_epoch: Optional[float] = None) -> tuple[Optional[float], bool]:
    """Compute the indicator value for one alert and return (value, triggered).

    ``bars`` may be passed in pre-fetched (so a (sym, tf) group of alerts
    shares the same fetch); if None we fetch them ourselves. We need at
    least a handful of bars to compute most indicators — the indicator
    funcs themselves return None for short inputs, in which case we report
    (None, False) so the cycle records nothing and moves on.

    ⭐ ``mode`` IS AN OVERRIDE, NOT A SECOND READER OF THE CONSTANT. Left
    ``None`` it asks `eval_mode()`, which is the module's only reader; passing it
    explicitly is how a test drives ONE lane without touching global state (and
    without a `monkeypatch` whose failure mode is a leaked module attribute —
    `lesson_cleanup_must_verify_ownership`). Two tests deliberately call this with
    NO ``mode`` at all on an input where the two lanes DISAGREE, which is what
    makes "`eval_mode()` secretly returns closed" a mutation that dies rather
    than one every explicit-mode test rides straight past.
    """
    resolved_mode = mode if mode is not None else eval_mode()
    if resolved_mode == "closed":
        value, triggered, _bar_index = _evaluate_one_closed(
            alert, bars, now_epoch=now_epoch)
        return value, triggered

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

    # ⚠️ THE FORMING LANE'S `prev` IS THE PREVIOUS 60-SECOND POLL'S NUMBER, NOT
    # THE PREVIOUS BAR'S. That is the defect Phase C exists to close, and it is
    # named here rather than left as a variable called `prev_value`: `last_value`
    # is written by `record_evaluation` / `record_trigger` at the end of whatever
    # cycle last ran, so "crossed above 70" means "crossed since the last time we
    # happened to look". The closed lane below takes `prev` from `series[i-1]`.
    prev_value = alert.get("last_value")
    triggered = check_condition(condition, value, prev_value, threshold)
    return value, triggered


# ─── THE CLOSED-BAR LANE (spec §8) ───────────────────────────────────────────
#
# Everything below is reachable today only by asking for it (`mode="closed"`).
# `ALERT_EVAL_MODE` is `"forming"`, so no armed alert reaches any of it.

# Minutes per intraday timeframe code. `D`/`W`/`M` are NOT here: their bars are
# stored as YYYYMMDD calendar keys and a month is not a fixed number of seconds,
# so they are resolved through the ET calendar in `bar_close_epoch`.
_TF_MINUTES: dict[str, int] = {"1": 1, "5": 5, "15": 15, "30": 30, "60": 60}

_CALENDAR_TFS: tuple[str, ...] = ("D", "W", "M")


def _bar_calendar_date(t) -> Optional["object"]:
    """A daily/weekly/monthly bar's `t` → its calendar date, or ``None``.

    ⛔ `bars_sqlite` STORES DAILY TIMESTAMPS AS YYYYMMDD INTS. 20260805 read as
    unix seconds is 1970-08-23 — that is not hypothetical, it is the live
    `_fetch_bars_for_alert` → `compute_vwap` defect Task 2 measured and pinned
    (400 trading days landing 11,130 seconds apart, i.e. one "session"). The
    ledger's own `_normalize_bar_time` exists for the same reason. So the
    encoding is decided by the TIMEFRAME, never by the magnitude of the number.
    """
    import datetime as _dt
    if isinstance(t, str):
        text = t.strip().replace("-", "")
    elif isinstance(t, bool) or not isinstance(t, (int, float)):
        return None
    else:
        text = str(int(t))
    if len(text) != 8 or not text.isdigit():
        return None
    try:
        return _dt.date(int(text[:4]), int(text[4:6]), int(text[6:8]))
    except ValueError:
        return None


def _et_midnight_epoch(day) -> float:
    """Unix seconds at 00:00 ET on ``day``.

    ⛔ RESOLVED PER INSTANT FROM THE IANA DATABASE, THROUGH THE SAME ZONE
    `compute_vwap` USES (`indicator_compute._et_zone()`) — never `_ET_OFFSET`-style
    module-load constant arithmetic, which is correct for half the year and
    silently an hour wrong for the other half depending on when the process
    started (`docs/decisions/2026-08-02-vwap-utc-day-bucketing.md` §7). ET
    midnight is also the boundary that decision settled on as the session
    anchor, so this lane and the VWAP column cut the day in the same place.
    """
    import datetime as _dt
    from api.services import indicator_compute
    zone = indicator_compute._et_zone()
    return _dt.datetime(day.year, day.month, day.day, tzinfo=zone).timestamp()


def bar_close_epoch(t, tf: str) -> Optional[float]:
    """The instant a bar STOPS BEING ABLE TO CHANGE, or ``None`` if unknowable.

    ⭐ "CLOSED" MEANS "THE STORE CAN NO LONGER MOVE THIS ROW", WHICH IS NOT THE
    SAME AS "THE REGULAR SESSION ENDED", AND THE DIFFERENCE IS THE WHOLE POINT OF
    THIS PHASE. A daily bar is an ET calendar day and US equity extended hours
    run to 20:00 ET, so a post-market print at 18:30 still updates today's daily
    row. Calling it closed at 16:00 would hand the closed lane a row that then
    CHANGED — repaint, reintroduced from a new direction, in the lane built to
    remove it. So the daily boundary is the next ET midnight, the same boundary
    `compute_vwap` anchors its session on.

    Intraday bars carry a unix-second START and close a timeframe later.
    Weekly closes seven ET days on. Monthly closes at the next month's ET
    midnight — deliberately a CALENDAR step and not `+30 days`, which is wrong
    for eleven months of twelve.

    ``None`` for a timeframe or an encoding this lane does not understand, which
    `closed_bar_index` treats as "cannot claim this bar has closed" — the safe
    direction, because the alternative is firing on a bar that is still moving.
    """
    import datetime as _dt
    code = str(tf or "").strip().upper()
    minutes = _TF_MINUTES.get(code)
    if minutes is not None:
        if isinstance(t, bool) or not isinstance(t, (int, float)):
            return None
        return float(t) + minutes * 60
    if code not in _CALENDAR_TFS:
        return None
    day = _bar_calendar_date(t)
    if day is None:
        return None
    if code == "D":
        return _et_midnight_epoch(day + _dt.timedelta(days=1))
    if code == "W":
        return _et_midnight_epoch(day + _dt.timedelta(days=7))
    nxt = _dt.date(day.year + (day.month == 12), (day.month % 12) + 1, 1)
    return _et_midnight_epoch(nxt)


def closed_bar_index(bars: list[dict], tf: str, now_epoch: float) -> int:
    """Index of the newest bar that has CLOSED, or -1.

    ⛔ THIS IS NOT `len(bars) - 2`. Three reasons, each measured:
      1. Outside RTH the store's newest bar is already closed, so blanket
         last-minus-one drops a whole real bar and every alert fires one bar late,
         forever, in exactly the hours a swing trader looks.
      2. `bars_sqlite` daily/weekly/monthly ts are YYYYMMDD ints; intraday ts are
         unix seconds. Comparing a YYYYMMDD to `now_epoch` is a type confusion the
         ledger's own `_normalize_bar_time` exists because of.
      3. A gap (holiday, halt, thin ticker) means the newest bar can be days old
         and unambiguously closed.

    So: a bar is closed iff `now_epoch >= bar_close_epoch(...)`, and the search
    walks BACKWARDS from the newest — which is what makes (1) and (3) fall out
    of one rule instead of two special cases. A bar whose encoding cannot be
    resolved is skipped rather than assumed closed.
    """
    for i in range(len(bars) - 1, -1, -1):
        close_at = bar_close_epoch(bars[i].get("t"), tf)
        if close_at is None:
            continue
        if now_epoch >= close_at:
            return i
    return -1


def _closed_address_value(address: str, bars: list[dict],
                          params: dict) -> Optional[float]:
    """The resolver the closed lane hands `resolve_operand` for an `address`.

    The counterpart of `address_value`, and it differs in exactly one way that
    matters: it reads the column's LAST ELEMENT rather than its last non-None
    one. On the closed lane "the last bar of the window I was given" is the bar
    being judged, and a column with a trailing pad (`ichimoku.chikou`) has no
    value THERE — reaching backwards for one would answer a question about a
    different bar. Callers truncate `bars` so that "the last bar" is the bar
    being judged.

    Returns ``None`` for an address the table has never heard of, matching
    `address_value`: the create path validates nothing, so a stored typo stays
    the silent no-op it has always been.
    """
    from api.services import alert_series
    fn = alert_series.series_function(resolve_address(address))
    if fn is None or not bars:
        return None
    series = alert_series.series_for(resolve_address(address), bars, params)
    return series[-1] if series else None


def _closed_threshold_operand_value(address: str, condition: str,
                                    bars: list[dict], params: dict,
                                    index: int) -> Optional[float]:
    """The DECLARED right-hand side for (address, condition) AT bar ``index``.

    ⛔ AT THE CLOSED BAR, NOT AT THE NEWEST ONE. `bb touch_upper` compares the
    close against the upper band, and reading the band off the FORMING bar while
    reading the close off the closed one is a repaint hiding on the right-hand
    side of the comparison — the fire set would depend on when you looked even
    though the value did not. `bars[:index + 1]` makes "the last bar" the bar
    being judged, so the SAME `resolve_operand` grammar Task 3 built resolves it
    with no new branch and no second table.
    """
    spec = THRESHOLD_OPERAND.get((address, condition))
    if spec is None:
        return None
    return resolve_operand(spec, bars[:index + 1], params, _closed_address_value)


def _evaluate_one_closed(alert: dict, bars: Optional[list[dict]] = None, *,
                         now_epoch: Optional[float] = None,
                         ) -> tuple[Optional[float], bool, Optional[int]]:
    """(value, triggered, bar_index) at the newest CLOSED bar.

    ⭐ `prev` COMES FROM THE SERIES, NOT FROM THE ROW. `alert["last_value"]` is
    DEMOTED to delivery-dedup and is not read here at all — spec §8, and the
    reason Task 2's repaint number is what it is. Two consequences worth naming:
    a fresh alert can fire on its very first evaluation (the forming lane needed
    a poll to happen first), and the answer no longer depends on how often the
    loop runs.

    ⭐ AND `bar_index` IS RETURNED, WHICH IS WHAT MAKES FIRE-ONCE POSSIBLE. The
    old lane could only ask "did it fire this cycle"; this one can ask "did it
    fire for THIS BAR", which is the same question the signal ledger's UNIQUE key
    asks and the reason a closed-bar fire is ledger-grade at all. Nothing
    consumes it yet — fire-once / re-arm is Task 11's and the ledger door is
    Task 9's — but the number the door needs is produced here rather than
    reconstructed later from a timestamp.

    ⚠️ `i < 1` IS NOT AN OFF-BY-ONE, IT IS THE `prev` REQUIREMENT. `series[i-1]`
    has to exist, and at `i == 0` there is no previous bar to have crossed from.
    """
    from api.services import alert_series

    address = resolve_address(alert.get("indicator"))
    if alert_series.series_function(address) is None:
        return None, False, None

    if bars is None:
        bars = _fetch_bars_for_alert(alert["sym"], alert["tf"], 200)
    if not bars:
        return None, False, None

    if now_epoch is None:
        now_epoch = time.time()

    i = closed_bar_index(bars, alert.get("tf") or "", now_epoch)
    if i < 1:
        return None, False, None

    params = _parse_params(alert)
    try:
        series = alert_series.series_for(address, bars, params)
    except AssertionError:
        # A misaligned column is a BUG in a series function, not a quiet bar.
        raise
    except Exception:
        _logger.exception(
            "[alert-eval] closed compute failed for alert %s (%s/%s/%s)",
            alert.get("id"), alert.get("sym"), address, alert.get("tf"),
        )
        return None, False, i

    current, prev = series[i], series[i - 1]
    if current is None:
        return None, False, i

    condition = alert.get("condition") or ""
    threshold = alert.get("threshold")
    # ⛔ OUTSIDE THE try/except ABOVE, for the reason `_evaluate_one` states:
    # `resolve_operand` RAISES on an operand kind nobody implements, and
    # swallowing that would turn a bug in a declaration into an alert that is
    # offered and never fires.
    dyn = _closed_threshold_operand_value(address, condition, bars, params, i)
    if dyn is not None:
        threshold = dyn

    return current, check_condition(condition, current, prev, threshold), i


# ─── THE LEDGER DOOR ─────────────────────────────────────────────────────────
#
# ⭐ THE CONSTRAINT CARRIED SINCE B1 IS CLOSED HERE AND NOWHERE EARLIER.
# Spec §8: *nothing enters the ledger unless it is closed-bar evaluated*. Every
# task from 1 through 8 was ordered to leave this door shut, and until now the
# honesty of the ledger was an ABSENCE — two comments in this module saying the
# fires were not ledger-grade, and no code anywhere that would stop one. An
# absence stops being a control the moment it stops being true.
#
# ⛔ SO THE REFUSAL IS A RAISE, NOT A RETURN. `ledger.record_signal` already
# returns False for exactly one thing — "already recorded" — and its own
# docstring calls a dropped write reported as a duplicate *"the one lie
# fire-once cannot survive"*. A refusal that returned False would be that lie,
# and it would be indistinguishable from the steady state.
#
# ⛔ NOTHING CALLS THIS YET, AND THAT IS DELIBERATE. `_run_one_cycle` is the live
# lane; while `ALERT_EVAL_MODE` is `"forming"` a call from there would raise on
# every fire. Wiring belongs AFTER the cutover, never as part of it — spec §8 and
# the phase plan both say the door opens after the flip, not with it.

# The ledger's `version` column exists so a rule whose ARITHMETIC changed
# produces a distinguishable row rather than silently reusing a key
# (`signature/rules.py::VERSIONS` is the same idea for the three Signature
# rules). The alert lane's arithmetic IS the closed-bar evaluator, so the string
# names the lane: a forming-lane row cannot exist under it by construction,
# which is the point — a receipt has to say what produced it.
ALERT_LEDGER_VERSION = "alert-closed-v1"

# ⚠️ TWO VOCABULARIES FOR ONE TIMEFRAME, AND THE LEDGER OWNS THE OTHER ONE. An
# alert's `tf` is the BARS-STORE key, because that is what it hands
# `bars_sqlite.get_bars`. The ledger's `tf` is the PRODUCT label the surface
# shows, and ten rows of real history are already keyed that way with no rewrite
# path. Passing the field we already hold is the natural mistake and it is
# SILENT: the row lands and simply orphans itself.
_LEDGER_TIMEFRAME: dict[str, str] = {
    "1": "1m", "5": "5m", "15": "15m", "30": "30m", "60": "1h",
    "D": "1D", "W": "1W", "M": "1M",
}

_NOT_LEDGER_GRADE = "forming-bar fires are not ledger-grade"


def ledger_timeframe(tf: str) -> str:
    """A bars-store timeframe code → the product label the ledger keys on.

    RAISES on a code with no label rather than passing the code through. The
    create path validates nothing, so `tf` can be any string a client sent; a
    guess here writes a spelling into an append-only key column that nothing can
    correct afterwards.
    """
    label = _LEDGER_TIMEFRAME.get(str(tf or "").strip().upper())
    if label is None:
        raise RuntimeError(
            f"no product timeframe label for {tf!r} — the ledger keys on the "
            f"label the surface shows ({sorted(set(_LEDGER_TIMEFRAME.values()))}), "
            f"and this lane will not invent one"
        )
    return label


def admit_alert_fire(alert: dict, value: Optional[float],
                     bar_index: Optional[int], bars: list[dict], *,
                     now_epoch: Optional[float] = None) -> bool:
    """Record an alert-lane fire in the Signature ledger — or REFUSE, loudly.

    Returns what `ledger.record_signal` returns and nothing else: **True** for a
    new row, **False** for "already recorded". Every refusal is a `RuntimeError`,
    so a caller can never read a refusal as a duplicate.

    Three conditions, ALL required:

      1. ``eval_mode() == "closed"``. The forming lane judges the bar that is
         still being built and takes `prev` from whatever the previous 60-second
         poll stored, so whether it fires at all depends on when the loop
         happened to look — Task 2 measured 636,205 keyed disagreements across
         intra-bar granularities. A receipt for that is a receipt for a coin
         toss.
      2. ``bar_index`` names a bar of this alert's timeframe that has actually
         CLOSED as of ``now_epoch`` — `bar_close_epoch` decides, per timeframe,
         through the ET calendar. The mode is a global; this is a fact about one
         bar and one clock, and flipping the constant must not be enough to
         admit a mid-bar fire.
      3. ``bar_index < len(bars) - 1``, **or** the bar is closed by the clock.
         ⚠️ Honest note: (2) already demands the second half, so this gate adds
         no refusal today — it is belt-and-braces, kept because the window handed
         in is not always the store's own and a future weakening of (2) must
         still not admit the newest bar by default.

    ⚠️ AND THE LEDGER'S KEY VOCABULARY IS NOT NEGOTIABLE:

      * ``tf`` is the PRODUCT label ("1D"), never the bars-store key ("D") —
        `ledger_timeframe` above, and the ledger refuses the other spelling at
        its own door too.
      * ``indicator`` is this lane's canonical ADDRESS (`"rsi"`, `"adx.plusDI"`),
        which is NOT the chart engine's plot address. `"rsi.rsi"` looks *more*
        correct and is a second vocabulary in a key column; the two genuinely
        differ (`williams_r` is `williamsR` there, and `price_vs_ma` has no chart
        definition at all).
      * ``direction`` is the alert's CONDITION (`"cross_above"`), not `"bull"` /
        `"bear"`. The alert lane never expressed a market opinion — "RSI above
        70" is bearish to one trader and bullish to another — and inventing one
        would put a judgement nobody made into a store with no rewrite path.
      * ``price`` is the judged bar's CLOSE, the same thing the FCB writers put
        there. The indicator value goes in `meta`: for `price_vs_ma` the value
        is a spread, and a spread in a column ten real rows fill with a dollar
        price is the same class of corruption as the wrong `tf`.
    """
    from api.services.signature import ledger

    mode = eval_mode()
    if mode != "closed":
        raise RuntimeError(
            f"{_NOT_LEDGER_GRADE}: ALERT_EVAL_MODE is {mode!r}. The lane that "
            f"produced this fire judges the bar that is still forming, so the "
            f"fire may exist only because of when the loop looked."
        )

    if (not isinstance(bar_index, int) or isinstance(bar_index, bool)
            or not bars or not 0 <= bar_index < len(bars)):
        raise RuntimeError(
            f"bar_index {bar_index!r} is not a position in the {len(bars or [])}-bar "
            f"window handed in — a receipt must name a bar that exists"
        )

    tf_key = str(alert.get("tf") or "")
    label = ledger_timeframe(tf_key)                # refuses before anything else
    now = time.time() if now_epoch is None else float(now_epoch)

    bar = bars[bar_index]
    close_at = bar_close_epoch(bar.get("t"), tf_key)
    # ⚠️ THIS REFUSAL DELIBERATELY DOES NOT REUSE `_NOT_LEDGER_GRADE`. It is a
    # fact about ONE BAR and one clock, not about the lane, and a shared phrase
    # would make the mode test above pass on a tree with the mode gate deleted —
    # the refusal would still match the string while checking something else.
    if close_at is None or now < close_at:
        raise RuntimeError(
            f"bar {bar_index} (t={bar.get('t')!r}, tf={tf_key!r}) has not closed "
            f"as of {now!r} (closes at {close_at!r}) — a row the store can still "
            f"move is not a receipt"
        )

    if not (bar_index < len(bars) - 1 or now >= close_at):   # (3), see docstring
        raise RuntimeError(
            f"bar {bar_index} is the newest bar in the window and the clock does "
            f"not say it closed"
        )

    if value is None:
        raise RuntimeError(
            "a fire with no value is not a receipt — refusing rather than "
            "recording a signal whose number nobody can read back"
        )

    address = resolve_address(alert.get("indicator"))
    condition = str(alert.get("condition") or "")

    # Data-shaped refusals (an unusable sym / condition / price / meta) are the
    # LEDGER's to make and it raises ValueError on every one of them — enforced
    # in the store, not in this caller, so a future writer that bypasses this
    # door still hits the same rails.
    return ledger.record_signal(
        address, ALERT_LEDGER_VERSION, str(alert.get("sym") or ""), label,
        condition, bar.get("t"), bar.get("c"),
        meta={
            "lane": "closed",
            "value": value,
            "address": address,
            "condition": condition,
            "threshold": alert.get("threshold"),
            "alertId": alert.get("id"),
            "barIndex": bar_index,
        },
    )


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
    summary = {"considered": 0, "evaluated": 0, "triggered": 0, "errors": 0,
               "suppressed": 0}
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
    # ⭐ THE FIRST CYCLE AFTER A `compute.rev` MIGRATION IS EATEN HERE, AND IT HAS
    # TO BE HERE. A migration resets `last_value` so no crossing can be
    # fabricated out of two different revisions' numbers — but `above`/`below`
    # never read `prev`, so without this every level binding on the migrated
    # definition fires at once on the first evaluation after deploy, and the user
    # is told a level was crossed because the ANCHOR moved. `consume_if_suppressed`
    # returns False for every alert that has never been migrated, which is every
    # alert on a tree where no migration has run.
    from api.services import alert_rev_migration as _rev

    for (sym, tf), alerts_in_group in groups.items():
        try:
            bars = _fetch_bars_for_alert(sym, tf, 200)
        except Exception:
            _logger.exception("[alert-eval] fetch failed for %s/%s", sym, tf)
            summary["errors"] += 1
            continue

        for alert in alerts_in_group:
            try:
                if _rev.consume_if_suppressed(alert, bars=bars):
                    summary["suppressed"] += 1
                    continue
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
