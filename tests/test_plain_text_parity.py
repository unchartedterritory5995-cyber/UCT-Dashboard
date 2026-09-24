"""body_plain parity — the server's `extract_plain_text` and the client's
`extractPlainText` read ONE table of documents and expected text.

body_plain is the notebook's search index and the text History diffs, and both
serializers write it (the server on every save, the client for the importer and
the editor's own previews). Both are ProseMirror's own
`textBetween(0, size, ' ', leafText)`: text runs inside one textblock join with
NOTHING, blocks and block atoms are separated by one space. ⚰️ Until
2026-09-23 both joined EVERY text node with a space, so "**NV**DA" was indexed
as "NV DA" and a search for NVDA missed the note.

The rule is not restated here: which types are leaves / inline / textblocks is
the citation text's (note_citation_text, pinned to the real schema), and the
leaf table is the citation table plus one extra. The client half is
app/src/pages/journal-2-0/lib/plainText.parity.test.js; it reads the same
fixture, THIS side's source, and additionally runs the REAL textBetween.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from api.services.journal_two import note_citation_text as citation
from api.services.journal_two import notes
from api.services.journal_two.notes import extract_plain_text

REPO = Path(__file__).resolve().parent.parent
FIXTURE = json.loads((REPO / "tests" / "fixtures_plain_text.json").read_text(encoding="utf-8"))
CASES = FIXTURE["cases"]
CLIENT_SRC = (REPO / "app" / "src" / "pages" / "journal-2-0" / "lib" / "tiptap.js").read_text(encoding="utf-8")


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_the_server_reads_every_fixture_as_the_table_says(case):
    assert extract_plain_text(case["doc"]) == case["expected"]


def _client_plain_leaf_extras() -> set[str]:
    start = CLIENT_SRC.index("export function plainLeafText(")
    body = CLIENT_SRC[start:CLIENT_SRC.index("\n}", start)]
    return set(re.findall(r"node\?\.type\?\.name === '(\w+)'", body))


def test_the_leaf_table_is_the_citation_table_plus_the_same_one_extra_on_both_sides():
    server_extras = set(notes._PLAIN_LEAF_TEXT) - set(citation._ATOM_TEXT)
    client_extras = _client_plain_leaf_extras()
    # Non-vacuity: the probe sees the extra it is looking for.
    assert "videoTimestamp" in client_extras
    assert server_extras == client_extras, (
        f"only the server reads {sorted(server_extras - client_extras)}; "
        f"only the client reads {sorted(client_extras - server_extras)}")


def test_the_shared_leaves_are_DERIVED_from_the_citation_table_not_restated():
    # A restated copy would drift the day one side changes; identity proves
    # there is one table.
    shared = set(citation._ATOM_TEXT)
    assert shared and shared <= set(notes._PLAIN_LEAF_TEXT)
    for name in shared:
        assert notes._PLAIN_LEAF_TEXT[name] is citation._ATOM_TEXT[name], name
    start = CLIENT_SRC.index("export function plainLeafText(")
    assert "return citationLeafText(node)" in CLIENT_SRC[start:CLIENT_SRC.index("\n}", start)]


def _fixture_node_types() -> set[str]:
    seen: set[str] = set()

    def walk(node):
        if isinstance(node, dict):
            if isinstance(node.get("type"), str):
                seen.add(node["type"])
            for child in node.get("content") or []:
                walk(child)
    for c in CASES:
        walk(c["doc"])
    return seen


def test_every_leaf_that_reads_as_text_has_a_fixture():
    missing = set(notes._PLAIN_LEAF_TEXT) - _fixture_node_types()
    assert not missing, f"no fixture exercises {sorted(missing)}"


def test_the_fixture_pins_the_mark_boundary_it_exists_for():
    # A paragraph with adjacent text runs whose expected text holds them
    # joined with NOTHING -- the case every text node joined by a space broke.
    pinned = []
    for c in CASES:
        def walk(node):
            if not isinstance(node, dict):
                return
            kids = node.get("content") or []
            runs = [k.get("text", "") for k in kids if isinstance(k, dict) and k.get("type") == "text"]
            if len(runs) >= 2 and len(runs) == len(kids) and "".join(runs) in c["expected"]:
                pinned.append(c["name"])
            for k in kids:
                walk(k)
        walk(c["doc"])
    assert any("NVDA" in c["expected"] and c["name"] in pinned for c in CASES), pinned
