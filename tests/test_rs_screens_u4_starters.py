"""RS screens unit U4, part D: the five screens on the server, the hidden seven, the views.

While ``RS_SCREENS_ENABLED`` is on, ``GET /api/screener/saved-screens`` serves five
Relative Strength starters (Top RS Rating, RS New Highs, RS New High Before Price, UCT RS
Leaders, RS exit warnings), each with its quick controls, its row recipe and (one) its
empty state, and marks seven older starters ``hidden``. The client (unit U5) builds to the
same contract, so the shapes here are the contract's.

Why each rail exists:
  * off, the starters are today's, with none of the new keys (the flag is dark in
    production and the picker must not change);
  * a control is only an honest filter while its default option IS the spec's clauses on
    its keys, no two controls share a key, and every option applied is a screen the scan
    accepts. A control whose default disagreed with the spec would show "Custom" on a
    screen nobody touched; one whose option the scan refuses is a button that errors;
  * each screen and each option is RUN on a small synthetic snapshot and its rows read, so
    a rule that silently matches nothing (or everything) fails here by name;
  * a hidden starter stays in the payload: a pinned or last-used id must still resolve.

``tests/fixtures/rs_screens_starters.json`` is the golden of the five as served. Refresh
it on a deliberate change with ``UPDATE_RS_SCREENS_GOLDEN=1``.
"""
from __future__ import annotations

import copy
import json
import os
import re
from pathlib import Path

import pytest

from api.services.screener import filters as F
from api.services.screener import logic, membership, query, rs_post_pass, rs_screens, rs_setup
from api.services.screener import saved_screens as ss
from api.services.screener import snapshot_db

GOLDEN = Path(__file__).resolve().parent / "fixtures" / "rs_screens_starters.json"

FIVE = ("starter_rs_top_rating", "starter_rs_new_high", "starter_rs_nh_before_price",
        "starter_rs_leaders", "starter_rs_exit_warning_5")
HIDDEN = ("starter_rs_nh_red_day", "starter_rs_green_on_red", "starter_rs_cross_up_21ema",
          "starter_rs_mansfield_positive", "starter_rs_leaders_equal_weight",
          "starter_rs_quicksand_5", "starter_momentum_leaders")
#: The nine RS starters as they are served today (flag off), in order.
TODAY_RS = ("starter_rs_new_high", "starter_rs_nh_before_price", "starter_rs_nh_red_day",
            "starter_rs_green_on_red", "starter_rs_cross_up_21ema",
            "starter_rs_mansfield_positive", "starter_rs_leaders_equal_weight",
            "starter_rs_exit_warning_5", "starter_rs_quicksand_5")
NEW_KEYS = ("controls", "row", "empty", "hidden")
FLOOR = [{"key": "price", "op": "gte", "min": 10},
         {"key": "dollar_vol_30d", "op": "gte", "min": 20000000}]
STOCKS = {"key": "security_type", "op": "not_in", "values": ["ETF"]}
#: Unit U6 (2026-11-14, coordinator decision): the four list screens leave buyout names
#: out with one exclude clause. RS exit warnings does not carry it.
NO_BUYOUT = {"key": "rs_flag", "op": "not_in", "values": ["buyout_pending"]}
LIST_SCREENS = ("starter_rs_top_rating", "starter_rs_new_high", "starter_rs_nh_before_price",
                "starter_rs_leaders")
CAPTION_PARTS = {"setup", "group", "rs_high_age", "below_high", "moving"}
TAG_ORDER = ["before_price", "down_day", "flag", "new"]
#: Words the contract bans from member-facing copy. "buy point" is the plan's own term
#: for the Setup label's "Near a buy point"; a bare "buy" is not allowed.
BANNED = re.compile(r"\b(buys|buying|buyable|sells|selling|lens|gate|red day|ADR|RSI)\b|"
                    r"\bbuy\b(?! point)", re.I)


def _v2(monkeypatch, on=True):
    from api.services.signature import registry_defs
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", on)


@pytest.fixture
def on(monkeypatch):
    _v2(monkeypatch)
    monkeypatch.setenv("RS_SCREENS_ENABLED", "1")


@pytest.fixture
def off(monkeypatch):
    _v2(monkeypatch)
    monkeypatch.delenv("RS_SCREENS_ENABLED", raising=False)


def _by_id():
    return {s["id"]: s for s in ss.starters()}


def _five():
    by = _by_id()
    return [by[i] for i in FIVE]


# ───────────────────────── flag off: today's list ─────────────────────────

def test_flag_off_the_rs_starters_are_todays_nine_with_none_of_the_new_keys(off):
    assert [s["id"] for s in ss.rs_starters()] == list(TODAY_RS)
    for s in ss.starters():
        assert not (set(NEW_KEYS) & set(s)), (s["id"], sorted(set(NEW_KEYS) & set(s)))
        assert "then" not in (s["spec"].get("sort") or {}), s["id"]
        assert s["spec"].get("view") not in F.RS_SCREENS_VIEWS, s["id"]
    by = _by_id()
    assert "starter_rs_top_rating" not in by and "starter_rs_leaders" not in by
    # the three ids the five reuse still carry their old single-rule specs
    assert by["starter_rs_new_high"]["spec"]["filters"][0] == {"key": "rs_new_high", "op": "eq", "value": 1}
    assert by["starter_rs_nh_before_price"]["name"] == "RS new high before price"
    assert by["starter_rs_exit_warning_5"]["name"] == "RS exit warning in the last 5 sessions"


def test_the_flag_changes_only_the_five_and_the_hidden_mark(monkeypatch):
    """Every starter that is not one of the five is the same object either way, except
    that the seven retired ones gain ``hidden: true``."""
    _v2(monkeypatch)
    monkeypatch.delenv("RS_SCREENS_ENABLED", raising=False)
    before = _by_id()
    monkeypatch.setenv("RS_SCREENS_ENABLED", "1")
    after = _by_id()
    assert set(after) == set(before) | {"starter_rs_top_rating", "starter_rs_leaders"}
    for sid, s in after.items():
        if sid in FIVE:
            continue
        expect = {**before[sid], "hidden": True} if sid in HIDDEN else before[sid]
        assert s == expect, sid
    assert {sid for sid, s in after.items() if s.get("hidden")} == set(HIDDEN)
    assert tuple(rs_screens.RETIRED_IDS) == HIDDEN


def test_without_rs_v2_there_are_no_rs_starters_and_nothing_is_hidden(monkeypatch):
    """The five read columns the RS_V2 step writes. With it off they do not exist, so the
    screen they replace ("Leaders (RS >= 90)") must stay in the picker."""
    _v2(monkeypatch, on=False)
    monkeypatch.setenv("RS_SCREENS_ENABLED", "1")
    assert ss.rs_starters() == []
    by = _by_id()
    assert not [i for i in by if i.startswith("starter_rs_")]
    assert "hidden" not in by["starter_momentum_leaders"]
    assert not any(s.get("hidden") for s in by.values())


# ───────────────────────── flag on: the five, to the contract ─────────────────────────

