"""TERM-011 step 5 — the three ↩ADMIN-FALLBACK posters on flow-worker's watch
list: `alpha_gold_eod.py`, `weekly_flow.py` (both webhooks), `live_massive_router.py`.

All three fail CLOSED instead of terminating in `DISCORD_WEBHOOK_URL`, mirroring
`api/discord_watchlist.py` (commit `9b28d4fa4`, already live in production).

⛔ THE PROPERTY UNDER TEST IS NEGATIVE, same as that commit: with the admin
webhook SET and this poster's own dedicated variable(s) UNSET, the resolved
webhook must be "" — never the admin room. A regression that restores the old
`or os.getenv("DISCORD_WEBHOOK_URL", "")` tail would make a member-facing card
silently post into the ops channel while reading as a success.

⚠️ `weekly_flow.py`'s `run_weekly_cron` is the poster the decision packet flags
as the hardest silence to notice — it fires once a WEEK, so a misconfigured
variable can go undetected for up to seven days. Its log line is the substitute
for the notice nobody otherwise gets.
"""

from __future__ import annotations

from api import alpha_gold_eod as age
from api import weekly_flow as wf
from api import live_massive_router as lmr


# ── alpha_gold_eod.py ──────────────────────────────────────────────────────

def test_alpha_gold_webhook_never_reads_DISCORD_WEBHOOK_URL(monkeypatch):
    monkeypatch.delenv(age.WEBHOOK_ENV, raising=False)
    monkeypatch.delenv("DISCORD_MASSIVE_WEBHOOK_URL", raising=False)
    monkeypatch.delenv("DISCORD_LIVE_FLOW_WEBHOOK_URL", raising=False)
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://discord.example/ADMIN-ROOM")
    assert age._webhook() == ""


def test_alpha_gold_webhook_reads_its_own_variable(monkeypatch):
    monkeypatch.setenv(age.WEBHOOK_ENV, "https://discord.example/alpha-gold")
    assert age._webhook() == "https://discord.example/alpha-gold"


def test_run_eod_summary_refuses_visibly_with_no_webhook(monkeypatch, caplog):
    """⭐ Exercises the REAL `run_eod_summary` code path end to end, not just the
    pure `_webhook()` helper — stubbing only the flow.db-backed pieces the
    webhook check does not depend on."""
    monkeypatch.setenv("ALPHA_GOLD_EOD_ENABLED", "1")
    monkeypatch.delenv(age.WEBHOOK_ENV, raising=False)
    monkeypatch.delenv("DISCORD_MASSIVE_WEBHOOK_URL", raising=False)
    monkeypatch.delenv("DISCORD_LIVE_FLOW_WEBHOOK_URL", raising=False)
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://discord.example/ADMIN-ROOM")

    monkeypatch.setattr(age, "get_alpha_gold_today", lambda day=None: [
        {"ticker": "NVDA", "cp": "C", "strike": 900, "exp": "12/19/2026", "dte": 90,
         "spot": 910.0, "alertPremium": 1_000_000, "volumeOIRatio": 1.1,
         "moneynessLabel": "OTM", "moneynessPct": -1.1, "_type": "SWEEP",
         "_direction": "Bull", "timestamp": 0, "source": "stocks"}])
    monkeypatch.setattr(age, "_get_bcontract_accumulations", lambda day, min_score=4.5: [])
    monkeypatch.setattr(age, "_earnings_soon_syms", lambda within_days: set())
    monkeypatch.setattr(age, "render_card", lambda *a, **k: b"\x89PNG\r\n")
    # `run_eod_summary` does `from api import live_massive_router as lmr` INSIDE
    # the function body, so it binds the live module object each call — patching
    # the module's attribute directly is what that local `lmr` sees.
    monkeypatch.setattr(lmr, "_build_day_stats", lambda day: {})

    with caplog.at_level("ERROR"):
        res = age.run_eod_summary(force=True, post=True, today="09/27/2026")

    assert res["posted"] is False
    assert age.WEBHOOK_ENV in res["reason"]
    assert any(age.WEBHOOK_ENV in rec.message for rec in caplog.records), (
        "the refusal did not name the variable that turns this poster back on")


# ── weekly_flow.py — both webhooks ─────────────────────────────────────────

