"""The Agent's scanner composition, server side (owner: agent-sc): `logic`, field-to-field, `contains`, `rank`.

⛔ No model, no provider, no production data. Rows here are invented on an in-memory table with the real schema, and every
statement comes from the real `query.build_where` / `logic.to_sql`. Nothing may pass by being read rather than run.
"""
from __future__ import annotations

import json
import sqlite3

import pytest

from api.services.screener import filters, logic, query, snapshot_db
from api.services.uct_agent.scan import hidden, refine, spec as scan_spec
from api.services.uct_agent.scan.eval import composition as C

CASES = json.loads(C.CORPUS.with_name("composition_flatten_cases.json").read_text(encoding="utf-8"))


def _hidden_filter_keys() -> list:
    return sorted(k for k in hidden.hidden_keys() if k in filters.FILTERS)


def _range_hidden() -> list:
    return [k for k in _hidden_filter_keys() if filters.FILTERS[k]["type"] == "range"]


def _conn(rows: list) -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("CREATE TABLE screener_rows (" + ", ".join(snapshot_db._coldef(c) for c in snapshot_db.COLUMNS) + ")")
    for r in rows:
        cols = list(r)
        conn.execute(f"INSERT INTO screener_rows ({','.join(cols)}) VALUES ({','.join('?' for _ in cols)})", [r[c] for c in cols])
    return conn


def _tickers(conn, filters_: list, tree=None) -> list:
    where, params = query.build_where(filters_, conn=conn)
    if tree is not None:
        sql, p = logic.to_sql(tree, lambda leaf: query.build_where([leaf], conn=conn))
        where = (where + " AND " + sql) if where else " WHERE " + sql
        params = [*params, *p]
    return sorted(r["ticker"] for r in conn.execute(f"SELECT ticker FROM screener_rows{where}", params))


# ── `in` on a token-wrapped column ────────────────────────────────────────────────────────────────────────────────────
TOKEN_ROWS = [
    {"ticker": "ONLY", "candle_matches": ",hammer,"},
    {"ticker": "BOTH", "candle_matches": ",hammer,bullish-engulfing,"},
    {"ticker": "DOJI", "candle_matches": ",doji,"},
    {"ticker": "GRAVE", "candle_matches": ",gravestone-doji,"},
    {"ticker": "NONE", "candle_matches": None},
]


def test_a_plain_in_really_misses_a_multi_pattern_bar():
    """The defect, stated on the same rows the fix runs on: IN compares the whole cell."""
    conn = _conn(TOKEN_ROWS)
    rows = conn.execute("SELECT ticker FROM screener_rows WHERE candle_matches IN (?)", (",hammer,",)).fetchall()
    assert [r["ticker"] for r in rows] == ["ONLY"]
    assert conn.execute("SELECT COUNT(*) FROM screener_rows WHERE candle_matches IN (?)", ("hammer",)).fetchone()[0] == 0


@pytest.mark.parametrize("value", [",hammer,", "hammer"])
def test_in_on_a_token_list_finds_every_bar_holding_the_token(value):
    assert _tickers(_conn(TOKEN_ROWS), [{"key": "candle_type", "op": "in", "values": [value]}]) == ["BOTH", "ONLY"]


def test_in_is_any_of_and_a_token_is_exact():
    conn = _conn(TOKEN_ROWS)
    assert _tickers(conn, [{"key": "candle_type", "op": "in", "values": [",doji,", ",hammer,"]}]) == ["BOTH", "DOJI", "ONLY"]
    assert _tickers(conn, [{"key": "candle_type", "op": "in", "values": ["doji"]}]) == ["DOJI"]      # never gravestone-doji


def test_not_in_on_a_token_list_excludes_the_token_and_keeps_a_blank():
    got = _tickers(_conn(TOKEN_ROWS), [{"key": "candle_type", "op": "not_in", "values": [",hammer,"]}])
    assert got == ["DOJI", "GRAVE", "NONE"]


def test_a_token_in_means_the_same_inside_a_group():
    conn = _conn(TOKEN_ROWS)
    assert _tickers(conn, [], {"any": [{"key": "candle_type", "op": "in", "values": [",hammer,"]}]}) == ["BOTH", "ONLY"]
    assert _tickers(conn, [], {"none": [{"key": "candle_type", "op": "in", "values": [",hammer,"]}]}) == ["DOJI", "GRAVE", "NONE"]


