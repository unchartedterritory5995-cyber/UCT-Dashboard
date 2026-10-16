"""`member_interest._watchlist_syms` against a REAL seeded auth.db.

⛔ The bug this rails: the prebuilt community lists (S&P 500, Russell 2000, Sunday Scans, ... --
`watchlist_prebuilt.seed_prebuilt_watchlists`) are ordinary `watchlists` rows OWNED by the first
`ADMIN_EMAILS` account that exists, flagged `is_prebuilt = 1`. `_watchlist_syms` selected every list
the user owned, so that one admin's "own names" were the whole index universe: the earnings
follow-up producer rang them three bells a day for reporters they never chose, and the prep list and
the Calendar's My Stocks listed the same. Found by the Tier 2 part B walk #2
(`docs/notebook/evidence/t2b-walk2-20261015T234317/`, `followup.setup`: two members notified where
one was expected; the second was the sandbox admin, through `S&P 500` / `S&P 100` / `Sunday Scans`).
`passed_setups.py` already excludes prebuilt lists with the same predicate.

Every other test of this module MOCKS the source readers, so none of them could see it -- these seed
the real schema (`auth_db._SCHEMA`) in a temp DATA_DIR and read through the real function.
"""
from __future__ import annotations

import sqlite3

import pytest

from api.services import auth_db
from api.services import member_interest as mi


def _list(conn, wid, user_id, name, syms, *, prebuilt=0, flagged=0):
    conn.execute(
        "INSERT INTO watchlists (id, user_id, name, is_public, is_flagged_list, is_prebuilt) VALUES (?,?,?,?,?,?)",
        (wid, user_id, name, 1 if prebuilt else 0, flagged, prebuilt),
    )
    for i, s in enumerate(syms):
        conn.execute("INSERT INTO watchlist_items (id, watchlist_id, sym, sort_order) VALUES (?,?,?,?)",
                     (f"{wid}-{i}", wid, s, i))


@pytest.fixture
def seeded_data_dir(tmp_path, monkeypatch):
    conn = sqlite3.connect(tmp_path / "auth.db")
    try:
        conn.executescript(auth_db._SCHEMA)
        # The admin who owns the community lists, and also keeps one list of their own.
        _list(conn, "pb-sp500", "admin-a", "S&P 500", ["ORCL", "AAPL", "MSFT"], prebuilt=1)
        _list(conn, "pb-scans", "admin-a", "Sunday Scans - October 11, 2026", ["CRWV", "NVDA"], prebuilt=1)
        _list(conn, "own-a", "admin-a", "My setups", ["nvda", "PLTR"])
        _list(conn, "flag-a", "admin-a", "Flagged", ["HOOD"], flagged=1)
        # A member with only their own list.
        _list(conn, "own-m", "member-m", "Follow-up walk", ["ORCL"])
        conn.commit()
    finally:
        conn.close()
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    return tmp_path


def test_the_admin_who_owns_the_community_lists_gets_only_their_own_names(seeded_data_dir):
    # NVDA is in a prebuilt list AND the admin's own list: it stays, from the own list.
    assert mi._watchlist_syms("admin-a") == {"NVDA", "PLTR", "HOOD"}


def test_a_name_only_in_a_prebuilt_list_is_never_the_owners(seeded_data_dir):
    got = mi._watchlist_syms("admin-a")
    assert not ({"ORCL", "AAPL", "MSFT", "CRWV"} & got)


def test_a_member_keeps_their_own_list(seeded_data_dir):
    assert mi._watchlist_syms("member-m") == {"ORCL"}


def test_a_legacy_row_with_a_null_prebuilt_flag_is_the_members_own(seeded_data_dir):
    conn = sqlite3.connect(seeded_data_dir / "auth.db")
    try:
        _list(conn, "legacy-m", "member-m", "Old list", ["AMD"])
        conn.execute("UPDATE watchlists SET is_prebuilt = NULL WHERE id = 'legacy-m'")
        conn.commit()
    finally:
        conn.close()
    assert mi._watchlist_syms("member-m") == {"ORCL", "AMD"}


def test_CONTROL_the_prebuilt_rows_are_really_there_and_owned_by_the_admin(seeded_data_dir):
    # Non-vacuity: the exclusion above is only evidence if the prebuilt rows exist under that owner.
    conn = sqlite3.connect(seeded_data_dir / "auth.db")
    try:
        n = conn.execute("SELECT COUNT(*) FROM watchlist_items wi JOIN watchlists w ON w.id = wi.watchlist_id"
                         " WHERE w.user_id = 'admin-a' AND w.is_prebuilt = 1").fetchone()[0]
    finally:
        conn.close()
    assert n == 5


def test_the_follow_up_and_prep_member_sets_inherit_the_exclusion(seeded_data_dir, monkeypatch):
    # The consumer that rang the bells: earnings_prep._member_sets (the follow-up producer delegates to it).
    from api.services.journal_two import earnings_prep
    monkeypatch.setattr(mi, "_position_syms", lambda uid: set())
    monkeypatch.setattr(mi, "_uct20_syms", lambda uid: set())
    import api.services.journal_two.positions as positions
    monkeypatch.setattr(positions, "list_open_positions", lambda uid: [])
    mine = earnings_prep._member_sets("admin-a")
    assert "ORCL" not in mine and "NVDA" in mine
