"""TERM-011 step 5 -- `api/darkpool_eod.py` fails CLOSED, and does so visibly.

Same shape as `api/discord_watchlist.py` (see `tests/test_discord_watchlist_webhook.py`
and commit `9b28d4fa4`): the poster's OWN webhook chain must never fall back to the
shared admin/ops variable `DISCORD_WEBHOOK_URL`, and a stopped post must name the
variable that turns it back on.
"""
from __future__ import annotations

import api.darkpool_eod as dpe


_OWN_CHAIN = (
    dpe.WEBHOOK_ENV,
    "ALPHA_GOLD_EOD_WEBHOOK_URL",
    "DISCORD_MASSIVE_WEBHOOK_URL",
    "DISCORD_LIVE_FLOW_WEBHOOK_URL",
)


def _clear_chain(monkeypatch):
    for var in _OWN_CHAIN:
        monkeypatch.delenv(var, raising=False)


# ── _webhook(): call-time, no literal DISCORD_WEBHOOK_URL fallback ────────────

def test_webhook_reads_the_named_variable_at_CALL_time(monkeypatch):
    _clear_chain(monkeypatch)
    assert dpe._webhook() == ""

    monkeypatch.setenv(dpe.WEBHOOK_ENV, "https://discord.example/darkpool")
    assert dpe._webhook() == "https://discord.example/darkpool"

    # CALL time, not import time -- the same process sees the flip immediately.
    monkeypatch.delenv(dpe.WEBHOOK_ENV, raising=False)
    assert dpe._webhook() == ""


def test_webhook_NEVER_reads_DISCORD_WEBHOOK_URL(monkeypatch):
    """THE ACCEPTANCE TEST. With the admin webhook SET and every one of this
    card's own variables unset, `_webhook()` must still answer "" -- never the
    admin channel. This is the one property TERM-011 step 5 exists to establish."""
    _clear_chain(monkeypatch)
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://discord.example/ADMIN-ROOM")
    assert dpe._webhook() == ""


# ── run_eod_summary(): fails closed, visibly, never falls through ────────────

def _stub_sections(monkeypatch):
    sections = [("Mega", [{"sym": "NVDA", "notional": 6e6}])]
    summary = {"n_tickers": 1}
    monkeypatch.setattr(dpe, "build_sections",
                        lambda **k: (sections, summary))
    monkeypatch.setattr(dpe, "render_card", lambda *a, **k: b"\x89PNG")


def test_run_eod_summary_posts_NOTHING_with_no_webhook_configured(monkeypatch, caplog):
    _clear_chain(monkeypatch)
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://discord.example/ADMIN-ROOM")
    _stub_sections(monkeypatch)

    def _boom(*a, **k):
        raise AssertionError("posted with no webhook configured")
    monkeypatch.setattr(dpe, "_post_discord_image", _boom)

    with caplog.at_level("ERROR"):
        res = dpe.run_eod_summary(force=True, post=True)

    assert res["ok"] is True
    assert res["posted"] is False
    assert "https://discord.example/ADMIN-ROOM" not in str(res)
    assert any(dpe.WEBHOOK_ENV in rec.message for rec in caplog.records), (
        "the failure did not name the variable that turns this card back on")


def test_run_eod_summary_posts_when_its_OWN_webhook_is_set(monkeypatch):
    monkeypatch.setenv(dpe.WEBHOOK_ENV, "https://discord.example/darkpool")
    _stub_sections(monkeypatch)

    posted_to = []

    def _capture(webhook, png, content, **k):
        posted_to.append(webhook)
        return True, "discord 200"
    monkeypatch.setattr(dpe, "_post_discord_image", _capture)

    res = dpe.run_eod_summary(force=True, post=True)

    assert res["ok"] is True
    assert res["posted"] is True
    assert posted_to == ["https://discord.example/darkpool"]
