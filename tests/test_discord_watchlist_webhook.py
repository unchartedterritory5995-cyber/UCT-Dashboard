"""TERM-011 step 5 — `api/discord_watchlist.py` fails CLOSED, and does so visibly.

This poster is manual (a member clicks "Push to Discord"), which is exactly why
§5's ordering puts it first: its silence is instant and lands on the person who
clicked, so a regression here is the cheapest one to notice and the cheapest one
to revert. See `docs/terminal-research/07-technical-architecture/term-011-routing-
decisions.md` §5 and commit `26b3a1cef` for the shape this mirrors.

⛔ THE PROPERTY UNDER TEST IS NEGATIVE: this poster must NEVER fall back to
`DISCORD_WEBHOOK_URL`. `webhook_url()` reads `DISCORD_LIVE_FLOW_WEBHOOK_URL` then
the legacy `DISCORD_FLOW_WEBHOOK_URL` — nothing else. A regression that restores
the old `or os.getenv("DISCORD_WEBHOOK_URL", "")` tail would make this poster's
"nothing configured" state silently post into the admin/ops room, which is a card
in the wrong room reading as a success.
"""

from __future__ import annotations

import pytest

from api import discord_watchlist as dw


# ── webhook_url(): call-time, no literal DISCORD_WEBHOOK_URL fallback ──────────

def test_webhook_url_reads_the_named_variable_at_CALL_time(monkeypatch):
    monkeypatch.delenv(dw.WEBHOOK_ENV, raising=False)
    monkeypatch.delenv(dw.LEGACY_WEBHOOK_ENV, raising=False)
    assert dw.webhook_url() == ""

    monkeypatch.setenv(dw.WEBHOOK_ENV, "https://discord.example/live")
    assert dw.webhook_url() == "https://discord.example/live"

    # ⭐ CALL TIME, not import time — the SAME process sees the flip with no reload.
    monkeypatch.delenv(dw.WEBHOOK_ENV, raising=False)
    assert dw.webhook_url() == ""


def test_webhook_url_falls_back_to_the_LEGACY_name_only(monkeypatch):
    """The legacy name is the SAME channel under an old spelling, not a second
    destination — kept for safety if the 2026-06-17 Railway rename is ever
    reverted."""
    monkeypatch.delenv(dw.WEBHOOK_ENV, raising=False)
    monkeypatch.setenv(dw.LEGACY_WEBHOOK_ENV, "https://discord.example/legacy")
    assert dw.webhook_url() == "https://discord.example/legacy"


def test_webhook_url_NEVER_reads_DISCORD_WEBHOOK_URL(monkeypatch):
    """⛔⛔ THE ACCEPTANCE TEST. With the admin webhook SET and this poster's own
    two variables UNSET, `webhook_url()` must still answer "" — never the admin
    channel. This is the one property step 5 exists to establish."""
    monkeypatch.delenv(dw.WEBHOOK_ENV, raising=False)
    monkeypatch.delenv(dw.LEGACY_WEBHOOK_ENV, raising=False)
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://discord.example/ADMIN-ROOM")
    assert dw.webhook_url() == ""


# ── send_to_discord(): fails closed, visibly, never falls through ─────────────

class _BoomIfCalled:
    """A stand-in for httpx.AsyncClient that fails the test if anything tries to
    post — the non-vacuity half: if `webhook_url()` were silently ignored, this
    is what would catch it."""

    def __init__(self, *a, **k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, *a, **k):
        raise AssertionError("send_to_discord posted with no webhook configured")


async def test_send_to_discord_posts_NOTHING_with_no_webhook_configured(monkeypatch, caplog):
    monkeypatch.delenv(dw.WEBHOOK_ENV, raising=False)
    monkeypatch.delenv(dw.LEGACY_WEBHOOK_ENV, raising=False)
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://discord.example/ADMIN-ROOM")
    monkeypatch.setattr(dw.httpx, "AsyncClient", _BoomIfCalled)

    with caplog.at_level("ERROR"):
        result = await dw.send_to_discord(bull=[{"sym": "NVDA"}], bear=[])

    assert result["ok"] is False
    assert "https://discord.example/ADMIN-ROOM" not in str(result)

    # ⭐ VISIBLE SILENCE — the log line names the variable to set, so an operator
    # (or the member who clicked) is not left guessing which knob turns it back on.
    assert any(dw.WEBHOOK_ENV in rec.message for rec in caplog.records), (
        "the failure did not name the variable that turns this poster back on")


async def test_send_to_discord_posts_when_its_OWN_webhook_is_set(monkeypatch):
    monkeypatch.setenv(dw.WEBHOOK_ENV, "https://discord.example/live-flow")
    posted = []

    class _Resp:
        def raise_for_status(self):
            return None

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None, **k):
            posted.append(url)
            return _Resp()

    monkeypatch.setattr(dw.httpx, "AsyncClient", _Client)
    monkeypatch.setattr("asyncio.sleep", lambda *_a, **_k: _immediate())

    result = await dw.send_to_discord(bull=[{"sym": "NVDA"}], bear=[])

    assert result["ok"] is True
    assert posted and all(u == "https://discord.example/live-flow" for u in posted)


async def _immediate():
    return None


# ── send_image_to_discord(): same contract, image leg ──────────────────────────

async def test_send_image_to_discord_posts_NOTHING_with_no_webhook_configured(monkeypatch, caplog):
    monkeypatch.delenv(dw.WEBHOOK_ENV, raising=False)
    monkeypatch.delenv(dw.LEGACY_WEBHOOK_ENV, raising=False)
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://discord.example/ADMIN-ROOM")
    monkeypatch.setattr(dw.httpx, "AsyncClient", _BoomIfCalled)

    with caplog.at_level("ERROR"):
        result = await dw.send_image_to_discord(image_bytes=b"\x89PNG\r\n")

    assert result["ok"] is False
    assert any(dw.WEBHOOK_ENV in rec.message for rec in caplog.records)
