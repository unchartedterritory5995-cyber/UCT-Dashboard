# UCT Notebook — Primary-Platform Decision Log

Durable record of major decisions across Phase Zero, the Evidence-Integrity Audit, Phase One, and Phase Two. Prevents future sessions from re-litigating resolved questions without new evidence. Each entry: decision, alternatives considered, evidence, rationale, consequences, reversibility, and what would cause reconsideration.

---

## Pre-Wave-0 Test Baseline (captured 2026-09-05, before any Wave 0 code change)

**Master reconciliation:** `origin/master`'s delta since the research baseline (`54d7de266`) is the same 8 files identified in Phase Two: this program's own account-deletion fix (`api/routers/auth.py`, `api/services/journal_two/account_purge.py`, `docs/account-deletion-manifest.md`, `tests/test_journal_two_account_purge.py` — **MATERIAL WAVE-0 IMPACT, positive: a Wave-0 security/privacy prerequisite is already satisfied**) and 4 unrelated Package-8G-B pattern-engine/screener performance files (**NO IMPACT** — zero overlap with Notebook/Journal 2.0/Compass/auth-lifecycle/search/AI/charts-widgets/Terminal/screener-scanner/company-pages/portfolio-watchlists, confirmed via `diff --stat`). Merged into `notebook-primary-platform` cleanly (no conflicts); `account_purge.py` confirmed present in the implementation tree post-merge. No Wave-0 assumption required re-verification.

**Broad regression scan** (1147 tests matched by a keyword filter across `tests/` + `journal_two/`, ~39 min): 10 failed, 2 errors, 1 skipped (a flag-off skip, working as intended), rest passed.

**Re-run in isolation (this session, before any Wave-0 change), to distinguish deterministic failures from order-dependent artifacts of the broad run:**

