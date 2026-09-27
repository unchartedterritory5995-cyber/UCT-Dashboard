---
id: F-05-SCORING
title: Feature Scoring Matrix — all 85 backlog items scored on the seven axes this programme actually holds, banded into a defensible build order, with the value axis refused out loud
role: >
  Gate item 17 — MASTER_CHECKLIST item 17 ("Feature Scoring Matrix",
  `05-product-strategy/feature-scoring.md`, owner F-05, status NOT STARTED before this file).
  ⚠️ Item 16's frontmatter records the same unreconciled conflict this file inherits: the dispatch
  calls these "gate item 16 / 17" while `MASTER_CHECKLIST.md`'s own Gate column reads **13** for both
  rows. Both are recorded; neither is reconciled here, and `MASTER_CHECKLIST.md` owns the value.
  ⛔ This file scores and orders the candidates item 16 enumerated. It does NOT pick an MVP
  (item 27), write a roadmap (item 28) or own the dependency graph (item 29).
wave: 4
group: F
category: product-strategy
inputs: >
  `05-product-strategy/feature-opportunity-backlog.md` (F-05-BACKLOG, item 16 — 1,540 lines, all 85
  items, read in full; every **Size**, **Depends on**, **Anti-pattern risked**, **Known it worked**,
  **Provenance** and **Today** field was extracted mechanically) ·
  `05-product-strategy/capability-matrix/best-of-breed.md` (F-05, item 10 — §0 marker legend, §1
  H1/H2/H3, §3.3/§3.4/§3.6, §4.1–§4.9, §5, §6.1, §6.2 and its three unclosable gaps, GAPS 1–9) ·
  `05-product-strategy/anti-patterns.md` (F-01, item 11 — the 65-entry roster, every per-entry
  `**Detector.**` verdict, §0's probability ranking, §3, §4's 17 exposure rows, §5, §6, GAPS) ·
  `07-technical-architecture/realtime-performance-architecture.md` (ARCH-07, item 24 — §2.2, §2.5,
  §3 Q1–Q10, §4 D1–D10, §5.1–§5.3, §6, GAPS) ·
  `10-roadmap/observability-plan.md` (ARCH-07-OBS, item 25 — §0, §2.2's read-side census, G-1…G-10,
  §4.2's tiering rule, §4.6's four proof methods, §4.7's `as_of` contract, §5, GAPS) ·
  `10-roadmap/rollout-rollback.md` (H-07, item 37 — §1.2, §1.4's six tiers, §1.5, §2's reach table,
  §3's decision table, §4, GAPS) ·
  `10-roadmap/testing-plan.md` (H-06, item 36 — §2's T0–T7 ladder, §3's C-1…C-12 per-rail contract,
  §4.4's disturbance-interval arithmetic, GAPS) ·
  `00-program-control/CRITICAL_PATH.md` (CP-01…CP-12) ·
  `00-program-control/OWNER_INPUTS_REQUESTED.md` (OI-01…OI-21) ·
  `12-decisions/DECISION_CARDS_2026-09-26.md` (CARDS 9–21, incl. **CARD 17**) and
  `12-decisions/DECISION_CARDS_2026-09-25.md` (CARDS 1–8).
scope: >
  Read-only over programme artefacts. ⛔ No git command of any kind was run — **SHA not pinned (no
  git by instruction)**. No network request, no WebFetch, no Railway command, no production call, no
  browser, and no test or script against the repo. The only code run was read-only counting and
  joining over **item 16's text and over this file's own output**, and every count below states its
  pattern. One file was written: this one. ⛔ `10-roadmap/dependency-graph.md` and
  `10-roadmap/success-metrics.md` were not opened — two other sessions own them — and
  `05-product-strategy/feature-opportunity-backlog.md` was read and never edited.
  Four delegated read-only agents were used (best-of-breed; anti-patterns; items 24/25/37;
  items 36/CRITICAL_PATH/OWNER_INPUTS/the cards); their corrections to my own brief are in GAPS 1.
confidence: >
  🟢 that every item in §4 exists in item 16 with the id given, and that the **SZ** and **RSK**
  columns restate a cited artefact's own field rather than my opinion. 🟢 on the item roster and
  every per-family count — both are `grep`-derived over item 16 and reproduced in §3.0.
  🟡 on **DEP**, because item 16's `Depends on` field carries both directions of the arrow in one
  field and 25 of its cross-references needed a reading (GAPS 2). 🟡 on **EV** and **VER**, which
  are one rule of mine each applied mechanically to 85 cells. 🔴 on **REV** as a scale, because
  item 37 supplies no tier at all for 22 of the 85 (§1 H2) — `R3` is my label for that hole, not
  its vocabulary. ⛔ 🔴 on any reading of these columns as value, effort in days, or ROI: there is
  no such input anywhere in this programme and §2 is the whole reason this file opens with it.
evidence_ceiling: >
  ⛔ **THE CEILING THAT MATTERS: this document opened no source file under `api/**` or `app/**`, ran
  no detector, and probed no running service.** It is a scoring pass over item 16, which is itself a
  scoring-free pass over artefacts whose own ceilings it inherits — so every "today" here is at two
  removes from code and every competitor mechanism at four or five from a vendor. Item 16's GAPS 1
  states its own version of this and instructs the reader to assume every address is approximate.
  SECOND CEILING: **the size bands are not measurements and item 16 says so in its own GAPS 7** —
  *"Size bands are judgements and none was validated against anything… Item 17 should treat every
  band as an input to be challenged, not a measurement to be multiplied."* This file carries them
  forward as an input, challenges three of them in §6, and multiplies none.
  THIRD CEILING: **no detector class in the RSK column was observed firing.** `anti-patterns.md`
  states the same limit about itself — *"A 'YES' is a claim that a named rail exists in a cited
  artifact, never that it currently passes. No detector was run by this document."*
  FOURTH CEILING: **no cost, no revenue, no member-demand and no telemetry input exists anywhere in
  this programme**, which is §2, and it is the reason the axes are the ones they are.
status: draft
date: 2026-09-26
---

# Feature Scoring Matrix

## 1. Headline — the three things the scoring reveals that item 16 does not say

⛔ **None of the three is a priority claim.** They are properties of the item set that only appear
once all 85 items are put on the same axes, and two of them are findings about the *programme's own
instruments* rather than about the features.

**H1. The binding constraint on this backlog is not size and it is not dependency — it is whether
you could tell the item worked. 29 items are both size S and free of any prerequisite; 11 survive
all seven axes.**

Derived by applying the filters in order over §4's table (`scored.json`, one pass, counts printed):
**29** items are size S *and* dependency-depth 0 → **22** once the ten HELD items are removed
(§5 band 0) → **17** once the items item 37 has no rollback tier for are removed → **14** once the
items whose observable is not computable today are removed → **11** once the items that walk into an
anti-pattern with **no detector** are removed. ⭐ **The two filters that remove the most are the two
a value-versus-effort matrix does not have columns for.** Item 16 already says the size bands are
judgements; what the scoring adds is that the bands were never the bottleneck.

**H2. The programme's rollback plan has six tiers and not one of them describes the shape 22 of these
85 items are — including eight of the eleven largest.**

`rollout-rollback.md` (item 37) §1.4 publishes six tiers, ordered cheapest-first and explicitly
*not* monotonic — **0 per-browser → 1 env var, no rebuild → 2 env var + redeploy → 4 pre-authored
rollback branch → 3 revert-and-push → 5 emergency `production` force**. ⛔ **All six are
flag-, env- or bundle-shaped.** A delegated read-only sweep of all 902 lines for
`migrat|schema|database|irreversib` returned nothing but one incidental "DB write": **item 37 names
no tier for a store change, a schema change, a retention series that starts, a credential rotation,
or a member-visible record once published.** 22 of the 85 items are exactly those shapes, among them
both XL items (`FB-D2-01`, `FB-A13-01`) and six of the nine L items. Meanwhile only **4** items are
reversible at tiers 0–2 at all. So the programme can take back 4 items cheaply, 59 on a deploy, and
22 by no tier it has written down. ⭐ That is a hole in an axis, found by trying to score, and it is
a deliverable for item 37 rather than a reason to reorder anything.
⚠️ Item 37's own GAPS 8 sharpens it: *"A tier nobody has pulled in anger is a procedure, not a
capability"* — **no rollback was rehearsed**, so even the 63 items that do have a tier have an
unexercised one.

**H3. Gap size — the axis a competitive programme would lean on hardest — is silent on two thirds of
the backlog, and that is a fact about where the backlog came from.**

`best-of-breed.md` owns four gap levels in its own words: **§6.1's "five closest"** (plus the ⌀
no-incumbent cells), **§4's "contested"**, **§6.2's "five largest gaps"**, and the terminal
**"three gaps that cannot be closed at all, recorded so nobody plans against them"**. Scoring each
item by the section its own **Provenance** field cites places **25** of 85 and leaves **60**
unplaced. ⭐ The 60 are not unexamined — they are the items drawn from
`capability-infrastructure-matrix.md`'s 33-row spine (`NORMALIZATION NEEDED`, `REMAINING GAP`,
`BACKEND WORK`) and from the three measurement artefacts, and **their justification was never
"a competitor has this."** Two consequences: a conventional competitive scoring model would rank
most of this backlog at zero, and `anti-patterns.md` §0 independently argues the opposite — the
defects this estate has actually paid for are DOC-1 rosters, INST-2 proxy instruments and STATE-1
unversioned documents, none of which any competitor comparison would ever surface.

⚠️ **And one finding about item 16's own format, because item 29 is reading the same field right
now.** Item 16's `Depends on` field carries **both directions of the arrow in one field** — some
cells say "depends on X", others say "It is a dependency of X" / "It gates X" / "everything depends
on it: X". A naive extraction of `FB-*` references from that field yields cycles and a maximum chain
length of **10**. The corrected hard-prerequisite graph has **no cycles and a maximum depth of 3**,
with 50 of 85 items at depth 0. ⛔ **Anyone building a dependency graph off that field mechanically
will get the wrong answer**, and the failure is silent because the wrong graph is still a graph.

---

## 2. ⛔ Why this is not a value matrix — read this before any score below

⭐ **This is second rather than an appendix because a reader who skips it will misuse everything
after it.** A conventional feature-scoring matrix has a value axis and an effort axis, and produces
a quadrant. **The value axis is not available here, and inventing it would be the single worst thing
this document could do** — it would convert a guess into a number that item 28's roadmap then treats
as evidence. This repo has a name for that shape: *an acceptance number is a forecast until derived*.

**The four missing inputs, each named at the artefact that owns it.** ⚠️ My own brief attributed
these to `CRITICAL_PATH.md`; a delegated read of all 29 of its lines found that **"revenue" and
"demand" appear zero times in it** and that it references cost only as a *blocked artefact*. The
correct citations are:

1. ⛔ **No cost input.** `OWNER_INPUTS_REQUESTED.md` **OI-10** asks for the monthly spend baseline
   and *"the AI API monthly ceiling you are comfortable with for member-facing lanes"*; its
   default-in-force column reads, verbatim, *"Unknown; cost model states every assumption and shows
   deltas, not absolutes."* **No answer is recorded and it is not in the Answered table.** So no
   item below can be divided by its cost.
2. ⛔ **No revenue or tier-mix input.** **OI-01** asks for member count and tier mix and the paid
   conversion trend; its default reads *"Under ~750 community members; one paid tier whose paywalled
   item is the Morning Wire; $7 weekly promo; **mix unknown**."* **CARD 17** settles the tier
   *count* and explicitly leaves the rest: *"⚠️ **Still undecided and still not mine:** price,
   trial, seat model. One paid tier says nothing about what it costs."*
3. ⛔ **No member-demand input, and the honest form of that statement is a measurement, not a
   declaration.** There is no sentence anywhere in the programme reading "we have no demand signal."
   What exists is **CARD 13**'s admission that *"§3's telemetry (17 of 29 accounts hold a board,
   none empty, modal 5 panels) is a **staff cohort under `COMING_SOON_MODE`** and cannot speak for
   members"*, and **CARD 11**'s pod-side counts of **`screen_alert_subs` = 4 rows / 2 users** and
   **`screen_alerts_fired` = 4 rows / 1 user**. Item 16's own §5 item 5 states the consequence in one
   line: **no member ever asked for anything in that backlog**, with OI-21's five queries run once as
   existence-checks (`calendar_seen` **16 rows**, `ai_search_log` **79**).
4. ⛔ **No usage rates, and no p95 for the one performance gate that exists.** ARCH-07's GAPS:
   *"**No p95 anywhere.** … The gate is therefore specified and not yet measurable."* ARCH-07-OBS
   **G-2** confirms it with a control — *"Nothing in the serving process computes a latency
   percentile for any surface."*

⭐ **One cost rule does survive, and it is a rule rather than a number.** **OI-20** records that
SnapTrade bills about $2 per connected user and that its default is *"Treated as accepted for
existing broker-sync members; **any new per-member line still escalates.**"* So an item that
introduces per-member spend is escalation-gated **by rule**, whether or not OI-10 is ever answered.
No column below encodes that, because it applies to zero items in this backlog.

⛔⛔ **And one axis is forbidden outright, not merely unavailable.** **CARD 17**, owner ruling
2026-09-26: **"there is one paid tier only that is it."** Its own foreclosure: *"No tier-comparison
surface, ever… no pricing table, no upgrade affordance, no locked-behind-a-higher-tier state, no
per-tier entitlement rows. A design leaving room for a second tier is carrying dead weight."*
**No axis below is tier-related and no item scores higher for driving an upgrade — there is nothing
to upgrade to.** ⚰️ Item 16 records that this already cost `FB-A10-01` half of its own source
sentence (best-of-breed §6.1 item 1's *"and make removing it the upgrade"*), and the label survives
on the honesty argument alone, which is the stronger one. ⭐ CARD 17's own instruction about how to
absorb it is *"Re-read it with that in mind rather than rewriting it"* — so where a source axis was
tier-shaped it is **collapsed to a binary, not deleted**.

⭐ **So what is the order in §5, if it is not value?** It is **a defensible build order under stated
assumptions** — specifically: that an item you cannot verify is not ready to build, that an item
nothing can take back is more expensive than its size band says, and that an item several others sit
behind is worth doing before them. **It is not a value ranking.** Nothing below asserts that any
item is worth more to a member than any other, because nothing in this programme can support that
sentence. ⛔ **The moment a cost input, a demand signal or a price arrives, this order should be
re-run** — §7 names the specific arrivals and what each one changes.

---

## 3. The axes — each with its scale, its source, and what a high score means

⛔ **Every axis is declared before it is used, and no axis is a weight.** There is no composite
score anywhere in this document. ⭐ That is deliberate: `anti-patterns.md` **PROD-C6** is *two
metrics that must never be blended*, and F-01 names UCT's live instance of it (a catalyst composite
by formula plus a forced quota). A scoring matrix that summed these seven columns would commit the
anti-pattern it is scoring items against. **The bands in §5 are produced by filters applied in a
stated order, never by arithmetic over the columns.**

### 3.0 First, the roster — measured, not carried

⛔ **The item count is not taken from item 16's own §2.5 table**; it is re-derived here so that a
drift between the two would be visible. Run over
`05-product-strategy/feature-opportunity-backlog.md`:

```
grep -oE '^#### (FB-[A-Z0-9]+-[0-9]+)' feature-opportunity-backlog.md | sed 's/^#### //'
```

→ **85 lines, 85 distinct ids, 0 duplicates.** Grouping those ids by the taxonomy row embedded in
each one reproduces item 16's §2.5 distribution exactly, family for family (S1 3 · S2 4 · S10 3 ·
S12 2 · A1 1 · A10 6 · A11 4 · A3 2 · A4 1 · A5 4 · A6 2 · A7 2 · A8 3 · A9 3 · A12 3 · A13 1 ·
I1 4 · S3 1 · S4 2 · S5 2 · S6 1 · S7 3 · S8 2 · S9 4 · S11 1 · D1 1 · D2 1 · D3 1 · D4 1 · D5 2 ·
OBS 9 · X1 2 · X2 2 · X3 2). ⭐ **Two independent derivations agreeing is the only reason to state a
count at all**; a single one would be DOC-1.

