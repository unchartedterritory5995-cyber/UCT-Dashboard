"""chart-renderer service (services/chart_renderer/app.py): request gating.

The browser itself is not exercised here — `render_png` is stubbed — so these
pin what must hold BEFORE a browser is ever touched: the shared secret, the
host allowlist, https-only, the response shape, and the failure statuses.
"""
from __future__ import annotations

import importlib.util
import pathlib

import pytest

_APP = pathlib.Path(__file__).resolve().parents[1] / "services" / "chart_renderer" / "app.py"


def _load(monkeypatch, secret="s3cret"):
    monkeypatch.setenv("CHART_RENDERER_SECRET", secret)
    monkeypatch.setenv("RENDER_ALLOWED_HOSTS", "uctintelligence.com, web-production-05cb6.up.railway.app")
    spec = importlib.util.spec_from_file_location("chart_renderer_app", _APP)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _client(mod):
    from fastapi.testclient import TestClient
    return TestClient(mod.app)


def test_render_requires_the_secret_and_an_allowlisted_https_host(monkeypatch):
    mod = _load(monkeypatch)
    calls = []

    async def fake_render(req):
        calls.append(req)
        return b"\x89PNG\r\n\x1a\nfake"
    monkeypatch.setattr(mod, "render_png", fake_render)
    c = _client(mod)
    body = {"url": "https://uctintelligence.com/r/chart?sym=NVDA&tf=D"}

    assert c.post("/render", json=body).status_code == 401
    assert c.post("/render", json=body, headers={"X-Render-Secret": "wrong"}).status_code == 401
    assert c.post("/render", json={"url": "http://uctintelligence.com/r/chart"},
                  headers={"X-Render-Secret": "s3cret"}).status_code == 400
    assert c.post("/render", json={"url": "https://evil.example/r/chart"},
                  headers={"X-Render-Secret": "s3cret"}).status_code == 400
    assert calls == []

    r = c.post("/render", json={**body, "scale": 2, "width": 1336, "height": 710},
               headers={"X-Render-Secret": "s3cret"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("image/png")
    assert r.content.startswith(b"\x89PNG")
    assert len(calls) == 1 and calls[0].scale == 2 and calls[0].selector == "#chart-export"


def test_render_reports_a_browser_failure_as_502_and_missing_selector_as_422(monkeypatch):
    mod = _load(monkeypatch)
    c = _client(mod)
    hdr = {"X-Render-Secret": "s3cret"}
    body = {"url": "https://uctintelligence.com/r/chart?sym=NVDA"}

    async def boom(req):
        raise RuntimeError("chromium died")
    monkeypatch.setattr(mod, "render_png", boom)
    assert c.post("/render", json=body, headers=hdr).status_code == 502

    async def missing(req):
        raise mod.HTTPException(422, "selector not found")
    monkeypatch.setattr(mod, "render_png", missing)
    assert c.post("/render", json=body, headers=hdr).status_code == 422


def test_unconfigured_secret_is_503_and_health_is_open(monkeypatch):
    mod = _load(monkeypatch, secret="")
    c = _client(mod)
    assert c.post("/render", json={"url": "https://uctintelligence.com/x"},
                  headers={"X-Render-Secret": "anything"}).status_code == 503
    h = c.get("/health")
    assert h.status_code == 200 and h.json()["ok"] is True and "uctintelligence.com" in h.json()["allowed"]


def test_request_bounds_are_enforced(monkeypatch):
    mod = _load(monkeypatch)
    c = _client(mod)
    hdr = {"X-Render-Secret": "s3cret"}
    r = c.post("/render", json={"url": "https://uctintelligence.com/r/chart", "scale": 9}, headers=hdr)
    assert r.status_code == 422
    r = c.post("/render", json={"url": "https://uctintelligence.com/r/chart", "width": 10}, headers=hdr)
    assert r.status_code == 422
