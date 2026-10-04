# Notebook wave 14: onboarding (plan only, no build)

**A member's first hour in the Notebook should show what it can do, hand-hold them through every
capability once, and never get in their way again.**

| | |
|---|---|
| Status | **PLAN ONLY.** This document is docs-only. No product code changes in this wave. Build gate: every other Notebook feature finished first (owner ruling, 2026-10-03, quoted in section 0). |
| Owner | Patrick (build approval, flag arming, deploy) |
| Written by | wave-14 planning lane, session 441b0c89; read-only on code |
| Base | `origin/master` at `8e86176633` |
| Extends | `docs/notebook/onboarding.md` (wave 8's tour and sample notebook), `docs/notebook/BETA-HANDOFF.md` section 1 (the flag roster and proposed arming order), `WAVE-13-PLAN.md` (program format) |
| Citations | Every `file:line` here was read at `8e86176633` (R-CITE). A line number is a dated claim; re-read it before acting. Competitor claims carry the URL actually fetched, or are marked "reported" (a review-site claim) or "not fetched". |

---

## 0. Why this document exists, and why it builds nothing

Owner's words, 2026-10-03: "enhance that welcome to the notebook and walkthrough ... make
walkthroughs very detailed for all features and capabilities so users are hand held at the
beginning through the onboarding essentially ... build that AFTER all the features of the entire
notebook are built and fully completed perfectly."

Two instructions, and this document follows both:

1. **Build after everything else is done.** Every wave-11 through wave-13 capability (plan grading,
   entry context, reviews, My Playbook, chart plans, the TA fingerprint, the visual playbook, the
   setups board, earnings prep, transcript capture, thesis chips, passed setups) ships behind its
   own dark flag today (section 3.5). This wave does not touch any of that code. It writes the
   plan so that the day the owner says "build it," there is no design pass left to do.
2. **The walkthroughs must be detailed, per feature.** Not one generic tour. A guided walk for
   every capability, each 3 to 6 steps, each starting where a member would naturally meet that
   capability, each resumable, each replayable forever from Help.

Everything below is either a measured fact about the repo as it stands today (cited), a measured
fact about how six other products onboard a new user (cited, or marked not fetched), or a proposal
for the owner to accept, change, or reject before this becomes a build plan (section 9).

---

## 1. Goals

| # | goal | measured by |
|---|---|---|
| G1 | A brand-new member's first-run screen shows what the Notebook can do, not five buttons | the redesigned `ResearchHome.jsx` first-run branch, section 4.1 |
| G2 | Every member-visible capability has a 3-6 step guided tour, written as data, not a hardcoded component | the tour registry, section 4.2 and 5.2 |
| G3 | A tour for a capability offers itself the first time a member can actually use that capability (tied to its own flag), exactly once, and never again uninvited | section 4.3 |
| G4 | Any tour can be replayed, any time, from Help | section 4.3, `Support.jsx` |
| G5 | A short "get started" checklist nudges a new member without blocking anything | section 4.4 |
| G6 | Sample data demonstrates every covered capability without ever touching a real note, trade, or broker record | section 4.5 |
| G7 | One tour engine. No tour can block a member, trap keyboard focus, or regrow the Notebook's first-open byte budget | section 5 |
| G8 | Every tour surface passes an axe a11y check and a real keyboard-only walk, at phone and desktop widths | section 6 |
| G9 | Every new interaction (launch a tour, step through it, dismiss it, replay it, check off a checklist item) has a measured click budget | section 6 |

---

## 2. Research: how six other products onboard a new user

Each row below is a claim actually fetched (URL given) or explicitly marked otherwise, following
this repo's own convention from `WAVE-13-PLAN.md` section 1.3 ("Reported" marks a review-site
claim nobody here independently verified; "not fetched" means a search was run and nothing usable
was found).

### Notion
- Onboarding is **learn-by-doing, not a forced tour**: a short, skippable Getting Started
  checklist with concrete actionable items (for example, type "/" for slash commands), plus
  high-contrast tooltips that appear on hover for contextual help, rather than a scripted
  walkthrough. Reported: https://goodux.appcues.com/blog/notions-lightweight-onboarding
- Template recommendations are **personalized** from a gallery of roughly 10,000 templates, based
  on what the member said at signup, rather than one fixed sample workspace. Reported, same
  source. The trading-journal template category itself is static, not interactive:
  https://www.notion.com/templates/category/trading-journal (already cited in `WAVE-13-PLAN.md`).
- Lesson for this wave: a checklist plus hover tips works for a mouse-and-keyboard desktop app.
  Hover-only has no equivalent on a touch screen, so this pattern cannot be copied as-is (see
  section 5.5).

### Obsidian
- First launch asks the member to create a new vault or open an existing folder. There is no
  guided tour. Official: https://obsidian.md/help/vault
