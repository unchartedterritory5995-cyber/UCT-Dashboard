# Wave O — Finance-Native Review Loop: branch closure

**Branch:** `notebook-primary-platform` · **not merged** · awaiting merge/deploy
approval (§64).

Wave O turns UCT from *a place where research is stored* into *a system that
helps the member revisit financial judgements over time*.

---

## O0 — what the reconstruction found, and what it decided

⛔ **The architecture was inspected before anything was proposed**, and what it
found is what shaped the design:

| finding | consequence |
|---|---|
| A **thesis is a note** whose builtin properties carry status / confidence / research_type / review_date | Reviews key on `note_id` |
| `ticker_research` returns **activeTheses AND pastTheses** for one symbol | A security owns several theses, so a ticker cannot identify which was reviewed — **§37 satisfied structurally, not by a rule** |
| `j2_note_versions` rows are **immutable and carry ids** | A review references what the thesis said *then* without freezing a copy (§24) |
| ⛔⛔ **The thesis changelog is a COMPUTED READ with no write path** | Deciding a thesis STILL HOLDS writes nothing anywhere — it is the one fact in this domain that cannot be derived. **That is why reviews need storage**, and why §22's "don't merge the two histories" is structural: the changelog *cannot* absorb a review, because it only surfaces what it can derive |
| Evidence carries `created_at` / `removed_at` | "Since last review" is **member research chronology**, not source mtime (§39) |
| `builtin:review_date` and Research Home's `needsReview` **already existed** | Wave O extends an existing surface instead of building a Tasks app (§1/§15). What was missing was the event, the reason and the history |
| ⛔ **Earnings has no stable event identity** — `calendar_date_history` keeps ONE row per symbol and overwrites `report_date` | Binding a review to "NVDA earnings" is exactly what §18 forbids. **Event-bound review deferred**, explicit dates ship first — §18's own pre-decided answer |

**No material decision gate (§51) was triggered.** The earnings deferral is
pre-decided by §18; everything else resolved inside the existing architecture.

---

## The invariants, and how each is held

⛔⛔ **COMPLETING A REVIEW NEVER TOUCHES THE THESIS (§4/§9).** There is no code
path in `thesis_reviews.py` that writes a note, a property or a version — not
even for `invalidated`. The complete endpoint reads **no thesis-status field at
all**, so a hostile client cannot ask for one; a rail asserts the *absence of the
lever*, which is the only durable form of that guarantee. A mutation that makes
the service write a note property goes red.

⛔⛔ **FIVE SEMANTIC FACTS, NEVER COLLAPSED (§3):**

```
source claim       "Gross margin normalizes toward the mid-70s."   ← evidence rows
member annotation  "I think management is too optimistic."         ← capture annotation
evidence stance    OPPOSING                                        ← the edge
UCT review signal  "1 opposing evidence item added since your      ← computed, factual
                    last review"
member decision    "No change"                                     ← the outcome
```

All five appear on one screen and none is dressed as another.

⛔ **FACTS, NEVER SIGNIFICANCE (§12/§13).** "2 opposing evidence items added" is
emitted; "your thesis has weakened" is not. `review_attention` returns **causes
in member-facing words** and there is deliberately no priority field for a
surface to render instead of the explanation — a rail forbids
priority/invalid/weaken/strengthen/urgent in that payload.

⛔ **NO PSEUDO-PROBABILITIES (§41).** 5 supporting / 2 opposing is never "71%
supported". A rail scans the change payload's own keys for
score/pct/percent/conviction/strength/probability.

⛔ **ONE LIVE AUTHORITY FOR SCHEDULING.** The review row records what the member
chose *at that review* (historical, immutable); `builtin:review_date` is the
live schedule the queue reads. A **record** and a **state**, not two copies —
and the schedule is written through the canonical note path so it produces a
version and a changelog entry like any other property change.

⛔ **DRAFT ≠ COMPLETED (§34).** `save_draft` never sets `completed_at`;
autosave cannot manufacture a decision. A completed review cannot be edited
(§8) and cannot be completed twice.

⛔ **ONE OPEN DRAFT PER THESIS (§38)** — enforced by a partial unique index in
the database, not by a service that remembers to check, so a racing second
writer still cannot win.

---

## §27 — the new-content-type consumer audit, in full

The doctrine that has found a defect in every wave. Wave O adds a REVIEW.

