"""Phase D Task 12 — a user formula may alert; it may not become a receipt.

Three claims, in the order they matter:

  1. ⭐ THE INVARIANCE, AND IT IS THE HEADLINE. `USER_FUNCS` is a FOURTH address
     partition that the frozen replay grid never reads. Phase C Task 3 split
     `EVENT_FUNCS` off `INDICATOR_FUNCS` rather than growing it, because
     `tools/alert_replay.py::build_alert_grid` GENERATES the grid by iterating
     that dict and 685,193 recorded fires hang off the iteration; Task 10 split
     `PRICE_FUNCS` off on the same argument. This is the third time, and the
     proof is that three frozen numbers do not move.

  2. ⭐ THE ARM-TIME EQUALITY. A user formula has no committed golden fixture and
     one cannot be added per user, so the 1e-9 contract is carried by the TABLE
     and confirmed ONCE — on this user's real bars, for this tree — before the
     definition may ever produce a notification. ⚠️ THE MEASUREMENT IS A REFUSAL,
     NOT A FLAG: asserting `admitted_at is None` asserts the bookkeeping;
     refusing before the row is inserted asserts the thing the user experiences.

  3. ⛔ THE LEDGER DOOR STAYS SHUT (that half lives in
     `tests/test_alert_ledger_admission.py`, beside the door it guards).

🔴 AND EVERY REFUSAL NAMES ITS DOOR, BECAUSE THE DEFECT THIS PATH IS SHAPED LIKE
HAS APPEARED FIVE TIMES ON THIS BRANCH — twice inside harnesses written to catch
it. A user alert that never fires because something upstream refused it is
indistinguishable from one correctly admitted and quiet. So no test here asserts
merely *that* a refusal happened: each asserts WHICH gate refused, and each gate
is driven with an input that passes every OTHER gate, so a kill is attributable
to the door it names rather than to the one above it.
"""
import contextlib
import json
import os
import pathlib
import sqlite3
import sys

import pytest

_ROOT = pathlib.Path(__file__).resolve().parent.parent
if str(_ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(_ROOT / "tools"))

import alert_replay as ar                                          # noqa: E402
from api.services import alert_user_series as aus                  # noqa: E402
from api.services import indicator_alert_evaluator as ev           # noqa: E402
from api.services import indicator_alert_service as ias            # noqa: E402
from api.services import user_definitions as ud                    # noqa: E402
from api.services import watchlist_alert_service as wls            # noqa: E402


# ─── the baselines, written down as LISTS ────────────────────────────────────
#
# ⚠️ A LIST, NOT A COUNT, WHEREVER A RENAME MUST BE VISIBLE. Phase D Task 1
# measured this for real: a rail that answered `[]` for a RENAMED field left an
# entire per-plot assertion checking nothing while staying green. `len(...) == 28`
# survives `rsi` being renamed to `rsi2`; the list does not.
BASELINE_INDICATOR_FUNCS = 28
BASELINE_CATALOG_GROUPS = 16

#: Every address the GLOBAL space holds, in catalog order — the order the
#: dropdown renders and the order `build_alert_grid` iterates.
BASELINE_ADDRESSES = [
    "rsi", "macd", "bb", "stoch", "williams_r", "cci", "mfi", "price_vs_ma",
    "macd.signal", "macd.histogram", "bb.upper", "bb.middle", "bb.lower",
    "stoch.d", "vwap", "atr", "adx.adx", "adx.plusDI", "adx.minusDI", "obv",
    "donchian.upper", "donchian.middle", "donchian.lower", "ichimoku.tenkan",
    "ichimoku.kijun", "ichimoku.spanA", "ichimoku.spanB", "ichimoku.chikou",
    "sar.priceCrossedSar", "sar.trendFlipped", "close",
]

USER_A = "user-a"
USER_B = "user-b"
DEF_ID = "u_0123456789ab"
OTHER_DEF_ID = "u_ba9876543210"
ADDRESS = f"{DEF_ID}.value"


def _ast_sma(period: int = 20) -> dict:
    return {"type": "call", "name": "sma", "args": [
        {"type": "series", "name": "close"},
        {"type": "num", "value": period},
    ]}


def defn(*, def_id: str = DEF_ID, ast_tree=None, budget=None, kind: str = "ast",
         meta_extra: dict | None = None, plot_key: str = "value") -> dict:
    """A schema-v1 user definition — the shape `user_definitions.save` accepts."""
    compute: dict = {"kind": kind}
    if kind == "ast":
        compute["ast"] = ast_tree if ast_tree is not None else _ast_sma()
    else:
        compute["fn"] = "rsi"
    if budget is not None:
        compute["budget"] = budget
    meta = {"name": "My Average", "shortName": "MA"}
    meta.update(meta_extra or {})
    return {
        "schemaVersion": 1, "id": def_id, "version": 1, "meta": meta,
        "compute": compute, "placement": {"target": "price"},
        "plots": [{"key": plot_key, "style": "line", "role": "primary"}],
        "inputs": [],
    }


# ─── fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture
def defs_db(tmp_path, monkeypatch):
    """A private `user_definitions.db`, and an EMPTY registry either side.

    ⛔ `aus.forget()` RUNS BOTH BEFORE AND AFTER. `USER_FUNCS` is a module-level
    dict; a test that inherited a previous test's admission would prove that
    admission grants access, not that THIS one does — and one that leaked would
    make the next file's refusal test pass for the wrong reason
    (`lesson_teardown_must_undo_what_setup_created`).
    """
    path = tmp_path / "user_definitions.db"
    monkeypatch.setenv("USER_DEFINITIONS_DB_PATH", str(path))
    monkeypatch.setattr(ud, "_DB_PATH", str(path))
    ud._init_db()
    aus.forget()
    try:
        yield path
    finally:
        aus.forget()


@pytest.fixture
def alerts_db(tmp_path, monkeypatch):
    path = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(path))
    monkeypatch.setattr(ias, "_DB_PATH", str(path))
    ias.init_schema()
    return path


@pytest.fixture
def ledger_db(tmp_path, monkeypatch):
    from api.services.signature import ledger
    path = tmp_path / "signal_ledger.db"
    monkeypatch.setenv("SIGNAL_LEDGER_DB_PATH", str(path))
    monkeypatch.setattr(ledger, "_DB_PATH", str(path))
    monkeypatch.setattr(ledger, "_INITED", False)
    return path


def _ledger_rows(path) -> int:
    if not pathlib.Path(path).exists():
        return 0
    with sqlite3.connect(str(path)) as c:
        try:
            return c.execute("SELECT COUNT(*) FROM signature_signals").fetchone()[0]
        except sqlite3.OperationalError:
            return 0


@pytest.fixture(scope="module")
def real_bars():
    """579 bars of REAL tape — the shared parity series, digest-checked on load.

    The same series `tools/ast_conformance.py` proved the two lanes equal on
    (17 asts x 579 bars = 9,843 rows, zero differences). Using it here means the
    arm-time equality is measured against the tape the contract was established
    on, not against a synthetic ramp.
    """
    return ar.load_fixture("intraday5m")["bars"]


