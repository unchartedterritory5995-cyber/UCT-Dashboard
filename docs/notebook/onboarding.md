# Notebook onboarding — tours, the sample notebook and the checklist

Wave 8 built the first-run tour and the sample notebook; wave 14 built on both (a registry of
tours, a prompt, Help's lists, a welcome preview, a checklist and capability examples in the
sample) -- see "Wave 14" at the end, and read it before changing anything here.

Wave 8, lane 8C (items C2 and C3; rulings D-C6, D-C7). Both ship **dark** behind one gate,
`NOTEBOOK_ONBOARDING_ENABLED` (enablement: unset means OFF; declared in
`docs/feature_flags.json`, parsed by `api/services/notebook_flags.flag_on`, carried to the
browser on the auth payload as `notebook_onboarding_enabled` and latched per tab by
`lib/offline/notebookFlags.js`).

## The sample notebook (C3)

**What a member sees.** On an empty Notebook, the first-run screen (`ResearchHome.jsx`)
offers **Add a sample notebook** — to a paid member, while the gate is on, and only if the
member has never had the sample. One click writes five notes into a folder named
"Sample notebook" and opens the welcome note. While any of those notes is out of Trash, the
Notebook home shows a strip: *"You're looking at the sample notebook — Remove it"*, with a
button to hide the strip for good.

**The notes** (`api/services/journal_two/sample_notebook.json`): a welcome note that says how
to remove the sample; a research note with headings, a table, a callout, a formula and a code
block; a thesis with no ticker; a daily note with no date mention and no dated task; a
checklist. The research note and the thesis link to each other, and the welcome note links to
all four, so the graph and the backlinks show something.

**Content rules, each measured by `tests/test_sample_notebook.py`, never assumed:** every body
passes `notes._validate_body_json` and uses only registered node and mark types (checked
against both `notebook_schema.py` and `lib/notebookSchema.js`); no cashtag; nothing the ticker
extractor (`buzz_extract`) reads as a ticker; no all-capitals word that is a real ticker (RS,
EMA, MA, GAP and PEG all are); no date mention; no task with a due date; no properties. After
seeding, the member's mentioned-symbol set — the source the Awareness Engine's thesis-stop alert
reads — is empty, and there are no embeds with a symbol, no dated tasks and no property rows.

**How it is written** (`api/services/journal_two/sample_notebook.py`):

- `seed(user_id)` takes the write lock (`BEGIN IMMEDIATE`) **before** it counts, counts every
  note row the member has — active, archived and trashed — and refuses if there is one. Two
  clicks at once therefore produce one sample.
- The notes go in through `notes.import_confirm` (`source: "sample"`), the importer's own door;
  the links are written by a second `import_confirm` pass over the same import keys once the
  ids exist. No SQL here writes a note row.
- The seeded ids are recorded in the preference `notebook_sample` = `{v: 1, ids, at}`. A
  dismissed strip adds `dismissedAt` (the whole value is written back, ids included). Wave 14
  writes `v: 2`, adds the capability examples' note ids to the same `ids`, and adds an
  `examples` key for their non-note rows; a `v: 1` reader sees no difference.
- `remove(user_id)` trashes exactly the recorded ids that are not in Trash already, through
  `notes.delete_note` — each can be restored from Trash. The folder stays, so a restored note
  lands where it was.

**Routes** (`api/routers/notebook_onboarding.py`, prefix `/api/j2/onboarding`, every route 404
while the gate is off — a router-level dependency that reads no credential and writes nothing):

| Route | Who | Answers |
|---|---|---|
| `POST /sample-notebook` | paid (its own 402 sentence) | `{folderId, welcomeNoteId}`; **409** "You already have notes, so we didn't add the sample. You can import notes instead."; 503 when the lock cannot be had |
| `GET /sample-notebook` | signed in | `{ids, activeIds}` — what the strip reads |
| `DELETE /sample-notebook` | signed in | `{trashed: [...]}` |

⚠️ This is a **server-side note door** outside `journal_two.py` (through `import_confirm` and
`delete_note`). The door ledger's rail ⑤ (`lib/offline/doorEnumeration.test.js`) used to match
only `create_note(`/`update_note(` and could not see it. Controller ruling (wave 8 whole-branch
pass): ⑤ now matches `import_confirm(` and `delete_note(` as well, and `sample_notebook.py` has
its own ledger row with its settle story.

## The first-run tour (C2)

`components/notebook/onboarding/NotebookTour.jsx` — its own lazy chunk, mounted by
`NotebookTab` only while the gate is on (`tourLazy.test.js` fails if anything under
`journal-2-0/` imports it statically).

**When it shows.** It auto-starts once per mount, only when the gate is on, the member is paid,
the note count is known and zero, the preferences have loaded, and the preference
`notebook_tour` is neither `done` nor `dismissed`; a tour left half-way resumes at its step.
**Take the tour** (the first-run screen, the getting-started and sample help articles) opens it
whatever the preference says. It records `{v: 1, state, step}` in that one key.

