# Finish program: the AI features after the keyed walk

Source: section 7 of `docs/notebook/fin-walk.md` on `origin/feat/notebook-fin-walk` (tip
`38179e8592`), a real-browser walk of the AI features with live models on `213850e1fa`.
Follow-up branches off `213850e1fa`: `feat/notebook-fin-ai-fe` (this section) and
`feat/notebook-fin-ai-be` (the server halves, its own section).

## Frontend (lane AI-FE, branch `feat/notebook-fin-ai-fe`)

No model key was used. Unit tests use fixtures. The browser check serves every model answer as
a fixture from the browser's own network layer. A separate lane re-walks with real keys. No
file under `api/` was edited.

### Not fixed here, or for another lane

- **K4, the tag that was planned once and refused once: the rule is in the server prompt.**
  The client sends the model nothing but the request (`lib/aiActions.js`, `planAiChanges`:
  the body is `{request}`). The server builds the list the model called "allowed":
  `api/services/journal_two/ai_actions.py`, `build_messages` puts `"tags": context["tags"]`
  in the workspace fence (`:433`), and that list is the member's existing tags, most used
  first, cut to 100 (`:372` to `:385`). The system prompt `_SYSTEM` (`:392` to `:421`) never
  says whether `add_tag` may name a tag that does not exist. Its RULES paragraph does say
  "Use a property's exact name from the workspace fence and, for a choice, one of its listed
  options", and the model sometimes applies that to tags. The server itself accepts a new tag:
  the `add_tag` branch (`:678` to `:699`) only validates the text and refuses a tag the note
  already has. For AI-BE: one sentence in RULES, for example "A tag does not need to exist
  yet: `add_tag` may name a new tag. The `tags` list is what the member already uses, not a
  limit."
- **K7, the chip inside a note is still narrower than 44 px, by design.** It sits in a line of
  prose (32.1 x 23.5 at 390). Its finger target is the invisible extension G-064 worked out,
  which this lane did not change. Only the Ask panel's chip was the 32 x 44 the walk measured.
- **K7, the "Full transcript" line is a title, not the fold control.** The control that folds
  is the chevron button beside it, already 44 x 44. The line was made 44 tall anyway, as asked.
- **K3 reads asterisks only.** `_italic_` and `__bold__` are left as written (snake_case, file
  names). Headings, lists and code in an answer are still shown as the model wrote them.
- **One red that is not this lane's:** `src/__tests__/sourcesAreText.test.js` fails on
  `app/src/pages/terminal/L0Strip.test.jsx:105` (two `0x08` bytes). The same bytes are in the
  base blob at `213850e1fa`.

### What was found and done

| Item | Verdict | Commit | Change |
|---|---|---|---|
| K2 weekly draft never shows the Compass quote (client half) | Confirmed | `38caf7ca8a` | Research Home's review box asks with the member's selected account. |
| K3 raw `**` in Ask answers | Confirmed | `2f91f94e41` | Bold and italic are rendered in the panel and written as editor marks in the note. Rendered, not stripped. |
| K4 "Apply 0 changes" | Confirmed | `35b94bf453` | An empty plan is a plain message with no Apply button. |
| K7 touch sizes | Confirmed | `51737ae2d9` | The panel chip is 44 wide; a toggle's title line is 44 tall. |

### K2. The Home door sent no account

`ReviewDraftsHomeBox` (`components/notebook/ResearchHome.jsx`) called the three draft functions
with no `accountId`. The Insights door (`components/insights/InsightsHub.jsx`,
`ReviewDraftsSection`) already passed one. The Home box now reads `useJ2SelectedAccount`, the
hook every Journal read uses, and passes its id to the daily, weekly and monthly drafts. With
"All accounts" selected the id is null and no parameter is sent, as before. The hook is told not
to fetch while the box is switched off.

The `compassOmitted` sentence was already rendered: `lib/reviewDrafts.js`, `compassSection`,
prints `omitted.sentence` under "What Compass said" in place of the quote. Nothing to add for
AI-BE's explicit reason except that it needs a `sentence` field. A test now pins it through the
Home door.

Test: `components/notebook/ResearchHome.reviewAccount.finAi.test.jsx` (the request URL for
weekly and monthly, the argument for daily, the no-id control, the sentence in the created note,
and no accounts request while off). 4 of 6 were red first.

### K3. Rendered, with one reading for both surfaces

