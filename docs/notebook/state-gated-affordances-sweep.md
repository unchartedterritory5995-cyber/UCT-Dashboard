# State-gated affordances — defect sweep (Journal 2.0 / Notebook)

Swept 2026-09-14 against `app/src/pages/journal-2-0/**`. Read-only sweep; no product file was touched.

## The class

**An affordance whose mount is gated on state that the affordance itself creates — so the control
you need is absent exactly when you need it.**

The discriminating question for every candidate: *if this control is the only way to obtain the
state it is gated on, the member is stuck.* A control gated on state it does **not** create (an
"edit" button that needs something to edit, a "remove" button that needs something to remove) is a
**NEAR MISS** — the same syntax, a different consequence.

Both seed instances were established by grepping for **every** caller of the capability and finding
exactly one mount. That is the step that separates a defect from a cosmetic gap, and it is applied
to every row below.

## Findings

I found **three** defects. Two were given; one is new. That is the whole list — everything else I
examined is a near miss or a stated intention, recorded below so it is not re-investigated.

| file:line | affordance | gate condition | capability gated | other doors found | verdict |
|---|---|---|---|---|---|
| `ResearchHome.jsx:78` | "Start a note" / "Create a thesis" / "Import notes" | `if (!hasAnyNotes) {` | create a note, thesis, or import | `NotebookTab.jsx:757` (All-notes toolbar, other branch); `CommandPalette.jsx:24`; `notebookSection.js:574`; `TickerResearchWorkspace.jsx:136` | **DEFECT** |
| `NoteEditorPage.jsx:2188` | `HeroImagePicker` | `) : note.heroImageUrl ? (` | set a hero image on a note | none that add a *first* hero to an existing note — see writeup | **DEFECT** |
| `NotebookTab.jsx:777` | `ImportWizard` mount | mounted only in the `) : (` branch at `NotebookTab.jsx:658` | the import dialog itself | `NotebookTab.jsx:730`, `NotebookTab.jsx:824` — both in the branch where it *is* mounted | **DEFECT (new)** |
| `CaptureDialog.jsx:202` | "Change" destination | `{recentDestinations.length > 0 && (` | re-pick the capture destination | picker at `CaptureDialog.jsx:179` when `needsPicker` | NEAR MISS |
| `NoteEditorPage.jsx:1948` | "Unshare" | `{share && (` | revoke a public link | — | NEAR MISS |
| `ThesisSection.jsx:302` | evidence list | `{evidence.length > 0 && (` | *display only* | "Add evidence" sits outside, at `ThesisSection.jsx:336` | NEAR MISS |
| `PortfolioSettingsModal.jsx:704` | mistake-tag chips | `{mistakeTags.length > 0 && (` | *display only* | the add input + "Add" + "Seed standard 17" sit above the gate | NEAR MISS |
| `DayAttachments.jsx:107` | attachment list + remove | `{attachments.length > 0 && (` | *display / remove* | "Add link" and the file input sit below the gate | NEAR MISS |
| `TickerResearchWorkspace.jsx:145` | per-ticker empty state | `{isEmpty ? (` | nothing — creates are outside | "New note" at `TickerResearchWorkspace.jsx:136`, outside the gate | NEAR MISS |
| `PropertiesSection.jsx:120` | "Add property" | `if (!visible.length && !pickerOpen) {` | add a property | the same control is rendered in *both* branches | NEAR MISS |
| `FolderSidebar.jsx:204` | "Add thesis starter views" | `if (!views.length) {` | seed saved views | "Save view" at `NotebookTab.jsx:713` | INTENTIONAL-BECAUSE |
| `CompassOverview.jsx:35` | whole Compass card | `if (isEmpty) return null` | nothing — no create control inside | its one conditional control needs `onScrollToProfile`, not passed at `CompassTab.jsx:160`; `TraderProfileEditor` mounts separately at `CompassTab.jsx:334` | INTENTIONAL-BECAUSE |

Inverse gates — control shown *when* the state is absent — are correct by construction and are not
listed individually. `OptionStrategiesSection.jsx:130`, `TradeDetailPage.jsx:605` and
`DayRulesChecklist.jsx:70` are of that shape; `MyRulesList.jsx:29` is too, and names its escape
("Turn a recurring mistake into a rule above").

---

## Confirmed instance 1 — no create control on a populated Notebook landing view

`app/src/pages/journal-2-0/components/notebook/ResearchHome.jsx:78`

```
  if (!hasAnyNotes) {
```

Everything a member can *create* from this surface lives inside that early return. `ResearchHome`
contains exactly four `<button>` elements: one is a note row (`:27`), the other three are the create
controls at `:87`, `:90` and `:93` — all three inside the `!hasAnyNotes` block. Neither the
populated branch (`:115` onward) nor the quiet branch has any.

The gate is fed from `NotebookTab.jsx:656`:

```
            hasAnyNotes={allNotesTotal > 0}
```

**Other doors.** The member is not permanently stuck, and this matters for severity. Clicking "All
notes" in the sidebar leaves `isHome`, which mounts the toolbar and its create control at
`NotebookTab.jsx:757`:

