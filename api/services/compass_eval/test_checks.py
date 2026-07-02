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
