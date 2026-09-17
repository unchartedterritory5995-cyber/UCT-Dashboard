r"""OI-44 / W2b — align the DURABLE stall record against a captured `web` log slice.

⛔⛔ **THIS NAMES CANDIDATES. IT DOES NOT NAME A CAUSE, AND IT REFUSES TO PRINT ONE.**
A blocked event loop cannot log, so a stall shows up in the log as a SILENCE bounded by two
ordinary lines. That silence is consistent with every job that was running across it, and this
tool prints all of them. A single-candidate answer from this data would be a story, not a finding —
`lesson_a_comment_naming_a_mechanism_is_a_claim_about_a_run`.

⭐ **Why the alignment is worth automating at all:** the record gives `at` (when the stall was
NOTICED, i.e. its END) and `ms`, so the stall's window is `[at - ms, at]`. Matching that against
log gaps by hand is error-prone and was done by hand once already; doing it twice by hand is how
two readings of the same evidence end up disagreeing.

⚠️ **THE LOG SLICE IS AN INPUT, NOT SOMETHING THIS TOOL FETCHES.** Railway's retained window ages
out, and streaming a production log to disk is a decision for a human, not for an instrument.
Capture it yourself, filter it, and pipe it in:

    railway logs --service web | ...capture your window... | \
        python docs/discord-render/instruments/oi44_align.py --record <r31-trace.jsonl>

    python docs/discord-render/instruments/oi44_align.py --self-check

The record comes from `r31-trace.jsonl`'s newest `events` array (the durable record's own
`recent`), so the two halves of the join are the pod's own truth and the pod's own log.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
DEFAULT_RECORD = ROOT / "docs" / "discord-render" / "evidence" / "d14-monitor" / "r31-trace.jsonl"

# `2026-09-17 13:00:33,337 WARNING api.x: msg`  — the web log's own shape.
LINE_TS = re.compile(r"^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})[,.](\d{3})")
# A stall's `at` is when it was NOTICED (its end), in this shape:
REC_TS = "%Y-%m-%dT%H:%M:%SZ"


def parse_log(lines) -> list[tuple[dt.datetime, str]]:
    out = []
    for raw in lines:
        m = LINE_TS.match(raw.strip())
        if not m:
            continue
        t = dt.datetime.strptime(f"{m.group(1)} {m.group(2)}", "%Y-%m-%d %H:%M:%S")
        out.append((t.replace(tzinfo=dt.timezone.utc, microsecond=int(m.group(3)) * 1000), raw.rstrip()))
    out.sort(key=lambda r: r[0])
    return out


def newest_events(record_path: pathlib.Path) -> list[dict]:
    """The durable record's own `recent` array, from the newest trace row that has one."""
    best: list[dict] = []
    for raw in record_path.read_text(encoding="utf-8", errors="replace").splitlines():
        raw = raw.strip()
        if not raw.startswith("{"):
            continue
        try:
            d = json.loads(raw)
        except ValueError:
            continue
        ev = d.get("events")
        if isinstance(ev, list) and len(ev) >= len(best):
            best = ev
    return best


def gaps(log: list[tuple[dt.datetime, str]], min_s: float) -> list[tuple[dt.datetime, dt.datetime, float]]:
    out = []
    for (a, _), (b, _) in zip(log, log[1:]):
        d = (b - a).total_seconds()
        if d >= min_s:
            out.append((a, b, d))
    return out


def align(events: list[dict], log: list[tuple[dt.datetime, str]], *, min_gap_s: float = 1.0) -> list[dict]:
    g = gaps(log, min_gap_s)
    rows = []
    for e in events:
        try:
            end = dt.datetime.strptime(e["at"], REC_TS).replace(tzinfo=dt.timezone.utc)
        except (KeyError, ValueError):
            continue
        ms = float(e.get("ms") or 0.0)
        start = end - dt.timedelta(milliseconds=ms)
        # ⛔ OVERLAP, never containment. The record's clock and the log's clock are the same
        # process's, but the stall's END is when the WATCHER next ran — up to one sample late.
        overlapping = [x for x in g if x[1] > start and x[0] < end]
        # every line inside the stall window, plus the two lines that bound it
        inside = [ln for (t, ln) in log if start <= t <= end]
        before = [ln for (t, ln) in log if t < start][-1:]
        after = [ln for (t, ln) in log if t > end][:1]
        rows.append({"event": e, "start": start, "end": end, "ms": ms,
                     "gaps": overlapping, "inside": inside, "before": before, "after": after})
    return rows


