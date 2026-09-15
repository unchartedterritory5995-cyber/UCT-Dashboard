"""Catalog category labels fold onto one spelling each. ONE authority, two tools.

⛔ The category is FREE TEXT on each transcript record (`edu_videos.category`: `TEXT NOT NULL
DEFAULT 'General'`, no CHECK, no enum — `api/services/education_service.py:45`), and the Desk
auto-publish route writes the **hand-typed Zoom webinar name verbatim**, collapsing whitespace but
not folding case (`api/services/desk_daily_session.py:90`). So both defects folded here live in
the DATA, not in code:

  · `LIVE TRAIDNG`                  — a typo'd category (1 source, 54 segments)
  · `Sharpen Your/your Trading Skills` — one category in two casings (1 source each)

⭐ **Why this module exists at all.** Session 4 fixed these in the catalog reader and left a
SECOND `CATEGORY_STREAM` carrying the same typo in `tools/wisdom_golden_verify.py` — recording it
honestly as out of scope rather than asserting a repo-wide uniqueness that was false. Owner ruling
R19 (2026-09-14) folded it in. A typo mapped in two places is two authorities over one value, and
the second one goes stale silently; the fix is one definition both tools import, not two copies
kept in step by hope.

⚠️ Folded on READ. The artifact and the source records are never rewritten from here — repairing
the write path is the Desk programme's call (Q22), outside Wisdom's paths.
"""
from __future__ import annotations

#: Keyed by casefold, so a third casing folds in without a code change.
CATEGORY_ALIASES = {
    "live traidng": "Live Trading Sessions",
    "sharpen your trading skills": "Sharpen Your Trading Skills",
}


def normalize_category(raw):
    """Fold a raw category label onto one canonical spelling. Falsy input returns unchanged.

    ⛔ Callers must normalise BEFORE any `CATEGORY_STREAM` lookup, never after — the alias
    resolves to a key those maps already hold, so the stream assignment is unchanged either way,
    and normalising first is what lets the typo be deleted from the maps instead of duplicated
    into them.
    """
    if not raw:
        return raw
    collapsed = " ".join(str(raw).split())
    return CATEGORY_ALIASES.get(collapsed.casefold(), collapsed)
