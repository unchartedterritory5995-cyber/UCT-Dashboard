"""Correlation ids.

One id per interaction, derived from Discord's own interaction id so it is the SAME
id however many times the job is resumed, retried or logged, on whichever pod runs it.
It is short because a member reads it back to us: "id 7f3a9c21".
"""
from __future__ import annotations

import hashlib
import re
import uuid

CORR_ID_LEN = 8
_CORR_RE = re.compile(r"^[0-9a-f]{%d}$" % CORR_ID_LEN)


def corr_id(interaction_id: str | None) -> str:
    """8 hex chars of sha1(interaction id); a random id when Discord sent none."""
    raw = str(interaction_id or "").strip()
    if not raw:
        return uuid.uuid4().hex[:CORR_ID_LEN]
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:CORR_ID_LEN]


def is_corr_id(value: str | None) -> bool:
    return bool(_CORR_RE.match(str(value or "")))
