"""Auto Structures — display-only geometry for the chart (feat/auto-structures, 2026-10-16).

Rails for the server half:
  * every registered detector's anchors are REAL bar times (lab/geometry_eval REPORT.md fix 1:
    ten classical trendline detectors used to emit a bar INDEX inside the 200-bar scan window,
    which no chart can place once the window moves);
  * vcp / high_tight_flag / major_trendlines say what their anchors MEAN (fix 2);
  * pattern_end_t / pattern_age_bars — the structure's own last bar (fix 3), additive only;
  * the per-detector display policy is ONE registry constant (fix 4-6), served per row;
  * base boxes ride GET /api/patterns/{sym} only for an ADMIN while AUTO_STRUCTURES_ENABLED is on;
  * the auth payload carries auto_structures_enabled only for an admin while on.
Synthetic bars only (public repo).
"""
from __future__ import annotations

import glob
import json
import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.patterns as patterns_router  # registers every detector
from api.services import auto_structures
from api.services.pattern_engine import detect_all, display
from api.services.pattern_engine.detectors import registry
from api.services.pattern_engine.detectors.registry import (
    get_detector, list_pattern_ids, display_policy,
)
from api.services.pattern_engine.primitives.context import build_context
from api.services.pattern_engine.primitives.geometry import bar_time
from tests.authclients import ADMIN, FREE_MEMBER, PAID_MEMBER, authorize
from tests.detector_fixtures import walk, ymd_t

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

#: The ten detectors that emitted a bar index before the fix (measured 2026-10-16).
INDEX_EMITTERS = (
    "ascending_triangle", "bear_flag", "bull_flag", "channel", "descending_triangle",
    "falling_wedge", "pennant", "rectangle", "rising_wedge", "symmetrical_triangle",
)


def _redated(bars):
    """Re-date a fixture to YYYYMMDD ints. 0..N indices and 2023xxxx dates can never collide,
    so an index anchor that leaked through would be caught, not coincidentally "valid"."""
    return [dict(b, t=ymd_t(i)) for i, b in enumerate(bars)]


def _fixture_frames(pattern_id):
    out = []
    for f in sorted(glob.glob(os.path.join(REPO, "tests", "fixtures", pattern_id, "*.json"))):
        try:
            data = json.load(open(f, encoding="utf-8"))
        except Exception:
            continue
        bars = data.get("bars") if isinstance(data, dict) else None
        if isinstance(bars, list) and bars and isinstance(bars[0], dict) and "h" in bars[0]:
            out.append(_redated(bars))
    return out


def _all_anchor_ts(geometry):
    ts = [a["t"] for a in geometry.get("anchors") or []]
    for sec in geometry.get("secondary") or []:
        ts.extend(a["t"] for a in sec.get("anchors") or [])
    return ts


# ── fix 1: anchors are real times ───────────────────────────────────────────

def test_bar_time_maps_an_index_and_clamps_instead_of_raising():
    bars = [{"t": ymd_t(i)} for i in range(5)]
    assert bar_time(bars, 2) == ymd_t(2)
    assert bar_time(bars, 2.4) == ymd_t(2)
    assert bar_time(bars, -3) == ymd_t(0)       # never raises inside a detector
    assert bar_time(bars, 99) == ymd_t(4)


def test_every_registered_detector_emits_real_bar_times_on_synthetic_frames():
    """Each detector on its OWN fixtures plus random walks: every anchor (primary and
    secondary) must be one of the frame's bar times. Non-vacuity: the ten former index
    emitters must each fire, and most of the registry must fire somewhere."""
    fired = set()
    bad = []
    walks = [walk(s, bars=200) for s in range(4)]
    for pid in list_pattern_ids():
        fn = get_detector(pid)
        for bars in _fixture_frames(pid) + walks:
            ts = {b["t"] for b in bars}
            try:
                ctx = build_context(bars, sym="TEST")
                dets = fn(bars, ctx)
            except Exception:
                continue
            for d in dets:
                fired.add(pid)
                for t in _all_anchor_ts(d.get("geometry") or {}):
                    if t not in ts:
                        bad.append((pid, t))
    assert not bad, f"anchors that are not bar times (index leak?): {bad[:10]}"
    missing = [p for p in INDEX_EMITTERS if p not in fired]
    assert not missing, f"control: these never fired, so their anchors were never checked: {missing}"
    assert len(fired) >= 80, f"only {len(fired)} detectors fired — the sweep proves too little"


