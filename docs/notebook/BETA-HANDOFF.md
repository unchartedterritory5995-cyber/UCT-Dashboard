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
| `NOTEBOOK_FORMULAS_ENABLED=1` | formula and rollup properties, the position-tracker template's formulas | ARMED on web, 2026-10-07 22:31 CT (the quiet 50k reading had passed: `docs/notebook/formulas-and-rollups.md`, Scale section, run 3) |
| `NOTEBOOK_TEMPLATE_GALLERY_ENABLED=1` | community template gallery (admin approves before listing) | ARMED on web, 2026-10-08 00:30 CT |
| `NOTEBOOK_VOICE_NOTES_ENABLED=1` | voice and meeting notes | ARMED on web, 2026-10-09 14:36 CT, by owner ruling (published vendor terms are enough; no zero-retention letter). The upload-size gap is closed (wave 14: the body is capped while it is read; `docs/notebook/wave14-upload-cap.md`) |

## 1b. Wave 13 switches (ARMED on web 2026-10-08, in the section 1d order)

Wave 13 built fourteen new member-facing pieces, each behind its own switch, each off by default.
**All fourteen were turned on in production on 2026-10-08** (owner standing go of 2026-10-03), in
the section 1d order and in dependency groups, each group followed by an in-process read of the
switch through the smoke account's sign-in payload and a passing app-wide click-through: the
fingerprint, plan grading, entry context and chart plan at 00:30 CT; the visual playbook, setups
board, find similar, My Playbook, earnings prep, transcript passages and passed setups at 00:42;
note resurfacing and thesis chips at 00:50. **Review drafts** was set to 1 at 17:12 CT and back to 0 at
17:30 CT the same evening, when production stopped answering (rule H15: roll back first). The same
stall had happened twice earlier that day with the switch unset, so it is a precaution, not a
finding; the ledger entry carries the detail. **Re-armed 2026-10-09 08:07 CT** on the owner's go, after
the stalls were traced to the web process's scheduled jobs and the breadth boot build: the new pod read
the switch True in-process and the app-wide click-through passed. All fourteen are on. The table below
says what a member sees and what each switch depends on.

| switch | what members get | what has to be true first |
|---|---|---|
| `NOTEBOOK_TA_FINGERPRINT_ENABLED=1` | A panel under every chart inside a note. It describes the chart's technical shape (distance from its moving averages, how tight its base is, its RS rank, and more) and lets the member tag the setup; the tag is saved in the note. It is also the one engine the three features below read. ⚰️ Until 2026-10-07 this cell said "Nothing a member sees by itself". The code says otherwise: `WidgetEmbedView.jsx`:805 renders `FingerprintPanel` for a chart block whenever `notebook_ta_fingerprint_enabled` is true and for no other condition, and `FingerprintPanel.jsx`:225 returns nothing only when that same flag is off. | None. It is the foundation the next three rows build on. ⚠️ It is also the first switch that can write plan data into a note (`widgetEmbed.ta`), so the rollback for this release must be rehearsed before it goes on (`landing-12-15-rollback.md`). |
| `NOTEBOOK_PLAN_GRADING_ENABLED=1` | Every closed trade is matched to the plan the member wrote before it and graded on four simple checks: did they get in close to plan, did they exit at or past their stop, was the size close to plan, and did the trade reach its target. A trade with no plan is labeled "Unplanned," never hidden. Insights gains a new Discipline tab over the last 20 and 60 trades. | None. Plain arithmetic, no AI. |
| `NOTEBOOK_ENTRY_CONTEXT_ENABLED=1` | The market is frozen at the moment a member enters a trade: the overall mood, how many stocks are healthy, how the stock stacks up against others, and how many days until it next reports earnings. A card on the trade shows this, with a box to write "why did you take it." | None. Needs one vendor read (the earnings date) and no AI. |
| `NOTEBOOK_CHART_PLAN_ENABLED=1` | A member can draw their plan right on a chart inside a note (entry, stop, target lines). The Notebook sizes the trade for them and lets them set a price alert with one click. Also adds a replay tool and side-by-side timeframe and before/after chart inserts. | Ready. Drawing on a phone-width chart was a rough edge; lane 13H-4 gave it the real fix (see Lanes that landed above). |
| `NOTEBOOK_VISUAL_PLAYBOOK_ENABLED=1` | A picture gallery of every chart a member has tagged with a setup: the saved chart image, its technical shape, and whether that trade won or lost, filterable by setup, outcome, timeframe and more. Also a before-and-after view of a trade's entry and exit charts. | Reads the technical fingerprint and plan grading, so turn those two on first. |
| `NOTEBOOK_PLAYBOOK_ENABLED=1` | My Playbook: one card per setup a member tags, with win rate, average R and expectancy, worded honestly by how many trades back it (a small number says "too few to judge" instead of a misleading number). Shows the notes linked to each setup and what the member wrote before their wins versus their losses. | None technical. |
| `NOTEBOOK_SETUPS_BOARD_ENABLED=1` | A morning board: every open plan a member has drawn on a chart becomes a small live chart, sorted by how close it is to triggering. | Reads the chart-drawn plan, so turn chart plan on first. Reached from one link on the Notebook's home screen, "Active setups", which shows only while this switch is on (`docs/notebook/fin-nav.md`). |
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

