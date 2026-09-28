# api/services/cadence_heartbeat.py — TERM-015 / FB-OBS-04: S6, the cadence heartbeat.
"""When did this signal last REPORT? — an answer that does not depend on it being healthy.

Spec: ``docs/terminal-research/10-roadmap/backlog.md`` "#### TERM-015", and
``10-roadmap/observability-plan.md`` §4.3 row S6, §4.7 (the ``as_of`` contract) and
§4.8 (the dead-man convention this ports).

THE PROBLEM, in one sentence
────────────────────────────
Every monitor on ``web`` is silent-on-healthy by design (correctly — a monitor that
posts on every healthy cycle gets muted), so *"no alert since Tuesday"* and *"the
cron has not fired since Tuesday"* are the same observation. ``liveflow_monitor``'s
scorecard is the one construct in the repo under which an ABSENT report is itself
the alarm; this generalises it.

THE CONVENTION — T1 marker on ``web``, T2 reader out of process
───────────────────────────────────────────────────────────────
  • Each signal calls ``mark(<name>)`` every period it RUNS. The marker is one JSON
    file per signal per ET day, written with ``desk_session_audit._write_state``'s
    atomic ``os.replace`` idiom (tempfile in the same directory, then replace).
  • ``build_rollup`` reads the markers and names every contracted signal that did
    NOT report inside its window. ``tools/cadence_rollup_report.py`` prints it and
    ``terminal-next-monitor`` posts it ONCE a day, on the ops channel, healthy or not.

⛔⛔ THE MARKER SAYS "RAN", NOT "HEALTHY" — that is the recursive requirement.
The spec: *"S6 exists so that 'when did this signal last report?' has an answer
that does not depend on the signal being healthy."* So an emit site marks on ENTRY,
before its checks: a signal that runs and pages is REPORTING, and a heartbeat written
only on the healthy path would go silent exactly when the signal matters most.
Whether the signal was healthy is that signal's own alert's business.

⛔ A MARKER NOBODY CONTRACTS IS REFUSED. ``mark`` writes only for a name in
``CONTRACTS``; anything else would be a heartbeat the roll-up can never read, which
looks like coverage and is none. The emit sites and the contracts are held equal in
both directions by an AST rail (``tests/test_cadence_heartbeat.py``).

⛔ ``mark`` NEVER RAISES. It is called from inside other monitors' loops, and a
heartbeat that raised would take down the signal it reports on.

⚠️ UNREADABLE IS NOT MISSING, AND NEITHER IS REPORTED. A marker that exists but
cannot be parsed is its own state with its reason — *a layer that could not be READ
is not a layer that is EMPTY* (observability-plan §4.4).

WHAT THIS DELIBERATELY DOES NOT DO
──────────────────────────────────
  • No transport. The roll-up is posted by ``terminal-next-monitor`` through the
    TERM-011 resolver (``alert_destination.ops_webhook``); nothing here imports an
    HTTP client.
  • No per-period coverage judgement. A daily roll-up reading the LATEST marker
    proves the signal is alive now and says how many times it ran today; it does not
    claim the signal never paused between reports. ``runs_today`` is reported so a
    reader can see a thin day, never scored.
"""

from __future__ import annotations

import datetime as _dt
import json
import logging
import os
import re
import tempfile
import threading
import time
from dataclasses import dataclass
from typing import Optional
from zoneinfo import ZoneInfo

log = logging.getLogger(__name__)

_ET = ZoneInfo("America/New_York")

#: A LOCATION, not a gate: overrides where markers live. Unset ⇒ ``$DATA_DIR/cadence``,
#: i.e. ``web``'s volume. Read at CALL time so a test (or an operator) can move it.
MARKER_DIR_ENV = "CADENCE_MARKER_DIR"

#: OBS-5: "90 days per signal". Enforced at each period rollover, so the directory is
#: bounded by construction — the volume has a measured 33 GB runaway in its history
#: (``disk_watchdog.py``), and an unbounded marker directory is that incident's class.
RETAIN_DAYS = 90

REPORTED = "REPORTED"
MISSING = "MISSING"
UNREADABLE = "UNREADABLE"

#: The daily post time is the MONITOR's (``terminal_next_monitor_main.SCHEDULE``); this
#: literal only words the footer, so the reader knows when absence becomes the alarm.
_ABSENCE_LINE = ("this roll-up posts EVERY day, healthy or not -- its ABSENCE is "
                 "itself the alarm (dead-man convention, TERM-015)")


@dataclass(frozen=True)
class CadenceContract:
    """One signal's promise: it reports at least every ``max_silence_s`` seconds.

    ``signal`` is the name the roll-up prints AND the marker directory name, so it is
    kept to ``[a-z0-9-]`` (railed) — a name is never a path.
    """

    signal: str
    #: Human wording of the cadence, printed beside the signal.
    period: str
    #: The window: a latest marker older than this at roll-up time is MISSING.
    max_silence_s: int


