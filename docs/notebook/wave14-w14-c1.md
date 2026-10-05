# Wave 14, lane W14-C1: engine reach

Branch `feat/notebook-w14-int` (the integration branch; this lane was built on it after the
C2 merge). Spec: `docs/notebook/WAVE-14-PLAN.md` sections 4.2, 5 and 11. Starting point: the
B1, B2 and B3 lane records found that most of the twenty registered tours could not run.
Every fix below is in the ONE engine or in data. No tour has code of its own.

| commit | what |
|---|---|
| `a694fab902` | the engine, the gate's new home, the start resolver, the tour data, three flags, the rails |
| `f16b5cba21` | the W14-D checklist fixtures pin the task-reminders kill switch off (item g) |
| (docs commit) | this record, the integration sections, the mutation tool and its evidence |

## 1. What each item did

### (a) Mount: one gate, in the app shell

`RegistryToursGate` moved from `tabs/NotebookTab.jsx` into `components/Layout.jsx`, the shell
every authenticated page renders in (`/journal/*`, the `/journal-2-0/*` detail pages and the
setups board are all children of it in `App.jsx`). It is mounted once; NotebookTab keeps only
the C2 offer (`TourOfferGate`), which by design never shows while a note is open. Because the
gate no longer lives inside a page, a tour now survives the navigation to its own start.

`start` may name any known in-app page: `START_ROUTES` in `tourRegistry.js` (the Notebook,
the setups board, the trades list, My Playbook). A rail reads `App.jsx` and fails if one of
them is not a route inside the authenticated `Layout`. `startProblem()` is the one validator
(`assembleRegistry` throws on anything else, by tour name). A page that needs an id (a
trade, one note) is reached through an object start, never a typed id.

`OTHER_TOURS` (the registry without the base tour) is now one frozen export used by both the
shell and NotebookTab.

The gate also drops a request for a tour whose capability is off instead of holding it: the
slot is one tour wide, and a held request would have blocked every later one.

### (b) In-note and on-trade starts

Two declarative start kinds, resolved by `onboarding/tourStart.js` (imported only by the lazy
engine):

* `{ note: 'sample:<key>' | 'recent', embed?: '<widget>' }`. `sample:<key>` asks
  `POST /api/j2/notes/import/check` (a read: it only looks the key up) for the W14-E example
  note whose import key is `sample-example:<key>` (that is how E names them,
  `sample_examples.py` `KEY_PREFIX` and `_own_import`). Without one it opens the member's
  most recently edited note (`GET /api/j2/notes?sort=updated&limit=1`, with
  `embed_widget=<widget>` when the tour needs, say, a chart). `recent` with no widget treats
  any open note as already there.
* `{ trade: 'recent' }`: the member's newest trade (`GET /api/j2/trades?limit=1`), opened at
  `/journal-2-0/trade/<id>`, the page that holds both the plan grade and the entry context.

With nothing to open the card says so ("This walkthrough runs inside a note. You do not have
a note it can open yet ...") with a way out (Go to the Notebook / Go to your trades) and a
Close. Nothing is recorded and nothing is created. A failed lookup says it could not look it
up; it never guesses. A rail checks every `sample:<key>` a tour names is a key W14-E seeds.

Help's Replay link (`startPath`) for an object start lands on the Notebook (or the trades
list) and the engine goes on from there.

### (c) Dynamic steps

The engine no longer fixes the visible step list at open. On Next it waits up to
`STEP_WAIT_MS` (1.5 s, bounded) for the next step's anchor, showing "Looking for the next
step", and only then skips to the first later step on screen, or finishes. Back goes to the
nearest earlier step on screen. If the current step's anchor leaves the page and stays gone
for the same bounded wait, the card moves to a step that is on screen or ends; it never
points at nothing.

A step may declare `waitFor: '<anchor>'` ("do this to continue"). The card is non-modal,
says "Do this to continue, or choose Next to skip it", and moves on by itself when that
anchor appears. A rail requires `waitFor` to name a LATER step's anchor in the same tour, so
the anchor rail covers it. Used by `chart-plan-basics` (Plan), `chart-plan-replay` (Replay),
`visual-playbook` (a new first step on the fingerprint panel's Visual playbook button, one
new `data-tour="fp-visual-playbook"` attribute) and `transcript-capture` (a new first step on
the note body asking the member to type /transcript).

