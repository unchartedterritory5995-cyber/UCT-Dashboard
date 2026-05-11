"""Tests for the post-generation output validator + this_weeks_focus extractor."""
from __future__ import annotations


def _sample_data():
    """Minimal data dict — what assemble_day would produce."""
    return {
        "trader_profile": "",
        "memory": {"recent_eod_summaries": [], "last_weekly_summary": "", "this_weeks_focus": None},
        "today": {
            "date": "2026-05-11",
            "trades": [
                {"symbol": "NVDA", "side": "Long", "pnl_dollar": -140.0, "r_multiple": -1.4,
                 "mistake_tags": ["FOMO"], "emotion_tags": [], "regime": "AMBER",
                 "setup": "Bull Flag"},
                {"symbol": "AAPL", "side": "Long", "pnl_dollar": 420.0, "r_multiple": 2.1,
                 "mistake_tags": [], "emotion_tags": ["calm"], "regime": "AMBER",
                 "setup": "Pullback"},
            ],
            "aggregates": {
                "trade_count": 2, "wins": 1, "losses": 1, "bes": 0,
                "win_rate": 0.5, "avg_r": 0.35,
                "net_pnl_dollar": 280.0, "net_pnl_pct": 0.28,
            },
            "discipline_events": {"risk_cap_breaches": 0, "risk_cap_overrides": 0,
                                  "daily_loss_lockouts": 0, "cooling_off_fires": 1,
                                  "no_trade_window_blocks": 0, "a_plus_taken": 0},
            "open_positions": [],
        },
        "week_to_date": {"range": "2026-05-11 to 2026-05-11", "trade_count": 2,
                         "net_pnl_dollar": 280.0, "wins": 1, "losses": 1},
        "vs_yesterday": {"prior_day_net_pnl_dollar": 0.0},
        "recent_arcs": [],
        "feedback_signals": [],
    }


# ── Numeric grounding ─────────────────────────────────────────────────────────

def test_validator_passes_when_numbers_match_data():
    from api.services.journal_two import coach_validation as cv
    body = (
        "Today the FOMO entry on NVDA cost you 1.4R, while AAPL's clean Pullback "
        "delivered +2.1R for a net +$280. "
        "What was different about your read on AAPL vs NVDA this morning?"
    )
    result = cv.validate_eod_output(body, _sample_data())
    assert result["passed"] is True
    assert result["flags"] == []


def test_validator_flags_invented_r_multiple():
    from api.services.journal_two import coach_validation as cv
    body = (
        "Today the FOMO entry on NVDA cost you 5.9R, while AAPL delivered +2.1R for a net +$280. "
        "What was different about your read on AAPL vs NVDA?"
    )
    result = cv.validate_eod_output(body, _sample_data())
    assert result["passed"] is False
    assert any("5.9R" in f for f in result["flags"])


def test_validator_flags_invented_dollar_amount():
    from api.services.journal_two import coach_validation as cv
    body = (
        "Today's two trades netted +$9,999 on the back of a clean Pullback on AAPL. "
        "What about the Pullback worked today?"
    )
    result = cv.validate_eod_output(body, _sample_data())
    assert result["passed"] is False
    assert any("$9,999" in f or "9999" in f for f in result["flags"])


def test_validator_tolerates_rounding_in_numbers():
    """The validator allows 1-decimal-place tolerance. avg_r=0.35 should accept '+0.4R'."""
    from api.services.journal_two import coach_validation as cv
    body = (
        "Today netted +0.4R on average across the two trades. NVDA was -1.4R, AAPL +2.1R. "
        "What about today's setup picks worked?"
    )
    result = cv.validate_eod_output(body, _sample_data())
    # The "0.4R" rounds from 0.35 in data — should pass.
    assert result["passed"] is True, result["flags"]


# ── Symbol grounding ──────────────────────────────────────────────────────────

def test_validator_flags_invented_ticker():
    from api.services.journal_two import coach_validation as cv
    body = (
        "Today's setup picks were rough — TSLA was the late entry that cost you 1.4R. "
        "AAPL recovered with +2.1R. What's the read on TSLA vs AAPL?"
    )
    result = cv.validate_eod_output(body, _sample_data())
    # TSLA is not in any trade today.
    assert result["passed"] is False
    assert any("TSLA" in f for f in result["flags"])


