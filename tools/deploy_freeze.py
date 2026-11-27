"""Deploy freeze: RETIRED. Production promotion NEVER holds on a time window.

⛔⛔ OWNER RULING, 2026-11-27 (verbatim): "fuck the deploy freeze i dont ever want to hold anything back from deploying
ever". So `decide` answers NOT FROZEN at every instant, `freeze_ends_at` has no end to report (None) and `wait_plan`
never waits. A gated-green SHA is fast-forwarded to `production` the moment its gate passes, at 09:31 ET, inside the
Wednesday measurement window, on a half-day's closing rush, at 15:45 ET: whenever. Rails: tests/test_no_deploy_freeze.py.

WHAT THE HOLD USED TO BE (history, so nobody re-derives it by accident). From 2026-10-14 to 2026-11-27 this tool held
the `web` + `bars-api` promotion (both deploy from `production`) inside the Wednesday 09:00-11:00 ET measurement window
(TERM-007, `api/services/measurement_window.py`) and 09:20-16:15 ET on every NYSE trading day (opening rush, regular
session, closing rush; to close + 15 min on a half-day), and `.github/workflows/promote-production.yml` waited for it
in-job, recorded the SHA PENDING and resumed it from catch-up crons. ⛔ Do NOT bring any of it back without a new owner
ruling: the cost it protected against (a cold cache, a live-bars reconnect, ~1 min of 502 on a restart mid-session) was
judged smaller than the cost of holding work back.

WHAT IS LEFT, AND WHY IT IS NOT A HOLD.
  * The promotion GATE is untouched: a SHA promotes only when its gating checks and its own `master deploy gate` run
    succeeded (tools/promotion_gate.py, tools/promote_decision.py). That is correctness, not a time window.
  * `day_hold_windows` / `burst_window` / `half_day_answer` still DESCRIBE the day's market rushes from the NYSE
    calendar (`api/services/session_calendar.py`, loaded by path). Nothing in the promotion reads them any more. They
    stay because two other things are pinned to the same facts by rails: the app's heavy-job rush waits
    (`api/services/market_rush.py`, tests/test_market_rush.py; not a deploy hold) and the Agent-CI merge queue's own
    freeze (`tools/agent_ci_required.py`, SELF_PROTECTED, AUDIT-owned; tests/test_agent_ci_required.py). ⚠️ That merge
    queue freeze still exists and is separate policy: it refuses Agent-path ENTRIES into master inside the rushes; it
    does not hold production promotion.
  * The exit codes, `frozen=` output, `--wait-plan`, `--half-day` and `--self-check` keep their shapes so the workflow,
    tools/promote_dryrun.py and tools/live_check.py run unchanged. EXIT_FROZEN (3) is never returned.

Usage:
    python tools/deploy_freeze.py [--now 2026-10-14T13:30:00Z] [--message "..."]   # always: NOT FROZEN, exit 0
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
#: Never returned since the owner ruling of 2026-11-27; kept so old readers of the exit code still parse.
EXIT_FROZEN = 3
OVERRIDE_ENV = "DEPLOY_FREEZE_OVERRIDE"
OVERRIDE_TOKEN = "[freeze-override]"
#: Weekday rushes, ET wall clock, half-open [start, end). (name, start, end). A DESCRIPTION of the market, kept equal to
#: api/services/market_rush.py and tools/agent_ci_required.py by rails; it holds NO promotion (owner ruling 2026-11-27).
BURST_WINDOWS_ET = (("opening", (9, 20), (9, 45)), ("closing", (15, 30), (16, 15)))
#: (HISTORY: this used to HOLD the promotion; the 2026-11-27 ruling ended every hold. Only `day_hold_windows` reads it.)
#: THE REGULAR SESSION BETWEEN THE RUSHES (owner, 2026-11-19: "do it all", on holding chart-server deploys
#: during trading). On 2026-11-18 evening other sessions' merges restarted bars-api four times in 35 min and web
#: five times in 2.5 h; each restart is a cold cache and a repair pass of every ticker (1.5-3.5 s chart stalls for
#: minutes) and, for web, ~1 min of 502. With the two rushes this holds 09:20-16:15 ET without a gap: a promotion
#: that arrives inside waits for the 16:20 ET catch-up (the 09:50 one lands inside and holds again, harmlessly).
#: The override ships a hotfix inside it. Kept OUT of BURST_WINDOWS_ET, which must equal the app's market rushes
#: (tests/test_market_rush.py).
SESSION_HOLD_ET = ("session", (9, 45), (15, 30))
HOLD_WINDOWS_ET = (BURST_WINDOWS_ET[0], SESSION_HOLD_ET, BURST_WINDOWS_ET[1])

_ROOT = pathlib.Path(__file__).resolve().parents[1]


def _window_module():
    path = _ROOT / "api" / "services" / "measurement_window.py"
    spec = importlib.util.spec_from_file_location("_mw_window_for_freeze", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


#: The regular close the constant windows are written around: the closing rush runs from 30 min before it to 15 min
#: after it. A half-day's closing rush keeps those offsets around ITS close (13:00 => 12:30-13:15 ET).
REGULAR_CLOSE_ET = (16, 0)

_CAL_CACHE: list = []
_WARNED: set[str] = set()
_SELF_CHECKING = False


def _calendar_module():
    """`api/services/session_calendar.py`, loaded BY PATH (stdlib-only top level; no `api.*` import in CI).

    It parses its JSON dataset at import, so a missing or invalid dataset raises HERE. Cached per process."""
    if _CAL_CACHE:
        return _CAL_CACHE[0]
    path = _ROOT / "api" / "services" / "session_calendar.py"
    name = "_session_calendar_for_freeze"
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod   # the dataclass machinery looks its module up by name
    try:
        spec.loader.exec_module(mod)
    except BaseException:
        sys.modules.pop(name, None)
        raise
    _CAL_CACHE.append(mod)
    return mod


def _warn(msg: str) -> None:
    if msg in _WARNED:
        return
    _WARNED.add(msg)
    # The self-check provokes these on purpose; it prints them plainly so a passing check raises no annotation.
    prefix = "deploy-freeze warning (self-check, expected): " if _SELF_CHECKING else "::warning title=Deploy freeze calendar::"
    print(f"{prefix}{msg}", flush=True)


def _hm_add(hm: tuple[int, int], minutes: int) -> tuple[int, int]:
    t = hm[0] * 60 + hm[1] + minutes
    return (t // 60, t % 60)


def _hm_diff(a: tuple[int, int], b: tuple[int, int]) -> int:
    return (a[0] * 60 + a[1]) - (b[0] * 60 + b[1])


def _windows_for_close(close_hm: tuple[int, int]) -> tuple:
    """The opening rush, the session and the closing rush for a day that closes at `close_hm` (ET).

    Derived from the constants, so a 16:00 close gives back exactly HOLD_WINDOWS_ET."""
    opening, session, closing = HOLD_WINDOWS_ET
    c_start = _hm_add(close_hm, _hm_diff(closing[1], REGULAR_CLOSE_ET))
    c_end = _hm_add(close_hm, _hm_diff(closing[2], REGULAR_CLOSE_ET))
    out = [opening]
    if session[1] < c_start:
        out.append((session[0], session[1], c_start))
    out.append((closing[0], max(c_start, opening[2]), c_end))
    return tuple(out)


def day_hold_windows(day: _dt.date) -> tuple:
    """The day's market windows for ET date `day`: ((name, start, end), ...), ET wall clock, half-open.

    ⛔ A DESCRIPTION, NOT A HOLD (owner ruling 2026-11-27): `decide` never reads it, so no promotion waits on it. It
    stays because tests/test_agent_ci_required.py, tests/test_deploy_freeze_market_calendar.py and
    tests/test_market_rush.py pin the merge queue's freeze and the app's heavy-job rushes to these same facts.

    * a weekend: none.
    * not an NYSE trading day (a holiday): none.
    * a half-day: the opening rush to close + 15 min (closing rush = close - 30 min .. close + 15 min).
    * a regular day: HOLD_WINDOWS_ET.

    If the calendar cannot be loaded, raises, or `day` is past its horizon, the answer is HOLD_WINDOWS_ET (the weekday
    rule) with a printed warning, matching the merge queue's FREEZE_FLOOR fallback."""
    if day.weekday() >= 5:
        return ()
    try:
        cal = _calendar_module()
        if not cal.covers(day):
            _warn(f"{day} is outside the NYSE calendar's coverage (horizon {cal.horizon()}); describing the day by the "
                  f"weekday rule (09:20-16:15 ET); no promotion is held. Extend app/src/lib/marketClock/market_calendar.json.")
            return HOLD_WINDOWS_ET
        if not cal.is_trading_day(day):
            return ()
        close = cal.close_time(day)
        close_hm = (close.hour, close.minute)
    except Exception as e:  # noqa: BLE001
        _warn(f"the NYSE calendar could not be read ({type(e).__name__}: {e}); describing the day by the "
              f"weekday rule (09:20-16:15 ET); no promotion is held.")
        return HOLD_WINDOWS_ET
    if close_hm == REGULAR_CLOSE_ET:
        return HOLD_WINDOWS_ET
    return _windows_for_close(close_hm)


