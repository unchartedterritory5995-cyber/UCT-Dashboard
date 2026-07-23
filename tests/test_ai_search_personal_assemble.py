from api.services import ai_search_personal as p


def test_resolve_account_prefers_holder(monkeypatch):
    monkeypatch.setattr(p, "_list_accounts", lambda uid: [{"id": "A"}, {"id": "B"}])
    monkeypatch.setattr(p, "_positions_for", lambda uid, aid: (
        [{"symbol": "NVDA"}] if aid == "B" else []))
    assert p.resolve_account("u1", ["NVDA"]) == "B"      # the account that holds it
    assert p.resolve_account("u1", []) == "A"            # else first
    monkeypatch.setattr(p, "_list_accounts", lambda uid: [])
    assert p.resolve_account("u1", ["NVDA"]) is None     # zero accounts → decline

def test_assemble_positions_uses_keyword_account_id(monkeypatch):
    called = {}
    def fake_list(user_id, account_id=None):
        called["kw"] = account_id
        return [{"symbol": "NVDA", "side": "long", "entryPrice": 100.0, "stopPrice": 90.0,
                 "shares": 10.0, "entryEstimated": False, "brokerPrice": None, "entryDate": "2026-07-01"}]
    monkeypatch.setattr(p, "_positions_for", lambda uid, aid: fake_list(uid, account_id=aid))
    monkeypatch.setattr(p, "_heat_for", lambda uid, aid: {})
    monkeypatch.setattr(p, "_edge_for", lambda uid, aid: {})
    monkeypatch.setattr(p, "_watch_syms", lambda uid: [])
    monkeypatch.setattr(p, "_live_price", lambda sym: 110.0)
    block = p.assemble("u1", "acctB", "should i add to my nvda", ["NVDA"])
    assert "NVDA" in block and "entry" in block.lower()
    assert called["kw"] == "acctB"                       # account_id passed as keyword

def test_assemble_broker_estimated_labels_return(monkeypatch):
    monkeypatch.setattr(p, "_positions_for", lambda uid, aid: [
        {"symbol": "AMD", "side": "long", "entryPrice": 50.0, "stopPrice": 50.0, "shares": 5.0,
         "entryEstimated": True, "brokerPrice": 60.0, "entryDate": "2026-07-22"}])
    monkeypatch.setattr(p, "_heat_for", lambda uid, aid: {})
    monkeypatch.setattr(p, "_edge_for", lambda uid, aid: {})
    monkeypatch.setattr(p, "_watch_syms", lambda uid: [])
    monkeypatch.setattr(p, "_live_price", lambda sym: None)   # cold cache
    block = p.assemble("u1", "acctB", "how's my book", [])
    assert "est." in block.lower()          # estimated basis labeled
    assert "no stop" in block.lower()       # placeholder stop surfaced, not a number

def test_assemble_default_account_size_omits_pct(monkeypatch):
    monkeypatch.setattr(p, "_positions_for", lambda uid, aid: [])
    monkeypatch.setattr(p, "_heat_for", lambda uid, aid: {"risk_heat_pct": 8.0, "account_size_is_default": True})
    monkeypatch.setattr(p, "_edge_for", lambda uid, aid: {})
    monkeypatch.setattr(p, "_watch_syms", lambda uid: [])
    block = p.assemble("u1", "acctB", "am i overexposed", [])
    assert "8.0%" not in block               # % omitted when denominator is the $50k default
    assert "account size not set" in block.lower()

def test_assemble_is_char_capped(monkeypatch):
    many = [{"symbol": f"T{i}", "side": "long", "entryPrice": 10.0, "stopPrice": 9.0,
             "shares": 1.0, "entryEstimated": False, "brokerPrice": None, "entryDate": "2026-01-01"}
            for i in range(200)]
    monkeypatch.setattr(p, "_positions_for", lambda uid, aid: many)
    monkeypatch.setattr(p, "_heat_for", lambda uid, aid: {})
    monkeypatch.setattr(p, "_edge_for", lambda uid, aid: {})
    monkeypatch.setattr(p, "_watch_syms", lambda uid: [f"W{i}" for i in range(500)])
    block = p.assemble("u1", "acctB", "how's my book", [])
    assert len(block) <= p._BLOCK_CAP
