"""The replay harness's own tests — including the one that asserts the code is WRONG.

Phase C ships a NOTIFICATION. No screenshot catches a wrong alert and an email
cannot be un-sent, so the pixel gate that carried B1-B5 has no analogue here.
`tools/alert_replay.py` is what replaces it, and this file is what proves the
instrument works before anything is measured with it.

Three things are asserted that a normal test file would not:

  * that TODAY'S evaluator REPAINTS, as a number greater than zero
    (`test_the_repaint_oracle_reads_non_zero_on_todays_evaluator`), and that a
    closed-bar evaluator reads exactly ZERO on the same oracle
    (`test_a_closed_bar_evaluator_reads_zero_on_the_same_oracle`). The second is
    the control: without it "non-zero" could be an artifact of a harness that
    always reports non-zero, which is the shape that has been vacuous eighteen
    distinct ways on this branch.
  * that the wick fires TODAY and does not fire on the close
    (`test_the_wick_fires_today_and_that_is_the_defect`). Task 5 inverts it.
  * that the harness's memoized adapter has not forked from `_evaluate_one`
    (`test_the_harness_agrees_with_the_evaluators_own_evaluate_one`).
"""

from __future__ import annotations

import json
import math
import os
import pathlib
import sys

import pytest

_ROOT = pathlib.Path(__file__).resolve().parent.parent
if str(_ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(_ROOT / "tools"))

import alert_replay as ar  # noqa: E402
from api.services import indicator_alert_evaluator as ev  # noqa: E402
from api.services import indicator_compute as ic  # noqa: E402

_FIRE_LOG = pathlib.Path(ar.FIRE_LOG_PATH)


@pytest.fixture(scope="module")
def wick():
    return ar.load_fixture("wick_that_unwinds")["bars"]


@pytest.fixture(scope="module")
def forming():
    """One memoized adapter shared by the module — the memo is the whole point."""
    return ar.make_forming_evaluate()


@pytest.fixture(scope="module")
def fire_log():
    with open(_FIRE_LOG, encoding="utf-8") as fh:
        return json.load(fh)


# ─── Step 6: the named wick fixture, asserted in BOTH directions ─────────────

def test_the_wick_fires_today_and_that_is_the_defect(wick, forming):
    """The whole reason Phase C exists, as a number.

    ⚠️ NOT a test that the code is right — a test that it is WRONG in the exact
    way the record describes. Task 5 inverts it, and the inversion is the proof
    the rebuild did the thing rather than something adjacent.
    """
    fires = ar.replay(wick, [ar.rsi_cross_above_70()], k=4, evaluate=forming)
    assert fires, ("the forming-bar evaluator did NOT fire on the wick — either the "
                   "fixture no longer crosses 70 intra-bar, or the harness is not "
                   "driving the forming bar at all")
    assert all(f["bar_index"] == ar.WICK_INDEX for f in fires), (
        f"a fire landed off the wick bar: {[f['bar_index'] for f in fires]}")

    closed = ar.replay(wick, [ar.rsi_cross_above_70()], k=1, evaluate=forming)
    assert closed == [], ("the close alone does not cross 70 — if it does, the "
                          "fixture is not a wick and proves nothing")


def test_no_close_in_the_wick_fixture_takes_rsi_above_70(wick):
    """The fixture's OTHER direction, stated about the series rather than the run.

    `test_the_wick_fires_today_and_that_is_the_defect`'s `closed == []` would also
    be satisfied by an RSI that sat above 70 for the WHOLE series (no crossing,
    because `prev` is never at-or-below). That is not a wick, so assert the shape
    of the series itself: every closed-bar RSI is below 70, and the intra-bar
    sample the k=4 path actually visits is above it.
    """
    closes = [b["c"] for b in wick]

    def rsi_last(seq):
        for v in reversed(ic.compute_rsi(seq, 14)):
            if v is not None:
                return v
        return None

    closed = [rsi_last(closes[:i + 1]) for i in range(len(wick))]
    assert max(v for v in closed if v is not None) < 70.0

    bar = wick[ar.WICK_INDEX]
    sample = ar.intrabar_path(bar, 4)[1]          # the sample the fire lands on
    assert rsi_last(closes[:ar.WICK_INDEX] + [sample["c"]]) > 70.0


