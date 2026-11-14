"""A public slash-command reply must never be able to ping anyone.

WHY THIS FILE EXISTS (2026-11-13). `/lesson` and `/buzz` became PUBLIC by owner
ruling, and both echo what the member typed back into the reply:

    /lesson @everyone      ->  **Lessons on "@everyone"**
    /buzz ticker:<@&123>   ->  **<@&123>** - no mentions in that window.

While those replies were private that was harmless: nobody else saw the text.
Posted in the channel, the same text is the bot mentioning a role, a member or
the whole server on one member's say-so. The pre-V2 reply door,
`discord_interactions.edit_original`, sent no `allowed_mentions` at all, and
Discord's default with the field ABSENT is to parse every mention in the text.

So the capability is removed at the door, for every command that replies
through it, rather than by cleaning each echo: `allowed_mentions: {"parse": []}`
on every payload, which is what every other poster in this app already sends.

These read THE WIRE (the request httpx actually builds), not the function that
assembles it: the three payload shapes inside `edit_original` are built on three
different lines, and a fix that reaches two of them looks complete from the top.
"""
from __future__ import annotations

import json

import httpx
import pytest

from api.services import discord_interactions as di

NO_MENTIONS = {"parse": []}
PNG = b"\x89PNG\r\n\x1a\n" + b"x" * 64
HOSTILE = "@everyone <@&111> <@222>"


def _payload(request: httpx.Request) -> dict:
    """The JSON Discord would read off this request: the body itself for a
    plain edit, the `payload_json` part for a multipart one."""
    if request.headers["content-type"].startswith("multipart/form-data"):
        body = request.content
        start = body.index(b'name="payload_json"')
        start = body.index(b"\r\n\r\n", start) + 4
        return json.loads(body[start:body.index(b"\r\n--", start)])
    return json.loads(request.content)


def _client(seen: list, respond=None):
    def handler(request: httpx.Request):
        seen.append(request)
        return respond(request) if respond else httpx.Response(200, json={"id": "1"})
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_the_control_a_payload_without_the_field_is_seen_as_such():
    """⛔ The reader must be able to see a MISSING field, or every test below
    passes by answering "fine" to everything."""
    seen = []
    c = _client(seen)
    c.patch("https://discord.test/x", json={"content": HOSTILE})
    c.patch("https://discord.test/x", data={"payload_json": json.dumps({"content": HOSTILE})},
            files={"files[0]": ("a.png", PNG, "image/png")})
    assert "allowed_mentions" not in _payload(seen[0])
    assert "allowed_mentions" not in _payload(seen[1])


def test_a_text_reply_disables_every_mention():
    seen = []
    assert di.edit_original("APP", "TOK", content=HOSTILE, client=_client(seen))
    assert _payload(seen[-1])["allowed_mentions"] == NO_MENTIONS
    assert _payload(seen[-1])["content"] == HOSTILE, "the words are delivered as typed, only the ping is gone"


def test_an_image_reply_disables_every_mention():
    """The multipart shape is built on its own line, inside `payload_json`."""
    seen = []
    assert di.edit_original("APP", "TOK", content=HOSTILE, png=PNG, filename="buzz.png", client=_client(seen))
    assert seen[-1].headers["content-type"].startswith("multipart/form-data")
    assert _payload(seen[-1])["allowed_mentions"] == NO_MENTIONS


def test_the_text_fallback_after_a_refused_image_disables_every_mention():
    """Third shape: Discord refuses the upload (no Attach Files in the channel)
    and the reply is re-sent as text, by a separate `patch` call."""
    seen = []

    def respond(request):
        if request.headers["content-type"].startswith("multipart/form-data"):
            return httpx.Response(403, json={"message": "Missing Permissions", "code": 50013})
        return httpx.Response(200, json={"id": "1"})

    assert di.edit_original("APP", "TOK", content=HOSTILE, png=PNG, filename="buzz.png",
                            client=_client(seen, respond))
    assert len(seen) == 2, "the fallback was never sent, so this proved nothing"
    assert _payload(seen[-1])["allowed_mentions"] == NO_MENTIONS


def test_a_reply_with_buttons_or_kept_files_disables_every_mention():
    seen = []
    c = _client(seen)
    di.edit_original("APP", "TOK", content=HOSTILE, components=[], client=c)
    di.edit_original("APP", "TOK", content=HOSTILE, keep_attachments=["9"], client=c)
    assert [_payload(r)["allowed_mentions"] for r in seen] == [NO_MENTIONS, NO_MENTIONS]


# ── The two commands that made this matter, end to end through the real door ──

@pytest.fixture()
def wire(monkeypatch):
    """Every request `edit_original` makes with its OWN client, captured."""
    seen: list = []
    real = httpx.Client

    def fake_client(*a, **k):
        k.pop("timeout", None)
        return real(transport=httpx.MockTransport(
            lambda request: (seen.append(request), httpx.Response(200, json={"id": "1"}))[1]))
    monkeypatch.setattr(httpx, "Client", fake_client)
    return seen


def test_a_lesson_search_for_a_mention_cannot_ping(wire, monkeypatch, tmp_path):
    from api.routers import discord_interactions as rt
    monkeypatch.setenv("TSDR_LESSONS_DB_PATH", str(tmp_path / "lessons.db"))
    rt.run_lesson_search_job("APP", "TOK", HOSTILE, search_fn=lambda q: [])
    assert len(wire) == 1
    sent = _payload(wire[0])
    assert "@everyone" in sent["content"], "the reply no longer echoes the query, so this proves nothing"
    assert sent["allowed_mentions"] == NO_MENTIONS


def test_a_buzz_lookup_for_a_mention_cannot_ping(wire):
    from api.routers import discord_interactions as rt
    rt.run_buzz_job("APP", "TOK", "<@&111>", "open", 0,
                    build_fn=lambda: "**<@&111>** — no mentions in that window.")
    assert len(wire) == 1
    sent = _payload(wire[0])
    assert "<@&111>" in sent["content"]
    assert sent["allowed_mentions"] == NO_MENTIONS
