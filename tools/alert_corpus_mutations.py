#!/usr/bin/env python3
"""Mutation gauntlet for the extended alert corpus and the rails that run it.

⭐ THE VERDICT IS THE EXIT CODE OF A REAL PYTEST RUN, never a parsed word. A
harness that decides "killed" by reading prose can be fooled by prose; this reads
`returncode` and treats the summary line only as EVIDENCE for the report.

The three mutations are aimed at the load-bearing half of what this task built:

  M1  the anti-silent-skip rail is deleted -> a fixture frozen into the corpus and
      never recorded is accepted by `--check`. **A corpus that can quietly not run
      is worse than no corpus**, so this is the mutation the brief demanded.
  M2  `--record --append`'s "already recorded" refusal is deleted -> the append
      path can re-record an EXISTING fixture, which is exactly how a frozen digest
      moves without anybody deciding it should.
  M3  one number inside a NEW fixture's bars is nudged -> the digest pin must
      refuse to load it. This proves the seven added series are pinned the same
      way the original four are, rather than merely sitting in the same file.

⛔ FOUR TRAPS THAT HAVE FIRED FOR REAL ON THIS BRANCH, EACH HANDLED HERE:
  * **CRLF makes a multi-line `\\n` anchor match ZERO.** Every patch reads and
    writes BYTES and every anchor is matched against the bytes on disk; an anchor
    that matches zero times ABORTS LOUDLY rather than being reported as a kill.
    (Six tasks hit this; one harness correctly aborted instead of reporting
    no-ops as kills, and that is the behaviour copied here.)
  * **cp1252 killed a harness's own stdout mid-run and LEFT A MUTATION APPLIED.**
    Every printed line is ASCII-sanitised, and the restore is in a `finally` with
    a sha256 equality afterwards.
  * **`passed=None` is AMBIGUOUS** between "the filter selected nothing" (abort)
    and "everything selected failed" (a good kill). It is disambiguated with the
    collected count, taken from the same run.
  * **an exit code has been lost through a pipe here.** Nothing is piped;
    `subprocess.run` returns the code directly.
"""

from __future__ import annotations

import hashlib
import os
import re
import subprocess
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(_HERE, ".."))

TEST_FILE = "tests/test_alert_replay.py"
REPLAY = os.path.join(ROOT, "tools", "alert_replay.py")
BARS = os.path.join(ROOT, "tests", "fixtures", "alerts", "replay_bars.json")
FIRE_LOG = os.path.join(ROOT, "tests", "fixtures", "alerts", "fire_log_forming.json")

# 🔴 RESTORE WHAT THE MUTATION COULD HAVE WRITTEN, NOT ONLY WHAT IT WAS APPLIED
# TO — AND THIS FIRED FOR REAL ON THE FIRST RUN OF THIS FILE.
#
# M2 deletes `--record --append`'s "already recorded" refusal. The test that
# refusal exists for then calls `cmd_record_append` FOR REAL, so the mutated run
# replayed `wick_that_unwinds` and WROTE a second `appended` entry into the
# committed fire log, bumping `summary.fires` by 13,921. The gauntlet restored
# `tools/alert_replay.py` byte-for-byte, reported 3/3 KILLED, exited 0 — and left
# a corrupted artifact behind. Nothing in the run was wrong except its idea of
# what needed restoring. (The frozen digests survived, because the append path's
# own byte-identity guard held; that is luck about which guard was mutated, not a
# property of the harness.)
#
# So every artifact any mutation can reach is snapshotted before and restored
# after, with a sha256 equality — the same shape as
# [[lesson_teardown_must_undo_what_setup_created]], one step further out.
GUARDED = (REPLAY, BARS, FIRE_LOG)

_ANSI = re.compile(rb"\x1b\[[0-9;]*m")


def _say(text: str) -> None:
    """cp1252 cannot encode most of this project's punctuation. ASCII only."""
    sys.stdout.write(text.encode("ascii", "replace").decode("ascii") + "\n")
    sys.stdout.flush()