## 1c. Wave 14 switches (ARMED on web 2026-10-08 06:42 CT)

Wave 14 is the Notebook's onboarding: a better first-run welcome, a "Get started" checklist, a
short tour for each feature, and one worked example per feature in the sample notebook. It adds
**one** new switch, `NOTEBOOK_GETTING_STARTED_ENABLED`, and it is the wave-14 switch: with it off,
nothing wave 14 adds reaches a member (controller ruling, 2026-10-05; proven by a flags-off render
parity, `docs/notebook/wave14-w14-c1.md` section 7). The feature tours have no switch of their
own: each needs this switch (and `NOTEBOOK_ONBOARDING_ENABLED`) AND the switch of the feature it
explains.

| switch | what members get | what has to be true first |
|---|---|---|
| `NOTEBOOK_GETTING_STARTED_ENABLED=1` | Three things, together. **(1) A preview** on the empty-Notebook welcome screen, "What your Notebook can do": one plain line for each feature that is switched on for this member, and nothing about a feature that is off. **(2) A sample promotion**, one sentence beside **Add a sample notebook**: it puts example notes in their own folder and removes them in one click. **(3) A "Get started" list** on Research Home: write your first note, start one from a template, open the sample notebook, and "Take the ... tour" for each tour whose feature is on. A step ticks itself when the member really does the thing (never by clicking the list) and stays ticked. The member can hide it; once hidden or finished it never comes back. `docs/notebook/wave14-w14-a.md`, `docs/notebook/wave14-w14-d.md` | `NOTEBOOK_ONBOARDING_ENABLED` must also be on (it is armed on web); nothing in this row shows unless both are. With this switch off, the welcome screen is byte-for-byte the wave-8 one (proven in `wave14-integration.md` section 2). |

### The feature tours (no switch of their own)

Twenty short tours (3 to 6 steps each) plus the wave-8 "Notebook basics" tour. A tour appears
only while `NOTEBOOK_GETTING_STARTED_ENABLED` (with `NOTEBOOK_ONBOARDING_ENABLED`) AND its
feature's switch are on: in Help (`/support`) under **Walkthroughs** with a **Replay** button,
under **What's new** until the member takes it, as a one-time offer in the Notebook, and as a
"Take the ... tour" step in an open Get started list. The wave-8 "Notebook basics" tour is
unchanged and rides `NOTEBOOK_ONBOARDING_ENABLED` alone, as before.

