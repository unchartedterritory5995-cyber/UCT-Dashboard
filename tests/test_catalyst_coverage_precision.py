# tests/test_catalyst_coverage_precision.py
from api.services.catalyst import ticker_metadata as tm


def test_fetch_via_yfinance_maps_float_and_shares(monkeypatch):
    class FakeTicker:
        def __init__(self, sym):
            self.info = {
                "sector": "Technology", "industry": "Semis",
                "marketCap": 5_000_000_000, "averageVolume10days": 1_200_000,
                "fiftyTwoWeekHigh": 99.0, "quoteType": "EQUITY",
                "floatShares": 40_000_000, "sharesOutstanding": 50_000_000,
            }

    import yfinance
    monkeypatch.setattr(yfinance, "Ticker", FakeTicker)
    out = tm._fetch_via_yfinance("FOO")
    assert out["float_shares"] == 40_000_000
    assert out["shares_outstanding"] == 50_000_000


def test_enrich_snapshot_includes_float(monkeypatch):
    from api.services.catalyst import sources
    monkeypatch.setattr(sources, "_get_client", lambda: None, raising=False)

    class _Client:
        def get_batch_rich_snapshots(self, tickers):
            return {"FOO": {"price": 10.0, "vol": 2_000_000, "prev_close": 9.0}}

    monkeypatch.setattr("api.services.massive._get_client", lambda: _Client())
    monkeypatch.setattr(
        "api.services.catalyst.ticker_metadata.get_metadata_batch",
        lambda tickers: {"FOO": {"avg_volume_30d": 1_000_000, "market_cap": 1e9,
                                 "sector": "Tech", "float_shares": 3_000_000,
                                 "shares_outstanding": 4_000_000}},
    )
    out = sources._enrich_with_snapshot(["FOO"])
    assert out["FOO"]["float_shares"] == 3_000_000
    assert out["FOO"]["shares_outstanding"] == 4_000_000


from api.services.catalyst import filters


def test_quality_gate_drops_low_float(monkeypatch):
    monkeypatch.setenv("CATALYST_MIN_FLOAT", "5000000")
    c = {"quote_type": "EQUITY", "price": 8.0, "avg_volume_30d": 2_000_000,
         "market_cap": 4e8, "float_shares": 1_000_000}
    passed, reason = filters.quality_gate(c)
    assert passed is False
    assert "float" in (reason or "").lower()


def test_quality_gate_failopen_when_float_missing(monkeypatch):
    monkeypatch.setenv("CATALYST_MIN_FLOAT", "5000000")
    c = {"quote_type": "EQUITY", "price": 8.0, "avg_volume_30d": 2_000_000,
         "market_cap": 4e8}  # no float_shares
    passed, _ = filters.quality_gate(c)
    assert passed is True


def test_analyst_action_is_a_real_catalyst():
    c = {"gap_pct": 1.0, "vol_x": 1.0,
         "analyst_meta": {"action": "upgrade", "firm": "MS"}}
    passed, _ = filters.is_real_catalyst(c)
    assert passed is True


def test_gate_rejection_log_roundtrip(monkeypatch, tmp_path):
    db = tmp_path / "catalysts.db"
    monkeypatch.setenv("CATALYST_DB_PATH", str(db))
    import importlib
    from api.services.catalyst import store as store_mod
    importlib.reload(store_mod)
    store_mod._init_db()
    store_mod.log_rejection(market_date="2026-06-15", ticker="JUNK",
                            reason="float 1.0M shares below 5.0M floor",
                            price=8.0, dollar_vol=1.6e7, float_shares=1_000_000,
                            market_cap=4e8)
    rows = store_mod.recent_rejections(limit=10)
    assert any(r["ticker"] == "JUNK" and "float" in r["reason"] for r in rows)
    importlib.reload(store_mod)  # restore default DB path for other tests


def test_analyst_candidates_from_wire(monkeypatch):
    from api.services.catalyst import analyst_actions as aa
    monkeypatch.setattr(
        "api.services.engine.get_analyst_actions",
        lambda: {"upgrades": [{"ticker": "AAA", "action": "upgrade",
                               "firm": "MS", "from_rating": "Hold",
                               "to_rating": "Buy", "price_target": "$120"}],
                 "downgrades": [], "pt_changes": []},
    )
    monkeypatch.setenv("THEFLY_API_KEY", "")  # TheFly off
    out = aa.get_analyst_candidates()
    assert "AAA" in out
    assert out["AAA"]["action"] == "upgrade"
    assert out["AAA"]["firm"] == "MS"


def test_collect_all_merges_analyst_meta(monkeypatch):
    from api.services.catalyst import sources
    monkeypatch.setattr(sources, "_pull_movers", lambda: {})
    monkeypatch.setattr(sources, "_pull_gap_scan", lambda: {})
    monkeypatch.setattr(sources, "_pull_earnings", lambda: {})
    monkeypatch.setattr(sources, "_pull_tweet_signals", lambda: {})
    monkeypatch.setattr(sources, "_pull_rss_signals", lambda: {})
    monkeypatch.setattr(sources, "_pull_scanner_setups", lambda: {})
    monkeypatch.setattr(sources, "_pull_perplexity_discovery", lambda: {})
    monkeypatch.setattr(
        "api.services.catalyst.analyst_actions.get_analyst_candidates",
        lambda: {"AAA": {"action": "upgrade", "firm": "MS"}},
    )
    monkeypatch.setattr(sources, "_enrich_with_snapshot",
                        lambda tickers: {"AAA": {"price": 50.0, "vol_x": 1.0}})
    cands = sources.collect_all()
    aaa = next(c for c in cands if c["ticker"] == "AAA")
    assert aaa["analyst_meta"]["action"] == "upgrade"


from api.services.catalyst import tagging


def test_analyst_meta_tags_as_catalyst():
    c = {"gap_pct": 1.0, "vol_x": 1.0, "tweets": [], "rss": [],
         "analyst_meta": {"action": "upgrade", "firm": "MS"}}
    assert tagging.assign_tag(c) == "Catalyst"


from api.services.catalyst import scoring


def test_analyst_action_scores_higher():
    base = {"gap_pct": 2.0, "vol_x": 1.0, "price": 50.0}
    with_analyst = {**base, "analyst_meta": {"action": "upgrade"}}
    assert scoring.score(with_analyst) > scoring.score(base)
