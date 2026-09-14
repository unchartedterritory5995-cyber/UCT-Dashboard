"""The public-repo hygiene gate: no oversized file, no `.env*`, enforced by tooling rather than memory.

Written after the 2026-09-13 restart capture, where 19 checkouts were committed in bulk and three files
had to be withheld by hand (a 77 MB database backup, a 6.5 MB fixture, an env file). "Never `git add -A`"
is a rule nobody can enforce at 2 a.m.; this is the version a machine enforces.
"""
from __future__ import annotations

import os
import subprocess
import sys

import pytest

from tools import check_repo_hygiene as hyg

ROOT = hyg.repo_root(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def test_the_repo_is_clean_today():
    rc, msg = hyg.check(ROOT)
    assert rc == 0, msg


def test_the_gate_reports_a_planted_oversized_file_and_a_planted_env(tmp_path):
    """⛔ NON-VACUITY. Without this, `test_the_repo_is_clean_today` passes for a gate that
    reports nothing at all."""
    big = tmp_path / "planted.bin"
    big.write_bytes(b"\0" * (hyg.MAX_BYTES + 1))
    (tmp_path / ".env.planted").write_text("SECRET=x", encoding="utf-8")
    (tmp_path / "small.py").write_text("x = 1", encoding="utf-8")
    found = hyg.violations(str(tmp_path), ["planted.bin", ".env.planted", "small.py"])
    assert len(found) == 2
    assert any("planted.bin" in v and "MB exceeds" in v for v in found)
    assert any(".env.planted" in v for v in found)


def test_an_allowlisted_file_is_exempt_and_the_allowlist_is_exact(tmp_path):
    (tmp_path / ".env.example").write_text("KEY=", encoding="utf-8")
    assert hyg.violations(str(tmp_path), [".env.example"]) == []
    # A near-miss name is NOT exempt: the allowlist is exact paths, never a prefix.
    (tmp_path / ".env.example.local").write_text("KEY=", encoding="utf-8")
    assert hyg.violations(str(tmp_path), [".env.example.local"])
    for rel in sorted(hyg.BIG_ALLOWLIST):
        assert os.path.exists(os.path.join(ROOT, rel)), (
            f"{rel} is allowlisted but no longer exists — drop it from BIG_ALLOWLIST rather than "
            "leaving an entry that can silently start covering a new file at that path")


def test_a_scan_that_cannot_run_refuses_instead_of_passing(tmp_path):
    """Not a git repository at all: `git ls-files` fails. The gate must exit 2 (could not run),
    never 0 (clean)."""
    rc, msg = hyg.check(str(tmp_path))
    assert rc == 2 and "could not list files" in msg


def test_a_scan_that_succeeds_but_finds_almost_nothing_also_refuses(tmp_path):
    """⛔ THE SEPARATE HALF, and a mutation caught that it had no rail: a real repo with a handful of
    files answers SUCCESSFULLY with a near-empty list — a wrong cwd inside some other checkout. Only
    MIN_TRACKED distinguishes that from a clean scan, so it needs its own case."""
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True, timeout=60)
    (tmp_path / "one.py").write_text("x = 1", encoding="utf-8")
    subprocess.run(["git", "-C", str(tmp_path), "add", "one.py"], check=True, timeout=60)
    subprocess.run(["git", "-C", str(tmp_path), "-c", "user.email=t@t", "-c", "user.name=t",
                    "commit", "-qm", "one"], check=True, timeout=60)
    assert hyg.tracked_files(str(tmp_path)) == ["one.py"], "the control: git answered, with one file"
    rc, msg = hyg.check(str(tmp_path))
    assert rc == 2 and "REFUSING TO PASS" in msg and "expected >=" in msg


# ── line endings: they must match the blob git already stores (owner ruling R-2) ──────────────

LF = b"a\nb\nc\n"
CRLF = b"a\r\nb\r\nc\r\n"
MIXED = b"a\r\nb\nc\r\n"          # the real shape of docs/plans/joystick/deferred.md