The tours for features that are already on (Writing help, Add an image or Word document, Publish
and share a note, Task reminders) appear only once `NOTEBOOK_GETTING_STARTED_ENABLED` is on. A
wave-14 deploy with that switch off changes nothing members see. (An earlier version of this
section said those four would appear as soon as wave 14 deployed; that was true before the
2026-10-05 ruling and is no longer.)

| tour | rides | that switch today (ledger) |
|---|---|---|
| Notebook basics (wave 8, unchanged) | `NOTEBOOK_ONBOARDING_ENABLED` | armed |
| Writing help | `NOTEBOOK_WRITING_HELP_ENABLED` | armed |
| Add an image or Word document | `NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED` | armed |
| Publish and share a note | `NOTEBOOK_PUBLISH_ENABLED` | armed |
| Task reminders | `NOTEBOOK_TASK_REMINDERS_ENABLED` | armed |
| Template gallery | `NOTEBOOK_TEMPLATE_GALLERY_ENABLED` | armed (2026-10-08) |
| Formulas and rollups | `NOTEBOOK_FORMULAS_ENABLED` | armed (2026-10-07) |
| Search by meaning | `NOTEBOOK_SEMANTIC_SEARCH_ENABLED` | ARMED on web, 2026-10-09 14:36 CT (owner ruling: published vendor terms) |
| The technical fingerprint | `NOTEBOOK_TA_FINGERPRINT_ENABLED` | armed (2026-10-08) |
| Plan versus execution grading | `NOTEBOOK_PLAN_GRADING_ENABLED` | armed (2026-10-08) |
| Entry context card | `NOTEBOOK_ENTRY_CONTEXT_ENABLED` | armed (2026-10-08) |
| Chart plan basics; Chart plan replay and context | `NOTEBOOK_CHART_PLAN_ENABLED` | armed (2026-10-08) |
| Visual playbook (also needs `NOTEBOOK_TA_FINGERPRINT_ENABLED`: it opens from the fingerprint panel) | `NOTEBOOK_VISUAL_PLAYBOOK_ENABLED` | armed (2026-10-08) |
| Active setups and find more like this | `NOTEBOOK_SETUPS_BOARD_ENABLED` | armed (2026-10-08) |
| My Playbook | `NOTEBOOK_PLAYBOOK_ENABLED` | armed (2026-10-08) |
| Reporting soon and earnings prep | `NOTEBOOK_EARNINGS_PREP_ENABLED` | armed (2026-10-08) |
| Transcript passages | `NOTEBOOK_TRANSCRIPT_CAPTURE_ENABLED` | armed (2026-10-08) |
| Passed setups | `NOTEBOOK_PASSED_SETUPS_ENABLED` | armed (2026-10-08) |
| A note resurfaces (a two-step explainer over the "What you wrote then" sheet; no Replay) | `AWARENESS_NOTE_RESURFACE_ENABLED` | armed (2026-10-08) |
| Reviews that write themselves | `NOTEBOOK_REVIEW_DRAFTS_ENABLED` | armed (2026-10-09 08:07 CT; see 1b) |

"Ledger" is `docs/feature_flags.json`, which records intent and cannot see Railway. Check the
Railway Variables before relying on a row.

**Merged on the integration branch:** lane W14-C2 adds the "offer once" prompt (when a feature
is on and its tour has never been taken, the Notebook offers it once, one offer per browser-tab
session, never while a note is open; an accepted offer that cannot open is not spent) and Help's
**What's new** list (the tours a member has not taken yet). Both obey the wave-14 switch above.
See `docs/notebook/onboarding.md` and `docs/notebook/wave14-w14-c2.md`.

**The sample notebook and dark features.** With `NOTEBOOK_GETTING_STARTED_ENABLED` off, adding the
sample notebook writes exactly the wave-8 five notes, as before wave 14. With it on, adding the
sample also writes one worked example per feature (an untraded chart plan, an active setup, a thesis, a passed setup, an earnings-prep
draft, a quoted call passage). An example for a feature whose switch is off sits quietly in its
note and shows nowhere else; arming the feature is what makes it appear on that feature's screen.
No example is ever a trade, and none sends a notice: the resurfacing example is written inside
its thesis note only, never into the Compass inbox (`docs/notebook/wave14-docs.md`).

