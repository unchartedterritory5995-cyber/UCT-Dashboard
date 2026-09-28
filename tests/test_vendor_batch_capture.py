"""Rails for the unattended vendor batch (`tools/vendor_harness/batch_capture.py`).

Run ONLY this file:  python -m pytest tests/test_vendor_batch_capture.py -q

Everything here drives the REAL driver loop against the recording double in
`tools/vendor_harness/batch_double.py` — no network, no TradingView — and the
captures it writes are assembled and re-verified by the REAL
`tools/vendor_harness/verify_capture.mjs` (node). What each rail pins:

  * the per-script step ORDER, gate before write before add before read;
  * each outcome class (CAPTURED / REFUSED_BY_TV / GATE_FAILED / INCONCLUSIVE)
    and INCOMPLETE on a process death, with the claim on disk BEFORE step one;
  * resume: a verified capture is skipped, INCOMPLETE/INCONCLUSIVE/GATE_FAILED
    are retried, and a dead run's orphan study is removed only by recorded id;
  * a binding-gate failure never clicks — in Python, and inside the click's own
    evaluation;
  * cleanup always runs; the throttle sits between scripts only;
  * no text entry, no owner profile, a derived manifest.
"""
from __future__ import annotations

import ast
import hashlib
import json
import pathlib
import shutil
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools" / "vendor_harness"))
sys.path.insert(0, str(REPO / "tools"))

import batch_capture as bc  # noqa: E402
import batch_double as bd  # noqa: E402
import batch_manifest as bm  # noqa: E402

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node is required for verify_capture.mjs")


def _ledger(run_dir):
    return [json.loads(x) for x in (run_dir / "ledger.jsonl").read_text(encoding="utf-8").splitlines()]


@pytest.fixture()
def first(tmp_path):
    manifest, beh, page, crashed = bd.first_run(tmp_path)
    return {"tmp": tmp_path, "manifest": manifest, "beh": beh, "page": page, "crashed": crashed,
            "results": bc.RunDir(tmp_path / "run", "t").results()}


def _only(tmp_path, slug, text, behaviour, stays_bound=(), **opt):
    manifest, beh = bd.make_manifest(tmp_path, [(slug, text, behaviour)])
    page = bd.RecordingTVPage(behaviours={sha: b for sha, b in beh.values()}, stays_bound=stays_bound)
    code, rd, clock = bd.run(page, manifest, tmp_path / "run", bd.fast_opts(**opt))
    return page, code, rd.results()[slug], clock


# ── the sequence ─────────────────────────────────────────────────────────────
def test_a_captured_script_runs_steps_1_to_12_in_order(first):
    steps = first["results"]["alpha"]["steps"]
    want = ["gate:script start", "signin", "state_before", "open_editor", "models", "title", "click:title",
            "menu:Create new", "hover:Create new", "menu:Indicator", "click:Indicator", "binding_gate",
            "set_source", "gate:before add", "add", "compute", "depth", "compute:settle", "inject",
            "vh_studies", "vh_capture", "chunk", "verify"]
    pos = [steps.index(w) for w in want]
    assert pos == sorted(pos), steps
    # and the chunks were more than one — the transport really was chunked
    assert steps.count("chunk") >= 2
    names = first["page"].names()
    # the double saw the cleanup AFTER the capture: remove, then __uctVH.cleanup(), then the globals read
    tail = names[names.index("VH_CHUNK"):]
    assert tail.index("REMOVE") < tail.index("VH_CLEANUP") < tail.index("GLOBALS")


# ── the outcome classes ──────────────────────────────────────────────────────
def test_each_outcome_class_is_distinct_and_carries_its_reason(first):
    r = first["results"]
    assert r["alpha"]["outcome"] == bc.CAPTURED
    assert r["bravo"]["outcome"] == bc.REFUSED_BY_TV and 'Undeclared identifier "fooo"' in r["bravo"]["reason"]
    assert r["charlie"]["outcome"] == bc.GATE_FAILED and "binding gate" in r["charlie"]["reason"]
    assert r["delta"]["outcome"] == bc.INCONCLUSIVE and "did not finish computing" in r["delta"]["reason"]
    assert r["echo"]["outcome"] == bc.INCOMPLETE
    # the captured file is real: the repo's own verifier accepts it
    v = bc.NodeVerifier().verify_file(pathlib.Path(r["alpha"]["capture"]))
    assert v["ok"] and v["exit"] == 0 and v["verdict"].startswith("VERDICT: PASS"), v


