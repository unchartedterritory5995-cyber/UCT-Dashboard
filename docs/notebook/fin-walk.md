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
*Status (2026-10-08):* the destination select and the checkbox rows were fixed by lane KEYS3 round 3
(`ImportWizard.module.css`, the ≤1024 px block); the "All" button is the import wizard's per-group
"All"/"None" control and got its 44 px width floor on `feat/notebook-fin-polish`
(`a11y/targetFloors.test.js`, "the import wizard's bulk buttons"). The 20 px checkbox box is by
design: its hit area is the 44 px label row it sits in.

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

## 7. Keyed walk: the AI features against real models (`213850e1fa`)

The owner authorised two model keys for sandbox walks. This closes the "NOT RUN, NO KEY" rows
above. Tool: `tools/notebook_fin_walk.py --config keyed` with `tools/notebook_fin_walk_keyed.py`,
started through the key helper. Raw evidence: `evidence/fin-walk/keyed-213850e1fa/keyed/`
(committed before this section). Tip: `origin/feat/notebook-w14-land` at `213850e1fa`, frontend
rebuilt from it.

- Snapshot rail: `SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN,
  post-prewarm (+120s) CLEAN, shutdown CLEAN; 62 db files hashed`.
- Boot output: `Model keys : OPT-IN -- passed through unchanged`, `Kill-list : 38 scheduler /
  outbound flags`, email disabled (no Resend key). Voice notes and meaning search were on in the
  sandbox only.
- Keys: never read, printed or stored by the walk. The evidence was searched for `sk-`, `sk-ant-`,
  `Authorization`, `Bearer` and vendor secrets: no hit. The voice session answer holds a
  short-lived vendor secret, so only its key names were kept.
- Only made-up notes, trades and synthesised speech went to the vendors. About 45 model calls in
  the committed run, and about as many again while the walk was being written.
- 44 steps: 37 PASS, 5 FAIL, 1 NOT RUN, 1 INFO. 0 page errors, 0 error boundaries, 0 sideways
  scroll, no unexpected failed request.

### 7.1 Invented facts

**None found.** Every number and proper noun in every Ask answer was compared with the note or
file text. At 1280 and 390, asked for a dividend yield and a chief financial officer the note does
not hold, Ask answered "I couldn't find anything in your notebook about that" and named only what
the note does cover. Autofill's three suggestions each quoted the words in the note they came from.

One false statement that is not a number or a name is listed first below (K1).

### 7.2 PRODUCT findings

**K1. Ask the Notebook tells the member their notes are cut off. They are not.** (MODERATE)
- Steps: two short notes about CRWD (4 and 3 sentences). Research Home, Ask, "What have I written
  about CRWD: my planned entry, and what I did after the report?"
- Answer, 1280: "The catalyst noted was the Falcon Flex [2] (the note cuts off before further
  detail on the catalyst)" and "both appear truncated at the end, so I don't have the full
  picture". The notes are whole. The passage handed to the model is shortened, the model reports
  that as a defect in the note, and it leaves out what the note goes on to say (the renewal cycle;
  the stop raised to breakeven). Seen in two runs. Ask this note (one note) did not do it.
- The same sentence is carried into the note by the insert door.

**K2. The one-click weekly review draft never shows the Compass quote.** (MODERATE)
- Steps: one account, four closed trades this week, a Compass weekly review generated for the
  week (HTTP 200). Research Home, click the weekly draft. The page asks
  `GET /api/j2/review-drafts/weekly?weekStart=2026-10-05` with no account id. The answer has
  `compassText: null` and `compassOmitted: null`, and the note has no Compass block.
- The same request with `accountId=<the member's one account>` returns the quote. So the quote
  exists only for a request the page does not make. Nothing tells the member why it is missing.
- The 13F check itself passes on the request that does carry it: the quote (ends in an ellipsis)
  is an exact substring of the stored Compass review.

**K3. Ask answers show raw `**` marks.** (MINOR) The model writes Markdown bold. The Ask panel and
the inserted block show the asterisks as text ("**Planned entry (breakout plan):**"). 1280, both
Ask scopes.

**K4. An AI action for a new tag is planned one time and refused the next.** (MINOR, model
behaviour) `Tag my two CRWD notes with "crowdstrike".` gave two changes, three times. `Tag my two
CRWD notes with "security".` at 390 gave "Review 0 proposed changes" with the reason "The tag
"security" doesn't exist in the workspace's allowed tag list". Neither tag existed. The empty plan
still shows an "Apply 0 changes" button.

