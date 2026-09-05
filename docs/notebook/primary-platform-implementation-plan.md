# UCT Notebook — Primary-Platform Implementation Plan

**Status:** Phase Two. Defines *when* and *in what order*, per `primary-platform-master-product-spec.md` (what/why) and `primary-platform-master-architecture.md` (how). Waves are rebuilt from dependencies, not inherited from Phase Zero's original numbering. **This document does not authorize implementation to begin — per the governing directive, Phase Two ends with a report back for review, not an automatic Wave 0 start.**

**No endless hardening (standing rule for every wave below):** once a wave's defined contract is proven, the member outcome passes, important failure modes are tested, performance is acceptable, and production behavior is verified — freeze that scope and move forward. Reopen only for a real defect, a regression, new evidence, or explicitly authorized scope expansion.

---

## 1. Critical Path

```
[DONE] Wave -1: Account-deletion purge (no dependency, shipped, live in production)
   │
   ▼
Wave 0: Trust Foundation ──────────────────────────────────┐
   │ (trash/undo, folder-sidebar fix, search verification,  │
   │  local draft safety net — all independent of each other)│
   ▼                                                          │
Wave 1: Capture Completion ◄──────────────────────────────────┘
   │ (Save-to-Notebook destination menu + comment + tradeRef;
   │  entity-layer remaining slice — independent sub-items)
   ▼
Wave 2: AI Foundation (Ask Current Note) ──┐
   │                                        │
   ▼                                        │
Wave 3: Thesis-Trade Link ◄─────────────────┘ (needs tradeRef from Wave 1)
   │
   ▼
═══ STAGE A GATE — Primary Notebook Beta ships ═══
   │
   ▼
Wave 4: Search Evolution I (needs Wave 1's entity layer)
   │
   ▼
Wave 5: Financial Snapshot Completion (fact ledger — shared prerequisite)
   │                              │
   ▼                              ▼
Wave 6: Ask Notebook        Wave 7: Thesis Changelog + Trading Journal Link
   │ (needs Wave 4 + 5)          │ (needs Wave 5's fact ledger)
   │                              ▼
   │                       Wave 8: Per-Ticker Research Surface
   │                              │
   └──────────────┬───────────────┘
                   ▼
   Wave 9: Version History  ──┐ (independent, can run in parallel with 6-8)
   Wave 10: Encryption Spike ─┤ (independent, can run in parallel)
   Wave 11: Deletion Self-Serve UX ─┘ (independent, purge mechanism already done)
                   │
                   ▼
═══ STAGE B GATE — Financial Research System of Record ═══
                   │
                   ▼
Wave 12 (opportunistic, no strict ordering): offline read-cache, mobile capture, collaboration boundary primitive
                   │
                   ▼
═══ STAGE C — evidence gathering, not a build wave (see §5) ═══
```

**The critical path is the fact ledger (Wave 5), not the AI feature (Wave 6)** — building thesis-changelog or Ask-Notebook features against non-snapshotted data would require rebuilding them once temporal correctness lands, so the snapshot-semantics prerequisite must land once, early, correctly (mirrors Phase Zero's own §35 conclusion, re-confirmed by Phase One).

---

## 2. Vertical Slice Requirement

Every wave below ships in vertical slices — schema/foundation → backend → frontend → real member flow → test → deploy → verify — never a multi-wave invisible infrastructure project with no member-facing output until the end. Where a wave's architecture genuinely needs a shared foundation (e.g., the fact ledger), the foundation slice itself still ships attached to the smallest real capability that needs it (the Calendar-embed bug fix, in Wave 5's case), not built in isolation ahead of any visible use.

---

## 3. Waves

### Wave -1 — Account-deletion purge [DONE, live in production]

