"""RM-X02: hub_nav_smoke sweeps `/terminal`, DERIVED from NavBar.jsx, not typed.

One nav row can answer for two routes: its own `to` and an `alsoActive` route that has no link
of its own. The sweep must visit both, and must reach the second by the owner's link.

(Written while the UCT Terminal row's `to` was `/calendar` and the shell was its `alsoActive`.
The row graduated on 2026-10-07: `to` is `/terminal` and `/calendar` is the `alsoActive`. These
tests typed the old direction and went red; they now read which is which off the row.)
"""
from tools import hub_nav_smoke as H


def _owner():
    """The one real nav row that answers for a second route."""
    rows = [e for e in H.nav_items() if e["also"]]
    assert len(rows) == 1, f"expected exactly one row with an alsoActive route, found {rows}"
    return rows[0]


def test_the_real_nav_puts_terminal_in_the_sweep_right_after_its_owner():
    routes = H.top_level_routes(H.nav_items())
    owner = _owner()
    assert owner["label"] == "UCT Terminal" and {owner["to"], *owner["also"]} == {"/terminal", "/calendar"}
    assert "/terminal" in routes and "/calendar" in routes
    for k, also in enumerate(owner["also"], start=1):
        assert routes.index(also) == routes.index(owner["to"]) + k, "an alsoActive route follows its owner"
    # the home page leads, DERIVED from the nav (it was a typed "/dashboard" until the nav stopped
    # listing it, and the smoke then failed a healthy production: `anchor_route`)
    assert routes[0] == H.anchor_route(H.nav_items()) == H.nav_items()[0]["to"]
    assert len(routes) == len(set(routes))


def test_the_anchor_is_the_dashboard_while_the_nav_lists_it_and_the_first_entry_otherwise():
    with_dash = [{"to": "/charts", "label": "C"}, {"to": "/dashboard", "label": "D"}, {"to": "/journal", "label": "J"}]
    assert H.anchor_route(with_dash) == "/dashboard"
    assert H.top_level_routes(with_dash)[0] == "/dashboard"
    without = [{"to": "/charts", "label": "C"}, {"to": "/journal", "label": "J"}, {"to": "/screener", "label": "S"}]
    assert H.anchor_route(without) == "/charts"
    assert H.top_level_routes(without) == ["/charts", "/journal", "/screener"]
    assert H.anchor_route([]) is None


def test_the_real_nav_no_longer_lists_the_dashboard_so_the_anchor_is_a_page_a_member_can_click_to():
    """If this fails because the Dashboard is back in the sidebar, the anchor is `/dashboard`
    again by itself: delete this test, nothing else changes."""
    listed = [e["to"] for e in H.nav_items()]
    assert "/dashboard" not in listed, "the Dashboard is listed again: see the docstring"
    assert H.anchor_route(H.nav_items()) in listed


def test_the_full_run_starts_from_the_anchor_in_the_dashboards_place_and_only_from_listed_routes():
    without = [{"to": "/charts", "label": "C"}, {"to": "/journal", "label": "J"}, {"to": "/screener", "label": "S"}]
    assert H.start_routes(without) == ("/charts", "/journal", "/screener")
    with_dash = [{"to": "/dashboard", "label": "D"}, *without]
    assert H.start_routes(with_dash) == ("/dashboard", "/journal", "/screener")
    assert H.start_routes([{"to": "/journal", "label": "J"}]) == ("/journal",), "the anchor is /journal: once, not twice"
    assert H.start_routes([{"to": "/charts", "label": "C"}]) == ("/charts",), "a start route the nav does not list is left out"
    assert H.start_routes([]) == ()


def test_control_without_alsoActive_there_is_no_terminal_route():
    entries = [{"to": "/dashboard", "label": "D"}, {"to": "/calendar", "label": "UCT Terminal"}]
    assert H.top_level_routes(entries) == ["/dashboard", "/calendar"]
    entries[1]["also"] = ["/terminal"]
    assert H.top_level_routes(entries) == ["/dashboard", "/calendar", "/terminal"]


def test_nav_items_reads_alsoActive_off_the_row_and_only_that_row():
    items = {e["to"]: e for e in H.nav_items()}
    owner = _owner()
    assert items[owner["to"]]["also"] == owner["also"] and len(owner["also"]) == 1
    assert owner["also"][0] not in items, "the alsoActive route has no row (and so no link) of its own"
    assert items["/charts"]["also"] == []
