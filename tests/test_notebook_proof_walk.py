"""Rails for the wave-10 proof walk's own instrument (tools/notebook_proof_walk.py).

The walk drives a browser over a sandbox; what these rails exercise is its JUDGES -- the pure
functions that turn an observation into a verdict -- and the ties between its constants and the
files that own them. Every judge carries its planted-defect control here as well as in the page
(the walk runs each control in the real browser before its sweep's findings are read).
"""
from __future__ import annotations

import contextlib
import hashlib
import importlib
import json
import os
import re
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from tools import notebook_feature_rail_census as RC
from tools import notebook_proof_walk as W

REPO = Path(__file__).resolve().parents[1]

# ── wave 10 lane WK6 round 2: a real origin for a fetch()-using fixture ────────────────────
# `page.set_content()` alone leaves the page on `about:blank`, whose opaque origin makes a
# RELATIVE `fetch('/api/...')` fail synchronously (no URL to resolve it against) -- so no
# "request" event ever fires and `page.route()` never engages. `_FIXTURE_DOC_URL` is fulfilled
# entirely by `page.route()` (never a real network call, never a real server) so `pg.goto()`
# gives the page a real origin a relative fetch can resolve against.
_FIXTURE_DOC_URL = "http://notebook-fixture.test/"


def _goto_fixture_doc(pg, html: str) -> None:
    pg.route(_FIXTURE_DOC_URL, lambda route: route.fulfill(status=200, content_type="text/html", body=html))
    pg.goto(_FIXTURE_DOC_URL)


# ── wave 10 lane WK6 round 2: a REAL loopback server for a genuinely-delayed fetch ──────────
# A `page.route()` handler that calls `time.sleep()` does NOT give a genuinely-delayed
# response -- Playwright Python's sync API dispatches route callbacks on its one connection
# thread, so a sleeping handler stalls EVERY other Playwright call issued while it sleeps,
# including `locator.click()`'s own internal actionability polling. MEASURED: a 0.7s
# `time.sleep()` inside a `page.route()` handler made `loc.click()` itself take ~0.71s to
# RETURN -- the click, not quiesce(), was absorbing the delay, which would have made any
# rail built on it pass for the wrong reason regardless of what `quiesce()` does.
# Fulfilling the route from a background `threading.Thread` instead is NOT a fix -- Playwright
# Python's sync API is greenlet-bound to the thread that created it, and a cross-thread
# `route.fulfill()` call raises `greenlet.error: cannot switch to a different thread`
# (reproduced in the session scratchpad, `wk6_probe_thread_route.py`).
# A genuine fix needs a delay OUTSIDE Playwright's own connection entirely: a real, separate
# TCP server on a background thread that the BROWSER (not Playwright's Python driver) talks
# to over real sockets. ⚠️ It must be SAME-ORIGIN with the page, not merely CORS-permissive --
# a page origin Chrome cannot classify as loopback (e.g. an unresolved `page.route()`-only
# hostname, which Chrome treats as public address space) hitting a REAL `127.0.0.1` target
# trips Private Network Access and the fetch fails with `ERR_FAILED` before any CORS headers
# are even read (reproduced, `wk6_probe_realserver.py`) -- so the fixture DOCUMENT is served
# by this same loopback server too, and the fetch path is relative.
class _DelayedHandler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 -- BaseHTTPRequestHandler's own naming
        if self.path.startswith(self.server.slow_path):  # type: ignore[attr-defined]
            time.sleep(self.server.slow_seconds)  # type: ignore[attr-defined]
            body, ctype = b"{}", "application/json"
        else:
            body, ctype = self.server.doc_html, "text/html"  # type: ignore[attr-defined]
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):  # noqa: D401 -- silence BaseHTTPRequestHandler's stderr logging
        pass


@contextlib.contextmanager
def _loopback_doc_with_delayed_endpoint(doc_html: str, slow_path: str, slow_seconds: float):
    """Serves `doc_html` at `/` and a `slow_seconds`-delayed 200 JSON response at `slow_path`,
    both from one real `127.0.0.1` server -- yields the doc's URL."""
    srv = ThreadingHTTPServer(("127.0.0.1", 0), _DelayedHandler)
    srv.doc_html = doc_html.encode()
    srv.slow_path = slow_path
    srv.slow_seconds = slow_seconds
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{srv.server_address[1]}/"
    finally:
        srv.shutdown()
        thread.join(timeout=5)


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


# ── wave 10 lane WK3: a shared, junctioned app/node_modules can predate axe-core ────────────
# Measured live: this lane's `app/node_modules` is a junction into another lane's install
# (notebook-k) that has no `axe-core` directory at all (its package.json never declared the
# dependency), so `run_sweeps` -- which reads axe.min.js unconditionally before seeding, for
# EVERY sweep, not only axe -- raised FileNotFoundError before a single control ran. The fix
# is a read-only override, defaulting to the exact same path every other worktree resolves.

def test_axe_core_path_defaults_to_the_pinned_junction_path_and_can_be_overridden(monkeypatch):
    monkeypatch.delenv("NOTEBOOK_PROOF_WALK_AXE_CORE", raising=False)
    assert W._axe_core_path() == W.REPO / "app" / "node_modules" / "axe-core" / "axe.min.js"
    monkeypatch.setenv("NOTEBOOK_PROOF_WALK_AXE_CORE", "C:/elsewhere/axe.min.js")
    assert W._axe_core_path() == W.Path("C:/elsewhere/axe.min.js")


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


# ── F7: a request the page's own timer sent is never the click's effect ──────────────────
# Run 26e03bbe8's control read the planted dead styled button LIVE on one request,
# `GET /api/voice/insights/unspoken` -- the voice poll's first tick (8 s after load), far
# longer than the 1.5 s idle window that learns noise endpoints. The instrument, not the
# control, was wrong: it credited a request to the click because of WHEN it arrived.

POLL = {"method": "GET", "url": "http://x/api/voice/insights/unspoken"}


def test_a_request_the_pages_own_timer_sent_is_never_the_clicks_effect():
    assert W.judge_click({"requests": [POLL], "background_requests": [POLL]}) == ("DEAD", [])
    # CONTROL: the same request with no background record is still evidence -- the judge is
    # not simply ignoring the endpoint
    assert W.judge_click({"requests": [POLL]}) == ("LIVE", ["request"])


def test_background_requests_are_subtracted_one_for_one():
    # the click asked for the same URL the poll did: one of the two is the click's own
    got = W.without_background([POLL, POLL], [POLL])
    assert got == [POLL]
    assert W.judge_click({"requests": [POLL, POLL], "background_requests": [POLL]})[0] == "LIVE"
    # the method is part of the identity: a background GET does not cancel the click's POST
    post = {"method": "POST", "url": POLL["url"]}
    assert W.without_background([post], [POLL]) == [post]
    # a fragment never separates two readings of one request (the page strips it, Playwright omits it)
    assert W.without_background([POLL], [{"method": "get", "url": POLL["url"] + "#x"}]) == []


