from api.services import groups


def test_normalize_sym_hyphen_and_upper():
    assert groups.normalize_sym("brk.b") == "BRK-B"
    assert groups.normalize_sym("AAPL") == "AAPL"
    assert groups.normalize_sym(" nvda ") == "NVDA"


def test_to_taxonomy_sym_uses_dot():
    assert groups.to_taxonomy_sym("BRK-B") == "BRK.B"
    assert groups.to_taxonomy_sym("aapl") == "AAPL"


def test_is_chartable_uses_cap_universe(monkeypatch):
    monkeypatch.setattr(groups, "cap_universe_set", lambda: {"AAPL", "BRK-B"})
    assert groups.is_chartable("AAPL") is True
    assert groups.is_chartable("brk.b") is True     # normalized to BRK-B
    assert groups.is_chartable("ZZZZ") is False


def test_cap_universe_set_loads_and_normalizes(tmp_path, monkeypatch):
    p = tmp_path / "cap.json"
    p.write_text('["aapl", "BRK.B", "", "nvda"]', encoding="utf-8")
    groups._CAP_CACHE["set"] = None
    monkeypatch.setattr(groups, "_cap_universe_path", lambda: str(p))
    s = groups.cap_universe_set()
    assert "AAPL" in s and "BRK-B" in s and "NVDA" in s
    assert "" not in s


def test_cap_universe_set_missing_file_returns_empty_and_does_not_cache(monkeypatch):
    groups._CAP_CACHE["set"] = None
    monkeypatch.setattr(groups, "_cap_universe_path", lambda: "/no/such/cap_universe.json")
    assert groups.cap_universe_set() == set()
    assert groups._CAP_CACHE["set"] is None    # failure not cached -> retries next call


def test_list_groups_shapes_and_chartable_count(monkeypatch):
    fake = {"sectors": [], "themes": [
        {"id": "space", "name": "Space", "sector_id": "innovation",
         "etf_ticker": "UFO", "sub_themes": [{"id": "launch", "name": "Launch"}],
         "holdings": [{"sym": "RKLB"}, {"sym": "ASTS"}, {"sym": "DEADCO"}]},
    ]}
    monkeypatch.setattr(groups, "_get_all_themes", lambda: fake)
    monkeypatch.setattr(groups, "cap_universe_set", lambda: {"RKLB", "ASTS"})
    monkeypatch.setattr(groups, "_rotation_order", lambda: {})
    out = groups.list_groups()
    row = next(r for r in out if r["id"] == "space")
    assert row["total"] == 3
    assert row["chartable"] == 2          # DEADCO excluded
    assert row["etf_ticker"] == "UFO"
    assert row["sub_theme_count"] == 1
