---
id: GATE-S7-EVENT-PROXIMITY
title: S7 trigger type 2 — `event-proximity` pre-implementation gate
role: the approval packet for the SECOND absorption. Nothing builds past the scope on the approval line.
status: ✅ APPROVED 2026-09-12 — line 1 CP1–2, line 2 CP3. CP4 / flip each need a new line.
date: 2026-09-12
measured_against: origin/master @ a0c2bfee4
---

# ✅ APPROVED — CHECKPOINTS 1 AND 2. Dark, harness-armed predicates only.

## ⛔ APPROVAL

```
APPROVED BY:      Patrick (owner), via Claude Chat middleman
APPROVED ON:      2026-09-12
APPROVED AT SHA:  76529e75b   (this packet as it stood at approval)
SCOPE APPROVED:   CP1–CP2 ONLY.
                  CP1 = registration + schema.
                  CP2 = dark evaluator + forward-only harness against
                        HARNESS-ARMED predicates only.
                  No delivery. No projection of member rows. No legacy change.

                  ⛔ CP3 (projecting real member rows) NEEDS A NEW LINE.
```

---

## ⛔ APPROVAL — LINE 2 (CP3). The CP1–2 block above stands as granted.

```
APPROVED BY:      Patrick (owner), via Claude Chat middleman
APPROVED ON:      2026-09-12
APPROVED AT SHA:  4f522011c   (git hash-object of this packet at a31f02374, the
                  commit that committed line 1 — see the note below)
SCOPE APPROVED:   CP3 — read-only projection of the legacy cohort for ADMIN-ROLE
                  accounts only; CALENDAR RE-READ PER TICK with the reschedule
                  reset; dark evaluator writes alert_fires + receipts; no
                  delivery import; a flag-gated sweep beside the price-level one
                  (ALERT_TAXONOMY_EVENT_PROXIMITY_DARK_ENABLED, default OFF) with
                  the "what calls this" rail; no legacy change.

                  ⛔ CP4 (all members) and the FLIP each need a new line.
```

✅ **F-GATE-1 — CLOSED 2026-09-13. LINE 2 RE-PINNED; LINE 1 UNTOUCHED.**

**What was wrong.** Both approval blocks carried the identical value ~~`76529e75b`~~, and that
value is a **COMMIT SHA** — the commit that CREATED this packet. Line 1 was stamped with it in
`a31f02374`; line 2 was added afterwards in `09785ac95` and **copied the same value**. So line 2
pinned a commit whose tree contained **only line 1** — a state in which line 2 did not exist. It
distinguished nothing from line 1 and pinned nothing about what was approved at line 2.

**What line 2 now says.** `4f522011c` — `git hash-object` of **this packet as it stood at
`a31f02374`**, the commit that committed line 1. That is the state the owner was looking at when
line 2's scope was granted, and it is the state line 2 should always have named.

```
git rev-parse a31f02374:docs/terminal-research/12-decisions/gates/s7-event-proximity-pre-implementation-gate.md
  -> 4f522011c25992fa0f9e0994c0bcd154d9631bd4
```

⛔ **DERIVED FROM HISTORY, NOT RE-SIGNED AT TODAY'S STATE.** Re-hashing the packet as it stands now
would pin bytes the owner never read — including this very note — which is the failure mode the
format exists to prevent. The value is recomputable by anyone, from the repository, forever.

⛔ **LINE 1 IS UNTOUCHED**, deliberately. Its `76529e75b` is the commit-SHA convention applied at
its own signing, and it does pin real bytes (`git show 76529e75b:<this file>`). Changing it would
destroy a historical value to satisfy a convention adopted later.

⚠️ **THE OTHER FIVE COMMIT-SHA LINES STAY AS RECORDED** — `s7-price-level` ×2,
`intelligence-layer` ×2, and line 1 here. They pin bytes; only this one pinned the wrong state.
**The convention going forward is stated once, in `PROGRAM_STATUS.md`'s gate rule.**

