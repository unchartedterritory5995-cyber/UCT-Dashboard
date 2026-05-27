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
        "FRED_API_KEY",
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
    ],
    "feature_flags": [
        "TWITTERAPI_IO_ENABLED",
        "RECONCILE_ENABLED",
        "WORKER_ENABLED",
    ],
}


def _key_status(name: str) -> dict:
    v = (os.environ.get(name) or "").strip()
    return {"set": bool(v), "length": len(v) if v else 0}


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
