# P5 starter packs: the arming packet

What this is: everything the owner needs to turn on `NOTEBOOK_STARTER_PACKS_ENABLED` after the P5 PR has merged and
`web` is serving it, and to turn it off again. Merging and arming are the owner's. No agent runs a `railway` command.

The switch name is read from the code, not typed from the plan: `FLAG = "NOTEBOOK_STARTER_PACKS_ENABLED"`
(`api/services/journal_two/starter_packs.py:34`), the auth table entry of the same name (`api/routers/auth.py`, unset
means OFF), and the flag ledger entry (`docs/feature_flags.json`, status `dark`, where `web`). Its payload key is
`notebook_starter_packs_enabled`.

Status (2026-10-19, branch `notebook-p5-launch`): built task by task (Tasks 1 to 10 and 5b), every task reviewed, an
Opus whole-branch review (1 Critical at the P3b merge, 0 Important, 6 Minor) and its one fix round
(`d2fc5ea1ba` .. `c448d6cd8e`), then the landing prep (Task 11 part A): the merge of origin/master `79bb686978`
(P3b #408 and others) as `519a9def16`, the C1 fix `c6f1092bc6` (P5-FIN-R1), and two controller additions
`8c64797f53` (N1) and `43ff1d64e0` (N3) (P5-FIN-R5), and a landing fix to the contract-fixture tool `5f9b94ee44`
(the image tree is per run, so two runs in one process are byte-identical with `starter_packs` last). Nothing here
has been run on production.

LANDING: the PR head. Its code tree was gated at `276c22bc24`: Task 11 part A, plus the ExamplesInUse test fix
`df8a36632e` (P5-T11-R3), plus the merge of origin/master `5a4a8a9907`. Every commit after that is docs or
evidence only, and carry-over says CARRIES (C0 IDENTICAL).

## What merging does, before anything is armed (ruling P5-AUD-2)

The starter switch stays unset at merge. These go live for every member the moment the PR merges anyway, because they
describe features that are already armed on `web` (journal styles, the template gallery, the style library). They are
accepted at merge (P5-AUD-2); nothing in this list needs the starter switch.

1. **Two tours in the Learn menu**: "Journal styles" (`journal-styles`, needs `notebook_journal_styles_enabled`) and
   "Community library" (`style-library`, needs `notebook_style_library_enabled` and
   `notebook_template_gallery_enabled`). Both start on the notes list (`/journal/notebook?view=all`). Source:
   `onboarding/tours/b4Styles.js`.
2. **Two capability lines** in "What your Notebook can do" (`onboarding/capabilityList.js`): "Journal styles" and
   "Community library" (the second also needs the template-gallery switch, P5 final fix).
3. **Three telemetry events**: `style_applied`, `style_created`, `block_used` (`lib/notebookTelemetry.js`). Closed
   enums only, no free text (R-P5-8).
4. **Admin Feature / Hide on style cards** in the library (`GalleryAdminActions`, the one copy; admins only).
5. **The Styles manager's intro is reworded** (`StylesManager.jsx:323`). Before: "Changing a style never changes notes
   you already made." After: "...never changes a note you already made unless you choose to update it." It was
   overstated: editing a style bumps its version, and the update banner offers to update notes made with it.
6. **"New style" moves into the `rowActions` row** (beside Community and Updates) for every member. Before, it was a
   standalone button above that row (`StylesManager.jsx`, ruling P5-FIN-R3). Harmless, but visible.
7. **The gallery hides the 15 firm style rows** while the starter switch is off (P5-AUD-1, one rule,
   `template_gallery._hidden_styles`). They are seeded at boot, approved and featured, with no author, and read as
   absent in every gallery read (the list, UCT picks, one item, the update list, the review queue, an author page,
   the feed) until the switch is on. So merging shows none of them.
8. **The P3b merge fix (C1)** is in the landing tree: every gallery row that reaches the visibility rule now carries
   `kind`. `NOTEBOOK_EXAMPLE_NOTES_ENABLED` is already ARMED on `web` (master `docs/feature_flags.json`, armed
   2026-10-18 22:21 CT), with the library on and the starter switch off. So the C1 risk lands **at the P5 merge
   itself**, not at some later arming: without the fix, the merge alone would make every example read and every
   example image route answer 500. Rail: `tests/test_gallery_rows_carry_kind.py` (ruling P5-T11-R2).

### AT-MERGE production check (after the merge, before anyone arms starter packs)

Run this as the smoke account, or as the bench member account, in its own Playwright context (never the owner's
Chrome):

1. Find one approved example note in the gallery (an `example_note` row from the gallery list).
2. `GET` that example: expect **200**.
3. `GET` its linked style (the example read's `linkedStyle`): expect **200**.
4. `GET` its `images/0`: expect **200**.

If production has no approved example note yet, the check is **vacuous**. Record it as *vacuous*, never as passed.
Any 500 here means C1 regressed. Roll back the merge (H15), then report.

Dark until the switch is armed: the "How do you trade?" offer (on an empty notebook, in the New note sheet and from
the Styles manager's "Starter packs" link), `POST /api/j2/journal-styles/starter-packs/{pack}`, and the 15 firm rows.

## What arming changes, all at once

- **15 featured firm rows enter UCT picks at once.** All 15 seed `featured = 1` (`template_gallery.seed_firm_styles`).
  That is the design (P5-FIN-R3, final review Minor 6), but it is a visible jump in the picks list.
- The offer shows to a member with no styles of their own and no `notebook_starter_pack` preference. The link in the
  Styles manager opens it for anyone.

## Known while the switch is 0 (P5-FIN-R3, T5b Minor 4)

- A member's copy of a firm style has a link to its gallery source. While the switch is 0 that source reads as absent,
  so the link 404s, and the copy's "update available" notice is lost (the update list hides the firm source too).
  The copy itself is the member's and is unaffected. Arming brings both back.

## The metric (ruling P5-T6-R1)

`style_applied` with `via: 'new_note'` counts **every note made through a style**, including creates by `kindId`
(`/plan`, the earnings follow-up), not only a member picking a style by hand (`lib/noteCreation.js:69`). Read it as
"notes made through a style", never as "members who chose a style".

## Preconditions

- `NOTEBOOK_JOURNAL_STYLES_ENABLED` is armed (the offer and the install need it; without it the install 404s).
- `NOTEBOOK_STYLE_LIBRARY_ENABLED` and `NOTEBOOK_TEMPLATE_GALLERY_ENABLED` are armed (the firm rows list only while
  the library is on too; the library tour needs the gallery).

## Arm

```
! railway variables --service web --set "NOTEBOOK_STARTER_PACKS_ENABLED=1"
```

No other switch is needed.

## Checks after arming, in order

1. A NEW boot: a startup line stamped after the `--set`. No boot within ~3 minutes:
   `! railway redeploy --service web --yes`.
2. The value in the running process (over `railway ssh` with `/opt/venv/bin/python`), never from `--kv`: read
   `NOTEBOOK_STARTER_PACKS_ENABLED`, `NOTEBOOK_JOURNAL_STYLES_ENABLED` and `NOTEBOOK_STYLE_LIBRARY_ENABLED` in one call.
3. **The payload key.** As the smoke account, in its own Playwright context (never the owner's Chrome):
   `GET /api/auth/me` carries `notebook_starter_packs_enabled: true`.
4. **The smoke account sees the offer.** The smoke account has no styles of its own and no `notebook_starter_pack`
   preference (check `GET /api/j2/journal-styles`: only built-ins; and its preferences). Open `/journal/notebook`:
   one "How do you trade?" card, five packs and Not now.
5. **Install Swing.** Press Swing (or `POST /api/j2/journal-styles/starter-packs/swing`). Expect 200 and three styles in
   `installed`, the card's "Added: ..." line, and three new rows in `GET /api/j2/journal-styles`.
6. **Nothing is left behind.** Delete each of the three styles through the product's own DELETE
   (`DELETE /api/j2/journal-styles/{id}`, the Styles manager's Delete), and confirm the list holds only built-ins
   again. Then clear the smoke account's `notebook_starter_pack` preference the same way the product writes it, so
   the next run starts from no answer. The install spent one of the account's 10 per hour and 5 per day
   (`notebook-starter-pack`); both expire on their own.
7. **The tours appear in the Learn menu.** As the smoke account, open the Learn menu: "Journal styles" and
   "Community library" are listed.
8. **The capability lines show.** "What your Notebook can do" (the Learn menu panel, or Research Home) lists
   "Journal styles" and "Community library".
9. **UCT picks.** `GET /api/j2/template-gallery?section=picks` now lists the 15 firm styles (`firm: true`).
10. The app-wide client smoke (R-27): `python tools/hub_nav_smoke.py --auth` (H15 on a measured failure;
    INCONCLUSIVE is not a failure).
11. `docs/feature_flags.json`: move `NOTEBOOK_STARTER_PACKS_ENABLED` to `armed` with the flip time, in the same docs
    push.

## Roll back

```
! railway variables --service web --set "NOTEBOOK_STARTER_PACKS_ENABLED=0"
```

Then verify a NEW boot (as above). The install route and every firm style row (UCT picks included) are hidden on the
next request; the offer goes on the member's next reload (an open tab keeps its latched offer, whose install then
answers 404). No redeploy. Nothing is deleted, and copies a member already installed stay the member's own.

## In-process rate-limit scopes this branch adds (CLAUDE.md's SINGLE-PROCESS list)

Already in CLAUDE.md on this branch (merged with P3b's clause at :487); no further docs commit is owed.

| scope | rate | route | durable half |
|---|---|---|---|
| `notebook-starter-pack` | 10/hour, keyed on the member | `POST /api/j2/journal-styles/starter-packs/{pack}` | 5/day in `daily_usage_counters` |

## The announcement

The draft is `docs/notebook/p5-announcement-draft.md`. **The owner posts it**, after arming, and only once every
switch it names is on. No agent posts it.

## Evidence

- **Gate of record:** `docs/notebook/evidence/p5-gate-landing2-20261019T0618/2026-10-19T01-18-36.{json,md}` at
  `276c22bc24`.
  - Result: 17 NEW, 3,595 test files, totals reconcile.
  - Classified in `classification.md` beside it, each file run alone on the branch and on origin/master
    `5a4a8a9907`: 0 this branch's, 13 master's, 4 load-sensitive.
  - The first gate (`p5-gate-landing-20261019T0504`, at `a368118fc3`) found 6 branch rows, every case in
    `ExamplesInUse.test.jsx` (the P5-R-T3-3 "Weekend prep" collision). They were fixed test-only by ruling
    P5-T11-R3, and the second gate is clean.
- **Carry-over and C4 on the landing tree:** `276c22bc24` -> `0abb32a33d` against origin/master `5a4a8a9907`, with
  `--edges-json`. Result: **CARRIES** (C0 IDENTICAL over `GATE_READ_PATHS`).
  - C4 vitest: 26 files, 412 passed.
  - C4 pytest: 879 passed, 2 skipped, 3 failed. All 3 are known base reds: `test_notebook_flag_parse` x2 and
    `test_notebook_telemetry_events::test_the_p3a_library_events_are_on_both_sides_and_read_not_typed`.
  - Evidence: `carry-over-0abb32a33d.txt`, `c4-vitest-0abb32a33d.txt` and `c4-pytest-0abb32a33d.txt`, in the same
    directory.
- **Bytes (final tree):** `bytes.notebook_first_open` is 2,240,572 B on the landing tree and 2,239,350 B on
  origin/master `5a4a8a9907`. Both were built and measured the same way. The delta is **+1,222 B**, under the
  +1,500 B ceiling (P5-AUD-4). The budget file's ceiling, 2,260,793 B, was not raised. Evidence:
  `bytes-0abb32a33d.txt`.
- **Landing rails (part A, on `43ff1d64e0`):** see `.superpowers/sdd/2026-10-17-notebook-p5-launch/task-11-report.md`
  in the spec worktree (the ledger is local).
- **Bytes (part A):** see the same report: the branch and origin/master `79bb686978`, built and measured the same way
  with `tools/notebook_perf_budgets.py`, against the P5 ceiling of +1,500 B over the landing master (P5-AUD-4).
