"""A tag's identity, pinned on both sides — review S3.

`notes.tag_key` decides which tree node a tag counts under and which notes the
`tag=` filter returns; the sidebar computes the same key in JavaScript
(`lib/tagTree.js::tagKey`) to match a tag it was handed AS TEXT (a chip, a link)
to the server's nodes. Each side used to have its own table of examples, copied
from the other, with nothing comparing them. Now ONE table,
tests/fixtures_tag_keys.json, and both must reproduce it — including the
whitespace JavaScript's `trim()` and Python's `strip()` disagree on, and case
folding beyond ASCII. The client half is lib/tagKey.parity.test.js.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from api.services.journal_two.notes import tag_key

REPO = Path(__file__).resolve().parent.parent
ROWS = json.loads((REPO / "tests" / "fixtures_tag_keys.json").read_text(encoding="utf-8"))["rows"]


@pytest.mark.parametrize("row", ROWS, ids=[ascii(r["raw"]) for r in ROWS])
def test_the_server_keys_every_row_as_the_table_says(row):
    assert tag_key(row["raw"]) == row["key"]


def test_the_table_covers_the_cases_that_split_the_two_languages():
    raws = {r["raw"] for r in ROWS}
    # Non-vacuity: the rows that make this a parity rail rather than a smoke test.
    for needle in ["\u0085nel", "﻿bom", "Élan", "Q3 / Q4", "İstanbul"]:
        assert needle in raws, ascii(needle)