| Test | Broad-run result | Isolated result | Classification |
|---|---|---|---|
| `test_scan_screener_auth.py::test_a_PAID_member_still_gets_200_on_EVERY_route` | FAILED | **FAILED** | Deterministic. `TypeError: stub_services.<locals>.<lambda>() got an unexpected keyword argument 'user'` — a test-fixture stub signature mismatch in the test file itself (not app code — confirmed `stub_services` doesn't exist in `api/routers/screener.py`). Screener-specific, zero relation to Notebook/Wave 0. |
| `test_scan_screener_auth.py::test_an_ADMIN_gets_200_everywhere_including_the_refresh_route` | FAILED | **FAILED** | Same cause as above. |
| `test_scan_screener_auth.py::test_a_TRIAL_member_is_treated_as_paid` | FAILED | **FAILED** | Same cause as above. |
| `test_screener_api.py::test_saved_screens_delete_of_a_missing_or_foreign_screen_answers_404_not_found` | FAILED | **FAILED** | Deterministic. `sqlite3.OperationalError: no such table: screener_saved_screens` — a missing table in this test's own fixture setup. Screener-specific, zero relation to Notebook/Wave 0. |
| `test_alert_ledger_admission.py::test_a_USER_AUTHORED_fire_lands_ZERO_receipts_beside_a_builtin_that_lands_ONE` | FAILED | **PASSED** | Order-dependent — a known class this repo's own `conftest.py` documents extensively (e.g. the `AUTH_DB_PATH`-reload split-store defect). Not a Wave-0 concern, not introduced by this session. |
| `test_alert_user_admission.py::test_one_accounts_formula_cannot_answer_for_another` | FAILED | **PASSED** | Order-dependent, same class. |
| `test_alert_user_router.py::test_one_accounts_formula_cannot_be_armed_by_another_over_HTTP` | FAILED | **PASSED** | Order-dependent, same class. |
| `test_definition_record.py::test_BLIND_SPOT_4_a_USER_AUTHORED_fire_is_refused_FIRST_yet_the_record_has_it` | FAILED | **PASSED** | Order-dependent, same class. |
| `test_user_definition_reproof.py::test_the_QUIET_STOPS_when_the_SUPPRESSION_IS_DELETED[forming/closed]` | FAILED (×2) | **PASSED** | Order-dependent, same class. |
| `test_user_definitions_auth.py::test_the_owner_ruling_is_carried_as_a_TIER_and_the_ast_lane_is_premium` | ERROR | **PASSED** | Order-dependent, same class. |
| `test_user_definitions_auth.py::test_the_free_tier_is_EXACTLY_the_sixteen_natives_and_that_is_the_OWNER_QUESTION` | ERROR | **PASSED** | Order-dependent, same class. |

**Baseline verdict:** 4 deterministic pre-existing failures, both root-caused to test-fixture bugs in the `screener` test suite (not app code, not Notebook, not Wave 0). 8 order-dependent flakes, reproduced as passing in isolation, consistent with an already-known, already-documented test-isolation defect class in this repo — not new, not a regression, not touching any Wave-0 code path. **None of the 12 overlap, by import or reference, with `account_purge.py`, `auth.py`'s deletion endpoints, or any `journal_two`/Notebook file** (confirmed by grep before this baseline was recorded). This baseline — 4 deterministic screener failures, 8 known-flaky order-dependent tests — is what any post-Wave-0 comparison must be measured against, so a genuine Wave-0 regression is never confused with either of these two pre-existing classes, and neither is silently waved off as "pre-existing" without this record to point to.

---

### 2026-09-05 — North star narrows from "primary notebook" to "financial research system of record"

**Decision:** UCT Notebook's immediate ambition is to be the best financial research/knowledge system for active traders first, used *alongside* a member's general notebook — not a Notion/Evernote/Obsidian replacement.
**Alternatives:** (a) full incumbent replacement as originally briefed ("Notion + Evernote + Obsidian + UCT Financial Intelligence"); (b) the narrower system-of-record framing adopted.
**Evidence:** Phase Zero's own §1 executive framing already argued for (b) ("win on the one axis none of the three can structurally match") while §33's proposed end state reverted to (a) without re-deriving it — an internal inconsistency. Supporting evidence: the Obsidian trust bar is conceded unclearable by policy alone; offline is downgraded; note content is plaintext server-side; the Do-Not-Build list (clipper, plugin marketplace, team collaboration, full graph) is only coherent under (b).
**Rationale:** (b) is a cheaper trust claim to earn (a bounded, financial-tagged slice vs. the whole vault), makes the Do-Not-Build list durable rather than provisional, and increases rather than decreases the value of the closed migration/connector program's bidirectional sync work.
**Consequences:** Stage C's definition of "Primary Notebook Ready" explicitly allows a hybrid outcome (UCT for financial captures, incumbent retained for everything else) as success, not failure. Migration-trust UX rescopes from "prove your whole vault survived" to "prove the financial notes are trustworthy."
**Reversibility:** Reversible — nothing in the Stage A/B build list forecloses later full-replacement ambition; it's a positioning and prioritization choice, not an architectural one.
**Reconsider if:** Stage C evidence shows the beachhead persona spontaneously wants full displacement and the trust/parity bars needed to support it are cheap to add.

---

### 2026-09-05 — Stage C sharpened: optional continued incumbent use ≠ required incumbent use due to a capability gap

**Decision:** Refine (not reverse) the Stage C definition set by the entry above. Stage C — "Primary Notebook Ready" — means a target financial member does not *need* Notion/Evernote/Obsidian for their important, in-scope daily/research workflows. A member's optional, chosen continued use of an incumbent for out-of-scope workflows (general note-taking, unrelated projects) remains a legitimate permanent outcome. A member's *required* return to an incumbent because UCT genuinely cannot do an in-scope, named target-persona workflow is **not** Stage C for that workflow, regardless of how much other work has shipped.
**Alternatives:** Leave the original entry's "hybrid outcome... as success" language unqualified, which risked being read as license to treat any and all continued incumbent dependence — including on workflows this program explicitly researched and named as in scope — as an acceptable permanent end state.
**Evidence:** No new research evidence — this is a strategic-intent clarification, requested explicitly to prevent the roadmap from optimizing around permanent coexistence rather than treating coexistence as the *initial* adoption strategy on the way to a higher bar.
**Rationale:** The original entry's narrowing (system-of-record over full-replacement as the *initial* strategy) remains correct and is not reversed here — Stage B is still the right place to earn adoption first. What was underspecified is the ultimate Stage-C quality bar: "used alongside" must not quietly become "permanently dependent on the incumbent for something we should have built." Distinguishing optional-out-of-scope-use from required-in-scope-gap-use closes that ambiguity without reopening the beachhead or Stage-B decisions.
**Consequences:** `primary-platform-master-product-spec.md` §1, §2 (Constitution item 15), and §4.3 updated with this distinction. No change to Stage A or Stage B scope, build lists, or sequencing — this affects only how Stage C's exit evidence is judged, later.
**Reversibility:** Fully reversible — a definitional sharpening, not an architectural or roadmap change.
**Reconsider if:** never expected to reverse; could be further refined if real Stage-C evidence surfaces a target workflow this program never researched and therefore never scoped as "in scope" in the first place — that would be a scoping question, not a reason to relax the optional/required distinction itself.

---

### 2026-09-05 — Beachhead persona: active/swing trader, not four co-equal personas

**Decision:** The active/swing trader already inside Journal 2.0 + Compass + broker sync is the primary beachhead. Fundamental investor and PM-of-own-capital are secondary (alongside model). Professional analyst/institutional PM are deferred.
**Alternatives:** Treat all four Phase Zero personas (trader, fundamental investor, professional analyst, PM) as co-equal v1 targets.
**Evidence:** Direct, file:line-verified inspection: Notebook's 8 templates are entirely trader-ritual-shaped (zero fundamental-research templates); Compass's 10-category onboarding taxonomy uses trading-specific vocabulary throughout; the entire Compass coaching layer (28+ tools) models a trading-discipline coach; `j2_notes` has one entity field (a single `ticker` column), inadequate for a fundamental investor's coverage-universe/comps needs.
**Rationale:** The product's existing architecture already picked a persona — building toward four different structural needs (trading-discipline coaching vs. relational databases vs. team/compliance vs. portfolio risk) with one editor, one entity model, one AI grounding design would dilute all four.
**Consequences:** Stage A/B build lists are scoped to what serves the trader persona first; fundamental-investor value comes via capture/connector bridges into their real vault, not native Notebook features competing with Notion databases.
**Reversibility:** Reversible at the margin (secondary personas can be promoted later) but the initial engineering investment (templates, onboarding, entity model) is trader-shaped and would need real rework to re-center.
**Reconsider if:** real signup-source/usage data shows meaningful fundamental-investor or professional-analyst adoption independent of this program's own trader-first design choices.

---

### 2026-09-05 — Professional-analyst/PM persona deferred, not researched further, pending two unresolved questions

**Decision:** Do not invest further roadmap weight in the professional-analyst/institutional-PM persona until (a) whether their real competitive set is Notion/Evernote/Obsidian at all (vs. Excel/Bloomberg/FactSet/internal wikis) is resolved with real data, and (b) an employer-compliance question (can this persona put firm research in a personal SaaS tool at all?) is answered.
**Alternatives:** Continue treating this persona's Notion/Evernote/Obsidian switching-blocker analysis as directly applicable without checking either premise.
**Evidence:** New evidence gathered during Phase One (a Notion Marketplace niche of retail/prosumer "Equity Research Command Center" templates; Obsidian trading-journal plugins aimed at swing traders) skews the whole research program's competitive evidence toward the retail/prosumer end of the stated persona list, leaving the professional half's actual competitive set unexamined. The employer-compliance question was never raised in Phase Zero at all.
**Rationale:** Both questions are answerable-only-with-real-data or a compliance opinion, not more competitive research — continuing to build toward this persona without answering them risks building for a switching decision that isn't actually available to make (if firm compliance forbids it) or against a competitor that isn't actually the right one (if the real competitive set is Bloomberg/FactSet).
**Consequences:** No professional-analyst-specific features are scheduled in Stage A or B.
**Reversibility:** Fully reversible — this is a research/investment gate, not an architectural exclusion.
**Reconsider if:** signup-source data shows this persona already exists in UCT's base at meaningful numbers, or a compliance answer removes the employer-permission concern.

---

### 2026-09-05 — Trading Journal object model rejected outright, replaced with a link layer

**Decision:** Do not build a new Trading Journal object model inside Notebook. Journal 2.0's existing trade/position/verdict/review/intervention system (broker-synced, AI-coached) is authoritative; Notebook links to it.
**Alternatives:** Build the originally-proposed model (Trade → Thesis note → derived Position → Catalyst tags → Chart snapshots → post-exit Review note), benchmarked against TradeZella/Edgewonk/TraderSync.
**Evidence:** Direct schema/code verification: `j2_trades`/`j2_positions` (broker-synced, holdings-as-truth), `j2_verdicts` (structured pre-trade rationale), `j2_trade_reviews` (AI post-mortem), `j2_interventions` (4 live tilt rules) already ship every proposed component, more integrated than the cited external competitors, one tab from Notebook in the same shell (`JournalTwoRoot.jsx`). Phase Zero's own research never checked this — it benchmarked only external tools.
**Rationale:** Building any of these a second time would be a direct instance of this codebase's own named "second-authority-over-one-value" defect class. The only genuinely missing piece is a pre-trade Thesis note with no existing analog.
**Consequences:** The former large P1 "Trading Journal object model" item shrinks to a small link/cross-nav wave (implementation plan Waves 3 + 7).
**Reversibility:** The decision not to duplicate is effectively permanent (reversing it would require deliberately creating the duplication this decision exists to avoid). The link-layer implementation itself is normal, reversible feature work.
**Reconsider if:** never, absent a fundamental restructuring of Journal 2.0 itself that this program does not control.

---

### 2026-09-05 — "Ask My Notebook" splits into three tiers, only the first is P0

**Decision:** Ask Current Note is the true P0. Ask Notebook (corpus-wide) is P1. Ask Notebook + UCT (mixing personal notes with vendor data) is an Experiment, gated on the external legal review.
**Alternatives:** Keep the single P0-6 item as originally scoped, even after Appendix C's tenant-isolation correction.
**Evidence:** Two independent arguments converged: (1) Phase Zero's own persona-rejection research (§13/§23/§24) never names absent note-AI as a first-30-minutes or first-week switching blocker for any persona — the P0 placement traced to a competitive-parity argument, not the "foundation/switching-blocker" test the P0 tier itself claims to use; (2) the engineering shape of the corpus-wide version (new index, cost/latency budget, tenancy that must be proven, not just designed) doesn't match the "cheap, low-risk" shape every other P0 item has.
**Rationale:** A P0 in a foundation wave should be cheap and low-risk by definition; Ask Current Note is that shape (a copy of an already-proven pattern, zero new leak surface) and Ask Notebook is not.
**Consequences:** Implementation plan Wave 2 (Ask Current Note) ships in Stage A; Wave 6 (Ask Notebook) is Stage B, sequenced after the entity layer and fact ledger it depends on.
**Reversibility:** Fully reversible — a priority/sequencing call, not an architectural one.
**Reconsider if:** real usage data from Stage A shows members specifically asking for cross-note AI before other Stage-B work is ready — would argue for resequencing, not for abandoning the tiering itself.

---

### 2026-09-05 — Entity/mention model: three-tier CONFIRMED/STORED/SUGGESTED, stored join not a graph

**Decision:** Formalize the already-organically-converged-on model (explicit author tag = CONFIRMED; accepted embed = STORED; scanned-but-unconfirmed mention = SUGGESTED) as deliberate policy. Store the ticker↔note relationship as a committed join table, never a live-rescanned index or a general knowledge graph.
**Alternatives:** Fully automatic tagging (rejected); a derived/rescanned-at-read-time index (rejected); a general graph database (rejected).
**Evidence:** `/buzz`'s own documented history shows recall-biased auto-detection is correct for a public board and would be wrong once auto-committed to a personal note (a missed suggestion costs nothing; a wrong confirmed tag is real annoyance). A live-rescanned index would drift under universe churn (delistings/renames — UCT's own Model Book feature hit this exact problem independently for SQ→Block, WTW→Willis Towers Watson).
**Rationale:** Confirmed/hybrid for anything persisted, suggested/recall-biased for the detection pass feeding it — exactly what's already built, just never named as policy. A stored join is temporally stable by construction; a graph is unneeded complexity for a one-hop (plus theme) retrieval need.
**Consequences:** No graph-database investment anywhere in this program. The remaining build (implementation plan Wave 1) is a small extension, not new architecture.
**Reversibility:** Reversible in principle (nothing prevents a future graph layer) but the committed-join design is load-bearing for the reverse-index and would need real migration work to replace.
**Reconsider if:** real usage shows demand for multi-hop queries (e.g., "companies in the same supply chain") that a one-hop ticker/theme join genuinely cannot answer — tracked as the already-existing "full multi-hop knowledge graph" Experiment item, not reopened here.

