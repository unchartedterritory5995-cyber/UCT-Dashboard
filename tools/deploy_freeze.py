"""Deploy freeze for the `web` promotion: the Wednesday 09:00-11:00 ET measurement
window (decision B1 / T-4), and every weekday's opening and closing rush.

WHY. The measurement window (TERM-007 / TERM-017 / X-15) is only valid on ONE web
pod for the whole 09:00-11:00 ET window; a deploy inside it restarts the process
and voids that week's reading. `web` deploys from `production`, and
`.github/workflows/promote-production.yml` is the one step that moves
`production`, so that is where a freeze can actually hold.

THE MARKET RUSHES (2026-10-15). A web deploy restarts the pod that holds the Massive
stocks socket; the universe live-bars feed reconnects and the serving tier repairs the
gap. On 2026-10-15 two web deploys landed at 15:47 and 16:02 ET, around the close. So
web is also held every weekday inside `BURST_WINDOWS_ET` (09:20-09:45 and 15:30-16:15
ET, half-open), the busiest minutes of the session. Catch-up: the workflow's weekday
scheduled runs after each rush promote the tip of master.

WHAT IT DOES. Prints a verdict and exits:

    0  NOT FROZEN  promote as usual
    3  FROZEN      inside a window; the promotion is HELD, not refused. The
                   workflow's scheduled runs (Wed 15:05 and 16:05 UTC; weekdays
                   after each rush) promote the tip of master once the window has
                   closed, so nothing waits for the next push.

With `GITHUB_OUTPUT` set it also writes `frozen=yes|no` there.

OVERRIDE (a hotfix that must ship inside the window): set
`DEPLOY_FREEZE_OVERRIDE=<reason>` (the workflow's dispatch input `freeze_override`),
or put `[freeze-override]` in the candidate commit's message. The override is
printed, never silent. A promotion that ships inside the window voids that week's
measurement; the result record will say "2 pod identities".

⛔ FAILS OPEN. Any error reading the clock or the window answers NOT FROZEN with a
warning: a broken freeze must never become a stuck production branch.

⛔ ONE DEFINITION OF THE WINDOW. `in_window` is read from
`api/services/measurement_window.py`, loaded BY PATH (its top level is stdlib-only)
so this tool imports no `api.*` package and no product code in CI.

⚠️ SCOPE. It holds `web` only. `worker`, `bars-api`, `flow-worker`,
`chart-renderer` and `terminal-next-monitor` deploy from `master` on push, so a
push inside the window still restarts them; this reader cannot see those.

Usage:
    python tools/deploy_freeze.py [--now 2026-10-14T13:30:00Z] [--message "..."]
    python tools/deploy_freeze.py --self-check
"""
from __future__ import annotations

import argparse
import datetime as _dt
import importlib.util
import os
import pathlib
import sys

EXIT_OPEN = 0
EXIT_FROZEN = 3
OVERRIDE_ENV = "DEPLOY_FREEZE_OVERRIDE"
OVERRIDE_TOKEN = "[freeze-override]"
#: Weekday rushes, ET wall clock, half-open [start, end). (name, start, end)
BURST_WINDOWS_ET = (("opening", (9, 20), (9, 45)), ("closing", (15, 30), (16, 15)))

_ROOT = pathlib.Path(__file__).resolve().parents[1]


