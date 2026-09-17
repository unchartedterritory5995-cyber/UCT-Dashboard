"""Build the promotion record that `deploy-gate-state/last-promotion.json` carries.

WHY THIS EXISTS (SD-1.3 C2.1). Two different readers need facts the CI log holds and
neither can get them:

  1. The gate's compensating control needs to know which SHA was last PROMOTED, so it
     can tell a promotion from somebody pushing to `production` by hand.
  2. A human needs to know what the advisory range scan said. Session 14 could not read
     it: `gh` is not installed on the operator's box and the Actions log needs a token,
     so the six states the scan can report were invisible from outside CI.

The record is written to an ORPHAN branch, which is the only placement that is all
three of anonymously readable, loop-free, and harmless to `production`'s ancestry —
the reasoning is in that branch's README.

⛔ A LOG THAT COULD NOT BE READ RECORDS `null`, NEVER A VERDICT. "We could not see it"
and "it was clean" are different facts, and collapsing them would let a permanently
broken log-read masquerade as twenty clean runs — the exact vacuity the INCONCLUSIVE
state was invented to prevent one layer down.

Parsing lives here rather than in YAML so it can be tested. A regex buried in a
workflow is only ever exercised in production.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys

# The scan prints `range-scan: <STATE>` for the non-executing states and
# `range-scan: EXECUTED ... verdict=<V>` when it really compared something.
STATE_RE = re.compile(r"range-scan: ([A-Z][A-Z -]*[A-Z])")
VERDICT_RE = re.compile(r"verdict=([A-Z][A-Z-]*)")

KNOWN_STATES = {"NO RANGE", "INCONCLUSIVE", "NOTHING AHEAD", "EXECUTED"}
KNOWN_VERDICTS = {"CLEAN", "FINDING", "NOTHING-TO-SCAN"}


def parse_range_scan(log_text: str) -> tuple[str | None, str | None]:
    """(state, verdict) from a gate log, or (None, None) when it cannot be read.

    ⛔⛔ THE LOG CONTAINS THE STEP'S OWN SCRIPT, NOT ONLY ITS OUTPUT. GitHub echoes
    each `run:` body into the log, so every one of the six state strings appears as a
    LITERAL in every run, in source order, whatever actually happened. The first
    version of this parser took the first match of each pattern and duly recorded
    `state="NO RANGE"` with `verdict="NOTHING-TO-SCAN"` — a combination the scan
    cannot produce, because NO RANGE never reaches a verdict. It was reading the call
    site instead of the wire, one layer up.

    So: lines carrying `echo` are the script and are skipped; only what the step
    PRINTED is parsed. The impossible-combination check below is the backstop — if
    these two ever disagree again, the record says unknown rather than something
    plausible and wrong.

    Only labels the scan can emit are accepted. An unrecognised token is reported as
    None rather than passed through: a record is read by a control that gates
    promotion, so an unknown value must never look like a known-good one.
    """
    if not log_text or not log_text.strip():
        return None, None
    lines = [ln for ln in log_text.splitlines() if "echo" not in ln]
    body = "\n".join(lines)
    states = [s for s in STATE_RE.findall(body) if s in KNOWN_STATES]
    verdicts = [v for v in VERDICT_RE.findall(body) if v in KNOWN_VERDICTS]
    state = states[0] if states else None
    verdict = verdicts[0] if verdicts else None
    # A verdict only exists for a run that EXECUTED. Anything else is a misparse.
    if verdict is not None and state != "EXECUTED":
        return (state, None) if state else (None, None)
    return state, verdict


def build(promoted_sha: str, master_sha: str, gate_run_id: str | None,
          log_text: str, now: dt.datetime | None = None) -> dict:
    state, verdict = parse_range_scan(log_text)
    ts = (now or dt.datetime.now(dt.timezone.utc)).astimezone(dt.timezone.utc)
    rec = {
        "promoted_sha": promoted_sha,
        "master_sha": master_sha,
        "gate_run_id": gate_run_id or None,
        "range_scan_state": state,
        "range_scan_verdict": verdict,
        "ts": ts.isoformat().replace("+00:00", "Z"),
    }
    if state is None:
        rec["range_scan_note"] = ("the gate log could not be read or carried no "
                                  "range-scan line; recorded as unknown, never as clean")
    return rec


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    # ⛔ NOT `required=True`: that makes `--self-check` impossible to run on its own,
    # and a self-check you cannot invoke is not a self-check.
    ap.add_argument("--promoted-sha")
    ap.add_argument("--master-sha")
    ap.add_argument("--gate-run-id", default=None)
    ap.add_argument("--log-file", default=None,
                    help="gate run log; omit to read stdin")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)
    if a.self_check:
        return self_check()
    if not a.promoted_sha or not a.master_sha:
        ap.error("--promoted-sha and --master-sha are required unless --self-check")
    if a.log_file:
        try:
            with open(a.log_file, encoding="utf-8", errors="replace") as fh:
                log = fh.read()
        except OSError:
            log = ""
    else:
        log = sys.stdin.read() if not sys.stdin.isatty() else ""
    print(json.dumps(build(a.promoted_sha, a.master_sha, a.gate_run_id, log), indent=2))
    return 0


def self_check() -> int:
    """Prove the parser can both find a state and refuse a bogus one."""
    ok = True
    cases = [
        ("range-scan: EXECUTED  commits=1  files=3\nrange-scan: verdict=CLEAN",
         ("EXECUTED", "CLEAN")),
        ("range-scan: INCONCLUSIVE — base deadbeef is not reachable", ("INCONCLUSIVE", None)),
        ("range-scan: NO RANGE (github.event.before is empty)", ("NO RANGE", None)),
        ("range-scan: NOTHING AHEAD — HEAD is already contained", ("NOTHING AHEAD", None)),
        ("range-scan: EXECUTED  files=0  verdict=NOTHING-TO-SCAN", ("EXECUTED", "NOTHING-TO-SCAN")),
        ("range-scan: EXECUTED\nrange-scan: verdict=FINDING rc=1", ("EXECUTED", "FINDING")),
        ("", (None, None)),
        ("nothing relevant here at all", (None, None)),
        # A label the scan cannot emit must NOT be passed through.
        ("range-scan: TOTALLY MADE UP\nverdict=WONDERFUL", (None, None)),
        # ⛔ THE REGRESSION CASE, shaped like a real `gh run view --log`: the echoed
        # SCRIPT appears above the output and mentions every state. Parsing it
        # produced ("NO RANGE", "NOTHING-TO-SCAN") in production on 2026-09-16 —
        # a pair the scan cannot emit.
        ("gate\tSecret scan over the whole range\t2026-09-16T01:07:01.0Z   "
         "echo \"range-scan: NO RANGE (github.event.before is empty) — nothing compared\"\n"
         "gate\tSecret scan over the whole range\t2026-09-16T01:07:01.1Z   "
         "echo \"range-scan: INCONCLUSIVE — base $BASE is not reachable\"\n"
         "gate\tSecret scan over the whole range\t2026-09-16T01:07:01.2Z   "
         "echo \"range-scan: EXECUTED  commits=$COMMITS  files=0  verdict=NOTHING-TO-SCAN\"\n"
         "gate\tSecret scan over the whole range\t2026-09-16T01:07:01.3Z   "
         "echo \"range-scan: verdict=CLEAN\"\n"
         "gate\tSecret scan over the whole range\t2026-09-16T01:07:44.0Z range-scan: base=origin/production head=4c3c2cc82\n"
         "gate\tSecret scan over the whole range\t2026-09-16T01:07:44.1Z range-scan: EXECUTED  commits=1  files=10\n"
         "gate\tSecret scan over the whole range\t2026-09-16T01:07:45.0Z range-scan: verdict=CLEAN\n",
         ("EXECUTED", "CLEAN")),
        # An impossible pair must collapse to the state alone, never a plausible lie.
        ("range-scan: NO RANGE\nrange-scan: verdict=CLEAN", ("NO RANGE", None)),
    ]
    for text, want in cases:
        got = parse_range_scan(text)
        if got != want:
            print(f"FAIL {text[:40]!r}: got {got}, want {want}")
            ok = False
    rec = build("a" * 40, "b" * 40, "123", "")
    if rec["range_scan_state"] is not None or "range_scan_note" not in rec:
        print("FAIL: an unreadable log must record null AND say so")
        ok = False
    print("self-check:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