def _sha(path: str) -> str:
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def _pytest(args: list[str], why: bool = False) -> tuple[int, int, int, list[str]]:
    """`(returncode, passed, collected, reasons)` from ONE real run. Nothing is piped.

    ⭐ `reasons` IS THE POINT OF `why=True`. An exit code says a mutation was
    killed; it does not say WHETHER IT WAS KILLED FOR THE RIGHT REASON. A gauntlet
    that never looks can be satisfied by an import error, a fixture teardown, or
    the same catch-all assertion firing three times — which is how "three kills"
    can mean "one rail".
    """
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    cmd = [sys.executable, "-m", "pytest", *args, "-q", "-p", "no:cacheprovider"]
    if why:
        cmd += ["--tb=line"]
    proc = subprocess.run(cmd, cwd=ROOT, capture_output=True, env=env)
    out = _ANSI.sub(b"", proc.stdout + proc.stderr).decode("utf-8", "replace")
    passed = -1
    m = re.search(r"(\d+) passed", out)
    if m:
        passed = int(m.group(1))
    counts = re.findall(r"(\d+) (?:passed|failed|errors?)", out)
    collected = sum(int(n) for n in counts) if counts else -1
    if "no tests ran" in out or "collected 0 items" in out:
        collected = 0
    reasons = []
    if why:
        for line in out.splitlines():
            s = line.strip()
            if s.startswith("E ") or "Error: " in s or s.startswith("assert "):
                reasons.append(s)
            elif re.match(r"^[A-Za-z]:[\\/].*:\d+: ", s):
                reasons.append(s.split(": ", 1)[-1])
    return proc.returncode, passed, collected, reasons[:6]


def _patch_bytes(path: str, anchor: bytes, replacement: bytes) -> bytes:
    """Apply exactly one substitution, in BYTES, or abort naming the anchor."""
    raw = open(path, "rb").read()
    n = raw.count(anchor)
    if n != 1:
        crlf = raw.count(b"\r\n")
        raise SystemExit(
            f"ABORT: the anchor matched {n} times in {path} (file has {crlf} CRLF "
            "line endings). A no-op reported as a kill is worse than no harness. "
            f"anchor={anchor[:90]!r}")
    patched = raw.replace(anchor, replacement)
    if patched == raw:
        raise SystemExit(f"ABORT: the replacement is a NO-OP in {path}")
    open(path, "wb").write(patched)
    return raw


