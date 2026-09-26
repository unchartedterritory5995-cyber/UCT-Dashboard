"""Rails for tools/notebook_bench_uct.py -- the automated UCT column (wave 9, 9A, A3).

No browser and no sandbox here: the refusals (shared-root data dir, busy port, held lock, memory
floor, a corpus that does not verify) are driven through `main`, the measurement itself is replaced
by a stand-in where a rail needs one, and the pure halves (the plan, a per-op summary, the summary
schema) are called directly. The real run is local-only (Playwright), like the perf harness.
Every timing below is a synthetic value for `uct-sandbox-auto` or a `fixture-*` value.
"""
from __future__ import annotations

import json
import os
import socket
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))

import notebook_bench_uct as u  # noqa: E402  (the runner's own imports resolve through tools/)
import notebook_bench_report as rep  # noqa: E402
import notebook_bench_corpus as corpus_tool  # noqa: E402

h = u.h                                   # the harness module object the runner actually uses
SHARED = r"C:\data\w9bench-refused" if os.name == "nt" else "/data/w9bench-refused"


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@pytest.fixture
def box(tmp_path, monkeypatch):
    """A private gate-box lock path, no PowerShell load probe, and plenty of memory."""
    lock = tmp_path / "gate-box.lock"
    monkeypatch.setenv(u.gate_box_lock.LOCK_ENV, str(lock))
    monkeypatch.setattr(u, "LOAD_PROBE", False)
    monkeypatch.setattr(u, "available_mbytes", lambda: 20000.0)
    return lock


@pytest.fixture
def small_corpus(tmp_path_factory):
    out = tmp_path_factory.mktemp("w9bench-corpus")
    corpus_tool.write(corpus_tool.build_corpus(7, 8), out)
    return out


def _args(tmp_path, corpus="missing-corpus", data_dir=None, port=None):
    return ["--boot", "--data-dir", data_dir or str(tmp_path / "w9bench-data"), "--port", str(port or _free_port()),
            "--corpus", str(corpus), "--json", str(tmp_path / "out" / "uct-auto.json")]


def _first_line(capsys) -> str:
    return capsys.readouterr().out.splitlines()[0]


# ── refusals, each exit 3 with a sentence ─────────────────────────────────────────────────

def test_dry_run_exits_0(capsys):
    assert u.main(["--dry-run"]) == 0
    assert "DRY RUN:" in capsys.readouterr().out


def test_a_shared_root_data_dir_is_refused(tmp_path, box, capsys):
    assert u.main(_args(tmp_path, data_dir=SHARED)) == 3
    first = _first_line(capsys)
    assert first.startswith("SANDBOX INTEGRITY: NOT RUN (refused: ") and "shared data root" in first
    assert not (tmp_path / "out").exists()


def test_a_busy_port_is_refused_and_its_holder_is_left_alone(tmp_path, box, capsys):
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    s.listen(1)
    try:
        port = s.getsockname()[1]
        assert u.main(_args(tmp_path, port=port)) == 3
        assert f"port {port} already has a listener" in _first_line(capsys)
        # the runner asked by CONNECTING (a bind proves nothing on Windows), and the listener is
        # still ours and still accepting: its probe connection is waiting in our backlog
        s.settimeout(2)
        conn, _ = s.accept()
        conn.close()
    finally:
        s.close()


def test_a_held_lock_is_refused_naming_its_holder(tmp_path, box, capsys, monkeypatch):
    box.write_text(json.dumps({"pid": os.getpid(), "started_at": "2099-01-01T00:00:00",
                               "workstream": "fixture-workstream", "command_line": "python fixture_gate.py"}),
                   encoding="utf-8")
    monkeypatch.setattr(u, "available_mbytes", lambda: pytest.fail("the box is checked BEFORE memory"))
    assert u.main(_args(tmp_path)) == 3
    first = _first_line(capsys)
    assert "the box is held:" in first and f"pid {os.getpid()}" in first and "python fixture_gate.py" in first
    assert box.is_file(), "a refused run must never touch somebody else's lock"


