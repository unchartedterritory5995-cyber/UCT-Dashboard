"""GATE-S7-PRICE-LEVEL Checkpoint 2 — the dark evaluator and the forward-only
comparison harness, driven against SYNTHETIC harness-armed predicates.

⛔ Nothing here reads or writes a real member `watchlist_alerts` row. That is
CP3 and needs its own approval line; `test_the_harness_never_touches_watchlist_alerts`
is the rail on it.
"""
from __future__ import annotations

import ast
import pathlib

import pytest

from api.services.alert_taxonomy import db as _db
from api.services.alert_taxonomy import predicates as _predicates
from api.services.alert_taxonomy import price_level as _pl
from api.services.alert_taxonomy import price_level_compare as _cmp
from api.services.alert_taxonomy import receipts as _receipts

_REPO = pathlib.Path(__file__).resolve().parents[1]
_USER = "harness-user"
_SYM = "AAPL"
DAY = 86_400.0
T0 = 1_757_000_000.0


@pytest.fixture()
def dbp(tmp_path):
    """A throwaway alert-taxonomy DB. ⛔ Never /data — `C:\\data` on this box is
    the owner's live files."""
    p = str(tmp_path / "alert_taxonomy.db")
    _db.init_db(db_path=p)
    _pl.register(db_path=p)
    return p


def _arm(dbp, *, level_kind="price", target_price=100.0, direction="above",
         anchors=None, sym=_SYM):
    """⚠️ `sym` is a parameter because predicates.py's Stage-3 duplicate guard
    allows at most one ACTIVE predicate per (user_id, type_id, entity_scope.id)
    and IDEMPOTENTLY RETURNS THE EXISTING ID rather than raising. Two calls with
    the same symbol therefore hand back ONE predicate, and a test that armed
    "two" would silently be testing one."""
    params = {"level_kind": level_kind, "direction": direction, "target_price": target_price}
    if anchors:
        params.update(anchors)
    pid = _predicates.register_predicate(
        _pl.TYPE_ID, {"kind": "security", "id": "sec:" + sym, "symbol": sym},
        params, _USER, db_path=dbp)
    twin = dict(params)
    twin["symbol"] = sym
    return pid, twin


# ─── the level function, against the LEGACY authority ────────────────────────

def test_level_at_matches_the_legacy_level_function():
    """⭐ THE ABSORPTION'S CORE CLAIM. If the new level function and
    `watchlist_alert_service._alert_level_now` disagree, every downstream
    comparison measures that disagreement rather than the migration.

    The legacy function is imported HERE and not in product code: it pulls in
    `email_service`, and a module contracted to be unable to reach a member must
    not import the module that delivers to one.
    """
    from api.services.watchlist_alert_service import _alert_level_now as legacy

    cases = [
        {"level_kind": "price", "target_price": 100.0},
        {"level_kind": "trendline", "target_price": 99.0,
         "anchor_t1": T0, "anchor_p1": 10.0, "anchor_t2": T0 + DAY, "anchor_p2": 20.0},
        # degenerate geometry — legacy guards `t2 != t1` and falls back
        {"level_kind": "trendline", "target_price": 55.5,
         "anchor_t1": T0, "anchor_p1": 10.0, "anchor_t2": T0, "anchor_p2": 20.0},
        # incomplete geometry — legacy falls back too
        {"level_kind": "trendline", "target_price": 42.0,
         "anchor_t1": T0, "anchor_p1": 10.0, "anchor_t2": None, "anchor_p2": None},
    ]
    checked = 0
    for params in cases:
        legacy_row = {
            "alert_type": params["level_kind"],
            "target_price": params["target_price"],
            "anchor_t1": params.get("anchor_t1"), "anchor_p1": params.get("anchor_p1"),
            "anchor_t2": params.get("anchor_t2"), "anchor_p2": params.get("anchor_p2"),
        }
        for offset in (-DAY, 0.0, DAY / 2, DAY, 3 * DAY):  # includes EXTRAPOLATION
            now = T0 + offset
            assert _pl.level_at(params, now) == pytest.approx(legacy_row and legacy(legacy_row, now)), (
                f"level_at diverged from the legacy authority at {params!r} t+{offset}")
            checked += 1
    # NON-VACUITY: a silently-empty case list would pass this file trivially.
    assert checked == 20, f"expected 20 comparisons, made {checked}"


