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
import threading
import time
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, TimeoutError as _FutTimeout, wait
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


#: Kind -> its member-facing title, for the kinds the client lists (WIDGET_KINDS in
#: app/src/pages/journal-2-0/lib/notebookWidgets.js). ⛔ ONE FACT IN TWO FILES, railed by
#: tests/test_journal_styles_compose.py, which reads the client file. A starter style's failed
#: slot names the widget by this title (journal_styles._build_widget_slot).
KIND_TITLE: dict[str, str] = {
    "myWatchlistToday": "My watchlist today",
    "myNamesReporting": "My names reporting",
    "marketOnMyNames": "Market on my names",
    "tickerCard": "Ticker card",
    "tickerFlow": "Options flow on a ticker",
    "myPnlStats": "My P&L and stats",
    "myPositionsRisk": "My open positions and risk",
    "myRulesCheck": "My rules check",
    "myMistakes": "My recurring mistakes",
    "tradeRecap": "Trade recap",
    "myPnlCalendar": "My P&L calendar",
    "mySetupEdge": "My setup edge",
    "myScreenToday": "My screen today",
    "roomBuzzOnMyNames": "Room buzz on my names",
    "myEarningsReactions": "My earnings reactions",
}


class WidgetRequestError(ValueError):
    """An unknown kind, or params a builder cannot use. The router maps it to 400."""


class BoundedPool:
    """Final review I-4: a module-level thread pool with a NON-BLOCKING admission semaphore in front of it.

    `try_submit` answers a future, or None AT ONCE when every permit is held: nothing ever queues behind the
    pool. A permit is held from submit until the future is done (finished, failed or cancelled), so a
    straggler a request abandoned at its budget still counts against the ceiling until its own leaf
    timeout ends it. Pools are per process (a second web process doubles the ceiling)."""

    def __init__(self, workers: int, name: str):
        self.workers = workers
        self._pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix=name)
        self._slots = threading.BoundedSemaphore(workers)

    def try_submit(self, fn: Callable, *args: Any) -> Future | None:
        slots = self._slots
        if not slots.acquire(blocking=False):
            return None
        try:
            fut = self._pool.submit(fn, *args)
        except RuntimeError:                        # the pool is shut down (interpreter exit)
            slots.release()
            return None
        fut.add_done_callback(lambda _f: slots.release())
        return fut


#: ONE pool for every builder's vendor fan-out (implied moves, the flow page read, the earnings calendar
#: walk, the reaction figures). Looked up at call time, so a test can swap in a fresh one.
#: ⛔ journal_styles' slot builder keeps its OWN pool: a slot task waits on builder tasks, so sharing one
#: bounded pool could deadlock when it is full.
WIDGET_POOL_WORKERS = 8
_POOL = BoundedPool(WIDGET_POOL_WORKERS, "nb-widget")


def _fan_out(fn: Callable, jobs: dict[str, tuple], *, per_request: int, budget_s: float) -> dict[str, Any]:
    """{key: fn(*args)} for each job, on the shared pool under ONE total budget, at most `per_request` in
    flight at once. A key missing from the answer did not finish: past the budget, raised, or never run
    because the pool was saturated by other requests (then the rest answer AT ONCE, never queued)."""
    results: dict[str, Any] = {}
    pending = list(jobs.items())
    inflight: dict[Future, str] = {}
    deadline = time.monotonic() + budget_s
    try:
        while pending or inflight:
            while pending and len(inflight) < per_request:
                fut = _POOL.try_submit(fn, *pending[0][1])
                if fut is None:
                    break
                inflight[fut] = pending.pop(0)[0]
            if not inflight:
                break                                # saturated: nothing of ours is running to wait for
            left = deadline - time.monotonic()
            if left <= 0:
                break
            done, _ = wait(list(inflight), timeout=left, return_when=FIRST_COMPLETED)
            for fut in done:
                key = inflight.pop(fut)
                try:
                    results[key] = fut.result()
                except Exception as e:  # noqa: BLE001 -- one miss is a null cell, not a dead widget
                    _log.info("widget fan-out: %s failed: %s", key, e)
    finally:
        for fut in inflight:
            fut.cancel()
    return results


def _one_bounded(fn: Callable, budget_s: float) -> tuple[bool, Any]:
    """(True, fn()) on the shared pool inside `budget_s`; (False, None) when it ran past the budget, raised,
    or the pool was saturated (answered at once). A straggler is abandoned, never waited for."""
    fut = _POOL.try_submit(fn)
    if fut is None:
        _log.info("widget read skipped: the widget pool is saturated")
        return False, None
    try:
        return True, fut.result(timeout=budget_s)
    except _FutTimeout:
        _log.info("widget read ran past %.1fs", budget_s)
        return False, None
    except Exception as e:  # noqa: BLE001
        _log.info("widget read failed: %s", e)
        return False, None


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

#: The request keys a builder reads from `params` (R4). The router passes exactly these through, and a member
#: style's snapshot slot (Task 18) keeps exactly these as its settings. The client's SETTINGS_KEYS in
#: notebookSets.js is pinned to this tuple by test_journal_styles_compose.
SETTING_KEYS: tuple[str, ...] = ("symbol", "list", "from", "to", "month", "definitionId", "tradeId")
_SETTING_MAX_CHARS = 64


def settings_of(params: Any) -> dict:
    """The builder settings inside a widget's stored params (which hold the frozen PAYLOAD): each
    SETTING_KEYS entry that is non-empty text, and nothing else, so no figure, row or `share` switch
    survives. `list` is recovered from the payload's `listLabel` (which list is a setting), as the client's
    presetParams does. A date range is NOT recovered from the payload's `range`: when none was asked for,
    those dates were the day's default, and keeping them would freeze one week forever."""
    p = params if isinstance(params, dict) else {}
    out = {k: p[k] for k in SETTING_KEYS
           if isinstance(p.get(k), str) and p[k] and len(p[k]) <= _SETTING_MAX_CHARS}
    if "list" not in out:
        by_label = {label: key for key, label in _LIST_LABELS.items()}
        if p.get("listLabel") in by_label:
            out["list"] = by_label[p["listLabel"]]
    return out


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
    if not items:
        return {}, False
    jobs = {}
    for it in items:
        sym = str(it.get("symbol") or "").upper()
        jobs[sym] = (sym, it.get("date"), it.get("timing"))
    got = _fan_out(_implied_move_pct, jobs, per_request=IMPLIED_MOVE_WORKERS, budget_s=IMPLIED_MOVE_BUDGET_S)
    return {sym: got.get(sym) for sym in jobs}, any(sym not in got for sym in jobs)


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


