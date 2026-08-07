"""The coverage receipt: "swept through bar X at time T under rule-version V".

THE ONE SENTENCE THIS FILE IS ABOUT
-----------------------------------
**Absence of a signal is not proof of evaluation.**

`signature_signals` records what happened. Its silence records nothing at all:
a genuinely quiet tape and a symbol the nightly sweep has never walked produce
the byte-identical empty list. So every consumer that wants to serve "no signal"
as an ANSWER — and serving it is what would take the FCB cold read from seconds
to a local sqlite lookup — is one branch away from publishing a confident empty
answer for a symbol nobody ever looked at. That is
`lesson_market_cap_cache_poison` with the poison being *certainty*.

The receipt is the missing fact. It is written by the sweep, per symbol, over
the window the rule ACTUALLY EVALUATED, keyed by the rule VERSION, and only
when every signal that window produced was accepted by the store. A reader that
has one can say "evaluated, nothing found". A reader that has none must not.

Four ways a receipt could claim coverage it does not have, each with a rail:
  * over the FETCHED window instead of the EVALUATED one (the first
    `FCB_LOOKBACK` bars are warm-up nothing ever looks at);
  * across a rule RETUNE, where the ledger's own uniqueness key changes;
  * for a window that stops short of what the reader is asking about;
  * for a pass whose signals the store refused.
"""
import sqlite3
import time

import pytest
from datetime import date, timedelta
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import signature as sig
from api.middleware.auth_middleware import get_current_user_with_plan
from api.services.signature import ledger, rules
from api.services.signature import sweep as sweep_mod
from api.services.signature.flow_breakout import detect_breakouts, evaluated_window


@pytest.fixture
def tmp_ledger(tmp_path, monkeypatch):
    """BOTH the env var and the module constant — `_DB_PATH` is read at import,
    so the env alone would not move an already-imported module and the constant
    alone would leave a re-import reading `/data`. Nothing here may touch the
    live ledger."""
    p = tmp_path / "l.db"
    monkeypatch.setenv("SIGNAL_LEDGER_DB_PATH", str(p))
    monkeypatch.setattr(ledger, "_DB_PATH", str(p))
    monkeypatch.setattr(ledger, "_INITED", False)
    return p


def _fcb():
    return rules.VERSIONS["fcb"]


# ═══════════════════════════════════════════════════════════════════════════
# 1. THE HEADLINE — evaluated-and-empty vs never-evaluated
# ═══════════════════════════════════════════════════════════════════════════

def test_EVALUATED_BUT_EMPTY_is_distinguishable_from_NEVER_EVALUATED(tmp_ledger):
    """⭐ THE WHOLE POINT, in one assertion block.

    Two symbols. Neither has a single signal row. Before the receipt they were
    the same three bytes — `[]` — and no reader could act on either. After it,
    one of them carries a measured fact and the other carries nothing, and the
    two questions have two different answers.
    """
    ledger.record_coverage("fcb", _fcb(), "SWEPT", "1D", 20260601, 20260621)

    # The signal side: identical, and identically useless on its own.
    assert ledger.get_signals("SWEPT") == []
    assert ledger.get_signals("NEVER") == []

    # The receipt side: different questions, different answers.
    assert ledger.latest_coverage("fcb", _fcb(), "NEVER", "1D") is None, (
        "None is the answer that means NEVER EVALUATED")
    swept = ledger.latest_coverage("fcb", _fcb(), "SWEPT", "1D")
    assert swept is not None
    assert (swept["first_bar_time"], swept["through_bar_time"]) == (20260601, 20260621)

    assert ledger.coverage_covers("fcb", _fcb(), "SWEPT", "1D",
                                  first_bar_time=20260605,
                                  through_bar_time=20260618) is True
    assert ledger.coverage_covers("fcb", _fcb(), "NEVER", "1D",
                                  first_bar_time=20260605,
                                  through_bar_time=20260618) is False


def test_the_receipt_records_the_TIME_it_was_taken(tmp_ledger):
    """"Swept through bar X **at time T**". Without T there is no way to tell a
    receipt taken tonight from one taken in March under the same version, which
    is the difference between a healthy sweep and a dead scheduler."""
    before = time.time()
    ledger.record_coverage("fcb", _fcb(), "SPY", "1D", 20260601, 20260621)
    row = ledger.latest_coverage("fcb", _fcb(), "SPY", "1D")
    assert before <= row["swept_at"] <= time.time() + 1

    ledger.record_coverage("fcb", _fcb(), "QQQ", "1D", 20260601, 20260621, at=1_700_000_000.0)
    assert ledger.latest_coverage("fcb", _fcb(), "QQQ", "1D")["swept_at"] == 1_700_000_000.0


