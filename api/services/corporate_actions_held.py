"""CACT: one stock's splits and cash dividends, read ONLY from what this server already holds.

The record is the chart markers blob `earnings_estimates` keeps on the volume for a stock whose
chart has been opened (`<DATA_DIR>/chart_markers/<TICKER>.json`): splits up to 45 years back and
cash dividends up to 5 years back by ex-date, both from Massive reference data. Dividend amounts
in it are split-adjusted (what the chart draws), not the amounts as declared.

Rules this module keeps:
  * it NEVER asks a vendor and never starts a build: it calls the blob reader and nothing else,
    so a stock nobody has charted answers `not_held`, in words, and stays that way until its
    chart is opened;
  * it does not change a figure: rows are passed through as held, bad rows are dropped;
  * the answer is bounded: at most `ROW_CAP` rows per kind, newest first, with the held total
    beside them so a cut is said, never silent;
  * it never raises: a blob that cannot be read is `not_held`.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

SOURCE = "massive"
ROW_CAP = 60
SPLIT_WINDOW_YEARS = 45
DIVIDEND_WINDOW_YEARS = 5

_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _read_held(ticker: str):
    """`(data, saved_at_epoch)` from the volume, or None. The ONLY read this module makes."""
    from api.services import earnings_estimates
    return earnings_estimates._markers_disk_read(ticker)


def _number(v):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return float(v) if v == v and v not in (float("inf"), float("-inf")) else None


def _split_rows(raw) -> list[dict]:
    out = []
    for r in raw if isinstance(raw, list) else []:
        if not isinstance(r, dict) or not _DAY.match(str(r.get("date") or "")):
            continue
        ratio = r.get("ratio")
        out.append({"date": r["date"], "ratio": ratio if isinstance(ratio, str) and ratio.strip() else None,
                    "to_factor": _number(r.get("to_factor"))})
    return sorted(out, key=lambda r: r["date"], reverse=True)


def _dividend_rows(raw) -> list[dict]:
    out = []
    for r in raw if isinstance(raw, list) else []:
        if not isinstance(r, dict) or not _DAY.match(str(r.get("date") or "")):
            continue
        amount = _number(r.get("amount"))
        if amount is None or amount <= 0:
            continue
        out.append({"date": r["date"], "amount": amount})
    return sorted(out, key=lambda r: r["date"], reverse=True)


def _section(rows: list[dict], window_years: int, **extra) -> dict:
    return {"rows": rows[:ROW_CAP], "total": len(rows), "window_years": window_years, **extra}


def held_actions(ticker: str) -> dict:
    """`{sym, status: 'ok' | 'not_held', reason?, held_at, source, row_cap, splits, dividends}`."""
    sym = (ticker or "").strip().upper()
    out = {
        "sym": sym, "status": "not_held", "held_at": None, "source": SOURCE, "row_cap": ROW_CAP,
        "splits": _section([], SPLIT_WINDOW_YEARS),
        "dividends": _section([], DIVIDEND_WINDOW_YEARS, basis="split_adjusted"),
    }
    try:
        held = _read_held(sym) if sym else None
    except Exception:
        held = None
    if not held:
        out["reason"] = (f"No splits or dividends are held on this server for {sym or 'that symbol'}. "
                         "They are held once the stock's chart has been opened; this route never asks the data vendor.")
        return out
    data, saved_at = held
    data = data if isinstance(data, dict) else {}
    out["status"] = "ok"
    try:
        saved = float(saved_at or 0)
        out["held_at"] = datetime.fromtimestamp(saved, tz=timezone.utc).isoformat(timespec="seconds") if saved > 0 else None
    except (TypeError, ValueError, OverflowError, OSError):
        out["held_at"] = None
    out["splits"] = _section(_split_rows(data.get("splits")), SPLIT_WINDOW_YEARS)
    out["dividends"] = _section(_dividend_rows(data.get("dividends")), DIVIDEND_WINDOW_YEARS, basis="split_adjusted")
    return out
