# Notebook waves 12-15: the acceptance walk (CONFIRMATION run on `af0b7ffeea`)

Lane WALK, branch `feat/notebook-fin-walk`. This is the confirmation run on the final landing
tip `af0b7ffeea` (`origin/feat/notebook-w14-land`, merged INTO this branch; the frontend was
rebuilt from it). It supersedes the pre-final pass on `8852a2a8c0` (evidence kept under
`evidence/fin-walk/8852a2a8c0/`) and the old-tip baseline
(`evidence/fin-walk/PRE-FIX-baseline-72715e8001/`).

**Verdict: no blocking product failure found. Two minor product findings and one unsettled item
remain (section 2). Every product failure reported from the pre-final pass that could be
re-checked is fixed.**

## 1. How it was run

Tools: `tools/notebook_fin_walk.py`, `tools/notebook_fin_walk_features.py`,
`tools/notebook_fin_walk_live.py`. Real Chromium through Playwright at 1280x800, 820x1180 and
390x844 (the last two with touch). One sandbox boot per configuration through
`scripts/hub_sandbox_boot.py`, port 8132, an empty data dir, admin `hubtest@local.dev`, every
walk account comped and checked paid first. Every step records console errors, page errors,
responses of 400 or more with their URL, the request and response of every write, sideways
scroll on the app's inner scroller and the document, controls under 44 px on touch widths, the
error boundary, and a screenshot. Raw files were committed before this summary.

| run | switches | raw evidence | steps | PASS | FAIL | INFO | NOT RUN |
|---|---|---|---|---|---|---|---|
| c1 | only what production has armed, plus the live-on-merge steps and an unpaid account | `evidence/fin-walk/af0b7ffeea/c1/` | 142 | 139 | 2 | 1 | 0 |
| c2 | c1 plus all 17 wave 11-14 switches | `.../c2/` | 200 | 177 | 8 | 8 | 7 |
| c3 | visual playbook, setups board, review drafts ON; fingerprint, chart plan, plan grading OFF | `.../c3/` | 17 | 2 | 0 | 15 | 0 |
| c2 re-run | the chart plan, trade and earnings prep path, after one walker ordering fix | `.../rerun/c2/` | 18 | 16 | 2 | 0 | 0 |

Of the 12 FAIL rows, 2 are product findings (c1: a skip link, and the chart drag, which is
unsettled) and 10 are walker defects, each explained in section 4.

Snapshot rail, first line of every boot (four boots): `SANDBOX INTEGRITY: CLEAN -- pre-boot
(baseline) CLEAN, post-boot (+15s) CLEAN, post-prewarm (+120s) CLEAN, shutdown CLEAN; 62 db
files hashed`. Port 8132 was free and the sandbox data dirs were removed after the last run.

Across all four runs: **0 page errors, 0 error-boundary renders, 0 sideways scroll at any
width, and no unexpected failed request.** The only responses of 400 or more were: the sandbox's
broker-sync and bars pre-warm 503s, `GET /api/auth/me` 401 on the signed-out share page, 404s for
a note the walk had just deleted while its page was open, and the fingerprint freeze route's 404
before a save lands (by design, retried).

## 2. PRODUCT findings on `af0b7ffeea`

### F1. "Skip to folder navigation" goes nowhere (MINOR, accessibility)
- Where: c1, 1280, `live: skip links`, on Research Home and on All notes.
- Steps: load `/journal/notebook`, press Tab from the top. Three skip links are reached: "Skip
  to main content", "Skip to notes list", "Skip to folder navigation". Use each with Enter and
  read `document.activeElement`. The first lands on `main#main-content`, the second inside
  `#notebook-pane`. For the third, `#notebook-folder-nav` is not in the page (`target_exists:
  false`) and focus does not move.
- Not ruled out: the folder panel was in its default state; if the link is meant to open a
  collapsed panel first, it did not within 400 ms.
- Suspect `app/src/pages/journal-2-0/components/notebook/FolderSidebar.jsx` (the skip link near
  line 1325 and where `notebook-folder-nav` is rendered).

