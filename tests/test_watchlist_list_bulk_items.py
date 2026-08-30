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


# ── slim mode (`include_items=False`) ────────────────────────────────────────
# The app shell asks for names, not symbols. The risk in a slim mode is that it
# quietly becomes a SECOND authority on what a list contains — a count that
# disagrees with the items, or a caller that loses `items` it actually needed.


def test_slim_mode_omits_items_but_keeps_an_honest_count():
    uid = _user("wlslim")
    wl = svc.create_watchlist(uid, "Index")
    for sym in ("NVDA", "AMD", "TSLA", "MSFT"):
        svc.add_item(uid, wl["id"], sym)

    full = next(w for w in svc.list_user_watchlists(uid) if w["id"] == wl["id"])
    slim = next(
        w for w in svc.list_user_watchlists(uid, include_items=False) if w["id"] == wl["id"]
    )

    assert "items" not in slim, "slim mode must not ship the rows it exists to avoid"
    # The count is the whole point: it must equal what the full response reports.
    assert slim["item_count"] == full["item_count"] == 4
    # Everything a name-rendering caller reads must survive.
    for k in ("id", "name", "is_prebuilt"):
        assert slim[k] == full[k]


def test_default_still_includes_items():
    """Every existing caller passes nothing — they must be unaffected."""
    uid = _user("wldefault")
    wl = svc.create_watchlist(uid, "Default")
    svc.add_item(uid, wl["id"], "NVDA")

    got = next(w for w in svc.list_user_watchlists(uid) if w["id"] == wl["id"])
    assert [i["sym"] for i in got["items"]] == ["NVDA"]
    assert got["item_count"] == 1


def test_slim_counts_never_bleed_across_lists():
    """The control — a GROUP BY that lost its key would give every list one count."""
    uid = _user("wlcounts")
    a, b, c = (svc.create_watchlist(uid, n) for n in ("A", "B", "C"))
    for sym in ("NVDA", "AMD", "TSLA"):
        svc.add_item(uid, a["id"], sym)
    svc.add_item(uid, b["id"], "SPY")
    # c stays empty.

    by_id = {w["id"]: w for w in svc.list_user_watchlists(uid, include_items=False)}
    assert by_id[a["id"]]["item_count"] == 3
    assert by_id[b["id"]]["item_count"] == 1
    assert by_id[c["id"]]["item_count"] == 0, "an empty list must report 0, not vanish"


# ── the WIRE: query param → service ──────────────────────────────────────────
# The service tests above all passed while the router ignored `include_items`
# entirely (mutation M7 survived them). A slim mode the endpoint never forwards
# is built, green and unreachable — the exact shape this repo keeps rediscovering
# — so the wire gets its own rails, and they are what make M7 fail.


def test_the_endpoint_forwards_include_items_to_the_service(monkeypatch):
    """A router that hardcodes the flag serves 553 KB no matter what is asked."""
    from api.routers import watchlists as r
    from api.services import watchlist_service as wl

    seen = {}

    def spy(user_id, include_items=True):
        seen["user_id"] = user_id
        seen["include_items"] = include_items
        return []

    monkeypatch.setattr(wl, "list_user_watchlists", spy)

    r.list_watchlists(include_items=False, user={"id": "u1"})
    assert seen["include_items"] is False, "the endpoint dropped include_items=False"

    seen.clear()
    r.list_watchlists(user={"id": "u1"})
    assert seen["include_items"] is True, "the default must still ship items"


def test_include_items_is_a_real_query_parameter_on_the_mounted_route():
    """`?include_items=0` must be the name the route actually answers to.

    Renaming the parameter would leave every caller's query string silently
    ignored — the request still 200s with the full 553 KB payload, so nothing
    looks broken. Derived from the mounted route, never retyped from the source.
    """
    from api.routers import watchlists as r

    route = next(
        rt for rt in r.router.routes
        if getattr(rt, "path", None) == "/api/watchlists" and "GET" in getattr(rt, "methods", set())
    )
    names = {q.name for q in route.dependant.query_params}
    assert "include_items" in names, f"query params were {names}"
    # Non-vacuity control: the probe can see query params in general, so a route
    # that declared none would not pass this by accident.
    assert names, "the probe found no query params at all — it cannot discriminate"
