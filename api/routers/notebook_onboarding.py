"""Notebook onboarding -- the sample notebook's routes (wave 8, lane 8C).

⛔ A STUB, MOUNTED ON PURPOSE (seam S8-2). It carries the prefix `/api/j2/onboarding`
and no routes yet, so lane 8C adds routes here without touching `api/main.py`, and
nothing about the app changes until it does.

The rules every route here follows, stated before the first one exists:
  * DARK. The gate is `api.services.notebook_flags.flag_on(
    "NOTEBOOK_ONBOARDING_ENABLED", False)`, read per request, and every route answers
    404 while it is off -- never an `os.environ.get` of the name
    (`tests/test_notebook_flag_parse.py` fails on one).
  * The sample is seeded only on an explicit click, refused with 409 for a member who
    has ANY note, through `notes.import_confirm` (ruling D-C6).
  * Its prefix is outside `/api/j2/notes/...`, so mount order against `journal_two`
    does not matter (`tests/test_main_router_order.py`).
"""

from fastapi import APIRouter

router = APIRouter(prefix="/api/j2/onboarding", tags=["journal-2-0", "notebook-onboarding"])
