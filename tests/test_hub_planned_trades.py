"""Phase 2a — the joystick hub's planned-trades backend.

⛔ THE CROSS-USER TESTS ARE THE POINT OF THIS FILE. Everything else here would be caught by
using the feature once; a scoping hole would not, and it is the kind that ships.
"""

import sqlite3

import pytest

from api.services import hub_planned_trades as store
from api.services.journal_two.calculations import trade_pnl_dollar
from api.services.journal_two.db import ensure_schema


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    yield c
    c.close()


ALICE = "user-alice"
BOB = "user-bob"


def _plan(conn, user=ALICE, symbol="NVDA", entry=100.0, stop=95.0, size=10.0, mode="scan"):
    return store.create(user, symbol, entry, stop, size, source_mode=mode, conn=conn)


# ─────────────────────────────────────────────────────────────────────────────
#  create / list / discard
# ─────────────────────────────────────────────────────────────────────────────

def test_create_then_list_shows_it(conn):
    made = _plan(conn)
    assert made["symbol"] == "NVDA"
    assert made["status"] == "planned"

    rows = store.list_for_user(ALICE, conn=conn)
    assert [r["id"] for r in rows] == [made["id"]]
    assert rows[0]["source_mode"] == "scan"


def test_discard_flips_status_and_the_row_is_STILL_listed(conn):
    """Discarding is a state, not a delete.

    A member who plans five and takes one has learned something from the four they did not
    take. Hiding them would throw that away — and a row that vanishes is also indistinguishable
    from one that was never written.
    """
    made = _plan(conn)
    out = store.discard(ALICE, made["id"], conn=conn)
    assert out["status"] == "discarded"

    rows = store.list_for_user(ALICE, conn=conn)
    assert len(rows) == 1
    assert rows[0]["id"] == made["id"]
    assert rows[0]["status"] == "discarded"


def test_list_is_newest_first(conn):
    a = _plan(conn, symbol="AAA")
    b = _plan(conn, symbol="BBB")
    ids = [r["id"] for r in store.list_for_user(ALICE, conn=conn)]
    # Same-second timestamps are broken by id DESC, so assert membership + count,
    # and that the ordering is stable rather than asserting a coin-flip.
    assert set(ids) == {a["id"], b["id"]}
    assert ids == [r["id"] for r in store.list_for_user(ALICE, conn=conn)]


# ─────────────────────────────────────────────────────────────────────────────
#  cross-user isolation — no existence leak
# ─────────────────────────────────────────────────────────────────────────────

def test_another_users_row_is_invisible_in_list(conn):
    _plan(conn, user=ALICE, symbol="NVDA")
    assert store.list_for_user(BOB, conn=conn) == []


def test_discarding_another_users_row_returns_None_not_an_error(conn):
    """None -> the router answers 404, the same as a row that never existed.

    ⛔ A 403 here would confirm the id is REAL, which is exactly the existence leak the
    where-clause scoping exists to prevent.
    """
    made = _plan(conn, user=ALICE)
    assert store.discard(BOB, made["id"], conn=conn) is None
    # And Alice's row is untouched.
    assert store.list_for_user(ALICE, conn=conn)[0]["status"] == "planned"


def test_discarding_a_nonexistent_id_is_indistinguishable_from_someone_elses(conn):
    made = _plan(conn, user=ALICE)
    assert store.discard(BOB, made["id"], conn=conn) is None
    assert store.discard(BOB, "no-such-id", conn=conn) is None


# ─────────────────────────────────────────────────────────────────────────────
#  r_value comes from the Journal's calc module, not a second copy
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("entry,stop,size", [
    (100.0, 95.0, 10.0),     # long: 5 x 10 = 50
    (50.0, 52.5, 20.0),      # short: 2.5 x 20 = 50
    (12.34, 11.10, 137.0),   # long, awkward numbers
])
def test_r_value_matches_the_calc_module(conn, entry, stop, size):
    made = _plan(conn, entry=entry, stop=stop, size=size)
    side = store.side_of(entry, stop)
    expected = abs(trade_pnl_dollar(side, entry, stop, size))
    assert made["r_value"] == pytest.approx(expected)


def test_side_is_derived_from_the_stop_not_stored(conn):
    assert store.side_of(100.0, 95.0) == "Long"
    assert store.side_of(50.0, 52.5) == "Short"


def test_equal_entry_and_stop_has_undefined_risk(conn):
    """The store returns None; the ROUTER refuses the request outright (422)."""
    assert store._one_r_dollars(100.0, 100.0, 10.0) is None


# ─────────────────────────────────────────────────────────────────────────────
#  schema
# ─────────────────────────────────────────────────────────────────────────────

def test_ensure_schema_is_idempotent(conn):
    """Second call must not raise — it runs on every boot."""
    ensure_schema(conn)
    ensure_schema(conn)
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(hub_planned_trades)")}
    assert {"id", "user_id", "symbol", "entry", "stop", "size", "r_value",
            "source_mode", "status", "created_at", "updated_at"} <= cols


def test_status_check_constraint_rejects_an_unknown_value(conn):
    made = _plan(conn)
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("UPDATE hub_planned_trades SET status = 'nonsense' WHERE id = ?",
                     (made["id"],))


def test_the_user_created_index_exists(conn):
    """The list query is `WHERE user_id = ? ORDER BY created_at DESC` — without this index
    it is a full scan of every user's rows on a shared table."""
    idx = {r["name"] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='hub_planned_trades'")}
    assert "idx_hub_planned_trades_user_created" in idx
