"""C45 item 8 -- ``valuewhenOccurrence`` is CONTAINED: tagged, refused by the five
comparability consumers by name, and the one bounded shape it is not tagged in
(a period anchor) has ONE answer of its own.

The table declared ``valuewhenOccurrence`` with ``lookback: "series"`` (its value
depends on how much history was loaded) from PR #166 (2026-09-20) and no
requirement tag named it. ``tests/test_requirement_tags.py`` asserts that pair is
one decision; two of its rails were red from that day. This file is about what
the fix decides beyond turning them green:

  1. the tag is its OWN (``occurrence_dependent``), because the refusal a member
     reads must be true and ``window_dependent``'s sentence is about a running
     total;
  2. a PERIOD ANCHOR -- ``valuewhenOccurrence(<period first>, time, 0)``, what
     ``time("W")`` translates to -- is bounded and masked exactly (C36), and is
     NOT tagged; on a server lane it is refused by the gate ``withheld`` (item 6),
     naming the clock. One answer, never two;
  3. the stamping walk reads the ``series`` roster too (an ``isfirst`` LEAF);
  4. a definition saved BEFORE the tag existed keeps its stored stamp (the store's
     own rule) until the re-lint pass heals it toward MORE tags and names the
     armed alerts -- which the manifest promised and the pass did not do.
"""
from __future__ import annotations

import io
import json
import pathlib
import sqlite3

import pytest

from api.services import alert_user_series as aus
from api.services import ast_interpret as ai
from api.services import ast_table
from api.services import indicator_alert_service as ias
from api.services import scan_definition
from api.services import user_definition_relint as rl
from api.services import user_definitions as ud
from api.services.user_definitions import consumer_refusal, requirement_tags

TAG = "occurrence_dependent"
CONSUMERS = ("screener", "sweep", "alert", "share", "listing")
_FIXTURES = pathlib.Path(__file__).parent / "fixtures" / "ast"

CLOSE = {"type": "series", "name": "close"}
OPEN = {"type": "series", "name": "open"}
TIME = {"type": "series", "name": "time"}


def num(v):
    return {"type": "num", "value": v}


def op(name, *args):
    return {"type": "op", "name": name, "args": list(args)}


def call(name, *args):
    return {"type": "call", "name": name, "args": list(args)}


UP = op(">", CLOSE, OPEN)
#: `ta.valuewhen(close > open, close, 1)` -- the SECOND most recent up bar's close
GENERAL = call("valuewhenOccurrence", UP, CLOSE, num(1))
#: `ta.valuewhen(close > open, close, 1) > close` -- a condition a scan can hold
GENERAL_SCAN = op(">", GENERAL, CLOSE)


def doc(tree, def_id="u_c45c45c45c45", meta=None) -> dict:
    return {
        "schemaVersion": 1, "id": def_id, "version": 1,
        "meta": dict(meta or {"name": "occurrence", "shortName": "OCC"}),
        "compute": {"kind": "ast", "ast": tree},
        "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": [],
    }


def anchors() -> dict:
    cases = json.load(io.open(_FIXTURES / "period_anchor_parity.json", encoding="utf-8"))["cases"]
    return {c["name"]: c["ast"] for c in cases}


def _calls(tree, name) -> int:
    n = 0
    stack = [tree]
    while stack:
        node = stack.pop()
        if isinstance(node, dict):
            if node.get("type") == "call" and node.get("name") == name:
                n += 1
            stack.extend(node.values())
        elif isinstance(node, list):
            stack.extend(node)
    return n


def _anchor_in(tree):
    """The period-anchor node inside a tree, by the interpreter's own recogniser."""
    stack = [tree]
    while stack:
        node = stack.pop()
        if isinstance(node, dict):
            if ai.is_period_anchor(node):
                return node
            stack.extend(node.values())
        elif isinstance(node, list):
            stack.extend(node)
    return None


# ═══ 1. the tag ══════════════════════════════════════════════════════════════

