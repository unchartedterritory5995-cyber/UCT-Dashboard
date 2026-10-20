"""Notebook widgets: the server payload builder.

One shell, one builder per widget kind. `build()` dispatches through `_BUILDERS`
and calls `cap_payload` last, so every payload is bounded no matter which builder
produced it.

Rules every payload follows (the plan's Global Constraints):
  * `asOf` (ISO UTC) and `source` in {"broker", "manual", "mixed", "market"}.
  * An unknown figure is `None`, never 0, never absent.
  * At most `ROW_CAP` rows and `PAYLOAD_CAP_BYTES` bytes; what was cut is reported
    as `truncated: <n>`.

Consumed functions are imported lazily, inside the builder, so a test that
monkeypatches the source module reaches them (a module-level `from x import f`
would bind the original once, at import).
"""
from __future__ import annotations

import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as _FutTimeout
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo
from typing import Any, Callable

_log = logging.getLogger(__name__)

PAYLOAD_CAP_BYTES = 16384
ROW_CAP = 40

#: TOTAL wall-clock budget for the implied-move reads of one request, and the pool size.
#: A vendor read is an unbounded external call on the single web pod's threadpool.
IMPLIED_MOVE_BUDGET_S = 6.0
IMPLIED_MOVE_WORKERS = 4

#: Kind -> the release wave whose flag gates its menu entry and server read.
KIND_WAVE: dict[str, int] = {
    "myWatchlistToday": 1,
    "myNamesReporting": 1,
    "tickerCard": 1,
    "myPnlStats": 1,
    "myPositionsRisk": 1,
    "myRulesCheck": 2,
    "myMistakes": 2,
    "marketOnMyNames": 3,
    "tickerFlow": 3,
    "tradeRecap": 6,
    "myPnlCalendar": 6,
    "mySetupEdge": 6,
    "myScreenToday": 6,
    "roomBuzzOnMyNames": 6,
    "myEarningsReactions": 6,
}

#: Kinds that read the member's own account (never shown on a public page).
ACCOUNT_KINDS = frozenset({
    "myPnlStats", "myPositionsRisk", "myRulesCheck", "myMistakes",
    "tradeRecap", "myPnlCalendar", "mySetupEdge",
})


class WidgetRequestError(ValueError):
    """An unknown kind, or params a builder cannot use. The router maps it to 400."""


def notebook_widgets_wave_on(wave: int) -> bool:
    """Is release wave `wave` on, read from the environment NOW (never at import)."""
    from api.services import notebook_flags
    return notebook_flags.flag_on(f"NOTEBOOK_WIDGETS_W{int(wave)}_ENABLED", False)


def _iso_utc(now: datetime) -> str:
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _today_et(now: datetime) -> date:
    """The ET calendar date of `now`, so the earnings window agrees with `asOf`."""
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return now.astimezone(ZoneInfo("America/New_York")).date()


def _num(v: Any) -> float | None:
    """A finite number or None. A missing figure must never render as 0."""
    if isinstance(v, bool) or v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and f not in (float("inf"), float("-inf")) else None


def cap_payload(payload: dict) -> dict:
    """Drop rows from the end until the compact JSON fits `PAYLOAD_CAP_BYTES`.

    Sets `truncated` to the rows removed here added to any the builder already
    reported. A payload that already fits is returned unchanged.
    """
    def size(p: dict) -> int:
        return len(json.dumps(p, separators=(",", ":")))

    rows = payload.get("rows")
    if size(payload) <= PAYLOAD_CAP_BYTES or not isinstance(rows, list):
        return payload
    base = int(payload.get("truncated") or 0)
    out = dict(payload)
    kept = list(rows)
    dropped = 0
    out["truncated"] = base
    while kept and size({**out, "rows": kept}) > PAYLOAD_CAP_BYTES:
        kept.pop()
        dropped += 1
        out["truncated"] = base + dropped
    out["rows"] = kept
    return out


# -- myWatchlistToday ----------------------------------------------------------

_LIST_LABELS = {"watchlist": "Watchlist", "flagged": "Flagged"}