def _week_range(params: dict, now: datetime) -> tuple[str, str]:
    """(from, to) ISO days: `params` when given, else Monday of this ET week through today.
    The one spelling of the default range, shared by every account kind that takes one."""
    today = _today_et(now)
    day_to = _iso_day(params["to"], "to") if params.get("to") else today.isoformat()
    day_from = (
        _iso_day(params["from"], "from") if params.get("from")
        else (date.fromisoformat(day_to) - timedelta(days=date.fromisoformat(day_to).weekday())).isoformat()
    )
    if day_from > day_to:
        raise WidgetRequestError("from must not be after to")
    return day_from, day_to


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
    day_from, day_to = _week_range(params, now)
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
    from api.services.journal_two import accounts as j2_accounts
    from api.services.journal_two import positions as j2_positions
    open_positions = list(j2_positions.list_open_positions(user_id) or [])
    # Read BEFORE heat: `portfolio_heat` migrates a Default j2_accounts row (at the default size) for a
    # member who has none, so after it runs "a row exists" no longer means "the member set a size".
    stored_size = _account_size(user_id)
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

    # A size is the member's own only when it was read and differs from the migration default
    # (`accounts._DEFAULT_ACCOUNT_SIZE`). Nothing in j2_accounts records a member edit, so a member who
    # types exactly the default is indistinguishable from the migrated row and reads as "default".
    # Correct on the second call too: the migrated row holds the constant, so it still reads "default".
    is_default = (
        stored_size is None
        or stored_size == j2_accounts._DEFAULT_ACCOUNT_SIZE
        or bool(heat.get("account_size_is_default"))
    )
    account = j2_accounts._DEFAULT_ACCOUNT_SIZE if is_default else stored_size
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
        "accountSizeSource": "default" if is_default else "member",
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


# -- myRulesCheck --------------------------------------------------------------------

#: The adherence store keys a journal ("before entry") rule's tick as `rule:<id>` (the one
#: spelling, app/src/pages/journal-2-0/lib/blocks/checklistItems.js RULE_PREFIX); a setup
#: checklist rule is ticked under its own id.
_JOURNAL_RULE_PREFIX = "rule:"

RULES_NONE_SENTENCE = "No rules set yet."
RULES_UNCHECKED_SENTENCE = "No trades checked against your rules in this range."


def _member_rules(user_id: str) -> dict:
    """The member's rules, where the names live: {"setup": {account_id: {setup: [{id, label}]}},
    "journal": [rule dicts, every status]}.

    Late-bound seam: a test patches this module attribute. Read-only: list_accounts and
    get_account_settings(account_id=...) are SELECTs (never get_or_migrate_default_account, which
    writes), and journal rules are listed with status=None so a dismissed rule's name still
    resolves for the ticks already recorded on it.
    """
    from api.services.journal_two import accounts, journal_rules
    setup: dict[str, dict] = {}
    for acc in accounts.list_accounts(user_id) or []:
        acc_id = (acc or {}).get("id")
        block = accounts.get_account_settings(user_id, acc_id) if acc_id else None
        rules = (block or {}).get("setupRules")
        if isinstance(rules, dict) and rules:
            setup[acc_id] = rules
    return {"setup": setup, "journal": list(journal_rules.list_rules(user_id, status=None) or [])}


def _my_rules_check(user_id: str, params: dict, now: datetime) -> dict:
    from api.services.journal_two import adherence_store, trades
    from api.services.journal_two.filters import FilterSpec
    from api.services.journal_two.trader_blocks import adherence_of_trade
    day_from, day_to = _week_range(params, now)
    got = trades.list_trades_for_user(user_id, spec=FilterSpec(date_from=day_from, date_to=day_to))
    rows = got[0] if isinstance(got, tuple) else got
    rules = _member_rules(user_id) or {}
    setup_rules = rules.get("setup") or {}
    journal = [r for r in (rules.get("journal") or []) if isinstance(r, dict)]

    # Names: setup checklist ids as they are, journal rules under their rule:<id> tick key.
    names: dict[str, str] = {}
    for per_setup in setup_rules.values():
        for items in (per_setup or {}).values():
            for it in items or []:
                if isinstance(it, dict) and it.get("id") and it.get("label"):
                    names[str(it["id"])] = str(it["label"])
    for r in journal:
        if r.get("id") and r.get("label"):
            names[_JOURNAL_RULE_PREFIX + str(r["id"])] = str(r["label"])
    active_journal = [r for r in journal if r.get("status", "active") == "active"]
    has_rules = bool(active_journal) or any(
        items for per_setup in setup_rules.values() for items in (per_setup or {}).values())

    adh = adherence_store.list_adherence_for_user(user_id) or {}
    tally: dict[str, list[int]] = {}      # label -> [kept, total]
    checked_trades = []
    head_kept = head_total = 0
    for t in rows:
        t = t or {}
        rec = adherence_of_trade(adh.get, t.get("tradeRef"), t.get("positionId"))
        if not isinstance(rec, dict):
            continue
        checked_trades.append(t)
        ticked = {str(i) for i in (rec.get("checkedRuleIds") or [])}
        # The headline is the Journal's own record: its ticks and its stored count, summed.
        head_kept += len(ticked)
        head_total += int(rec.get("totalRules") or 0)
        # Per rule. The record keeps ticks and a count, not the unticked ids, so the list is rebuilt
        # from rules that EXISTED when the ticks were stored (journal rules carry createdAt; a rule
        # made later is not counted). Setup checklist rules carry no createdAt, so an unticked one
        # counts only when the rebuilt list's size equals the stored count (the checklist is then
        # proven the one in force); otherwise only ticked rules count, which can never overstate.
        when = str(rec.get("updatedAt") or t.get("exitDate") or t.get("entryDate") or "")[:10]
        candidates: set[str] = set()
        setup_name = rec.get("setup") or t.get("setup")
        for it in (setup_rules.get(t.get("accountId")) or {}).get(setup_name) or []:
            if isinstance(it, dict) and it.get("id") and names.get(str(it["id"])):
                candidates.add(str(it["id"]))
        for r in active_journal:
            made = str(r.get("createdAt") or "")[:10]
            if r.get("beforeEntry") and r.get("accountId") in (None, t.get("accountId"))                     and not (when and made and made > when):
                candidates.add(_JOURNAL_RULE_PREFIX + str(r["id"]))
        proven = len(candidates | ticked) == int(rec.get("totalRules") or 0)
        on_list = (candidates | ticked) if proven else ticked
        for rid in on_list:
            label = names.get(rid)
            if label is None:
                continue                  # a rule since deleted: never printed as a raw id
            cell = tally.setdefault(label, [0, 0])
            cell[1] += 1
            cell[0] += 1 if rid in ticked else 0

    out_rules = [{"rule": k, "kept": v[0], "total": v[1]} for k, v in tally.items()]
    out_rules.sort(key=lambda r: (-r["total"], r["rule"]))
    cut = max(0, len(out_rules) - ROW_CAP)
    out: dict[str, Any] = {
        "asOf": _iso_utc(now),
        "source": _origin([(t or {}).get("source") for t in (checked_trades or rows)]),
        "range": {"from": day_from, "to": day_to},
        "kept": head_kept if checked_trades else None,
        "total": head_total if checked_trades else None,
        "rules": out_rules[:ROW_CAP],
    }
    if cut:
        out["truncated"] = cut
    if not out_rules:
        out["empty"] = RULES_UNCHECKED_SENTENCE if has_rules else RULES_NONE_SENTENCE
    return out


