"""Wave Q1 — THE INSTRUMENT'S DOOR HAS TO BE OPEN, AND ONLY THIS FAR.

The drain's baseline refusal now reports itself so the observation window can
count occurrences instead of arguing about them. That report is a POST to
`/api/j2/telemetry`, which rejects any event name not on an allow-list with a
400 — so a client-side rail proving "we posted it" would be green against a
server that silently threw every one away.

⛔ THIS IS THE MIRROR, NOT A SECOND COPY OF THE LANE
(`lesson_rail_the_mirror_not_just_the_lane`). The client rail asserts the name
it sends; this asserts the name the server accepts; the third test below asserts
they are the SAME STRING, read from both sides, so the two can never drift into
a state where each looks correct alone.

⛔ AND THE ALLOW-LIST IS STILL AN ALLOW-LIST. A change that "fixed" the 400 by
accepting anything would leave the first two tests green — hence the negative.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from api.routers.journal_two import _J2_TELEMETRY_EVENTS

EVENT = "notebook_blocked_no_baseline"
CLIENT = Path("app/src/pages/journal-2-0/lib/offline/blockedBaselineEvent.js")


def test_the_blocked_baseline_event_is_accepted():
    assert EVENT in _J2_TELEMETRY_EVENTS


def test_the_allowlist_is_still_a_list_and_not_a_pass_through():
    # CONTROL. Without it, deleting the membership check entirely would leave
    # the test above green and this rail would be proving nothing.
    assert "anything_at_all" not in _J2_TELEMETRY_EVENTS
    assert "" not in _J2_TELEMETRY_EVENTS
    # The pre-existing Notebook events are untouched — this was an ADDITION.
    assert {"notebook_tab_visit", "notebook_capture_saved"} <= _J2_TELEMETRY_EVENTS


def test_the_client_and_the_server_name_the_same_event():
    """⛔ DERIVED FROM THE CLIENT SOURCE, never retyped here.

    A constant typed independently on both sides is two authorities over one
    value: the day someone renames the event, the client posts a name the server
    rejects and both files still read as correct.
    """
    src = CLIENT.read_text(encoding="utf-8")
    m = re.search(r"BLOCKED_BASELINE_EVENT\s*=\s*'([^']+)'", src)
    assert m, f"could not read the event name out of {CLIENT}"
    assert m.group(1) in _J2_TELEMETRY_EVENTS


def test_the_client_never_sends_note_content():
    """The payload's field list, read off the client module.

    ⛔ A member's words must not reach `activity_log`. The client rail pins the
    exact key set; this pins that the module building that payload does not so
    much as reference the patch — a defence that survives someone "enriching"
    the event later without reading the comment above it.
    """
    src = CLIENT.read_text(encoding="utf-8")
    body = src.split("export function blockedBaselineProps", 1)[1]
    body = body.split("\n}", 1)[0]
    for forbidden in ("patch", "bodyJson", "title", "subtitle"):
        assert forbidden not in body, f"blockedBaselineProps references {forbidden!r}"


@pytest.mark.parametrize("shape", ["null", "undefined", "empty-string", "whitespace"])
def test_every_baseline_shape_the_incident_could_have_had_is_enumerated(shape):
    """The window has to distinguish `null` from `''`.

    They are two different defects — the first is the 2026-09-09 incident, the
    second is the `??`-vs-truthiness bug found while hunting it — and a report
    that collapsed them would answer the wrong question.
    """
    assert f"'{shape}'" in CLIENT.read_text(encoding="utf-8")
