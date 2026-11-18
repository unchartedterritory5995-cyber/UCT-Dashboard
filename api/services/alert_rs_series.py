"""RS alert series — the TWO-SYMBOL lane `alert_series.SERIES_FUNCS` never had.

Every builtin column in `alert_series` is a closure over ONE symbol's bars. The
UCT Relative Strength line is `close / benchmark close`, joined by bar time, so
its alert addresses need a second series the evaluator does not fetch. This
module is that lane (engineering map §2.6, unit 2b-04):

* `RS_SERIES` — the RS addresses (`rs_line.<plot>`), each a column function with
  the ONE call shape ``fn(bars, params, tf=None, sym=None)`` and
  ``fn.reads_benchmark = True``, the flag `alert_user_series.call_series` routes
  on. Without ``tf`` and ``sym`` (the forming lane's `_value_of`, a right-hand
  operand's `series_for`, the catalog's probes) the column is
  ``[None] * len(bars)``: an RS alert is judged on the CLOSED lane only, and
  nothing else can fire it.
* `build_rs_series` — the pure builder: `relative_strength.compute_phase1_columns`
  / `compute_mansfield_columns` (never re-implemented), one column picked and
  aligned, line columns rounded to 6 dp exactly as the chart provider rounds
  them (`api/routers/signature.py::_rs_line_provider`), so the alert and the
  chart read one number.
* `rs_pass` — the evaluation-pass memo. Inside it a benchmark is read ONCE per
  ``(ticker, tf)`` however many alerts name it, `resolve_benchmark` runs once per
  ``(symbol, requested, tf, want)``, and each column family computes once per
  ``(symbol, tf, bars, benchmark bars, inputs)`` (2026-11-07, RS fix U1: the
  symbol is in the key, and a default pass also shares a bounded cross-cycle
  column cache — see `_COLUMN_CACHE`). The bar fetcher is injected here (a test,
  the service's probe); the default is `alert_user_series._symbol_bars`, the
  scan's own local store read with its 20 s TTL.
* `RsTimeframeRefused` — the typed refusal for a timeframe this lane is not
  offered on. Plan §6.5: an RS event is a daily / weekly closed-bar fact; on an
  intraday chart the provider blanks the event columns, and an intraday ALERT on
  them is refused outright rather than armed mute.
* `rs_line.rating` (unit 2b-06) — the twelfth address, and the ONE column here
  that reads no benchmark: the IBD-style RS rating (1–99) the web pod's nightly
  job stores per session in `screener.db`'s `rs_rating_history` side table
  (`api/services/screener/rs_history.py`, unit 2a-03). The column is the stored
  row for the bar's OWN session, aligned by calendar date — a session with no
  row is ``None``, and a later session never leaks backwards. DAILY only
  (``fn.timeframes == ("D",)``): the rating is computed from daily closes, one
  row per session, so a weekly bar has no rating of its own. The history is
  read ONCE per ticker per pass (`RsPass.ratings`), through an injectable reader
  (the service's probe, a test); the default is `rs_history.ticker_history`,
  which never raises and never creates the table — absent or dark, the column
  is ``[None] * len(bars)``.

  ⚠️ IT DECLARES ``fn.reads_benchmark = True`` AND ``fn.reads_rating = True``.
  `alert_user_series.call_series` (outside this unit's file limit) hands a
  builtin column its ``tf`` and ``sym`` on exactly one flag, `reads_benchmark`
  — that flag IS the name of the two-symbol call shape, not a claim about a
  second series — and without the symbol the rating cannot name its row, so a
  column that left the flag off would be offered and never fire (the `vwap`
  class). `reads_rating` says what the column actually reads: the probe seam
  injects a history for it, and a reader of either flag gets a true answer.

⛔ NOTHING HERE IS A SECOND FORMULA. Inputs go through
`relative_strength.resolve_phase1_inputs` (the chart's clamp), the benchmark
through `rs_benchmarks.resolve_benchmark` (the chart's SECTOR / INDUSTRY /
fallback rules), the columns through the two compute functions the chart, the
screener and this lane all read.

⛔ THE ENTRIES ARE NOT IN `SERIES_FUNCS` UNTIL SOMEBODY REGISTERS THEM.
`register_rs_series()` appends `RS_SERIES` to `alert_series.SERIES_FUNCS`
(last, idempotently) and is NOT called at import: the evaluator derives
`INDICATOR_FUNCS`, `ADDRESS_PARTITIONS` and the catalog from that table at ITS
import, and `alert_catalog()` indexes `ALERT_CONDITIONS[address]`, so an entry
in the table without its rows is a `KeyError` on the live catalog. Unit 2b-05
calls it where it declares the `RS_FUNCS` partition (`RS_ADDRESSES` below,
excluded from `INDICATOR_FUNCS`), the `CLOSED_ONLY` membership and the
`ALERT_CONDITIONS` / `THRESHOLD_OPERAND` / `ALERT_BASE_LABELS` /
`ALERT_VALUE_DECIMALS` rows — all together. Until then the columns exist here
and are reachable only by a caller holding them (this unit's tests register
them in a fixture and unregister after).
"""

from __future__ import annotations

import collections
import contextlib
import contextvars
import hashlib
import json
import math
import threading
from typing import Any, Callable, Mapping, NamedTuple, Optional, Sequence

from api.services import relative_strength as rsm
from api.services import rs_benchmarks
from api.services.alert_rev_migration import ADDRESS_BASE_DEFINITION
from api.services.signature import registry_defs

Series = list[Optional[float]]
FetchBars = Callable[[str, str, int], list]
#: ``(ticker, limit) -> rows`` — `rs_history.ticker_history`'s shape (newest session first).
ReadRatings = Callable[[str, int], list]

#: The address base; `plot_base("rs_line.newHigh") == "rs_line"`, and
#: `alertSets.idKey('rs_line') == idKey('rsLine')` binds it to the chart definition.
RS_BASE = "rs_line"

#: The timeframes an RS alert may be armed on (bars-store keys). Plan §6.5 and the
#: unit brief: daily and weekly CLOSED bars only. Intraday is refused — a 252-bar
#: "new high" on 5-minute bars is two days and means nothing, which is why the
#: chart blanks the events there — and monthly is not offered (the presets are
#: daily and weekly; a 252-bar monthly lookback is twenty-one years).
RS_ALERT_TFS: tuple[str, ...] = ("D", "W")
_TF_ALIASES: dict[str, str] = {"1D": "D", "1W": "W", "1M": "M"}
_INTRADAY_TFS: tuple[str, ...] = ("1", "5", "15", "30", "60")

#: 2026-11-07 (RS 2b-06) — the rating address and ITS timeframes. The IBD-style
#: rating is a nightly, per-SESSION number computed from daily closes
#: (`rs_history.compute_ratings`), so it is offered on closed DAILY bars only:
#: a weekly bar has no rating of its own and an intraday bar never will.
RS_RATING_ADDRESS = f"{RS_BASE}.rating"
RS_RATING_TFS: tuple[str, ...] = ("D",)
#: Sessions read beyond the bar window: the table may hold sessions the bar
#: store lacks (or the reverse), and the join is by date, so a little slack
#: keeps the window's oldest bar inside the rows read. Extra rows cost nothing.
RATING_READ_PAD = 40

