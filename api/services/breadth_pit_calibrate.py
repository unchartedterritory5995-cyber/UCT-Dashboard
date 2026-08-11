"""Phase 2 CALIBRATION — the make-or-break gate.

Does the price/liquidity proxy (which we CAN compute historically) reproduce the
collector's KNOWN recent `universe_list` (which we can't, going back)? Sweep the
thresholds over recent dates, score proxy-vs-known overlap (Jaccard), and report the
best. If the best achievable overlap is high (target mean Jaccard ≥ ~0.9), the proxy
is trustworthy to apply backward; if not, Phase 2 is fundamentally limited and we keep
Phase-1 (today's-universe) history with a documented caveat.

Runs in a background thread (a whole-market grouped-daily pull per date is too heavy
for the request path). Spec §4-5.
"""
from __future__ import annotations

import statistics
import threading
import traceback
from collections import defaultdict
from datetime import date as _date, timedelta as _td

_STATE: dict = {"status": "idle"}


def _trailing_dollarvol(target_day: str, window: int, adjusted: bool = False) -> dict:
    """{ticker: median(close·volume) over up to `window` trading days ending target_day}.
    Walks calendar days back, skipping non-trading days (empty grouped result)."""
    from api.services import massive
    days = []
    d = _date.fromisoformat(target_day)
    tries = 0
    while len(days) < window and tries < window * 2 + 12:
        g = massive.get_grouped_daily_ohlcv(d.isoformat(), adjusted=adjusted)
        if g:
            days.append(g)
        d -= _td(days=1)
        tries += 1
    dv = defaultdict(list)
    for g in days:
        for t, m in g.items():
            c, v = m.get("c"), m.get("v")
            if c and v:
                dv[t].append(c * v)
    return {t: statistics.median(vals) for t, vals in dv.items() if vals}


def _build_ref_map() -> dict:
    """symbol → {type, list_date, delisted_utc, primary_exchange}. Active entries win
    over delisted on a reused symbol (calibration is on RECENT dates, where the active
    co. is right)."""
    from api.services import massive
    ref: dict = {}
    for active in (False, True):        # do active LAST so it wins on conflict
        for r in massive.list_reference_tickers(active=active):
            sym = str(r.get("ticker", "")).upper()
            if not sym:
                continue
            ref[sym] = {"type": r.get("type"), "list_date": r.get("list_date"),
                        "delisted_utc": r.get("delisted_utc"),
                        "primary_exchange": r.get("primary_exchange")}
    return ref


def _breakdown(syms, ref_map, key, top=8):
    """Top `key` (e.g. primary_exchange / type) values among `syms`, for diagnosing
    what the proxy's false-positives / misses actually are."""
    c = defaultdict(int)
    for s in syms:
        c[str((ref_map.get(s) or {}).get(key) or "?")] += 1
    return sorted(({"v": k, "n": n} for k, n in c.items()), key=lambda x: -x["n"])[:top]


