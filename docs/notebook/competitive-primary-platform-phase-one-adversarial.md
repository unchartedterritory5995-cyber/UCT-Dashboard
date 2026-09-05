# UCT Notebook — Competitive Primary-Platform Phase One: Independent Adversarial Product Review

**Status:** Complete. **Method:** 9 independent, fresh-context, parallel adversarial research dispatches against Phase Zero (`competitive-primary-platform-phase-zero.md`) + Appendix C, each scoped to a distinct attack surface, each required to verify current-UCT claims by direct source read (file:line) rather than trusting Phase Zero's paraphrase, and each explicitly forbidden from fabricating incidents/quotes/statistics. The orchestrating session additionally personally re-verified the two highest-stakes, most consequential single-sourced findings directly against source before synthesis (see Evidence Integrity, below).

**Read this document as a correction layer on top of Phase Zero, not a replacement.** Where Phase One confirms Phase Zero, that is stated briefly. Where it overturns, downgrades, rescopes, or reorders Phase Zero, the reasoning and evidence are given in full — this is the entire point of the exercise.

---

## Executive Verdict

Phase Zero's direction — a financial-native notebook, not a generic-notebook clone — **survives adversarial review intact**. Its research discipline (direct code verification, explicit UNVERIFIED flags, the evidence-integrity audit that already caught and corrected its own compose-time-gap mistake) is sound and should be the template for every future phase of this program. But six findings materially change what should be built, in what order, and for whom:

1. **The ambition should narrow.** "Primary notebook" (full Notion/Evernote/Obsidian replacement) is not what Phase Zero's own evidence supports. The correct north star is **a financial research system of record, used alongside a member's general notebook, not instead of it.** See North Star Challenge.

2. **The beachhead should narrow.** Phase Zero's four co-equal personas are not equally reachable — direct inspection of the product (Notebook's own templates, Compass's onboarding taxonomy, the entire coaching layer) shows the product was already, unmistakably, built for one of them: **the active/swing trader already inside Journal 2.0 + Compass + broker sync.** The other three personas are real but should be served via the "alongside" model, deferred, or — for the professional analyst specifically — investigated before any further investment, because a real, unexamined risk (employer/compliance constraints on where firm research can live) may make that persona a poor near-term target regardless of features built. See Persona Challenge.

