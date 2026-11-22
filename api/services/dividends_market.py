"""The market-wide dividend and split calendar for the Terminal's `DVD MARKET` view: every ex-dividend
date in this week and next, and every split taking effect in the same days, across the market.

    get_market_dividends() -> the body of GET /api/research/market-dividends
      status   'ok' | 'computing' | 'failed'
      failed:  reason 'source' (neither Massive read answered)
      ok:      window {from, to} (this week's Monday to next week's Sunday, New York dates, as read),
               current_window {from, to} (the same for today), stale_window (True while the held list
               is last week's and its replacement is being read), read_at (UTC instant of the read),
               source, check (a later look that failed, beside the held answer, or None),
               dividends [{sym, name, ex_date, amount, currency, frequency, type, pay_date,
                           declared_date, record_date}]  soonest ex-date first, then by symbol
               splits    [{sym, name, date, split_from, split_to, ratio, reverse}]  soonest first
               legs {dividends, splits}: 'ok' | 'failed' (one read may answer while the other fails)
               counts {dividends, splits (shown), not_followed_dividends, not_followed_splits}
               cut {dividends, splits}: True when more rows than the cap were listed (the LATEST days
                    are the ones left out)
               dropped {dividends, splits}: rows whose day is not a date, skipped and counted
               caps {dividends, splits}

THE SOURCE is the one the per-stock dividend calendar already reads (`dividends_calendar.py`):
Massive's reference dividends and splits endpoints, through `reference_corp_actions` (the one owned
wrapper around that feed, which reads through `massive_adapter`), the same data class (`reference`,
licence class LA for member display). Here they are asked by DATE RANGE with no ticker:
`fetch_market_dividends_strict` (`/v3/reference/dividends`, `ex_dividend_date.gte/.lte`) and
`fetch_confirmed_splits_strict` (`/v3/reference/splits`, `execution_date.gte/.lte`). Never a new
vendor.

WHICH STOCKS. Massive lists every US security that pays: funds, preferred shares, notes and stocks the
site does not follow. This list keeps only the stocks in the site's own universe
(`api/data/cap_universe.json`), so every symbol shown opens a board; how many were left out is said in
`counts`. The company name is the one the server already holds for the stock (`ticker_meta`, its
memory and disk cache, never a provider call); a stock with none held has `name: None`.

BOUNDED: at most `DIVIDEND_CAP` dividends and `SPLIT_CAP` splits (the universe is about 3,700 stocks,
so two weeks of payers fit well inside); past the cap the soonest days are kept and `cut` says so.

IT NEVER ASKS THE VENDOR ON A MEMBER'S REQUEST. The answer is held in this module (and on this server's
disk) through `api/services/held_build.py`, the house hold-and-build way: one background build makes
the two reads; a request with nothing held waits a few seconds on it and is otherwise told
`computing`. A refresh is due once the held list's lifetime has passed or the week has turned. The
lifetime is the per-stock read's own (`dividends_calendar._CACHE_TTL`, 12 hours; its
`_CACHE_TTL_PARTIAL`, 5 minutes, when one of the two reads failed), read at call time, so the whole
market costs at most two vendor reads (each a few pages) per window per lifetime, whatever the number
of members. A build where both reads fail is held for the short lifetime before the vendor is asked
again; the last good list is kept and the failed look is said beside it.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Any, Optional
from zoneinfo import ZoneInfo

from api.services import held_build
from api.services import held_reads
from api.services import reference_corp_actions as rca

SOURCE = "Massive reference data"
DISK_VERSION = 1
DIVIDEND_CAP = 2000
SPLIT_CAP = 300
_NY = ZoneInfo("America/New_York")
_ISO_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def today_et() -> date:
    return datetime.now(_NY).date()


def window(today: date) -> dict:
    """This week's Monday to next week's Sunday, as YYYY-MM-DD (weeks run Monday to Sunday)."""
    monday = today - timedelta(days=today.weekday())
    return {"from": monday.isoformat(), "to": (monday + timedelta(days=13)).isoformat()}


def universe() -> frozenset:
    """The site's stock universe (`held_reads.site_universe`, read once per process). Empty when the file
    cannot be read (then nothing is listed, and the panel says the feed listed stocks the site does not
    follow)."""
    return held_reads.site_universe()


def held_name(sym: str) -> Optional[str]:
    """The company name the server already holds for `sym` (`held_reads.held_name`), or None."""
    return held_reads.held_name(sym)


def _day(v: Any) -> Optional[str]:
    s = str(v or "")[:10]
    return s if _ISO_DAY.match(s) else None


def _amount(v: Any) -> Optional[float]:
    if isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f > 0 and f == f and f != float("inf") else None


def _int(v: Any) -> Optional[int]:
    if isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return int(f) if f == int(f) and f >= 0 else None


def _text(v: Any) -> Optional[str]:
    s = str(v).strip() if v is not None else ""
    return s or None


def shape_dividends(rows: list, followed: frozenset, name_of) -> tuple[list[dict], dict]:
    """Massive's rows -> the stocks the site follows, soonest first, deduplicated, capped."""
    out, seen, dropped, not_followed = [], set(), 0, 0
    for r in rows or []:
        if not isinstance(r, dict):
            dropped += 1
            continue
        sym = _text(r.get("ticker"))
        ex = _day(r.get("ex_dividend_date"))
        if not sym or not ex:
            dropped += 1
            continue
        sym = sym.upper()
        if sym not in followed:
            not_followed += 1
            continue
        row = {
            "sym": sym, "ex_date": ex, "amount": _amount(r.get("cash_amount")),
            "currency": (_text(r.get("currency")) or "").upper() or None,
            "frequency": _int(r.get("frequency")), "type": (_text(r.get("dividend_type")) or "").upper() or None,
            "pay_date": _day(r.get("pay_date")), "declared_date": _day(r.get("declaration_date")),
            "record_date": _day(r.get("record_date")),
        }
        key = (sym, ex, row["amount"], row["type"], row["pay_date"])
        if key in seen:
            continue
        seen.add(key)
        out.append(row)
    out.sort(key=lambda d: (d["ex_date"], d["sym"]))
    cut = len(out) > DIVIDEND_CAP
    out = out[:DIVIDEND_CAP]
    names: dict = {}
    for d in out:
        if d["sym"] not in names:
            names[d["sym"]] = name_of(d["sym"])
        d["name"] = names[d["sym"]]
    return out, {"dropped": dropped, "not_followed": not_followed, "cut": cut}


