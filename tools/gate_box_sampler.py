#!/usr/bin/env python
"""Is this box quiet enough for a measurement — sampled DURING the run, not at its endpoints.

⚰⚰ WHY IT EXISTS, and it is a method error rather than a tooling gap. On 2026-09-14 the two
settling runs for the provisional baseline entries checked box clearance BEFORE the run and AGAIN
AFTER it, and both checks were clean. A third six-shard gate started *between* them, seconds after
the pre-check passed, and ran through the whole measurement. Two runs were invalidated. Clearance
is not a property of two instants; it is a property of an interval, and the only way to know it
held is to keep asking.

⚰ AND THE PROBE THAT ASKED USED TO REPORT ITSELF. Two separate sightings:

  * a process sweep matched its own command line and reported "7 gates running / FOREIGN workers",
    which is the OOM-sweep signature — a fabricated emergency;
  * the same sweep later matched `tests/test_gate_shards.py`, i.e. the TEST of the gate, and called
    it a gate.

Both are the same defect: a substring search over command lines counts the searcher and anything
that merely mentions the thing. `classify_process` below is a named, pure function precisely so it
can be shown a real gate, a decoy, and its own shell, and be required to answer differently.

⚰ AND AN EMPTY RESULT IS NOT AN ANSWER. The first version of this sampler only emitted after 400
iterations, so stopping it early returned nothing — and the caller's `-like '0/*'` test read
"nothing" as "contended". A sample set that is empty means NOBODY LOOKED, which is neither CLEAR
nor CONTENDED, and this tool says so with its own verdict name.

──────────────────────────────────────────────────────────────────────────────────────────────
USAGE

    python tools/gate_box_sampler.py --check                 # one sample, right now
    python tools/gate_box_sampler.py --watch 900             # sample for 15 minutes
    python tools/gate_box_sampler.py --watch-pid 12345       # sample while that process lives
    python tools/gate_box_sampler.py --self-check            # prove the matcher discriminates

Every mode ends with ONE greppable line:

    VERDICT=CLEAR exit=0 samples=45 min_free_gb=11.8 ...
    VERDICT=INCONCLUSIVE-CONTENDED exit=3 first_seen=... pid=... ...
    VERDICT=INCONCLUSIVE-RESOURCE exit=4 min_free_gb=4.31 ...
    VERDICT=INCONCLUSIVE-NO-SAMPLES exit=5 samples=0 ...

⛔ READ THE LINE, NEVER THE EXIT CODE — the status of a background task has lied in this repo
three times (see `scripts/gate_shards.py::VERDICT_NAMES` for the dates). The codes below are real
and distinct anyway, because a caller that *can* read them should not be given a collision.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import pathlib
import subprocess
import sys
import time

REPO = pathlib.Path(__file__).resolve().parent.parent

# ── Exit codes. Distinct on purpose: "not measurable" must never collide with "measured clear".
EXIT_CLEAR = 0
EXIT_CONTENDED = 3
EXIT_RESOURCE = 4
EXIT_NO_SAMPLES = 5
# ⛔ ITS OWN CODE, because "we looked and could not see" is neither "nobody looked" nor "the box
# was busy". An interval with an unreadable snapshot has a HOLE in it; a hole is not a clean
# reading, but it is also not evidence of contention, and reporting it as either would be a guess
# wearing a verdict's clothes.
EXIT_UNOBSERVED = 6
EXIT_SELF_CHECK_FAILED = 1

VERDICT_NAMES = {
    EXIT_CLEAR: "CLEAR",
    EXIT_CONTENDED: "INCONCLUSIVE-CONTENDED",
    EXIT_RESOURCE: "INCONCLUSIVE-RESOURCE",
    EXIT_NO_SAMPLES: "INCONCLUSIVE-NO-SAMPLES",
    EXIT_UNOBSERVED: "INCONCLUSIVE-UNOBSERVED",
}

# ⛔⛔ THE MEMORY FLOOR IS AN OWNER RULING, NOT A TUNING KNOB (2026-09-14): record free memory at
# every sample, and at 4.5 GB stop CLEANLY and record INCONCLUSIVE-RESOURCE. It is set where it is
# because this box has twice been swept by the OOM killer with free memory in that region, and the
# evidence of an OOM kill is precisely that there is no evidence — a killed run leaves a small log,
# no traceback, and a flattering exit status.
FREE_MEMORY_FLOOR_GB = 4.5

# ── The sampling interval, and the measurement that justifies it ───────────────────────────────
#
# ⛔ NOT A ROUND NUMBER SOMEBODY LIKED. These are the six shard durations of a real six-shard gate
# on this box, read from the `Duration` line of `docs/plans/joystick/gate-runs/shard-{1..6}.log`
# (those logs are untracked by design, so the numbers are transcribed here with their provenance
# rather than re-read at runtime from a file that may not exist).
MEASURED_SHARD_SECONDS = (274.29, 306.32, 338.25, 345.56, 362.33, 446.10)
MEASURED_SHARD_PROVENANCE = "docs/plans/joystick/gate-runs/shard-{1..6}.log, six-shard run, 2026-09-14"

# The shortest thing that constitutes contention and could plausibly begin and end unseen is ONE
# shard: 274.29s. Sampling at a tenth of that puts ≥13 samples inside the shortest shard and ~100
# across a full gate, so the 2026-09-14 failure — a whole gate appearing between two checks — is
# not reachable. `test_gate_box_sampler.py` re-derives this bound and fails if the constant drifts
# above it, so the justification cannot quietly stop being true.
SAMPLE_SECONDS = 20

# A run of any length must produce at least this many samples before CLEAR is a claim rather than
# an absence of evidence.
MIN_SAMPLES = 2

# ── Process names we are prepared to call a gate or a worker ──────────────────────────────────
# ⛔ THE NAME TEST IS WHAT KILLS THE SELF-MATCH. Every false "gate" this probe has ever reported
# was a `bash.exe` or `powershell.exe` whose command line merely CONTAINED the query. A shell that
# mentions a gate is not a gate.
PYTHON_NAMES = frozenset({"python.exe", "pythonw.exe", "python3.exe", "py.exe", "python", "python3"})
NODE_NAMES = frozenset({"node.exe", "node"})

GATE_TOKEN = "gate_shards.py"
# ⛔ THE DECOY. `tests/test_gate_shards.py` contains the gate's own name and is NOT a gate; a
# pytest run of it once made this probe report a gate that did not exist. It is removed from the
# command line BEFORE the gate token is looked for, so "pytest tests/test_gate_shards.py" leaves
# nothing to match while "python scripts/gate_shards.py" is untouched.
DECOY_TOKENS = ("tests/test_gate_shards.py", "test_gate_shards.py")

# ── The broader marker set: what is RUNNING, which is not the same question as what CONTENDS ───
#
# ⚰ MEASURED 2026-09-15 20:26. `python tools/gate_box_lock.py status` printed **FREE** while
# FIFTEEN live processes were on this box: two scoped pytest runs and a vitest with thirteen
# worker processes, all from other sessions. The lock was not broken — it only tracks runs that
# ASK for it, and only `gate_shards.py` asks. A caller reading FREE as "quiet" starts a six-shard
# gate into a loaded box, which is the collision that OOM-swept a worktree on 2026-09-12.
#
# ⛔ A SCOPED PYTEST RUN IS LOAD, AND IT IS NOT CONTENTION. `classify_process` — the sampler's
# verdict matcher — deliberately still answers None for it: promoting pytest to CONTENDED would
# silently retro-invalidate every other workstream's measurement, and that is an owner call, not
# a side effect of this change. `classify_load` below is the wider question, and the two share
# ONE implementation so the tokens can never drift apart.
PYTEST_NAMES = frozenset({"pytest.exe", "pytest"})
# ⛔ INVOCATION SHAPES, NOT THE BARE WORD. A python process whose command line merely CONTAINS
# "pytest" (`python -c "print('pytest')"`, a grep, a path under `.pytest_cache`) is the exact
# counting-the-searcher defect this file's docstring opens with. Captured from this box:
# `C:\Python314\python.exe -m pytest tests/test_publish_caption.py ...`.
PYTEST_TOKENS = ("-m pytest", "/pytest.exe")

# The three load states a probe can honestly report, plus the two that are NOT a count of zero.
# ⛔⛔ "NOTHING IS RUNNING", "I COULD NOT LOOK" AND "NOBODY ASKED ME TO LOOK" ARE THREE FACTS.
# A probe that failed and returned 0 is indistinguishable from a genuinely quiet box, and that is
# how a swallowed error becomes a confident finding.
LOAD_QUIET = "QUIET"
LOAD_BUSY = "BUSY"
LOAD_UNREADABLE = "UNREADABLE"
LOAD_NOT_PROBED = "NOT_PROBED"



def say(text: str = "", *, err: bool = False) -> None:
    """⛔ THE ONE CONSOLE WRITE, because `print` raised on this file's own output.

    ⚰ FOURTH BODY OF A DISEASE THIS REPO HAS ALREADY DOCUMENTED THREE TIMES
    (`scripts/gate_shards.py::say`): the subprocess READ decoded as cp1252 and destroyed a
    sixteen-minute run; `_git` had the same exposure; a bare `print(render(manifest))` then died on a Σ
    **after a completely successful gate**. This module was written the same hour as a reading of
    that comment and reintroduced it anyway — `--self-check` crashed on the ⛔ in one of its own
    control labels, three cases into a run that was passing.

    ⭐ The lesson is not "avoid the character". It is that a default-encoded `print` is an
    unguarded I/O boundary, and a tool whose job is to report a verdict must not be able to die
    while reporting it. `errors="replace"` degrades one glyph instead of losing the answer.
    """
    stream = sys.stderr if err else sys.stdout
    data = (text + "\n").encode("utf-8", "replace")
    buf = getattr(stream, "buffer", None)
    if buf is not None:
        buf.write(data)
        buf.flush()
    else:                                   # a stream with no binary buffer (captured in tests)
        stream.write(data.decode("utf-8", "replace"))
        stream.flush()


def _norm(command_line: str) -> str:
    """Path separators and case folded, so one token matches both spellings Windows produces."""
    return (command_line or "").replace("\\", "/").lower()


def classify_load(name: str, command_line: str, pid: int, *,
                  self_pids: frozenset[int] = frozenset()) -> str | None:
    """'gate' | 'vitest' | 'pytest' | None — IS THIS PROCESS LOAD ON THE BOX?

    ⭐ PURE, AND NAMED, SO IT CAN BE SHOWN THINGS. The controls in `self_check()` hand it a real
    gate command line, the pytest decoy, and one of the shells that historically matched itself,
    and require different answers. A matcher that is inlined into a sweep can only ever be tested
    by running the sweep, which is how both of this file's false findings survived.

    ⛔ THE NAME TEST FIRST, ALWAYS. Every false "gate" this probe has reported was a `bash.exe` or
    `powershell.exe` whose command line merely CONTAINED the query. A shell that mentions a gate
    is not a gate, and a grep for "pytest" is not a test run.

    ⚠️ AN UNREADABLE COMMAND LINE ANSWERS None, so this count is a LOWER BOUND on real load —
    `Get-CimInstance` returns a null CommandLine for processes this user cannot read. That is
    deliberate and pre-existing: classifying on the process NAME alone would be a guess. The
    honest consequence is that BUSY is provable and QUIET is the weaker claim, which is why
    `box_load` reports the count and the evidence rather than a bare boolean.
    """
    if pid in self_pids:
        return None
    n = (name or "").lower()
    cl = _norm(command_line)
    if not cl:
        return None
    if n in PYTEST_NAMES:
        return "pytest"
    if n in PYTHON_NAMES:
        stripped = cl
        for decoy in DECOY_TOKENS:
            stripped = stripped.replace(decoy, "")
        if GATE_TOKEN in stripped:
            return "gate"
        # ⛔ SEARCHED IN THE UNSTRIPPED LINE. `pytest tests/test_gate_shards.py` is not a gate —
        # that is the decoy — but it is unmistakably a pytest run, and load is load.
        if any(tok in cl for tok in PYTEST_TOKENS):
            return "pytest"
        return None
    if n in NODE_NAMES:
        # vitest workers are the load a gate actually applies; a gate's python parent is nearly
        # idle. Counting only the parent would call a box with six workers on it "clear".
        if "vitest" in cl:
            return "vitest"
    return None


def classify_process(name: str, command_line: str, pid: int, *,
                     self_pids: frozenset[int] = frozenset()) -> str | None:
    """'gate' | 'vitest' | None — the single authority on what counts as CONTENTION.

    ⛔⛔ IT DELEGATES; IT DOES NOT RE-MATCH. Two matchers over the same command lines would be two
    token tables to keep in step, and `lesson_a_guard_repeated_is_a_guard_unproved` says the copy
    that drifts is the one nobody mutation-proved. One implementation, one narrowing.

    ⛔ AND THE NARROWING IS THE WHOLE DIFFERENCE. A scoped pytest run is LOAD on this box but it
    is not what this sampler's CONTENDED verdict has ever meant, and widening that verdict would
    change the answer for every other workstream's measurement without anybody asking for it.
    `box_load` is where the wider question is asked.
    """
    kind = classify_load(name, command_line, pid, self_pids=self_pids)
    return None if kind == "pytest" else kind


# ── Taking a sample ───────────────────────────────────────────────────────────────────────────

_PS_SNAPSHOT = (
    "$os = Get-CimInstance Win32_OperatingSystem;"
    "$p = Get-CimInstance Win32_Process |"
    " Select-Object ProcessId,ParentProcessId,Name,"
    "@{n='cl';e={$_.CommandLine}},@{n='mb';e={[math]::Round($_.WorkingSetSize/1MB,0)}};"
    "@{free_kb=$os.FreePhysicalMemory; total_kb=$os.TotalVisibleMemorySize; procs=@($p)} |"
    " ConvertTo-Json -Depth 4 -Compress"
)


def _snapshot() -> dict:
    proc = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", _PS_SNAPSHOT],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if proc.returncode != 0 or not (proc.stdout or "").strip():
        # ⛔ A FAILED SNAPSHOT IS NOT AN EMPTY BOX. Raising keeps it out of the sample set, where
        # it would otherwise read as "nothing running" and manufacture a CLEAR.
        raise RuntimeError(
            f"the process snapshot failed (exit {proc.returncode}): "
            f"{(proc.stderr or proc.stdout or '').strip()[:300]}"
        )
    # ⛔⛔ STRICT=FALSE, AND THE FAILURE IS CONVERTED. Both halves are load-bearing.
    #
    # ⚰️ MEASURED, 2026-09-15: `ConvertTo-Json` emitted a RAW CONTROL CHARACTER inside a
    # process's command line, and `json.loads` rejects those by default —
    # `Invalid control character at: line 1 column 106641`. The snapshot was good data about a
    # real box; only the strictness was wrong.
    #
    # ⛔ AND THE EXCEPTION TYPE MATTERED MORE THAN THE PARSE. `JSONDecodeError` subclasses
    # `ValueError`, NOT `RuntimeError` — and `watch()` catches `RuntimeError`. So the one
    # failure mode this function had not anticipated walked straight past the handler written
    # to contain it, and the run DIED instead of recording a sample. The docstring above
    # already promised "a failed snapshot is not an empty box"; it could not keep that promise
    # for an exception nobody was catching.
    #
    # ⭐ Converting HERE rather than widening the catch in `watch()` keeps ONE contract: this
    # function raises RuntimeError on any failure to produce a snapshot, whatever the cause.
    try:
        return json.loads(proc.stdout, strict=False)
    except ValueError as e:
        raise RuntimeError(f"the process snapshot returned unparseable JSON: {e}") from e


def _self_pids() -> frozenset[int]:
    """This process AND ITS ANCESTORS — the shells that have historically matched themselves.

    ⛔ THE ANCESTORS ARE THE WHOLE POINT. The sampler's own python process never mentions
    `gate_shards.py`, so excluding only `os.getpid()` would look sufficient and catch nothing.
    What actually matched was the `bash.exe` two levels up, whose command line quoted the query —
    and on a failed snapshot the honest fallback is the one pid we can be sure of, never an empty
    set, which would re-open the hole.
    """
    me = os.getpid()
    try:
        snap = _snapshot()
    except Exception:
        return frozenset({me})
    return frozenset(_ancestors(me, snap.get("procs", [])))


def _ancestors(pid: int, procs: list[dict]) -> set[int]:
    """`pid` AND every process above it, from a snapshot already taken.

    ⛔ EXTRACTED FROM `_self_pids`, NOT COPIED BESIDE IT. `box_load` needs the same upward walk
    for a tree it is told about rather than for its own, and a second copy of a graph walk is a
    second thing to keep correct.
    """
    parents = {p["ProcessId"]: p.get("ParentProcessId") for p in procs}
    pids, cur, seen = {pid}, pid, set()
    while cur and cur not in seen:
        seen.add(cur)
        pids.add(cur)
        cur = parents.get(cur)
    return pids


def _descendants(root: int, procs: list[dict]) -> set[int]:
    """Every pid BELOW `root` in the process tree, from the snapshot already taken.

    ⛔ THE HALF `_self_pids` DOES NOT COVER. That walks upward, which stops a shell from
    reporting itself; this walks downward, which stops a measured run from reporting its own
    children. Both are the same rule — an instrument must not be a finding — and the tool had
    only one of them.
    """
    kids: dict[int, list[int]] = {}
    for p in procs:
        kids.setdefault(p.get("ParentProcessId"), []).append(p["ProcessId"])
    out: set[int] = set()
    stack = [root]
    while stack:
        cur = stack.pop()
        for k in kids.get(cur, ()):
            if k not in out:
                out.add(k)
                stack.append(k)
    return out


def load_not_probed(why: str) -> dict:
    """The record for "nobody looked" — which is NOT a count of zero, and says so in its state.

    ⛔ IT EXISTS SO A CALLER CANNOT OPT OUT OF THE PROBE AND STILL GET A NUMBER. A `load: None`
    or a `{"total": 0}` from a caller that skipped the snapshot is the same lie as a failed probe
    reporting a quiet box.
    """
    return {"state": LOAD_NOT_PROBED, "readable": False, "at": None, "total": None,
            "counts": None, "processes": [], "free_gb": None, "excluded_tree": None,
            "error": why}


def box_load(*, exclude_tree: int | None = None, snapshot=None) -> dict:
    """WHAT IS RUNNING ON THIS BOX RIGHT NOW, by marker — one snapshot, no verdict.

    ⛔⛔ THIS IS NOT A LOCK STATE AND MUST NEVER BE COLLAPSED INTO ONE. "No gate holds the lock"
    and "the box is busy" are two different facts with two different responses, and the lock
    reports them as two fields for exactly that reason. This function answers only the second.

    ⛔ A FAILED PROBE RETURNS `UNREADABLE`, NEVER `total: 0`. A zero from a snapshot that did not
    happen is indistinguishable from a genuinely quiet box; `readable` and `error` are what keep
    the two apart, and `total` is None rather than a number nobody measured.

    ⭐ `exclude_tree` IS THE ANTI-SELF-MATCH, BOTH DIRECTIONS. Pass a pid and this drops that
    process, everything ABOVE it (the shell whose command line quotes the gate) and everything
    BELOW it (a gate's own vitest workers). Without the downward half a running gate would see
    its own workers as foreign load and could refuse to start — the instrument becoming the
    finding, one layer out. ⚠️ The upward half can over-exclude: if a genuine intruder happens to
    be an ancestor of the caller it is dropped. `_self_pids` already makes that trade deliberately
    and for the same reason; over-excluding under-reports load, which is the direction a caller
    can still correct by looking, whereas a self-match manufactures an emergency.

    `snapshot` is injectable so a rail can hand it a fixed box without a PowerShell call.
    """
    take = snapshot or _snapshot
    at = _dt.datetime.now().isoformat(timespec="seconds")
    try:
        snap = take()
        procs = list(snap.get("procs") or [])
    except Exception as e:
        return {"state": LOAD_UNREADABLE, "readable": False, "at": at, "total": None,
                "counts": None, "processes": [], "free_gb": None,
                "excluded_tree": exclude_tree,
                "error": f"{type(e).__name__}: {e}"[:300]}
    exclude: set[int] = set()
    if exclude_tree is not None:
        exclude |= _ancestors(exclude_tree, procs)
        exclude |= _descendants(exclude_tree, procs)
    frozen = frozenset(exclude)
    counts = {"gate": 0, "vitest": 0, "pytest": 0}
    seen = []
    for p in procs:
        kind = classify_load(p.get("Name", ""), p.get("cl") or "", p["ProcessId"],
                             self_pids=frozen)
        if kind:
            counts[kind] += 1
            # ⛔ THE COMMAND LINE IS THE EVIDENCE. "15 processes" sends a reader nowhere; this
            # probe's own history is of counting things that were not there.
            seen.append({"kind": kind, "pid": p["ProcessId"], "name": p.get("Name"),
                         "rss_mb": p.get("mb"), "command_line": (p.get("cl") or "")[:400]})
    free_kb = snap.get("free_kb")
    return {
        "state": LOAD_BUSY if seen else LOAD_QUIET,
        "readable": True,
        "at": at,
        "total": len(seen),
        "counts": counts,
        "processes": seen,
        "free_gb": round(free_kb / 1024 / 1024, 2) if isinstance(free_kb, (int, float)) else None,
        "excluded_tree": exclude_tree,
        "error": None,
    }


def describe_load(load: dict | None) -> str:
    """One line a human can act on: the state, the counts, and the loudest pid."""
    if not load:
        return "load: NOT MEASURED (no record) — that is not 'quiet'"
    state = load.get("state")
    if state == LOAD_BUSY:
        c = load.get("counts") or {}
        worst = max(load.get("processes") or [], key=lambda p: p.get("rss_mb") or 0, default=None)
        tail = (f"; largest pid {worst['pid']} {worst['name']} "
                f"{(worst.get('command_line') or '')[:90]}" if worst else "")
        return (f"load: BUSY — {load.get('total')} marked process(es) "
                f"(gate {c.get('gate', 0)}, vitest {c.get('vitest', 0)}, "
                f"pytest {c.get('pytest', 0)}){tail}")
    if state == LOAD_QUIET:
        return f"load: QUIET — 0 marked processes outside our own tree at {load.get('at')}"
    # ⛔ Both remaining states say WHY, and neither says a number.
    return f"load: {state} — {load.get('error')}"


def take_sample(self_pids: frozenset[int], *, tree_pid: int | None = None) -> dict:
    """One observation: the time, free memory, and every foreign gate/worker seen right now."""
    snap = _snapshot()
    procs = snap.get("procs", [])
    free_gb = round(snap["free_kb"] / 1024 / 1024, 2)
    total_gb = round(snap["total_kb"] / 1024 / 1024, 2)
    # ⛔ THE MEASURED RUN AND EVERYTHING IT SPAWNED ARE NOT INTRUDERS. Computed from the SAME
    # snapshot as the classification, so a process that appears between two queries cannot be
    # excluded by one and reported by the other.
    exclude = set(self_pids)
    if tree_pid is not None:
        exclude.add(tree_pid)
        exclude |= _descendants(tree_pid, procs)
    exclude = frozenset(exclude)
    foreign = []
    for p in procs:
        kind = classify_process(p.get("Name", ""), p.get("cl") or "", p["ProcessId"],
                                self_pids=exclude)
        if kind:
            foreign.append({
                "kind": kind,
                "pid": p["ProcessId"],
                "name": p.get("Name"),
                "rss_mb": p.get("mb"),
                # ⛔ THE COMMAND LINE IS THE EVIDENCE. A count is not a diagnosis: "1 gate" gives a
                # reader nothing to go and look at, and this probe's own history is of counting
                # things that were not there.
                "command_line": (p.get("cl") or "")[:400],
            })
    return {
        "at": _dt.datetime.now().isoformat(timespec="seconds"),
        "free_gb": free_gb,
        "total_gb": total_gb,
        "foreign": foreign,
    }


# ── The verdict over a set of samples ─────────────────────────────────────────────────────────

def verdict(samples: list[dict], *, floor_gb: float = FREE_MEMORY_FLOOR_GB,
            min_samples: int = MIN_SAMPLES) -> dict:
    """Decide from the WHOLE interval. Order matters and is deliberate.

    ⛔ NO SAMPLES FIRST. An empty set is the one input that must never fall through to a judgement;
    it is the absence of a measurement, and the previous sampler's caller read it as contended.

    ⛔ CONTENTION BEFORE RESOURCE. If something else was on the box, the free-memory number is a
    fact about THAT run, not about ours, so reporting RESOURCE would name the wrong cause.
    """
    if len(samples) < min_samples:
        return {
            "code": EXIT_NO_SAMPLES,
            "samples": len(samples),
            "why": (f"only {len(samples)} sample(s) were taken, fewer than the {min_samples} "
                    f"required — nobody looked, which is not the same as nothing being there"),
        }

    # ⛔ AN UNOBSERVED INSTANT IS NOT A CLEAN ONE. The order below is deliberate, and each step
    # answers a different question. CONTENTION first: a process actually SEEN is a positive
    # finding and names a culprit. RESOURCE next: measured, specific, actionable. Only then
    # UNOBSERVED, which is the residual "we cannot honestly call this interval clear".
    unobserved = [s for s in samples if s.get("snapshot_failed")]
    observed = [s for s in samples if not s.get("snapshot_failed")]

    intruders = [(s, f) for s in observed for f in s["foreign"]]
    if intruders:
        first_sample, first = intruders[0]
        by_pid: dict[int, dict] = {}
        for s, f in intruders:
            row = by_pid.setdefault(f["pid"], {**f, "first_seen": s["at"], "samples_seen": 0})
            row["samples_seen"] += 1
            row["last_seen"] = s["at"]
        return {
            "code": EXIT_CONTENDED,
            "samples": len(samples),
            "first_seen": first_sample["at"],
            "pid": first["pid"],
            "kind": first["kind"],
            "command_line": first["command_line"],
            "intruders": list(by_pid.values()),
            # ⚠️ OBSERVED samples only — a marker carries free_gb=None and a bare min()
            # over the raw list raises. Found by the precedence control, not by review.
            "min_free_gb": min((s["free_gb"] for s in observed), default=None),
            "why": (f"a foreign {first['kind']} was on the box at {first_sample['at']} "
                    f"(pid {first['pid']}) — this interval cannot carry a measurement"),
        }

    # ⚠️ Only OBSERVED samples carry a free_gb; a marker has None and must not be min()'d
    # against a real number.
    min_free = min((s["free_gb"] for s in observed), default=None)
    if min_free is not None and min_free <= floor_gb:
        return {
            "code": EXIT_RESOURCE,
            "samples": len(samples),
            "min_free_gb": min_free,
            "why": (f"free memory reached {min_free} GB, at or below the {floor_gb} GB floor — "
                    f"stop cleanly at the next shard boundary and record INCONCLUSIVE-RESOURCE"),
        }

    if unobserved:
        return {
            "code": EXIT_UNOBSERVED,
            "samples": len(samples),
            "unobserved": len(unobserved),
            "min_free_gb": min_free,
            "first_failure": unobserved[0].get("snapshot_failed"),
            "why": (f"{len(unobserved)} of {len(samples)} sample(s) could not be taken "
                    f"({(unobserved[0].get('snapshot_failed') or '')[:120]}) — the interval has "
                    f"a hole in it and cannot be reported as clear"),
        }

    return {
        "code": EXIT_CLEAR,
        "samples": len(samples),
        "min_free_gb": min_free,
        "why": (f"{len(samples)} samples over the interval, no foreign gate or vitest worker in "
                f"any of them, free memory never below {min_free} GB"),
    }


def verdict_line(v: dict) -> str:
    """One greppable line. ⚠ No spaces inside a value — see `scripts/gate_shards.py::verdict_line`,
    whose format this deliberately matches so one grep serves both tools."""
    name = VERDICT_NAMES.get(v["code"], "UNKNOWN")
    fields = {"samples": v.get("samples"), "min_free_gb": v.get("min_free_gb")}
    if v["code"] == EXIT_UNOBSERVED:
        fields["unobserved"] = v.get("unobserved")
    if v["code"] == EXIT_CONTENDED:
        fields["first_seen"] = v.get("first_seen")
        fields["pid"] = v.get("pid")
        fields["kind"] = v.get("kind")
        fields["intruders"] = len(v.get("intruders") or [])
    parts = " ".join(f"{k}={val}" for k, val in fields.items() if val is not None)
    return f"VERDICT={name} exit={v['code']}" + (f" {parts}" if parts else "")


# ── The controls ──────────────────────────────────────────────────────────────────────────────

# ⛔ REAL COMMAND LINES, CAPTURED FROM THIS BOX, NOT INVENTED. An invented fixture tests the shape
# you imagined; each of these is a string that actually appeared while a probe was getting the
# answer wrong.
CONTROL_CASES = [
    # (label, name, command_line, expected)
    ("a real six-shard gate, another workstream",
     "python.exe", r"C:\Python314\python.exe -u scripts/gate_shards.py --shards 6", "gate"),
    ("the same gate, Windows-spelled path",
     "python.exe", r"C:\Python314\python.exe -u scripts\gate_shards.py --shards 6", "gate"),
    ("a vitest worker — the load a gate actually applies",
     "node.exe", r"C:\Program Files\nodejs\node.exe C:/repo/app/node_modules/vitest/vitest.mjs run", "vitest"),
    # ── and the three that must answer None ──
    ("⛔ THE DECOY: pytest running the gate's own TEST file",
     "python.exe", r"C:\Python314\python.exe -m pytest tests/test_gate_shards.py -q", None),
    ("⛔ THE DECOY, Windows-spelled",
     "python.exe", r"C:\Python314\python.exe -m pytest tests\test_gate_shards.py -q", None),
    ("⛔ THE SELF-MATCH: a shell whose command line merely mentions the gate",
     "bash.exe", r'"C:\Program Files\Git\bin\bash.exe" -c "grep gate_shards.py scripts/*"', None),
    ("⛔ THE SELF-MATCH: powershell querying for gate_shards",
     "powershell.exe", r"powershell -NoProfile -Command Get-CimInstance ... 'gate_shards' ...", None),
    ("a node process that is not vitest",
     "node.exe", r"C:\Program Files\nodejs\node.exe server.js", None),
    # ⛔ THE NARROWING, RAILED FROM BOTH SIDES. A scoped pytest run is real load and this matcher
    # must still call it None, or every other workstream's CONTENDED verdict changes meaning.
    ("a scoped pytest run — LOAD, but not this verdict's contention",
     "python.exe", r"C:\Python314\python.exe -m pytest tests/test_publish_caption.py", None),
]

# ⛔ THE WIDER QUESTION, WITH ITS OWN CONTROLS. Captured from this box at 2026-09-15 20:26, the
# moment `gate_box_lock status` said FREE with fifteen live processes on it.
LOAD_CONTROL_CASES = [
    # (label, name, command_line, expected)
    ("the six-shard gate that held the lock",
     "python.exe", r"C:\Python314\python.exe scripts/gate_shards.py --shards 6", "gate"),
    ("a vitest shard runner, another worktree",
     "node.exe", r'"node" "C:\Users\Patrick\uct-worktrees\notebook-k\app\node_modules\.bin\..\vitest\vitest.mjs" run --shard=5/6', "vitest"),
    ("⭐ THE ONE THE LOCK COULD NOT SEE: a scoped pytest run from another session",
     "python.exe", r"C:\Python314\python.exe -m pytest tests/test_publish_caption.py tests/test_publishers.py", "pytest"),
    ("the same, Windows-spelled",
     "python.exe", r"C:\Python314\python.exe -m pytest tests\test_publishers.py", "pytest"),
    ("a pytest launched by its own console script",
     "pytest.exe", r"C:\Python314\Scripts\pytest.exe tests/test_gate_box_lock.py -q", "pytest"),
    ("⛔ THE DECOY IS STILL A PYTEST RUN — not a gate, but unmistakably load",
     "python.exe", r"C:\Python314\python.exe -m pytest tests/test_gate_shards.py -q", "pytest"),
    # ── and the ones that must answer None ──
    ("⛔ a python process that merely PRINTS the word",
     "python.exe", r"""C:\Python314\python.exe -c "print('pytest')" """, None),
    ("⛔ a shell grepping for pytest — counting the searcher",
     "bash.exe", r'"C:\Program Files\Git\bin\bash.exe" -c "grep -rn pytest tools/"', None),
    ("⛔ an ordinary python job that is not a test run",
     "python.exe", r"C:\Python314\python.exe docs/pine/wip/rig/boot_rig.py", None),
    ("⛔ a node process that is not vitest",
     "node.exe", r'"node" "C:\Users\Patrick\AppData\Roaming\npm\node_modules\@railway\cli\bin\railway.js" deployment list', None),
]


def _raise_probe():
    """A snapshot that fails, for the self-check's UNREADABLE control."""
    raise RuntimeError("the process snapshot failed (drill)")


def self_check() -> int:
    """Prove the matcher DISCRIMINATES, and prove the verdict can return each of its answers.

    ⛔ A probe nobody has watched get it wrong is not a probe. Every case below that expects a hit
    is paired with one that expects a miss on nearly the same string.
    """
    ok = True
    say("matcher controls")
    for label, name, cl, expected in CONTROL_CASES:
        got = classify_process(name, cl, pid=999, self_pids=frozenset())
        good = got == expected
        ok &= good
        say(f"  {'ok  ' if good else 'FAIL'} {str(expected):<7} <- {label}")
        if not good:
            say(f"        got {got!r} for {cl[:90]!r}")

    say("\nload-matcher controls — the WIDER question the lock needed")
    for label, name, cl, expected in LOAD_CONTROL_CASES:
        got = classify_load(name, cl, pid=999, self_pids=frozenset())
        good = got == expected
        ok &= good
        say(f"  {'ok  ' if good else 'FAIL'} {str(expected):<7} <- {label}")
        if not good:
            say(f"        got {got!r} for {cl[:90]!r}")

    say("\n  own pid is never a finding")
    got = classify_process("python.exe", "python scripts/gate_shards.py", pid=42,
                           self_pids=frozenset({42}))
    ok &= got is None
    say(f"  {'ok  ' if got is None else 'FAIL'} None    <- the sampler's own process")

    say("\n  box_load — every state must be reachable, and a failure must not read as zero")
    _busy_snap = {"free_kb": 8 * 1024 * 1024, "total_kb": 32 * 1024 * 1024, "procs": [
        {"ProcessId": 501, "ParentProcessId": 1, "Name": "python.exe", "mb": 40,
         "cl": "python -m pytest tests/test_publishers.py"},
    ]}
    _busy = box_load(snapshot=lambda: _busy_snap)
    check_pairs = [
        ("a marked process is seen", _busy["state"] == LOAD_BUSY and _busy["total"] == 1),
        ("⭐ CONTROL: an empty box is QUIET, not BUSY",
         box_load(snapshot=lambda: {"free_kb": 1, "total_kb": 2, "procs": []})["state"] == LOAD_QUIET),
        ("⛔ a FAILED probe is UNREADABLE and carries NO count",
         (lambda r: r["state"] == LOAD_UNREADABLE and r["total"] is None and r["error"])(
             box_load(snapshot=_raise_probe))),
        ("⛔ 'nobody looked' is its own state too",
         load_not_probed("drill")["state"] == LOAD_NOT_PROBED),
        ("our own tree is not foreign load",
         box_load(exclude_tree=501, snapshot=lambda: _busy_snap)["total"] == 0),
    ]
    for label, cond in check_pairs:
        ok &= bool(cond)
        say(f"  {'ok  ' if cond else 'FAIL'} {label}")

    say("\nverdict controls — each answer must be reachable")
    clean = [{"at": "t1", "free_gb": 11.8, "total_gb": 31.8, "foreign": []},
             {"at": "t2", "free_gb": 11.2, "total_gb": 31.8, "foreign": []}]
    busy = [clean[0],
            {"at": "t2", "free_gb": 9.0, "total_gb": 31.8,
             "foreign": [{"kind": "gate", "pid": 30756, "name": "python.exe", "rss_mb": 24,
                          "command_line": "python -u scripts/gate_shards.py --shards 6"}]}]
    lowmem = [clean[0], {"at": "t2", "free_gb": 4.31, "total_gb": 31.8, "foreign": []}]
    unobs = [clean[0], {"at": "t2", "free_gb": None, "total_gb": None, "foreign": [],
                        "snapshot_failed": "the process snapshot returned unparseable JSON"}]
    for label, samples, expected in (
        ("a quiet interval", clean, EXIT_CLEAR),
        ("a gate appearing mid-interval", busy, EXIT_CONTENDED),
        ("free memory through the floor", lowmem, EXIT_RESOURCE),
        ("a snapshot that could not be taken", unobs, EXIT_UNOBSERVED),
        ("nobody looked", [], EXIT_NO_SAMPLES),
        ("one lonely sample is still nobody looking", clean[:1], EXIT_NO_SAMPLES),
    ):
        v = verdict(samples)
        good = v["code"] == expected
        ok &= good
        say(f"  {'ok  ' if good else 'FAIL'} {VERDICT_NAMES.get(expected):<24} <- {label}")

    # ⛔ AND CONTENTION MUST OUTRANK RESOURCE: a low-memory reading taken while somebody else's
    # gate was running is a fact about THEIR run, so naming it RESOURCE blames the wrong thing.
    both = [busy[1], lowmem[1]]
    good = verdict(both)["code"] == EXIT_CONTENDED
    ok &= good
    say(f"  {'ok  ' if good else 'FAIL'} contention outranks resource when both are true")

    # ⛔ AND A SEEN INTRUDER OUTRANKS AN UNSEEN INSTANT. A positive finding that names a pid is
    # worth more than the residual "we could not look"; reporting UNOBSERVED here would bury the
    # one fact an operator can act on.
    good = verdict([busy[1], unobs[1]])["code"] == EXIT_CONTENDED
    ok &= good
    say(f"  {'ok  ' if good else 'FAIL'} contention outranks an unobserved sample")
    # ⭐ CONTROL: with the intruder removed, the SAME unobserved sample decides the verdict --
    # so the line above is about precedence, not about UNOBSERVED being unreachable.
    good = verdict([clean[0], unobs[1]])["code"] == EXIT_UNOBSERVED
    ok &= good
    say(f"  {'ok  ' if good else 'FAIL'} ...and decides it once the intruder is gone")

    # ⛔ AND THE INTERVAL JUSTIFICATION MUST STILL HOLD.
    bound = min(MEASURED_SHARD_SECONDS) / 10
    good = SAMPLE_SECONDS <= bound
    ok &= good
    say(f"\n  {'ok  ' if good else 'FAIL'} interval {SAMPLE_SECONDS}s <= shortest measured shard"
          f" {min(MEASURED_SHARD_SECONDS)}s / 10 = {bound:.1f}s")

    say("\nself-check: " + ("PASS" if ok else "FAIL"))
    return 0 if ok else EXIT_SELF_CHECK_FAILED


# ── Driving it ────────────────────────────────────────────────────────────────────────────────

def _pid_alive(pid: int, snap_procs: list[dict]) -> bool:
    return any(p["ProcessId"] == pid for p in snap_procs)


def watch(*, seconds: float | None = None, pid: int | None = None,
          interval: float = SAMPLE_SECONDS, trail: pathlib.Path | None = None) -> dict:
    """Sample until the interval elapses, the watched pid exits, or the memory floor is reached.

    ⛔ IT STOPS CLEANLY ON THE FLOOR rather than running to the end and reporting afterwards — the
    owner ruling is to stop, and a sampler that keeps sampling while the box drowns is adding to
    the problem it is measuring.
    """
    self_pids = _self_pids()
    samples: list[dict] = []
    started = time.monotonic()
    fh = trail.open("a", encoding="utf-8") if trail else None
    try:
        while True:
            try:
                s = take_sample(self_pids, tree_pid=pid)
            except RuntimeError as e:
                # ⛔⛔ RECORDED, NOT MERELY REPORTED — and that is the hole being closed.
                # Printing it and moving on made the failed instant VANISH from the sample set,
                # and the surviving samples then produced a CLEAR verdict for an interval nobody
                # had fully observed. ⭐ The marker carries no free_gb and no foreign list
                # precisely because NOTHING WAS OBSERVED; inventing either would be the
                # fabrication this tool refuses everywhere else.
                say(f"  [sample failed] {e}", err=True)
                s = {"at": _dt.datetime.now().isoformat(timespec="seconds"),
                     "free_gb": None, "total_gb": None, "foreign": [],
                     "snapshot_failed": str(e)[:300]}
            if s is not None:
                samples.append(s)
                if fh:
                    fh.write(json.dumps(s) + "\n")
                    fh.flush()
                if s.get("snapshot_failed"):
                    # ⚠️ No free-memory read and no floor check: there is no reading to check.
                    say(f"  {s['at']}  UNOBSERVED — the snapshot could not be taken")
                else:
                    foreign = ", ".join(f"{f['kind']}:{f['pid']}" for f in s["foreign"]) or "-"
                    say(f"  {s['at']}  free={s['free_gb']:>5} GB  foreign={foreign}")
                    if s["free_gb"] <= FREE_MEMORY_FLOOR_GB:
                        say(f"  ⛔ free memory {s['free_gb']} GB is at or below the "
                            f"{FREE_MEMORY_FLOOR_GB} GB floor — stopping cleanly.")
                        break
            if pid is not None:
                try:
                    if not _pid_alive(pid, _snapshot().get("procs", [])):
                        break
                except RuntimeError:
                    pass
            if seconds is not None and (time.monotonic() - started) >= seconds:
                break
            time.sleep(interval)
    except KeyboardInterrupt:
        say("  (interrupted — reporting on the samples actually taken)", err=True)
    finally:
        if fh:
            fh.close()
    return verdict(samples)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--check", action="store_true",
                   help="take MIN_SAMPLES samples back to back and report (a pre-flight)")
    g.add_argument("--watch", type=float, metavar="SECONDS",
                   help="sample for this many seconds")
    g.add_argument("--watch-pid", type=int, metavar="PID",
                   help="sample while that process is alive")
    g.add_argument("--self-check", action="store_true",
                   help="prove the matcher and the verdict can each return the other answer")
    ap.add_argument("--interval", type=float, default=SAMPLE_SECONDS,
                    help=f"seconds between samples (default {SAMPLE_SECONDS}, "
                         f"derived from the shortest measured shard)")
    ap.add_argument("--trail", metavar="PATH",
                    help="append every sample to this JSONL file")
    args = ap.parse_args(argv)

    if args.self_check:
        return self_check()

    trail = pathlib.Path(args.trail) if args.trail else None
    if args.check:
        v = watch(seconds=args.interval * (MIN_SAMPLES - 1) + 0.1,
                  interval=args.interval if args.interval < 5 else 2.0, trail=trail)
    elif args.watch is not None:
        v = watch(seconds=args.watch, interval=args.interval, trail=trail)
    else:
        v = watch(pid=args.watch_pid, interval=args.interval, trail=trail)

    say()
    say(f"  {v['why']}")
    if v["code"] == EXIT_CONTENDED:
        for row in v.get("intruders") or []:
            say(f"    pid {row['pid']:<7} {row['kind']:<7} seen in {row['samples_seen']} "
                  f"sample(s), {row['first_seen']} .. {row.get('last_seen')}")
            say(f"      {row['command_line']}")
    say(verdict_line(v))
    return v["code"]


if __name__ == "__main__":
    raise SystemExit(main())
