"""Two definitions, one name: the pattern-engine filter must say whose verdict it is.

The engine library (`pattern_engine_id`) and the base catalog (`base_structure`, the
read on each row's setup line) are separate detectors that share names: Flat Base,
Double Bottom, High Tight Flag, Wyckoff Spring, and the engine's VCP beside the
catalog's Volatility Contraction. Measured on production 2026-10-15 they disagree
about who carries them (Flat Base 269 vs 257 with 79 in both; VCP 386 vs 58 with 6
in both), so a member filtering "VCP" must be told it is the engine's VCP.
"""
from api.services.screener import base_catalog, distribution, filters

ENGINE = filters.FILTERS["pattern_engine_id"]
BASE = filters.FILTERS["base_structure"]


def test_the_engine_filter_label_names_the_engine():
    assert "engine" in ENGINE["label"].lower()
    assert ENGINE["label"] != BASE["label"]
    # The chip reads "<label>: <option>", so a shared option name stays distinguishable.
    assert "engine" not in BASE["label"].lower()


def test_the_engine_filter_description_says_it_is_not_the_base_read():
    d = ENGINE["description"]
    assert "pattern-engine" in d and "Base Structure" in d
    assert "separate detector" in d and "setup line" in d


def test_meta_ships_the_description_beside_the_control(monkeypatch):
    monkeypatch.setattr(distribution, "distributions", lambda: {"basis": {"snapshot_date": "x"}, "columns": {}})
    monkeypatch.setattr(filters, "_distinct_options", lambda col: [{"label": "Any"}])
    monkeypatch.setattr(filters, "_distinct_list_options", lambda col: [{"label": "Any"}])
    monkeypatch.setattr(filters, "_structure_evidence", lambda: {})
    filters._SHARED_CACHE.clear()
    try:
        by_key = {f["key"]: f for f in filters.meta()["filters"]}
    finally:
        filters._SHARED_CACHE.clear()
    assert by_key["pattern_engine_id"]["description"] == filters.PATTERN_ENGINE_DESCRIPTION
    assert by_key["pattern_engine_id"]["label"] == ENGINE["label"]
    # Control: a filter that declares no description ships none (the field is not a blanket default).
    assert "description" not in by_key["base_structure"]


def test_detector_ids_read_as_traders_write_them():
    cases = {"vcp": "VCP", "flat_base": "Flat Base", "nr7": "NR7",
             "macd_bullish_cross": "MACD Bullish Cross", "rsi_bearish_divergence": "RSI Bearish Divergence",
             "pullback_to_10ema": "Pullback To 10 EMA", "u_and_r": "U and R",
             "td_sequential_buy": "TD Sequential Buy", "cup_handle_uct": "Cup Handle UCT",
             "avwap_reclaim": "AVWAP Reclaim", "vsa_no_supply": "VSA No Supply"}
    for tok, want in cases.items():
        assert filters._token_label(tok) == want, tok


def test_shared_names_stay_distinguishable_by_filter_label():
    """Every engine option whose name the base catalog also uses (case-insensitively)
    is only told apart by the filter label, so the two filter labels must differ."""
    catalog = {p["label"].lower() for p in base_catalog.enum_options() if p.get("label") != "Any"}
    engine_names = [filters._token_label(t) for t in ("flat_base", "double_bottom", "high_tight_flag", "wyckoff_spring", "vcp")]
    shared = [n for n in engine_names if n.lower() in catalog]
    assert shared, "no shared names found: this check would be vacuous"
    assert ENGINE["label"].lower() != BASE["label"].lower()


def test_the_option_list_uses_those_labels(tmp_path, monkeypatch):
    """The meta's option list is built from the snapshot's tokens; its labels must be the
    trader spellings above, not `title()`'s "Vcp" / "Nr7"."""
    import importlib
    import sqlite3
    from api.services.screener import snapshot_db

    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    importlib.reload(snapshot_db)
    try:
        snapshot_db.init_db()
        con = sqlite3.connect(str(tmp_path / "s.db"))
        con.execute("INSERT INTO screener_rows (ticker, snapshot_date, pattern_engine_ids) "
                    "VALUES (?,?,?)", ("AAA", "2026-10-15", ",vcp,nr7,flat_base,"))
        con.commit()
        con.close()
        opts = filters._distinct_list_options("pattern_engine_ids")
    finally:
        monkeypatch.undo()
        importlib.reload(snapshot_db)
    labels = {o["value"]: o["label"] for o in opts if o.get("value")}
    assert labels == {",vcp,": "VCP", ",nr7,": "NR7", ",flat_base,": "Flat Base"}
