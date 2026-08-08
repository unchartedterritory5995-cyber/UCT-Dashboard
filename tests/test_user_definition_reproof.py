"""AN EDIT IS RE-PROVEN ON THE TREE IT WILL ACTUALLY EVALUATE — OR REFUSED.

🔴 THE GAP THIS FILE CLOSES, in the audit's own words: *"with `forget()` now
firing, the rebuilt tree is the NEW tree, admitted on a cross-lane proof taken
against the OLD one."* Pre-existing in shape, newly REACHABLE the moment a member
can edit a formula — which is what the same commit wires up.

The arm-time proof already existed and is real: `alert_user_series
._gate_cross_lane` runs BOTH lanes over the tree on the alert's own bars and
refuses unless they agree at `rel_tol 1e-9` across all 579 of them, before the
alert row is inserted. What it lacked was a way back in. A `forget` dropped the
registry entry, `user_value_function` rebuilt it from the store through FOUR
gates, and the fifth — the equality — was never re-run. So the sentence a member
is shown ("you have been switched to new maths") was true, and the sentence the
system believed ("these two lanes agree about this formula") was about a
different formula.

⛔ WHAT MAKES THE FIX AUDITABLE IS A ONE-LINE INVARIANT: **an entry in
`USER_FUNCS` is a proof receipt, and `admit_user_definition` is its only
writer.** A miss is therefore not "rebuild it" but "prove it again, on this
alert's own bars, or refuse naming the gate". Section 5 asserts the sole-writer
claim structurally, by AST, because a second writer is invisible to every
behavioural test that happens to arm first.

⛔ AND EVERY QUIET IN THIS FILE IS PAIRED WITH A RUN THAT MAKES IT NOISY.
"Refused by a different door" is the defect this branch has measured five times —
a correct outcome produced by the wrong mechanism. A cross-lane refusal, an
unregistered address and a suppressed cycle all look identical from outside: no
notification left the building. So each one is measured against its own control.
"""
from __future__ import annotations

import ast as _ast
import json
import math
import pathlib
import sqlite3
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import user_definitions as router_mod
from api.services import alert_rev_migration as rev
from api.services import alert_user_series as aus
from api.services import indicator_alert_evaluator as ev
from api.services import indicator_alert_service as ias
from api.services import user_definitions as ud
from api.services import watchlist_alert_service as wls

ROOT = pathlib.Path(__file__).resolve().parents[1]
PARITY_BARS = ROOT / "app" / "src" / "pages" / "parityBars" / "intraday5m.json"

USER = "reproof-user"
DEF_ID = "u_0123456789ab"
ADDRESS = f"{DEF_ID}.value"

#: ⭐ THE SAME REAL GAP TASK 10 MEASURED, ON THE SAME REAL BARS — and this file
#: reaches it through the REAL user lane rather than through a stub registered in
#: `INDICATOR_FUNCS`. `sma(close, 20)` reads 112.685 on the chart-parity intraday
#: fixture and `sma(close, 50)` reads 111.4522; a threshold of 112 sits strictly
#: between them, so an alert armed "below 112" fires the instant the edit lands
#: even though no bar moved.
STRADDLE = 112.0


# ─── the formulas ────────────────────────────────────────────────────────────

def _ast_sma(period: int) -> dict:
    return {"type": "call", "name": "sma", "args": [
        {"type": "series", "name": "close"},
        {"type": "num", "value": period},
    ]}


def defn(period: int = 20, *, name: str = "My Average",
         def_id: str = DEF_ID, ast_override=None) -> dict:
    return {
        "schemaVersion": 1,
        "id": def_id,
        "version": 1,
        "meta": {"name": name, "shortName": "MA", "repaint": "non-repainting"},
        "compute": {"kind": "ast",
                    "ast": _ast_sma(period) if ast_override is None else ast_override,
                    "source": f"sma(close, {period})"},
        "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": [],
    }


def _bars() -> list[dict]:
    payload = json.loads(PARITY_BARS.read_text(encoding="utf-8"))
    return [dict(b) for b in payload["bars"]]


def _sma_last(bars: list[dict], period: int) -> float:
    """The reference number, computed HERE and not read off the lane under test.

    ⛔ NOT `ast_interpret`. Asserting the alert's value equals what
    `ast_interpret` says would be the interpreter agreeing with itself; the point
    of every number below is that the ALERT moved onto the formula the member
    saved, so the expectation has to come from arithmetic this file owns.
    """
    closes = [float(b["c"]) for b in bars]
    return sum(closes[-period:]) / period


# ─── the world ───────────────────────────────────────────────────────────────

