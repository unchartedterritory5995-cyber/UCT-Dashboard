"""Phase One Track C — the indicator/screener member-journey telemetry.

Covers `api/services/indicator_telemetry.py` (the shared log_event helper,
the allowlist, the de-dup guard) and `api/routers/indicator_telemetry.py`
(the authenticated client-facing endpoint). See `TRACK_C_TELEMETRY.md` for
where each of the five events fires in the product; this file proves the
shared plumbing they all fire through.
"""
from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import auth_db
from api.services import indicator_telemetry as telemetry


@pytest.fixture
def db(tmp_path, monkeypatch):
    """An isolated `landing_events` table — `auth_db._DB_PATH` is captured at
    import by every caller of `get_connection`, so the ATTRIBUTE has to move
    (the same rule `tests/test_user_definitions.py::store` states for the
    indicator-alert DB, which in production is this SAME physical file)."""
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth_test.db"))
    auth_db.init_db()
    return tmp_path


def _rows(db, user_id: str, event: str) -> list[dict]:
    conn = auth_db.get_connection()
    try:
        out = []
        for r in conn.execute(
            "SELECT props FROM landing_events WHERE visitor_id = ? AND event = ?"
            " ORDER BY id", (user_id, event)):
            out.append(json.loads(r[0]) if r[0] else {})
        return out
    finally:
        conn.close()


class TestLogEvent:
    def test_an_unknown_event_is_refused_and_writes_nothing(self, db):
        ok = telemetry.log_event("u1", "not_a_real_event")
        assert ok is False
        assert _rows(db, "u1", "not_a_real_event") == []

    def test_a_known_event_writes_one_row_with_its_props(self, db):
        ok = telemetry.log_event("u1", "import_submitted", import_id="i1", dialect="pine")
        assert ok is True
        rows = _rows(db, "u1", "import_submitted")
        assert len(rows) == 1
        assert rows[0]["import_id"] == "i1"
        assert rows[0]["dialect"] == "pine"

    def test_extra_kwargs_land_in_props(self, db):
        telemetry.log_event("u1", "execution_finished", def_id="u_abc123", mode="on-demand",
                            state="done")
        rows = _rows(db, "u1", "execution_finished")
        assert rows[0]["def_id"] == "u_abc123"
        assert rows[0]["mode"] == "on-demand"
        assert rows[0]["state"] == "done"

    def test_a_repeated_import_id_is_deduplicated_and_only_one_row_lands(self, db):
        """⭐ THE NON-VACUOUS GUARD TEST. Fires the SAME (user, event, import_id)
        twice — a retried request, or a double-fired handler — and asserts
        exactly one row landed. If the dedup lookup in `_already_logged` were
        deleted, this test would see 2 rows and fail."""
        first = telemetry.log_event("u1", "import_submitted", import_id="dup-1", dialect="pine")
        second = telemetry.log_event("u1", "import_submitted", import_id="dup-1", dialect="pine")
        assert first is True
        assert second is False, "a duplicate import_id must be reported as NOT newly logged"
        assert len(_rows(db, "u1", "import_submitted")) == 1

    def test_a_different_import_id_is_not_treated_as_a_duplicate(self, db):
        telemetry.log_event("u1", "import_submitted", import_id="a")
        telemetry.log_event("u1", "import_submitted", import_id="b")
        assert len(_rows(db, "u1", "import_submitted")) == 2

    def test_a_different_user_with_the_same_import_id_is_not_a_duplicate(self, db):
        """The dedup key is (user, event, import_id), not import_id alone —
        two members could theoretically mint colliding client-side ids and
        must not shadow each other's rows."""
        telemetry.log_event("u1", "import_submitted", import_id="shared")
        telemetry.log_event("u2", "import_submitted", import_id="shared")
        assert len(_rows(db, "u1", "import_submitted")) == 1
        assert len(_rows(db, "u2", "import_submitted")) == 1

    def test_events_with_no_import_id_are_never_deduplicated(self, db):
        """`delivery_configured`/`execution_finished` calls with no import_id
        (the common case for those two events) must each land — dedup only
        applies when an import_id is actually supplied."""
        telemetry.log_event("u1", "delivery_configured", surface="alert")
        telemetry.log_event("u1", "delivery_configured", surface="alert")
        assert len(_rows(db, "u1", "delivery_configured")) == 2

    def test_a_broken_connection_never_raises(self, db, monkeypatch):
        def _boom():
            raise RuntimeError("db unreachable")
        monkeypatch.setattr(telemetry, "get_connection", _boom)
        # Must return False, not raise — a telemetry failure must never break
        # the product action it observes.
        assert telemetry.log_event("u1", "import_submitted", import_id="x") is False


