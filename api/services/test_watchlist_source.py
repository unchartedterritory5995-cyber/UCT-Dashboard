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


# ── Task 8: scan origination ──────────────────────────────────────────────────

def test_scan_source_returns_scanned_names(monkeypatch):
    monkeypatch.setattr(ws, "_scan_syms", lambda uid, aid: ["DECK", "NVDA", "FIX"])
    names, desc = ws.resolve("u", None, "scan")
    assert names == ["DECK", "NVDA", "FIX"] and "scan" in desc.lower()


def test_scan_failure_returns_empty(monkeypatch):
    monkeypatch.setattr(ws, "_scan_syms", lambda uid, aid: (_ for _ in ()).throw(RuntimeError()))
    names, desc = ws.resolve("u", None, "scan")
    assert names == []


def test_raw_scan_ranks_and_bounds(monkeypatch):
    # no leading-sector filter -> keep all, ranked by confidence, deduped, capped
    monkeypatch.setattr(ws, "_leading_sectors", lambda: set())
    dets = [{"sym": "a", "confidence": 70}, {"sym": "B", "confidence": 90},
            {"sym": "b", "confidence": 55}, {"sym": "C", "confidence": 80}]
    import api.services.journal_two.coach_chat_tools as cct
    monkeypatch.setattr(cct, "_exec_scan_active_patterns",
                        lambda **kw: {"ok": True, "detections": dets})
    out = ws._raw_scan("u", None)
    assert out[0] == "B" and "A" in out and out == ["B", "C", "A"]  # deduped B, ranked
