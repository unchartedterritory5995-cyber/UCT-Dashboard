"""LEDGER_ONLY evidence (`tools/vendor_harness/evidence_ledger.py`): licence-held verdicts that count.

The public repo's licence gate keeps a capture of a licence-held script out of git (DECIDED). Its
verdict is filed in `docs/pine/vendor-harness/evidence-ledger.jsonl` with the source sha256, never
the source. These rails hold:
  L1 a ledger row carries no source text (and nothing outside the schema);
  L2 a STALE row (graded at an older SCRIPT_ENGINE_VERSION) is not counted: "unproven (stale)";
  L3 a sha MISMATCH (the sample's source moved) is not counted;
  L4 a FRESH MATCH is counted as proven (the coverage map's verdict and its verified names);
  L5 a DIVERGE row is counted as DIVERGE, never dropped;
  L6 a newer local regrade supersedes an older row;
  L7 the regrade re-grades the out-of-git store in both lanes and files fresh rows;
  L8 capability admission reads the ledger under the same freshness rule (and the registry re-asks it);
  L9 the committed ledger, if any, passes the row check.
The licence gate itself (a held capture never committed) is railed in tests/test_evidence_engine.py.
Mutation-proved: docs/pine/evidence/2026-11-13-evidence-ledger/EVIDENCE.md.
"""
from __future__ import annotations

import collections
import hashlib
import json
import pathlib
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
for p in (REPO / "tools" / "vendor_harness", REPO / "tools", REPO / "tools" / "pine_coverage"):
    sys.path.insert(0, str(p))

import evidence_ledger as el  # noqa: E402
import coverage_map as cm  # noqa: E402
import capability_admission as ca  # noqa: E402

from api.services import rollout_gate as rg  # noqa: E402
from api.services import user_definitions as ud  # noqa: E402

HELD = ("// no licence line at all: reference-only\n//@version=6\nindicator(\"Held Momentum [someone]\")\n"
        "len = input.int(14, \"Length of the momentum window used here\")\nplot(ta.mom(close, len))\n")
OTHER = HELD.replace("14", "21")
ENGINE = 41


def _sha(t):
    return hashlib.sha256(t.encode("utf-8")).hexdigest()


def _capture(cid="held-momentum-rddt-1d-2026-11-13", text=HELD):
    return {"schema": "uct.vendor-capture/v1", "id": cid, "receipt": {"fnv1a": _sha(cid)[:8]},
            "symbol": {"pro_name": "NYSE:RDDT"}, "timeframe": "D", "bars": {"count": 500},
            "source": {"text": text, "sha256": _sha(text), "declaredTitle": "Held Momentum [someone]"},
            "provenance": {"account": "abc123def456"}}


def _row(cid="held-momentum-rddt-1d-2026-11-13", text=HELD, prod="MATCH", rton=None, engine=ENGINE,
         stamp="2026-11-13T00:00:00Z", filed_by="regrade"):
    cap = _capture(cid, text)
    return el.make_row(capture=cap, capture_bytes=json.dumps(cap).encode("utf-8"),
                       verdicts={"production": {"verdict": prod, "reason": "r"} if prod else None,
                                 "runtime-on": {"verdict": rton, "reason": "r"} if rton else None},
                       filed_by=filed_by, licence="held", engine=engine, grader="g" * 12, stamp=stamp)


# ── L1 ──────────────────────────────────────────────────────────────────────────

def test_L1_a_row_carries_no_source_text_no_provenance_and_what_rechecks_it():
    r = _row(rton="DIVERGE")
    blob = json.dumps(r)
    assert HELD not in blob and "ta.mom(close, len)" not in blob and "Length of the momentum" not in blob
    assert "abc123def456" not in blob and "provenance" not in r
    assert r["sourceSha256"] == _sha(HELD) and r["scriptKey"] == "held-momentum"
    assert r["verdicts"] == {"production": {"verdict": "MATCH", "reason": "r"},
                             "runtime-on": {"verdict": "DIVERGE", "reason": "r"}}
    assert r["scriptEngineVersion"] == ENGINE and r["graderVersion"] == "g" * 12
    assert len(r["captureSha256"]) == 64 and r["receipt"] and r["symbol"] == "NYSE:RDDT" and r["timeframe"] == "D"
    assert el.row_problems(r) == []


