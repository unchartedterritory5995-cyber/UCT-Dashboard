"""Awareness Engine -- Milestone 1 scan cycle.

One shared market scan per cycle (regime + earnings window + cached live
prices) -> per-user filter (bulk-loaded positions + watchlists, two queries
total) -> pure rule functions (rules.py) produce InsightCandidate objects ->
the deterministic relevance score becomes add_insight()'s importance -> the
existing queue (dedup + daily cap + per-symbol cooldown, session-start
speak, chat-thread mirror, tile feed) and away-delivery (email/Discord for
importance >= 8) take it from there, unchanged.

Gated behind AWARENESS_ENGINE_ENABLED (checked here) AND
COMPASS_AUTOMATION_ENABLED (checked by api/main.py's _add_compass_job
before this ever runs on a schedule) -- both default off.
"""
from __future__ import annotations

import logging
import os
from datetime import date, timedelta

from api.services.awareness import regime_snapshots, rules
from api.services.awareness.rules import InsightCandidate

_log = logging.getLogger(__name__)

_DELIVER_IMPORTANCE_FLOOR = 8


def _enabled() -> bool:
    return os.environ.get("AWARENESS_ENGINE_ENABLED", "0") == "1"


def _thesis_review_enabled() -> bool:
    """R6 (G-074) gets its OWN flag, deliberately -- a new INSIGHT KIND, not
    a variation on an existing one, and this ledger row explicitly names
    alert-fatigue as a structural risk (citing this same engine's own need
    for cooldowns as precedent). A dedicated flag means Patrick can turn
    R6 off alone if it proves too noisy, without touching R1/R2/R4/R5 or
    the engine as a whole -- the "flag closes one door" pattern this repo
    already uses for BRAIN_TOOLS_ENABLED beside BRAIN_PACK_ENABLED,
    J2_OCR_ENABLED beside the broader document features, etc. Dark by
    default, same as every other capability flag in this family."""
    return os.environ.get("AWARENESS_THESIS_REVIEW_ENABLED", "0") == "1"


def _note_resurface_enabled() -> bool:
    """R7-R9 (wave 13 lane 13D, resurfacing) get their OWN flag, the R6
    precedent above: a new family of insight kinds that can be turned off alone.
    Read through the one parse (`note_levels.enabled` -> notebook_flags.flag_on),
    because the same variable rides the auth payload for the note door's client
    half. Unset = OFF. Checked here, per cycle, inside the scan job."""
    from api.services.journal_two.note_levels import enabled
    return enabled()


def _bulk_load_user_contexts() -> dict[str, dict]:
    """One pass over auth.db builds every user's positions + watchlist
    symbols in two (or three, with R6 on) queries total -- not N+1
    per-user -- mirrors calendar_alerts._collect_all_users_ticker_sets."""
    from api.services.auth_db import get_connection

    positions_by_user: dict[str, list[dict]] = {}
    watch_by_user: dict[str, set[str]] = {}
    mentioned_by_user: dict[str, set[str]] = {}

    conn = get_connection()
    try:
        prows = conn.execute(
            "SELECT user_id, symbol, side, entry_price, stop_price, source "
            "FROM j2_positions WHERE closed_at IS NULL"
        ).fetchall()
        for r in prows:
            sym = (r["symbol"] or "").upper()
            if not sym:
                continue
            positions_by_user.setdefault(r["user_id"], []).append({
                "symbol": sym,
                "side": r["side"],
                "entry_price": r["entry_price"],
                "stop_price": r["stop_price"],
                "source": r["source"],
            })

        wrows = conn.execute(
            "SELECT w.user_id AS user_id, wi.sym AS sym FROM watchlist_items wi "
            "JOIN watchlists w ON w.id = wi.watchlist_id"
        ).fetchall()
        for r in wrows:
            sym = (r["sym"] or "").upper()
            if not sym:
                continue
            watch_by_user.setdefault(r["user_id"], set()).add(sym)

        # ⛔ A THIRD BULK QUERY, GATED BEHIND R6'S OWN FLAG -- when
        # AWARENESS_THESIS_REVIEW_ENABLED is off (the default), this scan
        # touches the same two tables it always has and nothing more.
        if _thesis_review_enabled():
            from api.services.journal_two.notes import bulk_member_mentioned_symbols
            mentioned_by_user = bulk_member_mentioned_symbols(conn)
    finally:
        conn.close()

    # ⛔ mentioned_by_user does NOT widen all_users. It exists to give an
    # ALREADY-scanned user (one with a position or a watchlist) extra
    # context; a user with notes but no position/watchlist has nothing any
    # rule acts on, and every rule already degrades to [] for one, so
    # including them here would only add wasted iterations at scale.
    all_users = set(positions_by_user) | set(watch_by_user)
    return {
        uid: {
            "positions": positions_by_user.get(uid, []),
            "watch_syms": watch_by_user.get(uid, set()),
            "mentioned_symbols": mentioned_by_user.get(uid, set()),
        }
        for uid in all_users
    }


