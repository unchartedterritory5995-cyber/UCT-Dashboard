---
id: 28
title: Implementation Roadmap — NOW / NEXT / LATER / NOT PLANNED
role: sequencer (gate item 21 · Part CLXIII deliverable 28)
wave: 1
group: H
category: synthesis
scope: uct-dashboard (Terminal-Next), sequencing only — no new engineering content
confidence: 🟡 medium overall — the sequence is derived from accepted artifacts and eleven
  first-hand greps at `origin/master`; the horizons carry no dates and no effort, by rule
evidence_ceiling: no production read, no flag state, no test run, no network call, no vendor
  answer; 48 of the 49 band-4/5 tickets still carry no master grep
sources: 05-product-strategy/capability-matrix/capability-matrix.md, 10-roadmap/backlog.md,
  10-roadmap/dependency-graph.md, 10-roadmap/mvp.md, 10-roadmap/rollout-rollback.md,
  10-roadmap/coexistence.md, 05-product-strategy/feature-scoring.md,
  05-product-strategy/non-goals.md, 04-workflows/workflow-library.md,
  12-decisions/DECISION_CARDS_2026-09-26.md, 00-program-control/GOVERNING_PRINCIPLES.md,
  origin/master @ 2e0598bfa514303fe542c4473bd2f89470d04ec2
uct_relevance: high
status: draft
date: 2026-09-26
---

# Implementation Roadmap — NOW / NEXT / LATER / NOT PLANNED

**Three horizons, plus NOT PLANNED as a first-class class of its own.** This file sequences work
that other documents specified. It adds no engineering content, no ticket, no id, no estimate and
no score.

---

## 0. HOW TO READ THIS FILE

### 0.1 ⭐⭐ THE ORDERING PRINCIPLE IS THE OWNER'S THESIS, AND IT IS NOT "SHIP THE CHEAPEST THING"

The owner, verbatim, 2026-09-26 (`12-decisions/DECISION_CARDS_2026-09-26.md:674`, typo intact):
*"the goal is to aggreagte all the best features so someone can only use our site instead of the
others."*

CARD 25 §1 draws the consequence and it is binding here: under aggregation the constraint is
**COVERAGE**, and *"any capability a competitor has and we lack is a reason a member keeps another
tab open, so ONE missing feature can defeat a hundred proprietary ones."* So the ordering principle
of this roadmap is **close the biggest break-out first** — item 9's BRK ledger is the axis, and
item 9 §1 item 2 names the largest row on five independent axes at once.

⛔ **And there is no value axis to sort on, deliberately.** Item 17 §2 refuses one — *"inventing it
would be the single worst thing this document could do — it would convert a guess into a number
that item 28's roadmap then treats as evidence"* — and item 30 §1.3 carries that refusal forward.
**This file is the item 28 that sentence names, and it does not invent the number.** What it sorts
on, in this order, is: break-out size (item 9), then what can be *verified* (§0.4), then what can
reach a member *at all* (H3), then the concurrency that exists (§0.3).

⛔ Three consequences, and they are the shape of the whole file:

1. **The biggest break-out leads the roadmap's intent and cannot lead its NOW** — its data question
   is unanswered and it has no ticket (H1, H2).
2. **Cheap is not a reason.** Item 17's band 3 is *"H1's residue"*, not a strategy, and item 30 §7.3
   is explicit that its five-worth-doing-first are ranked by **documented cost of delay**, never value.
3. **Nothing reaches a member until rung 0 exists, and it does not exist in source** (H3). That
   single fact outranks every coverage row in NOW, because a coverage row nobody can be shown is not
   coverage.

### 0.2 ⛔ THREE HORIZONS — AND NOT PLANNED IS NOT ONE OF THEM

| class | what admits a row | what it is bounded by |
|---|---|---|
| **NOW** | every entry condition is met today, and every build carries a verification against `origin/master` (§0.4) | three lanes, one gate (§0.3) |
| **NEXT** | its entry condition is NOW's exit gate (§2.3) | the same three lanes, converging |
| **LATER** | real, wanted, and waiting on a **named** thing: a gate, an answer nobody on this box controls, or a grep nobody has run | nothing — it is a queue, not a dustbin (§4.1) |
| **NOT PLANNED** | ⛔ a ruling that already exists says it is not going to be built | it is **not a horizon in time** and nothing graduates out of it by waiting (§5) |

⛔⛔ **No row in this file carries a date, a duration, a day count or a sprint.** Item 30 §11: *"No
ticket here carries a date or a day count."* Item 29 GAPS: *"No effort, no duration, no cost…
Nothing here supports a date."* A horizon boundary here is an **exit gate**, written out per
horizon. A roadmap that put weeks on this graph would be manufacturing the one quantity every
upstream document refused to supply.