@pytest.mark.parametrize("stored,incoming,why", [
    (LF, CRLF, "an LF blob rewritten CRLF"),
    (CRLF, LF, "a CRLF blob flattened to LF — the direction that bit twice"),
    (MIXED, LF, "a MIXED blob flattened — a style comparison calls both sides 'crlf' and misses it"),
    (None, CRLF, "a NEW file arriving CRLF, when this repo stores LF"),
])
def test_a_line_ending_flip_is_reported(stored, incoming, why):
    assert hyg.eol_violation("x.md", stored, incoming) is not None, why


@pytest.mark.parametrize("stored,incoming,why", [
    (LF, LF, "unchanged"),
    (CRLF, CRLF, "unchanged, and CRLF is correct for a CRLF-stored file"),
    (None, LF, "a new LF file"),
    (LF, b"a\nB\nc\nd\n", "a REAL edit — endings are not the only difference"),
    (CRLF, b"a\r\nB\r\nc\r\nd\r\n", "a real edit on a CRLF-stored file"),
    (LF, b"\x89PNG\x00\r\n", "binary: a NUL in the first 8 kB means the endings are not text"),
    (LF, b"one line", "no newline at all — nothing to compare"),
])
def test_the_check_stays_quiet_on_everything_legitimate(stored, incoming, why):
    """⛔ HALF THE PROOF. A check that fires on the right answer gets muted inside a week, and then
    it protects nothing — which is exactly why this is not a bare "contains CRLF" ban."""
    assert hyg.eol_violation("x.md", stored, incoming) is None, why


def test_a_new_crlf_file_may_be_allowlisted_and_the_allowlist_is_exact():
    assert hyg.eol_violation("app/public/flow-data.csv", None, CRLF) is None
    assert hyg.eol_violation("app/public/flow-data.csv.bak", None, CRLF) is not None, (
        "the allowlist is exact paths, never a prefix")


def test_every_allowlisted_crlf_path_still_exists_and_is_still_crlf():
    """An allowlist entry for a file that moved silently starts covering whatever lands at that
    path next (`lesson_a_gate_list_drifts_like_any_other_artifact`)."""
    for rel in sorted(hyg.CRLF_ALLOWED):
        blob = hyg._blob(ROOT, f"HEAD:{rel}")
        assert blob is not None, f"{rel} is in CRLF_ALLOWED but git holds nothing there"
        assert b"\r\n" in blob, (
            f"{rel} is no longer CRLF in git — drop it from CRLF_ALLOWED rather than leaving an "
            "entry that would wave through a new CRLF file at that path")


def test_the_line_ending_check_actually_examined_something():
    """⛔ NON-VACUITY, and it is the one that matters here: `eol_violations` walks CHANGED paths, so
    on a clean tree it inspects nothing and returns [] — indistinguishable from a working check.
    This proves it can still see a flip in the REAL repository, using the blob git holds today."""
    rel = sorted(hyg.CRLF_ALLOWED)[0]
    stored = hyg._blob(ROOT, f"HEAD:{rel}")
    assert stored and b"\r\n" in stored, "the fixture this rail depends on is no longer CRLF"
    assert hyg.eol_violation(rel, stored, stored.replace(b"\r", b"")) is not None
    assert hyg.eol_violations(ROOT, staged=True) == [], "nothing staged should be flipped right now"


def test_the_self_check_passes_as_a_subprocess():
    p = subprocess.run([sys.executable, "tools/check_repo_hygiene.py", "--self-check"], cwd=ROOT,
                       capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180)
    assert p.returncode == 0, p.stdout + p.stderr
    assert "SELF-CHECK PASSED" in (p.stdout + p.stderr)


@pytest.mark.parametrize("args,expect_rc", [([], 0), (["--staged"], 0)])
def test_both_modes_run_as_a_subprocess(args, expect_rc):
    p = subprocess.run([sys.executable, "tools/check_repo_hygiene.py", *args], cwd=ROOT,
                       capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180)
    assert p.returncode == expect_rc, p.stdout + p.stderr