```
              onClick={() => createNote()}
```

The command palette reaches the same capability by deep link, `CommandPalette.jsx:24`:

```
    to: '/journal/notebook?new=blank', keywords: ['note', 'notebook', 'new', 'create'] },
```

and the hub has its own, `hub/sections/notebookSection.js:574`:

```
            run: async () => { const note = await createNoteViaApi({}); openNote(note?.id) },
```

So: a real instance of the class on the landing surface, with escape hatches elsewhere. It is a
dead landing view, not a dead product.

**Second branch, same defect.** `ResearchHome.jsx:105`:

```
  if (nothingToShow) {
```

A member who has notes but nothing recent, favorited, or set Active gets a text-only quiet state —
again with no create control. Worse, `useNotebookHome.js` is configured `shouldRetryOnError: false`
and falls back at `:18`:

```
    home: data || EMPTY,
```

so a **failed** `/api/j2/notebook/home` renders as that same calm, affordance-free quiet state, with
no error shown. I am counting this as the same defect observed on a second branch, not as a
separate one.

---

## Confirmed instance 2 — a first hero image can never be added

`app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx:2188`

```
        ) : note.heroImageUrl ? (
```

guarding, at `:2192`, the `HeroImagePicker` mount. The picker is the control that *sets*
`heroImageUrl`; it is mounted only once `heroImageUrl` is already set.

`HeroImagePicker` is confirmed single-mount: a search across `app/src` for `<HeroImagePicker`
returns exactly `NoteEditorPage.jsx:2192`.

**Correction to the brief.** `HeroImagePicker` is **not** the only client caller of
`POST /api/j2/notes/{id}/hero`. There is a second, at
`app/src/pages/journal-2-0/GlobalAddPositionProvider.jsx:164`:

```
          const heroRes = await fetch(`/api/j2/notes/${noteId}/hero`, {
```

and the codebase already says so — `lib/offline/settleNoteWrite.js:13` reads
"`POST /notes/{id}/hero`    HeroImagePicker, GlobalAddPositionProvider". A third path sets
`heroImageUrl` at note-creation time via `POST /api/j2/notes`,
`app/src/components/video/VideoDockSlot.jsx:158`:

```
        body: JSON.stringify({ title, heroImageUrl, bodyJson: { type: 'doc', content } }),
```

**The conclusion survives the correction.** Neither other door is reachable for the case in
question. `GlobalAddPositionProvider` fires only while creating a *new* note from a position, and
only if a chart screenshot was captured. `VideoDockSlot` creates a *new* note whose `heroImageUrl`
is a YouTube watch URL — which routes to `NoteVideoHero` at `NoteEditorPage.jsx:2176`, not to the
picker. For a note the member wrote themselves, there is no door at all.

**The stated intent, and why it is not a justification.** `NoteEditorPage.jsx:2189-2191`:

```
          // A note that already has a hero image keeps showing it (it's content,
          // still editable via the picker's controls). Notes without one start
          // straight at the title — no empty drop-zone.
```

That is a real design intent — suppress an empty drop-zone — and it is the correct instinct. It is
not a justification for the outcome, because it silently assumes a hero arrives by some other route,
and for a member-authored note none exists. **An intent explains why the code is shaped this way; a
justification would have to show the capability is still reachable.** This comment does the first
and not the second. `PropertiesSection.jsx:120` is the same intent discharged correctly — it
suppresses the empty list but still renders "Add property" in both branches.

---

## Confirmed instance 3 (NEW) — "Import notes" on the first-run home opens nothing

`ImportWizard` is confirmed single-mount: a search across `app/src` for `<ImportWizard` returns
`NotebookTab.jsx:777` plus `ImportWizard.jsx:866`, which is its own internal
`<ImportWizardBoundary>`, not a second mount.

The three-way branch in `NotebookTab.jsx` is:

- `:648` — `        ) : isHome ? (` → renders `ResearchHome`
- `:658` — `        ) : (` → renders the toolbar fragment, **and** the dialogs
- `:777` — `        <ImportWizard` — inside that third branch only

`ResearchHome` is handed an import callback at `NotebookTab.jsx:655`:

```
            onImport={() => setImportOpen(true)}
```

and renders it at `ResearchHome.jsx:93`:

```
          <button type="button" className="btn btn-ghost" onClick={onImport}>
```

Clicking it sets `importOpen` — but `<ImportWizard open={importOpen}>` is on the other side of the
branch and is not mounted. Nothing opens. `importOpen` does not feed `isHome`
(`NotebookTab.jsx:316`):

```
  const isHome = !noteId && !hasActiveFilters && !viewAll && !isTrashView
```

so the state change cannot re-render the branch that would mount the wizard. The button is inert.

**Other doors.** The other two import triggers, `NotebookTab.jsx:730` (toolbar) and
`NotebookTab.jsx:824` (empty-state pitch), both live in the `:658` branch where the wizard *is*
mounted, so both work. The member can reach import by first clicking "All notes".

