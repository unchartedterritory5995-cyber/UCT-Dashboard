"""Watchlist Intelligence V1 (owner authorization, Watchlist Intelligence
Convergence program) -- a deterministic "why is this security active" layer
over a batch of watchlist symbols.

Composes ALREADY-EXISTING, already-trusted per-symbol services -- no new
intelligence engine, no S3 Entity Master retrofit, no new S11 session-calendar
module. Every date on a fact comes from that fact's own evidence (a filing's
`filed` date, an earnings report date, an analyst action's own timestamp) --
never `datetime.now()`/`date.today()` -- the same lesson the Pattern Vision
holiday/evidence-date fix (2026-09-05) already paid for.

`notable` is a plain OR over the facts that fired -- never a weighted score --
so a caller can always see exactly which fact made a symbol notable.
"""
from __future__ import annotations

import datetime
import logging
from typing import Any, Optional

log = logging.getLogger(__name__)

# Matches api/services/massive.py::get_movers()'s own gap-filter threshold --
# "only stocks with abs(change_pct) >= 3.0% are shown". Not re-derived here;
# just reused so the two "notable move" definitions in this codebase agree.
_PRICE_MOVE_THRESHOLD_PCT = 3.0

# Matches api/services/awareness/rules.py::EARNINGS_PROXIMITY_DEFAULT_DAYS --
# reused so "reporting soon" means the same thing here as it does in the
# awareness engine, rather than a second, silently-different definition.
_EARNINGS_PROXIMITY_DAYS = 3

# A filing newer than this many CALENDAR days counts as "new" -- a plain
# calendar-day approximation (no trading-day calendar exists anywhere in this
# codebase to borrow; the Pattern Vision holiday fix confirmed this gap, and
# fixing it is explicitly out of this program's scope). Errs toward showing a
# filing a little longer over a weekend/holiday rather than dropping it.
_FILING_RECENCY_DAYS = 5


def _fact(kind: str, label: str, as_of: Optional[str], source: str, freshness: str = "unknown") -> dict:
    return {"kind": kind, "label": label, "as_of": as_of, "source": source, "freshness": freshness}


def _price_move_fact(sym: str, change_pct: Optional[float]) -> Optional[dict]:
    if change_pct is None or not isinstance(change_pct, (int, float)):
        return None
    if abs(change_pct) < _PRICE_MOVE_THRESHOLD_PCT:
        return None
    sign = "+" if change_pct >= 0 else ""
    # No evidence timestamp accompanies `change_pct` anywhere in the current
    # pipeline (S9 Phase A, 2026-09-06) -- `changes` is a bare {SYM: pct}
    # dict end-to-end, so a stamped date here would be wall-clock, not
    # evidence-derived (the prior `date.today()` misrepresented a Saturday
    # call on a Friday closed-market carryover move as "today"). Honest
    # `None` (consumers already null-guard `as_of`) until a real per-symbol
    # timestamp is threaded through -- deferred, see Seam 8.
    return _fact(
        "price_move", f"Moving {sign}{change_pct:.1f}% today",
        as_of=None,
        source="live price", freshness="fresh",
    )


def _analyst_fact(sym: str) -> Optional[dict]:
    from api.services.research.analyst_ratings import get_analyst_ratings
    # S9 (2026-09-06): `outage` distinguishes "the analyst-data provider
    # genuinely failed this round" from "this ticker has no analyst
    # coverage" -- both used to collapse to the same falsy shape here,
    # silently masking a real source outage as "ok, nothing notable."
    outage: dict = {}
    data = get_analyst_ratings(sym, outage_out=outage) or {}
    if outage.get("outage"):
        raise RuntimeError("analyst ratings source outage")
    actions = ((data.get("recent_actions") or {}).get("items")) or []
    if not actions:
        return None
    latest = actions[0]
    meta = (data.get("recent_actions") or {}).get("_meta") or {}
    firm = latest.get("firm") or latest.get("analyst") or "an analyst"
    action = latest.get("action") or latest.get("grade") or "rating action"
    as_of = latest.get("date") or meta.get("sourceObservedAt") or meta.get("fetchedAt")
    freshness = meta.get("freshnessClass") or ("degraded" if meta.get("degraded") else "unknown")
    return _fact(
        "analyst_action", f"{firm}: {action}",
        as_of=str(as_of)[:10] if as_of else None,
        source=meta.get("vendor") or "analyst ratings", freshness=freshness,
    )


def _filing_fact(sym: str) -> Optional[dict]:
    from api.services.sec_filings import recent_filings
    data = recent_filings(sym, form_type="", count=1)
    if not isinstance(data, dict) or data.get("error"):
        raise RuntimeError(data.get("error") if isinstance(data, dict) else "sec_filings unavailable")
    filings = data.get("filings") or []
    if not filings:
        return None
    latest = filings[0]
    filed = latest.get("filed")
    if not filed:
        return None
    try:
        filed_date = datetime.date.fromisoformat(filed[:10])
    except ValueError:
        return None
    age_days = (datetime.date.today() - filed_date).days
    if age_days < 0 or age_days > _FILING_RECENCY_DAYS:
        return None
    return _fact(
        "new_filing", f"New {latest.get('form') or 'filing'} filed",
        as_of=filed_date.isoformat(), source="SEC EDGAR", freshness="fresh",
    )


