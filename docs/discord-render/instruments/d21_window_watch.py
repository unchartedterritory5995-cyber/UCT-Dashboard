"""D-21 window watch — read-only, one-shot, cheap.

Reports whether the real-world windows the remaining D-21 work-order items need
have arrived, and separately reports the soak-24h gate's own live verdict, so
nobody has to remember to check by hand at the right time of day.

    python docs/discord-render/instruments/d21_window_watch.py
    python docs/discord-render/instruments/d21_window_watch.py --self-check

⛔⛔ READ-ONLY BY CONSTRUCTION. This script never calls R72/R62/D-13's own retry
logic, never touches the soak process, never writes to any gate's state — it only
reads clocks, sessions, and the soak-24h gate's own verdict, then logs what it
saw. Registered as Task Scheduler task "UCT-D21-Window-Watch", 15-minute
repetition, mirroring UCT-D14-Monitor / UCT-D14-LogTail's own registration shape
(read via `Get-ScheduledTask`, not guessed): a `MSFT_TaskTimeTrigger` with a
`PT15M` repetition interval and no duration limit, one-shot action per tick (no
internal loop or lock file needed — each invocation completes in well under a
second, so ticks can never overlap in practice, and there is nothing here whose
correctness depends on serializing against itself).

⛔ EVERY CONDITION IS READ FROM THE CODE/EVIDENCE THAT ALREADY DEFINES IT, NEVER
INVENTED — the exact discipline `flip_preconditions.py` itself was built on:
  - R72 / R62: `massive._detect_session() == "regular"` — the SAME predicate
    `live_tier.run_sweep()` gates its own real work on
    (`tests/test_screener_live_tier.py::test_the_tier_runs_in_the_regular_
    session_only`), and the same "the sweep needs the market open to run for
    real" precondition `D14-CHECKLIST.md` states, verbatim, for R62's own
    acceptance window.
  - D-13: `D14-CHECKLIST.md`'s own stated precondition, "clock-gated 10:00 ET" —
    `massive._today_et_is_a_trading_day()` (holiday-aware, not just weekday) AND
    ET wall-clock time >= 10:00.
  - soak-24h: `flip_preconditions.check_soak_24h()`, called directly and
    unchanged — this script never re-implements or re-derives that logic, only
    reads its verdict. (⚠️ Read `flip_preconditions.check_soak_24h`'s own source
    before trusting "soak-24h will eventually read MET" as a plan: it counts
    EVERY `TOTALS soak_job` line ever written to the soak log, not a rolling
    window, so a single non-PASS tick anywhere in the log's history is enough to
    hold this row NOT MET forever — the log already has real historical FAIL
    ticks from before tonight's fixes landed. Whether that log is ever rotated
    is outside this script's scope; it is flagged here so nobody assumes "just
    wait 24h of clean ticks" is sufficient on its own.)

⭐ Alerts are LOCAL LOG LINES, not a live page — this script sends nothing to
Discord, Railway, or any external channel. `event: "window_opened"` /
`event: "gate_moved"` lines are the distinctly-marked ones; grep for `"event"`
to find them without wading through routine ticks.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OUT_DIR = ROOT / "docs" / "discord-render" / "evidence" / "d21-window-watch"
EVENTS = OUT_DIR / "window-watch-events.jsonl"
STATE = OUT_DIR / ".window-watch-state.json"

ITEMS = ("soak_24h", "R72", "R62", "D13")


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _now_et() -> _dt.datetime:
    from zoneinfo import ZoneInfo
    return _dt.datetime.now(ZoneInfo("America/New_York"))


# ── pure predicates, testable without touching a clock or a live module ─────

def regular_session_window_open(session: str) -> bool:
    """R72's and R62's shared precondition: the regular (RTH) session is live.

    ⛔ `session` must come from `massive._detect_session()` — the same string
    `live_tier.run_sweep()` itself branches on. A pure function taking the
    string as an argument is what makes this provable without monkeypatching a
    live module."""
    return session == "regular"


def d13_window_open(is_trading_day: bool, hour: int, minute: int) -> bool:
    """D-13's stated precondition, verbatim from D14-CHECKLIST.md: "clock-gated
    10:00 ET" on an actual trading day (holiday-aware, not just weekday)."""
    return is_trading_day and (hour, minute) >= (10, 0)


# ── live reads, thin wrappers so the pure predicates stay pure ──────────────

