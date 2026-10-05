# Notebook: beta handoff (2026-10-04)

This is everything the Notebook still needs that a build cannot do. It is meant as the input to
the owner's own beta-testing plan. Each row names what closes it and where the kit already is.

**Where the build stands:** waves 5-14 are built (wave 14, onboarding, is integrated on
`feat/notebook-w14-int` and still dark; see 1c). The parity scorecard reads 41 of 61 clauses
MET and 3 of 16 standards at bar (`docs/notebook/parity-scorecard.md`, re-scored by wave 13 lane
13SC). Wave 13 added no new clause or gap-ledger row: it targets a different competitive
bar (trading journals and charting platforms, not Notion, Evernote or Obsidian), which is tracked
separately in `docs/notebook/WAVE-13-PLAN.md` section 1.3, so the clause counts are unchanged.
Under rulings D18, D19 and D20, which stand (`WAVE-12-PLAN.md` §5), 13 of 16 is the ceiling.

## Lanes that landed since this file was last written

Six more lanes closed after this file's last edit. Each one line, with its evidence doc:

- **13Q-3** fixed three of 13Q-2's click-budget findings: skip links into the key Notebook
  regions, a "Today" action on Research Home, and the Insert-widget dialog's phone Tab cap.
  `docs/notebook/wave13-13q3.md`
- **13Q-4** gave the Journal's own top tab bar one Tab stop with arrow keys moving between
  tabs. The same change for the app-wide NavBar was built too, but it was held out of this
  landing as an owner decision (see the open item below and `docs/notebook/wave13-13q4.md`).
- **13Q-5** gave the new-note template picker real keyboard reach (type to search, then
  Arrow keys and Enter to pick a card) and added a documented Ctrl+Alt+B shortcut plus
  Shift+Arrow row selection to the bulk-action bar. `docs/notebook/wave13-13q5.md`
- **13X** walked the whole merged wave with all seventeen wave-13 flags on at once, one
  coherent seeded story, across six runs. It found and fixed two real defects (an
  under-sized chart control on the setups board, and a chart-plan panel that dropped
  role-bearing annotations), and the final run passed all 17 of 17 checks.
  `docs/notebook/wave13-13x.md`
- **The new-note cursor fix** re-checked an earlier claim that a brand-new note starts
  with the cursor in the note body. It did not: the click-budget instrument's own focus
  call had been doing the member's job. Two product fixes were tried and measured; the
  one that actually lands the cursor shipped. `docs/notebook/wave13-q1check.md`
- **13H-4** gave a note's chart embed the same phone drawing bar the main chart already
  had, replacing 13H-3's embed-growth workaround with the real fix.
  `docs/notebook/wave13-13h4.md`

## 1. Switches to turn on (Railway, web service, Variables, then Deploy)

All are read per request; unset means off. Turn on one change at a time, then check the site.

| switch | what members get | status |
|---|---|---|
| `NOTEBOOK_TRADE_CANVAS_ENABLED=1` | trade-plan canvas | ARMED on web, 2026-10-03 |
| `NOTEBOOK_AI_ACTIONS_ENABLED=1` | "Ask Notebook to do something" (plan, approve each change, undo) | ARMED on web, 2026-10-03 |
| `NOTEBOOK_FORMULAS_ENABLED=1` | formula and rollup properties, the position-tracker template's formulas | ready: the quiet 50k reading passed, every operation finishes well under the 100 ms budget (`docs/notebook/formulas-and-rollups.md`, Scale section, run 3) |
| `NOTEBOOK_TEMPLATE_GALLERY_ENABLED=1` | community template gallery (admin approves before listing) | after this wave's PR merges |
| `NOTEBOOK_VOICE_NOTES_ENABLED=1` | voice and meeting notes | HOLD: needs the OpenAI zero-retention letter (row 8a), and the upload-size gap fixed first (census row :254 in `security-review-notebook-routes.md`: an upload with no Content-Length is spooled before the 90 MiB cap) |

