"""SCAT's universe picker lists UCT themes.

theme_db.get_all_themes() answers {"sectors": [...], "themes": [...]}. scatter.list_universes
iterated that dict as if it were a list, the per-theme `.get` raised on a str key, and a bare
except hid it, so the Themes group never appeared (found 2026-10-09).
"""
from api.services import scatter, theme_db


def _names():
    return [{"id": "ai_chips", "name": "AI Chips"}, {"id": "nuclear", "name": "Nuclear"}]


def _payload():
    return {"sectors": [{"id": "tech"}],
            "themes": [{"id": "ai_chips", "name": "AI Chips"}, {"id": "nuclear", "name": "Nuclear"}]}


def test_theme_rows_reads_the_dict_payload_and_tolerates_a_list():
    assert [t["id"] for t in scatter._theme_rows(_payload())] == ["ai_chips", "nuclear"]
    assert [t["id"] for t in scatter._theme_rows([{"id": "x"}])] == ["x"]
    assert scatter._theme_rows(None) == []


def _heavy(*a, **k):
    raise AssertionError("the picker must not call get_all_themes (every membership, 9.2 s on prod)")


def test_list_universes_has_a_themes_group(monkeypatch):
    monkeypatch.setattr(theme_db, "get_theme_names", _names)
    monkeypatch.setattr(theme_db, "get_all_themes", _heavy)
    groups = scatter.list_universes(None)
    themes = next((g for g in groups if g.get("group") == "Themes"), None)
    assert themes is not None, [g.get("group") for g in groups]
    assert [i["value"] for i in themes["items"]] == ["ai_chips", "nuclear"]
    assert themes["items"][0]["label"] == "AI Chips"


def test_a_theme_universe_label_resolves_by_id(monkeypatch):
    monkeypatch.setattr(theme_db, "get_theme", lambda tid: {"id": tid, "name": "Nuclear"} if tid == "nuclear" else None)
    monkeypatch.setattr(theme_db, "get_all_themes", _heavy)
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
    monkeypatch.setattr(theme_db, "get_theme_names", _names)
    groups = scatter.list_universes("u1")
    assert seen == {"include_items": False}
    mine = [i for g in groups for i in g["items"] if i.get("source") == "watchlist"]
    assert mine == [{"source": "watchlist", "value": 7, "label": "Leaders"}]


def test_get_theme_names_reads_ids_and_names_in_display_order(tmp_path, monkeypatch):
    import sqlite3
    db = tmp_path / "themes.db"
    c = sqlite3.connect(db)
    c.execute("CREATE TABLE themes (id TEXT, name TEXT, display_order INT)")
    c.executemany("INSERT INTO themes VALUES (?,?,?)", [("b", "Beta", 2), ("a", "Alpha", 1)])
    c.commit(); c.close()

    def conn():
        k = sqlite3.connect(db)
        k.row_factory = sqlite3.Row
        return k

    monkeypatch.setattr(theme_db, "get_connection", conn)
    assert theme_db.get_theme_names() == [{"id": "a", "name": "Alpha"}, {"id": "b", "name": "Beta"}]
