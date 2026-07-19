from tools.theme_curation import discover


def test_extract_tickers():
    txt = "NVDA — dominant GPU\n$AMD — competitor\nnot-a-line\nBRK.B — holding"
    assert discover.extract_tickers(txt) == ["NVDA", "AMD", "BRK-B"]


def test_discover_uses_list_mode(monkeypatch):
    calls = {}
    def fake_ws(query, **kw):
        calls.update(kw); calls["query"] = query
        return {"answer": "RKLB — launch\nASTS — sats", "error": None}
    monkeypatch.setattr(discover, "web_search", fake_ws)
    out = discover.discover("Space", "run1")
    assert out["tickers"] == ["RKLB", "ASTS"] and out["error"] is None
    assert calls["max_tokens"] == 1500 and calls["domain_pack"] == "finance"
    assert calls["cache_salt"] == "run1" and calls["system"]          # list-mode override present


def test_discover_surfaces_error(monkeypatch):
    monkeypatch.setattr(discover, "web_search",
                        lambda q, **k: {"answer": "", "error": "rate limited"})
    out = discover.discover("Space", "run1")
    assert out["error"] == "rate limited" and out["tickers"] == []


def test_confirm_intersects(monkeypatch):
    seq = iter([{"answer": "AAA — x\nBBB — y", "error": None},
                {"answer": "BBB — y\nCCC — z", "error": None}])
    monkeypatch.setattr(discover, "web_search", lambda q, **k: next(seq))
    out = discover.discover("Quantum", "run1", confirm=True)
    assert out["tickers"] == ["BBB"]