def test_log_space_lines_say_so_for_the_renderer():
    """The renderer draws a log line as its curve only if the detection says it is log."""
    for pid in INDEX_EMITTERS:
        for bars in _fixture_frames(pid):
            for d in get_detector(pid)(bars, build_context(bars, sym="TEST")):
                spaces = d["geometry"]["extras"].get("line_spaces")
                assert isinstance(spaces, list) and len(spaces) == 2
                assert set(spaces) <= {"price", "log"}
                idx = d["geometry"]["extras"]["anchor_bar_index"]
                assert [bars[i]["t"] for i in idx] == [a["t"] for a in d["geometry"]["anchors"]]
                break


# ── fix 2: subtypes ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("pid,subtype", [
    ("vcp", "contraction_zigzag"),
    ("high_tight_flag", "pole_and_flag"),
    ("major_trendlines", "single_trendline"),
])
def test_point_families_declare_what_their_anchors_mean(pid, subtype):
    seen = 0
    for bars in _fixture_frames(pid):
        for d in get_detector(pid)(bars, build_context(bars, sym="TEST")):
            g = d["geometry"]
            assert g["semantic_subtype"] == subtype
            assert len(g["anchor_roles"]) == len(g["anchors"])
            seen += 1
    assert seen, f"control: {pid} never fired on its fixtures"


# ── fix 3: pattern end ──────────────────────────────────────────────────────

def test_pattern_end_is_the_newest_anchor_on_a_bar_and_its_age_in_bars():
    bars = [{"t": ymd_t(i)} for i in range(10)]
    d = {"geometry": {"anchors": [{"t": ymd_t(2)}, {"t": ymd_t(6)}],
                      "secondary": [{"anchors": [{"t": ymd_t(7)}]}], "extras": {}}}
    display.annotate([d], bars)
    assert d["geometry"]["extras"]["pattern_end_t"] == ymd_t(7)
    assert d["geometry"]["extras"]["pattern_age_bars"] == 2


def test_pattern_end_ignores_values_that_are_not_bar_times_and_never_raises():
    bars = [{"t": ymd_t(i)} for i in range(5)]
    d = {"geometry": {"anchors": [{"t": 3}, {"t": "x"}], "extras": {}}}
    display.annotate([d, None, {"geometry": None}], bars)
    assert "pattern_end_t" not in d["geometry"]["extras"]


def test_detect_all_stamps_pattern_end_without_touching_end_t():
    bars = walk(3, bars=200)
    dets = detect_all(bars, build_context(bars, sym="TEST"))
    stamped = [d for d in dets if "pattern_end_t" in (d.get("geometry") or {}).get("extras", {})]
    assert stamped, "control: nothing was stamped"
    last_t = bars[-1]["t"]
    for d in stamped:
        ex = d["geometry"]["extras"]
        assert ex["pattern_end_t"] <= last_t
        assert 0 <= ex["pattern_age_bars"] < len(bars)


# ── fix 4-6: one display policy ─────────────────────────────────────────────