def _live_session() -> tuple[str | None, str | None]:
    """(session, error). Never raises — an import or read failure is reported,
    not swallowed, per this repo's own "code, never prose" / "name the reason"
    discipline."""
    try:
        sys.path.insert(0, str(ROOT))
        from api.services import massive
        return massive._detect_session(), None
    except Exception as exc:  # noqa: BLE001
        return None, f"{type(exc).__name__}: {exc}"


def _live_trading_day() -> tuple[bool | None, str | None]:
    try:
        sys.path.insert(0, str(ROOT))
        from api.services import massive
        return massive._today_et_is_a_trading_day(), None
    except Exception as exc:  # noqa: BLE001
        return None, f"{type(exc).__name__}: {exc}"


def _live_soak_state() -> dict:
    """Read `flip_preconditions.check_soak_24h()` directly — never
    re-implemented here. Failure is reported as its own dict shape, matching
    the three-state contract every other check in this repo obeys."""
    try:
        sys.path.insert(0, str(HERE))
        import flip_preconditions as fp
        return fp.check_soak_24h()
    except Exception as exc:  # noqa: BLE001
        return {"precondition": "soak clean for >= 24 h", "state": "UNKNOWN",
                "evidence": f"could not import/run flip_preconditions: "
                            f"{type(exc).__name__}: {exc}"}


# ── one tick: compute current state for all four items ──────────────────────

def compute_current() -> dict:
    et = _now_et()
    session, session_err = _live_session()
    trading_day, trading_day_err = _live_trading_day()

    soak = _live_soak_state()

    r72_open = regular_session_window_open(session) if session is not None else None
    r62_open = r72_open  # identical precondition, read once
    d13_open = (d13_window_open(trading_day, et.hour, et.minute)
                if trading_day is not None else None)

    return {
        "t": _now(),
        "et_clock": et.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "session": session,
        "session_error": session_err,
        "trading_day": trading_day,
        "trading_day_error": trading_day_err,
        "soak_24h": {"state": soak.get("state"), "evidence": soak.get("evidence")},
        "R72": {"window_open": r72_open},
        "R62": {"window_open": r62_open},
        "D13": {"window_open": d13_open},
    }


# ── transition detection against the last recorded state ────────────────────

def _item_signal(cur: dict, name: str) -> object:
    """The single value that means 'open'/'MET' for one item, or None if
    unmeasurable right now — kept in one place so the transition check and the
    self-check agree on what 'the same thing happened again' means."""
    if name == "soak_24h":
        return cur["soak_24h"]["state"]
    return cur[name]["window_open"]


def detect_transitions(prev: dict | None, cur: dict) -> list[dict]:
    """Which items just became newly-favourable since the last recorded tick.

    ⛔ ONLY an OPENING is reported as a `window_opened`/`gate_moved` event —
    that is the news this script exists to surface. A window closing again (RTH
    ending, the clock passing midnight) is still logged in the routine tick
    (nothing is hidden), just not flagged as an alert line, because closing is
    expected and not something anyone needs paged about.

    `prev=None` (no prior state — the very first tick, or the state file was
    deleted) never fires a transition: there is nothing to have transitioned
    FROM, and treating "no history" as "just opened" would be exactly the
    absence-is-not-evidence mistake this repo names repeatedly elsewhere."""
    if prev is None:
        return []
    events = []
    for name in ITEMS:
        was = _item_signal(prev, name) if name in prev else None
        now = _item_signal(cur, name)
        was_favourable = was == "MET" if name == "soak_24h" else bool(was)
        now_favourable = now == "MET" if name == "soak_24h" else bool(now)
        if now_favourable and not was_favourable:
            events.append({
                "event": "gate_moved" if name == "soak_24h" else "window_opened",
                "item": name,
                "from": was,
                "to": now,
            })
    return events


# ── I/O ───────────────────────────────────────────────────────────────────

def _write_event(rec: dict) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(EVENTS, "a", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(rec) + "\n")


def _load_state() -> dict | None:
    if not STATE.exists():
        return None
    try:
        return json.loads(STATE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _save_state(cur: dict) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(cur, indent=1), encoding="utf-8")
    os.replace(tmp, STATE)