### F2. A few touch controls are still under 44 px (MINOR)
`c1/walk.json`, 820 and 390: the "All" filter button is 38 x 44; one checkbox input is 20 x 20;
in the import wizard the destination row ("Daily, Imported from Files ...") is 37 px tall.
The chart block toolbar and the Reporting soon link are now at least 44 x 44 (confirmed).

### F3. Dragging a chart block with the pointer did not move it (UNSETTLED)
- Where: c1, 1280, `live: chart block`, step "dragging the chart moves it below the paragraphs".
- Steps: a note with a chart then two paragraphs. Pointer down on the chart's body, 30 moves over
  about 0.7 s to below the second paragraph, pointer up. The stored order stayed
  `[widgetEmbed, paragraph, paragraph]`, in this run and in two earlier ones.
- Clicking the chart selects it and Delete removes it (PASS), and on touch widths Block actions
  moves and removes it (PASS). So the block is movable; whether a mouse drag works for a member
  was not shown either way by a synthetic pointer. Needs one check by hand.

## 3. What was confirmed fixed since the pre-final pass

| pre-final finding | on `af0b7ffeea` | evidence |
|---|---|---|
| P1 phone: Delete confirm under the voice orb | FIXED. At 390 the Delete button is the top element at its centre (84 x 44) and the note is deleted; same at 820 and 1280 | `c1`, `note CRUD`, `confirm_button` |
| P2 `GET /api/voice/cost` 500 | FIXED. No failed request; the tile shows "MONTH-TO-DATE $0.00, PROJECTED MONTH $0.00, DAILY RATE $0.00/day, REALTIME MINUTES 0" at all three widths | `c1`, `live: voice telemetry tile` |
| P3 resurfacing explainer never showed | It shows on the first open of the sheet from a real notice. The pre-final failure was the walk reading too early | `c2`, `tour: note-resurfaces` |
| P4 earnings prep and the member's trade | FIXED. Built after the AMD trade (341.28 to 514.93) was closed, the note prints "+50.9%". Built before the close it truthfully says "You have no closed trades in AMD" and lists the open position | `rerun/c2` and `c2`, `earnings prep` |
| P5 chart toolbar and Reporting soon link under 44 px | FIXED (see F2 for what is left) | `c1`, `c2` layout |
| P6 Formulas tour opened on step 2 | FIXED. Opens on step 1 at all three widths | `c2`, `tour: formulas-rollups` |
| P7 honesty with a prerequisite off | FIXED. Draft says "Plan grading is switched off, so this draft has no discipline record."; the board says "Drawing a plan on a chart is switched off, so no new setup can be added here yet." | `c3` |
| P8 empty sample folders left behind | FIXED. After Remove it the folder list is only the member's own "Daily" | `c2`, `remove sample`, `folders_after` |
| P9 Example card promised a match | The Example card no longer has a "Find more like" button. Its replacement sentence was not read by the walk | `c2`, `find similar` |
| the default-account 500 on a first Journal page | Not seen: 3 new members, no 5xx | `c1`, `live: first Journal page` |

## 4. Per-feature table (final)

PASS, FAIL-PRODUCT, FAIL-INSTRUMENT, NOT RUN. Widths in px.

### Configuration 1 (switches as production has them)