def report(rows: list[dict], log_lines: int) -> int:
    if not rows:
        print("no events to align (empty record)", file=sys.stderr)
        return 2
    print(f"OI-44 alignment: {len(rows)} recorded stall(s) against {log_lines} timestamped log line(s)")
    print("!! THIS NAMES CANDIDATES, NEVER A CAUSE. A blocked loop cannot log, so a stall is a")
    print("   SILENCE bounded by two ordinary lines, and every job running across it is consistent")
    print("   with it. All of them are printed. One candidate is a story, not a finding.")
    unmatched = 0
    for r in rows:
        e = r["event"]
        print()
        print(f"  {e.get('at')}  {r['ms']:.1f} ms  uptime={e.get('uptime_s')}  "
              f"tier={e.get('tier')}  paged={e.get('paged')}  commit={e.get('commit')}")
        print(f"    window  {r['start'].strftime('%H:%M:%S.%f')[:-3]}Z -> {r['end'].strftime('%H:%M:%S.%f')[:-3]}Z")
        if not r["gaps"] and not r["inside"] and not r["before"]:
            unmatched += 1
            print("    NO LOG COVERAGE for this window -- the slice does not reach it. NOT a finding.")
            continue
        for a, b, d in r["gaps"]:
            print(f"    SILENCE {d:6.1f}s  {a.strftime('%H:%M:%S')}Z -> {b.strftime('%H:%M:%S')}Z")
        for ln in r["before"]:
            print(f"    before  {ln[:150]}")
        for ln in r["inside"][:6]:
            print(f"    during  {ln[:150]}")
        if len(r["inside"]) > 6:
            print(f"    during  ... {len(r['inside']) - 6} more line(s) inside the window")
        for ln in r["after"]:
            print(f"    after   {ln[:150]}")
    if unmatched:
        print()
        print(f"  !! {unmatched} event(s) had NO LOG COVERAGE. That is a gap in the SLICE, not")
        print("     evidence about the pod. An absence is evidence only if the instrument could")
        print("     have seen a presence.")
    return 0


def self_check() -> int:
    """⛔ Two controls. (1) A stall whose window the slice does not reach must be reported as
    NO LOG COVERAGE, never as 'nothing was running' — that is the absence-is-not-evidence rule.
    (2) The window must be [at - ms, at]: `at` is when the watcher NOTICED, so treating it as the
    START would look for the blocker in the wrong seconds entirely."""
    log = parse_log([
        "2026-09-17 13:00:21,627 INFO api.main: calendar-enrich-warm",
        "2026-09-17 13:00:33,337 WARNING snaptrade_client: deprecated",
    ])
    ok_parse = len(log) == 2
    ev_covered = [{"at": "2026-09-17T13:00:33Z", "ms": 10469.7, "uptime_s": 103.6, "tier": 1, "paged": True}]
    ev_outside = [{"at": "2026-09-17T09:00:00Z", "ms": 5000.0, "uptime_s": 10, "tier": 1, "paged": False}]
    a = align(ev_covered, log)[0]
    ok_gap = any(abs(d - 11.71) < 0.1 for _, _, d in a["gaps"])
    ok_window = a["start"].strftime("%H:%M:%S") == "13:00:22"     # 33.337 - 10.470 = 22.867
    b = align(ev_outside, log)[0]
    ok_absent = not b["gaps"] and not b["inside"] and not b["before"]
    print(f"self-check parse={ok_parse} gap_found={ok_gap} window_is_end_minus_ms={ok_window} "
          f"uncovered_reported_as_uncovered={ok_absent}")
    bad = sum(1 for v in (ok_parse, ok_gap, ok_window, ok_absent) if not v)
    print(f"TOTALS oi44_align --self-check {'PASS' if not bad else 'FAIL'} declared=4 failed={bad}")
    return 0 if not bad else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--record", default=str(DEFAULT_RECORD))
    ap.add_argument("--min-gap", type=float, default=1.0)
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args()
    if a.self_check:
        return self_check()
    events = newest_events(pathlib.Path(a.record))
    log = parse_log(sys.stdin.read().splitlines())
    if not log:
        print("no timestamped log lines on stdin -- pipe a captured slice in", file=sys.stderr)
        return 2
    return report(align(events, log, min_gap_s=a.min_gap), len(log))


if __name__ == "__main__":
    sys.exit(main())
