"""
Journal AI — trade summaries and weekly digests via Claude Haiku.
Uses existing ANTHROPIC_API_KEY env var. Cost: ~$0.001 per summary.
"""

import os
import logging
import threading
from datetime import datetime, timedelta

from api.services.auth_db import get_connection
from api.services.journal_service import get_entry

_logger = logging.getLogger(__name__)

_client = None
_client_lock = threading.Lock()

_AI_MODEL = "claude-haiku-4-5-20251001"


def _get_client():
    """Return the module-level Anthropic client, initializing it once (thread-safe)."""
    global _client
    if _client is None:
        with _client_lock:
            if _client is None:
                import anthropic
                api_key = os.environ.get("ANTHROPIC_API_KEY")
                if not api_key:
                    raise RuntimeError("ANTHROPIC_API_KEY is not set")
                _client = anthropic.Anthropic(api_key=api_key)
    return _client


def generate_trade_summary(user_id: str, trade_id: str, force: bool = False) -> dict:
    """Generate AI summary for a single trade. Returns {summary, cached} or {error}."""
    entry = get_entry(user_id, trade_id)
    if not entry:
        return {"error": "Trade not found"}

    # Return cached unless force regenerate
    if entry.get("ai_summary") and not force:
        return {"summary": entry["ai_summary"], "cached": True}

    # Build prompt context
    direction = entry.get("direction", "long")
    pnl = entry.get("pnl_pct")
    r_mult = entry.get("realized_r")
    setup = entry.get("setup") or "Unknown"
    thesis = entry.get("thesis") or "Not provided"
    lesson = entry.get("lesson") or ""
    mistakes = entry.get("mistake_tags") or "None"
    process_score = entry.get("process_score")
    notes = entry.get("notes") or ""
    holding = entry.get("holding_minutes")

    holding_str = ""
    if holding is not None:
        if holding < 60:
            holding_str = f"{holding}min"
        elif holding < 1440:
            holding_str = f"{holding / 60:.1f}hr"
        else:
            holding_str = f"{holding / 1440:.1f}d"

    prompt = f"""Analyze this trade and provide:
1. A 2-3 sentence recap of what happened
2. One key takeaway
3. One specific improvement suggestion

Trade details:
- Symbol: {entry.get('sym')} ({direction})
- Setup: {setup}
- Entry: ${entry.get('entry_price')} -> Exit: ${entry.get('exit_price') or 'still open'}
- P&L: {f'{pnl:+.1f}%' if pnl is not None else 'N/A'} | R-Multiple: {r_mult or 'N/A'}
- Process Score: {process_score or 'Not scored'}/100
- Holding Time: {holding_str or 'Unknown'}
- Thesis: {thesis[:500]}
- Mistakes: {mistakes}
- Notes: {notes[:500]}
- Lesson: {lesson[:300]}

Be direct and specific. No generic advice. Reference the actual trade data.
Format your response as:
**Recap:** [2-3 sentences]
**Takeaway:** [one sentence]
**Improvement:** [one specific suggestion]"""

    try:
        client = _get_client()
        response = client.messages.create(
            model=_AI_MODEL,
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}],
        )
        summary = response.content[0].text

        # Cache in DB
        conn = get_connection()
        try:
            conn.execute(
                "UPDATE journal_entries SET ai_summary = ? WHERE id = ? AND user_id = ?",
                (summary, trade_id, user_id),
            )
            conn.commit()
        finally:
            conn.close()

        _logger.info(f"Generated AI summary for trade {trade_id} (user {user_id[:8]})")
        return {"summary": summary, "cached": False}

    except Exception as e:
        _logger.error(f"AI summary generation failed for trade {trade_id}: {e}")
        return {"error": str(e)}


def generate_weekly_digest(user_id: str, week_start: str) -> dict:
    """Generate AI weekly digest. week_start is YYYY-MM-DD (Monday)."""
    conn = get_connection()
    try:
        # Validate and compute week range
        try:
            start_dt = datetime.strptime(week_start, "%Y-%m-%d")
        except ValueError:
            return {"error": "Invalid date format. Use YYYY-MM-DD."}

        end_dt = start_dt + timedelta(days=6)
        end_str = end_dt.strftime("%Y-%m-%d")

        # Get week's trades
        rows = conn.execute(
            """SELECT sym, direction, setup, pnl_pct, realized_r, process_score,
                      mistake_tags, entry_date, entry_price, exit_price
               FROM journal_entries
               WHERE user_id = ? AND status = 'closed'
               AND entry_date >= ? AND entry_date <= ?
               ORDER BY entry_date""",
            (user_id, week_start, end_str),
        ).fetchall()
        trades = [dict(r) for r in rows]

        if not trades:
            return {"digest": "No closed trades this week.", "trade_count": 0, "week": week_start}

        # Build summary data
        with_pnl = [t for t in trades if t.get("pnl_pct") is not None]
        wins = [t for t in with_pnl if t["pnl_pct"] > 0]
        losses = [t for t in with_pnl if t["pnl_pct"] <= 0]
        total_pnl = sum(t["pnl_pct"] for t in with_pnl)

        all_mistakes = []
        for t in trades:
            if t.get("mistake_tags"):
                all_mistakes.extend([m.strip() for m in t["mistake_tags"].split(",") if m.strip()])

        with_ps = [t for t in trades if t.get("process_score") is not None]
        avg_ps = sum(t["process_score"] for t in with_ps) / len(with_ps) if with_ps else None

        # Format trade list for prompt
        trade_lines = []
        for t in trades:
            pnl_str = f"{t.get('pnl_pct', 0):+.1f}%" if t.get("pnl_pct") is not None else "N/A"
            trade_lines.append(
                f"  {t['sym']} {t['direction']} ({t.get('setup', '?')}): "
                f"{pnl_str} | R={t.get('realized_r', '?')} | "
                f"Process={t.get('process_score', '?')}"
            )

        mistake_summary = ", ".join(set(all_mistakes)) if all_mistakes else "None tagged"

        prompt = f"""Analyze this trader's week and provide:
1. A brief overview (2-3 sentences)
2. Top 3 patterns you notice (what's working, what isn't)
3. The single biggest lesson from this week
4. One specific focus area for next week

Week: {week_start} to {end_str}
Record: {len(wins)}W / {len(losses)}L | Net P&L: {total_pnl:+.1f}%
Average Process Score: {f'{avg_ps:.0f}/100' if avg_ps else 'Not scored'}
Most common mistakes: {mistake_summary}

Trades:
{chr(10).join(trade_lines)}

Be specific to THIS data. No generic trading advice. Reference actual symbols and numbers.
Format your response as:
**Overview:** [2-3 sentences]
**Patterns:**
1. [pattern]
2. [pattern]
3. [pattern]
**Biggest Lesson:** [one sentence]
**Next Week Focus:** [one specific action item]"""

        client = _get_client()
        response = client.messages.create(
            model=_AI_MODEL,
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}],
        )

        _logger.info(f"Generated weekly digest for {week_start} (user {user_id[:8]}, {len(trades)} trades)")

        return {
            "digest": response.content[0].text,
            "trade_count": len(trades),
            "week": week_start,
            "wins": len(wins),
            "losses": len(losses),
            "net_pnl": round(total_pnl, 2),
            "generated_at": datetime.utcnow().isoformat(),
        }

    except Exception as e:
        _logger.error(f"Weekly digest generation failed for {week_start}: {e}")
        return {"error": str(e)}
    finally:
        conn.close()
