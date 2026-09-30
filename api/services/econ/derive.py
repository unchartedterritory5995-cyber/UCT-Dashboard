"""Deterministic derived series with point-in-time-correct vintages.

THE RULE (design doc "Time + PIT rules"):
  value of derived period p at time T  = f(inputs AS-OF T)
  vintage change points                = union of the vintage times of the input
                                         CELLS p depends on
  available_at                         = max(available_at of the input vintages USED)
  pit_class                            = model.weakest(classes of the vintages used)
  inputs                               = compact JSON [[series, period_start, release_id], ...]
  available_method                     = 'derived:<op>@<version>'

So a parent revision produces a NEW derived vintage at the revision time and
the prior derived vintage stays (the store is append-only). A derived value can
never be available before its latest input: `_check_no_leak` refuses to emit
one, and `audit_derived` re-proves it from the stored rows.

OPS (spec.derivation = {op, inputs:[symbols], params:{}, version:int})
  yoy_pct            (x_t / x_{t-L} - 1) * 100, L = 12 (M) | 4 (Q) | 52 (W) | 1 (A)
  mom_pct            1-period % change
  pct_change         params.n-period % change
  diff               x_t - x_{t-n}  (params.n, default 1)
  spread   (a, b)    a_t - b_t on matching periods
  sub      (a, b..)  a_t - b_t - c_t ...
  ratio_pct / ratio  a_t / b_t * params.scale (default 100)
  sma                mean of the last params.n periods
  sum                sum of the last params.n periods
Input transform (params.transforms = {symbol: 'eop_q'} or params.transform = 'eop_q'):
  eop_q              END-OF-QUARTER sampling of a daily series: of the input's
                     periods with period_end inside the quarter, the one with
                     the latest period_end that is VISIBLE AT T (its latest
                     vintage as of T). Output periods are quarters.
Identity inputs share the derived series' frequency. Monthly/quarterly/weekly/
annual lags are CALENDAR shifts (a missing period stays missing -- it is never
bridged by the neighbour); daily lags are POSITIONAL over the input's periods.

Full precision is stored; nothing is rounded here.

IDEMPOTENCE + VERSION BUMPS: `compute_derived` rebuilds the desired vintage
timeline of every derived period from the inputs and RECONCILES it with what is
stored (whatever version wrote it): a row is emitted at time t only where the
stored as-of-t value differs from the desired one. Running twice emits nothing;
a version bump emits rows only where the new derivation disagrees. One release
per (symbol, version, available_at) -> release_key
'derived:<SYMBOL>@<version>:<available_at>'.
"""
from __future__ import annotations

import bisect
import json
import math
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Callable, Optional

from . import model, timeutil
from .model import EconError, PitClass


class DerivationError(EconError):
    """The derivation spec cannot be computed (unknown op, bad params, ...)."""


class DerivationLeak(EconError):
    """A derived value would be available BEFORE one of its inputs was."""


DERIVE_OPS = ("yoy_pct", "mom_pct", "pct_change", "diff", "spread", "sub", "ratio_pct", "ratio",
              "sma", "sum")
TRANSFORMS = ("eop_q",)
YOY_LAG = {"M": 12, "Q": 4, "W": 52, "A": 1}


def _g(obj, key, default=None):
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _val(x):
    return getattr(x, "value", x)


# ─────────────────────────────── cells ───────────────────────────────────────


@dataclass
class _Cell:
    """One input (series, period): its vintages sorted by (available_at, release_id)."""
    series: str
    period_start: str
    period_end: str
    times: list = field(default_factory=list)   # available_at, ascending
    vints: list = field(default_factory=list)   # (available_at, release_id, value, flag, pit)

    def asof(self, t):
        i = bisect.bisect_right(self.times, t)
        return self.vints[i - 1] if i else None


@dataclass
class _Input:
    symbol: str
    transform: Optional[str]
    cells: dict                                   # period_start -> _Cell
    order: list                                   # sorted period_starts
    pos: dict                                     # period_start -> index in order
    by_quarter: dict = field(default_factory=dict)   # (eop_q) quarter start -> [cells by period_end]