---

### 2026-09-05 — Temporal semantics: explicit four-state contract, not "freeze everything"

**Decision:** Every financial content type is classified LIVE / SNAPSHOT / LIVE+ORIGINAL-SNAPSHOT / REFERENCE-ONLY, per an explicit governing test (safe to re-fetch live only when the source has a genuine point-in-time query).
**Alternatives:** A blanket "freeze everything at insert" rule, as an early framing of the moat implied.
**Evidence:** Direct verification: charts are already correctly hybrid (frozen anchor + capped live opt-in, per-timeframe reconstruction ceiling); watchlist/scanner are correctly full-freeze (re-running would silently change which tickers even appear — verified as already the right call, not reopened); analyst estimates have **no capture path at all** today (inverting the "highest-danger block" framing from "harden existing" to "build new"); the Calendar embed has a real, live, previously-unflagged bug (`reconstructable: true` unconditional, wrong for a pre-event capture reopened after the event resolves).
**Rationale:** A single blanket rule would either over-freeze content that should legitimately stay live (making the product feel stale) or under-freeze content that must never silently rewrite a member's historical decision context (corrupting the core trust claim). The four-state model, with an explicit test, generalizes correctly to every content type examined so far.
**Consequences:** Implementation plan Wave 5 builds the analyst-estimates capture path as new work (not a hardening task) and fixes the Calendar bug as a small, scoped, isolated change.
**Reversibility:** The model itself is durable; individual content-type classifications can be revisited as new types are added.
**Reconsider if:** a future content type doesn't cleanly fit one of the four states — extend the model deliberately rather than forcing a fit.

