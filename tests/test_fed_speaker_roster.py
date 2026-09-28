"""TERM-031 / FB-A5-03 — the Fed-speaker roster is a DATED data file, not a
hand-typed literal, and the match rule does not depend on it being complete.

The defect: `_is_fed_speaker` matched a hand-typed surname tuple in
`api/routers/calendar.py`, so a speaker missing from it was silently dropped
from the curated economic calendar (the Powell-era list missed Chair Warsh,
8/21/26). A drop presents as ABSENCE, so nothing ever reported it.

The authoritative roster (federalreserve.gov) is not a source this app holds,
so the ticket's dated-file option ships: `api/data/fed_speakers.json` carries
its own `as_of` and `valid_through`, and the HORIZON RAIL below goes red when
that coverage runs short — because a correct roster and an expired one look
identical on any single day.
"""
from __future__ import annotations

import ast
import json
import re
from datetime import date
from pathlib import Path

import pytest

from api.routers import calendar as cal

_ROUTER = Path(cal.__file__)


def _write(tmp_path, payload) -> Path:
    p = tmp_path / "fed_speakers.json"
    p.write_text(payload if isinstance(payload, str) else json.dumps(payload),
                 encoding="utf-8")
    return p


# ── (c) the list carries its as-of ─────────────────────────────────────────


def test_the_shipped_roster_loads_and_carries_its_as_of():
    roster = cal.load_fed_roster()
    assert roster["state"] == "ok", roster
    assert isinstance(roster["as_of"], date)
    assert isinstance(roster["valid_through"], date)
    assert roster["as_of"] < roster["valid_through"]
    assert roster["as_of"] <= date.today(), "an as-of in the future is not a record"
    # Non-vacuity: a roster that loads 'ok' with nothing in it would make every
    # surname assertion below pass over an empty set.
    assert "warsh" in roster["surnames"]


# ── (a) the horizon rail ────────────────────────────────────────────────────


def test_HORIZON_RAIL_the_shipped_roster_covers_the_stated_months():
    """The roster, on the day it was verified, carried at least the stated months
    of cover.

    ⛔ PINNED TO THE ROSTER'S OWN `as_of`, NEVER `date.today()`. A rail that reads
    the wall clock goes red on a date with no commit behind it, reddens every
    unrelated branch that day, and gets muted — `api/routers/market_calendar.py`
    rejects that shape by name for the same reason. Expiry in production is
    `_fed_surnames()`'s runtime warning, not this test. When re-verifying: check
    the Board of Governors and the twelve Reserve Bank presidents on
    federalreserve.gov, edit api/data/fed_speakers.json, and move BOTH `as_of`
    and `valid_through`."""
    roster = cal.load_fed_roster()
    cal.assert_fed_roster_horizon(roster, roster["as_of"])


def test_the_horizon_rail_FAILS_on_an_expired_list(tmp_path):
    expired = cal.load_fed_roster(_write(tmp_path, {
        "as_of": "2025-01-02", "valid_through": "2025-07-01",
        "surnames": ["Warsh"]}))
    assert expired["state"] == "ok"      # it READS fine — only the horizon is wrong
    with pytest.raises(AssertionError, match="horizon"):
        cal.assert_fed_roster_horizon(expired, date(2026, 9, 27))
    # Short, but not yet expired, is still a failure: the stated floor is months.
    with pytest.raises(AssertionError, match="horizon"):
        cal.assert_fed_roster_horizon(expired, date(2025, 5, 1))
    # Control — the same check passes a roster with the stated cover left, so a
    # check that always raised could not satisfy this file.
    cal.assert_fed_roster_horizon(expired, date(2025, 1, 2))


@pytest.mark.parametrize("payload", [
    None,                                                     # missing file
    "{not json",                                              # malformed
    {"valid_through": "2027-01-01", "surnames": ["Warsh"]},   # no as_of
    {"as_of": "2026-09-01", "surnames": ["Warsh"]},           # no horizon
    {"as_of": "2026-09-01", "valid_through": "2027-01-01"},   # no surnames
])
def test_an_unresolvable_roster_says_UNREADABLE_not_a_plausible_default(tmp_path, payload):
    path = tmp_path / "absent.json" if payload is None else _write(tmp_path, payload)
    roster = cal.load_fed_roster(path)
    assert roster["state"] == "unreadable"
    assert roster["surnames"] == frozenset()
    with pytest.raises(AssertionError, match="unreadable"):
        cal.assert_fed_roster_horizon(roster, date(2026, 9, 27))


