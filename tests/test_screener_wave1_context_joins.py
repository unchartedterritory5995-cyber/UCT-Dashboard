"""Context joins: healthy source answers for everyone; dead source stays None."""
from api.services.screener import context_joins


def test_breadth_flags_healthy_and_absent(monkeypatch):
    from api.services import breadth_monitor
    monkeypatch.setattr(breadth_monitor, "get_universe_stocks", lambda: {
        "date": "2026-08-20", "universe_count": 2,
        "stocks": [{"ticker": "AAA", "tags": ["s2", "hvc"]},
                   {"ticker": "BBB", "tags": ["s4"]}]})
    out = context_joins.read_breadth_flags(["AAA", "BBB", "CCC"])
    assert out["AAA"] == {"stage2": True, "stage4": False, "hvc_52w": True}
    assert out["BBB"]["stage4"] is True
    assert out["CCC"] == {"stage2": False, "stage4": False, "hvc_52w": False}


def test_breadth_flags_dead_source_is_empty(monkeypatch):
    from api.services import breadth_monitor
    monkeypatch.setattr(breadth_monitor, "get_universe_stocks",
                        lambda: {"date": None, "stocks": []})
    fails = {}
    assert context_joins.read_breadth_flags(["AAA"], failures=fails) == {}
    assert fails["breadth_flags"]["empty"] == 1


def test_uct20_coalesces_ticker_spellings(monkeypatch):
    from api.services import engine
    monkeypatch.setattr(engine, "get_leadership", lambda: [
        {"ticker": "NVDA"}, {"sym": "MU"}, {"symbol": "AVGO"}])
    out = context_joins.read_uct20(["NVDA", "MU", "AVGO", "AAPL"])
    assert out["MU"]["in_uct20"] is True
    assert out["AAPL"]["in_uct20"] is False
    monkeypatch.setattr(engine, "get_leadership", lambda: [])
    assert context_joins.read_uct20(["NVDA"]) == {}


def test_index_flags(monkeypatch):
    from api.services import watchlist_prebuilt
    monkeypatch.setattr(watchlist_prebuilt, "_load_lists", lambda: [
        {"name": "S&P 500", "tickers": ["AAA"]},
        {"name": "Nasdaq 100", "tickers": ["AAA", "BBB"]},
        {"name": "Dow 30", "tickers": []},
        {"name": "Russell 2000", "tickers": ["CCC"]}])
    out = context_joins.read_index_flags(["AAA", "CCC"])
    assert out["AAA"] == {"index_sp500": True, "index_ndx": True,
                          "index_dow": False, "index_r2k": False}
    assert out["CCC"]["index_r2k"] is True


def test_index_flags_a_missing_list_stays_not_computable(monkeypatch):
    """Dow 30 is entirely ABSENT from _load_lists() (not merely empty) — its
    column must be missing from every ticker's dict, never a confident False,
    and the miss must be counted."""
    from api.services import watchlist_prebuilt
    monkeypatch.setattr(watchlist_prebuilt, "_load_lists", lambda: [
        {"name": "S&P 500", "tickers": ["AAA"]},
        {"name": "Nasdaq 100", "tickers": ["AAA", "BBB"]},
        {"name": "Russell 2000", "tickers": ["CCC"]}])
    fails = {}
    out = context_joins.read_index_flags(["AAA", "CCC"], failures=fails)
    assert out["AAA"] == {"index_sp500": True, "index_ndx": True,
                          "index_r2k": False}
    assert "index_dow" not in out["AAA"]
    assert out["CCC"] == {"index_sp500": False, "index_ndx": False,
                          "index_r2k": True}
    assert "index_dow" not in out["CCC"]
    assert fails["index_lists"]["missing:1"] == 1


def test_etf_flags_a_dead_ssetf_leg_is_not_computable_and_is_etf_is_never_emitted(monkeypatch):
    """`is_etf` is no longer this reader's (it is derived from `security_type`
    in `build_row`, audit 2026-10-15 #3). With its one remaining leg dead the
    reader answers {} — not-computable — and counts the failure by name; and it
    does not consult the Finviz industry list at all any more."""
    from api.services import industry_map, single_stock_etfs
    consulted = []
    monkeypatch.setattr(industry_map, "tickers_in_industry",
                        lambda industry: consulted.append(industry) or ["SPY"])

    def boom():
        raise RuntimeError("no db")
    monkeypatch.setattr(single_stock_etfs, "_connect", boom)
    fails = {}
    out = context_joins.read_etf_flags(["SPY", "NVDA"], failures=fails)
    assert out == {}
    assert "RuntimeError" in fails["ssetf"]
    assert consulted == []                          # the second authority is gone


def test_theme_captured_by_read_fundamentals(monkeypatch):
    import api.services.ticker_meta as tm
    monkeypatch.setattr(tm, "get_ticker_meta", lambda t: {
        "name": "Nvidia", "sector": "Technology", "industry": "Semis",
        "exchange": "NASDAQ", "theme": "AI Infrastructure"})
    from api.services.screener import snapshot_builder
    out = snapshot_builder._read_fundamentals("NVDA")
    assert out["theme"] == "AI Infrastructure"
