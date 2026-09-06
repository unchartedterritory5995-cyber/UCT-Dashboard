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

**Process correction, 2026-09-06 (recorded at Wave A→B checkpoint):** Wave A's own
certification report deferred all competitor-experience comparison to the future Stage C
formal switching/parity certification. The owner corrected this: Stage C remains the
large, formal certification, but **every major pre-launch wave must now perform a small,
task-specific competitor-experience comparison scoped to that wave's own workflows**
(what does the incumbent user expect / how many steps / how discoverable / what does UCT
currently do / is UCT's interaction competitive). This is NOT a new giant research
program per wave — it is a bounded task matrix over the 2-4 workflows that wave actually
touches. Wave A is NOT reopened to retroactively add this; the correction applies from
Wave B forward. See Wave B's §7 (Competitor Target) and the Competitor Task Matrix in
this document's Wave B section for the first application of this rule.

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

### Wave B — High-frequency Notebook UX / power-user foundation — ✅ SHIPPED 2026-09-06

Command palette extended with Notebook actions (New Note, Open Notebook, Search
Notebook, Open Trash, Open Recent/Favorite note) matched by natural terms;
Favorites + Recents (new `j2_note_favorites`/`j2_note_recents` tables, sidebar
sections, note-header star toggle); Find-in-note (TipTap ProseMirror-decoration
extension, ephemeral, never persisted); native `confirm()` replaced with
`ConfirmModal` in both Notebook delete flows; `Skeleton` loading adopted for
search results and note-page load; a "Notebook" section added to the keyboard
shortcut cheat sheet. 117 new tests (55 backend, 62 frontend), full backend
(2090/2116 passing, 26 pre-existing unrelated failures) and frontend
(1013/1021 files passing, 8 pre-existing unrelated failures — community pages,
pine-script parity, theme-tracker, polling-sites rail, none touching Notebook)
suites green. Live-browser E2E in the fail-closed sandbox found and fixed two
real defects invisible to fresh-mount unit tests: a same-route client-side
navigation not reactively reading `?folder=`/`?new=` (NotebookTab doesn't
remount when the command palette navigates while already inside Notebook),
and the palette's Enter key ignoring the highlighted row unless the user
explicitly arrow-navigated (so a matched notebook command lost to a literal
ticker-page 404). Deployed to production (`19963719b`), verified via health
uptime reset + per-chunk bundle content grep (`NotebookTab`, `FolderSidebar`
chunks) + live route checks. Full 51-point certification report delivered to
Patrick in-session.

Original design (preserved for reference):

**Entry checkpoint (directive §73), recorded before implementation began:**

**1. Verified current state** — see the two recon passes below (architecture inventory +
competitor task matrix), both dispatched as fresh, context-free general-purpose agents
(deliberately not forks, to structurally avoid the inherited-autonomy failure mode
recorded in the decision log's Process Incident #2 — a fresh agent has nothing to
misapply). Findings materially changed cost estimates for 3 of the 6 core-scope items:
- `ConfirmModal.jsx` (`app/src/pages/journal-2-0/components/ConfirmModal.jsx`) already
  exists, already used for Position delete — Wave B's destructive-dialog item is wiring
  (2 call sites: `FolderSidebar.jsx:581`, `NoteEditorPage.jsx:863`), not building.
- `Skeleton.jsx` (`app/src/components/Skeleton.jsx`) already exists app-wide (68 files) —
  Wave B's loading-state item is adoption into Notebook, not construction.
- `JournalLayout.jsx`'s chord-shortcut system (`g n` already routes to Notebook) +
  `ShortcutCheatSheet.jsx` already exist — Wave B adds a "Notebook" section + in-note
  shortcuts to an existing extension point, not a new system.
- `CommandPalette.jsx` (`app/src/components/CommandPalette.jsx`, Ctrl/Cmd+K, mounted in
  `Layout.jsx`) is real but is a single-purpose ticker-search dialog with **no command
  registry** — adding Notebook actions means extending the component's own logic
  (adding an action-result type alongside ticker results), not registering into an
  existing extensibility point. This is the one item pricier than the source docs
  implied.
- Favorites and Recents are genuinely greenfield — no note-scoped analog exists (the
  Watchlist "Flagged" list is ticker-scoped, pattern precedent only, no reusable code).
  `UIcon` already has unused `star`/`star-fill`/`clock` glyphs ready for this.
- Find-in-note: confirmed absent entirely (no editor-level keydown handling in
  `NoteEditorPage.jsx`, no find extension in `lib/tiptap.js`'s `buildExtensions()`).

**2. Command-palette architecture** — extend `CommandPalette.jsx` itself with a small
static Notebook action list (New Note, Search Notebook, Open Trash, Create Thesis, Open
Recent [top 5], Open Favorite [top 5]) shown alongside ticker results, filtered by the
same query box using natural terms (note/notebook/research/thesis/search/trash/
recent/favorite). This is "join the existing system," not "build a parallel one" — there
is only one Cmd+K surface in the app and it stays that way.

**3. Favorites data design** — new table `j2_note_favorites(user_id, note_id,
created_at)`, composite PK `(user_id, note_id)` (idempotent — re-favoriting is a no-op,
not an error). Trash-aware: the favorite row is NOT deleted when a note is trashed (so
restore silently un-hides it in the Favorites list again); the Favorites list query joins
against `j2_notes` and excludes `deleted_at IS NOT NULL`, mirroring the existing
trash-exclusion predicate used everywhere else in `notes.py`. Permanent purge and account
deletion explicitly delete the row (added to `account_purge.py` + the note hard-delete
path). No note content is duplicated.

**4. Recents data design** — new table `j2_note_recents(user_id, note_id, opened_at)`,
composite PK `(user_id, note_id)`, upserted (`INSERT ... ON CONFLICT DO UPDATE`) on note
open — system-derived, zero user maintenance, capped at the 8 most-recent by
`opened_at DESC` at read time (not stored capped, so a re-open of an old note correctly
resurfaces it). Same trash-exclusion join as Favorites. The "open" beacon
(`POST /api/j2/notes/{id}/opened`) is fire-and-forget from the frontend — never blocks
note rendering, never surfaces an error to the user on failure.

**5. Find-in-note design** — Ctrl/Cmd+F scoped to the note editor only when it has focus
(checked via `document.activeElement`/a ref on the editor container, never a global
listener that could hijack browser find elsewhere in the app). Ephemeral highlight via a
ProseMirror decoration set (TipTap plugin) — ephemeral means never written into
`content_html`/`content_json`, confirmed via a test that saves while find is open and
asserts stored content is unchanged. Match counter + Enter/Shift+Enter next/prev +
Escape closes and clears decorations.

**6. Target sidebar IA** — `FolderSidebar.jsx`'s Folders-mode list gains two new
sections above the existing "All notes / Unfiled / Trash" rows: **Favorites**
(populated-conditional — entirely absent from the DOM until the user has ≥1 favorite,
per the competitor research's strongest finding: Notion hides Favorites the same way)
and **Recents** (always-present once the user has ≥1 note, capped at 5 visible rows with
no "show all" — recents are a glance-back aid, not a list to manage). Both collapsible,
state persisted the same way the existing Tags section persists its expand state.
Existing Folders/Tags sections unchanged in position or behavior.

**7. Destructive-dialog design** — reuse `ConfirmModal.jsx` verbatim (already
accessible: Escape, focus-trap, backdrop-click-cancel, danger tone). Folder delete and
note delete both route through Trash today (reversible), so copy stays proportional
("Move to Trash?" / "Restore from Trash" language, not "permanently"), matching the
directive's own "do not make the dialog melodramatic" guidance.

**8. Loading-state plan** — adopt `Skeleton.jsx` (`SkeletonLine`/`SkeletonBlock`) for
the note-list loading state in `FolderSidebar.jsx` (replacing the plain "Loading…" text)
and the note-body loading state in `NoteEditorPage.jsx`. Scoped to these two
high-frequency structural loads only — not a sweep of every spinner in Notebook.

**9. Responsive plan** — real-browser re-verification (not CSS-source inspection) at
phone (390px)/tablet (820px)/desktop (1280px) in the fail-closed sandbox, covering the
new Favorites/Recents sidebar sections, command-palette on touch, find-in-note on touch,
and the destructive dialog on touch — plus a regression check that Wave A's search
filter panel still behaves correctly at each width.

**10. Keyboard-shortcut plan** — deliberately small: Ctrl/Cmd+K (existing, global,
unchanged), Ctrl/Cmd+F (new, note-editor-scoped, find-in-note), Escape (closes find or
the command palette, whichever is open — never both), plus the existing `g n` chord
(unchanged). A "Notebook" section is added to `ShortcutCheatSheet.jsx` documenting all
of these. No bare-letter global shortcuts are added (avoids collision with editor typing
and any future note titled starting with a shortcut letter).

**11. Accessibility plan** — `ConfirmModal.jsx` and `CommandPalette.jsx` already carry
`role="dialog"`/focus-trap/Escape (verified during wiring, not re-invented); the new
Favorites/Recents rows and the find-in-note bar get explicit `aria-label`s and are
included in the same keyboard-tab-order verification pass as the rest of Wave B's
real-browser E2E. This is a defensible baseline, not a WCAG certification claim.

**12. Competitor task matrix** — see the dedicated competitor-research pass below;
synthesis: match Notion's exact favorite/recents/Cmd+K ergonomics (highest
discoverability, hides-until-populated, unified palette), match all three apps'
identical Ctrl+F-scoped-to-document convention exactly (zero differentiation value in
deviating), and explicitly avoid two named anti-patterns — Evernote's overflow-menu-only
favorite entry point, and Obsidian's siloed non-integrated sidebar tabs.

**13. Vertical slices** — the directive's suggested 6-slice decomposition fits the
actual dependency shape and is used as-is: Slice 1 (Command Palette + keyboard entry
points), Slice 2 (Favorites + Recents + sidebar IA), Slice 3 (Find-in-Note), Slice 4
(destructive dialog + loading skeleton + small visual-consistency fixes on touched
surfaces), Slice 5 (responsive + accessibility verification / local remediation), Slice
6 (integrated real-browser power-user E2E + regression + deploy + certify).

**14. Test matrix** — unit (backend favorites/recents CRUD, trash/purge lifecycle,
tenant isolation; frontend find-in-note match logic, command-palette filtering) →
integration (router-level, real HTTP) → real-browser E2E in the fail-closed sandbox
(5 workflows per directive §64–68) → regression (full existing journal_two +
journal-2-0 suites) → production verification.

**15. Migration/rollback plan** — both new tables are additive (no ALTER on
`j2_notes`); rollback is dropping the two tables + removing the two new endpoints +
reverting the frontend diff, none of which touches existing note content or Wave A's
search contract. Command-palette and shortcut-cheat-sheet changes are additive entries
in existing files, trivially revertable via `git revert`.

**No material contradiction found requiring a decision — proceeding autonomously into
Slice 1.**

---

#### Wave B recon — architecture inventory (fresh general-purpose agent, read-only)

EXISTS as reusable precedent, confirmed by direct code inspection: `ConfirmModal.jsx`,
`Skeleton.jsx`, `JournalLayout.jsx` chord-shortcuts + `ShortcutCheatSheet.jsx`, `UIcon`
`star`/`star-fill`/`clock` glyphs (registered, unused in Notebook today), `Sheet.jsx`
(already used inside `journal-2-0/components/notebook/` for other dialogs — import
wizard, export dialog, template picker, connector modals). DOES NOT EXIST: any
note-scoped favorite/recent table or hook, any find-in-note capability, any command
registry on `CommandPalette.jsx`. PARTIAL: responsive JS-hook usage in Notebook (only
`ImportWizard.jsx` uses `useIsTouch`; `FolderSidebar.jsx`/`NoteEditorPage.jsx` use none —
CSS-level `@media` handling is unverified line-by-line this pass but no contradicting
evidence surfaced). Every native `confirm()` call site in `journal-2-0/` in scope for
Wave B: `FolderSidebar.jsx:581` (delete folder), `NoteEditorPage.jsx:863` (delete note).

#### Wave B recon — scoped competitor task matrix (fresh general-purpose agent, web research)

Convergence findings used directly in the design above: all three apps use identical
Ctrl/Cmd+F-scoped-to-document semantics (copy exactly); all three surface recents by
default in an empty-query quick-switcher (implement as the floor, plus a persistent
capped sidebar section since Obsidian's own users cite the lack of one as a real gap);
Notion's single unified Cmd+K with grouped result sections is the right-sized command-
palette model for a smaller product (vs. Obsidian's two-tool split, which its own users
request merging). Named anti-patterns to avoid: Evernote's favorite entry point buried in
an overflow menu (low discoverability — use a persistent header star instead, Notion's
pattern); Obsidian's non-integrated sidebar tabs (File Explorer/Search/Bookmarks/Tags as
separate silos — keep one nested tree instead, Notion's pattern).

### Wave C — Version History / Trust / Export Completeness — IN PROGRESS 2026-09-06

**Entry checkpoint (directive §119), recorded before implementation began.** Three
fresh, context-free general-purpose agents did the recon (same deliberate
non-fork discipline as Wave B, for the same structural reason — no inherited
context to misapply): note-lifecycle architecture, export architecture, and a
scoped Notion/Evernote/Obsidian benchmark.

**1. Current versioning reality** — confirmed **greenfield**: no version/revision/
snapshot table or mechanism exists anywhere for Notebook. What DOES already exist
and is directly reusable: `update_note` (`api/services/journal_two/notes.py:1507`)
already has a **compare-and-set optimistic lock** — an optional `expected_updated_at`
param that raises `NoteConflictError` (→ HTTP 409) when the row moved since the
caller's baseline — wired end-to-end (frontend `commitSave` sends `baseUpdatedAt`,
409 triggers `reconcileConflict()`). This is the exact mechanism Wave C's
multi-tab/concurrency safety concern (§89-90) needs, already battle-tested, not
invented fresh. Three distinct SQL write paths touch `j2_notes`
(`create_note`/`update_note`, `import_confirm`'s bespoke SAVEPOINT-based upsert,
`note_connectors/engine.py`'s raw UPDATE) — a version-creation hook placed only in
`update_note` will NOT cover imports/connector-sync writes (see §6 below for the
deliberate scope decision this drives).

**2. Current export reality** — full-library export (`GET /api/j2/notes/export`,
`api/services/journal_two/notes_export.py`) is real, well-engineered, disk-backed
(not in-memory, avoiding an OOM class this codebase has hit before), attachment-
bundling, and has genuine roundtrip proof (`exportRoundtrip.test.js` decodes and
re-imports the real export output through the real importer). Confirmed gaps,
all previously only suspected: **single-note export does not exist at all** (zero
route, zero button beyond PNG/Print, which are not portable formats); the typed
`tradeRef`/`tradeRefType` relationship is **silently dropped** with zero trace,
not even a raw ID; `import_source`/`import_key` provenance is dropped;
`j2_note_embeds`/`j2_note_mentions` entity data beyond the note's own `ticker`
field is dropped. Favorites/Recents (Wave B, postdates this export code) are
also absent — expected, and Recents should stay absent (ephemeral, per its own
Wave B contract).

**3-5. Notion/Evernote/Obsidian scoped benchmark** — full task matrix (tasks A-G)
in the dedicated recon section below. Load-bearing findings used directly in this
design: Obsidian's explicit **Restore vs. Copy** button pair is the clearest
restore-safety UX of the three; Notion's written guarantee ("you can always go
back... even after a restore") is the trust-language pattern to borrow;
retention varies by plan tier for Notion/Obsidian (not applicable here — no
plan-gating per §38's explicit instruction); none of the three do more than a
basic diff (Notion's is brand-new); Notion's exported internal links breaking
outside the platform is a named anti-pattern to avoid (not directly at risk here
since Notebook has no native note-to-note link feature yet, but the underlying
lesson — never export a bare internal ID with no recoverable semantics — directly
shapes the trade-ref export fix in §12).

**6. Version data model** — **full snapshots**, not deltas. At current production
scale (~90 notes total, confirmed via the readiness scorecard) even a generous
history depth is trivially small; deltas add real restore/preview/diff complexity
(replay logic, corruption risk if one delta in a chain is ever lost) for a
storage saving that doesn't matter yet. Matches the directive's own steer (§12:
"simple correctness may be more valuable than clever storage optimization... but
prove it" — proven via the storage-growth benchmark in Slice 1's test plan).

**7. Versioned field contract** — **title, subtitle, body (json+plain) only.**
`folder_id`/`ticker`/`tags` are classified USER-AUTHORED BUT SEPARATE LIFECYCLE:
recon confirms they already save via independent, immediate PUTs outside the
debounced content-autosave batch (no `baseUpdatedAt` on those either — a
pre-existing, out-of-scope gap, not touched by Wave C). Versioning them would
mean a content-only "Restore" surprisingly relocates or re-tags a note the
member has since re-organized — exactly the inconsistency §14 warns against.
Restore therefore never touches folder/ticker/tags. `j2_note_embeds`/
`j2_note_mentions` (the Wave 1 entity/trade-relationship layer) are NOT
separately versioned or restored — they are ALREADY re-derived fresh from
`body_json` on every `update_note` call via the existing `_sync_note_embeds`/
`_sync_note_mentions` calls, so routing Restore through the normal `update_note`
path (see §9) makes relationship state correctly and automatically follow
whatever body content is current, by construction — option C of §15 ("leave
relationships outside raw note restore") is what happens for free, not something
built specially.

**8. Coalescing contract** — implemented in **Python inside `update_note`**, not a
SQL trigger (triggers stay reserved for this codebase's established use —
unconditional cascade-cleanup on delete — per the FTS/Favorites/Recents
precedent; coalescing is conditional business logic, which belongs in the
service layer). Rule: before applying a content change, capture the OLD
(pre-this-edit) title/subtitle/body as a new version row IF AND ONLY IF (a) it
differs from the most recently captured version's content (never a no-op
duplicate), AND (b) no version exists yet for this note OR the most recent
version is older than `J2_VERSION_COALESCE_MINUTES` (env-overridable, default
30). This produces one meaningful checkpoint per editing session/window, never
one row per autosave keystroke (§17's explicit concern), while leaving the
authoritative note save completely unaffected in durability or latency (§18-19
— version-row insert rides the SAME transaction/commit as the note UPDATE
itself; a version-write failure cannot occur without the note UPDATE also
failing, so there is no separate failure mode to design for).

**9. Restore contract** — Restore is **not a bespoke write path**. It calls the
existing `update_note(note_id, {title, subtitle, bodyJson: <old version's
content>}, expected_updated_at=<current row's updated_at>)` — the exact same
function every normal edit uses. This gets, for free, by construction: (a) the
current pre-restore state is captured as a new version via the SAME coalescing
hook (directive §20's "restore must not erase history" requirement, satisfied
structurally, not by special-casing); (b) the SAME optimistic-lock 409 on a
stale restore attempt (directive §89-90's multi-tab race — Tab B tries to
restore while Tab A has newer unsaved changes elsewhere — is caught by the
EXISTING mechanism, not a new one); (c) embeds/mentions re-derive correctly
per §7. A version is never deleted or mutated by a restore — restoring to
version A, then B, then back to A again all work, and all intermediate states
stay in history (proven by a dedicated test — directive §93's "prove
reversibility" workflow).

**10. Retention contract** — **no automatic pruning in Wave C.** All versions kept
indefinitely except when the note itself is hard-purged (Trash's existing
30-day retention → `purge_expired_deleted_notes`) or the account is deleted.
Honest (no "unlimited forever" UI claim needed since it would be true), avoids
inventing an arbitrary number the directive explicitly warns against (§38), and
cheap at current + realistically-projected scale. Flagged as a residual item to
revisit once real storage-growth evidence exists, not deferred silently.

**11. Relationship/version boundary** — see §7 (embeds/mentions re-derive from
current body, never separately versioned/restored).

**12. Single-note export contract** — new endpoint reuses the EXISTING per-note
markdown-building + attachment-resolution logic in `notes_export.py` (extracted
into a shared helper, not duplicated). Returns a bare `.md` file (matching what a
member exporting one simple note expects, per the competitor research's own
"Obsidian: a note already IS a portable .md file" baseline) when the note has no
attachments; a `.zip` (note.md + attachments/) when it does — both paths share
one code path, branching only on attachment count. **Entry point, corrected
during implementation, then corrected again (this section had the wrong
reason the first time — see the Decision Log's item 4 for the full
correction record):** no note-header overflow menu exists in this codebase.
A command palette (`CommandPalette.jsx`) DOES exist and Notebook already
participates in it (Wave B) — but it is a pure router (every row's only
behavior is `navigate(row.to)`), with no mechanism for a contextual,
side-effecting command bound to "whichever note is currently open." Adding
that capability would itself be new-surface scope creep — the thing §112
warns against, via the correct mechanism this time. The actual minimal-
clutter placement is a third button ("Markdown") inside the EXISTING
PNG/Print export button group in the editor toolbar, which already has
`noteId` in scope — that group is already the note's "export formats"
cluster; this adds one more format to it rather than opening a new UI
region or extending the palette's row model.

**13. Full-export contract fixes** — three silent-drop gaps closed: (a)
`tradeRef`/`tradeRefType` resolved via the EXISTING `note_trade_links.resolve_trade_ref`
(already used by the Wave 3 trade-ref-resolve endpoint) into a human-readable
inline summary (symbol/side/status) plus the raw ref retained as export
metadata — never a bare opaque database ID with no recoverable semantics (the
exact anti-pattern the Notion internal-link research flagged); (b)
`import_source`/`import_key`/`imported_at` added to front matter; (c) a
"Related tickers" line derived from `j2_note_embeds`/`j2_note_mentions` distinct
symbols. Favorites: `favorite: true/false` added to front matter (cheap,
directive §53's "likely yes if inexpensive" default). Recents: confirmed stays
excluded (ephemeral, directive §54).

**14. Version-export contract** — **out of scope for Wave C.** Both single-note
and full export include only the CURRENT version; version history itself is
viewable/restorable via the History panel but not bundled into export archives.
Disclosed, deliberate (directive §58's own "do not automatically make every
simple export gigantic" caution) — a follow-up item, not a silent gap.

**15. Sidebar/header/IA design** — a "History" icon joins the note header's
existing chrome (Favorite star, Ask this note, Share, Find — Wave B) — kept to
one small icon, not a drawer permanently open, per §112's explicit "be careful
adding History/Export" warning about clutter. Opens a right-side drawer/panel
(reusing the `Sheet`/drawer convention already established elsewhere in this
codebase), not a new primary navigation destination (§25's "history belongs to
the note" instruction).

**16. Diff design** — word-level plain-text diff (Python stdlib `difflib.SequenceMatcher`,
zero new dependency) over `body_plain`, rendered as Added/Removed spans via the
SAME safe split-and-render pattern Wave A's search-snippet highlighting already
established (`renderSnippetMarks` precedent) — never `dangerouslySetInnerHTML`.
Preview (single-version, non-diff view) uses a **read-only TipTap instance**
(`editable: false`, reusing `buildExtensions()`) rather than a plain-text
dump — TipTap parses/renders through its own schema exactly as the live editor
does, so this is not a new unsafe-content surface, and it preserves real
formatting meaning (headings/bold/lists) the plain-text diff view deliberately
sacrifices for simplicity. This split (rich preview, plain-text diff) is the
disclosed, "simplest robust representation" tradeoff directive §29/§75
explicitly permits ("do not invent an enormous semantic diff engine").

**17. Responsive design** — sequential/toggle layout on phone width (never
forced side-by-side, per §76's explicit instruction), verified via the same
Playwright mobile-audit harness used in Wave B.

**18. Accessibility plan** — reuse `ConfirmModal`'s existing dialog/focus-trap/
Escape semantics for the restore confirmation (no new modal subsystem);
explicit `aria-label`s on history entries, version selection, and diff regions;
drawer/panel gets a focus trap matching the codebase's established drawer
convention.

**19. Concurrency/multi-tab plan** — see §9 (reuses the existing optimistic
lock verbatim). Draft-recovery interaction: a Restore explicitly checks for and
clears any local unsaved-draft banner state for the note (never silently
stomped nor left dangling pointing at now-superseded content) — tested directly
(directive §91).

**20. Migration** — one new table (`j2_note_versions`), additive, added directly
to `_J2_SCHEMA` (idempotent `CREATE TABLE`/`CREATE INDEX IF NOT EXISTS`, no
migration flag needed — same convention Wave B's favorites/recents tables used,
since this is a brand-new table with no pre-existing rows to migrate).

**21. Deletion/purge** — hard-purge of a trashed note (`purge_expired_deleted_notes`)
and account deletion (`account_purge.py`) both extended to remove
`j2_note_versions` rows for the affected note(s)/user. A cascade **trigger**
(`AFTER DELETE ON j2_notes`) mirrors the existing Wave B favorites/recents
pattern — cleanup can never be forgotten at a future third hard-delete call
site, the exact rationale already established for those two tables.

**22. Performance plan** — benchmark version list/preview/diff/restore at 10,
100, and 500+ synthetic versions on one note before shipping (directive §64);
measure autosave latency before/after (directive §68) to prove the coalescing
hook adds no perceptible save-path cost.

**23. Vertical slices** — Slice 1 (version storage + coalescing + lifecycle
triggers), Slice 2 (history list/preview/diff), Slice 3 (restore + concurrency/
recovery safety), Slice 4 (single-note export), Slice 5 (full-export
completeness fixes), Slice 6 (responsive + accessibility + integrated
real-browser trust E2E + deploy + certify) — the directive's own suggested
decomposition fits the actual dependency shape and is used as-is.

**24. Test matrix** — unit (version coalescing/change-detection, restore
semantics, tenant isolation, export field completeness) → integration
(router-level HTTP) → real-browser E2E in the fail-closed sandbox (the six
named workflows in directive §92-97) → regression (full existing suites) →
production verification.

**25. Rollback** — every change is additive (new table, new endpoints, new UI
surfaces); nothing requires a destructive transformation of existing note
content; rollback is dropping the new table + removing the new endpoints/UI,
identical in shape to every prior wave's rollback plan.

**No material contradiction found requiring a decision — proceeding autonomously
into Slice 1.**

---

### Wave C Decision Log (directive §117) — decisions made DURING implementation,
not foreseeable at the checkpoint above.

1. **Restore always force-captures the pre-restore state, bypassing the
   coalescing window.** Found via testing, not designed up front: a restore
   performed shortly after an edit was silently dropping the content being
   restored away from, because the ordinary 30-minute coalescing check
   suppressed the checkpoint. `_maybe_capture_version(..., force=True)` /
   `update_note(..., force_version=True)` fixes this — restore is a
   deliberate action, unlike incidental autosave, and directive §20's
   "restore must not erase history" is unconditional. Regression test:
   `test_restore_captures_pre_restore_state_even_inside_the_coalescing_window`.
2. **Version capture gates on ACTUAL value change, not "did the patch mention
   the key."** The original call site fired whenever the patch merely
   included `title`/`subtitle`/`bodyJson`, even re-saving identical content —
   fixed by comparing new vs. old values before calling the coalescing hook.
3. **Diff tokenizer glues whitespace to the FOLLOWING word's leading edge,
   not the preceding word's trailing edge.** Tried trailing-glue first; it
   broke a pure end-of-text append (the last shared word carries no trailing
   space in the shorter text but does once something follows it in the
   longer one, so an unchanged word spuriously showed as removed+added).
   Leading-glue has no such failure mode — a word's leading whitespace is
   fixed by what comes BEFORE it, which an append never changes.
4. **Single-note export entry point is a third button in the EXISTING
   PNG/Print toolbar group, not a new overflow menu or command-palette
   entry.** The original checkpoint (§12 above) called for the latter.
   ⚠️ **Correction (this claim was checked twice and was wrong the first
   time):** an initial pass at this correction claimed "neither an overflow
   menu nor a command palette exists anywhere in this codebase" — false. A
   real, app-wide `CommandPalette.jsx` exists, and Notebook already has real
   entries in it since Wave B (New Note, Open Notebook, Search Notebook,
   Open Trash). No overflow menu exists (that half was correct). The actual
   reason the palette is the wrong door for THIS action: `selectRow()` in
   `CommandPalette.jsx` is a pure router — every row's only behavior is
   `navigate(row.to)` (verified by reading the function directly). There is
   no mechanism for a contextual, side-effecting command bound to "whatever
   note is currently open" — export needs to fetch and download a blob for
   a specific `noteId` the palette has no way to know. Adding that
   capability to the palette would itself be new, disproportionate work to
   host one button — a real instance of the same scope-creep concern §112
   warns about, just via the correct mechanism this time. The existing
   PNG/Print toolbar group lives directly inside the open note's own
   component tree with `noteId` already in scope, which is why it remains
   the right door.
5. **Full-export completeness fields (`favorite`, `related_tickers`,
   `linked_trades`, `import_source`/`imported_at`) are new YAML front-matter
   keys, omitted entirely when falsy/empty (never emitted blank).** Verified
   safe against the importer's own `parseFrontmatterBlock` (only
   `title`/`subtitle`/`ticker`/`hero_image` are ever read back; an unknown
   key round-trips as an inert, unread field) — no importer change needed,
   no regression risk to the existing round-trip certification.
6. **`linked_trades` resolves through `note_trade_links.resolve_trade_ref`
   into a human-readable `"SYMBOL (kind)"` string; the raw internal id is
   NEVER written.** An unresolved/ambiguous reference is omitted entirely
   rather than shown as a broken link — showing nothing is more honest than
   an opaque id the reader can't act on outside their own account (directive
   §51).
7. **Version-history export stays explicitly out of scope.** Both single-note
   and full export include only the CURRENT version; history stays
   viewable/restorable via the History panel but isn't bundled into export
   archives — a disclosed, deliberate boundary per directive §58's own
   permission to avoid making every simple export gigantic.
8. **`NoteVersionPreview` reuses `SharedNotePage`'s `editable:false` +
   `shareView:true` TipTap recipe**, not a bespoke read-only mode — `shareView`
   already makes every widget embed render its archived image instead of
   mounting a live component, which is exactly what a historical version
   needs (directive §85: never mount a live, auth-scoped, quota-spending
   component just from opening History) and structurally keeps a historical
   version out of NoteFind/Ask-this-note (separate `useEditor` instance).
9. **History panel/preview/diff components are covered by unit tests with
   `NoteVersionPreview` (and thus real TipTap) mocked out, not by RTL-mounting
   the real editor.** Matches this codebase's own existing convention —
   `NoteEditorPage.jsx` and `SharedNotePage.jsx`, the only two other
   components that mount `useEditor`+`EditorContent` directly, have zero RTL
   test files; TipTap-mounting surfaces are verified via real-browser E2E in
   this codebase, not jsdom.

---

Design-before-build for Wave D onward (directive §115) happens at the start of
that wave, not speculatively now — per the governing directive, this document
reports and stops before beginning any wave past the currently-authorized one.

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