def half_day_answer(now: _dt.datetime) -> str:
    """"yes" | "no" | "unknown": is `now`'s ET date an NYSE half-day? ("unknown": the calendar cannot load or does not
    cover the date.) Kept for the CLI's `--half-day`; the promotion no longer has half-day crons to gate."""
    from zoneinfo import ZoneInfo
    day = now.astimezone(ZoneInfo("America/New_York")).date()
    try:
        cal = _calendar_module()
        if not cal.covers(day):
            return "unknown"
        return "yes" if (cal.is_trading_day(day) and cal.is_half_day(day)) else "no"
    except Exception:  # noqa: BLE001
        return "unknown"


def burst_window(now: _dt.datetime) -> str | None:
    """The market window `now` falls in ("opening"/"session"/"closing"), or None, by `day_hold_windows`. A
    description only: it holds no promotion (owner ruling 2026-11-27)."""
    from zoneinfo import ZoneInfo
    et = now.astimezone(ZoneInfo("America/New_York"))
    hm = (et.hour, et.minute)
    for name, start, end in day_hold_windows(et.date()):
        if start <= hm < end:
            return name
    return None


#: Kept for the CLI's `--max-wait-min` and old callers. No wait is ever planned: `wait_plan` always answers 0.
MAX_WAIT_MIN = 125
WAIT_MARGIN_S = 60
#: ⛔ THE OWNER RULING (2026-11-27), as one constant the rails read. Production promotion never holds on a time window.
HOLDS_PROMOTION = False
NO_HOLD_REASON = ("NOT FROZEN: production promotion never holds on a time window (owner ruling 2026-11-27: "
                  "\"i dont ever want to hold anything back from deploying ever\"). A gated-green SHA promotes now.")


