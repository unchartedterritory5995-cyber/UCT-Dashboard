"""THE RE-LINT PASS, AND THE ASYMMETRY THAT IS ITS WHOLE POINT.

⭐ THE ONE THING THIS FILE EXISTS TO PROVE: the two drift directions get
DIFFERENT treatment, and each is proven by the door that actually decides.

  * **Direction A** — the stored badge is STRICTER than the linter now is. The
    definition is permanently un-armable for a claim the engine has withdrawn.
    Healed automatically. Proven by driving `alert_user_series` itself: refused
    BEFORE the pass, admitted AFTER, with the real refusal text.
  * **Direction B** — the stored badge is LOOSER than the linter now is. An
    alert may be armed right now under a claim that is no longer true. NEVER
    flipped. Proven byte-for-byte on the stored column, with the armed alert's
    id named — **and with a direction-A definition healed in the SAME RUN**, so
    "nothing was flipped" cannot be satisfied by a pass that did nothing
    (`lesson_mutation_harness_needs_a_control`).

⛔ A SINGLE TEST THAT ONLY EXERCISED DIRECTION A WOULD LEAVE THE DANGEROUS HALF
UNRAILED, which is how this class of defect arrives.

⚠️ EVERY DB PATH IS PINNED AT THE MODULE ATTRIBUTE, NOT ONLY AT THE ENV VAR.
`C:\\data` is REAL on this box and six product modules capture `AUTH_DB_PATH` at
IMPORT, so a `monkeypatch.setenv` after the import reaches nothing. The `store`
fixture below mirrors `tests/test_user_definitions.py::store` for that reason.
"""
from __future__ import annotations

import ast
import json
import pathlib
import re
import sqlite3

import pytest

from api.services import alert_user_series as aus
from api.services import ast_lint
from api.services import indicator_alert_service as ias
from api.services import user_definition_relint as rl
from api.services import user_definitions as svc

ROOT = pathlib.Path(__file__).resolve().parents[1]
TABLE = ROOT / "app" / "src" / "components" / "chart" / "engine" / "ast" / "closedTable.json"

USER = "u1"

# ─── trees whose verdicts are MEASURED, not assumed ──────────────────────────
#
# Each of the three modes is reachable, and the tests below assert the verdict
# they depend on rather than trusting these names — a tree that stopped linting
# the way this file assumes would otherwise make a rail pass for the wrong reason.

SMA = {"type": "call", "name": "sma",
       "args": [{"type": "series", "name": "close"}, {"type": "num", "value": 20}]}

#: A call the closed table does not hold. The linter is FAIL-CLOSED, so this is
#: `repaints` — and `assert_canonical` still accepts it, so the store will keep it.
UNREADABLE = {"type": "call", "name": "notafunctioninthetable",
              "args": [{"type": "series", "name": "close"}]}

#: The one shipped function that declares a FORWARD reach: `preview-repaints`.
CHIKOU = {"type": "call", "name": "ichimokuChikou", "args": [
    {"type": "series", "name": "high"}, {"type": "series", "name": "low"},
    {"type": "series", "name": "close"}, {"type": "num", "value": 9},
    {"type": "num", "value": 26}, {"type": "num", "value": 52}]}


def defn(def_id: str, tree=None, *, trees=None, plots=("value",), name="X") -> dict:
    d = {
        "schemaVersion": 1, "id": def_id, "version": 1,
        "meta": {"name": name, "shortName": "X"},
        "compute": {"kind": "ast", "ast": tree if tree is not None else SMA},
        "placement": {"target": "lower"},
        "plots": [{"key": k, "style": "line", "role": "primary"} for k in plots],
        "inputs": [],
    }
    if trees:
        d["compute"]["trees"] = trees
    return d


@pytest.fixture
def store(tmp_path, monkeypatch):
    """The definition store AND the alert store, both off the shared root."""
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    aus.forget()
    return tmp_path