## 1b. Wave 13 switches (built, all still dark)

Wave 13 built fourteen new member-facing pieces, each behind its own switch, each off by default.
None of them are turned on yet. The table says what a member sees once a switch is flipped, and
what has to be true first. The proposed order to flip them in is in section 1d, and it is a
proposal, not a decision: ruling P6 says the order is the owner's call.

| switch | what members get | what has to be true first |
|---|---|---|
| `NOTEBOOK_TA_FINGERPRINT_ENABLED=1` | Nothing a member sees by itself. This is the one engine that reads a chart's technical shape (distance from its moving averages, how tight its base is, its RS rank, and more) for the three features below it. | None. It is the foundation the next three rows build on. |
| `NOTEBOOK_PLAN_GRADING_ENABLED=1` | Every closed trade is matched to the plan the member wrote before it and graded on four simple checks: did they get in close to plan, did they exit at or past their stop, was the size close to plan, and did the trade reach its target. A trade with no plan is labeled "Unplanned," never hidden. Insights gains a new Discipline tab over the last 20 and 60 trades. | None. Plain arithmetic, no AI. |
| `NOTEBOOK_ENTRY_CONTEXT_ENABLED=1` | The market is frozen at the moment a member enters a trade: the overall mood, how many stocks are healthy, how the stock stacks up against others, and how many days until it next reports earnings. A card on the trade shows this, with a box to write "why did you take it." | None. Needs one vendor read (the earnings date) and no AI. |
| `NOTEBOOK_CHART_PLAN_ENABLED=1` | A member can draw their plan right on a chart inside a note (entry, stop, target lines). The Notebook sizes the trade for them and lets them set a price alert with one click. Also adds a replay tool and side-by-side timeframe and before/after chart inserts. | Ready. Drawing on a phone-width chart was a rough edge; lane 13H-4 gave it the real fix (see Lanes that landed above). |
| `NOTEBOOK_VISUAL_PLAYBOOK_ENABLED=1` | A picture gallery of every chart a member has tagged with a setup: the saved chart image, its technical shape, and whether that trade won or lost, filterable by setup, outcome, timeframe and more. Also a before-and-after view of a trade's entry and exit charts. | Reads the technical fingerprint and plan grading, so turn those two on first. |
| `NOTEBOOK_PLAYBOOK_ENABLED=1` | My Playbook: one card per setup a member tags, with win rate, average R and expectancy, worded honestly by how many trades back it (a small number says "too few to judge" instead of a misleading number). Shows the notes linked to each setup and what the member wrote before their wins versus their losses. | None technical. |
| `NOTEBOOK_SETUPS_BOARD_ENABLED=1` | A morning board: every open plan a member has drawn on a chart becomes a small live chart, sorted by how close it is to triggering. | Reads the chart-drawn plan, so turn chart plan on first. No menu link to it yet; that is a small follow-up, not a defect. |
| `NOTEBOOK_FIND_SIMILAR_ENABLED=1` | From a tagged chart, a list of today's stocks that look the most like it technically. | Reads the technical fingerprint, so turn that on first. The list is built once a night, so there is nothing to show until the first overnight run after the switch is flipped. |
| `NOTEBOOK_EARNINGS_PREP_ENABLED=1` | Research Home shows which of the member's own stocks report earnings in the next week, and one click builds a prep note: the expected move, what analysts expect, the last four quarters' reactions, and the member's own notes and trades on that stock, each one showing where it came from. | None technical. |
| `NOTEBOOK_TRANSCRIPT_CAPTURE_ENABLED=1` | While reading an earnings call transcript UCT already holds, a member can select a passage and save it into a note as a proper quote (the quarter, the speaker, the exact words), so it can be used later as evidence. | None technical. |
| `NOTEBOOK_PASSED_SETUPS_ENABLED=1` | A list on Research Home of stocks a member saved but never traded, showing how the stock actually moved over the following days and weeks, so they can see what they missed or dodged. | None technical. |
| `AWARENESS_NOTE_RESURFACE_ENABLED=1` | If a stock a member wrote about touches a level they named, moves 8% or more in a day, or reaches a date they flagged (like an earnings date), the Notebook brings that old note back as an in-app notice, opened to the exact spot where they wrote the level. At most twice a day per member. | The two switches this rides on (the Awareness Engine and its automation schedule) are already on in production. |
| `NOTEBOOK_THESIS_CHIPS_ENABLED=1` | A small chip on a stock's row in Open Positions or Holdings when the member has written about it: whether their thesis is Watching, Active, Invalidated or Closed, and the levels from that note. Tap or hover to preview and jump in. | Reads the same level data the note-resurfacing switch above is built on; natural to turn on together or right after it. |
| `NOTEBOOK_REVIEW_DRAFTS_ENABLED=1` | One click builds a filled-in daily, weekly or monthly review note: trades and profit and loss, the discipline record from plan grading, how each setup did against the member's own past average, and an automatic "leak finder" that calls out costly habits (like sizing up right after a loss), each finding naming the exact trades behind it. | Reads plan grading and entry context, so turn those two on first. See the open item below about the Compass quote: that one part could not be checked in this environment and should be re-checked before fully trusting it. |

