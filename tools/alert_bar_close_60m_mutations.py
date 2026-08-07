#!/usr/bin/env python3
"""Mutation gauntlet for the 60-minute bar-close grid fix.

STOP -- WHAT THIS FILE IS FOR
-----------------------------
`bar_close_epoch` used to answer `t + 3600` for every hourly bar, which made an
alert on the 09:00 or the 09:30 bucket fire THIRTY MINUTES LATE. The fix derives
the boundary from `bars_fetch.bucket_60_et_unix_seconds`. This file asks whether
the tests that now pass would actually NOTICE the fix being undone -- because
1,378,980 green corpus fires did not notice the defect in the first place
(`tools/alert_replay.py --repaint` derives its clock FROM `bar_close_epoch`, so
an error there cancels out of every replay number).

Two mutations are MANDATORY and named by the brief:
  M1  the close reverts to the nominal timeframe   -> must be KILLED
  M2  a bar is declared closed EARLY               -> must be KILLED

HOW A VERDICT IS REACHED, AND EVERY TRAP IT IS WRITTEN AROUND
------------------------------------------------------------
* The verdict is the pytest EXIT CODE, never a scraped number. Exit 0 with the
  mutation applied = SURVIVED. Exit 5 ("no tests ran") and exit 4 (USAGE error,
  which prints text that reads exactly like a pass) are ABORTS, not kills.
* CONTROL A runs the whole selection UNMUTATED and ABORTS ON ZERO PASSED -- a
  green run over no work is the oldest vacuous gate there is.
* CONTROL B runs each mutation's own `-k` selection BEFORE mutating and requires
  a NONZERO passed count. A `-k` filter that matches nothing exits 0 with
  "N deselected", which reads exactly like a pass.
* `passed` is parsed from the summary line; when it cannot be read it is -1 and
  DISAMBIGUATED by a separate `--collect-only` run, so "no number" can never be
  confused with "zero work".
* Every anchor is BYTES and must match EXACTLY ONCE. This repo is CRLF and a
  multi-line `\n` anchor matches zero times here -- seven tasks on this branch
  hit that, and the harnesses that ABORTED loudly are the ones that did not
  report no-ops as kills.
* Output is ASCII-only and stdout is reconfigured, because cp1252 once killed a
  sibling harness mid-run and LEFT A MUTATION APPLIED.
* GUARDED lists every artifact a mutation can reach, not merely the file that is
  patched -- a sibling gauntlet once restored the file it patched and never
  looked at the file the mutation WROTE, reporting 3/3 KILLED over a corrupted
  fire log. Each is sha256'd before and restored byte-for-byte in a `finally`.
* Two mutations killed by the same message are ONE RAIL WEARING TWO NAMES; the
  run fails if the killing test sets are not distinct.
"""
from __future__ import annotations

import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import hashlib  # noqa: E402
import os  # noqa: E402
import pathlib  # noqa: E402
import re  # noqa: E402
import subprocess  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
TARGET = ROOT / "api" / "services" / "indicator_alert_evaluator.py"

#: Every file a mutation in this gauntlet could reach, patched or written.
GUARDED = [
    TARGET,
    ROOT / "tests" / "test_alert_bar_close_60m_grid.py",
    ROOT / "tests" / "test_alert_replay.py",
    ROOT / "tests" / "fixtures" / "alerts" / "replay_bars.json",
    ROOT / "tests" / "fixtures" / "alerts" / "fire_log_forming.json",
    ROOT / "tests" / "fixtures" / "alerts" / "fire_diff_declared.json",
]

SELECTION = [
    "tests/test_alert_bar_close_60m_grid.py",
    "tests/test_alert_replay.py::test_bar_close_epoch_lands_on_the_next_bar_start_in_the_60m_open_buckets",
]

