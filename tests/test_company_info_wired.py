from api.services import voice_tool_impls as vti


def test_company_info_returns_real_meta(monkeypatch):
    import api.services.ticker_meta as tm
    monkeypatch.setattr(tm, "get_ticker_meta",
                        lambda s: {"name": "NVIDIA", "sector": "Technology", "industry": "Semiconductors"})
    out = vti._get_company_info("nvda")
    assert out["symbol"] == "NVDA" and out["sector"] == "Technology"
    assert "not yet wired" not in str(out)  # no longer the stub


def test_company_info_honest_when_empty(monkeypatch):
    import api.services.ticker_meta as tm
    monkeypatch.setattr(tm, "get_ticker_meta", lambda s: {})
    monkeypatch.setattr("api.services.fundamentals.get_fundamentals", lambda s: {})
    out = vti._get_company_info("ZZZZ")
    assert out["symbol"] == "ZZZZ" and "note" in out


def test_company_info_never_raises(monkeypatch):
    import api.services.ticker_meta as tm
    monkeypatch.setattr(tm, "get_ticker_meta", lambda s: (_ for _ in ()).throw(RuntimeError()))
    out = vti._get_company_info("NVDA")
    assert isinstance(out, dict)