- Obsidian ships a dedicated **Sandbox vault** for exploring the product "without affecting your
  existing data," opened from the Help icon or the command palette's "Open sandbox vault." Its
  contents reset from a snapshot every time it is opened, so nothing persists between sessions,
  and it is desktop-only. Official:
  https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Getting%20started/Sandbox%20vault.md,
  corroborated on the community forum: https://forum.obsidian.md/t/sandbox-vault-is-gone/56920
- No scripted feature-by-feature tour exists in the official docs; onboarding is vault creation
  plus an always-available, disposable practice space.
- Lesson: a sandbox that always resets is a stronger privacy guarantee than this wave needs (the
  Notebook's own sample notebook already keeps sample content out of real data, section 3), but
  the idea of "a space to poke at without consequence" is exactly what section 4.5 proposes.

### Evernote
- A short, **optional** interactive checklist. The very first step is the core action itself
  (write a note), "allowing users to familiarize themselves by experimenting with their writing
  interface" before anything else is asked of them. Later steps (for example, the web clipper) are
  explicitly skippable. Where a step cannot be made interactive, Evernote shows a modal tip window
  instead. Reported: https://goodux.appcues.com/blog/evernotes-onboarding-checklist
- Lesson: start with the action a member already came to do (write something), not with a tour of
  chrome. This is already how the Notebook's first-run screen is organized (Start a note is the
  first button, section 3.1), and this wave's redesign should keep that order.

### TradeZella
- The "Welcome to TradeZella" article leads with an onboarding **video**, then the first real step
  is importing trades (file upload, broker sync, or manual entry). Official:
  https://help.tradezella.com/en/articles/5801077-welcome-to-tradezella
- "Getting Started with TradeZella" is a narrative, day-in-the-life guide, not a checklist: start
  the day with "Start My Day," import or sync trades, tag and link strategies, end the day at the
  Progress Tracker checking off daily trading rules. Official:
  https://help.tradezella.com/en/articles/13863136-getting-started-with-tradezella
- No sandbox or sample data is mentioned on either page. A reported (not independently fetched)
  third-party walkthrough claims a trader-type picker (Newbie, Ninja, Monk) appears at first login;
  flagged here as reported only, not confirmed.
- Lesson: a trading journal's onboarding naturally narrates a trading day. The Notebook's own
  "get started" checklist (section 4.4) can borrow this shape (a first note, a first linked trade,
  a first review) without copying TradeZella's discipline-tracking "Progress Tracker" feature,
  which is a different product than an onboarding checklist and already has a closer UCT cousin in
  the Discipline Record (wave 13A).

### Edgewonk
- Onboarding is a short video plus static help docs: "we made a short video for you... We show you
  what to do when you log in to Edgewonk for the first time." Official:
  https://edgewonk.com/1-your-brand-new-journal/
- A search snippet (the Zendesk help category page itself returned HTTP 403 on fetch, so this half
  is reported, not independently fetched) describes a settings sequence before the first import:
  pick markets, set account currency, add personal setups.
- No checklist widget and no sample or demo data were found anywhere for Edgewonk.
- Lesson: a settings-first sequence matters when the product cannot do anything useful without
  account configuration first (sizing, risk percent). The Notebook template system already covers
  this for trade-plan templates (`notebookTemplates.js`); no new settings-first gate is proposed
  here.

### TradingView
- The official "Getting started with Supercharts" page is a static reference to the toolbar's four
  regions, not a scripted tour, tooltip sequence, or checklist. Official:
  https://www.tradingview.com/support/solutions/43000746464-getting-started-with-supercharts/
- The only "notes" capability on that page is chart annotation text, distinct from the per-symbol
  text notes already cited in `WAVE-13-PLAN.md`.
- **Bar Replay** (scrub to a historical point and step candles forward to practice reading a chart
  without risking money) is a genuine "practice without real exposure" pattern, though it is a
  trading-practice tool, not a first-run walkthrough. Official:
  https://www.tradingview.com/support/solutions/43000712747-bar-replay-how-and-why-to-test-a-strategy-in-the-past/
  and https://www.tradingview.com/support/solutions/43000474024-how-do-i-turn-bar-replay-on/
- **Not fetched / likely does not exist as a documented feature:** a scripted, interactive
  product-tour onboarding sequence for a new TradingView account. A direct search for one returned
  nothing official or reported.
- Lesson: the Notebook's own Bar Replay (wave 13H, `BarReplay.jsx`) already gives a "what happened
  next" practice view on a real or sample trade; this wave's chart-plan tour (section 4.2) should
  show that feature rather than invent a separate practice mode.

**Cross-product pattern, stated once:** none of the six forces a blocking, modal, click-through
tour on signup. The closest any of them comes is Evernote's optional checklist and TradeZella's
onboarding video. Every one of them puts the member into the product doing something real (or
something sample-safe) within the first screen. This is the single strongest argument for section
5.3's rule that no Notebook tour may block a member or trap focus.

---