def test_the_wick_fires_once_because_last_value_is_carried(wick, forming):
    """M4's rail, stated as a fact about the fire rather than about the code.

    Two of the k=4 samples on the wick bar put RSI above 70. Only the FIRST fires,
    because the write-back makes the second sample's `prev` the first sample's
    value — which is above the threshold, so `cross_above` is False. Without the
    write-back `prev` would still be the previous BAR's close (67.0) and BOTH
    samples would fire, i.e. the forming lane would accidentally look closed-bar
    in one direction and doubly-loud in the other.
    """
    fires = ar.replay(wick, [ar.rsi_cross_above_70()], k=4, evaluate=forming)
    assert len(fires) == 1, f"expected exactly one fire, got {fires}"
    assert fires[0]["sample"] == 1

    closes = [b["c"] for b in wick]
    bar = wick[ar.WICK_INDEX]

    def rsi_last(seq):
        for v in reversed(ic.compute_rsi(seq, 14)):
            if v is not None:
                return v
        return None

    above = [j for j, p in enumerate(ar.intrabar_path(bar, 4))
             if rsi_last(closes[:ar.WICK_INDEX] + [p["c"]]) > 70.0]
    assert len(above) > 1, ("only one k=4 sample clears 70, so this test cannot "
                            "distinguish carrying `last_value` from not carrying it")


def test_replay_does_not_mutate_the_callers_alerts(wick, forming):
    """`replay` carries `last_value` on a COPY, so two calls are independent."""
    alert = ar.rsi_cross_above_70()
    ar.replay(wick, [alert], k=4, evaluate=forming)
    assert alert["last_value"] is None
    again = ar.replay(wick, [alert], k=4, evaluate=forming)
    assert [f["bar_index"] for f in again] == [ar.WICK_INDEX]


# ─── Step 2: the path model ──────────────────────────────────────────────────

_PATH_BARS = [
    {"t": 1, "o": 10.0, "h": 12.0, "l": 9.0, "c": 11.0, "v": 400},    # up
    {"t": 2, "o": 11.0, "h": 11.5, "l": 8.0, "c": 8.5, "v": 800},     # down
    {"t": 3, "o": 5.0, "h": 5.0, "l": 5.0, "c": 5.0, "v": 0},         # degenerate
]


@pytest.mark.parametrize("bar", _PATH_BARS)
def test_intrabar_path_k1_is_the_closed_bar(bar):
    assert ar.intrabar_path(bar, 1) == [dict(bar)]


@pytest.mark.parametrize("bar", _PATH_BARS)
@pytest.mark.parametrize("k", [1, 2, 3, 4, 8, 13])
def test_the_last_partial_is_the_closed_bar_at_every_k(bar, k):
    path = ar.intrabar_path(bar, k)
    assert len(path) == k
    assert path[-1] == dict(bar)


@pytest.mark.parametrize("k", [3, 6, 9])
def test_the_path_carries_both_extremes_when_k_lands_on_the_legs(k):
    """The high and the low are the only points that can flip a threshold the
    close does not, so the model has to reach them — at k a multiple of 3 the
    running close lands exactly on each leg."""
    for bar in _PATH_BARS[:2]:
        closes = [p["c"] for p in ar.intrabar_path(bar, k)]
        assert any(math.isclose(c, bar["h"]) for c in closes)
        assert any(math.isclose(c, bar["l"]) for c in closes)


def test_the_running_high_and_low_never_exceed_the_closed_bars():
    for bar in _PATH_BARS:
        for p in ar.intrabar_path(bar, 8):
            assert bar["l"] - 1e-9 <= p["l"] <= p["h"] <= bar["h"] + 1e-9
            assert 0 <= p["v"] <= bar["v"]


def test_an_up_bar_walks_to_the_low_first_and_a_down_bar_to_the_high():
    """The direction convention, which is what makes the model a MODEL."""
    up, down = _PATH_BARS[0], _PATH_BARS[1]
    up_closes = [p["c"] for p in ar.intrabar_path(up, 3)]
    down_closes = [p["c"] for p in ar.intrabar_path(down, 3)]
    assert up_closes.index(up["l"]) < up_closes.index(up["h"])
    assert down_closes.index(down["h"]) < down_closes.index(down["l"])


