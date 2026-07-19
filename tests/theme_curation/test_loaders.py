import json
from tools.theme_curation import loaders


def test_norm_and_to_dot_roundtrip():
    assert loaders.norm("brk.b") == "BRK-B"
    assert loaders.to_dot("BRK-B") == "BRK.B"
    assert loaders.norm(" aapl ") == "AAPL"


def test_cap_universe_set_is_hyphen_upper(tmp_path):
    p = tmp_path / "cap.json"
    p.write_text('["aapl","BRK.B","nvda"]', encoding="utf-8")
    s = loaders.cap_universe_set(str(p))
    assert s == {"AAPL", "BRK-B", "NVDA"}


def test_holding_syms_normalized(tmp_path):
    tax = {"themes": [{"id": "x", "holdings": [{"sym": "BRK.B"}, {"sym": "aapl"}]}]}
    theme = loaders.theme_by_id(tax)["x"]
    assert loaders.holding_syms(theme) == ["BRK-B", "AAPL"]


def test_load_save_roundtrip(tmp_path):
    p = tmp_path / "t.json"
    data = {"version": "1.0.0", "themes": []}
    loaders.save_taxonomy(str(p), data)
    assert loaders.load_taxonomy(str(p)) == data


def test_save_taxonomy_overwrites_atomically(tmp_path):
    p = tmp_path / "t.json"
    loaders.save_taxonomy(str(p), {"version": "1.0.0", "themes": []})
    loaders.save_taxonomy(str(p), {"version": "2.0.0", "themes": [{"id": "x"}]})
    assert loaders.load_taxonomy(str(p)) == {"version": "2.0.0", "themes": [{"id": "x"}]}
    # no leftover temp files in the dir
    assert not any(f.name.endswith(".tmp") for f in tmp_path.iterdir())
