"""L3/L1 fix round 1: ONE fact in two files, pinned against each other.

Which providers' listings are authoritative lives on the backend
(`NoteProvider.enumeration_is_authoritative`: delete detection's small-source floor) and is
restated on the frontend (`authoritativeListing` in NOTE_CONNECTOR_PROVIDERS: the note view's
"removed from" versus "no longer lists" wording). This reads both and fails by name when they
drift. The frontend list is PARSED, never copied here (a copy would be a third authority).
"""

from __future__ import annotations

import importlib
import inspect
import pathlib
import pkgutil
import re

from api.services.journal_two.note_connectors import providers as providers_pkg
from api.services.journal_two.note_connectors.providers.base import NoteProvider

_JS = (pathlib.Path(__file__).resolve().parents[3]
       / "app/src/pages/journal-2-0/hooks/useNoteConnectors.js")
_ROW = re.compile(r"\{\s*key:\s*'([a-z]+)'[^}]*\}")


def _backend() -> set[str]:
    out = set()
    for mod in pkgutil.iter_modules(providers_pkg.__path__):
        m = importlib.import_module(f"{providers_pkg.__name__}.{mod.name}")
        for _n, cls in inspect.getmembers(m, inspect.isclass):
            if issubclass(cls, NoteProvider) and cls.__module__ == m.__name__ \
                    and cls.enumeration_is_authoritative is True:
                out.add(cls.name)
    return out


def _frontend() -> tuple[set[str], set[str]]:
    rows = {m.group(1): m.group(0) for m in _ROW.finditer(_JS.read_text(encoding="utf-8"))}
    return set(rows), {k for k, row in rows.items() if re.search(r"authoritativeListing:\s*true", row)}


def test_the_two_lists_agree():
    keys, authoritative = _frontend()
    assert "obsidian" in keys and "notion" in keys          # non-vacuous parse
    assert _backend() == authoritative == {"obsidian"}