def test_k_below_one_is_refused():
    with pytest.raises(ValueError):
        ar.intrabar_path(_PATH_BARS[0], 0)


# ─── Step 3: the fire key ────────────────────────────────────────────────────

def test_fire_key_puts_the_value_in_the_key():
    """A changed NUMBER must not be able to read as 'no change'."""
    a = {"alert_key": "x|rsi|above|70.0", "bar_index": 12, "bar_time": 100,
         "value": 71.0, "triggered": True}
    b = dict(a, value=71.5)
    assert ar.fire_key(a) != ar.fire_key(b)
    assert ar.fire_key(a) == ar.fire_key(dict(a))
    # And the two differ ONLY in the value slot, so nothing else is doing the work.
    assert [i for i, (x, y) in enumerate(zip(ar.fire_key(a), ar.fire_key(b)))
            if x != y] == [3]


def test_fire_key_separates_float_reprs_that_json_would_collapse():
    a = {"alert_key": "k", "bar_index": 0, "bar_time": 0, "value": 0.1 + 0.2,
         "triggered": True}
    b = dict(a, value=0.3)
    assert a["value"] != b["value"]
    assert ar.fire_key(a) != ar.fire_key(b)


# ─── the fork rail: the adapter vs the evaluator's own _evaluate_one ─────────

def test_the_harness_agrees_with_the_evaluators_own_evaluate_one(wick, forming):
    """`make_forming_evaluate` re-expresses `_evaluate_one`'s tail so it can memoize
    the value computation. That is a FORK, and this is what keeps it honest.

    Every address × every condition the catalog offers × a threshold ladder ×
    several `prev` values, driven through BOTH, demanding exact equality of
    `(value, triggered)`.
    """
    window = wick[-ar.PROD_BAR_WINDOW:]
    prevs = [None, -50.0, 0.0, 1.0, 50.0, 69.0, 70.0, 101.0]
    compared = 0
    for address in ev.INDICATOR_FUNCS:
        for cond in ev.ALERT_CONDITIONS[address]:
            thresholds = [None, -1.0, 0.0, 50.0, 70.0, 100.0, 100.5]
            for thr in thresholds:
                for prev in prevs:
                    alert = {"id": 1, "user_id": "u", "sym": "T", "tf": "5",
                             "indicator": address, "condition": cond["value"],
                             "threshold": thr, "params_json": None,
                             "last_value": prev, "alert_key": "k"}
                    want = ev._evaluate_one(dict(alert), bars=window)
                    got = forming(dict(alert), window)
                    assert got == want, (address, cond["value"], thr, prev, got, want)
                    compared += 1
    assert compared > 3000, f"only {compared} combinations compared — too thin"


def test_the_fork_rail_is_not_vacuous(wick, forming):
    """The rail above compares nothing unless the addresses produce numbers."""
    window = wick[-ar.PROD_BAR_WINDOW:]
    valued = []
    for address in ev.INDICATOR_FUNCS:
        alert = {"id": 1, "user_id": "u", "sym": "T", "tf": "5",
                 "indicator": address, "condition": "above", "threshold": 0.0,
                 "params_json": None, "last_value": None, "alert_key": "k"}
        value, _ = forming(alert, window)
        if value is not None:
            valued.append(address)
    missing = sorted(set(ev.INDICATOR_FUNCS) - set(valued))
    assert not missing, f"addresses produced no value on wick_that_unwinds: {missing}"


# ─── Step 5: THE REPAINT ORACLE, and its control ────────────────────────────

