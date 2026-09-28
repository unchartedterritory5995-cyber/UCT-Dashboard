"""Rails for the wave-10 proof walk's own instrument (tools/notebook_proof_walk.py).

The walk drives a browser over a sandbox; what these rails exercise is its JUDGES -- the pure
functions that turn an observation into a verdict -- and the ties between its constants and the
files that own them. Every judge carries its planted-defect control here as well as in the page
(the walk runs each control in the real browser before its sweep's findings are read).
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from tools import notebook_feature_rail_census as RC
from tools import notebook_proof_walk as W

REPO = Path(__file__).resolve().parents[1]


def test_the_judges_self_check_passes():
    assert W.self_check() == 0


@pytest.mark.parametrize("url", ["http://x/api/j2/telemetry", "http://x/api/client-errors",
                                 "http://x/api/j2/telemetry?e=save_success"])
def test_a_telemetry_post_alone_is_never_evidence(url):
    # the controller's rule for this lane: a telemetry POST does not show a control did anything
    assert W.judge_click({"requests": [{"method": "POST", "url": url}]}) == ("DEAD", [])


def test_a_product_request_is_evidence_and_a_polled_one_is_not():
    live = W.judge_click({"requests": [{"method": "POST", "url": "http://x/api/j2/notes/abc123def456/favorite"}]})
    assert live == ("LIVE", ["request"])
    polled = W.judge_click({"requests": [{"method": "GET", "url": "http://x/api/alerts"}],
                            "noise_endpoints": ["/api/alerts"]})
    assert polled == ("DEAD", [])


def test_every_effect_kind_is_evidence_on_its_own():
    for k in ("download", "filechooser", "popup", "dialog", "print", "clipboard"):
        assert W.judge_click({k: 1}) == ("LIVE", [k])
    assert W.judge_click({"url_before": "/a", "url_after": "/b"})[1] == ["navigation"]
    assert W.judge_click({"reloaded": True})[1] == ["navigation"]
    assert W.judge_click({"expanded": 1})[1] == ["expanded"]
    assert W.judge_click({"state_changed": True})[1] == ["state"]


def test_endpoint_templates_fold_ids_and_drop_the_query():
    assert W.normalize_endpoint("http://h/api/j2/notes/0f3c2a9b8e7d4c1a?x=1") == "/api/j2/notes/{id}"
    assert W.normalize_endpoint("http://h/api/j2/notes/12/lock") == "/api/j2/notes/{id}/lock"
    assert W.normalize_endpoint("http://h/api/j2/notes/tags") == "/api/j2/notes/tags"


def test_a_failure_sentence_must_be_new_and_a_sentence():
    base = [["All notes", "Unfiled"]]
    assert W.judge_failure(base, ["All notes", "Unfiled"], [])["verdict"] == "SILENT"
    assert W.judge_failure(base, ["All notes", "Retry"], [])["verdict"] == "SILENT"   # one word is not a sentence
    got = W.judge_failure(base, ["All notes"], ["We could not load your notes. Try again."])
    assert got["verdict"] == "SENTENCE"
    # a number changing (a count, a time) is not new text
    assert W.judge_failure([["3 notes in this folder"]], ["5 notes in this folder"], [])["verdict"] == "SILENT"


def test_an_empty_state_after_a_failure_is_flagged_not_trusted():
    got = W.judge_failure([["Proof note one"]], ["No notes yet. Start a note to begin."], [])
    assert got["verdict"] == "SENTENCE" and got["empty_state_suspect"] is True


def test_geometry_judges_each_kind_and_the_touch_boundary():
    cell = {"vw": 390, "docScrollW": 390, "docClientW": 390, "pageScrollers": [
        {"role": "page", "desc": "main", "scrollW": 445, "clientW": 390, "widenedBy": [{"desc": "div.strip"}]}],
        "offenders": [{"kind": "cutoff", "desc": "div.x", "right": 500, "area": "notebook"}],
        "controls": [
            {"name": "small", "tag": "BUTTON", "inViewport": True, "w": 30, "h": 30},
            {"name": "inline", "tag": "A", "inViewport": True, "w": 30, "h": 16, "inlineLink": True},
            {"name": "covered", "tag": "BUTTON", "inViewport": True, "w": 50, "h": 50, "occluder": "div.card",
             "centerCovered": True},
            {"name": "offscreen", "tag": "BUTTON", "inViewport": False, "w": 10, "h": 10},
            {"name": "scroller", "tag": "A", "inViewport": False, "w": 90, "h": 44, "offscreenInScroller": True}]}
    j = W.judge_geometry(cell, width=390)
    kinds = sorted((f["kind"], f.get("control") or f.get("what")) for f in j["findings"])
    assert kinds == [("cutoff", "div.x"), ("occluded", "covered"), ("overflow", "main"), ("tap", "small")]
    assert j["reachable_in_scroller"] == ["scroller"]
    desk = W.judge_geometry({**cell, "vw": 1200}, width=1200)
    assert not [f for f in desk["findings"] if f["kind"] == "tap"], "the 44 px rule applies at <= 1024 only"


def test_every_sweep_has_a_control_that_an_empty_reading_fails():
    for sweep in W.SWEEPS:
        ok, why = W.control_ok(sweep, {})
        assert not ok, f"{sweep}: an instrument that saw nothing passed its control ({why})"


def test_the_tap_floor_is_the_token_the_css_declares():
    css = (REPO / "app/src/styles/tokens.css").read_text(encoding="utf-8")
    m = re.search(r"--tap-min:\s*(\d+)px", css)
    assert m and float(m.group(1)) == W.TAP_MIN


def test_the_touch_tier_is_the_breakpoint_file_s():
    js = (REPO / "app/src/styles/breakpoints.js").read_text(encoding="utf-8")
    # the BP object itself: the file's header comment also says "tablet:  641px - 1024px"
    m = re.search(r"export const BP = \{[^}]*?\btablet:\s*(\d+)", js)
    assert m and int(m.group(1)) == W.TOUCH_MAX_WIDTH
    assert W.VIEWPORTS["tablet"]["width"] <= W.TOUCH_MAX_WIDTH < W.VIEWPORTS["desktop"]["width"]


def test_axe_is_the_repo_s_exact_pin():
    pkg = json.loads((REPO / "app/package.json").read_text(encoding="utf-8"))
    ver = (pkg.get("devDependencies") or {}).get("axe-core") or (pkg.get("dependencies") or {}).get("axe-core")
    assert ver and re.fullmatch(r"\d+\.\d+\.\d+", ver), f"axe-core is not an exact pin: {ver!r}"
    assert "wcag2aa" in W.AXE_TAGS and "wcag22aa" in W.AXE_TAGS


def test_the_census_probes_every_shipped_inventory_row():
    # every §B1 row the ledger calls shipped (DONE / PARTIAL) must have a census probe; a row the
    # census forgot would read as "every path works" by omission
    c = RC.census()
    shipped = {f["row"] for f in c["features"] if f.get("bucket") in RC.SHIPPED_BUCKETS}
    probed = {row for row, _feature, _probe in W.CENSUS}
    assert shipped, "the census found no shipped row (a broken derivation)"
    assert not (shipped - probed), f"shipped rows the path census never probes: {sorted(shipped - probed)}"


def test_the_census_coverage_check_can_fail():
    planted = {"G-999"}
    probed = {row for row, _f, _p in W.CENSUS}
    assert planted - probed == planted


def _manifest_ids() -> set:
    js = (REPO / "app/src/pages/journal-2-0/a11y/notebookSurfaces.js").read_text(encoding="utf-8")
    # the recipe / coveredBy ids, and every file the manifest (or its outside-population list) names
    ids = set(re.findall(r"(?:recipe|coveredBy):\s*'([^']+)'", js))
    ids |= {Path(k).stem for k in re.findall(r"'([^']+\.jsx)':", js)}
    return ids


def test_every_surface_names_a_real_manifest_entry():
    ids = _manifest_ids()
    assert len(ids) > 40, "the manifest reader found almost nothing (a broken read)"
    bad = [(s.sid, m) for s in W.SURFACES for m in s.manifest if m not in ids]
    assert not bad, f"surfaces claiming manifest ids the manifest does not have: {bad}"


def test_findings_are_counted_per_sweep_and_an_unmeasured_cell_is_not_one():
    census = {"rows": [{"cells": {"desktop": {"verdict": "BROKEN"}, "touch": {"verdict": "INCONCLUSIVE"},
                                  "keyboard": {"verdict": "NO-DOOR"}}}]}
    assert W.findings_count("census", census) == 2
    assert W.findings_count("geometry", {"cells": [{"findings": [{}, {}]}, {"status": "UNREACHED"}]}) == 2
    assert W.findings_count("axe", {"runs": [{"status": "MEASURED", "violations": 3},
                                             {"status": "ERROR", "violations": 9}]}) == 3
    assert W.findings_count("silent", {"reads": [{"verdict": "SILENT"}, {"verdict": "SENTENCE"}],
                                       "writes": [{"status": "UNREACHED"}]}) == 1
    assert W.findings_count("deadclick", {"surfaces": [{"counts": {"DEAD": 2, "LIVE": 9}},
                                                       {"status": "UNREACHED"}]}) == 2
    for sweep in W.SWEEPS:
        assert W.findings_count(sweep, {}) == 0, sweep


def test_a_wait_pumps_the_page_rather_than_sleeping(monkeypatch):
    # a bare time.sleep blocks the sync API's dispatcher, so an event-fed value (the URL after a
    # pushState, a download counter) never changes while the walk waits -- the shake-out read
    # Today and Export BROKEN on exactly that
    calls = []

    class FakePage:
        def is_closed(self):
            return False

        def wait_for_timeout(self, ms):
            calls.append(ms)

    def no_sleep(_s):
        raise AssertionError("the wait slept instead of pumping the page")

    monkeypatch.setitem(W.PUMP, "pg", FakePage())
    monkeypatch.setattr(W.time, "sleep", no_sleep)
    seq = iter([False, False, True])
    assert W.wait_true(lambda: next(seq), timeout=5, every=0.01) is True
    assert calls == [10.0, 10.0]
