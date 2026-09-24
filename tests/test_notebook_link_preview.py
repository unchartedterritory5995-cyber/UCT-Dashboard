"""Wave 6 lane D item 6 -- GET /api/j2/link-preview (api/routers/notebook_link_preview.py).

The route fetches a page a member typed, so most of these rails are about
where it will NOT go and what it will NOT carry. No live network anywhere:
the page is an httpx.MockTransport, and DNS is the shared guard's own seam
(`providers.base._resolve_host`) -- patching THAT seam is also the proof that
the route runs the one shared guard rather than a copy of it.
"""

from __future__ import annotations

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user
from api.routers import notebook_link_preview as lp
from api.services.journal_two.note_connectors.providers import base as guard_base

PUBLIC = ["93.184.216.34"]

PAGE = b"""<!doctype html><html><head>
<meta charset="utf-8">
<title>Fallback title</title>
<meta property="og:title" content="NVDA prints a record quarter">
<meta property="og:description" content="Data-centre revenue beat by   a mile.">
<meta property="og:image" content="/img/card.png">
<meta name="description" content="plain description">
</head><body><p>body text never read</p></body></html>"""


class Recorder:
    def __init__(self, routes):
        self.routes = routes
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        answer = self.routes.get(str(request.url))
        if answer is None:
            return httpx.Response(404, text="nope")
        return answer(request) if callable(answer) else answer


def html(body: bytes = PAGE, **headers) -> httpx.Response:
    return httpx.Response(200, content=body, headers={"content-type": "text/html; charset=utf-8", **headers})


@pytest.fixture()
def rig(monkeypatch):
    lp._cache.clear()
    state = {"addrs": PUBLIC, "rec": Recorder({})}

    async def fake_resolve(host):
        return list(state["addrs"])

    monkeypatch.setattr(guard_base, "_resolve_host", fake_resolve)
    monkeypatch.setattr(lp, "_transport", lambda: httpx.MockTransport(state["rec"]))
    app = FastAPI()
    app.include_router(lp.router)
    app.dependency_overrides[get_current_user] = lambda: {"id": "u1", "email": "m@example.com"}
    state["client"] = TestClient(app)
    yield state
    lp._cache.clear()


def get(rig, url):
    return rig["client"].get("/api/j2/link-preview", params={"url": url})


def test_a_page_becomes_four_strings_from_its_open_graph_tags(rig):
    rig["rec"].routes = {"https://news.example.com/a": html()}
    r = get(rig, "https://news.example.com/a")
    assert r.status_code == 200, r.text
    assert r.json() == {
        "url": "https://news.example.com/a",
        "title": "NVDA prints a record quarter",
        "description": "Data-centre revenue beat by a mile.",
        "domain": "news.example.com",
        "image": "https://news.example.com/img/card.png",
    }


def test_without_open_graph_it_reads_the_title_and_the_meta_description(rig):
    page = b"<html><head><title> Plain  page </title><meta name='description' content='Just words.'></head></html>"
    rig["rec"].routes = {"https://www.example.org/p": html(page)}
    body = get(rig, "https://www.example.org/p").json()
    assert (body["title"], body["description"], body["domain"], body["image"]) == \
        ("Plain page", "Just words.", "example.org", None)


def test_a_non_https_image_is_dropped_never_rendered(rig):
    page = b"<html><head><meta property='og:title' content='T'><meta property='og:image' content='http://cdn.example.com/x.png'></head></html>"
    rig["rec"].routes = {"https://example.com/i": html(page)}
    assert get(rig, "https://example.com/i").json()["image"] is None


def test_long_fields_are_clamped(rig):
    page = b"<html><head><meta property='og:title' content='" + b"A" * 900 + b"'></head></html>"
    rig["rec"].routes = {"https://example.com/l": html(page)}
    title = get(rig, "https://example.com/l").json()["title"]
    assert len(title) == lp.TITLE_MAX and title.endswith("…")


# ── where it will not go ────────────────────────────────────────────────────

def test_a_host_resolving_to_a_private_address_is_refused_before_any_request(rig):
    rig["addrs"] = ["10.0.0.5"]
    rig["rec"].routes = {"https://intranet.example.com/": html()}
    r = get(rig, "https://intranet.example.com/")
    assert r.status_code == 422
    assert rig["rec"].requests == []


def test_the_cloud_metadata_address_is_refused(rig):
    r = get(rig, "https://169.254.169.254/latest/meta-data/")
    assert r.status_code == 422
    assert rig["rec"].requests == []