def test_the_five_lead_the_group_in_the_contracts_order(on):
    rs = ss.rs_starters()
    assert [s["id"] for s in rs[:5]] == list(FIVE)
    assert [s["name"] for s in rs[:5]] == ["Top RS Rating", "RS New Highs", "RS New High Before Price",
                                          "UCT RS Leaders", "RS exit warnings"]
    assert all(s.get("hidden") for s in rs[5:]) and len(rs) == 11
    assert {s["group"] for s in rs} == {ss.RS_STARTER_GROUP} == {rs_screens.GROUP}
    served = [s["id"] for s in ss.starters() if s.get("group") == ss.RS_STARTER_GROUP
              and not s.get("hidden")]
    assert served == list(FIVE), "the picker's Relative strength group is the five, in order"


def test_the_five_as_served_match_the_golden(on):
    served = _five()
    if os.environ.get("UPDATE_RS_SCREENS_GOLDEN") == "1":
        GOLDEN.write_text(json.dumps(served, indent=2) + "\n", encoding="utf-8")
    assert json.loads(GOLDEN.read_text(encoding="utf-8")) == served
    # and it survives JSON exactly (the route's own encoding): no tuple, no float drift
    assert json.loads(json.dumps(served)) == served


def test_every_one_carries_the_floor_and_stocks_only(on):
    assert rs_post_pass.LIQUID_FLOOR["price_min"] == 10 and rs_post_pass.LIQUID_FLOOR["dollar_vol_30d_min"] == 20_000_000
    for s in _five():
        filters = s["spec"]["filters"]
        for clause in FLOOR:
            assert filters.count(clause) == 1, (s["id"], clause)
        assert filters[-1] == STOCKS, s["id"]
        assert isinstance(filters[0]["min"], int), "a floor is a whole number in the payload"


def test_the_specs_are_the_contracts(on):
    by = _by_id()

    def clauses(sid):
        return [f for f in by[sid]["spec"]["filters"] if f not in FLOOR and f != STOCKS]

    top = by["starter_rs_top_rating"]["spec"]
    assert clauses("starter_rs_top_rating") == [{"key": "rs_rating_pos", "op": "gte", "min": 1},
                                                NO_BUYOUT]
    assert top["sort"] == {"key": "rs_rating_pos", "dir": "asc"} and top["view"] == "rs_top_rating"

    nh = by["starter_rs_new_high"]["spec"]
    assert clauses("starter_rs_new_high") == [
        {"key": "pct_vs_sma200", "op": "gt", "min": 0},
        {"key": "rs_nh_bars_ago", "op": "between", "min": 0, "max": 4},
        NO_BUYOUT]
    assert nh["sort"] == {"key": "rs_nh_bars_ago", "dir": "asc",
                          "then": {"key": "rs_rating_score", "dir": "desc"}}
    assert nh["view"] == "rs_new_highs"

    bp = by["starter_rs_nh_before_price"]
    assert clauses("starter_rs_nh_before_price") == [
        {"key": "pct_vs_sma200", "op": "gt", "min": 0},
        {"key": "rs_nhbp_age", "op": "between", "min": 0, "max": 4},
        {"key": "px_below_high_pct", "op": "between", "min": -25, "max": -3},
        NO_BUYOUT]
    assert bp["spec"]["sort"] == {"key": "px_below_high_pct", "dir": "desc",
                                  "then": {"key": "rs_rating_score", "dir": "desc"}}
    assert bp["spec"]["view"] == "rs_before_price"
    assert bp["aliases"] == ["RSNHBP", "RS new high before price", "blue dot"]
    assert bp["empty"] == {
        "text": "No RS line made a 52-week high ahead of price this week. That is normal in a weak market.",
        "actions": [{"label": "Show this month", "control": "when", "option": "month"},
                    {"label": "Open RS New Highs", "open": "starter_rs_new_high"}]}

    ld = by["starter_rs_leaders"]["spec"]
    assert clauses("starter_rs_leaders") == [
        {"key": "adr_pct", "op": "gte", "min": 3},
        {"key": "market_cap", "op": "gte", "min": 300000000},
        {"key": "rs_rank", "op": "gte", "min": 80},
        {"key": "pct_vs_sma200", "op": "gt", "min": 0},
        {"key": "sma200_rising", "op": "eq", "value": 1},
        {"key": "dist_52w_high_pct", "op": "gte", "min": -25},
        {"key": "rs_line_above_ma", "op": "eq", "value": 1},
        NO_BUYOUT]
    assert ld["rank"] == {"criteria": [{"key": "rs_rating_score", "weight": 1}], "top_n": 50}
    assert ld["view"] == "rs_leaders" and "sort" not in ld, "the rank owns the order"

    ex = by["starter_rs_exit_warning_5"]["spec"]
    assert clauses("starter_rs_exit_warning_5") == [
        {"key": "rs_exit_bars_ago", "op": "between", "min": 0, "max": 4}]
    assert ex["sort"] == {"key": "rs_exit_bars_ago", "dir": "asc"}
    # the exclusion is on the four list screens, once each, and not on the warnings
    assert [i for i in FIVE if NO_BUYOUT in by[i]["spec"]["filters"]] == list(LIST_SCREENS)
    assert tuple(rs_screens.NO_BUYOUT_SCREENS) == LIST_SCREENS
    assert NO_BUYOUT == rs_screens.no_buyouts() and rs_screens.EXCLUDED_FLAGS == ("buyout_pending",)
    assert set(rs_screens.EXCLUDED_FLAGS) <= set(rs_setup.FLAGS), "an excluded flag no row can carry"