def run_calibration(target_days: int = 8, vol_window: int = 20,
                    price_grid=(3.0, 5.0, 7.0),
                    dv_grid=(5e5, 1e6, 2e6, 5e6, 1e7),
                    exchanges=None) -> dict:
    """`exchanges`: optional set/list of allowed primary_exchange codes (e.g.
    {'XNYS','XNAS','XASE','ARCX','BATS'}) to drop OTC/pink names. None = no filter."""
    from api.services import breadth_monitor, massive
    from api.services import breadth_pit_universe as pit

    ref_map = _build_ref_map()
    ref_cs = sum(1 for v in ref_map.values() if v.get("type") == "CS")

    hist = breadth_monitor.get_history(target_days + 6) or []
    cand_dates = [h.get("date") for h in hist if h.get("date")][:target_days]

    per_date = []
    first_ctx = {}      # rows + actual for the first date → best-point diagnostic
    for D in cand_dates:
        try:
            items = breadth_monitor.get_drill_list(D, "universe_list") or []
        except Exception:
            items = []
        actual = {str(i.get("t")).upper() for i in items
                  if isinstance(i, dict) and i.get("t")}
        if not actual:
            continue
        gday = massive.get_grouped_daily_ohlcv(D)
        if not gday:
            continue
        dvmap = _trailing_dollarvol(D, vol_window)
        rows = {t: {"c": gday.get(t, {}).get("c"), "dv": dvmap.get(t)} for t in gday}
        grid = []
        for pm in price_grid:
            for dvm in dv_grid:
                proxy = pit.eligible(D, rows, ref_map, price_min=pm, dollarvol_min=dvm,
                                     allowed_exchanges=exchanges)
                mtr = pit.compare_universe(proxy, actual)
                mtr["price_min"], mtr["dollarvol_min"] = pm, dvm
                grid.append(mtr)
        if not first_ctx:
            first_ctx = {"date": D, "rows": rows, "actual": actual}
        per_date.append({"date": D, "actual_size": len(actual),
                         "grouped_size": len(gday), "grid": grid})

    agg = defaultdict(list)
    for pd in per_date:
        for g in pd["grid"]:
            agg[(g["price_min"], g["dollarvol_min"])].append(g)
    ranked = []
    for (pm, dvm), gs in agg.items():
        ranked.append({
            "price_min": pm, "dollarvol_min": dvm,
            "mean_jaccard": round(sum(g["jaccard"] for g in gs) / len(gs), 4),
            "mean_precision": round(sum(g["precision"] for g in gs) / len(gs), 4),
            "mean_recall": round(sum(g["recall"] for g in gs) / len(gs), 4),
            "mean_proxy_size": round(sum(g["proxy_size"] for g in gs) / len(gs)),
            "mean_actual_size": round(sum(g["actual_size"] for g in gs) / len(gs)),
            "n_dates": len(gs),
        })
    ranked.sort(key=lambda x: -x["mean_jaccard"])

    # Diagnostic: for the best threshold on the first date, what ARE the mismatched
    # names? (exchange + type of false-positives / misses → what filter to add next.)
    diag = None
    if ranked and first_ctx:
        b = ranked[0]
        proxy = pit.eligible(first_ctx["date"], first_ctx["rows"], ref_map,
                             price_min=b["price_min"], dollarvol_min=b["dollarvol_min"],
                             allowed_exchanges=exchanges)
        act = first_ctx["actual"]
        fp, miss = proxy - act, act - proxy
        diag = {
            "date": first_ctx["date"],
            "false_positives": len(fp), "misses": len(miss),
            "fp_by_exchange": _breakdown(fp, ref_map, "primary_exchange"),
            "fp_by_type": _breakdown(fp, ref_map, "type"),
            "miss_by_exchange": _breakdown(miss, ref_map, "primary_exchange"),
            "fp_sample": sorted(fp)[:15], "miss_sample": sorted(miss)[:15],
        }

    return {
        "ok": True,
        "exchanges_filter": sorted(exchanges) if exchanges else None,
        "ref_tickers": len(ref_map), "ref_common_stock": ref_cs,
        "dates_used": [pd["date"] for pd in per_date],
        "best": ranked[0] if ranked else None,
        "ranked": ranked[:10],
        "diagnostic": diag,
    }


_VSTATE: dict = {"status": "idle"}
_PCT_METRICS = ("pct_above_10sma", "pct_above_20ema", "pct_above_50sma",
                "pct_above_100sma", "pct_above_200sma")