def test_the_deadclick_control_fails_when_the_planted_poller_was_never_seen():
    good = {"plant-dead": "DEAD", "plant-dead-styled": "DEAD", "plant-live": "LIVE", "plant-poller": "IN-WINDOW"}
    assert W.control_ok("deadclick", good)[0] is True
    # non-vacuity: DEAD, DEAD, LIVE with a poller that never fired inside a dead click's window
    # proves nothing about the background fix, so it must not pass
    assert W.control_ok("deadclick", {**good, "plant-poller": "NOT-SEEN"})[0] is False
    # and the pre-F7 failure itself
    assert W.control_ok("deadclick", {**good, "plant-dead-styled": "LIVE"})[0] is False


# ── wave 10 lane WK3: geometry fixes 1+2 (occluder mislabel; "at rest" semantics) ───────────
# Found live by lane FX: GEOM_JS's occluder description could climb past a non-div hit (e.g.
# MobileNav's <header>) all the way to a full-viewport wrapper div, whose `.innerText` reads a
# portaled skip link's own (off-screen) text first -- blaming the skip link for occlusions it
# never causes. And a control that happens to sit under FIXED/STICKY chrome mid-scroll was
# always reported occluded even when scrolling it clear would resolve it. The browser-side fix
# lives entirely inside GEOM_JS (tightOccluderAncestor / canEscapeByScroll); this rail is the
# pure-Python half -- the CONTROL that a live sandbox run exercises (plant-mislabel,
# plant-scroll-clear, plant-scroll-pinned) must actually be REQUIRED, not silently optional.

def test_the_geometry_control_requires_the_mislabel_and_restscroll_plants():
    base = {"plant-wide": "found", "plant-small": "found", "plant-covered": "found",
            "plant-mislabel": "named-the-real-occluder", "plant-scroll-clear": "CLEAR",
            "plant-scroll-pinned": "OCCLUDED"}
    assert W.control_ok("geometry", base)[0] is True
    # non-vacuity: each new plant can fail the control on its own
    assert W.control_ok("geometry", {**base, "plant-mislabel": "named the decoy: 'DIV \"Off-screen decoy text\"'"})[0] is False
    assert W.control_ok("geometry", {**base, "plant-scroll-clear": "OCCLUDED"})[0] is False
    assert W.control_ok("geometry", {**base, "plant-scroll-pinned": "CLEAR"})[0] is False


# wave 10 lane WK7: background-ness now travels ON THE REQUEST, as headers (INSTRUMENT_JS's
# `stamp`), never a second array with its own snapshot index -- so the harness reads it back the
# way `Tap._on_request` does, off the fetch call itself, not off a `P.bgReqs` slice that no
# longer exists. `Headers` is a Node global (undici-backed since Node 18), no polyfill needed.
_NODE_HARNESS = r"""
globalThis.window = globalThis;
globalThis.location = {href: 'http://sandbox.test/journal/notebook'};
globalThis.document = {documentElement: null, addEventListener() {}};
globalThis.navigator = {};
globalThis.__calls = [];
globalThis.fetch = (input, init) => {
  globalThis.__calls.push({url: String(input), method: (init && init.method) || 'GET',
    headers: Object.fromEntries(((init && init.headers) || new Headers()).entries())});
  return Promise.resolve({ok: true});
};
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 1);
eval(require('fs').readFileSync(0, 'utf8'));          // INSTRUMENT_JS, then MARK_JS as `mark`
// a poller set up BEFORE the click is armed (the voice poll's shape), firing AFTER it
setTimeout(() => fetch('/api/voice/insights/unspoken'), 30);
const t = performance.now(); while (performance.now() - t < 3) {}   // the arm comes strictly later
const m = mark();                                      // the click is armed here, at top level
// a timer the CLICK schedules (a debounce) is the click's own
setTimeout(() => fetch('/api/j2/notes/abc/favorite', {method: 'POST'}), 5);
setTimeout(() => process.stdout.write(JSON.stringify({calls: globalThis.__calls, reqMark: m.reqMark})), 80);
"""


def test_the_in_page_half_tags_a_pre_arm_timer_request_and_not_the_clicks_own(tmp_path):
    import shutil
    import subprocess
    node = shutil.which("node")
    assert node, "node is required to run the instrument's in-page half (it is on this box and in CI)"
    js = W.INSTRUMENT_JS + "\nglobalThis.mark = " + W.MARK_JS + ";\n"
    r = subprocess.run([node, "-e", _NODE_HARNESS], input=js, capture_output=True, text=True,
                       encoding="utf-8", timeout=60)
    assert r.returncode == 0, r.stderr[-2000:]
    out = json.loads(r.stdout)
    # the harness's own `fetch` stub captures `String(input)` verbatim, unresolved -- unlike the
    # RETIRED `P.bgReqs.push({..., url: u.href})`, `stamp` never builds an absolute URL (it has
    # no need to: everything it records now travels as headers on the real request, which the
    # browser resolves itself). Key by the same relative path INSTRUMENT_JS was handed.
    calls = {c["url"]: c for c in out["calls"]}
    poll = calls["/api/voice/insights/unspoken"]
    own = calls["/api/j2/notes/abc/favorite"]
    # the poll set up before the arm fired after it: stamped background, on the wire
    assert poll["headers"].get("x-uct-proof-bg") == "1", poll
    # every stamped request carries the SAME counter the window mark is drawn from
    assert int(poll["headers"]["x-uct-proof-seq"]) >= 0
    # CONTROL: the click's own timer is NOT background (else every debounced click reads DEAD)
    assert "x-uct-proof-bg" not in own["headers"], own
    assert own["method"] == "POST"


# ── F7 Part A: a failure that is silent BY DESIGN is declared, with its reason ─────────────────

def test_a_declared_silent_by_design_endpoint_reads_EXEMPT_with_its_reason():
    row = W.exempt_verdict({"verdict": "SILENT"}, "POST", "/api/j2/notes/{id}/opened")
    assert row["verdict"] == "EXEMPT" and "recordNoteOpened" in row["exempt_reason"]
    # CONTROL: any other endpoint stays SILENT -- the exemption is not a blanket
    assert W.exempt_verdict({"verdict": "SILENT"}, "POST", "/api/j2/notes/{id}/favorite")["verdict"] == "SILENT"
    assert W.exempt_verdict({"verdict": "SILENT"}, "GET", "/api/j2/notes/{id}/opened")["verdict"] == "SILENT"


def test_an_exemption_never_hides_a_sentence_and_is_not_a_finding():
    said = W.exempt_verdict({"verdict": "SENTENCE"}, "POST", "/api/j2/notes/{id}/opened")
    assert said["verdict"] == "SENTENCE" and "exempt_reason" not in said
    out = {"writes": [{"verdict": "EXEMPT"}, {"verdict": "SILENT"}]}
    assert W.findings_count("silent", out) == 1


def test_the_exemption_list_is_exactly_the_declared_two_and_each_reason_names_real_code():
    # F7: the recents touch; F7 fix round 1 (review I1): the comparison under "All Accounts".
    assert set(W.SILENT_EXEMPT) == {("POST", "/api/j2/notes/{id}/opened"),
                                    ("GET", "/api/j2/accounts/comparison")}
    for reason in W.SILENT_EXEMPT.values():
        assert len(reason) > 80, "an exemption needs a reason a reviewer can check"
    js = (REPO / "app/src/pages/journal-2-0/hooks/useJ2Notes.js").read_text(encoding="utf-8")
    body = js[js.index("export function recordNoteOpened"):]
    body = body[:body.index("\n}\n") if "\n}\n" in body else len(body)]
    # the claim the reason makes: fire-and-forget, its failure swallowed, never awaited
    assert "/opened`" in body and ".catch(() => {})" in body


