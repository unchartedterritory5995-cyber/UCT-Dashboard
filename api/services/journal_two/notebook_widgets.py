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
import re
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as _FutTimeout
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from typing import Any, Callable

from api.services.cache import TTLCache

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


# -- account kinds: shared helpers ---------------------------------------------------

EQUITY_POINTS_MAX = 60

#: The trade `source` value a broker import stamps (`trades.bulk_insert_trades(source="broker")`).
_BROKER_SOURCE = "broker"


def _origin(sources: list) -> str:
    """"broker" when every item is broker-imported, "manual" when none is, else "mixed"."""
    flags = [s == _BROKER_SOURCE for s in sources]
    if flags and all(flags):
        return "broker"
    if any(flags):
        return "mixed"
    return "manual"


def _iso_day(raw: Any, label: str) -> str:
    try:
        return date.fromisoformat(str(raw)).isoformat()
    except (TypeError, ValueError):
        raise WidgetRequestError(f"{label} must be an ISO day (YYYY-MM-DD)") from None


def _pnl_figures(analytics: dict) -> dict:
    """Net P&L, win rate and average R, each read from the analytics section that already
    computes it (never re-derived here; a second authority over one value is a defect):

      * netPnl  <- performance.byDay, the per-day NET P&L the equity curve is built from
      * winRate <- edgeScore.components.winRate (Win / (Win + Loss) over the range)
      * avgR    <- risk.expectancyR (mean effective R; the risk section's own
                   coverage gate leaves it None under 10 decisive trades)

    A figure that is absent from the payload stays None, never 0.
    """
    a = analytics if isinstance(analytics, dict) else {}
    days = ((a.get("performance") or {}).get("byDay")) or []
    pnls = [_num(d.get("pnl")) for d in days if isinstance(d, dict)]
    pnls = [p for p in pnls if p is not None]
    net = round(sum(pnls), 2) if pnls else None
    components = (a.get("edgeScore") or {}).get("components") or {}
    return {
        "netPnl": net,
        "winRate": _num(components.get("winRate")),
        "avgR": _num((a.get("risk") or {}).get("expectancyR")),
        "tradeCount": int(a.get("tradeCount") or 0),
    }


def _equity_points(analytics: dict) -> list[list]:
    """The equity section's curve as [[day, value], ...], at most EQUITY_POINTS_MAX points
    picked by an even stride (first and last point always kept)."""
    curve = (((analytics or {}).get("equity") or {}).get("curve")) or []
    pts = [[c.get("date"), _num(c.get("equity"))] for c in curve if isinstance(c, dict)]
    n = len(pts)
    if n <= EQUITY_POINTS_MAX:
        return pts
    step = (n - 1) / (EQUITY_POINTS_MAX - 1)
    return [pts[round(i * step)] for i in range(EQUITY_POINTS_MAX)]


# -- myPnlStats ----------------------------------------------------------------------

def _my_pnl_stats(user_id: str, params: dict, now: datetime) -> dict:
    from api.services.journal_two import analytics, trades
    from api.services.journal_two.filters import FilterSpec
    today = _today_et(now)
    day_to = _iso_day(params["to"], "to") if params.get("to") else today.isoformat()
    day_from = (
        _iso_day(params["from"], "from") if params.get("from")
        else (date.fromisoformat(day_to) - timedelta(days=date.fromisoformat(day_to).weekday())).isoformat()
    )
    if day_from > day_to:
        raise WidgetRequestError("from must not be after to")
    spec = FilterSpec(date_from=day_from, date_to=day_to)
    payload = analytics.get_analytics(user_id, spec=spec)
    got = trades.list_trades_for_user(user_id, spec=FilterSpec(date_from=day_from, date_to=day_to))
    rows = got[0] if isinstance(got, tuple) else got
    fig = _pnl_figures(payload)
    out: dict[str, Any] = {
        "asOf": _iso_utc(now),
        "source": _origin([(t or {}).get("source") for t in rows]),
        "range": {"from": day_from, "to": day_to},
        "netPnl": fig["netPnl"],
        "winRate": fig["winRate"],
        "avgR": fig["avgR"],
        "tradeCount": fig["tradeCount"],
        "equity": _equity_points(payload),
    }
    if fig["tradeCount"] == 0:
        out.update(netPnl=None, winRate=None, avgR=None, equity=[])
        out["empty"] = "No closed trades in this range yet."
    return out