**How it behaves.** Each step points at a `[data-tour]` anchor (`tourSteps.js`; the words are
`tourCopy.js`), outlined in place. A step whose anchor is not on screen is skipped; with no
anchor there is no tour. The card is a modal dialog with focus trapped (the shared
`trapTabKey`); Escape and **Skip tour** record `dismissed`, **Done** records `done`, and focus
returns to what held it. The last step links to `/support` with the Notebook articles first. On
the touch tier the card sits on the bottom edge; motion only without reduced motion.

**H14.** The tour measures nothing: the anchor is outlined with an attribute once per step and
the card has a fixed seat, so no layout read can set state on every frame.
`NotebookTour.renderLoop.test.jsx` counts its commits over two seconds of fake time with it
open (3, all while opening) and is mutation-proved with a setState per animation frame.

## Help articles (C1)

Fourteen Notebook articles in `app/src/pages/Support.jsx` (`topic: 'notebook'`), first for a
member who came from the Notebook. The sample-notebook article follows this gate; the sharing
article follows the share-link and publishing gates. No article covers the personal API or
email-in (their gates are server-only) — follow-ups for the wave that ships them.

## Wave 14: tours for every capability, the prompt, Help's lists and the checklist

Wave 14 turned the one wave-8 tour into a registry of tours, added a welcome preview and a "Get
started" checklist, and gave the sample notebook one example per capability. Plan:
`docs/notebook/WAVE-14-PLAN.md`; lane records `docs/notebook/wave14-*.md`; merge record
`wave14-integration.md`. Owner-facing switch list and arming order: `BETA-HANDOFF.md` 1c and 1d.
All paths below are under `app/src/pages/journal-2-0/components/notebook/onboarding/` unless
they say otherwise.

### The tour registry (W14-0, `tourRegistry.js`, `tours/`)

- **Data, not components.** `TOUR_REGISTRY` is the base entry plus `TRACK_TOURS` from
  `tours/index.js`, joined by `assembleRegistry`, which throws by name on a missing or extra
  field, a wrong type, a `start` outside `/journal/notebook`, or a duplicate id. An entry is
  `{id, flag, title, replayable, load}` plus optional `start`. Today: 21 entries, the base tour
  plus three track files, `b1Core.js` (7), `b2Trading.js` (6), `b3Research.js` (7).
- **Adding a tour.** Read the authoring contract at the top of `tours/index.js`. One entry in
  a track file; steps and copy in a `*.steps.js` that only `load()` imports (dynamically: the
  tour's words are never in the Notebook's first-open bytes); one `data-tour="<anchor>"` line in
  the capability's own component per step. `id` is permanent once shipped (it keys the member's
  seen state). `flag` is the capability's OWN `notebookFlag()` key; there is no registry-wide
  flag, so a tour is live exactly when its capability is.
- **The base tour is described, not reimplemented.** `notebook-basics` still runs on wave 8's
  `NotebookTour.jsx` / `NotebookTourGate.jsx` with `tourSteps.js` / `tourCopy.js`;
  `baseTour.zeroDrift.test.jsx` holds it to zero drift. Every other tour runs through the one
  generic engine, `GenericTourEngine.jsx`, loaded lazily by `RegistryToursGate.jsx` (mounted by
  NotebookTab) only when some caller asks for a tour by id (`openRegistryTour(id)` in
  `tourRegistryControl.js`, or a `startRegistryTourId` navigation state). One tour open at a
  time. A step whose anchor is not on screen is skipped; when the first anchor is missing the
  engine navigates to the entry's `start` and waits for it.
- **The rails.** `tourRegistry.test.js` (shape; `OPTIONAL_FIELDS` pinned to `['start']`; a
  non-replayable entry must be a 1-2 step passive explainer; the step budget: 3-6 steps for a
  tour, 1-2 for an explainer, the base tour exempt by id) and `tourAnchors.test.js` (every
  step's anchor appears exactly once in the JSX of the file the step names, and no
  `data-tour` attribute in the Notebook is an orphan, per file). The one explainer today is
  `note-resurfaces`, two steps over the resurfacing "What you wrote then" sheet.
- **Seen state.** Each registry tour's progress is one row in the preference `notebook_tours`,
  a map `{[tourId]: {v: 1, state, step}}` (`tourSeenState.js`); the base tour keeps its own
  wave-8 key, `notebook_tour`. The engine records `started`, `done` and `dismissed` itself.

### The prompt: "newly switched on, offer once" (W14-C2, branch `feat/notebook-w14-c2`)

⚠️ Built on its own branch and **not merged into the integration branch at the time of
writing**; the plan says it must land before any capability flag is armed in production.
Record: `wave14-w14-c2.md` on that branch.

