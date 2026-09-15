"""Rails for the box sampler — the instrument that decides whether a measurement is admissible.

⛔ WHY THIS FILE IS PARANOID ABOUT CONTROLS. Every historical failure of this probe was an
instrument returning ONE answer to TWO questions:

  * a process sweep matched its own command line and reported seven gates and foreign workers —
    the OOM-sweep signature, fabricated out of nothing;
  * the same sweep later matched `tests/test_gate_shards.py`, the gate's own TEST, and called it a
    gate;
  * an earlier sampler emitted only after 400 iterations, so stopping it early returned an empty
    string, and the caller's `-like '0/*'` test read empty as CONTENDED.

So the rails below are written in pairs. A test that only proves the probe can say "yes" is
exactly the test that would have passed during all three of those.
"""
from __future__ import annotations

import os
import pathlib
import subprocess
import sys
import time

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "tools"))

import gate_box_sampler as S  # noqa: E402

REPO = pathlib.Path(__file__).resolve().parent.parent


# ── The matcher, against strings that really appeared on this box ─────────────────────────────

@pytest.mark.parametrize("label,name,cl,expected", S.CONTROL_CASES,
                         ids=[c[0][:40] for c in S.CONTROL_CASES])
def test_the_matcher_answers_each_control_case(label, name, cl, expected):
    """⭐ THE TABLE IS THE TOOL'S OWN, NOT A COPY. `--self-check` and this rail read the same
    `CONTROL_CASES`, so the operator-facing check and the suite can never disagree about what the
    probe is required to do — a second copy here would be the typed second authority that this
    repo's gate baseline, writer index and COT router have each already paid for."""
    assert S.classify_process(name, cl, pid=999, self_pids=frozenset()) == expected


def test_the_control_table_is_not_quietly_one_sided():
    """⛔ NON-VACUITY ON THE TABLE ITSELF. A table of eight cases that all expect `None` would make
    every parametrised case above pass while the matcher matched nothing at all."""
    answers = {c[3] for c in S.CONTROL_CASES}
    assert "gate" in answers and "vitest" in answers and None in answers, answers
    assert sum(1 for c in S.CONTROL_CASES if c[3] is None) >= 3, "too few negative controls"


def test_a_command_line_naming_both_the_gate_and_its_test_is_still_read_correctly():
    """The decoy is STRIPPED before the gate token is sought, so a line carrying both is a gate.

    ⚠ Stated as a rail because the obvious implementation — reject any line containing the decoy —
    is wrong in the one case that matters: a gate whose `--out` happens to name the test file, or
    any future invocation that mentions both, would be dismissed as a decoy and a live gate would
    go unseen. Failing OPEN on contention is the direction that corrupts a measurement.
    """
    both = r"C:\Python314\python.exe scripts/gate_shards.py --shards 6  # unlike tests/test_gate_shards.py"
    assert S.classify_process("python.exe", both, pid=1) == "gate"


# ── The verdict ───────────────────────────────────────────────────────────────────────────────

def _s(at, free, foreign=()):
    return {"at": at, "free_gb": free, "total_gb": 31.8, "foreign": list(foreign)}


INTRUDER = {"kind": "gate", "pid": 30756, "name": "python.exe", "rss_mb": 24,
            "command_line": "python -u scripts/gate_shards.py --shards 6"}


def test_an_empty_sample_set_is_never_a_verdict():
    """⛔ THE 400-ITERATION BUG. Nobody looked is not "nothing was there", and it is not
    "something was there" either. It gets its own name so no caller can coerce it into either."""
    assert S.verdict([])["code"] == S.EXIT_NO_SAMPLES
    assert S.verdict([_s("t1", 12.0)])["code"] == S.EXIT_NO_SAMPLES, (
        "a single sample is an endpoint check — the exact method that let a whole gate slip "
        "between two clean readings on 2026-09-14")


