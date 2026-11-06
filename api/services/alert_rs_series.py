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
  ``(bars, benchmark bars, inputs)``. The bar fetcher is injected here (a test,
  the service's probe); the default is `alert_user_series._symbol_bars`, the
  scan's own local store read with its 20 s TTL.
* `RsTimeframeRefused` — the typed refusal for a timeframe this lane is not
  offered on. Plan §6.5: an RS event is a daily / weekly closed-bar fact; on an
  intraday chart the provider blanks the event columns, and an intraday ALERT on
  them is refused outright rather than armed mute.

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

import contextlib
import contextvars
import json
import math
from typing import Any, Callable, Mapping, NamedTuple, Optional, Sequence

from api.services import relative_strength as rsm
from api.services import rs_benchmarks
from api.services.signature import registry_defs

Series = list[Optional[float]]
FetchBars = Callable[[str, str, int], list]

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

#: Benchmarks an ALERT may name: the chart's menu minus INDUSTRY (engineering map
#: §2.6 "Benchmark load": a composite costs up to 60 member reads against the
#: 64-entry benchmark cache that clears wholesale; it joins when it has a cache
#: of its own). Derived from the chart's one list, never re-typed.
RS_ALERT_BENCHMARKS: tuple[str, ...] = tuple(
    b for b in registry_defs.RS_LINE_BENCHMARKS if b != "INDUSTRY")

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
_RANGES: dict[str, tuple[float, float]] = {
    "maLength": rsm.MA_LENGTH_RANGE,
    "lookback": rsm.LOOKBACK_RANGE,
    "priceTolerance": rsm.PRICE_TOLERANCE_RANGE,
    "redDayThreshold": rsm.RED_DAY_RANGE,
    "mansfieldLength": rsm.MANSFIELD_LENGTH_RANGE,
}
_INT_KEYS: tuple[str, ...] = ("maLength", "lookback", "mansfieldLength")
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


def timeframe_refusal(tf: Any, address: Optional[str] = None) -> Optional[str]:
    """Why an RS address cannot be armed on ``tf``, as a member sentence — or
    ``None`` (daily / weekly). The evaluator's create door (2b-05) prints this;
    the column raises `RsTimeframeRefused` carrying the same sentence."""
    code = normalize_tf(tf)
    if code in RS_ALERT_TFS:
        return None
    what = "UCT Relative Strength alerts"
    if code in _INTRADAY_TFS:
        return (f"{what} are judged on closed daily or weekly bars only — a "
                f"{code}-minute bar is not offered. An RS new high or cross is a "
                f"daily or weekly fact (plan §6.5: the chart blanks RS events on "
                f"intraday timeframes); arm it on D or W.")
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
    inputs: tuple[str, ...]  # the knobs this column reads (its `fn.inputs` keys)
    kind: str                # "line" (a number) | "event" ({0, 1, None}) | "state" ({0, 1, None}, a level)
    rounded: bool            # rounded to `LINE_DECIMALS` like the provider's line columns


_MA_INPUTS: tuple[str, ...] = ("benchmark", "maLength", "maType")
_NH_INPUTS: tuple[str, ...] = ("benchmark", "lookback")
_MANSFIELD_INPUTS: tuple[str, ...] = ("benchmark", "mansfieldLength")

#: ⭐ THE RS ADDRESSES, in catalog order. Names after the dot follow the house
#: convention of the other multi-plot bases (`sar.priceCrossedSar`,
#: `ichimoku.spanA`): camelCase plot names. The engineering map (§2.6) names
#: `newHigh`, `newHighBeforePrice`, `newHighRed`, `crossUp`, `crossDown` and
#: `mansfield`; `value`, `ma`, `above`, `mansfieldCrossUp` and
#: `mansfieldCrossDown` are this unit's additions (the line, its average, the
#: above-average STATE a member can hold an `above` rule on, and the two signed
#: Mansfield zero crosses beside the `cross_zero` rule on the line itself).
#: `rs_line.rating` is unit 2b-06 and is NOT here.
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


def _defaults_for(spec: RsSpec) -> dict:
    src = PHASE1_DEFAULTS if spec.family == "phase1" else MANSFIELD_DEFAULTS
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
    spec = RS_ADDRESS_SPECS[address]
    p = params or {}
    if "benchmark" in spec.inputs and p.get("benchmark") is not None:
        b = str(p["benchmark"]).strip().upper()
        if b not in RS_ALERT_BENCHMARKS:
            why = (" INDUSTRY composites are not offered for alerts yet."
                   if b == "INDUSTRY" else "")
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
    spec = RS_ADDRESS_SPECS[address]
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
    spec = RS_ADDRESS_SPECS[address]
    if spec.family == "mansfield":
        return mansfield_length(params)
    p = phase1_inputs(params)
    if "lookback" in spec.inputs:
        return int(p["lookback"])
    if "maLength" in spec.inputs:
        return int(p["maLength"]) * (EMA_PREFIX_MULT if p["maType"] == "EMA" else 1)
    return 0


def describe_rs(address: str, params: Optional[Mapping]) -> str:
    """The instance label: ``vs SPY · EMA(21)`` — the chip's grammar."""
    spec = RS_ADDRESS_SPECS[address]
    parts = [f"vs {rs_benchmark_of(params)}"]
    if spec.family == "mansfield":
        parts.append(f"SMA({mansfield_length(params)})")
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
    """A stable identity for a bar window: length and its two ends. Not ``id()``
    — a list freed between two groups can hand its address to the next one."""
    if not bars:
        return (0,)
    first, last = bars[0], bars[-1]
    return (len(bars), first.get("t"), last.get("t"), last.get("c"))


def default_fetch_bars(ticker: str, tf: str, want: int) -> list:
    """The lane's own benchmark loader: `alert_user_series._symbol_bars`, the
    scan's LOCAL store read (no network), keyed on the same ``t`` the alert's
    bars carry, with its 20 s TTL under the 60 s cycle."""
    from api.services import alert_user_series
    return alert_user_series._symbol_bars(ticker, tf, want)


class RsPass:
    """The memo of one evaluation pass (see `rs_pass`)."""

    __slots__ = ("fetch_bars", "_bench", "_resolved", "_columns", "fetch_calls", "compute_calls")

    def __init__(self, fetch_bars: FetchBars) -> None:
        self.fetch_bars = fetch_bars
        self._bench: dict[tuple, tuple[int, list]] = {}
        self._resolved: dict[tuple, dict] = {}
        self._columns: dict[tuple, dict] = {}
        self.fetch_calls = 0
        self.compute_calls = 0

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
        SECTOR / INDUSTRY depend on the symbol's group."""
        req = str(requested or rs_benchmarks.DEFAULT_BENCHMARK).upper()
        sym_key = str(sym or "").upper() if req in rs_benchmarks.AUTO_BENCHMARKS else ""
        key = (sym_key, req, str(tf), int(want))
        hit = self._resolved.get(key)
        if hit is None:
            hit = rs_benchmarks.resolve_benchmark(sym, req, tf, int(want), fetch_bars=self.fetch)
            self._resolved[key] = hit
        return hit

    def columns(self, family: str, bars: Sequence[Mapping], benchmark_bars: Sequence[Mapping],
                inputs_key: str, compute: Callable[[], dict]) -> dict:
        key = (family, _fingerprint(bars), _fingerprint(benchmark_bars), inputs_key)
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
def rs_pass(fetch_bars: Optional[FetchBars] = None):
    """One evaluation pass. Every RS column evaluated inside shares one benchmark
    read per ``(ticker, tf)`` and one compute per column family and window.

    Nested without a fetcher of its own, a pass joins the outer one (a cycle
    that wraps a group that wraps an alert still reads once). A fetcher names
    a NEW pass — the way a test or the service's probe injects its benchmark.

    ⚠️ The evaluator's cycle does not enter this yet (unit 2b-05 wraps
    `_run_one_cycle`'s group loop in it). Outside a pass each column call makes
    a pass of its own, and the store is still read once per ``(ticker, tf,
    want)`` per 20 s through `_symbol_bars`' TTL cache.
    """
    outer = _PASS.get()
    if outer is not None and fetch_bars is None:
        yield outer
        return
    p = RsPass(fetch_bars or default_fetch_bars)
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
                    params: Optional[Mapping]) -> Series:
    """One RS address → its FULL column, aligned to ``len(bars)``, ``None`` in warm-up.

    Pure apart from the pass memo: `compute_phase1_columns` /
    `compute_mansfield_columns` run once per ``(family, bars, benchmark bars,
    inputs)`` inside a pass, and the named column is picked. Line columns are
    rounded to `LINE_DECIMALS` like the provider's; event columns are the
    compute's own ``0.0 / 1.0 / None``.

    ``short_history`` is left at the compute's default (off): the partial-lookback
    dots are a chart affordance for a whole-history window and have no address.
    """
    spec = RS_ADDRESS_SPECS[address]            # an unknown address is a caller bug, like `series_for`
    n = len(bars)
    if n == 0:
        return []
    if spec.family == "phase1":
        inputs = phase1_inputs(params)
        inputs_key = json.dumps(inputs, sort_keys=True)

        def compute() -> dict:
            return rsm.compute_phase1_columns(bars, benchmark_bars, inputs)
    else:
        n_len = mansfield_length(params)
        inputs_key = str(n_len)

        def compute() -> dict:
            return rsm.compute_mansfield_columns(bars, benchmark_bars, n_len)

    p = current_pass()
    cols = p.columns(spec.family, bars, benchmark_bars, inputs_key, compute) if p else compute()
    column = list(cols[spec.column])
    if spec.rounded:
        from api.services.indicator_compute import _round_series
        column = _round_series(column, LINE_DECIMALS)
    return column