def test_the_silent_sweep_applies_the_exemption_at_its_one_verdict_site():
    # structural (tools/notebook_proof_walk.py::_forced): the judged row goes through
    # exempt_verdict before it is recorded -- an exemption list the sweep never consults
    # would leave the recents touch reading SILENT in every run
    import inspect
    src = inspect.getsource(W._forced)
    assert "exempt_verdict(row, methods[0], ep)" in src
    assert src.index("judge_failure(") < src.index("exempt_verdict(") < src.index('row["verdict"] = "NOT-TRIGGERED"')


# ── wave 10 lane WK3: 5d's "lock"/"archive"/"save-template" writes were UNREACHED ──────────
# `surface_by_id("nb-note").open()` is `s_note`, which opens a bare note and never opens the
# editor's "More note actions" overflow (NoteMoreMenu.jsx) -- but Lock/Archive/Save as
# template all live inside it (the same menu `f_note_btn`/`f_save_template`/`f_export` already
# open in the census sweep). A bare `_act_click(name)` therefore timed out waiting for a button
# that was never shown, and WK's README recorded exactly that as UNREACHED, not BROKEN.

def test_lock_archive_and_save_template_writes_open_the_more_menu_first():
    import inspect
    acts = {name: act for name, sid, act in W.WRITE_ACTIONS}
    for name in ("lock", "archive", "save-template"):
        src = inspect.getsource(acts[name])
        assert "open_more_note_actions(pg)" in src, f"{name} write action never opens the More note actions menu"
    # CONTROL: an action whose button already lives on the bare note page must not be routed
    # through the menu too -- the fix targets the three menu-only writes, not every write
    for name in ("save-body", "add-tag", "favorite", "new-folder", "new-note", "daily-note"):
        assert "open_more_note_actions" not in inspect.getsource(acts[name]), name


def test_the_comparison_exemption_names_a_rail_that_exists_and_says_the_menu_sentence():
    # F7 fix round 1 (review I1). The reason is a claim ("the menu says it; this rail proves it"),
    # so both halves are checked against the files it names: the rail file exists and carries the
    # quoted describe title, the rail asserts the sentence, and AccountSelector says that sentence
    # through the shared element inside its menu. A reason pointing at a rail that is gone reds here.
    reason = W.SILENT_EXEMPT[("GET", "/api/j2/accounts/comparison")]
    m = re.search(r"Proved by (\S+\.test\.jsx), '([^']+)'", reason)
    assert m, reason
    rail = (REPO / m.group(1)).read_text(encoding="utf-8")
    assert f"describe('{m.group(2)}'" in rail
    assert "Couldn't load your current balances." in rail
    sel = (REPO / "app/src/pages/journal-2-0/components/accounts/AccountSelector.jsx").read_text(encoding="utf-8")
    menu = sel[sel.index("{open && ("):]
    assert "what: 'your current balances', error: comparisonError" in menu[:menu.index("accounts.map")]
    # CONTROL: the parser finds nothing in a reason that names no rail
    assert re.search(r"Proved by (\S+\.test\.jsx), '([^']+)'", W.SILENT_EXEMPT[("POST", "/api/j2/notes/{id}/opened")]) is None


# ── wave 10 lane WK5: the deadclick deadline, redesigned around a PROCESS boundary, never a
# THREAD ─────────────────────────────────────────────────────────────────────────────────────
# WK4 (`e1ef47435`) wrapped `click_one` and a whole surface in `_run_with_deadline`, a wall-clock
# watchdog that ran the wrapped call on a `threading.Thread` and, on overrun, closed its browser
# context FROM THE OUTER thread. Playwright's sync API binds every object it hands back to the
# ONE OS thread that created `sync_playwright()`; a second thread touching any of them raises
# immediately ("Cannot switch to a different thread"), and every WK4 rail for this used a Python
# FAKE for `click_one`/`deadclick_surface` that never touched a real Playwright object at all --
# exactly the gap that let the real defect through undetected
# (docs/notebook/proof/wk4-e1ef47435/README.md, "THE THREADING DEFECT": all 39 deadclick
# surface x mode cells UNREACHED, the mechanism built to catch a hang never got the chance to).
#
# WK5 replaces both levels so NO Playwright object is ever touched from a second OS thread --
# because none is ever touched by a second thread, full stop:
#   - per CLICK (`safe_evaluate` + `_click_or_timeout`): stays on the ONE thread that owns the
#     page. `page.evaluate`'s missing native timeout is answered with a JS-SIDE `Promise.race`,
#     so a stuck async handler returns a bounded sentinel (`EvalTimeout`) instead of blocking
#     Python's read of the CDP response -- an ordinary exception on the SAME thread, not a
#     preemption from another one.
#   - per SURFACE (`deadclick_surface_bounded`): a CHILD OS PROCESS, not a thread. The parent
#     spawns `--deadclick-worker`, waits, and kills the process tree at the deadline -- it never
#     calls a method on a Playwright object the child created, so the kill is safe regardless of
#     what the child's single thread is doing, including a renderer wedged at the native level
#     that even `safe_evaluate`'s JS-side timer cannot catch.
#
# The rails below for the per-click half use a REAL headless Chromium page (no server, never
# `about:blank` navigated anywhere) precisely because a fake cannot prove the cross-thread call
# is gone -- only a real Playwright object, driven for real, can.

@pytest.fixture(scope="module")
def real_browser():
    """Headless Chromium, launched once for this file's real-Playwright rails (no server, no
    navigation past `about:blank` / `set_content`). Module-scoped because launching the browser
    is the expensive part; each rail opens its own fresh page/context."""
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            yield browser
        finally:
            browser.close()


def test_a_never_resolving_evaluate_is_bounded_by_a_js_side_race_not_a_hang(real_browser):
    """`safe_evaluate` answers `page.evaluate`'s missing native `timeout=` (Playwright's Python
    sync API has none at all). A script whose async work never resolves must return a bounded
    `EvalTimeout`, on THIS thread, within its own budget -- not block forever, and not need a
    second thread to rescue it."""
    pg = real_browser.new_page()
    try:
        started = time.monotonic()
        with pytest.raises(W.EvalTimeout):
            W.safe_evaluate(pg, "() => new Promise(() => {})", timeout_ms=250)
        elapsed = time.monotonic() - started
        assert elapsed < 3.0, f"safe_evaluate waited past its own JS-side timer ({elapsed}s)"
        # CONTROL: an ordinary synchronous script still returns its real value, promptly -- the
        # wrapper does not turn every evaluate call into a timeout
        assert W.safe_evaluate(pg, "() => 1 + 1", timeout_ms=250) == 2
    finally:
        pg.close()