def _force_stored(def_id: str, verdicts: dict, version: int = 1) -> None:
    """Put the badge an EARLIER linter would have stored onto a live row.

    ⛔ THE ONLY WAY TO STAND UP THIS FIXTURE HONESTLY. The defect is a row
    written by a linter that no longer exists; there is no code path that writes
    one today, and `save()` recomputes. So the row is placed directly, which is
    exactly the state a pre-`b66d4d1f8` save left behind.
    """
    con = sqlite3.connect(svc._DB_PATH)
    try:
        con.execute("UPDATE user_definitions SET repaint=? WHERE def_id=? AND version=?",
                    (json.dumps(verdicts, sort_keys=True, separators=(",", ":")),
                     def_id, version))
        con.commit()
    finally:
        con.close()


def _arm_a_past_alert(user_id: str, address: str) -> int:
    """An alert armed BEFORE the linter changed, i.e. a row already in the table.

    ⛔ NOT VIA `ias.create`. That path calls `arm_for_alert`, which re-runs every
    gate against TODAY'S stored badge and spawns a node process for the 1e-9
    equality. The state being reproduced is an alert admitted under a claim that
    was true THEN — a row that already exists. Writing it through this module's
    own connection is the honest reproduction; going through `create` would test
    the create path, which is not what drifted.
    """
    with ias._conn() as db:
        cur = db.execute(
            "INSERT INTO indicator_alerts "
            "(user_id, sym, indicator, condition, threshold, tf, active, "
            " trigger_count, created_at) VALUES (?,?,?,?,?,?,1,0,0)",
            (user_id, "SPY", address, "above", 1.0, "D"))
        return int(cur.lastrowid)


def _repaint_column(def_id: str, version: int) -> str:
    con = sqlite3.connect(svc._DB_PATH)
    try:
        row = con.execute(
            "SELECT repaint FROM user_definitions WHERE def_id=? AND version=?",
            (def_id, version)).fetchone()
    finally:
        con.close()
    return row[0]


# ═══ DIRECTION A — the safe half ═════════════════════════════════════════════

def test_DIRECTION_A_a_stale_STRICTER_badge_is_healed_and_the_formula_ARMS_AGAIN(store):
    """🔴 THE HARM, THEN ITS ABSENCE, THROUGH THE REAL ADMISSION DOOR.

    `adx` was branded `repaints` in production by a lookback grammar retired in
    `b66d4d1f8` / `9e932591b`. Every definition saved before that fix still
    carries that badge, `_gate_repaint` refuses `repaints` outright, and the
    store's byte-identical-re-save guard means a user cannot even re-save their
    way out of it. The definition is permanently un-armable.

    ⭐ THE ASSERTION IS NOT "THE COLUMN CHANGED". It is that the member can arm
    the formula afterwards and could not before — measured by calling
    `alert_user_series` itself, so the rail cannot pass because some *other*
    door happens to allow it (`refused by a different door` is this branch's
    most repeated false positive).
    """
    def_id, address = "u_0000000000ad", "u_0000000000ad.value"
    adx = {"type": "call", "name": "adx", "args": [
        {"type": "series", "name": "high"}, {"type": "series", "name": "low"},
        {"type": "series", "name": "close"}, {"type": "num", "value": 14}]}
    document = defn(def_id, adx, name="ADX")
    svc.save(USER, def_id, document)

    # The premise, measured rather than assumed: TODAY'S linter calls it clean.
    assert svc.lint_verdict(document) == {"value": "non-repainting"}
    _force_stored(def_id, {"value": "repaints"})

    with pytest.raises(aus.AdmissionRefused) as before:
        aus.user_value_function(USER, address)
    assert before.value.gate == "repaint"
    assert "repaints" in str(before.value)

    report = rl.relint()

    assert report["healed_count"] == 1
    healed = report["healed"][0]
    assert (healed["def_id"], healed["plot_key"]) == (def_id, "value")
    assert (healed["stored"], healed["current"]) == ("repaints", "non-repainting")
    assert healed["verdict"] == rl.STORED_STRICTER
    # Nothing was armed under the stricter claim, so there is nobody to notify.
    assert healed["armed_alert_ids"] == []
    assert report["needs_decision"] == []

    # 🟢 The harm is gone, through the door that refused a moment ago.
    aus.forget()
    assert aus.user_value_function(USER, address) is not None

    # And the change is AUDITABLE rather than silent.
    log = rl.heal_log(USER, def_id)
    assert [(e["plot_key"], e["old_mode"], e["new_mode"]) for e in log] == \
        [("value", "repaints", "non-repainting")]