def test_display_policy_matches_the_tiers_v2_report():
    """lab/geometry_eval REPORT_TIERS_V2.md (2026-10-17), blind tier round v2."""
    assert registry.DISPLAY_TRUSTED == {"donchian_breakout", "rectangle"}
    for pid in ("donchian_breakout", "rectangle"):
        assert display_policy(pid)["display_tier"] == "trusted"
    # second blind judge 1.8 -> averaged ~2.05, under the 2.3 trusted bar
    assert display_policy("bc:cup-with-handle")["display_tier"] == "experimental"
    # round-1 trusted that failed AS DRAWN in v2 -> experimental
    for pid in ("bull_flag", "pullback_to_10ema", "holy_grail"):
        assert display_policy(pid)["display_tier"] == "experimental"
    v2_hidden = ("double_bottom", "double_top", "head_shoulders", "flat_base", "vcp",
                 "higher_low_continuation", "inverse_cup_handle", "qullamaggie_setup",
                 "range_detection", "bc:vcp", "bc:base-on-base")
    round1_hidden = ("inverse_head_shoulders", "triple_top", "triple_bottom", "u_and_r",
                     "symmetrical_triangle", "descending_triangle", "bear_flag",
                     "bc:ugly-double-bottom", "bc:green-line-breakout", "bc:darvas-box")
    assert registry.DISPLAY_HIDDEN == set(v2_hidden) | set(round1_hidden)
    for pid in v2_hidden + round1_hidden:
        assert display_policy(pid)["display_tier"] == "hidden"
    # rated but never rendered (no verdicts) -> stay experimental
    for pid in ("rsi_bearish_divergence", "rsi_bullish_divergence"):
        assert display_policy(pid)["display_tier"] == "experimental"
    for pid in ("support_resistance", "volume_profile_nodes"):
        assert display_policy(pid)["display_layer"] == "levels"
    assert display_policy("opening_range_breakout")["intraday_only"] is True
    assert registry.DISPLAY_DRAW_ENTRY == {"bull_flag"}
    assert display_policy("bull_flag")["draw_entry"] is True
    assert display_policy("double_bottom")["draw_entry"] is False
    assert display_policy("rising_wedge") == {
        "display_tier": "experimental", "display_layer": "structures",
        "intraday_only": False, "draw_entry": False,
    }


def test_display_policy_names_only_registered_detectors():
    """A typo in the one constant would silently leave a detector at the default tier."""
    known = set(list_pattern_ids())
    named = (registry.DISPLAY_TRUSTED | registry.DISPLAY_HIDDEN | registry.DISPLAY_LEVELS_LAYER
             | registry.DISPLAY_INTRADAY_ONLY | registry.DISPLAY_DRAW_ENTRY)
    unknown = sorted(p for p in named if not p.startswith("bc:") and p not in known)
    assert not unknown, unknown


# ── the route ───────────────────────────────────────────────────────────────

def _client(user, monkeypatch, rows=None):
    app = FastAPI()
    app.include_router(patterns_router.router)
    authorize(app, user)
    monkeypatch.setattr(patterns_router.memory, "get_active_detections",
                        lambda *a, **k: [dict(r) for r in (rows or [])])
    return TestClient(app)


BOX = {"structure_key": "flat-base", "name": "Flat base", "label": "Flat base · 23 bars · pivot 142.10",
       "start_t": 20260901, "end_t": 20261015, "top": 142.1, "floor": 131.4, "pivot": 142.1,
       "bars": 23, "sub_boxes": [], "source": "flat_base_state"}


def test_rows_carry_the_display_policy(monkeypatch):
    c = _client(PAID_MEMBER, monkeypatch, rows=[{"id": "x", "pattern_id": "bear_flag"},
                                                {"id": "y", "pattern_id": "bull_flag"}])
    rows = c.get("/api/patterns/ZZZ?tf=D&confirmed_only=false").json()["detections"]
    assert [r["display_tier"] for r in rows] == ["hidden", "experimental"]


def test_structures_ride_the_route_only_for_an_admin_with_the_flag(monkeypatch):
    monkeypatch.setattr(auto_structures, "structures_for",
                        lambda sym: [auto_structures.box_to_detection(sym, BOX)])
    url = "/api/patterns/ZZZ?tf=D&confirmed_only=false&include_structures=true"

    monkeypatch.setenv("AUTO_STRUCTURES_ENABLED", "1")
    body = _client(ADMIN, monkeypatch).get(url).json()
    assert body["structures"][0]["geometry"]["shape"] == "base_box"
    assert body["structures"][0]["geometry"]["extras"]["label"] == BOX["label"]

    assert "structures" not in _client(PAID_MEMBER, monkeypatch).get(url).json()

    monkeypatch.setenv("AUTO_STRUCTURES_ENABLED", "0")
    assert "structures" not in _client(ADMIN, monkeypatch).get(url).json()


def test_box_to_detection_keeps_every_number_and_uses_real_times():
    d = auto_structures.box_to_detection("ZZZ", BOX)
    assert d["pattern_id"] == "bc:flat-base"
    assert d["geometry"]["anchors"] == [{"t": 20260901, "price": 142.1}, {"t": 20261015, "price": 131.4}]
    ex = d["geometry"]["extras"]
    assert (ex["top"], ex["floor"], ex["pivot"]) == (142.1, 131.4, 142.1)
    assert d["levels"]["entry"] == 142.1
    assert d["display_tier"] == "experimental"
    assert auto_structures.box_to_detection("ZZZ", {**BOX, "structure_key": "darvas-box"})["display_tier"] == "hidden"
    assert auto_structures.box_to_detection(
        "ZZZ", {**BOX, "structure_key": "cup-with-handle"})["display_tier"] == "experimental"