def test_a_click_that_never_becomes_actionable_is_bounded_and_named_TIMEOUT(monkeypatch, real_browser):
    """`_click_or_timeout` end to end, over a REAL page: a control permanently covered by an
    opaque overlay can never satisfy Playwright's own actionability check, so `click_one`'s
    native `timeout=` on `.click()` bounds the wait (unchanged by this redesign -- that bound was
    already Playwright-native before WK4 and never was the defect). This lane's own per-click
    deadline then names a control that burned its whole budget TIMEOUT, rather than reporting it
    as an ordinary OCCLUDED/NOT-ACTIONABLE verdict that happens to have taken the whole budget to
    arrive."""
    monkeypatch.setattr(W, "ACTION_TIMEOUT_MS", 400)
    monkeypatch.setattr(W, "HOVER_TIMEOUT_MS", 400)
    pg = real_browser.new_page()
    try:
        pg.set_content(
            '<div data-proof-root="notebook">'
            '  <div style="position:relative;width:120px;height:40px;">'
            '    <button aria-label="Stuck button" style="width:100%;height:100%;">Stuck</button>'
            '    <div style="position:absolute;inset:0;"></div>'
            '  </div>'
            '</div>')
        # click_one reads window.__proof (MARK_JS etc.) -- normally installed by
        # World.new_context's own ctx.add_init_script(INSTRUMENT_JS), which fires on a real
        # navigation. `set_content` does not count as one (measured: an add_init_script'd
        # marker never appears after it), so this page's instrumentation is run directly.
        pg.evaluate(W.INSTRUMENT_JS)
        listing = W.safe_evaluate(pg, W.CONTROLS_JS, '[data-proof-root="notebook"]')
        ctl = next(c for c in listing if c["name"] == "Stuck button")
        tap = W.Tap(pg)
        surf = W.surface_by_id("nb-bulk")   # any real Surface; before_click is None here
        started = time.monotonic()
        r = W._click_or_timeout(None, pg, tap, '[data-proof-root="notebook"]', ctl, surf, "desk", deadline=0.1)
        elapsed = time.monotonic() - started
        assert r["verdict"] == "TIMEOUT", r
        assert r["reset"] is True
        assert elapsed < 3.0, f"a permanently non-actionable control waited past its native ceiling ({elapsed}s)"
    finally:
        pg.close()


def test_CONTROL_a_normal_click_on_a_real_page_reads_MEASURED(real_browser):
    """CONTROL for the two rails above: an ordinary, fully actionable control on a real page
    goes through the WHOLE per-surface pipeline (`deadclick_surface`, in-process -- the process
    boundary in `deadclick_surface_bounded` is a process-management concern, mutation-proved
    separately below; it is not itself a Playwright interaction) and reads MEASURED, never
    TIMEOUT. The deadline mechanism must not manufacture a timeout where there is none."""
    def open_fixture(W_, pg):
        pg.set_content(
            '<div data-proof-root="notebook">'
            '  <button aria-label="Plain button" '
            '          onclick="this.setAttribute(\'aria-expanded\', \'true\')">Plain</button>'
            '</div>')
        return '[data-proof-root="notebook"]'

    surf = W.Surface("t-plain", open_fixture, sweeps=("deadclick",))
    world = W.World(real_browser, "http://127.0.0.1:1", Path(tempfile.gettempdir()))
    rec = W.deadclick_surface(world, surf, "desk")
    assert rec["status"] == "MEASURED", rec
    assert rec["counts"], "no control was measured at all"
    assert "TIMEOUT" not in rec["counts"], rec["counts"]
    assert "ERROR" not in rec["counts"], rec["counts"]
    # wave 10 lane WK6: every control gets a recorded elapsed_ms, non-negative
    assert rec["controls"][0]["elapsed_ms"] >= 0


# ── wave 10 lane WK6: nine deadclick surfaces (nb-list desk/phone, nb-board, nb-calendar,
# nb-timeline, nb-tasks, nb-search, nb-bulk, nb-templates) hit `SURFACE_DEADLINE_S` measuring
# 56-90 controls in 360s, ~4-6s/control (l11-52deeb767/README.md, 2c). None of them were hung --
# each was re-measuring the SAME repeated note-row pattern (a `key` collision: tag|role|name
# with digits folded) 30+ times, and paying two flat settle sleeps (450ms + 1200ms) on every one
# regardless of whether anything was still happening. Two fixes, both provable without a server:
#   (a) `click_one`'s two fixed `wait_for_timeout`s became `quiesce()` -- same CEILING, but
#       returns as soon as the page's own mutation feed has been quiet, instead of always paying
#       the whole window.
#   (b) `deadclick_surface` samples at most `SAMPLE_PER_KEY` occurrences of one repeated `key`;
#       the rest are recorded `REPEATED` (named, counted, never silently dropped), and
#       `rec["measured"]` / `rec["skipped_repeated"]` make found-vs-measured-vs-skipped an
#       honest, always-present accounting -- including on a surface a genuine hang still kills
#       partway through (`SURFACE_DEADLINE_S` is untouched: a TIMEOUT stays possible).

def test_the_sample_gate_allows_exactly_SAMPLE_PER_KEY_then_repeats_forever():
    seen: dict[str, int] = {}
    gate = [W._sample_gate(seen, "k") for _ in range(W.SAMPLE_PER_KEY + 4)]
    assert gate == [False] * W.SAMPLE_PER_KEY + [True] * 4
    assert seen["k"] == W.SAMPLE_PER_KEY + 4
    # CONTROL: a different key gets its OWN budget, unaffected by the first key's count
    assert W._sample_gate(seen, "other") is False


def test_the_sample_gate_never_double_counts_a_single_occurrence():
    seen: dict[str, int] = {}
    for i in range(1, W.SAMPLE_PER_KEY + 1):
        assert W._sample_gate(seen, "k") is False, i
    assert seen["k"] == W.SAMPLE_PER_KEY


def test_quiesce_returns_early_when_quiet_and_still_honours_its_ceiling_when_it_never_settles(real_browser):
    """Goal (a): `quiesce()` must not spend its whole ceiling on a page that is already quiet
    (the waste this lane measured), and must still bound a page that NEVER settles at exactly
    the ceiling the flat sleep it replaces used to spend unconditionally -- a genuinely slow
    effect is never cut short, and a genuinely stuck one is never waited on forever. (round 2:
    the floor means "already quiet" now costs QUIESCE_FLOOR_MS, not near-zero -- still well
    under the 500ms budget this rail checks.)"""
    pg = real_browser.new_page()
    try:
        pg.set_content('<div id="x">still</div>')
        pg.evaluate(W.INSTRUMENT_JS)
        tap = W.Tap(pg)
        started = time.monotonic()
        W.quiesce(pg, tap, 900)
        elapsed = time.monotonic() - started
        assert elapsed < 0.5, f"quiesce spent the whole ceiling on an already-quiet page ({elapsed}s)"
        assert elapsed >= W.QUIESCE_FLOOR_MS / 1000, (
            f"quiesce returned before its own floor ({elapsed}s < {W.QUIESCE_FLOOR_MS}ms)")

        # CONTROL: a page that never stops mutating waits the FULL ceiling -- same as the flat
        # sleep it replaces, never longer and never cut short
        pg.evaluate("() => { setInterval(() => {"
                    "  document.getElementById('x').textContent = String(Math.random()); }, 20); }")
        started = time.monotonic()
        W.quiesce(pg, tap, 400)
        elapsed = time.monotonic() - started
        assert elapsed >= 0.35, f"quiesce returned early on a page that never quiesced ({elapsed}s)"
        assert elapsed < 2.0, f"quiesce waited past its own ceiling ({elapsed}s)"
    finally:
        pg.close()