def test_a_plain_enum_keeps_its_plain_in():
    assert not filters.is_token_list("sector") and not filters.is_token_list("price") and not filters.is_token_list("no_such")
    conn = _conn([{"ticker": "A", "sector": "Energy"}, {"ticker": "B", "sector": None}])
    assert _tickers(conn, [{"key": "sector", "op": "in", "values": ["Energy"]}]) == ["A"]


def test_preset_fields_give_their_vocabulary():
    opts = filters.preset_options()
    assert opts["candle_type"]["token"] is True and opts["candle_type"]["wire"]["Hammer"] == ",hammer,"
    assert "token" not in opts["candle_trend"] and opts["candle_trend"]["wire"]["Uptrend"] == "up"
    assert "total" not in opts["candle_type"], "a bar with no pattern is not a row we failed to classify"
    assert "sector" not in opts
    assert filters.field_options()["candle_type"]["values"] == opts["candle_type"]["values"]


@pytest.mark.parametrize("flag,want", [("1", True), ("0", False)])
def test_the_fields_route_reports_the_logic_flag(monkeypatch, flag, want):
    from api.routers import screener as route
    monkeypatch.setenv(logic.FLAG, flag)
    assert route.screener_fields(options=0, _user=None)["logic_enabled"] is want


def test_the_fields_route_names_the_live_fields():
    from api.routers import screener as route
    from api.services.screener import live_tier
    keys = route.screener_fields(options=0, _user=None)["live_fields"]
    assert {"price", "pct_vs_sma50", "pct_vs_sma200", "pct_vs_ema20"} <= set(keys)
    assert not {"pct_vs_ema9", "run_close_sma50", "new_high_lookback", "avg_volume_50d"} & set(keys), "nightly primitives"
    assert all(filters.FILTERS[k]["column"] in live_tier.LIVE_COLUMNS for k in keys)


def test_a_live_distance_says_its_clock():
    for key in ("pct_vs_sma50", "pct_vs_sma200", "pct_vs_ema20"):
        assert "mixes two clocks" in filters.FILTERS[key]["description"], key


def test_every_nightly_primitive_says_when_it_is_measured():
    live = set(filters.live_field_keys())
    for key in ("pct_vs_ema9", "pct_vs_ema10", "run_close_ema20", "avg_volume_10d", "new_high_lookback"):
        assert key not in live and "last completed session" in filters.FILTERS[key]["description"], key


# ── flattening: a flat spec only when it is EXACTLY the tree ──────────────────────────────────────────────────────────
ROWS = [
    {"ticker": "EN", "sector": "Energy", "industry": "Oil", "price": 50.0, "rsi14": 20.0, "chg_pct_1d": 6.0, "is_etf": 0, "candle_matches": ",doji,"},
    {"ticker": "TE", "sector": "Technology", "industry": "Semiconductors", "price": 5.0, "rsi14": 80.0, "chg_pct_1w": 20.0, "is_etf": 0, "candle_matches": ",hammer,doji,"},
    {"ticker": "HE", "sector": "Healthcare", "industry": "Biotech", "price": 15.0, "rsi14": 50.0, "is_etf": 1, "candle_matches": ",hammer,"},
    {"ticker": "HX", "sector": "Healthcare", "industry": "Semiconductors", "price": 10.0, "rsi14": 70.0, "is_etf": 1},
    {"ticker": "BL", "sector": None, "industry": None, "price": None, "rsi14": None, "is_etf": None},
]


@pytest.mark.parametrize("case", CASES["flatten"], ids=lambda c: c["why"])
def test_the_python_mirror_agrees_with_the_case(case):
    assert C.flatten_logic(case["tree"]) == case["flat"]


@pytest.mark.parametrize("case", [c for c in CASES["flatten"] if c["flat"] is not None], ids=lambda c: c["why"])
def test_a_flat_form_returns_the_same_rows_as_its_tree(case):
    conn = _conn(ROWS)
    assert _tickers(conn, case["flat"]) == _tickers(conn, [], case["tree"])


@pytest.mark.parametrize("tree", [
    {"none": [{"key": "price", "op": "gt", "min": 10}]},
    {"not": {"key": "is_etf", "op": "eq", "value": 1}},
])
def test_the_near_miss_a_flat_form_would_lose_is_real(tree):
    """Why these stay trees: the obvious flat spelling drops the blank row. That is the looser/other-screen trap."""
    conn = _conn(ROWS)
    assert "BL" in _tickers(conn, [], tree)
    near = {"key": "price", "op": "lte", "max": 10} if "none" in tree else {"key": "is_etf", "op": "eq", "value": 0}
    assert "BL" not in _tickers(conn, [near])


