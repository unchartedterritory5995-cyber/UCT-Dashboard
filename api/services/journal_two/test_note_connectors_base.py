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
    guarded_media_stream,
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


# ---------------------------------------------------------------------------
# guarded_media_stream — STREAMED, size-bounded sibling of guarded_media_get
# (msgraph fix-round-1 Important #2: OneDrive's primary content path must
# never fully buffer an oversized file in memory before checking the cap).
# Mirrors dropbox.py's own `_download_streamed` size-enforcement tests
# (`test_note_connectors_dropbox.py`'s "25MB attachment cap" section) at the
# shared-primitive level, since this function now backs that same guarantee
# for a second provider.
# ---------------------------------------------------------------------------


async def test_guarded_media_stream_returns_a_direct_200_unchanged(monkeypatch):
    _stub_resolver(monkeypatch, ["142.250.0.1"])

    def handler(request: httpx.Request) -> httpx.Response:
        # The stream helper is only ever handed a content-controlled URL
        # with no credential attached -- same contract as guarded_media_get.
        assert request.headers.get("authorization") is None
        return httpx.Response(200, content=b"ok")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    content, response = await guarded_media_stream(
        client, "https://cdn.example.com/img.png", max_bytes=1024,
    )
    assert content == b"ok"
    assert response.status_code == 200


async def test_guarded_media_stream_follows_a_redirect_to_a_public_host(monkeypatch):
    _stub_resolver(monkeypatch, ["142.250.0.1"])
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        assert request.headers.get("authorization") is None
        if str(request.url) == "https://a.example.com/img.png":
            return httpx.Response(302, headers={"location": "https://8.8.8.8/final.png"})
        return httpx.Response(200, content=b"final-bytes")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    content, response = await guarded_media_stream(
        client, "https://a.example.com/img.png", max_bytes=1024,
    )
    assert content == b"final-bytes"
    assert response.status_code == 200
    assert calls == ["https://a.example.com/img.png", "https://8.8.8.8/final.png"]


async def test_guarded_media_stream_refuses_a_redirect_to_a_private_host_before_the_second_request(monkeypatch):
    _stub_resolver(monkeypatch, ["142.250.0.1"])
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        if str(request.url) == "https://a.example.com/img.png":
            return httpx.Response(302, headers={"location": "http://127.0.0.1:6379/"})
        raise AssertionError("must never reach the redirect target")  # pragma: no cover

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    with pytest.raises(NoteConnUnsupported):
        await guarded_media_stream(client, "https://a.example.com/img.png", max_bytes=1024)
    assert calls == ["https://a.example.com/img.png"]


async def test_guarded_media_stream_refuses_before_reading_a_large_body_via_content_length():
    """A real over-cap body would be huge; keep the MOCK body small but
    advertise the true size via Content-Length, proving the header check
    rejects BEFORE the streamed-accumulation loop ever runs — mirrors
    `test_download_rejects_a_file_over_the_cap_via_content_length_header`
    in `test_note_connectors_dropbox.py` exactly, one level down (the
    shared primitive both providers now route through)."""
    over_cap_size = 10_000

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"x" * 10, headers={"content-length": str(over_cap_size)})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    with pytest.raises(NoteConnUnsupported):
        await guarded_media_stream(client, "https://8.8.8.8/big.bin", max_bytes=100)


async def test_guarded_media_stream_aborts_mid_stream_when_content_length_is_absent_or_lying():
    """Backstop for when Content-Length is absent (as here) or understated:
    the RUNNING TOTAL while streaming is the guaranteed enforcement point,
    regardless of what (or whether) the header claims."""
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"y" * 5000)  # no content-length header at all

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    with pytest.raises(NoteConnUnsupported):
        await guarded_media_stream(client, "https://8.8.8.8/big.bin", max_bytes=100)