#: Benchmarks an ALERT may name: the chart's menu minus INDUSTRY (engineering map
#: §2.6 "Benchmark load": a composite costs up to 60 member reads against the
#: 64-entry benchmark cache that clears wholesale; it joins when it has a cache
#: of its own). Derived from the chart's one list, never re-typed. CUSTOM (a
#: member's own ticker, Phase 3 decision D4) is excluded BY NAME as well: it is
#: not in `RS_LINE_BENCHMARKS` (only the v4 menu `RS_LINE_BENCHMARKS_V4` names
#: it), and an alert on an arbitrary symbol would bypass the benchmark cache this
#: lane depends on, so a future edit that folds it into the shared list still
#: cannot reach the alert popover.
#
#: ⭐ 2026-11-12 (sector and theme benchmarks): THEME (the stock's own UCT theme)
#: JOINS by name, appended so the existing options keep their order. A theme is
#: at most ~40 names (the taxonomy's largest, under `MAX_INDUSTRY_MEMBERS`), and
#: its composite is memoised per reader (`rs_benchmarks._composite`, the pass
#: hands it the lane's own loader), so a cycle of THEME alerts costs one build
#: per theme per five minutes, not one per alert. The alert evaluates exactly the
#: chart's composite: the same resolver, the same members, the stock left out.
#: The two PICKS (SECTOR_PICK, THEME_PICK) stay chart-only: each needs a second
#: parameter the alert form would show on every RS alert; they are excluded by
#: name with INDUSTRY and CUSTOM.
RS_ALERT_EXCLUDED_BENCHMARKS: tuple[str, ...] = (
    "INDUSTRY", rs_benchmarks.CUSTOM_BENCHMARK, rs_benchmarks.SECTOR_PICK_BENCHMARK,
    rs_benchmarks.THEME_PICK_BENCHMARK)
RS_ALERT_BENCHMARKS: tuple[str, ...] = tuple(
    b for b in registry_defs.RS_LINE_BENCHMARKS if b not in RS_ALERT_EXCLUDED_BENCHMARKS
) + (rs_benchmarks.THEME_BENCHMARK,)

#: The chart's defaults, read off the module that computes with them.
PHASE1_DEFAULTS: dict[str, Any] = {
    "benchmark": rs_benchmarks.DEFAULT_BENCHMARK,
    "maLength": rsm.DEFAULT_MA_LENGTH,
    "maType": rsm.DEFAULT_MA_TYPE,
    "lookback": rsm.DEFAULT_LOOKBACK,
    "priceTolerance": rsm.DEFAULT_PRICE_TOLERANCE_PCT,
    "redDayThreshold": rsm.DEFAULT_RED_DAY_PCT,
}
MANSFIELD_DEFAULTS: dict[str, Any] = {
    "benchmark": rs_benchmarks.DEFAULT_BENCHMARK,
    "mansfieldLength": rsm.DEFAULT_MANSFIELD_LENGTH,
}
#: 2026-11-10 (RS split, lane S2) — the two new split families' inputs, read off
#: the module that computes with them, exactly as the chart's `rsPhases` /
#: `rsVsEma` rows default them (`registry_defs._rs_phases_row`). The vs-21-EMA
#: alert has no length knob: the chart's definition fixes the EMA at 21.
PHASES_DEFAULTS: dict[str, Any] = {
    "benchmark": rs_benchmarks.DEFAULT_BENCHMARK,
    "shortEma": rsm.DEFAULT_PHASES_SHORT,
    "longEma": rsm.DEFAULT_PHASES_LONG,
}
VS_EMA_DEFAULTS: dict[str, Any] = {
    "benchmark": rs_benchmarks.DEFAULT_BENCHMARK,
}
#: 2026-11-12 -- UCT RS Exit Warnings (`rsExit`): 0 is AUTO (daily 21 / 50, weekly 8 / 21,
#: `relative_strength.resolve_exit_lengths`), the same default the chart's row declares.
EXIT_DEFAULTS: dict[str, Any] = {
    "benchmark": rs_benchmarks.DEFAULT_BENCHMARK,
    "fastLength": 0,
    "slowLength": 0,
}
_RANGES: dict[str, tuple[float, float]] = {
    "fastLength": (0, rsm.EXIT_LENGTH_RANGE[1]),     # 0 = auto
    "slowLength": (0, rsm.EXIT_LENGTH_RANGE[1]),
    "shortEma": rsm.PHASES_SHORT_RANGE,
    "longEma": rsm.PHASES_LONG_RANGE,
    "maLength": rsm.MA_LENGTH_RANGE,
    "lookback": rsm.LOOKBACK_RANGE,
    "priceTolerance": rsm.PRICE_TOLERANCE_RANGE,
    "redDayThreshold": rsm.RED_DAY_RANGE,
    "mansfieldLength": rsm.MANSFIELD_LENGTH_RANGE,
}
_INT_KEYS: tuple[str, ...] = ("maLength", "lookback", "mansfieldLength", "shortEma", "longEma",
                              "fastLength", "slowLength")
MA_TYPES: tuple[str, ...] = ("EMA", "SMA")

#: EMA convergence prefix — the same multiplier `alert_series.MA_CROSS_EMA_PREFIX_MULT`
#: uses and for the same reason: an EMA seeded ``w`` bars before the judged bar
#: still carries ``((p-1)/(p+1))^(w-p)`` of its seed; 6×length leaves ≈ e^-12.
EMA_PREFIX_MULT = 6

#: Line columns are a RATIO and are rounded to six places on the wire
#: (`_rs_line_provider`: "a RATIO: six places, not four"). Same number here.
LINE_DECIMALS = 6


# ─── the typed timeframe refusal ─────────────────────────────────────────────

def normalize_tf(tf: Any) -> str:
    """``"1D"`` → ``"D"``; the store key spelling, upper-cased."""
    code = str(tf or "").strip().upper()
    return _TF_ALIASES.get(code, code)


def address_timeframes(address: Optional[str]) -> tuple[str, ...]:
    """The timeframes ``address`` is offered on: the column's OWN declaration
    (``fn.timeframes``) when the address is one of this module's, else the
    lane-wide daily / weekly. 2026-11-07 (RS 2b-06): the rating declares
    ``("D",)``; every other RS column declares `RS_ALERT_TFS`."""
    fn = RS_SERIES.get(address) if address else None
    return tuple(getattr(fn, "timeframes", None) or RS_ALERT_TFS)


def timeframe_refusal(tf: Any, address: Optional[str] = None) -> Optional[str]:
    """Why an RS address cannot be armed on ``tf``, as a member sentence — or
    ``None`` (offered). The evaluator's create door (2b-05) prints this; the
    column raises `RsTimeframeRefused` carrying the same sentence.

    Per ADDRESS since 2b-06: the rating is daily-only and says so in its own
    sentence ("closed daily bars only", naming the nightly daily-close table);
    the eleven compute-backed addresses keep the daily / weekly sentences.
    ⚠️ Every sentence here carries the phrase the service anchors on
    (`indicator_alert_service.REFUSAL_RS_TIMEFRAME`, "are judged on closed
    daily"); the two families diverge only AFTER it.
    """
    code = normalize_tf(tf)
    offered = address_timeframes(address)
    if code in offered:
        return None
    if offered == RS_RATING_TFS:
        what = "IBD-style RS rating alerts"
        # 2026-11-07 (RS fix U1, review #36): a member sentence names no table.
        why = "the rating is computed nightly from daily closes, one per session, so"
        if code == "W":
            return (f"{what} are judged on closed daily bars only — {why} a weekly "
                    f"bar has no rating of its own. Arm it on D.")
        if code in _INTRADAY_TFS:
            return (f"{what} are judged on closed daily bars only — {why} a "
                    f"{code}-minute bar has no rating of its own. Arm it on D.")
        if code == "M":
            return (f"{what} are judged on closed daily bars only — {why} a monthly "
                    f"bar has no rating of its own. Arm it on D.")
        return (f"{what} are judged on closed daily bars only — got timeframe "
                f"{tf!r}. Arm it on D.")
    what = "UCT Relative Strength alerts"
    if code in _INTRADAY_TFS:
        return (f"{what} are judged on closed daily or weekly bars only — a "
                f"{code}-minute bar is not offered. An RS new high or cross is a "
                f"daily or weekly fact, and the chart blanks RS events intraday; "
                f"arm it on D or W.")
    if code == "M":
        return (f"{what} are judged on closed daily or weekly bars only — monthly "
                f"is not offered (a 252-bar lookback on monthly bars is twenty-one "
                f"years). Arm it on D or W.")
    return (f"{what} are judged on closed daily or weekly bars only — got "
            f"timeframe {tf!r}. Arm it on D or W.")