⛔ **A naming trap inherited from best-of-breed §0 and worth restating, because these ids embed
letters:** *"The capability ledger's letters are NOT this taxonomy's letters… **Do not cross-map by
letter.**"* `capability-ledger.md` uses A for market data, D for fundamentals, E for calendar, I for
watchlists — colliding with the taxonomy's A-applications, D-data-platform, E1 and I1. **Every
letter in an `FB-*` id below is a taxonomy row, never a ledger row.**

### 3.1 EV — evidence strength · scale `E3 meas` / `E2 cite` / `E1 infer`

**Source.** Each item's own **Provenance** and **Today** fields, classified by *the artefact class
that produced the claim*. **Derivation rule, applied mechanically:** `E3` where the provenance names
one of the four constructs in this programme that actually **ran** something — the 2026-09-26
foreground-browser run (`results.md`), ARCH-07's own protocol runs (§1/§2), ARCH-07-OBS's `G-n`
grep-with-a-control sweep, or an `OI-nn` query — `E1` where the item's own text flags its evidence
(`Partly inferred`, `unevidenced`, `NOT DETERMINED`, `(CLAIM`, 🟡, *"Nothing in the inputs records"*,
*"No artifact records"*, or a provenance leaning on the worktree `CLAUDE.md` that F-01's **DOC-5**
records as eight facts behind master), and `E2` otherwise — a real, traceable artefact prescription
(best-of-breed, the capability matrix, product-architecture, the ledger, a decision card) with no
instrument behind it. `E1` overrides `E3`.

**Result: E3 16 · E2 60 · E1 9.** **High = better evidenced.** ⚠️ `E2` is not weak — it is the
modal state of this programme, and it means *an artefact prescribes this and nothing measured it*.
⛔ What the axis cannot do: `E3` says an instrument ran, never that it ran *recently* or that its
address still resolves. ARCH-07-OBS §1 records two artefacts citing `api/main.py:3639-3644` for a
comment that sits at `:4510`, an ~870-line drift, and PROD-6 records seven of nine spec citations
moving in two days.

### 3.2 GAP — gap size · scale `close` / `contest` / `LARGE` / `unclos` / `no-inc` / `--`

**Source.** `best-of-breed.md`'s own four-level vocabulary, assigned **per item** rather than per row
— by which section that item's own Provenance cites. ⭐ Per-item and not per-row because
best-of-breed's own caution demands it: **S3 sits in both §4.7 ("cannot be ranked at any research
budget") and §6.2 ("the clearest infrastructure gap the research found")**, and A9 sits in §6.1
(closest, on its honesty layer), §4.3 (contested) *and* §6.2's unclosable tier (the Finviz single
point of failure). Those are different axes — *incumbent-comparability* versus *UCT distance* — and
scoring a row generically would average them into a number that means nothing.

**Result: `--` 60 · `close` 9 · `LARGE` 9 · `unclos` 3 · `contest` 2 · `close/lg` 1 · `no-inc` 1.**
⛔ **A high GAP is not a high priority and best-of-breed says so itself:** *"It does not decide
priority, sequence or cost. §6's ordering is by **distance from best-in-class**, which is not the
same axis as value, urgency or effort."* And `unclos` means *the engineering half only is on the
table* — for `FB-A1-01` the honest blank is buildable and the licensed feed is not; for `FB-A9-03`
the universe abstraction is buildable and the vendor is an owner purchase.
⚠️ `--` means **best-of-breed places this item's row in no gap tier**, which is H3, and is a hole in
this axis rather than a zero.

### 3.3 SZ·VER — size band and verification cost · `S/M/L/XL` · `T0/T1/T2-T3/T4-T6/gated`

**Source, two halves.** **SZ** is item 16's own **Size** field, carried verbatim — `S` = one surface
or one constant · `M` = a new module or a migration of known call sites · `L` = a new system or a
cross-cutting migration with a store change · `XL` = a new system others must be rewritten against.
**Result: S 37 (+`S–M` 1, `S?` 1) · M 34 (+`M per type` 1) · L 9 · XL 2.**
⛔ Item 16's GAPS 7 binds how this column may be read: *"Size bands are judgements and none was
validated against anything… **Item 17 should treat every band as an input to be challenged, not a
measurement to be multiplied.**"* This file challenges three in §6 and multiplies none.

**VER** is the second half, because a band about the *shape of the change* says nothing about the
cost of *proving* it. It maps each item's own **Known it worked** field onto `testing-plan.md`
(item 36) §2's T0–T7 ladder, whose own framing is that *"a tier is chosen by the blind spot you are
trying to leave, not by its position in a pyramid"*: `T0` an AST/census rail over source · `T1` a
pure decision function · `T2/T3` a jsdom or Python-integration fixture · `T4/T6` a real browser rig
or a production smoke · `gated` an event nobody in this session can schedule (a rehearsal, a real
member's fire, an RTH window, an outage). **Result: T1 31 · T0 23 · T2/T3 15 · T4/T6 5 · gated 11.**
⚠️ **The mapping rule is mine**, applied uniformly; item 36 supplies the ladder and never assigns
items to it. ⛔ And item 36 supplies the hard constraint that makes `gated` its own class:
*"Before starting a long verification, measure the **disturbance interval**. If the run is longer
than the gap, it will never finish"* — a six-shard vitest gate takes 46–92 minutes against a master
that moved 56 commits in 92; a rig cell takes 12–22 minutes against a production that deploys every
~13, which left **22 of 23 cells INCONCLUSIVE**. **High VER cost is not fixable by trying harder.**

### 3.4 DEP — dependency depth · `d<n>·b<m>`

**Source.** Item 16's own **Depends on** field, reduced to **hard prerequisites only** and
re-derived as a graph. `d` = longest hard-prerequisite chain beneath the item; `b` = the number of
other items that transitively cannot land until it does. **Two exclusions, both stated because both
change the answer:** reverse-arrow sentences ("It is a dependency of…", "It gates…", "everything
depends on it") are **not** prerequisites, and conditional cross-references ("if it lands first",
"would make it reliable", "nothing otherwise", "does not strictly require it") are **soft** and
excluded. **Result: d0 50 · d1 25 · d2 8 · d3 2; no cycles; maximum depth 3.**
⚠️ Before those exclusions the same field yields cycles and a depth of 10 — H3's ⚠️, and GAPS 2.
**Low `d` is better; high `b` means doing it early buys more.** Top by `b`: `FB-S8-01` **11**,
`FB-S7-03` **6**, `FB-D2-01` **5**, `FB-S5-01` **4**, `FB-D1-01` **4**, then `FB-S3-01`,
`FB-OBS-07`, `FB-OBS-04` at **3**. ⭐ `FB-S8-01` gating eleven items on a size-**M** body of work at
depth 0 is the single highest-leverage number in this file, and it corroborates item 16's own H2
rather than revealing it.
⛔ **`d0` does not mean startable.** Ten of the fifty depth-0 items are blocked on a person, a
vendor, a credential or an undecided sentence — that is §5's band 0, and it is why this column and
the band assignment are two different things.

### 3.5 REV — reversibility · `R1 flag` / `R2 bundle` / `R3 none`

**Source.** `rollout-rollback.md` (item 37) §1.4's six tiers and §3's decision table, which keys on
*failure shape* rather than change type. `R1` = comes back at tiers **0–2** (a devtools/localStorage
write; a request-time flag in `_access_payload`; a backend capability gate plus a redeploy) —
**no rebuild, or one**. `R2` = comes back at tiers **4/3** (a pre-authored rollback branch,
preferred, or a plain revert-and-push) — **a full build, and per item 37's reach table an open tab
keeps the old bundle**. `R3` = **item 37 names no tier for this shape at all.**

**Result: R1 4 · R2 59 · R3 22. Lower is better.** ⛔ `R3` is **my label for a hole in item 37**, not
its vocabulary — see §1 H2 for the sweep that establishes the hole. The 22 are the items whose
deliverable creates or changes persistent state (`FB-S5-01`, `FB-S5-02`, `FB-D2-01`, `FB-S3-01`,
`FB-A13-01`, `FB-A4-01`, `FB-A7-02`, `FB-S9-04`, `FB-A8-01`, `FB-D1-01`, `FB-D5-01`, `FB-A12-03`),
changes a **published** value or address a member can already hold (`FB-A11-04`, `FB-S2-03`,
`FB-S2-04`, `FB-S1-03`, `FB-X1-01`, `FB-A12-02`, `FB-X2-02`), or is not an engineering act at all
(`FB-A10-05` a vendor request, `FB-A10-06` a product decision, `FB-OBS-07` a scheduling decision).
⭐ Three rulings from item 37 bind any R1/R3 item regardless of its score, and they are quoted
because paraphrase weakens them: **"A kill switch defaults ON. An enablement gate defaults OFF."** ·
⛔ **"Stopping a dark run must never be a DELETE against member data — flags stay env vars and
cohorts stay tags."** · ⛔ **"A kill switch nobody has watched actually kill something isn't a kill
switch, it's a variable."** ⚠️ And item 37's §1.5 vocabulary ruling: say **"no rebuild", never "no
redeploy"** — tier 1 is cheap because the bundle is untouched, not because nothing restarts.

### 3.6 RSK — risk · `undet` / `partial` / `detected` / `none-named`

**Source, joined from two artefacts and fully cited — this is the one column with no judgement in
it.** The anti-pattern entries come from each item's own **Anti-pattern risked** field; the detector
class comes from `anti-patterns.md`'s own per-entry `**Detector.**` verdict. That file's 65 entries
split **✅ 31 YES / 🟡 14 PARTIAL / ⛔ 20 NO** (its §1 tally, which a delegated per-entry derivation
reproduced exactly). An item scores by the **worst** detector class among the entries it names:
`undet` = names at least one anti-pattern **nothing can detect** · `partial` = worst is a detector
covering one instance, opt-in, unrunnable, or half the class · `detected` = every named entry has a
named rail · `none-named` = the field names a hazard from a ledger row or a governing principle
rather than a library entry (4 items: `FB-S2-04`, `FB-A10-05`, `FB-A9-01`, `FB-S7-03`).

**Result: partial 35 · detected 25 · undet 21 · none-named 4. Low is better; `undet` is the signal.**
⭐ **Why "no detector" *is* the risk and not a footnote:** F-01's §1 says *"an anti-pattern is not a
rule until something can detect it"* and calls the twenty ⛔ *"the work items"*. So an `undet` item
is one you can commit the known defect on and nothing will tell you. ⛔⛔ **And the concentration is
the finding:** §2.5 **STATE has zero ✅ detectors** (5 of 7 ⛔ NO, 2 🟡) and §2.8 **PROD-C has
effectively one** (PROD-C9, self-labelled "YES-ish"; 5 ⛔ NO, 4 🟡) — which are precisely the two
families Terminal-Next is *made of* (the workspace document) and *about to specify* (trust, AI
metering, published numbers). §2.9 PROC, by contrast, is **9/9 ✅**.
⚠️ A caveat carried from the delegated read: `anti-patterns.md` §1 contains **two count tables and
they disagree** — the per-entry tally gives 31/14/20 and the index table's columns sum to 32/16/17,
understating the ⛔ population by three. **The per-entry `**Detector.**` lines are the authority**
and this column uses them. ⚰️ *A hand-typed count beside the artefact that owns it, in the document
that ranks DOC-1 first.*

### 3.7 OBS — the observable, in two questions that are not the same question

**Source.** Each item's own **Known it worked** field, plus item 25's finding that a gate this
programme just adopted **cannot be evaluated**. ⭐ **"Has an observable" and "the observable is
computable today" are two different columns, and this axis is the second one** — because
ARCH-07-OBS **G-2** establishes that CARD 16's **p95 ≤ 250 ms per timeframe, on a pod ≥ 300 s old**
has no p95 to be evaluated against: *"Nothing in the serving process computes a latency percentile
for any surface"*, confirmed with a control (`grep -rn "p95\|percentile" api/` hits exactly one
module, and those are option-premium percentiles — a product feature).