def test_the_extrapolated_leg_is_actually_exercised():
    """CONTROL for the test above. Extrapolation past t2 is F-S7-2's stated
    'no natural expiry' property; if every case sat between the anchors, the
    parity test would never touch the leg that matters."""
    params = {"level_kind": "trendline", "target_price": 0.0,
              "anchor_t1": T0, "anchor_p1": 10.0, "anchor_t2": T0 + DAY, "anchor_p2": 20.0}
    assert _pl.level_at(params, T0 + 3 * DAY) == pytest.approx(40.0), (
        "the line must continue past its second anchor at the same slope")


# ─── the dark evaluator ──────────────────────────────────────────────────────

def test_a_cross_fires_and_a_mere_level_does_not(dbp):
    """⛔ `price >= level` re-fires on every tick while price sits above the
    line; the fire's identity must be the CROSSING, not the sampling."""
    pid, _ = _arm(dbp, target_price=100.0, direction="above")
    assert _pl.evaluate({_SYM: 99.0}, now=T0, predicate_ids=[pid], db_path=dbp) == []
    fires = _pl.evaluate({_SYM: 101.0}, now=T0 + 1, predicate_ids=[pid], db_path=dbp)
    assert len(fires) == 1, "the upward cross must fire"
    assert _pl.evaluate({_SYM: 102.0}, now=T0 + 2, predicate_ids=[pid], db_path=dbp) == [], (
        "still above the line is not a new crossing")


def test_arming_beneath_an_already_true_condition_does_not_fire(dbp):
    """⛔ FORWARD-ONLY, in miniature. A predicate armed while price is already
    through its level must not fire on arming — reporting an already-true
    condition as a new event is the replay the ruling forbids."""
    pid, _ = _arm(dbp, target_price=100.0, direction="above")
    assert _pl.evaluate({_SYM: 150.0}, now=T0, predicate_ids=[pid], db_path=dbp) == [], (
        "the first observation after arming is never a cross")


def test_the_evaluator_writes_a_receipt_and_no_delivery(dbp):
    pid, _ = _arm(dbp, target_price=100.0)
    _pl.evaluate({_SYM: 99.0}, now=T0, predicate_ids=[pid], db_path=dbp)
    _pl.evaluate({_SYM: 101.0}, now=T0 + 1, predicate_ids=[pid], db_path=dbp)
    fires = _receipts.fires_for_predicate(pid, db_path=dbp)
    assert len(fires) == 1
    assert fires[0]["trigger_type"] == _pl.TYPE_ID
    assert fires[0].get("delivered_at") in (None, 0), (
        "a dark fire must carry no delivery stamp")


def test_the_sweep_is_scoped_to_harness_armed_predicates(dbp):
    """⛔ CP2 SCOPE. `predicate_ids` is what keeps the sweep off everything the
    harness did not arm."""
    mine, _ = _arm(dbp, target_price=100.0)
    other, _ = _arm(dbp, target_price=100.0, sym="MSFT")  # armed, deliberately out of scope
    assert other != mine, "the fixture must arm two DISTINCT predicates or this proves nothing"
    _pl.evaluate({_SYM: 99.0, "MSFT": 99.0}, now=T0, predicate_ids=[mine], db_path=dbp)
    _pl.evaluate({_SYM: 101.0, "MSFT": 101.0}, now=T0 + 1, predicate_ids=[mine], db_path=dbp)
    assert len(_receipts.fires_for_predicate(mine, db_path=dbp)) == 1
    assert _receipts.fires_for_predicate(other, db_path=dbp) == [], (
        "a predicate outside predicate_ids must never be evaluated")


# ─── the forward-only harness ────────────────────────────────────────────────

def test_agreement_when_both_sides_cross_together(dbp):
    pid, twin = _arm(dbp, target_price=100.0)
    _cmp.open_span(pid, twin, now=T0, db_path=dbp)
    assert _cmp.observe(pid, 99.0, now=T0, db_path=dbp) is None      # baseline tick
    assert _cmp.observe(pid, 101.0, now=T0 + 1, db_path=dbp) == _cmp.AGREED
    r = _cmp.report(pid, db_path=dbp)
    assert (r["agreed"], r["new_only"], r["legacy_only"]) == (1, 0, 0)