def test_a_capture_refusal_classifies_as_inconclusive_not_a_pass(tmp_path):
    page, code, res, _ = _only(tmp_path, "x", 'indicator("X")\nplot(close)\n',
                               {"capture_error": "the study has no rows on the bar grid — is it still computing?"})
    assert res["outcome"] == bc.INCONCLUSIVE and "no rows" in res["reason"]
    assert not list((tmp_path / "run" / "captures").glob("*.json"))


# ── INCOMPLETE ───────────────────────────────────────────────────────────────
def test_a_process_death_leaves_INCOMPLETE_never_a_stale_pass(first):
    assert first["crashed"] is not None
    echo = first["results"]["echo"]
    assert echo["outcome"] == bc.INCOMPLETE and echo["finishedAtUTC"] is None
    assert echo.get("addedStudyId"), "the added study's id is recorded on the claim for orphan recovery"
    events = [e["event"] for e in _ledger(first["tmp"] / "run") if e.get("slug") == "echo"]
    assert events == ["claim"]


def test_the_claim_is_on_disk_before_the_first_page_step(tmp_path, monkeypatch):
    seen = {}

    def dies(self, script):
        seen["onDisk"] = self.rd.read_result(script["slug"])
        raise bd.SimulatedCrash("killed before step one")

    monkeypatch.setattr(bc.Driver, "capture", dies)
    manifest, _ = bd.make_manifest(tmp_path, [("x", 'indicator("X")\nplot(close)\n', {})])
    page = bd.RecordingTVPage()
    with pytest.raises(bd.SimulatedCrash):
        bd.run(page, manifest, tmp_path / "run")
    assert seen["onDisk"]["outcome"] == bc.INCOMPLETE
    assert bc.RunDir(tmp_path / "run", "t").read_result("x")["outcome"] == bc.INCOMPLETE


# ── resume ───────────────────────────────────────────────────────────────────
def test_resume_skips_what_verified_and_retries_what_did_not(first):
    page2, code, rd2, clock2 = bd.resume_run(first["tmp"], first["manifest"], first["beh"], first["page"])
    led = _ledger(first["tmp"] / "run")
    assert {e["slug"] for e in led if e["event"] == "skip"} == {"alpha", "bravo"}
    assert {e["slug"] for e in led if e["event"] == "found-incomplete"} == {"echo"}
    res = rd2.results()
    assert all(res[s]["outcome"] == bc.CAPTURED for s in ("alpha", "charlie", "delta", "echo"))
    assert res["bravo"]["outcome"] == bc.REFUSED_BY_TV
    assert code == 0
    # a skipped script costs the account nothing: its source never reached the page
    assert page2.names().count("SET_SOURCE") == 3


def test_a_captured_file_that_no_longer_verifies_is_retaken(first):
    cap = pathlib.Path(first["results"]["alpha"]["capture"])
    c = json.loads(cap.read_text(encoding="utf-8"))
    c["bars"]["rows"][5][4] += 1          # one number moved, receipt now wrong
    cap.write_text(json.dumps(c), encoding="utf-8")
    page2, code, rd2, _ = bd.resume_run(first["tmp"], first["manifest"], first["beh"], first["page"])
    assert "alpha" not in {e["slug"] for e in _ledger(first["tmp"] / "run") if e["event"] == "skip"}
    assert rd2.results()["alpha"]["outcome"] == bc.CAPTURED


def test_an_unrecorded_study_on_the_rig_stops_the_batch_and_nothing_is_removed(tmp_path):
    manifest, _ = bd.make_manifest(tmp_path, [("x", 'indicator("X")\nplot(close)\n', {})])
    stranger = {"id": "owner1", "name": "Owner's study", "sha": "0" * 64, "source": "", "reads": 0}
    page = bd.RecordingTVPage(studies=[stranger])
    code, rd, _ = bd.run(page, manifest, tmp_path / "run")
    res = rd.results()["x"]
    assert code == 1 and res["outcome"] == bc.GATE_FAILED and "scratch layout" in res["reason"]
    assert "REMOVE" not in page.names() and page.studies == [stranger]