def test_quiesce_keeps_waiting_while_a_request_is_in_flight_even_though_the_DOM_is_quiet(real_browser):
    """Goal (a) round 2, the network half in isolation: a page whose DOM never changes at all
    (so the DOM+floor phase is satisfied at QUIESCE_FLOOR_MS) but whose ONE request never
    resolves must still make `quiesce()` wait the FULL ceiling -- proving the network check is
    genuinely load-bearing and not a no-op alongside the DOM/floor phase
    (l11dc-4dfc5e447/INVALID.md: "the same flaw affects real controls: a click whose visible
    effect waits on a server reply would read DEAD")."""
    pg = real_browser.new_page()
    try:
        pg.route("**/api/never-resolves", lambda route: None)   # never fulfilled, never aborted
        _goto_fixture_doc(pg, '<div id="x">still</div>')   # a real origin -- a relative fetch()
        pg.evaluate(W.INSTRUMENT_JS)                        # from about:blank fails synchronously
        tap = W.Tap(pg)
        pg.evaluate("() => { fetch('/api/never-resolves').catch(() => {}); }")
        started = time.monotonic()
        W.quiesce(pg, tap, 600)
        elapsed = time.monotonic() - started
        assert elapsed >= 0.55, (
            f"quiesce returned early despite a request still in flight ({elapsed}s) -- "
            f"the network check is not being consulted")
        assert elapsed < 1.5, f"quiesce waited past its own ceiling ({elapsed}s)"
    finally:
        pg.close()


def test_the_planted_poller_control_reads_DEAD_DEAD_LIVE_IN_WINDOW_through_the_real_quiesce(real_browser):
    """Reproduces the CONTROL itself end to end -- `PLANT_DEADCLICK_JS` on a real page (given a
    real origin by `_goto_fixture_doc` so its poller's relative `fetch()` resolves; the poll
    itself intercepted via `page.route`), run through the WHOLE pipeline
    (`deadclick_surface(plant=True)` -> `click_one` -> the real `quiesce()`), then judged by the
    SAME arithmetic `deadclick_sweep`'s own non-vacuity control uses
    (`control_ok('deadclick', got)`). Round 1's floor-less `quiesce()` read
    `plant-poller: NOT-SEEN` here (l11dc-4dfc5e447/INVALID.md); this is the rail that would have
    caught it before the real walk did.

    ⭐ wave 10 lane WK7: NO RETRY, and none is needed any more. `click_one` used to compare TWO
    independently-paced marks -- `n0` (Python's own list, populated as CDP delivers) and
    `bgMark` (a JS-side snapshot of a SEPARATE list) -- and a residual skew between them
    occasionally misattributed one of the poller's OWN background requests to a dead plant
    (stress-tested at roughly 1 miss in 25-40 draws, `wk6_repro_plant3.py`, session
    scratchpad). This rail carried a 3-attempt retry for exactly that reason. WK7 removed the
    second mark: every request now carries its OWN `bg` flag on the wire (INSTRUMENT_JS's
    `stamp`), read back whenever Playwright's CDP delivery happens to catch up -- there is no
    longer a second snapshot to race against `n0`, so the retry this test carried for that race
    is gone with it (see the comment above `click_one`'s window-membership block for the full
    characterisation, and `test_a_late_delivered_background_poll_is_never_misattributed_to_a_dead_click`
    below for a deterministic, forced reproduction that no longer needs a retry either).

    ⚠️ MEASURED: this rail is NOT the mutation-proof vehicle for requirement #1 (network) or #2
    (floor) individually -- it stayed GREEN across 5 consecutive runs with the floor alone
    disabled, and even across 3 consecutive runs with BOTH the floor AND the network check
    disabled at once. Two compounding reasons, both measured, neither a defect in the fix:
    (a) the planted poller's OWN 200ms-period background fetch keeps something in
    `tap.inflight` often enough that phase 2 (network wait) frequently supplies the dwell time
    phase 1's floor is supposed to guarantee, so disabling the floor alone rarely shows through
    here; (b) with `QUIET_MS=120` against a 200ms poll period, a SINGLE click's window still
    has a ~60% chance of straddling a tick even with NEITHER mechanism active -- an UNRELATED
    statistical property of the floor/network mechanisms, not of the mark race, and not a
    reason to retry (a poller that never ticks inside the window fails `plant-poller` honestly,
    which is what the control is for). **The dedicated, deterministic mutation-proof rails are
    `test_quiesce_keeps_waiting_while_a_request_is_in_flight_even_though_the_DOM_is_quiet` +
    `test_a_control_whose_DOM_change_lands_700ms_after_its_own_fetch_still_reads_LIVE` for the
    network signal, and `test_quiesce_returns_early_when_quiet_and_still_honours_its_ceiling_when_it_never_settles`'s
    floor assertion for the floor** -- this test's job is END-TO-END reproduction of the real
    control on ordinary (unmutated) code, which it does, reliably; it is not sensitive enough to
    serve as evidence that either fix is present."""
    def open_fixture(W_, pg):
        pg.route("**/api/proof-plant/poll*",
                  lambda route: route.fulfill(status=200, content_type="application/json", body="{}"))
        _goto_fixture_doc(pg, '<div data-proof-root="notebook"></div>')
        return '[data-proof-root="notebook"]'

    names = {"Planted dead styled control": "plant-dead-styled", "Planted dead control": "plant-dead",
             "Planted live control": "plant-live"}
    surf = W.Surface("t-plant-poller", open_fixture, sweeps=("deadclick",))
    world = W.World(real_browser, "http://127.0.0.1:1", Path(tempfile.gettempdir()))
    rec = W.deadclick_surface(world, surf, "desk", plant=True)
    assert rec["status"] == "MEASURED", rec

    got = {}
    for r in rec["controls"]:
        for label, cid in names.items():
            if r["name"].startswith(label) and cid not in got:
                got[cid] = r["verdict"]
                break
    # ⛔ NON-VACUITY, the same check `deadclick_sweep` itself applies: the poller must
    # actually have fired INSIDE a dead click's own window, or "DEAD, DEAD" proves nothing.
    polled = [r for r in rec["controls"] if r["name"].startswith("Planted dead")
              and any("/api/proof-plant/poll" in b for b in (r.get("background_ignored") or []))]
    got["plant-poller"] = "IN-WINDOW" if polled else "NOT-SEEN"

    ok, why = W.control_ok("deadclick", got)
    assert ok, f"{why} -- got {got}"
    assert got == {"plant-dead-styled": "DEAD", "plant-dead": "DEAD", "plant-live": "LIVE",
                   "plant-poller": "IN-WINDOW"}, got


