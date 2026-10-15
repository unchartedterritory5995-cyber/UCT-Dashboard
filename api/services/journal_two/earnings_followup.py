"""Tier 2 part B, item 11: the earnings follow-up notice (spec §P2 Tier 2 item 11).

This commit holds the gate only; the job lands in Task 7 of the Tier 2 part B plan.
"""
from __future__ import annotations

from api.services.notebook_flags import flag_on

FLAG = "NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED"


def enabled() -> bool:
    """The gate, read per call (default OFF): the job, the card and the server prefill."""
    return flag_on(FLAG, False)
