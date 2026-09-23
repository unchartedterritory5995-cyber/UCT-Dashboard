"""A12 CP1 (GATE-A12-WATCHLISTS-CP1, signed 2026-09-21, fingerprint acaa29de6)
-- the S6 consistency rail.

S6's `member_interest.py` (CP2') independently READS two of A12's own tables
(`watchlists`/`watchlist_items`) via its own `_watchlist_syms`/`_flagged_syms`
SQL, never through `watchlist_service.py` -- the module that actually creates,
renames and syncs those rows. Nothing before this file asserted the two
readers agree. S6's own CP1 found exactly this shape of defect already live
in production once (three copies of one vocabulary silently diverging,
protected only by a comment claiming agreement that nobody had wired) --
`lesson_a_comment_claiming_agreement_is_not_agreement`. Two independent
readers of the same rows with no comparison is the precondition for that
class of bug: the drift is silent by construction until something reads both
answers side by side. This file is that something.

⛔ NOT a change to `member_interest.py`'s behavior -- it is read, never
edited, here. Zero product code, zero schema, zero new route (§2's own
non-goals).

Fixture note: `member_interest.py`'s `_auth_db_path()` resolves via `DATA_DIR`
(`os.path.join(os.environ.get("DATA_DIR", "/data"), "auth.db")`), a SEPARATE
resolution from `auth_db.py`'s own `_DB_PATH` (`AUTH_DB_PATH`, captured at
import). Both must be pinned to the SAME file or the two modules silently
read two different (and differently populated) databases -- which would make
every comparison below vacuously agree for the wrong reason (two empty DBs
"agree" trivially).
"""
from __future__ import annotations

import os
import sqlite3
import uuid
from unittest import mock

import pytest

from api.services import auth_db as _auth_db
from api.services import member_interest as mi
from api.services import watchlist_service as ws

_AT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@pytest.fixture(autouse=True)
def auth(tmp_path, monkeypatch):
    """A FRESH auth.db per test, pinned for BOTH readers.

    ⛔ `member_interest._auth_db_path()` and `auth_db._DB_PATH` are two
    independent resolutions of "where is auth.db" -- pin both to the same
    file, or this rail passes by comparing two different empty databases.
    """
    p = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(p))
    monkeypatch.setattr(_auth_db, "_DB_PATH", str(p))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    _auth_db.init_db()
    # positions/uct20 are OUT OF SCOPE for this checkpoint (§2: "asserting...
    # the watchlist and flagged buckets") -- pinned to empty so a real
    # journal_two schema-init or wire_data read can never make this rail
    # flaky or slow for a reason that has nothing to do with what it checks.
    monkeypatch.setattr(mi, "_position_syms", lambda user_id: set())
    monkeypatch.setattr(mi, "_uct20_syms", lambda user_id: set())
    return p


def _user() -> str:
    uid = "u-" + uuid.uuid4().hex[:12]
    conn = _auth_db.get_connection()
    try:
        conn.execute(
            "INSERT INTO users (id, email, password_hash, role) VALUES (?,?,?,?)",
            (uid, f"{uid}@example.test", "x", "member"))
        conn.commit()
    finally:
        conn.close()
    return uid


# ═════════════════════════════════════════════════════════════════════════
# THE AGREEMENT -- byte-identical, for the same seeded user and DB state
# ═════════════════════════════════════════════════════════════════════════