def test_a_STRICTER_drift_that_stops_short_of_clean_is_still_healed(store):
    """`repaints` -> `preview-repaints` is direction A too, and the gate says so.

    ⚠️ THE DIRECTION IS NOT "DID IT REACH `non-repainting`". It is "is the stored
    badge harder to arm than the measurement". `preview-repaints` still needs an
    acknowledgement to arm — the gate keeps enforcing that — but it is strictly
    freer than `repaints`, and no alert was ever admitted under the stricter one.
    """
    def_id = "u_0000000000c1"
    document = defn(def_id, CHIKOU)
    svc.save(USER, def_id, document)
    assert svc.lint_verdict(document) == {"value": "preview-repaints"}
    _force_stored(def_id, {"value": "repaints"})

    report = rl.relint()
    assert [f["verdict"] for f in report["healed"]] == [rl.STORED_STRICTER]
    assert json.loads(_repaint_column(def_id, 1)) == {"value": "preview-repaints"}

    # ⭐ AND THE GATE STILL REFUSES IT WITHOUT AN ACK — the heal moved the badge,
    # it did not admit anything. A heal that had also waived the acknowledgement
    # would be the silent re-badge this module exists to refuse.
    with pytest.raises(aus.AdmissionRefused) as exc:
        aus.user_value_function(USER, f"{def_id}.value")
    assert exc.value.gate == "repaint"
    assert "preview-repaints" in str(exc.value)


# ═══ DIRECTION B — the dangerous half ════════════════════════════════════════

def test_DIRECTION_B_a_LOOSER_badge_is_NEVER_flipped_and_the_ARMED_alert_is_NAMED(store):
    """⛔ THE HALF THAT MUST NOT BE BOOKKEEPING.

    The stored badge says `non-repainting`; the linter now says `repaints`. An
    alert is armed on it right now, admitted under the old claim. Flipping the
    column would RETROACTIVELY change what that alert was admitted under — the
    moving target the store's docstring names by that word.

    ⭐ THE CONTROL IS THE LOAD-BEARING HALF. A second definition drifting the
    SAFE way is swept in the SAME `relint()` call and IS healed, so "direction B
    was not flipped" cannot be satisfied by a pass that healed nothing.
    """
    danger, safe = "u_0000000000b1", "u_0000000000a1"
    svc.save(USER, danger, defn(danger, UNREADABLE))
    svc.save(USER, safe, defn(safe, SMA))
    assert svc.lint_verdict(defn(danger, UNREADABLE)) == {"value": "repaints"}
    assert svc.lint_verdict(defn(safe, SMA)) == {"value": "non-repainting"}

    _force_stored(danger, {"value": "non-repainting"})   # armed under this claim
    _force_stored(safe, {"value": "repaints"})           # the control
    alert_id = _arm_a_past_alert(USER, f"{danger}.value")
    before = _repaint_column(danger, 1)

    report = rl.relint()

    # THE CONTROL FIRED: the pass was not inert.
    assert [f["def_id"] for f in report["healed"]] == [safe]

    # THE DANGEROUS ROW IS BYTE-IDENTICAL.
    assert _repaint_column(danger, 1) == before
    assert json.loads(before) == {"value": "non-repainting"}
    assert [e["def_id"] for e in rl.heal_log()] == [safe]

    # AND IT IS REPORTED, WITH THE ARMED ALERT NAMED.
    flagged = [f for f in report["needs_decision"] if f["verdict"] == rl.STORED_LOOSER]
    assert len(flagged) == 1
    assert flagged[0]["def_id"] == danger
    assert flagged[0]["plot_key"] == "value"
    assert (flagged[0]["stored"], flagged[0]["current"]) == ("non-repainting", "repaints")
    assert flagged[0]["armed_alert_ids"] == [alert_id]
    assert report["armed_alerts_affected"] == [alert_id]

    text = rl.format_report(report)
    assert text.startswith("NEEDS A DECISION")
    assert f"{danger}.value" in text and f"active alert ids [{alert_id}]" in text


