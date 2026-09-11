"""Seam 28's re-enablement, behind GRADE_TICKER_CONFIRMED_SOURCE_ENABLED.

`_default_patterns_fn` has returned [] since 2026-09-06, deliberately: it used
to read the raw rule-engine table, whose universe-wide page the owner had
already retired after Pattern Vision confirmed only ~16% of its candidates.
Pattern Vision reached LIVE + ACCEPTED on 2026-09-09, which is the condition its
own docstring named for re-enabling a CONFIRMED source.

Four properties, and the fourth is the uncomfortable one:

  * OFF (and unset) is byte-for-byte today's behaviour: no detections.
  * ON sources `get_confirmed` ONLY -- never the raw detector feed.
  * ON inherits get_confirmed's latest-evidence-bar rule, so a setup confirmed
    on an older bar and REJECTED on a newer one is never served.
  * ON *still* produces SKIP/no_setup, because a verdict has no entry or stop.

⛔ Dates here are derived from today, never pinned. Three separate date-bombs
were found in this repo on 2026-09-10 -- fixtures that were green when written
and went red days later with nobody touching the code.
"""
import datetime as dt
import importlib

import pytest


def _today():
    return dt.date.today().isoformat()


def _yesterday():
    return (dt.date.today() - dt.timedelta(days=1)).isoformat()


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("PATTERN_VISION_DB_PATH", str(tmp_path / "pv.db"))
    import api.services.pattern_vision.store as s
    importlib.reload(s)
    s.init_db()
    return s


def _v(s, setup, asof, confirmed, conf=80.0, key_level=123.45, ticker="NVDA"):
    s.put_verdict({
        "ticker": ticker, "tf": "D", "setup": setup, "asof_date": asof,
        "confirmed": confirmed, "vision_confidence": conf, "rationale": "r",
        "key_level": key_level, "raw_confidence": 0.5, "model": "claude-opus-4-8",
        "signals_hash": "h" + setup + asof, "judged_at": 1789045200, "checks": "[]",
    })


def _gt():
    import api.services.grade_ticker as g
    return g


def test_off_by_default_returns_no_detections(store, monkeypatch):
    """Unset is the shipping state and must be indistinguishable from today."""
    monkeypatch.delenv("GRADE_TICKER_CONFIRMED_SOURCE_ENABLED", raising=False)
    _v(store, "vcp", _today(), 1)
    assert _gt()._default_patterns_fn("NVDA") == []


def test_off_explicitly_returns_no_detections(store, monkeypatch):
    monkeypatch.setenv("GRADE_TICKER_CONFIRMED_SOURCE_ENABLED", "0")
    _v(store, "vcp", _today(), 1)
    assert _gt()._default_patterns_fn("NVDA") == []


def test_the_flag_is_read_per_call_not_captured_at_import(store, monkeypatch):
    """A module-level capture would make this a deploy-time decision and would
    pass every other test in this file."""
    _v(store, "vcp", _today(), 1)
    g = _gt()
    monkeypatch.delenv("GRADE_TICKER_CONFIRMED_SOURCE_ENABLED", raising=False)
    assert g._default_patterns_fn("NVDA") == []
    monkeypatch.setenv("GRADE_TICKER_CONFIRMED_SOURCE_ENABLED", "1")
    assert g._default_patterns_fn("NVDA") != [], "the same imported module must see the flip"


def test_on_serves_confirmed_rows_only(store, monkeypatch):
    monkeypatch.setenv("GRADE_TICKER_CONFIRMED_SOURCE_ENABLED", "1")
    _v(store, "vcp", _today(), 1, conf=91.0)
    _v(store, "bull_flag", _today(), 0)          # rejected
    _v(store, "flat_base", _today(), 0)          # rejected

    out = _gt()._default_patterns_fn("NVDA")
    assert [d["pattern_name"] for d in out] == ["vcp"], "a rejected setup reached the consumer"
    assert out[0]["confidence"] == 91.0


def test_on_never_serves_a_setup_rejected_on_a_newer_bar(store, monkeypatch):
    """The stale-confirm trap: confirmed yesterday, rejected today. Filtering
    `confirmed=1` first would return yesterday's row and the consumer would
    narrate it present-tense."""
    monkeypatch.setenv("GRADE_TICKER_CONFIRMED_SOURCE_ENABLED", "1")
    _v(store, "vcp", _yesterday(), 1)
    _v(store, "vcp", _today(), 0)
    assert _gt()._default_patterns_fn("NVDA") == []


def test_on_carries_key_level_and_NEVER_an_entry_or_stop(store, monkeypatch):
    """⛔ The fabrication guard. A verdict has ONE level. Manufacturing an entry
    and a stop from it would hand a member invented numbers wearing a confirmed
    judge's authority -- the exact move Seam 23 and Seam 28 each removed."""
    monkeypatch.setenv("GRADE_TICKER_CONFIRMED_SOURCE_ENABLED", "1")
    _v(store, "vcp", _today(), 1, key_level=123.45)
    levels = _gt()._default_patterns_fn("NVDA")[0]["levels"]
    assert levels == {"key_level": 123.45}
    assert "entry" not in levels and "stop" not in levels and "target_primary" not in levels


def test_confirmed_source_on_still_skips_because_verdicts_carry_no_levels(
        store, monkeypatch):
    """⛔⛔ THE HONEST LIMIT, PINNED ON PURPOSE.

    Turning this flag on makes the SOURCE correct and leaves the OUTPUT
    unchanged: `pattern_verdicts` has no entry/stop/target column, and
    grade_ticker's hard gate is `entry is None or stop is None -> SKIP`. So a
    confirmed setup alone cannot yield a tradable verdict, and Compass keeps
    declining rather than naming numbers it does not have.

    This test will go RED the day verdicts gain levels -- which is exactly when
    someone should come back and decide what the member-facing behaviour
    becomes. Until then, do not read the flag as "grade_ticker now grades".
    """
    monkeypatch.setenv("GRADE_TICKER_CONFIRMED_SOURCE_ENABLED", "1")
    _v(store, "vcp", _today(), 1, conf=95.0)

    out = _gt().grade_ticker(
        "NVDA", 50000.0,
        regime_fn=lambda: {"ok": True, "regime": "bull_trend"},
        quote_fn=lambda s: {"ok": True, "price": 100.0},
        playbook_fn=lambda n: {"ok": False},
        size_fn=lambda *a, **k: {"ok": False},
    )
    assert out["ok"] is True
    assert out["verdict"] == "SKIP"
    assert "no_setup" in out["hard_flags"]
    assert out["entry"] is None and out["stop"] is None
