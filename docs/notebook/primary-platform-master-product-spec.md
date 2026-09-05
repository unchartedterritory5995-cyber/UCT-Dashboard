# UCT Notebook — Primary-Platform Master Product Spec

**Status:** Phase Two. Translates Phase Zero research + the Evidence-Integrity Audit + Phase One's adversarial review into an executable product blueprint. This document defines *what* to build and *why*, for *whom*, in what order of value. See the companion `primary-platform-master-architecture.md` for *how*, `primary-platform-implementation-plan.md` for *when*, and `primary-platform-decision-log.md` for the record of how each call was reached.

**Evidence hierarchy used throughout:** (1) current verified product/code reality, (2) Phase One's corrected conclusions, (3) Phase Zero evidence not overturned by Phase One, (4) external evidence, (5) architectural inference, explicitly labeled. Every P0/P1 item below traces to a persona, a job, and cited evidence — no roadmap item exists because it "sounded useful."

**Pre-freeze reconciliation (completed):** `origin/master` advanced by 8 files since the research baseline (`54d7de266`) — 4 are this program's own account-deletion fix (now merged to master and live in production, see below); 4 are unrelated screener/pattern-engine shadow-canonical work (`api/services/screener/pattern_join.py` + its tests + a continuity-checkpoint doc), classified **NO IMPACT** on this spec. No assumption below needed re-verification.

**Material update since Phase One:** the account-deletion defect Phase One discovered (none of the 60+ `j2_*` tables reachable by the generic deletion cascade) is **FIXED and deployed to production** (commit `dd66bbb59` on `master`, verified live via a post-deploy uptime reset). This spec's Trust principles and Stage-A entry criteria reflect this as done, not outstanding.

---

## 1. Executive Summary

**North star:** the best financial research/knowledge system for active traders first, with a durable Notebook foundation capable of broadening later. Not a generic universal-notebook clone.

**Immediate product position:** financial research system of record — used *alongside* a member's general notebook (Notion/Evernote/Obsidian), not positioned to replace it on day one.

**Long-term ambition (not a Beta requirement):** UCT Notebook may eventually become complete enough to replace incumbents for our target financial users — earned through real member evidence at each stage, not assumed up front. "Used alongside" is the initial adoption strategy, not a permanent ceiling.

**Primary beachhead:** the active/swing trader already inside Journal 2.0 + Compass + broker sync — confirmed, not assumed, by direct inspection of the product's own existing templates and onboarding taxonomy (Phase One, North Star/Persona Challenge).

**Three product stages**, each with its own entry/exit criteria (§4):
- **Stage A — Primary Notebook Beta:** smallest coherent release, real member testing, one genuine financial-native advantage.
- **Stage B — Financial Research System of Record:** the beachhead persona increasingly treats UCT as the authoritative home for research, theses, and decision history, integrating rather than duplicating other UCT surfaces.
- **Stage C — Primary Notebook Ready:** measurable evidence a target financial member does not *need* an incumbent notebook for their important daily/research workflows — optional continued use for unrelated, out-of-scope workflows is fine; *required* use because of a UCT capability gap on an in-scope workflow means that workflow has not reached Stage C.

---

## 2. Product Constitution (corrected)