class RsTimeframeRefused(ValueError):
    """An RS address asked for on a timeframe the lane is not offered on.

    Raised by the column BEFORE any benchmark is read, so a row written around
    the create door (an operator tool) is a logged refusal every cycle rather
    than a silent no-fire. ``tf`` and ``address`` ride on the exception so the
    evaluator can map it to the member sentence (`timeframe_refusal`)."""

    def __init__(self, tf: Any, address: Optional[str] = None) -> None:
        self.tf = tf
        self.address = address
        super().__init__(timeframe_refusal(tf, address)
                         or f"RS alerts are not offered on timeframe {tf!r}.")


# ─── the address table ───────────────────────────────────────────────────────

class RsSpec(NamedTuple):
    column: str              # the `relative_strength` column this address IS
    family: str              # "phase1" (`compute_phase1_columns`) | "mansfield" (`compute_mansfield_columns`)
    #                          # | "phases" (`compute_rs_phases_columns`) | "vs_ema" (`compute_rs_vs_ema_columns`)
    #                          # | "exit" (`compute_rs_exit_columns`, 2026-11-12)
    inputs: tuple[str, ...]  # the knobs this column reads (its `fn.inputs` keys)
    kind: str                # "line" (a number) | "event" ({0, 1, None}) | "state" ({0, 1, None}, a level)
    rounded: bool            # rounded to `LINE_DECIMALS` like the provider's line columns


_MA_INPUTS: tuple[str, ...] = ("benchmark", "maLength", "maType")
_NH_INPUTS: tuple[str, ...] = ("benchmark", "lookback")
_MANSFIELD_INPUTS: tuple[str, ...] = ("benchmark", "mansfieldLength")
_PHASES_INPUTS: tuple[str, ...] = ("benchmark", "shortEma", "longEma")
_VS_EMA_INPUTS: tuple[str, ...] = ("benchmark",)
_EXIT_INPUTS: tuple[str, ...] = ("benchmark", "fastLength", "slowLength")

#: 2026-11-10 (RS split, lane S2) — the bases of the two split families. Their
#: addresses are `rs_phases.<plot>` / `rs_vs_ema.<plot>`, the snake_case spelling
#: of the chart definitions `rsPhases` / `rsVsEma` (`alertSets.idKey` binds the
#: two spellings, as `rs_line` is bound to `rsLine`).
RS_PHASES_BASE = "rs_phases"
RS_VS_EMA_BASE = "rs_vs_ema"
#: 2026-11-12 -- UCT RS Exit Warnings (`rsExit`): Webster's three warnings.
RS_EXIT_BASE = "rs_exit"

#: The three Mansfield addresses stay REGISTERED and EVALUATING (an alert already
#: bound to one keeps firing) but are no longer OFFERED to a new alert — owner
#: decision 2026-11-09. The offer gate reads this (`indicator_alert_evaluator.
#: rs_address_offered`); nothing here unregisters them.
RS_WITHHELD_ADDRESSES: tuple[str, ...] = (
    f"{RS_BASE}.mansfield", f"{RS_BASE}.mansfieldCrossUp", f"{RS_BASE}.mansfieldCrossDown")

#: The addresses of the two split families, in catalog order.
RS_SPLIT_ADDRESSES: tuple[str, ...] = (
    f"{RS_PHASES_BASE}.flipBlue", f"{RS_PHASES_BASE}.flipRed",
    f"{RS_VS_EMA_BASE}.crossUp", f"{RS_VS_EMA_BASE}.crossDown",
    f"{RS_EXIT_BASE}.quickBreak", f"{RS_EXIT_BASE}.quicksand", f"{RS_EXIT_BASE}.deadBreak")

#: ⭐ THE RS ADDRESSES, in catalog order. Names after the dot follow the house
#: convention of the other multi-plot bases (`sar.priceCrossedSar`,
#: `ichimoku.spanA`): camelCase plot names. The engineering map (§2.6) names
#: `newHigh`, `newHighBeforePrice`, `newHighRed`, `crossUp`, `crossDown` and
#: `mansfield`; `value`, `ma`, `above`, `mansfieldCrossUp` and
#: `mansfieldCrossDown` are this unit's additions (the line, its average, the
#: above-average STATE a member can hold an `above` rule on, and the two signed
#: Mansfield zero crosses beside the `cross_zero` rule on the line itself).
#: ⚠️ THESE ARE THE ELEVEN COMPUTE-BACKED ADDRESSES ONLY. `rs_line.rating`
#: (2026-11-07, unit 2b-06) is the twelfth entry of `RS_SERIES` and is NOT a row
#: here: an `RsSpec` names a `relative_strength` column and its family, and the
#: rating has neither — it is read, not computed (`_rs_rating_column` below).
RS_ADDRESS_SPECS: dict[str, RsSpec] = {
    f"{RS_BASE}.value": RsSpec("rsLine", "phase1", ("benchmark",), "line", True),
    f"{RS_BASE}.ma": RsSpec("rsMa", "phase1", _MA_INPUTS, "line", True),
    f"{RS_BASE}.above": RsSpec("rsAbove", "phase1", _MA_INPUTS, "state", False),
    f"{RS_BASE}.crossUp": RsSpec("crossUp", "phase1", _MA_INPUTS, "event", False),
    f"{RS_BASE}.crossDown": RsSpec("crossDown", "phase1", _MA_INPUTS, "event", False),
    f"{RS_BASE}.newHigh": RsSpec("rsNH", "phase1", _NH_INPUTS, "event", False),
    f"{RS_BASE}.newHighBeforePrice": RsSpec("rsNHbeforePx", "phase1",
                                            _NH_INPUTS + ("priceTolerance",), "event", False),
    f"{RS_BASE}.newHighRed": RsSpec("rsNHred", "phase1",
                                    _NH_INPUTS + ("redDayThreshold",), "event", False),
    f"{RS_BASE}.mansfield": RsSpec("mansfield", "mansfield", _MANSFIELD_INPUTS, "line", False),
    f"{RS_BASE}.mansfieldCrossUp": RsSpec("mansfieldCrossUp", "mansfield", _MANSFIELD_INPUTS, "event", False),
    f"{RS_BASE}.mansfieldCrossDown": RsSpec("mansfieldCrossDown", "mansfield", _MANSFIELD_INPUTS, "event", False),
}


#: 2026-11-10 (RS split, lane S2) -- the four split addresses' specs, kept apart from
#: the eleven above so the legacy table (and every rail that walks it as "the
#: compute-backed `rs_line` addresses") is unmoved. `_ALL_SPECS` is the one lookup.
#: The phase flips are derived from the SAME `phase` column the chart shades
#: (`relative_strength.rs_phase_flip_columns`); the 21 EMA crosses are
#: `cross_columns` over `dist >= 0`, the Mansfield zero cross's own shape. Events
#: are 0 / 1 / None and unrounded.
RS_SPLIT_SPECS: dict[str, RsSpec] = {
    f"{RS_PHASES_BASE}.flipBlue": RsSpec("flipBlue", "phases", _PHASES_INPUTS, "event", False),
    f"{RS_PHASES_BASE}.flipRed": RsSpec("flipRed", "phases", _PHASES_INPUTS, "event", False),
    f"{RS_VS_EMA_BASE}.crossUp": RsSpec("crossUp", "vs_ema", _VS_EMA_INPUTS, "event", False),
    f"{RS_VS_EMA_BASE}.crossDown": RsSpec("crossDown", "vs_ema", _VS_EMA_INPUTS, "event", False),
    # 2026-11-12: Webster's three warnings, {0, 1, None} events (`rs_exit_events`), closed bars.
    f"{RS_EXIT_BASE}.quickBreak": RsSpec("quickBreak", "exit", _EXIT_INPUTS, "event", False),
    f"{RS_EXIT_BASE}.quicksand": RsSpec("quicksand", "exit", _EXIT_INPUTS, "event", False),
    f"{RS_EXIT_BASE}.deadBreak": RsSpec("deadBreak", "exit", _EXIT_INPUTS, "event", False),
}
_ALL_SPECS: dict[str, RsSpec] = {**RS_ADDRESS_SPECS, **RS_SPLIT_SPECS}


