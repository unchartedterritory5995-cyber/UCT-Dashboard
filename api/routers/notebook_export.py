"""Notebook export formats -- HTML, JSON and Word beside the Markdown zip (wave 8, lane 8C).

⛔ A STUB, MOUNTED ON PURPOSE (seam S8-2). It carries the prefix `/api/j2/export` and
no routes yet, so lane 8C adds routes here without touching `api/main.py`, and nothing
about the app changes until it does.

The rules every route here follows, stated before the first one exists:
  * The existing Markdown export routes in `api/routers/journal_two.py` stay
    byte-identical; the new formats live HERE, on the existing export slot, never as a
    second Markdown writer (`notes_export.tiptap_to_markdown` is the one writer).
  * No gate (ruling D-C5): the formats are additive reads of the member's own data.
  * Its prefix is outside `/api/j2/notes/...`, so mount order against `journal_two`
    does not matter (`tests/test_main_router_order.py`).
"""

from fastapi import APIRouter

router = APIRouter(prefix="/api/j2/export", tags=["journal-2-0", "notebook-export"])