@pytest.fixture
def env(tmp_path, monkeypatch):
    """The real store, a real alert DB, real bars, and the REAL user lane.

    ⛔ NO ADDRESS STUB. `tests/test_user_definitions.py` registers the definition
    in `INDICATOR_FUNCS` / `SERIES_FUNCS` so its migration measurements do not
    depend on the admission chain; that is right for what it measures and wrong
    for what this file measures. Here the number an alert reads comes out of
    `alert_user_series.USER_FUNCS`, built by `admit_user_definition`, which is the
    only lane a real member's formula is ever evaluated on.
    """
    monkeypatch.setattr(ud, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    monkeypatch.setenv("USER_DEFINITIONS_DB_PATH", str(tmp_path / "user_definitions.db"))
    ud._init_db()

    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    rev.init_schema()

    bars = _bars()
    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=200: [dict(b) for b in bars])

    sent: list[dict] = []
    monkeypatch.setattr(wls, "deliver_alert_payload",
                        lambda **kwargs: sent.append(kwargs))

    # The lane is NAMED, never inherited from the committed constant — see
    # `tests/test_user_definitions.py`'s fixture for the session in which a
    # cutover moved four tests' meaning without touching a line of them.
    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, "forming")

    aus.forget()
    try:
        yield {"bars": bars, "sent": sent, "monkeypatch": monkeypatch, "db": alert_db}
    finally:
        aus.forget()


@pytest.fixture(params=ev.EVAL_MODES)
def lane(request, env):
    env["monkeypatch"].setenv(ev.ALERT_EVAL_MODE_ENV, request.param)
    assert ev.eval_mode() == request.param, (
        f"asked for the {request.param!r} lane and `eval_mode()` answers "
        f"{ev.eval_mode()!r}")
    return request.param


def _alert_row(alert_id: int) -> dict:
    row = ias.get(alert_id)
    assert row is not None
    return row


def _arm(alert_id: int, *, last_value, last_evaluated_at):
    con = sqlite3.connect(str(ias._DB_PATH))
    try:
        con.execute(
            "UPDATE indicator_alerts SET last_value=?, last_evaluated_at=? WHERE id=?",
            (last_value, last_evaluated_at, int(alert_id)))
        con.commit()
    finally:
        con.close()


def _fires(sent: list[dict]) -> list[int]:
    return [s["extra_data"]["alert_id"] for s in sent
            if s.get("source") == "indicator_alert"]


def _value(alert_id: int, bars: list[dict], mode: str):
    """What the alert lane reads for this alert, on the NAMED lane."""
    if mode == "closed":
        value, _triggered, _i = ev._evaluate_one_closed(
            _alert_row(alert_id), bars=bars,
            now_epoch=float(bars[-1]["t"]) + 86_400.0)
        return value
    value, _triggered = ev._evaluate_one(_alert_row(alert_id), bars=bars,
                                         mode="forming")
    return value


def _conformance():
    """The one comparator module, reached the way `alert_user_series` reaches it.

    ⛔ PERTURBED HERE RATHER THAN IN `alert_user_series`. The gate under test is
    `_gate_cross_lane`; replacing the function it CALLS would be testing the stub.
    Breaking `run_js` / `run_py` is breaking the LANE, which is the condition the
    gate exists to have an opinion about.
    """
    return aus._conformance()


class _lane_disagreement:
    """Make the two lanes disagree by exactly one element, and PUT IT BACK.

    ⛔ IT OWNS ITS OWN RESTORE. fix-A recorded a control that read the wrong
    number because `monkeypatch.setattr`'s undo runs at TEST teardown, not at
    `with` exit — so the positive control that followed a refusal ran against a
    still-perturbed lane. This restores at `__exit__` and asserts it did.
    """

    def __init__(self, delta: float = 1.0):
        self.delta = delta
        self.mod = _conformance()
        self.original = self.mod.run_py

    def __enter__(self):
        original = self.original
        delta = self.delta

        def perturbed(cases, bars):
            out = original(cases, bars)
            for key, column in out.items():
                moved = list(column)
                for i in range(len(moved) - 1, -1, -1):
                    if moved[i] is not None:
                        moved[i] = float(moved[i]) + delta
                        break
                else:                                    # pragma: no cover
                    raise AssertionError(
                        f"{key}: every value is None, so nothing could be "
                        "perturbed and the 'lanes disagree' case is vacuous")
                out[key] = moved
            return out

        self.mod.run_py = perturbed
        return self

    def __exit__(self, *exc):
        self.mod.run_py = self.original
        assert self.mod.run_py is self.original, "the lane was not restored"
        return False


# ═══ 1. THE FLOOR — the two formulas really do disagree ══════════════════════

