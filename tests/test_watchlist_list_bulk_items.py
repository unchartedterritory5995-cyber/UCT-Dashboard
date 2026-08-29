"""`list_user_watchlists` must return EXACTLY what the per-list N+1 returned.

`GET /api/watchlists` is on the app-shell path — every page in the dashboard
fetches it — and it was doing one `SELECT … WHERE watchlist_id = ?` per list
inside a Python loop. auth.db sits on a Railway NETWORK volume, so each of those
was a real round-trip: measured 7.6-8.4 s / 553 KB on prod 2026-08-29.

The fix batches them. The risk in batching is SILENT: a member's lists would
still come back, just grouped or ordered wrong, and nothing about the page would
look broken. So these tests pin the two things a bulk regroup can quietly get
wrong — WHICH list each item lands on, and the ORDER within a list — by
comparing against `_get_items`, the per-list query that is still the authority
for every single-list read in the module.
"""

import uuid

from api.services.auth_db import get_connection, init_db
from api.services.auth_service import create_user
from api.services import watchlist_service as svc


def _user(tag="wlbulk"):
    init_db()
    return create_user(f"{tag}_{uuid.uuid4()}@example.com", "p")["id"]


def test_bulk_items_match_the_per_list_query_exactly():
    """Same rows, same order, per list — the N+1 result is the oracle."""
    uid = _user()
    lists = [svc.create_watchlist(uid, f"L{i}") for i in range(4)]
    # Deliberately uneven: a list with many, a list with one, an EMPTY list.
    for sym in ("NVDA", "AMD", "TSLA", "MSFT", "AVGO"):
        svc.add_item(uid, lists[0]["id"], sym)
    svc.add_item(uid, lists[1]["id"], "SPY")
    for sym in ("META", "GOOGL"):
        svc.add_item(uid, lists[2]["id"], sym)
    # lists[3] stays empty on purpose.

    got = svc.list_user_watchlists(uid)
    by_id = {wl["id"]: wl for wl in got}

    conn = get_connection()
    try:
        for wl in lists:
            expected = svc._get_items(conn, wl["id"])
            actual = by_id[wl["id"]]["items"]
            assert [r["id"] for r in actual] == [r["id"] for r in expected], (
                f"list {wl['name']} regrouped wrong"
            )
            assert [r["sym"] for r in actual] == [r["sym"] for r in expected]
    finally:
        conn.close()

    # An empty list must still carry [] and a 0 count, not be dropped.
    assert by_id[lists[3]["id"]]["items"] == []
    assert by_id[lists[3]["id"]]["item_count"] == 0


def test_items_never_leak_across_lists():
    """The control: this fails if the regroup ignores watchlist_id.

    A bulk query that returned every row to every list would still satisfy a
    naive "the items are there" assertion, so assert the DISJOINTNESS too —
    a fixture that cannot distinguish the bug is not a rail.
    """
    uid = _user()
    a = svc.create_watchlist(uid, "A")
    b = svc.create_watchlist(uid, "B")
    svc.add_item(uid, a["id"], "NVDA")
    svc.add_item(uid, b["id"], "TSLA")

    by_id = {wl["id"]: wl for wl in svc.list_user_watchlists(uid)}
    assert [i["sym"] for i in by_id[a["id"]]["items"]] == ["NVDA"]
    assert [i["sym"] for i in by_id[b["id"]]["items"]] == ["TSLA"]
    assert by_id[a["id"]]["item_count"] == 1
    assert by_id[b["id"]]["item_count"] == 1


def test_item_count_still_matches_the_items_it_reports():
    """item_count is derived from the list it ships beside — never a stale number."""
    uid = _user()
    wl = svc.create_watchlist(uid, "Counted")
    for sym in ("NVDA", "AMD", "TSLA"):
        svc.add_item(uid, wl["id"], sym)

    got = next(w for w in svc.list_user_watchlists(uid) if w["id"] == wl["id"])
    assert got["item_count"] == len(got["items"]) == 3


def test_bulk_helper_chunks_past_the_sqlite_variable_ceiling():
    """More ids than one IN(...) may hold must still come back whole.

    SQLITE_MAX_VARIABLE_NUMBER is 999 on older builds; the helper chunks at 400.
    Exercising the helper directly (rather than creating 400+ real watchlists)
    keeps this fast while still crossing the boundary.
    """
    uid = _user()
    wl = svc.create_watchlist(uid, "Chunked")
    svc.add_item(uid, wl["id"], "NVDA")

    padding = [f"absent-{i}" for i in range(svc._ITEMS_CHUNK * 2 + 7)]
    conn = get_connection()
    try:
        out = svc._get_items_bulk(conn, padding + [wl["id"]])
    finally:
        conn.close()

    assert [r["sym"] for r in out[wl["id"]]] == ["NVDA"]
    # Ids with no rows are simply absent — callers default to [].
    assert all(p not in out for p in padding)


def test_bulk_helper_is_empty_safe():
    """No lists must not build a bare `IN ()` and raise."""
    conn = get_connection()
    try:
        assert svc._get_items_bulk(conn, []) == {}
        assert svc._get_display_names_bulk(conn, []) == {}
    finally:
        conn.close()


def test_owner_name_matches_the_per_row_lookup():
    """Community lists resolve the same owner name the single-row helper does."""
    uid = _user("wlowner")
    wl = svc.create_watchlist(uid, "Public one", is_public=True)
    svc.add_item(uid, wl["id"], "NVDA")

    conn = get_connection()
    try:
        expected = svc._get_display_name(conn, uid)
    finally:
        conn.close()

    got = next((w for w in svc.list_public_watchlists() if w["id"] == wl["id"]), None)
    assert got is not None, "a public list must appear in the community tab"
    assert got["owner_name"] == expected
    assert [i["sym"] for i in got["items"]] == ["NVDA"]
