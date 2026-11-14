"""RS screens unit U1, parts A and E: the flag, the fourth dark family and the nine
columns' registrations.

``RS_SCREENS_ENABLED`` is off by default. While it is off, no member may see a control
or a column this programme adds: ``filters.rs_dark_keys`` hides every key in
``filters.RS_SCREENS_KEYS`` from the screener's ``meta()``. The nine columns the post-pass
writes are registered once in each place a screener column lives, and every one is kept
out of UCT Agent's field list (its request budget has no room).
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from api.services.screener import filters as F
from api.services.screener import methodology as M
from api.services.screener import rs_post_pass as pp
from api.services.screener import snapshot_db

ROOT = Path(__file__).resolve().parents[1]
COLUMN_DEFS_JS = ROOT / "app" / "src" / "pages" / "screener" / "columnDefs.js"
PLAIN_WORDS_JS = ROOT / "app" / "src" / "pages" / "screener" / "focus" / "plainWords.js"
CLOSED_TABLE = ROOT / "app" / "src" / "components" / "chart" / "engine" / "ast" / "closedTable.json"

LABELS = {
    "rs_rating_pos": "RS Rating place",
    "rs_rating_pos_prev20": "Place a month ago",
    "rs_pos_1m": "1M place", "rs_pos_3m": "3M place", "rs_pos_6m": "6M place",
    "rs_pos_12m": "12M place",
    "rs_rating_session": "Ratings as of",
    "rs_rating_pos_n": "Stocks ranked",
    "rs_rating_score": "RS Rating score",
}
NINE = tuple(LABELS)
#: Trade words that read as advice, and the one abbreviation never shown beside RS.
BANNED = re.compile(r"\b(buy|buys|buying|buyable|sell|sells|selling|RSI)\b", re.I)


# ───────────────────────── the flag ─────────────────────────

def test_the_flag_has_a_ledger_row_and_ships_dark():
    row = json.loads((ROOT / "docs" / "feature_flags.json").read_text(encoding="utf-8"))["flags"][pp.FLAG]
    assert pp.FLAG == "RS_SCREENS_ENABLED"
    assert row["status"] == "dark" and row["where"] == ["web"]
    assert "rs_post_pass.enabled" in row["note"] and "RS_SCREENS_KEYS" in row["note"]


def test_the_flag_is_read_per_call_and_only_1_arms_it(monkeypatch):
    monkeypatch.delenv(pp.FLAG, raising=False)
    assert pp.enabled() is False and F._rs_screens_on() is False
    for value, armed in (("1", True), ("0", False), ("true", False), ("", False), ("yes", False)):
        monkeypatch.setenv(pp.FLAG, value)
        assert pp.enabled() is armed and F._rs_screens_on() is armed, value


# ───────────────────────── the fourth dark family ─────────────────────────

def test_the_family_is_exactly_the_columns_the_pass_writes():
    assert set(F.RS_SCREENS_KEYS) == set(pp.OWNED_COLUMNS) == set(snapshot_db.POST_PASS_COLUMNS) == set(NINE)
    assert len(F.RS_SCREENS_KEYS) == len(set(F.RS_SCREENS_KEYS)) == 9


def test_every_screens_key_is_dark_while_the_flag_is_off_whatever_the_other_flags_say():
    family = frozenset(F.RS_SCREENS_KEYS)
    for v2 in (True, False):
        for history in (True, False):
            for v3 in (True, False):
                dark = F.rs_dark_keys(v2_on=v2, history_on=history, v3_on=v3, screens_on=False)
                assert family <= dark, (v2, history, v3)
                lit = F.rs_dark_keys(v2_on=v2, history_on=history, v3_on=v3, screens_on=True)
                assert not (family & lit), (v2, history, v3)
                assert dark - family == lit, "the flag moved a key outside its own family"
    assert F.rs_dark_keys(v2_on=True, history_on=True, v3_on=True, screens_on=True) == frozenset()


def test_the_flag_itself_is_what_rs_dark_keys_reads(monkeypatch):
    monkeypatch.delenv(pp.FLAG, raising=False)
    assert frozenset(F.RS_SCREENS_KEYS) <= F.rs_dark_keys(v2_on=True, history_on=True, v3_on=True)
    monkeypatch.setenv(pp.FLAG, "1")
    assert not (frozenset(F.RS_SCREENS_KEYS) & F.rs_dark_keys(v2_on=True, history_on=True, v3_on=True))


def test_meta_serves_no_screens_control_column_or_comparison_while_dark(monkeypatch):
    """The payload a member's browser receives, both ways."""
    from api.services.screener import distribution
    monkeypatch.setattr(distribution, "distributions", lambda: {"basis": None})
    monkeypatch.setattr(F, "_rs_v2_on", lambda: True)
    monkeypatch.setattr(F, "_rs_history_on", lambda: True)
    monkeypatch.setattr(F, "_rs_v3_on", lambda: True)

    def served():
        meta = F.meta()
        rs_view = next(v for v in meta["views"] if v["key"] == "relative_strength")["columns"]
        return ({f["key"] for f in meta["filters"]}, set(rs_view),
                {c["key"] for c in meta["comparable_fields"]}, meta)

    monkeypatch.delenv(pp.FLAG, raising=False)
    keys, view, comparable, _meta = served()
    assert not (set(NINE) & keys) and not (set(NINE) & view) and not (set(NINE) & comparable)
    assert "rs_rating_ibd" in keys, "the control: the rating family itself is served"

    monkeypatch.setenv(pp.FLAG, "1")
    keys, view, comparable, meta = served()
    assert set(NINE) <= keys
    hidden = {"rs_rating_score", "rs_rating_pos_n"}
    assert set(NINE) - hidden <= view and not (hidden & view), "the score and the count are not picker columns"
    assert hidden <= set(meta["picker_hidden"])
    assert {f["key"] for f in meta["filters"] if f.get("picker_hidden")} >= hidden
    assert not (hidden & comparable)