def shape_splits(rows: list, followed: frozenset, name_of) -> tuple[list[dict], dict]:
    out, seen, dropped, not_followed = [], set(), 0, 0
    for r in rows or []:
        if not isinstance(r, dict):
            dropped += 1
            continue
        sym = _text(r.get("ticker"))
        day = _day(r.get("execution_date"))
        if not sym or not day:
            dropped += 1
            continue
        sym = sym.upper()
        if sym not in followed:
            not_followed += 1
            continue
        if (sym, day) in seen:
            continue
        seen.add((sym, day))
        ratio = rca.split_ratio(r.get("split_from"), r.get("split_to"))
        out.append({
            "sym": sym, "date": day,
            "split_from": _amount(r.get("split_from")), "split_to": _amount(r.get("split_to")),
            "ratio": rca.split_ratio_label(ratio) if ratio is not None else None,
            "reverse": (ratio < 1) if ratio is not None else None,
            "name": name_of(sym),
        })
    out.sort(key=lambda s: (s["date"], s["sym"]))
    cut = len(out) > SPLIT_CAP
    return out[:SPLIT_CAP], {"dropped": dropped, "not_followed": not_followed, "cut": cut}


def build(_previous: Optional[dict] = None) -> tuple[dict, str]:
    """ONE build, on the background thread: the two date-range reads. Raises `held_build.Stop` when
    neither answered."""
    from api.services import dividends_calendar as per_stock

    win = window(today_et())
    legs = {"dividends": "ok", "splits": "ok"}
    try:
        div_rows = rca.fetch_market_dividends_strict(win["from"], win["to"])
    except rca.CorpActionsUnavailable:
        div_rows, legs["dividends"] = [], "failed"
    try:
        split_rows = rca.fetch_confirmed_splits_strict(win["from"], win["to"])
    except rca.CorpActionsUnavailable:
        split_rows, legs["splits"] = [], "failed"
    if legs["dividends"] == "failed" and legs["splits"] == "failed":
        raise held_build.Stop("failed", "source", hold=float(per_stock._CACHE_TTL_PARTIAL),
                              note=f"massive reference reads failed (dividends and splits) window={win['from']}..{win['to']}")
    followed = universe()
    dividends, dmeta = shape_dividends(div_rows, followed, held_name)
    splits, smeta = shape_splits(split_rows, followed, held_name)
    answer = {
        "status": "ok", "v": DISK_VERSION, "window": win, "read_at": held_build.now_iso(), "source": SOURCE,
        "dividends": dividends, "splits": splits, "legs": legs,
        "counts": {"dividends": len(dividends), "splits": len(splits),
                   "not_followed_dividends": dmeta["not_followed"], "not_followed_splits": smeta["not_followed"]},
        "cut": {"dividends": dmeta["cut"], "splits": smeta["cut"]},
        "dropped": {"dividends": dmeta["dropped"], "splits": smeta["dropped"]},
        "caps": {"dividends": DIVIDEND_CAP, "splits": SPLIT_CAP},
    }
    note = (f"massive reference window={win['from']}..{win['to']} dividends={len(div_rows)} splits={len(split_rows)} "
            f"followed={len(dividends)}+{len(splits)} legs={legs['dividends']},{legs['splits']}")
    return answer, note


def refresh_due(answer: dict, checked: float, now: Optional[float] = None, today: Optional[date] = None) -> bool:
    """Pure: a refresh is due when the held list is for another window, or its lifetime has passed
    (the per-stock read's 12 hours; 5 minutes when one of the two reads failed)."""
    from api.services import dividends_calendar as per_stock
    import time as _time

    if (answer or {}).get("window") != window(today or today_et()):
        return True
    legs = (answer or {}).get("legs") or {}
    partial = any(v != "ok" for v in legs.values())
    ttl = per_stock._CACHE_TTL_PARTIAL if partial else per_stock._CACHE_TTL
    return ((_time.time() if now is None else now) - float(checked or 0)) >= ttl


def _valid(held: dict) -> bool:
    return (held.get("status") == "ok" and held.get("v") == DISK_VERSION and isinstance(held.get("window"), dict)
            and isinstance(held.get("dividends"), list) and isinstance(held.get("splits"), list))


_held = held_build.HeldBuild("market-dividends", build, lambda answer, checked: refresh_due(answer, checked),
                             disk=("market_dividends", f"market_dividends_v{DISK_VERSION}.json"),
                             version=DISK_VERSION, valid=_valid)


def get_market_dividends(*, wait_s: Optional[float] = None) -> dict:
    """The route's body. Never builds on the caller's thread."""
    got = _held.get(wait_s=wait_s)
    if got.get("status") != "ok":
        return {**got, "source": SOURCE}
    current = window(today_et())
    out = {k: v for k, v in got.items() if k != "v"}
    out["current_window"] = current
    out["stale_window"] = got.get("window") != current
    return out


def reset_for_tests() -> None:
    _held.reset()
    held_reads.site_universe.cache_clear()