def freeze_ends_at(now: _dt.datetime, *, in_window_fn=None, burst_fn=None) -> _dt.datetime | None:
    """Always None: there is no freeze, so there is no freeze end (owner ruling 2026-11-27).

    The keyword arguments are accepted and IGNORED (old call sites, e.g. tools/live_check.py, pass them): no window
    reader is consulted, so no reader, broken or injected, can bring a hold back."""
    return None


def wait_plan(now: _dt.datetime, *, max_wait_min: int = MAX_WAIT_MIN, override: str = "", message: str = "",
              in_window_fn=None, burst_fn=None) -> tuple[int, str]:
    """(0, reason), always: the promotion never waits for a time window (owner ruling 2026-11-27)."""
    return 0, "no wait: production promotion never holds on a time window (owner ruling 2026-11-27)"


def decide(now: _dt.datetime, *, override: str = "", message: str = "",
           in_window_fn=None, burst_fn=None) -> tuple[int, str]:
    """(EXIT_OPEN, reason), at every instant (owner ruling 2026-11-27: "i dont ever want to hold anything back from
    deploying ever").

    Not the Wednesday measurement window, not the opening or closing rush, not the regular session, not a half-day:
    nothing holds the promotion. The arguments are accepted and IGNORED (the workflow still passes `--message`, the
    old override token is meaningless now); no window reader is called, so neither a broken nor an injected reader can
    turn this into FROZEN. The promotion GATE (tests must pass) is a different thing and lives in
    tools/promotion_gate.py and tools/promote_decision.py."""
    return EXIT_OPEN, NO_HOLD_REASON