| feature | 1280 | 820 | 390 | note |
|---|---|---|---|---|
| every wave switch OFF in the auth payload | PASS | PASS | PASS | |
| first run: welcome, no wave surface | PASS | PASS | PASS | |
| create a note, type, reload, search, delete | PASS | PASS | PASS | |
| no wave entry in the slash menu, chart toolbar, property types, template picker | PASS | PASS | PASS | |
| no wave surface on 14 pages (Research Home, positions, trades, trade and position pages, Insights and its links, playbook and setups routes, research workspace, Help, navigation) | PASS | PASS | PASS | |
| sample: exactly the five wave-8 notes | PASS | | | |
| a new member's first Journal page: no 5xx | PASS | PASS | PASS | |
| Today button | PASS | PASS | PASS | |
| built-in templates (33) and the walkthrough toggle in a template-made note | PASS | PASS | PASS | |
| Trade Plan template: properties once, existing values kept | PASS | PASS | PASS | |
| click a chart selects it; Delete removes it | PASS | n/a | n/a | |
| chart toolbar is one Tab stop | PASS | n/a | n/a | 11 controls, 1 tabbable |
| editor toolbar is one Tab stop | NOT RUN (instrument) | | | the walk's selector matched the chart toolbar twice |
| drag a chart block | UNSETTLED (F3) | n/a | n/a | |
| Block actions: Move up, Remove block; toolbar controls at least 44 x 44 | n/a | PASS | PASS | |
| the two Log Trade dialogs on the first click | PASS | PASS | PASS | |
| upload limits answer with a sentence (image, CSV, attachment) | PASS | PASS | PASS | 413 each, request and response in `api_writes` |
| import wizard: two files become notes; a second import adds none | PASS | PASS | PASS | "Will create 0, update 0, unchanged 2" |
| share a note, public page signed out | PASS | PASS | PASS | |
| skip links | FAIL-PRODUCT (F1) | n/a | n/a | two of three work |
| "Search Notebook" from the command palette | PASS | n/a | n/a | focus lands in the search box |
| keyboard move between Journal and Notebook pages: focus in the page content | PASS | n/a | n/a | Notebook, Insights, Trades |
| Settings voice telemetry tile | PASS | PASS | PASS | |
| UNPAID account: 7 pages go to `/subscribe`; 8 routes answer with no 500 | PASS | n/a | PASS | |

### Configuration 2 (everything on, a fresh empty account)

