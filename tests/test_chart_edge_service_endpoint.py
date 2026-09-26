"""POST /api/r/edge-service-token -- the per-render capability for trusted
renderers OFF the web pod (Morning Wire's letter, Sunday Scans)."""
from __future__ import annotations

import os
import sys

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api import chart_edge_token as cet  # noqa: E402
from api.routers import chart_edge_service as ces  # noqa: E402

PUSH = "push-secret-for-tests"
RENDER = "public-bundle-render-token"
PATH = "/api/r/edge-service-token"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", PUSH)
    monkeypatch.setenv("CHART_RENDER_TOKEN", RENDER)
    monkeypatch.setenv("CHART_EDGE_SECRET", "edge-secret-for-tests")
    monkeypatch.delenv("CHART_EDGE_RENDER_TOKEN_TTL_SECONDS", raising=False)
    app = FastAPI()
    app.include_router(ces.router)
    return TestClient(app)


def test_push_secret_gets_a_service_token_the_worker_twin_accepts(client):
    r = client.post(PATH, headers={"Authorization": f"Bearer {PUSH}"})
    assert r.status_code == 200
    body = r.json()
    assert body["header"] == "X-Chart-Edge-Token" and body["ttl"] == 120
    cls, payload = cet.verify(body["token"], expect=cet.ENTITLEMENT_SERVICE)
    assert cls == "VALID" and payload["ent"] == "service"
    assert "no-store" in r.headers.get("cache-control", "")


def test_it_is_a_SERVICE_token_never_a_member_one(client):
    tok = client.post(PATH, headers={"Authorization": f"Bearer {PUSH}"}).json()["token"]
    cls, _ = cet.verify(tok, expect=cet.ENTITLEMENT_BARS)
    assert cls != "VALID"


def test_the_PUBLIC_render_token_is_refused(client):
    # It ships in the frontend bundle: accepting it would hand anyone a capability.
    for auth in (f"Bearer {RENDER}", RENDER):
        assert client.post(PATH, headers={"Authorization": auth}).status_code == 401
    assert client.post(f"{PATH}?token={RENDER}").status_code == 401


def test_no_or_wrong_credential_is_refused(client):
    assert client.post(PATH).status_code == 401
    assert client.post(PATH, headers={"Authorization": "Bearer nope"}).status_code == 401


def test_get_is_not_a_door(client):
    assert client.get(PATH, headers={"Authorization": f"Bearer {PUSH}"}).status_code == 405


def test_unset_edge_secret_is_503_not_500(client, monkeypatch):
    monkeypatch.delenv("CHART_EDGE_SECRET", raising=False)
    r = client.post(PATH, headers={"Authorization": f"Bearer {PUSH}"})
    assert r.status_code == 503


def test_unset_push_secret_refuses_everyone(client, monkeypatch):
    monkeypatch.delenv("PUSH_SECRET", raising=False)
    assert client.post(PATH, headers={"Authorization": "Bearer "}).status_code == 401


def test_the_SERVED_app_mounts_it():
    # A router nobody includes is a feature that does not exist.
    from api.main import app
    posts = {(r.path, m) for r in app.routes for m in (getattr(r, "methods", None) or ())}
    assert (PATH, "POST") in posts