MUTATIONS = [
    {
        "id": "M1",
        "why": "MANDATED -- the close reverts to the nominal timeframe (t + 3600)",
        "anchor": b"        if code == _HOURLY_TF:\r\n",
        "replace": b"        if False and code == _HOURLY_TF:\r\n",
        "select": SELECTION,
        "k": "judgeable or next_bar_start or rsi_cross or shorter_than_an_hour",
    },
    {
        "id": "M2",
        "why": "MANDATED -- a bar is declared closed EARLY (15 minutes early)",
        "anchor": b"    close_at = float(hi)\r\n",
        "replace": b"    close_at = float(hi) - 900\r\n",
        "select": SELECTION,
        "k": "writer_still_routes or bucket_start_the_writer_recognises",
    },
    {
        "id": "M3",
        "why": ("the off-grid guard is deleted -- a `t` that is NOT a bucket start "
                "gets its containing bucket's close, which is EARLIER than nominal"),
        "anchor": b"        if bucket != key:\r\n",
        "replace": b"        if False and bucket != key:\r\n",
        "select": SELECTION,
        "k": "off_grid",
    },
    {
        "id": "M4",
        "why": ("the DST bound is narrowed to one hour -- the fall-back 01:00 bucket "
                "is really 7200 s and falls back to a nominal close an hour EARLY"),
        "anchor": b"_HOURLY_MAX_BUCKET_SECONDS = 2 * 3600\r\n",
        "replace": b"_HOURLY_MAX_BUCKET_SECONDS = 3600\r\n",
        "select": SELECTION,
        "k": "dst_fall_back",
    },
]

_ANSI = re.compile(rb"\x1b\[[0-9;]*m")
_PASSED = re.compile(r"(?:^|[\s,])(\d+) passed")
_FAILED = re.compile(r"(?:^|[\s,])(\d+) failed")
# ⛔ pytest prints "1/15 tests collected (14 deselected)" under `-k`, so an
# anchored `(\d+) tests collected` reads NOTHING and the disambiguation that is
# supposed to tell "everything failed" from "nothing ran" answers -1 to both.
# The SELECTED count is the one that matters here (the left of the slash).
_COLLECTED = re.compile(r"(?:^|[\s,])(\d+)(?:/\d+)? (?:tests? )?collected")
_FAILED_LINE = re.compile(r"^FAILED (\S+)", re.M)