def test_NON_VACUITY_CONTROL_the_differ_can_report_both_disagreements(dbp):
    """⛔ THE CONTROL. A differ that has only ever printed "agreed" has not been
    shown able to print anything else. Arm the two sides at DELIBERATELY
    different levels and confirm both disagreement directions appear.
    """
    # legacy twin sits lower than the dark predicate -> legacy crosses first
    pid, twin = _arm(dbp, target_price=100.0)
    twin = dict(twin, target_price=90.0)
    _cmp.open_span(pid, twin, now=T0, db_path=dbp)
    _cmp.observe(pid, 89.0, now=T0, db_path=dbp)
    legacy_only = _cmp.observe(pid, 95.0, now=T0 + 1, db_path=dbp)   # past 90, not 100
    new_only = _cmp.observe(pid, 105.0, now=T0 + 2, db_path=dbp)     # past 100, legacy already through

    assert legacy_only == _cmp.LEGACY_ONLY, f"expected legacy_only, got {legacy_only}"
    assert new_only == _cmp.NEW_ONLY, f"expected new_only, got {new_only}"
    r = _cmp.report(pid, db_path=dbp)
    assert r["legacy_only"] == 1 and r["new_only"] == 1, r
    assert r["agreed"] == 0, "nothing here should have agreed"


def test_an_anchor_move_resets_the_clock_and_discards_to_NOT_COMPARABLE(dbp):
    """⛔ THE RULING'S CENTRE. What the two sides did against the OLD geometry
    cannot be attributed to the migration once the member moves the line.
    Those ticks go to not_comparable — never kept as agreement.
    """
    anchors = {"anchor_t1": T0, "anchor_p1": 100.0, "anchor_t2": T0 + DAY, "anchor_p2": 100.0}
    pid, twin = _arm(dbp, level_kind="trendline", target_price=100.0, anchors=anchors)
    _cmp.open_span(pid, twin, now=T0, db_path=dbp)
    _cmp.observe(pid, 99.0, now=T0, db_path=dbp)
    assert _cmp.observe(pid, 101.0, now=T0 + 1, db_path=dbp) == _cmp.AGREED
    before = _cmp.report(pid, db_path=dbp)
    assert before["agreed"] == 1 and before["not_comparable"] == 0

    moved = {"anchor_t1": T0, "anchor_p1": 200.0, "anchor_t2": T0 + DAY, "anchor_p2": 200.0}
    _pl.note_anchor_write(pid, moved, now=T0 + 2, db_path=dbp)
    out = _cmp.note_anchor_move(pid, dict(twin, **moved, target_price=200.0),
                                now=T0 + 2, db_path=dbp)

    assert out["discarded_to_not_comparable"] == 1
    assert out["new_anchor_version"] == 1
    after = _cmp.report(pid, db_path=dbp)
    assert after["agreed"] == 0, "the pre-move agreement must NOT survive the move"
    assert after["not_comparable"] == 1, "it must land in not_comparable"
    assert after["spans"] == 2, "a fresh span must have opened at the new geometry"


def test_the_first_tick_after_a_move_is_never_a_cross(dbp):
    """A reset clock means both baselines start empty, so the very next tick
    cannot be a crossing however far price is through the new line."""
    anchors = {"anchor_t1": T0, "anchor_p1": 100.0, "anchor_t2": T0 + DAY, "anchor_p2": 100.0}
    pid, twin = _arm(dbp, level_kind="trendline", target_price=100.0, anchors=anchors)
    _cmp.open_span(pid, twin, now=T0, db_path=dbp)
    _cmp.observe(pid, 99.0, now=T0, db_path=dbp)
    moved = {"anchor_t1": T0, "anchor_p1": 50.0, "anchor_t2": T0 + DAY, "anchor_p2": 50.0}
    _pl.note_anchor_write(pid, moved, now=T0 + 2, db_path=dbp)
    _cmp.note_anchor_move(pid, dict(twin, **moved, target_price=50.0), now=T0 + 2, db_path=dbp)
    # price is far through the new level, but there is no prior tick to cross FROM
    assert _cmp.observe(pid, 500.0, now=T0 + 3, db_path=dbp) is None