- `tourEligibility.js` (pure) says which tours can be offered: not the base tour, replayable,
  its flag exactly `true`, and no row in `notebook_tours` (any row means the member has met it).
  There is no arming timestamp on the client, so "newly available" means "on, and never seen".
- `TourOfferGate.jsx` (eager, one mount line in NotebookTab) picks at most ONE offer per browser
  tab session (`sessionStorage` key `uct:notebook-tour-offer`, falling back to module memory),
  in registry order, and waits rather than stacking: never while a note is open, while the base
  first-run tour is still due, while the Get started list is open, while anything else holds the
  first-run stage, or while the first-run slot holds another card. Only then does it fetch the
  small `TourOfferPrompt.jsx` card. **Take the tour** opens it through `openRegistryTour`;
  **Not now** records the row as `dismissed` with `step: null`. Nothing expires.
- Cross-tab safety: rows are written through `PUT /api/j2/onboarding/tours/{tour_id}`
  (`api/services/journal_two/tour_seen_state.py`), one SQL `json_set` per row, so two tabs
  recording different tours cannot overwrite each other. 404 while onboarding is dark; the
  client falls back to the old whole-map write on 404/405.

### Help's two lists (`app/src/pages/Support.jsx`)

- **Walkthroughs** (W14-0, merged): every registered, replayable tour whose own flag is on, with
  **Replay** (`startPath` / `startState`; the base tour's Replay is byte-identical to the
  existing "Take the tour" link). A dark capability's tour is never named.
- **What's new** (W14-C2, on its branch): the same population, minus tours the member has
  taken, with **Start**. A tour declined from the prompt (`dismissed`, `step: null`) stays
  listed; one closed from inside (any step recorded) does not. It never reads or writes the
  checklist's key, so a hidden checklist never reopens (ruling D4).

### The welcome preview and the checklist (W14-A, W14-D)

Both ride `checklistEnabled(flag)` in `gettingStartedPref.js`: `NOTEBOOK_ONBOARDING_ENABLED` AND
`NOTEBOOK_GETTING_STARTED_ENABLED`, each exactly `true`. Off, the welcome is byte-identical to
wave 8's (`ResearchHome.welcome.test.jsx`, "integration gate").

- **Preview** (`capabilityList.js` data, `CapabilityPreview.jsx`, a lazy chunk on the empty
  Research Home): "What your Notebook can do", one line per capability whose own flag is on,
  plus a one-sentence sample promotion that the **Add a sample notebook** button names through
  `aria-describedby`. A new capability line needs a `FLAG_FALLBACKS` key (a rail checks it).
- **Checklist** (`gettingStarted.js` rules, `GettingStartedChecklist.jsx` eager gate,
  `GettingStartedList.jsx` lazy list; ONE mount line in `ResearchHome.jsx`, rendered on the
  first-run screen and every Home state): write your first note, start one from a template, open
  the sample notebook (only where it can be had), and "Take the {title} tour" per armed,
  replayable registry tour. A step ticks only from real evidence (the member's own notes, a
  template's walkthrough text, the sample preference, a tour's own `done` state), never from a
  click, and once recorded never unticks. State lives in `notebook_getting_started`
  (`{v: 1, done, state?, at?}`); **Hide** records `dismissed`, finishing records `done`, and
  either closes it for good (D4). It is page content, so it never claims the first-run stage.

### The sample notebook's capability examples (W14-E, `api/services/journal_two/sample_examples.py`)

The same click that writes the five practice notes also writes six example notes in
`Sample notebook / Capability examples`: an untraded AAPL chart plan, an MSFT active setup, an
NVDA thesis, an AMZN earnings-prep draft, a TSLA call excerpt, plus a GOOGL passed setup. Each
goes through its capability's own door, never a model or vendor call. Their note ids join the
same `ids` list (preference `notebook_sample` is now `v: 2`, with an `examples` key for the
non-note rows), so **Remove it** trashes them like the base five and dismisses the passed setup.

Two rules a maintainer must not undo, each with its rail:

- **No trade, position or entry context is ever seeded** (`tests/test_sample_notebook_trade_exclusion.py`):
  ~60 modules read `j2_trades` with no sample filter.
- **No example ever sends a notice.** The resurfacing example is a callout inside the thesis
  note, labelled "Example:", and nothing is written to `voice_proactive_insights` or the
  resurfacing ledger; the resurfacing scan (`note_levels.load_index`) also skips any note with
  `import_source = 'sample'`, so the example's NVDA stop can never fire a real one. The first
  version queued an importance-8 insight, which led the Compass inbox above every real
  resurfacing, was mirrored into the Compass chat, and spent the member's resurfacing budget
  (`tests/test_sample_notebook_examples.py`; `docs/notebook/wave14-docs.md`).

An example for a capability whose flag is off is data sitting in a table; the gated surface
decides whether anything shows.