def test_the_browser_and_the_scorer_share_a_rule_for_the_flat_list():
    src = (C.CORPUS.parents[5] / "app/src/agent/capabilities/screener.js").read_text(encoding="utf-8")
    assert "export function flattenLogic" in src and "composition_flatten_cases.json" in src


@pytest.mark.parametrize("case", CASES["wire"], ids=lambda c: c["why"])
def test_what_the_browser_sends_passes_the_real_gates(case):
    C.check_spec(case["spec"])


# ── the flag ──────────────────────────────────────────────────────────────────────────────────────────────────────────
TREE = {"any": [{"key": "rsi14", "op": "lte", "max": 30}, {"key": "rsi14", "op": "gte", "min": 70}]}


def test_a_tree_with_the_flag_off_is_refused_before_admission(monkeypatch):
    monkeypatch.setenv(logic.FLAG, "0")
    assert scan_spec.precheck({"spec": {"filters": [], "logic": TREE}}) == logic.DISABLED_SENTENCE


def test_the_engine_refuses_it_on_its_own(monkeypatch):
    monkeypatch.setenv(logic.FLAG, "0")
    with pytest.raises(ValueError) as e:
        query.build_scan_sql({"filters": [], "logic": TREE}, conn=_conn([]))
    assert str(e.value) == logic.DISABLED_SENTENCE


def test_a_flat_spec_is_untouched_by_the_flag(monkeypatch):
    monkeypatch.setenv(logic.FLAG, "0")
    assert scan_spec.precheck({"spec": {"filters": [{"key": "rsi14", "op": "lte", "max": 30}]}}) is None


def test_with_the_flag_on_precheck_lets_it_through(monkeypatch):
    monkeypatch.setenv(logic.FLAG, "1")
    assert scan_spec.precheck({"spec": {"filters": [], "logic": TREE}}) is None


def test_f16_outranks_the_flag(monkeypatch):
    monkeypatch.setenv(logic.FLAG, "0")
    got = scan_spec.precheck({"spec": {"filters": [], "logic": {"any": [{"key": "rs_rank", "op": "gte", "min": 90}, TREE]}}})
    assert got == hidden.RATINGS_REFUSAL


# ── F-16: every hidden field, through every new shape ─────────────────────────────────────────────────────────────────
def _leaf(key):
    t = filters.FILTERS[key]["type"]
    return {"key": key, "op": "gte", "min": 1} if t == "range" else (
        {"key": key, "op": "eq", "value": 1} if t == "bool" else {"key": key, "op": "in", "values": ["x"]})


SHAPES = {
    "any": lambda k: {"filters": [], "logic": {"any": [_leaf(k), {"key": "price", "op": "gt", "min": 1}]}},
    "all_deep": lambda k: {"filters": [], "logic": {"all": [{"any": [{"none": [_leaf(k)]}]}]}},
    "none": lambda k: {"filters": [], "logic": {"none": [_leaf(k)]}},
    "not": lambda k: {"filters": [], "logic": {"not": _leaf(k)}},
    "beside_a_leaf": lambda k: {"filters": [], "logic": {"key": "price", "op": "gt", "min": 1, "any": [_leaf(k)]}},
}
OTHER_SHAPES = {
    "other_flat": lambda k: {"filters": [{"key": "price", "op": "gt_col", "other": k}]},
    "other_in_logic": lambda k: {"filters": [], "logic": {"any": [{"key": "price", "op": "gt_col", "other": k}]}},
    "other_on_the_left": lambda k: {"filters": [{"key": k, "op": "gt_col", "other": "price"}]},
    "rank_key": lambda k: {"filters": [], "rank": {"criteria": [{"key": k, "weight": 1}]}},
    "rank_second": lambda k: {"filters": [], "rank": {"criteria": [{"key": "price", "weight": 1}, {"key": k, "weight": 1}]}},
    "rank_column": lambda k: {"filters": [], "rank": {"criteria": [{"key": "price", "weight": 1, "column": k}]}},
    "rank_beside": lambda k: {"filters": [], "rank": {"criteria": [{"key": "price", "weight": 1}], "extra": {"key": k}}},
}


def _refused(spec_):
    with pytest.raises(scan_spec.SpecError) as e:
        scan_spec.validate(spec_)
    assert "UCT Agent can't screen" in str(e.value), str(e.value)