Scale: `yes` = the observable is stated and computable with what exists · `needs p95` = the
observable is a latency percentile nothing computes (**3** items) · `rehearsal` = it requires an
event nobody can schedule — a kill switch seen to fire, a restore rehearsal, a real member's alert,
an RTH window, an outage (**9**) · `fixture-TBD` = it names a fixture or measurement that does not
exist yet (**4**) · `NONE` = the item says outright that no observable is stated (**1**,
`FB-S10-03`) · `is the fix` = the item's deliverable *is* the missing measurement (**1**,
`FB-OBS-01`). **Result: yes 67 · rehearsal 9 · fixture-TBD 4 · needs p95 3 · NONE 1 · is the fix 1.**

⚠️ **How this count relates to item 16's own, because they differ and the difference matters.**
Item 16's §2.6 names **six** incomplete observables (one `FB-S10-03` outright, plus `FB-A5-04`,
`FB-S5-01`, `FB-S9-04`, `FB-OBS-01`, `FB-X3-02`) and states that its own figure *"is a floor, not a
census"*. A looser sweep of the same field here flags **fifteen**. ⛔ **I have used item 16's six as
the authoritative `fixture-TBD`/`NONE` set and added only the two mechanically-defensible classes
above** (`needs p95`, from item 25's named gate; `rehearsal`, from the field's own words), rather
than promoting my looser pattern into a number. The looser nine are named in GAPS 4 so a later
reader can promote them deliberately.
⭐ The standard the whole axis rests on, from item 25 §4.5 and item 36 §3 alike: **"a signal which
fires on the normal case is not a noisy signal — it is a signal that will shortly be no signal."**

### 3.8 ⛔ Two axes I considered and refused

- **A composite or weighted score.** Refused: PROD-C6, above, and because five of the seven axes are
  ordinal with unequal steps. `L` is not "three S".
- **Any tier-, price-, upgrade- or seat-related axis.** Refused by CARD 17, §2.

---

## 4. The matrix — all 85 items

**Form, and why.** One compact table per taxonomy family, in item 16's own section order, with the
axes as columns. ⚠️ The usual guidance is that a table becomes unreadable past about six columns —
**the real constraint is rendered width, not column count**, so this uses eight columns in which
every cell but the id is a token of ≤ 11 characters (~70 characters total) and puts all prose in the
per-family notes beneath. A six-column version would have had to fold two axes into one cell or drop
one, and the two candidates for folding (REV and RSK) are the two §1 says are load-bearing.
**Notes appear only where a score needs defending.**

**Legend.** `EV` §3.1 · `GAP` §3.2 · `SZ·VER` §3.3 · `DEP` = `d`epth·`b`locks §3.4 · `REV` §3.5 ·
`RSK` §3.6 · `OBS` §3.7. ⛔ Rows are in taxonomy order, **not** score order — §5 owns the order.

### 4.1 Edge and chrome — S1, S2, S10, S12

**S1 Terminal Shell & Workspace** — 3 items

| id | EV | GAP | SZ·VER | DEP | REV | RSK | OBS |
|---|---|---|---|---|---|---|---|
| `FB-S1-01` | E2 cite | — | S·T2/T3 | d0·b0 | R2 bundle | partial | yes |
| `FB-S1-02` | E2 cite | close | S·T2/T3 | d0·b0 | R2 bundle | partial | yes |
| `FB-S1-03` | E2 cite | — | L·T1 | d1·b0 | R3 none | detected | yes |

- `FB-S1-02` scores `GAP close` off best-of-breed §6.1 and still lands in band 0: ARCH-07 §3 Q1 rules that *"The number still has to be chosen by a person"*, so the enforcement is **S** and the number is not an engineering item at all.

- `FB-S1-03` is `REV R3` because its contract obliges a migration path for 18 existing registry types plus the abandoned `embedded` pattern; item 37 names no tier for that shape.

**S2 Command, Search & Navigation** — 4 items

| id | EV | GAP | SZ·VER | DEP | REV | RSK | OBS |
|---|---|---|---|---|---|---|---|
| `FB-S2-01` | E2 cite | LARGE | M·T0 | d0·b0 | R2 bundle | detected | yes |
| `FB-S2-02` | E2 cite | LARGE | M·T0 | d0·b0 | R2 bundle | partial | yes |
| `FB-S2-03` | E2 cite | LARGE | L·T1 | d1·b1 | R3 none | detected | yes |
| `FB-S2-04` | E2 cite | — | S·T0 | d2·b0 | R3 none | none-named | yes |

- `FB-S2-04` is `RSK none-named`: its hazard is ledger J2's (*"embed params are stored verbatim in every note — renaming a widget type or param orphans member content"*) plus `GOVERNING_PRINCIPLES` §13, not a library entry. It is `REV R3` for the same reason — an address a member has already pasted into a post cannot be un-published by a deploy.

- `FB-S2-01` / `-02` / `-03` are the three best-of-breed §6.2 item 1 prescribes **in that order**, and the dependency column agrees without being told: `-01` and `-02` at `d0`, `-03` at `d1`.

**S10 Presentation Primitives** — 3 items

| id | EV | GAP | SZ·VER | DEP | REV | RSK | OBS |
|---|---|---|---|---|---|---|---|
| `FB-S10-01` | E2 cite | — | M·T1 | d0·b0 | R2 bundle | detected | yes |
| `FB-S10-02` | E2 cite | — | M·T0 | d0·b0 | R2 bundle | detected | yes |
| `FB-S10-03` | E2 cite | — | M·T0 | d0·b0 | R2 bundle | partial | NONE |

- `FB-S10-03` is the file's only `OBS NONE`, and item 16 says so outright: *"Nothing in the inputs measures form-control inconsistency, so 'it worked' cannot currently be distinguished from 'it shipped'."* ⭐ The honest first step is a census, which is the observable's precondition rather than the item.

**S12 Rollout, Cohort & Observability** — 2 items

| id | EV | GAP | SZ·VER | DEP | REV | RSK | OBS |
|---|---|---|---|---|---|---|---|
| `FB-S12-01` | E1 infer | — | M·gated | d0·b1 | R1 flag | detected | rehearsal |
| `FB-S12-02` | E2 cite | — | S·T1 | d1·b0 | R1 flag | detected | yes |

- `FB-S12-01` scores `EV E1` on a mechanical trigger — CP-08's 🟡 confidence glyph — and I believe that understates the evidence; see §6.2. Its `OBS rehearsal` is correct and load-bearing: item 37, *"A kill switch nobody has watched actually kill something isn't a kill switch, it's a variable."*

- ⭐ Both S12 items are `REV R1` — two of only **four** in the whole backlog that come back at item 37's cheap tiers. ⚠️ And item 37's §0 finding 1 is the trap: a kill switch defaults ON, so `needs_declaration()` is false, so **a kill switch is outside the flag ledger by construction** — the artifact a responder would open to find the lever does not contain it.

### 4.2 Applications — market, price and positioning — A1, A10, A11

**A1 Markets** — 1 item

| id | EV | GAP | SZ·VER | DEP | REV | RSK | OBS |
|---|---|---|---|---|---|---|---|
| `FB-A1-01` | E2 cite | unclos | S·T0 | d0·b0 | R2 bundle | partial | yes |

