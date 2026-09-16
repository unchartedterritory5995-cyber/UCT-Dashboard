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
import json
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


# ═══════════════════════════════════════════════════════════════════════════════════════════════
# THE SNAPSHOT CAN FAIL, AND A FAILED SNAPSHOT IS NOT A CLEAN ONE
#
# ⚰️ MEASURED 2026-09-15, in production use. `json.loads(proc.stdout)` raised
# `JSONDecodeError: Invalid control character at: line 1 column 106641` — PowerShell's
# `ConvertTo-Json` had emitted a RAW control character inside some process's command line.
#
# Two defects, one line apart:
#   * the parse was needlessly strict about data that was otherwise perfectly good; and
#   * `JSONDecodeError` subclasses `ValueError`, NOT `RuntimeError`, so it walked straight past
#     `watch()`'s handler, killed the run, and recorded NOTHING. The module docstring already
#     promised "a failed snapshot is not an empty box" — it could not keep that promise for the
#     one exception nobody was catching.
#
# ⛔ And closing the crash alone would have left the WORSE half open: `watch()` used to print the
# failure and SKIP the sample, so an interval where some snapshots failed still returned CLEAR
# from the survivors. An unobserved instant reported as clean is the exact "absence recorded as a
# pass" this tool exists to refuse.
# ═══════════════════════════════════════════════════════════════════════════════════════════════

def _payload(procs, free_gb=12.0, total_gb=32.0) -> str:
    return json.dumps({"free_kb": int(free_gb * 1024 * 1024),
                       "total_kb": int(total_gb * 1024 * 1024),
                       "procs": procs})


# ⚠️ THE FIXTURE IS A STATED STAND-IN, NOT THE ORIGINAL BYTES. The crashing snapshot was not kept
# and the offending process is long gone — a live snapshot taken while writing this contained ZERO
# raw control characters, so the exact character is unrecoverable. What IS reproduced is its
# SHAPE: a raw control byte inside a command-line string value, which is where char 106640 sat in
# a payload dominated by `cl` strings. `json.dumps` would escape it to `\\u0001` (valid JSON, and
# therefore useless as a fixture), so the escape is un-escaped back into a raw byte on purpose.
GATE_CL = r"C:\Python314\python.exe -u scripts/gate_shards.py --shards 6"


def _payload_with_raw_control_char() -> str:
    raw = _payload([{"ProcessId": 4242, "ParentProcessId": 1, "Name": "python.exe",
                     "cl": GATE_CL + "\u0001--tail", "mb": 24}])
    return raw.replace("\\u0001", "\x01")


class _Proc:
    def __init__(self, stdout, returncode=0):
        self.stdout, self.stderr, self.returncode = stdout, "", returncode


def test_the_control_character_fixture_really_carries_the_hazard():
    """⛔ NON-VACUITY ON THE FIXTURE. If the payload did not actually defeat a strict parse, every
    rail below would be testing nothing — the same reason the gate's ANSI fixture has this check."""
    payload = _payload_with_raw_control_char()
    assert "\x01" in payload, "the raw control character was escaped away; the fixture is inert"
    with pytest.raises(ValueError):
        json.loads(payload)                      # strict: this is the crash
    assert json.loads(payload, strict=False)     # lenient: the fix


def test_a_raw_control_character_is_tolerated_AND_the_process_is_still_classified(monkeypatch):
    """CONTROL (a) — the fix must not drop the very process that carried the character.

    ⭐ Tolerating the byte is only half the requirement. A "fix" that parsed the snapshot and then
    lost the row would be worse than the crash: the box would read quiet while a real gate ran on
    it. So this asserts the gate is still REPORTED, by pid, through the real `take_sample` path.
    """
    payload = _payload_with_raw_control_char()
    monkeypatch.setattr(S.subprocess, "run", lambda *a, **k: _Proc(payload))

    snap = S._snapshot()
    assert snap["procs"][0]["ProcessId"] == 4242

    sample = S.take_sample(frozenset())
    assert [f["pid"] for f in sample["foreign"]] == [4242], sample
    assert sample["foreign"][0]["kind"] == "gate"
    assert "gate_shards.py" in sample["foreign"][0]["command_line"]
    assert sample["free_gb"] == 12.0