def test_a_redirect_to_a_private_host_is_refused_before_the_second_request(rig, monkeypatch):
    async def resolve(host):
        return ["127.0.0.1"] if host == "evil.internal" else PUBLIC

    monkeypatch.setattr(guard_base, "_resolve_host", resolve)
    rig["rec"].routes = {"https://short.example.com/x": httpx.Response(302, headers={"location": "https://evil.internal/admin"})}
    r = get(rig, "https://short.example.com/x")
    assert r.status_code == 422
    assert [str(q.url) for q in rig["rec"].requests] == ["https://short.example.com/x"]


def test_plain_http_gets_no_preview_and_no_request(rig):
    rig["rec"].routes = {"http://example.com/": html()}
    r = get(rig, "http://example.com/")
    assert r.status_code == 422
    assert r.json()["detail"] == "Only secure (https) links get a preview card."
    assert rig["rec"].requests == []


@pytest.mark.parametrize("bad", ["javascript:alert(1)", "file:///etc/passwd", "ftp://example.com/x", "not a url"])
def test_anything_but_a_web_link_is_refused(rig, bad):
    assert get(rig, bad).status_code == 400
    assert rig["rec"].requests == []


def test_a_link_carrying_credentials_is_refused(rig):
    r = get(rig, "https://user:pw@example.com/")
    assert r.status_code == 422
    assert rig["rec"].requests == []


# ── what it will not carry, and how much it will read ───────────────────────

def test_no_cookie_set_by_a_redirect_hop_reaches_the_next_request(rig):
    rig["rec"].routes = {
        "https://a.example.com/": httpx.Response(302, headers={
            "location": "https://a.example.com/final", "set-cookie": "sid=secret; Path=/"}),
        "https://a.example.com/final": html(),
    }
    assert get(rig, "https://a.example.com/").status_code == 200
    assert len(rig["rec"].requests) == 2
    assert all("cookie" not in q.headers for q in rig["rec"].requests)


def test_the_client_neither_trusts_the_environment_nor_follows_redirects_itself():
    client = lp._make_client()
    try:
        assert client.follow_redirects is False
        assert client.timeout.read == lp.TIMEOUT_S
        assert client._trust_env is False
    finally:
        import asyncio
        asyncio.run(client.aclose())


def test_a_body_past_the_cap_is_refused_not_truncated(rig, monkeypatch):
    monkeypatch.setattr(lp, "MAX_BYTES", 256)
    big = b"<html><head><meta property='og:title' content='T'></head><body>" + b"x" * 4096 + b"</body></html>"
    rig["rec"].routes = {"https://example.com/big": html(big)}
    assert get(rig, "https://example.com/big").status_code == 422


def test_a_page_that_times_out_is_a_gateway_answer_not_a_crash(rig):
    def slow(request):
        raise httpx.ReadTimeout("slow", request=request)

    rig["rec"].routes = {"https://example.com/slow": slow}
    assert get(rig, "https://example.com/slow").status_code == 502


def test_not_a_web_page_is_refused_even_when_its_bytes_look_like_one(rig):
    rig["rec"].routes = {"https://example.com/data.json": httpx.Response(
        200, content=b"<html><head><title>Looks like a page</title></head></html>",
        headers={"content-type": "application/json"})}
    r = get(rig, "https://example.com/data.json")
    assert r.status_code == 422
    assert r.json()["detail"] == "That link is not a web page."


def test_a_page_naming_nothing_is_no_preview(rig):
    rig["rec"].routes = {"https://example.com/empty": html(b"<html><head></head><body>hi</body></html>")}
    assert get(rig, "https://example.com/empty").status_code == 422


def test_an_upstream_error_is_a_gateway_answer(rig):
    rig["rec"].routes = {"https://example.com/gone": httpx.Response(500, text="boom")}
    assert get(rig, "https://example.com/gone").status_code == 502


# ── cached, and signed-in only ──────────────────────────────────────────────

def test_the_same_link_twice_costs_one_fetch(rig):
    rig["rec"].routes = {"https://news.example.com/a": html()}
    first = get(rig, "https://news.example.com/a").json()
    second = get(rig, "https://news.example.com/a").json()
    assert first == second
    assert len(rig["rec"].requests) == 1


def test_a_refusal_is_cached_too(rig):
    rig["rec"].routes = {"https://example.com/f.pdf": httpx.Response(
        200, content=b"%PDF", headers={"content-type": "application/pdf"})}
    assert get(rig, "https://example.com/f.pdf").status_code == 422
    assert get(rig, "https://example.com/f.pdf").status_code == 422
    assert len(rig["rec"].requests) == 1


def test_signed_out_is_401(monkeypatch):
    app = FastAPI()
    app.include_router(lp.router)
    r = TestClient(app).get("/api/j2/link-preview", params={"url": "https://example.com/"})
    assert r.status_code == 401