def _bars(closes, start_t=1_700_000_000, step=300):
    out = []
    for i, c in enumerate(closes):
        c = float(c)
        out.append({"t": start_t + i * step, "o": c, "h": c * 1.002,
                    "l": c * 0.998, "c": c, "v": 100_000})
    return out


#: A monotonic rise, so an `sma(close, 5)` alert at `above 120` is genuinely and
#: continuously true — the non-vacuity a "delivered once" claim needs.
RISING = _bars([100.0 + i for i in range(80)])
FALLING = _bars([100.0 + i for i in range(40)] + [140.0 - 2.0 * i for i in range(1, 41)])


@pytest.fixture
def channels(monkeypatch):
    """Two counters answering two different questions — Phase C Task 11's shape.

    ``invoked``   — how many times the evaluator ASKED for a delivery.
    ``delivered`` — how many times a member was actually TOLD, spied at
                    `add_alert`, which is INSIDE `deliver_alert_payload` and
                    therefore downstream of the fire-once gate.

    ⛔ A SPY THAT REPLACED `deliver_alert_payload` WOULD REPLACE THE GATE and
    every assertion below would pass on a tree with no gate in it. The wrapper
    calls the real one.
    """
    delivered: list = []
    invoked: list = []
    monkeypatch.setattr(wls, "add_alert", lambda *a, **k: delivered.append((a, k)))
    monkeypatch.setattr(wls, "send_email", lambda *a, **k: None)
    monkeypatch.setattr(wls, "_get_user_email", lambda uid: None)
    import api.services.alerts as _alerts
    monkeypatch.setattr(_alerts, "_fire_discord", lambda payload: None)

    real = wls.deliver_alert_payload

    def _wrapped(**kw):
        invoked.append(kw)
        return real(**kw)

    monkeypatch.setattr(wls, "deliver_alert_payload", _wrapped)
    return {"delivered": delivered, "invoked": invoked}


def save(user_id: str, definition: dict, *, repaint: dict | None = None) -> dict:
    """Store a definition, optionally OVERRIDING the linter's stored verdict.

    ⛔ THE OVERRIDE IS NOT A CHEAT AND IT IS THE ONLY WAY TO REACH THE GATE.
    Phase D Task 8 measured and recorded the reason: *with the shipped
    `closedTable.json` every declared lookback is >= 0 or `"argK"`, so `astReach`
    returns forward 0 for any table-legal tree* — i.e. today the linter CANNOT
    emit `repaints` or `preview-repaints` for anything a user can write. The
    repaint gate exists for the day the manifest declares a negative lookback
    (and for the `preview-repaints` verdict the linter already emits for
    `ichimoku.chikou` on the native lane). What the gate READS is the verdict
    STORED at save time — Task 10 pinned that deliberately so a linter change
    cannot silently re-badge an admitted definition — so writing that stored
    verdict is exactly the input the gate is built to refuse.

    ⚰️ *"THE ONLY WAY TO REACH THE GATE"* IS NO LONGER TRUE, and the correction is
    worth having in writing. The linter fails CLOSED on any shape it cannot
    bound, so `sma(close, <a declared input>)` measures `repaints` on the SHIPPED
    manifest with nothing written by hand — `tests/test_ast_inputs_end_to_end.py`
    drives `_gate_repaint` that way, with no override at all. The override is
    still the only way to reach the gate with a verdict the shipped table cannot
    otherwise produce (`preview-repaints`, and a DECLARED unbounded window), and
    that is what the cases below use it for.
    """
    row = ud.save(user_id, definition["id"], definition)
    if repaint is not None:
        with sqlite3.connect(str(ud._DB_PATH)) as c:
            c.execute("UPDATE user_definitions SET repaint=? "
                      "WHERE user_id=? AND def_id=? AND version=?",
                      (json.dumps(repaint), str(user_id), definition["id"],
                       row["version"]))
    return row


# ═══ 1. THE INVARIANCE — the gate that matters most, and it is not a feature ══

def test_the_frozen_INSTRUMENTS_are_byte_identical_after_the_fourth_partition(
        defs_db, real_bars):
    """🔴 THE HEADLINE GATE, AND IT IS AN INVARIANCE.

    `build_alert_grid` generates the frozen replay grid from `INDICATOR_FUNCS`,
    in order. Phase C Task 3 put SAR's events in a SEPARATE `EVENT_FUNCS` for
    exactly this reason — *growing that dict would have DESTROYED THE
    INSTRUMENT* — and Task 10 then added `close` in a THIRD partition on the same
    argument. So `USER_FUNCS` is a FOURTH partition that `build_alert_grid` does
    not read, and the proof is that the global address space does not move even
    with a user definition ADMITTED and registered.

    ⚠️ THE ADMISSION HAPPENS INSIDE THIS TEST ON PURPOSE. Measuring the address
    space on a tree where nothing was ever admitted proves only that an empty
    table changes nothing.
    """
    before_addresses = list(ev.all_addresses())
    before_indicator = list(ev.INDICATOR_FUNCS)
    before_catalog = [g["indicator"] for g in ev.alert_catalog()]

    save(USER_A, defn())
    admitted = aus.admit_user_definition(USER_A, DEF_ID, bars=real_bars)
    assert admitted["addresses"] == [ADDRESS], "nothing was admitted — this proves nothing"
    assert aus.USER_FUNCS, "the fourth partition is empty; the invariance is vacuous"

    assert list(ev.INDICATOR_FUNCS) == before_indicator
    assert len(ev.INDICATOR_FUNCS) == BASELINE_INDICATOR_FUNCS
    assert list(ev.all_addresses()) == before_addresses == BASELINE_ADDRESSES
    assert [g["indicator"] for g in ev.alert_catalog()] == before_catalog
    assert len(before_catalog) == BASELINE_CATALOG_GROUPS


def test_build_alert_grid_generates_the_SAME_grid_with_a_user_series_registered(
        defs_db, real_bars):
    """The frozen log's generator, driven for real, either side of an admission.

    `--check` replays this grid against committed per-alert digests. Rather than
    re-run the whole 22-pair replay inside the suite (minutes), this drives the
    GENERATOR — the one function whose output shape decides whether every
    committed digest still addresses the same alert — and requires the alert_key
    LIST to be identical, not merely the same length.
    """
    bars = ar.load_fixture("wick_that_unwinds")["bars"]
    evaluate = ar.make_forming_evaluate()
    before, _ = ar.build_alert_grid("wick_that_unwinds", bars, "5", evaluate)

    save(USER_A, defn())
    aus.admit_user_definition(USER_A, DEF_ID, bars=real_bars)

    after, _ = ar.build_alert_grid("wick_that_unwinds", bars, "5", evaluate)
    assert [a["alert_key"] for a in after] == [a["alert_key"] for a in before]
    assert len(before) > 100, "the grid is too small to be the instrument"
    assert not [a for a in after if aus.is_user_address(a["indicator"])]