def _defaults_for(spec: RsSpec) -> dict:
    src = {"phase1": PHASE1_DEFAULTS, "mansfield": MANSFIELD_DEFAULTS,
           "phases": PHASES_DEFAULTS, "vs_ema": VS_EMA_DEFAULTS, "exit": EXIT_DEFAULTS}[spec.family]
    return {k: src[k] for k in spec.inputs}


# ─── inputs: the chart's clamp, never a second one ───────────────────────────

def rs_benchmark_of(params: Optional[Mapping]) -> str:
    """The requested benchmark, upper-cased; the chart's default when absent."""
    p = params or {}
    return str(p.get("benchmark") or rs_benchmarks.DEFAULT_BENCHMARK).strip().upper()


def phase1_inputs(params: Optional[Mapping]) -> dict:
    """The Phase 1 compute inputs, CLAMPED the way the chart clamps them
    (`resolve_phase1_inputs`): the alert and the chart agree bar for bar, and a
    row written around the door with `lookback: 99999` computes what the chart
    would show for the same request (500)."""
    return rsm.resolve_phase1_inputs(dict(params or {}))


def phases_inputs(params: Optional[Mapping]) -> dict:
    """The two phase EMA lengths, clamped and rounded exactly as the chart's
    provider does (`rs_provider.rs_phases_envelope`: ``int(round(_clamp(...)))``)."""
    p = params or {}
    return {
        "shortEma": int(round(rsm._clamp(p.get("shortEma"), *rsm.PHASES_SHORT_RANGE,
                                         default=rsm.DEFAULT_PHASES_SHORT))),
        "longEma": int(round(rsm._clamp(p.get("longEma"), *rsm.PHASES_LONG_RANGE,
                                        default=rsm.DEFAULT_PHASES_LONG))),
    }


def exit_lengths(params: Optional[Mapping], tf: Optional[str] = None) -> tuple:
    """``(fast, slow)`` for an RS Exit Warnings alert on a timeframe, resolved exactly as
    the chart's provider does (`relative_strength.resolve_exit_lengths`: 0 is auto,
    daily 21 / 50, weekly 8 / 21). ``tf`` None reads the daily pair."""
    p = params or {}
    code = normalize_tf(tf) if tf else "D"
    return rsm.resolve_exit_lengths(code, p.get("fastLength"), p.get("slowLength"))


def mansfield_length(params: Optional[Mapping]) -> int:
    """The Mansfield SMA length, clamped exactly as `compute_mansfield_columns`
    clamps it (``int(_clamp(...))``), so the memo key names the length the
    compute will use."""
    raw = (params or {}).get("mansfieldLength")
    return int(rsm._clamp(raw, *rsm.MANSFIELD_LENGTH_RANGE, default=rsm.DEFAULT_MANSFIELD_LENGTH))


def rs_refusal(address: str, params: Optional[Mapping], condition: Optional[str] = None) -> Optional[str]:
    """Why these params could never describe this RS address, or ``None``.

    Read by `indicator_alert_evaluator.params_refusal` through ``fn.validate``
    (the `ma_cross_refusal` shape). The DOOR refuses an out-of-range number and
    says the range; the SERIES clamps it (`phase1_inputs`), so a row that reached
    the store around the door still computes the chart's answer, never a wrong
    one. ``condition`` is accepted for the call shape; the offered-rule check is
    `params_refusal`'s own.
    """
    spec = _ALL_SPECS[address]
    p = params or {}
    if "benchmark" in spec.inputs and p.get("benchmark") is not None:
        b = str(p["benchmark"]).strip().upper()
        if b not in RS_ALERT_BENCHMARKS:
            why = (" INDUSTRY composites are not offered for alerts yet."
                   if b == "INDUSTRY" else
                   " Custom benchmarks are chart-only; alerts take a listed benchmark."
                   if b == rs_benchmarks.CUSTOM_BENCHMARK else
                   " A picked sector or theme is chart-only for now; alerts take a listed"
                   " benchmark, or THEME for the stock's own theme."
                   if b in (rs_benchmarks.SECTOR_PICK_BENCHMARK, rs_benchmarks.THEME_PICK_BENCHMARK)
                   else "")
            return (f"RS benchmark must be one of {', '.join(RS_ALERT_BENCHMARKS)} "
                    f"— got {p['benchmark']!r}.{why}")
    if "maType" in spec.inputs and p.get("maType") is not None:
        if str(p["maType"]).strip().upper() not in MA_TYPES:
            return f"RS maType must be one of {', '.join(MA_TYPES)} — got {p['maType']!r}."
    for key in spec.inputs:
        if key not in _RANGES or p.get(key) is None:
            continue
        v = p[key]
        lo, hi = _RANGES[key]
        whole = key in _INT_KEYS
        bad = (f"RS {key} must be a {'whole number' if whole else 'number'} from "
               f"{lo:g} to {hi:g} — got {v!r}.")
        if isinstance(v, bool):
            return bad
        try:
            f = float(v)
        except (TypeError, ValueError):
            return bad
        if not math.isfinite(f) or (whole and f != int(f)) or not lo <= f <= hi:
            return bad
    return None


def normalize_rs_params(address: str, params: Optional[Mapping]) -> dict:
    """The stored spelling: enums upper-cased, whole-number knobs as ints,
    the rest as floats. Only called on params `rs_refusal` accepted."""
    spec = _ALL_SPECS[address]
    out = dict(params or {})
    for key in ("benchmark", "maType"):
        if key in spec.inputs and out.get(key) is not None:
            out[key] = str(out[key]).strip().upper()
    for key in spec.inputs:
        if key in _RANGES and out.get(key) is not None:
            out[key] = int(float(out[key])) if key in _INT_KEYS else float(out[key])
    return out


def rs_lookback(address: str, params: Optional[Mapping]) -> int:
    """Bars of history this address DECLARES it reads (`alert_series.address_lookback`
    reads it; `bars_needed_for_alert` adds the lane's warm-up floor).

    A new-high needs its ``lookback`` prior bars; an average needs ``maLength``
    (SMA, exact) or ``EMA_PREFIX_MULT × maLength`` (EMA convergence); Mansfield
    its SMA length. The line itself needs nothing beyond the bar.
    """
    spec = _ALL_SPECS[address]
    if spec.family == "mansfield":
        return mansfield_length(params)
    if spec.family == "phases":
        return EMA_PREFIX_MULT * phases_inputs(params)["longEma"]
    if spec.family == "vs_ema":
        return EMA_PREFIX_MULT * rsm.DEFAULT_VS_EMA_LENGTH
    if spec.family == "exit":
        # the SLOW simple average (exact, no EMA convergence) plus the cycle history a Quicksand
        # needs to see its Quick Break. The daily pair is the longer one, so it is read for a
        # timeframe-blind lookback.
        return exit_lengths(params)[1] + rsm.EXIT_CYCLE_HISTORY
    p = phase1_inputs(params)
    if "lookback" in spec.inputs:
        return int(p["lookback"])
    if "maLength" in spec.inputs:
        return int(p["maLength"]) * (EMA_PREFIX_MULT if p["maType"] == "EMA" else 1)
    return 0


