"""Import a tweet -- the price of the stock when the post went out.

A CONFIDENT WRONG PRICE is the failure this module exists to avoid, so every doubt answers None:

  * An intraday bar is used only if it had fully CLOSED by the post (bar open <= post - bar length)
    and is no more than STALE_AFTER_S older than the post. The bar that contains the post is
    never used: its close is a price from after the post.
  * Otherwise the newest DAILY bar whose session closed before the post is used, labelled
    'close' with its date. A daily bar more than DAILY_MAX_GAP_DAYS before the target is not
    trusted (a delisted or stalled series would otherwise answer with an old price).
  * Any exception is None.

Bar timestamps: intraday `ts` is unix seconds, daily `ts` is YYYYMMDD (an int).
"""
from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from api.services import bars_sqlite, ticker_resolver

log = logging.getLogger(__name__)

ET = ZoneInfo("America/New_York")
INTRADAY_TFS = (("1", 60), ("5", 300))
STALE_AFTER_S = 1800
FETCH_MAX_AGE_S = 60 * 86400
DAILY_MAX_GAP_DAYS = 7
DAILY_LOOKBACK = 5
SESSION_RANGE_PAD = 0.02
EXTENDED_RANGE_PAD = 0.12
FETCH_BARS_CAP = 5000
REFRESH_POLL_S = 1.0
REFRESH_WINDOW_S = 86400
FETCH_POOL_WORKERS = 4

_FETCH_POOL = ThreadPoolExecutor(max_workers=FETCH_POOL_WORKERS, thread_name_prefix="tweet-price")

LABELS = ("posted", "premarket", "after_hours", "close")


@dataclass(frozen=True)
class PricePoint:
    symbol: str
    price: float
    label: str  # 'posted' | 'premarket' | 'after_hours' | 'close'
    session_date: Optional[str]  # ISO date, only for 'close'


def _norm(sym: str) -> str:
    return (sym or "").strip().upper().replace(".", "-")


def choose_symbol(note_ticker: Optional[str], tickers: list, text: str) -> Optional[str]:
    """The symbol to price. The note's own ticker if the post names it; otherwise the first
    cashtag in text order. None when the post carries no cashtag ticker."""
    known = {_norm(t): t for t in (tickers or []) if t}
    if not known:
        return None
    note = _norm(note_ticker or "")
    if note and note in known:
        return _norm(known[note])
    for sym in ticker_resolver.resolve_tickers(text or "", ticker_resolver.CASHTAG_POST):
        if _norm(sym) in known:
            return _norm(sym)
    return None


def _fetch_bars(symbol: str, tf: str, count: int) -> list:
    """One read through the member bars door. Rows (ts, o, h, l, c, v) like get_bars_before,
    or []. Imported lazily to stay out of import cycles."""
    import json

    from api.routers.bars import serve_bars

    resp = serve_bars(symbol, tf, count)
    if getattr(resp, "status_code", 200) != 200:
        return []
    body = json.loads(resp.body)
    out = []
    for b in body.get("bars") or []:
        t = b.get("t")
        if isinstance(t, str):
            t = int(t[:10].replace("-", ""))
        out.append((int(t), b["o"], b["h"], b["l"], b["c"], b.get("v") or 0))
    return out


def _read_bars(symbol: str, tf: str, count: int, wait_until: Optional[float]) -> list:
    """`_fetch_bars`, abandoned at `wait_until`: a read of a cold ticker can block on the vendor,
    and an import must not. The abandoned read finishes on its own pool thread and still fills the
    store. Without `wait_until` it runs here, unbounded."""
    if wait_until is None:
        return _fetch_bars(symbol, tf, count)
    remaining = wait_until - time.monotonic()
    if remaining <= 0:
        return []
    future = _FETCH_POOL.submit(_fetch_bars, symbol, tf, count)
    try:
        return future.result(timeout=remaining)
    except FutureTimeout:
        future.cancel()
        return []


def _label_for(ts: int) -> Optional[str]:
    dt = datetime.fromtimestamp(ts, ET)
    minutes = dt.hour * 60 + dt.minute
    if 9 * 60 + 30 <= minutes < 16 * 60:
        return "posted"
    if 4 * 60 <= minutes < 9 * 60 + 30:
        return "premarket"
    if 16 * 60 <= minutes < 20 * 60:
        return "after_hours"
    return None


def _intraday_pick(rows: list, tf_s: int, posted_at: int) -> Optional[tuple]:
    cutoff = posted_at - tf_s
    best = None
    for r in rows or []:
        if r[0] <= cutoff and (best is None or r[0] > best[0]):
            best = r
    if best is None or posted_at - best[0] > STALE_AFTER_S:
        return None
    return best


def _ymd(d: date) -> int:
    return d.year * 10000 + d.month * 100 + d.day