def test_the_two_formulas_disagree_and_the_threshold_sits_BETWEEN_them(env):
    """Without a gap every assertion below passes while measuring nothing."""
    old = _sma_last(env["bars"], 20)
    new = _sma_last(env["bars"], 50)
    assert old == pytest.approx(112.685, abs=5e-4), old
    assert new == pytest.approx(111.4522, abs=5e-4), new
    assert new < STRADDLE < old, (
        f"the threshold {STRADDLE} does not separate {new} from {old} — the edit "
        "would fabricate nothing and every suppression case would be vacuous")


# ═══ 2. THE HEADLINE — an armed alert evaluates the NEW maths ════════════════

def test_an_EDIT_makes_the_ARMED_ALERT_evaluate_the_NEW_maths_and_the_OLD_VALUE_IS_ABSENT(
        env, lane):
    """🔴 THE MEASURED FAILURE, AS A GATE — through the REAL user lane.

    The failure was: a member is told *"switched to new maths"* and then evaluates
    the rev-1 value forever. So both halves are asserted — the new number is
    present AND the old number is absent — on both lanes, because the forming
    lane reads `fn(bars, params)` and the closed lane reads `fn.column(...)[i]`
    and a fix that reached only one of them would leave the shipped lane stale.
    """
    old, new = _sma_last(env["bars"], 20), _sma_last(env["bars"], 50)
    ud.save(USER, DEF_ID, defn(20))
    alert_id = ias.create(user_id=USER, sym="PARITY", indicator=ADDRESS,
                          condition="below", threshold=STRADDLE, tf="5")

    before = _value(alert_id, env["bars"], lane)
    assert before == pytest.approx(old, abs=1e-6), (
        f"on the {lane!r} lane the alert did not read the ORIGINAL formula — "
        "nothing below would mean anything")

    result = ud.save(USER, DEF_ID, defn(50))
    assert result["rev_bumped"] is True and result["rev"] == 2, result
    assert result["migrated"] == 1, (
        f"the armed binding was not migrated ({result}) — the story this test "
        "tells is not being driven")

    after = _value(alert_id, env["bars"], lane)
    assert after == pytest.approx(new, abs=1e-6), (
        f"on the {lane!r} lane the alert is STILL evaluating the pre-edit tree")
    assert after != pytest.approx(old, abs=1e-3), (
        "the rev-1 value is still what the alert reads — this is the measured "
        "failure verbatim: told about new maths, judged on the old")


# ═══ 3. THE RE-PROOF — on the tree it will ACTUALLY evaluate ═════════════════

def _hash(tree) -> str:
    return ud.ast_hash(tree)


def test_a_REV_BUMP_RE_ENTERS_the_1e_9_proof_ON_THE_NEW_TREE(env):
    """🔴🔴 THE CORRECTNESS GAP, MEASURED BY THE TREE THAT WAS PROVEN.

    ⛔ NOT "the proof ran again" — *which tree it ran on*. A re-proof that
    re-measured the OLD tree would be a call count going up and the defect
    surviving underneath it, which is the whole shape of "a stale proof reads as
    evidence". The spy records `ast_hash` of every tree handed to
    `cross_lane_report` and the assertion is on the SEQUENCE.

    ⭐ AND THE SPY DELEGATES. It is a wrapper around the real comparator, so the
    proof genuinely runs (`compared: 579`, `rel_tol: 1e-9`) and the assertion is
    made about a measurement rather than instead of one.
    """
    proofs: list[dict] = []
    real = aus.cross_lane_report

    def spy(tree, bars, inputs=None):
        report = real(tree, bars, inputs)
        proofs.append({"hash": _hash(tree), "compared": report.get("compared"),
                       "rel_tol": report.get("rel_tol")})
        return report

    env["monkeypatch"].setattr(aus, "cross_lane_report", spy)

    ud.save(USER, DEF_ID, defn(20))
    alert_id = ias.create(user_id=USER, sym="PARITY", indicator=ADDRESS,
                          condition="below", threshold=STRADDLE, tf="5")
    assert len(proofs) == 1, f"arming proved {len(proofs)} times, expected 1"
    assert proofs[0]["hash"] == _hash(_ast_sma(20))
    assert proofs[0]["compared"] == len(env["bars"]) and proofs[0]["rel_tol"] == 1e-9, (
        f"the arm-time proof covered {proofs[0]} — a comparison over nothing is "
        "not a comparison")

    # ⭐ THE CONTROL FOR "IT JUST PROVES EVERY TIME": a registry HIT does not.
    for _ in range(3):
        ev._evaluate_one(_alert_row(alert_id), bars=env["bars"], mode="forming")
    assert len(proofs) == 1, (
        f"an admitted, unedited alert re-proved {len(proofs) - 1} extra times — a "
        "node subprocess per evaluation cycle is not the design and it would make "
        "the assertion below satisfiable without any re-proof mechanism at all")

    ud.save(USER, DEF_ID, defn(50))                       # the maths edit
    ev._evaluate_one(_alert_row(alert_id), bars=env["bars"], mode="forming")

    assert len(proofs) == 2, (
        "the tree the alert now evaluates was NEVER proven cross-lane — it was "
        "admitted on the proof taken against the tree it replaced")
    assert proofs[1]["hash"] == _hash(_ast_sma(50)), (
        "the re-proof ran on the OLD tree. A proof of the tree that is no longer "
        "there is worse than none, because it reads as evidence")
    assert proofs[1]["compared"] == len(env["bars"])


