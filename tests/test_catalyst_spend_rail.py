"""F-CAT-1 spend rail: money out must buy rows in, or the engine stops.

⚰️ Guards the 2026-09-08→11 shape — 118 billed curator calls, zero persisted
rows, four trading days, nothing noticed. The rail asks the one question no
existing guard asked: **did this run spend money and persist nothing?**

⛔ Every assertion here is paired with a control proving it can fail. A rail
whose alert never fires and a rail whose alert always fires look identical from
a green suite (`lesson_gate_that_cannot_fail`).
"""
import os
import tempfile
import time
from unittest.mock import patch

import pytest

from api.services.catalyst import engine, spend_rail, store


@pytest.fixture
def s(monkeypatch):
    monkeypatch.setenv("CATALYST_IGNORE_MARKET_CALENDAR", "1")
    monkeypatch.delenv("CATALYST_SPEND_DISABLED", raising=False)
    monkeypatch.delenv("CATALYST_ZERO_ROW_KILL_AFTER", raising=False)
    spend_rail._ALERTED_DATES.clear()
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(store, "_DB_PATH", os.path.join(d, "catalysts.db"))
        store._init_db()
        yield
    spend_rail._ALERTED_DATES.clear()


def _spend(md, usd=0.25, ticker="_CURATOR"):
    store.log_cost(market_date=md, ticker=ticker, model="claude-sonnet-4-6",
                   input_tokens=8000, output_tokens=400, cost_usd=usd,
                   was_cached=False)


def _run(md, *, rows_written, spend_usd):
    """Record one synthetic run receipt."""
    store.record_run(market_date=md, started_at=int(time.time()),
                     rows_written=rows_written, spend_usd=spend_usd)


# ------------------------------------------------- the zero-row alert, + control

def test_a_run_that_spends_and_writes_nothing_alerts_admin(s):
    md = "2026-09-09"
    started = int(time.time()) - 5
    _spend(md, 0.42)
    with patch("api.services.discord_notify._send_webhook") as hook:
        spend_rail.record_and_check(md, started, {"errors": ["_enrich_x: RuntimeError: boom"]})
    assert hook.called, "spend with zero rows did not alert"
    payload = hook.call_args[0][0]
    assert "0.42" in str(payload), "the alert does not carry what was spent"
    assert "_enrich_x" in str(payload), "the alert does not name the failing stage"


def test_control_a_run_that_writes_rows_does_not_alert(s):
    """CONTROL. Without this, an always-firing alert passes the test above."""
    md = "2026-09-09"
    started = int(time.time()) - 5
    _spend(md, 0.42)
    store.upsert_catalyst({
        "market_date": md, "ticker": "AAPL", "rank": 1, "score": 10.0,
        "tag": "Catalyst", "price": 1.0, "gap_pct": 1.0, "vol_x": 1.0,
        "market_cap": 1e9, "sector": "Tech", "thesis_text": "t",
        "thesis_model": "m", "thesis_at": 1, "thesis_sources": "[]",
        "signals_hash": "h", "catalyst_at": None, "raw_signals": "{}",
    })
    with patch("api.services.discord_notify._send_webhook") as hook:
        spend_rail.record_and_check(md, started, {"errors": []})
    assert not hook.called, "alerted on a healthy run"


def test_control_a_run_that_spends_nothing_does_not_alert(s):
    """A holiday / empty-pull run writes nothing and that is CORRECT."""
    with patch("api.services.discord_notify._send_webhook") as hook:
        spend_rail.record_and_check("2026-09-13", int(time.time()) - 5, {"errors": []})
    assert not hook.called, "alerted on a run that cost nothing"


def test_the_alert_is_deduped_per_day(s):
    md = "2026-09-09"
    _spend(md, 0.42)
    with patch("api.services.discord_notify._send_webhook") as hook:
        for _ in range(4):
            spend_rail.record_and_check(md, int(time.time()) - 5, {"errors": []})
    assert hook.call_count == 1, f"admin pinged {hook.call_count}x for one condition"