def _my_watchlist_today(user_id: str, params: dict, now: datetime) -> dict:
    from api.services import calendar_personalization
    sets = calendar_personalization.get_user_ticker_sets(user_id) or {}
    chosen = (params or {}).get("list")
    if chosen is not None and chosen not in _LIST_LABELS:
        raise WidgetRequestError("list must be 'watchlist' or 'flagged'")
    if chosen is None:
        chosen = "watchlist" if sets.get("watchlist") else "flagged"
    symbols = sorted({str(s).upper() for s in (sets.get(chosen) or ()) if s})
    shown, cut = symbols[:ROW_CAP], max(0, len(symbols) - ROW_CAP)

    prices: dict = {}
    earnings: dict[str, str] = {}
    if shown:
        try:
            from api.routers import live_prices
            got = live_prices.get_live_prices(tickers=",".join(shown))
            prices = got if isinstance(got, dict) else {}
        except Exception as e:  # noqa: BLE001 -- no price is "n/a", never a failed widget
            _log.info("watchlist today: live prices failed: %s", e)
        try:
            from api.services.journal_two import earnings_prep
            soon = earnings_prep.reporting_soon(user_id, today=_today_et(now))
            for it in (soon or {}).get("items") or []:
                if it.get("symbol") and it.get("date"):
                    earnings[str(it["symbol"]).upper()] = str(it["date"])
        except Exception as e:  # noqa: BLE001
            _log.info("watchlist today: earnings window failed: %s", e)

    rows = []
    for sym in shown:
        row = prices.get(sym) if isinstance(prices.get(sym), dict) else {}
        rows.append({
            "symbol": sym,
            "price": _num(row.get("price")),
            "changePct": _num(row.get("change_pct")),
            "earningsDay": earnings.get(sym),
        })
    out: dict[str, Any] = {
        "asOf": _iso_utc(now),
        "source": "market",
        "listLabel": _LIST_LABELS[chosen],
        "rows": rows,
    }
    if cut:
        out["truncated"] = cut
    return out


# -- myNamesReporting ----------------------------------------------------------

def _implied_move_pct(sym: str, day: str | None, timing: str | None) -> float | None:
    try:
        from api.services import earnings_enrichment
        got = earnings_enrichment.get_implied_move(sym, day, timing)
        return _num(got.get("pct")) if isinstance(got, dict) else None
    except Exception as e:  # noqa: BLE001 -- one vendor miss is a null cell, not a dead widget
        _log.info("names reporting: implied move failed for %s: %s", sym, e)
        return None


def _implied_moves(items: list[dict]) -> tuple[dict[str, float | None], bool]:
    """{SYM: pct or None} for `items`, run in a small pool under ONE total budget.

    A symbol not finished when the budget runs out is None and the second value is
    True (the payload is partial). Nothing blocks past the budget: unstarted futures
    are cancelled and the pool is released without waiting for a straggler.
    """
    out: dict[str, float | None] = {}
    if not items:
        return out, False
    pool = ThreadPoolExecutor(max_workers=IMPLIED_MOVE_WORKERS)
    deadline = time.monotonic() + IMPLIED_MOVE_BUDGET_S
    timed_out = False
    try:
        futs = {}
        for it in items:
            sym = str(it.get("symbol") or "").upper()
            futs[sym] = pool.submit(_implied_move_pct, sym, it.get("date"), it.get("timing"))
        for sym, fut in futs.items():
            try:
                out[sym] = fut.result(timeout=max(0.0, deadline - time.monotonic()))
            except _FutTimeout:
                out[sym] = None
                timed_out = True
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    return out, timed_out


def _my_names_reporting(user_id: str, params: dict, now: datetime) -> dict:
    from api.services.journal_two import earnings_prep
    soon = earnings_prep.reporting_soon(user_id, today=_today_et(now)) or {}
    items = list(soon.get("items") or [])
    shown, cut = items[:ROW_CAP], max(0, len(items) - ROW_CAP)
    moves, timed_out = _implied_moves(shown)
    rows = []
    for it in shown:
        sym = str(it.get("symbol") or "").upper()
        rows.append({
            "symbol": sym,
            "day": it.get("date"),
            "timing": it.get("timing"),
            "daysAway": it.get("daysAway"),
            "sources": list(it.get("sources") or []),
            "impliedMovePct": moves.get(sym),
        })
    out: dict[str, Any] = {
        "asOf": _iso_utc(now),
        "source": "market",
        "rows": rows,
        "partial": bool(soon.get("partial")) or timed_out,
    }
    if cut:
        out["truncated"] = cut
    return out


# -- dispatch ------------------------------------------------------------------

#: Kind -> builder(user_id, params, now). Later tasks add their kinds here.
_BUILDERS: dict[str, Callable[[str, dict, datetime], dict]] = {
    "myWatchlistToday": _my_watchlist_today,
    "myNamesReporting": _my_names_reporting,
}


def build(kind: str, user_id: str, params: dict, *, now: datetime | None = None) -> dict:
    """Build the payload for `kind`. Raises `WidgetRequestError` for an unknown kind
    (or one with no builder yet) and for params its builder rejects."""
    if kind not in KIND_WAVE:
        raise WidgetRequestError(f"unknown widget kind: {kind!r}")
    builder = _BUILDERS.get(kind)
    if builder is None:
        raise WidgetRequestError(f"widget kind not available yet: {kind!r}")
    if params is not None and not isinstance(params, dict):
        raise WidgetRequestError("params must be an object")
    payload = builder(user_id, params or {}, now or datetime.now(timezone.utc))
    return cap_payload(payload)
