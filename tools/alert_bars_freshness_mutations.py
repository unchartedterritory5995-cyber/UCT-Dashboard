#!/usr/bin/env python3
"""Mutation harness for the alert-bars freshness lane.

A test suite is a claim about what CANNOT happen. This file breaks the module on
purpose, five ways, and demands the suite go red each time. A mutation that
SURVIVES is a rail that does not exist.

WHY IT IS BUILT THE WAY IT IS -- every one of these bit somebody on this branch:

  * TWO CONTROLS, and both can abort the run.
      A: the unmutated FULL file must be green with a NON-ZERO test count.
         "0 collected" exits 0 and reads exactly like a pass.
      B: per mutation, the unmutated run FILTERED to the killer must be green
         with a NON-ZERO test count. A `-k` filter that matches nothing exits 0
         with "N deselected" -- a green exit over zero work.
  * VERDICTS COME FROM THE EXIT CODE plus junit XML, never from scraping stdout.
    A bare `(\\d+) passed` regex once read its number out of the failing test's
    own docstring. pytest exit 4 is a USAGE error that prints "no tests ran",
    which reads like a pass; no XML is written, so it is INCONCLUSIVE here.
  * PROOF THE MUTATION APPLIED: the anchor must be present exactly once, and the
    bytes on disk must differ afterwards. A "survivor" that was never applied is
    a lie in the safe direction.
  * THE FILE RESTORED IS THE FILE THAT WAS PATCHED, byte-for-byte, verified by
    sha256 in a `finally`. A sibling harness once restored a different file and
    left a mutation applied; another died mid-run on cp1252 and did the same.
  * ASCII-only source and UTF-8 stdout, for that same reason.
  * LINE-ENDING AGNOSTIC: this repo has core.autocrlf=true, so the same file is
    LF in git and CRLF after a checkout. Every anchor is tried both ways.

Usage:
    python tools/alert_bars_freshness_mutations.py
"""
from __future__ import annotations

import hashlib
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULE = ROOT / "api" / "services" / "alert_bars_freshness.py"
TESTS = "tests/test_alert_bars_freshness.py"

_ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


# ─── mutations ───────────────────────────────────────────────────────────────
# (name, what it breaks, anchor, replacement)

MUTATIONS = [
    (
        "M1_silent_no_op",
        "The refresh fetches and then never WRITES. Every summary still says "
        "'refreshed'; the store gains nothing.",
        "        rows = _sqlite.put_bars(sym_up, tf, new, date_tf=(tf in DATE_TFS))",
        "        rows = len(new)  # MUTANT: never writes",
    ),
    (
        "M2_whole_universe",
        "The armed set is sourced from the BAR STORE instead of "
        "list_active() -- the sweep becomes every (ticker, tf) on the box.",
        "        from api.services import indicator_alert_service as _ias\n"
        "        alerts = _ias.list_active()",
        "        from api.services import bars_sqlite as _sq  # MUTANT\n"
        "        alerts = [{'sym': t, 'tf': f} for t, f in _sq.get_all_tickers()]",
    ),
    (
        "M3_cap_removed",
        "The per-sweep group cap is dropped, so an armed set of any size "
        "becomes a sweep of that size.",
        "    selected = [(r[\"sym\"], r[\"tf\"]) for r in ordered[:max(0, cap)]]",
        "    selected = [(r[\"sym\"], r[\"tf\"]) for r in ordered]  # MUTANT",
    ),
    (
        "M4_empty_stamps_success",
        "An EMPTY fetch stamps the success clock, converting an upstream "
        "cooldown into 'this group is up to date' for a whole interval.",
        "        status = \"error\" if last_err else \"empty\"\n"
        "        return {\"sym\": sym_up, \"tf\": tf, \"status\": status, \"rows\": 0,",
        "        status = \"error\" if last_err else \"empty\"\n"
        "        _mark_ok(key)  # MUTANT\n"
        "        return {\"sym\": sym_up, \"tf\": tf, \"status\": status, \"rows\": 0,",
    ),
    (
        "M5_no_retry_through_a_cooldown",
        "The per-attempt guard around the fetch is removed, so the first blip "
        "ends the group instead of being retried through.",
        "        if new:\n"
        "            break\n"
        "        if i + 1 < max(1, n_attempts) and wait_s > 0:\n"
        "            time.sleep(wait_s)",
        "        break  # MUTANT: never retries",
    ),
    (
        "M6_inflight_guard_removed",
        "Two callers arriving at the same instant BOTH fetch the same group. "
        "The sequential success gate cannot see them; only the in-flight guard "
        "can.",
        "    if not owned:\n"
        "        waiter.wait(timeout=INFLIGHT_WAIT_SECONDS)\n"
        "        return {\"sym\": sym_up, \"tf\": tf, \"status\": \"skipped-inflight\", \"rows\": 0}",
        "    if not owned:\n"
        "        pass  # MUTANT: the loser fetches too",
    ),
    (
        "M7_inflight_marker_leaks",
        "The in-flight marker is never cleared, so one fetch turns the group "
        "permanently un-refreshable -- strictly worse than the staleness this "
        "module exists to fix.",
        "        with _STATE_LOCK:\n"
        "            if _INFLIGHT.get(key) is waiter:\n"
        "                del _INFLIGHT[key]\n"
        "        waiter.set()",
        "        pass  # MUTANT: leaks the marker",
    ),
]