# -- myMistakes ----------------------------------------------------------------------

MISTAKES_WINDOW_DAYS = 30
MISTAKES_EMPTY_SENTENCE = "No mistakes tagged in the last 60 days."

#: Per-(member, day) cache of the two analytics reads this widget makes. Both windows are heavy
#: and an embed can be refreshed; the answer only moves when a trade is tagged.
MISTAKES_TTL_S = 300
_MISTAKES_CACHE = TTLCache(max_size=500)


def _mistake_rows(analytics: dict) -> dict[str, dict]:
    """{mistake: {total, count}} from analytics' own psychology.costOfMistakes.byMistake
    (never re-derived here: the Journal's cost-of-mistakes card reads the same list)."""
    by = (((analytics or {}).get("psychology") or {}).get("costOfMistakes") or {}).get("byMistake") or []
    out: dict[str, dict] = {}
    for m in by:
        if isinstance(m, dict) and m.get("mistake"):
            out[str(m["mistake"])] = {"total": _num(m.get("total")), "count": int(m.get("count") or 0)}
    return out


def _mistake_windows(user_id: str, today: date) -> dict:
    key = f"{user_id}::{today.isoformat()}"
    hit = _MISTAKES_CACHE.get(key)
    if isinstance(hit, dict):
        return hit
    from api.services.journal_two import analytics, trades
    from api.services.journal_two.filters import FilterSpec
    span = MISTAKES_WINDOW_DAYS - 1
    now_from = today - timedelta(days=span)
    prior_to = now_from - timedelta(days=1)
    prior_from = prior_to - timedelta(days=span)
    now_rows = _mistake_rows(analytics.get_analytics(
        user_id, date_from=now_from.isoformat(), date_to=today.isoformat()))
    prior_rows = _mistake_rows(analytics.get_analytics(
        user_id, date_from=prior_from.isoformat(), date_to=prior_to.isoformat()))
    got = trades.list_trades_for_user(
        user_id, spec=FilterSpec(date_from=prior_from.isoformat(), date_to=today.isoformat()))
    rows = got[0] if isinstance(got, tuple) else got
    tagged = [(t or {}).get("source") for t in rows if (t or {}).get("mistakeTags")]
    out = {"now": now_rows, "prior": prior_rows, "source": _origin(tagged)}
    _MISTAKES_CACHE.set(key, out, MISTAKES_TTL_S)
    return out


def _my_mistakes(user_id: str, params: dict, now: datetime) -> dict:
    win = _mistake_windows(user_id, _today_et(now))
    now_rows, prior_rows = win["now"], win["prior"]
    rows = []
    for name in set(now_rows) | set(prior_rows):
        n, p = now_rows.get(name), prior_rows.get(name)
        count_now, count_prior = (n or {}).get("count", 0), (p or {}).get("count", 0)
        rows.append({
            "mistake": name,
            "cost30d": (n or {}).get("total"),
            "countNow": count_now,
            "countPrior": count_prior,
            "trend": "more" if count_now > count_prior else "less" if count_now < count_prior else "same",
        })
    # Biggest bleed first (the most negative total); a mistake with no figure this window last.
    rows.sort(key=lambda r: (r["cost30d"] is None, r["cost30d"] if r["cost30d"] is not None else 0.0, r["mistake"]))
    shown, cut = rows[:ROW_CAP], max(0, len(rows) - ROW_CAP)
    out: dict[str, Any] = {
        "asOf": _iso_utc(now),
        "source": win["source"],
        "rows": shown,
    }
    if cut:
        out["truncated"] = cut
    if not rows:
        out["empty"] = MISTAKES_EMPTY_SENTENCE
    return out


# -- marketOnMyNames (wave 3) --------------------------------------------------------

#: Daily bars a 5-day return needs: today's close and the close five sessions before it.
RET5D_BARS = 6
NAMES_EMPTY_SENTENCE = "No names in your positions, watchlist or flagged list."
#: How a row's sector figure was made. The theme taxonomy names a sector but carries no sector
#: return, so the figure is the mean 5-day return of the member's own names in that sector.
SECTOR_BASIS = "your names"


def _ret5d(sym: str) -> float | None:
    """The 5-day return in percent from the LOCAL daily bars cache (no network), or None when
    there are fewer than six bars or the read fails."""
    try:
        from api.services import bars_sqlite
        closes = [_num(b[4]) for b in bars_sqlite.get_bars(sym, "D", RET5D_BARS)]
    except Exception as e:  # noqa: BLE001 -- one name's bars are a null cell, not a dead widget
        _log.info("market on my names: bars read failed for %s: %s", sym, e)
        return None
    if len(closes) < RET5D_BARS or closes[-1] is None or not closes[-RET5D_BARS]:
        return None
    return round((closes[-1] / closes[-RET5D_BARS] - 1.0) * 100.0, 2)


def _sector_of(sym: str) -> str | None:
    """The sector of the name's primary theme in the theme taxonomy (owner memberships first, the
    resolver the chart watermark uses), or None. A cached DB read; never an RS compute."""
    try:
        from api.services import groups
        row = groups.resolve_primary_theme(sym)
    except Exception as e:  # noqa: BLE001
        _log.info("market on my names: theme read failed for %s: %s", sym, e)
        return None
    name = (row or {}).get("sector_name")
    return str(name) if name else None


