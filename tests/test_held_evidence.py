"""Rails for the held-evidence reader (`tools/vendor_harness/held_evidence.py`): the one reader of what licence-held
captures decide, for the door's narrow withholds, the host known-divergence list and the runtime kill list.

Run ONLY this file:  python -m pytest tests/test_held_evidence.py -q

Offline: synthetic ledger files in tmp_path, plus the committed door file against the committed ledger.
"""
from __future__ import annotations

import json
import pathlib
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools" / "vendor_harness"))

import evidence_ledger as el  # noqa: E402
import held_evidence as he  # noqa: E402
import host_divergence as hd  # noqa: E402

SHA = "a" * 64
CUR = he.current_engine()


def _plot(title, **stats):
    return {"title": title, "verdict": "DIVERGE", "reason": "160 steady-state bars disagree",
            "stats": {"valueMismatches": 0, "naMismatches": 0, "colorMismatches": 0, "vendorRowsMissing": 0, **stats}}


def _graded(**parts):
    return {"verdict": "DIVERGE", "reason": "1 of 2 compared items diverge", "ourDoor": "runtime", **parts}


def _lane(graded):
    """A lane verdict as the ledger files it (the one path: `evidence_ledger._lane_verdict`)."""
    return el._lane_verdict(graded)


def _row(cid, lane_verdicts, engine=None, stamp="2026-11-19T20:00:00Z", licence="held", sha=SHA):
    verdicts = {lane: None for lane in el.LANES}
    verdicts.update(lane_verdicts)
    return {"schema": el.SCHEMA, "filedBy": "regrade", "gradedAtUTC": stamp, "captureId": cid, "receipt": 1,
            "captureSha256": "c" * 64, "sourceSha256": sha, "scriptKey": cid.rsplit("-rddt-", 1)[0], "script": None,
            "symbol": "NYSE:RDDT", "timeframe": "1D", "bars": 10, "verdicts": verdicts,
            "scriptEngineVersion": CUR if engine is None else engine, "graderVersion": "x", "licence": licence}


def _ledger(tmp_path, rows, name="ledger.jsonl"):
    f = tmp_path / name
    f.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    return f


COLOUR = _lane(_graded(plots=[_plot("ATR Trailing Stop", colorMismatches=160)]))
VALUES = _lane(_graded(plots=[_plot("Shapes", naMismatches=3)]))
UNISOLABLE = _lane(_graded(plots=[{"title": None, "verdict": "DIVERGE", "reason": "x", "stats": {"valueMismatches": 2}}]))
WITHHELD = {"verdict": "DIVERGE", "reason": "TradingView holds 17 drawing object(s) and our drawing is withheld by name",
            "first": {"kind": "withheld", "item": "our drawing is withheld by name"}}
MATCH = {"verdict": "MATCH", "reason": "all 2 items agree"}


# ── the narrowest withhold, per element ─────────────────────────────────────────────────────────────────────────
def test_a_plot_whose_values_agree_and_colour_does_not_withholds_only_its_colour():
    w = he.lane_withholds(_graded(plots=[_plot("ATR Trailing Stop", colorMismatches=160)]))
    assert [(x["scope"], x["title"], x["door"]) for x in w] == [("outputColour", "ATR Trailing Stop", "runtime")]


def test_a_plot_whose_values_differ_withholds_that_output_by_title():
    w = he.lane_withholds(_graded(plots=[_plot("Shapes", naMismatches=3, colorMismatches=1)]))
    assert [(x["scope"], x["title"]) for x in w] == [("output", "Shapes")]


def test_a_differing_paint_withholds_that_paint_by_kind_and_line_and_a_paint_neither_side_draws_is_left():
    paints = {"verdict": "DIVERGE", "unpaired": [], "rows": [
        {"id": "plot_9", "kind": "bgcolor", "state": "notDrawn", "line": 172, "title": "Background Color", "differs": True},
        {"id": "plot_8", "kind": "barcolor", "state": "notDrawn", "line": 171, "differs": False}]}
    w = he.lane_withholds(_graded(paints=paints))
    assert [(x["scope"], x["kind"], x["line"]) for x in w] == [("paint", "bgcolor", 172)]


