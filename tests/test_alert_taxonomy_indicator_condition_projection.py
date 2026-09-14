"""S7 `indicator-condition` CP3 — the dark projection. Fingerprint `4e8d3af5d`.

⛔ THE LOAD-BEARING RAIL IS THE NON-VACUITY CONTROL. Thirty of thirty-one
predicates are NOT COMPARABLE by construction (F-S7-IC-1), so a harness that had
broken and called *everything* incomparable would produce a nearly identical
count. The `close` ↔ `ohlcv.c` pair MUST come back comparable, or the thirty
proves nothing.
"""
import os
import sqlite3
import tempfile

import pytest

from api.services.alert_taxonomy import indicator_condition_compare as _cmp
from api.services.alert_taxonomy import indicator_condition_projection as proj
from api.services.canonical import indicator_axis as _axis


@pytest.fixture
def db():
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "cmp.db")
        yield p


def _row(alert_id=1, user="u1", sym="AAPL", indicator="rsi", tf="D",
         condition="above", threshold=70.0, last_value=None):
    return {"id": alert_id, "user_id": user, "sym": sym, "indicator": indicator,
            "condition": condition, "threshold": threshold, "tf": tf,
            "params_json": None, "instance_id": None, "scope": None,
            "def_source": None, "last_value": last_value, "arm_epoch": 0}


# ───────────────────────────── the comparability census, and its control

def test_the_one_renamed_pair_is_comparable():
    """⭐ THE NON-VACUITY CONTROL. Without this, thirty incomparables and a
    broken harness are the same reading."""
    verdict, target = proj.comparability("close")
    assert verdict == proj.COMPARABLE, f"the close rename is not comparable: {verdict}"
    assert target == "ohlcv.c"


def test_the_other_thirty_are_not_comparable():
    census = proj.comparability_census()
    assert census["n_comparable"] == 1, census["comparable"]
    assert census["n_not_comparable"] == 30, sorted(census["not_comparable"])
    assert "rsi" in census["not_comparable"]
    assert "bb.upper" in census["not_comparable"]


def test_a_name_the_axis_does_not_know_is_its_own_verdict():
    """`not_in_axis` and `no_book_form` are DIFFERENT facts and are never
    collapsed — they send a reader to different places."""
    assert proj.comparability("no_such_indicator")[0] == proj.NOT_IN_AXIS
    assert proj.comparability("rsi")[0] == proj.NO_BOOK_FORM


def test_comparability_does_not_depend_on_the_axis_flag(monkeypatch):
    """⛔⛔ THE RAIL THE DESIGN TURNS ON. If comparability went through the
    flag-gated resolve(), every predicate would read incomparable in the SHIPPED
    (dark) state and the one real signal would vanish exactly when nobody set the
    flag — `lesson_a_rails_important_half_can_be_opt_in`."""
    monkeypatch.delenv(_axis.FLAG, raising=False)
    off = proj.comparability_census()
    monkeypatch.setenv(_axis.FLAG, "1")
    on = proj.comparability_census()
    assert off == on, "comparability changed with the axis flag"
    assert off["n_comparable"] == 1


# ─────────────────────────────────── NOT COMPARABLE is never agreement

def test_an_incomparable_predicate_is_recorded_as_not_comparable(db, monkeypatch):
    monkeypatch.setattr(proj, "cohort_user_ids", lambda: {"u1"})
    monkeypatch.setattr(proj._legacy, "list_active", lambda: [_row(indicator="rsi")])
    out = proj.run_projected_comparison({1: 80.0}, now=1_757_000_000.0, db_path=db)

    assert out["not_comparable"] == 1
    assert out["observed"] == 0, "an incomparable predicate must not be observed"
    pid = proj.projected_predicate_id(1)
    assert out["not_comparable_by_predicate"][pid] == proj.NO_BOOK_FORM

    conn = sqlite3.connect(db)
    row = conn.execute(
        "SELECT not_comparable, agreed, legacy_only, new_only, ticks FROM "
        "indicator_condition_comparison_spans WHERE predicate_id = ?", (pid,)).fetchone()
    conn.close()
    nc, agreed, legacy_only, new_only, ticks = row
    assert nc == 1 and ticks == 1
    assert agreed == 0, "an incomparable tick was counted as AGREEMENT"
    assert legacy_only == 0, "an incomparable tick was counted as a legacy-only MISS"
    assert new_only == 0