def test_the_controls_are_the_contracts(on):
    by = _by_id()

    def shape(sid):
        return {c["id"]: (c["label"], c["keys"], [(o["id"], o["label"]) for o in c["options"]])
                for c in by[sid]["controls"]}

    assert shape("starter_rs_top_rating") == {
        "rank_by": ("Rank by", ["rs_rating_pos", "rs_pos_1m", "rs_pos_3m", "rs_pos_6m", "rs_pos_12m",
                                "rs_rating_chg_20", "pct_vs_sma50"],
                    [("overall", "Overall"), ("m1", "1M"), ("m3", "3M"), ("m6", "6M"), ("m12", "12M"),
                     ("rising", "Rising fastest")]),
        "show": ("Show", ["rs_rank", "rs_rating_prev20"],
                 [("all", "All"), ("r90", "90 and up"), ("new90", "New to 90+")])}
    assert shape("starter_rs_new_high") == {
        "when": ("When", ["rs_nh_bars_ago"],
                 [("today", "Today"), ("week", "This week"), ("month", "This month")]),
        "min": ("Min RS Rating", ["rs_rank"], [("any", "Any"), ("r70", "70"), ("r80", "80"), ("r90", "90")]),
        "down": ("Market", ["rs_nh_red_bars_ago"], [("all", "Any day"), ("down", "Down days only")])}
    assert shape("starter_rs_nh_before_price") == {
        "when": ("When", ["rs_nhbp_age"],
                 [("today", "Today"), ("week", "This week"), ("month", "This month")]),
        "below": ("Below its high by", ["px_below_high_pct"], [("p3", "3%"), ("p5", "5%"), ("p10", "10%")]),
        "min": ("Min RS Rating", ["rs_rank"], [("any", "Any"), ("r70", "70"), ("r80", "80")])}
    assert shape("starter_rs_leaders") == {
        "show": ("Show", ["rs_near_buy", "rs_setup"],
                 [("all", "All"), ("near", "Near a buy point"), ("noext", "Hide extended")]),
        "min": ("Min RS Rating", ["rs_rank"], [("r80", "80"), ("r85", "85"), ("r90", "90"), ("r95", "95")])}
    # one option per warning the filter itself offers, labelled by the filter
    kinds = [p for p in F.FILTERS["rs_exit_last"]["presets"] if p.get("op") == "eq"]
    assert len(kinds) == 3
    assert shape("starter_rs_exit_warning_5") == {
        "type": ("Type", ["rs_exit_last"],
                 [("any", "Any"), ("quick_break", "Quick Break"), ("quicksand", "Quicksand"),
                  ("grateful_dead_break", "Grateful Dead Break")])}
    assert [o["label"] for o in by["starter_rs_exit_warning_5"]["controls"][0]["options"][1:]] == \
        [p["label"] for p in kinds]

    def option(sid, cid, oid):
        c = next(c for c in by[sid]["controls"] if c["id"] == cid)
        return next(o for o in c["options"] if o["id"] == oid)

    assert option("starter_rs_top_rating", "rank_by", "rising") == {
        "id": "rising", "label": "Rising fastest",
        "filters": [{"key": "rs_rating_pos", "op": "gte", "min": 1},
                    {"key": "rs_rating_chg_20", "op": "gte", "min": 1},
                    {"key": "pct_vs_sma50", "op": "gt", "min": 0}],
        "sort": {"key": "rs_rating_chg_20", "dir": "desc", "then": {"key": "rs_rating_pos", "dir": "asc"}}}
    assert option("starter_rs_top_rating", "rank_by", "m3") == {
        "id": "m3", "label": "3M", "filters": [{"key": "rs_pos_3m", "op": "gte", "min": 1}],
        "sort": {"key": "rs_pos_3m", "dir": "asc"}, "place": "rs_pos_3m"}
    # unit U6: the four period boards number their rows by their own column, and no other
    # option of any screen overrides the place
    assert {(sid, c["id"], o["id"]): o["place"] for sid in FIVE for c in by[sid]["controls"]
            for o in c["options"] if "place" in o} == {
        ("starter_rs_top_rating", "rank_by", "m1"): "rs_pos_1m",
        ("starter_rs_top_rating", "rank_by", "m3"): "rs_pos_3m",
        ("starter_rs_top_rating", "rank_by", "m6"): "rs_pos_6m",
        ("starter_rs_top_rating", "rank_by", "m12"): "rs_pos_12m"}
    assert option("starter_rs_top_rating", "show", "new90")["filters"] == [
        {"key": "rs_rank", "op": "gte", "min": 90}, {"key": "rs_rating_prev20", "op": "lt", "max": 90}]
    assert option("starter_rs_new_high", "when", "month")["filters"] == [
        {"key": "rs_nh_bars_ago", "op": "between", "min": 0, "max": 20}]
    assert option("starter_rs_new_high", "when", "today")["filters"] == [
        {"key": "rs_nh_bars_ago", "op": "between", "min": 0, "max": 0}]
    assert option("starter_rs_new_high", "down", "down")["filters"] == [
        {"key": "rs_nh_red_bars_ago", "op": "between", "min": 0, "max": 9}]
    assert option("starter_rs_nh_before_price", "below", "p10")["filters"] == [
        {"key": "px_below_high_pct", "op": "between", "min": -25, "max": -10}]
    assert option("starter_rs_leaders", "show", "noext")["filters"] == [
        {"key": "rs_setup", "op": "not_in", "values": ["extended", "below_50"]}]
    assert option("starter_rs_leaders", "min", "r95")["filters"] == [{"key": "rs_rank", "op": "gte", "min": 95}]
    assert option("starter_rs_exit_warning_5", "type", "quicksand")["filters"] == [
        {"key": "rs_exit_last", "op": "eq", "value": "Quicksand"}]


def test_the_rows_are_the_contracts(on):
    by = _by_id()
    assert {i: by[i]["row"] for i in FIVE} == {
        "starter_rs_top_rating": {"place": "rs_rating_pos", "caption": ["setup", "moving"],
                                  "tags": ["flag", "new"]},
        "starter_rs_new_high": {"place": None, "caption": ["rs_high_age", "group"],
                                "tags": ["before_price", "down_day", "flag", "new"]},
        "starter_rs_nh_before_price": {"place": None, "caption": ["below_high", "group"],
                                       "tags": ["down_day", "flag", "new"]},
        # unit U7: the ranked screen names its own order (`sort_label`)
        "starter_rs_leaders": {"place": "index", "caption": ["setup", "group"], "tags": ["flag", "new"],
                               "sort_label": "RS Rating"},
        "starter_rs_exit_warning_5": {"place": None, "caption": ["group"], "tags": ["new"]}}
    for s in _five():
        row = s["row"]
        assert row["place"] in (None, "index") or row["place"] in snapshot_db.COLUMNS
        assert set(row["caption"]) <= CAPTION_PARTS
        assert row["tags"] == [t for t in TAG_ORDER if t in row["tags"]], "tags in priority order"
    assert [i for i in FIVE if "empty" in by[i]] == ["starter_rs_nh_before_price"]


def test_a_sort_label_is_only_on_a_ranked_screen_and_says_what_it_ranks_by(on):
    """Unit U7. The list head of a ranked screen reads "Sort: Your ranking". A starter may
    name the order instead (``row.sort_label``), and the name has to be true: only a screen
    the server itself ranks may carry one, and "RS Rating" is honest only while the one
    thing UCT RS Leaders ranks by is the RS Rating's own score."""
    labelled = {s["id"]: s["row"]["sort_label"] for s in ss.starters() if "sort_label" in (s.get("row") or {})}
    assert labelled == {"starter_rs_leaders": "RS Rating"}
    for s in ss.starters():
        if "sort_label" in (s.get("row") or {}):
            assert s["spec"].get("rank") and "sort" not in s["spec"], s["id"]
            label = s["row"]["sort_label"]
            assert label and label.strip() == label and label.isascii() and not BANNED.search(label)
    lead = _by_id()["starter_rs_leaders"]
    assert [c["key"] for c in lead["spec"]["rank"]["criteria"]] == ["rs_rating_score"]
    assert F.FILTERS["rs_rating_score"]["label"].startswith(lead["row"]["sort_label"])


# ───────────────────────── the control invariants ─────────────────────────

def _on_keys(spec, control):
    keys = set(control["keys"])
    return [f for f in spec["filters"] if f.get("key") in keys]


def _apply(spec, control, option):
    """The contract's control semantics: the option's clauses replace every clause on the
    control's keys, and its sort (when it has one) replaces the spec's."""
    keys = set(control["keys"])
    out = copy.deepcopy(spec)
    out["filters"] = [f for f in out["filters"] if f.get("key") not in keys] + copy.deepcopy(option["filters"])
    if "sort" in option:
        out["sort"] = copy.deepcopy(option["sort"])
    return out


