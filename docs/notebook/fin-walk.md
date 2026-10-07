# Notebook waves 12-15: the acceptance walk (PRE-FINAL pass on `8852a2a8c0`)

Lane WALK, branch `feat/notebook-fin-walk`. This is the pre-final pass on the landing tip
`8852a2a8c0` (`origin/feat/notebook-w14-land`, merged INTO this branch; the frontend was rebuilt
from it). Two fix branches were not in that tip yet (lane VOICE's request-body conversion, lane
KEYS' keyboard focus work), so a shorter confirmation run on the final tip still has to follow.

An earlier capture on the old tip `72715e8001` is kept as a before picture in
`docs/notebook/evidence/fin-walk/PRE-FIX-baseline-72715e8001/README.md`.

## How it was run

Tool: `tools/notebook_fin_walk.py` (core, configurations 1 and 3),
`tools/notebook_fin_walk_features.py` (configuration 2), `tools/notebook_fin_walk_live.py` (the
live-on-merge steps and the unpaid account). Real Chromium through Playwright, viewports
1280x800, 820x1180 and 390x844 (the last two with touch). One sandbox boot per configuration
through `scripts/hub_sandbox_boot.py`, port 8132, an empty data dir each time, admin
`hubtest@local.dev`, every walk account comped and checked paid before any step (the walk
aborts otherwise).

Every step records console errors, page errors, every response of 400 or more with its URL,
the request and response of every write, sideways scroll (the app's inner scroller and the
document), controls under 44 px on touch widths, whether the error boundary rendered, and a
screenshot. Raw files were committed before this summary was written.

| configuration | switches | raw evidence | steps | sandbox integrity (first line) |
|---|---|---|---|---|
| c1 | only what the ledger says production has armed | `evidence/fin-walk/8852a2a8c0/c1/` | 137 | `SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, post-prewarm (+120s) CLEAN, shutdown CLEAN; 62 db files hashed` |
| c2 | c1 plus all 17 wave 11-14 switches (and meaning search, for its tour only) | `.../c2/` | 197 | the same line, CLEAN at all four |
| c3 | visual playbook, setups board, review drafts ON; fingerprint, chart plan, plan grading OFF | `.../c3-run1/` (first run, a walker defect in one step), `.../rerun/c3/` | 14 + 15 | the same line, CLEAN at all four, both runs |
| c1 re-run | the 1280 live steps again after three walker fixes | `.../rerun/c1/` | 16 | the same line, CLEAN at all four |

Across all runs on this tip: **0 page errors, 0 error-boundary renders, 0 sideways scroll at any
width.** The port was free and my sandbox data dirs were removed after the last run.

Trades are not a wave 12-15 surface and the sample seeds none, so positions and closes go
through the member's own API routes; everything wave 12-15 adds is driven through the page.
The two overnight jobs (find similar, passed setups) and one awareness scan were run in a child
process against the sandbox's own data, the way lane 13X did.

## PRODUCT failures (each judged from the product's own answer)

### P1. Phone: the "Delete this note?" button sits under the floating voice orb (flags off)
- Where: c1, 390. `c1/walk.json`, feature `note CRUD`, step `crud (driver exception)`;
  screenshot `c1/shots/c1-390-note-CRUD-crud-driver-exception-.png`.
- Steps: at 390 px open a note, More note actions, Delete. The confirm sheet's red Delete button
  is at the bottom right, and the voice orb is drawn on top of it. The browser reports the orb's
  `<circle r="46">` takes the tap at the button's centre. The same walk deletes fine at 820 and 1280.
- Suspect: the confirm sheet in `app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx`
  (the `Delete this note?` dialog) against `app/src/components/voice/FloatingOrb.jsx` (the orb
  does not move away or sit below an open sheet). Also seen on the old tip. IMPORTANT on a phone.

### P2. `GET /api/voice/cost` still answers 500 on Settings, Compass and Voice
- Where: c1 at all three widths, c2, and the c1 re-run.
- Request: `GET /api/voice/cost`. Response: `500 Internal Server Error`. Server log
  (`c1/sandbox-c1.log`): `sqlite3.OperationalError: no such column: seconds_used`,
  `api/services/voice_cost_service.py:95` (`get_monthly_cost_summary`), called from
  `api/routers/voice.py:651`.
- The Voice telemetry tile itself renders its tool-call numbers; the cost read is what fails. The
  brief says this is fixed in production code paths; it is not fixed on `8852a2a8c0` (it may be
  on the VOICE branch not merged yet). IMPORTANT until confirmed.

### P3. The resurfacing explainer never showed
- Where: c2. Feature `tour: note-resurfaces` at 1280, 820 and 390 (FAIL, check "the explainer
  shows when the resurfacing sheet first renders"), and feature `note resurfacing` at 1280, where
  the sheet was opened from the real notice (`explainer: 0`).
- Steps: member with the sample, Get started hidden, one tour offer declined with Not now. A
  stop is crossed, the notice is opened from Settings, Compass and Voice, Voice Insights Inbox,
  "Open what you wrote". The "What you wrote then" sheet opens correctly, but no explainer card
  appears in it, on the first open or later.
- Not yet known: whether declining an offer earlier in the session is what suppresses it. Lane
  W14-Q2 saw it on a member who had declined nothing. Suspect
  `components/notebook/onboarding/GenericTourEngine.jsx` (the "shown once per member" read near
  line 156) or the registry gate. MINOR to IMPORTANT.

### P4. Earnings prep note: the member's own closed trade is not in it
- Where: c2, 1280, feature `earnings prep`, step "the prep note prints the member's own trade
  result as the right percent".
- Seeded: AMD long, entry 341.28, exit 514.93 the same day, so +50.9%. The prep note for AMD was
  built after the trade closed. The note holds 14 percent figures, all from the earnings history
  and the expected move; none is the trade's, and no line names a trade.
- The check wanted "+50.9%". The product's answer is that the trade is absent, not that it is
  mis-printed, so the percent fix itself could not be confirmed. The walk kept only the first 700
  characters of the note, so which section should have listed it is not in evidence (the tool now
  keeps 6000). Suspect `api/services/journal_two/earnings_prep.py` (the member's trades section).
  IMPORTANT if the trade is meant to be listed.

### P5. Touch widths: several controls are under 44 px wide
| where | control | size | evidence |
|---|---|---|---|
| chart block toolbar in a note (flags off, 820 and 390) | Hide toolbar, Chart settings, Remove embed | 34 x 44 | `c1/walk.json`, `editor menus` |
| same | Half | 39 x 44 | same |
| same | Sync | 43 x 44 | same |
| Reporting soon list (820 and 390) | the symbol link ("AMD research") | 41 x 44 | `c2/walk.json`, `layout`, `Research Home` |
| a note's filter row (820 and 390) | All | 37 x 44 | `c1/walk.json` |

Suspect `components/notebook/WidgetEmbedView.module.css` (the always-visible toolbar's buttons)
and `components/notebook/ReportingSoon.jsx`. MINOR. The old tip's 22 px Edit control on the entry
context card is no longer flagged.

### P6. Formulas tour opens on "Step 2 of 5"
- c2, all three widths. Replay opens on the member's most recent note. Step 1 points at a control
  that exists only on a note with no properties; the steps about a formula need a note that has
  one. No single note can show both, so the tour shows 4 of 5 and starts on step 2.
  Suspect `onboarding/tours/b1Formulas.steps.js`. MINOR, known from `wave14-w14-q2.md`.

### P7. Honesty gaps when a prerequisite is off (c3)
No error, no failed request, no boundary in any c3 step. Two messages are less than honest:
- Review drafts without plan grading: the draft simply has no discipline part and says nothing
  about it, while the box on Home and in Insights still promises "the discipline record".
  `rerun/c3/walk.json`, `review drafts without plan grading`.
- Setups board without chart plan: the board works and lists the sample's cards with their
  Example label, and its empty line says "Draw an entry line on a chart in a plan note", which
  points at the chart plan panel that is switched off. `rerun/c3/walk.json`.
- Visual playbook without fingerprint: no door anywhere (its door is the fingerprint panel). The
  trade page's before and after renders and says "No frozen plan for this trade, so only the
  fills are drawn". Fine.
MINOR. Suspect `lib/reviewDrafts.js` copy and `components/notebook/SetupsBoard.jsx` copy.

### P8. Small leftovers after "Remove it"
One click removed all ten sample notes (message: "The sample notes are in Trash. You can restore
them from there."). Nothing of the sample was left on Research Home, the notes list, the notes
search API, passed setups, the setups board, the visual playbook or the Notebook export. Two
EMPTY folders stay in the sidebar: "Sample notebook" and "Capability examples".
`c2/walk.json`, `remove sample`, `folders_left`. MINOR.

### P9. "Find more like this" on an Example card promises a match that cannot come
The MSFT example card's sheet says "No matches yet ... so this one is matched tonight". The
overnight run then reported `templates: 0` with the two tagged sample charts present, so sample
charts are (correctly) left out of matching, and the sentence is not true for them.
`c2/walk.json`, `overnight jobs` and `find similar`. MINOR. Suspect `components/notebook/SimilarNames.jsx`.

## Per-feature table

PASS, FAIL-PRODUCT, FAIL-INSTRUMENT, NOT RUN. Widths in px.

### Configuration 1: switches as production has them (flags off for waves 12-15)

| feature | 1280 | 820 | 390 | note |
|---|---|---|---|---|
| auth payload: every wave switch OFF | PASS | PASS | PASS | |
| first run: welcome, no wave surface | PASS | PASS | PASS | |
| create a note, type, reload, search | PASS | PASS | PASS | |
| delete the note | PASS | PASS | FAIL-PRODUCT (P1) | |
| slash menu, chart toolbar, property types, template picker: no wave entry | PASS | PASS | PASS | |
| no wave surface on Research Home, Open Positions, closed trades, trade page, position page, Insights (and `?ins=discipline`, `?ins=reviews`), `/journal-2-0/playbook`, `/journal/notebook/setups`, research workspace, Help, navigation | PASS | PASS | PASS | 14 pages per width |
| sample notebook: exactly the five wave-8 notes | PASS | n/a | n/a | |
| new member's first Journal page: no 5xx | PASS | PASS | PASS | the old tip's default-account race did not recur |
| Today button | PASS | PASS | PASS | |
| built-in templates listed (33) | PASS | PASS | PASS | first run's FAIL was the walker looking for the walkthrough in the picker |
| walkthrough toggle in a template-made note | PASS | not re-run | not re-run | `rerun/c1` |
| Trade Plan template: properties created once, first note's values kept | PASS | PASS | PASS | |
| click a chart in a note selects it; Delete removes it | PASS | FAIL-INSTRUMENT | FAIL-INSTRUMENT | on touch the walk tapped; touch widths use Block actions |
| Block actions button and a toolbar that is always there | n/a | PASS | PASS | toolbar buttons under 44 px wide (P5) |
| drag a chart to move it | FAIL-INSTRUMENT | n/a | n/a | a synthetic mouse drag did not move it, twice; not proven either way |
| the two Log Trade dialogs open on the first click | PASS | PASS | PASS | about 0.4 s each |
| upload limits answer with a sentence | PASS | PASS | PASS | see below |
| note import wizard, two Markdown files | PASS | PASS | PASS | "Imported 2 notes." |
| share a note, public page signed out | PASS | FAIL-INSTRUMENT | FAIL-INSTRUMENT | first run used a wrong URL; `/share/n/<token>` passes at 1280 in `rerun/c1` |
| keyboard skip links | NOT RUN (instrument) | n/a | n/a | Tab reaches three skip links; whether using one moves the tab order was not read correctly in either run |
| Settings voice telemetry tile | FAIL-PRODUCT (P2) | FAIL-PRODUCT | FAIL-PRODUCT | |
| UNPAID account: 7 Notebook and Journal pages go to `/subscribe`; 8 routes answer without a 500 | PASS | n/a | PASS | |

Upload limits, request and response (`c1/walk.json`, `api_writes`):
`POST /api/j2/trades/{id}/attachments`, 6 MB image: `413 {"detail": "Image must be < 5 MB"}`.
`POST /api/j2/trades/import/preview`, 11 MB CSV: `413 {"detail": "File exceeds 10 MB limit"}`.
`POST /api/j2/notes/{id}/attachments`, 60 MB file: `413`, "File is larger than the 25 MB limit. ...".

### Configuration 2: everything on, a fresh empty account

| feature | 1280 | 820 | 390 | note |
|---|---|---|---|---|
| first run: welcome, capability preview, sample promotion, Get started list | PASS | PASS | PASS | |
| Add a sample notebook (5 practice notes, 5 examples) | PASS | | | |
| sample examples on their own screens: AAPL plan (3 levels, R:R 2.50R), visual playbook cards with Example labels, MSFT on the setups board, NVDA notice inside the note and an empty inbox, TSLA cited excerpt, GOOGL passed setup, AMZN prep draft and its Open door | PASS (8 of 8) | | | |
| Get started: three steps tick on real actions, survive a reload; Hide stays hidden | PASS | | | |
| one-time offer; no second offer after a reload | PASS | | | |
| Help: Walkthroughs (base + 19), What's new | PASS | | | |
| template gallery: browse, insert, publish for review, admin queue | PASS | | | |
| formulas (R-multiple = 2) | PASS | PASS (layout) | PASS (layout) | |
| chart plan: insert, draw three levels and roles, sizing, alert at the stop | PASS | PASS (layout) | PASS (layout) | new member sees "No max risk per trade is set"; "6 sh" once it is set |
| entry context card (position and trade page) | PASS | PASS | PASS | |
| entry context: write why, save, still there after a reload | FAIL-INSTRUMENT | | | the text is on the card after the reload; the walk looked for an old marker |
| thesis chips on Open Positions rows | FAIL-INSTRUMENT | | | chips no longer come from a sample note (by design); the walk had no position on the member's own thesis. NOT verified on this tip |
| setups board | PASS | PASS | PASS | |
| find similar before an overnight run: honest "No matches yet" | PASS | | | see P9 |
| find similar after an overnight run | FAIL-INSTRUMENT | | | the walk's template was a sample chart, which is no longer matched. NOT verified on this tip |
| transcript passage capture, cited | PASS | PASS (layout) | PASS (layout) | |
| passed setups: listed, add, scored, remove | PASS | PASS | PASS | |
| resurfacing: notices in the inbox; "What you wrote then" opens at the version that first named the stop | PASS | | | |
| resurfacing explainer | FAIL-PRODUCT (P3) | FAIL-PRODUCT | FAIL-PRODUCT | |
| plan grading: planned trade (four checks), Unplanned chip and badge, Discipline tab | PASS | PASS | PASS | |
| technical fingerprint, visual playbook, trade before and after | PASS | PASS | PASS | |
| My Playbook from Insights | PASS | PASS | PASS | |
| earnings prep: Reporting soon, one-click note with its sources | PASS | PASS | PASS | symbol link 41 px wide on touch (P5) |
| earnings prep: the member's trade percent | FAIL-PRODUCT (P4) | | | |
| review drafts: daily, weekly, monthly | PASS | PASS | PASS | |
| layout pass over 18 pages: no sideways scroll, no boundary | PASS | PASS except P5 | PASS except P5 | |
| remove the sample in one click; nothing left in lists, search, stats, export | PASS | | | search-box check FAIL-INSTRUMENT; two empty folders stay (P8) |
| writing help, Ask, AI actions, meaning search itself, dictation, the Compass quote in a draft | NOT RUN, NO KEY | | | |

### Tours (Replay from Help; opens, first card, Back, Next, Escape, tap floor, keyboard reach, focus trap, axe on the card)

Shown / declared steps. Every row passed every card check at every width unless noted.

| tour | 1280 | 820 | 390 | note |
|---|---|---|---|---|
| writing-help | 4/4 | 4/4 | 4/4 | |
| image-docx-import | 2/5 | 3/5 | 5/5 | the other steps are phone-only by design |
| publish-share | 4/4 | 4/4 | 4/4 | |
| task-reminders | 3/3 | 3/3 | 3/3 | |
| template-gallery | 4/4 | 4/4 | 4/4 | |
| meaning-search | 3/3 | 3/3 | 3/3 | |
| formulas-rollups | 4/5, starts on step 2 | same | same | FAIL-PRODUCT (P6) |
| plan-grading | 5/5 | 5/5 | 5/5 | |
| entry-context | 2/4 | 2/4 | 2/4 | the "why" steps had no anchor on the newest trade's card |
| review-drafts | 4/4 | 4/4 | 4/4 | |
| my-playbook | 5/5 | 5/5 | 5/5 | |
| chart-plan-basics | 6/6 | 6/6 | 6/6 | |
| chart-plan-replay | 3/4 | 4/4 | 4/4 | `context` skipped at 1280 |
| ta-fingerprint | 4/4 | 4/4 | 4/4 | |
| visual-playbook | 6/6 | 6/6 | 6/6 | |
| setups-board | 5/5 | 5/5 | 5/5 | |
| earnings-prep | 3/4 | 3/4 | 3/4 | the Create step is gone once the prep note exists |
| transcript-capture | 5/5 | 5/5 | 5/5 | the walk typed /transcript, as the card asks |
| passed-setups | 3/3 | 3/3 | 3/3 | |
| note-resurfaces (explainer) | FAIL-PRODUCT (P3) | same | same | |

Of the 19 steps earlier walks never displayed, 14 now show with seeded data. Still not shown:
formulas `add-first` (P6), entry-context `why` and `save`, earnings-prep `prep`.

### Configuration 3: a dependent without its prerequisite

| check | 1280 | 820 | 390 | what the page said |
|---|---|---|---|---|
| visual playbook without fingerprint | PASS | FAIL-INSTRUMENT | FAIL-INSTRUMENT | no door; before and after says "No frozen plan for this trade, so only the fills are drawn" |
| setups board without chart plan | PASS | PASS | PASS | lists the Example cards; see P7 |
| review drafts without plan grading | PASS | PASS | PASS | drafts a note with no discipline part and no word about it; see P7 |

## Other things recorded

- Failed requests that are not defects: `POST /api/j2/broker/sync` 503 and bars pre-warm 503s (no
  broker, no vendor key in a sandbox); `GET /api/auth/me` 401 on the signed-out share page; 404s
  for a note the walk had just deleted while its page was still open; the fingerprint freeze
  route's 404 before a save lands (by design, retried).
- A plan drawn in one sitting has no saved version naming its stop, so its notice opens the note
  itself with no "What you wrote then" sheet. By design (`note_levels.py`).
- The sandbox serves real bars for real tickers (the fallback needs no key).

## Not covered, or not settled

- Thesis chips, find similar with a match, the "why" save marker, skip links, drag: instrument
  gaps on this pass. The tool is corrected for the first three; skip links and drag still need a
  correct read.
- Tours at three widths ran on one member; the offer and checklist flows ran at 1280 only.
- The published-note page's stripped formatting, the bar replay dialog, the thesis chip sheet on
  touch and the Positions phone card were not walked beyond the layout pass.
- Model-backed steps: NOT RUN, NO KEY.
- The final-tip confirmation run.