# ------------------------------------------------------- the streak + kill switch

def test_the_streak_counts_only_paid_runs_that_wrote_nothing(s):
    for _ in range(3):
        _run("2026-09-09", rows_written=0, spend_usd=0.2)
    assert store.consecutive_zero_row_spending_runs() == 3


def test_a_healthy_paid_run_breaks_the_streak(s):
    for _ in range(3):
        _run("2026-09-09", rows_written=0, spend_usd=0.2)
    _run("2026-09-09", rows_written=20, spend_usd=0.3)
    assert store.consecutive_zero_row_spending_runs() == 0


def test_a_free_run_neither_breaks_nor_extends_the_streak(s):
    """⛔ The disarm bug this exists to prevent: if a weekend skip (spend 0,
    rows 0) reset the counter, the kill switch could never reach N across any
    quiet period — and it would count those skips toward N if treated as
    failures. Both directions are wrong; a free run is uninformative."""
    for _ in range(2):
        _run("2026-09-09", rows_written=0, spend_usd=0.2)
    _run("2026-09-12", rows_written=0, spend_usd=0.0)     # weekend skip
    assert store.consecutive_zero_row_spending_runs() == 2


def test_the_kill_switch_fires_at_the_cap(s, monkeypatch):
    monkeypatch.setenv("CATALYST_ZERO_ROW_KILL_AFTER", "3")
    for _ in range(2):
        _run("2026-09-09", rows_written=0, spend_usd=0.2)
    assert spend_rail.block_reason() is None, "stopped early — 2 < cap 3"
    _run("2026-09-09", rows_written=0, spend_usd=0.2)
    reason = spend_rail.block_reason()
    assert reason and "consecutive" in reason, f"kill switch did not fire: {reason!r}"


def test_the_kill_switch_can_be_disabled(s, monkeypatch):
    monkeypatch.setenv("CATALYST_ZERO_ROW_KILL_AFTER", "0")
    for _ in range(9):
        _run("2026-09-09", rows_written=0, spend_usd=0.2)
    assert spend_rail.block_reason() is None


def test_the_manual_kill_switch_is_an_env_var(s, monkeypatch):
    """⛔ feedback_kill_switch_never_a_delete — stopping spend is a variable,
    never a tag and never a delete against stored data."""
    monkeypatch.setenv("CATALYST_SPEND_DISABLED", "1")
    reason = spend_rail.block_reason()
    assert reason and "CATALYST_SPEND_DISABLED" in reason


def test_a_blocked_run_spends_nothing_and_says_so(s, monkeypatch):
    """END TO END: with the switch thrown, run_refresh must not reach the
    sources at all — the expensive calls are all downstream of it."""
    monkeypatch.setenv("CATALYST_SPEND_DISABLED", "1")
    with patch("api.services.catalyst.engine.sources.collect_all") as collect:
        summary = engine.run_refresh()
    assert not collect.called, "a blocked run still called the sources"
    assert "spend blocked" in (summary.get("skipped") or "")


def test_control_an_unblocked_run_does_reach_the_sources(s):
    """CONTROL for the test above — proves the block is what stopped it."""
    with patch("api.services.catalyst.engine.sources.collect_all",
               return_value=[]) as collect:
        engine.run_refresh()
    assert collect.called


# ------------------------------------------------------------------ the receipt

def test_every_run_leaves_a_durable_receipt(s):
    """The whole reason four days of spend was undiagnosable: the summary was
    logged and never persisted."""
    with patch("api.services.catalyst.engine.sources.collect_all", return_value=[]):
        engine.run_refresh()
    with __import__("contextlib").closing(store._connect()) as c:
        rows = c.execute("SELECT * FROM catalyst_runs").fetchall()
    assert len(rows) == 1, "the run left no receipt"
    assert rows[0]["market_date"] == engine._today_market_date()
    assert rows[0]["finished_at"] >= rows[0]["started_at"]
