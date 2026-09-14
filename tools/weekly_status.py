"""F-L2-1 - give the weekly run an exit code that means something.

WHY: `claude -p` exits 0 having successfully written a report ABOUT REFUSING TO
PROCEED. Task Scheduler then records Last Result 0, so a run that stopped at the first
environment check is indistinguishable from a run that did the work. Measured
2026-09-13: the first dry run stopped at section 1, reached nobody, and recorded
`exit=0`.

THE CONTRACT. The prompt MUST print, as the LAST line of its report, exactly one of:

    STATUS: RAN
    STATUS: STOPPED-ENV
    STATUS: STOPPED-NOTHING-READY
    STATUS: STOPPED-ERROR

This reads the report, takes the LAST such line, and returns the matching exit code.

    RAN                     0   did the work
    STOPPED-NOTHING-READY   0   nothing qualified; a successful run (prompt section 4)
    STOPPED-ENV             3   an environment check failed; nothing was attempted
    STOPPED-ERROR           4   it tried and something broke
    <no STATUS line>        5   THE SILENT-FAILURE CASE

EXIT 5 IS THE WHOLE POINT. A report with no status line is what a crashed, truncated,
killed or permission-starved run leaves behind, and it is exactly the shape that used
to read as success. It is never 0. The same applies to an unrecognised token: a status
this tool does not know is not a status it may treat as fine.

Deliberately NOT tolerant of a missing file or an empty one - both are exit 5. An
absent report is not a quiet success.
"""
from __future__ import annotations

import argparse
import io
import re
import sys

#: status -> process exit code. 0 ONLY for the two outcomes that are genuinely fine.
EXIT = {
    "RAN": 0,
    "STOPPED-NOTHING-READY": 0,
    "STOPPED-ENV": 3,
    "STOPPED-ERROR": 4,
}
NO_STATUS = 5

#: Tolerant of the decoration a model reaches for (**bold**, `code`, trailing period)
#: but never of the token itself. The status is data; its dressing is not.
_LINE = re.compile(r"^[\s>*_`#-]*STATUS\s*:\s*([A-Za-z-]+)[\s*_`.]*$")


def find_status(text: str) -> str | None:
    """Return the LAST declared status token, or None."""
    found = None
    for line in text.splitlines():
        m = _LINE.match(line.strip())
        if m:
            found = m.group(1).strip().upper()
    return found


def decide(text: str) -> tuple[int, str, str]:
    """(exit code, status token or 'NO-STATUS', one-line human reason)."""
    s = find_status(text)
    if s is None:
        return (NO_STATUS, "NO-STATUS",
                "the report carried no STATUS line - treated as a SILENT FAILURE, never success")
    if s not in EXIT:
        return (NO_STATUS, s,
                "unrecognised status %r - not treated as success" % s)
    reason = {
        "RAN": "the run did work",
        "STOPPED-NOTHING-READY": "nothing was eligible; that is a successful run",
        "STOPPED-ENV": "an environment check failed; nothing was attempted",
        "STOPPED-ERROR": "the run tried and something broke",
    }[s]
    return EXIT[s], s, reason


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--log", required=False, help="path to the report/log to read")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args([] if (argv is None and "pytest" in sys.modules) else argv)

    if a.self_check:
        return _self_check()
    if not a.log:
        print("NO-STATUS")
        print("no --log given", file=sys.stderr)
        return NO_STATUS
    try:
        text = io.open(a.log, encoding="utf-8", errors="replace").read()
    except OSError as e:
        print("NO-STATUS")
        print("cannot read %s: %s" % (a.log, e), file=sys.stderr)
        return NO_STATUS
    code, status, reason = decide(text)
    print(status)                      # stdout: the token, for the runner to capture
    print(reason, file=sys.stderr)
    return code


def _self_check() -> int:
    """A check nobody has seen fail is not a check."""
    cases = [
        ("STATUS: RAN", 0, "RAN"),
        ("STATUS: STOPPED-NOTHING-READY", 0, "STOPPED-NOTHING-READY"),
        ("STATUS: STOPPED-ENV", 3, "STOPPED-ENV"),
        ("STATUS: STOPPED-ERROR", 4, "STOPPED-ERROR"),
        ("a report that just stops", NO_STATUS, "NO-STATUS"),
        ("", NO_STATUS, "NO-STATUS"),
        ("STATUS: FINE", NO_STATUS, "FINE"),
    ]
    ok = True
    for text, want_code, want_status in cases:
        code, status, _ = decide(text)
        good = (code == want_code and status == want_status)
        ok &= good
        print("  %-34s -> %s %-22s %s" % (repr(text)[:34], code, status,
                                          "ok" if good else "WRONG"))
    print("SELF-CHECK: %s" % ("PASS" if ok else "FAIL"))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
