# UCT Notebook — Primary Notebook Readiness Scorecard

**Purpose:** one durable, evidence-scored answer to "how close is UCT Notebook to
being a credible primary notebook for its target financial persona." Scores are
0-10 confidence-ladder readiness, not effort-remaining or feature-count. **A score
reflects evidence, never optimism** — "code exists" alone caps a domain at 4-5;
higher scores require production verification, and 9-10 requires demonstrated real
member behavior, which — per the active Stage A gate — does not exist yet for
anything in this product.

**Baseline date:** 2026-09-06. Source: `competitive-primary-platform-phase-zero.md`
+ `-phase-one-adversarial.md` (2026-09-05 research) reconciled against Wave 0-3,
Stage A instrumentation, and Wave 4 prep (shipped/designed since), verified via 3
fresh read-only research passes this session. Re-score only on real evidence
change, not on a schedule.

## Score ladder (used for every domain below)

| Score | Meaning |
|---|---|
| 0-1 | Absent, no code |
| 2-3 | Designed or partially built, not member-facing |
| 4-5 | Code exists, unit/integration tested, not production-verified |
| 6-7 | Production-verified (deployed, health-checked, correct) but no real member usage evidence |
| 8 | Real member usage exists and the capability holds up under it |
| 9 | Real member usage across MULTIPLE members (not one power user) confirms the capability works and is used repeatedly |
| 10 | Sustained, multi-week real usage; the capability is a demonstrated reason members don't return to their old tool |

**Every score below is capped at 6-7 today** — Stage A validation (real member
behavior) is active but has recorded zero usage as of this baseline (instrumentation
deployed 2026-09-06, day 0). No domain can honestly score 8+ yet. This cap is
itself the most important fact on this scorecard and should not be inflated away
by a future editor without new evidence.

---

## Domain Scores