def test_an_unparseable_snapshot_reaches_watch_as_RuntimeError(monkeypatch):
    """The conversion itself: whatever the cause, `_snapshot` raises the ONE type callers handle.

    ⛔ This is the half that killed the run. `JSONDecodeError` is a `ValueError`; `watch()` catches
    `RuntimeError`. Converting at the parse site keeps a single contract instead of asking every
    caller to know which exception families a snapshot can throw.
    """
    monkeypatch.setattr(S.subprocess, "run", lambda *a, **k: _Proc('{"procs": [{"Pro'))
    with pytest.raises(RuntimeError) as e:
        S._snapshot()
    assert "unparseable JSON" in str(e.value)
    assert not isinstance(e.value, json.JSONDecodeError)


def test_control_b_a_failed_snapshot_is_recorded_and_the_interval_is_never_CLEAR(monkeypatch):
    """CONTROL (b) — THE HOLE BEING CLOSED, driven end to end through `watch()`.

    Snapshots alternate good/bad, which is the realistic shape and the damaging one: the run
    CONTINUES, survivors exist, and before the fix those survivors produced a CLEAR verdict for an
    interval that was never fully observed. Now the failures are RECORDED as unobserved samples
    and the verdict can never be CLEAR.

    ⛔ This test FAILS on the pre-fix code — there the JSONDecodeError escapes `watch()` entirely
    and the call raises instead of returning a verdict.
    """
    good = _payload([])
    bad = '{"procs": [{"Pro'
    seq = iter([good, bad, good, bad, good, bad, good, bad])

    def fake_run(*a, **k):
        try:
            return _Proc(next(seq))
        except StopIteration:
            return _Proc(good)

    monkeypatch.setattr(S.subprocess, "run", fake_run)
    v = S.watch(seconds=0.05, interval=0.01)

    assert v["code"] != S.EXIT_CLEAR, f"an interval with an unreadable snapshot read as CLEAR: {v}"
    assert v["code"] == S.EXIT_UNOBSERVED, v
    assert v["unobserved"] >= 1, v
    assert v["samples"] > v["unobserved"], (
        "every sample failed, so this proves nothing about survivors buying CLEAR")
    assert "unparseable JSON" in (v.get("first_failure") or "")
    assert S.verdict_line(v).startswith("VERDICT=INCONCLUSIVE-UNOBSERVED exit=6 ")


def test_control_c_the_same_run_with_a_valid_snapshot_is_CLEAR(monkeypatch):
    """CONTROL (c) — so the INCONCLUSIVE in (b) is attributable to the BAD SNAPSHOT, not to the
    harness, the stubbing, the timing, or `watch()` being broken in general.

    ⭐ Identical call, identical timings, identical stub mechanism; only the payload differs."""
    monkeypatch.setattr(S.subprocess, "run", lambda *a, **k: _Proc(_payload([])))
    v = S.watch(seconds=0.05, interval=0.01)
    assert v["code"] == S.EXIT_CLEAR, v
    assert not [s for s in [] if s], "sanity"
    assert v["samples"] >= S.MIN_SAMPLES
    assert S.verdict_line(v).startswith("VERDICT=CLEAR exit=0 ")