def test_the_fourth_partition_is_NOT_in_ADDRESS_PARTITIONS(defs_db, real_bars):
    """⛔ BY IDENTITY, NOT BY NAME.

    `ADDRESS_PARTITIONS` is what `all_addresses()`, `alert_catalog()`,
    `value_function()` and `_CANONICAL_ADDRESS` all walk. Adding `USER_FUNCS` to
    it is the mutation this whole task is built around: it would put a per-user
    address into a global enumeration and change the shape of a 685,193-fire log.
    """
    assert all(p is not aus.USER_FUNCS for p in ev.ADDRESS_PARTITIONS)
    assert len(ev.ADDRESS_PARTITIONS) == 3

    save(USER_A, defn())
    aus.admit_user_definition(USER_A, DEF_ID, bars=real_bars)
    for partition in ev.ADDRESS_PARTITIONS:
        assert not [a for a in partition if aus.is_user_address(a)]


# ═══ 2. THE ARM-TIME EQUALITY — D-A2's runtime half ══════════════════════════

@contextlib.contextmanager
def lane_disagreement(monkeypatch, *, at_bar: int, by: float, lane: str = "py"):
    """Make ONE lane answer differently at ONE bar, by a relative amount.

    ⛔ IT PERTURBS A VALUE; IT DOES NOT BLIND A LANE. Phase C Task 5 measured the
    difference and it is the whole point: blinding `run_py` made the recorder
    refuse at `compare_lanes` — an EARLIER door — so the mutation proved nothing
    about the guard it targeted. *"The same 'refused by a different door' defect
    I found in the census, reproduced inside my own harness."* Here both lanes
    still return the same case ids and the same column lengths, so
    `compare_lanes`' three structural refusals cannot fire and the only thing
    left to report is the disagreement itself.
    """
    conf = aus._conformance()
    name = "run_py" if lane == "py" else "run_js"
    real = getattr(conf, name)

    def perturbed(cases, bars):
        out = real(cases, bars)
        for col in out.values():
            if col[at_bar] is not None:
                col[at_bar] = col[at_bar] * (1.0 + by)
        return out

    monkeypatch.setattr(conf, name, perturbed)
    yield


def test_a_user_definition_cannot_be_armed_until_BOTH_LANES_AGREE_on_the_bars(
        defs_db, real_bars, monkeypatch):
    """⭐ D-A2's runtime half, and the reason it is at ARM time.

    ⚠️ THE MEASUREMENT IS A REFUSAL, NOT A FLAG. Asserting that `admitted_at` is
    null asserts the bookkeeping; asserting that nothing was registered — so no
    alert can be armed on it and no notification can leave the building — asserts
    what the user experiences.
    """
    save(USER_A, defn())
    with lane_disagreement(monkeypatch, at_bar=200, by=1e-6):
        with pytest.raises(aus.AdmissionRefused,
                           match="the two lanes disagree at bar 200") as caught:
            aus.admit_user_definition(USER_A, DEF_ID, bars=real_bars)
    assert caught.value.gate == "cross-lane"
    assert aus.USER_FUNCS == {}, "a refused definition registered a series anyway"


def test_the_SAME_definition_admits_without_the_perturbation(defs_db, real_bars):
    """⛔ THE POSITIVE CONTROL. Without it the refusal above is satisfied by a
    gate that refuses everything, which is the shape Phase D Task 1's record
    calls out by name (*"'it says repaints' is satisfied by a linter that says
    repaints about everything"*).
    """
    save(USER_A, defn())
    admitted = aus.admit_user_definition(USER_A, DEF_ID, bars=real_bars)
    assert admitted["addresses"] == [ADDRESS]
    assert admitted["rel_tol"] == 1e-9
    assert admitted["compared"] == len(real_bars) == 579, (
        "the equality did not cover every bar — agreement over a sample is not "
        "agreement")


def test_the_disagreement_is_caught_from_EITHER_LANE(defs_db, real_bars, monkeypatch):
    """Both directions, because a comparator that read ONE lane twice would pass
    the test above. Phase C Task 15's M2 was exactly that defect, live: a diff
    that read the evaluator's partitions on BOTH SIDES of its own equality stayed
    green with the subject deleted.
    """
    save(USER_A, defn())
    with lane_disagreement(monkeypatch, at_bar=300, by=1e-6, lane="js"):
        with pytest.raises(aus.AdmissionRefused,
                           match="the two lanes disagree at bar 300") as caught:
            aus.admit_user_definition(USER_A, DEF_ID, bars=real_bars)
    assert caught.value.gate == "cross-lane"


def test_the_tolerance_is_TIGHT_and_that_is_measured_not_wished(
        defs_db, real_bars, monkeypatch):
    """1e-6 (1,000x the tolerance) is refused; 1e-12 is not.

    Task 5 committed the same measurement for the golden fixtures (1e-6 RED,
    1e-9 RED, 1e-11 GREEN). Repeating it here is what stops the arm-time gate
    being a comparison at some tolerance nobody checked.
    """
    save(USER_A, defn())
    with lane_disagreement(monkeypatch, at_bar=400, by=1e-12):
        admitted = aus.admit_user_definition(USER_A, DEF_ID, bars=real_bars)
    assert admitted["addresses"] == [ADDRESS], (
        "a 1e-12 perturbation was refused at a 1e-9 tolerance")


def test_a_lane_that_cannot_RUN_is_a_refusal_and_never_an_admission(
        defs_db, real_bars, monkeypatch):
    """⛔ THE FAILURE DIRECTION IS THE POINT.

    A box without node, or a missing `interpret.js`, must not admit everything.
    `run_js` raises `LaneUnavailable` rather than returning `{}` for exactly this
    reason; catching it and admitting would ship a formula that computes one
    number on the server and another on the author's chart, forever, with nothing
    to say so.
    """
    conf = aus._conformance()

    def dead(cases, bars):
        raise conf.LaneUnavailable("no node on this box")

    monkeypatch.setattr(conf, "run_js", dead)
    save(USER_A, defn())
    with pytest.raises(aus.AdmissionRefused,
                       match="the lanes could not be compared") as caught:
        aus.admit_user_definition(USER_A, DEF_ID, bars=real_bars)
    assert caught.value.gate == "cross-lane"
    assert aus.USER_FUNCS == {}


def test_no_bars_is_a_refusal_and_not_an_agreement_over_nothing(defs_db):
    """`compare_lanes` refuses an empty lane; this refuses before it gets there,
    so the message names the real problem rather than the comparator's."""
    save(USER_A, defn())
    with pytest.raises(aus.AdmissionRefused,
                       match="there are no bars to prove this formula on") as caught:
        aus.admit_user_definition(USER_A, DEF_ID, bars=[])
    assert caught.value.gate == "bars"


# ═══ 3. THE REPAINT BADGE IS A GATE, NOT A LABEL (spec §1.3) ═════════════════

def test_a_repainting_definition_cannot_be_armed_AT_ALL(defs_db, real_bars):
    save(USER_A, defn(), repaint={"value": "repaints"})
    with pytest.raises(aus.AdmissionRefused,
                       match="a repainting formula cannot arm an alert") as caught:
        aus.admit_user_definition(USER_A, DEF_ID, bars=real_bars)
    assert caught.value.gate == "repaint"
    assert aus.USER_FUNCS == {}


