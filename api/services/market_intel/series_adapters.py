"""Condition-series adapters for the historical research core (Slice 2).

The event-study core (`event_study.py`) is data-category-INDEPENDENT: it consumes one normalized
condition series and one outcome price series. Each adapter here turns an EXISTING UCT series
interface into that normalized form — nothing is fetched from a provider, stored, or re-derived
that UCT does not already compute.

Normalized series:
  {"status": "ok", "category", "label", "unit", "domain",
   "alignment": "session" | "as_of",
   "rows": [(YYYY-MM-DD, value), …] ascending,
   "coverage": {"first", "last", …}, "source": {…},
   "max_staleness_days": int | None}

  • alignment "session": one value per trading session, dated by that session (breadth, technicals).
    A session with no value is a GAP.
  • alignment "as_of": each row is dated by the day the value became PUBLIC; on any later session the
    known value is the latest published one (a step). This is how a point-in-time series (weekly
    COT, filings, economic releases) is aligned to trading sessions without look-ahead. A value older
    than `max_staleness_days` is treated as a gap rather than carried forward indefinitely.

`describe(spec)` is PURE (static metadata for validation; reads nothing). `load(spec)` reads.
⛔ LOCAL ONLY — values never reach a model (LOCAL-RESULT-BOUNDARY-CONTRACT.md).
"""
from __future__ import annotations

from typing import Any, Optional

from api.services import breadth_metrics as _bm
from api.services import breadth_universes as _bu
from api.services.market_intel import breadth_reads as _br
from api.services.market_intel import price_reads as _pr

DOMAIN_ANY = "any"


def _refused(reason: str, detail: str, **extra) -> dict:
    return {"status": "refused", "reason": reason, "detail": detail, **extra}


# ── breadth (Slice 1 finalized series) ───────────────────────────────────────

def _breadth_describe(spec: dict) -> tuple[Optional[dict], Optional[dict]]:
    universe = str(spec.get("universe") or "").strip().lower()
    metric = spec.get("metric")
    if universe not in _br.SLICE1_UNIVERSES:
        return None, _refused("unsupported_universe", "Breadth studies cover US, NYSE and Nasdaq only.")
    if metric not in _br.SLICE1_METRICS:
        return None, _refused("unknown_metric", "That breadth measure isn't available for studies.")
    m = _bm.get(metric) or {}
    return {"kind": "breadth", "universe": universe, "metric": metric,
            "label": f"{_bu.label(universe)} · {m.get('name')}", "unit": m.get("unit"),
            "domain": m.get("domain"), "category": "market breadth"}, None


def _breadth_load(spec: dict) -> dict:
    s = _br.sealed_series(spec["universe"], spec["metric"])
    if s.get("status") != "ok":
        return s
    return {"status": "ok", "alignment": "session", "rows": s["rows"], "max_staleness_days": None,
            "coverage": {"first": s["rows"][0][0], "last": s["rows"][-1][0],
                         "authority": s["coverage"].get("authority"), "basis": "finalized end-of-day"},
            "source": {"interface": "breadth_reads.sealed_series → breadth_symbols.build_breadth_bars",
                       "universe_description": _bu.DESCRIPTIONS.get(spec["universe"])}}


# ── technical (existing indicator calculations over the stored price history) ─

_TECH = {
    # indicator: (label template, unit, domain, period bounds)
    "rsi": ("{sym} RSI({n})", "index", _bm.DOMAIN_PCT, (2, 200)),
    "pct_from_sma": ("{sym} % from its {n}-day SMA", "percent_change", "signed", (2, 400)),
}


def _tech_describe(spec: dict) -> tuple[Optional[dict], Optional[dict]]:
    sym = _pr.normalize_symbol(spec.get("symbol"))
    ind = spec.get("indicator")
    n = spec.get("period")
    if not sym:
        return None, _refused("bad_symbol", "That isn't a valid ticker symbol.")
    if ind not in _TECH:
        return None, _refused("unknown_indicator", "Technical studies support rsi and pct_from_sma.")
    lo, hi = _TECH[ind][3]
    if not isinstance(n, int) or isinstance(n, bool) or not lo <= n <= hi:
        return None, _refused("bad_period", f"The period must be a whole number from {lo} to {hi}.")
    tmpl, unit, dom, _b = _TECH[ind]
    return {"kind": "technical", "symbol": sym, "indicator": ind, "period": n,
            "label": tmpl.format(sym=sym, n=n), "unit": unit, "domain": dom, "category": "technical"}, None


