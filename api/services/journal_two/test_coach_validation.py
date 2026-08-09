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


def test_validator_accepts_symbols_referenced_in_recent_arcs():
    """Tickers named in arc strings must not be flagged as unverified."""
    from api.services.journal_two import coach_validation as cv
    data = _sample_data()
    data["recent_arcs"] = ["3 consecutive losses on Bull Flag (TSLA, CRWD)"]
    body = (
        "Today the FOMO entry on NVDA was -1.4R; AAPL recovered with +2.1R. "
        "The losing streak on TSLA and CRWD this week is the bigger pattern — "
        "what was different about today's AAPL Pullback?"
    )
    result = cv.validate_eod_output(body, data)
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


def test_validator_flags_numbered_list():
    from api.services.journal_two import coach_validation as cv
    body = (
        "Today's takeaways:\n1. NVDA was -1.4R\n2. AAPL was +2.1R\n"
        "What was different about the Pullback?"
    )
    result = cv.validate_eod_output(body, _sample_data())
    assert result["passed"] is False
    assert any("list" in f.lower() or "numbered" in f.lower() for f in result["flags"])


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


def test_validator_flags_yes_no_when_question_is_entire_body():
    """Body with no preceding period/newline still detects yes/no opener."""
    from api.services.journal_two import coach_validation as cv
    body = "Did you size up too aggressively on the NVDA entry?"
    result = cv.validate_eod_output(body, _sample_data())
    # This will fail on yes/no AND on symbol grounding (NVDA is fine), but it's
    # the yes/no flag we care about here.
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


# ── Matcher precision (D-1) ──────────────────────────────────────────────────
#
# The old matcher accepted anything within a FLAT +-0.0501 of any number
# anywhere in the corpus, and seeded that corpus with every value AND its
# abs(). Over a payload of a few dozen trades that set is dense enough that a
# fabricated figure very likely lands inside the window. The tolerance is now
# half a unit in the last place the CLAIM itself wrote, because rounding is the
# only legitimate reason a stated number differs from ground truth.

def _numbers(*vals) -> dict:
    """A tool-results corpus holding exactly these numbers (plus the NVDA
    symbol, so the ticker check doesn't confound the numeric assertions)."""
    return {"tool_results": [{"symbol": "NVDA"}] + [{"v": v} for v in vals]}


def test_a_two_decimal_claim_gets_a_two_decimal_window():
    from api.services.journal_two import coach_validation as cv
    # 187.42 vs a real 187.40: inside the old +-0.0501 window, outside the
    # precision the claim asserts.
    assert cv.validate_chat_output("NVDA is $187.42.", _numbers(187.40))["passed"] is False
    assert cv.validate_chat_output("NVDA is $187.40.", _numbers(187.40))["passed"] is True


def test_rounding_to_fewer_places_is_still_honest():
    from api.services.journal_two import coach_validation as cv
    for claim in ("$187.4", "$187"):
        out = cv.validate_chat_output(f"NVDA is {claim}.", _numbers(187.40))
        assert out["passed"] is True, (claim, out["flags"])


def test_a_claim_that_writes_its_own_sign_must_match_that_sign():
    from api.services.journal_two import coach_validation as cv
    # "+1.4R" asserts a winner against a stored -1.4R loss.
    assert cv.validate_chat_output("You banked +1.4R.", _numbers(-1.4))["passed"] is False
    assert cv.validate_chat_output("You took -1.4R.", _numbers(-1.4))["passed"] is True


def test_an_unsigned_claim_carries_its_sign_in_the_prose():
    from api.services.journal_two import coach_validation as cv
    out = cv.validate_chat_output("That FOMO entry cost you 1.4R.", _numbers(-1.4))
    assert out["passed"] is True, out["flags"]


def test_four_digit_dollar_amounts_parse_whole():
    """The comma-grouped branch used `*`, so it matched the first 1-3 digits of
    any ungrouped amount and stopped: '$1000.00' parsed as $100."""
    from api.services.journal_two import coach_validation as cv
    assert cv._to_float("$1000.00") == 1000.0
    assert cv._to_float("$50000") == 50000.0
    assert cv._to_float("$1,234.56") == 1234.56
    assert cv.validate_chat_output("Net was $1000.00.", _numbers(1000.0))["passed"] is True


def test_magnitude_suffixes_scale_value_and_window():
    from api.services.journal_two import coach_validation as cv
    assert cv._to_float("$1.2K") == 1200.0
    assert cv._to_float("$100M") == 100_000_000.0
    # "$1.2K" asserts one decimal at the thousands scale -> +-50.
    assert cv.validate_chat_output("Risked $1.2K.", _numbers(1230.0))["passed"] is True
    assert cv.validate_chat_output("Risked $1.2K.", _numbers(1400.0))["passed"] is False


def test_numbers_written_as_strings_in_a_tool_payload_are_ground_truth():
    from api.services.journal_two import coach_validation as cv
    data = {"tool_results": [{"symbol": "NVDA", "price": "187.40",
                              "note": "closed at $183.18"}]}
    out = cv.validate_chat_output("NVDA is $187.40, up from $183.18.", data)
    assert out["passed"] is True, out["flags"]


def test_a_date_in_a_payload_does_not_seed_the_corpus_with_its_parts():
    from api.services.journal_two import coach_validation as cv
    data = {"tool_results": [{"as_of": "2026-05-11"}]}
    # 11 would be "grounded" if the date were shredded into components.
    assert cv.validate_chat_output("You're up 11%.", data)["passed"] is False


def test_symbols_are_found_wherever_the_payload_puts_them():
    from api.services.journal_two import coach_validation as cv
    for data in (
        {"tool_results": [{"symbol": "nvda"}]},
        {"tool_results": [{"underlying": "NVDA"}]},
        {"tool_results": [{"NVDA": {"price": 1.0}}]},
        {"tool_results": [{"headline": "NVDA guides higher"}]},
        {"tool_results": [{"rows": [{"ticker": "NVDA"}]}]},
    ):
        out = cv.validate_chat_output("NVDA looks constructive.", data)
        assert out["passed"] is True, (data, out["flags"])


def test_an_unmentioned_symbol_is_still_flagged():
    from api.services.journal_two import coach_validation as cv
    data = {"tool_results": [{"symbol": "NVDA", "price": 187.40}]}
    out = cv.validate_chat_output("NVDA is $187.40; PLTR is the cleaner base.", data)
    assert out["passed"] is False
    assert any("PLTR" in f for f in out["flags"]), out["flags"]


def test_both_validators_share_one_grounding_implementation():
    """A rule implemented twice is a rule that drifts. EOD and chat carried
    byte-identical copies of the numeric+symbol block; they must not again."""
    import ast
    import inspect
    from api.services.journal_two import coach_validation as cv
    tree = ast.parse(inspect.getsource(cv))
    for fn in ("validate_eod_output", "validate_chat_output"):
        node = next(n for n in tree.body
                    if isinstance(n, ast.FunctionDef) and n.name == fn)
        called = {c.func.id for c in ast.walk(node)
                  if isinstance(c, ast.Call) and isinstance(c.func, ast.Name)}
        assert "_grounding_flags" in called, f"{fn} does not use the shared core"
        assert "_data_numbers" not in called, f"{fn} re-derives the corpus itself"