def test_every_control_has_one_default_and_it_is_the_spec(on):
    for s in _five():
        spec, seen_keys, ids = s["spec"], set(), set()
        assert 1 <= len(s["controls"]) <= 3, f"{s['id']}: at most three quick controls (plan 4)"
        for c in s["controls"]:
            assert c["id"] not in ids, (s["id"], c["id"])
            ids.add(c["id"])
            assert c["keys"] and not (set(c["keys"]) & seen_keys), f"{s['id']}/{c['id']} shares a key"
            seen_keys |= set(c["keys"])
            assert not (set(c["keys"]) & {"price", "dollar_vol_30d", "security_type"}), \
                f"{s['id']}/{c['id']} would let a control remove the floor"
            option_ids = [o["id"] for o in c["options"]]
            assert len(set(option_ids)) == len(option_ids) >= 2, (s["id"], c["id"])
            defaults = [o for o in c["options"] if o.get("default")]
            assert len(defaults) == 1, f"{s['id']}/{c['id']}: {len(defaults)} defaults"
            assert all(o.get("default") is True for o in defaults)
            assert defaults[0]["filters"] == _on_keys(spec, c), \
                f"{s['id']}/{c['id']}: the default option is not what the screen opens on"
            if "sort" in defaults[0]:
                assert defaults[0]["sort"] == spec["sort"], (s["id"], c["id"])
            for o in c["options"]:
                assert {f["key"] for f in o["filters"]} <= set(c["keys"]), (s["id"], c["id"], o["id"])
                assert set(o) <= {"id", "label", "default", "filters", "sort", "place"}, (s["id"], o)
                if "place" in o:
                    # unit U6: an option that numbers the rows by its own column names a
                    # column it also requires and sorts by, on a screen that shows a place
                    assert o["place"] in c["keys"] and o["place"] in snapshot_db.COLUMNS, (s["id"], o["id"])
                    assert o["sort"] == {"key": o["place"], "dir": "asc"}, (s["id"], o["id"])
                    assert {"key": o["place"], "op": "gte", "min": 1} in o["filters"], (s["id"], o["id"])
                    assert isinstance(s["row"]["place"], str) and s["row"]["place"] != "index", s["id"]
                    assert o["place"] != s["row"]["place"], "the screen's own place needs no override"
                # no two options of a control are the same choice
            choices = [json.dumps([o["filters"], o.get("sort")], sort_keys=True) for o in c["options"]]
            assert len(set(choices)) == len(choices), f"{s['id']}/{c['id']}: two options are the same"
            # a control that carries a sort carries it on every option that needs one: once
            # any option sets the sort, choosing the default must set it back
            if any("sort" in o for o in c["options"]):
                assert "sort" in defaults[0], (s["id"], c["id"])
        if "empty" in s:
            for a in s["empty"]["actions"]:
                if "control" in a:
                    c = next(c for c in s["controls"] if c["id"] == a["control"])
                    assert a["option"] in [o["id"] for o in c["options"]]
                else:
                    assert a["open"] in FIVE


def test_the_words_are_plain(on):
    seen = set()
    for s in ss.starters():
        d = s["description"]
        assert d not in seen, d
        seen.add(d)
    for s in _five():
        d = s["description"]
        assert 10 <= len(d) <= 120 and d.isascii(), (s["id"], len(d))
        assert "—" not in d and "–" not in d and " - " not in d
        texts = [s["name"], d, *(c["label"] for c in s["controls"]),
                 *(o["label"] for c in s["controls"] for o in c["options"]),
                 *([s["empty"]["text"], *(a["label"] for a in s["empty"]["actions"])] if "empty" in s else [])]
        for t in texts:
            assert t and t.strip() == t and t.isascii(), (s["id"], t)
            if s["id"] != "starter_rs_exit_warning_5" or t != d:
                assert not BANNED.search(t), (s["id"], t)
    # the one sentence that may say "sell" is the contract's own disclaimer
    assert _by_id()["starter_rs_exit_warning_5"]["description"].endswith("not an order to sell")


# ───────────────────────── every screen and option, run ─────────────────────────

