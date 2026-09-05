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


class TestEventSchemas:
    """⛔⛔ 2026-09-04 hardening, per owner review: a length ceiling alone is
    NOT a privacy boundary — real pasted source, prompts, and formulas are
    routinely under 200 characters. `EVENT_SCHEMAS` is the primary defense
    now: an explicit, named (property, type) allowlist per event. These
    tests exercise `sanitize_props`/`_prop_violation` directly (the shared
    logic both `log_event` and the client router's strict rejection run
    through), independent of the HTTP layer covered in `TestClientRouter`.
    """

    @pytest.mark.parametrize("event,props", [
        ("import_submitted", {"import_id": "i1", "dialect": "pine", "door": "pine"}),
        ("compile_finished", {"import_id": "i1", "dialect": "pine", "success": True,
                               "stage": "compile", "gate": "bars:too-large",
                               "source_length": 412, "node_count": 7, "latency_ms": 88.5}),
        ("import_accepted", {"import_id": "i1", "dialect": "pine", "def_id": "u_abc",
                              "def_hash": "h123", "source_length": 300, "node_count": 5}),
        ("delivery_configured", {"surface": "alert", "destination": "discord",
                                  "indicator": "u_abc123.value", "sym": "NVDA", "tf": "D"}),
        ("execution_finished", {"mode": "on-demand", "tf": "D", "as_of": "2026-09-04",
                                 "session": "regular", "universe": "sp500",
                                 "state": "done", "gate": None, "latency_ms": 120}),
    ])
    def test_every_documented_field_for_every_event_is_allowed(self, event, props):
        """Requirement #1/#4: each event's full, real, documented shape passes
        through untouched — the allowlist is generous to legitimate shape
        data, never merely restrictive."""
        out = telemetry.sanitize_props(event, props)
        for key, value in props.items():
            if value is None:
                continue
            assert out.get(key) == value, f"{event}.{key} was dropped but is documented as allowed"

    @pytest.mark.parametrize("event", list(telemetry.EVENT_SCHEMAS.keys()))
    def test_an_unlisted_property_name_is_dropped_regardless_of_length(self, event):
        """Requirement #2/#3: the KEY not being on the allowlist is what
        matters — a short value must be dropped exactly as a long one is.
        `"hi"` is 2 characters; nothing about the 200-char defense-in-depth
        cap would ever catch it. Only the allowlist does."""
        out = telemetry.sanitize_props(event, {"totally_unlisted_field": "hi"})
        assert out == {}

    def test_a_short_pasted_source_shaped_value_is_dropped_not_stored(self):
        """The exact scenario the owner flagged: real pasted source, a
        plain-language prompt, or a sensitive fragment is routinely SHORT.
        This plants an 11-character string under a plausible but unlisted
        key and proves it never reaches storage — length was never the
        reason it's safe."""
        short_prompt = "buy signal"
        assert len(short_prompt) < 200
        out = telemetry.sanitize_props("compile_finished", {"prompt": short_prompt})
        assert out == {}

    def test_a_long_pasted_source_value_is_also_dropped(self):
        """The defense-in-depth half still holds for an ALLOWED key that
        somehow arrives implausibly long."""
        fake_source = "//@version=5\n" + ("plot(close)\n" * 30)
        assert len(fake_source) > 200
        out = telemetry.sanitize_props("compile_finished", {"gate": fake_source})
        assert out == {}

    @pytest.mark.parametrize("wrapper", [
        lambda content: [content],
        lambda content: {"nested": content},
        lambda content: {"a": {"b": {"c": content}}},
        lambda content: [{"note": content}],
    ])
    def test_nested_list_or_object_wrapping_cannot_smuggle_content_through_an_allowed_key(self, wrapper):
        """Requirement #6: a container wrapped around content, placed under
        an otherwise-ALLOWED key (`gate`, which normally holds a short refusal
        code), must not bypass the scalar-only rule — regardless of how deep
        the nesting is or whether the outer shape is a list or a dict."""
        smuggled = wrapper("this is the actual pasted script content")
        out = telemetry.sanitize_props("compile_finished", {"gate": smuggled})
        assert out == {}

    def test_a_bool_is_never_accepted_for_a_numeric_only_field(self):
        """`bool` is a subclass of `int` in Python — without `_type_ok`'s
        explicit guard, `True`/`False` would silently pass a `(int, float)`
        check. Not a content-leak risk by itself, but a real type-fidelity
        gap the schema is supposed to enforce precisely."""
        out = telemetry.sanitize_props("compile_finished", {"source_length": True})
        assert out == {}

    def test_log_event_applies_the_same_allowlist_as_sanitize_props(self, db):
        """End-to-end through the real write path, not just the pure helper:
        an unlisted field passed as a **kwarg to log_event never lands in
        storage, and the event still writes successfully with only its
        allowed fields."""
        ok = telemetry.log_event("u1", "compile_finished", import_id="i9",
                                  dialect="pine", success=True,
                                  raw_pasted_text="//@version=5\nplot(close)")
        assert ok is True
        rows = _rows(db, "u1", "compile_finished")
        assert rows[0]["success"] is True
        assert "raw_pasted_text" not in rows[0]


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

    def test_a_SHORT_unlisted_property_is_rejected_at_the_http_door_too(self, app, db):
        """⛔ THE OWNER'S CORE POINT, AT THE HTTP LAYER: a short pasted-source
        or prompt fragment (11 chars — nowhere near the 200-char
        defense-in-depth cap) is rejected because its KEY is not allowed,
        never because of its length."""
        c = TestClient(app)
        resp = c.post("/api/indicator-telemetry/event", json={
            "event": "compile_finished", "import_id": "i5", "dialect": "pine",
            "props": {"prompt": "buy signal"},
        })
        assert resp.status_code == 422
        assert _rows(db, "u1", "compile_finished") == []

    def test_content_wrapped_in_a_list_under_an_allowed_key_is_rejected_not_stored(self, app, db):
        """Requirement #6: nesting real content inside a container, under a
        key (`gate`) that is otherwise allowed, must not slip past the door
        as a scalar would."""
        c = TestClient(app)
        resp = c.post("/api/indicator-telemetry/event", json={
            "event": "compile_finished", "import_id": "i6", "dialect": "pine",
            "props": {"gate": ["smuggled", "as", "a", "list"]},
        })
        assert resp.status_code == 422
        assert _rows(db, "u1", "compile_finished") == []

    def test_normal_five_shape_telemetry_still_works_end_to_end(self, app, db):
        """Requirement #6's last item: with the schema enforcement in place,
        the ordinary, realistic call for each client-fireable event still
        round-trips exactly as before."""
        c = TestClient(app)
        r1 = c.post("/api/indicator-telemetry/event", json={
            "event": "import_submitted", "import_id": "j1", "dialect": "thinkscript",
        })
        r2 = c.post("/api/indicator-telemetry/event", json={
            "event": "compile_finished", "import_id": "j1", "dialect": "thinkscript",
            "props": {"success": True, "stage": "compile"},
        })
        assert r1.status_code == 200 and r1.json()["logged"] is True
        assert r2.status_code == 200 and r2.json()["logged"] is True
        assert _rows(db, "u1", "import_submitted")[0]["dialect"] == "thinkscript"
        assert _rows(db, "u1", "compile_finished")[0]["success"] is True
