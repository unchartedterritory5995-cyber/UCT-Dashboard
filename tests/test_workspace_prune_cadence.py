"""Speed follow-up 2026-11-16: how often a Charts board save pays for the retention prune.

Production ``[prefs-slow]`` lines put a slow board save's wall time in the step that runs
``write_pref_checked``. Reproduced locally (a 40 KB board with 2,000 versions), ~86% of that step's
CPU was the ``prune_versions`` that followed EVERY append: it re-reads ``created_at`` for up to
``PRUNE_SCAN_ROWS`` versions, and that column sits after each version's document.

``WORKSPACE_PRUNE_EVERY`` = N runs the opportunistic prune only after an append whose new version
is a multiple of N. Unset, or anything unusable, = after every append, exactly as before. What the
prune keeps is unchanged; only how often a save pays to ask.
"""
from __future__ import annotations

import sqlite3

import pytest

from api.services import workspace_doc_store as wds

USER = "u-prune-cadence"
BOARD = wds.BOARD_CHARTS
T0 = 1_790_000_000


@pytest.fixture
def armed(tmp_path, monkeypatch):
    """An armed store in tmp_path; returns the list of head versions each prune ran at."""
    monkeypatch.setattr(wds, "_DB_PATH", str(tmp_path / "workspace_docs.db"))
    monkeypatch.setenv(wds.ENABLED_ENV, "1")
    monkeypatch.delenv(wds.PRUNE_EVERY_ENV, raising=False)
    monkeypatch.setattr(wds, "_clock", lambda: T0)
    ran_at: list[int] = []
    real = wds.prune_versions

    def spy(user_id, board_id, now, **kw):
        ran_at.append(wds.head(user_id, board_id)["version"])
        return real(user_id, board_id, now, **kw)

    monkeypatch.setattr(wds, "prune_versions", spy)
    return ran_at


def _checked_saves(n: int) -> list[int]:
    """n saves on the path a revision-aware Charts tab takes; the versions they appended."""
    out = []
    for i in range(n):
        h = wds.head(USER, BOARD)
        res = wds.write_pref_checked(USER, "charts_workspace_groups", f'["g{i}"]',
                                     base_version=h["version"] if h else 0, prefs_reader=lambda uid: {})
        assert res["appended"] is True
        out.append(res["version"])
    return out


def _mirrored_saves(n: int) -> None:
    """n saves on the mirrored path (a tab without revisions)."""
    for i in range(n):
        ticket = wds.begin_pref_write(USER, "charts_theme", lambda uid: {})
        wds.finish_pref_write(ticket, f"theme-{i}")


def _row_count() -> int:
    con = sqlite3.connect(wds._DB_PATH)
    try:
        return con.execute("SELECT COUNT(*) FROM workspace_doc_versions WHERE user_id=? AND board_id=?",
                           (USER, BOARD)).fetchone()[0]
    finally:
        con.close()


def test_unset_prunes_after_every_save_as_before(armed):
    appended = _checked_saves(5)
    assert armed == appended


def test_every_n_prunes_only_after_versions_that_are_multiples_of_n(armed, monkeypatch):
    monkeypatch.setenv(wds.PRUNE_EVERY_ENV, "3")
    appended = _checked_saves(7)
    expected = [v for v in appended if v % 3 == 0]
    assert expected, "the fixture must cross at least one multiple of N or this proves nothing"
    assert armed == expected
    assert len(armed) < len(appended)


def test_the_mirrored_path_follows_the_same_cadence(armed, monkeypatch):
    monkeypatch.setenv(wds.PRUNE_EVERY_ENV, "2")
    _mirrored_saves(5)
    head = wds.head(USER, BOARD)["version"]
    assert armed == [v for v in range(1, head + 1) if v % 2 == 0], (armed, head)


@pytest.mark.parametrize("raw, expected", [
    (None, 1), ("", 1), ("0", 1), ("-4", 1), ("abc", 1), ("2.5", 1), (" 7 ", 7), ("20", 20),
    (str(wds.PRUNE_MAX_PER_CALL + 150), wds.PRUNE_MAX_PER_CALL),
])
def test_unusable_values_mean_every_save_and_n_is_capped(monkeypatch, raw, expected):
    if raw is None:
        monkeypatch.delenv(wds.PRUNE_EVERY_ENV, raising=False)
    else:
        monkeypatch.setenv(wds.PRUNE_EVERY_ENV, raw)
    assert wds._prune_every() == expected


def test_a_backlog_still_drains_and_never_exceeds_the_bound_by_more_than_n(armed, monkeypatch):
    """Retention is unchanged in what it keeps: between prunes a board grows by at most N-1."""
    monkeypatch.setattr(wds, "RETAIN_NEWEST", 2)
    monkeypatch.setattr(wds, "RETAIN_CEILING", 2)
    monkeypatch.setenv(wds.PRUNE_EVERY_ENV, "3")
    appended = _checked_saves(10)
    assert len(appended) == 10
    assert armed, "no prune ran at all"
    assert _row_count() <= 2 + (3 - 1), _row_count()