def test_L1_the_row_check_refuses_source_text_and_unknown_keys():
    r = _row()
    assert el.row_problems(dict(r, source={"text": HELD})) != []                       # a key outside the schema
    leaked = dict(r, verdicts=dict(r["verdicts"], production={"verdict": "MATCH", "reason": HELD.splitlines()[3]}))
    assert any("source text" in p for p in el.row_problems(leaked, source_text=HELD))
    assert any("characters" in p for p in el.row_problems(dict(r, script="x" * 5000)))
    with pytest.raises(ValueError):
        el.append(pathlib.Path("unused.jsonl"), [dict(r, text=HELD)])


# ── L2 / L3 / L4 / L5 / L6: the join ──────────────────────────────────────────────

SAMPLES = {"reference:held-momentum": el.source_shas(HELD), "reference:other": el.source_shas(OTHER)}
SLUGS = {"reference:held-momentum": "held-momentum", "reference:other": "other"}


def test_L4_a_fresh_MATCH_counts():
    out = el.classify([_row()], SAMPLES, engine=ENGINE, lane="production", slug_of=SLUGS)
    assert out["byKey"]["reference:held-momentum"]["verdicts"] == ["MATCH"]
    assert out["counts"]["fresh"] == 1 and out["counts"]["stale"] == 0


def test_L2_a_stale_row_is_not_counted():
    out = el.classify([_row(engine=ENGINE - 1)], SAMPLES, engine=ENGINE, lane="production", slug_of=SLUGS)
    e = out["byKey"]["reference:held-momentum"]
    assert e["verdicts"] == [] and e["stale"] == 1 and out["counts"]["stale"] == 1


def test_L3_a_sha_mismatch_is_not_counted():
    # the row names the script (its script key) but the sample's source has moved since it was graded
    moved = {"reference:held-momentum": el.source_shas(HELD + "// edited\n")}
    out = el.classify([_row()], moved, engine=ENGINE, lane="production", slug_of={"reference:held-momentum": "held-momentum"})
    assert "reference:held-momentum" not in out["byKey"]
    assert out["counts"]["shaMismatch"] == 1 and out["shaMismatch"][0]["samples"] == ["reference:held-momentum"]


def test_L5_a_DIVERGE_row_is_counted_as_DIVERGE():
    out = el.classify([_row(prod="DIVERGE")], SAMPLES, engine=ENGINE, lane="production", slug_of=SLUGS)
    assert out["byKey"]["reference:held-momentum"]["verdicts"] == ["DIVERGE"]


def test_L6_a_newer_regrade_supersedes_an_older_row_both_ways():
    old = _row(engine=ENGINE - 1, stamp="2026-11-01T00:00:00Z")
    new = _row(engine=ENGINE, prod="DIVERGE", stamp="2026-11-13T00:00:00Z")
    out = el.classify([new, old], SAMPLES, engine=ENGINE, lane="production", slug_of=SLUGS)
    assert out["byKey"]["reference:held-momentum"] == {"verdicts": ["DIVERGE"], "stale": 0,
                                                       "captures": ["held-momentum-rddt-1d-2026-11-13"]}
    # and a lane the newer row did not grade is not hidden by it: each lane has its own newest row
    rt_only = _row(prod=None, rton="MATCH", stamp="2026-11-14T00:00:00Z")
    out = el.classify([old, rt_only], SAMPLES, engine=ENGINE, lane="production", slug_of=SLUGS)
    assert out["byKey"]["reference:held-momentum"]["stale"] == 1


def test_a_capture_already_graded_from_a_committed_fixture_is_not_counted_twice():
    out = el.classify([_row()], SAMPLES, engine=ENGINE, lane="production",
                      skip_captures={"held-momentum-rddt-1d-2026-11-13"})
    assert out["byKey"] == {} and out["counts"]["skipped"] == 1


# ── the coverage map: PROVEN-exact only when fresh ───────────────────────────────

def _scripts():
    return [{"key": "reference:held-momentum", "_items": {"ta.mom", "input.int", "plot", "strategy.entry"}},
            {"key": "reference:other", "_items": {"ta.rsi"}}]


def _fold(rows, tmp_path, engine=ENGINE):
    path = tmp_path / "evidence-ledger.jsonl"
    path.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    scripts = _scripts()
    texts = {"reference:held-momentum": HELD, "reference:other": OTHER}
    led = cm.ledger_evidence(str(path), scripts, texts.get, cm.LANE_PRODUCTION, engine)
    cap_rows, verified, diverge = [], collections.Counter(), collections.Counter()
    cm.fold_ledger(scripts, led, cap_rows, verified, diverge)
    return {s["key"]: cm.vendor_verdict_of(s) for s in scripts}, verified, diverge, led


