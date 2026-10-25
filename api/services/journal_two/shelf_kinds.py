"""Notebook widgets wave 10 (Task 10.12): the seven ready-made "dedicated" widgets, as one registry.

The builders live in two modules, `shelf_discipline` (Task 10.10: tilt check, revenge-clean, risk left today,
prop-firm rules) and `shelf_compose` (Task 10.11: plan vs actual, game plan, alerts that fired). This module is
the one place that knows all seven, and the one place the route (`api/routers/notebook_shelf_widgets.py`) and,
from Task 10.14, `notebook_widgets` read them from:

  * `KINDS`, in menu order; `WAVE`, the release wave that gates them (`notebook_widgets_wave_on(WAVE)`);
  * `BUILDERS`, `PARAMS`, `TITLES`: MERGED from the two modules, never restated. A kind declared by both modules
    raises `DuplicateKind` while this module imports, so a collision can never overwrite a builder silently;
    and the merged set must be exactly `KINDS`, or the import fails the same way;
  * `SOURCE_DETAIL`: the one sentence naming where each widget's data comes from;
  * `ParamError`: THE refusal class of every dedicated widget (ruling W9-R14: it carries `status` and `code`;
    the router answers `{"detail": {"code", "message"}}` with `e.status` and never matches sentences). Both
    builder modules import it from here; there is no other definition;
  * `clean_params(kind, raw)`: the owning module's own cleaner for that kind.

⚠️ IMPORT ORDER. The builder modules need `ParamError` and this module needs their tables, so each side imports
the other at the END of its file (and `shelf_compose` imports `shelf_discipline` there too). Any of the three can
be imported first; `tests/test_shelf_widgets_router.py::test_every_import_order_loads` runs all three orders in a
fresh interpreter. Do not move those imports to the top.
"""
from __future__ import annotations

from typing import Any, Callable

from api.services.journal_two import tool_errors

__all__ = ["KINDS", "WAVE", "BUILDERS", "PARAMS", "TITLES", "SOURCE_DETAIL", "ParamError", "DuplicateKind",
           "clean_params", "merge"]

#: The release wave whose flag (`NOTEBOOK_WIDGETS_W10_ENABLED`) gates every dedicated kind.
WAVE = 10

KINDS = ("myTiltCheck", "myRevengeClean", "myPlanVsActual", "myRiskLeftToday", "myPropFirm", "myGamePlan",
         "myAlertsFired")

_TRADES = "Your closed trades in the Journal."
_MONEY = "Your accounts, trades and open positions in the Journal."
SOURCE_DETAIL: dict[str, str] = {
    "myTiltCheck": _TRADES,
    "myRevengeClean": _TRADES,
    "myPlanVsActual": _TRADES,
    "myRiskLeftToday": _MONEY,
    "myPropFirm": _MONEY,
    "myGamePlan": "The morning wire, the earnings calendar and your open positions.",
    "myAlertsFired": "Your alert history.",
}


class ParamError(tool_errors.ToolError):
    """A refused widget setting. Its message is a member sentence (`.sentence`); the router answers
    `{"detail": {"code": e.code, "message": e.sentence}}` with `e.status` and never matches the words (W9-R14)."""
    status = 400
    code = "invalid"


class DuplicateKind(RuntimeError):
    """Two builder modules declare the same kind (or the merged set is not `KINDS`). Raised at import."""


def merge(name: str, *tables: dict) -> dict:
    """The union of `tables`, refusing a key that appears in more than one (named, with the table)."""
    out: dict = {}
    for table in tables:
        for key, value in table.items():
            if key in out:
                raise DuplicateKind(f"{name}: kind {key!r} is declared by two builder modules")
            out[key] = value
    return out


def clean_params(kind: str, raw: Any) -> dict:
    """The params a widget of `kind` keeps, checked by the module that builds it. An unknown kind is a
    `ParamError` (the route answers an unknown kind with its 404 before this is reached)."""
    cleaner = _CLEANERS.get(kind)
    if cleaner is None:
        from api.services.journal_two import widget_definitions
        raise ParamError(widget_definitions.S_NOT_FOUND)
    return cleaner(kind, raw)


# -- the merged tables (see IMPORT ORDER above: these imports stay at the bottom) -------------------------------

from api.services.journal_two import shelf_compose as _compose        # noqa: E402
from api.services.journal_two import shelf_discipline as _discipline  # noqa: E402

BUILDERS: dict[str, Callable[[str, dict, Any], dict]] = merge("BUILDERS", _discipline.BUILDERS, _compose.BUILDERS)
PARAMS: dict[str, tuple] = merge("PARAMS", _discipline.PARAMS, _compose.PARAMS)
TITLES: dict[str, str] = merge("TITLES", _discipline.TITLES, _compose.TITLES)
_CLEANERS: dict[str, Callable[[str, Any], dict]] = merge(
    "clean_params", {k: _discipline.clean_params for k in _discipline.PARAMS},
    {k: _compose.clean_params for k in _compose.PARAMS})

for _name, _table in (("BUILDERS", BUILDERS), ("PARAMS", PARAMS), ("TITLES", TITLES),
                      ("SOURCE_DETAIL", SOURCE_DETAIL)):
    if set(_table) != set(KINDS):
        raise DuplicateKind(f"{_name} holds {sorted(_table)}, not the dedicated kinds {sorted(KINDS)}")
del _name, _table