def test_the_table_declares_the_tag_and_it_is_its_own():
    spec = ast_table.TABLE["_requirement_tags"]
    assert list(spec[TAG]["calls"]) == ["valuewhenOccurrence"]
    assert sorted(spec[TAG]["refused_by"]) == sorted(CONSUMERS)
    assert list(spec[TAG]["accepted_by"]) == ["pane"]
    # not folded into the running-total tag, whose sentence would be false of it
    assert "valuewhenOccurrence" not in spec["window_dependent"]["calls"]
    # ...and no member badge is declared: a hole on a pane is not a number that moves
    assert "memberNote" not in spec[TAG]


def test_a_general_occurrence_read_is_tagged_and_every_comparability_consumer_refuses_it_by_name():
    tags = requirement_tags(doc(GENERAL))
    assert tags == [TAG]
    for consumer in CONSUMERS:
        why = consumer_refusal(consumer, tags)
        assert why and consumer in why, consumer
        assert "`valuewhenOccurrence`" in why
        assert "n-th most recent time a condition was true" in why
        # the sentence is THIS tag's, not the running total's
        assert "running total" not in why
    assert consumer_refusal("pane", tags) is None


# ═══ 2. the period anchor ════════════════════════════════════════════════════

def test_a_period_anchor_is_not_tagged_and_the_trees_really_hold_the_call():
    trees = anchors()
    holding = {n: t for n, t in trees.items() if _calls(t, "valuewhenOccurrence")}
    # ⛔ non-vacuity: the fixture's W / M / 3M / 12M anchors ARE this call
    assert len(holding) >= 30
    for name, tree in holding.items():
        assert requirement_tags(doc(tree)) == [], name
    # every tree of the fixture, anchors or not, raises no tag
    for name, tree in trees.items():
        assert requirement_tags(doc(tree)) == [], name


def test_the_exemption_is_the_exact_shape_and_nothing_near_it():
    whole = anchors()["W · weekdays · D"]          # the door's tree: the anchor, gated and in ms
    assert requirement_tags(doc(whole)) == []
    week = _anchor_in(whole)
    assert week is not None and ai.is_period_anchor(week) is True
    assert week["name"] == "valuewhenOccurrence" and week["args"][2] == num(0)
    assert requirement_tags(doc(week)) == []
    first = week["args"][0]
    # occurrence 1 of the same condition is the period BEFORE: unbounded reach
    assert requirement_tags(doc(call("valuewhenOccurrence", first, TIME, num(1)))) == [TAG]
    # another source at the period's first bar is not the anchor either
    assert requirement_tags(doc(call("valuewhenOccurrence", first, CLOSE, num(0)))) == [TAG]
    # an anchor BESIDE a general read: the general read still tags the document
    assert requirement_tags(doc(op("+", week, GENERAL))) == [TAG]
    # ...and a general read INSIDE an anchor-shaped call's argument cannot hide:
    # such a node is not the anchor shape, so it is walked
    nested = call("valuewhenOccurrence", op(">", GENERAL, num(0)), TIME, num(0))
    assert ai.is_period_anchor(nested) is False
    assert requirement_tags(doc(nested)) == [TAG]


def test_ONE_answer_for_a_scan_or_an_alert_on_a_period_anchor_the_gate_withheld():
    """Not `requirements` (it is not a fact about the request) and not admitted to
    go quiet (item 6): the lane has no clock, and the refusal says so."""
    week_changed = op("!=", anchors()["change(W) · weekdays · D"], num(0))
    d = doc(week_changed)
    assert requirement_tags(d) == []
    for consumer in CONSUMERS:
        assert consumer_refusal(consumer, requirement_tags(d)) is None
    with pytest.raises(scan_definition.ScanRefused) as scan:
        scan_definition.assert_scannable(d)
    assert scan.value.gate == "withheld" and "time-clock:unreadable" in str(scan.value)
    with pytest.raises(aus.AdmissionRefused) as alert:
        aus._make_value_fn(d["id"], "value", d)
    assert alert.value.gate == "withheld" and "time-anchor:not-daily" in str(alert.value)