def test_an_INACTIVE_alert_is_a_FOOTNOTE_not_a_notification(store):
    """Armed and merely saved are different facts, and the report says which.

    ⚠️ `active`, NOT `is_active` — `indicator_alert_service` carries a comment
    about a prod probe that read this table as empty against the wrong column
    and reached the right answer for the wrong reason. The pass calls
    `list_active()` rather than re-spelling the filter, and this rail watches an
    alert LEAVE the answer when it is switched off.
    """
    def_id = "u_0000000000b2"
    svc.save(USER, def_id, defn(def_id, UNREADABLE))
    _force_stored(def_id, {"value": "non-repainting"})
    alert_id = _arm_a_past_alert(USER, f"{def_id}.value")

    assert rl.relint()["armed_alerts_affected"] == [alert_id]

    ias.set_active(alert_id, False)
    report = rl.relint()
    flagged = [f for f in report["needs_decision"] if f["verdict"] == rl.STORED_LOOSER]
    assert len(flagged) == 1 and flagged[0]["armed_alert_ids"] == []
    assert report["armed_alerts_affected"] == []
    assert "a footnote, not a notification" in rl.format_report(report)


def test_an_alert_belonging_to_ANOTHER_member_is_not_counted(store):
    """The index is keyed on (user, address), because the store is."""
    def_id = "u_0000000000b3"
    svc.save(USER, def_id, defn(def_id, UNREADABLE))
    _force_stored(def_id, {"value": "non-repainting"})
    _arm_a_past_alert("someone-else", f"{def_id}.value")

    report = rl.relint()
    flagged = [f for f in report["needs_decision"] if f["verdict"] == rl.STORED_LOOSER]
    assert len(flagged) == 1 and flagged[0]["armed_alert_ids"] == []


# ═══ PER PLOT, NEVER PER DEFINITION ══════════════════════════════════════════

def test_ONE_definition_can_drift_BOTH_WAYS_and_each_PLOT_gets_its_own_treatment(store):
    """⭐ WHY THE COMPARISON IS PER PLOT.

    One document, two plots, two trees, two opposite drifts. A whole-definition
    comparison would report a single "they differ" and could only pick one
    treatment for both — which means either a dangerous plot healed silently, or
    a safe plot left un-armable. This is the case that makes the granularity
    load-bearing rather than tidy.
    """
    def_id = "u_0000000000d1"
    document = defn(def_id, SMA, trees={"a": SMA, "b": CHIKOU}, plots=("a", "b"))
    svc.save(USER, def_id, document)
    assert svc.lint_verdict(document) == {"a": "non-repainting", "b": "preview-repaints"}

    # plot a: stored STRICTER (heal) · plot b: stored LOOSER (never flip)
    _force_stored(def_id, {"a": "repaints", "b": "non-repainting"})
    report = rl.relint()

    assert [(f["plot_key"], f["stored"], f["current"]) for f in report["healed"]] == \
        [("a", "repaints", "non-repainting")]
    flagged = [f for f in report["needs_decision"] if f["verdict"] == rl.STORED_LOOSER]
    assert [(f["plot_key"], f["stored"], f["current"]) for f in flagged] == \
        [("b", "non-repainting", "preview-repaints")]

    # The two plots ended in different states inside ONE stored column.
    assert json.loads(_repaint_column(def_id, 1)) == \
        {"a": "non-repainting", "b": "non-repainting"}


# ═══ IDEMPOTENCE ═════════════════════════════════════════════════════════════

def test_running_the_pass_TWICE_WRITES_NOTHING_THE_SECOND_TIME(store):
    """A heal that keeps healing is a heal that is not converging.

    Measured on the ARTIFACTS: the stored column, the audit log, and the file's
    own row count. Direction B keeps being REPORTED both times, which is not a
    change — a report that stopped naming an outstanding safety question would
    be the worse failure, so it is asserted identical rather than absent.
    """
    safe, danger = "u_0000000000e1", "u_0000000000e2"
    svc.save(USER, safe, defn(safe, SMA))
    svc.save(USER, danger, defn(danger, UNREADABLE))
    _force_stored(safe, {"value": "repaints"})
    _force_stored(danger, {"value": "non-repainting"})

    first = rl.relint()
    after_first = (_repaint_column(safe, 1), _repaint_column(danger, 1))
    log_first = rl.heal_log()
    rows_first = _all_rows()
    assert first["healed_count"] == 1 and len(log_first) == 1

    second = rl.relint()

    assert second["healed"] == []
    assert second["healed_count"] == 0
    assert (_repaint_column(safe, 1), _repaint_column(danger, 1)) == after_first
    assert rl.heal_log() == log_first
    assert _all_rows() == rows_first
    # The safe plot now AGREES; the dangerous one is reported again, unchanged.
    assert second["agreed"] == 1
    assert [(f["def_id"], f["stored"], f["current"]) for f in second["needs_decision"]] \
        == [(f["def_id"], f["stored"], f["current"]) for f in first["needs_decision"]]