def test_a_RESTART_re_proves_too_because_the_RECEIPT_is_per_process(env):
    """The other way the registry empties, and it must behave the same.

    A redeploy leaves `USER_FUNCS` empty with alerts still armed. Before this
    commit that rebuilt them through four gates and served them; now it re-enters
    the whole chain. `forget()` is the same state a fresh process is in, which is
    why one mechanism covers both.
    """
    proofs: list[str] = []
    real = aus.cross_lane_report
    env["monkeypatch"].setattr(
        aus, "cross_lane_report",
        lambda tree, bars, inputs=None: (proofs.append(_hash(tree)),
                                         real(tree, bars, inputs))[1])

    ud.save(USER, DEF_ID, defn(20))
    alert_id = ias.create(user_id=USER, sym="PARITY", indicator=ADDRESS,
                          condition="below", threshold=STRADDLE, tf="5")
    assert len(proofs) == 1

    aus.forget()                                     # ≡ a fresh process
    assert aus.USER_FUNCS == {}
    ev._evaluate_one(_alert_row(alert_id), bars=env["bars"], mode="forming")
    assert proofs == [_hash(_ast_sma(20)), _hash(_ast_sma(20))], proofs


# ═══ 4. A LANE THAT CANNOT RUN IS A REFUSAL, NEVER AN ADMISSION ═════════════

def test_a_LANE_THAT_CANNOT_RUN_REFUSES_and_the_gate_is_NAMED(env):
    """⛔ THE FAILURE DIRECTION, PINNED. A box without node must admit NOTHING.

    `run_js` raises `LaneUnavailable` rather than returning `{}` for exactly this
    reason; catching it and serving the formula anyway would ship one number on
    the server and another on the author's chart with nothing to say so.

    ⭐ AND THE POSITIVE CONTROL IS IN THE SAME TEST, AFTER THE RESTORE. A refusal
    that is really "this definition was always broken" would refuse in both runs.
    """
    conf = _conformance()
    ud.save(USER, DEF_ID, defn(20))
    alert_id = ias.create(user_id=USER, sym="PARITY", indicator=ADDRESS,
                          condition="below", threshold=STRADDLE, tf="5")
    ud.save(USER, DEF_ID, defn(50))                  # the edit → registry dropped

    original = conf.run_js
    conf.run_js = lambda cases, bars: (_ for _ in ()).throw(
        conf.LaneUnavailable("no node on this box"))
    try:
        with pytest.raises(aus.AdmissionRefused) as caught:
            aus.value_function_for_alert(_alert_row(alert_id))
        assert caught.value.gate == "cross-lane", caught.value.gate
        # …and nothing was admitted behind the refusal.
        assert aus.USER_FUNCS == {}, (
            "a lane that could not run left a registered value function behind — "
            "the next cycle would read that as a proof receipt")
        # ⛔ AND IT PROPAGATES INTO THE EVALUATOR RATHER THAN FLATTENING TO
        # `(None, False)`. `_evaluate_one` resolves the user lane OUTSIDE its own
        # try/except for exactly this reason: a refused alert that returned "no
        # number" would be byte-identical to an admitted one on a quiet market.
        with pytest.raises(aus.AdmissionRefused):
            _value(alert_id, env["bars"], "forming")
        # …and a whole cycle still delivers nothing and does not crash: the
        # per-alert handler logs it and counts an error.
        env["sent"].clear()
        ev._run_one_cycle()
        assert _fires(env["sent"]) == [], (
            "an alert whose lane could not be proven still delivered")
    finally:
        conf.run_js = original
    assert conf.run_js is original, "the lane was not restored"

    # THE CONTROL: with the lane back, the very same alert is admitted.
    fn = aus.value_function_for_alert(_alert_row(alert_id))
    assert fn is not None and fn(env["bars"], {}) == pytest.approx(
        _sma_last(env["bars"], 50), abs=1e-6)