def describe_rs(address: str, params: Optional[Mapping]) -> str:
    """The instance label: ``vs SPY · EMA(21)`` — the chip's grammar."""
    spec = _ALL_SPECS[address]
    parts = [f"vs {rs_benchmark_of(params)}"]
    if spec.family == "mansfield":
        parts.append(f"SMA({mansfield_length(params)})")
        return " · ".join(parts)
    if spec.family == "phases":
        p = phases_inputs(params)
        parts.append(f"{p['shortEma']}/{p['longEma']} EMA")
        return " · ".join(parts)
    if spec.family == "vs_ema":
        parts.append(f"EMA({rsm.DEFAULT_VS_EMA_LENGTH})")
        return " · ".join(parts)
    if spec.family == "exit":
        given = params or {}
        if not given.get("fastLength") and not given.get("slowLength"):
            parts.append("21/50 SMA (weekly 8/21)")
        else:
            f, s_ = exit_lengths(params)
            parts.append(f"{f}/{s_} SMA")
        return " · ".join(parts)
    p = phase1_inputs(params)
    if "maLength" in spec.inputs:
        parts.append(f"{p['maType']}({p['maLength']})")
    if "lookback" in spec.inputs:
        parts.append(f"{p['lookback']}-bar")
    if "priceTolerance" in spec.inputs:
        parts.append(f"price within {p['priceTolerance']:g}%")
    if "redDayThreshold" in spec.inputs:
        parts.append(f"red day ≤ {p['redDayThreshold']:g}%")
    return " · ".join(parts)


# ─── the pass: one benchmark read, one compute, per evaluation pass ─────────

def _fingerprint(bars: Sequence[Mapping]) -> tuple:
    """A stable identity for a bar window: its length, its two ends AND a digest
    of every ``(t, c)`` pair in it. Not ``id()`` — a list freed between two
    groups can hand its address to the next one.

    2026-11-07 (RS fix U1, review #1): the ends alone were not an identity. Two
    tickers whose windows share their dates and their last close to the cent
    fingerprinted equal, and inside one cycle-wide pass the second read the
    first one's RS columns (a false or missed new high, the other stock's ratio
    in the notification). The memo keys now carry the symbol and timeframe too;
    the digest is the second guard, over exactly what the compute reads (the
    bar's time and close — `relative_strength` reads nothing else of a bar)."""
    if not bars:
        return (0,)
    first, last = bars[0], bars[-1]
    digest = hashlib.blake2b(
        repr([(b.get("t"), b.get("c")) for b in bars]).encode("utf-8"),
        digest_size=16).hexdigest()
    return (len(bars), first.get("t"), last.get("t"), last.get("c"), digest)


# ─── 2026-11-07 (RS fix U1, review #10): the CROSS-CYCLE column cache ────────
#
# The pass memo lives for one evaluation cycle, so every RS-alerted symbol paid
# the full compute (~70-85 ms of pure Python, GIL held, on the web pod) every
# 60 s — although the closed lane judges `closed_bar_index`, whose answer does
# not move during the session. The evaluator now hands an RS column the CLOSED
# window (`bars[:i + 1]`), so the key below is stable from one cycle to the
# next, and this cache serves it. Keyed on (address, SYMBOL, tf, window
# fingerprint, benchmark fingerprint, inputs) — the #1 rule — where both
# fingerprints carry the full (t, c) digest, so an entry can only ever be served
# for the exact numbers it was computed from. Only a DEFAULT pass (no injected
# reader: the cycle, `diagnose`, the prefill) uses it; a pass with an injected
# fetcher (a test, the service's probes) computes for itself.
#
# Bounded LRU: one entry is one aligned column (~650 floats, ~20 KB); 1,024
# entries is ~20 MB at worst, and an entry exists per live alert instance.
RS_COLUMN_CACHE_MAX = 1024
_COLUMN_CACHE: "collections.OrderedDict[tuple, list]" = collections.OrderedDict()
_COLUMN_CACHE_LOCK = threading.Lock()
_COLUMN_CACHE_STATS = {"hits": 0, "misses": 0}


def _column_cache_get(key: tuple) -> Optional[list]:
    with _COLUMN_CACHE_LOCK:
        hit = _COLUMN_CACHE.get(key)
        if hit is None:
            _COLUMN_CACHE_STATS["misses"] += 1
            return None
        _COLUMN_CACHE.move_to_end(key)
        _COLUMN_CACHE_STATS["hits"] += 1
        return list(hit)


def _column_cache_put(key: tuple, column: list) -> None:
    with _COLUMN_CACHE_LOCK:
        _COLUMN_CACHE[key] = list(column)
        _COLUMN_CACHE.move_to_end(key)
        while len(_COLUMN_CACHE) > RS_COLUMN_CACHE_MAX:
            _COLUMN_CACHE.popitem(last=False)


def clear_column_cache() -> None:
    """Empty the cross-cycle cache (a test's isolation; an operator's reset)."""
    with _COLUMN_CACHE_LOCK:
        _COLUMN_CACHE.clear()
        _COLUMN_CACHE_STATS["hits"] = 0
        _COLUMN_CACHE_STATS["misses"] = 0


def column_cache_stats() -> dict:
    with _COLUMN_CACHE_LOCK:
        return {"entries": len(_COLUMN_CACHE), **_COLUMN_CACHE_STATS}


def _bars_after(benchmark_bars: Sequence[Mapping], last_t: Any) -> int:
    """How many benchmark bars (oldest first) lie AFTER ``last_t`` — the
    benchmark's forming bar when the symbol's window is the closed one. ``0``
    when the times cannot be ordered (never a guess)."""
    count = 0
    try:
        for b in reversed(benchmark_bars or ()):
            if b.get("t") is not None and b.get("t") > last_t:
                count += 1
            else:
                break
    except TypeError:
        return 0
    return count


def _benchmark_on_window(bars: Sequence[Mapping], benchmark_bars: Sequence[Mapping]) -> list:
    """The benchmark bars whose time IS one of the window's bar times — exactly
    the bars `relative_strength` reads (every join is by time, on the symbol's
    own calendar), so a compute on these equals a compute on the whole read,
    and the fingerprint names what the column actually depends on (a benchmark
    forming bar past the window's end never moves the key)."""
    times = {b.get("t") for b in bars}
    return [b for b in benchmark_bars or () if b.get("t") in times]


def default_fetch_bars(ticker: str, tf: str, want: int) -> list:
    """The lane's own benchmark loader: `alert_user_series._symbol_bars`, the
    scan's LOCAL store read (no network), keyed on the same ``t`` the alert's
    bars carry, with its 20 s TTL under the 60 s cycle."""
    from api.services import alert_user_series
    return alert_user_series._symbol_bars(ticker, tf, want)


def default_read_ratings(ticker: str, limit: int) -> list:
    """The lane's own rating-history loader (2026-11-07, RS 2b-06):
    `rs_history.ticker_history`, newest session first, the web pod's
    `screener.db` side table. It never raises and never creates the table —
    without one (the worker pod, a box the nightly has not run on) it is ``[]``
    and the column is ``None`` everywhere, never a guessed number."""
    from api.services.screener import rs_history
    return rs_history.ticker_history(ticker, limit=int(limit))


