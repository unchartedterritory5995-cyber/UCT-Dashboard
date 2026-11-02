"""MD-1 kinds `quote` and `quotes` (owner: agent-md) — contract MD-1 §4.

An adapter over `services/massive.py`'s typed snapshot read (`_MassiveRestClient.get_batch_quotes`),
called directly and read-only.

⛔ NOT the `/api/live-prices` route (`api/routers/live_prices.py::get_live_prices`): on a cache miss that
route runs `watchlist_alert_service.run_alert_check()`, and an Agent price read must never trigger an
alert. This module imports nothing from that router or from the alert service, and a test pins both.

Freshness (MD-1 v1.1 §4) — classified from the ET clock, the product's trading-day helper and the
VENDOR's own timestamps, never from fetch time (and not from `massive._detect_session`, which labels
20:00–04:00 and weekends `post_market`):
  * regular session (09:30 to the session's close, early closes honoured) on a trading day -> `live`;
    `stale` once the oldest live stamp is older than FRESHNESS_BUDGET_S (60 s);
  * extended hours on a trading day (04:00–09:30, close–20:00) -> `live` with NOTE_EXTENDED when the oldest
    live stamp is at most EXTENDED_LIVE_S (15 min) old, otherwise `historical` with NOTE_CLOSED;
  * overnight (20:00–04:00), weekends and holidays -> `historical` with NOTE_CLOSED, stale false.
Each row says where its `last` came from (`last_source`: trade | minute | day_close | prev_close). In a
`live` read, a row priced from day_close/prev_close is NOT live: the read is `partial`, a note names it,
and its stamp is EXCLUDED from the envelope `as_of` (the oldest stamp among the rows that ARE live), so a
set is never described as fresher than its stalest live member. If no row has a current trade, the read
is `historical`.

No cache, connection, job, write or side effect is added here. `provider_calls` is 1 per batch request
made (0 when nothing reached the network: no symbols, or Massive's cached-forbidden short-circuit).
"""
from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env

SOURCE = "massive"
FRESHNESS_BUDGET_S = 60
EXTENDED_LIVE_S = 15 * 60
_LIVE_SOURCES = ("trade", "minute")
_SYMBOL_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")

NOTE_CLOSED = ("the regular session is not open — these are the last prints from the most recent session, "
               "not live prices")
NOTE_EXTENDED = ("extended-hours (pre-/post-market) prices — thin trading; the regular-session close is in "
                 "day_close/prev_close")
NOTE_NO_TRADES = ("no current trade in the snapshot — these are the latest closes, not live prices")
NOTE_SET_AS_OF = "as_of is the oldest quote in this set"
NOTE_SET_AS_OF_LIVE = "as_of is the oldest current trade in this set"


def _session(now: Optional[datetime] = None) -> str:
    """`regular` | `extended` | `closed`, from the ET clock and the product's own calendar helpers."""
    from api.services import bars_fetch, massive
    from zoneinfo import ZoneInfo
    try:
        trading_day = massive._today_et_is_a_trading_day()
    except Exception:  # noqa: BLE001 — unknown calendar: never claim the market is open
        return "closed"
    if not trading_day:
        return "closed"
    et = (now or datetime.now(timezone.utc)).astimezone(ZoneInfo("America/New_York"))
    mins = et.hour * 60 + et.minute
    try:
        close = bars_fetch._session_close_minutes(int(et.strftime("%Y%m%d")))
    except Exception:  # noqa: BLE001
        close = 16 * 60
    if 9 * 60 + 30 <= mins < close:
        return "regular"
    if 4 * 60 <= mins < 9 * 60 + 30 or close <= mins < 20 * 60:
        return "extended"
    return "closed"


def _norm_symbols(raw: Any) -> tuple[list[str], list[str]]:
    """(valid, rejected) — upper-cased, de-duplicated, order kept."""
    items = raw if isinstance(raw, list) else [raw]
    valid: list[str] = []
    rejected: list[str] = []
    for s in items:
        sym = str(s or "").strip().upper()
        if not sym:
            continue
        if _SYMBOL_RE.match(sym):
            if sym not in valid:
                valid.append(sym)
        else:
            rejected.append(sym[:16])
    return valid, rejected


def _num(v: Any) -> Optional[float]:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _row(sym: str, t: dict) -> dict:
    """The documented per-symbol fields — never the raw provider object."""
    day = t.get("day") if isinstance(t.get("day"), dict) else {}
    prev = t.get("prevDay") if isinstance(t.get("prevDay"), dict) else {}
    last_trade = t.get("lastTrade") if isinstance(t.get("lastTrade"), dict) else {}
    minute = t.get("min") if isinstance(t.get("min"), dict) else {}
    last, last_source = None, None
    for src, v in (("trade", last_trade.get("p")), ("minute", minute.get("c")),
                   ("day_close", day.get("c")), ("prev_close", prev.get("c"))):
        if _num(v):
            last, last_source = _num(v), src
            break
    observed = t.get("_observed_at")
    observed = observed if isinstance(observed, (int, float)) and observed > 0 else None
    vol = _num(day.get("v"))
    return {
        "symbol": sym,
        "last": last,
        "last_source": last_source,
        "change": _num(t.get("todaysChange")),
        "change_pct": _num(t.get("todaysChangePerc")),
        "open": _num(day.get("o")),
        "high": _num(day.get("h")),
        "low": _num(day.get("l")),
        "day_close": _num(day.get("c")),
        "volume": int(vol) if vol is not None else None,
        "prev_close": _num(prev.get("c")),
        "as_of": env.utc_iso(datetime.fromtimestamp(observed, timezone.utc)) if observed else None,
        "_observed": observed,
    }