### Proposed arming order

Moved to section 1d, which merges these fourteen switches with the waves 11, 12 and 14
switches into one proposed order (they are steps 3 to 16 there, unchanged).

## 1c. Wave 14 switches (built, still dark)

Wave 14 is the Notebook's onboarding: a better first-run welcome, a "Get started" checklist, a
short tour for each feature, and one worked example per feature in the sample notebook. It adds
**one** new switch. Every feature tour has no switch of its own: it rides the switch of the
feature it explains, and shows only while that switch is on.

| switch | what members get | what has to be true first |
|---|---|---|
| `NOTEBOOK_GETTING_STARTED_ENABLED=1` | Three things, together. **(1) A preview** on the empty-Notebook welcome screen, "What your Notebook can do": one plain line for each feature that is switched on for this member, and nothing about a feature that is off. **(2) A sample promotion**, one sentence beside **Add a sample notebook**: it puts example notes in their own folder and removes them in one click. **(3) A "Get started" list** on Research Home: write your first note, start one from a template, open the sample notebook, and "Take the ... tour" for each tour whose feature is on. A step ticks itself when the member really does the thing (never by clicking the list) and stays ticked. The member can hide it; once hidden or finished it never comes back. `docs/notebook/wave14-w14-a.md`, `docs/notebook/wave14-w14-d.md` | `NOTEBOOK_ONBOARDING_ENABLED` must also be on (it is armed on web); nothing in this row shows unless both are. With this switch off, the welcome screen is byte-for-byte the wave-8 one (proven in `wave14-integration.md` section 2). |

### The feature tours (no switch of their own)

Twenty short tours (3 to 6 steps each) plus the wave-8 "Notebook basics" tour. A tour appears
only while its feature's switch is on: in Help (`/support`) under **Walkthroughs** with a
**Replay** button, and as a "Take the ... tour" step in an open Get started list. Arming a feature
therefore arms its tour in the same flip; there is nothing extra to do.

⚠️ **Four tours appear as soon as wave 14 is deployed**, with no switch flipped, because their
features are already on: Writing help, Add an image or Word document, Publish and share a note,
and Task reminders. That is intended (each explains a door members already have), but it is the
one member-visible change a wave-14 deploy makes on its own.

