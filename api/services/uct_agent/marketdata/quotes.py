"""MD-1 kinds `quote` and `quotes` (owner: agent-md) — contract MD-1 §4.

An adapter over `services/massive.py`'s typed snapshot read (`_MassiveRestClient.get_batch_quotes`),
called directly and read-only.

⛔ NOT the `/api/live-prices` route (`api/routers/live_prices.py::get_live_prices`): on a cache miss that
route runs `watchlist_alert_service.run_alert_check()`, and an Agent price read must never trigger an
alert. This module imports nothing from that router or from the alert service, and a test pins both.

Freshness (MD-1 §3/§4):
  * in the regular session on a trading day -> `live`, `stale` once the oldest quote in the set is older
    than FRESHNESS_BUDGET_S;
  * otherwise (pre-market, post-market, overnight, weekend, holiday) -> `historical`, with a note, because
    what the snapshot carries then is the last session's prints, not a live market.
`as_of` is the DATA's own time: each symbol's vendor observation stamp (`_observed_at`, epoch seconds,
stamped by get_batch_quotes), and for the envelope the OLDEST of them, so a set is never described as
fresher than its stalest member.

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
_SYMBOL_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")

NOTE_CLOSED = ("the regular session is not open — these are the last prints from the most recent session, "
               "not live prices")
NOTE_EXTENDED = "extended-hours prints may be included in `last`"
NOTE_SET_AS_OF = "as_of is the oldest quote in this set"


def _session() -> tuple[bool, str]:
    """(in the regular session on a trading day?, massive's session label). Uses massive's own helpers so
    the Agent and the product agree on what 'open' means."""
    from api.services import massive
    label = massive._detect_session()
    try:
        trading_day = massive._today_et_is_a_trading_day()
    except Exception:  # noqa: BLE001 — unknown calendar: never claim the market is open
        trading_day = False
    return (trading_day and label == "regular"), label


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
    last = _num(last_trade.get("p")) or _num(minute.get("c")) or _num(day.get("c")) or _num(prev.get("c"))
    observed = t.get("_observed_at")
    observed = observed if isinstance(observed, (int, float)) and observed > 0 else None
    vol = _num(day.get("v"))
    return {
        "symbol": sym,
        "last": last,
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
    in_session, label = _session()
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

    stamps = [r["_observed"] for r in rows if r["_observed"]]
    oldest = min(stamps) if stamps else None
    as_of = env.utc_iso(datetime.fromtimestamp(oldest, timezone.utc)) if oldest else None
    notes: list[str] = []
    if in_session:
        freshness = "live"
        stale = oldest is None or (time.time() - oldest) > FRESHNESS_BUDGET_S
    else:
        freshness = "historical"
        stale = False
        notes.append(NOTE_CLOSED)
        if label in ("pre_market", "post_market"):
            notes.append(NOTE_EXTENDED)
    if as_of is None:
        notes.append("the provider gave no observation time for these quotes")
    elif kind == "quotes" and len(rows) > 1:
        notes.append(NOTE_SET_AS_OF)
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
    status = "ok" if (not missing and not no_price and not rejected) else "partial"
    data = {"quote": rows[0]} if kind == "quote" else {"quotes": rows}
    data["session"] = label
    return env.make_envelope(kind, params, status=status, freshness=freshness, as_of=as_of, source=SOURCE,
                             data=data, stale=stale, coverage=coverage, notes=notes, provider_calls=calls)


def read_quote(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — ctx is unused: no per-user state
    return _read("quote", params, params.get("symbol"))


def read_quotes(params: dict, ctx: dict) -> dict:  # noqa: ARG001
    syms = params.get("symbols")
    if not isinstance(syms, list):
        return env.unavailable("quotes", params, SOURCE, "`symbols` must be a list of tickers")
    return _read("quotes", params, syms)
