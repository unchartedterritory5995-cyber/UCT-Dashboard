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


def test_a_covered_add_to_chart_is_never_clicked(tmp_path):
    manifest, page = _one_script(tmp_path)
    page.covered.add("Add to chart")
    _, rd, _ = bd.run(page, manifest, tmp_path / "run", bd.fast_opts())
    res = rd.results()["x"]
    assert res["outcome"] == bc.GATE_FAILED and "covered at its centre" in res["reason"], res
    assert page.adds == [("add", False)] and not page.studies


def test_two_create_new_rows_stop_the_row_before_the_pointer_touches_either(tmp_path):
    manifest, page = _one_script(tmp_path)
    page.menu_rows["Create new"] = 2
    _, rd, _ = bd.run(page, manifest, tmp_path / "run", bd.fast_opts())
    res = rd.results()["x"]
    assert res["outcome"] == bc.GATE_FAILED, res
    assert "the menu row `Create new` was not clicked: 2 visible 'Create new' in an open menu" in res["reason"]
    assert not _pointer_at(page, bd.CREATE_XY) and not _pointer_at(page, bd.INDICATOR_XY)
    assert "SET_SOURCE" not in page.names() and "ADD" not in page.names()


def test_a_covered_indicator_row_is_not_clicked(tmp_path):
    manifest, page = _one_script(tmp_path)
    page.covered.add("Indicator")
    _, rd, _ = bd.run(page, manifest, tmp_path / "run", bd.fast_opts())
    res = rd.results()["x"]
    assert res["outcome"] == bc.GATE_FAILED and "the menu row `Indicator` was not clicked" in res["reason"], res
    assert _pointer_at(page, bd.CREATE_XY) == ["move"]                     # hovered `Create new`, as before
    assert not _pointer_at(page, bd.INDICATOR_XY) and "SET_SOURCE" not in page.names()


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
