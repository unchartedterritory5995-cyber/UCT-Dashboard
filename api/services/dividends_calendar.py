"""Forward dividends and splits calendar service.

Builds a forward-looking (date >= today) list of dividends and splits for a
set of symbols from Massive reference data (`/v3/reference/dividends` and
`/v3/reference/splits`), read through `reference_corp_actions` -- the one
owned wrapper around that feed.

Normalized output per event:
  { sym, type: 'dividend' | 'split', date, amount | ratio, source, entity }

  dividend: { sym, type='dividend', date (YYYY-MM-DD ex-date), amount (float) }
  split:    { sym, type='split',    date (YYYY-MM-DD),         ratio (str, e.g. '4:1') }

Cached 12 hours per symbol-set key.  Never raises — returns [] on any failure.

2026-09-03 A5 modernization: every event carries a canonical `entity` from
Entity Master (`resolve_entity`) — never a raw ticker as the row's only
identity.

2026-09-27 TERM-036 (FB-D5-02): the source moved off yfinance (an explicit
risk-acceptance, D-004 — Yahoo sells no licence) onto Massive reference, the
one Massive class already cleared for external publication. Every event is
stamped `source: 'massive'`. A symbol whose Massive read FAILED is counted as
incomplete (short cache TTL), never as "no dividend, no split". The dividend
`amount` is now the DECLARED cash amount of that ex-date, where yfinance gave
the most recent PAID amount.
"""

from __future__ import annotations
import logging
from datetime import date

from api.services import reference_corp_actions
from api.services.cache import cache
from api.services.cache_policy import set_by_completeness
from api.services.research.entity_resolution import resolve_entity

_logger = logging.getLogger(__name__)

_CACHE_TTL = 43_200  # 12 hours
_CACHE_TTL_PARTIAL = 300  # a symbol shed by the 25s deadline self-heals in 5 min, not 12h


def _syms_cache_key(syms: list[str]) -> str:
    """Stable cache key for an ordered, deduped sym list."""
    key_syms = ",".join(sorted(set(s.upper() for s in syms)))
    return f"dividends_calendar_{key_syms}"


def _get_forward_dividend(sym: str, today: date) -> dict | None:
    """The next forward ex-dividend event (ONE per symbol, as before).
    Raises `reference_corp_actions.CorpActionsUnavailable` on a vendor failure."""
    today_iso = today.isoformat()
    for row in reference_corp_actions.fetch_ticker_dividends(sym, gte=today_iso):
        ex = row.get("ex_dividend_date")
        if not ex or ex < today_iso:
            continue  # already gone ex
        try:
            amount = float(row["cash_amount"]) if row.get("cash_amount") is not None else None
        except (TypeError, ValueError):
            amount = None
        return {
            "sym":    sym.upper(),
            "type":   "dividend",
            "date":   ex,
            "amount": amount,
            "source": reference_corp_actions.SOURCE,
        }
    return None


def _get_forward_splits(sym: str, today: date) -> list[dict]:
    """Every forward-dated split. Raises `CorpActionsUnavailable` on a vendor failure."""
    today_iso = today.isoformat()
    results = []
    for row in reference_corp_actions.fetch_ticker_splits(sym, gte=today_iso):
        date_str = row.get("execution_date")
        if not date_str or date_str < today_iso:
            continue
        r = reference_corp_actions.split_ratio(row.get("split_from"), row.get("split_to"))
        if r is None:
            continue
        results.append({
            "sym":    sym.upper(),
            "type":   "split",
            "date":   date_str,
            "ratio":  reference_corp_actions.split_ratio_label(r),
            "source": reference_corp_actions.SOURCE,
        })
    return results


def get_events(syms: list[str]) -> list[dict]:
    """The rows alone; `get_events_with_status` also says whether every symbol answered."""
    return get_events_with_status(syms)[0]


def _partial_key(cache_key: str) -> str:
    return f"{cache_key}::partial"


def _clean(syms: list[str]) -> list[str]:
    return sorted({s.strip().upper() for s in (syms or []) if s and s.strip()})[:200]


def read_partial(syms: list[str]) -> bool:
    """True while the last read of this symbol set was incomplete (a Massive read failed or
    was shed). The route asks this after `get_events` to label the answer."""
    clean = _clean(syms)
    return bool(clean) and bool(cache.get(_partial_key(_syms_cache_key(clean))))


