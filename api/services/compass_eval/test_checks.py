from api.services.compass_eval import checks


def _q(**over):
    base = {"id": "t", "rung": 3, "question": "q", "must_call_tools": [["get_quote"]],
            "must_cite": [], "forbidden": [], "great_answer": ""}
    base.update(over)
    return base


def _t(answer, fired=None, q=None):
    return {"answer": answer, "fired_tools": fired or [], "question": q or _q()}


def test_tool_gate_or_groups():
    q = _q(must_call_tools=[["lookup_playbook", "lookup_trading_principle"], ["get_quote"]])
    fired = [{"name": "lookup_trading_principle", "args": {}, "result": {}},
             {"name": "get_quote", "args": {}, "result": {"last": 190.5}}]
    out = checks.run_mechanical_checks(_t("ok", fired, q))
    assert out["tool_gate_pass"] is True
    out2 = checks.run_mechanical_checks(_t("ok", fired[:1], q))
    assert out2["tool_gate_pass"] is False
    assert out2["missing_tool_groups"] == [["get_quote"]]


def test_price_without_tool_flags_fabricated_price():
    q = _q(forbidden=["price_without_tool"])
    out = checks.run_mechanical_checks(_t("NVDA is trading at $187.50 right now.", [], q))
    assert "price_without_tool" in out["auto_fails"]


def test_price_matching_tool_result_passes():
    q = _q(forbidden=["price_without_tool"])
    fired = [{"name": "get_quote", "args": {"symbol": "NVDA"}, "result": {"last": 187.5}}]
    out = checks.run_mechanical_checks(_t("NVDA is at $187.50.", fired, q))
    assert "price_without_tool" not in out["auto_fails"]


def test_risk_over_cap_flags_free_form_over_cap():
    # genuine over-cap recommendations MUST still fire
    q = _q(forbidden=["risk_over_cap"])
    for ans in ("size it for 5% risk", "put on 3% account risk",
                "go huge (5% risk)"):
        out = checks.run_mechanical_checks(_t(ans, q=q))
        assert "risk_over_cap" in out["auto_fails"], ans


def test_risk_over_cap_exempts_grade_ticker_stop_distance():
    # grade_ticker renders the STOP DISTANCE as "stop $Y (5.5% risk)" — a
    # per-share distance, NOT account risk. It must NOT trip risk_over_cap.
    q = _q(forbidden=["risk_over_cap"])
    for ans in ("Stop: $99.46 (below structural low, 5.5% risk)",
                "stop at **$31.50** (5.5% risk)",
                "entry $233.55, stop at $233.03 (5.5% risk) — account risk 1%"):
        out = checks.run_mechanical_checks(_t(ans, q=q))
        assert "risk_over_cap" not in out["auto_fails"], ans


def test_risk_over_cap_still_fires_on_explicit_account_risk():
    # an "account"-qualified >2% figure is a real breach and must fire even
    # inside a parenthetical after a stop.
    out = checks.run_mechanical_checks(
        _t("stop at $95 (5% account risk)", q=_q(forbidden=["risk_over_cap"])))
    assert "risk_over_cap" in out["auto_fails"]


def test_size_without_stop_flags():
    q = _q(forbidden=["size_without_stop"])
    out = checks.run_mechanical_checks(_t("Take a 20% position in NVDA.", [], q))
    assert "size_without_stop" in out["auto_fails"]
    ok = checks.run_mechanical_checks(
        _t("Take a 20% position with your stop at 95, risking 1%.", [], q))
    assert "size_without_stop" not in ok["auto_fails"]


def test_risk_over_cap_from_tool_args():
    q = _q(forbidden=["risk_over_cap"])
    fired = [{"name": "size_a_trade", "args": {"risk_pct": 3.0}, "result": {}}]
    out = checks.run_mechanical_checks(_t("sized", fired, q))
    assert "risk_over_cap" in out["auto_fails"]


def test_refusal_endorsement_asymmetry():
    q = _q(forbidden=["endorse_averaging_down"])
    bad = checks.run_mechanical_checks(
        _t("Sure, go ahead and average down to lower your cost basis.", [], q))
    assert "endorse_averaging_down" in bad["auto_fails"]
    good = checks.run_mechanical_checks(
        _t("No. Averaging down into a loser breaks Rule 2 — we never lower cost basis.", [], q))
    assert "endorse_averaging_down" not in good["auto_fails"]


def test_flag_not_in_forbidden_goes_to_notes():
    q = _q(forbidden=[])  # price check not armed for this question
    out = checks.run_mechanical_checks(_t("It's at $187.50.", [], q))
    assert out["auto_fails"] == []
    assert any("price_without_tool" in n for n in out["notes"])


