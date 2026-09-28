"""TERM-011 step 5 -- `api/cream_card.py` fails CLOSED, and does so visibly.

Same shape as `api/discord_watchlist.py` (see `tests/test_discord_watchlist_webhook.py`
and commit `9b28d4fa4`): the poster's OWN webhook chain must never fall back to the
shared admin/ops variable `DISCORD_WEBHOOK_URL`, and a stopped post must name the
variable that turns it back on.
"""
from __future__ import annotations

import api.cream_card as cc


_OWN_CHAIN = (
    cc.WEBHOOK_ENV,
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
    assert cc._webhook() == ""

    monkeypatch.setenv(cc.WEBHOOK_ENV, "https://discord.example/cream")
    assert cc._webhook() == "https://discord.example/cream"

    # CALL time, not import time -- the same process sees the flip immediately.
    monkeypatch.delenv(cc.WEBHOOK_ENV, raising=False)
    assert cc._webhook() == ""


def test_webhook_NEVER_reads_DISCORD_WEBHOOK_URL(monkeypatch):
    """THE ACCEPTANCE TEST. With the admin webhook SET and every one of this
    card's own variables unset, `_webhook()` must still answer "" -- never the
    admin channel. This is the one property TERM-011 step 5 exists to establish."""
    _clear_chain(monkeypatch)
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://discord.example/ADMIN-ROOM")
    assert cc._webhook() == ""


# ── run_cream_eod(): fails closed, visibly, never falls through ──────────────

def test_run_cream_eod_posts_NOTHING_with_no_webhook_configured(monkeypatch, caplog):
    _clear_chain(monkeypatch)
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://discord.example/ADMIN-ROOM")

    from api import live_massive_router as lmr
    from api import alpha_gold_eod as age
    from api import watchlist_card as wc

    monkeypatch.setattr(lmr, "_today_mdyyyy", lambda: "9/27/2026")
    monkeypatch.setattr(lmr, "compute_cream", lambda today, **k: {
        "bull": [{"sym": "NVDA"}], "bear": [], "net": 1.0,
    })
    monkeypatch.setattr(wc, "render_watchlist_card", lambda *a, **k: b"\x89PNG")

    def _boom(*a, **k):
        raise AssertionError("posted with no webhook configured")
    monkeypatch.setattr(age, "_post_discord_image", _boom)

    with caplog.at_level("ERROR"):
        res = cc.run_cream_eod(force=True, post=True)

    assert res["ok"] is True
    assert res["posted"] is False
    assert "https://discord.example/ADMIN-ROOM" not in str(res)
    assert any(cc.WEBHOOK_ENV in rec.message for rec in caplog.records), (
        "the failure did not name the variable that turns this card back on")


def test_run_cream_eod_posts_when_its_OWN_webhook_is_set(monkeypatch):
    monkeypatch.setenv(cc.WEBHOOK_ENV, "https://discord.example/cream")

    from api import live_massive_router as lmr
    from api import alpha_gold_eod as age
    from api import watchlist_card as wc

    monkeypatch.setattr(lmr, "_today_mdyyyy", lambda: "9/27/2026")
    monkeypatch.setattr(lmr, "compute_cream", lambda today, **k: {
        "bull": [{"sym": "NVDA"}], "bear": [], "net": 1.0,
    })
    monkeypatch.setattr(wc, "render_watchlist_card", lambda *a, **k: b"\x89PNG")

    posted_to = []

    def _capture(webhook, png, content, **k):
        posted_to.append(webhook)
        return True, "ok"
    monkeypatch.setattr(age, "_post_discord_image", _capture)

    res = cc.run_cream_eod(force=True, post=True)

    assert res["ok"] is True
    assert res["posted"] is True
    assert posted_to == ["https://discord.example/cream"]