def _load_input(symbol: str, transform: Optional[str], rows) -> _Input:
    cells: dict[str, _Cell] = {}
    for r in rows:
        c = cells.get(r.period_start)
        if c is None:
            c = cells[r.period_start] = _Cell(symbol, r.period_start, r.period_end)
        c.times.append(int(r.available_at))
        c.vints.append((int(r.available_at), int(r.release_id), r.value, r.flag or "", r.pit_class))
    for c in cells.values():            # rows arrive sorted, but never trust that
        z = sorted(zip(c.times, c.vints), key=lambda tv: (tv[1][0], tv[1][1]))
        c.times = [t for t, _ in z]
        c.vints = [v for _, v in z]
    order = sorted(cells)
    inp = _Input(symbol, transform, cells, order, {p: i for i, p in enumerate(order)})
    if transform == "eop_q":
        for p in order:
            qs = timeutil.quarter_bounds_of(cells[p].period_end)[0].isoformat()
            inp.by_quarter.setdefault(qs, []).append(cells[p])
        for lst in inp.by_quarter.values():
            lst.sort(key=lambda c: c.period_end)
    elif transform is not None:
        raise DerivationError(f"unknown input transform {transform!r}")
    return inp


# ─────────────────────────────── spec → plan ─────────────────────────────────


@dataclass
class _Plan:
    symbol: str
    op: str
    version: int
    freq: str
    inputs: list                      # symbols
    transforms: list                  # per input: None | 'eop_q'
    terms: list                       # [(input_index, lag)]
    fn: Callable
    params: dict

    @property
    def method(self) -> str:
        return f"{model.AvailableAtMethod.DERIVED.value}:{self.op}@{self.version}"


def _pct(a, b):
    return None if b == 0 else (a / b - 1.0) * 100.0


def plan_for(spec) -> _Plan:
    d = _g(spec, "derivation")
    if not d:
        raise DerivationError(f"{_g(spec, 'symbol')}: no derivation")
    op = str(_g(d, "op", "")).strip()
    inputs = list(_g(d, "inputs", []) or [])
    params = dict(_g(d, "params", {}) or {})
    version = int(_g(d, "version", 1) or 1)
    freq = str(_val(_g(spec, "frequency", "")) or "").upper()
    if op not in DERIVE_OPS:
        raise DerivationError(f"unknown derivation op {op!r}")
    if not inputs:
        raise DerivationError(f"{op}: no inputs")
    tr_map = params.get("transforms") or {}
    tr_all = params.get("transform")
    transforms = [tr_map.get(s, tr_all) for s in inputs]
    for t in transforms:
        if t is not None and t not in TRANSFORMS:
            raise DerivationError(f"unknown input transform {t!r}")
    if any(t == "eop_q" for t in transforms) and freq != "Q":
        raise DerivationError("eop_q transform needs a quarterly derived series")

    def need(n):
        if len(inputs) != n:
            raise DerivationError(f"{op} takes {n} input(s), got {len(inputs)}")

    n = int(params.get("n", 1))
    if n < 1:
        raise DerivationError(f"{op}: n must be >= 1")
    if op == "yoy_pct":
        need(1)
        if freq not in YOY_LAG:
            raise DerivationError(f"yoy_pct undefined for frequency {freq!r}")
        L = int(params.get("lag", YOY_LAG[freq]))
        return _Plan(_g(spec, "symbol"), op, version, freq, inputs, transforms, [(0, 0), (0, L)],
                     lambda x: _pct(x[0], x[1]), params)
    if op in ("mom_pct", "pct_change"):
        need(1)
        k = 1 if op == "mom_pct" else n
        return _Plan(_g(spec, "symbol"), op, version, freq, inputs, transforms, [(0, 0), (0, k)],
                     lambda x: _pct(x[0], x[1]), params)
    if op == "diff":
        need(1)
        return _Plan(_g(spec, "symbol"), op, version, freq, inputs, transforms, [(0, 0), (0, n)],
                     lambda x: x[0] - x[1], params)
    if op == "spread":
        need(2)
        return _Plan(_g(spec, "symbol"), op, version, freq, inputs, transforms, [(0, 0), (1, 0)],
                     lambda x: x[0] - x[1], params)
    if op == "sub":
        if len(inputs) < 2:
            raise DerivationError("sub takes >= 2 inputs")
        return _Plan(_g(spec, "symbol"), op, version, freq, inputs, transforms,
                     [(i, 0) for i in range(len(inputs))], lambda x: x[0] - sum(x[1:]), params)
    if op in ("ratio_pct", "ratio"):
        need(2)
        scale = float(params.get("scale", 100.0 if op == "ratio_pct" else 1.0))
        return _Plan(_g(spec, "symbol"), op, version, freq, inputs, transforms, [(0, 0), (1, 0)],
                     lambda x: None if x[1] == 0 else x[0] / x[1] * scale, params)
    if op in ("sma", "sum"):
        need(1)
        if "n" not in params:
            raise DerivationError(f"{op} needs params.n")
        f = (lambda x: sum(x) / len(x)) if op == "sma" else (lambda x: sum(x))
        return _Plan(_g(spec, "symbol"), op, version, freq, inputs, transforms,
                     [(0, k) for k in range(n)], f, params)
    raise DerivationError(f"unhandled op {op!r}")  # pragma: no cover