---

### 2026-09-05 — Provenance: object-level, extending an existing idiom, not a new system

**Decision:** Provenance is stamped at the object level (an attrs bag, by the mechanism that inserts content) — not block-level prose tagging, not citation-level inline markup, not a single note-level field.
**Alternatives:** Citation-level inline markup (Notion Research-Mode style); block-level tagging of arbitrary prose spans.
**Evidence:** Three independent existing precedents at this exact granularity: `widgetEmbed` attrs (`mode`/`captured_at`), `j2_chat_messages.role`, `modelbook_catalysts.source`. No block-level precedent anywhere in the codebase.
**Rationale:** The work is extending an idiom to two more insertion paths (quoted excerpts, AI synthesis), not designing a new system. Citation-level markup would fight the "quick jot" UX principle and has no existing infrastructure to build on.
**Consequences:** No new provenance system to design or maintain; citations belong specifically inside an Ask My Notebook answer's rendering, not the note body.
**Reversibility:** Reversible in principle; low cost either way since the extension is small.
**Reconsider if:** a future capability (e.g., multi-source AI synthesis spanning many cited passages) genuinely needs finer granularity than one object-level attrs bag can express.

---

### 2026-09-05 — Search evolution: lexical+entity before semantic/vector, evidence-gated

**Decision:** Vectors are the last stage of search evolution (implementation plan Wave 4 → 6 → Experiment), built only once usage telemetry shows lexical+entity actually fails a measurable fraction of real queries.
**Alternatives:** Build semantic search early/in parallel with lexical improvements, as an implicit assumption in some framings.
**Evidence:** FTS5 already works and is comfortably within RAIL/Nielsen targets for search-as-you-type; a trader/analyst's actual retrieval habit is entity- and time-anchored ("what did I write about NVDA," "before the Fed meeting"), which lexical+entity answers directly and cheaply; the narrower residual class vectors solve (queries with no shared vocabulary or named entity) is real but unproven to be common.
**Rationale:** Building embedding infrastructure ahead of measuring whether the cheaper layer has a real gap is exactly the kind of premature investment this program's evidence-integrity discipline exists to prevent.
**Consequences:** No vector-database work scheduled in Stage A or B; Wave 4's read-latency benchmark is the actual gating measurement.
**Reversibility:** Fully reversible — a sequencing decision.
**Reconsider if:** the Wave 4 benchmark or post-launch telemetry shows lexical+entity failing a measurable, real fraction of queries.