def test_memory_below_the_floor_or_unreadable_is_refused(tmp_path, box, capsys, monkeypatch):
    monkeypatch.setattr(u, "available_mbytes", lambda: 1024.0)
    assert u.main(_args(tmp_path)) == 3
    assert "Available MBytes is 1024, below the floor of 4608 MB" in _first_line(capsys)
    monkeypatch.setattr(u, "available_mbytes", lambda: None)
    assert u.main(_args(tmp_path)) == 3
    assert "could not be read" in _first_line(capsys)
    assert not box.exists(), "a refused run never takes the lock"


def test_a_corpus_that_does_not_verify_is_refused(tmp_path, box, capsys):
    empty = tmp_path / "not-a-corpus"
    empty.mkdir()
    assert u.main(_args(tmp_path, corpus=empty)) == 3
    assert "does not verify" in _first_line(capsys)


def test_the_floor_is_the_owner_ruled_heavy_run_floor():
    assert u.MEMORY_FLOOR_MB == u.gate_box_sampler.FREE_MEMORY_FLOOR_GB * 1024 == 4608


def test_available_mbytes_reads_the_performance_counter_and_None_when_it_cannot(monkeypatch):
    class R:
        def __init__(self, out): self.stdout = out
    good = ('\n"(PDH-CSV 4.0)","\\\\BOX\\Memory\\Available MBytes"\n"09/26/2026 14:30:00.123","12345.000000"\n'
            "Exiting, please wait...\nThe command completed successfully.\n")
    monkeypatch.setattr(u.subprocess, "run", lambda *a, **k: R(good))
    assert u.available_mbytes() == 12345.0
    monkeypatch.setattr(u.subprocess, "run", lambda *a, **k: R("Error: No valid counters.\n"))
    assert u.available_mbytes() is None


# ── the lock is held for the run and released in finally ──────────────────────────────────

def _fake_measure(tmp, outcome):
    def fake(args, manifest, corpus_dir, home, stem):
        lock = json.loads(Path(os.environ[u.gate_box_lock.LOCK_ENV]).read_text(encoding="utf-8"))
        assert lock["pid"] == os.getpid(), "the runner must hold the box while it measures"
        if outcome == "raise":
            raise RuntimeError("fixture: the boot blew up")
        integ = h.read_integrity(None, [h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN])
        return integ, None, None, "fixture: sign-in failed", "fixture note"
    return fake


@pytest.mark.parametrize("outcome,code", [("not-run", 3), ("raise", 2)])
def test_the_lock_is_taken_for_the_run_and_released_in_finally(tmp_path, box, small_corpus, capsys, monkeypatch,
                                                               outcome, code):
    monkeypatch.setattr(u, "_measure", _fake_measure(tmp_path, outcome))
    assert u.main(_args(tmp_path, corpus=small_corpus)) == code
    out = capsys.readouterr().out
    assert out.splitlines()[0].startswith("SANDBOX INTEGRITY:")
    assert not box.exists(), "the lock must be released even when the run fails"
    summary = json.loads((tmp_path / "out" / "uct-auto.json").read_text(encoding="utf-8"))
    assert summary["timings"] == "WITHHELD" and summary["machine"]["lock"]["released"] is True


# ── the pure halves ───────────────────────────────────────────────────────────────────────

def _stub(samples, **extra):
    return {"samples": list(samples), "invalid": [], **extra}


def test_short_typing_samples_read_INCONCLUSIVE_never_a_p95():
    op = rep.OPS_BY_ID["H6"]
    rec = u.summarize_op(op, [_stub([5.0] * 60, expectKeys=60), _stub([5.0] * 50, expectKeys=60),
                              _stub([5.0] * 60, expectKeys=60)])
    assert rec["status"] == "INCONCLUSIVE" and rec["p50_ms"] is None and rec["p95_ms"] is None
    assert "170 samples for 180 keys" in rec["reason"]
    whole = u.summarize_op(op, [_stub([5.0] * 60, expectKeys=60)] * 3)
    assert whole["status"] == "MEASURED" and whole["n"] == 180