def test_structures_for_reads_daily_bars_and_never_raises(monkeypatch):
    from api.services import bars_sqlite
    auto_structures._CACHE.clear()
    rows = [(b["t"], b["o"], b["h"], b["l"], b["c"], b["v"]) for b in walk(1, bars=200)]
    monkeypatch.setattr(bars_sqlite, "get_bars", lambda sym, tf, n: rows)
    out = auto_structures.structures_for("SYNA")
    assert out, "a 200-bar walk yields at least the 10-day range fallback"
    for d in out:
        assert d["geometry"]["shape"] == "base_box"
        assert d["start_t"] in {r[0] for r in rows} and d["end_t"] in {r[0] for r in rows}

    def boom(*a, **k):
        raise RuntimeError("db down")
    auto_structures._CACHE.clear()
    monkeypatch.setattr(bars_sqlite, "get_bars", boom)
    assert auto_structures.structures_for("SYNB") == []


# ── the flag on the auth payload ────────────────────────────────────────────

def test_auth_payload_carries_the_flag_only_for_an_admin_while_on(monkeypatch):
    from api.routers import auth
    monkeypatch.setenv("AUTO_STRUCTURES_ENABLED", "1")
    assert auth._auto_structures_flag(True) == {"auto_structures_enabled": True}
    assert auth._auto_structures_flag(False) == {}
    monkeypatch.setenv("AUTO_STRUCTURES_ENABLED", "0")
    assert auth._auto_structures_flag(True) == {}
    monkeypatch.delenv("AUTO_STRUCTURES_ENABLED")
    assert auth._auto_structures_flag(True) == {}


# ── the MEMBER flip (AUTO_STRUCTURES_MEMBERS_ENABLED, trusted tier only) ─────

#: One row per display bucket: trusted (x2), experimental, hidden, the levels layer.
MIXED_ROWS = [
    {"id": "a", "pattern_id": "donchian_breakout"},
    {"id": "b", "pattern_id": "rectangle"},
    {"id": "c", "pattern_id": "bull_flag"},
    {"id": "d", "pattern_id": "double_bottom"},
    {"id": "e", "pattern_id": "support_resistance"},
]
STRUCT_URL = "/api/patterns/ZZZ?tf=D&confirmed_only=false&include_structures=true"


@pytest.fixture
def _box_and_drawn(monkeypatch):
    monkeypatch.setattr(auto_structures, "structures_for",
                        lambda sym: [auto_structures.box_to_detection(sym, BOX)])
    monkeypatch.setattr(auto_structures, "drawn_for",
                        lambda sym: {"trendlines": [], "horizontals": [], "suppress": {}})


def _flags(monkeypatch, admin, members):
    for name, on in (("AUTO_STRUCTURES_ENABLED", admin), ("AUTO_STRUCTURES_MEMBERS_ENABLED", members)):
        if on is None:
            monkeypatch.delenv(name, raising=False)
        else:
            monkeypatch.setenv(name, "1" if on else "0")


def test_members_enabled_needs_both_flags(monkeypatch):
    for admin, members, want in ((None, None, False), (True, None, False), (True, False, False),
                                 (False, True, False), (None, True, False), (True, True, True)):
        _flags(monkeypatch, admin, members)
        assert auto_structures.members_enabled() is want, (admin, members)


def test_member_flag_off_is_byte_identical_to_before(monkeypatch, _box_and_drawn):
    """Member flag OFF (admin flag on or off): the member's include_structures response is the
    old raw payload — every row, no structures/drawn — exactly what it was before this flag."""
    for admin in (True, False, None):
        _flags(monkeypatch, admin, False)
        body = _client(PAID_MEMBER, monkeypatch, rows=MIXED_ROWS).get(STRUCT_URL).json()
        assert [r["id"] for r in body["detections"]] == ["a", "b", "c", "d", "e"]
        assert "structures" not in body and "drawn" not in body
        assert set(body) == {"sym", "tf", "detections", "count"}


