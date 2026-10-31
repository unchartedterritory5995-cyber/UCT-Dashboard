# -*- coding: utf-8 -*-
"""The ONE place the support loop keeps anything on disk, and how it is purged.

Spec: ``docs/pine/support-loop/PHASE-B.md`` ("Privacy").

    <repo>/.support-loop-work/            gitignored (/.support-loop-work/ in .gitignore)
        DO-NOT-COMMIT.txt                  says what this is
        reports/<report id>/               ⛔ MEMBER CONTENT: source.pine, note.txt, the door's
                                           answer (out.jsonl, which quotes refused lines) and
                                           the fix packet. DELETED when the report is closed.
        gaps/<name>/                       probes we wrote + the door's answer + the packet.
                                           Quotes reference-only corpus lines (local cache,
                                           never committed), so it is gitignored too.

⛔⛔ A MEMBER'S SOURCE IS WRITTEN BY ``write_report_file`` AND NOWHERE ELSE, and that
function refuses any path that does not resolve under ``reports/<id>/`` of the work
root. The CLI never prints source, never logs it, and keeps the door's console
output in the report's own directory.

``SUPPORT_LOOP_WORK`` moves the root (for tests, or a temp drive); a root inside a
git checkout must be one git ignores, which ``check_root`` asks git itself.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
ENV = "SUPPORT_LOOP_WORK"
_ID_RE = re.compile(r"[0-9a-f]{32}")
_GAP_RE = re.compile(r"[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*){0,2}")

MARKER = ("Pine support loop working directory (docs/pine/support-loop/PHASE-B.md).\n"
          "TEMPORARY. Holds member script source under reports/<id>/ while a report is open;\n"
          "each report directory is deleted when the report is closed. Never commit, copy or\n"
          "share anything from here.\n")


class WorkdirError(RuntimeError):
    pass


def root() -> Path:
    return Path(os.environ.get(ENV) or (REPO / ".support-loop-work")).resolve()


def check_root(r: Path | None = None) -> Path:
    """Create the root and prove it is not committable: inside a git checkout, git
    must report it ignored."""
    r = (r or root()).resolve()
    r.mkdir(parents=True, exist_ok=True)
    try:
        inside = subprocess.run(["git", "-C", str(r), "rev-parse", "--is-inside-work-tree"],
                                capture_output=True, text=True, timeout=20).stdout.strip() == "true"
    except (OSError, subprocess.SubprocessError):
        inside = False
    if inside:
        probe = r / "reports" / ("0" * 32) / "source.pine"
        res = subprocess.run(["git", "-C", str(r), "check-ignore", "-q", str(probe)],
                             capture_output=True, timeout=20)
        if res.returncode != 0:
            raise WorkdirError(f"refusing: work root {r} is inside a git checkout and NOT ignored")
    m = r / "DO-NOT-COMMIT.txt"
    if not m.exists():
        m.write_text(MARKER, encoding="utf-8")
    return r


def report_dir(report_id: str) -> Path:
    if not isinstance(report_id, str) or not _ID_RE.fullmatch(report_id):
        raise WorkdirError("not a report id")
    return root() / "reports" / report_id


def gap_dir(name: str) -> Path:
    if not isinstance(name, str) or not _GAP_RE.fullmatch(name):
        raise WorkdirError("not a Pine built-in name")
    return root() / "gaps" / name


def _inside(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def write_report_file(report_id: str, filename: str, text: str) -> Path:
    """⛔ THE ONLY WRITER OF MEMBER CONTENT. ``filename`` is a bare name; the
    resolved path must sit directly in ``reports/<report_id>/``."""
    d = report_dir(report_id)
    check_root()
    d.mkdir(parents=True, exist_ok=True)
    p = d / (filename or "")
    # ⭐ ONE guard, not two (lesson_a_guard_repeated_is_a_guard_unproved): the RESOLVED
    # path's parent must be the report directory itself. That alone refuses "", ".",
    # "..", "../x", "sub/x", an absolute path and a drive-qualified one.
    if p.resolve().parent != d.resolve():
        raise WorkdirError("path escapes the report directory")
    tmp = p.with_name(p.name + ".tmp")
    with open(tmp, "w", encoding="utf-8", newline="") as f:
        f.write(text)
    os.replace(tmp, p)
    return p


def write_gap_file(name: str, filename: str, text: str) -> Path:
    d = gap_dir(name)
    if not filename or os.path.basename(filename) != filename:
        raise WorkdirError("bare file names only")
    check_root()
    d.mkdir(parents=True, exist_ok=True)
    p = d / filename
    tmp = p.with_name(p.name + ".tmp")
    with open(tmp, "w", encoding="utf-8", newline="") as f:
        f.write(text)
    os.replace(tmp, p)
    return p


def purge_report(report_id: str) -> bool:
    """Delete everything kept for one report. True when something was deleted."""
    d = report_dir(report_id)
    if not d.exists():
        return False
    if not _inside(d, root() / "reports"):
        raise WorkdirError("refusing to delete outside the reports directory")
    shutil.rmtree(d)
    return True


def open_report_ids() -> list[str]:
    base = root() / "reports"
    if not base.exists():
        return []
    return sorted(p.name for p in base.iterdir() if p.is_dir() and _ID_RE.fullmatch(p.name))
