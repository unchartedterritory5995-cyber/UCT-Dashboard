"""Notebook widgets wave 11 (Task 11.12, carry 8; fix round 1 m-10): the library facts on My tools' rows.

Each of the member's library copies in a My tools list (routines, trackers, widgets) carries
`template_gallery.library_facts` (`sourceGalleryId`, `credit`, `updateAvailable`), so "Update from the library" can be
offered. A row that is not a library copy, and every row while the library or wave 11 is off (`library_facts`
answers `{}`), is exactly as before. ONE `library_facts` call for the whole list, so the statements stay constant
however many rows there are. The routines and widget-definitions routers both call this; neither keeps a copy.
"""
from __future__ import annotations

from typing import Any


def with_library_facts(user_id: str, kind: str, rows: Any) -> Any:
    """`rows` with each library copy's facts merged in (`kind`: widget, routine or tracker)."""
    if not isinstance(rows, list) or not rows:
        return rows
    from api.services.journal_two import template_gallery
    facts = template_gallery.library_facts(user_id, kind, [r.get("id") for r in rows if isinstance(r, dict)])
    if not facts:
        return rows
    return [{**r, **facts[r["id"]]} if isinstance(r, dict) and r.get("id") in facts else r for r in rows]