| Field | Value |
|---|---|
| Member outcome | A deleted account's Journal 2.0/Notebook data is actually removed, not silently retained |
| Persona | All (platform-wide, not Notebook-specific) |
| Features | `account_purge.py` wired into both deletion endpoints; docstring correction on `_cascade_delete_user` |
| Non-goals | Self-serve trigger/SLA (Wave 11); any schema redesign |
| Dependencies | None |
| Architectural prerequisites | None |
| Security/privacy prerequisites | This *is* the security/privacy fix |
| Rights status | Rights-independent |
| Performance gate | N/A (deletion is rare, not on a hot path) |
| E2E gate | `tests/test_journal_two_account_purge.py` — schema-driven, proven discriminating (verified red pre-fix via monkeypatch, green post-fix) |
| Production gate | Verified — post-deploy uptime reset confirmed live (commit `dd66bbb59`) |
| Rollback | Revert the two call sites in `auth.py`; the purge module itself is inert if uncalled |
| Estimated complexity | Small (was miscosted as large before direct verification — the hard part, the discovery mechanism, already existed correctly for other tables) |
| Expected user value | Trust/compliance foundation — a precondition for every capture-heavy feature below, not a feature itself |

### Wave 0 — Trust Foundation [Stage A]

| Field | Value |
|---|---|
| Member outcome | A member can delete-and-recover a note; the sidebar never lies about what exists; a closed tab doesn't lose unsaved work |
| Persona | All |
| Features | Note trash + undo-delete (P0-1); folder-sidebar correctness fix (P0-2); search read-latency benchmark (verification only, no build); local draft safety net (P1-10, near-free, pulled forward) |
| Non-goals | Version history (Wave 9); bulk-restore UI polish |
| Dependencies | None |
| Architectural prerequisites | `deleted_at` column on `j2_notes`; per-folder server-side count endpoint (architecture spec §3.2) |
| Security/privacy prerequisites | Soft-deleted rows must remain covered by `account_purge.py` (confirmed already true — no change needed) |
| Rights status | Rights-independent |
| Performance gate | Folder-count query must not regress sidebar load latency; benchmark FTS5 read path at 5k/20k/100k **platform-wide** rows before declaring search "proven at scale" |
| E2E gate | Delete → restore → content/embeds/tags intact; a folder whose notes sort past position 100 shows a correct nonzero count; closing a tab mid-edit and reopening recovers a draft |
| Production gate | Zero "deleted note, can't recover" support tickets over 30 days post-ship; folder counts match direct queries at real production note counts |
| Rollback | Feature-flag the trash UI; the underlying soft-delete column is additive and harmless if the UI is rolled back |
| Estimated complexity | Low-medium (trash), low (folder fix — a proven pattern already exists in the same file), low (local draft — client-only) |
| Expected user value | Removes the single most damaging first-week failure mode identified for the highest-value, hardest-to-convert persona (Obsidian switchers hitting the sidebar bug during their own self-verification) |

### Wave 1 — Capture Completion [Stage A]

| Field | Value |
|---|---|
| Member outcome | Save-to-Notebook gains an optional destination choice and comment; "everything about NVDA" actually includes prose-only mentions |
| Persona | All (capture); trader/investor (entity layer) |
| Features | Wire the existing `targetsFor()`/`CAPTURE_TARGETS` menu onto the 9 capture buttons (P1-1); comment field on capture; complete `tradeRef` wiring; entity-layer remaining slice — sector/earnings-window join, theme-membership join, persist SUGGESTED mentions, class-share cashtag fix (P0-3) |
| Non-goals | A new capture mechanism (none needed — the hard part already shipped); a general knowledge graph |
| Dependencies | None |
| Architectural prerequisites | None new — extends existing, already-proven infrastructure |
| Security/privacy prerequisites | Entity join must use the existing 24h ticker-metadata cache, never an unbounded per-request external call |
| Rights status | Rights-independent |
| Performance gate | Entity join adds no measurable latency to note save; capture menu adds zero friction to the default one-click path |
| E2E gate | A prose-only NVDA mention (no embed) appears in NVDA's reverse-index; `$BRK-B` resolves correctly; a captured widget can carry a destination choice and a comment |
| Production gate | False-positive rate on fundamental-analyst vocabulary (ROIC/EBIT/FCF/WACC/CAGR) measured, not merely swing-trader vocabulary |
| Rollback | Destination menu is additive UI, revertible independently of the entity-layer work |
| Estimated complexity | Low (this whole wave was miscosted as larger before Phase One found most of it already shipped) |
| Expected user value | Closes the gap between "what Phase Zero described as needed" and "what's actually already built," at near-zero net-new engineering cost |