#: ⭐ THE ROSTER. Every entry needs a ``cadence_heartbeat.mark("<signal>")`` emit site,
#: and every emit site needs an entry — railed both ways by AST.
#:
#: ⚠️ ONE SIGNAL, deliberately. It is the one ops monitor on ``web`` that runs
#: unconditionally (started from ``api/main.py`` startup, no gate), so its contract can
#: never read MISSING merely because somebody left a flag off — a roll-up that named a
#: deliberately-disabled monitor every day would be muted inside a week. Gated monitors
#: (and TERM-013/016/017's signals) join by adding a row and a mark, nothing else.
CONTRACTS: tuple = (
    CadenceContract(
        signal="bars-freshness-watchdog",
        period="every 5 min, 24/7, on web (bars_continuous_audit._run_5min_check)",
        # 24 missed cycles. A redeploy restarts the loop, which runs the check at once,
        # so deploy churn cannot open a gap anywhere near this wide.
        max_silence_s=2 * 3600,
    ),
)

_SIGNAL_NAME = re.compile(r"^[a-z0-9][a-z0-9-]*$")
_PERIOD_FILE = re.compile(r"^(\d{4}-\d{2}-\d{2})\.json$")
_lock = threading.Lock()


def contract_for(signal: object, contracts=None) -> Optional[CadenceContract]:
    """The contract naming ``signal``, or None."""
    for c in (CONTRACTS if contracts is None else contracts):
        if c.signal == signal:
            return c
    return None


def marker_dir() -> str:
    """Where markers live, read NOW. ``$CADENCE_MARKER_DIR``, else ``$DATA_DIR/cadence``."""
    explicit = os.environ.get(MARKER_DIR_ENV)
    if explicit:
        return explicit
    return os.path.join(os.environ.get("DATA_DIR", "/data"), "cadence")


def _period(ts: float) -> str:
    """The ET trading date of ``ts`` — the period a marker belongs to."""
    return _dt.datetime.fromtimestamp(ts, _ET).strftime("%Y-%m-%d")


def _et_text(ts: float) -> str:
    return _dt.datetime.fromtimestamp(ts, _ET).strftime("%Y-%m-%d %H:%M ET")


def _commit() -> str:
    """The running build, so a marker can be tied to the code that wrote it (§4.7)."""
    for k in ("RAILWAY_GIT_COMMIT_SHA", "RAILWAY_DEPLOYMENT_ID", "GIT_COMMIT"):
        v = os.environ.get(k)
        if v:
            return v[:9]
    return "unknown"


def _write_atomic(path: str, data: dict) -> None:
    """``desk_session_audit._write_state``'s idiom: a temp file beside the target, then
    ``os.replace`` — a reader sees the old marker or the new one, never half of one."""
    d = os.path.dirname(path) or "."
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=os.path.basename(path), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _prune(root: str, now: float) -> None:
    """Delete this signal's period files older than ``RETAIN_DAYS``. Only files named
    like a period are ours; anything else in the directory is left alone."""
    floor = (_dt.datetime.fromtimestamp(now, _ET).date()
             - _dt.timedelta(days=RETAIN_DAYS)).isoformat()
    for name in os.listdir(root):
        m = _PERIOD_FILE.match(name)
        if m and m.group(1) < floor:
            try:
                os.unlink(os.path.join(root, name))
            except OSError:
                pass


def mark(signal: str, *, now: Optional[float] = None, base_dir: Optional[str] = None,
         contracts=None) -> bool:
    """Record that ``signal`` ran now. True on a written marker. ⛔ NEVER RAISES.

    :param now: epoch seconds; the wall clock when omitted (production only — every
        test injects it).
    :param base_dir: the marker root; ``marker_dir()`` when omitted.
    """
    try:
        if contract_for(signal, contracts) is None or not _SIGNAL_NAME.match(str(signal)):
            log.warning("[cadence] refused a heartbeat for %r: no contract names it, so "
                        "the roll-up could never read it", signal)
            return False
        ts = time.time() if now is None else float(now)
        root = os.path.join(base_dir or marker_dir(), signal)
        period = _period(ts)
        path = os.path.join(root, period + ".json")
        with _lock:
            prev = None
            if os.path.exists(path):
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        prev = json.load(f)
                except (OSError, ValueError):
                    prev = None          # a corrupt marker is rewritten, never trusted
            prev = prev if isinstance(prev, dict) else {}
            data = {
                "signal": signal,
                "period": period,
                "first_as_of": prev.get("first_as_of", ts),
                "as_of": ts,
                "as_of_et": _et_text(ts),
                "runs": int(prev.get("runs") or 0) + 1,
                "commit": _commit(),
            }
            _write_atomic(path, data)
            if not prev:
                _prune(root, ts)         # a new period: the one moment retention can move
        return True
    except Exception as e:                                   # noqa: BLE001
        log.warning("[cadence] heartbeat for %r not written: %s: %s",
                    signal, type(e).__name__, e)
        return False


