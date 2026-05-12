"""
Drift + anomaly detection — Phase 4 final piece.

Compares the user's recent trading behavior (last N days) against an
earlier baseline window. When statistically meaningful degradation
appears, queues a `drift_warning` proactive insight so the Coach agent
can surface it.

Detected drifts:
  - win_rate_drop: win rate fell >=10 percentage points vs baseline
  - avg_loss_grew: average losing R-multiple worsened by >=0.5R
  - mistake_recurrence: same mistake_tag appears 3+ times in recent window
  - size_creep: average position risk grew >=30% vs baseline
  - frequency_spike: trade count >=1.5x baseline (overtrading)

Per-kind cooldown is enforced by voice_proactive_service.add_insight's
per-symbol cooldown (we pass kind as the dedup key when symbol is None
by routing through a generic 'drift' family).
"""

import logging
from collections import Counter
from datetime import datetime, timezone, timedelta
from typing import Any

_log = logging.getLogger(__name__)

# Tuning
RECENT_DAYS = 30
BASELINE_DAYS = 30
MIN_TRADES = 5  # need this many trades in each window before comparing


# ── Helpers ────────────────────────────────────────────────────────────────

def _to_float(v: Any, default: float = 0.0) -> float:
    if v is None:
        return default
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _parse_exit_date(s: Any) -> datetime | None:
    if not s or not isinstance(s, str):
        return None
    try:
        t = s
        if t.endswith("Z"):
            t = t[:-1] + "+00:00"
        dt = datetime.fromisoformat(t)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (TypeError, ValueError):
        return None


def _split_windows(trades: list[dict]) -> tuple[list[dict], list[dict]]:
    """Split closed trades into recent vs baseline windows by exit_date."""
    now = datetime.now(timezone.utc)
    recent_cutoff = now - timedelta(days=RECENT_DAYS)
    baseline_cutoff = now - timedelta(days=RECENT_DAYS + BASELINE_DAYS)

    recent: list[dict] = []
    baseline: list[dict] = []
    for t in trades:
        exit_dt = _parse_exit_date(t.get("exit_date"))
        if exit_dt is None:
            continue
        if exit_dt >= recent_cutoff:
            recent.append(t)
        elif exit_dt >= baseline_cutoff:
            baseline.append(t)
    return recent, baseline


def _win_rate(trades: list[dict]) -> float | None:
    if not trades:
        return None
    wins = sum(1 for t in trades
                if (t.get("result") or "").lower() == "win"
                or (_to_float(t.get("pnl_dollar")) > 0))
    return wins / len(trades)


def _avg_loss_r(trades: list[dict]) -> float | None:
    """Average R-multiple for losing trades (negative number)."""
    losses = [_to_float(t.get("r_multiple")) for t in trades
              if (_to_float(t.get("pnl_dollar")) < 0)
              and t.get("r_multiple") is not None]
    if not losses:
        return None
    return sum(losses) / len(losses)


def _avg_risk_dollars(trades: list[dict]) -> float | None:
    """Average dollar risk (shares × |entry - stop|) per trade."""
    risks = []
    for t in trades:
        entry = _to_float(t.get("entry_price"))
        stop = _to_float(t.get("original_stop"))
        shares = _to_float(t.get("shares"))
        if entry > 0 and stop > 0 and shares > 0:
            risks.append(shares * abs(entry - stop))
    if not risks:
        return None
    return sum(risks) / len(risks)


def _mistake_counts(trades: list[dict]) -> Counter:
    c: Counter = Counter()
    for t in trades:
        tags = t.get("mistake_tags")
        if not tags:
            continue
        # tags can be a comma-separated string or a JSON list
        if isinstance(tags, str):
            for tag in tags.split(","):
                tag = tag.strip()
                if tag:
                    c[tag] += 1
        elif isinstance(tags, list):
            for tag in tags:
                if tag:
                    c[str(tag).strip()] += 1
    return c


# ── Public API ─────────────────────────────────────────────────────────────

