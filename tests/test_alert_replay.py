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

    🔴 IT ITERATES **BOTH** TABLES, AND IT DID NOT UNTIL PHASE C TASK 6. Iterating
    `INDICATOR_FUNCS` alone left the two `EVENT_FUNCS` addresses undriven, and a
    real fork lived in exactly that gap: the adapter looked its value function up
    in `INDICATOR_FUNCS` while `_evaluate_one` resolves through `value_function`,
    which consults both — so `sar.priceCrossedSar` evaluated to `(None, False)` in
    the harness and fired 39 times in the shipped lane. A rail that iterates the
    same list the code under test does can only ever see what that list contains.
    """
    window = wick[-ar.PROD_BAR_WINDOW:]
    prevs = [None, -50.0, 0.0, 1.0, 50.0, 69.0, 70.0, 101.0]
    compared = 0
    for address in list(ev.INDICATOR_FUNCS) + list(ev.EVENT_FUNCS):
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
    """The rail above compares nothing unless the addresses produce numbers.

    ⚠️ AND IT COVERS BOTH TABLES TOO. This is the half that would have caught the
    event-address fork on its own: `sar.priceCrossedSar` returned `None` from the
    adapter for every window, which is indistinguishable from "an address the
    harness never asked about" unless the list being asked includes it.
    """
    window = wick[-ar.PROD_BAR_WINDOW:]
    catalog = list(ev.INDICATOR_FUNCS) + list(ev.EVENT_FUNCS)
    valued = []
    for address in catalog:
        alert = {"id": 1, "user_id": "u", "sym": "T", "tf": "5",
                 "indicator": address, "condition": "above", "threshold": 0.0,
                 "params_json": None, "last_value": None, "alert_key": "k"}
        value, _ = forming(alert, window)
        if value is not None:
            valued.append(address)
    missing = sorted(set(catalog) - set(valued))
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
    # ⛔ THE FOUR ORIGINALS ARE ASSERTED AS A PREFIX, NOT AS THE WHOLE LIST. The
    # corpus is allowed to GROW — that is what `tools/alert_corpus_extend.py` is
    # for — and it is not allowed to be reordered or rewritten, because every
    # digest in `fire_log_forming.json` is measured against these exact bars in
    # this exact order.
    assert names[:4] == ["intraday5m", "spy_daily", "nvda_5m_extended",
                         "wick_that_unwinds"]
    assert len(names) == len(set(names))
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


# ═══════════════════════════════════════════════════════════════════════════
# THE EXTENDED CORPUS — real tape for the conditions a live session presents
# ═══════════════════════════════════════════════════════════════════════════
#
# 🔴 WHY THE CORPUS HAD TO GROW, AS A MEASUREMENT. Production's shadow lane held
# 8,130 rows and EVERY ONE of them was recorded between 16:52 and 21:30 ET. The
# closed-bar lane's whole purpose is to judge the last CONFIRMED bar instead of
# the forming one, and after hours nothing is forming — so that data says almost
# nothing about the behaviour the cutover changes. The offline corpus was four
# fixtures. `tools/alert_corpus_extend.py` adds seven, each built from REAL bars
# out of the local store and each carrying a condition a regular session can
# actually present.
#
# ⛔ AND EVERY ONE OF THEM IS RE-CHECKED HERE FROM THE FROZEN BARS, NOT FROM THE
# STORE. The builder's checks run once, against a database this repo does not
# carry; these run on every suite, against the committed fixture. A fixture whose
# reason for existing lives only in its `why` string is a fixture nobody can tell
# has stopped covering its case.

_ORIGINAL_FIXTURES = ("intraday5m", "spy_daily", "nvda_5m_extended",
                      "wick_that_unwinds")

# 🔴 THE FROZEN FIRE LOG IS A CONTRACT. These are the eight (fixture, k) pairs as
# they stood BEFORE the corpus grew — measured on the committed log, then written
# here as LITERALS so they predate the append. A new fixture may ADD entries; it
# may not move one of these. If one moves, that is a finding about the closed
# lane, not a number to regenerate.
_FROZEN_EIGHT = {
    ("intraday5m", "1"):
        (44543, "e9f13e4e05db5ac06f2b97ce243eca7f78604c4bc97791b245a4ee50bc0fa5ac"),
    ("intraday5m", "4"):
        (176275, "fbd4d3e8527f741706f6f287772305ae2557b110fa13cfc070b0da174927bc15"),
    ("spy_daily", "1"):
        (29377, "09e57a15c01a11c93168c5899410729b1226e3dd2827d68602d741d10340f5db"),
    ("spy_daily", "4"):
        (114845, "1a750d0af9290f42353079b212ba7cf6a4dc1f4c409dcdac11f370b71404c20d"),
    ("nvda_5m_extended", "1"):
        (61963, "f5c805a1f511db34eee66c67b536760ec1f10307ac1be19fea7537752994f2f7"),
    ("nvda_5m_extended", "4"):
        (244269, "99279ef8dc51a85a008b61ec06a503a9b7bbb6a106cadc1aec8c7c463d7c3a2c"),
    ("wick_that_unwinds", "1"):
        (2786, "44ace2555b8ff1c9c23107db6c1db3759d6a0079e7ba614f3bbb22ee5c0f6178"),
    ("wick_that_unwinds", "4"):
        (11135, "e364f1a9cf3f95d27593ef0655916ad71fa18a3de6bdc39848971569acb187f7"),
}

_EXTENDED_FIXTURES = ("gap_open_5m", "high_vol_5m", "thin_illiquid_5m",
                      "warmup_first_bars_5m", "halfday_30m", "hourly_open_60m",
                      "gap_daily")


@pytest.fixture(scope="module")
def closed():
    return ar.make_closed_evaluate()


def test_the_original_eight_pairs_are_byte_identical_after_the_corpus_grew(fire_log):
    """⭐ THE CONTRACT, AS AN EQUALITY AGAINST LITERALS WRITTEN BEFORE THE APPEND.

    `--record --append` compares every pre-existing fixture object before and
    after and refuses to write if one moved, but that guard lives inside the tool
    that does the writing. This one lives outside it: the numbers are here, in the
    test file, not read back out of the artifact they are supposed to check.
    """
    for (name, k), (count, digest) in _FROZEN_EIGHT.items():
        block = fire_log["fixtures"][name]["fires"][k]
        assert block["count"] == count, (name, k, block["count"], count)
        assert block["digest"] == digest, (
            f"{name} k={k}: the frozen digest MOVED. That is a finding about the "
            "closed lane, not a number to regenerate.")
    assert fire_log["summary"]["fires"] > sum(c for c, _d in _FROZEN_EIGHT.values())


def test_the_corpus_grew_and_says_where(fire_log):
    names = ar.fixture_names()
    assert names[:4] == list(_ORIGINAL_FIXTURES)
    assert set(names[4:]) == set(_EXTENDED_FIXTURES)
    assert set(fire_log["fixtures"]) == set(names)
    # the append is recorded IN the artifact, so a reader can see which blocks
    # predate the Phase C work and which were added afterwards
    appended = fire_log["appended"]
    assert appended and set(appended[-1]["fixtures"]) == set(_EXTENDED_FIXTURES)
    assert appended[-1]["added_fires"] > 0


@pytest.mark.parametrize("name", _EXTENDED_FIXTURES)
def test_every_extended_fixture_still_supports_its_own_claim(name):
    """⭐ THE `why` STRING IS NOT THE COVERAGE — THE `checks` FUNCTION IS.

    Each spec in `tools/alert_corpus_extend.py` carries an executable claim. Run
    it here against the FROZEN bars, so "this fixture covers a half day" is a
    thing that can go red rather than a sentence that can rot.
    """
    import alert_corpus_extend as ace

    spec = next(s for s in ace.SPECS if s["name"] == name)
    bars = ar.load_fixture(name)["bars"]
    assert len(bars) == spec["bars"]
    problems = spec["checks"](bars)
    assert not problems, f"{name} no longer supports its claim: {problems}"


@pytest.mark.parametrize("name", _EXTENDED_FIXTURES)
def test_every_extended_fixture_names_the_condition_it_covers(name):
    with open(ar.BARS_PATH, encoding="utf-8") as fh:
        entry = json.load(fh)["fixtures"][name]
    assert entry["covers"] and len(entry["covers"]) > 20
    assert entry["why"] and len(entry["why"]) > 200
    # `source` is the query that reproduces it — a fixture whose provenance is
    # "somebody had it locally" cannot be re-derived when its claim is disputed.
    assert "ticker=" in entry["source"] and "ts in [" in entry["source"]
    assert entry["bar_count"] == len(ar.load_fixture(name)["bars"])


def test_the_corpus_now_covers_four_timeframes():
    """Before the extension every fixture was tf 5 or D.

    `bar_close_epoch` has a distinct branch per timeframe code and
    `closed_bar_index` resolves each of them differently; 30 and 60 had NO real
    tape behind them at all, and 60's grid turns out not to be uniform (below).
    """
    with open(ar.BARS_PATH, encoding="utf-8") as fh:
        doc = json.load(fh)
    tfs = {doc["fixtures"][n]["tf"] for n in doc["order"]}
    assert tfs == {"5", "D", "30", "60"}
    before = {doc["fixtures"][n]["tf"] for n in _ORIGINAL_FIXTURES}
    assert before == {"5", "D"}


# ─── the anti-silent-skip rail ───────────────────────────────────────────────

class _Args:
    """The two attributes `cmd_check` / `cmd_record_append` read, and no more."""

    def __init__(self, only=None, append=False):
        self.only = only
        self.append = append


def test_check_refuses_a_corpus_fixture_absent_from_the_fire_log(monkeypatch, capsys):
    """🔴 A CORPUS THAT CAN QUIETLY NOT RUN IS WORSE THAN NO CORPUS.

    `--check` walks the FIRE LOG's fixture list. A series frozen into
    `replay_bars.json` and never recorded is therefore not checked, not missed and
    not reported — it sits in the tree looking like coverage. This drives the real
    `cmd_check` with a corpus that names one more fixture than the log does and
    demands a non-zero exit BEFORE any replay happens.
    """
    monkeypatch.setattr(
        ar, "fixture_names",
        lambda: [*_ORIGINAL_FIXTURES, *_EXTENDED_FIXTURES, "a_fixture_nobody_recorded"])
    rc = ar.cmd_check(_Args())
    out = capsys.readouterr().out
    assert rc == 1, "a corpus fixture with no fire-log block was accepted"
    assert "a_fixture_nobody_recorded" in out and "SILENTLY SKIPPED" in out
    assert "=== CHECK (" not in out, (
        "the rail must refuse BEFORE the replay — otherwise it costs ten minutes "
        "to learn the corpus is out of sync")


def test_check_refuses_a_fire_log_block_whose_bars_are_gone(monkeypatch, capsys):
    """The other direction: a digest measured against bars that no longer exist."""
    monkeypatch.setattr(ar, "fixture_names", lambda: list(_ORIGINAL_FIXTURES))
    rc = ar.cmd_check(_Args())
    out = capsys.readouterr().out
    assert rc == 1
    assert "not in the frozen corpus" in out
    for name in _EXTENDED_FIXTURES:
        assert name in out


def test_the_coverage_rail_is_not_vacuous_on_the_real_artifacts(fire_log):
    """…and it says nothing when the two artifacts agree, which they must today."""
    unrecorded, orphaned = ar.corpus_coverage(fire_log)
    assert unrecorded == [] and orphaned == []


def test_check_cannot_be_dodged_with_only(monkeypatch, capsys):
    """`--only` selects what is REPLAYED; it may not select what is CHECKED FOR.

    The rail is a property of the two artifacts, so narrowing the run must not
    narrow it — otherwise the way to silence it is to ask for less.
    """
    monkeypatch.setattr(
        ar, "fixture_names",
        lambda: [*_ORIGINAL_FIXTURES, *_EXTENDED_FIXTURES, "phantom"])
    assert ar.cmd_check(_Args(only=["wick_that_unwinds"])) == 1
    assert "phantom" in capsys.readouterr().out


# ─── the append records in the SHAPE the frozen blocks were recorded in ──────

def test_fire_blocks_reproduces_a_committed_block(fire_log, wick, forming):
    """One definition of what a fire-log block IS, demonstrated on a frozen one.

    `--record --append` and `--record` share `_fire_blocks`. If they did not, an
    appended fixture could be recorded in a shape the gate reads differently and
    the equality would quietly become a shape check.
    """
    alerts, _ladders = ar.build_alert_grid("wick_that_unwinds", wick, "5", forming)
    fires = {k: ar.replay(wick, alerts, k=k, evaluate=forming) for k in ar.RECORD_KS}
    blocks, fires_n, slots_n, addrs = ar._fire_blocks(
        {"fires": fires, "alerts": alerts, "bars": wick}, "wick_that_unwinds")
    committed = fire_log["fixtures"]["wick_that_unwinds"]["fires"]
    assert json.dumps(blocks, sort_keys=True) == json.dumps(committed, sort_keys=True)
    assert fires_n == sum(committed[str(k)]["count"] for k in ar.RECORD_KS)
    assert 0 < fires_n < slots_n
    assert set(addrs) <= set(ev.INDICATOR_FUNCS)


def test_record_append_refuses_a_fixture_it_has_already_recorded():
    with pytest.raises(SystemExit, match="already has a fire-log block"):
        ar.cmd_record_append(_Args(only=["wick_that_unwinds"], append=True))


def test_record_append_refuses_to_append_nothing():
    with pytest.raises(SystemExit, match="needs --only"):
        ar.cmd_record_append(_Args(only=[], append=True))


def test_record_append_refuses_a_fixture_that_was_never_frozen():
    with pytest.raises(SystemExit, match="not in the frozen corpus"):
        ar.cmd_record_append(_Args(only=["not_a_frozen_fixture"], append=True))


# ─── the declared diff is scoped to what the declaration measured ────────────

def test_diff_scope_is_the_declarations_own_fixture_list_and_names_the_rest():
    """⛔ THE DECLARATION IS A BUDGET MEASURED ON A NAMED SET.

    `fire_diff_declared.json` records `measured.fixtures`, and each row's `count`
    is a bound observed over exactly those series. Driving MORE tape through the
    same bounds over-budgets rows for a reason that has nothing to do with the
    lane. So the gate runs on the declaration's own set — and the fixtures it does
    NOT bound are returned by name, every run, because scoping silently would make
    the declaration look like it covered the corpus.
    """
    from api.services import alert_shadow_log as shadow

    declared = shadow.declared_diff()
    driven, outside = ar.diff_scope(declared, None)
    assert driven == list(_ORIGINAL_FIXTURES) == declared["measured"]["fixtures"]
    assert set(outside) == set(_EXTENDED_FIXTURES), (
        "the fixtures outside the declaration's scope must be NAMED — a silently "
        "narrowed gate is the same defect one layer down")
    driven, outside = ar.diff_scope(declared, ["high_vol_5m"])
    assert driven == ["high_vol_5m"]
    assert "intraday5m" in outside
    # with no declaration at all the scope is the whole corpus, which is the
    # state cmd_diff already reports as "everything is undeclared"
    driven, outside = ar.diff_scope(None, None)
    assert driven == list(ar.fixture_names()) and outside == []


# ─── THE FINDING: the 60-minute grid is not uniform ──────────────────────────

def test_bar_close_epoch_lands_on_the_next_bar_start_in_the_60m_open_buckets():
    """🔴 THE FINDING, AND ITS FIX, IN ONE TEST. RE-DERIVED — READ THE HISTORY.

    `bars_fetch.bucket_60_et_unix_seconds` gives the regular-session open its own
    bucket, so a 60-minute session runs 04:00…09:00, **09:30**, 10:00…19:00 and
    BOTH the 09:00 and the 09:30 bar span THIRTY minutes, not sixty.
    `indicator_alert_evaluator.bar_close_epoch` used to answer `t + 3600` for
    every intraday 60-minute bar, so it declared each of those two closed half an
    hour after the store had already stopped writing to it — a closed-lane
    LATENCY, not a wrong number: an alert on the 09:00 or the 09:30 hourly bar
    could not fire until 30 minutes after that bar became final, in the busiest
    half hour of the day.

    ⚠️ AND THE REPLAY HARNESS STRUCTURALLY CANNOT SEE IT, which is why this is
    asserted directly instead of being read off `--repaint` or `--diff`.
    `make_closed_evaluate` derives `now_epoch` from `bar_close_epoch` itself
    (`close_at - 1`), so an error in that function cancels out of every replay
    number. Only a wall clock — or this, an equality against the NEXT BAR'S START
    on real tape — can catch it.

    ⭐ THE ORACLE IS UNCHANGED AND IT IS STILL AN ORACLE. The left-hand side is a
    calendar computation; the right-hand side is a frozen store artifact this
    function never reads. What flipped is the EXPECTATION: the two open buckets
    now close where the tape says they closed, and the assertion that used to
    record the 1,800-second overstatement now records that the overstatement is
    gone — stated as the delta against the nominal answer, so the number the
    finding was written about is still in the file. It goes red again from either
    direction: a revert to `t + 3600` breaks the equality on 20 bars, and a store
    that stopped anchoring the open bucket breaks the shape assertion.

    The full behavioural measurement — the poll sweep, the end-to-end fire, and
    the earliness rail read off `bar_rollup.bucket_start` — lives in
    `tests/test_alert_bar_close_60m_grid.py`.
    """
    import datetime
    import zoneinfo

    et = zoneinfo.ZoneInfo("America/New_York")
    bars = ar.load_fixture("hourly_open_60m")["bars"]
    shortened: dict = {}
    adjacent = gaps = 0
    for i in range(len(bars) - 1):
        close_at = ev.bar_close_epoch(bars[i]["t"], "60")
        assert close_at is not None
        assert close_at <= bars[i + 1]["t"], (
            f"the bar at {bars[i]['t']} is superseded at {bars[i + 1]['t']} "
            f"before bar_close_epoch says it closes at {close_at}")
        if close_at == bars[i + 1]["t"]:
            adjacent += 1
        else:
            gaps += 1
        if close_at != bars[i]["t"] + 3600:
            start = datetime.datetime.fromtimestamp(bars[i]["t"], et).strftime("%H:%M")
            # what the nominal answer WOULD have overstated this bar by
            shortened.setdefault(start, []).append(bars[i]["t"] + 3600 - close_at)
    assert set(shortened) == {"09:00", "09:30"}, (
        f"the 60-minute grid changed shape: {sorted(shortened)}")
    for start, deltas in shortened.items():
        assert set(deltas) == {1800}, (start, sorted(set(deltas)))
        assert len(deltas) >= 8, (start, len(deltas))
    assert adjacent >= 180 and gaps >= 10, (adjacent, gaps)


@pytest.mark.parametrize("name,tf,step", [("thin_illiquid_5m", "5", 300),
                                          ("halfday_30m", "30", 1800),
                                          ("gap_open_5m", "5", 300),
                                          ("high_vol_5m", "5", 300)])
def test_the_other_intraday_grids_are_uniform(name, tf, step):
    """The control for the finding above: 5 and 30 do NOT have the open bucket.

    Without this, "the 60-minute grid is irregular" could be a statement about the
    store rather than about the hourly bucketer, and the finding would not
    localise to one function.
    """
    bars = ar.load_fixture(name)["bars"]
    for i in range(len(bars) - 1):
        close_at = ev.bar_close_epoch(bars[i]["t"], tf)
        assert close_at == bars[i]["t"] + step
        assert bars[i + 1]["t"] >= close_at, (
            f"{name}: the bar at {bars[i]['t']} is superseded before "
            f"bar_close_epoch says it closes")


# ─── THE DIRECT INVARIANCE CHECK (the repaint oracle is NOT sufficient) ──────
#
# 🔴 TASK 5 MEASURED THAT "0 REPAINTS" DOES NOT MEAN "CORRECT": restoring the
# original defect (`prev = last_value`) scores ZERO on the oracle, because
# `replay` writes `last_value` back after every sample and the closed value is
# identical at every sample of a bar. So the closed lane's real property is stated
# here DIRECTLY, on the new tape, with no set arithmetic in the way:
#
#     the closed lane's answer is a function of (address, params, window,
#     condition, threshold) and NOTHING ELSE — in particular it does not depend on
#     `last_value`, which is the poll-granularity number the forming lane measures
#     its crossings against.
#
# A lane that read `last_value` fails this on its first differing input, whatever
# the repaint number said.

def _probe_windows(bars, n=5):
    """`n` evenly spaced 200-bar production windows, warm end included."""
    lo = min(len(bars) - 1, 60)
    if len(bars) - 1 <= lo:
        lo = len(bars) // 2
    idx = sorted({int(lo + (len(bars) - 1 - lo) * j / max(1, n - 1)) for j in range(n)})
    return [bars[max(0, i + 1 - ar.PROD_BAR_WINDOW):i + 1] for i in idx]


_LAST_VALUES = (None, 0.0, -1e9, 1e9, 42.5)


def _thresholds_around(value, cond):
    """A ladder STRADDLING the observed value, not sitting on it.

    ⚠️ THIS IS WHERE THE FIRST VERSION OF THIS PROBE WAS VACUOUS, AND ITS OWN
    CONTROL CAUGHT IT. Setting `threshold == value` makes `current > threshold`
    and `current < threshold` both False, so EVERY condition answers False for
    every `prev` and the invariance below holds trivially — on any evaluator
    whatsoever. `test_the_forming_lane_answer_DOES_depend_on_last_value` failed on
    exactly that (0 answers moved), which is what the control is for.
    """
    if not cond.get("needs_threshold"):
        return [None]
    d = max(abs(value) * 1e-3, 1e-6)
    return [value - d, value + d]


def _lane_probe(lane, name, tf, bars, addresses):
    """`(comparisons, answers-that-moved-with-last_value, triggered-count)`.

    One walk, used by BOTH the invariance assertion and its control, so the two
    cannot drift into probing different things.
    """
    compared = moved = triggered = 0
    for window in _probe_windows(bars):
        for address in addresses:
            base = {"id": 1, "user_id": "t", "sym": name, "tf": tf,
                    "indicator": address, "condition": "above", "threshold": None,
                    "params_json": None, "last_value": None, "alert_key": "probe"}
            value, _t = lane(dict(base), window)
            if value is None:
                continue
            for cond in ev.ALERT_CONDITIONS[address]:
                for thr in _thresholds_around(value, cond):
                    answers = {lane(dict(base, condition=cond["value"],
                                         threshold=thr, last_value=lv), window)
                               for lv in _LAST_VALUES}
                    compared += 1
                    if len(answers) > 1:
                        moved += 1
                    triggered += sum(1 for _v, t in answers if t)
    return compared, moved, triggered


@pytest.mark.parametrize("name", _EXTENDED_FIXTURES)
def test_the_closed_lane_answer_does_not_depend_on_last_value(name, closed):
    """The property, asserted directly on every new fixture."""
    fx = ar.load_fixture(name)
    compared, moved, triggered = _lane_probe(closed, name, fx["tf"], fx["bars"],
                                             list(ev.INDICATOR_FUNCS))
    assert moved == 0, (
        f"{name}: {moved} of {compared} CLOSED-lane answers changed when only "
        "`last_value` changed — the lane is reading the poll-granularity prev, "
        "which is the defect this phase removes. The repaint oracle cannot see "
        "this (Task 5's M1 repaints ZERO and is still wrong); this can.")
    assert compared > 150, f"{name}: only {compared} comparisons — thin"
    # ⛔ AND THE PROBE HAS TO BE ABLE TO SEE A FIRE. An all-False walk satisfies
    # the invariance on any evaluator at all, which is how the first version of
    # this test was vacuous.
    assert triggered > 0, f"{name}: no probe answer was ever True — vacuous"


@pytest.mark.parametrize("name", ["gap_open_5m", "high_vol_5m", "halfday_30m"])
def test_the_forming_lane_answer_DOES_depend_on_last_value(name, forming):
    """The non-vacuity control for the test above.

    If `last_value` could not change ANY answer on this tape, the invariance the
    closed lane satisfies would be a property of the PROBE rather than of the
    lane, and the test above would pass against an evaluator that ignored its
    inputs entirely. Same walk, same thresholds, same `last_value` ladder — only
    the lane changes.
    """
    fx = ar.load_fixture(name)
    compared, moved, triggered = _lane_probe(forming, name, fx["tf"], fx["bars"],
                                             list(ev.INDICATOR_FUNCS))
    assert moved > 0, (
        f"{name}: NO forming-lane answer moved with last_value over {compared} "
        "comparisons — the probe cannot see the dependency it is the control for")
    assert triggered > 0


# ─── what each new fixture actually presents, measured ──────────────────────

def test_the_gap_open_fixture_opens_far_from_the_prior_close():
    import datetime
    import zoneinfo

    et = zoneinfo.ZoneInfo("America/New_York")

    def _at(b):
        return datetime.datetime.fromtimestamp(b["t"], et)

    bars = ar.load_fixture("gap_open_5m")["bars"]
    days = sorted({_at(b).date() for b in bars})
    assert len(days) == 2
    prev = [b for b in bars if _at(b).date() == days[0]
            and 9 * 60 + 30 <= _at(b).hour * 60 + _at(b).minute < 16 * 60]
    cur = [b for b in bars if _at(b).date() == days[1]
           and _at(b).strftime("%H:%M") == "09:30"]
    gap = (cur[0]["o"] - prev[-1]["c"]) / prev[-1]["c"] * 100
    assert gap > 30, f"the gap is only {gap:+.2f}%"
    assert max(bars[i]["t"] - bars[i - 1]["t"] for i in range(1, len(bars))) >= 8 * 3600


def test_the_thin_fixture_makes_the_closed_bar_half_a_day_old():
    """⛔ `closed_bar_index` IS NOT `len(bars) - 2` — reason 3, on real tape.

    A thin ticker's newest bar can be hours old and unambiguously closed. This
    asserts the fixture reaches that state rather than merely claiming to, and
    that the lane RESOLVES it instead of returning -1.
    """
    fx = ar.load_fixture("thin_illiquid_5m")
    bars = fx["bars"]
    worst = 0
    resolved = 0
    for i in range(2, len(bars)):
        window = bars[max(0, i + 1 - ar.PROD_BAR_WINDOW):i + 1]
        now = ev.bar_close_epoch(window[-1]["t"], fx["tf"]) - 1
        j = ev.closed_bar_index(window, fx["tf"], now)
        assert j >= 0, "a thin window resolved NO closed bar"
        resolved += 1
        worst = max(worst, window[-1]["t"] - window[j]["t"])
    assert worst >= 12 * 3600, f"the widest hole is only {worst}s"
    assert resolved > 200


def test_the_halfday_fixture_carries_a_13_00_close_and_a_holiday_hole():
    import datetime
    import zoneinfo

    et = zoneinfo.ZoneInfo("America/New_York")

    def _at(b):
        return datetime.datetime.fromtimestamp(b["t"], et)

    bars = ar.load_fixture("halfday_30m")["bars"]
    days = {_at(b).date() for b in bars}
    assert datetime.date(2025, 11, 27) not in days, "Thanksgiving has bars"
    assert datetime.date(2025, 11, 28) in days
    half = [b for b in bars if _at(b).date() == datetime.date(2025, 11, 28)]
    last_rth = [b for b in half if _at(b).hour < 16][-1]
    assert _at(last_rth).strftime("%H:%M") == "13:00"
    after = [b for b in half if b["t"] > last_rth["t"]]
    assert after and after[0]["t"] - last_rth["t"] >= 2 * 3600
    assert all(_at(b).utcoffset() == datetime.timedelta(hours=-5) for b in bars), "not EST"


def test_the_warmup_fixture_hands_both_lanes_a_series_that_is_not_warm():
    """Leading warmup AND the trailing pad, on the fixture built for them."""
    from api.services import alert_series

    bars = ar.load_fixture("warmup_first_bars_5m")["bars"]
    late: dict = {}
    trailing: dict = {}
    for address in alert_series.SERIES_FUNCS:
        col = alert_series.series_for(address, bars, {})
        if col is None:
            continue
        first = next((i for i, v in enumerate(col) if v is not None), None)
        if first is None or first > 0:
            late[address] = len(col) if first is None else first
        if col[-1] is None:
            trailing[address] = sum(1 for v in reversed(col) if v is None)
    assert len(late) >= 20, sorted(late)
    assert max(late.values()) * 2 >= len(bars)
    assert "ichimoku.chikou" in trailing, (
        "the trailing-pad shape — the closed lane's one accepted casualty — is "
        "not present in the fixture built to carry it")


def test_the_daily_fixture_is_a_calendar_key_not_an_instant():
    """20260805 read as unix seconds is 1970-08-23 — the live VWAP defect.

    `gap_daily`'s `t` is a YYYYMMDD calendar key, which is what the daily lane is
    handed, and its close resolves through the ET calendar to the NEXT MIDNIGHT —
    not 16:00, because extended-hours prints still update the stored daily row.
    """
    import datetime

    fx = ar.load_fixture("gap_daily")
    bars = fx["bars"]
    assert fx["tf"] == "D"
    assert all(isinstance(b["t"], int) and 20250000 < b["t"] < 20270000 for b in bars)
    for b in bars[:20]:
        close_at = ev.bar_close_epoch(b["t"], "D")
        day = datetime.date(b["t"] // 10000, b["t"] // 100 % 100, b["t"] % 100)
        assert close_at == ev._et_midnight_epoch(day + datetime.timedelta(days=1))
        # …and NOT 16:00 ET, the boundary that would call a bar closed that then
        # changed on an after-hours print
        assert close_at > ev._et_midnight_epoch(day) + 16 * 3600
    gaps = [(bars[i]["o"] - bars[i - 1]["c"]) / bars[i - 1]["c"] * 100
            for i in range(1, len(bars))]
    assert min(gaps) < -20 and max(gaps) > 12