def test_a_preview_repainting_definition_needs_a_RECORDED_acknowledgement(
        defs_db, real_bars):
    """The middle verdict, and the reason the badge is a gate at all.

    `preview-repaints` means *final the moment bar i+k closes* — the
    `ichimoku.chikou` shape. An alert on one is defensible if the author has been
    told and is a support ticket if they have not.

    ⚠️ THE REFUSAL PHRASE IS DISJOINT FROM THE `repaints` ONE ABOVE even though
    both come from the same gate. Phase C Task 9's M1 found two gates sharing a
    phrase, so `pytest.raises(match=…)` matched with the safety DELETED; two
    branches of one gate sharing a phrase is the same defect one level in.
    """
    save(USER_A, defn(), repaint={"value": "preview-repaints"})
    with pytest.raises(aus.AdmissionRefused,
                       match="the preview-repaint badge has not been acknowledged"
                       ) as caught:
        aus.admit_user_definition(USER_A, DEF_ID, bars=real_bars)
    assert caught.value.gate == "repaint"


def test_the_acknowledgement_ADMITS_it_and_that_is_the_positive_control(
        defs_db, real_bars):
    """Without this the repaint gate is satisfied by one that refuses everything."""
    save(USER_A, defn(meta_extra={aus.REPAINT_ACK_KEY: {"value": 1_770_000_000}}),
         repaint={"value": "preview-repaints"})
    admitted = aus.admit_user_definition(USER_A, DEF_ID, bars=real_bars)
    assert admitted["addresses"] == [ADDRESS]


def test_the_acknowledgement_is_PER_PLOT_and_a_wholesale_one_is_still_accepted(
        defs_db, real_bars):
    """The verdict is per plot — the owner's ruling — so the ack must be able to
    be. A scalar ack means "the whole definition", which is the shape a single
    checkbox produces; a mapping means the author read each plot."""
    save(USER_A, defn(meta_extra={aus.REPAINT_ACK_KEY: True}),
         repaint={"value": "preview-repaints"})
    assert aus.admit_user_definition(USER_A, DEF_ID, bars=real_bars)["addresses"]

    aus.forget()
    save(USER_B, defn(meta_extra={aus.REPAINT_ACK_KEY: {"other": 1}}),
         repaint={"value": "preview-repaints"})
    with pytest.raises(aus.AdmissionRefused, match="has not been acknowledged"):
        aus.admit_user_definition(USER_B, DEF_ID, bars=real_bars)


# ═══ 4. THE BUDGET, AT THE VERSION BEING ARMED ═══════════════════════════════

def test_a_definition_over_its_budget_at_the_version_being_armed_is_refused(
        defs_db, real_bars):
    save(USER_A, defn(budget={"maxNodes": 1}))
    with pytest.raises(aus.AdmissionRefused,
                       match="is over its declared budget at the version being armed"
                       ) as caught:
        aus.admit_user_definition(USER_A, DEF_ID, bars=real_bars)
    assert caught.value.gate == "budget"
    assert aus.USER_FUNCS == {}


def test_the_budget_is_read_at_ARM_TIME_so_a_TIGHTENED_one_reaches_an_old_formula(
        defs_db, real_bars):
    """⭐ THE WHOLE REASON THE BUDGET IS CHECKED HERE AND NOT ONLY AT SAVE.

    `ast_budget`'s own docstring states it: *a definition registered under one
    budget and run under a later, smaller one computes forever at the old cost*.
    Version 1 admits; version 2 tightens the budget; arming now reads version 2.
    """
    save(USER_A, defn())
    assert aus.admit_user_definition(USER_A, DEF_ID, bars=real_bars)["version"] == 1
    aus.forget()

    save(USER_A, defn(budget={"maxNodes": 1}))
    with pytest.raises(aus.AdmissionRefused, match="over its declared budget") as caught:
        aus.admit_user_definition(USER_A, DEF_ID, bars=real_bars)
    assert caught.value.gate == "budget"

    # …and pinning the OLD version still admits, which is what makes the sentence
    # "at the version being armed" a measurement rather than a slogan.
    aus.forget()
    assert aus.admit_user_definition(USER_A, DEF_ID, 1, bars=real_bars)["version"] == 1


def test_a_table_refusal_is_NOT_relabelled_as_a_budget_refusal(defs_db, real_bars):
    """⛔ THE WRONG-DOOR DEFECT, GUARDED IN THE DIRECTION THIS MODULE COULD CAUSE.

    `check_budget` calls `node_count`/`max_lookback`, which refuse
    `resolve:function` for a name the table does not declare. That is the TABLE
    saying no, not the budget — and `ast_budget`'s header says so in its own
    words. It must propagate as a `TableRefusal`, not arrive wearing a budget
    label, or a formula calling a nonexistent function reads to its author as
    "too expensive".
    """
    from api.services.ast_interpret import TableRefusal
    tree = {"type": "call", "name": "not_a_function", "args": [
        {"type": "series", "name": "close"}]}
    # `save` runs the linter over the same tree, which refuses it first — so the
    # tree is offered straight to the gate, which is the door under test.
    with pytest.raises(TableRefusal):
        aus._gate_budget({"compute": {"kind": "ast", "ast": tree}}, DEF_ID)


# ═══ 5. AN ADDRESS HERE IS PER-USER — asserted in BOTH directions ════════════

def test_resolve_address_can_NEVER_reach_a_user_address_without_a_user_id(
        defs_db, real_bars):
    """Direction one: no user id, no column. Even after a real admission."""
    save(USER_A, defn())
    aus.admit_user_definition(USER_A, DEF_ID, bars=real_bars)

    assert ev.resolve_address(ADDRESS) == ADDRESS.lower()
    assert ev.value_function(ev.resolve_address(ADDRESS)) is None
    assert ev.value_function(ADDRESS) is None
    assert ev.address_value(ADDRESS, real_bars, {}) is None
    assert ADDRESS not in ev.all_addresses()
    # …and the registry holds nothing addressable by the bare address.
    assert ADDRESS not in aus.USER_FUNCS
    assert all(aus.SCOPE_SEP in k for k in aus.USER_FUNCS)


def test_WITH_a_user_id_the_same_address_resolves_to_a_real_number(
        defs_db, real_bars):
    """Direction two — the positive control. A "cannot reach" assertion is
    satisfied by an address that resolves for NOBODY."""
    save(USER_A, defn())
    aus.admit_user_definition(USER_A, DEF_ID, bars=real_bars)
    fn = aus.user_value_function(USER_A, ADDRESS)
    assert fn is not None
    value = fn(real_bars, {})
    closes = [b["c"] for b in real_bars]
    assert value == pytest.approx(sum(closes[-20:]) / 20)


def test_one_accounts_formula_cannot_answer_for_another(defs_db, real_bars):
    """⛔ THE PER-USER PROPERTY, AS A REFUSAL RATHER THAN A `None`.

    Account B asking for account A's address must not get a number and must not
    get silence either: silence is what an unknown builtin address produces, and
    a cross-account read is a different event.
    """
    save(USER_A, defn())
    aus.admit_user_definition(USER_A, DEF_ID, bars=real_bars)
    assert aus.scoped_key(USER_A, ADDRESS) != aus.scoped_key(USER_B, ADDRESS)

    with pytest.raises(aus.AdmissionRefused) as caught:
        aus.user_value_function(USER_B, ADDRESS)
    assert caught.value.gate == "definition"
    assert aus.user_value_function(USER_A, ADDRESS) is not None


