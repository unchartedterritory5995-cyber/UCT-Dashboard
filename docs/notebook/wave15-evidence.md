# Wave 15 evidence — integrator lane W15-SC

Scope: apply the four wave-15 evidence proposals (`docs/notebook/evidence/scorecard-research/
{notion,evernote,obsidian,uct}-proposals.md`) to `docs/notebook/parity-scorecard.md`. Docs/scorecard
only — no product code touched. This file records what moved, what stayed and why, the G-152 ruling,
and the AlertBell 390 px overflow finding the UCT lane's walk surfaced.

## BEFORE / AFTER (mechanically derived)

`python tools/parity_scorecard.py --dry-run` before any edit vs. after `--write`:

| | BEFORE | AFTER |
|---|---|---|
| rows | 133 | 133 |
| quote keys used | 162 | 169 |
| standards at bar | 3 of 16 | 3 of 16 (unchanged — none of this lane's moves touch a §B standard clause) |
| clauses breakdown (`{standard: met/total}`) | identical to AFTER | identical to BEFORE |
| rows in "every BEHIND, NOT-VERIFIED or BLOCKED verdict" | 59 (`grep -c '^- \*\*G-' `) | 58 |

One row — **G-156** — moved from having a NOT-VERIFIED cell to all three columns PARITY and dropped out
of the owed list entirely. Every other moved row still carries at least one NOT-VERIFIED cell (on a
column this lane's controller rulings or scope left untouched), so it stays listed.

## Rows whose verdict moved (7 rows, 7 cells: 6 to PARITY, 1 to AHEAD)

| row | column | before | after | quote (verbatim, ≤25 words) | source |
|---|---|---|---|---|---|
| G-005 | O | NOT-VERIFIED | PARITY | "File recovery is a core plugin that protects your work from accidental deletions, file corruption, or unwanted changes" | `obsidian__Plugins_File_recovery_md` (R18's own entry — byte-identical sha256 to this wave's re-fetch, reused rather than duplicated) |
| G-110 | O | NOT-VERIFIED | PARITY | "If the search term is empty, the Quick switcher shows the most recent notes." | `obsidian__Plugins_Quick_switcher_md` (R18's entry, byte-identical) |
| G-113 | O | NOT-VERIFIED | AHEAD | "Obsidian only searches the contents of notes and canvases." | `obsidian__Plugins_Search_md` (R18's entry, byte-identical) |
| G-124 | N | NOT-VERIFIED | PARITY | "If you ask about topics that aren't explicitly covered in your workspace, Q&A won't return a result." | `notion__understanding_how_q_and_a_finds_answers_can_help_you_get_better_results` (new page, R20) |
| G-144 | N | NOT-VERIFIED | PARITY | "Undo/Redo: Take back your last action on a page, or reinstate it." | `notion__writing_and_editing_basics_w15` (re-fetch, different sha256 from R18's own `notion__writing_and_editing_basics`, so recorded under its own page id rather than overwriting R18's) |
| G-156 | N | NOT-VERIFIED | PARITY | "Repeating database templates automatically create a copy of a template in your database however often you would like." | `notion__database_templates_w15` (re-fetch, different sha256 from R18's own `notion__database_templates`, same reasoning) |
| G-171 | O | NOT-VERIFIED | PARITY | "Obsidian's sandbox vault is a feature that lets you explore various functionalities without affecting your existing data." | `obsidian__getting_started__sandbox_vault` (new page, R20) |

G-113's Obsidian AHEAD and Notion/Evernote NOT-VERIFIED are discussed under their own heading below —
this is the one row where two of the four proposal files disagreed and a controller ruling decided it.

## Rows with evidence added, verdict unchanged

**G-041** (comment/annotation field at capture time) and **G-153** (reminders) gained the UCT-side WALK
citations from `uct-proposals.md`, per the controller's explicit ruling. Neither row's verdict moved —
adding a WALK citation closes a UCT-side "was this ever driven" gap, not a competitor-citation gap, and
the ruling asked only for the citations (plus, for G-153, saying why the bell check is 390 px-only), not
a verdict judgment this lane wasn't asked to make.

- **G-041**: `WALK tools/notebook_w15_uct_walk.py:G041_capture_desktop_1200 PASS` and
  `:G041_capture_mobile_390 PASS`, report `docs/notebook/gate-runs/wave15/walk-uct-674012eb1.json`, tip
  `674012eb1`. The row's note no longer says "not driven" / "UI not confirmed" — it now says what was
  driven (the "Your note" field round-tripped through the real capture endpoint and was found verbatim
  by excerpt search). The stale `lever` text ("drive the capture dialog…") was removed; the owed-list
  line now reads `N: a page that states it (next R-row); O: a page that states it (next R-row)` —
  auto-computed by the tool from the unchanged N/O cells, not hand-typed, so it cannot drift from them.
- **G-153**: `WALK tools/notebook_w15_uct_walk.py:G153_reminder_delivered_server PASS` and
  `:G153_reminder_bell_mobile_390 PASS`, same report/tip. The note records the reminder was observed
  end to end (seeded overdue task → `GET /api/alerts` 48.7s later → the real bell, correct title/
  message/badge/click-through) and states **why there is no 1200 px check**: `NavBar.jsx` carries only
  a comment that the desktop bell was removed by owner request (2026-09-02, commit
  `feat(nav): sidebar revamp`), and `<AlertBell/>` mounts only from `MobileNav.jsx` — so 390 px is the
  only width this row *can* check, not a gap in the walk. The stale `lever` ("observe one reminder end
  to end") was removed; the owed-list line is now auto-computed as `O: a page that states it (next
  R-row)` (Obsidian's the only cell this lane didn't touch).

### The AlertBell 390 px overflow finding (from the UCT lane's walk)

While driving `G153_reminder_bell_mobile_390`, the UCT lane's walk found the bell's dropdown **clips at
the right edge of the viewport at 390 px** — visually confirmed in the committed screenshot
(`docs/notebook/gate-runs/wave15/shots/r103146-g153-390-dropdown.png`) and in the check's own recorded
bounding-box facts (`item_on_screen: false`, the row's right edge past the 390 px boundary). Root cause,
read from source: `app/src/components/AlertBell.module.css`'s `@media (max-width: 640px)` block sets
`right: -40px` on `.dropdown`; since `AlertBell` is the **rightmost** element in `MobileNav.jsx`'s top
bar, that offset pushes the dropdown *further off* the right edge instead of pulling it on screen.

This is recorded as a **finding**, not a row-failing defect, the same treatment wave 12 gave its two
chevron FAILs on G-026: the thing G-153 measures — does the reminder reach the member — is true (the
notification's title and message were still fully readable and content-matched; Playwright's
accessible-name match found the row and its `inner_text()` was exact). `AlertBell.module.css` is a
shared, cross-cutting surface used by every alert type (price alerts, scanner matches, catalysts,
document arrival, this reminder) and is not Notebook-owned, so it is not fixed in this lane (whose
charter is "fix it in Notebook-owned files" — this file isn't one). The scorecard's G-153 cell carries a
one-line pointer to the finding; this is the full record for whoever owns `AlertBell.module.css`.

## The G-152 ruling (Notion "Side peek")

The W15-N proposal recommended **PARITY, flagged** for Notion on G-152 (split view, two notes side by
side), citing "Side peek: Open pages on the right side of the database. The rest of the database view
continues to be interactive on the left." The controller's ruling for this lane was explicit: **G-152
stays NOT-VERIFIED.** Reasoning (also now in the scorecard's own note for this row): Notion's "Side
peek" opens a page beside a **database table view**, not a second arbitrary note beside the first the
way UCT's split view and Obsidian's tabs (already PARITY on this row) both are — checked, and not a
match.

The ruling gave two options: record the quote as checked-and-not-matching if the tool has a place for
that, else leave the row unchanged and note why in this doc. **The tool does have a place for it** —
the same idiom already used elsewhere in the file (e.g. G-113's own Evernote cell, pre-existing): cite
the real quote as a list (so it renders with its URL, verbatim text and date, and is included in the
Citations index and the §0/R-row machinery like any other citation), keep the verdict NOT-VERIFIED, and
explain the mismatch in the row's own note. There is no separate "checked-and-not-matching" verdict
code in `parity_scorecard.py`'s closed set (`AHEAD`/`PARITY`/`BEHIND`/`N/A`/`NOT-VERIFIED`/`BLOCKED`) —
a cited-quote-with-NOT-VERIFIED cell *is* how the tool represents "we looked, and it doesn't settle
the row," so that is what was used rather than leaving the cell as the generic "no page fetched today
states it" placeholder it carried before.

## G-113 — the one row two proposals disagreed on

Both the Evernote and Obsidian proposals offered an AHEAD upgrade for this row (page-aware document
search, sectioned separately from note search). The controller's ruling: apply AHEAD only if the
quote **itself states the limit**, not an inference — and ruled Obsidian's quote does, Evernote's
does not. Applied exactly that split:

- **Obsidian → AHEAD.** "Obsidian only searches the contents of notes and canvases." is a direct,
  explicit statement of scope that *names what is excluded* (attachments, including PDFs) — the same
  "competitor's own page states a ceiling" pattern the scorecard already uses for G-143's AHEAD
  verdicts.
- **Evernote → stays NOT-VERIFIED.** The Evernote proposal's quote — "the note list shows the line
  where your keyword actually matched, not just the first line of each note" — is read in full context
  on `evernote__search_overview`'s "Search results and Find in Note" section: it describes *how a
  matched line is displayed* once a search runs, not a stated claim that document/PDF matches are
  (or are not) sectioned separately from note matches. The word "sectioned" or any equivalent never
  appears; the reading that Evernote keeps everything in "the note list" is drawn from the architecture
  implied by the page, not a sentence that states it. Per the ruling, that is an inference, and the row
  stays NOT-VERIFIED for Evernote — the cell's own note explains the distinction so the next reader
  does not have to re-derive it.

## Proposals reviewed and NOT applied

- **Evernote G-102** (app-wide command palette does not include Notebook). The W15-E proposal found
  zero Evernote pages naming any app-wide command-palette construct and *flagged* — did not firmly
  recommend — reclassifying the Evernote cell from NOT-VERIFIED to N/A, explicitly leaving that call to
  the integrator. Not applied, for three reasons: (1) the proposal itself deferred rather than
  recommended; (2) `N/A` in this tool's closed set is used, without exception elsewhere in the 133-row
  file, as a **row-level** marker (`R(rid, 'NA', ...)`, applied uniformly to N/E/O together) for a
  UCT-unique/UCT-internal row — there is no existing precedent for a per-vendor mixed verdict carrying
  an N/A cell beside real P/NV/A/B verdicts on the same row, and G-102 already has two real verdicts
  (Notion PARITY, Obsidian PARITY) on the other two columns; (3) no controller ruling authorized
  introducing that new convention. G-102's Evernote cell is unchanged.
- **The absence-to-verdict rule.** Checked every remaining NOT-VERIFIED cell in all three proposal
  files whose reasoning was "no page states it" (the large majority of all three): none of those were
  proposed as anything other than NOT-VERIFIED, so this rule had nothing further to enforce beyond
  confirming it — no silence was turned into AHEAD/BEHIND anywhere in this pass.

## Bookkeeping needed to make `--write`/`--verify` pass (docs/tool only)

- **New research-ledger row `R20`** in `docs/notebook/competitive-research-ledger.md` (the existing
  `R19` was already taken by a different, earlier re-fetch-control pass dated 2026-10-02 — checked
  before reusing anything). Documents the 5 freshly-fetched pages (4 Notion, 1 Obsidian) and that 3 more
  Obsidian pages (file-recovery, quick-switcher, search) came back byte-identical (same sha256) to
  R18's own fetch, so they reuse R18's existing `SOURCES` entries rather than duplicating them.
- **8 new `QUOTES` keys** (`N_qarefuse`, `N_touchundo`, `N_sidepeek`, `N_dailytemplate`, `O_crashsafe`,
  `O_recents`, `O_searchlimit`, `O_sandbox`) and **5 new `SOURCES` entries** — the 4 Notion pages (under
  `_w15`-suffixed page ids, since their sha256s differ from R18/R12's own fetches of the same URLs —
  Notion's pages changed between 2026-09-26/2026-10-02 and 2026-10-04) plus the 1 new Obsidian page
  (`obsidian__getting_started__sandbox_vault`). The 3 byte-identical Obsidian quotes cite R18's existing
  `SOURCES` entries directly (`obsidian__Plugins_File_recovery_md`, `_Quick_switcher_md`, `_Search_md`)
  — confirmed by comparing this lane's own sha256 (from the W15-O proposal) against the committed
  `SOURCES` sha256 before writing anything, rather than assuming.
- **New git tag `notebook-wave15-sc-2026-10-04`**, pointing at this worktree's pre-commit HEAD
  (`215d58aedc`, which already carries lane W15-UCT's merged-in walk evidence), registered as `'wave
  15'` in `B0_WAVES`/`B0_EVIDENCE` and as the `B0_TIPS` anchor for the UCT walk's tip `674012eb1` (an
  ancestor of that tag's commit) — the same pattern `'wave 12 C2'` and `'wave 13'` already use for a
  wave with no squash yet. `B0_TIPS` entries may not anchor on literal `'HEAD'` (an existing rail,
  `test_the_evidence_index_holds_on_the_real_inputs_and_is_not_vacuous`, enforces this — "no measured
  tree leans on HEAD, which a squash would leave behind" — caught on first `--dry-run` of the test
  suite and fixed before committing).
- `W15_UCT_WALK`/`W15_UCT_WALK_TOOL` constants + a `walk15uct(cid, want='PASS')` helper, following the
  existing `walk10`/`walk12d` pattern.
- `tests/test_parity_scorecard.py`'s running-tally count of backticked evidence paths (61 → 62, one new
  path: the UCT walk report, now cited by both G-041 and G-153) updated with its own dated comment line,
  matching every prior lane's entry in that same running tally.
- **Environment, not code**: this worktree was freshly created and had no `app/node_modules`, which the
  tool's §15b check (`tools/telemetry_rail_asserts.mjs`, a Node/acorn AST pass) needs. Fixed with a
  directory junction to `notebook-w13-landing/app/node_modules` (the documented recipe in this repo's
  `CLAUDE.md` — "a directory junction to an installed node_modules is enough"), not an `npm ci` (low
  available memory at the time, ~224 MB). Nothing under `app/node_modules` is tracked or committed.

## Verification run

```
python tools/parity_scorecard.py --write --pages <merged dir>
  -> wrote docs/notebook/parity-scorecard.md 419507 chars
  -> {'rows': 133, 'quote_keys_used': 169, 'at_bar': 3, 'quotes_verbatim_checked': True}

python tools/parity_scorecard.py --verify --rev HEAD
  -> checked against HEAD: CODE 150, FLAG 11, MEASURE 35, RECORD 108, RULING 18, TEST 36, WALK 67
  -> VERIFY: PASS

python -m pytest tests/test_parity_scorecard.py tests/test_parity_scorecard_evernote_fold.py -q
  -> 52 passed, 2657 warnings in 333.74s (0:05:33)

python tools/check_repo_hygiene.py
  -> clean: 22478 tracked file(s), no oversized file, no .env* outside the allowlist, and no
     line-ending flip against the stored blobs
```

The `--pages` directory used for the verbatim check is a merged temp directory under the scratchpad
(not committed): the existing `w12c-pages` archive (118 files, lane 12C's own R18 fetch, still on disk
from that session and confirmed by an unmodified `--dry-run --pages` to already cover every
pre-existing quote in the file) plus this lane's 5 new/re-fetched pages (4 Notion files copied under
their `_w15`-suffixed names, 1 new Obsidian file copied under an `obsidian__`-prefixed name matching
this file's existing pid convention for that vendor).

## Commit

Branch `feat/notebook-w15-n`. Tip: *(filled in after commit — see the handback message for the 40-char
SHA)*.