| feature | 1280 | 820 | 390 | note |
|---|---|---|---|---|
| first run: welcome, preview, sample promotion, Get started | PASS | PASS | PASS | |
| add the sample; its 8 example checks (AAPL plan with three levels, role buttons and Arm alert shown; Example labels on playbook cards and board cards; NVDA notice in the note only; TSLA excerpt; GOOGL passed setup; AMZN draft and its Open door) | PASS | | | role buttons and Arm alert were seen, not pressed, on the sample plan |
| Get started ticks on real actions, survives a reload, Hide stays hidden | PASS | | | |
| one-time offer; Help Walkthroughs and What's new | PASS | | | |
| template gallery: browse, insert, publish for review, admin queue | PASS | | | |
| formulas | PASS | PASS | PASS | |
| chart plan: insert, draw, roles, sizing, alert | PASS | PASS | PASS | 820 and 390 by layout pass |
| entry context card; "why" saved and still there after a reload | PASS | PASS | PASS | the tool's FAIL row is a walker defect: the text is on the card after the reload |
| thesis chips on Open Positions rows (the member's own thesis) | PASS | PASS | PASS | present at all three widths once the awareness scan had projected the note; the tool's earlier FAIL row looked before that scan |
| setups board (IBM, AMD, and the two Example cards) | PASS | PASS | PASS | |
| find similar with a member's own tagged chart, after an overnight run | PASS | | | CRWD, "100 match" |
| find similar on an Example card | FAIL-INSTRUMENT | | | the button is gone from Example cards; the walk waited for it |
| transcript passage capture | PASS | PASS | PASS | |
| passed setups: listed, add, scored, remove | PASS | PASS | PASS | |
| passed setups: five rows and Show all | NOT RUN | | | the member had two passed names |
| resurfacing: notices, "What you wrote then", the explainer on first open | PASS | | | later opens: explainer not shown again, as designed |
| plan grading, Unplanned chip, Discipline tab | PASS | PASS | PASS | |
| technical fingerprint, visual playbook, before and after | PASS | PASS | PASS | |
| My Playbook | PASS | PASS | PASS | |
| earnings prep: Reporting soon, one-click note, the trade's percent | PASS | PASS | PASS | percent confirmed in `rerun/c2` |
| review drafts: daily, weekly, monthly | PASS | PASS | PASS | |
| layout pass over 19 pages: no sideways scroll, no boundary, no small control in a wave surface | PASS | PASS | PASS | |
| remove the sample in one click; nothing left in lists, search, stats, export, folders | PASS | | | |
| a member's own folder named "Sample notebook" survives removal | NOT RUN | | | the folder API refused a second folder of that name while the sample's existed (400) |
| writing help, Ask, AI actions, meaning search itself, dictation, the Compass quote, the morning briefing read aloud | NOT RUN, NO KEY | | | |

### Tours (Replay from Help; shown / declared steps)

All 19 open on step 1 at all three widths, with Back, Next, Escape, tap floor, keyboard reach,
focus trap and the card's accessibility scan passing.

| tour | 1280 | 820 | 390 | note |
|---|---|---|---|---|
| writing-help, publish-share, review-drafts, ta-fingerprint, chart-plan-replay | 4/4 | 4/4 | 4/4 | |
| task-reminders, meaning-search, passed-setups | 3/3 | 3/3 | 3/3 | |
| template-gallery | 4/4 | 4/4 | 4/4 | |
| plan-grading, my-playbook, transcript-capture | 5/5 | 5/5 | 5/5 | |
| chart-plan-basics, visual-playbook | 6/6 | 6/6 | 6/6 | |
| image-docx-import | 2/5 | 3/5 | 5/5 | the other steps are phone-only by design |
| formulas-rollups | 4/5 | 4/5 | 4/5 | `rollup` anchor off screen; FAIL-INSTRUMENT on the walk's step-count check |
| entry-context | 2/4 | 2/4 | 2/4 | `why` and `save` had no anchor on the newest trade's card |
| setups-board | 4/5 | 4/5 | 4/5 | `templates` skipped |
| earnings-prep | 3/4 | 3/4 | 3/4 | the Create step is gone once the prep note exists |
| note-resurfaces (explainer) | PASS on first open | | | |

### Configuration 3 (a dependent without its prerequisite)

| check | 1280 | 820 | 390 | what the page said |
|---|---|---|---|---|
| visual playbook without fingerprint | PASS | PASS | PASS | no door; before and after: "No frozen plan for this trade, so only the fills are drawn." |
| setups board without chart plan | PASS | PASS | PASS | "Drawing a plan on a chart is switched off, so no new setup can be added here yet." |
| review drafts without plan grading | PASS | PASS | PASS | "Plan grading is switched off, so this draft has no discipline record." |

### The 10 FAIL rows that are walker defects

c2: thesis chips (looked before the scan), find similar on an Example card (button removed),
earnings percent (the step ran before the close; passed in the re-run), formulas tour x3 (the
walk's count of declared steps against the card's), "why" save (wrong marker; the text
persisted), the same-name folder (creation refused). Re-run c2: the same chips timing, and the
AMZN draft door (that partial run had no sample).

## 5. Asked for and not walked

- The confirm button as the top element at 390 for: bulk trash, folder delete, saved view delete
  (also from Research Home and beside an open note), version restore, gallery unpublish. Only
  the note Delete and the sample's Remove it were walked.
- The sample chart plan's role buttons and Arm alert pressed (they were seen, not pressed).
- The Example card's "never matched" sentence; five passed-setup rows and Show all; the editor
  toolbar's single Tab stop; a member's same-name folder surviving removal.
- The published-note page's stripped formatting; the thesis chip sheet on touch; the Positions
  phone card, beyond the layout pass.

## 6. Not verifiable here

- Anything behind a model key: writing help, Ask, AI actions, meaning search, dictation and
  voice notes, the Compass quote in a review draft, "read me the morning briefing".
- Real devices: this is Chromium with a touch viewport, not Safari or a phone.
- Screen readers: announcements were not listened to; only roles, focus and the card scan.
- Live vendors and the real scheduler: overnight jobs and the awareness scan were run by hand in
  a child process against the sandbox's data.