| tour | rides | that switch today (ledger) |
|---|---|---|
| Notebook basics (wave 8, unchanged) | `NOTEBOOK_ONBOARDING_ENABLED` | armed |
| Writing help | `NOTEBOOK_WRITING_HELP_ENABLED` | armed |
| Add an image or Word document | `NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED` | armed |
| Publish and share a note | `NOTEBOOK_PUBLISH_ENABLED` | armed |
| Task reminders | `NOTEBOOK_TASK_REMINDERS_ENABLED` | armed |
| Template gallery | `NOTEBOOK_TEMPLATE_GALLERY_ENABLED` | dark |
| Formulas and rollups | `NOTEBOOK_FORMULAS_ENABLED` | dark |
| Search by meaning | `NOTEBOOK_SEMANTIC_SEARCH_ENABLED` | dark (HOLD, vendor letter) |
| The technical fingerprint | `NOTEBOOK_TA_FINGERPRINT_ENABLED` | dark |
| Plan versus execution grading | `NOTEBOOK_PLAN_GRADING_ENABLED` | dark |
| Entry context card | `NOTEBOOK_ENTRY_CONTEXT_ENABLED` | dark |
| Chart plan basics; Chart plan replay and context | `NOTEBOOK_CHART_PLAN_ENABLED` | dark |
| Visual playbook | `NOTEBOOK_VISUAL_PLAYBOOK_ENABLED` | dark |
| Active setups and find more like this | `NOTEBOOK_SETUPS_BOARD_ENABLED` | dark |
| My Playbook | `NOTEBOOK_PLAYBOOK_ENABLED` | dark |
| Reporting soon and earnings prep | `NOTEBOOK_EARNINGS_PREP_ENABLED` | dark |
| Transcript passages and thesis chips | `NOTEBOOK_TRANSCRIPT_CAPTURE_ENABLED` | dark |
| Passed setups | `NOTEBOOK_PASSED_SETUPS_ENABLED` | dark |
| A note resurfaces (a two-step explainer over the "What you wrote then" sheet; no Replay) | `AWARENESS_NOTE_RESURFACE_ENABLED` | dark |
| Reviews that write themselves | `NOTEBOOK_REVIEW_DRAFTS_ENABLED` | dark |

"Ledger" is `docs/feature_flags.json`, which records intent and cannot see Railway. Check the
Railway Variables before relying on a row.

**Not merged here yet:** lane W14-C2 (branch `feat/notebook-w14-c2`) adds the "offer once" prompt
(when a feature is newly on, the Notebook offers its tour once, one offer per browser-tab
session, never while a note is open) and Help's **What's new** list (the tours a member has not
taken yet). The wave-14 plan says that work must land before any feature switch is armed in
production, because a member who hid their Get started list would otherwise only find a new tour
by browsing Help. See `docs/notebook/onboarding.md`.

**The sample notebook and dark features.** Adding the sample also writes one worked example per
feature (an untraded chart plan, an active setup, a thesis, a passed setup, an earnings-prep
draft, a quoted call passage). An example for a feature whose switch is off sits quietly in its
note and shows nowhere else; arming the feature is what makes it appear on that feature's screen.
No example is ever a trade, and none sends a notice: the resurfacing example is written inside
its thesis note only, never into the Compass inbox (`docs/notebook/wave14-docs.md`).

### Arming wave 14, one switch at a time

1. Make sure W14-C2 has merged (above).
2. Arm the features you want live first (section 1d). Each one's tour comes with it.
3. Then `NOTEBOOK_GETTING_STARTED_ENABLED=1`. Arming it last means a new member's preview and Get
   started list name every feature that is already on. A member who later hides or finishes the
   list never sees it again; a feature armed after that reaches them through the offer prompt and
   What's new instead.

**How to check after flipping `NOTEBOOK_GETTING_STARTED_ENABLED`** (a test account with no notes):

- Notebook, Research Home: under the usual welcome buttons, "What your Notebook can do" lists
  only features that are on; the sample sentence sits under **Add a sample notebook**; the **Get
  started** card reads "0 of N done".
