# Notebook simplify, pass 2: one name per thing, a Daily brief that shows only what it has, fewer rows

Written 2026-11-12, after pass 1 (PR #1168) merged.

## Why

Owner, 2026-11-11: "right now it is pretty noisey and distracting with honestly too much going on and quite confusing. I want to make this a lot easier and better and simpler now". Pass 1 cut what is on screen at rest (open note 103 -> 69 clickable things, list 114 -> 72). What is left, in my judgement: one thing has several names and one name means several things; the Daily brief is mostly teaching text for a member with little data; a brand-new member's first screen is the busiest screen in the Notebook; some menus are long.

Owner, 2026-11-12, asked whether to wait for his mark-up of a cut list: "you can do it all fully and get it all done". So this pass ships without a mark-up, under one rule: **every move is reversible** (a rename, a card hidden while it is empty, an option moved one click deeper). **Nothing is deleted.** He gets the list of what moved and how to undo each afterwards.

No usage evidence exists (the repo records about 30 events; none say which view, menu row or template is used). Every "rarely used" below is my judgement, not a measurement.

## Global rules

- Same as pass 1: no emoji (icons are `UIcon`), breakpoints 640 and 1024 only, tokens not raw px, no new dependency, no new feature flag, nothing animates forever, plain words with no em dash, every `data-tour` anchor exists exactly once and a moved control takes its anchor with it, first-open bytes do not grow (budget 2,260,793 B; 2,256,355 B at the start), on-demand code a member types into loads through `lib/heldModule.js`, focused tests only, every new guard proven able to fail.
- Server changes: only B1 (read today's note without creating it) and A3 (folder name for new members), each with scoped pytest files named in the plan. No schema change.
- Walkthroughs: every tour still runs start to finish at 1280, 820 and 390. A tour whose control moves gets its steps re-pointed in the same task.

## A. One name per thing

| # | Now | After | Where |
|---|---|---|---|
| A1 | The Daily brief page has no title; it opens with "Good morning, {name}" | Visible heading "Daily brief"; the greeting joins the date line under it | `components/notebook/TodayHome.jsx` header |
| A3 | Folder "Daily" sits directly under the panel row "Daily brief" | New members get "Daily notes"; an existing "Daily" folder is still found, used and never renamed | `api/services/journal_two/note_daily.py` (`DAILY_FOLDER_NAME`) |
| A4 | "Kind added.", "Kind renamed.", "Choose a kind", "Delete kind" | "Note type ..." everywhere a member reads it | `components/notebook/styles/StylesManager.jsx`, `SaveAsStyleForm.jsx` |
| A5 | "Update layout", FAQ "a layout" (meaning a template) | "template" | `styles/StyleUpdateSheet.jsx`, `pages/Support.jsx` |
| A6 | Plain button "Ask this note" (shown when Writing help is off) | "Ask about this note", the words every other door uses | `components/notebook/AskPanel.jsx`, `NoteEditorPage.jsx` |
| A7 | Phone top bar says "Journal" on the Notebook | "Notebook" on `/journal/notebook*` | `components/MobileNav.jsx` `ROUTE_TITLES` |
| A8 | Phone "+" sheet row "Ask AI" opens Compass (the voice coach page) | "Ask your Notebook", opening the Notebook's own Ask panel, like the More row | `components/notebook/NotebookPlusSheet.jsx` |
| A9 | "Journal tools" (phone More rows) beside "My tools" | "Trade journal tools" | `tabs/NotebookTab.jsx`, `NoteEditorPage.jsx` |
| A10 | View menu group "List layout" (Rows / Cards) | "Show as" | `tabs/NotebookTab.jsx` |

(Pass 1 already renamed the phone row "Today" to "Today's note".) Not renamed here, recorded as a later job: "template" covers note-type templates ("Manage templates") and plain templates ("My tools" > Templates), two managers over overlapping ground.

## B. Daily brief shows only what it has

- B1. Opening the page reads today's note without creating it or its folder (`GET /api/j2/notes/today?make=0`; the service already has the switch). The plan card's button reads "Start today's note" until one exists, then "Open today's note". The list's "Today's note" button, Ctrl+Alt+D and the phone row still create on press. The two walkthroughs that start on the Daily brief therefore stop creating a note as a side effect.
- B2. A card with nothing to show is not drawn: "Open from yesterday", "On this day", and "Today's plan" when there are no open lines (its Start/Open button is then the header's button, B4). Their teaching sentences move to the Help page's Daily brief answer.
- B3. The two first-run asks ("Setups near entry", "Your names") stay for a member who has neither, compact: heading, one line, the field. The numbered how-to list goes (the Chart plan walkthrough teaches it).
- B4. Header buttons: "Quick capture", "All notes", "+ New" become one button: "Today's note" (Start/Open). "All notes" is one row away in the panel; "+ New" lives on the list; Quick capture stays in the command palette.
- B5. When no card has content: one quiet line, "Nothing for today yet. Your plan, the setups near your entry and your names will show here.", plus the two compact asks.

## C. Fewer rows (tuck, never delete)

| # | Thing | After |
|---|---|---|
| C1 | View menu: Graph and Timeline | Under a "More views" row at the foot of the View menu (a second view inside the same menu, the pattern Aa > Font uses). A saved view or a `?view=graph` link still opens them directly. |
| C2 | New menu: a "Reviews" heading with three rows; on a phone the same three rows in More | One row "Draft a review" that opens the three choices as a second view of the same menu (both menus). The Reviews walkthrough is re-pointed. |
| C3 | Open note > More: six export formats drawn as six buttons | One row "Export" opening the formats as a second view. Print stays inside it. |
| C4 | Insert palette: the "More" group (nine market snapshots) always open | Folded behind "Show all" at the foot; the slash menu is unchanged. |
| C5 | A brand-new member's empty list: an Import button, the Get started card, and a full template grid under it | The template grid is not drawn on the empty list while the Get started card is up (its "Start a note from a template" row opens the picker; so does "+ New"). With the card hidden or absent the grid draws as today. |
| C6 | Phone More row "Remove the sample notebook" wraps to two lines | "Remove sample notebook" on a phone (one line); desktop words unchanged. |

Not in this pass (bigger jobs, each needs the owner): one template manager instead of two; one day page instead of the Journal "Today" tab plus the Notebook "Daily brief"; property types under an "Advanced" fold; Settings > Connections under an "Advanced" fold.

## D. Carried from pass 1's reviews (small, do in this pass)

- A walkthrough started from Help by a brand-new member waits for the 60-second first run with no time limit: release it after 10 seconds and say the existing "could not start" notice.
- The sample-removal hold uses one sentence for unsent and blocked notes: a blocked note keeps the older remedy ("edit it again first").
- Back after the Get started template link leaves the New note sheet open: closing follows the hash.

## Review focus (what a tester would trip on)

1. A member whose today's note exists, is in Trash, or was made earlier by a page load: B1 must not create a second one or resurrect a trashed one, and the button must say the right word in each case.
2. An existing member with a "Daily" folder (A3): notes keep going there; a member who somehow has both names does not get notes split.
3. A saved view of type graph or timeline, and a `?view=timeline` link, with the modes tucked (C1): still open, and the View button names the mode.
4. The Daily brief for a member with nothing (B5): no empty headings, no layout jump when a later read lands, no request added to a plain Notebook open.
5. Keyboard on every menu with a second view (C1, C2, C3): Enter opens it, Esc or a "Back" row returns to the first view with focus on the row that opened it, a second Esc closes the menu and returns focus to its button.

## After it ships

A page for the owner, saved locally (not published): each change with a before and after screenshot and one line on how to undo it; the "not in this pass" jobs as questions.
