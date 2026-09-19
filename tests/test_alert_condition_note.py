"""⭐⭐ RULING D1 (option C) — THE PYTHON HALF OF THE ALERT-CONDITION SENTENCE.

``chooseOutput`` now splits by lane: a PANE never selects an ``alertcondition``
(it draws nothing in Pine — it registers a condition the platform offers under
Alerts), a SCREEN still prefers one. The member is told where the condition went,
and that sentence is declared ONCE in ``closedTable.json::_alertconditions``.

⛔ THIS FILE EXISTS BECAUSE THE SENTENCE CROSSES A LANE BOUNDARY. The JS rail
(``pine.alertLane.test.js``) proves the browser reads the declaration; nothing
there can see whether the Python lane grew a second copy of the same string —
and a second copy is the defect this repo keeps paying for. Both halves read the
same JSON, and this asserts that rather than assuming it.
"""
import json
import pathlib

from api.services.ast_table import (
    ALERTS_SECTION,
    MEMBER_NOTE,
    NAME_PLACEHOLDER,
    alert_note_for,
    alert_notes,
)

_MANIFEST = (pathlib.Path(__file__).resolve().parents[1]
             / "app/src/components/chart/engine/ast/closedTable.json")


def _raw_section():
    return json.loads(_MANIFEST.read_text(encoding="utf-8"))[ALERTS_SECTION]


def test_the_python_lane_reads_the_declaration_and_does_not_carry_a_copy():
    raw = _raw_section()
    notes = alert_notes()
    assert notes is not None
    # ⛔ DERIVED FROM THE FILE, NEVER RETYPED. A literal here would agree with the
    # manifest right up until somebody edited one of them.
    assert notes[MEMBER_NOTE] == raw["memberNote"]
    assert notes[NAME_PLACEHOLDER] == raw["namePlaceholder"]


def test_the_declared_sentence_actually_contains_its_placeholder():
    # ⛔ WITHOUT THIS, A SUBSTITUTION THAT NEVER FIRES LOOKS EXACTLY LIKE ONE THAT
    # DOES. The member would read a sentence that names no condition, and every
    # test asserting "the note is produced" would still pass.
    raw = _raw_section()
    assert raw["namePlaceholder"] in raw["memberNote"]


def test_it_substitutes_the_condition_name():
    out = alert_note_for("HVE Trigger")
    assert out is not None
    assert "HVE Trigger" in out
    assert _raw_section()["namePlaceholder"] not in out
    assert out.endswith("is not drawn on the chart.")


def test_an_untitled_condition_never_names_a_python_value():
    for title in (None, "", "   ", 17):
        out = alert_note_for(title)
        assert "this alert" in out, title
        assert "None" not in out


def test_it_is_read_not_baked_in():
    # Mutation proof: swap the declaration and the produced sentence moves with it.
    stub = {ALERTS_SECTION: {"memberNote": "ALT <who> ALT", "namePlaceholder": "<who>"}}
    assert alert_note_for("X", stub) == "ALT X ALT"
    # …and there is no default sentence hiding behind an absent or blank section.
    assert alert_notes({}) is None
    assert alert_notes({ALERTS_SECTION: {"memberNote": "  "}}) is None
    assert alert_note_for("X", {}) is None