- Write a note and come back: "Write your first note" is ticked and stays ticked after a reload.
- Press **Hide**: the card is gone, and stays gone after a reload.
- If anything is wrong, unset the switch: the welcome screen returns to exactly what it was.

**How to check after flipping any feature switch** (the tour half): open Help (`/support`). Its
tour is listed under Walkthroughs; **Replay** opens it at step one on the screen it explains. A
tour for a feature that is still off is never listed.

## 1d. Proposed overall arming order (every dark Notebook switch from waves 11-14)

This is a suggestion, not a decision: ruling P6 leaves the order, and the timing, to the owner.
It replaces the wave-13-only 14-step list that used to sit under 1b; those fourteen steps are
steps 3 to 16 below, unchanged in order and reasoning. Flip one switch at a time, in the owner's
own time, with a check of the site after each one, the same way section 1 is run. The reasoning
is the same throughout: build the plumbing before the rooms that use it, anything that composes
several other features goes later, and the onboarding switch goes last so it can name everything
already on. Each feature's tour (1c) arms with it.

**Waves 11 and 12 (self-contained, ready)**

1. **Formulas and rollups** (`NOTEBOOK_FORMULAS_ENABLED`, wave 11). Ready: the scale reading
   passed (section 1). Stands on its own.
2. **Community template gallery** (`NOTEBOOK_TEMPLATE_GALLERY_ENABLED`, wave 12). Stands on its
   own; nothing is listed until an admin approves it.

**Wave 13 (the trading and research features, 1b)**

3. **Technical fingerprint.** Nothing changes for members yet, but three later rows read it.
4. **Plan grading.** A self-contained feature, and the review drafts switch (step 16) needs it.
5. **Entry context.** A self-contained feature, and review drafts needs it too.
6. **Chart plan in notes.** The flagship: the chart becomes the plan. Stands on its own.
7. **Visual playbook.** Needs the fingerprint (step 3) and plan grading (step 4) already on.
8. **Active setups board.** Needs the chart-drawn plan (step 6) already on.
9. **Find more like this.** Needs the fingerprint (step 3). Flip it, then wait for one overnight
   run before expecting results.
10. **My Playbook.** Stands on its own; grouped here with the other edge and stats features.
11. **Earnings prep.** Stands on its own; starts the research track.
12. **Save a call-transcript passage.** Stands on its own.
13. **Passed setups.** Stands on its own.
14. **Your notes come back when it matters** (`AWARENESS_NOTE_RESURFACE_ENABLED`). Stands on its
    own, but thesis chips (step 15) read the same level data, so put this one first.
15. **Thesis status chip on rows.** Reads the level data step 14 builds.
16. **Reviews that write themselves.** Last of the features on purpose: it reads plan grading
    (step 4), entry context (step 5), and the resurfaced-notes list (step 14), so everything it
    draws from should already be live.

**Wave 14 (onboarding, 1c)**

17. **Getting started** (`NOTEBOOK_GETTING_STARTED_ENABLED`). Only after W14-C2 has merged (1c).
    Last, so a new member's preview and Get started list name every feature that is already on.
    If the owner wants it sooner, it is safe at any point: it only ever names what is on.

**Held, not in the order**

- `NOTEBOOK_VOICE_NOTES_ENABLED` (wave 11): HOLD for the OpenAI zero-retention letter and the
  upload-size fix (section 1).
- `NOTEBOOK_SEMANTIC_SEARCH_ENABLED` (wave 7, listed because its tour arrived in wave 14): HOLD
  for the same vendor letter (section 2, row 8a).
- `NOTEBOOK_ATTACHMENTS_ON`, `NOTEBOOK_CONFLICT_UX_ON`, `NOTEBOOK_OFFLINE_READ_ON` (wave K): never
  arm; the features behind them are not built.

## 2. What only real people, devices or vendors can close