_BASE = {"security_type": "Stock", "snapshot_date": "2026-11-13", "built_at": 1}
ROWS = [
    dict(ticker="LEAD", price=100, dollar_vol_30d=1e8, rs_rating_pos=1, rs_pos_1m=3, rs_pos_3m=1,
         rs_pos_6m=1, rs_pos_12m=1, rs_rating_chg_20=2, pct_vs_sma50=5, rs_rank=99,
         rs_rating_prev20=97, pct_vs_sma200=20, rs_nh_bars_ago=0, rs_rating_score=2.0,
         rs_nh_red_bars_ago=0, px_below_high_pct=0.0, adr_pct=4, market_cap=5e9, sma200_rising=1,
         dist_52w_high_pct=0, rs_line_above_ma=1, rs_near_buy=0, rs_setup="extended"),
    dict(ticker="RISE", price=50, dollar_vol_30d=5e7, rs_rating_pos=2, rs_pos_1m=1, rs_pos_3m=2,
         rs_pos_6m=3, rs_pos_12m=3, rs_rating_chg_20=30, pct_vs_sma50=8, rs_rank=95,
         rs_rating_prev20=65, pct_vs_sma200=15, rs_nh_bars_ago=2, rs_rating_score=1.8,
         rs_nh_red_bars_ago=7, rs_nhbp_age=2, px_below_high_pct=-4.0, adr_pct=5, market_cap=1e9,
         sma200_rising=1, dist_52w_high_pct=-4, rs_line_above_ma=1, rs_near_buy=1, rs_setup="at_pivot",
         rs_flag="one_day_move"),
    dict(ticker="BASE", price=30, dollar_vol_30d=3e7, rs_rating_pos=3, rs_pos_1m=2, rs_pos_3m=3,
         rs_pos_6m=2, rs_pos_12m=2, rs_rating_chg_20=2, pct_vs_sma50=1, rs_rank=88,
         rs_rating_prev20=88, pct_vs_sma200=10, rs_nh_bars_ago=0, rs_rating_score=1.5,
         rs_nhbp_age=0, px_below_high_pct=-4.0, adr_pct=3.5, market_cap=8e8, sma200_rising=1,
         dist_52w_high_pct=-4, rs_line_above_ma=1, rs_near_buy=1, rs_setup="pullback_21",
         rs_flag="new_issue"),
    dict(ticker="SLIP", price=20, dollar_vol_30d=2.5e7, rs_rating_pos=4, rs_pos_1m=4, rs_pos_3m=4,
         rs_pos_6m=4, rs_pos_12m=4, rs_rating_chg_20=-10, pct_vs_sma50=-3, rs_rank=75,
         rs_rating_prev20=92, pct_vs_sma200=5, rs_nh_bars_ago=15, rs_rating_score=1.2,
         rs_nhbp_age=3, px_below_high_pct=-7.0, adr_pct=3, market_cap=4e8, sma200_rising=1,
         dist_52w_high_pct=-7, rs_line_above_ma=0, rs_near_buy=0, rs_setup="below_50",
         rs_exit_bars_ago=1, rs_exit_last="Quicksand"),
    # exactly on the floor ($20M traded): the floor is inclusive
    dict(ticker="WARN", price=15, dollar_vol_30d=2e7, rs_rating_pos=5, rs_pos_1m=6, rs_pos_3m=6,
         rs_pos_6m=5, rs_pos_12m=5, rs_rating_chg_20=-20, pct_vs_sma50=-8, rs_rank=40,
         rs_rating_prev20=60, pct_vs_sma200=-2, rs_rating_score=0.8, px_below_high_pct=-30.0,
         adr_pct=2, market_cap=3e8, sma200_rising=0, dist_52w_high_pct=-30, rs_line_above_ma=0,
         rs_near_buy=0, rs_setup="below_50", rs_exit_bars_ago=3, rs_exit_last="Grateful Dead Break"),
    # under a year of history: no overall place, on the 1- and 3-month boards
    dict(ticker="YOUNG", price=40, dollar_vol_30d=4e7, rs_pos_1m=5, rs_pos_3m=5, pct_vs_sma50=4,
         rs_rank=91, pct_vs_sma200=3, rs_nhbp_age=10, px_below_high_pct=-8.0, market_cap=2e9,
         dist_52w_high_pct=-8, rs_line_above_ma=1),
    # a leader whose Setup label could not be computed
    dict(ticker="NOLBL", price=60, dollar_vol_30d=6e7, pct_vs_sma50=2, rs_rank=85, pct_vs_sma200=8,
         rs_rating_score=1.4, px_below_high_pct=-10.0, adr_pct=3, market_cap=5e8, sma200_rising=1,
         dist_52w_high_pct=-10, rs_line_above_ma=1),
    # a stock pinned at a deal price (unit U6): the highest score and the largest rating
    # gain in the table, liquid, in an uptrend, an RS high today. It would lead all four
    # list screens; it is on none of them, and RS exit warnings still lists it.
    dict(ticker="DEAL", price=80, dollar_vol_30d=2e8, rs_rating_pos=6, rs_pos_1m=7, rs_pos_3m=7,
         rs_pos_6m=6, rs_pos_12m=6, rs_rating_chg_20=60, pct_vs_sma50=20, rs_rank=99,
         rs_rating_prev20=39, pct_vs_sma200=30, rs_nh_bars_ago=0, rs_rating_score=3.5,
         rs_nh_red_bars_ago=0, rs_nhbp_age=0, px_below_high_pct=-4.0, adr_pct=5, market_cap=2e10,
         sma200_rising=1, dist_52w_high_pct=-4, rs_line_above_ma=1, rs_near_buy=1,
         rs_setup="at_pivot", rs_flag="buyout_pending", rs_exit_bars_ago=2, rs_exit_last="Quick Break"),
    # a fund that would top every list, and a stock under the floor that would join four
    dict(ticker="FUND", security_type="ETF", price=400, dollar_vol_30d=1e9, rs_rating_pos=1,
         rs_pos_1m=1, rs_pos_3m=1, rs_pos_6m=1, rs_pos_12m=1, rs_rating_chg_20=50, pct_vs_sma50=9,
         rs_rank=99, rs_rating_prev20=10, pct_vs_sma200=10, rs_nh_bars_ago=0, rs_rating_score=3.0,
         rs_nh_red_bars_ago=0, rs_nhbp_age=0, px_below_high_pct=-5.0, adr_pct=3, market_cap=1e10,
         sma200_rising=1, dist_52w_high_pct=-5, rs_line_above_ma=1, rs_near_buy=1,
         rs_setup="at_pivot", rs_exit_bars_ago=0, rs_exit_last="Quick Break"),
    dict(ticker="THIN", price=8, dollar_vol_30d=5e6, rs_rating_pos=2, rs_pos_1m=2, rs_pos_3m=2,
         rs_pos_6m=2, rs_pos_12m=2, rs_rating_chg_20=40, pct_vs_sma50=9, rs_rank=97,
         rs_rating_prev20=20, pct_vs_sma200=5, rs_nh_bars_ago=0, rs_rating_score=2.5,
         rs_nh_red_bars_ago=0, rs_nhbp_age=1, px_below_high_pct=-5.0, adr_pct=6, market_cap=1e9,
         sma200_rising=1, dist_52w_high_pct=-5, rs_line_above_ma=1, rs_near_buy=1,
         rs_setup="at_pivot", rs_exit_bars_ago=0, rs_exit_last="Quick Break"),
]