- `GAP unclos` applies to the licensed-feed half only (best-of-breed's terminal tier — yfinance is X-class with *"no purchasable remedy"*). The honest blank is **S**, `REV R2` and buildable now, which is why this sits in band 3 rather than band 0.

**A10 Options & Flow** — 6 items

| id | EV | GAP | SZ·VER | DEP | REV | RSK | OBS |
|---|---|---|---|---|---|---|---|
| `FB-A10-01` | E2 cite | close | S·T2/T3 | d0·b0 | R2 bundle | partial | yes |
| `FB-A10-02` | E2 cite | — | M·T1 | d0·b0 | R2 bundle | partial | yes |
| `FB-A10-03` | E3 meas | — | S?·T4/T6 | d0·b0 | R2 bundle | partial | needs p95 |
| `FB-A10-04` | E3 meas | — | M·gated | d1·b0 | R2 bundle | undet | needs p95 |
| `FB-A10-05` | E1 infer | — | S·gated | d0·b0 | R3 none | none-named | rehearsal |
| `FB-A10-06` | E1 infer | — | S·T0 | d0·b0 | R3 none | detected | yes |

- `FB-A10-03` carries `SZ S?` because item 16 refuses a single band — *"**S to diagnose**… **Unknown to fix**"* — and `schwab_router.py` is partner-owned, so the fix routes through a boundary rather than being an ordinary edit. Its `OBS needs p95` is CARD 16's gate, which item 25 G-2 shows cannot be evaluated today.

- `FB-A10-05` is band 0 and not scoreable as engineering at all: ARCH-07 §3 Q9 — *"no measurement can answer and no agent can progress: it needs someone to ask Massive."*

- `FB-A10-06` is band 0 because its entire content is moving ledger G9 into `AWAITING_A_DECISION` or out of the codebase — item 16's own subtitle is *"a decision, not a build."*

**A11 Breadth, Regime & Positioning** — 4 items

| id | EV | GAP | SZ·VER | DEP | REV | RSK | OBS |
|---|---|---|---|---|---|---|---|
| `FB-A11-01` | E2 cite | close | M·T1 | d0·b1 | R2 bundle | partial | yes |
| `FB-A11-02` | E2 cite | close | S·T2/T3 | d1·b0 | R2 bundle | undet | yes |
| `FB-A11-03` | E2 cite | — | S·T2/T3 | d2·b0 | R2 bundle | partial | yes |
| `FB-A11-04` | E2 cite | — | L·T0 | d1·b0 | R3 none | detected | yes |

- `FB-A11-02` is `RSK undet` on **PROD-C6**, which has no detector, and a published regime vocabulary is precisely where a composite number gets emitted. `FB-A11-01` is its hard precondition and best-of-breed says why: *"a regime with two authorities cannot have one vocabulary."*

- `FB-A11-04` is `L` and `REV R3` for one reason: it changes the authoritative value of a **published** rating, so it needs a parallel-run comparison rather than a swap — and **INST-7** warns that agreement between two computations sharing an input is not corroboration.

### 4.3 Applications — research and documents — A3, A4, A5, A6, A7, A8, A9

**A3 Fundamentals & Financial Statements** — 2 items

| id | EV | GAP | SZ·VER | DEP | REV | RSK | OBS |
|---|---|---|---|---|---|---|---|
| `FB-A3-01` | E2 cite | LARGE | M·T0 | d0·b0 | R2 bundle | partial | yes |
| `FB-A3-02` | E2 cite | LARGE | M·T1 | d1·b0 | R2 bundle | partial | yes |

- `GAP LARGE` on `FB-A3-01` is §6.2 item 5's **consolidation half only**. best-of-breed rules the other half out in its own words — per-broker estimates are class-G and *"the honest answer is that this gap should stay open"* — which is why no item exists for it and why a reader should not infer one from the LARGE.

**A4 Estimates & Analyst Actions** — 1 item

| id | EV | GAP | SZ·VER | DEP | REV | RSK | OBS |
|---|---|---|---|---|---|---|---|
| `FB-A4-01` | E2 cite | — | S·T1 | d0·b0 | R3 none | partial | yes |

- `FB-A4-01` is `REV R3` in the direction that matters most here: a retention series cannot be backfilled, so **every night not retained is permanently lost**. That is an argument for starting the retention half alone and ahead of its surface, and it is the only item in the file whose cost of delay is strictly monotonic.

**A5 Events & Calendar** — 4 items

| id | EV | GAP | SZ·VER | DEP | REV | RSK | OBS |
|---|---|---|---|---|---|---|---|
| `FB-A5-01` | E1 infer | — | S·T1 | d0·b0 | R2 bundle | undet | yes |
| `FB-A5-02` | E2 cite | — | S·T2/T3 | d0·b0 | R2 bundle | partial | yes |
| `FB-A5-03` | E2 cite | — | S·T1 | d0·b0 | R2 bundle | detected | yes |
| `FB-A5-04` | E2 cite | — | S·T1 | d0·b0 | R2 bundle | partial | fixture-TBD |

- `FB-A5-01` is band 0 on OQ-14 and `RSK undet` on **DOC-3** — *nothing detects duplicated prose claims* — which is exactly this item's shape: two documents disagreeing about whether the Discord bot runs at all.

- `FB-A5-02` is the cheapest item in this family on every axis (`S·T2/T3`, `d0`, `REV R2`, `OBS yes`) and is a precondition for any Terminal-Next panel that consumes the week contract.

**A6 Transcripts & Filings** — 2 items

| id | EV | GAP | SZ·VER | DEP | REV | RSK | OBS |
|---|---|---|---|---|---|---|---|
| `FB-A6-01` | E3 meas | close/lg | S·T2/T3 | d0·b0 | R2 bundle | partial | yes |
| `FB-A6-02` | E2 cite | close | M·T1 | d1·b0 | R2 bundle | partial | yes |

- `FB-A6-01` scores `GAP close/lg` legitimately: A6 is §6.2's *"harshest row in the file"* (coverage **measured n=0**) **and** the receipt is §6.1's prescribed mechanism. Its stated precondition — confirm RG-15 — is a measurement, not a build.

- ⛔ `FB-A6-02` is bounded by a **rights** gap rather than an engineering one: FMP transcript storage is U-class and *"a rights gap does not yield to engineering."* No axis in this file encodes rights, and §6.4 records that as a missing column.

**A7 Ownership** — 2 items

| id | EV | GAP | SZ·VER | DEP | REV | RSK | OBS |
|---|---|---|---|---|---|---|---|
| `FB-A7-01` | E2 cite | — | M·T1 | d1·b0 | R2 bundle | partial | yes |
| `FB-A7-02` | E2 cite | — | M·T0 | d1·b0 | R3 none | partial | yes |

- Both A7 items are `d1` behind `FB-D1-01`, and both name a **retirement** as the condition of being worth doing — a fifth ownership source that retires none is a sixth authority (DOC-2). Scored `partial` because DOC-2's detector covers one pair and carries no class sweep.

**A8 News & Catalyst Intelligence** — 3 items

| id | EV | GAP | SZ·VER | DEP | REV | RSK | OBS |
|---|---|---|---|---|---|---|---|
| `FB-A8-01` | E2 cite | — | M·gated | d0·b0 | R3 none | undet | rehearsal |
| `FB-A8-02` | E2 cite | — | S·T0 | d0·b0 | R2 bundle | partial | yes |
| `FB-A8-03` | E1 infer | close | M·T1 | d2·b0 | R2 bundle | undet | yes |

- `FB-A8-02` is the cheapest item in the backlog with a **measured member-facing cost** behind it — the idiom rendered *"No recent news for this ticker."* against NVDA while the endpoint returned 15 KB — and F-01's detector field says outright that *nothing detects the six un-migrated sites*.

- `FB-A8-01` is one of the seven items that are both `RSK undet` and `REV R3`; that set is §6.1's danger list.

**A9 Screening & Discovery** — 3 items

| id | EV | GAP | SZ·VER | DEP | REV | RSK | OBS |
|---|---|---|---|---|---|---|---|
| `FB-A9-01` | E2 cite | close | M·T1 | d2·b1 | R2 bundle | none-named | yes |
| `FB-A9-02` | E2 cite | close | M·gated | d1·b3 | R2 bundle | partial | rehearsal |
| `FB-A9-03` | E3 meas | unclos | L·gated | d1·b0 | R2 bundle | detected | rehearsal |

- `FB-A9-01` is `RSK none-named`, and its real constraint is sharper than any library entry: ledger H2's locked invariant that *"a drill list MUST come from the mask that produced the count — never a second pass… the failure is SILENT."* An authoring-time count computed by a second path **is** that defect, which is why the item's deliverable is a parity assertion rather than a count.

- `FB-A9-02`'s `OBS rehearsal` is the arithmetic refusal being **seen to fire**, not a unit test asserting it exists.

### 4.4 Applications — the member's own record — A12, A13

**A12 Watchlists & Lists** — 3 items

| id | EV | GAP | SZ·VER | DEP | REV | RSK | OBS |
|---|---|---|---|---|---|---|---|
| `FB-A12-01` | E2 cite | — | M·T1 | d1·b0 | R2 bundle | partial | yes |
| `FB-A12-02` | E2 cite | — | S·T2/T3 | d0·b1 | R3 none | undet | yes |
| `FB-A12-03` | E1 infer | — | S·T2/T3 | d0·b0 | R3 none | detected | yes |

- `FB-A12-02` is `RSK undet` on **PROD-C3** (no detector) and `REV R3` because the publication states a member-visible contract. ⭐ Item 16's position — that the publication is worth doing *even if no boundary moves* — survives the scoring intact, and the observable is unusually good: the matrix must change when a key's store changes, with no content edit.

- `FB-A12-01`'s observable is gated on a filing-watch parity test that must be **seen to fail before the change**; a parity test never seen red proves nothing (GATE-1).

**A13 Journal & Track Record** — 1 item

| id | EV | GAP | SZ·VER | DEP | REV | RSK | OBS |
|---|---|---|---|---|---|---|---|
| `FB-A13-01` | E1 infer | no-inc | XL·T0 | d1·b0 | R3 none | undet | yes |

- ⛔ `FB-A13-01` scores `EV E1`, and this is the single score in the file I most expect to be wrong — the trigger is ledger L8's *door* being NOT DETERMINED, which is **one of five lanes**, not the item's evidence. See §6.1.

- `SZ XL` + `REV R3` + `d1` behind `FB-D2-01` all hold, and together they restate item 16's H1 from the other side: the only uncontested differentiator in this evidence base sits behind the most expensive item on the board.

### 4.5 Intelligence — I1

**I1 Intelligence Layer** — 4 items

| id | EV | GAP | SZ·VER | DEP | REV | RSK | OBS |
|---|---|---|---|---|---|---|---|
| `FB-I1-01` | E2 cite | — | M·T2/T3 | d1·b1 | R2 bundle | partial | yes |
| `FB-I1-02` | E2 cite | — | L·T1 | d2·b0 | R2 bundle | partial | yes |
| `FB-I1-03` | E2 cite | contest | S·T1 | d0·b0 | R2 bundle | detected | yes |
| `FB-I1-04` | E1 infer | — | M·gated | d0·b0 | R2 bundle | undet | rehearsal |

- `FB-I1-04` scores `EV E1` on the same over-trigger shape as `FB-A13-01` (§6.1); PROD-C1 is called *"the corpus's most-corroborated finding"* and R-18 states the exposure independently. Its `OBS rehearsal` is right, though: a population cap must be **seen to fire**.

- `FB-I1-01` and `FB-S8-01` are two halves of one build and should be sequenced together. The rail already exists (`i1S8Boundary.test.js`, AST-derived forbidden vocabulary) and the instruction is to **extend its roots, not rewrite the section**.

### 4.6 Platform core — S3, S4, S5, S6, S7, S8, S9, S11

**S3 Entity Master** — 1 item

| id | EV | GAP | SZ·VER | DEP | REV | RSK | OBS |
|---|---|---|---|---|---|---|---|
| `FB-S3-01` | E2 cite | LARGE | L·T2/T3 | d0·b3 | R3 none | detected | yes |

- `FB-S3-01` is `d0·b3` but not startable as scored: one technical question is unanswered — whether Massive/FMP responses already carry a `figi` field — and *"a live API read would settle it."* ⭐ That is the cheapest unblock in the file and it is in §7.

- ⛔ `REV R3`, and it cannot be bought: CUSIP's terms prohibit maintaining a master file and no vendor publishes an entity master to license. What is being copied is Quartr's **published API discipline**, not anyone's schema.

**S4 Context Bus** — 2 items

| id | EV | GAP | SZ·VER | DEP | REV | RSK | OBS |
|---|---|---|---|---|---|---|---|
| `FB-S4-01` | E2 cite | — | M·T1 | d0·b0 | R2 bundle | detected | yes |
| `FB-S4-02` | E2 cite | — | S·T0 | d0·b2 | R2 bundle | undet | yes |

- `FB-S4-02`'s `SZ S` **is** the whole argument and must not be read as small work: *"**S** as an interface decision taken now; **L** as a retrofit later."* It is `RSK undet` because both **STATE-7** and **PERF-6** lack detectors.

- ⭐ `FB-S4-01` is the cheapest high-leverage platform item in the file — a typed channel over what best-of-breed calls *"the strongest existing asset for a terminal"*, at `M`, `d0`, `RSK detected`, `OBS yes`.

**S5 Persistence & User State** — 2 items

| id | EV | GAP | SZ·VER | DEP | REV | RSK | OBS |
|---|---|---|---|---|---|---|---|
| `FB-S5-01` | E2 cite | — | L·T2/T3 | d0·b4 | R3 none | undet | fixture-TBD |
| `FB-S5-02` | E2 cite | — | M·T1 | d1·b0 | R3 none | detected | yes |

- ⛔ `FB-S5-01` is `RSK undet` on **STATE-1/2/6** — §2.5 is the **only** anti-pattern family with zero working detectors (5 of 7 ⛔ NO, 2 🟡) — `OBS fixture-TBD` because both of its assertions currently fail, and `REV R3`. Item 16 refuses to let it be split, and that refusal *is* the item: the recorded failure mode is shipping the version-stamp bridge alone.

- `FB-S5-02` is **impossible** before `-01`, and PROD-C4's own detector is the product rather than a test: *"if a member can restore version N−1, the class is closed."*

**S6 Personalization** — 1 item

| id | EV | GAP | SZ·VER | DEP | REV | RSK | OBS |
|---|---|---|---|---|---|---|---|
| `FB-S6-01` | E2 cite | — | S·T1 | d1·b0 | R2 bundle | partial | yes |

- `FB-S6-01`'s **S** is the field's first token and is the weaker reading. Item 16 itself says **M if each must be derived**, *"and it must, which is the whole caveat"*, because PROD-6 binds: *"Prose cannot fail. A rail can."* §6.3 challenges the band rather than silently re-banding it.

**S7 Alerts & Monitoring** — 3 items

| id | EV | GAP | SZ·VER | DEP | REV | RSK | OBS |
|---|---|---|---|---|---|---|---|
| `FB-S7-01` | E2 cite | — | M/type·gated | d0·b2 | R2 bundle | detected | rehearsal |
| `FB-S7-02` | E1 infer | — | M·T0 | d3·b0 | R2 bundle | partial | yes |
| `FB-S7-03` | E3 meas | — | S·T1 | d0·b6 | R1 flag | none-named | yes |

- `FB-S7-01` carries `SZ M per type` — the band is per trigger type, and CARD 10 has already sequenced the next one (`catalyst-match`: 58 predicates, 58 verdict-ready, 80 agreed, zero `new_only` / `legacy_only` / `not_comparable`). ⛔ Its `OBS rehearsal` is the two ungated gates, and CARD 11's discipline binds the reporting: *"n is reported as n, always."*

- ⭐ `FB-S7-03` is `b6` — the second-highest in the file — at `S`, `d0`, `REV R1`. It is configuration rather than code, and item 25 §5 ranks it **before** the traffic that would mute the channel it fixes.

**S8 Provenance & Freshness** — 2 items

| id | EV | GAP | SZ·VER | DEP | REV | RSK | OBS |
|---|---|---|---|---|---|---|---|
| `FB-S8-01` | E2 cite | close | M·T0 | d0·b11 | R2 bundle | detected | yes |
| `FB-S8-02` | E2 cite | — | S·T0 | d1·b1 | R2 bundle | partial | yes |

- ⭐ `FB-S8-01` is the highest-leverage item in the file by a wide margin: **`b11`** (eleven items transitively behind it) at `M`, `d0`, `RSK detected`, `OBS yes`, `REV R2`. ⚰️ Its band is **M and not L** because two of its four primitives already ship — this is extraction plus a rail plus adoption, and F-01's PROD-C7 supplies the missing half: the primitives exist and *"nothing asserts that every panel uses them."*

- `FB-S8-02` is band 0: **S** as a constant plus a contract, blocked on what ARCH-07 §3 Q3 calls *"a product decision nobody has made"* and which is one sentence long.

**S9 Entitlements & Licensing Gate** — 4 items

| id | EV | GAP | SZ·VER | DEP | REV | RSK | OBS |
|---|---|---|---|---|---|---|---|
| `FB-S9-01` | E3 meas | — | S·T1 | d0·b2 | R2 bundle | undet | yes |
| `FB-S9-02` | E3 meas | — | M·T4/T6 | d1·b1 | R2 bundle | detected | yes |
| `FB-S9-03` | E2 cite | LARGE | M·T1 | d0·b1 | R2 bundle | partial | yes |
| `FB-S9-04` | E2 cite | — | S·gated | d0·b0 | R3 none | detected | fixture-TBD |

- `FB-S9-01` is `RSK undet` on **GATE-7**, which `anti-patterns.md` calls *"the sharpest 'no detector' in the library"*: the one instrument auditing the auth surface is structurally blind to the class it is supposed to cover. Its blocker is ownership (item 23), not evidence — DP-6 already rules the widening *"Engineering — no owner input needed."*

- `FB-S9-04` is `OBS fixture-TBD` for a reason worth keeping: a second toolkit value is **impossible to fixture today**, and *a lookup that cannot fail is not a lookup* (GATE-4).

**S11 Session & Market Clock** — 1 item

| id | EV | GAP | SZ·VER | DEP | REV | RSK | OBS |
|---|---|---|---|---|---|---|---|
| `FB-S11-01` | E2 cite | contest | S·T1 | d0·b0 | R2 bundle | partial | yes |

- `FB-S11-01` is the cheapest genuinely-new *system* in the file, and its observable is the only test that can catch the real failure: ⭐ **a rail that fails when the dataset's horizon falls below a stated number of months** — because a correct calendar and an expired one look identical on any single day. ⚠️ best-of-breed grades this row ◻ *not established for any product*, so there is no incumbent mechanism to copy and no incumbent to be behind.

### 4.7 Data platform — D1, D2, D3, D4, D5

**D1 Provider Abstraction** — 1 item

| id | EV | GAP | SZ·VER | DEP | REV | RSK | OBS |
|---|---|---|---|---|---|---|---|
| `FB-D1-01` | E2 cite | — | L·T0 | d0·b4 | R3 none | undet | yes |

- `FB-D1-01` is `RSK undet` + `REV R3` + `b4`. ⭐ `FB-A3-01` is its *named first proof case*, so the pattern is cheaper to establish there and apply here — a sequencing fact the dependency column cannot express, because `FB-A3-01` is `d0` and not a prerequisite.

**D2 Canonical Data Model & Metric Address Book** — 1 item

| id | EV | GAP | SZ·VER | DEP | REV | RSK | OBS |
|---|---|---|---|---|---|---|---|
| `FB-D2-01` | E2 cite | — | XL·T1 | d0·b5 | R3 none | undet | yes |

- ⛔ `FB-D2-01` is `XL`, `RSK undet`, `REV R3`, and **five items cannot land until it does**. It is the one item where every axis agrees it is simultaneously unavoidable and the most expensive thing on the board. ⭐ Its own first test is answerable today and costs nothing: *"pick the ten figures a desk answer most often states and confirm each has a stable id + as-of + inputs today."* **That test, not the system, is what should be scheduled first.**

**D3 Realtime Streaming** — 1 item

| id | EV | GAP | SZ·VER | DEP | REV | RSK | OBS |
|---|---|---|---|---|---|---|---|
| `FB-D3-01` | E2 cite | — | S·T0 | d1·b0 | R2 bundle | undet | yes |

- `FB-D3-01` is `RSK undet` on **PERF-6**, and the named trap is precise: an id makes a gap *detectable*, which creates a counter, which then needs a reader (`FB-OBS-02`). ⛔ Emitting ids without reading the gaps is instrumenting loss and not watching the instrument.

**D4 Caching & Serving** — 1 item

| id | EV | GAP | SZ·VER | DEP | REV | RSK | OBS |
|---|---|---|---|---|---|---|---|
| `FB-D4-01` | E2 cite | — | M·T4/T6 | d0·b1 | R2 bundle | undet | needs p95 |

- `FB-D4-01` is `OBS needs p95`: it is the cheapest route to CARD 16's gate **and** cannot be verified until `FB-OBS-01` exists. That circularity is real, it is not an artefact of my scoring, and it is why `FB-OBS-01` sits in band 1.

**D5 Reference & Corporate-Actions Data** — 2 items

| id | EV | GAP | SZ·VER | DEP | REV | RSK | OBS |
|---|---|---|---|---|---|---|---|
| `FB-D5-01` | E2 cite | — | S·T2/T3 | d1·b0 | R3 none | partial | yes |
| `FB-D5-02` | E3 meas | unclos | S·T0 | d0·b0 | R2 bundle | detected | yes |

- `FB-D5-01` **is** CARD 7's own re-open trigger (*"S8/S10 mounting the basis on a member surface"*), and CARD 7 already decided the copy — so the expensive half of this item is already paid for. ⚠️ CARD 5 bounds it: it must not create a ledger, only a policy field on values that are read.

- `FB-D5-02` is `E3` on OI-03's recorded **risk-acceptance** (D-004, not a licence), and is one of the few items whose target source is already the *least* licensing-exposed class in the Massive relationship.

### 4.8 Observability — all S12, collected because they read better together

**S12 — the observability set** — 9 items

| id | EV | GAP | SZ·VER | DEP | REV | RSK | OBS |
|---|---|---|---|---|---|---|---|
| `FB-OBS-01` | E3 meas | — | S·T4/T6 | d0·b1 | R2 bundle | undet | is the fix |
| `FB-OBS-02` | E3 meas | — | M·gated | d1·b1 | R2 bundle | undet | rehearsal |
| `FB-OBS-03` | E3 meas | — | L·T0 | d2·b1 | R2 bundle | partial | yes |
| `FB-OBS-04` | E3 meas | — | M·T0 | d1·b3 | R2 bundle | partial | yes |
| `FB-OBS-05` | E3 meas | — | S·T2/T3 | d1·b1 | R2 bundle | undet | yes |
| `FB-OBS-06` | E3 meas | — | M·T0 | d2·b1 | R2 bundle | detected | yes |
| `FB-OBS-07` | E3 meas | — | S·T1 | d0·b3 | R3 none | partial | yes |
| `FB-OBS-08` | E3 meas | — | S·T1 | d0·b0 | R1 flag | partial | yes |
| `FB-OBS-09` | E2 cite | — | M·T0 | d3·b0 | R2 bundle | detected | yes |

- ⭐ `FB-OBS-01` is `OBS is the fix` — the only item whose deliverable **is** the measurement other items' observables need. ARCH-07-OBS ranks it first and says *"The fix is small"*; its own control is stated: *"a fixture of 40 `stale-swr` samples must produce a p95 line, which today's code cannot."*

- `FB-OBS-03` and `FB-OBS-06` are `d2` and both inherit band 0's hold through `FB-OBS-07`; neither can produce an honest number until a quiet window is declared. `FB-OBS-03`'s `L` is load-bearing: the slope reader is M and **per-subsystem attribution is the hard half**, and without it the item has been instrumented rather than done.

- `FB-OBS-09` is `d3` and is not a feature — it is the shipping precondition over `FB-OBS-01`…`-06`, stated as one: *"every signal in §4.3 is an unproved guard until §4.6 is discharged — a precondition of shipping any of them, not a footnote."*

- ⛔ One thing is deliberately **absent** from this family and item 16 adopts the position rather than scoring it: anything that changes the deploy cadence. *"the fix for a counter a deploy destroys is to **move the counter**, never to deploy less"*, because ARCH-07 D9 re-scored frequent recycling as partly load-bearing against the leak.

### 4.9 The three proposed extension rows — X1, X2, X3

**X1 Collaboration & Publishing (proposed row)** — 2 items

| id | EV | GAP | SZ·VER | DEP | REV | RSK | OBS |
|---|---|---|---|---|---|---|---|
| `FB-X1-01` | E2 cite | — | M·T1 | d1·b0 | R3 none | undet | yes |
| `FB-X1-02` | E2 cite | — | M·gated | d0·b1 | R2 bundle | detected | rehearsal |

- `FB-X1-01` is band 0 on a **member-safety** decision, and it is `REV R3` in the strongest sense in the file: a member's losing call published beside their name cannot be un-published by a deploy.

- `FB-X1-02`'s deliverable is the **restore rehearsal**, not the schedule — *"a backup nobody has restored is not a backup"* — and ledger O5 records that **no leaf observed an R2 object landing** across roughly fifty unbacked databases. ⭐ It is a precondition of `FB-X1-01`, `FB-S5-01` and `FB-A13-01` by a simple argument: a versioned document is worth little in an unbacked store.

**X2 Data Egress & Programmatic Access (proposed row)** — 2 items

| id | EV | GAP | SZ·VER | DEP | REV | RSK | OBS |
|---|---|---|---|---|---|---|---|
| `FB-X2-01` | E2 cite | LARGE | S·T1 | d2·b0 | R2 bundle | partial | yes |
| `FB-X2-02` | E2 cite | LARGE | S·T4/T6 | d0·b0 | R3 none | detected | yes |

- `FB-X2-01` is `d2` behind `FB-S9-03` and `FB-S9-02`, and the source makes that a **hard gate, not a preference**: an egress surface over ~1,150 routes with no HTTP limit is a redistribution question rather than a feature.

- `FB-X2-02` is `REV R3` because rotation breaks live subscriptions, so **PROD-1** binds — a recovery path in the **same commit** — and F-01 records UCT paying for that class once already.

**X3 Learning & Onboarding (proposed row)** — 2 items

| id | EV | GAP | SZ·VER | DEP | REV | RSK | OBS |
|---|---|---|---|---|---|---|---|
| `FB-X3-01` | E2 cite | — | S·T1 | d0·b0 | R2 bundle | undet | yes |
| `FB-X3-02` | E2 cite | — | S-M·T2/T3 | d0·b0 | R2 bundle | undet | fixture-TBD |

- ⭐ `FB-X3-01` is the rare item whose observable exists **before** the feature: `page_views` already holds 4,949 rows, so a click-through from the wire sentence is measurable with no new instrumentation. ⚠️ It is `RSK undet` on PROD-C10 alone, and the change lands in a different repo's template because the wire is engine-side and PC-dependent.

- `FB-X3-02` is band 0 on the *"seeded or empty"* decision F-01 records as never made, and its `OBS fixture-TBD` is item 16's own classification. ⭐ The mechanism already ships (`charts_layouts` `scope=global`) and only the default is missing.

---

## 5. The resulting build order — six bands, and why bands rather than a ranking

⭐ **Bands are more honest than a total order here, and the reason is structural rather than modest.**
Five of the seven axes are ordinal with unequal and unknown steps — `L` is not "three `S`", `partial`
is not "half of `undet`", and `E2` is not "two thirds of `E3``" — so any 1-to-85 ranking would encode
arithmetic the axes cannot support, and a reader would then treat position 34 as meaningfully ahead of
position 35. **Within a band the order is not asserted.** Between bands it is, and the reason is
stated per band.

⛔ **The bands are produced by filters applied in a stated order, first match wins — never by summing
the columns.** The rule is reproducible from §4's table alone:

| band | membership rule, applied in this order |
|---|---|
| **0 HELD** | the item's own `Depends on` names a person, an owner, a vendor, a credential or an undecided product sentence as the blocker, **and the held thing is the deliverable** |
| **1 FLOOR** | the item's product is the ability to tell whether anything else worked — the eight observability/ops-channel items |
| **2 ENABLERS** | `d0` **and** `b ≥ 2`: nothing blocks it and at least two other items cannot land until it does |
| **3 CHEAP + CLEAR** | `d0` **and** `SZ S` **and** `REV ≠ R3` **and** `OBS yes` **and** `RSK ≠ undet` |
| **4 DEPENDENT** | `d ≥ 1` — becomes cheaper, and in two cases becomes possible at all, once a band-2 item lands |
| **5 THE REST** | `d0`, nothing else waits on it, and it fails at least one band-3 clause |

**Result: 10 · 8 · 8 · 10 · 26 · 23 = 85.**

### Band 0 — HELD (10). ⛔ Not builds. Free to unblock, and three of them block other bands.

`FB-S1-02` · `FB-A10-05` · `FB-A10-06` · `FB-A5-01` · `FB-A9-03` · `FB-S8-02` · `FB-OBS-07` ·
`FB-OBS-08` · `FB-X1-01` · `FB-X3-02`

⭐ **This band is first because it is the only band that costs nothing and unblocks other bands.**
Seven of the ten are a single sentence or a single act: choose a board-size number · ask Massive for a
second OPRA connection · rule extend-or-delete on Confluence Radar · rule superseded-or-not on the
Discord bot's earnings dates (OQ-14) · state the maximum age a panel may display without saying so ·
**declare a quiet measurement window** · read the Cloudflare rule. ⛔ `FB-OBS-07` is the one to take
first, because it gates `FB-OBS-03`, `FB-OBS-06` and `FB-S1-02`'s own panel curve, and because
ARCH-07 §2.5 measured why: *"Fourteen deploys in six and a half hours; median pod life 26 minutes"*,
and F-01 marks it ⛔ ACTIVE with the note *"it is a scheduling decision nobody has made."*
⚠️ Two of the ten are heavier than a sentence: `FB-X1-01` is a member-safety call and `FB-A9-03` is a
purchase.

### Band 1 — THE MEASUREMENT FLOOR (8). Nothing after this can be said to have worked.

`FB-S7-03` · `FB-OBS-01` · `FB-OBS-02` · `FB-OBS-03` · `FB-OBS-04` · `FB-OBS-05` · `FB-OBS-06` ·
`FB-OBS-09`

**Why it is second and not later.** Three of the seven axes in §4 are answers to *"could you tell?"*,
and for this band the honest answer today is no: CARD 16's only performance gate has no p95
(`FB-OBS-01`), the drop counters have no scheduled reader (`FB-OBS-02`), and — the one that hides
every other failure — **no signal has a cadence contract**, so per item 25's G-7 *"no alert since
Tuesday"* and *"the cron has not fired since Tuesday"* are currently the same observation
(`FB-OBS-04`). ⭐ **Order within this band is the one place I do assert a sequence, because item 25
already argued it:** `FB-S7-03` first (*"configuration, not code"*, and it must land **before** the
traffic that would mute the channel), then `FB-OBS-01` (*"The fix is small"*), then `FB-OBS-04`
(*"fourth and not later, because it is what makes items 3, 5 and 6 verifiable"*), then the rest, with
`FB-OBS-09` as the shipping gate over all of them. ⚠️ `FB-OBS-03` and `FB-OBS-06` inherit band 0's
hold through `FB-OBS-07` and cannot produce an honest number before it.

### Band 2 — THE ENABLERS (8). `d0`, and between two and eleven items each sit behind them.

| item | `b` | SZ | the reason it is an enabler |
|---|---|---|---|
| `FB-S8-01` | **11** | M | the shared provenance component set; two of its four primitives already exist |
| `FB-D2-01` | 5 | XL | the canonical model; `FB-A13-01` is *blocked entirely* on it |
| `FB-S5-01` | 4 | L | one versioned workspace document, refusing to be half-shipped |
| `FB-D1-01` | 4 | L | the Massive adapter and the licensing-class stamp |
| `FB-S3-01` | 3 | L | the entity master; *"the clearest infrastructure gap the research found"* |
| `FB-S4-02` | 2 | S | a panel declares a need, never a transport — **S now, L as a retrofit** |
| `FB-S7-01` | 2 | M/type | the remaining seven trigger types, authorized one at a time |
| `FB-S9-01` | 2 | S | make the auth-surface auditor see a GET, and publish its denominator |

⭐ **The two cheapest items in this band are the two most likely to be skipped**, and both are cheap
*only now*: `FB-S4-02` is an interface decision (**S** today, **L** as a retrofit once N panels
exist — that asymmetry is its entire argument), and `FB-S9-01` is *"a set literal, a loop, and a
printed denominator"* against the anti-pattern library's sharpest undetected entry.
⛔ **And the two most expensive are not optional.** `FB-D2-01` is `XL` and five items wait on it; but
its own first test is free and answerable today — *"pick the ten figures a desk answer most often
states and confirm each has a stable id + as-of + inputs today."* **Schedule that test, not the
system.** `FB-S5-01` carries the family with **zero working detectors**, and its named failure mode is
shipping the version-stamp bridge alone.

### Band 3 — CHEAP AND CLEAR (10). Everything a conventional matrix would have found, and only this.

`FB-S1-01` · `FB-A1-01` · `FB-A10-01` · `FB-A5-02` · `FB-A5-03` · `FB-A6-01` · `FB-A8-02` ·
`FB-I1-03` · `FB-S11-01` · `FB-D5-02`

**This is H1's residue: 29 items were `S` and `d0`, and these ten are what survives all five
clauses.** Every one is one surface or one constant, reversible on a deploy, with an observable that
is computable with what exists, and none walks into an anti-pattern nothing can detect.
⭐ Two deserve naming. `FB-A8-02` is the only item in the entire backlog with a **measured
member-facing cost already paid** — the idiom rendered *"No recent news for this ticker."* against
NVDA while the endpoint returned 15 KB — and F-01's detector field says outright that nothing detects
the six remaining sites. `FB-S11-01` is the cheapest genuinely-new *system* in the file, and it is a
greenfield rather than a catch-up: best-of-breed grades S11 ◻ **not established for any product**.
⚠️ `FB-I1-03` is `S` **as a document** and `M` **as four checks**, and item 16 is explicit that
written as a document alone it *is* PROD-6 by construction. Read its band as `M`.

### Band 4 — DEPENDENT (26). Two of these are impossible rather than merely blocked.

`d1` (19): `FB-S1-03` · `FB-S2-03` · `FB-S12-02` · `FB-A10-04` · `FB-A11-02` · `FB-A11-04` ·
`FB-A3-02` · `FB-A6-02` · `FB-A7-01` · `FB-A7-02` · `FB-A9-02` · `FB-A12-01` · `FB-A13-01` ·
`FB-I1-01` · `FB-S5-02` · `FB-S6-01` · `FB-S9-02` · `FB-D3-01` · `FB-D5-01`
`d2` (6): `FB-S2-04` · `FB-A8-03` · `FB-A9-01` · `FB-A11-03` · `FB-I1-02` · `FB-X2-01`
`d3` (1): `FB-S7-02`

⛔ **"Dependent" is not "deferred".** `FB-I1-01` should be sequenced *with* `FB-S8-01` rather than
after it — item 16 says they are two halves of one build — and `FB-A9-02` at `b3` is itself an
enabler that happens to sit one level down. ⚰️ **Two are impossible, not blocked:** `FB-S5-02` is
*"**impossible** before"* `FB-S5-01`, and `FB-A11-02` cannot have one vocabulary while two regime
authorities exist. ⭐ And one is the cheapest thing in the band by a distance: `FB-S2-04` is `S` once
`FB-S2-03` exists and `L` before it — the same now-or-never asymmetry as `FB-S4-02`.

### Band 5 — THE REST (23). `d0`, nothing waits on them, each fails a band-3 clause.

`FB-S2-01` · `FB-S2-02` · `FB-S10-01` · `FB-S10-02` · `FB-S10-03` · `FB-S12-01` · `FB-A10-02` ·
`FB-A10-03` · `FB-A11-01` · `FB-A3-01` · `FB-A4-01` · `FB-A5-04` · `FB-A8-01` · `FB-A12-02` ·
`FB-A12-03` · `FB-I1-04` · `FB-S4-01` · `FB-S9-03` · `FB-S9-04` · `FB-D4-01` · `FB-X1-02` ·
`FB-X2-02` · `FB-X3-01`

⛔ **Band 5 is not a rejection band and reading it as one would be the worst misuse of §5.** Fifteen
of the 23 fail band 3 on **size alone** (`M`, not `S`) — including `FB-S2-01`, the keyboard registry,
which best-of-breed calls *"the best-evidenced row in this file"*, and `FB-S4-01`, which the scoring
independently marks the cheapest high-leverage platform item in the estate. The other eight fail on
an axis that is a *statement about the programme*, not about the feature: `FB-A4-01` starts a
retention series item 37 has no tier for; `FB-D4-01`'s observable is the p95 that does not exist;
`FB-X1-02`'s observable is a restore rehearsal nobody has performed.
⭐ **If only one item leaves this band early, the argument for `FB-A4-01` is the strongest and it is
not about value:** a retention series cannot be backfilled, so **every night not retained is
permanently lost**. It is the one item in the file whose cost of delay is strictly monotonic.

---

## 6. ⛔ The items whose score is most likely to be wrong — and the input that would change each

⭐ **This is the most useful section in a scoring document and skipping it to look confident is the
failure mode.** Each entry names the cell, why I distrust it, and the single input that settles it.

### 6.1 Four `EV E1` cells where the trigger attached to a sub-fact, not to the item's evidence

The `EV` rule is mechanical and I am keeping its output rather than silently overriding it — but I
believe it **understates** four items, and the shape of the error is the same in all four: the
weakness marker sits on one sub-clause of the provenance while the item's core claim is strongly
evidenced.

| item | the marker that fired | why I think it is wrong | input that settles it |
|---|---|---|---|
| `FB-A13-01` | ledger L8's door *"is NOT DETERMINED"* | that is **one of five lanes**; the item itself is best-of-breed §1 H3(b) (⌀ no incumbent across fifteen products), §6.1 item 4, and the capability matrix's *"single most consequential normalization item in this entire matrix"* | one read confirming whether `ticker_mentions` has a reachable door; the other four lanes are unaffected |
| `FB-I1-04` | ARCH-05 constraint 15 is 🟡; *"actual monthly spend NOT DETERMINED"* | PROD-C1 is called *"the corpus's most-corroborated finding"* and **R-18 states the exposure independently** (~$610–650/member/month against a $200 list price) | **OI-10** — and note the spend being undetermined is the *item's subject*, not a weakness in its evidence |
| `FB-S12-01` | CP-08's 🟡 confidence glyph | ledger **P6** is the ledger's only `absent · absent` row and ledger O8 measures the alternative (maintenance mode, *"resets on every redeploy (several/day)"*) | nothing — this is a misread of a critical-path glyph as an evidence grade, and I would set it `E2` |
| `FB-A10-05` | *"No artifact records it being requested"* / *"never requested"* | those describe the **action** nobody took, not the evidence for the gap; the gap is ARCH-07 Q9 plus ledger F8's TD-32 | nothing — I would set it `E2`; the item stays in band 0 regardless, because its blocker is a person |

⚠️ **I found this class because I found a worse one first, in my own tooling.** My field extractor
let the **last** item in item 16 (`FB-X3-02`) absorb the 10,003 characters that follow it — §4's
not-list, §5 and part of §6 — because its body ran to end-of-file. That contamination produced a
wrong `EV E1` and a wrong `VER` for that item, and five spurious `GAP contest` cells elsewhere from
an over-broad `§4` pattern. All were corrected by re-deriving every column from a bounded extraction
and diffing; **the diff is in GAPS 3 with its exact deltas.** ⛔ *Twice now an instrument in this
programme has manufactured a finding; the only reason this one did not ship is that `E1` on the H1
item looked wrong enough to check.*

### 6.2 Three size bands I would challenge, per item 16's own instruction

Item 16's GAPS 7 says to treat every band as an input to be challenged. Three are worth challenging:

1. **`FB-S6-01` — `S` should read `M`.** Item 16's own field says *"**S** — three publications. ⛔
   **M if each must be derived**, and it must, which is the whole caveat."* The scoring carried the
   first token. **Input that settles it:** none needed; the field already contains the answer.
2. **`FB-I1-03` — `S` should read `M`.** *"**S** as a document, **M** as four checks. ⛔ Written as a
   document alone it is **PROD-6** by construction."* Its band-3 membership rests on the weaker
   reading.
3. **`FB-A10-03` — `S?` is unresolvable and the band is the wrong shape for it.** Item 16 splits it
   *"**S to diagnose**… **Unknown to fix**"*, and the fix routes through a partner-owned file. ⭐ **And
   my banding disagrees with item 16 here, which is worth saying plainly:** item 16 calls it *"the
   single most **actionable** thing this run found"* and *"does not need any further research to act
   on"*, while my filters put it in band 5 — because its `SZ` is ambiguous and its `OBS` is CARD 16's
   unmeasurable gate. ⛔ **Both can be true, and the resolution is that "diagnose" and "fix" are two
   items wearing one id.** The diagnosis is `S`, `d0`, needs no gate, and belongs in band 3;
   the fix is unsized and gated on a partner boundary. **Input that settles it:** split the id, which
   is item 16's call and not mine.

### 6.3 The whole `REV` column, and it is the axis I trust least

⛔ `R3` is **not a score item 37 assigns** — it is my label for the 22 items item 37 has no tier for
(§1 H2). Two consequences a later reader must not lose: **(a)** the column cannot distinguish "hard
to reverse" from "item 37 simply has not written this down yet", and those are very different facts;
**(b)** a single addition to item 37 — a migration/retention tier — would re-score 22 cells at once
and could move items between bands 3 and 5. ⚠️ And the 63 items that *do* have a tier have an
**unexercised** one: item 37's GAPS 8, *"A tier nobody has pulled in anger is a procedure, not a
capability."* **Input that settles it:** item 37 adding the missing tier, plus one rehearsed
rollback.

### 6.4 Three columns that should exist and do not, because no artefact supplies them

- ⛔ **Rights.** `FB-A6-02` is bounded by FMP transcript-AI rights being U-class, and best-of-breed
  says *"a rights gap does not yield to engineering."* Nothing in §4 encodes that, so `FB-A6-02`
  scores like an ordinary `M`. **Input:** `licensing-register.md`, which item 16's GAPS 4 records as
  unread by item 16 *and* by me, and which F-01 says *"almost certainly holds redistribution-shaped
  product anti-patterns."* Three items touch egress or publication without it (`FB-X1-01`,
  `FB-X2-01`, `FB-X2-02`).