**K5. The spoken morning briefing cuts the weekly focus mid-word.** (MINOR)
`POST /api/voice/exec` `play_my_morning_briefing` returned a script ending "...a month of
unlabeled ones. Af Tap me when you're ready to dig in."

**K6. Ask over a member's own Word file adds a line that the question is off topic.** (MINOR) The
answer was right and cited the file, then added "this appears unrelated to markets or trading ...
I'm the UCT research desk".

**K7. Touch sizes on AI surfaces at 390.** (MINOR) The citation chip in an Ask answer is 32 x 44.
The "Full transcript" fold in a voice note is 29 tall.

Seen once in a development run that is not in the committed evidence: the same recording gave
"No tickers were mentioned" beside a summary naming NVIDIA and Tesla. The committed run found
both tickers at both widths.

### 7.3 Table

| # | feature | 1280 | 390 | note |
|---|---|---|---|---|
| 1 | Ask this note: answers from the note and cites | PASS | PASS | |
| 1 | the citation lands on the right passage | PASS | PASS | the paragraph with the stop is selected and in view |
| 1 | a question the note does not answer | PASS | PASS | says so; nothing invented |
| 2 | Ask the Notebook: cites both notes | PASS | PASS | see K1, K3 |
| 2 | insert into a note, provenance shown | PASS (the row reads FAIL: instrument) | door offered | the block is labelled "From Ask Notebook", dated, with its two citations; the walk also looked for the note titles inside the block |
| 3 | Writing help: Summarize, accept, undo | PASS | PASS | "Written by claude-sonnet-5" in the panel; block "Compass, Summarize, model, time"; undo restores |
| 3 | Rewrite shorter, discard | PASS | PASS | note unchanged |
| 3 | Continue writing, accept, undo | PASS | not walked | |
| 3 | Translate (Spanish), discard | PASS | not walked | |
| 4 | Ask over a Word file | PASS | not walked | through our ask door as the member, not the preview sheet; cites `zebra-memo.docx, p.1` |
| 4 | Ask over an image with text | NOT RUN | | no OCR engine on this machine (Tesseract is not installed); the image became a document with status `no_text`. Image text is read locally, not by a model. The walk's row reads FAIL: instrument |
| 5 | AI actions: plan shown, a checkbox per change | PASS | FAIL-PRODUCT (K4) | |
| 5 | nothing changes before approval; declining changes nothing | PASS | PASS | |
| 5 | approving applies exactly what was ticked | PASS | not walked | one of two unticked; only the ticked note gained the tag |
| 5 | undo reverses it | PASS | not walked | |
| 5 | move to a folder, then undo | PASS | not walked | |
| 6 | Property autofill | PASS | PASS | nothing written before Accept; only the accepted property changed |
| 7 | Compass quote is an exact substring of the review | PASS | n/a | on the request that names the account |
| 7 | the drafted weekly note shows the quote | FAIL-PRODUCT (K2) | n/a | two rows |
| 8 | Dictation: speech comes back as the sentence | PASS | n/a | server door; offline synthesised speech |
| 8 | the cleanup pass | PASS | n/a | "Nvidia" became "NVDA"; meaning kept |
| 9 | Voice note: transcript, AI-labelled summary, tickers become a note | PASS | PASS | |
| 10 | Meaning search | PASS | PASS | "rest and fatigue hurting judgement" shares no word with "Bedtime rule"; row says "Related by meaning"; plain search finds nothing. Sweep run by hand |
| 11 | voice session door mints a session, offers the briefing tools | PASS | n/a | |
| 11 | `POST /api/voice/exec` briefing tools | PASS | n/a | both answer with the tool's result (a script; no audio in the answer). See K5 |
| 11 | a live realtime voice session | NOT RUN | | no microphone or speaker in a headless browser |

Not exercised: the Compass notes tool inside a live voice or chat session; the document preview
sheet's own Ask button; real devices; screen readers.

## 8. Keyed re-walk of the K1 to K7 fixes (`dda0515427`)

Tip: `origin/feat/notebook-fin-ai` at `dda0515427` (holds master at `2265f4ac3b`). Walk branch
`feat/notebook-fin-ai-walk`: that tip plus this lane's tools and evidence. Frontend rebuilt from
it. Tool: `tools/notebook_fin_walk.py --config keyedai` with
`tools/notebook_fin_walk_keyed_ai.py`, started through the key helper. Raw evidence, committed
before this section: `evidence/fin-walk/keyed-ai-dda0515427/keyedai/` and
`.../keyed-ai-dda0515427/rerun/keyedai/` (the review-draft scenarios, run again after a walk
setup error).

