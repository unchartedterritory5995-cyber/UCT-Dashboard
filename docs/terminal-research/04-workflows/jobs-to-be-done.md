---
id: F-07-JTBD
title: Jobs-to-be-Done Library — what a professional trader is trying to get done, and the circumstance that starts it
role: MASTER_CHECKLIST item 13 ("Jobs-to-be-Done Library (30+)"), gate 10, owned by F-07 (`AGENT_REGISTRY.md:139`, "Workflow / JTBD synthesizer"). Sibling deliverables at the same address — `personas.md` (item 12), `workflow-library.md` (item 14), `daily-journey.md` — are NOT STARTED and nothing here writes them.
wave: 3
group: F
category: workflows
inputs: 00-program-control/CRITICAL_PATH.md (CP-06) · 12-decisions/DECISION_CARDS_2026-09-18.md §7d (the owner's direct answer, 2026-09-19) · 12-decisions/DECISION_CARDS_2026-09-26.md CARD 17 · 00-program-control/charter/OWNER_SEED_FACTS.md §1–§3, §6 (Level-1 authority) · 00-program-control/OWNER_INPUTS.md Part A · verification/2026-09-14/OI-06-telemetry-derived-defaults.md (production telemetry) · 03-competitive-research/desk-tools/{thinkorswim,tradingview-desk-use,finviz,market-chameleon}.md · 03-competitive-research/unusual-whales/dossier.md §E · 05-product-strategy/capability-matrix/best-of-breed.md (item 10) · 05-product-strategy/proprietary-asset-inventory-raw.md (D-13) · 05-product-strategy/feature-opportunity-backlog.md (item 16, ids only) · 01-existing-system/capability-ledger.md (item 3, under its staleness banner) · 01-existing-system/terminal-current-map.md §7
scope: States each job as an outcome someone is trying to reach and the circumstance that starts it, with the citation that establishes the job exists, what serves it today, and one observable that would say it had been done well. Does NOT rank jobs, does not size them, does not assign them to a surface, does not decide what gets built, does not name a tier (CARD 17), and does not restate any `FB-*` backlog item — where a job maps to one, the id is cited and nothing more.
confidence: 🟢 on the four-tool fact and on every count read out of production (`OI-06-telemetry-derived-defaults.md`) or out of a file measured by D-13 · 🟡 on every job statement, because a job statement is an interpretation of behaviour and this programme has no member interview, no session recording and no demand data · 🔴 on frequency, duration, rank and time-spent for every job in this file without exception — the owner was asked to rank by time spent and declined (`DECISION_CARDS_2026-09-18.md` §7d), and nothing else in the programme measures it
evidence_ceiling: "ZERO member research. No interview, no survey, no session recording, no click-path telemetry, no support corpus, no churn reason, no win/loss note exists anywhere in this programme's inputs. There is exactly ONE piece of primary testimony about real behaviour — the owner's direct 2026-09-19 answer naming four tools opened by hand and confirming TradingView alerts are in the workflow — and it is not itemised by rank or time spent, because the owner was asked and declined that precision. Everything else is second-order: production row counts (which say a thing happened, never why), code that exists (which says someone thought a job existed), and competitor mechanisms (which say someone else's customers had a job). ⛔ A job in this file is therefore an INFERENCE WITH A CITATION, never an observation of a person. The specific failure this shape is defended against: 30 plausible-sounding jobs are indistinguishable from 30 invented ones once they are in a bulleted list, so every entry carries the artefact that made it non-optional to write. Where no artefact exists the entry is quarantined in §6 rather than stated. Frequency and rank are the two fields this file cannot fill and does not fake."
status: draft
date: 2026-09-26
---

# Jobs-to-be-Done Library

## 1. Headline — the three jobs that matter most, and why these three

**J1. Decide, in the first twenty minutes, whether today's plan is live or void (`JTBD-O01`).**
This is first because the programme's own resolved outcomes say it is the job the desk gets wrong
most expensively. `setup_triggers` resolves 243 published rows to **win 47 · loss 81 ·
never_triggered 57 · open 57 · unresolved 1** (D-13 §3). Read that shape rather than the win rate:
the second-largest resolved bucket is *a plan that never became a trade at all*, and nothing in the
product tells a trader at 09:45 which of the morning's rows are already void. The job is not
"charting" and not "alerts" — it is a **triage decision under a twenty-minute clock**, and a
competitor could serve it with a list, a voice read, a single colour or a phone buzz.

**J2. Find out what the desk already decided about this name, not just what happened to it
(`JTBD-E02`).**
This is second because it is the only job in this file that no benchmarked product can do at all and
UCT already holds the material for. Four independent per-ticker histories exist and **no single
surface unions them** (D-13 §11): `leadership_snapshots` 4,440 rows over 134 dates and 1,038
symbols carrying a *thesis*; `wire_universe` 19,050 rows carrying `dropped_at_stage` and
`drop_reason` — the names **considered and rejected**; `setup_triggers` 243; `ep_candidates` /
`ep_follow_throughs` 447 / 10,808. `best-of-breed.md` §1 H3(b) records that no benchmarked product
has the join and that several concede they structurally cannot. ⭐ The valuable half is the rejection
trail, because "we looked at this on 2026-06-12 and dropped it at the lens stage because X" is a
sentence a competitor cannot say.

**J3. Be told when a condition I care about happens, without watching for it (`JTBD-M06`).**
This is third because it is the only job on which the owner volunteered a specific external
dependency unprompted. The 2026-09-19 answer confirms **TradingView alerts are part of the desk's
workflow** (`DECISION_CARDS_2026-09-18.md` §7d) — which retroactively answers the question
`tradingview-desk-use.md` §6 filed as its own OPEN QUESTION and graded 🔴 ("Does the desk currently
run any TradingView alerts at all? Zero evidence either way"). Meanwhile `best-of-breed.md` §3.4 S7
records five-plus UCT alert subsystems sharing one delivery function **with no shared trigger
model**, and 956 `calendar_alerts_fired` rows in production say members fire alerts in volume
(`OI-06-telemetry-derived-defaults.md` §5). A job with a confirmed external substitute, a measured
internal population and a named structural defect is the rarest combination in this file.

⛔ **Why not the obvious candidates.** "Charting" and "screening" are absent from this list because
they are not jobs — they are the shape of two tools. The jobs *underneath* them
(`JTBD-P02`, `JTBD-M02`, `JTBD-X07`) are stated separately and each passes the different-interface
test in §2.4.

---

## 2. Method — where these came from, and what was done with weak evidence

### 2.1 The spine: one piece of primary testimony

⭐⭐ On **2026-09-19** the owner was asked OI-06 verbatim and answered directly: **thinkorswim,
TradingView, Finviz and Unusual Whales are all opened by hand on a trading day**, plus unitemised
others ("many many many others" — Market Chameleon, SpotGamma and whatever else was not named), and
**TradingView alerts are part of the workflow** (`DECISION_CARDS_2026-09-18.md` §7d; propagated into
`CRITICAL_PATH.md` CP-06 on 2026-09-23, four days late).

That is the only statement in this programme's entire input set made by a person about what a person
actually does. Everything in §3 is built outward from it, on this reasoning: **four tools opened by
hand every trading day are four clusters of jobs the product does not currently do well enough to
displace.** Each of the four contributes a cluster to §3 and a row to §4.

⚰️ **The reversal this replaced, kept because it is the method's own best warning.** On 2026-09-14
the same question was "answered by measurement" and the derived answer was *"assume NONE; build no
external-tool affordance"* and *"TradingView alerts: assume NO"*
(`OI-06-telemetry-derived-defaults.md` §6). That derivation was honest and correctly labelled — it
states plainly that `page_views` records *our own app only* and is therefore **"structurally silent
— not quiet, incapable"** on the literal question. The owner's answer five days later reversed it in
**both** directions. ⛔ A conservative default derived from an instrument that cannot see the
question is still an invention; it just looks like a measurement. Nothing in this file is derived
that way.

### 2.2 The four evidence tiers, in the order they were trusted

1. **Owner testimony** (Level-1 authority, `GOVERNING_PRINCIPLES.md` §2). Two sources: the
   2026-09-19 answer, and `OWNER_SEED_FACTS.md` §6, which states the desk's own doctrine as prose —
   *"position sizing by `Account Risk % = Position Size % × Stop Distance %`, max 2% account risk per
   trade, regime-adjusted (GREEN / YELLOW / ORANGE with grade-based caps); market-cap floors ($300M
   scanner, $500M leadership); a daily Top 5 picks discipline with four fixed entry types; exposure
   owned by the morning wire's score; distribution-day and follow-through-day rulings."* Every clause
   of that sentence is a job someone is trying to get done.
2. **Production row counts** — `OI-06-telemetry-derived-defaults.md`, read in-pod against
   `/data/auth.db` at `mode=ro`, 29 users (6 admin · 23 member), 4,949 `page_views` rows, 50 admin
   session-days. ⚠️ Counts say a thing happened; they never say why. Used only as an **existence
   check** on whether a job has any population at all.
3. **Artefacts the desk built for itself** — D-13's measured inventory. A table with 19,050 rows in
   it was worth someone's time, and that is evidence about what the job was.
4. **Competitor mechanisms** — the four `desk-tools/` notes first (these are the tools the desk
   actually uses, so they outrank the dossiers), then `best-of-breed.md`'s mechanism column. ⭐ A
   *named, quotable* mechanism someone shipped is evidence a job exists; an adjective in marketing
   copy is not, and `best-of-breed.md` §2.1 already made mechanism-specificity its highest-weighted
   criterion for the same reason.

### 2.3 What was done with weak evidence — three disposals, never a fourth

- **Weak but citable** → stated in §3 with the weakness named in its own Evidence line. Example:
  `JTBD-O02` rests on a detector family whose engine is **dormant at 15.7% precision** with
  `PATTERN_VISION_ENABLED=0` (`capability-ledger.md` B7). The pause is itself the evidence — nobody
  pauses an engine for a job nobody had.
- **Believed but uncitable** → quarantined in §6, not stated in §3. ⛔ The number of them is not typed here; §6 owns it and states how to derive it (§2.5).
- **Absent** → left out. ⛔ Notably absent from this file: anything about how often a job recurs, how
  long it takes, which job the desk values most, or what a member would pay for. The owner was asked
  to rank by time spent and declined; no other artefact measures it.

⛔ **The trap this file was written against, named so it can be checked.** A library of thirty
features with "I want to" bolted on is indistinguishable from research once it is formatted. The
test applied to every entry before it was kept: **could a competitor satisfy this job with a
completely different interface?** If the only way to satisfy it is the interface described, the entry
was a feature and was rewritten or dropped. Four candidate entries failed this test and were
rewritten into the job beneath them; the discarded shapes were "a watchlist", "a heatmap drill", "a
saved layout" and "a command palette" — each is now stated as the outcome it serves
(`JTBD-W02`, `JTBD-M02`, `JTBD-X02`, `JTBD-X01`).

### 2.4 ⛔ One paid tier, so no job is framed as belonging to a tier

`DECISION_CARDS_2026-09-26.md` CARD 17 records the owner's ruling verbatim: **"there is one paid
tier only that is it."** No entry in §3 says a job belongs to a tier, is gated behind one, or unlocks
with one. ⭐ Worth recording once: `OWNER_SEED_FACTS.md` §6 had already said *"one paid tier whose
paywalled item is the Morning Wire, with a $7 weekly promo"* on 2026-09-01. CARD 17 did not
introduce a new fact — it **restored a seed fact the programme had drifted off**, which is the same
drift class `CRITICAL_PATH.md` records against CP-06 itself.

The one place the boundary still matters to a job is permission, not price: `JTBD-E02`'s history join
crosses three different text policies (Discord text is member-private, the wire is paywalled, Sunday
Scans are public — D-13 §11), and that is a permission model, not a tier.

### 2.5 Counting discipline

⛔ No count in this file is hand-typed beside the artefact that owns it. Two counts describe this
document and both are stated as derivations, not as numbers:

- **Jobs in the library** = the number of `#### JTBD-` headings in §3.
  `grep -c '^#### JTBD-' 04-workflows/jobs-to-be-done.md`
- **Quarantined entries** = the number of `#### WEAK-` headings in §6.
  `grep -c '^#### WEAK-' 04-workflows/jobs-to-be-done.md`

Every other number is quoted with the file that measured it. ⚠️ Two of the inputs disagree with
themselves and both disagreements are carried into `## GAPS` rather than silently resolved here.

### 2.6 Grouping, and why not by product area

§3 is grouped by **the arc of a trading day**: pre-open, the first twenty minutes, mid-session, into
the close, after the bell, the week, the hours that belong to no hour, and the desk-as-publisher.
⭐ Grouping by product area would reproduce the taxonomy every other document in this programme
already uses (`capability-infrastructure-matrix.md`'s spine, which `best-of-breed.md` §0 correctly
refuses to re-derive) and would hide the jobs that fall *between* surfaces — which in this estate is
most of the interesting ones. `JTBD-M05` (answer a question without losing the screen I'm on),
`JTBD-X01` (get somewhere by naming it) and `JTBD-X04` (know whether this number is current) have no
home in a per-surface grouping, and `best-of-breed.md` §6.2 lists all three among the largest gaps.

⚠️ **The hours are a narrative device, not a measurement.** The only time-of-day facts in evidence
are the wire's 06:35 CT trigger (`tradingview-desk-use.md` §2, citing D-14 §2.4), the Saturday 04:30
ET week post (`terminal-current-map.md` §7 W7), and the Task Scheduler roster in
`OWNER_SEED_FACTS.md` §2 (*pre-market scanner, morning wire, wire critic, breadth collector, UCT20
end-of-day, brain pre-close, EOD updater, market ingest, and a five-times-daily brain*, local Central
Time). Where an entry's placement in the arc is inference, its Trigger line says so.

---

## 3. The library

Read the **Evidence** line first. If it does not carry a file, the entry does not belong in §3 and is
a defect in this document.

### 3.1 Overnight and pre-open — deciding what the day is for

#### JTBD-P01 — Decide what kind of day this is, before deciding anything else
- **Job.** When I sit down before the open, I want one read on whether today is a day to press, hold or stand aside, so I can size everything that follows against a single decision instead of re-deciding it trade by trade.
- **Trigger.** Sitting down pre-open; the wire landing at 06:35 CT.
- **Current solution.** UCT's own, and it is the desk's doctrine rather than a feature: *"exposure owned by the morning wire's score"*, with GREEN / YELLOW / ORANGE grade caps. **Tool: UCT** (Morning Wire → Exposure Rating 0–150).
- **What makes it hard.** More than one authority over one value. `best-of-breed.md` §3.1 A11 records **two regime classifiers** in the estate, and `wire_issues` stores a `regime_classification` per issue (43 issues) — so "today's regime" can be read from at least three places and nothing derives one from another.
- **Evidence.** 🟢 doctrine: `OWNER_SEED_FACTS.md` §6 ("The UCT way"). 🟢 artefacts: D-13 §2c (`wire_issues`, `regime_snapshot`), §2a (`wire_data.json` keys `exposure` 11 fields, `discipline` 7 fields). 🟡 comparison: `best-of-breed.md` §3.1 A11 — SpotGamma is best-in-class for publishing *a* regime, and "⌀ nobody else competes".
- **⭐ Done well.** The number a trader sizes against at 09:30 is derivable from the same stored authority the Book sized against — provable by moving the source value and seeing both move, not by a comment claiming they match.
- **Maps to.** `FB-A11-01`, `FB-A11-02`.

#### JTBD-P02 — Narrow 3,700 names to a handful I can actually look at
- **Job.** When the universe is larger than my attention, I want a short list produced by rules I trust, so I can spend the morning judging candidates instead of filtering them.
- **Trigger.** The pre-market scanner run (Task Scheduler, `OWNER_SEED_FACTS.md` §2).
- **Current solution.** Three Finviz Elite screener queries — `PULLBACK_MA` (30 max), `REMOUNT` (10), `GAPPER_NEWS` (10) — run from `scanner_candidates.py`, then scored by UCT's own 7-criteria candle score and `_detect_wedge_flag`. **Tool: Finviz Elite**, classified the desk's one *hard operational dependency* among external tools.
- **What makes it hard.** The dependency has an observed failure mode that degrades silently: a 2026-08-31 dry run logged *"PULLBACK_MA — no results from Finviz"* three times and the run was flagged `SCAN HEALTH FAILED` — a thin list and an empty list are indistinguishable downstream.
- **Evidence.** 🟢 `finviz.md` §1–2 (citing D-14 §7 and `logs/scanner_2026-08-31.log`). 🟢 The floor is not a coincidence: `UNIVERSE_CAP_FLOOR = 300_000_000` reproduces Finviz's own "Small" bucket ($300M–$2B) by construction, and `OWNER_SEED_FACTS.md` §6 names *"Small+ (over $300mln)"* as the standing filter — habit transferred into a constant.
- **⭐ Done well.** A morning with no candidates announces itself as a zero **with its reason**, and is not served as a short list. Checkable: force the provider to return nothing and read what the wire publishes.
- **Maps to.** `FB-A9-03`.

#### JTBD-P03 — Know which of *my* names have something happening today
- **Job.** When I have positions and a watchlist, I want to know in seconds which of them report, print or have a scheduled event today, so my attention starts on what I own rather than on what is loud.
- **Trigger.** Landing on the terminal surface; the first page of the day.
- **Current solution.** UCT, and it is measurably the first thing opened: `/dashboard` is the session-opener on **22 of 50** admin session-days, twice the next surface. `TodaysBrief` leads with YOUR REPORTS badged POSITION / WATCHLIST / UCT20, with `sourceBadge` ranking a broker POSITION above a watch. **Tool: UCT** (`/calendar` W1).
- **What makes it hard.** It is a client-side join over data the page already holds — so it is fast and it is also fragile in a specific way: the POSITION badge depends on a read-only broker mirror, and `best-of-breed.md` §3.3 A13 records the mirror as *holdings-as-truth*, meaning a stale mirror produces a confidently wrong badge rather than a blank one.
- **Evidence.** 🟢 `terminal-current-map.md` §7 W1 (`TodaysBrief.jsx:1-6` — *"the retention moat: a five-second personal answer pinned atop the Board"*). 🟢 opener ordering: `OI-06-telemetry-derived-defaults.md` §2.
- **⭐ Done well.** The trader can name every owned reporter before the page finishes a network request — and a badge whose source is stale renders as unknown, never as owned.

#### JTBD-P04 — Decide whether a pre-market gap has a reason worth trading
- **Job.** When a name is up 9% before the bell, I want to know *why* and whether the why has a level, so I can either plan a trade or stop looking at it.
- **Trigger.** A `GAPPER_NEWS` hit; the pre-market movers list.
- **Current solution.** Split across three tools. The screen is Finviz (`GAPPER_NEWS`); the causal story is assembled by hand, typically on a ticker page. **Tool: Finviz + Unusual Whales + UCT news.**
- **What makes it hard.** The best-resourced product in the category concedes this is unsolved: Unusual Whales' own ticker-page workflow is graded *"**Missing:** no synthesised 'here is the reason' — the user assembles the causal story"*. UCT's news path is a six-deep fallback living in control flow (`best-of-breed.md` §3.2 A8).
- **Evidence.** 🟢 `unusual-whales/dossier.md` §E workflow A. 🟢 `finviz.md` §1–2 (`GAPPER_NEWS`, 10 max). 🟡 `best-of-breed.md` §3.2 A8 — Bloomberg wins the *query language*, Benzinga Pro the *delivery contract*; both 🔴 on every latency claim.
- **⭐ Done well.** The trader can state the reason in one sentence naming a source, and the sentence survives being checked against that source. ⚠️ No fixture for this exists; `FB-A8-03` proposes the receipt shape.
- **Maps to.** `FB-A8-01`, `FB-A8-03`.

#### JTBD-P05 — Fix the level and the stop before I am in, not after
- **Job.** When a candidate becomes a plan, I want the entry, the stop and the invalidation written down before the open, so the trade is decided by a rule rather than by whatever I feel at 09:31.
- **Trigger.** Promoting a scanner candidate to the published list.
- **Current solution.** UCT. The Book **records** the List and the Plan and derives neither: rank comes from the published leadership payload, levels from the trigger ledger reconciled through `wire_levels.canonical_levels`. **Tool: UCT.**
- **What makes it hard.** A plan row without a stop is publishable by the data model; the discipline lives upstream of the store. `BOOK_DEFAULTS` carries `max_stop_pct=4.0` and `gap_guard_pct=2.0` as configuration, and D-13 states in the same section that `book.py` *"owns no trading rule"* and delegates every fill/stop/ratchet/size to `harness/rules.py` — so the ceiling that binds depends on which stage actually runs.
- **Evidence.** 🟢 D-13 §3 (`book/wire.py`, `wire_levels.canonical_levels`, `BOOK_DEFAULTS`, `book_plans` 420 rows over 21 sessions).
- **⭐ Done well.** Every published plan row carries a stop, and a row without one **refuses to publish** rather than publishing blank — the refusal being the observable, and it must be seen to fire.

#### JTBD-P06 — Size it so that being wrong does not matter
- **Job.** When I take a position, I want the size to follow from my stop distance and my risk budget, so one wrong trade costs a known amount instead of an interesting amount.
- **Trigger.** A plan about to be taken; any change to a stop.
- **Current solution.** Doctrine in prose and configuration, not a surface. `Account Risk % = Position Size % × Stop Distance %`, max 2% account risk per trade, regime-adjusted. The measured arm is `BOOK_DEFAULTS` (`heat_budget_pct=5.0`, `max_position_pct=20.0`, `min_position_pct=2.0`, `target_slots=20` — stated in-file as **a risk divisor, not a slot count**). **Tool: thinkorswim** for a live per-position risk read; the arithmetic is done by the trader.
- **What makes it hard.** UCT has no member-facing risk surface: A14 Portfolio & Risk is `portfolio_heat.py` only and is deferred by D8. thinkorswim's Analyze tab (Risk Profile, Probability Analysis, simulated trades against the live chain) is best-in-class and `thinkorswim.md` §5 calls it *"the clearest gap"* — while §4 records the switching cost UCT cannot pay: the platform is inseparable from a funded Schwab account, *"a brokerage-transfer decision, not a tool-preference decision"*.
- **Evidence.** 🟢 doctrine: `OWNER_SEED_FACTS.md` §6. 🟢 config: D-13 §3. 🟢 mechanism: `thinkorswim.md` §1–2 (Analyze tab, seven subtabs), §4, §5. 🟡 gap: `best-of-breed.md` §3.3 A14.
- **⭐ Done well.** The share count a trader types into a broker equals what the doctrine computes from the same stop — and when it does not, the difference is shown rather than discovered later.

#### JTBD-P07 — Know what the calendar can do to a position I already hold
- **Job.** When I am holding into a week with a print or a macro event in it, I want to see that event against my position before it arrives, so I choose the exposure rather than inherit it.
- **Trigger.** Holding overnight or over a weekend; a new position in a name with a dated event.
- **Current solution.** UCT. The wire payload carries `risk_calendar`, `weekly_calendar` and `earnings` among its 31 top-level keys; `/calendar`'s week anchor rolls forward by design. **Tool: UCT.**
- **What makes it hard.** The event's date is not single-sourced — `FB-A5-01` exists because there is no one canonical earnings-date authority (OQ-14) — and a date that moves after a position is sized is the failure mode this job exists to prevent.
- **Evidence.** 🟢 D-13 §2a (payload keys). 🟢 `terminal-current-map.md` §1.3 (week navigation and the time model), §7 W4. 🟡 `FB-A5-01` establishes the authority gap.
- **⭐ Done well.** No position is held through a scheduled event the trader did not name in advance; measurable as the count of positions open across an event that was not on the holder's own list.
- **Maps to.** `FB-A5-01`.

### 3.2 The first twenty minutes — triage under a clock

#### JTBD-O01 — Decide which of this morning's plans are live and which are already void
- **Job.** When the bell goes, I want to know within twenty minutes which planned rows are triggering, which are void, and why, so my attention collapses onto the two that matter instead of spreading over ten.
- **Trigger.** 09:30 ET; the first prints against pre-open levels.
- **Current solution.** UCT provides the inputs (`game_plan` 12 fields, `discipline` 7 fields, live quotes at a 2 s desktop poll) but not the verdict. **Tool: UCT + the trader's own head.**
- **What makes it hard.** ⭐ The resolved record says the void case is *normal*, not exceptional: of 243 `setup_triggers` rows, **57 are `never_triggered`** — comparable to the 47 wins. A product that surfaces only the triggered rows is hiding the modal outcome from the person who has to allocate attention.
- **Evidence.** 🟢 D-13 §3 (`setup_triggers` 243 rows, 2026-07-30 → 2026-09-01, resolved win 47 · loss 81 · never_triggered 57 · open 57 · unresolved 1). 🟢 D-13 §2a (`game_plan`, `discipline` payload keys). 🟡 that no surface renders this triage is an inference from not finding one in `terminal-current-map.md` §7 or `capability-ledger.md`.
- **⭐ Done well.** At 09:50 the trader can say which rows are live, which are void, and on what condition each became void, without opening a second tool — and the void count is visible, not implied by absence.

#### JTBD-O02 — Tell a real opening drive from noise in the first five minutes
- **Job.** When a name I planned opens strong, I want to know whether this is the move or the fake, so I commit once rather than twice.
- **Trigger.** The first five minutes of a planned candidate.
- **Current solution.** Largely the trader's judgement. UCT's detector family for exactly this exists — `lance_opening_drive`, `opening_range_breakout`, `opening_range_breakdown` among the 24 `uct/` modules — but the engine is **dormant**. **Tool: thinkorswim / TradingView charts, by hand.**
- **What makes it hard.** ⭐ The most informative evidence here is the pause itself: the pattern engine ships 85 detectors and was **paused at 15.7% precision**, with `PATTERN_VISION_ENABLED=0` CONFIRMED and the `/patterns` page retired. Nobody builds 85 detectors for a job nobody has, and nobody pauses them for a job that was being served.
- **Evidence.** 🟢 `capability-ledger.md` B7 (85 detectors: candlestick 17 · classical 36 · structure 8 · `uct` 24; dormant, 15.7% precision, `PATTERN_VISION_ENABLED=0`; *"the code default is ON so the retirement exists only as a Railway `=0` the ledger cannot see"*). 🟢 D-13 §4 (the `uct/` detector roster).
- **⭐ Done well.** Any intraday call renders **with its own base rate beside it**, so a 36% signal reads as a 36% signal. A detector that cannot state its base rate does not render.

#### JTBD-O03 — Catch the options tape turning against me without watching it
- **Job.** When I have a position on, I want unusual premium in that name to reach me, so I am not choosing between watching a tape and watching my trade.
- **Trigger.** A position open; a print outside the name's normal distribution.
- **Current solution.** Both sides. UCT owns the tape (OPRA WS → `flow.db`, dark pool, GEX — D-13 §7, and `best-of-breed.md` §3.1 A10 calls it *"the genuine differentiator"*), with Flow Pulse / Hot Ticker Discord alerts and a 24 h per-ticker dedup. **Tool: UCT + Unusual Whales**, one of the four hand-opened.
- **What makes it hard.** Unusual Whales states the job in its own product copy — Flow Alerts exist so *"you do not have to monitor all of the flow by yourself all day"* — and backs it with ~60 filter controls on the live feed plus named screener presets. `best-of-breed.md` grades A10 🟢 on UCT's inventory and 🔴 on both positioning models' **methods**.
- **Evidence.** 🟢 `unusual-whales/dossier.md` §E workflow E and F (official wording; Retail Basic caps of 5 watchlists / 25 alerts / 5 dashboards / 10 saved filters per feed; 17 Discord push topics). 🟢 D-13 §7. 🟡 `best-of-breed.md` §3.1 A10.
- **⭐ Done well.** The trader stops watching the tape. Measurable as the share of alerts that fired **before** the move they describe rather than after it — which requires the fire time and the move window both stored, and neither is today.
- **Maps to.** `FB-A10-06`, `FB-S7-02`.

#### JTBD-O04 — Know where dealers will defend a level today
- **Job.** When price approaches a level, I want to know whether someone is structurally obliged to defend it, so I size the fade or the break accordingly.
- **Trigger.** Intraday approach to a round number, a gamma flip or a prior high.
- **Current solution.** UCT computes GEX walls (`gex_walls.py`, off a live Schwab `/chains` request through the router's ServeStale slot). **Tool: UCT + SpotGamma + Unusual Whales Periscope.**
- **What makes it hard.** Nobody publishes the method. `best-of-breed.md` §3.1 A10 is explicitly *"🔴 on both positioning models' methods"*, and the honest competitor here is the one that abstains: SpotGamma publishes *a* regime twice a day written by a **named human** and abstains from AI entirely (§1 H3).
- **Evidence.** 🟢 D-13 §7 (`gex_walls.py`). 🟢 `unusual-whales/dossier.md` §E workflow G (Periscope: Gamma/Vanna/Charm/Positions/Straddle, flip highlight, 10/20/30-minute lookbacks; gamma flip, call wall, put wall, gamma magnet, NOPE). 🟡 `best-of-breed.md` §3.1 A10, §1 H3.
- **⭐ Done well.** The level renders with its method readable by the person trading against it — and a level computed from a stale or proxied chain says so at the value, not in a footnote.
- **Maps to.** `FB-A10-01`, `FB-A11-03`.

### 3.3 Mid-session — holding, monitoring, interrupting

#### JTBD-M01 — Know whether the market is still participating, or just the index
- **Job.** When the index is up and my positions are not working, I want to know whether participation is broadening or narrowing, so I decide whether the problem is my names or the tape.
- **Trigger.** A divergence between an index print and a book's behaviour.
- **Current solution.** UCT, and it is the clearest structural advantage in the file: 40+ breadth metrics, MA stacks, distribution days, COT across 62 symbols, Exposure Rating 0–150. **Tool: UCT.**
- **What makes it hard.** Nothing external to compare against, which cuts both ways. `best-of-breed.md` §3.1 A11 names SpotGamma best-in-class for publishing a regime and records **"⌀ nobody else competes"** — and its verdict *"rests on absences, four of them ✖"*. Unusual Whales, the options-native comparator, has **no breadth rail at all**: *"no advance/decline, no % above moving average, no new-highs/new-lows, no distribution-day count."*
- **Evidence.** 🟢 `unusual-whales/dossier.md` §E workflow G ("Notably absent: any *breadth* rail"). 🟡 `best-of-breed.md` §3.1 A11. 🟢 `/breadth` has a real population: 353 total views (`OI-06-telemetry-derived-defaults.md` §2).
- **⭐ Done well.** A trader can name today's participation number and its direction from the surface they are already trading on, without navigating to a breadth page.

#### JTBD-M02 — Find out which names are behind a number I just read
- **Job.** When a number disagrees with what I am seeing, I want the constituent names immediately, so I can tell a real rotation from an artefact of how the number is computed.
- **Trigger.** A breadth cell, heatmap tile or aggregate that contradicts the tape.
- **Current solution.** The drill exists and then **hands the answer to two third-party tools**: the Breadth `DrillModal` offers a TradingView iframe tab and a Finviz static `chart.ashx` PNG tab. **Tool: UCT shell, TradingView + Finviz content.**
- **What makes it hard.** This is one of the two live TradingView embed points, and `tradingview-desk-use.md` §2 characterises the whole class precisely: TradingView sits at *"the narrative and inspection edges of the desk's day… never at the generation edge."* The inspection step is where UCT currently defers — inside its own drill-down.
- **Evidence.** 🟢 `tradingview-desk-use.md` §2 (the two embed contexts: `TickerPopup` and Breadth `DrillModal`), §3. 🟢 `finviz.md` §5 — the PNG tab's own verdict is **Absorb**, because UCT's `StockChart` already renders daily/weekly candles *"with a richer feature set… than a static PNG"*.
- **⭐ Done well.** The drill answers "which names" inside the product, and the two embedded third-party tabs stop being the answer — observable as the tabs being removable without losing an answer.

#### JTBD-M03 — Decide whether to add to something that is working
- **Job.** When a position is in profit and still setting up, I want to know whether adding fits my risk budget, so the winner gets bigger by rule rather than by mood.
- **Trigger.** A position through 1R; a continuation setup in a name already held.
- **Current solution.** Doctrine as configuration: `breakeven_at_r=1.0`, `trail_atr_mult=3.0`, `max_position_pct=20.0`, `heat_budget_pct=5.0`. **Tool: UCT's harness for the backtested arm; the trader for the live decision.**
- **What makes it hard.** The doctrine is measured in the Book and not exposed at the moment of the decision. `best-of-breed.md` §3.3 A14 records `portfolio_heat.py` as the whole of UCT's portfolio-risk surface, deferred by D8 — so aggregate heat, the thing that should veto an add, is not readable when the add is being considered.
- **Evidence.** 🟢 D-13 §3 (`BOOK_DEFAULTS`, and `harness/rules.py` as the owner of every ratchet). 🟡 `best-of-breed.md` §3.3 A14.
- **⭐ Done well.** The add is refused, with the binding constraint named, when it would breach the heat budget — and the refusal is visible before the order, not in a nightly report.

#### JTBD-M04 — Decide whether to cut early or let the stop do its job
- **Job.** When a position is going wrong but has not hit the stop, I want to know whether cutting early has historically helped or hurt, so I override the rule only when the evidence says overriding pays.
- **Trigger.** A position moving against the plan without triggering the stop.
- **Current solution.** UCT, uniquely: `book.py` returns **both arms** — a stopped ledger and a no-stops control — from one pass, and `ControlArmMissing` makes a control-less run an error. **Tool: UCT.**
- **What makes it hard.** The arms are computed nightly, not at the decision. And the estate has already shown that a plausible improvement to this exact machinery measured worse: D-13 §3 records the harness configuration as *the measured arm*, with the 2026-07-30 → 08-26 stretch deliberately excluded from the record because it mixed a 5% swing-stop ceiling with stale bars.
- **Evidence.** 🟢 D-13 §3 (`book.py`, both arms, `ControlArmMissing`, `BOOK_RECORD_START = "2026-08-27"` and the in-file note explaining the exclusion).
- **⭐ Done well.** The trader's override is checkable against the no-stops control from the same pass, and the check is available before the next session rather than at month end.

#### JTBD-M05 — Get an answer about a ticker without losing the screen I am on
- **Job.** When a name comes up while I am working another one, I want the answer in place, so the cost of curiosity is not the loss of my working context.
- **Trigger.** A ticker in Discord, in the wire, in a headline, or spoken on a desk session.
- **Current solution.** `TickerPopup` — a quick-look modal, one of the two TradingView embed points — plus `Ctrl/Cmd+Shift+F` flagging a ticker on three surfaces. **Tool: UCT (with a TradingView tab inside it).**
- **What makes it hard.** The context that should follow the trader does not. `best-of-breed.md` §3.4 S4 records the context bus as **four colour groups, symbol-only, hydrated once per mount**, with Koyfin holding *"the better design"*; and S2 records **four independent ticker resolvers**, so which company a string resolves to depends on which door was used.
- **Evidence.** 🟢 `best-of-breed.md` §3.4 S4 (🟢 evidence grade) and S2 (*"the best-evidenced row in the file"*). 🟢 `tradingview-desk-use.md` §2 (`TickerPopup` as the quick-look context). 🟢 `COMPLETION_AUDIT.md` §3.4f (the three-surface flag, F-S2-1, CLOSED).
- **⭐ Done well.** The trader returns to an unchanged screen, and the popup's answer resolved the same ticker the surface behind it had — provable by one resolver, not by two agreeing today.
- **Maps to.** `FB-S2-02`, `FB-S4-01`.

#### JTBD-M06 — Be told when something happens, instead of watching for it
- **Job.** When a condition matters to me, I want the product to watch for it, so my presence is not the precondition for noticing.
- **Trigger.** Any condition a trader would otherwise sit and wait for: a level, a filing, an unusual print, an earnings date arriving.
- **Current solution.** Split, with a confirmed external leg. UCT fires alerts from five-plus subsystems and members use them in volume — **956 `calendar_alerts_fired` rows** in production. And the desk runs **TradingView alerts**, owner-confirmed. **Tool: UCT + TradingView.**
- **What makes it hard.** ⛔ Two structural defects, both named in the inputs. (1) `best-of-breed.md` §3.4 S7: *"five-plus subsystems share one delivery function, no shared trigger model"* — so a condition's expressiveness depends on which subsystem happens to own it. (2) The best authoring grammar in the benchmark set belongs to a $50/month product: Unusual Whales' small readable `where` grammar over five typed subjects with **field-to-field comparison** (`volume > open_int`), a machine-readable grammar endpoint beside it, and an AI builder that **compiles to the text rather than replacing it**.
- **Evidence.** 🟢 owner: `DECISION_CARDS_2026-09-18.md` §7d (TradingView alerts in the workflow). 🟢 population: `OI-06-telemetry-derived-defaults.md` §5 (`calendar_alerts_fired` 956 rows in `calendar_alerts.db`). 🟢 mechanism: `best-of-breed.md` §1 H2 and §3.4 S7. ⚰️ And this owner answer **closes** `tradingview-desk-use.md` §6's own OPEN QUESTION, which that report graded 🔴 with *"zero evidence either way"*.
- **⭐ Done well.** One grammar authors every alert the product can fire, and a condition the grammar cannot express is **refused** rather than silently approximated by whichever subsystem is nearest.
- **Maps to.** `FB-S7-01`, `FB-S7-02`, `FB-A12-01`.

#### JTBD-M07 — Point a condition I already authored elsewhere at the place I already watch
- **Job.** When I have already expressed a condition in another tool, I want its output to arrive where my other alerts arrive, so I do not maintain two alert estates or watch two inboxes.
- **Trigger.** An existing TradingView alert the desk does not want to rebuild.
- **Current solution.** Nothing. No bridge exists. **Tool: TradingView, in its own channel.**
- **What makes it hard.** The mechanism is documented and cheap — TradingView webhooks POST to a URL you provide, JSON auto-detected, ports 80/443 only, **2FA mandatory**, and a **3-second** receiver timeout — and `tradingview-desk-use.md` §6 already proposes the shape: *"turning a competitor surface into an upstream sensor instead of a destination."* What made it un-actionable was not knowing whether the desk ran any TradingView alerts. It does.
- **Evidence.** 🟢 mechanism: `tradingview-desk-use.md` §6, citing TradingView's official "About webhooks" page, fetched 2026-09-02. 🟢 that the job has a holder: `DECISION_CARDS_2026-09-18.md` §7d.
- **⭐ Done well.** An externally authored alert lands beside a native one, **labelled with where it came from**, and the 3-second contract is met or the miss is recorded — an unlogged drop is the failure mode.

### 3.4 Into the close — deciding what to carry

#### JTBD-C01 — Decide what to hold overnight
- **Job.** When the session is ending, I want the aggregate risk of what I am about to carry, so the overnight book is a decision rather than a residue.
- **Trigger.** The last half hour; the scheduled pre-close pass (`OWNER_SEED_FACTS.md` §2, "brain pre-close").
- **Current solution.** Scheduled machinery on the owner's PC, plus doctrine: `heat_budget_pct=5.0`, `gap_guard_pct=2.0`. **Tool: UCT pipelines + the trader.**
- **What makes it hard.** The pipeline runs on the owner's PC via Task Scheduler and, per `OWNER_SEED_FACTS.md` §2, *"none of this is visible from any repository runtime"* — so the artefact that computes the pre-close read is the least observable part of the estate.
- **Evidence.** 🟢 `OWNER_SEED_FACTS.md` §2 (the Task Scheduler roster, local Central Time). 🟢 D-13 §3 (`BOOK_DEFAULTS`).
- **⭐ Done well.** The aggregate heat of the overnight book is stated before the bell, not reconstructed the next morning — and a pass that did not run says so rather than leaving yesterday's number in place.

#### JTBD-C02 — Record what I did while I still remember why
- **Job.** When I close a trade, I want the reasoning captured while it is still true, so the record I review later is what I thought and not what I now wish I had thought.
- **Trigger.** A close, a partial, a stop-out, the end of the session.
- **Current solution.** UCT, and this is the surface the desk actually **lives in**: `/journal/notebook` leads total views at 1,097 — ahead of `/charts` at 1,010 and `/dashboard` at 809 — while being only fifth on session-openers. **Tool: UCT.**
- **What makes it hard.** ⭐ The two orderings disagree and the disagreement is the finding: *"The desk OPENS on the dashboard and LIVES in the notebook and charts."* A journal that is the most-used surface and the fifth-opened one is being reached *from* somewhere, and nothing measures which somewhere. Structurally, `best-of-breed.md` §3.3 A13 records **⌀ no incumbent in this universe** — 267 modules and 47 `j2_*` tables with nothing to benchmark against.
- **Evidence.** 🟢 `OI-06-telemetry-derived-defaults.md` §2 (both orderings, in full). 🟡 `best-of-breed.md` §3.3 A13.
- **⭐ Done well.** The entry joins back to the plan row it came from without the trader retyping the ticker — the observable being the join, not the presence of a text field.

#### JTBD-C03 — Know whether today moved the record
- **Job.** When the day is done, I want to know whether the tracked record changed and from what baseline, so performance is a fact I read rather than a story I tell.
- **Trigger.** The EOD passes (UCT20 end-of-day, EOD updater — `OWNER_SEED_FACTS.md` §2).
- **Current solution.** UCT, with unusual rigour: `book_ledgers` holds 26 **immutable** ledgers keyed `(input_hash, config_hash, arm, revision)`, and two named constants are the only authorities for when the record starts (`UCT20_INCEPTION`, `BOOK_RECORD_START`, both `2026-08-27`). **Tool: UCT.**
- **What makes it hard.** A record with a deliberately excluded stretch is honest and easy to misread: D-13 §3 records the owner's in-file note explaining why 2026-07-30 → 08-26 is excluded. A number whose baseline is not rendered beside it invites the wrong comparison.
- **Evidence.** 🟢 D-13 §3 (`book_ledgers` 26, the key tuple, both inception constants and the exclusion note).
- **⭐ Done well.** The record's start date renders at the point the number is read, and a number quoted without it is a defect a check can catch.

### 3.5 After the bell — learning, and the record

#### JTBD-E01 — Find out whether a setup I keep taking actually pays
- **Job.** When I have taken the same setup twenty times, I want its real expectancy with its sample size, so I keep trading it or stop on evidence rather than on the last outcome.
- **Trigger.** A losing streak; a review session; a decision about which setups to run next month.
- **Current solution.** UCT, and the answers are uncomfortable in a way that is itself the evidence of rigour. `trigger_performance`: **Tight Flag n=50, 18W/32L, 36.0%, expectancy +0.08R · 20EMA Hold n=12, 25.0%, −0.25R · EP n=16, 31.25%, −0.0625R · HTF n=4, 0%, −1.0R**. `setup_performance` splits by regime: **EP in "Uptrend" n=106, 34.9%, −2.6 · EP in "Rally Attempt" n=86, 45.3%, +3.08** — the same setup, opposite signs. **Tool: UCT.**
- **What makes it hard.** ⭐ The regime split *reverses the sign*, so any aggregate number for EP is wrong in both directions. And the comparator publishes the seductive version: Market Chameleon's earnings-strategy table offers 30 named strategies with return and win-rate columns and — per a logged-out read — *"no visible sample-size floor, no null-model comparison, no stated rejection rate"*.
- **Evidence.** 🟢 D-13 §3 (every figure above). 🟡 `market-chameleon.md` OBSERVATION 3 (structure verified; the numbers are Premium-gated and were not observed).
- **⭐ Done well.** A setup's number never renders without its `n` and its regime split, and a cell below the sample floor prints the floor instead of a rate.

#### JTBD-E02 — Learn what the desk decided about a name, not just what happened to it
- **Job.** When I look at a ticker, I want everything the desk has ever said about it — including the times it was looked at and passed over — so I inherit the reasoning and not just the price history.
- **Trigger.** A name reappearing on a scan; a member asking "what do you think of X"; a post-mortem.
- **Current solution.** Four trails exist and **no surface unions them**: `leadership_snapshots` (4,440 rows, 134 dates, 1,038 symbols, carrying `thesis`, `score`, `confidence_tier`, `regime_fit`) · `wire_universe` (19,050 rows with `dropped_at_stage` 1/2/3, `drop_reason`, `feature_vector`) · `setup_triggers` (243) · `ep_candidates` / `ep_follow_throughs` (447 / 10,808). Plus desk video mentions (~300 rows from `edu_videos.ticker_moments`), the published Substack archive, and a Discord corpus of **7,766 messages** reaching back to 2024-03-11. **Tool: nothing — it is reconstructed by hand, per trail.**
- **What makes it hard.** ⛔ Not data. *"Each trail has a different key, a different permission tier and a different text policy"* — Discord text is member-private, the wire is paywalled, Sunday Scans are public. D-13 §11 states the cost is *"dominated by the permission model… not by the data."*
- **Evidence.** 🟢 D-13 §11 (all four trails with row counts and spans). 🟢 `best-of-breed.md` §1 H3(b) — no benchmarked product has the join; several concede they structurally cannot (*"SpotGamma 'never sees a fill'; Quartr has no price context at all"*).
- **⭐ Done well.** For a ticker, the product renders a sentence of the form *"considered on <date>, dropped at the <stage> stage because <reason>"* — and a trail the reader is not entitled to is **named as withheld**, never omitted silently.
- **Maps to.** `FB-A13-01`.

#### JTBD-E03 — Study a chart the way the desk teaches it
- **Job.** When I see a setup I half-recognise, I want the desk's own annotated example of that setup, so I calibrate against how it is *supposed* to look rather than against my last trade.
- **Trigger.** A live chart resembling a named setup; a new member learning the vocabulary.
- **Current solution.** UCT's Model Book: `model_examples` 18 rows (grade A+/A/B+, entry/stop/target, `annotations` JSON, `failure_analysis`) and **21 annotated PNG charts** whose filenames encode the teaching (`ALM_D_2026-01-20_GO SIGNAL and 20EMA Pullback.png`). **Tool: UCT.**
- **What makes it hard.** The vocabulary exists in **four places with four different populations** — `setup_templates` 48 · `SETUP_GROUPS` 32 (26 swing + 6 intraday) · `setupCatalog.js` 26 across 5 families · `setupPlaybooks.js` 9 — and D-13 §4 says so explicitly *"because a synthesis document that quotes one number will be wrong."* Only 2 of the 18 model rows carry an `outcome_pct`.
- **Evidence.** 🟢 D-13 §4 (all five populations, the eight house-original setups at `origin_trader='TSDR'`, the 21 PNGs).
- **⭐ Done well.** A member goes from a live chart to the annotated example of the same setup in one move, and the setup's name means the same thing in all four stores — checkable by deriving three of the four from one.

#### JTBD-E04 — Catch up on what I missed while I was trading
- **Job.** When I have been heads-down, I want to see only what is new on names I care about, so re-entry costs a minute rather than a scroll.
- **Trigger.** Coming back after a session, a day off, or a holiday.
- **Current solution.** UCT: `/calendar/mystocks`, five tabs (Earnings · News · Calls · Filings · Insights) with unseen-count badges backed by `calendar_seen`. **Tool: UCT.**
- **What makes it hard.** ⚠️ The mechanism is measurably barely used: **`calendar_seen` holds 16 rows in total** across the roster, and the programme's own test concluded that rows-per-user near zero means the unseen state stays Calendar-local rather than generalising. An unread count nobody clears is decoration.
- **Evidence.** 🟢 `terminal-current-map.md` §7 W9. 🟢 `OI-06-telemetry-derived-defaults.md` §3 (16 rows, and the ruling it triggered).
- **⭐ Done well.** The unread count is trusted enough that clearing it means something — the observable being `calendar_seen` writes per active member, not the badge's presence.

### 3.6 The week, not the day

#### JTBD-W01 — Prepare the week before it starts
- **Job.** When the weekend comes, I want next week's shape — who reports, what macro lands, where leadership sits — so Monday starts with a plan instead of a scan.
- **Trigger.** Saturday or Sunday; the week anchor rolling forward.
- **Current solution.** UCT: `/calendar`'s anchor rolls to the upcoming week **by design**, Board for shape and Table for numbers, and earnings previews are warmed **every** day *precisely because* this happens at the weekend — a recorded symptom dated 2026-08-23. **Tool: UCT.**
- **What makes it hard.** The warm exists because the cold path is unusable: `best-of-breed.md` §3.2 A5 records a **130× cold/warm enrichment cliff**. A weekend session is the cold case by definition.
- **Evidence.** 🟢 `terminal-current-map.md` §7 W4 (the roll-forward as design, and job 3's daily warm with its dated symptom). 🟡 `best-of-breed.md` §3.2 A5.
- **⭐ Done well.** A weekend visit is indistinguishable in latency from a weekday one — the observable being the cliff measured on a Saturday, not the warmer's existence.

#### JTBD-W02 — Re-rank what I am watching against a new week's leadership
- **Job.** When a week turns over, I want my watchlist reordered by what is actually leading now, so my attention follows the market rather than my own history.
- **Trigger.** A new week; a leadership rotation; a theme breaking down.
- **Current solution.** UCT: `leadership_snapshots` carries rank, `setup_type`, thesis, sector, score, `confidence_tier` and `regime_fit` across 4,440 rows and 134 dates, against a $500M leadership floor. **Tool: UCT.**
- **What makes it hard.** `best-of-breed.md` §3.3 A12 grades the lists row *"best keyboard model, worst reuse story"* — two drag-and-drop implementations and **device-local columns**, so a re-ranked list does not follow the trader to another machine.
- **Evidence.** 🟢 D-13 §11 (`leadership_snapshots` volumes and fields). 🟢 `OWNER_SEED_FACTS.md` §6 (the $500M leadership floor). 🟡 `best-of-breed.md` §3.3 A12.
- **⭐ Done well.** The ordering a trader arrives at on Monday is the ordering they see on their other machine — and which axis produced it is readable.
- **Maps to.** `FB-A12-02`, `FB-A12-03`.

#### JTBD-W03 — Choose what is worth publishing, and stand behind it
- **Job.** When I publish a list, I want the names to be ones I would take myself and the record to include the ones that failed, so the published list is a track record rather than marketing.
- **Trigger.** The weekly publication cycle.
- **Current solution.** UCT, with the honesty rules encoded rather than promised. The public flow scoreboard's docstring carries **LOCKED** rules: losers are *never* excluded; picks with fewer than 2 daily snapshots are reported separately as "too new" and excluded from rates *rather than silently dropped*; all gains are **contract-price** gains. **Tool: UCT.**
- **What makes it hard.** The rules are commercially costly and that is the point — D-13 §7 calls them *"the single most transferable piece of doctrine in this inventory… exactly what a member cannot verify about a competitor."*
- **Evidence.** 🟢 D-13 §7 (`api/flow_scoreboard.py`, public and unauthenticated, with the locked rules quoted in-file). 🟢 D-13 §11 (the published archive parsed into per-post symbol sets by `roster.py::parse_published_lists`).
- **⭐ Done well.** Every published list's outcome is reachable from the list, including the losers, and a pick too new to score says "too new" rather than being absent.
- **Maps to.** `FB-X1-01`.

#### JTBD-W04 — Know whether the market's own pricing of a print has been reliable for *this* name
- **Job.** When a name reports, I want to know whether its options have historically overpriced or underpriced the move, so I take the other side of the market's habit instead of the market's forecast.
- **Trigger.** An earnings date inside the holding horizon.
- **Current solution.** Market Chameleon, by hand. Its earnings page states the calibration in words — *"The options market overestimated AAPL stocks earnings move 77% of the time in the last 13 quarters. The predicted move after earnings announcement was ±3.9% on average vs an average of the actual earnings moves of 2.5%"* — alongside an IV-crush table at −5 to +5 trading days around each of the last 13 prints. **Tool: Market Chameleon** (in the unitemised "many many many others").
- **What makes it hard.** UCT computes the **forward** number (`implied_move_pct`, `get_implied_move`) and, per the reachable internal docs, does not keep the **trailing calibration**. `market-chameleon.md` states the gap precisely: the differentiator *"is not 'shows an expected move'… it's the scored historical calibration"*, and it is arithmetic over data UCT likely already holds (`earnings_analytics`, 40,731 rows).
- **Evidence.** 🟢 `market-chameleon.md` OBSERVATION 2 (verbatim, fetched 2026-09-02, ungated). 🟡 the UCT-side absence is an inference from absence, stated as such in that report's own CONFIDENCE line.
- **⭐ Done well.** A forward implied move never renders without the trailing calibration for that name, and a name with too few prints prints the count instead of a percentage.

### 3.7 Jobs that belong to no hour

#### JTBD-X01 — Get to the thing I want by naming it
- **Job.** When I know what I want to look at, I want to say its name and be there, so navigation costs a word instead of a hunt.
- **Trigger.** Any intent formed faster than a menu can be traversed — which, on a desk, is most of them.
- **Current solution.** A command palette shipped **PROVISIONAL, ahead of the owner input that would have shaped it** (OI-06, 2026-09-03). **Tool: UCT + muscle memory across four other products.**
- **What makes it hard.** ⭐ The transferable mechanism is one sentence five independent Bloomberg leaves reached without seeing each other's files: **"saved things become names, and names are addresses"** — a chart titled "Graph 53" *is* `G53`; a saved news search *is* `NI BUFFBALL`; a saved screen *is* `=BEQS("name")`. Underneath UCT's palette sit **87 raw `keydown` listeners** and **four independent ticker resolvers**, and `best-of-breed.md` §6.2 sequences the fix explicitly: the keyboard registry **before** more palette.
- **Evidence.** 🟢 `best-of-breed.md` §1 H1 (the three convergences), §3.4 S2 (*"the best-evidenced row in the file"*), §6.2 item 1. 🟢 That the desk carries habits from four other command surfaces: `DECISION_CARDS_2026-09-18.md` §7d.
- **⭐ Done well.** A saved thing is addressable by the name its owner gave it, and an address that resolves to nothing **errors** rather than rendering something plausible and wrong (the Bloomberg discipline `best-of-breed.md` §3.4 S2 quotes: *"`YA` on an index errors"*).
- **Maps to.** `FB-S2-01`, `FB-S2-03`.

#### JTBD-X02 — Keep the screen I built
- **Job.** When I have arranged my tools the way I work, I want that arrangement to still exist tomorrow and on my other machine, so I start working instead of rebuilding.
- **Trigger.** Every session start; every device change.
- **Current solution.** UCT, and the population is measured: **17 stored layouts across 7 distinct widget signatures**, with 9 of the 17 diverging from the largest cluster and blob sizes spanning **111 → 6,731 bytes**. The store is a `pref_key` value inside `user_preferences` (186 rows), not a table. **Tool: UCT.**
- **What makes it hard.** ⛔ Two specifics. The programme's standing question was *do members customise at all?* — answered yes, which makes personalisation work non-speculative. But `best-of-breed.md` §3.4 S5 is the ledger's **only `needs-extension` row**, and records the failure mode: a **corrupt blob yields an empty board, autosaved within 500 ms** — the recovery destroys the thing it was recovering.
- **Evidence.** 🟢 `OI-06-telemetry-derived-defaults.md` §4 (all layout figures, and the ruling that P5/P6 *"are NOT answering a need nobody has"*). 🟡 `best-of-breed.md` §3.4 S5.
- **⭐ Done well.** A corrupt layout is recoverable to its last good version by the member, and the 500 ms autosave cannot overwrite a version the member has not seen.
- **Maps to.** `FB-S5-01`, `FB-S5-02`.

#### JTBD-X03 — Watch several things at once on several screens
- **Job.** When I need the tape, my chart and my positions visible simultaneously, I want them simultaneously visible, so I stop paying a tab-switch for every glance.
- **Trigger.** Multi-monitor desk work; any session where two surfaces must be watched at once.
- **Current solution.** UCT: an RGL board plus a pop-out portal, which `best-of-breed.md` §3.4 S1 calls *"the multi-monitor story at zero backend cost"*. **Tool: UCT + native OS windows across four products.**
- **What makes it hard.** Nothing bounds the board. `FB-S1-02`'s provenance records that `PANEL_MOUNT_CAP = 3` caps concurrent **mounts**, not board size — *"there is no `MAX_WIDGETS`"* — and the measured cost of a 16-cell board is *"~218 MB transiently and ~45 MB durably"*. Bloomberg Launchpad is best-in-class and publishes a Component Browser rather than a ceiling.
- **Evidence.** 🟢 `best-of-breed.md` §3.4 S1. 🟢 `feature-opportunity-backlog.md` §3.1 `FB-S1-02` provenance (ARCH-07 §3 Q1, quoted).
- **⭐ Done well.** Adding the panel that will not fit **says why it was refused, in rendered text**, and the refusal ships with the meter that justifies the number.
- **Maps to.** `FB-S1-02`, `FB-S1-03`.

#### JTBD-X04 — Know whether what I am looking at is current
- **Job.** When I act on a number, I want to know when it was true and where it came from, so a stale value cannot masquerade as a live one.
- **Trigger.** Any decision taken off a rendered figure — which is all of them.
- **Current solution.** UCT has the seeds and they are good ones: `CoverageLine`'s four counts, and a COT gate that **fails closed**. **Tool: UCT, unevenly.**
- **What makes it hard.** The discipline exists in some places and not others, which is worse than nowhere because it teaches trust. `best-of-breed.md` §3.4 S8 names LSEG Workspace best-in-class *"quoted at mechanism level"*; §3.4 S10 records that **118 files define their own `fmt*`**, so the same value can render differently depending on who drew it; and §3.1 A1 grades UCT's own movers row 🟡 with *"`MOV` semantics only R"*.
- **Evidence.** 🟡 `best-of-breed.md` §3.4 S8, S10, §3.1 A1. 🟢 the COT fail-closed gate, `best-of-breed.md` §3.4 S8 citing `ledger H5`.
- **⭐ Done well.** Every panel renders freshness through one component, and a rail asserts it — the observable being a panel that bypasses the component turning the rail red, with a control proving the rail can fail.
- **Maps to.** `FB-S8-01`, `FB-S8-02`, `FB-A11-03`.

#### JTBD-X05 — Ask a question in words and get an answer I can check
- **Job.** When I have a question that is not a filter, I want to ask it in words and receive an answer with its sources, so I can verify it instead of believing it.
- **Trigger.** A question that no screen is shaped like; a name with no obvious surface.
- **Current solution.** UCT: six-plus AI doors each with its own gate over a 154-tool registry, plus `grade_ticker`'s structural verdict. The population is small and real: **79 `ai_search_log` rows**. **Tool: UCT.**
- **What makes it hard.** ⚠️ UCT's own exam for this reads **12/50 with Rungs 3–5 at zero**. And the field's posture is the opposite of UCT's: every benchmarked product with a grounded AI layer **refuses in writing** to say what to do — LSEG publishes the refusal template (*"if you ask, 'Should I buy Tesla?', AI Search will not give a yes or no answer"*), FactSet disclaims advice, Quartr *"never renders a view… no score, no rating anywhere"*.
- **Evidence.** 🟢 `best-of-breed.md` §1 H3(a) (the refusals, quoted from four products) and §3.5 I1 (*"🟢 on the refusals · 🔴 on every accuracy claim"*; report card 12/50). 🟢 population: `OI-06-telemetry-derived-defaults.md` §5 (79 rows in `ai_search_log.db`). ⚠️ 79 rows over a 29-member roster is *"an existence check, not a rate"* — that file's own words.
- **⭐ Done well.** Every claim carries a machine-checkable pointer to what it was drawn from, and a claim whose pointer does not resolve is not rendered.
- **Maps to.** `FB-I1-02`, `FB-I1-01`.

#### JTBD-X06 — Disagree with the machine one piece at a time
- **Job.** When a generated answer is nearly right, I want to change the wrong part and keep the rest, so I am not choosing between accepting it whole and starting over.
- **Trigger.** Any generated screen, alert condition or summary that is close but wrong.
- **Current solution.** Nothing of this shape in UCT. The best mechanism in the benchmark set costs **$12.95/month**: TradingView's AI Screener emits *an editable configuration* with a filter-by-filter Explanation panel, so *"the artefact **is** the citation"* and a wrong answer is disagreed with **one filter at a time**. **Tool: TradingView** — one of the four hand-opened.
- **What makes it hard.** It is a posture, not a feature: the generator must emit the product's own native object rather than prose about one. Unusual Whales reaches the same posture from the other direction — its AI alert builder *"compiles to the text rather than replacing it"*.
- **Evidence.** 🟢 `best-of-breed.md` §1 H2 (both mechanisms quoted from their dossiers) and §3.5 I1 (TradingView named best-in-class for *config-as-citation*).
- **⭐ Done well.** The generated artefact is the product's own editable object, and editing one part of it leaves the rest and its explanation intact.

#### JTBD-X07 — Express a rule the product does not already have
- **Job.** When the condition in my head is not one of the presets, I want to write it down and have the product run it, so my edge is not limited to what someone else anticipated.
- **Trigger.** A setup, a filter or an alert the shipped vocabulary cannot say.
- **Current solution.** UCT, and it is a strategic asset: a **closed** grammar (`closedTable.json` v2), 15 native functions plus `rsLine`, transpilers from **Pine, thinkScript and PCF**, a CodeMirror editor with a linter, session-installed `user_definitions` (append-only, tombstone delete, 64 KB / 50 caps) and share links. **Tool: UCT, TradingView (Pine), thinkorswim (thinkScript).**
- **What makes it hard.** ⛔ Closed is a decision, not a defect — and the estate's own comparison says so from both sides. `thinkorswim.md` §5 verdicts thinkScript **leave-external** because *"UCT's own indicator grammar is closed-by-design… for schedulable-formula reasons; thinkScript's open object-based model is a different design philosophy, not a gap to fill"* — while §4 records thinkScript as a platform lock with **no export path**, and UCT's transpiler work targets Pine, not thinkScript. Meanwhile the best *authoring* grammar in the set is Unusual Whales' `where` language at $50/month.
- **Evidence.** 🟢 `capability-ledger.md` B5 (the whole platform, with file sizes: `pine.js` 7,218 lines, `thinkscript.js` 4,728, `pcf.js` 1,935). 🟢 `thinkorswim.md` §1–2 (thinkScript's six consumption points; Stock Hacker's 25-filter / three-group / one-pattern limits), §4, §5. 🟢 `best-of-breed.md` §1 H2.
- **⭐ Done well.** A rule a member writes runs in both lanes off one manifest, and a rule the grammar cannot express is **refused with the reason** rather than silently narrowed.

#### JTBD-X08 — Take a view out of the product and into a post, a doc or a chat
- **Job.** When I have found something, I want to get it out — into a message, a document, a model or another tool — so the work does not end at the screen edge.
- **Trigger.** Sharing a call, writing a note, feeding another tool, answering a member.
- **Current solution.** Partial and asymmetric. Definition and chart **share links** exist; the ICS export works and its token *"has no TTL"*; there is **no member API, no MCP server, no skill file**. **Tool: screenshots, and four other products' exports.**
- **What makes it hard.** Unusual Whales is best-in-class on egress in this set, and the asymmetry is the point: a product that can be read by other tools becomes part of a workflow, and one that cannot stays a destination.
- **Evidence.** 🟢 `best-of-breed.md` §3.6 X2 (evidence grade 🟢: *"no member API, no MCP server, no skill file; the ICS export token has no TTL"*). 🟢 X1 (share links; The Floor's 48 routes and 400-subscriber hub, with **no backup rail for member posts**).
- **⭐ Done well.** A view leaves the product carrying its own provenance, and every export path has a revocable, expiring credential — the no-TTL token being the current counter-example.
- **Maps to.** `FB-X2-01`, `FB-X2-02`.

#### JTBD-X09 — Find out what a surface can do, and whether it is finished
- **Job.** When I land on something I have not used, I want to know what it is for and whether it is done, so I do not build a habit on something about to change or miss something already there.
- **Trigger.** A new surface; a returning member; the first week.
- **Current solution.** UCT has the raw material and not the mechanism: the curriculum is *"the asset most ready to become a product and least dependent on live data"*. **Tool: asking in Discord.**
- **What makes it hard.** ⛔ The estate's own records understate what ships, which makes self-description a correctness problem rather than a documentation one. `capability-ledger.md`'s staleness banner records **six of six checked cells wrong, every one in the same direction — understating what ships** — including an entity master that ships with a mounted admin router and has **no row in the ledger at all**. If the programme's own ledger cannot say what exists, a member certainly cannot. The best mechanism in the set is Gödel Terminal's: **BETA pills at the point of use** plus a two-column *"In Gödel today / Working on"* strip a prospect reads before paying.
- **Evidence.** 🟢 `capability-ledger.md` staleness banner, 2026-09-26 (six for six, and the entity-master coverage gap at `api/main.py:107` / `:8707`). 🟢 `best-of-breed.md` §1 H2 and §3.6 X3.
- **⭐ Done well.** Each surface states its own status where it is used, and the statement is **derived from the code** rather than maintained beside it — a hand-maintained status list is the same defect renamed.
- **Maps to.** `FB-S12-02`, `FB-X3-01`, `FB-X3-02`.

#### JTBD-X10 — Trust a performance claim enough to act on it
- **Job.** When a product tells me something worked, I want to know it counted the failures too, so I can size against the claim instead of discounting it.
- **Trigger.** Reading any hit rate, grade, score or track record — the product's or a competitor's.
- **Current solution.** UCT, and it is already shipped: the public scoreboard's **locked** rules exclude no losers, report under-sampled picks separately as "too new", and quote **contract-price** gains. **Tool: UCT.**
- **What makes it hard.** The rules are unverifiable from outside, which is precisely why they are an asset and why they must be enforced in code rather than promised in copy. D-13 §7 records them as *"a public trust asset"* in the module's own docstring.
- **Evidence.** 🟢 D-13 §7 (the three locked rules, quoted from `api/flow_scoreboard.py`). 🟡 that the route is serving is a CLAIM in that section — the route is declared and was not called.
- **⭐ Done well.** A rate computed over a population that includes a loser cannot be rendered without it — enforced by a check that fails when a loser is excluded, with a control proving the check can fire.

#### JTBD-X11 — Be sure the name I typed is the company I meant
- **Job.** When I refer to a company, I want every surface to agree which company that is, so a note, an alert and a chart are about the same thing.
- **Trigger.** Typing a ticker; pasting one; reading one out of text.
- **Current solution.** Ticker-only search over `cap_universe.json`, with four independent resolvers behind it. An entity master **exists at admin level with a mounted router** — which the capability ledger has no row for. **Tool: UCT.**
- **What makes it hard.** ⛔ Ticker-shaped strings are not tickers and some tickers are words: `best-of-breed.md` §3.4 S3 grades the row 🔴 and unrankable, with *"Quartr wins the published half"*. The FIGI question is already settled from source — the reconciler reads `composite_figi` off the Massive reference response — but **coverage is not**, which is a data read, not an integration.
- **Evidence.** 🟢 `capability-ledger.md` staleness items 5 and 6 (`entity_figi` schema at `schema.py:78-85`, reconciler at `reconciliation.py:164-211`, router mounted at `api/main.py:107` / `:8707`; the field exists and is read, coverage unmeasured). 🟡 `best-of-breed.md` §3.4 S3, §3.1 A8.
- **⭐ Done well.** One resolver answers every surface, and a string it cannot resolve **refuses** rather than guessing — the observable being the resolver count, derived, not asserted.
- **Maps to.** `FB-S3-01`, `FB-S2-02`.

#### JTBD-X12 — Check something from a phone, between screens
- **Job.** When I am away from the desk, I want to check a position or a level without a laptop, so being away costs me information rather than control.
- **Trigger.** Away from the desk during market hours.
- **Current solution.** UCT's mobile paths exist per-surface rather than as a posture — `/calendar/mystocks` stacks rather than scrolling horizontally on mobile; live quotes poll at 4 s on mobile against 2 s on desktop. **Tool: UCT + thinkorswim mobile.**
- **What makes it hard.** ⚠️ This is the thinnest-evidenced entry in §3 and is kept only because a competitor built for it explicitly: thinkorswim ships **three** platforms, with mobile marketed as *"desktop trading power that fits in your pocket"* — a vendor's investment, not UCT's measured need. No telemetry in this programme distinguishes mobile from desktop sessions.
- **Evidence.** 🟡 `thinkorswim.md` §1–2 (the three-platform structure). 🟢 the per-surface mobile facts: `terminal-current-map.md` §1.10, §7 W9; `capability-ledger.md` A1 (4 s mobile / 2 s desktop poll). 🔴 no evidence of UCT mobile usage exists anywhere in the inputs.
- **⭐ Done well.** ⛔ **No observable can be stated** until mobile sessions are distinguishable from desktop ones in telemetry. Said plainly rather than invented.

### 3.8 The desk is also a publisher

⚠️ These four are **desk jobs, not member jobs**. They are in scope because the professional trader
this file is about is also the person who publishes: `OWNER_SEED_FACTS.md` §6 sets the business
priority as *"internal desk first, member onboarding second"*, and the Task Scheduler roster in §2 is
a publishing pipeline as much as a trading one.

#### JTBD-B01 — Publish in my own voice without writing it from scratch
- **Job.** When the letter has to go out, I want a draft that already sounds like me, so my time goes into judgement rather than into prose.
- **Trigger.** The daily wire build (06:35 CT); the weekly scan.
- **Current solution.** UCT, measured rather than described: `voice_profile.json` holds **24 metrics** mined from the published archive — `sentence_words_mean` 13.3 / p50 12.0, `em_dash_per_1000` 0.23 against a cap of **1.0**, `allcaps_word_rate` 0.0282, `first_person_per_1000` 26.8, plus signature phrases with per-post counts — beside **120 verbatim exemplars** retrieved by tape × section. **Tool: UCT.**
- **What makes it hard.** The target is auto-send, so the draft has to be right rather than editable, and "sounds like me" has to be a measurement. The archive count itself is disputed inside one document (see `## GAPS`).
- **Evidence.** 🟢 D-13 §2f (every metric above, with `owner_voice.py` as the runtime door).
- **⭐ Done well.** A draft goes out unedited and its measured voice metrics sit inside the profile's own bands — the bands being the observable, not a reader's impression.

#### JTBD-B02 — Tell the machine what was wrong with a segment and have the next one be better
- **Job.** When a section of the draft was wrong, I want the correction to change future drafts, so I fix a class of error once rather than the same error every morning.
- **Trigger.** Reading the draft; the per-segment thumb.
- **Current solution.** UCT, as a closed loop: the owner's per-segment 👍/👎 and notes are pulled by `wire_critic.py`, an Opus critic runs per qualifying segment, and distilled guidance plus up to three few-shot exemplars are written into `wire_prompt_config` — **26 versions recorded** — which `generate_rundown` reads back. Ten segments are registered in **one** place (`_SEG_LABELS`). **Tool: UCT.**
- **What makes it hard.** D-13 §2 grades the round trip a **CLAIM** at code level: 26 rows are *consistent with* it running, which is not the same as observing it run.
- **Evidence.** 🟢 D-13 §2e (the loop, the store, the 26 versions) and §2d (`_SEG_LABELS`, the one registry). 🟡 the round trip's own confidence line.
- **⭐ Done well.** A thumb-down on a segment changes that segment in the next issue, traceable from the feedback row to the config version to the rendered text.

#### JTBD-B03 — Answer a member's question with the desk's own record
- **Job.** When a member asks about a name, I want to answer from what the desk actually said and when, so the answer is a record rather than an opinion restated.
- **Trigger.** A question in Discord or on The Floor; a live desk session.
- **Current solution.** The material exists across three corpora and no surface unions them: desk video mentions (~300 rows from `edu_videos.ticker_moments`, surfaced as chart markers and a TickerPopup "Desk" timeline tab), the published archive, and **7,766 Discord messages** with `tickers[]` from 2024-03-11 to 2026-02-20. **Tool: memory and search, by hand.**
- **What makes it hard.** Same blocker as `JTBD-E02`, plus a durability one: `best-of-breed.md` §3.6 X1 records The Floor's 48 routes and 400-subscriber hub with **no backup rail for member posts**.
- **Evidence.** 🟢 D-13 §11 (all three corpora with volumes and spans). 🟢 `best-of-breed.md` §3.6 X1.
- **⭐ Done well.** A ticker query returns the desk's own prior statements with dates and their source surface, and a corpus that is unavailable says so rather than returning a short answer.
- **Maps to.** `FB-A13-01`, `FB-X1-02`.

#### JTBD-B04 — Show someone, before they pay, what they would get
- **Job.** When a prospect is deciding, I want to hand them something real and verifiable, so the decision is made on evidence rather than on claims.
- **Trigger.** A prospect; a public post; the top of the funnel.
- **Current solution.** Two shipped assets: the Saturday week-post PNG cards (also *"the top-of-funnel screenshot asset"*) and the **public, unauthenticated** flow scoreboard with its locked honesty rules. **Tool: UCT.**
- **What makes it hard.** ⛔ There is nothing to compare *within* the product — one paid tier (CARD 17), so no pricing table, no locked state, no upgrade affordance. The comparison is entirely against other products, which makes the honest track record the whole pitch. Gödel Terminal is the only benchmarked product with a member-facing mechanism for this, and it is a **self-declared public beta** publishing *"In Gödel today / Working on"* before the paywall.
- **Evidence.** 🟢 `terminal-current-map.md` §7 W7 (the week post and its funnel role). 🟢 D-13 §7 (the public scoreboard). 🟢 `DECISION_CARDS_2026-09-26.md` CARD 17. 🟢 `best-of-breed.md` §1 H2 (Gödel's mechanism).
- **⭐ Done well.** A prospect can verify one claim about the product without an account — and the claim they can verify includes the losses.

---

## 4. ⛔ The displacement list — jobs the desk leaves a tool open for

This is the most decision-relevant section in the file, because it is the one built on the only
primary testimony available. **Four tools are opened by hand on a trading day, plus unitemised
others** (`DECISION_CARDS_2026-09-18.md` §7d). A tool opened by hand every day is a job the product
does not do well enough to displace — regardless of whether the product has a feature with the same
name.

| Tool (owner-confirmed) | Jobs it holds | The programme's own verdict on displacing it |
|---|---|---|
| **thinkorswim / Schwab** | `JTBD-P06` (per-position options risk), `JTBD-O02` (chart work at the open), `JTBD-X07` (thinkScript), plus options back-testing against ~a decade of stored chains (thinkBack) and simulated trading (paperMoney) | ⛔ **Never fully displaceable.** `thinkorswim.md` §4: the platform is inseparable from a funded Schwab account — *"a brokerage-transfer decision, not a tool-preference decision"* — and §5's realistic ceiling is *"feature-parity on charting/scanning/options-analysis, never full displacement, as long as the member's capital sits at Schwab."* §5 names the two narrow absorb candidates: **options risk visualisation** and **options back-testing**. ⚠️ And it is a **silent** leak: UCT never links to thinkorswim, so no signal of the time spent exists. |
| **TradingView** | `JTBD-M02` (drill-down inspection), `JTBD-M06`/`JTBD-M07` (alerts — **owner-confirmed in the workflow**), `JTBD-X06` (config-as-citation), `JTBD-X07` (Pine) | 🟡 **Partly, and one leg is a bridge rather than a build.** `tradingview-desk-use.md` §2: TradingView sits at *"the narrative and inspection edges… never at the generation edge"*, and §5 is emphatic that it is **not in the screening loop at all** (🟢, zero code references). §6 proposes the cheap move: accept its webhook POST and *"turn a competitor surface into an upstream sensor instead of a destination."* |
| **Finviz Elite** | `JTBD-P02` (the standing Small+ screen), `JTBD-P04` (gap-with-news), `JTBD-M02` (the static chart tab) | 🟡 **Hardened, not absorbed.** `finviz.md` §5: *"Integrate-harden, don't absorb yet"* for the three automated screens, because absorbing prematurely *"risks silently degrading the candle score's inputs"* — but **Absorb** for the `chart.ashx` PNG tab, which UCT's own chart already beats. ⛔ This is the one tool whose failure has been **observed** to degrade a member-facing artefact (`SCAN HEALTH FAILED`, 2026-08-31). |
| **Unusual Whales** | `JTBD-O03` (the live tape and its alerts), `JTBD-O04` (dealer positioning), `JTBD-M06` (the `where` authoring grammar), plus community-published filters | ⚠️ **No desk-tool report exists for it.** It is the one owner-named tool with **no `desk-tools/` note** — only a competitor dossier written before the owner's answer. `best-of-breed.md` §3.1 A10 names it best-in-class for the **tape** while calling UCT's own flow stack *"the genuine differentiator"*, so the two overlap in a way nobody has mapped at desk-workflow level. Its dossier's own open question is the commercially sharpest one in the set: *"How much of Workflow E's value is the filters versus the community's published filters? If the latter dominates, the moat is social, not technical."* |
| **"Many many many others"** — unitemised, incl. Market Chameleon and SpotGamma | `JTBD-W04` (earnings-move calibration, Market Chameleon), `JTBD-O04` (a *published* regime by a named human, SpotGamma) | ⛔ **The absence of an itemisation is itself the finding.** §7d: *"Patrick did not rank by time spent and did not itemize the 'others' — asked, and declined the precision, which is itself an answer: the desk's real tool surface is wide, not the single narrow set OI-06's own registration enumerated."* Any displacement plan sized against the four named tools is sized against an undercount. |

⭐ **What the list says, in one sentence.** Of the five rows, exactly **one** (Finviz's static chart
PNG) is verdicted *absorb* outright; two are *harden* or *bridge*; one is structurally
undisplaceable; and one has never been studied as a desk tool at all. ⛔ A roadmap that reads the
four tools as four things to rebuild is reading this evidence backwards.

---

## 5. Jobs nobody serves well — with the evidence they are real

A job belongs here only if (a) something in the inputs establishes the job exists, and (b) the
inputs establish that no benchmarked product serves it. Both halves are cited.

| Job | Why it is real | Why nobody serves it |
|---|---|---|
| **A decisive, grounded, sourced verdict** (`JTBD-X05`) | Every grounded-AI product in the set built the retrieval half, so the demand is not in doubt; and `grade_ticker` already emits a structural verdict inside UCT | ⛔ Every one of them **refuses in writing** to answer the question the user asked. LSEG publishes the refusal template verbatim; FactSet disclaims advice; Quartr *"never renders a view"*; TradingView emits configuration; SpotGamma abstains from AI and pays a human. `best-of-breed.md` §1 H3(a) — *"Bloomberg cannot, at 350,000 seats, without becoming an advice business."* ⚠️ Honesty tax, stated in the same place: UCT's own exam reads **12/50 with Rungs 3–5 at zero.** |
| **The per-ticker history join** (`JTBD-E02`, `JTBD-B03`) | Four trails, 19,050 + 4,440 + 243 + 447/10,808 rows, plus 7,766 Discord messages and ~300 video mentions — all built, all kept (D-13 §11) | ⛔ *"No benchmarked product has it, several concede they structurally cannot"* (`best-of-breed.md` §1 H3(b)). Inside UCT the blocker is the **permission model**, not the data (D-13 §11). |
| **Reading participation and dealer positioning in one place** (`JTBD-M01` + `JTBD-O04`) | UCT built 40+ breadth metrics and a GEX stack; Unusual Whales built Periscope. Two products each built one half | ⛔ Unusual Whales has **no breadth rail at all** — *"no advance/decline, no % above moving average, no new-highs/new-lows, no distribution-day count"* — and its regime is *"entirely an options-market construct"* (UW §E.G). Its own RELEVANCE line names the gap: *"A desk that can read both… in one place has something neither product offers today."* |
| **A market clock as a system** (underlies `JTBD-O01`, `JTBD-C01`, `JTBD-W01`) | Every time-sensitive job in §3 depends on knowing what part of the session it is | ⛔ `best-of-breed.md` §3.4 S11: *"◻ **not established for any product**"* — the only row in the matrix where the best-in-class cell is empty for the whole universe. UCT-side it is *"absent as a system; `sessionModel.js`/`calendarTime.js` are the seeds."* |
| **Knowing what was considered and rejected** (`JTBD-E02`) | `wire_universe`'s 19,050 rows carry `dropped_at_stage`, `drop_reason` and a `feature_vector` snapshot — someone built and kept the rejection trail | ⛔ D-13 §11: *"a claim no competitor can make, and it is the kind of thing that reads as integrity rather than marketing."* No competitor publishes what it looked at and passed on. |
| **Trailing calibration of the market's own pricing** (`JTBD-W04`) | Market Chameleon built it for earnings, per symbol, and states it in words | 🟡 Partly served — by exactly one product, for exactly one event type. `market-chameleon.md` OBS 2 records nobody extending it beyond earnings, and UCT holding the inputs (`earnings_analytics`, 40,731 rows) without computing it. |
| **People and company intelligence** (feeds `JTBD-P04`, `JTBD-E02`) | It is a named row in the taxonomy, so the programme judged the job real enough to rank | ⛔ `best-of-breed.md` §3.2 E1: best-in-class is Bloomberg `MGMT` and it is graded **thin**, runner-up is **◻**, and UCT is *"absent — no equivalent anywhere in the ledger"*, at 🔴. |
| **Member-facing feature status at the point of use** (`JTBD-X09`) | Gödel Terminal, a $118/month self-declared public beta, built it — and UCT's own ledger being six-for-six wrong about what ships proves the internal version of the same need | 🟡 Served by **one** product in a set of fifteen (`best-of-breed.md` §1 H2, §3.4 S12). ⭐ The correlation that file names: *"Price is uncorrelated with mechanism quality… The correlation is with whether the vendor had to explain itself to a self-serve buyer."* |

---

## 6. Weak entries — quarantined, not stated as findings

⛔ These are jobs I believe a professional trader has and **could not evidence from this programme's
inputs**. They are here rather than in §3 because the discipline that makes §3 worth reading is that
every entry carries an artefact. An entry with no artefact is a hypothesis, and putting it in a
numbered library would launder it into a finding.

The count is the number of `#### WEAK-` headings in this section
(`grep -c '^#### WEAK-' 04-workflows/jobs-to-be-done.md`).

#### WEAK-01 — Decide whether I should be trading at all today
- **Believed job.** When I slept badly, am in drawdown, or am angry about yesterday, I want a check that stops me before the first click.
- **Why quarantined.** The wire payload has a `discipline` key (7 fields, D-13 §2a), but that is *market* discipline — the tape's condition, not the trader's. Nothing in the inputs addresses trader state. ⛔ Plausible, universal in trading literature, **uncited here**.

#### WEAK-02 — Know whether my own execution is eating my edge
- **Believed job.** When my backtest and my account disagree, I want to know how much of the gap is fills and slippage.
- **Why quarantined.** The estate models this rather than measures it: `commission_bps=1.0` and `slippage_bps=4.0` are **assumptions** in `BOOK_DEFAULTS` (D-13 §3), and the broker mirror is read-only. `best-of-breed.md` §1 H3(b) cites SpotGamma's concession that it *"never sees a fill"* — the same limit applies here. A job about real fills cannot be evidenced from modelled constants.

#### WEAK-03 — Coordinate with a partner on a live position
- **Believed job.** When two of us are in the same name, I want to see what the other has done without asking.
- **Why quarantined.** The programme evidences partner collaboration only in **code** (`OWNER_SEED_FACTS.md` §4 names five partner-owned modules) and dogfooding headcount as a **default** (*"2 to 5 internal users… Ask."*). Nothing evidences co-trading. Bloomberg IB is best-in-class for collaboration, and `best-of-breed.md` §3.6 X1 scores its network **zero** on transferability — *"cloning the network without the network."*

#### WEAK-04 — Notice that a strategy has stopped working, while it is stopping
- **Believed job.** When a setup's edge is decaying, I want to know now rather than in next quarter's review.
- **Why quarantined.** The **retrospective** half is strongly evidenced — `setup_performance` splits EP by regime phase and the sign flips (D-13 §3) — and the **live-detection** half is not evidenced at all. ⚠️ Stating it as a job would import a detector nobody has asked for, and the estate's own history with a paused 15.7%-precision engine (`capability-ledger.md` B7) is the reason to be careful.

#### WEAK-05 — Work hands-free during the open
- **Believed job.** When both hands are busy at 09:31, I want to ask and be answered without typing.
- **Why quarantined.** ⛔ The only trace is `VITE_PICOVOICE_ACCESS_KEY` in the environment variable roster (`contracts/D-03.md`), and this programme's own rule forbids reading that as evidence: *"A provider key present in configuration is not evidence the provider is used"* (`OWNER_SEED_FACTS.md` §3). Quarantined **by the programme's own standard**, and kept here as the worked example of it.

#### WEAK-06 — Account for the tax consequence of a decision
- **Believed job.** When I close a position in December, I want to know what it costs me after tax.
- **Why quarantined.** Zero citations. No tax, wash-sale, lot-selection or after-tax artefact appears anywhere in the inputs — and `OWNER_SEED_FACTS.md` §6 puts execution and order management off the table for V1, which is adjacent but not the same ruling. Recorded so that its absence is a decision rather than an oversight.

⚠️ **Two entries in §3 are near this line and were kept, with the reason stated in their own Evidence
lines:** `JTBD-X12` (mobile — kept on a competitor's investment, with 🔴 on UCT-side usage and an
explicit *no observable can be stated*) and `JTBD-O02` (the opening drive — kept because a paused
engine is evidence of a job, not of a feature).

---

## 7. ⛔ What this document does NOT decide

1. **It does not rank the jobs.** §1 names three as most important and says why in evidence terms;
   that is an argument, not a ranking, and the owner declined to rank by time spent
   (`DECISION_CARDS_2026-09-18.md` §7d). Item 17's scoring matrix ranks; this file does not.
2. **It does not size, sequence or schedule anything.** No band, no estimate, no order. Item 16 owns
   sizing and this file cites its ids without restating a single one.
3. **It does not assign a job to a surface.** A job is deliberately stated so that more than one
   interface could serve it (§2.3); choosing the interface is items 19–20.
4. **It does not name a tier, a price or a gate.** CARD 17 leaves one paid tier and nothing to
   compare; price, trial and seat model remain explicitly undecided and not this file's.
5. **It does not decide any displace/absorb/bridge call.** §4 reports the verdicts the four
   desk-tool reports already recorded, each of which labels itself a **hypothesis pending owner
   confirmation** (`thinkorswim.md` §0).
6. **It does not establish frequency, duration or value.** No job here carries how often it happens,
   how long it takes, or what it is worth. Those need member research this programme does not have.
7. **It does not settle whether a quarantined job is real.** §6 records six beliefs and zero
   findings. Promotion out of §6 requires an artefact, not a second opinion.
8. **It does not supersede `04-workflows/`'s other deliverables.** `personas.md` (item 12),
   `workflow-library.md` (item 14) and `daily-journey.md` are NOT STARTED; this file is the first
   artefact in that directory and takes no position on their contents.

---

## GAPS

1. ⛔⛔ **Zero member research, and it is the ceiling on every entry.** No interview, survey, session
   recording, click path, support ticket, churn reason or win/loss note exists in the inputs. ⭐ The
   single cheapest thing that would move this file: **one recorded morning's click sequence.**
   `tradingview-desk-use.md` §2 asks for exactly that and states why — *"D-13/D-14 can show where the
   doors are; only a session account shows which ones actually get walked through, in what order,
   and how often."*
2. ⛔ **No rank and no time-spent, permanently as far as this file can reach.** The owner was asked
   and declined. Every "most important" judgement in §1 is therefore an evidence argument, and §4's
   displacement list is unordered by design rather than by omission.
3. ⛔ **Unusual Whales has no desk-tool report.** It is one of four owner-named hand-opened tools and
   the only one without a `desk-tools/` note. Its dossier predates the owner's answer, so nothing has
   examined it *as the desk uses it*. This is the largest single hole under §4.
4. ⚠️ **The "many many many others" are unitemised.** Market Chameleon and SpotGamma are named as
   probable members; the rest are unknown. Any count of the desk's external tool surface is a floor.
5. ⚠️ **Two inputs disagree with themselves and the disagreements are carried, not resolved.**
   (a) The published archive: D-13 §2f reads `posts_total` **88** (27 articles + 61 Sunday Scans) from
   `voice_profile.json`, while D-13 §11 states **92** Substack posts (65 Sunday Scans) — same
   document, same archive, two counts. (b) The universe: `capability-ledger.md` A8 gives
   `cap_universe.json` **3,742** tickers, while the wire payload's `cap_universe` key measures
   **3,721** symbols (D-13 §2a). Both are small, both are the kind of drift this programme's own
   control documents record against everyone else, and neither is this file's to settle.
6. ⚠️ **`capability-ledger.md` is under a staleness banner and every "current solution" line inherits
   it.** Six of six checked cells were wrong, all **understating** what ships, so any statement here
   that UCT lacks something is unverified rather than established. ⛔ Per that banner: do not read an
   "absent" cell as evidence of absence. Entries most exposed: `JTBD-X09`, `JTBD-X11`, `JTBD-X08`.
7. ⚠️ **Every production count is n≈13–29.** The telemetry file says it of itself: *"That is a
   listing, not a statistic — read as an existence check."* 956 alert fires, 79 AI searches, 17
   layouts and 16 seen-rows are each an existence check on whether a job has a holder, and none is a
   rate.
8. ⚠️ **The arc of the day is a narrative device.** Only three time-of-day facts are in evidence
   (§2.6). An entry's hour is inference unless its Trigger line cites a clock.
9. **Nothing here was checked against code.** By instruction this file reads the programme's own
   artefacts only — no repository read, no test, no script, no network call, no git command. SHA not
   pinned (no git by instruction).
10. **The four desk-tool reports are pre-owner-answer.** All four are dated 2026-09-02 and were
    written against an assumption set the 2026-09-19 answer reversed in both directions. Their
    verdicts are re-usable; their framing of what the desk *might* do is 17 days stale. One
    consequence is already visible and recorded at `JTBD-M07`: `tradingview-desk-use.md` §6's own
    OPEN QUESTION is now answered, and the report does not know it.

---

## SOURCES

**Owner testimony (Level-1, `GOVERNING_PRINCIPLES.md` §2).**
`12-decisions/DECISION_CARDS_2026-09-18.md` §7d ("OI-06's real answer, put to Patrick directly —
2026-09-19") · `12-decisions/DECISION_CARDS_2026-09-26.md` CARD 17 (one paid tier) ·
`00-program-control/charter/OWNER_SEED_FACTS.md` §1–§3, §6 · `00-program-control/OWNER_INPUTS.md`
Part A (A3 and the two conservative defaults).

**Production measurement.**
`verification/2026-09-14/OI-06-telemetry-derived-defaults.md` §1–§6 — read in-pod against
`/data/auth.db` (377,577,472 bytes), 29 users, 4,949 `page_views` rows, 50 admin session-days; both
surface orderings; `calendar_seen` 16; `calendar_alerts_fired` 956; `ai_search_log` 79;
`user_preferences` 186; 17 layouts / 7 signatures; 65 SQLite databases under `/data`.

**Programme control.**
`00-program-control/CRITICAL_PATH.md` (CP-06 row and the 2026-09-23 correction; the Tier-1 gate
line) · `00-program-control/MASTER_CHECKLIST.md` row 13 · `00-program-control/AGENT_REGISTRY.md`
F-07 · `00-program-control/charter/C-master-directive.md` (deliverable 13) ·
`00-program-control/charter/B-execution-operating-system.md` (the `04-workflows/` address) ·
`00-program-control/contracts/B-DESK.md` (the owner's tool defaults) ·
`00-program-control/contracts/D-03.md` (the environment-variable roster, cited once, at `WEAK-05`) ·
`00-program-control/COMPLETION_AUDIT.md` §3.4f.

**Desk tools — the four the desk actually uses, weighted above the dossiers (all dated 2026-09-02).**
`03-competitive-research/desk-tools/thinkorswim.md` §0, §1–2, §3, §4, §5 ·
`.../tradingview-desk-use.md` §2, §3, §5, §6, §7 · `.../finviz.md` §1–2, §3–4, §5 ·
`.../market-chameleon.md` OBSERVATION 2, OBSERVATION 3.

**Competitor dossier.**
`03-competitive-research/unusual-whales/dossier.md` §E (workflows A–G) — the one owner-named
hand-opened tool with no desk-tool note.

**Synthesis inputs.**
`05-product-strategy/capability-matrix/best-of-breed.md` (item 10) §1 H1–H3, §2.1, §3.1–§3.6, §6.2 ·
`05-product-strategy/proprietary-asset-inventory-raw.md` (D-13) §2, §3, §4, §7, §11 ·
`05-product-strategy/feature-opportunity-backlog.md` (item 16) §2.6 and the `FB-*` id roster — **ids
cited, no item restated** · `01-existing-system/capability-ledger.md` (item 3) frontmatter, the
2026-09-26 staleness banner with items 5 and 6, rows A1, A8, B1, B5, B7 ·
`01-existing-system/terminal-current-map.md` §1.3, §1.10, §7 (W1–W9).

**Not read, and named so the omission is a decision.** The nine Bloomberg leaf files, the Gödel leaf
files, and the AlphaSense / FactSet / Koyfin / Quartr / LSEG / Benzinga / SpotGamma / Fiscal.ai /
adjacent-notes dossiers were **not** opened for this file; every reference to them here is
second-hand through `best-of-breed.md`, which read them, and is graded accordingly. Reason: the
brief weights the desk's own tools above the dossiers, and memory on this box is constrained.
`04-workflows/` was listed and contains only `.gitkeep` — this is the first artefact in it.

---

## ⛔ What this document does NOT decide

See §7, which is this section in full and is placed in the reading order where a reader needs it.
Restated in one line so a reader arriving at the end is not misled: **this file establishes that
these jobs exist and cites what establishes it; it does not rank them, size them, assign them to a
surface, price them, or decide which tool gets displaced.**
