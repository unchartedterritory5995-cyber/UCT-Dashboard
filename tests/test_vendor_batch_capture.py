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
import math
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


def test_the_probe_leaves_the_chart_the_moment_its_values_are_read(first):
    """(c) 2026-11-19: on the rig layout the editor's add is autosaved and a widget-API removal is not, so a probe
    that outlives an autosave stays on the owner's layout (01:17Z, the settled L12 batch). The removal runs right
    after `vh_capture` (the page has staged the whole capture text; the chunk reads need no study), before the first
    chunk and the transport check, and `cleanup()` still runs after."""
    steps = first["results"]["alpha"]["steps"]
    assert steps.index("vh_capture") < steps.index("removed-at-capture") < steps.index("chunk") < steps.index("verify")
    names = first["page"].names()
    cap = names.index("VH_CAPTURE")
    assert names.index("REMOVE", cap) < names.index("VH_CHUNK", cap), names
    assert names.count("REMOVE") >= 1 and "VH_CLEANUP" in names[names.index("VH_CHUNK"):]


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
    # ⭐ (owner ruling, delegated, 2026-11-19) ONE other key: the layout's Save, pressed ONLY inside the guarded
    # clean-save (`guarded_clean_save`, behind `clean_save_refusal`); every other press is Escape
    fns = [f for f in ast.walk(tree) if isinstance(f, ast.FunctionDef)]
    in_guard = {id(c) for f in fns if f.name == "guarded_clean_save" for c in ast.walk(f) if isinstance(c, ast.Call)}
    saves = [c for c in presses if isinstance(c.args[0], ast.Name) and c.args[0].id == "SAVE_SHORTCUT"]
    assert len(saves) == 1 and all(id(c) in in_guard for c in saves), "Save is pressed only by the guarded clean-save"
    assert all((isinstance(c.args[0], ast.Constant) and c.args[0].value == "Escape") or c in saves for c in presses)
    assert bc.SAVE_SHORTCUT == "Control+s"


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


# ── the rig's persisted state (coordinator, 2026-11-18) ──────────────────────
def _verify_rows(run_dir):
    return [e for e in _ledger(run_dir) if e["event"] == "batch-verify"]


def test_a_batch_ends_by_reading_the_rig_on_a_fresh_load(tmp_path):
    page, code, res, _ = _only(tmp_path, "x", 'indicator("X")\nplot(close)\n', {})
    assert res["outcome"] == bc.CAPTURED and code == 0
    assert page.names("reload") == ["reload"]
    (v,) = _verify_rows(tmp_path / "run")
    assert v["ok"] is True and v["read"] is True and v["studies"] == []
    assert v["got"] == v["want"] == {"symbol": "NASDAQ:AAPL", "resolution": "5"}


def test_a_study_that_persisted_past_its_removal_fails_the_batch_loud(tmp_path):
    """The measured rig: the editor add is saved, the widget-API removal is not (run l12-is-2026-11-18)."""
    manifest, beh = bd.make_manifest(tmp_path, [("x", 'indicator("X")\nplot(close)\n', {})])
    page = bd.RecordingTVPage(behaviours={sha: b for sha, b in beh.values()}, autosave="tradingview")
    logged = []
    clock = bd.FakeClock(page)
    from pine_vendor_capture import acquire
    assert acquire(page, 5) == 0
    rd = bc.RunDir(tmp_path / "run", "selfcheck")
    code = bc.run_batch(page, manifest, rd, bd.fast_opts(), clock, bc.NodeVerifier(), log=logged.append)
    assert rd.results()["x"]["outcome"] == bc.CAPTURED          # the capture itself is good
    assert rd.results()["x"]["cleanup"]["removed"]              # and its teardown removed the study in the page
    assert code == bc.RIG_DIRTY
    (v,) = _verify_rows(tmp_path / "run")
    assert v["ok"] is False and [s["name"] for s in v["studies"]] == ["X"]
    assert any("RIG LEFT DIRTY" in str(m) for m in logged)
    # ⛔ read only: nothing is removed or set after the fresh load
    after = [n for k, n, _ in page.calls[[i for i, c in enumerate(page.calls) if c[0] == "reload"][0]:] if k == "evaluate"]
    assert "REMOVE" not in after and "SET_RESOLUTION" not in after and "SET_SYMBOL" not in after


def test_a_resolution_that_did_not_persist_fails_the_batch_loud(tmp_path):
    manifest, beh = bd.make_manifest(tmp_path, [("x", 'indicator("X")\nplot(close)\n', {})])
    page = bd.RecordingTVPage(behaviours={sha: b for sha, b in beh.values()},
                              persisted={"studies": [], "symbol": "NASDAQ:AAPL", "resolution": "1D"})
    code, rd, _ = bd.run(page, manifest, tmp_path / "run", bd.fast_opts())
    assert rd.results()["x"]["outcome"] == bc.CAPTURED and code == bc.RIG_DIRTY
    (v,) = _verify_rows(tmp_path / "run")
    assert v["ok"] is False and v["studies"] == [] and v["got"]["resolution"] == "1D" and v["want"]["resolution"] == "5"


def test_a_batch_that_stopped_at_its_own_start_gate_keeps_its_code(tmp_path):
    manifest, _ = bd.make_manifest(tmp_path, [("x", 'indicator("X")\nplot(close)\n', {})])
    stranger = {"id": "owner1", "name": "Owner's study", "sha": "0" * 64, "source": "", "reads": 0}
    page = bd.RecordingTVPage(studies=[stranger])
    code, rd, _ = bd.run(page, manifest, tmp_path / "run")
    assert code == 1                                            # GATE_FAILED stays the batch's answer
    (v,) = _verify_rows(tmp_path / "run")
    assert v["ok"] is False and [s["name"] for s in v["studies"]] == ["Owner's study"]


# ── the guarded clean-save (owner ruling, delegated to the coordinator, 2026-11-19) ──────────────────────────────
ORIG = {"symbol": "NASDAQ:AAPL", "resolution": "5"}


def test_the_guard_saves_only_a_clean_in_page_state():
    clean = {"studies": [], "symbol": "NASDAQ:AAPL", "resolution": "5"}
    assert bc.clean_save_refusal(clean, ORIG) is None
    assert "studies are still on the chart" in bc.clean_save_refusal({**clean, "studies": ["X"]}, ORIG)
    assert "resolution reads" in bc.clean_save_refusal({**clean, "resolution": "30"}, ORIG)
    assert "symbol reads" in bc.clean_save_refusal({**clean, "symbol": "NYSE:RDDT"}, ORIG)
    assert "not read" in bc.clean_save_refusal({"symbol": "NASDAQ:AAPL", "resolution": "5"}, ORIG)


def _dirty_batch(tmp_path, clean_save):
    manifest, beh = bd.make_manifest(tmp_path, [("x", 'indicator("X")\nplot(close)\n', {})])
    page = bd.RecordingTVPage(behaviours={sha: b for sha, b in beh.values()}, autosave="tradingview")
    from pine_vendor_capture import acquire
    assert acquire(page, 5) == 0
    rd = bc.RunDir(tmp_path / "run", "selfcheck")
    logged = []
    code = bc.run_batch(page, manifest, rd, bd.fast_opts(clean_save=clean_save), bd.FakeClock(page), bc.NodeVerifier(),
                        log=logged.append)
    return page, code, rd, logged


def test_a_dirty_rig_is_repaired_by_the_guarded_clean_save_and_a_fresh_load_proves_it(tmp_path):
    page, code, rd, logged = _dirty_batch(tmp_path, clean_save=True)
    assert rd.results()["x"]["outcome"] == bc.CAPTURED and code == 0
    rows = [r for r in _ledger(tmp_path / "run") if r.get("event") == "clean-save"]
    assert len(rows) == 1 and rows[0]["saved"] is True and rows[0]["ok"] is True
    assert rows[0]["before"] == {"studies": [], "symbol": "NASDAQ:AAPL", "resolution": "5"}   # clean IN THE PAGE first
    assert rows[0]["after"]["ok"] is True and rows[0]["after"]["studies"] == []                 # then a FRESH load
    # the order: the save, THEN a reload (the fresh-load verify follows every save)
    kinds = [(k, n) for k, n, _ in page.calls]
    save_at = kinds.index(("press", bc.SAVE_SHORTCUT))
    assert any(k == "reload" for k, _ in kinds[save_at:]), kinds[save_at:]
    assert page.persisted["studies"] == [] and page.persisted["resolution"] == "5"


def test_without_clean_save_the_dirty_rig_is_reported_and_never_saved(tmp_path):
    page, code, rd, logged = _dirty_batch(tmp_path, clean_save=False)
    assert code == bc.RIG_DIRTY
    assert ("press", bc.SAVE_SHORTCUT) not in [(k, n) for k, n, _ in page.calls]
    assert not [r for r in _ledger(tmp_path / "run") if r.get("event") == "clean-save"]


def test_the_guard_refuses_a_save_with_a_study_present_and_nothing_is_saved(tmp_path, monkeypatch):
    # the removal does nothing (a study stays in the page): the guard reads it and refuses; Save is never pressed
    monkeypatch.setattr(bd.RecordingTVPage, "_remove", lambda self, sid: {"ok": True})
    page, code, rd, logged = _dirty_batch(tmp_path, clean_save=True)
    rows = [r for r in _ledger(tmp_path / "run") if r.get("event") == "clean-save"]
    assert code in (1, bc.RIG_DIRTY) and rows and rows[0]["saved"] is False and "studies are still on the chart" in rows[0]["refused"]
    assert ("press", bc.SAVE_SHORTCUT) not in [(k, n) for k, n, _ in page.calls]


def test_no_save_while_focus_stays_in_an_editor(tmp_path, monkeypatch):
    # the Pine editor's Ctrl+S saves a SCRIPT to the account: focus that will not leave refuses the save
    monkeypatch.setattr(bd.RecordingTVPage, "focus_leaves", False, raising=False)
    page, code, rd, logged = _dirty_batch(tmp_path, clean_save=True)
    rows = [r for r in _ledger(tmp_path / "run") if r.get("event") == "clean-save"]
    assert code == bc.RIG_DIRTY and rows and rows[0]["saved"] is False and "focus" in rows[0]["refused"]
    assert ("press", bc.SAVE_SHORTCUT) not in [(k, n) for k, n, _ in page.calls]
    names = page.names()
    assert "FOCUS_BODY" in names


def test_a_study_this_batch_did_not_add_is_never_removed_or_saved_over(tmp_path):
    page, code, rd, logged = _dirty_batch(tmp_path, clean_save=True)
    # re-run the repair against a layout carrying a stranger's study beside ours
    stranger = {"id": "owner1", "name": "Owner's study", "sha": "0" * 64, "source": "", "reads": 0}
    page.persisted = {"studies": [stranger], "symbol": "NASDAQ:AAPL", "resolution": "5"}
    drv = bc.Driver(page, bd.FakeClock(page), bd.fast_opts(clean_save=True), rd, None, log=lambda *_: None)
    drv.added_titles = {"X"}
    drv.verify_fresh_load(ORIG)
    out = drv.guarded_clean_save(ORIG, "t")
    assert out["saved"] is False and "did not add" in out["refused"]
    assert page.persisted["studies"] == [stranger]


# ── ONE settled read of the rig (coordinator ruling, 2026-11-19: htfform-c read 0 studies on its first answer and
#    called the layout clean; the rail's new launch then read the saved leftover) ───────────────────────────────────
X_SAVED = {"id": "s1", "name": "X", "sha": "0" * 64, "source": "", "reads": 0}


def _slow_page(delay, studies=(X_SAVED,), **kw):
    return bd.RecordingTVPage(persisted={"studies": list(studies), "symbol": "NASDAQ:AAPL", "resolution": "5"},
                              attach_delay_s=delay, **kw)


def _drv(page, tmp_path, **kw):
    return bc.Driver(page, bd.FakeClock(page), bd.fast_opts(**kw), bc.RunDir(tmp_path / "run", "t"), None,
                     log=lambda *_: None)


