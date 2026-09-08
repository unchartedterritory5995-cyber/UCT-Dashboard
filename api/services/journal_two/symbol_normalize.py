"""Shared symbol-spelling canonicalization for Journal 2.0.

Single source of truth for the one normalization step every J2 financial
write path should apply: uppercase, trim, and map a single class-share dot
suffix to a hyphen (BRK.B -> BRK-B) to match the app's canonical internal
symbology. This is a spelling normalization only -- it never validates
existence, never resolves identity, and never rejects an input. Entity
Master (S3) resolution and existence/tradability checks are a deliberately
separate concern (Identity Normalization Hardening V1, Phase A: a hard
existence check on a manual write would wrongly reject legitimate
delisted/historical securities).

Relocated (not reinvented) from
`api/services/journal_two/broker/snaptrade_adapter.py::normalize_symbol`,
which already applied this exact transform to every broker-synced write.
`snaptrade_adapter.py` now imports from here so there is exactly one
implementation, reused identically by manual AddPosition/AddTrade writes,
CSV import, and SnapTrade broker sync.
"""
from __future__ import annotations

import re
from typing import Any


def normalize_symbol(raw: Any) -> str | None:
    """Uppercase, trim, and map class-share dots to hyphens (BRK.B -> BRK-B)
    to match the app's canonical internal symbology (to_polygon_symbol maps
    hyphen->dot only at the Massive boundary)."""
    if raw is None:
        return None
    s = str(raw).strip().upper()
    if not s:
        return None
    # Single class suffix like BRK.B / BF.B -> BRK-B / BF-B.
    s = re.sub(r"\.([A-Z])$", r"-\1", s)
    return s