- ⛔ **Member safety.** `FB-X1-01` publishes a member's losing call beside their name. That is not a
  size, a risk tier or a reversibility class; it is a different kind of question, and the nearest
  recorded posture is OI-15's *"no member display until answered"* about a different corpus.
- ⛔ **Cost.** §2. Absent by construction, and the one rule that survives (OI-20's escalation on any
  new per-member line) applies to zero items here.

### 6.5 The `DEP` column's 25 readings, and a note for item 29

`DEP` required reading 25 of item 16's cross-references to decide direction and hardness (§3.4).
⛔ **Every one of those 25 is a place my graph could differ from item 29's**, and the two documents
will be compared. The specific hazard is in §1's ⚠️: item 16's `Depends on` field carries both
arrow directions, so a naive extraction yields cycles and depth 10 against a corrected depth of 3.
**Input that settles it:** item 16 splitting that field into `Depends on` and `Depended on by`, which
would make both graphs derivable rather than read.

### 6.6 The `GAP` column is a hole for 60 items, and `RSK` is the only column with no judgement in it

`GAP` places 25 of 85 (§1 H3). ⛔ Reading `—` as "no gap" would be the exact misuse best-of-breed
forbids. **Input:** item 9, the Cross-Product Capability Matrix, which does not exist —
best-of-breed's own GAPS 2 says *"A best-of-breed verdict properly sits on top of a per-product
cross-tab"* and *"if item 9 lands and disagrees with a row here, item 9 wins on inventory."*
⭐ Conversely `RSK` is the one column I would defend without qualification, because both halves are
another artefact's own field: the entries come from item 16's `Anti-pattern risked`, the detector
class from `anti-patterns.md`'s per-entry `**Detector.**` verdict. **The seven items that are both
`RSK undet` and `REV R3` are the file's danger set** — nothing detects the defect they walk into and
nothing takes them back: `FB-A8-01` · `FB-A12-02` · `FB-A13-01` · `FB-S5-01` · `FB-D1-01` ·
`FB-D2-01` · `FB-X1-01`. ⛔ **Four of those are band-2 enablers or the XL items, so the answer is not
to avoid them — it is that each needs a detector built in the same change.**