def test_a_quiet_interval_is_CLEAR():
    """⛔ THE CONTROL for the two above: without it, `return NO_SAMPLES` always would pass them."""
    v = S.verdict([_s("t1", 12.0), _s("t2", 11.6), _s("t3", 11.9)])
    assert v["code"] == S.EXIT_CLEAR
    assert v["min_free_gb"] == 11.6


def test_an_intruder_in_ANY_sample_makes_the_whole_interval_inconclusive():
    """Clearance is a property of the interval. One dirty sample out of forty voids all forty."""
    v = S.verdict([_s("t1", 12.0), _s("t2", 11.8, [INTRUDER]), _s("t3", 11.9)])
    assert v["code"] == S.EXIT_CONTENDED
    assert v["first_seen"] == "t2"
    assert v["pid"] == 30756
    # ⛔ THE COMMAND LINE, NOT A COUNT. "1 intruder" gives a reader nothing to go and look at, and
    # this probe's own history is of counting things that were not there.
    assert "gate_shards.py" in v["command_line"]
    assert v["intruders"][0]["samples_seen"] == 1


def test_contention_outranks_the_memory_floor_when_both_are_true():
    """⛔ ORDER IS A FINDING, NOT A STYLE CHOICE. Free memory measured while somebody else's gate
    was running is a fact about THEIR run; reporting RESOURCE would name the wrong cause and send
    the next person to tune a memory limit that was never the problem."""
    v = S.verdict([_s("t1", 12.0), _s("t2", 3.9, [INTRUDER])])
    assert v["code"] == S.EXIT_CONTENDED


def test_the_memory_floor_is_the_owner_ruling_and_it_fires():
    v = S.verdict([_s("t1", 12.0), _s("t2", 4.31)])
    assert v["code"] == S.EXIT_RESOURCE
    assert S.FREE_MEMORY_FLOOR_GB == 4.5, "the floor is an owner ruling, not a tuning knob"
    # ⭐ CONTROL: a hair above the floor is still CLEAR, so the rail above is about the threshold
    # rather than about low numbers in general.
    assert S.verdict([_s("t1", 12.0), _s("t2", 4.51)])["code"] == S.EXIT_CLEAR


def test_every_verdict_code_is_distinct_and_named():
    """A caller that CAN read an exit code must not be handed a collision."""
    codes = [S.EXIT_CLEAR, S.EXIT_CONTENDED, S.EXIT_RESOURCE, S.EXIT_NO_SAMPLES]
    assert len(set(codes)) == 4
    assert all(c in S.VERDICT_NAMES for c in codes)
    assert S.EXIT_SELF_CHECK_FAILED not in set(codes) - {S.EXIT_SELF_CHECK_FAILED}


def test_the_sampling_interval_is_still_justified_by_the_measured_shard_durations():
    """⛔ THE JUSTIFICATION CANNOT QUIETLY STOP BEING TRUE. The interval is a tenth of the SHORTEST
    shard actually measured on this box, so a shard cannot begin and end between two samples. If
    somebody raises the constant, this goes red rather than the number silently becoming folklore."""
    bound = min(S.MEASURED_SHARD_SECONDS) / 10
    assert S.SAMPLE_SECONDS <= bound, (
        f"interval {S.SAMPLE_SECONDS}s exceeds shortest-shard/10 = {bound:.1f}s, so a shard could "
        f"run to completion unseen")
    assert len(S.MEASURED_SHARD_SECONDS) == 6, "six shards were measured; the record is the six"
    assert "shard-{1..6}.log" in S.MEASURED_SHARD_PROVENANCE, "the numbers must carry their source"


# ── The live plumbing ─────────────────────────────────────────────────────────────────────────

