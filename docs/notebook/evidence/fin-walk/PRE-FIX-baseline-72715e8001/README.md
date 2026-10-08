# PRE-FIX baseline: what the acceptance walk captured on `72715e8001`

This is NOT the acceptance result. It is what lane WALK captured on the old tip `72715e8001`
before fixes landed on the landing branch. It is kept as a before picture. The run that counts
will be made on the final integrated commit, with `tools/notebook_fin_walk.py --tip <sha>`.

Nothing here was captured after the fixes. Every file in this folder is from `72715e8001`.

## What is in this folder

| folder | what it is | how complete |
|---|---|---|
| `c1-run1/` | Configuration 1 (only the switches production has armed today), one full sandbox boot, three widths (1280, 820, 390). `walk.json`, screenshots, sandbox log, integrity log. | Complete run. 76 steps. |
| `c2-dev/` | Configuration 2 (every wave 11-14 switch on), captured while the tool was being developed against one long-held sandbox. `walk-prev-*.json` are the raw step files of each partial run, `logs/dev-*.log` their printed step lines, `shots/` the screenshots. | Partial and repeated. Steps were re-run as the tool was fixed, so the same step appears more than once and early rows carry walker defects. The raw step file of the 1280 tour walk was overwritten by a tool defect (fixed since); only its printed lines survive, in `logs/dev-t.log`. |

Configuration 3 (a dependent switch without its prerequisite) was not run on this tip.

Sandbox integrity. `c1-run1`: CLEAN at all four checkpoints (pre-boot, +15 s, +120 s, shutdown),
62 database files hashed. `c2-dev`: CLEAN at pre-boot, +15 s and +120 s; the shutdown checkpoint
read 1 file changed, `C:\data\bars.db`. That sandbox was held for eight hours across the owner's
6:00 am scheduled bars job, the file's modified time is 06:00:36, and the sandbox log holds no
blocked-write banner. The walk tool did not write it, but that is an inference from timing, not a
proof. A held sandbox should not span a scheduled job again.

## Product findings on `72715e8001` (wave 12-15 surfaces)

1. **Entry context card: the saved "why" Edit control is 22 px wide on touch widths.**
   Seen at 820 and 390 on the trade page (`data-testid="why-prompt-saved"`, 22 x 44 px; the tap
   floor is 44 px). Evidence: `c2-dev/walk-prev-1791346916.json`, feature `layout`, step
   `trade page`. Suspect `app/src/pages/journal-2-0/components/EntryContextCard.jsx`. Minor.
2. **Research workspace at 390: the header action row runs off the side, and transcript capture
   makes it worse.** With switches off the page is already 450 px wide in a 390 px window
   (`c1-run1/walk.json`, 390, `research workspace`). With transcript capture on it reads 763 px,
   with a second button ending at 582 px (`c2-dev/walk-prev-1791346916.json`, 390,
   `research workspace (TSLA)`). The page scrolls sideways (`overflow-x: auto`). Suspect the
   Ticker Research workspace header that hosts "Save from a transcript". Minor to important on a phone.
3. **Formulas tour opens on "Step 2 of 5".** Replay from Help lands on the member's newest note;
   step 1 points at a control that exists only on a note with no properties, so a member whose
   newest note has properties meets step 2 first (`c2-dev/logs/dev-t.log`). Known in
   `wave14-w14-q2.md` section 5.4 as data dependent. Minor.

No wave 12-15 surface was found anywhere with the switches off (`c1-run1`, 3 widths: first run,
note editor, slash menu, property types, template picker, Research Home, Open Positions, closed
trades, trade page, position page, Insights and its `?ins=discipline` / `?ins=reviews` links,
`/journal-2-0/playbook`, `/journal/notebook/setups`, the research workspace, Help, navigation).
With getting-started off, Add a sample notebook wrote exactly the five wave-8 notes.

## Not wave 12-15 (the same with the switches off)

- 390 px sideways overflow on the closed trades toolbar (534 px), the trade page header actions
  (470 px) and the Help header (406 px). `c1-run1/walk.json`, 390.
- `GET /api/voice/cost` answers 500 on Settings, Compass and Voice:
  `sqlite3.OperationalError: no such column: seconds_used`,
  `api/services/voice_cost_service.py:95`. That file is not in the diff under review. Seen on a
  fresh sandbox database; not checked against production's schema.