def test_a_registry_MISS_rebuilds_from_the_store_rather_than_going_quiet(
        defs_db, real_bars):
    """⛔ THE REDEPLOY CASE, AND IT IS THE DEFECT THIS TASK IS SHAPED LIKE.

    `USER_FUNCS` is per-process. If it were the AUTHORITY on admission, every
    redeploy would silently un-admit every armed user alert — a user alert that
    stops firing for a reason nobody can see. So a miss REBUILDS rather than
    refusing: the four deterministic gates re-run and a value function comes back.

    ⚰️ AND IT USED TO REGISTER WHAT IT REBUILT — the line asserted here was
    `assert aus.USER_FUNCS, "the rebuild did not register anything"`, and that
    registration is what made the cross-lane proof forgeable. An entry in
    `USER_FUNCS` is read by the alert lane as "this tree was proven at 1e-9 in
    this process", and this path proves nothing (it has no bars to prove anything
    ON — it is reached by `GET /api/indicator-alerts/current-value`'s prefill
    with none in hand). So the rebuild still ANSWERS and no longer WRITES, and
    `alert_user_series.value_function_for_alert` — the seam that does hold the
    alert's bars — re-enters the whole admission chain instead. See
    `tests/test_user_definition_reproof.py`.
    """
    save(USER_A, defn())
    aus.admit_user_definition(USER_A, DEF_ID, bars=real_bars)
    assert aus.forget() == 1
    assert aus.USER_FUNCS == {}

    fn = aus.user_value_function(USER_A, ADDRESS)      # the "after a redeploy" read
    assert fn is not None and fn(real_bars, {}) is not None
    assert aus.USER_FUNCS == {}, (
        "the rebuild registered a value function it never proved cross-lane — "
        "the next evaluation cycle would read that entry as an admission")

    # …and the ALERT lane, which does hold bars, re-admits rather than borrowing:
    alert = {"id": 1, "user_id": USER_A, "sym": "TEST", "tf": "5",
             "indicator": ADDRESS, "condition": "above", "threshold": -1e9}
    assert aus.value_function_for_alert(alert, real_bars) is not None
    assert aus.USER_FUNCS, "the alert seam did not re-admit after a miss"


def test_a_rebuild_still_passes_through_the_repaint_gate(defs_db, real_bars):
    """…and the rebuild is not a back door. A definition re-badged `repaints`
    after it was admitted is refused on the next cold read, which is what makes
    the cache a cache rather than a grandfather clause."""
    save(USER_A, defn())
    aus.admit_user_definition(USER_A, DEF_ID, bars=real_bars)
    aus.forget()
    with sqlite3.connect(str(ud._DB_PATH)) as c:
        c.execute("UPDATE user_definitions SET repaint=?",
                  (json.dumps({"value": "repaints"}),))
    with pytest.raises(aus.AdmissionRefused, match="a repainting formula") as caught:
        aus.user_value_function(USER_A, ADDRESS)
    assert caught.value.gate == "repaint"


def test_a_definition_that_is_not_a_FORMULA_is_refused_at_its_own_gate(defs_db):
    """`compute.kind != 'ast'`. `user_definitions.save` refuses to STORE one, so
    the gate is driven directly — it exists for a row that predates that
    validation or arrives from another writer."""
    with pytest.raises(aus.AdmissionRefused,
                       match="is not a formula and cannot be admitted as one") as caught:
        aus._gate_lane({"def_id": DEF_ID,
                        "definition": {"compute": {"kind": "native", "fn": "rsi"}}})
    assert caught.value.gate == "lane"


# ═══ 6. ATTRIBUTION — WHICH gate refused, measured ═══════════════════════════

def _every_gate_message(real_bars, monkeypatch) -> dict:
    """Drive EVERY gate for real and collect the message each one produced.

    ⛔ DRIVEN, NEVER READ OFF THE TABLE. A disjointness rail that compared
    `REFUSAL_FRAGMENTS`' values to each other would prove the table is
    self-consistent and nothing about the strings the code actually raises —
    which is precisely how Phase C Task 9's two gates came to share a phrase
    while every test stayed green.
    """
    out: dict[str, str] = {}

    def capture(key, fn):
        # ⚠️ A GATE THAT DOES NOT REFUSE IS RECORDED AS ABSENT, NOT AS A FAILURE
        # HERE, AND THAT IS MEASURED. When this helper asserted the raise itself,
        # deleting the acknowledgement branch and making two gates share a phrase
        # BOTH died inside this function — so neither mutation had a killer the
        # other lacked, and the disjointness rail could not be told apart from
        # the totality rail. Absence is a fact the two callers judge differently.
        try:
            fn()
        except aus.AdmissionRefused as exc:
            out[key] = str(exc)

    save(USER_A, defn(def_id=DEF_ID))
    capture("definition",
            lambda: aus.admit_user_definition(USER_A, OTHER_DEF_ID, bars=real_bars))
    capture("lane", lambda: aus._gate_lane(
        {"def_id": DEF_ID, "definition": {"compute": {"kind": "server"}}}))
    capture("bars", lambda: aus.admit_user_definition(USER_A, DEF_ID, bars=[]))

    save(USER_B, defn(), repaint={"value": "repaints"})
    capture("repaint", lambda: aus.admit_user_definition(USER_B, DEF_ID, bars=real_bars))

    save("user-c", defn(), repaint={"value": "preview-repaints"})
    capture("repaint-ack",
            lambda: aus.admit_user_definition("user-c", DEF_ID, bars=real_bars))

    save("user-d", defn(budget={"maxNodes": 1}))
    capture("budget", lambda: aus.admit_user_definition("user-d", DEF_ID, bars=real_bars))

    with lane_disagreement(monkeypatch, at_bar=200, by=1e-6):
        capture("cross-lane",
                lambda: aus.admit_user_definition(USER_A, DEF_ID, bars=real_bars))
    return out


def test_every_admission_gate_is_REACHABLE_and_actually_refuses(
        defs_db, real_bars, monkeypatch):
    """TOTALITY. All seven branches are drivable, so the disjointness rail below
    is not a statement about the subset somebody remembered to reach.

    ⚠️ SPLIT FROM THE DISJOINTNESS RAIL DELIBERATELY, and the split is measured.
    Merged, deleting the acknowledgement branch and making two gates share a
    phrase both died on the SAME assertion, so neither mutation had a killer the
    other did not. Two tests, two properties, two mutations that can be told
    apart.
    """
    messages = _every_gate_message(real_bars, monkeypatch)
    assert sorted(messages) == sorted(
        list(aus.REFUSAL_FRAGMENTS) + ["repaint-ack"]), (
        f"a gate was not driven: {sorted(messages)}")
    for gate, message in messages.items():
        assert message.strip(), f"{gate} refused with an empty message"