def _earnings_facts(symbols: list[str]) -> tuple[dict[str, dict], bool]:
    """{SYM: fact} for symbols reporting within _EARNINGS_PROXIMITY_DAYS, plus
    whether every day in the window was answered by a leg that actually ran
    cleanly (see calendar_alerts._get_reporters_for_date_with_status's own
    docstring for exactly what counts as clean).

    Mirrors api/services/awareness/engine.py::_collect_earnings_window's own
    algorithm (walk the window day-by-day via calendar_alerts' per-date
    reporter lookup) rather than importing that module's private, engine-owned
    memoization -- this is a one-shot on-demand batch, not a recurring scan.

    This is a SHARED, batch-level source: one lookup answers for every
    requested symbol, so the caller applies a single day's genuine failure to
    every symbol in the batch (S9, 2026-09-06) -- `_get_reporters_for_date`'s
    own 3-leg fallback chain (cache -> Finnhub -> FMP) never raises by
    design, so without the `_with_status` variant a total outage was
    indistinguishable from a genuinely quiet week and never degraded status.
    """
    from api.services.calendar_alerts import _get_reporters_for_date_with_status

    wanted = {s.upper() for s in symbols}
    out: dict[str, dict] = {}
    any_day_failed = False
    today = datetime.date.today()
    for offset in range(0, _EARNINGS_PROXIMITY_DAYS + 1):
        d = today + datetime.timedelta(days=offset)
        d_str = d.isoformat()
        try:
            reporters, ok = _get_reporters_for_date_with_status(d_str)
        except Exception as e:  # noqa: BLE001 -- defensive backstop; the callee's own contract is "never raises"
            log.warning("[watchlist_intelligence] earnings lookup failed for %s: %s", d_str, e)
            any_day_failed = True
            continue
        if not ok:
            any_day_failed = True
        for sym in reporters & wanted:
            if sym in out:
                continue  # earliest offset wins
            when = "today" if offset == 0 else "tomorrow" if offset == 1 else f"in {offset} days"
            out[sym] = _fact(
                "earnings_proximity", f"Reports earnings {when}",
                as_of=d_str, source="earnings calendar", freshness="fresh",
            )
    return out, any_day_failed


def _rating_context(sym: str) -> dict:
    """Informational current-value context (NOT a "changed" fact -- no
    rating-HISTORY source was confirmed to exist in Phase A, so no delta is
    fabricated here). Returned separately from `facts` so a caller can never
    mistake "here is the current rating" for "this rating just changed"."""
    ctx: dict[str, Any] = {"composite_rating": None, "rs_rank": None}
    try:
        from api.services.research.ratings import get_ratings
        r = get_ratings(sym) or {}
        ctx["composite_rating"] = r.get("composite")
    except Exception as e:
        log.warning("[watchlist_intelligence] ratings context failed for %s: %s", sym, e)
    try:
        from api.services.rs_ranking import get_rs_for_ticker
        rs = get_rs_for_ticker(sym)
        if rs:
            ctx["rs_rank"] = rs.get("rs_rank")
    except Exception as e:
        log.warning("[watchlist_intelligence] rs context failed for %s: %s", sym, e)
    return ctx


def get_intelligence_for_symbols(tickers: list[str], changes: Optional[dict[str, float]] = None) -> dict[str, dict]:
    """{SYM: {status, notable, facts, context}} for every requested symbol.

    status: "ok" (every source reachable) | "partial" (some sources failed,
    some facts may still be present) | "unavailable" (every source failed).
    Never conflates "zero facts fired" with "we couldn't check" -- a caller
    reads `status`, not the emptiness of `facts`, to tell those apart.
    """
    changes = changes or {}
    symbols = [(t or "").upper().strip() for t in (tickers or []) if t]
    symbols = list(dict.fromkeys(symbols))  # dedupe, keep order
    if not symbols:
        return {}

    earnings_by_sym, earnings_batch_failed = _earnings_facts(symbols)

    out: dict[str, dict] = {}
    for sym in symbols:
        facts: list[dict] = []
        sources_total = 3  # analyst, filing, earnings (price-move is caller-supplied, not a "source" that can fail)
        sources_failed = 0

        pm = _price_move_fact(sym, changes.get(sym))
        if pm:
            facts.append(pm)

        try:
            af = _analyst_fact(sym)
            if af:
                facts.append(af)
        except Exception as e:
            sources_failed += 1
            log.warning("[watchlist_intelligence] analyst fact failed for %s: %s", sym, e)

        try:
            ff = _filing_fact(sym)
            if ff:
                facts.append(ff)
        except Exception as e:
            sources_failed += 1
            log.warning("[watchlist_intelligence] filing fact failed for %s: %s", sym, e)

        ef = earnings_by_sym.get(sym)
        if ef:
            facts.append(ef)
        if earnings_batch_failed:
            # Earnings is a shared, batch-level source (one lookup answers
            # for every requested symbol) -- a day the batch could not trust
            # degrades every symbol's status uniformly (S9, 2026-09-06), not
            # just the ones that happened to have an earnings fact fire.
            sources_failed += 1

        status = "ok" if sources_failed == 0 else ("partial" if sources_failed < sources_total else "unavailable")

        out[sym] = {
            "status": status,
            "notable": bool(facts),  # plain OR over whatever fired -- never a weighted score
            "facts": facts,
            "context": _rating_context(sym),
        }
    return out