### Arming wave 14, one switch at a time

1. W14-C2 is merged (above).
2. Arm the features you want live first (section 1d). Their tours wait for step 3.
3. Then `NOTEBOOK_GETTING_STARTED_ENABLED=1`: the preview, the Get started list, the sample
   examples and every armed feature's tour arrive together. Arming it last means a new member's
   preview and Get started list name every feature that is already on. A member who later hides or finishes the
   list never sees it again; a feature armed after that reaches them through the offer prompt and
   What's new instead.

**How to check after flipping `NOTEBOOK_GETTING_STARTED_ENABLED`** (a test account with no notes):

- Notebook, Research Home: under the usual welcome buttons, "What your Notebook can do" lists
  only features that are on; the sample sentence sits under **Add a sample notebook**; the **Get
  started** card reads "0 of N done".
- Write a note and come back: "Write your first note" is ticked and stays ticked after a reload.
- Press **Hide**: the card is gone, and stays gone after a reload.
- If anything is wrong, unset the switch: the welcome screen returns to exactly what it was.

**How to check after flipping any feature switch** (the tour half, once
`NOTEBOOK_GETTING_STARTED_ENABLED` is on): open Help (`/support`). Its tour is listed under
Walkthroughs; **Replay** opens it at step one on the screen it explains. A
tour for a feature that is still off is never listed.

## 1d. Proposed overall arming order (every dark Notebook switch from waves 11-14)

