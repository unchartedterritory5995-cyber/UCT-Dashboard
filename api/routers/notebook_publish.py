"""Publish-to-web -- a read-only public page for a note or a folder (wave 8, lane 8B).

⛔ A STUB, MOUNTED ON PURPOSE (seam S8-2). It carries the prefix and no routes yet, so
lane 8B adds routes here without touching `api/main.py`, and nothing about the app
changes until it does. The routes 8B builds live under `/api/j2/publish*` (the
member's own doors) and `/api/j2/published*` (the public read,
`PUBLISHED_ENDPOINT` in `app/src/pages/journal-2-0/lib/notePublishLink.js`).

The rules every route here follows, stated before the first one exists:
  * DARK. The gate is `api.services.notebook_flags.flag_on("NOTEBOOK_PUBLISH_ENABLED",
    False)`, read per request, and every route answers 404 while it is off -- never an
    `os.environ.get` of the name (`tests/test_notebook_flag_parse.py` fails on one).
    ⛔ Ruling D-B9: it stays unset until the owner records legal sign-off.
  * Its paths (`/api/j2/publish*`, `/api/j2/published*`) are outside
    `/api/j2/notes/...`, so `journal_two`'s `/api/j2/notes/{note_id}` cannot shadow
    them and mount order does not matter (`tests/test_main_router_order.py`).
"""

from fastapi import APIRouter

router = APIRouter(prefix="/api/j2", tags=["journal-2-0", "notebook-publish"])