def _window_module():
    path = _ROOT / "api" / "services" / "measurement_window.py"
    spec = importlib.util.spec_from_file_location("_mw_window_for_freeze", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def burst_window(now: _dt.datetime) -> str | None:
    """The weekday rush `now` falls in ("opening"/"closing"), or None."""
    from zoneinfo import ZoneInfo
    et = now.astimezone(ZoneInfo("America/New_York"))
    if et.weekday() >= 5:
        return None
    hm = (et.hour, et.minute)
    for name, start, end in BURST_WINDOWS_ET:
        if start <= hm < end:
            return name
    return None


def decide(now: _dt.datetime, *, override: str = "", message: str = "",
           in_window_fn=None, burst_fn=None) -> tuple[int, str]:
    """(exit_code, reason). Pure apart from the window functions."""
    try:
        in_window_fn = in_window_fn or _window_module().in_window
        inside = bool(in_window_fn(now))
        rush = (burst_fn or burst_window)(now)
    except Exception as e:  # noqa: BLE001
        return EXIT_OPEN, (f"NOT FROZEN (fail-open): the window could not be read "
                           f"({type(e).__name__}: {e})")
    if not inside and not rush:
        return EXIT_OPEN, ("NOT FROZEN: outside Wednesday 09:00-11:00 ET and outside the "
                           "weekday opening/closing rush")
    if inside:
        what = "the Wednesday 09:00-11:00 ET measurement window (TERM-007)"
        cost = "This week's measurement window is void."
        after = "the scheduled run after 11:00 ET"
    else:
        start, end = next((a, b) for n, a, b in BURST_WINDOWS_ET if n == rush)
        what = (f"the weekday {rush} rush ({start[0]:02d}:{start[1]:02d}-"
                f"{end[0]:02d}:{end[1]:02d} ET)")
        cost = "The live bars feed reconnects inside the rush."
        after = "the scheduled run after the rush"
    if override.strip():
        return EXIT_OPEN, (f"NOT FROZEN (OVERRIDE): inside {what}, override reason: "
                           f"{override.strip()[:200]}. {cost}")
    if OVERRIDE_TOKEN in (message or ""):
        return EXIT_OPEN, (f"NOT FROZEN (OVERRIDE): inside {what}, commit message carries "
                           f"{OVERRIDE_TOKEN}. {cost}")
    return EXIT_FROZEN, (f"FROZEN: inside {what}. web is not promoted now; {after} "
                         f"promotes the tip of master. Override: {OVERRIDE_ENV}=<reason> or "
                         f"{OVERRIDE_TOKEN} in the commit message.")


def _write_output(frozen: bool) -> None:
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(f"frozen={'yes' if frozen else 'no'}\n")


def self_check() -> int:
    bad = 0

    def case(name, ok):
        nonlocal bad
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
        bad += 0 if ok else 1

    utc = _dt.timezone.utc
    wed_in = _dt.datetime(2026, 10, 14, 14, 0, tzinfo=utc)     # 10:00 EDT
    wed_out = _dt.datetime(2026, 10, 14, 15, 5, tzinfo=utc)    # 11:05 EDT
    wed_edge = _dt.datetime(2026, 10, 14, 15, 0, tzinfo=utc)   # 11:00 EDT, half-open
    tue = _dt.datetime(2026, 10, 20, 14, 0, tzinfo=utc)
    winter = _dt.datetime(2026, 12, 2, 15, 0, tzinfo=utc)      # 10:00 EST
    case("a Wednesday 10:00 ET is FROZEN", decide(wed_in)[0] == EXIT_FROZEN)
    case("11:05 ET is not", decide(wed_out)[0] == EXIT_OPEN)
    case("11:00 ET exactly is not (half-open)", decide(wed_edge)[0] == EXIT_OPEN)
    case("a plain Tuesday 10:00 ET is not", decide(tue)[0] == EXIT_OPEN)
    case("the one-off window Tue 2026-10-13 10:00 ET is FROZEN",
         decide(_dt.datetime(2026, 10, 13, 14, 0, tzinfo=utc))[0] == EXIT_FROZEN)
    case("winter (EST) 10:00 ET is FROZEN", decide(winter)[0] == EXIT_FROZEN)
    case("the env override opens it", decide(wed_in, override="hotfix")[0] == EXIT_OPEN)
    case("the message token opens it",
         decide(wed_in, message=f"fix: x {OVERRIDE_TOKEN}")[0] == EXIT_OPEN)
    case("a broken window fails OPEN",
         decide(wed_in, in_window_fn=lambda _n: 1 / 0)[0] == EXIT_OPEN)
    # the weekday rushes (2026-10-15)
    thu_close = _dt.datetime(2026, 10, 15, 19, 55, tzinfo=utc)  # 15:55 EDT
    case("a Thursday 15:55 ET (closing rush) is FROZEN", decide(thu_close)[0] == EXIT_FROZEN)
    case("15:30 ET exactly is FROZEN (half-open start)",
         decide(_dt.datetime(2026, 10, 15, 19, 30, tzinfo=utc))[0] == EXIT_FROZEN)
    case("16:15 ET exactly is not (half-open end)",
         decide(_dt.datetime(2026, 10, 15, 20, 15, tzinfo=utc))[0] == EXIT_OPEN)
    case("15:29 ET is not", decide(_dt.datetime(2026, 10, 15, 19, 29, tzinfo=utc))[0] == EXIT_OPEN)
    case("a Monday 09:30 ET (opening rush) is FROZEN",
         decide(_dt.datetime(2026, 10, 19, 13, 30, tzinfo=utc))[0] == EXIT_FROZEN)
    case("09:45 ET is not", decide(_dt.datetime(2026, 10, 19, 13, 45, tzinfo=utc))[0] == EXIT_OPEN)
    case("winter (EST) 15:55 ET is FROZEN",
         decide(_dt.datetime(2026, 12, 3, 20, 55, tzinfo=utc))[0] == EXIT_FROZEN)
    case("a Saturday 15:55 ET is not",
         decide(_dt.datetime(2026, 10, 17, 19, 55, tzinfo=utc))[0] == EXIT_OPEN)
    case("the override opens a rush", decide(thu_close, override="hotfix")[0] == EXIT_OPEN)
    case("a broken rush reader fails OPEN",
         decide(thu_close, burst_fn=lambda _n: 1 / 0)[0] == EXIT_OPEN)
    print("self-check: " + ("PASS" if not bad else f"FAIL ({bad})"))
    return 0 if not bad else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="web deploy freeze: Wednesday measurement window "
                                             "and the weekday market rushes.")
    ap.add_argument("--now", default=None, help="ISO time to judge (default: now, UTC)")
    ap.add_argument("--message", default=None, help="candidate commit message")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)
    if a.self_check:
        return self_check()
    now = (_dt.datetime.fromisoformat(a.now.replace("Z", "+00:00")) if a.now
           else _dt.datetime.now(_dt.timezone.utc))
    code, reason = decide(now, override=os.environ.get(OVERRIDE_ENV, ""),
                          message=a.message or "")
    print(f"deploy-freeze: {reason}")
    _write_output(code == EXIT_FROZEN)
    return code


if __name__ == "__main__":
    sys.exit(main())