def _all_rows() -> list:
    con = sqlite3.connect(svc._DB_PATH)
    try:
        return con.execute(
            "SELECT user_id, def_id, version, rev, ast_hash, definition, repaint, "
            "deleted_at, created_at FROM user_definitions ORDER BY id").fetchall()
    finally:
        con.close()


# ═══ CURRENT VERSION ONLY ════════════════════════════════════════════════════

def test_the_pass_heals_the_CURRENT_version_and_leaves_HISTORY_BYTE_IDENTICAL(store):
    """⭐ THE VERSION RULING, MEASURED.

    Every admission path reaches the store at version `None` — `arm_for_alert`
    (first-arm AND re-arm) and `user_value_function` both pass it — so healing
    the newest live row is exactly sufficient. Healing history would rewrite what
    a receipt claimed at the time, on precisely the rows a `defId@version` pin
    points at, under a store whose contract is that such a row cannot change
    under its holder.
    """
    def_id = "u_0000000000f1"
    svc.save(USER, def_id, defn(def_id, SMA, name="v1"))
    svc.save(USER, def_id, defn(def_id, SMA, name="v2"))
    _force_stored(def_id, {"value": "repaints"}, version=1)
    _force_stored(def_id, {"value": "repaints"}, version=2)
    v1_before = _repaint_column(def_id, 1)

    report = rl.relint()

    assert [f["version"] for f in report["healed"]] == [2]
    assert json.loads(_repaint_column(def_id, 2)) == {"value": "non-repainting"}
    assert _repaint_column(def_id, 1) == v1_before          # history untouched
    assert json.loads(v1_before) == {"value": "repaints"}
    assert [e["version"] for e in rl.heal_log()] == [2]


def test_a_TOMBSTONED_definition_is_not_swept_at_all(store):
    """`live_definitions()` owns "which row is live", and the pass asks it.

    A background job with its own copy of that subquery would be a second
    authority, and the day a tombstone rule changed it would go on sweeping
    deleted formulas with every test green — `live_definitions`' own docstring
    says exactly this.
    """
    def_id = "u_0000000000f2"
    svc.save(USER, def_id, defn(def_id, SMA))
    _force_stored(def_id, {"value": "repaints"})
    assert svc.soft_delete(USER, def_id) is True

    report = rl.relint()
    assert report["definitions_read"] == 0
    assert report["healed"] == [] and report["needs_decision"] == []
    assert json.loads(_repaint_column(def_id, 1)) == {"value": "repaints"}


# ═══ THE ORDERING IS THE GATE'S OWN ══════════════════════════════════════════

def test_the_direction_scale_IS_the_admission_gates_and_covers_the_WHOLE_vocabulary():
    """⛔ ANTI-ROT ON THE ONE THING EVERY DIRECTION DECISION RESTS ON.

    The scale is not typed in `user_definition_relint`; it is read off
    `_gate_repaint` by driving it. This rail re-derives it INDEPENDENTLY here
    (bare vs acknowledged, on the real gate) and asserts the two agree — so a
    change to the door moves both sides or fails.

    And it must cover EXACTLY `ast_lint.REPAINT_MODES`: a FOURTH badge value
    added to the vocabulary FAILS here until somebody decides which direction it
    is, rather than being silently sorted into one.
    """
    def independently(mode: str) -> int:
        row = {"def_id": "u_000000000000", "repaint": {"k": mode}}

        def admits(definition):
            try:
                aus._gate_repaint(row, definition)
                return True
            except aus.AdmissionRefused:
                return False

        if admits({}):
            return 0
        return 1 if admits({"meta": {aus.REPAINT_ACK_KEY: {"k": True}}}) else 2

    scale = rl.ranks()
    assert set(scale) == set(ast_lint.REPAINT_MODES), (
        "the pass's scale and the linter's vocabulary have diverged — a mode "
        "with no measured direction must not be sorted into one")
    assert scale == {m: independently(m) for m in ast_lint.REPAINT_MODES}
    # The scale must actually SEPARATE the modes, or "stricter" means nothing.
    assert len(set(scale.values())) == len(scale), scale
    assert scale["non-repainting"] < scale["repaints"]