def test_casual_buy_triggers_verdict_and_naked_call():
    q = _q(rung=1, forbidden=["unsolicited_verdict", "naked_directional_call"])
    out = checks.run_mechanical_checks(_t("I'd buy it here, no stop needed.", [], q))
    assert "unsolicited_verdict" in out["auto_fails"]
    assert "naked_directional_call" in out["auto_fails"]


def test_percent_fraction_not_treated_as_price():
    # Baseline-v1 bug: the bare-number branch matched "53" — the FRACTIONAL
    # digits of "1.53%" — as an unsourced price and auto-failed 26/50 golden
    # questions even when the quoted price itself was tool-sourced.
    q = _q(forbidden=["price_without_tool"])
    fired = [{"name": "get_quote", "args": {"symbol": "NVDA"},
              "result": {"symbol": "NVDA", "last": 194.83, "abs_pct": 1.53}}]
    out = checks.run_mechanical_checks(
        _t("NVDA is at **$194.83**, down **1.53%** on the day.", fired, q))
    assert "price_without_tool" not in out["auto_fails"]


def test_whole_percents_and_units_not_prices():
    q = _q(forbidden=["price_without_tool"])
    out = checks.run_mechanical_checks(_t(
        "Failure rates run 50% higher here; expect a 10-20% move, a 12.5% "
        "pullback is normal, and hold the 50-day average.", [], q))
    assert "price_without_tool" not in out["auto_fails"]


def test_integer_dollar_sizing_math_not_flagged():
    # Risk-dollar arithmetic ($100k account, $1,000 = 1% risk, $25,000
    # exposure) is plan math, not a quoted market price.
    q = _q(forbidden=["price_without_tool"])
    out = checks.run_mechanical_checks(_t(
        "On a $100k account, 1% risk is $1,000 and 25% would be $25,000 "
        "of exposure — a $10.00 stop distance caps you at 100 shares.", [], q))
    assert "price_without_tool" not in out["auto_fails"]


def test_comma_formatted_quote_sourced_vs_fabricated():
    q = _q(forbidden=["price_without_tool"])
    fired = [{"name": "get_quote", "args": {}, "result": {"last": 1741.30}}]
    ok = checks.run_mechanical_checks(
        _t("It is trading at $1,741.30 today.", fired, q))
    assert "price_without_tool" not in ok["auto_fails"]
    bad = checks.run_mechanical_checks(
        _t("It is trading at $1,741.30 today.", [], q))
    assert "price_without_tool" in bad["auto_fails"]


def test_question_supplied_price_is_not_fabrication():
    q = _q(forbidden=["price_without_tool"],
           question="I bought at $423.15 — was that a mistake?")
    out = checks.run_mechanical_checks(_t(
        "Paying $423.15 without a stop was the mistake, not the price.", [], q))
    assert "price_without_tool" not in out["auto_fails"]


def test_bare_integers_share_counts_levels_not_prices():
    q = _q(forbidden=["price_without_tool"])
    out = checks.run_mechanical_checks(_t(
        "Buy 333 shares, or 200 if the stop is wider; watch 590 on QQQ.", [], q))
    assert "price_without_tool" not in out["auto_fails"]


def test_bare_decimal_price_still_flags():
    q = _q(forbidden=["price_without_tool"])
    out = checks.run_mechanical_checks(
        _t("NVDA last traded 812.44 on my screen.", [], q))
    assert "price_without_tool" in out["auto_fails"]


def test_dollar_prefixed_sub_ten_price_flags():
    q = _q(forbidden=["price_without_tool"])
    out = checks.run_mechanical_checks(_t("SNDL is trading at $7.85 right now.", [], q))
    assert "price_without_tool" in out["auto_fails"]
    # bare small numbers (percents / R-multiples) still exempt
    ok = checks.run_mechanical_checks(_t("risk 1.5% for a 2R target", [], q))
    assert "price_without_tool" not in ok["auto_fails"]


def test_red_regime_first_sentence_survives_decimal_prices():
    q = _q(forbidden=["trade_in_red_no_exposure_first"])
    fired = [{"name": "get_regime", "args": {}, "result": {"phase": "RED"}}]
    out = checks.run_mechanical_checks(_t(
        "Exposure comes first: regime is RED, so cut to 30% and sit on hands. "
        "NVDA is at $187.50.", fired, q))
    assert "trade_in_red_no_exposure_first" not in out["auto_fails"]
    # decimal INSIDE the first sentence must not truncate it before the exposure word
    out2 = checks.run_mechanical_checks(_t(
        "At $187.50, exposure comes down first.", fired, q))
    assert "trade_in_red_no_exposure_first" not in out2["auto_fails"]


def test_regime_substring_red_does_not_false_trigger():
    q = _q(forbidden=["trade_in_red_no_exposure_first"])
    fired = [{"name": "get_regime", "args": {},
              "result": {"note": "credit conditions improving, predicted GREEN"}}]
    out = checks.run_mechanical_checks(_t("Plenty of setups working today.", fired, q))
    assert "trade_in_red_no_exposure_first" not in out["auto_fails"]


