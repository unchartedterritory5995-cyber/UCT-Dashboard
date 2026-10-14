# Notebook P2 Tier 2 (part A): `/plan`, Plain-English Alerts, Screenshot Smarts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three helpers that save typing in a note. `/plan NVDA` makes a Trade plan note for NVDA, already filled with the price, the member's own levels and their usual blocks, and links it where they typed. A sentence like "alert me if NVDA closes below 120" shows a small "Set alert" chip, and one tap opens a sheet already filled in. A pasted chart screenshot is read, and if it clearly shows one ticker and a timeframe, a chip offers "Tag NVDA · Daily". Nothing happens without the member's tap.

**Architecture:**
- **`/plan` is a styled create with one extra step on the server.** The client sends `createNoteViaApi({ kindId: 'trade_plan', ticker, planPrefill: true })`. The server composes the member's default Trade plan style exactly as P1 does. Then a new `plan_prefill` step adds three things to the same body before the ONE insert: a dated price line, the member's own entry, stop and target (from their newest note about that ticker, read by `plan_extract`, the one reader of plan levels) drawn on the chart and set in the sizing block, and a link back to the note those levels came from. The editor links the new note at the caret, like `/canvas` does.
- **Alerts: parse locally, confirm on the server, set only on a tap.** A pure parser (`alertPhrase.js`) reads the caret's paragraph. A ProseMirror plugin (`alertPhraseOffer.js`) holds the offer. A menu (`AlertPhraseMenu.jsx`) asks one new read route whether the word is really a ticker (`buzz_extract.extract`, the resolver that already knows RS, EMA, MA, GAP and PEG are not tickers in prose). Only then does it show the chip. The chip opens `TextAlertSheet.jsx`, a thin sheet over the two existing alert routes: `/api/indicator-alerts` (close, daily or weekly) and `/api/watchlist-alerts` (intraday).
- **Screenshots: wait for the OCR that already runs, then offer.** After an image paste, a bounded poll waits for the image's document to finish OCR (the pipeline already runs it). It reads page 1's text and sends the top of it to the same ticker route. It offers the tag only when exactly one ticker is found. Accepting labels the image (its `alt`, an editor transaction) and, if the note has no ticker yet, sets it through the existing metadata door.
- **One new switch.** `NOTEBOOK_SMART_CHIPS_ENABLED` (enablement, default off) gates the two chips and the ticker route. `/plan` rides `NOTEBOOK_JOURNAL_STYLES_ENABLED` (already armed), because it is a styled create.