async def test_guarded_media_stream_succeeds_for_a_normal_small_file(monkeypatch):
    _stub_resolver(monkeypatch, ["142.250.0.1"])

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"content-length": "5"}, content=b"hello")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    content, response = await guarded_media_stream(
        client, "https://cdn.example.com/small.txt", max_bytes=1024,
    )
    assert content == b"hello"
    assert response.status_code == 200


async def test_guarded_media_stream_bounds_a_redirect_chain():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "https://8.8.8.8/img.png"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    with pytest.raises(NoteConnUnsupported):
        await guarded_media_stream(client, "https://8.8.8.8/img.png", max_redirects=3, max_bytes=1024)


async def test_guarded_media_stream_wraps_a_transport_error_as_transient():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    with pytest.raises(NoteConnTransient):
        await guarded_media_stream(client, "https://8.8.8.8/img.png", max_bytes=1024)


# ---------------------------------------------------------------------------
# ⛔ THE BYTE BUDGET ON EVERY READ (wave 6 whole-branch review I-1).
#
# The redirect and error branches used to `aread()` the whole body, and httpx
# decodes while it reads -- so a `404` that never ends, or a small gzip that
# inflates to GBs, ran the single web pod out of memory, and wave 6's link
# preview put that one member request away. These fake servers COUNT what they
# were made to send: an unbounded read shows up as the counter, not as a
# memory graph. Each stream is finite only so a regressed guard terminates
# (and reds) instead of hanging the suite.
# ---------------------------------------------------------------------------

_CHUNK = 64 * 1024
_ENDLESS = 32 * 1024 * 1024        # "unbounded", from the guard's point of view


class _CountingStream(httpx.AsyncByteStream):
    """A body that keeps coming, counting every byte the guard pulled."""

    def __init__(self, chunks):
        self._chunks = chunks
        self.sent = 0          # raw bytes handed to httpx
        self.decoded = 0       # what those bytes inflate to (== sent when not compressed)
        self.closed = False

    async def __aiter__(self):
        for raw, decoded_len in self._chunks:
            self.sent += len(raw)
            self.decoded += decoded_len
            yield raw

    async def aclose(self):
        self.closed = True


def _plain_endless():
    block = b"x" * _CHUNK
    return _CountingStream((block, len(block)) for _ in range(_ENDLESS // _CHUNK))


def _gzip_bomb_bytes(decoded_total=_ENDLESS):
    """gzip of `decoded_total` zero bytes, built BEFORE any measurement starts
    (~32 KB that inflate to 32 MB -- a real bomb's ratio)."""
    import gzip

    return gzip.compress(bytes(decoded_total), compresslevel=9)


def _gzip_bomb(bomb: bytes, decoded_total=_ENDLESS):
    """The whole bomb in ONE network chunk -- the case a running total over
    httpx's own decoder cannot bound, since httpx inflates a chunk whole."""
    return _CountingStream([(bomb, decoded_total)])


async def test_an_unbounded_ERROR_body_is_read_only_to_the_side_cap_then_abandoned():
    stream = _plain_endless()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, stream=stream)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    content, response = await guarded_media_stream(client, "https://8.8.8.8/x", max_bytes=1024 * 1024)
    # The policy, as a bound rather than a restated number: a side body is at
    # most "a few KB" -- raising the constant past that is a decision, not a tweak.
    assert base_module._SIDE_BODY_MAX_BYTES <= 16 * 1024
    assert response.status_code == 404
    assert len(content) <= base_module._SIDE_BODY_MAX_BYTES
    # ⛔ THE LOAD-BEARING ONE: the server was stopped after one chunk, not drained.
    assert stream.sent <= base_module._SIDE_BODY_MAX_BYTES + _CHUNK, (
        f"the guard pulled {stream.sent:,} bytes of a 404 body")


async def test_a_gzip_bomb_ERROR_body_is_never_inflated():
    stream = _gzip_bomb(_gzip_bomb_bytes())

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, stream=stream, headers={"content-encoding": "gzip"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    content, response = await guarded_media_stream(client, "https://8.8.8.8/x", max_bytes=1024 * 1024)
    assert (response.status_code, content) == (404, b"")
    assert stream.sent == 0, "an encoded error body was read"


async def test_an_unbounded_REDIRECT_body_is_not_read_at_all():
    stream = _plain_endless()

    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url) == "https://8.8.8.8/a":
            return httpx.Response(302, headers={"location": "https://8.8.8.8/b"}, stream=stream)
        return httpx.Response(200, content=b"final")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    content, response = await guarded_media_stream(client, "https://8.8.8.8/a", max_bytes=1024)
    assert (content, response.status_code) == (b"final", 200)
    assert stream.sent == 0, f"the guard pulled {stream.sent:,} bytes of a redirect body"


async def test_an_unbounded_SUCCESS_body_stops_at_the_cap_with_a_bounded_read_error():
    stream = _plain_endless()
    cap = 256 * 1024

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, stream=stream)   # no Content-Length to refuse on

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    try:
        await guarded_media_stream(client, "https://8.8.8.8/x", max_bytes=cap)
        refused = False
    except NoteConnUnsupported:
        refused = True
    # The counter first: an uncapped read shows as the bytes it pulled.
    assert stream.sent <= cap + _CHUNK, f"the guard pulled {stream.sent:,} bytes past a {cap:,}-byte cap"
    assert refused, "a body past the cap must be refused, never returned"


