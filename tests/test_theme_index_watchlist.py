"""The 'UCT Thematic Indexes' prebuilt watchlist + its batch-quotes route.

Pins two things a future edit could silently break:
  1. the prebuilt config carries ONE thematic-index list, grouped under
     'UCT Index Components', full of $IDX:<slug> pseudo-tickers (uppercased to
     match how watchlist_service stores them, so the self-heal seed sees no drift);
  2. GET /api/theme-index/quotes is declared BEFORE /{slug} so 'quotes' can't be
     captured as a theme slug.
"""
from api.services import watchlist_prebuilt as wp
from api.routers import theme_index as ti_router


def test_theme_index_prebuilt_list_present_and_categorized():
    lists = wp._theme_index_lists()
    assert len(lists) == 1
    lst = lists[0]
    assert lst["category"] == "UCT Index Components"
    assert lst["name"] == "UCT Thematic Indexes"
    assert lst["tickers"], "expected at least one thematic index"
    # Every ticker is an uppercased $IDX: pseudo-ticker (matches DB storage casing).
    assert all(t.startswith("$IDX:") and t == t.upper() for t in lst["tickers"])
    # It shows up in the committed config under the same category as Dow 30 etc.
    committed = wp._load_committed()
    names = {row["name"]: row["category"] for row in committed}
    assert names.get("UCT Thematic Indexes") == "UCT Index Components"
    # Category order is unchanged: ETF Lists first, then Index Components.
    order = wp.category_order()
    assert order.index("UCT ETF Lists") < order.index("UCT Index Components")


def test_quotes_route_declared_before_slug_capture():
    paths = [r.path for r in ti_router.router.routes]
    assert "/api/theme-index/quotes" in paths
    assert "/api/theme-index/{slug}" in paths
    assert paths.index("/api/theme-index/quotes") < paths.index("/api/theme-index/{slug}")