# ─────────────────────────────── the engine ──────────────────────────────────


def _combine_available(times):
    """available_at of a derived vintage = the LATEST input vintage it used.
    (Module-level so the negative-control test can prove the guard catches a
    wrong combiner.)"""
    return max(times)


def _check_no_leak(symbol: str, period: str, available_at: int, used) -> None:
    latest_input = max(u[3] for u in used)
    if available_at < latest_input:
        raise DerivationLeak(
            f"{symbol} {period}: derived available_at {available_at} precedes input "
            f"available_at {latest_input}")


def _derived_periods(plan: _Plan, ins: list[_Input]) -> list[tuple[str, str]]:
    """(period_start, period_end) of every derived period, anchored on the first
    identity input (or, if every input is transformed, input 0's quarters)."""
    anchor = next((i for i, t in enumerate(plan.transforms) if t is None), None)
    if anchor is None:
        return [(qs, timeutil.quarter_bounds_of(qs)[1].isoformat()) for qs in sorted(ins[0].by_quarter)]
    a = ins[anchor]
    return [(p, a.cells[p].period_end) for p in a.order]


def _resolver(plan: _Plan, ins: list[_Input], period: str):
    """For derived period `period`, a list per term of the candidate cells, and
    whether each term is an eop selection (choose latest visible) or exact."""
    out = []
    for (i, lag) in plan.terms:
        inp = ins[i]
        if inp.transform == "eop_q":
            qs = timeutil.shift_period(period, "Q", -lag).isoformat() if lag else period
            out.append(("eop", inp.by_quarter.get(qs, [])))
            continue
        if lag == 0:
            p = period
        elif plan.freq in ("D", "IRREG"):
            j = inp.pos.get(period)
            p = inp.order[j - lag] if j is not None and j - lag >= 0 else None
        else:
            p = timeutil.shift_period(period, plan.freq, -lag).isoformat()
        c = inp.cells.get(p) if p is not None else None
        out.append(("exact", [c] if c is not None else []))
    return out


def _value_at(terms, t):
    """(values, used) of every term as of t, or None if any term is unknown at t.
    used = [(series, period_start, release_id, available_at, pit)]."""
    vals, used = [], []
    for kind, cells in terms:
        pick = None
        if kind == "exact":
            if cells:
                v = cells[0].asof(t)
                if v is not None:
                    pick = (cells[0], v)
        else:                                   # eop: latest period_end visible at t
            for c in reversed(cells):
                v = c.asof(t)
                if v is not None:
                    pick = (c, v)
                    break
        if pick is None:
            return None
        c, v = pick
        vals.append(v[2])
        used.append((c.series, c.period_start, v[1], v[0], v[4]))
    return vals, used


_UNSET = object()


def _same(a, b) -> bool:
    if a is None or b is None:
        return a is None and b is None
    return float(a) == float(b)