# -- myPositionsRisk -----------------------------------------------------------------

def _account_size(user_id: str) -> float | None:
    """The member's own account size, or None when they never set one.

    READ-ONLY by construction: one SELECT on `j2_accounts` (the Default account first, else
    the oldest). Not `accounts.get_or_migrate_default_account`, which inserts a default
    account and reassigns the member's positions and trades on first call, and not
    `portfolio_heat`'s figure, which falls back to a default amount so its math always runs;
    a default must never print as the member's real account.
    """
    try:
        from api.services import auth_db
        conn = auth_db.get_connection()
        try:
            row = conn.execute(
                "SELECT account_size FROM j2_accounts WHERE user_id = ? "
                "ORDER BY (CASE WHEN name = 'Default' THEN 0 ELSE 1 END), created_at ASC LIMIT 1",
                (user_id,),
            ).fetchone()
        finally:
            conn.close()
        return (_num(row[0]) or None) if row else None
    except Exception as e:  # noqa: BLE001 -- no account size is "n/a", never a failed widget
        _log.info("positions risk: account size read failed: %s", e)
        return None


def _my_positions_risk(user_id: str, params: dict, now: datetime) -> dict:
    from api.services import portfolio_heat
    from api.services.journal_two import positions as j2_positions
    open_positions = list(j2_positions.list_open_positions(user_id) or [])
    heat = portfolio_heat.portfolio_heat(user_id) or {}
    shown, cut = open_positions[:ROW_CAP], max(0, len(open_positions) - ROW_CAP)

    # Heat walks the same open positions in order, so rows are matched on symbol + side,
    # in order, which keeps two lots of one name apart.
    heat_rows: dict[tuple, list[dict]] = {}
    for h in heat.get("per_position") or []:
        key = (str(h.get("symbol") or "").upper(), str(h.get("side") or "").lower())
        heat_rows.setdefault(key, []).append(h)
    joined: list[dict | None] = []
    for p in open_positions:
        key = (str(p.get("symbol") or "").upper(), str(p.get("side") or "").lower())
        bucket = heat_rows.get(key) or []
        joined.append(bucket.pop(0) if bucket else None)

    account = None if heat.get("account_size_is_default") else _account_size(user_id)
    prices: dict = {}
    if shown:
        try:
            from api.routers import live_prices
            got = live_prices.get_live_prices(
                tickers=",".join(sorted({str(p.get("symbol") or "").upper() for p in shown})))
            prices = got if isinstance(got, dict) else {}
        except Exception as e:  # noqa: BLE001
            _log.info("positions risk: live prices failed: %s", e)

    rows = []
    for p, h in zip(shown, joined):
        sym = str(p.get("symbol") or "").upper()
        quote = prices.get(sym) if isinstance(prices.get(sym), dict) else {}
        price = _num(quote.get("price"))
        qty, entry = _num(p.get("shares")), _num(p.get("entryPrice"))
        sign = -1.0 if str(p.get("side") or "").lower() == "short" else 1.0
        open_pnl = (
            round((price - entry) * qty * sign, 2)
            if None not in (price, qty, entry) else None
        )
        size_pct = (
            round(qty * price / account * 100, 2)
            if account and None not in (price, qty) else None
        )
        # `placeholder_stop` is heat's own verdict; no heat row is an unknown, not a "no".
        no_stop = None if h is None else bool(h.get("placeholder_stop"))
        has_stop = h is not None and not no_stop
        rows.append({
            "positionId": p.get("id"),
            "symbol": sym,
            "side": p.get("side"),
            "sizePct": size_pct,
            "openPnl": open_pnl,
            "stopPrice": _num(h.get("stop_price")) if has_stop else None,
            "distToStopPct": _num(h.get("dist_to_stop_pct")) if has_stop else None,
            "noStop": no_stop,
        })
    out: dict[str, Any] = {
        "asOf": _iso_utc(now),
        "source": _origin([p.get("source") for p in open_positions]),
        "accountSize": account,
        "rows": rows,
    }
    if cut:
        out["truncated"] = cut
    if not open_positions:
        out["empty"] = "No open positions."
    return out


