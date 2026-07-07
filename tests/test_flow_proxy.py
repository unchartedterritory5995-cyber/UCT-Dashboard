"""P5 flow reverse-proxy (api/flow_proxy.py).

Covers the make-or-break correctness properties:
- /api/live/massive is proxied but /api/live (Bullflow) is NOT captured.
- every flow prefix + its sub-paths route to the forwarder.
- the forward preserves method/path/query, strips hop-by-hop headers, and
  streams the worker's body back with its status.
- an upstream failure surfaces 502 (never a silent stale local response).
"""
import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from api import flow_proxy


class _FakeResp:
    def __init__(self, status=200, body=b"WORKER_BODY", headers=None):
        self.status_code = status
        self._body = body
        self.headers = headers or {"content-type": "application/json",
                                   "content-encoding": "gzip",  # must be stripped
                                   "content-length": "999"}
        self.closed = False

    async def aiter_bytes(self):
        yield self._body

    async def aclose(self):
        self.closed = True


class _FakeClient:
    """Records the forwarded request and returns a canned worker response."""
    def __init__(self, resp=None, raise_on_send=False):
        self._resp = resp or _FakeResp()
        self._raise = raise_on_send
        self.built = None

    def build_request(self, method, url, headers=None, content=None):
        self.built = {"method": method, "url": url, "headers": headers or {},
                      "content": content}
        return self.built

    async def send(self, request, stream=True):
        if self._raise:
            raise ConnectionError("worker unreachable")
        return self._resp


@pytest.fixture
def proxy_app(monkeypatch):
    """A FastAPI app with ONLY the proxy router mounted + a fake worker."""
    monkeypatch.setattr(flow_proxy, "WORKER_INTERNAL_URL", "http://worker.railway.internal:8080")
    fake = _FakeClient()
    monkeypatch.setattr(flow_proxy, "_get_client", lambda: fake)
    app = FastAPI()
    app.include_router(flow_proxy.build_flow_proxy_router())
    client = TestClient(app)
    return client, fake


def test_massive_prefix_is_proxied_but_bare_live_is_not(proxy_app):
    client, fake = proxy_app
    # /api/live/massive/* is a registered proxy route -> forwards.
    r = client.get("/api/live/massive/status")
    assert r.status_code == 200 and r.content == b"WORKER_BODY"
    # /api/live/* (Bullflow) is NOT in the proxy set -> no route on this app.
    r2 = client.get("/api/live/alerts/recent")
    assert r2.status_code == 404


@pytest.mark.parametrize("path", [
    "/api/flow/data", "/api/flow/version", "/api/flow-scoreboard",
    "/api/flow-explain", "/api/flow-reconcile", "/api/flow-reconcile/run",
    "/api/darkpool/recent", "/api/dealer-positioning",
    "/api/notable-flow", "/api/top-flow", "/api/oi-snapshot/x", "/api/liveflow/consumer-state",
])
def test_all_flow_prefixes_route_to_worker(proxy_app, path):
    client, fake = proxy_app
    r = client.get(path)
    assert r.status_code == 200
    # forwarded to the worker at the SAME path
    assert fake.built["url"] == "http://worker.railway.internal:8080" + path


def test_query_string_and_method_preserved(proxy_app):
    client, fake = proxy_app
    r = client.post("/api/flow/upload?source=stocks", content=b"csvdata")
    assert r.status_code == 200
    assert fake.built["method"] == "POST"
    assert fake.built["url"].endswith("/api/flow/upload?source=stocks")
    assert fake.built["content"] == b"csvdata"


def test_hop_by_hop_headers_stripped_from_forward(proxy_app):
    client, fake = proxy_app
    client.get("/api/flow/data", headers={"host": "uctintelligence.com",
                                          "x-keep": "yes"})
    fwd = {k.lower() for k in fake.built["headers"]}
    assert "host" not in fwd and "content-length" not in fwd
    assert "x-keep" in fwd  # non-hop headers pass through


def test_response_encoding_headers_stripped(proxy_app):
    client, fake = proxy_app
    r = client.get("/api/flow/data")
    # content-encoding from the worker must NOT be echoed (body is decoded;
    # web's own gzip re-compresses). Framing headers likewise dropped.
    assert "content-encoding" not in {k.lower() for k in r.headers}


def test_upstream_failure_returns_502_not_stale(monkeypatch):
    monkeypatch.setattr(flow_proxy, "WORKER_INTERNAL_URL", "http://worker.railway.internal:8080")
    monkeypatch.setattr(flow_proxy, "_get_client", lambda: _FakeClient(raise_on_send=True))
    app = FastAPI()
    app.include_router(flow_proxy.build_flow_proxy_router())
    r = TestClient(app, raise_server_exceptions=False).get("/api/flow/data")
    assert r.status_code == 502


def test_missing_worker_url_returns_503(monkeypatch):
    monkeypatch.setattr(flow_proxy, "WORKER_INTERNAL_URL", "")
    app = FastAPI()
    app.include_router(flow_proxy.build_flow_proxy_router())
    r = TestClient(app, raise_server_exceptions=False).get("/api/flow/data")
    assert r.status_code == 503


def test_prefixes_are_segment_precise():
    # /api/live must NOT be a prefix (would capture Bullflow); /api/live/massive must be.
    assert "/api/live/massive" in flow_proxy.PROXY_PREFIXES
    assert "/api/live" not in flow_proxy.PROXY_PREFIXES
