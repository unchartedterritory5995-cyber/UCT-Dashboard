import importlib


def _reload(monkeypatch, on):
    monkeypatch.setenv("BRAIN_TOOLS_ENABLED", "1" if on else "0")
    import api.services.journal_two.coach_chat_tools as cct
    return importlib.reload(cct)


def test_tools_present_and_delegate(monkeypatch):
    cct = _reload(monkeypatch, True)
    assert "portfolio_heat" in cct.TOOLS and "grade_watchlist" in cct.TOOLS
    from api.services import portfolio_heat as ph, grade_watchlist as gw
    monkeypatch.setattr(ph, "portfolio_heat",
                        lambda user_id, account_id=None, account_size=None: {"ok": True, "risk_heat_pct": 1.0})
    monkeypatch.setattr(gw, "grade_watchlist",
                        lambda user_id, account_id=None, symbols=None, source="watchlist", account_size=None: {"ok": True, "graded": []})
    assert cct.TOOLS["portfolio_heat"]["executor"](user_id="u", account_id="a", args={}, conn=None)["risk_heat_pct"] == 1.0
    assert cct.TOOLS["grade_watchlist"]["executor"](user_id="u", account_id="a", args={"source": "flagged"}, conn=None)["ok"] is True
    monkeypatch.setenv("BRAIN_TOOLS_ENABLED", "0")
    importlib.reload(cct)


def test_absent_when_flag_off(monkeypatch):
    cct = _reload(monkeypatch, False)
    assert "portfolio_heat" not in cct.TOOLS and "grade_watchlist" not in cct.TOOLS
    monkeypatch.setenv("BRAIN_TOOLS_ENABLED", "0")
    importlib.reload(cct)
