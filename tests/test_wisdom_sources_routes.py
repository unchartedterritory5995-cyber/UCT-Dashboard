"""Wisdom sources routes on the REAL app (stream S-C, CONTRACTS.md §2.1 / §6.3).

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a sources route unmounted from api.main:app, or mounted without its gate;
2. an admin route answering an anonymous caller or a member;
3. the machine route answering without the PUSH_SECRET bearer — including when
   PUSH_SECRET is blank (a blank secret must refuse everybody);
4. long work running on the request path instead of a daemon thread, or two
   backfills overlapping in one process.
Imports api.main — run through the box heavy lock.
"""
from __future__ import annotations

import threading

import pytest

from api.services.wisdom.core import store

ADMIN_PATHS = {
    ("GET", "/api/admin/wisdom/sources/discord/status"),
    ("POST", "/api/admin/wisdom/sources/discord/backfill"),
    ("GET", "/api/admin/wisdom/sources/sunday-scans/verify"),
    ("GET", "/api/admin/wisdom/sources/transcripts/coverage"),
}
INTERNAL = ("POST", "/api/internal/wisdom/sources/discord/legacy-ids")
TSDR_CH = "882459873823043655"


@pytest.fixture(scope="module")
def real_app():
    from api.main import app

    return app


@pytest.fixture
def wisdom_db(tmp_path, monkeypatch):
    for var in ("DATA_SYNC_ENDPOINT_URL", "DATA_SYNC_ACCESS_KEY", "DATA_SYNC_SECRET_KEY", "DATA_SYNC_BUCKET"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()


@pytest.fixture
def client(real_app):
    from fastapi.testclient import TestClient

    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan

    for dep in (get_current_user, get_current_user_with_plan):
        real_app.dependency_overrides.pop(dep, None)
    return TestClient(real_app, raise_server_exceptions=False)


def _route(app, method, path):
    for r in app.routes:
        if getattr(r, "path", "") == path and method in (getattr(r, "methods", None) or set()):
            return r
    return None


def _dep_names(route) -> set:
    names, stack = set(), [route.dependant]
    while stack:
        d = stack.pop()
        if d.call is not None:
            names.add(getattr(d.call, "__name__", ""))
        stack.extend(d.dependencies)
    return names


def test_every_sources_route_is_mounted_with_its_gate(real_app):
    for method, path in ADMIN_PATHS:
        route = _route(real_app, method, path)
        assert route is not None, (method, path)
        assert "require_admin" in _dep_names(route), path
    internal = _route(real_app, *INTERNAL)
    assert internal is not None and "require_push_secret" in _dep_names(internal)
    # control: the dependency reader can see that a gate is ABSENT
    assert "require_push_secret" not in _dep_names(_route(real_app, "GET", "/api/admin/wisdom/sources/discord/status"))


def test_admin_routes_refuse_anonymous_callers_and_members(real_app, client, wisdom_db):
    from tests.authclients import FREE_MEMBER, signed_in_as

    for method, path in ADMIN_PATHS:
        assert client.request(method, path).status_code == 401, path
    with signed_in_as(FREE_MEMBER, real_app):
        for method, path in ADMIN_PATHS:
            assert client.request(method, path).status_code == 403, path


def test_an_admin_reads_status_and_coverage_without_any_text(real_app, client, wisdom_db):
    from tests.authclients import ADMIN, signed_in_as

    with signed_in_as(ADMIN, real_app):
        status = client.get("/api/admin/wisdom/sources/discord/status")
        coverage = client.get("/api/admin/wisdom/sources/transcripts/coverage")
        verify = client.get("/api/admin/wisdom/sources/sunday-scans/verify")
    from api.services.wisdom.sources import discord as dc

    # Derived, not hardcoded: the in-scope set grew from 4 to 24 in session 28
    # (2026-09-19, Jersace/Main Chat/Setup Examples) and will keep moving.
    assert status.status_code == 200 and len(status.json()["channels"]) == len(dc.in_scope_channel_ids())
    assert coverage.status_code == 200 and coverage.json()["threshold"] == 0.98
    assert verify.status_code == 200 and verify.json()["started"] is False  # no limit, nothing starts


def test_backfill_honours_the_gate_runs_off_the_request_path_and_never_overlaps(real_app, client, wisdom_db,
                                                                               monkeypatch):
    from api.services.wisdom.sources import discord
    from tests.authclients import ADMIN, signed_in_as

    release, entered, calls = threading.Event(), threading.Event(), []

    def slow_tick(**kwargs):
        calls.append(kwargs)
        entered.set()
        release.wait(5)
        return {"outcome": "ok", "channels": []}

    monkeypatch.setattr(discord, "tick", slow_tick)
    monkeypatch.delenv("WISDOM_DISCORD_LISTENER_ENABLED", raising=False)
    with signed_in_as(ADMIN, real_app):
        assert client.post("/api/admin/wisdom/sources/discord/backfill").status_code == 409  # gate off
        first = client.post("/api/admin/wisdom/sources/discord/backfill?force=true&max_pages=12")
        assert first.status_code == 200 and first.json()["started"] is True
        assert entered.wait(5)
        assert client.post("/api/admin/wisdom/sources/discord/backfill?force=true").status_code == 409  # overlap
        release.set()
    assert calls[0]["page_budget"] == 12


class _Req:
    def __init__(self, auth: str):
        self.headers = {"authorization": auth}


def test_require_push_secret_admits_only_the_exact_bearer(monkeypatch):
    """Unit-level twin of the route test below (no api.main import), so the gate can be
    mutation-checked cheaply."""
    from fastapi import HTTPException

    from api.routers.wisdom_sources import require_push_secret

    monkeypatch.setenv("PUSH_SECRET", "s3cret-test")
    assert require_push_secret(_Req("Bearer s3cret-test")) is None  # control: the right bearer passes
    for auth in ("", "Bearer wrong", "bearer s3cret-test", "Bearer s3cret-test ", "Bearer sécret"):
        with pytest.raises(HTTPException) as refused:
            require_push_secret(_Req(auth))
        assert refused.value.status_code == 401, auth
    monkeypatch.setenv("PUSH_SECRET", "")
    with pytest.raises(HTTPException):
        require_push_secret(_Req("Bearer "))


def test_the_machine_route_requires_the_push_secret(client, wisdom_db, monkeypatch):
    path = INTERNAL[1]
    body = {"channel_id": TSDR_CH, "message_ids": ["1400000000000000000", "1400000000004194304"]}
    monkeypatch.setenv("PUSH_SECRET", "s3cret-test")
    assert client.post(path, json=body).status_code == 401
    assert client.post(path, json=body, headers={"Authorization": "Bearer wrong"}).status_code == 401
    ok = client.post(path, json=body, headers={"Authorization": "Bearer s3cret-test"})
    assert ok.status_code == 200 and ok.json()["inserted"] == 2
    # #main-chat (1216816863313657886) was out of scope until session 28 (2026-09-19)
    # added it for AtTheAsk; #alex-jones stays out of scope by owner ruling the same
    # session ("doesn't really bring much value") -- still a valid out-of-scope fixture.
    bad_channel = client.post(path, json={**body, "channel_id": "1216760919254892545"},
                              headers={"Authorization": "Bearer s3cret-test"})
    assert bad_channel.status_code == 422
    monkeypatch.setenv("PUSH_SECRET", "")
    assert client.post(path, json=body, headers={"Authorization": "Bearer "}).status_code == 401
