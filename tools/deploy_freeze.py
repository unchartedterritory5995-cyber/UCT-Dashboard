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


#: The longest in-job wait the promotion may take for a freeze to close (minutes). The weekday rushes are
#: 25 and 45 minutes long and the Wednesday window 120, so a hold from inside any of them fits (with the
#: margin). Bounded on purpose: no wait is ever planned longer than this, whatever the clock says, and the
#: workflow's wait step has its own 130-minute timeout under a 200-minute job (GitHub's cap is 6 h).
MAX_WAIT_MIN = 125
#: Seconds added after the window's end before the re-check, so the re-check is never ON the boundary.
WAIT_MARGIN_S = 60


def freeze_ends_at(now: _dt.datetime, *, in_window_fn=None, burst_fn=None) -> _dt.datetime | None:
    """When the freeze `now` is inside ends (UTC), or None when `now` is not inside one.

    Both windows are half-open, so at the returned instant `decide` answers NOT FROZEN. When both apply
    (a Wednesday opening rush inside the measurement window) the LATER end is returned. Raises on a
    broken window reader; `wait_plan` turns that into "no wait" (fail-open, as `decide`)."""
    from zoneinfo import ZoneInfo
    et_zone = ZoneInfo("America/New_York")
    et = now.astimezone(et_zone)
    ends = []
    mw = None
    inside_fn = in_window_fn
    if inside_fn is None:
        mw = _window_module()
        inside_fn = mw.in_window
    if inside_fn(now):
        mw = mw or _window_module()
        ends.append(mw.window_bounds(et.date())[1])
    rush = (burst_fn or burst_window)(now)
    if rush:
        end = next(b for n, _a, b in BURST_WINDOWS_ET if n == rush)
        ends.append(_dt.datetime(et.year, et.month, et.day, end[0], end[1], tzinfo=et_zone))
    return max(ends).astimezone(_dt.timezone.utc) if ends else None