def test_LANES_THAT_DISAGREE_refuse_the_edited_tree_rather_than_serving_it(env):
    """⛔ THE OTHER HALF: the lane RAN and the numbers do not match at 1e-9.

    This is the case a stale proof hides completely — the old tree agreed, so
    everything downstream believes the new one does.
    """
    ud.save(USER, DEF_ID, defn(20))
    alert_id = ias.create(user_id=USER, sym="PARITY", indicator=ADDRESS,
                          condition="below", threshold=STRADDLE, tf="5")
    ud.save(USER, DEF_ID, defn(50))

    with _lane_disagreement():
        with pytest.raises(aus.AdmissionRefused) as caught:
            aus.value_function_for_alert(_alert_row(alert_id))
    assert caught.value.gate == "cross-lane"
    assert aus.REFUSAL_FRAGMENTS["cross-lane"] in str(caught.value)
    assert aus.USER_FUNCS == {}

    # THE CONTROL, on the restored lane: the same alert admits.
    assert aus.value_function_for_alert(_alert_row(alert_id)) is not None


def test_the_REFUSAL_IS_ATTRIBUTABLE_where_a_quiet_never_is(env):
    """`refusal_for_alert` is what makes "refused" different from "silent"."""
    ud.save(USER, DEF_ID, defn(20))
    alert_id = ias.create(user_id=USER, sym="PARITY", indicator=ADDRESS,
                          condition="below", threshold=STRADDLE, tf="5")
    assert aus.refusal_for_alert(_alert_row(alert_id)) is None, (
        "an admitted alert reports a refusal — every reading below is inverted")

    ud.save(USER, DEF_ID, defn(50))
    with _lane_disagreement():
        refusal = aus.refusal_for_alert(_alert_row(alert_id))
    assert isinstance(refusal, aus.AdmissionRefused) and refusal.gate == "cross-lane"


# ═══ 5. THE RECEIPT HAS EXACTLY ONE WRITER ══════════════════════════════════

def _user_funcs_writers() -> set[str]:
    """Every function in `alert_user_series` that assigns into `USER_FUNCS[...]`.

    ⛔ AST, NEVER A GREP. That module's docstrings name `USER_FUNCS` a dozen
    times, and a grep on this branch once reported five call sites for
    `admit_alert_fire` of which all five were prose.
    """
    source = (ROOT / "api" / "services" / "alert_user_series.py").read_text(
        encoding="utf-8")
    tree = _ast.parse(source)
    writers: set[str] = set()
    for func in _ast.walk(tree):
        if not isinstance(func, (_ast.FunctionDef, _ast.AsyncFunctionDef)):
            continue
        for node in _ast.walk(func):
            targets = []
            if isinstance(node, _ast.Assign):
                targets = list(node.targets)
            elif isinstance(node, (_ast.AugAssign, _ast.AnnAssign)):
                targets = [node.target]
            for target in targets:
                if isinstance(target, _ast.Subscript) \
                        and isinstance(target.value, _ast.Name) \
                        and target.value.id == "USER_FUNCS":
                    writers.add(func.name)
    return writers


def test_USER_FUNCS_HAS_EXACTLY_ONE_WRITER_AND_IT_IS_THE_ADMISSION():
    """🔴 THE INVARIANT THE WHOLE FIX RESTS ON, ASSERTED STRUCTURALLY.

    "An entry means the tree behind it was proven" is only true while
    `admit_user_definition` — the one function that runs `_gate_cross_lane` before
    it writes — is the only writer. `user_value_function` used to write here too,
    and that made the receipt FORGEABLE: `GET /api/indicator-alerts/current-value`
    resolves through it, so a read-only prefill could seed the registry with a
    tree nothing had proven and the next cycle would never look again.

    Behavioural tests cannot see a second writer that is only reached by a path
    they do not exercise, which is precisely how the prefill hole survived.
    """
    writers = _user_funcs_writers()
    assert writers == {"admit_user_definition"}, (
        f"`USER_FUNCS` is written by {sorted(writers)}. Exactly one function may "
        "write a proof receipt, and it is the one that proves the tree first")


def test_the_writer_scan_can_SEE_a_writer(env):
    """The control on the scan itself — an extractor that finds nothing would
    make the assertion above pass on a file with ten writers."""
    module = _ast.parse(
        "def a():\n    USER_FUNCS[k] = v\n\ndef b():\n    x = USER_FUNCS[k]\n")
    found = set()
    for func in _ast.walk(module):
        if isinstance(func, _ast.FunctionDef):
            for node in _ast.walk(func):
                if isinstance(node, _ast.Assign):
                    for target in node.targets:
                        if isinstance(target, _ast.Subscript) \
                                and isinstance(target.value, _ast.Name) \
                                and target.value.id == "USER_FUNCS":
                            found.add(func.name)
    assert found == {"a"}, found
    assert _user_funcs_writers(), "the real scan found nothing at all"