# Per-(date, window) memo for the earnings window. The scan runs every 20 min;
# on a COLD calendar_weekly cache (pre-market, before any /calendar traffic) each
# lookup falls through to a live Finnhub call, so an unmemoized scan would re-hit
# Finnhub up to (days+1)x every cycle. Earnings dates inside a ~3-day window don't
# move hour-to-hour, so a 1h TTL is safe and cuts the cold-window Finnhub load.
_EARNINGS_MEMO: dict = {}          # (today_iso, days) -> (fetched_at_epoch, result, partial)
_EARNINGS_MEMO_TTL = 3600          # seconds
_EARNINGS_MEMO_TTL_PARTIAL = 300   # a day's reporter lookup failed — retry the window in 5 min, not 1h


def _reset_earnings_memo() -> None:
    """Test hook — clears the earnings-window memo."""
    _EARNINGS_MEMO.clear()


def _collect_earnings_window(today: date, days: int) -> dict[str, str]:
    """{SYMBOL: earliest report date (YYYY-MM-DD)} across the next `days`
    calendar days. Reuses calendar_alerts' per-date reporter lookup
    (calendar_weekly cache, Finnhub fallback) -- one call per day in the
    (small) window, never per-ticker. Memoized per (today, days) for
    _EARNINGS_MEMO_TTL to bound Finnhub calls across scan cycles.

    Uses the `_with_status` sibling (not the plain lookup, which never
    raises) so a real source failure on any day is distinguishable from a
    genuinely quiet day -- S10, 2026-09-06. Without it `any_failed` could
    never become True and the partial-TTL branch below was permanently
    dead, even though it was already fully wired."""
    import time as _time
    key = (today.isoformat(), int(days))
    hit = _EARNINGS_MEMO.get(key)
    now = _time.time()
    if hit is not None:
        fetched_at, value, was_partial = hit
        ttl = _EARNINGS_MEMO_TTL_PARTIAL if was_partial else _EARNINGS_MEMO_TTL
        if (now - fetched_at) < ttl:
            return dict(value)  # copy — callers must not mutate the cache

    # ⛔ THE WALK IS SHARED (Seam 4). It used to be a private copy here and a
    # second copy in watchlist_intelligence, and the two had already diverged.
    # The MEMOIZATION above and below stays this module's own -- sharing the
    # walk is de-duplication, folding this wrapper into it would be a behaviour
    # change for the other caller.
    from api.services.calendar_alerts import collect_earnings_window

    out, any_failed = collect_earnings_window(today, days)
    # A day's lookup failing mid-window used to memoize the (now day-
    # incomplete) window for the full 1h TTL regardless — silencing R5
    # earnings-proximity awareness for any symbol reporting on the failed
    # day until the memo naturally expired.
    _EARNINGS_MEMO[key] = (now, dict(out), any_failed)
    return out