MUTATIONS = [
    {
        "id": "M1",
        "path": REPLAY,
        "what": "delete the anti-silent-skip rail: --check accepts a corpus "
                "fixture that has NO fire-log block",
        "anchor": b"    if unrecorded or orphaned:",
        "replace": b"    if False:",
        "expect": ["tests/test_alert_replay.py::test_check_refuses_a_corpus_"
                   "fixture_absent_from_the_fire_log",
                   "tests/test_alert_replay.py::test_check_refuses_a_fire_log_"
                   "block_whose_bars_are_gone",
                   "tests/test_alert_replay.py::test_check_cannot_be_dodged_with_only"],
    },
    {
        "id": "M2",
        "path": REPLAY,
        "what": "delete --record --append's 'already recorded' refusal: the "
                "append path can re-record an EXISTING fixture and move a frozen "
                "digest",
        "anchor": b"        if name in log[\"fixtures\"]:",
        "replace": b"        if False:",
        "expect": ["tests/test_alert_replay.py::test_record_append_refuses_a_"
                   "fixture_it_has_already_recorded"],
        # ⚠️ THIS MUTATION WRITES. With the refusal gone the test's call really
        # re-records and really rewrites the fire log — which is the whole point
        # of the mutation, and the reason GUARDED exists.
        "writes": (FIRE_LOG,),
    },
    {
        "id": "M3",
        "path": BARS,
        "what": "nudge ONE close inside the halfday_30m fixture - the 13:00 "
                "closing-auction bar of the 2025-11-28 half day - so the digest "
                "pin must refuse to load a corpus entry that drifted",
        # ⚠️ THE ANCHOR IS THE WHOLE BAR, NOT `"c": 683.39,`, WHICH MATCHES THREE
        # TIMES IN THIS FILE. A three-match anchor would have patched a bar in
        # some other fixture and the kill would have been about the wrong series.
        # The `\r\n` is literal: this repo is CRLF and a `\n` anchor matches zero.
        "anchor": (b'"t": 1764352800,\r\n     "o": 683.4,\r\n     "h": 683.47,'
                   b'\r\n     "l": 683.39,\r\n     "c": 683.39,'),
        "replace": (b'"t": 1764352800,\r\n     "o": 683.4,\r\n     "h": 683.47,'
                    b'\r\n     "l": 683.39,\r\n     "c": 683.3900001,'),
        "expect": ["tests/test_alert_replay.py::test_every_frozen_fixture_"
                   "digests_to_its_recorded_sha256",
                   "tests/test_alert_replay.py::test_the_halfday_fixture_carries_"
                   "a_13_00_close_and_a_holiday_hole"],
    },
]


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="ascii", errors="replace")
        except Exception:                                        # noqa: BLE001
            pass

    _say("=" * 72)
    _say("CONTROL A - the UNMUTATED tree must be green, and must not be EMPTY")
    rc, passed, collected, _reasons = _pytest([TEST_FILE])
    _say(f"  rc={rc} passed={passed} collected={collected}")
    if rc != 0:
        _say("ABORT: the baseline is not green; every 'kill' below would be noise.")
        return 2
    if passed <= 0:
        _say("ABORT: CONTROL A selected NOTHING. A gauntlet whose baseline runs "
             "zero tests reports every mutation as killed.")
        return 2
    baseline = passed

    _say("")
    _say("CONTROL B - the FILTERED selection each mutation is judged by must "
         "itself be green and NON-EMPTY")
    for mut in MUTATIONS:
        rc, passed, collected, _reasons = _pytest(mut["expect"])
        _say(f"  {mut['id']}: rc={rc} passed={passed} collected={collected}")
        if collected <= 0:
            _say(f"ABORT: {mut['id']}'s selection collected NOTHING - the node ids "
                 "are wrong and the mutation would 'kill' an empty run.")
            return 2
        if rc != 0 or passed <= 0:
            _say(f"ABORT: {mut['id']}'s selection is not green before mutating.")
            return 2

    results = []
    for mut in MUTATIONS:
        _say("")
        _say("-" * 72)
        _say(f"{mut['id']}: {mut['what']}")
        snapshot = {p: open(p, "rb").read() for p in GUARDED}
        before_sha = _sha(mut["path"])
        original = None
        try:
            original = _patch_bytes(mut["path"], mut["anchor"], mut["replace"])
            after_sha = _sha(mut["path"])
            if after_sha == before_sha:
                _say("ABORT: the file's sha256 did not change - the mutation did "
                     "not apply.")
                return 2
            _say(f"  applied: {before_sha[:12]} -> {after_sha[:12]}")
            rc, passed, collected, reasons = _pytest(mut["expect"], why=True)
            # `passed=None`/-1 is AMBIGUOUS on its own: it means either "the
            # filter selected nothing" (abort) or "everything selected failed"
            # (a good kill). `collected` from the same run disambiguates it.
            if collected <= 0:
                _say("ABORT: the mutated run collected NOTHING.")
                return 2
            verdict = "KILLED" if rc != 0 else "SURVIVED"
            _say(f"  rc={rc} passed={passed} collected={collected} -> {verdict}")
            for line in reasons:
                _say(f"      why: {line[:150]}")
            results.append((mut["id"], verdict, rc, passed, collected, reasons))
        finally:
            # every guarded artifact, not just the patched one — see GUARDED
            for path, blob in snapshot.items():
                if open(path, "rb").read() != blob:
                    open(path, "wb").write(blob)
        restored = _sha(mut["path"])
        _say(f"  restored: {restored[:12]} == {before_sha[:12]} -> "
             f"{restored == before_sha}")
        touched = [os.path.basename(p) for p in GUARDED
                   if hashlib.sha256(snapshot[p]).hexdigest() != _sha(p)]
        if restored != before_sha or touched:
            _say(f"ABORT: not restored byte-identically: {touched or mut['path']}")
            return 2
        wrote = [os.path.basename(p) for p in GUARDED
                 if p != mut["path"] and mut.get("writes") and p in mut["writes"]]
        if wrote:
            _say(f"  (the mutated run also WROTE {wrote}; restored from snapshot)")

    _say("")
    _say("=" * 72)
    for rid, verdict, rc, passed, collected, reasons in results:
        _say(f"  {rid}: {verdict}  (rc={rc} passed={passed} collected={collected})")
        _say(f"       killed by: "
             f"{reasons[0][:130] if reasons else '(no reason captured)'}")
    # ⛔ THE REFUSAL MESSAGES MUST BE DISJOINT. Task 9 measured that two gates
    # sharing a phrase let a `pytest.raises(match=...)` pass with the safety
    # DELETED, so "three kills" is only three facts if the three reasons differ.
    firsts = [r[5][0] if r[5] else "" for r in results]
    if len(set(firsts)) != len(firsts):
        _say("ABORT: two mutations were killed by the SAME message - that is one "
             "rail wearing three names, not three rails.")
        return 2
    survivors = [r for r in results if r[1] != "KILLED"]
    _say(f"  baseline: {baseline} passed on the unmutated tree")
    _say(f"  {len(results) - len(survivors)}/{len(results)} KILLED")
    return 1 if survivors else 0


if __name__ == "__main__":
    sys.exit(main())