#: ``(starter, {control: option, ...})`` -> the tickers, in the order served.
EXPECT = [
    ("starter_rs_top_rating", {}, ["LEAD", "RISE", "BASE", "SLIP", "WARN"]),
    ("starter_rs_top_rating", {"rank_by": "m1"}, ["RISE", "BASE", "LEAD", "SLIP", "YOUNG", "WARN"]),
    ("starter_rs_top_rating", {"rank_by": "m3"}, ["LEAD", "RISE", "BASE", "SLIP", "YOUNG", "WARN"]),
    ("starter_rs_top_rating", {"rank_by": "m6"}, ["LEAD", "BASE", "RISE", "SLIP", "WARN"]),
    ("starter_rs_top_rating", {"rank_by": "m12"}, ["LEAD", "BASE", "RISE", "SLIP", "WARN"]),
    # equal 20-session gains (LEAD and BASE, both 2) fall to the overall place
    ("starter_rs_top_rating", {"rank_by": "rising"}, ["RISE", "LEAD", "BASE"]),
    ("starter_rs_top_rating", {"show": "r90"}, ["LEAD", "RISE"]),
    ("starter_rs_top_rating", {"show": "new90"}, ["RISE"]),
    # two controls at once: the 1-month board, 90 and up. The young stock is on it.
    ("starter_rs_top_rating", {"rank_by": "m1", "show": "r90"}, ["RISE", "LEAD", "YOUNG"]),
    ("starter_rs_top_rating", {"rank_by": "overall", "show": "all"}, ["LEAD", "RISE", "BASE", "SLIP", "WARN"]),
    # both made an RS high today: the higher score first (ticker order would say BASE)
    ("starter_rs_new_high", {}, ["LEAD", "BASE", "RISE"]),
    ("starter_rs_new_high", {"when": "today"}, ["LEAD", "BASE"]),
    ("starter_rs_new_high", {"when": "week"}, ["LEAD", "BASE", "RISE"]),
    ("starter_rs_new_high", {"when": "month"}, ["LEAD", "BASE", "RISE", "SLIP"]),
    ("starter_rs_new_high", {"min": "any"}, ["LEAD", "BASE", "RISE"]),
    ("starter_rs_new_high", {"min": "r70"}, ["LEAD", "BASE", "RISE"]),
    ("starter_rs_new_high", {"min": "r80"}, ["LEAD", "BASE", "RISE"]),
    ("starter_rs_new_high", {"min": "r90"}, ["LEAD", "RISE"]),
    ("starter_rs_new_high", {"down": "all"}, ["LEAD", "BASE", "RISE"]),
    ("starter_rs_new_high", {"down": "down"}, ["LEAD", "RISE"]),
    # both 4% under their highs: the higher score first (ticker order would say BASE)
    ("starter_rs_nh_before_price", {}, ["RISE", "BASE", "SLIP"]),
    ("starter_rs_nh_before_price", {"when": "today"}, ["BASE"]),
    ("starter_rs_nh_before_price", {"when": "week"}, ["RISE", "BASE", "SLIP"]),
    ("starter_rs_nh_before_price", {"when": "month"}, ["RISE", "BASE", "SLIP", "YOUNG"]),
    ("starter_rs_nh_before_price", {"below": "p3"}, ["RISE", "BASE", "SLIP"]),
    ("starter_rs_nh_before_price", {"below": "p5"}, ["SLIP"]),
    ("starter_rs_nh_before_price", {"below": "p10"}, []),
    ("starter_rs_nh_before_price", {"min": "any"}, ["RISE", "BASE", "SLIP"]),
    ("starter_rs_nh_before_price", {"min": "r70"}, ["RISE", "BASE", "SLIP"]),
    ("starter_rs_nh_before_price", {"min": "r80"}, ["RISE", "BASE"]),
    ("starter_rs_leaders", {}, ["LEAD", "RISE", "BASE", "NOLBL"]),
    ("starter_rs_leaders", {"show": "all"}, ["LEAD", "RISE", "BASE", "NOLBL"]),
    ("starter_rs_leaders", {"show": "near"}, ["RISE", "BASE"]),
    # a stock with no label is not "extended": it stays (the exclude rule keeps a blank)
    ("starter_rs_leaders", {"show": "noext"}, ["RISE", "BASE", "NOLBL"]),
    ("starter_rs_leaders", {"min": "r80"}, ["LEAD", "RISE", "BASE", "NOLBL"]),
    ("starter_rs_leaders", {"min": "r85"}, ["LEAD", "RISE", "BASE", "NOLBL"]),
    ("starter_rs_leaders", {"min": "r90"}, ["LEAD", "RISE"]),
    ("starter_rs_leaders", {"min": "r95"}, ["LEAD", "RISE"]),
    # the buyout name is NOT left out of the warnings (it is left out of the four lists)
    ("starter_rs_exit_warning_5", {}, ["SLIP", "DEAL", "WARN"]),
    ("starter_rs_exit_warning_5", {"type": "any"}, ["SLIP", "DEAL", "WARN"]),
    ("starter_rs_exit_warning_5", {"type": "quick_break"}, ["DEAL"]),
    ("starter_rs_exit_warning_5", {"type": "quicksand"}, ["SLIP"]),
    ("starter_rs_exit_warning_5", {"type": "grateful_dead_break"}, ["WARN"]),
]


