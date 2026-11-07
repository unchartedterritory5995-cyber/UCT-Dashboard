"""U6 (2026-11-07): the screener's RS surfaces follow the flags of the data behind them.

Review findings, phase2a-review.md:
  #12  the seven RS starters were filed under "Momentum leaders" (their group
       label matched nothing in screenGroups.js) and shipped with no gate;
  #14  the seven rating columns and their "Over 80 / Over 90" presets were
       served while RS_HISTORY_ENABLED is off (NULL on every row);
  #9   the Mansfield copy called a 200-session average "its own past year";
  #33  "Rank 1M" said 21 sessions is one of the rating's weighted windows;
  #34  unmeasured frequency claims about RS-before-price and red-day highs.

The flags are read where they live: `registry_defs.RS_V2_ENABLED` (set as an
attribute here) and `api.main.rs_history_enabled()` (a stub module put in
`sys.modules`, which is how `filters._rs_history_on` reads it).
"""
import importlib
import pathlib
import re
import sys
import types

import pytest

from api.services.screener import filters, rs_columns, snapshot_builder
from api.services.signature import registry_defs

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCREEN_GROUPS_JS = ROOT / "app" / "src" / "pages" / "screener" / "focus" / "screenGroups.js"
COLUMN_DEFS_JS = ROOT / "app" / "src" / "pages" / "screener" / "columnDefs.js"

BARS = frozenset(rs_columns.COLUMNS)
RATINGS = frozenset(snapshot_builder._RS_HISTORY_COLUMNS)


def _main_stub(history):
    """A stand-in for `api.main`: the flag reader, plus the `app.dependency_overrides`
    the suite's autouse conftest fixture restores on teardown."""
    stub = types.ModuleType("api.main")
    stub.rs_history_enabled = lambda: history
    stub.app = types.SimpleNamespace(dependency_overrides={})
    return stub


def _flags(monkeypatch, *, v2, history):
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", v2)
    monkeypatch.setitem(sys.modules, "api.main", _main_stub(history))


