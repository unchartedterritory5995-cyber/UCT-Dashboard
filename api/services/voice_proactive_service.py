"""
Proactive market watcher — Phase 4 of voice buildout.

Runs in the background. Periodically scans:
  - The user's flagged + tagged tickers
  - Scanner candidates that match the user's preferred setups (read from
    facts + journal setup performance)
  - The current regime + breadth/sector context

When alignment is detected (high-conviction match against the user's
edge + favorable regime), it queues a voice_proactive_insights row.
The next voice session opens with a brief "FYI" that surfaces them.

Insights are never spammy — strict per-symbol cooldowns + max N per
day + dismissal tracking. The user can dismiss insights to suppress
the same pattern.
"""

import logging
from datetime import datetime, timezone, timedelta
from typing import Any

from api.services.auth_db import get_connection

_log = logging.getLogger(__name__)

# Tuning knobs
MAX_INSIGHTS_PER_USER_PER_DAY = 8
MIN_SYMBOL_COOLDOWN_HOURS = 6
MIN_IMPORTANCE_TO_QUEUE = 4  # 1-10 scale


# ── DB helpers ─────────────────────────────────────────────────────────────

def add_insight(
    user_id: str,
    *,
    kind: str,
    headline: str,
    symbol: str | None = None,
    body: str | None = None,
    importance: int = 5,
) -> int | None:
    """
    Queue a proactive insight for a user. Returns insight id, or None if
    suppressed (cooldown / daily cap).

    Kinds:
      - watchlist_alert: flagged ticker triggered a setup criterion
      - scanner_match: scanner candidate matches user's edge
      - regime_shift: market regime changed since last session
      - mistake_pattern: user has repeated a recent mistake
      - drift_warning: user behavior degrading vs baseline
    """
    importance = max(1, min(10, int(importance)))
    if importance < MIN_IMPORTANCE_TO_QUEUE:
        return None

    conn = get_connection()
    try:
        cutoff_day = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        cutoff_sym = (datetime.now(timezone.utc)
                      - timedelta(hours=MIN_SYMBOL_COOLDOWN_HOURS)).isoformat()

        # Per-day cap
        per_day = conn.execute(
            """SELECT COUNT(*) FROM voice_proactive_insights
                WHERE user_id = ? AND created_at >= ?""",
            (user_id, cutoff_day),
        ).fetchone()[0]
        if per_day >= MAX_INSIGHTS_PER_USER_PER_DAY:
            return None

        # Per-symbol cooldown
        if symbol:
            recent = conn.execute(
                """SELECT 1 FROM voice_proactive_insights
                    WHERE user_id = ? AND symbol = ? AND created_at >= ?
                    LIMIT 1""",
                (user_id, symbol.upper(), cutoff_sym),
            ).fetchone()
            if recent:
                return None

        cur = conn.execute(
            """INSERT INTO voice_proactive_insights
               (user_id, kind, symbol, headline, body, importance)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (user_id, kind, (symbol or "").upper() or None,
             headline[:300], (body or "")[:1500], importance),
        )
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def list_pending_insights(user_id: str, *, limit: int = 5) -> list[dict]:
    """Return undelivered, undismissed insights for a user, newest+highest-importance first."""
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT id, kind, symbol, headline, body, importance, created_at
                 FROM voice_proactive_insights
                WHERE user_id = ?
                  AND delivered_at IS NULL
                  AND dismissed_at IS NULL
                ORDER BY importance DESC, created_at DESC
                LIMIT ?""",
            (user_id, max(1, min(20, int(limit)))),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def mark_delivered(insight_ids: list[int]) -> int:
    if not insight_ids:
        return 0
    now = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        placeholders = ",".join("?" * len(insight_ids))
        cur = conn.execute(
            f"UPDATE voice_proactive_insights SET delivered_at = ? "
            f"WHERE id IN ({placeholders})",
            [now, *insight_ids],
        )
        conn.commit()
        return cur.rowcount or 0
    finally:
        conn.close()


def dismiss(insight_id: int, user_id: str) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        cur = conn.execute(
            """UPDATE voice_proactive_insights SET dismissed_at = ?
                WHERE id = ? AND user_id = ?""",
            (now, insight_id, user_id),
        )
        conn.commit()
        return (cur.rowcount or 0) > 0
    finally:
        conn.close()


def list_history(user_id: str, *, limit: int = 50) -> list[dict]:
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT id, kind, symbol, headline, body, importance,
                      delivered_at, dismissed_at, created_at
                 FROM voice_proactive_insights
                WHERE user_id = ?
                ORDER BY created_at DESC
                LIMIT ?""",
            (user_id, max(1, min(200, int(limit)))),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


# ── Scanner pass — looks for trade opportunities ────────────────────────────

def _user_preferred_setups(user_id: str) -> set[str]:
    """Extract preferred setups from user facts (text mentioning setups)."""
    preferred: set[str] = set()
    # The user's saved facts may mention setups like 'I trade flag breakouts'
    try:
        from api.services.voice_memory_service import list_facts
        for f in list_facts(user_id, limit=50):
            txt = (f.get("text") or "").lower()
            for kw in ("flag", "vcp", "powerplay", "episodic pivot", "stage 2",
                       "u&r", "orb", "parabolic", "wedge"):
                if kw in txt:
                    preferred.add(kw)
    except Exception:
        pass
    return preferred


def _flagged_symbols(user_id: str) -> set[str]:
    try:
        from api.services.watchlist_service import get_or_create_flagged_list
        wl = get_or_create_flagged_list(user_id)
        return {(item.get("sym") or "").upper() for item in (wl.get("items") or [])
                if item.get("sym")}
    except Exception:
        return set()


def scan_for_opportunities(user_id: str) -> int:
    """
    One scan pass. Looks at user's flagged tickers + scanner candidates
    against the current regime + their preferred setups. Queues
    voice_proactive_insights for high-conviction matches.

    Returns count of insights queued (post cooldown/cap filtering).
    """
    queued = 0

    # Pull current regime — opportunities depend on it
    try:
        from api.services.voice_regime_classifier import get_current_regime
        regime = get_current_regime()
    except Exception:
        regime = {"regime": "chop", "confidence": 0}

    flagged = _flagged_symbols(user_id)
    preferred = _user_preferred_setups(user_id)

    # Scanner candidates
    try:
        from api.services.engine import get_candidates
        candidates = get_candidates() or {}
        cand_buckets = candidates.get("candidates") or {}
    except Exception:
        cand_buckets = {}

    # Pullback MA candidates with high candle scores or alert states
    for bucket_name, rows in cand_buckets.items():
        if not isinstance(rows, list):
            continue
        for r in rows:
            sym = (r.get("sym") or r.get("ticker") or "").upper()
            if not sym:
                continue
            score = r.get("candle_score") or r.get("score") or 0
            alert = (r.get("alert_state") or r.get("alert") or "").upper()
            pattern = (r.get("pattern_type") or "").lower()

            # Importance scoring
            importance = 5
            if alert in ("READY", "BREAKING"):
                importance += 2
            if score and isinstance(score, (int, float)) and score >= 70:
                importance += 1
            if sym in flagged:
                importance += 2  # user has explicitly flagged
            if pattern and any(p in pattern for p in preferred):
                importance += 1  # matches user's setup edge
            if regime.get("regime") == "bull_trend":
                importance += 1
            elif regime.get("regime") == "bear_trend" and bucket_name != "remount":
                importance -= 2

            if importance < MIN_IMPORTANCE_TO_QUEUE:
                continue

            headline_bits = [sym]
            if alert:
                headline_bits.append(alert)
            if pattern:
                headline_bits.append(pattern)
            headline = " — ".join(headline_bits)

            body_parts = []
            if score:
                body_parts.append(f"candle score {score}")
            if sym in flagged:
                body_parts.append("on your flagged list")
            body_parts.append(f"regime: {regime.get('regime')}")
            body = "; ".join(body_parts)

            rid = add_insight(
                user_id,
                kind="scanner_match" if sym not in flagged else "watchlist_alert",
                symbol=sym,
                headline=headline,
                body=body,
                importance=importance,
            )
            if rid:
                queued += 1

    _log.info("[voice_proactive] user=%s queued=%d", user_id, queued)
    return queued


def maybe_emit_regime_shift(user_id: str) -> int:
    """
    Detect if the regime has flipped since the user's most recent session
    summary. If so, queue a regime_shift insight (high importance).
    """
    try:
        from api.services.voice_regime_classifier import get_current_regime
        from api.services.voice_memory_service import list_summaries
        current = get_current_regime()
        cur_regime = current.get("regime")
        if not cur_regime:
            return 0
        summaries = list_summaries(user_id, limit=1)
        if not summaries:
            return 0
        last_text = (summaries[0].get("summary_text") or "").lower()
        for r in ("bull_trend", "bull_correction", "distribution", "chop", "bear_trend"):
            if r in last_text and r != cur_regime:
                rid = add_insight(
                    user_id,
                    kind="regime_shift",
                    symbol=None,
                    headline=f"Regime shifted to {cur_regime.replace('_', ' ')}",
                    body=(f"Previously discussed in context of {r.replace('_', ' ')}. "
                          f"{current.get('narration', '')}"),
                    importance=8,
                )
                return 1 if rid else 0
    except Exception as e:  # noqa: BLE001
        _log.warning("[voice_proactive] regime shift check failed: %s", e)
    return 0