def _fetch(symbols: list[str]) -> tuple[Optional[dict], int, Optional[str]]:
    """(per-symbol raw dicts | None, provider_calls, failure note)."""
    from api.services import massive
    try:
        client = massive._get_client()
    except Exception:  # noqa: BLE001 — not configured: nothing reached the network
        return None, 0, "the quote provider is not configured"
    try:
        result = client.get_batch_quotes(symbols)
    except Exception:  # noqa: BLE001 — typed provider errors (rate limit, auth, transient, not found)
        # we cannot always tell whether the request left the process, so count it (MD-1 §6.3)
        return None, 1, "the quote provider could not answer"
    if getattr(result, "degraded", None):
        return None, 0, "the quote provider is currently refusing requests"
    value = getattr(result, "value", None)
    return (value if isinstance(value, dict) else {}), 1, None


def _read(kind: str, params: dict, symbols_raw: Any) -> dict:
    symbols, rejected = _norm_symbols(symbols_raw)
    if not symbols:
        return env.unavailable(kind, params, SOURCE, "no valid ticker symbol was given")
    label = _session()
    raw, calls, failure = _fetch(symbols)
    if raw is None:
        return env.unavailable(kind, params, SOURCE, failure or "the quote provider could not answer", calls)

    rows = [_row(s, raw[s]) for s in symbols if isinstance(raw.get(s), dict)]
    missing = [s for s in symbols if not isinstance(raw.get(s), dict)]
    rows = [r for r in rows if r["last"] is not None] if rows else rows
    answered = {r["symbol"] for r in rows}
    no_price = [s for s in symbols if s not in answered and s not in missing]
    if not rows:
        return env.unavailable(kind, params, SOURCE, "the quote provider returned no price for "
                               + ", ".join(symbols), calls)

    now = time.time()
    live_rows = [r for r in rows if r["last_source"] in _LIVE_SOURCES]
    live_stamps = [r["_observed"] for r in live_rows if r["_observed"]]
    all_stamps = [r["_observed"] for r in rows if r["_observed"]]
    oldest_live = min(live_stamps) if live_stamps else None
    notes: list[str] = []
    freshness, stale = "historical", False
    if label == "regular" and live_rows:
        freshness = "live"
        stale = oldest_live is None or (now - oldest_live) > FRESHNESS_BUDGET_S
    elif label == "extended" and oldest_live is not None and (now - oldest_live) <= EXTENDED_LIVE_S:
        freshness = "live"
        notes.append(NOTE_EXTENDED)
    else:
        notes.append(NOTE_NO_TRADES if label == "regular" else NOTE_CLOSED)
    not_live = [r for r in rows if r["last_source"] not in _LIVE_SOURCES] if freshness == "live" else []
    for r in not_live:
        notes.append(f"no current trade for {r['symbol']} — showing {r['last_source']}")
    stamps = live_stamps if freshness == "live" else all_stamps
    oldest = min(stamps) if stamps else None
    as_of = env.utc_iso(datetime.fromtimestamp(oldest, timezone.utc)) if oldest else None
    if as_of is None:
        notes.append("the provider gave no observation time for these quotes")
    elif kind == "quotes" and len(rows) > 1:
        notes.append(NOTE_SET_AS_OF_LIVE if freshness == "live" else NOTE_SET_AS_OF)
    if missing:
        notes.append("no quote for: " + ", ".join(missing))
    if no_price:
        notes.append("no price in the quote for: " + ", ".join(no_price))
    if rejected:
        notes.append("not a ticker symbol: " + ", ".join(rejected))

    for r in rows:
        r.pop("_observed", None)
    dropped = len(missing) + len(rejected)
    coverage = {"evaluated": len(symbols) + len(rejected), "answered": len(rows),
                "dropped": dropped, "not_computable": len(no_price)}
    status = "ok" if (not missing and not no_price and not rejected and not not_live) else "partial"
    data = {"quote": rows[0]} if kind == "quote" else {"quotes": rows}
    data["session"] = label
    return env.make_envelope(kind, params, status=status, freshness=freshness, as_of=as_of, source=SOURCE,
                             data=data, stale=stale, coverage=coverage, notes=notes, provider_calls=calls)


def validate_quote(params: dict) -> Optional[str]:
    """Pure pre-admission check (Kind.validate): a malformed request is refused and spends no budget."""
    valid, rejected = _norm_symbols(params.get("symbol"))
    if not valid:
        return "a valid ticker symbol is required" + (f" (got {rejected[0]!r})" if rejected else "")
    return None


def validate_quotes(params: dict) -> Optional[str]:
    """Pure pre-admission check. Refuses a request with NO valid symbol; a list with SOME invalid entries
    is admitted and answered `partial`, naming them (the valid ones are still worth one provider call)."""
    syms = params.get("symbols")
    if not isinstance(syms, list):
        return "`symbols` must be a list of tickers"
    if not _norm_symbols(syms)[0]:
        return "no valid ticker symbol was given"
    return None


def read_quote(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — ctx is unused: no per-user state
    why = validate_quote(params)
    if why:
        return env.unavailable("quote", params, SOURCE, why)
    return _read("quote", params, params.get("symbol"))


def read_quotes(params: dict, ctx: dict) -> dict:  # noqa: ARG001
    why = validate_quotes(params)
    if why:
        return env.unavailable("quotes", params, SOURCE, why)
    return _read("quotes", params, params["symbols"])