### 6.7 How many scores are judgement rather than cited

**Three columns carry no judgement of mine:** `SZ` (item 16's own field, verbatim), `RSK` (item 16's
field joined to `anti-patterns.md`'s own verdicts), `GAP` (the best-of-breed section each item's own
Provenance cites). **Five carry it, and here it is counted rather than characterised:**

| where | hand-assigned cells | what the judgement is |
|---|---|---|
| `REV` | **26** of 85 | the 4 `R1` and 22 `R3` memberships; the other 59 are the residual |
| `DEP` | **25** cross-references | direction and hardness readings of prose |
| `SZ` | **3** of 85 | the cells where item 16 gives two bands and I recorded one (`FB-A10-03`, `FB-S7-01`, `FB-X3-02`) |
| `EV` | 0 cells, **1 rule** | which four artefacts count as instruments — applied mechanically to 85 |
| `VER` | 0 cells, **1 rule** | the keyword map onto item 36's T0–T7 ladder — applied mechanically to 85 |

**54 hand-assigned cells out of 680 (85 items × 8 columns) = 7.9%**, plus two whole-column rules that
are mine and are declared in §3.1 and §3.3. **The band assignment itself is a further judgement:**
band 0's ten memberships and band 1's eight are named lists, not filter output, and bands 2–5 are
mechanical from the columns.

