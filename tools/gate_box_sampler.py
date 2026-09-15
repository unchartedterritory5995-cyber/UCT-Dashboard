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
EXIT_SELF_CHECK_FAILED = 1

VERDICT_NAMES = {
    EXIT_CLEAR: "CLEAR",
    EXIT_CONTENDED: "INCONCLUSIVE-CONTENDED",
    EXIT_RESOURCE: "INCONCLUSIVE-RESOURCE",
    EXIT_NO_SAMPLES: "INCONCLUSIVE-NO-SAMPLES",
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


def classify_process(name: str, command_line: str, pid: int, *,
                     self_pids: frozenset[int] = frozenset()) -> str | None:
    """'gate' | 'vitest' | None — the single authority on what counts as contention.

    ⭐ PURE, AND NAMED, SO IT CAN BE SHOWN THINGS. The controls in `self_check()` hand it a real
    gate command line, the pytest decoy, and one of the shells that historically matched itself,
    and require three different answers. A matcher that is inlined into a sweep can only ever be
    tested by running the sweep, which is how both false findings survived.
    """
    if pid in self_pids:
        return None
    n = (name or "").lower()
    cl = _norm(command_line)
    if not cl:
        return None
    if n in PYTHON_NAMES:
        stripped = cl
        for decoy in DECOY_TOKENS:
            stripped = stripped.replace(decoy, "")
        if GATE_TOKEN in stripped:
            return "gate"
        return None
    if n in NODE_NAMES:
        # vitest workers are the load a gate actually applies; a gate's python parent is nearly
        # idle. Counting only the parent would call a box with six workers on it "clear".
        if "vitest" in cl:
            return "vitest"
    return None


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
    return json.loads(proc.stdout)


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
    parents = {p["ProcessId"]: p.get("ParentProcessId") for p in snap.get("procs", [])}
    pids, cur, seen = {me}, me, set()
    while cur and cur not in seen:
        seen.add(cur)
        pids.add(cur)
        cur = parents.get(cur)
    return frozenset(pids)


def take_sample(self_pids: frozenset[int]) -> dict:
    """One observation: the time, free memory, and every foreign gate/worker seen right now."""
    snap = _snapshot()
    free_gb = round(snap["free_kb"] / 1024 / 1024, 2)
    total_gb = round(snap["total_kb"] / 1024 / 1024, 2)
    foreign = []
    for p in snap.get("procs", []):
        kind = classify_process(p.get("Name", ""), p.get("cl") or "", p["ProcessId"],
                                self_pids=self_pids)
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

    intruders = [(s, f) for s in samples for f in s["foreign"]]
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
            "min_free_gb": min(s["free_gb"] for s in samples),
            "why": (f"a foreign {first['kind']} was on the box at {first_sample['at']} "
                    f"(pid {first['pid']}) — this interval cannot carry a measurement"),
        }

    min_free = min(s["free_gb"] for s in samples)
    if min_free <= floor_gb:
        return {
            "code": EXIT_RESOURCE,
            "samples": len(samples),
            "min_free_gb": min_free,
            "why": (f"free memory reached {min_free} GB, at or below the {floor_gb} GB floor — "
                    f"stop cleanly at the next shard boundary and record INCONCLUSIVE-RESOURCE"),
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
]


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

    say("\n  own pid is never a finding")
    got = classify_process("python.exe", "python scripts/gate_shards.py", pid=42,
                           self_pids=frozenset({42}))
    ok &= got is None
    say(f"  {'ok  ' if got is None else 'FAIL'} None    <- the sampler's own process")

    say("\nverdict controls — each answer must be reachable")
    clean = [{"at": "t1", "free_gb": 11.8, "total_gb": 31.8, "foreign": []},
             {"at": "t2", "free_gb": 11.2, "total_gb": 31.8, "foreign": []}]
    busy = [clean[0],
            {"at": "t2", "free_gb": 9.0, "total_gb": 31.8,
             "foreign": [{"kind": "gate", "pid": 30756, "name": "python.exe", "rss_mb": 24,
                          "command_line": "python -u scripts/gate_shards.py --shards 6"}]}]
    lowmem = [clean[0], {"at": "t2", "free_gb": 4.31, "total_gb": 31.8, "foreign": []}]
    for label, samples, expected in (
        ("a quiet interval", clean, EXIT_CLEAR),
        ("a gate appearing mid-interval", busy, EXIT_CONTENDED),
        ("free memory through the floor", lowmem, EXIT_RESOURCE),
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
                s = take_sample(self_pids)
            except RuntimeError as e:
                # ⛔ REPORTED, NOT SWALLOWED. A snapshot that failed is not a quiet box.
                say(f"  [sample failed] {e}", err=True)
                s = None
            if s is not None:
                samples.append(s)
                if fh:
                    fh.write(json.dumps(s) + "\n")
                    fh.flush()
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