def test_weekly_flow_webhook_never_reads_DISCORD_WEBHOOK_URL(monkeypatch):
    monkeypatch.delenv(wf.WEBHOOK_ENV, raising=False)
    monkeypatch.delenv("DISCORD_MASSIVE_WEBHOOK_URL", raising=False)
    monkeypatch.delenv("DISCORD_LIVE_FLOW_WEBHOOK_URL", raising=False)
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://discord.example/ADMIN-ROOM")
    assert wf._webhook() == ""


def test_weekly_flow_webhook_reads_its_own_variable(monkeypatch):
    monkeypatch.setenv(wf.WEBHOOK_ENV, "https://discord.example/weekly-flow")
    assert wf._webhook() == "https://discord.example/weekly-flow"


def test_standing_webhook_never_reads_DISCORD_WEBHOOK_URL(monkeypatch):
    """⭐ `_standing_webhook()` falls through to `_webhook()`, so it inherits the
    same no-admin-fallback guarantee — asserted independently rather than assumed,
    since it is a second function with its own env read."""
    monkeypatch.delenv(wf.STANDING_WEBHOOK_ENV, raising=False)
    monkeypatch.delenv(wf.WEBHOOK_ENV, raising=False)
    monkeypatch.delenv("DISCORD_MASSIVE_WEBHOOK_URL", raising=False)
    monkeypatch.delenv("DISCORD_LIVE_FLOW_WEBHOOK_URL", raising=False)
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://discord.example/ADMIN-ROOM")
    assert wf._standing_webhook() == ""


def test_standing_webhook_reads_its_own_variable_first(monkeypatch):
    monkeypatch.setenv(wf.STANDING_WEBHOOK_ENV, "https://discord.example/open-flow")
    monkeypatch.setenv(wf.WEBHOOK_ENV, "https://discord.example/weekly-flow")
    assert wf._standing_webhook() == "https://discord.example/open-flow"


def test_standing_webhook_falls_through_to_weekly_when_unset(monkeypatch):
    monkeypatch.delenv(wf.STANDING_WEBHOOK_ENV, raising=False)
    monkeypatch.setenv(wf.WEBHOOK_ENV, "https://discord.example/weekly-flow")
    assert wf._standing_webhook() == "https://discord.example/weekly-flow"


# ── live_massive_router.py — partner-owned, minimal footprint ─────────────

def test_live_massive_webhook_never_reads_DISCORD_WEBHOOK_URL(monkeypatch):
    monkeypatch.delenv("DISCORD_MASSIVE_WEBHOOK_URL", raising=False)
    monkeypatch.delenv("DISCORD_LIVE_FLOW_WEBHOOK_URL", raising=False)
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://discord.example/ADMIN-ROOM")
    assert lmr._massive_webhook() == ""


def test_live_massive_webhook_reads_its_own_variable(monkeypatch):
    monkeypatch.setenv("DISCORD_MASSIVE_WEBHOOK_URL", "https://discord.example/massive")
    assert lmr._massive_webhook() == "https://discord.example/massive"


def test_live_massive_webhook_read_at_CALL_time(monkeypatch):
    """⭐ Not a module constant any more — the same process sees a flip with no
    reload, which is the other half of the `discord_notify.py:11` defect this
    conversion removes."""
    monkeypatch.delenv("DISCORD_MASSIVE_WEBHOOK_URL", raising=False)
    monkeypatch.delenv("DISCORD_LIVE_FLOW_WEBHOOK_URL", raising=False)
    assert lmr._massive_webhook() == ""
    monkeypatch.setenv("DISCORD_MASSIVE_WEBHOOK_URL", "https://discord.example/massive")
    assert lmr._massive_webhook() == "https://discord.example/massive"


def test_post_massive_discord_refuses_visibly_with_no_webhook(monkeypatch, caplog):
    monkeypatch.delenv("DISCORD_MASSIVE_WEBHOOK_URL", raising=False)
    monkeypatch.delenv("DISCORD_LIVE_FLOW_WEBHOOK_URL", raising=False)
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://discord.example/ADMIN-ROOM")

    with caplog.at_level("ERROR"):
        ok, detail = lmr._post_massive_discord({"title": "test"})

    assert ok is False
    assert "DISCORD_MASSIVE_WEBHOOK_URL" in detail
    assert any("DISCORD_MASSIVE_WEBHOOK_URL" in rec.message for rec in caplog.records), (
        "the refusal did not name the variable that turns this back on")
