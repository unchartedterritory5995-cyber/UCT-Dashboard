"""An alias must name ONE person. Owner ruling CONTRACTS §8a.2.

Two defects, both found 2026-09-13, both of which left every existing test green:

F1 (S-B reviewer). `"Patrick"`, `"Blake"` and `"Manav"` were aliases of tsdr, bracco and
manrav. Aliases match EXACTLY and case-insensitively against a Zoom display name, so in a
~750-member room any attendee whose display name was their own first name resolved to a
CALL author — and D6's merge map publishes CALLs into the brain KB, `ticker_mentions` and
the exemplars. Nothing defaulted; the data simply said an attendee was the owner.

The worse one, found while fixing F1. Ruling §8a.2 was implemented in the DATA only:
`"Uncharted Territory"` was moved out of tsdr's aliases into `ambiguous_speaker_labels`.
That stopped it resolving to tsdr and started it resolving to **`guest:uncharted_territory`**
— with the label no longer an alias, the guest branch matched both of its tokens against the
session title "Uncharted Territory — Live Trading Session" and invented a person. A ruling
applied to one side of a data/code pair is not applied
(`lesson_a_second_authority_over_one_value`).

⛔ Every check here carries its control, because each of these bugs was a green suite.
"""
from __future__ import annotations

import json
import re

import pytest

from api.services.wisdom.core import authors, speakers

SINGLE_TOKEN_ALPHA = re.compile(r"^[^\W\d_]+$", re.UNICODE)
SESSION_TITLE = "Uncharted Territory — Live Trading Session"
SESSION_DESC = "Patrick, Blake and Manav on the tape with Pradeep Bonde"


@pytest.fixture()
def doc():
    return authors.load_authors()


def _all_aliases(doc):
    out = []
    for author in doc["authors"]:
        for alias in author.get("aliases") or []:
            out.append((author["author_id"], alias))
    return out


# ── the two lists must not overlap ───────────────────────────────────────────

def test_there_are_aliases_and_ambiguous_labels_to_check(doc):
    """Non-vacuity. Every assertion below is over one of these two lists; if either were
    empty this file would pass while checking nothing."""
    assert len(_all_aliases(doc)) >= 10
    assert len(authors.ambiguous_labels()) >= 4


def test_no_alias_is_also_an_ambiguous_label(doc):
    ambiguous = {lbl.casefold() for lbl in authors.ambiguous_labels()}
    clashes = [(aid, a) for aid, a in _all_aliases(doc) if a.casefold() in ambiguous]
    assert not clashes, (
        "a label cannot be both an alias of one person and declared unable to name one: "
        f"{clashes}")


def test_the_known_bare_given_names_are_ambiguous_and_not_aliases(doc):
    """The F1 names specifically. Named rather than derived: this is the regression."""
    ambiguous = {lbl.casefold() for lbl in authors.ambiguous_labels()}
    for name in ("Patrick", "Blake", "Manav"):
        assert name.casefold() in ambiguous, f"{name} must be an ambiguous label"
    assert not [a for _, a in _all_aliases(doc) if a.casefold() in {"patrick", "blake", "manav"}]


# ── a single-token alias must be argued for ──────────────────────────────────

def test_every_single_token_alphabetic_alias_is_declared_with_a_reason(doc):
    declared = doc.get("single_token_aliases_reviewed", {}).get("aliases", {})
    undeclared = [(aid, a) for aid, a in _all_aliases(doc)
                  if SINGLE_TOKEN_ALPHA.match(a) and a not in declared]
    assert not undeclared, (
        "a one-word alphabetic alias is matched exactly against a Zoom display name, so if it "
        "is also somebody's given name it attributes their words to a CALL author. Declare it "
        f"in single_token_aliases_reviewed with a reason, or make it ambiguous: {undeclared}")
    assert all(str(reason).strip() for reason in declared.values()), "a blank reason is not a reason"