# -- tickerCard ----------------------------------------------------------------------

_SYMBOL_RE = re.compile(r"^[A-Z][A-Z.\-]{0,9}$")

#: Per-(member, symbol) cache of the ticker card's history figures. The card can be polled
#: and the analytics read is the heavy call on this path.
HISTORY_TTL_S = 300
_HISTORY_CACHE = TTLCache(max_size=500)


def _symbol_history_figures(user_id: str, sym: str) -> dict:
    key = f"{user_id}::{sym}"
    hit = _HISTORY_CACHE.get(key)
    if isinstance(hit, dict):
        return hit
    from api.services.journal_two import analytics
    from api.services.journal_two.filters import FilterSpec
    fig = _pnl_figures(analytics.get_analytics(user_id, spec=FilterSpec(symbol=sym, symbol_exact=True)))
    _HISTORY_CACHE.set(key, fig, HISTORY_TTL_S)
    return fig


def _simple_average(closes: list[float], n: int) -> float | None:
    return round(sum(closes[-n:]) / n, 4) if len(closes) >= n else None


def _ticker_card(user_id: str, params: dict, now: datetime) -> dict:
    sym = params.get("symbol")
    if not isinstance(sym, str) or not _SYMBOL_RE.match(sym):
        raise WidgetRequestError("symbol is required and must be an uppercase ticker")

    price = change_pct = None
    try:
        from api.routers import live_prices
        got = live_prices.get_live_prices(tickers=sym)
        quote = got.get(sym) if isinstance(got, dict) else None
        if isinstance(quote, dict):
            price, change_pct = _num(quote.get("price")), _num(quote.get("change_pct"))
    except Exception as e:  # noqa: BLE001
        _log.info("ticker card: live price failed for %s: %s", sym, e)

    ma10 = ma50 = None
    try:  # local bars cache: no network call
        from api.services import bars_sqlite
        closes = [c for c in (_num(b[4]) for b in bars_sqlite.get_bars(sym, "D", 50)) if c is not None]
        ma10, ma50 = _simple_average(closes, 10), _simple_average(closes, 50)
    except Exception as e:  # noqa: BLE001
        _log.info("ticker card: bars read failed for %s: %s", sym, e)

    earnings_day = implied = None
    try:
        from api.services.journal_two import earnings_prep
        window, timing, _partial, _as_of = earnings_prep._window(_today_et(now))
        earnings_day = window.get(sym)
        if earnings_day:
            moves, _late = _implied_moves(
                [{"symbol": sym, "date": earnings_day, "timing": timing.get(sym)}])
            implied = moves.get(sym)
    except Exception as e:  # noqa: BLE001
        _log.info("ticker card: earnings window failed for %s: %s", sym, e)

    fig = _symbol_history_figures(user_id, sym)
    history = (
        {"trades": fig["tradeCount"], "winRate": fig["winRate"], "netPnl": fig["netPnl"]}
        if fig["tradeCount"] else None
    )
    return {
        "asOf": _iso_utc(now),
        "source": "mixed",
        "symbol": sym,
        "price": price,
        "changePct": change_pct,
        "ma10": ma10,
        "ma50": ma50,
        "earningsDay": earnings_day,
        "impliedMovePct": implied,
        "history": history,
    }


# -- dispatch ------------------------------------------------------------------

#: Kind -> builder(user_id, params, now). Later tasks add their kinds here.
_BUILDERS: dict[str, Callable[[str, dict, datetime], dict]] = {
    "myWatchlistToday": _my_watchlist_today,
    "myNamesReporting": _my_names_reporting,
    "myPnlStats": _my_pnl_stats,
    "myPositionsRisk": _my_positions_risk,
    "tickerCard": _ticker_card,
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