def test_an_op_with_only_timeouts_reads_INCONCLUSIVE_with_its_reason():
    rec = u.summarize_op(rep.OPS_BY_ID["H3-full"], [{"samples": [], "invalid": ["not-in-dom"] * 10}] * 2)
    assert rec["status"] == "INCONCLUSIVE" and rec["reason"] == "no sample: not-in-dom ×20"


def _live_for_every_op():
    live = {"ops": {}, "dumps_rel": "uct-auto-dumps", "self_test": {"ok": True, "ms": 201.2}, "self_tests": []}
    for op in rep.OPS:
        per = op.get("chars_per_round") or op.get("reps_per_round")
        live["ops"][op["id"]] = {"dumps": [_stub([33.0] * per, expectKeys=60) for _ in range(op["rounds"])],
                                 "names": [f"uct-sandbox-auto__{op['id']}__r{i + 1}.json" for i in range(op["rounds"])],
                                 "failure": None}
    live["ops"]["H8"] = {"dumps": [], "names": [], "failure": "the clipboard write failed (fixture)"}
    return live


def test_the_summary_per_op_records_validate_against_the_reports_schema():
    s = u.build_summary(git_head="f" * 40, base="http://127.0.0.1:1", corpus_info={}, machine={},
                        integrity={"status": "CLEAN"}, live=_live_for_every_op())
    assert rep.validate_summary(s) == []
    assert set(s["per_op"]) == {o["id"] for o in rep.OPS}
    assert s["per_op"]["H1"]["dumps"] == ["uct-auto-dumps/uct-sandbox-auto__H1__r1.json",
                                          "uct-auto-dumps/uct-sandbox-auto__H1__r2.json"]
    assert s["per_op"]["H8"]["status"] == "INCONCLUSIVE" and s["certifying"] is False
    # control: the validator is not vacuous
    del s["per_op"]["H1"]["reason"]
    assert rep.validate_summary(s) == ["H1: lacks reason"]


def test_the_owners_console_lines_carry_the_runners_own_arm_options():
    """One authority: the lines `--dry-run --corpus DIR` prints for a hand sitting ARE the options
    this runner passes to arm() -- and the runner passes nothing else."""
    manifest = json.loads(u.COMMITTED_MANIFEST.read_text(encoding="utf-8"))
    for step in u.plan(manifest):
        lines = u.console_lines(step)
        opts = u.arm_options(step)
        if step["kind"] == "cold":
            assert opts is None and lines[0].startswith("await __uctBench.arm('cold')")
            continue
        assert f"__uctBench.arm('{step['kind']}', {json.dumps(opts)})" in lines
        assert lines[0] == "await __uctBench.selfTest()"
    src = (REPO / "tools" / "notebook_bench_uct.py").read_text(encoding="utf-8")
    for kind in ("open", "search", "typing", "paste"):
        assert f"pg.evaluate(\"o => window.__uctBench.arm('{kind}', o)\", arm_options(step))" in src, kind


def test_the_plan_covers_every_op_with_the_manifests_markers():
    manifest = json.loads(u.COMMITTED_MANIFEST.read_text(encoding="utf-8"))
    steps = {s["id"]: s for s in u.plan(manifest)}
    assert list(steps) == [o["id"] for o in rep.OPS]
    tn = manifest["timed_notes"]
    assert steps["H1"]["marker"] == tn["small"]["first_marker"]
    assert steps["H3-full"]["marker"] == tn["large_2000"]["last_marker"]
    assert steps["H3-full"]["anchor"] == tn["large_2000"]["first_marker"]
    assert steps["H4"]["query"] == manifest["markers"]["rare_term"] and steps["H4"]["expected_title"] == tn["rare"]["title"]
    assert steps["H5"]["expected_title"] == manifest["switcher_title"]
    # ⛔ H5 types a strict word-PREFIX and waits for the whole title: an echo of the query (the
    # palette's `No matches for "<query>"`) must never be able to hold the expected title
    assert steps["H5"]["query"] != steps["H5"]["expected_title"]
    assert steps["H5"]["expected_title"].startswith(steps["H5"]["query"] + " ")
    assert steps["H4"]["query"] not in steps["H4"]["expected_title"]
    assert steps["H8"]["end_marker"] == manifest["markers"]["paste_end"]


