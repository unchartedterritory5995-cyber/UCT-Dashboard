"""
Voice cost accounting — Polish P4.

OpenAI pricing (as of 2026-05):
  gpt-realtime audio:   $0.06/M input tokens,  $0.24/M output tokens
                         (≈ $0.20-0.40 per minute of active conversation)
  whisper-1:            $0.006/minute
  tts-1-hd:             $0.030 per 1000 chars
  gpt-4o-mini:          $0.150/M input, $0.600/M output (intent classify)
  gpt-4o vision:        $2.50/M input,  $10.00/M output
  text-embedding-3-small: $0.020/M tokens

We estimate per-session cost at end_session (Mode C) and per-call for
Modes A/B. Aggregations expose monthly burn + projection.
"""

import logging
from datetime import datetime, timezone, timedelta

from api.services.auth_db import get_connection

_log = logging.getLogger(__name__)

# Rough per-minute Mode C cost (input + output averaged).
# At ~12 tokens/sec input from user, ~30 tokens/sec output from model,
# realistic average is ~$0.30/min for a back-and-forth conversation.
MODE_C_USD_PER_MINUTE = 0.30
WHISPER_USD_PER_MINUTE = 0.006
TTS_USD_PER_1K_CHARS = 0.030
GPT4O_MINI_USD_PER_CALL = 0.0008  # ~500 tokens in + 200 out per intent classify
VISION_USD_PER_CALL = 0.03        # ~3k input tokens (image) + 600 output


def estimate_mode_a_cost(text_chars: int) -> float:
    """TTS read-aloud — per-character pricing."""
    return round((text_chars / 1000.0) * TTS_USD_PER_1K_CHARS, 4)


def estimate_mode_b_cost(audio_seconds: int) -> float:
    """One-shot Whisper STT + gpt-4o-mini classification.
    Doesn't include the TTS of the answer (separately tracked as Mode A)."""
    whisper = (audio_seconds / 60.0) * WHISPER_USD_PER_MINUTE
    return round(whisper + GPT4O_MINI_USD_PER_CALL, 4)


def estimate_mode_c_cost(duration_seconds: int) -> float:
    """Realtime conversation — duration-based, with a small floor."""
    minutes = max(1, duration_seconds) / 60.0
    return round(minutes * MODE_C_USD_PER_MINUTE, 4)


def estimate_vision_cost() -> float:
    """Per chart vision call."""
    return VISION_USD_PER_CALL


def stamp_session_cost(session_id: int, duration_seconds: int) -> float:
    """At session end, compute + persist the estimated cost.
    Returns the cost in USD."""
    cost = estimate_mode_c_cost(duration_seconds)
    conn = get_connection()
    try:
        conn.execute(
            "UPDATE voice_sessions SET estimated_cost_usd = ? WHERE id = ?",
            (cost, session_id),
        )
        conn.commit()
    finally:
        conn.close()
    return cost


def get_monthly_cost_summary(user_id: str) -> dict:
    """Aggregate all voice cost sources for the user's current calendar month."""
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    cutoff = month_start.isoformat()

    conn = get_connection()
    try:
        # Mode C from voice_sessions
        row = conn.execute(
            """SELECT COALESCE(SUM(estimated_cost_usd), 0) AS mode_c_cost,
                       COALESCE(SUM(duration_seconds), 0) AS mode_c_seconds,
                       COUNT(*) AS mode_c_sessions
                  FROM voice_sessions
                 WHERE user_id = ? AND started_at >= ? AND mode = 'c'""",
            (user_id, cutoff),
        ).fetchone()
        mode_c_cost = float(row["mode_c_cost"] or 0)
        mode_c_seconds = int(row["mode_c_seconds"] or 0)
        mode_c_sessions = int(row["mode_c_sessions"] or 0)

        # Mode A from voice_usage_monthly (TTS seconds)
        row_a = conn.execute(
            """SELECT COALESCE(seconds_used, 0) AS s
                  FROM voice_usage_monthly
                 WHERE user_id = ?
                 ORDER BY month_key DESC LIMIT 1""",
            (user_id,),
        ).fetchone()
        # Rough: 1 second of TTS ≈ 25 chars at 150 WPM. Use 25 chars/sec.
        mode_a_chars_estimate = (row_a["s"] if row_a else 0) * 25
        mode_a_cost = estimate_mode_a_cost(mode_a_chars_estimate)

        # Mode B oneshot count (rough proxy: voice_sessions where mode='b')
        row_b = conn.execute(
            """SELECT COUNT(*) AS n
                  FROM voice_sessions
                 WHERE user_id = ? AND started_at >= ? AND mode = 'b'""",
            (user_id, cutoff),
        ).fetchone()
        mode_b_calls = int(row_b["n"] or 0)
        mode_b_cost = round(mode_b_calls * 0.002, 4)  # ~$0.002 per call avg
    finally:
        conn.close()

    total_cost = round(mode_c_cost + mode_a_cost + mode_b_cost, 4)

    # Project to end of month
    days_in_month = ((month_start.replace(month=month_start.month % 12 + 1, day=1)
                      if month_start.month < 12
                      else month_start.replace(year=month_start.year + 1, month=1, day=1))
                     - month_start).days
    days_elapsed = max(1, (now - month_start).days + 1)
    daily_rate = total_cost / days_elapsed
    projected_month_total = round(daily_rate * days_in_month, 2)

    return {
        "month_to_date_usd": total_cost,
        "projected_month_usd": projected_month_total,
        "days_elapsed": days_elapsed,
        "days_in_month": days_in_month,
        "daily_rate_usd": round(daily_rate, 4),
        "breakdown": {
            "mode_c_realtime": {
                "cost_usd": round(mode_c_cost, 4),
                "sessions": mode_c_sessions,
                "minutes": round(mode_c_seconds / 60.0, 1),
            },
            "mode_a_tts": {
                "cost_usd": round(mode_a_cost, 4),
                "seconds": row_a["s"] if row_a else 0,
            },
            "mode_b_oneshot": {
                "cost_usd": round(mode_b_cost, 4),
                "calls": mode_b_calls,
            },
        },
    }