def test_member_flag_on_serves_only_trusted_rows_and_no_structures(monkeypatch, _box_and_drawn):
    _flags(monkeypatch, True, True)
    body = _client(PAID_MEMBER, monkeypatch, rows=MIXED_ROWS).get(STRUCT_URL).json()
    assert [r["pattern_id"] for r in body["detections"]] == ["donchian_breakout", "rectangle"]
    assert {r["display_tier"] for r in body["detections"]} == {"trusted"}
    assert body["count"] == 2
    assert "structures" not in body and "drawn" not in body
    # The member flag is not a door by itself: admin flag off closes it.
    _flags(monkeypatch, False, True)
    body = _client(PAID_MEMBER, monkeypatch, rows=MIXED_ROWS).get(STRUCT_URL).json()
    assert len(body["detections"]) == 5 and "structures" not in body


def test_member_filter_follows_the_registry_constant(monkeypatch, _box_and_drawn):
    """Derived, not restated: moving DISPLAY_TRUSTED moves what a member gets."""
    _flags(monkeypatch, True, True)
    monkeypatch.setattr(registry, "DISPLAY_TRUSTED", frozenset({"bull_flag"}))
    body = _client(PAID_MEMBER, monkeypatch, rows=MIXED_ROWS).get(STRUCT_URL).json()
    assert [r["pattern_id"] for r in body["detections"]] == ["bull_flag"]


def test_admin_is_unchanged_by_the_member_flag(monkeypatch, _box_and_drawn):
    bodies = []
    for members in (False, True):
        _flags(monkeypatch, True, members)
        bodies.append(_client(ADMIN, monkeypatch, rows=MIXED_ROWS).get(STRUCT_URL).json())
    assert bodies[0] == bodies[1]
    assert [r["id"] for r in bodies[1]["detections"]] == ["a", "b", "c", "d", "e"]
    assert bodies[1]["structures"][0]["geometry"]["shape"] == "base_box"
    assert "drawn" in bodies[1]


def test_member_without_include_structures_and_confirmed_only_are_unchanged(monkeypatch, _box_and_drawn):
    from api.services.pattern_vision import store as pv_store
    _flags(monkeypatch, True, True)
    c = _client(PAID_MEMBER, monkeypatch, rows=MIXED_ROWS)
    raw = c.get("/api/patterns/ZZZ?tf=D&confirmed_only=false").json()
    assert len(raw["detections"]) == 5
    monkeypatch.setattr(pv_store, "init_db", lambda: None)
    monkeypatch.setattr(pv_store, "get_confirmed", lambda sym, tf: [])
    monkeypatch.setattr(pv_store, "count_evaluated", lambda sym, tf: 0)
    monkeypatch.setattr(pv_store, "last_judged_at", lambda sym, tf: None)
    for url in ("/api/patterns/ZZZ?tf=D", "/api/patterns/ZZZ?tf=D&include_structures=true"):
        body = c.get(url).json()
        assert set(body) == {"sym", "tf", "verdicts", "count", "evaluated", "as_of"}, url


def test_free_and_unauthenticated_still_refused(monkeypatch, _box_and_drawn):
    _flags(monkeypatch, True, True)
    assert _client(FREE_MEMBER, monkeypatch, rows=MIXED_ROWS).get(STRUCT_URL).status_code in (401, 402, 403)
    app = FastAPI()
    app.include_router(patterns_router.router)
    assert TestClient(app).get(STRUCT_URL).status_code in (401, 403)


def test_auth_payload_member_key(monkeypatch):
    from api.routers import auth
    _flags(monkeypatch, True, True)
    assert auth._auto_structures_flag(False, True) == {"auto_structures_members_enabled": True}
    assert auth._auto_structures_flag(False, False) == {}  # free: nothing
    assert auth._auto_structures_flag(False) == {}
    assert auth._auto_structures_flag(True, True) == {"auto_structures_enabled": True}  # admin unchanged
    _flags(monkeypatch, True, False)
    assert auth._auto_structures_flag(False, True) == {}
    assert auth._auto_structures_flag(True, True) == {"auto_structures_enabled": True}
    _flags(monkeypatch, False, True)
    assert auth._auto_structures_flag(False, True) == {}
    assert auth._auto_structures_flag(True, True) == {}