def wait_plan(now: _dt.datetime, *, max_wait_min: int = MAX_WAIT_MIN, override: str = "", message: str = "",
              in_window_fn=None, burst_fn=None) -> tuple[int, str]:
    """(seconds to wait, reason). 0 = do not wait: not frozen, overridden, a broken reader (fail-open), or a
    freeze that ends later than `max_wait_min` from now (it stays a HOLD). Never more than max_wait_min*60."""
    code, _why = decide(now, override=override, message=message, in_window_fn=in_window_fn, burst_fn=burst_fn)
    if code != EXIT_FROZEN:
        return 0, "no wait: not frozen"
    try:
        end = freeze_ends_at(now, in_window_fn=in_window_fn, burst_fn=burst_fn)
    except Exception as e:  # noqa: BLE001
        return 0, f"no wait (fail-open): the window end could not be read ({type(e).__name__}: {e})"
    if end is None:
        return 0, "no wait: the freeze end could not be placed"
    s = int((end - now).total_seconds()) + WAIT_MARGIN_S
    cap = int(max_wait_min) * 60
    if s <= 0:
        return 0, "no wait: the freeze has already ended"
    if s > cap:
        return 0, (f"no wait: the freeze ends at {end.isoformat()} ({s // 60} min), longer than the {max_wait_min}-min "
                   f"bound; the promotion stays HELD for the scheduled runs or the next gate")
    return s, f"wait {s} s: the freeze ends at {end.isoformat()} (+{WAIT_MARGIN_S} s margin)"


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
        after = "the held run, after its bounded in-job wait (backup: the scheduled runs after 11:00 ET),"
    else:
        start, end = next((a, b) for n, a, b in BURST_WINDOWS_ET if n == rush)
        what = (f"the weekday {rush} rush ({start[0]:02d}:{start[1]:02d}-"
                f"{end[0]:02d}:{end[1]:02d} ET)")
        cost = "The live bars feed reconnects inside the rush."
        after = "the held run, after its bounded in-job wait (backup: the scheduled run after the rush),"
    if override.strip():
        return EXIT_OPEN, (f"NOT FROZEN (OVERRIDE): inside {what}, override reason: "
                           f"{override.strip()[:200]}. {cost}")
    if OVERRIDE_TOKEN in (message or ""):
        return EXIT_OPEN, (f"NOT FROZEN (OVERRIDE): inside {what}, commit message carries "
                           f"{OVERRIDE_TOKEN}. {cost}")
    return EXIT_FROZEN, (f"FROZEN: inside {what}. web is not promoted now; {after} "
                         f"promotes the held SHA. Override: {OVERRIDE_ENV}=<reason> or "
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
    # the bounded in-job wait (promote catch-up, 2026-11-10)
    held_1031 = _dt.datetime(2026, 11, 10, 14, 31, tzinfo=utc)   # Tue 09:31 EST, inside the opening rush
    s, _ = wait_plan(held_1031)
    case("09:31 ET (opening rush) waits until 09:45 ET + margin (14 min + 60 s)", s == 14 * 60 + WAIT_MARGIN_S)
    case("the rush end is 09:45 ET exactly",
         freeze_ends_at(held_1031) == _dt.datetime(2026, 11, 10, 14, 45, tzinfo=utc))
    case("after the wait the freeze is OPEN (half-open end)",
         decide(held_1031 + _dt.timedelta(seconds=s))[0] == EXIT_OPEN)
    s2, _ = wait_plan(_dt.datetime(2026, 10, 15, 19, 30, tzinfo=utc))   # Thu 15:30 EDT, closing rush start
    case("15:30 ET waits 45 min + margin", s2 == 45 * 60 + WAIT_MARGIN_S)
    case("a 40-min bound does not wait for a 45-min rush (HOLD)",
         wait_plan(_dt.datetime(2026, 10, 15, 19, 30, tzinfo=utc), max_wait_min=40)[0] == 0)
    case("a Wednesday 10:00 ET waits until 11:00 ET + margin (61 min, within the bound)",
         wait_plan(wed_in)[0] == 60 * 60 + WAIT_MARGIN_S)
    case("Wed 09:00 ET exactly waits the whole window (121 min, within the bound)",
         wait_plan(_dt.datetime(2026, 10, 14, 13, 0, tzinfo=utc))[0] == 120 * 60 + WAIT_MARGIN_S)
    case("a 50-min bound does not wait for the Wednesday window (HOLD)", wait_plan(wed_in, max_wait_min=50)[0] == 0)
    case("a Wednesday 10:30 ET waits until 11:00 ET + margin",
         wait_plan(_dt.datetime(2026, 10, 14, 14, 30, tzinfo=utc))[0] == 30 * 60 + WAIT_MARGIN_S)
    case("Wed 09:30 ET (rush inside the window) ends at the LATER end, 11:00 ET",
         freeze_ends_at(_dt.datetime(2026, 10, 14, 13, 30, tzinfo=utc)) == _dt.datetime(2026, 10, 14, 15, 0, tzinfo=utc))
    case("not frozen: no wait", wait_plan(tue)[0] == 0)
    case("an override: no wait", wait_plan(thu_close, override="hotfix")[0] == 0)
    calls = [0]

    def reader_breaks_on_second_read(_n):
        calls[0] += 1
        if calls[0] > 1:
            raise RuntimeError("window reader broke")
        return False
    case("a window end that cannot be read fails OPEN (no wait)",
         wait_plan(held_1031, in_window_fn=reader_breaks_on_second_read)[0] == 0)
    case("every wait is within the bound", all(
        0 <= wait_plan(_dt.datetime(2026, 10, 15, 13, 0, tzinfo=utc) + _dt.timedelta(minutes=m))[0] <= MAX_WAIT_MIN * 60
        for m in range(0, 12 * 60, 1)))
    print("self-check: " + ("PASS" if not bad else f"FAIL ({bad})"))
    return 0 if not bad else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="web deploy freeze: Wednesday measurement window "
                                             "and the weekday market rushes.")
    ap.add_argument("--now", default=None, help="ISO time to judge (default: now, UTC)")
    ap.add_argument("--message", default=None, help="candidate commit message")
    ap.add_argument("--self-check", action="store_true")
    ap.add_argument("--wait-plan", action="store_true",
                    help="print and write (GITHUB_OUTPUT) wait_s=<seconds> for a bounded in-job wait; exit 0")
    ap.add_argument("--max-wait-min", type=int, default=MAX_WAIT_MIN)
    a = ap.parse_args(argv)
    if a.self_check:
        return self_check()
    now = (_dt.datetime.fromisoformat(a.now.replace("Z", "+00:00")) if a.now
           else _dt.datetime.now(_dt.timezone.utc))
    if a.wait_plan:
        s, why = wait_plan(now, max_wait_min=min(a.max_wait_min, MAX_WAIT_MIN),
                           override=os.environ.get(OVERRIDE_ENV, ""), message=a.message or "")
        print(f"deploy-freeze wait-plan: {why}")
        out = os.environ.get("GITHUB_OUTPUT")
        if out:
            with open(out, "a", encoding="utf-8") as f:
                f.write(f"wait_s={s}\n")
        return 0
    code, reason = decide(now, override=os.environ.get(OVERRIDE_ENV, ""),
                          message=a.message or "")
    print(f"deploy-freeze: {reason}")
    _write_output(code == EXIT_FROZEN)
    return code


if __name__ == "__main__":
    sys.exit(main())