def _market_on_my_names(user_id: str, params: dict, now: datetime) -> dict:
    from api.services.journal_two import earnings_prep
    names = sorted((earnings_prep._member_sets(user_id) or {}).keys())
    shown, cut = names[:ROW_CAP], max(0, len(names) - ROW_CAP)
    rows = [{"symbol": sym, "ret5d": _ret5d(sym), "sector": _sector_of(sym)} for sym in shown]

    # The sector figure is the mean of the member's names in that sector that HAVE a return. One
    # name alone is compared with nothing, so it gets no sector figure (null, never a 0 vs itself).
    by_sector: dict[str, list[float]] = {}
    for r in rows:
        if r["sector"] and r["ret5d"] is not None:
            by_sector.setdefault(r["sector"], []).append(r["ret5d"])
    for r in rows:
        vals = by_sector.get(r["sector"] or "") or []
        r["sectorRet5d"] = round(sum(vals) / len(vals), 2) if len(vals) >= 2 else None
        r["vsSector"] = (round(r["ret5d"] - r["sectorRet5d"], 2)
                         if r["ret5d"] is not None and r["sectorRet5d"] is not None else None)
    out: dict[str, Any] = {
        "asOf": _iso_utc(now),
        "source": "market",
        "sectorBasis": SECTOR_BASIS,
        "rows": rows,
    }
    if cut:
        out["truncated"] = cut
    if not names:
        out["empty"] = NAMES_EMPTY_SENTENCE
    return out


# -- tickerFlow (wave 3) -------------------------------------------------------------

#: The one fetch of the page-derived flow product (flow-worker, through the proxy). A hard
#: wall-clock budget: the call runs on a pool future and is abandoned when the budget runs out.
TICKER_FLOW_TIMEOUT_S = 8.0
TOP_PRINTS_MAX = 10
_PRINT_KEYS = ("cp", "strike", "exp", "dte", "premium", "volume", "direction")


def _window_label(rung: Any) -> str | None:
    """The served rung as words: '1' -> 'Today', '5' -> 'Last 5 sessions', 'all' -> 'All sessions on record'."""
    r = str(rung or "").strip().lower()
    if r == "all":
        return "All sessions on record"
    try:
        n = int(float(r))
    except ValueError:
        return None
    return "Today" if n == 1 else f"Last {n} sessions"


def _flow_read(sym: str) -> dict | None:
    from api.services import flow_card_from_page
    from api.services.discord_render import symbols
    return flow_card_from_page.page_derived_payload(
        sym, "1", symbols.flow_source(sym), timeout_s=TICKER_FLOW_TIMEOUT_S,
        top_n=TOP_PRINTS_MAX, enrich=False)


def _flow_bounded(sym: str) -> dict | None:
    """`_flow_read` under ONE wall-clock budget, the `_implied_moves` shape: a straggler past the
    budget is abandoned (never waited for) and the answer is None. A saturated pool answers None at once
    (final review I-4): no flow read is an empty widget, never a failed one."""
    ok, data = _one_bounded(lambda: _flow_read(sym), TICKER_FLOW_TIMEOUT_S)
    return data if ok else None


def _ticker_flow(user_id: str, params: dict, now: datetime) -> dict:
    sym = params.get("symbol")
    if not isinstance(sym, str) or not _SYMBOL_RE.match(sym):
        raise WidgetRequestError("symbol is required and must be an uppercase ticker")
    data = _flow_bounded(sym)
    data = data if isinstance(data, dict) else {}
    contracts = list(data.get("contracts") or [])
    net = data.get("net") if isinstance(data.get("net"), dict) else {}
    # The reader climbs 1 -> 5 -> 20 -> all sessions when today is empty; the payload names the rung
    # it actually served (`days_requested` on a served rung), and the widget says that window.
    window = _window_label((data.get("window") or {}).get("days_requested")) if contracts else None
    out: dict[str, Any] = {
        "asOf": _iso_utc(now),
        "source": "market",
        "symbol": sym,
        # The page's own net figures, as it computed them; never re-summed here.
        "bullPremium": _num(net.get("bull")) if contracts else None,
        "bearPremium": _num(net.get("bear")) if contracts else None,
        "window": window,
        "topPrints": [{k: c.get(k) for k in _PRINT_KEYS} for c in contracts[:TOP_PRINTS_MAX]],
    }
    if not contracts:
        out["empty"] = f"No options flow on record for {sym} today."
    return out


# -- wave 6: shared helpers ----------------------------------------------------------

_ET = ZoneInfo("America/New_York")


def _ymd(day: str) -> int:
    return int(str(day)[:10].replace("-", ""))


def _ymd_iso(ymd: Any) -> str:
    s = str(int(ymd))
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}"


def _et_day_of(raw: Any) -> str | None:
    """The ET calendar day of a stored trade date: a bare day as it is, a timestamp converted."""
    if not raw:
        return None
    s = str(raw)
    if len(s) <= 10:
        try:
            return date.fromisoformat(s).isoformat()
        except ValueError:
            return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return s[:10]
    return (dt.astimezone(_ET) if dt.tzinfo else dt).date().isoformat()


def _even_stride(items: list, cap: int) -> list:
    """At most `cap` items by an even stride, first and last always kept (`_equity_points`' rule)."""
    n = len(items)
    if n <= cap:
        return items
    step = (n - 1) / (cap - 1)
    return [items[round(i * step)] for i in range(cap)]


# -- tradeRecap (wave 6) -------------------------------------------------------------

#: A j2_trades id: uuid4 for every writer (`trades.create_trade_manual`, `bulk_insert_trades`). The
#: shape check is permissive on purpose (word characters and hyphens); its job is to keep junk off the read.
_TRADE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_\-]{0,63}$")
#: ONE sentence for a trade that does not exist, is not the member's, or is malformed, so an id cannot
#: be probed for whether it belongs to somebody else.
TRADE_NOT_FOUND = "Trade not found"
RECAP_BARS_MAX = 120
RECAP_PAD_SESSIONS = 20
#: Daily bars read for one recap, ending ~2 months after the exit (covers the 20-session pad).
_RECAP_BARS_READ = 600
_RECAP_TAIL_DAYS = 45


def _recap_bars(sym: str, entry_day: str | None, exit_day: str | None) -> list[dict]:
    """Daily bars from the LOCAL bars cache (no network): entry-20 to exit+20 sessions, at most
    `RECAP_BARS_MAX` (a longer hold is thinned by an even stride, entry and exit kept)."""
    if not (sym and entry_day and exit_day):
        return []
    try:
        from api.services import bars_sqlite
        to_key = int((date.fromisoformat(exit_day) + timedelta(days=_RECAP_TAIL_DAYS)).strftime("%Y%m%d"))
        bars = list(bars_sqlite.get_bars_before(sym, "D", _RECAP_BARS_READ, to_key) or [])
    except Exception as e:  # noqa: BLE001 -- no bars is an empty chart, never a failed widget
        _log.info("trade recap: bars read failed for %s: %s", sym, e)
        return []
    ent, ex = _ymd(entry_day), _ymd(exit_day)
    first = next((i for i, b in enumerate(bars) if int(b[0]) >= ent), None)
    last = next((i for i in range(len(bars) - 1, -1, -1) if int(bars[i][0]) <= ex), None)
    if first is None or last is None or last < first:
        return []
    window = bars[max(0, first - RECAP_PAD_SESSIONS):last + RECAP_PAD_SESSIONS + 1]
    return [{"t": _ymd_iso(b[0]), "o": _num(b[1]), "h": _num(b[2]), "l": _num(b[3]), "c": _num(b[4])}
            for b in _even_stride(window, RECAP_BARS_MAX)]