def test_a_badge_outside_the_vocabulary_is_REPORTED_and_NEVER_healed(store):
    """Fail-closed. An unplaceable mode is a fact to surface, not to guess at."""
    def_id = "u_0000000000f3"
    svc.save(USER, def_id, defn(def_id, SMA))
    _force_stored(def_id, {"value": "sort-of-repaints"})
    before = _repaint_column(def_id, 1)

    report = rl.relint()
    assert report["healed"] == []
    assert len(report["uncomparable"]) == 1
    assert report["uncomparable"][0]["verdict"] == rl.UNCOMPARABLE
    assert "outside the linter's vocabulary" in report["uncomparable"][0]["note"]
    assert _repaint_column(def_id, 1) == before
    assert "UNCOMPARABLE" in rl.format_report(report)


def test_a_plot_key_that_MOVED_is_uncomparable_rather_than_healed(store):
    """A drift in the plot SET is a document question, not a badge one."""
    def_id = "u_0000000000f4"
    svc.save(USER, def_id, defn(def_id, SMA))
    _force_stored(def_id, {"value": "repaints", "ghost": "repaints"})

    report = rl.relint()
    verdicts = {f["plot_key"]: f["verdict"] for f in
                report["healed"] + report["needs_decision"] + report["uncomparable"]}
    assert verdicts["value"] == rl.STORED_STRICTER
    assert verdicts["ghost"] == rl.UNCOMPARABLE
    assert json.loads(_repaint_column(def_id, 1))["ghost"] == "repaints"


# ═══ NON-VACUITY ═════════════════════════════════════════════════════════════

def test_a_pass_over_an_EMPTY_store_SAYS_SO_rather_than_reading_as_a_clean_bill(store):
    """⛔ THE NON-VACUITY CONTROL ON THE PASS ITSELF.

    "No drift found" and "read nothing" are the same three lists to a caller who
    only looks at the lists. The counts are in the answer for that reason, and
    the prose says it in words — because the person reading a re-lint report
    after a linter change is exactly the person who must not mistake one for the
    other.
    """
    report = rl.relint()
    assert report["definitions_read"] == 0 and report["plots_read"] == 0
    assert (report["healed"], report["needs_decision"], report["uncomparable"]) == ([], [], [])
    assert "read nothing" in rl.format_report(report)
    assert "NOT a clean bill of health" in rl.format_report(report)


def test_the_sweep_actually_READ_the_definitions_it_reports_on(store):
    """⛔ THE NON-VACUITY CONTROL ON THE RAILS. Every assertion above is about a
    pass that read something; this pins that a populated store is actually
    walked, plot by plot, so a `relint()` that silently stopped reading would go
    RED here rather than reporting a serene nothing everywhere else.
    """
    ids = ["u_00000000a001", "u_00000000a002", "u_00000000a003"]
    svc.save(USER, ids[0], defn(ids[0], SMA))
    svc.save(USER, ids[1], defn(ids[1], UNREADABLE))
    svc.save(USER, ids[2], defn(ids[2], SMA, trees={"a": SMA, "b": CHIKOU},
                                plots=("a", "b")))

    report = rl.relint()
    assert report["definitions_read"] == 3, report["definitions_read"]
    assert report["plots_read"] == 4, report["plots_read"]
    # Nothing drifted, so everything AGREED — and `agreed` is what proves the
    # walk reached a verdict on each one rather than skipping them.
    assert report["agreed"] == 4
    assert report["healed"] == [] and report["needs_decision"] == []


# ═══ DRIVEN BY THE MANIFEST, NOT BY A NAME ═══════════════════════════════════

def _table() -> dict:
    return json.loads(TABLE.read_text(encoding="utf-8"))


def _compound_window_functions(table: dict) -> dict:
    """Manifest functions whose declared window is an EXPRESSION, not a bare ref.

    This is the family the retired `^arg(N)$` grammar could not read, and
    therefore the family that got branded `repaints` in production.
    """
    return {n: s for n, s in table["functions"].items()
            if isinstance(s.get("lookback"), str)
            and re.search(r"[*+\-]", s["lookback"])}


