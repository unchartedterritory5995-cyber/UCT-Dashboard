"""The web → chart-renderer handoff: who mints the capability, and where it may appear.

⛔⛔ THE TRUST IS IN THE INVOCATION, NOT THE ROUTE. `/r/chart` is a PUBLIC page —
anyone can load it in their own browser. So the capability is minted by the
BACKEND that decided to render, and it must never be reachable by simply asking
for the page. That is what separates "the renderer is trusted" from "anything
that looks like the renderer is trusted".
"""
from __future__ import annotations

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api import chart_edge_token as cet  # noqa: E402
from api.services import discord_chart_house as house  # noqa: E402

SECRET = "handoff-test-edge-secret"
HEADER = "X-Chart-Edge-Token"


class _Resp:
    """A deliberately failing render response: this file tests the HANDOFF, and
    the request is captured before any of the image validation runs."""
    status_code = 502
    is_success = False
    content = b"not-a-png"
    text = "render failed"
    headers: dict = {}


class _Client:
    def __init__(self):
        self.calls = []

    def post(self, url, json=None, headers=None, **kw):
        self.calls.append({"url": url, "json": json, "headers": dict(headers or {})})
        return _Resp()

    def close(self):
        pass


@pytest.fixture
def render_env(monkeypatch):
    monkeypatch.setenv("CHART_EDGE_SECRET", SECRET)
    monkeypatch.delenv("CHART_EDGE_RENDER_TOKEN_TTL_SECONDS", raising=False)
    monkeypatch.setenv("CHART_RENDERER_URL", "http://chart-renderer.internal:8080")
    monkeypatch.setenv("CHART_RENDERER_SECRET", "render-secret")
    monkeypatch.setenv("CHART_RENDER_TOKEN", "render-page-token")
    monkeypatch.setenv("CHART_RENDER_BASE_URL", "https://uctintelligence.com")


def _render(client):
    house.render_house_chart("AAPL", "D", None, client=client)
    assert client.calls, "no render was attempted"
    return client.calls[0]


# ── the capability is minted and travels as a header ────────────────────────

def test_the_trusted_render_call_CARRIES_a_service_capability(render_env):
    call = _render(_Client())
    tok = call["headers"].get(HEADER)
    assert tok, f"no {HEADER} on the render request"
    cls, payload = cet.verify(tok, expect=cet.ENTITLEMENT_SERVICE)
    assert cls == "VALID"
    assert payload["ent"] == cet.ENTITLEMENT_SERVICE


def test_the_capability_is_SHORT_LIVED(render_env):
    call = _render(_Client())
    _cls, payload = cet.verify(call["headers"][HEADER], expect=cet.ENTITLEMENT_SERVICE)
    assert payload["exp"] - payload["iat"] == cet.DEFAULT_RENDER_TTL_SECONDS


def test_the_existing_render_secret_is_UNDISTURBED(render_env):
    """⭐ The renderer's own `X-Render-Secret` gate is what proves the caller is
    the trusted backend in the first place. Phase 1.5 rides beside it, never
    instead of it."""
    call = _render(_Client())
    assert call["headers"].get("X-Render-Secret") == "render-secret"


# ── …and nowhere else ───────────────────────────────────────────────────────

def test_the_capability_is_NOT_IN_THE_PAGE_URL(render_env):
    """⛔⛔ A URL is the worst place for a credential: it lands in the renderer's
    logs, in the Worker's logs, in the browser's history, and — the reason this
    matters most here — in any CACHE KEY on the path. The renderer's own error
    path already quotes the page URL back (it is scrubbed for exactly this
    reason), so a token there would be echoed on every failed render."""
    call = _render(_Client())
    tok = call["headers"][HEADER]
    assert tok not in call["json"]["url"]
    assert "edge" not in call["json"]["url"].lower()


def test_the_capability_is_NOT_IN_THE_REQUEST_BODY(render_env):
    """The body is echoed in error paths and logged; the header is not."""
    call = _render(_Client())
    tok = call["headers"][HEADER]
    assert tok not in json.dumps(call["json"])


def test_the_SECRET_ITSELF_never_travels(render_env):
    call = _render(_Client())
    blob = json.dumps(call["json"]) + json.dumps(call["headers"]) + call["url"]
    assert SECRET not in blob, "the signing secret left the web pod"


def test_the_capability_is_not_a_MEMBER_token(render_env):
    """⛔ A render capability must not open a member session if it leaks."""
    call = _render(_Client())
    assert cet.verify(call["headers"][HEADER], expect=cet.ENTITLEMENT_BARS)[0] == "INVALID"


# ── failure modes ───────────────────────────────────────────────────────────

def test_NO_SECRET_still_renders_without_a_capability(render_env, monkeypatch):
    """⚠️ SHADOW-SAFE: with no signing key the render proceeds and simply
    classifies MISSING at the edge. An unconfigured secret must never cost an
    image — it becomes load-bearing only at enforcement."""
    monkeypatch.delenv("CHART_EDGE_SECRET", raising=False)
    call = _render(_Client())
    assert HEADER not in call["headers"]
    assert call["json"]["url"]        # the render still went out


def test_a_MINTING_FAILURE_cannot_break_a_render(render_env, monkeypatch):
    monkeypatch.setattr(cet, "mint_service",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    call = _render(_Client())
    assert HEADER not in call["headers"]
    assert call["json"]["url"]


# ── the public page earns nothing ───────────────────────────────────────────

def test_ASKING_FOR_THE_PAGE_MINTS_NOTHING():
    """⛔⛔ THE WHOLE POINT, STATED AS A RAIL. `/r/chart` is public. Building its
    URL — which is all a stranger can do — produces no capability of any kind.
    Only `render_house_chart`, the backend-to-renderer invocation, mints one.
    """
    url = house.build_render_url("AAPL", "D", None,
                                 base_url="https://uctintelligence.com",
                                 token="render-page-token", options={})
    assert "edge" not in url.lower()
    assert cet.ENTITLEMENT_SERVICE not in url
    # and the page URL is the ONLY thing the renderer is told to navigate to
    assert url.startswith("https://uctintelligence.com/r/chart")