@pytest.mark.parametrize("shape", SHAPES)
def test_every_hidden_field_is_refused_in_every_tree_shape(shape):
    for k in _hidden_filter_keys():
        _refused(SHAPES[shape](k))


@pytest.mark.parametrize("shape", OTHER_SHAPES)
def test_every_hidden_number_is_refused_through_other_and_rank(shape):
    for k in _range_hidden():
        _refused(OTHER_SHAPES[shape](k))


@pytest.mark.parametrize("other", [["rs_rank"], {"key": "rs_rank"}, 7, ("rs_rank",)])
def test_a_non_string_other_is_a_refusal_never_a_crash(other):
    with pytest.raises(scan_spec.SpecError):
        scan_spec.validate({"filters": [{"key": "price", "op": "gt_col", "other": other}]})
    with pytest.raises(scan_spec.SpecError):
        scan_spec.validate({"filters": [], "logic": {"any": [{"key": "price", "op": "gt_col", "other": other}]}})


def test_a_raw_column_cannot_ride_in_as_other_or_rank():
    """33 snapshot columns sit outside the catalog (archive_*, base internals): `other` and rank take catalog keys only."""
    raw = sorted(set(snapshot_db.COLUMNS) - scan_spec.catalog_keys() - set(hidden.IDENTITY_COLUMNS))[0]
    with pytest.raises(scan_spec.SpecError):
        scan_spec.validate({"filters": [{"key": "price", "op": "gt_col", "other": raw}]})
    with pytest.raises(scan_spec.SpecError):
        scan_spec.validate({"filters": [], "rank": {"criteria": [{"key": raw, "weight": 1}]}})


def test_no_public_key_is_a_second_name_for_a_hidden_column():
    columns = {filters.FILTERS[k]["column"] for k in _hidden_filter_keys()}
    assert not [k for k, f in filters.FILTERS.items() if k not in hidden.hidden_keys() and f.get("column") in columns]


def test_the_definitions_the_model_reads_name_nothing_hidden():
    labels = [filters.FILTERS[k]["label"].lower() for k in _hidden_filter_keys()]
    hid = hidden.hidden_keys()
    for f in filters.field_catalog():
        if f["key"] in hid or not f.get("description"):
            continue
        text = f["description"].lower()
        assert not [x for x in labels if x in text], f["key"]
        assert not [k for k in hid if k in text], f["key"]


@pytest.mark.parametrize("shape", [*SHAPES, *OTHER_SHAPES])
def test_a_stored_last_screen_cannot_carry_a_hidden_field(shape):
    make = {**SHAPES, **OTHER_SHAPES}[shape]
    built = make(_range_hidden()[0])
    with pytest.raises(refine.RefineError) as e:
        refine.validate_last_screen({"spec": {"filters": built["filters"], "post": [], "sort": None,
                                              **({"logic": built["logic"]} if "logic" in built else {}),
                                              **({"rank": built["rank"]} if "rank" in built else {})}, "symbols": []})
    assert "UCT Agent can't screen" in str(e.value)


@pytest.mark.parametrize("delta", [
    {"add": [{"key": "price", "op": "gt_col", "other": "rs_rank"}]},
    {"logic": {"any": [{"key": "rs_rank", "op": "gte", "min": 1}]}},
    {"rank": {"criteria": [{"key": "rs_rank", "weight": 1}]}},
])
def test_a_refinement_cannot_add_a_hidden_field_through_a_new_shape(delta):
    with pytest.raises(refine.RefineError) as e:
        refine.compose({"filters": []}, delta)
    assert "A public alternative:" in str(e.value)


# ── end to end: a real snapshot file, the real gateway, the real `run_scan` ────────────────────────────────────────────
_ROW = {"company": "Co", "sector": "Technology", "price": 50.0, "pt_target": 40.0, "rsi14": 50.0, "chg_pct_3m": 5.0,
        "market_cap": 5e9, "bars_asof": 20261030, "snapshot_date": "2026-10-31", "security_type": "Common Stock",
        "avg_dollar_vol_30d": 5e7}