def test_the_pass_NAMES_NO_FUNCTION_OF_THE_GRAMMAR(store):
    """⛔ DRIVEN BY THE MANIFEST, NEVER BY A HARDCODED NAME.

    Exactly one function declares a compound window today, so a pass written
    against that one name would pass every test in this file and cover NOTHING
    the day a second one lands. The claim is proven structurally: no string
    constant anywhere in the pass's source equals a function name in
    `closedTable.json`.

    Carries its own control, because a scan that can see nothing proves nothing.
    """
    names = set(_table()["functions"])
    assert len(names) >= 50, len(names)          # the manifest is really there

    source = pathlib.Path(rl.__file__).read_text(encoding="utf-8")
    tree = ast.parse(source)
    constants = {n.value for n in ast.walk(tree)
                 if isinstance(n, ast.Constant) and isinstance(n.value, str)}

    def offenders(consts):
        return sorted({c for c in consts if c in names})

    assert offenders(constants) == [], (
        "the re-lint pass names a function of the closed table — it must be "
        f"driven by the manifest, not by a name: {offenders(constants)}")

    # THE CONTROL: the same test can see a name when one is present.
    control = ast.parse('X = "%s"\n' % sorted(names)[0])
    control_consts = {n.value for n in ast.walk(control)
                      if isinstance(n, ast.Constant) and isinstance(n.value, str)}
    assert offenders(control_consts) == [sorted(names)[0]]


def test_the_DRIFT_THIS_PASS_EXISTS_FOR_is_still_a_real_drift():
    """⛔ ANTI-ROT ON THE REASON. A declared exception that quietly resolves is a
    lie the next reader inherits, so this fails rather than passing quietly.

    The claim: the retired narrow lookback grammar could not bound a compound
    window, so it branded such calls `repaints`; today's linter bounds them. If
    that regressed, the drift this pass heals is not the drift described — and
    if the manifest ever holds NO compound window, the sentence in the module
    header stops being about anything and must be rewritten rather than left
    standing.
    """
    table = _table()
    compound = _compound_window_functions(table)
    assert compound, (
        "no manifest function declares a compound window any more — the module "
        "header's account of WHY this pass exists is now about nothing; rewrite "
        "it rather than leaving a false claim behind")

    series = set(table["series"])
    for name, spec in compound.items():
        roles = spec.get("argRoles") or []
        args = []
        for i, kind in enumerate(spec["args"]):
            role = roles[i] if i < len(roles) else ""
            args.append({"type": "series", "name": role if role in series else "close"}
                        if kind == "series" else {"type": "num", "value": 14})
        verdict = ast_lint.lint_repaint({"type": "call", "name": name, "args": args})
        assert verdict["mode"] != "repaints", (
            f"{name} declares {spec['lookback']!r} and lints {verdict['mode']!r} "
            f"again: {verdict.get('reasons')}")
        assert verdict["back"] not in (ast_lint.UNKNOWN, ast_lint.UNBOUNDED), verdict


# ═══ IT IS A PASS, NOT A HOOK ════════════════════════════════════════════════

def test_the_pass_is_NOT_wired_into_save_or_into_the_admission_path():
    """⛔ THE DESIGN CONSTRAINT, ASSERTED ON THE SOURCE OF THE MODULES IT BINDS.

    "Recomputing at read time" is the thing the store's docstring forbids. A
    re-lint that quietly became a hook in `save()` or in the gate would be that
    defect arriving through the door built to avoid it — and it would be
    invisible, because every test in this file would still pass.

    By AST over the two modules' imports, with a control proving the walk sees
    the imports those modules really do make.
    """
    checked = 0
    for module in (svc, aus):
        source = pathlib.Path(module.__file__).read_text(encoding="utf-8")
        tree = ast.parse(source)
        imported = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(a.name for a in node.names)
            elif isinstance(node, ast.ImportFrom):
                mod = node.module or ""
                imported.add(mod)
                imported.update(f"{mod}.{a.name}" for a in node.names)
        assert not any("user_definition_relint" in n for n in imported), (
            f"{module.__name__} imports the re-lint pass — the pass is explicit, "
            "never a hook in the write path or the admission path")
        # CONTROL: the walk really does see this module's imports.
        assert "api.services" in imported or any(
            n.startswith("api.services") for n in imported), sorted(imported)[:8]
        checked += 1
    assert checked == 2


