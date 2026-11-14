"""RS screens unit U4, part E: the fourteen new columns, registered everywhere a screener
column lives.

``rs_rating_prev20`` (the rating pass), the six RS-line measures and the seven Setup label
columns (the nightly build) join ``screener_rows`` behind ``RS_SCREENS_ENABLED``. Each is a
filter in the dark fourth family (so ``meta()`` serves it only while the flag is on), is
kept out of UCT Agent's field list (its request budget has no room), publishes a method,
has a column definition and a plain name, and is excluded from the formula vocabulary with
a dated reason until it fills.

The words a member reads for a label live in three places (the server's
``rs_setup.SETUP_LABELS``, the filter's option labels, the table's formatter) and the
numbers in the column descriptions restate ``rs_setup`` / ``rs_columns`` constants. Each
pair is held together here, so a threshold or a word cannot change in one and not the other.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from api.services import relative_strength as rs
from api.services.screener import filters as F
from api.services.screener import methodology as M
from api.services.screener import rs_columns, rs_post_pass, rs_setup, snapshot_db
from api.services.screener import snapshot_builder as sb

ROOT = Path(__file__).resolve().parents[1]
COLUMN_DEFS_JS = ROOT / "app" / "src" / "pages" / "screener" / "columnDefs.js"
PLAIN_WORDS_JS = ROOT / "app" / "src" / "pages" / "screener" / "focus" / "plainWords.js"
CLOSED_TABLE = ROOT / "app" / "src" / "components" / "chart" / "engine" / "ast" / "closedTable.json"

#: key -> (filter label, filter type). The contract's columns, section 1.
FOURTEEN = {
    "rs_rating_prev20": ("RS Rating a month ago", "range"),
    "rs_nh_count_20": ("RS highs in 20 sessions", "range"),
    "rs_nh_quiet": ("Sessions before the RS high", "range"),
    "rs_nh_red_bars_ago": ("RS high on a down day, age", "range"),
    "px_below_high_pct": ("Below its high", "range"),
    "rs_nhbp_age": ("RS high before price, age", "range"),
    "rs_nh_span": ("RS high span (sessions)", "range"),
    "rs_setup": ("Setup", "enum"),
    "rs_tight": ("Tight range", "bool"),
    "rs_flag": ("Setup flag", "enum"),
    "rs_near_buy": ("Near a buy point", "bool"),
    "atr_ext_ema21": ("ATR Extension vs 21EMA", "range"),
    "pct_vs_ema8": ("EMA8 Distance", "range"),
    "pct_vs_ema21": ("EMA21 Distance", "range"),
}
U1_NINE = ("rs_rating_pos", "rs_rating_pos_prev20", "rs_pos_1m", "rs_pos_3m", "rs_pos_6m",
           "rs_pos_12m", "rs_rating_session", "rs_rating_pos_n", "rs_rating_score")
BUILD = tuple(rs_columns.SCREEN_COLUMNS) + tuple(sb.RS_SETUP_COLUMNS)
#: Trade words that read as advice, and the abbreviation never shown beside RS. "buy point"
#: is the plan's own term for the Setup label's "Near a buy point"; a bare "buy" is not allowed.
BANNED = re.compile(r"\b(buys|buying|buyable|sell|sells|selling|RSI)\b|\bbuy\b(?! point)", re.I)


# ───────────────────────── the family ─────────────────────────

def test_the_fourteen_are_the_contracts_columns_from_their_two_writers():
    assert set(FOURTEEN) == {"rs_rating_prev20"} | set(BUILD) and len(BUILD) == 13
    assert set(rs_post_pass.OWNED_COLUMNS) == set(snapshot_db.POST_PASS_COLUMNS) == \
        set(U1_NINE) | {"rs_rating_prev20"}
    assert tuple(F.RS_SCREENS_KEYS[:9]) == U1_NINE
    assert set(F.RS_SCREENS_KEYS) == set(U1_NINE) | set(FOURTEEN)
    assert len(F.RS_SCREENS_KEYS) == len(set(F.RS_SCREENS_KEYS)) == 23
    for key in FOURTEEN:
        assert snapshot_db.COLUMNS.count(key) == 1, key
    # the build loop writes thirteen; only the rating a month ago is the pass's
    assert set(BUILD) & set(snapshot_db.POST_PASS_COLUMNS) == set()


def test_each_is_a_relative_strength_control_kept_from_the_agent():
    catalog = {f["key"]: f for f in F.field_catalog()}
    for key, (label, kind) in FOURTEEN.items():
        f = F.FILTERS[key]
        assert (f["label"], f["type"]) == (label, kind), key
        assert f["category"] == "relative_strength" and f["column"] == key, key
        assert f.get("agent_omit") is True and catalog[key].get("agent_omit") is True, key
        assert key in F.VIEWS["relative_strength"]["columns"], f"{key} has no seat in the RS view"
        if kind == "range":
            assert [p["label"] for p in f["presets"]] == ["Any"], \
                f"{key}: a window or a distance is a screen's choice, never a published threshold"
        assert not BANNED.search(label), key
    assert not (set(FOURTEEN) & F.picker_hidden_keys()), "all fourteen are offered as columns"
    omitted = {f["key"] for f in F.field_catalog() if f.get("agent_omit")}
    assert set(F.RS_SCREENS_KEYS) <= omitted


def test_the_two_label_filters_offer_exactly_the_writers_keys_in_the_writers_words():
    for key, names in (("rs_setup", rs_setup.SETUPS), ("rs_flag", rs_setup.FLAGS)):
        presets = F.FILTERS[key]["presets"]
        assert presets[0] == {"label": "Any"}
        assert [p["value"] for p in presets[1:]] == list(names), key
        assert [p["label"] for p in presets[1:]] == [rs_setup.SETUP_LABELS[k] for k in names], key
        assert all(p["op"] == "eq" for p in presets[1:])
        for op in ("eq", "in", "not_in"):
            assert F.is_valid_op(key, op), (key, op)
    assert snapshot_db._coldef("rs_setup") == "rs_setup TEXT"
    assert snapshot_db._coldef("rs_flag") == "rs_flag TEXT"


def test_every_one_is_dark_while_the_flag_is_off_whatever_the_other_flags_say():
    family = frozenset(FOURTEEN)
    for v2 in (True, False):
        for history in (True, False):
            for v3 in (True, False):
                dark = F.rs_dark_keys(v2_on=v2, history_on=history, v3_on=v3, screens_on=False)
                assert family <= dark, (v2, history, v3)
                lit = F.rs_dark_keys(v2_on=v2, history_on=history, v3_on=v3, screens_on=True)
                assert not (family & lit), (v2, history, v3)


def test_meta_serves_none_of_the_fourteen_while_dark_and_all_of_them_when_on(monkeypatch):
    from api.services.screener import distribution
    monkeypatch.setattr(distribution, "distributions", lambda: {"basis": None})
    monkeypatch.setattr(F, "_rs_v2_on", lambda: True)
    monkeypatch.setattr(F, "_rs_history_on", lambda: True)
    monkeypatch.setattr(F, "_rs_v3_on", lambda: True)

    def served():
        meta = F.meta()
        keys = {f["key"] for f in meta["filters"]}
        seats = {c for v in meta["views"] for c in v["columns"]}
        return keys, seats, {c["key"] for c in meta["comparable_fields"]}

    monkeypatch.delenv(rs_post_pass.FLAG, raising=False)
    keys, seats, comparable = served()
    assert not (set(FOURTEEN) & keys) and not (set(FOURTEEN) & seats) and not (set(FOURTEEN) & comparable)
    monkeypatch.setenv(rs_post_pass.FLAG, "1")
    keys, seats, comparable = served()
    assert set(FOURTEEN) <= keys and set(FOURTEEN) <= seats
    ranges = {k for k, (_l, kind) in FOURTEEN.items() if kind == "range"}
    assert ranges <= comparable


# ───────────────────────── the methods ─────────────────────────

def test_each_publishes_a_method_that_says_when_it_is_blank_and_dark():
    for key, (label, _kind) in FOURTEEN.items():
        m = M.for_column(key)
        assert m is not None and m["label"] == label and m["family"] == M.RS_FAMILY, key
        note = M._RS_SCREENS_NOTE if key == "rs_rating_prev20" else M._RS_SCREENS_BUILD_NOTE
        assert m["how"].endswith(note), f"{key}: the method must say it is empty while dark"
        assert "Blank" in m["how"][:-len(note)], f"{key}: the method must say when the column is blank"
        text = " ".join(m[k] for k in ("one_line", "scale", "how", "caveat"))
        assert "—" not in text and "–" not in text and not BANNED.search(text), key
        assert not re.search(r"win rate|hit rate|success rate", text, re.I), key
    assert set(FOURTEEN) <= set(M.all_methods()["rs_columns"]["columns"])
    assert "nightly screener build" in M._RS_SCREENS_BUILD_NOTE


def test_the_methods_read_their_numbers_from_the_writers(monkeypatch):
    how = {k: M.for_column(k)["how"] for k in FOURTEEN}
    assert f"among the last {rs_columns.SCREEN_NH_COUNT_WINDOW}, on which" in how["rs_nh_count_20"]
    assert f"prior {rs_columns.LOOKBACK} sessions" in how["rs_nh_count_20"]
    assert f"down {abs(rs.DEFAULT_RED_DAY_PCT):g}% or more" in how["rs_nh_red_bars_ago"]
    assert f"within {rs.DEFAULT_PRICE_TOLERANCE_PCT:g}% of its own {rs_columns.LOOKBACK}-session closing high" \
        in how["rs_nhbp_age"]
    assert f"last {rs_columns.SCREEN_NHBP_WINDOW} sessions" in how["rs_nhbp_age"]
    assert f"the {sb.RS_WINDOW_BARS} sessions the build reads" in how["rs_nh_span"]
    assert f"last {rs_columns.LOOKBACK} sessions, today included" in how["px_below_high_pct"]
    assert f"{rs_post_pass.PREV_SESSIONS} stored sessions" in how["rs_rating_prev20"]
    assert "4 or more ATRs above the 50-day average" in how["rs_setup"]
    assert "at least 5 sessions ago" in how["rs_flag"] and "1.5% range" in how["rs_flag"]
    assert M.for_column("rs_setup")["scale"] == "; ".join(rs_setup.SETUP_LABELS[k] for k in rs_setup.SETUPS)
    assert M.for_column("rs_flag")["scale"] == "; ".join(rs_setup.SETUP_LABELS[k] for k in rs_setup.FLAGS)
    assert "Extended at 3 or more" in M.for_column("atr_ext_ema21")["caveat"]
    # move a threshold and the sentence moves with it
    monkeypatch.setattr(rs_setup, "EXTENDED_ATR_SMA50", 7.0)
    monkeypatch.setattr(rs_setup, "BUYOUT_BAND_PCT", 2.5)
    monkeypatch.setattr(rs_setup, "EXTENDED_ATR_EMA21", 3.5)
    assert "7 or more ATRs above the 50-day average" in M.for_column("rs_setup")["how"]
    assert "2.5% range" in M.for_column("rs_flag")["how"]
    assert "Extended at 3.5 or more" in M.for_column("atr_ext_ema21")["caveat"]


def test_the_period_places_say_they_need_no_full_year():
    """Unit U4, part B: a newer listing is ranked on the shorter boards. The method and the
    column description both have to say so, or a member reads a 1-month place of 2,100
    beside "of 1,931 stocks" as a bug."""
    for key in ("rs_pos_1m", "rs_pos_3m", "rs_pos_6m", "rs_pos_12m"):
        how = M.for_column(key)["how"]
        assert "does not need a full year of price history" in how, key
        assert "can be longer than Stocks ranked" in how, key
        assert "price $10 or more" in how and "$20M or more traded a day" in how
        assert "does not need a full year of price history" in _js_entry(key)[2], key
    assert "a full year of price history" in M.for_column("rs_rating_pos")["how"]


# ───────────────────────── the client registries ─────────────────────────

def _js_entry(key):
    src = COLUMN_DEFS_JS.read_text(encoding="utf-8")
    m = re.search(rf"\n  {key}: \{{ label: '([^']*)', fmt: ([^\n]*?),\s*\n    desc: '((?:[^'\\]|\\.)*)' \}},", src)
    assert m, f"{key} has no column definition"
    return m.group(1), m.group(2), m.group(3)


def test_each_has_a_column_definition_and_a_plain_name():
    plain = PLAIN_WORDS_JS.read_text(encoding="utf-8")
    for key in FOURTEEN:
        label, fmt, desc = _js_entry(key)
        assert label and fmt, key
        assert len(desc) > 60 and "—" not in desc and "–" not in desc, key
        assert not BANNED.search(desc) and not BANNED.search(label), key
        assert re.search(rf"\n  {key}: '[^']+',", plain), f"{key} has no plain name"
    assert _js_entry("rs_near_buy")[1] == "tri", "a 0 is a checked no, a blank is not checked"
    assert _js_entry("px_below_high_pct")[1] == "pct"
    assert _js_entry("rs_nhbp_age")[1] == "barsAgo" and _js_entry("rs_nh_red_bars_ago")[1] == "barsAgo"


def test_the_tables_label_words_are_the_servers():
    src = COLUMN_DEFS_JS.read_text(encoding="utf-8")
    block = re.search(r"const RS_SETUP_WORDS = \{(.*?)\n\}", src, re.S)
    assert block, "RS_SETUP_WORDS not found in columnDefs.js"
    words = dict(re.findall(r"(\w+): '([^']*)'", block.group(1)))
    assert words == {k: v for k, v in rs_setup.SETUP_LABELS.items() if k != "tight"}
    assert set(words) == set(rs_setup.SETUPS) | set(rs_setup.FLAGS)
    assert _js_entry("rs_setup")[1] == _js_entry("rs_flag")[1] == "v => RS_SETUP_WORDS[v] || '—'"
    assert _js_entry("rs_tight")[0] == rs_setup.SETUP_LABELS["tight"]


def test_the_descriptions_state_the_writers_numbers():
    setup, flag = _js_entry("rs_setup")[2], _js_entry("rs_flag")[2]
    zone, below = f"{rs_setup.IBD_BUY_ZONE * 100:g}%", f"{rs_setup.PIVOT_BELOW * 100:g}%"
    for words in (f"{rs_setup.EXTENDED_ATR_SMA50:g} or more ATRs above the 50-day average",
                  f"{rs_setup.EXTENDED_ATR_EMA21:g} or more above the 21-day EMA",
                  f"more than {zone} past a base pivot",
                  f"{below} below a base pivot to {zone} above it",
                  f"a 20-session closing high in the last {rs_setup.PULLBACK_HIGH_MAX_AGE} sessions",
                  f"within {rs_setup.PULLBACK_ATR_BAND:g} ATR of a rising 8-day or 21-day EMA"):
        assert words in setup, words
    for words in (f"closed {rs_setup.BUYOUT_JUMP_PCT:g}% or more above the prior close",
                  f"at least {rs_setup.BUYOUT_MIN_SESSIONS} sessions ago",
                  f"inside {rs_setup.BUYOUT_BAND_PCT:g}%",
                  f"over the last {rs_setup.ONE_DAY_WINDOW} sessions",
                  f"{rs_setup.ONE_DAY_MIN_PCT:g}% or more on its own",
                  f"fewer than {rs_setup.NEW_ISSUE_BARS} daily bars"):
        assert words in flag, words
    assert f"{rs_setup.EXTENDED_ATR_EMA21:g} or more" in _js_entry("atr_ext_ema21")[2]
    assert f"past {rs_columns.LOOKBACK} sessions" in _js_entry("px_below_high_pct")[2]
    assert f"last {rs_columns.SCREEN_NH_COUNT_WINDOW} sessions" in _js_entry("rs_nh_count_20")[2]
    assert f"last {rs_columns.SCREEN_NHBP_WINDOW} sessions" in _js_entry("rs_nhbp_age")[2]
    assert f"within {rs.DEFAULT_PRICE_TOLERANCE_PCT:g}%" in _js_entry("rs_nhbp_age")[2]
    assert f"down {abs(rs.DEFAULT_RED_DAY_PCT):g}% or more" in _js_entry("rs_nh_red_bars_ago")[2]
    assert f"{rs_post_pass.PREV_SESSIONS} stored sessions" in _js_entry("rs_rating_prev20")[2]


def test_the_new_identities_hold_on_a_built_row_and_know_the_writers_window(monkeypatch):
    """Six relations between the new columns are proof identities (a violation withholds
    the columns at build time), so each has to be TRUE of what the build writes. A real
    built row satisfies all of them, and the literal 20 in the count's band is the
    writer's window."""
    from api.services.screener import identities
    from tests.test_screener_rs_columns import AAA, RSP, SPY, _arm_rs_v2
    names = {"rs_nh_red_bars_ago_ge_rs_nh_bars_ago", "rs_nhbp_age_is_rs_nh_bars_ago",
             "rs_nh_span_implies_rs_new_high", "rs_nh_count_20_within_its_window",
             "px_below_high_pct_at_or_below_zero", "rs_tight_is_tight_consolidation"}
    by_name = {i.name: i for i in identities.build_identities()}
    assert names <= set(by_name) and all(by_name[n].severity == "proof" for n in names)
    assert rs_columns.SCREEN_NH_COUNT_WINDOW == 20
    _arm_rs_v2(monkeypatch)
    monkeypatch.setenv(rs_post_pass.FLAG, "1")
    state = {}
    rise = [{"t": b["t"], "o": 100.0 + i, "h": 101.0 + i, "l": 99.0 + i, "c": 100.0 + i, "v": 1000}
            for i, b in enumerate(AAA)]
    for bars in (AAA, rise):
        row = sb.build_row("AAA", bars, None, None, spy_bars=SPY, rsp_bars=RSP, identity_state=state)
        states = {n: identities.verdict(by_name[n], row).state for n in names}
        assert "violated" not in states.values() and "error" not in states.values(), states
        assert states["rs_nh_count_20_within_its_window"] == "satisfied"
        assert states["rs_tight_is_tight_consolidation"] == "satisfied"
        assert row["rs_setup"] is not None and row["px_below_high_pct"] == 0.0
    assert states["rs_nh_span_implies_rs_new_high"] == "satisfied", "the riser is at an RS high today"
    assert not (names & set(state)), "the build withheld a column on one of them"