---

### 2026-09-05 — Thesis model: note + tag + read-time diff view, no new object

**Decision:** Thesis is a `j2_notes` row tagged `"thesis"` with ordinary body content for substantive fields, citing `j2_verdicts` as an evidence source, with "what changed" computed as a read-time diff over the fact ledger — not a new `j2_theses` table.
**Alternatives:** A dedicated first-class Thesis object/table with structured fields.
**Evidence:** A dedicated table would contradict the Core UX Constitution principle (every structural concept is opt-in scaffolding on a plain note, never a mandatory form). `j2_notes` has no properties/custom-fields system today, and `j2_verdicts` already covers "structured, AI-assisted trade rationale" — a naive Thesis object would re-plow that ground.
**Rationale:** The smallest architecture that supports every required capability (history via version history, assumptions/evidence as body content, diff as a query, AI analysis as a tag-filtered retrieval slice) without new storage.
**Consequences:** No properties-engine investment; the `tags: ["thesis"]` convention reuses an idiom already shipped for `"quote"`.
**Reversibility:** Reversible — a heavier object model could be introduced later if real usage demands structured fields a tag+prose model can't express.
**Reconsider if:** members consistently need to query/filter on structured thesis fields (e.g., "all theses with risk X") in ways prose content can't support well.

---