def test_an_object_family_that_differs_is_withheld_by_family():
    objects = {"verdict": "DIVERGE", "counts": [{"family": "labels", "vendor": 48, "ours": 39, "agree": False},
                                                {"family": "lines", "vendor": 0, "ours": 0, "agree": True}]}
    v2 = {"verdict": "DIVERGE", "first": {"family": "labels", "field": "count"}}
    objects["texts"] = [{"family": "labels text", "agree": False}, {"family": "tableCells text", "agree": True}]
    w = he.lane_withholds(_graded(objects=objects, objectsV2=v2, ourDoor="host"))
    assert [(x["scope"], x["family"], x["door"]) for x in w] == [("objectFamily", "label", "host")]


@pytest.mark.parametrize("graded", [
    _graded(plots=[{"title": None, "verdict": "DIVERGE", "reason": "x", "stats": {"valueMismatches": 2}}]),
    _graded(paints={"verdict": "DIVERGE", "unpaired": [{"kind": "bgcolor", "vendor": 2, "ours": 1}], "rows": []}),
    _graded(objects={"verdict": "DIVERGE", "counts": []}),
    _graded(plots=[_plot("A", colorMismatches=1)], strategy={"verdict": "DIVERGE", "reason": "a trade differs"}),
    {**_graded(plots=[_plot("A", colorMismatches=1)]), "ourDoor": None},
], ids=["untitled-plot", "paint-count", "object-difference-no-family-names", "another-item", "door-unknown"])
def test_a_difference_that_cannot_be_isolated_asks_for_no_narrow_withhold(graded):
    assert he.lane_withholds(graded) == []


def test_only_a_drawn_divergence_asks_for_a_withhold():
    assert he.lane_withholds({**MATCH, "ourDoor": "host"}) == []
    assert he.lane_withholds({"verdict": "DIVERGE", "ourDoor": "host", "reason": "r",
                              "objects": {"verdict": "DIVERGE", "reason": "TradingView holds 3 and our drawing is withheld by name"},
                              "objectsV2": {"verdict": "DIVERGE", "pairedNothing": True}}) == []


def test_the_ledger_row_carries_first_door_and_withholds_from_the_grader_result():
    assert COLOUR["first"]["kind"] == "drawn" and COLOUR["door"] == "runtime"
    assert COLOUR["withholds"][0]["scope"] == "outputColour"
    assert "withholds" not in UNISOLABLE


# ── what the readers decide ────────────────────────────────────────────────────────────────────────────────────────
def test_the_lane_names_are_the_ledgers_and_the_default_floor_is_the_current_engine(tmp_path):
    assert he.LANES == ("production", "runtime-on")
    assert he.current_engine() == el.engine_version()
    with pytest.raises(ValueError, match="runtime"):
        he.held_rows("runtime", _ledger(tmp_path, []))


def test_an_isolable_difference_withholds_narrowly_and_never_kills(tmp_path):
    f = _ledger(tmp_path, [_row("atr-rddt-1d-2026-11-19", {"runtime-on": COLOUR})])
    assert he.held_kills("runtime-on", f) == {}
    w = he.held_withholds("runtime-on", f)[SHA]
    assert [(x["scope"], x["title"], x["evidence"]) for x in w] == [("outputColour", "ATR Trailing Stop", ["atr-rddt-1d-2026-11-19"])]


def test_a_difference_no_withhold_isolates_kills_the_whole_script_from_committed_bytes_alone(tmp_path):
    f = _ledger(tmp_path, [_row("x-rddt-1d-2026-11-19", {"runtime-on": UNISOLABLE})])
    k = he.held_kills("runtime-on", f)
    assert list(k) == [SHA] and k[SHA]["evidence"][0]["kind"] == "drawn"
    assert he.held_withholds("runtime-on", f) == {}
    assert he.held_kills("production", f) == {}                   # the other lane holds no verdict


