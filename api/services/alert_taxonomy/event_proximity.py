"""GATE-S7-EVENT-PROXIMITY — S7 trigger type 2, the SECOND absorption.

⛔ Approved for CHECKPOINTS 1–2 ONLY (owner, 2026-09-12, packet `76529e75b`).
CP1 registers the type and pins the schema. CP2 adds a dark evaluator and a
forward-only harness over HARNESS-ARMED predicates. **No delivery. No projection
of member rows. No legacy change.** CP3 needs a new approval line.

──────────────────────────────────────────────────────────────────────────────
WHAT THIS ABSORBS — `api/services/calendar_alerts.py`
──────────────────────────────────────────────────────────────────────────────

One function: `run_prereport_alerts(market_date)`, gated on
`CALENDAR_ALERTS_ENABLED`, scheduled at **07:00 ET (today's reporters)** and
**18:00 ET (tomorrow's)**, deduped per `(user_id, ticker, market_date)` in its own
`/data/calendar_alerts.db`, delivering through `deliver_alert_payload`.

──────────────────────────────────────────────────────────────────────────────
⛔ F-S7-EP-1 — THE LEGACY SHAPES ARE NARROWER THAN THIS TYPE'S NAME
──────────────────────────────────────────────────────────────────────────────

Read from the legacy code, not from the name:

1. **ONE event kind: EARNINGS.** `_get_reporters_for_date` reads the earnings
   calendar and nothing else; the notification title is literally
   `📅 Earnings Today: $TICKER`. The app has economic, IPO and dividend
   calendars — **this alert path has never touched them.**
2. **DAY GRANULARITY.** `market_date` is a `YYYY-MM-DD` string and the dedup key
   is per market date. There is no "two hours before the bell" anywhere. The only
   proximity that exists is *which of the two daily slots fired*.
3. **NO SESSION (BMO/AMC)** in the alert, though the calendar carries it.
4. ⚠️ **THE 3-DAY WINDOW IN THAT FILE BELONGS TO A DIFFERENT SUBSYSTEM.**
   `EARNINGS_PROXIMITY_DEFAULT_DAYS = 3` and `collect_earnings_window()` live in
   `calendar_alerts.py` and are consumed by **`awareness/engine.py`**, not by
   `run_prereport_alerts`. ⛔ A reading that took the 3 for this alert's window
   would build a type that fires three days early and conclude the legacy path
   was "missing" alerts it was never designed to send. **The constant is in the
   file; the behaviour is not.**

⭐ **The schema below pins the WIDER set anyway** — four event kinds, and a
granularity that admits hours as well as days — exactly the call F-S7-2 made for
`trendline`. A schema that admits only what exists today teaches the next
engineer that the narrow shape is the whole shape, and widening a live schema
costs far more than pinning an unpopulated field.

⛔ **What that does NOT authorize:** firing on any kind other than `earnings`, or
at any granularity finer than the legacy day. CP1–CP2 pin the schema and compare
*the behaviour that exists*.

──────────────────────────────────────────────────────────────────────────────
⛔ NO `replay_fn` — the same refusal as `price-level`, for a different reason
──────────────────────────────────────────────────────────────────────────────

A calendar date MOVES. A company reschedules, a provider corrects a date, and the
legacy row carries no record of what the date was when the alert armed. Replaying
"would this have fired on Tuesday" against today's calendar answers a question
about today's data, not about Tuesday — so the comparison is FORWARD-ONLY, and a
date change **resets the clock** exactly as an anchor move does for a trendline.
"""
from __future__ import annotations

import time as _time
from datetime import date as _date
from typing import Any, Optional

from api.services.alert_taxonomy import predicates as _predicates
from api.services.alert_taxonomy import receipts as _receipts
from api.services.alert_taxonomy import registry as _registry

TYPE_ID = "event-proximity"

# ── the four kinds. Only `earnings` is populated by the legacy path today. ────
EARNINGS = "earnings"
ECONOMIC = "economic"
IPO = "ipo"
DIVIDEND = "dividend"
EVENT_KINDS = (EARNINGS, ECONOMIC, IPO, DIVIDEND)

