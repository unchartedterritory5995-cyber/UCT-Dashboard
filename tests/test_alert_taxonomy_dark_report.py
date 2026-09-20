"""`api/services/alert_taxonomy/dark_report.py` and its two admin HTTP routes.

Built to close a real gap: the only way to read S7 dark-comparison data before
this was a hand-written SQL query run via `railway ssh`, one type
(price-level) at a time, via `tools/s7_price_level_report.py`. This module
generalizes that to all seven types by calling each type's own, already-real
`report()` -- never a second aggregation logic that could drift from it.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from api.services.alert_taxonomy import db as at_db
from api.services.alert_taxonomy import dark_report as _dr
from api.services.alert_taxonomy import regime_change as _rc_types
from api.services.alert_taxonomy import regime_change_compare as rc


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    db_path = str(tmp_path / "alert_taxonomy.db")
    monkeypatch.setattr(at_db, "DB_PATH", db_path)
    return db_path


# ─────────────────────────────────────────────────────────────────────────────
# The type table itself
# ─────────────────────────────────────────────────────────────────────────────

def test_every_declared_type_resolves_to_a_module_with_a_real_report_function():
    """⛔ STRUCTURAL, not behavioural: every entry in `_TYPES` must name a real,
    importable module carrying the SAME `report(predicate_id, *, db_path=None)`
    shape every other type's dark-read language depends on. A typo in the
    module name here would only surface the first time someone actually asked
    for that type's report -- this makes it fail for all seven up front."""
    import inspect
    for key in _dr.known_types():
        table, module_name = _dr._TYPES[key]
        mod = _dr._module(module_name)
        assert hasattr(mod, "report"), f"{module_name} has no report()"
        sig = inspect.signature(mod.report)
        assert list(sig.parameters)[0] == "predicate_id"
        assert "db_path" in sig.parameters
        assert table.endswith("_comparison_spans")


def test_seven_types_declared_matching_the_seven_S7_alert_types():
    assert set(_dr.known_types()) == {
        "price-level", "event-proximity", "position-risk",
        "scan-membership-change", "catalyst-match", "regime-change",
        "indicator-condition",
    }


def test_an_unknown_type_raises_ValueError_naming_the_known_ones():
    with pytest.raises(ValueError, match="regime-change"):
        _dr.dark_report("not-a-real-type")


# ─────────────────────────────────────────────────────────────────────────────
# The real aggregation, driven through a real type's real observe()/report()
# ─────────────────────────────────────────────────────────────────────────────

def test_dark_report_reflects_real_observed_spans_for_one_type(tmp_path):
    db_path = str(tmp_path / "at.db")
    LEDGER_PRED = {"labels": None, "min_confidence": None,
                  "stake": _rc_types.STAKE_EITHER, "prior_label_source": _rc_types.LEDGER}

    rc.observe("regime-change:p1", LEDGER_PRED, "2026-09-11",
              current_label="bear_trend", ledger_label="chop",
              has_positions=True, db_path=db_path)
    rc.observe("regime-change:p2", LEDGER_PRED, "2026-09-11",
              current_label="bull_trend", ledger_label="chop",
              has_positions=True, db_path=db_path)

    out = _dr.dark_report("regime-change", db_path=db_path)
    assert out["alert_type"] == "regime-change"
    assert out["table"] == "regime_change_comparison_spans"
    assert out["predicate_count"] == 2
    pids = {p["predicate_id"] for p in out["predicates"]}
    assert pids == {"regime-change:p1", "regime-change:p2"}
    # Each entry is the REAL report() shape, not a re-derived summary.
    for p in out["predicates"]:
        assert p["status"] in (rc.STATUS_OBSERVED, rc.STATUS_QUIET,
                               rc.STATUS_NO_FLIP, rc.STATUS_NO_DATA)
        assert "verdict_ready" in p and "blind_spots" in p


def test_dark_report_on_a_type_with_no_spans_yet_returns_an_empty_list_not_an_error(tmp_path):
    db_path = str(tmp_path / "at.db")
    out = _dr.dark_report("catalyst-match", db_path=db_path)
    assert out["predicate_count"] == 0
    assert out["predicates"] == []


def test_dark_report_all_covers_every_declared_type(tmp_path):
    db_path = str(tmp_path / "at.db")
    out = _dr.dark_report_all(db_path=db_path)
    assert set(out) == set(_dr.known_types())
    for t, rep in out.items():
        assert rep["alert_type"] == t


# ─────────────────────────────────────────────────────────────────────────────
# The HTTP surface — ADMIN, never no-auth (predicate_id can carry member specifics)
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def client():
    from api.main import app
    return TestClient(app)


def test_dark_report_route_requires_admin(client):
    from api.main import app
    from api.middleware.auth_middleware import get_current_user
    app.dependency_overrides[get_current_user] = lambda: {"id": "u1", "role": "member"}
    try:
        r = client.get("/api/admin/alert-taxonomy/dark-report/regime-change")
        assert r.status_code == 403
        r2 = client.get("/api/admin/alert-taxonomy/dark-report")
        assert r2.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_dark_report_route_works_for_admin(client):
    from api.main import app
    from api.middleware.auth_middleware import get_current_user
    app.dependency_overrides[get_current_user] = lambda: {"id": "admin1", "role": "admin"}
    try:
        r = client.get("/api/admin/alert-taxonomy/dark-report/regime-change")
        assert r.status_code == 200
        body = r.json()
        assert body["alert_type"] == "regime-change"
        assert "predicates" in body

        r2 = client.get("/api/admin/alert-taxonomy/dark-report")
        assert r2.status_code == 200
        assert set(r2.json()) == set(_dr.known_types())
    finally:
        app.dependency_overrides.clear()


def test_dark_report_route_404s_on_an_unknown_type(client):
    from api.main import app
    from api.middleware.auth_middleware import get_current_user
    app.dependency_overrides[get_current_user] = lambda: {"id": "admin1", "role": "admin"}
    try:
        r = client.get("/api/admin/alert-taxonomy/dark-report/not-a-real-type")
        assert r.status_code == 404
    finally:
        app.dependency_overrides.clear()