def _compute_regime_component() -> dict:
    """R4 (regime-flip)'s ENTIRE input, isolated as its own failure domain --
    Seam 10 / Awareness Scan-Abort Hardening V1. `rule_stop_watch` (R1/R2,
    keys off `live_prices` only) and `rule_earnings_proximity` (R5, keys off
    `earnings_by_symbol` only) never read this dict's contents; R4 is the
    ONLY rule that does. Before this fix, a failure anywhere in here (the
    classifier's own fetch/classify, or either raw `regime_snapshots` SQLite
    call -- neither had a try/except of its own) propagated uncaught out of
    `_build_market_scan_ctx`, which had no try/except either, aborting the
    ENTIRE cycle before the per-user rule loop even started: stop-watch and
    earnings-proximity insights for EVERY user were silently lost that
    cycle too, even though neither one touches regime data at all.

    A missing/None `label` already reads as "nothing to report" to
    `rule_regime_flip` (`if not label or not prev_label or label ==
    prev_label: return []`) -- so degrading to that same shape on failure is
    not a new code path, it is the rule's own pre-existing safe default,
    reached one way instead of two."""
    from api.services.voice_regime_classifier import get_current_regime

    try:
        prev_label = regime_snapshots.get_last_label()
        current = get_current_regime()
        label = current.get("regime")
        confidence = current.get("confidence", 0.5)
        if label:
            regime_snapshots.record_snapshot(label, confidence)
        return {"label": label, "confidence": confidence, "prev_label": prev_label,
                "degraded": False}
    except Exception as e:  # noqa: BLE001 -- R4's own failure domain only
        _log.warning("[awareness] regime component failed, degrading R4 "
                     "(stop-watch + earnings-proximity unaffected): %s", e)
        return {"label": None, "confidence": 0.5, "prev_label": None, "degraded": True}


def _build_market_scan_ctx(user_ctxs: dict) -> dict:
    """The ONE shared market-wide computation per cycle: regime (+ prior
    label from the durable snapshot ledger), an earnings window, and cached
    live prices for every symbol any user currently holds. No per-user or
    per-position network fetches happen here."""
    from api.routers.live_prices import cache as _px_cache, _px_key

    all_syms: set[str] = set()
    for ctx in user_ctxs.values():
        for pos in ctx["positions"]:
            if pos["symbol"]:
                all_syms.add(pos["symbol"])

    live_prices: dict[str, float] = {}
    for sym in all_syms:
        hit = _px_cache.get(_px_key(sym))
        price = (hit or {}).get("price") if hit else None
        if price:
            live_prices[sym] = float(price)

    regime = _compute_regime_component()

    today = date.today()
    try:
        days = int(os.environ.get("AWARENESS_EARNINGS_PROXIMITY_DAYS", "3"))
    except (ValueError, TypeError):
        days = 3  # malformed env value must never kill the scan cycle
    earnings_by_symbol = _collect_earnings_window(today, days)

    return {
        "live_prices": live_prices,
        "regime": regime,
        "earnings_by_symbol": earnings_by_symbol,
        # rule_earnings_proximity reads this so its cutoff always matches the
        # collection window above (env-tunable end to end, not half-wired).
        "earnings_window_days": days,
        "today": today,
    }


def _queue_candidate(user_id: str, candidate: InsightCandidate) -> tuple[int | None, int]:
    """Score -> add_insight (dedup/cap/cooldown enforced there). The ONE place a
    candidate becomes an insight row: `_fire_candidate` (R1-R6, which may also
    away-deliver) and `_fire_resurface` (R7-R9, in-app only) both call it.
    Returns (insight id or None when suppressed, importance)."""
    from api.services.voice_proactive_service import add_insight

    importance = rules.compute_relevance_score(
        candidate.base_signal, candidate.personal_multiplier, candidate.urgency,
    )
    # Persist the CLEAN ticker (candidate.symbol) as the displayed symbol, NOT
    # the composite dedup_key — the dedup_key (e.g. "NVDA:stop_hit",
    # "REGIME:bull_trend") is a cooldown-namespace string that must never reach
    # the UI. add_insight now namespaces the cooldown by (symbol, kind), which
    # reproduces the dedup_key's stop_hit-vs-stop_near separation while keeping
    # the symbol column clean. Market-wide insights (regime flips) carry
    # symbol=None and correctly render no ticker chip.
    insight_id = add_insight(
        user_id,
        kind=candidate.kind,
        headline=candidate.headline,
        symbol=candidate.symbol,
        body=candidate.body,
        importance=importance,
    )
    return insight_id, importance