# The test each mutation is EXPECTED to be caught by. Used only for control B --
# the actual killer set is measured, not assumed.
EXPECTED_KILLER = {
    "M1_silent_no_op": "test_refresh_adds_new_bars_by_identity_and_the_staleness_is_gone",
    "M2_whole_universe": "test_refresh_never_reaches_beyond_the_armed_set",
    "M3_cap_removed": "test_max_groups_caps_the_sweep_and_serves_the_stalest_first",
    "M4_empty_stamps_success":
        "test_an_empty_fetch_is_not_cached_as_a_value_and_the_group_is_retried",
    "M5_no_retry_through_a_cooldown":
        "test_upstream_down_leaves_the_store_intact_and_alerts_still_evaluate",
    "M6_inflight_guard_removed":
        "test_two_simultaneous_callers_make_exactly_one_upstream_call",
    "M7_inflight_marker_leaks":
        "test_the_inflight_marker_is_released_even_when_the_fetch_raises",
}


# ─── running pytest, and believing only the machine-readable part ────────────

def run_pytest(k: str | None = None) -> dict:
    """Return {'exit', 'tests', 'failures', 'errors', 'skipped', 'failed_names'}.

    `tests` is None when no XML was produced at all -- which is what pytest exit
    4 (USAGE ERROR, prints "no tests ran") looks like from out here. A caller
    that treats that as a pass has invented a green.
    """
    fd, xml_path = tempfile.mkstemp(suffix=".xml")
    os.close(fd)
    os.unlink(xml_path)
    cmd = [sys.executable, "-m", "pytest", TESTS, "-q", "--no-header",
           "-p", "no:cacheprovider", f"--junitxml={xml_path}"]
    if k:
        cmd += ["-k", k]
    env = dict(os.environ)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    proc = subprocess.run(cmd, cwd=str(ROOT), env=env,
                          capture_output=True, text=True, errors="replace")
    out = {"exit": proc.returncode, "tests": None, "failures": 0, "errors": 0,
           "skipped": 0, "failed_names": [], "stdout": _ANSI.sub("", proc.stdout)}
    if not os.path.exists(xml_path):
        return out
    try:
        root = ET.parse(xml_path).getroot()
        suite = root if root.tag == "testsuite" else root.find("testsuite")
        out["tests"] = int(suite.get("tests", 0))
        out["failures"] = int(suite.get("failures", 0))
        out["errors"] = int(suite.get("errors", 0))
        out["skipped"] = int(suite.get("skipped", 0))
        for case in suite.iter("testcase"):
            if case.find("failure") is not None or case.find("error") is not None:
                out["failed_names"].append(case.get("name"))
    finally:
        try:
            os.unlink(xml_path)
        except OSError:
            pass
    return out


def passed_count(r: dict) -> int | None:
    if r["tests"] is None:
        return None
    return r["tests"] - r["failures"] - r["errors"] - r["skipped"]


def find_anchor(data: bytes, text: str) -> bytes | None:
    """The anchor, in whichever line ending this checkout happens to have."""
    for form in (text.replace("\r\n", "\n"),
                 text.replace("\r\n", "\n").replace("\n", "\r\n")):
        b = form.encode("utf-8")
        if data.count(b) == 1:
            return b
        if data.count(b) > 1:
            raise SystemExit(f"ABORT: anchor is not unique ({data.count(b)}x)")
    return None


