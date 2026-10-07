"""UCT Terminal graduation: every EXISTING member joins the terminal-next cohort once.

Owner decision 2026-10-05 (re-confirmed 2026-10-07). New signups are enrolled at
signup (tests/test_signup_joins_terminal_cohort.py); this covers everyone before,
via a one-shot boot step gated by a DATA_DIR marker written only on success.
"""
from __future__ import annotations

import ast
import os
import pathlib
import sqlite3
from unittest.mock import patch

import pytest

from api.services import rollout, rollout_gate

_REPO = pathlib.Path(__file__).resolve().parents[1]

_SCHEMA = """
CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, role TEXT);
CREATE TABLE user_tags (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    tag TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, tag)
);
"""


@pytest.fixture()
def db(monkeypatch):
    """An in-memory auth.db with the two tables the writer touches (same shape as
    tests/test_rollout.py's fixture, whose rail pins it to auth_db's DDL)."""
    real = sqlite3.connect(":memory:")
    real.row_factory = sqlite3.Row
    real.executescript(_SCHEMA)
    for uid, role in (("u-member", "member"), ("u-admin", "admin"), ("u-pro", "member")):
        real.execute("INSERT INTO users (id, email, role) VALUES (?,?,?)",
                     (uid, uid + "@x.test", role))
    real.commit()

    class _KeepOpen:
        def __init__(self, c): self._c = c
        def close(self): pass
        def __getattr__(self, name): return getattr(self._c, name)

    proxy = _KeepOpen(real)
    monkeypatch.setattr(rollout._auth_db, "get_connection", lambda: proxy)
    return proxy


def _marker(d):
    return os.path.join(str(d), rollout_gate.TERMINAL_NEXT_SEED_MARKER)


def test_enrolls_every_existing_member(db, tmp_path):
    assert rollout.cohort_user_ids(rollout_gate.TERMINAL_NEXT_COHORT) == set()
    added = rollout_gate.seed_existing_members_into_terminal_next(str(tmp_path))
    assert added == 3
    assert rollout.cohort_user_ids(rollout_gate.TERMINAL_NEXT_COHORT) == {
        "u-member", "u-admin", "u-pro"}


def test_keeps_members_already_enrolled_and_counts_only_new_rows(db, tmp_path):
    rollout_gate.enroll_in_terminal_next("u-member")   # a signup-time enrolment
    added = rollout_gate.seed_existing_members_into_terminal_next(str(tmp_path))
    assert added == 2
    assert len(rollout.cohort_user_ids(rollout_gate.TERMINAL_NEXT_COHORT)) == 3


def test_writes_the_marker_only_after_success(db, tmp_path):
    assert not os.path.exists(_marker(tmp_path))
    rollout_gate.seed_existing_members_into_terminal_next(str(tmp_path))
    assert os.path.exists(_marker(tmp_path))


def test_a_failed_write_leaves_no_marker_and_raises(tmp_path):
    with patch("api.services.rollout.seed_cohort_all_members",
               side_effect=RuntimeError("auth.db locked")):
        with pytest.raises(RuntimeError):
            rollout_gate.seed_existing_members_into_terminal_next(str(tmp_path))
    assert not os.path.exists(_marker(tmp_path))


def test_never_runs_twice(tmp_path):
    with patch("api.services.rollout.seed_cohort_all_members", return_value=5) as w:
        assert rollout_gate.seed_existing_members_into_terminal_next(str(tmp_path)) == 5
        assert rollout_gate.seed_existing_members_into_terminal_next(str(tmp_path)) is None
        assert rollout_gate.seed_existing_members_into_terminal_next(str(tmp_path)) is None
    w.assert_called_once_with("terminal-next")


def test_idempotent_against_the_real_writer_even_without_the_marker(db, tmp_path):
    """If the marker were lost, a re-run adds nothing (INSERT OR IGNORE)."""
    rollout_gate.seed_existing_members_into_terminal_next(str(tmp_path))
    os.remove(_marker(tmp_path))
    assert rollout_gate.seed_existing_members_into_terminal_next(str(tmp_path)) == 0
    assert len(rollout.cohort_user_ids(rollout_gate.TERMINAL_NEXT_COHORT)) == 3


def test_reuses_the_seed_all_writer_not_a_second_one():
    src = (_REPO / "api" / "services" / "rollout_gate.py").read_text(encoding="utf-8")
    body = src[src.index("def seed_existing_members_into_terminal_next"):]
    body = body[:body.index("\ndef ")]
    assert "rollout.seed_cohort_all_members(TERMINAL_NEXT_COHORT)" in body
    assert ".execute(" not in body and "get_connection" not in body


def test_boot_runs_it_on_a_daemon_thread_inside_lifespan():
    """Wiring rail: the seed is started from the lifespan, on a daemon thread, and the
    call is wrapped so a failure can never break startup."""
    src = (_REPO / "api" / "main.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    lifespan = next(n for n in ast.walk(tree)
                    if isinstance(n, ast.AsyncFunctionDef) and n.name == "lifespan")
    seg = ast.get_source_segment(src, lifespan)
    assert "seed_existing_members_into_terminal_next()" in seg
    i = seg.index("seed_existing_members_into_terminal_next()")
    window = seg[max(0, i - 600):i + 900]
    assert "daemon=True" in window and "Thread(" in window
    assert "except Exception" in window
    # control: the probe can see a sibling boot step it is not looking for
    assert "ensure_s7_dark_seeded()" in seg
