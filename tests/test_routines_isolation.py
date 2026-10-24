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


# ── Task 9.5: trackers ─────────────────────────────────────────────────────────────────────────
# The same rule for the tracker store: a tracker id that is not the member's is absent, and the
# two built-in trackers read only the caller's own check-ins.

@pytest.fixture
def T(monkeypatch, tmp_path):
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    from api.services.journal_two import trackers
    yield trackers
    importlib.reload(auth_db)


def _mk_tracker(T, user, name):
    return T.create(user, name=name, kind="number", now=NOW)


def test_member_b_cannot_see_or_touch_as_tracker(T):
    a = _mk_tracker(T, A, "A's")
    T.set_value(A, a["id"], "2026-11-03", 7, now=NOW)
    assert T.get(B, a["id"]) is None
    with pytest.raises(T.NotFound):
        T.update(B, a["id"], if_match=1, name="mine now", now=NOW)
    with pytest.raises(T.NotFound) as e:
        T.set_value(B, a["id"], "2026-11-03", 1, now=NOW)
    assert e.value.sentence == "Not available." and e.value.status == 404
    with pytest.raises(T.NotFound):
        T.set_value(B, a["id"], "2026-11-03", None, now=NOW)
    for call in (T.archive, T.unarchive, T.undelete, T.duplicate):
        with pytest.raises(T.NotFound):
            call(B, a["id"], now=NOW)
    with pytest.raises(T.NotFound):
        T.soft_delete(B, a["id"], typed_name="A's", now=NOW)
    assert T.read_days(B, [a["id"]], ["today"], now=NOW)["trackers"] == {}
    assert [t["id"] for t in T.list_trackers(B, now=NOW)] == ["checkin:mood", "checkin:focus"]
    assert _rows("j2_trackers", B) == 0 and _rows("j2_tracker_values", B) == 0
    got = T.get(A, a["id"])
    assert got["name"] == "A's" and got["etag"] == 1
    day = T.read_days(A, [a["id"]], ["2026-11-03"], now=NOW)["trackers"][a["id"]]
    assert day["days"]["2026-11-03"]["value"] == 7.0


def test_tracker_read_naming_both_answers_only_the_callers(T):
    a = _mk_tracker(T, A, "A's")
    b = _mk_tracker(T, B, "B's")
    out = T.read_days(B, [a["id"], b["id"]], ["2026-11-03"], now=NOW)
    assert list(out["trackers"]) == [b["id"]]
    assert out["trackers"][b["id"]]["tracker"]["name"] == "B's"


def test_builtin_trackers_read_only_the_callers_checkins(T):
    from api.services import auth_db
    c = auth_db.get_connection()
    try:
        for user, note, mood in ((A, "n-a", 2), (B, "n-b", 5)):
            c.execute("INSERT INTO j2_notes (id, user_id, created_at, updated_at)"
                      " VALUES (?, ?, '2026-11-01T00:00:00+00:00', '2026-11-03T20:00:00+00:00')",
                      (note, user))
            c.execute("INSERT INTO j2_note_checkins (note_id, user_id, embed_id, day, mood,"
                      " focus, created_at) VALUES (?, ?, 'e1', '2026-11-03', ?, NULL,"
                      " '2026-11-03T20:00:00+00:00')", (note, user, mood))
        c.commit()
    finally:
        c.close()
    for user, mood in ((A, 2.0), (B, 5.0)):
        got = T.read_days(user, ["checkin:mood"], ["2026-11-03"], now=NOW)["trackers"]
        assert got["checkin:mood"]["days"]["2026-11-03"]["value"] == mood
        assert got["checkin:mood"]["recent"] == [{"day": "2026-11-03", "value": mood}]