def _closed_bar_evaluate(alert: dict, seen: list[dict]):
    """A HYPOTHETICAL closed-bar evaluator, used only as the oracle's control.

    It judges the last CLOSED bar and takes `prev` from the bar before it — i.e.
    what spec §8 says the rebuilt lane must do. It is deliberately NOT wired to
    anything shipped; it exists so `test_a_closed_bar_evaluator_reads_zero_on_the_same_oracle`
    can prove that the oracle's non-zero reading is a property of the EVALUATOR
    and not of a harness that always reports non-zero.
    """
    address = ev.resolve_address(alert.get("indicator"))
    fn = ev.INDICATOR_FUNCS.get(address)
    if fn is None or not seen:
        return None, False
    params = ev._parse_params(alert)
    # The forming partial is the last element; a closed-bar lane never sees it
    # until it closes, so drop it and judge the last CLOSED bar.
    closed = seen[:-1]
    if len(closed) < 2:
        return None, False
    try:
        value = fn(closed, params)
        prev = fn(closed[:-1], params)
    except Exception:
        return None, False
    if value is None:
        return None, False
    condition = alert.get("condition") or ""
    threshold = alert.get("threshold")
    # ⚰️ Was `ev._bb_threshold_override(closed, params, condition)` — this
    # binding is one of the two that kept the retired name alive through Task 3.
    # Task 5 re-pointed both at the general grammar and deleted the symbol. The
    # LOGIC of this control is otherwise untouched: it is still the hypothetical
    # closed-bar evaluator written in Task 2, before any implementation existed,
    # which is what makes it worth more than a tidier one.
    dyn = ev.threshold_operand_value(address, condition, closed, params)
    if dyn is not None:
        threshold = dyn
    return value, ev.check_condition(condition, value, prev, threshold)


def test_the_repaint_oracle_reads_non_zero_on_todays_evaluator(wick, forming):
    """🔴 THE HEADLINE 'BEFORE' NUMBER, in miniature.

    Today's evaluator scores the FORMING bar with cycle-granularity crossings, so
    the fire set DEPENDS ON WHEN YOU LOOKED. Both resolutions must be non-zero:
    `keyed` (a number moved) and `identity` (a fire exists at one granularity and
    not another). A zero in either is a gate that cannot fail.
    """
    alerts, _ = ar.build_alert_grid("wick_that_unwinds", wick, "5", forming)
    res = ar.repaint_disagreement(wick, alerts, (1, 2, 4, 8), forming)
    assert res["keyed_disagreement"] > 0, (
        "the repaint oracle read ZERO against the evaluator this whole phase "
        "exists to fix — the oracle is wrong, not the evaluator")
    assert res["identity_disagreement"] > 0, (
        "every k agreed on WHICH (alert, bar) fired and differed only in the "
        "number — that would make the disagreement numeric jitter, not a repaint")


def test_a_closed_bar_evaluator_reads_zero_on_the_same_oracle(wick):
    """⭐ THE ORACLE'S OWN CONTROL, and the reason the test above means anything.

    Same bars, same grid, same k ladder — a closed-bar evaluator's fire set does
    not depend on when you looked, so BOTH disagreement numbers are exactly 0.
    Without this, `> 0` above could be a property of the harness rather than of
    the evaluator, and Task 5's target ('drive it to exactly 0') would be
    unreachable by construction.
    """
    forming = ar.make_forming_evaluate()
    alerts, _ = ar.build_alert_grid("wick_that_unwinds", wick, "5", forming)
    res = ar.repaint_disagreement(wick, alerts, (1, 2, 4, 8), _closed_bar_evaluate)
    assert res["keyed_disagreement"] == 0, res["examples"]
    assert res["identity_disagreement"] == 0, res["examples"]
    # …and it is not zero because it never fired.
    assert res["fires_per_k"][1] > 0, "the control fired nothing — 0 proves nothing"


def test_the_vacuity_refusal_is_still_in_the_tool():
    """The refusal is the gate. Deleting it turns `--repaint` into a reporter that
    can print 0 and exit 0, which is exactly the shape this phase is guarding."""
    src = pathlib.Path(ar.__file__).read_text(encoding="utf-8")
    assert "ABORTING AS VACUOUS" in src
    assert "if not totals[\"keyed\"] or not totals[\"identity\"]:" in src


def test_the_path_model_states_its_limits():
    """A model whose limits are not written down is presented as a measurement."""
    src = pathlib.Path(ar.__file__).read_text(encoding="utf-8")
    block = src.split("def intrabar_path")[0]
    for phrase in ("UNDER-counts", "touches an extreme TWICE", "volume accrues",
                   "LOWER bound"):
        assert phrase in block, f"the path model no longer states: {phrase}"


# ─── the frozen bars, and the ONE series claim ──────────────────────────────

