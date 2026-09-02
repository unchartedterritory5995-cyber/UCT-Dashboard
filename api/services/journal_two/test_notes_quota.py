"""Import media budget. The reserve is DERIVED from disk_watchdog.CRIT_PCT
applied to the volume's measured total (see notes_quota.py's docstring) --
these tests pin the BEHAVIOUR (refuse when short on room, and track the
watchdog's own threshold), not a number invented at planning time."""
import pytest

from api.services import disk_watchdog
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


def test_first_upload_succeeds_when_the_attachment_root_does_not_exist_yet(
    tmp_path, monkeypatch,
):
    """Regression (review round 2, production bug): a fresh volume -- or
    simply "before any attachment has ever been written" -- means the
    attachment root directory itself doesn't exist yet. That is NOT the same
    fact as "free space cannot be determined": free space is a property of
    the VOLUME, not of one leaf directory, so a member's first-ever upload
    must succeed, not get refused with a message about free space. This
    fails against code that calls shutil.disk_usage() directly on the
    (nonexistent) attachment root -- it must resolve to the nearest existing
    ancestor first."""
    from api.services.journal_two import notes_quota

    missing_root = tmp_path / "j2_attachments"  # deliberately never created
    assert not missing_root.exists()
    monkeypatch.setattr(notes_quota, "_attachment_root", lambda: missing_root)
    monkeypatch.delenv("NOTE_IMPORT_RESERVE_BYTES", raising=False)
    # A near-100 CRIT_PCT keeps the derived reserve a sliver of whatever real
    # free space tmp_path's filesystem happens to have -- this test is about
    # the ancestor-walk fix, not about sizing the test machine's disk.
    monkeypatch.setattr(disk_watchdog, "CRIT_PCT", 99.999)

    notes_quota.assert_import_headroom(10)  # must not raise


def test_guard_still_fails_closed_when_the_ancestor_walk_cannot_answer(monkeypatch):
    """The round-2 fix (resolve to the nearest existing ancestor before
    calling disk_usage) must not weaken fail-closed for a genuine I/O
    failure -- unlike the other fail-closed test above, this exercises the
    real _disk_usage()/_existing_ancestor() path rather than stubbing
    _free_bytes directly."""
    from api.services.journal_two import notes_quota

    def boom(_path):
        raise OSError("volume unreadable")

    monkeypatch.setattr(notes_quota.shutil, "disk_usage", boom)
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