def test_the_declaration_has_no_stale_entries(doc):
    """Control for the test above — a declaration list that has drifted from the aliases it
    describes would let it pass for the wrong reason."""
    declared = set(doc.get("single_token_aliases_reviewed", {}).get("aliases", {}))
    actual = {a for _, a in _all_aliases(doc)}
    assert not (declared - actual), f"declared but no longer an alias: {sorted(declared - actual)}"


# ── behaviour, not just data ─────────────────────────────────────────────────

@pytest.mark.parametrize("label", ["Uncharted Territory", "Patrick", "Blake", "Manav"])
def test_an_ambiguous_label_resolves_to_team_unresolved_even_when_the_title_names_it(label):
    """The guest-fabrication case. SESSION_TITLE/DESC deliberately contain every one of these
    tokens, which is exactly the condition that produced 'guest:uncharted_territory'."""
    got = speakers.normalize_speaker(label, SESSION_TITLE, SESSION_DESC)
    assert got == authors.TEAM_UNRESOLVED, f"{label!r} -> {got!r}"
    assert not str(got).startswith(speakers.GUEST_PREFIX)


def test_team_unresolved_can_never_author_a_call():
    """§8a.2: MENTION only. If this ever joins call_authors the ruling is void."""
    assert authors.TEAM_UNRESOLVED not in authors.call_authors()


def test_ambiguous_beats_alias_even_if_the_data_is_wrong(monkeypatch):
    """Fail-closed ordering. A label declared ambiguous AND left in an alias list must resolve
    to nobody, not to that author — a mistake in the data must not become an attribution."""
    doc = json.loads(json.dumps(authors.load_authors()))  # deep copy
    doc["authors"][0].setdefault("aliases", []).append("Uncharted Territory")
    monkeypatch.setattr(authors, "load_authors", lambda: doc)
    assert authors.author_for_alias("Uncharted Territory") is None
    assert speakers.normalize_speaker("Uncharted Territory", SESSION_TITLE, None) == authors.TEAM_UNRESOLVED


def test_the_rail_can_fire(monkeypatch):
    """Plant the exact F1 defect and prove the checks above would catch it."""
    doc = json.loads(json.dumps(authors.load_authors()))
    doc["ambiguous_speaker_labels"] = [e for e in doc["ambiguous_speaker_labels"]
                                       if e["label"] != "Patrick"]
    doc["authors"][0]["aliases"].append("Patrick")
    monkeypatch.setattr(authors, "load_authors", lambda: doc)

    assert authors.author_for_alias("Patrick") == "tsdr"          # the defect is back...
    declared = doc.get("single_token_aliases_reviewed", {}).get("aliases", {})
    assert "Patrick" not in declared                              # ...and undeclared, so the
    undeclared = [a for _, a in _all_aliases(doc)                 # declaration check would red
                  if SINGLE_TOKEN_ALPHA.match(a) and a not in declared]
    assert "Patrick" in undeclared


# ── the honest paths still work ──────────────────────────────────────────────

@pytest.mark.parametrize("label,expected", [
    ("Patrick (TSDR)", "tsdr"), ("Patrick TSDR)", "tsdr"), ("TSDR", "tsdr"),
    ("tsdrtrading", "tsdr"), ("Brac", "bracco"), ("braczyy", "bracco"),
    ("1ChartMaster", "chartmaster"), ("Joe Walburn", "chartmaster"), ("Manrav", "manrav"),
])
def test_the_real_labels_still_resolve(label, expected):
    """Control: the fix must not have made the normaliser useless."""
    assert speakers.normalize_speaker(label, SESSION_TITLE, SESSION_DESC) == expected


def test_a_real_guest_is_still_a_guest():
    assert speakers.normalize_speaker(
        "Pradeep Bonde", "Workshop with Pradeep Bonde (Stockbee)", None) == "guest:pradeep_bonde"


def test_an_attendee_is_still_nobody():
    assert speakers.normalize_speaker("Dave Wilson", SESSION_TITLE, None) is None