---

## 7. What would re-run this — the specific arrivals that invalidate the order

⛔ **Not "when new information appears".** These are named inputs with named effects. ⭐ The first
three cost a sentence each and two of them come from the same conversation.

| # | arrival | what it re-runs | cost to obtain |
|---|---|---|---|
| 1 | **A declared quiet measurement window** (`FB-OBS-07`, F-01 ⛔ ACTIVE) | releases `FB-OBS-03`, `FB-OBS-06` and `FB-S1-02`'s panel curve from band 0; makes CARD 18's condition reachable | a scheduling decision |
| 2 | **The maximum age a panel may display without saying so** (ARCH-07 §3 Q3 / `FB-S8-02`) | moves `FB-S8-02` to band 3 and unblocks `FB-A11-03` at `d2` | one sentence |
| 3 | **A `figi` read against Massive/FMP** | tells `FB-S3-01` whether the entity master has a free external mapping already in its responses; `b3` sits behind it | one authenticated API call |
| 4 | ⛔ **OI-10 — the spend baseline and the AI-lane ceiling** | **creates the value axis this file refuses to invent.** Re-runs every band, and specifically re-scores `FB-I1-04`, `FB-A10-04`, `FB-D4-01` and every AI-bearing item | an owner answer |
| 5 | ⛔ **CARD 17's three leftovers — price, trial, seat model** | does **not** re-introduce a tier axis (CARD 17 forecloses that permanently), but it does make "which page is free" decidable, which is the only acquisition lever left and is where `FB-X3-01` lands | an owner decision, no OI id |
| 6 | **OI-01 — member count, tier mix, conversion trend** | supplies the first demand-adjacent number in the programme; would let any item be divided by an affected population, which no column here can do | an owner answer |
| 7 | **OI-09's ESC-05 / ESC-14** (written answers from Massive on OPRA display and member-configured server-side alerting) | could move the whole S7 family from "build" to "escalate" — the non-display bucket carries $2,000/mo CTA + $2,000/mo OPRA fixed fees. **Re-runs band 2's `FB-S7-01` and band 4's `FB-A12-01`, `FB-S7-02`** | a vendor answer; not owner-answerable |
| 8 | **Item 37 gaining a migration/retention tier** | re-scores 22 `REV R3` cells at once and can move items between bands 3 and 5 (§6.3) | an edit to item 37 |
| 9 | **Item 9, the Cross-Product Capability Matrix** | re-runs `GAP` for up to 60 items, and best-of-breed has already conceded precedence: *"item 9 wins on inventory"* | a gate item that has not started |
| 10 | **Item 15's proprietary-advantage synthesis** | item 16 flags this itself: *"If item 15 lands and ranks the assets differently, `FB-A13-01`'s standing changes and this file does not know it"* | a gate item at NOT STARTED |
| 11 | **A refreshed `capability-ledger.md`** (currently 2026-09-02, with four cells already superseded in the four places item 16 checked) | could remove items outright by revealing something already shipped. ⛔ Item 16 calls a refresh *"the single highest-value input this file could have had and does not"* — and that applies identically here | a re-measurement pass |
| 12 | **Any owner authorization of an S7 trigger type** (per-type, CARD 10 already prefers `catalyst-match`) | converts `FB-S7-01` from a band-2 enabler with a gated observable into a scheduled increment | an owner ruling per type |

