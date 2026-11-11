"""The per-hop host pin in `providers/base.py` (Plan E Task 5, pre-flight ruling 9).

`guarded_media_get(..., allowed_host=)` / `guarded_media_stream(..., allowed_host=)`: when set,
every hop (the first URL and every redirect) must be exactly that host, checked BEFORE the hop's
request is sent, next to the unchanged public-address guard. Evernote attachment downloads pin
`storage.googleapis.com`. `allowed_host=None` (the default) leaves the existing callers as they are.

No network: `httpx.MockTransport`, and `base._resolve_host` answers a public test address.
"""

from __future__ import annotations

import httpx
import pytest

from api.services.journal_two.note_connectors import errors
from api.services.journal_two.note_connectors.providers import base

PUBLIC = "142.250.0.1"
PIN = "storage.googleapis.com"


@pytest.fixture(autouse=True)
def _public_dns(monkeypatch):
    async def resolve(_host: str) -> list[str]:
        return [PUBLIC]

    monkeypatch.setattr(base, "_resolve_host", resolve)


class Hops:
    """Answers each URL from a script; records every request that reached the transport."""

    def __init__(self, script: dict[str, httpx.Response]):
        self.script = script
        self.seen: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.seen.append(url)
        return self.script[url]


def _redirect(to: str) -> httpx.Response:
    return httpx.Response(302, headers={"location": to})


def _ok(body: bytes = b"png-bytes") -> httpx.Response:
    return httpx.Response(200, headers={"content-type": "image/png"}, content=body)


def _client(hops: Hops) -> httpx.AsyncClient:
    return base.media_http_client(transport=httpx.MockTransport(hops))


async def test_redirect_hop_to_another_host_is_refused_before_it_is_requested():
    hops = Hops({f"https://{PIN}/b/o": _redirect("https://evil.example/steal"),
                 "https://evil.example/steal": _ok()})
    async with _client(hops) as client:
        with pytest.raises(errors.NoteConnUnsafeAddress):
            await base.guarded_media_get(client, f"https://{PIN}/b/o", what="a.png", allowed_host=PIN)
    assert hops.seen == [f"https://{PIN}/b/o"]  # ONE request: the off-host hop never left


async def test_redirect_hop_on_the_same_host_is_followed():
    hops = Hops({f"https://{PIN}/b/o": _redirect(f"https://{PIN}/b/other"),
                 f"https://{PIN}/b/other": _ok(b"final")})
    async with _client(hops) as client:
        resp = await base.guarded_media_get(client, f"https://{PIN}/b/o", what="a.png", allowed_host=PIN)
    assert resp.status_code == 200 and resp.content == b"final"
    assert hops.seen == [f"https://{PIN}/b/o", f"https://{PIN}/b/other"]


async def test_virtual_host_style_bucket_host_is_refused():
    hops = Hops({f"https://bucket.{PIN}/o": _ok()})
    async with _client(hops) as client:
        with pytest.raises(errors.NoteConnUnsafeAddress):
            await base.guarded_media_get(client, f"https://bucket.{PIN}/o", what="a.png",
                                         allowed_host=PIN)
    assert hops.seen == []  # refused before the first request


async def test_second_of_three_hops_off_host_is_refused():
    hops = Hops({f"https://{PIN}/1": _redirect(f"https://{PIN}/2"),
                 f"https://{PIN}/2": _redirect("https://other.example/3"),
                 "https://other.example/3": _ok()})
    async with _client(hops) as client:
        with pytest.raises(errors.NoteConnUnsafeAddress):
            await base.guarded_media_get(client, f"https://{PIN}/1", what="a.png", allowed_host=PIN)
    assert hops.seen == [f"https://{PIN}/1", f"https://{PIN}/2"]


async def test_host_compare_is_case_insensitive_and_exact():
    hops = Hops({"https://storage.googleapis.com/b/o": _ok()})
    async with _client(hops) as client:
        resp = await base.guarded_media_get(client, "https://STORAGE.googleapis.com/b/o",
                                            what="a.png", allowed_host=PIN)
    assert resp.status_code == 200


async def test_allowed_host_none_keeps_existing_callers_unchanged():
    hops = Hops({"https://a.example/x": _redirect("https://b.example/y"),
                 "https://b.example/y": _ok(b"followed")})
    async with _client(hops) as client:
        resp = await base.guarded_media_get(client, "https://a.example/x", what="x")
    assert resp.content == b"followed"
    assert hops.seen == ["https://a.example/x", "https://b.example/y"]


async def test_the_stream_variant_takes_the_same_pin():
    hops = Hops({f"https://{PIN}/b/o": _redirect("https://evil.example/s")})
    async with _client(hops) as client:
        with pytest.raises(errors.NoteConnUnsafeAddress):
            await base.guarded_media_stream(client, f"https://{PIN}/b/o", what="a.png",
                                            max_bytes=1024, allowed_host=PIN)
    assert hops.seen == [f"https://{PIN}/b/o"]
