"""The owner-private route on the app the product serves (D16a; CONTRACTS §2.4, §6.2).

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. GET /api/admin/wisdom/core/private/{record_id} unmounted from api.main:app;
2. that route answering anyone but the owner: anonymous (401), a member (403), and above
   all a SECOND ADMIN (403) — require_admin alone admits the team, the smoke account and
   an outside contractor;
3. the owner not getting the decrypted value back, or the response being cacheable;
4. the route serving anything while the key is unset.
The control for 2: the same admin, once named first in ADMIN_EMAILS, is let through, so a
403 above is the owner check and not a broken route.
"""
from __future__ import annotations

import pytest
from cryptography.fernet import Fernet

from api.services.wisdom.core import private, store

ROUTE = "/api/admin/wisdom/core/private/{record_id}"
OWNER = {"id": "owner-test", "email": "owner@example.test", "role": "admin", "plan": "free"}


@pytest.fixture(scope="module")
def real_app():
    from api.main import app

    return app


@pytest.fixture
def seeded(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    monkeypatch.setenv("WISDOM_PRIVATE_DB_PATH", str(tmp_path / "private" / "wisdom_private.db"))
    monkeypatch.setenv("WISDOM_PRIVATE_KEY", Fernet.generate_key().decode())
    monkeypatch.delenv("WISDOM_PRIVATE_KEYS_V1", raising=False)
    store.init_db()
    assert private.put_private("rec-owner-1", "size_shares", 7331, "edu_videos:355@00:36:06")
    return "rec-owner-1"


def test_the_private_route_is_owner_only_on_the_real_app(real_app, seeded, monkeypatch):
    from fastapi.testclient import TestClient

    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
    from tests.authclients import ADMIN, FREE_MEMBER, signed_in_as

    assert ROUTE in {getattr(r, "path", "") for r in real_app.routes}, "the owner-private route is not mounted"
    for dep in (get_current_user, get_current_user_with_plan):
        real_app.dependency_overrides.pop(dep, None)
    monkeypatch.setenv("ADMIN_EMAILS", "owner@example.test, admin@example.test")
    client = TestClient(real_app, raise_server_exceptions=False)
    url = ROUTE.format(record_id=seeded)

    assert client.get(url).status_code == 401
    with signed_in_as(FREE_MEMBER, real_app):
        assert client.get(url).status_code == 403
    with signed_in_as(ADMIN, real_app):
        refused = client.get(url)
        assert refused.status_code == 403, "a second admin reached owner-private data"
        assert "7331" not in refused.text
    with signed_in_as(OWNER, real_app):
        served = client.get(url)
        assert served.status_code == 200, served.text
        body = served.json()
        assert body["count"] == 1 and body["fields"][0]["field"] == "size_shares"
        assert body["fields"][0]["value"] == 7331
        assert "no-store" in served.headers.get("cache-control", "")

    # CONTROL: the very same admin, named first, is the owner. The 403 above was the owner check.
    monkeypatch.setenv("ADMIN_EMAILS", "admin@example.test, owner@example.test")
    with signed_in_as(ADMIN, real_app):
        assert client.get(url).status_code == 200


def test_the_private_route_serves_nothing_while_the_key_is_unset(real_app, seeded, monkeypatch):
    from fastapi.testclient import TestClient

    from tests.authclients import signed_in_as

    monkeypatch.setenv("ADMIN_EMAILS", "owner@example.test")
    client = TestClient(real_app, raise_server_exceptions=False)
    url = ROUTE.format(record_id=seeded)
    with signed_in_as(OWNER, real_app):
        assert client.get(url).status_code == 200  # control: key set
        monkeypatch.delenv("WISDOM_PRIVATE_KEY")
        unset = client.get(url)
    assert unset.status_code == 503 and "7331" not in unset.text
