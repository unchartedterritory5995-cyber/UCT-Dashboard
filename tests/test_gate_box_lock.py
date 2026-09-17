"""Rails for the machine-wide box lock — owner rulings R1/R2/R3, 2026-09-14.

⛔ EVERY CLAIM IS PAIRED WITH PROOF IT COULD HAVE GONE THE OTHER WAY. A lock is the kind of thing
that passes every test by simply never refusing anything, so each rail below has a sibling that
must produce the OPPOSITE answer on nearly the same input.

The load-bearing one is `test_R3_*`: **a bypass lets you run; it does not let you pretend.**
"""
from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys
import time

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import gate_box_lock as L      # noqa: E402
import gate_box_sampler as S   # noqa: E402

# ⛔ CAPTURED AT IMPORT, BEFORE ANY TEST CAN MONKEYPATCH `S.box_load`. The live rails below drive
# the REAL probe against the REAL machine; reading `S.box_load` inside them would silently pick up
# whatever fixture a neighbouring test installed, and a stubbed "live" test proves nothing.
_REAL_BOX_LOAD = S.box_load


@pytest.fixture(autouse=True)
def _never_touch_the_real_lock(monkeypatch, tmp_path):
    """⛔ EVERY TEST IS POINTED AT A THROWAWAY LOCK. A suite that can take the machine's real lock
    would block another workstream's gate every time it runs — the tool causing the condition it
    exists to prevent."""
    monkeypatch.setenv(L.LOCK_ENV, str(tmp_path / "box.lock"))
    monkeypatch.delenv(L.BYPASS_ENV, raising=False)
    yield