def test_L4_the_coverage_map_counts_a_fresh_ledger_MATCH_as_proven(tmp_path):
    verdicts, verified, diverge, _ = _fold([_row()], tmp_path)
    assert verdicts == {"reference:held-momentum": "MATCH", "reference:other": None}
    assert verified["ta.mom"] == 1 and verified["plot"] == 1
    assert "strategy.entry" not in verified                     # a MATCH says nothing about orders


def test_L2_the_coverage_map_calls_a_stale_ledger_row_unproven_stale(tmp_path):
    verdicts, verified, _, _ = _fold([_row(engine=ENGINE - 1)], tmp_path)
    assert verdicts["reference:held-momentum"] == cm.LEDGER_STALE == "unproven (stale)"
    assert not verified


def test_L5_the_coverage_map_keeps_a_DIVERGE(tmp_path):
    verdicts, verified, diverge, _ = _fold([_row(prod="DIVERGE")], tmp_path)
    assert verdicts["reference:held-momentum"] == "DIVERGE" and diverge["ta.mom"] == 1 and not verified


def test_L3_the_coverage_map_does_not_count_a_sha_mismatch(tmp_path):
    verdicts, verified, _, led = _fold([_row(text=HELD + "// a later edit of the script\n")], tmp_path)
    assert verdicts["reference:held-momentum"] is None and not verified
    assert led["counts"]["shaMismatch"] == 1


def test_the_coverage_map_reads_the_ledger_by_default_and_keys_samples_like_capture_ids():
    assert cm.sample_slug("reference:Held Momentum__abc123") == "held-momentum"
    assert cm.sample_slug("committed:cdc-btc-rainbow-road__d880789793") == "cdc-btc-rainbow-road"
    src = (REPO / "tools" / "pine_coverage" / "coverage_map.py").read_text(encoding="utf-8")
    assert 'ap.add_argument("--ledger", default=str(el.LEDGER)' in src
    assert "fold_ledger(scripts, led, cap_rows, verified_items, diverge_items)" in src


# ── L7: the regrade ──────────────────────────────────────────────────────────────

def test_L7_the_regrade_grades_both_lanes_over_the_store_and_files_fresh_rows(tmp_path, monkeypatch):
    import evidence_engine as ee
    store = tmp_path / "runs"
    for run, cid, text in (("r1", "held-momentum-rddt-1d-2026-11-13", HELD), ("r2", "other-rddt-1d-2026-11-13", OTHER),
                           ("r3", "held-momentum-rddt-1d-2026-11-13", HELD)):      # r3: the same capture again
        d = store / run / "captures"
        d.mkdir(parents=True)
        (d / f"{cid}.json").write_text(json.dumps(_capture(cid, text)), encoding="utf-8")
    graded = []

    def grade(stage, out_dir, lane):
        graded.append((lane, sorted(p.name for p in stage.glob("*.json"))))
        return {"lane": lane, "results": [
            {"id": "held-momentum-rddt-1d-2026-11-13", "verdict": "MATCH" if lane == "production" else "DIVERGE",
             "reason": "graded"},
            {"id": "other-rddt-1d-2026-11-13", "verdict": "MATCH", "reason": "graded"}]}

    monkeypatch.setattr(el, "engine_version", lambda: ENGINE)
    ledger = tmp_path / "evidence-ledger.jsonl"

    class W:
        sources_by_sha = {}
    out = ee.regrade(store, ledger, world=W(), grade=grade, log=lambda *a: None)
    assert out["captures"] == 2 and out["ledgerRows"] == 2
    assert [g[0] for g in graded] == ["production", "runtime-on"]
    assert graded[0][1] == ["held-momentum-rddt-1d-2026-11-13.json", "other-rddt-1d-2026-11-13.json"]
    rows = el.read_rows(ledger)
    held = next(r for r in rows if r["captureId"].startswith("held"))
    assert held["verdicts"]["production"]["verdict"] == "MATCH" and held["verdicts"]["runtime-on"]["verdict"] == "DIVERGE"
    assert held["filedBy"] == "regrade" and held["scriptEngineVersion"] == ENGINE and held["licence"] == "held"
    assert HELD not in ledger.read_text(encoding="utf-8") and all(el.row_problems(r) == [] for r in rows)
    # the same engine again: nothing new
    assert ee.regrade(store, ledger, world=W(), grade=grade, log=lambda *a: None)["ledgerRows"] == 0
    # an engine bump: the old rows go stale, a regrade refreshes every proof
    monkeypatch.setattr(el, "engine_version", lambda: ENGINE + 1)
    assert el.classify(el.read_rows(ledger), SAMPLES, engine=ENGINE + 1, lane="production")["counts"]["stale"] == 2
    assert ee.regrade(store, ledger, world=W(), grade=grade, log=lambda *a: None)["ledgerRows"] == 2
    fresh = el.classify(el.read_rows(ledger), SAMPLES, engine=ENGINE + 1, lane="production")
    assert fresh["counts"] == {"fresh": 2, "stale": 0, "shaMismatch": 0, "unjoined": 0, "skipped": 0}