| consumer | status | evidence |
|---|---|---|
| **thesis UI** | ✅ **DONE** | O1 — the panel, 16 rails |
| **Research Home** | ✅ **DONE** | O2 — `needsReview` rows carry `reviewReasons`, 14 rails |
| **export** | ✅ **DONE** | §46 — completed reviews in front matter; drafts never; no source text copied; 2 mutations |
| **lifecycle** (trash / restore / purge) | ✅ **DONE** | §56 — trash keeps reviews recoverable, purge removes them, a review survives its evidence being purged |
| **account purge** | ✅ **DONE** | §47 — `j2_thesis_reviews` in `_DIRECT_USER_TABLES` + the deletion manifest; covered by the existing coverage rail |
| **tenant isolation** | ✅ **DONE** | §57 — non-confirming refusals; foreign note, foreign review id, foreign listing all fail without confirming existence |
| **mobile** | ✅ **DONE** | §44 — 390×844 coarse pointer, every control ≥44px, hit-tested |
| **accessibility** | ✅ **DONE** | §45 — named panel, worded outcomes, `aria-checked`, labelled group/date/note, keyboard reachable, announced, focus restored |
| **navigation** | ✅ **N/A by design** | The review lives inside the thesis; no new route, no new door to leave unreachable |
| **Search** | 🔴 **NOT DONE — declared** | §28 says "where product value warrants it". A review note is member-authored text that Search cannot currently find. **It is not indexed and no surface claims it is.** Ranked residual #1 |
| **Ask (Notebook / Security Research)** | 🔴 **NOT DONE — declared** | §29 says Ask should "eventually" answer "what did I decide in my last review?". It cannot today. **No Ask surface claims otherwise**, and no review text reaches any prompt. Ranked residual #2 |
| **Current Note scope** | 🔴 **NOT DONE — declared** | Same as Ask |

⛔ **The two 🔴 rows are the point of doing this audit honestly.** Wave L's
permanent lesson is *"do not say the Notebook supports X while major Notebook
scopes cannot interpret X"*. Wave O therefore says it here, in the closure doc,
rather than discovering it three waves later: **review notes are invisible to
Search and Ask, deliberately and for now.** Nothing in the product implies they
are not.

⭐ And when they are added, §23's rule already applies and is already proven for
this shape: **a review referencing evidence must not create a second source.**
Curation ≠ corroboration — the Wave N lineage rails are the pattern to reuse.

---

## Evidence

**Rails:** 32 domain + 10 router + 14 queue + 12 export/lifecycle + 16 UI = **84
Wave O rails**, plus 343 in the targeted backend regression and **2,160 frontend
tests** (`--maxWorkers=4`, the proven resource-aware shape).

**Mutations — all RED as required, byte-identical restores:**

| # | mutation | expected red |
|---|---|---|
| 1 | ownership predicate dropped from `complete` | `test_another_member_cannot_complete_it` |
| 2 | completing silently mutates the thesis | `test_NO_CHANGE_leaves_the_thesis_completely_untouched` |
| 3 | all evidence treated as new regardless of the anchor | `test_evidence_added_BEFORE_the_anchor_does_not` |
| 4 | supporting and opposing collapsed | `test_supporting_and_opposing_are_never_collapsed` |
| 5 | a completed review can be rewritten | `test_a_completed_review_cannot_be_edited` |
| 6 | the due boundary flipped to exclusive | `test_TODAY_is_due_the_boundary_is_inclusive` |
| 7 | the queue stops explaining itself | `test_a_never_reviewed_due_thesis_says_exactly_that` |
| 8 | the service silently schedules the thesis | `test_the_review_records_the_choice_but_does_not_schedule_it` |
| 9 | drafts leak into the export | `test_a_DRAFT_never_appears_in_the_export` |
| 10 | the front matter drops reviews | `test_a_completed_review_travels` |
| 11 | the queue row stops saying why it is due | `test_EVERY_row_states_why_it_is_here…` |

**Flagship E2E (§52): 20/20 green** through the real member UI in the
fail-closed sandbox — including §53's no-change control (the thesis is untouched
while the schedule IS set), §55's opposing-evidence control ("1 opposing
evidence item added since your last review", with no auto-invalidation and no
stance change), and step 20's proof that the prior review is unchanged.