def test_a_general_occurrence_read_is_refused_at_the_alert_door_by_the_consumer_contract():
    """The OTHER answer, for the other tree: loud, and with the tag's sentence."""
    row = {"def_id": "u_c45c45c45c45", "requirements": requirement_tags(doc(GENERAL))}
    with pytest.raises(aus.AdmissionRefused) as exc:
        aus._gate_requirements(row, row["def_id"])
    assert exc.value.gate == "requirements"
    assert aus.REFUSAL_FRAGMENTS["requirements"] in str(exc.value)
    assert "`valuewhenOccurrence`" in str(exc.value)
    assert "n-th most recent time a condition was true" in str(exc.value)


# ═══ 3. the series roster ════════════════════════════════════════════════════

def test_a_LEAF_the_manifest_lists_under_series_is_tagged_too():
    spec = ast_table.TABLE["_requirement_tags"]["window_dependent"]
    leaves = list(spec.get("series") or ())
    assert leaves, "the manifest declares no series roster to read"
    for name in leaves:
        tree = op("?:", {"type": "series", "name": name}, CLOSE, OPEN)
        assert requirement_tags(doc(tree)) == ["window_dependent"], name
    # control: a series the roster does not name raises nothing
    assert requirement_tags(doc(op("?:", UP, CLOSE, OPEN))) == []


# ═══ 4. saved definitions ════════════════════════════════════════════════════

USER = "user-c45"
DEF_ID = "u_c45c45c45c45"


@pytest.fixture
def store(tmp_path, monkeypatch):
    path = tmp_path / "user_definitions.db"
    monkeypatch.setenv("USER_DEFINITIONS_DB_PATH", str(path))
    monkeypatch.setattr(ud, "_DB_PATH", str(path))
    ud._init_db()
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    aus.forget()
    try:
        yield path
    finally:
        aus.forget()


def _stored(def_id=DEF_ID) -> dict:
    return ud.get(USER, def_id)


def _stamp(def_id: str, tags: list, version: int = 1) -> None:
    """The stamp a save BEFORE the tag existed left behind (the same honest
    fixture `test_user_definition_relint.py::_force_stored` uses for `repaint`)."""
    con = sqlite3.connect(ud._DB_PATH)
    try:
        con.execute("UPDATE user_definitions SET requirements=? WHERE def_id=? AND version=?",
                    (json.dumps(tags, separators=(",", ":")), def_id, version))
        con.commit()
    finally:
        con.close()


def _arm_a_past_alert(address: str) -> int:
    with ias._conn() as db:
        cur = db.execute(
            "INSERT INTO indicator_alerts "
            "(user_id, sym, indicator, condition, threshold, tf, active, "
            " trigger_count, created_at) VALUES (?,?,?,?,?,?,1,0,0)",
            (USER, "SPY", address, "above", 1.0, "D"))
        return int(cur.lastrowid)


def test_a_save_TODAY_stamps_the_tag_and_every_consumer_reads_it_off_the_row(store):
    saved = ud.save(USER, DEF_ID, doc(GENERAL_SCAN))
    assert saved["requirements"] == [TAG]
    row = _stored()
    assert row["requirements"] == [TAG]
    for consumer in CONSUMERS:
        assert consumer_refusal(consumer, row["requirements"]), consumer
    # the alert door refuses the STORED row loudly, with the tag's sentence
    with pytest.raises(aus.AdmissionRefused) as exc:
        aus.admit_user_definition(USER, DEF_ID, bars=[{"t": 1, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}])
    assert exc.value.gate == "requirements"
    assert "n-th most recent time a condition was true" in str(exc.value)


def test_saving_a_period_anchor_stamps_nothing(store):
    saved = ud.save(USER, DEF_ID, doc(op("!=", anchors()["change(W) · weekdays · D"], num(0))))
    assert saved["requirements"] == []


