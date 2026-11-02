"""Rails for the evidence engine (`tools/vendor_harness/evidence_engine.py`).

Run ONLY this file:  python -m pytest tests/test_evidence_engine.py -q

Offline: no TradingView, no network. A small synthetic world (two queue docs, probes, corpus files,
captures in two directories, a census) pins the parsing, where each chart came from, status,
priority, manifest, capture stem, licence gate, packet checkpoint and ledger filing; the driver's
per-script chart and a corpus target's whole path to a promotable packet run against the recording
double (`batch_double.py`). One rail parses every committed queue doc so a doc nobody can parse is
loud. Every guard's mutation proof: `tools/vendor_harness/evidence_engine_mutations.py`.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import pathlib
import shutil
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools" / "vendor_harness"))
sys.path.insert(0, str(REPO / "tools"))

import evidence_engine as ee  # noqa: E402

ALPHA = 'indicator("Alpha")\nplot(close)\n'
BRAVO = 'indicator("Bravo")\nplot(open)\n'
BRAVO_V4 = '//@version=4\nstudy("Bravo")\nplot(open)\n'
CHARLIE = 'indicator("Charlie")\nplot(low)\n'
DELTA = 'indicator("Delta")\nplot(hl2)\n'
ECHO = 'indicator("Echo")\nplot(hlc3)\n'
FOXTROT = 'indicator("Foxtrot")\nplot(ohlc4)\n'
SHOUT = 'indicator("Shout")\nplot(volume)\n'
GAMMA = "// This source code is subject to the terms of the Mozilla Public License 2.0 at https://mozilla.org/MPL/2.0/\n" \
        'indicator("Gamma")\nplot(high)\n'
DUP_A = '// SPDX-License-Identifier: MIT\nindicator("Dup A")\nplot(close)\n'
DUP_B = '// SPDX-License-Identifier: MIT\nindicator("Dup B")\nplot(open)\n'

DOC = """# Capture queue - 2026-11-02 test

Probe `alpha.pine`, NYSE:RDDT 1D from the listing.

| id | probe | chart | question | scripts it would move |
|---|---|---|---|---|
| Q1 | `bravo.pine` | NYSE:RDDT **1D** from the listing; AMEX:SPY 15 | settles `pine:block` | **3** |
| Q2 | the same file with line 1 `//@version=4` | | a v4 variant with no file | |
| Q3 | probe: `indicator("x")` + `plot(bar_index)` | AMEX:SPY 1D | `runtime:loop` | |
| Q4 | the probe as written | AMEX:SPY 5 during regular hours, newest bar forming | live | |
| Q5 | `corpus/committed/gamma__abcdef1234.pine` | NYSE:RDDT 1D | the corpus file is the probe | |
| Q6 | **no probe** - recorded so nobody queues it | any | | |
| Q7 | `owed-probe.pine` | AMEX:SPY 1D | owed | |
| Q8 | `alpha.pine` | NYSE:RDDT 1D | a control already captured | |
| Q9 | `charlie.pine` | AMEX:SPY 1D | captured long ago, beside the harness directory | |
| Q10 | `delta.pine` | OTC:AITX 1D | a chart this parser cannot read | |

### 2. `bravo.pine` across versions

| # | capture |
|---|---|
| B1 | line 1 `//@version=4` -> the v4 sibling |

| capture | settled |
|---|---|
| `alpha-rddt-1d-2026-09-01` | already settled (no fixture carries this id: only the header makes it context) |

### 3. `echo.pine` on an intraday chart

| id | what | chart |
|---|---|---|
| E1 | the 60m leg; the old `bravo-spy-15` read 0 on its first loaded bar | AMEX:SPY 60 |

### 4. `alpha.pine` and `bravo.pine` side by side

| id | what | chart |
|---|---|---|
| S1 | which of the two this means is not said | AMEX:SPY 60 |

### 5. Readings already on disk

| probe | capture | note |
|---|---|---|
| `charlie` | `charlie-spy-1d-2026-09-01.json` | the capture beside the harness directory |

## CAPTURED - 2026-10-01

| probe | file | bars |
|---|---|---|
| `bravo` | `bravo-rddt-1d-2026-10-01.json` | 300 |
"""

PROSE_DOC = """# Capture queue - 2026-11-03 prose

Probe `foxtrot.pine`. Its last SPY run read 0 on bar 0 and RDDT agreed: prose about old captures, not a chart.