def _rs_column(address: str) -> Callable[..., Series]:
    """The SERIES function for one RS address — `alert_series._column`'s shape
    with the two extra keyword arguments the lane passes a `reads_benchmark`
    column (`alert_user_series.call_series`)."""
    spec = RS_ADDRESS_SPECS[address]

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
        bench = p.resolve(sym, rs_benchmark_of(params), code, benchmark_want(bars))
        # The provider's two blanking states (plan §6.10): a symbol against
        # itself is a flat 1.0 that would "make a new high" on every bar, and a
        # benchmark with no bars has no ratio at all.
        if not bench.get("bars") or str(bench.get("resolved") or "").upper() == str(sym).upper():
            return [None] * n
        return build_rs_series(address, bars, bench["bars"], params)

    fn.__name__ = f"_series_rs_{spec.column}"
    fn.inputs = _defaults_for(spec)                                      # type: ignore[attr-defined]
    options = {}
    if "benchmark" in spec.inputs:
        options["benchmark"] = list(RS_ALERT_BENCHMARKS)
    if "maType" in spec.inputs:
        options["maType"] = list(MA_TYPES)
    fn.input_options = options                                          # type: ignore[attr-defined]
    fn.instance_defs = ["rsLine"]                                       # type: ignore[attr-defined]
    fn.validate = lambda params, condition=None: rs_refusal(address, params, condition)  # type: ignore[attr-defined]
    fn.normalize = lambda params: normalize_rs_params(address, params)  # type: ignore[attr-defined]
    fn.lookback = lambda params: rs_lookback(address, params)           # type: ignore[attr-defined]
    fn.describe = lambda params: describe_rs(address, params)           # type: ignore[attr-defined]
    fn.reads_benchmark = True                                           # type: ignore[attr-defined]
    fn.timeframes = RS_ALERT_TFS                                        # type: ignore[attr-defined]
    fn.rs_column = spec.column                                          # type: ignore[attr-defined]
    fn.rs_kind = spec.kind                                              # type: ignore[attr-defined]
    return fn


#: ⭐ THE ENTRIES `register_rs_series` APPENDS to `alert_series.SERIES_FUNCS`, in catalog order.
RS_SERIES: dict[str, Callable[..., Series]] = {a: _rs_column(a) for a in RS_ADDRESS_SPECS}
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
