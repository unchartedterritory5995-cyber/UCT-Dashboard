---
id: H-03
title: Engineering Backlog — the Part CCI work packages, each with a rollback tier and a testable acceptance criterion
role: >
  The engineering-backlog deliverable. MASTER_CHECKLIST item 30
  (`10-roadmap/backlog.md`, owner H-03, status NOT STARTED before this file), against
  GOVERNING_PRINCIPLES item 20 — *"Engineering backlog in the Part CCI schema with testable
  acceptance criteria"*. It CONVERTS item 16's 85 `FB-*` opportunities into engineering work
  packages and adds the packages no feature backlog contains. ⛔ It does NOT re-derive the
  opportunities (item 16), does NOT re-score them (item 17), does NOT choose scope (item 27),
  and does NOT schedule work in calendar time (item 28).
wave: 4
group: H
category: roadmap
inputs: >
  `00-program-control/charter/C-master-directive.md` **Part CCI at :2262–:2268 — the schema, found
  and followed field-for-field, not invented** ·
  `05-product-strategy/feature-opportunity-backlog.md` (item 16 — 85 `FB-*` items; the raw material) ·
  `05-product-strategy/feature-scoring.md` (item 17 — seven axes over all 85; its `REV` column is
  this file's rollback-tier source and its six bands are this file's id order) ·
  `10-roadmap/rollout-rollback.md` (item 37 — the six tiers at :308–:315, the decision table at
  :687–:696, RB-1…RB-11 at :774–:784, the thirteen prerequisites at :708–:763) ·
  `10-roadmap/dependency-graph.md` (item 29 — 118 nodes / 109 typed edges; the concurrency ceiling
  that bounds §7) ·
  `04-workflows/workflow-library.md` (item 14 — the BREAK-OUT ledger §5 at :1197, its §5.1
  correction at :1205) ·
  `05-product-strategy/proprietary-advantage-inventory.md` (item 15 — the 14 ACCUMULATED assets at
  :309–:322 and the five `NO-SURFACE-FOUND` rows at :593–:594) ·
  `10-roadmap/mvp.md` (item 27) · `04-workflows/jobs-to-be-done.md` (item 13) ·
  `12-decisions/DECISION_CARDS_2026-09-26.md` (CARD 4, 5, 6, 10, 11, 15, 16, 17, 18, 20, 22, 23,
  24, 25, 26, 27) ·
  `00-program-control/GOVERNING_PRINCIPLES.md` §12, §13 · `05-product-strategy/non-goals.md` NG-01…NG-03 ·
  **`origin/master` read directly per ticket via `git show` / `git grep` — the check item 16's own
  ceiling says it could not run**
scope: uct-dashboard (`app/` + `api/`), with named cross-repo tickets in morning-wire and uct-intelligence
confidence: 🟡 medium overall — 🟢 on the schema, the register arithmetic and every `origin/master` grep; 🔴 on any acceptance criterion whose fixture does not yet exist
evidence_ceiling: >
  No test suite was run (an unscoped `pytest` on this box reached 18 GB and was OOM-killed) and no
  flag state was read (no Railway access, and none attempted) — so every flag below is NAMED and
  marked UNREAD. `origin/master` was read at the file level, not executed: a module that exists is
  not a module that runs. Six of the thirteen `api/main.py` line coordinates cited by upstream
  artifacts have already drifted once (item 15 §6.4), so line numbers in this file are pinned to the
  `origin/master` read of 2026-09-26 and will drift again.
sources: docs/terminal-research/00-program-control/charter/C-master-directive.md, docs/terminal-research/05-product-strategy/feature-opportunity-backlog.md, docs/terminal-research/05-product-strategy/feature-scoring.md, docs/terminal-research/10-roadmap/rollout-rollback.md, docs/terminal-research/10-roadmap/dependency-graph.md, docs/terminal-research/04-workflows/workflow-library.md, docs/terminal-research/05-product-strategy/proprietary-advantage-inventory.md, docs/terminal-research/12-decisions/DECISION_CARDS_2026-09-26.md, origin/master
uct_relevance: high
status: draft
date: 2026-09-26
---

# Engineering Backlog — Part CCI

## 0. Headline — the three things writing the tickets revealed that scoring them did not

⛔ **None of the three is a priority claim.** Item 17 owns the order and this file does not re-open
it. All three are consequences of the one act this document performs that no upstream artifact
performed: **it opens `origin/master` once per ticket before writing the ticket.**

### H1. ⚰️⚰️ Three of the eight highest-leverage items in the backlog are tickets to build something that already ships — and one of them is a band-2 enabler with three items behind it

Item 16 states its own ceiling plainly: *"no source file was opened, so every 'what exists today' is
an artifact's measurement at its own date"*
(`05-product-strategy/feature-opportunity-backlog.md` §GAPS, restated in MASTER_CHECKLIST row 16).
This file ran that check. Three results are large enough to change a band:

| item | item 16 says | `origin/master` says, measured 2026-09-26 | consequence |
|---|---|---|---|
| **`FB-S3-01`** the entity master | *"**Today. Absent.**"* (`:875`), sized **L** *"a new system with a schema other systems key against"* (`:877`), band 2, `b3` | **It ships.** `api/services/entity_master/{schema,store,api,reconciliation}.py` + three test modules; tables `entities` · `entity_aliases` (dated, `valid_from`/`valid_to`, `idx_alias_lookup`) · `entity_vendor_symbols` · `entity_figi` · `entity_relations` · `entity_events` · `_migrations`; `api/routers/entity_master_admin.py` included at `api/main.py:8834` under `/api/admin/entity-master/*`; `scripts/entity_master_seed.py` | ⛔ **ADMIN-MOUNTED, not absent.** The ticket is a member resolution path, an adoption rail and a seed — **not a build**. Band still 2 (the `b3` leverage is unchanged); size recut **L → M** |
| **`FB-S8-01`** the provenance set | **M** *"because two of the four primitives already ship"* (item 17 §4.6; item 16 §2.4 ⚰️ 2) | **All four ship.** `app/src/components/provenance/` holds `Provenance.jsx` · `FreshnessBadge.jsx` · `CoverageLine.jsx` · `Cited.jsx`, each with a `.test.jsx` and a `.module.css`, plus `freshnessContract.js`, `availabilityContract.js`, `presentationFormat.js`, `sessionStale.js` | ⛔ There is **no extraction half left**. It is a rail plus adoption. Size recut **M → S for the rail, M for adoption** — and this is the item with `b11`, so the recut moves the cheapest lever in the file |
| **`FB-D2-01`** canonical model + address book | **XL**, *"the system other systems are rewritten against"*, `b5`, and `FB-A13-01` *"blocked entirely"* on it | **CP1 and CP2 ship.** `api/services/canonical/{address_book,dual_read,dual_sample_store,indicator_axis}.py` + `api/data/canonical_address_book.json`; `address_book.py:1` is headed *"D2 CP2 — ⭐ THE FIRST PRODUCT READER OF THE CANONICAL ADDRESS BOOK"* and records that CP1's rail *"required that this file not exist"* and was **narrowed, not deleted** | ⛔ XL is still right for the whole system, but the **first two checkpoints are paid for** and the file names the next one itself: *"NOT A RESOLVER. The five-status `resolve(address) -> Resolution` in SPEC-D2 §3 is CP3 and needs its own line."* The ticket is CP3, not D2 |

⭐ **The pattern, stated as a rule rather than three anecdotes:** every one of these three was recorded
as absent by an artifact that *could not open source*, and each absence was **directional** — all three
errors run the same way, toward "we have not built it". That is the opposite direction from the one
item 15 measured on the capability ledger (five cells understated, **one overstated**), which is why
*"a ledger cell is a dated measurement whose error has no reliable sign"* is the safe reading and
*"artifacts always understate"* is not. ⛔ **An "absent" cell is the one that gets acted on**
(item 14 §5.1 :1207), so the direction of the error matters more than its size.

### H2. ⛔⛔ 25 of the 93 tickets in this file have no rollback tier, and this document does not give them one