def _parse_ymd(k: int) -> date:
    return date(k // 10000, (k // 100) % 100, k % 100)


def _daily_pick(rows: list, key: int) -> Optional[tuple]:
    best = None
    for r in rows or []:
        # A market has no Saturday. A stray weekend row in the store must not become a "close".
        if r[0] <= key and _parse_ymd(int(r[0])).weekday() < 5 and (best is None or r[0] > best[0]):
            best = r
    if best is None:
        return None
    if (_parse_ymd(key) - _parse_ymd(int(best[0]))).days > DAILY_MAX_GAP_DAYS:
        return None
    return best


def _closed_session_key(posted_at: int) -> int:
    """Newest session date whose 16:00 ET close is at or before the post (weekend and holiday
    fall out because the daily read takes the newest bar at or before this key)."""
    dt = datetime.fromtimestamp(posted_at, ET)
    d = dt.date()
    if dt.weekday() < 5 and dt.hour >= 16:
        return _ymd(d)
    return _ymd(d - timedelta(days=1))


def awaits_refresh(posted_at: int) -> bool:
    """True when a read that found nothing is worth repeating: a post from the last day, on a
    weekday, inside the hours that have bars. A night or weekend post has no bar to wait for."""
    posted_at = int(posted_at)
    return (time.time() - posted_at < REFRESH_WINDOW_S
            and datetime.fromtimestamp(posted_at, ET).weekday() < 5
            and _label_for(posted_at) is not None)


def start_refresh(symbol: str, wait_until: Optional[float] = None) -> None:
    """Ask for `symbol`'s bars so a stale store starts refreshing. Serving a ticker nobody has
    charted lately answers with what is stored and refreshes behind the answer (5-10 s, measured
    on production 2026-11-09), so the read that starts it cannot be the read that uses it."""
    try:
        _read_bars(_norm(symbol), "5", 200, wait_until)
    except Exception:
        log.warning("tweet_price: start_refresh failed", exc_info=True)


def price_at_post(symbol: str, posted_at: int, wait_until: Optional[float] = None) -> Optional[PricePoint]:
    """`wait_until` (a `time.monotonic()` instant, shared across one import) lets a recent post
    wait for its ticker's refresh, and is the limit on every read of the bars door: past it, only
    the local store answers. Without it, one read decides."""
    try:
        sym = _norm(symbol)
        posted_at = int(posted_at)
        if not sym:
            return None
        fetchable = (time.time() - posted_at) < FETCH_MAX_AGE_S
        fetched = False

        picked = None
        for tf, tf_s in INTRADAY_TFS:
            rows = bars_sqlite.get_bars_before(sym, tf, 1, posted_at - tf_s)
            picked = _intraday_pick(rows, tf_s, posted_at)
            if picked:
                break
        if not picked and fetchable:
            fetched = True
            age_days = max(0.0, (time.time() - posted_at) / 86400)
            count = min(FETCH_BARS_CAP, int(age_days * 80) + 200)
            picked = _intraday_pick(_read_bars(sym, "5", count, wait_until), 300, posted_at)
            while (not picked and wait_until is not None and awaits_refresh(posted_at)
                   and time.monotonic() < wait_until):
                time.sleep(REFRESH_POLL_S)
                picked = _intraday_pick(_read_bars(sym, "5", count, wait_until), 300, posted_at)
        if picked:
            label = _label_for(int(picked[0]))
            if label:
                return PricePoint(sym, float(picked[4]), label, None)

        key = _closed_session_key(posted_at)
        daily = _daily_pick(bars_sqlite.get_bars_before(sym, "D", DAILY_LOOKBACK, key), key)
        if not daily and fetchable and not fetched:
            age_days = max(0.0, (time.time() - posted_at) / 86400)
            daily = _daily_pick(_read_bars(sym, "D", int(age_days) + 20, wait_until), key)
        if not daily:
            return None
        d = _parse_ymd(int(daily[0]))
        return PricePoint(sym, float(daily[4]), "close", d.isoformat())
    except Exception:
        log.warning("tweet_price: price_at_post failed", exc_info=True)
        return None


def still_comparable(symbol: str, posted_at: int, price: float,
                     label: Optional[str] = None, session_date: Optional[str] = None) -> bool:
    """False when a split has happened since the price was stored: daily bars are restated for a
    split and the stored price is not, so the price falls outside its own session's restated
    range. A 3-for-2 moves it 33%, too little for a flat percentage to tell from a big day. True
    when no bar for that exact session exists, and for today's session, whose bar is still
    forming and which no split can have followed."""
    try:
        sym = _norm(symbol)
        if label == "close" and session_date:
            day = date.fromisoformat(session_date)
        else:
            day = datetime.fromtimestamp(int(posted_at), ET).date()
        if day >= datetime.fromtimestamp(time.time(), ET).date():
            return True
        key = _ymd(day)
        rows = bars_sqlite.get_bars_before(sym, "D", 1, key)
        bar = rows[-1] if rows else None
        if not bar or int(bar[0]) != key:
            return True
        high, low = float(bar[2]), float(bar[3])
        if low <= 0:
            return True
        pad = SESSION_RANGE_PAD if label in ("posted", "close") else EXTENDED_RANGE_PAD
        return low * (1 - pad) <= float(price) <= high * (1 + pad)
    except Exception:
        log.warning("tweet_price: still_comparable failed", exc_info=True)
        return False
