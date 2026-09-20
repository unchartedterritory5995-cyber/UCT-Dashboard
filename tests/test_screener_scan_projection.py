"""Scan projection + strict sort validation."""
import pytest


def _seed(monkeypatch, tmp_path):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    from api.services.screener import snapshot_db
    snapshot_db.init_db()
    snapshot_db.upsert_rows([
        {"ticker": "AAA", "price": 10.0, "rsi14": 55.0, "uct_composite": 90,
         "sector": "Tech", "snapshot_date": "2026-08-21"},
        {"ticker": "BBB", "price": 20.0, "rsi14": 45.0, "uct_composite": 80,
         "sector": "Tech", "snapshot_date": "2026-08-21"},
    ])


def test_projection_returns_only_requested_plus_ticker_and_sort(monkeypatch, tmp_path):
    _seed(monkeypatch, tmp_path)
    from api.services.screener import query
    out = query.run_scan({"columns": ["price"], "sort": {"key": "rsi14", "dir": "desc"}})
    assert out["view_columns"] == ["ticker", "price", "rsi14"]
    assert set(out["rows"][0].keys()) == {"ticker", "price", "rsi14"}
    assert [r["ticker"] for r in out["rows"]] == ["AAA", "BBB"]  # rsi 55 first


def test_unknown_column_is_a_400_shaped_valueerror(monkeypatch, tmp_path):
    _seed(monkeypatch, tmp_path)
    from api.services.screener import query
    with pytest.raises(ValueError, match="unknown columns: nope"):
        query.run_scan({"columns": ["nope"]})


def test_unknown_sort_key_no_longer_silently_substitutes(monkeypatch, tmp_path):
    _seed(monkeypatch, tmp_path)
    from api.services.screener import query
    with pytest.raises(ValueError, match="unknown sort key"):
        query.run_scan({"sort": {"key": "not_a_column"}})
    # absent sort still defaults quietly — only a WRONG key is refused
    assert query.run_scan({})["rows"]


def test_no_columns_keeps_full_rows_and_view_columns(monkeypatch, tmp_path):
    _seed(monkeypatch, tmp_path)
    from api.services.screener import query
    out = query.run_scan({"view": "overview"})
    assert "rsi14" in out["rows"][0]          # SELECT * unchanged
    assert out["view_columns"]                 # view echo unchanged


def test_base_render_scan_attaches_base_bias_without_leaking_base_matches(monkeypatch, tmp_path):
    # Regression: the structure tag's colour needs base_bias, derived from
    # base_matches — but the client's explicit `columns` omits base_matches, so
    # the SELECT must fetch it for the derivation and then NOT leak it into the
    # returned rows (the requested-columns projection stays exact).
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    from api.services.screener import snapshot_db, query
    snapshot_db.init_db()
    snapshot_db.upsert_rows([
        {"ticker": "AAA", "price": 10.0, "uct_composite": 90,
         "base_render": "Advancing Structure", "base_shape": "advancing-structure",
         "base_matches": ",advancing-structure,", "snapshot_date": "2026-08-21"},
    ])
    out = query.run_scan({"columns": ["base_render"],
                          "sort": {"key": "uct_composite", "dir": "desc"}})
    row = out["rows"][0]
    assert row["base_bias"] == "bullish"           # derived, colours the tag
    assert "base_matches" not in row               # internal column not leaked
    assert "base_matches" not in out["view_columns"]
    assert row["base_render"] == "Advancing Structure"


def test_display_companion_is_fetched_but_not_a_duplicate_column(monkeypatch, tmp_path):
    # candle_type's formatter renders its rich label from row.candle_label. The
    # view lists candle_type WITHOUT candle_label, so the query must FETCH the
    # companion (kept in the row for the frontend) while NOT adding it as a
    # displayed column — that is what removes the duplicate "Candle"/"Candle
    # Label" columns.
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    from api.services.screener import snapshot_db, query
    snapshot_db.init_db()
    snapshot_db.upsert_rows([
        {"ticker": "AAA", "candle_type": "tweezer-top",
         "candle_label": "Tweezer Top (Hanging Man)", "snapshot_date": "2026-08-21"},
    ])
    out = query.run_scan({"columns": ["candle_type"]})
    assert "candle_label" not in out["view_columns"]          # not shown twice
    assert out["rows"][0]["candle_label"] == "Tweezer Top (Hanging Man)"  # fetched


def test_uct_universe_gate_filters_to_liquid_priced_names(monkeypatch, tmp_path):
    # UCT Universe = the curated subset (price >= $5 AND 30d $-vol >= $20M);
    # "all"/absent = the full market. Resolved server-side, never a member chip.
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    from api.services.screener import snapshot_db, query
    snapshot_db.init_db()
    snapshot_db.upsert_rows([
        {"ticker": "LIQ", "price": 50.0, "dollar_vol_30d": 50_000_000, "snapshot_date": "2026-08-21"},
        {"ticker": "CHEAP", "price": 3.0, "dollar_vol_30d": 50_000_000, "snapshot_date": "2026-08-21"},
        {"ticker": "THIN", "price": 50.0, "dollar_vol_30d": 5_000_000, "snapshot_date": "2026-08-21"},
    ])
    allm = query.run_scan({"columns": ["price"]})
    assert {r["ticker"] for r in allm["rows"]} == {"LIQ", "CHEAP", "THIN"}   # full market
    uct = query.run_scan({"columns": ["price"],
                          "filters": [{"key": "universe", "op": "eq", "value": "uct"}]})
    assert {r["ticker"] for r in uct["rows"]} == {"LIQ"}                     # only liquid + priced
    allv = query.run_scan({"columns": ["price"],
                           "filters": [{"key": "universe", "op": "eq", "value": "all"}]})
    assert len(allv["rows"]) == 3                                           # "all" adds no clause
