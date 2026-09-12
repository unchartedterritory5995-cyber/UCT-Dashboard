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