def test_a_study_that_attaches_after_the_handle_answers_reads_dirty(tmp_path):
    v = _drv(_slow_page(4), tmp_path).verify_fresh_load(ORIG)
    assert v["read"] is True and v["ok"] is False and [s["name"] for s in v["studies"]] == ["X"]
    # the record keeps the early empty answer AND the late attach, with when each was first seen
    ch = v["settle"]["changes"]
    assert [c["studies"] for c in ch] == [[], ["X"]] and ch[0]["atS"] < 4 <= ch[1]["atS"]
    assert v["settle"]["waitedS"] >= v["settle"]["lastChangeS"] + bc.RIG_SETTLE_S


def test_control_the_first_answer_alone_reads_the_same_layout_clean(tmp_path):
    # the instrument can fail: with no settle window the same page reads CLEAN, which is the 2026-11-19 htfform-c read
    v = _drv(_slow_page(4), tmp_path, rig_settle_s=0).verify_fresh_load(ORIG)
    assert v["ok"] is True and v["studies"] == []


def test_a_clean_layout_reads_clean_only_once_it_has_held_still(tmp_path):
    v = _drv(_slow_page(0, studies=()), tmp_path).verify_fresh_load(ORIG)
    assert v["ok"] is True and v["read"] is True and v["settle"]["waitedS"] >= bc.RIG_SETTLE_S


def test_a_layout_that_never_holds_still_is_not_read_and_never_clean(tmp_path, monkeypatch):
    orig, n = bd.RecordingTVPage._state, {"i": 0}

    def flapping(self, a):
        st = orig(self, a)
        n["i"] += 1
        st["studies"] = [{"id": "s1", "name": "X"}] if n["i"] % 2 else []
        return st
    monkeypatch.setattr(bd.RecordingTVPage, "_state", flapping)     # before the page binds its handlers
    v = _drv(_slow_page(0, studies=()), tmp_path, rig_settle_max_s=30).verify_fresh_load(ORIG)
    assert v["read"] is False and v["ok"] is False and v["settle"]["waitedS"] >= 30


def test_a_batch_on_a_slow_attaching_rig_still_runs_the_guarded_clean_save(tmp_path):
    manifest, beh = bd.make_manifest(tmp_path, [("x", 'indicator("X")\nplot(close)\n', {})])
    page = bd.RecordingTVPage(behaviours={sha: b for sha, b in beh.values()}, autosave="tradingview", attach_delay_s=4)
    from pine_vendor_capture import acquire
    assert acquire(page, 5) == 0
    rd = bc.RunDir(tmp_path / "run", "selfcheck")
    code = bc.run_batch(page, manifest, rd, bd.fast_opts(clean_save=True), bd.FakeClock(page), bc.NodeVerifier(),
                        log=lambda *_: None)
    (v,) = _verify_rows(tmp_path / "run")
    assert v["ok"] is False and v["read"] is True and [s["name"] for s in v["studies"]] == ["X"]   # seen, late
    rows = [r for r in _ledger(tmp_path / "run") if r.get("event") == "clean-save"]
    assert len(rows) == 1 and rows[0]["ok"] is True and rows[0]["after"]["read"] is True and code == 0
    assert page.persisted["studies"] == []


def test_every_clean_check_reads_through_the_one_settled_read():
    tree = ast.parse((REPO / "tools" / "vendor_harness" / "batch_capture.py").read_text(encoding="utf-8"))
    fns = {f.name: f for f in ast.walk(tree) if isinstance(f, ast.FunctionDef)}

    def calls(fn):
        return {c.func.id if isinstance(c.func, ast.Name) else getattr(c.func, "attr", None)
                for c in ast.walk(fns[fn]) if isinstance(c, ast.Call)}
    assert "settled_rig_read" in calls("verify_fresh_load")
    assert "poll" not in calls("verify_fresh_load")                    # no first-answer read beside it
    # the batch end, the repair's verify-before and the clean-save's verify-after all go through verify_fresh_load
    assert "verify_fresh_load" in calls("guarded_clean_save") and "verify_fresh_load" in calls("run_batch")


# ── the capture phase (coordinator, 2026-11-19): one probe, one chart, one day, two session states ──────────────────
PROBE = '//@version=6\nindicator("One")\nplot(close)\n'


def _phased(tmp_path, phases, stem="stemx", symbol="AMEX:SPY", tf="1D"):
    """One probe, one chart, one script per phase (None = an unphased script), the way the evidence engine's
    manifest hands them over."""
    manifest, beh = bd.make_manifest(tmp_path, [(f"s{i}", PROBE, {}) for i in range(len(phases))])
    for s, ph in zip(manifest["scripts"], phases):
        s.update(captureStem=stem, symbol=symbol, tf=tf)
        if ph is not None:
            s["capturePhase"] = ph
    return manifest, beh


def test_the_capture_id_carries_the_phase_and_an_unphased_id_is_unchanged():
    o = bd.fast_opts(symbol="AMEX:SPY", tf="1D")
    s = {"slug": "s0", "captureStem": "stemx"}
    assert bc.capture_id_for(s, o) == "stemx-spy-1d-2026-09-28"
    for ph in bc.CAPTURE_PHASES:
        assert bc.capture_id_for(dict(s, capturePhase=ph), o) == f"stemx-spy-1d-2026-09-28-{ph}"
    assert bc.capture_id_for(dict(s, capturePhase=None), bd.fast_opts(symbol="AMEX:SPY", tf="5")) == "stemx-spy-5-2026-09-28"


def test_a_capture_phase_outside_the_vocabulary_is_refused_before_any_page_step(tmp_path):
    for bad in ("midday", "", "INSESSION", "postclose"):
        with pytest.raises(bc.GateFailed, match="is not one of") as exc:
            bc.capture_id_for({"slug": "s0", "captureStem": "stemx", "capturePhase": bad}, bd.fast_opts())
        assert exc.value.abort is True
    # the driver itself, handed such a script, stops before its first page step and stops the batch
    manifest, beh = _phased(tmp_path, ["midday"])
    page = bd.RecordingTVPage(behaviours={sha: b for sha, b in beh.values()})
    drv = bc.Driver(page, bd.FakeClock(page), bd.fast_opts(), bc.RunDir(tmp_path / "run1", "t"), bc.NodeVerifier(),
                    log=lambda *a: None)
    r = drv.run_one(manifest["scripts"][0])
    assert r["outcome"] == bc.GATE_FAILED and "capturePhase" in r["reason"] and drv.abort and drv.abort[0] == 1
    assert "gate:script start" not in r["steps"] and "SET_SOURCE" not in page.names() and "ADD" not in page.names()
    # and a batch carrying it is refused at its start: nothing is claimed, nothing reaches the page
    page = bd.RecordingTVPage(behaviours={sha: b for sha, b in beh.values()})
    code, rd, _ = bd.run(page, manifest, tmp_path / "run2")
    assert code == 1 and rd.results() == {} and "STATE" not in page.names()


def test_two_scripts_naming_one_capture_id_refuse_the_batch_before_any_page_step(tmp_path):
    from pine_vendor_capture import acquire
    for phases in ([None, None], ["insession", "insession"]):
        manifest, beh = _phased(tmp_path / str(phases[0]), phases)
        page = bd.RecordingTVPage(behaviours={sha: b for sha, b in beh.values()})
        assert acquire(page, 5) == 0
        before = len(page.calls)
        rd = bc.RunDir(tmp_path / str(phases[0]) / "run", "t")
        code = bc.run_batch(page, manifest, rd, bd.fast_opts(), bd.FakeClock(page), bc.NodeVerifier(), log=lambda *a: None)
        assert code == 1, phases
        assert page.calls[before:] == [], "the refusal touched the page"
        assert rd.results() == {} and not list((rd.root / "captures").glob("*.json"))
        (abort,) = [e for e in _ledger(rd.root) if e["event"] == "abort"]
        want = "stemx-spy-1d-2026-09-28" + (f"-{phases[0]}" if phases[0] else "")
        assert "s0 and s1 both name " + want in abort["reason"], abort


def test_distinct_phases_of_one_probe_on_one_chart_both_capture_under_their_own_ids(tmp_path):
    """The CONTROL of the refusal above: the same two scripts, each with its own phase, run and capture."""
    manifest, beh = _phased(tmp_path, ["insession", "postclose-fresh"])
    page = bd.RecordingTVPage(behaviours={sha: b for sha, b in beh.values()})
    code, rd, _ = bd.run(page, manifest, tmp_path / "run", bd.fast_opts())
    res = rd.results()
    assert code == 0 and [res[s]["outcome"] for s in ("s0", "s1")] == [bc.CAPTURED, bc.CAPTURED]
    assert (res["s0"]["captureId"], res["s1"]["captureId"]) == ("stemx-spy-1d-2026-09-28-insession",
                                                               "stemx-spy-1d-2026-09-28-postclose-fresh")
    for r in res.values():
        f = pathlib.Path(r["capture"])
        assert f.name == r["captureId"] + ".json" and json.loads(f.read_text(encoding="utf-8"))["id"] == r["captureId"]
    assert sorted(p.name for p in (tmp_path / "run" / "captures").glob("*.json")) == [
        "stemx-spy-1d-2026-09-28-insession.json", "stemx-spy-1d-2026-09-28-postclose-fresh.json"]


# ── startsAtBar0 is DERIVED and checked against the capture's own data (coordinator, 2026-11-19) ─────────────────────
# ⚰️ 17 captures of the 2026-09-27 vocabulary wave carried history.startsAtBar0 = true with RDDT's listing as the reason,
# on SPY / AAPL / ES1! / EURUSD / ... charts; 12 of them are refuted by their own bar_index CONTROL row (8172, 7432, ...),
# which made two probes grade DIVERGE and land on the host-known-divergence list.
FX = REPO / "tests" / "fixtures" / "vendor"
REFUTED_BY_BAR_INDEX = sorted(
    ["vw-int-cast-spy-1d-2026-09-27", "vw-nvi-pvi-spy-1d-truncated-2026-09-27"]
    + [f"vw-mintick-{s}-1d-2026-09-27" for s in ("aapl", "aitx", "brka", "btcusdt", "es1", "eurusd", "nkla", "sndl",
                                                 "spx", "spy")])
BOILERPLATE = REFUTED_BY_BAR_INDEX + ["vw-alma-spy-1d-2026-09-27", "vw-clock-vwap-spy-1d-2026-09-27",
                                      "vw-nvi-pvi-spy-1d-full-2026-09-27", "vw-time-session-spy-1d-2026-09-27",
                                      "vw-time-tf-spy-1d-2026-09-27"]


def _cap(name):
    return json.loads((FX / f"{name}.json").read_text(encoding="utf-8"))


def test_a_bar0_claim_whose_reason_names_another_symbol_is_refuted():
    for name in BOILERPLATE:
        c = _cap(name)
        why = bc.starts_at_bar0_contradiction(c, c["symbol"]["pro_name"])
        assert why and "NYSE:RDDT" in why and c["symbol"]["pro_name"] in why, (name, why)


def test_a_bar0_claim_its_own_bar_index_control_refutes_is_refuted():
    # the reason corrected to name the chart's own symbol: the bar_index rule alone refutes exactly these twelve
    got = []
    for name in BOILERPLATE:
        c = _cap(name)
        c["history"]["why"] = f"{c['symbol']['pro_name']} listed 1900-01-01; corrected for this rail"
        why = bc.starts_at_bar0_contradiction(c, c["symbol"]["pro_name"])
        if why:
            assert "bar_index control plot" in why and "not 0" in why, (name, why)
            got.append(name)
    assert sorted(got) == REFUTED_BY_BAR_INDEX


