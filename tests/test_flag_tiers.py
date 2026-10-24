"""The bull_flag "flagging" tier (lab flag_vocab, 2026-10-18).

The team says "flag", "flagging", "flag out" for any stock pausing after a move. On the team's broad
flag vocabulary, held out by date, drawing the flags that fail ONLY display.FLAGGING_RELAXED lifted
Youden's J by +0.135 [+0.108, +0.161]; their geometry measured at chance against the team's lines.
So they draw as a second, lighter tier, stamped on its own key (extras.flagging), with no entry line.
Flagging tier withheld from members 2026-10-24: blind textbook score 1.28 (24% of cases >= 2)
(auto_structures.MEMBER_FLAGGING_ROUND = None); admins and the team keep both tiers. Re-enabling it for
members is that one literal (set it back to 9). What this file holds:

  1. the relaxed reasons are DERIVED from the three verdicts' own source, never restated;
  2. tier 1 is unchanged byte-for-byte: 1,200 seeded synthetic scans hash identically to the golden
     written from the pre-tier code (tests/fixtures/flag_tiers_golden.json), the stamp removed;
  3. a member gets NO tier-2 row while the tier is withheld; re-enabled (in memory), only an exactly
     stamped row, and every near miss is dropped;
  4. admins see both tiers, members the confirmed one; a flagging flag never sits over a confirmed flag's bars;
  5. a crash in the relaxed run leaves the strict result alone and stamps nothing.
Synthetic bars only (public repo).
"""
from __future__ import annotations

import ast
import json
import os

import api.routers.patterns as patterns_router  # registers every detector
from api.services import auto_structures
from api.services.pattern_engine import detect_all, display
from api.services.pattern_engine.detectors import registry
from api.services.pattern_engine.primitives.context import build_context
from tests import flag_tiers_sweep as sweep
from tests.authclients import ADMIN, PAID_MEMBER
from tests.test_bull_flag_r7 import _drawn, _ohlc
from tests.test_bull_flag_r9 import SHORT_LEG, TALL_LEG, _flag_after
from tests.test_member_drawing_set import _flag, _flags, _get, _store
from tests.test_team_drawing_set_r4 import _flag_det

HERE = os.path.dirname(os.path.abspath(__file__))
GOLDEN = os.path.join(HERE, "fixtures", "flag_tiers_golden.json")
POLICY = registry.display_policy("bull_flag")


def _row(rid, **extras):
    return {**_flag(rid, **extras), **POLICY}


def _tier2_extras():
    ex, _ = _drawn(*_flag_after(SHORT_LEG))
    return ex


# -- 1. the relaxed reasons are derived ------------------------------------------------------------

def _reasons_in_source(fn_names):
    tree = ast.parse(open(display.__file__, encoding="utf-8").read())
    found = {}
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in fn_names:
            got = set()
            for sub in ast.walk(node):
                if (isinstance(sub, ast.Return) and isinstance(sub.value, ast.Tuple)
                        and len(sub.value.elts) == 2
                        and isinstance(sub.value.elts[0], ast.Constant) and sub.value.elts[0].value is False
                        and isinstance(sub.value.elts[1], ast.Constant)):
                    got.add(sub.value.elts[1].value)
            found[node.name] = got
    return found


def test_the_relaxed_reasons_are_exactly_what_the_three_verdicts_can_return():
    found = _reasons_in_source(set(display.FLAGGING_RELAXED) | {"flag_edge_verdict"})
    assert set(found) >= set(display.FLAGGING_RELAXED), found        # every named verdict exists
    derived = set().union(*(found[n] for n in display.FLAGGING_RELAXED))
    assert derived == set(display.FLAGGING_REASONS)
    # control: the derivation can see a verdict that is NOT relaxed, and none of its reasons leak in
    assert found["flag_edge_verdict"] and not (found["flag_edge_verdict"] & display.FLAGGING_REASONS)


# -- 2. tier 1 byte-for-byte -----------------------------------------------------------------------

