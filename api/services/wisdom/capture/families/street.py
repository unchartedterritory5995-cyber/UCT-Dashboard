"""D12 family "street": short interest, float and price targets — all CURRENT-ONLY at the source.

Three legs, each independent, each a named gap when it fails:

1. whole market — the street columns of ``screener_rows`` (read-only), which the
   nightly Finviz / analyst passes fill for the whole cap universe;
2. float cache — ``catalyst_metadata.ticker_metadata`` read-only (never
   ``get_metadata``, which calls yfinance and WRITES on a miss);
3. a bounded per-ticker leg — ``short_interest.get_short_interest`` (Yahoo, with
   FINRA's own ``as_of`` so an unchanged twice-monthly value is not mistaken for a
   new one) over the first PER_TICKER_MAX names of ``analyst_pass.actives()``, two
   workers, a wall-clock budget. Never the 3.7k universe.

Per-ticker price targets are NOT fetched: ``analyst_grades`` spends four FMP legs
per ticker from the budget the 02:00 analyst pass needs, and the whole-market
``pt_*`` columns plus ``wire.analyst_actions`` already carry the day's targets.
That is recorded as a named gap on every run.
"""
from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor, wait

from api.services.wisdom.capture.families._base import (
    result, ro_connect, safe_reader, session_of, table_columns, to_date,
)

FAMILY = "street"
SOURCE = "screener_rows street columns + catalyst_metadata.ticker_metadata + short_interest.get_short_interest"
STREET_COLUMNS = ("ticker", "short_float_pct", "short_ratio", "float_shares", "float_pct", "inst_pct",
                  "insider_own_pct", "analyst_consensus", "pt_target", "pt_upside_pct", "bars_asof",
                  "snapshot_date")
PER_TICKER_MAX = 40
PER_TICKER_WORKERS = 2
PER_TICKER_BUDGET_S = 120.0
PT_GAP = ("per-ticker price targets not fetched: analyst_grades spends 4 FMP legs per ticker from the "
          "budget the 02:00 analyst pass uses; whole-market pt_* columns + wire.analyst_actions carry them")


def _whole_market(gaps: dict) -> list | None:
    from api.services.screener import snapshot_db

    path = snapshot_db.get_db_path()
    if not os.path.exists(path):
        gaps["screener_columns"] = f"screener store not found at {path}"
        return None
    conn = ro_connect(path)
    try:
        have = set(table_columns(conn, "screener_rows"))
        if not have:
            gaps["screener_columns"] = "table screener_rows does not exist"
            return None
        cols = [c for c in STREET_COLUMNS if c in have]
        missing = [c for c in STREET_COLUMNS if c not in have]
        if missing:
            gaps["screener_columns_missing"] = ",".join(missing)
        quoted = ", ".join(f'"{c}"' for c in cols)
        return [dict(r) for r in conn.execute(f"SELECT {quoted} FROM screener_rows ORDER BY ticker")]
    finally:
        conn.close()


def _float_cache(gaps: dict) -> list | None:
    from api.services.catalyst import ticker_metadata

    path = ticker_metadata._DB_PATH
    if not os.path.exists(path):
        gaps["catalyst_metadata"] = f"float cache not found at {path}"
        return None
    conn = ro_connect(path)
    try:
        have = set(table_columns(conn, "ticker_metadata"))
        if not have:
            gaps["catalyst_metadata"] = "table ticker_metadata does not exist"
            return None
        cols = [c for c in ("ticker", "float_shares", "shares_outstanding", "market_cap", "fetched_at") if c in have]
        quoted = ", ".join(f'"{c}"' for c in cols)
        return [dict(r) for r in conn.execute(f"SELECT {quoted} FROM ticker_metadata ORDER BY ticker")]
    finally:
        conn.close()


def _active_tickers(gaps: dict) -> list[str]:
    from api.services.screener import analyst_pass

    failures: dict = {}
    names = sorted(str(s).upper() for s in analyst_pass.actives(failures) if s)
    if failures:
        gaps["actives_legs"] = "; ".join(f"{k}: {v}" for k, v in sorted(failures.items()))[:500]
    if len(names) > PER_TICKER_MAX:
        gaps["active_set_capped"] = f"{len(names)} actives, per-ticker leg bounded to the first {PER_TICKER_MAX}"
    return names[:PER_TICKER_MAX]


def _short_interest(tickers: list[str], gaps: dict) -> dict:
    from api.services import short_interest

    out: dict = {}
    if not tickers:
        return out
    pool = ThreadPoolExecutor(max_workers=PER_TICKER_WORKERS, thread_name_prefix="wisdom-street")
    try:
        futures = {pool.submit(short_interest.get_short_interest, sym): sym for sym in tickers}
        done, pending = wait(futures, timeout=PER_TICKER_BUDGET_S)
        for fut in done:
            sym = futures[fut]
            try:
                out[sym] = fut.result()
            except Exception as exc:  # noqa: BLE001
                out[sym] = {"ticker": sym, "error": f"{type(exc).__name__}: {exc}"[:200]}
        if pending:
            gaps["short_interest_budget"] = (f"{len(pending)} of {len(tickers)} tickers unfinished after "
                                             f"{int(PER_TICKER_BUDGET_S)} s; not captured")
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    errors = sorted(s for s, v in out.items() if isinstance(v, dict) and v.get("error"))
    if errors:
        gaps["short_interest_errors"] = f"{len(errors)} tickers: {','.join(errors[:20])}"
    return dict(sorted(out.items()))


@safe_reader(FAMILY, SOURCE)
def read(*, as_of=None, now_et, state=None, **_) -> dict:
    session = to_date(as_of) or session_of(now_et)
    gaps: dict = {"price_targets_per_ticker": PT_GAP}
    legs = {}
    for name, fn in (("screener_columns", _whole_market), ("catalyst_metadata", _float_cache)):
        try:
            legs[name] = fn(gaps)
        except Exception as exc:  # noqa: BLE001 — one leg must not sink the others
            gaps[name] = f"{type(exc).__name__}: {exc}"[:300]
            legs[name] = None
    try:
        tickers = _active_tickers(gaps)
        legs["short_interest"] = _short_interest(tickers, gaps)
    except Exception as exc:  # noqa: BLE001
        gaps["short_interest"] = f"{type(exc).__name__}: {exc}"[:300]
        legs["short_interest"] = None
    if all(v is None for v in legs.values()):
        return result(FAMILY, as_of=session, source=SOURCE, rows=None, payload=None, gaps=gaps)
    rows = len(legs["screener_columns"] or []) or len(legs["catalyst_metadata"] or []) or len(legs["short_interest"] or {})
    meta = {"legs": {k: (None if v is None else len(v)) for k, v in legs.items()}}
    return result(FAMILY, as_of=session, source=SOURCE, rows=rows, payload=legs, gaps=gaps, meta=meta)