⚰️ The original finding text, kept because the reasoning is the record:
Both approval blocks in this packet carry the identical value `76529e75b`, and that value is a
**COMMIT SHA** (`git cat-file -t` says `commit`), not a `git hash-object` content fingerprint.

⭐ A commit SHA is a *workable older convention* — it pins the bytes via `git show 76529e75b:<this
file>`. **The defect is that BOTH lines point at the same commit**, and that commit contained only
the FIRST block: line 2 was added afterwards in `09785ac95`. So line 2's pin names a state in which
line 2 did not exist, and it distinguishes nothing from line 1.

⛔ **NOT re-signed in this pass** — this verification is read-only and re-deriving a value would be
a new signature. Registered as **F-GATE-1**. Six of the tree's 33 approval lines use the commit-SHA
convention (this packet ×2, `s7-price-level` ×2, `intelligence-layer` ×2); the other 27 are content
fingerprints. The mixture is now recorded rather than latent.

### ⛔⛔ THE CP3 RULING — WHO REFRESHES THE EVENT DATE

CP2's mirror rail exposed that the **legacy path re-reads the calendar every run**
while a stored `event_date` is only a snapshot. Left alone, a reschedule makes the two
rules describe different worlds and the dark week would measure *that* instead of the rule
difference it exists to size.

**The ruling:** the projection re-reads the calendar every tick, same as legacy. The stored
`event_date` is an **AUDIT SNAPSHOT, not the truth**. When the calendar differs from the
snapshot, treat it as a reschedule — **reset that predicate's comparison clock, discard the
pre-reschedule span into `not_comparable`, and update the snapshot with a version bump.**

⭐ **The two worlds then converge BY CONSTRUCTION**, leaving the dark period to measure only
genuine rule disagreement. A harness whose headline number is dominated by a data-freshness
artefact is measuring its own plumbing.

⛔ The calendar is read through **`calendar_alerts._get_reporters_for_date`** — the legacy
module's own function, never a reimplementation. A second reader would answer differently
the day one of them changed provider fallbacks, and the comparison would be measuring the
two READERS instead of the two rules.

## 1. What this absorbs — read from the code, not from the type's name

**`api/services/calendar_alerts.py`**, whose whole alert surface is one function:

| | |
|---|---|
| entry point | `run_prereport_alerts(market_date=None) -> int` |
| gate | `CALENDAR_ALERTS_ENABLED=1` (default OFF) |
| schedule | two APScheduler slots — **07:00 ET (today's reporters)** and **18:00 ET (tomorrow's)** |
| dedup | `calendar_alerts_fired`, PK `(user_id, ticker, market_date)`, in its **own** database `/data/calendar_alerts.db` |
| cohort | every user's "My Stocks" set, via `_collect_all_users_ticker_sets()` |
| delivery | `watchlist_alert_service.deliver_alert_payload` — in-app + email + Discord |

## 2. ⛔ F-S7-EP-1 — THE SHAPES THE LEGACY CODE ACTUALLY SUPPORTS, AND THEY ARE NARROWER THAN THE NAME

This is the F-S7-2 reading for this type, and the finding is the same in kind: **the name promises
more than the thing being absorbed delivers.**

**1. ONE event kind: EARNINGS.** `_get_reporters_for_date` reads the earnings calendar and nothing
else. There is no economic-event, IPO or dividend path anywhere in `run_prereport_alerts` — the
notification title is literally `📅 Earnings Today: $TICKER`. The app *has* economic, IPO and
dividend calendars; **this alert path has never touched them.**

**2. DAY GRANULARITY, NOT HOURS.** `market_date` is a `YYYY-MM-DD` string and the dedup PK is per
market date. There is no "two hours before the bell" concept anywhere. The only "proximity" that
exists is *which of the two daily slots fired* — today's, or tomorrow's.

