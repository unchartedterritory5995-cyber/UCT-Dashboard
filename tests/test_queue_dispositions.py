"""Rails for the queue's ONE row disposition: `| not a capture | disposition | reason |`
(`tools/vendor_harness/evidence_engine.py`, DISPOSITIONS).

Run ONLY this file:  python -m pytest tests/test_queue_dispositions.py -q

Offline. A row its doc disposes of leaves `rowsNeedingProbe` and is listed, with its reason, in
`rowsNotCaptureQuestions`; an undisposed prose row is still NEEDS_PROBE; a disposition with no reason, an
unknown disposition, or one naming no row refuses the queue. One rail pins the committed docs' dispositions.
"""
from __future__ import annotations

import json
import pathlib
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools" / "vendor_harness"))
sys.path.insert(0, str(REPO / "tools"))

import evidence_engine as ee  # noqa: E402

DOC = """# Capture queue - 2026-11-07 dispositions

| id | probe | chart | question |
|---|---|---|---|
| Q1 | `alpha.pine` | NYSE:RDDT 1D | a real capture |
| Q2 | probe: `indicator("x")` + `plot(bar_index)` | AMEX:SPY 1D | a prose row nobody disposed of |
| `Q3` | probe: `indicator("y")` | AMEX:SPY 1D | blocked by a ruling |
| Q4 | `alpha.pine` | AMEX:SPY 1D | a gap that names a probe but asks nothing |

## Not capture questions (queue dispositions)

| not a capture | disposition | reason |
|---|---|---|
| Q3 | ruling | blocked by the owner's ruling R1 |
| Q4 | engine-gap | a build, not a reading |
"""


def _world(tmp_path, doc=DOC):
    docs, probes, corpus, fixtures = (tmp_path / "docs", tmp_path / "probes", tmp_path / "corpus" / "committed",
                                      tmp_path / "fixtures")
    for d in (docs, probes, corpus, fixtures):
        d.mkdir(parents=True)
    (docs / "capture-queue-2026-11-07-disp.md").write_text(doc, encoding="utf-8")
    (probes / "alpha.pine").write_text('indicator("Alpha")\nplot(close)\n', encoding="utf-8", newline="")
    (tmp_path / "coverage.json").write_text(json.dumps({"scripts": []}), encoding="utf-8")
    return ee.World(docs_dir=docs, probe_dirs=[probes], corpus=tmp_path / "corpus", fixtures=fixtures,
                    coverage=tmp_path / "coverage.json", ledger=tmp_path / "ledger.jsonl",
                    cache_dir=tmp_path / "cache")


def _ids(rows):
    return {r["key"].split("#", 1)[1] for r in rows}


def test_a_disposed_row_leaves_rows_needing_probe_and_is_listed_with_its_reason(tmp_path):
    q = ee.build_queue(_world(tmp_path))
    assert "Q3" not in _ids(q["rowsNeedingProbe"])
    nc = {r["key"].split("#", 1)[1]: r for r in q["rowsNotCaptureQuestions"]}
    assert set(nc) == {"Q3", "Q4"}
    assert nc["Q3"]["disposition"] == "ruling" and nc["Q3"]["reason"] == "blocked by the owner's ruling R1"
    assert q["counts"]["rowsNotCaptureQuestions"] == 2
    assert q["counts"]["rowsNotCaptureByDisposition"] == {"engine-gap": 1, "ruling": 1}
    # a disposed row is never a target either, even one naming a probe and a readable chart
    assert not any(t["symbol"] == "AMEX:SPY" for t in q["targets"])
    assert [t["id"] for t in q["targets"]] == ["alpha@NYSE:RDDT@D"]


def test_an_undisposed_prose_row_still_needs_a_probe(tmp_path):
    q = ee.build_queue(_world(tmp_path))
    assert _ids(q["rowsNeedingProbe"]) == {"Q2"}
    assert q["counts"]["rowsNeedingProbe"] == 1
    # the disposition table itself is no queue row
    assert not any("not a capture" in r["text"] or r["key"].endswith("#Q3~2") for r in q["rowsNeedingProbe"])


