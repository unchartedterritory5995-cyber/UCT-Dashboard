---
id: PRD-S7-ALERTS
title: S7 — Alerts & Monitoring — Product Requirements Document
role: Phase 3 deliverable — functional specification for a LOCKED system (design already committed; this document specifies it precisely enough to implement)
phase: 3
group: product-strategy
category: prd
scope: >
  S7 "Alerts & Monitoring" exactly as bounded in product-architecture.md §5-B.6 and its system
  block (Part C §5, "S7 — Alerts & Monitoring"). This PRD restates that boundary — it does not
  redesign it (ARCHITECTURAL_DECISION_REGISTER.md D7 is LOCKED; PHASE_2_INTEGRATION_SYNTHESIS.md
  §8 names S7 as one of four systems Phase 3 can specify with no further owner input). It adds
  precisely what a PRD adds and an architecture block does not: concrete user stories, the
  existing→canonical trigger-type mapping, interaction behavior, state handling, and testable
  acceptance criteria — specification, not implementation.
status: draft — Phase 3 PRD, awaiting review
date: 2026-09-02
depends_on_locked: D3 (Entity Master), D6 (AI Provenance Component), D4 (Provider Abstraction) — all LOCKED per ARCHITECTURAL_DECISION_REGISTER.md
depends_on_open: D13 (regime-classifier authority) — closed for S7's purposes in §6.3 below, using the Phase 3 validation finding; D5/D9 (licensing posture / two-audience decisiveness) — NOT closed, carried as owner-bound in §16 and §22
---

# S7 — Alerts & Monitoring: Product Requirements Document

## 0. How to read this document

This PRD specifies **S7 — Alerts & Monitoring**, one of four systems the Architectural Decision
Register marks **LOCKED** (D7: "one trigger taxonomy over the existing shared delivery seam...
no counter-evidence found"). LOCKED means the *architecture* is settled, not that implementation
requirements are self-evident from a system block. This document supplies those requirements.

**What this document restates, and does not redesign.** Section 5 (System Boundary) is a verbatim
restatement of `product-architecture.md`'s S7 block, the boundary matrix row, and the reversibility
ledger — per this task's instruction, S7's design is not re-litigated here. Everything from §6
onward (the trigger taxonomy detail, workflows, user stories, states, acceptance criteria) is new
PRD-level specification built *on top of* that fixed boundary.

**North Star traceability.** Every requirement in this document traces back through the chain in
§1 to the program's own north star: alerts are named explicitly in the directional capability list
("watchlists, **alerts**, portfolio/risk"), and the underlying need — a desk and a membership that
each run multiple independently-strong tools and need one trustworthy way to be told when something
specific happened — is the same "eleven good tools, not yet one instrument" gap the whole program
exists to close (READINESS_REVIEW_DAY1.md §6).

**Anti-drift discipline applied to this document specifically.** This PRD does not invent a new
alert *type* the research does not evidence (no order-triggered alerts — GOVERNING_PRINCIPLES §13
excludes execution/OMS entirely), does not add a "smarter" AI alerting layer beyond what K7/K8
already do, and does not resolve the two genuinely owner-bound items that touch this system (D5
member-facing licensing, D9 decisiveness posture) — both are carried forward as open, exactly as
the reversibility ledger already designs for.

---

## 1. Required traceability chain

| Step | Content |
|---|---|
| **Original user/product need** | A desk trader and a paid member each run several independently-strong UCT tools (price/line alerts on watchlists, indicator conditions on charts, calendar pre-report reminders, catalyst watchlist matches, a background "awareness" watch for stops/regime/earnings) and have no single trustworthy answer to "did anything happen, and can I tell whether the system checked and found nothing versus the system silently failed to check at all." |
| **Target UCT Terminal workflow** | Information Architecture's "Alert → investigation" chain (`information-architecture.md` §12.4): the alert arrives in one inbox on every channel it was routed to → the alert *is* an address (click loads the entity with the firing event) → land on the right lens at the right time → contrast against what else fired and what the desk said → decide and re-arm (suspend, not only delete). Also the "Arm" step inside three other chains: §12.1 step 6 (`!` alert at price), §12.3 step 5 (pre-report / keyword / expected-move alerts), §9.1 (the chart's act-at-price gesture). |
| **Product capability** | One published trigger taxonomy; one queue with per-type caps and a reserve; one delivery-channel registry; a fire receipt on every alert; a monitoring half that distinguishes "checked and clean" from "could not check." |
| **Existing UCT capability (cite capability-ledger.md row IDs)** | `I3` price/line/trendline alerts (owns the shared delivery seam `deliver_alert_payload`) · `B6` indicator alerts (+ shadow log, fired log) · `E7` pre-report calendar alerts · `K7` awareness engine (R1/R2 stop-watch, R4 regime-flip, R5 earnings-proximity → `add_insight` queue) · `K8` Stock Catalysts engine (watchlist-match / must-know alerts) · `D6` transcript keyword alerts · `M4` the ~17–20-variable Discord webhook fleet · `I1`/`I2`/`I4` (watchlists, tags, `TickerActions` as an alert-creation entry point) · `P5`/`G12` (the entitlement mechanism S9 will gate on) · `H6` (the two-regime-classifier finding S7's regime-change trigger inherits) · `G2`/`D12` (`CoverageLine`, `provider_coverage_monitor` — the "checked-clean vs could-not-check" idiom S7's monitoring half generalizes). |
| **Gap** | Five-plus independently-built subsystems share one delivery function but no shared trigger model (`READINESS_REVIEW_DAY1.md` §7 D7). The shared 8/day insight cap can silently starve `daily_focus` (`K7` known limitation). Discord is "the sole alerting channel and the first thing to go quiet" with no second channel (`TD-43`). No monitoring surface distinguishes "evaluated, nothing fired" from "could not evaluate" *across* trigger types the way `CoverageLine` already does for one screener. A `document-arrival` trigger type does not exist despite the EDGAR pipe already being wired (`C2-01 §10`: "needs engineering only"). Server-side evaluation of price-level predicates against real-time/OPRA-shaped data may carry an undisclosed CTA/OPRA non-display licensing fee (provider-ledger.md §3.4: "$2,000/mo per category on CTA Network A and again on OPRA... the surface most likely to be omitted precisely because nothing is on screen") that no existing subsystem accounts for. |
| **Proposed system** | S7 — Alerts & Monitoring, exactly as bounded in `product-architecture.md` §5-B.6 / Part C §5 (restated in §5 below). |
| **Data/provider requirements** | §10 below. Headline: S7 introduces **no new external data provider** — every trigger type reads values already computed by an application and addressed through D2/D3/D4; the one new consumption is the already-wired EDGAR filings client for `document-arrival`. |
| **UX/interaction requirements** | §9 below. |
| **Technical requirements** | §§6–7, 12–19 below. |

---

## 2. Who this system is for