**Mobile/a11y (§44/§45): no findings on the first run.** Every control ≥44px and
hit-tested; `"Review completed: No change."` announced; focus restored to the
trigger; no horizontal overflow (390/390). ⭐ **The touch tier was written into
this component's first commit** rather than retrofitted — Wave N's audit had
found the entire evidence flow at 28–38px.

**Performance (§43), calibrated (transport floor 1.7ms), corpus of 8 theses /
235 evidence rows:**

| | p50 | p95 | budget |
|---|---|---|---|
| Research Home (with per-row reasons) | 11.6ms | 12.9ms | 800ms |
| changes-since-last-review | 21.0ms | 22.8ms | 400ms |
| open review | 11.1ms | 12.5ms | 400ms |
| complete review | 16.2ms | 16.9ms | 600ms |

---

## Residuals, ranked, un-inflated

1. 🔴 **Search cannot find review notes** (§28). Declared above; nothing claims
   otherwise. The highest-value follow-up, because a member who writes an
   assessment about customer concentration should be able to find it later.
2. 🔴 **Ask cannot answer "what did I decide last review?"** (§29). Requires the
   review history to become a typed evidence source — and §23's curation ≠
   corroboration rule must hold when it does.
3. **No recurrence** (§14). Explicit dates only; Notion's repeating templates
   are genuinely ahead here.
4. **Earnings-bound review deferred** (§18) — `calendar_date_history` has no
   stable per-event identity, and binding to a drifting date would be the exact
   thing §18 forbids.
5. **Position/thesis mismatch not implemented** (§42). `resolve_trade_ref` and
   `_open_position_research` make it feasible; not built, because §66 says not to
   hold closure hostage to signals whose semantics were not yet proven.
6. **"What changed since I bought?" not attempted** (§20) — the primitives exist
   now; the historical market comparison does not.
7. **`changes_since` is O(evidence) per thesis** — it calls `_target_exists` per
   live evidence row. 21ms at 60 rows; a thesis with 600 would be ~200ms. Named
   rather than optimised prematurely.
8. **Review reasons are computed per queue row** (up to 5). Bounded and measured
   at 11.6ms, but it is per-row work on the Notebook's highest-frequency surface.

---

## Instruments that were wrong before they were right

Carrying the doctrine forward, and it caught me four more times:

1. A **whole-panel banned-word check** flagged "Invalidated" — which is one of
   the four outcomes the **member** may choose. Wave N's "Document excerpt"
   whole-page check, exactly repeated. Scoped to what UCT says.
2. **History assertions ran against a `CollapsibleSection`** that unmounts its
   children while collapsed.
3. A **shared fixture user** hit Research Home's real 5-row section cap, so a
   later test's own thesis fell off the end and read as the queue failing. And
   the first fix did not work because `_home(user=A)` had captured the tenant in
   a **default argument** at definition time.
4. A resilience test **corrupted `properties_json`** to force a failure — an
   unreachable state the product never writes, whose empty section was correct
   degradation of an impossible input. Testing a fiction proves nothing; it now
   forces the failure at the seam that can actually fail.
5. A **case-sensitive check against a CSS `text-transform: uppercase`** title.
   Wave N lost a run to this on a stance pill; Wave O lost one on a heading.

---

## Machine and probe safety (§60/§61)

- Disk checked before every heavy run; 201–205 GB free throughout.
- All browser work ran through the **Notebook-owned** fail-closed sandbox
  (`tools/local_backend_sandbox.py`), which since Wave N no longer pulls the
  multi-GB bars snapshot on boot.
- ⛔ `tools/e2e_sandbox_launcher.py` was **not touched** — another workstream's
  tool, and it still carries the same snapshot-pull defect (it created a 24.86 GB
  staging directory during Wave N's certification).
- No ad-hoc probe touched live local product data; every measurement went
  through the sandbox or pytest.

## Standing gates — untouched

`J2_SHARE_LINKS_ENABLED=0`, nothing here touches sharing · no embedding call, no
ZDR change, semantic stays **DARK** (§30) · no notification provider, no email,
no push (§31) · every query tenant-scoped inside the SQL · no raw private note
content in logs · account deletion removes reviews.

---

## What is being asked for

**Merge and deploy approval for the Wave O slice** — commits `3a3122c21`
through the closure commit on `notebook-primary-platform`.

⛔ **Wave P — OCR / Scanned Intelligence is NOT started** (§67).