def _trade_recap(user_id: str, params: dict, now: datetime) -> dict:
    trade_id = params.get("tradeId")
    if not isinstance(trade_id, str) or not trade_id:
        raise WidgetRequestError("tradeId is required")
    if not _TRADE_ID_RE.match(trade_id):
        raise WidgetRequestError(TRADE_NOT_FOUND)
    from api.services.journal_two import trades
    detail = trades.get_trade_detail(user_id, trade_id)      # OWN-SCOPED: user_id AND id, read-only
    trade = (detail or {}).get("trade") if isinstance(detail, dict) else None
    if not isinstance(trade, dict):
        raise WidgetRequestError(TRADE_NOT_FOUND)
    # R is the trade's OWN stored R, by analytics' `_effective_r_map` rule: the stop-based r_multiple
    # when the trade carries one, else the stored excursion's true R. Never recomputed here.
    r = _num(trade.get("rMultiple"))
    if r is None:
        r = _num(((detail or {}).get("excursion") or {}).get("trueR"))
    sym = str(trade.get("symbol") or "").upper()
    entry_day, exit_day = _et_day_of(trade.get("entryDate")), _et_day_of(trade.get("exitDate"))
    hold = trade.get("holdDays")
    return {
        "asOf": _iso_utc(now),
        "source": _origin([trade.get("source")]),
        "symbol": sym,
        "side": trade.get("side"),
        "entryDate": entry_day,
        "exitDate": exit_day,
        "entryPrice": _num(trade.get("entryPrice")),
        "exitPrice": _num(trade.get("exitPrice")),
        "r": r,
        "pnl": _num(trade.get("pnlDollarNet")),
        "setup": trade.get("setup") or None,
        "holdDays": int(hold) if isinstance(hold, (int, float)) and not isinstance(hold, bool) else None,
        "mistakes": [str(m) for m in (trade.get("mistakeTags") or []) if m],
        "bars": _recap_bars(sym, entry_day, exit_day),
    }


# -- myPnlCalendar (wave 6) ----------------------------------------------------------

PNL_CALENDAR_EMPTY_SENTENCE = "No closed trades this month yet."
_MONTH_RE = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")
#: Per-(member, month) cache of the calendar's analytics read: the heavy call, and the answer only
#: moves when a trade closes.
PNL_CALENDAR_TTL_S = 300
_PNL_CALENDAR_CACHE = TTLCache(max_size=500)


def _month_window(params: dict, now: datetime) -> tuple[str, str, str]:
    raw = params.get("month")
    if raw is None:
        today = _today_et(now)
        raw = f"{today.year:04d}-{today.month:02d}"
    m = _MONTH_RE.match(raw) if isinstance(raw, str) else None
    if not m:
        raise WidgetRequestError("month must be YYYY-MM")
    first = date(int(m.group(1)), int(m.group(2)), 1)
    nxt = date(first.year + (first.month == 12), first.month % 12 + 1, 1)
    return raw, first.isoformat(), (nxt - timedelta(days=1)).isoformat()


def _pnl_calendar_read(user_id: str, month: str, day_from: str, day_to: str) -> dict:
    key = f"{user_id}::{month}"
    hit = _PNL_CALENDAR_CACHE.get(key)
    if isinstance(hit, dict):
        return hit
    from api.services.journal_two import analytics, trades
    from api.services.journal_two.filters import FilterSpec
    payload = analytics.get_analytics(user_id, date_from=day_from, date_to=day_to)
    got = trades.list_trades_for_user(user_id, spec=FilterSpec(date_from=day_from, date_to=day_to))
    rows = got[0] if isinstance(got, tuple) else got
    out = {"analytics": payload, "source": _origin([(t or {}).get("source") for t in rows])}
    _PNL_CALENDAR_CACHE.set(key, out, PNL_CALENDAR_TTL_S)
    return out


def _my_pnl_calendar(user_id: str, params: dict, now: datetime) -> dict:
    month, day_from, day_to = _month_window(params, now)
    read = _pnl_calendar_read(user_id, month, day_from, day_to)
    a = read["analytics"] if isinstance(read.get("analytics"), dict) else {}
    # Days, best and worst are analytics' own performance.byDay (the per-day NET P&L the equity curve
    # is built from), never re-derived.
    days = [{"day": str(d["date"]), "pnl": _num(d.get("pnl"))}
            for d in ((a.get("performance") or {}).get("byDay")) or []
            if isinstance(d, dict) and d.get("date")]
    priced = [d for d in days if d["pnl"] is not None]
    best = max(priced, key=lambda d: d["pnl"]) if priced else None
    worst = min(priced, key=lambda d: d["pnl"]) if priced else None
    out: dict[str, Any] = {
        "asOf": _iso_utc(now),
        "source": read.get("source") or "manual",
        "month": month,
        "days": days,
        "best": {"day": best["day"], "pnl": best["pnl"]} if best else None,
        "worst": {"day": worst["day"], "pnl": worst["pnl"]} if worst else None,
    }
    if not int(a.get("tradeCount") or 0) or not days:
        out.update(days=[], best=None, worst=None)
        out["empty"] = PNL_CALENDAR_EMPTY_SENTENCE
    return out


# -- mySetupEdge (wave 6) ------------------------------------------------------------