def test_a_PREFILL_CANNOT_MINT_AN_ADMISSION(env):
    """⛔ THE FORGED RECEIPT, AS A CASE.

    `GET /api/indicator-alerts/current-value` calls `user_value_function`
    directly to show the author what their formula reads right now. That is a
    DISPLAY, on no bars anybody proved anything with, and it must not leave a
    registration behind — otherwise the next evaluation cycle finds a receipt for
    a tree that was never proven and stops asking.
    """
    ud.save(USER, DEF_ID, defn(20))
    alert_id = ias.create(user_id=USER, sym="PARITY", indicator=ADDRESS,
                          condition="below", threshold=STRADDLE, tf="5")
    ud.save(USER, DEF_ID, defn(50))
    assert aus.USER_FUNCS == {}

    prefill = aus.user_value_function(USER, ADDRESS)
    assert prefill is not None and prefill(env["bars"], {}) == pytest.approx(
        _sma_last(env["bars"], 50), abs=1e-6), (
        "the prefill stopped answering — a display that refuses is a different "
        "regression and this case would then be vacuous")
    assert aus.USER_FUNCS == {}, (
        "the prefill registered a value function. That entry is indistinguishable "
        "from an admission, so the alert lane would serve an unproven tree")

    # …and the alert lane still re-proves, which is what the empty registry buys.
    with _lane_disagreement():
        with pytest.raises(aus.AdmissionRefused):
            aus.value_function_for_alert(_alert_row(alert_id))


# ═══ 6. THE CYCLE — quiet first, correct second, noisy without the suppression ═

def _armed_pair(*, armed_at: int) -> tuple[int, int]:
    """One crossing binding and one LEVEL binding, both holding the old number.

    ⚠️ THE LEVEL BINDING IS THE HALF THE RESET CANNOT COVER — `below` never reads
    `prev`, so a file built only from crossings goes green with the suppression
    deleted.
    """
    cross = ias.create(user_id=USER, sym="PARITY", indicator=ADDRESS,
                       condition="cross_below", threshold=STRADDLE, tf="5")
    level = ias.create(user_id=USER, sym="PARITY", indicator=ADDRESS,
                       condition="below", threshold=STRADDLE, tf="5")
    for aid in (cross, level):
        _arm(aid, last_value=112.685, last_evaluated_at=armed_at)
    return cross, level


def test_the_first_cycle_after_a_USER_EDIT_is_QUIET_and_the_second_CORRECT(env, lane):
    """⭐ Task 10's headline, re-measured on the REAL user lane rather than a stub.

    ⚠️ THE MEASUREMENT IS A DELIVERY, NOT A FLAG. `rev_migrated_at` being set
    asserts the bookkeeping; no notification leaving the building asserts what the
    member experiences.
    """
    ud.save(USER, DEF_ID, defn(20))
    cross, level = _armed_pair(armed_at=int(time.time()) - 7200)

    edited = ud.save(USER, DEF_ID, defn(50))
    assert edited["migrated"] == 2, edited
    env["sent"].clear()

    summary = ev._run_one_cycle()
    assert _fires(env["sent"]) == [], (
        f"the user's own edit fabricated {_fires(env['sent'])} on the first "
        f"post-edit cycle ({lane!r} lane)")
    assert summary["suppressed"] == 2 and summary["evaluated"] == 0, summary

    env["sent"].clear()
    summary = ev._run_one_cycle()
    assert summary["suppressed"] == 0
    assert _fires(env["sent"]) == [level], (
        f"expected only the LEVEL binding on the second cycle, got "
        f"{_fires(env['sent'])}")
    assert cross not in _fires(env["sent"])
    assert summary["evaluated"] == 2, (
        f"the post-suppression cycle evaluated {summary['evaluated']} of 2 — a "
        "quiet here is the wrong door, not a working suppression")