def read_latest(signal: str, *, base_dir: Optional[str] = None
                ) -> tuple:
    """``(marker, error)`` for ``signal``'s newest period file.

    ``(None, None)`` — never reported. ``(None, "<reason>")`` — UNREADABLE.
    """
    root = os.path.join(base_dir or marker_dir(), signal)
    try:
        names = os.listdir(root)
    except FileNotFoundError:
        return None, None
    except OSError as e:
        return None, "%s: %s" % (type(e).__name__, e)
    periods = sorted(n for n in names if _PERIOD_FILE.match(n))
    if not periods:
        return None, None
    path = os.path.join(root, periods[-1])
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        float(data["as_of"])
    except Exception as e:                                   # noqa: BLE001
        return None, "%s: %s (%s)" % (type(e).__name__, e, periods[-1])
    return data, None


def _age_text(seconds: float) -> str:
    s = max(0, int(seconds))
    if s < 3600:
        return "%dm" % (s // 60)
    if s < 86400:
        return "%dh%02dm" % (s // 3600, (s % 3600) // 60)
    return "%dd%02dh" % (s // 86400, (s % 86400) // 3600)


def classify(contract: CadenceContract, marker: Optional[dict], error: Optional[str],
             now: float) -> dict:
    """PURE. One roster row: REPORTED / MISSING / UNREADABLE, with ``as_of`` always.

    ⛔ No environment, no disk, no clock — ``now`` is handed in.
    """
    row = {"signal": contract.signal, "period": contract.period,
           "max_silence_s": contract.max_silence_s, "status": None, "reason": None,
           "as_of": None, "as_of_et": None, "age_s": None, "runs_today": 0,
           "commit": None}
    if error:
        row.update(status=UNREADABLE, reason="marker could not be read: " + error)
        return row
    if marker is None:
        row.update(status=MISSING, reason="never reported")
        return row
    as_of = float(marker["as_of"])
    age = now - as_of
    row.update(as_of=as_of, as_of_et=_et_text(as_of), age_s=age,
               commit=marker.get("commit"),
               runs_today=int(marker.get("runs") or 0)
               if marker.get("period") == _period(now) else 0)
    if age > contract.max_silence_s:
        row.update(status=MISSING,
                   reason="silent for %s (contract: at most %s)"
                          % (_age_text(age), _age_text(contract.max_silence_s)))
    else:
        row["status"] = REPORTED
    return row


def build_rollup(now: float, *, base_dir: Optional[str] = None, contracts=None) -> dict:
    """Read every contracted signal's marker and classify it. ``missing`` lists every
    signal that is NOT reported — MISSING and UNREADABLE alike, by name."""
    roster = CONTRACTS if contracts is None else contracts
    rows = []
    for c in roster:
        marker, error = read_latest(c.signal, base_dir=base_dir)
        rows.append(classify(c, marker, error, now))
    return {"as_of": now, "as_of_et": _et_text(now), "rows": rows,
            "missing": [r["signal"] for r in rows if r["status"] != REPORTED]}


def format_rollup(report: dict) -> str:
    """ONE message for the whole roster — never one per signal. Missing names first."""
    rows = report.get("rows") or []
    missing = report.get("missing") or []
    lines = ["CADENCE ROLL-UP  %s  --  %d signal(s) registered, %d did not report"
             % (report.get("as_of_et"), len(rows), len(missing))]
    if not rows:
        lines.append("NO SIGNALS REGISTERED -- an empty roll-up vouches for nothing.")
    elif missing:
        lines.append("DID NOT REPORT: " + ", ".join(missing))
    else:
        lines.append("every registered signal reported inside its window")
    ordered = sorted(rows, key=lambda r: (r["status"] == REPORTED, r["signal"]))
    for r in ordered:
        if r["as_of_et"]:
            last = "last %s (%s ago)" % (r["as_of_et"], _age_text(r["age_s"]))
        else:
            last = "last reported: never"
        detail = [last, "%d run(s) today" % r["runs_today"], r["period"]]
        if r["reason"]:
            detail.insert(0, r["reason"])
        if r["commit"]:
            detail.append("commit %s" % r["commit"])
        lines.append("%-10s %s  |  %s" % (r["status"], r["signal"], "  |  ".join(detail)))
    lines.append(_ABSENCE_LINE)
    return "\n".join(lines)