def test_anchor_writes_are_versioned_and_stamped_on_the_NEW_store(dbp):
    """F-S7-3's audit trail. The legacy row cannot say when its geometry took
    effect; the new store can, and `watchlist_alerts` is not altered to match."""
    pid, _ = _arm(dbp, level_kind="trendline", target_price=100.0)
    s1 = _pl.note_anchor_write(pid, {"anchor_p1": 1.0}, now=T0, db_path=dbp)
    s2 = _pl.note_anchor_write(pid, {"anchor_p1": 2.0}, now=T0 + 10, db_path=dbp)
    assert (s1["anchor_version"], s2["anchor_version"]) == (1, 2), "monotonic, never reused"
    assert s2["anchors_set_at"] == T0 + 10


def test_a_verdict_is_withheld_until_five_sessions(dbp):
    """⛔ "Not enough data yet" and "they disagree" are different answers.
    `verdict_ready` is its own field so they cannot be collapsed."""
    pid, twin = _arm(dbp, target_price=100.0)
    _cmp.open_span(pid, twin, now=T0, db_path=dbp)
    for d in range(3):
        _cmp.observe(pid, 99.0, now=T0 + d * DAY, db_path=dbp)
    r = _cmp.report(pid, db_path=dbp)
    assert len(r["sessions_covered"]) == 3
    assert r["verdict_ready"] is False
    for d in range(3, 6):
        _cmp.observe(pid, 99.0, now=T0 + d * DAY, db_path=dbp)
    r2 = _cmp.report(pid, db_path=dbp)
    assert len(r2["sessions_covered"]) >= _cmp.MIN_SESSIONS_FOR_VERDICT
    assert r2["verdict_ready"] is True


def test_trendline_spans_are_reported_by_name(dbp):
    """A trendline's level moves between ticks by construction, so its
    disagreements are not the same fact as a fixed level's."""
    anchors = {"anchor_t1": T0, "anchor_p1": 100.0, "anchor_t2": T0 + DAY, "anchor_p2": 110.0}
    pid, twin = _arm(dbp, level_kind="trendline", target_price=100.0, anchors=anchors)
    _cmp.open_span(pid, twin, now=T0, db_path=dbp)
    r = _cmp.report(pid, db_path=dbp)
    assert r["is_trendline"] is True
    assert "trendline" in r["level_kinds"]


# ─── CP2 scope rails ─────────────────────────────────────────────────────────

def test_the_harness_never_touches_watchlist_alerts():
    """⛔ CP2 SCOPE, as a property of the files rather than a promise. Shadowing
    real member rows is CP3 and needs its own approval line."""
    for name in ("price_level.py", "price_level_compare.py"):
        src = (_REPO / "api" / "services" / "alert_taxonomy" / name).read_text(encoding="utf-8")
        tree = ast.parse(src)
        # strip docstrings: both files DISCUSS watchlist_alerts at length, and a
        # naive substring search would match their own explanation.
        # ⛔ CODE, NEVER PROSE.
        for node in ast.walk(tree):
            if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
                    and isinstance(node.value.value, str)):
                node.value.value = ""
        code = ast.unparse(tree)
        assert "watchlist_alerts" not in code, f"{name} reaches the legacy table"
        assert "watchlist_alert_service" not in code, f"{name} imports the legacy service"
        # NON-VACUITY: the strip must not have emptied the file.
        assert "def " in code, f"{name} stripped to nothing — the check is vacuous"


def test_neither_cp2_module_imports_delivery():
    """The CP1 dark rail, extended to the harness. `evaluate()` now really
    fires, so this is the assertion standing between a dark run and a member."""
    for name in ("price_level.py", "price_level_compare.py"):
        src = (_REPO / "api" / "services" / "alert_taxonomy" / name).read_text(encoding="utf-8")
        imported = set()
        for node in ast.walk(ast.parse(src)):
            if isinstance(node, ast.Import):
                imported |= {a.name for a in node.names}
            elif isinstance(node, ast.ImportFrom):
                base = node.module or ""
                imported.add(base)
                imported |= {f"{base}.{a.name}" for a in node.names}
        assert imported, f"{name}: the import scan saw nothing — broken, not green"
        assert not any("delivery" in n for n in imported), f"{name} imports delivery"
