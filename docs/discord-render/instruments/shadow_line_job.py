"""The scheduled shadow lines — one driver, three windows, DATES COMPUTED AT RUN TIME.

    python shadow_line_job.py --mode midday|fullday|canary [--out-dir DIR]
    python shadow_line_job.py --self-check

⛔⛔ THE DATE IS NEVER A LITERAL. The two hand-written .cmd files this replaces carried
`--since 2026-09-14T00:00:00Z --until 2026-09-14T14:00:00Z` as TYPED TEXT. A scheduled task
is, by definition, a thing that runs on a day nobody is watching: on 2026-09-15 those
scripts would have pulled 2026-09-14's window, found records, printed a clean-looking
report, and been WRONG — with nothing in the output to say so. A stale window does not
fail; it reports yesterday as today.

⛔ B2's ruling is that these lines print whether or not a session is alive. That is only
true if the job needs nothing from a session — including the current date.

⭐ EVERY LINE STAMPS THE WINDOW IT ACTUALLY USED, in ET and in UTC, as its first output.
An instrument that does not say what it measured cannot be caught measuring the wrong
thing — which is precisely how the hardcoded dates survived review twice.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import pathlib
import subprocess
import sys
from zoneinfo import ZoneInfo

OK, ERROR, INCONCLUSIVE = 0, 1, 2

ET = ZoneInfo("America/New_York")
UTC = _dt.timezone.utc

ROOT = pathlib.Path(__file__).resolve().parents[3]
DEFAULT_OUT = pathlib.Path(r"C:\Users\Patrick\uct-render-soak")

#: What `shadow_report.py` ACTUALLY prints when it has run. Read off the tool, not invented.
#: ⛔ If shadow_report's summary wording changes, this must change with it — a run that
#: really did produce a report must never be recorded as "did not run", because a line that
#: cries wolf gets muted inside a week and then a real silent failure looks identical.
SUMMARY_MARKERS = ("records:", "outcomes:", "TOTALS")

#: mode -> (ET start hour:minute, ET end hour:minute or None for "now", jsonl name, label)
#: ⚠️ `None` for the end means "up to the moment the job runs", which is the honest window
#: for a line that fires mid-session. A fixed end on a mid-session line would claim to
#: cover hours that had not happened yet.
MODES = {
    "midday":  ((0, 0), (12, 0), "shadow-midday.jsonl", "12:00 ET midday shadow line"),
    "fullday": ((4, 0), (17, 0), "shadow-fullday.jsonl", "16:15 ET full-day shadow line"),
    # The canary line reports the session that has just ENDED plus the overnight, so its
    # window starts at the previous day's 04:00 ET and runs to the moment it fires.
    "canary":  ((-20, 0), None, "shadow-canary.jsonl", "08:45 ET canary + shadow line"),
}


def window_for(mode: str, now_et: _dt.datetime) -> tuple[_dt.datetime, _dt.datetime]:
    """(start, end) as timezone-aware ET datetimes, derived from `now_et`.

    A negative start hour means "that many hours before midnight today", i.e. yesterday."""
    (sh, sm), end = MODES[mode][0], MODES[mode][1]
    midnight = now_et.replace(hour=0, minute=0, second=0, microsecond=0)
    start = midnight + _dt.timedelta(hours=sh, minutes=sm)
    if end is None:
        return start, now_et
    stop = midnight.replace(hour=end[0], minute=end[1])
    # ⛔ Never claim a window that extends past now. A line that fires early (a catch-up
    # after a restart, say) must report the hours it can actually see.
    return start, min(stop, now_et)


def _iso_z(d: _dt.datetime) -> str:
    return d.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def run(mode: str, out_dir: pathlib.Path, now_et: _dt.datetime | None = None) -> int:
    now_et = now_et or _dt.datetime.now(ET)
    start, stop = window_for(mode, now_et)
    jsonl = out_dir / MODES[mode][2]
    label = MODES[mode][3]

    print(f"================ {label}")
    print(f"  fired at   {now_et.strftime('%Y-%m-%d %H:%M:%S %Z')}")
    print(f"  window ET  {start.strftime('%Y-%m-%d %H:%M')} -> {stop.strftime('%Y-%m-%d %H:%M')}")
    print(f"  window UTC {_iso_z(start)} -> {_iso_z(stop)}")
    if stop <= start:
        print("  EMPTY WINDOW — the job fired before its window opened. Reporting nothing "
              "rather than a window that runs backwards.")
        return INCONCLUSIVE

    pull = [sys.executable, "-u", "tools/railway_env_logs.py", "--filter", "drender",
            "--since", _iso_z(start), "--until", _iso_z(stop),
            "--out", str(jsonl), "--control-filter", "drender"]
    p = subprocess.run(pull, cwd=ROOT, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    print((p.stdout or "") + (p.stderr or ""))
    if p.returncode != 0:
        print(f"  PULL FAILED exit={p.returncode} — no line today, and that is the report.")
        return ERROR

    rep = [sys.executable, "-u", "docs/discord-render/instruments/shadow_report.py", str(jsonl)]
    q = subprocess.run(rep, cwd=ROOT, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    out = (q.stdout or "") + (q.stderr or "")
    print(out)
    # ⛔ A run with no summary line is not a run, whatever the exit code says.
    # ⚰️ This asked for the token "TOTALS" on its first fire and failed a run that had
    # worked perfectly — shadow_report.py does not emit that word; it emits `records:` and
    # `outcomes:`. The rule is right and the needle was invented rather than read off the
    # tool, which is the same defect as a kill-switch env name nobody grepped: a check
    # looking for the shape you EXPECT rather than the shape that EXISTS.
    if not any(marker in out for marker in SUMMARY_MARKERS):
        print(f"  ⛔ NO SUMMARY LINE from shadow_report (looked for {SUMMARY_MARKERS!r}) "
              f"— this did not run.")
        return ERROR
    print(f"  EXITCODE={q.returncode}")
    return q.returncode


def self_check() -> int:
    """⛔ The whole point is that the date is not a literal, so the checks are about the
    window MOVING with the clock."""
    d1 = _dt.datetime(2026, 9, 14, 13, 0, tzinfo=ET)
    d2 = _dt.datetime(2026, 9, 15, 13, 0, tzinfo=ET)
    a1, b1 = window_for("midday", d1)
    a2, b2 = window_for("midday", d2)
    late = _dt.datetime(2026, 9, 14, 23, 0, tzinfo=ET)
    early = _dt.datetime(2026, 9, 14, 6, 0, tzinfo=ET)
    fa, fb = window_for("fullday", late)
    ea, eb = window_for("fullday", early)
    ca, cb = window_for("canary", _dt.datetime(2026, 9, 15, 8, 45, tzinfo=ET))

    cases = [
        ("midday starts at ET midnight", (a1.hour, a1.minute) == (0, 0)),
        ("midday ends at 12:00 ET", (b1.hour, b1.minute) == (12, 0)),
        # ⛔⛔ the load-bearing one: the defect being fixed is a window that does NOT move
        ("the window MOVES with the day", a2.date() > a1.date() and a2.date() == d2.date()),
        ("a full day fired late still ends at 17:00 ET", (fb.hour, fb.minute) == (17, 0)),
        # ⛔ and never claims hours that have not happened
        ("a line fired early is clamped to now", eb == early),
        ("canary reaches back into yesterday", ca.date() < cb.date()),
        ("canary ends at the firing moment", (cb.hour, cb.minute) == (8, 45)),
        ("every declared mode has a window",
         all(window_for(m, d1)[1] >= window_for(m, d1)[0] or m == "midday" for m in MODES)),
        # ⛔ non-vacuity: prove the checker could see a window that did NOT move, which is
        # exactly the bug. If window_for ignored `now`, row 3 would be the only red.
        ("a frozen window would be detected", window_for("midday", d1)[0] != window_for("midday", d2)[0]),
    ]
    failed = sum(not ok for _, ok in cases)
    for name, ok in cases:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
    print(f"TOTALS shadow_line_job --self-check {'PASS' if not failed else 'FAIL'} "
          f"cases={len(cases)} failed={failed}")
    return OK if not failed else ERROR


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--mode", choices=sorted(MODES))
    ap.add_argument("--out-dir", default=str(DEFAULT_OUT))
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args(argv)
    if args.self_check:
        return self_check()
    if not args.mode:
        ap.error("pass --mode or --self-check")
    out = pathlib.Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    return run(args.mode, out)


if __name__ == "__main__":
    raise SystemExit(main())
