---
id: H-04
title: Technical Dependency Graph — what must be built before what, why, and which chains can actually run in parallel
role: >
  The dependency-graph deliverable. MASTER_CHECKLIST item 29
  (`10-roadmap/dependency-graph.md`, owner H-04, status NOT STARTED before this file).
  Two graphs in one document: the dependency graph (edges are "X cannot ship before Y") and
  the parallel build graph (which chains are disjoint, and what the concurrency ceiling
  actually is). ⛔ It does NOT sequence work in time (item 28) and does NOT choose scope
  (item 27).
wave: 4
group: H
category: roadmap
inputs: >
  `05-product-strategy/feature-opportunity-backlog.md` (item 16, 85 `FB-*` items — **its own
  `Depends on` field is the primary edge source, read rather than re-derived; every
  disagreement is recorded in §7**) ·
  `07-technical-architecture/realtime-performance-architecture.md` (item 24 — D1–D10, the ten
  questions with ANSWERED/NARROWED/OPEN labels, §5.1's ordering ruling) ·
  `09-security-licensing-cost/security-entitlement-architecture.md` (item 23 — three
  enforcement points, the five-rung ladder, DP-1…DP-8, the auditor's mutating-only aperture) ·
  `08-ai/ai-architecture.md` (item 22 — the shipped grounding contract and what generalising
  it depends on) ·
  `10-roadmap/observability-plan.md` (item 25 — the measurement floor, G-1…G-10, OBS-1…OBS-9) ·
  `10-roadmap/rollout-rollback.md` (item 37 §4's thirteen pre-stage-one prerequisites, RB-1…RB-11) ·
  `01-existing-system/capability-ledger.md` (§R's derived counts and the PC-dependent set) ·
  `05-product-strategy/capability-infrastructure-matrix.md` (the 33-row spine; every FB row
  letter is one of its rows) ·
  `00-program-control/CRITICAL_PATH.md` (CP-01…CP-12) ·
  `12-decisions/DECISION_CARDS_2026-09-26.md` (CARD 15, 16, 17, 18) ·
  `C:\Users\Patrick\uct-worktrees\_merge-master\CLAUDE.md` (READ-ONLY — the measured
  concurrency constraints in §5.2, nothing else).
scope: >
  Read-only. ⛔ NO git command of any kind was run (another session owns the commit) —
  **SHA not pinned (no git by instruction)**. No network request, no `curl`, no `railway`
  command, no production call, no test, no script against the repo. `_merge-master` was read
  read-only and never written. One file was written: this one. The only computation performed
  was arithmetic over **this document's own edge list** (§3.1 states the method), which is
  counting my own output, not measuring the product.
confidence: >
  🟢 on every edge whose justification cites the backlog's own `Depends on` field — that field
  is quoted, not inferred. 🟢 on the node and edge counts, because they are derived from the
  table below rather than typed beside it (§3.1). 🟡 on the twelve edges this document ADDS
  from the four architecture documents, each flagged `+H-04` in the table: they are readings of
  a cited ruling, and a reading can be wrong in a way a quotation cannot. 🟡 on the four
  chain assignments in §5.1 — a chain is a judgement about which files a lane touches, and no
  file was opened by this document. 🔴 on anything about the running service, and 🔴 on
  effort: **no size band here is mine** — every one is carried from item 16 and item 16's own
  frontmatter calls a band "a judgement about shape, not a measurement".
evidence_ceiling: >
  ⛔ THE CEILING THAT DECIDES HOW TO READ THIS: **this document opened no file under `api/**`
  or `app/**`, and resolved no `file:line` of its own.** Every code address is carried at one
  or two removes — item 16 already inherits item 24/25's addresses, and item 25 §1 records two
  artifacts citing `api/main.py:3639-3644` for a comment that sits at `:4510`. So an address
  here is *where the citing document found the thing*, on its stated date. SECOND CEILING:
  **an edge is an ordering claim, never a duration claim.** Nothing below was scheduled,
  costed or estimated. THIRD CEILING: **the concurrency numbers in §5.2 are measured, but they
  were measured on incidents, not on a build of this product** — they bound any plan and they
  do not predict one. FOURTH CEILING: the graph is only as complete as item 16's roster; §7
  names four architecture requirements that have hard prerequisites here and **no backlog
  item at all**, so absence from the table means unexamined, never independent.
status: draft
date: 2026-09-26
---

# Technical Dependency Graph (H-04)

## 1. Headline — the three orderings that matter most

**H1. ⭐⭐ Fix the leak before choosing a process topology, and never by deploying less.**
Item 24 §5.1 is the sharpest ordering ruling in the programme and it is stated as a single
sentence: *"'give the terminal its own long-lived process' and 'the long-lived process is the
problem' are the same sentence."* The web pod grows **+7.9 MB/min, monotonic across quartiles,
76 `[mem]` samples over 104 minutes** (item 24 §2.2), so `DEC-TOPOLOGY` — item 24's Q7 — sits
downstream of a measurement, not of a design. ⛔ And the obvious remedy is forbidden: item 24
§4 D9 re-scored frequent recycling as **partly load-bearing against the leak** (a 26-minute
median pod life is what keeps RSS near 2.4 GB instead of near 11 GB), so item 25 §4.2(3) rules
that the fix for a counter a deploy destroys is **to move the counter, never to deploy less**.
The chain is `FB-S7-03 → FB-OBS-04 → FB-OBS-03 → DEC-TOPOLOGY`, and every edge on it is a
`meas` or a `code` edge, not a decision waiting on a person.

**H2. The measurement floor is the earliest node on this graph, not a late one.**
`FB-OBS-01` makes CARD 16's replacement gate evaluable at all: today
`tools/bars_warmth_audit.py` still classes `stale-swr` as COLD while CARD 16 ruled it SERVED,
so on daily — 100 % `stale-swr` since 2026-08-19 — the p95 set is empty and **no p95 prints**
(item 25 §0 finding 3, G-2, with its control). Item 16's own H3 records that **four of its
"how you would know it worked" fields are currently unanswerable for measurement reasons
alone**. ⭐ This is why §6 ranks `FB-OBS-01` by a different quantity than everything else: it
blocks almost nothing from being *built* and it blocks a large share of the graph from being
*believed*. §2.3 explains why that is deliberately not modelled as twenty fanned-out edges.

**H3. ⛔ COUNTER-INTUITIVE, and the one most likely to be got wrong: the rail goes before the
fix, the backup goes before the versioning, and the channel split goes before the monitors.**
Three edges invert what an engineer would naturally do first.

- **`FB-S9-02` cannot ship before `FB-S9-01`** — close the six dependency-less route families
  only *after* the auth-surface auditor can see a GET. Item 23 §2.2 has the measurement that
  makes this non-negotiable: the GEX family was remediated once, recurred, was remediated
  again at `/api/gex/data` — and `/api/gex/compare`, **four lines below it in the same file**,
  is still open. *"A class that recurs after remediation is not a bug that needs fixing again;
  it is a missing check."* Doing the four fixes first produces a state that looks finished and
  is not.
- **`FB-S5-01` cannot ship before `FB-X1-02`** — the versioned workspace document looks like
  the safety feature; it is not, in a store with no backup. Item 16's `FB-X1-02` field states
  it in six words: *"a versioned document is worth little in an unbacked store."*
- **`FB-OBS-02` and `FB-OBS-04` cannot ship before `FB-S7-03`** — configuration before code.
  Item 25 §5 ranks the channel split *fifth*, above the monitors it serves, because *"items 3
  and 4 begin adding traffic to the channel that G-5 says is already mixed — the split should
  land before the traffic does, not after."* Thirty modules share one Discord webhook and that
  webhook also carries signups (item 25 G-5): a page that arrives between two signup
  notifications is muted by the channel, not by the alert.

⭐ **And the shape of the graph is itself the fourth finding, because it changes what the
constraint is.** The deepest chain in 118 nodes is **three edges** (§4), and **40 of the 85
backlog items have no hard prerequisite at all** (§3.1). This graph is wide and shallow. So
delivery is not dependency-bound — it is **concurrency-bound**, and §5.2 is therefore the
section with teeth.

---

## 2. How to read the graph

### 2.1 Node types

| type | what it is | how many | unblocking action |
|---|---|---|---|
| **`FB-*`** | a backlog item from item 16, referenced by id and never restated or renumbered | 85 | build it |
| **`DEC-*`** | a decision, owner-held unless marked otherwise | 18 | ask a person, and record the answer where a reader will find it |
| **`MEAS-*`** | a measurement that no backlog item owns | 3 | run it |
| **`VEND-*`** | an action outside the team — a vendor, or a credential this programme does not hold | 2 | send the email; log into the dashboard |
| **`RAIL-*` / `PRE-*`** | a check that must exist *before* the work it guards | 2 | write the test first |
| **`ARCH*-*`** | an architecture requirement with a hard prerequisite here and **no backlog item** — §7 | 4 | ⛔ first decide whether it is a deliverable at all |
| **`GATE-*`** | a composite gate whose contents are owned by another document | 1 | discharge the cited checklist |

⚠️ **The non-`FB` nodes are not a parallel backlog.** They exist so an edge that leads out of
engineering has somewhere to point. A `DEC-*` node with no dependents is a decision nobody
should wait for, and §6 names two.

### 2.2 Edge types — they have completely different unblocking actions

| type | meaning | count | what unblocks it |
|---|---|---|---|
| **`code`** | Y's code must exist first | 67 | engineering |
| **`dec`** | a person must choose | 21 | ⛔ **an email or a decision card, not a commit** |
| **`rail`** | a check must land *before* the change it guards | 10 | write the test, then the change |
| **`meas`** | a number must exist before this can be chosen or believed | 9 | run the measurement — and §5.2 says a measurement can be *arithmetically* impossible |
| **`vend`** | someone outside the team must answer | 2 | ⛔ **nobody on this box can clear it** |

⭐ **Why `rail` is a type and not a flavour of `code`.** Its direction is the surprising one:
the guard ships in a commit *before* the thing it guards, and the two most consequential
instances are stated that way by their own sources — item 23 §3.6 (*"a rail, not a fix"*) and
`product-architecture.md`'s S7 record, which requires the filing-watch parity test to go in
**before** any predicate or receipt change *"and must fail on regression"*. A graph that
called these `code` would let a reader ship the change and add the test afterwards, which is
the exact sequence both sources forbid.

### 2.3 ⛔ What an edge does NOT mean

1. **It is not a duration.** No edge carries time. A three-edge chain of `S` items is shorter
   in wall-clock than one `XL` node with no prerequisites (`FB-D2-01`).
2. **It is not a same-commit co-requirement.** `FB-X2-02`'s field requires a member-facing
   re-subscribe path *in the same change* as the token rotation (item 16, citing PROD-1's
   "recovery path in the same commit"). That is a completeness rule, not an ordering, and
   recording it as an edge would falsely serialise one commit into two.
3. **It is not "this would be nicer first".** 27 of 109 edges are marked **soft** and a soft
   edge does not block: it says the downstream item is *better* or *cheaper* after the
   upstream one, and item 16 says so in its own words at each site (*"if it lands first;
   nothing otherwise"*). ⛔ Reading soft edges as hard is how a wide graph is made to look
   like a queue.
4. **It is not a verification prerequisite, except where the source says so.** `FB-OBS-01`
   makes a latency claim *checkable*; it does not make one *buildable*. I deliberately did not
   fan `FB-OBS-01` out to every node with a latency acceptance criterion — that would have
   added ~20 unjustified-looking edges and buried the two the backlog actually declares. The
   property is stated once, in H2 and §6, and modelled as one edge (`FB-A10-03`, which item 16
   declares) plus one note.
5. **It is not transitive in effort.** `MEAS-FIGI` has 8 transitive dependents and is *one API
   read*. Out-degree ranks leverage, never work.

---

## 3. The dependency graph

### 3.1 Form, and the method — measured, not typed

⚠️ **ASCII art of a 118-node graph is unreadable, and I am not going to draw one.** A picture
of this graph would be a hairball whose only honest reading is "everything touches
everything", which is false and unactionable. What a reader needs from a dependency graph is
(a) *"what does THIS node wait on"*, which is a lookup, and (b) *"what is the longest thing
here"*, which is one or two chains. So: **an adjacency table for the whole graph, and four
hand-drawn chains in §4.** The four chains are drawn because they are the only paths in the
graph three edges deep.

**How every count in this document was derived.** The table below was written first. Its rows
were then loaded as a tab-separated edge list and the counts, the in-degree-zero set, the
transitive out-degree ranking and the longest path were computed from **that list**, in the
scratchpad, over this document's own output. ⛔ **No count here is hand-typed beside the table
it describes** — re-derive them by treating §3.2's rows as `(dependent, prerequisite, type,
strength)` tuples:

| quantity | value |
|---|---|
| edges (rows in §3.2) | **109** |
| nodes | **118** — 85 `FB-*`, 33 non-`FB` |
| distinct dependents (nodes with ≥1 prerequisite) | **66** |
| edges by type | `code` 67 · `dec` 21 · `rail` 10 · `meas` 9 · `vend` 2 |
| edges by strength | hard **82** · soft **27** |
| `FB-*` items with **no edge of any kind** | **26** |
| `FB-*` items with **no hard prerequisite** | **40** |
| longest chain | **3 edges / 4 nodes** (§4) |

⭐ **Two of those numbers are the document's real content.** *26 items can start now against
nothing at all*, and *40 can start now against nothing that blocks*. That is a finding, not a
statistic: it means a plan that reads this graph as a queue would be inventing a constraint,
and the actual constraint is §5.2.

### 3.2 Adjacency table

Read each row as **"the dependent cannot ship before the prerequisite"**. `+H-04` marks an
edge this document ADDS from an architecture ruling rather than quoting item 16's field;
everything unmarked is item 16's own `Depends on` field, quoted.

**Shell, workspace and command surface**

| dependent | cannot ship before | type | hard/soft | why (one clause) |
|---|---|---|---|---|
| `FB-S1-02` | `DEC-PANEL-COUNT` | dec | hard | item 16: *"A person choosing it"* — item 24 §6(1) makes the target panel count a product decision |
| `FB-S1-02` | `FB-OBS-07` | meas | hard | item 16: *"`FB-OBS-07` supplies the window"* for the relative 1→N panel curve |
| `FB-S1-03` | `FB-S5-01` | code | hard | item 16: *"a panel instance is a saved object, so the document shape binds it"* |
| `FB-S1-03` | `FB-S4-02` | code | hard | item 16: *"a panel declares a need, never owns a transport"* — item 24 §5.2 |
| `FB-S2-02` | `FB-S3-01` | code | soft | item 16: *"Nothing hard… would make it resolve to an entity rather than a string"* |
| `FB-S2-03` | `FB-S5-01` | code | hard | item 16: one versioned document per saved object is what a name addresses |
| `FB-S2-03` | `FB-S3-01` | code | hard | item 16: entity-shaped addresses |
| `FB-S2-03` | `FB-D2-01` | code | hard | item 16: metric-shaped addresses |
| `FB-S2-04` | `FB-S2-03` | code | hard | item 16: *"`FB-S2-03`, hard"* — a command string is a rendering of an address space |
| `FB-S5-01` | `FB-X1-02` | code | hard | item 16 (`FB-X1-02`'s field): *"a versioned document is worth little in an unbacked store"* — ⚠️ declared on the prerequisite's side only, §7.2 |
| `FB-S5-02` | `FB-S5-01` | code | hard | item 16: *"`FB-S5-01`, hard"*; item 16 calls the reverse order *impossible* |
| `FB-S6-01` | `FB-A12-02` | code | hard | item 16: *"the cross-device half; they should ship as one artefact"* |
| `FB-A12-02` | `FB-S5-01` | code | soft | item 16: *"if a boundary moves; nothing to publish"* |
| `FB-A12-03` | `FB-S5-01` | code | soft | item 16: *"if the flag lives in a versioned document; otherwise nothing"* |
| `FB-S12-02` | `FB-S12-01` | code | hard | item 16: the cohort store is *"the honest source of 'what is on'"* |
| `FB-X3-02` | `DEC-SEEDED` | dec | hard | item 16: *"the seeded-or-empty decision, which F-01 says nothing has made"* |
| `FB-X3-02` | `FB-S5-01` | code | soft | item 16: *"if the seeded board must be versioned from birth (it should be)"* |
| `FB-D3-01` | `FB-S4-02` | code | hard | item 16: the delivery-semantics field tells a consumer whether resume is meaningful — item 24 Q6 |

**Provenance, freshness and the intelligence layer**

| dependent | cannot ship before | type | hard/soft | why (one clause) |
|---|---|---|---|---|
| `FB-S8-02` | `FB-S8-01` | code | hard | item 16: S8-01 is the render primitive a freshness authority is displayed through |
| `FB-S8-02` | `DEC-MAX-AGE` | dec | hard | item 24 §3 Q3: the maximum age a panel may display without saying so is *"a product decision nobody has made"* |
| `FB-S8-02` | `FB-S11-01` | code | hard | item 16 (`FB-S11-01`'s field): *"a freshness contract needs to know whether the market is open"* — ⚠️ one-sided, §7.2 |
| `FB-I1-01` | `FB-S8-01` | code | hard | item 16: *"two halves of one build and should be sequenced together"*; the `i1S8Boundary.test.js` rail exists because both claimed the same renderer |
| `FB-I1-02` | `FB-D2-01` | code | hard | item 16: *"hard, for computed figures"* — item 22 §0(2): a computed number with no addressable row cannot be cited by any mechanism in the field |
| `FB-I1-02` | `FB-I1-01` | code | hard | item 16: the renderer |
| `FB-I1-02` | `FB-A6-02` | code | soft | item 16: *"its cheapest first case, because the transcript index already exists"* |
| `FB-I1-04` | `FB-S9-04` | code | soft | item 16: *"`FB-S9-*` for where the cap is enforced"* |
| `FB-A9-02` | `FB-S8-01` | code | hard | item 16: *"the component set it belongs in"* |
| `FB-A9-01` | `FB-A9-02` | code | hard | item 16: *"for the receipt vocabulary"* |
| `FB-A8-03` | `FB-A9-02` | code | hard | item 16: the receipt shape |
| `FB-A8-03` | `FB-S8-01` | code | hard | item 16: the component set |
| `FB-A8-03` | `DEC-PDELTA` | dec | soft | item 16: *"the P-δ posture is owner-bound, but the item is written to be posture-neutral"* |
| `FB-A11-03` | `FB-S8-01` | code | hard | item 16: the primitive |
| `FB-A11-03` | `FB-S8-02` | code | hard | item 16: the maximum age a panel may display without saying so |
| `FB-A6-02` | `FB-S8-01` | code | hard | item 16: *"`FB-S8-01` for the render"* |
| `FB-A6-01` | `FB-A9-02` | code | soft | item 16: *"if it lands first; nothing otherwise"* |
| `FB-A6-01` | `MEAS-RG15` | meas | hard | ⛔ item 16's own Size field: *"Confirming RG-15 first is a precondition the source states, and it is a measurement, not a build"* — **and its `Depends on` field omits it**, §7.1 |
| `FB-A3-02` | `FB-D2-01` | code | hard | item 16: *"for the addressable row"* |
| `FB-A3-02` | `FB-S8-01` | code | hard | item 16: *"for the render"* |
| `FB-A1-01` | `FB-S8-01` | code | soft | item 16: *"if that lands first; nothing otherwise"* — ⚠️ S8-01's field claims it harder, §7.1 |
| `FB-A10-01` | `FB-S8-01` | code | soft | item 16: *"Nothing. `FB-S8-01` would give it a home"* |
| `FB-D5-01` | `FB-S8-01` | code | soft | item 16: CARD 7's re-open trigger is S8/S10 mounting the basis on a member surface — ⚠️ a trigger, not a prerequisite, §7.1 |
| `ARCH05-R5` | `FB-S11-01` | code | hard | **+H-04** — item 22 §4.2(5): the session clock must be a stated, gate-checkable fact, and `FB-S11-01` is the only node that produces one |
| `ARCH05-ALLOWLIST` | `ARCH06-DATACLASSES` | code | hard | **+H-04** — item 22 §1.2 and item 23 §3.1 both rule that per-lane tool allowlists *"must become a function of the entitlement, not per-lane constants"* |
| `ARCH05-ALLOWLIST` | `FB-S9-04` | code | hard | **+H-04** — the entitlement cannot key on a column the schema lacks (item 23 §1.5) |

**Data platform, applications and the moat**

| dependent | cannot ship before | type | hard/soft | why (one clause) |
|---|---|---|---|---|
| `FB-S3-01` | `MEAS-FIGI` | meas | hard | item 16: *"whether Massive/FMP responses already carry a `figi` field is unconfirmed — a live API read would settle it"* |
| `FB-D1-01` | `FB-A3-01` | code | soft | item 16: `FB-A3-01` is *"the named first proof case, so the pattern should be established there"* |
| `FB-D5-02` | `FB-D1-01` | code | soft | item 16: *"though the swap does not strictly require it"* |
| `FB-A11-04` | `FB-D1-01` | code | hard | item 16: *"a Massive adapter to route through"* |
| `FB-A7-01` | `FB-D1-01` | code | hard | item 16: *"`FB-D1-01` for the adapter"* |
| `FB-A7-01` | `FB-S3-01` | code | soft | item 16: *"Without S3 this lands as ticker-keyed and inherits the ambiguity"* (13F names are entity-shaped) |
| `FB-A7-02` | `FB-D1-01` | code | hard | item 16: the adapter |
| `FB-A7-02` | `FB-A7-01` | code | soft | item 16: *"`FB-A7-01`'s normalization if it lands first"* |
| `FB-A7-02` | `DEC-SPEND-SI` | dec | soft | item 16: *"the paid vendor is an owner decision"* — the FINRA floor is not |
| `FB-A9-03` | `FB-D1-01` | code | hard | item 16: `FB-D1-01` |
| `FB-A9-03` | `DEC-SPEND-SCREENER` | dec | hard | item 16: *"and an owner decision on spend"* — matrix §6(1) ranks this the estate's clearest single point of failure |
| `FB-A8-01` | `FB-S2-02` | code | soft | item 16: *"the natural place for the primary-vs-mentioned bit"* |
| `FB-A10-04` | `FB-D4-01` | code | hard | item 16: `serve_stale` adoption is the mechanism the two-shard warmer needs |
| `FB-A10-03` | `FB-OBS-01` | meas | soft | item 16: *"for a standing measurement; the diagnosis itself depends on nothing"* |
| `FB-A10-05` | `VEND-MASSIVE-2ND-CONN` | vend | hard | item 16: *"A human asking Massive. Blocked, and the block is named"* — item 24 Q9: no agent can progress it |
| `FB-A10-06` | `DEC-CONFLUENCE` | dec | hard | item 16: extend or delete is *"a decision, not a build"* |
| `FB-A11-02` | `FB-A11-01` | code | hard | item 16: *"`FB-A11-01`, hard"* — one regime authority before a published vocabulary |
| `FB-A5-01` | `DEC-OI16` | dec | hard | item 16: *"the superseded-or-not decision"* (OQ-14's canonical earnings-date authority) |
| `FB-A13-01` | `FB-D2-01` | code | hard | item 16: *"hard — the source says blocked entirely"*; matrix A13: *"blocked entirely on this system existing"* |
| `FB-A13-01` | `FB-S3-01` | code | hard | item 16: *"every row keyed by entity id, ticker retained only as a dated alias"* |
| `FB-A13-01` | `FB-X1-02` | code | hard | item 16 (`FB-X1-02`'s field): a precondition of `FB-A13-01` — ⚠️ one-sided, §7.2 |
| `FB-A13-01` | `DEC-OI15` | dec | soft | item 16: OI-15 gates the **member-display lane only** — *"the join must be buildable without that lane"* |

**Alerts, security, egress and rollout**

| dependent | cannot ship before | type | hard/soft | why (one clause) |
|---|---|---|---|---|
| `FB-S7-01` | `DEC-S7-AUTH` | dec | hard | item 16: *"Per-type owner authorization"* — seven types, authorized one at a time |
| `FB-S7-01` | `FB-D2-01` | code | hard | item 16: *"`FB-D2-01` for `indicator-condition` specifically"* — scope-limited to one of the seven types |
| `FB-S7-01` | `RAIL-FILING-PARITY` | rail | hard | item 16, quoting `product-architecture.md`'s S7 record: the parity test *"goes in BEFORE the change and must fail on regression"* |
| `FB-S7-02` | `FB-S7-01` | code | hard | item 16: *"the taxonomy is where a published cooldown belongs"* |
| `FB-S7-02` | `FB-A9-01` | code | soft | item 16: *"the same authoring-time idiom, one surface over"* |
| `FB-A12-01` | `FB-S7-01` | code | hard | item 16: *"`FB-S7-01`'s foundation, which already ships one of eight types"* |
| `FB-A12-01` | `RAIL-FILING-PARITY` | rail | hard | item 16: ⛔ *"the protected-consumer rule binds"* — fires, delivery, receipts unchanged |
| `FB-S9-01` | `DEC-DP6` | dec | hard | item 16: *"Ownership (item 23), not evidence"* — item 23 DP-6 rules it Engineering-owned and needing **no owner input** |
| `FB-S9-02` | `FB-S9-01` | rail | hard | item 16: *"the auditor must be able to see the work"*; item 23 §3.6: *"a rail, not a fix"*, because the class recurred |
| `FB-S9-02` | `MEAS-R17-PROBE` | meas | soft | **+H-04** — item 23 GAPS: R-17 closes only on *"one read-only, browser-UA, no-mutation GET per route"*; the per-family decision needs to know which are open **in production**, not in source |
| `FB-S9-02` | `DEC-DP1` | dec | soft | **+H-04** — item 23 DP-1 owns two of the six families (`/api/flow-scoreboard`, `/r/*`); the other four are plain omissions |
| `FB-S9-04` | `DEC-DP2` | dec | soft | **+H-04** — item 23 DP-2: the column ships with `"all"`; only the **numbers** are owner-bound, and CARD 17 collapsed the tier axis to a binary |
| `FB-X2-01` | `FB-S9-03` | code | hard | item 16: *"the source makes this a hard gate, not a preference"* |
| `FB-X2-01` | `FB-S9-02` | code | hard | item 16: *"an egress surface over unauthenticated routes is a redistribution question, not a feature"* |
| `FB-X1-01` | `FB-X1-02` | code | hard | item 16: *"do not build a public record on a store with no backup"* |
| `FB-X1-01` | `DEC-PUBLISH-LOSSES` | dec | hard | item 16: publishing a member's losing call beside their name is a member-safety call |
| `ARCH06-CHOKEPOINT` | `FB-D1-01` | code | hard | **+H-04** — item 23 §2.3: R-A6-2's publication chokepoint *"cannot ask 'whose data is this'"* without the adapter's provenance field (R-A4-1) |
| `ARCH06-CHOKEPOINT` | `DEC-DP8` | dec | hard | **+H-04** — item 23 DP-8: whether provenance ships is ARCH-04's, and §3.1 records the dependency as *"real"* |
| `ARCH06-DATACLASSES` | `DEC-DP7` | dec | hard | **+H-04** — item 23 DP-7: which data class each surface may reach is *"Owner + licensing"* |
| `ARCH06-DATACLASSES` | `FB-S9-04` | code | hard | **+H-04** — a fifth axis needs the entitlement object to have a seat (item 23 §3.1, §3.3 test 4) |
| `GATE-STAGE-1` | `FB-S12-01` | code | hard | item 37 RB-2 defaults DP-3 to a durable per-user tag, which is exactly `FB-S12-01`'s store |
| `GATE-STAGE-1` | `PRE-SET-13` | rail | hard | item 37 §4 — thirteen prerequisites, each with its incident; ⛔ cited as a set so the authority stays in item 37 |
| `GATE-STAGE-1` | `DEC-DP3` | dec | soft | item 37 RB-2 already defaults it, vetoable in one word |
| `GATE-STAGE-1` | `DEC-DP4` | dec | soft | item 23 DP-4 / item 37 §6: a persisted runtime kill switch is the owner's, and the deploy-coupled path works meanwhile |

**Observability, and the one chain whose head is configuration**

| dependent | cannot ship before | type | hard/soft | why (one clause) |
|---|---|---|---|---|
| `FB-OBS-01` | `DEC-OBS1-QUANTITY` | dec | soft | item 25 OBS-1 already **defaults** the quantity (client wall-clock, n ≥ 60, `stale-swr` as SERVED); the ruling is vetoable in one word, so it does not block |
| `FB-OBS-02` | `FB-S7-03` | code | hard | item 16 / item 25 §5(5): *"the channel split should land before the traffic"* |
| `FB-OBS-04` | `FB-S7-03` | code | hard | item 16: *"it needs an ops channel to be one message rather than noise"* |
| `FB-OBS-05` | `FB-S7-03` | code | soft | item 25 §5(7): *"duplicate pages only matter once the channel is worth listening to"* |
| `FB-OBS-03` | `FB-OBS-04` | code | hard | item 16: *"a slope with no cadence contract and no `deployments_sampled` is item 24's `n = 1` again"* |
| `FB-OBS-03` | `FB-OBS-07` | meas | hard | item 16: the declared quiet window; item 24 §2.5 — 14 deploys in 6.5 h destroyed a measurement window |
| `FB-OBS-06` | `FB-OBS-04` | code | hard | item 16: cadence |
| `FB-OBS-06` | `FB-OBS-07` | meas | hard | item 16: the window; ⛔ item 16 and item 25 both state it *"must not arm anything"* |
| `FB-OBS-07` | `DEC-QUIET-WINDOW` | dec | hard | item 16: *"A person"* — an owner/scheduling decision, not an engineering one |
| `FB-OBS-08` | `VEND-CF-CREDENTIAL` | vend | hard | item 16: *"a dashboard or Cloudflare-API read by someone who can authenticate to it"* — item 24 §6(3) bars any edge change until then |
| `FB-OBS-09` | `FB-OBS-01` | rail | hard | item 16: *"Each of `FB-OBS-01` … `FB-OBS-06`, as their shipping condition"* — item 25 §4.6: a guard nobody has seen fire is not a guard |
| `FB-OBS-09` | `FB-OBS-02` | rail | hard | same |
| `FB-OBS-09` | `FB-OBS-03` | rail | hard | same |
| `FB-OBS-09` | `FB-OBS-04` | rail | hard | same |
| `FB-OBS-09` | `FB-OBS-05` | rail | hard | same |
| `FB-OBS-09` | `FB-OBS-06` | rail | hard | same |
| `DEC-TOPOLOGY` | `FB-OBS-03` | meas | hard | **+H-04** — item 24 §5.1 and §6(2): Q7 is *"blocked on 1 and on the leak"*, and the leak needs *"one held window with per-subsystem attribution"* |
| `DEC-TOPOLOGY` | `DEC-PANEL-COUNT` | dec | hard | **+H-04** — item 24 Q7: *"it needs the panel count from Q1 to know whether a terminal session is long-lived in the way that matters"* |
| `DEC-PANEL-COUNT` | `FB-OBS-07` | meas | hard | **+H-04** — CARD 15 ruled the target is the sandbox and an absolute capacity number out of scope; what is obtainable is the relative 1→N curve, which needs a quiet window |

### 3.3 The 26 nodes with no edge at all — the finding, stated plainly

⭐ **These can start now, against nothing.** That is the single most useful list in the
document, and it is derived from the table rather than curated:

`FB-A10-02` · `FB-A11-01` · `FB-A3-01` · `FB-A4-01` · `FB-A5-02` · `FB-A5-03` · `FB-A5-04` ·
`FB-A8-02` · `FB-D2-01` · `FB-D4-01` · `FB-I1-03` · `FB-S1-01` · `FB-S10-01` · `FB-S10-02` ·
`FB-S10-03` · `FB-S11-01` · `FB-S12-01` · `FB-S2-01` · `FB-S4-01` · `FB-S4-02` · `FB-S7-03` ·
`FB-S8-01` · `FB-S9-03` · `FB-X1-02` · `FB-X2-02` · `FB-X3-01`

⛔ **Three of them are in §6's top five blockers** (`FB-S8-01`, `FB-X1-02`, `FB-D2-01`), and
one more is fourth-equal (`FB-S7-03`). A node that waits on nothing and unblocks many is the
best thing a dependency graph can find; four of them is the argument for §5's chain heads.

Adding the 14 that wait only on **soft** edges gives 40 items with no hard prerequisite —
⚠️ and 40 simultaneously-startable items against a measured cap of three concurrent lanes
(§5.2) is why this document's second half matters more than its first.

---

## 4. The critical path, and the longest chain

### 4.1 The longest chain is three edges, and there are ten of them

Computed over §3.2's rows (any-strength edges), the maximum depth in the graph is **3 edges /
4 nodes**, achieved by **ten** distinct paths. Four of the ten are drawn below — three as
chains 1, 2 and 4, and the fourth as the side-join into `DEC-TOPOLOGY` inside chain 1's block.
⚠️ **Chain 3 is drawn although it is only two edges deep**, because §4.2 names it the critical
path and depth is not what makes it one. The remaining six are
`FB-S7-02 ← FB-A9-01 ← FB-A9-02 ← FB-S8-01`, `FB-S6-01 ← FB-A12-02 ← FB-S5-01 ← FB-X1-02`,
`FB-A8-01 ← FB-S2-02 ← FB-S3-01 ← MEAS-FIGI`, `FB-A7-02 ← FB-A7-01 ← FB-S3-01 ← MEAS-FIGI`,
`FB-OBS-09 ← FB-OBS-03 ← FB-OBS-04 ← FB-S7-03`, and
`ARCH05-ALLOWLIST ← ARCH06-DATACLASSES ← FB-S9-04 ← DEC-DP2`.

```
CHAIN 1 — the leak ordering (item 24 §5.1). Every edge is meas or code; no person is waiting.
  FB-S7-03 ──code──▶ FB-OBS-04 ──code──▶ FB-OBS-03 ──meas──▶ DEC-TOPOLOGY
  (split the ops    (cadence          (RSS slope +       (own process?
   channel)          heartbeat)        attribution)       item 24 Q7)
                                          │
                                          └──rail──▶ FB-OBS-09 (prove every guard can fire)
  and joining DEC-TOPOLOGY from the side:
  DEC-QUIET-WINDOW ──dec──▶ FB-OBS-07 ──meas──▶ DEC-PANEL-COUNT ──dec──▶ DEC-TOPOLOGY

CHAIN 2 — the address space (item 16's own deepest code chain).
  FB-X1-02 ──code──▶ FB-S5-01 ──code──▶ FB-S2-03 ──code──▶ FB-S2-04
  (backup rail)      (one versioned    (published        (command string as
                      document)         address space)    interchange format)
                                          ▲       ▲
                        FB-S3-01 ─────────┘       └───────── FB-D2-01
                        ▲
                        MEAS-FIGI (one API read)

CHAIN 3 — the moat (matrix A13: "blocked entirely on this system existing").
  FB-X1-02 ──┐
  MEAS-FIGI ──▶ FB-S3-01 ──┐
  FB-D2-01 ────────────────┴──code──▶ FB-A13-01   [DEC-OI15 gates the member-display lane only]

CHAIN 4 — the security rail before the security fix (item 23 §2.2, §3.6).
  DEC-DP6 ──dec──▶ FB-S9-01 ──rail──▶ FB-S9-02 ──code──▶ FB-X2-01
  (engineering-     (auditor sees   (close the six    (MCP/skill egress
   owned, no        a GET, and      open families)     surface)
   owner input)     publish the     ▲
                    denominator)    └── MEAS-R17-PROBE (soft: which are open in PROD)
                                    └── FB-S9-03 ──▶ FB-X2-01 (per-route limits, hard)
```

### 4.2 ⛔ The critical path is not the longest chain, and saying which is a judgement call

**Two defensible definitions, and I am picking one.**

- *Longest chain* = `FB-X1-02 → FB-S5-01 → FB-S2-03 → FB-S2-04` (Chain 2) and its nine
  siblings, all three edges.
- *Critical path* = **the path to the thing that cannot be substituted**, which is Chain 3:
  `{MEAS-FIGI → FB-S3-01, FB-D2-01, FB-X1-02} → FB-A13-01`.

⭐ **I pick Chain 3, and the reason is not depth — it is uniqueness.** Item 16's H1 records
that the per-ticker history join is *"the only capability in this programme's evidence base
where UCT can be first rather than behind"*, that `best-of-breed.md` §1 found **no incumbent
at all** across fifteen products, and that *"several concede they structurally cannot"* have
it. Every other chain in this graph improves a capability that exists somewhere. Chain 3 is
the only one whose absence is a permanent competitive fact, and its three prerequisites are
*all internal* — one API read, one entity master, one canonical model — with **no vendor,
licence or discovery** in the path (item 16 H1, matrix A13).

**What sits on it, and what each thing actually is:**

| node | what it is | size (carried from item 16) | who can clear it |
|---|---|---|---|
| `MEAS-FIGI` | one live API read: do Massive/FMP responses carry a `figi` field? | — (not an item) | an engineer with a key, in minutes; ⛔ not this programme (no network, by instruction) |
| `FB-S3-01` | the entity master — permanent id, dated ticker aliases, FIGI mapping | **L** | engineering; OpenFIGI is MIT-licensed and free (matrix S3) |
| `FB-D2-01` | the canonical model and metric address book, ten figures first | **XL** | engineering; item 16 records it as waiting on nothing |
| `FB-X1-02` | a backup rail for member posts and the ~50 unbacked databases | **M** | engineering |
| `FB-A13-01` | the join itself | **XL** | engineering; `DEC-OI15` gates only the member-display lane |

⚠️ **The reversal condition, stated because both readings are defensible.** If the owner's
scope decision (item 27) excludes the history join from the first release, the critical path
becomes **Chain 2**, because the address space is what every saved-object and command surface
in the shell depends on and nothing else can substitute for `FB-S5-01`. ⛔ That is a scope
decision and it is not mine; this document names the switch and stops.

### 4.3 What is NOT on any critical path, and should be said out loud

- **`FB-OBS-01`** is on no chain longer than one edge and is item 25's **first** item by
  leverage. A critical path is not a priority list.
- **`DEC-DP1`, `DEC-DP5`** — item 23 rules DP-1 *"blocks nothing in Terminal-Next — A5 holds
  either way"*, and DP-5 (a staff tier finer than `admin`) has **zero dependents** in this
  graph. ⭐ **A decision with no dependents is a decision nobody should wait for**, and naming
  those is as useful as naming the blockers.
- **`FB-A10-05`** (a second Massive OPRA connection) is the graph's only pure `vend` leaf with
  a named engineering dependent, and item 24 Q9 is explicit: *"no measurement can answer and
  no agent can progress"* it.

---

## 5. The parallel build graph

### 5.1 Four chains, disjoint at the head, converging with depth

A chain here is a lane a single agent could own without waiting on another lane. Assignment is
by which part of the estate the lane touches, which is a judgement — ⚠️ no file was opened by
this document, so treat the file-tree claims as inherited from item 16's row letters and the
matrix's tiers.

| chain | head nodes (no edges at all) | what it owns | mostly touches |
|---|---|---|---|
| **A — data spine** | `FB-D2-01`, `FB-A3-01`, `FB-D4-01`, `FB-A11-01`, `FB-A10-02` | canonical model, adapters, entity master, the moat join | `api/services/**`, new stores |
| **B — shell & platform** | `FB-S4-01`, `FB-S4-02`, `FB-S2-01`, `FB-S10-01…03`, `FB-S1-01` | context bus, command surface, presentation primitives — and the workspace document, which is **not** a head: `FB-S5-01` enters behind chain D's `FB-X1-02` | `app/src/**` |
| **C — provenance & intelligence** | `FB-S8-01`, `FB-S11-01`, `FB-I1-03` | the provenance component set, the freshness authority, the market clock, I1's contract | both trees |
| **D — observability, rollout, security** | `FB-S7-03`, `FB-X1-02`, `FB-S12-01`, `FB-S9-03`, `FB-OBS-01`, `FB-X2-02`, `FB-A5-02` | the measurement floor, the ops channel, the cohort store, the auth rail | `api/**`, `tools/**`, config |

⛔ **They are not disjoint past the second edge, and two nodes are why.**

- **`FB-S8-01` (chain C) has 14 transitive dependents, spread across chains A, C and the
  application rows.** Chain C must lead A's and the applications' render items, or those items
  build their own receipt and re-create the defect `i1S8Boundary.test.js` exists to stop.
- **`FB-D2-01` (chain A) is a hard prerequisite in chains A, B, C and D** —
  `FB-A13-01`, `FB-S2-03`, `FB-I1-02`, `FB-A3-02`, and `indicator-condition` inside
  `FB-S7-01`. It is the single most cross-chain node in the graph.
- **`FB-X1-02` (chain D) is upstream of `FB-S5-01` (B) and `FB-A13-01` (A).** The smallest
  head node in the graph gates the two largest chains.

⭐ **So the honest statement is: four chains at depth 0–1, effectively two by depth 2, and one
convergent front at depth 3.** Parallelism decays with depth in this graph, which is the
opposite of what a wide in-degree-zero set suggests.

### 5.2 ⛔ The shared-resource section — theoretical parallelism is 40, real parallelism is 3, and verified parallelism is 1

Every number in this subsection is **measured**, from `_merge-master:CLAUDE.md` and item 24,
and every one of them is a loss that was already paid for. The reduction:

| stage | parallelism | what removes the rest |
|---|---|---|
| graph width (no hard prerequisite) | **40** | — |
| after the agent cap | **3 build lanes + 1 integrator** | owner ruling 2026-09-13, from two measured losses in one session |
| after the box's gate rule | **1 lane at a time at the verification step** | one gate at a time on this machine |
| after the merge queue | **1 master merge in flight, repo-wide** | web deploy must reach SUCCESS before the next push |
| after the deploy-queue exclusions | **0 lanes touching flow-worker watch paths during RTH** | a bounced OPRA tape is a permanent gap until the T+1 flat file |

**(1) The agent cap is three plus an integrator, and it is an owner ruling written from two
losses.** Five concurrent Opus agents plus an integrator **exceeded the session rate limit and
two lanes were killed mid-flight**; one of them had **committed nothing**, so its work existed
only in a dead worktree and had to be salvaged by hand, and the other arrived carrying **five
failing tests it never saw**. The rule is three clauses, not one: cap the concurrency, commit
and push at every green checkpoint, and **the integrator re-runs the scoped gate in its own
session** — *"a gate run in a session you cannot see is a gate you did not run."*
⚠️ It is a cap on concurrency, not on total agents: three at a time, as many waves as the work
needs. ⛔ *"Dispatching a fourth because 'this one is small' is how five happened."*

**(2) The box is the ceiling, and the aggregate is what nobody checks.** On a 31.8 GB box,
free memory fell to **4.8 GB** with three concurrent gates plus an unscoped backend pytest at
**11,854 MB RSS and still climbing**; `app/node_modules` went to **2 entries, then 0, then did
not exist**, and the worktree's **`.git` file was destroyed** so the tree stopped being a
repository. `--collect-only` alone reached **6.6 GB**, so `-k` does not help — scoping means
naming the files. And the instructive one: **13 agents beside a 5-hour local job** killed the
job for low memory and burned the account limit, **7 of 12 agents dying mid-flight**, with
every individual rule followed. ⭐ *"What was never checked was the aggregate."*
⛔ **Consequence for this graph: two lanes may author concurrently, but their gates may not
overlap.** A build plan that gives three lanes three gates has already been run, and it
deleted a worktree.

**(3) The merge queue serialises integration, not authoring.** One master merge at a time,
repo-wide, with Railway `web` reaching SUCCESS before the next push — stacked pushes caused the
2026-09-12 **502** (two merges four minutes apart, each marking the previous deploy `REMOVED`,
serving Bad Gateway through the swap) and cost a sampler observation row inside a 7-day window
whose whole point was that a hole stays visible. ⭐ *"This is a QUEUE, not a window: the cost
is not the blip, it is that two sessions pushing inside one swap make every instrument in
flight unreadable, and neither session can tell whose change did it."*
**The arithmetic:** push → `web` SUCCESS measured **3m40s–6m40s over five deploys** (item 24
§2.4); end-to-end including the gate and promote workflows **≈10 min** (CP-05). So integration
throughput is roughly **six merges an hour at best**, and only if each merge's gate is scoped.
⛔ Lanes push **branches**, which is free; only the integrator merges, so the cap on delivery
is the integrator's, and three lanes feeding one integrator at ~10 minutes a merge is a
balanced rig — four is not.

**(4) ⭐⭐ A measurement longer than the gap between disturbances cannot complete, and it
applies to build lanes exactly as it applies to gates.** The six-shard gate takes **46–92
minutes** while master moved **56 commits in 92 minutes**. *"It is arithmetic, not luck."*
Two consequences for a parallel plan:

- **Any lane whose checkpoint needs the full suite cannot be verified against a moving master
  at three-lane concurrency.** Item 36's conclusion is therefore a dependency of this
  document's §5, not an aside: putting vitest on a host that is not this machine *"dissolves
  the arithmetic rather than negotiating with it"*.
- **The same arithmetic governs `FB-OBS-03`, `FB-OBS-06` and `DEC-PANEL-COUNT`.** Item 24
  §2.5 measured **14 deploys in 6.5 hours, median pod life 26 minutes**, and the +7.9 MB/min
  slope was only visible because one deployment happened to live 104 minutes. That is exactly
  why `FB-OBS-07` (a declared quiet window) is a **`dec` edge on a person** and appears
  upstream of four nodes: ⛔ **a lane cannot schedule its way past it, and a busier build plan
  makes it strictly harder.** A three-lane build wave is itself a disturbance generator.

**(5) The deploy queue is shared, and one service's watch list makes it asymmetric.** Only
`web` deploys on every push; over 14 pushes `flow-worker` deployed **zero** times and `worker`
and `bars-api` only on `api/**` commits. ⛔ But a push that *does* touch a `flow-worker`
watched path bounces the OPRA tape, and **Massive OPRA does not replay — that gap is permanent
until the T+1 flat file.** So `FB-A10-*`-adjacent work is not merely serialised, it is
**time-windowed**, and item 37 RB-11 already rules that nothing in Terminal-Next ships into
flow-worker's watch list during RTH. A parallel plan must treat "does this lane touch a
watched path" as a first-class lane property, because the file tree does not tell you.

**(6) ⚠️ A sixth shared resource nobody counts: the owner's PC is also a data producer.**
CP-11 records **34 confirmed PC-scheduled tasks** with four silent failures found, and the
capability ledger §R lists the capabilities that *"stop when the owner's machine is off"* —
A3 freshness (partly), G5, H1, H4, K6, L9, L10, L11, M7, N1–N3. ⛔ So the box that hosts the
gate also produces the authoritative daily rows several nodes in this graph depend on. A
46–92 minute gate that overlaps one of those windows is contending with a member-facing data
producer, and the 09-12 incident shows what memory pressure does to whichever process is
younger. **That is a reason the quiet window (`FB-OBS-07`) is a scheduling decision and not an
engineering one.**

### 5.3 What a realistic wave therefore looks like

⛔ **This is a shape, not a schedule — item 28 owns sequencing in time.** But the shape follows
from §5.2 without any further choice:

- **Three authoring lanes, drawn from different chains in §5.1 and from §3.3's 26-node
  no-edge set**, so no lane waits on another.
- **One integrator, gating one branch at a time**, reading the totals line itself. Lanes never
  gate concurrently; they queue for the box.
- **Lane heads chosen for out-degree, not for size**: `FB-S8-01` (C), `FB-X1-02` → `FB-S5-01`
  (D→B), `FB-A3-01` → `FB-D1-01` (A). Each is a head node with no edges and high leverage
  (§6), and the three touch three different parts of the estate.
- ⛔ **`FB-S7-03` before any observability lane**, and ⛔ **`FB-S9-01` before any route work** —
  H3's two inversions are the two easiest ordering mistakes to make and the two that produce a
  finished-looking wrong state.
- ⚠️ **A fourth lane is not available**, however small it looks.

---

## 6. The nodes that block the most — the section to act on

Ranked by **transitive downstream count** over §3.2's rows, with the direct-row count beside
it. ⛔ Out-degree is leverage, not effort: `MEAS-FIGI` unblocks eight nodes and is one API read.

| # | node | transitive down | direct rows | waits on | what it is |
|---|---|---|---|---|---|
| 1 | **`FB-S8-01`** | **14** | 10 | ⭐ **nothing** | the shared provenance component set + a rail asserting every panel uses it. Item 16 sizes it **M, not L**, because two of the four primitives already ship — so it is *adoption and rail*, not a build |
| 2 | **`FB-X1-02`** | **11** | 3 | ⭐ **nothing** | a backup rail for member posts and the ~50 unbacked databases. **M.** The graph's best leverage-to-size ratio |
| 3 | **`FB-S5-01`** | **8** | 6 | `FB-X1-02` | one versioned workspace document in its own store. **L**, and item 16 warns ⛔ it must not be half-shipped |
| 3= | **`FB-D2-01`** | **8** | 5 | ⭐ **nothing** | the canonical model and metric address book. **XL** — the only XL node in the top five, and the only one whose downstream spans all four chains |
| 3= | **`MEAS-FIGI`** | **8** | 1 | an engineer with a key | one live API read: do Massive/FMP carry `figi`? ⛔ **Not clearable by this programme** |
| 6 | **`FB-S3-01`** | **7** | 4 | `MEAS-FIGI` | the entity master — *"the clearest infrastructure gap the research found"* (matrix S3) |
| 6= | **`FB-S7-03`** | **7** | 3 | ⭐ **nothing** | split ops from business events. **S** for the split, and item 25 ranks it above the monitors it serves |
| 6= | **`FB-A3-01`** | **7** | 1 | ⭐ **nothing** | six `_fmp_get` helpers onto one adapter — **M**, and the *named first proof case* for `FB-D1-01`, which is why a small item carries seven |
| 6= | **`DEC-QUIET-WINDOW`** | **7** | 1 | ⛔ **a person** | declaring a quiet window for capacity and memory measurement. Zero engineering, five FB nodes downstream |
| 10 | **`FB-D1-01`** | **6** | 6 | `FB-A3-01` (soft) | the Massive adapter and the retirement queue behind it. **L** |
| 11 | **`FB-OBS-07`** | **6** | 4 | `DEC-QUIET-WINDOW` | the quiet-window convention itself |
| 12 | `FB-A9-02` | 4 | 3 | `FB-S8-01` | `CoverageLine` as a platform primitive |
| 12= | `FB-OBS-04` | 4 | 3 | `FB-S7-03` | the cadence heartbeat and dead-man roll-up |
| 12= | `DEC-DP2` | 4 | 1 | ⛔ a person | the tier numbers — ⭐ **CARD 17 shrank this**: with one paid tier the axis is a binary, so the mechanism ships regardless and only the numbers wait |
| 15 | `FB-S9-04` · `RAIL-FILING-PARITY` · `FB-S11-01` · `DEC-S7-AUTH` · `DEC-OBS1-QUANTITY` · `DEC-DP6` | 3 each | 1–3 | mixed | the middle band |

**Four things to read off that table.**

1. ⭐⭐ **Five of the top nine wait on nothing** (`FB-S8-01`, `FB-X1-02`, `FB-D2-01`,
   `FB-S7-03`, `FB-A3-01`), and three of those five are sized **M or smaller** by item 16.
   The graph's highest-leverage work is also its most startable work, which is unusual and
   should be exploited before it stops being true.
2. ⛔ **Two of the top nine cannot be cleared by engineering at all.** `MEAS-FIGI` needs a key
   and a network call; `DEC-QUIET-WINDOW` needs the owner to name a window. Between them they
   sit above 15 nodes. **They are an email and an API call, and they are the cheapest
   unblocking actions in the entire graph** — which is precisely the reason §2.2 marks edge
   types: a reader who saw only `code` edges would go and write software instead.
3. ⚠️ **`FB-S8-01`'s 14 is the number to distrust the least and act on the most.** Ten
   separate rows name it, drawn from four different families (`A1`, `A3`, `A6`, `A9`, `A10`,
   `A11`, `D5`, `I1`), and item 16 records that nothing currently *asserts* every panel uses
   the primitives that already exist. It is the one node where the work is mostly a rail.
4. ⚰️ **`FB-OBS-01` is absent from this table and that is the trap.** Its transitive out-degree
   is 1. Its effect on the graph is that **most latency and warm claims downstream are
   currently unfalsifiable** (H2), and out-degree cannot see that. A ranking by out-degree is
   a ranking of *build* leverage only; item 25 §5 ranks it first by *evidence* leverage, and
   both rankings are right about different questions.

---

## 7. Edges I could not establish, and what would settle each

### 7.1 Where I disagree with item 16's dependency fields

Five disagreements. In each case item 16's field is quoted, mine is stated, and the settling
evidence is named. ⭐ **All five are the field being thinner than the item's own body** — none
is a contradiction of fact, and that pattern is itself the finding: a `Depends on` field is
written once and the body keeps growing.

| # | item | its field says | I record | settled by |
|---|---|---|---|---|
| **1** | `FB-A6-01` | *"`FB-A9-02` … if it lands first; nothing otherwise"* | **plus a hard `meas` edge on `MEAS-RG15`** | ⛔ Its own **Size** field: *"Confirming RG-15 first is a precondition the source states, and it is a measurement, not a build."* The field omits a precondition the same item states two lines above. One monitor cycle reading transcript coverage settles it |
| **2** | `FB-A1-01` | `FB-S8-01` *"if that lands first; nothing otherwise"* — **soft** | **soft**, siding with `FB-A1-01` | `FB-S8-01`'s own field lists `FB-A1-01` among its dependents, i.e. **harder**. The two fields disagree about polarity. I take the dependent's reading: an honest blank renders without the shared set, it just will not be consistent with the others. Settled by whichever ships first |
| **3** | `FB-D5-01` | *"`FB-S8-01` / `FB-S10-*` — CARD 7's re-open trigger is 'S8/S10 mounting the basis on a member surface', so this item **is** that trigger"* | **soft**, and relabelled: a **trigger**, not a prerequisite | The cited CARD 7 language makes `FB-D5-01` *due* when S8/S10 mount the basis; it does not make it *blocked*. The adjustment label is buildable today. Settled by reading CARD 7's trigger clause |
| **4** | `FB-X2-02` | *"Rotation breaks live subscriptions, so it needs a member-facing re-subscribe path in the same change"* | **no edge** | §2.3(2) — a same-commit co-requirement is not an ordering, and modelling it as one would split a commit that PROD-1 requires to be single |
| **5** | `FB-S9-02` | depends on `FB-S9-01` — reads as a plain build order | the same order, typed **`rail`** | Item 23 §3.6's argument is *"a rail and not four fixes"*, evidenced by the GEX family being remediated twice with `/compare` still open four lines below `/data`. Same arrow, different unblocking action, and the difference is what stops the fixes shipping first |

### 7.2 Four edges declared on one side only — a shape finding about the source

`FB-X1-02 → FB-S5-01`, `FB-X1-02 → FB-A13-01`, `FB-S11-01 → FB-S8-02`, and `FB-S8-01`'s six
claimed dependents are all stated in the **prerequisite's** field and not (or more weakly) in
the dependent's. ⛔ **A graph assembled only from the dependents' `Depends on` fields would
lose them** — including the edge that puts a backup rail upstream of the workspace document,
which is H3's second inversion. This is not an error in item 16; it is a property of a
per-item field, and it is why §3.2 was assembled by reading the field in **both** directions.
Settled by nothing — it is already settled, and recorded so the next reader does not re-derive
half the graph.

### 7.3 One edge I considered and deliberately REJECTED

**`FB-D2-01` ← `FB-D1-01` is NOT in the table.** The matrix's D2 row sequences legacy data
classes *"through D1-shaped readers until each class is migrated, never migrated by fiat"*,
which reads like an adapter-before-model ordering. ⛔ I reject it because it would **serialise
the two heaviest nodes in the graph (XL behind L) on evidence that speaks only to legacy
migration, not to D2's new Terminal-Next classes** — and item 16 records `FB-D2-01` as waiting
on nothing. A false dependency serialises work that could have run in parallel and nobody
re-checks it; these are precisely the two nodes where that would cost the most. ⚠️ Reversal
condition: if the first ten figures `FB-D2-01` addresses turn out to be legacy-sourced, the
edge becomes real and both nodes land in chain A.

### 7.4 Four architecture requirements with prerequisites here and no backlog item

⛔ **These are carried as `ARCH*` nodes so the graph is not silently short an edge, and they
are NOT proposed as items** — that is item 16's roster and item 27's scope call.

| node | requirement | source | its prerequisite here |
|---|---|---|---|
| `ARCH05-R5` | one injected, gate-checkable session block — ET clock, session, minutes since the last boundary, per-pack as-of | item 22 §4.2(5): the fifth grounding requirement, and *"today it is nowhere"* | `FB-S11-01` supplies the data; no item states the injection or the gate check |
| `ARCH05-ALLOWLIST` | per-lane tool allowlists become a function of the entitlement, not module constants | item 22 §1.2 and item 23 §3.1 (*"a parallel authorisation path is a second authority"*) | `FB-S9-04` + `ARCH06-DATACLASSES` |
| `ARCH06-CHOKEPOINT` | the publication chokepoint asking *"whose data is in this, and may it go out?"* — item 23 §3.2's third enforcement point, and the only one that **does not exist yet** | item 23 §3.2, §2.3 (R-A6-2, R-A6-3) | `FB-D1-01`'s provenance field + `DEC-DP8` |
| `ARCH06-DATACLASSES` | the `dataClasses` axis (real-time / delayed-15 / EOD) on the entitlement object | item 23 §3.1, §3.3 — ⛔ *"licensing-shaped, not product-shaped"*: A1 and R-A4-2 may **force** it before anyone chooses it as a lever | `DEC-DP7` + `FB-S9-04` |

⭐ **Three of the four cluster on one boundary** — the entitlement object and the grounding
contract — which is where items 22 and 23 hand work to each other. Settled by item 27 deciding
whether each is in scope, and by item 30 giving whichever are a backlog id.

### 7.5 Edges I could not establish at all

- **Item 24 D4 (conflation policy) and D10 (a per-board budget in bytes and server time)** map
  onto no backlog node cleanly. D4 is OPEN with *"the 10 Hz constant still unmeasured"*; D10
  re-scored the unit from connections to **bytes and server time**, which argues `FB-S1-02`'s
  bound should be expressed in bytes rather than panels. ⚠️ I did not add an edge, because
  changing a node's *unit* is not a dependency. Settled by item 27 or by whoever writes
  `FB-S1-02`'s spec.
- **`FB-I1-04`'s ordering against future AI surfaces.** Item 22 §0(3) is emphatic: the
  per-user caps already in code sum to **~$610–650/member/month** and the global caps to
  **~$68/day**, so *"at 1,000 members the six-feature base case ($3,563/month) already exceeds
  the sum of all caps: the caps as inherited would refuse members before the product reached
  its own base case."* That makes `FB-I1-04` (a population-level cap) a prerequisite of **any
  new member-facing AI surface** — but no such surface is a node in this graph, so the edge has
  no target. ⛔ Recorded as a standing rule rather than fabricated as an edge. Settled by item
  27 adding an AI surface to scope.
- **Whether `FB-S9-02`'s four "plain omission" families need a decision each.** Item 23 GAPS
  records that four routes take `request: Request` with an inline-check idiom available, so
  *"no `Depends` is not the same as no check"*. Settled by **reading four function bodies** —
  which this document could not do (no source read).
- **Every edge that would depend on a live flag state.** Items 22, 23, 25 and 37 all state
  the same ceiling: `railway variables --service web --kv` is the only authority and none of
  them ran it. So *"this is already on"* is unavailable as an edge-removing fact anywhere in
  this graph.
- **Any edge from the four Wave-Q1/notebook or joystick programmes.** Out of this document's
  inputs entirely; if a Terminal-Next node shares a file with one, this graph cannot see it.

---

## GAPS

- ⛔ **SHA not pinned (no git by instruction).** Every artifact reference is to the working
  tree of `C:\Users\Patrick\uct-worktrees\terminal-research` and, for the concurrency
  constraints only, `_merge-master`, as read on 2026-09-26. Nothing ties them to a commit.
- ⛔ **No source file was opened.** No `file:line` here was resolved by this document; all are
  carried through item 16 and items 22–25, which state their own decay. Item 25 §1 records two
  artifacts citing a comment ~870 lines from where it lives, so **grep the quoted string, not
  the number**, if a tree has moved.
- ⛔ **No measurement, no test, no probe, no network call, no `railway` command.** So this
  document cannot remove a single `meas` or `vend` edge, only name it.
- **The chain assignment in §5.1 is not file-derived.** It is a judgement from row letters and
  the matrix's tiers. Two lanes I call disjoint could collide in one file, and only a file-tree
  read would show it. ⚠️ That is the most likely error in §5.
- **Soft/hard is item 16's wording, read by me.** Where its field hedges (*"nothing hard"*,
  *"if it lands first"*), I recorded soft. A reader who thinks an edge is mis-typed should
  re-read the field before re-planning around it — and §7.1 shows the fields are already
  thinner than their bodies twice over.
- **No effort, no duration, no cost.** Every size band is carried verbatim from item 16, whose
  own frontmatter calls a band *"a judgement about shape, not a measurement"*. ⛔ Nothing here
  supports a date.
- **The transitive out-degree numbers move if a single soft edge is re-typed.** They are
  computed over any-strength edges; `FB-S8-01`'s 14 includes three soft direct edges
  (`FB-A1-01`, `FB-A10-01`, `FB-D5-01`) and the sub-trees they carry. **Its hard-only
  transitive count is 9** — derived the same way, over the hard rows only. ⚠️ Both numbers are
  true and they answer different questions; §6 ranks on the any-strength one, so a reader
  planning strictly around blockers should use 9.
- **`GATE-STAGE-1` is one node standing for thirteen.** Item 37 §4's checklist was cited as a
  set rather than expanded, deliberately, so this document does not become a second authority
  over it. The cost: this graph cannot tell you which of the thirteen is furthest from done.
- **Item 26 (coexistence) is NOT STARTED and is not an input.** `/calendar` is
  TERMINAL-CURRENT with nine reader classes (CP-01), so there are almost certainly coexistence
  edges — *"retiring the surface ≠ retiring the contract"* — that this graph does not carry.
  ⛔ **Absence of a coexistence edge here is not evidence there is none.**
- **No competitor, no vendor, no telemetry.** Inherited from item 16 at one further remove.

## SOURCES

**Programme artifacts, read in `C:\Users\Patrick\uct-worktrees\terminal-research`:**
`05-product-strategy/feature-opportunity-backlog.md` — item 16, **the primary edge source**;
its 85 `FB-*` ids were enumerated by pattern match and its `Depends on` and `Size` fields
extracted per item rather than read prose-first ·
`07-technical-architecture/realtime-performance-architecture.md` — item 24, in full (§0, §1.3,
§1.5, §2.1–§2.6, §3 Q1–Q10, §4 D1–D10, §5.1–§5.3, §6, GAPS) ·
`09-security-licensing-cost/security-entitlement-architecture.md` — item 23, in full (§0,
§1.2–§1.7, §2.1–§2.3, §3.1–§3.6, §4, GAPS) ·
`08-ai/ai-architecture.md` — item 22 (§0, §1.1–§1.6, §4.1–§4.2, and the section index for
§2–§6) · `10-roadmap/observability-plan.md` — item 25, in full (§0, §1, §2.1–§2.4, G-1…G-10,
§4.1–§4.9, §5, §6, GAPS) · `10-roadmap/rollout-rollback.md` — item 37 §4 (the thirteen
prerequisites) and §5 (RB-1…RB-11) and §6 ·
`05-product-strategy/capability-infrastructure-matrix.md` — the 33-row spine, in full ·
`01-existing-system/capability-ledger.md` §R (derived counts, the PC-dependent set, the
corrected "absent" cell) · `00-program-control/CRITICAL_PATH.md` (CP-01…CP-12, in full) ·
`00-program-control/MASTER_CHECKLIST.md` rows 25–37 (this item's row, and the status of items
26, 27, 28, 30) · `12-decisions/DECISION_CARDS_2026-09-26.md` — **CARD 17** (the fresh owner
ruling: one paid tier) plus CARDS 15, 16, 18 and the owner-vs-agent table at its foot.

**`C:\Users\Patrick\uct-worktrees\_merge-master\CLAUDE.md`, read READ-ONLY, for §5.2 only:**
the agent-concurrency ruling and its two measured losses · the 2026-09-12 three-concurrent-gate
OOM sweep and the destroyed `.git` file · the `--collect-only` 6.6 GB figure · the 13-agents
aggregate failure · the disturbance-interval rule (six-shard gate 46–92 min vs 56 commits in
92 min) · the one-master-merge-at-a-time ruling, the 2026-09-12 502 and the 14-push
per-service deploy measurement. ⛔ Nothing else in that file was used, and no source file in
that worktree was opened.

**Derivation (over this document's own output, in the session scratchpad):** §3.2's rows as a
tab-separated `(dependent, prerequisite, type, strength)` edge list → edge and node counts,
type and strength histograms, the in-degree-zero sets, transitive out-degree per node, and the
longest-path computation reported in §3.1, §3.3, §4.1 and §6. ⛔ **No count in this document
is hand-typed beside the table it describes.**

## ⛔ What this document does NOT decide

1. **⛔ It does not sequence anything in time.** No dates, no waves, no order of delivery
   beyond what an edge forces. **MASTER_CHECKLIST item 28 (`10-roadmap/roadmap.md`, NOW /
   NEXT / LATER / NOT PLANNED) owns sequencing**, and §5.3's "shape" is explicitly not a
   schedule.
2. **⛔ It does not choose scope.** Every one of the 85 `FB-*` nodes is carried because item 16
   listed it, not because it should be built. **Item 27 (`10-roadmap/mvp.md`) owns what is in
   and out**, and §4.2's critical-path choice names its own reversal condition for exactly
   that reason.
3. **It does not rank by priority.** §6 ranks by out-degree, which is leverage over the graph
   and nothing else. **Item 17 (`feature-scoring.md`) owns value, urgency, effort and owner
   intent** — and item 16 says so of its own ordering too.
4. **It does not size or estimate.** Every band is item 16's. No duration, cost or headcount
   appears anywhere, and an edge is never a duration (§2.3).
5. **It does not decide any of the 18 `DEC-*` nodes.** Not the panel count, not the maximum
   displayable age, not the topology, not DP-1…DP-8, not the tier numbers (CARD 17 leaves
   price, trial and seat model explicitly undecided), not the quiet window, not the P-δ
   posture, not seeded-or-empty, not OI-15 or OI-16, and not any spend.
6. **⛔ It does not reopen CARD 17.** There is **one paid tier**; no node here is "build the
   tier gating", no chain forks by tier, and `DEC-DP2` bounds only numbers inside that single
   boundary. `FB-S12-01`'s cohort is a cohort, never a tier.
7. **It does not decide whether the four `ARCH*` requirements in §7.4 are deliverables.** It
   records that they have hard prerequisites in this graph and no backlog item, and stops.
8. **It does not touch production, code, flags, or any other file.** No edge here was acted
   on; the four open route families, the Cloudflare rule, the p95 instrument and the channel
   split are all named for a normal engineering session, exactly as items 23, 24 and 25 say.
9. **It does not claim the graph is complete.** Item 26 (coexistence) is NOT STARTED, four
   architecture requirements have no item, and a node absent from §3.2 is **unexamined, not
   independent**.