- Snapshot rail, both committed boots: `SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN,
  post-boot (+15s) CLEAN, post-prewarm (+120s) CLEAN, shutdown CLEAN; 62 db files hashed`.
- A development boot that I held while writing the walk was stopped by force after 120 s and wrote
  no shutdown checkpoint. Its three earlier checkpoints were CLEAN, its log has no blocked-write
  banner, and the newest file under `C:\data` is still the owner's own 6:00 am bars job of
  10-07. That boot's evidence is not committed.
- Keys: only through the helper, never printed or stored. Evidence searched for `sk-`, `sk-ant-`,
  `Authorization`, `Bearer` and vendor secrets: no hit.
- Main run: 44 steps, 32 PASS, 8 FAIL, 2 NOT RUN, 2 INFO. Re-run: 8 steps, 0 FAIL. 0 page errors,
  0 error boundaries, 0 sideways scroll, no unexpected failed request.

### 8.0 A cost the keyed boots carried that was not part of any walk

With the model keys passed through, the app's own background profile writer
(`api/services/stock_brief/service.py`, on by default, `claude-sonnet-4-6`, capped at 300 a day
per process) called the model for ticker after ticker. The launcher's kill-list does not cover
it. Counted from the sandbox logs (`stock_brief profile generated`): 162 in the first keyed
development boot, 59 in the committed keyed run of section 7, 225 in this section's development
boot. **446 model calls nobody asked for**, all about public tickers, no member or made-up
note text. From then on the keyed configs set `STOCK_BRIEF_ENABLED=0` (a real read site); the
two committed boots of this section show 0. Anyone booting a sandbox with
`HUB_SANDBOX_ALLOW_MODEL_KEYS=1` will meet the same thing until the launcher's kill-list names it.

### 8.1 Invented facts

**None found.** Every number and proper noun in every answer was compared with the notes or the
file. Three walk false alarms were removed first ("CRWD-related", "I'm", and the word SEARCHED,
below).

### 8.2 What is NOT fixed

