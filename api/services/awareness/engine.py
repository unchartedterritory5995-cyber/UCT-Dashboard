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


def _bulk_load_user_contexts() -> dict[str, dict]:
    """One pass over auth.db builds every user's positions + watchlist
    symbols in two queries total (not N+1 per-user) -- mirrors
    calendar_alerts._collect_all_users_ticker_sets."""
    from api.services.auth_db import get_connection

    positions_by_user: dict[str, list[dict]] = {}
    watch_by_user: dict[str, set[str]] = {}

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
    finally:
        conn.close()

    all_users = set(positions_by_user) | set(watch_by_user)
    return {
        uid: {
            "positions": positions_by_user.get(uid, []),
            "watch_syms": watch_by_user.get(uid, set()),
        }
        for uid in all_users
    }


# Per-(date, window) memo for the earnings window. The scan runs every 20 min;
# on a COLD calendar_weekly cache (pre-market, before any /calendar traffic) each
# lookup falls through to a live Finnhub call, so an unmemoized scan would re-hit
# Finnhub up to (days+1)x every cycle. Earnings dates inside a ~3-day window don't
# move hour-to-hour, so a 1h TTL is safe and cuts the cold-window Finnhub load.
_EARNINGS_MEMO: dict = {}          # (today_iso, days) -> (fetched_at_epoch, result)
_EARNINGS_MEMO_TTL = 3600          # seconds


def _reset_earnings_memo() -> None:
    """Test hook — clears the earnings-window memo."""
    _EARNINGS_MEMO.clear()


def _collect_earnings_window(today: date, days: int) -> dict[str, str]:
    """{SYMBOL: earliest report date (YYYY-MM-DD)} across the next `days`
    calendar days. Reuses calendar_alerts' per-date reporter lookup
    (calendar_weekly cache, Finnhub fallback) -- one call per day in the
    (small) window, never per-ticker. Memoized per (today, days) for
    _EARNINGS_MEMO_TTL to bound Finnhub calls across scan cycles."""
    import time as _time
    key = (today.isoformat(), int(days))
    hit = _EARNINGS_MEMO.get(key)
    now = _time.time()
    if hit is not None and (now - hit[0]) < _EARNINGS_MEMO_TTL:
        return dict(hit[1])  # copy — callers must not mutate the cache

    from api.services.calendar_alerts import _get_reporters_for_date

    out: dict[str, str] = {}
    for offset in range(0, max(0, days) + 1):
        d = today + timedelta(days=offset)
        d_str = d.isoformat()
        try:
            reporters = _get_reporters_for_date(d_str)
        except Exception as e:  # noqa: BLE001
            _log.debug("[awareness] earnings lookup failed for %s: %s", d_str, e)
            continue
        for sym in reporters:
            if sym not in out:  # keep the EARLIEST date per symbol
                out[sym] = d_str
    _EARNINGS_MEMO[key] = (now, dict(out))
    return out


def _build_market_scan_ctx(user_ctxs: dict) -> dict:
    """The ONE shared market-wide computation per cycle: regime (+ prior
    label from the durable snapshot ledger), an earnings window, and cached
    live prices for every symbol any user currently holds. No per-user or
    per-position network fetches happen here."""
    from api.routers.live_prices import cache as _px_cache, _px_key
    from api.services.voice_regime_classifier import get_current_regime

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

    prev_label = regime_snapshots.get_last_label()
    current = get_current_regime()
    label = current.get("regime")
    confidence = current.get("confidence", 0.5)
    if label:
        regime_snapshots.record_snapshot(label, confidence)

    today = date.today()
    try:
        days = int(os.environ.get("AWARENESS_EARNINGS_PROXIMITY_DAYS", "3"))
    except (ValueError, TypeError):
        days = 3  # malformed env value must never kill the scan cycle
    earnings_by_symbol = _collect_earnings_window(today, days)

    return {
        "live_prices": live_prices,
        "regime": {"label": label, "confidence": confidence, "prev_label": prev_label},
        "earnings_by_symbol": earnings_by_symbol,
        # rule_earnings_proximity reads this so its cutoff always matches the
        # collection window above (env-tunable end to end, not half-wired).
        "earnings_window_days": days,
        "today": today,
    }


def _fire_candidate(user_id: str, candidate: InsightCandidate) -> bool:
    """Score -> add_insight (dedup/cap/cooldown enforced there) -> also
    away-deliver (email/Discord/in-app) when importance clears the floor."""
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

    fired = 0
    for user_id, user_ctx in user_ctxs.items():
        candidates: list[InsightCandidate] = []
        try:
            candidates += rules.rule_stop_watch(scan_ctx, user_ctx)
            candidates += rules.rule_earnings_proximity(scan_ctx, user_ctx)
            candidates += rules.rule_regime_flip(scan_ctx, user_ctx)
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

    return {"enabled": True, "scanned_users": len(user_ctxs), "fired": fired}
