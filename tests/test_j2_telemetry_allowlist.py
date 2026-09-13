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

OPT_IN_EVENT = "notebook_offline_opt_in"
OPT_IN_CLIENT = Path("app/src/pages/journal-2-0/lib/offline/offlineOptInEvent.js")


def test_the_blocked_baseline_event_is_accepted():
    assert EVENT in _J2_TELEMETRY_EVENTS


def test_the_opt_in_event_is_accepted():
    """The DENOMINATOR for the event above.

    ⛔ If this name is not accepted, every opt-in POST is a 400 and the count is
    silently zero — which reads exactly like "nobody opted in", the very fact it
    exists to measure. A rejected denominator is worse than none: it makes an
    empty population indistinguishable from a real one.
    """
    assert OPT_IN_EVENT in _J2_TELEMETRY_EVENTS


def test_the_opt_in_client_and_server_name_the_same_event():
    src = OPT_IN_CLIENT.read_text(encoding="utf-8")
    m = re.search(r"OPT_IN_EVENT\s*=\s*'([^']+)'", src)
    assert m, f"could not read the event name out of {OPT_IN_CLIENT}"
    assert m.group(1) in _J2_TELEMETRY_EVENTS


def test_the_opt_in_payload_never_carries_note_content():
    """Three fields: a session id, the flag state, a timestamp.

    ⛔ Pinned by reading the builder, so an "enrichment" pass that adds a title
    fails here rather than shipping member text into `activity_log`.
    """
    src = OPT_IN_CLIENT.read_text(encoding="utf-8")
    body = src.split("export function optInProps", 1)[1].split("\n}", 1)[0]
    for forbidden in ("title", "bodyJson", "subtitle", "patch", "notedraft"):
        assert forbidden not in body, f"optInProps references {forbidden!r}"


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


# ---------------------------------------------------------------------------
# ⛔⛔ DERIVED, SO THE NEXT EVENT IS COVERED THE DAY IT LANDS.
#
# The tests above name one event each, by hand. That is exactly the artifact
# this repo keeps re-committing: a hand-typed enumeration beside the source that
# owns it. Wave K added a third event and the pattern would have been a third
# hand-written pair — green for the two that existed and blind to the one that
# mattered, because a name missing from the allow-list is a 400 and a 400 here
# is a SILENT nothing (`postJ2Telemetry` swallows, by design: an instrument that
# can break the thing it measures is worse than no instrument).
#
# So this sweeps the directory for every `export const *_EVENT = '...'` and
# holds the server to all of them at once.
# ---------------------------------------------------------------------------

OFFLINE_DIR = Path("app/src/pages/journal-2-0/lib/offline")
_EVENT_DECL = re.compile(r"export\s+const\s+\w*EVENT\s*=\s*['\"]([a-z0-9_]+)['\"]")


def _client_event_names() -> dict[str, str]:
    """{event name: the file that declares it}, read from the client source."""
    found: dict[str, str] = {}
    for path in sorted(OFFLINE_DIR.glob("*.js")):
        if path.name.endswith(".test.js"):
            continue
        for name in _EVENT_DECL.findall(path.read_text(encoding="utf-8")):
            found[name] = path.name
    return found


def test_the_sweep_actually_finds_the_events_it_is_meant_to_hold():
    """⭐ NON-VACUITY. Every assertion below is `for name in found` — and an
    empty `found` satisfies all of them. A regex that stops matching (a rename, a
    different quote style, a `const` moved behind a factory) would turn this
    whole rail into a no-op that reads as coverage."""
    names = _client_event_names()
    assert len(names) >= 3, f"the sweep found {len(names)} event declarations: {names}"
    for expected in ("notebook_blocked_no_baseline", "notebook_offline_opt_in",
                     "notebook_config_served"):
        assert expected in names, f"{expected} is declared in the client and the sweep missed it"


def test_every_client_event_is_on_the_server_allowlist():
    missing = {n: f for n, f in _client_event_names().items() if n not in _J2_TELEMETRY_EVENTS}
    assert not missing, (
        "these events are POSTed by the client and REFUSED by the server with a 400 — "
        "and the client swallows the refusal, so the measurement is silently nothing:\n"
        + "\n".join(f"  {n}  (declared in {f})" for n, f in sorted(missing.items()))
    )


def test_the_config_served_event_carries_no_note_content():
    """⛔ Wave K's event, held to the same key-set rule as its two neighbours:
    the SET is pinned, because "there is no body key" is satisfied by a payload
    that ships the title instead."""
    src = (OFFLINE_DIR / "configServedEvent.js").read_text(encoding="utf-8")
    # The props object is written out literally; read the keys it builds.
    body = src[src.index("export function configServedReport"):]
    body = body[:body.index("\n}")]
    keys = set(re.findall(r"^\s{4}(\w+):", body, re.M))
    assert keys == {"served", "waited_bucket_ms"}, keys
    for forbidden in ("title", "body", "bodyJson", "content", "text", "html"):
        assert forbidden not in keys