def test_every_frozen_fixture_digests_to_its_recorded_sha256():
    names = ar.fixture_names()
    assert names == ["intraday5m", "spy_daily", "nvda_5m_extended",
                     "wick_that_unwinds"]
    for name in names:
        fx = ar.load_fixture(name)          # raises on a digest mismatch
        assert len(fx["bars"]) == fx["bar_count"]
        assert fx["bar_count"] > 0


def test_intraday5m_is_a_REFERENCE_to_the_pixel_gates_series_not_a_copy():
    """⭐ THE 'ONE SERIES' CLAIM, made unrepresentable rather than asserted.

    `tools/chart_parity.py` renders these bars through `?fixedbars=`; the golden
    fixture `tests/fixtures/indicators/intraday5m_sessions.json` computes against
    them in BOTH lanes at rel-tol 1e-9. The replay entry carries `barsFrom` and a
    sha256 instead of a copy, so a fork cannot happen quietly.
    """
    with open(ar.BARS_PATH, encoding="utf-8") as fh:
        doc = json.load(fh)
    entry = doc["fixtures"]["intraday5m"]
    assert "bars" not in entry, "intraday5m was COPIED — it must be a reference"
    assert entry["barsFrom"] == "app/src/pages/parityBars/intraday5m.json"
    assert entry["bar_count"] == 579

    golden = json.loads((_ROOT / "tests" / "fixtures" / "indicators" /
                         "intraday5m_sessions.json").read_text(encoding="utf-8"))
    assert golden["barsFrom"] == entry["barsFrom"], (
        "the golden indicator fixture and the alert replay no longer name the "
        "same bar file — they are two series again")


def test_the_replays_bars_reproduce_the_cross_lane_golden_column_at_1e_9():
    """A fixture only one lane reads proves nothing.

    `intraday5m_sessions.json` carries an `expected` MFI(14) column pinned at
    relTol 1e-9 and is asserted by the JS lane (`goldenFixtures.test.js`) and the
    Python lane (`test_indicator_golden.py`). This recomputes that same column
    from the bars THE REPLAY HARNESS LOADS — so the numbers the two chart lanes
    agreed on are the numbers the alert lane walks, rather than a third copy that
    happens to look similar.
    """
    golden = json.loads((_ROOT / "tests" / "fixtures" / "indicators" /
                         "intraday5m_sessions.json").read_text(encoding="utf-8"))
    bars = ar.load_fixture("intraday5m")["bars"]
    cols = ic.compute_case(golden["kind"], bars, golden.get("params"))
    (name,) = ic.case_columns(golden["kind"])
    got = cols[name]
    want = golden["expected"][name]
    assert len(got) == len(want) == len(bars)
    rel = golden["relTol"]
    assert rel == 1e-9
    compared = 0
    for i, (g, w) in enumerate(zip(got, want)):
        if w is None or g is None:
            assert g is w or (g is None and w is None), (i, g, w)
            continue
        assert abs(g - w) <= rel * max(1.0, abs(w)), (i, g, w)
        compared += 1
    assert compared > 500, f"only {compared} values compared — the column is thin"


def test_nvda_records_the_session_coverage_it_does_and_does_not_have():
    """⚠️ The measured limit, kept in the fixture rather than in somebody's head.

    Spec §9.1 wants an extended-hours day crossing UTC midnight AND a DST
    transition. The bars store retains NVDA 5m only from 2026-04-16 (entirely
    EDT) and its last print of the day is 19:55 ET, five minutes short of the
    20:00 ET == 00:00 UTC boundary. `intraday5m` carries both traps; this asserts
    the fixture SAYS so, so nobody reads `nvda_5m_extended` as covering them.
    """
    import datetime
    import zoneinfo

    with open(ar.BARS_PATH, encoding="utf-8") as fh:
        entry = json.load(fh)["fixtures"]["nvda_5m_extended"]
    assert "MEASURED" in entry["why"] and "NEITHER" in entry["why"]

    et = zoneinfo.ZoneInfo("America/New_York")
    bars = ar.load_fixture("nvda_5m_extended")["bars"]
    offsets = {datetime.datetime.fromtimestamp(b["t"], et).utcoffset() for b in bars}
    assert len(offsets) == 1, "NVDA now spans a DST transition — update the note"
    crossings = [b for b in bars
                 if datetime.datetime.fromtimestamp(b["t"], et).date()
                 != datetime.datetime.fromtimestamp(b["t"], datetime.timezone.utc).date()]
    assert not crossings, "NVDA now crosses UTC midnight — update the note"


