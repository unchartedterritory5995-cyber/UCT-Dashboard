---
id: A-03-MVP
title: MVP Definition — the smallest thing that moves one named task off one named tool, which is a trial with at most one build, not a feature list
role: >
  Gate item 27 — MASTER_CHECKLIST item 27 ("MVP Definition", `10-roadmap/mvp.md`, owners A-03 +
  H-01, status NOT STARTED before this file). ⚠️ The dispatch calls this "gate item 27" while
  `MASTER_CHECKLIST.md`'s own Gate column reads **18** for the row; both are recorded, neither is
  reconciled here, and `MASTER_CHECKLIST.md` owns the value. This is the same unreconciled
  dispatch-vs-Gate drift items 16 and 17 record about themselves.
  ⛔ This file defines DONE for the first increment and names the displacement it must produce. It
  does NOT sequence anything (item 28), does not own the dependency graph (item 29), does not score
  or re-band the backlog (item 17), and does not renumber or restate item 16's items.
wave: 5
group: A
category: roadmap
inputs: >
  `12-decisions/DECISION_CARDS_2026-09-26.md` (**CARD 22** in full — §1–§6 — plus CARD 17, CARD 21,
  CARD 16, CARD 20-EXEC and the closing owner-only table) ·
  `04-workflows/jobs-to-be-done.md` (F-07, item 13 — §4's five-row displacement list, `JTBD-M01`,
  `JTBD-M02`, §5's unserved-jobs table; **its verdicts are taken as given, not re-derived**) ·
  `05-product-strategy/feature-scoring.md` (F-05-SCORING, item 17 — §1 H1/H2/H3, §5's six bands and
  their membership rules, §6) ·
  `05-product-strategy/feature-opportunity-backlog.md` (F-05-BACKLOG, item 16 — the 85-item roster,
  and per-item `Size` / `Depends on` / `Anti-pattern risked` / `Known it worked` for the items named
  below; §3.2's A2 "⛔ No item" cell and §5 item 9's exclusion) ·
  `05-product-strategy/capability-matrix/best-of-breed.md` (F-05, item 10 — §1 H2/H3, §6.1, §6.2 and
  its three unclosable gaps) ·
  `10-roadmap/success-metrics.md` (A-02, item 35 — §2's four-field contract and its three carried
  obligations, §3.1's population arithmetic, §3.3, PH-5, §4.0's computability table, SM-11) ·
  `10-roadmap/rollout-rollback.md` (H-07, item 37 — §1.4's six tiers, §1.5, §2's rungs S0–S4 and the
  reach column) · `10-roadmap/dependency-graph.md` (H-04, item 29 — H3's three inversions, §5.2's
  parallelism reduction, §5.3's wave shape) ·
  `01-existing-system/capability-ledger.md` (F-03a — its 2026-09-26 staleness banner, rows G1–G5,
  F6, J4, O4, O6, O8, P6) · `03-competitive-research/desk-tools/finviz.md` (§2, §5's verdict table) ·
  `03-competitive-research/desk-tools/tradingview-desk-use.md` (§2, §5, §6, and its embed-context
  hypotheses) · `09-security-licensing-cost/licensing-register.md` (T-49) ·
  `00-program-control/CRITICAL_PATH.md` (CP-04, CP-06) ·
  `00-program-control/OWNER_INPUTS_REQUESTED.md` (OI-02, OI-06, OI-21) ·
  `00-program-control/charter/OWNER_SEED_FACTS.md` (§6, the tier/price seed line).
scope: >
  Read-only over programme artefacts. ⛔ **No git command of any kind was run — SHA not pinned (no
  git by instruction).** No network request, no WebFetch, no `railway` command, no production call,
  no browser, no test and no script against the repo. ⛔ **No file under `api/**` or `app/**` was
  opened**, so every statement about running code is carried from a programme artefact at its own
  stated date. The only code run was `grep -c` / `grep -o | sort -u` counting over programme
  markdown and over this file's own output, and every count states its pattern. One file was
  written: this one. `04-workflows/jobs-to-be-done.md` was READ and never edited (another session
  owns it); `10-roadmap/backlog.md` was neither read nor written.
confidence: >
  🟢 that CARD 22's rule is transcribed, not paraphrased, wherever this file states a requirement as
  binding. 🟢 on item 13's five displacement verdicts — they are quoted from its §4 table and this
  file re-derives none of them. 🟢 on the 85-item roster and on every count in §4/§5 (patterns
  printed). 🟡 on the choice of displacement candidate, which is an argument over item 13's
  verdicts plus item 10's and item 37's evidence, not a measurement. 🔴 on the single most
  consequential factual premise — **whether the Breadth `DrillModal` already renders a native UCT
  chart tab** — which is an absence claim at two removes, marked 🔴 in its own source, and which
  decides whether this MVP contains a build at all (GAPS 1). 🔴 on anything about what the desk
  actually does each morning: OI-06 names four tools and declines the per-tool workflow, so the
  workflow named in §6 is derived from the estate's own embeds, not from testimony.
evidence_ceiling: >
  ⛔ **THE CEILING THAT MATTERS: nothing in this file was observed.** The displacement it defines has
  not happened, the subject who would supply the verdict is unnamed (CARD 22 §6, OI-02), and the one
  behavioural fact underneath the whole document — *which* task the desk opens Finviz for by hand —
  is explicitly not in the record: CP-06 records the owner "declined that level of detail as
  unnecessary". So the workflow in §6 is the programme's best-evidenced CANDIDATE and the owner may
  replace it in one sentence, which §6 is built to survive.
  SECOND CEILING: **an "absent" cell in the capability ledger is not evidence of absence.** Its
  banner reads *"DO NOT TREAT AN 'absent' CELL HERE AS EVIDENCE THAT SOMETHING IS ABSENT"*, and
  that much is right. ⚰️ **CORRECTED 2026-09-26 (found by the gate-item-31 author): this ceiling
  originally read "understates what ships, six for six" and concluded the error direction was that
  this MVP is "SMALLER than stated, never larger". THAT IS FALSIFIED.** Measured across seven
  re-derived cells: five understated, **one OVERSTATED** (row A8 records `cap_universe.json`
  at 3,742; the file at master holds **3,640**), two were exactly right. **A ledger cell is a dated
  measurement whose error has NO RELIABLE SIGN**, so the ceiling is real but directionless — the
  old wording licensed reading a small cell as a floor, which is the one inference it must not
  support. Every "does not exist today" below therefore carries the cheapest read that would settle
  it, and the direction of the error is **unknown until that read is done**.
  THIRD CEILING: **no member and no trader asked for any of this.** Item 16 §5 records *"No member
  ever asked for anything in this file"*, signup is closed under `COMING_SOON_MODE`, and the richest
  usage table supports an existence check over 13 accounts, 6 of them admins (item 35 §3.1).
  FOURTH CEILING: **no price, no cost and no revenue input is used here, and none may be.** ✅ CORRECTED 2026-09-26 (CARD 23): the two "disagreeing" price artifacts were **two PRODUCTS**. UCT Intelligence is **$200/month or $2,000/year**, owner-ratified; the $7/week is the **Whop** plan, a separate product. The ceiling itself is UNAFFECTED and still binding — this document uses no price input either way.
status: draft
date: 2026-09-26
---

# MVP Definition (item 27)

## 1. Headline — the MVP in three sentences, and the one task it displaces

**The MVP is a pre-registered displacement trial, not a release.** Its deliverable is a dated record
showing that one named task was done in Terminal-Next on K of N eligible occasions while the named
incumbent tool was not opened for it, plus a signed judgement admitting it is a judgement (CARD 22
§4). Everything this document builds exists because CARD 22's own clauses cannot be satisfied
without it — and that is at most **one** build.

**The task it displaces: `JTBD-M02` — "find out which names are behind a number I just read", and
specifically its chart-inspection step.** Today the Breadth `DrillModal` answers *which names* and
then hands the chart to third parties: a TradingView iframe tab, which item 13 records as its
**default** tab, and two Finviz static `chart.ashx` PNG tabs, Daily and Weekly
(`jobs-to-be-done.md` `JTBD-M02`; `tradingview-desk-use.md` §5 item 2; `finviz.md` §2).

**The incumbent under test is Finviz, and only Finviz.** Of the five rows on item 13's displacement
list, **exactly one is verdicted *absorb* outright**, and it is this one: *"**Absorb** for the
`chart.ashx` PNG tab, which UCT's own chart already beats"* (`jobs-to-be-done.md` §4, the Finviz row,
quoting `desk-tools/finviz.md` §5). ⭐ **That is the entire reason the MVP
is this and not something more impressive:** it is the only candidate on the programme's own list
where the verdict is absorb rather than harden, bridge, never, or never-studied.

⚠️ **And the unglamorous part is the point.** The thing being displaced is a static PNG image of a
daily candle chart. `finviz.md` §5's basis for the verdict is that *"UCT's own Lightweight Charts
(`StockChart`) already renders daily/weekly candles with a richer feature set (crosshair OHLCV
legend, live streaming, MA overlays) than a static PNG; the Finviz tab appears to be a legacy/cheap
fallback, not a capability gap."* ⭐⭐ **If that sentence is true, the MVP contains no build at all
and is purely a trial** — and the single most valuable thing this document can do is say so out
loud rather than assemble a release around it.

---

## 2. ⛔ What "MVP" means here, given CARD 22

**A feature list is not the deliverable, and this is not a stylistic preference.** CARD 22 re-cut
the programme's definition of done hours before this file was written, after a three-reviewer panel,
and it replaced the *definition of done* with a **displacement ledger**: *"the adversarial reviewer
says demote it: keep the charter sentence as a thesis and replace the definition of done with a
displacement ledger. **RULING: adopt that too**"* (CARD 22 §2). The charter's four-times-repeated
sentence — *"the smallest coherent version that proves the Terminal-Next thesis, meaning our own
traders voluntarily prefer it for at least one meaningful daily workflow after reasonable
onboarding"* (item 35 §3.3, citing `GOVERNING_PRINCIPLES.md:113` and three charter files) — **stays
as the thesis it always was**, and stops being the bar.

**So the shape of this document is forced.** The bar is one named task moved off one named external
tool. Consequences, each of which removes something a conventional MVP document would contain:

1. ⛔ **A feature list that displaces nothing is not an MVP under this ruling, however good the
   features are.** Item 17 scored all 85 candidates on seven axes and found **11 survive all
   seven** with a Band 0 of **HELD (10), explicitly "not builds"** (item 17 §1 H1, §5). ⚠️ **Those
   11 are not this MVP and item 17 never said they were** — its own role field says it *"does NOT
   pick an MVP (item 27)"*. Band membership answers *"what is cheap and provable to build"*; CARD 22
   asks *"what moves one task off one tool"*. ⭐⭐ **The two orderings disagree, and the
   disagreement is a finding rather than an error in either:** §4's one conditional item sits in
   item 17's **Band 5**, the band its own text warns is *"not a rejection band and reading it as one
   would be the worst misuse of §5."*
2. ⛔ **Preference is a subtraction, never an addition** (CARD 22 §1(3)): *"A tool added while
   nothing is removed has been tolerated. 'I use it every morning' is true of five open tabs."* So
   the MVP's success condition is about a tool going quiet, not about a surface being used.
3. ⛔ **The owner cannot supply the YES**, by three independent routes — a subject cannot adjudicate
   their own preference; his switching cost is ~0 and he needs no onboarding, making him *"the worst
   available subject, not the most convenient one"*; and *"a builder's session is QA and in a log QA
   is indistinguishable from preference"* (CARD 22 §1(1)). **Recorder and adjudicator are different
   people** (§2's ruling), and the adjudicator's act is *"does this record satisfy the rule signed
   on date D"*, answered **PASS / FAIL / INCONCLUSIVE**.
4. ⛔ **The judged clauses are not going to be dressed as metrics.** *Meaningful*, *reasonable
   onboarding* and *voluntarily* *"cannot be made rigorous at this n"* and are written as a signed,
   dated judgement that says on its face that it is a judgement — *"A judgement that admits what it
   is cannot be quietly waived — only reversed by its signatory"* (CARD 22 §4).
5. ⛔⛔ **Pre-registration is the one blocking requirement**, and §6 is this document discharging it:
   the workflow, the incumbent tool, the subject and the span must appear in a dated artifact whose
   timestamp precedes day 1; absent ⇒ *"the claim is blocked regardless of anyone's opinion."*
6. ⛔ **No span of consecutive days.** CARD 22 §3 killed that shape — *"a conjunction of five events
   that a HEALTHY product fails"* whenever the workflow legitimately is not wanted — and replaced it
   with **K of N eligible occasions**, K and N *derived from a baseline phase that first measures how
   often the workflow occurs at all*. ⭐ *"A rate needs a denominator somebody measured, not a span
   somebody liked."* §6 therefore names **no K and no N**, and naming one here would be the defect
   CARD 22 removed.
7. ⛔ **One paid tier, so no tier is an MVP lever.** ⚠️ And a correction to this file's own brief,
   which called it a fresh ruling: **CARD 17 restored a seed fact rather than introducing one** —
   `charter/OWNER_SEED_FACTS.md` §6, dated **2026-09-01**, already read *"one paid tier whose
   paywalled item is the Morning Wire, with a $7 weekly promo."* Either way the consequence is
   identical and binding: no tier-comparison surface, no upgrade affordance, no "in the paid
   version", and the entitlement axis is a binary (CARD 17 items 1–3).

⭐ **One sentence that is worth more than the rest of this section.** CARD 22 refused the half of its
own delegation that asked for a simulated beta test, because *"a simulated trader preferring a
simulated terminal is evidence about the simulation… A panel can decide the RULE. Only a person can
supply the VERDICT."* **This document is the rule. It cannot contain the verdict, and any version of
it that reads as though it does is wrong.**

---

## 3. The displacement candidate, argued

### 3.1 The elimination, taken from item 13's verdicts rather than re-derived

Item 13 studied the tools and verdicted each. ⛔ **Its verdicts are given here, not reopened** — it
is the artifact that owns them, and reopening them in an MVP document would put a second authority
on one sentence.

| tool | item 13's verdict | what it means for a definition of done |
|---|---|---|
| **thinkorswim / Schwab** | ⛔ *"Never fully displaceable"* — the platform is *"inseparable from a funded Schwab account… a brokerage-transfer decision, not a tool-preference decision"*; ceiling is *"feature-parity on charting/scanning/options-analysis, never full displacement"* | ⛔⛔ **A bar written against it is unachievable by construction.** The broker-locked tool is the hardest to displace and the measured clause could never read clean while the capital sits there. ⚠️ Item 13 adds that it is a **silent** leak — UCT never links to it, so no signal of time spent exists, which also means no baseline phase can measure its occasions |
| **TradingView** | 🟡 *"Partly, and one leg is a bridge rather than a build"*; §6's cheap move is to accept its webhook POST and *"turn a competitor surface into an upstream sensor instead of a destination"* | ⛔ **A bridge is the opposite of a displacement.** Ingesting TradingView's webhook keeps TradingView permanently in the loop; the measured clause requires the incumbent *not opened*. ⭐ A bar written against the bridge leg fails on day 1 by design, and it is right that it does |
| **Finviz Elite** | 🟡 *"Hardened, not absorbed"* for the three automated screens — absorbing prematurely *"risks silently degrading the candle score's inputs"* — **but Absorb for the `chart.ashx` PNG tab** | ✅ **The only absorb-outright row in the programme.** ⛔ And note what it rules OUT: the morning screen is *harden, not absorb*, so the obvious candidate is disqualified by name (§3.3) |
| **Unusual Whales** | ⚠️ *"No desk-tool report exists for it"* — the one owner-named tool with no `desk-tools/` note, only a dossier written before the owner's answer | ⛔ **You cannot pre-register a workflow for a tool nobody has studied at desk-workflow level.** Item 13 records that UW's tape and UCT's flow stack *"overlap in a way nobody has mapped"* |
| **"many many many others"** | ⛔ *"The absence of an itemisation is itself the finding"* — *"the desk's real tool surface is wide, not the single narrow set OI-06's own registration enumerated"* | ⚠️ **Any displacement plan sized against four tools is sized against an undercount** — which is a reason to claim one task, not four tools |

⭐ **Item 13's own one-sentence summary, which is the sentence that chose this MVP:** *"Of the five
rows, exactly one (Finviz's static chart PNG) is verdicted absorb outright; two are harden or
bridge; one is structurally undisplaceable; and one has never been studied as a desk tool at all.
⛔ A roadmap that reads the four tools as four things to rebuild is reading this evidence
backwards."*

### 3.2 So: which task, off which tool

**The task.** `JTBD-M02` — *"When a number disagrees with what I am seeing, I want the constituent
names immediately, so I can tell a real rotation from an artefact of how the number is computed"*,
triggered by *"a breadth cell, heatmap tile or aggregate that contradicts the tape"*. Its recorded
current solution: *"The drill exists and then **hands the answer to two third-party tools**: the
Breadth `DrillModal` offers a TradingView iframe tab and a Finviz static `chart.ashx` PNG tab."*

**The tool: Finviz, at exactly one point of use** — the `chart.ashx?t={sym}&ty=c&ta=1&p=d|w`
Daily/Weekly PNG tabs on the Breadth `DrillModal` and `ThemeTracker`, which `finviz.md` §2 calls the
*"second, lighter workflow"* and describes as *"display-only — no data flows back into UCT's engine
from it."*

⛔ **TradingView's tab sits on the same surface and is explicitly NOT the incumbent under test.**
Naming two tools in one pre-registration would make any failure unattributable — the subject could
leave Finviz and land on TradingView, and the record would read as a pass on one clause and a fail
on another with no way to say which product behaviour caused it. ⭐ CARD 22 §4's measured clause
already anticipates this and is why the record must state **what else was open, named**: TradingView
staying open is a legitimate, recorded, non-failing state under PH-5's normal case — *"A desk that
keeps a specialist external tool open for a task Terminal-Next never claimed is **not** a failure of
this bar"* (item 35, PH-5).

### 3.3 Why this one is the most winnable — six reasons, and one of them is uncomfortable

1. ⭐⭐ **It is the only absorb-outright row.** Every other candidate's definition of done is either
   unachievable by construction (thinkorswim), self-defeating (TradingView's bridge), verdicted
   *not yet* (the Finviz screens), or unstudied (Unusual Whales). §3.1 is the whole argument.
2. ⭐ **The incumbent is reached from inside a surface we own.** The Finviz PNG is a *tab*, not a
   browser trip, so the act being displaced is a click the subject makes inside the product. That
   makes the daily record concrete — *which tab did you use for this drill* — rather than a
   recollection about another window. ⚠️ It does not make the record automatic: see §7.3.
3. ⭐ **Item 13 already wrote the acceptance criterion, in its own `⭐ Done well` field:** *"The
   drill answers 'which names' inside the product, and the two embedded third-party tabs stop being
   the answer — **observable as the tabs being removable without losing an answer**."* ⛔⛔ **Read
   the modal verb: *removable*, not *removed*.** §6 turns that into the one design constraint the
   trial must not break (§3.4).
4. ⭐ **A second, independent reason that is not about preference at all.** `licensing-register.md`
   T-49 classifies serving Finviz-rendered chart PNGs into member pages as **U, leaning R**, records
   that `robots.txt` *"disallows `/chart` and `/image`"* and that there is *"no grant anywhere
   because there is no document to grant one"*, and its own recommendation is *"retire images,
   render from Massive"*. ⚠️ **Stated precisely: T-49's column reads ANSWERED (see T-47) and the
   mitigation is *"no longer forced, but still the lower-risk design"*.** So this is a supporting
   reason, not a compliance emergency, and inflating it would be dishonest. ⭐ What it does mean is
   that a PASS here retires an exposure as a side effect, which no other candidate offers.
5. ⭐ **The rollback is the cheapest tier the programme has.** Item 37 §1.4's tier 1 — *"env var, no
   rebuild… reach = each member on their next authenticated request"* — covers the whole trial,
   because the surface is arrived at behind a flag (§4.2). Nothing here needs tier 3's
   revert-and-push, and nothing touches the one place item 37 RB-11 forbids during RTH.
6. ⚰️ **And the uncomfortable reason, which belongs in the argument and not in a footnote: this may
   already be done.** `finviz.md` §5 says our chart already beats the PNG; the capability ledger's
   banner says its absence cells understate what ships, **six for six, all in the same direction**;
   and the claim that the drill has no native chart tab is 🔴 *"pure hypothesis"* in its own source
   (`tradingview-desk-use.md` §5 item 2, which also records *"no usage split between DrillModal's
   three tabs"*). ⭐⭐ **If the native tab already ships, this MVP is a trial with zero build — and
   that is the best possible outcome, not an embarrassment.** It would mean the charter's bar was
   reachable before day 1 and nobody had tried, which is exactly the finding a displacement ledger
   exists to produce.

### 3.4 ⛔⛔ The design constraint that most MVPs would get backwards

**Do not remove the Finviz tabs during the trial.** CARD 22's judged clause is *voluntarily*, and
§1(3) is *"preference is a subtraction"* — a subtraction the **subject** makes, not one the builder
makes for him. If the tab is deleted, the subject has no alternative, the measured clause reads
clean by construction, and ⛔ **a forced move that the subject resents is indistinguishable in the
record from a preference.** That is this programme's signature failure shape at product altitude:
an instrument that cannot observe the thing it names (CARD 22's opening refusal).

⭐ So the trial's shape is: **both answers remain reachable, and the record counts which one was
chosen.** Deletion is the *consequence* of a PASS, not part of the MVP — and on a PASS it is also
T-49's mitigation, which is why §9 hands it to item 28 rather than doing it here.

---

## 4. What must exist for that one displacement to work

⛔ **Membership rule for this section, applied before anything was added:** an item is IN only if a
clause of CARD 22 or a recorded property of the trial surface cannot be satisfied without it. *"It
is clearly good", "it is cheap", "it is in Band 3" and "it unblocks eleven other items" are all
reasons this section rejects.* Every row states which clause forces it.

### 4.1 The one build — and it is NOT an `FB-*` item, which is itself the finding

**B-1. The drill's own chart, mounted via `ChartPane`, with an honest empty state.**

- **What it contributes.** It is the answer the subject must be able to prefer. Without a native
  chart in the drill there is nothing for the Finviz tab to lose to, and the measured clause can
  never read *"the work happened in Terminal-Next"*.
- ⛔ **No `FB-*` id owns it, and item 16 says so deliberately.** Item 16's A2 row reads **"⛔ No
  item."**, because `capability-infrastructure-matrix.md` A2's remaining gap is *"**No gap.** Data
  is fully served; the only 'gap' is architectural discipline (do not edit B1's internals)"*, whose
  binding rule is *"never refactor inside Terminal-Next scope, consume via ChartPane"* — recorded as
  *"binding, not advisory"*. Item 16 §5 item 9 excludes *"anything inside `StockChart.jsx`"* and
  names the two candidates it cut for that reason. ⭐ **Mounting `ChartPane` is not the excluded
  work — it is the prescribed work:** ledger B1 records `StockChart.jsx` at *15,500 lines / ~120
  props* as *"the single largest carried risk"* and ledger B2 says *"mount this, not B1"*.
- ⭐⭐ **The finding.** The only displacement the programme verdicts *absorb outright* is the only
  one with **no backlog item behind it**. That is not a gap in item 16's diligence — item 16's
  provenance is gaps, anti-patterns and competitor mechanisms, and item 17 §1 H3 measured the
  consequence: **60 of 85 items have no gap-size reading at all** because *"their justification was
  never 'a competitor has this'"*. ⛔ **A backlog built that way will systematically not contain the
  cheapest displacement**, and an MVP chosen by picking from the backlog would therefore have missed
  this one. It is the sharpest argument in this file for why item 27 is a separate document from
  item 17.
- ✅✅ **IT DOES ALREADY SHIP — MEASURED 2026-09-26, SO B-1 IS VOID AND THIS MVP HAS ZERO BUILDS.** `app/src/pages/Breadth.jsx:49` on `origin/master` lazy-imports `ChartPane`; `ThemeTrackerPage.jsx` mounts `StockChart` **and** `ChartPane`. ⛔⛔ **And the incumbent is not merely matched, it is ABSENT:** `git grep chart.ashx origin/master -- app/src` returns **zero occurrences**, and `Breadth.jsx:343` records the old `DrillModal` (~320 lines, Finviz tabs included) as **DELETED**. Full measurement and its consequences: **CARD 24**. ⭐ This is the outcome §8.2 called "the good failure", and §8.2 was right.
- **The honest-empty-state clause, and why it is inside B-1 rather than beside it.** If our chart
  renders blank for a symbol or timeframe it has no bars for, the subject falls back to Finviz for a
  reason that looks exactly like preference and is not. The idiom already exists in the backlog
  twice and is **cited, not imported**: `FB-A6-01`'s *"say 'coverage n=0' instead of rendering an
  empty transcript panel"*, and `FB-A8-02` — the one item in the entire backlog *"with a measured
  member-facing cost already paid"*, having rendered *"No recent news for this ticker."* against
  NVDA while the endpoint returned 15 KB (item 17 §5 Band 3).
- **Rollback tier.** Behind the trial flag ⇒ item 37 **tier 1**, *"env var, no rebuild"*. Without
  the flag it would be tier 3, *"full build + the gate's verdict, unknown at incident time"*.

### 4.2 The one `FB-*` item, and it is conditional on a name

| id | in scope | the CARD 22 clause that forces it | out of scope, explicitly |
|---|---|---|---|
| `FB-S12-01` | the **flag half only** — `TERMINAL_NEXT_ENABLED` paired with a beta allowlist, in the shape `COMPASS_MENTOR_MODE` + `COMPASS_MENTOR_BETA_EMAILS` already sets, declared in the flag ledger so the AST index and `tests/test_feature_flag_ledger.py` can see it | ⛔⛔ **the withdrawal block.** CARD 22 §1(2) makes it *"the strongest element in the design"* — two reviewers invented it independently — and requires the surface be turned **off, unannounced, for a defined block**. Item 37's rung S2 is *"ABSENT today; the only rung that needs a build"*; ledger O8 records maintenance mode as *"the only runtime kill switch in the product"* and that it *"resets on every redeploy (several/day)"*, against item 24's measured **median pod life 26 minutes**. ⛔ **A withdrawal block held by a switch that resets several times a day would end silently mid-block and the record would be false.** ⭐ Second clause it serves: it is what makes *"the work happened in Terminal-Next"* a fact about a named flag rather than a claim about a name | the **durable per-user tag store**, the admin UI, `_access_payload`'s cohort array, and `FB-S9-*`'s rollout. Item 37's DP-3 is explicit that durable-tag vs env-allowlist *"produce different beta operations"*; at n ≤ 2 subjects the allowlist is sufficient and is the half that needs no store |

⭐⭐ **And the condition, which is the most useful sentence in this section: if the named non-builder
subject holds an admin role, even this item drops out.** Item 37's rung **S1 — owner preview,
`TERMINAL_NEXT_ENABLED=admin` — *"already ships and costs no new code"***, resolved per request from
the role on the auth payload, with rollback *"tier 1 — `--set TERMINAL_NEXT_ENABLED=0`, no
rebuild"*. The production roster is *"6 admin · 23 member"* (item 35 §3.1, in-pod read 2026-09-14).
⛔ **So whether this MVP contains a second build is decided by a name, not by a scope** — and the
name is CARD 22 §6's one remaining owner-only item.

⚠️ **Two honesty notes on that shortcut.** (a) `=admin` is all-admins-or-none, so a withdrawal block
would withdraw from every admin at once; with a two-subject trial that is acceptable and arguably
better — one act, one block, both subjects — but it must be **written into §6 before day 1**, not
discovered during it. (b) ⛔ **Granting admin to create a subject is not available**: it would change
what the subject sees across the product, and the programme already carries an outside contractor
holding production admin as a live risk. **A subject must be someone who already holds the role, or
rung S2 gets built.**

### 4.3 What is NOT built, and is still required

⛔ **The record itself is paper, and instrumenting it is refused.** CARD 22 §4 wants *"one line per
person-occasion, append-only, with what else was open, named"*, recorded the same day, and *"a
missing day is UNREADABLE, never a zero"*. **No telemetry can observe the incumbent** — item 35's
PH-5 states it and names the evidence: an aggregate route-breadth substitute was *"attempted twice,
two different formulations, refused both times"* under production-read permissions, and the
population that would answer it is *13 accounts of which 6 are admins*. There is also *"no consent
or opt-in mechanism and no beta-scoped event stream"* (item 35 §3.1, citing
`flags-and-entitlements.md:545`). ⭐ **A click counter on the drill tabs would be a second authority
over the one quantity the trial exists to establish, and it would still not see finviz.com.** It is
out, by rule, not by budget.

⭐ **And one requirement discharged by an act already required.** `FB-S12-01`'s own *Known it worked*
field demands a **rehearsed** kill switch, and item 37's S1 gate says *"a kill switch nobody has
watched actually kill something isn't a kill switch, it's a variable"*. **The withdrawal block IS
that rehearsal** — one act satisfying CARD 22's strongest clause and the programme's GATE-1 rule
together. Nothing extra is scheduled for it.

### 4.4 The count, measured over this file's own output

```
awk '/^### 4\.2/,/^### 4\.3/' 10-roadmap/mvp.md | grep -c '^| `FB-'          ->  1   # §4.2's IN table
grep -c '^| `FB-'             10-roadmap/mvp.md                              ->  8   # ⚠️ see below
grep -c '^#### FB-'           05-product-strategy/feature-opportunity-backlog.md -> 85
grep -o '^#### FB-[A-Z0-9]*-[0-9]*' … | sort -u | wc -l                      -> 85
grep -o '^#### FB-[A-Z0-9]*-[0-9]*' … | sort | uniq -d                       -> empty
```

**IN: 1 `FB-*` id (a named half of it), plus 1 build that is not an `FB-*` item. EXCLUDED: 84 of
item 16's 85.** ⛔ The roster count is item 16's own and is cited, not typed beside it; the
distinct-id and duplicate checks are printed because a roster is only a denominator if nothing in it
is counted twice.

⚠️ **And the second line is the check catching its own author, so it stays printed.** The unscoped
pattern returns **8**, not 1, because §5.4's OUT table uses the same row shape as §4.2's IN table —
⛔ **so a count of "what this MVP includes" taken over the whole file would be eight times wrong, in
the generous direction.** The scoped `awk` range is the count that means what it says.

---

## 5. What is explicitly OUT, and why — including things that are obviously good

⛔ **The test applied to every row: does it move this task off this tool?** Not *is it valuable*, not
*is it next*. Item 28 owns what comes after; item 17 owns what is cheap and provable. ⭐ **Saying no
to the following is the value of this document**, because every one of them has a live argument
behind it and four of them are arguments this file finds persuasive.

### 5.1 The two that hurt most to exclude

**`FB-A13-01` — the per-ticker history join. ⛔ OUT, and it is the best thing in the backlog.**
Item 10 §1 H3(b) names it one of only **two** capabilities with **no incumbent at all** across
fifteen products, *"several concede they structurally cannot"* have it (SpotGamma *"never sees a
fill"*; Quartr has no price context), and item 16 H1 calls it *"the only capability in this
programme's evidence base where UCT can be first rather than behind"*. ⛔⛔ **And that is precisely
why it cannot be this MVP: a capability no incumbent has is a capability no incumbent tool is being
opened for.** There is nothing to displace. It is the strongest *differentiator* on the board and
structurally the weakest *displacement candidate*, and conflating the two bars is the error CARD 22
exists to prevent. ⚠️ It is also *"blocked entirely"* on `FB-D2-01`, which item 17 bands as **XL**
with five items behind it.

**The morning candidate scan off Finviz. ⛔ OUT, by item 13's verdict, and this was this file's own
first candidate.** The estate already runs the three scans (PULLBACK_MA / REMOUNT / GAPPER_NEWS)
inside the 06:35 CT wire and already renders them on the Scanner Hub tabs (ledger G5), which makes
it look like the cheapest displacement in the building. ⛔ **Item 13 verdicts it *"Integrate-harden,
don't absorb yet"*, because absorbing prematurely *"risks silently degrading the candle score's
inputs"*** — and `finviz.md` adds the observed failure: a 2026-08-31 dry run logged *"PULLBACK_MA —
no results from Finviz"* three times and the run was flagged `SCAN HEALTH FAILED`, *"silently
thinning the morning wire's Top-5 picks pool."* ⭐ **A displacement trial whose surface can quietly
produce zero and read as 'no setups today' would manufacture its own finding**, which is the defect
this programme has now committed twice by its own record. ⚰️ Excluding it also retires the version of
this document that had been drafted around it.

### 5.2 The platform enablers — out, and the reason is concurrency, not disrespect

`FB-S8-01` (11 items behind it) · `FB-S8-02` · `FB-D2-01` · `FB-S5-01` · `FB-D1-01` · `FB-S3-01` ·
`FB-S4-02` · `FB-S7-01` · `FB-S9-01` — item 17's **Band 2, the enablers**.

⛔ **An MVP is not a lane-head selection.** Item 29's finding reframes delivery: the graph is *wide
and shallow* — depth 3, **40 of 85 items with no hard prerequisite** — so *"delivery is not
dependency-bound, it is concurrency-bound"*, and its §5.2 reduces theoretical parallelism of 40 to
**3 build lanes + 1 integrator**, then **1 lane at a time at the verification step**, then **1
master merge in flight, repo-wide**. Its §5.3 names lane heads *chosen for out-degree*
(`FB-S8-01`, `FB-X1-02`→`FB-S5-01`, `FB-A3-01`→`FB-D1-01`) and states ⚠️ *"a fourth lane is not
available, however small it looks."* ⭐⭐ **An MVP scoped as though ten things can proceed at once is
wrong for this org — and one scoped as three lanes would consume the entire capacity of the
organisation to produce one trial.** The enablers are sequencing (item 28), and out-degree is the
right criterion for a lane head and the wrong one for a definition of done.

### 5.3 The measurement floor — out deliberately, and the exclusion most likely to be challenged

`FB-S7-03` · `FB-OBS-01` … `FB-OBS-06` · `FB-OBS-09` — item 17's **Band 1**, of which its own text
says *"Nothing after this can be said to have worked."*

⛔ **It is out because this MVP's instrument is a person, not a process.** Band 1 exists so
*engineering* claims can be believed — a p95 that does not print, drop counters nobody reads, and
the cadence contract whose absence makes *"no alert since Tuesday"* and *"the cron has not fired
since Tuesday"* the same observation (item 16 H3). ⭐ **None of those failures can corrupt a daily
human record of which tab a named subject clicked.** The trial's own version of the
missing-instrument risk is handled inside B-1's honest empty state (§4.1) and by CARD 22's
UNREADABLE-never-zero rule.
⚠️ **The strongest counter-argument, recorded rather than dismissed:** `FB-OBS-09` is framed by item
17 as *"a shipping precondition, not an item"*, so a strict reading makes it apply to B-1 as it
would to anything else. §4.3 answers that specific case — the withdrawal block is the guard-fires
proof for the only guard this MVP ships — and ⛔ if the adjudicator disagrees, the honest outcome is
INCONCLUSIVE, not a waiver.

### 5.4 The obviously-good small things

| out | the argument for it, stated fairly | why it is still out |
|---|---|---|
| `FB-A8-02` | item 17 Band 3; *"the only item in the entire backlog with a measured member-facing cost already paid"*; six sibling `.catch(() => null)` sites onto `sectionFetch.js` | ⚠️ **Whether the drill's chart path is one of the six is not established** — no source file was opened here. Including it would be justifying against general goodness while guessing at the join. ⭐ Its *idiom* is cited inside B-1 instead, which costs nothing and claims nothing |
| `FB-A9-01`, `FB-A9-02` | the authoring-time match count and `CoverageLine` as a platform primitive — item 10 §6.1 item 5 says UCT is **ahead** of Bloomberg here (◻ `EQS` *"NOT DETERMINED on that distinction"*) | the trial's subject reads a drill, not a screen; he authors nothing. `FB-A9-02` also *depends on* `FB-S8-01`, so importing it imports Band 2 (§5.2). ⛔ And a second receipt copied onto one more surface is GATE-2, *"three copies of one guard"* |
| `FB-A9-03` | Finviz is *"the single point of failure most likely to delete a core capability outright"*; *"a Finviz no is a capability deletion, not a swap"* | ⛔ **It does not help this displacement at all** — the displacement moves the *task*, and our chart renders from Massive, so the Finviz PNG path is the one thing here that gets *less* load-bearing. It is Band 0 **HELD** and half of it is an owner purchase. ⚠️ Stated plainly: **this MVP does not reduce the Finviz vendor dependency**, and anyone reading a PASS as vendor independence has misread it |
| `FB-S11-01` | *"one of the cheapest genuinely-new systems in the whole matrix"*, and item 10 grades S11 ◻ *not established for any product* — a greenfield, not a catch-up | nothing in the drill-then-inspect task needs a session calendar to be correct. ⭐ It is a first-rather-than-behind candidate, which is item 28's question |
| `FB-S12-02` | member-facing BETA marks at the point of use — item 10's H2 best-in-class, and the ledger being six-for-six wrong about what ships is the internal case for it | the trial's population is ≤ 2 named internal accounts who are told what they are testing. ⚠️ It also depends on `FB-S12-01`'s ledger, the half §4.2 excluded |
| `FB-X3-02` | *"first-run is a fork of an expert's board, never a blank form"* — and CARD 22's judged clause includes *reasonable onboarding* | ⭐ **At n ≤ 2, onboarding is an act, not a feature**: one person shows another once, and the judgement records it as a judgement. Band 0 **HELD** besides. ⛔ If onboarding turns out to need a feature for the surface to be usable, that is a *finding the trial produces*, written into the failure sentence — not a build done in advance to prevent the finding |
| `FB-S2-01`, `FB-S2-02`, `FB-S2-03` | the keyboard registry is *"the best-evidenced row"* in item 10; four independent ticker resolvers is a real defect | the drill is reached by clicking a breadth cell. No command string, no address space and no resolver is on the path being measured |

### 5.5 The flow and alert families — out, and one of them for a reason nothing else on this list has

`FB-A10-01` … `FB-A10-06`, and the S7 trigger work (`FB-S7-01`, `FB-S7-02`). ⛔ Different tool
(Unusual Whales / TradingView alerts), and §3.1 disposes of both rows. ⚠️ **But flow carries a
constraint that would make it the wrong first trial even if the verdicts allowed it:** item 29 §5.2
records that a push touching a `flow-worker` watched path *"bounces the OPRA tape, and Massive OPRA
does not replay — that gap is permanent until the T+1 flat file"*, with item 37 RB-11 already ruling
that nothing in Terminal-Next ships into that watch list during RTH. ⭐ **A first displacement whose
failure mode is irreversible member-facing data loss is the wrong first displacement**, whatever its
value. And the alert half needs CARD 9's price-level predicate, which CARD 22's own closing table
lists as still owner-blocked on a tool permission.

### 5.6 ⛔ Out because no MVP may contain them at all

- **Any tier, upgrade, comparison or entitlement-ladder element** — CARD 17 / the 2026-09-01 seed
  fact. One paid tier means *"there is nothing to compare"*.
- **Any price-denominated success claim.** ✅✅ **CORRECTED 2026-09-26 — CARD 23: THERE IS NO PRICE CONTRADICTION AND NEVER WAS. Two products.** UCT Intelligence: **$200/month or $2,000/year**, owner-ratified, corroborated by `Pricing.jsx`'s dated 2026-07-11 owner-approved-strategy docstring (two months free on the annual, 7-day card-required trial). The **$7/week is the Whop plan**, a separate live-trading-Discord product merely promoted through the wire's Substack (`morning-wire/substack/promo.py`: *"The Whop plan is one WEEK for $7"*). `charter/OWNER_SEED_FACTS.md:61` spliced a tier statement and another product's promo into one sentence, and this document inherited the splice from its brief — my error, not its author's. ⭐ **The exclusion still stands on its own merits:** an MVP measured in a person's behaviour needs no price, ratified or not. ⚰️ The superseded reasoning is kept below.
- ~~**Any price-denominated success claim.**~~ ⚠️ **Two price artifacts exist and they disagree in
  kind** — `$200/month or $2,000/year` in `app/src/pages/Pricing.jsx:6` (carried through item 35
  §3.2) and the *$7 weekly promo* in `charter/OWNER_SEED_FACTS.md` §6. ⛔ **This document does not
  resolve them and does not pick one; no owner-ratified figure exists**, CARD 17 leaves *"price,
  trial, seat model"* explicitly undecided, and item 35 CO-1 exists precisely because a
  cost-over-revenue ratio *"has two legitimate values that differ by roughly seven times"*.
- **Any member-population or engagement rate.** Signup is closed; the denominator is three numbers
  with three dates (26 / 29 / 21); *"quote the counts, not the percentage"* (item 35 §3.1).

---

## 6. The pre-registration draft (CARD 22 §4's blocking requirement)

⛔⛔ **This section is the artifact CARD 22 demands, and its own status is part of its content.** The
requirement is *"a dated artifact whose timestamp precedes day 1"*. This file is dated **2026-09-26**
and carries `status: draft`. ⭐ **If the owner substitutes a different workflow, tool, subject or
span, this section is VOID as pre-registration and a successor dated artifact must exist before day
1** — you cannot amend a pre-registration after day 1 and still call it one. That is not pedantry:
CARD 22's whole argument for pre-registration is that *"with pre-registration and no log, a false
pass requires a lie."*

### 6.1 The registration

| field | value | status |
|---|---|---|
| **Workflow** | `JTBD-M02` — from a breadth cell or heatmap tile that contradicts the tape, drill to the constituent names, then inspect one name's daily/weekly chart | ⚠️ **CANDIDATE.** Derived from the estate's own embed points, not from testimony: CP-06 records the owner *"declined that level of detail as unnecessary"*, so *which* task he opens Finviz for by hand is not in the record. **One sentence from the owner confirms or replaces it** |
| **Incumbent tool** | **Finviz** — the `chart.ashx?t={sym}&ty=c&ta=1&p=d\|w` Daily and Weekly PNG tabs on the Breadth `DrillModal` / `ThemeTracker`, and `finviz.com` / `elite.finviz.com` opened directly for the same purpose | ✅ named. ⛔ **TradingView's tab on the same surface is NOT under test** and its use is recorded, not counted against the bar (§3.2) |
| **Subject** | ⛔ **UNNAMED — owner-only.** Requirement: at least one **non-builder**. CARD 22 §6: *"Everything above is unblocked except this"* | ⛔ **BLOCKING.** ⚠️ If no such person exists at this headcount, *"that is itself the finding"*, and the verdict is **INCONCLUSIVE-BY-CONSTRUCTION** and says so on its face. It does not become a PASS because nobody was available to disagree |
| **Recorder** | whoever did the work | ✅ per CARD 22 §2's split |
| **Adjudicator** | a named non-subject, applying this rule, answering **PASS / FAIL / INCONCLUSIVE** | ⛔ unnamed. Absent one, the verdict is INCONCLUSIVE-BY-CONSTRUCTION |
| **Span** | **Phase A (baseline):** count how often the workflow occurs at all — eligible occasions per trading day, declared **that morning**, before the subject looks. **Phase B (trial):** K of N eligible occasions, K and N derived from phase A | ⛔ **K and N are deliberately absent.** CARD 22 §3 killed the five-consecutive-day shape and requires a measured denominator; naming K here would re-commit the defect. ⚠️ The only constraint stated in advance is resolution arithmetic: at one subject, an N below 5 makes a single occasion ≥ 20 % of the verdict, which is coarser than a percentile this programme already ruled too coarse to compare (item 35 §3.1) |
| **Withdrawal block** | inside or after phase B: the surface is switched **off, unannounced**, for a defined block. ⭐ If nobody asks for it back before the close, **it was tolerated, not preferred** | ✅ required, and it is also the kill switch's rehearsal (§4.3) |
| **Eligibility** | declared **that morning**, never retrospectively. **More than a third of occasions ineligible ⇒ INCONCLUSIVE** | ✅ per CARD 22 §4 |
| **Per-person verdicts** | published **unaggregated**. ⛔ *"a 2-1 majority among three raters carries zero evidential weight… there is no vote"* | ✅ |
| **OI-02** | the verdict **must state whether it survives OI-02 being answered** | ✅ per CARD 22 §6, *"otherwise a pass becomes orphaned rather than confirmed"* |

### 6.2 ⛔ The eligibility trap, named in advance because it is the one I would have walked into

**Eligibility is a property of the OCCASION, never of the product's output.** A morning is eligible
if the subject worked a session in which a breadth number contradicted the tape — a holiday, travel
or a day with no such moment is ineligible, which is CARD 22 §3's entire point.

⛔⛔ **The trap: making "our chart rendered correctly" an eligibility condition.** It reads as
hygiene and it is not. A morning where our chart is blank, slow or wrong is **eligible**, and if the
subject uses the Finviz tab that morning it counts as a **failed occasion**. A bar whose ineligible
set absorbs the product's own bad days is a bar the product cannot fail — the exact disease item 35
§1 catalogues at four altitudes and CARD 16 and CARD 21 were both re-cut for.

### 6.3 The failure sentence, written in advance

> **This trial FAILS if, on more than N − K of the N eligible occasions recorded in phase B, the
> subject used a Finviz chart tab or opened finviz.com for `JTBD-M02`'s inspection step.**
>
> **It is INCONCLUSIVE, and not a FAIL, if** more than a third of the span's occasions were declared
> ineligible; **or** no non-subject adjudicator existed; **or** no non-builder subject existed;
> **or** phase A produced an N too small to carry a rate (§6.1).
>
> **It FAILS the thesis, separately from the measured clause, if** the withdrawal block passes with
> nobody asking for the surface back — in which case the surface was **tolerated, not preferred**,
> and the measured clause passing does not rescue it.
>
> **On any of these outcomes, the sentence "Terminal-Next displaced Finviz for chart inspection" is
> not written in any artifact, any deck, any release note or any wire.**

⛔⛔ **AND THE ANTI-WAIVER CLAUSE, transcribed because it is the sharpest thing CARD 22 produced:** a
re-cut of this bar **must quote the reading that failed**. *"Without that, 'we re-cut the bar' and
'we failed and moved it' are the same sentence."* ⚠️ This programme has retired two bars it failed
(CARD 16, CARD 21) and both were right to retire — which is exactly why the third one needs the
quoted reading attached.

### 6.4 What a PASS entitles, and what it does not

- ✅ **Entitles:** the Finviz PNG tabs become *removable without losing an answer* (item 13's own
  `⭐ Done well` field), which is also T-49's lower-risk design. ⛔ **The removal is item 28's to
  sequence**, not this document's, and it must be its own commit with its own member-impact
  paragraph per item 37's S3 rung.
- ⛔ **Does not entitle:** any claim about the other three tools; any claim that Finviz is no longer
  a dependency (§5.4); any claim about members, whose population does not exist to be measured; or
  any claim that the charter thesis is proved — CARD 22 demoted that sentence to a thesis and one
  displacement does not promote it back.

---

## 7. How this gets verified

### 7.1 It is item 35's PH-5, and this document supplies two of its three missing fields

PH-5 — *"MVP acceptance: does the desk voluntarily prefer it for one named daily workflow?"* — is the
only metric in item 35's set of 21 that measures this MVP. Its quantity is already the right shape:
*"Per **named** daily workflow: whether the desk ran it in Terminal-Next by choice… **and which
external tool it displaced**. ⛔ Counts and names, never a preference score."*

Its computability verdict is **NO**, and item 35 is precise about why: *"it fails on the verdict, not
on the data… Eight of the nine NOs are missing an instrument. PH-5 is missing a **person**."*

| PH-5's missing field | supplied by | still missing |
|---|---|---|
| the **named workflow** | §6.1 — `JTBD-M02`, as a candidate | owner confirmation, one sentence |
| the **named displaced tool** | §6.1 — Finviz's `chart.ashx` tabs, one point of use | — |
| the **adjudicator** | ⛔ nothing here can supply it | **OI-02.** ⚠️ SM-11's default (*the owner decides, ≥ 5 consecutive trading days*) is ⚰️ **SUPERSEDED BY CARD 22** and its own row says it should be **deleted** the day OI-02 arrives, not reconciled |

⛔ **No other metric in item 35's set verifies this MVP, and that is not a gap in item 35.** The
other 20 measure product health, latency, cost and engineering quality. ⚠️ One near-miss worth
naming so nobody claims it: B-1's honest empty state is one instance of **MQ-6**'s quantity
(*member-facing numbers rendering through one provenance shape*), and MQ-6's computability verdict is
**NO** — no instrument exists — so the MVP **moves MQ-6 by one surface and cannot be verified by
it.**

### 7.2 The bar run through item 35 §2's four-field contract

Item 35's contract is the programme's own test for whether a proposed bar is a metric or *"a topic"*.
⭐ Running mine through it is the only way to show it is not the thing it replaced.

| field | this bar's answer |
|---|---|
| **1 QUANTITY** | occasions on which `JTBD-M02`'s inspection step was completed in Terminal-Next **and** no Finviz chart tab or finviz.com was used for it — as **counts and names**, per subject, unaggregated, over N eligible occasions declared each morning in phase A |
| **2 COMPUTABLE TODAY, BY WHAT** | **YES, by a human record, and by nothing else.** An append-only dated ledger, one line per person-occasion, naming what else was open. ⛔ **Not a query, and not substitutable by one** — PH-5's own field says so, and two production-read substitutes were refused (§4.3) |
| **3 FIRES ON THE NORMAL CASE?** | **No — and this is where it differs from the bar it replaces.** SM-11's five-consecutive-day version fired on a holiday, on travel, and on a morning with no setup (CARD 22 §3). K of N **eligible** occasions cannot: an occasion that did not arise is not counted. ⭐ Direction of a correct fix: a better chart moves the count **up**; ⛔ a chart that is merely *always there* does not, because the subject can still choose Finviz. ⚠️ The healthiest plausible state that this bar **does** fail is real and stated: the subject prefers Finviz's PNG for a reason we did not anticipate — that is a measured FAIL and the correct output |
| **4 SURVIVES A REDEPLOY?** | the record is paper: durable and dated, **CUMULATIVE** in the sense that matters, because it is a claim about a span. ⛔ The **flag** must also survive one — median pod life 26 minutes, and maintenance mode *"resets on every redeploy"* — which is §4.2's whole justification |

**Plus item 35's three carried obligations.** (2.1) Every reported value carries `as_of`, `window`
and `commit` — here, ⛔ **"SHA not pinned (no git by instruction)"**, which is a ceiling on any
reading taken against this file. (2.2) **Three outcomes, never two** — PASS / measured FAIL /
INCONCLUSIVE, which is already CARD 22's verdict shape and item 25's UNREADABLE arriving at the same
place. (2.4) **Every bar states how it would be proved able to fire** — here, the withdrawal block
is that proof for the one guard this MVP ships, and ⛔ nothing in this file was executed.

### 7.3 CARD 22's measured/judged split, applied line by line

| clause | measured or judged | who |
|---|---|---|
| the work happened in Terminal-Next on occasion X | **measured** — the flag was on for that subject, and the record says so | recorder |
| the Finviz tab / finviz.com was not used for it | **measured** — same-day line, ⛔ a missing day is **UNREADABLE**, never a zero | recorder |
| what else was open | **measured**, as names | recorder |
| the occasion was eligible | **measured**, declared that morning, never retrospectively | recorder |
| the withdrawal block produced no request for the surface back | **measured** (an absence, and CARD 22 rules what the absence means) | recorder |
| *meaningful* | **judged** | signatory, in a dated sentence that says it is a judgement |
| *reasonable onboarding* | **judged** | signatory |
| *voluntarily* | **judged** — and ⛔ §3.4 is the design that keeps the judgement answerable at all | signatory |
| *does this record satisfy the rule signed on date D* | **adjudicated**, PASS / FAIL / INCONCLUSIVE | a named non-subject |

⭐ **Why the judged half is written as a judgement and not as a fourth metric.** *"A judgement that
admits what it is cannot be quietly waived — only reversed by its signatory. That accountability is
the prize"* (CARD 22 §4). ⚠️ **And the honest consequence for this particular MVP: a reasonable
signatory may judge that displacing a static chart PNG is not *meaningful*.** That would be a PASS
on the measured clause and a FAIL on the judged one, which CARD 22's three-way verdict accommodates
and which this document does not pre-empt. ⭐ The argument available to the signatory in the other
direction, stated once and not pressed: `JTBD-M02` is the only job on item 13's list held by **two**
of the four named tools, which makes the job itself the most-attested inspection job in the record,
and the PNG tab is its cheapest end.

---

## 8. What would make this the wrong MVP, and the signal that would show it

⛔ **Ordered by how likely each is to be true, not by how bad each would be.**

**8.1 The task is not one the desk actually does. 🔴 most likely.**
OI-06 names four hand-opened tools and *"declined that level of detail"* on which workflow each is
opened for (CP-06). The workflow in §6 is derived from our own embed points. **Signal:** the owner
reads §6.1 and names a different task — the cheapest possible refutation, and it costs one sentence
before day 1. ⭐ **This is why §6 is a draft with a void clause rather than a plan.**

**8.2 It is already done, so the trial measures a change nobody made. 🔴 also likely, and it is the
good failure.**
Whether the drill already renders a native chart tab is 🔴 *"pure hypothesis"* in its own source, and
the ledger understates what ships six for six. **Signal:** one grep for `ChartPane` in the breadth
drill component returns a hit. ⭐ **Then the MVP has zero build, phase A starts immediately, and the
programme learns its own charter bar was reachable before day 1.**

✅✅ **THE SIGNAL FIRED, 2026-09-26 — AND HARDER THAN THIS SECTION ANTICIPATED (CARD 24).** `Breadth.jsx:49` imports `ChartPane`; **`chart.ashx` has ZERO occurrences in all of `app/src`**; `Breadth.jsx:343` records the Finviz-tabbed `DrillModal` as deleted. So it is not "our chart also exists" — **there is no in-app Finviz chart tab left to prefer over**, which makes the in-app half of §6's incumbent definition unrunnable rather than merely already-won. ⛔ The **finviz.com-by-hand half of §6 survives intact** and is still the measurable question. ⚠️ This also puts item 13's absorb-outright verdict — the row this MVP was selected FROM — under a re-read against master; CARD 24 declines to re-cut it from one grep.

**8.3 The displacement is too small to be *meaningful*, and the judged clause says so. 🟡**
**Signal:** the signatory's dated sentence reads NO on *meaningful* while the measured clause passes.
⛔ That is a legitimate outcome, not a defect in the record, and §6.3 already refuses the sentence
that would paper over it. ⚠️ The wrong response would be to re-cut the bar; the anti-waiver clause
requires quoting the failed reading first.

**8.4 "In Terminal-Next" is read strictly, and the drill is not Terminal-Next. 🟡**
The Breadth drill is an existing surface; TERMINAL-CURRENT vs TERMINAL-NEXT is a vocabulary the
capability ledger defines explicitly. ⭐ **My resolution, and it is a defaultable ruling rather than
a certainty:** the clause's load-bearing half is *the incumbent was not opened for that task*, and
the Terminal-Next half is satisfied by the surface sitting inside the named cohort flag — ledger P6's
`TERMINAL_NEXT_ENABLED` + allowlist is the programme's own definition of what Terminal-Next is
switched on by. ⛔ **Signal that I am wrong:** the owner or item 28 rules that Terminal-Next means a
distinct new surface, in which case this MVP's build floor grows by a surface and the trial should
wait for it rather than be re-labelled. ⚠️ **It should not be re-labelled either way** — a
displacement recorded on a surface nobody calls Terminal-Next is still a real displacement and
should be reported as one.

**8.5 The record is written by someone with an interest in the answer. 🟡 and unmitigable by
procedure.**
CARD 22 §2 carries the adversarial reviewer's finding verbatim: the reward corruption — *one person
owns product, desk and deadline* — *"is not mitigable by procedure at all, only disclosed — and
disclosure written by that same person fails."* ⛔ **Signal:** the recorder and the adjudicator turn
out to be the same person, or the adjudicator is a subject. The verdict is then
INCONCLUSIVE-BY-CONSTRUCTION and must say so on its face.

**8.6 The trial is run as a removal instead of a preference. 🟢 unlikely, and catastrophic.**
**Signal:** the Finviz tabs are deleted before or during the span. ⛔ The measured clause then reads
clean by construction and the record is worthless (§3.4). A record produced after a deletion cannot
be repaired; it can only be discarded and re-run.

**8.7 A better displacement candidate arrives. 🟢**
**Signal:** a `desk-tools/` note is written for Unusual Whales (item 13 records that it is the one
owner-named tool with none), or the Finviz screens' *harden* verdict is upgraded to *absorb* with
the candle-score input risk closed. ⭐ Either would re-run §3, and neither invalidates a trial
already pre-registered — it would run beside it, one workflow at a time, which is what PH-5's normal
case already contemplates.

---

## 9. What this does NOT decide — sequencing is item 28's

⛔ **This file names a bar and its blocking inputs. It does not say when anything happens.** Item 28
(`10-roadmap/`, the sequencing deliverable) owns time, and item 29 owns the graph the sequence must
respect — in particular its two inversions, which are the two easiest ordering mistakes to make:
`FB-S7-03` **before** any observability lane, and `FB-S9-01` **before** any route work, because
doing the fixes first *"produces a state that looks finished and is not"*.

**Three boundaries that will actually be crossed if this is read as a plan:**

1. ⛔ **When phase A starts is not decided here.** It depends on a name (§6.1's subject) and on one
   grep (§8.2). Both are one-act items; neither is a schedule.
2. ⛔ **The removal of the Finviz tabs on a PASS is not scheduled here.** It is a separate commit
   with a member-impact paragraph under item 37's S3 rung, and it is also T-49's mitigation — two
   reasons that belong to two different documents.
3. ⛔ **Nothing here re-bands, re-scores or re-orders item 16's 85 items.** §5's exclusions are
   exclusions *from this MVP*, for the duration of this trial, on one criterion. ⭐ **Item 17 §5
   Band 5's warning applies to my §5 with equal force: reading an exclusion list as a rejection list
   would be the worst misuse of it.**

---

## GAPS

1. ⛔⛔ **Whether the Breadth `DrillModal` already renders a native UCT chart tab — the single fact
   that decides whether this MVP contains a build.** Every source is negative-by-omission and the
   nearest thing to a direct claim is marked 🔴 *"pure hypothesis"*
   (`tradingview-desk-use.md` §5 item 2), which also records *"no usage split between DrillModal's
   three tabs"*. ⚠️ The capability ledger's banner makes the likely direction of error explicit:
   six of six checked cells understated what ships. **Cheapest resolution: one grep for `ChartPane`
   in the breadth drill component. No run, no probe, no permission.**
2. ⛔ **Which task the desk opens Finviz for by hand.** OI-06 names the tool; CP-06 records the
   owner declined the per-tool workflow. §6.1's workflow is therefore a candidate derived from the
   estate's own embeds. **Resolution: one owner sentence.** ⚠️ Until it lands, §6 is a draft
   pre-registration and not a valid one.
3. ⛔ **The subject.** CARD 22 §6's only remaining owner-only item, and the one that decides whether
   §4.2's build is needed at all (rung S1 ships; rung S2 does not). **If no non-builder exists at
   this headcount, that is the finding** and the verdict is INCONCLUSIVE-BY-CONSTRUCTION.
4. ⛔ **The adjudicator, and OI-02.** Open since 2026-09-02. SM-11's default is superseded by CARD
   22 and should be **deleted** on OI-02's arrival rather than reconciled.
5. ⚠️ **No occasion rate exists for `JTBD-M02`.** The nearest measured datum is `/breadth`'s **353
   total views** (OI-06 telemetry, 2026-09-14, quoted by item 13) — ⛔ **a page view is not a drill
   open, and 353 is a count over a population item 35 labels an existence check over 13 accounts, 6
   of them admins.** This is exactly why CARD 22 requires phase A to measure the denominator rather
   than let anyone infer it.
6. ⚠️ **Whether the drill's data path is one of `FB-A8-02`'s six `.catch(() => null)` sites** — not
   established, because no source file was opened here. It decides whether B-1's honest empty state
   is a wiring change or a one-line render change.
7. ⚠️ **`uw_live_flow.py` is recorded with "zero importers (dormant)"** (ledger F6, dated
   2026-09-02) while CARD 22 §5 cites it as evidence of *"dedicated integration"* for Unusual
   Whales. ⛔ Both statements can be true — dedicated code that nothing imports — and this file
   relies on neither: §3.1 excludes UW on item 13's *no desk-tool report* verdict, which is
   independent of the code.
8. ⛔ **No rollback has ever been rehearsed in this programme** (item 37 GAPS 8: *"A tier nobody has
   pulled in anger is a procedure, not a capability"*). ⭐ The withdrawal block would be the first,
   which is an argument for this MVP that is not about Finviz at all.
9. ⚠️ **`ThemeTracker` carries the same Finviz PNG embed as `DrillModal`** (`finviz.md` §2). This
   pre-registration names both surfaces for the incumbent and measures the drill's occasions only;
   if the subject's inspection habitually starts in `ThemeTracker`, phase A will show it and §6 must
   be re-dated rather than stretched.

---

## SOURCES

- `12-decisions/DECISION_CARDS_2026-09-26.md` — **CARD 22** §1–§6 (the rule, the withdrawal test,
  the K-of-N replacement, the pre-registration requirement, the anti-waiver clause, the non-builder
  subject, the OI-02 reversal condition, and §5's three corrected practitioner citations); **CARD
  17** (one paid tier, and what it forecloses); **CARD 21** and **CARD 16** (bars a healthy product
  fails); **CARD 20-EXEC** (read before you change); the closing owner-only table (CARD 9's refused
  permission).
- `04-workflows/jobs-to-be-done.md` (item 13) — §4's five-row displacement list **verbatim**,
  `JTBD-M02`'s job / trigger / current solution / evidence / `⭐ Done well`, `JTBD-M01`'s `/breadth`
  view count, §5's unserved-jobs table.
- `05-product-strategy/feature-scoring.md` (item 17) — §1 H1 (11 of 85; verifiability is the binding
  constraint), H2 (22 items with no rollback tier), H3 (60 of 85 with no gap reading); §5's band
  rules and Bands 0–5 with their membership counts.
- `05-product-strategy/feature-opportunity-backlog.md` (item 16) — the 85-item roster; `FB-S12-01`,
  `FB-A9-01`, `FB-A9-02`, `FB-A9-03`, `FB-A13-01`, `FB-S11-01`, `FB-S12-02`, `FB-A6-01`, `FB-A8-02`
  per-item fields; §3.2's A2 **"⛔ No item."** cell and its binding `ChartPane` rule; §5 item 9's
  `StockChart.jsx` exclusion; H1 and H3.
- `05-product-strategy/capability-matrix/best-of-breed.md` (item 10) — §1 H2 and H3(a)/(b) (the two
  no-incumbent rows); §6.1 items 1, 4, 5; §6.2 and its three unclosable gaps, including (b) the
  Finviz single point of failure.
- `10-roadmap/success-metrics.md` (item 35) — §2's four-field contract and obligations 2.1/2.2/2.4;
  §3.1's population arithmetic (26 / 29 / 21 / 13, and the 800× same-filename trap); §3.3 (the
  charter sentence, four places, unmeasurable as written); **PH-5** in full; §4.0's computability
  table; **SM-11** and its ⚰️ supersession.
- `10-roadmap/rollout-rollback.md` (item 37) — §1.4's six tiers with reach; §1.5 (`--set` redeploys,
  `delete` does not); §2's rungs **S0**, **S1** (*already ships, costs no new code*), **S2** (*the
  only rung that needs a build*), S3; DP-3 / RB-2; RB-11.
- `10-roadmap/dependency-graph.md` (item 29) — H3's three inversions; §5.2's parallelism reduction
  (40 → 3 + 1 → 1 → 1 → 0) and the OPRA no-replay constraint; §5.3's wave shape and *"a fourth lane
  is not available"*.
- `01-existing-system/capability-ledger.md` — the **2026-09-26 staleness banner** (six for six, all
  understating); rows **G1**, **G2**, **G4**, **G5** (the three Finviz scans inside the 06:35 CT
  wire, and the observed `SCAN HEALTH FAILED`), **F6**, **J4**, **O4**, **O6**, **O8** (maintenance
  mode resets on every redeploy), **P6** (the ledger's only absent·absent row); the
  TERMINAL-CURRENT / TERMINAL-NEXT vocabulary note.
- `03-competitive-research/desk-tools/finviz.md` — §2 (the scans, the `chart.ashx?…&p=d|w` tabs on
  `DrillModal`/`ThemeTracker`, *"display-only"*); §5's verdict table (**Absorb** for the PNG tab;
  *Integrate-harden* for the scans) and its 🟡 confidence note.
- `03-competitive-research/desk-tools/tradingview-desk-use.md` — §2's two embed contexts, the
  reconstructed morning loop, §5's *not in the screening loop at all*, §6's webhook bridge, and §5
  item 2's 🔴 hypothesis about the drill's tabs.
- `09-security-licensing-cost/licensing-register.md` — **T-49** (Finviz chart PNGs to members:
  **U, leaning R**; `robots.txt` disallows `/chart` and `/image`; ANSWERED via T-47; *"retire images,
  render from Massive"* as the lower-risk design).
- `00-program-control/CRITICAL_PATH.md` — **CP-06** (OI-06 answered by the owner 2026-09-19, four
  tools, rank declined) and **CP-04** (the remaining confirming input is *a desk-observed morning*).
- `00-program-control/OWNER_INPUTS_REQUESTED.md` — **OI-06**, **OI-02**, **OI-21**.
- `00-program-control/charter/OWNER_SEED_FACTS.md` §6 — the 2026-09-01 seed line: *"one paid tier
  whose paywalled item is the Morning Wire, with a $7 weekly promo"*, and the second price artifact
  it creates against `app/src/pages/Pricing.jsx:6` (carried through item 35 §3.2).
- `00-program-control/MASTER_CHECKLIST.md` — row 27 (owners A-03 + H-01, Gate column **18**) and
  row 13.

⛔ **SHA not pinned (no git by instruction)** — every reading above is a claim about a file at a
date, and item 35's obligation 2.1 says plainly why that is a ceiling: *"a reading without the build
it came from cannot be compared to the next one."*

---

## ⛔ What this document does NOT decide

1. **Who the subject is.** Owner-only (CARD 22 §6). ⛔ And if nobody qualifies, the answer is a
   labelled INCONCLUSIVE, never a route around it.
2. **Who adjudicates.** OI-02. SM-11's default is superseded and should be deleted on OI-02's
   arrival.
3. **K and N.** Derived from phase A by measurement. ⛔ Naming them here would re-commit the defect
   CARD 22 §3 removed.
4. **Whether the workflow in §6.1 is the right one.** It is a candidate derived from the estate's own
   embeds; one owner sentence confirms or voids it.
5. **Sequencing, dates, waves and lane assignment** — item 28, respecting item 29's graph.
6. **Any re-banding, re-scoring or re-ordering of item 16's 85 items** — item 17 owns the bands, item
   16 owns the roster, and §5 is an exclusion list for one trial and not a rejection list.
7. **What the second increment is.** ⛔ Deliberately absent: a displacement ledger is written one row
   at a time, and a second row chosen before the first is recorded is a plan, not a ledger.
8. **Whether the Finviz tabs are removed, and when** — a PASS makes them removable; item 28
   sequences the removal and item 37's S3 rung shapes the commit.
9. **Price, trial length, seat model, or anything tier-shaped** — CARD 17 leaves the first three
   open, forecloses the fourth, and ⛔ **two price artifacts disagree in kind with neither ratified**
   (§5.6). This document resolves neither and needs neither.
10. **Whether the charter thesis is true.** CARD 22 demoted it to a thesis on purpose. ⭐ One
    displacement is one row in a ledger, and the ledger is the deliverable.