| id | question |
|---|---|
| P1 | what foxtrot reads on its first bar |
"""

TEST_DOC = "capture-queue-2026-11-02-test.md"


def _sha(t: str) -> str:
    return hashlib.sha256(t.encode("utf-8")).hexdigest()


def _fixture(path: pathlib.Path, cid: str, text: str, symbol="NYSE:RDDT", tf="D"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"schema": "uct.vendor-capture/v1", "id": cid,
                                "symbol": {"name": symbol.split(":")[-1], "pro_name": symbol},
                                "timeframe": tf, "source": {"text": text, "sha256": _sha(text)}}), encoding="utf-8")


@pytest.fixture()
def world(tmp_path):
    docs = tmp_path / "docs"
    probes = tmp_path / "probes"
    corpus = tmp_path / "corpus" / "committed"
    fixtures = tmp_path / "fixtures"
    for d in (docs, probes, corpus, fixtures):
        d.mkdir(parents=True)
    (docs / TEST_DOC).write_text(DOC, encoding="utf-8")
    (docs / "capture-queue-2026-11-03-prose.md").write_text(PROSE_DOC, encoding="utf-8")
    for name, text in (("alpha", ALPHA), ("bravo", BRAVO), ("bravo-v4", BRAVO_V4), ("charlie", CHARLIE),
                       ("delta", DELTA), ("echo", ECHO), ("foxtrot", FOXTROT), ("UCT_Shout", SHOUT)):
        (probes / f"{name}.pine").write_text(text, encoding="utf-8", newline="")
    for name, text in (("gamma__abcdef1234", GAMMA), ("dup__aaaa111111", DUP_A), ("dup__bbbb222222", DUP_B)):
        (corpus / f"{name}.pine").write_text(text, encoding="utf-8", newline="")
    _fixture(fixtures / "alpha-rddt-1d-2026-10-01.json", "alpha-rddt-1d-2026-10-01", ALPHA)
    # a fixture of an OLDER bravo on SPY 15: the probe changed since
    _fixture(fixtures / "bravo-spy-15-2026-10-01.json", "bravo-spy-15-2026-10-01", "old bravo", "AMEX:SPY", "15")
    # a capture committed BESIDE the harness directory, the way the 2026-09-27 wave's are
    _fixture(fixtures / "older" / "charlie-spy-1d-2026-09-01.json", "charlie-spy-1d-2026-09-01", CHARLIE,
             "AMEX:SPY", "D")
    cov = {"measuredOn": "2026-11-02", "scripts": [
        {"key": "committed:s1__aaaaaa1", "walls": ["pine:block"], "firstGuards": ["pine:block"], "stuck": None,
         "clean": False, "vendorVerdict": None},
        {"key": "committed:s2__aaaaaa2", "walls": ["pine:block", "[imperative]"], "firstGuards": [], "stuck": None,
         "clean": False, "vendorVerdict": None},
        {"key": "committed:gamma__abcdef1234", "walls": [], "firstGuards": [], "stuck": None,
         "clean": True, "vendorVerdict": None},
        {"key": "committed:done__bbbbbb1", "walls": [], "firstGuards": [], "stuck": None,
         "clean": True, "vendorVerdict": "MATCH"},
        {"key": "builtin:rsi__RSI", "walls": [], "firstGuards": [], "stuck": None, "clean": True, "vendorVerdict": None},
    ], "runtimeOn": {"walls": {"byScript": {"committed:s2__aaaaaa2": ["runtime:loop"]}}}}
    (tmp_path / "coverage.json").write_text(json.dumps(cov), encoding="utf-8")
    w = ee.World(docs_dir=docs, probe_dirs=[probes], corpus=tmp_path / "corpus", fixtures=fixtures,
                 coverage=tmp_path / "coverage.json", ledger=tmp_path / "ledger.jsonl", cache_dir=tmp_path / "cache")
    return w


def _by_id(q):
    return {t["id"]: t for t in q["targets"]}


def _rows(q):
    return {r["key"].split("#", 1)[1]: r for r in q["rowsNeedingProbe"]}


def _doc_rows(world, doc=TEST_DOC):
    d = ee.parse_doc(world, world.docs_dir / doc)
    return d, {r["key"].split("#", 1)[1]: r for r in d["rows"]}


# ── Q: parsing ───────────────────────────────────────────────────────────────
def test_a_row_names_its_probe_and_every_chart_it_asks_for(world):
    t = _by_id(ee.build_queue(world))
    assert {"bravo@NYSE:RDDT@D", "bravo@AMEX:SPY@15"} <= set(t)
    assert t["bravo@NYSE:RDDT@D"]["fromListing"] is True
    assert t["bravo@NYSE:RDDT@D"]["rows"] == ["capture-queue-2026-11-02-test#Q1"]
    assert t["bravo@NYSE:RDDT@D"]["chartSource"] == "row" and t["bravo@NYSE:RDDT@D"]["chartDefaulted"] is False


def test_a_version_variant_takes_its_sibling_file_or_needs_a_probe(world):
    q = ee.build_queue(world)
    t = _by_id(q)
    assert "bravo-v4@NYSE:RDDT@D" in t           # section inheritance: B1 -> bravo -> bravo-v4
    assert "variant" in _rows(q)["Q2"]["needsProbe"]   # alpha has no -v4 sibling


def test_prose_and_owed_and_no_probe_rows_are_needs_probe_never_a_target(world):
    rows = _rows(ee.build_queue(world))
    assert rows["Q3"]["needsProbe"].startswith("no probe file named")
    assert rows["Q6"]["needsProbe"] == "the row says no probe"
    assert rows["Q7"]["needsProbe"] == "probe file owed: owed-probe.pine"


def test_a_ledger_table_is_counted_as_context_not_queued(world):
    d, rows = _doc_rows(world)
    # the `capture | settled` ledger (its id is on no fixture, so only its header can say so), the
    # CAPTURED section's table and the `capture` column of committed captures
    assert d["contextTables"] == 3
    assert not any("alpha-rddt-1d-2026-09-01" in r["text"] for r in rows.values())


def test_a_live_row_is_needs_live_and_never_reaches_a_manifest(world):
    q = ee.build_queue(world)
    live = [x for x in q["targets"] if "capture-queue-2026-11-02-test#Q4" in x["rows"]]
    assert live and all(x["status"] == "NEEDS_LIVE" for x in live)
    man = ee.build_manifest(q, top=None, statuses=("QUEUED",), include_stale=True, world=world)
    assert not any("capture-queue-2026-11-02-test#Q4" in s["rows"] for s in man["scripts"])


# ── where a chart comes from: the queue never invents one ────────────────────
def test_a_row_with_no_chart_is_needs_chart_and_never_reaches_a_manifest(world):
    q = ee.build_queue(world)
    t = _by_id(q)["foxtrot@NYSE:RDDT@D"]
    assert (t["status"], t["chartDefaulted"], t["chartSource"]) == ("NEEDS_CHART", True, "default")
    # not even a selection that asks for NEEDS_CHART takes a guessed chart
    man = ee.build_manifest(q, top=None, statuses=("QUEUED", "NEEDS_CHART", "LICENCE_HOLD"), include_stale=True,
                            world=world)
    assert man["scripts"] and not any(s["queueTargetId"].startswith("foxtrot@") for s in man["scripts"])
    assert all(s["chartDefaulted"] is False for s in man["scripts"])


def test_a_row_naming_a_chart_the_parser_cannot_read_is_needs_chart_not_the_preambles(world):
    t = _by_id(ee.build_queue(world))["delta@NYSE:RDDT@D"]
    assert (t["status"], t["chartSource"], t["unparsedCharts"]) == ("NEEDS_CHART", "default", ["OTC:AITX"])


def test_bare_symbols_in_preamble_prose_are_never_a_chart(world):
    t = _by_id(ee.build_queue(world))
    assert "foxtrot@AMEX:SPY@D" not in t
    assert t["foxtrot@NYSE:RDDT@D"]["chartSource"] == "default"
    assert t["bravo-v4@NYSE:RDDT@D"]["chartSource"] == "preamble"   # an explicit EXCH:SYM there still is one


def test_a_fixture_reference_is_never_a_source_and_the_section_decides(world):
    q = ee.build_queue(world)
    t = _by_id(q)
    # E1 mentions an old `bravo-spy-15` capture: the row runs ITS section's probe, echo
    assert "echo@AMEX:SPY@60" in t and "bravo@AMEX:SPY@60" not in t
    _, rows = _doc_rows(world)
    assert rows["E1"]["fixtureRefs"] == ["bravo"] and rows["E1"]["sourceInherited"] is True
    # a section naming two .pine files is ambiguous: nothing is inherited, the preamble does not speak for it
    assert "alpha@AMEX:SPY@60" not in t and _rows(q)["S1"]["needsProbe"].startswith("no probe file named")


def test_a_finished_capture_table_is_context_not_queue(world):
    _, rows = _doc_rows(world)
    assert "bravo" not in rows             # the table under `## CAPTURED - 2026-10-01`
    assert "charlie" not in rows           # the table whose `capture` column lists committed captures
    t = _by_id(ee.build_queue(world))
    assert "charlie@NYSE:RDDT@D" not in t
    assert t["bravo@NYSE:RDDT@D"]["rows"] == ["capture-queue-2026-11-02-test#Q1"]


# ── status, from disk ────────────────────────────────────────────────────────
def test_status_is_derived_from_fixtures_captured_and_stale(world):
    t = _by_id(ee.build_queue(world))
    # alpha@RDDT 1D: the preamble's probe on the preamble's chart, already captured with this exact sha
    assert t["alpha@NYSE:RDDT@D"]["status"] == "CAPTURED"
    assert t["bravo@AMEX:SPY@15"]["status"] == "STALE"
    assert t["bravo@NYSE:RDDT@D"]["status"] == "QUEUED"


def test_a_capture_beside_the_harness_dir_closes_its_target(world):
    q = ee.build_queue(world)
    t = _by_id(q)["charlie@AMEX:SPY@D"]
    assert t["status"] == "CAPTURED" and "older" in t["evidence"][0] and t["capturedOn"] == ["AMEX:SPY D"]
    man = ee.build_manifest(q, top=None, include_stale=True, world=world)
    assert not any(s["queueTargetId"] == "charlie@AMEX:SPY@D" for s in man["scripts"])


def test_a_licence_held_verdict_in_the_ledger_closes_its_target(world):
    sha = _sha(BRAVO)
    world.ledger_path.write_text(json.dumps({"sourceSha256": sha, "symbol": "NYSE:RDDT", "timeframe": "D",
                                             "verdict": "MATCH", "captureId": "bravo-rddt-1d-2026-11-02"}) + "\n",
                                 encoding="utf-8")
    world._ledger = None
    assert _by_id(ee.build_queue(world))["bravo@NYSE:RDDT@D"]["status"] == "VERDICT_LOCAL"


# ── the capture stem: one authority for the manifest, the stale lookup and the gate ──
def test_the_capture_stem_is_the_house_slug_and_a_shared_slug_takes_the_sha(world):
    probes, corpus = world.probe_dirs[0], world.corpus / "committed"
    assert ee.capture_stem(world, corpus / "gamma__abcdef1234.pine") == "gamma"
    assert ee.capture_stem(world, probes / "UCT_Shout.pine") == "uct-shout"
    assert ee.capture_stem(world, corpus / "dup__aaaa111111.pine") == "dup-" + _sha(DUP_A)[:8]
    assert ee.capture_stem(world, corpus / "dup__bbbb222222.pine") == "dup-" + _sha(DUP_B)[:8]
    for p in list(world.probes.values()) + list(world.corpus_files.values()):
        assert ee.STEM_RX.fullmatch(ee.capture_stem(world, p)), p.name


def test_a_stale_corpus_capture_is_found_by_its_capture_stem(world):
    _fixture(world.fixtures / "gamma-rddt-1d-2026-10-01.json", "gamma-rddt-1d-2026-10-01", "an older gamma")
    world._fixtures = None
    t = _by_id(ee.build_queue(world))["gamma__abcdef1234@NYSE:RDDT@D"]
    assert t["status"] == "STALE" and t["evidence"][0].endswith("gamma-rddt-1d-2026-10-01.json")


# ── priority = scripts unblocked ─────────────────────────────────────────────
def test_priority_counts_firm_named_and_direct_scripts_from_the_census(world):
    t = _by_id(ee.build_queue(world))
    b = t["bravo@NYSE:RDDT@D"]
    assert b["unblocks"]["firm"] == ["committed:s1__aaaaaa1"]   # its only wall is pine:block
    assert b["unblocks"]["upper"] == 2                           # s2 also touches pine:block
    assert b["priority"] == 1 and b["statedUnblocks"] == 3
    g = t["gamma__abcdef1234@NYSE:RDDT@D"]
    assert g["unblocks"]["direct"] == ["committed:gamma__abcdef1234"] and g["priority"] == 1
    assert set(g["origins"]) == {"queue-doc", "census"}         # one target, two reasons
    assert g["chartSource"] == "row" and g["captureStem"] == "gamma"


def test_the_census_pool_holds_builtins_out_of_git(world):
    q = ee.build_queue(world)
    assert [h["key"] for h in q["licenceHeldCensus"]] == ["builtin:rsi__RSI"]
    assert not any(t["id"].startswith("done__") for t in q["targets"])   # MATCHed already


# ── M: manifest ──────────────────────────────────────────────────────────────
def test_the_manifest_carries_each_targets_own_chart_in_priority_order(world, monkeypatch):
    monkeypatch.setattr(ee, "REPO", world.docs_dir.parent)
    q = ee.build_queue(world)
    man = ee.build_manifest(q, top=None, world=world)
    assert man["schema"] == "uct.vendor-batch-manifest/v1"
    assert man["derivation"]["doorFlag"]["state"] in ("on", "off")
    slugs = [s["slug"] for s in man["scripts"]]
    assert len(slugs) == len(set(slugs))
    by = {s["queueTargetId"]: s for s in man["scripts"]}
    assert "alpha@NYSE:RDDT@D" not in by and "bravo@AMEX:SPY@15" not in by   # captured / stale
    b = by["bravo@NYSE:RDDT@D"]
    assert (b["symbol"], b["tf"], b["captureStem"], b["listingDate"]) == ("NYSE:RDDT", "1D", "bravo", "2024-03-21")
    assert (b["chartDefaulted"], b["chartSource"]) == (False, "row")
    assert [s["priority"] for s in man["scripts"]] == sorted((s["priority"] for s in man["scripts"]), reverse=True)


def test_a_queue_older_than_its_file_never_reaches_a_manifest(world):
    q = ee.build_queue(world)
    (world.probe_dirs[0] / "bravo.pine").write_text(BRAVO + "// edited after the queue was built\n",
                                                    encoding="utf-8", newline="")
    man = ee.build_manifest(q, top=None, world=world)
    assert man["scripts"] and not any(s["queueTargetId"].startswith("bravo@") for s in man["scripts"])


# ── the driver honours the per-script chart (recording double) ───────────────
@pytest.mark.skipif(shutil.which("node") is None, reason="node is required for verify_capture.mjs")
def test_the_driver_sets_each_scripts_own_symbol_and_tf_and_files_provenance(tmp_path, monkeypatch):
    import batch_capture as bc
    import batch_double as bd
    salt = "x" * 32
    monkeypatch.setenv(bc.PROVENANCE_SALT_ENV, salt)
    manifest, beh = bd.make_manifest(tmp_path, [("one", 'indicator("One")\nplot(close)\n', {})])
    manifest["scripts"][0].update(symbol="AMEX:SPY", tf="15", captureStem="stemx", queueTargetId="t1", rows=["r1"])
    page = bd.RecordingTVPage(behaviours={sha: b for sha, b in beh.values()})
    code, rd, _ = bd.run(page, manifest, tmp_path / "run", bd.fast_opts())
    r = rd.results()["one"]
    assert r["outcome"] == bc.CAPTURED, r.get("reason")
    sets = [a for k, n, a in page.calls if n == "SET_SYMBOL"]
    assert sets and sets[0] == "AMEX:SPY"
    assert [a for k, n, a in page.calls if n == "SET_RESOLUTION"][0] == "15"
    assert r["captureId"].startswith("stemx-spy-15-")
    # RDDT's listing day (the batch default) is never carried over to another symbol
    assert r["history"]["startsAtBar0"] is False and "no listing date" in r["history"]["why"]
    pv = r["provenance"]
    assert pv["account"] == hmac.new(salt.encode("utf-8"), b"rig-test-user", hashlib.sha256).hexdigest()[:12]
    assert pv["queueTargetId"] == "t1" and pv["symbol"] == "AMEX:SPY" and "rig-test-user" not in json.dumps(pv)


def test_the_account_fingerprint_is_salted_or_not_recorded(monkeypatch):
    import batch_capture as bc
    import batch_double as bd
    page = bd.RecordingTVPage()
    salt = "s" * 24
    monkeypatch.setenv(bc.PROVENANCE_SALT_ENV, salt)
    fp = bc.account_fingerprint(page)
    assert fp == hmac.new(salt.encode("utf-8"), b"rig-test-user", hashlib.sha256).hexdigest()[:12]
    assert fp != hashlib.sha256(b"rig-test-user").hexdigest()[:12]      # never the bare, look-up-able hash
    page.account = None
    assert bc.account_fingerprint(page) == "unread"
    page.account = "rig-test-user"
    page.calls.clear()
    for weak in ("short-salt", ""):                                     # too short to be a secret, or unset
        monkeypatch.setenv(bc.PROVENANCE_SALT_ENV, weak)
        assert bc.account_fingerprint(page) == "no-salt"
    monkeypatch.delenv(bc.PROVENANCE_SALT_ENV)
    assert bc.account_fingerprint(page) == "no-salt"
    assert "ACCOUNT" not in page.names()                                # with no salt the page is not even asked


def test_the_throttle_floor_refuses_before_any_browser(monkeypatch, tmp_path):
    import batch_capture as bc
    launched = []
    monkeypatch.setattr(bc, "_launch", lambda args, body: launched.append(args) or 99)
    monkeypatch.setattr(ee, "build_queue", lambda *a, **k: pytest.fail("the batch read the queue before refusing"))
    monkeypatch.setattr(ee.subprocess, "call", lambda *a, **k: pytest.fail("the batch launched a process"))
    lock = tmp_path / "heavy_lock.py"
    lock.write_text("# a stand-in lock tool\n", encoding="utf-8")
    monkeypatch.setenv("HEAVY_LOCK", str(lock))          # so the pacing is the only thing that can refuse
    for bad in ("5", "nan", "inf"):
        assert bc.main(["run", "--throttle-s", bad, "--run-dir", str(tmp_path / "run"),
                        "--profile", str(tmp_path / "profile")]) == 2, bad
        assert ee.main(["batch", "--throttle-s", bad, "--top", "1"]) == 2, bad
    assert not launched
    assert bc.throttle_refusal(10) is None and bc.throttle_refusal("30") is None


def test_grade_runs_only_under_the_heavy_lock_named_by_HEAVY_LOCK(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(ee.subprocess, "call", lambda cmd, **k: calls.append(cmd) or 0)
    lock = tmp_path / "heavy_lock.py"
    lock.write_text("# a stand-in lock tool\n", encoding="utf-8")
    monkeypatch.setenv("HEAVY_LOCK", str(lock))
    assert ee.main(["grade", "--run-dir", str(tmp_path / "run")]) == 0
    assert calls and calls[0][:3] == [sys.executable, str(lock), "run"] and "evidence-grade" in calls[0]
    calls.clear()
    monkeypatch.setenv("HEAVY_LOCK", str(tmp_path / "absent.py"))
    monkeypatch.setattr(ee, "DESKTOP_HEAVY_LOCK", str(tmp_path / "also-absent.py"))
    assert ee.main(["grade", "--run-dir", str(tmp_path / "run")]) == 2 and not calls      # never unlocked
    monkeypatch.setattr(ee, "build_queue", lambda *a, **k: pytest.fail("the batch read the queue before refusing"))
    assert ee.main(["batch", "--top", "1"]) == 2 and not calls                            # nor the owner's batch


# ── V/P/F: gate, packet, promote ─────────────────────────────────────────────
class OkVerifier:
    def verify_file(self, path):
        return {"ok": True, "verdict": "VERDICT: PASS", "tail": "", "exit": 0}


class RefusingVerifier:
    def verify_file(self, path):
        return {"ok": False, "verdict": "VERDICT: FAIL", "tail": "the receipt does not match", "exit": 1}


def _run_dir(tmp_path, world, items, verdict_for=None):
    """items: [(capture id, source text)] -> a run dir with captures, results, manifest, verdicts."""
    rd = tmp_path / "run"
    for sub in ("captures", "results"):
        (rd / sub).mkdir(parents=True, exist_ok=True)
    verdicts, scripts = [], []
    for cid, text in items:
        _fixture(rd / "captures" / f"{cid}.json", cid, text)
        slug = cid.rsplit("-", 5)[0]
        (rd / "results" / f"{slug}.json").write_text(json.dumps({
            "slug": slug, "captureId": cid, "outcome": "CAPTURED",
            "provenance": {"account": "abc123def456", "runId": "r"}}), encoding="utf-8")
        scripts.append({"slug": slug, "queueTargetId": f"{slug}@NYSE:RDDT@D", "rows": ["d#Q1"],
                        "chartDefaulted": False, "chartSource": "row"})
        if verdict_for is None or cid in verdict_for:
            verdicts.append({"id": cid, "verdict": "MATCH", "reason": "ok", "plots": []})
    (rd / "manifest.json").write_text(json.dumps({"scripts": scripts}), encoding="utf-8")
    (rd / "verdicts.json").write_text(json.dumps({"results": verdicts}), encoding="utf-8")
    return rd


def test_the_licence_gate_admits_probes_corpus_and_permitted_headers_only(tmp_path, world):
    fx = tmp_path / "fixtures"
    rd = _run_dir(tmp_path, world, [("alpha-rddt-1d-2026-11-02", ALPHA), ("gamma-rddt-1d-2026-11-02", GAMMA),
                                     ("mystery-rddt-1d-2026-11-02", 'indicator("M")\nplot(low)\n'),
                                     ("permit-rddt-1d-2026-11-02", "// Released under the MIT License\n" + BRAVO)])
    body = ee.build_packet(rd, world, OkVerifier(), fx)
    act = {i["id"]: (i["licence"], i["action"]) for i in body["items"]}
    assert act["alpha-rddt-1d-2026-11-02"] == ("probe", "PROMOTE")
    assert act["gamma-rddt-1d-2026-11-02"] == ("corpus", "PROMOTE")
    assert act["mystery-rddt-1d-2026-11-02"] == ("held", "LEDGER_ONLY")
    assert act["permit-rddt-1d-2026-11-02"] == ("permitted", "PROMOTE")
    assert all(i["chartDefaulted"] is False for i in body["items"])     # carried from the run's manifest


def test_an_existing_fixture_is_never_overwritten_and_a_misnamed_file_is_refused(tmp_path, world):
    fx = tmp_path / "fixtures"
    rd = _run_dir(tmp_path, world, [("alpha-rddt-1d-2026-10-01", ALPHA), ("charlie-spy-1d-2026-09-01", CHARLIE)])
    (rd / "captures" / "Bad_Name.json").write_text((rd / "captures" / "alpha-rddt-1d-2026-10-01.json")
                                                   .read_text(encoding="utf-8"), encoding="utf-8")
    body = ee.build_packet(rd, world, OkVerifier(), fx)
    act = {pathlib.Path(i["file"]).name: i for i in body["items"]}
    assert act["alpha-rddt-1d-2026-10-01.json"]["action"] == "REFUSE"
    assert any("never replaced" in p for p in act["alpha-rddt-1d-2026-10-01.json"]["problems"])
    # an id already committed in ANOTHER directory of the fixture tree is never filed a second time
    assert act["charlie-spy-1d-2026-09-01.json"]["action"] == "REFUSE"
    assert any("never replaced" in p for p in act["charlie-spy-1d-2026-09-01.json"]["problems"])
    assert any("but the capture id is" in p for p in act["Bad_Name.json"]["problems"])


def test_a_capture_id_off_the_house_form_or_off_its_capture_stem_is_refused(tmp_path, world):
    rd = _run_dir(tmp_path, world, [("Mystery_RDDT-1d-2026-11-02", 'indicator("M")\nplot(low)\n'),
                                     ("gamma__abcdef1234-rddt-1d-2026-11-02", GAMMA),
                                     ("gamma-rddt-1d-2026-11-02", GAMMA)])
    by = {i["id"]: i for i in ee.build_packet(rd, world, OkVerifier(), tmp_path / "fixtures")["items"]}
    bad = by["Mystery_RDDT-1d-2026-11-02"]
    assert bad["action"] == "REFUSE" and any("<script>-<sym>-<tf>-<yyyy-mm-dd>" in p for p in bad["problems"])
    raw = by["gamma__abcdef1234-rddt-1d-2026-11-02"]
    assert raw["action"] == "REFUSE" and any("capture stem of its source" in p for p in raw["problems"])
    assert by["gamma-rddt-1d-2026-11-02"]["action"] == "PROMOTE"       # control: the stem the manifest asks for


def test_a_capture_verify_capture_refuses_is_refused(tmp_path, world):
    rd = _run_dir(tmp_path, world, [("alpha-rddt-1d-2026-11-02", ALPHA)])
    (item,) = ee.build_packet(rd, world, RefusingVerifier(), tmp_path / "fixtures")["items"]
    assert item["action"] == "REFUSE" and any("verify_capture.mjs refused it" in p for p in item["problems"])


def test_a_capture_with_no_verdict_is_refused_and_promote_files_nothing_for_it(tmp_path, world):
    fx = tmp_path / "fixtures"
    ledger = tmp_path / "l.jsonl"
    rd = _run_dir(tmp_path, world, [("alpha-rddt-1d-2026-11-02", ALPHA), ("echo-rddt-1d-2026-11-02", ECHO)],
                  verdict_for={"alpha-rddt-1d-2026-11-02"})
    body = ee.build_packet(rd, world, OkVerifier(), fx)
    act = {i["id"]: i for i in body["items"]}
    assert act["echo-rddt-1d-2026-11-02"]["action"] == "REFUSE"
    assert any("no verdict" in p for p in act["echo-rddt-1d-2026-11-02"]["problems"])
    sha = ee.write_packet(rd, body)
    out = ee.promote(rd, sha[:12], world=world, verifier=OkVerifier(), fixtures_dir=fx, ledger=ledger,
                     log=lambda *a: None)
    assert out["refused"] == ["echo-rddt-1d-2026-11-02"] and out["promoted"] == ["alpha-rddt-1d-2026-11-02"]
    assert not (fx / "echo-rddt-1d-2026-11-02.json").exists()
    assert [json.loads(x)["captureId"] for x in ledger.read_text(encoding="utf-8").splitlines()] == \
        ["alpha-rddt-1d-2026-11-02"]


def test_promote_needs_the_packet_sha_and_files_every_verdict(tmp_path, world):
    fx = tmp_path / "fixtures"
    ledger = tmp_path / "evidence-ledger.jsonl"
    rd = _run_dir(tmp_path, world, [("alpha-rddt-1d-2026-11-02", ALPHA),
                                     ("mystery-rddt-1d-2026-11-02", 'indicator("M")\nplot(low)\n')])
    sha = ee.write_packet(rd, ee.build_packet(rd, world, OkVerifier(), fx))
    kw = dict(world=world, verifier=OkVerifier(), fixtures_dir=fx, ledger=ledger, log=lambda *a: None)
    with pytest.raises(ee.PromoteRefused, match="different packet"):
        ee.promote(rd, "0" * 12, **kw)
    out = ee.promote(rd, sha[:12], **kw)
    assert out["promoted"] == ["alpha-rddt-1d-2026-11-02"] and out["ledgerOnly"] == ["mystery-rddt-1d-2026-11-02"]
    assert (fx / "alpha-rddt-1d-2026-11-02.json").exists() and not (fx / "mystery-rddt-1d-2026-11-02.json").exists()
    rows = [json.loads(x) for x in ledger.read_text(encoding="utf-8").splitlines()]
    assert {r["captureId"]: r["promoted"] for r in rows} == {"alpha-rddt-1d-2026-11-02": True,
                                                              "mystery-rddt-1d-2026-11-02": False}
    assert all(r["provenance"]["account"] == "abc123def456" and r["packetSha256"] == sha for r in rows)
    assert all(r["chartDefaulted"] is False for r in rows)
    # the same packet cannot promote twice: the run now differs from what was read
    with pytest.raises(ee.PromoteRefused, match="changed since the packet"):
        ee.promote(rd, sha[:12], **kw)


def test_promote_refuses_a_missing_or_short_packet_sha_and_a_missing_packet(tmp_path, world):
    fx = tmp_path / "fixtures"
    rd = _run_dir(tmp_path, world, [("alpha-rddt-1d-2026-11-02", ALPHA)])
    kw = dict(world=world, verifier=OkVerifier(), fixtures_dir=fx, ledger=tmp_path / "l.jsonl", log=lambda *a: None)
    with pytest.raises(ee.PromoteRefused, match="no packet"):
        ee.promote(rd, "a" * 12, **kw)
    sha = ee.write_packet(rd, ee.build_packet(rd, world, OkVerifier(), fx))
    for bad in ("", sha[:11], sha[:12].upper()):
        with pytest.raises(ee.PromoteRefused, match="at least the first 12 hex"):
            ee.promote(rd, bad, **kw)
    assert not (fx / "alpha-rddt-1d-2026-11-02.json").exists()


def test_promote_never_overwrites_a_fixture_that_appeared_after_the_check(tmp_path, world, monkeypatch):
    fx = tmp_path / "fixtures"
    rd = _run_dir(tmp_path, world, [("alpha-rddt-1d-2026-11-02", ALPHA)])
    body = ee.build_packet(rd, world, OkVerifier(), fx)
    sha = ee.write_packet(rd, body)
    monkeypatch.setattr(ee, "build_packet", lambda *a, **k: body)     # the race: the rebuild saw no fixture yet
    (fx / "alpha-rddt-1d-2026-11-02.json").write_text("someone else's capture", encoding="utf-8")
    out = ee.promote(rd, sha[:12], world=world, verifier=OkVerifier(), fixtures_dir=fx,
                     ledger=tmp_path / "l.jsonl", log=lambda *a: None)
    assert out["refused"] == ["alpha-rddt-1d-2026-11-02"] and out["promoted"] == []
    assert (fx / "alpha-rddt-1d-2026-11-02.json").read_text(encoding="utf-8") == "someone else's capture"


def test_the_ledger_files_each_capture_once(tmp_path):
    ledger = tmp_path / "l.jsonl"
    rows = [{"captureId": "a-rddt-1d-2026-11-02", "receipt": 1}, {"captureId": "b-rddt-1d-2026-11-02", "receipt": 2}]
    assert ee.append_ledger(ledger, rows) == 2
    assert ee.append_ledger(ledger, rows) == 0
    assert len(ledger.read_text(encoding="utf-8").splitlines()) == 2


def test_a_run_that_changed_after_the_packet_refuses(tmp_path, world):
    fx = tmp_path / "fixtures"
    rd = _run_dir(tmp_path, world, [("alpha-rddt-1d-2026-11-02", ALPHA)])
    sha = ee.write_packet(rd, ee.build_packet(rd, world, OkVerifier(), fx))
    v = json.loads((rd / "verdicts.json").read_text(encoding="utf-8"))
    v["results"][0]["verdict"] = "DIVERGE"
    (rd / "verdicts.json").write_text(json.dumps(v), encoding="utf-8")
    with pytest.raises(ee.PromoteRefused, match="changed since the packet"):
        ee.promote(rd, sha[:12], world=world, verifier=OkVerifier(), fixtures_dir=fx,
                   ledger=tmp_path / "l.jsonl", log=lambda *a: None)
    assert not (fx / "alpha-rddt-1d-2026-11-02.json").exists()


# ── end to end: a corpus target, manifest -> driver -> packet ────────────────
@pytest.mark.skipif(shutil.which("node") is None, reason="node is required for verify_capture.mjs")
def test_a_corpus_target_runs_from_the_manifest_through_the_driver_to_a_promotable_packet(world, tmp_path,
                                                                                          monkeypatch):
    import batch_capture as bc
    import batch_double as bd
    monkeypatch.setattr(ee, "REPO", tmp_path)
    monkeypatch.setattr(bc, "REPO", tmp_path)
    q = ee.build_queue(world)
    tid = "gamma__abcdef1234@NYSE:RDDT@D"
    assert _by_id(q)[tid]["status"] == "QUEUED"
    man = ee.build_manifest(q, top=None, only={tid}, world=world)
    (s,) = man["scripts"]
    assert (s["captureStem"], s["chartDefaulted"], s["path"]) == ("gamma", False, "corpus/committed/gamma__abcdef1234.pine")
    code, rd, _ = bd.run(bd.RecordingTVPage(), man, tmp_path / "run", bd.fast_opts())
    r = rd.results()[s["slug"]]
    assert r["outcome"] == bc.CAPTURED, r.get("reason")
    run = tmp_path / "run"
    bc.write_json_atomic(run / "manifest.json", man)          # what `batch_capture.py run` keeps in a run dir
    (run / "verdicts.json").write_text(json.dumps({"results": [
        {"id": r["captureId"], "verdict": "MATCH", "reason": "graded", "plots": []}]}), encoding="utf-8")
    (item,) = ee.build_packet(run, world, bc.NodeVerifier(), tmp_path / "fixtures")["items"]
    assert item["id"] == r["captureId"] and item["id"].startswith("gamma-rddt-1d-")
    assert (item["licence"], item["action"], item["problems"]) == ("corpus", "PROMOTE", [])
    assert item["queueTargetId"] == tid and item["chartDefaulted"] is False


# ── the real docs ────────────────────────────────────────────────────────────
def test_every_committed_queue_doc_parses_and_every_target_resolves_to_its_file():
    q = ee.build_queue()
    assert q["schema"] == ee.QUEUE_SCHEMA and q["docs"]
    assert len(q["docs"]) == len(list((REPO / "docs" / "pine").glob("capture-queue-*.md")))
    for t in q["targets"]:
        p = REPO / t["source"]
        assert p.exists() and hashlib.sha256(p.read_bytes()).hexdigest() == t["sha256"], t["id"]
        assert t["status"] in ("CAPTURED", "VERDICT_LOCAL", "STALE", "QUEUED", "NEEDS_LIVE", "NEEDS_CHART",
                               "LICENCE_HOLD")
        assert not (t["needsLive"] and t["status"] == "QUEUED"), t["id"]
        assert not (t["chartDefaulted"] and t["status"] != "NEEDS_CHART"), t["id"]
        assert ee.STEM_RX.fullmatch(t["captureStem"]), t["id"]