def get_events_with_status(syms: list[str]) -> tuple[list[dict], bool]:
    """`(events, complete)`. `complete` is False when any symbol's Massive read failed or was
    shed by the deadline, so the list may be missing that symbol's events (quality pass
    2026-10-05: the calendar's dividend chips vanished silently on a failed read).

    Return forward dividends + splits for the given symbols.

    Result: list of { sym, type: 'dividend'|'split', date, amount? (dividend), ratio? (split) }
    Only events with date >= today are returned.
    Cached 12 h per symbol-set.  Never raises — returns [] on any failure.

    Args:
        syms: list of ticker strings (case-insensitive)
    """
    if not syms:
        return [], True

    clean_syms = sorted({s.strip().upper() for s in syms if s and s.strip()})
    if not clean_syms:
        return [], True

    # Cap at 200 to prevent a large My-Stocks set from hanging the request
    # (two Massive reads per symbol).
    clean_syms = clean_syms[:200]

    cache_key = _syms_cache_key(clean_syms)
    cached = cache.get(cache_key)
    if cached is not None:
        return cached, not cache.get(_partial_key(cache_key))

    today = date.today()
    results: list[dict] = []

    # Parallelize + hard-deadline the per-symbol vendor work. Sequentially this
    # was up to 200 x ~1s (tens of seconds). An 8-wide pool + a 25s total
    # deadline + non-blocking shutdown keeps the request bounded. (2026-07-01)
    from concurrent.futures import ThreadPoolExecutor
    import time as _time

    def _one(sym: str) -> tuple[list[dict], bool]:
        """(events, answered). `answered` is False when either Massive read
        failed -- that symbol's missing events are UNKNOWN, not absent."""
        out: list[dict] = []
        answered = True
        try:
            div_event = _get_forward_dividend(sym, today)
            if div_event:
                out.append(div_event)
        except reference_corp_actions.CorpActionsUnavailable as exc:
            answered = False
            _logger.warning("dividends_calendar: Massive dividends unavailable for %s: %s", sym, exc)
        try:
            out.extend(_get_forward_splits(sym, today))
        except reference_corp_actions.CorpActionsUnavailable as exc:
            answered = False
            _logger.warning("dividends_calendar: Massive splits unavailable for %s: %s", sym, exc)
        return out, answered

    ex = ThreadPoolExecutor(max_workers=8, thread_name_prefix="div-cal")
    futures = [ex.submit(_one, s) for s in clean_syms]
    deadline = _time.monotonic() + 25.0
    completed = 0
    for fut in futures:
        try:
            events, answered = fut.result(timeout=max(0.0, deadline - _time.monotonic()))
            results.extend(events)
            if answered:
                completed += 1
        except Exception:
            pass
    ex.shutdown(wait=False, cancel_futures=True)

    # Sort by date ascending
    results.sort(key=lambda e: e.get("date") or "")

    # Canonical entity (S3) per symbol -- resolved once per symbol even when
    # that symbol contributed both a dividend and a split event.
    _entity_by_sym: dict[str, dict] = {}
    for event in results:
        sym = event.get("sym")
        if not sym:
            continue
        if sym not in _entity_by_sym:
            entity, _effective_sym = resolve_entity(sym)
            _entity_by_sym[sym] = entity
        event["entity"] = _entity_by_sym[sym]

    # The 25s deadline shed above is correct (bounds the request path against
    # a hung vendor call) -- but caching the SHED result at the 12h success
    # TTL is not: the missing symbols' events are indistinguishable from
    # "pays no dividend, no splits." The same holds for a symbol whose Massive
    # read FAILED (TERM-036). `completed < len(futures)` is the exact
    # per-leg signal (every symbol either answered, failed or timed out), not a
    # truthiness check on `results` (a fully-completed but genuinely
    # dividend-free batch must still get the full TTL).
    complete = completed == len(futures)
    set_by_completeness(
        cache_key, results,
        complete=complete,
        ttl_ok=_CACHE_TTL,
        ttl_partial=_CACHE_TTL_PARTIAL,
    )
    if not complete:
        # Lives exactly as long as the partial entry, so a cache hit still says "partial".
        cache.set(_partial_key(cache_key), True, ttl=_CACHE_TTL_PARTIAL)
    else:
        cache.invalidate(_partial_key(cache_key))
    return results, complete