# ── wave 10 lane WK7: a DETERMINISTIC reproduction of the closed two-marks race ──────────────
#
# The bug (see the comment above `click_one`'s window-membership block, and INSTRUMENT_JS's
# `stamp` comment, for the full characterisation): `click_one` used to compare a JS-side index
# snapshot (`bgMark`, into `P.bgReqs`) against a Python-side index snapshot (`n0`, into
# `tap.reqs`) -- two lists populated at genuinely different rates (one synchronous in-page push,
# one asynchronous CDP delivery). Reproducing the mismatch by WAITING for real CDP jitter is
# exactly what the OLD tests did (~1 miss in 25-40 draws) -- probabilistic, not deterministic.
#
# `_delayed_delivery_tap_class()` makes it deterministic instead: it builds a `Tap` subclass,
# fresh each call so it always inherits from whatever `W.Tap` CURRENTLY is (this matters for the
# mutation-proof test below, which reloads `W` mid-run), that WITHHOLDS one marked request's row
# from `self.reqs` until `release_held()` runs. The row is built eagerly, on the SAME thread
# Playwright calls back on -- exactly like ordinary operation -- so nothing here touches a
# Playwright object off-thread; only WHEN it lands in `self.reqs` is deferred. Releasing it from
# inside `click_one`'s OWN second `quiesce()` call (patched in, no background thread, no sleep to
# "hope" the timing lines up) guarantees the release happens strictly AFTER `n0` was captured and
# strictly BEFORE `reqs = tap.reqs[n0:]` is read -- the exact ordering the old comparison could
# not survive, produced by construction rather than by chance.
def _delayed_delivery_tap_class():
    class _DelayedDeliveryTap(W.Tap):
        """Withholds any request whose URL contains `self._marker` from `self.reqs`/
        `self.inflight` until `release_held()` is called -- a deterministic stand-in for CDP
        delivery lag, not a hack around it: the row is computed the same way and at the same
        moment `Tap._on_request` always computes it, only ITS APPEARANCE in `self.reqs` is
        deferred."""

        def __init__(self, pg, marker: str):
            self._marker = marker
            self._held: list[dict] = []
            super().__init__(pg)

        def _on_request(self, r):
            if self._marker not in r.url:
                return super()._on_request(r)
            seq, bg = W._proof_headers(r)
            self._held.append({"t": time.time(), "method": r.method, "url": r.url, "seq": seq, "bg": bg})

        def release_held(self) -> list[dict]:
            held, self._held = self._held, []
            for row in held:
                self.reqs.append(row)
                self.last_activity = time.time()
            return held

    return _DelayedDeliveryTap


_WK7_REPRO_MARKER = "/api/wk7-race-repro-poll"


def _run_forced_stale_bg_repro(real_browser) -> dict:
    """One deterministic run of the forced reproduction. A background-poller-shaped request
    (`PLANT_DEADCLICK_JS`'s own poller shape: a `setTimeout` scheduled long before any click is
    ever armed, so `born < P.armedAt` is true the instant a real click arms) fires during fixture
    setup -- well before `click_one` takes its first mark, so its stamped `seq` is unambiguously
    less than every `reqMark` this run will ever see, and its stamped `bg` is unambiguously '1'.
    `_DelayedDeliveryTap` withholds its arrival until `click_one`'s SECOND `quiesce()` call
    (post-click) releases it -- strictly after `n0`, exactly the ordering the old comparison
    mishandled. Returns `click_one`'s result dict for a click on a control with NO other effect,
    so `verdict` alone says whether the stale background request was misattributed."""
    DelayedTap = _delayed_delivery_tap_class()

    def open_fixture(W_, pg):
        pg.route(f"**{_WK7_REPRO_MARKER}*",
                  lambda route: route.fulfill(status=200, content_type="application/json", body="{}"))
        pg.route("**/api/wk7-race-repro-decoy*",
                  lambda route: route.fulfill(status=200, content_type="application/json", body="{}"))
        _goto_fixture_doc(pg, '<div data-proof-root="notebook">'
                               '<button aria-label="Dead control">Dead control</button></div>')
        pg.evaluate(r"""(marker) => { setTimeout(() => fetch(marker + '?race=1',
          {credentials: 'include'}), 0); }""", _WK7_REPRO_MARKER)
        pg.wait_for_timeout(60)   # let the browser actually dispatch the fetch (the Tap hook,
        # already installed, withholds it regardless). A SECOND, ordinary request follows it --
        # advancing `P.reqSeq` PAST the marker's own value -- so `click_one`'s own mark (taken
        # after this) is unambiguously later than the marker's stamp on an otherwise-empty page.
        # Without this, a fixture with nothing else on it can hand the marker request the SAME
        # seq the click's own mark reads (nothing else having incremented the counter in
        # between), which proves nothing about staleness one way or the other.
        pg.evaluate("() => { fetch('/api/wk7-race-repro-decoy'); }")
        pg.wait_for_timeout(30)
        return '[data-proof-root="notebook"]'

    surf = W.Surface("t-wk7-race-repro", open_fixture, sweeps=("deadclick",))
    world = W.World(real_browser, "http://127.0.0.1:1", Path(tempfile.gettempdir()))
    ctx = world.new_context("acct", "desk")
    pg = ctx.new_page()
    try:
        tap = DelayedTap(pg, _WK7_REPRO_MARKER)   # installed BEFORE navigation, like `W.page()`
        root = surf.open(world, pg)
        listing = W.safe_evaluate(pg, W.CONTROLS_JS, root)
        ctl = next(c for c in listing if c["name"] == "Dead control")

        calls = {"n": 0}
        real_quiesce = W.quiesce

        def released_quiesce(pg_, tap_, ceiling_ms, *a, **kw):
            calls["n"] += 1
            if calls["n"] == 2 and isinstance(tap_, DelayedTap):
                released = tap_.release_held()
                assert len(released) == 1, (
                    f"the forced request never arrived to be withheld (got {released}) -- "
                    f"the reproduction is not exercising anything")
                # ⛔ NON-VACUITY: the released row must actually be STALE relative to this
                # click's own window, or nothing below proves anything about the race (measured
                # miss during this lane's own build: an otherwise-empty fixture handed the
                # marker the SAME `seq` the click's mark later read, since nothing else had
                # advanced `P.reqSeq` in between -- `open_fixture`'s decoy request exists to
                # rule that out, and this assertion is what would have caught it).
                current_seq = pg_.evaluate("() => window.__proof.reqSeq")
                assert released[0]["seq"] is not None and released[0]["seq"] < current_seq, (
                    f"the forced request is not stale (seq={released[0]['seq']!r}, "
                    f"current P.reqSeq={current_seq!r}) -- it would not be excluded by EITHER "
                    f"the fixed or the mutated code, so it cannot reproduce the race")
            return real_quiesce(pg_, tap_, ceiling_ms, *a, **kw)

        prev_quiesce = W.quiesce
        W.quiesce = released_quiesce
        try:
            return W.click_one(world, pg, tap, root, ctl, surf, "desk")
        finally:
            W.quiesce = prev_quiesce
    finally:
        pg.close()
        ctx.close()


def test_a_late_delivered_background_poll_is_never_misattributed_to_a_dead_click(real_browser):
    """The deterministic reproduction, asserted against the SHIPPED code: `verdict` must read
    DEAD every time. Looped 20 times and the pass count reported -- since the delay is a
    Python-side hook rather than genuine timing, this is not a statistical claim; it must be
    20/20, and a single miss means the fix regressed."""
    runs = 20
    passed = 0
    misses = []
    for i in range(runs):
        r = _run_forced_stale_bg_repro(real_browser)
        if r.get("verdict") == "DEAD":
            passed += 1
        else:
            misses.append({"run": i, "verdict": r.get("verdict"), "effects": r.get("effects")})
    print(f"[wk7-repro] {passed}/{runs} runs read DEAD")
    assert passed == runs, f"{passed}/{runs} DEAD -- misses: {misses}"