### Wave 2 — AI Foundation: Ask Current Note [Stage A]

| Field | Value |
|---|---|
| Member outcome | A member asks a question about the note they're looking at and gets a grounded, cited answer |
| Persona | All |
| Features | Ask Current Note (P0-5), per architecture spec §8.1 |
| Non-goals | Cross-note retrieval (Wave 6); any new index |
| Dependencies | None |
| Architectural prerequisites | None — copies `ai_search_personal.py`'s existing pattern |
| Security/privacy prerequisites | No cross-user data path exists in this scope — verify the existing `get_note` ownership check is the only gate needed |
| Rights status | Rights-independent |
| Performance gate | Reuse existing cost/latency-cap infrastructure (`reserve_synth`/`refund_synth`) — no new budget design needed |
| E2E gate | Zero fabricated facts not present in the open note, measured via the existing grounding-audit pattern |
| Production gate | Per-user/global daily cost caps enforced and observable |
| Rollback | Feature flag; no schema change to roll back |
| Estimated complexity | Low — a copy-the-shape job against proven infrastructure |
| Expected user value | Ships the "UCT has AI on my notes" signal cheaply, without the tenancy/index risk of the corpus-wide version |

### Wave 3 — Thesis-Trade Link [Stage A]

| Field | Value |
|---|---|
| Member outcome | A thesis note links to the real trade it produced |
| Persona | Active/swing trader (beachhead) |
| Features | Confirm/complete `tradeRef` wiring from Wave 1; cross-nav UI between a note and its linked `j2_trades`/`j2_positions` row; a pre-trade Thesis-note authoring flow (the one piece with no existing analog) |
| Non-goals | Any new trade/position/review schema — `j2_trade_reviews` already covers the post-exit review case |
| Dependencies | Wave 1's `tradeRef` completion |
| Architectural prerequisites | None — architecture spec §11's link-only design |
| Security/privacy prerequisites | None beyond existing ownership checks |
| Rights status | Rights-independent |
| Performance gate | N/A |
| E2E gate | Opening a thesis note jumps to its linked trade and vice versa; zero duplicate trade/position storage created |
| Production gate | Confirm `j2_trade_reviews`' existing AI post-mortem is recognized by members as satisfying the "review my trade" job (informal check before Wave 7 builds anything further here) |
| Rollback | Link is an additive attribute; safe to disable the UI without data loss |
| Estimated complexity | Low |
| Expected user value | Stage A's concrete "one financial advantage" beyond Ask Current Note — closes the screener→thesis→trade→review loop with real, not duplicated, data |

**═══ STAGE A GATE — Primary Notebook Beta ships. See §5 for the validation plan before proceeding past this point. ═══**

### Wave 4 — Search Evolution I [Stage B]

| Field | Value |
|---|---|
| Member outcome | Search actually answers "notes from March" and shows why a result matched; entity/date-anchored retrieval works without vectors |
| Persona | All |
| Features | FTS5 read-latency benchmark at platform-wide scale (Stage 0, architecture §7); date-range filter; `snippet()`/`highlight()` wired; entity-anchored retrieval (Stage 1) |
| Non-goals | Semantic/vector search (Wave 12+/Experiment, evidence-gated) |
| Dependencies | Wave 1's entity layer |
| Architectural prerequisites | None new |
| Security/privacy prerequisites | None beyond existing per-user `MATCH ... AND user_id = ?` scoping |
| Rights status | Rights-independent |
| Performance gate | Read-path benchmark must complete and inform whether Wave 6 needs additional hardening before it ships |
| E2E gate | A date-range query and an entity-anchored query ("NVDA, before the Fed meeting") both return correct results |
| Production gate | Read latency acceptable at measured platform-wide scale |
| Rollback | All additive; no risk to existing search behavior |
| Estimated complexity | Low |
| Expected user value | Closes the largest lexical-search gaps before any AI/vector investment — likely solves most real retrieval jobs on its own |

