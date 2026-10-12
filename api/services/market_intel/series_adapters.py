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
            "domain": m.get("domain"), "category": "market breadth", "alignment": "session"}, None


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
    "bb_pct_b": ("{sym} Bollinger %B ({n}, 2σ)", "percent_b", DOMAIN_ANY, (5, 200)),
    "macd_hist": ("{sym} MACD histogram (12, 26, 9)", "price_units", DOMAIN_ANY, None),
}


def _tech_describe(spec: dict) -> tuple[Optional[dict], Optional[dict]]:
    sym = _pr.normalize_symbol(spec.get("symbol"))
    ind = spec.get("indicator")
    n = spec.get("period")
    if not sym:
        return None, _refused("bad_symbol", "That isn't a valid ticker symbol.")
    if ind not in _TECH:
        return None, _refused("unknown_indicator", f"Technical studies support {', '.join(_TECH)}.")
    bounds = _TECH[ind][3]
    if bounds is None:
        if n is not None:
            return None, _refused("bad_period", "MACD uses the standard 12/26/9 settings; leave the period out.")
    elif not isinstance(n, int) or isinstance(n, bool) or not bounds[0] <= n <= bounds[1]:
        return None, _refused("bad_period", f"The period must be a whole number from {bounds[0]} to {bounds[1]}.")
    tmpl, unit, dom, _b = _TECH[ind]
    return {"kind": "technical", "symbol": sym, "indicator": ind, "period": n,
            "label": tmpl.format(sym=sym, n=n), "unit": unit, "domain": dom, "category": "technical",
            "alignment": "session"}, None


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
    elif spec["indicator"] == "bb_pct_b":
        up, _mid, lo = ic.compute_bb_raw(closes, n, 2.0)
        vals = [None if (u is None or l is None or u == l) else (c - l) / (u - l) * 100.0
                for c, u, l in zip(closes, up, lo)]
    elif spec["indicator"] == "macd_hist":
        _m, _s, vals = ic.compute_macd_raw(closes, 12, 26, 9)
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
            "category": "positioning (CFTC COT, legacy futures-only)", "alignment": "as_of"}, None


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


# ── economic (the econ service's own vintages; point-in-time by first availability) ─

def _econ_describe(spec: dict) -> tuple[Optional[dict], Optional[dict]]:
    """Pure: the econ registry's own member gate (`publish.resolve` + `publish.servable`, which
    re-checks `licensing.production_eligible`) and member-safe meta (`publish.meta_for`)."""
    from api.services.econ import publish as _P
    entry = _P.resolve(str(spec.get("symbol") or "").strip())
    ok, why = _P.servable(entry)
    if not ok:
        return None, _refused("unknown_series", "That economic series isn't available for studies.", why=why)
    meta = _P.meta_for(entry)
    units = (meta.get("units") or {}).get("display") or ""
    return {"kind": "econ", "symbol": entry["symbol"], "pit_safe_only": bool(spec.get("pit_safe_only", False)),
            "label": meta["name"] + (f" ({units})" if units else ""), "unit": "econ", "domain": DOMAIN_ANY,
            "category": f"economic ({meta.get('frequency')}, {(meta.get('source') or {}).get('agency')})", "alignment": "as_of",
            "max_age_days": meta.get("max_age_days")}, None


def _econ_vintage_rows(symbol: str) -> tuple[Optional[list], Optional[dict]]:
    """Every stored vintage [[ps, pe, t_unix, v, pit, release_id], …] through the econ SERVING source,
    WITHOUT the network: `db` (ECON_DB_PATH read-only) or `local` (ECON_ARTIFACT_DIR). The production
    default `r2` is a cloud read this research path is not authorized to make — refused, never fetched."""
    from api.services.econ import publish as _P, serving as _S
    mode = _S.mode()
    if mode == "db":
        st = _S._open_db()
        try:
            return _P.build_vintages_payload(st, symbol)["rows"], None
        finally:
            st.close()
    if mode == "local":
        doc = _S._artifact(_P.vintages_key(symbol))
        if not isinstance(doc, dict) or doc.get("symbol") != symbol:
            return None, {"status": "unavailable", "reason": "not_published",
                          "detail": "No local economic vintages are published for that series."}
        return doc.get("rows") or [], None
    return None, {"status": "unavailable", "reason": "econ_source_not_local",
                  "detail": "Economic history is read here only from a LOCAL source (ECON_SERVING_SOURCE=db or "
                            "local). The production source (R2) is a cloud read this research path is not "
                            "authorized to make."}