# ───────────────────────── the registrations ─────────────────────────

def test_each_is_a_bare_relative_strength_control_kept_from_the_agent():
    catalog = {f["key"]: f for f in F.field_catalog()}
    for key, label in LABELS.items():
        f = F.FILTERS[key]
        assert f["label"] == label, key
        assert f["category"] == "relative_strength" and f["column"] == key, key
        assert f["type"] == "range" and [p["label"] for p in f["presets"]] == ["Any"], \
            f"{key}: a place carries no published threshold"
        assert f.get("agent_omit") is True and catalog[key].get("agent_omit") is True, key
        assert key in F.VIEWS["relative_strength"]["columns"], f"{key} has no seat in the RS view"
        assert key in snapshot_db.COLUMNS
    assert {"rs_rating_score", "rs_rating_pos_n"} <= F.picker_hidden_keys()
    assert not (set(NINE) - {"rs_rating_score", "rs_rating_pos_n"}) & F.picker_hidden_keys()


def test_each_publishes_a_method_in_plain_words_with_the_floor_read_from_its_constant():
    price = f"${pp.LIQUID_FLOOR['price_min']:g}"
    dollar = f"${pp.LIQUID_FLOOR['dollar_vol_30d_min'] / 1e6:g}M"
    assert (price, dollar) == ("$10", "$20M")
    for key, label in LABELS.items():
        m = M.for_column(key)
        assert m is not None and m["label"] == label and m["family"] == M.RS_FAMILY, key
        text = " ".join(m[k] for k in ("one_line", "scale", "how", "caveat"))
        assert m["how"].endswith(M._RS_SCREENS_NOTE), f"{key}: the method must say it is empty while dark"
        own = m["how"][:-len(M._RS_SCREENS_NOTE)]
        assert "Blank" in own, f"{key}: the method must say when the column itself is blank"
        assert "—" not in text and not BANNED.search(text), key
    for key in ("rs_rating_pos", "rs_rating_pos_n", "rs_pos_1m", "rs_pos_3m", "rs_pos_6m", "rs_pos_12m"):
        how = M.for_column(key)["how"]
        assert f"price {price} or more" in how and f"{dollar} or more traded a day" in how, key
    assert f"{pp.PREV_SESSIONS} stored sessions earlier" in M.for_column("rs_rating_pos_prev20")["one_line"]
    assert M.for_column("rs_rating_pos")["one_line"] == \
        "Where this stock ranks by RS Rating among liquid stocks: 1 is the strongest."
    assert set(NINE) <= set(M.all_methods()["rs_columns"]["columns"])


def _js_entry(key):
    src = COLUMN_DEFS_JS.read_text(encoding="utf-8")
    m = re.search(rf"\n  {key}: \{{ label: '([^']*)', fmt: ([^\n]*?),\s*\n    desc: '((?:[^'\\]|\\.)*)' \}},", src)
    assert m, f"{key} has no column definition"
    return m.group(1), m.group(2), m.group(3)


def test_each_has_a_column_definition_whose_words_match_the_server():
    plain = PLAIN_WORDS_JS.read_text(encoding="utf-8")
    for key, label in LABELS.items():
        js_label, fmt, desc = _js_entry(key)
        assert js_label == label, key
        assert len(desc) > 60 and "—" not in desc and not BANNED.search(desc), key
        assert re.search(rf"\n  {key}: '[^']+',", plain), f"{key} has no plain name"
    _label, _fmt, desc = _js_entry("rs_rating_pos")
    assert "price $10 or more" in desc and "$20M or more traded a day" in desc
    assert desc.startswith("Where this stock ranks by RS Rating among liquid stocks: 1 is the strongest.")
    assert _js_entry("rs_rating_pos_prev20")[2].count(f"{pp.PREV_SESSIONS} stored sessions") == 1
    assert _js_entry("rs_rating_score")[1] == "num(4)" and _js_entry("rs_rating_pos")[1] == "num(0)"


def test_none_is_a_formula_scalar_until_it_is_filled():
    table = json.loads(CLOSED_TABLE.read_text(encoding="utf-8"))
    for key in NINE:
        assert key not in table["scalars"], key
        why = table["_scalars_excluded"][key]
        assert "2026-11-14" in why and "RS_SCREENS_ENABLED" in why, key


@pytest.mark.parametrize("key", NINE)
def test_a_screen_can_filter_and_sort_on_it(key, tmp_path, monkeypatch):
    """Registered end to end: the scan accepts the key as a filter and as a sort."""
    import importlib
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    snapshot_db.init_db()
    value = {"rs_rating_session": "2026-11-12", "rs_rating_score": 1.5}.get(key, 3)
    snapshot_db.upsert_rows([
        {"ticker": "HIT", key: value, "snapshot_date": "2026-11-13", "built_at": 1},
        {"ticker": "BLANK", "snapshot_date": "2026-11-13", "built_at": 1},
    ])
    from api.services.screener import query
    importlib.reload(query)
    spec = {"filters": [{"key": key, "op": "gte", "min": value}], "sort": {"key": key, "dir": "asc"}}
    assert [r["ticker"] for r in query.run_scan(spec)["rows"]] == ["HIT"], "a NULL is no value, never a match"
