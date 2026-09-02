"""Import media budget for the notebook attachment volume.

The volume also holds 20+ SQLite DBs on a single-replica pod. Filling it is
not a note-level error, it is an outage -- so this guard FAILS CLOSED: if
free space cannot be determined, the import is refused.

RESERVE_BYTES measurement (2026-09-01, `tools/notebook_volume_report.py`,
run LOCALLY per the wave-0 safety rule -- never against the production pod,
which double-loads the api stack beside uvicorn and has already caused
member-visible OOM outages twice):

    attachment root : \\data\\j2_attachments
                      (does not exist yet -- measured nearest existing
                      ancestor: C:\\data)
    files           : 0
    attachment bytes: 0 (0.00 GB)
    volume total    : 499.28 GB
    volume free     : 167.12 GB

That is this Windows workstation's C: drive (no `/data` volume exists here,
and `DATA_DIR`/`J2_ATTACHMENT_ROOT` are unset), NOT the Railway volume this
guard actually protects -- it is not a usable proxy for the production
volume's total capacity. 2 GiB is kept as RESERVE_BYTES: it is a trivial
~1.2% of the measured local headroom (so it never spuriously blocks local
dev/testing), and it is in the same order of magnitude as this repo's own
previously-*measured* incident data for this exact volume class
(`api/services/disk_watchdog.py`'s 2026-07-23 incident: a 46GB `/data`
volume, WARN at 75% used / CRIT at 90% used -- i.e. as little as ~4.6GB free
is already "critical" on that volume). A 2GiB reserve sits inside that
critical band, so this guard is a first line of defense that trips before
the volume-wide watchdog would even reach WARN in normal operation.
**This number should be re-derived against the real production volume**
(e.g. `railway ssh` + `PYTHONPATH=/app python tools/notebook_volume_report.py`,
which this session's local-only safety constraint did not permit) as soon
as that is safe to run -- see the wave ledger / task-4 report for the flagged
follow-up. Override via `NOTE_IMPORT_RESERVE_BYTES` without a code change.
"""
from __future__ import annotations

import os
import shutil

from .attachment_root import attachment_root as _attachment_root

# Headroom that must remain free AFTER an import completes. Derived from
# tools/notebook_volume_report.py -- see the docstring above and the wave
# ledger for the measurement.
RESERVE_BYTES = int(os.environ.get("NOTE_IMPORT_RESERVE_BYTES", 2 * 1024**3))


class NoteQuotaExceeded(Exception):
    """Not enough room on the attachment volume to accept this import."""


def _free_bytes() -> int:
    return shutil.disk_usage(_attachment_root()).free


def volume_headroom() -> dict:
    try:
        free = _free_bytes()
    except OSError as e:
        return {"ok": False, "error": str(e)}
    return {"ok": True, "free_bytes": free, "reserve_bytes": RESERVE_BYTES}


def assert_import_headroom(bytes_wanted: int) -> None:
    """Raises NoteQuotaExceeded unless the volume can take `bytes_wanted`
    and still keep RESERVE_BYTES free."""
    try:
        free = _free_bytes()
    except OSError as e:
        raise NoteQuotaExceeded(f"cannot read volume free space: {e}") from e
    if free - max(0, bytes_wanted) < RESERVE_BYTES:
        raise NoteQuotaExceeded(
            f"import needs {bytes_wanted:,}B; only {free:,}B free with a "
            f"{RESERVE_BYTES:,}B reserve")