| clause | what closes it | kit |
|---|---|---|
| 1c, 5a, 5b, 5c, 16a | a task-based study with 5-8 traders (core tasks unaided, SUS >= 80, first useful note < 2 min) | `docs/notebook/user-study-kit.md` |
| 3a | 30 days with real members and zero data loss | `docs/notebook/soak-30day.md` |
| 8a, 12c, 12d, 13a | zero-retention terms in writing from Anthropic and OpenAI; then arm meaning search | the vendor letters |
| 1a, 1b | the above letter, plus the browser-extension store submission (G-043) | Chrome Web Store |
| 9c | a screen-reader pass by a person, VoiceOver and NVDA | `docs/notebook/a11y-second-review-brief.md` |
| 10a | run the iOS Shortcut on an iPhone (G-044) | the Shortcut docs |
| 10c | a real-device pass per release | BrowserStack Live (Automate is not on the account) |
| 4d | typing under 16 ms: one more quiet-box reading to settle two disagreeing quiet readings | `docs/notebook/perf-runs/ty8/README.md` |
| 7a | the scheduled restore drill, Sunday 2026-10-04 09:00 local (keep the PC on) | `soak-drills/` |

## 3. Rows a beta tester exercises directly (not walked by automation)

The automated production walk was blocked by the agent permission system, so these rows stay
NOT-VERIFIED until a person uses them on the live site:

- G-050 Ask the current note
- G-051 Ask the whole Notebook
- G-165 writing help: summarize, rewrite, continue, translate, property autofill
- G-166 Ask over an attached Word file or image
- G-162 dictation
- G-153 a task reminder at 07:00 or 09:00 ET

## 4. Owner decisions recorded with defaults (change any by saying so)

- Gallery: any admin approves; publishing needs a paid plan; images are dropped; edits go back to
  review; no auto-hide on reports (full list: `docs/notebook/wave12-12a.md`).
- Position tracker: formula fields are set up only from the Notebook's own picker, not from the
  joystick hub's Templates action (owner: fine as is, 2026-10-02).
- Voice notes stay dark until the vendor letter (above).
- The switch-arming order for waves 11-14 (1d above) is a proposal, not a decision: ruling P6
  leaves the order, and the timing, to the owner.

## 5. What the wave 13 lanes left open

Three items, each named by the lane that found it, so nobody re-discovers them from scratch:

- **The Compass quote in a review draft could not be checked here.** Lane 13F's real-browser
  walk passed 7 of its 8 checks; the 8th, the line that shows a quoted sentence from an existing
  Compass review, needs a real Anthropic key to run, and this environment did not have one
  (`docs/notebook/evidence/wave13-13f/walk-6c95593ca8de6597acf3b2066015854d1076ff6a/`). The rest
  of the feature does not depend on this; it just means that one line is unproven until someone
  re-runs the walk where a real key is reachable, or until `NOTEBOOK_REVIEW_DRAFTS_ENABLED` is
  armed and a real admin confirms it on production.
- **The NavBar's own roving tabindex is built but held out of this landing, by owner
  decision.** Lane 13Q-4 built the same one-Tab-stop, arrow-key mechanics for the app-wide
  NavBar (the left sidebar, about 19 links) that it built for the Journal's own tab bar. NavBar
  is shared, app-wide chrome with no composite ARIA role, so arrow keys moving focus there is a
  product-wide behavior change the owner needs to approve first. It sits ready on
  `feat/notebook-w13q4` (commit `75c4ef0e64`), not merged into this tree.
  `docs/notebook/wave13-13q4.md`
- **The Screener's "Save these results to a note" button stays a proposal, not a fix.** Lane 13Q's
  click count confirmed the member has to press Tab about 339 times, or click through roughly 34
  times, to reach that button today (ruling P5), far over the 10-click budget. Nobody built a fix
  this wave; the recommended one, moving the button earlier in the page or adding a skip link, is
  recorded as a proposal (Q7, `docs/notebook/WAVE-13-PLAN.md` section 6) for whoever owns the
  Screener page next.