# ── the binding gate ─────────────────────────────────────────────────────────
def test_a_binding_gate_failure_never_writes_and_never_clicks(tmp_path):
    page, code, res, _ = _only(tmp_path, "x", 'indicator("X")\nplot(close)\n', {}, stays_bound={1})
    assert res["outcome"] == bc.GATE_FAILED
    names = page.names()
    assert "BINDING" in names
    assert "SET_SOURCE" not in names and "ADD" not in names, names
    assert page.adds == [] and page.studies == []


def test_the_gate_inside_the_click_evaluation_also_refuses(tmp_path):
    page, code, res, _ = _only(tmp_path, "x", 'indicator("X")\nplot(close)\n', {"bind_before_add": True})
    assert res["outcome"] == bc.GATE_FAILED and "nothing clicked" in res["reason"]
    assert page.adds == [("update", False)] and page.studies == []


def test_the_visibility_gate_refuses_before_any_write(tmp_path):
    manifest, _ = bd.make_manifest(tmp_path, [("x", 'indicator("X")\nplot(close)\n', {})])
    page = bd.RecordingTVPage(visible=False)
    code, rd, _ = bd.run(page, manifest, tmp_path / "run")
    assert code == 1
    assert "SET_SOURCE" not in page.names() and "ADD" not in page.names()


# ── cleanup and throttle ─────────────────────────────────────────────────────
def test_cleanup_always_runs_and_leaves_nothing(first):
    for slug in ("alpha", "bravo", "charlie", "delta"):
        cl = first["results"][slug]["cleanup"]
        assert cl["ok"], (slug, cl)
        assert "globals" in cl["steps"], (slug, cl)
    for slug in ("alpha", "bravo", "delta"):          # the ones that added a study
        assert first["results"][slug]["cleanup"]["removed"], slug
    assert "vh_cleanup" in first["results"]["alpha"]["cleanup"]["steps"]


def test_cleanup_runs_after_a_failure_that_follows_the_injection(tmp_path):
    page, code, res, _ = _only(tmp_path, "x", 'indicator("X")\nplot(close)\n', {"capture_error": "boom"})
    assert res["cleanup"]["ok"] and "vh_cleanup" in res["cleanup"]["steps"]
    assert page.globals == set() and page.studies == []


def test_the_throttle_sits_between_processed_scripts_only(first):
    page2, code, rd2, clock2 = bd.resume_run(first["tmp"], first["manifest"], first["beh"], first["page"])
    assert clock2.sleeps.count(30) == 2          # three processed, two skipped


# ── the page surface and the doubles' honesty ────────────────────────────────
def test_an_unknown_expression_is_loud_not_answered(tmp_path):
    page = bd.RecordingTVPage()
    with pytest.raises(AssertionError, match="not taught"):
        page.evaluate("() => document.title")


def test_the_driver_never_enters_text():
    tree = ast.parse((REPO / "tools" / "vendor_harness" / "batch_capture.py").read_text(encoding="utf-8"))
    banned = {"fill", "type", "insert_text", "press_sequentially", "set_input_files"}
    calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)]
    assert not [c.func.attr for c in calls if c.func.attr in banned]
    presses = [c for c in calls if c.func.attr == "press"]
    assert presses and all(isinstance(c.args[0], ast.Constant) and c.args[0].value == "Escape" for c in presses)


def test_a_profile_inside_the_worktree_or_the_owners_browser_is_refused(tmp_path, monkeypatch):
    with pytest.raises(SystemExit, match="REFUSED"):
        bc.resolve_profile(str(REPO / "no-such-profile-dir"))
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    owner = tmp_path / "Google" / "Chrome" / "User Data" / "Default"
    owner.mkdir(parents=True)
    with pytest.raises(SystemExit, match="owner's own browser"):
        bc.refuse_owner_browser_profile(owner)
    bc.refuse_owner_browser_profile(tmp_path / "uct-capture-profile")      # its own: allowed


def test_starts_at_bar0_is_asserted_only_on_a_stopped_history_from_the_listing_day():
    drv = bc.Driver(None, None, bd.fast_opts(), None, None)
    ok, why = drv.history_assertion({"ok": True, "stable": True, "first": bd.FIRST_BAR, "tz": "America/New_York",
                                     "count": 40, "rounds": 3})
    assert ok and "2024-03-21" in why
    assert not drv.history_assertion({"ok": True, "stable": False, "first": bd.FIRST_BAR, "rounds": 30})[0]
    assert not drv.history_assertion({"ok": True, "stable": True, "first": bd.FIRST_BAR + 86400,
                                      "tz": "America/New_York"})[0]
    assert not drv.history_assertion({"ok": False, "why": "unreadable"})[0]