1. **Primary user:** the active/swing trader already inside Journal 2.0 + Compass + broker sync (primary beachhead). Serious individual investor / "PM of their own capital" — secondary, same infrastructure. Fundamental investor / equity researcher — secondary, served via the alongside model (capture/connector bridge into their real vault), not asked to relocate their research. Professional analyst / institutional PM — **later**, gated on two unresolved questions: (a) whether this persona's real competitive set is Notion/Evernote/Obsidian at all versus Excel/Bloomberg/FactSet/internal wikis, and (b) an unexamined employer/compliance risk (is a sell-side/buy-side analyst even permitted to put firm research in a personal consumer SaaS notebook?). Neither is a research gap this program can close alone — both need real usage/signup-source data and, for (b), a compliance answer.
2. **Primary job:** be the system of record for a member's tickers, positions, trades, and theses — used alongside their general notebook, not instead of it.
3. **Product promise:** the research/decision layer for the trading and investing workflow UCT members are already inside — not a clone of Notion, Evernote, or Obsidian, and not "Notion + Evernote + Obsidian + UCT Intelligence" as originally framed.
4. **Core UX principles:** default simple, advanced optional. Every structural concept (thesis, provenance, entity tagging) is opt-in scaffolding on a plain note, never a mandatory form. This is a hard constraint on every capability below — it is why Thesis Intelligence is a note+tag, not a new object, and why entity tagging is suggested, never silently automatic.
5. **Trust principles:** self-verifiable proof beats vendor assertion — for financial notes captured/brought into UCT specifically (not "your whole migrated vault," which is a more expensive claim the alongside model doesn't need to make). A trash can and search that actually works are non-negotiable before "system of record" positioning is credible. **A verifiable, working account-deletion purge is equally non-negotiable — this was false until this program's own research found and fixed it (now live in production); any future capture surface must be designed so it, too, is covered by that purge, not bolted on separately.**
6. **Data/provenance principles:** every embedded live-data block snapshots by default; live is an explicit, visually distinct opt-in, never silent. The "as-of" truth of a note must never be silently rewritten by a data update. Provenance is object-level (an attrs bag stamped by the mechanism that inserts content), extending an idiom already used three times elsewhere in this codebase — not a new system to design.
7. **AI principles:** never invent a fact not present in cited notes/data. Distinguish MY THOUGHT / SOURCE FACT / AI SYNTHESIS / LIVE DATA structurally, not just in prose. Assistive, never decisional, for anything resembling thesis judgment. **Ask My Notebook must not become a second, disconnected AI chat surface** — it exposes note retrieval as tools inside Compass's existing registry, or is explicitly reconciled against Compass on which surface answers which question, so a member never faces three uncoordinated systems answering "should I trust this trade."
8. **Financial research principles:** temporal correctness is not optional for this audience — a note is admissible evidence of what was believed and known at the time. Applies per content type via an explicit typed contract (LIVE / SNAPSHOT / LIVE+SNAPSHOT / REFERENCE-ONLY, §7 of the architecture spec), never a blanket "freeze everything."
9. **Portability principles:** export must remain real and round-trip-verified (already true, independently re-verified — disk-streaming, concurrency-limited, hardened against a prior OOM incident). Genuine current advantage over Evernote specifically; must never regress.
10. **Performance principles:** grounded in RAIL/Nielsen thresholds, not invented numbers. Track platform-wide metrics explicitly, not only per-user note-count tiers — several real risks (FTS5 read cost, a future blocking reindex migration) scale with total platform activity, not any one member's library size.
11. **What we will match:** reliable search, a trash can, real export. Version history is P1, not P0 — a deliberate sequencing call (search/trash are the two failure modes members hit *first*; version history matters more once real usage accrues), not an oversight; stated explicitly here so it is a decision, not a silent gap.
12. **What we will exceed:** temporal correctness for financial data (no competitor has this at all) — currently proven for one narrow slice (intraday chart embeds) and the target, not yet the universal current state; integration of live market data into research notes.
13. **What we will not build:** a general web clipper, a full third-party plugin marketplace, enterprise collaboration depth, one-click full-migration rollback, a Notion-style external developer Agents platform. **Narrower carve-outs inside these categories are not blanket-rejected:** a bookmarklet-first financial-research capture extension, and a scoped single-import-batch undo, are Experiment-worthy — see §8.
14. **Our strategic moat:** the frozen-at-insert pattern, extended universally (target state, not current — see architecture spec §7), plus the accumulated, accurately time-stamped personal research history it produces. This is a **compounding/retention** moat, not an acquisition one — it is invisible to a member in their first 30 minutes, and the roadmap must not conflate "we will have the strongest long-run moat" with "we have the strongest reason to switch today." The acquisition case rests on trust/parity items (search, trash, export) instead.
15. **Definition of "Primary Notebook Ready":** see Stage C (§4.3). A member's *optional, chosen* continued use of an incumbent notebook for workflows outside this program's target scope (general note-taking, unrelated projects) is a legitimate success state, not a failure to fix. A member's *required* return to an incumbent because UCT cannot do an in-scope target-persona workflow is not — that specific gap has not reached Stage C, and the ultimate ambition remains that a serious trader/investor/researcher eventually has no important reason to leave UCT for a generic notebook.

---

## 3. Personas (final)

| Persona | Status | Rationale |
|---|---|---|
| **Active/swing trader** | **PRIMARY BEACHHEAD** | Confirmed by direct inspection: Notebook's 8 templates and Compass's 10-category onboarding taxonomy are entirely trader-ritual-shaped. Highest pain, highest frequency, lowest incumbent dependency, highest AI/monetization fit, product already built for them. |
| **Serious individual investor / "PM of own capital"** | **SECONDARY** | Same infrastructure (broker sync, `portfolio_heat.py`, `personal_edge.py`), low incremental cost to serve well. |
| **Fundamental investor / equity researcher** | **SECONDARY, alongside model only** | Real value (thesis-tied live snapshots), but their real incumbent dependency (relational databases/Bases) isn't something to chase head-on. Right motion: capture bridge into their real vault. |
| **Institutional/professional analyst, institutional PM** | **LATER** | No team/permissions/audit infrastructure exists at all. Employer-compliance risk unexamined and plausibly disqualifying. Competitive-set question (Notion/Evernote/Obsidian vs. Excel/Bloomberg/FactSet/internal wikis) unresolved. Gate on real usage data before investing further. |
| **Casual dashboard user (occasional note)** | Not a gap — already served | The existing, unflagged Save-to-Notebook door already serves this persona; proof the alongside model works in production today. |
| **Investment club / small research team** | Experiment/Validate-First | Zero evidence either way; qualitatively different (multi-author) need if real. |

---

## 4. Three-Stage Product Definition

### 4.1 Stage A — Primary Notebook Beta

**Definition:** the smallest coherent release where a member of the primary beachhead persona can reliably **capture → write → organize → search → link → retrieve → recover → export → save from UCT**, and receive at least one concrete, currently-absent financial advantage — valuable enough for real user testing, without requiring the ultimate roadmap first.

**Already true today (no build required):** capture (9 widget doors, live), write (strong editor, verified), organize (folders+tags), export (verified round-trip, genuinely strong), save from UCT (live).

**Required to enter Stage A (the actual build list):**
- Note trash + undo-delete (P0-2)
- Folder-sidebar correctness fix (P0-3b) + search-latency verification (P0-3a, due diligence only)
- Derived entity/mention layer's remaining slice — sector/earnings-window join + persist suggested mentions + class-share cashtag fix (P0-4)
- A trade-linked thesis note — the one link/cross-nav piece with no existing analog (small slice of the former "trading journal object model," P1, pulled forward because it's cheap and is Stage A's "one genuine financial advantage")
- Ask Current Note (P0-6) — cheap, reuses an existing pattern, ships the AI advantage
- Save-to-Notebook's remaining small maturation (destination-menu wiring, comment field — P1, small enough to fold into this wave)

**Stage A does NOT require:** Ask Notebook (corpus-wide), encryption at rest, version history, universal snapshot semantics beyond the entity/temporal work above, or any collaboration feature.

**Entry criteria:** all items above shipped, real-E2E verified (see implementation plan gates).
**Exit criteria / evidence:** Stage-A benchmark tasks (§6) pass in real usage with the beachhead persona; see the implementation plan's Beta Member-Validation Plan.

### 4.2 Stage B — Financial Research System of Record

**Definition:** the beachhead persona increasingly treats UCT as the authoritative home for ideas, research, charts, saved evidence, theses, watchlist research, company research, earnings prep, filing/transcript notes, decision history, trade context, and post-trade learning — with UCT integrating authoritative data from other UCT systems (Journal 2.0, Terminal, Screener) rather than duplicating ownership of any of it.

**Build list:** Ask Notebook (P1, corpus-wide, lexical+entity basis, no vectors yet), universal snapshot semantics' remaining piece (the analyst-estimates/ratings capture path — genuinely new, not an extension — plus the append-only fact ledger), the Calendar embed's forward-looking bug fix, thesis changelog (note+tag+diff view, citing `j2_verdicts`), the Trading-Journal link/cross-nav layer completed (beyond Stage A's thesis-link slice), per-ticker research surface, version history, encryption at rest (gated on a design spike resolving the FTS5 conflict), account-deletion self-serve trigger + SLA (the underlying purge mechanism is already fixed — see §2 item 5 — this is now just a UI/policy layer).

**Governing rule:** every Stage-B capability obeys the UCT Surface Ownership Principle (architecture spec §9) — Notebook links or snapshots; it never re-implements another surface's authoritative write path. This is the rule that rejected the original "Trading Journal object model" proposal outright.

### 4.3 Stage C — Primary Notebook Ready (for the target financial user)

**Definition:** for a representative member of the target financial personas (§3), UCT is sufficiently capable that they do **not need** Notion, Evernote, or Obsidian to complete their important everyday notebook/research/knowledge workflows — measured against real usage, not roadmap completion.

**The governing distinction — read this before scoping any Stage-C work:**
- **OPTIONAL continued incumbent use is fine, and is not a failure to fix.** A member may still *choose* to keep a general-purpose notebook for meeting notes, personal journaling, or unrelated projects that were never this program's target workflows. That kind of coexistence is a legitimate, permanent outcome — it is what Stage B's "alongside" positioning describes, and it does not need to be eliminated.
- **REQUIRED incumbent use because of a UCT capability gap is not Stage C.** If a target member must keep returning to Notion/Evernote/Obsidian to complete an *important workflow this program's own personas and benchmark suite name as in scope* — because UCT genuinely cannot do it — that specific workflow has not reached Stage C, regardless of how much other work has shipped. Do not count that gap as "acceptable coexistence."
- **This is not generic productivity parity.** Stage C is scoped specifically to the target financial personas (§3) and the workflows this program has actually researched and named (the Master Benchmark Suite, §9) — not a claim about matching Notion/Evernote/Obsidian for every possible use case a human might have.

This corrects and sharpens, without reversing, the Phase One/Two finding that "financial research system of record" (Stage B) is the correct *initial* strategic beachhead — Stage B remains the right place to earn adoption first. Stage C is the separate, later, higher bar: once earned, an incumbent notebook becomes optional for this audience's important workflows, not merely tolerated as a permanent dependency.

**Preconditions before claiming Stage C:**
- Stage B complete and in real production use for a meaningful period.
- The professional-analyst/PM persona question (§3) resolved with real usage/signup-source data — only then does further investment toward that persona make sense.
- Ask Notebook + UCT (the legal-gated Experiment, §8) either shipped (if the external rights review has resolved) or explicitly still deferred.

**Evidence required (not marketing language):** the Master Benchmark Suite (§6) passing for real members, not synthetic testers; retention/return-usage data showing the beachhead persona's research genuinely accumulates in UCT over months; first-30-minutes and first-7-days churn signals (implementation plan §Analytics) trending in the right direction for each incoming persona segment.

---

## 5. P0 Capability Requirements

### P0-1 — Note trash + undo-delete

| Field | Value |
|---|---|
| Target persona | All — pure trust primitive, not persona-specific |
| User job | Recover from an accidental or regretted delete |
| Problem | Hard `DELETE`, no soft-delete column, no trash table — confirmed absent, no partial credit |
| Current workflow | None — data is gone, permanently, on any delete |
| Desired member experience | Delete a note → it moves to a "Deleted notes" view → restorable for N days → auto-purged after |
| Why it matters | One of the two trust-parity bars named in the Constitution (§2 item 11); every migration-cohort member expects this as baseline hygiene |
| Switching value | High for Notion/Evernote/Obsidian switchers, all of whom have this natively |
| Retention value | High — the alternative is a single bad delete ending the relationship |
| UCT differentiation | None — table stakes |
| Smallest valuable version | `deleted_at` column + trash view + one-click restore + scheduled hard-purge after 30 days |
| Non-goals | Version history (separate P1 item), bulk-restore UI polish |
| Dependencies | None |
| Success metric | Zero support tickets of the shape "I deleted a note and can't get it back," measured over 30 days post-ship |
| Benchmark task | "Recover deleted work" (§6) |
| Failure conditions | A restored note loses embeds/attachments/tags; the purge sweep fires before the stated retention window |

### P0-2 — Folder-sidebar correctness fix + search-latency verification

| Field | Value |
|---|---|
| Target persona | Migrated Evernote/Obsidian power-users with deep folder trees; any trader with one running catch-all folder past ~100 notes |
| User job | Trust that the sidebar shows every note that exists |
| Problem | A folder's leaf-row fetch is capped at the same 100-row global-alphabetical page as the main list — any folder can render silently, unexplainably empty, independent of that folder's own size |
| Current workflow | A member opens a folder, sees nothing or a partial list, with no signal anything is missing |
| Desired member experience | Every folder always shows its true note count and every note in it, or an honest "showing N of M, load more" |
| Why it matters | A correctness bug, not a completeness one — the existing fix pattern (`unfiledTotalFromServer`) already exists in the same file for a near-identical case |
| Switching value | High — this is precisely the self-verification moment Phase One identifies as the highest-probability first-week failure for the highest-value Obsidian-switcher persona |
| Retention value | High |
| UCT differentiation | None — table stakes, correctness |
| Smallest valuable version | Apply the existing `unfiledTotalFromServer` pattern to per-folder counts |
| Non-goals | Full sidebar virtualization/redesign |
| Dependencies | None |
| Success metric | Zero folders showing a note count that disagrees with a direct query, at any library size tested |
| Benchmark task | "Find months-old research," "work at scale" (§6) |
| Failure conditions | Fix regresses sidebar load latency; count still drifts at very large folder sizes |

*(The search read-latency item is a verification task, not a build item — benchmark FTS5 at 5k/20k/100k platform-wide rows before any further search investment is justified by "already proven at scale." No product-facing acceptance criteria; this is due diligence gating Stage-B search work.)*

### P0-3 — Derived entity/mention layer (remaining slice)

| Field | Value |
|---|---|
| Target persona | All personas doing ticker-centric research; most valuable for the trader/investor personas |
| User job | "Show me everything I've written about NVDA," without manually tagging every mention |
| Problem | ~75% already shipped (mention detection, join table, reverse-index all landed before this research ran); remaining gap: no sector/industry/earnings-window join, suggested-but-declined mentions aren't persisted (so the reverse-index misses prose-only mentions), and a real class-share cashtag bug (`$BRK-B` extracts as invalid ticker "BRK") |
| Current workflow | A member gets partial coverage: accepted chart embeds are indexed, plain-prose mentions are not |
| Desired member experience | Every note mentioning a ticker (via cashtag, accepted embed, or confirmed tag) is retrievable from that ticker's reverse-index; sector/earnings-window context is available without manual entry |
| Why it matters | Cheapest, highest-value item in the whole roadmap — retroactive, compounding, no authoring cost |
| Switching value | Medium — a real, evidenced Notion sub-market already does this manually (equity-research templates); UCT's automatic version plausibly beats it |
| Retention value | High — compounds with every note written |
| UCT differentiation | Automatic > authored, retroactive over the whole existing corpus |
| Smallest valuable version | Read-time join using the existing 24h ticker-metadata cache (never a fresh per-ticker external call); persist SUGGESTED (not just accepted) mentions as a lightweight row; fix the cashtag hyphen/dot symbology bug; widen the join to include the existing curated theme taxonomy at near-zero incremental cost |
| Non-goals | A general knowledge graph; multi-hop traversal beyond one-hop ticker/theme joins |
| Dependencies | None |
| Success metric | A note mentioning NVDA only in prose (no embed) appears in NVDA's reverse-index; `$BRK-B` resolves correctly |
| Benchmark task | "Find all notes on a theme," "screener → saved research" (partially) (§6) |
| Failure conditions | False-positive rate rises for fundamental-analyst vocabulary (untested register — ROIC/EBIT/FCF/WACC/CAGR); the sector/earnings join makes an unbounded per-ticker external call |

⚰️ **The "~75% already shipped" line above is SUPERSEDED — implementation-time code verification (2026-09-05, Wave 1 Slice 2) found it materially wrong, not just imprecise.** Preserved above as the historical research-time claim; do not delete it, and do not re-derive a "remaining gap" from it.

**What is actually true, verified by reading the code, not by re-reading this doc:**
- The reverse-index (`get_symbol_backlinks()` / `GET /notes/backlinks?symbol=`) reads **only** `j2_note_embeds` — accepted chart-embed rows. It has zero awareness of prose-only cashtag mentions today.
- `enrichment.scan_notes_for_tickers()` is the only code that detects a cashtag in note prose, and it has **exactly one caller**: the one-time post-migration import wizard (spec §8.1). **`create_note`/`update_note` never call it.** There is no ongoing detection pass at all — not "detects but doesn't persist," but "does not run."
- There is **no persisted SUGGESTED state anywhere** — no column, table, or row represents a suggested-but-undecided mention. The CONFIRMED/STORED/SUGGESTED model architecture.md §4 describes as "already converged on organically" has two real tiers (`j2_notes.ticker`, `j2_note_embeds.symbol`) and one theoretical one that produces no artifact.
- The cashtag bug is real but narrower than stated: only the **hyphen** class-share form breaks (`$BRK-B` → wrongly extracts `BRK`); the **dot** form (`$BRK.B`) already parses correctly.
- Sector/earnings/theme joins are confirmed absent, as stated. The reusable 24h ticker-metadata cache (`api/services/ticker_meta.py`) exists and is available to reuse, as stated.

**Corrected framing: P0-3 is not a small completion slice on a mostly-built foundation. It is the FIRST ongoing entity/mention indexing pass for ordinary member-authored notes** — ordinary prose, no embed, no import, no manual command. The success metric below (unchanged) is the right target; the "Problem"/"Smallest valuable version" rows above understate what building it requires. See the decision log entry "P0-3 scope correction" (2026-09-05) for the full evidence trail and the corrected implementation scope.

### P0-4 — Universal snapshot semantics (remaining slice: analyst-estimates capture path)

| Field | Value |
|---|---|
| Target persona | Any persona citing analyst estimates/ratings/price targets in a thesis |
| User job | Capture "consensus was $8.25 when I wrote this" and have it stay true forever, regardless of later revisions |
| Problem | **This content type cannot be embedded into a note at all today** — the capture button is explicitly gated off for the Analyst/Ownership panel. This inverts Phase Zero's own framing (it called this the "highest-danger block," implying an existing weak point to harden) — the real work is building a first capture path from zero |
| Current workflow | No workflow exists — a member cannot save this data into a note |
| Desired member experience | Capture estimates/ratings/price-targets exactly like every other widget (frozen payload, visible "as of" stamp), with the not-yet-invented revision-count indicator ("consensus was $8.25, is now $9.10") as a stretch goal |
| Why it matters | The flagship temporal-correctness moat claim is currently proven for one narrow slice (intraday charts) only — this is the highest-stakes remaining extension |
| Switching value | Low directly (a new capability, not a parity item) |
| Retention value | High — this is the moat, made real rather than aspirational |
| UCT differentiation | No competitor has this at all |
| Smallest valuable version | New `analystData`/`ownershipData` payload slot on the fundamentals widget's embed schema, gate the send-to-Journal button on the union instead of excluding the panel view, freeze the exact rows shown at capture (reuses the existing "owner-approved payload freeze" pattern already used for 7 other widget types) |
| Non-goals | The revision-count indicator UI (real, valuable, genuinely new UI/data concept — defer to a fast-follow once the capture path exists) |
| Dependencies | None for the capture path itself; the append-only fact ledger (shared with Ask Notebook, P1) is needed for the revision-indicator fast-follow, not for this item |
| Success metric | A member can embed analyst estimates into a note and reopen it a month later showing the value as captured, not the current value |
| Benchmark task | "Save a filing excerpt with provenance" (adjacent), "determine what changed since thesis creation" (§6) |
| Failure conditions | The frozen payload silently re-fetches (repeating the Calendar-embed bug class below); no "as of" stamp shown |

*(Bundled into this item: fix the Calendar embed's `reconstructable: true` unconditional re-fetch — correct for backward-looking review, wrong for a pre-earnings note reopened after the event resolves, currently live and unflagged. Small, scoped: gate on whether the captured date is in the future relative to capture time.)*

### P0-5 — Ask Current Note

| Field | Value |
|---|---|
| Target persona | All — the true P0 slice of the former "Ask My Notebook" |
| User job | Ask a question about the note I'm currently looking at and get a grounded, cited answer |
| Problem | Zero AI touches note content today (confirmed: no `j2_notes` reference anywhere in the AI infra) |
| Current workflow | Manual re-reading |
| Desired member experience | A question box on the open note; answer cites the note's own content; never fabricates |
| Why it matters | Cheap, low-risk, ships the "UCT has AI on my notes" signal every P0 item in this section is supposed to be shaped like |
| Switching value | Low-medium — no persona in Phase Zero/One's own research names absent note-AI as a first-week rejection reason |
| Retention value | Medium-high — a natural extension of Compass, which already exists for this persona |
| UCT differentiation | Reuses `ai_search_personal.py`'s already-proven grounding pattern; genuinely no new index/tenancy risk, unlike the corpus-wide version |
| Smallest valuable version | Bounded-context synthesis over one already-authorized note — no new index, no new leak surface, a copy-the-shape job |
| Non-goals | Cross-note retrieval (Ask Notebook, P1); citations across multiple notes |
| Dependencies | None |
| Success metric | A member asks "what did I think about NVDA's margins" on an open note and gets an answer citing only that note's actual content, zero fabricated facts, measured via the same grounding-audit pattern used elsewhere |
| Benchmark task | "Ask Current Note with grounded citations" (§6) |
| Failure conditions | Any fabricated fact not present in the note; answer references content from a different note |

**Architectural constraint on this and every future AI item (Constitution §2 item 7):** must not become a second, disconnected AI chat surface — integrate with or explicitly reconcile against Compass's existing tool registry.

---

## 6. P1 Capability Requirements

*(Same template, condensed where the item is small — full detail in the architecture spec's per-item sections.)*

### P1-1 — Save-to-Notebook maturation (small)
Persona: all. Job: save from anywhere in UCT with minimal friction, optionally to a specific destination. Problem: the destination-choice menu (`targetsFor()`/`CAPTURE_TARGETS`) is fully built and tested but has zero callers — every capture silently defaults. Desired experience: an optional destination picker (current note/new note/inbox/comment) on the existing 9 capture buttons. Why it matters: this P1 item shrank dramatically once Phase One found the "hard part" (the recent-captures picker, `CaptureInboxTray`) already shipped. Smallest valuable version: wire the existing menu onto the 9 buttons, add a comment field, complete the `tradeRef` link. Non-goals: a new capture mechanism — none is needed. Dependencies: none. Success metric: a member can choose a destination on capture; a captured widget can carry a comment. Benchmark task: "capture a trading idea quickly," "save/annotate a chart." Failure: the menu adds friction to the default one-click path (must stay optional).

### P1-2 — Ask Notebook (corpus-wide)
Persona: all, highest value once a member has real note volume. Job: ask a question across my whole notebook. Problem: no cross-note retrieval exists. Desired experience: cited, grounded answers drawing from multiple notes, per-user-scoped from the start. Why it matters: real, valuable differentiation once Stage A's trust foundation is in place. Switching value: low (differentiation, not acquisition). Retention value: high. Differentiation: temporal-correctness-aware grounding no generic AI-notebook competitor has. Smallest valuable version: lexical+entity retrieval only (FTS5 + the entity layer), no vectors. Non-goals: semantic/vector search (Experiment, evidence-gated, sequenced last). Dependencies: the entity layer (P0-3), the fact ledger (shared with P0-4), FTS5's `snippet()`/`highlight()` wired for citations. Success metric: cross-note query returns correctly-cited results with zero cross-user leakage (per-user-scoped candidate selection, verified before ranking ever runs). Benchmark: "find information buried in thousands of notes," "ask AI using private notes + UCT context." Failure: any candidate from another user's notes ever reaches the ranking step; the Freshness-Firewall prompt clause is copied unmodified from `ai_search_personal.py` (Notebook needs the opposite contract).

### P1-3 — Thesis changelog
Persona: trader/investor holding an active thesis. Job: know what's changed since I formed this thesis. Problem: no structured way to track thesis evolution. Desired experience: a note tagged `thesis`, with assumptions/evidence/risks as ordinary body content, showing a computed diff against linked snapshot facts. Why it matters: closes the "did the thing I believed change" loop this audience specifically needs. Smallest valuable version: `tags: ["thesis"]` convention (already used elsewhere for `quote`) + read-time diff view over the fact ledger + citing `j2_verdicts` as an evidence source rather than re-deriving structured rationale. Non-goals: a new Thesis object/table (would contradict the opt-in-scaffolding constitution principle); proactive alerting (Experiment, explicitly deferred). Dependencies: the fact ledger (P0-4). Success metric: "what changed since thesis creation" benchmark passes. Failure: a new mandatory schema forced on every note.

### P1-4 — Trading Journal link/cross-nav layer
Persona: active/swing trader. Job: connect a thesis note to the actual trade it produced. Problem: **the proposed "new Trading Journal object model" is rejected outright** — a complete, broker-synced, AI-coached trade/position/verdict/review/intervention system already ships (Journal 2.0's Trade Journal + Compass), one tab from the Notebook in the same shell. Desired experience: a thesis note links to a real `j2_trades`/`j2_positions` row; cross-navigation both directions. Why it matters: avoids duplicating a broker-synced system of record — the single most consequential correction in the whole research program. Smallest valuable version: complete the `tradeRef` link (schema-ready, unverified whether any writer populates it — confirm/wire it), cross-nav UI, decide `j2_trade_reviews`' existing AI post-mortem already satisfies the "Review note" ask (it does). Non-goals: any new trade/position/review schema. Dependencies: none beyond confirming `tradeRef` wiring. Success metric: opening a thesis note jumps to its linked trade and vice versa. Failure: any duplicate storage of trade/position state inside Notebook.

### P1-5 — Per-ticker research surface
Persona: all. Job: "everything I've written about NVDA" as a single view. Problem: no dedicated company page exists anywhere in UCT to embed into (verified absent, not assumed). Desired experience: a Notebook-side dynamic reverse-index view, launching into existing modals (`TickerPopup`/`EarningsResearchModal`) for live content rather than re-rendering it natively. Smallest valuable version: a query view over `j2_notes`/`j2_note_embeds`, architecturally identical to the existing `SavedScreensPanel`/`ScanResults` pattern. Non-goals: rebuilding fundamentals/chart rendering inside Notebook; owning a company page (if one is ever built elsewhere, it should embed FROM Notebook's reverse-index, never the reverse). Dependencies: entity layer (P0-3). Success metric: opening "NVDA research" shows every note/thesis/trade touching NVDA. Failure: any live data re-fetched/re-rendered natively inside this view instead of launching the owning modal.

### P1-6 — Version history
Persona: all, especially long-form note authors (analyst/PM). Job: recover from an overwrite, not just a delete. Problem: no version table anywhere. Why P1 not P0: a real but lower-frequency loss event than full deletion (Constitution §2 item 11) — a deliberate sequencing call, flagged here as one worth an explicit owner decision rather than a silent gap. Smallest valuable version: periodic snapshot on save, viewable diff, restore-to-version. Dependencies: none technically, but should be designed alongside the account-deletion purge (a version table needs to be included in that purge from day one, or it becomes a second place "deleted" data silently survives — already handled: `account_purge.py`'s table list is the enforcement point for any future addition here). Success metric: a member can view and restore a prior version of a note. Failure: version rows aren't covered by the account-deletion purge.

### P1-7 — Encryption at rest
Persona: all, especially Obsidian-switchers (highest trust bar). Problem: note body and attachments are plaintext, confirmed on both axes independently. Real conflict Phase Zero's cost estimate missed: naive column encryption breaks the live, healthy, plaintext-fed FTS5 index — trading a P1 trust feature for a regression in a P0 one. Smallest valuable version: **gate on a design spike first** — an architecture that keeps full-text search working under encryption (e.g., SQLCipher-style whole-file encryption, unverified compatibility with this codebase's current SQLite usage) before sizing this as a normal build task. Key management itself is the easy part (already built and proven for connector tokens). Dependencies: the design spike's outcome. Success metric: note content encrypted at rest with search still functional. Failure: search breaks, or the spike is skipped and a naive implementation ships silently degraded search.

### P1-8 — Account-deletion self-serve trigger + SLA
**The underlying purge mechanism is now fixed and live in production** (see §2 item 5, and the companion decision log). What remains is genuinely small: a self-serve trigger (today, deletion is admin-manual, ticket-based) and a defined SLA. Persona: all. Success metric: a member can request and receive account deletion without an admin manually running an endpoint, within a stated time window. Failure: any regression to the purge coverage established by `account_purge.py`.

### P1-9 — Read-only offline cache of recently-viewed notes
Persona: all, moderate value. Problem: zero offline support today, correctly so for full editing (UCT is a live-data product by architecture) — but a lightweight PWA cache-first GET for already-viewed note bodies is a materially better fit than an undifferentiated "offline story." Use case: checking a specific thesis note pre-market on a spotty connection, not composing on a plane. Non-goals: full offline editing (stays Experiment/Validate-First — see §8). Dependencies: none. Success metric: a previously-viewed note opens read-only with no connection. Failure: any write attempted while offline silently fails without a clear "you're offline" signal.

### P1-10 — Local draft safety net
Persona: all. Problem: a closed tab or crash during a pending, unlanded autosave loses work — the one real gap the existing retry-with-backoff design leaves open. Smallest valuable version: periodic localStorage/IndexedDB snapshot of in-progress editor content, restored on reload if the last autosave never landed. Near-free — should ship early (Stage A wave, not gated on anything). Success metric: closing a tab mid-edit and reopening recovers unsaved content.

---

## 7. P2 / P3 / Experiment items (lighter treatment)

**P2:** migration history log (surfaces already-tracked per-item outcome data from the closed migration program — presentation only). Team-adjacent light sharing — **true first step is defining an account/team boundary primitive** (no team/org concept exists anywhere in UCT's auth system today), not a UI increment; do not promote without validated demand.

**P3:** Canvas/visual-mapping tooling analog. Guided completion tour (risky if forced — Phase Zero's own caution stands).

**Experiment/Validate-First:**
- Full multi-hop knowledge graph beyond one-hop ticker/theme joins.
- Proactive thesis-invalidation alerting (the hardest, highest-risk AI feature in the program — correctly deferred).
- Public API/extensibility surface (a narrower first-party integration surface, not the rejected general marketplace).
- Full offline-first architecture (full editing, not the read-only cache above).
- Semantic/vector search — build only once usage telemetry shows lexical+entity actually fails a measurable fraction of real queries.
- A bookmarklet-first "financial research capture extension" (filings/transcripts/analyst notes, ticker-tagged) — narrower than the rejected general clipper; validate via the cheapest possible test (a bookmarklet hitting the already-existing inbox endpoint, zero store review) before any maintained-extension investment. Success bar: 20+ members use it more than once within 30 days of a quiet release.
- **The single most consequential open question in the whole program:** does the professional-analyst/PM persona actually compete against Notion/Evernote/Obsidian at meaningful rates, or is their real "switching-from" set Excel/Bloomberg/FactSet/internal wikis? Resolve with signup-source/usage data before placing further roadmap weight on Notion/Evernote/Obsidian parity aimed at that sub-persona.
- "Ask Notebook + UCT" — see §8, legally gated, not merely a priority call.

---

## 8. Do-Not-Build

- **General web clipper** — rejected as stated. UCT's differentiation is capturing its own live data; a generic clipper is commodity and doesn't compound. Narrower carve-out: see the bookmarklet Experiment above.
- **Full third-party plugin marketplace** — rejected for the Obsidian-style, unsandboxed, arbitrary-third-party model. A narrower first-party integration surface is already a separate Experiment item, not this one.
- **Enterprise collaboration depth** — rejected (comments/mentions/multiplayer/granular guest permissions at Notion's depth). The narrower "team-adjacent light sharing" carve-out lives in P2, gated on defining an account/team boundary primitive first.
- **One-click full-migration rollback** — rejected for full-account scope (a botched rollback is itself the exact trust incident this workstream exists to prevent). A narrower "undo just this one import batch" primitive is architecturally cheaper and was not evaluated by the existing reasoning — flagged as a possible future item, not recommended now, and explicitly not a reopening of the closed migration program.
- **Notion-style external developer Agents platform** — rejected with no reservations. No code pattern, no partial infrastructure, no persona evidence supports this audience wanting one.
- **A new Trading Journal object model built inside Notebook** — the proposal itself is overturned, not merely deprioritized (see P1-4).
- **A second, disconnected AI chat surface** for any future AI capability — an architectural constraint, not a feature-tier decision (Constitution §2 item 7).

**Rights-dependent, explicitly gated (not a priority call — a legal one):** "Ask Notebook + UCT" (mixing personal notes with vendor-sourced FMP/Massive data inside one synthesized answer) inherits the AI_RETRIEVAL_ALLOWED policy boundary from the external data-rights review. Not scheduled until that review resolves. This program does not reopen or opine on that review.

---

## 9. Master Benchmark Suite

Every P0/P1 item above maps to at least one of these; see each item's "Benchmark task" field for the specific mapping. Full acceptance-criteria detail lives in the implementation plan.

1. Capture a trading idea quickly — *already live*
2. Save and annotate a chart — *already live*; "annotate" for drawing-tool overlays surviving into a frozen embed is UNVERIFIED, flagged for confirmation during Stage A
3. Save a filing excerpt with provenance — **gap**: filings/news snapshot semantics are discussed but not in the current build list; flag for Stage B scoping
4. Find months-old research — P0-2 (search verification)
5. Prepare for earnings — existing Calendar capture door, already sufficient for the earnings sub-case
6. Review post-earnings changes — P1-3 (thesis changelog) + P0-4 (Calendar embed fix)
7. Find information buried in thousands of notes — P1-2 (Ask Notebook) + P0-2
8. Screener → research → saved research — **gap, and an internal contradiction to resolve**: Scanner/Screener is not among the 9 confirmed capture-door widgets, yet is used as the flagship trading-journal-moat example; wire the capture door in Stage B, don't just assume it
9. Create/review a thesis — P1-3
10. Recover accidentally deleted work — P0-1
11. Work at scale — P0-2, plus the performance targets in the architecture spec
12. Mobile capture — **gap, never explicitly triaged either way**; scope in Stage B
13. Export without lock-in — *already live, genuine strength*
14. Ask AI using private notes + UCT context — P0-5 (Ask Current Note) now, P1-2 (Ask Notebook) next, "+UCT" gated
15. Verify AI citations — needs its **own explicit, independently testable acceptance criterion** (a click-to-source affordance), not an implicit property of "grounded/cited" — see architecture spec's AI section
16. Determine what changed since thesis creation — P1-3, the one flagship 1:1 mapping in the whole suite
17. Review a trade against the original plan — **likely already satisfiable** by Compass's existing Per-Trade Post-Mortem without new Notebook-side work; confirm before building anything here (P1-4)

Compliance/trust items (legal review, encryption, account-deletion purge) map to no benchmark task by design — they are properties, not user-facing capabilities.

---

## 10. Traceability

Every P0/P1 item's table above already states: target persona, user job, evidence-grounded problem statement (citing the specific Phase One finding), dependency, and success criterion. No item in this spec exists without that trace. Where evidence was insufficient to fully specify an item (filings provenance, mobile capture, the analyst-register false-positive risk), this is stated explicitly as a gap rather than papered over — see the Open Questions section of the decision log.