Progress reads "Step N of M" over the tour's declared steps.

### (d) Start detection

`atStart` compared only the pathname and the start's own query parameters, so a member on
`/journal/notebook?note=<id>` counted as "at" Notebook Home and Home tours waited and closed.
It now also requires that no screen-picking parameter the start does not name is present
(`SCREEN_PARAMS`: `note`, `view`, `side`, `resurfaceVersion`, `new`, the ones the Notebook
reads to pick a screen). Filters (`folder`, `ticker`, anything else) never move a member off
a start.

### (e) Sheets and focus

A step whose anchor sits inside a sheet or dialog (or a `waitFor` step) renders the card
NON-modal: no full-screen layer holding the page, no `aria-modal`, no Tab trap of its own,
and the card is placed INSIDE that sheet's panel, so the sheet's own Tab ring includes the
card's buttons. Every other step keeps the modal card exactly as before.

Keys are read on `window` in the capture phase, so the tour decides before any document-level
handler (Sheet's included) whether a key is its own. Escape closes only the topmost layer:
when the tour is on top it closes the tour and stops the event, so the sheet beneath stays
open (a second Escape closes the sheet); when a sheet opened after the tour sits above it
(`tourLayers.js` `cardIsTopmost`, the same document-order rule `Sheet.jsx` uses), the sheet
gets the Escape and the tour stays.

### (f) The passive explainer

A `replayable: false` entry (`note-resurfaces`) renders as a light `aside`: the first step's
title, every step's sentence, one "Got it" button. No dialog role, no stepper, no layer, and
it never takes focus. It is shown once per member (any row in `notebook_tours` means seen)
and records `done` on Got it. Inside a sheet it sits in the sheet's panel.

Trigger: `ResurfaceVersionSheet` calls `openRegistryTour('note-resurfaces')` once, when the
version that first named the level has rendered (not while loading, not on the error state).
The gate checks the capability's flag; the engine checks seen-state.

### (g) Three flags on the payload

`notebook_image_docx_documents_enabled`, `notebook_task_reminders_enabled` and
`notebook_semantic_search_enabled` are now rows of `NOTEBOOK_FLAGS` (`api/routers/auth.py`)
and keys of `FLAG_FALLBACKS` (`notebookFlags.js`), each with its capability's own polarity:

| flag | server read | polarity | payload/fallback when unset |
|---|---|---|---|
| image/docx documents | `document_extraction.image_docx_documents_enabled` | enablement (on only for 1/true/yes/on) | false |
| task reminders | `note_tasks.reminders_enabled` | KILL switch (off only for 0/false/no/off; on in prod) | **true** |
| meaning search | `note_semantic.semantic_enabled` | enablement | false |

The three services read their own variable with their own parse. Putting the flags on the
payload made those reads second parses, which `test_notebook_flag_parse.py` refuses; they now
call `notebook_flags.flag_on(<name>, <default>)`. `test_notebook_flags.py` proves the payload
key and the capability's own function agree on 14 spellings each (unset, empty, typos
included), and that task reminders reads ON when unset. The ledger notes, the switch-rehearsal
tool (now names them as payload-key-only, and the window's "every kill switch" includes task
reminders) and its tests were updated.

### (h) Thesis chips

Chips render on Journal positions, holdings and the Watchlists widget, never inside a note,
and `transcript-capture` starts in a note, so its chip step was always skipped. Reaching a
chip would mean leaving the note mid-tour for a different page, which no other step needs.
The step is removed (and its now-unused anchor removed from `ThesisChip.jsx`); the tour is
titled "Transcript passages". If chips ever get their own walkthrough it belongs on the
positions page as its own entry.

## 2. Every tour, its start, and whether it can now open (measured)

`tourReachability.test.jsx` opens each registered tour the way a member does: from Help
(`/support`), following that tour's own Replay link (`startPath` + `startState`), through the
REAL gate and engine, in a stand-in app whose pages render a capability's anchors only where
that component really renders (one line per anchor file, `ROUTE_OF_FILE`). Steps behind a
click (a `waitFor` target and later) are not rendered up front. The explainer is opened the
way the product opens it, by the resurfacing sheet's trigger. Result: **20 of 20 open**
(19 replayable tours plus the explainer). Printed by the test:

| tour | start | before C1 (lane records) | now | landed on |
|---|---|---|---|---|
| writing-help | `{note: recent}` | only if a note was already open | opens | `/journal/notebook?note=<newest>` |
| image-docx-import | `{note: recent}` | never (flag not on payload) | opens | `?note=<newest>` |
| publish-share | `{note: recent}` | only if a note was already open | opens | `?note=<newest>` |
| task-reminders | `/journal/notebook?view=tasks` | never (flag not on payload) | opens | `?view=tasks` |
| template-gallery | none (Notebook) | yes | opens | `/journal/notebook` |
| meaning-search | none (Notebook) | never (flag not on payload) | opens | `/journal/notebook` |
| formulas-rollups | `{note: recent}` | only if a note was already open | opens | `?note=<newest>` |
| plan-grading | `{trade: recent}` | never (engine not mounted on trade page) | opens | `/journal-2-0/trade/<newest>` |
| entry-context | `{trade: recent}` | never | opens | `/journal-2-0/trade/<newest>` |
| review-drafts | `/journal/notebook` | yes, except from an open note | opens | `/journal/notebook` |
| my-playbook | `/journal-2-0/playbook` | never | opens | `/journal-2-0/playbook` |
| chart-plan-basics | `{note: sample:plan, embed: chart}` | only on an open chart note; panel steps never | opens | `?note=<example plan>` |
| chart-plan-replay | same | same; controls step never | opens | `?note=<example plan>` |
| ta-fingerprint | same | only on an open chart note | opens | `?note=<example plan>` |
| visual-playbook | same | only with the sheet already open | opens | `?note=<example plan>` |
| setups-board | `/journal/notebook/setups` | never (sibling route, no gate) | opens | `/journal/notebook/setups` |
| earnings-prep | `/journal/notebook` | yes, except from an open note | opens | `/journal/notebook` |
| transcript-capture | `{note: sample:transcript}` | only with the sheet already open | opens | `?note=<example excerpt>` |
| passed-setups | `/journal/notebook` | yes, except from an open note | opens | `/journal/notebook` |
| note-resurfaces (explainer) | trigger | never (no trigger, modal stepper) | opens | `?note=..&resurfaceVersion=..` |

"Opens" means the card showed the tour's first step. It is measured against a stand-in for
each page, not the real pages: the stand-in is only as true as `ROUTE_OF_FILE`, and a real
browser walk (W14-Q) is still owed. Two known limits it cannot show: the chart toolbar's Draw,
Plan and Replay buttons are hover-revealed on a computer (`WidgetEmbedView.module.css`), so
those steps wait and may be skipped unless the member points at the chart; and
`visual-playbook` needs the fingerprint panel, which renders only while
`notebook_ta_fingerprint_enabled` is also on.

## 3. Bytes

The new engine code is lazy: `tourStart.js`, `tourLayers.js` and `GenericTourEngine.module.css`
are imported only by `GenericTourEngine.jsx`, which only the gate's `lazyLeaf` imports. The
eager change is the gate's import moving from NotebookTab to Layout (both already in the
Notebook's first-open closure), `OTHER_TOURS`, `START_ROUTES` and `startProblem` in
`tourRegistry.js`, and the four start fields in the track files. Gate output: section 5.

## 4. Mutation proof

`tools/notebook_w14c1_mutation_proof.py --all`: a control run first (stops if red), then 13
mutations, each applied by text, run against its rails, restored, and the restore verified
against the COMMITTED blob (`git cat-file blob HEAD:<path>`), not only against the run's own
capture. Evidence: `docs/notebook/evidence/wave14-w14-c1/` (verdict lines and failing test
names only).

| # | item | mutation | result |
|---|---|---|---|
| Mc1 | (c) | Next decides at once (the old frozen list) | KILLED, 2 failed |
| Mc2 | (c) | `waitFor` ignored | KILLED, 1 failed |
| Md1 | (d) | screen parameters ignored in `atStart` | KILLED, 3 failed |
| Me1 | (e) | Escape not stopped (both layers close) | KILLED, 1 failed |
| Me2 | (e) | the tour always counts as topmost | KILLED, 1 failed |
| Me3 | (e) | modal even over a sheet | KILLED, 2 failed |
| Me4 | (e) | card portaled to body, not into the sheet | KILLED, 2 failed |
| Ma1 | (a) | the shell mount removed | KILLED, 2 failed |
| Ma2 | (a) | a flag-off request held in the slot | KILLED, 1 failed |
| Mb1 | (b) | the sample note ignored | KILLED, 3 failed |
| Mb2 | (b) | the trade start ignored | KILLED, 5 failed |
| Mf1 | (f) | the resurfacing trigger removed | KILLED, 3 failed |
| Mf2 | (f) | the explainer ignores seen-state | KILLED, 2 failed |