# ═══════════════════════════════════════════════════════════════════════════
# 2. THE WINDOW — a receipt may not certify a bar nothing looked at
# ═══════════════════════════════════════════════════════════════════════════

def _all_breakout_bars(n: int) -> list[dict]:
    """`n` bars where EVERY evaluable bar is a confirmed breakout.

    That is what makes the rail below an equality rather than an inequality: if
    every bar the detector can reach produces a signal, then the extremes of the
    signal list ARE the boundaries of the evaluated window, and the two can be
    compared directly instead of one bounding the other.

    Volume is the constraint that caps `n`: each spike raises the trailing
    average, so past ~32 bars a fixed 4x spike stops clearing 1.5x the average
    and the fixture would silently stop being all-breakout.
    """
    assert n <= 32, "the fixed volume spike stops clearing the rising average"
    start = date(2026, 6, 1)
    out = []
    for i in range(n):
        t = int((start + timedelta(days=i)).strftime("%Y%m%d"))
        if i < rules.FCB_LOOKBACK:
            out.append({"t": t, "o": 95.0, "h": 100.0, "l": 90.0, "c": 95.0, "v": 1000})
        else:
            c = 100.0 + (i - 19) * 2.0
            out.append({"t": t, "o": c - 1, "h": c + 1, "l": c - 2, "c": c, "v": 4000})
    return out


@pytest.mark.parametrize("n", [0, 1, 19, 20, 21, 22, 26, 28, 32])
@pytest.mark.parametrize("include_last", [False, True])
def test_the_coverage_window_is_exactly_what_detect_breakouts_EVALUATES(n, include_last):
    """🔴 THE RAIL AGAINST A RECEIPT THAT CLAIMS COVERAGE IT DOES NOT HAVE.

    `evaluated_window` duplicates `detect_breakouts`' `last_evaluable`
    expression, and it must also respect the `lookback` WARM-UP: the detector
    iterates `range(lookback, last_evaluable)`, so `bars[0]` through
    `bars[lookback - 1]` are never examined at all. A receipt written from
    `bars[0]` would certify up to 21 bars that no pass ever looked at — the
    exact lie a coverage receipt exists to make impossible.

    So the window is compared against the REAL detector, driven over a fixture
    where every evaluable bar signals. No shared constant, no shared expression:
    one side is the arithmetic, the other is the behaviour.
    """
    bars = _all_breakout_bars(n)
    fired = detect_breakouts(bars, include_last=include_last)
    window = evaluated_window(bars, include_last=include_last)

    # Non-vacuity: the fixture must really be all-breakout, or the equality
    # below degenerates into comparing one signal against one boundary and
    # would hold for a window that certified only its own first bar.
    last_evaluable = n if include_last else n - 1
    assert len(fired) == max(last_evaluable - rules.FCB_LOOKBACK, 0), (
        f"n={n} include_last={include_last}: the fixture stopped being "
        f"all-breakout ({len(fired)} of {last_evaluable - rules.FCB_LOOKBACK})")

    if not fired:
        assert window is None, (
            f"n={n} include_last={include_last}: the detector evaluated NOTHING, "
            f"so there is nothing to certify — got {window!r}")
    else:
        assert window == (fired[0]["barTime"], fired[-1]["barTime"]), (
            f"n={n} include_last={include_last}")


def test_the_warm_up_bars_are_NOT_certified(tmp_ledger):
    """The concrete consequence, spelled out on a real window.

    A 28-bar fetch evaluates bars 20..26. A reader asking about bar 0 — which
    is inside the FETCHED range and outside the EVALUATED one — must be told no.
    """
    bars = _all_breakout_bars(28)
    first, through = evaluated_window(bars, include_last=False)
    assert (first, through) == (bars[20]["t"], bars[26]["t"])

    ledger.record_coverage("fcb", _fcb(), "SPY", "1D", first, through)
    assert ledger.coverage_covers("fcb", _fcb(), "SPY", "1D",
                                  first_bar_time=bars[0]["t"],
                                  through_bar_time=through) is False