# ── its own account, the probe unchanged, the product's own selectors ─────────────────────

class _Resp:
    def __init__(self, status=200, body=None):
        self.status, self._body = status, body or {}

    def json(self):
        return self._body


class _Req:
    def __init__(self, me=None):
        self.calls, self.me = [], me or {}

    def post(self, url, data=None, **kw):
        self.calls.append((url.rsplit("/api", 1)[1], dict(data or {})))
        return _Resp()

    def get(self, url, **kw):
        return _Resp(body=self.me)


def test_the_runner_provisions_its_own_account_never_the_harness_perf_account():
    admin, member = _Req(), _Req(me={"paid_equiv": True})
    u.provision(admin, member, "http://sandbox.invalid")
    assert member.calls[0] == ("/auth/signup", {"email": u.BENCH_EMAIL, "password": u.BENCH_PW,
                                                "display_name": u.BENCH_NAME})
    comp = [c for c in admin.calls if c[0] == "/auth/admin/comp-access"]
    assert comp == [("/auth/admin/comp-access", {"email": u.BENCH_EMAIL, "action": "grant"})]
    assert u.BENCH_EMAIL not in (h.PERF_EMAIL, h.ADMIN_EMAIL)


def test_the_harness_own_provision_is_unchanged_without_a_member():
    admin, member = _Req(), _Req(me={"paid_equiv": True})
    h._provision(admin, member, "http://sandbox.invalid")
    assert member.calls[0][1]["email"] == h.PERF_EMAIL
    with pytest.raises(h.SetupFailed, match="^perf account is not paid-equivalent"):
        h._provision(_Req(), _Req(me={}), "http://sandbox.invalid")


def test_the_grid_card_selector_skips_the_sidebar_rows_that_share_the_id():
    """The sidebar's note rows carry the same data-note-card-id AND a title attribute; the grid
    card carries none (run 1 died on 'resolved to 2 elements'). Read from the product."""
    side = (REPO / "app/src/pages/journal-2-0/components/notebook/FolderSidebar.jsx").read_text(encoding="utf-8")
    card = (REPO / "app/src/pages/journal-2-0/components/notebook/NoteCard.jsx").read_text(encoding="utf-8")
    import re
    side_rows = re.findall(r"title=\{note\.title\?\.trim\(\) \|\| 'Untitled'\}\s*data-note-card-id=\{note\.id\}", side)
    assert len(side_rows) == 2, "the sidebar's two note-row buttons (with a title) are no longer where the runner assumes"
    grid = [ln for ln in card.splitlines() if "data-note-card-id={note.id}" in ln and "<button" in ln]
    assert grid and all("title=" not in ln for ln in grid), grid
    assert u.card_selector("abc") == 'button[data-note-card-id="abc"]:not([title])'
    assert u.GRID_CARD == 'button[data-note-card-id]:not([title])'


def test_the_runner_evaluates_the_probe_file_itself():
    assert u.PROBE_FILE == rep.PROBE_FILE
    src = (REPO / "tools" / "notebook_bench_uct.py").read_text(encoding="utf-8")
    assert "ctx.add_init_script(path=str(PROBE_FILE))" in src


@pytest.mark.parametrize("path,needle", [
    ("app/src/pages/journal-2-0/components/notebook/NoteCard.jsx", "data-note-card-id={note.id} onClick"),
    ("app/src/pages/journal-2-0/components/notebook/FolderSidebar.jsx", 'aria-label="Search notes"'),
    ("app/src/pages/journal-2-0/components/notebook/FolderSidebar.jsx", 'aria-label="Search your notes"'),
    ("app/src/components/CommandPalette.jsx", 'aria-label="Search a security, company, or note"'),
    ("app/src/components/CommandPalette.jsx", "e.key.toLowerCase() === 'k'"),
    ("app/src/pages/journal-2-0/tabs/NotebookTab.jsx", 'data-tour="new-note"'),
    ("app/src/components/CommandPalette.jsx", "No matches for &quot;{query.trim()}&quot;"),
])
def test_every_selector_the_runner_uses_is_in_the_product(path, needle):
    assert needle in (REPO / path).read_text(encoding="utf-8"), f"{path} no longer carries {needle!r}"


