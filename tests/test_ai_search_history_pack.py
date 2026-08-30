"""The historical-session pack (2026-08-29).

The single most-asked shape in the prod capture log, by a wide margin:

    "What were the major news headlines and catalysts that moved INTC on
     2025-09-18? Give the specific % move that day, the driving story, and
     any analyst actions."

43 of 50 logged asks classify catalyst-news, and the top question templates are
all of this form. The log shows the desk answering one of them with:

    "I don't have historical, date-stamped tape or news logs for Rush Street
     Interactive on 2026-04-27, so I can't give you a precise % move"

…while `bars.db` on that same pod holds the daily bar for that session. The desk
apologised for data it was sitting on. This pack hands it over.

⛔ The load-bearing rail here is the ANTI-FABRICATION one: if the named date had
no session, the pack must say NOTHING rather than label a nearby session's bar
with the date the member asked about. A wrong number is worse than no number.
"""
import re

import pytest

import api.routers.ai_search as ai


def _stub_bars(monkeypatch, rows):
    """rows = [(ts_yyyymmdd, o, h, l, c, v), …] oldest-first, as bars_sqlite returns."""
    from api.services import bars_sqlite
    monkeypatch.setattr(bars_sqlite, "get_bars_before",
                        lambda ticker, tf, max_bars, to_key: list(rows))


# ── the date the member named ───────────────────────────────────────────────
def test_an_iso_date_in_the_question_is_recognised():
    assert ai._hist_date_ymd("what moved INTC on 2025-09-18?") == 20250918


def test_a_question_with_no_date_recognises_none():
    """CONTROL — the pack must not fire (or pay for a DB read) on every ask."""
    assert ai._hist_date_ymd("what is INTC doing?") is None


def test_todays_date_is_left_to_the_live_quote():
    """CONTROL — today is the live quote pack's job. A historical bar for today
    would be a stale duplicate of a number the desk already has fresher."""
    today = ai._et_day()          # the router's own definition of "today" (ET),
                                  # so this cannot flake across a midnight boundary
    assert ai._hist_date_ymd(f"what moved INTC on {today}?") is None


def test_a_future_date_is_not_a_history_lookup():
    """CONTROL — "reporting on 2099-01-01" must never read as a past session."""
    assert ai._hist_date_ymd("does INTC report on 2099-01-01?") is None


# ── the pack itself ─────────────────────────────────────────────────────────
def test_a_dated_question_attaches_that_sessions_bar(monkeypatch):
    """Fails while the pack does not exist. This is the most-asked question
    shape in the log answering itself from desk data."""
    _stub_bars(monkeypatch, [
        (20250917, 24.0, 24.5, 23.8, 24.00, 50_000_000),
        (20250918, 24.1, 26.0, 24.0, 25.20, 120_000_000),
    ])
    out = ai._ctx_history("what moved INTC on 2025-09-18?", ["INTC"])
    assert "INTC" in out and "2025-09-18" in out
    assert "25.2" in out            # that session's close
    assert "120" in out or "120.0M" in out or "120,000,000" in out


def test_the_move_is_measured_against_the_prior_close(monkeypatch):
    """"the specific % move that day" means close vs PRIOR close — what a
    trader means by a day's move. Open-to-close would be a different number
    and would quietly answer a question nobody asked."""
    _stub_bars(monkeypatch, [
        (20250917, 24.0, 24.5, 23.8, 24.00, 50_000_000),
        (20250918, 24.1, 26.0, 24.0, 25.20, 120_000_000),
    ])
    out = ai._ctx_history("what moved INTC on 2025-09-18?", ["INTC"])
    assert "+5.0" in out, out       # 24.00 -> 25.20


def test_a_date_with_no_session_reports_nothing(monkeypatch):
    """⛔ THE anti-fabrication rail. 2025-09-20 is a Saturday; the newest bar
    at/before it is Friday's. Labelling Friday's bar with the date the member
    typed is exactly the fabricated-precision failure the desk exists to avoid."""
    _stub_bars(monkeypatch, [
        (20250918, 24.1, 26.0, 24.0, 25.20, 120_000_000),
        (20250919, 25.3, 25.9, 25.0, 25.50, 90_000_000),
    ])
    out = ai._ctx_history("what moved INTC on 2025-09-20?", ["INTC"])
    assert out == "", out


def test_no_bars_at_all_reports_nothing(monkeypatch):
    """A ticker we hold no history for must produce silence, never a zero."""
    _stub_bars(monkeypatch, [])
    assert ai._ctx_history("what moved ZZZZ on 2025-09-18?", ["ZZZZ"]) == ""


def test_a_lone_session_reports_the_bar_without_inventing_a_move(monkeypatch):
    """CONTROL — with no prior close there is no % move. The bar is still worth
    handing over; the percentage must simply be absent."""
    _stub_bars(monkeypatch, [
        (20250918, 24.1, 26.0, 24.0, 25.20, 120_000_000),
    ])
    out = ai._ctx_history("what moved INTC on 2025-09-18?", ["INTC"])
    assert "25.2" in out
    assert "%" not in out, out


def test_no_date_means_no_pack_and_no_db_read(monkeypatch):
    """CONTROL — proves the gate, and that an undated ask pays nothing."""
    from api.services import bars_sqlite

    def _boom(*a, **k):
        raise AssertionError("undated question must not touch bars.db")
    monkeypatch.setattr(bars_sqlite, "get_bars_before", _boom)
    assert ai._ctx_history("what is INTC doing today?", ["INTC"]) == ""


# ── built, tested, green… and reachable ─────────────────────────────────────
def test_the_history_pack_is_wired_into_the_assembler():
    """lesson_built_tested_green_and_unreachable: a pack the assembler never
    calls is a green test file attached to nothing. Read the router's source
    for the call rather than trusting that I wired it."""
    import io
    src = io.open(ai.__file__, encoding="utf-8").read()
    body = src.split("def _uct_context", 1)[1].split("\ndef ", 1)[0]
    assert "_ctx_history(" in body, "_ctx_history is never called by _uct_context"


def test_the_reachability_probe_is_not_vacuous():
    """CONTROL — prove the slice above really is _uct_context's body by finding
    a pack that is unquestionably assembled there."""
    import io
    src = io.open(ai.__file__, encoding="utf-8").read()
    body = src.split("def _uct_context", 1)[1].split("\ndef ", 1)[0]
    assert "_ctx_cot(" in body