def validate_value_impact(target_days: int = 8, vol_window: int = 20,
                          price_min: float = 3.0, dollarvol_min: float = 5e6,
                          exchanges=None) -> dict:
    """The decision number: does the proxy universe move the breadth VALUE vs the
    collector's ACTUAL universe? Computes each metric over BOTH universes with the
    SAME method (breadth_live._metrics_at_close on bars.db, same day) so the delta is
    PURELY the universe effect — not basis/method. On recent dates every proxy/
    collector name is active + in bars.db, so no historical frame is needed. If mean
    |delta| ≲ 1pt, the ~0.76-Jaccard fuzz is level-negligible → Phase 2 is safe."""
    from api.services import breadth_monitor, massive
    from api.services import breadth_live as bl
    from api.services import breadth_pit_universe as pit
    from datetime import date as _d

    ref_map = _build_ref_map()
    conn = bl._bars_conn()
    hist = breadth_monitor.get_history(target_days + 6) or []
    dates = [h.get("date") for h in hist if h.get("date")][:target_days]

    per_date = []
    for D in dates:
        try:
            items = breadth_monitor.get_drill_list(D, "universe_list") or []
        except Exception:
            items = []
        collector = {str(i.get("t")).upper() for i in items
                     if isinstance(i, dict) and i.get("t")}
        if not collector:
            continue
        gday = massive.get_grouped_daily_ohlcv(D)
        if not gday:
            continue
        dvmap = _trailing_dollarvol(D, vol_window)
        rows = {t: {"c": gday.get(t, {}).get("c"), "dv": dvmap.get(t)} for t in gday}
        proxy = pit.eligible(D, rows, ref_map, price_min, dollarvol_min,
                             allowed_exchanges=exchanges)
        if not proxy:
            continue
        try:
            D_ts = bl._ts_int(_d.fromisoformat(D))
            v_proxy = bl._metrics_at_close(conn, sorted(proxy), D_ts) or {}
            v_coll = bl._metrics_at_close(conn, sorted(collector), D_ts) or {}
        except Exception:
            continue
        # stored collector value for context (has basis/method diffs — NOT the isolate)
        stored = next((h for h in hist if h.get("date") == D), {})
        row = {"date": D, "proxy_size": len(proxy), "collector_size": len(collector),
               "deltas": {}, "proxy": {}, "collector": {}, "stored": {}}
        for m in _PCT_METRICS:
            a, b = v_proxy.get(m), v_coll.get(m)
            row["proxy"][m] = round(a, 2) if a is not None else None
            row["collector"][m] = round(b, 2) if b is not None else None
            row["stored"][m] = stored.get(m)
            if a is not None and b is not None:
                row["deltas"][m] = round(a - b, 3)
        per_date.append(row)

    agg = {}
    for m in _PCT_METRICS:
        ds = [abs(r["deltas"][m]) for r in per_date if m in r["deltas"]]
        if ds:
            agg[m] = {"mean_abs_delta": round(sum(ds) / len(ds), 3),
                      "max_abs_delta": round(max(ds), 3), "n": len(ds)}
    overall = [v["mean_abs_delta"] for v in agg.values()]
    return {
        "ok": True,
        "price_min": price_min, "dollarvol_min": dollarvol_min,
        "overall_mean_abs_delta": round(sum(overall) / len(overall), 3) if overall else None,
        "per_metric": agg,
        "per_date": per_date,
        "verdict": ("SAFE (universe fuzz is level-negligible, ≲1pt)"
                    if overall and (sum(overall) / len(overall)) <= 1.0
                    else "MATERIAL (universe change moves the level >1pt)"),
    }


def run_value_async(**kw) -> None:
    def _run():
        _VSTATE.clear(); _VSTATE.update(status="running")
        try:
            res = validate_value_impact(**kw)
            _VSTATE.clear(); _VSTATE.update(status="done", **res)
        except Exception as e:
            _VSTATE.clear(); _VSTATE.update(status="error", reason=f"{type(e).__name__}: {e}",
                                            trace=traceback.format_exc()[-900:])
    threading.Thread(target=_run, name="pit-validate", daemon=True).start()


def run_async(**kw) -> None:
    def _run():
        _STATE.clear(); _STATE.update(status="running", **{k: v for k, v in kw.items()})
        try:
            res = run_calibration(**kw)
            _STATE.clear(); _STATE.update(status="done", **res)
        except Exception as e:
            _STATE.clear(); _STATE.update(status="error", reason=f"{type(e).__name__}: {e}",
                                          trace=traceback.format_exc()[-900:])
    threading.Thread(target=_run, name="pit-calibrate", daemon=True).start()