def test_L7_the_regrade_runs_only_under_the_heavy_lock_and_reads_the_store_from_its_env(tmp_path, monkeypatch):
    import evidence_engine as ee
    monkeypatch.setenv(el.CAPTURE_STORE_ENV, str(tmp_path / "store"))
    assert el.capture_store() == tmp_path / "store"
    monkeypatch.delenv(el.CAPTURE_STORE_ENV)
    assert el.capture_store() == el.DEFAULT_CAPTURE_STORE
    calls = []
    monkeypatch.setattr(ee.subprocess, "call", lambda cmd, **k: calls.append(cmd) or 0)
    monkeypatch.setenv("HEAVY_LOCK", str(tmp_path / "absent.py"))
    monkeypatch.setattr(ee, "DESKTOP_HEAVY_LOCK", str(tmp_path / "also-absent.py"))
    assert ee.main(["regrade", "--store", str(tmp_path)]) == 2 and not calls           # never unlocked
    lock = tmp_path / "lock.py"
    lock.write_text("# stand-in\n", encoding="utf-8")
    monkeypatch.setenv("HEAVY_LOCK", str(lock))
    assert ee.main(["regrade", "--store", str(tmp_path)]) == 0
    assert calls[0][:3] == [sys.executable, str(lock), "run"] and "evidence-regrade" in calls[0] and "--locked" in calls[0]


def _legacy(cid="held-momentum-rddt-1d-2026-11-13", text=HELD):
    """A row as the OLD promote wrote it (schema v1): one production verdict, no engine, provenance."""
    return {"schema": el.LEGACY_SCHEMA, "captureId": cid, "receipt": _sha(cid)[:8], "sourceSha256": _sha(text),
            "symbol": "NYSE:RDDT", "timeframe": "1D", "verdict": "MATCH", "reason": "r", "licence": "held",
            "packetSha256": "0" * 64, "provenance": {"driver": "an agent session"}, "filedAtUTC": "2026-11-14T00:00:00Z"}


def test_L10_a_legacy_row_is_never_evidence_and_fails_the_committed_check():
    legacy = _legacy()
    assert el.row_problems(legacy) != []
    out = el.classify([legacy], SAMPLES, engine=ENGINE, lane="production", slug_of=SLUGS)
    assert out["byKey"] == {} and sum(out["counts"].values()) == 0


def test_L10_retire_legacy_drops_only_a_legacy_row_a_v2_row_has_filed_again(tmp_path):
    path = tmp_path / "evidence-ledger.jsonl"
    v2 = _row()
    lines = [json.dumps(_row(cid="other-rddt-1d-2026-11-13", text=OTHER), sort_keys=True),
             json.dumps(_legacy()), json.dumps(_legacy(cid="orphan-rddt-1d-2026-11-13")),
             json.dumps(v2, separators=(",", ":"))]                   # bytes a re-serialisation would change
    path.write_text("".join(ln + chr(10) for ln in lines), encoding="utf-8")
    out = el.retire_legacy(path)
    assert out == {"retired": ["held-momentum-rddt-1d-2026-11-13"], "kept": ["orphan-rddt-1d-2026-11-13"]}
    after = path.read_text(encoding="utf-8").splitlines()
    assert after == [lines[0], lines[2], lines[3]]                 # every v2 row kept, byte for byte, in order
    assert el.retire_legacy(path)["retired"] == []                  # idempotent


def test_L7_a_new_capture_session_is_picked_up_with_no_configuration_and_a_live_one_can_be_left_out(tmp_path):
    import evidence_engine as ee
    store = tmp_path / "runs"
    for run, cid in (("s2-a", "held-momentum-rddt-1d-2026-11-13"), ("s3-live", "other-rddt-1d-2026-11-13")):
        d = store / run / "captures"
        d.mkdir(parents=True)
        (d / f"{cid}.json").write_text(json.dumps(_capture(cid)), encoding="utf-8")
    (store / "s3-live" / "captures" / "half-written.json").write_text("{", encoding="utf-8")
    assert sorted(c["id"] for _f, c in ee.store_captures(store)) == ["held-momentum-rddt-1d-2026-11-13",
                                                                     "other-rddt-1d-2026-11-13"]
    assert [c["id"] for _f, c in ee.store_captures(store, exclude_runs=["s3-live"])] == \
        ["held-momentum-rddt-1d-2026-11-13"]