def test_without_its_table_the_same_row_is_needs_probe(tmp_path):
    doc = DOC.split("## Not capture questions")[0]
    q = ee.build_queue(_world(tmp_path, doc))
    assert _ids(q["rowsNeedingProbe"]) == {"Q2", "Q3"}
    assert q["rowsNotCaptureQuestions"] == [] and q["counts"]["rowsNotCaptureQuestions"] == 0


@pytest.mark.parametrize("bad_row, why", [
    ("| Q3 | ruling | |", "needs a reason"),
    ("| Q3 | ruling |", "needs a reason"),
    ("| Q3 | ruling | `` |", "needs a reason"),
    ("| Q3 | someday | a reason |", "is not one of"),
    ("| Q99 | ruling | a reason |", "names no row"),
])
def test_a_bad_disposition_refuses_the_queue(tmp_path, bad_row, why):
    doc = DOC.replace("| Q3 | ruling | blocked by the owner's ruling R1 |", bad_row)
    assert bad_row in doc
    with pytest.raises(ee.DispositionError, match=why):
        ee.build_queue(_world(tmp_path, doc))


def test_a_row_disposed_of_twice_refuses_the_queue(tmp_path):
    doc = DOC + "| Q3 | closed | again |\n"
    with pytest.raises(ee.DispositionError, match="twice"):
        ee.build_queue(_world(tmp_path, doc))


#: The committed dispositions (2026-11-07, the probe pass of PRs #921-#924). A change here is a change of
#: bookkeeping: make it in the doc's own `not a capture` table, with its reason, and here.
COMMITTED = {
    "capture-queue-2026-09-27": {"barstate.isnew": "ruling", "input.time": "ruling", "ta.nvi / ta.pvi": "ruling",
                                 "time(<session>) on daily bars": "ruling"},
    "capture-queue-2026-09-30-time-anchors": {
        "time-anchor:weekend-bars": "withheld-ledger",
        "time-anchor:session-open-missing, time-close:period-end-miss": "withheld-ledger",
        "time-anchor:not-daily, time-close:not-daily": "withheld-ledger",
        "time-own:chart-unwitnessed": "withheld-ledger", "pine:function (translation)": "withheld-ledger"},
    "capture-queue-2026-10-01-c45": {
        "bar-index:window": "withheld-ledger", "bar-index:early-bars": "withheld-ledger",
        "a colour HELD fn:conditional-history (object lane)": "withheld-ledger",
        "pine:statement on float = …, line = … …": "withheld-ledger",
        "geometry:lost / content:lost (a withheld object)": "engine-gap",
        "withheld at assert_scannable / alert arm": "engine-gap"},
    "capture-queue-2026-10-02-l2-libraries": {"Q-L2b": "engine-gap"},
    "capture-queue-2026-10-31-prod-ternary": {
        "L3": "engine-gap", "L4": "engine-gap", "L5": "closed", "L6": "engine-gap", "G-a": "closed",
        "G-g": "by-design", "G-h": "engine-gap", "G-b": "engine-gap", "G-c": "engine-gap", "G-d": "engine-gap",
        "G-e": "by-design"},
    "capture-queue-2026-10-31-wse": {"Q-WSE5": "builtin"},
}


def test_the_committed_dispositions_are_exactly_the_reviewed_rows():
    world = ee.World()
    got = {}
    for p in sorted(world.docs_dir.glob("capture-queue-*.md")):
        for r in ee.parse_doc(world, p)["rows"]:
            if r["notCapture"]:
                assert r["notCapture"]["reason"].strip()
                got.setdefault(p.stem, {})[r["key"].split("#", 1)[1]] = r["notCapture"]["disposition"]
    assert got == COMMITTED
    # the real capture questions beside them stay queued as needing a probe (L2 names its probe only in a
    # prose column; G-f / G-i are queued as captures by PT-GAPS; the unstamped multi-state shape is a question)
    q = json.loads((REPO / "docs/pine/vendor-harness/capture-queue.json").read_text(encoding="utf-8"))
    needing = {r["key"] for r in q["rowsNeedingProbe"]}
    for rid in ("L2", "G-f", "G-i"):
        assert f"capture-queue-2026-10-31-prod-ternary#{rid}" in needing