def test_the_QUIET_STOPS_when_the_SUPPRESSION_IS_DELETED(env, lane):
    """⭐⭐ THE ATTRIBUTION. Which mechanism produced the quiet? Delete the one
    claimed responsible and the cycle must go noisy.

    ⚠️ AND THE NOISE IS THE LEVEL BINDING ONLY, on both lanes: the crossing is
    covered by the `last_value` reset on the forming lane and is structurally
    unreachable on the closed one. Two mechanisms, two disjoint halves.
    """
    ud.save(USER, DEF_ID, defn(20))
    _cross, level = _armed_pair(armed_at=int(time.time()) - 7200)
    ud.save(USER, DEF_ID, defn(50))
    env["sent"].clear()

    env["monkeypatch"].setattr(rev, "suppress_first_cycle", lambda alert: False)
    ev._run_one_cycle()
    assert _fires(env["sent"]) == [level], (
        f"on the {lane!r} lane the first cycle stayed quiet with the suppression "
        "DELETED — the quiet in the test above comes from some other mechanism")


def test_the_quiet_is_not_the_WRONG_DOOR(env, lane):
    """⛔ The vacuous green, run deliberately so the difference is the measurement.

    With the definition DELETED the address resolves to nothing, every cycle is
    quiet whatever the migration did, and the suppression can be deleted without
    changing a thing. That is what the two tests above would look like if the
    admission chain had silently stopped working.
    """
    ud.save(USER, DEF_ID, defn(20))
    _cross, _level = _armed_pair(armed_at=int(time.time()) - 7200)
    ud.save(USER, DEF_ID, defn(50))
    ud.soft_delete(USER, DEF_ID)
    aus.forget()
    env["sent"].clear()

    env["monkeypatch"].setattr(rev, "suppress_first_cycle", lambda alert: False)
    ev._run_one_cycle()
    assert _fires(env["sent"]) == [], (
        "a definition that no longer exists still delivered — this control is "
        "supposed to be the SILENT one")


# ═══ 7. A BROKEN EDIT MUST NOT BRICK A WORKING INDICATOR ════════════════════

@pytest.fixture
def app(env):
    a = FastAPI()
    a.include_router(router_mod.router)
    a.dependency_overrides[get_current_user_with_plan] = \
        lambda: {"id": USER, "role": "user", "plan": "premium"}
    return a


def test_an_EDIT_THAT_FAILS_A_GATE_is_refused_AND_THE_OLD_VERSION_KEEPS_WORKING(
        env, app):
    """🔴 THE FAILURE DIRECTION OF THE EDIT PATH ITSELF.

    An edit is a WRITE over something that is working: a definition on a chart
    with alerts armed against it. If a refused edit could append anything — a
    version, a rev, a migration — the member's working indicator would be
    replaced by their broken one and there would be no way back except the store's
    version history, which nothing in the product surfaces.

    ⛔ THE TREE IS REFUSED BY `ast_hash`'s canonical check, which is the first
    gate `save()` runs and the one that cannot be reached by a lint override — so
    this measures the ORDERING (refuse before you migrate, refuse before you
    append), not the particular gate.
    """
    ud.save(USER, DEF_ID, defn(20))
    alert_id = ias.create(user_id=USER, sym="PARITY", indicator=ADDRESS,
                          condition="below", threshold=STRADDLE, tf="5")
    good = _value(alert_id, env["bars"], "forming")
    assert good == pytest.approx(_sma_last(env["bars"], 20), abs=1e-6)

    broken = defn(50, ast_override={"type": "call", "name": "sma",
                                    "args": [{"type": "series", "name": "close"}],
                                    "extra": "not a canonical key"})
    client = TestClient(app)
    refused = client.put(f"/api/user-definitions/{DEF_ID}", json={"definition": broken})
    assert refused.status_code == 400, refused.text
    assert "astHash" in refused.json()["detail"], refused.json()

    assert len(ud.history(USER, DEF_ID)) == 1, (
        "the refused edit appended a version — a broken formula is now the "
        "newest thing the chart and the alert lane resolve")
    live = ud.get(USER, DEF_ID)
    assert live["rev"] == 1 and live["version"] == 1
    assert live["definition"]["compute"]["ast"] == _ast_sma(20)
    assert rev.rev_row(alert_id) is None, (
        "a migration ran for an edit that was refused — the binding's "
        "`last_value` was reset and a cycle eaten for a save that never happened")
    assert _value(alert_id, env["bars"], "forming") == pytest.approx(good, abs=1e-6), (
        "the armed alert stopped reading the version that still works")


