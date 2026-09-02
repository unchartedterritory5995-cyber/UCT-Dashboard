"""Import media budget for the notebook attachment volume.

The volume also holds 20+ SQLite DBs on a single-replica pod. Filling it is
not a note-level error, it is an outage -- so this guard FAILS CLOSED: if
free space cannot be determined, the import is refused.

RESERVE DERIVATION (fixed 2026-09-01, review round 1). The previous version of
this file set `RESERVE_BYTES = 2 * 1024**3` and justified it by reasoning
about a DIFFERENT volume's incident history (`disk_watchdog.py`'s 46GB `/data`
volume anecdote) plus a local Windows-drive measurement (499GB total / 167GB
free) that was never the production volume either -- so the number was
byte-identical to the brief's own placeholder, not actually re-derived.

The real production volume was then measured (2026-09-01, `railway ssh
--service web`, a read-only stdlib-only probe -- no app import, never run on
the pod otherwise):

    volume total 78.42 GB, free 63.57 GB, used 18.9%
    /data/j2_attachments: 30 files, 6,231,885 bytes (0.006 GB)
    /data/journal_screenshots and /data/attachments do not exist

Rather than restate a fresh constant beside that number, the reserve is now
DERIVED from `disk_watchdog.py`, which already owns the answer to "how full is
too full for THIS volume" (`CRIT_PCT`, env `DISK_WATCHDOG_CRIT_PCT`, default
90 -- read live off the module, never copied, so tightening or loosening that
one threshold moves this guard automatically instead of two components
silently disagreeing about the same volume):

    required_reserve = (1 - CRIT_PCT / 100) * volume_total_bytes

At CRIT_PCT=90 against the measured 78.42 GB volume that is ~7.84 GB -- an
import is refused once it would leave less than ~7.84 GB free, i.e. right
before disk_watchdog itself would go critical on the same volume.

`NOTE_IMPORT_RESERVE_BYTES` remains an explicit override that always wins
when set (no code change needed to raise/lower it). `_ABSOLUTE_FLOOR_BYTES` is
a fallback used ONLY if the volume's TOTAL size specifically cannot be read
(free space is checked separately by `assert_import_headroom` and fails
closed entirely on its own if IT cannot be read).

FAIL-CLOSED FIX (review round 2, 2026-09-01): `_free_bytes`/`_total_bytes`
used to call `shutil.disk_usage()` directly on the attachment root. On a
fresh volume -- or simply before any attachment has ever been written --
that directory doesn't exist, `disk_usage()` raises `FileNotFoundError`, and
the guard refused a MEMBER'S FIRST-EVER UPLOAD with a message about free
space. "The directory does not exist yet" is not "I cannot determine free
space" -- free space is a property of the VOLUME, not of one leaf directory,
so the nearest existing ancestor's answer is the correct answer, not an
approximation. Both functions now route through
`attachment_root.existing_ancestor()` (shared with the read-only
`tools/notebook_volume_report.py`, which used this same resolution first --
one authority instead of two copies) before ever calling `disk_usage`. A
genuinely unreadable volume still raises OSError and still fails closed.
"""
from __future__ import annotations

import os
import shutil

from api.services import disk_watchdog

from .attachment_root import (
    attachment_root as _attachment_root,
    existing_ancestor as _existing_ancestor,
)

# Fallback only -- see _required_reserve_bytes(). Not the primary derivation.
_ABSOLUTE_FLOOR_BYTES = 2 * 1024**3


class NoteQuotaExceeded(Exception):
    """Not enough room on the attachment volume to accept this import."""


def _disk_usage():
    """One shared read for both free and total bytes. Resolves to the nearest
    EXISTING ancestor of the attachment root first (see
    attachment_root.existing_ancestor) -- free space is a property of the
    VOLUME, not of a leaf directory that may not exist yet (a fresh volume,
    or before the first attachment has ever been written). Only a genuine
    can't-tell-you condition (e.g. the volume itself is unreachable) reaches
    callers as OSError; a merely-not-yet-created attachment directory does
    not."""
    return shutil.disk_usage(_existing_ancestor(_attachment_root()))


def _free_bytes() -> int:
    return _disk_usage().free


def _total_bytes() -> int:
    return _disk_usage().total


def _required_reserve_bytes() -> int:
    """Headroom that must remain free AFTER an import completes.

    `NOTE_IMPORT_RESERVE_BYTES` wins outright when set. Otherwise this is
    DERIVED from `disk_watchdog.CRIT_PCT` applied to the volume's real total
    size -- read live off the disk_watchdog module (not copied), so raising
    or lowering that ONE threshold moves this guard automatically instead of
    the two components silently disagreeing about the same volume. Falls
    back to a fixed floor only if the volume's total size specifically
    cannot be read.
    """
    override = os.environ.get("NOTE_IMPORT_RESERVE_BYTES")
    if override is not None:
        return int(override)
    try:
        total = _total_bytes()
    except OSError:
        return _ABSOLUTE_FLOOR_BYTES
    crit_pct = disk_watchdog.CRIT_PCT
    return max(0, int(round((1 - crit_pct / 100.0) * total)))


def volume_headroom() -> dict:
    try:
        free = _free_bytes()
    except OSError as e:
        return {"ok": False, "error": str(e)}
    return {"ok": True, "free_bytes": free, "reserve_bytes": _required_reserve_bytes()}


def assert_import_headroom(bytes_wanted: int) -> None:
    """Raises NoteQuotaExceeded unless the volume can take `bytes_wanted`
    and still keep the required reserve free (see _required_reserve_bytes,
    derived from disk_watchdog.CRIT_PCT)."""
    try:
        free = _free_bytes()
    except OSError as e:
        raise NoteQuotaExceeded(f"cannot read volume free space: {e}") from e
    reserve = _required_reserve_bytes()
    if free - max(0, bytes_wanted) < reserve:
        raise NoteQuotaExceeded(
            f"import needs {bytes_wanted:,}B; only {free:,}B free with a "
            f"{reserve:,}B reserve")
