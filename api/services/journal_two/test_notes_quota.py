"""Import media budget. The threshold comes from tools/notebook_volume_report.py
-- these tests pin the BEHAVIOUR (refuse when short on room), not a number
invented at planning time."""
import pytest

from api.services.journal_two.notes_quota import (
    NoteQuotaExceeded, assert_import_headroom,
)


def test_import_is_refused_when_free_space_is_below_the_floor(monkeypatch):
    from api.services.journal_two import notes_quota
    monkeypatch.setattr(notes_quota, "_free_bytes", lambda: 100)
    with pytest.raises(NoteQuotaExceeded):
        assert_import_headroom(10_000)


def test_import_proceeds_with_ample_room(monkeypatch):
    from api.services.journal_two import notes_quota
    monkeypatch.setattr(notes_quota, "_free_bytes", lambda: 500 * 1024**3)
    assert_import_headroom(10_000) is None


def test_guard_fails_closed_when_the_volume_cannot_be_read(monkeypatch):
    """If we cannot tell how much room is left, refuse. Filling the volume
    that holds 20+ SQLite DBs is a member-visible outage, not a note error."""
    from api.services.journal_two import notes_quota

    def boom():
        raise OSError("volume unreadable")

    monkeypatch.setattr(notes_quota, "_free_bytes", boom)
    with pytest.raises(NoteQuotaExceeded):
        assert_import_headroom(1)
