# Notebook discoverability audit (2026-10-11)

**The question (owner):** "Is all of that we have built easy and accessible for the users to
understand and access?"

**Short answer: no, not yet.** The basics are easy for a new member. A returning member's home
screen has no "New note" button at all. Several flagship trading features need about four steps,
and they sit below the fold or inside a dense chart toolbar. Seven live features have no visible
door inside the Notebook. Of 53 live member-facing features: **9 EASY, 27 OK, 9 HARD, 7 HIDDEN,
1 not measured.**

## Counts by verdict

| verdict | count | meaning used here |
|---|---|---|
| EASY | 9 | visible where the task happens (Notebook home or the open note), 2 clicks or fewer, plain label, same on a phone |
| OK | 27 | 3 clicks or one menu deep, label understandable, or one real phone problem |
| HARD | 9 | 4+ steps, below the fold *and* jargon or icon-only, a phone control off screen, or its tour dead-ends |
| HIDDEN | 7 | no visible door inside the Notebook: typed syntax only, a Settings card nothing points to, or no instructions anywhere in the app |
| not measured | 1 | needs an overnight scan this sandbox did not run |

**The grading rule:** each row gets the WORSE of desktop and phone, for the member the feature is
meant for. A feature that is easy on a laptop but takes a hidden swipe on a phone is HARD.

## How this was measured

- **Build:** tip `ad7e8878a9` (origin/master, 2026-10-11), `npm run build` in a fresh worktree.
- **Sandbox:** `tools/notebook_fin_walk.py --config c2 --serve-only`, port 8134, its own empty data
  dir outside the repo (never `C:\data`). c2 turns on every Notebook switch the walk knows about.
  `/api/auth/me` for a member read every `notebook_*` flag the ledger records as armed as `true`.
  **One exception:** `NOTEBOOK_PERSONAL_API_ENABLED` is not in c2. `/api/j2/personal/tokens`
  answered 404, so the Personal API card was not rendered here (row 35 relies on the code).
- **Members:** 8 fresh members from `tools/notebook_swarm.provision`, signed in by `uct_session`
  cookie in Playwright Chromium:
  - members 0 and 1: brand new, no notes;
  - members 2 to 5: four notes each, made through the notes API;
  - members 6 and 7: brand new, then the sample notebook added through the UI;
  - members 2, 3, 6 and 7 also got a watchlist, two open positions and one closed trade, all
    through the member API.
- **Viewports:** 1280x900 desktop; 390x844 with `is_mobile` + `has_touch` for the phone.
  This is emulated Chromium, not a real device.
- **What "clicks" means:** counted from landing on Research Home (`/journal/notebook`, the Notebook
  tab) to the feature's own control. "+ scroll" means the control exists but starts below the fold.
  - "Above the fold" is the control's measured top `y` against the viewport height (900 / 844),
    from a DOM inventory taken on each screen.
- **Evidence:**
  - curated screenshots in `docs/notebook/evidence/discoverability-2026-10-11/`;
  - about 100 screenshots and JSON inventories stayed in the session scratch dir.
- **Not measurable here:**
  - no model or embedding keys, so meaning search, Ask answers and writing-help output were not
    exercised (their doors were);
  - thesis chips need the note-level scan;
  - find-similar needs the overnight run.

## The table

d = desktop 1280, p = phone 390. "Fold" = is the entry control visible without scrolling.

