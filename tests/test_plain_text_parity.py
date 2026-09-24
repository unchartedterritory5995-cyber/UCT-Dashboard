"""body_plain parity — the server's `extract_plain_text` and the client's
`extractPlainText` read ONE table of documents and expected text.

body_plain is the notebook's search index and the text History diffs, and both
serializers write it (the server on every save, the client for the importer and
the editor's own previews). A node one side reads and the other does not is a
search that finds a note on one path and not the other — which is exactly what
the Wave 5 math nodes were until this rail: the server ignored `inlineMath` /
`blockMath`, so a formula could not be searched and a LaTeX-only edit showed no
History diff.

The client half is app/src/pages/journal-2-0/lib/plainText.parity.test.js; it
reads the same fixture and THIS side's source.
"""
from __future__ import annotations

import ast
import json
import re
from pathlib import Path

import pytest

from api.services.journal_two.notes import extract_plain_text

REPO = Path(__file__).resolve().parent.parent
FIXTURE = json.loads((REPO / "tests" / "fixtures_plain_text.json").read_text(encoding="utf-8"))
CASES = FIXTURE["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_the_server_reads_every_fixture_as_the_table_says(case):
    assert extract_plain_text(case["doc"]) == case["expected"]


def _server_node_types() -> set[str]:
    src = (REPO / "api" / "services" / "journal_two" / "notes.py").read_text(encoding="utf-8")
    fn = next(n for n in ast.walk(ast.parse(src))
              if isinstance(n, ast.FunctionDef) and n.name == "extract_plain_text")
    body = ast.get_source_segment(src, fn) or ""
    found = set(re.findall(r'ntype == "(\w+)"', body))
    for group in re.findall(r"ntype in \(([^)]*)\)", body):
        found |= set(re.findall(r'"(\w+)"', group))
    return found


def _client_node_types() -> set[str]:
    src = (REPO / "app" / "src" / "pages" / "journal-2-0" / "lib" / "tiptap.js").read_text(encoding="utf-8")
    start = src.index("export function extractPlainText(")
    body = src[start:src.index("\n}", start)]   # up to the function's closing brace
    return set(re.findall(r"node\.type === '(\w+)'", body))


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


def test_both_serializers_read_the_same_node_types():
    server, client = _server_node_types(), _client_node_types()
    # Non-vacuity: the probes can see what they are looking for.
    assert {"text", "widgetEmbed", "inlineMath", "blockMath"} <= server
    assert {"text", "widgetEmbed", "inlineMath", "blockMath"} <= client
    assert server == client, (
        f"only the server reads {sorted(server - client)}; only the client reads {sorted(client - server)}")


def test_every_node_type_either_side_reads_has_a_fixture():
    missing = (_server_node_types() | _client_node_types()) - _fixture_node_types()
    assert not missing, f"no fixture exercises {sorted(missing)}"
