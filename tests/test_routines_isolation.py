"""Task 9.4 - a routine id that is not the member's is absent: reads return nothing for it
and writes answer NotFound. Ownership comes from user_id only."""
from __future__ import annotations

import importlib
from datetime import datetime, timezone

import pytest

A, B = "u-iso-a", "u-iso-b"
NOW = datetime(2026, 11, 3, 17, tzinfo=timezone.utc)


@pytest.fixture
def R(monkeypatch, tmp_path):
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    from api.services.journal_two import routines
    yield routines
    importlib.reload(auth_db)


def _mk(R, user, name):
    return R.create(user, name=name, items=[{"text": "One"}, {"text": "Two"}],
                    schedule={"kind": "every"}, now=NOW)


def _rows(table, user):
    from api.services import auth_db
    c = auth_db.get_connection()
    try:
        return c.execute(f"SELECT COUNT(*) FROM {table} WHERE user_id = ?", (user,)).fetchone()[0]
    finally:
        c.close()


def test_member_b_cannot_see_or_touch_a(R):
    a = _mk(R, A, "A's")
    item = a["items"][0]["id"]
    assert R.get(B, a["id"]) is None
    with pytest.raises(R.NotFound):
        R.update(B, a["id"], if_match=1, name="mine now", now=NOW)
    with pytest.raises(R.NotFound) as e:
        R.set_tick(B, a["id"], "2026-11-03", item, True, now=NOW)
    assert e.value.sentence == "Not available." and e.value.status == 404
    with pytest.raises(R.NotFound):
        R.set_skipped(B, a["id"], "2026-11-03", True, now=NOW)
    for call in (R.archive, R.unarchive, R.undelete, R.duplicate):
        with pytest.raises(R.NotFound):
            call(B, a["id"], now=NOW)
    assert R.read_days(B, [a["id"]], ["today"], now=NOW)["routines"] == {}
    assert _rows("j2_routine_ticks", B) == 0 and _rows("j2_routine_days", B) == 0
    assert _rows("j2_routines", B) == 0
    assert R.get(A, a["id"])["name"] == "A's" and R.get(A, a["id"])["etag"] == 1


def test_read_naming_both_answers_only_the_callers(R):
    a = _mk(R, A, "A's")
    b = _mk(R, B, "B's")
    out = R.read_days(B, [a["id"], b["id"]], ["2026-11-03"], now=NOW)
    assert list(out["routines"]) == [b["id"]]
    assert out["routines"][b["id"]]["routine"]["name"] == "B's"


def test_an_item_id_of_as_routine_is_refused_in_bs_tick(R):
    a = _mk(R, A, "A's")
    b = _mk(R, B, "B's")
    with pytest.raises(R.RoutineError) as e:
        R.set_tick(B, b["id"], "2026-11-03", a["items"][0]["id"], True, now=NOW)
    assert e.value.sentence == "That item isn't in this routine."
    assert _rows("j2_routine_ticks", B) == 0