| # | feature | entry point (measured) | clicks d / p | above fold? d / p | plain label? | taught by | verdict |
|---|---|---|---|---|---|---|---|
| 1 | Start a note (new member) | Welcome card "Start a note" | 1 / 1 | yes / yes | yes | welcome, Get started list, basics tour | **EASY** |
| 2 | Start a note (member with notes) | **Not on Research Home.** "All notes" then "+ New note"; or Ctrl+K, type "new note" | 2 / 2 | n/a (no button) | yes | nothing | **OK** (it is the most common action, and it is missing from home) |
| 3 | Start from a template | All notes, then Templates. A new member's Get started link "Start a note from a template" also works | 2 / 2 | yes / yes (the checklist link is at y 850 on a phone: below) | yes | Get started list | **OK** |
| 4 | Community template gallery | All notes, Templates, "Browse the community gallery" | 3 / 3 | yes / yes | yes | Template gallery tour | **OK** |
| 5 | Sample notebook | Welcome "Add a sample notebook" (1 click) | 1 / 1 | yes / yes | yes | "See what it can do", Get started | **EASY** for a new member. Once the member has a note, home no longer offers it (the checklist drops it) |
| 6 | Get started list | home card | 0 | yes / heading at y 764, items below | yes | n/a | **EASY** |
| 7 | Learn menu (walkthroughs) | "Learn" button beside the home title | 1 / 1 | yes / yes | "Learn" yes; 20 tours in one flat list, registry order | Help, Walkthroughs | **OK**: on a phone the menu shows 9 of 21 items (scrollHeight 980 vs 418 visible) |
| 8 | Keyword search | home "Search your notes" | 1 / 1 | yes / yes | yes | basics tour | **EASY** (but see fix 13: it opens a SECOND box in the sidebar, so two search boxes show at once) |
| 9 | Search by meaning | automatic: "Related by meaning" rows join the keyword results (`FolderSidebar.jsx`); no control | 0 | n/a | yes | Search by meaning tour | **OK** (results not measured: no embedding key in the sandbox) |
| 10 | Folders and tags | desktop: sidebar is open; phone: "Folders" drawer; tags inside Details | 1 / 2 | yes / yes | yes | basics tour | **OK** |
| 11 | Views: table, board, calendar, graph, timeline, tasks | All notes, then a row of 7 view buttons | 2 / 2 | yes / yes | **icon only**: tooltip on desktop, no text at all on a phone | nothing | **HARD** |
| 12 | Saved views / thesis starter views | sidebar "Add thesis starter views"; "Save this view" in list | 1 / 2 | yes / in drawer | partly ("thesis starter views") | nothing | **OK** |
| 13 | Today's daily note | new member: "open today's note" link (above fold). With notes: "Today" link at the very bottom of home, or the sun icon in the list toolbar. Ctrl+Alt+D | 1 / 1, or 1 + scroll | new yes; with notes no | yes (phone icon only) | nothing | **OK** |
| 14 | Properties | open note, "Details" (folded), "Add property" | 3 / 3 | yes / yes | yes | nothing | **OK** |
| 15 | Formulas and rollups | open note, Details, Add property, "+ New property…", type = Formula | 5 / 5 | each step yes, but 5 deep | "Formula" yes, "rollup" no | Formulas and rollups tour | **HARD** |
| 16 | Property autofill | open note, Details, "Suggest values with Compass" | 3 / 3 | yes / yes | mostly | nothing | **OK** |
| 17 | Version history | open note, More (⋯), "Version history" | 3 / 3 | yes / yes | yes | nothing | **OK** |
| 18 | Bulk select and actions | All notes, then a row checkbox (bar appears); Ctrl+Alt+B | 2 / 2 | yes / yes | yes | keyboard sheet | **OK** |
| 19 | Import (Notion, Obsidian, Evernote, files) | new member: "Import notes" on welcome. With notes: All notes, Import | 1 / 2 | yes / yes | yes (phone: icon only) | nothing | **OK** |
| 20 | Export the whole Notebook | All notes, Export | 2 / 2 | yes / yes | yes (phone: icon only) | nothing | **OK** |
| 21 | Export one note (Markdown, Word, PNG, print to PDF) | open note, ⋯, "Download this note as…" | 3 / 3 | yes / yes | yes (long sentences) | nothing | **OK** |
| 22 | Dictation | open note, toolbar microphone | 2 / 2 | yes / **clipped**: the 44 px button spans x 354–398 on a 390 px screen | icon only ("Start voice input") | one-time hint popover (per CLAUDE.md; not seen in this run) | **OK** |
| 23 | Voice and meeting notes (record, upload, Desk session) | All notes, Templates, "Voice note" (top of the template picker); or the LAST item of the slash menu | 3 / 3 | yes in the panel | yes | **no tour**, not in "See what it can do" | **HARD** |
| 24 | Attach an image, Word or Excel file (OCR, camera scan) | desktop: toolbar paperclip / image icons. Phone: "Format", then swipe a toolbar row where **2 of 15 controls are on screen** | 2 / 3 + hidden swipe | yes / **no** | icon only | "Add an image or Word document" tour | **HARD** (phone) |
| 25 | Ask this note | desktop: note header "Ask". Phone: ⋯, "Ask about this note" | 2 / 3 | yes / yes | yes | no Ask tour | **OK** |
| 26 | Ask the whole Notebook | a small "Ask" button at the very bottom of home (and a screen-reader-named "Ask a question about my notebook"); Ctrl+K then Ctrl+/ | 1 + scroll | **no / no** | "Ask", right under a different "Ask Notebook to do something" | no Ask tour | **HARD** |
| 27 | Writing help | desktop: note header "Writing help". Phone: a sparkle icon. Also the slash menu | 2 / 2 | yes / yes | yes / icon only | Writing help tour + offer banner | **OK** |
| 28 | Ask Notebook to do something (AI actions) | home button | 1 / 1 | yes / yes | mostly | no tour | **OK** |
| 29 | Compass can read your notes | Compass orb or Compass tab; nothing in the Notebook says Compass can see notes | n/a | n/a | n/a | nothing | **HIDDEN** |
| 30 | Share a link | note header "Share", then "Create link" | 3 / 3 | yes / yes | yes | Publish and share tour | **EASY** |
| 31 | Publish a note or folder to the web | Share, "Publish this note"; folder row, publish icon | 3 / 3 (folder 1 / 2) | yes / yes | yes | Publish and share tour | **OK** |
| 32 | Task reminders (due dates) | type `@tomorrow ` (with the trailing space) inside a checklist item. No slash item, no picker, no hint; typing `@` shows nothing | typed only | n/a | none visible | Task reminders tour | **HIDDEN** |
| 33 | Email to Notebook | Settings, Connections, "Create my address". Nothing inside the Notebook mentions it | 3 from Settings / not from the Notebook | n/a | yes | nothing | **HIDDEN** |
| 34 | Browser capture extension | Settings, Connections, Browser Capture (link to the Web Store). Nothing in the Notebook | same | n/a | yes | nothing | **HIDDEN** |
| 35 | Personal API and iOS Shortcuts | Settings, Connections, "Personal API" card (production; the code says so, this sandbox returned 404). No how-to for the Shortcut anywhere in the app: `docs/notebook/ios-shortcuts.md` is repo-only | n/a | n/a | "Personal API" is developer jargon | nothing | **HIDDEN** |
| 36 | Chart in a note | slash menu, TRADING section, first item ("/chart AMD"); toolbar "Insert" | 2 / 2 | yes / yes | yes, with examples | chart plan tours | **EASY** |
| 37 | Trade-plan canvas | slash TRADING item 7; button in the template picker | 2–3 / 2–3 | yes / yes | yes | no tour | **OK** |
| 38 | Technical fingerprint and setup tag | appears by itself under every chart in a note | 0 once a chart exists | no (desktop y 1054) / no | "Technical fingerprint" is jargon | fingerprint tour | **OK** |
| 39 | Chart plan (entry/stop/target, sizing, alerts, replay) | chart toolbar "Plan" (1 of **14** buttons). Desktop: the toolbar scrolls under the sticky editor bar. Phone: 14 buttons in 3 rows cover the chart | 3 + scroll / 3 + scroll | no / no | "Plan" yes; its neighbours "Aftermath", "Re-capture", "Sync", "Freeze", "Half", "Live" no | Chart plan tours, which **dead-end** (row note below) | **HARD** |
| 40 | Visual playbook | button in the fingerprint panel | 3 + scroll | no / no | yes | tour dead-ends the same way | **HARD** |
| 41 | Active setups board | bare "Active setups" link at the very bottom of home (y ≈ 690 after scrolling to the end) | 1 + scroll | **no / no** | yes | Active setups tour | **HARD** |
| 42 | Find more like this | button on a board card, only after the first overnight run; before that, one sentence | 2 + scroll + a night | no | yes | same tour | **HARD** |
| 43 | Reporting soon and earnings prep | home box (folded when empty, open when names report), "Create prep note" | 1–2 / 1–2 | yes / partly | yes | tour | **EASY** |
| 44 | Transcript passages | slash "/transcript" (TRADING item 8); "Save from a transcript" on a ticker research page | 2 / 2 | yes / yes | yes | tour (starts correctly from Learn) | **OK** |
| 45 | Passed setups | home box, Ticker + Add | 2 / 2 | yes / at the bottom edge or below (header y 803–1061, depending on the box above it) | yes | tour | **OK** |
| 46 | Note resurfacing | **desktop has no notifications bell** (removed from NavBar by owner request; `NavBar.jsx` keeps the restore note). The "Open what you wrote" door lives only in Settings, Compass & Voice. Phone has a bell | n/a | n/a | yes | 2-step explainer, only once it fires | **HIDDEN** |
| 47 | Thesis status chips | appear by themselves on Positions/Holdings rows | 0 | n/a | yes | nothing | **not measured** (needs the level scan) |
| 48 | Plan vs execution grading | Trades, Closed, row (the UNPLANNED chip shows in the row); the card is on the trade page | 3 / 3 | chip yes; card **no** (d y 1176, p y 1501) | yes | tour | **OK** |
| 49 | Discipline record | Insights, "Discipline" (7th of 8 tabs) | 2 / 2 | yes / yes | yes | nothing | **OK** |
| 50 | Entry context card | top of the trade page; on the position page it is below the fold (d y ≈ 990, p y ≈ 908) | 3 / 3 | trade yes / position no | yes | tour | **OK** |
| 51 | My Playbook | Insights, "Open My Playbook" | 2 / 2 | yes / yes | yes | tour | **EASY** |
| 52 | Reviews that write themselves | home box, open by default: "Today's recap" / week / month; also Insights, Reviews | 1 / 1 | yes (y 742) / no (y 936) | yes | tour | **EASY** |
| 53 | Terminal links in notes | paste a terminal command into a note | typed only | n/a | n/a | nothing | **HIDDEN** |