SETUP_EDGE_EMPTY_SENTENCE = "No setups with closed trades yet."
#: The most recent closed trades one edge read covers (a bound on a member with a long journal).
SETUP_EDGE_TRADES_MAX = 5000
#: Per-member cache of the edge read: the answer only moves when a trade closes.
SETUP_EDGE_TTL_S = 300
_SETUP_EDGE_CACHE = TTLCache(max_size=500)
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _scoped_closed_trades(user_id: str) -> list[dict]:
    """The member's most recent `SETUP_EDGE_TRADES_MAX` closed trades in the UNIFIED Compass scope
    (`resolve_account_scope(..., UNIFIED_ACCOUNT_ID)`: the Compass-enabled accounts), oldest first.

    The rows are `coach_data_assembler._trades_in_range`'s, the reader `personal_edge`'s default seam
    goes through (`_exec_get_aggregates`), so the per-setup aggregate is the same one; only the window
    differs. ⛔ The default seam asks for no `period` (the last 7 days, almost always "thin") and with
    account None, which `resolve_account_scope` turns into `account_id IN (NULL)`: no trade at all.
    The window here starts at the exit of the 5,000th most recent trade in scope, so the read is
    bounded in SQL, then sliced to exactly the bound. Read-only: SELECTs on a connection this closes."""
    from api.services import auth_db
    from api.services.journal_two import coach_data_assembler
    from api.services.journal_two.coach_scope import resolve_account_scope
    from api.services.journal_two.unified_coach import UNIFIED_ACCOUNT_ID
    conn = auth_db.get_connection()
    try:
        ids = resolve_account_scope(conn, user_id, UNIFIED_ACCOUNT_ID)
        if not ids:
            return []
        marks = ",".join("?" * len(ids))
        row = conn.execute(
            f"SELECT exit_date FROM j2_trades WHERE user_id = ? AND account_id IN ({marks})"
            " AND (analytics_excluded IS NULL OR analytics_excluded = 0)"
            " ORDER BY exit_date DESC LIMIT 1 OFFSET ?",
            [user_id, *ids, SETUP_EDGE_TRADES_MAX - 1]).fetchone()
        start = _EPOCH
        if row and row[0]:
            try:
                start = datetime.fromisoformat(str(row[0]).replace("Z", "+00:00"))
            except ValueError:
                start = _EPOCH
            if start.tzinfo is None:
                start = start.replace(tzinfo=timezone.utc)
            start -= timedelta(days=1)       # inclusive of the boundary day; the slice below is exact
        end = datetime.now(timezone.utc) + timedelta(days=1)
        trades = coach_data_assembler._trades_in_range(conn, user_id, UNIFIED_ACCOUNT_ID, start, end)
    finally:
        conn.close()
    return trades[-SETUP_EDGE_TRADES_MAX:]


def _setup_edge_read(user_id: str) -> dict:
    """{"edge": personal_edge's answer, "sources": [trade source, ...]} from ONE set of trades, so
    the figures and the `source` label describe the same accounts. Cached per member."""
    hit = _SETUP_EDGE_CACHE.get(user_id)
    if isinstance(hit, dict):
        return hit
    from api.services import personal_edge
    from api.services.journal_two import coach_chat_tools as cct
    from api.services.journal_two.unified_coach import UNIFIED_ACCOUNT_ID
    trades = _scoped_closed_trades(user_id)
    edge = personal_edge.edge_for_setups(
        user_id, UNIFIED_ACCOUNT_ID,
        setup_perf_fn=lambda _u, _a: cct._breakdown_trades(trades, "setup")) or {}
    out = {"edge": edge, "sources": [t.get("source") for t in trades]}
    _SETUP_EDGE_CACHE.set(user_id, out, SETUP_EDGE_TTL_S)
    return out


def _my_setup_edge(user_id: str, params: dict, now: datetime) -> dict:
    from api.services import personal_edge
    read = _setup_edge_read(user_id)
    thin_below = personal_edge._MUTE_MIN_N
    rows = []
    for setup, e in (read.get("edge") or {}).items():
        e = e if isinstance(e, dict) else {}
        n = e.get("n")
        n = int(n) if isinstance(n, (int, float)) and not isinstance(n, bool) else 0
        rows.append({
            "setup": str(setup),
            "n": n,
            "expectancyR": _num(e.get("avg_r")),
            "winRate": _num(e.get("win_rate")),
            "thin": n < thin_below,
        })
    rows.sort(key=lambda r: (-r["n"], r["setup"]))
    shown, cut = rows[:ROW_CAP], max(0, len(rows) - ROW_CAP)
    out: dict[str, Any] = {"asOf": _iso_utc(now), "source": _origin(read.get("sources") or []), "rows": shown}
    if cut:
        out["truncated"] = cut
    if not rows:
        out["empty"] = SETUP_EDGE_EMPTY_SENTENCE
    return out


# -- myScreenToday (wave 6) ----------------------------------------------------------

SCREEN_NOT_FOUND = "Screen not found"
SCREEN_NOT_READY = "This screen's results are not ready yet."
SCREEN_NOT_SCANNABLE = "This saved definition is not a screen."


def _own_definition(user_id: str, def_id: str) -> dict | None:
    """The member's OWN saved definition (`user_definitions.get` scopes by user_id), or None."""
    from api.services import user_definitions
    try:
        row = user_definitions.get(user_id, def_id)
    except ValueError:                 # not a user-namespace id: the same answer as not found
        return None
    return row if isinstance(row, dict) else None


def _screen_name(row: dict) -> str:
    """ScreensManager's `scanName`: the member's name for it, else its id, so a widget is never blank."""
    meta = ((row.get("definition") or {}).get("meta") or {}) if isinstance(row.get("definition"), dict) else {}
    name = meta.get("name").strip() if isinstance(meta.get("name"), str) else ""
    return name or str(row.get("def_id") or "") or "Untitled screen"


def _toolkit_user(user_id: str) -> dict:
    """The user dict `entitlements.limits_for` reads, built the way the request's is: `id`, plus
    `toolkit` ONLY when `users.toolkit` is set (`auth_service.validate_session` projects it that way).
    A missing column (an older database) or a failed read is "no toolkit assigned", the default."""
    user: dict[str, Any] = {"id": user_id}
    try:
        from api.services import auth_db
        conn = auth_db.get_connection()
        try:
            row = conn.execute("SELECT toolkit FROM users WHERE id = ?", (user_id,)).fetchone()
        finally:
            conn.close()
    except Exception as e:  # noqa: BLE001 -- an unreadable column falls back like an unset one
        _log.info("screen today: toolkit read failed: %s", e)
        return user
    if row is not None and row[0] is not None:
        user["toolkit"] = row[0]
    return user


def _receipt_closes(r: dict) -> bool:
    """`scan_evaluator._assert_coverage_closes`' first identity, as a check (the route may not import
    the evaluator): every count a non-negative int and evaluated == answered + dropped + not_computable."""
    vals = [r.get(k) for k in ("evaluated", "answered", "dropped", "not_computable")]
    if not all(isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in vals):
        return False
    return vals[0] == vals[1] + vals[2] + vals[3]