def test_a_PUT_at_an_id_WITH_NO_HISTORY_is_a_404_not_an_upsert(env, app):
    """⛔ AN EDIT REQUIRES SOMETHING TO EDIT.

    `save()` happily appends version 1 at any id in the caller's own namespace, so
    a PUT used to let a client CHOOSE its definition ids — the exact property
    `create_definition` refuses ("THE SERVER MINTS THE ID"), one route over. A
    typo'd id is now a 404 rather than a second, invisible definition.
    """
    client = TestClient(app)
    missing = client.put("/api/user-definitions/u_ffffffffffff",
                         json={"definition": defn(20, def_id="u_ffffffffffff")})
    assert missing.status_code == 404, missing.text
    assert ud.history(USER, "u_ffffffffffff") == []

    # …and a real edit still works, so the 404 is not simply "PUT is broken".
    created = client.post("/api/user-definitions", json={"definition": defn(20)})
    def_id = created.json()["def_id"]
    edited = client.put(f"/api/user-definitions/{def_id}",
                        json={"definition": defn(50, def_id=def_id)})
    assert edited.status_code == 200 and edited.json()["version"] == 2
    assert edited.json()["rev_bumped"] is True

    # …and a RESURRECT is an edit, not a create: the tombstone has history.
    assert client.delete(f"/api/user-definitions/{def_id}").status_code == 200
    back = client.put(f"/api/user-definitions/{def_id}",
                      json={"definition": defn(20, def_id=def_id)})
    assert back.status_code == 200, back.text
    assert ud.get(USER, def_id) is not None


def test_the_PUT_route_is_the_ONE_the_builder_calls():
    """The client and the server agree on the verb and the path, derived from
    both sides rather than restated in prose.

    ⛔ READ OFF THE ROUTE TABLE AND OFF THE HOOK'S SOURCE. A test that typed
    `"/api/user-definitions/{def_id}"` would pass while either side moved.
    """
    puts = {r.path for r in router_mod.router.routes
            if "PUT" in getattr(r, "methods", set())}
    assert puts == {"/api/user-definitions/{def_id}"}, puts

    hook = (ROOT / "app" / "src" / "hooks" / "useUserDefinitions.js").read_text(
        encoding="utf-8")
    assert "USER_DEFINITIONS_KEY = '/api/user-definitions'" in hook
    assert "method: defId ? 'PUT' : 'POST'" in hook, (
        "the hook no longer switches verb on the id, so the builder's edit path "
        "would silently POST a new definition instead of editing one")

    builder = (ROOT / "app" / "src" / "components" / "chart" / "builder"
               / "BuilderSheet.jsx").read_text(encoding="utf-8")
    assert "saveUserDefinition(doc, editing ? editing.defId : null)" in builder, (
        "the builder stopped passing an id to `saveUserDefinition`, which is the "
        "whole difference between a create and an edit")


# ═══ 8. the cost of the re-proof, stated as a number ════════════════════════

def test_the_REPROOF_costs_ONE_subprocess_per_MISS_and_none_per_cycle(env):
    """⚠️ THE PRICE, MEASURED RATHER THAN PROMISED.

    A re-proof spawns a node process. Putting one on every evaluation of every
    user alert would be a subprocess on the evaluator thread every 60 seconds per
    alert — so the invariant that pays for this design is that a HIT costs
    nothing, and that is asserted with a real cycle count.
    """
    calls: list[int] = []
    real = aus.cross_lane_report
    env["monkeypatch"].setattr(
        aus, "cross_lane_report",
        lambda tree, bars, inputs=None: (calls.append(1), real(tree, bars, inputs))[1])

    ud.save(USER, DEF_ID, defn(20))
    _armed_pair(armed_at=int(time.time()) - 7200)
    armed = len(calls)
    assert armed >= 1, "arming proved nothing — this measurement is vacuous"

    for _ in range(3):
        ev._run_one_cycle()
    assert len(calls) == armed, (
        f"{len(calls) - armed} re-proofs ran across three quiet cycles with "
        "nothing edited — that is a node subprocess per alert per minute")

    ud.save(USER, DEF_ID, defn(50))
    ev._run_one_cycle()                                   # suppressed
    ev._run_one_cycle()                                   # evaluates → re-proves
    assert len(calls) == armed + 1, (
        f"the edit cost {len(calls) - armed} proofs; one MISS is one proof, "
        "shared by every alert bound to the same definition")


def test_NaN_never_reaches_the_alert_lane_from_a_re_proven_column(env):
    """The boundary the re-proof must not disturb: a warmup pad is `None`, never
    NaN. Every comparison against NaN is False, so a NaN would be a formula that
    silently never fires rather than one reporting it has no number yet."""
    ud.save(USER, DEF_ID, defn(20))
    alert_id = ias.create(user_id=USER, sym="PARITY", indicator=ADDRESS,
                          condition="below", threshold=STRADDLE, tf="5")
    ud.save(USER, DEF_ID, defn(50))
    fn = aus.value_function_for_alert(_alert_row(alert_id))
    column = fn.column(env["bars"], {})
    assert len(column) == len(env["bars"])
    assert column[0] is None, "the warmup pad is not None"
    assert not any(isinstance(v, float) and math.isnan(v) for v in column)