**Row 39/40, the dead-end tour (measured).** Member 0 had one note, listed under "Recent notes".
Starting "Chart plan basics tour" (or "Visual playbook tour") from Learn showed:

> *"This walkthrough runs inside a note. You do not have a note it can open yet. Write a note, or
> add the sample notebook from the Notebook home, then start it again from Help."*

That sentence is wrong three ways:

- the member *has* a note (`tourStart.js` actually wants a note **with a chart**);
- the Notebook home stops offering the sample once a note exists;
- the member started the tour from Learn, not Help.

The card's only exit is "Go to the Notebook", where the member already is.
Screenshot: `evidence/discoverability-2026-10-11/48-tour-chartplan-d.png`.

## Other things a trader trips on (measured)

- **Seven doors that say "Ask" or "AI" in or around the Notebook:**
  - note "Ask";
  - home "Ask Notebook to do something";
  - home bottom "Ask";
  - Ctrl+K "ask AI";
  - the Compass orb;
  - the Compass tab;
  - the "AI Search" nav item.

  Nothing says which one to use for what.
- **Duplicate icons in the bottom-right corner.** The Compass cluster there shows a mortarboard
  icon ("Train Me") and a paperclip ("Attach a chart screenshot"). The mortarboard is the same
  glyph as the Notebook's own "Learn" button, and the paperclip sits beside the editor's own
  paperclip. *Guess:* members will press the wrong one.