def test_an_action_survives_an_engine_bump_until_a_newer_regrade_lifts_it(tmp_path):
    stale = [_row("x-rddt-1d-2026-11-19", {"runtime-on": UNISOLABLE}, engine=CUR - 1),
             _row("atr-rddt-1d-2026-11-19", {"runtime-on": COLOUR}, engine=CUR - 1, sha="b" * 64)]
    f = _ledger(tmp_path, stale, "s.jsonl")
    # graded on the previous engine, nothing newer: both actions SURVIVE the bump (dropping them could bring back a
    # wrong picture)
    assert list(he.held_kills("runtime-on", f)) == [SHA]
    assert list(he.held_withholds("runtime-on", f)) == ["b" * 64]
    # ... but they are not CURRENT evidence (the view a new action is asked against)
    assert he.held_kills("runtime-on", f, engine_floor=CUR) == {} and he.held_withholds("runtime-on", f, engine_floor=CUR) == {}
    # a regrade at the new engine that MATCHES lifts both
    lifted = stale + [_row("x-rddt-1d-2026-11-19", {"runtime-on": MATCH}, stamp="2026-11-19T09:00:00Z"),
                      _row("atr-rddt-1d-2026-11-19", {"runtime-on": MATCH}, sha="b" * 64, stamp="2026-11-19T09:00:00Z")]
    g = _ledger(tmp_path, lifted, "l.jsonl")
    assert he.held_kills("runtime-on", g) == {} and he.held_withholds("runtime-on", g) == {}


def test_a_row_graded_later_on_an_older_engine_never_overrides_a_newer_engine(tmp_path):
    newer = _row("x-rddt-1d-2026-11-19", {"runtime-on": UNISOLABLE}, stamp="2026-11-19T10:00:00Z")
    older_later = _row("x-rddt-1d-2026-11-19", {"runtime-on": MATCH}, engine=CUR - 1, stamp="2026-11-19T23:00:00Z")
    assert list(he.held_kills("runtime-on", _ledger(tmp_path, [newer, older_later]))) == [SHA]


def test_a_row_filed_before_the_held_evidence_grader_never_acts(tmp_path):
    legacy = {"verdict": "DIVERGE", "reason": "1 of 2 compared items diverge"}       # no `first`: never acted on then
    f = _ledger(tmp_path, [_row("old-rddt-1d-2026-11-01", {"production": legacy}, engine=CUR - 5)], "legacy.jsonl")
    assert he.held_kills("production", f) == {} and he.held_withholds("production", f) == {}
    assert SHA not in hd.derive(ledger=f)
    # CONTROL: the same difference filed by today's grader acts
    assert list(he.held_kills("production", _ledger(tmp_path, [_row("old-rddt-1d-2026-11-01", {"production": UNISOLABLE})], "n.jsonl"))) == [SHA]


def test_the_latest_row_per_capture_decides(tmp_path):
    old = _row("x-rddt-1d-2026-11-19", {"runtime-on": UNISOLABLE}, stamp="2026-11-19T10:00:00Z")
    new = _row("x-rddt-1d-2026-11-19", {"runtime-on": MATCH}, stamp="2026-11-19T20:00:00Z")
    assert he.held_kills("runtime-on", _ledger(tmp_path, [old, new], "a.jsonl")) == {}
    later = {**old, "gradedAtUTC": "2026-11-19T21:00:00Z"}
    assert list(he.held_kills("runtime-on", _ledger(tmp_path, [new, later], "b.jsonl"))) == [SHA]


def test_withheld_by_name_and_committed_captures_are_never_acted_on(tmp_path):
    f = _ledger(tmp_path, [_row("x-rddt-1d-2026-11-19", {"runtime-on": WITHHELD})], "w.jsonl")
    assert he.held_kills("runtime-on", f) == {} and he.held_withholds("runtime-on", f) == {}
    c = _ledger(tmp_path, [_row("x-rddt-1d-2026-11-19", {"runtime-on": UNISOLABLE}, licence="corpus")], "c.jsonl")
    assert he.held_kills("runtime-on", c) == {}