class RsPass:
    """The memo of one evaluation pass (see `rs_pass`)."""

    __slots__ = ("fetch_bars", "read_ratings", "_bench", "_resolved", "_columns", "_ratings",
                 "fetch_calls", "compute_calls", "rating_calls", "shared")

    def __init__(self, fetch_bars: FetchBars, read_ratings: Optional[ReadRatings] = None,
                 *, shared: bool = False) -> None:
        self.fetch_bars = fetch_bars
        self.read_ratings = read_ratings or default_read_ratings
        #: 2026-11-07 (RS fix U1, review #10): True ⇒ this pass reads and fills
        #: the cross-cycle column cache (`_COLUMN_CACHE`). Only `rs_pass()`
        #: with NO injected reader sets it — the production reads.
        self.shared = bool(shared)
        self._bench: dict[tuple, tuple[int, list]] = {}
        self._resolved: dict[tuple, dict] = {}
        self._columns: dict[tuple, dict] = {}
        self._ratings: dict[str, tuple[int, list]] = {}
        self.fetch_calls = 0
        self.compute_calls = 0
        self.rating_calls = 0

    def ratings(self, ticker: str, limit: int) -> list:
        """The newest ``limit`` stored rating rows of ``ticker`` (newest first) —
        read ONCE per ticker in this pass, however many rating alerts name it
        (2026-11-07, RS 2b-06). The same serve-or-reread rule as `fetch`: a
        smaller ``limit`` is served from the read already made (the rows are
        joined by date, so extra rows cost nothing); a larger one re-reads
        unless the first read already returned fewer rows than it asked for."""
        key = str(ticker or "").upper()
        limit = max(1, int(limit))
        hit = self._ratings.get(key)
        if hit is not None:
            had_limit, rows = hit
            if had_limit >= limit or len(rows) < had_limit:
                return rows
        rows = list(self.read_ratings(ticker, limit) or [])
        self.rating_calls += 1
        self._ratings[key] = (limit, rows)
        return rows

    def fetch(self, ticker: str, tf: str, want: int) -> list:
        """Latest ``want`` bars of ``ticker`` at ``tf`` — read ONCE per ``(ticker, tf)``
        in this pass. A later, smaller ``want`` is served from the read already
        made; a larger one re-reads unless the first read already returned fewer
        bars than it asked for (the store has no more)."""
        key = (str(ticker).upper(), str(tf))
        want = max(1, int(want))
        hit = self._bench.get(key)
        if hit is not None:
            had_want, bars = hit
            if had_want >= want or len(bars) < had_want:
                return bars[-want:] if len(bars) > want else bars
        bars = list(self.fetch_bars(ticker, tf, want) or [])
        self.fetch_calls += 1
        self._bench[key] = (want, bars)
        return bars

    def resolve(self, sym: str, requested: Optional[str], tf: str, want: int) -> dict:
        """`rs_benchmarks.resolve_benchmark` through this pass's reader, once per
        ``(symbol, requested, tf, want)`` — a literal benchmark is symbol-free,
        SECTOR / INDUSTRY / THEME depend on the symbol's group. A composite is
        memoised under this pass's READER (`fetch_bars`, the lane's own loader in
        production), so the next cycle reuses it (`rs_benchmarks._composite`)."""
        req = str(requested or rs_benchmarks.DEFAULT_BENCHMARK).upper()
        sym_key = (str(sym or "").upper()
                   if req in rs_benchmarks.AUTO_BENCHMARKS or req == rs_benchmarks.THEME_BENCHMARK else "")
        key = (sym_key, req, str(tf), int(want))
        hit = self._resolved.get(key)
        if hit is None:
            hit = rs_benchmarks.resolve_benchmark(sym, req, tf, int(want), fetch_bars=self.fetch,
                                                  memo=self.fetch_bars)
            self._resolved[key] = hit
        return hit

    def columns(self, family: str, bars: Sequence[Mapping], benchmark_bars: Sequence[Mapping],
                inputs_key: str, compute: Callable[[], dict], *,
                sym: Optional[str] = None, tf: Optional[str] = None) -> dict:
        """One compute per column family and window in this pass.

        2026-11-07 (RS fix U1, review #1 — critical): the key names the SYMBOL
        and the timeframe. It used to be ``(family, fp(bars), fp(bench),
        inputs)`` with a fingerprint of the window's ends only, so two tickers
        on the same dates with the same last close shared one column set inside
        the cycle-wide pass."""
        key = (family, str(sym or "").upper(), normalize_tf(tf),
               _fingerprint(bars), _fingerprint(benchmark_bars), inputs_key)
        hit = self._columns.get(key)
        if hit is None:
            hit = compute()
            self.compute_calls += 1
            self._columns[key] = hit
        return hit


_PASS: contextvars.ContextVar[Optional[RsPass]] = contextvars.ContextVar("rs_alert_pass", default=None)


def current_pass() -> Optional[RsPass]:
    return _PASS.get()


@contextlib.contextmanager
def rs_pass(fetch_bars: Optional[FetchBars] = None, read_ratings: Optional[ReadRatings] = None):
    """One evaluation pass. Every RS column evaluated inside shares one benchmark
    read per ``(ticker, tf)``, one compute per column family and window, and
    (2026-11-07, RS 2b-06) one rating-history read per ticker.

    Nested without a reader of its own, a pass joins the outer one (a cycle
    that wraps a group that wraps an alert still reads once). A fetcher or a
    rating reader names a NEW pass — the way a test or the service's probe
    injects its benchmark and its history; whichever is not named is the
    default loader.

    The evaluator's cycle wraps `_run_one_cycle`'s group loop in this (2b-05).
    Outside a pass each column call makes a pass of its own, and the bar store
    is still read once per ``(ticker, tf, want)`` per 20 s through
    `_symbol_bars`' TTL cache.
    """
    outer = _PASS.get()
    if outer is not None and fetch_bars is None and read_ratings is None:
        yield outer
        return
    # 2026-11-07 (RS fix U1, review #10): a pass with no injected reader is a
    # production read, and only it shares the cross-cycle column cache.
    p = RsPass(fetch_bars or default_fetch_bars, read_ratings,
               shared=fetch_bars is None and read_ratings is None)
    token = _PASS.set(p)
    try:
        yield p
    finally:
        _PASS.reset(token)


def benchmark_want(bars: Sequence) -> int:
    """How many benchmark bars a window needs: one per bar of the symbol's
    window. A benchmark date the symbol lacks costs nothing (the join is by
    ``t``); a symbol date the benchmark lacks is ``None`` there, never filled."""
    return max(1, len(bars))


# ─── the builder ─────────────────────────────────────────────────────────────