# ── granularity. Only `day` is reachable from the legacy behaviour today. ─────
DAY = "day"
HOUR = "hour"
GRANULARITIES = (DAY, HOUR)

PARAMS_SCHEMA = {
    "event_kind": "string -- one of 'earnings' | 'economic' | 'ipo' | 'dividend'. "
                  "⛔ ONLY 'earnings' is produced by the absorbed legacy path "
                  "(calendar_alerts.run_prereport_alerts); the other three are "
                  "pinned at registration so the schema does not have to widen "
                  "later, and firing on them is NOT authorized by CP1-CP2",

    "entity_ref": "string -- the ticker for earnings/ipo/dividend, or the release "
                  "identifier for an economic event. The thing the member is "
                  "watching, and the dedup identity the legacy path keys on",

    "event_date": "string -- 'YYYY-MM-DD', the session the event falls on. This is "
                  "the legacy path's whole notion of WHEN: market_date is a date "
                  "string and its dedup PK is per date",

    "granularity": "string -- 'day' | 'hour'. ⛔ The legacy path is DAY-ONLY; "
                   "'hour' is pinned unpopulated. A predicate declaring 'hour' "
                   "without lead_hours is malformed",

    "lead_days": "integer | null -- fire when the event is this many days out. The "
                 "legacy path expresses 0 (today's reporters, 07:00 ET) and 1 "
                 "(tomorrow's, 18:00 ET) and nothing else. ⚠️ NOT the 3 from "
                 "calendar_alerts.EARNINGS_PROXIMITY_DEFAULT_DAYS -- that constant "
                 "is read by awareness/engine.py, never by the alert path",

    "lead_hours": "integer | null -- REQUIRED when granularity == 'hour', ignored "
                  "otherwise. Unreachable from the legacy behaviour; pinned so the "
                  "shape exists before anything needs it",

    "session": "string | null -- 'bmo' | 'amc' | null. The calendar carries it; the "
               "legacy ALERT does not use it. Carried so the condition is "
               "DETECTABLE rather than invisible, the same reason price-level "
               "carries drawing_id",
}

# ⛔ NO `replay_fn`. A calendar date moves, and the legacy row keeps no record of
# what it was when the alert armed -- see the module docstring.


def register(*, db_path: str | None = None) -> None:
    """Idempotent -- call at process start.

    ⛔ CHECKPOINT 1 DECLARES THE TYPE AND NOTHING CALLS THIS YET, and that is
    deliberate rather than forgotten. §2a item 3 of the completion plan requires
    every type to answer *"what CALLS this evaluator, and which test fails if
    that wire is cut"* — and at CP1-CP2 the honest answer is **the harness does**,
    because the harness arms its own predicates and drives the evaluator
    directly. The wire question becomes load-bearing at CP3, and its rail is
    pre-written in the gate packet so it is not rediscovered the way price-level
    rediscovered it.
    """
    _registry.register_trigger_type(TYPE_ID, PARAMS_SCHEMA, module=__name__, db_path=db_path)


# ─────────────────────────────────────────────────────────────────────────────
# CHECKPOINT 2 — the dark evaluator
# ─────────────────────────────────────────────────────────────────────────────

#: The legacy path's two slots, as LEAD DAYS. `run_prereport_alerts` fires for
#: today's reporters at 07:00 ET and tomorrow's at 18:00 ET, and expresses
#: nothing else. ⛔ NOT `EARNINGS_PROXIMITY_DEFAULT_DAYS` — see F-S7-EP-1.
LEGACY_LEAD_DAYS = (0, 1)


def _as_date(value: Any) -> Optional[_date]:
    """`YYYY-MM-DD` -> date, or None. ⛔ None is a REFUSAL, never a default:
    a malformed date must make the predicate un-evaluable, not make it fire
    against today."""
    if isinstance(value, _date):
        return value
    try:
        return _date.fromisoformat(str(value).strip()[:10])
    except (ValueError, TypeError, AttributeError):
        return None