def test_mutation_reintroducing_the_two_snapshot_marking_reds_the_SAME_reproduction(real_browser):
    """Mutation-proof, per `feedback_mutation_check_never_git_checkout`: capture the source's own
    bytes, mutate ONE localized block back to a two-independent-snapshots shape, show the SAME
    forced reproduction above now misattributes (LIVE), then restore the captured bytes via
    `os.replace` and verify the restore by sha256 -- never `git checkout`, which would clobber
    any concurrent edit to this file (`lesson_a_prepared_revert_is_verified_by_what_it_changes`).

    THE MUTATION: `bg` goes back to being WINDOWED (only excludable when its OWN `seq >= reqMark`
    -- mirroring the old `P.bgReqs.slice(bgMark)`, "background requests DURING this window") while
    `reqs` stays windowed ONLY by `n0` (the old Python-only boundary, no `seq` refinement at all).
    Two independent windowing decisions, exactly the retired defect: the reproduction's stale
    background request (seq < reqMark, bg=1, delivered late) is then present in `reqs` (n0 alone
    does not exclude it) and ABSENT from the windowed `bg` (its seq is too old) -- nothing
    subtracts it -- FALSE LIVE, on demand."""
    target = REPO / "tools" / "notebook_proof_walk.py"
    original = target.read_bytes()
    original_sha = hashlib.sha256(original).hexdigest()

    lines = original.splitlines(keepends=True)
    start = next(i for i, ln in enumerate(lines) if ln.lstrip().startswith(b'mark_seq = m.get("reqMark")'))
    old_block = b"".join(lines[start:start + 6])
    # a loose content check, so a future reflow of this block fails LOUD here rather than
    # silently mutating the wrong six lines
    for needle in (b"candidates = tap.reqs[n0:]", b"reqs = candidates",
                   b'bg = [r for r in candidates if r.get("bg")]'):
        assert needle in old_block, f"{needle!r} not found where expected -- block drifted:\n{old_block!r}"
    assert original.count(old_block) == 1, "the fix block is not present exactly once"

    term = b"\r\n" if lines[start].endswith(b"\r\n") else b"\n"
    new_block = (b'    reqs = tap.reqs[n0:]' + term +
                 b'    bg = [r for r in reqs if r.get("bg") and r.get("seq") is not None and '
                 b'r["seq"] >= (m.get("reqMark") or 0)]' + term)

    tmp_dir = Path(tempfile.mkdtemp(prefix="wk7_mutate_"))
    capture_path = tmp_dir / "notebook_proof_walk.captured"
    tmp_write = capture_path.with_suffix(".tmp")
    tmp_write.write_bytes(original)
    os.replace(tmp_write, capture_path)
    assert hashlib.sha256(capture_path.read_bytes()).hexdigest() == original_sha, (
        "the capture did not read back identically -- refusing to mutate on an unproven capture")

    def _write_atomic(data: bytes) -> None:
        tmp = target.with_suffix(".wk7mut.tmp")
        tmp.write_bytes(data)
        os.replace(tmp, target)

    try:
        mutated = original.replace(old_block, new_block)
        assert mutated != original, "the mutation applied nothing"
        assert hashlib.sha256(mutated).hexdigest() != original_sha
        _write_atomic(mutated)
        importlib.reload(W)

        r = _run_forced_stale_bg_repro(real_browser)
        assert r.get("verdict") == "LIVE", (
            f"MUTATION DID NOT RED: reintroducing the two-snapshot marking still read "
            f"{r.get('verdict')!r} (result: {r}) -- the fix block may not be doing the work "
            f"this test thinks it is")
    finally:
        _write_atomic(capture_path.read_bytes())
        restored_sha = hashlib.sha256(target.read_bytes()).hexdigest()
        assert restored_sha == original_sha, (
            f"RESTORE FAILED: {target} is not byte-identical to the captured original "
            f"(sha {restored_sha[:16]} != {original_sha[:16]})")
        importlib.reload(W)
        assert W.self_check() == 0, "post-restore self_check failed -- the module did not come back clean"


def test_a_control_whose_DOM_change_lands_700ms_after_its_own_fetch_still_reads_LIVE(real_browser):
    """The network signal's OWN reason to exist, at the `click_one` level rather than the
    quiesce-only level above: a control whose fetch is intercepted with a delay before its DOM
    update lands. A DOM-only, floor-less `quiesce()` would read this DEAD -- the DOM is quiet
    (nothing has happened YET) the instant the fixed 120ms window elapses, long before the
    response (and the mutation it triggers) arrives.

    ⚠️ round 2: the mock endpoint's path is under `/api/j2/telemetry/...` -- a
    `TELEMETRY_PATHS`-matching prefix -- ON PURPOSE. `judge_click`'s pre-existing
    `if reqs: eff.append("request")` rule credits the mere INITIATION of a click's own fetch
    (visible in `tap.reqs` the instant it dispatches, unaffected by whether `quiesce()` ever
    waits for it) as "request" evidence on its own -- so with a plain (non-telemetry) endpoint
    this test would read LIVE via the "request" effect alone, REGARDLESS of whether quiesce()
    ever waited for the network or the DOM mutation ever landed. Routing the fetch through
    `is_telemetry()` strips it from `judge_click`'s `reqs` (line ~172-173) while leaving it
    fully visible to `Tap` (which tracks every request by Playwright event, URL-agnostic) --
    so `quiesce()`'s phase-2 network wait still genuinely blocks on it. The ONLY evidence this
    test's LIVE verdict can be won on is the delayed DOM mutation itself.

    ⚠️ 700ms, not 400ms: phase 1 (`QUIESCE_DOM_JS`) is DOM-only and returns once
    `QUIESCE_FLOOR_MS` (300) AND `QUIET_MS` (120) have both elapsed with no mutation seen --
    which, with NO mutation ever occurring before the fetch resolves, is just `now - start >=
    300ms`, independent of the network entirely. A delay close to that 300-420ms band cannot
    cleanly attribute a LIVE verdict to the NETWORK wait (phase 2) rather than the FLOOR
    (phase 1) alone -- 700ms clears that band by a wide margin while staying safely under the
    post-click `quiesce()` call's 1200ms ceiling (~820ms total: 700ms to resolve + 120ms
    quiet).

    ⚠️ The delay is a REAL loopback server (`_loopback_doc_with_delayed_endpoint`), not a
    `page.route()` handler doing `time.sleep()` -- see that helper's docstring for why the
    obvious version measurably breaks this exact test (the CLICK absorbs the delay, not
    quiesce())."""
    doc = (
        '<div data-proof-root="notebook">'
        '  <button aria-label="Slow effect" onclick="'
        "fetch('/api/j2/telemetry/slow-effect').then(function () {"
        "  var p = document.createElement('p'); p.textContent = 'done';"
        "  document.querySelector('[data-proof-root=notebook]').appendChild(p); })"
        '">Slow</button>'
        '</div>')

    def open_fixture(W_, pg):
        pg.goto(doc_url)
        return '[data-proof-root="notebook"]'

    with _loopback_doc_with_delayed_endpoint(doc, "/api/j2/telemetry/slow-effect", 0.7) as doc_url:
        surf = W.Surface("t-slow-effect", open_fixture, sweeps=("deadclick",))
        world = W.World(real_browser, "http://127.0.0.1:1", Path(tempfile.gettempdir()))
        rec = W.deadclick_surface(world, surf, "desk")
    assert rec["status"] == "MEASURED", rec
    row = next(c for c in rec["controls"] if c["name"] == "Slow effect")
    assert row["verdict"] == "LIVE", row