def _fire_candidate(user_id: str, candidate: InsightCandidate) -> bool:
    """Score -> add_insight (dedup/cap/cooldown enforced there) -> also
    away-deliver (email/Discord/in-app) when importance clears the floor."""
    insight_id, importance = _queue_candidate(user_id, candidate)
    if insight_id is None:
        return False  # suppressed by daily cap / per-symbol cooldown

    # Away-deliver (email/Discord) only for personal, ticker-specific insights
    # above the floor. Regime flips are market-wide/systemic (symbol=None) — they
    # surface in-app + spoken at session start, but must NOT blast every position
    # holder's inbox on every flip (calm/surgical). Operator can add a dedicated
    # regime-change email later if desired.
    if importance >= _DELIVER_IMPORTANCE_FLOOR and candidate.symbol:
        try:
            from api.services.watchlist_alert_service import deliver_alert_payload
            deliver_alert_payload(
                user_id=user_id,
                sym=candidate.symbol,
                title=candidate.headline,
                message=candidate.body or candidate.headline,
                source="awareness_engine",
                extra_data={"kind": candidate.kind},
            )
        except Exception as e:  # noqa: BLE001
            _log.warning("[awareness] away-delivery failed for %s: %s", user_id, e)
    return True


def run_awareness_scan() -> dict:
    """The scan cycle entry point. Returns a small summary dict for logging."""
    if not _enabled():
        return {"enabled": False, "scanned_users": 0, "fired": 0}

    user_ctxs = _bulk_load_user_contexts()
    scan_ctx = _build_market_scan_ctx(user_ctxs)

    thesis_review_on = _thesis_review_enabled()

    fired = 0
    for user_id, user_ctx in user_ctxs.items():
        candidates: list[InsightCandidate] = []
        try:
            candidates += rules.rule_stop_watch(scan_ctx, user_ctx)
            candidates += rules.rule_earnings_proximity(scan_ctx, user_ctx)
            candidates += rules.rule_regime_flip(scan_ctx, user_ctx)
            if thesis_review_on:
                candidates += rules.rule_thesis_stop_review(scan_ctx, user_ctx)
        except Exception as e:  # noqa: BLE001 — one user's bad data can't abort the rest
            _log.warning("[awareness] rules failed user=%s: %s", user_id, e)
            continue
        for candidate in candidates:
            try:
                if _fire_candidate(user_id, candidate):
                    fired += 1
            except Exception as e:  # noqa: BLE001
                _log.warning("[awareness] fire failed user=%s kind=%s: %s",
                             user_id, candidate.kind, e)

    result = {"enabled": True, "scanned_users": len(user_ctxs), "fired": fired,
              "regime_degraded": bool(scan_ctx.get("regime", {}).get("degraded"))}
    # Wave 13 lane 13D: resurfacing is its OWN pass after R1-R6, so nothing above
    # this line reads or writes anything it adds. Off (the default) -> not run,
    # not reported.
    if _note_resurface_enabled():
        try:
            result["resurface"] = _run_resurface_pass()
        except Exception as e:  # noqa: BLE001 -- R7-R9 can never take R1-R6's cycle down
            _log.warning("[awareness] resurface pass failed: %s", e)
            result["resurface"] = {"failed": True}
    return result


# ── Wave 13 lane 13D: resurfacing (R7-R9) ─────────────────────────────────────

