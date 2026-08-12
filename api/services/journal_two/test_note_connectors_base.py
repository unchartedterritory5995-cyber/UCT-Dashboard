"""Tests for `note_connectors.providers.base`'s shared SSRF guard
(final-review Item D: "media-fetch SSRF guard on a LIVE provider").

`assert_public_https`/`guarded_media_get` are the shared functions every
provider's `fetch_media` now routes a content-controlled `ref` through
before issuing a request (see `test_note_connectors_roam.py`,
`test_note_connectors_dropbox.py`, `test_note_connectors_craft.py`,
`test_note_connectors_notion.py` for the per-provider integration tests).
This file tests the guard directly, at the unit level, including cases no
single provider's own test suite exercises end-to-end (a hostname that
LOOKS public but resolves, via DNS, to a private address).

No live calls anywhere: `_resolve_host` (the one seam that would otherwise
make this file do a real DNS lookup) is monkeypatched in every test that
takes the non-literal-IP hostname path.
"""

from __future__ import annotations

import httpx
import pytest

from api.services.journal_two.note_connectors.errors import (
    NoteConnTransient,
    NoteConnUnsupported,
)
from api.services.journal_two.note_connectors.providers import base as base_module
from api.services.journal_two.note_connectors.providers.base import (
    assert_public_https,
    guarded_media_get,
)


async def _fake_resolve_host(addrs: list[str]) -> list[str]:
    return addrs


def _stub_resolver(monkeypatch, addrs: list[str]) -> None:
    monkeypatch.setattr(base_module, "_resolve_host", lambda host: _fake_resolve_host(addrs))


# ---------------------------------------------------------------------------
# assert_public_https — scheme + literal-IP checks (no DNS involved)
# ---------------------------------------------------------------------------


async def test_refuses_plain_http():
    with pytest.raises(NoteConnUnsupported):
        await assert_public_https("http://example.com/img.png")


async def test_refuses_a_scheme_other_than_https():
    with pytest.raises(NoteConnUnsupported):
        await assert_public_https("ftp://example.com/img.png")


async def test_refuses_a_url_with_no_host():
    with pytest.raises(NoteConnUnsupported):
        await assert_public_https("https:///img.png")


@pytest.mark.parametrize(
    "url",
    [
        "https://127.0.0.1/img.png",           # loopback
        "https://127.5.5.5/img.png",            # loopback range, not just .1
        "https://10.1.2.3/img.png",             # RFC1918 private
        "https://172.16.0.5/img.png",           # RFC1918 private
        "https://192.168.1.1/img.png",          # RFC1918 private
        "https://169.254.169.254/latest/meta-data/",  # cloud metadata endpoint
        "https://0.0.0.0/img.png",              # unspecified
        "https://[::1]/img.png",                # IPv6 loopback
        "https://[fe80::1]/img.png",             # IPv6 link-local
        "https://[fc00::1]/img.png",             # IPv6 unique-local (private)
    ],
)
async def test_refuses_loopback_private_link_local_and_metadata_literal_ips(url):
    with pytest.raises(NoteConnUnsupported):
        await assert_public_https(url)


async def test_a_literal_public_ip_passes_without_any_dns_lookup(monkeypatch):
    # Deliberately do NOT stub `_resolve_host` -- a literal IP must never
    # even attempt resolution; if it did, this test would hang/fail on a
    # sandboxed box with no DNS egress rather than passing cleanly.
    def boom(host):  # pragma: no cover
        raise AssertionError("must never resolve a literal IP")

    monkeypatch.setattr(base_module, "_resolve_host", boom)
    result = await assert_public_https("https://8.8.8.8/img.png")
    assert result == "https://8.8.8.8/img.png"


# ---------------------------------------------------------------------------
# assert_public_https — hostname resolution (DNS-mediated, stubbed)
# ---------------------------------------------------------------------------