def test_a_receipt_that_stops_SHORT_of_the_probe_certifies_nothing(tmp_ledger):
    """Staleness needs no clock and no TTL. A sweep that last ran three nights
    ago has a `through` older than tonight's newest closed bar, so it stops
    certifying by itself — which is the only kind of expiry that cannot be
    accidentally extended."""
    ledger.record_coverage("fcb", _fcb(), "SPY", "1D", 20260601, 20260618)
    assert ledger.coverage_covers("fcb", _fcb(), "SPY", "1D",
                                  first_bar_time=20260601,
                                  through_bar_time=20260618) is True
    assert ledger.coverage_covers("fcb", _fcb(), "SPY", "1D",
                                  first_bar_time=20260601,
                                  through_bar_time=20260621) is False


def test_a_receipt_that_starts_LATE_certifies_nothing(tmp_ledger):
    """Containment, not overlap. A receipt covering only the recent half of a
    window would otherwise certify the older half it never touched."""
    ledger.record_coverage("fcb", _fcb(), "SPY", "1D", 20260610, 20260621)
    assert ledger.coverage_covers("fcb", _fcb(), "SPY", "1D",
                                  first_bar_time=20260601,
                                  through_bar_time=20260621) is False


def test_a_receipt_for_ANOTHER_symbol_certifies_nothing(tmp_ledger):
    ledger.record_coverage("fcb", _fcb(), "SPY", "1D", 20260601, 20260621)
    assert ledger.coverage_covers("fcb", _fcb(), "QQQ", "1D",
                                  first_bar_time=20260601,
                                  through_bar_time=20260621) is False


def test_an_INVERTED_window_is_refused_at_the_door(tmp_ledger):
    """`through < first` certifies nothing, and worse: the containment query is
    `first <= ? AND through >= ?`, which an inverted row satisfies for ANY probe
    between the two ends. A receipt that covers everything by covering
    nothing."""
    with pytest.raises(ValueError, match="runs backwards"):
        ledger.record_coverage("fcb", _fcb(), "SPY", "1D", 20260621, 20260601)
    assert ledger.latest_coverage("fcb", _fcb(), "SPY", "1D") is None


# ═══════════════════════════════════════════════════════════════════════════
# 3. THE VERSION — a retune must not inherit the old rule's coverage
# ═══════════════════════════════════════════════════════════════════════════

def test_a_receipt_under_a_DIFFERENT_rule_version_certifies_nothing(tmp_ledger):
    """⛔ `VERSIONS["fcb"]` is "fcb-v2" because `FCB_VOL_MULT` moved 1.25 -> 1.5
    and that changed OUTPUT. The signal table's UNIQUE key already carries the
    version, deliberately orphaning every fcb-v1 row.

    A receipt that ignored the version would go on certifying "evaluated,
    nothing found" for a rule that has never run — coverage claimed for work
    never done, which is the strongest form of the lie this object exists to
    prevent.
    """
    ledger.record_coverage("fcb", "fcb-v1", "SPY", "1D", 20260601, 20260621)

    assert ledger.coverage_covers("fcb", "fcb-v1", "SPY", "1D",
                                  first_bar_time=20260601,
                                  through_bar_time=20260621) is True
    assert ledger.coverage_covers("fcb", _fcb(), "SPY", "1D",
                                  first_bar_time=20260601,
                                  through_bar_time=20260621) is False
    assert ledger.latest_coverage("fcb", _fcb(), "SPY", "1D") is None


def test_a_receipt_for_a_DIFFERENT_indicator_or_timeframe_certifies_nothing(tmp_ledger):
    ledger.record_coverage("dpl", _fcb(), "SPY", "1D", 20260601, 20260621)
    ledger.record_coverage("fcb", _fcb(), "SPY", "1W", 20260601, 20260621)
    assert ledger.coverage_covers("fcb", _fcb(), "SPY", "1D",
                                  first_bar_time=20260601,
                                  through_bar_time=20260621) is False


# ═══════════════════════════════════════════════════════════════════════════
# 4. THE DOOR — refusals, idempotence, and the untouched signal table
# ═══════════════════════════════════════════════════════════════════════════