`lib/askEmphasis.js` is the only place the markers are read. `styledParts(answer, sources)`
starts from `splitAnswer`, which stays the only authority on which `[n]` is a citation, cuts the
text parts at emphasis boundaries and drops the asterisks. `AskPanel.jsx` renders `<strong>` and
`<em>` around text nodes. `lib/askInsert.js` writes `bold` and `italic` marks, both level 0 in
the schema.

A pair is read only when it is unmistakable: the same number of asterisks on one line, text
inside that starts and ends with a non-space, and no letter, digit or asterisk glued to the
outside. A list bullet, `5*3*2`, a lone star and a pair still streaming stay as written. The
pattern uses no lookbehind, because the declared floor is iOS 16.

Citations: a chip's stored claim is the paragraph's text nodes joined, at insert and at render,
so removing the markers changes both sides the same way. In the real editor no chip turns
"edited" (pinned). Emphasis that runs across a chip styles the text on both sides and leaves the
chip alone. The Compass quote in a review draft goes through the same builder.

Tests: `lib/askEmphasis.test.js`, `components/notebook/AskPanel.emphasis.finAi.test.jsx`. The
wiring tests were red first.

### K4. An empty plan

`AiActionsPanel.jsx`: with zero changes the panel reads "Nothing to change", "You asked: ...",
the model's summary as text (or "Notebook found nothing to change for that request." when it
gave none), "Nothing was written.", the skipped list if there is one, and "Change the request",
which returns to the box with the words kept. A review with changes is unchanged, including the
disabled "Apply 0 changes" when a member unticks everything.

Test: `components/notebook/AiActionsPanel.emptyPlan.finAi.test.jsx`. 4 of 6 were red first.

### K7. Sizes

- `AskPanel.module.css`: the chip declares `min-width: var(--tap-min, 44px)` at 1024 px and
  below. A real box, not a wider invisible hit area: an extension that reached an earlier chip
  once let a tap on `[2]` open source 3 (the G-064 notes are in `AskCitationView.module.css`).
  Two real boxes cannot overlap.
- `AskCitationView.module.css`: the in-note chip shares the class, so it sets `min-width: 0`
  beside its existing `min-height: 0`.
- `NoteEditorPage.module.css`: a toggle's `summary` is `min-height: var(--tap-min, 44px)` at
  1024 px and below, with its first line level with the chevron.

Rail: `components/notebook/tapFloor.finAi.test.js` (declarations, with a control). 3 were red
first.

### Browser, 390 px touch, port 8133

`tools/notebook_fin_ai_fe_walk.py`. Evidence:
`docs/notebook/evidence/fin-ai/fe-walk-final-51737ae2d9/`. 9 rows PASS, sandbox integrity CLEAN,
port free before and after, 0 page errors. Run 1 is kept: its one failed row was the instrument
(it asked what was on top of chips that were below the screen).

| Check | Measured |
|---|---|
| K3 panel | text `Planned entry (breakout plan): above 412 [1][2]. It was not chased.`; one `strong`, one `em`; no asterisk |
| K3 inserted block | same text under "From Ask Notebook"; `strong` and `em` in the editor; no chip reads "edited" |
| K7 panel chips `[1][2]` | 44 x 44 each, at x 272.9 and 318.9; no overlap; each is the top element at its own centre |
| K7 toggle title | 222 x 44; fold button 44 x 44 |
| K7 chips in a note `[1][2][3]` | 32.1 x 23.5 each; each is the top element at its own centre; no sideways scroll |
| K4 empty plan | 0 Apply buttons, 0 checkboxes, the explanation and "Nothing was written." shown |
| K2 weekly request | `review-drafts/weekly?weekStart=2026-10-05&accountId=<the member's one account>` |

Not checked in a browser: a real model's Markdown beyond bold and italic, and the Compass quote
itself (it needs a generated Compass review).

### Gates

- `npm run build`, then `python tools/notebook_perf_budgets.py --dist app/dist`:
  `bytes.notebook_first_open: 2,219,982 B across 57 JS chunks (budget 2,260,793 B)`, PASS.
- `npx vitest run <named files and directories> --maxWorkers=2`: the whole `a11y/` directory,
  `styles/tapFloor.test.js`, the two target-floor rails, every Ask, citation, AI actions,
  Research Home, review draft, Insights, voice note, toggle, schema and onboarding suite:
  `Test Files 149 passed (149)`, `Tests 2125 passed | 1 skipped (2126)`.
- `components/notebook/NoteEditorPage.voiceNote.test.jsx`: passed.
- `python tools/check_repo_hygiene.py`: clean.