def _my_screen_today(user_id: str, params: dict, now: datetime) -> dict:
    def_id = params.get("definitionId")
    if not isinstance(def_id, str) or not def_id:
        raise WidgetRequestError("definitionId is required")
    row = _own_definition(user_id, def_id)
    if row is None:
        raise WidgetRequestError(SCREEN_NOT_FOUND)
    out: dict[str, Any] = {"asOf": _iso_utc(now), "source": "market", "name": _screen_name(row),
                           "hits": [], "coverage": None}
    from api.services import entitlements, scan_definition
    from api.services.screener import scan_store
    try:
        def_hash = scan_definition.def_hash(row.get("definition"))
    except (scan_definition.ScanRefused, ValueError, TypeError):
        out["empty"] = SCREEN_NOT_SCANNABLE
        return out
    tf = scan_store.SCAN_JOIN_TF
    # The latest SWEPT session (a coverage row, never a hits row: a zero-hit night writes no hits).
    as_of = scan_store.latest_covered_as_of(def_hash, tf)
    receipt = scan_store.coverage(def_hash, tf, as_of) if as_of is not None else None
    if not isinstance(receipt, dict) or not _receipt_closes(receipt):
        out["empty"] = SCREEN_NOT_READY           # nobody looked, or the arithmetic does not close
        return out
    # The hit list exactly as `/api/scans/definition-results` reads it (its own join over screener_rows).
    from api.routers import scan_results
    tickers, cut = scan_results._hit_tickers(def_hash, tf, as_of, ROW_CAP)
    kept, withheld = entitlements.apply_symbol_cap(list(tickers), entitlements.limits_for(_toolkit_user(user_id)))
    prices: dict = {}
    if kept:
        try:
            from api.routers import live_prices
            got = live_prices.get_live_prices(tickers=",".join(kept))
            prices = got if isinstance(got, dict) else {}
        except Exception as e:  # noqa: BLE001
            _log.info("screen today: live prices failed: %s", e)
    for sym in kept:
        q = prices.get(sym) if isinstance(prices.get(sym), dict) else {}
        out["hits"].append({"symbol": sym, "price": _num(q.get("price")), "changePct": _num(q.get("change_pct"))})
    # The four counts straight from the receipt, never collapsed; `withheld` BESIDE them, accumulated
    # the way the route does it (the receipt's own, plus what this member's plan withheld here).
    out["coverage"] = {
        "evaluated": receipt["evaluated"],
        "answered": receipt["answered"],
        "dropped": receipt["dropped"],
        "notComputable": receipt["not_computable"],
        "withheld": int(receipt.get("withheld") or 0) + len(withheld),
    }
    out["session"] = _ymd_iso(as_of)
    if cut:
        # The route's own word (`scan_results.py` `truncated`): the page is short of the hits. A
        # boolean, because `_hit_tickers` knows THAT it cut, not how many; `answered` counts every
        # symbol that ran (hits and non-hits), so it cannot stand in for a count.
        out["truncated"] = True
    return out


# -- roomBuzzOnMyNames (wave 6) ------------------------------------------------------

BUZZ_EMPTY_SENTENCE = "The room hasn't mentioned your names today."
BUZZ_NOT_SET_UP = "Room buzz isn't set up yet."
#: Enough board rows that a member's names are not cut off by the room's busier ones.
BUZZ_BOARD_LIMIT = 10_000


def _buzz_channels() -> list[str] | None:
    """The configured channels, or None when `BUZZ_CHANNELS` is unset (read now, never at import).
    `buzz_ingest.channels()` falls back to a default channel; a widget says "not set up" instead."""
    import os
    if not os.environ.get("BUZZ_CHANNELS", "").strip():
        return None
    from api.services import buzz_ingest
    return buzz_ingest.channels() or None


def _buzz_window(now: datetime) -> tuple[int, int]:
    """Today's ET session open (09:30) to now; before the open, or on a weekend, the previous
    weekday's whole session (open to close). The open and close are buzz_boards' own constants."""
    from api.services import buzz_boards
    d = (now if now.tzinfo else now.replace(tzinfo=timezone.utc)).astimezone(_ET)
    now_ts = int(d.timestamp())
    open_today = d.replace(hour=buzz_boards.OPEN_H, minute=buzz_boards.OPEN_M, second=0, microsecond=0)
    if d.weekday() < 5 and d >= open_today:
        return int(open_today.timestamp()), now_ts
    prev = d - timedelta(days=1)
    while prev.weekday() >= 5:
        prev -= timedelta(days=1)
    start = prev.replace(hour=buzz_boards.OPEN_H, minute=buzz_boards.OPEN_M, second=0, microsecond=0)
    end = prev.replace(hour=buzz_boards.CLOSE_H, minute=buzz_boards.CLOSE_M, second=0, microsecond=0)
    return int(start.timestamp()), int(end.timestamp())


def _room_buzz_on_my_names(user_id: str, params: dict, now: datetime) -> dict:
    out: dict[str, Any] = {"asOf": _iso_utc(now), "source": "market", "rows": []}
    chans = _buzz_channels()
    if not chans:
        out["empty"] = BUZZ_NOT_SET_UP
        return out
    from api.services import buzz_store
    from api.services.journal_two import earnings_prep
    mine = set((earnings_prep._member_sets(user_id) or {}).keys())
    start, end = _buzz_window(now)
    board = buzz_store.board(start, end, chans, limit=BUZZ_BOARD_LIMIT) if mine else []
    # ⛔ COUNTS ONLY. The store holds no message text; the row is rebuilt from three named keys so
    # nothing else a board row ever grows can reach a widget.
    rows = [{"symbol": str(r.get("ticker") or "").upper(), "mentions": int(r.get("mentions") or 0),
             "people": int(r.get("people") or 0)}
            for r in board or [] if isinstance(r, dict) and str(r.get("ticker") or "").upper() in mine]
    out["rows"], cut = rows[:ROW_CAP], max(0, len(rows) - ROW_CAP)
    if cut:
        out["truncated"] = cut
    if not rows:
        out["empty"] = BUZZ_EMPTY_SENTENCE
    return out


# -- myEarningsReactions (wave 6) ----------------------------------------------------

REACTIONS_WINDOW_DAYS = 7
REACTIONS_EMPTY_SENTENCE = "None of your names reported in the last 7 days."
#: ONE total wall-clock budget for the request's earnings reads, and the pool size (the
#: `_implied_moves` pattern): a cold `get_year_earnings` walks up to four providers.
REACTIONS_BUDGET_S = 6.0
REACTIONS_WORKERS = 4
#: The calendar walk is per DAY (cache, then Finnhub, then FMP); bounded and held an hour.
REACTIONS_WINDOW_BUDGET_S = 8.0
_REACTION_BARS = 15
#: A reaction session more than this many calendar days after the report is a hole in the bars,
#: not "the next session".
_REACTION_MAX_GAP_DAYS = 5