def test_a_repeated_control_key_is_sampled_and_the_rest_are_named_REPEATED_never_dropped(real_browser):
    """Goal (b), end to end: five controls that collide to ONE `key` (digits folded) are
    sampled `SAMPLE_PER_KEY` times and clicked for real; the remaining occurrences are recorded
    `REPEATED` rather than left out of `rec['controls']` -- and the coverage accounting
    (`enumerated` = `measured` + `skipped_repeated` + `capped`) is honest and non-negative."""
    def open_fixture(W_, pg):
        rows = "".join(
            f'<button aria-label="Item {i}" '
            f'onclick="this.setAttribute(\'aria-expanded\', \'true\')">Item {i}</button>'
            for i in range(1, 6))
        pg.set_content(f'<div data-proof-root="notebook">{rows}</div>')
        return '[data-proof-root="notebook"]'

    surf = W.Surface("t-repeat", open_fixture, sweeps=("deadclick",))
    world = W.World(real_browser, "http://127.0.0.1:1", Path(tempfile.gettempdir()))
    rec = W.deadclick_surface(world, surf, "desk")
    assert rec["status"] == "MEASURED", rec
    assert rec["enumerated"] == 5
    assert rec["capped"] == 0
    assert rec["measured"] == W.SAMPLE_PER_KEY
    assert rec["skipped_repeated"] == 5 - W.SAMPLE_PER_KEY
    # honesty: found == measured + skipped + capped, and neither half is ever negative
    assert rec["measured"] + rec["skipped_repeated"] + rec["capped"] == rec["enumerated"]
    assert rec["measured"] >= 0 and rec["skipped_repeated"] >= 0

    repeated_rows = [c for c in rec["controls"] if c["verdict"] == "REPEATED"]
    assert len(repeated_rows) == 5 - W.SAMPLE_PER_KEY
    assert all(c["nth"] > W.SAMPLE_PER_KEY for c in repeated_rows), repeated_rows
    assert all("elapsed_ms" not in c for c in repeated_rows), "a skipped control was never clicked"
    key = repeated_rows[0]["key"]

    # CONTROL: the first SAMPLE_PER_KEY occurrences of that SAME key were genuinely clicked,
    # never skipped -- proving the gate samples rather than blanket-suppressing the key
    sampled = [c for c in rec["controls"] if c["key"] == key and c["verdict"] != "REPEATED"]
    assert len(sampled) == W.SAMPLE_PER_KEY
    assert all(c["nth"] <= W.SAMPLE_PER_KEY for c in sampled), sampled
    assert all(c.get("elapsed_ms", -1) >= 0 for c in sampled), sampled


def test_CONTROL_distinct_keys_are_never_deduped(real_browser):
    """CONTROL for the rail above, on the identical fixture shape: four controls with genuinely
    DIFFERENT (non-digit) names must never collide to one key -- the gate is a per-key sample,
    not a blanket cap on how many controls a surface may click."""
    def open_fixture(W_, pg):
        pg.set_content(
            '<div data-proof-root="notebook">'
            '<button aria-label="Alpha" onclick="this.setAttribute(\'aria-expanded\', \'true\')">Alpha</button>'
            '<button aria-label="Beta" onclick="this.setAttribute(\'aria-expanded\', \'true\')">Beta</button>'
            '<button aria-label="Gamma" onclick="this.setAttribute(\'aria-expanded\', \'true\')">Gamma</button>'
            '<button aria-label="Delta" onclick="this.setAttribute(\'aria-expanded\', \'true\')">Delta</button>'
            '</div>')
        return '[data-proof-root="notebook"]'

    surf = W.Surface("t-distinct", open_fixture, sweeps=("deadclick",))
    world = W.World(real_browser, "http://127.0.0.1:1", Path(tempfile.gettempdir()))
    rec = W.deadclick_surface(world, surf, "desk")
    assert rec["status"] == "MEASURED", rec
    assert rec["enumerated"] == 4
    assert rec["measured"] == 4
    assert rec["skipped_repeated"] == 0
    assert not any(c["verdict"] == "REPEATED" for c in rec["controls"])


# ── wave 10 lane WK4: G-171's keyboard door was a probe race, not the product ──────────────
# Diagnosed by lane FX2 (docs/notebook/proof/fx2-788f3a439/item1-g171-keyboard/): the tour
# DIALOG lazy-loads well after the page's own "Welcome to your Notebook" heading, so reading
# `tour.count() > 0` the instant the heading appears always samples the dialog as absent --
# skipping the Skip-tour dismiss branch every run -- and the tour opens a moment later and
# correctly traps keyboard focus around "Add a sample notebook", which a keyboard door can
# then never Tab to. That is G-171's own "not reached with Tab in 220 presses" reading,
# unchanged across every run of this program: a probe race, not a product defect.

class _FakeLateLocator:
    """Stands in for a Playwright Locator whose element attaches after a delay -- the tour
    dialog's own shape: absent at t=0, present well before a realistic wait budget.
    `wait_for` blocks until it would appear or the caller's OWN timeout elapses (mirroring
    Playwright's real contract); `count()` is the OLD sampling read this rail proves wrong
    on its own, on the identical fixture."""
    def __init__(self, appears_after_ms: float):
        self.appears_after_ms = appears_after_ms
        self._start = time.monotonic()

    def _elapsed_ms(self):
        return (time.monotonic() - self._start) * 1000

    def count(self):
        return 1 if self._elapsed_ms() >= self.appears_after_ms else 0

    def wait_for(self, state="visible", timeout=1500):
        deadline = time.monotonic() + timeout / 1000
        while time.monotonic() < deadline:
            if self._elapsed_ms() >= self.appears_after_ms:
                return
            time.sleep(0.01)
        raise TimeoutError(f"locator did not become {state!r} within {timeout}ms")


def test_the_first_run_tour_is_WAITED_for_not_sampled_once():
    late = _FakeLateLocator(appears_after_ms=700)
    # CONTROL: the OLD probe (a single .count() read at t=0, on the identical fixture)
    # gets this wrong -- proving the fix is a real behaviour change, not a renamed no-op
    assert late.count() == 0, "the control fixture must start absent for the contrast to mean anything"
    assert W._first_run_tour_seen(late, timeout_ms=1500) is True

    # CONTROL: a dialog that genuinely never opens reads seen=False, bounded by its own
    # timeout -- never an indefinite hang
    never = _FakeLateLocator(appears_after_ms=10_000)
    started = time.monotonic()
    assert W._first_run_tour_seen(never, timeout_ms=100) is False
    assert time.monotonic() - started < 1.0, "a dialog that never opens must not block past its own budget"
