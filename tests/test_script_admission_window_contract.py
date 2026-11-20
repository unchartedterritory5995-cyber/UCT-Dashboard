"""THE ADMISSION VERDICT IN A SCRIPT ANSWER, AS THE WINDOW READS IT (2026-11-19).

The server puts the verdict in the script's own answer (`runtime_definitions.script_answer_admission`,
tests/test_script_answer_admission.py) so the window need not ask the verdict door. The window keeps it only
when it is well formed (`converseClient.js::admissionOf`) and latches it only under the script's own hash
(`scriptAnswer.js::latchAnswerAdmission`). The two sides are written in two languages: this holds the shape one
sends to the shape the other reads, so a key renamed on either side fails here.
"""
from __future__ import annotations

import hashlib
import pathlib
import re

from api.services import pine_authoring
from api.services import runtime_definitions as rt
from tests._script_admission_fixtures import ADMITTED, HISTORY, UNADMITTED, adm  # noqa: F401 -- `adm` is a fixture

AUTHORING = pathlib.Path(__file__).resolve().parents[1] / "app" / "src" / "components" / "chart" / "builder" / "authoring"
KEYS = {"sha256", "admitted", "missing", "historyOnly"}


def _code(name):
    """A browser file with its comments removed (a key named only in a comment is not read)."""
    text = (AUTHORING / name).read_text(encoding="utf-8")
    return "\n".join(line.split("//")[0] for line in re.sub(r"/\*.*?\*/", "", text, flags=re.S).split("\n"))


def test_what_the_server_sends_is_what_the_window_reads(adm):
    client, answer = _code("converseClient.js"), _code("scriptAnswer.js")
    seen = set()
    for source in (ADMITTED, HISTORY, UNADMITTED):
        verdict = rt.script_answer_admission(source, pine_authoring.script_capabilities(source))
        assert isinstance(verdict, dict), source
        assert {"sha256", "admitted", "missing"} <= set(verdict) <= KEYS, sorted(verdict)
        # the hash the window compares with: sha256 of the script's UTF-8 source, as written
        assert verdict["sha256"] == hashlib.sha256(source.encode("utf-8")).hexdigest()
        assert isinstance(verdict["admitted"], bool) and isinstance(verdict["missing"], list)
        assert all(isinstance(m, str) and 0 < len(m) <= 80 for m in verdict["missing"]) and len(verdict["missing"]) <= 32
        if "historyOnly" in verdict:
            assert isinstance(verdict["historyOnly"], list) and all(isinstance(m, str) for m in verdict["historyOnly"])
        seen |= set(verdict)
    assert seen == KEYS, f"no sample carried {sorted(KEYS - seen)}: the shape below was not exercised"
    # every key the server sends is read by the window's keeper, and by the latch that uses it
    for key in KEYS:
        assert f"raw.{key}" in client, f"converseClient.js::admissionOf does not read `{key}`"
    for key in ("sha256", "admitted", "missing", "historyOnly"):
        assert f"admission.{key}" in answer, f"scriptAnswer.js::latchAnswerAdmission does not read `{key}`"
    assert "admissionOf(s.admission)" in client
    # the bounds the window keeps are the bounds asserted above
    assert "maxIds: 32, maxIdChars: 80" in client
    # and "still being checked" is the one answer the window must not latch
    assert "admission.missing.includes('pending')" in answer and rt.PENDING == "pending"


def test_with_admission_off_there_is_nothing_to_read():
    assert rt.script_answer_admission(ADMITTED, pine_authoring.script_capabilities(ADMITTED)) is None
