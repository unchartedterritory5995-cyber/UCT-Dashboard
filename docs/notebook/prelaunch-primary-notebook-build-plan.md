# UCT Notebook — Pre-Launch Primary Notebook Build Plan

**Status:** Authoritative implementation-level roadmap beneath the strategic docs
(`primary-platform-master-product-spec.md`, `-master-architecture.md`,
`-implementation-plan.md`, `-decision-log.md`, `ultimate-notebook-competitive-roadmap.md`,
`competitive-gap-ledger.md`, `notebook-ux-ui-competitive-ledger.md`,
`primary-notebook-readiness-scorecard.md`, `stage-a-member-validation.md`,
`wave4-search-evolution-i-prep.md` + `-implementation-readiness.md`). Created 2026-09-06
per the governing "Complete Pre-Launch Primary Notebook Construction Program" directive,
which changed the program's operating posture — see §2 and the decision log's
"OPERATING POSTURE CHANGE" entry (2026-09-06).

**How to use this document:** it does not replace the strategic docs above — it
sequences and classifies the work they already define, adds the pre-beta/pre-launch/
post-launch/long-term tiering the strategic docs did not previously carry, and folds in
a fresh 2026 competitive refresh (Notion/Evernote/Obsidian) so the roadmap reflects
current competitor reality, not a stale 2026-09-05 snapshot.

---

## 1. North Star

**UCT Notebook must become a serious PRIMARY NOTEBOOK / FINANCIAL RESEARCH PLATFORM.**
For active traders, swing traders, investors, fundamental analysts, technical analysts,
portfolio managers, financial researchers, and finance-focused power users, the product
must satisfy BOTH:

- **Notebook competitiveness** — for important everyday notebook/research/knowledge
  workflows, UCT should no longer feel materially inferior to Notion, Evernote, or
  Obsidian.
- **Financial superiority** — UCT should understand securities, companies, market data,
  charts, watchlists, screens, portfolios, positions, trades, theses, catalysts,
  filings, transcripts, earnings, estimates, analyst activity, news, and temporal
  market context in ways generic notebooks structurally cannot.

Target user reaction: *"I can do my serious notebook and research work here without
needing another notebook because UCT is missing something important,"* and *"UCT gives
me financial context and intelligence that my old notebook never could."* A member may
still **choose** to keep another notebook for out-of-scope workflows (general journaling,
unrelated projects) — that is a legitimate permanent outcome, not a gap to close. A
member forced back to an incumbent because UCT **cannot** do an in-scope workflow is a
real gap that has not reached Stage C (see `primary-platform-master-product-spec.md` §4.3
for the full Stage A/B/C definitions, unchanged by this document).

Do not sacrifice notebook quality for financial intelligence, or financial intelligence
for notebook parity. Both are required.

---

## 2. Operating Posture

**Previous posture (2026-09-06, same day, earlier entry):** the Stage A→B gate (Early
Signal Gate) blocked Stage B member-facing implementation (Wave 4+) until real-member
behavioral evidence existed.

**Current posture (this document, same day, later entry — explicit owner decision,
recorded verbatim in the decision log):** UCT Notebook is confirmed to still be in
**pre-launch product construction**. Stage A instrumentation keeps running and its
evidence continues to inform, refine, reorder, and challenge this roadmap — but it no
longer functions as a blanket engineering stop on foundational parity/UX/trust/
organization/retrieval/financial-intelligence/platform/mobile work that any serious
pre-launch product needs regardless of a 2-person early cohort's clicks.

**What is unchanged:** the Early Signal Gate's own definition, the Stage A cohort
definition, tenant isolation/security/deletion-lifecycle discipline, and the per-wave
vertical-slice + certify + stop-and-report discipline (§129 of the governing directive
— autonomy applies WITHIN a wave, not across the whole remaining roadmap).

---

## 3. Current Verified State (2026-09-06)

Verified this session against **actual code**, not doc claims alone (see §38 for every
place a doc disagreed with code and how it was resolved).

**Shipped, live in production, this session's own direct code verification or earlier
session verification, re-confirmed:**
- Wave -1: Account-deletion purge (`account_purge.py`, all `j2_*` tables covered).
- Wave 0: Trash/undo-delete, folder-sidebar correctness fix, local draft safety net.
- Wave 1: Save-to-Notebook destination-menu completion (partial — see G-040), entity/
  mention layer (ticker filter + prose-mention detection), `tradeRef` wiring.
- Wave 2: Ask Current Note.
- Wave 3: Thesis-Trade Link (typed `tradeRef`/`tradeRefType`, resolver, bidirectional
  nav) — **regressed** (3 of 5 UI entry points silently failed to create the link) and
  **re-fixed same-session** via the authorized "Bucket A" remediation (thesis-link
  creation across all 5 entry points, `LinkedNotesPanel` mounted on the open-position
  view, note-load error/retry state, 3 raw-error-leak surfaces sanitized) — live-verified
  end-to-end in the fail-closed sandbox, deployed to production (`d274beda3`).
- Wave 4 prep: FTS5 read-latency benchmarked at platform scale, query correctness
  proven, date-range index validated (not yet built), snippet/highlight production
  design complete, ranking design (`bm25()`) complete, entity-anchored (sector/theme)
  filter design complete. **This wave is fully implementation-ready — see §15.**