def _write_output(frozen: bool) -> None:
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(f"frozen={'yes' if frozen else 'no'}\n")


class _SelfCheckCalendar:
    """A FIXED, SYNTHETIC calendar for `--self-check`: the session-calendar interface `day_hold_windows` reads.

    ⛔ WHY NOT THE REAL DATASET. `--self-check` runs inside the production promote job with no continue-on-error, so a
    failing case stops EVERY promotion (review of #2836, point 6). Cases written against the real dataset fail on a
    healthy pipeline: a date "past the horizon" becomes a holiday the day the dataset is extended, and a broken or
    mis-edited dataset (which the description survives by falling back to the weekday rule) would fail the cases about
    its facts. So the self-check proves the LOGIC on facts it owns; the real dataset's facts (Thanksgiving 2026, the
    2026-11-27 half-day, the horizon) are railed in tests/test_deploy_freeze_market_calendar.py and by the PR dry-run
    steps in promote-production.yml."""

    HOLIDAYS = frozenset({_dt.date(2026, 11, 26)})
    HALF_DAYS = {_dt.date(2026, 11, 27): (13, 0)}
    START = _dt.date(2000, 1, 1)
    HORIZON = _dt.date(2028, 12, 31)

    def version(self):
        return "self-check"

    def horizon(self):
        return self.HORIZON

    def covers(self, d):
        return self.START <= d <= self.HORIZON

    def is_trading_day(self, d):
        return d.weekday() < 5 and d not in self.HOLIDAYS

    def is_half_day(self, d):
        return d in self.HALF_DAYS

    def close_time(self, d):
        from zoneinfo import ZoneInfo
        if not self.is_trading_day(d):
            return None
        hh, mm = self.HALF_DAYS.get(d, REGULAR_CLOSE_ET)
        return _dt.datetime(d.year, d.month, d.day, hh, mm, tzinfo=ZoneInfo("America/New_York"))


def self_check() -> int:
    """Every case runs on `_SelfCheckCalendar`, never on the real dataset (see its docstring). The real calendar's
    state is printed as information only: a broken calendar is a WARNING (it holds no promotion either way),
    never a self-check failure."""
    global _SELF_CHECKING, _calendar_module
    try:
        cal = _calendar_module()
        print(f"  info the NYSE calendar v{cal.version()} loads, horizon {cal.horizon()} (information, not a case)")
    except Exception as e:  # noqa: BLE001
        print(f"  info the NYSE calendar does NOT load ({type(e).__name__}: {e}); the day is described by the "
              f"weekday rule until it is fixed; no promotion is held (information, not a case)")
    real_loader = _calendar_module
    stub = _SelfCheckCalendar()
    _SELF_CHECKING = True
    _calendar_module = lambda: stub  # noqa: E731
    try:
        return _self_check()
    finally:
        _calendar_module = real_loader
        _SELF_CHECKING = False