### 2026-09-05 — Account-deletion purge: fixed and deployed, not merely scheduled

**Decision:** Fixed a live data-lifecycle defect (none of 60+ `j2_*` tables were reachable by the generic account-deletion cascade) via a new, bounded `account_purge.py` module, on its own branch off current `master` (not the pinned research branch), merged and pushed directly to `master` given `master` was already checked out in another worktree.
**Alternatives considered and rejected:** (a) add real database-level foreign keys to every `j2_*` table (rejected — requires a full-table-rebuild migration in SQLite for existing tables, out of the explicitly bounded scope, and broader than the fix needs to be); (b) fix only Notebook-specific tables and leave the broker-purge gap (9 of 14 `j2_broker_*` tables also missed) for later (rejected — same shape of defect, same fix mechanism, cheaper to close both at once than to reopen this work later).
**Evidence:** Independently re-verified by executing the actual schema (zero `REFERENCES users`/`FOREIGN KEY` declarations across the family) and the actual cascade-discovery query, in an isolated sandbox, before writing any fix. A comprehensive, schema-driven regression test proven discriminating (red pre-fix via monkeypatch, green post-fix).
**Rationale:** This is a present-tense compliance/data-lifecycle exposure, not a roadmap item — it does not wait for the Notebook program's normal sequencing, and every new capture surface this program ships compounds it if left unfixed.
**Consequences:** Trust principles (Constitution §2 item 5) and Stage-A entry criteria now reflect this as done. `account_purge.py`'s table list becomes the enforcement point for every future `j2_*` table — a structural requirement (architecture §3.4, §20) that any new table must be added to it in the same commit that creates it.
**Reversibility:** The fix itself is a normal, revertible code change (two call sites + one new module). The underlying compliance exposure it closes should not be reintroduced — any future table added to the schema without corresponding purge coverage silently reopens it.
**Reconsider if:** never, as a direction — only extend coverage (never remove it) as the schema grows.