def test_control_genuine_bar0_claims_stand_and_a_request_bar_index_is_never_the_control():
    for f in (FX / "harness" / "rs-rating-fred6724-rddt-1d-2026-11-16.json", FX / "harness" / "3-level-zigzag-semafor-spy-1d-2026-11-14.json"):
        c = json.loads(f.read_text(encoding="utf-8"))
        assert c["history"]["startsAtBar0"] is True
        assert bc.starts_at_bar0_contradiction(c, c["symbol"]["pro_name"]) is None, f.name
    # another timeframe's bar_index (Q-HTF-FORM v1's F12) reads that timeframe's index: never the chart's control
    c = {"history": {"startsAtBar0": True, "why": "AMEX:SPY listed 1993-01-29; ..."}, "symbol": {"pro_name": "AMEX:SPY"},
         "study": {"plots": [{"id": "plot_0", "title": "F12_W_bar_index_OFF"}, {"id": "plot_1", "title": "F00_bar_index_CONTROL"}]},
         "plotValues": {"fields": ["time", "plot_0", "plot_1"], "rows": [[1, 1650, 0], [2, 1650, 1]]}}
    assert bc.starts_at_bar0_contradiction(c, "AMEX:SPY") is None
    c["plotValues"]["rows"][0][2] = 3                                # the chart's own control reading 3: refuted
    assert "F00_bar_index_CONTROL" in bc.starts_at_bar0_contradiction(c, "AMEX:SPY")
    # a capture asserted for one symbol on a chart of another is refuted whatever its reason says
    c["plotValues"]["rows"][0][2] = 0
    assert "asserted for NYSE:RDDT" in bc.starts_at_bar0_contradiction(c, "NYSE:RDDT")
    # no claim, nothing to refute
    assert bc.starts_at_bar0_contradiction({"history": {"startsAtBar0": False}}, "AMEX:SPY") is None


def test_the_capture_path_refuses_a_refuted_claim_before_it_returns_the_capture():
    tree = ast.parse((REPO / "tools" / "vendor_harness" / "batch_capture.py").read_text(encoding="utf-8"))
    fn = next(f for f in ast.walk(tree) if isinstance(f, ast.FunctionDef) and f.name == "capture")
    names = [c.func.id for c in ast.walk(fn) if isinstance(c, ast.Call) and isinstance(c.func, ast.Name)]
    assert "starts_at_bar0_contradiction" in names


# ── the listing date is READ from UCT's /api/ticker-ipo, never typed (coordinator ruling 2026-11-20) ─────────────────
# ⚰️ Q-FRED-NHDOT's NASDAQ:BGIN capture (listed 2025-10-21, first_trade_final true) carried no startsAtBar0 because BGIN was
# not in the hand-typed KNOWN_LISTING; the harness graded it as a chart reaching before its history.
DEPTH_AT_FIRST = {"ok": True, "stable": True, "first": bd.FIRST_BAR, "tz": "America/New_York", "count": 600, "rounds": 3}


def _listing_driver(tmp_path, page=None, **opts):
    page = page or bd.RecordingTVPage()
    return page, bc.Driver(page, bd.FakeClock(page), bd.fast_opts(**opts), bc.RunDir(tmp_path / "run", "t"), None,
                           log=lambda *_: None)


def test_the_api_answer_asserts_bar0_for_a_symbol_the_table_never_named(tmp_path):
    page, drv = _listing_driver(tmp_path, symbol="NASDAQ:BGIN")
    page.ipo["BGIN"] = {"first_trade_date": "2024-03-21", "first_trade_final": True}   # the double's first loaded day
    assert "NASDAQ:BGIN" not in bc.KNOWN_LISTING
    drv.opts.listing_date = drv.listing_for("NASDAQ:BGIN", None)
    starts, why = drv.history_assertion(DEPTH_AT_FIRST)
    assert drv.opts.listing_date == "2024-03-21" and starts is True and "NASDAQ:BGIN listed 2024-03-21" in why


def test_the_table_alone_never_asserts(tmp_path):
    page, drv = _listing_driver(tmp_path, symbol="NYSE:RDDT")
    page.ipo.pop("RDDT")                                     # production gives no answer for it
    drv.opts.listing_date = drv.listing_for("NYSE:RDDT", bc.KNOWN_LISTING["NYSE:RDDT"])
    starts, why = drv.history_assertion(DEPTH_AT_FIRST)
    assert drv.opts.listing_date is None and starts is False and "/api/ticker-ipo/RDDT answered 404" in why
    # an answer that is not FINAL is no answer either
    page2, drv2 = _listing_driver(tmp_path, symbol="NYSE:RDDT")
    page2.ipo["RDDT"] = {"first_trade_date": "2024-03-21", "first_trade_final": False}
    assert drv2.listing_for("NYSE:RDDT", None) is None and "no FINAL first trade date" in drv2.listing_why


def test_a_disagreement_stops_the_batch_by_name(tmp_path):
    page, drv = _listing_driver(tmp_path, symbol="NYSE:RDDT")
    page.ipo["RDDT"] = {"first_trade_date": "2024-03-22", "first_trade_final": True}
    with pytest.raises(bc.GateFailed) as e:
        drv.listing_for("NYSE:RDDT", None)                    # KNOWN_LISTING says 2024-03-21
    assert e.value.abort is True and "KNOWN_LISTING says 2024-03-21" in e.value.reason and "2024-03-22" in e.value.reason
    page2, drv2 = _listing_driver(tmp_path, symbol="NASDAQ:BGIN")
    page2.ipo["BGIN"] = {"first_trade_date": "2025-10-21", "first_trade_final": True}
    with pytest.raises(bc.GateFailed) as e2:
        drv2.listing_for("NASDAQ:BGIN", "2025-10-20")         # a manifest row that disagrees
    assert "the manifest row's listingDate says 2025-10-20" in e2.value.reason
    # CONTROL: agreement passes, and the answer is the API's
    page3, drv3 = _listing_driver(tmp_path, symbol="NYSE:RDDT")
    assert drv3.listing_for("NYSE:RDDT", "2024-03-21") == "2024-03-21"


def test_the_lookup_is_one_public_get_per_symbol(tmp_path):
    # /api/ticker-ipo answers without a session (measured 2026-11-20), so the capture profile signs in as no one
    page, drv = _listing_driver(tmp_path, symbol="NYSE:RDDT")
    assert drv.listing_for("NYSE:RDDT", None) == "2024-03-21" and drv.listing_for("NYSE:RDDT", None) == "2024-03-21"
    asked = [u for k, n, u in page.calls if k == "request" and n == "uct_api"]
    assert asked == [bc.UCT_ORIGIN + "/api/ticker-ipo/RDDT"]          # once, cached; nothing but the listing endpoint


def test_our_store_ticker_of_a_tradingview_symbol():
    assert bc.uct_ticker_of("NASDAQ:BGIN") == "BGIN" and bc.uct_ticker_of("NYSE:BRK.B") == "BRK-B" and bc.uct_ticker_of("SPY") == "SPY"


# ── a weekly / monthly chart starts at the listing when its first bar's PERIOD holds it (coordinator ruling 2026-11-20) ──
# the double's first loaded bar is 2024-03-21 (a Thursday)
@pytest.mark.parametrize("tf,listed,want", [
    ("1W", "2024-03-21", True), ("1W", "2024-03-18", True), ("W", "2024-03-22", True),     # the same ISO week
    ("1W", "2024-03-15", False), ("1W", "2024-03-25", False),                              # the week before / after
    ("1M", "2024-03-01", True), ("1M", "2024-03-29", True), ("1M", "2024-02-29", False), ("1M", "2023-03-21", False),
    ("1D", "2024-03-21", True), ("1D", "2024-03-18", False),                               # CONTROL: daily is exact
])
def test_a_weekly_or_monthly_chart_starts_at_the_listing_by_its_period(tmp_path, tf, listed, want):
    page, drv = _listing_driver(tmp_path, symbol="NYSE:RDDT", tf=tf)
    drv.opts.listing_date = listed
    starts, why = drv.history_assertion(DEPTH_AT_FIRST)
    assert starts is want, why
    if want and tf != "1D":
        assert ("listing week" if "W" in tf else "listing month") in why and "NYSE:RDDT listed" in why


def test_same_period_reads_the_iso_week_across_a_year():
    assert bc.same_period("2025-01-03", "2024-12-31", "W") and not bc.same_period("2025-01-10", "2024-12-31", "W")
    assert not bc.same_period("2024-12-31", "2024-12-31", "D") and not bc.same_period("x", "2024-12-31", "W")


# ── a row's SESSION is READ, never set (#2134 rulings 2026-11-21; ruling (ii) stands: no session write, ever) ─────────
# ⚰️ 2026-11-20 the first mechanism WROTE it as setSymbol(<spec>): on the live rig the symbol became the literal string and
# symbolInfo never arrived; its double parsed the spec and sym_match read through it, so its rails agreed with the code.
SPEC = '={"session":"extended","symbol":"AMEX:SPY"}'      # TradingView's WIRE encoding of a session, not a symbol name


def _session_batch(tmp_path, rows, hours="extended", subsession=None):
    """The rig as measured: the layout sits at 1D and is saved with `hours`; each row is AMEX:SPY 60."""
    manifest, beh = bd.make_manifest(tmp_path, [(slug, 'indicator("X")\nplot(close)\n', {}) for slug, _ in rows])
    for script, (_, session) in zip(manifest["scripts"], rows):
        script.update({"symbol": "AMEX:SPY", "tf": "60", "captureStem": "vw-bi-time-d-extended"})
        if session is not None:
            script["session"] = session
    page = bd.RecordingTVPage(behaviours={sha: b for sha, b in beh.values()}, resolution="1D")
    page.session_id, page.subsession = hours, subsession
    code, rd, _ = bd.run(page, manifest, tmp_path / "run", bd.fast_opts())
    return page, rd, code


def _spec_writes(page):
    return [a for k, n, a in page.calls if k == "evaluate" and n == "SET_SYMBOL" and str(a).startswith("=")]


def _captures(tmp_path):
    return sorted(p.name for p in (tmp_path / "run" / "captures").glob("*.json"))


def test_an_extended_row_on_an_extended_layout_captures_and_writes_no_session(tmp_path):
    page, rd, _ = _session_batch(tmp_path, [("ext", "extended")])
    res = rd.results()["ext"]
    assert res["outcome"] == bc.CAPTURED, res
    cap = json.loads((tmp_path / "run" / "captures" / "vw-bi-time-d-extended-spy-60-ext-2026-09-28.json").read_text(encoding="utf-8"))
    assert cap["symbol"]["session"] == "0400-2000"                            # the capture records the session it read
    assert not _spec_writes(page) and page.session_id == "extended"           # nothing written, the layout as found
    steps = res["steps"]
    assert steps.index("set_resolution") < steps.index("row:session")         # read AT THE ROW'S resolution (60)


def test_a_daily_chart_resolves_regular_whatever_the_layouts_hours():
    # every daily capture on record reads 0930-1600; the same rig at 60 reads its hours (the timeline, 2026-11-14..20)
    page = bd.RecordingTVPage(resolution="1D")
    page.session_id = "extended"
    assert page.evaluate(bc.SESSION_JS)["session"] == "0930-1600"
    page.evaluate(bc.SET_RESOLUTION_JS, "60")
    assert page.evaluate(bc.SESSION_JS)["session"] == "0400-2000"


def test_an_extended_row_on_a_regular_layout_stops_by_name_and_writes_nothing(tmp_path):
    page, rd, _ = _session_batch(tmp_path, [("ext", "extended")], hours="regular")
    res = rd.results()["ext"]
    assert res["outcome"] == bc.GATE_FAILED, res
    assert "the chart resolves session '0930-1600', not the extended session '0400-2000'" in res["reason"]
    assert "never sets it" in res["reason"] and "a layout saved with extended hours" in res["reason"]
    assert not _spec_writes(page) and page.session_id == "regular" and not _captures(tmp_path)


def test_a_regular_row_on_the_extended_rig_stops_by_name(tmp_path):
    # tonight's TD1c / SFB-b-rth / TC2-rth on the rig as it is: refused by name, never toggled
    page, rd, _ = _session_batch(tmp_path, [("reg", "regular")])
    res = rd.results()["reg"]
    assert res["outcome"] == bc.GATE_FAILED, res
    assert "resolves session '0400-2000', not the regular session '0930-1600'" in res["reason"]
    assert not _spec_writes(page) and page.session_id == "extended" and not _captures(tmp_path)


def test_a_regular_row_on_a_layout_saved_with_regular_hours_captures_as_rth(tmp_path):
    page, rd, _ = _session_batch(tmp_path, [("reg", "regular")], hours="regular")
    assert rd.results()["reg"]["outcome"] == bc.CAPTURED, rd.results()["reg"]
    assert _captures(tmp_path) == ["vw-bi-time-d-extended-spy-60-rth-2026-09-28.json"]
    cap = json.loads((tmp_path / "run" / "captures" / _captures(tmp_path)[0]).read_text(encoding="utf-8"))
    assert cap["symbol"]["session"] == "0930-1600" and not _spec_writes(page)