**Tech Stack:** FastAPI + SQLite (`auth.db`, `j2_` tables), React + Vite, TipTap 3 (3.23.6), vitest + Testing Library, pytest, Python Playwright, NVDA (the owner's box only, muted).

**Spec:** `docs/superpowers/specs/2026-10-11-notebook-journal-styles-design.md`, §P2 Tier 2 items 8, 9 and 10 (lines 264-272), §6 cross-cutting requirements (lines 361-378). Code map of what exists: `C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\61625d99-f8db-4269-a728-231c08d3da11\scratchpad\tier2-code-map.md` (sections 0-3 and 6). Part B (item 11, earnings follow-up; item 12, the due-date block) is a separate later plan.

**Base:** `origin/master` at Task 1 (it records the SHA). One integration worktree `C:\Users\Patrick\uct-worktrees\notebook-t2a`, branch `notebook-t2a-assists`, written with a `.uct-session-owner` file. Tasks run one at a time in that worktree (no lanes: the tasks share `NoteEditorPage.jsx`, and implementers never run in parallel).

## Rulings this plan makes (each also in the PR body)

Each reads **Ruling: what — why — cost if wrong.**

- **R-T2A-1, where `/plan`'s levels come from.** Ruling: the levels are the MEMBER'S OWN entry, stop and target for that ticker, read by `plan_extract.read_note_plan` from their newest live, non-sample note whose ticker is that symbol (scan at most 20 notes, newest first, stop at the first that names any of the three). They are drawn on the new note's chart as plan lines (`plan_extract.plan_annotation`) and set as the sizing block's `entry` and `stop`. A line under the first heading says where they came from and links that note. With no earlier plan, the chart and sizing stay empty. Why: the spec's "key levels from the chart plan engine" has no ticker-keyed level source. The chart plan engine reads levels a member DREW, and automatic levels are deliberately withheld (Seam 28: `grade_ticker` returns SKIP/no_setup). Copying the member's own plan is the only honest fill. Cost if wrong: a member who wanted computed levels sees an empty chart, the same as today's Trade plan.
- **R-T2A-2, the price is a dated text line.** Ruling: `/plan` adds "Price when planned: $182.40 (live price, Oct 14, 10:31 AM ET)" as a plain paragraph under the first heading, read once by `trader_blocks.price_stamp_quote` inside the create's read budget. If the read is slow or fails, the line is left out, never a blank or a zero. The sizing block's `entry` is NOT seeded with the price. Why: a `financialFact` node needs a fact row keyed to the note id, which does not exist before the one insert. A second write after the insert is the follow-up write P1 forbids. The price is a snapshot, not the member's entry. Cost if wrong: the price is text, not a fact chip. A member can still type `/price` in the new note for a live fact.
- **R-T2A-3, `/plan` honours the member's style.** Ruling: `/plan` uses the member's default Trade plan style as it is. If they removed the sizing block or the checklist from that style, `/plan` does not add it back, and the levels then go only on the chart. Why: the style is the member's choice, and the spec's "the sizing block and the checklist" describes the built-in style, which has both. Cost if wrong: one sentence in the toast, if the owner wants them forced.
- **R-T2A-4, no existing alert sheet takes a pre-fill, so one thin sheet is added.** Ruling: `B/TextAlertSheet.jsx` is a new sheet on `components/mobile/Sheet.jsx`. Every editable field is filled in and the member presses "Set alert". It creates through the existing paths: `alertCommand.setAlert` for intraday, and `createIndicatorAlert` for closes. It reuses their typo guard (`MAX_DISTANCE`) and their refusal sentences. Why: TickerActions, TickerHubSheet, AlertsWidget and IndicatorAlertPopover all keep their fields in internal state, and none is a standalone sheet (code map §2a). Refactoring a shared context menu to take props would reach far beyond the Notebook. Cost if wrong: a fourth alert form to keep in step. It holds no create logic of its own.
- **R-T2A-5, "closes" means a closed-bar alert.** Ruling: "closes above/below N" becomes `POST /api/indicator-alerts {sym, indicator: 'close', condition: 'above'|'below', threshold: N, tf: 'D'|'W'}` (closed-bar by default, `ALERT_EVAL_MODE == "closed"`). Any other verb ("trades, drops, hits, breaks…") becomes `POST /api/watchlist-alerts`. The sheet shows the mode in words and lets the member switch it. Why: the two alert products already split exactly here (code map §2b). Cost if wrong: a member who meant "touches" gets a close alert, but the sheet names the mode before they press.
- **R-T2A-6, the ticker is confirmed by the server's resolver, never guessed in the browser.** Ruling: new route `POST /api/j2/smart-chips/tickers {text}` (text at most 2,000 characters) returns `buzz_extract.extract(text)` as `{tickers: [{symbol, tier}]}`. It never stores or logs the text. The alert chip appears only when the parsed word is in that list. "it", "the stock" and "price" mean the note's own ticker. Why: `app/src/lib/tickerResolver.js` says a browser that guessed bare words "would be a second resolver", and only the server knows RS/EMA/MA/GAP/PEG are words in prose. Cost if wrong: one round trip (cached per sentence) before the chip shows.
- **R-T2A-7, a screenshot's ticker must be unambiguous.** Ruling: only the first 400 characters of page 1's OCR text are checked (a chart's header lives there). The offer is made only when the route finds exactly ONE symbol at the cashtag, alias or exact tier. With zero, two or more symbols, or only contextual (lowercase) matches, no offer appears. Why: OCR of a chart holds axis numbers, indicator names and exchange names, and a wrong tag is worse than none. Cost if wrong: some screenshots that a person could read get no offer.
- **R-T2A-8, the timeframe goes on the image, the ticker on the note.** Ruling: accepting "Tag NVDA · Daily" sets the image's `alt` to "NVDA daily chart" (an editor transaction, the note's own save path). If the note has no ticker, it also sets it to NVDA through the metadata door (`update` + `settleMetadataRevision`). A note that already has a DIFFERENT ticker keeps it, and the chip then reads "Tag image NVDA · Daily". Why: no note-level timeframe exists. A new property would bring the saved-view rails and a schema-adjacent change for one word. The `alt` names the screenshot itself, and screen readers read it. Cost if wrong: a member searching notes for "daily" finds the alt only if search reads it (Task 1 V8 answers that).
- **R-T2A-9, ambiguous timeframe tokens are ignored.** Ruling: the grammar accepts `1D`, `D` (uppercase only), `Daily`, `1W`, `W` (uppercase only), `Weekly` and `Monthly`, and for intraday `1h`, `4h`, `1H`, `4H`, `60m`, `5m`, `15m`, `30m` and the forms `5 min`, `15min`, `30 min`. It ignores `1M` and `M` (minute or month) and every bare number. With exactly one distinct timeframe, the chip shows it. With none or a conflict, the chip offers only the ticker ("Tag NVDA"). Cost if wrong: a 1-month chart gets "Tag NVDA" with no timeframe.
- **R-T2A-10, the alert chip's keys.** Ruling: while the chip is showing, Alt+Enter opens the sheet and Escape dismisses the chip. The plugin's priority is 50, below every suggestion menu, so an open slash, date or link menu always gets Escape and Enter first. A dismissed sentence is not offered again unless its text changes. A polite live region announces each new offer once. Why: keyboard and screen-reader members need a path that does not depend on the mouse. Enter must never be stolen (dateSuggest's rule: "ENTER ENDS A LINE"). Cost if wrong: Alt+Enter clashes with something Task 1 V10 did not find.
- **R-T2A-11, one switch for both chips.** Ruling: `NOTEBOOK_SMART_CHIPS_ENABLED` (enablement, unset = off) gates the alert offer, the screenshot poll and offer, and the ticker route (one 404 when off). It is read per request on the server and latched per tab in the browser, like every Notebook flag. When it is off, nothing new runs: no plugin work beyond one flag read, no poll, no route. Cost if wrong: arming turns on two features at once, and each has its own walk step.

## Owner decisions this plan surfaces (none blocks the build)

- **O-T2A-1.** Arming `NOTEBOOK_SMART_CHIPS_ENABLED` on `web` after the PR is live. The flip is a Railway variable the owner runs (`! railway variables --service web --set "NOTEBOOK_SMART_CHIPS_ENABLED=1"`). Task 12 hands over the exact command and the checks to run after it.
- **O-T2A-2.** R-T2A-1: whether `/plan` should ever add computed levels. Recommended: no, until the confirmed-levels source (Seam 28) ships.

## Global Constraints

The P2 Tier 1 plans' Global Constraints apply unchanged: `docs/superpowers/plans/2026-10-12-notebook-p2-trader-blocks-t1.md` and `…-p2b-rules-packs-t1.md`. That covers names, paid gate, dark switch, creating-not-rendering, the INTEGRITY RULE, zero schema bumps, ONE-FACT rails, preference keys, gate read paths, key listeners, the settle rule, tests, commits, hygiene, `C:\data`, at most 3 agents, mutation restores, and the junction rule. Restated and added:

- **Worktree.** Everything runs in `$WT = C:\Users\Patrick\uct-worktrees\notebook-t2a`. `app/node_modules` is a junction to `C:\Users\Patrick\uct-worktrees\_nb-shared-install\node_modules`. Create it only after `ls -A` counts **377** entries there. Remove it only with `cmd /c rmdir` from PowerShell, after `Get-Item -Force` shows `LinkType` = `Junction`, then re-count 377.
- **Zero schema bumps.** No new node type and no new node attribute. The image's `alt`, the chart's `annotations`, the sizing block's `params` and `noteLink` all exist. A task that finds it needs a new node or attribute STOPS and reports.
- **No new write door into a note.** `/plan` writes in the styled create's ONE insert. The alert sheet writes alerts, never a note. The screenshot tag writes the note through the editor (the `alt`) and the metadata door (`update` + `settleMetadataRevision`). `J/lib/offline/doorEnumeration.test.js` stays `MODE = 'fail'` and green.
- **No new `document` or `window` key listener** (`app/src/pages/command/keyListenerCensus.test.js`). Keys go through the plugin's `handleKeyDown`. The event that opens the sheet is dispatched on `editor.view.dom` (I5).
- **Typing path.** The alert plugin runs on every transaction. Its `apply` must read only the caret's text block, return the SAME state object when nothing changed (the menu's reducer bails on identity: the TY7 lesson in `LinkPasteMenu.jsx`), and do nothing else when the flag is off. Typing p95 after Task 11 must show no regression against the busy-time baseline: **p95 4.94 / 7.07 / 9.37 ms** at 1 / 1,000 / 2,000 paragraphs (spec §6), plus the with-blocks run. The open item F-LONGNOTE-TYPING (about 16 ms p95 at 2,000 paragraphs in both A/B arms) is the floor this plan must not make worse.
- **Bytes.** The first-open closure (`docs/notebook/perf-budgets.json` → `notebook_first_open.max`, today 2,260,793 B, measured with `python tools/notebook_perf_budgets.py --dist app/dist`) is never raised. This plan's allowance is **+4,096 B** (the plugin, the parser, the flag accessor, the slash item). `AlertPhraseMenu`, `TextAlertSheet`, `ScreenshotTagOffer` and `screenshotRead.js` are lazy chunks. If Task 11 measures more than the allowance, the parser moves behind a lazy stub, as the price stamps' resolver did (IR-S12).
- **Copy.** Plain English, no emoji, `UIcon` names only. Every refusal is a fixed sentence, never a server's `detail` text (`rawErrorSurface.test.js`). The exception is the alert routes' own member sentences, which `setAlert` and `createIndicatorAlert` already pass on. A toast says what happened and what did not ("Nothing was set.").
- **Touch.** Every new control meets `var(--tap-min)` (44 px) at or below 1,024 px (`app/src/styles/tapFloor.test.js`). Breakpoints are 640 and 1,024 only.
- **Tests.** Backend pytest by named files only (`python -m pytest tests/test_a.py tests/test_b.py -q`), never `tests/` and never `-k` alone. Vitest by named files from `$WT/app`. Every verification runs in its own tool call, captures `code=$?` and exits with it, with no pipe and no trailing `echo`. Run the suite, read the totals line, then commit in a separate call.
- **Commits.** `python tools/check_repo_hygiene.py --staged` in its own call, then `git commit -F - -- <paths>` with a quoted heredoc, never `-m`. Trailer lines:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01SQuUWDPpeE8ymPfY82uG1d
  ```
  Push the branch after every task. Never `--no-verify`.
- **Evidence.** Every walk, perf and NVDA run writes its raw output under `docs/notebook/evidence/t2a-<run-id>/` and is committed BEFORE any summary is written (R-RAW).
- **Flags in production are the owner's.** No agent runs `railway variables --set` or `railway variable delete`. Task 12 hands the command to the owner.

## Review Focus

1. **The member types the alert sentence while the slash menu, the `@` date list or the link-paste offer is open.** Escape and Enter go to that menu first. The alert offer survives and is dismissed only by an Escape that nothing else used. Pinned in Task 7, `alertPhraseOffer.test.js` "a suggestion menu gets Escape first".
2. **The ticker route is off, refuses (402), times out, or the network drops.** The chip simply does not appear. Typing is not delayed (the check runs after typing pauses and never blocks a transaction). Nothing appears in the note. Pinned in Task 8, `AlertPhraseMenu.test.jsx` "a failed check shows nothing".
3. **A screenshot is pasted, then deleted, or the member opens another note before OCR finishes.** The poll stops, no offer appears, and nothing is written to the wrong note. Pinned in Task 10, `screenshotOffer.test.jsx` "image gone" and "note changed".
4. **`/plan` for a ticker the member never planned, with a cold price cache, or in a locked note.** The note is created with the style's blocks and no invented numbers, and the price line is simply absent. A locked note refuses with the canvas's sentence and creates nothing. Pinned in Task 4, `test_plan_prefill_without_history_or_price_adds_nothing_invented`, and Task 5, `planCreate.test.jsx` "locked note".
5. **An alert price ten times away from the current price, equal to it, or with no direction word and no current price.** The sheet refuses with the existing sentences and sets nothing, for BOTH the close path and the intraday path (the close path gets the same typo guard). Pinned in Task 8, `TextAlertSheet.test.jsx` "typo guard on both paths".

---

## File map

| File | Responsibility | Tasks |
|---|---|---|
| `docs/notebook/t2a-verify-before-building.md` (new) | citations re-read; V1-V14 answered; base SHA | 1 |
| `api/routers/auth.py`, `J/lib/offline/notebookFlags.js`, `tests/test_notebook_flags.py`, `tests/test_notebook_flag_parse.py`, `docs/feature_flags.json`, `tools/notebook_contract_fixtures.py`, `tools/notebook_fin_walk.py` | the new switch | 2 |
| `J/lib/smartChipsFlag.js` (new) | the client accessor for the switch | 2 |
| `api/routers/notebook_smart_chips.py` (new), `api/main.py`, `tests/test_notebook_smart_chips.py` (new), contract fixture | the ticker route | 3 |
| `api/services/journal_two/plan_prefill.py` (new), `journal_styles.py`, `tests/test_plan_prefill.py` (new) | `/plan`'s server prefill | 4 |
| `J/lib/noteCreation.js`, `J/lib/planCreate.js` (new), `J/lib/journalStylesFlag.js`, `B/SlashMenu.jsx`, `B/NoteEditorPage.jsx` | `/plan` in the editor | 5 |
| `J/lib/alertPhrase.js` (new) + test | the sentence parser | 6 |
| `J/lib/alertPhraseOffer.js` (new) + test, `J/lib/tiptap.js` | the offer plugin | 7 |
| `J/lib/smartChipsApi.js` (new), `B/AlertPhraseMenu.jsx` (new), `B/TextAlertSheet.jsx` (new) + CSS + tests, `B/NoteEditorPage.jsx` | the chip and the sheet | 8 |
| `J/lib/screenshotSmarts.js` (new), `J/lib/screenshotRead.js` (new) + tests | timeframe grammar, ticker pick, the bounded OCR poll | 9 |
| `B/ScreenshotTagOffer.jsx` (new) + CSS + test, `B/NoteEditorPage.jsx` | the screenshot chip | 10 |
| `J/a11y/notebookSurfaces.js`, three axe rails, `tools/notebook_fin_walk_features.py`, `tools/notebook_door_audit_doors.json`, `docs/notebook/screen-reader-pass.md`, `tools/notebook_nvda_pass.py` | the rails | 11 |
| `docs/notebook/t2a-arming.md` (new), PR | gate, walk, PR, arming packet | 12 |

`J` = `app/src/pages/journal-2-0`, `B` = `J/components/notebook`.

---

### Task 1: Verify before building

Every citation in this plan is a dated claim (the code map was written at `a5b5cfffba`). This task re-reads each one on the base and records what it finds. It changes no product code.

**Files:**
- Create: `docs/notebook/t2a-verify-before-building.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the doc. Each V-item gets "confirmed" with a quoted line and `file:line`, or "differs" with the real shape and the task text it changes. The controller rules on every "differs" before Task 2 is dispatched.

- [ ] **Step 1: Make the worktree**

```bash
cd /c/Users/Patrick/uct-dashboard && git fetch origin && git worktree add -b notebook-t2a-assists /c/Users/Patrick/uct-worktrees/notebook-t2a origin/master
printf 'session: 61625d99-f8db-4269-a728-231c08d3da11\ncreated: 2026-10-14\n' > /c/Users/Patrick/uct-worktrees/notebook-t2a/.uct-session-owner
ls -A /c/Users/Patrick/uct-worktrees/_nb-shared-install/node_modules | wc -l
```
Expected: the last line prints `377`. Then make the junction from PowerShell:
```powershell
New-Item -ItemType Junction -Path 'C:\Users\Patrick\uct-worktrees\notebook-t2a\app\node_modules' -Target 'C:\Users\Patrick\uct-worktrees\_nb-shared-install\node_modules'
```

- [ ] **Step 2: Record the base and the reds**

Run (from `$WT/app`) the files every later task will run. Record any red with its first assertion line as "pre-existing at <sha>":
```bash
cd /c/Users/Patrick/uct-worktrees/notebook-t2a/app && npx vitest run src/pages/journal-2-0/lib/offline/doorEnumeration.test.js src/pages/journal-2-0/a11y/surfaceCoverage.test.js src/pages/command/keyListenerCensus.test.js src/components/screener/reachable.test.js src/pages/journal-2-0/components/notebook/SlashMenu.test.jsx > /tmp/t2a-base.log 2>&1; code=$?; tail -5 /tmp/t2a-base.log; exit $code
```
(If `SlashMenu.test.jsx` has another name, V3 records it.)

- [ ] **Step 3: Answer V1-V14 in the doc, each with a quoted line**

| V | Question | Where to look |
|---|---|---|
| V1 | `create_styled_note`'s signature, and that `compose` builds `ctx` with `memo` and starts the budget in create mode | `api/services/journal_two/journal_styles.py` (`def compose`, `def create_styled_note`) |
| V2 | `j2_notes` column names for body and properties (`body_json`? `properties_json`?), and `sample_marker.not_sample_sql()` | `api/services/journal_two/notes.py`, `sample_marker.py` |
| V3 | the slash menu's test file name, and how its tests build an editor | `B/SlashMenu*.test.jsx` |
| V4 | `price_stamp_quote` return shape: `price`, `source`, `asOf` keys and `asOf` format | `trader_blocks.py` (`def price_stamp_quote`) |
| V5 | the router test harness used by `tests/test_notebook_journal_styles*.py` (client fixture, signing in a paid member, flag on/off) | `tests/` |
| V6 | `read_note_plan(body, props, None, sym)`: do property-named levels need `prop_defs`? If yes, how the styles code loads them | `plan_extract.py` (`_property_levels`), `note_properties.py` |
| V7 | the sizing block's node: `attrs.params` keys, and whether `searchText` depends on params (S20: "a block's plain text IS its catalog search line") | `trader_blocks._node`, `registry.js` `positionSizing` |
| V8 | the image node's type name and `alt` attr; whether note search (`searchText`/FTS) reads image `alt` | `J/lib/tiptap.js`, `api/services/journal_two/notes.py` search text builder |
| V9 | `GET /api/j2/notes/{id}/documents` response shape (`{documents: [...]}`?), the document fields (`attachmentUrl`, `status`, `pagesWithText`, `textComplete`), and the page text route's body | `api/routers/journal_two.py` (~4001), `J/hooks/useNoteDocuments.js`, `B/documentKind.js` |
| V10 | any existing `Alt-Enter` / `altKey && key === 'Enter'` binding in the editor or the app | grep `app/src` |
| V11 | `components/mobile/Sheet.jsx` props (`open`, `onClose`, `title`, `variant`), and how its focus trap returns focus | `app/src/components/mobile/Sheet.jsx` |
| V12 | `GET /api/indicator-alerts/catalog`: does address `close` list conditions `below` and `above`; the payload `createIndicatorAlert` accepts (`sym`, `indicator`, `condition`, `threshold`, `tf`) | `api/routers/indicator_alerts.py`, `useIndicatorAlerts.js` |
| V13 | `editor.storage.uctJournalWidgets.notify(text, tone)`: does it accept a success tone | `B/NoteEditorPage.jsx` (where storage is set) |
| V14 | the first-open closure's current size and headroom under 2,260,793 B on the base | `python tools/notebook_perf_budgets.py --dist app/dist` after `npm run build` |

- [ ] **Step 4: Commit the doc**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-t2a && python tools/check_repo_hygiene.py --staged
```
```bash
cd /c/Users/Patrick/uct-worktrees/notebook-t2a && git add docs/notebook/t2a-verify-before-building.md && git commit -F - -- docs/notebook/t2a-verify-before-building.md <<'MSG'
docs(notebook): Tier 2 part A verify-before-building (V1-V14)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SQuUWDPpeE8ymPfY82uG1d
MSG
git push -u origin notebook-t2a-assists
```

---

### Task 2: The `NOTEBOOK_SMART_CHIPS_ENABLED` switch

**Files:**
- Modify: `api/routers/auth.py` (`NOTEBOOK_FLAGS`), `app/src/pages/journal-2-0/lib/offline/notebookFlags.js` (`FLAG_FALLBACKS`), `tests/test_notebook_flags.py` (`NOTEBOOK_KEYS`), `tests/test_notebook_flag_parse.py`, `docs/feature_flags.json`, `tools/notebook_contract_fixtures.py` (flag list ~line 81), `tools/notebook_fin_walk.py` (list ~line 88)
- Create: `app/src/pages/journal-2-0/lib/smartChipsFlag.js`, `app/src/pages/journal-2-0/lib/smartChipsFlag.test.js`

**Interfaces:**
- Produces: server env `NOTEBOOK_SMART_CHIPS_ENABLED`, payload key `notebook_smart_chips_enabled`; client `SMART_CHIPS_FLAG = 'notebook_smart_chips_enabled'`, `smartChipsEnabled(): boolean`.

- [ ] **Step 1: Write the failing client test**

```js
// app/src/pages/journal-2-0/lib/smartChipsFlag.test.js
import { describe, expect, it, beforeEach } from 'vitest'
import { SMART_CHIPS_FLAG, smartChipsEnabled } from './smartChipsFlag'
import { FLAG_FALLBACKS, __resetNotebookFlagsForTests, latchNotebookFlags } from './offline/notebookFlags'

describe('smart chips switch', () => {
  beforeEach(() => { __resetNotebookFlagsForTests?.() })
  it('is an enablement gate: off until the payload says on', () => {
    expect(FLAG_FALLBACKS[SMART_CHIPS_FLAG]).toBe(false)
    expect(smartChipsEnabled()).toBe(false)
  })
  it('follows the latched payload', () => {
    latchNotebookFlags({ [SMART_CHIPS_FLAG]: true })
    expect(smartChipsEnabled()).toBe(true)
  })
})
```
If V-records show the reset helper has another name, use that name. If there is none, test only the fallback and the accessor's `=== true` shape.

- [ ] **Step 2: Run it and see it fail**

Run: `cd $WT/app && npx vitest run src/pages/journal-2-0/lib/smartChipsFlag.test.js; code=$?; exit $code`
Expected: FAIL, `Failed to resolve import "./smartChipsFlag"`.

- [ ] **Step 3: Add the accessor and the fallback**

```js
// app/src/pages/journal-2-0/lib/smartChipsFlag.js
/**
 * Tier 2 part A (R-T2A-11): the alert chip and the screenshot chip. An ENABLEMENT gate:
 * unset means off. Latched per tab like every Notebook capability (offline/notebookFlags.js).
 */
import { notebookFlag } from './offline/notebookFlags'

export const SMART_CHIPS_FLAG = 'notebook_smart_chips_enabled'

export function smartChipsEnabled() {
  return notebookFlag(SMART_CHIPS_FLAG) === true
}
```
In `notebookFlags.js` `FLAG_FALLBACKS`, add `notebook_smart_chips_enabled: false,` beside `notebook_journal_styles_enabled: false`.

- [ ] **Step 4: Add the server row and its rails**

In `api/routers/auth.py` `NOTEBOOK_FLAGS`, beside `"NOTEBOOK_JOURNAL_STYLES_ENABLED": False,  # enablement`:
```python
    "NOTEBOOK_SMART_CHIPS_ENABLED": False,  # enablement (Tier 2 part A: alert + screenshot chips)
```
Add `"notebook_smart_chips_enabled"` to `NOTEBOOK_KEYS` in `tests/test_notebook_flags.py` (not to `KILL_SWITCH_KEYS`). Add the env name to `tests/test_notebook_flag_parse.py`'s list in the same shape as its neighbours. Add the flag to `tools/notebook_contract_fixtures.py` and `tools/notebook_fin_walk.py` flag lists. Add a ledger entry to `docs/feature_flags.json`, copying the `NOTEBOOK_JOURNAL_STYLES_ENABLED` entry's shape with `"status": "dark"`, `"where": "web"`, `"member_facing": "Notebook: alert chip from a typed sentence; tag offer on a pasted chart screenshot"`.

- [ ] **Step 5: Run the rails**

Run: `cd $WT/app && npx vitest run src/pages/journal-2-0/lib/smartChipsFlag.test.js; code=$?; exit $code`
Then: `cd $WT && python -m pytest tests/test_notebook_flags.py tests/test_notebook_flag_parse.py tests/test_feature_flag_ledger.py -q; code=$?; exit $code`
Then: `cd $WT && python tools/flag_ledger_audit.py --offline; code=$?; exit $code` (if `--offline` does not exist, V-record it and run the offline rail it names).
Expected: all pass; totals lines present.

- [ ] **Step 6: Commit**

`python tools/check_repo_hygiene.py --staged` in its own call, then:
```bash
git commit -F - -- api/routers/auth.py app/src/pages/journal-2-0/lib/offline/notebookFlags.js app/src/pages/journal-2-0/lib/smartChipsFlag.js app/src/pages/journal-2-0/lib/smartChipsFlag.test.js tests/test_notebook_flags.py tests/test_notebook_flag_parse.py docs/feature_flags.json tools/notebook_contract_fixtures.py tools/notebook_fin_walk.py <<'MSG'
feat(notebook): NOTEBOOK_SMART_CHIPS_ENABLED switch (dark)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SQuUWDPpeE8ymPfY82uG1d
MSG
git push
```

---

### Task 3: The ticker route

**Files:**
- Create: `api/routers/notebook_smart_chips.py`, `tests/test_notebook_smart_chips.py`, a contract fixture under `app/src/pages/journal-2-0/__fixtures__/contract/` (name per `tools/notebook_contract_fixtures.py`'s convention)
- Modify: `api/main.py` (mount beside the styles router), `tools/notebook_contract_fixtures.py`

**Interfaces:**
- Consumes: `api.services.buzz_extract.extract(text) -> list[tuple[str, str]]`.
- Produces: `POST /api/j2/smart-chips/tickers`, body `{"text": str}` (1 to 2,000 characters after strip). Returns `200 {"tickers": [{"symbol": "NVDA", "tier": "exact"}, ...]}` (sorted as `extract` returns). Refusals: `404` when the switch is off (before the session is read), `401` signed out, `402` free plan, `422` for an empty, non-string or over-long `text`. Service function `tickers_in(text: str) -> list[dict]`.

- [ ] **Step 1: Write the failing service tests**

```python
# tests/test_notebook_smart_chips.py
"""Tier 2 part A (R-T2A-6): the one ticker check the chips use -- buzz_extract, never a browser guess."""
import pytest

from api.routers import notebook_smart_chips as sc


def test_a_plain_symbol_in_a_sentence_is_found():
    assert {"symbol": "NVDA", "tier": "exact"} in sc.tickers_in("alert me if NVDA closes below 120")


@pytest.mark.parametrize("word", ["RS", "EMA", "MA", "GAP", "PEG"])
def test_trading_words_are_not_tickers_without_a_cashtag(word):
    assert all(t["symbol"] != word for t in sc.tickers_in(f"alert me if {word} closes below 120"))


def test_a_cashtag_makes_any_word_a_ticker():
    assert {"symbol": "RS", "tier": "cashtag"} in sc.tickers_in("alert me if $RS closes below 120")


def test_text_is_capped_and_never_empty():
    with pytest.raises(sc.TextRefused):
        sc.tickers_in("   ")
    with pytest.raises(sc.TextRefused):
        sc.tickers_in("x" * (sc.MAX_TEXT + 1))
    with pytest.raises(sc.TextRefused):
        sc.tickers_in(None)
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd $WT && python -m pytest tests/test_notebook_smart_chips.py -q; code=$?; exit $code`
Expected: FAIL, `ModuleNotFoundError: ... notebook_smart_chips`.

- [ ] **Step 3: Write the router**

Copy the gate, paid check and body cap from `api/routers/notebook_journal_styles.py` (`_require_enabled` before the session; `require_paid`; `capped_json`), naming them for this router:

```python
# api/routers/notebook_smart_chips.py
"""Tier 2 part A: the server half of the Notebook's smart chips.

ONE route: which tickers a short text names, by buzz_extract -- the resolver that already knows
RS, EMA, MA, GAP and PEG are words in prose (R-T2A-6). The browser parses a sentence locally and
asks only "is this word a ticker here?". The text is never stored and never logged.

Gate NOTEBOOK_SMART_CHIPS_ENABLED (enablement), read per request; off -> the one 404, before the
session is read. Paid, like every Notebook route.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from api.services import buzz_extract
from api.services.notebook_flags import flag_on

router = APIRouter(prefix="/api/j2/smart-chips", tags=["notebook"])

FLAG = "NOTEBOOK_SMART_CHIPS_ENABLED"
MAX_TEXT = 2000


class TextRefused(ValueError):
    """The text is empty, not text, or longer than MAX_TEXT."""


def tickers_in(text) -> list[dict]:
    if not isinstance(text, str) or not text.strip():
        raise TextRefused("Send some text to check.")
    if len(text) > MAX_TEXT:
        raise TextRefused(f"Send at most {MAX_TEXT} characters.")
    return [{"symbol": sym, "tier": tier} for sym, tier in buzz_extract.extract(text)]
```
Then add the endpoint, with `_require_enabled`, `require_paid` and the body cap copied from the styles router (V5 records the exact helpers and their imports). It maps `TextRefused` to `422` with the exception's sentence and returns `{"tickers": tickers_in(body.get("text"))}`. Mount it in `api/main.py` next to the styles router's `include_router`, with a one-line comment naming Tier 2 part A.

- [ ] **Step 4: Add the router tests (gate, paid, cap) with the V5 harness**

Add to the same file, using the client fixture V5 names: `test_switch_off_is_the_one_404` (flag unset, signed-out request → 404); `test_signed_out_is_401` and `test_free_plan_is_402` (flag on); `test_round_trip` (paid, flag on, `{"text": "alert me if NVDA closes below 120"}` → 200 with NVDA); `test_over_long_text_is_422`.

- [ ] **Step 5: Add the contract fixture**

Register the route in `tools/notebook_contract_fixtures.py` the way the styles routes are registered, and write the fixture it generates (run the tool's write mode as its header says). Then run `tests/test_notebook_contract_fixtures.py`.

- [ ] **Step 6: Run everything for this task**

Run: `cd $WT && python -m pytest tests/test_notebook_smart_chips.py tests/test_notebook_contract_fixtures.py tests/test_paywall_gate_free_tier.py -q; code=$?; exit $code`
Expected: all pass. If `test_paywall_gate_free_tier.py` lists every paid route, add this one there.

- [ ] **Step 7: Commit** (hygiene in its own call, then `git commit -F - -- <the files above>` with the trailer; message `feat(notebook): smart-chips ticker check route (buzz_extract, dark)`; push).

---

### Task 4: `/plan`'s server prefill

**Files:**
- Create: `api/services/journal_two/plan_prefill.py`, `tests/test_plan_prefill.py`
- Modify: `api/services/journal_two/journal_styles.py` (`compose` gains `after_build`; `create_styled_note` reads `planPrefill`)

**Interfaces:**
- Consumes: `plan_extract.read_note_plan(body, props, prop_defs, symbol) -> PlanReading` (`.value(role)`); `plan_extract.plan_annotation(role, price) -> dict`; `trader_blocks.price_stamp_quote(sym, now) -> dict | None` (V4 shape); `trader_blocks._spend(memo)` (raises when the create's read budget is spent); `sample_marker.not_sample_sql()`.
- Produces: `plan_prefill.PLAN_KIND = "trade_plan"`, `plan_prefill.SOURCE_SCAN = 20`, `plan_prefill.member_levels(user_id, symbol, conn) -> {"noteId", "title", "levels": {role: float}} | None`, `plan_prefill.apply(doc, ctx, conn) -> doc`. `compose(..., after_build=None)`: called as `after_build(doc, ctx)` in create mode only, after blocks are placed. `create_styled_note` accepts `payload["planPrefill"] is True` and refuses it (`StyleValidationError`) unless the style's kind is `trade_plan` and a ticker is given.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_plan_prefill.py
"""Tier 2 part A, /plan (R-T2A-1..3): the member's own levels, a dated price, a link to the source.
Never an invented number."""
import json
from datetime import datetime, timezone

import pytest

from api.services.journal_two import journal_styles, plan_prefill
from api.services.journal_two import trader_blocks as tb

NOW = datetime(2026, 10, 14, 14, 31, tzinfo=timezone.utc)


def _nodes(doc, kind):
    out, stack = [], [doc]
    while stack:
        n = stack.pop()
        if isinstance(n, dict):
            if n.get("type") == "widgetEmbed" and (n.get("attrs") or {}).get("widgetId") == kind:
                out.append(n)
            stack.extend(n.get("content") or [])
    return out


def _text(doc):
    out, stack = [], [doc]
    while stack:
        n = stack.pop()
        if isinstance(n, dict):
            if n.get("type") == "text":
                out.append(n.get("text", ""))
            stack.extend(reversed(n.get("content") or []))
    return " ".join(out)


@pytest.fixture
def member(styles_db):          # V5: the styles tests' member + connection fixture, by its real name
    return styles_db


def test_plan_prefill_copies_the_members_newest_levels_and_links_the_source(member, monkeypatch):
    uid, conn = member.user_id, member.conn
    member.make_note(ticker="NVDA", title="NVDA base", body_text="Entry: 181.5\nStop: 174\nTarget: 205")
    monkeypatch.setattr(tb, "price_stamp_quote", lambda sym, now=None: {"price": 182.4, "source": "live", "asOf": "2026-10-14T14:31:00Z"})
    note, _ = journal_styles.create_styled_note(uid, {"kindId": "trade_plan", "ticker": "NVDA", "planPrefill": True}, conn)
    body = note["bodyJson"] if isinstance(note["bodyJson"], dict) else json.loads(note["bodyJson"])
    chart = _nodes(body, "chart")[0]
    roles = {a["role"]: a["price"] for a in chart["attrs"]["annotations"]}
    assert roles == {"entry": 181.5, "stop": 174.0, "target": 205.0}
    sizing = _nodes(body, "positionSizing")[0]["attrs"]["params"]
    assert (sizing["entry"], sizing["stop"]) == (181.5, 174.0)
    text = _text(body)
    assert "Price when planned: $182.40" in text
    assert "Levels from your note" in text


def test_plan_prefill_without_history_or_price_adds_nothing_invented(member, monkeypatch):
    uid, conn = member.user_id, member.conn
    monkeypatch.setattr(tb, "price_stamp_quote", lambda sym, now=None: None)
    note, _ = journal_styles.create_styled_note(uid, {"kindId": "trade_plan", "ticker": "ZZZT", "planPrefill": True}, conn)
    body = note["bodyJson"] if isinstance(note["bodyJson"], dict) else json.loads(note["bodyJson"])
    assert _nodes(body, "chart")[0]["attrs"]["annotations"] == []
    params = _nodes(body, "positionSizing")[0]["attrs"]["params"]
    assert "entry" not in params and "stop" not in params
    assert "Price when planned" not in _text(body)


def test_a_sample_or_trashed_note_is_never_a_source(member):
    uid, conn = member.user_id, member.conn
    member.make_note(ticker="NVDA", title="sample", body_text="Entry: 1\nStop: 0.5", sample=True)
    trashed = member.make_note(ticker="NVDA", title="old", body_text="Entry: 2\nStop: 1")
    member.trash(trashed)
    assert plan_prefill.member_levels(uid, "NVDA", conn) is None


def test_plan_prefill_needs_the_trade_plan_kind_and_a_ticker(member):
    uid, conn = member.user_id, member.conn
    with pytest.raises(journal_styles.StyleValidationError):
        journal_styles.create_styled_note(uid, {"kindId": "trade_plan", "planPrefill": True}, conn)
    with pytest.raises(journal_styles.StyleValidationError):
        journal_styles.create_styled_note(uid, {"kindId": "daily_prep", "ticker": "NVDA", "planPrefill": True}, conn)


def test_a_spent_budget_leaves_the_price_out(member, monkeypatch):
    uid, conn = member.user_id, member.conn
    def spent(memo):
        raise tb.BudgetSpent()
    monkeypatch.setattr(tb, "_spend", spent)
    note, _ = journal_styles.create_styled_note(uid, {"kindId": "trade_plan", "ticker": "NVDA", "planPrefill": True}, conn)
    body = note["bodyJson"] if isinstance(note["bodyJson"], dict) else json.loads(note["bodyJson"])
    assert "Price when planned" not in _text(body)


def test_without_planPrefill_a_trade_plan_is_unchanged(member):
    uid, conn = member.user_id, member.conn
    member.make_note(ticker="NVDA", title="NVDA base", body_text="Entry: 181.5\nStop: 174")
    note, _ = journal_styles.create_styled_note(uid, {"kindId": "trade_plan", "ticker": "NVDA"}, conn)
    body = note["bodyJson"] if isinstance(note["bodyJson"], dict) else json.loads(note["bodyJson"])
    assert _nodes(body, "chart")[0]["attrs"]["annotations"] == []
```
The `member` fixture (a member id, a connection, `make_note(ticker, title, body_text, sample=False)` writing a paragraph per line, `trash(note)`) is built from the helpers V5 names. If the styles tests have none, write it in this file over `notes_service.create_note` and `sample_marker`. A paragraph "Entry: 181.5" is a level `plan_extract._text_levels` reads.

- [ ] **Step 2: Run them and see them fail**

Run: `cd $WT && python -m pytest tests/test_plan_prefill.py -q; code=$?; exit $code`
Expected: FAIL, `ImportError: cannot import name 'plan_prefill'`.

- [ ] **Step 3: Write `plan_prefill.py`**

```python
# api/services/journal_two/plan_prefill.py
"""Tier 2 part A, item 9: what `/plan TICKER` adds to a Trade plan note, in the create's ONE insert.

THREE things, each optional, none invented (R-T2A-1..3):
  * the member's OWN entry / stop / target for the ticker, from their newest live, non-sample note
    about it that names any -- read by plan_extract, the ONE reader of plan levels -- drawn on the
    chart (plan lines) and set as the sizing block's entry and stop;
  * a dated price line, read once inside the create's read budget (a slow or failed read leaves
    it out, never a zero);
  * a line saying where the levels came from, linking that note.
Automatic levels are deliberately NOT served anywhere (grade_ticker Seam 28); this never computes one.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from api.services.journal_two import plan_extract, sample_marker
from api.services.journal_two import trader_blocks as _tb

PLAN_KIND = "trade_plan"
#: Newest notes about the ticker read, at most, looking for one that names a level.
SOURCE_SCAN = 20
_ET = ZoneInfo("America/New_York")
_ROLES = ("entry", "stop", "target")


def member_levels(user_id: str, symbol: str, conn) -> dict | None:
    rows = conn.execute(
        "SELECT id, title, body_json, properties_json FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL"
        " AND UPPER(ticker) = ? AND " + sample_marker.not_sample_sql()
        + " ORDER BY updated_at DESC, rowid DESC LIMIT ?",
        (user_id, symbol.upper(), SOURCE_SCAN)).fetchall()
    for r in rows:
        plan = plan_extract.read_note_plan(r["body_json"], r["properties_json"], None, symbol)
        levels = {role: plan.value(role) for role in _ROLES if plan.value(role) is not None}
        if levels:
            return {"noteId": r["id"], "title": (r["title"] or "").strip(), "levels": levels}
    return None


def _para(*inline: dict) -> dict:
    return {"type": "paragraph", "content": [n for n in inline if n]}


def _text(s: str) -> dict:
    return {"type": "text", "text": s}


def _as_of_et(iso: Any) -> str | None:
    try:
        t = datetime.fromisoformat(str(iso).replace("Z", "+00:00")).astimezone(_ET)
    except (TypeError, ValueError):
        return None
    return f"{t.strftime('%b')} {t.day}, {t.strftime('%I:%M %p').lstrip('0')} ET"


def price_line(symbol: str, ctx: dict) -> dict | None:
    try:
        _tb._spend(ctx.setdefault("memo", {}))
        q = _tb.price_stamp_quote(symbol, ctx["now"])
    except Exception:  # noqa: BLE001 -- a spent budget or a failed read is a missing line, never a failed note
        return None
    price = (q or {}).get("price")
    if not isinstance(price, (int, float)) or price <= 0:
        return None
    when = _as_of_et(q.get("asOf"))
    tail = f" ({q.get('source') or 'live price'}, {when})" if when else ""
    return _para(_text(f"Price when planned: ${price:,.2f}{tail}"))


def _top_widgets(doc: dict, widget_id: str) -> list[dict]:
    return [n for n in doc.get("content") or []
            if isinstance(n, dict) and n.get("type") == "widgetEmbed"
            and (n.get("attrs") or {}).get("widgetId") == widget_id]


def _after_first_heading(content: list) -> int:
    for i, n in enumerate(content):
        if isinstance(n, dict) and n.get("type") == "heading":
            return i + 1
    return 0


def apply(doc: dict, ctx: dict, conn) -> dict:
    symbol = ctx.get("ticker")
    if not symbol:
        return doc
    found = member_levels(ctx["user_id"], symbol, conn)
    if found:
        for chart in _top_widgets(doc, "chart"):
            if ((chart["attrs"].get("params") or {}).get("symbol") or "").upper() == symbol.upper():
                chart["attrs"]["annotations"] = [plan_extract.plan_annotation(role, price)
                                                 for role, price in found["levels"].items()]
        for sizing in _top_widgets(doc, "positionSizing"):
            params = dict(sizing["attrs"].get("params") or {})
            for role in ("entry", "stop"):
                if role in found["levels"]:
                    params[role] = found["levels"][role]
            sizing["attrs"]["params"] = params
    lines = [ln for ln in (price_line(symbol, ctx),) if ln]
    if found:
        label = f"Levels from your note “{found['title']}”: " if found["title"] else "Levels from your note: "
        lines.append(_para(_text(label), {"type": "noteLink", "attrs": {"noteId": found["noteId"]}}))
    if lines:
        content = doc.setdefault("content", [])
        i = _after_first_heading(content)
        content[i:i] = lines
    return doc
```
If V2 found other column names, or V6 found that property levels need `prop_defs` (load them the way `note_levels._prop_defs` does), or V7 found that `params` feeds `searchText`, fix the code to match and record it in the task report.

- [ ] **Step 4: Hook it into `compose` and `create_styled_note`**

In `compose`'s signature add `after_build: Callable[[dict, dict], dict] | None = None`. Just before `props = _valid_defaults(...)`, add:
```python
        if mode == "create" and after_build is not None:
            # Tier 2 part A (/plan): one more step on the SAME body, inside the same read budget.
            doc = after_build(doc, ctx)
```
In `create_styled_note`, after `ticker = notes_service._validate_ticker(...)`:
```python
        prefill = None
        if payload.get("planPrefill") is True:
            if style.get("kindId") != plan_prefill.PLAN_KIND or not ticker:
                raise StyleValidationError("A trade plan needs a ticker.")
            prefill = lambda doc, ctx: plan_prefill.apply(doc, ctx, conn)  # noqa: E731
        composed = compose(user_id, style, ticker=ticker, conn=conn, mode="create", after_build=prefill)
```
(replacing the existing `composed = compose(...)` line), with `from api.services.journal_two import plan_prefill` at the function's top, beside `notes_service`.

- [ ] **Step 5: Run the tests and the neighbouring rails**

Run: `cd $WT && python -m pytest tests/test_plan_prefill.py tests/test_prep_create_budget.py tests/test_journal_styles_store.py tests/test_trader_blocks_no_note_door.py -q; code=$?; exit $code`
Expected: all pass. If `test_prep_create_budget.py` rails every read on a create, add `plan_prefill.price_line` to the set it reads, and keep its "both directions" assertion.

- [ ] **Step 6: Mutation check**

Copy `plan_prefill.py`'s bytes to the scratchpad (a lane-unique name). Then change `if levels:` to `if levels and False:` and run `test_plan_prefill.py`. Expected: the first test FAILS. Restore by writing back the captured bytes. Verify the restore with `git diff --quiet -- api/services/journal_two/plan_prefill.py` (the file is untracked until the commit, so compare the sha256 against the capture AND re-run the test green).

- [ ] **Step 7: Commit** (`feat(notebook): /plan prefill, the member's own levels, a dated price, a source link`; push).

---

### Task 5: `/plan` in the editor

**Files:**
- Create: `app/src/pages/journal-2-0/lib/planCreate.js`, `app/src/pages/journal-2-0/lib/planCreate.test.js`
- Modify: `J/lib/noteCreation.js` (pass `planPrefill`), `J/lib/journalStylesFlag.js` (`PLAN_EVENT`), `B/SlashMenu.jsx` (`planItems`), `B/NoteEditorPage.jsx` (`createLinkedPlan`, listener), the slash menu test file (V3)

**Interfaces:**
- Consumes: `createNoteViaApi({..., kindId, ticker, planPrefill})`, `settleNoteWrite(id, note)`, `journalStylesEnabled()`.
- Produces: `PLAN_EVENT = 'uct:notebook-plan'` (CustomEvent with `detail: { symbol }`); `planItems(query) -> item[]` with `cmd: 'plan'`; `createPlanNote({ symbol, folderId }) -> Promise<note>`; `planTitle(symbol) -> string` (`"NVDA trade plan"`).

- [ ] **Step 1: Write the failing tests**

```js
// app/src/pages/journal-2-0/lib/planCreate.test.js
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('./noteCreation', () => ({ createNoteViaApi: vi.fn() }))
vi.mock('./offline/settleNoteWrite', () => ({ settleNoteWrite: vi.fn(async () => {}) }))
import { createNoteViaApi } from './noteCreation'
import { settleNoteWrite } from './offline/settleNoteWrite'
import { createPlanNote, planTitle } from './planCreate'

describe('createPlanNote', () => {
  beforeEach(() => { createNoteViaApi.mockReset(); settleNoteWrite.mockClear() })
  it('asks the server for a prefilled Trade plan and lands the answer', async () => {
    createNoteViaApi.mockResolvedValue({ id: 'n9', title: 'NVDA trade plan' })
    const note = await createPlanNote({ symbol: 'nvda', folderId: 'f1' })
    expect(createNoteViaApi).toHaveBeenCalledWith({
      title: 'NVDA trade plan', kindId: 'trade_plan', ticker: 'NVDA', planPrefill: true, folderId: 'f1',
    })
    expect(settleNoteWrite).toHaveBeenCalledWith('n9', note)
  })
  it('refuses a symbol that is not one, and calls nothing', async () => {
    await expect(createPlanNote({ symbol: '12$' })).rejects.toThrow()
    expect(createNoteViaApi).not.toHaveBeenCalled()
  })
  it('names the plan after the ticker', () => { expect(planTitle('amd')).toBe('AMD trade plan') })
})
```
And in the slash menu test file (V3), add:
```js
import { planItems } from './SlashMenu'
describe('/plan', () => {
  it('bare /plan is a hint that re-types the command', () => {
    const [hint] = planItems('plan')
    expect(hint.cmd).toBe('plan'); expect(hint.title).toBe('Trade plan')
  })
  it('/plan NVDA is the real item, upper-cased', () => {
    const [item] = planItems('plan nvda')
    expect(item.title).toBe('Trade plan — NVDA')
  })
  it('anything that does not parse returns nothing, so Enter stays a newline', () => {
    expect(planItems('plan nvda amd')).toEqual([])
    expect(planItems('plan 12$')).toEqual([])
    expect(planItems('planet')).toEqual([])
  })
  it('a prefix of the word is still a hint', () => { expect(planItems('pla')).toHaveLength(1) })
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `cd $WT/app && npx vitest run src/pages/journal-2-0/lib/planCreate.test.js <the slash test file>; code=$?; exit $code`
Expected: FAIL (`planCreate` missing; `planItems` not exported).

- [ ] **Step 3: Write `planCreate.js`, `PLAN_EVENT`, and pass `planPrefill`**

```js
// app/src/pages/journal-2-0/lib/planCreate.js
/**
 * Tier 2 part A, item 9 -- the door that MAKES a /plan note. Through createNoteViaApi (the one
 * network path every creation uses) as a styled create of the member's default Trade plan style;
 * the server adds the member's own levels, a dated price and a source link in the SAME insert
 * (api/services/journal_two/plan_prefill.py). The answer is landed with settleNoteWrite before any
 * editor can meet it.
 */
import { createNoteViaApi } from './noteCreation'
import { settleNoteWrite } from './offline/settleNoteWrite'

const SYMBOL_RE = /^[A-Za-z][A-Za-z.\-]{0,9}$/

export function planTitle(symbol) {
  return `${String(symbol).toUpperCase()} trade plan`
}

export async function createPlanNote({ symbol, folderId } = {}) {
  const raw = String(symbol || '').trim().replace(/^\$/, '')
  if (!SYMBOL_RE.test(raw)) throw new Error('not a symbol')
  const ticker = raw.toUpperCase()
  const created = await createNoteViaApi({
    title: planTitle(ticker), kindId: 'trade_plan', ticker, planPrefill: true,
    ...(folderId ? { folderId } : {}),
  })
  await settleNoteWrite(created?.id ?? null, created)
  return created
}
```
In `J/lib/journalStylesFlag.js`, beside `STYLE_EVENT`:
```js
/** Tier 2 part A: the slash menu's /plan, dispatched on the editor's own DOM root (I5). */
export const PLAN_EVENT = 'uct:notebook-plan'
```
In `J/lib/noteCreation.js`'s `createNoteViaApi`, accept `planPrefill` and send it only when it is exactly `true`, the same way `styleId`/`kindId` are sent only when truthy. Add a case to its test file: `planPrefill: true` is in the body, and `planPrefill: 'yes'` is not.

- [ ] **Step 4: Add `planItems` to the slash menu**

Beside `factItems` in `B/SlashMenu.jsx`:
```js
// ── Tier 2 part A, item 9: /plan NVDA makes a Trade plan note for NVDA (the member's default
// Trade plan style, with their own levels and a dated price) and links it at the caret. The
// same two-regime matching as /price; dispatched on this editor's own DOM root (I5), like /canvas.
export function planItems(query) {
  if (!journalStylesEnabled()) return []
  const raw = String(query || '')
  const tokens = raw.trim().split(/\s+/).filter(Boolean)
  const first = tokens[0]?.toLowerCase() || ''
  const singleToken = tokens.length <= 1
  if (singleToken ? !first || !'plan'.startsWith(first) : first !== 'plan') return []
  const rest = singleToken ? '' : raw.trim().slice(first.length).trim()
  if (!rest) {
    return [{
      title: 'Trade plan', cmd: 'plan', description: 'Type a symbol — e.g. /plan NVDA',
      command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).insertContent('/plan ').run() },
    }]
  }
  const symTokens = rest.split(/\s+/).filter(Boolean)
  if (symTokens.length !== 1 || !FACT_SYMBOL_RE.test(symTokens[0].replace(/^\$/, ''))) return []
  const symbol = symTokens[0].replace(/^\$/, '').toUpperCase()
  return [{
    title: `Trade plan — ${symbol}`, cmd: 'plan',
    description: 'A Trade plan note with your levels and the price, linked here',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      editor.view.dom.dispatchEvent(new CustomEvent(PLAN_EVENT, { bubbles: true, detail: { symbol } }))
    },
  }]
}
```
Import `PLAN_EVENT` (and `journalStylesEnabled`, if it is not already imported) from `../../lib/journalStylesFlag`. In the `items` function add `const planCaptures = planItems(query)` and include it in both `groupedSlashItems(here, [...])` and `captures`. Note that the `!first` guard keeps a bare `/` from listing the hint twice. Check the existing "bare `/` lists" test still passes.

- [ ] **Step 5: Add `createLinkedPlan` and its listener in `NoteEditorPage.jsx`**

Next to `createLinkedCanvas` (it is the model; keep its locked/destroyed/editable checks verbatim):
```js
  // Tier 2 part A: /plan NVDA in a note -- make the Trade plan and link it at the caret.
  const creatingPlanRef = useRef(false)
  const createLinkedPlan = useCallback(async (symbol) => {
    const ed = editorRef.current
    if (!journalStylesEnabled() || !ed || ed.isDestroyed || creatingPlanRef.current) return
    if (lockedRef.current || !ed.isEditable) {
      setUploadToast({ message: 'This note is locked — unlock it in the Notebook first', tone: 'error' })
      return
    }
    creatingPlanRef.current = true
    try {
      const created = await createPlanNote({ symbol, folderId: canvasNoteRef.current?.folderId || undefined })
      const live = editorRef.current
      if (created?.id && live && !live.isDestroyed && live.isEditable && !lockedRef.current) {
        live.chain().focus().insertContent([
          { type: 'noteLink', attrs: { noteId: created.id } }, { type: 'text', text: ' ' },
        ]).run()
        globalMutate((key) => typeof key === 'string' && key.startsWith('/api/j2/notes'))
        setUploadToast({ message: `Trade plan for ${symbol} created and linked. Open it from the link.`, tone: 'success' })
      } else if (created?.id) {
        setUploadToast({ message: `Trade plan for ${symbol} created. This note could not take the link.`, tone: 'error' })
      }
    } catch (e) {
      console.error('[notebook] /plan create failed', e)
      setUploadToast({ message: "Couldn't create the trade plan. Nothing was saved.", tone: 'error' })
    } finally {
      creatingPlanRef.current = false
    }
  }, [])
```
In the attach/detach effect: `const onPlan = (e) => { createLinkedPlan(e?.detail?.symbol) }`, plus `dom.addEventListener(PLAN_EVENT, onPlan)` in `attach` and `dom.removeEventListener(PLAN_EVENT, onPlan)` in `detach`.

- [ ] **Step 6: Add the editor-level test (locked note, link inserted)**

Create `B/planCreate.editor.test.jsx`. Follow the existing `/canvas` editor test (V3 names it; find it with `grep -rl "CANVAS_EVENT" app/src --include=*.test.jsx`). Cover: (a) dispatching `PLAN_EVENT` with `{ symbol: 'NVDA' }` on an editable note calls `createPlanNote` and inserts one `noteLink` with the returned id; (b) on a locked note it calls nothing and shows "This note is locked — unlock it in the Notebook first"; (c) a rejected create shows "Couldn't create the trade plan. Nothing was saved." and inserts nothing. Assert the rendered toast TEXT, not state.

- [ ] **Step 7: Run the task's files and the door census**

Run: `cd $WT/app && npx vitest run src/pages/journal-2-0/lib/planCreate.test.js src/pages/journal-2-0/lib/noteCreation.test.js src/pages/journal-2-0/components/notebook/planCreate.editor.test.jsx <slash test> src/pages/journal-2-0/lib/offline/doorEnumeration.test.js; code=$?; exit $code`
Expected: all pass (no new red beyond Task 1's record).

- [ ] **Step 8: Commit** (`feat(notebook): /plan TICKER makes a prefilled Trade plan and links it`; push).

---

### Task 6: The sentence parser

**Files:**
- Create: `app/src/pages/journal-2-0/lib/alertPhrase.js`, `app/src/pages/journal-2-0/lib/alertPhrase.test.js`

**Interfaces:**
- Consumes: `parseAlertPrice(token) -> { price, direction } | null` from `app/src/pages/terminal/alertModel.js` (import-cheap by its own header).
- Produces: `MAX_PHRASE_TEXT = 280`; `parseAlertPhrase(text) -> null | { symbol: string|null, pronoun: boolean, mode: 'close'|'intraday', direction: 'above'|'below'|null, price: number, tf: 'D'|'W', phrase: string }`; `describeAlert(p, symbol) -> string` (e.g. `"NVDA closes below $120.00 (daily)"`).

- [ ] **Step 1: Write the failing table test**

```js
// app/src/pages/journal-2-0/lib/alertPhrase.test.js
import { describe, expect, it } from 'vitest'
import { MAX_PHRASE_TEXT, describeAlert, parseAlertPhrase } from './alertPhrase'

const P = (t) => parseAlertPhrase(t)

describe('parseAlertPhrase -- what it reads', () => {
  it.each([
    ['alert me if NVDA closes below 120', { symbol: 'NVDA', mode: 'close', direction: 'below', price: 120, tf: 'D' }],
    ['Alert me when $AMD closes above 155.50', { symbol: 'AMD', mode: 'close', direction: 'above', price: 155.5 }],
    ['set an alert if TSLA drops below 200', { symbol: 'TSLA', mode: 'intraday', direction: 'below', price: 200 }],
    ['alert me if NVDA trades over $130', { symbol: 'NVDA', mode: 'intraday', direction: 'above', price: 130 }],
    ['alert me if NVDA falls to 100', { symbol: 'NVDA', mode: 'intraday', direction: 'below', price: 100 }],
    ['alert me if NVDA hits 150', { symbol: 'NVDA', mode: 'intraday', direction: null, price: 150 }],
    ['alert me if NVDA closes under 118 on the weekly', { mode: 'close', direction: 'below', tf: 'W' }],
    ['alert me if BRK.B closes below 400', { symbol: 'BRK-B' }],
  ])('%s', (text, want) => { expect(P(text)).toMatchObject(want) })

  it('"it", "the stock" and "price" mean the note\'s own ticker', () => {
    for (const t of ['alert me if it closes below 120', 'alert me if the stock closes below 120', 'alert me if price closes below 120']) {
      expect(P(t)).toMatchObject({ symbol: null, pronoun: true, price: 120 })
    }
  })
  it('upper-case IT is Gartner, a ticker, not a pronoun', () => {
    expect(P('alert me if IT closes below 200')).toMatchObject({ symbol: 'IT', pronoun: false })
  })
  it('reads the LAST sentence that asks', () => {
    expect(P('Bought half. Alert me if NVDA closes below 120. Alert me if AMD closes above 160')).toMatchObject({ symbol: 'AMD' })
  })
})

describe('parseAlertPhrase -- what it refuses', () => {
  it.each([
    'NVDA closes below 120',                         // no ask
    "don't alert me if NVDA closes below 120",       // negated
    'no alert if NVDA closes below 120',
    'alert me if NVDA closes below',                 // no price
    'alert me if NVDA closes below 0',               // not a price
    'alert me if NVDA closes below -5',
    'if NVDA closes below 120 alert me',             // ask after the condition
    'alert me if NVDA bounces off 120',              // unknown verb
    '',
  ])('%s', (text) => { expect(P(text)).toBeNull() })

  it('ignores a paragraph longer than the cap', () => {
    expect(P(`${'x '.repeat(MAX_PHRASE_TEXT)} alert me if NVDA closes below 120`)).toBeNull()
  })
})

describe('describeAlert', () => {
  it('says the mode in words', () => {
    expect(describeAlert(P('alert me if NVDA closes below 120'), 'NVDA')).toBe('NVDA closes below $120.00 (daily)')
    expect(describeAlert(P('alert me if NVDA trades above 130'), 'NVDA')).toBe('NVDA trades above $130.00')
    expect(describeAlert(P('alert me if NVDA hits 150'), 'NVDA')).toBe('NVDA reaches $150.00')
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd $WT/app && npx vitest run src/pages/journal-2-0/lib/alertPhrase.test.js; code=$?; exit $code`
Expected: FAIL, the module is missing.

- [ ] **Step 3: Write the parser**

```js
// app/src/pages/journal-2-0/lib/alertPhrase.js
/**
 * Tier 2 part A, item 8 -- "alert me if NVDA closes below 120" read LOCALLY and DETERMINISTICALLY:
 * ticker + comparator + price + close/intraday (spec). Pure: no React, no fetch. It never sets
 * anything; it says what a sentence asks for, and the chip asks the member.
 *
 * ⛔ The word it calls a symbol is a CANDIDATE. Whether it is a ticker here is the server's call
 * (POST /api/j2/smart-chips/tickers, buzz_extract), because RS / EMA / MA / GAP / PEG are real
 * symbols that are words in prose (R-T2A-6). "it" / "the stock" / "price" mean the note's ticker.
 *
 * The grammar, and nothing more: an ask ("alert") BEFORE "if/when/once", then a subject, a verb from
 * a fixed list, an optional direction word, a price, and for a close an optional "on the
 * daily/weekly". "closes" is a closed-bar alert (R-T2A-5); every other verb is intraday.
 */
import { parseAlertPrice } from '../../terminal/alertModel'

export const MAX_PHRASE_TEXT = 280

const ASK = /\balert\b/i
const NEGATED = /\b(?:don'?t|do\s+not|never|no)\b[^.!?]{0,20}\balert\b/i
const PHRASE = /\b(?:if|when|once)\s+(?<sym>it|the\s+stock|the\s+price|price|\$?[A-Za-z]{1,6}(?:[.-][A-Za-z]{1,2})?)\s+(?<verb>closes|close|trades|trade|goes|gets|moves|drops|falls|breaks|crosses|hits|touches|reaches|is)\s+(?:(?<dir>above|below|over|under|through|to)\s+)?(?<price>\$?\d{1,7}(?:\.\d{1,4})?)(?!\d|\.\d)(?:\s+on\s+the\s+(?<tf>daily|weekly)(?:\s+chart)?)?/gi

const DIR = { above: 'above', over: 'above', below: 'below', under: 'below' }
const FALLING = new Set(['drops', 'falls'])
const PRONOUN = /^(?:it|It|the\s+stock|the\s+price|price)$/i

function readSentence(sentence) {
  if (!ASK.test(sentence) || NEGATED.test(sentence)) return null
  let found = null
  for (const m of sentence.matchAll(PHRASE)) {
    if (!ASK.test(sentence.slice(0, m.index))) continue
    found = m
  }
  if (!found) return null
  const g = found.groups
  const priced = parseAlertPrice(g.price)
  if (!priced) return null
  const rawSym = g.sym
  const pronoun = rawSym !== 'IT' && PRONOUN.test(rawSym)
  const verb = g.verb.toLowerCase()
  const word = (g.dir || '').toLowerCase()
  const direction = DIR[word] || (FALLING.has(verb) ? 'below' : null)
  const mode = verb === 'closes' || verb === 'close' ? 'close' : 'intraday'
  return {
    symbol: pronoun ? null : rawSym.replace(/^\$/, '').toUpperCase().replace('.', '-'),
    pronoun,
    mode,
    direction,
    price: priced.price,
    tf: (g.tf || '').toLowerCase() === 'weekly' ? 'W' : 'D',
    phrase: found[0],
  }
}

export function parseAlertPhrase(text) {
  const t = String(text ?? '')
  if (!t.trim() || t.length > MAX_PHRASE_TEXT) return null
  const sentences = t.split(/(?<=[.!?])\s+/)
  for (let i = sentences.length - 1; i >= 0; i -= 1) {
    const p = readSentence(sentences[i])
    if (p) return p
  }
  return null
}

const money = (v) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function describeAlert(p, symbol) {
  if (!p) return ''
  if (p.mode === 'close') return `${symbol} closes ${p.direction || 'at'} ${money(p.price)} (${p.tf === 'W' ? 'weekly' : 'daily'})`
  if (!p.direction) return `${symbol} reaches ${money(p.price)}`
  return `${symbol} trades ${p.direction} ${money(p.price)}`
}
```
Note: `parseAlertPrice` refuses `0` and `-5` (its regex has no sign, and it requires `price > 0`). The `(?!\d|\.\d)` lookahead stops "120.5.3" from matching as 120.5, and still accepts a sentence that ends in a full stop ("…below 120."). Add that sentence to the table: `['Alert me if NVDA closes below 120.', { price: 120 }]`.

- [ ] **Step 4: Run it and see it pass**

Run: `cd $WT/app && npx vitest run src/pages/journal-2-0/lib/alertPhrase.test.js; code=$?; exit $code`
Expected: PASS, every row.

- [ ] **Step 5: Mutation check**

Capture the file's bytes, then delete the `NEGATED.test(sentence) ||` clause. Run the test: expected FAIL on "don't alert me…". Restore, check the sha256 against the capture AND against `git cat-file blob` of the commit once committed, then re-run green.

- [ ] **Step 6: Commit** (`feat(notebook): plain-English alert sentence parser (local, deterministic)`; push).

---

### Task 7: The offer plugin

**Files:**
- Create: `app/src/pages/journal-2-0/lib/alertPhraseOffer.js`, `app/src/pages/journal-2-0/lib/alertPhraseOffer.test.js`
- Modify: `app/src/pages/journal-2-0/lib/tiptap.js` (register after `LinkPasteOffer`)

**Interfaces:**
- Consumes: `parseAlertPhrase`, `MAX_PHRASE_TEXT` (Task 6); `smartChipsEnabled` (Task 2).
- Produces: `alertPhraseKey` (PluginKey); plugin state `{ offer: null | { from, to, text, parsed }, dismissed: string[] }`; `offerAt(state, dismissed)`; `dismissAlertOffer(editor)`; `ALERT_OFFER_EVENT = 'uct:notebook-alert-offer'` (dispatched on `view.dom` with `detail: offer` on Alt+Enter); extension `AlertPhraseOffer` with `priority: 50`.

- [ ] **Step 1: Write the failing tests**

```js
// app/src/pages/journal-2-0/lib/alertPhraseOffer.test.js
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'

vi.mock('./smartChipsFlag', () => ({ smartChipsEnabled: vi.fn(() => true) }))
import { smartChipsEnabled } from './smartChipsFlag'
import { ALERT_OFFER_EVENT, AlertPhraseOffer, alertPhraseKey, dismissAlertOffer } from './alertPhraseOffer'

let editor
const make = (html = '<p></p>') => {
  editor = new Editor({ extensions: [StarterKit, AlertPhraseOffer], content: html })
  return editor
}
const offer = () => alertPhraseKey.getState(editor.state).offer
const typeAtEnd = (text) => { editor.commands.focus('end'); editor.commands.insertContent(text) }

beforeEach(() => { smartChipsEnabled.mockReturnValue(true) })
afterEach(() => { editor?.destroy() })

describe('the alert offer', () => {
  it('appears for the caret paragraph once the sentence parses', () => {
    make(); typeAtEnd('alert me if NVDA closes below 12')
    const first = offer()
    typeAtEnd('0')
    expect(offer()).toMatchObject({ parsed: { symbol: 'NVDA', price: 120 } })
    expect(offer()).not.toBe(first)
  })
  it('keeps the SAME state object while nothing it reads changes (the menu bails on identity)', () => {
    make('<p>alert me if NVDA closes below 120</p><p>other</p>')
    editor.commands.setTextSelection(5)
    const s1 = alertPhraseKey.getState(editor.state)
    editor.commands.setTextSelection(6)
    expect(alertPhraseKey.getState(editor.state).offer).toBe(s1.offer)
  })
  it('a paragraph without the word costs one identity return', () => {
    make(); typeAtEnd('just some notes')
    const s1 = alertPhraseKey.getState(editor.state)
    typeAtEnd(' more')
    expect(alertPhraseKey.getState(editor.state)).toBe(s1)
  })
  it('goes away when the caret leaves the paragraph', () => {
    make('<p>alert me if NVDA closes below 120</p><p>other</p>')
    editor.commands.setTextSelection(5); expect(offer()).not.toBeNull()
    editor.commands.setTextSelection(editor.state.doc.content.size - 1); expect(offer()).toBeNull()
  })
  it('a dismissed sentence is not offered again until its text changes', () => {
    make(); typeAtEnd('alert me if NVDA closes below 120')
    dismissAlertOffer(editor); expect(offer()).toBeNull()
    editor.commands.setTextSelection(3); expect(offer()).toBeNull()
    typeAtEnd('.5'); expect(offer()).not.toBeNull()
  })
  it('Escape dismisses; Alt+Enter dispatches the open event on the editor DOM', () => {
    make(); typeAtEnd('alert me if NVDA closes below 120')
    const seen = vi.fn(); editor.view.dom.addEventListener(ALERT_OFFER_EVENT, seen)
    editor.view.someProp('handleKeyDown', (f) => f(editor.view, new KeyboardEvent('keydown', { key: 'Enter', altKey: true })))
    expect(seen).toHaveBeenCalledTimes(1)
    editor.view.someProp('handleKeyDown', (f) => f(editor.view, new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(offer()).toBeNull()
  })
  it('plain Enter is never taken', () => {
    make(); typeAtEnd('alert me if NVDA closes below 120')
    const took = editor.view.someProp('handleKeyDown', (f) => f(editor.view, new KeyboardEvent('keydown', { key: 'Enter' })))
    expect(took).toBeFalsy()
  })
  it('switch off: no offer, ever', () => {
    smartChipsEnabled.mockReturnValue(false)
    make(); typeAtEnd('alert me if NVDA closes below 120')
    expect(offer()).toBeNull()
  })
  it('a read-only editor offers nothing', () => {
    make('<p>alert me if NVDA closes below 120</p>'); editor.setEditable(false)
    editor.commands.setTextSelection(5)
    expect(offer()).toBeNull()
  })
})
```
Add the Review Focus 1 case: build the editor with the real slash menu extension (as the slash test file does, V3). Type `alert me if NVDA closes below 120 /`, so the slash menu opens with the offer present. Press Escape and assert the slash session closed and the offer is still there. Press Escape again and assert the offer is gone.

- [ ] **Step 2: Run them and see them fail**

Run: `cd $WT/app && npx vitest run src/pages/journal-2-0/lib/alertPhraseOffer.test.js; code=$?; exit $code`
Expected: FAIL, the module is missing.

- [ ] **Step 3: Write the plugin**

```js
// app/src/pages/journal-2-0/lib/alertPhraseOffer.js
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { MAX_PHRASE_TEXT, parseAlertPhrase } from './alertPhrase'
import { smartChipsEnabled } from './smartChipsFlag'

/**
 * Tier 2 part A, item 8 -- the OFFER behind the "Set alert" chip. Like linkPasteOffer.js, the
 * offer lives in editor state and a menu (components/notebook/AlertPhraseMenu.jsx) only reads it.
 *
 * ⛔ ON THE TYPING PATH. `apply` reads ONLY the caret's text block, and only when it contains the
 * word "alert"; it returns the IDENTICAL state object whenever what it reads did not change, so
 * the menu's reducer bails (the TY7 lesson in LinkPasteMenu.jsx). Switch off -> one flag read.
 * ⛔ IT NEVER SETS AN ALERT. Alt+Enter asks the editor page to open the sheet; the member presses.
 * ⛔ PRIORITY 50: every suggestion menu (slash, @ dates, note links) sees Enter and Escape first.
 */
export const alertPhraseKey = new PluginKey('uctAlertPhraseOffer')
export const ALERT_OFFER_EVENT = 'uct:notebook-alert-offer'
const EMPTY = Object.freeze({ offer: null, dismissed: Object.freeze([]) })
const DISMISS_KEEP = 20

export function offerAt(state, dismissed) {
  const sel = state.selection
  if (!sel.empty) return null
  const $head = sel.$head
  const block = $head.parent
  if (!block.isTextblock || block.type.spec.code) return null
  const text = block.textContent
  if (text.length > MAX_PHRASE_TEXT || !/alert/i.test(text) || dismissed.includes(text)) return null
  const parsed = parseAlertPhrase(text)
  return parsed ? { from: $head.start(), to: $head.end(), text, parsed } : null
}

export const dismissAlertOffer = (editor) => {
  if (!editor || editor.isDestroyed) return
  const st = alertPhraseKey.getState(editor.state)
  if (!st?.offer) return
  editor.view.dispatch(editor.state.tr.setMeta(alertPhraseKey, { dismiss: st.offer.text }))
}

export const AlertPhraseOffer = Extension.create({
  name: 'alertPhraseOffer',
  priority: 50,
  addProseMirrorPlugins() {
    const editor = this.editor
    return [new Plugin({
      key: alertPhraseKey,
      state: {
        init: () => EMPTY,
        apply(tr, value, _old, next) {
          if (!smartChipsEnabled()) return EMPTY
          const meta = tr.getMeta(alertPhraseKey)
          let { dismissed } = value
          if (meta?.dismiss) dismissed = [...dismissed, meta.dismiss].slice(-DISMISS_KEEP)
          if (!meta && !tr.docChanged && !tr.selectionSet) return value
          const offer = editor?.isEditable === false ? null : offerAt(next, dismissed)
          const same = offer && value.offer && offer.text === value.offer.text && offer.from === value.offer.from
          const kept = same ? value.offer : offer
          if (kept === value.offer && dismissed === value.dismissed) return value
          return { offer: kept, dismissed }
        },
      },
      props: {
        handleKeyDown(view, event) {
          const st = alertPhraseKey.getState(view.state)
          if (!st?.offer) return false
          if (event.key === 'Escape') {
            view.dispatch(view.state.tr.setMeta(alertPhraseKey, { dismiss: st.offer.text }))
            return true
          }
          if (event.key === 'Enter' && event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
            view.dom.dispatchEvent(new CustomEvent(ALERT_OFFER_EVENT, { bubbles: true, detail: st.offer }))
            return true
          }
          return false
        },
      },
    })]
  },
})
```
If V10 found an existing Alt+Enter binding, use the key the controller rules and change the tests to match.

- [ ] **Step 4: Register it**

In `J/lib/tiptap.js`, import `AlertPhraseOffer` and list it right after `LinkPasteOffer` in the Notebook editor's extension list (the same list `LinkPasteOffer` is in; V3 notes whether the slash menu extension is in this list or added by `NoteEditorPage`). Its `priority: 50` puts it last among key handlers whatever its place in the list.

- [ ] **Step 5: Run the tests, plus the editor suites that build the full extension list**

Run: `cd $WT/app && npx vitest run src/pages/journal-2-0/lib/alertPhraseOffer.test.js src/pages/journal-2-0/lib/linkPasteOffer.test.js src/pages/journal-2-0/lib/dateSuggest.test.js <slash test>; code=$?; exit $code`
Expected: all pass. (Use the real file names for the link-paste and date-suggest tests; V3 lists them.)

- [ ] **Step 6: Mutation check**

Change `return value` (the "nothing it reads changed" line) to `return { ...value }`. Run the "SAME state object" test: expected FAIL. Restore and verify, as in Task 6.

- [ ] **Step 7: Commit** (`feat(notebook): alert sentence offer plugin (dark, priority 50, identity-stable)`; push).

---

### Task 8: The chip and the sheet

**Files:**
- Create: `J/lib/smartChipsApi.js` + `smartChipsApi.test.js`; `B/AlertPhraseMenu.jsx` + `AlertPhraseMenu.module.css` + `AlertPhraseMenu.test.jsx`; `B/TextAlertSheet.jsx` + `TextAlertSheet.module.css` + `TextAlertSheet.test.jsx`
- Modify: `B/NoteEditorPage.jsx` (mount the menu lazily, beside `<LinkPasteMenu editor={editor} />`)

**Interfaces:**
- Consumes: `alertPhraseKey`, `dismissAlertOffer`, `ALERT_OFFER_EVENT` (Task 7); `describeAlert` (Task 6); `setAlert`, `currentPrice`, `MAX_DISTANCE`, `money` from `app/src/pages/terminal/alertCommand.js`; `createIndicatorAlert`, `useIndicatorAlertCatalog` from `app/src/hooks/useIndicatorAlerts.js`; `Sheet` (V11).
- Produces: `tickersIn(text, fetchImpl?) -> Promise<Array<{symbol, tier}> | null>` (null = could not check), `confirmsSymbol(tickers, symbol) -> boolean`, `canonicalSymbol(s)`; `AlertPhraseMenu({ editor, noteTicker })`; `TextAlertSheet({ open, initial: { symbol, mode, direction, price, tf }, onClose, onDone(text) })`.

- [ ] **Step 1: Write the failing API helper test**

```js
// app/src/pages/journal-2-0/lib/smartChipsApi.test.js
import { describe, expect, it, vi } from 'vitest'
import { canonicalSymbol, confirmsSymbol, tickersIn, __clearTickerCacheForTests } from './smartChipsApi'

const ok = (tickers) => vi.fn(async () => ({ ok: true, json: async () => ({ tickers }) }))

describe('tickersIn', () => {
  it('posts the text once and caches the answer', async () => {
    __clearTickerCacheForTests()
    const f = ok([{ symbol: 'NVDA', tier: 'exact' }])
    expect(await tickersIn('alert me if NVDA closes below 120', f)).toEqual([{ symbol: 'NVDA', tier: 'exact' }])
    await tickersIn('alert me if NVDA closes below 120', f)
    expect(f).toHaveBeenCalledTimes(1)
    expect(f.mock.calls[0][0]).toBe('/api/j2/smart-chips/tickers')
  })
  it('a refusal or a dropped network is null, and is not cached', async () => {
    __clearTickerCacheForTests()
    const bad = vi.fn(async () => ({ ok: false, status: 402 }))
    expect(await tickersIn('x NVDA', bad)).toBeNull()
    const down = vi.fn(async () => { throw new TypeError('offline') })
    expect(await tickersIn('x NVDA', down)).toBeNull()
    expect(down).toHaveBeenCalledTimes(1)
  })
})

describe('confirmsSymbol', () => {
  it('matches the canonical form', () => {
    expect(canonicalSymbol('brk.b')).toBe('BRK-B')
    expect(confirmsSymbol([{ symbol: 'BRK-B', tier: 'exact' }], 'BRK.B')).toBe(true)
    expect(confirmsSymbol([], 'NVDA')).toBe(false)
    expect(confirmsSymbol(null, 'NVDA')).toBe(false)
  })
})
```

- [ ] **Step 2: Write `smartChipsApi.js`**

```js
// app/src/pages/journal-2-0/lib/smartChipsApi.js
/** Tier 2 part A: the chips' one question to the server -- which tickers does this text name
 *  (POST /api/j2/smart-chips/tickers, buzz_extract). Never throws; null means "could not check",
 *  and a chip that could not check does not appear (Review Focus 2). Cached per text, 50 entries. */
const URL_ = '/api/j2/smart-chips/tickers'
const MAX = 2000
const cache = new Map()

export const canonicalSymbol = (s) => String(s || '').trim().replace(/^\$/, '').toUpperCase().replace('.', '-')
export function __clearTickerCacheForTests() { cache.clear() }

export async function tickersIn(text, fetchImpl = globalThis.fetch) {
  const key = String(text || '').slice(0, MAX)
  if (!key.trim()) return null
  if (cache.has(key)) return cache.get(key)
  const pending = (async () => {
    try {
      const r = await fetchImpl(URL_, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: key }),
      })
      if (!r?.ok) return null
      const body = await r.json()
      return Array.isArray(body?.tickers) ? body.tickers : null
    } catch {
      return null
    }
  })()
  cache.set(key, pending)
  if (cache.size > 50) cache.delete(cache.keys().next().value)
  const out = await pending
  if (out === null) cache.delete(key)
  return out
}

export function confirmsSymbol(tickers, symbol) {
  const want = canonicalSymbol(symbol)
  return Array.isArray(tickers) && tickers.some((t) => t?.symbol === want)
}
```

- [ ] **Step 3: Write the failing menu test (rendered text, not state)**

`B/AlertPhraseMenu.test.jsx`: build an editor with `StarterKit` + `AlertPhraseOffer` (Task 7's helper shape), with `smartChipsEnabled` mocked true and `smartChipsApi.tickersIn` mocked. Cases, each asserting what is ON SCREEN:
- "confirmed ticker shows the chip": type the NVDA sentence, mock `tickersIn` → `[{symbol:'NVDA',tier:'exact'}]`, advance fake timers by `CHECK_DELAY_MS`. Then `getByRole('toolbar', { name: 'Alert suggestion' })` contains "NVDA closes below $120.00 (daily)" and a button named "Set alert…".
- "a word the server does not confirm shows nothing": `tickersIn` → `[]` for `alert me if RS closes below 120`; no toolbar.
- "a failed check shows nothing" (Review Focus 2): `tickersIn` → `null`; no toolbar; the editor's text is unchanged.
- "a pronoun uses the note's ticker, with no network": `noteTicker="AMD"`, type `alert me if it closes below 150`; `tickersIn` not called; the chip says "AMD closes below $150.00 (daily)".
- "a pronoun with no note ticker shows nothing".
- "dismiss": click the button named "Dismiss alert suggestion"; the toolbar is gone, and the sentence is in the plugin's `dismissed`.
- "the live region speaks once per offer": the `role="status"` text is "Alert suggestion: NVDA closes below $120.00 (daily). Press Alt+Enter to set it, or Escape to dismiss." after the first offer, and does not change when the caret moves inside the paragraph.
- "Alt+Enter opens the sheet": dispatching `ALERT_OFFER_EVENT` on `editor.view.dom` renders a dialog whose accessible name is "Set an alert" (the sheet is mocked at the module boundary to a `role="dialog"` stub, so this test checks only the wiring).

- [ ] **Step 4: Write `AlertPhraseMenu.jsx`**

```jsx
// app/src/pages/journal-2-0/components/notebook/AlertPhraseMenu.jsx
/**
 * Tier 2 part A, item 8 -- the "Set alert" chip. The offer lives in editor state
 * (lib/alertPhraseOffer.js); this reads it, asks the server ONCE per sentence whether its word is
 * a ticker here (lib/smartChipsApi.js), and only then shows the chip. "it" / "the stock" / "price"
 * mean the note's ticker and need no question. The chip never sets anything: "Set alert…" (or
 * Alt+Enter) opens TextAlertSheet, filled in, and the member presses there.
 *
 * Like LinkPasteMenu: buttons keep the editor's focus (mousedown prevented); the reducer tracks the
 * plugin's offer OBJECT, so a keystroke that does not change the offer does not re-render (TY7).
 */
import { lazy, Suspense, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import { ALERT_OFFER_EVENT, alertPhraseKey, dismissAlertOffer } from '../../lib/alertPhraseOffer'
import { describeAlert } from '../../lib/alertPhrase'
import { confirmsSymbol, tickersIn } from '../../lib/smartChipsApi'
import styles from './AlertPhraseMenu.module.css'

const TextAlertSheet = lazy(() => import('./TextAlertSheet'))
export const ALERT_MENU_LABEL = 'Alert suggestion'
export const CHECK_DELAY_MS = 600

function offerReducer(prev, editor) {
  if (!editor || editor.isDestroyed) return prev
  const next = editor.isEditable ? alertPhraseKey.getState(editor.state)?.offer ?? null : null
  return next === prev ? prev : next
}

export default function AlertPhraseMenu({ editor, noteTicker }) {
  const [offer, bump] = useReducer(offerReducer, null)
  const [confirmed, setConfirmed] = useState(null)      // { offer, symbol }
  const [sheet, setSheet] = useState(null)              // initial values while open
  const [spoken, setSpoken] = useState('')
  const barRef = useRef(null)

  useEffect(() => {
    if (!editor || editor.isDestroyed) return undefined
    const update = () => bump(editor)
    editor.on('transaction', update)
    return () => { editor.off('transaction', update) }
  }, [editor])

  // Which symbol this offer means, confirmed. A pronoun is the note's own ticker (already a
  // validated field); anything else waits for typing to pause, then asks the server once.
  useEffect(() => {
    if (!offer) { setConfirmed(null); return undefined }
    if (offer.parsed.pronoun) {
      setConfirmed(noteTicker ? { offer, symbol: String(noteTicker).toUpperCase() } : null)
      return undefined
    }
    let live = true
    const t = setTimeout(async () => {
      const tickers = await tickersIn(offer.text)
      if (live && confirmsSymbol(tickers, offer.parsed.symbol)) setConfirmed({ offer, symbol: offer.parsed.symbol })
    }, CHECK_DELAY_MS)
    return () => { live = false; clearTimeout(t) }
  }, [offer, noteTicker])

  const ready = confirmed && confirmed.offer === offer ? confirmed : null
  const words = ready ? describeAlert(offer.parsed, ready.symbol) : ''

  useEffect(() => {
    if (ready) setSpoken(`Alert suggestion: ${words}. Press Alt+Enter to set it, or Escape to dismiss.`)
  }, [ready?.offer]) // eslint-disable-line react-hooks/exhaustive-deps -- once per new offer, by design

  const open = () => { if (ready) setSheet({ ...offer.parsed, symbol: ready.symbol }) }

  useEffect(() => {
    if (!editor || editor.isDestroyed) return undefined
    const dom = editor.view.dom
    const onOpen = () => open()
    dom.addEventListener(ALERT_OFFER_EVENT, onOpen)
    return () => dom.removeEventListener(ALERT_OFFER_EVENT, onOpen)
  })

  useLayoutEffect(() => {
    const bar = barRef.current
    if (!bar || !ready || !editor || editor.isDestroyed) return
    let rect = null
    try { rect = editor.view.coordsAtPos(Math.min(offer.to, editor.state.doc.content.size)) } catch { rect = null }
    if (!rect) return
    const w = bar.offsetWidth || 0
    const vw = typeof window !== 'undefined' ? window.innerWidth : 0
    bar.style.left = `${Math.round(Math.max(8, Math.min(rect.left, (vw || rect.left + w + 8) - w - 8)))}px`
    bar.style.top = `${Math.round((rect.bottom || 0) + 6)}px`
  })

  const hold = (e) => e.preventDefault()
  return (
    <>
      <span className="sr-only" role="status" aria-live="polite">{spoken}</span>
      {ready && !sheet && (
        <div ref={barRef} className={styles.bar} role="toolbar" aria-label={ALERT_MENU_LABEL}>
          <UIcon name="bell" size={14} />
          <span className={styles.words}>{words}</span>
          <button type="button" className={styles.btn} onMouseDown={hold} onClick={open}>Set alert…</button>
          <button type="button" className={styles.icon} onMouseDown={hold} onClick={() => dismissAlertOffer(editor)}
            aria-label="Dismiss alert suggestion"><UIcon name="close" size={14} /></button>
        </div>
      )}
      {sheet && (
        <Suspense fallback={null}>
          <TextAlertSheet
            open
            initial={sheet}
            onClose={() => { setSheet(null); editor?.commands?.focus?.() }}
            onDone={(text) => {
              setSheet(null)
              dismissAlertOffer(editor)
              editor?.storage?.uctJournalWidgets?.notify?.(text, 'success')
            }}
          />
        </Suspense>
      )}
    </>
  )
}
```
`UIcon` names `bell` and `close`: check they exist in `app/src/components/ui/UIcon.jsx`'s registry, and if not, use the nearest existing names. If V13 says `notify` takes no success tone, call it the way V13 records. CSS: `.bar` copies `LinkPasteMenu.module.css`'s `.bar` (fixed, z-index, surface tokens). `.btn` and `.icon` have `min-height: var(--tap-min)` (and `min-width` for `.icon`) inside the TOUCH media query `@media (max-width:1024px)`. `.words` truncates with an ellipsis at `max-width: 32ch`.

- [ ] **Step 5: Write the failing sheet test (Review Focus 5)**

`B/TextAlertSheet.test.jsx`. Mock `alertCommand.setAlert` / `currentPrice` and `useIndicatorAlerts.createIndicatorAlert` / `useIndicatorAlertCatalog` (the catalog returns address `close` with conditions `below` and `above`, as V12 shapes it). Cases:
- "filled in from the sentence": `initial={symbol:'NVDA', mode:'close', direction:'below', price:120, tf:'D'}`. The symbol box shows NVDA, the "When" select shows "Closes below", the price box shows 120, the timeframe shows Daily, and the heading is "Set an alert".
- "a close becomes a closed-bar indicator alert": press "Set alert". `createIndicatorAlert` is called with `{ sym:'NVDA', indicator:'close', condition:'below', threshold:120, tf:'D' }`, and `onDone` is called with "Alert set: NVDA closes below $120.00 on the daily chart. It rings the bell, and sends email or Discord if you have those on."
- "intraday goes through setAlert": `mode:'intraday', direction:'above', price:130`. `setAlert` is called with `{ sym:'NVDA', price:130, direction:'above' }`, and `onDone` receives the text `setAlert` resolved with.
- "typo guard on both paths": with `currentPrice` → 12, a close at 120 (10x away) shows "$120.00 is more than 10 times away from NVDA's price ($12.00), so it looks like a typo. Nothing was set." and `createIndicatorAlert` is NOT called. The intraday path shows `setAlert`'s rejection `memberText` verbatim.
- "no direction and no price shows the setAlert sentence": `direction:null` and `setAlert` rejects with `memberText` "No current price for NVDA right now…". That text is shown and `onDone` is not called.
- "a refusal from the indicator route is shown, nothing set": `createIndicatorAlert` → `{ ok:false, error:'Price alerts need a paid plan.' }`. That sentence is shown and `onDone` is not called.
- "the catalog has no close address: only intraday choices": the catalog returns `[]`. The "When" select has only "Trades below/above", and a line reads "Close alerts are not available right now."
- "Cancel sets nothing": press Cancel. `onClose` is called, and no create is called.

- [ ] **Step 6: Write `TextAlertSheet.jsx`**

```jsx
// app/src/pages/journal-2-0/components/notebook/TextAlertSheet.jsx
/**
 * Tier 2 part A, item 8 / R-T2A-4 -- the sheet the "Set alert" chip opens, FILLED IN from the
 * sentence. Every field stays editable and nothing is set until "Set alert" is pressed.
 * It holds no create logic of its own (R-T2A-4, R-T2A-5):
 *   closes  -> createIndicatorAlert({sym, indicator:'close', condition, threshold, tf})  (closed bar)
 *   trades  -> alertCommand.setAlert({sym, price, direction})                           (intraday)
 * Both paths pass the same typo guard (MAX_DISTANCE) before anything is sent.
 */
import { useEffect, useState } from 'react'
import Sheet from '../../../../components/mobile/Sheet'
import { MAX_DISTANCE, currentPrice, money, setAlert } from '../../../terminal/alertCommand'
import { createIndicatorAlert, useIndicatorAlertCatalog } from '../../../../hooks/useIndicatorAlerts'
import styles from './TextAlertSheet.module.css'

const WHEN = [
  { id: 'close-below', mode: 'close', direction: 'below', label: 'Closes below' },
  { id: 'close-above', mode: 'close', direction: 'above', label: 'Closes above' },
  { id: 'trade-below', mode: 'intraday', direction: 'below', label: 'Trades below' },
  { id: 'trade-above', mode: 'intraday', direction: 'above', label: 'Trades above' },
  { id: 'trade-reach', mode: 'intraday', direction: null, label: 'Reaches (above or below)' },
]

function closeAvailable(catalog) {
  const close = (catalog || []).find((a) => a?.address === 'close' || a?.indicator === 'close')
  const conds = new Set((close?.conditions || []).map((c) => c?.id || c))
  return conds.has('below') && conds.has('above')
}

function startWhen(initial, canClose) {
  if (initial?.mode === 'close' && canClose) return `close-${initial.direction || 'below'}`
  if (!initial?.direction) return 'trade-reach'
  return `trade-${initial.direction}`
}

export default function TextAlertSheet({ open, initial, onClose, onDone }) {
  const { catalog, isLoading } = useIndicatorAlertCatalog()
  const canClose = closeAvailable(catalog)
  const [symbol, setSymbol] = useState(initial?.symbol || '')
  const [when, setWhen] = useState(() => startWhen(initial, true))
  const [price, setPrice] = useState(initial?.price != null ? String(initial.price) : '')
  const [tf, setTf] = useState(initial?.tf === 'W' ? 'W' : 'D')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState('')

  useEffect(() => {
    if (!isLoading && !canClose && when.startsWith('close')) setWhen(startWhen({ ...initial, mode: 'intraday' }, false))
  }, [isLoading, canClose]) // eslint-disable-line react-hooks/exhaustive-deps

  const choice = WHEN.find((w) => w.id === when) || WHEN[2]
  const options = WHEN.filter((w) => canClose || w.mode !== 'close')

  const submit = async (e) => {
    e?.preventDefault?.()
    const sym = symbol.trim().replace(/^\$/, '').toUpperCase()
    const p = Number(price)
    if (!sym) { setSaid('Type a ticker.'); return }
    if (!Number.isFinite(p) || p <= 0) { setSaid('Type a price above zero.'); return }
    setBusy(true); setSaid('')
    try {
      if (choice.mode === 'close') {
        const now = await currentPrice(sym)
        if (now && (p > now * MAX_DISTANCE || p < now / MAX_DISTANCE)) {
          setSaid(`${money(p)} is more than ${MAX_DISTANCE} times away from ${sym}'s price (${money(now)}), so it looks like a typo. Nothing was set.`)
          return
        }
        const out = await createIndicatorAlert({ sym, indicator: 'close', condition: choice.direction, threshold: p, tf })
        if (!out.ok) { setSaid(out.error); return }
        onDone(`Alert set: ${sym} closes ${choice.direction} ${money(p)} on the ${tf === 'W' ? 'weekly' : 'daily'} chart. It rings the bell, and sends email or Discord if you have those on.`)
      } else {
        const out = await setAlert({ sym, price: p, direction: choice.direction })
        onDone(out.text)
      }
    } catch (err) {
      setSaid(err?.memberText || `The alert for ${sym} could not be saved just now. Nothing was set; try again.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Set an alert" variant="auto">
      <form className={styles.form} onSubmit={submit}>
        <label className={styles.field}>Ticker
          <input value={symbol} onChange={(e) => setSymbol(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
        <label className={styles.field}>When
          <select value={when} onChange={(e) => setWhen(e.target.value)}>
            {options.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
          </select>
        </label>
        <label className={styles.field}>Price
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
        </label>
        {choice.mode === 'close' && (
          <label className={styles.field}>Chart
            <select value={tf} onChange={(e) => setTf(e.target.value)}>
              <option value="D">Daily</option>
              <option value="W">Weekly</option>
            </select>
          </label>
        )}
        {!isLoading && !canClose && <p className={styles.note}>Close alerts are not available right now.</p>}
        <p className={styles.note}>
          {choice.mode === 'close'
            ? 'Rings once, after a bar closes beyond your price.'
            : 'Rings once, the first time the live price crosses your price.'}
        </p>
        <p role="status" aria-live="polite" className={styles.said}>{said}</p>
        <div className={styles.actions}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>Set alert</button>
        </div>
      </form>
    </Sheet>
  )
}
```
Adjust the `Sheet` props, the catalog's address/condition field names and the import paths to what V11 and V12 recorded. The "Rings once" sentences restate the products' documented behaviour (`watchlist-alerts` fires once; the indicator alert's `trigger_policy` default per V12). If V12 shows the indicator default is not "once", fix that sentence to the real default.

- [ ] **Step 7: Mount the menu in `NoteEditorPage.jsx`**

Next to `<LinkPasteMenu editor={editor} />`:
```jsx
        {smartChipsEnabled() && (
          <Suspense fallback={null}><AlertPhraseMenu editor={editor} noteTicker={note?.ticker || null} /></Suspense>
        )}
```
with `const AlertPhraseMenu = lazy(() => import('./AlertPhraseMenu'))` beside the page's other lazy imports, and `smartChipsEnabled` imported from `../../lib/smartChipsFlag`.

- [ ] **Step 8: Run the task's files**

Run: `cd $WT/app && npx vitest run src/pages/journal-2-0/lib/smartChipsApi.test.js src/pages/journal-2-0/components/notebook/AlertPhraseMenu.test.jsx src/pages/journal-2-0/components/notebook/TextAlertSheet.test.jsx src/pages/command/keyListenerCensus.test.js src/components/screener/reachable.test.js; code=$?; exit $code`
Expected: all pass.

- [ ] **Step 9: Commit** (`feat(notebook): "Set alert" chip and the prefilled alert sheet (dark)`; push).

---

### Task 9: Screenshot reading, the pure halves

**Files:**
- Create: `J/lib/screenshotSmarts.js` + `screenshotSmarts.test.js`; `J/lib/screenshotRead.js` + `screenshotRead.test.js`

**Interfaces:**
- Consumes: `tickersIn` (Task 8). Routes per V9: `GET /api/j2/notes/{noteId}/documents`, `GET /api/j2/notes/documents/{documentId}/pages/1/text`.
- Produces: `HEADER_CHARS = 400`; `timeframeFromText(text) -> null | { tf, label }` (`label` is "Daily", "Weekly", "Monthly", "1 hour", "4 hour", "5 minute", "15 minute", "30 minute"); `pickTicker(tickers) -> string | null`; `altFor({ symbol, timeframe }) -> string`; `readScreenshot({ noteId, url, signal, fetchImpl?, sleep? }) -> Promise<null | { symbol, timeframe }>`; `POLL_DELAYS_MS = [1500, 2000, 3000, 4000, 5000, 6000, 8000, 10000, 10000, 10000]` (about 60 s in all).

- [ ] **Step 1: Write the failing grammar test**

```js
// app/src/pages/journal-2-0/lib/screenshotSmarts.test.js
import { describe, expect, it } from 'vitest'
import { altFor, pickTicker, timeframeFromText } from './screenshotSmarts'

describe('timeframeFromText (R-T2A-9)', () => {
  it.each([
    ['NVIDIA Corporation · 1D · NASDAQ', 'D', 'Daily'],
    ['NVDA, D  O182.1 H184 L180', 'D', 'Daily'],
    ['NVDA Daily chart', 'D', 'Daily'],
    ['AMD · 1W · NASDAQ', 'W', 'Weekly'],
    ['SPY Weekly', 'W', 'Weekly'],
    ['QQQ Monthly', 'M', 'Monthly'],
    ['TSLA · 1h', '60', '1 hour'],
    ['TSLA · 4H', '240', '4 hour'],
    ['TSLA 15m', '15', '15 minute'],
    ['TSLA 5 min', '5', '5 minute'],
    ['TSLA 30min', '30', '30 minute'],
  ])('%s', (text, tf, label) => { expect(timeframeFromText(text)).toEqual({ tf, label }) })

  it.each([
    'NVDA · 1M · NASDAQ',          // minute or month: ignored
    'NVDA M',                      // same
    'NVDA 182.40 60 120',          // bare numbers are prices, not timeframes
    'daily and weekly together',   // a conflict is no answer
    'd w',                         // lower-case single letters are OCR noise
    '',
  ])('%s -> null', (text) => { expect(timeframeFromText(text)).toBeNull() })

  it('reads only the header window', () => {
    expect(timeframeFromText(`${'x '.repeat(300)} NVDA Daily`)).toBeNull()
  })
})

describe('pickTicker (R-T2A-7)', () => {
  it('one confident symbol', () => { expect(pickTicker([{ symbol: 'NVDA', tier: 'exact' }])).toBe('NVDA') })
  it('the same symbol twice is still one', () => {
    expect(pickTicker([{ symbol: 'NVDA', tier: 'alias' }, { symbol: 'NVDA', tier: 'exact' }])).toBe('NVDA')
  })
  it('two symbols: no guess', () => {
    expect(pickTicker([{ symbol: 'NVDA', tier: 'exact' }, { symbol: 'AMD', tier: 'exact' }])).toBeNull()
  })
  it('contextual (lower-case) matches never count', () => { expect(pickTicker([{ symbol: 'DELL', tier: 'contextual' }])).toBeNull() })
  it('nothing, or a failed check', () => { expect(pickTicker([])).toBeNull(); expect(pickTicker(null)).toBeNull() })
})

describe('altFor (R-T2A-8)', () => {
  it('names the screenshot', () => {
    expect(altFor({ symbol: 'NVDA', timeframe: { tf: 'D', label: 'Daily' } })).toBe('NVDA daily chart')
    expect(altFor({ symbol: 'NVDA', timeframe: null })).toBe('NVDA chart')
  })
})
```

- [ ] **Step 2: Write `screenshotSmarts.js`**

```js
// app/src/pages/journal-2-0/lib/screenshotSmarts.js
/**
 * Tier 2 part A, item 10 -- reading a pasted chart screenshot's OCR text. Pure.
 * ⛔ Only the HEADER (the first HEADER_CHARS characters) is read: a chart's symbol and timeframe
 * live there; the rest is axis numbers and indicator names (R-T2A-7).
 * ⛔ Ambiguous tokens are ignored (R-T2A-9): "1M"/"M" (minute or month), bare numbers, lower-case
 * single letters. A conflict between two timeframes is no answer.
 */
export const HEADER_CHARS = 400

const EXACT = new Map([
  ['1D', ['D', 'Daily']], ['D', ['D', 'Daily']], ['1W', ['W', 'Weekly']], ['W', ['W', 'Weekly']],
  ['1H', ['60', '1 hour']], ['4H', ['240', '4 hour']],
])
const FOLDED = new Map([
  ['1d', ['D', 'Daily']], ['daily', ['D', 'Daily']], ['1w', ['W', 'Weekly']], ['weekly', ['W', 'Weekly']],
  ['monthly', ['M', 'Monthly']], ['1h', ['60', '1 hour']], ['4h', ['240', '4 hour']], ['60m', ['60', '1 hour']],
  ['5m', ['5', '5 minute']], ['15m', ['15', '15 minute']], ['30m', ['30', '30 minute']],
  ['5min', ['5', '5 minute']], ['15min', ['15', '15 minute']], ['30min', ['30', '30 minute']],
])

export function timeframeFromText(text) {
  const head = String(text ?? '').slice(0, HEADER_CHARS).replace(/(\d+)\s+min\b/gi, '$1min')
  const found = new Map()
  for (const tok of head.split(/[\s,·|•/()[\]]+/).filter(Boolean)) {
    const hit = EXACT.get(tok) || (tok.length > 1 && !/^[A-Z]$/.test(tok) ? FOLDED.get(tok.toLowerCase()) : null)
    if (hit) found.set(hit[0], hit[1])
  }
  if (found.size !== 1) return null
  const [[tf, label]] = [...found]
  return { tf, label }
}

const CONFIDENT = new Set(['cashtag', 'alias', 'exact'])
export function pickTicker(tickers) {
  if (!Array.isArray(tickers)) return null
  const syms = new Set(tickers.filter((t) => CONFIDENT.has(t?.tier)).map((t) => t.symbol))
  return syms.size === 1 ? [...syms][0] : null
}

export function altFor({ symbol, timeframe }) {
  return timeframe ? `${symbol} ${timeframe.label.toLowerCase()} chart` : `${symbol} chart`
}
```
Check in the tests: `'d w'` gives null (single lower-case letters fold to nothing because `d`/`w` are not FOLDED keys), and `'NVDA M'` gives null (`M` is in neither map).

- [ ] **Step 3: Write the failing poll test**

```js
// app/src/pages/journal-2-0/lib/screenshotRead.test.js
import { describe, expect, it, vi } from 'vitest'
vi.mock('./smartChipsApi', () => ({ tickersIn: vi.fn(async () => [{ symbol: 'NVDA', tier: 'exact' }]) }))
import { tickersIn } from './smartChipsApi'
import { POLL_DELAYS_MS, readScreenshot } from './screenshotRead'

const URL_ = '/api/j2/notes/n1/images/a.png'
const res = (body) => ({ ok: true, json: async () => body })
const noSleep = async () => {}

function server(statuses, text = 'NVDA · 1D · NASDAQ') {
  let i = 0
  return vi.fn(async (url) => {
    if (url.endsWith('/documents')) {
      const status = statuses[Math.min(i++, statuses.length - 1)]
      return res({ documents: [{ id: 'd1', attachmentUrl: URL_, status, pagesWithText: status === 'ready' ? 1 : 0 }] })
    }
    if (url.includes('/pages/1/text')) return res({ text, available: true })
    throw new Error(`unexpected ${url}`)
  })
}

describe('readScreenshot', () => {
  it('waits for OCR, reads the header, confirms the ticker', async () => {
    const f = server(['pending', 'pending', 'ready'])
    expect(await readScreenshot({ noteId: 'n1', url: URL_, fetchImpl: f, sleep: noSleep }))
      .toEqual({ symbol: 'NVDA', timeframe: { tf: 'D', label: 'Daily' } })
    expect(tickersIn).toHaveBeenCalledWith('NVDA · 1D · NASDAQ', f)
  })
  it('gives up after the bounded schedule', async () => {
    const f = server(['pending'])
    expect(await readScreenshot({ noteId: 'n1', url: URL_, fetchImpl: f, sleep: noSleep })).toBeNull()
    expect(f.mock.calls.filter(([u]) => u.endsWith('/documents'))).toHaveLength(POLL_DELAYS_MS.length)
  })
  it('no text, or OCR off, is no offer', async () => {
    expect(await readScreenshot({ noteId: 'n1', url: URL_, fetchImpl: server(['no_text']), sleep: noSleep })).toBeNull()
  })
  it('an aborted read stops at once and says nothing', async () => {
    const ctrl = new AbortController(); ctrl.abort()
    const f = server(['ready'])
    expect(await readScreenshot({ noteId: 'n1', url: URL_, fetchImpl: f, sleep: noSleep, signal: ctrl.signal })).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
  it('two tickers in the header: no offer', async () => {
    tickersIn.mockResolvedValueOnce([{ symbol: 'NVDA', tier: 'exact' }, { symbol: 'AMD', tier: 'exact' }])
    expect(await readScreenshot({ noteId: 'n1', url: URL_, fetchImpl: server(['ready']), sleep: noSleep })).toBeNull()
  })
})
```

- [ ] **Step 4: Write `screenshotRead.js`**

```js
// app/src/pages/journal-2-0/lib/screenshotRead.js
/**
 * Tier 2 part A, item 10 -- the network half: wait for the OCR the document pipeline already runs
 * on a pasted image (its text is NOT in the upload's answer), read page 1's header, ask the server
 * which ticker it names. BOUNDED: POLL_DELAYS_MS (about a minute) and then silence. Abortable: a
 * deleted image, another note, or an unmounted editor stops it (Review Focus 3). Never throws.
 */
import { pickTicker, timeframeFromText, HEADER_CHARS } from './screenshotSmarts'
import { tickersIn } from './smartChipsApi'

export const POLL_DELAYS_MS = [1500, 2000, 3000, 4000, 5000, 6000, 8000, 10000, 10000, 10000]
const DONE = new Set(['ready', 'no_text', 'processing_failed'])
const realSleep = (ms, signal) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms)
  signal?.addEventListener?.('abort', () => { clearTimeout(t); resolve() }, { once: true })
})

async function getJson(fetchImpl, url, signal) {
  try {
    const r = await fetchImpl(url, { credentials: 'include', signal })
    return r?.ok ? await r.json() : null
  } catch {
    return null
  }
}

export async function readScreenshot({ noteId, url, signal, fetchImpl = globalThis.fetch, sleep = realSleep }) {
  if (!noteId || !url || signal?.aborted) return null
  let doc = null
  for (const ms of POLL_DELAYS_MS) {
    await sleep(ms, signal)
    if (signal?.aborted) return null
    const body = await getJson(fetchImpl, `/api/j2/notes/${encodeURIComponent(noteId)}/documents`, signal)
    const found = (body?.documents || []).find((d) => d?.attachmentUrl === url)
    if (found && DONE.has(found.status)) { doc = found; break }
  }
  if (!doc || doc.status !== 'ready' || signal?.aborted) return null
  const page = await getJson(fetchImpl, `/api/j2/notes/documents/${encodeURIComponent(doc.id)}/pages/1/text`, signal)
  const head = typeof page?.text === 'string' ? page.text.slice(0, HEADER_CHARS) : ''
  if (!head.trim() || signal?.aborted) return null
  const symbol = pickTicker(await tickersIn(head, fetchImpl))
  if (!symbol || signal?.aborted) return null
  return { symbol, timeframe: timeframeFromText(head) }
}
```
If V9 shows a different list shape or status names, fix the code and the test fixtures together, and record it in the task report.

- [ ] **Step 5: Run both test files**

Run: `cd $WT/app && npx vitest run src/pages/journal-2-0/lib/screenshotSmarts.test.js src/pages/journal-2-0/lib/screenshotRead.test.js; code=$?; exit $code`
Expected: PASS.

- [ ] **Step 6: Commit** (`feat(notebook): screenshot header reading (timeframe grammar, one-ticker rule, bounded OCR wait)`; push).

---

### Task 10: The screenshot chip

**Files:**
- Create: `B/ScreenshotTagOffer.jsx` + `ScreenshotTagOffer.module.css` + `B/screenshotOffer.test.jsx`
- Modify: `B/NoteEditorPage.jsx` (`handleImageInsert`, the offer state, the accept path, mount)

**Interfaces:**
- Consumes: `readScreenshot`, `altFor` (Task 9); `smartChipsEnabled`; `notebookFlag('notebook_image_docx_documents_enabled')`; `update` + `settleMetadataRevision` (the metadata door used by `onTickerChange`).
- Produces: `findImagePos(doc, src) -> number | null`, `labelImage(editor, src, alt) -> boolean` (both exported from `ScreenshotTagOffer.jsx` for tests); `ScreenshotTagOffer({ editor, offer, noteTicker, onAccept, onDismiss })`; the offer `{ url, symbol, timeframe }`.

- [ ] **Step 1: Write the failing tests**

`B/screenshotOffer.test.jsx`. Render the real `ScreenshotTagOffer` over an editor holding `<p>x</p><img src="/a.png">` (the image node name per V8). Cases:
- "the chip names what it will do": with `noteTicker=null` the toolbar named "Screenshot tag" shows a button "Tag NVDA · Daily". With `noteTicker="AMD"` it shows "Tag image NVDA · Daily". With `timeframe=null` it shows "Tag NVDA".
- "accept labels the image": `labelImage(editor, '/a.png', 'NVDA daily chart')` returns true, and the image node's `alt` is "NVDA daily chart" in `editor.getJSON()`.
- "image gone" (Review Focus 3): delete the image, then render. Nothing renders, and `labelImage` returns false.
- "dismiss": the button named "Dismiss screenshot tag" calls `onDismiss`.
And in a NoteEditorPage-level test (V3: the existing page test harness), with `readScreenshot` mocked:
- "accept sets the note ticker only when it has none": with no ticker, accepting calls `update({ ticker: 'NVDA' })` once and the toast reads "Tagged the screenshot NVDA · Daily and set this note's ticker to NVDA." With ticker AMD, `update` is not called and the toast reads "Tagged the screenshot NVDA · Daily."
- "note changed" (Review Focus 3): start a paste in note n1 and switch the page to note n2 before `readScreenshot` resolves. The read's `signal` is aborted and no offer renders in n2.
- "switch off: no poll": with `smartChipsEnabled()` false, pasting an image does not call `readScreenshot`.

- [ ] **Step 2: Write `ScreenshotTagOffer.jsx`**

```jsx
// app/src/pages/journal-2-0/components/notebook/ScreenshotTagOffer.jsx
/**
 * Tier 2 part A, item 10 -- "Tag NVDA · Daily" on a pasted chart screenshot, ONE TAP, never
 * automatic. Accepting labels the image (its alt: an editor transaction on the note's own save
 * path) and, when the note has no ticker yet, the page sets it through the metadata door
 * (R-T2A-8). Floated under the image; gone when the image is.
 */
import { useLayoutEffect, useRef } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import styles from './ScreenshotTagOffer.module.css'

export const SCREENSHOT_OFFER_LABEL = 'Screenshot tag'
const IMAGE = 'image'   // V8: the image node's type name

export function findImagePos(doc, src) {
  let at = null
  doc.descendants((n, pos) => {
    if (at != null) return false
    if (n.type.name === IMAGE && n.attrs.src === src) { at = pos; return false }
    return true
  })
  return at
}

export function labelImage(editor, src, alt) {
  if (!editor || editor.isDestroyed || !editor.isEditable) return false
  const pos = findImagePos(editor.state.doc, src)
  if (pos == null) return false
  const node = editor.state.doc.nodeAt(pos)
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, alt }))
  return true
}

export function offerWords(offer, noteTicker) {
  const what = offer.timeframe ? `${offer.symbol} · ${offer.timeframe.label}` : offer.symbol
  const other = noteTicker && String(noteTicker).toUpperCase() !== offer.symbol
  return other ? `Tag image ${what}` : `Tag ${what}`
}

export default function ScreenshotTagOffer({ editor, offer, noteTicker, onAccept, onDismiss }) {
  const barRef = useRef(null)
  const pos = editor && !editor.isDestroyed ? findImagePos(editor.state.doc, offer.url) : null

  useLayoutEffect(() => {
    const bar = barRef.current
    if (!bar || pos == null) return
    const dom = editor.view.nodeDOM(pos)
    const rect = dom?.getBoundingClientRect?.()
    if (!rect) return
    bar.style.left = `${Math.round(Math.max(8, rect.left))}px`
    bar.style.top = `${Math.round(rect.bottom + 6)}px`
  })

  if (pos == null) return null
  const hold = (e) => e.preventDefault()
  return (
    <div ref={barRef} className={styles.bar} role="toolbar" aria-label={SCREENSHOT_OFFER_LABEL}>
      <button type="button" className={styles.btn} onMouseDown={hold} onClick={() => onAccept(offer)}>
        <UIcon name="tag" size={14} /> <span>{offerWords(offer, noteTicker)}</span>
      </button>
      <button type="button" className={styles.icon} onMouseDown={hold} onClick={onDismiss}
        aria-label="Dismiss screenshot tag"><UIcon name="close" size={14} /></button>
    </div>
  )
}
```
(Check the `tag` and `close` UIcon names exist, as in Task 8.) The CSS copies `AlertPhraseMenu.module.css`'s bar, with the same tap floors.

- [ ] **Step 3: Wire it into `NoteEditorPage.jsx`**

State and the abortable read, beside the other refs:
```js
  // Tier 2 part A, item 10: the screenshot chip. ONE offer at a time (the newest paste); the read
  // is aborted when another image is pasted, the note changes, or the page unmounts.
  const [screenshotOffer, setScreenshotOffer] = useState(null)
  const screenshotReadRef = useRef(null)
  useEffect(() => () => { screenshotReadRef.current?.abort() }, [noteId])
  useEffect(() => { setScreenshotOffer(null) }, [noteId])
  const startScreenshotRead = async (url) => {
    screenshotReadRef.current?.abort()
    const ctrl = new AbortController()
    screenshotReadRef.current = ctrl
    const forNote = noteId
    // The poll and its network code load only when a screenshot is pasted with the switch on.
    const { readScreenshot } = await import('../../lib/screenshotRead')
    const found = await readScreenshot({ noteId: forNote, url, signal: ctrl.signal })
    if (!found || ctrl.signal.aborted) return
    setScreenshotOffer({ url, ...found, noteId: forNote })
  }
```
In `handleImageInsert`, after `ed.chain().focus().setImage({ src: url, alt: '' }).run()`:
```js
      if (smartChipsEnabled() && notebookFlag('notebook_image_docx_documents_enabled') === true) {
        refreshDocuments()      // the attachment path's "the id exists the moment the chip does"
        startScreenshotRead(url)
      }
```
The accept path:
```js
  const acceptScreenshotTag = async (offer) => {
    setScreenshotOffer(null)
    const ed = editorRef.current
    const words = offer.timeframe ? `${offer.symbol} · ${offer.timeframe.label}` : offer.symbol
    if (offer.noteId !== noteId || !labelImage(ed, offer.url, altFor(offer))) {
      setUploadToast({ message: "Couldn't tag the screenshot — it is no longer in this note. Nothing changed.", tone: 'error' })
      return
    }
    if (note?.ticker) {
      setUploadToast({ message: `Tagged the screenshot ${words}.`, tone: 'success' })
      return
    }
    try {
      await settleMetadataRevision(await update({ ticker: offer.symbol }))
      if (tickerInputRef.current) tickerInputRef.current.value = offer.symbol
      setUploadToast({ message: `Tagged the screenshot ${words} and set this note's ticker to ${offer.symbol}.`, tone: 'success' })
    } catch {
      setUploadToast({ message: `Tagged the screenshot ${words}. Couldn't set the note's ticker; nothing else changed.`, tone: 'error' })
    }
  }
```
Mount, next to the alert menu:
```jsx
        {screenshotOffer && screenshotOffer.noteId === noteId && (
          <Suspense fallback={null}>
            <ScreenshotTagOffer editor={editor} offer={screenshotOffer} noteTicker={note?.ticker || null}
              onAccept={acceptScreenshotTag} onDismiss={() => setScreenshotOffer(null)} />
          </Suspense>
        )}
```
Lazy-import `ScreenshotTagOffer`. The accept path needs `labelImage` and `findImagePos` eagerly, so they live in a tiny `J/lib/screenshotLabel.js`, not in the lazy component file; `ScreenshotTagOffer.jsx` re-exports them for its tests. `altFor` is imported statically from `screenshotSmarts.js`, which is pure and small. Only `screenshotRead.js` (the poll and its network code) is a dynamic import, as written above, so it stays out of the first-open closure.

- [ ] **Step 4: Run the task's files and the door census**

Run: `cd $WT/app && npx vitest run src/pages/journal-2-0/components/notebook/screenshotOffer.test.jsx src/pages/journal-2-0/lib/offline/doorEnumeration.test.js src/components/screener/reachable.test.js; code=$?; exit $code`
Expected: all pass. The census still lists the metadata door's call site under `settleMetadataRevision`.

- [ ] **Step 5: Commit** (`feat(notebook): "Tag NVDA · Daily" chip on a pasted chart screenshot (dark)`; push).

---

### Task 11: The rails

**Files:**
- Modify: `J/a11y/notebookSurfaces.js`; create `J/a11y/smartChips.a11y.test.jsx`; `tools/notebook_fin_walk_features.py`; `tools/notebook_door_audit_doors.json` (+ `tests/test_notebook_door_audit.py`'s required set if it lists rows); `docs/notebook/screen-reader-pass.md`; `tools/notebook_nvda_pass.py`
- Create: `docs/notebook/evidence/t2a-perf-<run-id>/` (raw), `docs/notebook/perf-runs/t2a/RESULT.md`

- [ ] **Step 1: The a11y population**

Add entries for `components/notebook/AlertPhraseMenu.jsx` (`{ recipe: 'smart-alert-chip' }`), `components/notebook/TextAlertSheet.jsx` (`{ recipe: 'smart-alert-sheet' }`) and `components/notebook/ScreenshotTagOffer.jsx` (`{ recipe: 'smart-screenshot-chip' }`). Write `smartChips.a11y.test.jsx` with the three recipes over `a11y/axeHarness.js` and `a11y/fixtures.jsx`. A recipe that types ends with `landPendingAutosave()`. Each recipe asserts axe finds no violations AND that the controls have the accessible names this plan specifies ("Alert suggestion", "Set alert…", "Dismiss alert suggestion", the dialog "Set an alert", "Screenshot tag", "Dismiss screenshot tag").
Run: `cd $WT/app && npx vitest run src/pages/journal-2-0/a11y/smartChips.a11y.test.jsx src/pages/journal-2-0/a11y/surfaceCoverage.test.js src/pages/journal-2-0/a11y/ariaCoverage.test.js src/pages/journal-2-0/a11y/targetFloors.test.js src/pages/journal-2-0/a11y/phoneOverflow.test.js src/pages/journal-2-0/a11y/notebookContrast.test.js src/styles/tapFloor.test.js; code=$?; exit $code`

- [ ] **Step 2: Walk steps**

In `tools/notebook_fin_walk_features.py`, add a `smart_chips()` group beside `blocks()`, gated on the new flag's payload key, with three steps at 1280 / 820 / 390:
- `smart.plan-slash`: in a seeded note, type `/plan NVDA` and Enter. Wait for the toast "Trade plan for NVDA created and linked". Open the link. Assert the opened note has the chart, the sizing and checklist blocks, and either a "Price when planned" line or none (the sandbox has no live price; both are a PASS, and the row records which).
- `smart.alert-chip`: type `alert me if NVDA closes below 120`. Wait for the toolbar "Alert suggestion". Press Alt+Enter. Assert the dialog "Set an alert" is filled in. Press Cancel and assert no alert row was created (`GET /api/indicator-alerts` count unchanged).
- `smart.screenshot-tag`: paste `tools/fixtures/chart-header-nvda-1d.png` (create it: a 900x500 PNG whose top-left reads "NVDA · 1D · NASDAQ" in 18 px sans text on a dark background, made with Pillow in a committed generator script beside the walk). Wait up to 60 s for "Tag NVDA · Daily". Accept it, and assert the image's alt and the note ticker. If the sandbox has no OCR engine (`ocrUnavailable`), the step is INCONCLUSIVE with that reason, never FAIL.

- [ ] **Step 3: Door audit rows**

Add three rows to `tools/notebook_door_audit_doors.json` in row 57's shape: "Trade plan from the slash menu (Tier 2)" (`{'type': '\n/plan NVDA'}`, target option `~^Trade plan — NVDA`), "Alert chip on a typed sentence (Tier 2)" (target toolbar "Alert suggestion"), and "Screenshot tag offer (Tier 2)" (target toolbar "Screenshot tag", viewports 1280 and 390). Flags: `NOTEBOOK_JOURNAL_STYLES_ENABLED` for the first, `NOTEBOOK_SMART_CHIPS_ENABLED` for the other two. Run `python -m pytest tests/test_notebook_door_audit.py -q`.

- [ ] **Step 4: Screen-reader rows**

Add rows 39-41 to `docs/notebook/screen-reader-pass.md` and the driver in `tools/notebook_nvda_pass.py`, quoting the accessible names from the components with `file:line`:
- 39: the alert suggestion is announced once ("Alert suggestion: … Press Alt+Enter to set it, or Escape to dismiss.").
- 40: Alt+Enter opens "Set an alert" with focus inside, and Escape returns focus to the editor.
- 41: the screenshot chip's button reads "Tag NVDA · Daily".
These rows run in Task 12's NVDA pass. They are driven only while both switches are on in the sandbox.

- [ ] **Step 5: Perf, bytes and typing (R-RAW)**

```bash
cd $WT/app && npm run build > /tmp/t2a-build.log 2>&1; code=$?; tail -3 /tmp/t2a-build.log; exit $code
```
```bash
cd $WT && python tools/notebook_perf_budgets.py --dist app/dist > docs/notebook/evidence/t2a-perf-$(date -u +%Y%m%dT%H%M%SZ)-bytes.txt 2>&1; code=$?; exit $code
```
Expected: within `notebook_first_open.max`, and within V14's base + 4,096 B. If over, move `parseAlertPhrase` behind a lazy stub (the plugin calls a tiny sync pre-check `/alert/i` and imports the parser on first match, keeping the last answer per text), then re-measure.
Typing, on a quiet box (free memory checked first; nothing else running), with the smart chips switch ON in the sandbox:
```bash
cd $WT && python tools/notebook_perf_harness.py --boot --busy --sizes 1,1000,2000 --opens 20 --chars 60 --out docs/notebook/evidence/t2a-perf-typing > docs/notebook/evidence/t2a-perf-typing.log 2>&1; code=$?; exit $code
```
and again with `--with-blocks`. (Pass the sandbox data dir from PowerShell or single-quoted, per CLAUDE.md. If `--out` is not a flag of the harness, record where it writes, and copy the raw files into the evidence directory.) Commit the raw evidence first. Then write `docs/notebook/perf-runs/t2a/RESULT.md`: busy-time p95 per size against 4.94 / 7.07 / 9.37 ms, and the 2,000-paragraph figure against F-LONGNOTE-TYPING's ~16 ms. A regression beyond run-to-run noise (the A/B evidence in `docs/notebook/perf-runs/p2b-ab/` gives the noise band) is a STOP: report it, and do not move a budget.

- [ ] **Step 6: Commit** the rails and the RESULT (raw evidence already committed); push.

---

### Task 12: Gate, walk, PR and the arming packet

**Files:**
- Create: `docs/notebook/t2a-arming.md`
- No product code.

- [ ] **Step 1: The six-shard gate, from a SEPARATE worktree of the tip**

The gate never shares a worktree with an implementer. Use `C:\Users\Patrick\uct-worktrees\notebook-t2a-gate`, on branch `notebook-t2a-gate` checked out at the tip, with the same junction rule. Run `python scripts/gate_shards.py --shards 6` there and read the manifest: the totals lines, the file-count reconciliation, and `GATE EXIT`. Expected: 0 NEW failures against the baseline it records. Then the scoped Python rails touched by this plan, by name: `tests/test_notebook_smart_chips.py tests/test_plan_prefill.py tests/test_prep_create_budget.py tests/test_journal_styles_store.py tests/test_trader_blocks_no_note_door.py tests/test_notebook_flags.py tests/test_notebook_flag_parse.py tests/test_feature_flag_ledger.py tests/test_notebook_contract_fixtures.py tests/test_notebook_door_audit.py tests/test_paywall_gate_free_tier.py`.

- [ ] **Step 2: The walk on a sandbox from the tip**

Boot `scripts/hub-sandbox.ps1` from PowerShell, with the data dir single-quoted, both switches on and a paid walk account. Run the walk's `smart_chips` group at 1280 / 820 / 390. The raw JSON goes under `docs/notebook/evidence/t2a-walk-<run-id>/` and is committed first. The snapshot-compare line must read CLEAN for `C:\data`.

- [ ] **Step 3: NVDA rows 39-41 (owner away only)**

Only when the owner has said they are away and no test run is in progress. Start NVDA from PowerShell with the silent config (`%TEMP%\nvda-silent-config`, `-m --log-level=12 --log-file=...`), run the driver for rows 39-41 against the sandbox, then quit it with `& 'C:/Program Files/NVDA/nvda.exe' -q` and prove it gone (`Get-Process nvda -ErrorAction SilentlyContinue` returns nothing). Raw log first, then the rows' PASS/FAIL. If the owner is not away, this step waits. It does not block the PR, and the arming packet lists it as a check to run before arming.

- [ ] **Step 4: Open the PR**

`gh pr create` from `notebook-t2a-assists` into `master`. The body has: the rulings (R-T2A-1..11), the owner decisions, the gate manifest path, the walk and perf evidence paths, what is dark (the smart chips) and what is live on merge (`/plan`, which rides the armed styles switch), and the rollback for each:
- `/plan`: revert the PR. There is no schema change, and notes already made stay ordinary Trade plan notes.
- the chips: leave the switch unset, or set it to `0`.

The body ends with:
```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SQuUWDPpeE8ymPfY82uG1d
```
The owner merges (merging is classifier-gated for agents). One master merge at a time; wait for `web` SUCCESS before anything else lands.

- [ ] **Step 5: After the merge, verify and hand over the arming packet**

Check that web reached SUCCESS on a fresh boot (the deploy record's status, plus ancestry against `origin/production`). Then run `python tools/hub_nav_smoke.py --auth` (exit 0 PASS, 1 measured, 2 INCONCLUSIVE; H15 if 1). Then exercise `/plan NVDA` on production as `smoke@uctintelligence.internal` in its own Playwright context, and trash the note it made afterwards.

Write `docs/notebook/t2a-arming.md` with:
- the owner's command: `! railway variables --service web --set "NOTEBOOK_SMART_CHIPS_ENABLED=1"`
- the checks after it: a NEW boot (startup line after the set), the value read in-process, `/api/auth/me` carrying `notebook_smart_chips_enabled: true` for the smoke account, the walk's `smart.alert-chip` against production as the smoke account (Cancel only; no alert is ever set on production by a tool), the app-wide client smoke (R-27), and `docs/feature_flags.json` moved to `armed` with the flip timestamp in the same docs push
- the rollback: `! railway variables --service web --set "NOTEBOOK_SMART_CHIPS_ENABLED=0"`, then verify a new boot

Commit and push the doc. Report to the owner in one copy-paste block.

---

## Self-review (done at write time)

- **Spec coverage.** Item 9: Tasks 4-5. "In your default Trade plan style" is `kindId` plus the server default (R-T2A-3). "Price" is R-T2A-2. "Key levels from the chart plan engine" is R-T2A-1. "The sizing block and the checklist" come from the style (R-T2A-3). Item 8: Tasks 6-8. "Inline suggestion chip" is the offer plugin plus the menu. "Opens the existing alert sheet pre-filled" is R-T2A-4. "Parsing is local and deterministic (ticker + comparator + price + close/intraday)" is Task 6. "Never sets an alert silently" holds because only the sheet's "Set alert" press creates. Item 10: Tasks 9-10. "Runs the existing OCR" holds because the poll reads the pipeline's output and runs no new OCR. "Validated against the symbol universe, with the RS/EMA/MA/GAP/PEG lesson" is buzz_extract plus R-T2A-7. "And a timeframe" is R-T2A-9. "One tap; never automatic" holds because acceptance is a button. §6: schema (none), performance (Task 11 Step 5), accessibility (Task 11 Steps 1 and 4; keyboard path R-T2A-10), offline (`/plan` goes through `createNoteViaApi`; the chips need a connection, and when it fails they show nothing; when offline the chip simply does not appear), privacy (the ticker route stores and logs nothing), rollback (Task 12 Step 4), and testing (unit, contract fixture, mutation checks in Tasks 4, 6 and 7, walk steps at three widths).
- **Placeholders.** Where a shape could not be read at write time, the plan names the V-item that confirms it and what to change if it differs (V2, V4-V9, V11-V13). These are verification gates with a stated fallback, not open blanks.
- **Type consistency.** `planItems` / `PLAN_EVENT` / `createPlanNote` / `planTitle`; `parseAlertPhrase` / `describeAlert` / `MAX_PHRASE_TEXT`; `alertPhraseKey` / `offerAt` / `dismissAlertOffer` / `ALERT_OFFER_EVENT` / `AlertPhraseOffer`; `tickersIn` / `confirmsSymbol` / `canonicalSymbol`; `timeframeFromText` / `pickTicker` / `altFor` / `HEADER_CHARS`; `readScreenshot` / `POLL_DELAYS_MS`; `findImagePos` / `labelImage` / `offerWords`. Each is used under the same name and shape in every task that consumes it.
