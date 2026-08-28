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


def _finish_recap(sym: str, quarter: str, recap: dict, store, *,
                  cost_multiplier: float = 1.0) -> None:
    """The shared tail of both lanes: complete the payload, STORE, then bill.

    Measured over HTTP: a warmed recap still took 4.55s because the endpoint
    also calls get_webcast_url (a Perplexity round-trip) and get_rating_changes
    (a provider call) in the same handler. Warming them here makes the served
    payload complete — otherwise the store read is instant and the response is
    not.
    """
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
    store.record_spend(sym, recap.get("_usage") or {},
                       cost_multiplier=cost_multiplier)


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

    _finish_recap(sym, quarter, recap, store)
    return "warmed"


# ── the Batch lane (2026-08-28 cost census) ──────────────────────────────────
# A recap is ~17.5k input tokens and nobody is waiting for it: the reader gets
# whatever is in the store and a cold name generates on click. That makes this
# the pipeline's best Batch candidate — same prompt, same grounding gate, half
# the price. The sweep submits; the NEXT sweep (or the reaper job) collects.
_BATCH_SURFACE = "call_recap"


def batch_enabled() -> bool:
    """Both switches must be on. `CALL_RECAP_WARM_BATCH=0` is the one-env
    rollback to the synchronous lane with no code change."""
    from api.services import llm_batch
    return (llm_batch.enabled()
            and os.environ.get("CALL_RECAP_WARM_BATCH", "1").strip() not in ("0", "false", "no"))


def reap_batches(store=None) -> dict[str, Any]:
    """Collect finished recap batches: ground each result through the SAME
    finisher the live lane uses, store it, then bill it at the batch rate."""
    if store is None:
        from api.services import call_recap_store as store
    from api.services import llm_batch
    from api.services.call_recap_grounded import finish_from_message
    store.init_db()

    def handle(custom_id: str, message, meta: dict) -> None:
        if message is None:
            return                      # errored/expired → the name stays cold
        sym = (meta.get("symbol") or custom_id.split("|", 1)[0]).upper()
        quarter = meta.get("quarter") or ""
        transcript = meta.get("transcript") or {}
        recap = finish_from_message(sym, transcript, message)
        if not recap:
            return
        _finish_recap(sym, quarter, recap, store,
                      cost_multiplier=llm_batch.BATCH_DISCOUNT)

    out = llm_batch.reap(_BATCH_SURFACE, handle)
    if out.get("batches"):
        _log.info("[recap_warm] reaped %s", out)
    return out


def submit_batch(queue: list[str], *, fetch_transcript: Callable = None,
                 store=None, max_items: int = 60) -> dict[str, Any]:
    """Queue the un-stored names in `queue` as ONE batch. Returns a summary.

    The per-call `may_spend()` gate becomes a submit-time budget: a batch is
    committed all at once, so the size is capped by what the remaining daily
    budget can pay for at the batch rate. Overshooting the cap by a whole
    batch is the failure this bound exists to prevent.
    """
    if store is None:
        from api.services import call_recap_store as store
    if fetch_transcript is None:
        from api.services.fmp_transcripts import get_transcript as fetch_transcript
    from api.services import llm_batch
    from api.services.call_recap_grounded import build_params

    store.init_db()
    counts: dict[str, int] = {}

    def bump(k):
        counts[k] = counts.get(k, 0) + 1

    if not store.may_spend():
        return {"skipped": "capped"}

    # what one recap costs at the batch rate, from the store's own prices
    est = max(0.01, (17_500 * store.PRICE_IN + 1_500 * store.PRICE_OUT)
              * llm_batch.BATCH_DISCOUNT)
    affordable = int(max(0.0, store.DAILY_CAP_USD - store.spend_today()) / est)
    room = max(0, min(max_items, affordable))
    if room == 0:
        return {"skipped": "capped"}

    requests: list[dict] = []
    meta: dict[str, dict] = {}
    for sym in queue:
        if len(requests) >= room:
            bump("deferred")
            continue
        try:
            transcript = fetch_transcript(sym)
        except Exception as exc:
            _log.warning("[recap_warm] transcript failed for %s: %s", sym, exc)
            bump("no_transcript")
            continue
        if not transcript or not transcript.get("segments"):
            bump("no_transcript")
            continue
        quarter = transcript.get("quarter") or ""
        if store.has(sym, quarter):
            bump("already")
            continue
        params = build_params(sym, transcript)
        if params is None:
            bump("no_transcript")
            continue
        cid = f"{sym}|{quarter}"[:64]
        requests.append({"custom_id": cid, "params": params})
        # the transcript rides the ledger: grounding at reap time MUST use the
        # text the model was actually given, not a re-fetch that may have moved
        meta[cid] = {"symbol": sym, "quarter": quarter, "transcript": transcript}
        bump("queued")

    if not requests:
        return counts
    batch_id = llm_batch.submit(_BATCH_SURFACE, requests, meta)
    if not batch_id:
        return {**counts, "submit_failed": len(requests)}
    return {**counts, "batch_id": batch_id}


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

    # The Batch lane: reap what the LAST sweep submitted, then submit this
    # sweep's un-stored names. Reaping first means an already-collected recap
    # is skipped by store.has() below instead of being paid for twice.
    if batch_enabled():
        try:
            reaped = reap_batches(store=store)
        except Exception as exc:            # a bad reap never stops warming
            _log.warning("[recap_warm] reap failed: %s", exc)
            reaped = {"error": str(exc)[:80]}
        try:
            submitted = submit_batch(queue, store=store)
        except Exception as exc:
            _log.warning("[recap_warm] batch submit failed: %s", exc)
            submitted = {"error": str(exc)[:80]}
        return {"queued": len(queue), "mode": "batch",
                "reaped": reaped, "submitted": submitted,
                "spend_today_usd": round(store.spend_today(), 4)}
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
