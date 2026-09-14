"""Extraction routes on the REAL app (stream S-D). Imports api.main — run under the box lock.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. an extract route unmounted, or reachable by an anonymous caller or a free member;
2. the machine route accepting a missing, blank or wrong worker credential, or a
   PUSH_SECRET that is unset;
3. a receipt route that trusts a receipt's own numbers or accepts garbage.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from api.services.wisdom.core import store
from api.services.wisdom.extract import golden

ADMIN_PATHS = ("/api/admin/wisdom/extract/batches", "/api/admin/wisdom/extract/gate",
               "/api/admin/wisdom/extract/budget")
RECEIPT_PATH = "/api/internal/wisdom/extract/eval-runs"
RECEIPT = {"kind": "extractor_golden", "run_id": "pc-run-7", "extractor_version": "wx-v0-aaaaaaaa",
           "model": "claude-opus-5", "effort": "high", "golden_version": "gv1", "split": "dev",
           "golden_sha256": "a" * 64,
           "per_type": {"CALL": {"tp": 2, "fp": 2, "fn": 0, "precision": 1.0}}}


@pytest.fixture(scope="module")
def real_app():
    from api.main import app

    return app


@pytest.fixture
def wisdom_db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()
    return tmp_path / "wisdom.db"


def test_the_extract_routes_are_mounted_gated_and_answer_an_admin(real_app, wisdom_db):
    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
    from tests.authclients import ADMIN, FREE_MEMBER, signed_in_as

    paths = {getattr(r, "path", "") for r in real_app.routes}
    assert set(ADMIN_PATHS) | {RECEIPT_PATH} <= paths
    for dep in (get_current_user, get_current_user_with_plan):
        real_app.dependency_overrides.pop(dep, None)
    client = TestClient(real_app, raise_server_exceptions=False)
    for path in ADMIN_PATHS:
        assert client.get(path).status_code == 401, path
    with signed_in_as(FREE_MEMBER, real_app):
        for path in ADMIN_PATHS:
            assert client.get(path).status_code == 403, path
    with signed_in_as(ADMIN, real_app):
        batches = client.get(ADMIN_PATHS[0]).json()
        gate = client.get(ADMIN_PATHS[1]).json()
        spend = client.get(ADMIN_PATHS[2]).json()
    assert batches["batches"] == [] and batches["requests"] == []
    assert gate["gate"]["accepted"] is False and gate["extractor_version"].startswith("wx-v0-")
    assert {s["module"] for s in gate["seams"]} >= {"api.services.wisdom.core.entities",
                                                    "api.services.wisdom.core.private"}
    assert spend["cap_usd"] == 120.0 and spend["actual_usd"] == 0.0


def test_the_receipt_route_needs_the_worker_credential_and_re_derives_the_numbers(real_app, wisdom_db, monkeypatch):
    from api.routers import wisdom_extract

    assert wisdom_extract.require_push_secret.__name__ == "require_push_secret"
    route = next(r for r in real_app.routes if getattr(r, "path", "") == RECEIPT_PATH)
    assert any(d.call is wisdom_extract.require_push_secret for d in route.dependant.dependencies)
    client = TestClient(real_app, raise_server_exceptions=False)
    monkeypatch.delenv("PUSH_SECRET", raising=False)
    assert client.post(RECEIPT_PATH, json=RECEIPT, headers={"Authorization": "Bearer "}).status_code == 401
    monkeypatch.setenv("PUSH_SECRET", "s3cret-for-tests")
    assert client.post(RECEIPT_PATH, json=RECEIPT).status_code == 401
    assert client.post(RECEIPT_PATH, json=RECEIPT, headers={"Authorization": "Bearer wrong"}).status_code == 401
    ok = client.post(RECEIPT_PATH, json=RECEIPT, headers={"Authorization": "Bearer s3cret-for-tests"})
    assert ok.status_code == 200 and ok.json()["gate"]["decision"] == "accepted"
    bad = client.post(RECEIPT_PATH, json={"kind": "nope"}, headers={"Authorization": "Bearer s3cret-for-tests"})
    assert bad.status_code == 422
    with store.read() as conn:
        status = golden.gate_status(conn, extractor_version="wx-v0-aaaaaaaa", model="claude-opus-5")
    assert status["accepted"] and status["per_type"]["CALL"]["precision"] == 0.5