## 3. Current state in this repo (what wave 14 inherits)

### 3.1 The first-run screen, today

`app/src/pages/journal-2-0/components/notebook/ResearchHome.jsx`, the `!hasAnyNotes` branch
(around line 310), renders "Welcome to your Notebook," one line of hint text, and a `data-tour`
anchored row of buttons: **Start a note**, **Create a thesis**, **Import notes**, **Today** (only
if a handler is passed), **Add a sample notebook** (only when the onboarding flag is on, the
member is paid, and no sample exists yet), and **Take the tour** (only when the onboarding flag is
on). The function returns at that point; nothing below it renders.

**What this hides.** The four Home boxes that exist for a member with notes (AI Actions, Reporting
soon / earnings prep, Passed setups, Reviews that write themselves) are only constructed in the
later branches of this same component, not in the first-run branch. A member with zero notes
cannot see any of them. The trade-plan canvas and chart-plan features live **inside the note
editor** (`NoteEditorPage.jsx`), so they are not independently suppressed by the first-run
branch; they are simply unreachable because there is no note open yet. These are two different
mechanisms producing the same member-visible result (nothing shows), and the redesign in section
4.1 should address both: it cannot "unhide" the Home boxes without a note existing, but it can
show what they will contain.

### 3.2 The tour that already exists

Wave 8 shipped a tour, flag `NOTEBOOK_ONBOARDING_ENABLED` (status `armed` on web, per
`docs/feature_flags.json`). **It is 8 steps, not 3** (`tourSteps.js`, `TOUR_STEPS`): `first-run`
(ResearchHome), `sidebar` and `search` (FolderSidebar), `new-note`, `view-switcher`, and `import`
(NotebookTab), `ask` and `export` (NoteEditorPage). Each step names a `[data-tour]` anchor and the
file that carries it; a step whose anchor is not currently on screen is skipped, never shown
pointing at nothing. `tourAnchors.test.js` reads each named file and fails by name if an anchor
disappears.