def _timeline(plan: _Plan, terms, symbol: str, period: str) -> list[dict]:
    """The desired vintage history of one derived period (value changes only)."""
    times = sorted({t for _, cells in terms for c in cells for t in c.times})
    out: list[dict] = []
    last: Any = _UNSET
    for t in times:
        r = _value_at(terms, t)
        if r is None:
            continue
        vals, used = r
        if any(v is None for v in vals):
            value = None
        else:
            try:
                value = plan.fn([float(v) for v in vals])
            except (ZeroDivisionError, OverflowError, ValueError):
                value = None
            if value is not None and not math.isfinite(value):
                value = None
        if last is not _UNSET and _same(value, last):
            continue
        # one entry per distinct input cell
        seen, cells = set(), []
        for u in used:
            k = (u[0], u[1], u[2])
            if k not in seen:
                seen.add(k)
                cells.append(u)
        avail = int(_combine_available([u[3] for u in cells]))
        _check_no_leak(symbol, period, avail, cells)
        out.append({
            "value": value,
            "available_at": avail,
            "pit_class": model.weakest([PitClass(u[4]) for u in cells]).value,
            "inputs": json.dumps([[u[0], u[1], u[2]] for u in cells], separators=(",", ":")),
        })
        last = value
    return out


@dataclass(frozen=True)
class DerivedRow:
    series_id: str
    period_start: str
    period_end: str
    value: Optional[float]
    flag: str
    available_at: int
    available_method: str
    pit_class: str
    inputs: str
    release_key: str


def release_key(symbol: str, version: int, available_at: int) -> str:
    return f"derived:{symbol}@{version}:{int(available_at)}"


def _reconcile(plan: _Plan, period: str, period_end: str, desired: list[dict], stored) -> list[DerivedRow]:
    """Emit rows so that the stored as-of-t timeline equals the desired one at
    every change point of either. stored = ObsRows of this period (any version)."""
    by_t_des = {d["available_at"]: d for d in desired}
    by_t_sto: dict[int, Any] = {}
    for r in sorted(stored, key=lambda r: (r.available_at, r.release_id)):
        by_t_sto[int(r.available_at)] = r       # last release at a time wins, like the store
    out: list[DerivedRow] = []
    s_cur = d_cur = None
    for t in sorted(set(by_t_des) | set(by_t_sto)):
        if t in by_t_sto:
            s_cur = (by_t_sto[t].value, by_t_sto[t].flag or "")
        if t in by_t_des:
            d_cur = by_t_des[t]
        if d_cur is None:
            continue
        want = (d_cur["value"], "")
        if s_cur is not None and _same(s_cur[0], want[0]) and s_cur[1] == want[1]:
            continue
        # correcting at a STORED change point: t >= the desired row's inputs, so no leak
        out.append(DerivedRow(plan.symbol, period, period_end, want[0], "", t, plan.method,
                              d_cur["pit_class"], d_cur["inputs"], release_key(plan.symbol, plan.version, t)))
        s_cur = want
    return out


def compute_derived(store, spec) -> list[DerivedRow]:
    """Every row that must be appended so the stored derived series equals
    f(inputs as-of T) for all T. Empty when already up to date."""
    plan = plan_for(spec)
    ins = [_load_input(s, t, store.vintages(s)) for s, t in zip(plan.inputs, plan.transforms)]
    stored_by_p: dict[str, list] = {}
    for r in store.vintages(plan.symbol):
        stored_by_p.setdefault(r.period_start, []).append(r)
    rows: list[DerivedRow] = []
    for p, pe in _derived_periods(plan, ins):
        terms = _resolver(plan, ins, p)
        desired = _timeline(plan, terms, plan.symbol, p)
        if desired or p in stored_by_p:
            rows.extend(_reconcile(plan, p, pe, desired, stored_by_p.get(p, [])))
    rows.sort(key=lambda r: (r.available_at, r.period_start))
    return rows