def test_the_door_file_merges_both_lanes_by_target_and_names_its_evidence(tmp_path):
    f = _ledger(tmp_path, [
        _row("sh-rddt-1d-2026-11-17", {"runtime-on": VALUES, "production": VALUES}),
        _row("sh-spy-1d-2026-11-17", {"runtime-on": VALUES}, stamp="2026-11-19T20:01:00Z"),
    ])
    doc = he.door_document(f)
    assert doc["schema"] == he.DOOR_SCHEMA and "engineFloor" not in doc    # a bump never changes the derivation
    (s,) = doc["scripts"]
    (w,) = s["withholds"]
    assert (w["scope"], w["title"], w["lanes"]) == ("output", "Shapes", ["production", "runtime-on"])
    assert w["evidence"] == ["sh-rddt-1d-2026-11-17", "sh-spy-1d-2026-11-17"] and w["engine"] == CUR


def test_the_committed_door_file_is_the_committed_ledgers_derivation():
    assert he.main(["--check"]) == 0


def test_check_fails_when_the_door_file_is_not_the_derivation(tmp_path):
    out = tmp_path / "heldWithholds.json"
    out.write_text('{"schema": "uct.held-withholds/v1", "scripts": []}\n', encoding="utf-8")
    f = _ledger(tmp_path, [_row("atr-rddt-1d-2026-11-19", {"runtime-on": COLOUR})])
    assert he.main(["--check", "--ledger", str(f), "--out", str(out)]) == 1
    assert he.main(["--write", "--ledger", str(f), "--out", str(out)]) == 0
    assert he.main(["--check", "--ledger", str(f), "--out", str(out)]) == 0


def test_a_stale_row_never_creates_a_withhold_but_one_already_held_survives(tmp_path):
    out = tmp_path / "heldWithholds.json"
    stale = _ledger(tmp_path, [_row("atr-rddt-1d-2026-11-19", {"runtime-on": COLOUR}, engine=CUR - 1)], "st.jsonl")
    out.write_text('{"schema": "uct.held-withholds/v1", "scripts": []}\n', encoding="utf-8")
    assert he.main(["--write", "--ledger", str(stale), "--out", str(out)]) == 2        # never CREATED from a stale row
    assert json.loads(out.read_text(encoding="utf-8"))["scripts"] == []
    cur = _ledger(tmp_path, [_row("atr-rddt-1d-2026-11-19", {"runtime-on": COLOUR}, engine=CUR - 1, stamp="2026-11-19T01:00:00Z"),
                             _row("atr-rddt-1d-2026-11-19", {"runtime-on": COLOUR})], "cu.jsonl")
    assert he.main(["--write", "--ledger", str(cur), "--out", str(out)]) == 0          # current evidence creates it
    assert he.main(["--write", "--ledger", str(stale), "--out", str(out)]) == 0        # ... and, held, it survives
    assert he.main(["--check", "--ledger", str(stale), "--out", str(out)]) == 0


def test_host_divergence_lists_a_held_production_kill_until_a_newer_regrade_lifts_it(tmp_path):
    cur = _ledger(tmp_path, [_row("x-rddt-1d-2026-11-19", {"production": UNISOLABLE})], "p.jsonl")
    d = hd.derive(ledger=cur)
    assert SHA in d and d[SHA]["evidence"]["diverge"][0]["held"] is True
    assert d[SHA]["source"] == "licence-held capture (evidence ledger)"
    stale = _ledger(tmp_path, [_row("x-rddt-1d-2026-11-19", {"production": UNISOLABLE}, engine=CUR - 1)], "s.jsonl")
    assert SHA in hd.derive(ledger=stale)                         # survives the bump
    lifted = _ledger(tmp_path, [_row("x-rddt-1d-2026-11-19", {"production": UNISOLABLE}, engine=CUR - 1),
                                _row("x-rddt-1d-2026-11-19", {"production": MATCH})], "l.jsonl")
    assert SHA not in hd.derive(ledger=lifted)
    narrow = _ledger(tmp_path, [_row("x-rddt-1d-2026-11-19", {"production": COLOUR})], "n.jsonl")
    assert SHA not in hd.derive(ledger=narrow)                    # the door withholds it narrowly instead
