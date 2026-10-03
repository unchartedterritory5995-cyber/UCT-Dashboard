"""RM-X02: hub_nav_smoke sweeps `/terminal`, DERIVED from NavBar.jsx, not typed.

The UCT Terminal nav entry's `to` stays `/calendar` while the shell is cohort-gated; the shell
itself is the entry's `alsoActive` route. The sweep must visit it, and must reach it by the
owner's link (an alsoActive route has no link of its own).
"""
from tools import hub_nav_smoke as H


def test_the_real_nav_puts_terminal_in_the_sweep_right_after_its_owner():
    routes = H.top_level_routes(H.nav_items())
    assert "/terminal" in routes
    assert routes.index("/terminal") == routes.index("/calendar") + 1
    assert routes[0] == "/dashboard"
    assert len(routes) == len(set(routes))


def test_control_without_alsoActive_there_is_no_terminal_route():
    entries = [{"to": "/dashboard", "label": "D"}, {"to": "/calendar", "label": "UCT Terminal"}]
    assert H.top_level_routes(entries) == ["/dashboard", "/calendar"]
    entries[1]["also"] = ["/terminal"]
    assert H.top_level_routes(entries) == ["/dashboard", "/calendar", "/terminal"]


def test_nav_items_reads_alsoActive_off_the_row_and_only_that_row():
    items = {e["to"]: e for e in H.nav_items()}
    assert items["/calendar"]["also"] == ["/terminal"]
    assert items["/charts"]["also"] == []