def _note_quotes(symbols: set[str]) -> dict[str, dict]:
    """{SYMBOL: {"price", "change_pct"}} from the SHARED live-price cache only --
    the same cache R1/R2 read. A symbol nobody has polled has no entry and its
    levels wait for the next cycle: never a per-note fetch."""
    from api.routers.live_prices import cache as _px_cache, _px_key

    out: dict[str, dict] = {}
    for sym in symbols:
        hit = _px_cache.get(_px_key(sym))
        if not isinstance(hit, dict):
            continue
        price = hit.get("price")
        if not price:
            continue
        chg = hit.get("change_pct")
        out[sym] = {"price": float(price),
                    "change_pct": float(chg) if isinstance(chg, (int, float))
                    and not isinstance(chg, bool) else None}
    return out


def _fire_resurface(user_id: str, candidate, day_et: str) -> bool:
    """One resurfacing candidate -> at most one in-app insight. One per level per
    day (once ever for a date) from the ledger; the 2-a-day sub-cap is
    add_insight's own (it never touches the shared 8/day count).

    ⛔ IN-APP ONLY, BY CONSTRUCTION: this function has no delivery branch. It
    queues through `_queue_candidate`, never `_fire_candidate`, so no importance
    a rule could ever compute reaches email or Discord."""
    from api.services.auth_db import get_connection
    from api.services.journal_two import note_levels

    conn = get_connection()
    try:
        if note_levels.already_fired(conn, user_id, candidate.fire_key, day_et, once=candidate.once):
            return False
    finally:
        conn.close()
    insight_id, _importance = _queue_candidate(user_id, candidate)
    if insight_id is None:
        return False  # the sub-cap or the per-symbol cooldown said no
    conn = get_connection()
    try:
        note_levels.record_fire(conn, user_id, candidate.fire_key, day_et, insight_id,
                                candidate.kind, candidate.note_id, candidate.version_id)
    finally:
        conn.close()
    return True


def _run_resurface_pass() -> dict:
    """Catch the level index up (bounded), read it in one query, read the shared
    price cache once for its symbols, run R7-R9 per member, fire, then store each
    level's side for the next cycle's cross test."""
    from api.services.auth_db import get_connection
    from api.services.journal_two import note_levels
    from api.services.journal_two.calendar import et_today

    conn = get_connection()
    try:
        projection = note_levels.catch_up_all(conn)
        by_user = note_levels.load_index(conn)
    finally:
        conn.close()

    symbols = {lv["symbol"] for rows in by_user.values() for lv in rows if lv.get("symbol")}
    quotes = _note_quotes(symbols)
    day_et = et_today()
    ctx = {"note_quotes": quotes, "today": date.fromisoformat(day_et)}

    fired = 0
    for user_id, rows in by_user.items():
        user_ctx = {"note_levels": rows}
        try:
            candidates = (rules.rule_note_level_touch(ctx, user_ctx)
                          + rules.rule_note_big_move(ctx, user_ctx)
                          + rules.rule_note_date_due(ctx, user_ctx))
        except Exception as e:  # noqa: BLE001 -- one member's index can't abort the rest
            _log.warning("[awareness] resurface rules failed user=%s: %s", user_id, e)
            continue
        for candidate in sorted(candidates, key=lambda c: (c.rank, c.symbol or "", c.fire_key)):
            try:
                if _fire_resurface(user_id, candidate, day_et):
                    fired += 1
            except Exception as e:  # noqa: BLE001
                _log.warning("[awareness] resurface fire failed user=%s kind=%s: %s",
                             user_id, candidate.kind, e)

    # AFTER every rule read the previous side: record where each priced level is now.
    changes = []
    for rows in by_user.values():
        for lv in rows:
            q = quotes.get(lv.get("symbol"))
            if q and lv.get("role") in rules.NOTE_PRICE_ROLES and lv.get("price"):
                side = rules.level_side(q["price"], lv["price"])
                if side != lv.get("last_side"):
                    changes.append((side, lv["user_id"], lv["note_id"], lv["level_id"]))
    conn = get_connection()
    try:
        sides = note_levels.record_sides(conn, changes)
    finally:
        conn.close()
    return {"members": len(by_user), "priced_symbols": len(quotes), "fired": fired,
            "sides_moved": sides, **projection}