def test_the_same_window_twice_is_idempotent(tmp_ledger):
    """A re-run must be free, exactly like `record_signal` — the sweep re-sees
    the same session on a market holiday and nothing may double-enter."""
    assert ledger.record_coverage("fcb", _fcb(), "SPY", "1D", 20260601, 20260621) is True
    assert ledger.record_coverage("fcb", _fcb(), "SPY", "1D", 20260601, 20260621) is False
    with __import__("contextlib").closing(sqlite3.connect(str(tmp_ledger))) as c:
        assert c.execute("SELECT COUNT(*) FROM signature_coverage").fetchone()[0] == 1


def test_the_bar_times_are_NORMALIZED_the_way_the_signal_key_is(tmp_ledger):
    """One session arrives as a YYYYMMDD int, an ISO string and unix seconds.
    A receipt keyed in one encoding and probed in another certifies nothing,
    silently — the same failure `_normalize_bar_time` exists to stop on the
    signal side."""
    assert ledger.record_coverage("fcb", _fcb(), "SPY", "1D",
                                  "2026-06-01", "2026-06-21") is True
    assert ledger.record_coverage("fcb", _fcb(), "SPY", "1D",
                                  20260601, 20260621) is False, (
        "the ISO and the int forms must collapse onto ONE receipt")
    assert ledger.coverage_covers("fcb", _fcb(), "SPY", "1D",
                                  first_bar_time="2026-06-05",
                                  through_bar_time=20260618) is True


def test_the_receipt_refuses_a_BARS_STORE_timeframe_and_names_it(tmp_ledger):
    """"D" is what `bars_sqlite` stores daily rows under; "1D" is what every
    signal row carries. A receipt keyed "D" is a valid row that joins to
    nothing, and nothing would fail — the containment query would simply never
    match and the coverage feature would be silently dead."""
    with pytest.raises(ValueError, match="would certify a timeframe no signal"):
        ledger.record_coverage("fcb", _fcb(), "SPY", "D", 20260601, 20260621)
    with pytest.raises(ValueError, match="bars-store code for '1D'"):
        ledger.record_coverage("fcb", _fcb(), "SPY", "D", 20260601, 20260621)
    assert ledger.latest_coverage("fcb", _fcb(), "SPY", "1D") is None


def test_the_receipts_refusals_are_DISJOINT_from_the_signal_doors(tmp_ledger):
    """🔑 MEASURED ON THIS BRANCH ALREADY (Task 9's M1): two gates sharing a
    refusal phrase let a `pytest.raises(match=...)` keep passing after the OTHER
    gate was deleted. So the two `tf` doors are asserted to have NO phrase in
    common beyond ordinary English — the pins above and the pins in
    `test_signature_ledger` cannot cross-satisfy each other.
    """
    with pytest.raises(ValueError) as signal_side:
        ledger.record_signal("fcb", _fcb(), "SPY", "D", "bull", 20260621, 100.0)
    with pytest.raises(ValueError) as receipt_side:
        ledger.record_coverage("fcb", _fcb(), "SPY", "D", 20260601, 20260621)

    a, b = str(signal_side.value), str(receipt_side.value)
    assert "must be a product timeframe label" in a
    assert "must be a product timeframe label" not in b
    assert "would certify a timeframe no signal" in b
    assert "would certify a timeframe no signal" not in a


def test_an_empty_key_slot_is_refused(tmp_ledger):
    for bad in (("", _fcb(), "SPY", "1D"), ("fcb", "", "SPY", "1D"),
                ("fcb", _fcb(), "", "1D"), ("fcb", _fcb(), "SPY", "")):
        with pytest.raises(ValueError):
            ledger.record_coverage(*bad, 20260601, 20260621)


