"""Journal styles (Notebook P1, spec §P1).

A journal style is a full setup for a kind of note: an outline, the blocks switched on (with their
settings) and the property values a new note starts with. This module is the ONE authority over
styles: the store, versions, defaults, the composer that turns a style into a note body, and the
"update layout" planner. The router is api/routers/notebook_journal_styles.py.

⛔ Dark behind NOTEBOOK_JOURNAL_STYLES_ENABLED, read PER CALL through the one Notebook flag parse.
⛔ The switch gates CREATING, never RENDERING (docs/notebook/p1-verify-before-building.md §c).
"""
from __future__ import annotations

from api.services.notebook_flags import flag_on

FLAG = "NOTEBOOK_JOURNAL_STYLES_ENABLED"


def enabled() -> bool:
    """The gate, read per call (default OFF)."""
    return flag_on(FLAG, False)