@pytest.fixture
def table(on, tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    monkeypatch.setenv(logic.FLAG, "1")
    snapshot_db.init_db()
    snapshot_db.upsert_rows([{**_BASE, **r} for r in ROWS])
    monkeypatch.setattr(query, "stale_gate", lambda conn: None)
    membership._CURRENT.clear()
    return _by_id()


def _spec_for(starter, choices):
    spec = copy.deepcopy(starter["spec"])
    for cid, oid in choices.items():
        control = next(c for c in starter["controls"] if c["id"] == cid)
        spec = _apply(spec, control, next(o for o in control["options"] if o["id"] == oid))
    return spec


@pytest.mark.parametrize("sid, choices, expect", EXPECT,
                         ids=[f"{s.replace('starter_rs_', '')}:{'+'.join(c.values()) or 'default'}"
                              for s, c, _ in EXPECT])
def test_each_screen_and_each_option_returns_exactly_these_rows(table, sid, choices, expect):
    spec = _spec_for(table[sid], choices)
    out = query.run_scan(spec)
    assert [r["ticker"] for r in out["rows"]] == expect
    assert query.preview_count(spec)["count"] == len(expect)


def test_every_option_of_every_control_is_in_the_table_above(on):
    """The table is derived by hand; this is what makes it complete. An option added to a
    control without a row above fails here, so no option ships unrun."""
    covered = {(sid, cid, oid) for sid, choices, _ in EXPECT for cid, oid in choices.items()}
    every = {(s["id"], c["id"], o["id"]) for s in _five() for c in s["controls"] for o in c["options"]}
    assert every - covered == set(), sorted(every - covered)
    assert {sid for sid, choices, _ in EXPECT if not choices} == set(FIVE)


def test_every_option_alone_and_in_pairs_is_a_spec_the_scan_accepts(table):
    """Beyond the hand-derived rows: every single option, and every pair of options from
    two different controls of a screen, counts without a refusal."""
    n = 0
    for sid in FIVE:
        s = table[sid]
        singles = [(c, o) for c in s["controls"] for o in c["options"]]
        for c, o in singles:
            assert isinstance(query.preview_count(_apply(s["spec"], c, o))["count"], int)
            n += 1
        for i, (c1, o1) in enumerate(singles):
            for c2, o2 in singles[i + 1:]:
                if c1["id"] == c2["id"]:
                    continue
                spec = _apply(_apply(s["spec"], c1, o1), c2, o2)
                got = query.preview_count(spec)["count"]
                if not _on_keys(s["spec"], c2):
                    # the second control opens with no clause, so its options only narrow
                    assert got <= query.preview_count(_apply(s["spec"], c1, o1))["count"], \
                        (sid, c1["id"], o1["id"], c2["id"], o2["id"])
                n += 1
    assert n > 60


def test_buyout_names_are_left_out_of_the_four_lists_and_a_blank_flag_stays(table):
    """Unit U6. The clause is an exclude list, and the scan keeps a NULL under one, so
    the rows with no flag (nearly all of them) stay; so do the other two flags. Without
    the clause the buyout name is on each list, which is what makes its absence the
    clause's doing and not an accident of the table."""
    flags = {r["ticker"]: r.get("rs_flag") for r in ROWS}
    assert flags["DEAL"] == "buyout_pending" and flags["LEAD"] is None
    assert (flags["RISE"], flags["BASE"]) == ("one_day_move", "new_issue")
    for sid in LIST_SCREENS:
        spec = table[sid]["spec"]
        with_it = [r["ticker"] for r in query.run_scan(spec)["rows"]]
        assert "DEAL" not in with_it and with_it, sid
        assert {"RISE", "BASE"} <= set(with_it), f"{sid}: another flag was left out too"
        assert [t for t in with_it if flags[t] is None], f"{sid}: no blank-flag row survived"
        bare = {**spec, "filters": [f for f in spec["filters"] if f != NO_BUYOUT]}
        without = [r["ticker"] for r in query.run_scan(bare)["rows"]]
        assert "DEAL" in without, f"{sid}: the buyout row was never a candidate"
        assert [t for t in without if t != "DEAL"] == with_it, sid
        # every option of every control keeps it out as well
        for c in table[sid]["controls"]:
            for o in c["options"]:
                got = [r["ticker"] for r in query.run_scan(_apply(spec, c, o))["rows"]]
                assert "DEAL" not in got, (sid, c["id"], o["id"])
    # the highest score in the table, so without the clause it is the first leader
    bare = {**table["starter_rs_leaders"]["spec"]}
    bare["filters"] = [f for f in bare["filters"] if f != NO_BUYOUT]
    assert query.run_scan(bare)["rows"][0]["ticker"] == "DEAL"
    # SQL drops a NULL under a plain "is not", which is why the clause is an exclude list:
    # written as != it would keep only the rows that carry some OTHER flag
    with snapshot_db.connect() as conn:
        kept = [r[0] for r in conn.execute(
            "SELECT ticker FROM screener_rows WHERE rs_flag != 'buyout_pending'")]
    assert sorted(kept) == ["BASE", "RISE"]
    assert "starter_rs_exit_warning_5" not in LIST_SCREENS
    assert "DEAL" in [r["ticker"] for r in query.run_scan(table["starter_rs_exit_warning_5"]["spec"])["rows"]]


def test_the_leaders_list_is_capped_and_ranked_by_the_score(table):
    spec = table["starter_rs_leaders"]["spec"]
    out = query.run_scan({**spec, "rank": {**spec["rank"], "top_n": 2}})
    assert [r["ticker"] for r in out["rows"]] == ["LEAD", "RISE"]
    assert query.preview_count(spec)["top_n"] == 50


# ───────────────────────── the hidden seven ─────────────────────────

def test_hidden_starters_stay_in_the_payload_and_still_run(table):
    for sid in HIDDEN:
        s = table[sid]
        assert s["hidden"] is True and s["spec"]["filters"][-1] == STOCKS
        assert not (set(s) & {"controls", "row", "empty"}), sid
        assert isinstance(query.preview_count(s["spec"])["count"], int), sid
    # resolved by id exactly as a pinned or last-used screen is
    assert table["starter_rs_quicksand_5"]["name"] == "Quicksand in the last 5 sessions"
    assert [r["ticker"] for r in query.run_scan(table["starter_rs_quicksand_5"]["spec"])["rows"]] == []
    assert table["starter_momentum_leaders"]["name"].startswith("Leaders")


def test_the_nightly_membership_record_takes_the_five_and_the_hidden_ones(table, monkeypatch):
    monkeypatch.setattr(ss, "all_specs", lambda: [])
    monkeypatch.setattr(membership, "_build_identity", lambda: ("2026-11-13", "2026-11-13"))
    out = membership.record_all()
    assert out["errors"] == 0, out
    with snapshot_db.connect() as conn:
        stored = {r["spec_hash"]: r for r in conn.execute("SELECT * FROM screen_membership")}
    for sid in FIVE + HIDDEN:
        h = membership.spec_hash(table[sid]["spec"])
        assert h in stored and stored[h]["state"] == "ok", sid
    leaders = stored[membership.spec_hash(table["starter_rs_leaders"]["spec"])]
    assert json.loads(leaders["tickers"]) == ["BASE", "LEAD", "NOLBL", "RISE"]
    top = stored[membership.spec_hash(table["starter_rs_top_rating"]["spec"])]
    assert json.loads(top["tickers"]) == ["BASE", "LEAD", "RISE", "SLIP", "WARN"]
    # the record is keyed by criteria alone, so a second sort key does not move it
    nh = table["starter_rs_new_high"]["spec"]
    assert membership.spec_hash(nh) == membership.spec_hash({**nh, "sort": {"key": "price"}})
    assert membership.diff(nh)["state"] == "no_history"


# ───────────────────────── the route ─────────────────────────

def _client(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
    from api.routers import screener as screener_mod
    monkeypatch.setattr(screener_mod.scr_saved, "list_for", lambda uid: [])
    paid = {"id": "u1", "role": "member", "plan": "pro"}
    app = FastAPI()
    app.include_router(screener_mod.router)
    app.dependency_overrides[get_current_user] = lambda: dict(paid)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(paid)
    return TestClient(app)


def test_the_saved_screens_route_serves_the_whole_shape_when_on(on, monkeypatch):
    r = _client(monkeypatch).get("/api/screener/saved-screens")
    assert r.status_code == 200, r.text[:200]
    by = {s["id"]: s for s in r.json()["starters"]}
    assert [by[i] for i in FIVE] == json.loads(GOLDEN.read_text(encoding="utf-8"))
    assert all(set(by[i]) >= {"id", "name", "group", "description", "spec", "controls", "row"} for i in FIVE)
    assert "empty" in by["starter_rs_nh_before_price"] and "aliases" in by["starter_rs_nh_before_price"]
    assert {i for i, s in by.items() if s.get("hidden") is True} == set(HIDDEN)
    assert by["starter_rs_new_high"]["row"]["place"] is None, "a null place is sent, not dropped"
    # every other starter is served without any of the new keys
    for sid, s in by.items():
        if sid not in FIVE and sid not in HIDDEN:
            assert not (set(NEW_KEYS) & set(s)), sid


def test_the_saved_screens_route_serves_todays_shape_when_off(off, monkeypatch):
    r = _client(monkeypatch).get("/api/screener/saved-screens")
    assert r.status_code == 200
    starters = r.json()["starters"]
    assert all(not (set(NEW_KEYS) & set(s)) for s in starters)
    assert [s["id"] for s in starters if s["id"].startswith("starter_rs_")] == list(TODAY_RS)


# ───────────────────────── the views ─────────────────────────

VIEWS = {"starter_rs_top_rating": "rs_top_rating", "starter_rs_new_high": "rs_new_highs",
         "starter_rs_nh_before_price": "rs_before_price", "starter_rs_leaders": "rs_leaders"}


def test_each_of_the_four_views_leads_with_the_row_and_fits_the_table():
    assert tuple(VIEWS.values()) == F.RS_SCREENS_VIEWS
    for key in F.RS_SCREENS_VIEWS:
        cols = F.VIEWS[key]["columns"]
        assert cols[:4] == ["ticker", "company", "price", "chg_pct_1d"], key
        assert 8 <= len(cols) < 16 and len(set(cols)) == len(cols), (key, len(cols))
        assert set(cols) <= set(snapshot_db.COLUMNS), sorted(set(cols) - set(snapshot_db.COLUMNS))
        assert "rs_rank" in cols and "rsi14" not in cols, f"{key}: the RS Rating, never RSI beside it"
        assert F.VIEWS[key]["label"]
    assert F.VIEWS["rs_top_rating"]["label"] == "Top RS Rating"
    # each view shows what its own screen filters and sorts on
    assert {"rs_rating_pos", "rs_pos_1m", "rs_pos_3m", "rs_pos_6m", "rs_pos_12m", "rs_rating_chg_20",
            "rs_rating_prev20", "rs_rating_session"} <= set(F.VIEWS["rs_top_rating"]["columns"])
    assert {"rs_nh_bars_ago", "rs_nh_red_bars_ago", "pct_vs_sma200"} <= set(F.VIEWS["rs_new_highs"]["columns"])
    assert {"rs_nhbp_age", "px_below_high_pct", "pct_vs_sma200"} <= set(F.VIEWS["rs_before_price"]["columns"])
    assert {"rs_setup", "rs_near_buy", "rs_tight", "rs_flag", "dist_52w_high_pct"} <= \
        set(F.VIEWS["rs_leaders"]["columns"])


def test_each_screen_names_its_view_and_a_scan_answers_with_its_columns(table):
    for sid, view in VIEWS.items():
        assert table[sid]["spec"]["view"] == view
        out = query.run_scan(table[sid]["spec"])
        assert out["view"] == view
        assert [c for c in out["view_columns"] if c != "rank_score"] == F.VIEWS[view]["columns"]
    assert table["starter_rs_exit_warning_5"]["spec"]["view"] == "relative_strength"


def test_meta_serves_the_four_views_only_while_both_flags_are_on(monkeypatch):
    from api.services.screener import distribution
    monkeypatch.setattr(distribution, "distributions", lambda: {"basis": None})
    monkeypatch.setattr(F, "_rs_history_on", lambda: True)
    monkeypatch.setattr(F, "_rs_v3_on", lambda: True)

    def views(v2, screens):
        monkeypatch.setattr(F, "_rs_v2_on", lambda: v2)
        monkeypatch.setenv("RS_SCREENS_ENABLED", "1" if screens else "0")
        return [v["key"] for v in F.meta()["views"]]

    both = views(True, True)
    assert [k for k in both if k in F.RS_SCREENS_VIEWS] == list(F.RS_SCREENS_VIEWS)
    for v2, screens in ((True, False), (False, True), (False, False)):
        got = views(v2, screens)
        assert not (set(got) & set(F.RS_SCREENS_VIEWS)), (v2, screens)
    # off, the view list is exactly what it is without this unit's four
    assert views(True, False) == [k for k in both if k not in F.RS_SCREENS_VIEWS]
    # on, each served view holds only keys a member is served (nothing dark leaks in)
    monkeypatch.setattr(F, "_rs_v2_on", lambda: True)
    monkeypatch.setenv("RS_SCREENS_ENABLED", "1")
    meta = F.meta()
    for v in meta["views"]:
        if v["key"] in F.RS_SCREENS_VIEWS:
            assert v["columns"] == F.VIEWS[v["key"]]["columns"], v["key"]


# ───────────────────────── the method page ─────────────────────────

def test_the_method_page_states_each_rule_from_the_constants_that_apply_it(on):
    from api.services.screener import methodology as M
    doc = M.all_methods()["rs_screens"]
    assert doc == M.rs_screens_section()
    assert [s["id"] for s in doc["screens"]] == list(FIVE)
    assert [s["name"] for s in doc["screens"]] == [s["name"] for s in _five()]
    rules = {s["id"]: s["rule"] + " " + s["controls"] for s in doc["screens"]}
    assert "full year of price history" in rules["starter_rs_top_rating"]
    assert "prior 252 sessions within the last 5 sessions" in rules["starter_rs_new_high"]
    assert "within the last 10 sessions on a day SPY closed down 0.5% or more" in rules["starter_rs_new_high"]
    assert "closed 3% to 25% below that high" in rules["starter_rs_nh_before_price"]
    # unit U6: the four list screens say which flagged stocks they leave out; the warnings do not
    for sid in FIVE:
        said = "Stocks flagged Buyout pending are left out." in rules[sid]
        assert said == (sid in LIST_SCREENS), sid
    for words in ("average daily range of 3% or more", "$300M or more", "RS Rating 80 or higher",
                  "within 25% of its 52-week high", "The 50 with the highest RS Rating score"):
        assert words in rules["starter_rs_leaders"], words
    assert doc["floor"].count("$10 or more") == 1 and "$20M or more traded a day" in doc["floor"]
    labels = {x["key"]: x for x in doc["setup"]["labels"]}
    assert list(labels) == list(rs_setup.SETUPS)
    assert [x["label"] for x in doc["setup"]["labels"]] == [rs_setup.SETUP_LABELS[k] for k in rs_setup.SETUPS]
    assert labels["extended"]["rule"] == ("4 or more ATRs above the 50-day average, or 3 or more ATRs "
                                         "above the 21-day EMA, or more than 5% past a base pivot.")
    assert "Jeff Sun" in labels["extended"]["source"] and "IBD" in labels["at_pivot"]["source"]
    assert labels["at_pivot"]["rule"].startswith("From 3% below a base pivot to 5% above it.")
    assert "20-session high within the last 15 sessions" in labels["pullback_8"]["rule"]
    assert "within 0.5 ATR of a rising 21-day EMA" in labels["pullback_21"]["rule"]
    assert all(x["source"] for x in doc["setup"]["labels"]), "every rule says where its number is from"
    flags = {x["key"]: x["rule"] for x in doc["setup"]["flags"]}
    assert list(flags) == list(rs_setup.FLAGS)
    assert "at least 5 sessions ago" in flags["buyout_pending"] and "1.5% range" in flags["buyout_pending"]
    assert "Fewer than 253 daily bars" in flags["new_issue"]
    assert "04:15 ET" in doc["ratings_as_of"] and "previous session" in doc["ratings_as_of"]
    assert doc["rating_note"] == ("Our RS Rating is our own calculation. It follows IBD's published "
                                  "method and can differ from IBD's number by a few points.")


def test_the_method_page_follows_a_changed_threshold(on, monkeypatch):
    """The numbers are read, not typed: move one and the sentence moves."""
    from api.services.screener import methodology as M
    monkeypatch.setattr(rs_setup, "EXTENDED_ATR_SMA50", 6.0)
    monkeypatch.setattr(rs_setup, "BUYOUT_MIN_SESSIONS", 9)
    monkeypatch.setattr(rs_screens, "LEADERS_TOP_N", 25)
    monkeypatch.setitem(rs_post_pass.LIQUID_FLOOR, "price_min", 12.0)
    doc = M.rs_screens_section()
    assert doc["setup"]["labels"][1]["rule"].startswith("6 or more ATRs above the 50-day average")
    assert "at least 9 sessions ago" in doc["setup"]["flags"][0]["rule"]
    assert "The 25 with the highest" in doc["screens"][3]["rule"]
    assert "$12 or more" in doc["floor"]


def test_the_method_page_claims_no_success_rate_and_uses_plain_words(on):
    from api.services.screener import methodology as M

    def walk(node):
        if isinstance(node, str):
            yield node
        elif isinstance(node, dict):
            for v in node.values():
                yield from walk(v)
        elif isinstance(node, list):
            for v in node:
                yield from walk(v)

    texts = list(walk(M.rs_screens_section()))
    assert len(texts) > 40
    claim = re.compile(r"win rate|hit rate|success rate|\bwins?\b|outperform|beats? the|"
                       r"\d+\s?% of the time|on average|track record", re.I)
    for t in texts:
        assert "—" not in t and "–" not in t, t
        assert not claim.search(t), t
        if "not an order to sell" not in t:
            assert not BANNED.search(t), t


def test_the_method_page_is_served_only_while_the_screens_are(off):
    from api.services.screener import methodology as M
    assert "rs_screens" not in M.all_methods()