**Done, 2026-10-07 to 2026-10-08: all seventeen steps below were armed on web in this order**
(the owner's standing go of 2026-10-03), one group at a time, each group verified in-process and
by the app-wide click-through. The two firm rules on steps 15 and 16 were both satisfied: the
thesis-chips and review-drafts fixes named there are in the release (#281, squashed on master as
`2265f4ac3b`), and plan grading and note resurfacing were on before either dependent switch. The
list is kept as the record of the order and its reasoning. Held switches are unchanged below.

This is a suggestion, not a decision: ruling P6 leaves the order, and the timing, to the owner.
It replaces the wave-13-only 14-step list that used to sit under 1b; those fourteen steps are
steps 3 to 16 below, unchanged in order and reasoning. Flip one switch at a time, in the owner's
own time, with a check of the site after each one, the same way section 1 is run. The reasoning
is the same throughout: build the plumbing before the rooms that use it, anything that composes
several other features goes later, and the onboarding switch goes last so it can name everything
already on. Each feature's tour (1c) arms with it once step 17 is on.

**Waves 11 and 12 (self-contained, ready)**

1. **Formulas and rollups** (`NOTEBOOK_FORMULAS_ENABLED`, wave 11). Ready: the scale reading
   passed (section 1). Stands on its own.
2. **Community template gallery** (`NOTEBOOK_TEMPLATE_GALLERY_ENABLED`, wave 12). Stands on its
   own; nothing is listed until an admin approves it.

**Wave 13 (the trading and research features, 1b)**

3. **Technical fingerprint.** Members get a panel under each chart in a note, with a place to
   tag the setup; three later rows read it. (⚰️ "Nothing changes for members yet" until 2026-10-07;
   see the corrected row in 1b.)
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
    ⛔ **FIRM RULE, not a preference (added 2026-10-07): turn this on only after step 14's FIRST scan
    has completed.** On the code as it stands on this branch, `thesis_chips.py` reads the table
    `j2_note_levels` and never creates it; only the resurfacing scan does. With the chip on
    first, every chips request is a server error ("no such table") that the page hides, about
    once a minute per open Positions, Holdings or Watchlists page.
    *Status of the rule:* a fix exists and is not yet on this branch. Commit `ce23ddf5f1`
    ("thesis chips answer on a database with no level index yet", on
    `origin/feat/notebook-fin-sec`) makes the missing table a quiet empty answer. Once that
    commit is in the release, the rule is **no longer required, fixed in `ce23ddf5f1`**, and what
    is left is only the ordinary fact that there are no chips to show before the first scan.
    Until then, keep the rule.
16. **Reviews that write themselves.**
    ⛔ **FIRM RULE, not a preference (added 2026-10-07): never before plan grading (step 4).** On the
    code as it stands on this branch, drafting a review runs plan grading itself
    (`review_drafts.py` calls `grade_payload`, which freezes each trade's link to a plan) with
    no check of the plan-grading switch. Drafted first, a review would quietly lock every trade
    in the period to a plan while the control that changes that link is still hidden.
    *Status of the rule:* a fix exists and is not yet on this branch. Commit `71f24aafd7`
    ("review drafts write no plan-grading state while plan grading is off", on
    `origin/feat/notebook-fin-data`). Once that commit is in the release, the rule is **no
    longer required, fixed in `71f24aafd7`**; the order below is then only the sensible one.
    Until then, keep the rule.
    Last of the features on purpose: it reads plan grading
    (step 4), entry context (step 5), and the resurfaced-notes list (step 14), so everything it
    draws from should already be live.

**Wave 14 (onboarding, 1c)**

17. **Getting started** (`NOTEBOOK_GETTING_STARTED_ENABLED`), the wave-14 switch: the preview,
    the Get started list, the sample examples and every feature tour. W14-C2 is merged (1c).
    Last, so a new member's preview and Get started list name every feature that is already on.
    If the owner wants it sooner, it is safe at any point: it only ever names what is on.

**Held, not in the order**

- ~~`NOTEBOOK_VOICE_NOTES_ENABLED` and `NOTEBOOK_SEMANTIC_SEARCH_ENABLED`: HOLD for the vendor
  zero-retention letters.~~ **Released by owner ruling 2026-10-09: the published vendor terms
  are enough** (`VENDOR-TERMS-2026-09-23.md` §2). Both arm after the Privacy page that names
  them is live; the ledger records the flip time. **ARMED on web 2026-10-09 19:36Z**, both in
  one set, after the Privacy page (#307) was confirmed live.
- `NOTEBOOK_ATTACHMENTS_ON`, `NOTEBOOK_CONFLICT_UX_ON`, `NOTEBOOK_OFFLINE_READ_ON` (wave K): never
  arm; the features behind them are not built.

## 2. What only real people, devices or vendors can close

| clause | what closes it | kit |
|---|---|---|
| 1c, 5a, 5b, 5c, 16a | a task-based study with 5-8 traders (core tasks unaided, SUS >= 80, first useful note < 2 min) | `docs/notebook/user-study-kit.md` |
| 3a | 30 days with real members and zero data loss | `docs/notebook/soak-30day.md` |
| 8a, 12c, 12d, 13a | ~~zero-retention terms in writing from Anthropic and OpenAI; then arm meaning search~~ **Decided 2026-10-09: the owner accepted the published vendor terms instead of written zero retention; meaning search is armed.** The scorecard's "in writing" wording stays unmet by that choice | owner ruling, `VENDOR-TERMS-2026-09-23.md` §2 |
| 1a, 1b | the above letter, plus the browser-extension store submission (G-043): **verified 2026-10-09 -- Published, unlisted, since 2026-09-26** (item `kpogeikeoejgkefdcjdpeoonmbiflnlk`, v0.1.0). The Settings card now links to it (#304) and the handshake is pinned to that id. At launch: Distribution, Unlisted to Public, in the developer dashboard | Chrome Web Store |
| 9c | a screen-reader pass by a person, VoiceOver and NVDA | `docs/notebook/a11y-second-review-brief.md` |
| 10a | run the iOS Shortcut on an iPhone (G-044) | the Shortcut docs |
| 10c | a real-device pass per release | BrowserStack Live (Automate is not on the account) |
| 4d | typing under 16 ms: one more quiet-box reading to settle two disagreeing quiet readings | `docs/notebook/perf-runs/ty8/README.md` |
| 7a | the scheduled restore drill, Sunday **2026-10-11** 09:00 local (keep the PC on and logged in). ⚰️ This said 2026-10-04 until 2026-10-07: that run did not start (the task ran from the wrong folder and exited 2 before the drill began; a run by hand the same morning passed, which does not count). The hardened wrapper was deployed 2026-10-06 (`wave14-ops.md`, 5B) | `soak-drills/` |

## 3. Rows a beta tester exercises directly (not walked by automation)

The automated production walk was blocked by the agent permission system, so these rows stay
NOT-VERIFIED until a person uses them on the live site:

- G-050 Ask the current note
  ✅ **Walked on the LIVE site 2026-10-08 22:43 CT by `tools/notebook_prod_ask_check.py`** as the
  smoke account, on a note the run created and removed: "What is my stop for ZZZT?" answered with
  the stop from the note. Evidence `docs/notebook/evidence/prod-ask/2026-10-08-2243/` (the time is
  the result file's write time; an earlier attempt at 22:42 CT was INCONCLUSIVE, the home skeleton
  stayed up 45 s on a slow pod, and the retry passed). A person's own run is still welcome; it is
  no longer the only evidence.
- G-051 Ask the whole Notebook
  ✅ Same run: the whole-Notebook question answered with both numbers from the note, one citation,
  and the citation opened the note (`answer.png`, `cited-note.png`).
- G-165 writing help: summarize, rewrite, continue, translate, property autofill
  ✅ 22:43 CT run, **Summarize**: a 185-character draft in 1.6 s, Discard left the note byte-identical
  on the server (`writing-help.png`). ✅ **23:14 CT run, the rest**
  (`docs/notebook/evidence/prod-ask/2026-10-08-2314-full/`): Summarize 190 chars, Rewrite shorter 114,
  Continue writing 464, Translate (Spanish) 215, each discarded and the note byte-identical after each;
  Suggest values answered "Compass found nothing in this note to fill in" and Close applied nothing.
  Only the "found nothing" branch of autofill is walked; a note with fillable properties is not.
- G-166 Ask over an attached Word file or image
  ✅ **Word file walked on the LIVE site 2026-10-08 23:14 CT** (same evidence folder, `docx-answer.png`): a
  964-byte .docx uploaded through the note's attachments door reached `status=ready` in 2.4 s, and
  "What is the budget code?" inside the note answered `QX-7731` with the document cited as source 2
  (page 1). An image is not walked on the live site (the OCR engine is in the web image and
  `J2_OCR_ENABLED=1`; see `RESUME-2026-10-08.md` section 5).
- G-162 dictation
- G-153 a task reminder at 07:00 or 09:00 ET
  ⚰️ Corrected 2026-10-06: this row WAS walked by automation, on a sandbox, in wave 15.
  `docs/notebook/gate-runs/wave15/walk-uct-674012eb1.json` (base `http://127.0.0.1:8700`) reads
  `G153_reminder_delivered_server` PASS and `G153_reminder_bell_mobile_390` PASS. It stays in
  this list only because that walk was not on the live site.

## 4. Owner decisions recorded with defaults (change any by saying so)

- Gallery: any admin approves; publishing needs a paid plan; images are dropped; edits go back to
  review; no auto-hide on reports (full list: `docs/notebook/wave12-12a.md`).
- Position tracker: formula fields are set up only from the Notebook's own picker, not from the
  joystick hub's Templates action (owner: fine as is, 2026-10-02).
- ~~Voice notes stay dark until the vendor letter (above).~~ Armed 2026-10-09 on the published
  vendor terms (owner ruling).
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