def sha(p: pathlib.Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def ascii_only(s: str) -> str:
    return s.encode("ascii", "replace").decode("ascii")


def run_pytest(select, k=None, collect_only=False):
    """Returns (returncode, ansi-stripped text). Exit code is read DIRECTLY."""
    cmd = [sys.executable, "-m", "pytest", "-q", "--no-header", "-p", "no:randomly",
           "-rf", *select]
    if k:
        cmd += ["-k", k]
    if collect_only:
        cmd += ["--collect-only"]
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    proc = subprocess.run(cmd, cwd=ROOT, capture_output=True, env=env)
    text = _ANSI.sub(b"", proc.stdout + proc.stderr).decode("utf-8", "replace")
    return proc.returncode, text


def counts(text):
    """(passed, collected) with -1 for 'no number in the output'."""
    p = _PASSED.findall(text)
    c = _COLLECTED.findall(text)
    return (int(p[-1]) if p else -1), (int(c[-1]) if c else -1)


def failed_count(text):
    f = _FAILED.findall(text)
    return int(f[-1]) if f else -1


def failing_tests(text):
    return sorted(set(_FAILED_LINE.findall(text)))


def abort(msg):
    print("\nABORT: " + ascii_only(msg))
    raise SystemExit(2)


def main() -> int:
    snapshot = {p: p.read_bytes() for p in GUARDED}
    digests = {p: sha(p) for p in GUARDED}
    for p in GUARDED:
        print(f"  GUARDED {p.relative_to(ROOT)}  {digests[p][:16]}...")

    # ---- CONTROL A: the whole selection, UNMUTATED. Aborts on zero. --------
    rc, text = run_pytest(SELECTION)
    passed, collected = counts(text)
    if rc == 4:
        abort("pytest exit 4 is a USAGE error -- 'no tests ran' is not a pass")
    if rc != 0:
        abort(f"CONTROL A is not green on the unmutated tree (rc={rc})\n{text[-3000:]}")
    if passed <= 0:
        _, ctext = run_pytest(SELECTION, collect_only=True)
        _, ccol = counts(ctext)
        abort(f"CONTROL A passed={passed} collected={ccol} -- a green run over "
              f"zero work is not a control")
    print(f"\nCONTROL A (unmutated, whole selection): rc={rc} passed={passed}")

    results = []
    try:
        for mut in MUTATIONS:
            # ---- CONTROL B: this mutation's own selection, BEFORE mutating --
            rc_b, text_b = run_pytest(mut["select"], k=mut["k"])
            p_b, c_b = counts(text_b)
            if rc_b == 4:
                abort(f"{mut['id']}: CONTROL B hit pytest usage error 4")
            if rc_b == 5:
                abort(f"{mut['id']}: CONTROL B selected NOTHING (exit 5) -- the "
                      f"-k filter {mut['k']!r} matches no test")
            if p_b <= 0:
                _, ctext = run_pytest(mut["select"], k=mut["k"], collect_only=True)
                _, ccol = counts(ctext)
                if ccol <= 0:
                    abort(f"{mut['id']}: CONTROL B collected {ccol} -- a -k filter "
                          f"matching nothing exits 0 with 'N deselected'")
                abort(f"{mut['id']}: CONTROL B passed={p_b} collected={ccol}")
            if rc_b != 0:
                abort(f"{mut['id']}: CONTROL B is RED before the mutation\n{text_b[-2000:]}")
            print(f"\n{mut['id']} CONTROL B: rc={rc_b} passed={p_b} "
                  f"(selection {mut['k']!r})")

            # ---- apply, byte-exactly, exactly once -------------------------
            blob = TARGET.read_bytes()
            hits = blob.count(mut["anchor"])
            if hits != 1:
                crlf = b"\r\n" in blob
                abort(f"{mut['id']}: anchor matched {hits} times (need exactly 1). "
                      f"file is {'CRLF' if crlf else 'LF'}; anchor="
                      f"{mut['anchor']!r}")
            TARGET.write_bytes(blob.replace(mut["anchor"], mut["replace"]))
            if TARGET.read_bytes() == snapshot[TARGET]:
                abort(f"{mut['id']}: the mutation did NOT change the file")

            rc_m, text_m = run_pytest(mut["select"], k=mut["k"])
            p_m, c_m = counts(text_m)
            f_m = failed_count(text_m)
            if p_m <= 0:
                # `passed=-1` is AMBIGUOUS -- "everything selected failed" and
                # "nothing ran" print the same absence. Disambiguate against a
                # separate collect-only run, and refuse a kill claimed over zero.
                _, ctext = run_pytest(mut["select"], k=mut["k"], collect_only=True)
                _, c_m = counts(ctext)
                if c_m <= 0:
                    abort(f"{mut['id']}: passed={p_m} and collected={c_m} under "
                          f"mutation -- cannot tell a kill from an empty run")
            fails = failing_tests(text_m)
            if rc_m == 4:
                abort(f"{mut['id']}: pytest usage error 4 under mutation")
            if rc_m == 5:
                abort(f"{mut['id']}: exit 5 under mutation -- nothing ran")
            if rc_m != 0 and f_m <= 0 and not fails:
                abort(f"{mut['id']}: nonzero rc with no failing test named -- "
                      f"that is a crash, not a kill")
            verdict = "KILLED" if rc_m != 0 else "SURVIVED"
            print(f"{mut['id']} MUTATED : rc={rc_m} passed={p_m} failed={f_m} "
                  f"collected={c_m} -> {verdict}")
            for f in fails:
                print(f"      killer: {ascii_only(f)}")
            results.append({"id": mut["id"], "why": mut["why"], "rc": rc_m,
                            "verdict": verdict, "killers": fails,
                            "passed": p_m, "collected": c_m})

            # ---- restore EVERY guarded artifact, verified ------------------
            for p in GUARDED:
                p.write_bytes(snapshot[p])
            for p in GUARDED:
                if sha(p) != digests[p]:
                    abort(f"{mut['id']}: {p} did not restore byte-identically")
    finally:
        for p in GUARDED:
            p.write_bytes(snapshot[p])

    print("\n" + "=" * 72)
    ok = True
    for r in results:
        print(f"  {r['id']}  {r['verdict']:9} rc={r['rc']}  {ascii_only(r['why'])}")
        if r["verdict"] != "KILLED":
            ok = False
    seen = {}
    for r in results:
        key = tuple(r["killers"])
        if key and key in seen:
            print(f"\n  !! {r['id']} and {seen[key]} are killed by the SAME tests "
                  f"{list(key)} -- one rail wearing two names")
            ok = False
        seen[key] = r["id"]
    for p in GUARDED:
        if sha(p) != digests[p]:
            print(f"  !! {p} was NOT restored")
            ok = False
    print(f"\n  {sum(1 for r in results if r['verdict'] == 'KILLED')}/{len(results)} "
          f"KILLED   artifacts restored: "
          f"{all(sha(p) == digests[p] for p in GUARDED)}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
