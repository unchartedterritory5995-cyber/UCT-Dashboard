"""Admin endpoint: report which external API keys are set + feature flags.

Used to verify Railway env wiring without exposing secrets. Returns boolean
'set / not set' per key — never returns the key values themselves.
"""

from __future__ import annotations

import os

from fastapi import APIRouter, Depends

from api.middleware.auth_middleware import require_admin

router = APIRouter(prefix="/api/admin", tags=["admin-api-health"])

# Every external API key the codebase references — grouped by capability.
_KEYS = {
    "llm_and_voice": [
        "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY",
        "PERPLEXITY_API_KEY",
        "OPENAI_REALTIME_MODEL",
        "DEEP_RESEARCH_MODEL",
    ],
    "market_data": [
        "MASSIVE_API_KEY",
        "MASSIVE_SECRET_KEY",
        "FINNHUB_API_KEY",
        "FMP_API_KEY",
        "ALPHAVANTAGE_API_KEY",
    ],
    # Economic data (api/services/econ). FRED_API_KEY is gone on purpose: FRED is
    # retired as a source and api/services/fred_economic.py ignores the key.
    "economic_data": [
        "BLS_API_KEY",
        "BEA_API_KEY",
        "CENSUS_API_KEY",
        "EIA_API_KEY",
    ],
    "news_and_social": [
        "TWITTERAPI_IO_API_KEY",
        "REDDIT_CLIENT_ID",
        "REDDIT_CLIENT_SECRET",
        "THEFLY_API_KEY",
        "THEFLY_BASE_URL",
    ],
    "infra_and_comms": [
        "RESEND_API_KEY",
        "DISCORD_WEBHOOK_URL",
        "STRIPE_SECRET_KEY",
        "STRIPE_WEBHOOK_SECRET",
        # TERM-011 / RM-N09 step 1 -- the ops/business routing destinations.
        # NAMED, UNREAD: they are set on no service, nothing routes by them yet
        # (api/services/alert_routing.py is a resolver with no caller), and they
        # are here because "a variable that is not in this list is a variable
        # nobody can check without Railway". Blank is how each is turned off --
        # never removed (feedback_kill_switch_never_a_delete).
        "DISCORD_OPS_WEBHOOK_URL",
        "DISCORD_BUSINESS_WEBHOOK_URL",
        # A DELIVERY-ONLY address var, deliberately NOT ADMIN_EMAILS: an address
        # in ADMIN_EMAILS is promoted to role=admin on signup and on login, so
        # adding one there to receive a page would grant it production admin.
        "OPS_ALERT_EMAIL_TO",
    ],
    "feature_flags": [
        "TWITTERAPI_IO_ENABLED",
        "RECONCILE_ENABLED",
        "WORKER_ENABLED",
        "FUNDAMENTALS_MONITOR_ENABLED",
        "PROVIDER_COVERAGE_MONITOR_ENABLED",
        # Kill switch, so UNSET IS ON -- read per call in
        # alert_routing.routing_enabled(). Reported here so "off on purpose" can
        # be told apart from "nobody set it" without a Railway read.
        "ALERT_ROUTING_ENABLED",
    ],
}


def _key_status(name: str) -> dict:
    v = (os.environ.get(name) or "").strip()
    return {"set": bool(v), "length": len(v) if v else 0}


@router.get("/voice-tool-latency")
def voice_tool_latency(days: int = 7, user=Depends(require_admin)) -> dict:
    """ADMIN — voice tool call latency stats over the last N days. Surfaces
    slowest individual calls + per-tool averages, to debug 'intermittent
    hang' user reports. Look for tools with high max_ms or many over_5s."""
    from api.services.auth_db import get_connection
    days = max(1, min(30, int(days or 7)))
    conn = get_connection()
    try:
        slow_calls = [dict(r) for r in conn.execute(
            """SELECT tool_name, latency_ms, ok, error, created_at, user_id
                 FROM voice_tool_calls
                WHERE created_at >= datetime('now', ?)
                  AND latency_ms IS NOT NULL
                ORDER BY latency_ms DESC LIMIT 30""",
            (f"-{days} day",),
        ).fetchall()]
        per_tool = [dict(r) for r in conn.execute(
            """SELECT tool_name,
                      COUNT(*) AS n,
                      ROUND(AVG(latency_ms)) AS avg_ms,
                      ROUND(MAX(latency_ms)) AS max_ms,
                      SUM(CASE WHEN latency_ms > 5000 THEN 1 ELSE 0 END) AS over_5s,
                      SUM(CASE WHEN latency_ms > 10000 THEN 1 ELSE 0 END) AS over_10s,
                      SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS errs
                 FROM voice_tool_calls
                WHERE created_at >= datetime('now', ?)
                  AND latency_ms IS NOT NULL
                GROUP BY tool_name
               HAVING avg_ms > 200
                ORDER BY over_5s DESC, avg_ms DESC LIMIT 30""",
            (f"-{days} day",),
        ).fetchall()]
        total = conn.execute(
            "SELECT COUNT(*) AS c FROM voice_tool_calls "
            "WHERE created_at >= datetime('now', ?)",
            (f"-{days} day",),
        ).fetchone()["c"]
        return {
            "days_window": days,
            "total_calls": total,
            "slowest_30": slow_calls,
            "per_tool_aggregates": per_tool,
            "note": "tools with high over_5s are the prime suspects for "
                    "intermittent 'hang' reports — Compass calls them mid-"
                    "conversation and the user hears silence.",
        }
    finally:
        conn.close()


@router.get("/voice-hallucinations")
def voice_hallucinations(limit: int = 100, user=Depends(require_admin)) -> dict:
    """ADMIN — all flagged hallucinations across all users (recent first).
    Plus aggregate stats. For the Voice Hallucinations dashboard."""
    from api.services.voice_hallucination_audit import list_all_flags, stats
    return {
        "stats": stats(),
        "flags": list_all_flags(limit=limit),
    }


@router.get("/api-health")
def api_health(user=Depends(require_admin)) -> dict:
    """Report which API keys + feature flags are set on this deploy.
    Never returns the values themselves — just boolean + length."""
    groups: dict[str, dict] = {}
    for group, keys in _KEYS.items():
        groups[group] = {k: _key_status(k) for k in keys}

    # Compute summary counts
    total = sum(len(v) for v in _KEYS.values())
    set_count = sum(
        1
        for g in groups.values()
        for status in g.values()
        if status["set"]
    )

    return {
        "summary": {
            "keys_total": total,
            "keys_set": set_count,
            "keys_missing": total - set_count,
        },
        "groups": groups,
    }