def test_no_two_admission_refusals_SHARE_a_fragment(
        defs_db, real_bars, monkeypatch):
    """🔴 PHASE C TASK 9's M1, PRE-EMPTED.

    Two gates sharing a refusal phrase made `pytest.raises(match=…)` STILL MATCH
    with the mode lock DELETED — the test would have passed on a tree with the
    safety removed. Nineteenth vacuous gate on that branch, and only a mutation
    found it.

    ⚠️ IT CHECKS WHATEVER WAS ACTUALLY CAPTURED, with a floor, rather than
    demanding all seven. Demanding seven is the OTHER test's job, and coupling
    them made "a gate stopped refusing" and "two gates share a phrase" the same
    failure.
    """
    messages = _every_gate_message(real_bars, monkeypatch)
    assert len(messages) >= 6, (
        f"only {len(messages)} refusals were captured — too few for a "
        "disjointness claim to mean anything")

    fragments = dict(aus.REFUSAL_FRAGMENTS)
    fragments["repaint-ack"] = aus.PREVIEW_ACK_FRAGMENT
    for name, fragment in fragments.items():
        hits = sorted(k for k, m in messages.items() if fragment in m)
        if not hits:
            continue                     # that gate was not reachable; see above
        assert len(hits) == 1, (
            f"the fragment {fragment!r} appears in {len(hits)} refusal messages "
            f"({hits}) — a test matching on it would pass with the other gate's "
            "safety deleted")


def test_a_refused_user_alert_names_WHICH_gate_refused_it(
        defs_db, real_bars, monkeypatch):
    """⭐ THE ATTRIBUTION READ-OUT, THROUGH AN ALERT ROW.

    A surface holding an alert that never fires must be able to say why. Each
    case below differs from an ADMITTING one in exactly one respect, so the gate
    it names is the gate that refused it and not one further up.

    ⚠️ THE BARS ARE STUBBED, AND THAT IS A FIX, NOT SCAFFOLDING. `refusal_for_alert`
    ends at `arm_for_alert`, which calls `ev._fetch_bars_for_alert("SPY", "5")` —
    and with nothing stubbed that reads `bars_sqlite`'s default store, which on
    this box is the owner's LIVE `C:\\data\\bars.db`. The final assertion below
    ("the last save fixed every defect") was therefore passing because a
    production database happened to hold SPY 5-minute tape: isolate that store
    and the test goes red with `[gate:bars]`, on a tree where nothing about
    admission changed. Same stub the other nine alert suites already use.
    """
    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, limit=200: list(real_bars))
    alert = {"id": 1, "user_id": USER_A, "sym": "SPY", "tf": "5",
             "indicator": ADDRESS, "condition": "above", "threshold": 1.0}

    assert aus.refusal_for_alert(alert).gate == "definition"       # nothing stored

    save(USER_A, defn(), repaint={"value": "repaints"})
    assert aus.refusal_for_alert(alert).gate == "repaint"

    save(USER_A, defn(budget={"maxNodes": 1}), repaint={"value": "non-repainting"})
    assert aus.refusal_for_alert(alert).gate == "budget"

    save(USER_A, defn())
    assert aus.refusal_for_alert(alert) is None, (
        "the last save fixed every defect and it is still refused — the gate "
        "that answered is not the gate that was fixed")

    # …and a BUILTIN alert is never refused here, however broken it is.
    assert aus.refusal_for_alert(dict(alert, indicator="rsi")) is None
    assert aus.refusal_for_alert(dict(alert, indicator="not_an_indicator")) is None


def test_a_refused_user_alert_is_LOUD_in_the_evaluator_not_silent(
        defs_db, real_bars):
    """⛔ THE DEFECT THIS TASK IS SHAPED LIKE, ASSERTED AT THE EVALUATOR.

    A refused user alert must NOT be `(None, False)` — that is byte-identical to
    an admitted alert on a quiet market, and the phase's record calls that
    reading out five times. It raises, which `_run_one_cycle`'s per-alert handler
    logs and counts as an error: visible and attributable.
    """
    save(USER_A, defn(), repaint={"value": "repaints"})
    alert = {"id": 1, "user_id": USER_A, "sym": "SPY", "tf": "5",
             "indicator": ADDRESS, "condition": "above", "threshold": 1.0,
             "params_json": None, "last_value": None}
    with pytest.raises(aus.AdmissionRefused) as caught:
        ev._evaluate_one(alert, bars=real_bars, mode="forming")
    assert caught.value.gate == "repaint"
    with pytest.raises(aus.AdmissionRefused):
        ev._evaluate_one_closed(alert, bars=real_bars, now_epoch=1e12)

    # …and an UNKNOWN builtin address is still the silent no-fire it has always
    # been, so this is not a behaviour change for anything that existed before.
    assert ev._evaluate_one(dict(alert, indicator="nope"), bars=real_bars,
                            mode="forming") == (None, False)


def _fresh_parse(mod):
    """A FRESH parse of a module's file on disk.

    ⛔ NEVER `inspect.getsource(fn)` IN THIS TREE. It slices the file at the line
    numbers captured when the module was IMPORTED, and a co-worker inserting
    ~180 lines above the target hands back the wrong slice — measured for real on
    this branch, where it reported a call site missing that was right there.
    """
    import ast as _ast
    with open(mod.__file__, encoding="utf-8") as fh:
        return _ast.parse(fh.read())


def _calls_in(fn_node) -> set:
    import ast as _ast
    out = set()
    for n in _ast.walk(fn_node):
        if isinstance(n, _ast.Call):
            f = n.func
            out.add(f.attr if isinstance(f, _ast.Attribute)
                    else (f.id if isinstance(f, _ast.Name) else None))
    return out


