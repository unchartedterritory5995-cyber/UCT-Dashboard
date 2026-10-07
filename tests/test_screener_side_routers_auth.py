"""The paywall rail for the two screener side routers that `test_screener_backtest_auth`'s
census found ungoverned (2026-10-05): `screen_promote.py` (to-watchlist, spec alerts) and
`screener_nl.py` (plain-English compile).

Every route is swept with its feature switch ARMED, so the 404 dark gate cannot hide the
paid gate: an anonymous caller gets 401 and a free member gets 402, on every method of every
route the module mounts. The route list is read off each router, never typed, so a route
added tomorrow is swept the day it lands.
"""
from __future__ import annotations

import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
from api.routers import screen_promote, screener_nl

FREE_USER = {"id": "free1", "role": "member", "plan": "free"}
MODULES = [screen_promote, screener_nl]


def _client(mod, user):
    app = FastAPI()
    app.include_router(mod.router)
    # Every route dependency that is NOT the paid chain is a feature switch (a 404 when off).
    # They are turned off by override -- not by patching module names, which FastAPI captured
    # at decoration -- so the sweep measures the paid gate and nothing else.
    for r in mod.router.routes:
        for d in getattr(getattr(r, "dependant", None), "dependencies", []):
            if d.call is not mod.require_paid:
                app.dependency_overrides[d.call] = lambda: None
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: dict(user)
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app)


def _sweep(mod):
    out = []
    for r in mod.router.routes:
        for m in sorted((getattr(r, "methods", None) or set()) - {"HEAD", "OPTIONS"}):
            out.append((m, re.sub(r"\{\w+\}", "x1", r.path)))
    return out


@pytest.mark.parametrize("mod", MODULES, ids=lambda m: m.__name__.rsplit(".", 1)[-1])
def test_every_route_is_swept(mod):
    pairs = _sweep(mod)
    assert pairs, f"{mod.__name__} mounts no routes -- the sweep would be vacuous"
    assert all(p.startswith("/api/screener/") for _, p in pairs)


@pytest.mark.parametrize("mod", MODULES, ids=lambda m: m.__name__.rsplit(".", 1)[-1])
@pytest.mark.parametrize("user,expected", [(None, 401), (FREE_USER, 402)], ids=["anonymous", "free"])
def test_an_unpaid_caller_is_refused_on_every_route(mod, user, expected):
    client = _client(mod, user)
    for method, path in _sweep(mod):
        resp = client.request(method, path, json={})
        assert resp.status_code == expected, (
            f"{method} {path} answered {resp.status_code} to a {'anonymous' if user is None else 'free'} "
            f"caller -- expected {expected}: {resp.text[:200]}")
