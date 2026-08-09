"""Generates call recaps ahead of the reader.

The requirement is "under 2-3 seconds even for the FIRST user". A ~39s
transcript-grounded synthesis cannot meet that on the request path at any level
of optimisation, so the request path stops generating entirely: it reads the
durable store, and this warmer is what puts things in it.

Ordering is the whole design. On a heavy day more companies report than it is
worth generating for, so the queue is priority-ordered and the budget is spent
top-down:

  1. names in ANY user's watchlists / flagged list / open positions — the ones
     someone is actually going to open
  2. UCT20 leadership
  3. everyone else who reported, most recent call first

A name outside the budget is not broken, just not pre-warmed: its transcript
still opens in ~1-2s and the recap fills in on the next sweep.
"""
from __future__ import annotations

import logging
import os
import time
from typing import Any, Callable, Optional

_log = logging.getLogger(__name__)

# How far back to consider a call "recent enough that someone may open it".
LOOKBACK_DAYS = int(os.environ.get("CALL_RECAP_WARM_LOOKBACK_DAYS", "7"))
# Wall-clock ceiling so a sweep cannot run into the next scheduled job.
MAX_SECONDS = int(os.environ.get("CALL_RECAP_WARM_MAX_SECONDS", "3600"))
# Politeness between generations — this shares an Anthropic budget with Compass.
PACE_SECONDS = float(os.environ.get("CALL_RECAP_WARM_PACE_SECONDS", "1.0"))


def enabled() -> bool:
    return os.environ.get("CALL_RECAP_WARM_ENABLED", "").strip() == "1"


def _user_symbols() -> set[str]:
    """Every symbol any user has expressed interest in.

    These are the names that get opened, so they are warmed first. Read
    defensively: a schema change in any one source must not stop the sweep.
    """
    syms: set[str] = set()
    try:
        from api.services import auth_db
        with auth_db.get_conn() as c:
            for table, col in (("watchlist_items", "sym"), ("ticker_tags", "sym")):
                try:
                    for (s,) in c.execute(f"SELECT DISTINCT {col} FROM {table}"):
                        if s:
                            syms.add(s.upper().strip())
                except Exception:
                    continue
            try:
                for (s,) in c.execute(
                        "SELECT DISTINCT symbol FROM j2_positions WHERE closed_at IS NULL"):
                    if s:
                        syms.add(s.upper().strip())
            except Exception:
                pass
    except Exception as exc:
        _log.debug("[recap_warm] user symbols unavailable: %s", exc)
    return syms


def _leadership_symbols() -> set[str]:
    try:
        from api.services.engine import get_leadership
        return {(r.get("ticker") or r.get("sym") or "").upper().strip()
                for r in (get_leadership() or []) if isinstance(r, dict)} - {""}
    except Exception:
        return set()


def build_queue(reporters: list[str],
                user_syms: Optional[set[str]] = None,
                leaders: Optional[set[str]] = None) -> list[str]:
    """Reporters, ordered by how likely they are to be opened.

    Pure so the ordering is testable without a DB — the ordering IS the feature
    when the budget runs out partway down.
    """
    user_syms = user_syms if user_syms is not None else _user_symbols()
    leaders = leaders if leaders is not None else _leadership_symbols()

    tier1, tier2, tier3, seen = [], [], [], set()
    for raw in reporters or []:
        s = (raw or "").upper().strip()
        if not s or s in seen:
            continue
        seen.add(s)
        (tier1 if s in user_syms else tier2 if s in leaders else tier3).append(s)
    return tier1 + tier2 + tier3


def warm_symbol(symbol: str, *, fetch_transcript: Callable = None,
                synthesize: Callable = None, store=None) -> str:
    """Generate and store one recap. Returns an outcome word for the summary."""
    if store is None:
        from api.services import call_recap_store as store
    if fetch_transcript is None:
        from api.services.fmp_transcripts import get_transcript as fetch_transcript
    if synthesize is None:
        from api.services.call_recap_grounded import synthesize

    sym = (symbol or "").upper().strip()
    if not sym:
        return "skipped"

    try:
        transcript = fetch_transcript(sym)
    except Exception as exc:
        _log.warning("[recap_warm] transcript failed for %s: %s", sym, exc)
        return "no_transcript"
    if not transcript or not transcript.get("segments"):
        return "no_transcript"

    quarter = transcript.get("quarter") or ""
    # Skip BEFORE spending anything — the sweep is incremental by design, so an
    # interrupted run costs only time, never repeated money.
    if store.has(sym, quarter):
        return "already"

    if not store.may_spend():
        return "capped"

    try:
        recap = synthesize(sym, transcript)
    except Exception as exc:
        _log.warning("[recap_warm] synthesis failed for %s: %s", sym, exc)
        return "failed"
    if not recap:
        return "failed"

    # Measured over HTTP: a warmed recap still took 4.55s because the endpoint
    # also calls get_webcast_url (a Perplexity round-trip) and
    # get_rating_changes (a provider call) in the same handler. Warming them
    # here makes the served payload complete — otherwise the store read is
    # instant and the response is not.
    for key, fn in (("webcast_url", "get_webcast_url"),
                    ("rating_changes", "get_rating_changes")):
        try:
            from api.services import call_recap as _cr
            recap[key] = getattr(_cr, fn)(sym)
        except Exception as exc:
            _log.debug("[recap_warm] %s failed for %s: %s", key, sym, exc)
            recap.setdefault(key, None)

    store.record_spend(sym, recap.get("_usage") or {})
    store.put(sym, quarter, recap)
    return "warmed"


def run_sweep(reporters: list[str], *, now=time.monotonic, sleep=time.sleep,
              warm=warm_symbol, store=None) -> dict[str, Any]:
    """Warm the reporter set in priority order, within budget and clock."""
    if not enabled():
        return {"skipped": "disabled"}
    if store is None:
        from api.services import call_recap_store as store
    store.init_db()

    queue = build_queue(reporters)
    counts: dict[str, int] = {}
    started = now()
    last: Optional[str] = None

    for sym in queue:
        if now() - started > MAX_SECONDS:
            counts["timed_out"] = counts.get("timed_out", 0) + 1
            break
        outcome = warm(sym)
        counts[outcome] = counts.get(outcome, 0) + 1
        last = sym
        if outcome == "capped":
            # Every remaining name would report the same; stop rather than
            # logging a misleading run of identical outcomes.
            break
        if outcome == "warmed" and PACE_SECONDS:
            sleep(PACE_SECONDS)

    # Report WORK DONE, not merely that the sweep ran — a count-based monitor
    # cannot otherwise tell a capped sweep from a healthy one.
    return {"queued": len(queue), "last_symbol": last,
            "spend_today_usd": round(store.spend_today(), 4), **counts}