def _spawn_gate_like(seconds: int = 30) -> subprocess.Popen:
    """A live process carrying a gate command line — a stand-in for another session's gate."""
    return subprocess.Popen(
        [sys.executable, "-c", f"import time; time.sleep({seconds})",
         "scripts/gate_shards.py", "--shards", "6"],
        cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _write_lock_for(pid: int, path: pathlib.Path, run_id: str = "held") -> dict:
    rec = {"pid": pid, "run_id": run_id, "command_line": "python -u scripts/gate_shards.py --shards 6",
           "worktree": str(ROOT), "workstream": "someone-else", "started_at": "2026-09-14T23:00:00",
           "hostname": "box"}
    path.write_text(json.dumps(rec), encoding="utf-8")
    return rec


# ── no lock · live holder · dead holder ───────────────────────────────────────────────────────

def test_no_lock_means_the_run_proceeds(tmp_path):
    """⛔ THE CONTROL FOR EVERY REFUSAL BELOW. A lock that refuses a free box would satisfy all of
    them, and would be worse than no lock at all."""
    rec = L.acquire("mine", path=tmp_path / "box.lock")
    assert rec["acquired"] is True
    assert rec["bypass"] is False
    assert L.status(path=tmp_path / "box.lock")["state"] == "HELD"


def test_a_LIVE_holder_refuses_and_the_holder_is_NAMED(tmp_path):
    """The refusal must carry pid, start time and command line — never a bare "busy".

    ⭐ The operational question is *"whose run am I waiting for, and can I ask them?"*, and a
    count answers none of it. This repo has a standing rule about names over counts.
    """
    proc = _spawn_gate_like()
    lock = tmp_path / "box.lock"
    try:
        _write_lock_for(proc.pid, lock)
        with pytest.raises(L.LockHeld) as e:
            L.acquire("mine", path=lock)
        msg = str(e.value)
        assert str(proc.pid) in msg, msg
        assert "gate_shards.py" in msg, msg
        assert "2026-09-14T23:00:00" in msg, msg
        assert e.value.holder["workstream"] == "someone-else"
    finally:
        proc.kill(); proc.wait(timeout=10)


def test_a_DEAD_holder_is_reclaimed_AND_the_reclaim_is_recorded(tmp_path):
    """⭐ RECORDED, NOT SILENTLY FORGOTTEN. A crashed gate that leaves a lock behind is how you
    learn a run died without anybody noticing; swallowing it loses that entirely."""
    lock = tmp_path / "box.lock"
    proc = _spawn_gate_like(1)
    proc.kill(); proc.wait(timeout=10)
    dead_pid = proc.pid
    for _ in range(8):                    # let the OS reap it
        if not L._alive(dead_pid):
            break
        time.sleep(0.5)
    _write_lock_for(dead_pid, lock, run_id="the-crashed-one")

    rec = L.acquire("mine", path=lock)
    assert rec["acquired"] is True, "a dead holder must not block the box forever"
    assert rec["reclaimed"] is not None, "the reclaim was silent — a crashed gate is now invisible"
    assert rec["reclaimed"]["run_id"] == "the-crashed-one"
    assert rec["reclaimed"]["pid"] == dead_pid


def test_an_idle_but_LIVE_holder_is_NOT_stale(tmp_path):
    """⛔ OWNER RULING R1, STATED AS A RAIL: *"Do not treat 'pid alive but idle' as stale — that
    is exactly a Live-session-in-waiting."*

    A device session parked on a BrowserStack mirror holds a box that is genuinely not free. This
    is where the tool deliberately DIVERGES from `measure_lock.py`, which also ages a lock out on
    a heartbeat TTL. Here liveness is the only test, so an idle holder keeps the box.
    """
    proc = _spawn_gate_like()             # alive, doing nothing at all
    lock = tmp_path / "box.lock"
    try:
        rec = _write_lock_for(proc.pid, lock)
        rec["started_at"] = "2020-01-01T00:00:00"     # ancient, and irrelevant
        lock.write_text(json.dumps(rec), encoding="utf-8")
        assert L.status(path=lock)["state"] == "HELD", "an idle live holder was aged out"
        with pytest.raises(L.LockHeld):
            L.acquire("mine", path=lock)
    finally:
        proc.kill(); proc.wait(timeout=10)


# ── bypass ────────────────────────────────────────────────────────────────────────────────────

def test_R3_a_bypassed_run_under_a_live_holder_still_lands_INCONCLUSIVE_CONTENDED(tmp_path,
                                                                                  monkeypatch):
    """⛔⛔ OWNER RULING R3, AND IT IS THE POINT OF THE WHOLE BYPASS DESIGN.

    *"a bypass NEVER buys a CLEAR verdict: the bypassed run is still sampled and lands
    INCONCLUSIVE-CONTENDED if the holder is alive, with the bypass reason in the manifest. The
    override lets you run; it does not let you pretend."*

    The chain is driven end to end: a LIVE holder, a bypass WITH a reason, and then the sampler —
    which knows nothing about locks or bypasses — asked for its verdict over the same interval.

    ⚠️ The holder is spawned by this test, so it is our own child; we therefore sample WITHOUT the
    tree exclusion, because a real holder belongs to another session and is NOT our descendant.
    The exclusion itself is exercised by its own rails in `test_gate_box_sampler.py`; using it
    here would hide the very process the rule is about.
    """
    proc = _spawn_gate_like()
    lock = tmp_path / "box.lock"
    try:
        _write_lock_for(proc.pid, lock)
        monkeypatch.setenv(L.BYPASS_ENV, "R3 rail: proving a bypass does not buy CLEAR")

        rec = L.acquire("mine", path=lock)
        # it RUNS ...
        assert rec["bypass"] is True
        assert rec["bypass_reason"] == "R3 rail: proving a bypass does not buy CLEAR"
        assert rec["overrode"]["pid"] == proc.pid
        # ... and it does NOT steal the lock from the live holder
        assert rec["acquired"] is False
        assert json.loads(lock.read_text(encoding="utf-8"))["pid"] == proc.pid

        # ... and the sampler's verdict is unmoved by any of that.
        samples, seen = [], False
        for _ in range(10):
            s = S.take_sample(S._self_pids())
            samples.append(s)
            if proc.pid in {f["pid"] for f in s["foreign"]}:
                seen = True
                if len(samples) >= S.MIN_SAMPLES:
                    break
            time.sleep(0.75)
        assert seen, ("the sampler never saw the live holder, so this rail proved nothing about "
                      "the verdict")
        v = S.verdict(samples)
        assert v["code"] == S.EXIT_CONTENDED, v
        assert v["code"] != S.EXIT_CLEAR, "a bypass bought a CLEAR verdict — R3 is violated"
        assert proc.pid in {i["pid"] for i in v["intruders"]}
    finally:
        proc.kill(); proc.wait(timeout=10)


def test_a_bypass_with_NO_reason_is_ignored_and_the_run_is_refused(tmp_path, monkeypatch):
    """⛔ THE CONTROL FOR THE RAIL ABOVE. An override with no stated reason is indistinguishable
    from a typo or a variable left set in a shell three days ago, so it buys nothing at all."""
    proc = _spawn_gate_like()
    lock = tmp_path / "box.lock"
    try:
        _write_lock_for(proc.pid, lock)
        for blank in ("", "   ", "\t\n"):
            monkeypatch.setenv(L.BYPASS_ENV, blank)
            with pytest.raises(L.LockHeld):
                L.acquire("mine", path=lock)
        # ⭐ and the same call with a real reason DOES proceed — so the refusals above are about
        # the missing reason, not about the bypass being broken.
        monkeypatch.setenv(L.BYPASS_ENV, "a stated reason")
        assert L.acquire("mine", path=lock)["bypass"] is True
    finally:
        proc.kill(); proc.wait(timeout=10)


def test_the_bypass_is_written_to_a_reviewable_log(tmp_path, monkeypatch):
    """A bypass that leaves no trace is the `--no-verify` shape this repo has already ruled out."""
    proc = _spawn_gate_like()
    lock = tmp_path / "box.lock"
    logfile = tmp_path / "bypass.log"
    try:
        _write_lock_for(proc.pid, lock)
        monkeypatch.setattr(L, "BYPASS_LOG", logfile)
        monkeypatch.setenv(L.BYPASS_ENV, "because the runbook said so")
        L.acquire("mine", path=lock)
        rows = [json.loads(l) for l in logfile.read_text(encoding="utf-8").splitlines() if l.strip()]
        assert rows and rows[-1]["reason"] == "because the runbook said so"
        assert rows[-1]["overrode"]["pid"] == proc.pid
    finally:
        proc.kill(); proc.wait(timeout=10)


# ── the race ──────────────────────────────────────────────────────────────────────────────────

_RACER = r'''
import json, os, pathlib, sys, time
sys.path.insert(0, sys.argv[1])
import gate_box_lock as L
lock = pathlib.Path(sys.argv[2])
go = pathlib.Path(sys.argv[3])
while not go.exists():
    time.sleep(0.01)
try:
    r = L.acquire("racer-%d" % os.getpid(), path=lock)
    print(json.dumps({"won": bool(r["acquired"]), "reclaimed": bool(r.get("reclaimed"))}),
          flush=True)
except Exception as e:
    print(json.dumps({"won": False, "reclaimed": False, "err": type(e).__name__}), flush=True)
# ⛔ STAY ALIVE. A racer that exits the instant it wins makes its OWN lock stale immediately,
# and the next racer then legitimately reclaims it. See the rail's docstring.
time.sleep(4)
'''


def test_two_acquirers_racing_produce_exactly_one_winner(tmp_path):
    """⛔ THE ATOMIC CREATE IS PROVED, NOT ASSERTED.

    Six real processes block on a start file and then all call `acquire` at once. `O_CREAT|O_EXCL`
    is one syscall that either creates the file or fails because someone else already did; a
    check-then-write has a window between the halves, and two gates starting in the same second is
    not hypothetical here — it is the use case.

    ⚰️ **THE FIRST VERSION OF THIS RAIL REPORTED FOUR WINNERS, AND THE LOCK WAS INNOCENT.** The
    racers exited the moment they printed, so each winner's lock became stale within milliseconds
    and the next racer correctly *reclaimed* it. The discriminator was already in the record:
    three of the four carried `reclaimed=True`, and only one had won the actual create. ⭐ The
    lesson generalises past this file — **when staleness is defined by pid liveness, a holder that
    dies instantly cannot be used to test contention at all.** Racers now stay alive past the
    window.

    ⭐ TWO assertions, because they fail for different reasons: exactly one WON (zero means the
    lock is broken, two means it is not a lock), and **no winner reclaimed** — which is what makes
    this a test of the atomic create rather than of the reclaim path.
    """
    lock = tmp_path / "box.lock"
    go = tmp_path / "go"
    script = tmp_path / "racer.py"
    script.write_text(_RACER, encoding="utf-8")

    procs = [subprocess.Popen([sys.executable, str(script), str(ROOT / "tools"), str(lock), str(go)],
                              stdout=subprocess.PIPE, text=True, encoding="utf-8")
             for _ in range(6)]
    try:
        time.sleep(1.0)                   # let them all reach the barrier
        go.write_text("go", encoding="utf-8")
        outs = [json.loads(p.communicate(timeout=90)[0].strip().splitlines()[0]) for p in procs]
    finally:
        for p in procs:
            if p.poll() is None:
                p.kill()

    wins = [o for o in outs if o["won"]]
    assert len(wins) == 1, f"expected exactly one winner, got {len(wins)}: {outs}"
    assert not wins[0]["reclaimed"], (
        "the single winner won by RECLAIMING a stale lock, so this proved the reclaim path and "
        f"not the atomic create: {outs}")
    assert sum(1 for o in outs if not o["won"]) == 5, outs
    assert lock.exists(), "the winner did not leave a lock behind"


def test_release_never_removes_someone_elses_lock(tmp_path):
    """⛔ A release that clears whatever it finds turns one crashed run into a free-for-all — and
    the bypass path never took the lock at all, so a blind release there would drop a live
    holder's lock on the floor."""
    lock = tmp_path / "box.lock"
    _write_lock_for(424242, lock)
    assert L.release(path=lock) is False, "released a lock belonging to another pid"
    assert lock.exists()
    # ⭐ CONTROL: our own lock IS released, so the refusal above is about ownership.
    lock.unlink()
    L.acquire("mine", path=lock)
    assert L.release(path=lock) is True


# ── the sampler must not report the lock tool ─────────────────────────────────────────────────

@pytest.mark.skipif(sys.platform != "win32", reason="the snapshot is a Win32_Process query")
def test_the_lock_tools_own_process_is_never_a_finding():
    """The lock tool is a python process that talks about gates for a living. It must not BE one.

    ⭐ Two separate defences, and the rail checks both: the matcher does not classify it (its
    command line carries no gate token), and the descendant walk would exclude it anyway when it
    runs inside a measured tree — the same exclusion that now covers the suite's fixtures.
    """
    child = subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(20)", "tools/gate_box_lock.py", "status"],
        cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        seen = False
        for _ in range(8):
            snap = S._snapshot()
            row = next((p for p in snap["procs"] if p["ProcessId"] == child.pid), None)
            if row is None:
                time.sleep(0.75)
                continue
            seen = True
            assert S.classify_process(row.get("Name", ""), row.get("cl") or "",
                                      row["ProcessId"]) is None, (
                "the lock tool was classified as a gate — the instrument is a finding again")
            sample = S.take_sample(S._self_pids(), tree_pid=os.getpid())
            assert child.pid not in {f["pid"] for f in sample["foreign"]}
            break
        assert seen, "the spawned lock-tool process never appeared; nothing was proved"
        # ⛔ CONTROL: the matcher has not simply stopped working — a real gate line still matches.
        assert S.classify_process(
            "python.exe", r"C:\Python314\python.exe -u scripts/gate_shards.py --shards 6",
            pid=999) == "gate"
    finally:
        child.kill(); child.wait(timeout=10)


# ── the wrapper's own refusal ─────────────────────────────────────────────────────────────────

def test_the_wrapper_refuses_to_start_under_a_live_holder_with_REFUSED_LOCK(tmp_path, monkeypatch):
    """gate_shards.main() must refuse its own start, name the holder, and say REFUSED-LOCK.

    ⛔ NOT A SUITE VERDICT. Consistent with how `stage-2-verification.md` §2 now treats
    `run-hub-rails.mjs`'s exit 2: a refusal to start is "this did not run", never "this ran".
    """
    sys.path.insert(0, str(ROOT / "scripts"))
    import gate_shards

    proc = _spawn_gate_like()
    lock = tmp_path / "box.lock"
    try:
        _write_lock_for(proc.pid, lock)
        monkeypatch.setenv(L.LOCK_ENV, str(lock))
        import io
        buf_out, buf_err = io.StringIO(), io.StringIO()
        monkeypatch.setattr(sys, "stdout", buf_out)
        monkeypatch.setattr(sys, "stderr", buf_err)
        rc = gate_shards.main(["--shards", "1", "--out", str(tmp_path / "runs")])
        monkeypatch.undo()

        out, err = buf_out.getvalue(), buf_err.getvalue()
        assert rc == gate_shards.EXIT_LOCK_HELD == 4, rc
        assert "VERDICT=REFUSED-LOCK exit=4" in out, out
        assert str(proc.pid) in err, err
        assert "gate_shards.py" in err, err
        # ⛔ and it must NOT read as a suite result
        for suite_word in ("NO_NEW_FAILURES", "NEW_FAILURES", "DID_NOT_RECONCILE"):
            assert suite_word not in out, f"a refusal printed {suite_word}"
        # ⭐ and the refusal cost nothing: no manifest was written
        assert not list((tmp_path / "runs").glob("*.json")) if (tmp_path / "runs").exists() else True
    finally:
        proc.kill(); proc.wait(timeout=10)


def test_the_wrapper_takes_and_RELEASES_the_lock_around_a_run(tmp_path, monkeypatch):
    """⛔ EVERY EXIT PATH RELEASES, including the refusal paths. A lock only the happy path
    releases strands the box the first time anything goes wrong — which is when it matters most.

    Driven through the GateError path (a dirty tree), because that is the exit that historically
    gets forgotten.
    """
    sys.path.insert(0, str(ROOT / "scripts"))
    import gate_shards

    lock = tmp_path / "box.lock"
    monkeypatch.setenv(L.LOCK_ENV, str(lock))
    monkeypatch.setattr(gate_shards, "tree_state", lambda: ("abc123", ["?? dirty.py"]))
    import io
    buf = io.StringIO()
    monkeypatch.setattr(sys, "stdout", buf)
    monkeypatch.setattr(sys, "stderr", io.StringIO())
    rc = gate_shards.main(["--shards", "1", "--out", str(tmp_path / "runs")])
    monkeypatch.undo()

    assert rc == 2, "a dirty tree must still be INVALID"
    assert not lock.exists(), (
        "the lock survived a refused run — the box is now stranded until somebody notices")


# ══════════════════════════════════════════════════════════════════════════════════════════════
# C-4 — THE LOCK MUST SEE SCOPED SUITES, NOT JUST GATES.
#
# ⚰⚰ Measured 2026-09-15 20:26 by the integrator: `python tools/gate_box_lock.py status` printed
# **FREE** while FIFTEEN live processes were running — two scoped pytest runs and a vitest with
# thirteen workers, all from other sessions. Every word of the output was true and the reader's
# conclusion was wrong, because "nobody holds the queue ticket" had been left to stand in for
# "the box is free to measure". A caller who trusts that starts a six-shard gate into a loaded
# box; that exact collision OOM-swept a worktree on 2026-09-12.
#
# ⛔⛔ THE FIX IS TWO FIELDS, NEVER ONE BOOLEAN. `state` answers who holds the ticket; `load`
# answers what is running. FREE + BUSY is a real and common combination — it IS the 20:26
# reading — and a tool that could only say one thing would have to lie about one of them.
# ══════════════════════════════════════════════════════════════════════════════════════════════


def _quiet_snapshot():
    return {"free_kb": 12 * 1024 * 1024, "total_kb": 32 * 1024 * 1024, "procs": []}


def _busy_snapshot():
    return {"free_kb": 6 * 1024 * 1024, "total_kb": 32 * 1024 * 1024, "procs": [
        {"ProcessId": 71001, "ParentProcessId": 1, "Name": "python.exe", "mb": 40,
         "cl": "python -m pytest tests/test_publishers.py"},
        {"ProcessId": 71002, "ParentProcessId": 1, "Name": "node.exe", "mb": 900,
         "cl": "node vitest.mjs run --shard=5/6 --maxWorkers=2"},
    ]}


def _broken_snapshot():
    raise RuntimeError("the process snapshot failed (drill)")


def _with_snapshot(monkeypatch, snapshot):
    """Point the lock's probe at a fixed box, through the REAL box_load so the wiring is tested.

    ⛔ It composes on `_REAL_BOX_LOAD`, never on `S.box_load` — calling this twice in one test
    would otherwise wrap the previous wrapper and the SECOND snapshot would be ignored, which is
    exactly the shape that makes a control silently agree with the case it is controlling for.
    """
    monkeypatch.setattr(S, "box_load", lambda **kw: _REAL_BOX_LOAD(snapshot=snapshot, **kw))


def test_an_EMPTY_lock_on_a_LOADED_box_reports_FREE_and_BUSY_at_the_same_time(tmp_path,
                                                                             monkeypatch):
    """⛔⛔ THE 20:26 DEFECT, DRIVEN. The two facts must both survive one call, in two fields.

    ⭐ THE CONTROL IS THE SECOND HALF of this test: the same empty lock on a QUIET box must read
    FREE + QUIET. Without it, a `status` that hard-coded BUSY would satisfy the first half — and
    a probe that answered "busy" to everything is no better than one that answered "free".
    """
    _with_snapshot(monkeypatch, _busy_snapshot)
    s = L.status(path=tmp_path / "box.lock")
    assert s["state"] == "FREE", "the holder question changed answer because the box was loaded"
    assert s["load"]["state"] == "BUSY", s["load"]
    assert s["load"]["total"] == 2, s["load"]
    # ⛔ TWO KEYS. Collapsing them into one boolean is this repo's recurring defect.
    assert "state" in s and "state" in s["load"] and s["state"] != s["load"]["state"]

    _with_snapshot(monkeypatch, _quiet_snapshot)
    q = L.status(path=tmp_path / "box.lock")
    assert q["state"] == "FREE" and q["load"]["state"] == "QUIET", (
        "a quiet box did not read QUIET, so BUSY above proved nothing")


def test_a_probe_that_CANNOT_RUN_is_unreadable_and_never_a_count_of_zero(tmp_path, monkeypatch):
    """⛔ THE SWALLOWED-ERROR SHAPE. A failed probe reporting 0 is indistinguishable from a
    genuinely idle machine, and that is how a swallowed error becomes a confident finding.

    ⭐ And the holder field is UNAFFECTED — an unreadable probe must not be able to change what
    the lock says about who holds it.
    """
    _with_snapshot(monkeypatch, _broken_snapshot)
    s = L.status(path=tmp_path / "box.lock")
    assert s["load"]["state"] == "UNREADABLE"
    assert s["load"]["total"] is None, "a probe that failed reported a COUNT"
    assert s["load"]["error"], "an unreadable probe that says nothing about WHY is a silent zero"
    assert s["state"] == "FREE", "a failed probe moved the holder answer"

    # ⛔ 'nobody looked' is its own state, distinct from both of the above.
    n = L.status(path=tmp_path / "box.lock", load=False)
    assert n["load"]["state"] == "NOT_PROBED"
    assert n["load"]["total"] is None


def test_the_load_reading_NEVER_changes_the_holder_contract(tmp_path, monkeypatch):
    """⛔⛔ OWNER RULING R1 SURVIVES C-4 INTACT: the lock is ADVISORY, has NO TTL, and is stale
    ONLY when the bound pid is dead. "pid alive but idle" is a Live-session-in-waiting.

    A busy box must not reclaim, refuse or promote anything. Driven against an IDLE LIVE holder —
    this very pytest process, which is doing nothing the probe can call gate work — on the most
    loaded box the fixtures can describe.
    """
    lock = tmp_path / "box.lock"
    _write_lock_for(os.getpid(), lock, run_id="idle-but-live")

    _with_snapshot(monkeypatch, _busy_snapshot)
    s = L.status(path=lock)
    assert s["state"] == "HELD", "a loaded box reclassified a LIVE holder — R1 violated"
    assert s["live"] is True
    assert s["load"]["state"] == "BUSY"

    # ⛔ ADVISORY, NOT A MUTEX: a busy box does not become a refusal of its own.
    free_lock = tmp_path / "free.lock"
    rec = L.acquire("mine", path=free_lock)
    assert rec["acquired"] is True, (
        "the gate refused to start because the box was busy — that is a mutex, not a queue, and "
        "it would deadlock a gate behind its own vitest workers")
    assert rec["load"]["state"] == "BUSY", "the reading was taken but not reported to the caller"

    # ⭐ CONTROL, the only refusal there is: a DEAD holder is still reclaimed on a busy box…
    dead_lock = tmp_path / "dead.lock"
    _write_lock_for(999_999, dead_lock)
    assert L.acquire("mine", path=dead_lock)["acquired"] is True
    # …and a LIVE one still refuses.
    with pytest.raises(L.LockHeld):
        L.acquire("second", path=free_lock)


# ── THE NEGATIVE TEST — a probe that answers "quiet" to everything passes every assertion above ──

def _spawn_marked_child(seconds: int = 30) -> subprocess.Popen:
    """A live process carrying a PYTEST marker — the load class the lock could not see.

    ⚠️ DELIBERATELY NOT a `gate_shards.py` command line. Another workstream's sampler classifies
    that as a foreign GATE and would record a contention its measurement never actually had; the
    instrument must not manufacture a finding in somebody else's run. A pytest marker is invisible
    to `classify_process` (the contention matcher) by construction and visible to `classify_load`,
    which is exactly the case under test.
    """
    return subprocess.Popen(
        [sys.executable, "-c", f"import time; time.sleep({seconds})",
         "-m", "pytest", "tests/test_track_c_box_load_marker_probe.py", "-q"],
        cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


@pytest.mark.skipif(sys.platform != "win32", reason="the snapshot is a Win32_Process query")
def test_NEGATIVE_the_probe_reports_BUSY_while_something_really_runs_and_QUIET_after_it_exits():
    """⛔⛔ THE TEST THIS ITEM EXISTS FOR. Without a positive case the probe could return "quiet"
    unconditionally and every other assertion in this file would still pass — the
    `lesson_a_fixture_that_cannot_distinguish_is_not_a_rail` shape, on the one component whose
    whole job is to notice something.

    It runs against the REAL snapshot, not a fixture: the point is that the plumbing delivers a
    Name and a CommandLine and that the classifier sees them. A marked child is spawned, must be
    SEEN BY PID, and must STOP being seen once it exits — the two halves together are what make
    this a measurement rather than a detection.
    """
    child = _spawn_marked_child()
    try:
        seen_pids: set[int] = set()
        load = None
        for _ in range(10):               # WMI can lag a freshly created process by a beat
            load = _REAL_BOX_LOAD()
            assert load["readable"] is True, (
                f"the probe could not run at all, so this test measured nothing: {load['error']}")
            seen_pids = {p["pid"] for p in load["processes"]}
            if child.pid in seen_pids:
                break
            time.sleep(0.75)

        assert child.pid in seen_pids, (
            f"the probe did NOT see a live marked process (pid {child.pid}). It reported "
            f"{[(p['pid'], p['kind'], p['command_line'][:60]) for p in load['processes']]}")
        assert load["state"] == "BUSY", load["state"]
        assert load["total"] >= 1
        row = next(p for p in load["processes"] if p["pid"] == child.pid)
        assert row["kind"] == "pytest", row
        assert "pytest" in row["command_line"].lower(), row
    finally:
        child.kill()
        child.wait(timeout=10)

    # ── the other half: it must STOP being seen. A probe that latched would pass the first half.
    gone = False
    for _ in range(10):
        after = _REAL_BOX_LOAD()
        assert after["readable"] is True, after.get("error")
        if child.pid not in {p["pid"] for p in after["processes"]}:
            gone = True
            break
        time.sleep(0.75)
    assert gone, (
        f"pid {child.pid} is dead but the probe still reports it — the reading is a latch, not a "
        f"measurement, and a stale BUSY is as misleading as a false FREE")


@pytest.mark.skipif(sys.platform != "win32", reason="the snapshot is a Win32_Process query")
def test_a_gate_does_not_see_ITS_OWN_children_as_foreign_load():
    """⛔ THE DEADLOCK GUARD, against real processes rather than a fixture. A running gate spawns
    vitest workers; if the probe counted them the gate would be reporting itself.

    ⭐ THE DISCRIMINATION: the SAME live child, two calls, two answers — visible with no
    exclusion, invisible when this process's tree is excluded. One call alone could not tell
    'excluded' apart from 'never seen'.
    """
    child = _spawn_marked_child(seconds=25)
    try:
        visible = False
        for _ in range(10):
            load = _REAL_BOX_LOAD()
            assert load["readable"] is True, load.get("error")
            if child.pid in {p["pid"] for p in load["processes"]}:
                visible = True
                break
            time.sleep(0.75)
        assert visible, f"the child (pid {child.pid}) was never visible, so nothing is proved"

        mine = _REAL_BOX_LOAD(exclude_tree=os.getpid())
        assert mine["readable"] is True, mine.get("error")
        assert child.pid not in {p["pid"] for p in mine["processes"]}, (
            f"pid {child.pid} is OUR OWN CHILD and the probe called it foreign load — a gate "
            f"doing this sees its own vitest workers and refuses to start")
        assert mine["excluded_tree"] == os.getpid()
        # ⛔ …and excluding our tree did NOT silence the probe altogether: this pytest process is
        # itself a marked pytest run, so the no-exclusion call must have counted at least it too.
        assert _REAL_BOX_LOAD()["total"] > mine["total"] - 1
    finally:
        child.kill()
        child.wait(timeout=10)


def test_the_lock_self_check_still_passes_end_to_end():
    """⛔ A SELF-CHECK NOBODY HAS RUN IS NOT A SELF-CHECK — and it now rehearses all four load
    states against an injected box, so each is reachable on demand rather than whenever the
    machine happens to be loaded."""
    assert L.self_check() == 0