def test_the_SIGNAL_table_is_untouched_by_the_receipt(tmp_ledger):
    """The receipt is a SECOND table, not a change to the first.

    `signature_signals` holds real production history under an append-only
    contract and a UNIQUE key nothing may re-shape — a re-key orphans rows that
    cannot be reconstructed. These literals are the shipped columns and the
    shipped uniqueness; they are typed on purpose, because the assertion IS
    that they never move.
    """
    ledger.record_signal("fcb", _fcb(), "SPY", "1D", "bull", 20260621, 100.0)
    ledger.record_coverage("fcb", _fcb(), "SPY", "1D", 20260601, 20260621)

    with __import__("contextlib").closing(sqlite3.connect(str(tmp_ledger))) as c:
        cols = [r[1] for r in c.execute("PRAGMA table_info(signature_signals)")]
        assert cols == ["id", "indicator", "version", "sym", "tf", "direction",
                        "bar_time", "price", "first_seen_at", "meta_json"]
        ddl = c.execute("SELECT sql FROM sqlite_master WHERE name = ?",
                        ("signature_signals",)).fetchone()[0]
        assert "UNIQUE(indicator, version, sym, tf, bar_time, direction)" in ddl
        tables = {r[0] for r in c.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'")}
        assert {"signature_signals", "signature_coverage"} <= tables


# ═══════════════════════════════════════════════════════════════════════════
# 5. THE PRODUCER — the nightly sweep
# ═══════════════════════════════════════════════════════════════════════════

@pytest.fixture(autouse=True)
def _pin_session(monkeypatch):
    """Pin the expected latest session so nothing here depends on the day and
    hour the suite runs — the weekday-only time-bomb class."""
    monkeypatch.setattr(sweep_mod, "_expected_session",
                        lambda: _all_breakout_bars(28)[-1]["t"])


def _kwargs(bars, flow=None):
    return dict(fetch_bars=lambda s: bars,
                fetch_flow=lambda s, c: (flow if flow is not None else {}),
                now_iso="2026-08-06")


def _confirming_flow(bars, *idx):
    from api.services.signature.flow_breakout import _bar_date_iso
    return {_bar_date_iso(bars[i]["t"]): [{"CallPut": "CALL", "Premium": "900000"}]
            for i in idx}


def test_the_sweep_certifies_a_QUIET_symbol_and_that_IS_the_point(tmp_ledger):
    """A symbol with no signals gets a receipt. That is the entire feature: a
    quiet night is a MEASUREMENT, and until now it left no trace distinguishable
    from a night the sweep never ran."""
    bars = _all_breakout_bars(28)
    res = sweep_mod.run_sweep(["QUIET"], **_kwargs(bars, {}))   # no confirming flow

    assert res["recorded"] == 0 and res["errors"] == 0
    assert res["covered"] == 1 and res["uncovered"] == 0
    assert ledger.get_signals("QUIET") == []
    row = ledger.latest_coverage("fcb", _fcb(), "QUIET", "1D")
    assert row is not None
    assert (row["first_bar_time"], row["through_bar_time"]) == (
        bars[20]["t"], bars[27]["t"])           # include_last: the store is current


def test_the_sweep_certifies_the_window_it_EVALUATED_not_the_one_it_fetched(tmp_ledger):
    bars = _all_breakout_bars(28)
    sweep_mod.run_sweep(["SPY"], **_kwargs(bars, _confirming_flow(bars, 20)))
    row = ledger.latest_coverage("fcb", _fcb(), "SPY", "1D")
    assert row["first_bar_time"] == bars[rules.FCB_LOOKBACK]["t"]
    assert row["first_bar_time"] != bars[0]["t"], (
        "the fetched window is not the evaluated window")


def test_the_sweep_WITHHOLDS_the_receipt_when_a_signal_was_REFUSED(tmp_ledger, monkeypatch):
    """🔴 A REFUSED SIGNAL IS A SIGNAL THIS PASS FOUND AND THE STORE DROPPED.

    Certifying that window would tell every reader that the missing rows mean
    "nothing there" — the receipt would be true about the evaluation and a lie
    about the record, and a reader cannot tell those apart. So one refusal
    withholds the whole symbol's receipt.
    """
    bars = _all_breakout_bars(28)
    monkeypatch.setattr(ledger, "record_signal",
                        lambda *a, **kw: (_ for _ in ()).throw(ValueError("refused")))

    res = sweep_mod.run_sweep(["SPY"], **_kwargs(bars, _confirming_flow(bars, 20, 21)))

    assert res["errors"] >= 1
    assert res["covered"] == 0 and res["uncovered"] == 1
    assert ledger.latest_coverage("fcb", _fcb(), "SPY", "1D") is None, (
        "a window whose signals were dropped was certified anyway")


def test_the_sweep_certifies_NOTHING_for_a_symbol_that_evaluated_no_bar(tmp_ledger):
    """Too little history is not a quiet tape. `evaluated_window` returns None
    and the pass says `uncovered`, rather than certifying a window in which the
    detector could not have fired even once."""
    short = _all_breakout_bars(21)          # one bar shy of an evaluable one
    res = sweep_mod.run_sweep(["NEW"], **_kwargs(short, {}))
    assert res["scanned"] == 1 and res["covered"] == 0 and res["uncovered"] == 1
    assert ledger.latest_coverage("fcb", _fcb(), "NEW", "1D") is None


def test_a_dead_symbol_is_never_certified(tmp_ledger):
    """A symbol whose fetch raised never reached the compute, so it has no
    window and no receipt — the failure direction the whole sweep is built
    around."""
    def bars(s):
        raise RuntimeError("provider down")

    res = sweep_mod.run_sweep(["DEAD"], fetch_bars=bars,
                              fetch_flow=lambda s, c: {}, now_iso="2026-08-06")
    assert res["errors"] == 1 and res["covered"] == 0 and res["uncovered"] == 0
    assert ledger.latest_coverage("fcb", _fcb(), "DEAD", "1D") is None


def test_the_receipt_names_the_SAME_vocabulary_the_signal_rows_do(tmp_ledger):
    """A receipt keyed to a different indicator/version/tf than the rows it
    certifies certifies nothing, and NOTHING WOULD FAIL — the containment query
    would simply never match. Read off both sides of one real pass."""
    bars = _all_breakout_bars(28)
    sweep_mod.run_sweep(["SPY"], **_kwargs(bars, _confirming_flow(bars, 20)))

    signal = ledger.get_signals("SPY")[0]
    receipt = ledger.latest_coverage(signal["indicator"], signal["version"],
                                     "SPY", signal["tf"])
    assert receipt is not None, (
        "the receipt and the signal rows are keyed differently, so no reader "
        "can ever join them")


def test_a_second_identical_pass_still_reports_the_symbol_as_covered(tmp_ledger):
    """`record_coverage` returns False for a window already certified, and the
    receipt still says `covered` — the question is "is this symbol certified",
    not "did this pass write a row". A holiday re-run must not read as a
    coverage regression."""
    bars = _all_breakout_bars(28)
    first = sweep_mod.run_sweep(["SPY"], **_kwargs(bars, {}))
    again = sweep_mod.run_sweep(["SPY"], **_kwargs(bars, {}))
    assert first["covered"] == 1 and again["covered"] == 1


# ═══════════════════════════════════════════════════════════════════════════
# 6. THE READER — the router turns a receipt into an answer
# ═══════════════════════════════════════════════════════════════════════════

@pytest.fixture
def app(tmp_ledger, monkeypatch):
    for slot in (sig._DPL_STALE, sig._FCB_STALE, sig._GXW_STALE, sig._DPC_STALE):
        slot._slots.clear()
    sig._GXW_NEG_CACHE.clear()
    sig._FCB_NEG_CACHE.clear()
    sig.cache.delete_prefix("sig:")
    a = FastAPI()
    a.include_router(sig.router)
    a.dependency_overrides[get_current_user_with_plan] = lambda: {
        "id": "u1", "role": "user", "plan": "premium"}
    return a


def _flow_down(monkeypatch, bars):
    monkeypatch.setattr(sig, "_fetch_bars", lambda sym, count=60: bars)
    monkeypatch.setattr(sig, "_fetch_flow_by_date", lambda sym, cutoff_iso="": None)


def _certify(sym, bars):
    first, through = evaluated_window(bars, include_last=False)
    return ledger.record_coverage("fcb", _fcb(), sym, "1D", first, through)


def test_an_UNCERTIFIED_symbol_is_never_served_an_empty_answer(app, monkeypatch):
    """🔴 THE FAILING-WITHOUT-IT TEST.

    Delete the coverage check from `_fcb_build`'s failure branch and this
    endpoint answers a flow outage with `signals: []` for a symbol the sweep has
    never walked. `_fcb_good()` is `"signals" in p`, so that empty list is
    written to the TTL cache for 5 minutes AND remembered by the stale slot as
    the last good payload for 30 — a confident "no breakout here" invented out
    of an outage.
    """
    bars = _all_breakout_bars(28)
    _flow_down(monkeypatch, bars)

    body = TestClient(app).get("/api/signature/flow-breakout?sym=CRWV").json()

    assert body.get("error") == "flow unavailable", body
    assert "signals" not in body
    assert sig._FCB_STALE.peek("CRWV") == (None, None)


def test_a_CERTIFIED_symbol_IS_served_the_empty_answer_and_it_is_an_ANSWER(app, monkeypatch):
    """The other side of the same branch, and the payoff.

    The nightly sweep evaluated this exact window under this exact rule version
    and wrote nothing. "No breakout" is therefore a measurement, and it is the
    same measurement the live read would have produced — so it can be served
    from local sqlite instead of a multi-second flow read, and remembered,
    because it is an answer.
    """
    bars = _all_breakout_bars(28)
    _flow_down(monkeypatch, bars)
    assert _certify("SPY", bars) is True

    body = TestClient(app).get("/api/signature/flow-breakout?sym=SPY").json()

    assert body["signals"] == [] and body["source"] == "ledger"
    assert body["covered"] is True and not body.get("error")
    value, _age = sig._FCB_STALE.peek("SPY")
    assert value is not None, "a measured answer must be remembered"


def test_a_receipt_from_a_SUPERSEDED_rule_version_does_not_unlock_the_empty_answer(
        app, monkeypatch):
    """The retune case, end to end. After `fcb-v2` -> `fcb-v3` every stored
    receipt certifies a rule that no longer runs, and the endpoint must go back
    to reporting an outage rather than serving last month's silence."""
    bars = _all_breakout_bars(28)
    _flow_down(monkeypatch, bars)
    first, through = evaluated_window(bars, include_last=False)
    ledger.record_coverage("fcb", "fcb-v1", "SPY", "1D", first, through)

    body = TestClient(app).get("/api/signature/flow-breakout?sym=SPY").json()
    assert body.get("error") == "flow unavailable", body


def test_a_receipt_that_does_not_reach_this_windows_last_bar_is_not_enough(app, monkeypatch):
    """A sweep that has not run since Friday certifies a `through` older than
    the newest closed bar on Tuesday, and the endpoint must notice without
    consulting a clock."""
    bars = _all_breakout_bars(28)
    _flow_down(monkeypatch, bars)
    first, through = evaluated_window(bars, include_last=False)
    ledger.record_coverage("fcb", _fcb(), "SPY", "1D", first, bars[24]["t"])
    assert bars[24]["t"] < through

    body = TestClient(app).get("/api/signature/flow-breakout?sym=SPY").json()
    assert body.get("error") == "flow unavailable", body


def test_recorded_signals_still_win_over_a_bare_receipt(app, monkeypatch):
    """The shipped fallback is unchanged: real ledger rows are served whether or
    not a receipt exists. The receipt only ADDS the empty case."""
    bars = _all_breakout_bars(28)
    _flow_down(monkeypatch, bars)
    ledger.record_signal("fcb", _fcb(), "SPY", "1D", "bull", bars[22]["t"], 111.0,
                         meta={"callPrem": 1.0, "putPrem": 2.0})

    body = TestClient(app).get("/api/signature/flow-breakout?sym=SPY").json()
    assert [s["barTime"] for s in body["signals"]] == [bars[22]["t"]]
    assert body["source"] == "ledger" and body["covered"] is False


def test_the_coverage_read_never_raises_into_the_cold_path(app, monkeypatch):
    """It runs inside `build()`, which `ServeStale` calls with no try/except
    (serve_stale.py:143). A coverage read that can raise converts a degraded
    answer into a 500 on a user's chart."""
    bars = _all_breakout_bars(28)
    _flow_down(monkeypatch, bars)

    def boom(*a, **kw):
        raise RuntimeError("database is locked")

    monkeypatch.setattr(ledger, "coverage_covers", boom)

    r = TestClient(app, raise_server_exceptions=False).get(
        "/api/signature/flow-breakout?sym=SPY")
    assert r.status_code == 200, r.text
    assert r.json()["error"] == "flow unavailable"


def test_the_reader_writes_NOTHING_while_reading_a_receipt(app, monkeypatch):
    """The store is append-only and its honesty is the product's positioning.
    Serving a certified empty answer must not write a signal OR a receipt."""
    bars = _all_breakout_bars(28)
    _flow_down(monkeypatch, bars)
    _certify("SPY", bars)

    writes = []
    monkeypatch.setattr(ledger, "record_signal", lambda *a, **k: writes.append(a) or True)
    monkeypatch.setattr(ledger, "record_coverage", lambda *a, **k: writes.append(a) or True)

    body = TestClient(app).get("/api/signature/flow-breakout?sym=SPY").json()
    assert body["source"] == "ledger"
    assert writes == [], f"the read path wrote to the append-only store: {writes}"