def test_intraday5m_actually_carries_the_two_session_traps():
    """…and the fixture that DOES carry them is checked, not just credited."""
    import datetime
    import zoneinfo

    et = zoneinfo.ZoneInfo("America/New_York")
    bars = ar.load_fixture("intraday5m")["bars"]
    offsets = {datetime.datetime.fromtimestamp(b["t"], et).utcoffset() for b in bars}
    assert len(offsets) == 2, f"expected an EDT->EST transition, saw {offsets}"
    crossings = [b for b in bars
                 if datetime.datetime.fromtimestamp(b["t"], et).date()
                 != datetime.datetime.fromtimestamp(b["t"], datetime.timezone.utc).date()]
    assert crossings, "no bar crosses UTC midnight — the VWAP anchor trap is gone"


# ─── Step 4: the frozen fire log ────────────────────────────────────────────

def test_the_fire_log_is_recorded_against_the_live_address_count(fire_log):
    """The ledger AND the evaluator's own comment both claim 25 addresses and
    there are 28. The log is generated from `INDICATOR_FUNCS`, never hand-copied,
    and this is the assertion that keeps it that way."""
    assert fire_log["address_count"] == len(ev.INDICATOR_FUNCS) == 28
    assert fire_log["prod_bar_window"] == ar.PROD_BAR_WINDOW == 200
    assert fire_log["ks"] == list(ar.RECORD_KS)


def test_the_fire_log_is_not_vacuous(fire_log):
    """The recorder's own three assertions, re-checked from the COMMITTED file.

    A guard that only ever runs inside the recorder is a guard nobody can see
    fail after the fact.
    """
    s = fire_log["summary"]
    assert s["fires"] > 0, "no alert fired — the log cannot detect a change in firing"
    assert s["fires"] < s["slots"], "every combination fired — the grid is saturated"
    per = s["per_address_fires"]
    assert set(per) == set(ev.INDICATOR_FUNCS)
    dead = sorted(a for a, n in per.items() if not n)
    assert not dead, f"addresses pinned NOTHING across the whole replay: {dead}"


def test_every_fixture_and_every_k_is_present_in_the_log(fire_log):
    assert set(fire_log["fixtures"]) == set(ar.fixture_names())
    for name, block in fire_log["fixtures"].items():
        assert block["bar_count"] == ar.load_fixture(name)["bar_count"]
        assert block["alert_count"] == len(block["alert_keys"])
        for k in fire_log["ks"]:
            fires = block["fires"][str(k)]
            assert fires["count"] > 0
            assert len(fires["digest"]) == 64
            assert set(fires["per_alert"]) <= set(block["alert_keys"])
            assert sum(n for n, _d in fires["per_alert"].values()) == fires["count"]


def test_only_the_wick_fixture_stores_rows_and_the_rest_store_digests(fire_log):
    """The size decision, asserted so it stays a DECISION and not a drift.

    The raw-row form of this log was 42 MB. Every fixture is compared by a sha256
    over its whole ordered fire_key sequence — `value` is inside the hashed text,
    so a changed NUMBER still changes the digest — and `wick_that_unwinds` keeps
    its rows verbatim so pytest can replay one fixture row-for-row.
    """
    for name, block in fire_log["fixtures"].items():
        for k in fire_log["ks"]:
            has_rows = "rows" in block["fires"][str(k)]
            assert has_rows == (name == ar.VERBATIM_FIXTURE), (name, k)
    for k in fire_log["ks"]:
        with pytest.raises(KeyError):
            ar.expected_fires(fire_log, "spy_daily", k)