**K1, long note: a question that spans a long note gets "I couldn't find that in your
Notebook."** (MODERATE; 5 of 5 at 1280 and 390, and again in development)
- Steps: a 1,878 character note "PLTR deep dive" (17 sentences; entry 26.35 and stop 24.85 in
  sentence 5, two risks in 8 and 9, "The final rule for this trade: no adds until the stock
  closes above 28 for two days in a row." last). Research Home, Ask, "What have I written about
  PLTR: the entry, the stop, the risks, and my final rule for the trade?"
- Answer: "I couldn't find that in your Notebook." No citation.
- Our server's answer for the same question: one source, "PLTR deep dive", and the passage it
  carried was 151 characters, the note's first two lines.
- Each part alone is answered: "What is my planned entry and my stop for PLTR?" gives 26.35 and
  24.85 with a citation (4 of 4), and "What is my final rule for the PLTR trade?" gives the
  rule with a citation. So the note is found, one short passage of it is read, and a question
  whose answer is spread over the note is told the Notebook does not have it.
- What IS fixed for the long note: it is never called cut off, truncated or unfinished. Two of
  the six answers said "this is from an excerpt of a longer note".

**K7, in part: two chips side by side were not seen.** Five chips in the phone answer, each
44 by 44, none overlapping, but each sat on its own line. The fix is confirmed for size; the
adjacent-chip case did not come up in this answer.

Nothing else from K1 to K7 is open.

### 8.3 Smaller things seen on the way (not K items)

- An answer said "the SEARCHED line indicates 1 attached document could not be searched". That
  is the prompt's own label shown to the member. Once, in development.
- The briefing script reads the weekly focus with its Markdown marks: "- **Label every setup
  before you enter.**". It now stops at a sentence end, but it says "Two asks for next week" and
  then gives one.
- Research Home shows no "Ask" button for a member who has three notes and has not opened one
  yet (0 buttons before, 1 after opening them). The quiet state of the page leaves it out.
  *Fixed on `feat/notebook-fin-polish` (2026-10-08):* the quiet state and the quiet-with-error
  state render the same Ask door as the full home, at the same tree position
  (`ResearchHome.quietAsk.test.jsx`, which also proves the door survives the quiet-to-full flip).
- From the whole Notebook a citation opens the cited note, not a passage in it. Inside a note it
  lands on the passage. Both are as built; only the second is a passage landing.
  *Fixed, on master as #289 `01a38df644` (2026-10-09):* the whole-Notebook citation now carries
  its passage (note id, server location, the text at the range) through `NotebookTab.openNote`'s
  history state, and `NoteEditorPage` verifies it against the live doc and lands through the same
  `selectResolvedPassage` the in-note Ask uses; a passage the note no longer holds opens the note
  at the top, silently (`NotebookTab.citationLanding.test.jsx`, `openCitation.test.js`). The
  server packet adds `location.text` so the landing is the matched term, not the whole excerpt.
- A new member's "Default" account is not a stored account until it is used: an account made
  before the first trade replaces it. That was my setup error in the first run.

### 8.4 Table

| item | check | 1280 | 390 |
|---|---|---|---|
| K1 | two short notes: no "cut off / truncated / incomplete / unfinished", and the renewal cycle and the breakeven stop are in the answer; run twice | PASS, PASS | PASS, PASS |
| K1 | cites both notes; a citation opens the cited note | PASS | PASS |
| K1 | long note, a fact near its start; run twice; never called defective | PASS, PASS | PASS, PASS |
| K1 | long note, a question across the whole note; run twice | FAIL-PRODUCT x2 (8.2) | FAIL-PRODUCT x2 |
| K1 | long note, the last line asked alone (our server door) | PASS | n/a |
| citations | inside a note the chip lands on the paragraph with the stop, selected | PASS | PASS |
| K2 | one account, four trades, a Compass weekly review: one click from Research Home shows the quote; exact substring of the stored review | PASS (page asks with `accountId`) | PASS (the note shows the block) |
| K2 | no review: "Compass has not written a review of this week, so none is quoted here." | PASS | n/a |
| K2 | monthly draft: no "What Compass said" heading | PASS | n/a |
| K2 | two accounts, All accounts chosen: "You have several accounts and none is chosen. ... Choose an account to see its review." | PASS (re-run; the first run's setup made one account) | n/a |
| K3 | bold renders as bold, no raw asterisks, in the Ask panel | PASS (7 bold runs) | PASS (5) |
| K3 | the same in the block inserted into a note, and in the saved note | PASS | not walked |
| K3 | chips still open the right source (panel; inserted block) | PASS | PASS (panel) |
| K4 | `Tag my two CRWD notes with "security".` gives two changes | PASS, PASS | PASS (three in a row in all) |
| K4 | an impossible request: "Nothing to change", no Apply button | PASS | PASS |
| K5 | briefing script: every piece ends on a whole sentence; weekly focus not cut mid-word | PASS (both boots) | n/a |
| K6 | Word file, a subject that is not markets: cited answer, no off-topic remark; run twice | PASS, PASS (our server door) | n/a |
| K6 | the same from the document's own sheet | NOT RUN: a file uploaded through the attachments door is not shown in the note body, so the walk had nothing to click | |
| K7 | Ask panel chips at least 44 by 44, none overlapping | n/a | PASS (5 chips; none adjacent, see 8.2) |
| OCR | Ask over an image with text (8.5) | PASS, PASS (our server door) | n/a |

The 8 FAIL rows of the main run: 5 are the long-note finding (4 browser rows and the server
row), 2 are "no chip to click" rows that follow from it, 1 is the two-account setup error
(instrument; PASS in the re-run).

### 8.5 The image question: walked, with a correction

Section 7 said Tesseract is not installed on this machine. **That was wrong.** The program is
installed at `C:\Program Files\Tesseract-OCR\tesseract.exe` (5.4.0, with English data). It is
not on `PATH` and `TESSERACT_BINARY` was not set, and those are the only places the app looks
(`api/services/journal_two/document_ocr_tesseract.py` `binary_path()`: `TESSERACT_BINARY`, then
`PATH`, then `/usr/bin` and `/usr/local/bin`). So the earlier boots said
`[startup] j2-ocr: flag=1 binary=absent active=False`.

With `TESSERACT_BINARY` pointed at the installed program for the sandbox only, the boot says
`binary=C:\Program Files\Tesseract-OCR\tesseract.exe version=tesseract_v5.4.0.20240606
active=True`. Evidence: `evidence/fin-walk/keyed-ai-dda0515427/ocr/keyedai/` (integrity CLEAN at
all four checkpoints).

| check | result |
|---|---|
| an image with three lines of text becomes a document, status `ready` in 7 s; the page text door returns "ACME FASTENERS / INVOICE 4471 / TOTAL DUE 912 DOLLARS", `textOrigin: ocr` | PASS |
| Ask over the image, run 1: "total due of 912 dollars and an invoice number of 4471 [1]" | PASS |
| Ask over the image, run 2: the same facts, cited | PASS |
| invented facts | none |

Through our server's ask door as the member, at one width (the door has no width). The citation
is `Image, p.1`, marked `page_only`. Not walked: the document's own sheet in the browser.
