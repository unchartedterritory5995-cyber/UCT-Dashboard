"""Tier 2 part B (F19d): the earnings follow-up card's ticker rule is the SERVER's rule.

ONE FACT IN TWO FILES: api/services/journal_two/notes.py `_validate_ticker` (strip, upper-case, refuse empty,
over `MAX_TICKER_LENGTH`, or outside `^[A-Z0-9.\\-]+$`) <-> app/src/pages/journal-2-0/lib/followupCreate.js
(`MAX_TICKER_LENGTH`, `TICKER_SHAPE`, and `serverTicker`'s normalisation). The client keeps its own copy so the card
can refuse a bad link without a round trip; this rail pins the copy to the server by reading the client file as text,
extracting both values, re-implementing the client rule from them, and running one corpus through both.
(planCreate.js's letters-only pattern is a different, narrower door and is deliberately not covered here.)
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from api.services.journal_two import notes

CLIENT = Path(__file__).resolve().parent.parent / "app/src/pages/journal-2-0/lib/followupCreate.js"

# Needles are assembled from pieces so this file's own source never contains the whole token it looks for.
LEN_NAME = "MAX_TICKER" + "_LENGTH"
SHAPE_NAME = "TICKER" + "_SHAPE"


def _strip_js_comments(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"(?m)(^|[ \t])//.*$", "", src)


def _extract(src: str) -> tuple[int | None, str | None, str | None]:
    code = _strip_js_comments(src)
    m_len = re.search(r"\bconst\s+" + LEN_NAME + r"\s*=\s*(\d+)\b", code)
    m_shape = re.search(r"\bconst\s+" + SHAPE_NAME + r"\s*=\s*/(.+)/([a-z]*)[ \t]*$", code, flags=re.M)
    length = int(m_len.group(1)) if m_len else None
    return length, (m_shape.group(1) if m_shape else None), (m_shape.group(2) if m_shape else None)


@pytest.fixture(scope="module")
def client_rule():
    src = CLIENT.read_text(encoding="utf-8")
    length, pattern, flags = _extract(src)
    # NON-VACUITY: both values must have been found, and the normalisation the rule depends on must still be there.
    assert length is not None, "followupCreate.js: the length constant was not found"
    assert pattern, "followupCreate.js: the ticker pattern literal was not found"
    assert flags == "", f"the pattern carries flags {flags!r}; this rail models none"
    code = _strip_js_comments(src)
    assert ".trim().toUpperCase()" in code, "followupCreate.js no longer trims then upper-cases the ticker"
    assert "> " + LEN_NAME in code, "followupCreate.js no longer refuses an over-long ticker by the constant"
    shape = re.compile(pattern)

    def client_ticker(raw):
        """followupCreate.js `serverTicker`, from the extracted literals: the ticker, or None when it is refused."""
        if not isinstance(raw, str):
            return None
        t = raw.strip().upper()
        if not t or len(t) > length or not shape.fullmatch(t):
            return None
        return t

    return length, pattern, client_ticker


def _server_ticker(raw):
    """notes._validate_ticker as the client sees it: the stored ticker, or None for 'empty' and for 'refused'."""
    try:
        return notes._validate_ticker(raw)
    except notes.NoteValidationError:
        return None


def test_the_extraction_found_the_servers_length(client_rule):
    # The pattern's spelling is NOT pinned: an equivalent rewrite is not a regression, and the corpus below is the check.
    length, _, _ = client_rule
    assert length == notes.MAX_TICKER_LENGTH


CORPUS = [
    "3M", "BRK.B", "BF-B", "A" * 16, "A" * 17, "A_B", "ÉCL", "<b>", "", "  orcl  ",
    "ORCL", "orcl", "   ", "A B", "ORCL$", "9", "-", ".", "a" * 16, "a" * 17,
]


@pytest.mark.parametrize("raw", CORPUS, ids=lambda s: repr(s))
def test_client_and_server_agree_on_the_ticker(client_rule, raw):
    _, _, client_ticker = client_rule
    assert client_ticker(raw) == _server_ticker(raw), raw


def test_the_corpus_is_not_vacuous(client_rule):
    """It must contain tickers both sides accept AND tickers both refuse, or agreement proves nothing."""
    _, _, client_ticker = client_rule
    accepted = [r for r in CORPUS if client_ticker(r) is not None]
    refused = [r for r in CORPUS if client_ticker(r) is None]
    assert {"3M", "BRK.B", "BF-B", "A" * 16, "  orcl  "} <= set(accepted)
    assert {"A" * 17, "A_B", "ÉCL", "<b>", ""} <= set(refused)
