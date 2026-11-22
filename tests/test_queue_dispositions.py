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
        "G-e": "by-design",
        # PR #937 (reviewed): accum2-accum4 `?:` is a guard to build, L2's capture is already queued
        # (vw-pt-request-arm R03/E03/P03). G-f / G-i are NOT dispositioned: they belong to lane PT-GAPS.
        "a stamped ?: inside a multi-state recurrence (accum2-accum4)": "engine-gap", "L2": "withheld-ledger"},
    "capture-queue-2026-10-31-wse": {"Q-WSE5": "builtin"},
    # PR #937 (reviewed): a measure-pair of our own two doors, not a TradingView reading.
    "capture-queue-2026-11-06-w6-t6": {"object door": "engine-gap"},
    # 2026-11-08 capture-queue hygiene (fix/pine-capture-queue-hygiene): S1's rows the W9 design re-specifies with
    # generated w9-* probes under the same row id. NOT here (review r1, dsk/reviews/QUEUE-HYGIENE.md): Q-S1d, Q-S1e,
    # Q-S1g, Q-S1h, Q-S1j, Q-S1k, whose S1 shapes reach refusals or served cases no W9 probe reaches.
    "capture-queue-2026-10-05-s1": {r: "superseded" for r in (
        "Q-S1a", "Q-S1b", "Q-S1c", "Q-S1f", "Q-S1i", "Q-S1l", "Q-S1m", "Q-S1o", "Q-S1p")},
    # the `varip` twins of W9-P1b / W9-P2 (rule 11 refuses `varip` in broker mode); the -nv probes replace them
    "capture-queue-2026-11-05-w9": {"W9-P1b varip": "superseded", "W9-P2 varip": "superseded"},
    # CBC-FMT (fix/pine-engine-calcbars-format): the questions capture session S10 answered, closed with the capture
    # that answered each (the doc's own `not a capture` table)
    "capture-queue-2026-11-15-calc-bars": {r: "closed" for r in ("Q-CBC1", "Q-CBC3", "Q-CBC4", "Q-CBC5", "Q-FMT1")},
    # door robustness (#1448) and the per-bar lane's mtf-key-levels defects (fix/pine-runtime-mtf-key-levels): the
    # captures exist; Q-ROB5 was fixed and its capture witnesses it, Q-ROB6 / Q-ROB7 need builds (a 12M request)
    "capture-queue-2026-11-16-door-robustness": {"Q-ROB5": "closed", "Q-ROB6": "engine-gap", "Q-ROB7": "engine-gap"},
    # #1447 (REQ request.security, engine 64): a lower-timeframe read's data and symbols we do not hold are rulings
    "capture-queue-2026-11-16-request-security": {"Q-REQ-LTF": "ruling", "Q-REQ-DATA": "ruling"},
    # #1450 (runtime history, engine 64): three rows another queue row's capture already asks, three builds
    "capture-queue-2026-11-16-runtime-history": {
        "a ta. on the right of a v6 and / or (7 sample scripts)": "superseded",
        "a window length that divides inexactly (len / 3, 6 sample sc": "superseded",
        "history in a for / while body (ta.sma(x[i], 50) per pass)": "superseded",
        "a branch of a function body decided by a parameter the call ": "engine-gap",
        "a block local's or a drawing handle's [1] in the DRAWING bui": "engine-gap",
        "a helper parameter that bounds an offset (for i = 1 to lengt": "engine-gap"},
    # bt (feat/pine-coverage-builtins-time): Q-BT1/4/5 closed by the captures that answered them, the v4+ bare
    # `period` closed by TradingView's compiler reading; the rest are the unit's still-refused shapes, each with
    # its reason and what would settle it in the doc
    "capture-queue-2026-11-16-bt-builtins-time": {
        "Q-BT1": "closed", "Q-BT4": "closed", "Q-BT5": "closed", "bare period from v4 on": "closed",
        "visible bar times": "by-design", "theme colours read as a value": "engine-gap",
        "v1-v3 sessions with no day list": "engine-gap", "symbol fields not held": "engine-gap",
        "sar, dmi, kc with a computed flag": "engine-gap", "legacy correlation over runtime state": "engine-gap"},
    # 2026-11-16 (coordinator ruling on #1472): the `sar()` expansion's 200-bar window does not converge on
    # vw-lower-tf-bars-rddt-15-2026-11-16; the capture is in the harness, the fix is a build that flips the KNOWN
    # `it.fails` in sar.test.js (its control pins 43 bars / 5167-5246 / 17 by name)
    # CLOSED the same day by fix/pine-sar-warmup (SAR_WARMUP 200 -> 400, measured; the it.fails is an it), which
    # added the load-time rewrite of a formula document's stored 200-bar SAR tree as an engine gap
    "capture-queue-2026-11-16-sar-window": {"sar() window": "closed", "sar() saved-tree upgrade": "engine-gap"},
    # #1550 (fix/chart-markers-scale-and-na-breaks, coordinator ruling 2026-11-17): an above / below shape in a
    # separate pane brings the bar PRICE into the scale on TradingView (User Manual), a documented deviation for
    # Pine imports, not fixed now; plot.style_steplinebr stays not carried and disclosed (spec U8)
    "capture-queue-2026-11-17-markers-na-breaks": {
        "abovebar / belowbar in a separate pane": "engine-gap", "plot.style_steplinebr": "ruling"},
    # 2026-11-17 (owner decision; feat/pine-host-known-divergence): ONE engine-gap row per script with a committed
    # production DIVERGE capture (listed, or withheld by name and not listed: coordinator ruling on #1541), generated
    # with the list (`tools/vendor_harness/host_divergence.py --write`) and read off its derivation here.
    # ⭐ (engine 89 train, coordinator ruling 2026-11-20) ONE reviewed exception: master #2117 (8028b0f356) made
    # htf-candle-footprint-cartel-console's row a disclosed partial (`withheld-ledger`: its drawn objects agree with
    # TradingView's on every field held, their place (x) unwitnessed; a re-capture WITH the x table is its own row).
    # This list was never moved with it, so the test was red on master. Named here, never derived: a NEW
    # `withheld-ledger` row must be reviewed into this list too.
    "capture-queue-2026-11-17-host-known-divergence": {
        **{__import__("host_divergence").queue_row_id(e["slug"]): "engine-gap"
           for e in __import__("host_divergence").derive_all().values()},
        "hkd:htf-candle-footprint-cartel-console": "withheld-ledger"},
    # 2026-11-17 (coordinator ruling on #1541): the SPX history our server serves (FMP ^GSPC) against TradingView's
    # SP:SPX, found by the supply-attributed grade of RS Rating NVDA; a data-source decision
    "capture-queue-2026-11-17-fmp-gspc-history": {"fmp-gspc-history": "ruling"},
    # 2026-11-17 (41da42cecd / d276b0482e, label and box text geometry): each question was read on TradingView and
    # applied (runs lb1rddt2, lb2b / lb2c, lb3), so the doc's own `not a capture` table closes all three
    "capture-queue-2026-11-17-label-multiline": {"Q-LB1": "closed", "Q-LB2": "closed", "Q-LB3": "closed"},
    # 2026-11-17 (d49d6ab6c9 / 5f19bf9415, strategy-decl): the daily chart's ISO bar dates in the broker is a build
    # (engine-gap); TradingView's built-in strategies are a second, uncommittable script (builtin), as the doc states
    "capture-queue-2026-11-17-strategy-decl": {"strategy run bar dates": "engine-gap", "built-in strategies": "builtin"},
    # 2026-11-18 (coordinator ruling, parity2 BI1'): TradingView's own `ta.sar` is graded on the built-in Parabolic SAR
    # taken from the listing; no probe file stands in for a built-in
    "capture-queue-2026-11-18-parity2": {"Q-BLT-3a": "builtin", "Q-BLT-3b": "builtin"},
    # 2026-11-19 (the strategy unit, PR #2141): seven TradingView built-in strategies, each taken from the listing by the
    # capture session (section D); no probe file stands in for a built-in
    "capture-queue-2026-11-19-strategy-unit": {f"Q-SU-B{i}": "builtin" for i in range(1, 8)},
    # 2026-11-19 (the request unit, #2154; engine 89 train, coordinator ruling 2026-11-20): the rest of the unit's
    # sole scripts wait on OWNER data decisions (lower-timeframe reads on a daily chart, data the platform does not
    # hold), refused by name; a decision, not a capture or engine work
    "capture-queue-2026-11-19-request-unit": {"Q-REQ-OWNER": "ruling"},
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
    # the real capture questions beside them stay queued as needing a probe (G-f / G-i are queued as captures
    # by PT-GAPS; L2 left this list in PR #937, its capture already queued as vw-pt-request-arm)
    q = ee.build_queue()          # derived; the snapshot is a local view since 2026-11-16, never committed
    needing = {r["key"] for r in q["rowsNeedingProbe"]}
    # the S1 shapes no W9 probe asks (their table's chart, NYSE:RDDT 1D, is stated in the section lead) were
    # CAPTURED 2026-11-16 (capture batch 1) as value witnesses, taken in session without the Strategy Tester
    # report, so not pinnable; the after-close re-take with the report replaces them as pin evidence
    by = {t["id"]: t["status"] for t in q["targets"]}
    for stem in ("vw-s1-q-s1d-close-reverse", "vw-s1-q-s1d-two-entries", "vw-s1-q-s1d-two-stops",
                 "vw-s1-q-s1k-fractional-profit", "vw-s1-q-s1k-na-modify", "vw-s1-q-s1k-profit-and-limit",
                 "vw-s1-q-s1e-stop-past", "vw-s1-q-s1g-blocked-stop-entry", "vw-s1-q-s1h-fifo-exit", "vw-s1-q-s1j-stop-limit"):
        assert by.get(f"{stem}@NYSE:RDDT@D") == "CAPTURED", stem
    assert not any(t.startswith(("vw-s1-q-s1a-", "vw-s1-q-s1b-", "vw-s1-core-")) for t in by)
    # both -nv probes were captured on 2026-11-15 (#1370, the U14 strategy captures): no longer QUEUED
    assert by["w9-p1b-on-close-fills-nv@NYSE:RDDT@D"] == by["w9-p2-order-fills-nv@NYSE:RDDT@D"] == "CAPTURED"
    assert not any(t.startswith(("w9-p1b-on-close-fills@", "w9-p2-order-fills@")) for t in by)
    for rid in ("G-f", "G-i"):
        assert f"capture-queue-2026-10-31-prod-ternary#{rid}" in needing


