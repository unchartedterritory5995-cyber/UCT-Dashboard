"""
Prompt variant registry — Batch 13b.

Defines named prompt variants and provides epsilon-greedy selection at
session_token mint time. The chosen variant_id flows into
voice_prompt_variants → voice_reward_model so we can measure which
variants produce better experiences.

Design:
  - Each context (global, analyst, risk_officer, coach, scout, train_me,
    orchestrator) has a list of variants. Each variant has an id, a
    `suffix` appended to the base prompt, and a `weight` for initial
    exposure.
  - select_variant(context, user_id?) uses epsilon-greedy: with prob ε
    pick a random variant (exploration), otherwise pick the highest-
    scoring variant with enough volume (exploitation). Falls back to
    weighted random if nothing has enough data yet.
  - get_prompt_suffix(context, variant_id) returns the text to append
    to the base prompt for that variant.

Adding a new variant: drop it into VARIANTS below. Existing scoreboard
keeps working; new variant joins the rotation immediately.
"""

import logging
import random
from typing import Any

_log = logging.getLogger(__name__)

# Exploration probability — 20% of sessions try a random non-leading variant
EXPLORATION_EPSILON = 0.20

# Minimum feedback volume before we trust a variant's score over weighted random
MIN_VOLUME_TO_EXPLOIT = 5


# Variant definitions. Each entry: {id, weight, suffix, description}.
# variant_id "default" means "no suffix added" — the base prompt as written
# in voice.py / voice_agents.py.
VARIANTS: dict[str, list[dict[str, Any]]] = {
    "global": [
        {
            "id": "v1",
            "weight": 1.0,
            "suffix": "",
            "description": "Baseline (no modifications).",
        },
        {
            "id": "v1_concise",
            "weight": 1.0,
            "suffix": (
                "\n\nSTYLE OVERRIDE: Cap every reply at 2 sentences unless the "
                "user explicitly asks for depth. Trade words for precision — "
                "no filler, no hedging, no 'great question'."
            ),
            "description": "Tighter, more clipped replies.",
        },
        {
            "id": "v1_proactive",
            "weight": 1.0,
            "suffix": (
                "\n\nPROACTIVE OVERRIDE: After answering, suggest ONE adjacent "
                "next step the user might want (a related ticker, a deeper "
                "tool, a journal review). One sentence only. Skip the "
                "suggestion if it would feel forced."
            ),
            "description": "Adds a one-line forward-looking nudge.",
        },
    ],
    "analyst": [
        {
            "id": "analyst_v1", "weight": 1.0, "suffix": "",
            "description": "Baseline analyst.",
        },
        {
            "id": "analyst_v1_quant",
            "weight": 1.0,
            "suffix": (
                "\n\nSTYLE OVERRIDE: Always lead with the numbers. 'NVDA at "
                "$202, theme +3.2%, your hit rate on this setup is 68%.' "
                "Narrative second. Cite at least two numeric anchors per reply."
            ),
            "description": "Numbers-first analytical voice.",
        },
    ],
    "risk_officer": [
        {
            "id": "risk_v1", "weight": 1.0, "suffix": "",
            "description": "Baseline risk officer.",
        },
        {
            "id": "risk_v1_terse",
            "weight": 1.0,
            "suffix": (
                "\n\nSTYLE OVERRIDE: Maximum brevity. One sentence per "
                "approval or refusal. Always quote dollar risk and account "
                "percent. No softening language — 'No' is a complete sentence."
            ),
            "description": "Maximally terse risk decisions.",
        },
    ],
    "coach": [
        {
            "id": "coach_v1", "weight": 1.0, "suffix": "",
            "description": "Baseline coach.",
        },
        {
            "id": "coach_v1_data",
            "weight": 1.0,
            "suffix": (
                "\n\nSTYLE OVERRIDE: Every observation MUST cite a specific "
                "number from the user's journal — 'you went 7-of-10 on flag "
                "breakouts this month', not 'you're doing well on flags.' "
                "If you can't cite a number, don't make the claim."
            ),
            "description": "Coach with mandatory data citation.",
        },
    ],
    "scout": [
        {
            "id": "scout_v1", "weight": 1.0, "suffix": "",
            "description": "Baseline scout.",
        },
    ],
    "orchestrator": [
        {
            "id": "orchestrator_v1", "weight": 1.0, "suffix": "",
            "description": "Baseline orchestrator.",
        },
    ],
    "train_me": [
        {
            "id": "train_me_v1", "weight": 1.0, "suffix": "",
            "description": "Baseline training mode.",
        },
    ],
}


def _variants_for(context: str) -> list[dict[str, Any]]:
    """Return variant list for a context, falling back to global."""
    return VARIANTS.get(context) or VARIANTS["global"]


def get_prompt_suffix(context: str, variant_id: str) -> str:
    """Return the suffix to append to the base prompt for the chosen variant."""
    for v in _variants_for(context):
        if v["id"] == variant_id:
            return v.get("suffix", "")
    return ""


def list_variants(context: str) -> list[dict[str, Any]]:
    """Public lister — safe shape for UI consumption."""
    return [{"id": v["id"], "weight": v["weight"],
             "description": v.get("description", "")}
            for v in _variants_for(context)]


def select_variant(context: str, user_id: str | None = None) -> str:
    """
    Epsilon-greedy selection:
      - With probability ε: weighted random across all variants (exploration)
      - Otherwise: best-scoring variant per user (exploitation). If no
        variant has enough volume, fall back to weighted random.

    Returns the chosen variant_id.
    """
    variants = _variants_for(context)
    if len(variants) == 1:
        return variants[0]["id"]

    # Exploration: weighted random
    if random.random() < EXPLORATION_EPSILON:
        return _weighted_random(variants)

    # Exploitation: highest-scoring variant with enough volume
    if user_id:
        try:
            from api.services.voice_reward_model import variant_scoreboard
            rows = variant_scoreboard(user_id, days=60)
            # Restrict to variants in THIS context
            valid_ids = {v["id"] for v in variants}
            ranked = [r for r in rows
                       if r["variant_id"] in valid_ids
                       and r["feedback_volume"] >= MIN_VOLUME_TO_EXPLOIT
                       and r["score"] is not None]
            if ranked:
                return ranked[0]["variant_id"]
        except Exception as e:  # noqa: BLE001
            _log.warning("[prompt_registry] scoreboard lookup failed: %s", e)

    # Cold start: weighted random
    return _weighted_random(variants)


def _weighted_random(variants: list[dict[str, Any]]) -> str:
    weights = [max(0.0, v.get("weight", 1.0)) for v in variants]
    total = sum(weights)
    if total <= 0:
        return variants[0]["id"]
    r = random.random() * total
    cum = 0.0
    for v, w in zip(variants, weights):
        cum += w
        if r <= cum:
            return v["id"]
    return variants[-1]["id"]