def session_of(t_unix: int) -> str:
    """The first trading session whose CLOSE comes at or after `t_unix`: a release at 08:30 ET is
    known by that day's close; one after the close (or on a holiday) belongs to the next session."""
    from datetime import datetime, timezone, timedelta
    from api.services import session_calendar as _sc
    # epoch arithmetic, not fromtimestamp: Windows rejects pre-1970 (negative) timestamps, and
    # economic history starts in 1913
    ts = (datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(seconds=int(t_unix))).astimezone(_sc.ET)
    d = ts.date()
    for _ in range(15):
        close = _sc.close_time(d)
        if close is not None and ts <= close:
            return d.isoformat()
        d += timedelta(days=1)
    return d.isoformat()


def econ_pit_rows(vrows: list, pit_safe_only: bool = False) -> tuple[list, dict]:
    """Vintages → the value KNOWN at each availability instant: the LATEST period released so far,
    at its latest vintage available by then. One row per change, dated by `session_of`.
    Returns (rows, profile) where profile counts the PIT classes behind the rows used."""
    from collections import Counter
    vs = [r for r in vrows if r[3] is not None and (not pit_safe_only or r[4] in ("V", "U"))]
    vs.sort(key=lambda r: (r[2], r[5]))
    best: dict[str, list] = {}          # period → latest vintage seen so far
    out, prof, last_key = [], Counter(), None
    for r in vs:
        ps = r[0]
        b = best.get(ps)
        if b is None or (r[2], r[5]) > (b[2], b[5]):
            best[ps] = r
        latest_ps = max(best)                         # the newest PERIOD known at this instant
        lr = best[latest_ps]
        key = (latest_ps, lr[3])
        if key != last_key:
            d = session_of(r[2])
            if out and out[-1][0] == d:
                out[-1] = (d, float(lr[3]))           # same session: the close knows the last value
            else:
                out.append((d, float(lr[3])))
            prof[lr[4]] += 1
            last_key = key
    return out, dict(prof)


def _econ_load(spec: dict) -> dict:
    vrows, err = _econ_vintage_rows(spec["symbol"])
    if err:
        return err
    rows, prof = econ_pit_rows(vrows, spec.get("pit_safe_only", False))
    if not rows:
        return {"status": "unavailable", "reason": "no_data", "detail": "No usable economic history for that series."}
    notes = []
    if prof.get("L") or prof.get("X"):
        notes.append(f"{prof.get('L', 0) + prof.get('X', 0)} of {sum(prof.values())} release values are from "
                     "backfilled history (class L/X): their release DATES are rule-based and late-side, but their "
                     "VALUES may include later revisions that were not known at the time.")
    return {"status": "ok", "alignment": "as_of", "rows": rows,
            "max_staleness_days": spec.get("max_age_days"), "pit_profile": prof, "notes": notes,
            "coverage": {"first": rows[0][0], "last": rows[-1][0],
                         "basis": "each value dated by the session that first knew it (release time → session close)"},
            "source": {"interface": "econ.publish.build_vintages_payload via econ.serving (db/local mode)"}}


# ── fundamentals (SEC XBRL point-in-time, V4/V5 serving) ────────────────────

#: A quarterly value stays the known value until the next filing; a 10-K can arrive ~90 days after
#: year end on top of the quarter itself, so beyond this it is treated as stale (a gap).
FUNDAMENTAL_MAX_STALENESS_DAYS = 200