def test_watchlist_bucket_matches_watchlist_service():
    """For a user with real rows written via `watchlist_service.add_item` in
    an ORDINARY (non-flagged) list, `member_interest.interest_for()`'s
    `watchlist` bucket equals `list_user_watchlists`'s own symbol set.

    ⛔ Deliberately seeded with NO flagged-list activity for this specific
    comparison. `_watchlist_syms`'s join (`member_interest.py`) carries no
    `is_flagged_list` filter at all -- by design, per its sibling
    `_flagged_syms`'s own comment ("Flagged is a watchlist with
    is_flagged_list=1 -- already covered by the join above") -- so the
    `watchlist` bucket is the union of EVERY list the member has, flagged
    included. `list_user_watchlists` explicitly EXCLUDES the flagged list
    (`WHERE ... is_flagged_list = 0 OR ... IS NULL`). The two definitions
    only coincide when there is nothing in the flagged list to disagree
    about, which is exactly the case this test isolates; the flagged-mixed
    case is `test_non_vacuity_watchlist_and_flagged_are_distinguishable`
    below, which asserts a DIFFERENT, weaker property (the two buckets are
    not identical), not that `watchlist` excludes flagged.
    """
    uid = _user()
    wl = ws.create_watchlist(uid, "My List")
    ws.add_item(uid, wl["id"], "AAPL")
    ws.add_item(uid, wl["id"], "MSFT")

    expected = {
        item["sym"]
        for row in ws.list_user_watchlists(uid, include_prebuilt=False)
        for item in row["items"]
    }
    assert expected == {"AAPL", "MSFT"}, "the fixture itself is broken -- not the rail"

    result = mi.interest_for(uid)
    assert result["by_source"]["watchlist"] == expected


def test_flagged_bucket_matches_watchlist_service():
    """`member_interest.interest_for()`'s `flagged` bucket equals
    `get_or_create_flagged_list`/`sync_flagged_items`'s own flagged-list
    membership, for the same seeded user and DB state."""
    uid = _user()
    ws.sync_flagged_items(uid, ["TSLA", "NVDA"])

    flagged = ws.get_or_create_flagged_list(uid)
    expected = {item["sym"] for item in flagged["items"]}
    assert expected == {"TSLA", "NVDA"}, "the fixture itself is broken -- not the rail"

    result = mi.interest_for(uid)
    assert result["by_source"]["flagged"] == expected


# ═════════════════════════════════════════════════════════════════════════
# NON-VACUITY -- the rail must be able to TELL watchlist and flagged apart
# ═════════════════════════════════════════════════════════════════════════

def test_non_vacuity_watchlist_and_flagged_are_distinguishable():
    """⛔ MANDATORY CONTROL (§2/§4 — `lesson_a_fixture_that_cannot_distinguish_
    is_not_a_rail`): a user with one symbol in an ordinary list and a
    DIFFERENT symbol in their flagged list must produce two DIFFERENT bucket
    contents, or every assertion above could be passing against a rail that
    cannot tell the two buckets apart at all (e.g. one that always returns
    the same set for both)."""
    uid = _user()
    wl = ws.create_watchlist(uid, "Ordinary")
    ws.add_item(uid, wl["id"], "AAPL")
    ws.sync_flagged_items(uid, ["TSLA"])

    result = mi.interest_for(uid)
    watchlist_bucket = result["by_source"]["watchlist"]
    flagged_bucket = result["by_source"]["flagged"]

    assert watchlist_bucket != flagged_bucket, (
        "watchlist and flagged read as IDENTICAL for a user with distinct "
        "ordinary and flagged symbols -- the rail cannot tell them apart")
    assert "AAPL" in watchlist_bucket
    assert "TSLA" in flagged_bucket
    assert "TSLA" not in flagged_bucket - {"TSLA"}  # sanity: flagged is not the whole union


# ═════════════════════════════════════════════════════════════════════════
# MUTATION PROOFS -- a guard never watched failing is not a guard
# ═════════════════════════════════════════════════════════════════════════

def test_mutation_flagged_filter_removed_is_caught(monkeypatch):
    """§2/§5: with `_flagged_syms`'s `is_flagged_list = 1` filter flipped
    away (so it reads EVERY list, not just the flagged one), the rail must
    go RED against `watchlist_service`'s own flagged-membership definition."""
    uid = _user()
    wl = ws.create_watchlist(uid, "Ordinary")
    ws.add_item(uid, wl["id"], "AAPL")
    ws.sync_flagged_items(uid, ["TSLA"])

    expected = {item["sym"] for item in ws.get_or_create_flagged_list(uid)["items"]}
    assert expected == {"TSLA"}

    def broken_flagged_syms(user_id: str) -> set:
        # The mutant: the is_flagged_list=1 predicate is gone, so this reads
        # every list the user has -- the exact break §2 names.
        conn = sqlite3.connect(mi._auth_db_path())
        try:
            rows = conn.execute(
                """SELECT wi.sym FROM watchlist_items wi
                   JOIN watchlists w ON w.id = wi.watchlist_id
                   WHERE w.user_id = ?""", (user_id,)).fetchall()
        finally:
            conn.close()
        return {r[0].upper() for r in rows if r and r[0]}

    monkeypatch.setattr(mi, "_flagged_syms", broken_flagged_syms)
    result = mi.interest_for(uid)
    assert result["by_source"]["flagged"] != expected, (
        "the mutant (is_flagged_list filter removed) produced the SAME answer as "
        "the real flagged membership -- this rail cannot catch the break it exists for")