def _reported_window(today: date) -> tuple[dict[str, str], bool]:
    """({SYM: report day}, partial) for today-7 .. today, through the same day walk the earnings
    window (`earnings_prep._window`) uses, `calendar_alerts.collect_earnings_window`. Bounded by
    `REACTIONS_WINDOW_BUDGET_S` and held in the shared cache (an hour; five minutes when partial)."""
    from api.services.cache import cache
    ck = f"notebook_widgets_reported_window::{today.isoformat()}::{REACTIONS_WINDOW_DAYS}"
    hit = cache.get(ck)
    if isinstance(hit, dict):
        return dict(hit["window"]), bool(hit["partial"])

    def read():
        from api.services.calendar_alerts import collect_earnings_window
        return collect_earnings_window(today - timedelta(days=REACTIONS_WINDOW_DAYS), REACTIONS_WINDOW_DAYS)

    ok, got = _one_bounded(read, REACTIONS_WINDOW_BUDGET_S)       # saturated: partial at once (I-4)
    if not ok:
        return {}, True
    window, partial = got
    window = {str(s).upper(): str(d)[:10] for s, d in (window or {}).items()}
    cache.set(ck, {"window": window, "partial": bool(partial)}, ttl=300 if partial else 3600)
    return window, bool(partial)


_NO_FIGURES = {"epsActual": None, "epsEst": None, "revActual": None, "revEst": None}


def _quarter_figures(sym: str, day: str) -> dict:
    """EPS and revenue, actual and estimate, for the quarter reported on `day`: the row whose report
    date IS `day`, else the fiscal quarter that date maps to (`_fiscal_q_from_report`, the module's own)."""
    from api.services import earnings_estimates as ee
    try:
        fq, fy = ee._fiscal_q_from_report(day)
        rows = ee.get_year_earnings(sym, fy) or []
    except Exception as e:  # noqa: BLE001 -- one name's miss is null cells, not a dead widget
        _log.info("earnings reactions: earnings read failed for %s: %s", sym, e)
        return dict(_NO_FIGURES)
    rows = [r for r in rows if isinstance(r, dict)]
    row = next((r for r in rows if str(r.get("date") or "")[:10] == day), None)
    if row is None:
        row = next((r for r in rows if r.get("quarter") == fq and r.get("date")), None)
    if row is None:
        return dict(_NO_FIGURES)
    return {"epsActual": _num(row.get("eps_actual")), "epsEst": _num(row.get("eps_estimate")),
            "revActual": _num(row.get("revenue_actual")), "revEst": _num(row.get("revenue_estimate"))}


def _reaction_figures(items: list[tuple[str, str]]) -> tuple[dict[str, dict], bool]:
    """{SYM: figures} under ONE total budget in a small pool (`_implied_moves`' shape). A name not
    finished when the budget runs out gets null figures and the second value is True."""
    if not items:
        return {}, False
    jobs = {sym: (sym, day) for sym, day in items}
    got = _fan_out(_quarter_figures, jobs, per_request=REACTIONS_WORKERS, budget_s=REACTIONS_BUDGET_S)
    return ({sym: got[sym] if isinstance(got.get(sym), dict) else dict(_NO_FIGURES) for sym in jobs},
            any(sym not in got for sym in jobs))


def _next_day_pct(sym: str, day: str, timing: str | None, now: datetime) -> float | None:
    """The reaction from LOCAL daily bars: the close of the first session to trade on the report
    (the report day itself before the bell, else the session after it) against the close before it.
    None when that session has not closed yet, or the bars do not hold it."""
    try:
        from api.services import bars_sqlite
        bars = [(int(b[0]), _num(b[4])) for b in bars_sqlite.get_bars(sym, "D", _REACTION_BARS) or []]
    except Exception as e:  # noqa: BLE001
        _log.info("earnings reactions: bars read failed for %s: %s", sym, e)
        return None
    rep = _ymd(day)
    after = [b for b in bars if (b[0] >= rep if timing == "bmo" else b[0] > rep)]
    if not after:
        return None
    react_ymd, react_close = after[0]
    react_day = date.fromisoformat(_ymd_iso(react_ymd))
    if (react_day - date.fromisoformat(day)).days > _REACTION_MAX_GAP_DAYS:
        return None
    d_et = (now if now.tzinfo else now.replace(tzinfo=timezone.utc)).astimezone(_ET)
    from api.services import buzz_boards
    closed_at = d_et.replace(hour=buzz_boards.CLOSE_H, minute=buzz_boards.CLOSE_M, second=0, microsecond=0)
    if react_day > d_et.date() or (react_day == d_et.date() and d_et < closed_at):
        return None                                   # that session is still trading (or to come)
    before = [b for b in bars if b[0] < react_ymd]
    base = before[-1][1] if before else None
    if not base or react_close is None:
        return None
    return round((react_close / base - 1.0) * 100.0, 2)


def _my_earnings_reactions(user_id: str, params: dict, now: datetime) -> dict:
    from api.services.journal_two import earnings_prep
    today = _today_et(now)
    mine = earnings_prep._member_sets(user_id) or {}
    window, partial = _reported_window(today)
    items = [(sym, window[sym]) for sym in mine if window.get(sym) and window[sym] <= today.isoformat()]
    items.sort(key=lambda it: it[0])                       # newest report first, then by symbol
    items.sort(key=lambda it: it[1], reverse=True)
    shown, cut = items[:ROW_CAP], max(0, len(items) - ROW_CAP)
    figures, late = _reaction_figures(shown)
    rows = []
    for sym, day in shown:
        timing = earnings_prep._timing_from_calendar_cache(sym, day)
        rows.append({"symbol": sym, "day": day, **(figures.get(sym) or dict(_NO_FIGURES)),
                     "nextDayPct": _next_day_pct(sym, day, timing, now)})
    out: dict[str, Any] = {"asOf": _iso_utc(now), "source": "market", "rows": rows,
                           "partial": bool(partial) or late}
    if cut:
        out["truncated"] = cut
    if not rows:
        out["empty"] = REACTIONS_EMPTY_SENTENCE
    return out


# -- dispatch ------------------------------------------------------------------

#: Kind -> builder(user_id, params, now). Later tasks add their kinds here.
_BUILDERS: dict[str, Callable[[str, dict, datetime], dict]] = {
    "myWatchlistToday": _my_watchlist_today,
    "myNamesReporting": _my_names_reporting,
    "myPnlStats": _my_pnl_stats,
    "myPositionsRisk": _my_positions_risk,
    "myRulesCheck": _my_rules_check,
    "myMistakes": _my_mistakes,
    "tickerCard": _ticker_card,
    "marketOnMyNames": _market_on_my_names,
    "tickerFlow": _ticker_flow,
    "tradeRecap": _trade_recap,
    "myPnlCalendar": _my_pnl_calendar,
    "mySetupEdge": _my_setup_edge,
    "myScreenToday": _my_screen_today,
    "roomBuzzOnMyNames": _room_buzz_on_my_names,
    "myEarningsReactions": _my_earnings_reactions,
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