Item 37 publishes six tiers at `10-roadmap/rollout-rollback.md:308–:315` and they are **bare integers
0–5 with a short label** — there is no `RB-`/`T-` id for a tier and the document's own reference form
is "tier 0" … "tier 5". Item 17 swept all 902 lines of it for `migrat|schema|database|irreversib` and
found nothing; a second independent sweep for
`schema|migration|irreversib|destructive|no tier|not reversible|one-way|cannot be rolled` confirmed
**zero hits for schema, migration, irreversible, one-way or "cannot be rolled back"** anywhere in the
file. ⛔ **So the honest statement is narrow and it matters: item 37 does not claim these shapes are
un-rollbackable — it never mentions them.** `R3` is item 17's label for a hole
(`05-product-strategy/feature-scoring.md:322`: *"⛔ `R3` is **my label for a hole in item 37**, not
its vocabulary"*), and this file carries it forward as **`TIER-NONE`** on the ticket itself.

Every ticket below therefore carries a **ROLLBACK TIER** field whose only permitted values are
item 37's own tiers or the honest absence:

| value | meaning | item 37 citation |
|---|---|---|
| `tier 0–2` | comes back without a build: a per-browser write, a request-time flag in `_access_payload`, or a backend capability gate plus one redeploy | `:310`, `:311`, `:312` |
| `tier 4 pref / 3` | comes back on a build — the pre-authored pre-gated branch first, plain revert-and-push only if no branch exists | `:692`, `:314`, `:313` |
| `TIER-NONE` | ⛔ item 37 names **no** tier for this shape. Not "tier 6", not "hard", not "needs care" — **absent** | established by the two sweeps above |

⛔ **A ticket marked `TIER-NONE` is not blocked and is not forbidden.** It is a ticket whose reversal
plan does not exist yet, which is a deliverable owed to item 37 and a fact the ticket must carry to
its author rather than discover in an incident. **This file invents no sixth tier**, because a tier
nobody wrote down is not made real by a backlog naming it — and item 37's own GAPS 8 already records
that even the 63 with a tier have an unexercised one: *"A tier nobody has pulled in anger is a
procedure, not a capability."*

### H3. The thesis-aligned work is 6 tickets, and only 2 of them come from the break-out ledger

CARD 25's thesis — *"the goal is to aggreagte all the best features so someone can only use our site
instead of the others"* (`12-decisions/DECISION_CARDS_2026-09-26.md:674`, verbatim, typo intact) —
makes **coverage** the binding constraint, so item 14's ADDRESSABLE break-outs should be the
highest-value engineering work in the programme. Converting them into tickets shrinks the set twice:

1. ⚠️ **The count item 14 tells you to trust is stale in the direction that costs money.** Its §5.1
   correction (`04-workflows/workflow-library.md:1205`) withdraws `WF-C03` and `WF-C06` from the
   table because the trailing implied-vs-realized calibration *"is not absent. It ships, and it is
   mounted"* — `app/src/components/research/sections/SetupSection.jsx:19`/`:241`, the section's own
   **hero**. But the derivation command it names in the same breath
   (`grep -c '^- \*\*Break-out\.\*\* ADDRESSABLE'`, §2.5) **still returns 7**, because the withdrawal
   edited the §5.1 table and not the two per-workflow `Break-out.` fields at `:728` and `:787`.
   **The table shows 5; the command shows 7.** Tickets here are cut from the 5. (Reported, not
   repaired — §9 contradiction 1; the fix is item 14's.)
2. ⭐ **Of the surviving 5, only 2 yield an engineering ticket nothing else covers.** `WF-C11` is
   *"partly closed already — the transpilers exist **because** of this exit"* and its remaining half
   is the rule vocabulary, which is `FB-S7-01`/`FB-A9-01`'s; `WF-C13` and `WF-C09` are the same
   posture and the same single cheap observation, whose deliverable is a **measurement** and whose
   subject is owner-held (CP-06). That leaves **`WF-B06`** (an inbound alert receiver — the
   strongest-evidenced row of the five, tool owner-confirmed twice) and **`WF-C12`** (a generated
   answer that returns the product's own editable object instead of prose about one).

⭐⭐ **And the larger thesis-aligned seam is not the break-out ledger at all — it is item 15's
unexposed assets, which no feature backlog contains by construction**, because item 16 was built from
capability gaps and competitor features and **an asset with no surface has no row in either.** Item 15
finds 5 of its 14 ACCUMULATED assets `NO-SURFACE-FOUND`, *"including the strongest row in the
document"* (`:593`). Four of the five become tickets here; one does not, and the reason is a grep:

- ✅ **`ACC-02`, the decision record** — `wire_universe` × `wire_issues`, **22,574 rows / 60 issues,
  `dropped_at_stage = 2` → 19,611** names considered and rejected with the stage each died at
  (`:310`). Item 15: *"highest defensibility, zero consumption — is the most actionable finding in
  this document"*, closeable *"by a join and a permission model rather than a data-collection
  programme"* (`:343–:347`). ⛔ On `origin/master` the table has exactly one reader,
  `api/services/wisdom/evals/replay.py:192–:198`, and it is inside the **admin/internal** Wisdom
  Loop — so there is a reader and **no member route**. → **TERM-088**.
- ✅ `ACC-10` the Morning Wire payload archive, *"no replay surface exists"* (`:318`) → **TERM-089**.
- ✅ `ACC-06` the episodic-pivot outcome record (`:314`); on master `ep_candidates` /
  `ep_follow_throughs` appear only in `api/services/test_brain_service.py` and the same admin Wisdom
  replay → **TERM-090**.
- ⚰️ **`ACC-13` the curriculum is a RECUT, not a build** (`:321`, *"in git and in no product DB"*).
  A member-facing education surface already ships — `api/services/education_service.py` over
  `/data/education.db`, *"surfaced on the paid Educational Videos tab"*, `edu_videos` + `edu_paths`
  with six seeded Learning Paths, mounted at `api/main.py:8852`. But its path steps are **YouTube
  ids** seeded from `api/services/education_paths_seed.py::SEED_PATHS`, not lessons — so
  `docs/curriculum/`'s 79 lessons and 7 printable artifacts are genuinely not in it. **The ticket is
  a loader into a shipped store, not a surface** → **TERM-091**.
- ⚰️⚰️ **`ACC-08` is NOT a ticket, and item 15's cell for it is wrong on master.** It is recorded
  `NO-SURFACE-FOUND` *"(internal by design)"* (`:316`) — but
  `api/routers/intelligence.py:363 list_coaching_notes` reads `coaching_notes` at `:378`/`:385`
  behind `_user: dict = Depends(require_paid)` at `:366`. **That is a paid-member route.** Item 15
  hedged this correctly in advance — *"`NO-SURFACE-FOUND` is an absence of evidence from this pass,
  not proof of absence"* (`:303–:305`) — and the evidence exists. §9 contradiction 2.

⭐ Plus two tickets that are neither: **TERM-092**, CARD 27's verified production defect (a guard that
cannot fire), and **TERM-093**, the instrument behind the one observation H3(2) says is the cheapest
thing on the board.

---

## 1. The schema — Part CCI, verbatim, with one field added and two refused

### 1.1 ⭐ Part CCI was found. It is a Part of charter Document C, and this is its text

`00-program-control/charter/C-master-directive.md:2262` is the heading
`# PART CCI — FINAL IMPLEMENTATION BACKLOG`. Its body, at `:2264–:2268`, verbatim:

> Translate strategy into engineering work packages at `10-roadmap/backlog.md`. Each package needs:
> ID (e.g., TERM-001); Title; User outcome; Context; Dependencies; Existing code to reuse;
> Files/modules likely affected (with repository); Data requirements; API work; UI work; Testing;
> Observability; Risks; Acceptance criteria; Estimated complexity (XS / S / M / L / XL);
> Parallelizable? (Yes / No / Partial); Blocked by (IDs).
>
> This should enable parallel agent implementation later.

Corroborated in two places that name the same schema and the same path:
`00-program-control/charter/B-execution-operating-system.md:1581` and
`00-program-control/GOVERNING_PRINCIPLES.md:105` both read
*"| 20 | Engineering backlog in the Part CCI schema with testable acceptance criteria |
`10-roadmap/backlog.md` |"*, and `00-program-control/AGENT_REGISTRY.md:172` assigns
*"H-03 | Backlog author (Part CCI schema) | `10-roadmap/backlog.md`"*. **Seventeen fields, and the
`TERM-001` id form is the charter's own example.** Every package in §4 and §5 carries all seventeen
in this order, and no field is silently dropped: where a field is empty the package says so and why.

⚠️ **Three facts about the schema worth stating, because they shape everything below.** It has
**no size-in-days field** (complexity is a band, and item 16 is explicit that *"no band is a
measurement and none should be read as an estimate"*). It has **no cost field** — which is fortunate,
because CARD 25 §5 de-scopes costs and usage outright. And its `Estimated complexity` scale is
**XS/S/M/L/XL** while item 16's is **S/M/L/XL**: no item in the input is XS, so `XS` appears below
only where this file's own recut makes a package smaller than the S band it inherited, and it says so
at the ticket.

### 1.2 The one field added: ROLLBACK TIER — and why it is an addition rather than a sub-field of Risks

Part CCI has a `Risks` field, and a rollback tier could be buried in it. ⛔ **It must not be**, for the
reason item 17 makes structural: *"the two filters that remove the most are the two a
value-versus-effort matrix does not have columns for — whether it can be rolled back, and whether its
observable can actually be computed"* (`05-product-strategy/feature-scoring.md` §1 H1). A fact that
removes more candidates than size and dependency combined is an **axis**, and an axis folded into a
prose field is a fact nobody sorts on. The second of those two filters already has a home in
Part CCI — `Acceptance criteria` plus `Observability` — so only the first needed a column.

⭐ **The field is declared as an addition, not smuggled in as though the charter asked for it.**
Part CCI's field list is seventeen items long and `ROLLBACK TIER` is not among them. It is the
eighteenth, added by this file under the instruction that an engineering backlog shipping a ticket
with no rollback tier is the defect item 17 named, and it is the last field of every package so that
the seventeen above it read exactly as the charter lists them.

### 1.3 ⛔ Two fields considered and refused

- **A value, score, or priority number.** Refused, and the refusal is item 17's:
  *"The value axis is not available here, and inventing it would be the single worst thing this
  document could do — it would convert a guess into a number that item 28's roadmap then treats as
  evidence"* (§2). Item 17's four missing inputs (no cost, no revenue/tier mix, no member demand, no
  usage rates) are all still missing at the time of writing, and CARD 25 §5 de-scoped two of the four
  permanently. **This file's ticket order is item 17's band order and asserts nothing else.**
- **A cost, spend or usage estimate.** Refused by owner instruction, CARD 25 §5, verbatim:
  *"Dont worry aobut anything else on costs or uses."* ⚠️ **Licensing is not de-scoped and is not the
  same question.** CARD 26 §4's rule binds every ticket below: *"licensing is CLEARED for the current
  estate and OPEN for each new data source the roadmap adds."* So each package's
  `Data requirements` field ends with a licensing verdict of exactly one of **`CLEARED (existing
  estate, CARD 26)`** or **⚠️ `OPEN — new source`**, and no ticket carries a price.

### 1.4 ⛔ Field widenings, declared

Two of Part CCI's seventeen fields are used slightly wider than their names suggest, and both
widenings are stated here rather than at 93 tickets:

1. **`Blocked by (IDs)`** accepts a **person or an act** as well as a ticket id — "the owner naming a
   quiet window", "a Cloudflare credential", "a Massive request". Item 29 found this necessary for the
   same reason: *"two of its top nine nodes cannot be cleared by engineering at all"*. A blocker that
   is not an id is written as `⛔ ACT:` so it cannot be mistaken for a ticket that was never written.
2. **`Files/modules likely affected (with repository)`** names the repository on every line, because
   five files are **partner-owned** (`OptionsFlow.jsx`, `schwab_router.py`, `live_massive_router.py`,
   `massive_ws_worker.py`, `massive_processor.py`) and three tickets land in a **different
   repository** (morning-wire, uct-intelligence). A partner file is marked `⚠️ PARTNER` and the
   package says the change routes through the partner boundary, per
   `project_partner_collab_branch`, rather than being an ordinary edit.

### 1.5 ⛔⛔ The four boundaries no ticket in this file may cross

Stated once, here, because a reader scanning 93 tickets will not re-derive them:

1. ⛔⛔ **No execution and no order management.** `GOVERNING_PRINCIPLES.md` §13; `non-goals.md`
   NG-01…NG-03; CARD 25 §2 — *"'Only use our site' cannot include placing the trade."* **A step that
   needs a funded brokerage account is a STRUCTURAL BREAK-OUT, never a ticket.** Item 14 §5.2 names
   the two workflows that are exactly that shape — **`WF-C14`** (order placement) and
   **`WF-B07`** (thinkorswim/Schwab, *"inseparable from a funded brokerage account"*) — and neither
   appears anywhere in §2, §4 or §5. **No package below proposes an order path, an order preview, a
   position write, or a broker credential with write scope.** TERM-086 is an **inbound** receiver and
   §5 states that boundary in the ticket.
2. ⛔ **One paid tier.** CARD 17, owner ruling 2026-09-26: *"there is one paid tier only that is it."*
   No ticket compares tiers, prices anything, or gates behind a higher tier. The entitlement axis is a
   **binary** — paid or not — which is why `TERM-081` (`FB-S9-04`) is about toolkits and limits and
   says so.
3. ⛔ **Two products, two populations, never one denominator.** The Whop Discord is ~750 **paying**
   members (CARD 25 §3) and is **out of boundary**; UCT Intelligence is ~26 accounts, **13** with any
   page-view row. Any acceptance criterion that counts members states which population it counts.
4. ⛔ **No flag state is asserted.** No Railway access here and none attempted. Every flag is **named
   and marked `UNREAD`** — including `TERMINAL_NEXT_ENABLED`, which item 37's entire ladder rests on
   and which **does not occur anywhere on `origin/master`** (`git grep -c TERMINAL_NEXT_ENABLED
   origin/master` → no output, i.e. zero files). ⚠️ That is a measurement of the **repository**, not
   of the pod: a variable can be set in Railway and referenced nowhere in git, and the reverse. What
   it does establish is that item 37's prerequisite 1 — *"`TERMINAL_NEXT_ENABLED` declared in
   `docs/feature_flags.json`, with a name the AST index can see"* (`:710`) — is **not met in source**.

### 1.6 ⛔ Three states, on every ticket that touches something that might exist

Item 15 §0.5 (`:148–:161`) publishes the vocabulary this file uses, because *"the capability ledger's
recurring collapse is treating 'not on a member surface' as 'absent'"*:

- **ABSENT** — no code.
- **ADMIN-MOUNTED** — code exists, a router is included in `api/main.py`, and every route is
  `require_admin` or `require_push_secret`. *"Materially different from absent **and** materially
  different from populated-and-serving-members."*
- **MEMBER-SERVING** — a route a paying member can reach.

⚠️ And the fourth, independent fact item 15 attaches: **whether the store behind it holds any rows**
is a separate question this file cannot answer from here, so no package claims a store is empty.
Every `Context` field below that asserts what exists names one of the three states and the grep that
established it.

---

## 2. The register — every ticket, one row, with its rollback tier

### 2.1 The id scheme, and what the number encodes

`TERM-<nnn>`, zero-padded to three, per Part CCI's own example. ⭐ **The numeric order is item 17's
band order, so the id itself carries the band** — `TERM-001…010` are band 0, `…011…018` band 1,
`…019…026` band 2, `…027…036` band 3, `…037…062` band 4, `…063…085` band 5, and `TERM-086+` are the
tickets this file adds that no `FB-*` item covers. ⛔ **Within a band the number asserts nothing.**
Item 17 is explicit — *"Within a band the order is not asserted"* — because five of its seven axes are
ordinal with unequal steps, and a reader who treats `TERM-041` as ahead of `TERM-042` is doing
arithmetic the axes cannot support.

⚠️ **The mapping is 1:1 and total over all 85, including the ten that are not builds.** A band-0 item
gets an id rather than being dropped, because an engineering backlog that silently omits the held items
is how a held item becomes an assumption — and three of the ten gate other bands. Their `STATE` says
`HELD` or `⛔ ACT` and they carry no work package in §4; §6 carries them instead, with the held input
named, because **there the held thing is the deliverable**.

**Column legend.** `SZ` = the size band, item 16's, **recut only where a `origin/master` grep changed
it and the recut is stated at the ticket** · `DEP` = item 29/17's depth·blocks · `ROLLBACK` = §1.2's
three values · `PAR` = Part CCI's `Parallelizable?`, bounded by item 29's real ceiling (§7) ·
`STATE` = `BUILDABLE` / `HELD` (blocked on a named act) / `⛔ ACT` (not an engineering act at all) /
⚰️ `RECUT` (item 16's "today" was wrong on master and the ticket changed shape).

### 2.2 Band 0 — HELD (10). Not builds. §6 carries them.

| TERM | FB | short title | SZ | DEP | ROLLBACK | PAR | STATE |
|---|---|---|---|---|---|---|---|
| TERM-001 | `FB-S1-02` | Publish a board-size bound; the number is a person's | S | d0·b0 | tier 4 pref / 3 | Partial | HELD |
| TERM-002 | `FB-A10-05` | Ask Massive for a second OPRA connection | S | d0·b0 | **TIER-NONE** | No | ⛔ ACT vendor |
| TERM-003 | `FB-A10-06` | Confluence Radar: extend or delete | S/M | d0·b0 | **TIER-NONE** | Yes | ⚰️ MOOT, 2026-09-29 — the premise was wrong. Capability ledger G9 was corrected 2026-09-27: Confluence Radar is NOT dormant — it ships as the **8th tab of Options Flow** (`pages/Confluence.jsx`, `hooks/useConfluence.js`, live `GET /api/confluence`, refresher thread in `api/main.py`), members use it, and the ledger struck "extend or delete (product decision)" because acting on it would duplicate or delete a live surface. No decision is open. |
| TERM-004 | `FB-A5-01` | One canonical earnings-date authority (OQ-14) | S/M | d0·b0 | tier 4 pref / 3 | Yes | HELD |
| TERM-005 | `FB-A9-03` | A second whole-market screener universe | L | d1·b0 | tier 4 pref / 3 | No | HELD purchase |
| TERM-006 | `FB-S8-02` | One shell-level freshness authority, in time units | S | d1·b1 | tier 4 pref / 3 | Yes | HELD 1 sentence |
| TERM-007 | `FB-OBS-07` | Declare a quiet measurement window | S | d0·b3 | **TIER-NONE** | — | ⛔ ACT scheduling |
| TERM-008 | `FB-OBS-08` | Read the Cloudflare rule and cache key | S | d0·b0 | tier 0–2 | No | HELD credential |
| TERM-009 | `FB-X1-01` | Mark the community's shared calls, losses included | M | d1·b0 | **TIER-NONE** | No | ✅ BUILT 2026-09-29 — owner ruling **OPT-IN PER MEMBER**. Built on the shipped price-at-mention marks (`ticker_marks`, every $TICKER a member types). `api/services/community_call_record.py` reports each mark's MOVE since the mention — up / down / flat (±0.5% band), median, and UNPRICED counted never dropped; ⛔ never "wins": a mention has no direction. `GET /api/community/members/{id}/calls` 404s for another member unless the owner published it (`call_record_optin`, off by default); the owner always sees their own, marked private. `PUT /api/community/me/call-record` publishes or hides; hiding never deletes a message or a mark. Profile card renders it, with the switch on your own card only. Rails `tests/api/test_community_call_record.py` (5) + `CallRecord.test.jsx` (3, rendered text); mutation-proved both sides (opt-in check removed → 2 red; switch shown to all → 1 red). |
| TERM-010 | `FB-X3-02` | First-run is a fork of an expert's board | S–M | d0·b0 | tier 4 pref / 3 | Yes | ✅ BUILT 2026-09-29 — owner ruling: **the UCT Default layout**. Re-measured first: first run ALREADY seeded UCT Default's arrangement (`resolveDefaultLayout`, since `9971df214`), but not its look — a new member kept generic chart defaults. Now a member with no board AND no `chart_settings` gets the WHOLE UCT Default through the same `applyUctDefault` the Open Layout menu runs (quiet: no menu close, no "Saved" flash), so the two cannot drift; a member who already has chart settings keeps them; a DB "chart" template still wins. Rails in `ChartsWorkspace.test.jsx` (2, rendered widgets + the persisted look); mutation-proved both ways. |

### 2.3 Band 1 — THE MEASUREMENT FLOOR (8). Packages at §4.1.

| TERM | FB | short title | SZ | DEP | ROLLBACK | PAR | STATE |
|---|---|---|---|---|---|---|---|
| TERM-011 | `FB-S7-03` | A second delivery channel; split ops from business events | S | d0·**b6** | tier 0–2 | Yes | ◐ BUILT, INERT — steps 1–7 on master (`2962e9c8d`, `f68eaefa7`, `dd1e938d9`); split takes effect only when the owner creates the ops channel and sets `DISCORD_OPS_WEBHOOK_URL` + `OPS_ALERT_EMAIL_TO` (flow-worker set = after hours) (re-verified against origin/master 2026-09-30) |
| TERM-012 | `FB-OBS-01` | Make CARD 16's p95 gate measurable | S | d0·b1 | tier 4 pref / 3 | Yes | ✅ BUILT 2026-09-29 |
| TERM-013 | `FB-OBS-02` | Read the drop counters on a schedule | M | d1·b1 | tier 4 pref / 3 | Yes | ✅ BUILT `c70bbc347` (`bars_rail_monitor.py`); page dark until `BARS_RAIL_PAGE_ENABLED` is set by the owner (re-verified against origin/master 2026-09-30) |
| TERM-014 | `FB-OBS-03` | RSS-slope reader + per-subsystem attribution | L | d2·b1 | tier 4 pref / 3 | Yes | HELD via 007 |
| TERM-015 | `FB-OBS-04` | Cadence heartbeat + daily dead-man roll-up | M | d1·b3 | tier 4 pref / 3 | Yes | ✅ BUILT `1d5f0dee4`, ARMED on terminal-next-monitor (`CADENCE_ROLLUP_ENABLED`); first 16:20 ET post not yet confirmed from here (re-verified against origin/master 2026-09-30) |
| TERM-016 | `FB-OBS-05` | Durable cooldowns for `chart_health_alerts` | S | d1·b1 | tier 4 pref / 3 | Yes | ✅ BUILT `cda688ef7` — durable `alert_cooldown` table (re-verified against origin/master 2026-09-30) |
| TERM-017 | `FB-OBS-06` | Loop-lag distribution, so CARD 18's window can exist | M | d2·b1 | tier 4 pref / 3 | Yes | ◐ SAMPLER BUILT 2026-09-30 — `/api/watchdog/status` now carries `lag_histogram` (every serviced check, 14 fixed buckets, p50/p90/p99 upper bounds; arms nothing). The 2026-09-30 window predates it (69 point samples, `evidence/2026-09-30-quiet-window/results.md`). Still needs: one window spanning an open AND a heavy-job window, read from the histogram. |
| TERM-018 | `FB-OBS-09` | Prove every guard can fire — a shipping gate | M | d3·b0 | tier 4 pref / 3 | **No** | ✅ BUILT `c483aeff2` (on origin/master, verified 2026-09-30) — the rail from `18b2b009d` (observed-or-counted-debt, six clauses, a local rail only) gained the two halves §4.1's package asks for and it lacked, plus a CI wire. **Clause 7, THE WIRE** (the AST-over-the-scheduler rail, with its mutation): every `observed` record declares `wire` — `chain` (call sites walking out from the guard, each name BOUND to the previous hop's module by an import, each reaching it by call OR reference — `Thread(target=_loop)`, `add_job(_check)` — ending in a module a Railway service boots, READ from `railway*.json` + the Dockerfile it names), `table` (two chains and the one runtime lookup between them named in `unfollowable`: Wisdom's `JobSpec` table), `sink`, `cli` — and every hop is CUT in memory on every run and the chain must break (the cut caught this build's own first draft: an `add_job` inside the guard's scope accepted any job). 9/9 observations wired: 4 chain · 1 table · 3 sink · 1 cli. **Clause 8, the seam rule:** no parameter default in a monitor's reach is a def/class/import bound at module load (0 today). **CI:** `.github/workflows/term018-guards.yml`, every push/PR, `--noconftest` + `fetch-depth: 0`, ~25 s; the two checks that collect the product's own tests (~130 s, full requirements) are deselected by node id and railed to be exactly those two. `promotion-gate: no`, by decision: it has never run on a runner, and gating would refuse a ROLLBACK whose revert deletes an observed guard's site — the flip is the owner's. **Not built, by scope:** the 22 `declared_unobserved` rows (each needs its own mutation run; §2.3 clause 1 still holds them) and the member-delivery band (G-43/G-44). Rails 131 passed; mutation-proved 8 ways, each red |

### 2.4 Band 2 — THE ENABLERS (8). Packages at §4.2. ⚰️ Three of eight recut by a grep.

| TERM | FB | short title | SZ | DEP | ROLLBACK | PAR | STATE |
|---|---|---|---|---|---|---|---|
| TERM-019 | `FB-S8-01` | The provenance set + a rail that every panel uses it | ~~M~~ → **S rail / M adoption** | d0·**b11** | tier 4 pref / 3 | Partial | ⚰️ RECUT — all 4 ship |
| TERM-020 | `FB-D2-01` | Canonical model + address book — **CP3, the resolver** | XL (CP3 is M) | d0·b5 | **TIER-NONE** | Partial | ⚰️ RECUT — CP1+CP2 ship |
| TERM-021 | `FB-S5-01` | One versioned workspace document in its own store | L | d0·b4 | **TIER-NONE** | No | 🟡 BUILT, DARK — store `68538e6a7`, retention `fc1921f54`/`3a27475a8`, read-new phase `ea93f1528` (2026-09-29). **Not armable until the `workspace_docs` backup rehearsal PASSes (owner/production)** — the arming checklist is in TERM-021's section below |
| TERM-022 | `FB-D1-01` | The Massive adapter + the retirement queue | L | d0·b4 | **TIER-NONE** | Partial | ✅ BUILT `bd384d8eb` — `massive_adapter.py` + census ratchet (85 reaches baselined; migration is per-file follow-on, partner files need ack) (re-verified against origin/master 2026-09-30) |
| TERM-023 | `FB-S3-01` | Entity master — **a member path, not a build** | ~~L~~ → **M** | d0·b3 | **TIER-NONE** | Partial | ⚰️ RECUT — ADMIN-MOUNTED |
| TERM-024 | `FB-S4-02` | A panel declares a need, never a transport | S now / L later | d0·b2 | tier 4 pref / 3 | Yes | ✅ BUILT `b4e658530` — `panelContract.js` `declareNeed` + AST rail (re-verified against origin/master 2026-09-30) |
| TERM-025 | `FB-S7-01` | The remaining seven trigger types, one at a time | M per type | d0·b2 | tier 4 pref / 3 | Yes | ⚰️ BUILT — 8/8 types registered, every CP3 merged (verified 2026-09-28 against origin/master `38bb9a421`); next is a per-type owner CP4/FLIP ruling, not a build |
| TERM-026 | `FB-S9-01` | Auditor sees a GET; publish its denominator | S | d0·b2 | tier 4 pref / 3 | Yes | ✅ BUILT `2926822a2` — `auth_surface_check.audit_surface` publishes examined N/M (re-verified against origin/master 2026-09-30) |

### 2.5 Band 3 — CHEAP AND CLEAR (10). Packages at §4.3.

| TERM | FB | short title | SZ | DEP | ROLLBACK | PAR | STATE |
|---|---|---|---|---|---|---|---|
| TERM-027 | `FB-S1-01` | Panel header inside the per-widget error boundary | S | d0·b0 | tier 4 pref / 3 | Yes | ✅ BUILT `3d8f8d6b0` — panel ErrorBoundary draws the header (re-verified against origin/master 2026-09-30) |
| TERM-028 | `FB-A1-01` | An honest blank for futures | S | d0·b0 | tier 4 pref / 3 | Yes | ⚰️ MOOT — index futures removed from the strip 2026-07-27 by owner call; BTC/VIX on yfinance is owner-accepted risk D-004 (re-verified against origin/master 2026-09-30) |
| TERM-029 | `FB-A10-01` | The GEX assumption label, at the number | S | d0·b0 | tier 4 pref / 3 | Yes | ✅ BUILT `54b02160d` + `5fab41887` + rail `e74e9df6c` — `GexAssumptionNote.jsx` (re-verified against origin/master 2026-09-30) |
| TERM-030 | `FB-A5-02` | Schema assertion on the five `/api/calendar` readers | S | d0·b0 | tier 4 pref / 3 | Yes | ✅ BUILT `081ee0da8` + `18d39dfcc` — `calendar_week_contract.week_days` on the readers (re-verified against origin/master 2026-09-30) |
| TERM-031 | `FB-A5-03` | Derive the Fed-speaker list instead of typing it | S | d0·b0 | tier 4 pref / 3 | Yes | ✅ BUILT `91d37b99c` — derived Fed roster with a horizon rail (re-verified against origin/master 2026-09-30) |
| TERM-032 | `FB-A6-01` | Say "coverage n=0", not an empty transcript panel | S | d0·b0 | tier 4 pref / 3 | Yes | ⚰️ MOOT, 2026-09-29 — both halves already hold at re-measure. (a) Its precondition RG-15 was REFUTED 2026-09-27 (`RESEARCH_GAPS.md` RG-15a): transcripts are live, 2,207 held; the n=0 was a monitor field that cannot report anything else, not an empty corpus. (b) The member outcome ("we hold nothing" told apart from "something broke") already ships: `components/calendar/TranscriptPanel.jsx` renders three distinct states — a resolved `null` → "Transcript not available.", a failed request (its fetcher `useTranscript` throws via `sectionFetcher`) → "Could not load the transcript — the request failed." (`data-testid="transcript-failed"`), a 402 → "Transcripts require a paid plan." Adding a `CoverageLine` here would be the second "no data" idiom criterion (c) forbids. |
| TERM-033 | `FB-A8-02` | Six `.catch(() => null)` sites onto `sectionFetch.js` | S | d0·b0 | tier 4 pref / 3 | Yes | ✅ BUILT 2026-09-29 — the three named sites (`SetupSection.jsx`, `StatementPanels.jsx`, `paidFetcher.js`) were ALREADY on the throwing fetcher at re-measure (only comments still name the idiom). Built the half the package says is the real ticket: `app/src/lib/swallowedFetch.census.test.js` counts `.catch(() => null|undefined)` in CODE (comments stripped) across `app/src`, per file, against the shrink-only `swallowedFetch.baseline.json` (**77 sites in 68 files** today). A file gaining a site, or a new file adopting the idiom, fails by name; a migrated site must be taken off the baseline in the same change; the stated total must equal the per-file sum; controls prove comments are not counted and spacing variants are. Mutation-proved (a planted site in `AlertBell.jsx` → red). The 68-file migration itself is the census's follow-up, one surface at a time. |
| TERM-034 | `FB-I1-03` | The I1 spec, railed rather than written | S doc / **M as checks** | d0·b0 | tier 4 pref / 3 | Yes | ✅ BUILT `2741bca3d` — four I1 rails with controls (re-verified against origin/master 2026-09-30) |
| TERM-035 | `FB-S11-01` | Market clock as code, with a horizon rail | S | d0·b0 | tier 4 pref / 3 | Yes | ✅ BUILT `20cbef927` — authority + horizon rail + shared fixture; ✅ follow-up #1 DONE 2026-09-28: `nyseCalendar.js` + `nyse_calendar.py` derive from the dataset (client + `bars_fetch`/`liveflow_monitor` read it); remaining scattered users per the census |
| TERM-036 | `FB-D5-02` | Route dividends off yfinance onto Massive reference | S | d0·b0 | tier 4 pref / 3 | Yes | ✅ BUILT `d3b5cd485` + parity `20f7a7ddc` — `reference_corp_actions.py` (re-verified against origin/master 2026-09-30) |

### 2.6 Band 4 — DEPENDENT (26). Register rows only; §2.9 says why.

| TERM | FB | short title | SZ | DEP | ROLLBACK | PAR | STATE |
|---|---|---|---|---|---|---|---|
| TERM-037 | `FB-S1-03` | Panel set as a by-product of the surface set | L | d1·b0 | **TIER-NONE** | Partial | ✅ BUILT `9cfb3c963` (on origin/master, verified 2026-09-30) — the DECLARATION half, inert. ONE authority: the S1 surface `MANIFEST` (`app/src/surfaces/manifest.js`, itself AST-derived from `App.jsx`). DERIVED: `app/src/surfaces/panelSet.js` → `SURFACE_PANELS`, one panel manifest per page-shaped surface, produced by the same `registerPanel` door every native `WIDGET_REGISTRY` entry walks through; `PANEL_SET` = the 20 native board tools (not surfaces) + the 18 surface-derived ids = 38, so the registry is no longer the bound. A route added to `App.jsx` forces a manifest row (CP1's rail) and becomes a panel with zero edits. Every manifest row lands in exactly one bucket; the 39 refused carry a reason (`kind` 28 · `no-nav-label` 9 · `board-host` 1 = `/charts` · `identifier-path` 1) — labels come from `NAV_ITEMS`, no copy invented. **No member change**: every derived entry has `menus` all false incl. `terminal`, is bound in no host, and no production file imports the module (parked in `reachable.test.js` `AWAITING_A_DECISION`, expiry 2026-11-30, like TERM-006). Rail `app/src/surfaces/panelSet.test.js` (19): AST parity vs `manifest.js` + `NavBar.jsx` with a planted-drift control · a row planted into `manifest.js`'s own source moves the set and a non-page/unlabelled one is refused by name · no route literal in `panelSet.js` (control) · `registry.test.js`'s binding pin EXTENDED to the whole set (control) · INERT import check (control). Mutation-proved 5 ways (host check dropped · derivation reads the import instead of its argument · hand-typed list added · a derived panel offered by a menu · kind gate widened) — each red. Also fixed: `manifest.js` lacked `/provenance-demo` (moved inside `<Layout/>` by `7e0ab34c2`), so `manifest.test.js` had been red since 2026-09-25. Dependencies: 024 BUILT (`b4e658530`), 021 merged dark (`dc169f21d`). ⚠️ No `#### TERM-037` package (band 4, register-only); spec used = `FB-S1-03`. **Not built, by decision:** MOUNTING a surface as a panel (FB-S1-03's "Known it worked" half) — that is the abandoned `embedded` pattern (ledger C9, "20-prop signatures") and needs its own per-surface design; `panelSet.test.js`'s INERT describe and the parking expiry both go red the day it lands |
| TERM-038 | `FB-S2-03` | A published address space: saved things become names | L | d1·b1 | **TIER-NONE** | Partial | ◐ FIRST SLICE BUILT (dark) — flag **`ADDRESS_SPACE_ENABLED`** (unset = OFF, declared `pending`). `api/services/address_space.py`: every chart layout (own + prebuilt), watchlist and note gets an address `L:`/`W:`/`N:` + id, typeable by NAME in the Ctrl/Cmd+K palette and resolving to the SHIPPED door (`/charts?openLayout=`, `/charts?openWatchlist=user:`, `/journal/notebook?note=`). Keyed on id, so a rename keeps every address (the FB-S2-04 alias hazard answered by construction). `GET /api/address/search` + `/resolve` (404 while dark; owner-scoped: resolve goes through the same lister as search). Palette: saved rows only while the flag rides the auth payload (`address_space_enabled`), appended BELOW tickers and notes so a bare Enter is unchanged; notes stay with the quick switcher. ⭐ **The kind set is derived, not listed (DOC-1):** `saved_object_tables()` walks every `CREATE TABLE` string in `api/**` for an owner + name column (30 today); `tests/test_address_space.py` fails by name on one that is neither a kind nor in `EXEMPT` with a kinded reason, and on a stale exemption; a planted-table control proves the scan can see one. Rails: 14 backend (incl. real stores seeded end to end) + `CommandPalette.saved.test.jsx` (6, rendered text + route reached); mutation-proved 3 ways (flag gate, row order, note filter). ⚠️ Open: saved screens, theme sets, AI Search threads, notebook saved views and folders are `no-door` (each needs a URL instruction first); Floor threads are `deferred` (public: need the visibility rule). TERM-056 (addresses pasted into text) is now unblocked. |
| TERM-039 | `FB-S12-02` | Member-facing feature status at the point of use | S | d1·b0 | tier 0–2 | Yes | ✅ BUILT `e90fddc34` + `2084b0b19` (on origin/master, verified 2026-09-30) — derived, never typed: `docs/feature_flags.json` entries carry `member_facing {label, where[, payload_key]}` (11 declared), `api/services/feature_status.py` projects the per-request `_access_payload` into `feature_status` (`released` · `preview` = the Beta mark, derived by `auth._preview_payload_keys` from the same parse as `_breadth_dc_flags`, so it vanishes at full rollout · `unknown` rendered "not measured" · OFF not listed · unreadable ledger = `measured: false`). Members see a "What is here" strip (Here today / Working on) on Support and a Beta mark on Breadth > Data Charts during an `admin` owner preview. ⚠️ No `#### TERM-039` package exists (band 4 is register-only, §2.9); the spec used was `FB-S12-02`. Rails `tests/test_feature_status.py`, `app/src/components/featureStatus/featureStatus.test.jsx` |
| TERM-040 | `FB-A10-04` | Warm the two named cold-pack shard keys | M | d1·b0 | tier 4 pref / 3 | No ⚠️ PARTNER | ⚰️ MOOT as specified, 2026-09-29 @322d92f86 — the pack path has no server cache (`intradaypack_router.shard` → `data_sync.get_bytes`, one R2 GET per request). Shards 0/1 looked cold only because the client queue is two wide (`barsPackClient.js:36`) and they sat in the same ~10.5 s shared stall as ten unrelated 0-1 KB routes; the true per-shard cost is 296-628 ms. The fix belongs to the shared-stall diagnosis (`market-narrative-diagnosis.md` §5): log the pod's thread count during a cold `/options-flow` load and check whether server time scales with payload or with concurrency. TERM-070 (`8dfd19803`) already took one suspect, the narrative LLM call, off the request path. |
| TERM-041 | `FB-A11-02` | A fixed, published regime vocabulary, permanently | S | d1·b0 | tier 4 pref / 3 | Yes | ✅ BUILT 2026-09-29, on origin/master (verified 2026-09-30) — the vocabulary lives in TERM-071's authority (`voice_regime_classifier.py`: `REGIME_VOCABULARY_VERSION`, `REGIMES`, `REGIME_DISPLAY`, `REGIME_BAND(S)`, `REGIME_UNKNOWN`, `label_of`), published at paid `GET /api/regime/vocabulary`, pinned per version by `tests/test_regime_vocabulary.py::_PUBLISHED`; Portfolio Risk + the Awareness R4 headline render `label_of`. ⚠️ No `#### TERM-041` package exists (band 4 is register-only, §2.9); the spec used was `FB-A11-02`. Survey, disagreements, 7 follow-ups: `evidence/2026-09-29-term041/results.md` |
| TERM-042 | `FB-A11-04` | Re-source the authoritative EOD breadth row | L | d1·b0 | **TIER-NONE** | No | ✅ BUILT (dark) `584896582` (on origin/master, verified 2026-09-30) — flag **`BREADTH_EOD_SOURCE`**, a text MODE (`BREADTH_EOD_MODE_FLAGS`, declared `pending` in `docs/feature_flags.json`): `collector` (default; unset/unknown) = today's PC-collector row, no thread, no compute, push stored byte-identical · `shadow` = parallel run, a web daemon thread computes each completed session after 20:00 ET from bars.db (Massive daily aggs) through `breadth_live._metrics_at_close` (no second implementation) and grades it against the collector's stored row with `breadth_live.grade` (the live reconciliation's grader, now one function `reconcile` also calls; `_ACCURACY` tiers), writing only `breadth_eod_shadow.db`; a `_healed` row (bars.db self-heal, same input) is `not_comparable` (INST-7) · `server` = shadow + for sessions ≥ `BREADTH_EOD_SERVER_FROM` (required) stores the server row (numeric source `server`): owns the computed metrics + their drill lists (from `compute_metrics`' masks via `drill_items`), keeps the collector's other keys, a late push is merged UNDER them and graded first; history before FROM never rewritten. Premises re-measured: the row is PC-written (yfinance) and pushed; server-side the self-heal already recomputes DEGRADED/divergent days but never a MISSING one. NOT re-sourced: `NOT_LIVE` (sentiment/VIX/index closes), `new_ath`, and the universe definition (newest collector `universe_list` strictly before the session; `universe()` now skips a server row's priced-subset list). Parity (recorded fixture `tests/fixtures/breadth_eod_source/parity_proxy_2026-08.json`: bars.db vs the collector's own cached yfinance frame, same method + population, 10 sessions — NOT production rows): dividend basis OFF fails the long-lookback family every session; ON clears the 5 clean sessions to 0–2 named failures (breadth_score Δ −0.7…−1.0); 08-31/09-01/09-02 the collector's own frame was corrupt. Admin read `GET /api/breadth-monitor/eod-source` (`require_push_secret`). ⚠️ No `#### TERM-042` package (band 4, register-only); spec used = `FB-A11-04`. Rails `tests/test_breadth_eod_source.py` (32); mutation-proved 7 ways. Watch-coverage: INERT STRAND (flow-worker reaches `breadth_monitor.py` only via `bars_fetch` → `get_latest`; nothing in its closure calls `store_snapshot`) |
| TERM-043 | `FB-A3-02` | Figure-to-source-page link per statement line | M | d1·b0 | tier 4 pref / 3 | Yes | behind 020 |
| TERM-044 | `FB-A6-02` | Span-anchored citation on the call recap | M | d1·b0 | tier 4 pref / 3 | Yes | ✅ BUILT `cb8803e7c` (on origin/master, verified 2026-09-30) — owner ruling 2026-09-29 accepts the transcript-derivative licensing risk (recorded in licensing register T-43; the rights class stays U). Premises re-measured: the grounded recap (`call_recap_grounded.py`) builds from transcript `segments` (FMP first, AV fallback, via `call_recap._transcript_for` / the warmer), and the FTS index (`transcript_index.py`) stores content with no offsets, so the anchor is computed at generation time from the segments, not from the index. **Anchor unit** = transcript turn index + half-open character span into that turn's `content`, stored as `bullet_anchors[i] = {segment, start, end, speaker, text}` aligned with `bullets` (which stay `list[str]`, text unchanged); `text` is `content[start:end]`, the transcript's own characters. **How:** each bullet comes back as `{text, evidence}` (prompt = the pinned pre-TERM-044 prompt + 4 lines asking for evidence; the bullets rule line unchanged; the model is still never asked for a location); `verified_span` finds the evidence in one turn under the quote gate's folds (runs in order, ellipsis allowed) and maps it back through an offset map equal to `normalize()`; evidence not found, with no run ≥15 chars, or stitched over 1200 chars gets NO anchor. **Members see** a small info toggle after each verified KEY POINT that opens the exact passage and speaker in flow ("From the call transcript · <speaker>"), plus "Show in full transcript" where the Call section can jump; an unverified point reads "citation unavailable"; a recap generated before this renders its plain list unchanged. Rendered via `Cited.jsx` (new additive `{transcript}` row shape; 44px targets ≤1024px). Rails `tests/test_call_recap_bullet_anchors.py` (recorded DIS transcript + recorded-shape response; a hallucinated span is dropped; the UI fixture must equal server output) · `CallRecapSection.citations.test.jsx` · `Cited.test.jsx`. Mutation-proved 3 ways (accept-any-span, too-short evidence falls back to itself, client accepts any span shape). Watch-coverage: OK, not flagged. ⚠️ No `#### TERM-044` package (band 4, register-only); spec used = `FB-A6-02` |
| TERM-045 | `FB-A7-01` | Consume SEC EDGAR Form 4/13F for ownership | M | d1·b0 | tier 4 pref / 3 | Yes | ✅ BUILT (dark) `9ccab63ed` (on origin/master, verified 2026-09-30) — flag **`EDGAR_OWNERSHIP_ENABLED`** (unset = OFF, declared `pending` in `docs/feature_flags.json`). Premises re-measured 2026-09-29: the Ownership tab's insider rows came from `insider.get_insider_activity` = **FMP primary + Finnhub fallback** (CLAUDE.md's "Finnhub" row is stale; the 4h cache is right); 13F from FMP via D1 + a yfinance holders table; no EDGAR Form 4/13F parse existed anywhere. `api/services/edgar_ownership.py`: a Form 4 / 4/A parser (footnote-only facts are None, never 0) → open-market P/S rows with the incumbent's scope and A/D sign rule, each carrying its **accession number** and filing link → `ProviderResult` (vendor `sec_edgar`, licensing **A**, T-83, rows added to `provider_licensing_class`). CIK via the existing `edgar.resolve_cik` chain; SEC reached ONLY through `fundamentals_pit/sec_client` (the repo's one UA + limiter + backoff), 15s/request, 90s/ticker, ≤41 requests/ticker, on the module's own single worker thread; the request path is cache-only (miss ⇒ `state: pending`, one refresh queued). Armed, `GET /api/research/ownership/{sym}` (no new route) serves EDGAR's insider rows + `insider_source` (state ok/partial/pending/not_found/unavailable, unread filings named by accession, `compare` = filers by NAME over the incumbent's date span); `insider` is null for every unknown state and the tab says so in words. Unset: byte-identical response, no thread, no SEC call. ⚠️ **13F is parser + normalization only, NOT wired** — a ticker-keyed holders table needs a CUSIP join across all filers (blocked on TERM-023 and CUSIP's master-file terms). ⚠️ No `#### TERM-045` package (band 4, register-only); spec used = `FB-A7-01`. Rails `tests/test_edgar_ownership.py` (33, recorded SEC fixtures in `tests/fixtures/edgar_ownership/`) + `OwnershipTab.edgar.test.jsx` (6); mutation-proved 6 ways (A/D sign, unstated-number-as-0, other-issuer filings, unknown⇒[] guard, flag default, UI readable guard) |
| TERM-046 | `FB-A7-02` | Short-interest history off a licensed FINRA floor | M | d1·b0 | **TIER-NONE** | Yes | ✅ BUILT (dark) `ff90ba3c7` (on origin/master, verified 2026-09-30) — flag **`SHORT_INTEREST_SOURCE`**, a text MODE (`SHORT_INTEREST_MODE_FLAGS`, declared `pending` in `docs/feature_flags.json`). ⭐ **Premise changed by owner ruling 2026-09-29: the source is FINVIZ (T-48, ANSWERED, LA), not FINRA direct and not yfinance** — so the row title's "FINRA floor" is superseded. Premises re-measured: `short_interest.get_short_interest` was yfinance-only; consumers are the voice `get_short_interest` tool (`voice_tool_impls.py`, registered in `voice_agents.py`), AI Search's agent tool list (`ai_search_agent.py`, same impl) and the wisdom street reader (`wisdom/capture/families/street.py`), which read the whole dict; `ai_search._short_interest_missing` reads the screener row's `short_float_pct`, not this function. ⭐ **The screener's nightly whole-market Elite export ALREADY carried Short Float (c=30) and Short Ratio (c=31)** beside the share counts, so the Finviz path makes **no new request**: it reads that artifact (`finviz_universe`, 02:45 ET, one call, 90 s timeout). `yfinance` (default; unset/unknown) = byte-identical, railed against a frozen golden generated by exec'ing the base blob. `finviz` = same fields, same order: short % of float and days to cover as served; shares short and % of shares outstanding DERIVED; `crowded` None when short float is unknown (never "low"); `as_of` = the INFERRED FINRA settlement date (15th / month-end business day, +7 business days to publish, +1 for ingest), never the pull date, None with both candidates on the one ambiguous day, and it matches Yahoo's own `dateShortInterest` (2026-09-15) on all six recorded tickers. D1 envelope: `fetch_finviz_short_interest` → `ProviderResult` stamped by the new `("finviz","short_interest")` → **LA** (T-48) row. History: while armed, the nightly pull appends one dated row per ticker per settlement (`SHORT_INTEREST_HISTORY_DB_PATH`, INSERT OR IGNORE, first-write-wins, ambiguous pulls write nothing); **never backfilled** — the series starts the night it is armed, and `shares_short_prior_month` is None until that history holds the settlement a month back. Parity (recorded fixture `tests/fixtures/short_interest/parity_recorded.json`, 6 tickers, same minute; Finviz from the public quote page because the Elite token was not in the recording environment): short % of float equal on AAPL/NVDA, off 0.08–2.38 pts elsewhere (Yahoo's float denominator differs: TSLA 2.44 vs 1.95, CVNA 9.25 vs 11.63); days to cover differs on every ticker, Finviz minus Yahoo −1.19…+0.49 (CVNA 6.95 vs 8.14) (different average-volume window); derived shares short within 0.35% of FINRA's count on all six; `as_of` equal on all six; prior-month present on Yahoo, None on Finviz; % of shares outstanding None on Yahoo for all six, present on Finviz. ⚠️ No `#### TERM-046` package (band 4, register-only); spec used = `FB-A7-02` (its "Finviz column off the display path" test predates the ruling and is inverted by it). Rails `tests/test_short_interest_source.py` (64); mutation-proved 3 ways (flag default, unknown short float as "low", unknown shares short as 0). Watch-coverage: INERT STRAND (flow-worker reaches `provider_licensing_class` only via `fmp_client`/`massive`/`massive_adapter`, whose lookups are all keyed `fmp`/`massive`; `short_interest` and `finviz_universe` are not in its closure) |
| TERM-047 | `FB-A9-02` | `CoverageLine` on every result surface | M | d1·**b3** | tier 4 pref / 3 | Partial | BUILT 2026-09-29 `05a611c71` (on origin/master, verified 2026-09-30) — the rail DERIVES the result surfaces by AST, extending `panelAdoption.ratchet.test.js` (no second graph walk): a tracked, non-test, reachable JSX module whose own data door (its literals + every `use[A-Z]` hook it imports) addresses an A9 route (`/api/<family>`, family word `scan`/`screen`). 12 derived; it fails BY NAME on one that neither RENDERS `<CoverageLine>` itself nor sits in the new shrink-only `coverage_line_exempt` map in `panelAdoption.baseline.json` (one-line reasons with a kind: `not-a-result-set` 4, `no-counts` 3, `delegates` 2; a stale entry fails by name, a `delegates:` reason must name a delegate that really renders the line). A one-hop child rule was built and removed on measurement (it called ScanResults routed via `<EvidenceTab>`'s backtest receipt with its own import stripped). Adopted on the `/screener` shell: the APPLIED scan filter's four-count receipt (`/api/screener/meta` `scans[].latest`, already on the wire; the chip had dropped `not computable`), one sweep-selection rule `joinReceipt` shared with the chip; refusal seen to fire on the surface. Mutation-proved 4 ways. Follow-ups: backend receipts for the 3 `no-counts` surfaces (period-sort, preset scans, volume surge), then adopt; the `/api/screener/scan` plain-screen receipt; retire the `components/screener/CoverageLine.jsx` shim with its two importers' repoint; the chip's three-count text |
| TERM-048 | `FB-A12-01` | Watchlist alerts onto S7's trigger taxonomy | M | d1·b0 | tier 4 pref / 3 | Yes | ✅ BUILT (DARK) `046e098ca` + `b0950e9bc` (on origin/master, verified 2026-09-30) — flag **`WATCHLIST_ALERTS_S7_ENABLED`**, default OFF (strictly `"1"` arms it, read per call; declared `dark` in `docs/feature_flags.json`). **OFF = today's lane, unchanged:** same fire, report, bell entry and email, and the `alert_taxonomy` store is never opened (railed: its file is not even created). **ON:** a crossing the LEGACY checker already decided to fire (same level test, same one-shot `is_active=0`, deactivate-first) is recorded in `alert_fires` via `receipts.record_fire` (`trigger_type` `price-level`, `predicate_id` `watchlist:<row id>`, deterministic `fire_key` `fire:<row id>`, `detail.rule` `legacy_level_one_shot`), its lease claimed with `claim_delivery`, the member told by the UNCHANGED `_deliver_alert`, and the channel outcome stamped on the receipt. The unique key makes a crossing fire ONCE even when two checkers both saw the row armed (the legacy `_trigger_alert` is not a compare-and-set). A receipt-store failure still tells the member once, on the legacy path. Bridge: `api/services/alert_taxonomy/watchlist_price_alerts.py` (does not import `price_level`, so it stays outside flow-worker's closure). NOT changed: the predicate (S7's CROSS rule is the owner's CP4/FLIP call), `watchlist_alerts` (no columns, no deletes), `alert_predicates` (projection, not mirror), the bell feed bridge (no price-level branch, so no second bell row). Tests `tests/test_term048_watchlist_alerts_s7.py` (27); mutation-proved 4 ways (time in the fire key, duplicate still delivered, default flipped ON, route ignores the flag). Watch-coverage: INERT STRAND (flow-worker imports the module for `deliver_alert_payload`; nothing in its closure calls the changed path). ⚠️ No `#### TERM-048` package (band 4, register-only); spec used = `FB-A12-01` |
| TERM-049 | `FB-A13-01` | ⭐ The per-ticker history join | XL | d1·b0 | **TIER-NONE** | No | ◐ FIRST SLICE BUILT (dark) `0c74088f0` — flag **`TICKER_HISTORY_ENABLED`** (unset = OFF, declared `pending`). Owner rulings 2026-09-29: build now, room lane COUNTS ONLY. `GET /api/research/history/{sym}` (404 before identity while dark; own 402 sentence) joins four citable lanes: Morning Wire mentions (whole-word over `wire_archive`), UCT 20 entries/exits (derived from consecutive compositions), the catalyst list, and community-room mention counts per ET day (never text or authors). Every row names its source and its own date; nothing is blended into a score; a lane that cannot be read is `unavailable`, never empty. Research page **History** tab renders only while the flag rides the auth payload. Rails `tests/test_ticker_history.py` (8) + `HistoryTab.test.jsx` (5, rendered text); mutation-proved 2 ways. ⚠️ Still open (post Oct 2 reset): flow lane (named in `not_rendered`), setup ledger, entity ids across renames. |
| TERM-050 | `FB-I1-01` | One provenance renderer; I1 composes on S8 | M | d1·b1 | tier 4 pref / 3 | Partial | ⭐ with 019 |
| TERM-051 | `FB-S5-02` | Workspace version history as a member restore | M | d1·b0 | **TIER-NONE** | No | ✅ BUILT `659c9c6f2` (on origin/master, verified 2026-09-30) — **DARK: visible only once `WORKSPACE_DOC_STORE_ENABLED` is armed.** The client half of TERM-021. `/charts` Layouts menu → **Version history** (no nav entry, no tab); the entry probes `GET /api/workspace/doc/versions` and renders NOTHING unless it answers 200 with a list, so while dark (404) the control is hidden, not disabled. The panel (`app/src/pages/charts/VersionHistory.jsx`) lists versions newest first — timestamp, source in plain words, the head marked Current and not offered — and previews a choice by NAME: which stored keys the restore changes, and which the version lacks and the route leaves as they are. Restore is the compare-and-set `POST …/restore` with the head the list was based on; **409 re-fetches and says so, never retries**. Write-back: the route itself puts the restored values into `user_preferences` under the same keys (`workspace_doc.py` restore), so the client writes nothing — it RE-READS the prefs (`refreshPreferences()`, seeds the shared SWR cache) and re-seeds the layout + linked symbols, which are one-shot seeds and would otherwise keep the old board on screen; a pending autosave of the replaced board is cancelled first. The outcome is told by a notice host on the WORKSPACE, which outlives the menu and the panel. **STATE-2 finding: there was NO guard** — a corrupt `charts_workspace_layout` parsed to null, a default board rendered, and the first post-hydration `onLayoutChange` autosaved it over the original 500 ms later (the named-layout dock had a hydration gate; the working-board pref did not). Fix: the debounce and the unmount flush go through one writer, `autosaveLayout()`, which refuses while the stored value is present-but-unreadable (`isUnreadableStoredLayout`; absent / `''` / `'null'` hold no data and are not held); the member sees a plain notice; deliberate actions (open a layout, New Layout, Save, a restore) still write and lift it. Tests `VersionHistory.test.jsx` (10) + `VersionHistory.workspace.test.jsx` (8). Mutation-proved four ways: 404-hides guard removed (2 red), STATE-2 guard removed (2 red), unmount flush bypassing the choke point (1 red), 409 without the re-fetch (1 red). ⛔ **Still blocks arming** (TERM-021's own list, re-read at `68538e6a7`): (1) ✅ the read-new phase — BUILT `ea93f1528` (2026-09-29): the client reads the document via the shim, a template apply is ONE document write, `uct.watchlist.cols` folded in (see TERM-021's STATUS); (2) `STORE_BACKUP_ENABLED` armed and one real `--rehearse` PASS on `workspace_docs` — not verifiable from a worktree, re-read before arming. Retention (30 d OR newest 200, ceiling 2000) is already built (`fc1921f54`, `3a27475a8`). ⚠️ Not blocking, open: the phone / coarse-pointer tablet shell (`MobileChartsApp`) has the STATE-2 notice but no Version history door; `KEY_LABELS` in `VersionHistory.jsx` restates `WORKSPACE_PREF_KEYS` by hand — ⚰️ since railed (`VersionHistory.keyLabels.test.js`, `fef262e88`), and grown by `watchlist_columns` → 'Watchlist columns' in `ea93f1528` |
| TERM-052 | `FB-S6-01` | Three personalization publications, derived | S / **M derived** | d1·b0 | tier 4 pref / 3 | Yes | ✅ BUILT `57f634836` (on origin/master, verified 2026-09-30) — premises re-measured 2026-09-29. Of the three: **(3) the cross-device rule already shipped** (TERM-076, Settings → "What Syncs Across Your Devices", rendered from `persistenceManifest.json`) — not rebuilt. **(1) density ceilings** and **(2) non-autosaving objects** were absent and are now two sections of the SAME card (no new nav/tab). (1) "Limits": charts per multi-chart grid (`GRID_MAX_CELLS`, `gridLayouts.js`), comparison symbols per chart and saved chart-settings templates — the last two were file-private literals in `ComparisonPicker`/`ChartSettingsModal` (the template cap was a silent `slice`), moved to `components/chart/chartCeilings.js`, which both now import, so the enforced and published value are one constant. No panels-per-board cap exists in code (the board is bounded by grid geometry), so none is published. (2) the workspace's autosave rule (own layouts save themselves; prebuilt layouts and UCT Default are deliberate-save only) was extracted verbatim into `layoutAutoSaves()` (`layoutDockPins.js`); `ChartsWorkspace` gates `dockAutoSaves` on it and the card publishes the split by CALLING it over every layout kind. Derivation module `lib/persistence/personalization.js`; a value that cannot be resolved renders `unreadable`, never a default. ⚠️ **"behind 021" did not hold for this item**: 021 is write-both/read-old (`user_preferences` stays the authority), so arming it changes no key's scope and none of the three publications; the only 021-dependent claim (version history / restore) belongs to TERM-051, and the card makes none (railed). Rails `lib/persistence/personalization.test.js` (10: AST — each ceiling is an identifier imported from its declared source, the source declares it as a number, the consumer imports and uses it; `ChartsWorkspace` gates on `layoutAutoSaves`; every layout scope the workspace writes has a kind) + `DeviceSyncCard.test.jsx` (+6, rendered text, planted drift, unreadable path). Mutation-proved 5 ways red (typed ceiling value, workspace re-inlines the rule, card ignores the rule / the ceilings it is handed, consumer stops applying the constant) + 1 control (moving `GRID_MAX_CELLS` keeps every rail green and republishes). ⚠️ Not done: FB-S6-01's PROD-C1 note ("a cap wants a meter") — no usage meter beside the limits; and objects that simply have no autosave mechanism (e.g. the formula builder's unsaved draft, guarded by its discard-confirm) are not listed, because an absence has no governing predicate to derive from — the published list covers the Layout Dock's rule only. ⚠️ No `#### TERM-052` package (band 4, register-only); spec used = `FB-S6-01` |
| TERM-053 | `FB-S9-02` | Close the six dependency-less route families | M | d1·b1 | tier 4 pref / 3 | Partial | ✅ BUILT `2994ab6f3` (on origin/master, verified 2026-09-30) — the six are ARCH-06 §2.2's red rows, re-measured over `api.main:app` 2026-09-29 (TERM-026's `OPEN_READS_GATE` had already staged three). **(1) `/api/gex/compare`** staged-only (prod `shadow` ⇒ anonymous 200) → **HARD-gated**: `get_current_user` at the gex router's MOUNT in `api/main.py`, so every route it has or gains needs a session; `OPEN_READS_GATE` still layers PAID under `enforce`; zero callers in this repo + 5 sibling repos. **(2) `/api/dealer-positioning/{status,sample,flow-sources}`** already staged ADMIN at both web layers (include site + `flow_proxy` forwarder); POSTs `require_flow_admin`; router also mounted on flow-worker (dynamic import, unwatched) so the web proxy is the layer — unchanged, closes at the owner's `enforce` flip. **(3) `/api/stream/prices`** LEFT OPEN — free page + logged-out Discord Activity read it; baseline `kind=open`, owner call. **(4) `/api/flow-scoreboard`** already staged PAID (live readers: paid Flow Record page + Dashboard tile) — unchanged. **(5) `/api/r/*`** LEFT inline — render token is fail-closed but baked into the bundle (`VITE_CHART_RENDER_TOKEN`); closing = build var out + rotation (OI-13, owner/Railway); readers morning-wire panelshot, `/buzz`, Sunday Scan, headless `/r/*`. **(6) `/api/breadth-monitor/{live-diag,live/reconcile}`** was already CLOSED inline by `_check_auth` (PUSH_SECRET; ARCH-06 had not read the body) — compare made `hmac.compare_digest`, responses unchanged. Writes: every mutating route under the six prefixes is gated (railed). Tests `tests/test_term053_route_families.py` (31) + a `test_open_reads_gate.py` census adjustment; mutation-proved (gex mount gate removed ⇒ 3 red; breadth `!=` ⇒ 1 red). ⚠️ No `#### TERM-053` package (band 4, register-only); spec used = `FB-S9-02` + ARCH-06 §2.2 |
| TERM-054 | `FB-D3-01` | Emit `id:` on the streams so resume is possible | S emit / M honour | d1·b0 | tier 4 pref / 3 | Yes | ✅ BUILT `eefe2cce0` (on origin/master, verified 2026-09-30; 013 merged `c70bbc347`) — web streams only (`/api/stream/prices`, `/api/stream/bars`): every frame carries `id: <boot>-<seq>` (one in-process counter per stream, a new `<boot>` per process); a reconnect presenting Last-Event-ID (header, or the pooled managers' `last_event_id` query) gets an `event: resume` first frame. Both streams are last-value-wins (`STREAM_DELIVERY`, pinned against `panelContract.deliveryOf` by a vitest rail), so the replay window is **0 events**: the frame says `resume: not_applicable`, `replayed: 0`, the id's origin (this_process / other_process / unrecognised) and what is served instead (prices: current snapshot; bars: next bar per pair) — no missed-count, no gap counter (PERF-6; real drops stay TERM-013's). Both client pools track the newest id per bucket and present it on an error/watchdog reconnect of the same bucket, never on a changed union; the declaration is recorded (`getLastResume`) and never reaches `onBar`/`delivering`. Tests `tests/test_stream_event_ids.py` (18) + `app/src/lib/streamEventIds.test.js` (11). ⚠️ No `#### TERM-054` package (band 4, register-only); spec used = `FB-D3-01`. Follow-up: the every-message-matters tape (flow-worker, `/api/live/massive/stream`) is where a real replay window would mean something — not built here |
| TERM-055 | `FB-D5-01` | Adjustment as a labelled policy | S label / M raw view | d1·b0 | **TIER-NONE** | Yes | ◐ LABEL BUILT 2026-09-29 — owner ruling: **SPLITS ONLY, true today** (CARD 7's sentence named dividends, which `adjustment_basis` always returns null for by design). `components/chart/AdjustmentLabel.jsx` in the /charts chart toolbar: "Split-adjusted · last split {as_of}" with a title naming the source ("by the data vendor" / "by UCT (the vendor's bars were not adjusted)"); renders ONLY on `splits === true`, never on false / undetermined / a failed fetch / an intraday or `$IDX` chart. ⭐ **Found while verifying:** `/api/bars/{ticker}/adjustment-basis` answered **404 for every ticker on production** — a Cloudflare Worker (`bars-edge-router`) sends `/api/bars/*` to the bars-api tier, which does not serve it. Now also served at `/api/adjustment-basis/{ticker}` (web), which the label reads; rails pin both paths and that the label reads the reachable one. Rails: `AdjustmentLabel.test.jsx` (4), `tests/test_adjustment_basis.py` (+2). ✅ **2026-09-30, second observable CLOSED**: `_is_intraday_stale()` is not a split detector and never was for fresh data — `tests/test_intraday_split_is_not_staleness.py` runs a split fixture (adjusted AND unadjusted) through the real `fetch_with_validation` chain: no staleness trip, no fallback source consulted, plus a control proving the floor still fires on a series that stopped. ⭐ **Found while doing it, fixed the same commit:** production runs `BARS_SPLIT_REPAIR_ENABLED=0`, which stops the serve-time split heal, yet `compute_adjustment_basis` still answered `splits=True, applied_by="bars_sanitize"` for a series with an unapplied declared split — so the label shipped 9/29 could read "Split-adjusted … by UCT" over a chart showing the cliff. The basis and `sanitize_daily_bars` now ask ONE predicate (`bars_sanitize.split_adjust_active()`); switch off ⇒ `splits=False` ⇒ no label. Rail `test_the_label_agrees_with_what_the_serve_path_actually_did` (mutation-proved: 3 red). ⚠️ Open: the M half (a parallel raw view), and **intraday has NO split detector** — an unadjusted intraday split is served as-is (the fixture shows it passes validation). |
| TERM-056 | `FB-S2-04` | The command string as an interchange format | S after 038 / L before | d2·b0 | **TIER-NONE** | Yes | ◐ FLOOR HALF BUILT 2026-09-29 — owner ruling: **on the Floor, link ONLY shared objects.** `address_space.shared_links(author, text)` resolves every `L:`/`W:`/`N:` address in a post against the AUTHOR's objects (never the reader's): a layout with a live share link → `/charts?openShared=<token>`, a prebuilt layout → `/charts?openLayout=`, a public watchlist → `/charts?openWatchlist=community:`; the author's private object → `{address, shared: false}` with NO name (a private title is not the Floor's to publish); another member's object or ordinary text ("W:3 in a row") → nothing. Attached in `community._attach_authors` (every Floor payload), carried by `useFloor`'s adapters, rendered by `floor2/AddressChips.jsx` under post and comment bodies. Keyed on id, so a rename keeps the link. Rails: `tests/test_address_space.py` (+2, real stores: shared/private/theirs/text + the payload) and `AddressChips.test.jsx` (3). ⚠️ Open: the NOTE half (addresses in a member's own notes link to all their objects) lives in the Notebook editor, owned by the notebook workstream; notes have no Floor-visible share yet, so a note address is always "private" on the Floor. |
| TERM-057 | `FB-A8-03` | "Why isn't X here" as an S8 receipt | M | d2·b0 | tier 4 pref / 3 | Yes | ✅ BUILT `600319474` (on origin/master, verified 2026-09-30) — one shared receipt, `app/src/components/provenance/AbsenceReceipt.jsx`, fed by `GET /api/catalysts/explain/{sym}` and keyed off a new additive `verdict` field (never the `reason` prose). It says in plain words: which gate excluded the name (tradeability / activity, with the gate's own reason), which quota bucket was full (tag, slots, rank inside the bucket — FB-A8-03's "says *which*"), no qualifying signal, a curator cut, not picked, qualifies-now, on the list, or **not evaluated** (no source surfaced it), which is never worded as an exclusion; a failed check says it failed and nothing about the list. Mounted on two surfaces: the Catalyst tile (Dashboard + Morning Wire — replaces the tile-local `ExplainTickerWidget`, which printed raw JSON) and the research page Catalysts tab with the ticker fixed. The spec names no second surface; the ticker page was chosen because the explain route answers exactly one question — one ticker against TODAY's list — while `/catalysts/history` is date-scoped and the route cannot answer for a past date. Route change additive (`verdict`, `market_date`, `list_rank`, `pool_size`, `gate`, `gate_reason`, `quota`): "on the list" read from the persisted ranked rows; a quota verdict only when the mechanical selector decided, via the same `select_top_12` over the same pool; `selection.quota_for(tag)` added. Tests `tests/test_catalysts_explain_receipt.py` (13) + `AbsenceReceipt.test.jsx` (17) + `AbsenceReceipt.surfaces.test.jsx` (2 — the real tile and the real research tab render the SAME receipt text). Mutation-proved five ways (not-evaluated→excluded in the component: 4 red; excluded→not-evaluated: 4 red; route reports unsurfaced as excluded: 3 red; quota cause never named: 1 red; research-tab mount cut: 1 red). ⚠️ Pre-existing, not fixed here: the explain route re-scores without the engine's `is_new` freshness input, so its `score`/rank can differ slightly from the refresh that built the list |
| TERM-058 | `FB-A9-01` | An authoring-time live match count | M | d2·b1 | tier 4 pref / 3 | Yes | behind 023 |
| TERM-059 | `FB-A11-03` | Label a stale or proxied value at the value | S | d2·b0 | tier 4 pref / 3 | Yes | ✅ BUILT `d50694379` (on origin/master, verified 2026-09-30) — **NAAIM column only.** The Breadth Monitor's NAAIM cell asks TERM-006's authority (`freshnessAge.explainMustShowAge`, via `pages/breadth/naaimAge.js`; "now" = the row's own session, the live row the wall clock) and renders `FreshnessBadge`'s new `age` clause inline: *"weekly · as of <survey date>"*, or *"weekly · undated"* for reconstructed pre-collector rows. `naaim_date` already reached the client — no server change. Parking entry + "no consumer yet" rail retired in the same commit. ⚰️ The ⚠️ that stood here (RM-N03, the max-age sentence "twice and unreconciled") was stale: `82a547a49` made `freshnessAge.js` cite CARD 33 §2. Follow-ups (AAII, CBOE P/C, CNN F/G, the H8 proxies, source name at the value, NAAIM on other surfaces): `evidence/2026-09-29-term059/results.md` |
| TERM-060 | `FB-I1-02` | A machine-checkable citation pointer per claim | L | d2·b0 | tier 4 pref / 3 | Partial | ✅ BUILT `983e892cc` (merged `943a1e0be`) — claim wire format v1 + `check_claim` in `api/services/canonical/claims.py` (verified only when resolved, numeric, within the stated precision, same session); first resolver caller = `GET /api/breadth-monitor/score-components` `claims.total`, rendered by The Read through `Cited` (approval line: owner delegation 2026-09-29). |
| TERM-061 | `FB-X2-01` | Skill file + endpoint whitelist, then an MCP surface | S / M | d2·b0 | tier 4 pref / 3 | Yes | ✅ S-half BUILT 2026-09-29 (UNPUBLISHED by owner ruling): `api/services/skill_whitelist.py` generates `docs/api/member-api-whitelist.json` + `docs/api/skill.md` from `api.main:app` — 517 GET reads, each gated member/paid and in a rate-limit family, tier recorded (entitlement inheritance); admin/auth/stream/render/webhook routes, open routes, credential/connector/debug reads excluded by rule; drift railed by `tests/test_skill_whitelist.py`. The MCP surface (M-half) is NOT built. |
| TERM-062 | `FB-S7-02` | Publish the cooldowns; show fire-frequency | M | **d3**·b0 | tier 4 pref / 3 | Yes | ✅ BUILT `71fdb71ad` + `248766ce6` (on origin/master, verified 2026-09-30) — cooldowns published; the fire-frequency count DROPPED by owner ruling 2026-09-29 (privacy: it counted every member's watches, so it revealed whether anyone on UCT watched a ticker). `api/services/alert_taxonomy/cooldowns.py`: `published_cooldowns()` builds each MEMBER-FACING type's re-arm rule at call time from the constants the code consumes (`document_arrival.SWEEP_EVERY_MINUTES` / `sweep_enabled()` now drive `api/main.py`'s scheduler, `FIRE_KEY_GRAIN` builds the fire key, `MAX_FIRES_PER_SWEEP` = newest-filing-only, railed behaviourally); a paused sweep publishes as paused; the published set must equal the router's member `POST /api/alerts/taxonomy/<type>` set (today document-arrival only — the seven dark types reach no member). Published at `GET /api/alerts/taxonomy/cooldowns` and on the watch list's `cooldown` field; rendered in Settings › Filing watches. Removed with the count: the frequency route, `fire_frequency()`, the Research-header line; a rail keeps any `/api/alerts/taxonomy/*` frequency route and any member-record read in `cooldowns.py` from coming back. Tests `tests/test_alert_taxonomy_cooldowns.py` (16) + `useFilingWatch.test.jsx` / `FilingWatchesPanel.test.jsx`. ⚠️ No `#### TERM-062` package (band 4, register-only); spec used = `FB-S7-02`. Follow-ups: position-risk's `DEDUP_GRAIN` string types `6h` beside `voice_proactive_service.MIN_SYMBOL_COOLDOWN_HOURS` (a second authority, unpublished because the type is dark); if pre-save frequency is wanted, derive it from a public source (the SEC filing index) or the member's own fires, never the cross-member record |

### 2.7 Band 5 — THE REST (23). ⛔ Not a rejection band. Register rows only.

| TERM | FB | short title | SZ | DEP | ROLLBACK | PAR | STATE |
|---|---|---|---|---|---|---|---|
| TERM-063 | `FB-S2-01` | The keyboard registry, before any more palette | M | d0·b0 | tier 4 pref / 3 | Partial | ✅ BUILT `f90ca4f7b` + `06deb028d` — `shortcutRegistry.js`, listener census ceiling 112 (re-verified against origin/master 2026-09-30) |
| TERM-064 | `FB-S2-02` | One ticker resolver | M | d0·b0 | tier 4 pref / 3 | Yes | ✅ BUILT `b5bebfe12` (on origin/master, verified 2026-09-30) — `api/services/ticker_resolver.py`: one precedence/grammar/spelling/universe, stop words per input kind; AI Search, catalyst discovery and RSS headlines delegate; tweet ingest (A8 M5) + frontend = follow-up. Evidence `10-roadmap/evidence/2026-09-29-term064/results.md` |
| TERM-065 | `FB-S10-01` | Extract the DataGrid seed before a sixth grid | M | d0·b0 | tier 4 pref / 3 | Yes | ✅ BUILT — seed `06ec39969` (journal grids) + 2026-09-30 the screener (`VirtualResults.jsx` header decisions, `liveSort.js` comparator) onto it, byte-identical to a snapshot recorded by the hand-rolled grid first (`screenerGrid.seedParity.test.jsx`); rail baseline 16 → 14 |
| TERM-066 | `FB-S10-02` | One `format` module | M | d0·b0 | tier 4 pref / 3 | Partial | ✅ BUILT `59714e48c` + `32c30a43c`; the pre-1900 golden added 2026-09-30 (re-verified against origin/master 2026-09-30) |
| TERM-067 | `FB-S10-03` | A form-control layer | M | d0·b0 | tier 4 pref / 3 | Partial | ⛔ census first |
| TERM-068 | `FB-S12-01` | Cohort store + master flag + a real kill switch | M | d0·b1 | tier 0–2 | Yes | ✅ BUILT `380c07089` + `138ff306b` — `rollout.py` + `rollout_gate.py`, kill-switch rail (re-verified against origin/master 2026-09-30) |
| TERM-069 | `FB-A10-02` | Retire the yfinance/Black-Scholes chain leg | M | d0·b0 | tier 4 pref / 3 | Yes | ✅ BUILT `61d7438a4` — `options_chain.py` deleted, rail `test_term069_chain_leg_retired.py` (re-verified against origin/master 2026-09-30) |
| TERM-070 | `FB-A10-03` | `/api/schwab/market-narrative`: 1 KB in 20.8 s | S? diagnose | d0·b0 | tier 4 pref / 3 | No ⚠️ PARTNER (owner-approved 2026-09-29) | ✅ BUILT `8dfd19803` (on origin/master, verified 2026-09-30) — cause: a TTL miss ran the synchronous Sonnet + `web_search` call on the member's request, with no single-flight and no failure caching (the diagnosis note's "30-min cache on a 26-min pod" is half-moot: `cache_snapshot` already carries the TTL entry across a deploy). Fix: new `api/services/market_narrative_swr.py` decorates the route — fresh hit as before, else last GOOD same-date narrative served `Server-Timing desc="stale-swr"` while ONE refresh runs behind the member (`ServeStale`, bound 3600 s), cold herd single-flighted, a failed build memoised 60 s and never last-good (good = the handler itself cached its text), last-good carried across deploys with its build age (`ServeStale.remember(at=)`, additive). `schwab_router.py`: +1 import, +1 decorator, 1 line (cache key from the new module). What the narrative says is unchanged |
| TERM-071 | `FB-A11-01` | Name ONE regime authority | M | d0·b1 | tier 4 pref / 3 | Yes | ✅ BUILT `6a2e59f3d`, merged `1423d8500` (`tests/test_regime_authority.py`; this cell said BUILDABLE until TERM-041 read it) |
| TERM-072 | `FB-A3-01` | Six `_fmp_get` helpers onto one D1 adapter | M | d0·b0 | tier 4 pref / 3 | Yes | ✅ BUILT `e311b1f22` (on origin/master, verified 2026-09-30) — premise re-measured: five of the six helpers were already retired by the D1 build; the sixth, `earnings_estimates._fmp_get`, survived as a SHARED helper reached from **18 files** (AST, every form), and no rail ratcheted that — the vendor census and `fmp_guard_census` see FMP literals and `_fmp_get`-shaped DEFS, not the helper called through an import (a planted probe proved both stay green while the new rail goes red). **Migrated 10 modules / 16 call sites** onto `fmp_client` typed functions (analyst_intel, annual_financials, call_recap_warmer, company_about, earnings_estimates' income-statement gap-fill, earnings_growth_fmp, earnings_table, edgar, institutional_holdings, ir_webcast), each naming the legacy timeout, through the additive `fmp_client.body_or_none` (the legacy "body, `[]` or None" contract in ONE place). Parity `tests/test_term072_fmp_parity.py`: goldens RECORDED FROM THE LEGACY CODE at `322d92f86`, 16 functions × 7 HTTP outcomes, output + request (path, params, timeout). Census `tools/fmp_helper_census.py` + `tests/test_fmp_helper_census.py`: shrink-only `REMAINING`, 8 files each with its reason — bars_sanitize (owner-reserved), implied_backfill (options hot path), research.py news bridge (pinned), fmp_bulk (CSV, G3 deferred), and **four held for the adapter's GLOBAL 120/min default bucket** (earnings_history_fmp, fmp_transcripts, darkpool_eod, screener/earnings_dates: an unpaced burst of 84–180 calls would turn into local denials the legacy helper never produced). ⚠️ Unblock for those four: read `FMP_RATE_LIMIT_PER_MIN` on the service running each sweep (spec §9.4's open item) |
| TERM-073 | `FB-A4-01` | Retain the nightly analyst pass into a timeline | S retain / M surface | d0·b0 | **TIER-NONE** | Yes | ⭐ cost of delay |
| TERM-074 | `FB-A5-04` | Make the Wire view reachable by migration | S | d0·b0 | tier 4 pref / 3 | Yes | ✅ BUILT `9b09d6738` — `viewLadder.js` Wire rung (re-verified against origin/master 2026-09-30) |
| TERM-075 | `FB-A8-01` | Unify the three taxonomies + primary-vs-mentioned | M | d0·b0 | **TIER-NONE** | Yes | ✅ BUILT, DARK `edda444fd` — `A8_PRIMARY_MENTION_ENABLED` pending owner (re-verified against origin/master 2026-09-30) |
| TERM-076 | `FB-A12-02` | Declare and publish device-local vs cross-device | S publish / M move | d0·b1 | **TIER-NONE** | Yes | ✅ BUILT, LIVE `11f9c5803` — Settings "What Syncs Across Your Devices" (re-verified against origin/master 2026-09-30) |
| TERM-077 | `FB-A12-03` | Copy-from-source or link-to-source, chosen at import | S | d0·b0 | **TIER-NONE** | Yes | ✅ BUILT, DARK `4cd31df8b` — `WATCHLIST_COPY_OR_LINK_ENABLED` (re-verified against origin/master 2026-09-30) |
| TERM-078 | `FB-I1-04` | Member-visible AI meters + a population cap | M | d0·b0 | tier 4 pref / 3 | Yes | ✅ BUILT `948af2c17` — meters live; population cap dark (`AI_POPULATION_CAP_MODE`), owner shadow-week then enforce (re-verified against origin/master 2026-09-30) |
| TERM-079 | `FB-S4-01` | Typed context channels, one list-consuming panel | M | d0·b0 | tier 4 pref / 3 | Yes | ⭐ cheapest leverage |
| TERM-080 | `FB-S9-03` | Per-route rate limits before any programmatic client | M | d0·b1 | tier 4 pref / 3 | Partial | ✅ BUILT, DARK `91a33ea28` — `RATE_LIMIT_POLICY` off/shadow/enforce, owner shadow-week (re-verified against origin/master 2026-09-30) |
| TERM-081 | `FB-S9-04` | Give `entitlements.py` the column it reads | S | d0·b0 | **TIER-NONE** | Yes | ◐ COLUMN BUILT `59eefe391`; second toolkit BLOCKED on owner OI-03(a)/(b)/OI-12. ⚠️ UNVERIFIED: `validate_session` now selects `u.toolkit` and flow-worker never runs `auth_db.init_db` — one read of flow-worker's `/data/auth.db` schema settles whether its cookie-fallback path can error (re-verified against origin/master 2026-09-30) |
| TERM-082 | `FB-D4-01` | Widen `serve_stale` past five consumers | M | d0·b1 | tier 4 pref / 3 | Yes | ✅ BUILT for `/api/snapshot` + `/api/movers` (`c4660990c`, `92c51a697`, on origin/master; staleness on `Server-Timing` `desc="stale-swr"`); ✅ BUILT census rank 3 `/api/earnings` + `/api/earnings-gaps` (`7550991ff`, not pushed; date-keyed slot bounded 2400 s, partial TTL 300 s, `/api/push` kicks one refresh and a build straddling a push is never remembered); ✅ BUILT census rank 4 theme-performance live overlay (`be00f2c9a`, not pushed; router-level global slot bounded 30 s = 3x the 10 s TTL, complete = the live 1D map applied and no live map dropped a chunk or lost its client, `?refresh=1` still builds now) and rank 6 `/api/calendar/day-metrics-batch` (same commit; date-keyed slot `max_keys` 16 bounded 600 s, a Finviz leg that ran and failed is partial with TTL min(ttl, 300)); follow-up, ranked: `/api/breadth-monitor` (rank 5) — census `evidence/2026-09-29-term082-serve-stale-census/results.md`; the "known it worked" p95 needs a post-deploy run of `tools/bars_warmth_audit.py`-style measurement (012 is built) |
| TERM-083 | `FB-X1-02` | A backup rail, and a restore **rehearsal** | M | d0·b1 | tier 4 pref / 3 | Yes | ✅ BUILT + ARMED — `STORE_BACKUP_ENABLED` on web since 2026-09-29; first rehearsal 2026-09-30 **12 of 12 stores PASS** (`evidence/2026-09-30-store-restore-rehearsal.md`) |
| TERM-084 | `FB-X2-02` | TTL and rotation on the ICS export token | S | d0·b0 | **TIER-NONE** | Yes | ✅ BUILT — TTL/rotation dark `0b1105775` (`ICS_TOKEN_V2_ENABLED`); (c) `scope=all` BOUNDED 2026-09-30 (`ICS_ALL_MAX_EVENTS`, notice event, anonymous-request rail) (re-verified against origin/master 2026-09-30) |
| TERM-085 | `FB-X3-01` | One wire sentence naming today's explaining surface | S | d0·b0 | tier 4 pref / 3 | Yes ⚠️ other repo | ✅ BUILT, DARK — morning-wire `89c138c` (`WIRE_SURFACE_LINE_ENABLED`, PC-side arm) (re-verified against origin/master 2026-09-30) |

### 2.8 ⭐⭐ NEW (8) — tickets no `FB-*` item covers. Packages at §5.

| TERM | source | short title | SZ | DEP | ROLLBACK | PAR | STATE |
|---|---|---|---|---|---|---|---|
| TERM-086 | item 14 `WF-B06` | Inbound alert receiver: TradingView as an upstream sensor | M | d1 behind 011 | **TIER-NONE** | Yes | ✅ BUILT, DARK `105e611ab` — `INBOUND_ALERTS_ENABLED` (re-verified against origin/master 2026-09-30) |
| TERM-087 | item 14 `WF-C12` | A generated answer returns the product's editable object | M | d1 behind 079 | tier 4 pref / 3 | Yes | ✅ BUILT, DARK `ffa780014` — `AI_SEARCH_SCAN_OBJECT_ENABLED` (re-verified against origin/master 2026-09-30) |
| TERM-088 | item 15 `ACC-02` | ⭐⭐ The decision record gets a member surface | M | d1 behind 023 | tier 4 pref / 3 | Yes | ✅ BUILT, DARK `dccc0acc4` — `DECISION_RECORD_MEMBER_ENABLED`; owner product decision + confirm the Brain Pack carries the tables (re-verified against origin/master 2026-09-30) |
| TERM-089 | item 15 `ACC-10` | A replay surface for the Morning Wire payload archive | S | d0 | tier 4 pref / 3 | Yes | ✅ BUILT, LIVE `c26c8f863` — "Past issues" wire archive (re-verified against origin/master 2026-09-30) |
| TERM-090 | item 15 `ACC-06` | The episodic-pivot base rate, beside the flag | S | d0 | tier 4 pref / 3 | Yes | ✅ BUILT, LIVE `8d1265ccc` — EP base rate beside the flag (re-verified against origin/master 2026-09-30) |
| TERM-091 | item 15 `ACC-13` | Load `docs/curriculum/` into the shipped education store | M | d0 | **TIER-NONE** | Yes | ✅ BUILT `ffe8a3f40`, DARK (`EDU_CURRICULUM_ENABLED`) · ⭐ OWNER RULING 2026-09-29: show the text lessons (arm EDU_CURRICULUM_ENABLED) and credit NO third party — credits are still derived/stored internally but no read route returns them (`SHOW_THIRD_PARTY_CREDIT = False`). |
| TERM-092 | CARD 27 | Re-time the wire missed-run watchdog past 09:30, + a rail | **XS** | d0 | tier 4 pref / 3 | Yes | ⛔ owner deploy |
| TERM-093 | item 14 `WF-C13`/`WF-C09` | The "what else was open, named" capture | S | d0 | **TIER-NONE** | Yes | ⛔ owner subject |

### 2.9 ⛔ Why bands 0, 4 and 5 carry register rows and not work packages — stated, not hidden

**49 of the 93 tickets get a register row and no 17-field package**, and that is a deliberate depth
declaration rather than an unfinished file. Three different reasons, one per band:

- **Band 0 (10)** has no engineering content to specify. Its deliverable is a person's sentence, a
  vendor request, a purchase or a dashboard read — *"the only band that costs nothing and unblocks
  other bands"* (item 17 §5). Writing `API work` and `UI work` for "declare a quiet window" would be
  fiction. §6 gives each one the held input by name, which is the field that actually matters.
- **Band 4 (26)** is `d ≥ 1`. ⛔ A package's `Files/modules likely affected` and
  `Acceptance criteria` for a ticket sitting behind an unbuilt enabler are **a forecast about an
  interface that does not exist yet** — and this repo has a name for that: *an acceptance number is a
  forecast until derived*. Two of the 26 are **impossible** rather than deferred (`TERM-051` before
  `TERM-021`; `TERM-041` while two regime authorities exist), so specifying them now would specify
  against a contradiction. Each row names what it waits on, which is what a sequencer needs.
- **Band 5 (23)** is `d0` and genuinely startable, and this is the weakest of the three reasons —
  ⚠️ **it is a budget decision, and it is this file's largest gap** (GAPS 1). Fifteen of the 23 fail
  band 3 on **size alone**, including `TERM-063` (which best-of-breed calls *"the best-evidenced row
  in this file"*) and `TERM-079` (which item 17 independently calls *"the cheapest high-leverage
  platform item in the estate"*). ⛔ **Reading band 5 as a rejection band would be the worst misuse of
  this register**, and two rows carry a monotonic cost of delay that outranks their band:
  `TERM-073` (*"a retention series cannot be backfilled, so every night not retained is permanently
  lost"*) and `TERM-083` (the restore rehearsal every versioned store depends on).

⭐ **What every row does carry, package or not:** its FB id (so item 16's nine fields are one hop
away), its size, its depth, **its rollback tier**, its parallelism verdict and its state. That is
enough for a sequencer and not enough for an implementer — and saying which is which is the point.

---

## 3. ⛔⛔ The 25 tickets with no rollback tier

### 3.1 The count, derived

```
# over this file, after writing:
grep -c 'TIER-NONE' 10-roadmap/backlog.md                 # every mention, incl. prose
grep -oE '^\| TERM-[0-9]{3} .*\*\*TIER-NONE\*\*' 10-roadmap/backlog.md | wc -l   # register rows only
```
**Register rows carrying `TIER-NONE`: 25.** Composition, also derived from the register rather than
typed: **22 carried from item 17's `REV R3` column** (`05-product-strategy/feature-scoring.md:322–:330`,
which enumerates all 22 by id, so the set is checkable by set-difference and not by trust) **+ 3 new**
(`TERM-086`, `TERM-091`, `TERM-093`). The other two axis values close the arithmetic the same way:
`tier 0–2` → 4 carried (`FB-S12-01`, `FB-S12-02`, `FB-S7-03`, `FB-OBS-08`) + 0 new;
`tier 4 pref / 3` → 59 carried + 5 new. **25 + 4 + 64 = 93.**

### 3.2 How they are marked, and what the mark does and does not mean

Each of the 25 carries the literal token **`TIER-NONE`** in its `ROLLBACK TIER` field, bolded in the
register, and — in §4 and §5 where a package exists — one sentence naming **which of item 17's three
R3 shapes** it is, because the shapes have different remedies:

| shape | count | the tickets | what would give it a tier |
|---|---|---|---|
| **creates or changes persistent state** | 12 carried + 3 new | 020, 021, 022, 023, 046, 049, 051, 055, 073, 075, 077, 081 · **086, 091, 093** | a store-change tier: a reversible migration convention, or a dual-write-then-cut convention. Item 37 has neither |
| **changes a published value or an address a member can already hold** | 7 | 037, 038, 042, 056, 076, 084, 009 | a parallel-run-then-swap convention, plus an answer to *"what reaches a member who already pasted the old address"* |
| **not an engineering act at all** | 3 | 002 (vendor request), 003 (product decision), 007 (scheduling decision) | nothing. ⭐ These need no tier and marking them `TIER-NONE` is correct rather than a gap |

⛔ **Three things `TIER-NONE` does not mean.** It does not mean *do not build it* — `TERM-020`,
`TERM-021`, `TERM-022` and `TERM-023` are half of band 2 and carry between three and five dependents
each. It does not mean *irreversible* — a store change is usually reversible; what is missing is a
**written, gated procedure for doing it**, which is a different absence. And it does not mean item 37
was careless: item 37's job was the **rollout ladder** and every tier it published is real and cited.
⭐ The hole is at the seam between two deliverables, which is exactly where holes live.

### 3.3 ⛔ What a ticket author must do with a `TIER-NONE` ticket, since "invent a tier" is forbidden

Four rules, each quoted from the artefact that owns it so a paraphrase cannot soften them:

1. ⛔ **Write the reversal plan in the same commit as the change**, never in a follow-up. F-01 PROD-1
   via item 16: *a documented workaround is not a recovery path* — the re-enable path ships in the
   **same commit**. `TERM-084`'s own package says this because item 16 records UCT paying for that
   class once already.
2. ⛔ **Never stop a dark run with a DELETE.** Item 37 `:590–:594`, verbatim: *"Stopping a dark run
   must never be a DELETE against member data — flags stay env vars and cohorts stay tags."* Removing
   one member from a cohort is *"a legitimate per-member action and a DB write; it is not the incident
   lever."*
3. ⛔ **A kill switch defaults ON; an enablement gate defaults OFF** — and item 37's §0 finding 1 is
   the trap that follows: `feature_flag_index.needs_declaration()` returns `not defaults_on(...)`, so
   **a kill switch is outside `docs/feature_flags.json` by construction**, and RB-4 (`:777`) is the
   remedy: at the S4 graduation commit the flag is added to the ledger **by hand** with
   `status: armed`, *"plus a rail asserting the ledger contains it by name."*
4. ⛔ **The tier-4 branch is the tier to reach for, and it must be pre-authored.** Item 37 `:90–:95`:
   since the 2026-09-16 cutover *"revert-and-push is no longer a rollback — it is a rollback
   **request**"*, because `web` deploys from `production` and the promotion workflow promotes nothing
   unless the gate concluded success. So a pre-authored, pre-gated branch is *"the only revert whose
   gate result is known before you need it"* — and RB-8 (`:781`) re-gates it *"whenever master has
   moved more than five commits ahead of it, or has touched a file it touches."*

⚠️ **And the standing caveat on all 93, not just the 25.** Item 37 GAPS 8: *"A tier nobody has pulled
in anger is a procedure, not a capability."* **No rollback has been rehearsed.** So the 64 tickets
marked `tier 4 pref / 3` carry a tier that has never been exercised, and `TERM-083`'s deliverable —
*"the restore rehearsal, not the schedule"* — is the ticket that would change that sentence.

---

## 4. The work packages — bands 1, 2 and 3, in the Part CCI schema

⛔ **Every package carries all seventeen Part CCI fields plus §1.2's ROLLBACK TIER, in the charter's
order.** Where a field is genuinely empty it reads `None.` with the reason — an empty field and an
unconsidered field look identical otherwise, which is DOC-1's whole shape. ⭐ `Acceptance criteria` is
the field to read first: item 16's *"Known it worked"* is its source, and where that field named a
fixture that does not exist the package says **⛔ FIXTURE ABSENT** rather than restating an
untestable sentence as though it were testable.

### 4.1 Band 1 — the measurement floor. Nothing after this can be said to have worked.

⭐ **Order within this band is asserted**, unlike every other band, because item 25 already argued it:
`TERM-011` first (*"configuration, not code"*, and it must land **before** the traffic that would mute
the channel), then `TERM-012` (*"The fix is small"*), then `TERM-015` (*"fourth and not later, because
it is what makes items 3, 5 and 6 verifiable"*), then the rest, with `TERM-018` as the shipping gate
over all of them.

#### TERM-011 · `FB-S7-03` — A second delivery channel, and ops split from business events
- **User outcome.** A page reaches somebody when Discord is the thing that is down, and an ops alarm
  no longer arrives in the channel members use for signups — so the channel stays worth reading.
- **Context.** Discord is the sole alerting channel and is *"the first thing to go quiet"*. `b6` — the
  second-highest blocks count in the backlog — at `SZ S`, `d0`, and it is the only band-1 item at
  `REV R1`. Item 25 §5 ranks the split **fifth overall but first inside this band** *"because it is
  configuration, not code"*, and says it must land before the traffic it fixes.
- **Dependencies.** None. It is a precondition of `TERM-013`, `TERM-015`, `TERM-016` and (via the ops
  channel) `TERM-086`.
- **Existing code to reuse.** The shipped Discord webhook posters and `liveflow_monitor`'s posting
  posture (uct-dashboard, `api/`). ⛔ Reuse the **routing**, not a second copy of the poster.
- **Files/modules likely affected (with repository).** uct-dashboard: the alert-emitting modules under
  `api/services/` that currently resolve one webhook env var; a single channel-resolution helper; the
  monitor entrypoint `api/terminal_next_monitor_main.py`. ⛔ No partner file.
- **Data requirements.** None new. **Licensing: CLEARED (existing estate, CARD 26)** — no feed.
- **API work.** None member-facing. One internal resolver: `(severity, class) -> channel`.
- **UI work.** None.
- **Testing.** A pure decision function over `(severity, class)` with a **control** (item 25 §4.6
  method 1: *"S1, S2, S5, S6 and S10 are all this shape and must be written this way"*), plus the
  AST-over-the-scheduler rail so a route that posts nowhere fails by name.
- **Observability.** It **is** routing for observability; its own health is `TERM-015`'s roll-up.
- **Risks.** ⚠️ The severity inversion item 16 names: *"paging on drops trains the channel to be
  ignored, which is how the page that matters gets muted."* `RSK none-named` — the hazard is a ledger
  row and `GOVERNING_PRINCIPLES` §13, not an `anti-patterns.md` entry, so **no detector exists**.
  ⛔ Flags: the webhook env var names are **NAMED, UNREAD** (no Railway access). Never `POP` a webhook
  variable to silence a monitor — **blank it**, or the population it grades cannot answer.
- **Acceptance criteria.** (a) An ops-class alarm and a business-class event, emitted in the same run,
  land in **different** channels, asserted on the resolver's return and not on a live post. (b) The
  resolver has **no default**: an unclassified emitter fails the rail by name. (c) With the primary
  channel's variable blanked, a CRITICAL still reaches the second channel — proved on a fixture, and
  the fixture must be **seen red** before it is green.
- **Estimated complexity.** **S** for the split; **M** for a genuine second transport. Ship the split.
- **Parallelizable?** **Yes** — one lane, touches no shared UI file.
- **Blocked by (IDs).** None.
- **ROLLBACK TIER.** `tier 0–2` — an env var read per emit, no rebuild (item 37 `:311`). ⭐ One of only
  four tickets in the register that comes back without a build.

#### TERM-012 · `FB-OBS-01` — Make CARD 16's p95 gate measurable ⚰️ RECUT
- ✅ **BUILT 2026-09-29.** (a) and (c) had already shipped: `stale-swr` is its own `STALE_SERVED` bucket, counted as
  served in the no-wait p95, and an uncomputable gate prints NOT COMPUTABLE. The gap was (b): no line named its
  quantity. `tools/bars_warmth_audit.py` now prints every percentile through `pct_line`, which carries `n` and
  `QUANTITY` (client wall-clock, incl. TLS/CDN/network, not `Server-Timing dur`). Rails in
  `tests/test_bars_warmth_audit_buckets.py`: the 40-sample stale-swr fixture, the n=40 → index 38 boundary, and
  both buckets routed through the helper. ⚠️ `pct_of` ≠ `flow_router._diag_percentile` (index 38 vs 37 at n=40),
  kept deliberately for continuity with recorded p95s; named in the code, not unified.
- **User outcome.** The programme's only performance gate can be evaluated at all, so "fast enough"
  stops being an opinion.
- **Context.** ⚰️ **The recut.** Item 17 §3.7 and ARCH-07-OBS G-2 rest on a control:
  *"Nothing in the serving process computes a latency percentile for any surface"*, evidenced by
  `grep -rn "p95\|percentile" api/` returning *"hits in exactly one module: `api/baselines.py`"*.
  **That control is false on `origin/master` today.** `git grep -c "p95\|percentile" origin/master --
  api/` returns hits in ten-plus modules, and two are genuine **latency** percentiles:
  `api/flow_router.py:1628–:1636` times `time.monotonic()` deltas into `p50_ms`/`p90_ms`/`p95_ms`/
  `p99_ms` via `_diag_percentile`, and `api/services/journal_two/notebook_telemetry.py:100` keeps a
  rolling-window `p95_ms` per event. ⭐ **This makes the ticket cheaper, not smaller in importance:
  there is a shipped percentile idiom to copy rather than a concept to introduce.** What ARCH-07-OBS
  got exactly right is the bars audit itself — `tools/bars_warmth_audit.py:27–:28` still has
  `stale-swr` in `COLD`, `:112` prints a p95 for the **WARM** bucket only and behind `if warm_ms:`,
  and `:115` prints p50/max but **no p95** for COLD. The mechanical change is unchanged.
- **Dependencies.** None. `TERM-082` and (for verification) several band-4 tickets inherit it.
- **Existing code to reuse.** ⭐ `_diag_percentile` in `api/flow_router.py` and the windowing in
  `api/services/journal_two/notebook_telemetry.py` (uct-dashboard) — **one of these two, not a third
  implementation**, or this ticket creates the second authority it exists to prevent.
- **Files/modules likely affected (with repository).** uct-dashboard: `tools/bars_warmth_audit.py`
  (the `COLD`/`WARM` sets at `:27–:28`, the print at `:109–:116`); one shared percentile helper's
  import site. ⛔ No partner file.
- **Data requirements.** The existing `Server-Timing: bars;desc="<layer>";dur=<ms>` header — *"Per-request
  timing exists; nothing aggregates it."* **Licensing: CLEARED** — no feed.
- **API work.** None. ⛔ Deliberately not a new metrics endpoint: the gate is evaluated by a tool.
- **UI work.** None.
- **Testing.** ⛔ **The stated control, and it must fail first:** *"a fixture of 40 `stale-swr`
  samples must produce a p95 line, which today's code cannot."* Plus a boundary test on the
  percentile index, because INST-8/DOC-1 bind — *"on n = 40 that is index 38, the second largest of
  forty"*, so the helper must declare its `n`.
- **Observability.** `OBS is the fix` — this ticket **is** the observable other tickets need.
- **Risks.** **INST-4** (a definition of done a healthy system fails) is what CARD 16 escaped and an
  unmeasurable gate re-creates *"one level up"*; `RSK undet`. ⚠️ And the quantity must be named:
  `wall` includes TLS/Cloudflare/network while `Server-Timing dur` does not — *"Neither is wrong…
  What is wrong is that the gate does not name one."* OBS-1's default is **client wall-clock,
  n ≥ 60 per timeframe**, `stale-swr` counted as SERVED.
- **Acceptance criteria.** (a) The 40-sample `stale-swr` fixture produces a p95 line for **both**
  buckets, seen red before the change. (b) Every printed percentile carries its `n` and the name of
  the quantity. (c) `stale-swr` appears in `WARM`, per the ruling that already exists.
- **Estimated complexity.** **S** — *"The fix is small"* (ARCH-07-OBS, which ranks it first). ⭐ The
  recut arguably makes it **XS**, since a helper now exists; stated, not claimed.
- **Parallelizable?** **Yes.**
- **Blocked by (IDs).** None.
- **ROLLBACK TIER.** `tier 4 pref / 3` — a tool-side constant, bundle-shaped for the shared helper.

#### TERM-013 · `FB-OBS-02` — Read the drop counters on a schedule
- **User outcome.** When the live-bars rail dies, somebody finds out from an alarm instead of from a
  member noticing a fallback.
- **Context.** The counters exist, are correct, and nothing reads them: the status getters are called
  *"exactly two hits, both inside the route that serves them"*, and outside `api/` the endpoint
  appears *"at exactly one place: `tools/market_open_chart_check.py:247`"*. The route's own docstring:
  *"`bars_dropped_total` > 0 = slow-consumer data loss."* ⚠️ The honest negative: a Windows Task
  Scheduler state was **not** read, so the claim is *"no standing schedule is recorded in this
  repository"*, not "none exists".
- **Dependencies.** `TERM-011` (the channel split should land before the traffic).
- **Existing code to reuse.** ⭐ `liveflow_monitor` — item 25 G-9: *"the design for the bars stream
  does not need inventing, it needs **porting**"*; its docstring claims it *"would have caught all 16
  downtime windows on 2026-07-06"*. The two differ in exactly one respect: last-value-wins drops are
  conflation → digest; a tape gap is permanent → page.
- **Files/modules likely affected (with repository).** uct-dashboard:
  `api/terminal_next_monitor_main.py` (the existing `terminal-next-monitor` service — ⛔ **not a new
  service**, per item 25 OBS-9: *"a sixth service is five more things to forget"*); a decision module
  under `api/services/`; the reader of `/api/admin/bars-stream-status`.
- **Data requirements.** `bars_emitted_total`, `bars_dropped_total`, `last_emit_age_s`, subscriber
  counts, `fh_budget_denied_total` — all already emitted. **Licensing: CLEARED.**
- **API work.** None new; it reads a shipped admin route.
- **UI work.** None.
- **Testing.** A pure decision function with a control, plus the AST-over-the-scheduler rail
  (item 25 §4.6 methods 1 and 3) so "wired into no scheduler" fails by name.
- **Observability.** OBS-2's thresholds: *"**Any** Δ`bars_dropped_total` → DIGEST.
  `bars_emitted_total` flat across **3** consecutive 60 s RTH polls with `subscriber_pairs > 0` →
  PAGE."*
- **Risks.** ⛔ **INST-3 is the trap**: the counter is per-process and *"reset to 0 by every deploy"*,
  so a total must be read as a **delta** and the reader must re-read the artifact, never a streak
  counter a redeploy resets. `RSK undet` (PERF-6 has no detector). ⚠️ RB-11 binds the schedule:
  nothing in Terminal-Next ships into flow-worker's watch list during RTH.
- **Acceptance criteria.** (a) The decision function returns PAGE on the flat-emitted-with-subscribers
  fixture and DIGEST on any positive drop delta, both seen red first. (b) The AST rail finds the job
  id in the scheduler **and** has a non-vacuity control. (c) A simulated redeploy mid-window does not
  produce a spurious PAGE.
- **Estimated complexity.** **M.**
- **Parallelizable?** **Yes.**
- **Blocked by (IDs).** `TERM-011`.
- **ROLLBACK TIER.** `tier 4 pref / 3`.

#### TERM-014 · `FB-OBS-03` — An RSS-slope reader, and per-subsystem attribution ⛔ HELD via TERM-007
- **User outcome.** The leak that costs ~470 MB an hour can be attributed to a subsystem, so the
  process-topology question can be answered instead of guessed.
- **Context.** Measured: *"76 `[mem]` samples across 104 minutes"*, quartile medians
  *"2,429 → 2,746 → 2,956 → 3,028 MB"* = **+7.9 MB/min, monotonic**. The sampler is
  `print(f"[mem] rss_mb=… threads=…")` every 60 s at `api/main.py:4517` and *"writes to stdout only.
  Nothing reads it; nothing stores it; a deploy ends the series."* ⭐ Item 25's reframing is the whole
  ticket: *"That is not a memory finding; it is an observability requirement."* ⛔ ARCH-07 §5.1 fixes
  the order: *"Fix the leak before choosing a process topology… the next step is one held window with
  per-subsystem attribution, not a topology decision."*
- **Dependencies.** `TERM-015` (a slope with no cadence contract is *"item 24's `n = 1` again"*) and
  ⛔ `TERM-007` — a quiet window, which is a person's act.
- **Existing code to reuse.** `/api/health/memory` with `?deep=1` (GC type histogram, per-cache byte
  estimates) and `?trim=1` — *"the one call that separates 'allocator is hoarding freed pages' from
  'a C extension is genuinely holding this'"*; `_web_memwatch`'s 60 s loop.
- **Files/modules likely affected (with repository).** uct-dashboard: `api/main.py:4517` ⚠️ **high-conflict
  shared file (Part CCIV)** — the sampler's emit site only; a store + slope reader on
  `api/terminal_next_monitor_main.py`.
- **Data requirements.** A retained series: OBS-5 — *"**90 days** per signal, **max 400 rows**"*,
  because the volume has *"a measured 33 GB runaway in its history"*. **Licensing: CLEARED.**
  ⛔ Never write to `C:\data`; the series lives on the pod volume.
- **API work.** None member-facing.
- **UI work.** None.
- **Testing.** A clamp/classifier proved at its boundaries (item 25 §4.6 method 2): OBS-3 requires
  *"≥ 40 `[mem]` samples within one deployment id before a slope is emitted, and report
  `deployments_sampled`"*, because *"5 samples on a 5-minute pod read flat-to-declining on a pod
  leaking 7.9 MB/min"*. OBS-4: PAGE at threads > 200 and at RSS > **3,500 MB**.
- **Observability.** The slope itself, carrying `deployments_sampled`.
- **Risks.** **PERF-5** exactly (*"measuring memory over a window shorter than the leak's signal"*)
  plus **INST-9**. ⛔ The *ordering* is the anti-pattern's real content: choosing a topology first
  would act on a measurement that does not exist. ⚠️ Citation caution carried from item 16: OBS-4's
  *"max RSS 3,401 MB"* rationale **does not appear** in ARCH-07 §2.2's published table, which prints
  quartile medians — the 3,401 figure is ARCH-07-OBS's alone.
- **Acceptance criteria.** (a) A monotonic slope across quartiles over a window of at least the
  104-minute sample, carrying `deployments_sampled`. (b) A ceiling crossing pages. (c) ⛔ **The
  attribution names a subsystem** — without that the ticket has been *instrumented*, not done.
- **Estimated complexity.** **L** — the slope reader is M; per-subsystem attribution is the hard half
  and is what §5.1 actually asks for. *"The measurement does not identify what leaks."*
- **Parallelizable?** **Yes** for the reader; **No** for the measurement window itself, which is a
  sole-occupancy event (§7).
- **Blocked by (IDs).** `TERM-015`, and ⛔ `ACT:` the owner naming a quiet window (`TERM-007`).
- **ROLLBACK TIER.** `tier 4 pref / 3` for the reader. ⚠️ The **retention series** it starts is the
  `TERM-073` shape and its own reversal is unwritten; flagged here rather than re-tiered.

#### TERM-015 · `FB-OBS-04` — The cadence heartbeat and the daily dead-man roll-up
- **User outcome.** *"No alert since Tuesday"* and *"the cron has not fired since Tuesday"* stop being
  the same observation — which is the failure that hides every other failure.
- **Context.** Item 25 G-7, severity **PAGE**: *"`liveflow_monitor:20-22` is the only production
  construct in this repo under which an **absent** report is itself an alarm. Every other monitor
  surveyed is silent-on-healthy by design and says so."* Ledger L4 already names the gap inside a
  shipped system — *"a quiet run and nothing-to-check look identical in Discord"* — and ledger O11
  records the cost: *"four jobs failing silently for weeks; two terminated on battery; nothing reads
  `LastTaskResult`."*
- **Dependencies.** `TERM-011` (it needs an ops channel to be one message rather than noise).
  It is what makes `TERM-013`, `TERM-016` and `TERM-017` verifiable.
- **Existing code to reuse.** ⭐ `desk_session_audit._write_state`'s atomic `os.replace` idiom for the
  marker, and liveflow's dead-man scorecard, which posts *"EVERY trading day — its ABSENCE by
  4:30 PM ET is itself the alarm."*
- **Files/modules likely affected (with repository).** uct-dashboard: a marker helper under
  `api/services/`; each signal's emit site; the roll-up job on `api/terminal_next_monitor_main.py`.
- **Data requirements.** One marker file per signal per period, on the pod volume.
  **Licensing: CLEARED.**
- **API work.** None.
- **UI work.** None.
- **Testing.** The recursive test item 25 states: *"The monitor must be able to answer the question
  about **itself** — S6 exists so that 'when did this signal last report?' has an answer that does not
  depend on the signal being healthy."*
- **Observability.** ⭐ One daily roll-up naming every signal that did **not** report in its window,
  which *"posts even when everything is fine… it is not an alert, it is the cadence proof"* —
  *"Exactly one such message per day, on the ops channel."*
- **Risks.** **INST-3** — it is the structural answer to a health check reading a proxy. ⚠️ PROD-C1's
  cousin: a roll-up that posts daily can itself be muted, which is why `TERM-011` is a dependency and
  not a nicety. ⛔ And item 25's own standard applies to it: *"a signal which fires on the normal case
  is not a noisy signal — it is a signal that will shortly be no signal"*, so the roll-up must be
  **one** message, not one per signal.
- **Acceptance criteria.** (a) A deliberately stopped job appears **by name** in the next roll-up.
  (b) The roll-up posts on a fully healthy day. (c) Exactly one message per day, asserted by count.
- **Estimated complexity.** **M** — one marker convention plus one roll-up job.
- **Parallelizable?** **Yes.**
- **Blocked by (IDs).** `TERM-011`.
- **ROLLBACK TIER.** `tier 4 pref / 3`.

#### TERM-016 · `FB-OBS-05` — Durable cooldowns for `chart_health_alerts`
- **User outcome.** A standing critical is paged once, not once per deploy — so the channel keeps its
  meaning on a day with fourteen deploys in it.
- **Context.** Item 25 G-6: *"`_alerts: deque = deque(maxlen=200)` with `_throttle` and
  `_discord_last` as module dicts"*, and the file's own header records the incident —
  *"the in-memory deque was admin-pull-only, so a bars-store problem paged no one — the gap that let
  the 2026-08-11 daily freeze run for a week"*. **Both cooldowns are module dicts**; a redeploy clears
  `_discord_last`, so a standing critical re-pages on the first cycle after every deploy. Against
  ARCH-07 §2.5's measured *"fourteen deploys in six and a half hours; median pod life 26 minutes"*,
  that is fourteen pages for one fault.
- **Dependencies.** `TERM-011` — item 25 ranks this seventh *"because it is a duplicate-page problem,
  and duplicate pages only matter once the channel is worth listening to."*
- **Existing code to reuse.** ⭐ `fundamentals_monitor.monitor_meta` — *"The same fix is available and
  is one table."*
- **Files/modules likely affected (with repository).** uct-dashboard: the `chart_health_alerts` module
  (`_throttle`, `_discord_last`, the `deque`), plus a `monitor_meta`-shaped table.
- **Data requirements.** One table. **Licensing: CLEARED.**
- **API work.** None.
- **UI work.** None.
- **Testing.** A fixture that **simulates the restart** and asserts no re-page.
- **Observability.** The cooldown's state is readable in a table rather than inferred from silence.
- **Risks.** **STATE-7** — a per-process dict read as a cache when it is a correctness guard;
  *"a second instance silently doubles each bound."* Plus **INST-3**: a cooldown a deploy resets is a
  proxy for "we already told you". `RSK undet`.
- **Acceptance criteria.** (a) A standing critical does **not** re-page across a simulated deploy,
  seen red first. (b) The cooldown survives in a table, asserted by reading the table and not the
  module.
- **Estimated complexity.** **S** — one table.
- **Parallelizable?** **Yes.**
- **Blocked by (IDs).** `TERM-011`.
- **ROLLBACK TIER.** `tier 4 pref / 3`. ⚠️ It creates a table; the shape is `TIER-NONE`'s, but the
  table is **ops state, not member data**, so item 37's tier 3/4 genuinely covers it. Stated because
  the distinction is the one place this file draws a line item 17 did not.

#### TERM-017 · `FB-OBS-06` — The loop-lag distribution, so CARD 18's arming window can exist ⛔ HELD via TERM-007
- **User outcome.** The number the watchdog-arming decision rests on exists for the first time.
- **Context.** `event_loop_watchdog._state["max_lag_ms"]` starts at `0.0` and only ratchets up
  in-process, while its own runbook instructs the operator to watch it *"for a few days"* — against a
  **median pod life of 26 minutes**. Observed today: *"max lag 14.9 ms over 330 checks"* against a
  `wedge_sec` of 30, with `enabled: false`. **CARD 18** rules NOT YET and names the condition: one
  window spanning **a market open and a heavy-job window**, with ⛔ *"The runbook's '3–5× observed
  max_lag' heuristic must **not** be applied to a 27-minute after-hours sample."*
- **Dependencies.** `TERM-015` (cadence) and ⛔ `TERM-007` (the window).
- **Existing code to reuse.** `/api/watchdog/status` (which item 25 records has *"no scheduled reader
  in this repo"*), and `TERM-015`'s marker convention.
- **Files/modules likely affected (with repository).** uct-dashboard: the watchdog module's sampler;
  out-of-process accumulation on `api/terminal_next_monitor_main.py`.
- **Data requirements.** A retained distribution under OBS-5's 90-day / 400-row bound.
  **Licensing: CLEARED.**
- **API work.** None new.
- **UI work.** None.
- **Testing.** The design rule this generalises is item 25's one new idea and belongs in the test's
  name: *"per-process state is fatal for a **CUMULATIVE** quantity (a leak slope, a drop total, a max
  over days) and perfectly adequate for a **DISTRIBUTIONAL** one measured inside one pod's life."*
- **Observability.** A percentile over at least one trading day, spanning an open and a heavy-job
  window.
- **Risks.** ⛔ **INST-3 and GATE-8 together** — arming a killer on a threshold derived from an
  after-hours sample would set ~60 ms against a shipped 30 s, and *"the failure mode of an over-tight
  watchdog is killing a healthy member-facing pod."* **DIGEST until CARD 18's condition is met.**
  ⛔⛔ **This ticket must not arm anything**: *"S5 exists to **produce** that window rather than to
  pre-empt the ruling. Nothing here arms the killer."* `WATCHDOG_ENABLED` is **NAMED, UNREAD** and
  stays unset.
- **Acceptance criteria.** (a) A percentile over ≥ 1 trading day exists, spanning an open and a
  heavy-job window — which is CARD 18's own condition. (b) `WATCHDOG_ENABLED` is unchanged by this
  ticket, asserted by diff. **The deliverable is the window, not a decision.**
- **Estimated complexity.** **M.**
- **Parallelizable?** **Yes** for the sampler; the window itself is sole-occupancy (§7).
- **Blocked by (IDs).** `TERM-015`, and ⛔ `ACT:` the quiet window (`TERM-007`).
- **ROLLBACK TIER.** `tier 4 pref / 3`.

#### TERM-018 · `FB-OBS-09` — Prove every guard can fire. A shipping precondition, not a feature.
- **User outcome.** None directly. It is the reason the other seven are worth having.
- **Context.** Item 25's own GAPS: ⛔ *"**No guard was proved to fire.** … every signal in §4.3 is an
  unproved guard until §4.6 is discharged — a precondition of shipping any of them, not a footnote."*
- **Dependencies.** Each of `TERM-012` … `TERM-017` (and `TERM-011`), as their shipping condition.
- **Existing code to reuse.** ⭐ Ledger **L4**, *"the best-designed audit in the repo"* — an AST over
  `api/main.py` proving the `add_job` id exists **and** a non-vacuity control. Nothing else does this.
- **Files/modules likely affected (with repository).** uct-dashboard: each new signal's test module;
  one shared AST-over-the-scheduler rail under `tests/`.
- **Data requirements.** None. **Licensing: CLEARED.**
- **API work.** None. **UI work.** None.
- **Testing.** It **is** the testing ticket. Four methods, per signal: a pure decision function
  unit-tested **with a control**; a clamp/classifier proved at its boundaries; ⭐ **mutation-checking
  the wire** — *"The wire is the part that has actually been cut in this repo"* — so every signal needs
  the AST-over-the-scheduler rail, not only a logic test; and a live trigger with an injected verdict.
  ⛔ Plus the seam rule: *"a default argument bound at import makes `monkeypatch.setattr` reach
  nothing… **Every injected seam in a new monitor must be `=None` and resolved in the body**, or its
  proof is theatre."*
- **Observability.** None of its own.
- **Risks.** **GATE-1** (*"a guard nobody has seen fire"*) and **PROC-9**. ⭐ F-01's framing:
  *"An audit nobody runs is worse than none: it reads as coverage."* ⛔ And a rule of this programme
  binds the work: **delete every copy of a guard but one** — three copies cannot be mutation-proved.
  ⛔ Never verify a guard with `git checkout`; mutate, observe red, restore by the inverse edit.
- **Acceptance criteria.** Each signal has a test that has been **observed red before it was green**,
  and an AST-over-the-scheduler rail **with a control**. ⛔ Nothing in band 1 ships without both.
  ⚠️ `vitest -t` is a regex: a filter matching nothing exits 0, which is a false PASS — the rail must
  assert its own non-vacuity.
- **Estimated complexity.** **M** in aggregate, and it is **per signal**.
- **Parallelizable?** ⛔ **No.** Item 29's ceiling: verification is the step that collapses to **one**
  on this box, and this ticket is verification.
- **Blocked by (IDs).** `TERM-011`…`TERM-017`.
- **ROLLBACK TIER.** `tier 4 pref / 3` — tests are bundle-shaped.

### 4.2 Band 2 — the enablers. `d0`, and between two and eleven items sit behind each.

#### TERM-019 · `FB-S8-01` — The provenance set, plus a rail that every panel uses it ⚰️ RECUT
- **User outcome.** Every panel says where its number came from and how old it is, in one vocabulary,
  and a new panel cannot ship without saying so.
- **Context.** ⚰️ **The recut, and it is the cheapest lever in the file getting cheaper.** Item 16 §2.4
  corrected this once already (*"the freshness badge is not absent either"*), and item 17 sized it
  **M** *"because two of its four primitives already ship"*. On `origin/master`
  **all four ship, with tests**: `app/src/components/provenance/` holds `Provenance.jsx`,
  `FreshnessBadge.jsx`, `CoverageLine.jsx` and `Cited.jsx`, each with `.test.jsx` and `.module.css`,
  plus `freshnessContract.js`, `availabilityContract.js`, `presentationFormat.js` and
  `sessionStale.js`. ⛔ **There is no extraction half left.** F-01 PROD-C7 supplies the exact residual:
  the primitives exist and *"nothing asserts that every panel uses them."* `b11` — eleven items
  transitively behind it, the highest in the backlog.
- **Dependencies.** None. ⭐ Sequence **with** `TERM-050` (`FB-I1-01`), which item 16 calls the other
  half of one build, not a follow-on.
- **Existing code to reuse.** All four components and all four contracts above, unchanged; and
  `i1S8Boundary.test.js` (AST-derived forbidden vocabulary) — ⭐ *"extend its roots, not rewrite the
  section."*
- **Files/modules likely affected (with repository).** uct-dashboard: `app/src/components/provenance/*`
  (additive only); one rail under `app/src/**/*.test.js*`; the adopting panels' render paths.
  ⚠️ Adoption touches many files — see `Parallelizable?`.
- **Data requirements.** Each adopting panel must supply an as-of and a source name. ⛔ Where it
  cannot, the honest render is a stated absence, not a blank. **Licensing: CLEARED.**
- **API work.** None for the rail. Adoption may need an as-of field on responses that omit one; each
  such response is a separate small ticket, not folded in here.
- **UI work.** Adoption per panel. ⛔ No new component.
- **Testing.** ⭐ **The rail is the ticket**: a panel that renders a value and imports none of the four
  primitives fails **by name**, with a non-vacuity control (a fixture panel that must fail).
- **Observability.** The rail's own pass/fail count, published with its denominator — the same
  discipline `TERM-026` exists to enforce.
- **Risks.** **PROD-C7** is what it closes. ⚠️ The real hazard is a rail that passes vacuously: a
  regex filter matching nothing exits 0. ⛔ And *a guard repeated is a guard unproved* — **one** rail,
  not one per panel family.
- **Acceptance criteria.** (a) A new panel cannot ship without one of the four primitives, proved by a
  fixture panel that **fails** the rail. (b) The rail prints its denominator (panels examined), so a
  shrinking numerator is visible. (c) No second implementation of any of the four exists, asserted by
  an import census.
- **Estimated complexity.** ~~M~~ → **S for the rail, M for adoption.** Ship the rail first: it is
  what makes adoption countable.
- **Parallelizable?** **Partial** — the rail is one lane; adoption collides with whatever else edits
  the same panels, so adoption is sequenced per panel family, not run three-wide.
- **Blocked by (IDs).** None.
- **ROLLBACK TIER.** `tier 4 pref / 3`.

#### TERM-020 · `FB-D2-01` — The canonical model and address book: **CP3, the resolver** ⚰️ RECUT
- **User outcome.** A figure a desk answer states has one address, one as-of and one set of inputs —
  so two surfaces quoting it cannot disagree without something failing.
- **Context.** ⚰️ **CP1 and CP2 ship.** `api/services/canonical/{address_book,dual_read,dual_sample_store,indicator_axis}.py`
  plus `api/data/canonical_address_book.json`; `address_book.py:1` is headed *"D2 CP2 — ⭐ THE FIRST
  PRODUCT READER OF THE CANONICAL ADDRESS BOOK"* and records that CP1's rail *"required that this file
  not exist"* and was **narrowed rather than deleted**, so *"a second reader still fails by name"*.
  CARD 12 records the D2 dual-compute warm reader *"FLIPPED ✅ RULED AND EXECUTED"*. ⛔ The file names
  the next checkpoint itself: *"NOT A RESOLVER. The five-status `resolve(address) -> Resolution` in
  SPEC-D2 §3 is CP3 and needs its own line."* **So the ticket is CP3.** ⭐ And its own first test is
  free and answerable today: *"pick the ten figures a desk answer most often states and confirm each
  has a stable id + as-of + inputs today."* **Schedule that test, not the system.**
- **Dependencies.** None. `b5` — `TERM-043`, `TERM-049`, `TERM-060` and two others wait on it, and
  `TERM-049` is *"blocked entirely"*.
- **Existing code to reuse.** All four canonical modules and the manifest, unchanged; and the narrowed
  CP1 rail, which must be **narrowed again by name** for CP3's reader rather than deleted.
- **Files/modules likely affected (with repository).** uct-dashboard:
  `api/services/canonical/` (additive), `api/data/canonical_address_book.json`,
  `tests/test_canonical_address_book.py` (the named-reader rail).
- **Data requirements.** A typed provenance record per stored value. **Licensing: CLEARED** for the
  ten figures, which come from feeds already held.
- **API work.** `resolve(address) -> Resolution` with **five statuses**, per SPEC-D2 §3. ⛔ No
  defaulting: `address_book.py`'s own rule is the acceptance criterion — *"`row_position()` returning
  `0` for an unknown metric would resolve every bad address to the OPEN price and every consumer
  would keep working, wrongly, forever. Every accessor returns `None` on any doubt."*
- **UI work.** None.
- **Testing.** A five-status boundary test; the second-reader rail must still fail by name; and a
  **negative** test that an unknown address returns a status and never a plausible value.
- **Observability.** Resolution status counts, so "we could not compute it" is distinguishable from
  "it is zero" — the `CoverageLine` distinction one layer down, in the file's own words.
- **Risks.** `RSK undet`. ⛔ The named failure is *a lookup that misses and returns something plausible
  anyway*. ⚠️ And *a second authority over one value*: CP3 must **derive** from the manifest, never
  restate it.
- **Acceptance criteria.** (a) The ten named figures each resolve with a stable id, an as-of and their
  inputs. (b) An unknown address returns a status, never a value — proved on a fixture seen red.
  (c) A third reader fails the narrowed rail **by name**.
- **Estimated complexity.** **XL** for the whole system; **M for CP3**, which is what this ticket is.
- **Parallelizable?** **Partial** — one lane, but it is the substrate five tickets key against, so a
  lane editing a consumer collides with it.
- **Blocked by (IDs).** None.
- **ROLLBACK TIER.** ⛔ **TIER-NONE** — shape: *creates or changes persistent state* (a typed
  provenance record per stored value). Item 37 names no tier for a store change. **Write the reversal
  plan in the same commit**; a dual-read window is available and already has a module.

#### TERM-021 · `FB-S5-01` — One versioned workspace document in its own store ⛔ must not be half-shipped
- **User outcome.** A member's board survives a parse failure, a template apply and a bad deploy —
  and a corrupt blob stops silently becoming an empty board.
- **Context.** Ledger **C7** is the only `needs-extension` row in the ledger: *"8 loosely-coupled pref
  keys, non-atomic template apply, localStorage watchlist columns"* on *"`auth.db user_preferences`
  (opaque TEXT, no cap, no DELETE route)"*, with ⛔ *"corrupt blob → empty board autosaved within
  500 ms; shape-sniffed migrations; `applyTemplate` = 6–7 writes + localStorage, no transaction."*
  ⭐ **Every ingredient exists elsewhere**: ledger B4 (`settingsVersion: 2`, read-time fold, tombstoned
  instance deletes, union-by-id merge), ledger G3 (append-only versions, AST-asserted no-UPDATE),
  ledger C4 (`charts_layouts.db`, *"the atomic-document shape the working state lacks"*). `b4`.
- **Dependencies.** None. It is a prerequisite of `TERM-037`, `TERM-038`, `TERM-051`, `TERM-076`.
- **Existing code to reuse.** All three idioms above. ⛔ Reuse, do not re-invent: item 16's recorded
  failure mode is *"anyone who ships step 1 and stops has left the board on a store whose own repo
  documents why it is wrong for this."*
- **Files/modules likely affected (with repository).** uct-dashboard: a new per-domain SQLite store
  (⭐ following the `bars.db`/`cot.db`/`entity_master.db` convention — **never a table added to
  `auth.db`**); the workspace read/write path; `api/main.py` startup init ⚠️ **high-conflict**.
- **Data requirements.** A migration plus ⛔ **a mandatory read-fallback shim**, because
  `GOVERNING_PRINCIPLES` §13 forbids renaming persisted preference or widget keys.
  **Licensing: CLEARED.**
- **API work.** A document read/write with atomic writes and tombstoned deletes; a DELETE route, which
  today does not exist.
- **UI work.** None visible if done correctly. ⛔ The version-stamp bridge ships **beside** the
  destination, never instead of it.
- **Testing.** Two assertions, **both of which currently fail**, so both must be seen red first.
- **Observability.** Parse-failure count, and a non-zero count must be visible rather than absorbed.
- **Risks.** **STATE-1 through STATE-6**, and ⛔ §2.5 of `anti-patterns.md` is the **only** family with
  zero working detectors (5 of 7 ⛔ NO, 2 🟡) — so this is the ticket where a known defect can be
  committed and nothing will say so. **STATE-2** is the live data-loss path. ⛔ And the half-ship **is**
  the named failure mode, which is why item 16 refuses to split it and this package refuses too.
- **Acceptance criteria.** (a) A corrupt blob does **not** autosave an empty board — a fixture that
  must be seen to fail without the fix. (b) A member can restore version N−1, which PROD-C4 names as
  the class's own detector: *"if a member can restore version N−1, the class is closed."*
  ⚠️ `OBS fixture-TBD`: both fixtures must be **built** as part of this ticket.
- **Estimated complexity.** **L.**
- **Parallelizable?** ⛔ **No.** It changes the store every board reads; a second lane touching the
  workspace path will conflict.
- **Blocked by (IDs).** None. ⭐ `TERM-083` (the restore rehearsal) is not a blocker but is the reason
  this store is worth having: *"a versioned document is worth little in an unbacked store."*
- **ROLLBACK TIER.** ⛔ **TIER-NONE** — shape: *creates or changes persistent state*, and member state
  at that. ⛔⛔ Its reversal must obey item 37 `:590`: **never a DELETE against member data.**
- **STATUS (2026-09-29) — BUILT, DARK. The read-new phase landed `ea93f1528` (owner ruling
  2026-09-29).** Everything is behind the SAME gate, `WORKSPACE_DOC_STORE_ENABLED`, read per request.
  What each piece does, armed vs off:

  | Piece | ARMED | OFF |
  |---|---|---|
  | **Read-new** (`workspace_doc_store.read_prefs`, hooked in `auth.py get_preferences`) | `GET /api/auth/preferences` reads the 13 board keys from the document head through the shim — same keys, same bytes. Absent / tombstoned / unreadable document → `user_preferences` as it is, **never a default**. Every response is stamped `X-Workspace-Doc` (`document; v=N` or `fallback; reason=…`). A key the two stores disagree about is decided by the append-only **write-back ledger** `workspace_writebacks`: covered by an outstanding write-back → the document (an interrupted apply/restore); anything else → `user_preferences` (a failed mirror or a write made while dark). Both are healed on the read. | Returns the same dict before any I/O; no header; no store file. Byte-identical to the pre-change handler (railed against it). |
  | **Mirror** (`mirror_pref`) | ONE atomic read-modify-write (head read inside the write transaction). ⚰️ It was read-then-CAS-retry-once and could drop a key under a burst of board writes. | Not reached. |
  | **One-write board change** (`POST /api/workspace/doc/apply`, `boardDocument.js`, `commitBoard` in `ChartsWorkspace.jsx`) | A template apply, New Layout and UCT Default are ONE compare-and-set document version (+ its `pending` ledger row, same transaction), then the same values into `user_preferences`, then a `done` row. A crash in between leaves the document complete and read-new serving it. **409 writes nothing, is never retried, never falls back to per-key writes** — the client re-reads and says so. The board switches only after the server has it; the autosave waits while an apply is in flight. | The same per-key `setPref` writes in the same order with the same values, synchronously (the dark tests were run green against the base `ChartsWorkspace.jsx` too). The client learns "armed" from the header on the preferences read it already makes — no probe, no 404. |
  | **`uct.watchlist.cols` fold** (board key `watchlist_columns`) | One-time migration read copies the localStorage columns into the document; later board saves keep the copy current; a new device is filled; a template apply / restore puts columns back. **The localStorage value is never removed or replaced by the fold.** | Nothing is read, written or folded. |

  Tests: `tests/test_workspace_doc_store.py` + `tests/test_workspace_doc_router.py` (flag-off byte parity,
  every fallback, one version per apply, a crash after 2 of 10 write-backs, 409, a disarm → dark write →
  re-arm), `app/src/pages/charts/boardDocument{,.workspace}.test.*`,
  `app/src/hooks/usePreferences.workspaceDoc.test.jsx`. Mutation-proved nine ways (three fallbacks to a
  silent default, three breaks of the single-write guarantee server-side, the armed path taking per-key
  writes, a 409 falling back to per-key writes, the fold overwriting local columns).

  **⛔ REMAINING BEFORE `WORKSPACE_DOC_STORE_ENABLED` CAN BE ARMED:**
  1. **`STORE_BACKUP_ENABLED` armed and one real `tools/store_restore --rehearse` PASS on the
     `workspace_docs` store** — an OWNER / PRODUCTION step (`TERM-083`). Not attempted from a worktree and
     not verifiable from one. ⭐ The rehearsal now restores a store with a fourth table,
     `workspace_writebacks`; the existing rehearsal rail reads it generically.
  2. **Ship this commit** (master deploy, member-impact paragraph: none while dark) and confirm in the
     running web process that `WORKSPACE_DOC_STORE_ENABLED` is unset and `GET /api/auth/preferences`
     carries no `X-Workspace-Doc` header.
  3. **Arm on `web` for the smoke account first**, then everyone: after the `--set`, verify a NEW BOOT and
     read the flag in-process; then read `X-Workspace-Doc` on the smoke account's preferences read, open a
     layout template on `/charts` and confirm ONE `POST /api/workspace/doc/apply` and zero per-key board
     writes, and open **Version history** (it appears only when armed).
  4. **Watch** `GET /api/workspace/doc/health`: `reads_this_process` (`unreadable`, `old_newer`,
     `doc_newer`, `heal_failed`), `hook_failures_this_process`, `parse_failures`,
     `writebacks_outstanding`. A non-zero `unreadable` or `heal_failed` is a finding, not noise.
  5. **Before any disarm:** `writebacks_outstanding` must read 0 (an outstanding write-back is a key only
     the document holds; that member's next armed read completes it).

  **Open, not blocking arming (stated, not hidden):**
  - A client that predates this commit still applies a template as per-key writes while armed. That is
    correct (each is mirrored atomically now), just not one write — it ages out with cached bundles.
  - A column edit made in the Watchlist widget is versioned at the next board save, not instantly (the
    widget writes localStorage directly and is not this change's to edit). A new device's filled columns
    show on the widget's next mount.
  - The completion of an interrupted write-back re-reads the head just before writing, but a board write
    whose `user_preferences` half landed and whose mirror had not, inside that same instant, can be
    overwritten in the old store. It needs an interrupted apply AND a concurrent write to the same key
    within one request's width (`_heal`'s docstring).
  - The phone / coarse-pointer tablet shell still has no Version history door (TERM-051's open item).

#### TERM-022 · `FB-D1-01` — The Massive adapter, and the retirement queue behind it
- **User outcome.** One boundary owns vendor access, so a vendor change is a swap and a licensing
  class is stamped on the response rather than remembered.
- **Context.** Twenty-plus modules build `api.massive.com` URLs themselves with no token bucket. `b4`.
  ⭐ `TERM-072` (`FB-A3-01`) is its **named first proof case**, so the pattern is cheaper to establish
  there and apply here — a sequencing fact the dependency column cannot express, because `TERM-072` is
  `d0` and not a prerequisite.
- **Dependencies.** None. `TERM-040`, `TERM-042`, `TERM-045`, `TERM-046` and `TERM-005` sit behind it.
- **Existing code to reuse.** The existing Massive call sites (as the migration's inventory), and
  `serve_stale`'s pattern for the serving half (`TERM-082`).
- **Files/modules likely affected (with repository).** uct-dashboard: one adapter under
  `api/services/`; 20+ call sites. ⚠️ **PARTNER**: `live_massive_router.py`, `massive_ws_worker.py`,
  `massive_processor.py` are partner-owned — the adapter must be adoptable **without** editing them,
  and any change inside them routes through the partner boundary with an acknowledgement first.
- **Data requirements.** A licensing-class stamp per response. **Licensing: CLEARED (existing estate,
  CARD 26)** for what is already accessed — ⚠️ and the stamp is precisely what makes CARD 26 §4's
  forward rule enforceable, since *"licensing is CLEARED for the current estate and OPEN for each new
  data source"*. ⛔ LIC-02 records Massive OPRA as the largest single **U** with unpublished
  Third-Party Agreements; the stamp records the class, it does not resolve it.
- **API work.** One adapter with one budget; no new member route.
- **UI work.** None.
- **Testing.** A behavioural-parity test per call-site family (the shape `TERM-072` proves first), plus
  a rail that a new module cannot construct a vendor URL directly.
- **Observability.** Budget denials and per-class call counts.
- **Risks.** `RSK undet`. ⛔ **DOC-2**: an adapter that retires nothing is a **second** authority —
  *"the retirement queue empties behind it"* is the ticket, not a nicety. ⚠️ A token bucket is a
  correctness guard, not a cache (STATE-7), so it must not be per-process if the bound is global.
- **Acceptance criteria.** (a) A new module cannot reach the vendor except through the adapter, proved
  by a rail with a control. (b) Every response carries a licensing class. (c) At least one legacy call
  site is **deleted**, not deprecated — a migration with nothing removed has not started.
- **Estimated complexity.** **L.**
- **Parallelizable?** **Partial** — the adapter is one lane; the migration collides with any lane in
  the same modules, and three of them are partner-owned.
- **Blocked by (IDs).** None.
- **ROLLBACK TIER.** ⛔ **TIER-NONE** — shape: *creates or changes persistent state* (the class stamp
  is written with the data). The adapter alone would be tier 3/4; the stamp is what has no tier.

#### TERM-023 · `FB-S3-01` — Entity master: a member resolution path, an adoption rail and a seed ⚰️ RECUT
- **User outcome.** A ticker that changed hands resolves to the right company for the right date, and
  a search finds an entity rather than a string.
- **Context.** ⚰️⚰️ **This is the largest recut in the file.** Item 16 records *"**Today. Absent.**"*
  and sizes it **L** as *"a new system with a schema other systems key against"*; best-of-breed calls
  the row *"the clearest infrastructure gap the research found"*. On `origin/master` it is
  **ADMIN-MOUNTED**: `api/services/entity_master/{schema,store,api,reconciliation}.py` plus
  `test_entity_master.py`, `test_reconciliation.py`, `test_adversarial_checkpoint8.py`; tables
  `entities`, `entity_aliases` (**dated** — `valid_from`/`valid_to` with `idx_alias_lookup`),
  `entity_vendor_symbols`, `entity_figi`, `entity_relations`, `entity_events`, `_migrations`;
  `store.alias_candidates_as_of()` — **the very function item 16's acceptance criterion describes**;
  `store.upsert_figi()` and `api.set_figi()`; `api/routers/entity_master_admin.py` included at
  `api/main.py:8834` under `/api/admin/entity-master/*`, reporting `figi_coverage_pct`,
  `ambiguous_count` and `last_seed_at`; and `scripts/entity_master_seed.py`. ⚠️ Item 15 §6.4 had
  already noticed the coordinates drifting (*"the finding is correct and the coordinates moved"*) —
  what nobody carried forward is that the finding is **no longer about absence**.
  ⛔ **Whether it is populated is unmeasured from here**, and that is item 15's fourth, independent
  fact — a store with rows and a store without are indistinguishable from this box.
- **Dependencies.** ⛔ One open technical question remains genuinely open and cheap: *"whether
  Massive/FMP responses already carry a `figi` field is unconfirmed — **a live API read would settle
  it**"*. ⭐ Item 17 calls that *"the cheapest unblock in the file"*. `entity_figi` and
  `reconciliation.py:166`/`:208` already read a `composite_figi` off a reference payload, which makes
  the question narrower than it was: the code path exists; whether the vendor fills it is unread.
- **Existing code to reuse.** ⭐ Everything above. ⛔⛔ **Do not write a schema.** This ticket's first
  act is `git show origin/master:api/services/entity_master/schema.py` and a row count from the admin
  status route, not a design.
- **Files/modules likely affected (with repository).** uct-dashboard: a member-reachable resolution
  route (new); the ticker-search path that currently reads `cap_universe.json`; `api/main.py` mount
  ⚠️ **high-conflict**; an adoption rail under `tests/`.
- **Data requirements.** A seed run, and the dated alias list populated. ⛔ **Licensing is structural
  here, not a preference**: CUSIP's terms prohibit maintaining a master file and no vendor publishes an
  entity master to license, so the identifier choice is a licensing decision routed through the
  register. **OpenFIGI is the free MIT-licensed external mapping** — ⚠️ **OPEN — new source** if it is
  called at runtime rather than seeded offline, per CARD 26 §4.
- **API work.** A resolution endpoint a member surface can call; `companyId` (or the local equivalent)
  on responses that currently key by bare ticker.
- **UI work.** Entity-aware search on the surfaces that have ticker-only search today.
- **Testing.** ⭐ Item 16's own criterion, and the shipped `alias_candidates_as_of` makes it writable
  today: a ticker that changed hands resolves to the **right entity for the right date**, proved on a
  **dated fixture** — *"the only version of this test that can fail for the right reason"*.
- **Observability.** The admin route already publishes `figi_coverage_pct` and `ambiguous_count`.
  ⭐ Publish the **denominator** beside them (the `TERM-026` discipline).
- **Risks.** **DOC-1** — an alias list is a roster and must be dated and generated, never typed
  (it already is). ⚠️ The ledger cell that started this: A8 records `cap_universe.json (3,742)` while
  `len(json.loads(...))` over `api/data/cap_universe.json` at `origin/master` returns **3,640**, and
  D-13 measured the wire payload's key at **3,721** — ⛔ **three values, and the current file holds the
  smallest.** Any migration off `cap_universe` must re-measure rather than carry a number.
- **Acceptance criteria.** (a) A paid member can reach a resolution route — asserted by the route's
  dependency, not by its existence. (b) The dated-fixture test above passes and was seen red on the
  pre-change path. (c) No response on the adopted surfaces is keyed by a bare ticker, proved by a rail
  with a control. (d) The seed's row count is **printed**, never typed.
- **Estimated complexity.** ~~L~~ → **M.** The system exists; this is a member path, a seed and a rail.
- **Parallelizable?** **Partial** — the service is untouched, so the member path is one lane; the
  search-path adoption collides with `TERM-058` and `TERM-063`.
- **Blocked by (IDs).** None. ⛔ `ACT:` one live API read to settle `figi` availability — cheap, and
  not something this programme may perform against production.
- **ROLLBACK TIER.** ⛔ **TIER-NONE** — shape: *creates or changes persistent state* (the seed writes
  `entity_master.db`). ⚠️ The **member route** alone is tier 3/4; the seed is what has no tier, so the
  two halves have different reversals and the package says so rather than averaging them.

#### TERM-024 · `FB-S4-02` — A panel declares a need; it never owns a transport, a budget or a freshness opinion
- **User outcome.** None directly today. ⭐ It is the interface decision that forecloses three classes
  of failure, and it is cheap **only now**.
- **Context.** ARCH-07 §5.2: *"A panel declares a need; it never owns a transport, a budget, or a
  freshness opinion… **This is one interface decision that forecloses three whole classes of failure,
  and it is cheap only before N panels exist.**"* Measured basis: the client pools already collapse N
  panels to ~2 connections (*"16 cells, one SSE"*), and `STREAM_MAX_SUBSCRIBERS = 300` is a
  **per-process** budget — *"a panel-owned stream turns it into 300/N users."* ARCH-07 §3 Q6 adds the
  required field: *"Both behaviours are right; the defect is that the distinction lives in a
  comment"* — last-value-wins (`bar_broadcaster`, `maxsize=64`, drop-oldest) versus
  every-message-matters (the OPRA tape, because *"Massive OPRA does not replay and a dropped message
  is a permanent gap"*).
- **Dependencies.** None. It is a precondition of `TERM-037`.
- **Existing code to reuse.** Ledger A2 (one browser-wide price SSE pool, 50 tickers/conn), A5 (the
  bars push pool, byte-separate by design), F1 (the tape's tailer SSE). ⭐ *"The pools are right; the
  contract is unwritten."*
- **Files/modules likely affected (with repository).** uct-dashboard: one panel-contract module under
  `app/src/`; the three pool entry points (read-only); one AST or type-level rail.
- **Data requirements.** None. **Licensing: CLEARED.**
- **API work.** None — it is a client-side contract over shipped transports.
- **UI work.** None visible.
- **Testing.** A new panel **cannot obtain a URL, only a handle**, railed at the type level or by an
  AST check; and the delivery-semantics field has **no default**, so a panel author must state it.
- **Observability.** Per-need subscription counts, which is what makes `STREAM_MAX_SUBSCRIBERS`
  legible before it bites.
- **Risks.** `RSK undet` — both **STATE-7** and **PERF-6** lack detectors. ⚠️ STATE-7 is the framing
  to preserve: per-process hubs and budgets are **correctness guards, not caches**. ⛔ And the real
  risk is doing it later: **S** today, **L** as a retrofit.
- **Acceptance criteria.** (a) A fixture panel that requests a URL fails the rail **by name**, with a
  control. (b) A fixture panel omitting delivery semantics fails to compile or fails the rail — no
  default is permitted.
- **Estimated complexity.** **S** as an interface decision taken now; **L** as a retrofit later.
  ⭐ That asymmetry is the ticket's entire argument.
- **Parallelizable?** **Yes.**
- **Blocked by (IDs).** None.
- **ROLLBACK TIER.** `tier 4 pref / 3`.

#### TERM-025 · `FB-S7-01` — The remaining seven trigger types, authorized one at a time
- **User outcome.** A member can watch the conditions they actually care about, not the one condition
  that happens to be built.
- **Context.** One of eight trigger types is built; the other seven are extensions of a real
  foundation, and each needs the same two gates. ⭐ CARD 10 has already sequenced the next one:
  `catalyst-match` — *"58 predicates, 58 verdict-ready, 80 agreed, zero `new_only` / `legacy_only` /
  `not_comparable`"*. `b2`.
- **Dependencies.** None. `TERM-048` and `TERM-062` sit behind it.
- **Existing code to reuse.** The shipped trigger registry and the shipped type's two gates — ⭐ the
  whole point is that these are **extensions of a real foundation**, so a new type that does not use
  the registry is the defect.
- **Files/modules likely affected (with repository).** uct-dashboard:
  `api/services/alert_taxonomy/` (the registry and one new predicate per type), the authoring surface.
  ⛔ **The durable alert record is `alert_fires`, never `user_alerts`** — a long-standing rule in this
  estate and the most likely place a new type goes wrong.
- **Data requirements.** Per-type predicate inputs, all from feeds already held.
  **Licensing: CLEARED.** ⚠️ Any type needing a feed we do not hold is **OPEN — new source** and must
  say so before it is scheduled.
- **API work.** One predicate + one registry entry per type.
- **UI work.** One authoring control per type.
- **Testing.** The same two gates as the shipped type, per type — and CARD 11's discipline binds the
  reporting: *"n is reported as n, always."*
- **Observability.** Fire counts per type, with `TERM-062`'s cooldown publication behind it.
- **Risks.** ⛔ `OBS rehearsal`: the two ungated gates must be **seen to fire**, not asserted to
  exist. ⚠️ CARD 9's price-level predicate is **still the owner's** and delegation does not move it —
  so the seven are not interchangeable and one of them is not an agent's to build.
- **Acceptance criteria.** Per type: (a) both gates fire on a fixture, observed red first; (b) the
  predicate is registered, not hard-coded, proved by the registry rail; (c) a fire writes
  `alert_fires`; (d) the parity run reports `n` as `n`.
- **Estimated complexity.** **M per type**, and they are genuinely independent.
- **Parallelizable?** **Yes** — different types are different lanes, which is rare in this backlog.
- **Blocked by (IDs).** None. ⛔ `ACT:` per-type authorization; CARD 9's type is owner-held.
- **ROLLBACK TIER.** `tier 4 pref / 3`. ⚠️ Per type: a type whose fires are member-visible has
  published something a deploy cannot un-send, which is the `TIER-NONE` second shape — flagged per
  type rather than collapsed here.

#### TERM-026 · `FB-S9-01` — Make the auth-surface auditor see a GET, and publish its denominator
- **User outcome.** The instrument that says the auth surface is fine stops being blind to the half a
  terminal lives in.
- **Context.** The one instrument auditing the auth surface **iterates mutating methods only**, so it
  is reassuring in exactly the region a read-heavy terminal occupies. `anti-patterns.md` calls
  **GATE-7** *"the sharpest 'no detector' in the library"*: the instrument is structurally blind to the
  class it covers. ⭐ Item 17: *"a set literal, a loop, and a printed denominator."* `b2`.
- **Dependencies.** None. `TERM-053` and `TERM-061` sit behind it.
- **Existing code to reuse.** The existing auditor, unchanged in structure.
- **Files/modules likely affected (with repository).** uct-dashboard: the auditor tool under `tools/`.
- **Data requirements.** None. **Licensing: CLEARED.**
- **API work.** None. **UI work.** None.
- **Testing.** A fixture GET route with no auth dependency must be **found** — seen red before the
  change, since today it cannot be.
- **Observability.** ⭐ **The denominator is the deliverable as much as the aperture**: a count with no
  denominator cannot distinguish "nothing wrong" from "nothing examined".
- **Risks.** `RSK undet` (GATE-7 has no detector). ⛔ Its blocker is **ownership, not evidence** —
  item 23's DP-6 already rules the widening *"Engineering — no owner input needed… it is additive and
  fails closed."*
- **Acceptance criteria.** (a) A fixture unauthenticated GET is reported, seen red first.
  (b) The tool prints `examined/total` and the total is derived from the route table, not typed.
  (c) The tool exits non-zero on a finding, so it can gate.
- **Estimated complexity.** **S.**
- **Parallelizable?** **Yes.**
- **Blocked by (IDs).** None.
- **ROLLBACK TIER.** `tier 4 pref / 3`.

### 4.3 Band 3 — cheap and clear. Everything a conventional matrix would have found, and only this.

⭐ **This is H1's residue**: 29 items were `S` and `d0`; these ten survive all five of item 17's
band-3 clauses. Every one is one surface or one constant, reversible on a deploy, with an observable
computable with what exists, and none walks into an anti-pattern nothing can detect. ⛔ Within the band
the order is not asserted.

#### TERM-027 · `FB-S1-01` — Bring the panel header inside the per-widget error boundary
- **User outcome.** A header-side throw takes down one panel instead of the board.
- **Context.** ⚰️ The boundary itself is **not** the gap: item 16 §2.4 ⚰️3 corrected that against
  shipped code, and `origin/master` confirms — `app/src/pages/charts/WidgetHost.jsx:25` imports
  `ErrorBoundary`, `:107` opens it and `:111` closes it around `WidgetBody`, whose render site is now
  `:270`. ⚠️ Item 16 cited the header at `:227`/`:254`; the file has moved since, so **read the file,
  do not trust the coordinates** — the residual gap is that the header renders **outside and before**
  the boundary, and that is what this ticket closes. `PANEL_MOUNT_CAP = 3` exists at
  `ChartsWorkspace.jsx:84` and bounds **mounts, not board size** — that bound is `TERM-001`.
- **Dependencies.** None. **Existing code to reuse.** The shipped `ErrorBoundary` and
  `WidgetErrorFallback`; ⛔ no new component.
- **Files/modules likely affected (with repository).** uct-dashboard:
  `app/src/pages/charts/WidgetHost.jsx`, `app/src/pages/charts/WidgetHost.test.jsx`.
- **Data requirements.** None. **Licensing: CLEARED.**
- **API work.** None. **UI work.** A JSX move so the header is inside the boundary, with the fallback
  still rendering a header (a panel that loses its header on error is a worse failure).
- **Testing.** A fixture panel whose **header** throws leaves sibling panels mounted — seen red first.
- **Observability.** Boundary-catch count per panel type, if `TERM-019`'s adoption lands beside it.
- **Risks.** `RSK partial`. ⚠️ Moving the header inside changes what remounts on error; assert the
  fallback still identifies **which** panel failed by type.
- **Acceptance criteria.** (a) The header-throw fixture is red before, green after. (b) Siblings stay
  mounted, asserted by count. (c) The fallback names the panel type.
- **Estimated complexity.** **S** — a JSX move plus one test.
- **Parallelizable?** **Yes.** **Blocked by (IDs).** None.
- **ROLLBACK TIER.** `tier 4 pref / 3`.

#### TERM-028 · `FB-A1-01` — An honest blank for futures instead of an Unsuitable source
- **User outcome.** The futures strip says why it has no number instead of showing one that cannot be
  trusted.
- **Context.** `GAP unclos` applies to the **licensed-feed half only** — yfinance is X-class with
  *"no purchasable remedy"* (LIC-08). ⛔ The purchase is not this ticket and not an engineering item:
  it is one of only three places the capability matrix §6 says a genuinely new vendor is worth
  evaluating.
- **Dependencies.** None. **Existing code to reuse.** The provenance primitives (`TERM-019`) for the
  stated-absence render; ⛔ do not invent a second "no data" idiom.
- **Files/modules likely affected (with repository).** uct-dashboard: the futures strip component and
  its data hook.
- **Data requirements.** None new. **Licensing: CLEARED** for what is displayed; ⚠️ **OPEN — new
  source** for the licensed-feed half, which this ticket does not attempt.
- **API work.** None. **UI work.** One render path plus one sentence naming the reason.
- **Testing.** With the X-class source unavailable, the strip renders the reason and **never a number**
  — asserted on the rendered text.
- **Observability.** A count of honest-blank renders, so "we never show futures" is visible.
- **Risks.** `RSK partial`. ⛔ **INST-2** (a proxy instrument) is exactly what the current state is.
- **Acceptance criteria.** (a) No number is rendered from the X-class source, proved by a rail on the
  component's imports. (b) The reason text is present and names the source class.
- **Estimated complexity.** **S.** **Parallelizable?** **Yes.** **Blocked by (IDs).** None.
- **ROLLBACK TIER.** `tier 4 pref / 3`.

#### TERM-029 · `FB-A10-01` — The GEX assumption label, at the number
- **User outcome.** A member reading a GEX figure can see the assumption it rests on without leaving
  the number.
- **Context.** ⚰️ Item 16 records that CARD 17 killed **half of this ticket's own source sentence** —
  best-of-breed §6.1's *"and make removing it the upgrade"* — because there is no tier to upgrade to.
  ⭐ The label survives on the honesty argument alone, which is the stronger one. ⚠️ Related:
  `project_optionsflow_gex_crosshair_lag` is CLOSED with no GEX-specific lag measurable; this ticket is
  a **label**, and must not become a sixth speculative performance fix.
- **Dependencies.** None. **Existing code to reuse.** `Provenance.jsx` / `Cited.jsx`.
- **Files/modules likely affected (with repository).** uct-dashboard: the GEX surface's render path.
  ⚠️ **PARTNER adjacency** — if the label requires a value from `OptionsFlow.jsx`, acknowledge first.
- **Data requirements.** None new. **Licensing: CLEARED.**
- **API work.** None. **UI work.** A tooltip plus a copy decision.
- **Testing.** The label renders beside the number, and the number's absence renders the label's
  absence rather than an orphan tooltip.
- **Observability.** None new.
- **Risks.** `RSK partial`. ⛔ No tier-comparison surface, ever (CARD 17) — the label states an
  assumption and never a limit that a higher tier would remove.
- **Acceptance criteria.** (a) The assumption text renders at the number on the GEX surface.
  (b) No upgrade affordance, pricing table or locked state is introduced — asserted by a text rail on
  the diff.
- **Estimated complexity.** **S.** **Parallelizable?** **Yes.** **Blocked by (IDs).** None.
- **ROLLBACK TIER.** `tier 4 pref / 3`.

#### TERM-030 · `FB-A5-02` — Schema assertion on the five server-side `/api/calendar` readers
- **User outcome.** A change to the week contract fails loudly at the reader instead of rendering an
  empty week.
- **Context.** Five server-side consumers read the week contract with bare `.get()` chains and no
  schema assertion. ⭐ Item 17 calls it *"the cheapest item in this family on every axis"* and a
  **precondition for any Terminal-Next panel that consumes the week contract**.
- **Dependencies.** None. **Existing code to reuse.** Whatever schema idiom already exists in `api/`;
  ⛔ one shared assertion, not five local ones (*a guard repeated is a guard unproved*).
- **Files/modules likely affected (with repository).** uct-dashboard: `api/routers/calendar.py` and the
  five reader modules.
- **Data requirements.** None. **Licensing: CLEARED.**
- **API work.** One schema + five call sites. **UI work.** None.
- **Testing.** A malformed week payload makes each reader fail **by name** — one fixture, five
  assertions, seen red first.
- **Observability.** Assertion-failure count, routed by `TERM-011`.
- **Risks.** `RSK partial`. ⚠️ ⛔ Never rename the persisted `calendar` plumbing keys: the route, door
  key, widget keys and `/api/calendar/*` are unchanged by the 2026-09-01 **display-only** rename, and a
  persisted-pref rename needs a read-fallback shim first.
- **Acceptance criteria.** (a) Each of the five fails loudly on a malformed payload. (b) The count of
  readers is **derived** from imports, not typed, so a sixth reader is caught.
- **Estimated complexity.** **S.** **Parallelizable?** **Yes.** **Blocked by (IDs).** None.
- **ROLLBACK TIER.** `tier 4 pref / 3`.

#### TERM-031 · `FB-A5-03` — Derive the Fed-speaker list instead of hand-typing it
- **User outcome.** A Fed speaker stops being dropped from the economic calendar because a surname is
  missing from a typed list.
- **Context.** The curation drops a speaker on a typed-list miss. ⛔ This is **DOC-1**, the defect this
  programme ranks first, in its purest form.
- **Dependencies.** None. **Existing code to reuse.** The economic-calendar curation path.
- **Files/modules likely affected (with repository).** uct-dashboard: the curation module and its data
  file.
- **Data requirements.** Either a derivation from an already-held source, or **a dated data file with a
  horizon check**. ⛔ If the derivation needs a source we do not hold, it is ⚠️ **OPEN — new source**
  and the dated-file option is the one to ship. **Licensing: CLEARED** for the dated-file option.
- **API work.** None member-facing. **UI work.** None.
- **Testing.** ⭐ A **horizon rail**: the test fails when the list's coverage falls below a stated
  number of months — because a correct roster and an expired one look identical on any single day.
  Plus a fixture speaker absent from the list must still be surfaced.
- **Observability.** Dropped-speaker count, which is currently zero-by-construction.
- **Risks.** **DOC-1**, `RSK detected`. ⚠️ *A symbol universe does not settle a match*: surnames
  collide, so the rail must assert the match rule, not just the list's presence.
- **Acceptance criteria.** (a) The horizon rail fails on an expired list. (b) A speaker absent from the
  typed list is surfaced. (c) The list carries its as-of.
- **Estimated complexity.** **S.** **Parallelizable?** **Yes.** **Blocked by (IDs).** None.
- **ROLLBACK TIER.** `tier 4 pref / 3`.

#### TERM-032 · `FB-A6-01` — Say "coverage n=0" instead of rendering an empty transcript panel
- **User outcome.** A member can tell "we hold nothing for this name" from "something broke".
- **Context.** A6 is best-of-breed §6.2's *"harshest row in the file"* — coverage **measured n=0** —
  **and** the receipt is §6.1's prescribed mechanism, which is why `GAP` reads `close/lg` legitimately.
  ⛔ Its stated precondition is a **measurement, not a build**: confirm RG-15 first.
- **Dependencies.** None. **Existing code to reuse.** ⭐ `CoverageLine.jsx` — it already ships
  (`TERM-019`'s recut), so this is adoption, not a component.
- **Files/modules likely affected (with repository).** uct-dashboard: the transcript panel's render
  path; `app/src/components/provenance/CoverageLine.jsx` (import only).
- **Data requirements.** The coverage count, already computable. **Licensing: CLEARED.** ⚠️ Note for
  `TERM-044`: FMP transcript **storage** is U-class and *"a rights gap does not yield to
  engineering"* — this ticket displays a count and stores nothing.
- **API work.** A count on the response if absent. **UI work.** One `CoverageLine` adoption.
- **Testing.** With coverage 0, the panel renders the words and **not** an empty frame — asserted on
  text, seen red first.
- **Observability.** `n=0` render count per ticker family.
- **Risks.** `RSK partial`. ⛔ **`withheld` goes beside the counts and never inside them**
  (`TERM-047`'s rule, which this adoption must not pre-empt).
- **Acceptance criteria.** (a) RG-15 confirmed and **recorded** before the build. (b) The zero-coverage
  fixture renders the stated absence. (c) No second "no data" idiom is introduced.
- **Estimated complexity.** **S** for the receipt. **Parallelizable?** **Yes.**
- **Blocked by (IDs).** None; ⛔ `ACT:` confirm RG-15 (a measurement).
- **ROLLBACK TIER.** `tier 4 pref / 3`.

#### TERM-033 · `FB-A8-02` — Migrate the sibling `.catch(() => null)` fetchers onto `sectionFetch.js` ⚰️ RECUT
- **User outcome.** A retrieval failure stops rendering as "we hold nothing" — the one item in the
  backlog with a **measured member-facing cost already paid**.
- **Context.** The incident is the argument: the idiom rendered *"No recent news for this ticker."*
  against **NVDA** while the endpoint returned **15 KB**. ⚰️ **Two recuts, both from `origin/master`.**
  (a) Item 16 says *"six known sites"*; inside `sectionFetch.js`'s own directory
  (`app/src/components/research/sections/`) the un-migrated occurrences are **3**, in
  `SetupSection.jsx`, `StatementPanels.jsx` and `paidFetcher.js` — `git grep -c "\.catch(() => null)"
  origin/master -- 'app/src/components/research/sections/'` prints one per file and the other two hits
  are the helper and its own test. **So the migration is partly done and the named scope is smaller
  than six.** (b) ⛔ But the **population is far larger**:
  `git grep -l "\.catch(() => null)" origin/master -- app/src/ | wc -l` → **79 files**. The six was a
  family, not a census, and F-01's detector field says outright that **nothing detects the remaining
  sites** — which is the half that makes this a rail ticket and not three edits.
- **Dependencies.** None. **Existing code to reuse.** ⭐ `app/src/components/research/sections/sectionFetch.js`,
  already shipped with its own test.
- **Files/modules likely affected (with repository).** uct-dashboard: the three named files; one rail
  under `app/src/**/*.test.js*`; ⚠️ the 79-file population is **named, not migrated here** — a census
  ticket, which this package recommends and does not absorb.
- **Data requirements.** None. **Licensing: CLEARED.**
- **API work.** None. **UI work.** None visible on the happy path.
- **Testing.** A failing fetch renders an error state, not an empty result — the **NVDA shape**,
  asserted on text, seen red first on each migrated site.
- **Observability.** Retrieval-failure count, distinct from empty-result count. ⭐ That distinction is
  the entire ticket.
- **Risks.** `RSK partial`. ⛔ *A swallowed error becomes a confident finding* — and this is the
  measured instance of it. ⚠️ **A saturated instrument reports zero**: an empty result and a dropped
  error must not share a code path after this.
- **Acceptance criteria.** (a) All three named sites route through `sectionFetch.js`, asserted by an
  import rail with a control. (b) A fixture retrieval failure renders an error and not "we hold
  nothing". (c) ⭐ The rail **prints the 79-file population as its denominator**, so the next reader
  sees the real size instead of inheriting "six".
- **Estimated complexity.** **S** for the three sites; **the census is separate.**
- **Parallelizable?** **Yes.** **Blocked by (IDs).** None.
- **ROLLBACK TIER.** `tier 4 pref / 3`.

#### TERM-034 · `FB-I1-03` — The I1 spec, railed rather than written
- **User outcome.** None directly. It is the four clauses that stop the AI layer drifting, expressed
  as checks a build can fail.
- **Context.** Four clauses — the tool-registry contract, the grounding rule, the refusal shape, the S8
  boundary — **each with a check, not a paragraph**. ⛔ Item 16 is explicit: written as a document alone
  it **is PROD-6 by construction** — *"The fix was a paragraph in an architecture document. A paragraph
  cannot fail, so it is not a boundary."*
- **Dependencies.** None. ⭐ Read its band as **M**, not S: `S` is the document and `M` is the four
  checks, and only the checks are the deliverable.
- **Existing code to reuse.** ⭐ `i1S8Boundary.test.js` — AST-derived forbidden vocabulary, already
  shipped. **Extend its roots; do not rewrite the section.**
- **Files/modules likely affected (with repository).** uct-dashboard: `i1S8Boundary.test.js` and three
  sibling rails; the AI door modules (read-only, for the AST roots).
- **Data requirements.** None. **Licensing: CLEARED.** ⚠️ Standing constraint to **preserve, not fix**:
  member-facing AI traffic is barred from the owner's subscription seat (`GOVERNING_PRINCIPLES` §12);
  ledger K11 records that as CONFIRMED at code level.
- **API work.** None. **UI work.** None.
- **Testing.** It **is** the testing ticket: four rails, each with a **non-vacuity control**, each seen
  red before green. ⛔ Never three copies of one rail.
- **Observability.** Rail pass/fail with denominators.
- **Risks.** `RSK detected`. ⛔ **GATE-6** — *a rule stated in a document that no check enforces* — is
  the failure this ticket exists to avoid committing.
- **Acceptance criteria.** Four rails exist; each fails on a deliberately non-conforming fixture; each
  prints its denominator. ⛔ **The document alone does not close this ticket.**
- **Estimated complexity.** **M** (as four checks). **Parallelizable?** **Yes.**
- **Blocked by (IDs).** None.
- **ROLLBACK TIER.** `tier 4 pref / 3`.

#### TERM-035 · `FB-S11-01` — The market clock as code, with a horizon rail ⚰️ RECUT
- ✅ **BUILT `20cbef927` (2026-09-28).** ⭐ Since follow-up #1 (same day) the client clock and the
  backend `YYYYMMDD` sets both read it; see (c).
  - **What exists:**
    - One versioned dataset, `app/src/lib/marketClock/market_calendar.json` (v`2026-09-28.1`,
      coverage 2025-01-01 to **horizon 2028-12-31**).
    - The same functions on both sides, reading those bytes: `session_at` / `is_trading_day` /
      `close_time` / `horizon` in `api/services/session_calendar.py`, and the same four in
      `app/src/lib/marketClock/sessionCalendar.js`.
    - Boundaries: pre-market from 04:00; RTH 09:30 to 16:00, or to 13:00 on a half-day; post-market
      to 20:00 on every trading day. The half-day post-market end follows `marketClock.js` and
      `voice_temporal_awareness`.
  - **Where the dates come from:** `pandas_market_calendars` 5.4.0 and `exchange_calendars` 4.13.2,
    which agree on every date for 2025 to 2029. The rows are also railed equal to
    `nyse_calendar.py` (2025 to 2027) and `nyseCalendar.js` (2026 and 2027).
  - **(a) Horizon rail, met.** `MIN_HORIZON_MONTHS = 12`.
    - An injected-"today" control goes red.
    - Shrinking the horizon to 2027-08-28 turns the real rail red.
    - At the current horizon it first goes red on 2028-01-01.
  - **(b) Half-day parity between client and server, met.**
    - `tests/fixtures/market_calendar_cases.json` holds 67 session rows and 19 day rows (half-days,
      holidays and both DST edges for 2026, 2027 and 2028). Both pytest and vitest read it.
    - Every half-day in the dataset must have a row in it.
    - Removing the 2026-11-27 half-day fails 6 tests on each side.
    - Removing DST handling fails 19 on each side.
  - **(c) Migration: follow-up #1 ✅ DONE (2026-09-28).** `useMarketOpen` / `sessionModel.js` were
    deliberately not moved; the single migration point was `nyseCalendar.js`, one layer down, and
    it is now migrated:
    - `app/src/lib/marketClock/nyseCalendar.js` derives `COVERED_YEARS` (now 2025-2028) and every
      per-year table from `sessionCalendar.js`, with its exported names and shapes unchanged. Every
      client clock reader (`marketClock.js`, `useMarketOpen`, `sessionModel`/`nextOpenHint`,
      `sessionStale`, `FreshnessBadge`, `freshnessAge`, `extSession`, `marketSession`) now answers
      from the dataset. `sessionCalendar.js`'s `AWAITING_A_DECISION` entry and its
      `PARKING_EXPIRES` row are removed from `reachable.test.js`.
    - `api/services/nyse_calendar.py` derives `NYSE_HOLIDAYS_YYYYMMDD` / `NYSE_EARLY_CLOSES_YYYYMMDD`
      from `session_calendar.calendar()`, so `bars_fetch`, `liveflow_monitor` and every other
      reader of those sets gain 2028, and `GET /api/market-calendar`'s `covers_through` reads
      `2028-12-31` with no router change. 2025-2027 are byte-for-byte the previous sets.
    - `tests/test_nyse_calendar_parity.py` was rewritten from "regex-parse the JS literals" to "both
      load the same JSON", plus the backend answering the shared fixture.
    - Details: `evidence/2026-09-29-term035-calendar-census/results.md`, section "Follow-up #1".
  - **Disagreement found:** `tools/full_chart_diagnostic.py` is missing the 2025-01-09 closure and
    uses a fixed EDT offset.
  - **Census, results and the per-module follow-up list:**
    `evidence/2026-09-29-term035-calendar-census/results.md`.
  - Tests: `108 passed` (pytest) and `95 passed` (vitest).
- **User outcome.** Every panel and every AI answer agrees on what session it is, and an expired
  calendar fails a test instead of quietly answering wrongly.
- **Context.** ⚰️ **Not greenfield — a consolidation.** Item 16 sizes it **S** (*"the dataset is small
  and the API is three functions"*) and item 17 calls it *"the cheapest genuinely-new **system** in the
  file"*, with best-of-breed grading the row ◻ *not established for any product*. On `origin/master`
  the pre/RTH/post/closed boundary already ships **client-side in several places**:
  `app/src/components/tiles/MarketClock.jsx` (whose own header says *"Reuses the shared session logic
  from useMarketOpen + dashboard/sessionModel so every surface that names the session agrees
  (ChartMarketClock uses the same)"*), `app/src/components/dashboard/sessionModel.js`,
  `app/src/hooks/useMarketOpen`, and `app/src/components/provenance/sessionStale.js`;
  `git grep -ln "useMarketOpen\|sessionModel" origin/master -- app/src/ | wc -l` → **37 files**. And
  holiday/half-day handling is **scattered server-side**:
  `git grep -iln "half_day\|halfDay\|market_holiday\|HOLIDAYS" origin/master -- api/ app/src/ | wc -l`
  → **69 files**. ⛔ **So the absent thing is not a clock — it is ONE authority and a horizon rail.**
  That reframes the risk from "build a system" to **DOC-2, a second authority over one value**, which
  is a defect already live across 69 files.
- **Dependencies.** None. **Existing code to reuse.** ⭐ `sessionModel.js` + `useMarketOpen` as the
  client authority to consolidate **onto**, not around.
- **Files/modules likely affected (with repository).** uct-dashboard: one versioned session-calendar
  module (dataset + three functions); `sessionModel.js`; the server-side holiday users, migrated **per
  module, not in one sweep** (69 files is not one ticket).
- **Data requirements.** A small versioned dataset: sessions, half-days, holidays, with an explicit
  **horizon** (the last date it covers). **Licensing: CLEARED** — exchange session dates are not a
  licensed feed. ⚠️ If a vendor calendar is used instead, that is **OPEN — new source**.
- **API work.** Three functions, plus injection of the session as a **grounded fact** into AI answers.
- **UI work.** None new; existing clocks read the new authority.
- **Testing.** ⭐ The only test that can catch the real failure: **a rail that fails when the dataset's
  horizon falls below a stated number of months** — *because a correct calendar and an expired one look
  identical on any single day.* Plus a half-day fixture, which is where a scattered implementation
  disagrees with itself.
- **Observability.** The horizon, published, so its shrinking is visible before it expires.
- **Risks.** **DOC-2** (a second authority) and `RSK partial`. ⛔ Consolidating 69 files in one change
  is the aggregate-resource anti-pattern in code form; migrate per module with a parity assertion.
- **Acceptance criteria.** (a) The horizon rail fails on a dataset expiring inside the stated window,
  seen red first. (b) A half-day resolves identically on the client and the server, proved by a shared
  fixture. (c) Every migrated module **derives** from the authority; none restates it.
- **Estimated complexity.** **S** for the authority + rail; ⚠️ the 69-file consolidation is **M–L** and
  is explicitly **not** in this ticket.
- **Parallelizable?** **Yes** for the authority. **Blocked by (IDs).** None.
- **ROLLBACK TIER.** `tier 4 pref / 3`.

#### TERM-036 · `FB-D5-02` — Route dividends and splits off yfinance onto Massive reference
- **User outcome.** Corporate-action values stop coming from a source with **no purchasable remedy at
  any price**.
- **Context.** Two modules still call yfinance for splits and dividends while *"the one Massive class
  already licensed for external publication sits unused for it"*. `E3 meas`, `GAP unclos`,
  `RSK detected`.
- **Dependencies.** None. ⭐ It is one of the few tickets whose target source is the **least**
  licensing-exposed class in the Massive relationship.
- **Existing code to reuse.** The Massive reference client (and `TERM-022`'s adapter once it exists —
  ⛔ but this ticket must not wait for it; two modules is not a migration).
- **Files/modules likely affected (with repository).** uct-dashboard: the two yfinance-calling modules.
- **Data requirements.** Massive reference splits/dividends. **Licensing: CLEARED** — ⭐ and this is the
  narrow case where the *target* is better licensed than the source: D-004 records yfinance as an
  explicit **risk acceptance**, not a licence (*"Yahoo sells no licence, so there is no document to
  obtain"* — CARD 26 §3, owner-confirmed). ⛔ Nobody should file a task to "go get the Yahoo licence."
- **API work.** Two call-site swaps. **UI work.** None.
- **Testing.** A parity comparison on a known split and a known dividend, over a named ticker set, run
  **before** the swap — and it must be allowed to disagree, because agreement between two computations
  sharing an input is not corroboration (**INST-7**).
- **Observability.** Source name on the value (via `TERM-019`).
- **Risks.** `RSK detected`. ⚠️ **CARD 5 bounds the neighbourhood**: a corporate-actions **ledger** is
  ruled *not built* — *"a table with no consumer is a second authority waiting to drift"* — so this
  ticket swaps a source and creates **no ledger**. ⛔ `robots.txt`/terms exposure on the retired source
  is not resolved by deleting the call; LIC-08 stays as recorded.
- **Acceptance criteria.** (a) Neither module imports yfinance for splits or dividends, proved by an
  import rail. (b) The parity comparison ran and its disagreements are **recorded**, not silently
  resolved. (c) No new table.
- **Estimated complexity.** **S** — two modules, one already-licensed source.
- **Parallelizable?** **Yes.** **Blocked by (IDs).** None.
- **ROLLBACK TIER.** `tier 4 pref / 3`.

---

## 5. ⭐⭐ The eight tickets no feature backlog contains

⛔ **Why these are here and not in item 16.** Item 16 was built from four seams — a capability spine,
a best-of-breed comparison, three measurement artefacts, and an anti-pattern veto. **An asset with no
surface appears in none of them**, because the spine's unit is a capability (surface + user + gate +
route) and *"a store with no surface has no home in that taxonomy at all"* (item 15 `:642–:648`). And
a break-out is a property of a **workflow**, which item 16 never read. So these eight are not items 16
missed by carelessness; they are items its construction could not produce.

⚠️ **All eight were grepped against `origin/master` before being written**, and the grep changed two of
them and deleted a ninth (§8).

#### TERM-086 · item 14 `WF-B06` — Inbound alert receiver: turn TradingView into an upstream sensor
- **User outcome.** A member authors a condition where they already author conditions and **receives it
  in our product**, so the tab they keep open for alerts becomes a sensor feeding us instead of a
  destination replacing us.
- **Context.** ⭐ **The strongest-evidenced ADDRESSABLE row of the five** (item 14 `:1217`, `:603–:610`):
  the tool is owner-stated 2026-09-26 *and separately owner-confirmed 2026-09-19*. Item 13 `JTBD-M07`
  supplies the mechanism and it is cheap and documented: webhooks POST to a URL you provide, JSON
  auto-detected, ports 80/443, 2FA mandatory, **3-second receiver timeout**. The ledger's framing is
  the thesis in one line: *"turn a competitor surface into an upstream sensor instead of a
  destination."* ⛔⛔ **State on master: ABSENT.** `api/routers/webhooks.py` is **Stripe-only** — one
  route, `POST /api/webhooks/stripe` — and `git grep -in tradingview origin/master -- api/` finds only
  CSV upload paths in `api/routers/modelbook.py` and Pine/AST string mapping in
  `api/services/ast_bind.py` / `ast_interpret.py`. No inbound alert receiver exists.
- **Dependencies.** `TERM-011` (the ops/business channel split must exist before this traffic does) and
  `TERM-025`'s registry, because a received condition must land on the **one** trigger taxonomy.
- **Existing code to reuse.** ⭐ `api/routers/webhooks.py` is the **exact idiom to copy**: its docstring
  is *"Separate from auth router because Stripe sends raw bytes (not JSON), and we need to skip any
  auth middleware… This endpoint has NO auth… Security is via the webhook signature"*. That is the
  shape a third-party POST receiver needs, already reasoned about and shipped. Plus
  `api/services/alert_taxonomy/` for the landing.
- **Files/modules likely affected (with repository).** uct-dashboard: a new router beside
  `api/routers/webhooks.py`; `api/main.py` mount ⚠️ **high-conflict**; `api/services/alert_taxonomy/`;
  a per-member receiver-token store.
- **Data requirements.** A received-alert record per member, and a per-member receiver secret.
  **Licensing: CLEARED** — ⭐ the payload is the **member's own** condition, not vendor data, which is
  why this is one of the very few coverage tickets with no licensing question at all. ⚠️ It is
  member-authored content, so LIC-10's cross-member clause bites the moment anything aggregates it:
  *"**R** for any cross-member aggregation… needs written consent of both the end user and SnapTrade"*
  — so **no leaderboard, no "what the room is watching"** in this ticket.
- **API work.** One unauthenticated-but-signed POST route with a **≤3 s** response budget (the sender's
  timeout is the contract), a replay/dedup key, and a hard body cap.
- **UI work.** A per-member "your receiver URL" panel with rotation, plus received alerts in the
  existing alert surface. ⛔ Reuse the alert surface; do not build a second inbox.
- **Testing.** A signature-verification boundary test (valid / tampered / replayed / oversized);
  a **3-second budget** assertion; and the receiver must appear in the route table the `TERM-026`
  auditor walks, so an unauthenticated route is **deliberate and visible** rather than a finding.
- **Observability.** Received / rejected / deduped counts, on the ops channel via `TERM-011`, with a
  cadence marker via `TERM-015` — ⛔ because a receiver that silently stops is exactly item 25's G-7.
- **Risks.** ⛔⛔ **The boundary, stated in the ticket because this is the ticket most likely to drift
  across it: this is INBOUND ONLY. No order path, no order preview, no position write, no broker
  credential.** `GOVERNING_PRINCIPLES` §13, NG-01…NG-03, CARD 25 §2. A received alert is information;
  acting on it is the member's, elsewhere, by design. ⚠️ An unauthenticated public POST is an attack
  surface: **GATE-7** is why `TERM-026` should land first, and `TERM-080`'s per-route limit is why an
  unlimited receiver is a bad idea. ⛔ Rotation breaks live senders — **PROD-1** binds, recovery path
  in the same commit (the `TERM-084` lesson, paid for once already).
- **Acceptance criteria.** (a) A signed fixture payload lands one record on the shared taxonomy and
  fires through the shipped path; a tampered one is rejected; a replayed one is deduped — all three
  seen red first. (b) The route answers within 3 s under a fixture load, or the sender drops it and the
  feature silently does not work. (c) ⛔ A rail asserts the diff introduces **no** order, position or
  broker-write vocabulary. (d) Rotation is exercised and a rotated secret's old sender fails with a
  named reason.
- **Estimated complexity.** **M.**
- **Parallelizable?** **Yes** — a new router is its own lane; only the `api/main.py` mount collides.
- **Blocked by (IDs).** `TERM-011`; ⭐ strongly prefer `TERM-026` first.
- **ROLLBACK TIER.** ⛔ **TIER-NONE** — shape: *creates or changes persistent state* (received records
  and per-member secrets). ⭐ **But this is the one `TIER-NONE` ticket with a cheap honest remedy
  available today:** ship the receiver behind a request-time gate in `_access_payload`, which is item
  37's **tier 1** for the *feature*, and keep the store additive so the reversal is "stop accepting",
  never "delete what members sent". Write that plan in the same commit.

#### TERM-087 · item 14 `WF-C12` — A generated answer returns the product's own editable object
- **User outcome.** A member who disagrees with a generated answer edits **one part of it** instead of
  re-asking in prose — which is the posture, not a screen.
- **Context.** Item 14 `:1220`, `:914–:922`; item 13 `JTBD-X06`. TradingView's AI screener emits **an
  editable configuration** with a filter-by-filter explanation, so *"the artefact **is** the
  citation"*, and *"nothing of that shape exists in UCT"*. The ledger's own words: *"a posture, not a
  feature — the generator must emit the product's own editable object rather than prose about one."*
  ⛔ **None of the four `FB-I1-*` items is this**: they are a shared renderer, a citation pointer, a
  railed spec and meters. Telemetry basis: **79 `ai_search_log` rows** (OI-06 §5/§6) — ⚠️ an existence
  check, not a usage rate, and the population is the 13-account one, never the 750.
- **Dependencies.** `TERM-079` (typed context channels) is the natural carrier; `TERM-025`'s registry
  for the alert-shaped case; `TERM-058` for a live count beside the emitted screen.
- **Existing code to reuse.** The shipped AI-search path (`api/main.py:6760`, `:6763`, `:6771` per item
  14) and the shipped screen/definition object the screener already saves — ⭐ **the object exists; what
  is missing is the generator emitting it.**
- **Files/modules likely affected (with repository).** uct-dashboard: the AI answer path under
  `api/services/ai_search_*`; the screen/definition serializer; the authoring surface that would open
  the emitted object.
- **Data requirements.** None new. **Licensing: CLEARED** — ⚠️ but LIC-15 binds the generation:
  Anthropic's §L.1 *"hands every input restriction (FMP, Finnhub, X, TheFly, AV) back to UCT at the
  prompt boundary"*, so an emitted object must carry its inputs' classes, which is `TERM-022`'s stamp.
- **API work.** The answer returns a typed object with an `edit` affordance, not a string. ⛔ Prose
  remains **beside** the object, never instead of it.
- **UI work.** Open the emitted object in the existing authoring surface.
- **Testing.** A fixture question yields a **valid, openable** object that round-trips through the
  existing save path — asserted by opening it, not by schema-validating it.
- **Observability.** Emitted-object count and **edited-then-run** count. ⭐ The second number is the
  only one that says the posture worked.
- **Risks.** `RSK undet` on the generation side. ⛔ **PROD-C8**: no unfalsifiable trust claim — the
  object is the citation, and *"'no hallucinations' is unfalsifiable, so the first counterexample costs
  more trust than the claim ever bought."* ⚠️ A generated screen that runs a **second** evaluator is
  ledger H2's silent defect (`TERM-058`'s rule): the object must run through the one evaluator.
- **Acceptance criteria.** (a) A fixture question returns an object the shipped authoring surface opens
  unmodified. (b) The emitted object runs through the **same** evaluator as a hand-authored one, proved
  by a parity assertion. (c) The prose half never appears without the object.
- **Estimated complexity.** **M.**
- **Parallelizable?** **Yes.**
- **Blocked by (IDs).** `TERM-079` preferred, not strictly required.
- **ROLLBACK TIER.** `tier 4 pref / 3` — a response shape plus a UI affordance, both bundle-shaped.
  ⚠️ Objects a member **saved** are persistent state; the save path already exists, so this ticket adds
  no new store and stays at tier 3/4.

#### TERM-088 · item 15 `ACC-02` — ⭐⭐ The decision record gets a member surface
- **User outcome.** A member can see **what we looked at and did not pick, and where each name died** —
  which is the one thing this product has that no vendor sells and no scrape recovers.
- **Context.** ⭐⭐ Item 15's strongest accumulated asset and its *"most actionable finding"*:
  `wire_universe` × `wire_issues`, **22,574 rows / 60 issues**, `dropped_at_stage = 2` → **19,611**
  names considered and rejected **with the stage each died at and its feature vector at the time**
  (`:310`, `:326–:347`). *"Highest defensibility, zero consumption"*, closeable *"by a join and a
  permission model rather than a data-collection programme."* ⛔ **State on master: no member route.**
  `git grep -l wire_universe origin/master` returns `api/services/wisdom/evals/replay.py`,
  `tests/test_wisdom_evals_replay.py` and `docs/wisdom/methodology/metrics-v1.md`; the reader at
  `replay.py:192–:198` selects `dropped_at_stage` **for eval coverage**, and every Wisdom router is
  `require_admin` or `require_push_secret` (`api/main.py:8869–:8871`). So there is a reader, an
  admin mount, and **no member surface** — item 15's `NO-SURFACE-FOUND` is correct for this row.
- **Dependencies.** `TERM-023` (a name on this surface should resolve to an **entity**, not a string —
  and 19,611 rejected names over five months is exactly where a re-used ticker bites) and `TERM-019`
  (every row needs its as-of and its source).
- **Existing code to reuse.** ⭐ `replay.py`'s query shape (it already knows the join and the stage
  semantics) — read it before writing SQL. ⛔ Do **not** extend the Wisdom routers: they are
  admin-by-contract and another programme owns them (§6.3).
- **Files/modules likely affected (with repository).** uct-dashboard: a new read-only router under
  `api/routers/` behind the paid dependency; a surface under `app/src/`. uct-intelligence
  (**READ-ONLY**): `data/uct_intelligence.db :: wire_universe`, `wire_issues` — ⛔ this ticket must not
  write to the engine's database, and the pod cannot open the owner's box, so the **transport is the
  real design question** (the nightly Brain Pack PC → R2 → pod is the shipped precedent).
- **Data requirements.** A read path to `wire_universe`/`wire_issues`, opened `?mode=ro`.
  **Licensing: CLEARED** — ⭐ item 15 is explicit that **ACC-02 needs no new source and no new licence**;
  its exposure is *"a join and a permission model"*. ⚠️ One genuine caveat must ship **on the surface**,
  verbatim from item 15 `:349–:352`: *"60 issues spanning 2026-04-29 → 2026-09-26 is a **young**
  record… roughly 104 weekdays, so the archive is **not every session**. The depth is five months, not
  five years."* ⛔ And CLM-17: the increment **must not be annualised**.
- **API work.** One paged read route: per ticker, or per issue, returning stage + as-of.
  ⛔ Read-only; no write path to an engine store.
- **UI work.** A per-ticker "considered and rejected, and where it died" view, and a link from the
  ticker surfaces that already exist.
- **Testing.** A ticker present in `wire_universe` with `dropped_at_stage = 2` renders its stage; a
  ticker absent from the record renders **"not considered"** and never an empty list read as "never
  rejected" — ⛔ *a layer that could not be read is not a layer that is empty*, and this is exactly the
  surface where that error would be invisible.
- **Observability.** View count per surface, and the **record's own coverage** (issues held vs weekdays
  elapsed) published on the surface, so its youth is visible rather than implied.
- **Risks.** ⛔ **Member-safety: this publishes a judgement about a name.** It is the firm's own
  decision record, not a member's, so `TERM-009`'s member-safety hold does **not** apply — but the
  distinction must be stated on the surface or a reader will assume it does. ⚠️ **INST-8/DOC-1**: every
  count on the surface is derived, never typed; the record is young and a ratio computed off 60 issues
  needs its `n`. ⛔ And the honest framing item 15 insists on: the record is *"adversarially
  self-incriminating"* — **19,611 rejections beside the picks is the point**, and a surface that shows
  only the picks has built the opposite feature.
- **Acceptance criteria.** (a) A paid member reaches the surface; an unpaid request is refused, proved
  by the route's dependency. (b) For a ticker with a recorded rejection, the stage renders; for one with
  no row, the surface says **"not considered"**, asserted on text. (c) The youth caveat and the
  derived coverage render on the surface. (d) No write reaches any engine store, proved by a rail on
  the connection mode.
- **Estimated complexity.** **M** — ⚠️ and the transport, not the query, is where the M lives.
- **Parallelizable?** **Yes.**
- **Blocked by (IDs).** `TERM-023` preferred; ⛔ `ACT:` an owner decision that the firm's rejection
  record may be shown to members at all. **That is a product call, not an engineering one.**
- **ROLLBACK TIER.** `tier 4 pref / 3` for the surface. ⚠️ Flagged honestly: once a member has seen
  that we rejected a name on a date, a deploy cannot un-show it — which is item 17's **second**
  `TIER-NONE` shape in everything but the store. The register keeps it at tier 3/4 because no published
  **address or value** changes; the caveat is recorded rather than averaged away.

#### TERM-089 · item 15 `ACC-10` — A replay surface for the Morning Wire payload archive
- **User outcome.** A member (or the desk) can read what the wire said on a past morning, and what the
  data looked like when it said it.
- **Context.** Item 15 `:318`: `morning-wire/data/` holds **44** payload snapshots (2026-07-21 →
  2026-09-25) + **26** sent letters + **78** review files, and *"no replay surface exists for the
  archive"*. `NO-SURFACE-FOUND`. ⭐ It is the cheapest of the asset tickets because the artefacts are
  already dated files, not a store to model.
- **Dependencies.** None hard. `TERM-019` for as-of rendering.
- **Existing code to reuse.** The shipped wire-rendering template (uct-dashboard's wire view) — ⭐ a
  snapshot should render through the **same** renderer as today's letter, or the replay is a second
  authority on what a letter looks like.
- **Files/modules likely affected (with repository).** uct-dashboard: one read route + one surface.
  morning-wire (**READ-ONLY** repo): `data/snapshots/wire_*.json`, `data/sent/letter_*.html`.
  ⚠️ **Different repository and PC-dependent** — the wire is engine-side, so the transport is the same
  question as `TERM-088`'s.
- **Data requirements.** Read access to the snapshot files. **Licensing: CLEARED** — our own content.
  ⛔ **Never write to `C:\data`**, and the review files are the owner's own notes: ⚠️ the **78 review
  files are internal** and this ticket surfaces snapshots and sent letters only.
- **API work.** One paged index + one fetch by date. **UI work.** A date picker over the archive.
- **Testing.** A snapshot from a known date renders through the production renderer; a date with no
  snapshot renders **"no issue"** and not an empty letter.
- **Observability.** Replay view count by date.
- **Risks.** ⚠️ ⛔ **NO public Substack wire, ever** — the replay is in-product and behind the paid
  dependency; nothing here publishes. ⚠️ The archive is **partial** (44 snapshots over a longer span),
  so the index must show what it does **not** hold, or a gap reads as "no issue that day".
- **Acceptance criteria.** (a) A known date renders through the shipped renderer. (b) A missing date
  renders a stated absence. (c) The index publishes its coverage (dates held / dates in range),
  derived. (d) Review files are not exposed, proved by a path rail.
- **Estimated complexity.** **S.** **Parallelizable?** **Yes.**
- **Blocked by (IDs).** None; shares `TERM-088`'s transport question.
- **ROLLBACK TIER.** `tier 4 pref / 3` — read-only surface over existing files.

#### TERM-090 · item 15 `ACC-06` — The episodic-pivot base rate, beside the flag
- **User outcome.** When the product flags an episodic pivot, the member also sees **how often that
  flag has been followed through** — which is the difference between a signal and a claim.
- **Context.** Item 15 `:314`: `ep_candidates` **506** candidates over **119** distinct flag dates plus
  `ep_follow_throughs` **12,257** rows, 2026-02-20 → 2026-09-25. `NO-SURFACE-FOUND`. On master
  `git grep -l ep_candidates origin/master` returns only `api/services/test_brain_service.py` and the
  admin Wisdom `replay.py` — **no member surface.** ⭐ The lesson this ticket exists to honour is one
  this estate has already paid for: *a hit rate is meaningless without its base rate.*
- **Dependencies.** `TERM-019` (the count needs a `CoverageLine`, not a bare number).
- **Existing code to reuse.** The follow-through aggregation in the engine (read it; do not re-derive),
  and `CoverageLine.jsx`.
- **Files/modules likely affected (with repository).** uct-dashboard: one read route, one line on the
  surface that already shows the flag. uct-intelligence (**READ-ONLY**): `ep_candidates`,
  `ep_follow_throughs`.
- **Data requirements.** Read access; same transport question as `TERM-088`. **Licensing: CLEARED** —
  our own record.
- **API work.** One aggregate route. **UI work.** One line beside the flag.
- **Testing.** ⛔ The base rate is reported **with its `n`** and its date range; a ticker with too few
  observations renders *"n too small"* rather than a percentage — ARCH/CARD 11's rule binds:
  *"n is reported as n, always."*
- **Observability.** The published `n` is itself the observability.
- **Risks.** ⛔ **A hit rate with no base rate is the defect**, and a small-n percentage is the same
  defect with a decimal point. ⚠️ Item 15's ACC-04 warning generalises: small-n rows *"must never ship
  unqualified"*. ⛔ No forward-looking claim; this is a historical frequency.
- **Acceptance criteria.** (a) The line renders `n` and the date range every time. (b) Below a stated
  `n`, no percentage is rendered — proved on a fixture seen red. (c) The number is derived from the
  store at request time, never a constant.
- **Estimated complexity.** **S.** **Parallelizable?** **Yes.**
- **Blocked by (IDs).** None.
- **ROLLBACK TIER.** `tier 4 pref / 3`.

#### TERM-091 · item 15 `ACC-13` — Load `docs/curriculum/` into the shipped education store ⚰️ RECUT
- ✅ **BUILT `ffe8a3f40` (2026-09-28), DARK behind `EDU_CURRICULUM_ENABLED`, unmerged.** New table
  `edu_lessons` in the existing `education.db` (kind `lesson` | `artifact`, keyed by a source-derived
  `lesson_key`, `source='curriculum'`), loader `scripts/load_edu_curriculum.py` (`--unload` is the
  scoped reversal), paid `GET /api/education/lessons[/{key}]`, a Lesson notes block on the existing
  Courses section. Loaded count is printed: **79 lessons + 7 toolkit artifacts**, census
  **181** (corrected 138 · verified 29 · replaced 9 · no_data_needed 5), read from
  `uct_method_scripts.json`. ⚠️ **Two findings the ticket did not have:** (1) no curriculum JSON
  carries an attribution field, so attribution is **derived by rules** (47 of 86 rows) and the
  79 lessons never name a third party in their own text; (2) `docs/curriculum/HANDOFF.md` records
  both courses — The UCT Method's 79 lessons with their scripts included — as **already applied to
  production as admin-only DRAFT `edu_paths` courses** (`kind='course'`, planned steps). "In no
  product DB" is therefore half-stale: the lessons are in the store as unrecorded video slots, and
  what this adds is their member-readable TEXT. Unverified against production (no Railway access).
- **User outcome.** The 79 lessons the firm has already written become reachable where members already
  go for teaching material.
- **Context.** ⚰️⚰️ **This ticket started as "give the curriculum a surface" and a grep deleted the
  surface half.** Item 15 `:321` records ACC-13 as `NO-SURFACE-FOUND` because *"the content is in git
  and in no product DB"* — **16 modules / 79 lessons, 33 units, 7 printable artifacts**, and a
  181-example `spec_verdict` census (corrected 138 · verified 29 · replaced 9 · no_data_needed 5), with
  `uct_method_scripts.json` at **691,762 bytes**. But a member-facing education surface **already
  ships**: `api/services/education_service.py` over `/data/education.db`, its docstring saying
  *"surfaced on the paid Educational Videos tab"*, tables `edu_videos` + `edu_paths`, six Learning
  Paths seeded by `ensure_default_paths()` at `:1036`, initialised at `api/main.py:3316–:3324` and
  mounted at `api/main.py:8852`. ⛔ **And the grep that makes the ticket real rather than a duplicate:**
  `edu_paths`' steps are **YouTube ids** from `api/services/education_paths_seed.py::SEED_PATHS` — so
  the shipped surface is a **video** library with video tracks, and the lessons are genuinely not in it.
  **The ticket is a loader plus a lesson kind, not a surface.**
- **Dependencies.** None.
- **Existing code to reuse.** ⭐ `education_service.py` entire — its WAL mode, `_WRITE_LOCK`,
  `contextlib.closing` convention, and the `_migrations`/flag-file idempotency pattern
  (`.edu_paths_migrate_v1`) that `ensure_default_paths()` already uses. ⛔ **No new database.**
- **Files/modules likely affected (with repository).** uct-dashboard:
  `api/services/education_service.py` (a `kind='lesson'` alongside `kind='track'`), a loader script
  under `scripts/`, `api/routers/education.py`, the Educational Videos surface.
  `docs/curriculum/*.json` is already in this repo at `origin/master` — ⭐ **no cross-repo transport
  needed**, which is why this is the cheapest of the four asset tickets to wire.
- **Data requirements.** A load of `uct_method_course.json`, `curriculum_final_v2.json`,
  `uct_method_toolkit.json`. **Licensing: CLEARED** — our own material. ⚠️ **But one real check**:
  CLM-15 records the **Qullamaggie transcript** material and the Minervini/O'Neil/Brandt/Wyckoff
  frameworks as *"re-organised public material, not defensible on its own"* with *"an unresolved
  licensing question"*, and **876 attributed rows already ship inside the Brain Pack**. ⛔ So the loader
  must carry an attribution field and the ticket must not surface third-party framework text as the
  firm's own. That is an **existing** exposure, not one this ticket creates — but it is the ticket that
  would make it member-visible at a new scale.
- **API work.** Lesson list/fetch on the existing router. **UI work.** A lesson kind in the existing
  tab. ⛔ **Not a new tab.**
- **Testing.** Idempotency (the loader run twice produces the same row count, like
  `ensure_default_paths`); a lesson with a third-party attribution renders its attribution; the load
  count is **printed**, never typed.
- **Observability.** Loaded-row count and per-lesson view count.
- **Risks.** ⛔ **Item 16 §4 row 14 rules out "a course, certification or learning tab as the answer to
  complexity"** — *"If a capability needs a course, the capability needs a redesign."* ⚠️ That is
  explicitly **not** an argument against ledger L6's curriculum, which the ledger calls *"the asset
  most ready to become a product"*. **The line this ticket must not cross: the curriculum is content,
  never the remedy for an unlearnable surface.** ⛔ Item 15 also calls ACC-13 *"the weakest row in this
  class"*, its moat being the **181-example verification pass**, not the syllabus — so the verdict
  census is the part worth surfacing, and a bare syllabus is not the asset.
- **Acceptance criteria.** (a) The loader is idempotent, proved by two runs and a row-count assertion.
  (b) Lessons appear on the **existing** tab; no new database and no new tab, proved by diff.
  (c) Every lesson carrying third-party framework material renders an attribution. (d) The row count is
  printed by the loader.
- **Estimated complexity.** **M.** **Parallelizable?** **Yes.**
- **Blocked by (IDs).** None. ⛔ `ACT:` an owner ruling on surfacing third-party framework material at
  member scale (CLM-15), which is a licensing question CARD 26 explicitly does **not** close.
- **ROLLBACK TIER.** ⛔ **TIER-NONE** — shape: *creates or changes persistent state* (rows in a
  shipped member store). ⭐ Remedy available in the same commit: load under a new `kind` with its own
  migrate-flag version, so the reversal is a delete **of rows this loader created**, scoped by kind —
  and that is a scoped delete of **firm content**, never member data, so item 37 `:590` is not breached.

#### TERM-092 · CARD 27 — Re-time the wire missed-run watchdog past 09:30, and rail it
- **User outcome.** A morning the wire does not run, a human finds out that morning — instead of the
  member badge reading "fresh" until 09:30 and the alarm waiting for two days of staleness.
- **Context.** ⛔⛔ **A verified production defect, not a research finding.** Found by item 14's author,
  verified independently at source. Three facts, each true alone: the watchdog runs once at **09:05 ET**
  weekdays (`api/main.py:2482 register_wire_watchdog_job`, `CronTrigger(day_of_week="mon-fri", hour=9,
  minute=5, timezone=_ET)`); it compares `wire_date < expected` (`api/main.py:2503`); and
  `expected_wire_date()` rolls the expected date back one day before 09:30
  (`api/services/engine.py:528`, the rollback at `:545`). So a one-run miss at 09:05 compares
  `yesterday < yesterday` → **False**, and the guard **cannot fire on the morning it was built for**;
  it can only fire at two days stale. The member badge agrees with it (`api/services/engine.py:573`
  `wire_freshness`, aliased at `api/routers/engine_data.py:58–:68`, used at `:87`). ⭐ The incident it
  was built for is recorded twelve lines from the defect, in `wire_freshness`'s own docstring:
  2026-08-14, the 06:35 run crashed and the dashboard served the prior day all day.
- **Dependencies.** None.
- **Existing code to reuse.** Nothing new. ⭐ `expected_wire_date()` is deliberately **one copy**,
  shared with `/api/leadership`, the breadth payload and the exposure payload.
- **Files/modules likely affected (with repository).** uct-dashboard: `api/main.py:2482–:2503`
  ⚠️ **high-conflict shared file** — a one-line constant change; one test module.
- **Data requirements.** None. **Licensing: CLEARED.**
- **API work.** None. **UI work.** None.
- **Testing.** ⛔ **CARD 27 requires the rail with the fix**: *"a test that pins the job's scheduled
  minute ON THE FAR SIDE of `expected_wire_date`'s 09:30 boundary… A guard nobody has watched fail is
  not a guard."* So: a fixture at the new minute with a one-run miss must produce **True**, and the same
  fixture at `minute=5` must produce **False** — the second assertion is what proves the rail can fail.
- **Observability.** The alarm itself, routed by `TERM-011`; a cadence marker via `TERM-015` so the
  watchdog's own silence is legible.
- **Risks.** ⛔ **Do not "fix" `expected_wire_date()`.** CARD 27 is explicit that re-timing the cron is
  **preferred** *"because that function is deliberately ONE COPY shared with `/api/leadership`, the
  breadth payload and the exposure payload"* — changing it would move a member-visible freshness
  boundary on three other surfaces. ⚠️ **GATE-1**: this guard has never fired, so the rail must be seen
  red. ⛔ `api/main.py` is a high-conflict file; the change is one literal and must not be bundled.
- **Acceptance criteria.** (a) The one-run-miss fixture fires at the new minute and **does not** fire at
  `minute=5`. (b) `expected_wire_date()` is byte-unchanged, proved by diff. (c) The scheduled minute is
  asserted to be **after** 09:30 by a rail that reads the trigger, not a comment.
- **Estimated complexity.** **XS** — one literal plus a rail. ⭐ The only XS in the register, and it is
  the only ticket fixing a defect that is live in production right now.
- **Parallelizable?** **Yes**, but ⛔ **it must not ride another change**: one literal, one rail, one
  push.
- **Blocked by (IDs).** ⛔ `ACT:` **an explicit owner "deploy"** plus a member-impact paragraph.
  CARD 27 marks it **NOT SHIPPED** — *"This is a `master` change and master is production."* ⛔ No agent
  ships this.
- **ROLLBACK TIER.** `tier 4 pref / 3` — one build constant. ⭐ A pre-authored tier-4 branch is trivial
  here (the inverse literal) and should exist before the push, per item 37 §4 item 7.

#### TERM-093 · item 14 `WF-C13`/`WF-C09` — The "what else was open, named" capture
- **User outcome.** None for a member. ⭐ It is the instrument behind *"the programme's own highest-value
  cheap observation"*, and without it two ADDRESSABLE break-outs stay 🔴 inferences forever.
- **Context.** `WF-C13` (*"inspecting a chart after a drill or a scan row"*) and `WF-C09` (*"inspecting
  an interrupting name without losing the working screen"*) are the same posture — *let me look at it
  properly* — and item 14 calls them *"the pair a single cheap observation would settle"* (`:1215`,
  `:1221`, `:1227`). CARD 24 removed the in-app embed half (`chart.ashx` → **zero** occurrences in all
  of `app/src`), so what survives is **by-hand use of finviz.com and TradingView**, which CARD 25 §4
  makes an owner-stated fact for the **tool** while CP-06 records the owner declining to itemise
  **which step**. ⛔ And item 14 §5.3 names the bigger version of the same hole as *"the most important
  gap in this document"*: `WF-C01`, the session itself, where the estate records the first surface and
  the most-viewed surfaces and **no transition between any two of them**.
- **Dependencies.** None technically. ⛔ It is owner-blocked on a **subject**.
- **Existing code to reuse.** `page_views` (⭐ already **4,949 rows**, so the storage shape exists) and
  the `desk_session_audit` marker idiom.
- **Files/modules likely affected (with repository).** uct-dashboard: one capture path plus one
  read-back; no member-visible surface.
- **Data requirements.** ⛔ **A self-reported field, not a browser probe.** CARD 22's instrument is
  *"what else was open, named"* — the subject naming the tab, not us detecting it. **Licensing:
  CLEARED.** ⚠️ It is member/owner behavioural data about **third-party** tools, so it is the firm's
  internal record and must not leave the product.
- **API work.** One write, one admin read. **UI work.** One prompt, at a declared moment.
- **Testing.** A recorded occasion with no named tab is distinguishable from an **unrecorded** occasion
  — ⛔ *a layer that could not be read is not a layer that is empty*, and this is the exact instrument
  where that error manufactured a finding in this estate before.
- **Observability.** Occasions recorded vs occasions eligible, with the **denominator published**.
- **Risks.** ⛔⛔ **This measures a person and the population is 13 accounts, six of them admins** — so
  ⚠️ it can produce an `n` of 1 and must report `n` as `n`. ⛔ Never one denominator across the two
  products: the ~750 are the Whop Discord's and are out of boundary. ⛔ *A change callback is not proof
  of user intent*: the capture must fire on an act a **person** took. ⚠️ And item 27's ruling binds:
  *"eligibility is a property of the occasion, never of our output"* — a morning our chart renders
  blank is a **failed** occasion, not an excluded one.
- **Acceptance criteria.** (a) An eligible occasion with no response is recorded as **unanswered**, not
  absent. (b) The read-back publishes recorded/eligible. (c) No third-party site is probed, asserted by
  a rail on the diff — ⛔ this instrument never reads the member's other tabs.
- **Estimated complexity.** **S.**
- **Parallelizable?** **Yes.**
- **Blocked by (IDs).** ⛔ `ACT:` the owner naming a subject. Item 27 returns
  **INCONCLUSIVE-BY-CONSTRUCTION, never a PASS**, without one, and CARD 25 §3 changes the odds without
  changing the requirement: *"There are 750 people already paying for a sibling product… But 'there
  isn't one' is no longer the likely answer."*
- **ROLLBACK TIER.** ⛔ **TIER-NONE** — shape: *creates or changes persistent state* (behavioural rows
  about a named person). ⛔⛔ Its reversal is the sharpest case of item 37 `:590` in the file: stopping
  the capture is **stopping the capture**, never a DELETE against what a person already told us.

---

## 6. ⛔ Not engineering work — and the held input that is the actual deliverable

### 6.1 Band 0 — HELD (10). ⭐ The only band that costs nothing and unblocks other bands.

⛔ **These get no work package because there is no engineering work to specify.** Seven of the ten are
a single sentence or a single act. Three of them gate other bands, and `TERM-007` gates the most.
**The held input named in the right-hand column IS the deliverable.**

| TERM | FB | what is held, and who holds it | what it unblocks | engineering half, if any |
|---|---|---|---|---|
| TERM-001 | `FB-S1-02` | ⛔ **A number.** ARCH-07 §3 Q1: *"The number still has to be chosen by a person"*; CARD 15 rules an absolute capacity number out of scope | its own panel curve | **S** — enforce a bound once the number exists. `PANEL_MOUNT_CAP = 3` caps **mounts, not board size**; there is no `MAX_WIDGETS` |
| TERM-002 | `FB-A10-05` | ⛔ **An email to Massive** asking for a second OPRA connection. ARCH-07 §3 Q9: *"no measurement can answer and no agent can progress"* | the permanent tape gap on every flow-worker deploy | **S** — a second consumer slot, after the answer |
| TERM-003 | `FB-A10-06` | ⛔ **A product decision**: extend Confluence Radar or delete it. Item 16's own subtitle — *"a decision, not a build"* | ledger G9 leaving `AWAITING_A_DECISION` | **S** to delete, **M** to mount |
| TERM-004 | `FB-A5-01` | ⛔ **OQ-14**: is the Discord bot's earnings-date path superseded? Two documents disagree about whether the bot runs at all (`RSK undet` on **DOC-3** — nothing detects duplicated prose claims) | one earnings-date authority | **S** if superseded (a deletion); **M** if it conforms (one adapter + a parity test) |
| TERM-005 | `FB-A9-03` | ⛔ **A purchase.** One unlicensed source with a contested `robots.txt` is the only path to the screener's universe — LIC-06: *"no terms document exists at all"*, and *"A Finviz no is a capability deletion, not a swap"* | the screener surviving its source | **the engineering half is a universe abstraction behind `TERM-022`**, so a second source is a swap |
| TERM-006 | `FB-S8-02` | ⛔ **One sentence**: the maximum age a panel may display without saying so. ARCH-07 §3 Q3 calls it *"a product decision nobody has made"* | `TERM-059` and every freshness render | **S** — a constant plus a contract |
| TERM-007 | `FB-OBS-07` | ⛔⛔ **A scheduling decision nobody has made.** Measured why: *"Fourteen deploys in six and a half hours; median pod life 26 minutes"*, and a valid Protocol A window took ~17 minutes of waiting | ⭐ **`TERM-014`, `TERM-017`, `TERM-001`'s panel curve and CARD 18's condition** — the highest-leverage unblock in the register | **none.** It is a convention: a window declared, held, and stated in the artefact with its `deployments_sampled` |
| TERM-008 | `FB-OBS-08` | ⛔ **A Cloudflare dashboard or API read by someone who can authenticate.** ARCH-07 §1.6: *"Nothing should be changed at the edge until they are read"* | CARD 20's ruling being executed **by intention** | **S** — one dashboard edit. ⚠️ CARD 20-EXEC records the TTL executed 2026-09-26 and CARD 20's diagnosis **wrong about WHERE**, so the read is still owed |
| TERM-009 | `FB-X1-01` | ⛔ **A member-safety decision.** A member's losing call published beside their name cannot be un-published by a deploy — *"`REV R3` in the strongest sense in the file"* | nothing | **M** — a scoring path plus a per-poster surface, **after** the ruling |
| TERM-010 | `FB-X3-02` | ⛔ **A curation decision** the owner or desk makes: which two or three boards are the seed. F-01 records the *"seeded or empty"* decision as never made | first-run | **S** — ⭐ the mechanism already ships (`charts_layouts` `scope=global`); **only the default is missing** |

⭐ **If one thing leaves this table first it is `TERM-007`**, and the argument is not preference: three
band-1 tickets and one band-0 item cannot produce an honest number before it, and it is *"a scheduling
decision"* rather than work.

### 6.2 ⛔⛔ Structural break-outs — not tickets, at any priority, ever

Item 14 §5.2 (`:1234–:1243`). ⛔ **Under CARD 25 §2 these are the boundary the thesis runs to, not
coverage failures somebody could fix**, and naming them is what keeps a coverage ledger honest:

| workflow | destination | why no ticket exists |
|---|---|---|
| `WF-C14` | **order placement** | ⛔⛔ `GOVERNING_PRINCIPLES` §13, NG-01…NG-03: *"no execution or order management"*. Item 14's own note: *"and neither half of it is a feature gap"* |
| `WF-C14`, `WF-B07` | **thinkorswim / Schwab** | ⛔ *"the platform is inseparable from a funded brokerage account — a brokerage-transfer decision, not a tool-preference decision"*. Item 13 verdicts it **structurally undisplaceable** |
| `WF-C10` | a second physical monitor | the operating system's, not a feature |
| `WF-C07` | the member's own calendar app | ⭐ leaving **is** the feature; what is addressable is the credential, which is `TERM-084` |
| `WF-B04/B05`, `WF-D03/D05/D07` | Discord | a community platform we chose and do not own |
| `WF-D01`, `WF-D06`, `WF-B08` | Substack | the letter's and the scans' publication channel, by choice |
| `WF-D04` | Zoom, YouTube, Discord | *"the pipeline's whole value is crossing three platforms unattended"* |
| `WF-A07` | a Windows desktop, a toast, a file | not a site workflow and cannot be made one |

⭐ **Read the column twice, because both readings matter to the thesis.** Most structural exits are
**destinations we chose** — publishing where the audience is — and those are not failures of
aggregation. The two that are about the member's own life are **the broker and the calendar**, and both
are places where something other than information lives: capital, and time.

### 6.3 ⛔ Out of this backlog's boundary — named so nobody writes the ticket

- **The Wisdom Loop's member surface.** It ships **ADMIN-MOUNTED** at real scale: **111 files** under
  `api/services/wisdom/` in six packages, a **32-table** schema contract, six routers included
  unconditionally at `api/main.py:8869–:8871`, store init at `:3477–:3485`, jobs at `:6347–:6356`, every
  route `require_admin`/`require_push_secret`, and ⛔ **zero rows in the capability ledger**
  (`grep -c wisdom capability-ledger.md` → 0). ⚠️ That is the largest instance of state 2 in the estate
  and it is genuinely tempting. **It is another programme's**, with its own session state and its own
  wave plan, and a ticket here would be a second authority over its roadmap. Recorded, not ticketed.
- **A14 Portfolio & Risk beyond the shipped `/portfolio-heat` door.** CARD 4: *"out of this program,
  and that is a scope statement, not a deferral."*
- **Anything inside `StockChart.jsx`.** The capability matrix's A2 ruling is *"binding, not advisory"*;
  ledger B1 records ~15,500 lines / ~120 props as *"the single largest carried risk"*; B2 is
  *"mount this, not B1"*. ⛔ Item 16 drafted two such items and **cut both**.
- **The 22-row not-build list** at `05-product-strategy/feature-opportunity-backlog.md:1287–:1320`, in
  full, including a board-level aggregation endpoint (ARCH-07 D5, hazard measured at **23.83 MB**), any
  tier-comparison surface (CARD 17), a corporate-actions ledger (CARD 5), merger events (CARD 6,
  *"verified live against two real M&A tickers (both 404)"*), arming the watchdog (CARD 18), a course or
  certification as the answer to complexity, mobile workspace parity, and any change to the deploy
  cadence. ⛔ **No ticket in §2 contradicts any of the 22**, and that was checked row by row.

---

## 7. Sequencing — bounded by the concurrency that exists, not the parallelism the register suggests

⛔⛔ **Do not read §2's `PAR` column as capacity.** Item 29's finding is the binding one and it is
quantified: the graph is **wide and shallow** — depth 3, and 40 of 85 items have no hard prerequisite —
so **delivery is not dependency-bound, it is concurrency-bound**. Its ladder, carried verbatim in
shape: **40 startable → 3 lanes (agent cap) → 1 at verification (one gate at a time on this box) → 1
master merge in flight repo-wide → 0 lanes on flow-worker watch paths during RTH.**

⭐ **And item 29 names a sixth shared resource nobody counts: this box is also the DATA PRODUCER** for
the scheduled member-facing jobs, so a 46–92 minute gate can contend with one. The local Task Scheduler
runs a weekday chain (7:00a scanner · 6:35a morning_wire · 5:00a wire_critic · 3:15p breadth_collector ·
3:20p UCT20 EOD · 3:30p brain pre-close · 4:05p eod_updater · 8:05p market_ingest, all local/CT), which
means **a verification window is a scheduling decision as much as a technical one** — which is
`TERM-007` again, arriving from a different direction.

⚠️ **Parallelism decays with depth**, the opposite of what a 40-wide in-degree-zero set suggests: four
chains disjoint at depth 0–1 converge to one front by depth 3. So a plan that opens three lanes at the
start and assumes three lanes at the end is wrong at the end.

### 7.1 What that means for three lanes, concretely

| lane | first tickets | why these three do not collide |
|---|---|---|
| **A — the floor** | `TERM-011` → `TERM-012` → `TERM-015` → `TERM-013`/`TERM-016` | lives in `api/terminal_next_monitor_main.py`, `tools/`, and monitor modules. ⛔ Touches `api/main.py` only at `TERM-014` |
| **B — the cheap and clear** | `TERM-030` → `TERM-033` → `TERM-027` → `TERM-036` | four different directories, each one surface or one constant, none in the workspace or provenance paths |
| **C — one enabler** | `TERM-026` → `TERM-019`'s **rail only** → `TERM-024` | a tool, a test rail, and a client contract. ⛔ `TERM-019`'s **adoption** must not run concurrently with lane B, which edits the same panels |

⛔ **`TERM-018` cannot share a lane with anything**, because it *is* verification and verification
collapses to one. ⛔ **`TERM-021`, `TERM-022` and `TERM-023` should not run concurrently with each
other**: all three are `TIER-NONE` store-shaped tickets, and the register's own H2 says the reversal
plan is unwritten — running three unreversible changes in one window is how a bad week becomes a bad
month.

### 7.2 ⛔ The four gates every lane passes through, in order

1. **`TERM-018`** — every guard in lane A has been observed red before green, with an AST rail and a
   control. ⛔ Nothing in band 1 ships without it, by item 25's own standard.
2. **The master gate**, which since the 2026-09-16 cutover is the thing that makes tier 3 a **request**
   rather than a rollback. ⭐ Hence item 37 §4 item 7: **a pre-authored rollback branch, pushed and
   gated green with the flag already false, before the first member-facing flip** — and RB-8 re-gates it
   when master moves more than five commits ahead or touches a file it touches.
3. **One master merge in flight, repo-wide** (item 29). ⛔ And this worktree's own rule: never
   `git add -A`; ship `push origin <branch>:master`, never force.
4. ⛔ **An explicit owner "deploy" plus a member-impact paragraph** for anything reaching master, and
   **no push into flow-worker's watch paths during RTH** (RB-11). ⛔ `TERM-092` is blocked on exactly
   this and no agent ships it.

### 7.3 ⭐ The five things worth doing first, and the reason is never value

⛔ **This is not a priority list over 93 tickets** — item 17 owns the order and §2 encodes it. These are
the five whose *cost of not doing them* is documented:

1. **`TERM-007`** (band 0, no engineering content) — it gates three band-1 tickets and a band-0 item,
   and it is a sentence.
2. **`TERM-092`** — a guard that **cannot fire** is live in production now, the fix is one literal, and
   the incident it was built for already happened once (2026-08-14).
3. **`TERM-019`'s rail** — `b11`, and the recut just made it cheaper than item 17 scored it.
4. **`TERM-073`** (band 5) — ⭐ **the only ticket whose cost of delay is strictly monotonic**: a
   retention series cannot be backfilled, so *"every night not retained is permanently lost."*
5. **`TERM-020`'s free first test** — *"pick the ten figures a desk answer most often states and confirm
   each has a stable id + as-of + inputs today."* ⭐ **Schedule that test, not the system.**

---

## 8. ⚰️ What I nearly wrote, and then found already ships

⭐ **This section is the reason the file opened `origin/master` 40-odd times**, and it is the error the
brief named as the most expensive available. Item 16 caught four near-misses the same way and said the
strongest argument for its method was checking *against the cards and not only against the ledger*
(§2.4). This file adds a third check — **against source at `origin/master`** — and it fired six times.

| # | the ticket I was going to write | what `origin/master` actually holds | what the ticket became |
|---|---|---|---|
| 1 | ⚰️⚰️ **"Build the entity master"** — item 16 says *"Today. **Absent.**"*, best-of-breed calls it *"the clearest infrastructure gap the research found"*, `L`, band 2, `b3`. This is the one that would have cost the most | `api/services/entity_master/` — schema (7 tables incl. a **dated** `entity_aliases`), store, api, reconciliation, **three** test modules, `scripts/entity_master_seed.py`, and `api/routers/entity_master_admin.py` at `api/main.py:8834` reporting `figi_coverage_pct` / `ambiguous_count` / `last_seed_at`. ⭐ `store.alias_candidates_as_of()` **is** item 16's acceptance criterion, already written | `TERM-023`: a member resolution path, a seed and an adoption rail. **L → M** |
| 2 | ⚰️ **"Extract the four provenance primitives"** | All four ship with tests: `Provenance.jsx`, `FreshnessBadge.jsx`, `CoverageLine.jsx`, `Cited.jsx`, plus four contract modules. Item 16 §2.4 had caught **two**; the other two shipped since | `TERM-019`: **rail and adoption only.** No extraction half exists |
| 3 | ⚰️ **"Build the canonical address book"** | `api/services/canonical/address_book.py` is headed *"D2 CP2 — ⭐ THE FIRST PRODUCT READER"*; CP1's rail was **narrowed, not deleted**; `api/data/canonical_address_book.json` exists; CARD 12 records the dual-compute reader *"RULED AND EXECUTED"* | `TERM-020`: **CP3, the five-status resolver**, which the file itself names as next |
| 4 | ⚰️ **"Nothing computes a latency percentile — introduce one"** | `api/flow_router.py:1628–:1636` computes `p50/p90/p95/p99_ms` off `time.monotonic()` deltas via `_diag_percentile`; `api/services/journal_two/notebook_telemetry.py:100` keeps a rolling-window `p95_ms`. ⛔ ARCH-07-OBS's control — *"grep returns hits in exactly one module"* — is **false on master today** | `TERM-012`: copy the shipped helper into `tools/bars_warmth_audit.py`. The mechanical change ARCH-07-OBS named is still exactly right |
| 5 | ⚰️ **"Give the curriculum a member surface"** (item 15 `ACC-13`, `NO-SURFACE-FOUND`) | A paid member-facing education surface ships: `api/services/education_service.py` over `/data/education.db`, *"surfaced on the paid Educational Videos tab"*, `edu_videos` + `edu_paths`, six Learning Paths, mounted `api/main.py:8852`. ⭐ But `edu_paths` steps are **YouTube ids** from `education_paths_seed.py` — the lessons really are absent | `TERM-091`: **a loader into a shipped store**, plus a lesson `kind`. No new surface, no new database |
| 6 | ⚰️⚰️ **"Give `coaching_notes` a surface"** (item 15 `ACC-08`, `NO-SURFACE-FOUND`, *"internal by design"*) | `api/routers/intelligence.py:363 list_coaching_notes` reads `coaching_notes` at `:378`/`:385` behind `_user: dict = Depends(require_paid)` at `:366`. ⛔ **That is a paid-member route.** Item 15 hedged correctly in advance (`:303–:305`); the evidence exists | ⛔ **No ticket at all.** Deleted before it was written |

⭐ **And one non-miss worth recording, because a negative check is evidence too.** Before writing
`TERM-086` I checked for an existing inbound receiver: `api/routers/webhooks.py` is **Stripe-only**, one
route, and `git grep -in tradingview origin/master -- api/` finds only CSV upload paths and Pine/AST
string mapping. **The receiver is genuinely absent** — and the Stripe router turned out to be the exact
idiom to copy, which is the second-best outcome after finding the feature already built.

⚠️ **Two numbers moved under the same greps, and the movement is the finding, not the number.** Item 16
says *"six sibling `.catch(() => null)` call sites"*; in `sectionFetch.js`'s own directory there are
**3** un-migrated occurrences, while across `app/src/` the idiom is in **79 files**. And item 16 says
*"118 files define their own `fmt*`"*; a similar-but-not-identical pattern
(`git grep -lE "(function|const) fmt[A-Z]" origin/master -- app/src/ | wc -l`) returns **128**.
⛔ **I am not correcting item 16's numbers**, because my patterns are not its patterns and a count is
only comparable to one produced the same way — which is exactly the discipline item 17 broke and caught
itself on. What both readings establish is that **the named scope is smaller and the population is
larger than the item says**, and that is what changes the ticket (`TERM-033`, `TERM-066`).

---

## 9. ⚠️ Contradictions between documents, recorded and not resolved

⛔ **Each is between two artefacts of comparable standing, and this file has no authority to settle
any of them.** Naming them is the deliverable; picking a winner would be inventing one.

1. ⚠️ **Item 14's ADDRESSABLE count: its table says 5, its own derivation command says 7.** The §5.1
   correction (`:1205`) withdrew `WF-C03` and `WF-C06` from the table but did not edit their
   per-workflow `Break-out.` fields at `:728` and `:787`, so
   `grep -c '^- \*\*Break-out\.\*\* ADDRESSABLE'` still returns **7**, and `:1227` and `:1504–:1505`
   still name them. ⛔ Its class sum closes at 38 **only because** the withdrawal was never applied, so
   reclassifying the two will break the sum rule until another class absorbs +2. **This file cut tickets
   from the 5.** Owner of the fix: item 14.
2. ⚰️⚰️ **Item 15's `ACC-08` cell vs `origin/master`.** `NO-SURFACE-FOUND` *"(internal by design)"*
   against `api/routers/intelligence.py:363` behind `require_paid`. ⭐ Item 15 pre-labelled this class
   correctly — *"an absence of evidence from this pass, not proof of absence"* — which is why it is a
   correction and not an error. **Consequence: the `NO-SURFACE-FOUND` count of 5 is a ceiling, not a
   measurement**, and `ACC-06`/`ACC-10`/`ACC-13` deserve the same check before their tickets are
   scheduled (I ran it for all three; they hold).
3. ⚰️ **Item 16's `FB-S3-01` "Today. **Absent.**" vs `origin/master`'s admin-mounted entity master**
   (§8 row 1). ⛔ Note that item 15 §6.4 had already noticed the *coordinates* drifting — *"the finding
   is correct and the coordinates moved"* — while the **finding itself** had stopped being true. A
   coordinate check is not a state check.
4. ⚠️ **ARCH-07-OBS G-2's control vs `origin/master`** (§8 row 4). Its conclusion may well still hold
   for the **bars serving path** specifically; the control it published to prove it does not.
5. ⚠️ **`cap_universe` has three values and nobody owns the difference.** Ledger A8 records **3,742**;
   `len(json.loads(...))` over `api/data/cap_universe.json` at `origin/master` returns **3,640**; D-13
   measured the wire payload's key at **3,721**. Item 15 carries it unresolved and so does this file.
   ⛔ Any ticket migrating off `cap_universe` (`TERM-023`) must **re-measure**, not carry a number.
6. ⚠️ **`rollout-rollback.md`'s length reads 901 or 902 depending on the instrument.** A byte census in
   Python (`b.count(b'\n')` = 901, file ends with `\n`) gives **901**, which matches MASTER_CHECKLIST
   row 37; a line-oriented reader reports 902. ⛔ Recorded because item 17's sweep is quoted as covering
   *"all 902 lines"* and a reader comparing the two numbers should know it is an off-by-one in the
   instrument, **not a disagreement about content**.
7. ⚠️ **Item 37's ladder rests on a flag absent from source.** `TERMINAL_NEXT_ENABLED` occurs in **zero
   files** at `origin/master`, while item 37's S1/S2 rungs and RB-2 are written around it and its §4
   item 1 requires it declared in `docs/feature_flags.json` (which exists). ⛔ **This is not a
   contradiction about the pod** — a variable can be set in Railway and referenced nowhere in git — but
   it does mean item 37's prerequisite 1 is **unmet in source**, which is a fact a ticket author needs
   before assuming a rung exists.

---

## 10. Counting discipline — every number in this file, and the command that produced it

⛔ **No count above is typed beside the artefact that owns it.** Counts carried from other documents
(85 items, 118 nodes / 109 edges, 38 workflows, 14 ACCUMULATED assets, 22,574 rows, 19,611 rejections)
are **that document's own measurement**, cited and never re-derived here. Counts about **this** file, and
counts about `origin/master`, are derived by the commands below.

```
# --- this file, run after writing (all four verified 2026-09-26) ---
# A row is a REGISTER row iff it carries a rollback-tier value. That definition is what
# excludes the band-0 recap table in section 6.1, which repeats ten ids with no tier cell:
grep -cE '^\| TERM-[0-9]{3} \|.*(\*\*TIER-NONE\*\*|tier 0–2|tier 4 pref / 3)' backlog.md  # -> 93
grep -oE 'TERM-[0-9]{3}' backlog.md | sort -u | wc -l                                     # -> 93 must match
grep -cE '^#### TERM-[0-9]{3}' backlog.md                                                 # full packages -> 34
grep -oE '^\| TERM-[0-9]{3} \|.*\*\*TIER-NONE\*\*' backlog.md | wc -l                     # no tier -> 25
grep -cE '^\| TERM-[0-9]{3} \|.*tier 0–2' backlog.md                                      # cheap   -> 4
grep -cE '^\| TERM-[0-9]{3} \|.*tier 4 pref / 3' backlog.md                                 # bundle  -> 64
# 25 + 4 + 64 = 93 is the closure check; a mismatch means a row lost its tier cell.
# WARNING: the dash in "tier 0–2" is an EN DASH (U+2013). A grep typed with a hyphen
# returns 0 - a FALSE ZERO, the exact error class sections 8 and 9 are about. Copy, do not retype.

# --- origin/master, all read-only, 2026-09-26 ---
git ls-tree -r --name-only origin/master -- api/services/entity_master     # 8 files
git grep -n "entity_master" origin/master -- api/main.py                  # mount at :8834
git ls-tree -r --name-only origin/master -- app/src/components/provenance  # 4 primitives + 4 contracts
git ls-tree -r --name-only origin/master -- api/services/canonical         # CP1+CP2
git grep -c "p95\|percentile" origin/master -- api/                        # 10+ modules, not one
git grep -l "\.catch(() => null)" origin/master -- app/src/ | wc -l        # 79 files
git grep -ln "useMarketOpen\|sessionModel" origin/master -- app/src/ | wc -l  # 37
git grep -iln "half_day\|halfDay\|market_holiday\|HOLIDAYS" origin/master -- api/ app/src/ | wc -l  # 69
git grep -l "wire_universe" origin/master                                  # 3 files, all admin/docs/test
git grep -l "ep_candidates" origin/master -- api/ app/src/                 # 2 files, no member route
git grep -n "coaching_notes\|require_paid" origin/master -- api/routers/intelligence.py  # :363/:366
git grep -c "TERMINAL_NEXT_ENABLED" origin/master                          # zero files
python -c "import json,subprocess;print(len(json.loads(subprocess.run(['git','show','origin/master:api/data/cap_universe.json'],capture_output=True,text=True).stdout)))"  # 3640
```

⛔ **One rule this file broke nowhere and names because it is easy to break:** a count is comparable
only to a count produced by the **same pattern**. Where my pattern differs from an upstream artefact's
(the `fmt*` regex, the `.catch` scope) §8 says so and declines to correct the artefact's number.

---

## 11. ⛔ What this document does NOT decide

- **It does not prioritise.** §2's order is item 17's bands and §7.3's five are the ones with a
  *documented cost of delay*, which is not the same as value. ⛔ No value axis exists and inventing one
  is forbidden (§1.3).
- **It does not choose scope.** Item 27 owns the MVP, admits **1 of 85**, and ⛔ **its build half is
  void** (CARD 24: `chart.ashx` has zero occurrences in `app/src`, `Breadth.jsx:49` already lazy-imports
  `ChartPane`, `:343` records the Finviz-tabbed `DrillModal` as **DELETED**) while its
  finviz.com-by-hand half survives and is `TERM-093`'s subject.
- **It does not schedule.** Item 28 owns the roadmap; §7 bounds it and does not write it. **No ticket
  here carries a date or a day count**, and item 16's bands are shapes, not estimates.
- **It does not create a rollback tier.** §3. Twenty-five tickets carry `TIER-NONE` and item 37 owns
  the remedy.
- **It does not settle any contradiction in §9**, and it does not repair item 14's per-workflow fields
  or item 15's `ACC-08` cell — those are their authors' files.
- **It does not assert any flag state, any store's row count, or that any module actually runs.** A file
  at `origin/master` is a file, not a behaviour.

---

## GAPS

1. ⚠️ **49 of 93 tickets have a register row and no work package** — all of band 0 (by design, §2.9),
   all of band 4 (a forecast, §2.9) and **all of band 5, which is a budget decision and is this file's
   largest gap.** Band 5 contains `TERM-063` (best-of-breed's *"best-evidenced row in this file"*) and
   `TERM-079` (item 17's *"cheapest high-leverage platform item in the estate"*), and both deserve a
   package. ⛔ A reader must not infer from the absence of a package that the ticket is unimportant;
   §2.9 says so and this is the second place it is said.
2. ⚠️ **No `origin/master` grep was run for bands 4 and 5.** Given that the check fired **six times in
   26 packages**, the expected number of further "already ships" corrections in the 49 unchecked
   tickets is **not zero**, and the honest prior from this file's own rate is that several exist. ⛔ The
   highest-risk unchecked rows are the ones whose item-16 "today" reads **absent**: `TERM-066`,
   `TERM-067`, `TERM-075`, `TERM-079`, `TERM-081`. **Check before scheduling, not after.**
3. ⚠️ **No test was run and no suite was inventoried**, so every `Testing` field is a specification and
   not an observation. An unscoped `pytest` reached 18 GB on this box and was OOM-killed; nothing here
   licenses running one.
4. ⚠️ **No store row count.** Item 15's fourth independent fact bites this file too: `entity_master.db`,
   `wisdom.db`, `education.db`, `wire_universe` — **whether any of them holds rows is unmeasured from
   here**, and `TERM-023`, `TERM-088` and `TERM-091` all change shape if the answer is "empty".
5. ⚠️ **The transport for `TERM-088`, `TERM-089` and `TERM-090` is undesigned.** All three read stores in
   PC-side repositories the pod cannot open. The nightly Brain Pack (PC → R2 → pod) is the shipped
   precedent, but which of the three rides it, and at what freshness, is a real design question this
   file names and does not answer. ⛔ It is where the `M` in `TERM-088` lives, not the query.
6. ⚠️ **`Parallelizable?` is a judgement from directory paths, not from a collision analysis.** Item 29
   flagged the same weakness in its own lane assignment (*"a judgement from row letters, not
   file-derived"*), and §7.1's three lanes inherit it. Two lanes called disjoint could collide in one
   file.
7. ⚠️ **No package exists for the 22-row not-build list's re-open triggers.** Several are cheap
   measurements (CARD 6's *"re-probe the same two tickers first, build nothing until one answers"*),
   and a re-open trigger nobody schedules is a decision that quietly becomes permanent.
8. ⚠️ **`XS` is used exactly once** (`TERM-092`) and Part CCI's scale offers it freely. Several band-3
   tickets may be XS after their recut; I did not re-band them, because re-banding on a grep is how item
   17's `SZ` column would acquire an error with no owner.

## NOT INSPECTED

- **The production pod, Railway, and every flag's live value.** No `railway` command was run, none
  attempted, and `/api/health` was not called. Consequently every flag named above — including
  `TERMINAL_NEXT_ENABLED`, `WATCHDOG_ENABLED`, `WISDOM_INGEST_ENABLED`, `STREAM_BARS_ENABLED`,
  `HUB_PREVIEW_ENABLED` and the webhook variables — is **NAMED and UNREAD**.
- **The Cloudflare dashboard and the zone's cache rules.** `TERM-008`'s held credential; ARCH-07 §1.6's
  instruction stands — *"Nothing should be changed at the edge until they are read."*
- **`C:\data`.** The owner's live data. Not read, not written, not enumerated.
- **The test suites.** Not run (GAPS 3). `conftest.py`'s shared-data pins were not overridden and must
  not be.
- **Partner-owned files beyond their existence and mounting.** `OptionsFlow.jsx`, `schwab_router.py`,
  `live_massive_router.py`, `massive_ws_worker.py`, `massive_processor.py` — noted, not described at a
  depth that invites editing. `TERM-040` and `TERM-070` route through the partner boundary.
- **The Whop Discord product.** Out of boundary (CARD 25 §3). ~750 paying members belong to it and to no
  denominator in this file.
- **The Windows Task Scheduler's live state.** Item 25's own caveat inherited: the honest claim is *"no
  standing schedule is recorded **in this repository**"*, never "none exists". Ledger O11 records four
  jobs failing silently for weeks with nothing reading `LastTaskResult`.
- **`uct_intelligence.db`, `wisdom.db`, `education.db`, `entity_master.db`.** Schemas read at
  `origin/master`; **no database was opened** and no row was counted.
- **Bands 4 and 5 against source** (GAPS 2).

## SOURCES

Charter: `00-program-control/charter/C-master-directive.md` (Part CCI `:2262–:2268`; Parts CCII–CCV for
the parallel-build, ownership and merge context) · `charter/B-execution-operating-system.md:1581` ·
`00-program-control/GOVERNING_PRINCIPLES.md` §12, §13, item 20 at `:105` ·
`00-program-control/AGENT_REGISTRY.md:172` · `00-program-control/contracts/_SHARED_PREAMBLE.md`.
Inputs: `05-product-strategy/feature-opportunity-backlog.md` (item 16) ·
`05-product-strategy/feature-scoring.md` (item 17) · `10-roadmap/rollout-rollback.md` (item 37) ·
`10-roadmap/dependency-graph.md` (item 29) · `04-workflows/workflow-library.md` (item 14) ·
`05-product-strategy/proprietary-advantage-inventory.md` (item 15) · `10-roadmap/mvp.md` (item 27) ·
`04-workflows/jobs-to-be-done.md` (item 13) · `05-product-strategy/non-goals.md` ·
`12-decisions/DECISION_CARDS_2026-09-26.md` (CARD 4, 5, 6, 9, 10, 11, 12, 15, 16, 17, 18, 20, 20-EXEC,
22, 23, 24, 25, 26, 27) · `00-program-control/MASTER_CHECKLIST.md` rows 13–17, 27, 29, 30, 37.
Code, all at `origin/master` via `git show` / `git grep`, 2026-09-26:
`api/services/entity_master/{schema,store,api,reconciliation}.py` · `api/routers/entity_master_admin.py` ·
`api/main.py` (`:2482`, `:2503`, `:3316`, `:3477`, `:4517`, `:6347`, `:8834`, `:8852`, `:8869`) ·
`api/services/canonical/{address_book,dual_read,dual_sample_store,indicator_axis}.py` ·
`api/data/canonical_address_book.json` · `api/data/cap_universe.json` · `api/flow_router.py:1628–:1636` ·
`api/services/journal_two/notebook_telemetry.py:100` · `tools/bars_warmth_audit.py:27–:28`, `:109–:116` ·
`api/services/engine.py:528`, `:545`, `:573` · `api/routers/engine_data.py:58–:68`, `:87` ·
`api/routers/webhooks.py` · `api/routers/intelligence.py:363`, `:366`, `:378`, `:385` ·
`api/services/education_service.py` (`:1036`) · `api/services/education_paths_seed.py` ·
`api/services/entitlements.py` · `api/services/wisdom/evals/replay.py:190–:198` ·
`app/src/components/provenance/*` · `app/src/pages/charts/WidgetHost.jsx:25`, `:107`, `:111`, `:270` ·
`app/src/components/tiles/MarketClock.jsx` · `app/src/components/dashboard/sessionModel.js` ·
`app/src/components/research/sections/{sectionFetch.js,SetupSection.jsx,StatementPanels.jsx,paidFetcher.js}`.

⚠️ **Not a source:** this worktree's `CLAUDE.md`. It is 249 KB of accumulated session notes and a
CLAIMS document; where a statement of its own appears above it is labelled as a ledger row or a claim
and is carried by the artefact that cites it, never on its own authority.