def write_derived(store, rows: list[DerivedRow], *, calendar_key: Optional[str] = None) -> int:
    """Append `rows` (from compute_derived) under their derived releases; one
    transaction per series. Returns the number of rows inserted."""
    by_series: dict[str, list] = {}
    for r in rows:
        by_series.setdefault(r.series_id, []).append(r)
    n = 0
    for sid, rs in by_series.items():
        with store.tx():
            rid = {}
            for r in rs:
                if r.release_key not in rid:
                    rid[r.release_key] = store.upsert_release(r.release_key, calendar_key, "derived",
                                                              scheduled_at=None, acq_id=None)
            n += store.append_vintages(sid, [
                (r.period_start, r.period_end, r.value, r.flag, r.available_at, r.available_method,
                 r.pit_class, None, r.inputs, rid[r.release_key]) for r in rs])
    return n


def derive_and_write(store, spec, *, calendar_key: Optional[str] = None) -> int:
    return write_derived(store, compute_derived(store, spec), calendar_key=calendar_key)


def audit_derived(store, symbol: str) -> list[str]:
    """Re-prove from STORED rows that no derived vintage predates its inputs:
    every recorded input cell must exist and have available_at <= the derived
    row's. Returns reasons (empty = clean)."""
    reasons: list[str] = []
    cache: dict = {}
    for r in store.vintages(symbol):
        if not r.inputs:
            reasons.append(f"{symbol} {r.period_start}@{r.available_at}: no inputs recorded")
            continue
        for s, ps, rid in json.loads(r.inputs):
            key = (s, ps)
            if key not in cache:
                cache[key] = {v.release_id: v for v in store.versions(s, ps)}
            v = cache[key].get(rid)
            if v is None:
                reasons.append(f"{symbol} {r.period_start}@{r.available_at}: input {s} {ps} r{rid} missing")
            elif v.available_at > r.available_at:
                reasons.append(f"{symbol} {r.period_start}@{r.available_at}: input {s} {ps} r{rid} "
                               f"available at {v.available_at} (LEAK)")
    return reasons


# ─────────────────────────────── pure helper ─────────────────────────────────


class _Row:  # minimal ObsRow stand-in for the pure path
    __slots__ = ("period_start", "period_end", "value", "flag", "available_at", "release_id", "pit_class")

    def __init__(self, ps, pe, v):
        self.period_start, self.period_end, self.value = ps, pe, v
        self.flag, self.available_at, self.release_id, self.pit_class = "", 0, 0, "V"


def _period_end_guess(ps: str, freq: str) -> str:
    d = timeutil.as_date(ps)
    if freq == "M":
        return timeutil.month_bounds(d.year, d.month)[1].isoformat()
    if freq == "Q":
        return timeutil.quarter_bounds_of(d)[1].isoformat()
    if freq == "A":
        return date(d.year, 12, 31).isoformat()
    if freq == "W":
        return date.fromordinal(d.toordinal() + 6).isoformat()
    return ps


def derive_latest(values_by_period: dict, *, op: str, params: Optional[dict] = None,
                  frequency: str = "M", inputs: Optional[list] = None,
                  period_ends: Optional[dict] = None) -> dict:
    """Pure: {period_start: value} of the derived series from latest-only inputs.

    values_by_period is either {period_start: value} (single input) or
    {symbol: {period_start: value}} with `inputs` naming the order. Daily/eop_q
    inputs may pass `period_ends` = {symbol: {period_start: period_end}}.
    Runs the SAME engine as compute_derived (every value one vintage at t=0).
    """
    if inputs is None:
        inputs = ["X"]
        values_by_period = {"X": values_by_period}
    spec = {"symbol": "DERIVED", "frequency": frequency,
            "derivation": {"op": op, "inputs": inputs, "params": params or {}, "version": 1}}
    plan = plan_for(spec)
    ins = []
    for sym, tr in zip(plan.inputs, plan.transforms):
        pes = (period_ends or {}).get(sym, {})
        f = "D" if tr == "eop_q" else plan.freq
        rows = [_Row(ps, pes.get(ps) or _period_end_guess(ps, f), v)
                for ps, v in sorted(values_by_period[sym].items())]
        ins.append(_load_input(sym, tr, rows))
    out = {}
    for p, _pe in _derived_periods(plan, ins):
        tl = _timeline(plan, _resolver(plan, ins, p), plan.symbol, p)
        if tl:
            out[p] = tl[-1]["value"]
    return out
