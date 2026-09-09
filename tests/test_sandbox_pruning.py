"""The test sandbox has to clean up after itself.

⛔⛔ WHY THIS EXISTS. Every pytest session mints two directories under TEMP and
nothing ever removed them. The product then WARMS them — a sandboxed run writes
bars caches, ticker metadata and ~20 SQLite databases — so one session costs
~200 MB, not a few KB.

Measured 2026-09-08 on the dev box: **5,209 directories, 13.14 GB, system drive
at ZERO bytes free.** And it did not present as "the disk is full". It presented
as `notes_quota.assert_import_headroom` refusing every attachment upload with
HTTP 400, i.e. twelve red tests in the documents and excerpts routers that read
exactly like a defect in the attachment path — and are not one.

⭐ A guard nobody has seen fire is not a guard (`lesson_gate_that_cannot_fail`),
so these run the pruner against a throwaway directory and watch it act, rather
than asserting that the real TEMP happens to be tidy.
"""
from __future__ import annotations

import os
import time

import conftest


def _aged(path: str, seconds: float) -> None:
    old = time.time() - seconds
    os.utime(path, (old, old))


class TestThePruner:
    def test_it_removes_a_sandbox_older_than_the_ttl(self, tmp_path, monkeypatch):
        monkeypatch.setattr(conftest.tempfile, "gettempdir", lambda: str(tmp_path))
        stale = tmp_path / "uct_tests_datadir_stale"
        stale.mkdir()
        (stale / "bars.db").write_bytes(b"x" * 128)
        _aged(str(stale), conftest.SANDBOX_TTL_SECONDS + 60)
        conftest._prune_stale_sandboxes()
        assert not stale.exists()

    def test_it_leaves_a_RECENT_one_alone(self, tmp_path, monkeypatch):
        # ⛔ THE LOAD-BEARING HALF. Another agent, or another terminal, may be
        # running a suite against its own sandbox right now. Reclaiming space
        # must never reach into a live session.
        monkeypatch.setattr(conftest.tempfile, "gettempdir", lambda: str(tmp_path))
        live = tmp_path / "uct_tests_authdb_live"
        live.mkdir()
        (live / "auth.db").write_bytes(b"x")
        conftest._prune_stale_sandboxes()
        assert live.exists()

    def test_it_touches_nothing_that_is_not_ours(self, tmp_path, monkeypatch):
        monkeypatch.setattr(conftest.tempfile, "gettempdir", lambda: str(tmp_path))
        theirs = tmp_path / "pytest-of-someone-else"
        theirs.mkdir()
        _aged(str(theirs), conftest.SANDBOX_TTL_SECONDS * 10)
        conftest._prune_stale_sandboxes()
        assert theirs.exists(), "the pruner reached outside its own prefixes"

    def test_it_covers_BOTH_directories_a_session_mints(self):
        # A pruner that knew only about one prefix would leave half the litter
        # behind, and the auth sandbox is the one holding a ~1 GB-class DB.
        assert set(conftest.SANDBOX_PREFIXES) == {
            "uct_tests_authdb_", "uct_tests_datadir_"}

    def test_an_unremovable_directory_never_fails_the_run(self, tmp_path, monkeypatch):
        monkeypatch.setattr(conftest.tempfile, "gettempdir", lambda: str(tmp_path))
        stale = tmp_path / "uct_tests_datadir_locked"
        stale.mkdir()
        _aged(str(stale), conftest.SANDBOX_TTL_SECONDS + 60)

        def boom(*a, **k):
            raise OSError("in use")

        monkeypatch.setattr(conftest.os, "getmtime", boom, raising=False)
        monkeypatch.setattr(conftest.os.path, "getmtime", boom)
        conftest._prune_stale_sandboxes()  # must not raise


class TestTheAttachmentReservePin:
    """⛔ The other half of the same story: the sandbox is not the volume.

    `notes_quota` derives its reserve as a PERCENTAGE OF THE VOLUME, sized for
    Railway's 78 GB attachment volume (~7.8 GB). Under pytest the attachment
    root lands in the sandbox above, whose volume is the developer's 499 GB
    system drive — so the same formula demands ~50 GB free and every upload
    test 400s. Twelve router tests failed that way, and they read exactly like
    a defect in the attachment path.
    """

    def test_the_pin_is_in_effect_under_pytest(self):
        assert os.environ.get("NOTE_IMPORT_RESERVE_BYTES") == str(64 * 1024**2)

    def test_but_the_DERIVATION_is_still_there_and_still_wins_when_unset(
            self, monkeypatch):
        # ⭐ THE NON-VACUITY CONTROL. A pin that silently replaced the
        # derivation would make `test_notes_quota.py`'s boundary tests assert
        # nothing — so prove the real formula still answers when the override
        # is removed, exactly as production sees it.
        from api.services import disk_watchdog
        from api.services.journal_two import notes_quota
        monkeypatch.delenv("NOTE_IMPORT_RESERVE_BYTES", raising=False)
        monkeypatch.setattr(notes_quota, "_total_bytes", lambda: 100 * 1024**3)
        monkeypatch.setattr(disk_watchdog, "CRIT_PCT", 90)
        assert notes_quota._required_reserve_bytes() == 10 * 1024**3

    def test_and_an_upload_is_still_refused_when_the_volume_is_genuinely_full(
            self, monkeypatch):
        from api.services.journal_two import notes_quota
        monkeypatch.setattr(notes_quota, "_free_bytes", lambda: 1024)
        with __import__("pytest").raises(notes_quota.NoteQuotaExceeded):
            notes_quota.assert_import_headroom(1)