def _spawn(argv: list[str]) -> subprocess.Popen:
    return subprocess.Popen([sys.executable, "-c", "import time; time.sleep(25)"] + argv,
                            cwd=str(REPO), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


@pytest.mark.skipif(sys.platform != "win32", reason="the snapshot is a Win32_Process query")
def test_live_the_sampler_sees_a_gate_command_line_and_ignores_the_decoy_beside_it():
    """⛔ THE PURE TABLE CANNOT TEST THE PLUMBING. It proves the decision; this proves the snapshot
    actually delivers a Name and a CommandLine, that the self-pid walk does not swallow a real
    finding, and that the two travel together end to end.

    ⚠ HONEST ABOUT THE POSITIVE. This spawns a python process CARRYING a gate command line, not a
    six-shard gate: starting a second real gate on this box is forbidden by the standing one-gate
    rule, and doing it to satisfy a test would be the instrument causing the condition it measures.
    The verbatim command line of a REAL concurrent gate is captured in `CONTROL_CASES[0]`, read off
    pid 30756 while another workstream's gate was running on 2026-09-14.

    ⭐ The decoy is spawned SIMULTANEOUSLY and is a real process too, so this is a discrimination
    test rather than a detection test — both are on the box, exactly one must be reported.
    """
    gate_like = _spawn(["scripts/gate_shards.py", "--shards", "6"])
    decoy = _spawn(["-m", "pytest", "tests/test_gate_shards.py", "-q"])
    try:
        time.sleep(1.0)
        found: list[dict] = []
        for _ in range(8):                    # WMI can lag a fresh process by a beat
            sample = S.take_sample(S._self_pids())
            found = [f for f in sample["foreign"] if f["kind"] == "gate"]
            if found:
                break
            time.sleep(0.75)

        pids = {f["pid"] for f in found}
        assert gate_like.pid in pids, (
            f"the sampler did not see a live gate command line (pid {gate_like.pid}); it reported "
            f"{[(f['pid'], f['command_line'][:70]) for f in found]}")
        assert decoy.pid not in pids, (
            f"the sampler reported the pytest DECOY (pid {decoy.pid}) as a gate — this is the "
            f"exact false finding that fabricated an OOM-sweep emergency")
        row = next(f for f in found if f["pid"] == gate_like.pid)
        assert "gate_shards.py" in row["command_line"], row
    finally:
        for p in (gate_like, decoy):
            p.kill()
            p.wait(timeout=10)


@pytest.mark.skipif(sys.platform != "win32", reason="the snapshot is a Win32_Process query")
def test_live_a_sample_records_free_memory_and_never_reports_the_sampler_itself():
    """Free memory is recorded on EVERY sample (the owner ruling), and the process taking the
    sample — together with the shell that launched it, whose command line quotes the query — is
    never a finding. ⭐ The second half is what the historical false positive actually was."""
    sample = S.take_sample(S._self_pids())
    assert 0 < sample["free_gb"] <= sample["total_gb"], sample
    assert sample["at"], "a sample with no timestamp cannot place an intruder in time"
    import os
    assert os.getpid() not in {f["pid"] for f in sample["foreign"]}


def test_the_self_check_passes_and_can_fail():
    """⛔ A SELF-CHECK NOBODY HAS SEEN FAIL IS NOT A SELF-CHECK. It is run for real, and then run
    again with the decoy defused — which must make it report failure rather than quietly pass."""
    assert S.self_check() == 0

    original = S.DECOY_TOKENS
    try:
        S.DECOY_TOKENS = ()                   # the mutation: stop stripping the decoy
        assert S.self_check() == S.EXIT_SELF_CHECK_FAILED, (
            "the self-check passed with the decoy defence removed — it cannot fail, so it proves "
            "nothing")
    finally:
        S.DECOY_TOKENS = original
    assert S.self_check() == 0, "the mutation was not cleanly restored"


def test_the_verdict_line_is_one_greppable_line_in_the_shared_format():
    """⚠ FORMAT CONTRACT, deliberately identical to `scripts/gate_shards.py::verdict_line`, so one
    grep serves both tools and an operator learns the convention once."""
    line = S.verdict_line(S.verdict([_s("t1", 12.0), _s("t2", 11.8, [INTRUDER])]))
    assert line.startswith("VERDICT=INCONCLUSIVE-CONTENDED exit=3 ")
    assert "\n" not in line
    for token in line.split():
        assert "=" in token, f"bare token {token!r}"
        assert " " not in token.split("=", 1)[1]
    clear = S.verdict_line(S.verdict([_s("t1", 12.0), _s("t2", 11.8)]))
    assert clear.startswith("VERDICT=CLEAR exit=0 "), clear


def test_say_survives_a_character_the_console_cannot_encode(capsys):
    """⚰ THE FOURTH BODY. This module's own `--self-check` died on the ⛔ in one of its control
    labels, three cases into a passing run — the same class `gate_shards.say` documents three times
    over. A tool whose job is to report a verdict must not be able to die while reporting it."""
    S.say("⛔ Σ — verdict pending")
    assert "verdict pending" in capsys.readouterr().out


@pytest.mark.skipif(sys.platform != "win32", reason="the snapshot is a Win32_Process query")
def test_live_the_measured_run_and_its_children_are_not_intruders():
    """⚰ THIRD BODY: an instrument must not be a finding, in BOTH directions.

    `_self_pids` walks ancestors, which stops a shell from reporting itself. Nothing walked
    DOWNWARD, so a run wrapped with `--watch-pid` had its own children reported as foreign —
    and this very suite spawns a process carrying a gate command line on purpose, so sampling
    the suite that tests this tool made the tool fail its own measurement. The failure would
    have looked exactly like real contention, which is the worst possible disguise.

    ⭐ THE CONTROL IS THE SAME PROCESS, JUDGED WITHOUT THE EXCLUSION. One spawned child, two
    questions: "is it a gate" must stay YES, and "is it MY gate" must become NO. A rail that
    only proved it was hidden could be satisfied by a matcher that had simply stopped working.
    """
    child = _spawn(["scripts/gate_shards.py", "--shards", "6"])
    try:
        seen_as_foreign = seen_at_all = False
        for _ in range(8):
            snap = S._snapshot()
            pids_now = {p["ProcessId"] for p in snap.get("procs", [])}
            if child.pid not in pids_now:
                time.sleep(0.75)
                continue
            seen_at_all = True
            # the CONTROL: without the tree exclusion it is a gate
            row = next(p for p in snap["procs"] if p["ProcessId"] == child.pid)
            assert S.classify_process(row.get("Name", ""), row.get("cl") or "",
                                      row["ProcessId"]) == "gate", (
                "the matcher stopped seeing a gate at all — this rail would then pass for the "
                "wrong reason")
            sample = S.take_sample(S._self_pids(), tree_pid=os.getpid())
            seen_as_foreign = child.pid in {f["pid"] for f in sample["foreign"]}
            break
        assert seen_at_all, "the spawned child never appeared in a snapshot; nothing was proved"
        assert not seen_as_foreign, (
            f"the sampler reported its own measured run's child (pid {child.pid}) as an "
            f"intruder — the instrument is a finding again")
    finally:
        child.kill()
        child.wait(timeout=10)


def test_the_descendant_walk_is_transitive_and_does_not_climb():
    """Grandchildren are excluded; a SIBLING or a parent's other branch is not.

    ⛔ THE CONTROL IS THE WHOLE POINT. An exclusion wide enough to swallow a real gate would
    disable the check it lives inside, which is worse than the bug it fixes — the same
    argument the drift-exemption rail in `test_gate_shards.py` makes.
    """
    procs = [
        {"ProcessId": 10, "ParentProcessId": 1},     # the measured run
        {"ProcessId": 11, "ParentProcessId": 10},    # its child
        {"ProcessId": 12, "ParentProcessId": 11},    # its grandchild
        {"ProcessId": 20, "ParentProcessId": 1},     # ⛔ a SIBLING — somebody else's gate
        {"ProcessId": 1, "ParentProcessId": 0},      # the shared parent
    ]
    got = S._descendants(10, procs)
    assert got == {11, 12}, got
    assert 20 not in got, "a sibling process was excluded — a real intruder would be hidden"
    assert 1 not in got, "the walk climbed to the parent"
    assert S._descendants(99, procs) == set(), "an unknown root must exclude nothing"
