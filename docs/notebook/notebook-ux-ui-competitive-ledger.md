# UCT Notebook — UX/UI Competitive Ledger

**What this is:** a living, interaction-sequence-level comparison of UCT Notebook
against Notion/Evernote/Obsidian — not a screenshot/cosmetic comparison. Each row
below is a real workflow, broken into the actual steps a member takes, not a
feature checkbox.

**Evidence standard, stated explicitly per product/column:**
- **UCT Current** columns are grounded in direct code reading this session (file:line
  citations available in the source research; not repeated in every cell here for
  readability) — this is what the interaction CODE does. **2026-09-06 update:** a
  real-browser, read-only audit was performed against the fail-closed E2E sandbox
  for Workflow 5 (thesis-trade link) and the empty-state/accessibility items —
  those specific findings below are marked **LIVE-VERIFIED**; everything else
  remains code-level evidence only ("confirmed from code," not "confirmed by
  watching a member use it"). The mobile/responsive pass (Workflow 9) was
  **attempted and blocked** — the browser viewport could not be resized in this
  session (`resize_window` reported success but `window.innerWidth` never
  changed from 1920px); Workflow 9 below still reflects code-level evidence only,
  honestly labeled, not a live visual result.
- **Notion/Evernote/Obsidian** columns are grounded in `competitive-primary-platform-
  phase-zero.md` §4-§6/§8-§9/§13 and `-phase-one-adversarial.md`'s Core UX / Competitor
  Blocker sections — official documentation, community discussion, and UX best-practice
  research, cited there with dated URLs. This is real, sourced research; it is not a
  hands-on click-through audit performed by this program.
- Where a cell has no evidence either way, it says **UNVERIFIED**, never a guess.

**Update discipline:** add a new workflow row rather than cramming an unrelated
finding into an existing one. Re-verify a cell before changing it — don't silently
upgrade a score because time has passed.

---

## Workflow 1 — First Note, Zero Notes (new-user first impression)

| | Notion | Evernote | Obsidian | UCT Current | UCT Target |
|---|---|---|---|---|---|
| **First impression** | Template gallery + empty workspace; database-first framing that can overwhelm a non-technical first-timer (Phase Zero §4) | Notebook list + a prominent capture button — capture-first framing (Phase Zero §5) | An empty vault + a stark, minimal UI — famously unopinionated, can read as "now what?" to a non-power-user (Phase Zero §6) | **LIVE-VERIFIED 2026-09-06, genuinely well-designed**: a fresh account's Notebook tab shows "Your notebook is empty." + "Start from a template — or a blank page." + "Bring your notes from Notion, Obsidian, Evernote, or anywhere else." + an "Import notes" CTA, then a calm, clearly-labeled card grid (Blank note, then 3 template categories with small-caps gold section headers: Daily & Weekly Rituals, Around a Trade, Mindset). Visual hierarchy is genuinely clear — no competing buttons, no visual noise. | Keep as-is — this already matches the governing directive's own §20 empty-state spec closely, confirmed live |
| **Time to first value** | Medium — template choice is itself a decision point | Fast — capture button is unmissable | Slow for non-technical users — no guided first action | **Fast**, per the empty-state design above — one click reaches either a template or a blank page | Maintain |
| **New user clarity** | Medium (database concept needs learning) | High | Low-Medium (power-user tool, reads that way immediately) | **High** for the "start writing" job; UNVERIFIED for whether the 8 available templates (all trading-ritual-shaped) read as relevant to a non-trader opening it for the first time | Confirm with real Stage A first-session evidence, not assumption |

## Workflow 2 — Daily Quick Capture (save something while working elsewhere in the product)

| | Notion | Evernote | Obsidian | UCT Current | UCT Target |
|---|---|---|---|---|---|
| **Discoverability** | N/A within Notion itself — via Web Clipper (separate install) | Web Clipper, 7 distinct modes, well-known (Phase Zero §5) | Native clipper plugin, free (Phase Zero §6) | **9 widget doors across UCT** (Chart, AI Search, Alerts, Breadth, Calendar, Fundamentals, News, ThemeTracker, Watchlists) + trade/position surfaces — a real structural head start no competitor clipper can match, since it's capturing UCT's *own* live data, not an arbitrary external page | Extend to the 4 confirmed-uncovered surfaces (Screener, Options Flow, COT Data, Model Book) |
| **Capture friction (steps)** | Clipper: click extension icon → choose destination page → confirm (2-3 steps) | Clipper: click icon → choose notebook/tag → save (2-3 steps, format-dependent) | Clipper: click icon → confirm (1-2 steps) | **1 click = safe default save** (append to last-active note within a 24h freshness window, or the inbox) — matches the directive's own §12 prescription for a one-click default already | Wire the destination-choice menu (`targetsFor()`) onto all 9 buttons — confirmed unwired currently |
| **Undo/discard friction** | Standard undo | Standard undo | Standard undo | **Confirmed well-executed**: a two-step inline "Discard?" confirm (button relabels for 2.5s, no modal) for unplaced capture-inbox items — appropriately lightweight for a low-risk, reversible action | Maintain |
| **Metadata capture** | Manual, per clip | Automatic (source URL, date, author) | Automatic (source note) | **Automatic and structurally strong**: source widget, normalized entity/context, timestamp, explicit live-vs-snapshot mode, on-screen drawings at capture time, schema version tag — all confirmed preserved | Add a comment/annotation field at capture time — confirmed absent |

## Workflow 3 — Organizing Existing Research (folders/tags/structure)

| | Notion | Evernote | Obsidian | UCT Current | UCT Target |
|---|---|---|---|---|---|
| **Structure model** | Databases + relations + multi-view (moat feature) | Notebooks → Stacks (2-tier) | Folders + tags + backlinks/graph | Nested folders (depth 6) + tags + single-ticker field | CAN DIFFER — derived financial views over the entity layer, not generic databases (per Phase Zero §14) |
| **Findability without search** | Strong (views/filters) | Medium (Stacks hierarchy) | Strong for graph-native users, weak otherwise | **Confirmed absent**: no favorites, no recents, no saved views — a member must remember where they put something or search for it | Add favorites/recents at minimum — cheap, high-leverage per this ledger's own findings |
| **Reorganization friction** | Drag-and-drop, database property edits | Drag-and-drop | File-system-level (trivial for power users, opaque for others) | UNVERIFIED — folder move/re-tag interaction sequence not audited this pass | — |

## Workflow 4 — Finding Old Research (search)

| | Notion | Evernote | Obsidian | UCT Current | UCT Target |
|---|---|---|---|---|---|
| **Speed-to-first-result** | Community-reported complaints at scale (2,000+ pages), corroborated (Phase Zero §4) | Generally fast, free-tier AI semantic search added 2026 (Phase Zero §5) | Fast, rich local query syntax (Phase Zero §6) | **Confirmed fast**: 250ms debounce, comfortably inside RAIL/Nielsen targets (Phase One Core UX) | Wave 4 adds ranking (BM25) — currently recency-only |
| **Result explanation ("why did this match")** | Standard highlight | Standard highlight | Standard highlight + backlink context | **Confirmed absent today** — the current results panel shows a naive first-120-characters prefix, not a query-aware excerpt (already a known Wave 4 target, fully designed, Stage-A-gated) | Wave 4 Slice 2 — designed, not shipped |
| **Zero-result handling** | Suggests related pages | Suggests spelling correction | Shows nothing found, offers to create a new note with that name (a real, well-regarded pattern) | **Confirmed blunt**: "No notes match \"{query}\"" with no suggested next step | Add a next-step suggestion — cheap |
| **Filter clarity/removability** | Property filters, clearly labeled, easy to remove | Basic tag/notebook filters | Query-syntax filters (powerful, steep learning curve) | Ticker/tag filters exist; date/entity filters are Wave 4-designed, not shipped, so filter UX at that stage is UNVERIFIED | Design already specifies explicit filter labels ("Note created," never a bare "Date") |

## Workflow 5 — Connecting Research to a Trade (thesis-trade link)

*(No direct competitor equivalent — this is UCT's own differentiator, so this row
compares UCT's execution against the governing directive's own §17 UX bar rather
than a competitor.)*

**LIVE-VERIFIED 2026-09-06, in the fail-closed E2E sandbox — real browser, real
account, real interaction sequence, ground-truthed against the actual API, not
inferred from code alone.**

| | Directive's UX bar (§17) | UCT Current — LIVE-VERIFIED |
|---|---|---|
| Can it be created naturally from the trade workflow? | Required | **UX is genuinely excellent** — typing a title shows a clear "+ Create new note: '{title}'" affordance; selecting it shows a confirmation chip ("+ New note: **{title}**" + a "Change" link) *before* the position is even submitted. The helper copy ("Link a research note to this position — it stays linked once the trade closes") directly answers "why is this here." |
| **Does the link actually get created?** | Required (this is the whole point of the feature) | **NO — confirmed broken via 3 of the 5 real entry points to "Add Position."** Ground-truthed via a monkey-patched `fetch` + direct API queries (`GET /api/j2/notes/{id}/trade-ref/resolve` → `{"links": []}`) after going through the real UI twice, cleanly. **Root cause found and confirmed by manually replaying the exact backend call, which succeeds (200, link created) when called directly** — the bug is 100% frontend: `LogTradeButton.jsx` (the persistent header "+ Log Trade" button — the single most discoverable entry point in the whole product) and `JournalLogFab.jsx` (mobile FAB) both define `handleCreatePosition` as `async (payload) => { await jsonPost(...); ...; navigate(...) }` — **the POST response is awaited and discarded, never returned.** `AddPositionModal.jsx`'s own `handleSave` needs `created?.id` from that return value to attach the thesis link (`if (thesisNoteId && created?.id != null) { ...postTradeLink... }`) — with `created` always `undefined` from these two entry points, that block is silently skipped every time. `TodaySurface.jsx`'s inline handler has the identical shape (discards the response, never returns). **Two entry points are correct** (`GlobalAddPositionProvider.jsx` and `OpenPositionsTab.jsx`'s own "+Add Position" button both explicitly `return created`, each with a comment citing this exact Wave 3 requirement) — this is a real duplicated-logic defect (the same fix landed in 2 of 5 copies of near-identical code, not in the other 3). |
| Does the member get ANY signal that the link failed? | Required (per `AddPositionModal.jsx`'s own documented design — a failed link should show `pendingLink`/retry UI) | **NO — confirmed.** The retry/warning UI (`pendingLink`, `thesisLinkWarning`) only activates when `postTradeLink` itself returns an error string — it is never reached at all from the 3 broken entry points, because the surrounding `if` block is skipped entirely. The member sees a clean success toast ("Logged {SYMBOL} long position") and the modal closes normally, with **zero indication** anything is wrong. |
| Is the link visible on the open position afterward? | Required | **Confirmed absent, a second, separate finding** — `LinkedNotesPanel` (the reverse-direction "notes linked to this trade" panel) is mounted only in `TradeDetailPage.jsx` and `TradeDrawer.jsx` (the CLOSED-trade views) — grepped `PositionDetailPage.jsx` (the OPEN position view) directly: zero matches. Even through a WORKING entry point, a member who just linked a thesis to an open position has no way to see that link on the position itself until it eventually closes into a trade. |
| Is the link visible on the note afterward? | Required | **Confirmed absent when the link failed** (as it does from 3 of 5 entry points) — `NoteLinkedTradeChips` correctly renders nothing, because correctly, there is nothing to render; this is NOT a rendering bug, the chip component is doing its job against a real empty state. |

**This is the single most severe finding in this entire UX/UI audit, and a
material correction to the readiness scorecard's Trading Journal Integration
score (previously 7/10, the highest on the scorecard) — see the scorecard
update.** A capability described throughout this program as "live, extensively
tested, production-verified" (Wave 3) silently fails from its most discoverable
entry point. This is a functional regression, not merely a UX-polish gap —
classified P0 in the impact-classification report (see the decision report for
full reasoning on Stage A validity impact).

## Workflow 6 — Asking a Question About a Note (AI)

| | Notion AI | Evernote AI | Obsidian | UCT Current | UCT Target |
|---|---|---|---|---|---|
| **Entry point** | Inline "Ask AI" / sidebar (Business+ tier) | AI Assistant panel (free-tier) | No native equivalent (plugin-dependent) | **Confirmed well-executed**: explicit "Ask this note" toggle opens a small non-modal popover — contextual, not a separate destination | Matches the directive's own §18 prescription for contextual, not chatbot-bolted-on, AI |
| **Response presentation** | Cited, Business+ only | Real-time | N/A | **Confirmed strong**: token-streamed visibly, not all-at-once | Maintain |
| **Citation quality** | Text citations | Basic | N/A | **Confirmed genuinely excellent** — citations are clickable buttons that scroll to and highlight the exact quoted source text in the note. This is the single best-executed interaction pattern found in this entire audit. | Use this exact pattern as the template for Ask Notebook's citations |
| **Follow-up support** | Yes | UNVERIFIED | N/A | **Confirmed**: last-3-turn history sent with each request, follow-ups work within one open session | Maintain |
| **Error handling** | UNVERIFIED | UNVERIFIED | N/A | **Confirmed specific and friendly**: rate-limit shows the actual reset time, paid-gate explains the requirement, generic failure says "Something went wrong." — notably, this is the ONE surface in Notebook that does NOT leak raw errors (contrast Workflow 7) | Use this as the house standard other surfaces should match |

## Workflow 7 — Recovering a Mistake (trash/restore, and the error-recovery cousin of it)

| | Notion | Evernote | Obsidian | UCT Current | UCT Target |
|---|---|---|---|---|---|
| **Delete confirmation** | Modal, styled | Modal, styled | File-system-level (varies) | **Confirmed real inconsistency**: uses the native, unstyled browser `confirm()` dialog, not a UCT modal component — message content is good ("Delete this note? You can restore it from Trash for 30 days.") but the visual presentation breaks pattern with the rest of the product | Replace with the shared UCT modal/Sheet component |
| **Trash empty state** | 30-day trash, explained | Trash, explained | Trash, explained | **Confirmed well-designed**: "Trash is empty." + explains the 30-day window | Maintain |
| **Restore friction** | One click | One click | File-system-level | Confirmed one-click restore, exact content recreated (proven by sandbox browser E2E, Wave 0) | Maintain |
| **Recovery from a SYSTEM error (not a user mistake)** | Standard error toast | Standard error toast | N/A (local files) | **Confirmed real defect, the most consequential UX finding in this ledger**: raw error text is interpolated directly into member-facing UI in at least 3 places (notes-load failure, note-save failure showing raw HTTP/exception text, the import-wizard crash fallback) — a direct violation of "never show raw backend errors." A second defect: a note that fails to load has no distinct error branch and appears to hang on "Loading…" indefinitely. | **P0-equivalent fix, cheap, high-trust-impact** — sanitize all three error surfaces; add an explicit note-load-failure branch |

## Workflow 8 — Power-User Keyboard-Driven Session

| | Notion | Evernote | Obsidian | UCT Current | UCT Target |
|---|---|---|---|---|---|
| **Command palette / quick switcher** | Cmd/Ctrl+K, comprehensive | Limited | Cmd/Ctrl+O quick switcher, core and beloved | **A fully-built, proven, app-wide `Cmd/Ctrl+K` command palette already exists in this exact codebase (`CommandPalette.jsx`) — Notebook has ZERO participation in it.** The single cheapest, highest-leverage finding in this entire audit: the infrastructure exists, only the wiring is missing. | Register Notebook actions (new note, search-focus, jump-to-note) in the existing palette — do not build a second one |
| **In-note shortcuts** | Extensive (`/` commands, formatting shortcuts, `[[` linking) | Basic | Extensive (`[[` linking, hotkeys, community shortcut plugins) | **Confirmed minimal**: zero custom keydown handling in the editor component itself — every keyboard behavior beyond TipTap's own defaults (bold/italic/undo) is absent; no save shortcut, no close shortcut, no next/prev-note navigation | Add the small, high-value set: save, close/escape, navigate notes |
| **Note-to-note link speed** | `[[` or `@` mention, fast | N/A | `[[` autocomplete, extremely fast, core to the product | **Confirmed absent as native authoring** — only raw URL paste links work today, though Obsidian-imported wikilinks DO resolve to real navigable links (an existing rendering capability with no native authoring UI yet) | Add a `[[`-style slash command once backlinks work is prioritized (gap ledger G-022/G-033) |

## Workflow 9 — Mobile Quick-Check

| | Notion | Evernote | Obsidian | UCT Current | UCT Target |
|---|---|---|---|---|---|
| **Reachability** | Native app | Native app, free-tier offline | Native app | Reachable via the standard `MoreSheet` mobile nav path — confirmed, not a native app | Native app not assumed necessary until evidence supports it (per the master directive's own §35) |
| **Responsive layout** | Native-app-quality | Native-app-quality | Native-app-quality | CSS-level responsiveness confirmed present in 7 Notebook component stylesheets — real, not zero, but **zero JS-level responsive hooks** (`useIsPhone`/`useBreakpoint`) are used in Notebook specifically, an inconsistency with this codebase's own documented convention for touch-vs-mouse conditional rendering | Adopt the existing `useBreakpoint` hooks where touch-specific behavior (not just layout) is needed |
| **Mobile capture** | Native share-sheet | Native share-sheet, well-regarded | Native share-sheet | **Confirmed absent** — a known, explicitly-deferred-to-Stage-B gap, not new information | Stage B |

---

## Cross-Workflow Findings (not tied to one row)

1. **Visual token discipline is inconsistent, measurably**: `NoteEditorPage.module.css`
   uses design tokens 73 times against 53 hardcoded hex values (11 distinct hexes);
   `FolderSidebar.module.css` is 77 vs. 39. Not a single offender — a pattern.
2. **Icon-system adoption is partial**: raw Unicode glyphs (`×`, `✕`, `❝`) appear as
   UI chrome in at least 3 places, against this codebase's own explicit "no generic
   symbols, use `UIcon`" convention. (A callout block's default `💡` is member-content
   formatting, correctly out of scope for this finding.)
3. **No shared skeleton/loading component is reused anywhere audited** — every
   loading state found is plain, un-styled text. Cheap, broad-impact fix.
4. **The command-palette gap (Workflow 8) is this ledger's single highest-leverage
   finding** — it's not a missing capability, it's a missing connection to a
   capability that already exists and works elsewhere in this exact product.

---

## Top UX/UI Findings, Ranked by Leverage (cheap + high-impact first)

**2026-09-06 update: item 10 below (the real-browser audit) has been performed,
and it surfaced a new #0 finding that outranks everything else on this list —
it is a functional regression, not a UX-polish item.**

0. **Fix the thesis-trade link silently failing from 3 of 5 "Add Position" entry
   points** (Workflow 5, LIVE-VERIFIED) — `LogTradeButton.jsx` and
   `JournalLogFab.jsx`'s `handleCreatePosition`, and `TodaySurface.jsx`'s inline
   handler, all discard the position-creation response instead of returning it,
   silently skipping the thesis-link attachment step. Cheap, mechanical fix
   (each needs one `return`, matching the two correct copies already in the
   codebase) but the HIGHEST-severity finding in this audit — see the decision
   report for its P0 classification and Stage A validity impact.
1. Sanitize the 3 raw-error-leak surfaces (Workflow 7) — cheap, directly serves Trust.
   **Precision update:** verified via code that these are UGLY/CONFUSING (bare
   HTTP status codes or deliberately-authored validation messages), never raw
   stack traces, SQL text, or sensitive data — see the decision report's
   INFORMATION DISCLOSURE classification.
2. Wire Notebook into the existing app-wide command palette (Workflow 8) — cheap,
   the infrastructure already exists.
3. Add a note-load error branch so a failed load doesn't hang on "Loading…" forever
   (Workflow 7). **Precision update:** confirmed via code — `NoteEditorPage.jsx`
   destructures `{note, isLoading, update, refresh}` from `useJ2Note`, never
   `error` (which the hook DOES return), and the render guard `isLoading ||
   !note` stays true forever once a fetch fails (`isLoading` settles false,
   `note` stays `null`) — reachable via any transient network failure or a
   stale/deleted note link, not just a rare edge case.
4. Add a linked-notes/research panel to `PositionDetailPage.jsx` (Workflow 5,
   LIVE-VERIFIED, new finding) — `LinkedNotesPanel` exists and works, but is
   mounted only on the CLOSED-trade views (`TradeDetailPage.jsx`,
   `TradeDrawer.jsx`), never the open-position view — so even a successful
   link is invisible until the position closes.
5. Replace the native `confirm()` delete dialog with the shared UCT modal component
   (Workflow 7, Cross-Workflow #1).
6. Add zero-result search guidance (Workflow 4).
7. Add favorites/recents (Workflow 3) — cheap, real gap versus all three competitors.
8. Add a shared skeleton/loading component (Cross-Workflow #3) — broad, cheap,
   improves perceived performance everywhere at once.
9. Replace raw-glyph UI chrome with `UIcon` (Cross-Workflow #2).
10. Wire the capture destination-menu onto all 9 buttons (Workflow 2) — already
    identified by Phase One as small.

**Mobile/responsive real-browser pass: attempted, blocked by a tooling
limitation this session** (the browser viewport could not be resized —
`resize_window` reported success but `window.innerWidth` stayed at 1920px
throughout). Workflow 9 still reflects code-level evidence only; recommend
retrying with different tooling before the next UX pass rather than assuming
this is resolved.

None of the above are authorized for implementation under the current directive —
recorded here as the ranked backlog for when UX/UI work is explicitly authorized.

---

## Stage A Experience Integrity Standard (2026-09-06)

**Purpose:** a minimum bar for "is the current product fairly testable by a real
member," explicitly NOT Notion-level polish. A bar item that fails means real
Stage A behavioral evidence collected right now risks being wrong (a member who
"failed" actually hit a bug, or a member who "succeeded" actually didn't).

| # | Bar | Verdict | Evidence |
|---|---|---|---|
| 1 | Note creation works | **PASS** | Workflow 1, LIVE-VERIFIED — empty-state + template/blank flow both clean |
| 2 | Note loading fails honestly (no infinite hang) | **FAIL** | Note-load defect (#2 below) — `isLoading \|\| !note` hangs on "Loading…" forever after any failed fetch; reachable via ordinary transient network failure |
| 3 | Saving doesn't silently lose work | **PASS** (with caveat) | Autosave failure sets `saveErrorMsg` and surfaces it — not silent — but the message text itself is one of the 3 raw-error-leak surfaces (see #4) |
| 4 | Errors are understandable | **FAIL** | 3 confirmed raw-text surfaces (notes-load failure, note-save failure, import-wizard crash fallback) — UGLY/CONFUSING, not dangerous, but not understandable either |
| 5 | Core navigation reachable | **PASS** | Notebook is a reachable nav tab; command-palette absence is a power-user convenience gap (P2), not a reachability failure |
| 6 | Search usable | **PASS** | Confirmed fast (250ms debounce); zero-result handling is blunt but functional |
| 7 | Capture works | **PASS** | 1-click safe-default save confirmed working; destination-menu wiring is a P2 enhancement, not a functional break |
| 8 | Thesis/trade link is understandable (member knows whether it worked) | **FAIL** | The single most severe finding this pass — see #0/#18 below. On failure, member sees a clean success toast; on success via a working door, the link is invisible on the open position |
| 9 | Destructive actions are recoverable | **PASS** | Trash/restore proven one-click, 30-day window, exact-content restore (Wave 0 sandbox E2E). Native `confirm()` styling is a P2 consistency gap, not a recoverability failure |
| 10 | Responsive layout not functionally broken | **UNVERIFIED** | Live pass blocked by a tooling limitation this session (`resize_window` no-op); code shows CSS responsiveness present, zero JS-level touch hooks in Notebook specifically — no confirmed breakage, not proven safe either |

**Verdict: 2 of 10 bars FAIL today (#2, #8), 1 borderline FAIL (#4), 1 UNVERIFIED
(#10).** Both hard FAILs are cheap, mechanical, low-risk fixes (see Bucket A
below) — this is a "the experience currently misreports itself" problem, not a
"the architecture needs rework" problem. Full reasoning on what this means for
Stage A's Day-0 baseline is in the decision report, point 1.

---

## P0–P4 UX Debt Classification (2026-09-06)

Rubric: **P0** = Stage A validation invalidator (can corrupt current validation
evidence or block a representative member from completing the Stage A
workflow) · **P1** = trust/data-safety UX defect (undermines trust/error-
recovery/confidence even if data is technically safe) · **P2** = high-leverage
parity/usability gap (competitiveness/efficiency, doesn't invalidate Stage A)
· **P3** = polish/consistency · **P4** = future/evidence-gated.

| # | Finding | Tier | Member Job Affected | Stage A Impact | Competitor Parity Impact | Trust Impact | Effort | Dependencies | Recommended Timing |
|---|---|---|---|---|---|---|---|---|---|
| 0/18 | **Thesis-trade link silently fails to create from 3 of 5 "Add Position" entry points** (`LogTradeButton.jsx`, `JournalLogFab.jsx`, `TodaySurface.jsx` discard the position-creation response) | **P0** | Thesis-trade linking (a direct Stage A computable criterion) | **Directly corrupts the "thesis-trade linking ≥3 members" measurement** — the most discoverable door (header "+ Log Trade") silently no-ops; real attempts would undercount or register as failures that were actually product bugs | High — this is UCT's own differentiator vs. all 3 standalone-journal competitors; a broken flagship feature is worse than no feature | Severe — member sees a clean success toast while their core ask (link research to this trade) silently didn't happen | **Low** — 3× missing `return created`, mirroring 2 already-correct copies in the same codebase | None | **Bucket A — immediate** |
| 19 | `LinkedNotesPanel` not mounted on `PositionDetailPage.jsx` (only on closed-trade views) | **P1** | Confirming a link succeeded, on an open position | Does not corrupt the linking metric itself (the API call, when it fires, succeeds) but removes the member's only confirmation loop while the position is open | Medium — same differentiator feature, half-invisible | Medium-High — a member who used a working door still can't see their own work until the trade closes | **Low-Medium** — mount an existing, working component | Pairs naturally with #0/18 (same feature) | **Bucket A** |
| 2 | Note-load failure has no error branch — hangs on "Loading…" indefinitely | **P0** | Viewing/editing any existing note | Can make a member believe Notebook itself is broken on any transient failure — directly corrupts "core workflow completion" evidence, reachable in ordinary use (not a rare edge case) | N/A (internal defect) | Severe if hit — total task blockage, no way forward | **Low** — destructure `error` from `useJ2Note` (already returned, just unused), add a distinct error branch | None | **Bucket A — immediate** |
| 1 | Raw backend error leaks in 3 places (notes-load failure, note-save failure, import-wizard crash) | **P1** | Understanding what went wrong / trusting the product | Does not block task completion by itself, but degrades a member's confidence during exactly the period Stage A evidence is being formed | N/A (internal defect) | Medium — confirmed UGLY/CONFUSING only, NOT information disclosure (no debug mode, no stack traces, no sensitive data — verified via code) and NOT data-loss (autosave still fires; error is shown, not swallowed) | **Low** — reuse the already-correct friendly-error pattern from Workflow 6 (Ask This Note) | None | **Bucket A** |
| 3 | Notebook absent from the existing app-wide command palette | **P2** | Power-user navigation speed | None — palette is a convenience, not a reachability path; core nav works without it | Medium (Notion/Obsidian both have this deeply) | Low | **Low** — the palette infra already exists and works elsewhere | None | Bucket B |
| 4 | Native browser `confirm()` used for note delete | **P2** | Deleting a note | None — the action works and is honestly worded ("...restore it from Trash for 30 days") and fully recoverable | Low-Medium (both competitors use styled modals) | Low — message content is good; only the visual chrome breaks pattern | **Low** | Shared modal/Sheet component (exists) | Bucket B |
| 5 | Token vs. hardcoded-hex inconsistency (73/53 split in `NoteEditorPage.module.css`, 77/39 in `FolderSidebar.module.css`) | **P3** | None directly (invisible if hex values match token values) | None | None | None | Low | None | **Excluded from package** — opportunistic-only when a file is touched for another reason |
| 6 | Raw Unicode glyphs (`×`, `✕`, `❝`) instead of `UIcon` | **P3** | None directly | None | None | Very low | Low | None | **Excluded from package** — opportunistic-only |
| 7 | No shared loading-skeleton component; loading states are plain text | **P2** | Perceived performance during any load | None — functional, just unpolished | Medium (both competitors show skeleton/shimmer states) | Low | **Low**, broad (touches many surfaces) | None | Bucket B |
| 8 | Favorites absent | **P2** | Returning to frequently-used notes | None | Medium (all 3 competitors have this) | Low | Low-Medium | None | Bucket B |
| 9 | Recents absent | **P2** | Returning to recently-used notes | None | Medium | Low | Low-Medium | None | Bucket B |
| 10 | Saved views absent | **P4** | Repeating a complex search/filter | None | Low near-term (Notebook's filters are minimal today) | Low | Medium | **Wave 4's date/entity search filters must ship first** — nothing to "save" yet | Deferred — revisit after Wave 4 |
| 11 | Folder-sidebar correctness | **RESOLVED — FIXED** | Folder disclosure/count accuracy | Closed. Confirmed fixed by direct code read, matching Phase One's exact root-cause description verbatim (`honestCount`/`folderCounts` now wins over the page-derived guess) | — | — | — | — | No further action; closed |
| 12a | In-note keyboard shortcuts absent (save, close/escape, next/prev-note) | **P2** | Power-user editing speed | None — mouse-driven paths all work | Medium (both competitors have rich in-note shortcuts) | Low | Low | None | Bucket B |
| 12b | Note-to-note link speed (`[[`-style authoring) absent | **P3** | Linking notes together while writing | None — raw URL paste works as a fallback; imported wikilinks already resolve | Medium (Obsidian's core loop) | Low | Medium | Ties naturally to the backlinks work already tracked (gap ledger G-022/G-033) | **Excluded from package** — revisit with that backlog item, not standalone |
| 13 | Mobile/responsive functional status | **UNVERIFIED** (not yet tiered) | Any mobile Notebook use | Unknown — cannot rule P0 in or out without a live pass | Unknown | Unknown | N/A until verified | A working browser-resize tool, or a real device | **Bucket B — re-verify first**, then re-tier based on what's found |
| 14/15 | Thesis-creation UX | **GOOD, verified — no debt item** | Creating a thesis note from the trade flow | Positive: genuinely well-designed, clear affordances, good helper copy | Matches/exceeds directive's own §17 bar | Positive | — | — | No action; maintain |
| 16 | Capture destination-choice menu (`targetsFor()`) unwired on capture buttons | **P2** | Choosing WHERE a capture lands (vs. accepting the 1-click default) | None — the 1-click safe default already works; this is a missing power-user choice, not a functional break | Low-Medium | Low | Low | None | Bucket B |
| 17 | 4 capture surfaces uncovered (Screener, Options Flow, COT Data, Model Book) | **P2** | Capturing research from those 4 specific surfaces | None — 9 of 13 surfaces already covered | Low (breadth completeness, not a core-loop gap) | Low | Low-Medium (mirrors existing pattern per surface) | None | Bucket B |

**Deliberately NOT inflated to P0/P1:** items 3–17 above are the majority of
this list, and all but two land at P2/P3/P4/RESOLVED/UNVERIFIED. Only the two
items that can actively corrupt Stage A's own measurements (#0/18 and #2) are
P0; only the two items that erode trust without touching measurement validity
(#1 and #19) are P1.

---

## Experience-Quality Remediation Package (first, minimal — 2026-09-06)

Scope discipline per the governing directive: cheap/moderate effort, high
leverage, low architectural risk, independent of Wave 4, rights-independent,
justified by evidence above. **Explicitly excludes** every P3 polish item and
every item gated on something not yet true (Wave 4 filters, the backlinks
backlog) — those stay in the ledger as backlog, not as scheduled work.

### Bucket A — recommended BEFORE Stage A validation continues
*(Only items that materially affect trust, task-completion, or validation
validity. This is the set that answers "is the clock we're running actually
measuring the right thing.")*

1. **Fix the thesis-trade link creation bug** — add the missing `return
   created` in `LogTradeButton.jsx`, `JournalLogFab.jsx`, and
   `TodaySurface.jsx`'s inline handler, mirroring the 2 already-correct
   copies (`GlobalAddPositionProvider.jsx`, `OpenPositionsTab.jsx`). [P0]
2. **Add a note-load error branch** — destructure `error` from `useJ2Note`
   in `NoteEditorPage.jsx` and render a distinct "Couldn't load this note"
   state with a retry action, instead of hanging on the loading branch
   forever. [P0]
3. **Mount a linked-notes panel on `PositionDetailPage.jsx`** — reuse the
   existing, working `LinkedNotesPanel` so a successful link is visible on
   the OPEN position immediately, not only after it closes into a trade.
   [P1, pairs with #1]
4. **Sanitize the 3 raw-error-leak surfaces** (notes-load failure, note-save
   failure, import-wizard crash fallback) — reuse the already-correct
   friendly-error pattern proven in Workflow 6 (Ask This Note). [P1]

### Bucket B — recommended AFTER Stage A / before or around Wave 4
*(High-leverage parity/usability items that do not invalidate current
validation — sequence and pace these against Wave 4, not urgently.)*

1. Wire Notebook into the existing app-wide command palette.
2. Replace the native `confirm()` delete dialog with the shared UCT
   modal/Sheet component.
3. Add a shared loading-skeleton component, applied broadly.
4. Add favorites + recents.
5. Add zero-result search next-step guidance.
6. Wire the capture destination-choice menu onto all capture buttons;
   extend capture to the 4 uncovered surfaces (Screener, Options Flow, COT
   Data, Model Book).
7. Add the small high-value in-note keyboard set (save, close/escape,
   next/prev-note navigation).
8. Re-attempt the live mobile/responsive audit with different tooling (or a
   real device) — re-tier item 13 above once real evidence exists, rather
   than leaving it UNVERIFIED indefinitely.

**Excluded from both buckets, backlog-only:** token/hex consistency
(#5), raw-glyph→`UIcon` replacement (#6), note-to-note `[[`-style link
authoring (#12b, ties to the backlinks backlog item), saved views (#10,
gated on Wave 4 filters shipping first).

None of the above is authorized for implementation under the current
directive — this package is prepared for authorization, not executed.
