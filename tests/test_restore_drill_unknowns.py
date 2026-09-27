"""⛔ THE WEEKLY RESTORE DRILL CANNOT PASS ON AN UNKNOWN (wave 10, lane 10C, fix round 1 item 4).

The drill is S-1's monitor. It could say PASS on two unknowns:
  * the R-9 half only FAILed when a tombstoned account was still present; when the off-site
    tombstones could not be READ (no store, a list error, a file drilled with no credentials)
    it stayed PASS -- only `--write-restored` refused. Now an unread set is INCONCLUSIVE in
    every mode: without it the drill cannot know whether the snapshot brings someone back.
  * the attachments half sampled whatever tarball was newest and never asked its age. A
    stopped nightly job stops its prune too, so the last tarball stays newest forever and the
    drill passed on it every week. Now it FAILs past 2 x the job's LONGEST scheduled gap,
    derived from the job's own trigger (`j2_attachments_backup.SCHEDULE`), stated in the report.
Plus the scheduled task's report folder is created by the drill before it writes.
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import shutil
import sqlite3
from pathlib import Path

import pytest

from api import j2_attachments_backup as ab
from api.services import account_tombstones as at
from tools import authdb_restore_drill as drill

NOW = dt.datetime(2026, 9, 27, 13, 0, 0, tzinfo=dt.timezone.utc)   # a Sunday, 09:00 ET
SNAP = "20260927T060000Z.db.gz"                                       # 7 h before NOW


def _args(**kw):
    base = dict(file=None, list=False, report=None, keep=False)
    base.update(kw)
    return argparse.Namespace(**base)


def _backup(tmp: Path) -> Path:
    db = tmp / "src.db"
    c = sqlite3.connect(db)
    for t in drill.REQUIRED_TABLES:
        if t == "j2_notes":
            c.execute("CREATE TABLE j2_notes (id TEXT, updated_at TEXT)")
            c.execute("INSERT INTO j2_notes VALUES ('n1', '2026-09-27T05:59:00Z')")
        else:
            c.execute(f'CREATE TABLE "{t}" (id TEXT)')
            c.execute(f'INSERT INTO "{t}" VALUES (\'x\')')
    c.commit()
    c.close()
    gz = tmp / SNAP
    with open(db, "rb") as f_in, gzip.open(gz, "wb") as f_out:
        shutil.copyfileobj(f_in, f_out)
    db.unlink()
    return gz


class _Unreadable:
    def list_keys(self, prefix):
        raise ConnectionError("planted: the bucket did not answer")


# ── the tombstone half: an unread set is never a pass ───────────────────────────────────────

def test_a_drill_that_could_not_read_the_tombstones_is_INCONCLUSIVE(tmp_path, capsys):
    code = drill.run(_args(file=str(_backup(tmp_path))), now=NOW)          # no store at all
    out = capsys.readouterr().out
    assert code == drill.INCONCLUSIVE, out
    assert "off-site tombstones were not read" in out and "VERDICT: INCONCLUSIVE" in out


def test_a_store_that_errors_is_INCONCLUSIVE_too(tmp_path, capsys):
    code = drill.run(_args(file=str(_backup(tmp_path))), now=NOW, store=_Unreadable())
    out = capsys.readouterr().out
    assert code == drill.INCONCLUSIVE and "planted" in out, out


def test_control_a_readable_store_lets_the_same_backup_pass(tmp_path, capsys):
    code = drill.run(_args(file=str(_backup(tmp_path))), now=NOW,
                     store=at.LocalObjectStore(tmp_path / "store"))
    assert code == drill.PASS, capsys.readouterr().out


# ── the attachments half: a stale tarball fails, and the rule is derived and stated ─────────

class _Attachments:
    """The bucket's attachment listing: one tarball with a LastModified, downloadable."""

    def __init__(self, tarball: Path, modified: dt.datetime | None):
        self.tarball, self.modified = tarball, modified
        self.downloaded = []

    def list_objects_v2(self, **kw):
        o = {"Key": f"{ab._PREFIX}{self.tarball.name}", "Size": self.tarball.stat().st_size}
        if self.modified is not None:
            o["LastModified"] = self.modified
        return {"Contents": [o]}

    def download_file(self, bucket, key, dest):
        self.downloaded.append(key)
        shutil.copyfile(self.tarball, dest)


def _tarball(tmp: Path) -> Path:
    root = tmp / "tree"
    (root / "u1" / "d").mkdir(parents=True)
    (root / "u1" / "d" / "a.png").write_bytes(b"an image")
    gz = tmp / "j2-attachments-2026-09-26.tar.gz"
    ab._make_tarball(root, gz)
    return gz


def test_the_freshness_limit_is_derived_from_the_jobs_own_schedule(monkeypatch):
    assert ab.longest_gap_hours() == 48.0            # Mon-Sat: the Saturday -> Monday hole
    f = drill.attachment_freshness(NOW - dt.timedelta(hours=30), NOW)
    assert f["limit_hours"] == 96.0 and f["fresh"] and "longest scheduled gap (48 h" in f["rule"]
    # a schedule change moves the limit with it -- nothing is retyped
    monkeypatch.setattr(ab, "SCHEDULE", {"day_of_week": "*", "hour": 2, "minute": 45})
    assert ab.longest_gap_hours() == 24.0
    assert drill.attachment_freshness(NOW, NOW)["limit_hours"] == 48.0


def test_a_STALE_newest_tarball_FAILS_and_says_why(tmp_path):
    client = _Attachments(_tarball(tmp_path), NOW - dt.timedelta(days=9))
    att = drill.attachment_check(client, "b", tmp_path, now=NOW)
    assert att["verdict"] == "FAIL", att
    assert "the nightly backup has stopped" in att["why"] and "216 h old" in att["why"]
    assert "limit 96 h" in att["why"]


def test_control_a_FRESH_tarball_passes(tmp_path):
    client = _Attachments(_tarball(tmp_path), NOW - dt.timedelta(hours=30))   # Saturday 02:45 ET
    work = tmp_path / "work"
    work.mkdir()
    att = drill.attachment_check(client, "b", work, now=NOW)
    assert att["verdict"] == "PASS", att
    assert att["freshness"]["fresh"] and client.downloaded


def test_a_listing_with_no_time_is_INCONCLUSIVE_never_a_pass(tmp_path):
    att = drill.attachment_check(_Attachments(_tarball(tmp_path), None), "b", tmp_path, now=NOW)
    assert att["verdict"] == "INCONCLUSIVE" and "freshness cannot be judged" in att["why"]


def test_the_report_states_the_freshness_rule(tmp_path, capsys):
    client = _Attachments(_tarball(tmp_path), NOW - dt.timedelta(days=9))
    code = drill.run(_args(file=str(_backup(tmp_path)), attachments=True), client=client, bucket="b",
                     now=NOW, store=at.LocalObjectStore(tmp_path / "store"))
    out = capsys.readouterr().out
    assert code == drill.FAIL
    assert "- freshness: 216 h old -- limit 96 h = 2 x the backup job's longest scheduled gap" in out


# ── the scheduled task's report folder ──────────────────────────────────────────────────────

def test_the_report_folder_is_created_before_the_write(tmp_path):
    report = tmp_path / "soak-drills" / "nested" / "drill-2026-09-27.md"
    assert not report.parent.exists()
    drill.run(_args(file=str(_backup(tmp_path)), report=str(report)), now=NOW,
              store=at.LocalObjectStore(tmp_path / "store"))
    assert report.is_file() and "# auth.db restore drill - PASS" in report.read_text(encoding="utf-8")
