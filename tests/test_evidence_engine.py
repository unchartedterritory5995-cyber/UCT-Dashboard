"""Rails for the evidence engine (`tools/vendor_harness/evidence_engine.py`).

Run ONLY this file:  python -m pytest tests/test_evidence_engine.py -q

Offline: no TradingView, no network. A small synthetic world (queue doc, probes,
corpus file, fixtures, census) pins the parsing, status, priority, manifest,
licence gate, packet checkpoint and ledger filing; the driver's per-script chart
runs against the recording double (`batch_double.py`). One rail parses every
committed queue doc so a doc nobody can parse is loud.
"""
from __future__ import annotations

import hashlib
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
GAMMA = "// This source code is subject to the terms of the Mozilla Public License 2.0 at https://mozilla.org/MPL/2.0/\n" \
        'indicator("Gamma")\nplot(high)\n'

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

### 2. `bravo.pine` across versions

| # | capture |
|---|---|
| B1 | line 1 `//@version=4` -> the v4 sibling |

| capture | settled |
|---|---|
| `alpha-rddt-1d-2026-10-01` | already settled |
"""


def _sha(t: str) -> str:
    return hashlib.sha256(t.encode("utf-8")).hexdigest()


def _fixture(path: pathlib.Path, cid: str, text: str, symbol="NYSE:RDDT", tf="D"):
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
    (docs / "capture-queue-2026-11-02-test.md").write_text(DOC, encoding="utf-8")
    (probes / "alpha.pine").write_text(ALPHA, encoding="utf-8", newline="")
    (probes / "bravo.pine").write_text(BRAVO, encoding="utf-8", newline="")
    (probes / "bravo-v4.pine").write_text(BRAVO_V4, encoding="utf-8", newline="")
    (corpus / "gamma__abcdef1234.pine").write_text(GAMMA, encoding="utf-8", newline="")
    _fixture(fixtures / "alpha-rddt-1d-2026-10-01.json", "alpha-rddt-1d-2026-10-01", ALPHA)
    # a fixture of an OLDER bravo on SPY 15: the probe changed since
    _fixture(fixtures / "bravo-spy-15-2026-10-01.json", "bravo-spy-15-2026-10-01", "old bravo", "AMEX:SPY", "15")
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


# ── Q: parsing ───────────────────────────────────────────────────────────────
def test_a_row_names_its_probe_and_every_chart_it_asks_for(world):
    t = _by_id(ee.build_queue(world))
    assert {"bravo@NYSE:RDDT@D", "bravo@AMEX:SPY@15"} <= set(t)
    assert t["bravo@NYSE:RDDT@D"]["fromListing"] is True
    assert t["bravo@NYSE:RDDT@D"]["rows"] == ["capture-queue-2026-11-02-test#Q1"]


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
    q = ee.build_queue(world)
    assert q["docs"][0]["contextTables"] == 1


def test_a_live_row_is_needs_live_and_never_reaches_a_manifest(world):
    q = ee.build_queue(world)
    live = [x for x in q["targets"] if "capture-queue-2026-11-02-test#Q4" in x["rows"]]
    assert live and all(x["status"] == "NEEDS_LIVE" for x in live)
    man = ee.build_manifest(q, top=None, statuses=("QUEUED",), include_stale=True)
    assert not any("capture-queue-2026-11-02-test#Q4" in s["rows"] for s in man["scripts"])


# ── status, from disk ────────────────────────────────────────────────────────
def test_status_is_derived_from_fixtures_captured_and_stale(world):
    t = _by_id(ee.build_queue(world))
    # alpha@RDDT 1D: the preamble's probe on the preamble's chart, already captured with this exact sha
    assert t["alpha@NYSE:RDDT@D"]["status"] == "CAPTURED"
    assert t["bravo@AMEX:SPY@15"]["status"] == "STALE"
    assert t["bravo@NYSE:RDDT@D"]["status"] == "QUEUED"


def test_a_licence_held_verdict_in_the_ledger_closes_its_target(world):
    sha = _sha(BRAVO)
    world.ledger_path.write_text(json.dumps({"sourceSha256": sha, "symbol": "NYSE:RDDT", "timeframe": "D",
                                             "verdict": "MATCH", "captureId": "bravo-rddt-1d-2026-11-02"}) + "\n",
                                 encoding="utf-8")
    world._ledger = None
    assert _by_id(ee.build_queue(world))["bravo@NYSE:RDDT@D"]["status"] == "VERDICT_LOCAL"


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


def test_the_census_pool_holds_builtins_out_of_git(world):
    q = ee.build_queue(world)
    assert [h["key"] for h in q["licenceHeldCensus"]] == ["builtin:rsi__RSI"]
    assert not any(t["id"].startswith("done__") for t in q["targets"])   # MATCHed already


# ── M: manifest ──────────────────────────────────────────────────────────────
def test_the_manifest_carries_each_targets_own_chart_in_priority_order(world, monkeypatch):
    monkeypatch.setattr(ee, "REPO", world.docs_dir.parent)
    q = ee.build_queue(world)
    man = ee.build_manifest(q, top=None)
    assert man["schema"] == "uct.vendor-batch-manifest/v1"
    assert man["derivation"]["doorFlag"]["state"] in ("on", "off")
    slugs = [s["slug"] for s in man["scripts"]]
    assert len(slugs) == len(set(slugs))
    by = {s["queueTargetId"]: s for s in man["scripts"]}
    assert "alpha@NYSE:RDDT@D" not in by and "bravo@AMEX:SPY@15" not in by   # captured / stale
    b = by["bravo@NYSE:RDDT@D"]
    assert (b["symbol"], b["tf"], b["captureStem"], b["listingDate"]) == ("NYSE:RDDT", "1D", "bravo", "2024-03-21")
    assert [s["priority"] for s in man["scripts"]] == sorted((s["priority"] for s in man["scripts"]), reverse=True)


# ── the driver honours the per-script chart (recording double) ───────────────
@pytest.mark.skipif(shutil.which("node") is None, reason="node is required for verify_capture.mjs")
def test_the_driver_sets_each_scripts_own_symbol_and_tf_and_files_provenance(tmp_path):
    import batch_double as bd
    manifest, beh = bd.make_manifest(tmp_path, [("one", 'indicator("One")\nplot(close)\n', {})])
    manifest["scripts"][0].update(symbol="AMEX:SPY", tf="15", captureStem="stemx", queueTargetId="t1", rows=["r1"])
    page = bd.RecordingTVPage(behaviours={sha: b for sha, b in beh.values()})
    code, rd, _ = bd.run(page, manifest, tmp_path / "run", bd.fast_opts())
    r = rd.results()["one"]
    assert r["outcome"] == "CAPTURED", r.get("reason")
    sets = [a for k, n, a in page.calls if n == "SET_SYMBOL"]
    assert sets and sets[0] == "AMEX:SPY"
    assert [a for k, n, a in page.calls if n == "SET_RESOLUTION"][0] == "15"
    assert r["captureId"].startswith("stemx-spy-15-")
    pv = r["provenance"]
    assert pv["account"] == hashlib.sha256(b"rig-test-user").hexdigest()[:12]
    assert pv["queueTargetId"] == "t1" and pv["symbol"] == "AMEX:SPY" and "rig-test-user" not in json.dumps(pv)


def test_the_throttle_floor_refuses_before_any_browser(monkeypatch):
    import batch_capture as bc
    launched = []
    monkeypatch.setattr(bc, "_launch", lambda args, body: launched.append(args) or 99)
    assert bc.main(["run", "--throttle-s", "5"]) == 2 and not launched
    assert ee.main(["batch", "--throttle-s", "5", "--top", "1"]) == 2


# ── V/P/F: gate, packet, promote ─────────────────────────────────────────────
class OkVerifier:
    def verify_file(self, path):
        return {"ok": True, "verdict": "VERDICT: PASS", "tail": "", "exit": 0}


def _run_dir(tmp_path, world, items):
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
        scripts.append({"slug": slug, "queueTargetId": f"{slug}@NYSE:RDDT@D", "rows": ["d#Q1"]})
        verdicts.append({"id": cid, "verdict": "MATCH", "reason": "ok", "plots": []})
    (rd / "manifest.json").write_text(json.dumps({"scripts": scripts}), encoding="utf-8")
    (rd / "verdicts.json").write_text(json.dumps({"results": verdicts}), encoding="utf-8")
    return rd


def test_the_licence_gate_admits_probes_corpus_and_permitted_headers_only(tmp_path, world):
    fx = tmp_path / "fixtures"
    rd = _run_dir(tmp_path, world, [("alpha-rddt-1d-2026-11-02", ALPHA), ("gamma-rddt-1d-2026-11-02", GAMMA),
                                     ("mystery-rddt-1d-2026-11-02", 'indicator("M")\nplot(low)\n'),
                                     ("permit-rddt-1d-2026-11-02", "// SPDX-License-Identifier: MIT\n" + BRAVO)])
    body = ee.build_packet(rd, world, OkVerifier(), fx)
    act = {i["id"]: (i["licence"], i["action"]) for i in body["items"]}
    assert act["alpha-rddt-1d-2026-11-02"] == ("probe", "PROMOTE")
    assert act["gamma-rddt-1d-2026-11-02"] == ("corpus", "PROMOTE")
    assert act["mystery-rddt-1d-2026-11-02"] == ("held", "LEDGER_ONLY")


def test_an_existing_fixture_is_never_overwritten_and_a_bad_id_is_refused(tmp_path, world):
    fx = tmp_path / "fixtures"
    rd = _run_dir(tmp_path, world, [("alpha-rddt-1d-2026-10-01", ALPHA)])
    (rd / "captures" / "Bad_Name.json").write_text((rd / "captures" / "alpha-rddt-1d-2026-10-01.json")
                                                   .read_text(encoding="utf-8"), encoding="utf-8")
    body = ee.build_packet(rd, world, OkVerifier(), fx)
    act = {pathlib.Path(i["file"]).name: i for i in body["items"]}
    assert act["alpha-rddt-1d-2026-10-01.json"]["action"] == "REFUSE"
    assert any("never replaced" in p for p in act["alpha-rddt-1d-2026-10-01.json"]["problems"])
    assert any("but the capture id is" in p for p in act["Bad_Name.json"]["problems"])


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
    # the same packet cannot promote twice: the run now differs from what was read
    with pytest.raises(ee.PromoteRefused, match="changed since the packet"):
        ee.promote(rd, sha[:12], **kw)


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


# ── the real docs ────────────────────────────────────────────────────────────
def test_every_committed_queue_doc_parses_and_every_target_resolves_to_its_file():
    q = ee.build_queue()
    assert q["schema"] == ee.QUEUE_SCHEMA and q["docs"]
    assert len(q["docs"]) == len(list((REPO / "docs" / "pine").glob("capture-queue-*.md")))
    for t in q["targets"]:
        p = REPO / t["source"]
        assert p.exists() and hashlib.sha256(p.read_bytes()).hexdigest() == t["sha256"], t["id"]
        assert t["status"] in ("CAPTURED", "VERDICT_LOCAL", "STALE", "QUEUED", "NEEDS_LIVE", "LICENCE_HOLD")
        assert not (t["needsLive"] and t["status"] == "QUEUED"), t["id"]