⚠️ **Two arrivals that would NOT re-run this order**, stated so nobody waits for them: **OI-08** (a
Bloomberg seat) and **OI-18** (Gödel's 14-day trial) raise the *evidence ceiling* on dossiers and
change benchmark credibility, not sequence. And **CARD 13**'s desk-observed morning is explicitly not
a blocker: *"Nothing on the critical path has to wait for this lock."*

---

## GAPS

1. ⛔⛔ **THE LARGEST, AND IT IS THREE CORRECTIONS TO MY OWN BRIEF.** My dispatch attributed to
   `CRITICAL_PATH.md` a statement that *"there is no cost input, no revenue input and no
   member-demand input anywhere in this programme."* A delegated read of all 29 of its lines found
   **"revenue" appears zero times, "demand" appears zero times**, and cost appears only as a blocked
   artefact. §2 cites OI-10, OI-01, CARD 17, CARD 13 and CARD 11 instead. Two further corrections of
   the same shape: **"the binding one" appears nowhere in ARCH-07** (zero grep matches — the
   structural equivalent is §6 item 1, *"The target panel count (Q1)… it blocks D4 and D10"*), and
   **ARCH-07 has no §6.1** (§6 is a flat list of 8; the nearest headed subsection is §5.1).
   ⭐ All three were caught by delegated agents checking the brief against the file rather than
   answering from it, which is the only reason they are here rather than quoted.
2. ⚠️ **`DEP` rests on 25 readings of prose, not on a machine-readable field.** §6.5. The corrected
   graph has no cycles and a maximum depth of 3; the naive one has cycles and depth 10. **Item 29 is
   reading the same field right now and may differ.**
3. ⚰️ **My own extractor contaminated one item and I am recording the exact deltas.** `FB-X3-02`'s
   body ran to end-of-file and absorbed 10,003 characters of §4/§5. Re-deriving every column from a
   bounded extraction changed **9 cells**: `FB-X3-02` `EV E1→E2` and `VER T0→T2/T3`; five spurious
   `GAP contest→—` (`FB-S9-01`, `FB-S9-02`, `FB-OBS-04`, `FB-OBS-07`, `FB-OBS-09` — an over-broad
   `§4` pattern matching *ARCH-07's* §4 rather than best-of-breed's); `FB-OBS-06` `OBS p95→yes`;
   `FB-OBS-09` `OBS rehearsal→yes`. ⛔ **Every number in this file is from the corrected run.** The
   pre-correction run would have reported `GAP` placing 30 items rather than 25.
4. ⚠️ **My `OBS` column uses item 16's six incomplete observables and not my own fifteen.** A looser
   sweep of the `Known it worked` field flags nine more — `FB-A11-03`, `FB-A5-03`, `FB-A6-02`,
   `FB-A8-01`, `FB-A13-01`, `FB-S4-02`, `FB-S6-01`, `FB-S9-03`, `FB-X2-01` — mostly on the word
   "cannot" used in other senses. I did **not** promote that into a number (§3.7); a later reader
   should promote individual items deliberately. Item 16's own figure is *"a floor, not a census"* and
   mine inherits that.
5. ⛔ **No detector was run and no rollback was rehearsed, so `RSK` and `REV` are both claims about
   artefacts.** `anti-patterns.md` states the first about itself; item 37's GAPS 8 states the second.
   A `detected` cell means *a named rail exists in a cited artefact*, never that it passes today.
6. ⚠️ **`anti-patterns.md` contains two disagreeing count tables and I used one.** The per-entry
   `**Detector.**` tally is 31/14/20; the index table's columns sum to 32/16/17, understating the
   ⛔ NO population by three (§2.2 INST, §2.5 STATE, §2.8 PROD-C each off by one). ⚰️ *A hand-typed
   count beside the artefact that owns it, in the document that ranks DOC-1 first.* **That file owns
   the reconciliation, not this one.**
7. ⚠️ **No item was estimated, scoped or reviewed by anyone, here or in item 16.** The `SZ` column is
   carried and challenged; the `VER` column is a mapping of mine onto item 36's ladder. ⛔ Neither is
   an estimate and neither may be multiplied into one.
8. ⚠️ **Five documents named in my inputs' own inputs were read by nobody in this chain:**
   `command-grammars.md`, `information-architecture.md`, `personalization-patterns.md`,
   `data-architecture.md`, `licensing-register.md`. The last is the one that bites — §6.4.
9. ⚠️ **Items 24, 25, 36, 37, 10, 11 and the cards were read by delegated read-only agents, not by
   me.** Their reports carried verbatim quotes and section anchors and I used those; I opened none of
   those seven files directly. Three of their corrections are GAPS 1.
10. ⚠️ **Band 0 and band 1 memberships are named lists, not filter output** (§6.7). Bands 2–5 are
    mechanical from §4's columns; bands 0 and 1 are my reading of which items are held and which
    constitute the floor.
11. ⚠️ **`11-risks-and-open-questions/` is still empty** (`.gitkeep`, 0 bytes), as item 16 recorded.
    So the risks reaching this file are `RISK_REGISTER.md`'s and `anti-patterns.md`'s only.
12. ⚠️ **No SHA is pinned — SHA not pinned (no git by instruction).** Every claim is a claim about a
    worktree on 2026-09-26, and item 16's GAPS 1 plus ARCH-07-OBS §1 both record citation addresses
    drifting within days. ⛔ Grep the quoted string, never trust a line number carried here.
13. ⚠️ **The gate-number conflict is inherited and unreconciled.** The dispatch says gate item 17;
    `MASTER_CHECKLIST.md`'s Gate column reads 13 for both items 16 and 17. A second authority over
    one value already exists, the checklist owns it, and neither this file nor item 16 resolves it.

---

## SOURCES

All inputs are internal programme artefacts under
`C:\Users\Patrick\uct-worktrees\terminal-research\docs\terminal-research\`, read **2026-09-26**.
⛔ No network request, no production call, no git command, no test, no script against the repo, no
browser. Cited inline by file and section anchor throughout.

**Primary — the input this file scores:**
`05-product-strategy/feature-opportunity-backlog.md` (F-05-BACKLOG, item 16) — read in full, 1,540
lines. Every item's **Statement**, **Row**, **Provenance**, **Today**, **Mechanism**, **Size**,
**Depends on**, **Anti-pattern risked** and **Known it worked** field was extracted by a bounded
regex over its own `#### FB-*` headings and is the substrate of §4. Its §1 H1–H3, §2.1–§2.6, §3.1–
§3.9, §4's 22-row not-list, §5's thin-coverage taxonomy, §6's appendix and GAPS 1–11 are all used.

**The axis sources, one per axis:**
`05-product-strategy/capability-matrix/best-of-breed.md` (F-05, item 10) — the **GAP** axis: §0's
marker legend (⌀ / ✖ / ◻ / ⊘ and the rule that ✖ and ◻ are never collapsed), §1 H1/H2/H3, §3.3/§3.4/
§3.6, §4.1–§4.9, §5's three conclusions, §6.1, §6.2 and its three unclosable gaps, GAPS 1–9, and
"What this document does NOT decide" 1–10 ·
`05-product-strategy/anti-patterns.md` (F-01, item 11) — the **RSK** axis: the 65-entry roster across
nine families, every per-entry `**Detector.**` verdict (31 ✅ / 14 🟡 / 20 ⛔), §0's probability
ranking, §1's seven-field entry shape, §3, §4's 17 exposure rows, §5, §6's appendix, GAPS ·
`10-roadmap/rollout-rollback.md` (H-07, item 37) — the **REV** axis: §1.2's polarity rule, §1.4's six
tiers and their non-monotonic ordering, §1.5's no-rebuild-never-no-redeploy ruling, §2's reach table,
§3's decision table, §4, GAPS 1–8 ·
`10-roadmap/observability-plan.md` (ARCH-07-OBS, item 25) — the **OBS** axis: §0's three findings,
§2.2's read-side census, G-1…G-10, §4.2's cumulative-versus-distributional tiering rule, §4.5, §4.6's
four proof methods, §4.7's `as_of` contract, §4.8, §5's ordering, GAPS 1–9 ·
`10-roadmap/testing-plan.md` (H-06, item 36) — the **VER** half of the size axis: §2's T0–T7 ladder,
§3's C-1…C-12 per-rail contract, §4.4's disturbance-interval arithmetic, GAPS ·
`07-technical-architecture/realtime-performance-architecture.md` (ARCH-07, item 24) — §2.2's leak
measurement, §2.5's deploy cadence, §3 Q1–Q10, §4 D1–D10, §5.1–§5.3, §6's eight non-decisions, GAPS.

**Control and decisions:**
`00-program-control/CRITICAL_PATH.md` (CP-01…CP-12) · `00-program-control/OWNER_INPUTS_REQUESTED.md`
(OI-01…OI-21, incl. OI-01, OI-04, OI-05, OI-09, OI-10, OI-15, OI-20, OI-21) ·
`12-decisions/DECISION_CARDS_2026-09-26.md` (CARDS 9, 10, 11, 12, 13, 15, 16, **17**, 18, 20, 21) ·
`12-decisions/DECISION_CARDS_2026-09-25.md` (CARDS 1–8) · `00-program-control/MASTER_CHECKLIST.md`
rows 15–17 (the gate-number conflict) · `00-program-control/RISK_REGISTER.md` R-17, R-18.

⚠️ **Four delegated read-only agents were used**, and what each was for is stated because their
reports are the only reading of those files in this chain: (1) best-of-breed, for the GAP vocabulary;
(2) `anti-patterns.md`, for the per-entry detector verdicts; (3) items 24/25/37, for the rollback
tiers and the unmeasurable gate; (4) item 36 plus CRITICAL_PATH, OWNER_INPUTS and both card files.
⛔ Three of their findings are corrections to my own brief and are GAPS 1.
⛔ `10-roadmap/dependency-graph.md` and `10-roadmap/success-metrics.md` were **not opened by me or by
any agent in this chain** — two other sessions own them — and
`05-product-strategy/feature-opportunity-backlog.md` was read and never edited.

**Derivations this file ran** (read-only, over item 16's text and over its own output; each is stated
where its number appears): the `#### FB-*` heading sweep for the roster (§3.0); the per-field bounded
extraction; the hard-prerequisite graph and its depth/blocks counts (§3.4); the detector join (§3.6);
the band filters (§5); and the diff of the corrected run against the contaminated one (GAPS 3).

---

## ⛔ What this document does NOT decide

1. ⛔⛔ **It does not pick an MVP. That is item 27.** No band in §5 is a release, no band boundary is
   a scope line, and band 3 is not a v1. An MVP is a claim about what a member needs first, and §2 is
   the statement that this programme holds no input capable of supporting that claim.
2. ⛔⛔ **It does not write the roadmap. That is item 28.** A band is not a sprint, a phase or a
   quarter. ⛔ There is no date anywhere in §5 and the absence is deliberate: item 16's size bands are
   *"never a number of days"* and nothing here converts them into one.
3. ⛔ **It does not own the dependency graph. That is item 29.** §3.4's graph exists only to produce
   the `DEP` column, it was derived from item 16's prose rather than from a machine-readable field,
   and §6.5 says where the two may differ. **If item 29 disagrees, item 29 owns the edges.**
4. ⛔ **It asserts no value, no ROI, no revenue impact and no member demand for any item** — §2, and
   it is the reason §2 is second rather than an appendix.
5. ⛔ **It does not estimate effort.** `SZ` is item 16's claim about *shape*, carried forward and
   challenged in three places; `VER` is a verification-cost tier, not a duration. Neither is days.
6. ⛔ **It does not authorise any work.** Every item remains a candidate. Band 2's `FB-S7-01` still
   needs per-type owner authorization; band 0's ten items need a person; `FB-S9-01`'s ownership is
   item 23's.
7. ⛔ **It does not re-open CARD 17, and it introduces no tier axis** — §2. Where a source axis was
   tier-shaped it is collapsed to a binary, per CARD 17's own instruction, not deleted.
8. ⛔ **It does not add, remove, rename or merge a single backlog item.** All 85 are item 16's, with
   item 16's ids. Where I think an item is two items wearing one id (`FB-A10-03`, §6.2) that is
   recorded as a challenge and **the split is item 16's call.** Item 16's three appendix items (A-1,
   A-2, A-3) are **not** scored, because promoting one is meant to be a visible act.
9. ⛔ **It does not change the capability taxonomy.** `capability-infrastructure-matrix.md` §0 owns
   the 33 rows; the X1–X3 items are scored as candidates against **proposed** rows, and adopting one
   means editing that file. The mobile row item 16's §5 says is missing is still missing, and no item
   here hangs on it.
10. ⛔ **It resolves no owner-bound or PROVISIONAL question and closes no risk.** Named where they
    bite: OI-01, OI-04, OI-05, OI-09, OI-10, OI-15, OI-20, OQ-14, P-δ, D1, D8, D9, CARD 17's three
    leftovers, and R-17 — which ARCH-06 owns and explicitly declines to close.
11. ⛔ **It does not add a rollback tier to item 37, reconcile that file's two count tables, or split
    item 16's `Depends on` field** — the three edits §6 argues for. Each belongs to the file that
    owns it, and doing any of them here would create the second-authority-over-one-value defect this
    programme keeps paying for.
12. ⛔ **It says nothing about the running service.** Nothing was probed, no detector was run, no
    rollback was rehearsed, and no source file was opened. Every score is a claim about a set of
    artefacts on 2026-09-26, and item 16's §2.4 is four demonstrations that such claims decay in days.