# ── H8's create pacing (_Traffic): experiment 5's second click, ~50 ms after Back, opened nothing ──

class _Evt:
    def __init__(self, url, resource_type="fetch"):
        self.url, self.resource_type = url, resource_type


class _EventPage:
    """Only what _Traffic touches: `on` and `wait_for_timeout` (which really sleeps)."""

    def __init__(self):
        self.handlers = {}

    def on(self, name, fn):
        self.handlers.setdefault(name, []).append(fn)

    def emit(self, name, req):
        for fn in self.handlers.get(name, []):
            fn(req)

    def wait_for_timeout(self, ms):
        import time as _t
        _t.sleep(ms / 1000)


def test_the_traffic_gate_waits_for_short_requests_and_never_for_a_stream():
    pg = _EventPage()
    t = u._Traffic(pg)
    stream = _Evt("http://127.0.0.1:8096/api/stream/prices?tickers=SPY", "eventsource")
    fetch = _Evt("http://127.0.0.1:8096/api/j2/notes?sort=title")
    pg.emit("request", stream)                          # never finishes, and must not block
    assert t.quiet(pg, quiet_ms=30, timeout_s=2) is True
    pg.emit("request", fetch)                           # a refetch in flight: not quiet
    assert t.quiet(pg, quiet_ms=30, timeout_s=0.3) is False
    pg.emit("requestfinished", fetch)
    assert t.quiet(pg, quiet_ms=30, timeout_s=2) is True
    pg.emit("requestfinished", stream)                  # a stream's end never drives the count negative
    assert t.inflight == 0


class _Loc:
    def __init__(self, page, sel):
        self.page, self.sel, self.first = page, sel, self

    def click(self):
        self.page.log.append(("click", self.sel))

    def wait_for(self, **_):
        self.page.log.append(("wait_for", self.sel))
        if self.sel == ".ProseMirror":                  # the editor never shows in this fixture
            raise TimeoutError("waiting for locator('.ProseMirror').first to be visible")


class _PastePage:
    url = "http://127.0.0.1:8096/journal/notebook?view=all"

    def __init__(self):
        self.log = []

    def bring_to_front(self):
        pass

    def evaluate(self, script, arg=None):
        return "ok" if "clipboard" in script else None

    def locator(self, sel):
        return _Loc(self, sel)

    def wait_for_url(self, pred, timeout):
        self.log.append(("wait_for_url", timeout))
        if not pred(self.url):                          # the click opened nothing: the URL never moved
            raise TimeoutError(f"wait_for_url timed out after {timeout} ms")


class _Quiet:
    def __init__(self, page):
        self.page = page

    def quiet(self, pg):
        self.page.log.append(("quiet",))
        return True


def test_each_create_waits_for_quiet_and_a_click_that_opens_nothing_is_INCONCLUSIVE(tmp_path):
    (tmp_path / "paste-payload.html").write_text("<p>fixture-app paste</p>", encoding="utf-8")
    (tmp_path / "paste-payload.txt").write_text("fixture-app paste", encoding="utf-8")
    pg = _PastePage()
    step = {"id": "H8", "kind": "paste", "reps_per_round": 5, "end_marker": "zzqbfixtureend"}
    with pytest.raises(u.OpInconclusive) as ei:
        u._drive(pg, step, 1, {}, tmp_path, lambda: None, lambda where: {"ok": True}, tmp_path,
                 traffic=_Quiet(pg))
    msg = str(ei.value)
    assert "rep 1" in msg and "no note opened" in msg and "nothing was pasted" in msg, msg
    kinds = [e[0] for e in pg.log]
    assert kinds.index("quiet") < kinds.index("click"), f"the create must wait for quiet first: {kinds}"
    assert ("wait_for", ".ProseMirror") not in pg.log, "the create check decides before the editor wait"