---

### 2026-09-05 — Master-branch reconciliation: merge, not rebase; direct push to the remote ref

**Decision:** For the account-deletion fix, merged `origin/master`'s 3 unrelated new commits into the fix branch (rather than rebasing), then pushed the fix branch directly to the `master` ref (`git push origin HEAD:master`) rather than locally checking out `master`, because `master` was already checked out in a different, active worktree (`entity-master`) that this program's own crash-recovery directive requires leaving undisturbed.
**Alternatives:** Rebase onto master (rejected — rewrites commit history for no benefit here, and this repo's own conventions favor merge commits for branch integration); locally check out and merge into `master` in the current worktree (impossible — git disallows the same branch checked out in two worktrees simultaneously) or in the `entity-master` worktree (rejected — would touch another session's active work).
**Evidence:** `git worktree list` confirmed `master` checked out at `entity-master`, modified as recently as the same day.
**Rationale:** Achieves the same end state (the fix lands on `master`, deployed) without any risk to unrelated in-progress work in another worktree.
**Consequences:** None beyond the mechanical git history shape (a merge commit exists on `master` for the 3 unrelated commits + this fix, rather than a linear rebase).
**Reversibility:** N/A — a completed git operation, not an ongoing decision.
**Reconsider if:** never — this was a one-time mechanical choice, not a standing policy, though the same reasoning (check `git worktree list` before assuming you can check out a branch) applies to any future push-to-master need from this or another worktree.

---

## Open Questions Carried Forward

See `primary-platform-master-product-spec.md` §7-8 and the Phase One artifact's own Open Questions section for the full list. Highest-priority, restated here for durability:

1. **Does the professional-analyst/PM persona's real competitive set include Notion/Evernote/Obsidian at all, or is it Excel/Bloomberg/FactSet/internal wikis?** Needs signup-source/usage data. Gates further investment in that persona (see the dedicated decision entry above).
2. **Is a sell-side/buy-side analyst permitted to put employer-owned research in a personal consumer SaaS notebook?** Unexamined by any prior research pass; plausibly disqualifying for that persona regardless of features built.
3. **Is this codebase's current SQLite usage compatible with a SQLCipher-style whole-database encryption approach** that wouldn't break FTS5 search? The Wave 10 design spike's first deliverable.
4. **Is `tradeRef` on widget embeds actually populated by any current frontend writer, or unwired scaffolding?** Confirm before Wave 3 treats it as partially-built.
5. **Real usage telemetry: how many current Notebook users have >100 notes in one folder?** Bears directly on how urgent the Wave 0 folder-sidebar fix is in practice vs. in principle (though the fix ships regardless, given it's cheap and a genuine correctness bug).
6. **Could a determined Notion/Obsidian power user approximate the "Ask Notebook + UCT" fusion moat via existing agent/connector features?** Plausible, unchecked against current competitor capability documentation — bears on how durable that Experiment item's differentiation claim is if it's ever unblocked.
7. **Does real member demand exist for the narrower bookmarklet-first financial-capture-extension**, specifically, versus the rejected general clipper? Untested — the Experiment item's own validation step is designed to answer this cheaply before further investment.
