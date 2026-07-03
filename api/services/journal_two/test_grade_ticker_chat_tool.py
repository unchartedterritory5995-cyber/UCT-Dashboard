import importlib


def _reload(monkeypatch, enabled):
    monkeypatch.setenv("BRAIN_TOOLS_ENABLED", "1" if enabled else "0")
    import api.services.journal_two.coach_chat_tools as cct
    return importlib.reload(cct)


def test_grade_ticker_absent_when_flag_off(monkeypatch):
    cct = _reload(monkeypatch, False)
    assert "grade_ticker" not in cct.TOOLS
    monkeypatch.setenv("BRAIN_TOOLS_ENABLED", "0")
    importlib.reload(cct)


def test_grade_ticker_present_and_delegates(monkeypatch):
    cct = _reload(monkeypatch, True)
    assert "grade_ticker" in cct.TOOLS
    spec = cct.TOOLS["grade_ticker"]
    assert spec["requires_confirm"] is False
    from api.services import grade_ticker as gt
    monkeypatch.setattr(gt, "grade_ticker",
                        lambda symbol, account_size=None: {"ok": True, "verdict": "GO", "symbol": symbol})
    out = spec["executor"](user_id="u1", account_id="a1", args={"symbol": "deck"}, conn=None)
    assert out["verdict"] == "GO" and out["symbol"] == "deck"
    monkeypatch.setenv("BRAIN_TOOLS_ENABLED", "0")
    importlib.reload(cct)