# ═══ THE COMPARE-AND-SET, DRIVEN ═════════════════════════════════════════════

def test_the_heal_SKIPS_a_row_that_MOVED_UNDER_THE_DECISION(store):
    """⛔ A GUARD NOBODY HAS SEEN FIRE IS NOT A GUARD (`lesson_gate_that_cannot_fail`).

    `relint()` decides outside the store's write lock and writes inside it, so a
    concurrent `save()` can land between the two. Every other rail in this file
    reaches `_heal` on a row that never moved, so both skip branches were
    invisible: a mutation deleting the compare-and-set kept all of them green.

    Three drives, and the CONTROL is what makes the two skips measurements
    rather than a function that writes nothing.
    """
    def_id = "u_00000000ca01"
    svc.save(USER, def_id, defn(def_id, SMA))
    _force_stored(def_id, {"value": "repaints"})
    decision = {"user_id": USER, "def_id": def_id, "version": 1,
                "plot_key": "value", "stored": "repaints",
                "current": "non-repainting"}

    # 1. THE VALUE MOVED. The decision was taken against `repaints`; somebody
    #    has since stored something else. Writing our answer over theirs would
    #    silently discard a save.
    _force_stored(def_id, {"value": "preview-repaints"})
    assert rl._heal(decision, 111) is False
    assert json.loads(_repaint_column(def_id, 1)) == {"value": "preview-repaints"}
    assert rl.heal_log() == []

    # 2. THE ROW IS NO LONGER NEWEST. A save appended while we were deciding, so
    #    version 1 is history now and history is never rewritten.
    #
    #    ⛔ BOTH VERSIONS ARE FORCED TO THE SAME BADGE ON PURPOSE, AND THAT IS THE
    #    WHOLE POINT OF THIS ARRANGEMENT. Leave version 2 carrying its own fresh
    #    verdict and the VALUE compare-and-set catches this case too — so the two
    #    guards mask each other, and deleting the version guard leaves every test
    #    green (measured: it did). With the two badges equal, only the version
    #    guard can refuse, and without it the `UPDATE ... WHERE version=1` writes
    #    into HISTORY (`lesson_mutations_can_cancel_each_other`, in the shape
    #    where two guards cancel one mutation).
    _force_stored(def_id, {"value": "repaints"})
    svc.save(USER, def_id, defn(def_id, SMA, name="edited"))
    assert svc.get(USER, def_id)["version"] == 2
    _force_stored(def_id, {"value": "repaints"}, version=2)
    assert rl._heal(decision, 111) is False
    assert json.loads(_repaint_column(def_id, 1)) == {"value": "repaints"}
    assert json.loads(_repaint_column(def_id, 2)) == {"value": "repaints"}
    assert rl.heal_log() == []

    # 3. THE CONTROL — the same finding against the row it was actually taken
    #    against DOES write. Without this the two skips above are satisfied by a
    #    `_heal` that can never write at all.
    _force_stored(def_id, {"value": "repaints"}, version=2)
    assert rl._heal(dict(decision, version=2), 111) is True
    assert json.loads(_repaint_column(def_id, 2)) == {"value": "non-repainting"}
    assert [(e["version"], e["old_mode"], e["new_mode"]) for e in rl.heal_log()] == \
        [(2, "repaints", "non-repainting")]


def test_the_heal_SKIPS_a_definition_TOMBSTONED_under_the_decision(store):
    """A delete appends a tombstone version; a heal aimed at the row beneath it
    would re-badge a formula its owner has removed."""
    def_id = "u_00000000ca02"
    svc.save(USER, def_id, defn(def_id, SMA))
    _force_stored(def_id, {"value": "repaints"})
    assert svc.soft_delete(USER, def_id) is True
    decision = {"user_id": USER, "def_id": def_id, "version": 2,
                "plot_key": "value", "stored": "repaints",
                "current": "non-repainting"}
    assert rl._heal(decision, 111) is False
    assert rl.heal_log() == []