def build_rs_series(address: str, bars: Sequence[Mapping], benchmark_bars: Sequence[Mapping],
                    params: Optional[Mapping], *, sym: Optional[str] = None,
                    tf: Optional[str] = None) -> Series:
    """One RS address → its FULL column, aligned to ``len(bars)``, ``None`` in warm-up.

    Pure apart from the pass memo: `compute_phase1_columns` /
    `compute_mansfield_columns` run once per ``(family, symbol, tf, bars,
    benchmark bars, inputs)`` inside a pass, and the named column is picked.
    Line columns are rounded to `LINE_DECIMALS` like the provider's; event
    columns are the compute's own ``0.0 / 1.0 / None``.

    2026-11-07 (RS fix U1): ``sym`` and ``tf`` key the pass memo and the
    cross-cycle cache (review #1, #10). The benchmark is narrowed to the
    window's own bar times first (`_benchmark_on_window`) — the same numbers
    the compute would read from the whole series, so the column is unchanged.

    ``short_history`` is left at the compute's default (off): the partial-lookback
    dots are a chart affordance for a whole-history window and have no address.
    """
    spec = _ALL_SPECS[address]            # an unknown address is a caller bug, like `series_for`
    n = len(bars)
    if n == 0:
        return []
    benchmark_bars = _benchmark_on_window(bars, benchmark_bars)
    if spec.family == "phase1":
        inputs = phase1_inputs(params)
        inputs_key = json.dumps(inputs, sort_keys=True)

        def compute() -> dict:
            return rsm.compute_phase1_columns(bars, benchmark_bars, inputs)
    elif spec.family == "phases":
        ph = phases_inputs(params)
        inputs_key = json.dumps(ph, sort_keys=True)

        def compute() -> dict:
            cols = rsm.compute_rs_phases_columns(bars, benchmark_bars, ph["shortEma"], ph["longEma"])
            return rsm.rs_phase_flip_columns(cols)
    elif spec.family == "vs_ema":
        inputs_key = str(rsm.DEFAULT_VS_EMA_LENGTH)

        def compute() -> dict:
            cols = rsm.compute_rs_vs_ema_columns(bars, benchmark_bars)
            return rsm.cross_columns(rsm.above_zero_column(cols["dist"]))
    elif spec.family == "exit":
        ex_fast, ex_slow = exit_lengths(params, tf)
        inputs_key = f"{ex_fast}/{ex_slow}"

        def compute() -> dict:
            return rsm.compute_rs_exit_columns(bars, benchmark_bars, ex_fast, ex_slow)
    else:
        n_len = mansfield_length(params)
        inputs_key = str(n_len)

        def compute() -> dict:
            return rsm.compute_mansfield_columns(bars, benchmark_bars, n_len)

    p = current_pass()
    shared_key = None
    if p is not None and p.shared:
        shared_key = (address, str(sym or "").upper(), normalize_tf(tf),
                      _fingerprint(bars), _fingerprint(benchmark_bars), inputs_key)
        cached = _column_cache_get(shared_key)
        if cached is not None:
            return cached
    cols = (p.columns(spec.family, bars, benchmark_bars, inputs_key, compute, sym=sym, tf=tf)
            if p else compute())
    column = list(cols[spec.column])
    if spec.rounded:
        from api.services.indicator_compute import _round_series
        column = _round_series(column, LINE_DECIMALS)
    if shared_key is not None:
        _column_cache_put(shared_key, column)
    return column


# The chart definition whose instances an address of each base reads (the catalog's
# ``instance_defs``) is `alert_rev_migration.ADDRESS_BASE_DEFINITION[base]`: the ONE
# base -> definition map (2026-11-12: this module's own copy named four definition ids, a
# second authority over one fact; it is read from there now).


def _rs_column(address: str) -> Callable[..., Series]:
    """The SERIES function for one RS address — `alert_series._column`'s shape
    with the two extra keyword arguments the lane passes a `reads_benchmark`
    column (`alert_user_series.call_series`)."""
    spec = _ALL_SPECS[address]

    def fn(bars: list, params: Mapping, tf: Optional[str] = None, sym: Optional[str] = None) -> Series:
        n = len(bars)
        if tf is None or not sym:
            # The forming lane, a right-hand operand, a probe without a symbol:
            # no benchmark can be resolved, so no value — never a guessed one.
            return [None] * n
        code = normalize_tf(tf)
        if code not in RS_ALERT_TFS:
            raise RsTimeframeRefused(tf, address)
        if n == 0:
            return []
        p = current_pass() or RsPass(default_fetch_bars)
        requested = rs_benchmark_of(params)
        want = benchmark_want(bars)
        bench = p.resolve(sym, requested, code, want)
        # 2026-11-07 (RS fix U1, review #10): the closed lane hands this column
        # the CLOSED window, which ends one bar before the benchmark's newest
        # (its forming bar). A read of the latest `len(bars)` benchmark bars
        # would then start one bar late and leave the window's first bar with
        # no ratio; read that many more so the overlap is the full window, as
        # it is when both series end on the same bar (then this is 0, no read).
        extra = _bars_after(bench.get("bars") or (), bars[-1].get("t"))
        if extra:
            bench = p.resolve(sym, requested, code, want + extra)
        # The provider's two blanking states (plan §6.10): a symbol against
        # itself is a flat 1.0 that would "make a new high" on every bar, and a
        # benchmark with no bars has no ratio at all.
        if not bench.get("bars") or str(bench.get("resolved") or "").upper() == str(sym).upper():
            return [None] * n
        return build_rs_series(address, bars, bench["bars"], params, sym=sym, tf=code)

    fn.__name__ = f"_series_rs_{spec.column}"
    fn.inputs = _defaults_for(spec)                                      # type: ignore[attr-defined]
    options = {}
    if "benchmark" in spec.inputs:
        options["benchmark"] = list(RS_ALERT_BENCHMARKS)
    if "maType" in spec.inputs:
        options["maType"] = list(MA_TYPES)
    fn.input_options = options                                          # type: ignore[attr-defined]
    fn.instance_defs = [ADDRESS_BASE_DEFINITION[address.split(".", 1)[0]]]   # type: ignore[attr-defined]
    fn.validate = lambda params, condition=None: rs_refusal(address, params, condition)  # type: ignore[attr-defined]
    fn.normalize = lambda params: normalize_rs_params(address, params)  # type: ignore[attr-defined]
    fn.lookback = lambda params: rs_lookback(address, params)           # type: ignore[attr-defined]
    fn.describe = lambda params: describe_rs(address, params)           # type: ignore[attr-defined]
    fn.reads_benchmark = True                                           # type: ignore[attr-defined]
    fn.timeframes = RS_ALERT_TFS                                        # type: ignore[attr-defined]
    fn.rs_column = spec.column                                          # type: ignore[attr-defined]
    fn.rs_kind = spec.kind                                              # type: ignore[attr-defined]
    return fn


# ─── 2026-11-07 (RS fix U1, review #17): a benchmark that can never value ────
#
# A symbol measured against itself (SPY on the default benchmark, QQQ vs QQQ,
# an ETF on SECTOR, which resolves to SPY) and a benchmark with no stored bars
# both blank the column on every bar (`_rs_column` above, the provider's rule).
# Such an alert used to be accepted at the door and then read as "warming up"
# forever. The door refuses the first (`self_benchmark_refusal`); `diagnose`
# names both as faults (`benchmark_fault`).

def resolved_benchmark_name(sym: Optional[str], params: Optional[Mapping]) -> Optional[str]:
    """The ticker this alert's benchmark resolves to for ``sym``, with no bar
    read: a literal benchmark is itself; SECTOR goes through the chart's own
    `rs_benchmarks.resolve_benchmark` with an empty reader (the name is decided
    from the symbol's group, never from bars). ``None`` for INDUSTRY (not
    offered for alerts) or when the resolution itself fails."""
    requested = rs_benchmark_of(params)
    if requested in rs_benchmarks.LITERAL_BENCHMARKS:
        return requested
    if requested != "SECTOR":
        return None
    try:
        res = rs_benchmarks.resolve_benchmark(sym, requested, "D", 1,
                                              fetch_bars=lambda *_a: [])
    except Exception:  # noqa: BLE001 - a door check never raises for a lookup
        return None
    name = str(res.get("resolved") or "").upper()
    return name or None


def self_benchmark_refusal(address: Optional[str], sym: Optional[str],
                           params: Optional[Mapping]) -> Optional[str]:
    """The member sentence when this RS alert would measure ``sym`` against
    itself, else ``None``. Only the benchmark-reading addresses ask (the rating
    reads no benchmark)."""
    if address not in _ALL_SPECS or not sym:
        return None
    symbol = str(sym).strip().upper()
    name = resolved_benchmark_name(symbol, params)
    if name is None or name != symbol:
        return None
    requested = rs_benchmark_of(params)
    how = f"the {requested} benchmark resolves to {symbol}" if requested != symbol else f"the benchmark is {symbol}"
    return (f"This alert would measure the symbol against itself: {how}. A symbol "
            f"over itself is a flat 1.0 with no new high and no cross, and the chart "
            f"blanks that line, so the alert could never fire. Pick a different benchmark.")