- `GET /api/j2/accounts/comparison` answered 500 once, on a brand-new member's first page:
  `sqlite3.IntegrityError: UNIQUE constraint failed: j2_accounts.user_id, j2_accounts.name`,
  `api/services/journal_two/accounts.py:163` (`get_or_migrate_default_account`). Two first
  requests raced to create the Default account. Seen in 1 of 3 first runs during a later tool
  check on this same tip (raw file kept in the lane's scratchpad, not here). Not in the diff.

## Open, not yet classified (from a tool check on this tip, after the capture above)

- The sample's AAPL plan note: the fingerprint panel shows, but the walk found no level rows in
  the chart plan panel. Not yet known whether the panel did not open (walker) or the example's
  levels do not list (product). The tool now records the panel's text and the roles stored in
  the note, so the next run answers it.

## What passed in configuration 2 on this tip (1280 unless noted)

First run at 1280, 820 and 390 (welcome, capability preview, sample promotion, Get started
list). Add a sample notebook (10 notes: 5 practice, 5 examples). Get started: opening a sample
note and writing a note each ticked their step, ticks survived a reload, Hide stayed hidden.
The one-time offer appeared without taking focus and did not come back. Help listed the base
tour and all 19 replayable tours, and What's new listed 19. Template gallery: browse, use a UCT
pick and make a note from it, publish for review (pending, not listed, in the admin queue).
Formulas: R-multiple computed to 2 on a note. Chart plan: chart inserted with `/chart`, three
lines drawn and given roles, alert armed at the stop and listed. Entry context card on the
position and trade pages. Thesis chip on the NVDA Open Positions row. Setups board listed MSFT
and AAPL. Find similar said "No matches yet" before an overnight run and listed the match after
one. Transcript passage saved and cited. Passed setups: GOOGL listed, a name added, scored and
removed. Plan grading: the trade matched the drawn plan (`planned`, four checks); the unplanned
trade carried its chip and badge; Discipline tab present. Technical fingerprint and visual
playbook (2 cards). My Playbook from Insights. Daily, weekly and monthly review drafts. Tours at
1280: 18 of 19 opened at step one with Back, Escape and the card checks passing (formulas is
finding 3); 13 showed every declared step.

Not captured on this tip: tours at 820 and 390, the resurfacing explainer, the sample removal
and its leftovers check, the earnings prep build (the dev sandbox's calendar had only AMZN),
configuration 3.

## Things a reader should know (observations, not failures)

- Chart plan sizing for a brand-new member shows R:R and risk per share, then "No max risk per
  trade is set, set it in Journal Settings, Accounts". Shares appear once that is set.
- A resurfacing notice is found in Settings, Compass and Voice, Voice Insights Inbox, as
  "Open what you wrote". "What you wrote then" opens only when a saved version names the level.
  A plan drawn in one sitting has no such version (versions are cut on text changes, 30 minutes
  apart), so its notice opens the note itself. `api/services/journal_two/note_levels.py:225-264`.
- With the sample present, Reporting soon offers "Open prep note" for AMZN (the sample's draft).
- `POST .../notebook-fingerprint/blocks/{note}/{embed}/freeze` answers 404 once right after a
  chart is inserted, by design (`FingerprintPanel.jsx` header); the retry lands.
- The sandbox serves real bars for real tickers (the yfinance fallback needs no key), so chart
  prices are not the seeded ones.
- The walk ran after midnight Eastern while the box was on the previous local day. The daily
  review then read "0 trades" because the walker dated its trades by the local day. Walker
  defect, fixed (the tool now uses the Eastern day).

## Walker defects met on this tip, all fixed in the tool

Search box behind the "Search notes" door; the delete door (More note actions); the sample
step waited for a strip that is on Home, not on the welcome note; headings read through
`innerText` (CSS upper-casing made an absence check blind, now `textContent`); a response body
read with no timeout stalled the walk on a response still in flight; the embed toolbar under the
note's sticky header at 800 px tall; sample examples looked up by note ticker (only three carry
one); the find-similar template read from the note body (it lives in the chart-block index);
the held sandbox's final write overwrote a walk's raw file.

Model-backed steps (writing help, Ask, AI actions, meaning search itself, dictation, the Compass
quote in a review draft) were NOT RUN: no key.