def test_an_unobserved_sample_carries_no_invented_readings(monkeypatch):
    """⛔ THE MARKER MUST NOT FABRICATE. It carries `free_gb: None` and an empty foreign list
    because NOTHING WAS OBSERVED — a marker claiming 0 foreign processes and some plausible free
    memory would be indistinguishable from a real clean sample, which is the whole bug wearing a
    different hat."""
    # ⚠️ `watch()` CONSUMES ONE SNAPSHOT BEFORE IT SAMPLES — `_self_pids()` takes it to learn its
    # own ancestry. A stub sequence that forgets this feeds its first payload to a call that never
    # reaches the sample set, which is exactly how the first draft of this rail passed for the
    # wrong reason. Counted explicitly rather than assumed.
    calls = {"n": 0}

    def fake_run(*a, **k):
        calls["n"] += 1
        return _Proc('{"procs": [{"Pro' if calls["n"] == 2 else _payload([]))

    monkeypatch.setattr(S.subprocess, "run", fake_run)
    v = S.watch(seconds=0.05, interval=0.01)

    assert calls["n"] > 2, "the stub never got past the _self_pids call"
    assert v["code"] == S.EXIT_UNOBSERVED, v
    assert v["unobserved"] == 1, v
    # ⛔ the marker contributes NO memory reading: the minimum comes from the observed samples only
    assert v["min_free_gb"] == 12.0, v


def test_every_sampler_exit_code_has_a_verdict_name():
    """⛔ DERIVED FROM THE MODULE, never retyped — the same rail shape `gate_shards` carries, so a
    new sampler code cannot arrive without a name and print as UNKNOWN on the line operators read.
    `EXIT_UNOBSERVED` is why this exists now."""
    codes = {v for k, v in vars(S).items()
             if k.startswith("EXIT_") and isinstance(v, int) and k != "EXIT_SELF_CHECK_FAILED"}
    assert codes, "no EXIT_* constants found — the derivation broke"
    missing = sorted(c for c in codes if c not in S.VERDICT_NAMES)
    assert not missing, f"exit code(s) {missing} have no VERDICT= name"
    assert S.EXIT_UNOBSERVED in codes and S.VERDICT_NAMES[S.EXIT_UNOBSERVED] == "INCONCLUSIVE-UNOBSERVED"
    # ⭐ CONTROL: the table is not simply covering every integer.
    assert 99 not in S.VERDICT_NAMES


# ══════════════════════════════════════════════════════════════════════════════════════════════
# C-4 — the WIDER question: what is RUNNING on this box, not what CONTENDS with a measurement.
#
# ⚰ 2026-09-15 20:26: `gate_box_lock status` printed FREE while fifteen live processes were on
# this box — two scoped pytest runs and a vitest with thirteen workers. The lock was not broken;
# it only tracks runs that ASK for it, and only gate_shards.py asks. `classify_load` is the
# matcher that can see the rest, and `classify_process` is now a NARROWING of it.
# ══════════════════════════════════════════════════════════════════════════════════════════════


def _raises_snapshot():
    """A snapshot that fails, for the UNREADABLE controls below."""
    raise RuntimeError("the process snapshot failed (drill)")


@pytest.mark.parametrize("label,name,cl,expected", S.LOAD_CONTROL_CASES,
                         ids=[c[0][:44] for c in S.LOAD_CONTROL_CASES])
def test_the_load_matcher_answers_each_control_case(label, name, cl, expected):
    """⭐ THE TABLE IS THE TOOL'S OWN — `--self-check` and this rail read the same
    `LOAD_CONTROL_CASES`, so the operator-facing check and the suite can never disagree about
    what the probe is required to do."""
    assert S.classify_load(name, cl, pid=999, self_pids=frozenset()) == expected


def test_the_load_control_table_is_not_quietly_one_sided():
    """⛔ NON-VACUITY ON THE TABLE ITSELF. A table whose every case expected `None` would make the
    parametrised rail above pass while the matcher matched nothing at all — and a table carrying
    no `None` cases would hide a matcher that says yes to everything."""
    answers = {c[3] for c in S.LOAD_CONTROL_CASES}
    assert {"gate", "vitest", "pytest"} <= answers, answers
    assert None in answers, answers
    assert sum(1 for c in S.LOAD_CONTROL_CASES if c[3] is None) >= 3, "too few negative controls"