def test_it_is_recorded_PER_PREDICATE_not_as_one_total(db, monkeypatch):
    rows = [_row(1, indicator="rsi"), _row(2, indicator="bb.upper"),
            _row(3, indicator="atr")]
    monkeypatch.setattr(proj, "cohort_user_ids", lambda: {"u1"})
    monkeypatch.setattr(proj._legacy, "list_active", lambda: rows)
    out = proj.run_projected_comparison({}, now=1_757_000_000.0, db_path=db)
    assert out["not_comparable"] == 3
    assert len(out["not_comparable_by_predicate"]) == 3, "collapsed into one total"


def test_an_incomparable_tick_still_beats(db, monkeypatch):
    """A tick that could not be compared is a tick that HAPPENED. If the
    heartbeat depended on comparability it would stop dead on the thirty and look
    exactly like a dead sweep."""
    monkeypatch.setattr(proj, "cohort_user_ids", lambda: {"u1"})
    monkeypatch.setattr(proj._legacy, "list_active", lambda: [_row(indicator="rsi")])
    proj.run_projected_comparison({}, now=1_757_000_000.0, db_path=db)
    hb = _cmp.heartbeat(db_path=db)
    assert hb and hb["ticks"] >= 1, "the sweep ticked and the heartbeat did not"


def test_the_comparable_pair_reaches_observe(db, monkeypatch):
    """CONTROL for the branch above — proves `observed` is reachable, so
    `observed == 0` elsewhere is a finding and not a dead code path."""
    monkeypatch.setattr(proj, "cohort_user_ids", lambda: {"u1"})
    monkeypatch.setattr(proj._legacy, "list_active",
                        lambda: [_row(indicator="close", last_value=100.0)])
    out = proj.run_projected_comparison({1: 105.0}, now=1_757_000_000.0, db_path=db)
    assert out["observed"] == 1, "the one comparable predicate never reached observe()"
    assert out["not_comparable"] == 0


# ───────────────────────────────────────────── the cohort is the S12 tag

def test_the_cohort_is_the_rollout_tag_never_a_role(monkeypatch):
    seen = {}
    def fake(cohort, **kw):
        seen["cohort"] = cohort
        return {"u1"}
    monkeypatch.setattr(proj.rollout, "cohort_user_ids", fake)
    assert proj.cohort_user_ids() == {"u1"}
    assert seen["cohort"] == proj.rollout.S7_DARK


def test_an_empty_cohort_resolves_to_NO_MEMBERS_never_a_fallback(monkeypatch):
    """⛔⛔ THE REAL FUNCTION, NOT A STUB OF IT. `rollout.py:29-38` rules that an
    empty cohort means NO MEMBERS and never a fallback to admins.

    ⚰️ The first version of this rail monkeypatched `proj.cohort_user_ids`
    itself, so it asserted against its own stub — and a mutation adding
    `or {"admin-fallback"}` to the real function stayed GREEN. A rail that
    replaces the thing it is testing cannot fail (`lesson_gate_that_cannot_fail`).
    """
    monkeypatch.setattr(proj.rollout, "cohort_user_ids", lambda *a, **k: set())
    assert proj.cohort_user_ids() == set(), "an empty cohort fell back to something"


def test_an_empty_cohort_projects_nothing_and_never_reads_the_legacy_table(monkeypatch):
    monkeypatch.setattr(proj.rollout, "cohort_user_ids", lambda *a, **k: set())
    called = {"n": 0}
    def boom():
        called["n"] += 1
        return [_row()]
    monkeypatch.setattr(proj._legacy, "list_active", boom)
    assert proj.projected_alerts() == []
    assert called["n"] == 0, "an empty cohort still read the legacy table"