def _svc(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    import api.services.auth_db as adb
    importlib.reload(adb)
    adb.init_db()
    import api.services.screener.saved_screens as ss
    importlib.reload(ss)
    ss.init()
    return ss


# ── #12: the starter groups ────────────────────────────────────────────────

def _client_groups():
    """`GROUPS` from screenGroups.js, parsed: [(key, label), ...]."""
    src = SCREEN_GROUPS_JS.read_text(encoding="utf-8")
    block = re.search(r"export const GROUPS = \[(.*?)\n\]", src, re.S).group(1)
    pairs = re.findall(r"\{\s*key:\s*'([^']+)',\s*label:\s*'([^']+)'\s*\}", block)
    assert len(pairs) >= 7, pairs
    return pairs


def _client_group_of(label, groups):
    """`groupOf` from screenGroups.js, by label only, WITHOUT its momentum
    fallback: returns None where the client would have fallen back."""
    g = label.lower()
    by_label = {lab.lower(): key for key, lab in groups}
    if g in by_label:
        return by_label[g]
    if g in {key for key, _lab in groups}:
        return g
    if g == "chart patterns":       # the one alias groupOf states
        return "bases"
    return None


def _every_starter(ss, monkeypatch):
    """Every starter the server can serve, with every gate on."""
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", True)
    monkeypatch.setattr(ss, "pattern_presets_enabled", lambda: True)
    out = [*ss._starter_defs(), *ss.premarket_starters(), *ss.pattern_starters()]
    # the archive starter is gated on the wisdom flag; its group is a literal
    out.append({"id": "starter_team_called", "group": "Team archive"})
    return out


def test_every_starter_group_resolves_to_its_own_GROUPS_key(tmp_path, monkeypatch):
    """⛔ Before the fix "Relative strength" matched no label and no key, so
    ScreenMenu filed the seven RS starters under Momentum leaders."""
    ss = _svc(tmp_path, monkeypatch)
    groups = _client_groups()
    starters = _every_starter(ss, monkeypatch)
    labels = {s["group"] for s in starters if s.get("group")}
    assert ss.RS_STARTER_GROUP in labels, "the RS starters were not collected"
    unresolved = sorted(lab for lab in labels if _client_group_of(lab, groups) is None)
    assert not unresolved, f"starter groups with no GROUPS row (fall back to momentum): {unresolved}"
    rs = [s for s in starters if s.get("group") == ss.RS_STARTER_GROUP]
    assert len(rs) == 7
    assert {_client_group_of(s["group"], groups) for s in rs} == {"relative_strength"}
    # and only Momentum-labelled starters land in momentum
    for s in starters:
        if _client_group_of(s.get("group", ""), groups) == "momentum":
            assert s["group"].lower() in ("momentum leaders", "momentum"), s["id"]


def test_control_an_unknown_group_is_reported_unresolved():
    assert _client_group_of("No such group", _client_groups()) is None


def test_rs_starters_are_dark_while_RS_V2_is_off(tmp_path, monkeypatch):
    ss = _svc(tmp_path, monkeypatch)
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", False)
    ids = [s["id"] for s in ss.starters()]
    assert ids, "no starters at all: the check below would be vacuous"
    assert not [i for i in ids if i.startswith("starter_rs_")], ids
    assert ss.rs_starters() == []


def test_rs_starters_ship_when_RS_V2_is_on(tmp_path, monkeypatch):
    ss = _svc(tmp_path, monkeypatch)
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", True)
    rs = [s for s in ss.starters() if s["id"].startswith("starter_rs_")]
    assert len(rs) == 7
    assert {s["group"] for s in rs} == {ss.RS_STARTER_GROUP}


# ── #14: meta() leaves out what a dark writer leaves NULL ──────────────────

def _meta(monkeypatch, *, v2, history):
    _flags(monkeypatch, v2=v2, history=history)
    return filters.meta()


def _served(m):
    keys = {f["key"] for f in m["filters"]}
    views = {v["key"]: v["columns"] for v in m["views"]}
    cats = {c["key"] for c in m["categories"]}
    comparable = {c["key"] for c in m["comparable_fields"]}
    return keys, views, cats, comparable


def test_the_two_families_are_the_writers_and_the_category_split_matches():
    assert len(BARS) == 10 and len(RATINGS) == 7 and not (BARS & RATINGS)
    family = {k for k, f in filters.FILTERS.items() if f["category"] == "relative_strength"}
    assert family == BARS | RATINGS
    assert filters.rs_dark_keys(v2_on=False, history_on=True) == BARS
    assert filters.rs_dark_keys(v2_on=True, history_on=False) == RATINGS
    assert filters.rs_dark_keys(v2_on=True, history_on=True) == frozenset()


def test_both_flags_off_no_rs_control_seat_view_or_category(monkeypatch):
    keys, views, cats, comparable = _served(_meta(monkeypatch, v2=False, history=False))
    assert not (keys & (BARS | RATINGS)), sorted(keys & (BARS | RATINGS))
    assert "relative_strength" not in views
    assert "relative_strength" not in cats
    assert not (set(views["momentum"]) & (BARS | RATINGS)), views["momentum"]
    assert not (comparable & (BARS | RATINGS))
    # the family's neighbours are untouched
    assert {"rs_rank", "rs_line_trend", "rs_return"} <= keys
    assert "rs_line_trend" in views["momentum"]


def test_history_off_hides_the_rating_columns_and_their_presets(monkeypatch):
    """⛔ Before the fix "RS Rating (IBD-style) Over 90" was served with the
    rating job dark, a filter that returns 0 rows, and Momentum carried a
    column of dashes."""
    m = _meta(monkeypatch, v2=True, history=False)
    keys, views, cats, comparable = _served(m)
    assert not (keys & RATINGS), sorted(keys & RATINGS)
    assert BARS <= keys
    assert "relative_strength" in cats
    assert "rs_rating_ibd" not in views["momentum"]
    assert {"rs_new_high", "rs_nh_before_price"} <= set(views["momentum"])
    assert not (set(views["relative_strength"]) & RATINGS), views["relative_strength"]
    assert BARS <= set(views["relative_strength"])
    assert not (comparable & RATINGS)


def test_v2_off_history_on_shows_only_the_rating_family(monkeypatch):
    keys, views, cats, _comparable = _served(_meta(monkeypatch, v2=False, history=True))
    assert not (keys & BARS) and RATINGS <= keys
    assert "relative_strength" not in views
    assert "rs_rating_ibd" in views["momentum"]
    assert not (set(views["momentum"]) & BARS)
    assert "relative_strength" in cats


def test_both_flags_on_serves_the_whole_family_exactly_as_registered(monkeypatch):
    m = _meta(monkeypatch, v2=True, history=True)
    keys, views, cats, _comparable = _served(m)
    assert (BARS | RATINGS) <= keys
    assert views == {k: v["columns"] for k, v in filters.VIEWS.items()}
    assert "relative_strength" in cats
    ibd = next(f for f in m["filters"] if f["key"] == "rs_rating_ibd")
    assert [p["label"] for p in ibd["presets"]] == ["Any", "Over 80", "Over 90"]


def test_the_registry_itself_is_not_changed_by_a_dark_meta(monkeypatch):
    """A stored spec on an RS key still validates and runs; only the panel hides it."""
    _meta(monkeypatch, v2=False, history=False)
    assert (BARS | RATINGS) <= set(filters.FILTERS)
    assert "relative_strength" in filters.VIEWS
    assert "rs_rating_ibd" in filters.VIEWS["momentum"]["columns"]
    assert filters.is_valid_op("rs_rating_ibd", "gte")


def test_history_reader_is_dark_without_api_main(monkeypatch):
    """`api.main` is never imported by the screener; outside the web process
    the rating family reads as dark."""
    monkeypatch.delitem(sys.modules, "api.main", raising=False)
    assert filters._rs_history_on() is False
    monkeypatch.setitem(sys.modules, "api.main", _main_stub(True))
    assert filters._rs_history_on() is True


# ── #9, #33, #34: the copy ────────────────────────────────────────────────

def _desc(key):
    src = COLUMN_DEFS_JS.read_text(encoding="utf-8")
    m = re.search(rf"\n  {key}: \{{.*?\n    desc: '((?:[^'\\]|\\.)*)'", src, re.S)
    assert m, key
    return m.group(1)


def test_mansfield_copy_names_the_200_session_average_not_a_past_year():
    from api.services.screener import methodology as M
    mans = M.for_column("mansfield")
    assert "past year" not in mans["how"].lower()
    assert "200-session average" in mans["how"]
    assert "past year" not in _desc("mansfield").lower()
    assert "200-session average" in _desc("mansfield")


def test_rank_1m_does_not_claim_the_rating_weights_21_sessions():
    d = _desc("rs_rating_1m")
    assert "one of the four windows" not in d
    assert "does not weight" in d
    # the 6M and 12M windows ARE weighted, and keep saying so
    assert "one of the four windows" in _desc("rs_rating_6m")


def test_no_unmeasured_frequency_claims_on_the_rs_highs():
    from api.services.screener import methodology as M
    before = M.for_column("rs_nh_before_price")["caveat"]
    red = M.for_column("rs_nh_red_day")["caveat"]
    assert "often do this" not in before and "no published study" in before
    assert "more often than" not in red and "not been measured publicly" in red
    d = _desc("rs_nh_before_price")
    assert "leaders often print" not in d and "no published study" in d
