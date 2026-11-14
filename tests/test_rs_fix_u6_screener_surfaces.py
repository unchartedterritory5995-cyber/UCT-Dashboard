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

# the RS_V2 bar family: the ten plus the five RS Exit Warning columns (2026-11-13), one writer, one gate
BARS = frozenset(rs_columns.COLUMNS) | frozenset(rs_columns.EXIT_COLUMNS)
RATINGS = frozenset(snapshot_builder._RS_HISTORY_COLUMNS)
#: Unit 3-11 (2026-11-07): the third family, written by the same step only while
#: RS_V3 is armed too (`filters.rs_dark_keys`).
PHASE3 = frozenset(rs_columns.PHASE3_COLUMNS)
#: RS screens unit U1 (2026-11-14): the fourth family, written by `rs_post_pass.run` only
#: while RS_SCREENS_ENABLED is on. Its own rails are tests/test_rs_screens_u1_registration.py;
#: here it is DARK (the flag is unset), so `meta()` serves none of it in any test below.
SCREENS = frozenset(filters.RS_SCREENS_KEYS)


def _main_stub(history):
    """A stand-in for `api.main`: the flag reader, plus the `app.dependency_overrides`
    the suite's autouse conftest fixture restores on teardown."""
    stub = types.ModuleType("api.main")
    stub.rs_history_enabled = lambda: history
    stub.app = types.SimpleNamespace(dependency_overrides={})
    return stub


def _flags(monkeypatch, *, v2, history, v3=False):
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", v2)
    # `raising=False`: RS_V3_ENABLED is declared by unit 3-05; until then
    # `snapshot_builder.rs_v3_enabled()` reads the attribute when present.
    monkeypatch.setattr(registry_defs, "RS_V3_ENABLED", v3, raising=False)
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
    assert len(rs) == 9      # 7 -> 9 on 2026-11-13: the two RS Exit Warning starters
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
    assert len(rs) == 9      # 7 -> 9 on 2026-11-13: the two RS Exit Warning starters
    assert {s["group"] for s in rs} == {ss.RS_STARTER_GROUP}


# ── #14: meta() leaves out what a dark writer leaves NULL ──────────────────

def _meta(monkeypatch, *, v2, history, v3=False):
    _flags(monkeypatch, v2=v2, history=history, v3=v3)
    return filters.meta()


def _served(m):
    keys = {f["key"] for f in m["filters"]}
    views = {v["key"]: v["columns"] for v in m["views"]}
    cats = {c["key"] for c in m["categories"]}
    comparable = {c["key"] for c in m["comparable_fields"]}
    return keys, views, cats, comparable


def test_the_two_families_are_the_writers_and_the_category_split_matches():
    assert len(BARS) == 15 and len(RATINGS) == 8 and len(PHASE3) == 3
    assert not (BARS & RATINGS) and not (PHASE3 & (BARS | RATINGS))
    family = {k for k, f in filters.FILTERS.items() if f["category"] == "relative_strength"}
    # Pins moved 2026-11-14 (RS screens U1): a fourth family joined the category. It is switched
    # on here (`screens_on=True`) so each line still reads one of the first three flags alone.
    assert len(SCREENS) >= 9 and not (SCREENS & (BARS | RATINGS | PHASE3))
    assert family == BARS | RATINGS | PHASE3 | SCREENS
    on = {"screens_on": True}
    assert filters.rs_dark_keys(v2_on=False, history_on=True, v3_on=True, **on) == BARS | PHASE3
    assert filters.rs_dark_keys(v2_on=True, history_on=False, v3_on=True, **on) == RATINGS
    assert filters.rs_dark_keys(v2_on=True, history_on=True, v3_on=True, **on) == frozenset()
    # Phase 3 needs BOTH flags: its writer runs inside the RS_V2 step
    assert filters.rs_dark_keys(v2_on=True, history_on=True, v3_on=False, **on) == PHASE3
    # ... and with its own flag off, the fourth family is the only thing dark
    assert filters.rs_dark_keys(v2_on=True, history_on=True, v3_on=True, screens_on=False) == SCREENS


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
    assert BARS - filters.picker_hidden_keys() <= set(views["relative_strength"])  # S1: agree is picker-hidden
    assert not (comparable & RATINGS)


