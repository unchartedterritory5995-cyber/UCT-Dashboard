"""TEST-ONLY stand-ins for Notebook P1 Task 4 (`note_kinds`) and Task 5 (`builtin:note_kind`).

Lane A2 (journal styles: Tasks 6, 7, 10) is built in parallel with lane A1 (Tasks 4, 5), so
neither `api/services/journal_two/note_kinds.py` nor the `builtin:note_kind` property exists in
this worktree. The journal-styles tests call `install(monkeypatch)` from an autouse fixture.

⛔ Each half is a NO-OP once the real piece exists: the module stub only installs when
`note_kinds` cannot be imported, and the property stub only installs when `note_properties` does
not already define `builtin:note_kind`. So after the integration merge these tests run against
the REAL modules, and this file can be deleted (it is a second copy of Task 4's constants, which
is acceptable only while the first copy is absent).

The interface mirrored here is the one task-4-brief.md names: NOTE_KIND_PROPERTY,
BUILTIN_NOTE_KINDS ({id, name, icon}), BUILTIN_KIND_IDS, MEMBER_KIND_PREFIX,
get_kind(user_id, kind_id, conn=None) and kind_options(user_id, conn). Member kinds are not
stubbed: get_kind answers only the built-ins.
"""
from __future__ import annotations

import importlib
import sys
import types

_MODULE = "api.services.journal_two.note_kinds"

_BUILTIN_NOTE_KINDS = (
    {"id": "trade_plan", "name": "Trade plan", "icon": "chart"},
    {"id": "daily_prep", "name": "Daily prep", "icon": "sun"},
    {"id": "weekend_prep", "name": "Weekend prep", "icon": "calendar"},
    {"id": "earnings", "name": "Earnings", "icon": "earnings"},
    {"id": "post_trade_review", "name": "Post-trade review", "icon": "check"},
    {"id": "weekly_review", "name": "Weekly review", "icon": "refresh"},
    {"id": "thesis", "name": "Thesis", "icon": "book"},
    {"id": "watchlist_note", "name": "Watchlist note", "icon": "eye"},
)


def _stub_module() -> types.ModuleType:
    mod = types.ModuleType(_MODULE)
    mod.__doc__ = "TEST STUB of note_kinds (tests/_journal_styles_kind_stub.py)."
    mod.NOTE_KIND_PROPERTY = "builtin:note_kind"
    mod.MEMBER_KIND_PREFIX = "k_"
    mod.BUILTIN_NOTE_KINDS = _BUILTIN_NOTE_KINDS
    mod.BUILTIN_KIND_IDS = frozenset(k["id"] for k in _BUILTIN_NOTE_KINDS)
    by_id = {k["id"]: (i, k) for i, k in enumerate(_BUILTIN_NOTE_KINDS)}

    def get_kind(user_id, kind_id, conn=None):
        if not isinstance(kind_id, str) or kind_id not in by_id:
            return None
        i, k = by_id[kind_id]
        return {"id": k["id"], "name": k["name"], "icon": k["icon"], "builtin": True, "sortOrder": i}

    def kind_options(user_id, conn=None):
        return [{"id": k["id"], "label": k["name"], "color": "gray"} for k in _BUILTIN_NOTE_KINDS]

    mod.get_kind = get_kind
    mod.kind_options = kind_options
    return mod


def install(monkeypatch) -> dict:
    """Install whichever stand-ins are needed. Returns which ones were installed."""
    installed = {"note_kinds": False, "note_kind_property": False}
    try:
        importlib.import_module(_MODULE)
    except ModuleNotFoundError as e:
        if e.name != _MODULE:
            raise
        mod = _stub_module()
        monkeypatch.setitem(sys.modules, _MODULE, mod)
        import api.services.journal_two as pkg
        monkeypatch.setattr(pkg, "note_kinds", mod, raising=False)
        installed["note_kinds"] = True

    from api.services.journal_two import note_properties as np
    if "builtin:note_kind" not in np._BUILTIN_BY_ID:
        d = {"id": "builtin:note_kind", "name": "Kind of note", "type": "select", "source": "user_set",
             "options": [{"id": k["id"], "label": k["name"], "color": "gray"} for k in _BUILTIN_NOTE_KINDS]}
        monkeypatch.setattr(np, "_BUILTIN_BY_ID", {**np._BUILTIN_BY_ID, d["id"]: d})
        monkeypatch.setattr(np, "BUILTIN_USER_SET_IDS", np.BUILTIN_USER_SET_IDS | {d["id"]})
        installed["note_kind_property"] = True
    return installed
