# UCT Notebook — UX/UI Competitive Ledger

**What this is:** a living, interaction-sequence-level comparison of UCT Notebook
against Notion/Evernote/Obsidian — not a screenshot/cosmetic comparison. Each row
below is a real workflow, broken into the actual steps a member takes, not a
feature checkbox.

**Evidence standard, stated explicitly per product/column:**
- **UCT Current** columns are grounded in direct code reading this session (file:line
  citations available in the source research; not repeated in every cell here for
  readability) — this is what the interaction CODE does. Live-browser visual
  confirmation of the RENDERED result has not yet been performed for this ledger;
  treat every UCT claim below as "confirmed from code," not "confirmed by watching
  a member use it."
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
| **First impression** | Template gallery + empty workspace; database-first framing that can overwhelm a non-technical first-timer (Phase Zero §4) | Notebook list + a prominent capture button — capture-first framing (Phase Zero §5) | An empty vault + a stark, minimal UI — famously unopinionated, can read as "now what?" to a non-power-user (Phase Zero §6) | **Confirmed genuinely well-designed**: explicit empty-state copy ("Your notebook is empty" + "Start from a template — or a blank page") plus an import-pitch CTA offering the two most likely next actions in one screen | Keep as-is — this already matches the governing directive's own §20 empty-state spec closely |
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

| | Directive's UX bar (§17) | UCT Current |
|---|---|---|
| Can the user understand why a thesis is linked? | Required | **Likely yes, structurally** — `NoteLinkedTradeChips` renders visible chips on the note; `LinkedNotesPanel` shows the reverse direction on the trade. Not independently re-verified visually this pass (built earlier this session, not re-audited by the UX fork). |
| Can it be created naturally from the trade workflow? | Required | **Yes, confirmed** — `AddPositionModal`'s pre-trade thesis flow (search/create a thesis note inline) with graceful failure handling (retry without resubmitting the position, or close without linking) |
| Is the relationship visible but not intrusive? | Required | UNVERIFIED visually — chip-based design suggests "visible but compact" by intent, not independently confirmed rendered |
| Does a position graduating to a trade feel seamless? | Required | UNVERIFIED — not audited this pass |

**This entire row is flagged as the clearest example of a real capability-vs-
experience measurement gap** — the capability score for this domain is a 7 (highest
on the scorecard) precisely because the *technical* link is well-built and
well-tested; whether it *feels* natural to a trader has not been independently
UX-audited. Recommend this as the first candidate for a real-browser visual pass
when one is authorized.

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

1. Sanitize the 3 raw-error-leak surfaces (Workflow 7) — cheap, directly serves Trust.
2. Wire Notebook into the existing app-wide command palette (Workflow 8) — cheap,
   the infrastructure already exists.
3. Add a note-load error branch so a failed load doesn't hang on "Loading…" forever
   (Workflow 7).
4. Replace the native `confirm()` delete dialog with the shared UCT modal component
   (Workflow 7, Cross-Workflow #1).
5. Add zero-result search guidance (Workflow 4).
6. Add favorites/recents (Workflow 3) — cheap, real gap versus all three competitors.
7. Add a shared skeleton/loading component (Cross-Workflow #3) — broad, cheap,
   improves perceived performance everywhere at once.
8. Replace raw-glyph UI chrome with `UIcon` (Cross-Workflow #2).
9. Wire the capture destination-menu onto all 9 buttons (Workflow 2) — already
   identified by Phase One as small.
10. Real-browser visual audit of the thesis-trade-link workflow specifically
    (Workflow 5) — the clearest open capability-vs-experience measurement gap.

None of the above are authorized for implementation under the current directive —
recorded here as the ranked backlog for when UX/UI work is explicitly authorized.