def _fund_describe(spec: dict) -> tuple[Optional[dict], Optional[dict]]:
    """Pure: the fundamentals catalog. ⛔ Honours the catalog's own `formula_eligible` gate — PIT
    fundamentals are "V1: chart-only; formulas/conditions/alerts later", so a metric is usable as a
    research CONDITION only once its owner marks it eligible."""
    from api.services.fundamentals_pit import catalog as _C
    sym = _pr.normalize_symbol(spec.get("symbol"))
    metric = spec.get("metric")
    if not sym:
        return None, _refused("bad_symbol", "That isn't a valid ticker symbol.")
    m = _C.by_id().get(metric)
    if m is None or not m.series or m.series not in _C.stored_series_ids():
        return None, _refused("unknown_series", "That fundamental metric isn't available for studies.")
    if not m.formula_eligible:
        return None, _refused("not_condition_eligible",
                              f"{m.name} is chart-only today: the fundamentals catalog does not yet allow it "
                              "as a condition (formula_eligible). Its owner must enable that first.")
    return {"kind": "fundamental", "symbol": sym, "metric": metric, "series_id": m.series,
            "label": f"{sym} {m.name}", "unit": m.unit, "domain": DOMAIN_ANY,
            "category": f"fundamentals (SEC XBRL, {m.cadence}, point-in-time)", "alignment": "as_of"}, None


def _fund_load(spec: dict) -> dict:
    """`fundamentals_pit.serving.series_response` — the member read path — in its LOCAL modes only
    (`db` = FUNDAMENTALS_PIT_DB_PATH, `local` = FUNDAMENTALS_PIT_ARTIFACT_DIR). The production `r2`
    source is a cloud read this research path is not authorized to make: refused, never fetched.
    Points are `[t_eff_unix, v|None, period_end(, 'gap')]`, `t_eff` = when the filing became public."""
    from api.services.fundamentals_pit import serving as _F
    if _F._mode() not in ("db", "local"):
        return {"status": "unavailable", "reason": "fundamentals_source_not_local",
                "detail": "Fundamentals history is read here only from a LOCAL source (FUNDAMENTALS_PIT_SOURCE="
                          "db or local). The production source (R2) is a cloud read this path may not make."}
    status, body, _tag = _F.series_response(spec["symbol"], [spec["series_id"]])
    if status != 200:
        return {"status": "unavailable", "reason": "no_data",
                "detail": f"No point-in-time fundamentals for {spec['symbol']}."}
    pts = (body.get("metrics") or {}).get(spec["series_id"]) or []
    rows: list = []
    for p in pts:
        d = session_of(int(p[0]))
        v = None if (len(p) > 1 and p[1] is None) else float(p[1])   # a gap stays a gap — never a number
        if rows and rows[-1][0] == d:
            rows[-1] = (d, v)
        else:
            rows.append((d, v))
    if not any(v is not None for _, v in rows):
        return {"status": "unavailable", "reason": "no_data", "detail": "No usable values for that metric."}
    notes = []
    if body.get("withheld_split_sensitive"):
        notes.append("Some per-share values are withheld because this company's split history is unverified.")
    notes.append("Fundamental values take effect when the filing became public (10-Q/10-K), not the earlier "
                 "press release.")
    return {"status": "ok", "alignment": "as_of", "rows": rows,
            "max_staleness_days": FUNDAMENTAL_MAX_STALENESS_DAYS, "notes": notes,
            "coverage": {"first": rows[0][0], "last": rows[-1][0],
                         "basis": "each value dated by the session that first knew its filing"},
            "source": {"interface": "fundamentals_pit.serving.series_response (db/local mode)"}}


# ── market cap (Market Cap V1, point-in-time share state × close) ───────────

