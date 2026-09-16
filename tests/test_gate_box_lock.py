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