def main() -> int:
    original = MODULE.read_bytes()
    original_sha = hashlib.sha256(original).hexdigest()
    print(f"module: {MODULE.relative_to(ROOT)}  sha256={original_sha[:16]}")
    print(f"tests : {TESTS}\n")

    # ── CONTROL A: unmutated, FULL file ─────────────────────────────────────
    print("=== CONTROL A -- unmutated, full file ===")
    a = run_pytest()
    ap = passed_count(a)
    print(f"  exit={a['exit']} collected={a['tests']} passed={ap} "
          f"failures={a['failures']} errors={a['errors']}")
    if a["tests"] is None:
        print("  ABORT: no junit XML -- pytest usage error (exit 4 prints "
              "'no tests ran', which reads exactly like a pass).")
        return 2
    if a["tests"] == 0:
        print("  ABORT: ZERO tests collected. A green exit over no work is not "
              "a control.")
        return 2
    if a["exit"] != 0 or a["failures"] or a["errors"]:
        print("  ABORT: the control is not green. Every verdict below would be "
              f"meaningless. failed: {a['failed_names']}")
        return 2
    print("  CONTROL A OK\n")

    results = []
    try:
        for name, why, old, new in MUTATIONS:
            print(f"=== {name} ===")
            print(f"  breaks: {why}")

            killer = EXPECTED_KILLER[name]

            # ── CONTROL B: unmutated, FILTERED to the expected killer ───────
            b = run_pytest(k=killer)
            bp = passed_count(b)
            print(f"  CONTROL B (unmutated, -k {killer}): exit={b['exit']} "
                  f"collected={b['tests']} passed={bp}")
            if b["tests"] is None or b["tests"] == 0 or not bp:
                print("  ABORT: the filter selected NOTHING (a -k that matches "
                      "nothing exits 0 with 'N deselected'), or nothing passed. "
                      "`passed=None` is ambiguous; collected>0 is what "
                      "disambiguates it.")
                return 2
            if b["exit"] != 0 or b["failures"] or b["errors"]:
                print("  ABORT: control B is not green.")
                return 2

            # ── APPLY, and prove it applied ────────────────────────────────
            data = MODULE.read_bytes()
            anchor = find_anchor(data, old)
            if anchor is None:
                print(f"  ABORT: anchor not found for {name}. The module moved "
                      "under the harness; a 'survivor' here would be a mutation "
                      "that was never applied.")
                return 2
            crlf = b"\r\n" in anchor
            repl = new.replace("\r\n", "\n")
            if crlf:
                repl = repl.replace("\n", "\r\n")
            mutated = data.replace(anchor, repl.encode("utf-8"), 1)
            if mutated == data:
                print("  ABORT: replacement was a no-op.")
                return 2
            MODULE.write_bytes(mutated)
            on_disk = hashlib.sha256(MODULE.read_bytes()).hexdigest()
            if on_disk == original_sha:
                print("  ABORT: the file on disk is unchanged after writing.")
                return 2
            print(f"  applied: sha256 {original_sha[:12]} -> {on_disk[:12]}")

            # ── the mutated FULL run: who catches it, and is it alone? ──────
            m = run_pytest()
            mp = passed_count(m)
            print(f"  MUTATED (full): exit={m['exit']} collected={m['tests']} "
                  f"passed={mp} failures={m['failures']} errors={m['errors']}")

            if m["tests"] is None:
                verdict = "INCONCLUSIVE (no XML -- usage error, not a pass)"
            elif m["exit"] == 0:
                verdict = "SURVIVED"
            elif (m["failures"] + m["errors"]) > 0:
                verdict = "KILLED"
            else:
                verdict = "INCONCLUSIVE (non-zero exit, no failing test)"

            killers = sorted(m["failed_names"])
            unique = len(killers) == 1
            print(f"  VERDICT: {verdict}")
            print(f"  killed by ({len(killers)}): {', '.join(killers) or '-'}")
            if verdict == "KILLED":
                print(f"  unique killer: {'YES' if unique else 'NO -- substitute: ' + killers[0]}")
                if killer not in killers:
                    print(f"  NOTE: the EXPECTED killer ({killer}) did NOT fire; "
                          "the kill came from elsewhere.")
            print()

            results.append({"name": name, "verdict": verdict,
                            "killers": killers, "unique": unique})

            # restore before the next mutation
            MODULE.write_bytes(original)
    finally:
        # ⛔ NO `return` IN HERE. A return inside `finally` swallows whatever
        # exception was on its way out, which would hide the very abort this
        # block exists to survive. Record the outcome, decide after.
        MODULE.write_bytes(original)
        restored_sha = hashlib.sha256(MODULE.read_bytes()).hexdigest()
        print(f"restored: sha256={restored_sha[:16]} "
              f"{'MATCHES ORIGINAL' if restored_sha == original_sha else 'MISMATCH!!'}")

    if restored_sha != original_sha:
        print("!! THE MODULE WAS LEFT MUTATED. Fix before doing anything else.")
        return 3

    print("\n=== SUMMARY ===")
    killed = sum(1 for r in results if r["verdict"] == "KILLED")
    for r in results:
        u = "unique" if r["unique"] else f"{len(r['killers'])} killers"
        print(f"  {r['name']:<34} {r['verdict']:<12} ({u})")
    print(f"\n  {killed}/{len(results)} killed")
    return 0 if killed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