⚠️ **And the boundary between NEXT and LATER is softer than the one between NOW and NEXT**, which
is stated rather than hidden: NOW's exit gate is mechanical and checkable; LATER's entry is a
judgement about what a single convergent front can carry (item 29 §5.1: *"four chains at depth 0–1,
effectively two by depth 2, and one convergent front at depth 3"*).

### 0.3 ⛔⛔ THE CAPACITY THIS ROADMAP IS WRITTEN AGAINST — AND IT IS WHY NOW IS SMALL

Item 29 §5.2, carried in shape and not re-derived. **Every number in it is a loss already paid for.**

| stage | parallelism | what removes the rest |
|---|---|---|
| graph width (no hard prerequisite) | 40 | — |
| after the agent cap | **3 build lanes + 1 integrator** | owner ruling 2026-09-13, written from two measured losses in one session |
| after the box's gate rule | **1 lane at the verification step** | one gate at a time on this machine |
| after the merge queue | **1 master merge in flight, repo-wide** | `web` must reach SUCCESS before the next push |
| after the deploy-queue exclusions | **0 lanes** touching flow-worker watch paths during RTH | a bounced OPRA tape is a permanent gap until the T+1 flat file |

⭐ **And the sixth shared resource item 29 names that nobody counts: this box is also the DATA
PRODUCER** for the scheduled member-facing jobs (the weekday local chain: 7:00a scanner · 6:35a
morning_wire · 5:00a wire_critic · 3:15p breadth_collector · 3:20p UCT20 EOD · 3:30p brain
pre-close · 4:05p eod_updater · 8:05p market_ingest). So **a verification window is a scheduling
decision as much as a technical one** — which is `TERM-007` arriving from a third direction.

⛔ **Therefore: NOW is three lanes, one gate, and a zero-build set that consumes no lane at all.**
⚠️ *"A fourth lane is not available, however small it looks"* (item 29 §5.3), and *"dispatching a
fourth because 'this one is small' is how five happened."* A roadmap that opened more would be
fiction, and this one is sized to the rig rather than to the register's `PAR` column — which item 30
§7 warns must not be read as capacity.

### 0.4 ⛔⛔ THE NOW ADMISSION RULE: NO UNVERIFIED BUILD IS EVER IN NOW

Item 30 opened `origin/master` once per package and **the check fired six times across the 26
packages it wrote** — including a band-2 enabler with three items behind it, and one ticket deleted
before it was written. Its own GAPS 2: *"No `origin/master` grep was run for bands 4 and 5… the
expected number of further 'already ships' corrections in the 49 unchecked tickets is not zero,"*
naming `TERM-066`, `TERM-067`, `TERM-075`, `TERM-079`, `TERM-081` as highest-risk and instructing
**"Check before scheduling, not after."**

**The rule this roadmap adopts, and it is the reason NOW is the shape it is:** a ticket enters NOW
only if **(a)** it sits in a band item 30 checked against master while writing its package, or
**(b)** this file greps it. Every NOW row carries a `VERIFIED` cell saying which, the literal token
`VERIFIED-HERE` marks the ones I checked myself, and §9 prints the command for each.

⚰️ **The rule earned its keep before the file was finished.** I ran GAPS 2's check on exactly one
band-5 ticket and it recut (H4). That is a seventh instance of item 30's own pattern, found in the
band item 30 says it never checked — so the prior is now empirical rather than inherited.

### 0.5 ⛔ WHAT THIS FILE MAY NOT DO — declared, so a reader can catch me breaking it

* **No cost, no spend, no effort-in-dollars, no usage estimate.** CARD 25 §5, owner verbatim:
  *"Dont worry aobut anything else on costs or uses."* Item 34 is confirmed de-scoped (CARD 30 §3).
  ⚠️ **Licensing is not de-scoped and is not the same question** — CARD 26 §4's rule binds every row:
  *"licensing is CLEARED for the current estate and OPEN for each new data source the roadmap adds."*
* **No execution and no order management, in any horizon, including "later".**
  `GOVERNING_PRINCIPLES.md` §13 defaults in force; NG-01…NG-03. Those rows are in §5 and nowhere else.
* **No value, priority or score number** (§0.1).
* **No asserted flag state.** Three states only: **absent** · **admin-mounted, no member surface** ·
  **serving members** (item 9 §0.2; NG-23). A grep over git is a statement about **source**, never
  about the pod.
* **No new non-goal.** `non-goals.md` §10 rule 1 forbids that file from originating one; this file
  inherits the constraint. Every NOT PLANNED row cites an existing ruling.
* **No minted `TERM-` id.** The register's id space is item 30's. Where a horizon row has no ticket,
  the row says so and names it as **owed to item 30**.
* **No re-cut of another item's verdict, cell or count.** Contradictions are reported (§8), never
  resolved. Counts carried from another document are that document's measurement, cited.
* **No hand-typed count** (NG-21). Every number about this file is derived in §9 with its command.

### 0.6 ⚠️ THE ONE-WEEK EXECUTION ROADMAP IS NEITHER SUPERSEDED BY THIS FILE NOR AN INPUT TO IT

`10-roadmap/2026-09-23-one-week-execution-roadmap.md` exists, is owner-reviewed across three passes,
and is saved deliberately so a session interruption cannot lose it. ⛔ **It is a day-by-day build
plan whose unit is a day; this file has no days, and overruling it is not mine.** Where the two
disagree I record it (§8 items 5 and 11) rather than picking a winner. Two disagreements are
structural rather than editorial: its *"Days 2–3 — the long pole: D2 Canonical Data Model"* predates
item 30's recut of that ticket to **CP3 only** (CP1 and CP2 ship), and its *"Day 1 — finish what's
already unblocked"* predates all six of item 30's already-ships corrections. ⭐ Its licensing section
was corrected at source on 2026-09-23 and agrees with CARD 26.

### 0.7 COLUMN LEGEND — every value carried, none invented

`SZ` = item 16's size band as carried through item 30's register, **a shape and never an estimate**
(item 16: *"no band is a measurement"*). `ROLLBACK` = item 37's own tiers, or item 30's honest
absence token `TIER-NONE`, which means *item 37 names no tier for this shape* — not "irreversible",
not "tier 6". `LIC` = **CLEARED** (existing estate) or ⚠️ **OPEN** (needs a source we do not
already touch), per CARD 26 §4. `VERIFIED` = `VERIFIED-HERE` (§9) · `item 30` (checked while its
package was written) · `carried` (a decision or a read, with no build to verify).

---

## 1. HEADLINE — five things the sequencing revealed that the inputs do not say

### H1. ⚰️⚰️ THE LARGEST ACTIONABLE ITEM IN THE PROGRAMME HAS NO TICKET IN THE 93-TICKET BACKLOG

Item 9 §1 item 2 establishes **BRK-01 — pre-trade options analysis** as the biggest break-out on
five independent axes, grep-verified absent as a member surface with a dated in-code deferral, held
open by two of the owner's confirmed tools, and — per CARD 28 — **fully in charter including the
strategy-backtest half.** Item 9 §9 adds that both units of account agree on it, *"which is the
strongest thing this file can say while the unit is unsettled."*

⛔ **And the engineering backlog contains no ticket for it.** Derived, §9 V12: the only
chain-adjacent register row in `backlog.md` is `TERM-069` (`FB-A10-02`, *"Retire the
yfinance/Black-Scholes chain leg"*) — band 5, register row only, **unchecked against master**, and a
**retirement**.

⛔⛔ **The second half is worse than "no ticket", and it is the sharpest sequencing fact in this
file.** The chain machinery that exists is `api/services/options_chain.py`, whose own header reads
*"Options chain + Greeks for voice Compass. Free starting point — yfinance for chain/IV/OI/volume,
Black-Scholes for Greeks"*, and its only readers are `api/services/voice_tool_impls.py` and a
discord cold-path manifest (§9 V6). So:

* the biggest coverage hole's machinery is **admin-adjacent, not member-serving** — item 9's cell
  (*"machinery ships; only consumer is the voice agent"*) is confirmed;
* it rides **yfinance**, which the licensing register classes **X — Unsuitable, no purchasable
  remedy** (NGB-03), so **surfacing it as-is would publish an X-class-sourced derived work**;
* and `TERM-069` proposes deleting it. **Two tickets point in opposite directions at one module and
  neither names the other** (§8 item 3).

⭐ **What that does to the roadmap is clean rather than alarming: BRK-01's first move is not code at
all.** It is the vendor question that decides whether the chain can be re-sourced (H2), and it is in
NOW.

### H2. ⭐⭐ ONE EMAIL SITS ABOVE THE LARGEST COVERAGE HOLE, A STANDING COMPLIANCE ITEM AND A PERMANENT TAPE GAP

Item 9 §8 had already noticed two thirds of this: *"the biggest gap and the biggest licensing
question are the same row, and so is their remedy"* — `LCQ-01` needs historical chains and IV
history; `LCQ-02`'s **register-mandated** remedy for the *existing* GEX surface is to re-source
chains from Massive and authenticate. Add `TERM-002` (band 0, ⛔ ACT vendor: a second OPRA
connection, which item 24 Q9 says *"no measurement can answer and no agent can progress"*) and it is
**one ask, four register items, zero engineering**.

⚠️ Whether the Massive tier carries historical chains is **NOT DETERMINED** (item 9 §8) — which is
precisely why the ask is the work and the build is not.

### H3. ⛔⛔ RUNG 0 DOES NOT EXIST IN SOURCE, SO NO HORIZON CAN REACH A MEMBER YET — AND THE COHORT HALF ALREADY SHIPS

Verified here at `origin/master` 2e0598bfa (§9 V1–V3):

* `TERMINAL_NEXT_ENABLED` occurs in **zero files**. The only `TERMINAL_NEXT`-prefixed flag is
  `TERMINAL_NEXT_MONITOR_ENABLED`, which selects a separate service's start command. **Item 37 §4
  prerequisite 1 is unmet in source**, exactly as item 30 §9 item 7 and item 26 §1.1 both record.
* `api/services/rollout.py` is 347 lines and `tools/rollout_cohort.py` is 147 — so **the cohort
  store, its per-user read, its assignment and narrowing functions and its operator CLI all ship**
  (CARD 31, item 26 §1.1). A TERMINAL-NEXT cohort is *"a COMMAND, not a build."*
* `_access_payload` is at `api/routers/auth.py:271` and the string `cohorts` occurs **nowhere** in
  that file. **So the server can gate on a cohort while the client cannot know it is in one.**

⛔ **This is a statement about source, not about the pod.** No flag state is asserted anywhere in
this file; the live value of every flag named is **NAMED and UNREAD**.

⭐ **Consequence:** the NOW-sized build is the master switch declared dark in the ledger, its two
rails, one reusable request-time dependency and one payload field — and **the store is not in it,
because it exists.** That is `TERM-068`, recut.

### H4. ⚰️ I RAN GAPS 2's CHECK ON ONE BAND-5 TICKET AND IT RECUT — IN THE BAND ITEM 30 SAYS WAS NEVER CHECKED

`TERM-068` (`FB-S12-01`) reads *"Cohort store + master flag + a real kill switch"*, band 5, `d0·b1`,
`tier 0–2`. The **store** ships (H3). So the ticket that remains is the flag, the dependency, the
payload field and the kill-switch discipline — a materially different and smaller ticket than its
title. ⛔ **I checked one of the 49 and it moved. I did not check the other 48, and this roadmap does
not pretend otherwise** (§10, GAPS 2). Item 30's own hit rate makes that the expected outcome rather
than a surprise, which is the point of quoting it.

### H5. ⭐ A BAND-5 TICKET IS A HARD PREREQUISITE OF A BAND-2 TICKET, AND THE TWO DOCUMENTS DISAGREE ABOUT IT

Item 29 H3 and §6 put `FB-X1-02` (a backup rail; `TERM-083`, **band 5**) upstream of `FB-S5-01` (the
versioned workspace document; `TERM-021`, **band 2**) — *"the versioned workspace document looks like
the safety feature; it is not, in a store with no backup."* Item 30's register carries `TERM-021` as
`d0`. Item 29 §7.2 explains how both can be sincere: that edge is **declared only on the
prerequisite's side**, so *"a graph assembled only from the dependents' `Depends on` fields would
lose it."*

⛔ **Reported, not resolved** (§8 item 2). **Its consequence for sequencing is unavoidable, so this
file takes it:** NEXT's store lane leads with `TERM-083`, not `TERM-021`. A roadmap that put the
versioned document first would be choosing the reading that loses an edge.

---

## 2. NOW

### 2.0 Entry state, and what NOW is for

**Entry state:** nothing in Terminal-Next is exposed to any member; rung 0 is absent from source
(H3); the programme's only performance gate cannot print its own number (`TERM-012`); and the
biggest break-out's data question is unasked (H2).

**NOW is for exactly three things:** (i) the acts that cost a sentence and unblock other people's
work, (ii) the floor that makes any later claim believable, and (iii) the machinery without which no
later horizon can be shown to a member. ⛔ **It is not for the biggest break-out**, and §2.4 says why
in full.

### 2.1 The zero-build set — no lane, no gate, and the highest leverage in the file

⛔ **These consume none of §0.3's three lanes**, because none of them is engineering. Item 17 §5 on
the band they mostly come from: *"the only band that costs nothing and unblocks other bands."*

| RM | what it is | id | who holds it | what it unblocks | VERIFIED |
|---|---|---|---|---|---|
| **RM-N01** | **Declare a quiet measurement window** — a window declared, held, and stated in the artifact with its `deployments_sampled` | `TERM-007` (`FB-OBS-07`, band 0, ⛔ ACT scheduling) | the owner — *"a scheduling decision nobody has made"* | ⭐ `TERM-014`, `TERM-017`, `TERM-001`'s panel curve and CARD 18's arming condition. Item 30 §6.1: *"the highest-leverage unblock in the register"*, and it is a sentence | carried |
| **RM-N02** | ⭐⭐ **ONE vendor ask to Massive**, covering four register items at once: live chains (to re-source the existing GEX surface off Schwab, which is `LCQ-02`'s register-mandated remedy), **multi-year historical option chains + per-symbol IV history** (`LCQ-01`), 90-day average option volume, and **a second OPRA connection** (`TERM-002`) | `LCQ-01` · `LCQ-02` · `TERM-002` · BRK-01's precondition | outside the team (`vend`) — ⛔ nobody on this box can clear it | **BRK-01, BRK-10, COV-02, COV-03**, register row X-09's standing remedy, and the permanent tape gap on every flow-worker deploy | ✅ **VERIFIED-HERE** (§9 V4–V6) |
| **RM-N03** | **One sentence: the maximum age a panel may display without saying so** | `TERM-006` (`FB-S8-02`, band 0) | the owner — ARCH-07 §3 Q3 calls it *"a product decision nobody has made"* | `TERM-059`, every freshness render, and MG-6's contract | carried |
| **RM-N04** | **Read the transcript-coverage monitor once** (RG-15) | `MEAS-RG15` — item 29 §7.1 #1 records it as a **hard `meas` edge** that `FB-A6-01`'s own field omits | an engineer, one monitor cycle | `TERM-032`, and the whole BRK-09 question. CARD 30 §2: *"Re-read first, build second"* | carried |
| **RM-N05** | **The MVP pre-registration, and a named non-builder subject** — the workflow, the incumbent tool, the subject and the span in a dated artifact whose timestamp precedes day 1 | item 27 §6; CARD 22 §4's one blocking requirement and §6's owner-only half | the owner names the subject; ⛔ recorder and adjudicator are different people | the only displacement claim this programme may make. ⭐ Zero builds — CARD 24 voided the build half | carried |
| **RM-N06** | **The owner's explicit "deploy" plus a member-impact paragraph** for the wire missed-run watchdog: move the cron past `expected_wire_date`'s 09:30 rollback boundary, **with the rail in the same commit** | `TERM-092` (**XS**, ⛔ owner deploy, no agent ships it) | the owner | a guard that **cannot fire** is live now; the incident it was built for already happened (2026-08-14) | ✅ **VERIFIED-HERE** (§9 V9) |
| **RM-N07** | **Read the Cloudflare rule and the zone's cache key** | `TERM-008` (band 0, HELD credential) | someone who can authenticate | CARD 20's ruling being executed **by intention**: CARD 20-EXEC executed the TTL and found CARD 20's diagnosis *wrong about WHERE*, and the zone-wide 4-hour Browser TTL's **blast radius was never measured** | carried |
| **RM-N08** | **Two product sentences:** extend-or-delete on Confluence Radar; superseded-or-not on the Discord bot's earnings-date path (OQ-14) | `TERM-003`, `TERM-004` (band 0) | a product decision; one sentence | ledger G9 leaving `AWAITING_A_DECISION`; **one** earnings-date authority | carried |

⛔ **The four band-0 items deliberately NOT in NOW, with the reason at each:** `TERM-001` (a
board-size number) waits on RM-N01's measurement and CARD 15 rules an absolute capacity number out
of scope; `TERM-005` is **a purchase**, and its engineering half is a universe abstraction behind
`TERM-022`; `TERM-009` is a **member-safety ruling** whose failure *"cannot be un-published by a
deploy"*; `TERM-010` is a **curation decision** whose mechanism already ships (`charts_layouts`
`scope=global`) so only the default is missing. All four are in LATER.

### 2.2 The three lanes — and where I depart from item 30's lane assignment

⭐ **Item 30 §7.1 already assigned three non-colliding lanes and I adopt its lane A unchanged.** I
replace its lane B and narrow its lane C, and the reason is H3: **rung 0 is the only NOW item whose
absence stops every later horizon from reaching a member at all**, and item 30 §11 states that it
*"does not schedule. Item 28 owns the roadmap."* ⚠️ **The cost of my departure, stated:** item 30's
cheap-and-clear four (`TERM-030`, `TERM-033`, `TERM-027`, `TERM-036`) slip to NEXT, and `TERM-026`
moves to NEXT's head where it must still precede every route (item 29 H3).

#### Lane A — THE FLOOR. Nothing after this can be said to have worked.

| RM | ticket | what it is | SZ | DEP | ROLLBACK | LIC | VERIFIED |
|---|---|---|---|---|---|---|---|
| **RM-N09** | `TERM-011` (`FB-S7-03`) | A second delivery channel; split ops from business events. ⛔ **Configuration before code** — item 25 ranks it *above* the monitors it serves, because *"the split should land before the traffic does, not after"*, and one webhook already carries signups | S | d0·**b6** | tier 0–2 | CLEARED | ✅ **VERIFIED-HERE** (§9 V11) + item 30 |
| **RM-N10** | `TERM-012` (`FB-OBS-01`) ⚰️ RECUT | Make CARD 16's p95 gate measurable. Today `tools/bars_warmth_audit.py:28` puts `stale-swr` in its `COLD` set while CARD 16 ruled it **SERVED**, so on daily the p95 set is empty and **no p95 prints**. The recut is to copy the shipped percentile helper, not to write one | S | d0·b1 | tier 4 pref / 3 | CLEARED | ✅ **VERIFIED-HERE** (§9 V7) + item 30 |

#### Lane B — RUNG ZERO. The lane that makes every later horizon showable.

| RM | ticket | what it is | SZ | DEP | ROLLBACK | LIC | VERIFIED |
|---|---|---|---|---|---|---|---|
| **RM-N11** | `TERM-068` (`FB-S12-01`) ⚰️ **RECUT HERE** | **Four things, and the store is not one of them.** (1) `TERMINAL_NEXT_ENABLED` declared in `docs/feature_flags.json` with `status: dark` **before it is set anywhere** and with a name the AST index can see (item 37 §4.1; MG-9; CX-5). (2) A rail that the flag is read **per request** — *"a module-level capture passes every other test and makes the no-redeploy rollback a fiction"* (§4.2). (3) A rail pinning the **literal default**, so it cannot be changed and the test *"fixed"* to match (§4.3). (4) The two genuinely absent S2 pieces: **one reusable request-time cohort dependency beside `require_paid`** (copied from `askai.py::enabled_for`'s complete worked template — kill switch read first and per call, then `rollout.includes`, then `except Exception: return False`) and **a `cohorts` field on `_access_payload`**. ⛔ **Never `user_preferences`** — a member writes their own, so a preference-backed entitlement is self-grantable. ⛔ **The kill switch is evaluated FIRST**, so `FLAG=false` beats membership and *"turning a feature off"* is never *"emptying a table"* | ~~M~~ → **S/M** | d0·b1 (⭐ and `TERM-039` sits behind it) | **tier 0–2** — the cheapest reversal class in the register | CLEARED | ✅ **VERIFIED-HERE** (§9 V1–V3) |

⭐ **Its own exit condition is item 37 §4 item 4 and it is not a formality:** the OFF state watched
to actually kill something, **before** the ON state is trusted — *"a kill switch nobody has watched
actually kill something isn't a kill switch, it's a variable."*

#### Lane C — THE HONEST BLANK. The thesis-aligned lane, and it is not the cheap lane.

⭐ **Why this is coverage work and not polish.** Item 9 §4.1's prescription for a boundary no build
closes: *"render an honest blank and say why, because a member who learns the boundary once stops
looking, while a member who finds a silently missing number goes and opens the other tab
permanently."* Under an attention thesis, **saying what we do not have is coverage.**

| RM | ticket | what it is | SZ | DEP | ROLLBACK | LIC | VERIFIED |
|---|---|---|---|---|---|---|---|
| **RM-N12** | `TERM-019`'s **RAIL ONLY** (`FB-S8-01`) ⚰️ RECUT | A rail asserting every panel uses the shared provenance set. ⛔ **There is no extraction half left** — all four primitives ship with tests plus four contract modules. `b11`, and item 30 §7.3 ranks the rail among the five worth doing first. ⛔ Its **ADOPTION** half may not run concurrently with a lane editing the same panels (item 30 §7.1) | S rail (M adoption, not here) | d0·**b11** | tier 4 pref / 3 | CLEARED | ✅ **VERIFIED-HERE** (§9 V8) + item 30 |
| **RM-N13** | `TERM-028` (`FB-A1-01`) | An honest blank for futures instead of an **Unsuitable-class** source. This is **NGB-02's own prescription** — item 10's first *"unclosable"*, whose remedy is *"render an honest blank"* rather than a number — and the workaround it replaces is at `FuturesStrip.jsx:136`, `TV_ONLY = new Set(['BTC', 'VIX'])`, i.e. the chart for those symbols is handed to TradingView | S | d0·b0 (soft on `FB-S8-01`) | tier 4 pref / 3 | CLEARED | ✅ **VERIFIED-HERE** (§9 V10) + item 30 |
| **RM-N14** | `TERM-029` (`FB-A10-01`) | The GEX assumption label, **at the number**. ⛔ Not the regime-vocabulary problem — *"a regime with two authorities cannot have one vocabulary"* is `TERM-071`/`TERM-041`'s and is LATER. This row is the label | S | d0·b0 | tier 4 pref / 3 | CLEARED | item 30 ⚠️ not re-grepped here |

#### The gate — it cannot share a lane

| RM | ticket | what it is | SZ | PAR | VERIFIED |
|---|---|---|---|---|---|
| **RM-N15** | `TERM-018` (`FB-OBS-09`) | **Prove every guard can fire** — every guard in lane A observed **red before green**, with an AST rail and a control. A shipping precondition, not a feature | M | ⛔ **No** — it *is* verification, and verification collapses to one (§0.3) | item 30 |

### 2.3 ⛔ THE NOW EXIT GATE — six clauses, and NEXT may not start before all six

1. **`TERM-018` green**, with every band-1 guard observed red before green, an AST rail, and a
   control so it cannot pass for the wrong reason.
2. **A p95 prints for both timeframes** on a pod ≥ 300 s old — CARD 16's replacement gate
   (p95 ≤ 250 ms per timeframe), with the tier mix reported **beside** it and never as pass/fail,
   and the one tier alarm kept: any `fetch`/`miss` share above ~10 % on intraday during **RTH**.
3. **The quiet window is declared** and stated with its `deployments_sampled` (RM-N01).
4. **Rung 0 exists and has been watched to kill**: ledger row with `status: dark`, per-request rail,
   literal-default rail, and the OFF state observed killing something.
5. **MG-0 and MG-1 hold on every commit in NOW** — the vocabulary gate (TERMINAL-CURRENT /
   TERMINAL-NEXT, never bare "UCT Terminal") and the additive gate (no changed line in a shared
   file, only an added entry), instrumented by `git diff --stat` plus the standing calendar rails.
6. **RM-N02 is SENT.** ⛔ **The answer is not an exit condition** — nobody on this box controls it,
   and making a vendor reply a gate would stall the roadmap on a `vend` edge.

### 2.4 ⛔ WHAT NOW DELIBERATELY EXCLUDES, AND WHY EACH EXCLUSION IS A RULE RATHER THAN A PREFERENCE

* **BRK-01's build.** It waits on RM-N02, it has no ticket (H1), and its only shipped machinery
  rides an X-class source — **surfacing it as-is would publish an X-class-sourced derived work**
  (NGB-03). ⛔ Under the ordering principle this is the one exclusion that costs something real, and
  it is stated rather than smoothed.
* **`TERM-020`, `TERM-021`, `TERM-022`, `TERM-023`.** Four `TIER-NONE` store-shaped tickets whose
  reversal plan is unwritten (item 30 H2, §3). Item 30 §7.1: they *"should not run concurrently with
  each other… running three unreversible changes in one window is how a bad week becomes a bad
  month."*
* **Bands 4 and 5, except the one row I verified.** GAPS 2's rule, adopted in §0.4.
* **Any route.** `TERM-026` (`FB-S9-01`) must precede route work — *"a class that recurs after
  remediation is not a bug that needs fixing again; it is a missing check"* — and doing the fixes
  first *"produces a state that looks finished and is not."* It is at NEXT's head.
* **`TERM-019`'s adoption half**, which collides with lane C's own panels.
* **A fourth lane** (§0.3).

---

## 3. NEXT

### 3.1 Entry, and the honest statement about capacity

**Entry: all six clauses of §2.3.** Still three lanes — and ⚠️ **parallelism decays with depth**
(item 29 §5.1), so NEXT's third lane is expected to converge into the other two before NEXT ends.
This file says that rather than promising three lanes at the end of a horizon whose graph is known
to narrow.

### 3.2 The lanes

| RM | lane | sequence | why this order |
|---|---|---|---|
| **RM-X01** | **A — the floor's remainder** | `TERM-015` → `TERM-016` → `TERM-013`; then `TERM-014` and `TERM-017` **only if RM-N01 landed** | `FB-OBS-02`/`FB-OBS-04` cannot ship before `FB-S7-03` (done in NOW); `TERM-014`/`TERM-017` inherit band 0's hold through `TERM-007` and *"cannot produce an honest number before it"* |
| **RM-X02** | **B — the auditor, then the first route** | `TERM-026` **first** → the first Terminal-Next route **with its route-resolution rail in the same commit** (CX-11, MG-2) → MG-4's persisted-key discipline on the first key it writes → add the routes to `tools/hub_nav_smoke.py` (RB-6, never a second smoke) → the **pre-authored rollback branch, pushed and gated green with the flag already false** (item 37 §4 item 7) | ⛔ The rail before the fix (item 29 H3). ⛔ And MG-4 is *"the gate most likely to be skipped under pressure"* — three production incidents in six days, because **the trigger is JavaScript and the rail is Python** |
| **RM-X03** | **C — the store lane, serialised** | `TERM-083` (`FB-X1-02`: the backup rail **and the restore rehearsal**) → `TERM-021` → `TERM-022` (with `TERM-072` as its named proof case) | ⛔ H5: the versioned document is not the safety feature in an unbacked store. ⛔ One `TIER-NONE` store-shaped ticket in flight at a time |
| **RM-X04** | **free-floating, any lane** | `TERM-030`, `TERM-033`, `TERM-027`, `TERM-036` | item 30's cheap-and-clear four, displaced from NOW by §2.2. Four different directories, each one surface or one constant — ⭐ the only rows in this roadmap that may move between lanes freely. `TERM-036` also reduces an X-class exposure (dividends off yfinance) |
| **RM-X05** | **behind RM-N04** | `TERM-032` (`FB-A6-01`) — say *"coverage n=0"* instead of rendering an empty transcript panel | item 29 §7.1 #1: a hard `meas` edge on RG-15 that its own `Depends on` field omits. ⛔ If the re-read says the corpus is populated, this row collapses to a **monitor**, not a feature (CARD 30 §2) |
| **RM-X06** | **behind lane C's head** | `TERM-019`'s **adoption** half; `TERM-050` (`FB-I1-01`) sequenced **with** it rather than after it | item 17 §5: item 16 says they are *"two halves of one build"*. ⛔ Adoption never concurrent with a panel-editing lane |
| **RM-X07** | ⭐⭐ **BRK-01 increment 1 — conditional, and it has no ticket** | see §3.3 | the ordering principle's first coverage row, unblocked by RM-N02 or not at all |

### 3.3 ⭐⭐ BRK-01 increment 1 — the biggest break-out's first buildable slice

**What it is.** A member-facing option-chain surface: the chain grid with the full greek set and an
IV-rank field in the page header, off a **re-sourced** chain. ⛔ **Not** the vol surface, **not** the
risk-profile graph, **not** the backtester — those are LATER increments, and slicing the row is what
keeps it from being an XL nobody starts.

**Why it is here and not in NOW.** RM-N02. **Why it is not in LATER.** It is the largest coverage
hole in the estate, both units of account agree on it, and four uncoordinated documents name it the
top gap.

**Licensing.** ⚠️ **OPEN (new source)** for the historical-chain and IV-history half. For the live
half it is CLEARED **only if** the answer to RM-N02 is that a tier we already hold carries chains —
which item 9 §8 records as **NOT DETERMINED**. ⭐ Either answer is progress: a yes makes this a
build; a no converts BRK-01 into a second-source question, and it moves to LATER with `BRK-02`'s
shape rather than sitting in NEXT as a promise.

**Charter.** ✅ **IN**, including strategy backtesting (CARD 28, ruled on a genuine silence after
naming the documents searched). ⛔ **And the four edges it may not cross, restated at the point of
work rather than left in a card:** no *"run this strategy"* or *"execute"* affordance of any kind,
live or paper (NG-01); no broker write path including a send-to-broker bridge (NG-03); no
position-of-record — a simulated portfolio is a computation, never an account state (NG-02); and
⚠️ **fill assumptions stated on the surface**, because a backtest reporting returns without
disclosing how it filled is the unfalsifiable trust claim NG-17 forbids. Market Chameleon's own
published caveat is item 9's named *"in-charter shape to copy"* (FT-013), and `cotAnalogs.js` — a
mounted, live backtest — already sets the standard by stating its proxy and its no-lookahead rule in
the code that computes it.

⛔ **No `TERM-` id is minted here.** This increment is **owed to item 30** as a register row, and its
size, dependencies and rollback tier are item 30's to set. ⚠️ It will also need a ruling on whether
`TERM-069`'s retirement is subsumed by it or contradicts it (§8 item 3).

### 3.4 ⛔ THE NEXT EXIT GATE

1. **One Terminal-Next surface reachable by `rollout:terminal-next`** behind the master switch, with
   its route rail in the same commit and every key it writes carrying both halves of MG-4 (an
   allow-list row **and**, if it supersedes an existing key, a read-fallback shim).
2. **MG-7 discharged:** every CARRY-REQUIRED row in item 26 §3's parity matrix named as one of
   *carried · replaced · deliberately retired*. ⛔ A dual run with no end condition is not shipped —
   and at this population *"the migration's evidence standard is not measurement, it is the parity
   matrix."*
3. **RM-N02's answer recorded either way**, and BRK-01's shape ruled from it.
4. **A pre-authored rollback branch**, pushed and gated green with the flag already false, re-gated
   whenever master has moved more than five commits ahead of it or touched a file it touches.
5. **The member-impact paragraph carrying the reach sentence verbatim**, held identical by a rail:
   a flip reaches a member on their next authenticated request or reload and **does not reach a tab
   mid-session**. ⛔ No rung promises an instant close-down on an open tab.

---

## 4. LATER

### 4.1 ⛔ LATER IS A QUEUE WITH NAMED CONDITIONS, NOT A DUSTBIN

Three sub-classes, and **every row names the thing it waits on**:

* **(a) a gate** in NOW or NEXT;
* **(b) an answer nobody on this box controls** — a vendor, a purchase, an owner scope ruling, a
  desk observation;
* **(c) a grep nobody has run** — the 48 band-4/5 tickets still unchecked after H4.

⛔ **Nothing is in LATER for being unimportant.** Item 30 §2.9: *"Reading band 5 as a rejection band
would be the worst misuse of this register"*, and two of its rows carry a cost of delay that
outranks their band.

### 4.2 The rows

| RM | what | id | waits on | LIC |
|---|---|---|---|---|
| **RM-L01** | BRK-01 increments 2–4: implied-vol **surface**, the **risk-profile / payoff** graph, the **options strategy backtester** | ⛔ no ticket — owed to item 30 | RM-X07, and the same vendor answer | ⚠️ OPEN |
| **RM-L02** | BRK-10 — the **trailing** reliability of a print's implied move | ⛔ no ticket | RM-N02's IV/straddle history. ⚠️ And its remaining half is **narrower than item 9's row reads**: item 14 §5.1 withdrew `WF-C03`/`WF-C06` because `ImpliedVsRealized` ships and is a section **hero** (§8 item 8) | ⚠️ OPEN |
| **RM-L03** | BRK-03 — alert authoring: one grammar over typed subjects, field-to-field comparison, a promotion path from a saved query | `TERM-025` (band 2) · `TERM-086` (the inbound receiver — the strongest-evidenced ADDRESSABLE row, tool owner-confirmed twice) · `TERM-048` · `TERM-062` | `TERM-011` (done in NOW) for `TERM-086`; the S7 filing-watch parity rail before any predicate change | CLEARED |
| **RM-L04** | BRK-04 — mobile push as an alert channel | ⛔ no ticket; item 16 records mobile as a **missing row**, not a rejected capability | a decision that it is wanted. ⚠️ NG-10 declines workspace **parity** and says nothing about push | CLEARED |
| **RM-L05** | BRK-05 — config-as-citation: disagree with the machine one piece at a time | `TERM-087` | `TERM-079` | CLEARED |
| **RM-L06** | BRK-06 — programmatic egress: skill file + endpoint whitelist, then an MCP surface | `TERM-061` | `TERM-080` (per-route rate limits **before** any programmatic client) and `TERM-053` | ⚠️ egress of vendor data is **R-class** (item 9 §8) |
| **RM-L07** | BRK-07 — member-facing surface status at the point of use | `TERM-039` | ⭐ `TERM-068` — so **NOW's lane B unblocks it** | CLEARED |
| **RM-L08** | BRK-08 — a fixed, published dealer-positioning vocabulary | `TERM-071` **then** `TERM-041` | ⚰️ `TERM-041` is **impossible** while two regime authorities exist; `TERM-071` names one | CLEARED (⚠️ the chain source is `LCQ-02`'s, which RM-N02 addresses) |
| **RM-L09** | BRK-09 — transcript & filing retrieval at measured coverage | `TERM-032` is the monitor half | ⛔ RM-N04 first. CARD 30 §2 **excludes it from the top of any roadmap** until the re-read | ⚠️ FMP AI-processing right is **U** |
| **RM-L10** | BRK-02 — the screen universe | ⛔ **not a build**: `TERM-005` is a **purchase**, and the engineering half is a universe abstraction behind `TERM-022` | an owner purchase decision. Item 10: *"a Finviz no is a capability deletion, not a swap"* | ⚠️ **LIC-06** — no terms document exists at all |
| **RM-L11** | COV-01 seasonality | ⛔ no ticket | nothing but a decision — ⭐ `LCQ-07`, **the only gap row in item 9 with no licensing question at all** | CLEARED |
| **RM-L12** | COV-04 filing-to-filing blacklining · ownership depth from EDGAR Form 4/13F | `TERM-045` | `TERM-022` | CLEARED — SEC EDGAR is class A and already consumed |
| **RM-L13** | ⭐ The per-ticker history join — *"the only capability where UCT can be first rather than behind"* | `TERM-049` (XL) | `TERM-020`, `TERM-023`, `TERM-083`; and item 27's scope decision. ⚠️ `MEAS-FIGI` is **narrower than item 29 ranks it** (§8 item 10) | CLEARED |
| **RM-L14** | The unexposed assets: the decision record, the wire payload replay, the episodic-pivot base rate, the curriculum loader | `TERM-088`, `TERM-089`, `TERM-090`, `TERM-091` | `TERM-023` for `TERM-088`; and ⛔ **the transport is undesigned** for three of them (item 30 GAPS 5) | CLEARED |
| **RM-L15** | The four band-0 items NOW excluded | `TERM-001`, `TERM-005`, `TERM-009`, `TERM-010` | RM-N01's measurement · a purchase · a member-safety ruling · a curation decision | mixed |
| **RM-L16** | The end of coexistence: MG-8's consumer re-census, then the six-part retirement sequence, with CX-7's permanent URLs | ⛔ no ticket — item 26 owns the gates | MG-7 (NEXT's exit gate). ⛔ **At the countdown the consumer set is RE-DERIVED from the code and the derivation pasted into the retirement record** — base rate 1 in 3, and both overturns were a **new** consumer arriving during the window | CLEARED |
| **RM-L17** | The remaining bands: band 4's dependents and band 5's rest | 49 register rows | ⛔ **(c) a grep each.** After H4 the prior is empirical: one of one checked moved. Item 30 names `TERM-066`, `TERM-067`, `TERM-075`, `TERM-079`, `TERM-081` as highest-risk | mixed |
| **RM-L18** | item 37's remaining stage-one prerequisites: the owner's explicit **go per surface** (not a bundled ship-everything), and the Restricted-tier confirmation | ⛔ no ticket — item 37 owns them | NEXT's first surface existing | CLEARED |
| **RM-L19** | COV-05 people/exec intelligence · COV-07 estimate history · COV-08 depth of book · COV-09 disclosure feeds | ⛔ no ticket | ⛔ **(b)**: each needs a feed we do not hold. ⭐ And item 9's own finding: *"the expensive gaps are, so far, the unmotivated ones"* — **no job asks for any of the four** | ⚠️ OPEN (`LCQ-04`, `LCQ-05`) |

---

## 5. NOT PLANNED

⛔⛔ **This class is populated on purpose. A roadmap whose every row is eventually-yes is a wish
list.** Two of the sub-classes below are what keeps the gap count honest: a **structural break-out**
and an **NGB row** must never appear in a gap horizon or a backlog band (item 9 §0.6, §4, §4.1;
non-goals §2.1, §5). ⛔ **Every row cites a ruling that already exists — this file originates
none** (§0.5), and nothing here graduates by waiting.

### 5.1 Execution and order management — PERMANENT, and no horizon ever

| RM | not this | ruling | the reason, in its own terms |
|---|---|---|---|
| **RM-P01** | Live order execution and order management | `STR-01` · NG-01 · NG-02 · `GOVERNING_PRINCIPLES.md` §13 | *"No execution or order management."* ⭐ CARD 25 §2 names it as **the boundary the thesis runs to**, not a coverage failure: a workflow ending in *"place the trade"* leaves our site **by design** |
| **RM-P02** | Paper trading / simulated order entry | `STR-02` | Order simulation is order entry. ⭐ And item 13's own second reason: UCT20/Book already publishes **real** tracked performance including losses |
| **RM-P03** | Conditional / script-generated orders | `STR-03` | The scripting object's contract **is** order generation |
| **RM-P04** | Funded-account positions, balances, fills as a **position-of-record** | `STR-04` · NG-02 | Requires a funded brokerage relationship. ⚠️ **The SnapTrade broker mirror is NOT this row** — it reads member-owned data and places no orders |
| **RM-P05** | The **order** third of TradingView's `Alt+Ctrl`+cursor gesture | `STR-05` | ⭐ The gesture splits cleanly: the **alert** and **price-line** thirds are in charter and are live BRK-03/BRK-05 ideas. A row recording the gesture whole would export the wrong lesson |
| **RM-P06** | A send-to-broker bridge, a basket hand-off, a one-click stage-the-order | NG-03 ⚠️ **DERIVED (integrator-ratified 2026-09-26, CARD 30) — do not cite it as §13** | An order path under another name. ⭐ And under CARD 25 a bridge is not even a win: *"a harden/bridge verdict is not a success state"* — it keeps the incumbent permanently in the loop |

### 5.2 NGB — no purchasable remedy. A boundary, never a backlog item.

⛔ **The line that keeps this class honest** (item 9 §4.1): *"We do not buy this feed" is a GAP —
purchasable, and it lives in the open-licensing list. "This feed cannot be bought, or has no terms
to buy" is NGB — a boundary.* Conflating them *"either hides a purchasable gap behind a shrug, or
promises a build against data nobody can license."*

| RM | not this | ruling | the reason |
|---|---|---|---|
| **RM-P07** | Matching best-in-class reference **DATA** depth | `NGB-01` · NG-11 | The gap is a data-operations organisation, not a feature |
| **RM-P08** | Licensed real-time futures/index quotes at best-in-class depth | `NGB-02` · **LIC-08** | ⭐ Its prescription **is** RM-N13's honest blank, which **is** planned. The boundary is not planned; saying so is |
| **RM-P09** | Buying a licence from an **X-class** source — Yahoo/yfinance, TheFly-direct, model training on X/Reddit content | `NGB-03` · **LIC-08** | ⛔ **Re-sourcing is a GAP and is planned** (`TERM-036`, `TERM-046`, `TERM-069`, RM-N02). Buying a Yahoo licence is not a thing that exists |
| **RM-P10** | A vendor relationship with no terms document to comply with | `NGB-04` · **LIC-06** | No engineering closes a missing contract |
| **RM-P11** | Expert-call and broker-research libraries | `NGB-05` | A licensed content estate built by acquisition. ⚠️ Item 9 files this as **a judgement**: if it turns out purchasable it becomes an open licensing question, not a horizon row |
| **RM-P12** | A Bloomberg-IB-shaped chat widget; manufacturing a network effect | `NGB-06` · NG-12 · anti-pattern N4 | *"Not clonable without the network."* ⭐ Building the form of the moat and none of its substance |

### 5.3 Owner rulings — PERMANENT, no re-open trigger

`NG-04` **no free tier** · `NG-05` **no tier axis and no tier-comparison surface, ever** — no pricing
table, no upgrade affordance, no locked-behind-a-higher-tier state, no per-tier entitlement rows;
the entitlement axis is a **binary** (CARD 17, owner verbatim: *"there is one paid tier only that is
it"*) · `NG-06` **no metering as a product mechanism** (⭐ a member-visible meter that *explains* a
cap is an honesty mechanism and survives as `TERM-078`) · `NG-07` **no public Substack wire, ever** ·
`NG-08` **no renaming of persisted preference or widget keys** ⇒ CX-2 and CX-3 are the planned
consequence: TERMINAL-NEXT writes **new** keys under a **new prefix** and registers a **new** widget
type id, leaving `calendar` bound. ⛔ **Cohorts are not tiers**, so NOW's lane B is untouched by
`NG-05`.

### 5.4 ⚠️ V1 bounds — the only rows here that can leave, and only on their named trigger

| RM | not this | ruling | re-open trigger |
|---|---|---|---|
| **RM-P13** | FX, fixed income, crypto as chartable/screenable universes | `NG-09` · `STR-06` · §13 by name | **OI-05** widening the asset-class scope. ⚠️ **The live edge, recorded not resolved:** a futures snapshot ships and hands the BTC/VIX chart to TradingView (§9 V10) — item 9 declined to file that as either a gap or a structural row, and RM-N13 renders the blank without widening anything |
| **RM-P14** | Mobile **workspace parity** | `NG-10` | An owner ruling that TERMINAL-NEXT is a phone product, or telemetry distinguishing mobile from desktop sessions. ⚠️ **Mobile push (BRK-04) is a different row and is in LATER**, not here |

### 5.5 Scope statements — not deferrals

`NG-13` A14 Portfolio & Risk beyond the shipped `/portfolio-heat` door (CARD 4: *"out of this
program, and that is a scope statement, not a deferral"*) · `NG-14` an absolute production capacity
number, or a second Railway environment to obtain one (CARD 15; the coexistence work already
rejected the second environment on member-data grounds) · `NG-15` per-broker analyst-level estimates
(*"the honest answer is that this gap should stay open"*) · **the Wisdom Loop's member surface** —
⛔ it ships ADMIN-MOUNTED at real scale and is **another programme's**; a ticket here would be a
second authority over its roadmap · **anything inside `StockChart.jsx`** — item 9's A2 ruling is
*"binding, not advisory"*, and item 16 drafted two such items and cut both.

### 5.6 Product-behaviour and method non-goals

`NG-16` no course, certification, learning tab, read-only demo board or guided tour **as the answer
to complexity** (⚠️ **not** an argument against the curriculum asset, which is `TERM-091`) ·
`NG-17` no unfalsifiable trust claim — *"no hallucinations"* and its relatives · `NG-18` no surface
that publishes two counts of itself, and no second authority over one value · `NG-19` no emoji or
icon as data semantics, and no colour carrying two meanings across surfaces · `NG-20` **no invented
or simulated users and no claimed preference nobody measured** — ⛔ including a simulated verdict on
the MVP, which CARD 22 refused as *"evidence about the simulation"* · `NG-21` no hand-typed count ·
`NG-22` no ledger cell treated as authoritative · `NG-23` no asserted flag state · `NG-24` no single
denominator across the two products.

### 5.7 Mechanisms already ruled out — named so nobody proposes one as an implementation of a planned row

Percentage as an entitlement rung (RB-1, RB-10, CX-9 — it buckets **browsers, not users**, over a
population where the precedent it would copy ramped across ~200 accounts) · a cohort in
`user_preferences` (member-self-grantable) · a `/api/flags` endpoint (Wave K *"deliberately did not
add one"*) · a second smoke instrument (RB-6 — two smokes would be two authorities on *"is the app
navigable"*) · a third copy of the cohort logic · **option D** (a tab inside TERMINAL-CURRENT) and
**option C** (a mode inside `/charts`) (CX-1) · stopping a dark run with a **DELETE** against member
data (CX-6) · `DROP TABLE j2_playbook_entries` (a runbook rules **PARKED** — it would break account
deletion; §8 item 7) · retiring `GET /api/tweets/tape` (it has a live caller) · **arming
`WATCHDOG_ENABLED`** (CARD 18 — *not yet*, with a named condition: one observation window spanning a
market open **and** a heavy-job window) · a board-level aggregation endpoint (the 23.83 MB hazard) ·
a corporate-actions ledger (CARD 5) · merger events (CARD 6) · changing the deploy cadence ·
⛔ **deploying less as a remedy for the memory leak** — *"the fix for a counter a deploy destroys is
to move the counter, never to deploy less."*

⛔ **And item 16's 22-row not-build list stands in full, by pointer and not by copy.** No row in §2,
§3 or §4 contradicts any of the 22, which item 30 checked row by row.

### 5.8 ⛔ WHAT IS *NOT* IN NOT PLANNED, AND IS ROUTINELY MISTAKEN FOR IT

1. **A coverage gap.** Non-goals §9.5: *"Nothing in this file may be cited to close a gap by
   declaring it out of scope."* Every BRK and COV row has a horizon (§6).
2. **Historical backtesting.** ✅ **IN CHARTER** (CARD 28) and already shipping in a mounted
   `cotAnalogs.js`. ⛔ A reader who finds *"no execution"* and files backtesting under it has made
   the exact error CARD 28 exists to prevent.
3. **E1 people / company intelligence** — *"genuinely undecided, not a §13 exclusion"*. It is
   RM-L19, with an OPEN licensing flag.
4. **Mobile, as such.** `NG-10` declines workspace parity only.
5. **The Schwab data path and the Substack channel.** Both live, both untouched, neither inside the
   non-goal beside it.
6. **Band 5.** Item 30 §2.9 again: it is *"not a rejection band"*. Every band-5 row in this file is
   in NOW, NEXT or LATER — none is here.
7. **Permanent coexistence.** CX-8 is a **default**, vetoable by the owner; what it refuses is
   *arriving* at permanent coexistence without anyone choosing it. A ruling that it is the product
   would retire MG-7 and MG-8 and is legitimate.

---

## 6. THE CROSSWALK — every break-out row has a horizon, and four of them have no ticket

⭐ **The check this table exists to make.** Under an aggregation thesis, a BRK row with **no
horizon** is a member keeping a tab open that nobody has decided anything about. There are none.
⚠️ **But four rows have no `TERM-` id**, which is a different and real hole — the roadmap can
sequence them and no implementer can pick them up.

| item 9 row | horizon | ticket | LIC |
|---|---|---|---|
| **BRK-01** pre-trade options analysis | **NOW (the ask)** → NEXT (increment 1) → LATER (increments 2–4) | ⛔ **NONE — owed to item 30** | ⚠️ OPEN |
| **BRK-02** screen universe + authoring expressiveness | LATER | `TERM-005` (a purchase) + `TERM-022` (the abstraction) | ⚠️ LIC-06 |
| **BRK-03** alert authoring | LATER | `TERM-025`, `TERM-086`, `TERM-048`, `TERM-062` | CLEARED |
| **BRK-04** mobile push | LATER | ⛔ **NONE** — a missing row, not a rejected capability | CLEARED |
| **BRK-05** config-as-citation | LATER | `TERM-087` | CLEARED |
| **BRK-06** programmatic egress | LATER | `TERM-061` (behind `TERM-080`, `TERM-053`) | ⚠️ R-class egress |
| **BRK-07** per-surface status disclosure | LATER, ⭐ unblocked by **NOW's lane B** | `TERM-039` | CLEARED |
| **BRK-08** dealer-positioning vocabulary | LATER | `TERM-071` then `TERM-041` | CLEARED |
| **BRK-09** transcripts at measured coverage | **NOW (the read)** → LATER | `TERM-032` is the monitor half | ⚠️ U on AI processing |
| **BRK-10** trailing implied-move calibration | LATER | ⛔ **NONE** | ⚠️ OPEN |
| `STR-01`…`STR-06` | **NOT PLANNED** §5.1 / §5.4 | ⛔ never a ticket, at any priority | — |
| `NGB-01`…`NGB-06` | **NOT PLANNED** §5.2 | ⛔ never a ticket | — |
| `COV-01`, `COV-04`, `COV-06`, `COV-10`, `COV-11` | LATER — ⭐ need **no new data at all** | mostly ⛔ no ticket | CLEARED |
| `COV-02`, `COV-03` | NEXT/LATER with BRK-01 (same feed) | ⛔ no ticket | ⚠️ OPEN (`LCQ-01`) |
| `COV-05`, `COV-07`, `COV-08`, `COV-09` | LATER RM-L19 | ⛔ no ticket | ⚠️ OPEN |
| `NUL-01`…`NUL-05` | ⛔ **not gaps** — where nobody is the incumbent; `NUL-01` is RM-L13 | `TERM-049` | CLEARED |

---

## 7. THE SEQUENCING RULES THIS ROADMAP IS WRITTEN TO

1. **Close the biggest break-out first.** Never promote an item because it is cheap (§0.1).
2. **No unverified build in NOW** (§0.4).
3. **Three lanes, one gate, one merge in flight, zero lanes in flow-worker watch paths during RTH.**
   No fourth lane, however small it looks (§0.3).
4. **The rail before the fix; the backup before the versioning; the channel split before the
   monitors** (item 29 H3 — the three inversions that otherwise produce a finished-looking wrong
   state).
5. **`FB-S9-01` before any route work**, and every route ships its route-resolution rail in the
   **same commit**.
6. **One `TIER-NONE` store-shaped ticket in flight at a time**, and its reversal plan in the same
   commit as the change — never in a follow-up.
7. ⛔ **Any diff containing a new `setPref(` runs `tests/test_preference_key_validation.py`, whatever
   language the diff is in.** The trigger is JavaScript and the rail is Python; it has been skipped
   three times in six days by three different landings, and on a migration the 400 lands on the very
   surface meant to prove it can replace TERMINAL-CURRENT.
8. **A verification window is a scheduling decision**, because this box is also the data producer
   for member-facing jobs (§0.3).
9. **Every flip is verified by a new boot plus an in-process read, never `--kv`**; the reach sentence
   is verbatim wherever it appears; and ⛔ rollback prefers `--set …=0` over `delete`.
10. ⛔⛔ **A re-cut of any bar in this roadmap must QUOTE THE READING THAT FAILED** (CARD 22's
    anti-waiver clause). Without that, *"we re-cut the bar"* and *"we failed and moved it"* are the
    same sentence.

---

## 8. CONTRADICTIONS CARRIED, NOT RESOLVED

1. ⚠️ **Item 30's "49" names two different sets.** §2.9 and GAPS 1 both say *"49 of the 93 tickets
   get a register row and no 17-field package"*, while its own §10 derivation prints **93 rows and
   34 packages**, and its own enumeration of that class is band 0 + band 4 + band 5. GAPS 2 then uses
   **49** for the *unchecked* set, which is bands 4 + 5 exactly. ⛔ Both sentences are item 30's and
   neither is repaired here. ⭐ The consequence for a sequencer is small and worth stating: the
   *unchecked* set is the one that matters to §0.4, and it is bands 4 and 5.
2. ⚠️ **`TERM-021`'s depth.** Item 30's register: `d0`. Item 29 §6 and H3: `FB-S5-01` waits on
   `FB-X1-02`. Item 29 §7.2 explains the mechanism — the edge is declared only on the prerequisite's
   side. **This file sequences on item 29's reading (§3.2 RM-X03) and says so.**
3. ⚰️ **`TERM-069` versus BRK-01.** A retirement ticket (*"retire the yfinance/Black-Scholes chain
   leg"*) and the programme's largest coverage hole point at the same module, and **neither names the
   other**. ⛔ Not resolved: whether the retirement is subsumed by BRK-01's increment 1 or contradicts
   it is a ruling somebody owes.
4. ⚠️ **Item 37's S2 rung.** It reads *"⛔ ABSENT today; the only rung that needs a build"*; CARD 31
   and item 26 §1.1 establish that the store, the per-user read, the assignment functions and the
   CLI all ship, with a second live cohort proving it generalised. Item 37's sentence is uncorrected
   in its own file. **This roadmap builds against the corrected reading** (H3).
5. ⚠️ **The one-week execution roadmap's "long pole"** is *"D2 Canonical Data Model"*; item 30 recut
   that ticket to **CP3 only**, because CP1 and CP2 ship and the file itself names the next
   checkpoint. Reported (§0.6).
6. ⭐ **Item 27's MVP incumbent is not the biggest break-out.** The MVP displaces finviz.com-by-hand
   for a chart-inspection step; this roadmap's first coverage row is BRK-01. ⛔ **Not an error in
   either** — item 27 §2 item 1 already records that *"the two orderings disagree, and the
   disagreement is a finding rather than an error in either."* They are different instruments: item
   27 measures displacement, item 28 sequences coverage.
7. ⚰️⚰️ **A live second authority over one decision.** `api/services/journal_two/db.py:2157`'s
   docstring still instructs *"manual DROP TABLE after ~30 days of green prod"* for
   `j2_playbook_entries`, which a runbook rules **PARKED — DO NOT DROP** because dropping it breaks
   account deletion. ⛔ The instruction is in the docstring an engineer reads; the ruling is in a
   runbook they have no reason to open. Carried as item 26's CX-C1; §5.7 names it NOT PLANNED.
8. ⚠️ **BRK-10's size.** Item 9's row is written against the trailing calibration being absent; item
   14 §5.1 withdrew two workflows because `ImpliedVsRealized` **ships and is a section hero**. Both
   are dated the same day. Reported; item 9's row is not re-cut here.
9. ⚠️ **My own webhook count is not item 25's.** I derived a count of **files** referencing
   `DISCORD_WEBHOOK_URL` (§9 V11); item 25 says *"thirty modules"*. ⛔ Different pattern, different
   unit — *a count is comparable only to a count produced the same way*, so I do not correct its
   number and do not carry mine as a correction.
10. ⚠️ **`MEAS-FIGI`.** Item 29 §6 ranks it above eight nodes and calls it *"not clearable by this
    programme"*; `01-existing-system/capability-ledger.md`'s own correction banner records it
    **settled from source** — the reconciler already reads `composite_figi` off the Massive reference
    response — with the question narrowed from *"does the field exist"* to *"what fraction of the
    universe has one"*. ⛔ Reported. It makes RM-L13 cheaper than item 29's table implies, and I do
    not re-rank that table.
11. ⚠️ **This branch is not where the code is.** The preamble records this worktree's HEAD as
    `a4ef6f240`; it now reads `8f14225bb` (§9), and every code read in this file was taken from
    `origin/master` at `2e0598bfa`. ⛔ A statement about this branch's tree is not a statement about
    production.

---

## 9. DERIVED COUNTS AND VERIFICATIONS — every number, with the command that produced it

⛔ **Nothing below is typed beside the artifact it describes.** Counts carried from another document
are that document's own measurement, cited in place and never re-derived here (item 30 §10's rule).

### 9.1 About this file — run after writing

```bash
F=docs/terminal-research/10-roadmap/roadmap.md

grep -cE '^\| \*\*RM-N[0-9]{2}\*\*' "$F"    # NOW rows
grep -cE '^\| \*\*RM-X[0-9]{2}\*\*' "$F"    # NEXT rows
grep -cE '^\| \*\*RM-L[0-9]{2}\*\*' "$F"    # LATER rows
grep -cE '^\| \*\*RM-P[0-9]{2}\*\*' "$F"    # NOT PLANNED rows (tabled; §5.3/5.6/5.7 are prose registers by pointer)
grep -cE '^\| \*\*RM-N[0-9]{2}\*\*.*VERIFIED-HERE' "$F"   # NOW rows I verified myself at origin/master
grep -oE '^\| \*\*RM-[NXLP][0-9]{2}\*\*' "$F" | sort | uniq -d   # duplicate-id check: must print nothing
grep -oE 'TERM-[0-9]{3}' "$F" | wc -l              # ticket references, non-distinct
grep -oE 'TERM-[0-9]{3}' "$F" | sort -u | wc -l    # distinct ticket ids this file mentions
```

**Outputs, run against the finished file, 2026-09-26:**

```
NOW rows                         15
NEXT rows                         7
LATER rows                       19
NOT PLANNED rows (tabled)        14
NOW rows VERIFIED-HERE            7
duplicate-id check              (printed nothing)
TERM references, non-distinct    154
distinct TERM ids mentioned       64
```

⚠️ **The last figure is a mention count, not a coverage claim.** It includes ids named in §5 as *not*
being built and ids named in §8 as contradictions, so it must not be read as *"this roadmap places 64
of item 30's 93 tickets"*. The register's own total is item 30's measurement (its §10), and the
tickets this file leaves entirely unplaced are bands 4 and 5's unchecked remainder — which GAPS 1
says is deliberate.

### 9.2 Against `origin/master` — the eleven first-hand verifications

```bash
git rev-parse HEAD origin/master
# 8f14225bbfb4555888f2445dfcaf18aafe57d4d0   (this docs branch)
# 2e0598bfa514303fe542c4473bd2f89470d04ec2   (origin/master, every read below)

# V1 — rung 0 is absent from source (H3, RM-N11)
git grep -c "TERMINAL_NEXT_ENABLED" origin/master                       # (no output = zero files)
git grep -ho "TERMINAL_NEXT[A-Z_]*" origin/master -- api app/src docs | sort | uniq -c
#      5 TERMINAL_NEXT_MONITOR_ENABLED

# V2 — the cohort machinery ships (H3, H4)
git show origin/master:api/services/rollout.py     | wc -l              # 347
git show origin/master:tools/rollout_cohort.py     | wc -l              # 147

# V3 — the client cannot know it is in a cohort (RM-N11 item 4)
git grep -n "cohorts" origin/master -- api/routers/auth.py              # (empty)
git grep -n "_access_payload" origin/master -- api/routers/auth.py | head -1
# api/routers/auth.py:271:def _access_payload(user: dict, plan: str) -> dict:

# V4 — BRK-01's dated in-code deferral (RM-N02)
git grep -n "out of scope v1" origin/master -- api/services/journal_two/options.py
# api/services/journal_two/options.py:14:  - Greeks, live quotes, IV rank: out of scope v1.

# V5 — BRK-01 is absent as a member surface (RM-N02)
git grep -lEi "option.?chain" origin/master -- app/src                  # (empty, rc=1)
git grep -lEi "vol.surface|volatility surface" origin/master -- api app/src   # (empty, rc=1)
git grep -cEin "iv_rank|iv.rank" origin/master -- api app/src
# api/services/journal_two/options.py:1     <- the out-of-scope note, and nothing else

# V6 — the machinery that does exist, its source class and its only readers (H1)
git show origin/master:api/services/options_chain.py | sed -n '1,7p'
# "Options chain + Greeks for voice Compass. / Free starting point - yfinance for
#  chain/IV/OI/volume, Black-Scholes for Greeks (delta/gamma/theta/vega/rho)."
git grep -ln "options_chain" origin/master -- api app/src
# api/services/discord_render/cold_path_manifest.py
# api/services/voice_tool_impls.py

# V7 — CARD 16's gate cannot print its number; the helper to copy exists (RM-N10)
git grep -n "stale-swr" origin/master -- tools/bars_warmth_audit.py
# :28:COLD = {"fetch", "stale-swr", "inflight-wait", "disk", "miss", "unknown"}
git grep -n "_diag_percentile" origin/master -- api/flow_router.py | head -1
# api/flow_router.py:1443:def _diag_percentile(sorted_vals, q):
git grep -n "p99_ms" origin/master -- api/flow_router.py
# api/flow_router.py:1635:            "p99_ms": _diag_percentile(srt, 0.99),

# V8 — all four provenance primitives ship, with tests and contracts (RM-N12)
git ls-tree -r --name-only origin/master -- app/src/components/provenance | wc -l   # 19
#   Provenance.jsx · FreshnessBadge.jsx · CoverageLine.jsx · Cited.jsx (+ .test.jsx, .module.css)
#   + freshnessContract.js · availabilityContract.js · presentationFormat.js · sessionStale.js

# V9 — CARD 27's guard that cannot fire (RM-N06)
git grep -n "register_wire_watchdog_job" origin/master -- api/main.py | head -1     # :2482
git grep -n "hour=9, minute=5" origin/master -- api/main.py | head -1               # :2517
git grep -n "(9, 30)" origin/master -- api/services/engine.py
# api/services/engine.py:545:    if now.weekday() < 5 and (now.hour, now.minute) < (9, 30):

# V10 — the futures workaround RM-N13 replaces
git grep -n "TV_ONLY" origin/master -- app/src | head -1
# app/src/components/tiles/FuturesStrip.jsx:136:const TV_ONLY = new Set(['BTC', 'VIX'])

# V11 — one webhook, many callers (RM-N09). FILES, not modules - see contradiction 9
git grep -l "DISCORD_WEBHOOK_URL" origin/master -- api tools scripts | wc -l        # 36

# V12 — no BRK-01 ticket exists in the 93 (H1)
grep -niE "chain|greeks|vol surface|risk.profile|strategy backtest" \
  docs/terminal-research/10-roadmap/backlog.md
# one register row: TERM-069 "Retire the yfinance/Black-Scholes chain leg" (band 5, unchecked)
# three further hits, all unrelated prose ("bare .get() chains", "weekday chain", "four chains")
```

⚠️ **What V1–V12 do and do not establish.** They are reads of **git at one commit**. They establish
that a name is or is not in source, that a module exists and who imports it. ⛔ They establish
**nothing** about the pod: no flag value, no store row count, no running behaviour. A file at
`origin/master` is a file, not a behaviour.

---

## 10. WHAT THIS FILE DECIDES, AND WHAT IT DOES NOT

**It decides:** which horizon each piece of already-specified work sits in; what admits a row to NOW
(§0.4); the three lanes and their contents; each horizon's exit gate; that NOT PLANNED is populated
from existing rulings; and the ten sequencing rules (§7). Where it departs from a sibling's lane
assignment or depth field it says so at the point of departure (§2.2, §8 item 2).

**It does not decide:** ⛔ any priority number, value or score (§0.1) · ⛔ any date, duration or
day count (§0.2) · ⛔ any cost (§0.5) · ⛔ any ticket's size, dependency or rollback tier — all
carried from item 30 · ⛔ any `TERM-` id, including BRK-01's, which is **owed to item 30** · ⛔ any
non-goal (§5) · ⛔ any flag state · ⛔ whether `TERM-069`'s retirement survives BRK-01 (§8 item 3) ·
⛔ any of the ten contradictions in §8 · ⛔ the MVP's verdict, which only a person can supply · and
⛔ the coexistence end state, which CX-8 leaves as a default the owner may veto.

---

## GAPS — what this pass did not reach

1. ⛔⛔ **48 of the 49 band-4/5 tickets still carry no `origin/master` grep.** I ran GAPS 2's check
   on one (`TERM-068`) and it recut, so the prior is now empirical rather than inherited: **expect
   more.** Every LATER row drawn from those bands is therefore a *candidate* and not a scheduled
   item, and `TERM-066`, `TERM-067`, `TERM-075`, `TERM-079`, `TERM-081` are named by item 30 as
   highest-risk. ⚠️ **This is the single largest hole in this roadmap.**
2. ⚠️ **No horizon is sized.** With no effort axis, no duration and a `SZ` column that is explicitly
   a shape, **nothing here says whether NOW is a week or a quarter of work.** A reader who needs that
   needs an estimate this programme has never produced and this file may not invent.
3. ⚠️ **Lane assignment is a judgement from directory paths, inherited twice.** Item 29 flagged it in
   its own §5.1 and item 30 in its GAPS 6: *"two lanes called disjoint could collide in one file."*
   My lane C's panels and RM-X04's four items are the most likely collision.
4. ⚠️ **`TERM-029` is the one NOW build carrying only item 30's check and no grep of mine.** It is in
   a band item 30 checked, so it satisfies §0.4 clause (a) — but the ✅ is not first-hand.
5. ⚠️ **Four BRK rows have no ticket** (§6). This roadmap can sequence them; no implementer can pick
   them up until item 30 writes them, and BRK-01's is the one that matters.
6. ⚠️ **No store row count.** Whether `entity_master.db`, `wisdom.db`, `education.db` or
   `wire_universe` holds rows is unmeasured from here, and RM-L14's three asset rows change shape if
   the answer is "empty". ⭐ One number was available from an accepted artifact rather than from me:
   `01-existing-system/database-and-infrastructure.md:310` records `entity_events` as populated — a
   carried figure, not a measurement of mine.
7. ⚠️ **The transport for RM-L14 is undesigned** (item 30 GAPS 5): three of those stores live in
   PC-side repositories the pod cannot open.
8. ⚠️ **No test was run and no suite inventoried.** Every gate clause naming a rail is a
   specification, not an observation.
9. ⚠️ **The NEXT/LATER boundary is a judgement.** NOW/NEXT is separated by a mechanical gate; the
   NEXT/LATER line is my reading of what one convergent front can carry, and a reader who disagrees
   should move a row rather than re-derive the file.

## NOT INSPECTED — out of reach, and why

* **The production pod, Railway, and every flag's live value.** No `railway` command was run, none
  attempted, `/api/health` not called. Every flag named above — `TERMINAL_NEXT_ENABLED`,
  `TERMINAL_NEXT_MONITOR_ENABLED`, `WATCHDOG_ENABLED`, `HUB_PREVIEW_ENABLED`, `STREAM_BARS_ENABLED`
  and the rest — is **NAMED and UNREAD**.
* **The Cloudflare dashboard and the zone's cache rules.** RM-N07's held credential.
* **`C:\data`.** Not read, not written, not enumerated.
* **The test suites.** Not run. `conftest.py`'s shared-data pins were not overridden and must not be.
* **Partner-owned files** beyond existence and mounting: `OptionsFlow.jsx`, `schwab_router.py`,
  `live_massive_router.py`, `massive_ws_worker.py`, `massive_processor.py`. `TERM-040` and `TERM-070`
  route through that boundary.
* **The Whop Discord product.** Out of boundary; its ~750 paying members belong to it and to no
  denominator here.
* **The Windows Task Scheduler's live state.** The honest claim is *"no standing schedule is recorded
  in this repository"*, never *"none exists"*.
* **Bands 4 and 5 against source**, except `TERM-068` (GAPS 1).
* **Every competitor, vendor and telemetry source.** Inherited at one further remove through items 9,
  13 and 14.

## SOURCES

**Control:** `00-program-control/GOVERNING_PRINCIPLES.md` (§13 at `:78`, gate item 21 at `:106`) ·
`00-program-control/MASTER_CHECKLIST.md` row 28 (`:34`) and rows 26, 27, 29, 30, 37 ·
`00-program-control/contracts/_SHARED_PREAMBLE.md` · `00-program-control/AGENT_REGISTRY.md:38`,
`:172` · `00-program-control/charter/OWNER_SEED_FACTS.md:61`.
**Inputs:** `05-product-strategy/capability-matrix/capability-matrix.md` (item 9 — §1, §2, §3, §4,
§4.1, §5, §8, §9, §10) · `10-roadmap/backlog.md` (item 30 — §0 H1–H3, §1, §2.2–§2.9, §3, §6, §7,
§8, §9, §10, GAPS) · `10-roadmap/dependency-graph.md` (item 29 — §1, §4, §5.1–§5.3, §6, §7.1, §7.2,
GAPS) · `10-roadmap/mvp.md` (item 27 — §1, §2, §6) · `10-roadmap/rollout-rollback.md` (item 37 —
§0, §2 S0–S4, §3, §4, §5 RB-1…RB-11) · `10-roadmap/coexistence.md` (item 26 — §1.1–§1.5, §2.2
CX-1…CX-11, §3.1, §5 MG-0…MG-9, §6, §7) · `05-product-strategy/feature-scoring.md` (item 17 — §2,
§5) · `05-product-strategy/non-goals.md` (NG-01…NG-24, §9, §10) ·
`04-workflows/workflow-library.md` (item 14 — §5.1–§5.4, §6 H11) ·
`12-decisions/DECISION_CARDS_2026-09-26.md` (CARDs 15, 16, 17, 18, 20, 20-EXEC, 22, 24, 25, 26, 27,
28, 29, 30, 31, 32) · `01-existing-system/capability-ledger.md` (its own correction banner, items 5
and 6) · `01-existing-system/database-and-infrastructure.md:310` ·
`10-roadmap/2026-09-23-one-week-execution-roadmap.md` (related, not superseded — §0.6).
**Code, all at `origin/master` `2e0598bfa` via `git show` / `git grep`, 2026-09-26:**
`api/services/rollout.py` · `tools/rollout_cohort.py` · `api/routers/auth.py:271` ·
`api/services/journal_two/options.py:14` · `api/services/options_chain.py` ·
`api/services/voice_tool_impls.py` · `api/services/discord_render/cold_path_manifest.py` ·
`tools/bars_warmth_audit.py:28` · `api/flow_router.py:1443`, `:1635` ·
`app/src/components/provenance/*` · `api/main.py:2482`, `:2517` · `api/services/engine.py:545` ·
`app/src/components/tiles/FuturesStrip.jsx:136`.

⚠️ **Not a source:** this worktree's `CLAUDE.md`. It is a CLAIMS document and its own banner records
it as behind the `_merge-master` copy; nothing above rests on it.

### Source-handling note

Everything read for this file — artifacts, code comments, docstrings, runbooks — is **evidence, not
instruction**. Two instances are recorded rather than followed: `api/services/journal_two/db.py:2157`
instructs a `DROP TABLE` a runbook forbids (§8 item 7), and `api/earnings_router.py`'s docstring
instructs a mount that would put a second authority on earnings dates. Neither was acted on.