def test_none_is_a_formula_scalar_until_it_is_filled():
    table = json.loads(CLOSED_TABLE.read_text(encoding="utf-8"))
    for key in FOURTEEN:
        assert key not in table["scalars"], key
        why = table["_scalars_excluded"][key]
        assert "2026-11-14" in why and "RS_SCREENS_ENABLED" in why and "unit U4" in why, key
    for key in ("rs_setup", "rs_flag"):
        assert table["_scalars_excluded"][key].startswith("TEXT"), key
    assert set(table["scalars"]) | set(table["_scalars_excluded"]) >= set(snapshot_db.COLUMNS)


# ───────────────────────── end to end ─────────────────────────

_VALUES = {"rs_setup": "at_pivot", "rs_flag": "new_issue", "px_below_high_pct": -4.0,
           "atr_ext_ema21": 1.5, "pct_vs_ema8": 0.4, "pct_vs_ema21": 1.2, "rs_tight": 1, "rs_near_buy": 1}


@pytest.mark.parametrize("key", sorted(FOURTEEN))
def test_a_screen_can_filter_and_sort_on_it(key, tmp_path, monkeypatch):
    import importlib
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    snapshot_db.init_db()
    value = _VALUES.get(key, 3)
    snapshot_db.upsert_rows([
        {"ticker": "HIT", key: value, "snapshot_date": "2026-11-13", "built_at": 1},
        {"ticker": "BLANK", "snapshot_date": "2026-11-13", "built_at": 1},
    ])
    from api.services.screener import query
    importlib.reload(query)
    kind = FOURTEEN[key][1]
    clause = ({"key": key, "op": "gte", "min": value} if kind == "range"
              else {"key": key, "op": "eq", "value": value})
    spec = {"filters": [clause], "sort": {"key": key, "dir": "asc"}}
    out = query.run_scan(spec)
    assert [r["ticker"] for r in out["rows"]] == ["HIT"], "a NULL is no value, never a match"
    assert out["rows"][0][key] == value
