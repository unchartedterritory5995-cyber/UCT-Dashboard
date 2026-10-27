"""F-ALIAS-1 A1/A2/A3: the private helpers the wave 11 modules read across modules have PUBLIC names, and those
modules read only the public names.

ONE authority: each public name IS its private function (the same object, `name = _name`), never a copy that could
drift. The consumers are scanned (AST, attribute reads) so a private cross-module read cannot come back unnoticed.
"""
from __future__ import annotations

import ast
from pathlib import Path

import pytest

from api.services.journal_two import note_properties
from api.services.journal_two.widget_engine import payload as wpayload
from api.services.journal_two.widget_engine import sources as wsources

REPO = Path(__file__).resolve().parents[1]

#: (module, public name, private name): the public name is the private function itself.
ALIASES = [
    (wsources, "tags", "_tags"),
    (wpayload, "scope_label", "_scope_label"),
    (note_properties, "parse_properties_json", "_parse_properties_json"),
]

#: The wave 11 modules (11.9's and 11.12's) that read these helpers, and the private names none of them may read
#: through another module (an attribute read `mod._name`).
CONSUMERS = [
    "api/services/journal_two/gallery_suggest.py",
    "api/services/journal_two/widget_engine/run.py",
]


def _private_names() -> set[str]:
    return {private for _m, _pub, private in ALIASES}


@pytest.mark.parametrize("module,public,private", ALIASES, ids=lambda x: getattr(x, "__name__", x))
def test_the_public_name_is_the_private_function_itself(module, public, private):
    assert getattr(module, public) is getattr(module, private), f"{module.__name__}.{public} is a copy"


def _attribute_reads(path: str, names: set[str]) -> list[tuple[int, str]]:
    tree = ast.parse((REPO / path).read_text(encoding="utf-8"))
    return sorted((n.lineno, f"{ast.unparse(n.value)}.{n.attr}") for n in ast.walk(tree)
                  if isinstance(n, ast.Attribute) and n.attr in names
                  and not (isinstance(n.value, ast.Name) and n.value.id in ("self", "cls")))


@pytest.mark.parametrize("path", CONSUMERS)
def test_the_consumers_read_only_the_public_names(path):
    found = _attribute_reads(path, _private_names())
    assert not found, f"{path} reads a private helper of another module: {found}"


def test_CONTROL_the_scan_sees_a_private_read():
    """The scan above can fail: the same walk over a line that reads a private name finds it."""
    tree = ast.parse("from x import sources as wsources\nwsources._tags('[]')\n")
    hits = [n for n in ast.walk(tree) if isinstance(n, ast.Attribute) and n.attr in _private_names()]
    assert len(hits) == 1
