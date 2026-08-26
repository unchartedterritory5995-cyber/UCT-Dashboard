"""The context line under a Discord chart: composition + the cached entry point.

Every fetcher is injected: none of these tests reach the earnings table, the
options chain or the catalysts store."""
from __future__ import annotations

import datetime as dt

import pytest

from api.services import discord_chart_context as cc

TODAY = dt.date(2026, 11, 7)      # a Saturday; report Thu Nov 19 is 12 days out


@pytest.fixture(autouse=True)
def _fresh():
    cc.clear_for_tests()
    yield
    cc.clear_for_tests()


# ── compose (pure) ──

def test_compose_reads_earnings_implied_and_catalyst_into_one_line():
    line = cc.compose("NVDA", today=TODAY,
                      earnings={"report_date": "2026-11-19", "eps_estimate": 1.25},
                      implied={"pct": 8.06, "dollar": 15.2, "expiry": "2026-11-21"},
                      catalyst={"rank": 2, "tag": "Earnings", "thesis_text": "**Blackwell** ramp is the whole story. Second sentence."})
    assert line == "Earnings Thu Nov 19 (in 12d) · ±8.1% implied · Catalyst #2 (Earnings): Blackwell ramp is the whole story."


def test_compose_words_today_and_tomorrow_and_drops_a_past_report():
    assert cc.compose("X", today=TODAY, earnings={"report_date": "2026-11-07"}, implied={"pct": 5}) == "Earnings TODAY · ±5.0% implied"
    assert cc.compose("X", today=TODAY, earnings={"report_date": "2026-11-08"}) == "Earnings tomorrow"
    assert cc.compose("X", today=TODAY, earnings={"report_date": "2026-11-06"}) == ""
    assert cc.compose("X", today=TODAY, earnings={"report_date": "garbage"}) == ""
    assert cc.compose("X", today=TODAY) == ""


def test_compose_only_quotes_the_straddle_inside_the_implied_window():
    far = {"report_date": (TODAY + dt.timedelta(days=cc.IMPLIED_WINDOW_DAYS + 1)).isoformat()}
    assert "implied" not in cc.compose("X", today=TODAY, earnings=far, implied={"pct": 9.9})
    edge = {"report_date": (TODAY + dt.timedelta(days=cc.IMPLIED_WINDOW_DAYS)).isoformat()}
    assert "±9.9% implied" in cc.compose("X", today=TODAY, earnings=edge, implied={"pct": 9.9})
    assert "implied" not in cc.compose("X", today=TODAY, earnings=edge, implied={"pct": None})
    assert "implied" not in cc.compose("X", today=TODAY, earnings=edge, implied={"pct": "n/a"})


def test_compose_catalyst_is_first_sentence_markdown_stripped_and_the_line_is_capped():
    cat = {"rank": 1, "tag": "Catalyst", "thesis_text": "$NVDA rips " + "very " * 80 + "hard. Then more."}
    line = cc.compose("NVDA", today=TODAY, catalyst=cat)
    assert line.startswith("Catalyst #1: $NVDA rips very")      # the tag is dropped when it just says "Catalyst"
    assert len(line) <= cc.MAX_LEN and line.endswith("…")
    assert cc.compose("X", today=TODAY, catalyst={"rank": None, "tag": "", "thesis_text": "No clear catalyst."}) == "Catalyst: No clear catalyst."
    assert cc.compose("X", today=TODAY, catalyst={"rank": 3, "thesis_text": ""}) == ""
    # earnings text keeps its room when the catalyst is long
    both = cc.compose("X", today=TODAY, earnings={"report_date": "2026-11-19"}, catalyst=cat)
    assert both.startswith("Earnings Thu Nov 19 (in 12d) · Catalyst #1") and len(both) <= cc.MAX_LEN
    # a tag that is NOT the generic word still shows
    assert "(Earnings)" in cc.compose("X", today=TODAY, catalyst={"rank": 2, "tag": "Earnings", "thesis_text": "Beat and raised."})


# ── context_line (cached entry point) ──

def test_context_line_caches_per_ticker_and_asks_the_chain_only_near_the_report():
    calls = []
    def earnings_fn(t, today):
        calls.append(("earnings", t)); return {"report_date": "2026-11-19"}
    def implied_fn(t, d):
        calls.append(("implied", t, d)); return {"pct": 7.25}
    def catalyst_fn(t, today):
        calls.append(("catalyst", t)); return None
    line = cc.context_line("nvda", today=TODAY, earnings_fn=earnings_fn, implied_fn=implied_fn, catalyst_fn=catalyst_fn)
    assert line == "Earnings Thu Nov 19 (in 12d) · ±7.2% implied"
    assert calls == [("earnings", "NVDA"), ("implied", "NVDA", "2026-11-19"), ("catalyst", "NVDA")]
    assert cc.context_line("NVDA", today=TODAY, earnings_fn=earnings_fn, implied_fn=implied_fn, catalyst_fn=catalyst_fn) == line
    assert len(calls) == 3                                                   # cached: no second round of lookups
    # a report far out never opens the options chain
    calls.clear()
    far = lambda t, today: {"report_date": "2027-02-25"}
    assert cc.context_line("AMD", today=TODAY, earnings_fn=far, implied_fn=implied_fn, catalyst_fn=catalyst_fn) == "Earnings Thu Feb 25 (in 110d)"
    assert [c[0] for c in calls] == ["catalyst"]


def test_context_line_never_raises_and_a_failed_part_only_loses_itself():
    def boom(*a):
        raise RuntimeError("provider down")
    cat = lambda t, today: {"rank": 4, "tag": "News", "thesis_text": "Upgraded at Bernstein."}
    assert cc.context_line("X", today=TODAY, earnings_fn=boom, implied_fn=boom, catalyst_fn=cat) == "Catalyst #4 (News): Upgraded at Bernstein."
    assert cc.context_line("Y", today=TODAY, earnings_fn=lambda t, d: {"report_date": "2026-11-10"}, implied_fn=boom, catalyst_fn=boom) == "Earnings Tue Nov 10 (in 3d)"
    assert cc.context_line("Z", today=TODAY, earnings_fn=boom, implied_fn=boom, catalyst_fn=boom) == ""
    assert cc.context_line("", today=TODAY, earnings_fn=boom, implied_fn=boom, catalyst_fn=boom) == ""


def test_default_earnings_fetcher_uses_the_cards_next_report_date_not_the_forward_rows(monkeypatch):
    """Pod measurement 2026-08-25: the table's forward rows had report_date=None
    for NVDA two days before its report; _next_report_date had it."""
    from api.services import earnings_table
    monkeypatch.setattr(earnings_table, "get_earnings_table", lambda t: pytest.fail("the forward rows are not the date source"))
    monkeypatch.setattr(earnings_table, "_next_report_date", lambda t: "2026-11-19")
    assert cc._next_earnings("NVDA", TODAY) == {"report_date": "2026-11-19"}
    monkeypatch.setattr(earnings_table, "_next_report_date", lambda t: "2026-11-06")      # already reported
    assert cc._next_earnings("NVDA", TODAY) is None
    monkeypatch.setattr(earnings_table, "_next_report_date", lambda t: None)
    assert cc._next_earnings("NVDA", TODAY) is None


def test_flag_defaults_on_and_turns_off_explicitly(monkeypatch):
    monkeypatch.delenv("DISCORD_CHART_CONTEXT", raising=False)
    assert cc.enabled()
    for off in ("0", "off", "false", ""):
        monkeypatch.setenv("DISCORD_CHART_CONTEXT", off)
        assert not cc.enabled()