def detect_drift(user_id: str) -> list[dict]:
    """
    Run all drift checks. Returns a list of findings — each is
    {kind, headline, body, importance, metric_delta}. Caller is
    responsible for queueing via voice_proactive_service.add_insight.
    """
    findings: list[dict] = []
    try:
        from api.services.journal_two import trades as j2_trades
        all_trades = j2_trades.list_trades_for_user(user_id) or []
    except Exception as e:
        _log.warning("[drift] list_trades_for_user failed: %s", e)
        return findings

    recent, baseline = _split_windows(all_trades)

    # ── Win rate drop ──
    rec_wr = _win_rate(recent)
    base_wr = _win_rate(baseline)
    if (rec_wr is not None and base_wr is not None
            and len(recent) >= MIN_TRADES and len(baseline) >= MIN_TRADES):
        delta = rec_wr - base_wr
        if delta <= -0.10:  # 10pp drop
            findings.append({
                "kind": "drift_warning",
                "subkind": "win_rate_drop",
                "headline": f"Win rate dropped from {int(base_wr*100)}% to {int(rec_wr*100)}%",
                "body": (
                    f"Over the last {RECENT_DAYS} days ({len(recent)} closed "
                    f"trades) vs the prior {BASELINE_DAYS} days "
                    f"({len(baseline)} closed). Coach: surface this."
                ),
                "importance": 8,
                "metric_delta": round(delta, 3),
            })

    # ── Avg losing R got worse ──
    rec_loss = _avg_loss_r(recent)
    base_loss = _avg_loss_r(baseline)
    if (rec_loss is not None and base_loss is not None
            and len(recent) >= MIN_TRADES):
        delta = rec_loss - base_loss  # both negative; more negative = worse
        if delta <= -0.5:
            findings.append({
                "kind": "drift_warning",
                "subkind": "avg_loss_grew",
                "headline": (
                    f"Average loss got worse: {base_loss:.2f}R → {rec_loss:.2f}R"
                ),
                "body": (
                    "You're losing more per losing trade than your baseline. "
                    "Possible causes: looser stops, holding losers, "
                    "oversized entries."
                ),
                "importance": 7,
                "metric_delta": round(delta, 2),
            })

    # ── Mistake recurrence ──
    rec_mistakes = _mistake_counts(recent)
    for tag, count in rec_mistakes.items():
        if count >= 3:
            findings.append({
                "kind": "drift_warning",
                "subkind": "mistake_recurrence",
                "headline": f"Mistake '{tag}' tagged {count} times in last 30 days",
                "body": (
                    f"This pattern is repeating. Coach: address it before "
                    f"it costs more."
                ),
                "importance": 6 + min(count - 3, 3),  # 6-9
                "metric_delta": count,
            })

    # ── Size creep ──
    rec_risk = _avg_risk_dollars(recent)
    base_risk = _avg_risk_dollars(baseline)
    if (rec_risk is not None and base_risk is not None
            and base_risk > 0 and len(recent) >= MIN_TRADES):
        ratio = rec_risk / base_risk
        if ratio >= 1.30:
            findings.append({
                "kind": "drift_warning",
                "subkind": "size_creep",
                "headline": (
                    f"Position risk up {int((ratio-1)*100)}% vs baseline "
                    f"(${int(base_risk)} → ${int(rec_risk)})"
                ),
                "body": (
                    "Size has crept up. Risk Officer: verify this is "
                    "intentional, not drift from discipline."
                ),
                "importance": 7,
                "metric_delta": round(ratio, 2),
            })

    # ── Frequency spike (overtrading) ──
    if len(baseline) >= MIN_TRADES and len(baseline) > 0:
        # Normalize for window length (both 30 days here, so a direct ratio)
        ratio = len(recent) / max(1, len(baseline))
        if ratio >= 1.5:
            findings.append({
                "kind": "drift_warning",
                "subkind": "frequency_spike",
                "headline": (
                    f"Trade frequency up {int((ratio-1)*100)}% "
                    f"({len(baseline)} → {len(recent)} per 30d)"
                ),
                "body": (
                    "More trades than baseline. Risk: overtrading in chop "
                    "burns through expectancy. Coach: check if regime "
                    "changed or discipline slipped."
                ),
                "importance": 6,
                "metric_delta": round(ratio, 2),
            })

    return findings


def emit_drift_insights(user_id: str) -> int:
    """
    Run detect_drift and queue findings via the proactive pipeline.
    Returns count of insights queued (after cooldown/cap filtering).
    """
    from api.services.voice_proactive_service import add_insight
    findings = detect_drift(user_id)
    queued = 0
    for f in findings:
        # Use subkind as a pseudo-symbol so per-symbol cooldown dedups by
        # the specific drift type (we don't want win_rate_drop to spam
        # every 30 min).
        rid = add_insight(
            user_id,
            kind=f["kind"],
            symbol=f["subkind"],  # repurposed as cooldown key
            headline=f["headline"],
            body=f.get("body"),
            importance=f.get("importance", 6),
        )
        if rid:
            queued += 1
    _log.info("[drift] user=%s findings=%d queued=%d",
              user_id, len(findings), queued)
    return queued
