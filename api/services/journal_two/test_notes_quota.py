"""Import media budget. The reserve is DERIVED from disk_watchdog.CRIT_PCT
applied to the volume's measured total (see notes_quota.py's docstring) --
these tests pin the BEHAVIOUR (refuse when short on room, and track the
watchdog's own threshold), not a number invented at planning time."""
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


def test_refusal_boundary_moves_with_the_disk_watchdog_threshold(monkeypatch):
    """The reserve must be DERIVED from disk_watchdog.CRIT_PCT, not copied --
    tightening or loosening that ONE threshold has to move this guard's
    refusal boundary automatically, or the two components silently disagree
    about "how full is too full" for the same volume (the review-round-1
    finding this test exists to close)."""
    from api.services import disk_watchdog
    from api.services.journal_two import notes_quota

    monkeypatch.delenv("NOTE_IMPORT_RESERVE_BYTES", raising=False)
    monkeypatch.setattr(notes_quota, "_total_bytes", lambda: 100 * 1024**3)  # 100 GB volume
    monkeypatch.setattr(notes_quota, "_free_bytes", lambda: 12 * 1024**3)    # 12 GB free

    # CRIT_PCT=90 -> required reserve = 10 GB. 12 GB free clears a 10 GB floor.
    monkeypatch.setattr(disk_watchdog, "CRIT_PCT", 90)
    assert notes_quota.assert_import_headroom(1) is None

    # Tighten the SAME shared threshold to CRIT_PCT=80 -> required reserve
    # becomes 20 GB. The identical 12 GB free must now be refused, with no
    # change to notes_quota's own code or config -- only the watchdog moved.
    monkeypatch.setattr(disk_watchdog, "CRIT_PCT", 80)
    with pytest.raises(NoteQuotaExceeded):
        notes_quota.assert_import_headroom(1)