async def test_a_hostname_resolving_to_a_public_address_passes(monkeypatch):
    _stub_resolver(monkeypatch, ["142.250.0.1"])
    result = await assert_public_https("https://cdn.example.com/img.png")
    assert result == "https://cdn.example.com/img.png"


async def test_a_hostname_that_LOOKS_public_but_resolves_to_a_private_address_is_refused(monkeypatch):
    """The whole point of resolving rather than only literal-IP-checking:
    an attacker doesn't need to paste `http://169.254.169.254/...` into a
    note if they can register/control a hostname that resolves there."""
    _stub_resolver(monkeypatch, ["169.254.169.254"])
    with pytest.raises(NoteConnUnsupported):
        await assert_public_https("https://looks-public.example.com/img.png")


async def test_a_hostname_resolving_to_multiple_addresses_is_refused_if_any_one_is_private(monkeypatch):
    _stub_resolver(monkeypatch, ["142.250.0.1", "10.0.0.5"])
    with pytest.raises(NoteConnUnsupported):
        await assert_public_https("https://multi.example.com/img.png")


async def test_dns_resolution_failure_raises_transient_not_unsupported(monkeypatch):
    """A hostname that fails to resolve is a network condition, not proof
    of an unsafe reference -- it gets the taxonomy's "safe to retry"
    treatment, same as any other transient network failure."""
    async def fail(host):
        raise OSError("simulated resolution failure")

    monkeypatch.setattr(base_module, "_resolve_host", fail)
    with pytest.raises(NoteConnTransient):
        await assert_public_https("https://does-not-resolve.example.com/img.png")


# ---------------------------------------------------------------------------
# guarded_media_get — the redirect-safe GET wrapper (roam.py/dropbox.py's
# `follow_redirects=True` precedent, now re-validated hop by hop)
# ---------------------------------------------------------------------------


async def test_guarded_media_get_returns_a_direct_200_unchanged(monkeypatch):
    _stub_resolver(monkeypatch, ["142.250.0.1"])

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"ok")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    response = await guarded_media_get(client, "https://cdn.example.com/img.png")
    assert response.status_code == 200
    assert response.content == b"ok"


async def test_guarded_media_get_follows_a_redirect_to_a_public_host(monkeypatch):
    _stub_resolver(monkeypatch, ["142.250.0.1"])
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        if str(request.url) == "https://a.example.com/img.png":
            return httpx.Response(302, headers={"location": "https://8.8.8.8/final.png"})
        return httpx.Response(200, content=b"final-bytes")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    response = await guarded_media_get(client, "https://a.example.com/img.png")
    assert response.status_code == 200
    assert response.content == b"final-bytes"
    assert calls == ["https://a.example.com/img.png", "https://8.8.8.8/final.png"]


async def test_guarded_media_get_refuses_a_redirect_to_a_private_host_before_the_second_request(monkeypatch):
    _stub_resolver(monkeypatch, ["142.250.0.1"])
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        if str(request.url) == "https://a.example.com/img.png":
            return httpx.Response(302, headers={"location": "http://127.0.0.1:6379/"})
        raise AssertionError("must never reach the redirect target")  # pragma: no cover

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    with pytest.raises(NoteConnUnsupported):
        await guarded_media_get(client, "https://a.example.com/img.png")
    assert calls == ["https://a.example.com/img.png"]


async def test_guarded_media_get_bounds_a_redirect_chain():
    def handler(request: httpx.Request) -> httpx.Response:
        # Every hop points at itself -- an infinite redirect loop.
        return httpx.Response(302, headers={"location": "https://8.8.8.8/img.png"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    with pytest.raises(NoteConnUnsupported):
        await guarded_media_get(client, "https://8.8.8.8/img.png", max_redirects=3)


async def test_guarded_media_get_wraps_a_transport_error_as_transient():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    with pytest.raises(NoteConnTransient):
        await guarded_media_get(client, "https://8.8.8.8/img.png")
