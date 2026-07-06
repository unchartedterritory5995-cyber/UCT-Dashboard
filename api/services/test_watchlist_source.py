from api.services import watchlist_source as ws


def test_explicit_passthrough():
    names, desc = ws.resolve("u", None, "explicit", ["deck", "nvda"])
    assert names == ["DECK", "NVDA"] and "explicit" in desc


def test_positions_source(monkeypatch):
    monkeypatch.setattr(ws, "_open_positions", lambda uid, aid: [{"symbol": "AAPL"}, {"symbol": "msft"}])
    names, desc = ws.resolve("u", None, "positions")
    assert set(names) == {"AAPL", "MSFT"} and "position" in desc.lower()


def test_watchlist_dedupes_and_uppercases(monkeypatch):
    monkeypatch.setattr(ws, "_watchlist_syms", lambda uid, aid: ["nvda", "NVDA", "amd"])
    monkeypatch.setattr(ws, "_flagged_syms", lambda uid, aid: ["deck"])
    names, desc = ws.resolve("u", None, "watchlist")
    assert set(names) == {"NVDA", "AMD", "DECK"}


def test_unknown_source_empty():
    names, desc = ws.resolve("u", None, "nonsense")
    assert names == []


def test_never_raises(monkeypatch):
    monkeypatch.setattr(ws, "_watchlist_syms", lambda uid, aid: (_ for _ in ()).throw(RuntimeError()))
    names, desc = ws.resolve("u", None, "watchlist")
    assert names == []