def test_EVERY_value_resolution_site_consults_the_FOURTH_partition(defs_db):
    """⛔ THE ANTI-FORK RAIL FOR THE FOURTH TABLE, AND ITS SUBJECT SET IS DERIVED.

    ⚖️ A DECLARED DEVIATION FROM THE BRIEF, AND THE REASON IS THE PARTITION'S ONE
    DIFFERENCE. The brief asks that the rail Phase C Task 6 repaired — *"it
    survived because it iterated the same dict the bug was in"* — now iterate
    FOUR tables. `test_value_function_consults_every_partition` cannot: it
    asserts every partition is reachable FROM `value_function(address)`, and
    `USER_FUNCS` is deliberately NOT reachable from there, because a bare address
    with no user id must never resolve to one account's formula. Extending that
    rail to four would require making the very reach it exists to forbid.

    So the rail is rewritten at the level where the fork can actually happen. The
    defect Task 6 found was two resolution sites disagreeing about which tables
    to consult. Here the subject set is DERIVED — every function in the evaluator
    that resolves a value table at all — and each one must consult the user
    partition too. A THIRD resolution site added later lands red without anybody
    editing this list, which is the property a hand-written list of two does not
    have.

    🔴 AND THE DERIVATION FOUND A SITE THIS TEST'S AUTHOR HAD NOT LISTED, ON ITS
    FIRST RUN — which is the whole argument for deriving it. `address_value` and
    `_closed_address_value` also resolve a value table: they are the OPERAND
    resolvers, the right-hand side of "VWAP crossed above <address>". They take a
    bare ADDRESS and no user id, so they are the sites that must be UNABLE to
    reach the fourth partition, and demanding they consult it would create
    exactly the reach `resolve_address` is forbidden. So the rail splits the
    derived set MECHANICALLY, by whether the function is handed an alert ROW
    (which carries `user_id`) or a bare address, and asserts opposite things
    about each half.
    """
    import ast as _ast
    tree = _fresh_parse(ev)
    functions = [n for n in _ast.walk(tree) if isinstance(n, _ast.FunctionDef)]
    resolvers = {n.name: n for n in functions
                 if {"value_function", "series_function"} & _calls_in(n)}
    assert len(resolvers) >= 4, (
        f"the derivation found only {sorted(resolvers)} — a subject set this "
        "small is a rail that stopped reading the file")

    def first_arg(node) -> str:
        return node.args.args[0].arg if node.args.args else ""

    row_sites = {n for n, node in resolvers.items() if first_arg(node) == "alert"}
    address_sites = {n for n, node in resolvers.items() if first_arg(node) == "address"}
    assert row_sites | address_sites == set(resolvers), (
        f"a resolver takes neither an alert row nor an address: "
        f"{sorted(set(resolvers) - row_sites - address_sites)}")
    assert row_sites and address_sites, "the split collapsed to one side"

    # HALF ONE — a site holding a row holds a `user_id`, so it MUST consult the
    # fourth partition or a user alert evaluates on one lane and is silent on the
    # other, which is exactly the fork Task 6 measured.
    missing = sorted(n for n in row_sites
                     if "_user_value_function" not in _calls_in(resolvers[n]))
    assert missing == [], f"{missing} hold an alert row and never ask the user lane"

    # HALF TWO — a site holding only an ADDRESS must NOT be able to reach it.
    # This is `resolve_address must never reach a user address without a user
    # id`, asserted at the code rather than only at the behaviour.
    reaching = sorted(n for n in address_sites
                      if "_user_value_function" in _calls_in(resolvers[n]))
    assert reaching == [], (
        f"{reaching} take a bare address and reach the per-user partition — one "
        "account's formula could answer for another")

    # ⛔ THE POSITIVE CONTROL ON THE SCAN ITSELF. Without it a scan that found
    # NOTHING would report every site as compliant.
    assert "resolve_address" in _calls_in(resolvers["_evaluate_one"])
    # …and the NEGATIVE control: a function that does not resolve is not in the
    # subject set, so the derivation is a filter and not "every function".
    assert "ledger_timeframe" not in resolvers


def test_BOTH_LANES_resolve_the_SAME_user_definition_to_the_SAME_number(
        defs_db, real_bars):
    """The behavioural half of the rail above.

    Task 6's fork was invisible to every structural check and showed up as one
    lane firing 39 times while the other read `None`. So the two lanes are driven
    over the same user formula on the same bars and required to agree on the
    newest CLOSED bar — the only bar both lanes can be asked about.
    """
    save(USER_A, defn(ast_tree=_ast_sma(5)))
    aus.admit_user_definition(USER_A, DEF_ID, bars=real_bars)
    alert = {"id": 1, "user_id": USER_A, "sym": "SPY", "tf": "5",
             "indicator": ADDRESS, "condition": "above", "threshold": -1e9,
             "params_json": None, "last_value": None}

    forming_value, forming_fired = ev._evaluate_one(alert, bars=real_bars,
                                                    mode="forming")
    closed_value, closed_fired, idx = ev._evaluate_one_closed(
        alert, bars=real_bars, now_epoch=float(real_bars[-1]["t"]) + 86_400.0)

    assert forming_value is not None and closed_value is not None, (
        "a lane produced no number — the comparison would be vacuous")
    assert forming_fired is closed_fired is True
    assert idx == len(real_bars) - 1
    assert closed_value == pytest.approx(forming_value, rel=1e-12)

    column = aus.user_value_function(USER_A, ADDRESS).column(real_bars, {})
    assert len(column) == len(real_bars), "the column is not aligned to its bars"
    assert column[idx] == pytest.approx(closed_value)


def test_the_gates_are_a_CLOSED_set_and_an_unattributable_refusal_is_impossible(
        defs_db):
    """A refusal whose gate is not declared cannot be constructed at all."""
    with pytest.raises(AssertionError, match="is not one of this module's declared gates"):
        aus.AdmissionRefused("not-a-gate", "x")
    assert set(aus.REFUSAL_FRAGMENTS) == set(aus.GATES)


# ═══ 7. THROUGH THE REAL CYCLE — delivered once, ledger zero ═════════════════

def test_a_user_alert_delivers_ONCE_and_never_reaches_the_ledger(
        defs_db, alerts_db, ledger_db, channels, monkeypatch):
    """⭐ THE WHOLE TASK, AS TWO NUMBERS MEASURED THROUGH THE REAL CYCLE.

    Phase C Task 11's shape, verbatim: the spy sits at the TRANSPORT
    (`deliver_alert_payload` -> `add_alert`), DOWNSTREAM of the fire-once gate,
    and `_run_one_cycle` is driven for real. Twelve cycles on which the formula
    is genuinely and continuously above its threshold — asserted, not assumed —
    produce twelve evaluator asks and exactly ONE member notification.
    """
    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=200: [dict(b) for b in RISING])
    save(USER_A, defn(ast_tree=_ast_sma(5)))

    alert_id = ias.create(user_id=USER_A, sym="TEST", indicator=ADDRESS,
                          condition="above", threshold=120.0, tf="5")
    row = ias.get(alert_id)
    assert row["def_source"] == ias.DEF_SOURCE_USER, (
        "the row does not record that a user authored its arithmetic")

    for _ in range(12):
        ev._run_one_cycle()

    # ⚠️ NON-VACUITY: the condition is STILL true after all twelve cycles.
    value, triggered = ev._evaluate_one(ias.get(alert_id), bars=RISING)
    assert triggered is True and value is not None, (
        "the condition stopped being true — 'delivered once' would mean nothing")

    assert len(channels["invoked"]) == 12, (
        f"the evaluator asked {len(channels['invoked'])} times, not 12")
    assert len(channels["delivered"]) == 1, (
        f"the member was told {len(channels['delivered'])} times across 12 "
        "consecutive true cycles")
    assert _ledger_rows(ledger_db) == 0, "a user-authored fire reached the ledger"


def test_the_user_alerts_fire_key_is_BYTE_IDENTICAL_to_a_builtin_alerts(
        defs_db, alerts_db, channels, monkeypatch):
    """⛔ `UNIQUE(alert_id, fire_key)` IS FIRE-ONCE, AND A NEW SOURCE MUST NOT
    BREAK THE KEY. A level condition keys on its armed EPISODE; nothing about who
    authored the arithmetic changes which episode a fire belongs to.
    """
    from api.services import alert_fired_log as fl
    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=200: [dict(b) for b in RISING])
    save(USER_A, defn(ast_tree=_ast_sma(5)))

    user_id_alert = ias.create(user_id=USER_A, sym="TEST", indicator=ADDRESS,
                               condition="above", threshold=120.0, tf="5")
    builtin_id = ias.create(user_id=USER_A, sym="TEST", indicator="rsi",
                            condition="above", threshold=10.0, tf="5")
    ev._run_one_cycle()

    keys = {aid: [f["fire_key"] for f in fl.fires_for_alert(aid, 10)]
            for aid in (user_id_alert, builtin_id)}
    assert keys[user_id_alert] == keys[builtin_id] == ["ep:0"], keys