async def test_a_gzip_bomb_SUCCESS_body_is_aborted_at_the_cap_counted_DECODED():
    import tracemalloc

    bomb = _gzip_bomb_bytes()
    stream = _gzip_bomb(bomb)
    cap = 1024 * 1024

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, stream=stream, headers={"content-encoding": "gzip"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    tracemalloc.start()
    try:
        try:
            await guarded_media_stream(client, "https://8.8.8.8/x", max_bytes=cap)
            refused = False
        except NoteConnUnsupported:
            refused = True
        peak = tracemalloc.get_traced_memory()[1]
    finally:
        tracemalloc.stop()
    assert stream.sent == len(bomb), "non-vacuity: the bomb was actually delivered"
    # ⛔ PEAK MEMORY, not a count the guard reports about itself: the bomb is ONE
    # network chunk that inflates to 32 MB, and inflating it whole (what httpx's
    # own decoder does) shows here whatever the running total said afterwards.
    assert peak < 4 * cap, f"peak {peak:,} bytes while refusing a {len(bomb):,}-byte bomb"
    assert refused, "a body that decodes past the cap must be refused"


async def test_a_body_in_an_encoding_it_does_not_inflate_itself_is_refused_unread():
    # ⛔ httpx decodes `br` whenever `brotli` is installed, and a brotli bomb's
    # ratio dwarfs gzip's -- so an encoding the guard cannot bound is refused.
    stream = _plain_endless()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, stream=stream, headers={"content-encoding": "br"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    with pytest.raises(NoteConnUnsupported):
        await guarded_media_stream(client, "https://8.8.8.8/x", max_bytes=1024 * 1024)
    assert stream.sent == 0


async def test_CONTROL_an_honest_gzip_body_under_the_cap_decodes_to_its_bytes():
    # Non-vacuity for the inflating branch: without it, a guard that refused
    # every gzip body would pass the two bomb rails above.
    import gzip

    page = b"<html><head><title>ok</title></head></html>" * 200

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"content-encoding": "gzip"},
                              stream=_CountingStream([(gzip.compress(page), len(page))]))

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    content, response = await guarded_media_stream(client, "https://8.8.8.8/x", max_bytes=1024 * 1024)
    assert (content, response.status_code) == (page, 200)


async def test_every_hop_asks_for_an_unencoded_body():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers.get("accept-encoding"))
        if str(request.url) == "https://8.8.8.8/a":
            return httpx.Response(302, headers={"location": "https://8.8.8.8/b"})
        return httpx.Response(200, content=b"ok")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    await guarded_media_stream(client, "https://8.8.8.8/a", max_bytes=1024)
    assert seen == ["identity", "identity"]
