"""Wave B (High-Frequency Notebook UX) — Favorites + Recents service layer.

Same in-memory-schema fixture pattern as test_wave4_search_evolution.py.
"""
import sqlite3

import pytest

from api.services.journal_two.db import ensure_schema
from api.services.journal_two.notes import (
    NoteValidationError,
    add_favorite,
    get_note,
    list_favorites,
    list_recents,
    record_note_opened,
    remove_favorite,
)


def _conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    return c


def _insert_note(c, note_id, user_id="u1", title="", created_at="2026-01-01T00:00:00+00:00",
                  deleted_at=None):
    c.execute(
        "INSERT INTO j2_notes (id, user_id, title, body_json, body_plain,"
        " tags, created_at, updated_at, deleted_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (note_id, user_id, title, '{"type":"doc","content":[]}', "",
         "[]", created_at, created_at, deleted_at),
    )
    c.commit()


# ── Schema ───────────────────────────────────────────────────────────────────

def test_favorites_and_recents_tables_and_indexes_exist():
    c = _conn()
    tables = {r["name"] for r in c.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    assert "j2_note_favorites" in tables
    assert "j2_note_recents" in tables
    idx = {r["name"] for r in c.execute(
        "SELECT name FROM sqlite_master WHERE type='index'")}
    assert "idx_j2_note_favorites_user" in idx
    assert "idx_j2_note_recents_user" in idx


# ── Favorites ────────────────────────────────────────────────────────────────

def test_add_favorite_then_list():
    c = _conn()
    _insert_note(c, "n1", title="First")
    add_favorite("u1", "n1", conn=c)
    favs = list_favorites("u1", conn=c)
    assert [f["id"] for f in favs] == ["n1"]


def test_add_favorite_is_idempotent():
    c = _conn()
    _insert_note(c, "n1")
    add_favorite("u1", "n1", conn=c)
    add_favorite("u1", "n1", conn=c)  # must not raise IntegrityError
    favs = list_favorites("u1", conn=c)
    assert len(favs) == 1


def test_add_favorite_on_missing_note_raises_validation_error():
    c = _conn()
    with pytest.raises(NoteValidationError):
        add_favorite("u1", "nonexistent", conn=c)


def test_add_favorite_on_another_users_note_raises_validation_error():
    """Tenant isolation: cannot favorite a note you don't own, even if the id
    is guessed correctly."""
    c = _conn()
    _insert_note(c, "n1", user_id="u2")
    with pytest.raises(NoteValidationError):
        add_favorite("u1", "n1", conn=c)


def test_remove_favorite():
    c = _conn()
    _insert_note(c, "n1")
    add_favorite("u1", "n1", conn=c)
    remove_favorite("u1", "n1", conn=c)
    assert list_favorites("u1", conn=c) == []


def test_remove_favorite_on_never_favorited_note_is_a_safe_noop():
    c = _conn()
    _insert_note(c, "n1")
    remove_favorite("u1", "n1", conn=c)  # must not raise
    assert list_favorites("u1", conn=c) == []


def test_favorites_are_tenant_isolated():
    c = _conn()
    _insert_note(c, "n1", user_id="u1")
    _insert_note(c, "n2", user_id="u2")
    add_favorite("u1", "n1", conn=c)
    add_favorite("u2", "n2", conn=c)
    assert [f["id"] for f in list_favorites("u1", conn=c)] == ["n1"]
    assert [f["id"] for f in list_favorites("u2", conn=c)] == ["n2"]


def test_favoriting_a_trashed_note_is_rejected():
    """Favoriting is only ever exposed on an open (non-trashed) note in the
    UI, and the backend enforces the same rule."""
    c = _conn()
    _insert_note(c, "n1", deleted_at="2026-02-01T00:00:00+00:00")
    with pytest.raises(NoteValidationError):
        add_favorite("u1", "n1", conn=c)


def test_trashing_a_favorited_note_hides_it_from_the_list_without_deleting_the_row():
    c = _conn()
    _insert_note(c, "n1")
    add_favorite("u1", "n1", conn=c)
    c.execute("UPDATE j2_notes SET deleted_at = ? WHERE id = ?",
              ("2026-02-01T00:00:00+00:00", "n1"))
    c.commit()
    assert list_favorites("u1", conn=c) == []
    # the underlying row survives the trash -- restoring un-hides it with no
    # extra reconciliation
    still_there = c.execute(
        "SELECT 1 FROM j2_note_favorites WHERE user_id = ? AND note_id = ?",
        ("u1", "n1"),
    ).fetchone()
    assert still_there is not None


def test_restoring_a_favorited_note_reinstates_it_in_the_list():
    c = _conn()
    _insert_note(c, "n1", deleted_at=None)
    add_favorite("u1", "n1", conn=c)
    c.execute("UPDATE j2_notes SET deleted_at = ? WHERE id = ?",
              ("2026-02-01T00:00:00+00:00", "n1"))
    c.execute("UPDATE j2_notes SET deleted_at = NULL WHERE id = ?", ("n1",))
    c.commit()
    assert [f["id"] for f in list_favorites("u1", conn=c)] == ["n1"]


def test_hard_deleting_a_note_cascades_the_favorite_row_via_trigger():
    c = _conn()
    _insert_note(c, "n1")
    add_favorite("u1", "n1", conn=c)
    c.execute("DELETE FROM j2_notes WHERE id = ?", ("n1",))
    c.commit()
    row = c.execute(
        "SELECT 1 FROM j2_note_favorites WHERE note_id = ?", ("n1",)
    ).fetchone()
    assert row is None


def test_get_note_reports_is_favorite_true_and_false():
    c = _conn()
    _insert_note(c, "n1")
    _insert_note(c, "n2")
    add_favorite("u1", "n1", conn=c)
    assert get_note("u1", "n1", conn=c)["isFavorite"] is True
    assert get_note("u1", "n2", conn=c)["isFavorite"] is False


def test_favorites_list_ordered_most_recently_favorited_first():
    c = _conn()
    _insert_note(c, "n1")
    _insert_note(c, "n2")
    c.execute("INSERT INTO j2_note_favorites (user_id, note_id, created_at) VALUES (?,?,?)",
              ("u1", "n1", "2026-01-01T00:00:00+00:00"))
    c.execute("INSERT INTO j2_note_favorites (user_id, note_id, created_at) VALUES (?,?,?)",
              ("u1", "n2", "2026-01-02T00:00:00+00:00"))
    c.commit()
    assert [f["id"] for f in list_favorites("u1", conn=c)] == ["n2", "n1"]


def test_favorites_respect_limit():
    c = _conn()
    for i in range(5):
        _insert_note(c, f"n{i}")
        add_favorite("u1", f"n{i}", conn=c)
    assert len(list_favorites("u1", limit=3, conn=c)) == 3


# ── Recents ──────────────────────────────────────────────────────────────────

def test_record_note_opened_then_list():
    c = _conn()
    _insert_note(c, "n1")
    record_note_opened("u1", "n1", conn=c)
    recents = list_recents("u1", conn=c)
    assert [r["id"] for r in recents] == ["n1"]


def test_record_note_opened_is_idempotent_and_updates_recency():
    c = _conn()
    _insert_note(c, "n1")
    _insert_note(c, "n2")
    c.execute("INSERT INTO j2_note_recents (user_id, note_id, opened_at) VALUES (?,?,?)",
              ("u1", "n1", "2026-01-01T00:00:00+00:00"))
    c.execute("INSERT INTO j2_note_recents (user_id, note_id, opened_at) VALUES (?,?,?)",
              ("u1", "n2", "2026-01-02T00:00:00+00:00"))
    c.commit()
    # re-opening n1 bumps it back to the top, and there is still exactly one
    # row for it (no duplicate PK violation)
    record_note_opened("u1", "n1", conn=c)
    recents = list_recents("u1", conn=c)
    assert [r["id"] for r in recents] == ["n1", "n2"]
    count = c.execute(
        "SELECT COUNT(*) c FROM j2_note_recents WHERE user_id='u1' AND note_id='n1'"
    ).fetchone()["c"]
    assert count == 1


def test_recording_open_on_a_nonexistent_note_does_not_raise():
    """The endpoint layer never validates ownership up front (best-effort
    beacon, must never break note viewing) -- the service layer matches that
    contract: it does not raise on an unknown note id."""
    c = _conn()
    record_note_opened("u1", "ghost", conn=c)  # must not raise


def test_recents_are_tenant_isolated_even_when_note_id_is_guessed():
    """A row keyed on a foreign note_id never joins into that user's list --
    the join requires n.user_id = r.user_id, so it can never surface another
    tenant's note even if a note_id collision were engineered."""
    c = _conn()
    _insert_note(c, "n1", user_id="u2")
    record_note_opened("u1", "n1", conn=c)  # u1 "opens" a note it doesn't own
    assert list_recents("u1", conn=c) == []
    assert list_recents("u2", conn=c) == []


def test_trashing_a_recent_note_hides_it_without_deleting_the_row():
    c = _conn()
    _insert_note(c, "n1")
    record_note_opened("u1", "n1", conn=c)
    c.execute("UPDATE j2_notes SET deleted_at = ? WHERE id = ?",
              ("2026-02-01T00:00:00+00:00", "n1"))
    c.commit()
    assert list_recents("u1", conn=c) == []
    still_there = c.execute(
        "SELECT 1 FROM j2_note_recents WHERE user_id = ? AND note_id = ?",
        ("u1", "n1"),
    ).fetchone()
    assert still_there is not None


def test_hard_deleting_a_note_cascades_the_recent_row_via_trigger():
    c = _conn()
    _insert_note(c, "n1")
    record_note_opened("u1", "n1", conn=c)
    c.execute("DELETE FROM j2_notes WHERE id = ?", ("n1",))
    c.commit()
    row = c.execute(
        "SELECT 1 FROM j2_note_recents WHERE note_id = ?", ("n1",)
    ).fetchone()
    assert row is None


def test_recents_capped_at_limit_even_with_more_history():
    c = _conn()
    for i in range(12):
        _insert_note(c, f"n{i}")
        record_note_opened("u1", f"n{i}", conn=c)
    assert len(list_recents("u1", conn=c)) == 8  # RECENTS_DEFAULT_LIMIT
    assert len(list_recents("u1", limit=3, conn=c)) == 3


def test_recents_ordered_most_recently_opened_first():
    c = _conn()
    _insert_note(c, "n1")
    _insert_note(c, "n2")
    c.execute("INSERT INTO j2_note_recents (user_id, note_id, opened_at) VALUES (?,?,?)",
              ("u1", "n1", "2026-01-01T00:00:00+00:00"))
    c.execute("INSERT INTO j2_note_recents (user_id, note_id, opened_at) VALUES (?,?,?)",
              ("u1", "n2", "2026-01-02T00:00:00+00:00"))
    c.commit()
    assert [r["id"] for r in list_recents("u1", conn=c)] == ["n2", "n1"]