def test_a_subsession_tradingview_reports_must_name_the_rows_session(tmp_path):
    _, rd, _ = _session_batch(tmp_path, [("ext", "extended")], subsession="regular")
    res = rd.results()["ext"]
    assert res["outcome"] == bc.GATE_FAILED and "subsession 'regular'" in res["reason"], res
    _, rd2, _ = _session_batch(tmp_path / "b", [("ext", "extended")], subsession="extended")
    assert rd2.results()["ext"]["outcome"] == bc.CAPTURED


def test_a_row_that_names_no_session_never_asks_for_one(tmp_path):
    page, rd, _ = _session_batch(tmp_path, [("plain", None)])
    assert rd.results()["plain"]["outcome"] == bc.CAPTURED
    assert not [n for k, n, _ in page.calls if k == "evaluate" and n == "SESSION"]
    assert not _spec_writes(page)


def test_the_double_keeps_a_spec_as_a_literal_symbol_and_resolves_nothing_for_it():
    # as the live rig answered (patrick-54, 2026-11-20): ok, the literal string, and symbolInfo never arrives
    page = bd.RecordingTVPage()
    assert page.evaluate(bc.SET_SYMBOL_JS, SPEC) == {"ok": True}
    assert page.evaluate(bc.STATE_JS)["symbol"] == SPEC
    assert page.evaluate(bc.SESSION_JS)["ok"] is False
    page.evaluate(bc.SET_SYMBOL_JS, "AMEX:SPY")
    assert page.evaluate(bc.SESSION_JS)["ok"] is True                        # only a plain symbol brings it back


def test_a_chart_reading_a_spec_is_on_no_symbol_and_the_row_sets_the_plain_one(tmp_path):
    assert not bc.sym_match(SPEC, "AMEX:SPY") and not bc.sym_match("AMEX:SPY", SPEC) and not bc.sym_match(SPEC, SPEC)
    assert not [n for n in ("session_spec", "spec_symbol", "set_row_session") if hasattr(bc, n) or hasattr(bc.Driver, n)]
    page = bd.RecordingTVPage(symbol=SPEC, resolution="1D")                  # the first mechanism's leftover
    page.session_id = "extended"
    drv = _drv(page, tmp_path, symbol="AMEX:SPY", tf="60", session="extended")
    drv.ensure_symbol_tf(drv.read_state())
    assert page.symbol == "AMEX:SPY" and page.resolution == "60"
    assert [a for k, n, a in page.calls if k == "evaluate" and n == "SET_SYMBOL"] == ["AMEX:SPY"]


def test_an_extended_row_and_a_regular_row_of_one_probe_are_two_captures():
    o_ext, o_reg = bd.fast_opts(symbol="AMEX:SPY", tf="60"), bd.fast_opts(symbol="AMEX:SPY", tf="60")
    o_ext.session = "extended"
    s = {"slug": "x", "captureStem": "vw-bi-time-d-extended"}
    assert bc.capture_id_for(s, o_ext) == "vw-bi-time-d-extended-spy-60-ext-2026-09-28"
    assert bc.capture_id_for(s, o_reg) == "vw-bi-time-d-extended-spy-60-2026-09-28"


def test_a_row_that_names_the_regular_session_says_so_in_its_id():
    # ⚰️ (2026-11-20) a REGULAR-session row of the `vw-bi-time-d-extended` probe was named as master's EXTENDED capture
    # (`vw-bi-time-d-extended-spy-60-2026-11-19`, no suffix): the name lied to the next reader
    o_rth, o_none = bd.fast_opts(symbol="AMEX:SPY", tf="60"), bd.fast_opts(symbol="AMEX:SPY", tf="60")
    o_rth.session = "regular"
    s = {"slug": "x", "captureStem": "vw-bi-time-d-extended"}
    assert bc.capture_id_for(s, o_rth) == "vw-bi-time-d-extended-spy-60-rth-2026-09-28"
    assert bc.capture_id_for(s, o_none) == "vw-bi-time-d-extended-spy-60-2026-09-28"   # no session named: as before
    assert set(bc.SESSION_SUFFIX) == set(bc.ROW_SESSIONS)                             # every session has its suffix
    o_ext = bd.fast_opts(symbol="AMEX:SPY", tf="60")
    o_ext.session = "extended"
    ids = {bc.capture_id_for(s, o) for o in (o_rth, o_none, o_ext)}
    assert len(ids) == 3


def test_the_session_is_read_only_once_the_rows_resolution_has_loaded(tmp_path):
    # ⚰️ probe R4 (2026-11-21): right after a resolution change symbolInfo read NULL. The read waits for the new bars.
    manifest, beh = bd.make_manifest(tmp_path, [("ext", 'indicator("X")\nplot(close)\n', {})])
    manifest["scripts"][0].update({"symbol": "AMEX:SPY", "tf": "60", "session": "extended", "captureStem": "s"})
    page = bd.RecordingTVPage(behaviours={sha: b for sha, b in beh.values()}, resolution="1D")
    page.session_id, page.reload_s = "extended", 6
    _, rd, _ = bd.run(page, manifest, tmp_path / "run", bd.fast_opts())
    res = rd.results()["ext"]
    assert res["outcome"] == bc.CAPTURED, res
    reads = [a for k, n, a in page.calls if k == "evaluate" and n == "SESSION"]
    assert len(reads) >= 3 and res["steps"].count("row:session") == len(reads)      # it waited, then two equal reads


@pytest.mark.parametrize("mode", ["held", "bars"])
def test_a_stale_read_of_the_previous_resolution_never_captures_a_regular_row_on_the_extended_rig(tmp_path, mode):
    # ⚰️ patrick-54's review of #2289 (N1): the dangerous case. The rig is extended-hours and sits at 1D; a regular row at
    # 60 would be CAPTURED as regular if a stale 1D read (0930-1600) held for two polls were taken as the 60m answer.
    # "held": the previous resolution's session, interval and bars; "bars": the interval property already reads 60
    # while the 1D bars and session are still held, the case an interval test lets through.
    manifest, beh = bd.make_manifest(tmp_path, [("reg", 'indicator("X")\nplot(close)\n', {})])
    manifest["scripts"][0].update({"symbol": "AMEX:SPY", "tf": "60", "session": "regular", "captureStem": "s"})
    page = bd.RecordingTVPage(behaviours={sha: b for sha, b in beh.values()}, resolution="1D")
    page.session_id, page.stale_polls, page.stale_mode = "extended", 4, mode
    _, rd, _ = bd.run(page, manifest, tmp_path / "run", bd.fast_opts())
    res = rd.results()["reg"]
    assert res["outcome"] == bc.GATE_FAILED, res                       # never CAPTURED from the stale 1D read
    assert "resolves session '0400-2000', not the regular session '0930-1600'" in res["reason"]
    assert page.stale_served == 4 and not _captures(tmp_path)         # all 4 stale reads were offered, and waited out


def test_an_extended_row_on_a_daily_chart_is_refused_at_load(tmp_path):
    manifest, beh = bd.make_manifest(tmp_path, [("ext", 'indicator("X")\nplot(close)\n', {})])
    manifest["scripts"][0].update({"symbol": "AMEX:SPY", "tf": "1D", "session": "extended", "captureStem": "s"})
    page = bd.RecordingTVPage(behaviours={sha: b for sha, b in beh.values()})
    code, rd, _ = bd.run(page, manifest, tmp_path / "run", bd.fast_opts())
    abort = [e for e in _ledger(tmp_path / "run") if e["event"] == "abort"]
    assert code == 1 and abort and "can never pass" in abort[0]["reason"], abort
    assert "STATE" not in page.names() and not rd.results()
    assert bc.session_row_refusal([{"slug": "r", "session": "regular", "tf": "1D"}], lambda s: bd.fast_opts(
        tf=s["tf"], session=s["session"])) is None                    # a regular row on a daily chart is fine