def benchmark_fault(address: Optional[str], sym: Optional[str], tf: Any,
                    params: Optional[Mapping], bars: Sequence[Mapping]) -> Optional[str]:
    """Why this RS alert's benchmark blanks its column for good, or ``None``:
    it resolves to the symbol itself, or it has no stored bars. Read through the
    current pass (one read per pass) or a default one. Never raises."""
    if address not in _ALL_SPECS or not sym or not bars:
        return None
    try:
        code = normalize_tf(tf)
        p = current_pass() or RsPass(default_fetch_bars)
        bench = p.resolve(sym, rs_benchmark_of(params), code, benchmark_want(bars))
    except Exception:  # noqa: BLE001 - a diagnosis never raises
        return None
    resolved = str(bench.get("resolved") or rs_benchmark_of(params)).upper()
    symbol = str(sym).upper()
    if resolved == symbol:
        return (f"the benchmark {resolved} resolves to the symbol itself, so the RS "
                f"line is blank on every bar and this alert can never fire")
    if not bench.get("bars"):
        return (f"no stored bars for the benchmark {resolved} on this timeframe, so "
                f"the RS line is blank on every bar and this alert cannot fire")
    return None


# ─── 2026-11-07 (RS 2b-06): the rating — read from the side table, not computed ──

def _session_ymd(session: Any) -> Optional[int]:
    """``"2026-01-22"`` (the table's session key, `rs_history.session_key`) →
    ``20260122``, the daily bar's ``t`` shape; ``None`` for anything else."""
    digits = str(session or "").strip().replace("-", "")[:8]
    if len(digits) != 8 or not digits.isdigit():
        return None
    return int(digits)


def _bar_ymd(bar: Mapping) -> Optional[int]:
    """A daily bar's calendar ``t`` (``YYYYMMDD`` int, what `bars_sqlite` stores
    for D), or ``None`` for an instant encoding — which is never aligned to a
    session by guesswork."""
    try:
        t = int(bar.get("t"))
    except (TypeError, ValueError, AttributeError):
        return None
    return t if 10_000_000 <= t < 100_000_000 else None


def build_rs_rating_series(bars: Sequence[Mapping], rows: Sequence[Mapping]) -> Series:
    """The rating column: for each bar, the stored ``ibd`` of the row whose
    session IS the bar's date — an int 1–99 — or ``None``.

    Pure. The join is by calendar date and exact: a session with no stored row
    is ``None`` (never forward-filled from the session before, never
    back-filled from the one after), and an unrated row (``ibd`` NULL — fewer
    than 64 closes that night) is ``None`` too. ``rows`` is `ticker_history`'s
    shape, newest first; order does not matter here.
    """
    by_day: dict[int, Optional[int]] = {}
    for row in rows or ():
        day = _session_ymd(row.get("session"))
        if day is None or day in by_day:
            continue
        ibd = row.get("ibd")
        by_day[day] = None if ibd is None else int(ibd)
    out: Series = []
    for bar in bars:
        day = _bar_ymd(bar)
        out.append(by_day.get(day) if day is not None else None)
    return out


def _rs_rating_column() -> Callable[..., Series]:
    """The SERIES function for `rs_line.rating` — the same call shape as the
    eleven (`_rs_column`), reading the pass's rating memo instead of a benchmark.
    """
    address = RS_RATING_ADDRESS

    def fn(bars: list, params: Mapping, tf: Optional[str] = None, sym: Optional[str] = None) -> Series:
        n = len(bars)
        if tf is None or not sym:
            # The forming lane, a right-hand operand, a probe without a symbol:
            # no symbol names no row, so no value — never a guessed one.
            return [None] * n
        code = normalize_tf(tf)
        if code not in RS_RATING_TFS:
            raise RsTimeframeRefused(tf, address)
        if n == 0:
            return []
        p = current_pass() or RsPass(default_fetch_bars)
        return build_rs_rating_series(bars, p.ratings(sym, n + RATING_READ_PAD))

    fn.__name__ = "_series_rs_rating"
    fn.inputs = {}                                                      # type: ignore[attr-defined]
    fn.input_options = {}                                               # type: ignore[attr-defined]
    fn.instance_defs = ["rsLine"]                                       # type: ignore[attr-defined]
    # No knobs: nothing to refuse, nothing to respell. A knob this address does
    # not read passes through, the house rule (`normalize_rs_params`).
    fn.validate = lambda params, condition=None: None                   # type: ignore[attr-defined]
    fn.normalize = lambda params: dict(params or {})                    # type: ignore[attr-defined]
    fn.lookback = lambda params: 0                                      # type: ignore[attr-defined]
    # The instance IS the plot — no suffix. `instance_label` prints the label
    # alone for an empty RS suffix rather than "RS rating (IBD-style) ()".
    fn.describe = lambda params: ""                                     # type: ignore[attr-defined]
    fn.reads_benchmark = True      # the (tf, sym) CALL SHAPE `call_series` routes on — see the module docstring
    fn.reads_rating = True         # what it actually reads: the `rs_rating_history` side table
    fn.timeframes = RS_RATING_TFS                                       # type: ignore[attr-defined]
    fn.rs_column = "ibd"                                                # type: ignore[attr-defined]
    fn.rs_kind = "rating"                                               # type: ignore[attr-defined]
    return fn


#: ⭐ THE ENTRIES `register_rs_series` APPENDS to `alert_series.SERIES_FUNCS`, in catalog order:
#: the eleven compute-backed addresses, then (2026-11-07, RS 2b-06) the rating, LAST.
#: 2026-11-10 (RS split, lane S2): the four split addresses are appended AFTER the
#: rating, so every pre-existing address keeps its position in the table (the
#: dropdown order and `all_addresses()[32:44]` do not move).
RS_SERIES: dict[str, Callable[..., Series]] = {
    **{a: _rs_column(a) for a in RS_ADDRESS_SPECS},
    RS_RATING_ADDRESS: _rs_rating_column(),
    **{a: _rs_column(a) for a in RS_SPLIT_SPECS},
}
RS_ADDRESSES: tuple[str, ...] = tuple(RS_SERIES)


# ─── registration: explicit, idempotent, never at import ────────────────────

def register_rs_series(series_funcs: Optional[dict] = None) -> tuple[str, ...]:
    """Append `RS_SERIES` to `alert_series.SERIES_FUNCS` (or to ``series_funcs``),
    AFTER every entry already there, and return the addresses THIS call added
    (``()`` when every one was present: idempotent, and an entry already in the
    table — a test's stub included — is left exactly as it is).

    ⛔ NOT CALLED AT IMPORT, by design (module docstring): the evaluator's
    derived tables and `alert_catalog()`'s `ALERT_CONDITIONS[address]` make an
    unregistered-but-present address a live `KeyError`. Unit 2b-05 calls this
    where it declares the partition, conditions, labels and decimals, so the
    addresses and their rows land in one place.
    """
    if series_funcs is None:
        from api.services import alert_series
        series_funcs = alert_series.SERIES_FUNCS
    added = []
    for address, fn in RS_SERIES.items():
        if address not in series_funcs:
            series_funcs[address] = fn
            added.append(address)
    return tuple(added)


def unregister_rs_series(series_funcs: Optional[dict] = None) -> tuple[str, ...]:
    """The inverse, for a fixture's teardown: remove the RS entries that are this
    module's own functions and return the addresses removed. An address bound
    to something else (a stub) is left alone."""
    if series_funcs is None:
        from api.services import alert_series
        series_funcs = alert_series.SERIES_FUNCS
    removed = []
    for address, fn in RS_SERIES.items():
        if series_funcs.get(address) is fn:
            del series_funcs[address]
            removed.append(address)
    return tuple(removed)
