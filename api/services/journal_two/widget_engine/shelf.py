"""The ready-made widget examples (wave 8, Task 8.10): `shelf.json`, validated at import.

Each example is an ordinary widget plan (the starter-scan precedent: editable on arrival), with a
name, a one-line description and the trader synonyms the `/` search matches (spec section 8).
Ids are namespaced `shelf:<slug>`. Served server-side only (`GET /api/j2/widget-definitions/shelf`,
Task 8.11): the file is never part of the client bundle.

⛔ Every plan passes `plan.validate_plan` against `sources.CATALOG` WHEN THIS MODULE IS IMPORTED.
A broken example fails the import (and so the app's boot and every test that touches the engine),
never a member's card. Wave 10 turns this file into immutable revision files with a hash rail.

`examples()` and `example(id)` hand out deep copies of the VALIDATED plan (defaults filled), so a
caller can never edit the shelf in place.
"""
from __future__ import annotations

import copy
import json
import re
from pathlib import Path
from typing import Any

from api.services.journal_two.widget_engine import plan as wplan
from api.services.journal_two.widget_engine import sources as wsources

SHELF_PATH = Path(__file__).with_name("shelf.json")
SHELF_VERSION = 1
ID_PREFIX = "shelf:"
_ID_RE = re.compile(r"shelf:[a-z0-9]+(?:-[a-z0-9]+)*")
_KEYS = {"id", "name", "description", "keywords", "plan"}


class ShelfError(RuntimeError):
    """The shelf file is malformed or one of its plans does not validate."""


def load(path: Path = SHELF_PATH) -> list[dict]:
    """Read and validate a shelf file; raise `ShelfError` naming the first broken example."""
    try:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise ShelfError(f"the shelf file could not be read: {e}") from e
    if not isinstance(raw, dict) or raw.get("version") != SHELF_VERSION:
        raise ShelfError(f"the shelf file must be version {SHELF_VERSION}")
    items = raw.get("examples")
    if not isinstance(items, list) or not items:
        raise ShelfError("the shelf file has no examples")
    out: list[dict] = []
    seen: set[str] = set()
    for i, e in enumerate(items):
        where = f"example #{i + 1}"
        if not isinstance(e, dict) or set(e) != _KEYS:
            raise ShelfError(f"{where}: keys must be exactly {sorted(_KEYS)}")
        sid = e["id"]
        if not isinstance(sid, str) or not _ID_RE.fullmatch(sid):
            raise ShelfError(f"{where}: id {sid!r} is not 'shelf:<slug>'")
        if sid in seen:
            raise ShelfError(f"{sid}: duplicate id")
        seen.add(sid)
        for k in ("name", "description"):
            if not isinstance(e[k], str) or not e[k].strip() or len(e[k]) > wplan.MAX_TEXT:
                raise ShelfError(f"{sid}: {k} must be 1 to {wplan.MAX_TEXT} characters")
        kws = e["keywords"]
        if not isinstance(kws, list) or not all(isinstance(k, str) and k.strip() for k in kws):
            raise ShelfError(f"{sid}: keywords must be a list of words")
        try:
            validated = wplan.validate_plan(copy.deepcopy(e["plan"]), wsources.CATALOG)
        except wplan.PlanError as err:
            raise ShelfError(f"{sid}: {err.sentence}") from err
        out.append({"id": sid, "name": e["name"], "description": e["description"],
                    "keywords": list(kws), "plan": validated})
    return out


_EXAMPLES: list[dict] = load()
_BY_ID: dict[str, dict] = {e["id"]: e for e in _EXAMPLES}


def examples() -> list[dict]:
    """Every example, in shelf order: `{id, name, description, keywords, plan}`."""
    return copy.deepcopy(_EXAMPLES)


def example(shelf_id: Any) -> dict | None:
    """One example by its `shelf:` id, or None."""
    if not isinstance(shelf_id, str):
        return None
    e = _BY_ID.get(shelf_id)
    return copy.deepcopy(e) if e is not None else None