class TestClientRouter:
    @pytest.fixture
    def app(self, db):
        from api.middleware.auth_middleware import get_current_user
        from api.routers import indicator_telemetry as router_mod
        a = FastAPI()
        a.include_router(router_mod.router)
        a.dependency_overrides[get_current_user] = lambda: {"id": "u1", "role": "user"}
        return a

    def test_a_client_fireable_event_is_accepted_and_logged(self, app, db):
        c = TestClient(app)
        resp = c.post("/api/indicator-telemetry/event", json={
            "event": "import_submitted", "import_id": "i1", "dialect": "thinkscript",
        })
        assert resp.status_code == 200
        assert resp.json()["logged"] is True
        rows = _rows(db, "u1", "import_submitted")
        assert rows[0]["dialect"] == "thinkscript"

    @pytest.mark.parametrize("event", ["import_accepted", "delivery_configured", "execution_finished"])
    def test_a_server_only_event_is_refused_from_the_client(self, app, db, event):
        """⛔ A CLIENT MUST NEVER BE ABLE TO ASSERT ITS OWN ACCEPTANCE/DELIVERY/
        EXECUTION. These three are the record of a SERVER decision."""
        c = TestClient(app)
        resp = c.post("/api/indicator-telemetry/event", json={
            "event": event, "import_id": "i1",
        })
        assert resp.status_code == 400
        assert _rows(db, "u1", event) == []

    def test_unauthenticated_is_refused(self, db):
        """No dependency override — the real `get_current_user` gate applies."""
        from api.routers import indicator_telemetry as router_mod
        a = FastAPI()
        a.include_router(router_mod.router)
        c = TestClient(a)
        resp = c.post("/api/indicator-telemetry/event", json={
            "event": "import_submitted", "import_id": "i1",
        })
        assert resp.status_code in (401, 403)

    def test_a_normal_shape_only_props_payload_round_trips(self, app, db):
        """A real call site's props (dialect/stage/gate/booleans) is exactly
        this small — proves the enforcement below costs legitimate traffic
        nothing."""
        c = TestClient(app)
        resp = c.post("/api/indicator-telemetry/event", json={
            "event": "compile_finished", "import_id": "i2", "dialect": "pcf",
            "props": {"success": False, "stage": "compile"},
        })
        assert resp.status_code == 200
        rows = _rows(db, "u1", "compile_finished")
        assert rows[0]["success"] is False
        assert rows[0]["stage"] == "compile"

    def test_a_props_value_shaped_like_pasted_source_is_REJECTED_not_silently_stored(self, app, db):
        """⛔ ENFORCED, NOT JUST COMMENTED. `logIndicatorTelemetry`/`EventBody`'s
        own docstrings say 'never the source text itself' but relied entirely on
        caller discipline — nothing stopped a future call site from accidentally
        passing a pasted script/prompt through `props`. This plants exactly that
        mistake (a long string standing in for real Pine/thinkScript/PCF source)
        and proves the door refuses it and writes nothing, rather than silently
        accepting and persisting it forever."""
        c = TestClient(app)
        fake_pasted_source = "//@version=5\nindicator('x')\n" + ("plot(close)\n" * 20)
        assert len(fake_pasted_source) > 200  # confirms this case actually exercises the bound
        resp = c.post("/api/indicator-telemetry/event", json={
            "event": "compile_finished", "import_id": "i3", "dialect": "pine",
            "props": {"stage": "compile", "accidental_source": fake_pasted_source},
        })
        assert resp.status_code == 422
        assert _rows(db, "u1", "compile_finished") == []

    def test_a_props_value_right_at_the_boundary_is_still_accepted(self, app, db):
        """The bound is generous to legitimate shape data — a control proving
        this isn't just rejecting everything."""
        c = TestClient(app)
        resp = c.post("/api/indicator-telemetry/event", json={
            "event": "compile_finished", "import_id": "i4", "dialect": "pine",
            "props": {"gate": "x" * 200},
        })
        assert resp.status_code == 200