def test_control_a_non_empty_cohort_does_read_it(monkeypatch):
    """CONTROL — proves the test above is not passing because the read is
    unreachable."""
    monkeypatch.setattr(proj.rollout, "cohort_user_ids", lambda *a, **k: {"u1"})
    monkeypatch.setattr(proj._legacy, "list_active", lambda: [_row()])
    assert len(proj.projected_alerts()) == 1


def test_the_projection_does_not_filter_scope_or_def_source(monkeypatch):
    """⛔ Filtering here shrinks what the shadow lane observes and makes a
    cutover gate pass on a smaller set."""
    rows = [_row(1), _row(2)]
    rows[0]["scope"] = "chart-1"        # displayed on one chart
    rows[0]["def_source"] = "builder"
    rows[0]["state"] = "fired"          # and already fired
    monkeypatch.setattr(proj, "cohort_user_ids", lambda: {"u1"})
    monkeypatch.setattr(proj._legacy, "list_active", lambda: rows)
    assert len(proj.projected_alerts()) == 2, "a scoped/fired alert was filtered out"


# ──────────────────────────────────────────── the flag, and the caller rail

def test_the_sweep_is_off_by_default(monkeypatch, db):
    monkeypatch.delenv(proj.FLAG, raising=False)
    assert proj.enabled() is False
    out = proj.run_dark_sweep({}, now=1_757_000_000.0, db_path=db)
    assert out.get("skipped") == "flag off"


def test_control_the_flag_turns_the_sweep_on(monkeypatch, db):
    monkeypatch.setenv(proj.FLAG, "1")
    monkeypatch.setattr(proj, "cohort_user_ids", lambda: set())
    out = proj.run_dark_sweep({}, now=1_757_000_000.0, db_path=db)
    assert "skipped" not in out


def test_an_empty_cohort_still_beats(monkeypatch, db):
    monkeypatch.setenv(proj.FLAG, "1")
    monkeypatch.setattr(proj, "cohort_user_ids", lambda: set())
    proj.run_dark_sweep({}, now=1_757_000_000.0, db_path=db)
    hb = _cmp.heartbeat(db_path=db)
    assert hb and hb["ticks"] >= 1, "a heartbeat that only beats on success"


def test_the_projection_imports_no_delivery_module():
    """⛔ NO DELIVERY IMPORT — the whole point of dark. Derived from the module's
    real import graph, not a grep over prose."""
    import ast
    import pathlib
    src = pathlib.Path(proj.__file__).read_text(encoding="utf-8")
    mods = set()
    for n in ast.walk(ast.parse(src)):
        if isinstance(n, ast.Import):
            mods.update(a.name for a in n.names)
        elif isinstance(n, ast.ImportFrom) and n.module:
            mods.add(n.module)
            mods.update(f"{n.module}.{a.name}" for a in n.names)
    forbidden = ("watchlist_alert_service", "discord_notify", "email",
                 "resend", "voice_proactive_service", "alert_delivery")
    hits = sorted(m for m in mods for f in forbidden if f in m)
    assert not hits, f"CP3 imports a delivery path: {hits}"
    # CONTROL — the probe can see a module that IS imported.
    assert any("indicator_alert_service" in m for m in mods), "the import probe found nothing"


def test_the_projection_edits_no_legacy_module():
    """⛔ NO LEGACY CHANGE. The projection may only READ the legacy lane."""
    import ast
    import pathlib
    src = pathlib.Path(proj.__file__).read_text(encoding="utf-8")
    writes = []
    for n in ast.walk(ast.parse(src)):
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute):
            if isinstance(n.func.value, ast.Name) and n.func.value.id == "_legacy":
                writes.append(n.func.attr)
    assert set(writes) <= {"list_active"}, f"CP3 calls a legacy mutator: {writes}"
    assert writes, "the probe found no legacy call at all — it cannot discriminate"
