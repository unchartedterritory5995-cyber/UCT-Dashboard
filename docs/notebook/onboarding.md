# Notebook onboarding — the first-run tour and the sample notebook

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
  dismissed strip adds `dismissedAt` (the whole value is written back, ids included).
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
