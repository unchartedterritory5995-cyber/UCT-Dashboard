"""The Python half of the closed table.

⭐ THIS MODULE OWNS NO VOCABULARY. It reads ``closedTable.json`` — the same bytes
the browser imports through ``app/src/components/chart/engine/ast/parse.js`` — and
hands it to ``ast_interpret``, which binds an implementation to each declared
name. The totality rail then asserts the binding is exhaustive in BOTH
directions, so a name added to the manifest lands RED here until somebody writes
it.

⛔ ONE DECLARATION, TWO READERS. A hand-copied table in this module would be a
second grammar, and the two would drift the first time somebody added a function
to one — silently, because every existing test would stay green. This repo has
already paid for two vocabularies that looked like one: ``williams_r`` here is
``williamsR`` in the chart registry, which is the only reason
``indicator_compute._CASE_COLUMNS`` exists at all.

⛔ AND "IT READS THE FILE" IS PROVED STRUCTURALLY, NOT PROMISED. A hand-copy that
happened to be byte-correct on the day it was written would satisfy any equality
against today's manifest. So ``test_ast_interpret.py`` walks THIS MODULE'S OWN
SOURCE with ``ast`` and asserts that no declared table name appears in it as a
string constant — a copy necessarily spells the names, and a reader necessarily
does not. That is why nothing below quotes ``close``, ``sma`` or an operator:
those literals are forbidden here by a test, deliberately.

⚠️ NO PARSER LIVES HERE, EVER (decision D-A1). The AST is the persisted artifact;
this lane walks a tree it did not build. A parser here would be a second grammar
and the drift would be silent.
"""
from __future__ import annotations

import io
import json
import pathlib
from types import MappingProxyType
from typing import Any, Mapping, Optional

#: The manifest, resolved from THIS FILE rather than from a working directory.
#:
#: ⚠️ THE `goldenFixtures.test.js` SHAPE: resolve from the module, then assert the
#: file EXISTS with a message that names it. A path resolved from `os.getcwd()`
#: silently finds nothing when the suite is driven from a different directory,
#: and a lane that silently found no manifest would report a passing totality
#: rail over an empty table.
MANIFEST_PATH: pathlib.Path = (
    pathlib.Path(__file__).resolve().parents[2]
    / "app" / "src" / "components" / "chart" / "engine" / "ast" / "closedTable.json"
)

#: The section keys of the manifest. STRUCTURE, not vocabulary — these name the
#: three dictionaries, never an entry inside one.
SERIES_SECTION = "series"
OPERATORS_SECTION = "operators"
FUNCTIONS_SECTION = "functions"
SECTIONS = (SERIES_SECTION, OPERATORS_SECTION, FUNCTIONS_SECTION)


def _freeze(value: Any) -> Any:
    """Deep-freeze a decoded manifest so no caller can edit the shared table.

    A mutable module-level table is a second grammar waiting to happen: one
    caller's ``TABLE[...][...] = ...`` would change what every formula in the
    process means, and nothing would be red.
    """
    if isinstance(value, dict):
        return MappingProxyType({k: _freeze(v) for k, v in value.items()})
    if isinstance(value, list):
        return tuple(_freeze(v) for v in value)
    return value


def load_manifest(path: Optional[pathlib.Path] = None) -> Mapping[str, Any]:
    """Read the closed table off disk and freeze it.

    ``io.open(..., encoding='utf-8')`` ALWAYS — a bare ``open()`` decodes as
    cp1252 on this box, and that has already killed a sibling harness mid-run.
    """
    p = pathlib.Path(path) if path is not None else MANIFEST_PATH
    if not p.exists():
        raise FileNotFoundError(
            f"the closed table is missing at {p}. It is committed under app/, and "
            "this lane READS it rather than owning a copy."
        )
    with io.open(p, encoding="utf-8") as fh:
        doc = json.load(fh)
    for section in SECTIONS:
        if section not in doc or not isinstance(doc[section], dict):
            raise ValueError(
                f"{p} has no {section!r} object. The manifest's three sections are "
                f"{SECTIONS}; a lane that tolerated a missing one would resolve "
                "names against an empty dictionary and refuse everything."
            )
    return _freeze(doc)


#: The frozen manifest. Read once, at import, from the SAME file the browser
#: imports.
TABLE: Mapping[str, Any] = load_manifest()


def declared_names(manifest: Optional[Mapping[str, Any]] = None) -> set:
    """Every name the table declares, across all three sections.

    ⛔ DERIVED FROM THE MANIFEST, NEVER HAND-LISTED. DPC's four constants rode
    unpinned for the rule's entire life because their rail was a LIST of what
    somebody remembered; a floor read out of its own subject cannot rot that way.
    """
    m = manifest if manifest is not None else TABLE
    out: set = set()
    for section in SECTIONS:
        out |= set(m[section])
    return out


def series_field(name: str, manifest: Optional[Mapping[str, Any]] = None) -> str:
    """The bar key a declared series reads. Raises ``KeyError`` for anything else."""
    m = manifest if manifest is not None else TABLE
    return m[SERIES_SECTION][name]["field"]
