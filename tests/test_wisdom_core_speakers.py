"""Speaker normalization (W1 §4.4, D14; manifest §9).

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a Zoom label of one of the four authors not mapping (decorations, a stray bracket,
   a device suffix, a known alias);
2. a guest named in the session title or description not becoming guest:<slug>;
3. an ATTENDEE's name surviving: an unmapped label that is not a named guest must be None,
   including a label that only shares one word with the description, or only title words.
"""
from __future__ import annotations

import pytest

from api.services.wisdom.core import speakers

TITLE = "Workshop with Stockbee"
DESCRIPTION = "Pradeep Bonde (Stockbee) joins the desk to talk episodic pivots."


@pytest.mark.parametrize("label,author", [
    ("Patrick (TSDR)", "tsdr"),
    ("Patrick TSDR)", "tsdr"),
    ("Patrick (TSDR) (Host)", "tsdr"),
    ("Uncharted Territory", "tsdr"),
    ("  patrick (tsdr)  ", "tsdr"),
    ("Brac", "bracco"),
    ("Bracco (Host)", "bracco"),
    ("Braczyy - iPhone", "bracco"),
    ("Manav", "manrav"),
    ("1ChartMaster", "chartmaster"),
])
def test_author_labels_map_to_their_author(label, author):
    assert speakers.normalize_speaker(label, TITLE, DESCRIPTION) == author


@pytest.mark.parametrize("label,guest", [
    ("Pradeep Bonde", "guest:pradeep_bonde"),
    ("Stockbee", "guest:stockbee"),
    ("Pradeep Bonde (Guest)", "guest:pradeep_bonde"),
])
def test_a_guest_named_in_the_session_becomes_a_guest_slug(label, guest):
    assert speakers.normalize_speaker(label, TITLE, DESCRIPTION) == guest


@pytest.mark.parametrize("label,title,description", [
    ("John Smith", "Live Trading Session", ""),
    ("Pradeep Smith", TITLE, DESCRIPTION),          # one token matches, the name does not
    ("Live", "Live Trading", ""),                     # only title words
    ("Workshop", TITLE, DESCRIPTION),
    ("Ravi", TITLE, DESCRIPTION),                     # team, not one of the four authors, not a guest
    ("Stockbee", "", ""),                             # nothing to be named in
    ("", TITLE, DESCRIPTION),
    (None, TITLE, DESCRIPTION),
])
def test_an_attendee_is_none_and_no_name_survives(label, title, description):
    assert speakers.normalize_speaker(label, title, description) is None


def test_the_guest_slug_is_ascii_and_bounded():
    label = "Zoë Ångström-Lee"
    assert speakers.normalize_speaker(label, f"Interview with {label}", "") == "guest:zoe_angstrom_lee"