| Domain | Score | Rationale |
|---|---|---|
| **Editor** | 6 | Genuinely strong, production-verified (headings/lists/tables/checklists/callouts/toggles/images/links, autosave with retry+backoff, native undo/redo). Real gaps: no command palette, no find-in-note, no note-to-note link authoring UI, attachments image-only. Capped at 6 (no real-usage evidence) not 7 (a few confirmed gaps a "strong" editor shouldn't have). |
| **Organization** | 7 (was 5) | Nested folders (depth 6), tags, single-ticker field, and **Favorites + Recents (Wave B, shipped + production-verified 2026-09-06)** — a note-scoped favorite toggle and a system-derived recently-opened list, both trash-aware, both live-verified end-to-end in the fail-closed sandbox and confirmed live in production via bundle-content grep. Saved views + structured properties now shipped in Wave E (see the dedicated "Structured Research" row below) — the organization-primitive gaps this row named are closed. Capped at 7, not 8+: Day 0 of real member usage (ladder rule). |
| **Search / Retrieval** | 8 (was 5) | FTS5 engine is correctly built and production-verified. **Wave A (Search Evolution I) shipped and live-verified 2026-09-06**: date-range filter (with a real correctness index), query-aware highlighted snippets replacing the naive 120-char slice, opt-in relevance ranking (exact structured matches beat fuzzy text matches, verified live), sector/theme entity-anchored retrieval (verified live against a real provider call), and the $NVDA-ticker-field correctness bug is fixed. Folder-sidebar correctness was separately re-verified FIXED earlier the same day. **Not a 9/10**: semantic/vector search remains evidence-gated future work (deliberately, per architecture §7 sequencing — not a gap), and this is Day 0 of real member usage on the new search UX, so "does it feel right to a real member" remains unmeasured. |
| **Capture (Save-to-Notebook)** | 6 | The mechanism itself is live, real, and unusually mature for this stage (`CaptureInboxTray`, shared envelope, 9 widget doors) — a genuine structural head start. Capped at 6 by real, confirmed gaps: 4 major surfaces (Screener, Options Flow, COT Data, Model Book) have no capture door; no comment/annotation field at capture time; destination-menu wiring status needs a direct confirm. |
| **AI on Notebook content** | 4 | Ask Current Note is live, scoped correctly, production-verified — a real, working P0. Corpus-wide "Ask Notebook" is 100% greenfield (zero embedding infrastructure exists for note content specifically). The domain average reflects that the harder, higher-value half of "AI on my notebook" hasn't started. |
| **Temporal Correctness / Provenance** | 5 | The chart-embed "frozen at insert" pattern is real, correctly designed, and the strongest genuine differentiator in the whole product — but it's proven for ONE data type. Fundamentals/watchlist/scanner snapshot semantics are also done. Analyst estimates/ratings cannot be captured AT ALL yet (not hardened, doesn't exist), and a live, real Calendar-embed forward-looking bug is open. The pattern is proven; its promised universality is not yet true. |
| **Thesis Intelligence** | 3 | "Thesis" is a bare tag string today, no structured fields, no changelog, no diff view. The trade-link half (a DIFFERENT capability, see Trading Journal Integration below) is strong — don't let that borrow credibility for this domain, which is genuinely early. |
| **Trading Journal Integration** | **6 (was 3, revised down 2026-09-06; fixed + re-verified same day)** | Wave 3's typed `tradeRef`/`tradeRefType` reference system, resolver, and bidirectional navigation are real and correctly scoped, per Phase One's independent adversarial review. **A real-browser live audit this session found the thesis-link creation step silently failed from 3 of the 5 real "Add Position" entry points** (`LogTradeButton.jsx` — the persistent header button, the single most discoverable entry point in the product; `JournalLogFab.jsx`; `TodaySurface.jsx`) — each discarded the position-creation response instead of returning it, so `AddPositionModal.jsx` never had a position id to attach the link to, with zero error shown. A SECOND finding: even through a working entry point, the resulting link was invisible on the open position's own detail page (`LinkedNotesPanel` was mounted only on the closed-trade views). **Both fixed and re-verified the same day** (the authorized Bucket A pass): all 5 entry points now correctly return the created position; `LinkedNotesPanel` now mounts on the open-position view, keyed to the raw position id (not the side-merged display model, which could otherwise silently drop a second scale-in's link). Live-verified end-to-end through the real header button in the fail-closed sandbox — position created, note created, link POST fired and succeeded, visible both directions. **6, not 7**: the capability now works and is proven live, but the fact that 3 of 5 duplicate implementations of the same handler diverged silently — and shipped that way through this program's own "extensively tested" claim — is itself evidence this exact pattern (many near-identical entry points to one modal) is fragile; real-member validation evidence still doesn't exist (Day 0). The mobile FAB entry point is unit-verified, not live-browser-verified (same tooling limitation blocking the mobile pass elsewhere in this audit). |
| **Trust / Recovery** | 7 (was 6) *(Wave C, 2026-09-06: version history built, tested, and now production-verified)* | Trash/undo-delete is live and production-verified (Wave 0). The account-deletion cascade FK gap is confirmed fixed. **Version history — the one remaining Trust-parity bar this domain lacked — is now BUILT AND LIVE**: full-snapshot `j2_note_versions` with coalescing capture, restore (never erases history — a pre-restore checkpoint is always force-captured), the pre-existing optimistic-lock 409 mechanism covering multi-tab concurrency for free, cascade-delete + account-purge coverage. 105 backend tests + 1646 frontend tests passing; a full restore round trip (edit → restore-to-blank → reverse-restore back) was verified live in a real browser against the fail-closed sandbox at BOTH desktop and phone widths, including the confirm-dialog copy, the diff view, and the pre-restore content genuinely reappearing as its own recoverable version. **Now merged to `master` (commit `928380241`) and deployed** — Railway build SUCCESS, `/api/health` confirmed on a fresh process (`uptime_seconds: 22` at check time), `GET /api/j2/notes/{id}/versions` on `uctintelligence.com` now returns a real `401 application/json` (correctly auth-gated, no bypass attempted) instead of the SPA catch-all HTML, and the production JS bundle (`NotebookTab-*.js`, fetched live and grepped) contains the shipped UI strings ("Restore this version", "No earlier versions yet"). **7, not 8+**: no real member usage evidence exists yet (Day 0 for this specific capability) — the ladder's own cap. |
| **Security / Privacy / Isolation** | 6 | Tenant isolation is structurally sound and consistently enforced (`user_id`-scoped everywhere, confirmed via spot-checks this session). Note content and attachments remain plaintext at rest — a real, known, unresolved gap. The Stage A telemetry/sandbox safety rail work this session (AUTH_DB_PATH isolation) is testing infrastructure, not a member-facing security capability, and does not raise this score. |
| **Performance / Scale** | 5 | `list_notes` (the "open Notebook" path) is flat 1.3-2.3ms even at 50k synthetic notes — genuinely strong. Several other read paths (folder counts, backlinks, FTS at platform scale) are confirmed super-linear at 50k and NOT yet root-caused. The single-uvicorn-process architectural ceiling is a named, real, unowned risk. Real production scale today (89 notes) is nowhere near where any of this matters — the score reflects unresolved risk at a scale the product doesn't face yet, not a current member-facing problem. |
| **Export / Portability** | 7 (was 6) *(Wave C, 2026-09-06: both G-091/G-092 gaps closed, tested, and now production-verified)* | Full-library export is genuinely strong and independently round-trip-verified. **Both gaps found the prior session are now closed and live**: single-note export (`build_single_note_export` — bare `.md` when no attachments, `.zip` when there are, sharing the full export's markdown/attachment code paths rather than a second implementation) and typed trade-ref preservation (resolves to a human-readable "SYMBOL (kind)" line via `resolve_trade_ref` — never a raw internal id; an unresolved/ambiguous ref is omitted, never shown as a broken reference) plus related-tickers and import-provenance front matter fields. 20+ new backend tests; the single-note export endpoint verified live in the real-browser sandbox pass (200, real markdown body) at both desktop and phone widths. **Now merged to `master` and deployed**: `GET /api/j2/notes/{id}/export` on `uctintelligence.com` now returns a real `401 application/json` (correctly auth-gated) instead of the SPA catch-all, and the production bundle contains the shipped "Markdown" export button's copy. **7, not 8+**: no real member usage evidence yet. |
| **Mobile** | 4 | Notebook is reachable via the standard mobile nav path and has CSS-level responsive handling in 7 component stylesheets — not zero, contrary to what a first look might suggest. No JS-level responsive hooks, no mobile capture/share-sheet (a confirmed, explicitly-deferred-to-Stage-B gap). |
| **Offline** | 1 | Fully absent — no service worker, no manifest, no offline read cache. Correctly and deliberately low-priority per both research phases (UCT's live-streaming architecture makes ~90% of the product useless offline regardless of Notebook), but the honest score for the capability itself is near-zero. |
| **Knowledge Linking (backlinks / note-to-note)** | 7 (was 3) *(Wave D, 2026-09-06: native authoring + backlinks built, tested, and now production-verified)* | Import-path Obsidian `[[wikilinks]]` already became real, navigable links (positive finding, unchanged). **Both gaps this row named are now closed and live**: native `[[`-triggered authoring (a real `Suggestion`-based autocomplete searching the member's own notes, keyboard-complete) inserting a `noteLink` atom node whose identity is the target's id — never a frozen title, so renaming a target updates every place it's linked from with zero writes to any other note. **Correction (closure pass, 2026-09-06):** that data-model claim was always true, but the DISPLAY of it briefly wasn't — a live-browser reproduction found a renamed/trashed/restored target's title/status could show stale in an already-open note within the same browser tab until a full reload (a module-level display-cache with no invalidation hook). Fixed with a targeted cache-invalidation hook on the four write paths that change a note's own title/status (save, Wave C restore, trash, un-trash); re-verified live, all four, before-and-after. Still no data-integrity impact at any point — only the client-side display cache was ever stale, never the stored link. A "Linked from (N)" backlinks footer section (reusing the existing `CollapsibleSection`) showing which other notes link to the one being viewed. 134 backend + 33 frontend tests, including adversarial cases (self-links, A↔B and A→B→C→A cycles, cross-tenant isolation — a foreign or nonexistent target is never distinguishable). Verified live in a real browser end-to-end: typed `[[NVDA` → real search results → selected → inserted chip resolving the live title → clicked → navigated to the target → its backlinks panel showed the source note → expanded → clicked → navigated back. **Merged to `master` (commit `7ea7fc3fe`) and deployed** — Railway build SUCCESS, fresh-process health confirmed, both new routes (`/notes/{id}/backlinks`, `/notes/link-targets`) return real `401`s in production (not the SPA catch-all), and the production `tiptap-*.js` bundle contains the shipped UI copy ("Linked from", "Note unavailable", "No matching notes"). **7, not 8+**: no real member usage evidence exists yet (Day 0 for this capability) — the ladder's own cap. Entity/mention reverse-index (ticker-scoped) remains a separate, narrower mechanism, unchanged by this wave. |
| **Structured Research (properties / dynamic views)** | 7 (was 1) *(Wave E, 2026-09-07: built, tested, and real-browser-verified — not yet production-deployed at time of writing)* | The domain UCT was furthest behind on now has typed properties (built-in + user-defined, 7 types incl. select/multi_select), 5 financial-derived properties computed LIVE with zero duplicate storage (Ticker/Sector/Industry/Theme/Linked Trade — the checkpoint's own "UCT already knows this" principle, delivered), saved views with a Table view + per-column quick-filter chips. **Stable-id rename-safety (property AND option) proven live end-to-end** — matching Notion's own model, refuting Obsidian's unsafe name-keyed one and Evernote's query-text one, per fresh official-docs research. **7 real, reproducible defects found via live browser/API testing and fixed** in this pass (not caught by the unit suite alone): a new property invisible until reload, a select property shippable with zero options and no way to add any, a saved view permanently 400ing after the property it filtered on was deleted (now degrades gracefully), a table-row click contract mismatch (`?note=undefined`), a stale-derived-property-on-ticker-change gap, an internal string-vs-None contract bug, and a missing label/control ARIA association. Full detail in `prelaunch-primary-notebook-build-plan.md`'s Wave E closure section. **7, not 8+**: OR/group filters, multi-key sort, and board/calendar views are deliberately deferred (not missed); no frontend UI exists yet to rename a user-created property/option (backend supports it, proven via direct API in the rename-safety test); zero real member usage evidence (Day 0); not yet merged/deployed to production at the time this line was written. |
| **Documents / OCR** | 1 | Attachments are image-only; no PDF/generic-file upload path exists at all. OCR is explicitly REJECTED for scans/handwriting (Phase One: not this persona's real professional-input shape — filings/transcripts/charts are already digital-native) but plain PDF-as-document ingestion + text search remains a real, separate, unscored gap. |
| **Keyboard / Power-User Efficiency** | 6 (was 2) | **Wave B (shipped + production-verified 2026-09-06)** closed the single highest-leverage gap named in the prior audit: Notebook now participates in the app-wide command palette (New Note, Open Notebook, Search Notebook, Open Trash, Open Recent/Favorite note — matched by natural terms, live-verified via real Ctrl+K interaction in the sandbox and confirmed live via bundle grep). Find-in-note now exists as a real, scoped, ephemeral-highlight feature (Ctrl/Cmd+F, match counter, next/prev) — no longer "browser Ctrl+F only." A "Notebook" section documents both in the shortcut cheat sheet. Real remaining gaps: no in-note save/close/navigate-between-notes shortcut set beyond what shipped, no dedicated quick-switcher distinct from the palette. Capped at 6, not 7+: Day 0 of real member usage. |
| **Accessibility** | 5 (was 4) | Still explicitly NOT a WCAG certification. **Wave B (2026-09-06)** added a defensible incremental baseline on the surfaces it touched: the destructive-confirm dialogs (folder/note delete) now use `ConfirmModal` — `role="dialog"`, focus-trap, Escape-closes, backdrop-click-cancel — replacing native `confirm()` (which had none of that); the new star toggle carries explicit `aria-label`/`aria-pressed`; the new Favorites/Recents sidebar rows and find-in-note bar carry explicit `aria-label`s; the command palette's existing dialog semantics were preserved through the merge. No formal contrast audit or full screen-reader pass has been run across all Notebook surfaces — those remain open. |
| **Collaboration** | 3 | One real, substantial, but fully dark capability exists — a token-based, sanitized, flag-gated-OFF public share-link mechanism (`note_shares.py`, `J2_SHARE_LINKS_ENABLED=0`) — more built-out than either research phase credited, but flag-gated OFF with zero real usage and zero validated demand, so it can't score higher. Zero comments/mentions/multiplayer/team-workspace concept beyond that; no account/team-boundary primitive exists anywhere in UCT's auth system, which is the real prerequisite before any deeper collaboration work, not a UI increment. |
| **Templates** | 5 | 8 real, data-aware, production-verified templates exist — but every one is trading-ritual-shaped; zero fundamental/company-research templates exist, and there's no user-defined template capability. Strong for the primary beachhead persona, absent for secondary personas. |

---

## UX/UI Domain Scores (2026-09-06 addition — permanent cross-cutting requirement)

**Why this section exists separately, not folded into the domains above:** the
governing UX/UI Constitution requires UX/UI quality to be explicitly evaluated,
never hidden inside a capability score or inflated because a component exists.
These scores are grounded in real interaction-code evidence (a dedicated
read-only research pass over empty/loading/error states, destructive-action
safeguards, keyboard behavior, and design-system consistency) — not visual
impressions from a rendered screen, which this pass did not perform. Where a
verdict below says "confirmed," it means confirmed from code; live-browser
visual confirmation remains a distinct, not-yet-performed step (see the UX/UI
ledger's own evidence-standard note).

| Dimension | Score | Rationale |
|---|---|---|
| **Visual Coherence** | 4 | Real, quantified inconsistency: `NoteEditorPage.module.css` uses design tokens 73 times against 53 hardcoded hex-color values (11 distinct hexes); `FolderSidebar.module.css` is 77 tokens vs. 39 hex. Delete confirmation uses the native, unstyled browser `confirm()` dialog rather than a UCT modal component. Several UI-chrome elements (a close `×`, a discard `✕`, a blockquote toolbar `❝`) use raw Unicode glyphs, directly against this codebase's own stated convention (no generic symbols — use `UIcon`). |
| **Information Architecture** | 5 | Folders/tags/trash form a coherent, real structure — but no favorites, recents, or saved views exist, and Notebook doesn't register with the app-wide `CommandPalette.jsx` at all (zero mentions of "notebook"/"journal-2-0" in that file), so a proven, reusable IA pattern already built for the rest of UCT simply doesn't include Notebook. |
| **Discoverability** | 4 | Capture is well-discovered (9 real widget doors, a genuine structural head start) — but the destination-choice menu (`targetsFor()`) is unwired to the capture buttons per Phase One's independent finding, and the command-palette gap above means a power user has no app-wide way to discover Notebook actions the way they can for the rest of UCT. |
| **Interaction Quality** | 5 | A real split: Ask Current Note is the single best-executed interaction pattern found anywhere in Notebook this pass (token-streamed answers, clickable citations that scroll-and-highlight the exact source text, specific and friendly error copy even for rate-limits and paid-gates) — pulled down by the native-`confirm()` delete dialog and a genuinely concerning, repeated pattern below. |
| **Navigation** | 4 | Folder-sidebar leaf-row correctness bug status is unconfirmed (needs a direct re-check, see gap ledger G-012); no favorites/recents to jump back into recent work; note-open/close is otherwise straightforward. |
| **Editor Experience** | 6 | Confirmed strong core (headings/lists/tables/checklists/callouts/toggles, autosave with retry+backoff + a localStorage safety net). Real gap confirmed this pass: **zero custom keydown handling exists in `NoteEditorPage.jsx` itself** — every keyboard behavior beyond TipTap's own defaults (save, close, navigate between notes) is simply absent, and the editor doesn't participate in the app-wide command palette either. |
| **Search Experience** | 6 | Search-as-you-type is real and fast (250ms debounce, confirmed by Phase One as comfortably inside RAIL/Nielsen targets), with an honest `role="status"` loading indicator and a friendly, non-leaking error message ("Search failed — try again."). Real gap: zero-results copy ("No notes match \"{query}\"") offers no next step — no "try broadening your search" or similar guidance. |
| **Capture Experience** | 6 | One-click default save is real and correctly designed (per §12 of the governing directive's own prescription, already matches it). `CaptureInboxTray`'s two-step inline "Discard?" confirm (2.5s window, no modal) is a genuinely well-judged low-friction pattern for a reversible, low-risk action. Capped by the unwired destination menu and the 4 uncovered capture surfaces (Screener/Options Flow/COT/Model Book). |
| **Mobile/Responsive Experience** | 4 | CSS-level responsiveness exists in 7 Notebook component stylesheets (not zero) but zero JS-level responsive hooks (`useIsPhone`/`useBreakpoint`) are used anywhere in Notebook specifically — a real inconsistency with how the rest of the app (per its own documented convention) is supposed to handle touch-vs-mouse conditional rendering. No mobile capture/share-sheet (a confirmed, deliberately-deferred-to-Stage-B gap, not scored down further here). |
| **Perceived Performance** | 4 | No skeleton/shimmer loading component is reused anywhere checked — every loading state found is plain, un-styled `"Loading…"`/`"Searching…"` text. This is a real, cheap-to-fix gap: the underlying data loads fast (confirmed elsewhere on this scorecard), but the UI doesn't visually communicate that speed the way a skeleton would, so *perceived* performance likely undersells *actual* performance. |
| **Empty/Loading/Error States** | 5 | A genuine split, not a single verdict. **Empty states are well-designed** — the zero-notes state explicitly explains purpose and offers the two most likely next actions ("Start from a template — or a blank page" + an import CTA), and the empty-Trash state explains the 30-day retention window, both matching §20 of the governing directive's own specification closely. **Error states have a real, repeated defect**: raw error objects are interpolated directly into member-facing text in at least three places (`NotebookTab.jsx`'s notes-load failure, `NoteEditorPage.jsx`'s save-error UI showing raw HTTP/exception text, `ImportWizard.jsx`'s crash-boundary fallback) — a direct, concrete violation of "never show raw backend errors to normal members." A second real defect: a note that fails to load has no distinct error branch at all — `NoteEditorPage.jsx` appears to remain on `"Loading…"` indefinitely rather than surfacing a "couldn't load this note" message. |
| **Accessibility** | UNSCORED | Not comprehensively audited this pass — scoring it without real evidence would be exactly the "inflate because code exists" failure mode this scorecard exists to avoid. One positive data point (`role="status"` on the search-loading indicator) and one incidental positive (the native `confirm()` dialog is, ironically, fully keyboard/screen-reader accessible by virtue of being a real OS dialog) were found; nothing more. Needs a dedicated accessibility pass before this row can carry a number. |
| **Consistency** | 4 | The token/hex mix, the native-dialog-vs-modal split, and the raw-glyph-vs-UIcon split are three independent, each real, instances of the same underlying pattern: Notebook was not built against one enforced set of shared interaction primitives. None are severe individually; together they're the clearest concrete evidence for this dimension's score. |
| **Power-User Efficiency** | 3 | The lowest score on this scorecard, and deliberately so: every keyboard interaction found is local/scoped to one component (folder rename, search box, slash-menu, Ask panel) — there is no note-level shortcut set at all, and critically, **a fully-built, proven, app-wide `Cmd/Ctrl+K` command palette already exists in this codebase and Notebook has zero participation in it.** This is the single cheapest, highest-leverage UX gap found in this entire audit: the infrastructure exists, the wiring doesn't. |

**UX/UI composite (14 scored dimensions, Accessibility excluded as unscored):
~4.5/10.** Same orientation-only caveat as the capability composite below — read
the table, not the average.

---

## Composite view

**Unweighted average across the 16 domains above: ~5.3 / 10** (was 4.9 pre-
Wave-C; Trust/Recovery and Export/Portability each +1 in Wave C, Knowledge
Linking +4 in Wave D (2026-09-06) — see their rows above).

This number is presented for orientation only — **do not average domains of
wildly different strategic weight into one score for decision-making.** The
Product Constitution (Phase One, revised) names trash+search+version-history as
non-negotiable trust bars and temporal correctness as the strategic moat; those
domains matter more than, say, Collaboration or Offline, which are both
correctly deprioritized. Read the table, not the average.

**What would move the composite most, per domain leverage (not per point):**
1. ~~Close the two new export findings~~ **DONE, Wave C (2026-09-06)** — single-note
   export + trade-link preservation, production-verified.
2. ~~Ship version history~~ **DONE, Wave C (2026-09-06)** — the Trust-parity bar the
   Product Constitution named as an open tension is now closed and production-verified.
3. ~~Ship internal links / backlinks / knowledge relationships~~ **DONE, Wave D
   (2026-09-06)** — native `[[` authoring + backlinks, production-verified
   (Knowledge Linking domain 3→7).
4. Ship the fact/snapshot ledger + analyst-estimates capture path — unlocks Thesis
   Intelligence, Ask Notebook, and completes Temporal Correctness's universality
   claim (currently the single most load-bearing prerequisite in the whole
   dependency graph). Next up per the current roadmap.
5. Confirm/fix the folder-sidebar correctness bug's current status — cheap,
   directly serves the Trust-parity bar.

**What will NOT move any score, no matter how much engineering goes into it:**
more Wave 4 design work, more competitive research, or any synthetic/sandbox
testing. Every domain here is capped at 6-7 until real Stage A member behavior
exists — that gate is the actual ceiling on this scorecard right now, not any
individual feature gap.

---

## Capability Readiness vs. Experience Readiness — the split that matters more than either average

Per the UX/UI Constitution: **the split matters more than the average.** Neither
the 4.9 capability composite nor the 4.5 UX composite was raised or lowered to
produce this section — both stand as independently scored above. Where the two
diverge meaningfully for the same underlying capability:

| Capability | Capability Score | Experience Score | Gap | Read |
|---|---|---|---|---|
| Capture (Save-to-Notebook) | 6 | 6 (Capture Experience) | None | Genuinely matched — the mechanism and its UX were built together and it shows. |
| Trading Journal Integration | **6 (was 3, was 7)** | *(no dedicated UX row — folds into Editor/Navigation)* | **Confirmed broken 2026-09-06, confirmed fixed same day** | A real-browser audit found the capability didn't work from 3 of 5 entry points — a confirmed functional regression, not an unmeasured gap. Fixed and live-re-verified the same day (Bucket A). The open measurement question this row originally flagged (does it *feel* natural through a *working* path) is now answerable — live-verified, it feels correct — but real-member validation evidence still doesn't exist. |
| Search / Retrieval | 5 | 6 (Search Experience) | +1, experience ahead | The engine has more open correctness/ranking work than its interaction quality does — the search BOX feels better than the search ENGINE is complete. |
| Editor | 6 | 6 (Editor Experience) | None | Matched, but for different reasons on each side — capability gaps are missing features (find-in-note, link authoring); experience gaps are missing power-user wiring (keyboard, command palette). Both real, both distinct. |
| AI on Notebook content | 4 | 5 (Interaction Quality, Ask-Current-Note-specific) | +1, experience ahead | The one AI capability that exists (Ask Current Note) is executed to a noticeably higher UX standard than the domain's overall capability score reflects — Ask Notebook's absence drags the capability score down without touching the interaction quality of what's actually shipped. |
| Trust / Recovery | 6 | 5 (Empty/Loading/Error States, partial proxy) | -1, experience behind | The backend trust mechanism (trash/restore/account-purge) is solid. The raw-error-leak and note-load-hang defects found this pass — which meant a member experiencing a genuine failure saw exactly the kind of unpolished, trust-eroding surface the capability layer was built to prevent — were fixed and live-re-verified the same day (Bucket A). The Experience score isn't raised back to 6 in this same pass: it still reflects the broader Empty/Loading/Error audit as a proxy, most of which wasn't re-scored here, and mobile/responsive states remain unverified. |
| Overall Power-User Efficiency | *(spans several domains)* | 3 | Experience clearly behind | The single sharpest capability-vs-experience gap found: a fully-built, proven, app-wide command palette exists and Notebook has zero participation in it. No capability-layer score captures this because it isn't a missing capability — the capability (keyboard-driven navigation) exists elsewhere in UCT; Notebook simply isn't wired into it. Cheapest, highest-leverage fix identified in this entire audit. |

**Read for prioritization:** the raw-error-leak pattern and the command-palette
non-participation are the two findings this split analysis surfaces as
higher-priority than their raw scores alone would suggest — both are cheap,
both are concrete, and both directly undermine a domain (Trust; Power-User
Efficiency) the product's own constitution already names as important.

---

## Update discipline

Re-score a domain only when:
- New production code ships and is verified (may raise a score to 6-7).
- Real member usage is observed for that domain specifically (may raise to 8+ —
  requires MULTIPLE members per the Stage A gate's own anti-gaming discipline,
  never one power user).
- A new gap is discovered (may lower a score — record the finding, don't silently
  adjust the number).

Do not re-score on a calendar schedule. Do not round up because "it's basically
done" — the whole point of this artifact is to resist that pressure.