def test_newest_bar_forming_auto_reads_the_ET_clock():
    import datetime as dt
    utc = dt.timezone.utc
    assert bc.newest_bar_forming("auto", dt.datetime(2026, 9, 28, 15, 0, tzinfo=utc))[0] is True    # Mon 11:00 ET
    assert bc.newest_bar_forming("auto", dt.datetime(2026, 9, 28, 21, 0, tzinfo=utc))[0] is False   # Mon 17:00 ET
    assert bc.newest_bar_forming("auto", dt.datetime(2026, 9, 27, 15, 0, tzinfo=utc))[0] is False   # Sunday
    assert bc.newest_bar_forming("false")[0] is False


# ── the manifest ─────────────────────────────────────────────────────────────
def test_the_manifest_is_derived_attached_minus_captured(tmp_path, monkeypatch):
    corpus = tmp_path / "corpus" / "committed"
    corpus.mkdir(parents=True)
    rows = []
    for name, attached in (("a__1", True), ("b__2", True), ("c__3", False)):
        p = corpus / f"{name}.pine"
        p.write_bytes(f'indicator("{name}")\n'.encode())
        rows.append({"file": f"corpus/committed/{name}.pine", "slug": name.split("__")[0],
                     "sha256": hashlib.sha256(p.read_bytes()).hexdigest(), "bytes": p.stat().st_size,
                     "attached": attached, "refusal": None if attached else "refused", "plots": 1,
                     "largestWindow": 14})
    monkeypatch.setattr(bm, "REPO", tmp_path)
    monkeypatch.setattr(bm, "CORPUS", corpus)
    census = {"flag": "F", "states": {"on": rows, "off": rows}}
    m = bm.build_manifest(census, True, {rows[1]["sha256"]: "cap.json"}, "test")
    assert [s["slug"] for s in m["scripts"]] == ["a"]
    assert m["counts"] == {"corpus": 3, "doorAttached": 2, "doorRefused": 1, "alreadyCaptured": 1, "targets": 1}
    (corpus / "a__1.pine").write_bytes(b"changed")
    with pytest.raises(ValueError, match="moved under the census"):
        bm.build_manifest(census, True, {}, "test")


def test_the_committed_manifest_matches_the_corpus_and_skips_what_is_captured():
    m = json.loads((REPO / "docs" / "pine" / "vendor-harness" / "batch-manifest.json").read_text(encoding="utf-8"))
    assert m["schema"] == "uct.vendor-batch-manifest/v1" and m["scripts"]
    captured = bm.captured_shas([REPO / "tests" / "fixtures" / "vendor" / "harness"])
    assert captured, "non-vacuity: the harness fixtures hold captures"
    for s in m["scripts"]:
        assert hashlib.sha256((REPO / s["path"]).read_bytes()).hexdigest() == s["sha256"], s["path"]
        assert s["sha256"] not in captured, s["path"]
    assert len({s["slug"] for s in m["scripts"]}) == len(m["scripts"])
    assert m["counts"]["targets"] == len(m["scripts"])


# ── grade ────────────────────────────────────────────────────────────────────
def test_grade_runs_the_corpus_harness_over_a_run_and_writes_both_files(first, tmp_path):
    page2, code, rd2, _ = bd.resume_run(first["tmp"], first["manifest"], first["beh"], first["page"])
    run_dir = first["tmp"] / "run"
    bc.write_json_atomic(run_dir / "manifest.json", {"derivation": {"doorFlag": {"state": "on"}}})
    assert bc.grade(run_dir, True, log=lambda *a: None) == 0
    verdicts = json.loads((run_dir / "verdicts.json").read_text(encoding="utf-8"))
    by = {pathlib.Path(r["file"]).stem.split("-rddt")[0]: r["verdict"] for r in verdicts["results"]}
    # the double computes plot(close): alpha agrees, the others plot other columns
    assert by["alpha"] == "MATCH" and by["charlie"] == "DIVERGE", by
    summary = (run_dir / "summary.md").read_text(encoding="utf-8")
    assert "## Batch outcomes" in summary and "REFUSED_BY_TV" in summary
