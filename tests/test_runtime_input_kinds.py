"""Phase 3 WS-D - the server's half of the two runtime-only input types (`time`, `session`).

The browser (`defSchema.js`) refuses both on any document that is not a runtime document and
checks their values; `user_definitions.validate_input_specs` is the same rule at the door every
member shares, run from `validate_v2` (formula documents) and `_save_runtime`. The session cases
are read from the SAME fixture the browser's rail reads, so the two languages answer one question.
"""
import json
import os

import pytest

from api.services import user_definitions as ud

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CASES = json.load(open(os.path.join(ROOT, "tests", "fixtures", "runtime_input_kind_cases.json"), encoding="utf-8"))


@pytest.mark.parametrize("s", CASES["sessions"]["valid"])
def test_session_valid(s):
    assert ud.is_session_string(s) is True


@pytest.mark.parametrize("s", CASES["sessions"]["invalid"])
def test_session_invalid(s):
    assert ud.is_session_string(s) is False


def _runtime_doc(inputs):
    return {"compute": {"kind": "runtime", "source": "//@version=5\nindicator('x')\nplot(close)"},
            "inputs": inputs}


def test_runtime_document_may_declare_time_and_session():
    ud.validate_input_specs(_runtime_doc([
        {"key": "t", "type": "time", "default": 1609459200000},
        {"key": "s", "type": "session", "default": "0930-1600:23456"},
        {"key": "n", "type": "int", "default": 3},
    ]))


@pytest.mark.parametrize("spec,needle", [
    ({"key": "t", "type": "time", "default": 1.5}, "inputs[0].default: type 'time'"),
    ({"key": "t", "type": "time", "default": True}, "inputs[0].default: type 'time'"),
    ({"key": "t", "type": "time", "default": 9_000_000_000_000_000}, "inputs[0].default: type 'time'"),
    ({"key": "s", "type": "session", "default": "9:30 to 4"}, "inputs[0].default: type 'session'"),
])
def test_bad_default_is_refused_by_field_path(spec, needle):
    with pytest.raises(ValueError) as e:
        ud.validate_input_specs(_runtime_doc([spec]))
    assert str(e.value).startswith(needle)


def test_formula_document_may_not_declare_them():
    doc = {"compute": {"kind": "ast", "ast": {"type": "num", "value": 1}}, "inputs": [
        {"key": "t", "type": "time", "default": 0}]}
    with pytest.raises(ValueError) as e:
        ud.validate_v2(doc)
    assert str(e.value).startswith("inputs[0].type: 'time' is declared only by a pasted Pine script")


def test_every_other_input_type_is_untouched():
    """Older documents: nothing about a type this store never read before is judged now."""
    doc = {"compute": {"kind": "ast", "ast": {"type": "num", "value": 1}}, "inputs": [
        {"key": "a", "type": "int", "default": "not even an int"},
        {"key": "b", "type": "whatever", "default": None},
        "not a dict"]}
    ud.validate_input_specs(doc)