The tour component (`NotebookTour.jsx`) is lazy-loaded only through `NotebookTourGate.jsx`, and
only when a member is an actual tour target or has asked for it; this was itself a fixed defect
(wave 8's own ruling D-C7: an earlier version fetched the tour bundle for every visit). Progress
persists as a server preference, `notebook_tour = {v:1, state, step}`, so a half-finished tour
resumes where it left off. **A replay affordance already exists**: the "Take the tour" button on
the first-run screen opens it regardless of saved state, and a Support article can also open it
through `location.state.startTour`. There is no "Help > replay" menu entry outside those two
doors.

A cross-feature coordinator, `app/src/components/firstRun/firstRunStage.js`, already exists
because two first-run UIs once stacked and covered each other (a wave-10 bugfix). It has a slot
(one in-flow element `Layout` reserves at the top of the page, so a first-run card takes page
space instead of floating over controls) and a holder (`claimFirstRunStage()` /
`useFirstRunStageHeld()`), so the Notebook tour and the voice assistant's "Meet Compass" coach-mark
cannot both be open at once. **Any new per-capability tour this wave adds must go through this
same coordinator**, not around it (section 5.6, risk R2).

### 3.3 The sample notebook and Support

`docs/notebook/onboarding.md` (91 lines, read in full) documents the sample notebook: five seeded
notes inserted through the same import path real imports use (`notes.import_confirm`), their ids
tracked in a preference (`notebook_sample`) so they can be told apart from real content, with a
dismissible "you're looking at the sample" strip. Backend: `api/services/journal_two/sample_notebook.py`
plus routes under `/api/j2/onboarding` (`api/routers/notebook_onboarding.py`). Support
(`Support.jsx`) carries 14 Notebook help articles today (`topic: 'notebook'`); the same document
notes that none of them cover the personal API or email-in, because those two capabilities are
server-side gates with no dedicated in-app screen to point a tour or an article at.

### 3.4 Tooling this wave would reuse, not rebuild

- **Click budgets:** `tools/notebook_w13q_clicks.py` drives a real Playwright Chromium browser
  against a sandbox, measuring mouse clicks, keystrokes and Tab presses, and touch taps for a named
  list of flows, at 1200px and 390px. The flow list is a Python structure inside the file, not a
  CLI argument, so reuse means adding entries to this file (or a sibling file following the same
  pattern), not inventing a new instrument.
- **Real-browser walks:** one `tools/notebook_w13<lane>_walk.py` per wave-13 lane, plus
  `tools/notebook_wave8_walk.py` (wave 8's own walk, which already references
  `NOTEBOOK_ONBOARDING_ENABLED` directly), all built on the shared `tools/notebook_perf_harness.py`
  `Sandbox`. A wave-14 walk follows this naming convention.
- **a11y:** `app/src/pages/journal-2-0/a11y/notebookSurfaces.js` is a manifest mapping every
  Notebook component to an axe recipe id; a new surface is added by naming it there plus writing an
  `axeSurface(...)` call in an `*.a11y.test.jsx` file. `NotebookTour.a11y.test.jsx` is the existing
  precedent for a tour-specific a11y rail. `NotebookTour.renderLoop.test.jsx` is the existing
  precedent for mutation-proving a tour causes only a bounded number of renders while open (an
  H14-class rail: CLAUDE.md's navigation-freeze incident was exactly an unbounded re-render loop in
  a first-run-adjacent surface).
- **No generic tour engine exists anywhere else in the app.** A repo-wide search for Tour,
  Walkthrough, Stepper, Coachmark, and Spotlight as component names found only the Notebook tour
  family itself, the `firstRunStage.js` coordinator described above, and `FloatingOrb.jsx`'s
  single "Meet Compass" card (not a multi-step stepper). **The Notebook's own tour is sound and is
  the one to generalize**, not replace (section 5.1).

### 3.5 The flag roster, measured at `8e86176633`

`docs/feature_flags.json` carries **35 flags** matching `NOTEBOOK_*` or closely related
(`AWARENESS_NOTE_RESURFACE_ENABLED`, `J2_SHARE_LINKS_ENABLED`, `COMPASS_NOTES_TOOL_ENABLED`),
measured by reading the `flags` object directly rather than counting a grep. Fourteen are armed on
web today; the rest are dark, pending, or (`NOTEBOOK_ATTACHMENTS_ON`, `NOTEBOOK_CONFLICT_UX_ON`,
`NOTEBOOK_OFFLINE_READ_ON`) not yet built. `docs/notebook/BETA-HANDOFF.md` section 1 carries the
readable, one-line-per-flag roster and a 14-step proposed arming order for the wave-13 flags; that
order is explicitly **not yet an owner decision** (ruling P6). Section 4.2 below re-derives which
of these 35 flags have a member-visible surface worth a tour; some do not (a mode flag like
`NOTEBOOK_DOOR_GUARD`, or a provider-selection flag like `NOTEBOOK_SEMANTIC_PROVIDER`, has nothing
on screen to walk a member through).

**This roster will be stale by the time this wave is built, on purpose** (the owner's own
sequencing: build after everything else ships). Section 4.2's table is a starting point to
re-measure against the live roster at build time, not a frozen list.

### 3.6 Breakpoints and touch

`app/src/styles/breakpoints.js`: phone is `<= 640px`, tablet is `641 to 1024px`, desktop is
`>= 1025px`; the touch tier used throughout the app is `<= 1024px`, not `<= 640px` (CLAUDE.md
states this explicitly; a floor only at 640 leaves tablets broken). The touch tap-floor token is
`--tap-min`, enforced by `app/src/styles/tapFloor.test.js`.

---

## 4. Scope

### 4.1 A redesigned first-run welcome

Keep the order Evernote's research recommends: the first action offered is still writing something
real (Start a note, Create a thesis), because that is what a member came to do. Add, without
blocking that path:

- A short, plain-English preview of what the Notebook can do once there is something in it: one
  line each for plan grading, the chart plan, My Playbook, reviews, earnings prep, in whatever
  words are true on the day this is built (not a promise of features that might still be dark).
  This is text and, where cheap, a static screenshot or illustration, never a live render of a
  real member's data, and never a component that fires a real AI call before a member has written
  anything (risk R6).
- The existing "Add a sample notebook" button becomes the way to make that preview real: one click
  shows the same capabilities working against sample content (section 4.5), not just described in
  text.
- The "get started" checklist (section 4.4) mounts here too, visible on first run and from then on
  until the member dismisses it or finishes it.

Decision D1 (section 9) asks the owner to confirm this shape before it is built.

### 4.2 A guided walkthrough per capability

Every member-visible capability gets its own tour: 3 to 6 steps, written as data (section 5.2),
starting at the screen where a member would naturally first meet it, resuming from its last step
if interrupted, and replayable forever from Help (section 4.3). The table below is the proposed
roster, re-derived from the flag census in 3.5. Columns `resume` and `replay` are the same
mechanism for every row (one preference blob, one Help list), so they are stated once here rather
than repeated 20 times: **resume** means the tour remembers `{state, step}` per tour id and
continues from there the next time it is opened; **replay** means "Help > Walkthroughs" lists
every tour by name with a Replay button that reopens it from step one regardless of saved state.

| # | capability | flag(s) | status (3.5) | steps | starts at |
|---|---|---|---|---|---|
| 1 | Notebook basics (today's tour, unchanged) | `NOTEBOOK_ONBOARDING_ENABLED` | armed | 8 (kept as-is) | first-run screen |
| 2 | Writing help | `NOTEBOOK_WRITING_HELP_ENABLED` | armed | 4 | the editor, on a suggestion |
| 3 | Import an image or Word document | `NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED` | armed | 3 | the Import door |
| 4 | Publish and share a note | `NOTEBOOK_PUBLISH_ENABLED`, `J2_SHARE_LINKS_ENABLED` | armed | 4 | the Publish button on a note |
| 5 | Task reminders | `NOTEBOOK_TASK_REMINDERS_ENABLED` | armed (on by default) | 3 | a task property with a due date |
| 6 | Template gallery | `NOTEBOOK_TEMPLATE_GALLERY_ENABLED` | dark | 4 | New note, from a template |
| 7 | Meaning search | `NOTEBOOK_SEMANTIC_SEARCH_ENABLED` | dark | 3 | the search box |
| 8 | Formulas and rollups | `NOTEBOOK_FORMULAS_ENABLED` | dark | 5 | a database property |
| 9 | Plan versus execution grading | `NOTEBOOK_PLAN_GRADING_ENABLED` | dark | 5 | a closed, graded trade |
| 10 | Entry context card | `NOTEBOOK_ENTRY_CONTEXT_ENABLED` | dark | 4 | a position's detail page |
| 11 | Reviews that write themselves | `NOTEBOOK_REVIEW_DRAFTS_ENABLED` | dark | 4 | the EOD recap or Home |
| 12 | My Playbook | `NOTEBOOK_PLAYBOOK_ENABLED` | dark | 5 | the My Playbook tab |
| 13 | Chart plan: basics | `NOTEBOOK_CHART_PLAN_ENABLED` | dark | 5 | insert a chart in a note |
| 14 | Chart plan: replay and context | `NOTEBOOK_CHART_PLAN_ENABLED` (same flag, second tour) | dark | 4 | an inserted chart, the replay control |
| 15 | The technical fingerprint | `NOTEBOOK_TA_FINGERPRINT_ENABLED` | dark | 4 | a chart block's fingerprint panel |
| 16 | Visual playbook | `NOTEBOOK_VISUAL_PLAYBOOK_ENABLED` | dark | 5 | the visual playbook grid |
| 17 | Active setups board and find similar | `NOTEBOOK_SETUPS_BOARD_ENABLED`, `NOTEBOOK_FIND_SIMILAR_ENABLED` | dark | 5 | the setups board |
| 18 | Reporting soon / earnings prep | `NOTEBOOK_EARNINGS_PREP_ENABLED` | dark | 4 | the Reporting soon list on Home |
| 19 | Transcript capture and thesis chips | `NOTEBOOK_TRANSCRIPT_CAPTURE_ENABLED`, `NOTEBOOK_THESIS_CHIPS_ENABLED` | dark | 5 | a transcript panel passage |
| 20 | Passed setups | `NOTEBOOK_PASSED_SETUPS_ENABLED` | dark | 3 | the Passed setups box |
| 21 | A note resurfaces (passive, explainer only, not a stepper) | `AWARENESS_NOTE_RESURFACE_ENABLED` | dark | 1 to 2 | the first in-app resurfacing notice |

**Deliberately excluded from an in-app tour, owner to confirm (D2):**

- **Email to Notebook** (`NOTEBOOK_INBOUND_EMAIL_ENABLED`, armed) and **the personal API**
  (`NOTEBOOK_PERSONAL_API_ENABLED`, armed) happen outside the app entirely (an email client, iOS
  Shortcuts). `docs/notebook/onboarding.md` already notes neither has a Support article today for
  the same reason. A Support article, not an in-app tour, is the natural fit; a short Settings-page
  tour pointing at where the token or the forwarding address lives is a cheaper alternative if the
  owner wants one.
- **Compass notes tool** (`COMPASS_NOTES_TOOL_ENABLED`, armed) is a capability Compass uses when
  answering a member, not a Notebook screen a member opens. It is Compass's own onboarding to
  cover, not this wave's.
- **Voice notes** (`NOTEBOOK_VOICE_NOTES_ENABLED`) is on hold pending legal per
  `BETA-HANDOFF.md`; no tour until the hold lifts.
- **Attachments, conflict UX, offline read** (`NOTEBOOK_ATTACHMENTS_ON`, `NOTEBOOK_CONFLICT_UX_ON`,
  `NOTEBOOK_OFFLINE_READ_ON`) are not built. Nothing to tour.
- **Ask the Notebook** (`NOTEBOOK_ASK_INSERT_ON`, armed) already has a step inside tour 1 (the base
  8-step tour's `ask` step). Whether it also deserves its own deeper tour is folded into D2.

### 4.3 Tours tied to a newly switched-on flag

The first time a member's account can use a capability (the flag just armed, or the member just
became eligible), that capability's tour offers itself: a small, dismissible prompt, never a
blocking modal, shown once per member per tour. Mechanism (detailed in section 5):

- One preference blob extends today's single `notebook_tour` key into a per-tour record (seen,
  dismissed, or in-progress-at-step-N for each tour id), so a member's answer to "have you seen
  this" is never a second authority competing with the base tour's existing pattern.
- The prompt is offered through the same `firstRunStage.js` coordinator the base tour already
  uses, so it can never appear stacked on top of the base tour or the "Meet Compass" coach-mark.
- If several flags arm in the same week, prompts queue one at a time rather than piling up (the
  exact ordering and whether a prompt ever expires unseen is decision D3).
- A member can always say no. Dismissing never deletes the capability or hides it again from Help;
  it only stops the uninvited prompt.
- **Replay from Help, forever.** `Support.jsx` gains a "Walkthroughs" section listing every tour in
  the table above by name, each with a Replay button, independent of whether the member has seen
  it, dismissed it, or never been offered it.

### 4.4 A progress checklist

A short "get started" list, in the spirit of Evernote's and Notion's checklists but sized to this
product: write your first note, link a note to a trade, try Ask, insert a chart, open My Playbook.
Each item links straight to the thing it describes; checking one off is automatic (the member did
the thing) wherever that is cheap to detect, and manual otherwise. It never blocks any other
action, it is dismissible, and whether it should resurface when new capabilities arm later is
decision D4.

### 4.5 Sample data that demonstrates each feature

The existing sample notebook (`sample_notebook.py`, five seeded notes, tracked ids, a dismissible
strip) is the one mechanism to extend, not a new one to build. Each covered capability in section
4.2's table gets, where practical, one seeded example that already shows it working: a sample note
with a graded plan and a linked trade, a sample chart block with a drawn plan and an R:R readout, a
sample My Playbook entry, a sample passed setup. None of this ever touches a real note, a real
trade, or a real broker record; every seeded row is tracked the same way the five existing sample
notes are, so purge and the address-space census see it. An AI-feature preview (AI Actions,
earnings prep, writing help) over sample data must never fire a real paid model call silently;
either the sample content is fully static and pre-written, or any live call against it is
obviously labeled as a demo and separately cost-accounted (risk R6). Whether the owner wants one
growing sample notebook or separate opt-in sample packs per capability is decision D7.

---

## 5. Architecture

### 5.1 One tour engine, reusing what already works

`NotebookTour.jsx` and `NotebookTourGate.jsx` are sound and this wave reuses them rather than
building a second engine. The generalization is narrow: today the gate knows about exactly one
tour (the 8-step base tour, keyed implicitly); it becomes a gate that can open any tour by id,
looked up in a registry, with the existing lazy-load-only-when-wanted behavior (wave 8's own D-C7
fix) preserved for every tour, not just the first one. The base tour's behavior does not change;
it becomes entry 1 in the registry.

### 5.2 Tours as data, not components

`tourSteps.js` already treats a tour as an array of `{id, anchor, file}` records, with copy held
separately in `tourCopy.js`. This wave extends that into a registry keyed by tour id (one entry per
row in section 4.2's table), each value the same shape of step records. No tour is a bespoke React
component; every tour is a list of anchors the one engine walks. `tourAnchors.test.js`'s pattern
(read the named file, fail by name if the anchor is gone) extends to every tour in the registry,
not just the base one, so a tour cannot silently point at nothing.

### 5.3 No tour may block a member or trap focus

Every tour step is dismissible with a visible control and with Escape. No tour step traps Tab
focus inside itself; focus returns to where the member was when a tour closes (mirroring the
hub's existing `knobFocusReturn.test.jsx` pattern for a different feature, same rule). A tour that
cannot be dismissed, or that leaves a member unable to reach the rest of the page, is a shipped
defect regardless of how good its copy is, by the same reasoning CLAUDE.md records for the
joystick hub's "Hide" control: a control that can be opened and not escaped is a defect.

### 5.4 Accessibility and keyboard paths

Every tour gets its own entry in `a11y/notebookSurfaces.js` and its own `*.a11y.test.jsx`,
following `NotebookTour.a11y.test.jsx`'s existing precedent, not inherited coverage from the base
tour. Every tour is walked keyboard-only (Tab, Shift+Tab, Escape, Enter to activate "next") as
part of its real-browser walk (section 6.2), not just mouse-driven.

### 5.5 Phone-width layouts

Tours render correctly at phone (`<= 640px`) and tablet (`641 to 1024px`), both inside the touch
tier (`<= 1024px`). Notion's hover-revealed tooltips (section 2) are a desktop-only pattern and are
explicitly not copied; every tour control is tap-first, meeting the `--tap-min` tap floor. A tour
anchored to an element that only exists on desktop (or only on mobile) must say so in its registry
entry and skip cleanly on the other tier, using the same "anchor not on screen, skip the step"
rule the base tour already has.

### 5.6 The first-run stage coordinator owns every first-run surface

`firstRunStage.js`'s slot-and-holder pattern is the single authority for "which first-run thing is
showing right now." Every new per-capability prompt (section 4.3) claims the stage before showing
and releases it on close, exactly like the base tour and the "Meet Compass" coach-mark do today.
Nothing in this wave shows a first-run UI by any other path. This is not a style preference; it is
the direct fix for the exact stacking bug CLAUDE.md already records from wave 10, now at a larger
scale (potentially 20 tours instead of 1).

---

## 6. Quality plan

### 6.1 Click budgets

`tools/notebook_w13q_clicks.py` (or a sibling file following its exact pattern, named for this
wave) gets new flow entries for: opening a tour from the first-run screen, opening a tour from a
newly-armed-capability prompt, stepping forward and back through a tour, dismissing a tour,
reopening a tour from Help, and checking off a "get started" item. Each flow is measured the same
three ways the existing tool already measures every flow: mouse clicks at 1200px, keystrokes and
real Tab presses at both 1200px and 390px, and taps at 390px. A flow that depends on a dark flag is
armed only in the sandbox's own environment, never in product code, exactly as the existing tool
already does for wave-13 flows.

### 6.2 Real-browser walks, per tour

One walk script, `tools/notebook_w14_onboarding_walk.py` (or one script covering every tour in
registry order), built on the existing `notebook_perf_harness.Sandbox`, following the naming and
evidence convention of `tools/notebook_w13<lane>_walk.py` and `tools/notebook_wave8_walk.py`. Each
tour is walked at 390px and 1200px, keyboard included, with its flag off (confirms the capability
and its tour are both absent) and on (confirms the one-time prompt fires exactly once, dismiss
persists, and replay from Help works). Raw JSON is committed before any summary is written
(R-RAW), matching every other Notebook wave's evidence discipline.

### 6.3 Accessibility suites

Every tour's entry in `a11y/notebookSurfaces.js` plus its own `*.a11y.test.jsx` (section 5.4) runs
in CI as part of the existing axe promotion gate. Any test recipe that types into the editor during
a tour step calls `landPendingAutosave()` before the test ends, per the existing a11y fixture
gotcha (CLAUDE.md), so a flushed autosave cannot leak into the next test.

---

## 7. Lanes, file ownership, and order

This is a build sequence, not a build. It is written so the owner (or a controller, at build time)
can dispatch it directly once the gate in section 0 opens.

| lane | what it does | files | depends on |
|---|---|---|---|
| **W14-0** | Generalize the tour engine from one hardcoded 8-step tour into a registry of tours, with the base tour's behavior unchanged (regression-proved) | `onboarding/NotebookTour.jsx`, `onboarding/NotebookTourGate.jsx`, `onboarding/tourSteps.js`, `onboarding/tourCopy.js`, `onboarding/tourAnchors.test.js`, `lib/offline/notebookFlags.js`, `api/routers/notebook_onboarding.py` | nothing; first |
| **W14-A** | Redesigned first-run welcome: capability preview text, the sample-notebook promotion, the checklist mount point | `ResearchHome.jsx`, a new capability-preview component | W14-0 |
| **W14-B** | Author each capability's 3-6 step tour content, and add the one `[data-tour]` anchor line each capability's own file needs (one agreed line per file, the same mount-line pattern wave 13 used for partner files) | new tour data files under `onboarding/tours/`, one line each in each capability's own component, `a11y/notebookSurfaces.js` entries | W14-0; in practice, dispatched one capability (or track) at a time, only once that capability's own UI is finished, since by charter this whole wave waits for that anyway |
| **W14-C** | Wire the "newly switched on, offer once" trigger, the queue, and the Help replay list | `notebookFlags.js` (or a new `tourEligibility.js`), `NotebookTourGate.jsx` (eligibility logic), `firstRun/firstRunStage.js` (extend for N claimants if needed), `Support.jsx` (Walkthroughs section), `api/routers/notebook_onboarding.py` (per-tour seen state) | W14-0, and at least one tour from W14-B to test against; must land before any capability flag is armed in production |
| **W14-D** | The "get started" checklist | a new `GettingStartedChecklist.jsx`, mounted in `ResearchHome.jsx`, one preference key | W14-0; parallel with W14-A |
| **W14-E** | Extend the sample notebook with one example per covered capability | `api/services/journal_two/sample_notebook.py`, purge and address-space census entries for any new seeded rows | can start early, parallel with W14-A; in practice dispatched alongside W14-B, capability by capability |
| **W14-Q** | Click budgets, real-browser walks, a11y suites, for every tour this wave ships | `tools/notebook_w14q_clicks.py` (or extensions to the w13 file), `tools/notebook_w14_onboarding_walk.py`, `*.a11y.test.jsx` per tour | last; needs every tour from W14-B/C landed |

**Milestones:** M0 (W14-0 lands, base tour unregressed) then M1 (W14-A and W14-D, in parallel) then
M2 (W14-B and W14-E, dispatched in slices as each capability's own feature freezes, which may span
weeks since it is gated on the rest of the Notebook finishing) then M3 (W14-C, once at least a
handful of tours exist) then M4 (W14-Q) then M5 (owner arms the onboarding-specific flags, in
whatever order the owner chooses, independent of the capability flags' own arming order).

**Never touched by this wave's build:** any file that belongs to a capability's own feature logic
beyond the one agreed anchor line; `StockChart.jsx` internals; the broker, positions, or flow
files listed as off-limits in every other Notebook wave plan.

---

## 8. Risks

| # | risk | mitigation |
|---|---|---|
| R1 | ~20 tours is a lot of anchors; one renamed or removed anchor rots a tour silently | `tourAnchors.test.js`'s derive-and-fail-by-name pattern is extended to every tour in W14-0, before any tour content is authored |
| R2 | Multiple first-run surfaces stack (the exact wave-10 bug CLAUDE.md records, at a larger scale) | every new prompt goes through `firstRunStage.js`, never around it (section 5.6); W14-C is the only lane allowed to show an uninvited tour prompt |
| R3 | Tour data for 20+ capabilities regrows the Notebook's first-open byte budget | every tour stays lazy-loaded, fetched only when a member is an eligible target or asks for it, exactly as the base tour already does; `docs/notebook/perf-budgets.json` is not moved to fit a reading |
| R4 | A tour interrupts a member mid-task | no tour may auto-launch while a member is actively editing; the one-time prompt is a small dismissible affordance, never a modal that steals focus (section 5.3) |
| R5 | The flag roster measured in section 3.5 is stale by build time | section 4.2's table is re-measured against the live roster before any tour is authored, not built from this document's numbers blindly |
| R6 | A sample-data demo of an AI feature fires a real, uncounted paid model call | sample content is static and pre-written wherever practical; any live call against sample data is labeled as a demo and separately cost-accounted, per the standing "zero new model calls" and "never spend real AI budget silently" discipline |
| R7 | A tour copies a hover-only desktop pattern (Notion) onto a touch tier that has no hover | every tour control is tap-first and meets `--tap-min`; hover is never the only way to see a tour's content (section 5.5) |
| R8 | The per-tour preference blob is overwritten instead of merged, wiping other preferences | read-modify-write, never a blind `POST /api/auth/preferences`, per the same lesson the joystick hub's "Hide" defect already taught this repo |
| R9 | A new tour is assumed covered by the base tour's a11y rail and ships untested | every tour gets its own `*.a11y.test.jsx`, never inherited coverage (section 5.4) |

---

## 9. Decisions for the owner

| id | decision | why it matters |
|---|---|---|
| D1 | Does the redesigned first-run screen (4.1) show text or screenshot previews of capabilities that are still locked behind "no note exists yet," or does it keep today's five buttons and add only the checklist and the sample-notebook promotion? | changes how much new copy and design work W14-A actually is |
| D2 | Final list of which flags get a full in-app tour versus a Support article only (email-in, the personal API, Ask's possible second tour) | changes the size of section 4.2's roster |
| D3 | When several capability flags arm in the same week, do their one-time prompts queue one at a time, or does only the first one ever show and the rest wait for Help? Does an unseen prompt ever expire? | affects W14-C's design and how "hand-held" the experience feels versus how naggy it feels |
| D4 | Does the "get started" checklist (4.4) reappear when a new capability arms later, or stay dismissed forever once a member closes it once | affects W14-D |
| D5 | Build all ~20 tours in one slice, or roll them out capability by capability, each tour shipping the same day its capability's own flag arms (matching `BETA-HANDOFF.md`'s proposed, not-yet-decided, 14-step arming order)? | affects the real calendar length of M2 |
| D6 | The chart plan is split into two tours (basics, then replay and context) to respect the 3-6 step budget on a feature with ten sub-parts (section 4.2, rows 13 to 14). Confirm this split, or specify a different one | affects W14-B's authoring work for the flagship track |
| D7 | Sample data (4.5): one sample notebook that grows an example per capability, or separate opt-in sample packs a member can add individually | affects W14-E and the first-run screen's design |
| D8 | Do email-to-Notebook and the personal API get any in-app affordance at all (a short Settings-page tour pointing at where the address or token lives), or do they stay Support-article-only exactly as today | affects whether W14-B includes them |

---

## 10. Out of scope

- Any change to a capability's own feature logic. This wave only adds one anchor attribute per
  file and writes tour content; it does not touch plan grading, chart plans, My Playbook, or any
  other capability's behavior.
- Beta operations (testers, invites, cohorts, feedback programs) remain the owner's, on the side,
  per the standing wave-13 ruling O2.
- A generic, product-wide tour engine for surfaces outside the Notebook. Nothing found in this
  research suggests one is needed elsewhere today (section 3.4); if one is ever wanted, it should
  be lifted out of this wave's registry rather than designed twice.
- Deciding the actual arming order for the wave-11 through wave-13 capability flags. That is
  `BETA-HANDOFF.md` ruling P6, the owner's call, independent of this plan.