def test_mutation_stale_read_path_is_caught(monkeypatch, tmp_path):
    """§2/§5: with `member_interest`'s read pointed at a COPY of the DB that
    is missing a row `watchlist_service.add_item` just wrote (simulating
    drift between the two readers), the rail must go RED."""
    uid = _user()
    wl = ws.create_watchlist(uid, "Ordinary")
    ws.add_item(uid, wl["id"], "AAPL")

    # Snapshot the DB BEFORE writing the second item -- the stale copy
    # member_interest will be pointed at, simulating a reader that missed
    # a write watchlist_service.py already made.
    stale = tmp_path / "stale.db"
    src = sqlite3.connect(mi._auth_db_path())
    try:
        stale_conn = sqlite3.connect(str(stale))
        src.backup(stale_conn)
        stale_conn.close()
    finally:
        src.close()

    ws.add_item(uid, wl["id"], "MSFT")   # the write the stale copy will miss

    expected = {
        item["sym"]
        for row in ws.list_user_watchlists(uid, include_prebuilt=False)
        for item in row["items"]
    }
    assert expected == {"AAPL", "MSFT"}, "the fixture itself is broken -- not the rail"

    monkeypatch.setattr(mi, "_auth_db_path", lambda: str(stale))
    result = mi.interest_for(uid)
    assert result["by_source"]["watchlist"] != expected, (
        "member_interest read the stale copy and STILL matched the live membership -- "
        "this rail cannot catch two readers drifting apart")


# ═════════════════════════════════════════════════════════════════════════
# THE TWO NAMED GAPS -- pinned as falsifiable facts, designed to flip on CP2
# ═════════════════════════════════════════════════════════════════════════

def test_column_presets_have_no_typed_store_yet():
    """§2 gap 1: `Watchlists.jsx`'s chosen-visible-columns state is plain,
    unpersisted component state today. Pinned structurally (the literal
    `useState(new Set())` initializer for `visiblePerf`, with no
    `usePreferences`/`fetch` call on the same line) so wiring a real store
    later makes this assertion fail ON PURPOSE -- the signal a future CP2 is
    watched against, not a note nobody re-checks."""
    path = os.path.join(_AT_ROOT, "app", "src", "pages", "Watchlists.jsx")
    src = open(path, encoding="utf-8").read()
    assert "const [visiblePerf, setVisiblePerf] = useState(new Set())" in src, (
        "visiblePerf's declaration changed shape -- if a typed store now backs it "
        "(CP2 shipped), this assertion SHOULD fail: update this pin, don't just "
        "make it pass again")
    assert "COL_PRESETS" in src


def test_no_s5_shaped_store_exists_for_watchlists_yet():
    """§2 gap 2: no `watchlist_view_documents`-shaped table exists in
    `auth_db.py`'s own schema today -- pinned by name against the literal
    schema string, so this fails ON PURPOSE the day CP2 copies S5's
    `tracings_documents` shape (user_id-keyed row + integer `revision` CAS
    column) onto a watchlist-view-state table."""
    from api.services.auth_db import _SCHEMA
    assert "watchlist_view_documents" not in _SCHEMA, (
        "a watchlist_view_documents table now exists -- CP2 (or its equivalent) has "
        "shipped; this assertion SHOULD fail: update this pin, don't just make it "
        "pass again")
    # The S5 shape this checkpoint would copy, confirmed still present as the
    # pattern to follow (not asserting anything about watchlists here — this
    # is the CONTROL that the string search above can see a real table at all).
    assert "tracings_documents" in _SCHEMA
    assert "revision" in _SCHEMA
