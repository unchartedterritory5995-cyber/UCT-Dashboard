"""Currentness: is the newest data UCT holds the newest data that SHOULD exist?

    evaluate(spec, facts, events, now, coverage_end=None) -> Verdict
        (iterable as (Currentness, reason, expected, next_release))

PURE: no I/O, no clock. `gather_facts` / `refresh_state` are the thin DB
wrappers the ingest pipeline and the service call.

THE RULES (design doc "Currentness", Phase 0 section 19)
  * HTTP 200 NEVER implies CURRENT. A fetch that succeeds but does not carry the
    expected period leaves the series CHECKING (then DELAYED).
  * An EVENT expects either a NEW period (CPI Oct 14 -> 2026-09) or a REVISION
    release of an existing one (GDP Sep 30 -> 2026Q2 third estimate, label
    '2026Q2/rev2'). A new-period event is satisfied when the period is held
    (validated rows are the only rows the store holds). A revision event is
    satisfied when the period is held AND the provider gave a POSITIVE signal
    after the scheduled time: a new vintage was written (value changed) at/after
    it, or a validated fetch at/after it carried a provider publication time
    (Last-Modified / stated timestamp) at/after it. Without a signal it stays
    CHECKING through the window, then becomes UNCONFIRMED (never CURRENT).
  * Daily series: the event for observation date d is released at a rule time
    on a later business day; the expected period is therefore "the previous
    federal business day's observation after the daily release time".

PRECEDENCE (first match wins)
  1 NOT_PRODUCTION      series not enabled / not production-eligible
  2 VALIDATION_FAILED   the most recent fetch outcome was a validation rejection
                        (last good data is kept and still served)
  3 UNINITIALIZED       no validated data yet (SOURCE_UNAVAILABLE if the source is failing)
  4 NO_EXPECTATION      no event for this series, calendar coverage expired with
                        no future event, a stale rule horizon, or the current
                        event is a HOLE (precision unknown) whose period is not held
  5 CURRENT             the current event is satisfied
  6 UNCONFIRMED         revision event past its window, period held, validated
                        fetch after the schedule, no positive signal
  7 SOURCE_UNAVAILABLE  provider failing (>= SOURCE_FAIL_THRESHOLD consecutive
                        failures, or quota exhausted) and the event unsatisfied
  8 DELAYED             an EARLIER event's new period is still missing past its own
                        window (a newer event opening does not reset the clock)
  9 CHECKING            inside [scheduled_at, window_end)
 10 DELAYED             past window_end (= scheduled + family grace)

GRACE (window_end - scheduled_at): BLS/BEA/Census/DOL/FHFA/Fed monthly+weekly/
NY Fed ESMS/MTS 60 min, EIA 90 min, daily families (H.15, NY Fed rates, RRP,
DTS, Debt to the Penny) ONE BUSINESS DAY. A date-only event's window is its
whole ET day plus the family grace.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import timedelta
from typing import Iterable, Optional

from . import calendar as cal
from . import licensing, timeutil
from .model import Currentness as C

log = logging.getLogger(__name__)

SOURCE_FAIL_THRESHOLD = 3
GRACE_DEFAULT_S = 3600
GRACE_S = {"eia": 5400}
# A rule calendar that stopped being refreshed must not keep a series CURRENT:
# with no future event and the last one older than this, NO_EXPECTATION.
MAX_GAP_DAYS = {"D": 6, "W": 12, "M": 50, "Q": 110, "A": 400}


# ─────────────────────────────── side tables (ops facts) ─────────────────────

_OPS_DDL = (
    """CREATE TABLE IF NOT EXISTS series_ops (
        series_id                  TEXT PRIMARY KEY,
        last_attempt_at            INTEGER,
        last_success_at            INTEGER,     -- last VALIDATED fetch (incl. 304 / unchanged)
        last_published_at          INTEGER,     -- provider publication time carried by that fetch
        consecutive_failures       INTEGER NOT NULL DEFAULT 0,
        last_failure_kind          TEXT,        -- source|validation|quota|empty
        last_failure_at            INTEGER,
        last_error                 TEXT,        -- REDACTED
        last_validation_failure_at INTEGER,
        blocked_until              INTEGER,     -- quota exhausted until (next ET midnight)
        last_reconcile_at          INTEGER,
        last_backfill_at           INTEGER,
        publish_pending_at         INTEGER,     -- rows written, publish hook not yet confirmed
        updated_at                 INTEGER
    )""",
    """CREATE TABLE IF NOT EXISTS provider_ops (
        provider             TEXT PRIMARY KEY,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        last_error           TEXT,              -- REDACTED
        last_error_at        INTEGER,
        last_success_at      INTEGER,
        backoff_until        INTEGER,
        updated_at           INTEGER
    )""",
    """CREATE TABLE IF NOT EXISTS provider_quota (
        provider TEXT NOT NULL,
        day      TEXT NOT NULL,                 -- ET date
        used     INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (provider, day)
    )""",
)
SERIES_OPS_FIELDS = ("last_attempt_at", "last_success_at", "last_published_at", "consecutive_failures",
                     "last_failure_kind", "last_failure_at", "last_error", "last_validation_failure_at",
                     "blocked_until", "last_reconcile_at", "last_backfill_at", "publish_pending_at")
PROVIDER_OPS_FIELDS = ("consecutive_failures", "last_error", "last_error_at", "last_success_at", "backoff_until")


def ensure_ops_schema(store) -> None:
    """Idempotent side tables (see RELEASE-SYSTEM.md 'Side tables')."""
    if getattr(store, "_econ_ops_ready", False):
        return
    for ddl in _OPS_DDL:
        store.conn.execute(ddl)
    cal.ensure_schema(store)
    try:
        store._econ_ops_ready = True
    except AttributeError:
        pass


def _upsert(store, table: str, key_col: str, key: str, allowed, fields: dict, now: Optional[int]) -> None:
    bad = set(fields) - set(allowed)
    if bad:
        raise ValueError(f"unknown {table} fields {sorted(bad)}")
    ensure_ops_schema(store)
    cols = list(fields)
    now = int(time.time()) if now is None else int(now)
    store.conn.execute(
        f"INSERT INTO {table}({key_col}, {', '.join(cols)}, updated_at) VALUES (?{', ?' * len(cols)}, ?)"
        f" ON CONFLICT({key_col}) DO UPDATE SET "
        + ", ".join(f"{c}=excluded.{c}" for c in cols) + (", " if cols else "") + "updated_at=excluded.updated_at",
        (key, *[fields[c] for c in cols], now))


def series_ops(store, series_id: str) -> dict:
    ensure_ops_schema(store)
    r = store._dicts("SELECT * FROM series_ops WHERE series_id=?", (series_id,))
    return r[0] if r else {"series_id": series_id, "consecutive_failures": 0}


def update_series_ops(store, series_id: str, now: Optional[int] = None, **fields) -> None:
    _upsert(store, "series_ops", "series_id", series_id, SERIES_OPS_FIELDS, fields, now)


def provider_ops(store, provider: str) -> dict:
    ensure_ops_schema(store)
    r = store._dicts("SELECT * FROM provider_ops WHERE provider=?", (provider,))
    return r[0] if r else {"provider": provider, "consecutive_failures": 0}


def update_provider_ops(store, provider: str, now: Optional[int] = None, **fields) -> None:
    _upsert(store, "provider_ops", "provider", provider, PROVIDER_OPS_FIELDS, fields, now)


def note_attempt(store, series_id: str, now: int) -> None:
    update_series_ops(store, series_id, now, last_attempt_at=now)


def note_success(store, series_id: str, now: int, *, published_at: Optional[int] = None) -> None:
    f = dict(last_success_at=now, consecutive_failures=0, last_failure_kind=None, blocked_until=None)
    if published_at is not None:
        f["last_published_at"] = int(published_at)
    update_series_ops(store, series_id, now, **f)


def note_failure(store, series_id: str, now: int, kind: str, error: str = "",
                 *, blocked_until: Optional[int] = None) -> None:
    from . import secrets
    cur = series_ops(store, series_id)
    f = dict(consecutive_failures=int(cur.get("consecutive_failures") or 0) + 1, last_failure_kind=kind,
             last_failure_at=now, last_error=secrets.redact(error)[:500] if error else None)
    if kind == "validation":
        f["last_validation_failure_at"] = now
    if blocked_until is not None:
        f["blocked_until"] = int(blocked_until)
    update_series_ops(store, series_id, now, **f)


# ─────────────────────────────── facts ───────────────────────────────────────

@dataclass
class Facts:
    enabled: bool = True
    latest_period: Optional[str] = None        # newest held period_start (validated rows only exist)
    latest_period_end: Optional[str] = None
    latest_available_at: Optional[int] = None  # first availability of the newest period
    last_change_at: Optional[int] = None       # newest ingested_at of any vintage (a value changed then)
    last_success_at: Optional[int] = None      # newest validated fetch
    last_published_at: Optional[int] = None    # provider publication time carried by that fetch
    last_attempt_at: Optional[int] = None
    consecutive_failures: int = 0
    last_failure_kind: Optional[str] = None
    last_validation_failure_at: Optional[int] = None
    blocked_until: Optional[int] = None
    last_error: Optional[str] = None


def gather_facts(store, spec, now: Optional[int] = None, *, lookup=None) -> Facts:
    """DB -> Facts for one series. `lookup(symbol) -> registry entry` is used for
    derived series (their fetch facts are the max over their inputs)."""
    ensure_ops_schema(store)
    sym = _g(spec, "symbol")
    raw = spec.raw if hasattr(spec, "raw") else spec
    enabled = _g(spec, "status") == "enabled" and licensing.production_eligible(raw)[0]
    lp, last_ing = store.conn.execute(
        "SELECT MAX(period_start), MAX(ingested_at) FROM observation WHERE series_id=?", (sym,)).fetchone()
    lpe = lav = None
    if lp is not None:
        lpe, lav = store.conn.execute(
            "SELECT MAX(period_end), MIN(available_at) FROM observation WHERE series_id=? AND period_start=?",
            (sym, lp)).fetchone()
    ops = series_ops(store, sym)
    f = Facts(enabled=enabled, latest_period=lp, latest_period_end=lpe, latest_available_at=lav,
              last_change_at=last_ing, last_success_at=ops.get("last_success_at"),
              last_published_at=ops.get("last_published_at"), last_attempt_at=ops.get("last_attempt_at"),
              consecutive_failures=int(ops.get("consecutive_failures") or 0),
              last_failure_kind=ops.get("last_failure_kind"),
              last_validation_failure_at=ops.get("last_validation_failure_at"),
              blocked_until=ops.get("blocked_until"), last_error=ops.get("last_error"))
    deriv = _g(spec, "derivation")
    if deriv:
        succ, pub = [], []
        for inp in deriv.get("inputs") or []:
            o = series_ops(store, inp)
            if o.get("last_success_at"):
                succ.append(o["last_success_at"])
            if o.get("last_published_at"):
                pub.append(o["last_published_at"])
        f.last_success_at = max(succ) if succ else f.last_success_at
        f.last_published_at = max(pub) if pub else f.last_published_at
    return f


# ─────────────────────────────── windows ─────────────────────────────────────

def family(calendar_key: str) -> str:
    return (calendar_key or "").split(":", 1)[0]


def is_daily(calendar_key: str, frequency: Optional[str] = None) -> bool:
    return calendar_key in cal.DAILY_KEYS or str(frequency or "").upper() == "D"


def grace_s(calendar_key: str) -> int:
    return GRACE_S.get(family(calendar_key), GRACE_DEFAULT_S)


def window_end(event, calendar_key: str, frequency: Optional[str] = None) -> int:
    """When an unsatisfied event turns DELAYED."""
    ev = cal.Event.from_row(event)
    d = timeutil.as_date(ev.sched_date)
    if is_daily(calendar_key, frequency):
        nxt = timeutil.next_business_day(d)
        return timeutil.et_to_utc(nxt, ev.sched_time if ev.has_time else "00:00") + (
            0 if ev.has_time else grace_s(calendar_key))
    if not ev.has_time:
        return timeutil.et_to_utc(d + timedelta(days=1), "00:00") + grace_s(calendar_key)
    return ev.scheduled_at + grace_s(calendar_key)


# ─────────────────────────────── verdict ─────────────────────────────────────

@dataclass
class Verdict:
    state: C
    reason: str
    expected: Optional[cal.Expected] = None
    next_release: Optional[dict] = None
    event: Optional[cal.Event] = None
    next_event: Optional[cal.Event] = None
    window_end: Optional[int] = None

    def __iter__(self):                      # (state, reason, expected, next_release)
        return iter((self.state, self.reason, self.expected, self.next_release))


def _g(obj, key, default=None):
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _fmt_ev(ev: cal.Event) -> str:
    t = f" {ev.sched_time} ET" if ev.has_time else ""
    return f"{ev.calendar_key} {ev.sched_date}{t} [{ev.precision}/{ev.source}]"


def event_satisfied(exp: cal.Expected, ev: cal.Event, facts: Facts) -> tuple[bool, str]:
    """(satisfied, why-not). New period: held. Revision: held + positive signal after schedule."""
    if facts.latest_period is None or facts.latest_period < exp.period_start:
        return False, f"expected period {exp.label} not held (latest {facts.latest_period or 'none'})"
    if exp.kind == "new":
        return True, ""
    s = ev.scheduled_at
    if facts.last_change_at is not None and facts.last_change_at >= s:
        return True, ""
    if (facts.last_published_at is not None and facts.last_published_at >= s
            and (facts.last_success_at or 0) >= s):
        return True, ""
    return False, f"revision release {exp.label}: no changed value or provider publication time since schedule"


def evaluate(spec, facts: Facts, events: Iterable, now: int, *, coverage_end: Optional[str] = None) -> Verdict:
    now = int(now)
    if not facts.enabled:
        return Verdict(C.NOT_PRODUCTION, "series not enabled for production")
    key = (_g(spec, "release") or {}).get("calendar_key") or ""
    freq = str(_g(spec, "frequency") or "").upper()
    evs = []
    for e in events or ():
        ev = cal.Event.from_row(e)
        exp = cal.expected_period(spec, ev)
        if exp is not None:
            evs.append((ev.scheduled_at, ev, exp))
    evs.sort(key=lambda x: (x[0], x[1].period_label))
    past = [x for x in evs if x[0] <= now]
    fut = [x for x in evs if x[0] > now]
    E = past[-1] if past else None
    N = fut[0] if fut else None
    nxt = N[1].public() if N else None
    failing = facts.consecutive_failures >= SOURCE_FAIL_THRESHOLD or (
        facts.blocked_until is not None and facts.blocked_until > now)

    if facts.last_validation_failure_at is not None and \
            facts.last_validation_failure_at > (facts.last_success_at or 0):
        return Verdict(C.VALIDATION_FAILED, "latest provider payload failed validation; last good data kept",
                       E[2] if E else None, nxt, E[1] if E else None, N[1] if N else None)
    if facts.latest_period is None:
        if failing:
            return Verdict(C.SOURCE_UNAVAILABLE, f"no data yet; source failing ({facts.last_failure_kind})",
                           E[2] if E else None, nxt)
        return Verdict(C.UNINITIALIZED, "no validated data yet", E[2] if E else None, nxt)
    if E is None:
        return Verdict(C.NO_EXPECTATION, f"no calendar event known for {key or 'this series'}", None, nxt,
                       next_event=N[1] if N else None)
    s, ev, exp = E
    today = timeutil.et_date(now).isoformat()
    if N is None and coverage_end and today > coverage_end:
        return Verdict(C.NO_EXPECTATION, f"calendar {key} coverage ended {coverage_end} and no future event is known",
                       exp, None, ev)
    gap = MAX_GAP_DAYS.get(freq)
    if N is None and not coverage_end and gap and now - s > gap * 86400:
        return Verdict(C.NO_EXPECTATION, f"calendar {key} has no event after {ev.sched_date} (horizon stale)",
                       exp, None, ev)
    ok, why = event_satisfied(exp, ev, facts)
    wend = window_end(ev, key, freq)
    if ev.is_hole:
        if ok:
            return Verdict(C.CURRENT, f"period {exp.label} held (its release date was unknown)", exp, nxt, ev,
                           N[1] if N else None, wend)
        return Verdict(C.NO_EXPECTATION, f"release of {exp.label} has no known date ({_fmt_ev(ev)}); "
                       "UCT does not invent one", exp, nxt, ev, N[1] if N else None, wend)
    if ok:
        return Verdict(C.CURRENT, f"{exp.label} held; event {_fmt_ev(ev)}", exp, nxt, ev,
                       N[1] if N else None, wend)
    if exp.kind == "revision" and now >= wend and facts.latest_period >= exp.period_start \
            and (facts.last_success_at or 0) >= s:
        return Verdict(C.UNCONFIRMED, why + "; validated fetch after schedule, provider gave no signal",
                       exp, nxt, ev, N[1] if N else None, wend)
    if failing:
        return Verdict(C.SOURCE_UNAVAILABLE, f"{why}; source failing ({facts.last_failure_kind}, "
                       f"{facts.consecutive_failures} consecutive)", exp, nxt, ev, N[1] if N else None, wend)
    overdue = [(pev, pexp) for _s, pev, pexp in past[:-1]
               if not pev.is_hole and pexp.kind == "new" and pexp.period_start > facts.latest_period
               and now >= window_end(pev, key, freq)]
    if overdue:                  # an EARLIER release is still missing past its own window
        pev, pexp = overdue[0]
        return Verdict(C.DELAYED, f"{why}; earlier release {pexp.label} ({_fmt_ev(pev)}) still missing past "
                       "its window", exp, nxt, ev, N[1] if N else None, wend)
    if now < wend:
        return Verdict(C.CHECKING, f"{why}; window open for {_fmt_ev(ev)}", exp, nxt, ev,
                       N[1] if N else None, wend)
    return Verdict(C.DELAYED, f"{why}; past window+grace of {_fmt_ev(ev)}", exp, nxt, ev,
                   N[1] if N else None, wend)


# ─────────────────────────────── DB wrapper ──────────────────────────────────

def refresh_state(store, spec, now: int, *, events=None, lookup=None) -> Verdict:
    """gather -> evaluate -> put_state. Returns the Verdict."""
    sym = _g(spec, "symbol")
    key = (_g(spec, "release") or {}).get("calendar_key") or ""
    if events is None:
        events = cal.load_events(store, key, now) if key else []
    facts = gather_facts(store, spec, now, lookup=lookup)
    v = evaluate(spec, facts, events, now, coverage_end=cal.coverage_end(store, key) if key else None)
    before = (store.get_state(sym) or {}).get("state")
    if v.state.value != before:
        # one line per currentness TRANSITION, wherever it happens (service tick or ingest);
        # dates/states/labels only, never a value
        log.info("econ.currentness: %s %s -> %s (%s)", sym, before, v.state.value, v.reason[:300])
    store.put_state(sym, state=v.state.value, latest_period=facts.latest_period,
                    latest_available_at=facts.latest_available_at,
                    expected_period=v.expected.period_start if v.expected else None,
                    expected_by=v.window_end,
                    next_event_id=v.next_event.event_id if v.next_event else None,
                    last_success_at=facts.last_success_at, last_attempt_at=facts.last_attempt_at,
                    failures=facts.consecutive_failures, reason=v.reason[:500])
    return v
