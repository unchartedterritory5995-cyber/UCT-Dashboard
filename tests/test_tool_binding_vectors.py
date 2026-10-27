"""Task 11.2 (ruling W11-R14): the server twin of the template day binding, run over the ONE
vector file the client (lib/blocks/toolDays.js, Task 11.14) also reads. The expected values in the
file are typed by hand; this test never derives one from the code under test."""
import json
from datetime import datetime
from pathlib import Path

import pytest

from api.services import session_calendar
from api.services.journal_two import tool_binding as tb

VECTORS = json.loads(
    (Path(__file__).parent / "fixtures" / "toolBindingVectors.json").read_text(encoding="utf-8")
)


def _id(case):
    return " ".join(str(case.get(k)) for k in ("note_day", "day", "name", "created_at", "bind") if k in case)


def test_vector_file_is_version_one_and_lf():
    raw = (Path(__file__).parent / "fixtures" / "toolBindingVectors.json").read_bytes()
    assert VECTORS["version"] == 1
    assert b"\r" not in raw


@pytest.mark.parametrize("case", VECTORS["bind"], ids=_id)
def test_bind_vectors(case):
    if case.get("raises"):
        with pytest.raises(ValueError):
            tb.bind_day(case["note_day"], case["bind"])
        return
    assert tb.bind_day(case["note_day"], case["bind"]) == case["expected"], case["why"]


@pytest.mark.parametrize("case", VECTORS["label"], ids=_id)
def test_label_vectors(case):
    assert tb.for_day_label(case["day"], case["bind"]) == case["expected"]


@pytest.mark.parametrize("case", VECTORS["search"], ids=_id)
def test_search_vectors(case):
    got = tb.search_text(case["kind"], case["name"], case["day"], case["bind"])
    assert got == case["expected"]


@pytest.mark.parametrize("case", VECTORS["note_day"], ids=_id)
def test_note_day_vectors(case):
    now = datetime.fromisoformat(case["now"].replace("Z", "+00:00"))
    got = tb.note_day(daily_date=case["daily_date"], created_at=case["created_at"], now=now)
    assert got == case["expected"], case["why"]


def test_every_bind_appears_in_three_vectors():
    # Non-vacuity: the parametrized tests above pass over an empty list, so the file's coverage is
    # counted here. Every bind a template may hold has at least three bind cases, the label and
    # search lists each cover the week wording and the day wording, and the sections hold the
    # brief's minimums.
    assert len(VECTORS["bind"]) >= 20
    assert len(VECTORS["label"]) >= 10
    assert len(VECTORS["search"]) >= 8
    assert len(VECTORS["note_day"]) >= 6
    for bind in tb.BINDS:
        assert sum(1 for c in VECTORS["bind"] if c["bind"] == bind) >= 3, bind
    assert {c["bind"] for c in VECTORS["bind"]} == set(tb.BINDS)
    for section in ("label", "search"):
        binds = {c["bind"] for c in VECTORS[section]}
        assert "week" in binds and binds - {"week"}, section
    assert {c["kind"] for c in VECTORS["search"]} == set(tb.KINDS)


def test_vector_file_horizon_matches_the_calendar():
    assert str(session_calendar.horizon()) == VECTORS["assumes_horizon"], (
        "The market calendar's horizon moved: move the past-horizon bind and label cases in "
        "tests/fixtures/toolBindingVectors.json (the 2028-12-29 / 2029-01 rows) past the new "
        "horizon, then update assumes_horizon. Edit the file as text."
    )