def run_tick() -> int:
    prev = _load_state()
    cur = compute_current()
    events = detect_transitions(prev, cur)

    _write_event({"t": cur["t"], "event": "tick", "session": cur["session"],
                  "trading_day": cur["trading_day"],
                  "soak_24h_state": cur["soak_24h"]["state"],
                  "R72_open": cur["R72"]["window_open"],
                  "R62_open": cur["R62"]["window_open"],
                  "D13_open": cur["D13"]["window_open"]})
    for ev in events:
        _write_event({"t": cur["t"], **ev})
        print(f"[{cur['t']}] {ev['event'].upper()}: {ev['item']} "
              f"{ev['from']!r} -> {ev['to']!r}")

    _save_state(cur)

    if not events:
        print(f"[{cur['t']}] tick: session={cur['session']} "
              f"trading_day={cur['trading_day']} "
              f"soak_24h={cur['soak_24h']['state']} "
              f"R72_open={cur['R72']['window_open']} "
              f"R62_open={cur['R62']['window_open']} "
              f"D13_open={cur['D13']['window_open']}")
    return 0


# ── self-check: prove both "not yet" and "now open" are reachable, and that a
#    close is never mis-reported as an open ──────────────────────────────────

def self_check() -> int:
    cases: list[tuple[str, bool]] = []

    cases.append(("regular session is open", regular_session_window_open("regular") is True))
    cases.append(("pre-market is not open", regular_session_window_open("pre_market") is False))
    cases.append(("post-market is not open", regular_session_window_open("post_market") is False))

    cases.append(("D-13 opens at exactly 10:00 ET on a trading day",
                  d13_window_open(True, 10, 0) is True))
    cases.append(("D-13 is closed at 09:59 ET on a trading day",
                  d13_window_open(True, 9, 59) is False))
    cases.append(("D-13 stays closed after 10:00 ET on a non-trading day",
                  d13_window_open(False, 14, 0) is False))

    # ⛔ THE ACTUAL REGRESSION THIS SCRIPT EXISTS TO CATCH: a transition from
    # closed -> open must fire exactly one event, named correctly, and a tick
    # with no change must fire none.
    closed = {"soak_24h": {"state": "NOT MET"}, "R72": {"window_open": False},
             "R62": {"window_open": False}, "D13": {"window_open": False}}
    opened_r72 = {"soak_24h": {"state": "NOT MET"}, "R72": {"window_open": True},
                 "R62": {"window_open": False}, "D13": {"window_open": False}}
    met_soak = {"soak_24h": {"state": "MET"}, "R72": {"window_open": False},
               "R62": {"window_open": False}, "D13": {"window_open": False}}

    evs = detect_transitions(closed, closed)
    cases.append(("no change -> zero events", evs == []))

    evs = detect_transitions(closed, opened_r72)
    cases.append(("R72 closed->open fires exactly one window_opened event",
                  len(evs) == 1 and evs[0] == {"event": "window_opened", "item": "R72",
                                               "from": False, "to": True}))

    evs = detect_transitions(opened_r72, closed)
    cases.append(("R72 open->closed fires NO event (closing is not alertable news)",
                  evs == []))

    evs = detect_transitions(closed, met_soak)
    cases.append(("soak NOT MET -> MET fires exactly one gate_moved event",
                  len(evs) == 1 and evs[0] == {"event": "gate_moved", "item": "soak_24h",
                                               "from": "NOT MET", "to": "MET"}))

    evs = detect_transitions(None, opened_r72)
    cases.append(("no prior state (first tick ever) fires nothing, "
                  "never treats absence as an opening", evs == []))

    # ⛔ NON-VACUITY: a real tick against the real tree must actually produce a
    # readable session/trading_day, not silently degrade to None/None every
    # time — that would make every case above true for the wrong reason.
    cur = compute_current()
    cases.append(("a real tick reads a real session string, not None",
                  cur["session"] in ("regular", "pre_market", "post_market")))
    cases.append(("a real tick reads a real trading_day bool, not None",
                  isinstance(cur["trading_day"], bool)))
    cases.append(("a real tick reads the real soak_24h gate's own state",
                  cur["soak_24h"]["state"] in ("MET", "NOT MET", "NOT MEASURABLE")))

    for name, ok in cases:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
    failed = sum(not ok for _, ok in cases)
    print(f"TOTALS d21_window_watch --self-check {'PASS' if not failed else 'FAIL'} "
          f"cases={len(cases)} failed={failed}")
    return 0 if not failed else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args()
    if a.self_check:
        return self_check()
    return run_tick()


if __name__ == "__main__":
    sys.exit(main())