# ── (b) a speaker absent from the list is still surfaced ───────────────────


@pytest.mark.parametrize("title", [
    "Fed Hammack Testimony",
    "Fed Schmid Remarks",
    "FOMC Member Hammack Speaks",
    "Fed Paulson Speaks on the Economic Outlook",
])
def test_a_speaker_ABSENT_from_the_roster_is_still_surfaced(title):
    surnames = cal.load_fed_roster()["surnames"]
    words = set(re.findall(r"[a-z]+", title.lower()))
    # Control: the fixture really is absent, or this would test the roster path.
    assert not (words & surnames), f"fixture surname is on the roster: {words & surnames}"
    assert cal._is_fed_speaker(title) is True


# ── the MATCH RULE, not just the list's presence ───────────────────────────


@pytest.mark.parametrize("title, expected", [
    # A surname inside another word is not a mention of the official.
    ("EIA Crude Oil Barrel Stocks", False),
    # A whole-word surname with no act of speaking is not a Fed speech.
    ("Logan Airport Passenger Traffic", False),
    # Controls — the same surnames, as speaking events, must match.
    ("Barr Speaks", True),
    ("Logan Testifies", True),
    ("Warsh Speaks", True),
    ("Warsh's Speech", True),
])
def test_surnames_match_as_whole_words_in_a_speaking_event(title, expected):
    surnames = cal.load_fed_roster()["surnames"]
    assert {"barr", "logan", "warsh"} <= surnames, "controls need these on the roster"
    assert cal._is_fed_speaker(title) is expected


@pytest.mark.parametrize("title", [
    "Fed Barkin Speech",
    "Fed Cook Speech",
    "Fed Musalem Speech",
    "Fed Chair Warsh Keynote (Jackson Hole)",
    "Fed Chair Keynote (Jackson Hole)",
    "Jackson Hole Symposium",
    "FOMC Member Waller Speaks",
    "Fed Vice Chair for Supervision Bowman Speaks",
])
def test_known_fed_speaker_shapes_still_match(title):
    assert cal._is_fed_speaker(title) is True


@pytest.mark.parametrize("title", [
    "Fed Interest Rate Decision",
    "FOMC Economic Projections",
    "Fed Monetary Policy Report",
    "Nonfarm Payrolls",
    "",
])
def test_fed_releases_that_are_not_speakers_stay_out(title):
    assert cal._is_fed_speaker(title) is False


# ── the roster lives in ONE place ───────────────────────────────────────────


def _string_constants(source: str) -> list[str]:
    """Every str constant in `source` except docstrings. An AST, so comments are
    already gone and prose ABOUT the roster cannot be mistaken for the roster."""
    tree = ast.parse(source)
    docstrings = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            body = getattr(node, "body", [])
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
                docstrings.add(id(body[0].value))
    return [n.value for n in ast.walk(tree)
            if isinstance(n, ast.Constant) and isinstance(n.value, str)
            and id(n) not in docstrings]


def _surname_literals(source: str, surnames: frozenset) -> list[str]:
    return [s for s in _string_constants(source)
            if set(re.findall(r"[a-z]+", s.lower())) & surnames]


def test_no_roster_surname_is_typed_as_a_literal_in_the_router():
    surnames = cal.load_fed_roster()["surnames"]
    # Control: the scan SEES a typed roster when one is there, and ignores the
    # same name in a comment or a docstring.
    planted = ('"""Mentions Warsh in prose."""\n'
               '# warsh in a comment\n'
               '_FED_TERMS = ("fed chair", "warsh")\n')
    assert _surname_literals(planted, surnames) == ["warsh"]
    found = _surname_literals(_ROUTER.read_text(encoding="utf-8"), surnames)
    assert found == [], f"hand-typed Fed surnames in {_ROUTER.name}: {found}"