3. **Several P0/P1 items are miscosted in both directions.** The derived entity/mention layer is ~75% already shipped (three of its four pieces landed before Phase Zero's own research ran). Universal snapshot semantics is fully done at the widget-rendering layer for every non-chart type. Save-to-Notebook's "hardest" remaining piece — the compose-time capture picker Appendix C reasoned would need new interaction design — **already shipped, three weeks before Phase Zero's research, and was independently rediscovered by three separate dispatches taking different paths to find it.** Conversely, the item Phase Zero calls its single highest-danger block (analyst-estimates freeze semantics) **cannot be captured into a note at all today** — the real work there is building a first capture path from zero, not hardening an existing one. See P0/P1 Red Team, Entity Layer, Save to Notebook.

4. **"Ask My Notebook" should split.** A true, cheap, low-risk P0 ("Ask Current Note," reusing an existing pattern near-verbatim) exists inside the P0-6 item Phase Zero proposed. The corpus-wide version ("Ask Notebook") is legitimate, valuable, real engineering — and belongs one tier down, in P1, not P0. See Ask My Notebook.

5. **The "Trading Journal object model" as proposed should be rejected, not merely downgraded.** UCT already ships a complete, broker-synced, AI-coached trade/position/verdict/review/intervention system (Journal 2.0's Trade Journal + Compass) one tab away from the Notebook in the same React shell. Phase Zero's own trading-journal research benchmarked only external competitors and never checked this. The correct P1 item is a small link/cross-nav layer to the system that already exists, not a new object model. See Trading Journal.

6. **A new, serious, independently-verified finding, unrelated to any roadmap tier: UCT's account-deletion cascade never reaches any of the 54+ Journal 2.0 tables** — notes, folders, trades, positions, verdicts, chat history, everything — because none of them declare a foreign key to `users(id)`, which is the only mechanism the cascade uses to discover what to delete. This is a live gap in production today, independent of any feature Phase Zero or this review proposes building, and it gets structurally worse with every new capture surface this program ships on top of it. This should be raised for prompt attention on its own timeline, separate from the Notebook roadmap's normal sequencing. See Trust / Recovery.

None of this changes Phase Zero's core research method or its overall confidence that a financial-native notebook is the right strategic bet. It changes the shape, sizing, and sequencing of the plan — mostly by discovering that more of it is already built than Phase Zero credited, and that the one thing genuinely missing (a verified data-deletion story) is more urgent than anything on the feature roadmap.

---

## Method / Independence

Nine dispatches ran in parallel, each a fresh-context agent with no shared state and no visibility into the others' work, briefed independently with:
- The full evidence-integrity mandate (below), including the specific history of Phase Zero's own fabrication incidents, so each dispatch understood exactly what failure mode to avoid.
- A scoped subset of Phase Zero's sections to attack, with the specific sub-questions from the governing directive.
- An explicit instruction to actively try to disprove, downgrade, rescope, reorder, simplify, or remove Phase Zero's conclusions — not to summarize or agree with them.
- Instructions to write findings to a distinct file, verify every current-UCT claim against the actual repository (not Phase Zero's restatement of it), and clearly separate VERIFIED / REASONED-BUT-UNVERIFIED / UNVERIFIED claims.

The nine attack surfaces: (1) North Star + Personas + Beachhead, (2) Competitor Switching Blockers, (3) P0/P1/Do-Not-Build, (4) Entity Layer + Temporal Semantics, (5) Provenance + Ask My Notebook + Search, (6) Save-to-Notebook + Core UX + Offline + Collaboration, (7) Trading Journal + Thesis Intelligence + Per-Ticker Surface + Surface Ownership, (8) Trust/Recovery + Performance/Scale, (9) Competitive Moat + First-30-Minutes/First-7-Days + Benchmark Suite + Architecture Pre-Mortem.

The orchestrating session then read all nine reports in full and independently re-verified, by direct source read, the two highest-stakes and most consequential single- or multi-sourced claims before writing this synthesis (see below). No dispatch was permitted to see or build on another's output — the strong convergence documented below happened despite that isolation, which is itself part of the evidence.

---

## Evidence Integrity

**No fabrication was found in any of the nine dispatch reports.** Every current-UCT claim is cited to a specific file:line; every claim the dispatch could not verify is explicitly labeled UNVERIFIED, REASONED/SPECULATIVE, or a clearly-framed hypothetical scenario (never presented as an observed user complaint or quote). This stands in deliberate contrast to Phase Zero's first-pass research, where 6 of 10 initial dispatches fabricated content.

Three findings were **independently rediscovered by multiple dispatches taking different investigative paths**, which is strong corroborating evidence in its own right:
- **`CaptureInboxTray` / capture-destination registry already shipped, contradicting Appendix C's own downgrade reasoning** — found independently by dispatch 2 (switching-blockers), dispatch 3 (P0/P1 red team), and dispatch 6 (Save-to-Notebook). All three cite the same file (`NoteEditorPage.jsx`), the same commit ancestry, and reach the same conclusion via different searches.
- **UCT's existing Journal 2.0 trading journal + Compass coaching layer overlaps with Phase Zero's proposed "Trading Journal object model"** — found independently by dispatch 1 (persona/beachhead), dispatch 7 (ownership), and dispatch 9 (moat/pre-mortem).
- **The entity/mention layer is substantially more built than Phase Zero credited** — found by dispatch 4 directly, and consistent with dispatch 2's and dispatch 3's independent findings about the same capture infrastructure.

Before writing this synthesis, the orchestrating session personally re-verified, directly against source (not trusting any dispatch's citation), the two claims with the highest stakes and the least independent corroboration:

1. **The account-deletion FK gap (dispatch 8, single-sourced, highest severity).** Confirmed directly: `grep -n "REFERENCES users|FOREIGN KEY" api/services/journal_two/db.py` returns zero matches across all 66 `CREATE TABLE` statements in that file. Read `api/routers/auth.py:830-877` (`_cascade_delete_user`) directly — its own docstring claims coverage of "journal/j2_*" via a `PRAGMA foreign_key_list` discovery mechanism that, by construction, only clears tables declaring an FK to `users`; since no `j2_*` table does, the claim in the docstring is false as written. Confirmed `api/services/journal_two/notes.py:21` imports `get_connection` from `api.services.auth_db` — the same physical database and connection as `users` — so this is not a cross-database scoping issue. **Confirmed independently, exactly as dispatch 8 reported.**
2. **`CaptureInboxTray`'s existence and timing (triple-sourced, drives multiple rescoping decisions).** Confirmed directly: `CaptureInboxTray` is defined at `NoteEditorPage.jsx:84` and mounted at `:863`. Confirmed via `git log -S` that it was introduced in commit `e312b0bf4`, dated 2026-08-12 — three weeks before Phase Zero's own research commit (`c882f426d`, 2026-09-05) — and confirmed via `git merge-base --is-ancestor` that it is a direct ancestor of that commit. **Confirmed independently, exactly as all three dispatches reported.**

Both spot-checks confirmed the dispatch findings without correction. Combined with the absence of any fabrication pattern across all nine reports and the multiple instances of independent convergence, **this artifact is assessed as decision-grade evidence**, consistent with the standard Phase Zero's own Evidence-Integrity Audit established.

---

## North Star Challenge

**Verdict: REVISE.** (Dispatch 1.)

Phase Zero's §1 executive framing already states the right instinct — *"win on the one axis none of the three [competitors] can structurally match"* — but §33's "Proposed end state" reverts to the original brief's full-replacement framing ("Notion + Evernote + Obsidian + UCT Financial Intelligence") without re-deriving it from that instinct. This is an internal inconsistency in Phase Zero's own document, not an import from outside it.

Phase Zero's own evidence argues against full replacement in multiple places it doesn't act on: the Obsidian trust bar is conceded as structurally unclearable by policy alone (§27); offline is downgraded to P1/P2; note content is stored in plaintext server-side — the opposite of what a "your only knowledge store" pitch needs; §28's Do-Not-Build list (clipper, plugin marketplace, team collaboration, full graph) is only coherent under a narrower ambition, since matching those is exactly what "replace Evernote/Obsidian" would require.

**Recommended north star:** *UCT should be the system of record for a member's tickers, positions, trades, and theses — designed to be used alongside their general notebook, not instead of it.* This is cheaper to earn trust for (a bounded, financial-tagged slice of their life, not their whole vault), makes §28's Do-Not-Build list durable rather than provisional, and — critically — doesn't ask the closed migration/connector program's work to be reopened; it *increases* the value of those bidirectional sync connectors, repositioning them from "step one of luring you away" to "the bridge that makes UCT useful without asking you to leave."

---

## Persona Challenge

**Verdict: the four-persona combined v1 target is too broad — confirmed, not merely argued.** (Dispatch 1, corroborated by dispatch 2.)

Direct, file:line-verified evidence that the product's existing architecture has already picked a persona: Notebook's 8 templates (`notebookTemplates.js`) are entirely trader-ritual-shaped (Tilt Log, Swing Position Log, Trade Post-Mortem, Earnings Play Plan — zero fundamental-research templates exist). Compass's 10-category onboarding taxonomy (`coach_chat_tools.py:1086`) uses trading-specific vocabulary throughout ("style," "setups," "sizing") with no fundamental-research or portfolio-construction category. The entire Compass coaching layer — 28+ tools, tilt intervention, pre-trade verdicts — models a trading-discipline coach, nothing a buy-and-hold fundamental investor or institutional PM would recognize as their job. `j2_notes` has exactly one entity field (a single `ticker` column), adequate for "notes about a symbol," not for a fundamental investor's coverage-universe/comps/multi-view database needs.

| Persona | Verdict |
|---|---|
| **Active/swing trader** | **PRIMARY BEACHHEAD.** Not a new bet — the persona the product already, demonstrably, was built for. |
| **Serious individual investor / "PM of their own capital"** | **SECONDARY.** A variant of the trader persona, riding the same broker-sync/accounts infrastructure and `portfolio_heat.py`/`personal_edge.py` machinery already shipped. |
| **Fundamental investor / equity researcher** | **SECONDARY, via the alongside model only.** Real value exists (thesis-tied live snapshots), but this persona's actual incumbent dependency (Notion relational databases, Obsidian Bases) isn't something UCT should chase head-on. Right motion: connector/capture bridge into their real vault, not asking them to relocate it. |
| **Institutional/professional analyst, institutional PM** | **LATER, and possibly never at consumer pricing.** No team/permissions/audit infrastructure exists at all. **New risk this review surfaces, not in Phase Zero:** whether a sell-side/buy-side analyst is even *permitted* to put employer-owned research in a personal consumer SaaS notebook is unexamined and plausibly disqualifying — a compliance question that should gate investment in this persona, not be discovered after building for it. |
| **Casual dashboard user (occasional note)** | Not a gap to close — the existing, unflagged Save-to-Notebook door already serves this persona adequately; proof the alongside model already works. |
| **Investment club / small research team** | Zero evidence either way; correctly Experiment/Validate-First. |

**A second, related open question dispatch 2 independently raised**, and this review treats it as one of the most consequential unresolved items in the whole program: **does the professional-analyst/PM half of Phase Zero's stated persona list actually compete against Notion/Evernote/Obsidian at meaningful rates at all — or does that segment's real "switching-from" set look more like Excel, Bloomberg/FactSet terminals, and internal firm wikis, which this entire research program never examined?** New evidence gathered by dispatch 2 (a real Notion Marketplace niche of "Equity Research Command Center" templates; actively-maintained Obsidian trading-journal plugins with broker sync) skews toward the retail/prosumer end of the persona list, leaving the professional half of the target audience's actual competitive set an open, unresolved, and answerable-only-with-real-data question. **Recommend resolving this with signup-source/usage data before placing further roadmap weight on Notion/Evernote/Obsidian-specific parity work aimed at the analyst/PM sub-persona.**

---

## Competitor Blocker Challenges

(Dispatch 2, cross-verified against dispatch 1's persona findings.)

**Notion.** Databases/relations/multi-view is real, but Phase Zero's own §25 doesn't separate two different jobs hiding inside "databases": *ticker/entity cross-reference* (which UCT's automatic derived layer plausibly beats a hand-maintained Notion relation at — CAN DIFFER, confirm P0, and widen its scope to include theme-membership joins at near-zero cost) versus *generalized custom structured tables* (a personal 15-column coverage tracker) — a genuine, currently unaddressed gap that is neither cleanly "CAN DIFFER" nor "DO NOT BUILD"; recommend tracking it separately as its own Experiment/Validate-First item rather than letting it hide inside the deferred full-knowledge-graph item. Cited/"Research Mode" AI should be reframed from "match" to **MUST EXCEED** — UCT's temporal-correctness advantage is a stronger trust property for financial facts than a generic cited-RAG feature, not merely a parity item.

**Evernote — the single most over-weighted competitor in Phase Zero.** OCR/scan continuity is a real Evernote retention driver in the abstract and a false alarm for this persona's actual professional inputs (filings, transcripts, charts — all already digital-native); **DO NOT BUILD, confirmed.** Two other claims are less true than stated once existing infrastructure is accounted for: email-to-note is real and *cheap*, not equivalent-cost to OCR, because the destination it needs (`j2_capture_inbox`) already exists — **CAN MATCH, cheaply**, worth near-term scoping unlike OCR. Calendar-linked meeting notes are largely already sufficient — `CalendarWidget.jsx` already has a working capture door for the financial-native analog (earnings-call-linked notes). The one Evernote blocker that matters (cross-device history/recovery) is already correctly folded into existing P0/P1 trust work.

**Obsidian — genuinely the highest trust bar, and correctly treated as such, with two sharpened recommendations.** Offline/local-first should lean further toward DO NOT BUILD than Phase Zero's "P1/P2 pending validation" — UCT's core differentiator is *live* data, so full offline is a structurally weaker fit here than for a pure-local tool by construction; **lead with the already-shipped, already-verified round-trip export as the trust answer, not offline.** Backlinks/graph: the derived reverse-index (P0) should be widened, at near-zero incremental cost, to include UCT's existing curated theme taxonomy (`themes_taxonomy.json`) alongside ticker joins — this gets much closer to the multi-hop value Obsidian users actually want (theme-level research) without Experiment-tier cost. **A new finding not in Phase Zero at all:** Obsidian is not merely a generic PKM competitor — for the swing-trader slice specifically, it is *also* a direct trading-journal competitor (actively-maintained Dataview-based trading-journal plugins with broker sync exist today). UCT's native trading journal (broker sync across 30+ brokers, AI review, cross-broker aggregation) is structurally superior to a single/dual-broker Dataview vault — the real risk here is **discovery, not features**: will an Obsidian trading-journal user ever try UCT's native journal, or assume "a narrower answer" and never look.

**Most under-weighted finding overall:** Phase Zero's competitor sections and its financial-native-feature sections are written as separate, non-cross-referenced tracks. Read together, the honest fight against these three competitors for this persona is less "can we clone their feature" (mostly no, and mostly shouldn't) and more "will the switcher discover that the financial-native version of the same job — which already exists or is already P0'd — is simply better." That is a migration/onboarding/discoverability problem for most of the blockers examined, not a product-gap problem.

---

## P0/P1 Red Team

(Dispatch 3, integrating direct corrections from dispatches 4, 5, 7.)

### Revised P0
1. **Legal/compliance review of the vendor-data capture door** — unchanged, external track, not re-litigated.
2. **Note trash + undo-delete** — **KEEP P0.** Confirmed real (hard `DELETE`, no soft-delete column anywhere). Minor softening: a confirm-modal already exists, so the risk is deliberate-delete-then-regret and bulk/cascade deletes, not stray clicks.
3. **Search/sidebar item — SPLIT.** (3a) Read-latency re-measurement is a near-zero-cost *verification* task, not an engineering item — don't roadmap it as if it were one. (3b) The folder-sidebar leaf-row defect is a confirmed, currently-shipping, real correctness bug — **this half is the genuine P0**, and it's sharper than "truncates at scale": any folder can render as silently, non-expandably empty (no arrow, no rows, no signal) purely because of where its notes fall in a global alphabetical sort, independent of that folder's own size — realistically member-visible around the 1,000-note tier for a single-catch-all-folder user, not only at scale. The fix pattern already exists in the same file for an identical case (`unfiledTotalFromServer`) — apply it.
4. **Derived entity/mention layer** — **KEEP P0, SHRINK SCOPE SHARPLY.** ~75% already shipped: mention detection (`enrichment.py`, shipped 2026-09-02), a stored join table (`j2_note_embeds`, shipped 2026-08-12), and a reverse-index read (`GET /notes/backlinks`, shipped 2026-08-14) all predate Phase Zero's own research. Remaining scope: a cheap read-time sector/industry/earnings-window join using an *existing* metadata cache (never a fresh per-ticker external call), persisting SUGGESTED (not just accepted) mentions so the reverse-index actually covers prose-only mentions, and fixing a real class-share cashtag bug (`$BRK-B` currently extracts as invalid ticker "BRK").
5. **Universal snapshot semantics** — **KEEP P0, but REFRAME what's left.** The widget-*rendering* half (frozen payload for every non-chart widget type) is already fully built. What actually remains: (a) **build a first capture path from zero** for analyst estimates/ratings/ownership — this content cannot be embedded into a note *at all* today (the capture button is explicitly gated off for exactly this content type), which inverts Phase Zero's own framing of this as "harden an existing weak point"; (b) a structured, queryable append-only fact ledger, needed for AI grounding and "what changed" diffs — properly understood as the data layer of item #6 below, not an independent cross-widget retrofit; (c) fix a real, live, previously-unflagged bug in the Calendar embed, which always re-fetches live for its captured date — correct for backward-looking review, wrong for a pre-earnings note reopened after the print (it will silently show actual results instead of what the member saw when they wrote it).
6. **"Ask My Notebook" v1 — SPLIT, not simply kept.** See Ask My Notebook, below. **True P0: "Ask Current Note" only.**

### Revised P1
- **Migration trust UI** — kept, unchanged. (Flagged elsewhere as possibly a holdover from the closed migration program's scope bleeding into this roadmap — worth a deliberate check, not a substantive finding here.)
- **Save-to-Notebook maturation** — **KEEP P1, RESCOPE MUCH SMALLER.** The exact "recent captures picker" and destination-choice UX Appendix C reasoned would require new interaction design already ship (`CaptureInboxTray`, `captureTargets.js`) — committed weeks before the research that recommended building them. Remaining real scope: a comment/annotation field at capture time, wiring the already-tested-but-uncalled `targetsFor()` destination menu onto the 9 capture buttons, and completing the `tradeRef` link (schema-ready, unverified whether any writer populates it). This is now small enough to reconsider pulling back into an early wave rather than leaving it a generic P1.
- **Ask Notebook (corpus-wide, lexical+entity only)** — new P1, demoted from the P0-6 item. See Ask My Notebook.
- **Thesis changelog** — kept, rescoped as a note+tag+read-time-diff-view, not a new object; should cite `j2_verdicts` as an evidence source. See Thesis Intelligence.
- **Encryption at rest** — **KEEP P1, but gate on a design spike first.** The note body backs a live, plaintext-fed FTS5 index; naive column encryption breaks the one currently-healthy search capability. Key management is not the hard part (already built and proven for connector tokens) — an architecture that keeps full-text search working under encryption is, and it's unverified whether this codebase's SQLite usage is compatible with a SQLCipher-style approach.
- **Automated account-deletion purge (self-serve trigger + SLA)** — **KEEP P1, RESCOPE SMALLER** — but see Trust/Recovery below for the *separate, more urgent* finding that the underlying cascade mechanism doesn't reach Notebook data at all, which is not a P1-tier item.
- **Trading journal object model** — **REJECTED as proposed**, replaced with a link/cross-nav task. See Trading Journal.
- **Per-ticker research surface** — kept, unchanged, confirmed cheap; must launch into existing modals, never rebuild their content (no company page exists to embed into — verified absent).
- **Version history** — kept; flagging an internal tension for the roadmap owner: the Product Constitution names version history alongside search and trash as one of three non-negotiable trust-parity bars, yet only two of the three sit in P0. Worth an explicit decision, not a silent omission.

---

## Do-Not-Build Red Team

(Dispatch 3.)

- **General web clipper** — reasoning sound *for a general clipper*, kept rejected as stated. **A narrower "financial research capture extension"** (a bookmarklet/extension that captures an external primary-source document — a filing, transcript, analyst note — with automatic ticker tagging) is a different, cheaper, more-compounding product than the rejected version: the destination plumbing (`POST /api/j2/inbox`) is already source-agnostic and session-authenticated exactly like Notion's/Evernote's own clippers, EDGAR/filings are already a first-class UCT object, and ticker-tagging-from-free-text is a solved, curated problem elsewhere in this codebase (`/buzz`'s cashtag extraction). **Move this narrower version to Experiment/Validate-First**, validated first via the cheapest possible test (a bookmarklet against the existing inbox endpoint, zero store review) before any maintained-extension investment.
- **Full third-party plugin marketplace** — **defended, no override.** Phase Zero already correctly carved a narrower first-party integration surface into Experiment/Validate-First separately.
- **Enterprise collaboration depth** — **defended, no override.** Already correctly split from the P2 "team-adjacent light sharing" carve-out; recommend an explicit cross-reference so a future reader skimming only the Do-Not-Build list doesn't miss the lighter version already sanctioned in P2.
- **One-click full-migration rollback** — **defended for the full-rollback scope.** A narrower "undo just this one import batch" primitive is architecturally cheaper (existing `import_source`/`imported_at` columns come close to enabling one) and wasn't evaluated by the existing Tier-4 reasoning, which is specifically about full-account rollback. Flagged, not recommended — adjacent to the closed migration project's scope, not reopened here.
- **Notion-style external developer Agents platform** — **defended with no reservations.** No code pattern, no partial infrastructure, no persona evidence found anywhere that changes this call.

**A new architectural constraint surfaced by this review, adjacent to Do-Not-Build in spirit:** a second, disconnected AI chat surface for Ask My Notebook — one that doesn't integrate with Compass's existing tool registry — should not be built. See Architecture Pre-Mortem #1.

---

## Entity Layer

(Dispatch 4.)

**Phase Zero materially overstates how much of this is unbuilt.** Mention detection, a stored ticker↔note join table, and a reverse-index read all shipped between 2026-08-12 and 2026-09-02 — before Phase Zero's own research session. UCT already has a working three-tier model that maps exactly onto CONFIRMED/STORED/SUGGESTED, and it should be *named as deliberate policy*, not left as an emergent side effect of the feature it was built for:
- **CONFIRMED** — `j2_notes.ticker`, one explicit author choice per note.
- **STORED (derived-then-committed)** — `j2_note_embeds.symbol`, written only when a member actually accepts a widget embed. De facto "confirmed by action."
- **SUGGESTED** — cashtag/alias/exact/contextual mention detection (reusing `/buzz`'s already-curated, already-battle-tested extractor), offered, never auto-committed.

**Fully automatic tagging is the wrong answer for this audience and this content type** — recall-over-precision is correct for a public board (`/buzz`, where a missed mention has social cost and a false one is cheap) but wrong once a tag is auto-committed to a personal note (a missed suggestion costs nothing; a wrong confirmed tag is real, if small, annoyance). Confirmed/hybrid for anything persisted; suggested/recall-biased for the detection pass that feeds it — exactly what's built.

**Store the join, don't build a graph.** A live-rescanned index would drift under universe churn (delistings, renames, reused tickers — UCT's own Model Book feature independently hit this exact problem for SQ→Block, WTW→Willis Towers Watson); a committed join is temporally stable by construction. Reprocessing, indexing, and portability are all already solved at the existing write path.

**One real, currently-unflagged gap:** the mention scanner only offers a chart embed and persists nothing for a declined suggestion, so the "everything I've written about NVDA" reverse-index only surfaces notes with an *accepted* embed for that symbol — a member who wrote three paragraphs about NVDA and never inserted a chart gets zero backlink coverage. Small fix: persist SUGGESTED (not just accepted) mentions as a lightweight row.

**One real, previously-unflagged bug:** the cashtag regex only recognizes a dot separator for class shares; `$BRK-B` (the common casual form) extracts as invalid ticker "BRK." Inherited wholesale from `/buzz` and untriggered there (rare in Discord chat); a financial notebook will hit it far more.

**Correctly out of scope, confirmed by direct regex reading, not assumed:** foreign listings, options symbols, private companies/sectors-as-linkable-entities. **A real, untested residual risk:** the false-positive suite that proves precision for swing-trading vocabulary has never been run against fundamental-analyst register (ROIC, EBIT, FCF, WACC, CAGR) — plausibly fine, genuinely unchecked.

---

## Temporal Semantics

(Dispatch 4.)

| Content type | Verdict | Status |
|---|---|---|
| Current quotes | LIVE (ambient only, never persisted) | Correct, nothing to fix |
| Charts | Hybrid — snapshot-anchor default, live opt-in, per-timeframe reconstruction ceiling | **Done correctly, the reference case** |
| Fundamentals / reported financials | SNAPSHOT | **Done.** Reported historicals essentially never revise. |
| Analyst estimates & ratings/price targets | **Cannot be captured at all today** | Not a temporal-correctness bug — a missing feature. Inverts Phase Zero's "highest-danger block" framing: the danger doesn't exist yet because the capture door doesn't exist yet. |
| Earnings expectations via Calendar embed | Currently re-fetch-live-by-date, unconditionally | **A real, live, previously-unflagged bug** for the forward-looking case (see below) |
| Watchlist / scanner results | SNAPSHOT, full-list freeze | **Done, and correct** — confirmed the existing implementation already made the right call the task brief posed as an open question |

**The Calendar embed bug:** `reconstructable: true` unconditionally means a captured Calendar embed always re-renders live for its date, forever — correct for backward-looking review (nothing there should ever go stale), *not yet proven correct* for a note captured *before* an event resolves. A member who captures "AAPL reports tomorrow, expected move X, consensus Y" the day before earnings and reopens that note a week later will see the row re-fetched for that date — which by then shows actual reported results, not what was expected when the note was written. This is precisely the failure mode Phase Zero's own stress-test scenario describes, already live in production, on a widget Phase Zero's snapshot-semantics analysis never individually audited. Small, scoped fix: gate `reconstructable` on whether the captured date is in the future relative to capture time.

**Closed, not reopened:** the task brief's open question about whether watchlist/scanner embeds should "annotate + live-link" rather than fully freeze is answered by the code that already exists — full-list freeze is correct, and the proposed hybrid would reintroduce exactly the corruption both Phase Zero and the shipped code already correctly reject. State this as a closed decision going forward.

**Governing rule, confirmed by reading every reconstruction function rather than assumed:** a block is safe to re-fetch live only when the underlying source has a genuine point-in-time query (a date parameter that answers historically) — not merely because the source still exists. This is why watchlist/scanner/themes/breadth/news/aisearch/profile are correctly frozen, and it's the test to apply to any future content type.

---

## Provenance

(Dispatch 5.)

**Verdict: object-level (row/attribute) provenance, applied passively by the mechanism that inserts content — not block-level prose tagging, not citation-level inline markup.** This mostly ratifies Phase Zero's implicit direction, but goes further: object-level provenance isn't a new idea to design — it's already the house convention, three times over (`j2_note_embeds`'s `mode`/`captured_at`; `j2_chat_messages.role`; ModelBook's `catalysts.source`). The real work is extending an existing idiom to two more insertion paths, not designing a provenance system.

**Concrete recommendation:** default state = untagged = "my thought" (nothing changes for ordinary jotting). Provenance is stamped only by mechanisms that already know their own source at insertion time — never a manual "tag this" button the user must remember to press. Live/UCT data extends the existing embed-attrs pattern (already P0 item #5, don't change it). Imported content is already covered at note level. Quoted external excerpts are a real, currently-unaddressed gap that stays documented, not built, until a capture mechanism that knows a source URL exists (matches the Do-Not-Build call on a general clipper). AI synthesis gets stamped for free at the moment "Ask My Notebook" lets a user insert an answer into a note — do this as part of that build, not a separate project. Citation-level markup is rejected for the note body (fights the "quick jot" UX) but belongs *inside an Ask My Notebook answer itself*, which is an answer-rendering concern, not a note-editing one.

---

## Search

(Dispatch 5, integrating dispatch 8's scale corrections.)

**Current state, verified directly:** porter-stemmed prefix matching only (a single-character typo returns nothing — no fuzzy/spellfix extension wired). `j2_notes_fts` is confirmed to be **one global table shared by every user's notes**, with `user_id` stored UNINDEXED — query-time tenant scoping is correct (`MATCH` narrows first, then a `user_id` predicate filters), but this means **search latency for one member's query is a function of platform-wide notes matching that term, not that member's own library size** — a materially different, more important risk axis than Phase Zero's per-user framing. Tag and ticker matching already work today, not "coming soon." No date-range filter exists at all. No OCR/attachment-content search exists. FTS5's `snippet()`/`highlight()` functions are unused anywhere — a free, currently-unclaimed upgrade sitting in already-shipped infrastructure.

**Scale — still genuinely unverified, now more precisely characterized.** The measured write-path fix (19ms→65ms tax at scale) was a structurally different problem (an unindexed DELETE on a virtual table) from the read path (which uses FTS5's own inverted index as designed) — a plausibility argument for lower urgency, explicitly not a substitute for the missing benchmark. **The real residual risk, previously unnamed:** because the FTS5 table is global, a common term matching thousands of rows platform-wide, then filtered to one user, could do real post-MATCH filtering work proportional to *total platform matches*, not to any one user's note count — this is directly testable (benchmark at 5k/20k/100k *global* rows) and should be closed before further search investment is justified by "FTS5 already works at scale," which is currently asserted, not measured.

**Evolution strategy (ordered, not one oversized ask):** Stage 0 — close the verification gap, add date-range filtering, wire `snippet()`/`highlight()` (all cheap). Stage 1 — entity-anchored retrieval, riding the entity-layer work above (no vectors). Stage 2 — Ask Current Note. Stage 3 — Ask Notebook (lexical+entity basis, still no vectors). Stage 4 — semantic/vector layer, additive only, built only once usage telemetry shows lexical+entity actually fails a measurable fraction of real queries. Stage 5 — fuzzy/typo tolerance and OCR/attachment indexing, sequenced by evidence, not by default. **Entity metadata plus existing FTS5 most likely solves the majority of real trader retrieval jobs — vectors should be the last stage built, not the second.**

---

## Ask My Notebook

(Dispatch 5, cross-validated by dispatch 3's independent P0→demotion argument.)

**Verdict: split.** Even after Appendix C's own correction (a genuinely new per-user-keyed index, not a drop-in reuse of the shared-matrix pattern), P0-6 is still hiding real, non-trivial infrastructure — a new index, an embedding cost/latency budget, tenancy that has to be *proven* — behind a P0 label that every other P0 item in this document earns by being cheap and low-risk. Two independent dispatches reached the identical conclusion via different arguments: dispatch 3 argued from Phase Zero's own tier definitions and its own persona-rejection research (no first-30-minutes or first-week persona names absent note-AI as a reason they'd reject UCT); dispatch 5 argued from the engineering shape of the two scopes.

**True P0: "Ask Current Note" only.** `get_note()` already scopes every read by user; a feature that answers questions about the one open note needs no new index, no new tenancy design, no new leak surface — it's a copy-the-shape job against `ai_search_personal.py`'s already-proven pattern (assemble private context → grounded synthesis → stream), not a greenfield build.

**Downgrade "Ask Notebook" (cross-note retrieval) to P1.** Real, valuable, and correctly scoped once demoted: candidates must be selected by `user_id` *before* any similarity computation, never filtered after ranking (never `brain_kb_service.py`'s shared-matrix-then-filter shape, confirmed to take no `user_id` at all). Deletion is trigger-safe and synchronous; insert/update needs an async reindex queue. Reuse `brain_kb_service.reindex()`'s incremental content-hash pattern verbatim, scoped per-user. Use FTS5's own unused `snippet()`/`highlight()` for citations. **Critically, do not copy `ai_search_personal.py`'s Freshness Firewall clause unmodified** — Notebook needs the opposite contract (a note's stated fact is historical and must never be silently corrected by newer data), a danger Appendix C already flagged and this review independently reconfirms.

**"Ask Notebook + UCT" should not be scheduled at all yet — Experiment, explicitly blocked on the §21 legal/data-rights review.** Mixing personal notes with vendor-sourced data inside one synthesized answer puts the AI_RETRIEVAL_ALLOWED boundary directly on the critical path; this is a harder version of the exposure §21 already named as Phase Zero's single most important finding.

**Cross-cutting architectural constraint (see Architecture Pre-Mortem #1):** whichever scope ships, it should expose note retrieval as tools inside Compass's existing registry (voice + chat) rather than building a second, disconnected AI chat surface — reusing the `brain_service` facade pattern this codebase already proved for a different bridge.

---

## Save to Notebook

(Dispatch 6, cross-validated by dispatches 2 and 3.)

**The architecture question is not open — UCT already shipped the answer.** One shared envelope (`buildWidgetEmbedAttrs`), one shared send function (`sendCaptureToJournal`, called identically by all 9 widget doors), one destination registry (`CAPTURE_TARGETS`, four real targets, unit-tested) — "common envelope + thin adapters" should be formally ratified as the constitution for this primitive, not treated as still-open. Remaining roadmap work is additive to this registry, not a rearchitecture.

**Today it is Quick Save with zero reachable advanced actions — worse than Phase Zero's framing implies.** Every one of the 9 widget capture buttons defaults silently; the destination-choice function that would drive a picker menu (`targetsFor()`) has zero callers anywhere outside its own test file. **The single most important correction in this document:** Appendix C's own reasoning for downgrading the compose-time gap from P0 to P1 — that a real fix needs new interaction design, "a recent captures picker" — describes a feature that **already exists and ships**, `CaptureInboxTray`, committed more than two weeks before the research that recommended building it, missed because the component is defined inline inside `NoteEditorPage.jsx` rather than in a same-named file (the same failure shape Phase Zero's own Contradiction Ledger already caught once for "Save to Notebook" itself, recurring one layer deeper, surviving into the second-pass audit). **Correct sizing:** the P1 item shrinks to (1) wiring the already-tested destination menu onto the 9 buttons, (2) adding a comment field, (3) completing the `tradeRef` link — small enough to reconsider for an earlier wave.

**What's preserved on every capture, confirmed from source:** source widget, normalized entity/context params, timestamp, explicit live-vs-snapshot mode, on-screen drawings at capture time (correctly capture-time, not a live re-seed), a schema version tag. **What's genuinely missing:** a comment/annotation field (doesn't exist anywhere in the flow) and save-to-thesis/trade (correctly deferred as future work, pending the trading-journal link layer).

---

## Core UX

(Dispatch 6.)

**Folder sidebar — confirmed worse than Appendix C's already-softened framing.** The failure trigger is a global alphabetical cutoff across the *entire* library, not that folder's own size — a folder with even one note can render as silently, unexplainably empty. The fix pattern (an honest server-side count, bypassing the client-side page cap) already exists in the same file for a near-identical case (`unfiledTotalFromServer`) — it just wasn't applied to per-folder counts. Keep this P0; it's cheap and it's a correctness bug, not merely a completeness one.

**Genuine strengths Phase Zero underweighted:** search-as-you-type is real, fast, and correctly engineered (250ms debounce, comfortably inside RAIL/Nielsen targets). Autosave resilience is stronger than credited — indefinite retry-with-backoff up to a 30s cap, with visible status — the thing standing between "no offline mode" and "silently loses your work on a network blip."

**Confirmed absent, boring gaps that should outrank financial differentiation in sequencing:** no quick-switch/command palette, no breadcrumbs, no multi-tab/split view, no dedicated find-in-note (relies on browser Ctrl+F), no user-facing favorites/recents, attachments are image-only (no generic file or PDF path).

---

## Offline

(Dispatch 6.)

Confirmed fully absent — no service worker, no manifest, no content persistence beyond a "which note was last open" pointer. The one real mitigation (retry-with-backoff) protects against short blips only while the tab stays open.

**Does this persona need offline editing?** No, more confidently than Phase Zero's "P1/P2 pending validation." UCT is a live, streaming, always-on-connectivity product by architecture (SSE prices, WebSocket bars, a regime engine) — roughly 90% of what makes UCT UCT is useless offline regardless of what Notebook does, a structurally different starting point from Obsidian's writers-on-a-train audience.

**Recommend splitting further than Phase Zero did:** full offline editing stays Experiment/Validate-First, low expected value for this persona. **A read-only offline cache of recently-viewed notes** (a lightweight PWA cache-first GET) is a materially better fit than an undifferentiated "offline story" and deserves to be its own smaller, cheaper item, ranked above pure offline editing — the plausible real use case is checking a specific thesis note pre-market on a spotty connection, not composing on a plane. **A local draft safety net** (a periodic localStorage/IndexedDB snapshot of in-progress editor content, restored on reload) is a near-free item Phase Zero's roadmap doesn't mention at all — cheap insurance against the one real gap the current design leaves open (a closed tab or crash during a pending, unlanded save).

---

## Collaboration

(Dispatch 6.)

Confirmed: the entire surface is one read-only, sanitized, flag-gated (default OFF) public share link. No comments, mentions, multiplayer, guest permissions, or team-workspace concept anywhere. Segmented by user type, only the investment-club/small-team segment has a qualitatively different (genuinely multi-author) need, and Phase Zero's own constitution doesn't name that segment as the beachhead — correctly out of near-term scope if so.

**A dependency Phase Zero didn't name, and should:** there is no team/organization-account concept anywhere in UCT's auth system (subscriptions and sessions are strictly per-individual-user). Even the lightest possible sharing feature (share one note with one named colleague who can comment) requires deciding what a "team"/account boundary even *is* first — a foundational product/billing decision, not a P2 UI increment. Recommend the P2 item's true first step be stated explicitly as "define an account/team boundary primitive," not "add comments to notes," so a future validation effort doesn't discover this prerequisite midway through what looked like a UI-sized task.

---

## Trading Journal

(Dispatch 7, independently corroborated by dispatches 1, 3, and 9.)

**Headline finding: Phase Zero's Trading Journal section never mentions `j2_trades`, `j2_positions`, `j2_broker_*`, SnapTrade, or Compass.** It benchmarks the proposed object model only against external competitors (TradeZella, Edgewonk, TraderSync) and treats the object model as greenfield. Direct verification shows this is wrong: a more integrated version already exists, live, one tab away from the Notebook in the same shell component (`JournalTwoRoot.jsx`'s `NESTED_TABS`: Open Positions, Trade Journal, Calendar, Accounts, Analytics, **Notebook**, Compass, Community — all siblings). Every component of Phase Zero's proposed model has a live, superior analog already shipped:

| Proposed piece | Existing production equivalent |
|---|---|
| Position (derived) | `j2_positions`, broker-synced, holdings-as-truth reconciliation |
| Entry/Exit records | `j2_trades`, FIFO-reconstructed from broker activity or manual entry |
| Catalyst/mistake tags | `setup`, `mistake_tags`, `emotion_tags` on `j2_trades` |
| Chart snapshots | Already embeds directly in `TradeDrawer` with entry/exit/stop/target lines |
| Post-exit Review note | `j2_trade_reviews` — AI-written, idempotent, cited |
| Trade-time thesis/rationale | `j2_verdicts` — structured GO/HOLD/SKIP, entry/stop/target/factors/paragraph |
| Discipline/rule-break detection | `j2_interventions` — 4 live cooldown-gated tilt rules |

Phase Zero explicitly cites Edgewonk's discipline-cost mechanism as *"the one concrete, shipped... feature in this category worth studying"* — this is backwards: UCT doesn't need a model to study; it already has the same category of mechanism, shipped, and more integrated (screener → catalyst → thesis → trade → AI review, in one account-scoped product) than the cited competitor.

`j2_notes` and `j2_trades`/`j2_positions` are, however, **structurally separate schemas with no foreign key between them** — verified directly. This is not the "already the same thing, question moot" case; it's a real integration decision that must be answered by *linking* two existing systems, never by building a third.

**Verdict: reject the proposed new object model outright**, replace with a small link/cross-nav layer: a `trade_ref`/`position_ref` pointer on a note resolving to a real `j2_trades`/`j2_positions` id (the schema already has an optional `tradeRef` attribute on widget embeds — **unverified whether any current frontend writer actually populates it**, worth confirming before treating it as partially-built), cross-navigation UI between a thesis note and its linked trade, and a decision on whether the existing `j2_trade_reviews` AI post-mortem already satisfies the "Review note" ask (probably: mostly). The only genuinely missing piece with no existing analog is a Thesis note authored *before* a trade is opened, referenced by the trade at entry time — build only that.

---

## Thesis Intelligence

(Dispatch 7.)

**Verdict: a note + a thin tag/properties layer + a read-time computed view — not a new first-class object.** A dedicated Thesis table would contradict Phase Zero's own constitution (§33.4: every structural concept is opt-in scaffolding on a plain note, never a mandatory form). The smallest viable mechanism: a `tags` entry (e.g. `"thesis"`) using the exact convention already shipped elsewhere in the codebase (`SaveQuoteButton` already tags notes `["quote"]`); assumptions/evidence/catalysts/risks/invalidation authored as ordinary body content, optionally templated via the already-shipped 8 trader templates; an optional trade/position link (above); and — a finding this dispatch adds, that Phase Zero's document never mentions — **`j2_verdicts` is the closest existing analog to a structured trade rationale and should be cited as an evidence source, not re-derived independently inside Notebook.** "What changed since I last opened this" is a read-time diff query against the append-only snapshot table (already a hard prerequisite Phase Zero correctly identified), not new storage. AI analysis over theses should be a tag-filtered slice of the same Ask My Notebook retrieval index, not a second pipeline.

---

## Per-Ticker Research Surface

(Dispatch 7.)

**Verdict: a dynamic reverse-index query view inside Notebook, launching into existing modals — never a Notebook-native reimplementation of chart/fundamentals rendering.** Phase Zero's own §10/§14 design (a derived reverse-index, no graph engineering) is correct and should ship as designed. **What needed direct verification, now done: there is no dedicated per-ticker/company page anywhere in UCT today** — the closest surfaces (`TickerPopup`, `EarningsResearchModal`, `ModelBook`) are all modals triggered contextually, not standalone addressable pages. This means "embed directly into the UCT company page" is currently unavailable as an option, full stop — not a criticism of Phase Zero (which never claimed one exists), but a real premise-check that came back negative and should be stated plainly. "NVDA research" inside Notebook should be a query view (architecturally identical to the existing `SavedScreensPanel`/`ScanResults` pattern — a view over rows, not a stored per-ticker record) that opens the existing modals for live content rather than re-fetching/re-rendering it natively — the same discipline Phase Zero already applies to individual embeds, extended to a Notebook-native aggregation view. If a real company page is ever built (a separate initiative), the correct relationship is Company Page → embeds a "notes about this ticker" panel from Notebook's reverse-index, never the reverse.

---

## UCT Surface Ownership

(Dispatch 7.)

**The generalizable rule:** *a capability's live, writeable, authoritative state belongs to exactly one surface — the one whose backend owns the write path and freshness/recompute logic. Every other surface, Notebook included, may only reference that state via (1) a live link/embed back to the owning surface, or (2) a frozen, timestamped snapshot. No second surface may re-implement the owning surface's computation or storage of the same fact.* Operationally: before adding any capability to Notebook, ask "does Notebook already own the freshest, most authoritative write path for this data?" — if no, link or snapshot; if yes, it's native (this only ever applies to a note's own authored prose, tags, folders, and personal thesis reasoning).

This rule isn't invented — it's the generalization of a pattern this codebase independently reached three separate times already: chart embeds are frozen-at-insert by design; `j2_trades`/`j2_positions.context_at_entry` freezes a market-context snapshot at trade entry (a second, independent instance Phase Zero never cites); scanner/watchlist results are explicitly snapshotted rather than re-run live inside a note. Three independent moments converging on the same answer is itself evidence it's the right rule.

| Surface | Owns natively | Notebook may only... |
|---|---|---|
| **NOTEBOOK** | Note prose/body, personal tags/folders, authored thesis text, frozen snapshots captured from elsewhere | — |
| **TERMINAL** (`/calendar`) | Earnings/calendar data, per-ticker earnings depth | Link/embed a frozen snapshot (already one of the 9 capture doors) |
| **SCREENER/SCANNER** | Scan definitions, live evaluation, coverage semantics | Embed a frozen result snapshot; never re-run a scan live inside an old note |
| **COMPANY PAGE** | Doesn't exist today (verified) | N/A until built; if built, Notebook feeds it, never the reverse |
| **PORTFOLIO** | Current holdings/broker truth | Reference by id + a live embed/link; never a second "position" row |
| **TRADING JOURNAL** | Trades, P&L, broker-synced state, AI coaching/verdicts/reviews/interventions | Link a thesis note to a trade/position by id; never re-implement any part of it — this is the load-bearing case for the whole rule |

**This rule is self-limiting in exactly the direction this program most needs:** it structurally prevents Notebook from becoming a dumping ground, because the default answer to "should Notebook own this" is no unless the data in question is literally a note the member wrote.

---

## Trust / Recovery

(Dispatch 8, personally re-verified by the orchestrating session — see Evidence Integrity.)

**Ground truth, verified twice over:** hard delete only, no soft-delete column, no trash table anywhere. No version-history table anywhere in the full 66-table schema. Note content and attachments are plaintext on disk and in the database — confirmed on both the note-body axis and the attachment-storage axis independently; the existing Fernet key infrastructure (`crypto_box.py`) is used only for SnapTrade broker secrets, never imported by any Notebook file.

### The headline finding: account-deletion "purge" does not reach Notebook data at all

Phase Zero characterized this as "entirely manual, no defined SLA, no automated verifiable purge." **True, but materially incomplete — when an admin does manually execute a deletion, Notebook data is not deleted.** The cascade-delete mechanism (`_cascade_delete_user`) discovers what to clear at runtime via `PRAGMA foreign_key_list`, deleting only rows in tables that declare an explicit foreign key to `users(id)` — a deliberate hardening after a previous hand-maintained table list silently fell ~24 tables behind. **Zero of the 54+ `j2_*` tables declare that foreign key** — independently confirmed by this session's own direct grep of the schema, returning zero matches for `REFERENCES users` or `FOREIGN KEY` across the entire file. The function's own docstring claims coverage of "journal/j2_*" that the schema does not actually provide. `j2_notes` lives in the exact same physical database and connection as `users` — this is not a scoping or cross-database issue; the mechanism simply never touches these tables. The one place this is handled correctly is SnapTrade broker data, which has a bespoke, deliberately-written purge run before the cascade — strong evidence the Notebook gap is an oversight of scope, not a considered decision (broker data got special handling because someone specifically reasoned about its compliance shape; a member's notes and journaling did not).

**Net effect: a member who formally requests account deletion and is told it was processed still has every note, folder, trade, position, verdict, review, intervention record, and chat-history row sitting in the database indefinitely, orphaned under a nonexistent user.** This is a live data-lifecycle gap in production today, independent of this program's roadmap, with likely privacy/compliance relevance (the kind of exposure "right to be forgotten" regulations are aimed at) — **this review does not make a legal determination and is not positioned to**, but recommends this be raised for prompt attention on its own timeline, separately from and likely ahead of the Notebook feature roadmap, because it compounds with every new capture surface this program ships on top of it (every "send to Notebook" capture, and especially "Ask My Notebook," adds another row that a "deleted" member can never actually have removed).

**The fix is small.** Either add the missing `FOREIGN KEY ... REFERENCES users(id)` declarations to the `j2_*` schema (letting the existing, otherwise-correct discovery mechanism work as its own docstring already claims it does), or write a bespoke `journal_two.purge_on_account_deletion` mirroring the broker-data purge that already exists as a working template.

### Tiering

**Trust foundation (all three currently fail):** trash/undo-delete — absent; version history — absent; verified account-deletion purge — absent, and the existing mechanism actively fails to cover Notebook, which is the most severe of the three because it is a present-tense data-rights exposure, not a UX gap.

**Sequencing argument, stated more forcefully than Phase Zero:** the account-purge gap should be sequenced strictly before universal snapshot semantics and Ask My Notebook, not merely tagged P0 alongside them — building AI retrieval and richer capture on top of a data store that cannot honor a deletion request compounds the exposure with every subsequent feature rather than sitting beside it. None of the fixes are architecturally hard.

---

## Performance / Scale

(Dispatch 8.)

**What's genuinely well-engineered, verified directly:** honest pagination and counting (no derived-from-a-loaded-page counts); export streams to disk with bounded peak memory and a platform-wide concurrency-of-1 semaphore with lease/sweep logic, built specifically in response to a documented prior OOM incident; the enrichment-scan endpoint is correctly a sync route (thread-pool-offloaded, not blocking the event loop) with an honest truncation contract.

**Sharper thresholds than Phase Zero's framing:** the folder-sidebar defect's trigger axis is per-folder, not per-library — realistically member-visible at the **1,000-note tier** for a trader with one running catch-all folder, not only at 50,000+. FTS5 read-latency risk is a function of **platform-wide** note count matching a search term, not per-user note count — a different scaling axis than the assignment's per-user tiers assumed, verified as a mechanism (global shared table, `UNINDEXED` post-filter) though not as a measured number. Export's unbounded `fetchall()` is real but lower-severity than "unbounded" implies, given it's already the sole thing behind a hardened, disk-streaming, concurrency-limited pipeline — it only bites at the 50,000+-notes-for-one-user tier.

**New finding beyond Phase Zero: a blocking schema/reindex migration is a real, if currently latent, boot-time hazard.** Notebook schema initialization runs synchronously inside the app's async `lifespan()` on the single shared event loop — today idempotent and already-run, so not a live risk, but the *next* Notebook schema/index migration that needs a full FTS rebuild would block the entire event loop, for every user, including health checks, for as long as that rebuild takes — and because the FTS table is global, the blast radius grows with total platform notes at whatever future date that migration ships. Recommend any future notebook migration touching the FTS index at scale run as a background job, matching the pattern this codebase already uses elsewhere.

**Ask My Notebook's per-user-keyed index needs an explicit operational constraint the roadmap should state up front, not discover after the fact:** "per-user-keyed" must not silently become "every active user's matrix held resident in the one shared process" — an LRU-evict-or-load-on-demand design, scoped to concurrently *active* users rather than total users, is a materially different and less bounded scaling axis than anything else in this document.

**Platform-wide axis:** media/attachment storage and the global FTS index both scale with aggregate platform activity, not any one user's tier — a real, measured production anchor (78.42GB volume, 63.57GB free, attachments currently negligible) shows this is a non-issue today and becomes a real constraint only if attachment adoption grows substantially platform-wide.

---

## Security / Privacy

Synthesizing dispatches 3, 5, and 8: cross-user query isolation (`WHERE user_id = ?` everywhere) was independently rated A-grade by Phase Zero's own dedicated security pass and is carried forward, not re-audited by this review. Two real conflicts surfaced that Phase Zero's cost estimates don't reflect: **encryption at rest would break the live plaintext-fed FTS5 index** (naive column encryption makes SQLite's own tokenizer unable to index note content) — the hard part is an architecture that keeps search working under encryption, not key management, which is already solved elsewhere in the codebase. **Any future "Ask Notebook + UCT" scope inherits the AI_RETRIEVAL_ALLOWED policy boundary** Phase Zero already named as its single most important finding — this becomes load-bearing the moment personal notes and vendor-sourced data are synthesized together in one answer, and should stay explicitly gated on the external legal review, not built past. The account-deletion cascade finding above (Trust/Recovery) is, at its core, also a security/privacy finding and should be read as such.

---

## Competitive Moat

(Dispatch 9.)

| Idea | Classification | Verdict on Phase Zero |
|---|---|---|
| Entity/mention layer | FEATURE, weak workflow advantage | **Correctly already called "not a moat" by Phase Zero itself** |
| Cross-UCT capture / Save-to-Notebook | Structural moat at the platform level, thin at the feature level | **Overstated** — a trader can screenshot UCT data into Obsidian today and lose only auto-freeze convenience, not the information; whether a captured note makes UCT *primary* or just a secondary scratchpad is untested |
| Longitudinal thesis history / snapshot table | Compounding if built correctly, trust hazard if built wrong | Phase Zero's alarm level here is correctly matched to the stakes |
| Temporal snapshots ("frozen at insert") | Compounding, but currently proven for one data type only | **Overstated** — the flagship evidence (chart embeds) is itself only partially frozen (daily+ timeframes re-fetch indefinitely by design), and the highest-risk generalization target (estimates/ratings) is 100% unbuilt |
| Private-note + market-intelligence fusion (Ask My Notebook) | Structural moat today, shrinking half-life | UNVERIFIED but flagged: horizontal platforms adding market-data connectors could erode this over 12-18 months — re-evaluate, don't treat as settled |
| Accumulated personal research relationships | The strongest candidate — but structurally unavailable during exactly the window that decides switching | **Phase Zero never names this tension** |

**The unexamined tension this review adds:** the thing that would make a member never want to leave (years of time-stamped research tied to their own outcomes) cannot exist for anyone deciding whether to switch. The entire acquisition case has to rest on feature-tier parity items (search, trash, export, snapshot embeds), none of which rise above "meet parity" or "thin structural moat" — the compounding moat is a *retention* thesis, not an *acquisition* thesis, and Phase Zero's constitution markets it as "the strategic moat" without that caveat.

**The primary-vs-secondary problem:** nothing in Phase Zero's moat analysis tests the most likely realistic outcome — UCT Notebook becomes where financial captures land while Obsidian/Notion remains the actual system of record. This is arguably the *most probable* result of this program succeeding on its own terms, and it is not "Primary Notebook Ready" by Phase Zero's own current definition, which is exactly why the North Star and Definition-of-Ready sections of this review revise that definition to make this hybrid outcome an explicit success state rather than an implicit failure.

---

## First 30 Minutes

(Dispatch 9. **Every statement below is a reasoned scenario grounded in Phase Zero's own documented, code-verified gaps — never an observed complaint or quote.**)

**Former Notion user:** will look for a database/relations/multi-view toggle within minutes (confirmed absent) and search for "AI"/"ask" (confirmed absent, 100% greenfield) — two immediate, evidence-grounded misses. Reassured, per Phase Zero's own §13 guidance, by proof their migrated content survived intact, not a feature tour.

**Former Evernote user:** a meaningful slice arrives already resentful (Phase Zero's own sourced pricing-shock research), and will first test whether search works on their real content. Will look for the web clipper and not find one — a deliberate, defensible call, but a real, documented blocker being knowingly left open. Reassured by UCT's genuinely superior, verified export.

**Former Obsidian user — highest trust bar, and the persona most likely to trip a known bug at the worst moment.** Will check backlinks within minutes (confirmed absent) and whether storage is "just files" (it isn't — plaintext-at-rest, but cloud, not local-by-default, which §27 already correctly identifies as the actual distrust trigger, distinct from whether export technically works). **A concrete, high-probability first-week failure specific to this persona, new to this review:** Obsidian power users routinely carry 1,000-10,000+ note vaults, and this is exactly the persona most likely to hit the folder-sidebar undercount bug — already known, already downgraded in severity — while doing their own post-migration spot-check, the very self-verification behavior Phase Zero's own trust design recommends encouraging. The highest-value, hardest-to-convert persona is statistically the one most likely to trip the one already-known scale bug during the exact moment meant to build their trust.

---

## First 7 Days

(Dispatch 9.)

Phase Zero's hypothesis that reopen-old-app triggers cluster on day 2-3, driven by one failed retrieval, is well-reasoned and not disputed. Two refinements: **the trigger differs by persona and the proposed instrumentation is persona-blind** — a Notion user's day-2-3 failure is more likely a *structuring* failure (can't build the view they need) than a retrieval failure, which "search with no satisfying click" wouldn't catch; an Obsidian user's failure may register as a successful click (found *some* notes) while still failing the actual check (didn't find *all* of them) — recommend instrumenting "result count materially below expected corpus size" as a second, distinct leading indicator. **A thesis-before-earnings retrieval benchmark is ambiguous about push vs. pull**, and the roadmap only builds half of it (the pull-based changelog; proactive alerting is explicitly and correctly deferred) — worth resolving explicitly which behavior a first-week success definition assumes, rather than leaving it implicit.

---

## Benchmark Suite

(Dispatch 9.)

Most P0/P1 items map cleanly to a benchmark task. The gaps cluster into three distinct types, not one:

**(a) Appropriately unmapped** — legal review, encryption, account-deletion purge are compliance/trust properties, not user-facing capabilities; no concern.

**(b) Real coverage gaps:** filings/news provenance (discussed in prose but absent from the actual P0-5 snapshot-extension build list); the single-uvicorn-process architectural risk (see Pre-Mortem #5); mobile capture (never explicitly triaged either way); citation-verification as its own testable affordance (currently folded thinly into "grounded/cited," underspecified).

**(c) Apparent duplication with an already-shipped surface — the more serious finding type, since it's evidence scope was drawn without checking the rest of the same codebase.** "Review a trade against the original plan" maps to the proposed Trading Journal Review note — which Compass's shipped Per-Trade Post-Mortem already does. "Screener → saved research," Phase Zero's own flagship example of its trading-journal moat, rests on a capability that is **not among the 9 confirmed capture-door widgets** — Scanner/Screener is absent from that list, an internal contradiction inside Phase Zero's own document worth flagging plainly: its best example of structural advantage over external competitors is not confirmed to exist and is not explicitly scheduled to be built.

**One genuine oddity:** "Migration trust UI" (P1) maps to no benchmark task and may be a holdover from the closed migration program bleeding into this roadmap rather than a Notebook-platform deliverable in its own right — worth a deliberate check.

---

## Architecture Pre-Mortem

(Dispatch 9. Premise: this program fails 18 months from now. Ranked by probability × impact.)

**#1 — Fragmented UCT surface ownership: two AI systems and two trade-review mechanisms doing overlapping jobs. Probability HIGH (already partially underway), Impact HIGH.** Compass already ships Pre-Trade Verdict, Per-Trade Post-Mortem, discipline scoring, and tilt intervention. Adding a second, separate AI surface (Ask My Notebook) with its own grounding convention gives a member three places that might answer "should I trust this trade," with no stated reconciliation — while a parallel initiative elsewhere in this codebase ("Compass ↔ Voice Assistant unification, one brain, shared memory") already exists specifically to fix this exact failure mode for a different pair of surfaces. **Mitigation:** expose note retrieval as tools inside Compass's existing registry, mirroring the already-proven `brain_service` facade pattern; scope the Trading Journal link as an extension of Compass's existing Per-Trade Post-Mortem, never a parallel object.

**#2 — Feature discoverability: shipped-but-unreachable, a proven repeat pattern in this exact codebase. Probability HIGH (base-rated from this repo's own documented history, not a generic risk), Impact HIGH.** This codebase's own documentation lists roughly ten prior instances of exactly this failure — built, tested, then orphaned or never wired to a reachable route — plus an explicit "8 features built, tested, green, connected to nothing" prior finding, and rails built specifically because component-level green tests kept passing while the actual wire was cut. Any Notebook P0 item shipping into this same pattern would be invisible to component tests and read internally as "done" while unreachable to members — the worst possible failure mode for a trust-recovery feature specifically. **Mitigation:** require the same two-rail discipline this codebase already invented for this exact problem (an AST-based reachability test from the real route tree, plus an unmocked mount test on the actual wiring path) before any Notebook P0/P1 item is considered shippable.

**#3 — Unclear/incomplete temporal semantics corrupting trust. Probability MEDIUM-HIGH, Impact CATASTROPHIC if it happens.** The flagship evidence that UCT already knows how to do this correctly is itself only partially frozen by design, and the highest-danger extension is entirely unbuilt, resting on a not-yet-designed snapshot table that every downstream feature depends on getting right once. **Mitigation:** treat the snapshot table's schema as a one-way door requiring its own dedicated adversarial review before it ships.

**#4 — AI hallucination eroding trust, compounded by #1 and #3. Probability HIGH, Impact HIGH.** For this specific audience, a single visible hallucinated fact is disproportionately damaging (the product's entire pitch is a trust claim, not a convenience claim), and a user can't tell whether a wrong number came from a stale snapshot or a fabricated fact unless the UI distinguishes them structurally. **Mitigation:** ship citation-verification as its own explicit, independently testable P0 sub-deliverable, not an implicit property of "grounded/cited."

**#5 — Single-process architecture ceiling: identified, then dropped from prioritization entirely. Probability MEDIUM-HIGH if the program succeeds on its own terms, Impact HIGH.** Phase Zero's own §22 names this "the single largest architectural risk" in the entire research program, with a real documented precedent (a prior 524 outage from anyio-threadpool exhaustion + SQLite write contention) — and it then appears in no P0-P3/Experiment/Do-Not-Build tier anywhere. It's unclear whether this was a deliberate scoping choice or an oversight; either way, no one currently owns it on the Notebook roadmap. **Mitigation, and this review's own explicit disposition since Phase Zero left it undecided:** assign this Experiment/Validate-First, owned by platform infra, with a concrete revisit trigger (N concurrent Notebook users, or the first Notebook feature requiring an unbounded per-request DB scan) — a known, owned gap rather than an invisible one.

---

## Information Architecture

Synthesizing the entity, temporal, provenance, and surface-ownership findings above into one coherent model: **every fact Notebook touches is either (1) a member's own authored prose/tags/folders (native, mutable, owned by Notebook), (2) a link/reference to another surface's live authoritative state (never duplicated), or (3) a frozen, timestamped, object-level-provenanced snapshot of what another surface showed at a point in time (captured once, never silently rewritten).** Every content type this program has examined — chart, fundamentals, estimates, watchlist, scanner, calendar, trade, position, AI answer — resolves cleanly into exactly one of these three buckets, and the three-tier entity model (CONFIRMED/STORED/SUGGESTED) and the object-level provenance idiom (`mode`/`captured_at`/attrs bag) are the same mechanism applied to "which ticker" and "where did this come from" respectively. This is not a new architecture to design — it's the generalization, stated once, of five independently-arrived-at instances of the identical discipline already present in this codebase (chart embeds, trade context-at-entry, watchlist/scanner freezing, the embed-attrs provenance bag, and the CONFIRMED/STORED/SUGGESTED entity split). Any future capability proposed for Notebook should be checked against this model before being scoped, not designed fresh each time.

---

## Revised Priorities

**Urgent, platform-wide, outside the Notebook roadmap's normal sequencing:** fix the account-deletion cascade's foreign-key gap (Trust/Recovery). This is a live data-lifecycle defect affecting all of Journal 2.0 today, not a Notebook feature — recommend it be raised for prompt attention on its own timeline.

**P0 (foundation/switching-blocker, cheap, low-risk — the bar every item here should meet):**
1. Legal/compliance review of the vendor-data capture door (external track, unchanged).
2. Note trash + undo-delete.
3. Folder-sidebar leaf-row correctness fix (the search-latency half is a verification task, not an engineering item — do it, don't roadmap it).
4. Derived entity/mention layer — now a small remaining slice (sector/earnings-window join + persist suggested mentions + fix the class-share cashtag bug), not new-build.
5. Universal snapshot semantics — reframed: build the first analyst-estimates/ratings capture path (net-new), the structured fact ledger (shared with item 6), and fix the Calendar embed's forward-looking bug.
6. Ask Current Note (the true P0 slice of the former "Ask My Notebook" item).

**P1 (major retention/differentiation):**
- Save-to-Notebook maturation — now small (destination-menu wiring, comment field, `tradeRef` completion).
- Ask Notebook (corpus-wide, lexical+entity basis only, no vectors).
- Thesis changelog (note + tag + read-time diff, citing `j2_verdicts`).
- Encryption at rest (gated on a design spike resolving the FTS5 conflict).
- Account-deletion self-serve trigger + SLA (distinct from, and downstream of, the urgent FK-gap fix above).
- Trading Journal link/cross-nav layer (replacing the rejected object-model proposal).
- Per-ticker research surface (reverse-index view, launching into existing modals).
- Version history (with the Product Constitution's internal search/trash/version-history tension flagged for an explicit owner decision).
- Read-only offline cache of recently-viewed notes.
- Local draft safety net.

**P2:** migration history log; team-adjacent light sharing (true first step: define an account/team boundary primitive — this is not yet a UI task).

**P3:** unchanged (canvas/visual-mapping tooling, guided completion tour).

**Experiment/Validate-First:** full multi-hop knowledge graph; proactive thesis-invalidation alerting; public API/extensibility surface; full offline-first architecture; semantic/vector search (evidence-gated, sequenced last); a bookmarklet-first "financial research capture extension" (narrowed from the general-clipper rejection); **resolving whether the professional-analyst/PM persona's real competitive set is Notion/Evernote/Obsidian at all, or Excel/Bloomberg/FactSet/internal wikis** — the single most consequential open question this review did not have the data to close.

**Do-Not-Build:** general web clipper; full third-party plugin marketplace; enterprise collaboration depth; one-click full-migration rollback (full-account scope); Notion-style external developer Agents platform; **a new Trading Journal object model built inside Notebook** (the proposal itself, not merely its priority, is overturned); **a second, disconnected AI chat surface for Ask My Notebook that doesn't integrate with Compass's tool registry.**

---

## Revised Dependency Graph

The critical path is unchanged in shape from Phase Zero's own conclusion — the snapshot-semantics prerequisite gates everything AI/financial-native downstream, not the AI feature itself — but the account-purge fix now sits ahead of that entire chain as a zero-dependency, high-urgency item that should not wait on any wave:

```
[URGENT] Account-deletion FK gap fix (no dependency, do first, small)
   │
   ▼
Legal/compliance review (external, parallel) ──┐
                                                 ▼
Trash/undo-delete ── Folder-sidebar fix ── Search verification (Wave 0 trust items, parallel, no cross-dependency)
                                                 │
                                                 ▼
Entity/mention layer (small remaining slice) ──► Ask Current Note (small, few dependencies — could ship nearly as early as Wave 0/1)
                                                 │
                                                 ▼
Fact ledger + first analyst-estimates capture path (the real remaining "snapshot semantics" work)
                                                 │
                    ┌────────────────────────────┼────────────────────────────┐
                    ▼                             ▼                             ▼
        Ask Notebook (P1, needs fact          Thesis changelog (needs      Trading Journal link layer
        ledger + entity layer +               fact ledger + entity         (needs only trade/position
        entity-anchored search stage)         tagging convention)          ids — minimal dependency)
                    │
                    ▼
        Ask Notebook + UCT (Experiment, gated on external legal review — no earlier)
```

Encryption-at-rest, offline (read-only cache + draft safety net), and collaboration's account/team-boundary prerequisite are independent side-branches with no dependency on the chain above and can be sequenced opportunistically.

---

## Revised Implementation Waves

**Wave -1 (new) — Platform trust fix:** account-deletion cascade FK gap. No dependency, small, urgent, precedes everything below in spirit even though it isn't Notebook-specific work.

**Wave 0 — Foundation/Trust:** legal review (parallel, external), trash/undo-delete, folder-sidebar correctness fix, search-latency verification (due diligence, not engineering). *Given how small it turned out to be, also consider pulling the Save-to-Notebook destination-menu wiring into this wave* — it's now a UI task against already-built infrastructure, not new interaction design.

**Wave 1 — Core UX polish:** unchanged in spirit (quick-switch, breadcrumbs — real but not urgent); add the local draft safety net here, since it's near-free.

**Wave 2 — Capture maturation:** shrunk to comment field + `tradeRef` completion + verifying/wiring the destination menu if not pulled into Wave 0.

**Wave 3 — Entity/mention layer:** shrunk to the sector/earnings-window join, persisting suggested mentions, and the class-share cashtag fix — still early, still cheap, unchanged position.

**Wave 3.5 — Snapshot semantics, reframed:** build the first analyst-estimates/ratings capture path (genuinely net-new, bigger than "extend" implied); build the fact ledger (shared with Wave 5); fix the Calendar embed bug.

**Wave 4 — Search, resequenced per the evolution strategy:** Stage 0 verification + date filter + snippet/highlight wiring (cheap) → Stage 1 entity-anchored retrieval (rides Wave 3) → semantic/vector search moves out of this wave entirely, to Experiment, evidence-gated, much later than Phase Zero's original placement implied.

**Wave 5 — AI Notebook, split:** Ask Current Note ships early (could run as early as Wave 1/2, given how cheap it is) → Ask Notebook (P1) depends on Wave 3.5's fact ledger + Wave 3's entity layer + Wave 4's entity-anchored retrieval → Ask Notebook + UCT stays Experiment, blocked on the external legal review, no earlier.

**Wave 6 — Financial-native blocks:** mostly folded into Wave 3.5 now, given how much was already shipped; remaining work is the net-new analyst-estimates capture path.

**Wave 7 — Thesis + Trading Journal, dramatically shrunk:** thesis changelog (note+tag+diff, citing `j2_verdicts`); Trading Journal object model rejected and replaced with a small link/cross-nav layer to the existing system — build only the pre-trade thesis-linkage half, the one piece with no existing analog.

**Wave 8 — Collaboration:** unchanged position, P2, validate-first; explicit new dependency named — define the account/team boundary primitive before any lighter sharing feature, including comments.

**Wave 9 — Mobile/offline/extensibility/polish:** offline split further — read-only cache of recently-viewed notes promoted as its own small, cheap P2 item ahead of full offline-first (stays Experiment); the bookmarklet-validated financial-capture-extension carve-out can run independently at any point, low cost, no wave dependency.

**Cross-cutting constraint on Waves 5 and 7 (from Architecture Pre-Mortem #1):** Ask My Notebook and the Trading Journal link layer must be designed as extensions of Compass's existing tool registry / Per-Trade Post-Mortem, never as parallel, disconnected systems.

---

## Primary Notebook Beta Definition (revised)

Given the revised north star (system of record, alongside — not full replacement) and revised beachhead (the active/swing trader already inside Journal 2.0 + Compass + broker sync), the smallest coherent Beta is materially smaller than Phase Zero's original wave plan implied, precisely because so much of what looked like greenfield work turned out to already be shipped:

A member of the primary beachhead persona can reliably: **capture** (already live, 9 widgets) → **write** (already live, strong editor) → **organize** (already live, folders+tags) → **search** (once the folder-sidebar bug is fixed and the latency question is closed) → **link** (a thesis note ↔ an actual trade, via the new small link layer) → **retrieve** (the per-ticker reverse-index, already cheap and mostly built) → **recover** (trash/undo, to be built) → **export** (already live, genuinely strong) → **save from UCT** (already live) — **and** receive at least one concrete, currently-absent financial advantage: Ask Current Note (cheap AI over the note they're looking at) plus the entity/mention layer's retroactive "everything I've written about NVDA" reverse-index (already ~75% built) plus a trade genuinely linked to the thesis that preceded it.

This Beta does not require Ask Notebook (corpus-wide AI), encryption at rest, version history, or any collaboration feature to be true — those remain real, valuable P1/P2 work, sequenced after.

---

## Ultimate End State (revised)

Keep Phase Zero's separation between **Primary Notebook Ready** and **Financial Research Platform Differentiated**, but revise both definitions to match the narrowed north star:

**Primary Notebook Ready (revised):** a representative member of the primary beachhead persona no longer needs a separate scratch space for their trading/investing research and decisions — the alongside model, not full displacement of their general notebook, is an explicit success state, not a fallback. Measured against real usage (does the member's financial research actually accumulate in UCT over months), not roadmap completion.

**Financial Research Platform Differentiated (revised, unlocked only after):** the account-deletion gap is fixed; the trust foundation (trash, search correctness) is real; Ask Notebook (corpus-wide) and the full snapshot-semantics extension (including analyst estimates) are live; the trading-journal link layer and thesis changelog are live; **and** the professional-analyst/PM persona question has been resolved with real usage data, not assumption — only then does it make sense to expand deliberate investment toward those personas specifically, rather than continuing to over-serve a persona (fundamental investor/analyst/PM) the product's own current architecture was never actually built for.

---

## Corrected Product Constitution

Red-teaming Phase Zero's 15-element constitution (§33) item by item:

1. **Primary user** — **REVISE.** Narrow to the active/swing trader as primary beachhead; fundamental investor and serious individual investor served via the alongside model as secondary; professional analyst and institutional PM deferred pending resolution of the unexamined employer-compliance risk and the open question of whether their real competitive set is Notion/Evernote/Obsidian at all.
2. **Primary job** — **REVISE.** Drop "without needing Notion/Evernote/Obsidian for a high-value everyday workflow" (implies full replacement). Replace with: the system of record for a member's tickers, positions, trades, and theses — used alongside a general notebook, not instead of it.
3. **Product promise** — **REVISE.** Drop the "Notion + Evernote + Obsidian + UCT Financial Intelligence" framing. Replace with: the research/decision layer for the trading and investing workflow UCT members are already inside.
4. **Core UX principles** — **KEEP.** Default simple, advanced optional; every structural concept opt-in scaffolding on a plain note. Confirmed correct, and confirmed to be exactly what constrains Thesis Intelligence's design correctly (note+tag, never a new mandatory object).
5. **Trust principles** — **KEEP the substance, REVISE the scope.** "Self-verifiable migration proof beats vendor assertion" rescopes from "prove your whole migrated vault survived" to "prove the financial notes you brought over or captured are trustworthy," matching the alongside model. **Add:** a verified, working account-deletion purge is equally non-negotiable — and is currently false today, a live gap, not a future roadmap item.
6. **Data/provenance principles** — **KEEP, unchanged.** Confirmed correct and confirmed to already be the house idiom three times over — the work is extension, not invention.
7. **AI principles** — **KEEP, with an addition.** Add the explicit architectural constraint: Ask My Notebook must not become a second, disconnected AI chat surface — it should integrate with or explicitly reconcile against Compass's existing tool registry.
8. **Financial research principles** — **KEEP.** Confirmed correct, and confirmed both more at-risk than thought in one place (the Calendar embed bug) and less exposed than thought in another (analyst estimates can't be captured at all yet, so there's currently nothing to corrupt there).
9. **Portability principles** — **KEEP.** Confirmed genuine strength, independently re-verified (disk-streaming export, hardened against prior OOM incidents).
10. **Performance principles** — **KEEP, SHARPEN.** Add: track platform-wide metrics explicitly, not only per-user note-count tiers — several real risks (FTS5 read cost, a future blocking reindex migration) scale with total platform activity, not any one member's library size.
11. **What we will match** — **KEEP, but resolve an internal tension.** Search, trash, version history, and export are named as one trio of trust-parity bars, yet only two of three sit in P0. Either justify the split explicitly or promote version history — currently an unstated judgment call.
12. **What we will exceed** — **REVISE the framing, not the ambition.** "No competitor has this at all" for temporal correctness is aspirational, not current — proven today for one narrow slice (intraday chart embeds) only. State it as the target the fact ledger + analyst-estimates capture path unlock, not a present-tense claim.
13. **What we will not build** — **KEEP the four items, ADD two narrower carve-outs that don't violate the spirit:** a bookmarklet-based financial-document capture (not a general clipper) and a scoped single-import-batch undo (not a full rollback) are Experiment-worthy, not blanket-rejected.
14. **Our strategic moat** — **REVISE.** The frozen-at-insert pattern is not yet "extended universally" — state this as the target. Add the finding that this is a compounding/*retention* moat, invisible to a new user in the first 30 minutes — the roadmap must not conflate "we will have the strongest long-run moat" with "we have the strongest reason for someone to switch today."
15. **Definition of "Primary Notebook Ready"** — **REVISE** to match items 1-3 above; see Primary Notebook Beta Definition and Ultimate End State, revised. Explicitly acknowledge that a hybrid "UCT for financial captures, old tool for everything else" outcome is a plausible **success** state under this constitution, not a failure to fix later.

---

## Open Questions

Carried forward from Phase Zero, still open:
- UCT's actual contracted FMP/Massive terms and Anthropic/OpenAI data-handling terms — requires the real contracts, not more research.
- Post-fix FTS5 read-query latency at real scale — now more precisely characterized (depends on platform-wide term-matching, not per-user count) but still not benchmarked.
- Whether UCT's target personas want any team/collaboration depth at all — genuinely needs usage data, not more competitive research.

New, surfaced by Phase One:
- **Does the professional-analyst/PM half of the stated persona list actually compete against Notion/Evernote/Obsidian at meaningful rates — or is their real "switching-from" set Excel/Bloomberg/FactSet/internal wikis, a set this entire research program never examined?** The single most consequential open question from this review.
- Is a sell-side/buy-side analyst even permitted to put employer-owned research in a personal consumer SaaS notebook? Unexamined, plausibly disqualifying for that persona regardless of features built.
- Is any current SQLite/FTS5 usage in this codebase compatible with a SQLCipher-style whole-database encryption approach that wouldn't break search? Found the conflict; did not verify a fix.
- Is the `tradeRef` attribute on widget embeds actually populated by any current frontend writer, or is it unwired scaffolding? Schema-ready either way; unconfirmed which.
- Real usage telemetry: how many current Notebook users actually have >100 notes in one folder? Bears directly on how urgent the folder-sidebar fix is in practice versus in principle.
- Could a determined Notion/Obsidian power user approximate the "Ask My Notebook + UCT" fusion moat via existing agent/connector features? Plausible, not checked against current competitor capability documentation.
- Does real member demand exist for a narrower "financial research capture extension" specifically (versus the rejected general clipper)? Neither Phase Zero nor Phase One tested the narrower concept with users.

---

## Evidence / Sources

This artifact synthesizes nine independent dispatch reports (internal working documents, not committed to the repository, produced 2026-09-05 in this session) plus direct source verification performed by the orchestrating session. Every current-UCT claim throughout this document traces to a file:line citation given within the relevant section above, verified against the repository at commit `c882f426d` on branch `notebook-primary-platform`. The two claims independently re-verified by the orchestrating session before synthesis (the account-deletion FK gap; `CaptureInboxTray`'s existence and commit ancestry) are documented in full under Evidence Integrity, above. See the companion research ledger (`competitive-research-ledger.md`) for the full per-dispatch audit trail, updated in this same session to record this Phase One batch.

No external competitor research was independently re-conducted in this phase beyond what dispatch 2 sourced for specific, narrow audience-fit questions Phase Zero's own analysis left untested (cited inline in Competitor Blocker Challenges, above, each explicitly labeled with its evidence class). All other competitor claims are Phase Zero's own already-graded findings, reused and attacked, not re-sourced.
