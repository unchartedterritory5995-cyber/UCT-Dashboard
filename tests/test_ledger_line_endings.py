"""The flag ledger's line-ending invariant (`tests/support/ledger_line_endings.py`), shown able to fail.

The three ledger rails that read `docs/feature_flags.json` used to assert "the file is CRLF", a fact
about this box's autocrlf checkout: the blob is LF, so every Linux checkout (the remote lane, CI) was red.
They now assert the invariant both checkouts share. These cases prove it says yes to both honest
checkouts and no to each way the file can actually be damaged.
"""
from __future__ import annotations

import pytest

from tests.support.ledger_line_endings import LEDGER, index_eol, line_ending_problems

LF_FILE = b'{\n  "flags": {\n    "A_ENABLED": {"status": "dark"}\n  }\n}\n'
CRLF_FILE = LF_FILE.replace(b"\n", b"\r\n")


@pytest.mark.parametrize("raw", [LF_FILE, CRLF_FILE], ids=["linux-checkout-lf", "windows-autocrlf-crlf"])
def test_both_honest_checkouts_of_an_lf_blob_hold(raw):
    assert line_ending_problems(raw, "i/lf") == []


def test_mixed_endings_are_refused_on_either_base():
    # a CRLF checkout with one row written LF, and an LF checkout with one row written CRLF
    crlf_with_lf_row = CRLF_FILE.replace(b'"dark"}\r\n', b'"dark"}\n', 1)
    lf_with_crlf_row = LF_FILE.replace(b'"dark"}\n', b'"dark"}\r\n', 1)
    for raw in (crlf_with_lf_row, lf_with_crlf_row):
        problems = line_ending_problems(raw, "i/lf")
        assert len(problems) == 1 and problems[0].startswith("mixed line endings"), problems


def test_a_lone_cr_is_refused():
    problems = line_ending_problems(LF_FILE.replace(b"{\n", b"{\r", 1), "i/lf")
    assert any("lone CR" in p for p in problems), problems


@pytest.mark.parametrize("eol", ["i/crlf", "i/mixed"])
def test_a_blob_that_would_store_cr_is_refused_whatever_the_disk_says(eol):
    for raw in (LF_FILE, CRLF_FILE):
        problems = line_ending_problems(raw, eol)
        assert problems == [f"the index blob is {eol!r}, not 'i/lf': a commit would store CR line endings"], problems


def test_the_real_ledger_holds_and_git_answered():
    eol = index_eol(LEDGER)
    assert eol.startswith("i/"), f"non-vacuity: git ls-files --eol answered {eol!r}"
    assert line_ending_problems(LEDGER.read_bytes(), eol) == []