def test_the_contention_matcher_is_a_NARROWING_of_the_load_matcher_not_a_second_one():
    """⛔⛔ ONE IMPLEMENTATION, ONE NARROWING (lesson_a_guard_repeated_is_a_guard_unproved).

    Every case in BOTH tables must satisfy: `classify_process` equals `classify_load` except that
    'pytest' becomes None. Two independent matchers over the same command lines would be two token
    tables to keep in step, and the copy that drifts is the one nobody mutation-proved.
    """
    for label, name, cl, _expected in list(S.LOAD_CONTROL_CASES) + list(S.CONTROL_CASES):
        load = S.classify_load(name, cl, pid=999, self_pids=frozenset())
        contention = S.classify_process(name, cl, pid=999, self_pids=frozenset())
        assert contention == (None if load == "pytest" else load), (
            f"{label}: classify_process={contention!r} is not the narrowing of "
            f"classify_load={load!r}")


def test_a_scoped_pytest_run_is_LOAD_but_is_NOT_contention():
    """⛔ THE NARROWING IS THE WHOLE DIFFERENCE, and it is deliberate. Promoting pytest to the
    sampler's CONTENDED verdict would silently change the meaning of every other workstream's
    measurement — an owner call, not a side effect of teaching the lock to see load."""
    cl = r"C:\Python314\python.exe -m pytest tests/test_publish_caption.py"
    assert S.classify_load("python.exe", cl, pid=1) == "pytest"
    assert S.classify_process("python.exe", cl, pid=1) is None


def test_the_pytest_decoy_is_still_not_a_gate_but_IS_load():
    """⛔ THE DECOY THAT ONCE FABRICATED AN OOM EMERGENCY. `pytest tests/test_gate_shards.py` is
    not a gate — that stays true — but it is unmistakably a python test run occupying this box,
    and reporting it as 'nothing' is how FREE got printed onto a loaded machine."""
    cl = r"C:\Python314\python.exe -m pytest tests/test_gate_shards.py -q"
    assert S.classify_process("python.exe", cl, pid=1) is None
    assert S.classify_load("python.exe", cl, pid=1) == "pytest"


def test_box_load_never_reports_a_count_it_did_not_measure():
    """⛔⛔ A FAILED PROBE IS NOT A QUIET BOX. `total: 0` from a snapshot that never happened is
    indistinguishable from a genuinely idle machine — the swallowed-error-becomes-a-confident-
    finding shape. UNREADABLE carries `total: None` and the reason it could not look.

    ⭐ CONTROL beside it: the same call over a real (empty) snapshot answers QUIET with a real
    `total: 0`, so 'no number' stays reserved for 'we could not look'. And `NOT_PROBED` is a third
    state, because 'nobody asked me to look' is not either of the other two.
    """
    bad = S.box_load(snapshot=_raises_snapshot)
    assert bad["state"] == S.LOAD_UNREADABLE
    assert bad["readable"] is False
    assert bad["total"] is None, "a probe that FAILED reported a count"
    assert bad["counts"] is None
    assert "drill" in (bad["error"] or ""), bad

    quiet = S.box_load(snapshot=lambda: {"free_kb": 1024 * 1024, "total_kb": 2048 * 1024,
                                         "procs": []})
    assert quiet["state"] == S.LOAD_QUIET
    assert quiet["readable"] is True
    assert quiet["total"] == 0, "an EMPTY box must answer with a real zero, not None"
    assert quiet["error"] is None

    none = S.load_not_probed("the caller skipped it")
    assert none["state"] == S.LOAD_NOT_PROBED
    assert none["total"] is None and none["readable"] is False