def test_tier_1_is_byte_for_byte_the_pre_tier_code_on_1200_synthetic_scans(monkeypatch):
    # geometry round 3 moves a drawn flag's UPPER lane only, after every verdict; with it switched off
    # every scan must still be byte-identical to the pre-tier golden (round 3 is pinned in
    # test_bull_flag_geom_v3.py)
    monkeypatch.setattr(display, "stamp_upper_lane_v3", lambda d, bars: None)
    golden = json.load(open(GOLDEN, encoding="utf-8"))
    assert (golden["series"], golden["cuts"]) == (sweep.SERIES, list(sweep.CUTS))
    digests, counts = sweep.run(detect_all, build_context, drop_flagging=True)
    assert counts["scans"] == golden["counts"]["scans"] == len(golden["digests"])
    assert counts["confirmed"] == golden["counts"]["confirmed"] > 0          # not vacuous
    assert counts["flagging"] > 0                     # the tier fired here, and still nothing moved
    assert golden["counts"]["flagging"] == 0          # the golden came from code with no tier
    moved = sorted(k for k in golden["digests"] if digests.get(k) != golden["digests"][k])
    assert moved == []


def test_the_digest_sees_a_one_field_change():
    """Control for the rail above: a single changed extras value changes the digest."""
    ex, _ = _drawn(*_flag_after(TALL_LEG))
    row = {"geometry": {"extras": dict(ex)}}
    a = sweep.digest(sweep.canonical([row]))
    row["geometry"]["extras"]["draw_round"] = 8
    assert sweep.digest(sweep.canonical([row])) != a


# -- 3. the stamp, and the member allow-list -------------------------------------------------------

def test_a_real_short_pole_flag_is_stamped_flagging_and_a_real_confirmed_one_is_not():
    t2 = _tier2_extras()
    assert t2["stale"] is True and t2["stale_reason"] == "short_pole" and "draw_round" not in t2
    # geometry round 3 is tier 1 only (amendment 1): the flagging stamp is exactly master's
    assert t2["flagging"] == {"tier": "flagging", "draw_round": display.BULL_FLAG_DRAW_ROUND,
                              "draw_lanes": True}
    t1, _ = _drawn(*_flag_after(TALL_LEG))
    assert t1["draw_round"] == display.BULL_FLAG_DRAW_ROUND and "flagging" not in t1


def test_a_stamped_flagging_row_is_withheld_from_a_member(monkeypatch):
    """Flagging tier withheld from members 2026-10-24: blind textbook score 1.28."""
    row = _row("t2", **_tier2_extras())
    assert auto_structures._flagging_flag(row)                             # it IS the tier
    assert auto_structures.member_rows([row]) == []                        # withheld
    for lit in (True, 8, 10, "9", 9.0):                                    # fail closed: only int 9 re-enables
        monkeypatch.setattr(auto_structures, "MEMBER_FLAGGING_ROUND", lit)
        assert auto_structures.member_rows([row]) == [], lit
    monkeypatch.setattr(auto_structures, "MEMBER_FLAGGING_ROUND", 9)      # control: the one-literal re-enable
    assert auto_structures.member_rows([row]) == [row]


def test_every_near_miss_of_the_flagging_stamp_is_dropped(monkeypatch):
    monkeypatch.setattr(auto_structures, "MEMBER_FLAGGING_ROUND", 9)      # re-enabled, so a miss is the stamp
    good = _tier2_extras()

    def variant(**patch):
        ex = json.loads(json.dumps(good))
        for k, v in patch.items():
            if k.startswith("f_"):
                if v is _DEL:
                    ex["flagging"].pop(k[2:])
                else:
                    ex["flagging"][k[2:]] = v
            elif v is _DEL:
                ex.pop(k)
            else:
                ex[k] = v
        return ex

    near = {
        "no stamp": variant(flagging=_DEL),
        "stamp not a dict": variant(flagging="flagging"),
        "tier missing": variant(f_tier=_DEL),
        "other tier": variant(f_tier="flag"),
        "round missing": variant(f_draw_round=_DEL),
        "round 8": variant(f_draw_round=8),
        "round 10": variant(f_draw_round=10),
        "round as str": variant(f_draw_round="9"),
        "round as float": variant(f_draw_round=9.0),
        "round as bool": variant(f_draw_round=True),
        "not stale": variant(stale=_DEL),
        "stale not True": variant(stale=1),
        "also confirmed": variant(draw_round=9),
        "overlapped": variant(stale_reason="overlapped"),
        "loose lanes": variant(stale_reason="loose_lanes"),
        "no reason": variant(stale_reason=_DEL),
    }
    for name, ex in near.items():
        assert auto_structures.member_rows([_row(name, **ex)]) == [], name
    assert auto_structures.member_rows([_row("ok", **variant())]) != []       # control