def test_a_definition_saved_BEFORE_the_tag_keeps_its_stamp_until_the_relint_pass(store):
    """The store's rule: the stamp is STORED, never re-derived at read time. So a
    row saved before the roster grew is admitted exactly as it was -- nothing
    changes value, nothing is refused silently -- until the explicit pass."""
    ud.save(USER, DEF_ID, doc(GENERAL_SCAN))
    _stamp(DEF_ID, [])                                        # as an older save left it
    assert _stored()["requirements"] == []
    assert consumer_refusal("alert", _stored()["requirements"]) is None

    alert_id = _arm_a_past_alert(f"{DEF_ID}.value")
    dry = rl.relint(heal=False)
    assert [f["def_id"] for f in dry["requirements_unhealed"]] == [DEF_ID]
    assert dry["requirements_unhealed"][0]["missing"] == [TAG]
    assert dry["requirements_unhealed"][0]["armed_alert_ids"] == [alert_id]
    assert dry["armed_alerts_affected"] == [alert_id]
    assert _stored()["requirements"] == []                    # a dry run writes nothing

    report = rl.relint()
    assert [f["def_id"] for f in report["requirements_healed"]] == [DEF_ID]
    assert report["requirements_healed"][0]["current"] == [TAG]
    assert report["requirements_healed"][0]["armed_alert_ids"] == [alert_id]
    assert report["armed_alerts_affected"] == [alert_id]
    assert _stored()["requirements"] == [TAG]
    text = rl.format_report(report)
    assert "CONTAINMENT HEALED" in text and DEF_ID in text and str(alert_id) in text
    # ...and the refusal is LOUD, at the door, with the tag's sentence
    with pytest.raises(aus.AdmissionRefused) as exc:
        aus.admit_user_definition(USER, DEF_ID, bars=[{"t": 1, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}])
    assert exc.value.gate == "requirements"
    assert "`valuewhenOccurrence`" in str(exc.value)
    # the heal is logged, and a second pass writes nothing
    log = rl.heal_log(USER, DEF_ID)
    assert [(e["plot_key"], e["old_mode"], e["new_mode"]) for e in log] == \
        [(rl.REQUIREMENTS_LOG_KEY, "[]", json.dumps([TAG]))]
    again = rl.relint()
    assert again["requirements_healed"] == [] and again["requirements_unhealed"] == []
    assert len(rl.heal_log(USER, DEF_ID)) == 1


def test_the_relint_pass_never_SHORTENS_a_stamp_and_leaves_an_untagged_definition_alone(store):
    # a stamp LONGER than today's derivation refuses more than it need: left alone
    ud.save(USER, DEF_ID, doc(op(">", CLOSE, OPEN)))
    _stamp(DEF_ID, [TAG])
    report = rl.relint()
    assert report["requirements_healed"] == [] and report["requirements_unhealed"] == []
    assert _stored()["requirements"] == [TAG]
    # ...and the definition's bytes are untouched by a heal (only the stamp column)
    other = "u_0c450c450c45"
    ud.save(USER, other, doc(GENERAL_SCAN, def_id=other))
    before = _stored(other)["definition"]
    _stamp(other, [])
    rl.relint()
    assert _stored(other)["definition"] == before
    assert _stored(other)["requirements"] == [TAG]


def test_a_heal_ADDS_the_missing_tag_and_KEEPS_one_the_manifest_no_longer_derives(store):
    """A stamp that is BOTH short and long: it lacks today's tag and carries one
    today's derivation does not produce. The heal writes the UNION. Replacing the
    stamp with today's derivation would un-refuse the definition for the stored
    tag, which is a ruling this pass does not make (mutation O11 survived until
    this case existed)."""
    ud.save(USER, DEF_ID, doc(GENERAL_SCAN))
    _stamp(DEF_ID, ["window_dependent"])
    finding = rl.requirements_drift(_stored())
    assert finding["missing"] == [TAG]
    assert finding["current"] == sorted([TAG, "window_dependent"])
    report = rl.relint()
    assert [f["def_id"] for f in report["requirements_healed"]] == [DEF_ID]
    assert _stored()["requirements"] == sorted([TAG, "window_dependent"])


def test_the_heal_SKIPS_a_stamp_that_moved_under_the_decision(store):
    ud.save(USER, DEF_ID, doc(GENERAL_SCAN))
    _stamp(DEF_ID, [])
    finding = rl.requirements_drift(_stored())
    assert finding and finding["stored"] == []
    _stamp(DEF_ID, ["window_dependent"])                      # somebody else wrote it
    assert rl._heal_requirements(finding, 1) is False
    assert _stored()["requirements"] == ["window_dependent"]