def _run_session_js(times, session="0400-2000", interval="60", si=True):
    """The REAL `SESSION_JS`, executed in node against a fake main series (patrick-54's Q2, review of #2289: the double
    answers the snippet by its text and never runs it, so the gate's one computation was proven nowhere)."""
    import subprocess
    fake = {"times": times, "session": session, "interval": interval, "si": si}
    js = ("const F = " + json.dumps(fake) + ";\n"
          "const ms = { symbolInfo: () => (F.si ? { session: F.session, subsession_id: null } : null),\n"
          "  interval: () => F.interval,\n"
          "  bars: () => ({ each: (cb) => { for (let i = 0; i < F.times.length; i += 1) {"
          " if (cb(i, [F.times[i], 1, 1, 1, 1, 1])) break } } }) };\n"
          "globalThis.window = { _exposed_chartWidgetCollection: { activeChartWidget: { value: () => ({"
          " model: () => ({ mainSeries: () => ms }) }) } } };\n"
          "const f = (" + bc.SESSION_JS + ");\n"
          "process.stdout.write(JSON.stringify(f()));\n")
    out = subprocess.run(["node", "-"], input=js, capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def test_the_in_page_session_read_computes_the_smallest_spacing_of_the_last_ten_bars():
    h = 3600
    t0 = 1763000000 - (1763000000 % h)
    early = [t0 - 50 * h + k * 1800 for k in range(3)]       # a 30-minute pair, OUTSIDE the last 11 bars
    day = [t0 + k * h for k in range(9)]                      # nine consecutive 60-minute bars
    times = early + day + [day[-1] + 12 * h]                  # and the newest bar opens the next session
    r = _run_session_js(times)
    assert r["ok"] and r["bars"] == len(times) and r["interval"] == "60" and r["session"] == "0400-2000", r
    assert r["step"] == h               # the SMALLEST spacing of the last 10: never the 12 h gap, never the old pair
    assert _run_session_js([t0])["step"] is None                              # one bar has no spacing
    assert _run_session_js(times, si=False) == {"ok": False, "why": "no symbolInfo yet"}


def test_the_bar_spacing_of_a_resolution():
    assert bc.bar_step_range("60") == (3600, 3600) and bc.bar_step_range("5") == (300, 300)
    assert bc.bar_step_range("1D") == bc.bar_step_range("D") == (86400, 86400)
    assert bc.bar_step_range("W") == (604800, 604800) and bc.bar_step_range("M") == (28 * 86400, 31 * 86400)
    assert bc.bar_step_range("1S") is None


def test_a_session_that_never_settles_is_inconclusive_not_a_verdict(tmp_path):
    manifest, beh = bd.make_manifest(tmp_path, [("ext", 'indicator("X")\nplot(close)\n', {})])
    manifest["scripts"][0].update({"symbol": "AMEX:SPY", "tf": "60", "session": "extended", "captureStem": "s"})
    page = bd.RecordingTVPage(behaviours={sha: b for sha, b in beh.values()}, resolution="1D")
    page.session_id, page.reload_s = "extended", 1000
    _, rd, _ = bd.run(page, manifest, tmp_path / "run", bd.fast_opts())
    res = rd.results()["ext"]
    assert res["outcome"] == bc.INCONCLUSIVE and "never settled" in res["reason"], res
    assert not _captures(tmp_path)


# ── the layout a batch runs on (`--layout`, ruling B1 2026-11-21): one per batch, rows name theirs ─────────────────────
RTH_COPY = "RthCopy01"          # a stand-in id for the regular-hours copy of the rig layout


def test_a_batch_on_another_layout_than_the_page_reads_and_writes_nothing(tmp_path):
    # a navigation that did not land (the page still on the rig): the batch refuses before any read
    manifest, beh = bd.make_manifest(tmp_path, [("x", 'indicator("X")\nplot(close)\n', {})])
    page = bd.RecordingTVPage(behaviours={sha: b for sha, b in beh.values()})
    from pine_vendor_capture import acquire
    assert acquire(page, 5) == 0
    rd = bc.RunDir(tmp_path / "run", "t")
    code = bc.run_batch(page, manifest, rd, bd.fast_opts(layout=RTH_COPY), bd.FakeClock(page), bc.NodeVerifier(),
                        log=lambda *_: None)
    abort = [e for e in _ledger(tmp_path / "run") if e["event"] == "abort"]
    assert code == 1 and abort and "not this batch's 'RthCopy01'" in abort[0]["reason"], abort
    assert "STATE" not in page.names() and not rd.results()


def test_the_sign_in_ends_on_the_rig_so_a_batch_navigates_to_its_layout_after_it(tmp_path):
    # ⚰️ pine_vendor_capture.acquire() ends with page.goto(<the rig layout>): opened on the copy, the tab is back on the rig
    page = bd.RecordingTVPage()
    page.goto(bc.layout_url(RTH_COPY))
    from pine_vendor_capture import acquire
    assert acquire(page, 5) == 0 and bc.layout_id_of(page.url) == bc.RIG_LAYOUT_ID
    assert bc.go_to_layout(page, RTH_COPY, settle_ms=0) == RTH_COPY
    gotos = [n for k, n, _ in page.calls if k == "goto"]
    assert gotos[-1] == bc.layout_url(RTH_COPY)
    assert bc.go_to_layout(page, RTH_COPY, settle_ms=0) == RTH_COPY and [n for k, n, _ in page.calls if k == "goto"] == gotos


def test_each_layouts_rows_run_on_their_own_layout_and_one_run_dir_takes_both(tmp_path):
    manifest, beh = bd.make_manifest(tmp_path, [("ext", 'indicator("X")\nplot(close)\n', {}),
                                                ("reg", 'indicator("Y")\nplot(open)\n', {})])
    ext, reg = manifest["scripts"]
    for s, session, layout in ((ext, "extended", bc.RIG_LAYOUT_ID), (reg, "regular", RTH_COPY)):
        s.update({"symbol": "AMEX:SPY", "tf": "60", "session": session, "layout": layout, "captureStem": "two"})
    rig = bd.RecordingTVPage(behaviours={sha: b for sha, b in beh.values()}, resolution="1D")
    rig.session_id = "extended"
    bd.run(rig, manifest, tmp_path / "run", bd.fast_opts())
    res = bc.RunDir(tmp_path / "run", "t").results()
    assert res["ext"]["outcome"] == bc.CAPTURED and "reg" not in res                  # reg: another layout's row
    skips = [e for e in _ledger(tmp_path / "run") if e["event"] == "skip"]
    assert [(e["slug"], e["reason"]) for e in skips] == [("reg", f"runs on layout {RTH_COPY}, this batch is on {bc.RIG_LAYOUT_ID}")]
    copy = bd.RecordingTVPage(behaviours={sha: b for sha, b in beh.values()}, resolution="1D")
    copy.session_id, copy.url = "regular", bc.layout_url(RTH_COPY)
    bd.run(copy, manifest, tmp_path / "run", bd.fast_opts(layout=RTH_COPY))
    res = bc.RunDir(tmp_path / "run", "t").results()
    assert res["reg"]["outcome"] == bc.CAPTURED and res["reg"]["provenance"]["rigLayout"] == RTH_COPY
    assert _captures(tmp_path) == ["two-spy-60-ext-2026-09-28.json", "two-spy-60-rth-2026-09-28.json"]
    assert not _spec_writes(rig) and not _spec_writes(copy)
    assert rig.session_id == "extended" and copy.session_id == "regular"               # neither layout was touched


def test_a_layout_is_a_layout_id_or_nothing_starts(tmp_path):
    assert bc.layout_url("01f1AcIj") == "https://www.tradingview.com/chart/01f1AcIj/" == bc.LAYOUT
    assert bc.layout_id_of("https://www.tradingview.com/chart/01f1AcIj/?symbol=X") == "01f1AcIj"
    assert bc.layout_url(bc.RIG_REGULAR_LAYOUT_ID).endswith("/chart/MyS1vKSg/") and bc.RIG_REGULAR_LAYOUT_ID != bc.RIG_LAYOUT_ID
    for bad in ("", "../x", "01f1AcIj/../y", "a b"):
        with pytest.raises(bc.GateFailed):
            bc.layout_url(bad)
    manifest, beh = bd.make_manifest(tmp_path, [("x", 'indicator("X")\nplot(close)\n', {})])
    manifest["scripts"][0]["layout"] = "not a layout"
    page = bd.RecordingTVPage(behaviours={sha: b for sha, b in beh.values()})
    code, _, _ = bd.run(page, manifest, tmp_path / "run", bd.fast_opts())
    assert code == 1 and "STATE" not in page.names()


def test_an_unknown_session_is_refused():
    with pytest.raises(bc.GateFailed):
        bc.Opts(session="overnight")


# ── a TradingView BUILT-IN from the Indicators dialog: two gates, the measured search, the generated label ──────────────
# (coordinator ruling 2026-11-20, item 2: patrick-54's scratchpad `batch_builtin.py` moved into the repo)
VWAP_ROW = {"slug": "vwap-earn", "builtin": {"id": "STD;VWAP"}, "builtinInputs": {"Anchor Period": "Earnings"},
            "captureStem": "builtin-vwap-anchor-earnings"}


def _builtin_batch(tmp_path, rows, page=None):
    manifest = {"schema": "uct.vendor-batch-manifest/v1", "scripts": [json.loads(json.dumps(r)) for r in rows]}
    page = page or bd.RecordingTVPage()
    code, rd, _ = bd.run(page, manifest, tmp_path / "run", bd.fast_opts())
    return page, rd, code, manifest


def test_a_builtin_is_added_from_the_dialog_by_its_measured_search_and_its_identity_is_read_back(tmp_path):
    page, rd, code, manifest = _builtin_batch(tmp_path, [VWAP_ROW])
    res = rd.results()["vwap-earn"]
    assert res["outcome"] == bc.CAPTURED and code == 0, res
    steps = res["steps"]
    want = ["gate:before add", "builtin:open_dialog", "builtin:search_and_click", "builtin:closed",
            "builtin:identity", "builtin:input_ids", "builtin:input-in_1", "compute", "inject", "vh_capture", "verify"]
    pos = [steps.index(w) for w in want]
    assert pos == sorted(pos), steps
    assert not {"open_editor", "title", "binding_gate", "set_source", "add"} & set(steps)   # no editor at all
    assert page.searches == ["VWAP"]                       # the measured term, from the table: the row named none
    cap = json.loads(pathlib.Path(res["capture"]).read_text(encoding="utf-8"))
    assert cap["study"]["id"] == "Script$STD;VWAP@tv-scripting"
    assert {"id": "in_1", "value": "Earnings"} in cap["study"]["inputs"]
    assert cap["source"]["text"] == bc.builtin_label(VWAP_ROW)                  # the GENERATED label, verbatim
    assert cap["source"]["sha256"] == manifest["scripts"][0]["sha256"] == hashlib.sha256(
        bc.builtin_label(VWAP_ROW).encode("utf-8")).hexdigest()
    assert res["cleanup"]["ok"] and not page.studies and not page.dialog_open


def test_the_refuted_vwap_search_is_refused_before_any_page_step(tmp_path):
    # ⚰️ 2026-11-20: "Volume Weighted Average Price" lists 36 community scripts and not the built-in (7 of 7 rows stopped)
    row = dict(VWAP_ROW, builtin={"id": "STD;VWAP", "search": "Volume Weighted Average Price"})
    page, rd, code, _ = _builtin_batch(tmp_path, [row])
    assert code == 1
    abort = [e for e in _ledger(tmp_path / "run") if e["event"] == "abort"]
    assert abort and "the measured dialog search is 'VWAP'" in abort[0]["reason"], abort
    assert "OPEN_DIALOG" not in page.names() and not page.searches


def test_a_search_that_does_not_list_the_id_clicks_nothing_and_stops_by_name(tmp_path, monkeypatch):
    # the PRE-CLICK gate, live: an unmeasured search for an id the dialog does not list under it
    monkeypatch.setattr(bc, "BUILTIN_SEARCH", {k: v for k, v in bc.BUILTIN_SEARCH.items() if k != "STD;VWAP"})
    row = dict(VWAP_ROW, builtin={"id": "STD;VWAP", "search": "Volume Weighted Average Price"})
    page, rd, _, _ = _builtin_batch(tmp_path, [row])
    res = rd.results()["vwap-earn"]
    assert res["outcome"] == bc.GATE_FAILED, res
    assert 'no element with data-id STD;VWAP after searching "Volume Weighted Average Price"' in res["reason"]
    assert "nothing clicked" in res["reason"]
    assert page.next_id == 100 and not page.studies                 # no element was clicked, so no study was ever added
    assert "builtin:identity" not in res["steps"] and not page.dialog_open
    assert not list((tmp_path / "run" / "captures").glob("*.json"))


def test_a_click_that_lands_another_study_stops_by_name_and_the_study_is_removed(tmp_path):
    # the POST-ADD gate: the element carries the row's data-id, but what it added is another study (a moved label)
    page = bd.RecordingTVPage()
    page.lands_on = {"STD;VWAP": "Script$PUB;dc6dc22f6df34a818f00858fdbd237b1@tv-scripting"}
    _, rd, _, _ = _builtin_batch(tmp_path, [VWAP_ROW], page=page)
    res = rd.results()["vwap-earn"]
    assert res["outcome"] == bc.GATE_FAILED, res
    assert "landed on ['Script$PUB;dc6dc22f6df34a818f00858fdbd237b1@tv-scripting']" in res["reason"]
    assert "not ['Script$STD;VWAP@tv-scripting']" in res["reason"]
    assert res["cleanup"]["ok"] and res["cleanup"]["removed"] and not page.studies
    assert not list((tmp_path / "run" / "captures").glob("*.json"))


def _vwap_dirty_batch(tmp_path, clean_save):
    """The measured rig (an add is autosaved, a widget-API removal is not) with the built-in VWAP, whose census title
    ("VWAP") is not its `getAllStudies()` name ("Volume-weighted average price")."""
    page = bd.RecordingTVPage(autosave="tradingview")
    manifest = {"schema": "uct.vendor-batch-manifest/v1", "scripts": [json.loads(json.dumps(VWAP_ROW))]}
    from pine_vendor_capture import acquire
    assert acquire(page, 5) == 0
    rd = bc.RunDir(tmp_path / "run", "selfcheck")
    code = bc.run_batch(page, manifest, rd, bd.fast_opts(clean_save=clean_save), bd.FakeClock(page), bc.NodeVerifier(),
                        log=lambda *_: None)
    return page, rd, code


def test_a_builtin_is_owned_by_its_chart_name_not_its_census_title_and_the_clean_save_removes_it(tmp_path):
    # ⚰️ 2026-11-21, the s4 VWAP retake 2 (patrick-54): ownership was the census title "VWAP", `getAllStudies()` names the
    # study "Volume-weighted average price", so the batch's own leftover read as foreign and the guard refused the save
    page, rd, code = _vwap_dirty_batch(tmp_path, clean_save=True)
    res = rd.results()["vwap-earn"]
    assert res["outcome"] == bc.CAPTURED, res
    cap = json.loads(pathlib.Path(res["capture"]).read_text(encoding="utf-8"))
    assert cap["study"]["title"] == "VWAP" and cap["study"]["description"] == "Volume-weighted average price"  # the split
    rows = [r for r in _ledger(tmp_path / "run") if r.get("event") == "clean-save"]
    assert len(rows) == 1 and "refused" not in rows[0], rows
    assert [s["name"] for s in rows[0]["found"]] == ["Volume-weighted average price"]       # the leftover the add saved
    assert rows[0]["saved"] is True and rows[0]["ok"] is True and rows[0]["after"]["studies"] == []
    assert code == 0 and page.persisted["studies"] == []                                       # a fresh load reads clean


def test_control_without_the_clean_save_the_builtins_leftover_leaves_the_rig_dirty(tmp_path):
    # the rail above can fail: the dialog add persisted a study the in-page removal never unsaved
    page, rd, code = _vwap_dirty_batch(tmp_path, clean_save=False)
    assert rd.results()["vwap-earn"]["outcome"] == bc.CAPTURED and code == bc.RIG_DIRTY
    (v,) = _verify_rows(tmp_path / "run")
    assert [s["name"] for s in v["studies"]] == ["Volume-weighted average price"]


@pytest.mark.parametrize("extra, why", [
    ({"path": "probes/studio/builtin-vwap-anchor-earnings.label.txt"}, "drop `path`"),
    ({"sha256": "1f4c9ba0c2a9d8c4e3c6cd20f03ae6c72c23693203ca0abb8180d5612a1c331d"}, "is not the generated label's"),
])
def test_a_builtin_row_never_carries_a_hand_label(tmp_path, extra, why):
    # ⚰️ the retake2 rows' hand label said search "Volume Weighted Average Price" while the add typed "VWAP"
    page, _, code, _ = _builtin_batch(tmp_path, [dict(VWAP_ROW, **extra)])
    abort = [e for e in _ledger(tmp_path / "run") if e["event"] == "abort"]
    assert code == 1 and abort and why in abort[0]["reason"], abort
    assert "OPEN_DIALOG" not in page.names()
    mpath = tmp_path / "m.json"
    mpath.write_text(json.dumps({"schema": "uct.vendor-batch-manifest/v1", "scripts": [dict(VWAP_ROW, **extra)]}),
                     encoding="utf-8")
    with pytest.raises(SystemExit, match="vwap-earn"):
        bc._load_manifest(mpath)


def test_a_run_whose_manifest_is_its_own_run_dirs_hand_written_copy_starts(tmp_path):
    # ⚰️ patrick-54's review of #2284 (2026-11-21): `--manifest $RUN/manifest.json --run-dir $RUN` with a built-in row
    # carrying no sha256 crashed `run` before any page step (KeyError 'sha256' comparing the un-normalized run-dir copy)
    run = tmp_path / "run"
    run.mkdir()
    (run / "manifest.json").write_text(json.dumps({"schema": "uct.vendor-batch-manifest/v1", "scripts": [VWAP_ROW]}),
                                       encoding="utf-8")
    notes = []
    m = bc.prepare_run_manifest(run / "manifest.json", run, log=notes.append)
    sha = hashlib.sha256(bc.builtin_label(VWAP_ROW).encode("utf-8")).hexdigest()
    assert m["scripts"][0]["sha256"] == sha and notes == []          # the same rows: it starts, nothing "differs"
    assert json.loads((run / "manifest.json").read_text(encoding="utf-8"))["scripts"][0]["sha256"] == sha
    other = tmp_path / "other.json"                                    # control: a genuinely different resume says so
    other.write_text(json.dumps({"schema": "uct.vendor-batch-manifest/v1",
                                 "scripts": [dict(VWAP_ROW, builtinInputs={"Anchor Period": "Dividends"})]}), encoding="utf-8")
    bc.prepare_run_manifest(other, run, log=notes.append)
    assert len(notes) == 1 and "differs" in notes[0]


def test_the_loaded_manifest_derives_each_builtin_rows_sha_from_its_label(tmp_path):
    mpath = tmp_path / "m.json"
    mpath.write_text(json.dumps({"schema": "uct.vendor-batch-manifest/v1", "scripts": [VWAP_ROW]}), encoding="utf-8")
    row = bc._load_manifest(mpath)["scripts"][0]
    assert row["sha256"] == hashlib.sha256(bc.builtin_label(VWAP_ROW).encode("utf-8")).hexdigest()
    assert row["path"] is None


def test_the_generated_label_says_what_was_added_how_and_at_which_settings():
    assert bc.builtin_label(VWAP_ROW) == (
        'TradingView built-in STD;VWAP added from the Indicators dialog (search "VWAP"), not pasted Pine: '
        "Anchor Period = Earnings, every other setting at its default. "
        "Label generated by batch_capture.builtin_label from the manifest row.")
    assert bc.builtin_label({"slug": "d", "builtin": {"id": "STD;DPO"}}).endswith(
        "not pasted Pine: every setting at its default. Label generated by batch_capture.builtin_label from the manifest row.")
    assert "published script PUB;b96fdd470dac47d1a227d8aae88bdbb4" in bc.builtin_label(
        {"slug": "p", "builtin": {"id": "PUB;b96fdd470dac47d1a227d8aae88bdbb4"}})


def test_the_search_table_is_the_measured_one_and_only_pine_ids_are_added():
    assert bc.BUILTIN_SEARCH["STD;VWAP"] == "VWAP"
    assert all(k.startswith(tuple(bc.BUILTIN_ID_KINDS)) and v.strip() for k, v in bc.BUILTIN_SEARCH.items())
    assert bc.builtin_identity("STD;VWAP") == "Script$STD;VWAP@tv-scripting"
    for row, why in (({"slug": "a", "builtin": {"id": "VWAPAA@tv-basicstudies", "search": "VWAP"}}, "not a Pine script id"),
                     ({"slug": "b", "builtin": {"id": "STD;Not_Measured"}}, "no measured dialog search"),
                     ({"slug": "c", "builtin": {"id": "STD;VWAP", "search": ""}}, "non-empty string"),
                     ({"slug": "d", "builtin": "STD;VWAP"}, "`builtin` must be")):
        with pytest.raises(bc.GateFailed, match=why):
            bc.builtin_spec(row)
    # an unmeasured id that names its own search is allowed: its first live run is the proof (the pre-click gate)
    assert bc.builtin_spec({"slug": "e", "builtin": {"id": "STD;Not_Measured", "search": "Not Measured"}})["search"] == "Not Measured"


# ── the controls a step clicks: inside their containers, exactly one (patrick-54's review, coordinator 2026-11-21) ─────
# ⚰️ The menu rows and `Add to chart` were searched by own text over the whole page and the first hit taken; one attempt
# clicked an unrelated "Save" behind a modal. The finder is `rig_controls.js` (railed over the rig's recorded DOM in
# vendorHarness/rigControls.test.js); these rails hold the DRIVER to it on the double, which models the containers.
def _one_script(tmp_path):
    manifest, beh = bd.make_manifest(tmp_path, [("x", 'indicator("X")\nplot(close)\n', {})])
    return manifest, bd.RecordingTVPage(behaviours={sha: b for sha, b in beh.values()})


def _pointer_at(page, xy):
    return [k for k, n, _ in page.calls if k in ("click", "move") and n == f"{xy[0]:.0f},{xy[1]:.0f}"]


def test_an_add_to_chart_outside_the_editor_dialog_is_never_clicked(tmp_path):
    manifest, page = _one_script(tmp_path)
    # the dialog lost its own button and a modal holds one: the page holds EXACTLY ONE, so the binding gate passes
    page.add_in_dialog, page.add_outside = False, 1
    _, rd, _ = bd.run(page, manifest, tmp_path / "run", bd.fast_opts())
    res = rd.results()["x"]
    assert res["outcome"] == bc.GATE_FAILED, res
    assert "nothing clicked" in res["reason"] and "no visible 'Add to chart' in #pine-editor-dialog" in res["reason"]
    assert page.adds == [("add", False)] and not page.studies              # nothing was added
    # ✅ CONTROL: with its own button the dialog's add is clicked, and the row is captured
    manifest2, page2 = _one_script(tmp_path / "b")
    _, rd2, _ = bd.run(page2, manifest2, tmp_path / "b" / "run", bd.fast_opts())
    assert rd2.results()["x"]["outcome"] == bc.CAPTURED and page2.adds == [("add", True)]


def _reads(page, name):
    return sum(1 for k, n, _ in page.calls if k == "evaluate" and n == name)


def test_a_covered_add_to_chart_is_never_clicked_and_is_refused_at_the_timeout(tmp_path):
    manifest, page = _one_script(tmp_path)
    page.covered["Add to chart"] = math.inf                               # a cover that never clears
    _, rd, _ = bd.run(page, manifest, tmp_path / "run", bd.fast_opts())
    res = rd.results()["x"]
    assert res["outcome"] == bc.GATE_FAILED and "covered at its centre" in res["reason"], res
    assert not page.studies and all(not clicked for _, clicked in page.adds) and len(page.adds) > 1   # read again, never clicked


def test_a_transient_cover_over_add_to_chart_clears_and_the_row_is_captured(tmp_path):
    manifest, page = _one_script(tmp_path)
    page.covered["Add to chart"] = 2                                      # two covered reads, then clear
    _, rd, _ = bd.run(page, manifest, tmp_path / "run", bd.fast_opts())
    assert rd.results()["x"]["outcome"] == bc.CAPTURED, rd.results()["x"]
    assert page.adds == [("add", False), ("add", False), ("add", True)]  # one click, after the cover cleared


def test_two_create_new_rows_stop_the_row_before_the_pointer_touches_either(tmp_path):
    manifest, page = _one_script(tmp_path)
    page.menu_rows["Create new"] = 2
    _, rd, _ = bd.run(page, manifest, tmp_path / "run", bd.fast_opts())
    res = rd.results()["x"]
    assert res["outcome"] == bc.GATE_FAILED, res
    assert "the menu row `Create new` was not clicked: 2 visible 'Create new' in an open menu" in res["reason"]
    assert _reads(page, "MENU_ITEM") == 1                                 # several stop AT ONCE, no polling
    assert not _pointer_at(page, bd.CREATE_XY) and not _pointer_at(page, bd.INDICATOR_XY)
    assert "SET_SOURCE" not in page.names() and "ADD" not in page.names()


def test_a_covered_indicator_row_is_not_clicked_and_is_refused_at_the_timeout(tmp_path):
    manifest, page = _one_script(tmp_path)
    page.covered["Indicator"] = math.inf
    _, rd, _ = bd.run(page, manifest, tmp_path / "run", bd.fast_opts())
    res = rd.results()["x"]
    assert res["outcome"] == bc.GATE_FAILED and "the menu row `Indicator` was not clicked" in res["reason"], res
    assert "covered at its centre" in res["reason"] and _reads(page, "MENU_ITEM") > 2   # read again until the timeout
    assert _pointer_at(page, bd.CREATE_XY) == ["move"]                     # hovered `Create new`, as before
    assert not _pointer_at(page, bd.INDICATOR_XY) and "SET_SOURCE" not in page.names()


def test_a_transient_cover_over_the_indicator_row_clears_and_the_row_is_captured(tmp_path):
    manifest, page = _one_script(tmp_path)
    page.covered["Indicator"] = 2
    _, rd, _ = bd.run(page, manifest, tmp_path / "run", bd.fast_opts())
    assert rd.results()["x"]["outcome"] == bc.CAPTURED, rd.results()["x"]
    assert _pointer_at(page, bd.INDICATOR_XY) == ["click"]                # clicked once, after the cover cleared


def test_the_menu_and_add_scripts_evaluate_the_railed_finder_in_its_container():
    src = (REPO / "tools" / "vendor_harness" / "rig_controls.js").read_text(encoding="utf-8")
    assert bc.CONTROL_FINDER_JS == src[src.index("(a) =>"):].strip()        # the file vitest rails, verbatim
    assert bc.CONTROL_FINDER_JS in bc.MENU_ITEM_JS and "within: 'menu'" in bc.MENU_ITEM_JS
    assert bc.CONTROL_FINDER_JS in bc.ADD_JS and "within: 'editor'" in bc.ADD_JS
    # ⛔ no whole-page own-text search is left to click from: the gate's count is the only one, and the one click is
    # the finder's element
    rest = bc.ADD_JS.replace(bc.BINDING_JS, "").replace(bc.CONTROL_FINDER_JS, "")
    assert "querySelectorAll" not in rest and "querySelectorAll" not in bc.MENU_ITEM_JS.replace(bc.CONTROL_FINDER_JS, "")
    assert bc.ADD_JS.count(".click()") == 1 and "f.el.click()" in bc.ADD_JS


# ── a PASTED script's input overrides (`scriptInputs`, coordinator ruling 2026-11-26) ─────────────────────────────────
# kernel-channel-backquant's "Color Bars By Regime" (in_7) ON, captured against the committed source byte for byte: the
# override is set by label or id, read back, then CONFIRMED from a separate read of the chart's own study inputs before
# anything is captured; a chart that does not hold it stops the row by name.
def _with_inputs(tmp_path, inputs, page_setup=None):
    manifest, beh = bd.make_manifest(tmp_path, [("x", 'indicator("X")\nplot(close)\n', {})])
    manifest["scripts"][0]["scriptInputs"] = inputs
    page = bd.RecordingTVPage(behaviours={sha: b for sha, b in beh.values()})
    if page_setup:
        page_setup(page)
    code, rd, _ = bd.run(page, manifest, tmp_path / "run", bd.fast_opts())
    return page, code, rd.results()["x"]


@pytest.mark.parametrize("key", ["Color Bars By Regime", "in_7"])
def test_a_pasted_script_input_is_set_confirmed_and_captured(tmp_path, key):
    page, code, res = _with_inputs(tmp_path, {key: True})
    assert res["outcome"] == bc.CAPTURED and code == 0, res
    steps = res["steps"]
    want = ["add", "compute", "script:input_ids", "script:input-in_7", "script:inputs-confirmed", "inject", "vh_capture"]
    pos = [steps.index(w) for w in want]
    assert pos == sorted(pos), steps
    cap = json.loads(pathlib.Path(res["capture"]).read_text(encoding="utf-8"))
    assert {"id": "in_7", "value": True} in cap["study"]["inputs"]
    assert cap["source"]["text"] == 'indicator("X")\nplot(close)\n'          # the source untouched: byte for byte


def test_a_chart_that_does_not_hold_the_override_stops_the_row_and_captures_nothing(tmp_path):
    page, code, res = _with_inputs(tmp_path, {"in_7": True}, lambda p: setattr(p, "inputs_revert", ("in_7",)))
    assert res["outcome"] == bc.GATE_FAILED, res
    assert "do not hold the row's override" in res["reason"] and "in_7" in res["reason"]
    assert "inject" not in res["steps"] and not list((tmp_path / "run" / "captures").glob("*.json"))


def test_an_unknown_input_stops_the_row_by_name(tmp_path):
    page, code, res = _with_inputs(tmp_path, {"No Such Input": True})
    assert res["outcome"] == bc.GATE_FAILED and "no input labelled 'No Such Input'" in res["reason"], res


def test_script_inputs_on_a_builtin_or_malformed_are_refused_before_any_page_step():
    assert "builtinInputs" in bc.script_inputs_refusal([{"slug": "b", "builtin": {"id": "STD;VWAP"}, "scriptInputs": {"x": 1}}])
    assert "scriptInputs must name" in bc.script_inputs_refusal([{"slug": "p", "scriptInputs": {}}])
    assert bc.script_inputs_refusal([{"slug": "p", "scriptInputs": {"in_7": True}}]) is None

# ── the capture SLOTS (owner + TRADINGVIEW coordinator, 2026-11-26) ───────────────────────────────────────────────
# One broker-owned browser, three WINDOWS, each bound to its own layout (`bc.SLOT_LAYOUTS`); `run --cdp --slot`. These
# rails prove the slot mode on the double and the lock protocol on a temp dir; the path without `--cdp` is the recorded
# trace of origin/master, call for call.
import os  # noqa: E402
import threading  # noqa: E402
import time as _time  # noqa: E402
import types  # noqa: E402

import tv_slots as ts  # noqa: E402

PAGE_WRITES = {"SET_SYMBOL", "SET_RESOLUTION", "SET_STRETCH", "OPEN_EDITOR", "SET_SOURCE", "ADD", "REMOVE", "INPUTS",
               "OPEN_DIALOG", "SEARCH_AND_CLICK", "VH_CAPTURE", "inject"}


def _writes(page):
    """Every call on the double that writes chart / editor / page state (evaluations by name, pointer and key events)."""
    return [(k, n) for k, n, _ in page.calls
            if (k == "evaluate" and n in PAGE_WRITES) or k in ("click", "move", "press")]


def test_the_path_without_cdp_is_the_recorded_trace_of_origin_master(tmp_path):
    """⭐⭐ `--cdp`-less = exactly today's path: every page call, step, outcome, exit code, sleep and capture byte of three
    legacy scenarios equals the trace recorded from origin/master before the slot mode existed (`bd.legacy_trace`)."""
    got = json.loads(json.dumps(bd.legacy_trace(tmp_path), sort_keys=True))
    want = json.loads(bd.LEGACY_TRACE_FIXTURE.read_text(encoding="utf-8"))
    for scenario in want:
        assert got[scenario] == want[scenario], f"the legacy path changed in scenario {scenario!r}"
    assert got == want


class _FakePW:
    """A stand-in for `playwright.sync_api.sync_playwright()`: records persistent launches and CDP connects."""

    def __init__(self, page=None, browser=None):
        self.launched, self.connected = [], []
        self.page, self.browser = page, browser
        outer = self

        class _Chromium:
            def launch_persistent_context(self, profile, **kw):
                outer.launched.append((profile, kw))
                return types.SimpleNamespace(pages=[outer.page], new_page=lambda: outer.page,
                                             close=lambda: outer.launched.append(("closed", None)))

            def connect_over_cdp(self, endpoint):
                outer.connected.append(endpoint)
                if outer.browser is None:
                    raise ConnectionError("no broker")
                return outer.browser

        self.chromium = _Chromium()

    def __call__(self):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_launch_without_cdp_launches_exactly_as_before_and_never_connects(tmp_path, monkeypatch):
    page = bd.RecordingTVPage()
    fake = _FakePW(page=page)
    monkeypatch.setitem(sys.modules, "playwright.sync_api", types.SimpleNamespace(sync_playwright=fake))
    monkeypatch.setattr(bc, "report_profile_lock", lambda profile: True)
    prof = tmp_path / "prof"
    args = types.SimpleNamespace(profile=str(prof), channel="chrome", wait=5, layout=bc.RIG_LAYOUT_ID)
    assert bc._launch(args, lambda p: 0 if p is page else 9) == 0
    assert fake.connected == []                                   # never a CDP connect without --cdp
    (profile, kw), closed = fake.launched[0], fake.launched[-1]
    assert profile == str(prof) and closed == ("closed", None)
    assert kw == {"headless": False, "viewport": dict(bc.RIG_VIEWPORT), "args": ["--window-position=40,40"],
                  "channel": "chrome"}
    # ⭐ the broker launches the browser EXACTLY so, plus its debugging port: the same Chrome as the single path
    broker = ts.broker_launch_options("chrome", 9333)
    assert broker["args"][-1] == "--remote-debugging-port=9333"
    assert {**broker, "args": broker["args"][:-1]} == kw


def _slot_manifest(tmp, slug, text):
    m, beh = bd.make_manifest(tmp, [(slug, text, {})])
    return m, {sha: b for sha, b in beh.values()}


class _SlowPage(bd.RecordingTVPage):
    """A double that yields the GIL on every evaluation, so two slot jobs on two threads really interleave."""

    def evaluate(self, expr, arg=None):
        _time.sleep(0.0005)
        return super().evaluate(expr, arg)


def test_two_slots_capture_in_parallel_without_crossing_state(tmp_path):
    jobs = {"B": ("bslot", '//@version=6\nindicator("Bee")\nplot(close)\n'),
            "C": ("cslot", '//@version=6\nindicator("Sea")\nplot(open)\n')}
    pages, out, errs = {}, {}, []

    def job(slot):
        try:
            slug, text = jobs[slot]
            m, beh = _slot_manifest(tmp_path / slot, slug, text)
            pages[slot] = page = _SlowPage(behaviours=beh)
            out[slot] = bd.slot_run(page, m, tmp_path / slot / "run", slot)
        except BaseException as exc:  # noqa: BLE001
            errs.append(exc)

    threads = [threading.Thread(target=job, args=(s,)) for s in jobs]
    for t in threads:
        t.start()
    for t in threads:
        t.join(120)
    assert not errs, errs
    for slot, (slug, text) in jobs.items():
        code, rd, _ = out[slot]
        res = rd.results()[slug]
        assert code == 0 and res["outcome"] == bc.CAPTURED, res
        page = pages[slot]
        # each window saw only its own layout, its own one add, and ends empty
        assert [n for k, n, _ in page.calls if k == "goto"] == [bc.layout_url(bc.SLOT_LAYOUTS[slot])]
        assert len(page.adds) == 1 and page.studies == [] and not page.globals
        cap = json.loads(pathlib.Path(res["capture"]).read_text(encoding="utf-8"))
        assert cap["source"]["text"] == text                       # its own script, never the other slot's
        want = bd.slot_info_for(slot)
        # ⭐ provenance: the result AND the capture's page block name the slot, layout, target, window and broker
        assert res["provenance"]["slot"] == {k: want[k] for k in bc.SLOT_PROVENANCE_KEYS}
        assert list(cap["page"]["slot"]) == list(bc.SLOT_PROVENANCE_KEYS)
        assert cap["page"]["slot"] == res["provenance"]["slot"]
        assert res["provenance"]["rigLayout"] == bc.SLOT_LAYOUTS[slot]
        # the per-row identity: its slot's layout read before the row's first write, and its session read at its tf
        steps = res["steps"]
        assert steps.index("slot:layout") < steps.index("state_before") and "row:session:slot" in steps
        led = _ledger(tmp_path / slot / "run")
        assert [e["slot"]["slot"] for e in led if e["event"] == "slot-identity"] == [slot]
    assert pages["B"].calls != pages["C"].calls


def _refused_slot(tmp_path, page, slot="B", layout_on=None):
    m, beh = _slot_manifest(tmp_path, "row", '//@version=6\nindicator("R")\nplot(close)\n')
    page.behaviours = beh
    code, rd, _ = bd.slot_run(page, m, tmp_path / "run", slot, layout_on=layout_on)
    return code, rd.results().get("row"), page


def _assert_refused_untouched(tmp_path, code, res, page, why):
    assert code == 1 and res and res["outcome"] == bc.GATE_FAILED, res
    assert res["reason"].startswith("slot identity proof:") and why in res["reason"], res["reason"]
    assert res["provenance"]["slot"]["slot"] == "B"
    assert _writes(page) == [], _writes(page)                     # nothing written on the page
    assert not list((tmp_path / "run" / "captures").glob("*.json"))


def test_a_slot_whose_page_is_on_the_wrong_layout_is_refused_with_nothing_written(tmp_path):
    code, res, page = _refused_slot(tmp_path, bd.RecordingTVPage(), layout_on=bc.RIG_LAYOUT_ID)
    _assert_refused_untouched(tmp_path, code, res, page, f"not the slot's {bc.SLOT_B_LAYOUT_ID!r}")


def test_a_slot_page_whose_own_layout_id_disagrees_with_its_url_is_refused(tmp_path):
    page = bd.RecordingTVPage()
    page.layout_api = bc.RIG_LAYOUT_ID                           # the URL says B, TradingView says the rig
    code, res, page = _refused_slot(tmp_path, page)
    _assert_refused_untouched(tmp_path, code, res, page, "TradingView says")


def test_a_slot_layout_holding_a_study_is_refused_and_the_study_left_alone(tmp_path):
    carried = {"id": "st9", "name": "Carried", "sha": None, "source": None, "reads": 0}
    code, res, page = _refused_slot(tmp_path, bd.RecordingTVPage(studies=[carried]))
    _assert_refused_untouched(tmp_path, code, res, page, "carries 1 studies ['Carried']")
    assert page.studies == [carried]                              # a slot job never removes what it did not add


def test_a_signed_out_slot_is_refused_and_never_signs_in(tmp_path):
    code, res, page = _refused_slot(tmp_path, bd.RecordingTVPage(signed_in=False))
    _assert_refused_untouched(tmp_path, code, res, page, "not signed in")


def _slot_session(tmp_path, tf, hours, session=None):
    m, beh = _slot_manifest(tmp_path, "sess", '//@version=6\nindicator("S")\nplot(close)\n')
    m["scripts"][0].update({"symbol": "AMEX:SPY", "tf": tf, "captureStem": "s"})
    if session:
        m["scripts"][0]["session"] = session
    page = bd.RecordingTVPage(behaviours=beh, resolution="1D")
    page.session_id = hours
    code, rd, _ = bd.slot_run(page, m, tmp_path / "run", "B")
    return rd.results()["sess"], page


def test_a_slot_job_reads_every_rows_session_even_one_that_names_none(tmp_path):
    res, _ = _slot_session(tmp_path / "a", "60", "extended")
    assert res["outcome"] == bc.CAPTURED and "row:session:slot" in res["steps"], res
    res, _ = _slot_session(tmp_path / "b", "1D", "extended")       # a daily chart resolves 0930-1600 on any layout
    assert res["outcome"] == bc.CAPTURED and "row:session:slot" in res["steps"], res
    # a slot layout that resolves other hours than it was saved with stops the row by name, nothing captured
    res, page = _slot_session(tmp_path / "c", "60", "regular")
    assert res["outcome"] == bc.GATE_FAILED and "not the extended session" in res["reason"], res
    assert "inject" not in res["steps"]


def test_a_row_naming_the_rig_runs_on_an_extended_slot_and_the_legacy_rule_is_unchanged():
    assert bc.layout_serves(bc.RIG_LAYOUT_ID, bc.SLOT_B_LAYOUT_ID, slot_mode=True)
    assert not bc.layout_serves(bc.RIG_REGULAR_LAYOUT_ID, bc.SLOT_B_LAYOUT_ID, slot_mode=True)
    assert not bc.layout_serves(bc.RIG_LAYOUT_ID, bc.SLOT_B_LAYOUT_ID, slot_mode=False)
    assert bc.layout_serves(bc.RIG_LAYOUT_ID, bc.RIG_LAYOUT_ID, slot_mode=False)
    assert set(bc.SLOT_LAYOUTS) == {"A", "B", "C"} and bc.SLOT_LAYOUTS["A"] == bc.RIG_LAYOUT_ID
    assert len(set(bc.SLOT_LAYOUTS.values())) == 3 and all(bc.LAYOUT_ID_RX.match(x) for x in bc.SLOT_LAYOUTS.values())
    assert all(bc.LAYOUT_HOURS[x] == "extended" for x in bc.SLOT_LAYOUTS.values())


def test_a_slot_job_below_the_ram_floor_stops_itself(tmp_path, monkeypatch):
    monkeypatch.setattr(bc, "free_ram_bytes", lambda: 2 * 1024 ** 3)
    m, beh = _slot_manifest(tmp_path, "row", '//@version=6\nindicator("R")\nplot(close)\n')
    page = bd.RecordingTVPage(behaviours=beh)
    code, rd, _ = bd.slot_run(page, m, tmp_path / "run", "B")
    assert code == 2 and "row" not in rd.results()                 # the row was never claimed
    assert [e for e in _ledger(tmp_path / "run") if e["event"] == "abort" and "free RAM" in e["reason"]]
    assert not [w for w in _writes(page) if w[1] in ("SET_SOURCE", "ADD")]
    # and at launch: below the floor the job never even connects
    fake = _FakePW(browser=object())
    args = types.SimpleNamespace(cdp="http://127.0.0.1:9333", slot="B", slot_info={})
    assert bc._launch_cdp(args, lambda p: 0, playwright_factory=fake) == 2 and fake.connected == []


class _FakeCDP:
    def __init__(self, browser):
        self.b, self.sent = browser, []

    def send(self, method, params=None):
        self.sent.append((method, params))
        b = self.b
        if method == "Target.getTargets":
            return {"targetInfos": [{"targetId": t, "type": "page"} for t in b.windows]}
        if method == "Target.createTarget":
            assert params.get("newWindow") is True, "a slot is a WINDOW, never a tab"
            tid = f"T{len(b.windows) + 1}"
            pg = bd.RecordingTVPage()
            pg.set_viewport_size = lambda v, pg=pg: setattr(pg, "viewport", v)
            pg.target_id = tid
            b.windows[tid] = pg
            b.ctx.pages.append(pg)
            return {"targetId": tid}
        if method == "Browser.getWindowForTarget":
            return {"windowId": 100 + list(b.windows).index(params["targetId"])}
        if method == "SystemInfo.getProcessInfo":
            return {"processInfo": [{"type": "browser", "id": 777}, {"type": "renderer", "id": 778}]}
        if method == "Target.closeTarget":
            pg = b.windows.pop(params["targetId"])
            b.ctx.pages.remove(pg)
            return {"success": True}
        return {}


class _FakeBrowser:
    def __init__(self):
        other = bd.RecordingTVPage()
        other.target_id = "T-other"                                 # another slot's window, already open
        self.windows = {"T-other": other}

        class _Session:
            def __init__(self, pg):
                self.pg = pg

            def send(self, method, params=None):
                return {"targetInfo": {"targetId": self.pg.target_id}}

            def detach(self):
                pass

        self.ctx = types.SimpleNamespace(pages=[other], new_cdp_session=lambda pg: _Session(pg),
                                         wait_for_event=lambda *a, **k: None)
        self.contexts = [self.ctx]
        self.cdp = _FakeCDP(self)
        self.closed = False

    def new_browser_cdp_session(self):
        return self.cdp

    def close(self):
        self.closed = True


def test_launch_cdp_opens_its_own_window_and_closes_only_that_window(tmp_path, monkeypatch):
    monkeypatch.setattr(bc, "free_ram_bytes", lambda: 8 * 1024 ** 3)
    browser = _FakeBrowser()
    fake = _FakePW(browser=browser)
    seen = {}

    def body(page):
        seen["page"], seen["url"], seen["vp"] = page, page.url, getattr(page, "viewport", None)
        return 0
    args = types.SimpleNamespace(cdp="http://127.0.0.1:9333", slot="C", slot_info={}, broker_pid=4242,
                                 slot_state_dir=str(tmp_path))
    assert bc._launch_cdp(args, body, playwright_factory=fake) == 0
    assert fake.connected == ["http://127.0.0.1:9333"] and fake.launched == []   # connects; never launches a browser
    assert seen["url"] == bc.layout_url(bc.SLOT_C_LAYOUT_ID) and seen["vp"] == bc.RIG_VIEWPORT
    tid = seen["page"].target_id
    closes = [p["targetId"] for m, p in browser.cdp.sent if m == "Target.closeTarget"]
    assert closes == [tid] and "T-other" in browser.windows and not browser.closed    # ONLY its own window
    assert args.slot_info == {"slot": "C", "layoutId": bc.SLOT_C_LAYOUT_ID, "cdpTargetId": tid, "cdpWindowId": 101,
                              "brokerPid": 4242, "browserPid": 777}
    assert not (tmp_path / "tvslotC.window.json").exists()
    # signed out: INCONCLUSIVE, no body, the window still closed, the browser never closed
    browser2 = _FakeBrowser()
    monkeypatch.setattr(bc, "layout_access", lambda page: ("signed_out", "HTTP 403"))
    called = []
    args2 = types.SimpleNamespace(cdp="http://x", slot="B", slot_info={})
    assert bc._launch_cdp(args2, lambda p: called.append(p), playwright_factory=_FakePW(browser=browser2)) == 2
    assert not called and list(browser2.windows) == ["T-other"] and not browser2.closed


def test_run_refuses_a_half_slot_or_a_slot_clean_save(tmp_path, capsys):
    m = tmp_path / "m.json"
    m.write_text(json.dumps({"schema": "uct.vendor-batch-manifest/v1", "scripts": []}), encoding="utf-8")
    base = ["run", "--manifest", str(m), "--run-dir", str(tmp_path / "r")]
    assert bc.main(base + ["--cdp", "http://x"]) == 2
    assert bc.main(base + ["--slot", "B"]) == 2
    assert bc.main(base + ["--cdp", "http://x", "--slot", "B", "--clean-save"]) == 2
    assert bc.main(base + ["--cdp", "http://x", "--slot", "B", "--layout", bc.RIG_REGULAR_LAYOUT_ID]) == 2
    out = capsys.readouterr().out
    assert "go together" in out and "EXCLUSIVE tv.lock job" in out and "its own layout" in out


# ── the lock protocol ─────────────────────────────────────────────────────────────────────────────────────────────
def _locks(d, pid, alive=None):
    return ts.TvLocks(d, pid=pid, alive=alive or (lambda p: True), poll_s=0.01)


def test_an_exclusive_holder_waits_for_slot_claims_to_drain_and_blocks_new_ones(tmp_path):
    job = _locks(tmp_path, 101)
    a = job.claim("A", timeout_s=1)
    assert job.holder()[0] == "shared"
    ex = ts.TvLocks(tmp_path, pid=202, alive=lambda p: True, poll_s=0.05)
    got = {}

    def take():
        ex.take_exclusive("clean-save", timeout_s=10, log=lambda *_: None, wait_broker=False)
        got["at"] = _time.monotonic()
    t = threading.Thread(target=take)
    t.start()
    deadline = _time.monotonic() + 5
    while not (tmp_path / ts.WANT_NAME).exists() and _time.monotonic() < deadline:
        _time.sleep(0.01)
    _time.sleep(0.1)
    assert (tmp_path / ts.WANT_NAME).exists() and "at" not in got     # announced, and waiting on the running claim
    newcomer = _locks(tmp_path, 303)
    with pytest.raises(ts.Timeout, match="exclusive taker is waiting"):
        newcomer.claim("B", timeout_s=0.1, log=lambda *_: None)       # no new slot claim while it waits
    released = _time.monotonic()
    job.release(a)
    t.join(10)
    assert got["at"] >= released and ex.holder()[0] == "exclusive"
    assert "clean-save pid=202" in ex.holder()[1] and not (tmp_path / ts.WANT_NAME).exists()
    with pytest.raises(ts.Timeout, match="held exclusively"):
        newcomer.claim(None, timeout_s=0.1, log=lambda *_: None)      # nor while it holds
    ex.release_exclusive()
    assert newcomer.claim(None, timeout_s=1) == "A"


def test_an_exclusive_taker_waits_on_the_claims_themselves_even_if_tv_lock_was_deleted(tmp_path):
    job = _locks(tmp_path, 101)
    job.claim("A", timeout_s=1)
    (tmp_path / ts.LOCK_NAME).unlink()                                 # removed by hand while the slot job runs
    with pytest.raises(ts.Timeout, match=r"1 slot claim\(s\) still run"):
        _locks(tmp_path, 202).take_exclusive("repair", timeout_s=0.2, log=lambda *_: None, wait_broker=False)
    assert not (tmp_path / ts.LOCK_NAME).exists() and not (tmp_path / ts.WANT_NAME).exists()


def test_a_slot_unaware_tool_and_the_slots_exclude_each_other(tmp_path):
    lock = tmp_path / ts.LOCK_NAME

    def legacy_take():                                                 # what tv_run.py / afterclose_slots.py do
        try:
            fd = os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            return False
        os.write(fd, b"tv_run legacy 1")
        os.close(fd)
        return True
    job = _locks(tmp_path, 101)
    a = job.claim("A", timeout_s=1)
    b = _locks(tmp_path, 102).claim(None, timeout_s=1)
    assert b == "B" and not legacy_take()                              # the slot group holds tv.lock
    job.release(a)
    assert not legacy_take()                                           # one slot job still runs
    _locks(tmp_path, 102).release(b)
    assert not lock.exists() and legacy_take()                         # the last one out frees it; the legacy tool runs
    with pytest.raises(ts.Timeout, match="held exclusively"):
        _locks(tmp_path, 103).claim(None, timeout_s=0.1, log=lambda *_: None)
    lock.unlink()
    assert _locks(tmp_path, 103).claim(None, timeout_s=1) == "A"


def test_at_most_three_slot_jobs_and_a_dead_jobs_claims_are_reclaimed(tmp_path):
    dead = set()

    def alive(p):
        return p not in dead
    got = [_locks(tmp_path, 400 + i, alive).claim(None, timeout_s=1) for i in range(3)]
    assert sorted(got) == ["A", "B", "C"]
    with pytest.raises(ts.Timeout, match="busy"):
        _locks(tmp_path, 500, alive).claim(None, timeout_s=0.1, log=lambda *_: None)
    dead.add(401)                                                       # slot B's job died without releasing
    assert _locks(tmp_path, 500, alive).claim(None, timeout_s=1) == "B"
    assert "401-B" not in ts.TvLocks(tmp_path, alive=alive).live_claims()
    # a claim that names the batch CHILD lives while the child lives
    dead.add(402)                                                       # slot C's job died too
    j = _locks(tmp_path, 600, alive)
    s = j.claim(None, timeout_s=1)
    j.add_pid(s, 601)
    dead.add(600)                                                       # the wrapper dies, its batch child runs on
    assert f"600-{s}" in ts.TvLocks(tmp_path, alive=alive).live_claims()
    assert ts.TvLocks(tmp_path, alive=alive).slot_busy(s)


def test_ram_refusal_reads_the_floor():
    assert ts.ram_refusal(read=lambda: 4 * 1024 ** 3) is None
    assert "under the 3 GB" in ts.ram_refusal(read=lambda: 2 * 1024 ** 3)
    assert "could not be read" in ts.ram_refusal(read=lambda: None)
    assert ts.MIN_FREE_RAM_BYTES == bc.MIN_SLOT_FREE_RAM_BYTES == 3 * 1024 ** 3