class _Del:
    pass


_DEL = _Del()


def test_the_member_flagging_round_is_a_literal_none_and_the_tier_round_a_literal_9():
    """Withheld 2026-10-24 by a literal None written in source (re-enable: set it to 9); the tier itself is
    still recognised by its own literal round 9."""
    tree = ast.parse(open(auto_structures.__file__, encoding="utf-8").read())
    for name, val in (("MEMBER_FLAGGING_ROUND", None), ("FLAGGING_TIER_ROUND", 9)):
        lits = [n for n in ast.walk(tree) if isinstance(n, ast.Assign)
                and any(getattr(t, "id", None) == name for t in n.targets)]
        assert len(lits) == 1 and isinstance(lits[0].value, ast.Constant), name
        got = lits[0].value.value
        assert (got is None) if val is None else (type(got) is int and got == val), name
    assert auto_structures.MEMBER_FLAGGING_ROUND is None
    assert auto_structures.FLAGGING_TIER_ROUND == 9
    assert auto_structures.MEMBER_FLAGGING_TIER == display.FLAGGING_TIER == "flagging"


# -- 4. admins see both; the route ------------------------------------------------------------------

def test_flag_on_members_get_the_confirmed_tier_only_and_admins_get_every_row(monkeypatch):
    t1, _ = _drawn(*_flag_after(TALL_LEG))
    t2 = _tier2_extras()
    unstamped = {k: v for k, v in t2.items() if k != "flagging"}
    rows = [_flag("t1", **t1), _flag("t2", **t2), _flag("u", **unstamped)]
    _flags(monkeypatch, True, True)
    _store(monkeypatch, rows)
    monkeypatch.setattr(auto_structures, "structures_for", lambda sym: [])
    monkeypatch.setattr(auto_structures, "drawn_for", lambda sym: None)
    member = _get(PAID_MEMBER).json()["detections"]
    assert [r["id"] for r in member] == ["t1"]                            # flagging tier withheld 2026-10-24
    assert "flagging" not in member[0]["geometry"]["extras"]
    admin = _get(ADMIN).json()["detections"]
    assert [r["id"] for r in admin] == ["t1", "t2", "u"]                   # admins: both tiers, unchanged
    monkeypatch.setattr(auto_structures, "MEMBER_FLAGGING_ROUND", 9)      # control: the one-literal re-enable
    member = _get(PAID_MEMBER).json()["detections"]
    assert [r["id"] for r in member] == ["t1", "t2"]
    assert member[1]["geometry"]["extras"]["flagging"]["tier"] == "flagging"
    assert [r["id"] for r in _get(ADMIN).json()["detections"]] == ["t1", "t2", "u"]


# -- 5. overlap: tier 2 never over tier 1, and one tier 2 per run ------------------------------------

def _pair(conf_fail, conf_pass, monkeypatch):
    """Two flags over the same bars; the one with confidence `conf_fail` fails flag_shape_verdict."""
    rows, top, up, dn = _flag_after(TALL_LEG)
    bars = _ohlc(rows)
    closes = [r[3] for r in rows]
    real = display.flag_shape_verdict

    def shape(b, p, d):
        return (False, "short_flag") if d.get("confidence") == conf_fail else real(b, p, d)

    monkeypatch.setattr(display, "flag_shape_verdict", shape)
    a = _flag_det(closes, 14, top, up, dn, conf=conf_fail)
    b = _flag_det(closes, 14, top, up, dn, conf=conf_pass)
    display.draw_geometry([a, b], bars)
    return a["geometry"]["extras"], b["geometry"]["extras"]