@pytest.fixture
def gate(tmp_path, monkeypatch):
    from api.services.uct_agent.marketdata import gateway
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    snapshot_db.init_db()
    snapshot_db.upsert_rows([
        dict(_ROW, ticker="LOW", rsi14=20.0, candle_matches=",hammer,bullish-engulfing,", chg_pct_3m=30.0),
        dict(_ROW, ticker="HIGH", rsi14=80.0, pt_target=90.0, candle_matches=",hammer,", chg_pct_3m=10.0),
        dict(_ROW, ticker="MID", rsi14=50.0, candle_matches=",doji,", chg_pct_3m=None),
    ])
    monkeypatch.setenv("UCT_AGENT_DATA", "1")
    monkeypatch.setenv(gateway.KINDS_ENV, ",".join(gateway.registry().names()))
    monkeypatch.setenv("UCT_AGENT_SCAN", "1")
    gateway._reset_for_test()
    yield lambda spec_, turn="t1": gateway.read("screen.run", {"spec": spec_}, user_id="admin-1", turn_id=turn, purpose="scan")
    gateway._reset_for_test()


def _symbols(out):
    return sorted(r["symbol"] for r in out["data"]["rows"])


def test_flag_off_the_gateway_refuses_a_tree_in_the_sentence_and_the_turn_keeps_its_scan(gate, monkeypatch):
    monkeypatch.setenv(logic.FLAG, "0")
    out = gate({"filters": [], "logic": TREE})
    assert out["status"] == "refused" and out["data"] is None and logic.DISABLED_SENTENCE in " ".join(out["notes"])
    assert gate({"filters": [{"key": "rsi14", "op": "gte", "min": 0}]})["status"] in ("ok", "partial")


def test_flag_on_a_tree_runs_for_real(gate, monkeypatch):
    monkeypatch.setenv(logic.FLAG, "1")
    assert _symbols(gate({"filters": [], "logic": TREE})) == ["HIGH", "LOW"]


def test_a_comparison_runs_for_real(gate):
    out = gate({"filters": [{"key": "pt_target", "op": "gt_col", "other": "price"}]})
    assert _symbols(out) == ["HIGH"]


def test_a_token_in_finds_the_multi_pattern_bar_for_real(gate):
    assert _symbols(gate({"filters": [{"key": "candle_type", "op": "in", "values": [",hammer,"]}]})) == ["HIGH", "LOW"]


def test_a_rank_runs_for_real_and_says_what_it_dropped(gate):
    out = gate({"filters": [], "rank": {"criteria": [{"key": "chg_pct_3m", "weight": 1}]}})
    assert [r["symbol"] for r in out["data"]["rows"]] == ["LOW", "HIGH"]
    assert out["data"]["rank"]["excluded_incomplete"] == 1


# ── refinement ────────────────────────────────────────────────────────────────────────────────────────────────────────
LAST = {"filters": [{"key": "price", "op": "gt", "min": 20}], "post": [], "sort": None, "logic": TREE,
        "rank": {"criteria": [{"key": "chg_pct_3m", "weight": 1}]}}
TECH = {"key": "sector", "op": "in", "values": ["Technology"]}


def test_a_stored_screen_keeps_its_group_and_rank():
    got = refine.validate_last_screen({"spec": LAST, "symbols": ["AAA"], "total": 1})
    assert got["spec"]["logic"] == TREE and got["spec"]["rank"] == LAST["rank"]


def test_a_stored_screen_takes_the_new_ops():
    spec_ = {"filters": [{"key": "price", "op": "gt_col", "other": "pt_target"},
                         {"key": "candle_type", "op": "contains", "value": ",hammer,"}], "post": [], "sort": None}
    assert refine.validate_last_screen({"spec": spec_, "symbols": []})["spec"]["filters"] == spec_["filters"]


def test_a_refinement_keeps_the_group_and_the_rank():
    got = refine.compose(LAST, {"universe": [TECH]})
    assert got["logic"] == TREE and got["rank"] == LAST["rank"] and TECH in got["filters"]


def test_a_price_floor_replaces_by_key_and_the_group_stays():
    got = refine.compose(LAST, {"add": [{"key": "price", "op": "gte", "min": 10}]})
    assert got["filters"] == [{"key": "price", "op": "gte", "min": 10}] and got["logic"] == TREE


def test_a_new_group_is_anded_on_never_swapped():
    new = {"any": [{"key": "gap_pct", "op": "gte", "min": 5}, {"key": "vol_ratio", "op": "gte", "min": 2}]}
    assert refine.compose(LAST, {"logic": new})["logic"] == {"all": [TREE, new]}


def test_one_order_at_a_time():
    got = refine.compose(LAST, {"sort": {"key": "price", "dir": "asc"}})
    assert got["sort"]["key"] == "price" and "rank" not in got
    got = refine.compose({"filters": [], "sort": {"key": "price", "dir": "asc"}}, {"rank": LAST["rank"]})
    assert got["rank"] == LAST["rank"] and got["sort"] is None
