from datetime import date, timedelta

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
    bars[25]["v"] = 1_000_000  # exactly avg, below 1.5x
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
    # Exact payload: these fields are written to the append-only ledger, so a
    # swapped callPrem/putPrem would record inverted evidence permanently.
    assert fcb_signals(bars, good_flow) == [{
        "barTime": 86400 * 25, "direction": "bull", "close": 104.0,
        "callPrem": 900_000.0, "putPrem": 0.0, "version": "fcb-v2",
    }]
    assert fcb_signals(bars, {}) == []


# ── The store's DAILY timestamps are YYYYMMDD ints, not epoch seconds ─────

def _business_days_ending(end_iso, n):
    """The n most recent weekdays ending at end_iso, oldest-first."""
    d = date.fromisoformat(end_iso)
    out = []
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d -= timedelta(days=1)
    return list(reversed(out))


def _bars_yyyymmdd(base=100.0):
    """The _bars_flat_then_break shape with REAL daily-store timestamps.

    bars_sqlite stores daily/weekly/monthly ts as a YYYYMMDD integer and
    get_bars/_fetch_bars_for_alert pass it through untouched as bar["t"].
    """
    days = _business_days_ending("2026-07-31", 27)
    bars = [
        {"t": int(d.strftime("%Y%m%d")), "o": base, "h": base + 1, "l": base - 1,
         "c": base, "v": 1_000_000}
        for d in days[:25]
    ]
    bars.append({"t": int(days[25].strftime("%Y%m%d")), "o": base, "h": base + 5,
                 "l": base, "c": base + 4, "v": 2_000_000})       # 2026-07-30
    bars.append({"t": int(days[26].strftime("%Y%m%d")), "o": base + 4, "h": base + 4.5,
                 "l": base + 3, "c": base + 4.2, "v": 900_000})   # 2026-07-31, confirms
    return bars


def test_daily_yyyymmdd_timestamps_join_to_their_real_session_date():
    """Decoding 20260730 as an epoch yields 1970-08-23 for EVERY 2026 session,
    so the flow join matches nothing and the indicator ships dead -- silently,
    with no error and an empty list."""
    bars = _bars_yyyymmdd()
    assert bars[25]["t"] == 20260730 and bars[26]["t"] == 20260731
    flow = {"2026-07-30": [{"CallPut": "C", "Premium": "900000"}]}

    sigs = fcb_signals(bars, flow)
    assert len(sigs) == 1, "YYYYMMDD daily timestamp failed to join its flow date"
    assert sigs[0]["barTime"] == 20260730
    assert sigs[0]["callPrem"] == 900_000.0

    # A flow dict keyed by the epoch misreading must NOT match.
    assert fcb_signals(bars, {"1970-08-23": flow["2026-07-30"]}) == []


def test_iso_string_timestamps_join_to_their_session_date():
    """The /api/bars JSON path emits daily t as 'YYYY-MM-DD' (bars_fetch.py:599,
    923, 1439, 1491) -- a THIRD encoding these functions are handed."""
    bars = _bars_yyyymmdd()
    for b in bars:
        d = str(b["t"])
        b["t"] = f"{d[:4]}-{d[4:6]}-{d[6:]}"
    sigs = fcb_signals(bars, {"2026-07-30": [{"CallPut": "C", "Premium": "900000"}]})
    assert len(sigs) == 1
    assert sigs[0]["barTime"] == "2026-07-30"


def test_unparseable_bar_time_never_raises():
    """Sibling-module convention: these are pure functions that never raise.
    A garbage timestamp yields no join match rather than a 500.

    Each value must reach the decoder's except clause -- note a string
    containing '-' is taken as ISO and never reaches the int() parse, so
    'not-a-timestamp' alone would pass this test vacuously.
    """
    flow = {"1970-01-26": [{"CallPut": "C", "Premium": "900000"}]}
    for junk in (None, "", "abc", "not-a-timestamp", float("nan"), 10 ** 20, object()):
        bars = _bars_flat_then_break()
        bars[25]["t"] = junk
        assert fcb_signals(bars, flow) == [], junk


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


def test_volume_exactly_at_the_multiple_fires_and_just_under_does_not():
    """1.5x avg is IN (gate is `< vol_mult * avg`, not `<=`); 1.49x is OUT.

    Both halves live in one test on purpose. Either alone leaves the constant
    free to drift: "fires at 1.5x" passes for any multiple <= 1.5, and "rejects
    1.49x" passes for any multiple > 1.49. Together they pin FCB_VOL_MULT to
    exactly 1.5 — the owner's 2026-08-01 pre-launch tightening from 1.25.
    """
    bars = _bars_flat_then_break()
    bars[25]["v"] = 1_500_000  # exactly 1.5 x the 1M average
    assert len(detect_breakouts(bars)) == 1

    bars = _bars_flat_then_break()
    bars[25]["v"] = 1_490_000  # 1.49x — one tick under the gate
    assert detect_breakouts(bars) == []


def test_premium_exactly_at_the_floor_confirms():
    """$500,000.00 is IN (gate is `>= min_prem`)."""
    rows = [{"CallPut": "CALL", "Premium": "500000"}]
    assert flow_confirms(rows, "bull")["confirmed"] is True


def test_close_exactly_at_the_prior_high_is_not_a_breakout():
    """Strict `>`: touching the 20-bar high is not clearing it."""
    bars = _bars_flat_then_break()
    bars[25]["c"] = 101.0  # exactly the prior-20 high; volume still 2x
    assert detect_breakouts(bars) == []


def test_flow_side_labels_are_case_and_form_insensitive():
    """Production flow rows carry 'CALL'/'PUT'/'C'/'P' in ANY case."""
    rows = [{"CallPut": "call", "Premium": "600000"},
            {"CallPut": " p ", "Premium": "100000"}]
    r = flow_confirms(rows, "bull")
    assert r["callPrem"] == 600_000.0 and r["putPrem"] == 100_000.0
    assert r["confirmed"] is True