### Wave 5 — Financial Snapshot Completion [Stage B]

| Field | Value |
|---|---|
| Member outcome | Analyst estimates/ratings/price targets can be captured into a note at all (they cannot today); a pre-earnings note never silently shows post-earnings results |
| Persona | All, especially thesis-writing personas |
| Features | New capture path for the Analyst/Ownership panel (genuinely new-build, not an extension — P0-4); the append-only fact ledger; the Calendar-embed forward-looking bug fix |
| Non-goals | The revision-count indicator UI (fast-follow, not required for this wave) |
| Dependencies | None for the capture path; none for the fact ledger's first use (this wave IS its first use, per the vertical-slice rule) |
| Architectural prerequisites | The temporal content contract (architecture §5) — every new content type classified before being built, not after |
| Security/privacy prerequisites | None beyond existing embed-attrs pattern |
| Rights status | Rights-independent (this is UCT's own already-licensed data, displayed/captured the same way every other widget already is) |
| Performance gate | N/A |
| E2E gate | An estimate captured today reads the same value a month later, with the exact value shown as-of capture, regardless of later revisions; a Calendar embed captured before an earnings print does not silently flip to post-print data |
| Production gate | Zero live exposure of the temporal-correctness bug this wave fixes |
| Rollback | New capture path is additive; the Calendar fix is a small, isolated gate change |
| Estimated complexity | Medium (the capture path is genuinely new-build, not a hardening task as originally miscosted) |
| Expected user value | Makes the flagship temporal-correctness moat claim real rather than aspirational — the highest-stakes remaining piece of the whole program's core differentiator |

### Wave 6 — Ask Notebook [Stage B]

| Field | Value |
|---|---|
| Member outcome | A member asks a question across their whole notebook and gets cited, grounded, correctly-scoped answers |
| Persona | All, highest value at real note volume |
| Features | Per-user-keyed retrieval (architecture §8.2); lexical+entity basis only, no vectors; deletion-propagation trigger + async reindex queue; citations via `snippet()`/`highlight()` |
| Non-goals | Semantic/vector layer; "+UCT" scope (rights-gated, separate) |
| Dependencies | Wave 4 (entity-anchored retrieval) + Wave 5 (fact ledger) |
| Architectural prerequisites | Tenancy design proven BEFORE any candidate selection runs — never `brain_kb_service.py`'s shared-matrix-then-filter shape |
| Security/privacy prerequisites | **Hard gate:** a cross-user leakage test must pass before this wave is considered done — candidates selected by `user_id` before any similarity computation, verified by test, not by code review alone |
| Rights status | Rights-independent (notes-only scope; no vendor data mixed in) |
| Performance gate | Per-user-keyed matrices LRU-evicted/load-on-demand — verified under a simulated concurrent-active-user load, not just correctness-tested |
| E2E gate | Cross-note query returns correctly-cited results; zero cross-user leakage under adversarial test; the Freshness-Firewall prompt clause is confirmed NOT copied from `ai_search_personal.py` |
| Production gate | Cost/latency within the reused cap infrastructure's budget at real usage |
| Rollback | Feature flag; the retrieval index itself is rebuildable, not load-bearing for any other feature |
| Estimated complexity | Medium-high — the one item in this plan closest to genuine greenfield engineering |
| Expected user value | The corpus-wide AI differentiation the whole "financial research system of record" positioning depends on — correctly sequenced after the trust/entity/temporal foundation, not before it |

**Cross-cutting requirement on this wave (architecture §8.4, §8.5):** must integrate with or explicitly reconcile against Compass's existing tool registry; must ship citation-verification as its own testable sub-deliverable, not an implicit property of "cited."

### Wave 7 — Thesis Changelog + Trading Journal Link Completion [Stage B]

| Field | Value |
|---|---|
| Member outcome | A thesis note shows what's changed since it was written; the trade-journal link from Wave 3 works for every trade, not just the pre-trade case |
| Persona | Trader/investor holding an active thesis |
| Features | `tags: ["thesis"]` convention; read-time diff view over the fact ledger; citing `j2_verdicts` as an evidence source; completing the cross-nav layer beyond Wave 3's pre-trade slice |
| Non-goals | A new Thesis object/table; proactive alerting |
| Dependencies | Wave 5's fact ledger |
| Architectural prerequisites | None new |
| Security/privacy prerequisites | None beyond existing note ownership |
| Rights status | Rights-independent |
| Performance gate | N/A |
| E2E gate | "What changed since thesis creation" benchmark passes with real diffed values, not placeholder text |
| Production gate | None beyond E2E |
| Rollback | Additive tag convention; no schema change to roll back |
| Estimated complexity | Low |
| Expected user value | Closes the "did the thing I believed change" loop this audience specifically needs, using data the fact ledger already tracks |

### Wave 8 — Per-Ticker Research Surface [Stage B]

| Field | Value |
|---|---|
| Member outcome | "Everything I've written about NVDA" as one view |
| Persona | All |
| Features | Reverse-index query view (architecture §13), launching into `TickerPopup`/`EarningsResearchModal` for live content |
| Non-goals | Rebuilding chart/fundamentals rendering natively; owning a company page |
| Dependencies | Wave 1's entity layer |
| Architectural prerequisites | None new — mirrors the existing `SavedScreensPanel`/`ScanResults` pattern |
| Security/privacy prerequisites | None beyond existing ownership scoping |
| Rights status | Rights-independent |
| Performance gate | N/A — a query view, no new storage |
| E2E gate | Opening a ticker's research surface shows every note/thesis/trade touching it, and any live-content click launches the correct existing modal rather than re-rendering natively |
| Production gate | None beyond E2E |
| Rollback | Purely additive UI |
| Estimated complexity | Low |
| Expected user value | The other half of the "everything about NVDA" promise the entity layer makes possible |

### Wave 9 — Version History [Stage B, parallel-capable]

| Field | Value |
|---|---|
| Member outcome | Recover from an overwrite, not just a deletion |
| Persona | All, especially long-form authors |
| Features | `j2_note_versions` table (architecture §3.3), capped retention, diff/restore UI |
| Non-goals | Bulk diffing tools |
| Dependencies | None — can run in parallel with Waves 6-8 |
| Architectural prerequisites | **The new table must declare `user_id` and be added to `account_purge.py`'s coverage in the same commit that creates it** — a structural requirement, not optional, per the account-deletion finding |
| Security/privacy prerequisites | Confirmed covered by the account-deletion purge before this wave is considered done |
| Rights status | Rights-independent |
| Performance gate | Version-write overhead on save must not regress editor responsiveness (RAIL thresholds) |
| E2E gate | A restored version round-trips correctly; a deleted account's version rows are actually purged |
| Production gate | Storage growth tracked against the capped-retention policy |
| Rollback | Feature flag; underlying table is additive |
| Estimated complexity | Low-medium |
| Expected user value | The third of the three named trust-parity bars (Constitution §2 item 11), sequenced deliberately after search/trash |

### Wave 10 — Encryption-at-Rest Design Spike + Build [Stage B, parallel-capable]

| Field | Value |
|---|---|
| Member outcome | Note content encrypted at rest without breaking search |
| Persona | All, especially Obsidian-switchers |
| Features | Design spike first (architecture §3.5 — resolve the FTS5 conflict before sizing this as a normal build); then implementation per the spike's chosen architecture |
| Non-goals | Client-side end-to-end encryption (not evaluated, out of scope unless the spike specifically recommends it) |
| Dependencies | None — can run in parallel with Waves 6-9 |
| Architectural prerequisites | The spike's own output is the prerequisite for the build half of this wave |
| Security/privacy prerequisites | This wave IS a security requirement |
| Rights status | Rights-independent |
| Performance gate | Search latency must not regress measurably post-encryption |
| E2E gate | Note content unreadable from a raw disk/DB dump; search still functional |
| Production gate | Key management verified against the existing `crypto_box.py` pattern's own production track record |
| Rollback | This is the one wave in this plan where rollback needs explicit design (decrypting data back out) — specify a rollback path as part of the spike's own deliverable, not as an afterthought |
| Estimated complexity | Unknown until the spike completes — **do not estimate the build without it** |
| Expected user value | Real trust value for the highest-trust-bar persona segment; the spike itself is the immediate deliverable, not a full build commitment |

### Wave 11 — Account-Deletion Self-Serve UX [Stage B, parallel-capable]

| Field | Value |
|---|---|
| Member outcome | A member can request and receive account deletion without an admin manually running an endpoint |
| Persona | All |
| Features | Self-serve trigger UI, a defined SLA |
| Non-goals | Any change to the purge mechanism itself (already correct, live) |
| Dependencies | None — the hard part (Wave -1) is already done |
| Architectural prerequisites | None new |
| Security/privacy prerequisites | Reuses the already-fixed, already-tested purge path — no new privacy design needed |
| Rights status | Rights-independent |
| Performance gate | N/A |
| E2E gate | A self-serve request completes within the stated SLA and produces the same purge report `account_purge.py` already returns |
| Production gate | None beyond E2E — the underlying mechanism is already production-verified |
| Rollback | UI-only; trivial |
| Estimated complexity | Low |
| Expected user value | Closes the remaining, now-small, gap in the deletion story |

**═══ STAGE B GATE — Financial Research System of Record. ═══**

### Wave 12 — Opportunistic, no strict ordering [Stage B/C boundary]

| Field | Value |
|---|---|
| Member outcome | A thesis note is checkable offline; mobile capture is possible; light sharing exists if validated |
| Features | Read-only offline cache (P1-9); mobile capture scoping (currently an untriaged gap — triage explicitly here, don't leave it silent); the account/team boundary primitive, only if collaboration demand is validated |
| Dependencies | None strictly, but naturally sequenced after Stage A ships (needs real usage to validate mobile/collaboration demand) |
| Rights status | Rights-independent |
| Estimated complexity | Low (offline cache), unknown (mobile capture, needs scoping first), unknown (collaboration boundary primitive) |
| Expected user value | Fills named-but-deferred gaps once Stage A/B usage data exists to prioritize among them |

---

## 4. Rights Classification

**Rights-independent — can proceed as soon as this plan is approved:** every wave above except the explicitly-noted Experiment item below.

**Rights-dependent, still gated:** "Ask Notebook + UCT" (mixing personal notes with FMP/Massive-sourced content in one AI-synthesized answer) — not scheduled as any numbered wave above; remains an Experiment item pending the external legal/data-rights review. This program does not reopen, investigate, or opine on that review — it is tracked here only as a gate.

---

## 5. Beta Member-Validation Plan (Stage A → Stage B gate)

**Cohort:** existing UCT active/swing traders — the confirmed beachhead persona, already inside Journal 2.0 + Compass + broker sync.

**Test whether they can:** capture a trading idea; write and organize research; retrieve it later; recover from an accidental delete; use Ask Current Note and judge whether its answers are trustworthy; connect a note to their actual trading workflow (Wave 3's thesis-trade link); save content from elsewhere in UCT.

**Measure:** task completion rate and time per Master Benchmark Suite task (product spec §9) that Stage A's build list actually covers; points of confusion; feature discovery (do members find the trash/restore flow without being told); repeat usage over the following weeks (does research actually accumulate, or is it a one-time trial); what, if anything, sends a tester back to their prior tool for a task Stage A claims to cover.

**Exit criteria for proceeding to Stage B:** Stage-A benchmark tasks pass at an acceptable completion rate for the beachhead persona; no trust-foundation regression (a trash/delete/recover failure would be disqualifying); qualitative signal that the trade-linked thesis note is understood and used, not ignored.

---

## 6. Analytics / Product-Learning Plan

Privacy-conscious, scoped to *whether workflows are adopted*, not invasive surveillance — consistent with the tenant-isolation invariants in the architecture spec.

**Instrument, starting at Stage A:**
- Feature usage per capability (capture, search, Ask Current Note, trash/restore) — aggregate counts, not content.
- Time-to-first-value (first successful capture → first successful retrieval).
- Search success — extend the existing "search with no satisfying click" idea (Phase Zero §24) with the Phase One refinement: **also track "result count materially below expected corpus size"** as a second leading indicator, since a click can register as "successful" while still under-serving a large-vault user (the Obsidian-switcher scale-gap failure mode).
- Save-to-Notebook usage frequency, by source widget.
- Recovery-flow usage (trash restore) — both a usage signal and a direct trust-foundation health check.
- Return/repeat usage over weeks, not just session-level engagement — the signal that actually distinguishes Stage A success from a one-time trial.
- Migration-to-active-use conversion, for any member who imported existing content.

**Persona-differentiated churn signals (Phase One's refinement to Phase Zero's single metric):** the Notion-migrated persona's likely day-2-3 failure is a *structuring* failure (can't build the view they need), not a retrieval failure — track filtered-view attempts with no satisfying result as a distinct event from failed search.

---

## 7. Master Benchmark Suite — acceptance criteria detail

See product spec §9 for the full mapped list. Acceptance criteria for the items with real ambiguity, per Phase One's findings:

- **"Save and annotate a chart":** confirm during Wave 1 whether drawing-tool overlays created on the live chart survive into a frozen embed — currently unverified in either direction, resolve before claiming this benchmark passes.
- **"Screener → saved research":** do not assume this passes because the snapshot-*semantics* are P0-scoped — the capture-*door wiring* for Scanner/Screener is not among the 9 confirmed widgets. Explicitly wire and test this door in Stage B before using it as evidence of the trading-journal moat.
- **"Verify AI citations":** needs the dedicated click-to-source affordance from architecture §8.5, tested independently — not satisfied merely by an answer that happens to cite sources in prose.
- **"Review a trade against the original plan":** check whether `j2_trade_reviews`' existing Compass output already satisfies this before building anything new in Wave 7 — likely already true.

---

## 8. Phase Two Quality Audit (self-review, per the governing directive)

- **Does architecture match product requirements?** Yes — every P0/P1 item in the product spec has a corresponding architecture section and a wave above; no orphans in either direction.
- **Are we duplicating existing UCT systems?** No — the Trading Journal rejection (Wave 3/7) and the UCT Surface Ownership Map (architecture §14) are the explicit mechanisms preventing this; applied to every wave above during drafting.
- **Did old Phase Zero assumptions sneak back in?** Checked against Phase One's corrections throughout — north star, beachhead, entity-layer sizing, snapshot-semantics framing, Ask-My-Notebook tiering, and the Trading Journal proposal all reflect the corrected state, not the original.
- **Are there unnecessary first-class objects?** No new Thesis table, no new Trading Journal schema — both explicitly rejected in favor of note+tag+link designs, per the Core UX opt-in-scaffolding principle.
- **Are tenant boundaries explicit?** Yes, per-wave where relevant (Wave 6 has a hard cross-user-leakage gate); architecture §20 states the invariant once, cross-cutting.
- **Are temporal semantics explicit?** Yes — the four-state contract (architecture §5) is applied to every content type discussed, including the two real bugs found (Calendar embed, analyst-estimates non-existence).
- **Is provenance explicit?** Yes — object-level, extending an existing idiom, scoped to what's actually missing (quoted excerpts, AI synthesis) rather than redesigned wholesale.
- **Is deletion covered?** Yes — and this program's own account-deletion finding is now a structural requirement baked into every future table (architecture §3.4, restated in Wave 9's prerequisites as a concrete instance).
- **Is export/portability preserved?** Yes — explicitly called out as a genuine strength not to regress, in both the spec and architecture docs.
- **Is performance planned?** Yes — concrete thresholds (architecture §15), not vague "at scale" language, including a newly-found blocking-migration risk with a stated mitigation.
- **Are Beta requirements too large?** Reviewed against Phase One's own finding that most of what looked like Beta-blocking work was already shipped — Stage A's build list (Waves 0-3) is deliberately small as a result.
- **Are any dependencies backwards?** Checked against the critical-path diagram (§1) — the fact ledger correctly precedes the features that need it, not the reverse.
- **Can early waves produce real user value?** Yes — Wave 0 alone (trash/restore, sidebar fix, draft safety net) is independently valuable and ships before any AI feature.

No corrections were needed to the other two documents as a result of this audit.