- **The internal desk** (owner + internal traders, 2–5 dogfooders per `GOVERNING_PRINCIPLES.md` §13) — the primary audience for `position-risk` (stop proximity, aggregate heat) and `regime-change` triggers, and for the highest-cadence `price-level`/`indicator-condition` use.
- **Paid members** — the audience for `price-level`, `indicator-condition`, `event-proximity` (pre-report, earnings), `catalyst-match`, and `document-arrival` (filing/transcript-keyword) triggers, gated by S9 exactly as today's five subsystems already are (`I3`, `B6`, `E7`, `K8`, `D6` are all `paid`-gated per capability-ledger.md).
- **Staff/admin** — the consumer of S7's *monitoring* half: which trigger types are currently evaluating cleanly, which have gone silent, and on which channel. This is a new audience S7 serves that no existing subsystem serves today (no dashboard-ledger row answers "is the alert system itself healthy").
- **Not this system's audience:** unauthenticated visitors (every trigger type inherits its data class's entitlement, and no trigger type is designed public); other UCT systems needing a generic pub/sub event bus (S4 Context Bus is that primitive, and S7 explicitly refuses to become a second one — see §5's "must NOT own").

---

## 3. Problem being solved

Today, "set an alert" means five different things depending on which tab a member is in, each with
its own configuration surface, its own idea of what "fired" means, and its own relationship (or
lack of one) to the shared delivery seam:

1. A price/line/trendline alert on a watchlist ticker (`I3`) — evaluated on the 15s live-price poll.
2. An indicator-condition alert on a chart (`B6`) — evaluated on a 25–30s poll against the formula engine, with its own shadow/fired/revision logs.
3. A pre-report calendar alert ("My Stocks reports tomorrow") (`E7`) — evaluated twice daily at 07:00/18:00 ET.
4. A catalyst watchlist-match alert ("a name on your list just surfaced in today's top 20") (`K8`) — fired inside the catalyst engine's own refresh cycle.
5. The awareness engine's three rules — stop-watch, regime-flip, earnings-proximity (`K7`) — evaluated every 20 minutes, queued through `add_insight`, sharing an 8/day cap with *every other kind* of proactive insight the product ever sends a member, including `daily_focus`.
6. A transcript keyword alert (`D6`) — fired when a word appears in a newly-indexed call transcript.

All six deliver through the same function, `deliver_alert_payload` (`I3`) — proof the *delivery*
problem is already solved once. None of the six shares a *trigger* model: each defines its own idea
of scope, its own cooldown/dedup logic, its own notion of a "fire," and — critically — none of the
six can currently answer, in one place, "is anything wrong with alerting right now, or did nothing
just happen to fire." A member who sees zero alerts today cannot tell "the market was quiet" from
"the awareness cycle silently exhausted its shared cap" from "Discord — the sole alerting channel
for four of the six kinds — has been quiet for weeks" (`M4`/`TD-43`, a documented recurring failure
mode: "four PC monitors silent for weeks" is the exact shape this system exists to prevent from
recurring inside the member-facing product).

S7 solves this by giving every existing (and future) alert-generating application **one place to
register what it means for its condition to be true**, **one queue** that fairly caps and reserves
capacity per trigger type instead of one global cap, **one delivery-channel registry** instead of
seventeen-plus separate webhook variable names, and **one receipt** on every fire so "what fired, on
which value, as-of when, from which source" is always answerable — the same discipline
`CoverageLine` (`G2`) already proved out for one screener, generalized.

---

## 4. Primary workflows

These are the acceptance tests for S7 — a requirement that does not shorten or clarify one of these
chains is not earning its place (mirroring the discipline `information-architecture.md` §12 already
applies to every chain it names).

### 4.1 Arm — creating an alert from wherever the condition is visible

A member is looking at the thing the alert should watch (a chart, a watchlist row, a scan result, a
calendar chip, an open position) and arms an alert **without leaving that context**:

- **From a chart:** the act-at-price gesture (`information-architecture.md` §9.1, citing TradingView's modifier+cursor `+`) — the only mechanism in the competitive survey that *removes a dialog* rather than adding one. The chart already owns the price→pixel mapping (`ChartCalloutOverlay`); S7 receives a pre-filled `price-level` predicate draft (entity, price, direction) and the member only confirms.
- **From a watchlist row, a screener row, or `TickerActions`:** the existing right-click "set alert" entry point (`I4`) opens the same S7 draft, pre-scoped to that entity.
- **From the entity page's "Arm" step** (`information-architecture.md` §12.3 step 5): pre-report alert, transcript-keyword alert, or a `price-level` alert at the expected-move boundary — all three are S7 predicates of different registered types, authored from the same page.
- **From a saved result set** (a scan, a screener view, a catalyst table filtered): the **save fork** (`information-architecture.md` §13.2) — the product asks whether this should become a frozen list, a re-runnable definition, or a **standing alert**, rather than guessing. Naming the lifetime at save time, not after, is the requirement; a silently-guessed default is explicitly named as the anti-pattern to avoid (`C5-02 §5`, "wrong half the time and the wrongness is silent").
- **Tuning receipt at authoring time.** Before confirming, the draft shows "this would have fired N times in the last 7 days" against the trigger type's recent history (Bloomberg's Advanced Editor "stories-per-hour" idiom, `information-architecture.md` §12.4 step 5) — a member arms a threshold with data, not blind.

### 4.2 Fire → investigation

The full chain, restated from `information-architecture.md` §12.4 as the requirement it is:

1. The alert lands in **one inbox**, on every channel it was routed to (in-app bell count in the L0 strip, email, Discord, browser notification, sound — per the member's channel routing, §9.3).
2. **The alert is an address.** Clicking it loads the firing entity with `event(fired_at, rule)` attached — not a bare notification text.
3. The member lands on the right lens at the right time: the chart scrolled to the fire, the tape at that minute, the news window around it (the `event` payload, `information-architecture.md` §11.2).
4. **Contrast:** what else fired around the same time, what the desk said about the name (the awareness feed and the Desk lens, once A13's history join exists — a dependency named, not built, by S7).
5. **Decide and re-arm:** suspend (not only delete), edit the threshold, or log the outcome to the journal. The receipt persists regardless of what the member does next.

### 4.3 Monitor — the half that has no owner today

A staff/admin view answers, per trigger type: last successful evaluation cycle, count evaluated,
count fired, count that could not be evaluated (and why), and per-channel delivery health. This is
the direct generalization of `provider_coverage_monitor` (`D12`) and `CoverageLine` (`G2`) — an
artifact-first read, never a proxy that can go stale (the Desk session-audit lesson, cited directly
in `product-architecture.md`'s evidence for S12, applies here with equal force: "an audit nobody runs
is worse than none — it reads as coverage").

---

## 5. System boundary (restated from `product-architecture.md`, not redesigned)

This section is a verbatim restatement. Nothing here is a new decision.

### 5.1 The S7 system block (`product-architecture.md` Part C §5, "S7 — Alerts & Monitoring")

- **Responsibility.** The trigger taxonomy; predicate evaluation on registered values; one queue
  with per-type caps and reserves; the delivery-channel registry; fire receipts; the monitoring
  half — "checked and clean" vs "could not check," names not counts, a second channel.
- **Answers:** (c) backend capability, (d) exposure (the bell).
- **Inputs.** Registered predicates from applications; values from D2/D3/D4; scope from S3/S5;
  entitlement from S9; the clock from S11.
- **Outputs.** Fires with receipts; queue state; channel deliveries; monitor verdicts.
- **Dependencies.** S3, S5, S8, S9, S11, D2, D3.
- **Ownership boundary.** Evaluation, queueing, delivery; never computation of the condition's
  inputs.
- **Primitives exposed.** `registerTriggerType`, `registerPredicate(type, entityScope, params)`,
  `deliver(channel, payload)`, `receipt(fireId)`; `deliver_alert_payload` is the existing seam.
- **Must NOT own.** The computation of breadth, patterns, catalysts or stop proximity
  (applications); the choice of which data class an audience may be alerted on (S9); a sixth
  subsystem; a global cap that starves scheduled insights (K7 limitation).
- **Build condition.** **Consolidate** around one taxonomy (`READINESS_REVIEW_DAY1.md` §7 D7:
  "nothing found argues against it"); document-arrival first (`C2-01 §10` "needs engineering
  only").

### 5.2 Boundary matrix row (`product-architecture.md` §8)

S7 may call: S3 (●, scope resolution), S5 (●, persistence of alert definitions), S8 (●, receipts),
S9 (●, entitlement gate), S11 (●, clock), D2 (●, registered metric values), D3 (●, streaming
values), D4 (●, cached/served values), and applications only **through a registered predicate**
(`○ predicates`). S7 may **not** call S1, S2, S4, S6, S10, S12, D1, D5, or I1 directly. Conversely,
applications may call S7 only `○ register`, and I1 (Intelligence Layer) may call S7 only `○
insight` — meaning I1 can push a scored insight into S7's queue (this is how the awareness engine's
AI-adjacent scoring reaches a member without S7 gaining any AI logic of its own — see §12).

### 5.3 What S7 explicitly must NOT become

Restated for emphasis because it is the primary scope-creep risk this PRD must guard against per
the ANTI-DRIFT RULE: S7 does not compute breadth, patterns, catalyst scores, or stop proximity —
those stay owned by A9, A11, K7/K8, and A13/K4 respectively, each *registering* a predicate with S7
rather than S7 reaching into their data. S7 does not decide which data class an audience may be
alerted on (that is S9's entitlement decision, consulted, not made, by S7). S7 is not a general
event bus (S4 Context Bus already fills that role for panel-to-panel context; folding alerts into it
would be exactly the "monolith seed" `product-architecture.md` §3.4 names as a rule violation). S7
does not become a sixth independently-built subsystem sitting beside the five it consolidates.

### 5.4 Reversibility carried forward, unchanged

`product-architecture.md`'s reversibility ledger (§10) does not list any S7-specific
PROVISIONAL/OWNER-BOUND item — D7 is LOCKED with no counter-evidence. Two *adjacent* owner-bound
items touch S7 indirectly and are carried forward, not resolved, here: **D5** (member-facing data
licensing — bears on whether a server-side price alert may evaluate real-time/OPRA-shaped data for
a non-desk audience at all, §16) and **D9** (decisiveness posture — bears on how an AI-scored
insight from I1 is worded when it reaches S7's queue, §12). Neither blocks this PRD; both are
restated as open in §22.

---

## 6. The trigger taxonomy

### 6.1 The eight registered trigger types

Per `product-architecture.md` §5-B.6, restated with the concrete registration shape a PRD requires:

| # | Trigger type | What it means for the condition to be true | Registering application | Existing subsystem it consolidates |
|---|---|---|---|---|
| 1 | **price-level** | A scoped entity's price crosses a registered threshold in a registered direction | A1 (Markets), A2 (Charts) | `I3` (the flat-price half) |
| 2 | **indicator-condition** | A computed value (an indicator, a trendline, a formula-engine output) crosses a registered threshold or changes state | A2 (Charts, formula platform `B5`) | `I3` (the trendline half — a trendline's *value* is computed, not fixed, so it registers here, not under price-level) · `B6` |
| 3 | **scan-membership-change** | An entity enters or leaves a saved scan/screen's result set between two evaluation cycles | A9 (Screening & Discovery) | **New capability** — no existing subsystem fires on this today, though the nightly sweep (`G2`) already computes the membership set that would drive it |
| 4 | **document-arrival** | A new document (a filing, a transcript) matching registered criteria (entity, form type, keyword) is indexed | A6 (Transcripts & Filings) | `D6` (transcript keyword alerts); filings arrival is new but "needs engineering only" off the already-wired EDGAR client (`C2-01 §10`) |
| 5 | **event-proximity** | A scheduled event (earnings, an economic print) for a scoped entity or list falls within a registered window | A5 (Events & Calendar) | `E7` (pre-report) · `K7` R5 (earnings-proximity) |
| 6 | **regime-change** | The named regime authority's label changes since the last evaluation cycle | A11 (Breadth, Regime & Positioning) | `K7` R4 (regime-flip) — see §6.3 for the authority resolution |
| 7 | **position-risk** | A member's position is at, through, or approaching its stop, or aggregate portfolio heat crosses a registered threshold | A13 (Journal & Track Record) / K4's `portfolio_heat` | `K7` R1/R2 (stop-watch) |
| 8 | **catalyst-match** | A scoped entity or list intersects the catalyst engine's current top-ranked set | A8 (News & Catalyst Intelligence) | `K8` (watchlist-match / must-know alerts) |

**What did not change in this consolidation.** Each application still computes its own condition —
S7's "must NOT own" (§5.3) is structural, not aspirational: A9 still owns what "in the scan" means,
A11 still owns what "the regime" means, A13/K4 still own what "at risk" means. S7 only standardizes
*how* a computed-true condition becomes a queued, capped, receipted, delivered fire.

### 6.2 Predicate registration shape

`registerPredicate(type, entityScope, params)` — concretely, per type:

- `entityScope` is always one of the payload kinds `information-architecture.md` §10.1 already
  defines for the Context Channel: `entity` (a single permanent id), `entity-set`, or `list-ref`
  (a watchlist, a saved scan, "my positions," UCT 20). An alert is never scoped to a raw ticker
  string — it is scoped through S3 (entity resolution) or S5 (saved-object resolution), consistent
  with the address-model requirement that "browsing is a view over the same addresses"
  (`product-architecture.md` §5-B.2).
- `params` is a typed, per-trigger-type schema (e.g. `price-level: {direction, threshold, basis}`;
  `event-proximity: {window_days, event_kind}`) — never a free-text condition string. This is what
  makes "would have fired N times" (§4.1) computable: the predicate is data, not code, so it can be
  replayed against history at authoring time.

### 6.3 Resolving the regime-change trigger's authority (D13)

The Architectural Decision Register lists D13 ("Regime-classifier authority") as **OPEN** as of
Phase 2 close, flagged as load-bearing for exactly this trigger type: "the Awareness Engine's R4
regime-flip alert rule" is named in the register's own D13 entry as one of the consumers a wrong
answer would break.

A Phase 3 validation pass closed this question with a direct code read (not inference), and this
PRD adopts its finding as S7's specification for the `regime-change` trigger type:

> **`api/services/voice_regime_classifier.py::get_current_regime()`** is the single live regime
> authority already wired into every decision path that matters for Terminal-Next — `grade_ticker.py`
> (the Intelligence Layer's verdict gate; `regime_red` is a hard SKIP), **the Awareness Engine's R4
> regime-flip alert rule itself** (`api/services/awareness/engine.py:143,158-174` imports
> `voice_regime_classifier.get_current_regime` and diffs it against
> `regime_snapshots.get_last_label()`), and `brain_service.py`'s regime input. The engine-side
> `market_regimes` table (the second classifier `H6` names) is read in exactly one place in the
> whole dashboard codebase — `/api/risk-summary` — and that endpoint has **zero frontend callers**;
> its own docstring says the page meant to consume it is client-side redirected away for everyone.

**S7 requirement, stated concretely:** the `regime-change` trigger type's registered predicate
consumes `voice_regime_classifier.get_current_regime()` exclusively. `market_regimes` /
`/api/risk-summary` is **not** wired to this trigger type and is out of S7's scope to reconcile —
per the finding, it should be treated as legacy/dead by A11 (Breadth, Regime & Positioning, the
system that owns the regime-authority boundary decision per `product-architecture.md`'s A11 block)
rather than reconciled. Because R4 already reads `voice_regime_classifier` today, **this
requirement asks for no behavior change to the existing awareness rule** — it asks that any *new*
consumer of the `regime-change` trigger type (a future member-facing "alert me on a regime flip"
surface beyond the desk-only awareness feed) be built against the same function, never against
`market_regimes` directly.

**A second, separate finding this PRD flags but does not ask S7 to fix.** The same validation pass
found a **third**, unrequested regime vocabulary: `api/services/journal_two/regime.py::classify_regime()`
buckets the UCT Exposure Rating score alone into a 4-tier `green/amber/orange/red` scale — a
different measurement (an exposure-score bucketing, not an independent price/breadth read) — exposed
at `/api/j2/regime` and injected as ambient "today's regime is X" context into Compass text chat,
while that same chat's `get_regime` tool call returns `voice_regime_classifier`'s different 5-way
label. **This is not S7's defect to fix** — S7 registers exactly one `regime-change` predicate
against exactly one function — but it is a naming collision an alert-taxonomy author could walk
into by accident (a developer wiring a new "regime" alert reaching for the nearest function named
`regime` and finding two). **Requirement:** the `registerPredicate` call site for `regime-change`
must import `voice_regime_classifier.get_current_regime` by its qualified name in its own
registration code, with an inline comment naming `journal_two/regime.py` as a *different*,
non-authoritative measurement — a documentation guard against exactly the class of second-authority
defect this program repeatedly flags elsewhere (`product-architecture.md` §3.1: "the estate's most
expensive defect class... live in nine-plus places").

---

## 7. User stories / use cases

Written against the two primary personas named in §2.

**US-1 (desk).** *As an internal trader holding a position, I want to be alerted the moment price
touches or crosses my stop, so I can act before the position moves further against me, and I want
the alert to distinguish "at stop" from "near stop" so I am not desensitized to false urgency.*
→ `position-risk` trigger, two severities (`stop_hit` vs `stop_proximity`), namespaced cooldowns so
a proximity warning can never suppress the actual breach (the existing R1/R2 cooldown-key design in
`K7` is the requirement's seed and is preserved unchanged).

**US-2 (member).** *As a paid member with a swing watchlist, I want to know when a name I'm watching
crosses a price level I set from the chart, without opening a separate "alerts" configuration page.*
→ `price-level` trigger, armed via the act-at-price gesture (§4.1).

**US-3 (member).** *As a member holding a position through earnings, I want one alert that fires
before the print, not three separate reminders from three separate parts of the product that may or
may not agree on the date.* → `event-proximity` trigger scoped to the position's entity, reading
`/api/calendar`'s reconciled week (A5) as its single date authority — never a second earnings-date
source (consistent with `OQ-14`'s resolution that `/api/calendar` is canonical).

**US-4 (desk).** *As a trader, I want to know the instant the market's regime label flips, because
several things I do (sizing, which setups I trust) depend on it, and I want that alert to be
unambiguous about which regime read it is using.* → `regime-change` trigger per §6.3.

**US-5 (member).** *As a member who filed a scan for "tight-flag pullbacks in leading sectors," I
want to be told when a new name enters that scan's result set, not just be able to re-run it
manually.* → `scan-membership-change` trigger — the one genuinely new capability this taxonomy
enables (§6.1 row 3), consuming the nightly sweep's already-computed membership delta (`G2`).

**US-6 (member).** *As a member researching a name ahead of its print, I want to be told the moment
a new 8-K or the earnings-call transcript lands, and to be able to narrow that to only fire if a
specific word (e.g. "guidance") appears in it.* → `document-arrival` trigger, with an optional
keyword `param`, consolidating `D6`'s existing keyword-alert behavior and adding filing-arrival as
new coverage off the already-wired EDGAR client.

**US-7 (member).** *As a member on a curated watchlist, I want to be told when one of my names
surfaces in today's top catalyst picks, without having to check the Catalysts tile every morning.*
→ `catalyst-match` trigger, consolidating `K8`'s existing must-know-alert logic onto the shared
queue (so it stops competing with `daily_focus` for the same global cap — the fix to K7's named
limitation).

**US-8 (staff).** *As the person operationally responsible for the product, I want one page that
tells me, per trigger type, whether alerting is actually running — not a countdown of "N days since
last change," but "evaluated X, fired Y, could-not-evaluate Z, last successful cycle at T" — and I
want to know the moment the primary delivery channel goes quiet, on a channel that is not itself the
one that just went quiet.* → the monitoring half (§4.3, §14).

**US-9 (member).** *As a member who armed an alert that turned out to be too noisy, I want to
suspend it without losing its history — I might want it back next earnings season.* → suspend, not
only delete (`information-architecture.md` §13.2: "member; suspendable, not only deletable").

---

## 8. Interaction behavior

- **An alert is a saved object with an address (`!name`).** Per `information-architecture.md`
  §13.2's object model: member-owned, suspendable, addressable, and its **fire history is its own
  provenance** — the receipt log *is* the record of what the alert has done, not a separate audit
  trail bolted on afterward.
- **An alert is both a publisher and a consumer of channel context.** It fires with `entity` +
  `event`, and it can be *created from* a channel's current context (the act-at-price gesture reads
  the chart's loaded entity and cursor price; a saved-scan alert reads the scan's list-ref) —
  restated from `information-architecture.md` §11.2.
- **One inbox, on the L0 strip.** The alert count is always visible (§3.1's L0 level in the IA
  hierarchy: "clock/session state, regime + exposure read, alert inbox, and the command line —
  always present, never a page"). Clicking the inbox opens the alert list; clicking one alert opens
  the fired entity at the fired event.
- **One routing rule per trigger type, overridable per alert.** A member sets "position-risk alerts
  go to in-app + email + sound" once, and every new position-risk alert inherits it, rather than
  re-selecting channels per alert instance (Bloomberg `MRUL`'s idiom, cited directly in
  `information-architecture.md` §12.4 step 1 as "new but cheap on the shared seam").
- **Suspend is a first-class state, not a euphemism for delete.** A suspended alert keeps its
  definition, its history, and its address; it stops evaluating. Re-arming does not re-create it.
- **The save fork asks, never guesses** (§4.1). This is a hard interaction requirement, not a nice
  default: presenting three explicit choices (frozen list / re-runnable definition / standing
  alert) at the moment of save is required precisely because a silently-guessed default is "wrong
  half the time and the wrongness is silent" (`C5-02 §5`, cited in `information-architecture.md`
  §13.2).
- **The tuning receipt is required at authoring time**, not only after the fact (§4.1) — a member
  must be able to see how noisy a threshold would have been before committing to it.

---

## 9. Loading, error, empty, and degraded states

| State | Requirement |
|---|---|
| **Empty — no alerts armed** | Rendered distinctly from "no alerts fired": an honest "you have no active alerts" with a one-click path to arm one from the entity page or watchlist — never a blank inbox with no explanation (the same "empty because new" vs "empty because unreadable" distinction `product-architecture.md` names for R-13, applied here). |
| **Empty — armed, nothing fired** | "All clear" — explicitly distinct from the degraded state below, so a quiet inbox is never ambiguous between "the market didn't do anything" and "the system couldn't check." |
| **Degraded — could not evaluate** | A trigger type whose evaluation cycle failed (a data source down, a timeout) is surfaced by *name*, in the monitoring view and, for the affected alerts, in the member-facing inbox itself ("N alerts could not be checked in the last cycle") — never silently skipped and never rendered as "clean." This is the direct requirement `CoverageLine`'s four-count receipt already proves out for one screener (`G2`): evaluated / fired / dropped / not-computable are different facts, and collapsing them is the anti-pattern. |
| **Degraded — primary delivery channel down** | If Discord (today's sole channel for four of the six existing subsystems, per `TD-43`) goes quiet, the monitoring surface flags it *and* a second channel (in-app bell at minimum, since it has no external dependency) carries the fire regardless — "checked and clean" must never be confused with "the channel that would have told you is down." |
| **Loading** | The L0 strip's alert count must render from the last known queue state immediately (never block first paint waiting on a live evaluation cycle), consistent with S8's freshness-class model — a stale count with an as-of stamp, not a spinner where a number belongs. |
| **Error — predicate registration failure** | An application's `registerPredicate` call that fails validation (malformed params, an entity scope S3 cannot resolve) is rejected at registration time with a named reason, never silently accepted and silently never evaluated. |

---

## 10. Required data

**Headline: S7 requires no new external data provider.** Every trigger type reads a value an
application already computes or a provider already serves; S7's own inputs are entirely internal:

| Trigger type | Data source | Provider (already in the estate) | New provider needed? |
|---|---|---|---|
| price-level | Live/streaming quote | Massive REST/WS (`A1`) | No |
| indicator-condition | Formula-engine output, chart bars | Massive/FMP/yfinance via `A2`'s existing chain | No |
| scan-membership-change | Nightly scan sweep result set | Finviz Elite whole-market universe (`G1`) | No |
| document-arrival | SEC filings, call transcripts | SEC EDGAR (`A6`, free/public-domain), FMP transcripts | No |
| event-proximity | `/api/calendar`'s reconciled week | EarningsWhispers/Finviz/Finnhub/FMP consolidated in `A5` | No |
| regime-change | `voice_regime_classifier.get_current_regime()` | Computed internally from breadth%/VIX/MA/distribution-days/UCT-exposure — no external vendor call at evaluation time | No |
| position-risk | Member's own position state | `A13`/`j2_positions`, `K4`'s `portfolio_heat` | No |
| catalyst-match | Catalyst engine's current top-ranked set | `K8`'s existing 8-source composite (already licensed/gated at that layer) | No |

**What S7 does need that does not exist yet, and where it comes from.** Registered predicates read
*addressed* values — S7's own contract (§5.1: "Inputs... values from D2/D3/D4") assumes D2's Metric
Address Book exists so a predicate can be written against a stable `uct://` address rather than a
raw function call. **This is a sequencing dependency, not a blocker**: §17 below specifies how S7's
consolidation work can begin against today's direct reads (exactly as `I3`/`B6`/`K7` already do) and
migrate onto D2 addresses as each metric is registered, rather than waiting for D2 to fully exist
before S7 can start.

---

## 11. UX/interaction requirements (summary — detail in §8)

1. The act-at-price chart gesture is a hard requirement, not a stretch goal — it is the only
   competitive mechanism observed that removes a dialog rather than adding one, and the chart
   already owns the pixel↔price mapping needed to implement it.
2. Every alert is addressable (`!name`) and every fire is addressable (entity + event).
3. The L0 inbox is always present, never a page a member must navigate to.
4. Suspend, not only delete, is available on every alert regardless of trigger type.
5. The save fork is presented explicitly at every result-set save, across every application that
   produces a result set (screener, catalyst table, any future scan-shaped surface).
6. The tuning receipt ("would have fired N times") is shown before an alert is confirmed, for every
   trigger type where recent history is computable (all except newly-armed `document-arrival` and
   `scan-membership-change` predicates with no prior evaluation history).

---

## 12. Intelligence/AI behavior

S7 itself contains **no AI logic** — this is a structural requirement, not an omission. The boundary
matrix (§5.2) permits exactly one edge between the Intelligence Layer and S7: `I1 ○ insight → S7`,
meaning I1 may push a scored insight into S7's queue (this is how the awareness engine's
AI-adjacent relevance scoring — `base_signal × personal_multiplier × urgency`, per `K7` — reaches a
member) but S7 never calls into I1, never runs a model, and never scores a predicate itself.

**Two consequences that are hard requirements:**

- **Every predicate's *condition* is deterministic.** `price-level`, `indicator-condition`,
  `scan-membership-change`, `event-proximity`, `regime-change`, and `position-risk` are all pure
  functions of registered values — no LLM call sits in the evaluation hot path for any of them.
  `catalyst-match`'s underlying ranking (which names appear in the top-20) is produced by K8's own
  LLM-assisted synthesis *upstream* of S7; by the time the predicate reaches S7 it is a deterministic
  set-membership test ("is this entity in today's catalyst set"), consistent with S7's "must NOT own
  the computation" boundary.
- **Any AI-generated *content* attached to an alert (a catalyst thesis sentence, an awareness
  insight's narration) must route through S8's provenance renderer before it reaches a member**,
  never delivered as raw prose inside an alert payload without a citation — this is `I1`'s own
  system-block requirement (`product-architecture.md` §7: "every answer routes through S8's
  provenance renderer") applied to the one place I1's output enters S7's queue.

**D9 (decisiveness posture) is explicitly not resolved by this requirement.** Whether an
I1-sourced insight that reaches S7's queue is worded decisively-by-default or graduated is I1's
`posture` setting (`product-architecture.md` §7.5), consulted by S7's delivery layer but not decided
by it — carried forward as open in §22, unchanged from the reversibility ledger.

---

## 13. Personalization behavior

Per `product-architecture.md` S6's contract, S7 exposes **knobs**, never a store of its own —
personalization *reads* S7's registered types and *resolves* defaults, S7 does not personalize
itself:

- **Per-trigger-type channel routing** is a member preference (§8), resolved by S6 and consulted by
  S7's delivery layer at fire time.
- **Per-type caps with a reserve, not a single global cap**, is itself a fairness mechanism that
  functions as implicit personalization: a member who arms many `price-level` alerts should not
  crowd out their `position-risk` alerts' delivery budget. This directly fixes K7's named
  limitation (the shared 8/day insight cap "can silently drop that day's `daily_focus`").
- **The tuning receipt and "would have fired N times"** is itself a lightweight personalization
  signal — a member who repeatedly arms noisy thresholds is a candidate for a future
  suggested-threshold feature, explicitly **deferred**: this PRD does not specify predictive
  threshold suggestion, consistent with the ANTI-DRIFT RULE ("do not... expand scope because an
  interesting adjacent problem was found").

---

## 14. Provenance/freshness expectations

Every fire carries an S8 receipt with, at minimum:

- **Which rule fired** — the registered predicate's id and human-readable definition.
- **On which value** — the specific number, event, or state change that satisfied the predicate.
- **As-of** — the timestamp of the value that triggered it, distinct from the delivery timestamp.
- **Source** — the data class and, where D1's provider abstraction has assigned one, the vendor of
  origin (generalizing the `catalyst_alerts_fired` dedup idiom's `(user_id, ticker, market_date)`
  primary-key discipline, `K8`, into a full receipt rather than a bare dedup key).
- **Freshness class of the underlying data** — real-time / delayed-15 / end-of-day / historical, per
  `data-architecture.md` §12.1's four-class model, so a member evaluating a `price-level` fire knows
  whether it fired off live or delayed data. This is not cosmetic: it is the field a licensing audit
  of a delayed-data alerting design would need (§16).

**The monitoring half's own provenance requirement.** "Checked and clean" and "could not check" must
each be an *observed* state from the evaluation cycle's own artifact (which alerts were actually
evaluated this cycle, per the awareness engine's existing pattern of "one shared market scan per
cycle... two bulk queries," `K7`) — never a proxy that can go stale across a redeploy. This mirrors
the Desk session-audit's own explicit lesson, cited in `product-architecture.md`'s evidence for S12:
"a streak counter that resets on redeploy" is not a health signal; the artifact is.

---

## 15. Entitlement/licensing considerations

S9 gates alert eligibility by `(data class × audience)`, consulted — never decided — by S7, per
§5.1's contract. Two concrete, evidence-grounded considerations this PRD surfaces for that gate:

### 15.1 The CTA/OPRA non-display fee risk on `price-level`

Provider-ledger.md §3.4 records: **"Server-side price alerting as CTA/OPRA non-display: $2,000/mo
per category on CTA Network A and again on OPRA (E-03 §4.4B) — the surface most likely to be
omitted precisely because nothing is on screen."** This is the single most consequential licensing
finding for S7 specifically, because it is exactly the kind of exposure a feature that never renders
a number on a page can silently accrue. **Requirement:** S9's entitlement gate for the
`price-level` and `indicator-condition` trigger types must carry a distinct axis for "server-side
evaluation of real-time/CTA-Network-A/OPRA-sourced data," separate from the display-eligibility axis
that already gates member-facing quote rendering (`A1`). Whether this fee is actually owed —
contingent on **OI-03(a)** (which Massive plan tier is in force) and on **D5**'s still-open
member-facing licensing posture — is **not resolved by this PRD**; it is named here as a required
gate S9 must be capable of expressing, and as an item to escalate alongside D5 rather than build
around silently.

### 15.2 Per-trigger-type licensing summary

| Trigger type | Licensing exposure | Gate required |
|---|---|---|
| price-level, indicator-condition | Server-side CTA/OPRA non-display fee risk (§15.1) | S9 axis, tier-conditional, gated on OI-03(a)/D5 |
| scan-membership-change | Finviz Elite universe — U-class, "the single largest documentary gap in the audit" (provider-ledger.md) | Inherits A9's existing gate; no new exposure introduced by alerting on a set A9 already computes |
| document-arrival | SEC EDGAR — class A (public domain, free) | No gate needed |
| event-proximity | `/api/calendar`'s reconciled week — "the lowest licensing risk of any sprawled class in the register" (capability-infrastructure-matrix.md) | No new gate |
| regime-change | Computed entirely from UCT's own internal breadth/VIX/exposure inputs — no vendor licensing surface | No gate needed |
| position-risk | Member's own position data | No vendor licensing surface; standard member-data access control only |
| catalyst-match | Inherits K8's existing 8-source licensing surface (AlphaVantage commercial-use terms, X/Twitter Display Requirements) | Already gated at A8/K8; S7 adds no new exposure by alerting on an already-licensed set |

### 15.3 What this PRD does not decide

D5 (member-facing licensing posture) and D9 (decisiveness posture) remain owner-bound exactly as the
reversibility ledger designs — this PRD's job is to make S7 buildable *regardless* of how either
resolves, by keeping the entitlement axis a configuration row (S9) rather than a code fork.

---

## 16. Performance expectations

- **No new per-request evaluation path.** S7 must not introduce a request-time predicate evaluation
  loop; every trigger type piggybacks on an already-scheduled cycle — the 15s live-price poll
  (`price-level`), the 25–30s formula poll (`indicator-condition`), the nightly sweep
  (`scan-membership-change`), the twice-daily calendar-alert cycle (`event-proximity`), the 20-minute
  awareness cycle (`regime-change`, `position-risk`), and the catalyst engine's own refresh cadence
  (`catalyst-match`). This is a hard constraint given the single-process web-pod architecture
  (`product-architecture.md` D3's evidence: "the binding constraint is ~300 concurrent browsers per
  stream family... every fan-out number in this file is a labelled assumption until D-05 runs").
- **Batch evaluation, not per-alert re-fetch.** S7's queue must adopt the awareness engine's already-proven
  pattern: "one shared market scan per cycle... two bulk queries load all users' open positions +
  watchlist symbols (no N+1)" (`K7`) — generalized across trigger types rather than reinvented per
  type.
- **Delivery is offloaded, never inline on the request path.** `I3`'s current delivery-on-the-request-path
  design is a named launch-hardening backlog item; S7's delivery layer must be fire-and-return
  (mirroring `K7`'s existing pattern and the broker-sync `background=1` idiom already proven
  elsewhere in the estate), not a regression S7 reintroduces while consolidating.
- **The queue's per-type reserve must be enforceable without a full re-architecture of the underlying
  evaluation cycles** — each existing cycle keeps its own cadence; S7 changes what happens *after* a
  condition is found true, not how often each application checks.

---

## 17. Dependencies

| Dependency | Status (per `ARCHITECTURAL_DECISION_REGISTER.md`) | What S7 needs from it | Sequencing note |
|---|---|---|---|
| **S3 — Entity Master** | **LOCKED** (D3) | Scope resolution (`entityScope` in every predicate) | Design is locked; implementation is not yet built. S7 can register predicates against today's ticker strings as an interim measure and migrate to entity ids without changing the taxonomy's shape. |
| **S5 — Persistence & User State** | Recommended, reversible (rebuild is "the strongest single change in the estate") | Alert definitions as versioned, tombstoned saved objects | S7's alert-as-saved-object model (§8) assumes S5's rebuilt document store; can start against today's per-subsystem tables (`watchlist_alerts`, `indicator_alerts`, `calendar_alerts`) and migrate. |
| **S8 — Provenance & Freshness** | **LOCKED** (D6) | The receipt-rendering component every fire routes through | Design is locked; S7's receipt fields (§14) are specified to match S8's contract exactly so no rework is needed once S8 ships. |
| **S9 — Entitlements & Licensing Gate** | Mechanism exists (`entitlements.py`), tier numbers owner-bound | The `(data class × audience)` gate consulted before evaluation and before delivery | S7 depends on S9's *mechanism*, not on the still-open tier numbers (D5). |
| **S11 — Session & Market Clock** | New, small, not yet built | Cadence-aware evaluation (never evaluate a `price-level` predicate against a stale pre-market snapshot as if it were live) | S7 can use today's `sessionModel.js`/`ChartMarketClock` (`N6`) as an interim clock and migrate once S11 exists. |
| **D2 — Canonical Data Model & Metric Address Book** | New, on the critical path | Addressed values a predicate can be written against (§10) | Sequencing dependency, not a blocker — see §10's closing note. |
| **D3 — Realtime Streaming** | Extend (existing) | Live values for `price-level`/`indicator-condition` | Already exists (`A2`, `A5`). |
| **D4 — Caching & Serving** | Extend (existing) | Served values with freshness stamps for every trigger type | Already exists (`O6`, "the most valuable code in `api/`"). |
| **A6 — Transcripts & Filings** | Extend (existing) | The EDGAR client for `document-arrival` | Already wired (`D7` capability-ledger row); "needs engineering only" per `C2-01 §10`. |
| **A11 — Breadth, Regime & Positioning** | Extend (existing); owns the regime-authority decision | The `regime-change` trigger's registered function | Resolved for S7's purposes per §6.3; A11 owns the broader regime-authority boundary question, not S7. |
| **A13 / K4 — Journal & Track Record / `portfolio_heat`** | Extend (existing) | The `position-risk` trigger's inputs | Already exists; no change required. |

**Sequencing summary.** S7's consolidation work (one taxonomy, one queue, one delivery registry, one
receipt shape) can begin now, against today's direct reads exactly as `I3`/`B6`/`K7` already perform
them. The full "alert is a `uct://`-addressed, S3-scoped, S8-receipted, S9-gated object" experience
completes as S3, S5, S8, S9's numbers, and S11 land — none of which blocks starting.

---

## 18. Migration from the five existing subsystems

A concrete, non-breaking path — the shared delivery seam (`deliver_alert_payload`) is preserved
throughout, so no existing consumer of it breaks mid-migration:

1. **Stand up the taxonomy and registration API** (`registerTriggerType`, `registerPredicate`)
   without moving any existing subsystem yet.
2. **Register `document-arrival` first** (the S7 system block's own stated sequencing: "document-arrival
   first, since it needs engineering only"), because it is genuinely new capability, not a migration —
   the lowest-risk place to prove the taxonomy end-to-end.
3. **Migrate `E7` (pre-report calendar alerts) and `K8` (catalyst-match) onto the shared queue**,
   preserving their existing evaluation cadences unchanged; this is the direct fix to K7's named
   "shared cap can starve `daily_focus`" limitation, since moving K8's alerts off the awareness
   engine's insight queue and onto S7's own per-type-capped queue removes the contention.
4. **Migrate `K7`'s three rules (R1/R2, R4, R5)** onto `position-risk`, `regime-change`, and
   `event-proximity` respectively, preserving the cooldown-namespacing invariant (§7 US-1) exactly.
5. **Migrate `I3` and `B6`** onto `price-level` and `indicator-condition`, offloading delivery off
   the request path in the same pass (§16).
6. **Retire each subsystem's independent trigger logic once its predicates are proven equivalent on
   the shared taxonomy** — the shadow/fired/revision logs `B6` already maintains are the model for
   how to verify equivalence before cutover (run both in parallel, diff the fires, cut over once they
   agree).

No step in this sequence requires touching a partner-owned file, and no step requires `deliver_alert_payload`'s
signature to change — the migration is entirely upstream of delivery.

---

## 19. Non-goals

Explicit, per the ANTI-DRIFT RULE:

- **No order-triggered or execution-linked alerts.** `GOVERNING_PRINCIPLES.md` §13 excludes
  execution/OMS entirely; `position-risk` alerts inform, they never place or modify an order.
- **No new asset classes.** No FX, fixed income, or crypto trigger types — consistent with the
  standing owner default (§13) that this PRD does not revisit.
- **No new AI door.** S7 does not gain its own chat interface, its own LLM-authored alert prose
  generator, or a "smart alerts" feature beyond what K7/K8 already contribute through the single `I1
  ○ insight` edge (§12).
- **No resolution of D5 or D9.** Member-facing licensing posture and decisiveness-for-two-audiences
  are owner-bound and explicitly carried forward as open (§22), not decided by this PRD.
- **No portfolio/risk analytics build-out.** `position-risk` consumes `portfolio_heat` (`K4`) as-is;
  A14 (Portfolio & Risk)'s broader analytics are deferred per D8 and are out of this PRD's scope.
- **No general-purpose event bus.** S7 is not a replacement for S4's Context Bus and must not be
  used as one (§5.3).
- **No predictive threshold suggestion or ML-based alert tuning.** The tuning receipt (§4.1) shows
  historical fire frequency; it does not suggest a threshold. Deferred, not built.
- **No new Discord app, no new webhook variables.** The delivery-channel registry replaces the
  seventeen-plus existing webhook names (`M4`) with one registry entry per channel *kind*, not one
  per alert type — consolidation, not proliferation.
- **No changes to `/api/calendar`, EDGAR client internals, or any partner-owned file** (`OptionsFlow.jsx`,
  `schwab_router.py`, `live_massive_router.py`, `massive_ws_worker.py`, `massive_processor.py`) —
  every trigger type consumes these as read-only contracts.

---

## 20. Acceptance criteria

Testable, concrete, and phrased so an implementation team can verify each without interpretation:

1. **Every one of the five existing alert-generating subsystems' current trigger logic is
   expressible as exactly one of the eight registered trigger types**, with zero remaining
   custom/unregistered trigger logic outside the taxonomy once migration (§18) completes.
2. **A single delivery-channel registry** (in-app bell, email, Discord, browser notification, sound)
   replaces the seventeen-plus separate Discord webhook variable names currently in `M4`, with no
   loss of any channel currently reachable.
3. **Every alert fire produces a receipt** containing, at minimum: rule id, entity, triggering value,
   as-of timestamp, source/data-class, and freshness class — verifiable by inspecting any fire's
   stored record.
4. **The queue enforces per-trigger-type caps with a reserve**, verified by a test that arms enough
   `catalyst-match` alerts to exhaust a naive global cap and confirms `position-risk` alerts still
   deliver in the same cycle (the direct regression test for K7's named limitation).
5. **The `document-arrival` trigger type fires off a real EDGAR filing or a real transcript arrival**
   with no new external provider integration required beyond what `A6` already has.
6. **The `regime-change` trigger type's registered predicate is verified, by code inspection, to call
   `voice_regime_classifier.get_current_regime()` and not `market_regimes`/`/api/risk-summary`**, per
   §6.3.
7. **The monitoring view distinguishes, per trigger type, "evaluated N, fired M, could-not-evaluate
   K" from a single collapsed "N alerts" count** — verified by simulating a data-source failure for
   one trigger type and confirming the monitoring view names it, rather than silently omitting the
   affected alerts from the count.
8. **A second delivery channel remains functional when Discord is simulated as down**, verified by a
   test that disables the Discord webhook and confirms in-app bell delivery still succeeds and the
   monitoring view flags the Discord channel as degraded.
9. **The act-at-price chart gesture produces a pre-filled `price-level` alert draft with no
   intervening dialog**, verified against the existing `ChartCalloutOverlay` price→pixel mapping.
10. **Suspending an alert preserves its definition and fire history and stops future evaluation**;
    re-arming resumes evaluation without recreating the object or losing prior history — verified by
    a direct state-transition test.
11. **The save fork presents all three choices (frozen list / re-runnable definition / standing
    alert) at every result-set save surface that offers one**, with no code path that silently
    defaults to one choice without presenting the fork.
12. **No S7 code path calls a partner-owned file directly** — verified by the existing partner-file
    boundary convention (a grep/AST rail, per the estate's existing pattern for enforcing similar
    boundaries elsewhere, e.g. `test_yf_guard_census.py`'s shape).

---

## 21. Acceptance criteria this PRD deliberately does NOT include

Per the ANTI-DRIFT RULE, the following are explicitly out of scope for "done" on this PRD and must
not be treated as blocking criteria: full D2 Metric Address Book completion (§10, §17 sequencing);
S3 Entity Master's full bitemporal implementation (§17); S9's actual tier numbers (§15.3, owner-bound);
resolution of the CTA/OPRA fee question itself (§15.1 — the *gate's capability to express the axis*
is the acceptance criterion, not a legal determination); A14 Portfolio & Risk's broader build-out.

---

## 22. Open questions / owner inputs carried forward, not resolved here

None of the items below is decided by silence; each is designed so S7's specification and build can
proceed regardless of the answer, per the reversibility discipline `product-architecture.md`
establishes program-wide.

- **OI-03(a)/(b) → D5** (Massive plan tier; FMP DDLA existence): decides whether the CTA/OPRA
  non-display fee risk on `price-level`/`indicator-condition` (§15.1) is real spend or a non-issue,
  and whether server-side alerting on real-time data may reach a non-desk audience at all.
- **D9** (decisiveness for two audiences): decides how an I1-sourced insight reaching S7's queue is
  worded (§12) — a configuration flag on I1's renderer, not a fork in S7.
- **The four telemetry queries** (`page_views`, `calendar_seen`, `calendar_alerts_fired`,
  `ai_search_log`): would sharpen which trigger types see real member usage today, informing
  migration priority in §18 — does not block starting the migration in the order already specified.
- **Whether the desk wants a fully modular alert-configuration surface or a fixed one** is bound to
  D1 (workspace model), gated on OI-06 — S7's taxonomy and queue are shell-agnostic and do not
  depend on D1's outcome.

---

## GAPS

- **No production telemetry on current alert volume, fire counts, or which channel members actually
  read.** Every "N alerts" figure in this PRD is illustrative, not measured (`DL-013`; the
  capability ledger's own R section: "no `page_views`, `calendar_seen`, alert-fire, or AI-usage
  counters were read").
- **No observed desk morning (OI-06).** Whether `position-risk` or `regime-change` is the desk's
  actual highest-value trigger type in practice is a design hypothesis, restated from
  `information-architecture.md`'s own evidence ceiling, not measured.
- **The CTA/OPRA fee finding (§15.1) is a public list-price citation, not a confirmed contractual
  obligation** — provider-ledger.md itself flags "current exchange fee schedules were not
  re-verified... OPRA extract states 2017/2018 rates." This PRD treats it as a required gate to be
  *capable of expressing*, not as a settled cost.
- **Whether `scan-membership-change` (the one genuinely new trigger type) has real member demand**
  is unmeasured — it is architecturally cheap (the nightly sweep already computes the membership
  delta) but this PRD does not claim evidence of desk or member pull for it beyond the taxonomy's
  own completeness.

## NOT INSPECTED

Application source code (per this task's DO NOT clause — no file under the worktree outside
`docs/terminal-research` was read, created, or edited). Production Railway variables, the production
pod, `C:\data`, any vendor console or contract. Any external URL. The uct-intelligence,
uct_intelligence, morning-wire, and uct-sunday-scan repositories beyond what the cited architecture
documents already established about them.

## SOURCES

`00-program-control/READINESS_REVIEW_DAY1.md` · `13-executive-synthesis/DAY_1_EXECUTIVE_SYNTHESIS.md`
(cited via the above) · `13-executive-synthesis/PHASE_2_INTEGRATION_SYNTHESIS.md` ·
`05-product-strategy/product-architecture.md` (§5-B.6, S7 system block, boundary matrix, reversibility
ledger, S9/S3/S5/S8/S11/D2 blocks, A11/A13/A6/A5/A8/A9 blocks) ·
`06-ux-and-information-architecture/information-architecture.md` (§3.1 L0, §9.1, §11.2, §12.1, §12.3,
§12.4, §13.2) · `07-technical-architecture/data-architecture.md` (§11 Provenance, §12 Freshness
Metadata, §13 Confidence/Data-Quality, §14 Licensing/Entitlement Metadata) ·
`05-product-strategy/capability-infrastructure-matrix.md` (S7 row, §7 provisional index) ·
`01-existing-system/capability-ledger.md` (rows I1–I6, B6, D6, E7, K7, K8, M4, H6, D12, G2, P5, G12,
A6, A13, K4, N6) · `12-decisions/ARCHITECTURAL_DECISION_REGISTER.md` (D3, D4, D5, D6, D7, D9, D13) ·
`00-program-control/GOVERNING_PRINCIPLES.md` (§9, §13) · `02-data-providers/provider-ledger.md` (§3.4
server-side alerting non-display fee finding). The Phase 3 D13 validation finding (`voice_regime_classifier`
as the single live regime authority; the `journal_two/regime.py` vocabulary-collision finding) supplied
directly in this task's own instructions and incorporated in §6.3.