def test_L7_the_regrade_retires_the_legacy_rows_it_files_again(tmp_path, monkeypatch):
    import evidence_engine as ee
    store = tmp_path / "runs" / "s2" / "captures"
    store.mkdir(parents=True)
    cid = "held-momentum-rddt-1d-2026-11-13"
    (store / f"{cid}.json").write_text(json.dumps(_capture(cid)), encoding="utf-8")
    ledger = tmp_path / "evidence-ledger.jsonl"
    ledger.write_text(json.dumps(_legacy()) + chr(10), encoding="utf-8")
    monkeypatch.setattr(el, "engine_version", lambda: ENGINE)

    class W:
        sources_by_sha = {}
    out = ee.regrade(tmp_path / "runs", ledger, world=W(), log=lambda *a: None,
                     grade=lambda stage, out_dir, lane: {"lane": lane, "results": [
                         {"id": cid, "verdict": "MATCH", "reason": "graded"}]})
    assert out["legacyRetired"] == [cid] and out["legacyKept"] == []
    rows = el.read_rows(ledger)
    assert len(rows) == 1 and rows[0]["schema"] == el.SCHEMA and el.row_problems(rows[0]) == []


# ── L8: admission evidence ───────────────────────────────────────────────────────

def _inp():
    return {"reference:held": {"population": "reference", "hash": _sha(HELD), "caps": ["core", "ta"]},
            "reference:other": {"population": "reference", "hash": _sha(OTHER), "caps": ["core"]}}


def test_L8_admission_counts_only_a_fresh_runtime_lane_MATCH_of_this_source_drawn_by_the_runtime_lane():
    lanes = {"reference:held": {"lane": "runtime"}, "reference:other": {"lane": "host"}}
    fresh = _row(rton="MATCH")
    assert ca.ledger_runtime_evidence(_inp(), lanes, [fresh], set(), ENGINE) == \
        {"reference:held": [("held-momentum-rddt-1d-2026-11-13", "Held Momentum [someone]", ENGINE)]}
    assert ca.ledger_runtime_evidence(_inp(), lanes, [_row(rton="MATCH", engine=ENGINE - 1)], set(), ENGINE) == {}
    assert ca.ledger_runtime_evidence(_inp(), lanes, [_row(rton="DIVERGE")], set(), ENGINE) == {}
    assert ca.ledger_runtime_evidence(_inp(), {"reference:held": {"lane": "host"}}, [fresh], set(), ENGINE) == {}
    moved = {"reference:held": dict(_inp()["reference:held"], hash=_sha(HELD + "//x\n"))}
    assert ca.ledger_runtime_evidence(moved, lanes, [fresh], set(), ENGINE) == {}
    assert ca.ledger_runtime_evidence(_inp(), lanes, [_row(prod="MATCH", rton=None)], set(), ENGINE) == {}


def test_L8_the_registry_re_asks_a_ledger_entrys_freshness_at_every_admission(monkeypatch):
    monkeypatch.setattr(ud, "SCRIPT_ENGINE_VERSION", ENGINE)
    base = {"capture": "c", "script": "s", "verdict": "MATCH", "runtimePane": "on"}
    assert rg._pine_capability_evidence_counts("core", base)                                 # a committed capture
    assert rg._pine_capability_evidence_counts("core", dict(base, ledger=True, scriptEngineVersion=ENGINE))
    assert not rg._pine_capability_evidence_counts("core", dict(base, ledger=True, scriptEngineVersion=ENGINE - 1))
    assert not rg._pine_capability_evidence_counts("core", dict(base, ledger=True))
    assert not rg._pine_capability_evidence_counts("core", dict(base, ledger="yes", scriptEngineVersion=ENGINE))


# ── L9: what is committed ─────────────────────────────────────────────────────────

def test_L9_every_committed_ledger_row_passes_the_row_check():
    rows = el.read_rows(el.LEDGER)
    for r in rows:
        assert el.row_problems(r) == [], r.get("captureId")
    assert el.LEDGER == REPO / "docs" / "pine" / "vendor-harness" / "evidence-ledger.jsonl"
