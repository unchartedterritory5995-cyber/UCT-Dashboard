"""Orphaned note-attachment GC (Journal Widgets — panel batch 3, CEO finding).

Every embed re-capture clears `fallback` and uploads a NEW PNG; removing an
embed or an inline image leaves its file behind; deleting a note leaves its
whole directory. Nothing has ever deleted these files, so the attachments
tree on the web volume grows monotonically with use. This sweep removes
attachment files that no note references any more.

Safety posture (each line is load-bearing):
- The reference set is USER-WIDE, not per-note: an embed copy-pasted from
  note A into note B keeps A's fallback URL, so judging A's directory only
  against A's body would delete B's archive image.
- Only files named like our own uploads (32-hex uuid + short extension) are
  ever candidates — anything hand-placed or legacy-shaped is left alone.
- Age gate (default 48h): an upload always lands BEFORE the autosave that
  references it, and a failed autosave can retry for a while. Young files
  are never touched.
- `dry_run` reports what WOULD be deleted — with example paths, not just
  counts — and removes nothing.

Runs web-side (the attachments tree and auth.db are web-local). The nightly
cron ships dark behind J2_ATTACHMENT_GC_ENABLED=1; the admin endpoint
(`POST /api/j2/notes/attachments/gc`, dry_run default TRUE) works either way.

The R2 backup (api/j2_attachments_backup.py) tars the CURRENT tree nightly —
it never restores on boot, so GC'd files simply stop appearing in future
tarballs; older tarballs still hold them until retention prunes those.
"""

from __future__ import annotations

import os
import re
import sqlite3
import time
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two import notes as notes_mod

# Our uploads are uuid4().hex + a short extension (save_note_image_bytes /
# save_note_attachment_bytes). Candidates must match EXACTLY this shape.
_UPLOAD_NAME_RE = re.compile(r"^[0-9a-f]{32}\.[A-Za-z0-9]{1,5}$")
# The same shape ANYWHERE in a note body / hero URL / inbox row marks the
# file as referenced. Matching on the filename (globally unique) instead of
# the full URL survives any future change to the URL prefix.
_REF_RE = re.compile(r"[0-9a-f]{32}\.[A-Za-z0-9]{1,5}")

_SUBS = ("inline", "hero", "file")
_EXAMPLE_CAP = 40


def _referenced_names(conn: sqlite3.Connection, user_id: str) -> set[str]:
    """Every upload filename any of this user's notes (raw body_json text +
    hero URL) or inbox captures still references."""
    names: set[str] = set()
    for row in conn.execute(
        "SELECT body_json, hero_image_url FROM j2_notes WHERE user_id = ?", (user_id,)
    ):
        for text in (row["body_json"], row["hero_image_url"]):
            if text:
                names.update(_REF_RE.findall(text))
    for row in conn.execute(
        "SELECT fallback_url FROM j2_capture_inbox WHERE user_id = ?", (user_id,)
    ):
        if row["fallback_url"]:
            names.update(_REF_RE.findall(row["fallback_url"]))
    return names


def sweep_orphaned_attachments(
    *,
    min_age_hours: float = 48.0,
    dry_run: bool = False,
    user_id: str | None = None,
    conn: sqlite3.Connection | None = None,
    now: float | None = None,
) -> dict[str, Any]:
    """Walk the attachments tree, delete unreferenced upload files older than
    the age gate. Returns a report; never raises for per-file trouble."""
    root = notes_mod._ATTACHMENT_ROOT
    now = now if now is not None else time.time()
    cutoff = now - float(min_age_hours) * 3600.0
    report: dict[str, Any] = {
        "dry_run": bool(dry_run),
        "min_age_hours": float(min_age_hours),
        "users": 0,
        "files_scanned": 0,
        "orphaned": 0,
        "deleted": 0,
        "skipped_young": 0,
        "freed_bytes": 0,
        "examples": [],
    }
    if not root.is_dir():
        return report

    owned = conn is None
    conn = conn or get_connection()
    try:
        user_dirs = (
            [root / user_id] if user_id else sorted(p for p in root.iterdir() if p.is_dir())
        )
        for udir in user_dirs:
            if not udir.is_dir():
                continue
            report["users"] += 1
            referenced = _referenced_names(conn, udir.name)
            notes_dir = udir / "notes"
            if not notes_dir.is_dir():
                continue
            for ndir in sorted(p for p in notes_dir.iterdir() if p.is_dir()):
                for sub in _SUBS:
                    sdir = ndir / sub
                    if not sdir.is_dir():
                        continue
                    for f in sorted(p for p in sdir.iterdir() if p.is_file()):
                        report["files_scanned"] += 1
                        if not _UPLOAD_NAME_RE.match(f.name):
                            continue  # not one of ours — never touch it
                        if f.name in referenced:
                            continue
                        report["orphaned"] += 1
                        try:
                            st = f.stat()
                        except OSError:
                            continue
                        if st.st_mtime > cutoff:
                            report["skipped_young"] += 1
                            continue
                        if len(report["examples"]) < _EXAMPLE_CAP:
                            report["examples"].append(
                                str(f.relative_to(root)).replace(os.sep, "/")
                            )
                        if dry_run:
                            continue
                        try:
                            f.unlink()
                            report["deleted"] += 1
                            report["freed_bytes"] += st.st_size
                        except OSError:
                            continue
                    # Fold up now-empty directories (best-effort, inside-out).
                    if not dry_run:
                        for d in (sdir, ndir):
                            try:
                                d.rmdir()
                            except OSError:
                                break
        return report
    finally:
        if owned:
            conn.close()


def register_jobs(scheduler) -> bool:
    """Nightly sweep, 03:40 ET Mon-Sat, dark unless J2_ATTACHMENT_GC_ENABLED=1.
    Sits after the 02:45 attachments backup on purpose: the last tarball taken
    before a sweep still contains everything the sweep removes."""
    if os.environ.get("J2_ATTACHMENT_GC_ENABLED", "0") != "1":
        return False
    from zoneinfo import ZoneInfo
    from apscheduler.triggers.cron import CronTrigger

    def _job() -> None:
        try:
            rep = sweep_orphaned_attachments()
            print(
                "[j2-attachment-gc] scanned=%s orphaned=%s deleted=%s freed=%.1fMB skipped_young=%s"
                % (
                    rep["files_scanned"], rep["orphaned"], rep["deleted"],
                    rep["freed_bytes"] / 1e6, rep["skipped_young"],
                )
            )
        except Exception as e:  # noqa: BLE001 — a failed sweep must never break the scheduler
            print(f"[j2-attachment-gc] sweep failed: {e}")

    scheduler.add_job(
        _job,
        CronTrigger(day_of_week="mon-sat", hour=3, minute=40, timezone=ZoneInfo("America/New_York")),
        id="j2_attachment_gc",
        max_instances=1,
        coalesce=True,
    )
    return True