# ═══ 8. `def_source` — the column, and the 31 live soak rows ═════════════════

def test_every_row_that_existed_before_this_column_reads_BUILTIN(alerts_db):
    """⛔ NULL MEANS WHAT THE ROW ALREADY MEANT.

    Production carries 31 armed soak rows. A NOT NULL column with a `'builtin'`
    default would have rewritten all 31 to say what they already say, on the
    table Task 8's cutover gate is watching. This drives the migration against a
    row inserted with NO knowledge of the column, exactly as those 31 were.
    """
    with sqlite3.connect(str(alerts_db)) as c:
        c.execute(
            "INSERT INTO indicator_alerts (user_id, sym, indicator, condition, "
            "threshold, tf, active, trigger_count, created_at) "
            "VALUES ('legacy','SPY','rsi','above',70.0,'5',1,0,1700000000)")
        aid = c.execute("SELECT id FROM indicator_alerts").fetchone()[0]
        stored = c.execute("SELECT def_source FROM indicator_alerts").fetchone()[0]
    assert stored is None, "the migration backfilled a value into an existing row"
    assert ias.get(aid)["def_source"] == ias.DEF_SOURCE_BUILTIN
    assert ias.list_active()[0]["def_source"] == ias.DEF_SOURCE_BUILTIN


def test_the_soak_rows_stay_NON_DELIVERABLE_and_VISIBLE_to_list_active(
        alerts_db, monkeypatch):
    """⛔ THE TWO PROPERTIES PRODUCTION DEPENDS ON, THROUGH THE REAL SOAK CODE.

    31 rows are armed on production and snoozed with a 30-day muzzle. This column
    must not make one deliverable, and must not hide one from `list_active()` —
    the shadow lane reads that function, and blinding it makes Monday's cutover
    gate vacuous, which is [[lesson_gate_that_cannot_fail]] in the one place this
    work cannot afford it.

    ⚠️ DRIVEN THROUGH `alert_soak_matrix.verify()` ITSELF, not through a
    re-implementation of what it checks.
    """
    import alert_soak_matrix as soak
    # `soak.arm` writes through `ias.db_path()`, which reads `ias._DB_PATH` — the
    # fixture has already pointed that at a private file, so this is the REAL
    # soak code against a real store and not a re-implementation of it.
    armed = soak.arm(user_id="owner", sym="SPY", tf="5", snooze_days=30)
    report = soak.verify()
    assert report["armed"] == report["visible_to_shadow"] > 0
    assert report["deliverable_now"] == 0, report
    assert report["missing"] == []
    assert {r["def_source"] for r in ias.list_active()} == {ias.DEF_SOURCE_BUILTIN}, (
        "a soak row was labelled user-authored")
    assert armed


def test_list_active_does_NOT_filter_on_def_source(alerts_db, defs_db, monkeypatch):
    """The rail `scope` already carries, for the identical reason: what FIRES is
    decided by `list_active()`, and a provenance filter there would silently
    shrink what the shadow lane observes."""
    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=200: [dict(b) for b in RISING])
    save(USER_A, defn(ast_tree=_ast_sma(5)))
    ias.create(user_id=USER_A, sym="TEST", indicator="rsi", condition="above",
               threshold=70.0, tf="5")
    ias.create(user_id=USER_A, sym="TEST", indicator=ADDRESS, condition="above",
               threshold=1.0, tf="5")
    sources = sorted(r["def_source"] for r in ias.list_active())
    assert sources == [ias.DEF_SOURCE_BUILTIN, ias.DEF_SOURCE_USER], sources

    import ast as _ast
    with open(ias.__file__, encoding="utf-8") as fh:
        tree = _ast.parse(fh.read())
    fn = next(n for n in _ast.walk(tree)
              if isinstance(n, _ast.FunctionDef) and n.name == "list_active")
    sql = " ".join(n.value for n in _ast.walk(fn) if isinstance(n, _ast.Constant)
                   and isinstance(n.value, str))
    assert "def_source" not in sql.replace(", def_source", ""), (
        "list_active mentions def_source outside its column list")


def test_the_BUILTIN_create_path_is_unchanged_by_the_arm_time_gate(
        alerts_db, monkeypatch):
    """⛔ THE NON-MEASUREMENT ASSERTION FOR EVERY ALERT THAT ALREADY EXISTS.

    `arm_for_alert` returns `None` for a builtin address BEFORE it fetches a
    single bar, so creating a builtin alert must not reach the store, node, or
    the definitions database at all. Measured by making all three explode.
    """
    def explode(*a, **k):                       # noqa: ANN001
        raise AssertionError("the builtin create path reached the user lane")

    monkeypatch.setattr(aus, "admit_user_definition", explode)
    monkeypatch.setattr(ev, "_fetch_bars_for_alert", explode)
    aid = ias.create(user_id="u1", sym="SPY", indicator="rsi", condition="above",
                     threshold=70.0, tf="5")
    row = ias.get(aid)
    assert row["def_source"] == ias.DEF_SOURCE_BUILTIN
    with sqlite3.connect(str(alerts_db)) as c:
        assert c.execute("SELECT def_source FROM indicator_alerts "
                         "WHERE id=?", (aid,)).fetchone()[0] is None


def test_a_REFUSED_user_formula_arms_NOTHING(defs_db, alerts_db, monkeypatch):
    """⛔ THE REFUSAL IS BEFORE THE INSERT, NOT AFTER IT.

    A row that landed and is then refused every cycle is an alert the user
    believes is watching — the exact silence the create-path validation exists to
    end, reached one step later. Nothing is armed, so nothing can go quiet.
    """
    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=200: [dict(b) for b in RISING])
    save(USER_A, defn(ast_tree=_ast_sma(5)), repaint={"value": "repaints"})
    with pytest.raises(aus.AdmissionRefused, match="a repainting formula") as caught:
        ias.create(user_id=USER_A, sym="TEST", indicator=ADDRESS,
                   condition="above", threshold=1.0, tf="5")
    assert caught.value.gate == "repaint"
    assert ias.list_active() == []
    with sqlite3.connect(str(alerts_db)) as c:
        assert c.execute("SELECT COUNT(*) FROM indicator_alerts").fetchone()[0] == 0


def test_the_arm_path_really_runs_the_cross_lane_equality(
        defs_db, alerts_db, monkeypatch):
    """⛔ THE MANDATED MUTATION HAS A SHIPPED CALL SITE, AND THIS IS THE PROOF.

    "Drop the arm-time cross-lane check" must be a mutation to shipped behaviour,
    not to a helper only tests call. `ias.create` — the function the router posts
    to — is driven, and the lanes are made to disagree.
    """
    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=200: [dict(b) for b in RISING])
    save(USER_A, defn(ast_tree=_ast_sma(5)))
    with lane_disagreement(monkeypatch, at_bar=70, by=1e-6):
        with pytest.raises(aus.AdmissionRefused,
                           match="the two lanes disagree at bar 70") as caught:
            ias.create(user_id=USER_A, sym="TEST", indicator=ADDRESS,
                       condition="above", threshold=1.0, tf="5")
    assert caught.value.gate == "cross-lane"
    assert ias.list_active() == []
