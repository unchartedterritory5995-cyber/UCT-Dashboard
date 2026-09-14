#!/usr/bin/env python
"""Did a deploy hurt anyone? Count HTTP statuses by **structured field**, never by substring.

    # 1. pull the window (the existing puller; it owns the network and the paging)
    python tools/railway_env_logs.py --filter '"HTTP"' \
        --since 2026-09-14T19:45:00Z --until 2026-09-14T20:05:00Z \
        --out /tmp/blip.jsonl --control-filter '"[buzz]"' --control-at 2026-09-14T19:11:56Z

    # 2. read it
    python tools/deploy_blip_check.py --logs /tmp/blip.jsonl \
        --since 2026-09-14T19:45:00Z --until 2026-09-14T20:05:00Z

    python tools/deploy_blip_check.py --self-check     # proves it can fail

⚰️⚰️ **WHY THIS EXISTS — "NO 502s FOUND" WAS NEVER A MEASUREMENT.** On 2026-09-14,
to check whether an early master push had harmed anyone, the deploy-window logs
were filtered on the string `502`. It returned **18 hits, and every one of them was
a MILLISECOND FIELD in a timestamp**:

    2026-09-14 19:41:44,502 INFO api.main: [buzz] 1216816863313657886: 2 message(s)
                       ^^^ this is 502 milliseconds, not a status code

So the filter could not have seen a real 502 even if one had occurred: a status
code and a millisecond are both three digits, and a substring search cannot tell
them apart. **The conclusion "no 502s" was a statement about the instrument, not
about the deploy** — the instrument was incapable of returning the other answer,
which is the one property a measurement must never have.

⭐ **THE FIX IS NOT A BETTER REGEX FOR `502`. It is to stop reading numbers out of
prose.** A status code lives in a FIELD — `httpStatus` on a Railway `httpLogs` row,
or a named field inside an application log line (`HTTP 502`, `status=502`,
`status_code=502`). This instrument reads those fields and nothing else. A bare
three-digit run is never a status here, wherever it appears.

⛔ **AND `-> 502` IS DELIBERATELY NOT A FIELD.** `-> %s` appears 18 times in
`api/**` and most of them are prose arrows (`"warm-on-miss %s -> %s"`, a symbol
mapping). Accepting it would re-commit the original defect in a narrower costume:
matching a number that is not a status.

──────────────────────────────────────────────────────────────────────────────
THREE-VALUED, AND THE THIRD VALUE IS THE POINT
──────────────────────────────────────────────────────────────────────────────

  CLEAN         — the window carried status-bearing lines, and none of them were 5xx.
  HARM FOUND    — at least one 5xx in the window.
  INCONCLUSIVE  — nothing was measured. No lines in the window; or lines but not one
                  of them carried a status field; or the pull that produced the file
                  reported itself a FLOOR rather than exact.

⛔ **AN EMPTY RESULT IS A FAILED INVOCATION UNTIL PROVEN OTHERWISE.** "We found no
5xx" and "we could not see a 5xx" are different facts, and collapsing them into
CLEAN is precisely how this check's predecessor produced a confident wrong answer.
CLEAN therefore REQUIRES a non-vacuity control to have passed: at least one line in
the window whose status this parser could actually read.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

CLEAN, HARM, INCONCLUSIVE = "CLEAN", "HARM FOUND", "INCONCLUSIVE"
EXIT_CODE = {CLEAN: 0, HARM: 1, INCONCLUSIVE: 2}

#: A status at or above this is harm to a member. 4xx is a refusal we chose;
#: 5xx is the service failing, which is what a mid-swap restart produces.
HARM_FLOOR = 500

#: Structured row fields that ARE a status. Railway's `httpLogs` rows carry
#: `httpStatus` as an integer — that is the honest reading and it is tried first.
#: ⛔ `status` is NOT in this list: Railway's DEPLOYMENT rows use `status` for
#: "SUCCESS"/"BUILDING", and a parser that read that field would answer confidently
#: about the wrong thing.
STATUS_FIELDS = ("httpStatus", "http_status", "status_code")

#: Named-field forms inside a log MESSAGE. Every one requires a field NAME or the
#: literal `HTTP` immediately before the digits — that requirement is the entire
#: defence against the millisecond bug, so do not relax it into a bare `\d{3}`.
#: These three shapes are DERIVED from what `api/**` actually logs, not invented:
#: `HTTP %s` (19 sites), `HTTP {r.status_code}` (10), `status={...}` (6),
#: `status=%s` (3) — measured 2026-09-14.
#:
#: ⛔ THERE IS NO SEPARATE "STRIP THE TIMESTAMP" STEP, DELIBERATELY. The field name
#: (or the literal `HTTP` plus whitespace) is the ONLY thing standing between this
#: parser and the millisecond bug, and it is sufficient: `,502` is preceded by a
#: comma, which none of these forms permit. A second, redundant defence would be a
#: guard nobody could ever watch fire — and one such guard, written first, broke
#: the real `"httpStatus":503` case because a JSON colon looks like a clock's.
_MESSAGE_PATTERNS = (
    # uvicorn/access: ... "GET /api/health HTTP/1.1" 502
    re.compile(r'HTTP/\d(?:\.\d)?"?\s+(\d{3})(?!\d)'),
    # app logs: log.warning("[buzz] render HTTP %s: %s", r.status_code, ...)
    re.compile(r'\bHTTP\s+(\d{3})(?!\d)'),
    # app logs / JSON: status=502 · status_code=502 · "httpStatus": 502
    re.compile(r'\b(?:http_?status|status_code|status)"?\s*[=:]\s*"?(\d{3})(?!\d)',
               re.IGNORECASE),
)


def status_in_message(message: str) -> "int | None":
    """The status a log line carries in a NAMED FIELD, or None.

    ⛔⛔ THE CONTROL THIS FUNCTION EXISTS FOR: `"2026-09-14 19:41:44,502 INFO ..."`
    must return None. It is a timestamp's millisecond field, not a status, and the
    only reason the old check "found 18 of them" is that it never asked which."""
    if not message:
        return None
    for pat in _MESSAGE_PATTERNS:
        m = pat.search(message)
        if m:
            n = int(m.group(1))
            if 100 <= n <= 599:
                return n
    return None


def status_of(row: dict) -> "int | None":
    """The HTTP status of one log row, from its own field. None = this row does not
    carry a status, which is a perfectly ordinary thing for a log line and is NOT
    evidence of anything."""
    for field in STATUS_FIELDS:
        if field in row and row[field] is not None:
            try:
                n = int(row[field])
            except (TypeError, ValueError):
                return None
            return n if 100 <= n <= 599 else None
    return status_in_message(row.get("message") or "")


def _klass(status: int) -> str:
    return "%dxx" % (status // 100)


def in_window(ts: str, since: "str | None", until: "str | None") -> bool:
    """ISO-8601 Zulu strings compare correctly as text when they share a format,
    which every Railway timestamp does. A row with no timestamp is IN the window —
    excluding it would silently shrink the population being judged."""
    if not ts:
        return True
    if since and ts < since:
        return False
    if until and ts > until:
        return False
    return True


def load(paths) -> tuple[list[dict], dict]:
    """Rows plus the pull's own metadata.

    `tools/railway_env_logs.py` writes a `_meta` first line saying whether its pull
    was EXACT or a FLOOR. ⛔ Reading it is not optional: a FLOOR that found no 5xx
    cannot say there were none, and a checker that ignored the line would launder a
    floor into a clean bill of health."""
    rows: list[dict] = []
    meta = {"exact": True, "files": 0, "meta_lines": 0}
    for p in paths:
        meta["files"] += 1
        with open(p, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                if isinstance(d, dict) and "_meta" in d:
                    meta["meta_lines"] += 1
                    if d["_meta"].get("exact") is False:
                        meta["exact"] = False
                    continue
                if isinstance(d, dict):
                    rows.append(d)
    return rows, meta


def assess(rows, *, since=None, until=None, exact=True) -> dict:
    """The whole verdict, as data. Pure — no files, no network; the tests drive it."""
    windowed = [r for r in rows if in_window(r.get("timestamp") or "", since, until)]
    by_class: dict[str, int] = {}
    statuses = []
    harm_rows = []
    for r in windowed:
        s = status_of(r)
        if s is None:
            continue
        statuses.append(s)
        by_class[_klass(s)] = by_class.get(_klass(s), 0) + 1
        if s >= HARM_FLOOR:
            harm_rows.append((s, r))

    result = {
        "lines_read": len(rows),
        "in_window": len(windowed),
        "with_status": len(statuses),
        "no_status": len(windowed) - len(statuses),
        "by_class": dict(sorted(by_class.items())),
        "harm": len(harm_rows),
        "harm_rows": harm_rows,
        "exact": bool(exact),
    }

    if harm_rows:
        result["verdict"] = HARM
        result["reason"] = ("%d status-bearing line(s) in the window are >= %d."
                            % (len(harm_rows), HARM_FLOOR))
    elif not windowed:
        result["verdict"] = INCONCLUSIVE
        result["reason"] = ("no log lines fall inside the window. An empty result is a failed "
                            "invocation until proven otherwise — widen the window, check the "
                            "filter, or confirm the pull ran.")
    elif not statuses:
        result["verdict"] = INCONCLUSIVE
        result["reason"] = ("%d line(s) in the window and NOT ONE carries a status field, so no "
                            "status was measured. This is exactly the state the old substring "
                            "filter reported as 'no 502s found'." % len(windowed))
    elif not exact:
        result["verdict"] = INCONCLUSIVE
        result["reason"] = ("%d status-bearing line(s), none >= %d — but the pull that produced "
                            "this file reported itself a FLOOR, not exact, so lines are missing "
                            "and an absence here proves nothing."
                            % (len(statuses), HARM_FLOOR))
    else:
        result["verdict"] = CLEAN
        result["reason"] = ("%d status-bearing line(s) in the window, none >= %d."
                            % (len(statuses), HARM_FLOOR))
    return result


def totals_line(r: dict) -> str:
    cls = " ".join("%s=%d" % (k, v) for k, v in r["by_class"].items()) or "none"
    return ("TOTALS lines_read=%d in_window=%d with_status=%d no_status=%d "
            "by_class[%s] harm=%d exact=%s verdict=%s"
            % (r["lines_read"], r["in_window"], r["with_status"], r["no_status"],
               cls, r["harm"], r["exact"], r["verdict"]))


def report(r: dict, *, samples: int = 8, out=None) -> None:
    out = out or sys.stdout
    print("[blip] " + totals_line(r), file=out)
    print("[blip] VERDICT: %s — %s" % (r["verdict"], r["reason"]), file=out)
    for status, row in r["harm_rows"][:samples]:
        print("[blip]   %s  %s  %s" % (status, (row.get("timestamp") or "?")[:23],
                                       (row.get("path") or row.get("message") or "")[:120]),
              file=out)
    if len(r["harm_rows"]) > samples:
        print("[blip]   ... and %d more" % (len(r["harm_rows"]) - samples), file=out)


# ═════════════════════════════════════════════════════════════════════════════
# --self-check — an instrument nobody has seen fail is not an instrument
# ═════════════════════════════════════════════════════════════════════════════

def _msg(text, ts="2026-09-14T19:41:44.502000000Z"):
    return {"timestamp": ts, "message": text, "severity": "info"}


#: (name, rows, exact, expected verdict). ⛔ The first two are the MANDATORY control
#: pair: a planted 502 that must be COUNTED, and a millisecond 502 that must NOT be.
#: Without both, this check is exactly the thing it replaces.
SELF_CHECK_CASES = [
    ("a planted 502 in a named field is COUNTED",
     [_msg("2026-09-14 19:41:44,404 WARNING api.main: [buzz] render HTTP 502: Bad Gateway")],
     True, HARM),
    ("a MILLISECOND field of 502 is NOT counted",
     [_msg("2026-09-14 19:41:44,502 INFO api.main: [buzz] 1216816863313657886: 2 message(s)")],
     True, INCONCLUSIVE),
    ("a millisecond 502 beside a real 200 counts the 200, not the milliseconds",
     [_msg("2026-09-14 19:41:44,502 INFO api.main: [buzz] render HTTP 200: ok")],
     True, CLEAN),
    ("a structured httpStatus 502 is COUNTED",
     [{"timestamp": "2026-09-14T19:41:44Z", "httpStatus": 502, "path": "/api/health"}],
     True, HARM),
    ("a structured httpStatus 200 is CLEAN",
     [{"timestamp": "2026-09-14T19:41:44Z", "httpStatus": 200, "path": "/api/health"}],
     True, CLEAN),
    ("no lines at all is INCONCLUSIVE, never CLEAN",
     [], True, INCONCLUSIVE),
    ("a FLOOR pull that found no 5xx is INCONCLUSIVE, never CLEAN",
     [{"timestamp": "2026-09-14T19:41:44Z", "httpStatus": 200, "path": "/api/health"}],
     False, INCONCLUSIVE),
    ("a deployment row whose `status` is SUCCESS is not read as an HTTP status",
     [{"timestamp": "2026-09-14T19:41:44Z", "status": "SUCCESS", "message": "deployed"}],
     True, INCONCLUSIVE),
]


def self_check(out=None) -> int:
    out = out or sys.stdout
    failures = 0
    for name, rows, exact, expected in SELF_CHECK_CASES:
        r = assess(rows, exact=exact)
        ok = r["verdict"] == expected
        failures += 0 if ok else 1
        print("[self-check] %-4s %s" % ("PASS" if ok else "FAIL", name), file=out)
        print("[self-check]      %s" % totals_line(r), file=out)
        if not ok:
            print("[self-check]      expected %s, got %s" % (expected, r["verdict"]), file=out)
    print("[self-check] TOTALS cases=%d passed=%d failed=%d — %s"
          % (len(SELF_CHECK_CASES), len(SELF_CHECK_CASES) - failures, failures,
             "SELF-CHECK PASS" if not failures else "SELF-CHECK FAIL"), file=out)
    return 0 if not failures else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--logs", nargs="*", default=[],
                    help="JSONL file(s) from tools/railway_env_logs.py or "
                         "tools/discord_render_forensics.py fetch-http")
    ap.add_argument("--since", default=None, help="ISO Zulu, e.g. 2026-09-14T19:45:00Z")
    ap.add_argument("--until", default=None)
    ap.add_argument("--samples", type=int, default=8)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--self-check", action="store_true",
                    help="run the fixture suite, including the planted-502 control, and prove "
                         "this instrument can report HARM FOUND")
    # ⛔ argv is a PARAMETER and defaults to EMPTY under pytest — otherwise argparse
    # eats pytest's own flags and the test exercises argparse, not the check.
    a = ap.parse_args([] if (argv is None and "pytest" in sys.modules) else argv)

    if a.self_check:
        return self_check()

    if not a.logs:
        print("[blip] no --logs given and no --self-check. Nothing was measured; that is "
              "INCONCLUSIVE, not clean.", file=sys.stderr)
        return EXIT_CODE[INCONCLUSIVE]

    missing = [p for p in a.logs if not pathlib.Path(p).exists()]
    if missing:
        print("[blip] INCONCLUSIVE: log file(s) not found: %s" % ", ".join(missing), file=sys.stderr)
        return EXIT_CODE[INCONCLUSIVE]

    rows, meta = load(a.logs)
    r = assess(rows, since=a.since, until=a.until, exact=meta["exact"])
    if a.json:
        printable = dict(r)
        printable["harm_rows"] = [{"status": s, **row} for s, row in r["harm_rows"][: a.samples]]
        print(json.dumps(printable, indent=1, default=str))
    else:
        print("[blip] window %s .. %s over %d file(s)"
              % (a.since or "(open)", a.until or "(open)", meta["files"]))
        report(r, samples=a.samples)
    return EXIT_CODE[r["verdict"]]


if __name__ == "__main__":
    raise SystemExit(main())