**Why this belongs in the class.** The gate here is `!isHome`, not emptiness, so it is an adjacent
shape rather than a literal one — I am flagging that rather than smoothing it over. The effect is
identical and compounding: the button is offered **only** to a member with no notes
(`ResearchHome.jsx:78`), and importing is precisely the act that would give them notes. A brand-new
member's first click on the welcome screen does nothing, silently.

Of the three, this is the most member-visible: it is on the onboarding surface, it is silent, and
unlike instance 1 the control is present and appears functional.

---

## INTENTIONAL-BECAUSE — stated reasons, quoted

**`FolderSidebar.jsx:204`** — `  if (!views.length) {`, then `:205` `    if (!onAddStarterViews) return null`.
The comment above it states the intent: *"`onAddStarterViews` (present only once the member has zero
saved views of their own) offers the four canonical thesis starter views as ONE click -- ordinary
saved-view rows afterward... It disappears the moment the member has any saved view"*. This is the
inverse gate, and the general capability lives elsewhere ("Save view", `NotebookTab.jsx:713`).

**`CompassOverview.jsx:35`** — `  if (isEmpty) return null`, with `:31` beginning
`  const isEmpty = !onboarded && !profile_excerpt && !this_weeks_focus &&`. The stated reason is the
comment directly above: *"Hide the card entirely on a fresh account with nothing to show"*. No create
control is lost: the card's only conditional control requires an `onScrollToProfile` prop that the
sole call site, `CompassTab.jsx:160`, does not pass, and the profile editor mounts independently at
`CompassTab.jsx:334`.

## Prior art — this class has already bitten this codebase once

`CaptureDialog.jsx:109-113` documents an earlier, already-fixed instance in its own words:

```
  // ⛔ MODE-AWARE, and it has to be. A ticker-only destination ("NVDA
  // Research") is a complete answer for a THOUGHT — the note is created
  // carrying that ticker — but a SOURCE capture writes into an existing note
  // and needs a noteId. Asking `!noteId && !ticker` for both hid the picker on
  // a research page and then blocked Save with "a destination", leaving the
  // member no control that could fix it.
```

"...leaving the member no control that could fix it" is this class stated exactly. It is worth
treating as the canonical description.

## Method, and where the instrument is blind

Two mechanical passes over every non-test `.jsx` under `app/src/pages/journal-2-0`, then manual
adjudication of each hit, then a single-mount check for each create-shaped component.

- **Pass 1** — emptiness-keyed gates (`.length`, `hasAny…`, `isEmpty`, `firstRun`, leading `!`)
  whose guarded block contains a create-shaped control. 53 hits, all adjudicated.
- **Pass 2** — nullable-scalar presence gates (`note.heroImageUrl ? (`) wrapping a picker/editor/add
  control. **Pass 1 could not see instance 2's shape** — `note.heroImageUrl` contains no `.length`
  and no emptiness token — so pass 2 exists specifically to cover pass 1's blind spot. It returned
  3 hits: `NoteEditorPage.jsx:2188` (the defect), and two false positives
  (`RapidTagFlow.jsx:211`, `TradeDetailPage.jsx:605`) where the lookahead window caught an unrelated
  control below the gate.
- **Pass 3** — single-mount detection for every create-shaped component. The **first run was wrong**
  and is discarded: its regex required a character after the component name, so mounts written as
  `<AddPositionModal` at end-of-line were missed and components were falsely reported single-mount.
  The corrected run was validated against a known control (`HeroImagePicker` → single mount at
  `NoteEditorPage.jsx:2192`) before any conclusion was drawn from it. `ImportWizard`'s dead mount
  came from this pass.

Each pass was checked against known-present content before any absence was concluded from it.

## UNKNOWN

- **Runtime confirmation.** Nothing here was observed in a browser. All three defects are read from
  source and branch structure. In particular, instance 3 (`ImportWizard` never mounts on the home
  branch) is a strong structural claim that deserves one real click on a data-bearing account
  before it is filed as reproduced.
- **`ResearchHome.jsx:105` reachability.** I could not determine from the client whether
  `/api/j2/notebook/home` can return all five sections empty for a member who *does* have notes —
  that depends on the server's definition of `continueWorking`, which I did not read. The
  error-path route into that same branch (`useNotebookHome.js:18`) is certain; the
  populated-but-quiet route is not.
- **Wider Journal 2.0 coverage is thinner than Notebook.** Both passes ran over the whole
  `journal-2-0` tree, but I adjudicated Notebook candidates exhaustively and the wider tree only
  where a hit looked like the class. `components/analytics/**`, `components/insights/**` and
  `surfaces/**` were sampled, not swept.
- **Non-React doors.** I searched client callers only. If any of these capabilities is also reachable
  from a server-rendered surface, an extension, or a mobile shell, that is not reflected here.
- **`NotebookTab.jsx:713`** (`Save view`, gated on `!activeView`) is recorded as a near miss because
  clearing the filter restores it, but I did not verify every route into `activeView` — a member who
  lands directly on a saved view by deep link may see no way to save a new one without first
  clearing.