**3. NO SESSION (BMO/AMC) IN THE ALERT**, though the calendar carries it elsewhere.

**4. ⚠️ THE 3-DAY WINDOW IN THIS FILE IS A DIFFERENT SUBSYSTEM'S.**
`EARNINGS_PROXIMITY_DEFAULT_DAYS = 3` and `collect_earnings_window()` live in this module and are
consumed by **`awareness/engine.py`**, not by `run_prereport_alerts`. ⛔ A reading that took the
3-day constant for the alert's window would build a type that fires three days early and conclude
the legacy path was "missing" alerts it was never designed to send. **The constant is in the file;
the behaviour is not.**

### The ruling this asks for

⭐ **Pin the richer schema at CP1 anyway** — `event_kind ∈ {earnings, economic, ipo, dividend}` and
a granularity that admits both days and hours — **even though only `earnings`/day is populated.**
Same call F-S7-2 made for `trendline`, for the same reason: a schema that admits only what exists
today teaches the next engineer that the narrow shape is the whole shape, and widening a live
schema is far more expensive than pinning an unpopulated field.

⛔ **What this does NOT authorize:** firing on any kind other than `earnings`, or at any granularity
finer than the legacy day. CP1–CP2 pin the schema and compare *the behaviour that exists*. Widening
the behaviour is a separate line.

## 3. The absorption default applies unchanged (§4a of the completion plan)

Legacy stays live. The new type runs dark. The flip and the legacy switch-off happen in the **same**
PR, under their own approval line.

## 4. CP1 — registration + schema

Registers `event-proximity` with `register_trigger_type()`. Both the populated and the unpopulated
shapes pinned. **No evaluator. No delivery. No read of `calendar_alerts_fired`. No scheduler entry.**
Legacy byte-identical.

## 5. CP2 — dark evaluator + forward-only harness

Evaluates **harness-armed predicates only** — no projection of member "My Stocks" sets; that is CP3
and needs its own line. Writes `alert_fires` + receipts. Forward-only comparison per F-S7-3, with
the anchor-equivalent reset: **a change to the predicate's event identity (ticker or date) resets
the clock and discards the pre-change span into `not_comparable`.**

## 6. ⛔ THE §2a CHECKLIST, ANSWERED IN WRITING

**1. Shapes pinned at registration?** Yes — §2, including three event kinds nothing populates.

**2. Forward-only comparison + report + non-vacuity control?** Yes, at CP2. The report is the
price-level report's sibling and must print `NO DATA` rather than four zeroes.

**3. ⛔ WHAT CALLS THE EVALUATOR, AND WHICH TEST FAILS IF THAT WIRE IS CUT?**

At **CP2: nothing calls it, and that is correct and deliberate** — the harness arms its own
predicates and drives the evaluator directly, so the evaluator's caller *is* the test. The wire
question becomes load-bearing at **CP3**, when the type must run against real member data on a
schedule.

⭐ **Recorded here, at CP1, rather than discovered at CP3** — because that is exactly the order in
which `price-level` got it wrong. CP3's checklist line is pre-written:

> *A flag-gated scheduler entry (`ALERT_TAXONOMY_EVENT_PROXIMITY_DARK_ENABLED`, default OFF) whose
> job body calls the sweep, asserted by a test that reads `api/main.py` for the `add_job` id, the
> flag literal and the sweep call — a test that fails when the wire is cut and cannot be satisfied
> by any test that calls the evaluator itself.*

**4. Liveness stamp?** Required at CP3 with the scheduler entry, not at CP2 (nothing ticks yet).

## 7. What CP3 will need from the owner

A cohort ruling. `price-level` chose **admin-role only**, gated on the existing role check. This
type's legacy cohort is *every user's My Stocks*, which is materially wider, and its delivery is
email + Discord. The same admin-first staging is the obvious default — but it is the owner's line
to write, not this packet's to assume.