def test_a_flagging_flag_is_never_stamped_over_a_confirmed_flags_bars(monkeypatch):
    fail, ok = _pair(80, 60, monkeypatch)       # the MORE confident one is the relaxed failure
    assert ok["draw_round"] == display.BULL_FLAG_DRAW_ROUND
    assert fail["stale_reason"] == "short_flag" and "flagging" not in fail


def test_a_flagging_flag_alone_is_stamped(monkeypatch):
    rows, top, up, dn = _flag_after(TALL_LEG)
    bars = _ohlc(rows)
    real = display.flag_shape_verdict
    monkeypatch.setattr(display, "flag_shape_verdict", lambda b, p, d: (False, "short_flag"))
    a = _flag_det([r[3] for r in rows], 14, top, up, dn, conf=80)
    display.draw_geometry([a], bars)
    assert a["geometry"]["extras"]["flagging"]["tier"] == "flagging"           # control for above
    assert real is not display.flag_shape_verdict


def test_of_two_flagging_flags_over_the_same_bars_only_the_more_confident_is_stamped():
    rows, top, up, dn = _flag_after(SHORT_LEG)
    bars = _ohlc(rows)
    closes = [r[3] for r in rows]
    hi = _flag_det(closes, 14, top, up, dn, conf=80)
    lo = _flag_det(closes, 14, top, up, dn, conf=60)
    display.draw_geometry([lo, hi], bars)
    assert hi["geometry"]["extras"]["flagging"]["tier"] == "flagging"
    assert "flagging" not in lo["geometry"]["extras"]
    assert lo["geometry"]["extras"]["stale_reason"] == "short_pole"          # strict result intact


def test_the_relaxed_run_still_applies_every_other_verdict(monkeypatch):
    """Only the three FLAGGING_RELAXED verdicts are relaxed: a flag that fails one of them AND any
    later verdict (edge, drawn lanes, entry) is not flagging."""
    rows, top, up, dn = _flag_after(TALL_LEG)
    bars = _ohlc(rows)
    closes = [r[3] for r in rows]
    monkeypatch.setattr(display, "flag_shape_verdict", lambda b, p, d: (False, "short_flag"))
    for name, reason in (("flag_edge_verdict", "crash_pole"), ("flag_lanes_verdict", "loose_lanes"),
                         ("flag_entry_verdict", "entry_detached")):
        real = getattr(display, name)
        monkeypatch.setattr(display, name, lambda *a, _r=reason, **k: (False, _r))
        d = _flag_det(closes, 14, top, up, dn, conf=80)
        display.draw_geometry([d], bars)
        ex = d["geometry"]["extras"]
        assert ex["stale_reason"] == "short_flag" and "flagging" not in ex, name
        monkeypatch.setattr(display, name, real)
    d = _flag_det(closes, 14, top, up, dn, conf=80)          # control: all three back, it is flagging
    display.draw_geometry([d], bars)
    assert d["geometry"]["extras"]["flagging"]["tier"] == "flagging"


# -- 6. the relaxed run fails closed -----------------------------------------------------------------

def test_a_crash_in_the_relaxed_run_stamps_nothing_and_leaves_the_strict_result(monkeypatch):
    strict = {k: v for k, v in _tier2_extras().items() if k != "flagging"}

    def boom(*a, **k):
        raise RuntimeError("relaxed only")

    # a short-pole flag stops before flag_entry_line in the strict run; only the relaxed run calls it
    monkeypatch.setattr(display, "flag_entry_line", boom)
    ex, _ = _drawn(*_flag_after(SHORT_LEG))
    assert ex == strict
