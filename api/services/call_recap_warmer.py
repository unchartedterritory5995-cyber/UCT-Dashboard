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
import re
import threading
import time
from datetime import datetime
from typing import Any, Callable, Optional

_log = logging.getLogger(__name__)

# How far back to consider a call "recent enough that someone may open it".
LOOKBACK_DAYS = int(os.environ.get("CALL_RECAP_WARM_LOOKBACK_DAYS", "7"))
# Wall-clock ceiling so a sweep cannot run into the next scheduled job.
MAX_SECONDS = int(os.environ.get("CALL_RECAP_WARM_MAX_SECONDS", "3600"))
# Politeness between generations — this shares an Anthropic budget with Compass.
PACE_SECONDS = float(os.environ.get("CALL_RECAP_WARM_PACE_SECONDS", "1.0"))


_SWEEP_LOCK = threading.Lock()


def enabled() -> bool:
    return os.environ.get("CALL_RECAP_WARM_ENABLED", "").strip() == "1"


def _user_symbols() -> set[str]:
    """Every symbol any user has expressed interest in.

    These are the names that get opened, so they are warmed first. Read
    defensively: a schema change in any one source must not stop the sweep.
    """
    syms: set[str] = set()
    try:
        import contextlib

        from api.services import auth_db
        # X24 (2026-08-26): this said `auth_db.get_conn()`, which has never
        # existed (`get_connection` is the only public door), so the
        # AttributeError fell into the `except` below and this warmer never
        # once read a watchlist, a tag, or an open position. One of THREE
        # copies in three spellings; railed by
        # `tests/test_auth_db_names_are_real.py`.
        # `closing(...)` because a bare `with` on a sqlite3 connection manages
        # the TRANSACTION, not the handle -- it would leak the connection.
        with contextlib.closing(auth_db.get_connection()) as c:
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


_US_TICKER_RE = re.compile(r"^[A-Z]{1,5}(?:-[A-Z])?$")
_UNIVERSE: Optional[set] = None


def _universe() -> set:
    """The tickers this dashboard actually charts (cap_universe.json).

    Load-bearing, not a nicety. Unfiltered, a week of the earnings calendar is
    ~5,000 names and most are foreign listings (600641.SS, PNCINFRA.NS,
    4324.SR) with no FMP transcript: the sweep would spend its whole clock on
    lookups that cannot succeed, and DIS would sit at queue position ~3,250 —
    never reached. Resolved from __file__, never the CWD, because this runs
    from a worktree and from Railway.
    """
    global _UNIVERSE
    if _UNIVERSE is None:
        path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "data", "cap_universe.json")
        try:
            import json
            with open(path, encoding="utf-8") as fh:
                data = json.load(fh)
            rows = data if isinstance(data, list) else (data or {}).get("tickers") or []
            _UNIVERSE = {t.upper().strip() for t in rows if isinstance(t, str)}
        except Exception as exc:
            _log.warning("[recap_warm] cap_universe unavailable (%s); "
                         "falling back to a US-ticker shape filter", exc)
            _UNIVERSE = set()
    return _UNIVERSE


def _tradeable(sym: str) -> bool:
    uni = _universe()
    # An empty universe means the file failed to load. Fall back to the ticker
    # SHAPE rather than to no filter at all — silently restoring the 5,000-name
    # queue would look like it was working.
    return sym in uni if uni else bool(_US_TICKER_RE.match(sym))


def recent_reporters(days: Optional[int] = None, today=None,
                     fmp_get: Callable = None) -> list[str]:
    """Symbols whose results are ALREADY OUT, most recent day first.

    Today's calendar is not a sufficient queue. A company that reported on
    Wednesday is never swept again, so its recap stays cold until some reader
    pays the ~39s for it — which is exactly the wait this whole design exists to
    remove. This walks back LOOKBACK_DAYS so the recent tape is covered.

    Queried ONE DAY AT A TIME deliberately: a from/to range response is capped at
    4000 rows and drops issuers silently — DIS is absent from an 8-day range and
    present in its own single day. A cap that truncates without erroring would
    make this look like it worked.

    `epsActual is not None` is the "has actually reported" test; names still
    pending simply have no transcript yet and would burn a lookup each sweep.
    """
    from datetime import timedelta
    from zoneinfo import ZoneInfo

    if days is None:
        days = LOOKBACK_DAYS
    if fmp_get is None:
        from api.services.earnings_estimates import _fmp_get as fmp_get
    if today is None:
        # ET, not the server's UTC date — a UTC "today" runs a day ahead all
        # evening and would sweep a day that has not happened.
        today = datetime.now(ZoneInfo("America/New_York")).date()

    kept: list[tuple] = []
    seen: set[str] = set()
    for back in range(days + 1):
        day = (today - timedelta(days=back)).isoformat()
        try:
            rows = fmp_get("/stable/earnings-calendar",
                           {"from": day, "to": day}, timeout=20)
        except Exception as exc:
            _log.warning("[recap_warm] calendar fetch failed for %s: %s", day, exc)
            continue
        if not isinstance(rows, list):
            continue
        for r in rows:
            if not isinstance(r, dict) or r.get("epsActual") is None:
                continue
            s = (r.get("symbol") or "").upper().strip()
            if s and s not in seen and _tradeable(s):
                seen.add(s)
                rev = r.get("revenueActual")
                kept.append((float(rev) if isinstance(rev, (int, float)) else None,
                             back, s))

    # Rank by SIZE, not recency. Across a 7-day window the budget covers well
    # under half the names, and a mega-cap that reported four days ago is far
    # likelier to be opened than a micro-cap that reported this morning. Ordered
    # purely by day, DIS landed at queue position 743 — past the daily cap, so
    # the one name most likely to be opened would never have been warmed.
    # revenueActual rides along on the calendar row, so this costs no extra call.
    kept.sort(key=lambda t: (t[0] is None, -(t[0] or 0.0), t[1]))
    return [s for _, _, s in kept]


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

    # STORE FIRST, bill second. A restart landing between these two calls used
    # to bill for a recap that was never written — 12 generated against 8
    # stored across one afternoon's deploys, four calls paid for and lost. The
    # reverse failure (stored but not billed) merely under-counts the day's
    # spend by one, which the cap absorbs; paying for nothing does not.
    store.put(sym, quarter, recap)
    store.record_spend(sym, recap.get("_usage") or {})
    return "warmed"


def run_sweep(reporters: list[str], *, now=time.monotonic, sleep=time.sleep,
              warm=warm_symbol, store=None) -> dict[str, Any]:
    """Warm the reporter set in priority order, within budget and clock."""
    if not enabled():
        return {"skipped": "disabled"}

    # Single-flight. A sweep can run for up to MAX_SECONDS (an hour), and the
    # boot sweep plus the next cron are separate APScheduler jobs, so they
    # overlap rather than queue. Two sweeps walking the same queue both see
    # store.has() == False for the same symbol and both pay to generate it.
    # Not incorrect — last write wins — but it buys the same recap twice out of
    # a capped daily budget.
    if not _SWEEP_LOCK.acquire(blocking=False):
        _log.info("[recap_warm] a sweep is already running; skipping this one")
        return {"skipped": "already_running"}
    try:
        return _run_sweep_locked(reporters, now=now, sleep=sleep, warm=warm,
                                 store=store)
    finally:
        _SWEEP_LOCK.release()


def _run_sweep_locked(reporters: list[str], *, now, sleep, warm, store):
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