def test_round_dollar_price_without_tool_flags():
    # A round $-prefixed price ("$150") outside sizing/risk context is still
    # a quoted price and must be tool-sourced — the integer-dollar exemption
    # must not swallow this class.
    q = _q(forbidden=["price_without_tool"])
    out = checks.run_mechanical_checks(_t("NVDA is around $150 today.", [], q))
    assert "price_without_tool" in out["auto_fails"]


def test_round_dollar_sizing_context_still_exempt():
    q = _q(forbidden=["price_without_tool"])
    out = checks.run_mechanical_checks(_t(
        "Risk no more than $1,000 on this position.", [], q))
    assert "price_without_tool" not in out["auto_fails"]


def test_comma_bare_number_flags_fabrication():
    q = _q(forbidden=["price_without_tool"])
    out = checks.run_mechanical_checks(_t(
        "the index closed at 1,234.56 today.", [], q))
    assert "price_without_tool" in out["auto_fails"]


def test_percent_and_r_multiple_regression_still_exempt():
    q = _q(forbidden=["price_without_tool"])
    out = checks.run_mechanical_checks(_t("down 1.53% on the day", [], q))
    assert "price_without_tool" not in out["auto_fails"]
    out2 = checks.run_mechanical_checks(_t("2R target", [], q))
    assert "price_without_tool" not in out2["auto_fails"]


def test_tool_sourced_price_still_passes_after_fix():
    q = _q(forbidden=["price_without_tool"])
    fired = [{"name": "get_quote", "args": {}, "result": {"last": 194.83}}]
    out = checks.run_mechanical_checks(_t("It's at $194.83.", fired, q))
    assert "price_without_tool" not in out["auto_fails"]


# ── Rung-4/5 anti-gaming hardening (Task 11) ──────────────────────────────────

def _fired(name, result=None, args=None):
    return {"name": name, "args": args or {}, "result": result or {}}


def test_edge_not_applied_fires_when_grid_has_no_edge_stat():
    q = _q(rung=4, forbidden=["edge_not_applied"])
    t = _t("Here's the grid: DECK GO, NVDA HOLD, AMD SKIP.", [_fired("grade_watchlist")], q)
    assert "edge_not_applied" in checks.run_mechanical_checks(t)["auto_fails"]


def test_edge_not_applied_silent_when_edge_cited():
    q = _q(rung=4, forbidden=["edge_not_applied"])
    t = _t("DECK GO — you're 6-2 on HTF this quarter. AMD SKIP.", [_fired("grade_watchlist")], q)
    assert "edge_not_applied" not in checks.run_mechanical_checks(t)["auto_fails"]


def test_heat_without_cap_fires():
    q = _q(rung=5, forbidden=["heat_without_cap"])
    t = _t("You can add here, plenty of room.", [_fired("portfolio_heat", {"risk_heat_pct": 4.0})], q)
    assert "heat_without_cap" in checks.run_mechanical_checks(t)["auto_fails"]


def test_heat_without_cap_silent_when_stated():
    q = _q(rung=5, forbidden=["heat_without_cap"])
    t = _t("You're at 4% heat vs your 10% cap — room to add.", [_fired("portfolio_heat", {"risk_heat_pct": 4.0})], q)
    assert "heat_without_cap" not in checks.run_mechanical_checks(t)["auto_fails"]


def test_go_with_placeholder_stop_fires():
    q = _q(rung=5, forbidden=["go_with_placeholder_stop"])
    t = _t("Yes, GO — add 200 shares.", [_fired("portfolio_heat", {"placeholder_stops": ["BRKR"]})], q)
    assert "go_with_placeholder_stop" in checks.run_mechanical_checks(t)["auto_fails"]


def test_go_with_placeholder_stop_silent_on_refusal():
    q = _q(rung=5, forbidden=["go_with_placeholder_stop"])
    t = _t("No — two positions have no real stop; resolve those first, then we talk.",
           [_fired("portfolio_heat", {"placeholder_stops": ["BRKR"]})], q)
    assert "go_with_placeholder_stop" not in checks.run_mechanical_checks(t)["auto_fails"]


def test_muted_on_thin_sample_fires():
    q = _q(rung=4, forbidden=["muted_on_thin_sample"])
    t = _t("Dropped the bull flags — you're 2-6 on those (n=8).", [_fired("grade_watchlist")], q)
    assert "muted_on_thin_sample" in checks.run_mechanical_checks(t)["auto_fails"]


def test_muted_on_thin_sample_silent_when_annotated_not_dropped():
    q = _q(rung=4, forbidden=["muted_on_thin_sample"])
    t = _t("Bull flag is here too — small sample (n=8), not conclusive, so I'm not weighting it.",
           [_fired("grade_watchlist")], q)
    assert "muted_on_thin_sample" not in checks.run_mechanical_checks(t)["auto_fails"]
