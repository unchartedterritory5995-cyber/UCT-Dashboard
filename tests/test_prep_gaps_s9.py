"""Audit 2026-11-05, spec S9 (detail #49): a prep gap that fills itself never asks the member to "capture again".

`trader_blocks.PREP_RETRYABLE` names the gaps the open note reads again in the background (PrepCapture.jsx's
`RETRYABLE`). ONE fact in two files, pinned against each other: the client list is PARSED here, never restated.
"""
from __future__ import annotations

import re
from pathlib import Path

from api.services.journal_two import trader_blocks

CLIENT = Path(__file__).resolve().parents[1] / "app" / "src" / "pages" / "journal-2-0" / "components" / "notebook" \
    / "blocks" / "PrepCapture.jsx"


def _client_retryable() -> list[str]:
    src = CLIENT.read_text(encoding="utf-8")
    m = re.search(r"export const RETRYABLE = \[([^\]]*)\]", src)
    assert m, "PrepCapture.jsx no longer declares RETRYABLE"
    return re.findall(r"'([a-z_]+)'", m.group(1))


def test_the_client_retries_exactly_the_server_retryable_gaps():
    assert _client_retryable() == list(trader_blocks.PREP_RETRYABLE)


def test_every_retryable_gap_is_a_real_gap_code():
    assert set(trader_blocks.PREP_RETRYABLE) <= set(trader_blocks.PREP_GAPS)


def test_no_retryable_gap_asks_the_member_to_retry():
    for code in trader_blocks.PREP_RETRYABLE:
        words = trader_blocks.PREP_GAPS[code].lower()
        assert "capture again" not in words and "try again" not in words, code


def test_the_frozen_earnings_gap_promises_nothing():
    """Fix round 1 (review finding 7b): the sentence is FROZEN into the note, so it must stay true on every later day:
    no "fills in" promise (that live wording is the client's alone, while it is really reading again)."""
    assert trader_blocks.PREP_GAPS["no_earnings_yet"] == "Today's earnings list was still loading when this was captured."
    for code in trader_blocks.PREP_RETRYABLE:
        assert "fills in" not in trader_blocks.PREP_GAPS[code], code