def test_box_load_reports_the_evidence_not_just_a_count():
    """⛔ A COUNT IS NOT A DIAGNOSIS. "15 processes" sends a reader nowhere; this probe's own
    history is of counting things that were not there, so every row carries its command line.

    ⭐ The unmarked process in the fixture is the discriminator: a matcher that said yes to
    everything would report four.
    """
    snap = {"free_kb": 8 * 1024 * 1024, "total_kb": 32 * 1024 * 1024, "procs": [
        {"ProcessId": 4001, "ParentProcessId": 1, "Name": "python.exe", "mb": 40,
         "cl": "python -m pytest tests/test_publishers.py"},
        {"ProcessId": 4002, "ParentProcessId": 1, "Name": "node.exe", "mb": 900,
         "cl": "node vitest.mjs run --shard=5/6"},
        {"ProcessId": 4003, "ParentProcessId": 1, "Name": "python.exe", "mb": 24,
         "cl": "python scripts/gate_shards.py --shards 6"},
        {"ProcessId": 4004, "ParentProcessId": 1, "Name": "chrome.exe", "mb": 300,
         "cl": "chrome --type=renderer"},
    ]}
    load = S.box_load(snapshot=lambda: snap)
    assert load["state"] == S.LOAD_BUSY
    assert load["total"] == 3, "the unmarked process was counted, or a marked one was missed"
    assert load["counts"] == {"gate": 1, "vitest": 1, "pytest": 1}
    assert {p["pid"] for p in load["processes"]} == {4001, 4002, 4003}
    for row in load["processes"]:
        assert row["command_line"], "a row with no command line is a count wearing a diagnosis"
    assert load["free_gb"] == 8.0, load
    # ⭐ describe_load says the state out loud, and an unreadable probe gets NO number at all.
    assert "BUSY" in S.describe_load(load)
    unreadable_line = S.describe_load(S.box_load(snapshot=_raises_snapshot))
    assert "UNREADABLE" in unreadable_line
    assert "0 marked" not in unreadable_line, unreadable_line


def test_box_load_excludes_a_named_process_TREE_in_both_directions():
    """⛔ A RUNNING GATE MUST NOT SEE ITSELF. It spawns vitest workers; counting them as foreign
    load is the instrument becoming the finding. `exclude_tree` drops the named pid, everything
    ABOVE it (the shell whose command line quotes the gate) and everything BELOW it.

    ⭐ AND THE CONTROL IS THE SAME SNAPSHOT WITH NO EXCLUSION — it must report all four, or
    'excluded' would be indistinguishable from 'never matched'.
    """
    snap = {"free_kb": 4 * 1024 * 1024, "total_kb": 32 * 1024 * 1024, "procs": [
        {"ProcessId": 10, "ParentProcessId": 1, "Name": "bash.exe", "mb": 5,
         "cl": "bash -c python scripts/gate_shards.py --shards 6"},     # ancestor
        {"ProcessId": 20, "ParentProcessId": 10, "Name": "python.exe", "mb": 24,
         "cl": "python scripts/gate_shards.py --shards 6"},             # the gate itself
        {"ProcessId": 30, "ParentProcessId": 20, "Name": "node.exe", "mb": 800,
         "cl": "node vitest.mjs run --shard=1/6"},                      # its own worker
        {"ProcessId": 40, "ParentProcessId": 30, "Name": "node.exe", "mb": 700,
         "cl": "node vitest.mjs run --shard=1/6"},                      # a grandchild worker
        {"ProcessId": 99, "ParentProcessId": 1, "Name": "node.exe", "mb": 900,
         "cl": "node vitest.mjs run --shard=5/6"},                      # SOMEBODY ELSE'S
    ]}
    mine = S.box_load(exclude_tree=20, snapshot=lambda: snap)
    assert {p["pid"] for p in mine["processes"]} == {99}, (
        "the gate saw its own tree as foreign load — a gate that refuses on this deadlocks "
        "behind its own vitest workers")
    assert mine["state"] == S.LOAD_BUSY, "somebody else's vitest is still real load"
    assert mine["excluded_tree"] == 20

    everything = S.box_load(snapshot=lambda: snap)
    # ⚠️ pid 10 is a SHELL whose command line merely quotes the gate — never a finding, with or
    # without the exclusion. That is the name test doing its job, not the tree walk.
    assert {p["pid"] for p in everything["processes"]} == {20, 30, 40, 99}, (
        "the control did not see the tree at all, so the exclusion above proved nothing")
    assert everything["excluded_tree"] is None