**Confirmed absent or partial, direct code re-verification this session where noted:**
command palette (Notebook has zero participation in the app-wide `CommandPalette.jsx`),
favorites, recents, saved views, structured properties/views, version history,
encryption at rest, note-to-note link authoring UI (import-path linking works),
find-in-note, single-note export, trade-link references on export, PDF/document
attachments, OCR, mobile capture, offline (beyond the local draft safety net), the
fact/snapshot ledger, analyst-estimates capture path, thesis structured fields,
per-ticker research surface, tasks/reminders, collaboration/comments/team workspaces
(public share link exists, dark), public API/webhooks, third-party plugin marketplace
(rejected).

Full row-by-row status: `competitive-gap-ledger.md` (68 rows, G-001–G-106, all
classified — see §9 for the pre-beta/pre-launch/post-launch/long-term tiering this
document adds on top).

---

## 4. Target Personas

Unchanged from `primary-platform-master-product-spec.md` §3:

| Persona | Status |
|---|---|
| Active/swing trader | **Primary beachhead** — confirmed by direct product inspection (8 trader-ritual templates, Compass's 10-category onboarding). |
| Serious individual investor / "PM of own capital" | Secondary — same infrastructure, low incremental cost. |
| Fundamental investor / equity researcher | Secondary, alongside model only — capture bridge into their real vault, not a relocation ask. |
| Institutional/professional analyst, institutional PM | Later — compliance risk + competitive-set question both unresolved; gated on real usage data. |
| Casual dashboard user | Already served — the unflagged Save-to-Notebook door proves the alongside model works. |
| Investment club / small research team | Experiment/Validate-First — no evidence either way. |

---

## 5. Competitor Benchmarks — 2026 Refresh

Fresh research this session (web search against current official docs/product pages/
recent third-party coverage — not the 2026-09-05 Phase Zero/One snapshot alone). Full
per-capability tables live in this session's research output; synthesized findings below.

### 5.1 Notion — what changed since Phase Zero/One
Notion shipped a major agentic push (3.0 "Agents," Sept 2025, through 3.5 "Developer
Platform," May 2026):
- **Notion Agent** (autonomous, up to ~20 min, touches hundreds of pages, respects the
  user's own permissions, reversible via version history) and **Custom Agents**
  (Business/Enterprise, scheduled/triggered, no human in the loop, MCP-connectable).
- **Q&A** — natural-language AI search grounded in the user's workspace + connected
  apps, with inline citations, reachable via a global desktop shortcut.
- **Enterprise Search** — extends Q&A across Slack/Drive/Jira/GitHub/Teams/SharePoint
  (Business/Enterprise only).
- **Verified Pages** — mark a page "current" for N days, surfaces a trust checkmark in
  search/citation ranking, auto-expires with an owner nudge (Business/Enterprise).
- **AI Autofill** on database properties (summarize/classify/custom-prompt per row).
- **Dashboard view** (boards+tables+charts+timelines composed on one page), Chart view.
- **Version history**: auto-snapshots ~every 10 min of editing; **30 days on
  Personal/Team, unlimited only on Enterprise** — a place Notion is weaker by default.
- Databases/relations/rollups/multi-view remain the core structural strength.

### 5.2 Evernote — what changed since Phase Zero/One
Post-Bending-Spoons acquisition (2023) restructured pricing into Free/Starter/Advanced/
Enterprise, with the free tier sharply cut (50 notes, 1 notebook, 1 device, 1GB/month —
"functions like an extended trial," per third-party review). v11 (Jan 2026) added an
OpenAI-backed AI layer:
- **AI Assistant** (summarize/extract action items/rewrite/cross-note Q&A) and **AI
  Meeting Notes** (live transcription, speaker recognition, selective-segment
  transcribe, calendar-triggered structured notes) — genuinely current and
  sophisticated, but paid-tier only with undisclosed usage caps even on paid tiers.
- **OCR and document/PDF search — Evernote's historic signature strength — are now
  fully paywalled** (OCR = Advanced tier; document search = Starter tier+). OCR is
  server-side/async (minutes-to-hours latency) and non-extractive (findable, not
  copyable text).
- **Note History** unlocked for all tiers including Free — but **not accessible from
  mobile apps** at all.
- Sync conflicts append as visible text blocks in the same note (manual, not silent
  merge); offline access is gated off Free entirely.

### 5.3 Obsidian — what changed since Phase Zero/One
The single most important recent addition:
- **Bases** (shipped in 1.9+, free, core, NOT a paid add-on) — a saved query/table/
  board/card/list/map view directly over existing note Properties (frontmatter),
  nothing copied into a separate database. Supports filters, formulas, summaries
  (totals/averages/counts). Notion/Airtable-style structure with zero storage lock-in.
- Command Palette + Quick Switcher remain the keyboard-speed backbone (every plugin's
  actions surface in one fuzzy-searchable palette; Quick Switcher merges open-or-create
  into one keystroke flow).
- Backlinks panel = **linked + unlinked mentions in one view**, with one-click context
  expansion — bulk-linking unlinked mentions requires a third-party plugin (a real, narrow
  gap in stock Obsidian).
- Bookmarks can target a specific heading/block/saved search, not just whole notes.
- File Recovery (free, local-only, explicitly "not a backup," 7-day) vs. Sync version
  history (paid, cross-device, 1–12 months by tier) — a real paid split Obsidian itself
  hasn't closed.
- Even Obsidian's own $4–10/mo Sync is optional because the file format is portable
  (Syncthing/iCloud/Dropbox all work) — the sharpest ownership/control differentiator.

---

## 6. Capability Parity Target

Match, at minimum: reliable full-text search with date/entity filters and query-aware
snippets, a trash can, real export, version history, note-to-note linking with
backlinks, favorites/recents, a command palette, find-in-note, structured
properties/views sufficient for a "watchlist"/"active theses" table, basic PDF/document
attachment + search, keyboard-driven navigation. These are table-stakes across all
three current competitors and — per the 2026 refresh above — the bar has risen (Bases,
Q&A/Enterprise Search, AI Meeting transcription) since Phase Zero/One's original
research.

---

## 7. Experience Parity Target

Every capability above must clear the Stage A Experience Integrity bar established
2026-09-06 (`notebook-ux-ui-competitive-ledger.md`): no raw backend errors, no infinite
loading states, honest empty states, destructive actions recoverable, core navigation
reachable, and — per this directive's much larger UX/UI program — full keyboard
efficiency, responsive correctness at all three breakpoints, a lightweight
accessibility baseline, and visual consistency with the existing design-token system.
"Built + green + hidden" (a real backend capability with no discoverable entry point)
is explicitly NOT complete — see §89 of the governing directive, folded into §37 below.

---

## 8. Financial Differentiation Target

No competitor can structurally match: frozen-at-insert temporal correctness across ALL
captured data types (charts done; fundamentals/watchlist/scanner done; analyst
estimates absent — the real remaining moat work), the accumulated personal research
history this produces over time (a compounding/retention moat, not an acquisition one),
typed thesis↔trade↔position linking against an actual broker-synced account (no
standalone journal — TradeZella/Edgewonk/TraderSync — can do this), and eventually
"Ask Notebook + UCT" (private research fused with live/historical market data in one
grounded answer — legally gated, not yet scheduled).

---

## 9. Current Gaps — full inventory

**Single source of truth: `competitive-gap-ledger.md`** (68 rows, G-001–G-106). This
document does not duplicate that table. What follows is the NEW tiering this directive
requires, mapped onto existing row IDs — see §10–13.

**Classification taxonomy applied to every row** (directive §11): SHIPPED+VERIFIED ·
SHIPPED BUT UX-INCOMPLETE · PARTIAL · DESIGNED · IMPLEMENTATION-READY · CURRENT BUILD
WAVE · FUTURE WAVE · RESEARCH REQUIRED · EXPLICITLY DEFERRED · REJECTED WITH REASON.
Mapping from the ledger's existing STATUS column: DONE → SHIPPED+VERIFIED (or SHIPPED
BUT UX-INCOMPLETE where a named UX gap remains open on a shipped capability, e.g.
G-070's mobile-FAB-unverified caveat); PARTIAL → PARTIAL; DESIGNED/Stage-A-gated → now
**IMPLEMENTATION-READY** (the gate lifted, §2) or **CURRENT BUILD WAVE** for the items
in Wave A below; OPEN with no wave assignment → FUTURE WAVE or RESEARCH REQUIRED per
§10–12; EXPERIMENT → RESEARCH REQUIRED (needs a validation test) or EXPLICITLY DEFERRED
(needs a precondition that hasn't happened, e.g. G-052/G-074); BLOCKED → EXPLICITLY
DEFERRED (external dependency); REJECTED → REJECTED WITH REASON (already carries its
reason in the ledger's UCT Current column).

No orphan rows: every G-xxx id below is assigned to exactly one of §10–13.

---

## 10. Pre-Beta Must-Haves

**Test applied** (directive §112): absence would likely invalidate product feedback,
cause loss of trust, make Notebook obviously inferior, block core target-user work,
hide the financial differentiation, prevent normal recovery, or create a serious
mobile/usability failure.

Bucket A (thesis-link creation, note-load error state, `LinkedNotesPanel`, error
sanitization — G-070/G-100/G-101, part of §UX-fix already shipped 2026-09-06) is
already satisfied. Remaining pre-beta items:

| Gap ledger row(s) | Item | Why pre-beta |
|---|---|---|
| G-102 | App-wide command palette Notebook participation | Cheapest, highest-leverage UX finding — the infra already exists; a power-user tester hitting Cmd/Ctrl+K and finding nothing reads as unfinished. |
| G-103 | Native `confirm()` → shared modal | Visual-consistency trust signal on a destructive action. |
| G-100 (remaining instances) | Any residual raw-error leak not covered by Bucket A | Trust-critical, already mostly closed. |
| G-023, G-024 | Favorites, Recents | Table-stakes across all three competitors; cheap; a tester who can't find yesterday's note reads Notebook as incomplete. |
| G-014, G-013, G-015, G-016 (Wave 4 Slices 1-4) | Date filter, query-aware snippets, `bm25()` ranking, entity sector/theme filter, `$NVDA` ticker-field fix | Fully implementation-ready (§15); search is a top-3 failure mode for every migrated-library tester. |
| G-012 | Folder-sidebar correctness — re-verify | Ledger flags this as "status needs a direct re-check" — resolve before beta so a real 1,000+-note import doesn't silently under-render. |
| — (new, per UX-fix mobile caveat) | Live mobile/responsive audit (blocked earlier by a tooling limitation) | Cannot certify "not functionally broken" without it; a beta tester on mobile is a near-certainty. |
| G-106 | Shared loading-skeleton component | Cheap, broad perceived-performance fix touching every surface a tester sees first. |

## 11. Pre-Launch Must-Haves

**Test applied** (directive §113): a serious target user would reasonably consider its
absence a significant deficiency compared with competing notebooks.

| Gap ledger row(s) | Item |
|---|---|
| G-002 | Version history / diff — one of 3 named trust-parity bars, all 3 competitors have some form. |
| G-022, G-033 | Note-to-note link authoring (`[[`-style or slash command) + backlinks UI. |
| G-021, G-025 | Structured properties + saved views/searches — Obsidian's Bases and Notion's databases both raised this bar in 2026. |
| G-036, G-045 | Generic file/PDF attachments + PDF-as-document search (OCR of scans/handwriting explicitly rejected — see G-045). |
| G-091, G-092 | Single-note export + trade-link references preserved on export — both new findings this session, portability-principle violations. |
| G-060, G-062 | Fact/snapshot ledger + analyst-estimates capture path — the real remaining piece of the flagship temporal-correctness moat. |
| G-072, G-073 | Thesis structured fields + thesis changelog. |
| G-075 | Per-ticker research surface. |
| G-041 | Comment/annotation field at capture time. |
| G-040 (remaining) | Capture doors for Screener/Options Flow/COT Data/Model Book. |
| G-063 | Calendar-embed forward-looking bug fix. |
| G-031, G-032 | Find-in-note; in-note keyboard shortcut set. |
| G-035 | Large-note performance/virtualization (untested at real scale). |
| — | Lightweight accessibility baseline across all Notebook surfaces (keyboard/focus/labels/modal trap/Escape/contrast) — directive §85, not yet a formal pass beyond the partial positive evidence gathered during the UX audit. |
| — | Design-token cleanup (G-104) + `UIcon` migration (G-105) on touched surfaces — opportunistic per the UX ledger's own discipline, not a dedicated sweep. |

## 12. Post-Launch High Priorities

**Test applied** (directive §114): important but non-core, narrow-persona, high
complexity, low initial frequency, or dependent on real usage — never a dumping ground.

| Gap ledger row(s) | Item |
|---|---|
| G-051, G-053 | Ask Notebook (corpus-wide, lexical+entity) + Compass tool-registry integration. |
| G-004 | Encryption at rest (design spike first — FTS5 conflict must be resolved before sizing the build). |
| G-083 | Read-only offline cache of recently-viewed notes. |
| G-044/G-084 | Mobile capture / share-sheet (real usage data should prioritize this, not assumption). |
| G-093/G-094 (extend) | Any bidirectional sync work, if member demand surfaces. |
| G-080 (activation) | Flip `J2_SHARE_LINKS_ENABLED` on — policy decision once real demand exists, not an engineering gap. |
| — | Tasks/reminders (financial-native: review-thesis-before-earnings, revisit-position-in-N-days) — not yet a gap-ledger row; add one when scoped. |
| — | Calendar/catalyst view over structured research dates — depends on G-021/G-025 landing first. |

## 13. Long-Term Items

| Gap ledger row(s) | Item |
|---|---|
| G-017 | Semantic/vector search — evidence-gated, sequenced last per architecture §7. |
| G-052 | Ask Notebook + UCT (private notes + vendor data fused) — legally gated, not this program's to reopen. |
| G-081 | Comments/mentions/multiplayer/team workspaces — needs an account/team-boundary primitive first (foundational billing/product decision). |
| G-085 | Public API/webhooks — narrow, first-party, tightly scoped if pursued. |
| G-043 (narrow Experiment) | Bookmarklet-first financial-document capture — validate via a zero-store-review bookmarklet before any maintained-extension investment. |
| G-074 | Proactive thesis-invalidation alerting — explicitly after the changelog (G-073), alert-fatigue risk is structural. |
| G-082 | Full offline editing — Experiment/low-expected-value per architecture §16's own reasoning (UCT is ~90% useless offline regardless of Notebook). |
| G-086, G-043 (general) | Plugin marketplace, general web clipper — REJECTED, not revisited absent new evidence. |

---

## 14. Dependency Graph

```
[DONE] Wave -1..3 + Bucket A ──────────────────────────────────────────┐
   │                                                                    │
   ▼                                                                    │
Wave A — Search Evolution I (implementation-ready, §15) ◄───────────────┘ (needs Wave 1 entity layer, DONE)
   │
   ▼
Wave B — High-frequency Notebook UX / power-user foundation
   │ (command palette, favorites, recents, find-in-note, native-confirm
   │  replacement, shared skeleton, folder-sidebar re-verify, mobile
   │  re-verify — all independent of each other, of Wave A)
   ▼
Wave C — Version History + Export/Portability completeness
   │ (independent of A/B; new j2_note_versions table needs the
   │  account_purge.py coverage requirement from day one)
   ▼
Wave D — Internal links + backlinks + relationship UX
   │ (needs the entity layer, DONE; independent of B/C)
   ▼
Wave E — Structured properties + saved/dynamic views
   │ (needs D's linking primitives to feel complete, not a hard dependency)
   ▼
Wave F — Fact/snapshot ledger + universal temporal semantics
   │ (the critical-path item — thesis changelog and Ask Notebook both need
   │  this landed once, early, correctly, per implementation-plan.md §1)
   ▼
Wave G — Thesis Intelligence + Thesis Changelog ◄── needs Wave F
   │
   ▼
Wave H — Per-ticker research surface ◄── needs entity layer (DONE) + Wave D
   │
   ▼
Wave I — Templates (finance-native extension) + Tasks/catalyst follow-up
   │ (independent, can slot in anywhere after Wave B)
   ▼
Wave J — Attachments + PDF/document research
   │ (independent; PDF search is pre-launch-tier, generic OCR is not)
   ▼
Wave K — OCR / document intelligence (Experiment-gated, only if J's usage
   │        signal or explicit demand justifies it)
   ▼
Wave L — Ask Notebook / corpus AI ◄── needs Wave A (entity-anchored
   │        retrieval) + Wave F (fact ledger)
   ▼
Wave M — Hybrid/semantic search ◄── needs Wave L + usage telemetry showing
   │        lexical+entity insufficiency (evidence-gated, may never trigger)
   ▼
Wave N — External financial web capture (Experiment, bookmarklet-first)
   │
   ▼
Wave O — Mobile/responsive primary workflows ◄── needs the live mobile
   │        re-verification pass (pre-beta item) to know the real starting point
   ▼
Wave P — Offline/sync (read-only cache first; full offline stays Experiment)
   │
   ▼
Wave Q — Ask Notebook + UCT financial fusion ◄── LEGALLY GATED, not scheduled
   │
   ▼
Wave R — Sharing/collaboration/publishing ◄── needs an account/team boundary
   │        primitive (foundational, not yet designed)
   ▼
Wave S — API/extensibility (narrow, first-party)
   │
   ▼
Wave T — Security/encryption hardening ◄── needs the design spike's outcome
   │
   ▼
Wave U — Final primary-notebook parity + experience certification
```

Parallelizable, per directive §108: UX/accessibility/design-token research, the
competitive refresh (done, §5), version-history architecture design, document/OCR
research can all proceed alongside Wave A implementation — but only in an isolated
worktree/branch per agent, never two agents mutating the same working tree (directive
§97, already this program's standing rule).

---

## 15. Implementation Waves — near-term detail

### Wave A — Search Evolution I — ✅ SHIPPED 2026-09-06

See the Wave A Certification Report appended at the end of this document for
the full 44-point report. Summary: all 4 slices shipped, tested (28 new
backend + 5 router + 11 hook + 11 component = 55 new tests, all green,
plus the full pre-existing journal_two + journal-2-0 suites unaffected),
live-browser-verified end-to-end in the fail-closed sandbox against real
data and a real (unmocked) `ticker_meta` provider call, deployed to
production, and production-verified (health uptime reset + `PRAGMA
index_list` confirming the new index).

Original design (preserved for reference):

Fully implementation-ready per `wave4-search-evolution-i-prep.md` +
`wave4-implementation-readiness.md` (both re-verified against current code this
session — zero drift found). Four slices:

1. **Slice 1** — `idx_j2_notes_user_created` index + `dateFrom`/`dateTo` params on
   `list_notes`/`count_notes` + router validation (400 on malformed dates) + frontend
   date pickers in `FolderSidebar.jsx`'s search mode, labeled "Note created."
2. **Slice 2** — wire `snippet()`/`highlight()` into the search-results row (replacing
   the naive `bodyPlain.slice(0,120)`), add the tag/ticker-match explanation label, add
   `bm25()` ranking for `q`-driven results.
3. **Slice 3** — sector/theme filter (resolve the member's bounded mentioned-symbol set
   via the existing 24h `ticker_meta` cache, filter to sector/theme match, narrow notes
   via the same UNION-of-embeds-and-mentions shape `get_symbol_backlinks` already uses).
4. **Slice 4** — the `$NVDA`-vs-ticker-field-only fix (strip `$`/separator before the
   exact-ticker comparison in `_notes_filter_sql`).

Each slice: unit → integration → real-browser E2E in the fail-closed sandbox →
re-benchmark → deploy → production verify, matching every prior wave's discipline.

### Wave B — High-frequency Notebook UX / power-user foundation [NEXT]

Command palette registration (`CommandPalette.jsx` — new note, search-focus,
jump-to-note, create-thesis, open-trash), native `confirm()` → shared modal, favorites,
recents, find-in-note, shared loading-skeleton component, folder-sidebar direct
re-verification, live mobile/responsive re-pass with alternate tooling.

### Wave C onward

Design-before-build for each (directive §115) happens at the start of that wave, not
speculatively now — per §129, this document reports and stops before beginning any
wave past the currently-authorized one.

---

## 16–39. Program coverage by domain

Rather than duplicate 24 near-identical subsection headers, each domain's authoritative
coverage lives in ONE place, cross-referenced here so nothing is silently dropped:

| # | Domain | Owning section/doc |
|---|---|---|
| 16 | UX/UI program | `notebook-ux-ui-competitive-ledger.md` (P0–P4 classification, Stage A Experience Integrity Standard, remediation packages) + this doc §7, §10 |
| 17 | Editor program | `master-architecture.md` §2; gap ledger G-030–G-036; this doc §11 (find-in-note, PDF attachments) |
| 18 | Organization program | Gap ledger G-020–G-026; this doc §10 (favorites/recents), §11 (properties/views) |
| 19 | Search program | `wave4-search-evolution-i-prep.md` + `-implementation-readiness.md`; this doc §15 |
| 20 | Links/backlinks program | Gap ledger G-022, G-033; this doc §11, Wave D |
| 21 | Structured research program | Gap ledger G-021, G-025; this doc §11, Wave E |
| 22 | Version history program | `master-architecture.md` §3.3; gap ledger G-002; this doc §11, Wave C |
| 23 | Temporal/fact-ledger program | `master-architecture.md` §5; gap ledger G-060–G-064; this doc §11, Wave F |
| 24 | Thesis program | `master-architecture.md` §12; gap ledger G-072–G-075; this doc §11, Wave G |
| 25 | Trading-integration program | `master-architecture.md` §11; gap ledger G-070, G-071 (rejected as proposed); Bucket A fix, DONE |
| 26 | Ticker-research program | `master-architecture.md` §13; gap ledger G-075; this doc §11, Wave H |
| 27 | Capture program | `master-architecture.md` §9; gap ledger G-040–G-045; this doc §10–11 |
| 28 | Document/PDF/OCR program | Gap ledger G-036, G-045; this doc §11 (PDF), §12/§13 (OCR) |
| 29 | AI program | `master-architecture.md` §8; gap ledger G-050–G-053; this doc §12 (Ask Notebook), §13 (semantic, +UCT) |
| 30 | Mobile program | `master-architecture.md` §19; gap ledger G-044/G-084; this doc §10 (re-verify), §12 (capture) |
| 31 | Offline program | `master-architecture.md` §16; gap ledger G-082/G-083; this doc §12/§13 |
| 32 | Task/reminder program | Not yet a gap-ledger row (new, per directive §65) — this doc §12, scope at Wave I |
| 33 | Collaboration program | `master-architecture.md` §17; gap ledger G-080/G-081; this doc §13 |
| 34 | Portability program | Gap ledger G-090–G-094; this doc §11 (single-note export, trade-link export) |
| 35 | Security/encryption program | `master-architecture.md` §3.5, §20; gap ledger G-004; this doc §12 |
| 36 | Extensibility program | Gap ledger G-085/G-086; this doc §13 |
| 37 | Performance program | `master-architecture.md` §15 — verified strengths, concrete thresholds, no vague "at scale" language; unchanged by this document |
| 38 | Accessibility program | UX ledger (partial positive evidence); this doc §11 (formal lightweight baseline) |
| 39 | Design-system program | Gap ledger G-104/G-105; UX ledger's remediation package (Bucket B, unauthorized-pending) |

---

## 40. Competitive Certification Plan

At Stage C evidence-gathering time (not before — see product-spec §4.3), run the task-
based side-by-side comparisons directive §118 names (create a note, format research,
organize into a project, find an old note, link two notes, view backlinks, create a
research table/view, capture a web source, upload/search a PDF, restore a version,
create a thesis, link to a trade, ask a research question, use on phone, work offline,
export) against current Notion/Evernote/Obsidian, reporting UCT steps vs. competitor
steps vs. UCT friction vs. UCT advantage vs. remaining gap for each. Not run now —
premature before Waves A–H land.

---

## 41. Pre-Beta Exit Definition

All §10 items shipped, tested (unit/integration/real-browser/adversarial/tenant/
regression per the existing per-wave discipline), deployed, and production-verified.
Explicitly NOT required pre-beta: version history, structured properties/views, PDF/
document search, the fact ledger, thesis structured fields, per-ticker research,
Ask Notebook, mobile capture, offline, encryption, collaboration, API/extensibility —
all deferred to pre-launch or later per §11–13, with rationale stated there, not
silently dropped.

## 42. Pre-Launch Exit Definition

All §10 + §11 items shipped, tested, deployed, production-verified, PLUS: the Master
Benchmark Suite (`master-product-spec.md` §9) passing for real Stage A cohort members
(not synthetic testers only), the lightweight accessibility baseline formally passed
(not merely partial evidence), and a competitive task-based comparison (§40) run at
least once against current Notion/Evernote/Obsidian showing no P0-equivalent gap on an
in-scope beachhead-persona workflow.

---

## Top 25 Pre-Launch Switching Blockers (evidence-ranked)

Ranked by severity × frequency × switching impact, drawing on the gap ledger's own
Switching Impact column and the 2026 competitor refresh (§5).

1. **Search lacks date/entity filters + query-aware snippets** (G-013/G-014/G-016) — every migrated-library tester's first real test; now fully IMPLEMENTATION-READY (Wave A).
2. **No command palette participation** (G-102) — Notion/Obsidian power users specifically probe for this; infra already exists.
3. **No favorites/recents** (G-023/G-024) — table-stakes across all 3, now sharper given Obsidian's granular (heading/block/saved-search) bookmarking.
4. **No version history** (G-002) — one of 3 named trust-parity bars; Notion/Evernote/Obsidian all have some form (Obsidian's is paid-gated, a rare spot to actually beat it).
5. **No native note-to-note link authoring** (G-022/G-033) — Obsidian's `[[` two-keystroke flow is the switcher's daily-use bar.
6. **No structured properties/saved views** (G-021/G-025) — Obsidian's free, core Bases feature (new in 2026) and Notion's databases both raise this bar materially.
7. **Folder-sidebar correctness status unresolved** (G-012) — a self-verification-moment failure for the highest-value Obsidian-switcher persona if still broken.
8. **No find-in-note** (G-032) — relies on browser Ctrl+F only; all 3 competitors have a real in-app version.
9. **No single-note export** (G-091) — new finding; portability-principle violation for a member who just wants one note out.
10. **Trade-link references drop on export** (G-092) — new finding; specifically undermines the flagship differentiator's own "your research is yours" promise.
11. **No generic PDF/document attachments + search** (G-036/G-045) — Evernote's document search (even paywalled) still beats UCT's current zero.
12. **Version history mobile gap is an OPPORTUNITY, not a blocker** — noted for framing, not itself a blocker.
13. **No thesis structured fields** (G-072) — currently a bare tag; Notion's custom database properties do this natively today.
14. **No fact/snapshot ledger / analyst-estimates capture** (G-060/G-062) — blocks the flagship temporal-correctness moat from being universally true.
15. **No per-ticker research surface** (G-075) — "everything about NVDA" is a named benchmark-suite job with no current UCT answer.
16. **Command-palette-adjacent: no in-note keyboard shortcut set** (G-032 area) — save/close/navigate shortcuts absent.
17. **Mobile capture absent, untriaged severity** (G-044/G-084) — Evernote/Notion both treat mobile capture as core.
18. **No comment/annotation field at capture time** (G-041) — a real, cheap parity gap.
19. **4 capture surfaces uncovered** (G-040 remainder: Screener/Options Flow/COT Data/Model Book).
20. **No shared loading-skeleton** (G-106) — cheap, broad perceived-performance gap vs. all 3 competitors' polished loading states.
21. **Design-token/raw-glyph inconsistency** (G-104/G-105) — visual-polish signal, cheap to fix opportunistically.
22. **No Ask Notebook (corpus-wide AI)** (G-051) — Notion Q&A and Evernote's AI Assistant both do this today, even if gated to paid tiers there too.
23. **No encryption at rest** (G-004) — the highest-trust-bar persona segment (Obsidian switchers) will ask.
24. **Calendar-embed forward-looking bug** (G-063) — a real, live correctness bug, not yet independently re-verified this session.
25. **Large-note performance untested at real scale** (G-035) — import-heavy switchers arriving with thousands of notes are a real near-term risk.

## Top 25 Financial-Native Advantages (status-honest, not overstated)

1. **Chart temporal correctness (frozen-at-insert)** — DONE, live, the reference implementation. Structural moat (survives even if a competitor copies the UI, since it depends on UCT's own live market-data integration).
2. **Watchlist/scanner snapshot semantics** — DONE. Structural moat.
3. **Fundamentals/reported-financials snapshot semantics** — DONE. Structural moat.
4. **Typed thesis↔trade↔position link against a real broker-synced account** — DONE (Bucket A re-fix, live-verified). Structural moat — no standalone journal (TradeZella/Edgewonk/TraderSync) can do this.
5. **9-widget-door Save-to-Notebook, capturing UCT's own live data** — DONE, PARTIAL coverage (4 surfaces uncovered). Acquisition + retention — a structural head start no generic clipper matches.
6. **Object-level provenance (mode/captured_at, chat role, catalyst source)** — PARTIAL, the house convention 3x over. Retention.
7. **Automatic entity/mention indexing (ticker/theme, retroactive over the whole corpus)** — PARTIAL (ticker done, sector/theme designed). Retention — compounds with every note written, zero authoring cost.
8. **Ask Current Note, grounded/cited within one note** — DONE. Acquisition — the "UCT has AI on my notes" signal, cheap and low-risk.
9. **Fact/snapshot ledger + analyst-estimates capture** — ABSENT, the real remaining differentiator work. Would be a structural moat once built (no competitor has any equivalent).
10. **Thesis changelog against the fact ledger** — ABSENT, depends on #9. Retention — "what changed since I formed this thesis" is unique to a temporally-correct system.
11. **Per-ticker research surface aggregating notes/theses/charts/trades** — ABSENT. Retention — compounds with corpus size, structurally impossible for a generic notebook to replicate without UCT's own data.
12. **Compass-integrated Ask Notebook (never a second AI surface)** — ABSENT, designed. Retention — avoids the fragmented-surface risk Phase One rated the #1 long-term architecture risk.
13. **"Ask Notebook + UCT" (private research + live/historical market data fused)** — ABSENT, legally gated. The single largest long-term structural moat in the whole program, per the "if Notion copied the UI tomorrow, would the advantage disappear?" test (No — it depends on UCT's integrated broker/market-data/entity layer).
14. **Broker-synced position context on every linked thesis** — DONE (part of #4). Acquisition + retention.
15. **Trade-review AI post-mortem (`j2_trade_reviews`) likely already satisfies "review my trade against the plan"** — DONE, unconfirmed with real members. Retention.
16. **Provenance-aware capture from live UCT surfaces (never a generic external clip)** — PARTIAL (9 of 13 surfaces). Acquisition.
17. **Frozen Calendar-embed semantics (once the forward-looking bug is fixed)** — PARTIAL, real bug open. Structural moat once corrected.
18. **Sector/theme-anchored search over a member's own bounded symbol vocabulary** — DESIGNED, IMPLEMENTATION-READY (Wave A Slice 3). Retention.
19. **Compass Pre-Trade Verdict as a thesis's structured-rationale evidence source (`j2_verdicts`)** — DONE (upstream), not yet cited by Thesis Intelligence. Retention.
20. **A member's accumulated, accurately time-stamped personal research history** — PARTIAL, compounds over time. The single largest RETENTION-only moat named in the master spec — explicitly invisible in a member's first 30 minutes.
21. **Real export that round-trips (Markdown+YAML, attachments bundled)** — DONE, genuine current advantage over Evernote specifically (whose PDF export is narrowing).
22. **Sync connectors with correct conflict handling (sibling `sync-conflict` note, never silently clobbered)** — DONE. Trust, not finance-specific, but a real edge over Evernote's manual-append conflict model.
23. **Nested nine-widget-shape entity layer extending to Options Flow/COT/Model Book** — PARTIAL, 4 surfaces still uncovered.
24. **Awareness Engine / Compass proactive market-context (separate system, not yet integrated with Notebook)** — ABSENT as a Notebook integration; a future opportunity, not yet scoped.
25. **A financial-native template library (8 trader-ritual templates, no fundamental-analyst equivalent yet)** — PARTIAL. Acquisition for the primary persona today; a gap for the secondary fundamental-investor persona.

---

## Pre-Mortem — likely program failure modes + mitigations

Per directive §126:

| Failure mode | Mitigation already in place / required |
|---|---|
| Technically complete but poor UX | The Stage A Experience Integrity Standard + P0-P4 UX classification (this session) is now a permanent gate on every wave, not a one-time audit. |
| Feature sprawl | The "no orphan features" discipline (§9) + the explicit pre-beta/pre-launch/post-launch/long-term tiering (§10–13) — nothing ships without a tier assignment. |
| Navigation clutter | Directive §79's IA discipline (top-level page vs. contextual panel vs. view vs. filter vs. command vs. drawer vs. inline action) applies to every new destination before it's built. |
| Financial-data clutter in the writing surface | Constitution principle (product spec §2.4): default simple, advanced optional, every structural concept opt-in scaffolding — unchanged, already the house rule. |
| Too many AI surfaces | The Compass-integration architectural constraint (architecture §8.4) is mandatory for Ask Notebook, not optional — never a second disconnected chat UI. |
| Weak mobile | §10 makes the live mobile re-verification a pre-beta item, not deferred indefinitely; Wave O is explicitly named for primary mobile workflows. |
| Search/retrieval trust | Wave A's correctness matrix + benchmark + tenant-isolation proof are already complete before any production change ships. |
| Temporal corruption | The four-state content contract (architecture §5) is applied to every new content type BEFORE it's built, per the Calendar-embed bug's own lesson. |
| Tenant leakage | Every AI/search architecture decision (§8.2, §35 of the architecture doc) requires candidate selection by `user_id` BEFORE any similarity computation — a hard, tested gate, not a code-review-only promise. |
| Version-storage explosion | Capped retention (last 50 versions or 30 days, whichever smaller) designed into Wave C from the start, per architecture §3.3. |
| Offline conflicts | Full offline stays Experiment/deferred specifically because conflict-resolution UX is unsolved and the product's live-streaming architecture makes it low-value anyway (architecture §16). |
| Document-processing cost | OCR stays Experiment-gated on real demand signal, never built speculatively (architecture discipline already established for PDF/OCR). |
| Rights constraints | "Ask Notebook + UCT" and any future vendor-data-in-AI-answer feature stay explicitly gated on the external legal review — this program does not reopen that investigation. |
| Performance at large corpus | Concrete thresholds already exist (architecture §15) — 1,000-note folder-sidebar visibility, platform-wide FTS cost, 50,000+-note export tier — not vague "at scale" language. |
| Parallel-agent conflicts | Directive §97/§98's standing isolated-worktree + `git fetch origin` before every wave discipline, already this program's established practice. |
| Built-but-unreachable features | Directive §89/§90's "test every real entry point, not just the shared backend" discipline — the exact lesson the Wave 3 regression (fixed via Bucket A) taught this program directly. |

---

## Spec/Code Contradictions Found This Pass

Re-verified this session against current code (not assumed from any doc):

1. **None found in Wave 4's dependency claims** — `wave4-implementation-readiness.md`
   §19 already states this explicitly, and this session's direct re-read of
   `notes.py::_notes_filter_sql`/`list_notes`, `journal_two.py`'s `GET /notes`
   endpoint, and `FolderSidebar.jsx`'s search-result rendering confirms zero drift:
   no `dateFrom`/`dateTo`/`snippet(`/`highlight(`/`bm25(` exist yet, `idx_j2_notes_
   user_created` does not exist yet, the naive `bodyPlain.slice(0,120)` snippet is
   still exactly as documented. Wave A is safe to begin immediately as designed.
2. **`primary-platform-master-product-spec.md` / `-architecture.md` /
   `-implementation-plan.md` all carry a "Status: Phase Two" header implying planning-
   stage, not shipped-state** — stale relative to actual reality: Waves -1 through 3
   are shipped and live in production, and the Bucket A remediation (a defect these
   very docs' Wave 3 entry never anticipated) has also shipped. This document (§3)
   is now the current-state authority; the three strategic docs remain the *design*
   authority for capabilities not yet built and are not being rewritten.
3. **`competitive-gap-ledger.md`'s G-070 row previously read "DONE, exceeds Phase
   One's ask"** before this session's live-browser audit found the 3-of-5-entry-point
   regression — already corrected in the ledger itself (now "FIXED, live-verified —
   DONE," post-Bucket-A) and in `primary-notebook-readiness-scorecard.md`'s Trading
   Journal Integration score (3→6, from the pre-fix 7). No further correction needed.
4. **No contradiction found between the gap ledger's STATUS column and the readiness
   scorecard's per-domain scores** for any row checked this session — the two stayed
   consistent through the Bucket A update.

## Current Master Delta

`git log --oneline -3` at the time this document was written: `d274beda3` (Bucket A
merge/deploy, this session) → `8b78cbf56` (Search/Command Convergence checkpoint,
unrelated) → `e36ca0eb5` (Search/Command Convergence merge, unrelated to Notebook).
No uncommitted changes on `notebook-primary-platform` beyond this document itself at
time of writing. No concurrent Notebook-touching work detected on master beyond what
this session already merged.