def test_the_digest_is_sensitive_to_a_changed_number(fire_log, wick):
    """The whole claim of the digest form, demonstrated rather than asserted.

    Recompute the wick fixture's k=1 digest from its own committed rows, then
    nudge ONE value by one part in 1e12 and watch it change. If this ever passes
    trivially the log has stopped pinning numbers.
    """
    block = fire_log["fixtures"][ar.VERBATIM_FIXTURE]["fires"]["1"]
    keys = ar.expected_fires(fire_log, ar.VERBATIM_FIXTURE, 1)
    assert ar._digest("\n".join(repr(t) for t in keys)) == block["digest"]
    nudged = list(keys)
    a, b, c, value_repr, e = nudged[0]
    nudged[0] = (a, b, c, repr(float(value_repr) + 1e-12), e)
    assert ar._digest("\n".join(repr(t) for t in nudged)) != block["digest"]


def test_the_committed_fire_log_replays_exactly_for_the_wick_fixture(fire_log, wick):
    """⭐ AN EQUALITY, NOT A SHAPE CHECK — run on the fixture small enough for pytest.

    The same comparison over all four fixtures is `python tools/alert_replay.py
    --check` (documented in docs/runbooks/alert-replay-gate.md and gated there,
    because it walks 1,845 bars and takes minutes). Set ALERT_REPLAY_FULL=1 to
    run the whole thing from here instead.
    """
    forming = ar.make_forming_evaluate()
    alerts, _ = ar.build_alert_grid("wick_that_unwinds", wick, "5", forming)
    for k in fire_log["ks"]:
        got = [ar.fire_key(f) for f in
               ar.replay(wick, alerts, k=k, evaluate=forming)]
        want = ar.expected_fires(fire_log, "wick_that_unwinds", k)
        assert got == want, (
            f"k={k}: {len(got)} fires vs {len(want)} recorded; "
            f"first difference at "
            f"{next((i for i, (a, b) in enumerate(zip(got, want)) if a != b), 'tail')}")
        assert got, "the wick fixture recorded no fires at all"


@pytest.mark.skipif(not os.environ.get("ALERT_REPLAY_FULL"),
                    reason="walks 1,845 bars; set ALERT_REPLAY_FULL=1 (or run "
                           "`python tools/alert_replay.py --check`)")
def test_the_whole_fire_log_replays_exactly():
    assert ar.main(["--check"]) == 0


# ─── the grid ───────────────────────────────────────────────────────────────

def test_the_grid_is_derived_from_the_live_catalog(wick, forming):
    alerts, ladders = ar.build_alert_grid("wick_that_unwinds", wick, "5", forming)
    assert {a["indicator"] for a in alerts} == set(ev.INDICATOR_FUNCS)
    for address in ev.INDICATOR_FUNCS:
        offered = {c["value"] for c in ev.ALERT_CONDITIONS[address]}
        got = {a["condition"] for a in alerts if a["indicator"] == address}
        assert got == offered, (address, got, offered)
        assert ladders[address], f"{address} got an EMPTY threshold ladder"


def test_the_ladder_is_derived_from_the_series_not_a_fixed_list(wick, forming):
    """A fixed ladder like the 5,040 baseline's misses every price-scale address —
    VWAP on SPY is ~600 and a threshold of 70 is never crossed."""
    _alerts, ladders = ar.build_alert_grid("wick_that_unwinds", wick, "5", forming)
    for address, ladder in ladders.items():
        # Three quantiles, DEDUPED — an address whose 20th and 50th percentile
        # coincide (bb.upper across this fixture's flat warm-up chop) legitimately
        # yields two, and a duplicated threshold would only duplicate rows.
        assert 1 <= len(ladder) <= 3, (address, ladder)
        assert ladder == sorted(ladder) == sorted(set(ladder)), (address, ladder)
    # RSI lives on 0..100; VWAP lives on the price scale. A fixed ladder cannot
    # serve both, which is the whole point.
    assert max(ladders["rsi"]) <= 100.0
    assert min(ladders["vwap"]) > 90.0
    assert max(ladders["obv"]) > 1000.0      # a running volume total, not a %


def test_the_ladder_straddles_a_constant_series():
    """A degenerate address (constant OBV on a zero-volume window) would otherwise
    get one threshold that `above` can never clear, and the per-address
    non-vacuity assertion would trip for a reason unrelated to the code."""
    assert ar._ladder([5.0] * 40) == [4.95, 5.0, 5.05]
    assert ar._ladder([0.0] * 40) == [-0.01, 0.0, 0.01]
    assert ar._ladder([]) == []