def _self_check() -> int:
    global _calendar_module
    bad = 0

    def case(name, ok):
        nonlocal bad
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
        bad += 0 if ok else 1

    utc = _dt.timezone.utc

    def et_at(y, mo, d, hh, mm):
        from zoneinfo import ZoneInfo
        return _dt.datetime(y, mo, d, hh, mm, tzinfo=ZoneInfo("America/New_York")).astimezone(utc)

    def no_hold(now, **kw):
        return (decide(now, **kw)[0] == EXIT_OPEN and freeze_ends_at(now, **{k: v for k, v in kw.items()
                if k in ("in_window_fn", "burst_fn")}) is None and wait_plan(now, **kw)[0] == 0)

    # ⛔ THE OWNER RULING (2026-11-27): no time window holds the promotion. Every clock the old freeze held:
    case("the ruling constant says the promotion never holds", HOLDS_PROMOTION is False)
    case("Tue 09:31 ET (the old opening rush) is NOT FROZEN, no wait", no_hold(et_at(2026, 11, 10, 9, 31)))
    case("Tue 11:00 ET (the old session hold) is NOT FROZEN, no wait", no_hold(et_at(2026, 11, 10, 11, 0)))
    case("Thu 15:45 ET (the old closing rush) is NOT FROZEN, no wait", no_hold(et_at(2026, 10, 15, 15, 45)))
    case("Wed 10:00 ET (the old measurement window) is NOT FROZEN, no wait", no_hold(et_at(2026, 10, 14, 10, 0)))
    case("half-day 2026-11-27 12:45 ET (the old half-day closing rush) is NOT FROZEN, no wait",
         no_hold(et_at(2026, 11, 27, 12, 45)))
    case("winter (EST) Wed 10:00 ET is NOT FROZEN, no wait", no_hold(et_at(2026, 12, 2, 10, 0)))
    case("injected 'always inside' readers cannot bring a hold back",
         no_hold(et_at(2026, 10, 14, 10, 0), in_window_fn=lambda _n: True, burst_fn=lambda _n: "session"))
    case("the old override inputs change nothing (still NOT FROZEN)",
         decide(et_at(2026, 10, 14, 10, 0), override="x", message="[freeze-override]")[0] == EXIT_OPEN)
    case("no minute of a regular day holds or waits", all(
        no_hold(_dt.datetime(2026, 10, 15, 0, 0, tzinfo=utc) + _dt.timedelta(minutes=m)) for m in range(0, 24 * 60, 5)))
    # The calendar DESCRIPTION (not a hold any more): the day's rushes, kept equal to the merge queue's freeze and the
    # app's heavy-job rushes by rails. ⛔ These run on _SelfCheckCalendar's OWN facts, never the real dataset's.
    case("a regular day's described windows are exactly HOLD_WINDOWS_ET", day_hold_windows(_dt.date(2026, 12, 3)) == HOLD_WINDOWS_ET)
    case("a holiday describes no rush", day_hold_windows(_dt.date(2026, 11, 26)) == ())
    case("a half-day's closing rush is described 12:30-13:15 ET",
         burst_window(et_at(2026, 11, 27, 12, 50)) == "closing" and burst_window(et_at(2026, 11, 27, 13, 15)) is None)
    past = _calendar_module().horizon() + _dt.timedelta(days=1)
    while past.weekday() >= 5:
        past += _dt.timedelta(days=1)
    case(f"a weekday past the calendar horizon ({past}) is described by the weekday rule",
         burst_window(et_at(past.year, past.month, past.day, 13, 0)) == "session")
    real_loader = _calendar_module

    def broken_loader():
        raise RuntimeError("self-check: calendar unreadable")
    _calendar_module = broken_loader
    try:
        case("an unreadable calendar describes the weekday rule, and still holds NOTHING",
             burst_window(et_at(2026, 11, 26, 13, 0)) == "session" and no_hold(et_at(2026, 11, 26, 13, 0)))
    finally:
        _calendar_module = real_loader
    print("self-check: " + ("PASS" if not bad else f"FAIL ({bad})"))
    return 0 if not bad else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="deploy freeze, RETIRED 2026-11-27: always NOT FROZEN (exit 0). "
                                             "The promotion never holds on a time window.")
    ap.add_argument("--now", default=None, help="ISO time to judge (default: now, UTC)")
    ap.add_argument("--message", default=None, help="candidate commit message")
    ap.add_argument("--self-check", action="store_true")
    ap.add_argument("--wait-plan", action="store_true",
                    help="print and write (GITHUB_OUTPUT) wait_s=0 (the promotion never waits); exit 0")
    ap.add_argument("--max-wait-min", type=int, default=MAX_WAIT_MIN)
    ap.add_argument("--half-day", action="store_true",
                    help="print half_day=yes|no|unknown for the ET date of --now (default today); exit 0")
    a = ap.parse_args(argv)
    if a.self_check:
        return self_check()
    now = (_dt.datetime.fromisoformat(a.now.replace("Z", "+00:00")) if a.now
           else _dt.datetime.now(_dt.timezone.utc))
    if a.half_day:
        print(f"half_day={half_day_answer(now)}")
        return 0
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
