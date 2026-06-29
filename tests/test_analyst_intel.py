import importlib


def _mod(monkeypatch):
    import api.services.analyst_intel as ai
    importlib.reload(ai)
    return ai


def test_consensus_and_pt_from_fmp_with_upside(monkeypatch):
    ai = _mod(monkeypatch)
    monkeypatch.setattr(ai, "_fmp_consensus", lambda t: {"rating": "Buy", "buy": 28, "hold": 9, "sell": 2, "strong_buy": 12, "strong_sell": 0})
    monkeypatch.setattr(ai, "_fmp_price_target", lambda t: {"low": 210.0, "avg": 285.0, "high": 320.0, "count": 41, "updated": "2026-06-20"})
    monkeypatch.setattr(ai, "_fmp_recent_actions", lambda t: [])
    out = ai.get_analyst_intel("ZZAAPL", current_price=250.0)
    assert out["consensus"]["rating"] == "Buy"
    assert out["price_target"]["avg"] == 285.0
    # upside = (285-250)/250 = +14.0%
    assert out["price_target"]["upside_pct"] == 14.0


def test_falls_back_to_finnhub_when_fmp_empty(monkeypatch):
    ai = _mod(monkeypatch)
    monkeypatch.setattr(ai, "_fmp_consensus", lambda t: None)
    monkeypatch.setattr(ai, "_fmp_price_target", lambda t: None)
    monkeypatch.setattr(ai, "_fmp_recent_actions", lambda t: [])
    monkeypatch.setattr(ai.ee, "get_earnings_intel", lambda t: {
        "consensus": {"buy": 5, "hold": 1, "sell": 0, "strongBuy": 3, "strongSell": 0},
        "price_target": {"targetLow": 100, "targetMean": 130, "targetHigh": 160},
    })
    out = ai.get_analyst_intel("ZZFB", current_price=120.0)
    assert out["consensus"]["buy"] == 5
    assert out["price_target"]["avg"] == 130
    assert out["price_target"]["upside_pct"] == 8.3   # (130-120)/120


def test_empty_everywhere_returns_shape(monkeypatch):
    ai = _mod(monkeypatch)
    monkeypatch.setattr(ai, "_fmp_consensus", lambda t: None)
    monkeypatch.setattr(ai, "_fmp_price_target", lambda t: None)
    monkeypatch.setattr(ai, "_fmp_recent_actions", lambda t: [])
    monkeypatch.setattr(ai.ee, "get_earnings_intel", lambda t: None)
    out = ai.get_analyst_intel("ZZNADA")
    assert out == {"ticker": "ZZNADA", "consensus": None, "price_target": None, "recent_actions": []}
