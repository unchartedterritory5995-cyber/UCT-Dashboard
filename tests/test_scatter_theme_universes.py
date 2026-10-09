"""SCAT's universe picker lists UCT themes.

theme_db.get_all_themes() answers {"sectors": [...], "themes": [...]}. scatter.list_universes
iterated that dict as if it were a list, the per-theme `.get` raised on a str key, and a bare
except hid it, so the Themes group never appeared (found 2026-10-09).
"""
from api.services import scatter, theme_db


def _payload():
    return {"sectors": [{"id": "tech"}],
            "themes": [{"id": "ai_chips", "name": "AI Chips"}, {"id": "nuclear", "name": "Nuclear"}]}


def test_theme_rows_reads_the_dict_payload_and_tolerates_a_list():
    assert [t["id"] for t in scatter._theme_rows(_payload())] == ["ai_chips", "nuclear"]
    assert [t["id"] for t in scatter._theme_rows([{"id": "x"}])] == ["x"]
    assert scatter._theme_rows(None) == []


def test_list_universes_has_a_themes_group(monkeypatch):
    monkeypatch.setattr(theme_db, "get_all_themes", _payload)
    groups = scatter.list_universes(None)
    themes = next((g for g in groups if g.get("group") == "Themes"), None)
    assert themes is not None, [g.get("group") for g in groups]
    assert [i["value"] for i in themes["items"]] == ["ai_chips", "nuclear"]
    assert themes["items"][0]["label"] == "AI Chips"


def test_a_theme_universe_label_resolves_by_id(monkeypatch):
    monkeypatch.setattr(theme_db, "get_all_themes", _payload)
    assert scatter.label_for("theme", "nuclear", None) == "Nuclear"


def test_the_picker_reads_list_names_only(monkeypatch):
    """The full watchlist read ships every symbol of every list (on an admin account the
    prebuilt index lists, ~4,700 rows): 28 s cold on prod. The picker needs names only."""
    from api.services import watchlist_service
    seen = {}

    def fake(user_id, include_items=True, include_prebuilt=True):
        seen["include_items"] = include_items
        return [{"id": 7, "name": "Leaders", "item_count": 12}]

    monkeypatch.setattr(watchlist_service, "list_user_watchlists", fake)
    monkeypatch.setattr(theme_db, "get_all_themes", _payload)
    groups = scatter.list_universes("u1")
    assert seen == {"include_items": False}
    mine = [i for g in groups for i in g["items"] if i.get("source") == "watchlist"]
    assert mine == [{"source": "watchlist", "value": 7, "label": "Leaders"}]