def _mcap_describe(spec: dict) -> tuple[Optional[dict], Optional[dict]]:
    sym = _pr.normalize_symbol(spec.get("symbol"))
    if not sym:
        return None, _refused("bad_symbol", "That isn't a valid ticker symbol.")
    return {"kind": "market_cap", "symbol": sym, "label": f"{sym} company market capitalization (USD)",
            "unit": "usd", "domain": "nonneg", "category": "market cap (point-in-time share state)",
            "alignment": "session"}, None


def _mcap_load(spec: dict) -> dict:
    """`marketcap.pit_serving.series` — the member read path, which VERIFIES the authority pointer, the
    manifest hash and the document hash before serving a value — in its LOCAL mode only
    (MCAP_PIT_LOCAL_ROOT, dev / drills). Production (`r2`, dark, no published authority) is refused."""
    from api.services.marketcap import pit_serving as _M
    if _M.mode() != "local":
        return {"status": "unavailable", "reason": "marketcap_source_not_local",
                "detail": "Market cap history is read here only from a LOCAL published root (MCAP_PIT_SOURCE=local). "
                          "Production Market Cap V1 is dark with no published authority."}
    status, body, _tag = _M.series(spec["symbol"])
    if status != 200:
        return {"status": "unavailable", "reason": "no_data" if status == 404 else "unverified",
                "detail": f"No verified market-cap history for {spec['symbol']}."}
    rows = [(str(d), float(v)) for d, v in (body.get("points") or []) if d and v is not None]
    if not rows:
        return {"status": "unavailable", "reason": "no_data", "detail": "No market-cap values."}
    notes = []
    if body.get("gaps"):
        notes.append(f"{len(body['gaps'])} reason-coded gap(s) in this company's market-cap history are left as gaps.")
    return {"status": "ok", "alignment": "session", "rows": rows, "max_staleness_days": None, "notes": notes,
            "coverage": {"first": rows[0][0], "last": rows[-1][0], "authority": body.get("build_id"),
                         "basis": "company-level, point-in-time shares × close"},
            "source": {"interface": "marketcap.pit_serving.series (local mode; verified authority)"}}


ADAPTERS = {
    "breadth": (_breadth_describe, _breadth_load),
    "technical": (_tech_describe, _tech_load),
    "cot": (_cot_describe, _cot_load),
    "econ": (_econ_describe, _econ_load),
    "fundamental": (_fund_describe, _fund_load),
    "market_cap": (_mcap_describe, _mcap_load),
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


def research_catalog() -> dict:
    """STATIC, value-free menu of what studies can use — for a future Agent capability schema/hint.
    Kinds, their spec fields and enums; never a data value. Gated kinds are listed with their gate."""
    from api.services.market_indicators import registry as _reg
    cot_markets = sorted({sid.split(":")[1] for sid in getattr(_reg, "SERIES", {})
                          if sid.startswith("COT:") and sid.count(":") == 2 and _reg.resolve(sid) is not None})
    try:
        from api.services.econ import publish as _P, registry as _R
        econ = sorted(e["symbol"] for e in _R.load_registry() if _P.servable(e)[0])
    except Exception:  # noqa: BLE001
        econ = []
    return {
        "breadth": {"fields": {"universe": list(_br.SLICE1_UNIVERSES), "metric": list(_br.SLICE1_METRICS)},
                    "guide": _br.METRIC_GUIDE},
        "technical": {"fields": {"symbol": "ticker", "indicator": list(_TECH),
                                 "period": {k: (list(v[3]) if v[3] else None) for k, v in _TECH.items()}}},
        "cot": {"fields": {"market": cot_markets, "group": list(_COT_GROUPS)}},
        "econ": {"fields": {"symbol": econ, "pit_safe_only": "bool"},
                 "gate": "local econ source only (ECON_SERVING_SOURCE=db|local); production R2 not authorized"},
        "fundamental": {"fields": {"symbol": "ticker", "metric": "fundamentals catalog id"},
                        "gate": "catalog formula_eligible (0 metrics today) + local source"},
        "market_cap": {"fields": {"symbol": "ticker"},
                       "gate": "local verified publication only (MCAP_PIT_SOURCE=local); production dark"},
    }
