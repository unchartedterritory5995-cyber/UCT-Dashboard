# Notebook: Journal Styles (presets, trader blocks, community library, page layouts)

**Date:** 2026-10-11 · **Status:** APPROVED by the owner 2026-10-11 ("approved if you think it is
perfect and thorough"), after a final review pass that added P1.7, the block integrity rule, async
price stamps, image sanitizing, P3.3b and the typing baseline. §7's six decisions are taken as the
recommended options. · **Author:** session 61625d99
**Base:** origin/master `f2b9ba895d` · **Inputs:** `docs/notebook/discoverability-audit-2026-10-11.md`
(branch `notebook-discover-1011`, `28eede4fbb`), `docs/notebook/rescore-2026-10-11.md` (branch
`notebook-rescore-1011`, `cd809b7889`)

A copy of this file lives outside the repo at `C:\Users\Patrick\uct-plans\` so a restart cannot lose it.

---

## 0. What the owner asked for, and what success looks like

**Said (owner, 2026-10-10/11, verbatim where quoted):**
- The checklist, rules and regime ideas, "customizable preset almost like features or widgets for
  users to decide to include in their journal on certain topics".
- "Broadly": per kind of note AND per journal page.
- "Community shareable presets and notes so people can share their presets and customize their
  presets and outlines and stuff and layouts for different kind of notes. Like if someone has a cool
  weekend prop style and another trader wants to adopt the layout."
- Templates AND presets ("both"): templates stay outlines; presets are full journal styles.
- Plus the micro-features and widgets from the idea list. "That takes us over the edge."
- "Is all of that we have built easy and accessible for the users to understand and access?"
- Make it "perfect and extremely valuable", thorough and comprehensive.

**Assumed (owner to correct):**
- The member-facing name is **"Journal styles"** (a preset) built from **"blocks"**, with
  **"outlines"** (today's templates) and **"page layouts"**. "Preset" stays an internal word.
- Every new surface requires a paid plan (standing ruling 2026-10-06: all new Notebook routes are paid).
- Adopting someone's style makes YOUR OWN COPY. It never changes when the author edits theirs, unless
  you choose "update from author".

**Success, measured:**
1. A trader who has never seen the feature picks a style and writes a note in it in **under 2 minutes**,
   unaided (folds into the user study's T-tasks; standard #16a).
2. Every block and every door passes the discoverability bar: **EASY or OK at 1280 and 390** in a
   re-run of the 2026-10-11 audit; **zero HIDDEN** features Notebook-wide.
3. Adopting a community style is **one click** from the library, and the adopted note renders with
   the ADOPTER's own data (never the author's).
4. The full c2 walk stays **0 FAIL**, extended with steps for every new surface.
5. After launch: share of new notes made from a style; styles adopted per week; organic members in
   the soak (floor 5) — this feature is also the reason for members to use the Notebook daily.

---

## 1. What already exists (build on it, never beside it)

| Need | Exists today | Where |
|---|---|---|
| Outlines | Member templates: title + body + property values; "Save as template" copies a note server-side | `j2_note_templates` (db.py:1884), `lib/memberTemplates.js`, `TemplatePicker.jsx` |
| Community library | Template gallery: publish, admin review queue, featured, firm "UCT picks", distinct-member uses, reports, hide, preview lines, body sanitizing | `template_gallery.py` (tables :123/:157/:174, `publish`, `use_template`, `report`, `admin_queue`), `TemplateGallery.jsx` |
| Gallery categories | `trade_plan, journal, research, review` — ONE FACT IN TWO FILES with the client's `GALLERY_CATEGORIES` | `template_gallery.py:68-71` |
| Rules | `j2_journal_rules` (label, evidence, source, status) — no history | db.py:369, `hooks/useJournalRules.js`, `MyRulesList.jsx`, `MakeRuleButton.jsx` |
| Checklists | Setup rules per setup (`settings.setupRules`) checked AFTER a trade on the Adherence card; daily rules checklist; fingerprint checklist in plan notes | `trade/AdherenceChecklist.jsx`, `calendar/DayRulesChecklist.jsx`, `lib/fingerprintChecklist.js` |
| Regime | `/api/j2/regime`, Insights Regime section; entry context captures the market at the fill (regime, exposure) | `hooks/useJ2CurrentRegime.js`, `insights/RegimeSection.jsx`, `entry_context.py` |
| Blocks in notes | `widgetEmbed` node (schema level 0) + registry; slash menu and WidgetPalette are two doors over one grammar | `lib/widgetEmbedCore`, `WidgetPalette.jsx`, `SlashMenu.jsx`, `app/src/widgets/registry.js` |
| Captured facts | `financialFact` inline node (level 0): a frozen, sourced value (from `/price`, `/consensus`) | `SlashMenu.jsx` factItems |
| Kind of note | Half there: built-in select `builtin:research_type` (Long thesis, Short thesis, Earnings play, Sector note, Watchlist note) | `note_properties.py:98` |
| Schema safety | Every node TYPE and non-optional ATTRIBUTE has a schema level; a new one is a one-way bump that is never reverted; current max level 4 | `lib/notebookSchema.js`, `notebook_schema.py` |
| Capability switches | Notebook flags ride the auth payload, latched per tab; kill switches default ON, gates default OFF | `lib/offline/notebookFlags.js` (`FLAG_FALLBACKS`, `notebookFlag`), `docs/feature_flags.json` |
| Journal pages | Today = fixed set of panels chosen by session phase (premarket/market/post-close lead, week strip, goal progress, quick actions, coach strip) | `surfaces/TodaySurface.jsx`, `surfaces/today/*` |
| Preferences | Per-member keys must be in the server allow-list or the write 400s | `api/routers/auth.py:2750 _PREFERENCE_KEYS` |
| Tours | Registry tours, Learn menu (derived from the registry), anchors by `data-tour`, drawer reveal for phone | `onboarding/tours/index.js`, `LearnMenu.jsx`, `tourAnchorVisibility.js` |
| OCR | Image text extraction (wave P) | `document_ocr.py` |

**Design rule that follows:** new blocks are new **widget kinds** inside `widgetEmbed`, and captured
values reuse **`financialFact`**. A new node type is allowed only where a block cannot be expressed
that way, and then it takes the next schema level under the never-revert rule.

---

## 2. Pieces and order

| Phase | Piece | Why this order |
|---|---|---|
| **P0** | Discoverability + integrity fixes (from the audit) | Everything new must arrive in a Notebook members can actually navigate; a possible fork bug outranks every feature |
| **P1** | Journal styles core (kinds of note, styles, outlines, defaults) | Every block is something you put INTO a style |
| **P2** | Trader blocks + micro-features (tiered) | The value inside a style |
| **P3** | Community library (styles, outlines, example notes, page layouts) | The "adopt someone's weekend prop style" moment |
| **P4** | Page layouts (Today, trade page) | Same idea for whole pages; shares P3's library |
| **P5** | Launch: onboarding packs, tours, announcement, measurement | Turns the build into daily use |

Each phase: its own plan, branch, gate, full c2 walk, deploy, smoke. Each ships **dark** behind its
own Notebook capability switch, then is armed one at a time.

---

## P0. Make what exists findable, and close the integrity question

From the 2026-10-11 audit (53 live features: 9 EASY, 27 OK, 9 HARD, 7 HIDDEN). Ranked by member impact.

**P0.0 Integrity first (investigate before anything else).** The audit saw a note fork into
"My trading rules (conflicted copy)" in a SINGLE tab when the script typed and navigated away ~1.5 s
later; the soak also holds one unattributed organic fork through the outbox door (2026-09-27). A
single-tab fork means the member's own save raced itself. Reproduce with the audit's note id and
script, trace the request/response pairs on the wire (never infer from the call site), fix at the
cause, rail it, and attribute the soak fork (one read-only production query, owner-approved).

**P0.1 "+ New note" on Research Home** for a member who has notes (today none): a split button —
Blank · From a style (P1) · From an outline · Voice note · Today's note. `ResearchHome.jsx`. S.

**P0.2 Chart toolbar.** 14 icon buttons; on a phone three rows over the chart, on desktop under the
sticky editor toolbar. Show **Plan** and **Replay** with words; fold the rest into "⋯".
`WidgetEmbedView.jsx`. M.

**P0.3 Dead-end tours.** Chart plan and visual playbook tours tell a member with notes to add the
sample "from the Notebook home ... then start it again from Help" — home no longer offers it and they
started from Learn. The card says "no note with a chart yet" and offers **Insert a chart** or **Add the
sample notebook**. `onboarding/tourStart.js`. S.

**P0.4 A place for notices on desktop.** Resurfaced notes, task reminders and fill alerts appear only
under Settings → Compass & Voice since the desktop bell left the NavBar (owner request). **Owner
ruling needed**: restore the bell, or a "Notices" box on Research Home (recommended: the box; it keeps
the NavBar as ruled). S.

**P0.5 Active setups gets a real door:** a box near the top of home with a count, and a back link on
the board. `ResearchHome.jsx`, `SetupsBoard.jsx`. S.

**P0.6 Phone editor toolbar:** after "Format", 2 of 15 controls are visible and the mic is clipped.
A bottom sheet for formatting plus an always-visible **"+"** (insert: image, attach, scan, chart, block).
`NoteEditorPage.jsx`. M.

**P0.7 One Ask on home** (seven Ask/AI doors today): merge "Ask Notebook to do something" and the
bottom Ask into one box. `ResearchHome.jsx`, `AiActionsPanel.jsx`. M.

**P0.8 Capture doors inside the Notebook:** Email to Notebook, the browser extension and the iPhone
Shortcut listed in Import and in "See what it can do"; a member-facing Shortcut how-to (today a repo
doc); rename "Personal API" to "Connect apps & shortcuts". M.

**P0.9 Due dates:** today only `@tomorrow ` with a trailing space works and `@` shows nothing. A
slash item, a date picker, and an `@` hint. `SlashMenu.jsx`, `dateMentionNode.js`. S-M.

**P0.10 Voice notes:** a door on home (P0.1) and a tour. S.
**P0.11 Label the view buttons** (seven icon-only; none labelled on a phone). S.
**P0.12 Learn menu:** group the 20 tours (Basics · Trading · Research · Capture) and open as a sheet on
phones (9 of 21 visible today). S.
**P0.13 Search in place:** the home box opens a second box in the sidebar; search once, in place. S-M.
**P0.14 "Add a formula"** at the top of the property menu. S.
**P0.15 Sample notebook reachable after the first note** (Learn menu). S.
**P0.16 Plan-grade card higher on the trade page**, or linked from the UNPLANNED chip (y 1176 desktop,
1501 phone today). S.
**P0.17 Phone Folders row** (held from 10/10): decide with P0.1/P0.13 so Folders stays findable.

**Exit bar:** re-run the audit script — zero HIDDEN, HARD only with a written reason; walk 0 FAIL.

---

## P1. Journal styles core

### P1.1 Concepts (member-facing words)
- **Kind of note** — what the note is for: Trade plan · Daily prep · Weekend prep · Earnings ·
  Post-trade review · Weekly review · Thesis · Watchlist note · plus the member's own kinds.
- **Outline** — today's template: headings, prompts, example text. Unchanged, renamed in the UI from
  "template" to "outline" (the word "template" stays as a synonym in search).
- **Journal style** — a full setup for a kind of note: an outline + the blocks switched on + their
  settings + the properties it fills. A member can have several styles per kind and mark one default.
- **Block** — a live piece of a note (checklist, rules, market context, sizing...). P2.

### P1.2 Data model
- `j2_note_kinds` (member's custom kinds; built-ins are code constants): `id, user_id, name, icon,
  sort_order, created_at`. Built-in kind ids are stable strings (`trade_plan`, `daily_prep`, ...).
- `j2_journal_styles`: `id, user_id, name, kind_id, outline_template_id NULL, outline_body_json NULL`
  (an inline outline when not linked to a saved one), `blocks_json` (ordered `[{block, enabled,
  settings}]`), `properties_json` (defaults), `is_default INTEGER`, `source_gallery_id NULL`,
  `source_version INTEGER NULL`, `version INTEGER`, `created_at, updated_at`.
  Unique partial index: one default per `(user_id, kind_id)`.
- Notes record what made them: `j2_notes.style_id NULL`, `j2_notes.style_version NULL`,
  `j2_notes.kind_id NULL` (additive columns; nothing reads them as required).
- `builtin:note_kind` joins `BUILTIN_PROPERTY_DEFS` as a select over the member's kinds, so views,
  filters and boards can group by kind (the existing property system does the rest).
- `builtin:research_type` stays; a one-shot mapping offers `earnings_play → Earnings` etc. as kinds.

### P1.3 Applying a style (one door)
Creating a note from a style goes through **`createNoteViaApi`** like every other create (never a
second way to make a note). The server composes: outline body → block nodes inserted where the
outline marks them (an outline may contain a `{{block:checklist}}` placeholder paragraph; blocks
with no placeholder append after the first heading) → property defaults → `style_id/version/kind_id`.
A style snapshot is applied: **editing a style never rewrites existing notes.** Each note offers
"This note uses Weekend prep v3 — update layout to v5?" as an explicit, previewed action that only
adds missing blocks and never removes or reorders the member's text.

### P1.4 Surfaces
- **New note** (P0.1 split button and the list's New note): pick a kind → its default style applies;
  "Choose another style" shows the others with a live preview.
- **Journal styles manager** (Notebook › "Styles"; also Settings › Notebook): list by kind; create,
  duplicate, rename, set default, delete (soft, with undo); editor with a block list (toggle, reorder
  by drag AND by up/down buttons, per-block settings), outline picker, and a **live preview rendered
  with the member's own data**.
- **"Save this note's setup as a style"** in the note's More menu (captures blocks + outline).
- The slash menu gains `/style` (switch or apply) and each block appears in the Trading group.

### P1.5 API
`GET/POST /api/j2/journal-styles`, `GET/PUT/DELETE /api/j2/journal-styles/{id}`,
`POST /api/j2/journal-styles/{id}/default`, `GET/POST/PUT/DELETE /api/j2/note-kinds`,
`POST /api/j2/notes {styleId}` (create via the existing route with a new optional field),
`POST /api/j2/notes/{id}/apply-style-update`. Contract fixtures under `__fixtures__/contract/`.

### P1.6 Rules
Paid-gated; dark behind `NOTEBOOK_JOURNAL_STYLES_ENABLED` (auth-payload flag, gate, default OFF).
Offline: styles are cached with the note list; applying offline uses the cache and queues through the
outbox like any create. Every new preference key is added to `_PREFERENCE_KEYS` in the same commit.

### P1.7 Verify before building (first task of the P1 plan)
- **Is the `widgetEmbed` kind open-ended?** Read both validators (`lib/notebookSchema.js`,
  `notebook_schema.py`) and the save path: if either holds an allow-list of widget kinds, a new kind
  is a schema decision (next level, never-revert) and the plan says so before any block is written.
- **What does an OLDER bundle do with an unknown kind?** A member with a stale tab must see a
  readable "This block needs a newer version — reload" card, never a crash or a dropped node that
  the next save deletes. If today's renderer drops it, that fix ships first, on its own, ahead of
  any new kind (a deleted node is data loss).
- **A switch gates CREATING blocks, never RENDERING them.** With `NOTEBOOK_JOURNAL_STYLES_ENABLED`
  off, a note that already holds blocks still renders them. Rollback must never blank a note.

---

## P2. Trader blocks and micro-features

Every block is a **widget kind** (`widgetEmbed`, level 0) with: a registry entry, a settings schema,
an empty state that says what to do, an error state that never blanks the note, a phone layout, a
keyboard path, accessible names, and a walk step. A block that needs a feature switch that is off
renders "This block needs X, which is not on for you" (never an empty box).

**Integrity rule for every block (the fork history makes this non-negotiable):** a block's member
state (a tick, a chosen setup, a sizing input) lives in the block's node attributes and changes
**only through an editor transaction**, so it rides the note's one existing save path (autosave →
outbox → compare-and-set). No block may own a second write door (its own PUT/PATCH to the note).
A block that needs server data READS it; it never writes the note on its own. The walk adds a step
that ticks a checklist item, navigates away within 1.5 s, and asserts no conflicted copy appears
(the P0.0 repro shape).

### Tier 1 (ships with P1)
1. **Pre-entry checklist.** Your setup's checklist (from `settings.setupRules`, plus any active rules
   marked "before entry") as tickable items in the note. Ticks persist per note. The same checklist
   appears in **Log Trade** before submit (opt-in per member); unticked items carry into the trade's
   adherence card and the review drafts. Settings: which setup (or "pick when I write"), include
   general rules, require all ticked before Log Trade (soft warning, never a block).
2. **My rules + rule versions.** Shows your active rules. New `j2_journal_rule_versions`
   (`rule_id, version, label, evidence, changed_at, change_note`) records every edit; rules gain
   "v3 · changed Oct 2". Insights gains **"Before / after this rule"**: win rate, average R and
   adherence for trades before vs after each version, with the sample sizes printed (never a
   percentage on fewer than 10 trades without saying so).
3. **Market context stamp.** On note creation, captures regime, UCT exposure score, SPY/QQQ price and
   % change, VIX, breadth score — frozen, sourced and dated like entry context (reuses its capture
   service). Settings: which fields. Enables "show notes written in RED/ORANGE regime" through a
   property (`builtin:regime_at_write`) and a saved view.
4. **Price-stamped lines.** A per-note toggle (and a style setting): pressing Enter after a line that
   names a ticker appends a `financialFact` stamp "NVDA 132.40 · 10:14 ET" (live price at that moment;
   frozen afterwards). Reuses the `/price` capture path; no new node type. The price fetch is
   **asynchronous and never blocks the keystroke**: Enter lands instantly, the stamp is inserted
   when the price arrives (as its own transaction, undoable on its own), and a failed or slow
   (>2 s) fetch inserts nothing. Off by default.
5. **Position sizing.** The house formula only — Account Risk % = Position Size % × Stop Distance % —
   with max 2% account risk, regime-adjusted ceilings (GREEN A+ 20-25%, YELLOW A+ 15%, ORANGE A+ 8%,
   B in ORANGE = skip). Inputs: entry, stop, account (from the member's account), grade. Output: size,
   shares, risk $. Never invents another formula.
6. **Daily prep pack:** Morning Wire headline + exposure, today's earnings for my names, my watchlist
   movers, key levels from my open plans. Each is a small block; the Daily prep style includes them.
7. **Post-trade review pack:** trade card (linked trade), plan-vs-execution grade (exists), mistakes
   and emotion tags (exist in the Journal), "what I'd do differently" prompt.

### Tier 2
8. **Alerts from plain English.** A line like "alert me if NVDA closes below 120" shows an inline
   suggestion chip "Set alert"; one tap opens the existing alert sheet pre-filled. Parsing is local
   and deterministic (ticker + comparator + price + close/intraday); never sets an alert silently.
9. **`/plan TICKER`.** Creates a Trade plan note in your default Trade plan style, pre-filled with
   price, key levels from the chart plan engine, the sizing block and the checklist.
10. **Screenshot smarts.** Pasting an image runs the existing OCR; if it finds a ticker (validated
    against the symbol universe, with the RS/EMA/MA/GAP/PEG false-ticker lesson applied) and a
    timeframe, it offers "Tag NVDA · Daily" (one tap; never automatic).
11. **Earnings follow-up.** The day after a holding or watched name reports, a notice offers a
    follow-up note: your prep note's expectation beside the actual numbers and the reaction.
12. **Due-date and reminder block** (pairs with P0.9).

### Tier 3
13. **Trading Year Wrapped** (December): best setups, lessons, most-written tickers, discipline trend.
14. **Mood / focus check-in** block feeding the Insights psychology views (exist).
15. **Checklist from my winners** (suggestion only): proposes checklist items from tags common to the
    member's best trades, with the trades listed as evidence; the member accepts each item.

---

## P3. Community library

Extends the template gallery; it does not replace it.

### P3.1 What can be shared
`j2_template_gallery.item_type`: `outline` (today's rows) · `style` · `example_note` · `page_layout`.
A style item stores the style definition (blocks + settings + outline), never data. An example note is
a published note (existing publish infrastructure) linked to a style, so browsers see it "in use".

### P3.2 Publishing
"Share to community" from a style, outline, note or page layout. **Sanitizing is mandatory and shown
before publish:** account sizes, P&L, broker names, linked trades, personal rule evidence and any
financial fact older than the snapshot are stripped or replaced with "your value here"; the author
sees exactly what will be public. **Images cannot be sanitized by text rules** (a screenshot can
show an account number, a balance or a broker's UI): every image in an example note is OFF by
default in the preview and must be switched on one by one by the author; OCR runs on each and
warns when it finds dollar amounts, long digit runs or a broker name. Category by trading style (Swing · Day · Prop · Options · Earnings ·
Long-term) + kind of note + free tags. Every item goes through the existing admin review queue before
it is listed.

### P3.3 Browsing and adopting
- Library tab inside Notebook (and a door from New note → "Browse community styles").
- Filters: style, kind, sort (Most adopted · Trending this week · Newest · UCT picks).
- Item page: preview **rendered with the viewer's own data**, the example note, author credit, adopted
  count (distinct members), last updated.
- **Adopt** = one click → your own copy (`source_gallery_id`, `source_version`), credited
  "Based on <author>'s Weekend Prep". Optional "Notify me when the author updates"; updating is always
  an explicit, previewed merge that never removes your edits.
- **Authors:** a profile listing their published items; follow an author to see new items in a feed.
- **Feedback:** "Helpful" count (one per member) and the existing report/hide flow.
- **Author withdraws an item:** it leaves the library; every adopted copy is the adopter's own and is
  untouched; "notify me of updates" stops with a one-line notice.

### P3.3b Data model additions
`j2_template_gallery.item_type TEXT NOT NULL DEFAULT 'outline'` (existing rows stay outlines) plus
`payload_json` for style/page-layout definitions and `version INTEGER`; `j2_gallery_helpful
(item_id, user_id, created_at, PK(item_id,user_id))`; `j2_gallery_follows (follower_id, author_id,
created_at, PK)`; adoption reuses the gallery's existing distinct-member use rows (with a timestamp,
which is what "Trending this week" counts). `item_type` values are ONE FACT IN TWO FILES with the
client's list and get the parse-the-other-file rail.

### P3.4 Rules
Paid-gated; public pages (if ever) follow the vendor rulings (FMP/Finnhub approved; Massive-sourced
chart images stay neutral; no market data numbers on public pages unless neutralized). Rate limits
reuse the gallery's hourly + durable daily caps. Dark behind `NOTEBOOK_STYLE_LIBRARY_ENABLED`.

---

## P4. Page layouts

- Today and the trade page become **registries of panels** (the existing panels, plus new ones:
  checklist for today, my rules, regime card, today's prep note, notices from P0.4).
- A member shows/hides and reorders panels (list with toggles and up/down, not a free grid; phone is
  one column), per session phase where it matters (premarket / market / after close).
- Saved as a **page layout**; shareable through P3 as `page_layout`.
- Stored as a preference key (added to `_PREFERENCE_KEYS`) with a read-fallback to today's layout.
- Dark behind `JOURNAL_PAGE_LAYOUTS_ENABLED`.

---

## P5. Launch

1. **Starter packs** — "How do you trade?" on first use of styles: Swing · Day · Prop · Options ·
   Earnings. Each pack installs 3-4 firm styles (UCT picks) the member can edit. Built by the team as
   firm gallery rows.
2. **Tours:** "Journal styles" and "Community library" tours in the Learn menu (grouped per P0.12),
   with phone anchors (drawer reveal applies).
3. **"See what it can do"** lists styles and the library.
4. **Announcement** to the group (owner posts; draft provided), a weekly "featured style" pick (owner's
   choice of channel; no automated test posts).
5. **Measurement:** telemetry events on the allowlist — `style_applied`, `style_created`,
   `style_adopted`, `block_used` (with a `kind` field drawn from the block registry, never free
   text), `library_viewed` — no note content, ever.

---

## 6. Cross-cutting requirements

- **Schema:** widget kinds and `financialFact` reuse; any unavoidable new node type or attribute takes
  the next level (5+) in BOTH schema files in a never-revert commit.
- **Performance:** every new surface is a lazy chunk; the Notebook first-open byte budget must not
  move; typing with blocks present shows **no regression against the 2026-10-10 busy-time baseline
  (p95 4.94 / 7.07 / 9.37 ms)**, re-measured with the same instrument at the same note sizes plus a
  note holding one of every block.
- **Accessibility:** 44 px targets on touch, accessible names, keyboard reorder (not drag-only),
  NVDA pass on the style editor and library.
- **Offline:** styles and kinds cached; creates queue through the outbox; library browsing needs a
  connection and says so.
- **Privacy:** publishing never includes data; adopted styles render the adopter's data; telemetry
  carries no content.
- **Rollback:** each phase revertible by its switch; schema rows never reverted; additive columns only.
- **Testing:** unit + contract fixtures per endpoint; rails for every ONE-FACT-IN-TWO-FILES pair
  (categories, item types, block registry); mutation-checked rails; new c2 walk steps for every surface
  and block at 1280/820/390; the discoverability audit re-run as P0's exit bar and before P5.

---

## 7. Decisions needed from the owner (each has a recommendation)

1. **Names:** "Journal styles" / "blocks" / "outlines" / "page layouts"? *(recommended)*
2. **Notices on desktop (P0.4):** a Notices box on Research Home *(recommended)* vs restoring the bell.
3. **Adopt semantics:** own copy + optional "notify me of updates" *(recommended)* vs live-following.
4. **Example notes:** allowed, with the sanitizer showing exactly what goes public *(recommended)*, or
   styles only.
5. **Pre-entry checklist in Log Trade:** soft warning only *(recommended)* vs a hard block.
6. **Moderation:** every community item reviewed before listing *(recommended, existing queue)* vs
   trusted authors auto-listed.

---

## 8. Delivery plan (sizes are agent-days, including gate + walk)

| Phase | Contents | Size |
|---|---|---|
| P0 | 0.0 integrity investigation; 0.1-0.17 fixes | 3-4 |
| P1 | kinds, styles, apply, manager, API, flags | 4-5 |
| P2 T1 | blocks 1-7, rule versions, before/after insight | 5-6 |
| P2 T2 | blocks 8-12 | 3-4 |
| P3 | library item types, sanitizer, adopt, authors, feed | 4-5 |
| P4 | page layout registry, Today + trade page | 2-3 |
| P5 | starter packs, tours, announcement, telemetry | 1-2 |
| P2 T3 | Wrapped, check-in, checklist from winners | 2-3 (later) |

Order: P0 → P1 + P2 T1 (one release) → P3 → P2 T2 → P4 → P5 → P2 T3. Each phase dark, gated, walked,
deployed, smoked, then armed by the owner's standing go.

## 9. Risks

- **Scope creep inside blocks** — each block has a fixed settings schema in the plan; anything else is
  a new row.
- **Two concepts confusing members** (outlines vs styles) — mitigated by one New-note door, the manager
  showing both, and the user study.
- **Community quality** — review queue, UCT picks, helpful counts.
- **Data leakage on publish** — mandatory sanitizer preview, server-side sanitizing (never trust the
  client), rails with fixtures that carry every sensitive field.
- **Schema** — avoided by widget kinds; any exception is a never-revert level bump.
- **Fork/integrity** — P0.0 runs first; the soak cannot pass with unexplained forks.