Control: `Tests 91 passed (91)`. `VERDICT: PASS -- every mutation killed`.

## 5. Gates

See `wave14-integration.md` section C1 for the byte gate output and the test counts, copied.

## 6. Open items

1. **Offers go live for two capabilities that are already on in production.** C2 offers a
   tour whose flag is on and that the member has never seen, with no onboarding gate of its
   own (by C2's design). (g) makes task reminders (a kill switch, on in prod) and image/docx
   documents (armed on web) visible to the client, so on deploy every member is offered those
   two tours and Help lists them. Correct by the rules, but a member-facing change to call
   out before this branch ships.
2. **A real-browser walk is owed** (W14-Q): the reachability table is measured against a
   stand-in app; hover-revealed chart controls and real sheet focus behaviour need a browser.
3. Chart-toolbar steps on a computer depend on the member pointing at the chart (hover CSS).
   A tour step cannot hover; the copy says so.
4. `visual-playbook` reaches its sheet only while the fingerprint panel renders
   (`notebook_ta_fingerprint_enabled`); with only the playbook flag on, the tour opens on
   nothing and closes quietly.
5. Thesis chips have no walkthrough now (item h).

## 7. Controller ruling: nothing members see changes until the owner flips the switch

Ruling on open item 1: the landing must change nothing members see until the owner arms
wave 14. Commit `517e607f14`, then the tool fix and this section in the docs commit.

### 7.1 One rule, every door: `tourLive(entry, flag)` (tourRegistry.js)

* The base tour (wave 8) answers exactly as before: its own flag (`notebook_onboarding_enabled`)
  and nothing else.
* Every other registered tour needs its own capability flag, every flag in its optional
  `requires`, AND the wave-14 switch: `checklistEnabled()` from `gettingStartedPref.js`
  (onboarding AND getting-started), reused, not restated.

Asked by: the offer and What's new (`tourEligibility.js` `candidate`), the get-started
checklist's tour steps (`gettingStarted.js`), every open through `RegistryToursGate.jsx`
(Help's Replay, the offer's accept, the checklist, the resurfacing explainer's trigger, any
`openRegistryTour`), and Help > Walkthroughs. The Walkthroughs section is itself a wave-14
addition (W14-0), so it renders nothing at all while the switch is off; Help's wave-8 "Take the
tour" link is unchanged.

Consequence for the two capabilities already on in production (task reminders, image/docx):
with the switch off their tours are never offered, listed or opened. Open item 1 of section 6
is closed by this.

### 7.2 `requires` (open item 4)

An entry may carry `requires: [flag, ...]`; every flag must be exactly true. `OPTIONAL_FIELDS`
is now `['requires', 'start']`, pinned by the shape rail; a malformed `requires` (empty, not a
list, a non-flag key) is refused by tour name; every real `requires` flag must be a
`notebookFlag()` key. `visual-playbook` requires `notebook_ta_fingerprint_enabled` (its sheet
opens from the fingerprint panel). Open item 4 of section 6 is closed by this.

### 7.3 Flags-off render parity (proved against the tree before wave 14)

`tools/notebook_w14_flagsoff_parity.py`. "Before wave 14" is `b06ec4fd85`, the wave-13
landing the first wave-14 lane branched from: master itself does not carry wave 13 yet, so
master's files cannot be rendered with this branch's wave-13 children, and the wave-13 landing
is exactly what this branch puts on master minus wave 14. The tool renders, with the real
fixtures (a11y/fixtures.jsx): Help (the getting-started answer opened), Notebook Home, the
notes list and an open note (each inside the real Layout), and Layout alone; under four flag
sets (prod-like: every capability on and getting-started off; every capability on and
onboarding off; onboarding only; all off) and two member states (fresh; base tour done and
checklist closed): 40 cases. Pass A is the tree as committed; pass B swaps every non-test
source file wave 14 changed (42) for its `b06ec4fd85` blob; then every file gets its exact
original bytes back and `git status` must read as before. Normalised before comparing, and
stated: `data-tour` attributes (inert markers; the wave-8 tour uses them too), React `useId`
values (a counter of hooks, not markup) and CSS-module hash suffixes.

```
== flags-off render parity
base b06ec4fd85 vs HEAD 517e607f14
pass A ['Test Files  1 passed (1)', 'Tests  41 passed (41)']
pass B ['Test Files  1 passed (1)', 'Tests  41 passed (41)']
swapped 42 source files to the base blob; restored, git status unchanged
40 identical | 0 differ (40 cases)
VERDICT: PASS -- identical
```

Mutation (`--mutate`: the wave-14 switch removed from `tourLive`):

```
== flags-off render parity (MUTATION: wave-14 switch removed from tourLive)
12 identical | 28 differ (40 cases)
  DIFFERS: help | prod-like: every capability on, getting-started off | fresh member
    HEAD: ...<section class="_faqWrap_" aria-labelledby="support-whats-new"><h2 id="support-whats-new" ...
VERDICT: PASS -- the mutation is caught
```

(the first difference is Help's "What's new" section appearing; the later cases differ by the
icon gradient counter that section shifts.) Evidence: `evidence/wave14-w14-c1/flagsoff-parity*.txt`.

### 7.4 Rails and mutations

New or changed rails: `tourRegistry.test.js` (`requires` shape and pin, `tourLive` for the base
tour and for every other tour without each of its four flags), `tourEligibility.test.js` (the
switch off three ways; `requires`), `tourEligibility.realRegistry.test.js` (every tour flag on
but the switch off: nothing offered or new), `TourOfferGate.test.jsx` (switch off: no card, no
chunk fetched), `b3Research.test.jsx` (visual-playbook stays closed without the fingerprint
flag), `Support.notebook.test.jsx` (Walkthroughs hidden with onboarding on and getting-started
off). Fixtures that armed a tour without the switch now arm it; the offer's fixtures start from
a closed checklist, because with the switch on an open checklist holds the offer back (C2).

`tools/notebook_w14c1_mutation_proof.py --all`: control `Tests 265 passed (265)`; 16 of 16
killed, the 13 of section 4 plus:

| # | mutation | result |
|---|---|---|
| Mr1 | the wave-14 switch dropped from `tourLive` | KILLED, 7 failed |
| Mr2 | `requires` ignored | KILLED, 3 failed |
| Mr3 | Help > Walkthroughs not gated on the switch | KILLED, 1 failed |

(The tool as committed in `517e607f14` had three broken string literals from an inline edit;
fixed in the docs commit before this run.)

### 7.5 Gates

Byte gate, same procedure as section 3, at `517e607f14` (no app source changed after):

```
bytes.notebook_first_open: 2,254,199 B across 66 JS chunks (budget 2,260,793 B, baseline 2,153,137 B)
VERDICT: PASS -- within every budget checked
```

Counts: see section 7.6.

### 7.6 Counts (copied)

`npx vitest run src/pages/journal-2-0 src/pages/Support --maxWorkers=3` at `517e607f14`
(`app/dist` built), after the disk was freed:

```
 Test Files  1 failed | 635 passed (636)
      Tests  1 failed | 8071 passed | 1 skipped (8073)
```

The one: `a11y/tourOffer.a11y.test.jsx` "tour-offer-in-slot", a C2 fixture that armed a tour
without the wave-14 switch (the same class as 7.4). It now arms the switch and starts from a
closed checklist; alone: `Tests  2 passed (2)`. Committed with this section.

Pytest (flags, flag parse, switch rehearsal, flag ledger, tour seen state, perf budgets, sample
examples): `726 passed in 872.07s`, exit 0.

### 7.7 Open item found while proving it

W14-E's extra example notes are seeded server-side whenever a member adds the sample notebook,
which rides `notebook_onboarding_enabled` alone (armed on web). That is a member-visible change
the wave-14 switch does not gate. It is outside the render-parity surfaces (a server seed, not a
render) and outside this ruling's list; flagged for the controller.