def _tech_load(spec: dict) -> dict:
    """The indicator computed by the SAME functions the alert evaluator uses (`indicator_compute`,
    unrounded `_raw` lane where it exists) over the stored daily closes. No new calculation."""
    from api.services import indicator_compute as ic
    ps = _pr.daily_closes(spec["symbol"])
    if ps.get("status") != "ok":
        return ps
    dates = [d for d, _ in ps["closes"]]
    closes = [c for _, c in ps["closes"]]
    n = spec["period"]
    if spec["indicator"] == "rsi":
        vals = ic.compute_rsi_raw(closes, n)
    else:
        sma = ic.compute_sma(closes, n)
        vals = [None if (s is None or s == 0) else (c / s - 1.0) * 100.0 for c, s in zip(closes, sma)]
    rows = [(d, float(v)) for d, v in zip(dates, vals) if v is not None]
    if not rows:
        return {"status": "unavailable", "reason": "not_enough_history",
                "detail": f"{spec['symbol']} has too little stored history for that period."}
    return {"status": "ok", "alignment": "session", "rows": rows, "max_staleness_days": None,
            "coverage": {"first": rows[0][0], "last": rows[-1][0], "basis": ps.get("basis")},
            "source": {"interface": "indicator_compute over price_reads.daily_closes (read-only store)"}}


# ── COT (CFTC Commitments of Traders, via the Market Indicators registry) ────

_COT_GROUPS = {"large_spec": "LARGE", "commercial": "COMM", "small_spec": "SMALL"}
#: Weekly reports; a normal gap is 7 days, a holiday week ~10. Longer (a shutdown lapse) is a GAP —
#: a stale report is never carried forward as if it were current.
COT_MAX_STALENESS_DAYS = 14


def _cot_describe(spec: dict) -> tuple[Optional[dict], Optional[dict]]:
    """Pure: a registry dict lookup (`registry.resolve` — the chart's own membership authority)."""
    from api.services.market_indicators import registry as _reg
    market = str(spec.get("market") or "").strip().upper()
    group = spec.get("group")
    if group not in _COT_GROUPS or not market:
        return None, _refused("unknown_series", "COT studies need a futures market (e.g. GC) and a group: "
                                                "large_spec, commercial or small_spec.")
    row = _reg.resolve(f"COT:{market}:{_COT_GROUPS[group]}")
    if row is None:
        return None, _refused("unknown_series", f"There is no published COT series for {market}.")
    return {"kind": "cot", "market": market, "group": group, "series_id": row.id,
            "label": f"{row.display} (net contracts)", "unit": "count", "domain": "signed",
            "category": "positioning (CFTC COT, legacy futures-only)"}, None


def _cot_load(spec: dict) -> dict:
    """`market_indicators.series.cot_observations` — a pure read of the local cot.db, every row dated
    by its PUBLIC day (`cot_release.available_day`), never the as-of Tuesday. No refresh is triggered
    (`cot_service.get_status`, which can, is never called)."""
    from api.services.market_indicators import registry as _reg, series as _ser
    row = _reg.resolve(spec["series_id"])
    obs = _ser.cot_observations(row) if row is not None else []
    rows = sorted((o["t"], float(o["v"])) for o in obs if o.get("t") and o.get("v") is not None)
    if not rows:
        return {"status": "unavailable", "reason": "read_failed", "detail": "The COT history isn't available."}
    return {"status": "ok", "alignment": "as_of", "rows": rows, "max_staleness_days": COT_MAX_STALENESS_DAYS,
            "coverage": {"first": rows[0][0], "last": rows[-1][0],
                         "basis": "weekly, dated by CFTC public release (point-in-time)"},
            "source": {"interface": "market_indicators.series.cot_observations → cot_service (local cot.db)",
                       "licensing": getattr(row, "licensing", None)}}


ADAPTERS = {
    "breadth": (_breadth_describe, _breadth_load),
    "technical": (_tech_describe, _tech_load),
    "cot": (_cot_describe, _cot_load),
}


def describe(spec: Any) -> tuple[Optional[dict], Optional[dict]]:
    """Pure: validate a series spec and return its static metadata. Reads nothing."""
    if not isinstance(spec, dict) or spec.get("kind") not in ADAPTERS:
        return None, _refused("unknown_series", f"Studies support these series kinds: {', '.join(ADAPTERS)}.")
    return ADAPTERS[spec["kind"]][0](spec)


def load(spec: dict) -> dict:
    """Read a DESCRIBED spec into the normalized series. Never raises."""
    try:
        out = ADAPTERS[spec["kind"]][1](spec)
    except Exception:
        return {"status": "unavailable", "reason": "read_failed", "detail": "The series could not be read."}
    if out.get("status") == "ok":
        out = {**spec, **out}
    return out


def threshold_ok(domain: Optional[str], v: float) -> bool:
    if domain == _bm.DOMAIN_PCT:
        return 0.0 <= v <= 100.0
    if domain in (_bm.DOMAIN_NONNEG, _bm.DOMAIN_RATIO):
        return v >= 0
    return True