- **Nudges stack on the same screen.** On one home load a member with notes saw:
  - a tour offer banner ("New in your Notebook: Writing help", Take the tour / Not now);
  - after dismissing it, a "Meet Compass" banner;
  - the Get started card;
  - the Compass orb cluster.

  On a phone the "Meet Compass" banner alone pushes content down about 100 px.
- **A phone alert points to the wrong place.** The bell showed "New fill captured: A new fill's
  market context was captured in your Notebook." Entry context lives on the trade page, not in
  the Notebook.
- **The board page has no way back.** The Active setups board (`/journal/notebook/setups`) has no
  link back to the Notebook home. It also shows "No open setups yet." directly above two example
  cards.
- **"See what it can do" lists features but links none of them.** It lists nine features as plain
  text (Chart plans, My Playbook, Active setups board…) with no link or button to any of them.

## Ranked fixes (most member impact first)

Sizes: S = under a day, M = one to three days, L = more. Files are the likely ones, from a grep.
They are not a design.

1. **Put "New note" back on Research Home for returning members.** Add a primary "+ New note"
   button (with a small menu: blank, from a template, voice note, today's note) in the search/Learn
   row. Today a member with notes has no create button on the screen they land on.
   - Files: `components/notebook/ResearchHome.jsx` (+ `.module.css`); reuse the create handler
     `NotebookTab.jsx` already passes to the list.
   - Size: **S**.
2. **Make the chart toolbar usable, so the flagship chart plan can be found.**
   - Show the trading actions first with plain labels ("Plan the trade", "Replay"). Fold the other
     ten (Live, Half, Draw, Aftermath, Re-capture, Sync, Freeze, settings, remove…) into one "⋯".
   - On a phone the toolbar should be one row, not three rows covering the chart.
   - On desktop it should not slide under the sticky editor bar.
   - Files: `components/notebook/WidgetEmbedView.jsx` and its CSS module.
   - Size: **M**.
3. **Fix the dead-end chart tours.**
   - When no note has a chart, the card should say exactly that.
   - It should offer the way through: "Add the sample notebook" (call the same add-sample action)
     or "Insert a chart in a note". It should never send the member to Help or to a home screen
     that no longer has the sample button.
   - Files: `components/notebook/onboarding/tourStart.js` (`UNREACHABLE_COPY`, `resolveStart`).
   - Size: **S**.
4. **Give desktop a notices surface.**
   - Note resurfacing, task reminders and fill alerts currently reach a desktop member only through
     Settings, Compass & Voice. The NavBar bell was removed.
   - Either restore the bell (instructions are in `components/NavBar.jsx`) or add a folded
     "Notices" box at the top of Research Home that lists resurfaced notes and due tasks.
   - **Needs an owner ruling:** the bell was removed at the owner's request.
   - Files: `NavBar.jsx` or `ResearchHome.jsx`.
   - Size: **S**.
5. **Give the Active setups board a real door.**
   - Replace the bottom link with a folded box like Reporting soon, near the top. Label it
     "Active setups: N open plans", and show the empty-state sentence when there are none.
   - Add a "Back to Notebook" link on the board page.
   - Files: `ResearchHome.jsx`, `components/notebook/SetupsBoard.jsx`.
   - Size: **S**.
6. **Phone editor: stop hiding attach and insert.**
   - "Format" expands into a row where 13 of 15 controls start off screen. Make Format a bottom
     sheet with a grid.
   - Add one always-visible "+" (image, file, scan with camera, chart, voice note).
   - Fix the clipped microphone.
   - Files: `components/notebook/NoteEditorPage.jsx` (toolbar) and its CSS.
   - Size: **M**.
7. **One "Ask" on the home screen.**
   - Merge "Ask Notebook to do something" and the bottom "Ask" into one box at the top: "Ask your
     notes, or tell Notebook what to change". Answering and planning changes become two buttons
     on it.
   - Name the note-level one "Ask this note".
   - Files: `ResearchHome.jsx`, `components/notebook/AiActionsPanel.jsx`.
   - Size: **M**.
8. **Point to the capture doors from inside the Notebook.**
   - Add a "Capture from anywhere" section to the Import dialog and to "See what it can do":
     Email to Notebook, the browser extension, and the iPhone Shortcut.
   - Write a member-facing Shortcut how-to; today it exists only as a repo doc.
   - Rename the "Personal API" card to "Connect your own tools (Personal API)".
   - Files: the import wizard in `tabs/NotebookTab.jsx`, `components/PersonalApiCard.jsx`,
     `InboundEmailCard.jsx`, `BrowserCaptureCard.jsx`, plus a Help page.
   - Size: **M**.
9. **Make due dates findable.**
   - Add a slash item "Due date" and a date picker on checklist items.
   - Make typing `@` offer today / tomorrow / pick a date.
   - Put "type @tomorrow to get a reminder" in the Checklist slash description.
   - Files: `components/notebook/SlashMenu.jsx`, `lib/dateMentionNode.js`.
   - Size: **S–M**.
10. **Voice notes: a door and a tour.**
    - It is armed in production and only reachable from the template picker or the last slash item.
    - Add it to the "+ New note" menu from fix 1 and to "See what it can do".
    - Add a short tour.
    - Files: `ResearchHome.jsx`, `onboarding/tourRegistry.js`, `lib/voiceNote.js`.
    - Size: **S**.
11. **Label the view buttons.**
    - Seven icon-only buttons; on a phone none has visible text.
    - Use a "View: List ▾" select on phones, or text under the icons.
    - Files: the list toolbar in `tabs/NotebookTab.jsx`.
    - Size: **S**.
12. **Learn menu: group and shorten.**
    - Group the 20 tours (Writing · Research · Trading · Sharing), put not-yet-taken tours for live
      features first, and add the missing Ask / voice-note tours.
    - On a phone, open it as a bottom sheet so all items fit.
    - Files: `onboarding/LearnMenu.jsx`, `onboarding/learnTours.js`.
    - Size: **S**.
13. **Search in place.**
    - The home search box should type in place, not open a second search box in the sidebar while
      its own box stays on screen.
    - Files: `ResearchHome.jsx`, `FolderSidebar.jsx` (`#search` door).
    - Size: **S–M**.
14. **Make formulas one step closer.**
    - Put "Add a formula" (with the trader starters) at the top of the Add property menu, instead
      of New property → type → Formula.
    - File: the properties panel under `components/notebook/`.
    - Size: **S**.
15. **Keep the sample notebook reachable after the first note.**
    - Add an "Add the sample notebook" item to the Learn menu, so the six feature examples stay
      reachable. This is also what fix 3's tour card should call.
    - Files: `LearnMenu.jsx`, `onboarding/gettingStarted.js`.
    - Size: **S**.
16. **Plan-grade card above the fold.**
    - On the trade page the card sits at y 1176 (desktop) and y 1501 (phone).
    - Move it up, or make the row's UNPLANNED chip a link to it.
    - Files: the trade page under `pages/journal-2-0/`.
    - Size: **S**.

## Incidental, not investigated

- **A note forked into a conflicted copy, once.**
  - Member 4 opened "My trading rules", which had been made through the notes API about 40 minutes
    earlier, in one browser tab. The script typed `/checklist` + text, then navigated to the list
    about 1.5 s later.
  - Afterwards the account held "My trading rules (conflicted copy)"
    (`cea9248ecb6845cab3fc5113e6279d6b`) beside the original.
  - It was seen once, and the fast navigation may be the cause. A member who navigates quickly
    could hit the same thing. Worth a look by the Notebook owner.
- **The chart "Plan" button could not be clicked by the script.** With the embed scrolled to the
  middle of the screen, Playwright reported the chart canvas or the sticky editor bar covering it.
  A person scrolls differently, so this is instrument-adjacent, but it agrees with fix 2.

## What this audit did not do

- No real phone (BrowserStack Live) and no screen reader. Keyboard was spot-checked on desktop home:
  - Learn opens with Enter and arrows, and Escape returns focus to the button;
  - Tab reaches "Search your notes" at stop 17, Learn at 18, "Ask Notebook to do something" at 21,
    and "Active setups" at 42;
  - skip links exist;
  - the AI-actions box has a proper label ("What should Notebook do?").
- No model keys, so it measured the doors to AI features, never their answers.
- No real members. Every "members will…" sentence in this doc is marked as a guess.
