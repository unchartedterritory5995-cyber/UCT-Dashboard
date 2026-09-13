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
    """Plant the exact F1 defect and prove the checks above would catch it.

    ⚰️ This asserted `author_for_alias("Patrick") == "tsdr"` until the owner's drift #4 ruling
    ("deleted, not just disabled") moved the guard from the DATA into the RESOLVER. The plant
    no longer restores the defect, and that is the improvement — so the assertion is now the
    opposite one. Re-adding a bare given name is caught twice over: the resolver refuses it at
    runtime, and the declaration check names it here."""
    doc = json.loads(json.dumps(authors.load_authors()))
    doc["ambiguous_speaker_labels"] = [e for e in doc["ambiguous_speaker_labels"]
                                       if e["label"] != "Patrick"]
    doc["authors"][0]["aliases"].append("Patrick")
    monkeypatch.setattr(authors, "load_authors", lambda: doc)

    # 1. the capability is gone: the data-only plant does NOT restore the defect
    assert authors.author_for_alias("Patrick") is None
    # 2. and the declaration check still fires by name, so the mistake is visible, not merely inert
    declared = doc.get("single_token_aliases_reviewed", {}).get("aliases", {})
    assert "Patrick" not in declared
    undeclared = [a for _, a in _all_aliases(doc)
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


# ── the capability, not just the instance (owner ruling, drift #4) ───────────

def test_a_bare_given_name_cannot_resolve_even_if_put_back_into_an_alias_list(monkeypatch):
    """⛔ 'Deleted, not just disabled.' Removing 'Patrick' from the alias list fixed the
    INSTANCE. This proves the DOOR is shut: re-committing the exact mistake — adding a bare
    given name back as an alias — resolves to nobody at runtime, not to a CALL author."""
    doc = json.loads(json.dumps(authors.load_authors()))
    doc["ambiguous_speaker_labels"] = [e for e in doc["ambiguous_speaker_labels"]
                                       if e["label"] != "Patrick"]
    doc["authors"][0]["aliases"].append("Patrick")      # the mistake, re-committed
    monkeypatch.setattr(authors, "load_authors", lambda: doc)

    assert authors.author_for_alias("Patrick") is None
    assert authors.author_for_alias("Blake") is None
    assert authors.author_for_alias("Dave") is None
    # and the control: a DECLARED single-token alias is unaffected
    assert authors.author_for_alias("Brac") == "bracco"


def test_a_session_with_an_attendee_named_patrick_yields_no_tsdr_attribution():
    """The owner's regression case, drift #4(c), written as a SESSION rather than a unit
    assertion: a live session in which a member happens to be called Patrick must produce
    zero records attributed to the owner from that member's speech.

    ⚠️ Scope, stated rather than implied: the record WRITER is S-D and is not merged, so this
    asserts at the layer that decides authorship — every speaker label in the session. A
    record cannot be attributed to tsdr unless this function returns 'tsdr' for its cue, so
    zero tsdr here is zero tsdr records from those cues. The end-to-end assertion over
    written rows belongs to S-D's suite and is named in the ledger as owed."""
    title = "Live Trading Session — September 12, 2026"
    description = "Patrick (TSDR) on the open with the desk"
    # A realistic Zoom cue list: the host, two teammates, and THREE attendees whose display
    # names collide with author first names.
    session_cues = [
        ("Patrick (TSDR)", "I'm taking NVDA here above 182"),          # the owner, genuinely
        ("Patrick", "should I be buying this dip in TSLA?"),           # an ATTENDEE
        ("patrick", "same question for AMD"),                          # ...and casing variants
        ("  PATRICK  ", "and MSFT?"),
        ("Blake", "what's your stop on that"),                         # an ATTENDEE, not Bracco
        ("Manav", "thanks guys"),                                      # an ATTENDEE, not Manrav
        ("Bracco", "I'm long SKHY from yesterday"),                    # a teammate, genuinely
        ("Uncharted Territory", "watch 4,600 on the index"),           # the SHARED host account
        ("Dave Wilson", "good morning"),                               # an ordinary attendee
    ]
    resolved = [(label, speakers.normalize_speaker(label, title, description))
                for label, _ in session_cues]

    tsdr_cues = [label for label, author in resolved if author == "tsdr"]
    assert tsdr_cues == ["Patrick (TSDR)"], (
        f"only the owner's own Zoom label may author as tsdr; got {tsdr_cues}")

    by_label = dict(resolved)
    for attendee in ("Patrick", "patrick", "  PATRICK  ", "Blake", "Manav"):
        assert by_label[attendee] == authors.TEAM_UNRESOLVED, (
            f"attendee {attendee!r} resolved to {by_label[attendee]!r}")
    assert by_label["Uncharted Territory"] == authors.TEAM_UNRESOLVED
    assert by_label["Dave Wilson"] is None                  # an attendee: no name is stored
    # Controls: the real people are still resolvable, or this test passes by breaking everything.
    assert by_label["Bracco"] == "bracco"
    assert by_label["Patrick (TSDR)"] == "tsdr"
    # And nothing in this session may author a CALL except a real CALL author.
    authored = {a for a in by_label.values() if a and not str(a).startswith(speakers.GUEST_PREFIX)}
    assert authored - {authors.TEAM_UNRESOLVED} <= authors.call_authors()
    assert authors.TEAM_UNRESOLVED not in authors.call_authors()
