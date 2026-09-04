"""Phase 8, Package 8F — admin-only canonical-detail proof route.

`GET /api/patterns/admin/canonical-detail/{detection_id}` uses the SAME
`require_admin` (authenticated session cookie -> role='admin' in auth.db)
every other admin route on this router already uses — never a
client-supplied identity (ChatGPT relay review, 2026-09-04: "reuse the
established ADMIN_EMAILS authorization helper/convention rather than
trusting an email supplied in a query parameter, request body, or client
state"). Same login-fixture convention as
tests/test_pattern_vision_api.py's sibling admin-route tests.
"""
import uuid

import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.services.auth_db import init_db as auth_init_db
from api.services.auth_service import create_session, create_user
from api.services.pattern_engine import memory
from api.services.pattern_engine.canonical_adapter import adapt_high_tight_flag
from api.services.pattern_engine.detectors.uct.high_tight_flag import detect_high_tight_flag
from api.services.pattern_engine.pattern_db import init_db as pattern_init_db
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


@pytest.fixture
def client():
    auth_init_db()
    pattern_init_db()
    return TestClient(app)


def _login(client, role="member"):
    user = create_user(f"cd_{uuid.uuid4()}@example.com", "password123")
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        conn.execute("UPDATE users SET role = ? WHERE id = ?", (role, user["id"]))
        conn.commit()
    finally:
        conn.close()
    client.cookies.set("uct_session", create_session(user["id"]))
    return user["id"]


def _stored_htf_id(sym="ADMINHTF1") -> str:
    for fx in load_all_fixtures("high_tight_flag", include_internal=False):
        if not fx.expected_fires:
            continue
        ctx = fx.context if fx.context is not None else build_context(fx.bars, sym="TEST")
        detections = detect_high_tight_flag(fx.bars, ctx)
        if detections:
            d = dict(max(detections, key=lambda x: x["confidence"]))
            d["sym"], d["tf"] = sym, "D"
            d = adapt_high_tight_flag(d)
            memory.store_detection(d)
            return d["id"]
    raise AssertionError("no firing high_tight_flag fixture found")


def test_canonical_detail_requires_auth(client):
    r = client.get("/api/patterns/admin/canonical-detail/some-id")
    assert r.status_code == 401


def test_canonical_detail_requires_admin(client):
    _login(client, role="member")
    r = client.get("/api/patterns/admin/canonical-detail/some-id")
    assert r.status_code == 403


def test_canonical_detail_404_for_unknown_id(client):
    _login(client, role="admin")
    r = client.get("/api/patterns/admin/canonical-detail/does-not-exist")
    assert r.status_code == 404


def test_canonical_detail_ok_for_admin_returns_geometry_and_explanation_together(client):
    detection_id = _stored_htf_id()
    _login(client, role="admin")
    r = client.get(f"/api/patterns/admin/canonical-detail/{detection_id}")
    assert r.status_code == 200
    body = r.json()
    assert body["detection_id"] == detection_id
    assert body["pattern_id"] == "high_tight_flag"
    assert body["source"] == "canonical_db_read"
    assert body["geometry"]["anchor_roles"] == [
        "pole_base", "pole_top", "flag_low", "flag_high",
    ]
    sections = {s["section"] for s in body["explanation"]["sections"]}
    assert "why_it_matched" in sections
    assert body["eligibility"] is not None