def test_validator_ignores_common_uppercase_words():
    """Words like 'ET', 'EOD', 'YTD', 'FOMO', 'A' shouldn't trip the ticker check."""
    from api.services.journal_two import coach_validation as cv
    body = (
        "Today by EOD the FOMO entry on NVDA was -1.4R; AAPL recovered with +2.1R for "
        "a net +$280. Looks like A discipline tag is needed. "
        "What was different on the AAPL Pullback?"
    )
    result = cv.validate_eod_output(body, _sample_data())
    assert result["passed"] is True, result["flags"]


# ── Format compliance ─────────────────────────────────────────────────────────

def test_validator_flags_markdown_headers():
    from api.services.journal_two import coach_validation as cv
    body = (
        "## Today's Recap\n\n"
        "NVDA was -1.4R, AAPL +2.1R. "
        "What was different about the Pullback?"
    )
    result = cv.validate_eod_output(body, _sample_data())
    assert result["passed"] is False
    assert any("header" in f.lower() for f in result["flags"])


def test_validator_flags_bullet_points():
    from api.services.journal_two import coach_validation as cv
    body = (
        "Today's takeaways:\n- NVDA was -1.4R\n- AAPL was +2.1R\n"
        "What was different about the Pullback?"
    )
    result = cv.validate_eod_output(body, _sample_data())
    assert result["passed"] is False
    assert any("bullet" in f.lower() for f in result["flags"])


def test_validator_flags_missing_question():
    from api.services.journal_two import coach_validation as cv
    body = (
        "Today the FOMO entry on NVDA cost you 1.4R, while AAPL delivered +2.1R for a net +$280."
    )
    result = cv.validate_eod_output(body, _sample_data())
    assert result["passed"] is False
    assert any("question" in f.lower() for f in result["flags"])


def test_validator_flags_multiple_questions():
    """The reflective question must be the only `?` — multiple questions dilute focus."""
    from api.services.journal_two import coach_validation as cv
    body = (
        "Today's read: was the FOMO entry on NVDA worth it? It cost you 1.4R. AAPL's +2.1R covered. "
        "What about the Pullback worked today?"
    )
    result = cv.validate_eod_output(body, _sample_data())
    assert result["passed"] is False
    assert any("question" in f.lower() for f in result["flags"])


# ── Question rubric (light touch) ─────────────────────────────────────────────

def test_validator_flags_yes_no_question():
    from api.services.journal_two import coach_validation as cv
    body = (
        "Today the FOMO entry on NVDA cost you 1.4R, while AAPL delivered +2.1R. "
        "Did you feel rushed on the NVDA entry?"
    )
    result = cv.validate_eod_output(body, _sample_data())
    assert result["passed"] is False
    assert any("yes/no" in f.lower() or "yes-no" in f.lower() for f in result["flags"])


# ── this_weeks_focus extraction ──────────────────────────────────────────────

def test_extract_this_weeks_focus_standard_header():
    from api.services.journal_two import coach_validation as cv
    weekly_body = (
        "# Week of 2026-05-04 — Compass's Review\n\n"
        "Quiet week.\n\n"
        "## Performance\nNet P&L: +$500\n\n"
        "## This week's focus\n"
        "Skip Pullback setups entirely. You're -3.1R YTD on them.\n"
    )
    focus = cv.extract_this_weeks_focus(weekly_body)
    assert focus is not None
    assert "Skip Pullback" in focus


def test_extract_this_weeks_focus_with_colon():
    from api.services.journal_two import coach_validation as cv
    weekly_body = "## This week's focus:\nFocus content here.\n"
    focus = cv.extract_this_weeks_focus(weekly_body)
    assert focus == "Focus content here."


def test_extract_this_weeks_focus_case_insensitive():
    from api.services.journal_two import coach_validation as cv
    weekly_body = "## THIS WEEK'S FOCUS\nFocus content here.\n"
    focus = cv.extract_this_weeks_focus(weekly_body)
    assert focus == "Focus content here."


def test_extract_this_weeks_focus_returns_none_when_missing():
    from api.services.journal_two import coach_validation as cv
    weekly_body = "# Week\n\nNo focus section here.\n"
    assert cv.extract_this_weeks_focus(weekly_body) is None