# ── the snapshot is a LOCAL VIEW (2026-11-16): derived on demand, never committed ─────────────
# ⚰️ capture-queue.json was committed, and every PR that touched a queue input rewrote it: on 2026-11-16 it
# was the conflicting file in 5 of the 5 open Pine PRs GitHub could not merge, each conflict costing a merge of
# master, a regenerate commit and a full pine-heavy re-run. `queue --check` now refuses a tracked snapshot.

def test_the_queue_snapshot_is_not_committed_and_git_ignores_it():
    assert ee.snapshot_tracked(ee.QUEUE_OUT) is False, "capture-queue.json is tracked again: git rm --cached it"
    # control: the same question about a file that IS committed answers yes (the helper cannot only say no)
    assert ee.snapshot_tracked(ee.COVERAGE) is True
    ignore = (REPO / ".gitignore").read_text(encoding="utf-8").splitlines()
    assert ee.rel(ee.QUEUE_OUT) in [l.strip() for l in ignore]


@pytest.mark.parametrize("tracked,code,word", [(False, 0, "PASS"), (True, 1, "FAIL"), (None, 2, "INCONCLUSIVE")])
def test_queue_check_passes_only_when_no_snapshot_is_tracked(monkeypatch, capsys, tracked, code, word):
    monkeypatch.setattr(ee, "snapshot_tracked", lambda _path: tracked)
    assert ee.main(["queue", "--check"]) == code
    assert f"VERDICT: {word}" in capsys.readouterr().out


def test_queue_check_writes_nothing(monkeypatch, tmp_path):
    out = tmp_path / "q.json"
    monkeypatch.setattr(ee, "snapshot_tracked", lambda _path: False)
    assert ee.main(["queue", "--check", "--out", str(out)]) == 0 and not out.exists()
    assert ee.main(["queue", "--out", str(out)]) == 0
    assert json.loads(out.read_text(encoding="utf-8"))["schema"] == ee.QUEUE_SCHEMA
