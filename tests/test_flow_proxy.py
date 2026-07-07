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
        # Default: plain body (no content-encoding) so the TestClient doesn't
        # try to gunzip it. The encoding-preservation test passes a real gzip
        # body + content-encoding header explicitly.
        self.headers = headers or {"content-type": "application/json",
                                   "content-length": "999",
                                   "transfer-encoding": "chunked"}  # framing, must be stripped
        self.closed = False

    async def aiter_bytes(self):
        yield self._body

    async def aiter_raw(self):  # proxy now forwards RAW (undecoded) bytes
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
    "/api/flow/data", "/api/flow/version", "/api/flow-gap-fill",
    "/api/flow-backup", "/api/flow-reconcile", "/api/flow-reconcile/run",
    "/api/dealer-positioning", "/api/notable-flow", "/api/oi-snapshot/x",
    "/api/liveflow/consumer-state", "/api/live/massive/status",
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


def test_content_encoding_preserved_framing_stripped(monkeypatch):
    import gzip as _gz
    monkeypatch.setattr(flow_proxy, "WORKER_INTERNAL_URL", "http://worker.railway.internal:8080")
    gzbody = _gz.compress(b'{"ok":true}')
    resp = _FakeResp(headers={"content-type": "application/json",
                              "content-encoding": "gzip",       # must survive
                              "transfer-encoding": "chunked"})   # must be stripped
    resp._body = gzbody
    monkeypatch.setattr(flow_proxy, "_get_client", lambda: _FakeClient(resp))
    app = FastAPI()
    app.include_router(flow_proxy.build_flow_proxy_router())
    r = TestClient(app).get("/api/flow/data")
    hdrs = {k.lower() for k in r.headers}
    # content-encoding preserved (raw pass-through -> web gzip skips, CF cacheable);
    # framing dropped; body decodes back to the original (httpx auto-gunzips).
    assert "content-encoding" in hdrs
    assert "transfer-encoding" not in hdrs
    assert r.json() == {"ok": True}


@pytest.mark.parametrize("path", [
    "/api/darkpool/recent", "/api/top-flow", "/api/top-flow/history",
    "/api/flow-scoreboard", "/api/flow-explain",
])
def test_web_local_prefixes_are_NOT_proxied(proxy_app, path):
    # These have web-local backing stores (darkpool.db, top_flow_picks.json,
    # flow_explain.db) — proxying them would serve an empty worker DB. They must
    # NOT be captured by the proxy router.
    client, fake = proxy_app
    assert client.get(path).status_code == 404


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


def test_web_local_stores_excluded_from_prefixes():
    # Regression guard for the P5 review: prefixes with web-local backing stores
    # must never be proxied.
    for p in ("/api/darkpool", "/api/top-flow", "/api/flow-scoreboard", "/api/flow-explain"):
        assert p not in flow_proxy.PROXY_PREFIXES
