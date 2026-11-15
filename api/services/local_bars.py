"""One symbol's bars from the LOCAL store, shaped as the scan engine reads them.

The script-scan engine (`screener.scan_evaluator._read_bars`) and the alert lane's
other-symbol supply (`alert_user_series._symbol_bars`) read through this one function,
so a scan and an alert see the same bars under the same store key.

⛔ WHY ITS OWN MODULE (2026-11-15). The alert lane used to import the scan engine's
private `_read_bars`, which put `scan_evaluator` inside two member routes' reach
(`/api/indicator-alerts` and `/api/indicator-alerts/current-value`), and the request-path
census (tests/test_scan_evaluator_off_request_path.py) refused it: with the module in
reach, the universe sweep is one attribute away. A single-symbol read does no
universe-scale work, so it lives here, outside the sweep's module.
"""
from __future__ import annotations

#: The daily timeframe key, the only one whose bars carry `YYYYMMDD` dates.
DAILY_TF = "D"


def read_bars(sym: str, tf: str, want: int) -> list:
    """One symbol's bars, LOCAL. ⛔ No network, ever -- a sequential universe sweep is
    affordable only because `bars_sqlite` is a local SQLite read, exactly as
    `snapshot_builder._read_daily_bars` does it.

    DAILY BARS ARE THE CURRENT LISTING ONLY, by the same cut that reader and the chart
    apply (`listing_break.current_listing`): the store keeps a recycled or renamed
    symbol's earlier security in front of its own bars, and an average read across the
    two is a number about neither. Only the daily store carries the `YYYYMMDD` keys the
    rule reads, so every other timeframe is handed on as stored."""
    from api.services import bars_sqlite
    rows = bars_sqlite.get_bars(sym, tf, want) or []
    out = []
    for r in rows:
        try:
            out.append({"t": r[0], "o": r[1], "h": r[2], "l": r[3],
                        "c": r[4], "v": r[5]})
        except Exception:                                    # pragma: no cover
            continue
    if tf == DAILY_TF:
        from api.services import listing_break
        out = listing_break.current_listing(out)
    return out