def test_v2_off_history_on_shows_only_the_rating_family(monkeypatch):
    keys, views, cats, _comparable = _served(_meta(monkeypatch, v2=False, history=True))
    assert not (keys & BARS) and RATINGS <= keys
    assert "relative_strength" not in views
    assert "rs_rating_ibd" in views["momentum"]
    assert not (set(views["momentum"]) & BARS)
    assert "relative_strength" in cats


def test_both_flags_on_serves_the_whole_family_exactly_as_registered(monkeypatch):
    m = _meta(monkeypatch, v2=True, history=True, v3=True)
    keys, views, cats, _comparable = _served(m)
    assert (BARS | RATINGS | PHASE3) <= keys
    # S1: the RS view drops only the picker-hidden keys; every other view is as registered.
    hid = filters.picker_hidden_keys()
    # Pin moved 2026-11-14 (RS screens U1): the dark fourth family has no seat in any view.
    assert views == {k: [c for c in v["columns"]
                         if c not in SCREENS and not (k == "relative_strength" and c in hid)]
                     for k, v in filters.VIEWS.items()}
    assert not (keys & SCREENS), "RS_SCREENS_ENABLED is off: none of its controls is served"
    assert "relative_strength" in cats
    ibd = next(f for f in m["filters"] if f["key"] == "rs_rating_ibd")
    assert [p["label"] for p in ibd["presets"]] == ["Any", "Over 80", "Over 90"]


def test_v3_off_hides_the_phase3_family_and_its_seats(monkeypatch):
    """Unit 3-11: with RS_V3 dark the three Phase 3 columns are NULL on every
    row, so they leave the payload exactly as a dark V2 family does."""
    keys, views, _cats, comparable = _served(_meta(monkeypatch, v2=True, history=True, v3=False))
    assert not (keys & PHASE3), sorted(keys & PHASE3)
    assert not (set(views["relative_strength"]) & PHASE3), views["relative_strength"]
    assert not (comparable & PHASE3)
    assert (BARS | RATINGS) <= keys
    # V3 armed without V2: the step that writes them does not run
    keys, _views, _cats, _comparable = _served(_meta(monkeypatch, v2=False, history=True, v3=True))
    assert not (keys & PHASE3)
    # both armed: served, with their view seats
    keys, views, _cats, comparable = _served(_meta(monkeypatch, v2=True, history=False, v3=True))
    assert PHASE3 <= keys
    assert PHASE3 <= set(views["relative_strength"])
    assert "clenow_score" in comparable


def test_the_registry_itself_is_not_changed_by_a_dark_meta(monkeypatch):
    """A stored spec on an RS key still validates and runs; only the panel hides it."""
    _meta(monkeypatch, v2=False, history=False)
    assert (BARS | RATINGS | PHASE3) <= set(filters.FILTERS)
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
    # 6M, 9M and 12M ARE recency-weighted blends (2026-11-11), and say so in the rating's own words
    for col in ("rs_rating_6m", "rs_rating_9m", "rs_rating_12m"):
        assert "recency-weighted" in _desc(col), col
        assert "63-session close ratio counts double" in _desc(col), col
    assert "recency-weighted" not in d and "counts double" not in d, "1M stays a plain return"
    # 3M is the equal-weighted average of the 1-, 2- and 3-month returns (2026-11-12): said in words, and not
    # dressed as the recency-weighted blend or as the plain 63-session return it used to be
    d3 = _desc("rs_rating_3m")
    assert "equal-weighted average of the 1-, 2- and 3-month returns" in d3
    assert "21-, 42- and 63-session" in d3
    assert "recency-weighted" not in d3 and "counts double" not in d3 and "plain 63-session" not in d3


def test_no_unmeasured_frequency_claims_on_the_rs_highs():
    from api.services.screener import methodology as M
    before = M.for_column("rs_nh_before_price")["caveat"]
    red = M.for_column("rs_nh_red_day")["caveat"]
    assert "often do this" not in before and "no published study" in before
    assert "more often than" not in red and "not been measured publicly" in red
    d = _desc("rs_nh_before_price")
    assert "leaders often print" not in d and "no published study" in d
