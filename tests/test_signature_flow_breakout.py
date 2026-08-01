from api.services.signature.flow_breakout import detect_breakouts, flow_confirms, fcb_signals


def _bars_flat_then_break(n=25, base=100.0):
    """n flat bars then one closing above the 20-bar high on 2x volume."""
    bars = [
        {"t": 86400 * i, "o": base, "h": base + 1, "l": base - 1, "c": base, "v": 1_000_000}
        for i in range(n)
    ]
    bars.append({"t": 86400 * n, "o": base, "h": base + 5, "l": base,
                 "c": base + 4, "v": 2_000_000})
    bars.append({"t": 86400 * (n + 1), "o": base + 4, "h": base + 4.5,
                 "l": base + 3, "c": base + 4.2, "v": 900_000})  # confirms the breakout bar
    return bars


def test_detects_confirmed_bull_breakout_only():
    sigs = detect_breakouts(_bars_flat_then_break())
    assert len(sigs) == 1
    assert sigs[0]["direction"] == "bull"
    assert sigs[0]["barTime"] == 86400 * 25


def test_forming_last_bar_is_never_evaluated_without_flag():
    bars = _bars_flat_then_break()[:-1]  # breakout bar is the LAST bar
    assert detect_breakouts(bars) == []                      # closed-bar rule
    assert len(detect_breakouts(bars, include_last=True)) == 1  # nightly sweep mode


def test_low_volume_breakout_rejected():
    bars = _bars_flat_then_break()
    bars[25]["v"] = 1_000_000  # exactly avg, below 1.25x
    assert detect_breakouts(bars) == []


def test_flow_confirmation_thresholds():
    rows = [{"CallPut": "CALL", "Premium": "400000"}, {"CallPut": "CALL", "Premium": "$200K"},
            {"CallPut": "PUT", "Premium": "100000"}]
    r = flow_confirms(rows, "bull")
    assert r["confirmed"] is True and r["callPrem"] == 600_000.0
    assert flow_confirms(rows[:1], "bull")["confirmed"] is False  # under $500k


def test_fcb_join_requires_both_legs():
    bars = _bars_flat_then_break()
    date_key = "1970-01-26"  # 86400*25 -> day 26 of epoch, UTC date of the bar
    good_flow = {date_key: [{"CallPut": "C", "Premium": "900000"}]}
    assert len(fcb_signals(bars, good_flow)) == 1
    assert fcb_signals(bars, {}) == []


# ── Closed-bar discipline must survive the JOIN, not just detection ───────

def test_fcb_join_never_fires_on_a_forming_bar():
    """The verbatim closed-bar test pins detect_breakouts; this pins the join.

    fcb_signals is what a user-request path actually calls, so a hardcoded
    include_last=True in the join would ship a forming-bar signal while
    detect_breakouts' own test stayed green.
    """
    bars = _bars_flat_then_break()[:-1]  # breakout bar is the LAST (forming) bar
    flow = {"1970-01-26": [{"CallPut": "C", "Premium": "900000"}]}
    assert fcb_signals(bars, flow) == []                        # closed-bar rule
    assert len(fcb_signals(bars, flow, include_last=True)) == 1  # nightly sweep


def test_dominance_gate_rejects_a_two_sided_tape():
    """$600k of calls clears the $500k floor but not 1.75x the put side.

    Without this the FCB_DOMINANCE constant has no test that fails when it is
    deleted, and a breakout could be "confirmed" by a tape that is trading
    both ways.
    """
    rows = [{"CallPut": "CALL", "Premium": "600000"},
            {"CallPut": "PUT", "Premium": "500000"}]
    r = flow_confirms(rows, "bull")
    assert r["callPrem"] == 600_000.0 and r["putPrem"] == 500_000.0
    assert r["confirmed"] is False              # 600k < 1.75 * 500k
    assert flow_confirms(rows, "bear")["confirmed"] is False  # mirrored


def test_bear_leg_reads_the_put_side():
    rows = [{"CallPut": "P", "Premium": "900000"}, {"CallPut": "C", "Premium": "100000"}]
    assert flow_confirms(rows, "bear")["confirmed"] is True
    assert flow_confirms(rows, "bull")["confirmed"] is False


def test_flow_side_labels_are_case_and_form_insensitive():
    """Production flow rows carry 'CALL'/'PUT'/'C'/'P' in ANY case."""
    rows = [{"CallPut": "call", "Premium": "600000"},
            {"CallPut": " p ", "Premium": "100000"}]
    r = flow_confirms(rows, "bull")
    assert r["callPrem"] == 600_000.0 and r["putPrem"] == 100_000.0
    assert r["confirmed"] is True