def days_until(params: dict[str, Any], today: _date) -> Optional[int]:
    """Whole days from `today` to the predicate's event date.

    ⭐ Negative is meaningful and is NOT clamped: an event that has already
    happened is a different state from one due today, and collapsing them would
    make a stale predicate look permanently armed.
    """
    ev = _as_date(params.get("event_date"))
    if ev is None:
        return None
    return (ev - today).days


def would_fire(params: dict[str, Any], today: _date) -> bool:
    """The DARK rule: does this predicate's event fall on its lead day?

    ⛔ THIS IS DELIBERATELY THE LEGACY RULE, NOT AN IMPROVED ONE. CP1-CP2 compare
    *the behaviour that exists*; the whole point of a dark period is to measure
    the migration, and a rule that "fixes" something while migrating measures the
    fix instead.

    So: earnings only, day granularity, lead days restricted to what the legacy
    slots express. A predicate declaring a kind or granularity the legacy path
    cannot produce evaluates to False rather than raising — those shapes are
    pinned in the schema, not authorized to fire (gate packet §2).
    """
    if params.get("event_kind") != EARNINGS:
        return False
    if (params.get("granularity") or DAY) != DAY:
        return False
    lead = params.get("lead_days")
    if lead is None or int(lead) not in LEGACY_LEAD_DAYS:
        return False
    d = days_until(params, today)
    return d is not None and d == int(lead)


def event_fingerprint(params: dict[str, Any]) -> tuple:
    """What a change to the predicate's EVENT IDENTITY looks like.

    ⛔ A calendar date moves — a company reschedules, a provider corrects — and
    when it does, the pre-change span is NOT COMPARABLE. This is the
    event-proximity analogue of `price_level_projection._anchor_fingerprint`, and
    it is detected the same way: BY OBSERVATION, comparing what the evaluator
    reads now against what the span recorded. No hook in the legacy path, which
    must stay byte-identical.
    """
    return (params.get("event_kind"), params.get("entity_ref"),
            params.get("event_date"), params.get("granularity"),
            params.get("lead_days"))


def evaluate(*, today: _date, predicate_ids: list[str],
             db_path: str | None = None,
             now: Optional[float] = None) -> dict[str, Any]:
    """One DARK tick over HARNESS-ARMED predicates only.

    ⛔ `predicate_ids` is REQUIRED and has no "all" mode. CP2's approval is
    explicit that member rows are not projected — that is CP3 — and a default
    that swept everything would make the restriction a matter of call-site
    discipline rather than of the signature.

    Writes `alert_fires` + receipts. Imports no delivery path.
    """
    now = _time.time() if now is None else now
    fired, skipped = {}, {}
    for pid in predicate_ids:
        row = _predicates.get_predicate(pid, db_path=db_path)
        if not row:
            skipped[pid] = "unknown predicate"
            continue
        params = row.get("params") or {}
        if not would_fire(params, today):
            continue
        key = "ep:%s:%s:%s" % (params.get("entity_ref"), params.get("event_date"),
                               params.get("lead_days"))
        fid = _receipts.record_fire(
            predicate_id=pid, trigger_type=TYPE_ID, user_id=row.get("user_id"),
            entity_ref=params.get("entity_ref"), fire_key=key,
            detail={"event_kind": params.get("event_kind"),
                    "event_date": params.get("event_date"),
                    "lead_days": params.get("lead_days"),
                    "session": params.get("session"), "dark": True},
            source_data_class="calendar", freshness_class="end_of_day",
            as_of=now, db_path=db_path)
        # ⭐ `None` means the fire_key was already recorded. That is the legacy
        # path's own dedup contract (its PK is (user, ticker, market_date)), so a
        # repeat tick on the same day is a NO-OP here too, by construction.
        fired[pid] = fid
    return {"evaluated": len(predicate_ids), "fired": fired, "skipped": skipped,
            "at": now, "today": today.isoformat()}
