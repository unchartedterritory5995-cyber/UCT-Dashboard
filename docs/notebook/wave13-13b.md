# Wave 13, lane 13B: My Playbook

Branch `feat/notebook-w13b`, tip `a907a19088f7717fb03a18208e968491d73fa8d7`. Spec: `docs/notebook/WAVE-13-PLAN.md`
Appendix A.13B. Flag `NOTEBOOK_PLAYBOOK_ENABLED`, unset = OFF.

## 1. What shipped

Per-setup cards with R3 wording and ranges, every number opening the trades it was computed
from; "From your notes"; "What you wrote before losses vs wins" (both counts, both n,
"Patterns, not proof"); a frozen snapshot note. Every item of Appendix A.13B's outcome is built;
nothing is deferred.

| file | what it is |
|---|---|
| `api/services/journal_two/sample_size.py` | R3's ONE home (Python): bands, Wilson range, Student-t range |
| `app/src/pages/journal-2-0/lib/sampleSize.js` | R3's ONE home (JS), parity-tested against the Python twin under node |
| `api/services/journal_two/playbook_stats.py` | THE per-setup authority; additive uncertainty fields (`sample`, `winRateStat`, `avgRStat`, `expectancyStat`), `with_trades` drill rows, `untagged_count` |
| `api/services/journal_two/playbook_patterns.py` | the behavioural-pattern miner: fixed word lists, counts + minimums + citations, as-of-entry note reading |
| `api/routers/notebook_playbook.py` | `GET /api/j2/my-playbook`, router-level 404 gate |
| `app/src/pages/journal-2-0/components/insights/MyPlaybook.jsx` | the page at `/journal-2-0/playbook` |
| `app/src/pages/journal-2-0/components/insights/MyPlaybook.module.css` | its styles |
| `app/src/pages/journal-2-0/components/insights/PlaybookSection.jsx` | the Insights door (edited: one `Link`, gate-only) |
| `app/src/pages/journal-2-0/lib/myPlaybookLink.js` | the flag + path helpers, kept apart so the door never pulls the page into its chunk |
| `app/src/pages/journal-2-0/lib/playbookFormat.js` | the one formatter set (page, snapshot and the payload rail all share it) |
| `app/src/pages/journal-2-0/lib/playbookSnapshot.js` | "Save a snapshot note" through the one create door, static node types only |
| `app/src/pages/journal-2-0/components/insights/DisciplineRecord.jsx` | 13A's card now reads R3's wording from `sampleSize.js` (one-line change) |
| `app/src/pages/journal-2-0/a11y/notebookSurfaces.js` | `OUTSIDE_POPULATION_SURFACES` rows: `my-playbook`, `playbook-section-door` |
| `app/src/pages/journal-2-0/a11y/myPlaybook.a11y.test.jsx` | the axe rail (2 recipes, 0 violations) |
| `app/src/App.jsx` | route mount, lazy |
| `tools/notebook_w13b_mutation_proof.py` | the lane's mutation-proof harness |
| `tools/notebook_w13b_playbook_walk.py` | the lane's real-browser walk |

Flag roster rows (all present): `api/routers/auth.py` `NOTEBOOK_FLAGS`,
`app/src/pages/journal-2-0/lib/offline/notebookFlags.js` `FLAG_FALLBACKS`,
`tests/test_notebook_flags.py`, `tools/notebook_switch_rehearsal.py`,
`docs/feature_flags.json` (dark), `docs/notebook/security-review-notebook-routes.md` census row.

## 2. Ruling R3 (sample-size wording) — the one home

```
n < 10        "too few to judge"   the stat rides behind a reveal, never shown plainly
10 <= n < 25  "thin sample"        shown WITH a 95% range (Wilson for a rate, Student-t for a mean)
n >= 25       normal               shown plainly
```

`sample_size.py` and `sampleSize.js` are parity-tested under node over 1,891 rates + 41 means
(`tests/test_notebook_sample_size.py`, 19 cases: bands at the four boundaries 0/9/10/24/25, Wilson
and Student-t pinned against scipy, half-up rounding in both languages, a planted-defect control
proving the parity rail can fail). 13A's `plan_grading.py` and `DisciplineRecord.jsx` both import
this module/file rather than restating the wording — one line changed in each to do it.

## 3. The route

`GET /api/j2/my-playbook?accountId=` → `{asOf, accountId, setups, untagged, notesBySetup,
patterns, sample}`. Router-level 404 before the session is read while the flag is off
(`tests/test_notebook_playbook.py::test_404_while_the_flag_is_off_before_any_session`).
Member-scoped: every read keys on the session user id; `accountId` only narrows the member's own
trades (another member's id matches nothing). Read-only — the only write on this surface is the
member's own click on "Save a snapshot note", through the Notebook's one create door.

`playbook_stats.get_playbook_stats(..., with_trades=True)` is the ONE per-setup authority: the
drill list for a number is read from the same rows the number itself was computed from, so a
drill can never disagree with its count. `untagged_count` is the exact complement of the base
predicate (closed trades with no setup).

`playbook_patterns.behaviour_patterns` mines a FIXED word list (the account's own mistake/emotion
taxonomy, else `tag_suggest.py`'s standard vocabulary) over notes linked to a trade and readable
as they stood at entry (`plan_grading._note_state_at`, reused — never restated). Minimums:
`MIN_NOTED_PER_SIDE=5` per side before any comparison is made at all; `MIN_MENTIONS=3` before a
word becomes a finding. Every finding carries both counts, both n, and cites the trades and notes
it came from. No model, no p-value. Caption: "Patterns, not proof".

## 4. Mutation proof

`tools/notebook_w13b_mutation_proof.py` — 14 mutations over the Python and JS rails (R3's
boundaries in both languages and the parity rail itself, "no stat without its n", the too-few
reveal, every payload number being the authority's, the drill's same-rows guarantee, the broker
mirror, the patterns' as-of-entry reading, its minimums and citations, the frozen snapshot, and
the route gate). Discipline: each mutation applied to the CAPTURED bytes of one file, the named
rail FILES run whole (never `-k` / `vitest -t`), a mutation counts as killed only when the run
reports at least one failed test, every restore writes back the captured bytes and is verified
against `git cat-file blob HEAD:<path>` (LF-normalised) — never `git checkout`. An unmutated
control runs green before and after.

**First run** (`docs/notebook/evidence/wave13-13b/mutation-ba3b6b3efe.txt`, kept for history):
13 of 14 killed; **A2 SURVIVED** ("a note written AFTER entry counts as a before-note" — dropping
the `created > cutoff` check in `playbook_patterns.notes_before_trade`).

**Why it survived, and why it was a real gap, not an equivalent mutant.** Traced by hand and
confirmed with an isolated manual re-mutation: `_note_state_at` (reused from `plan_grading.py`)
reads `updated_at` first, and for every hand-made note `add_note`/the product's own create path
sets `updated_at == created_at`, so the `post_entry` check two lines below the mutated one still
independently excludes a note whose `created_at` is after the trade — the A2 guard never got to
be the one that mattered, against every existing fixture. But `notes.py`'s file importer
(`_import_date` on `n.get("createdAt")` / `n.get("updatedAt")`) sets the two timestamps
INDEPENDENTLY from external source metadata, so a real imported note can carry `created_at` after
entry with `updated_at` before it. On that shape `_note_state_at` alone reads the CURRENT body as
a valid pre-entry state (`post_entry: False`) — the `created_at` check in `notes_before_trade` is
the only thing standing between that row and a fabricated "before" note.

**The fix:** `tests/test_notebook_playbook.py::test_a_notes_own_created_at_gates_it_even_when_updated_at_predates_entry`
(commit `7df067a746`), constructing exactly that shape (`created=after(entry), updated=before(entry)`)
and asserting the note is excluded. Verified by hand before trusting the re-run: manually
re-applying the A2 mutation against this new test fails it (2 of 17 fail); against HEAD it passes
(17 of 17). A one-line comment (commit `dd1f99bf46`) records the reasoning at the guard itself so
a future reader does not conclude it is dead code and delete it.

**Re-run, clean** (`docs/notebook/evidence/wave13-13b/mutation-dd1f99bf46.txt`): **14 of 14
killed**, every restore verified against the committed blob, `git status` over `api/` and
`app/src` clean after the run. `VERDICT: PASS`.

⚠️ **Process note, for the record.** The first re-run attempt (at commit `7df067a746`) was
discarded without being trusted: while it ran in the background, this session made an unrelated
comment-only edit to `playbook_patterns.py` (the same file the A1/A2/Q1/C1 mutations target) and
caught the collision via `git status` mid-run. Restoring to the exact HEAD blob did not reliably
settle `git status` (a stat-cache artifact, resolved with `git checkout --`, confirmed with
`git hash-object` against the index both before and after), and that run's C1 mutation came back
SURVIVED where a manual isolated re-test of the identical mutation showed it correctly KILLED —
consistent with the edit's write landing between the harness's mutate-write and its pytest
subprocess's read, not with a real gap. That run's evidence file was deleted, never committed, and
the harness was re-run a second time with no concurrent edits to confirm cleanly. Recorded here
rather than silently dropped, per this repo's rule that a corrupted run must be acknowledged, not
quietly discarded as if it never happened.

## 5. Real-browser walk

`tools/notebook_w13b_playbook_walk.py`, sandboxed via `tools/notebook_perf_harness.Sandbox`
(ports 8635/8636), `app/dist` built at tip `baec92b22c` (no `app/src` changes since, confirmed by
diff). Seeds 42 closed trades across 3 setups the way a member makes them: a plan note on the
ticker FIRST, the trade a minute later, then 13A's grade read freezing the note as the trade's
plan — Pullback 25 (normal), Breakout 12 (thin; each on its own ticker, FOMO before 4 of 5 losses
and 1 of 7 wins, patient before the rest), EP 3 (too few), 2 untagged.

**Flag-ON pass (port 8635), `docs/notebook/evidence/wave13-13b/walk-baec92b22c/` — ALL 10 PASS:**

| check | result |
|---|---|
| W0 gate + identity | payload flag true, plan-grading flag true |
| W1 seed | 42 trades, 0 failures, all 12 Breakout plans frozen (status=planned, noteId matches) |
| W2 open from Insights (1200px) | Pullback normal n=25, Breakout thin n=12 with its range, EP too_few n=3 behind a reveal; every stat carries its n |
| W3 drill | Breakout win rate opens exactly 12 rows (== `winRateStat.n`) |
| W4 too-few reveal | hidden before, shown after, value 67% |
| W5 cited pattern | FOMO leans losses (4 of 5 losses, 1 of 7 wins), 5 citations on screen, 5 note links |
| W6 frozen snapshot | saved, carries the R3 wording, no live widget |
| W7 keyboard | Tab reaches the stat (28 presses), Enter opens its drill |
| W8 390px touch | no horizontal scroll before or after the drill, zero sub-44px targets |
| W9 no page errors | none |

Sandbox integrity: **CLEAN** at pre-boot, +15s, +120s and shutdown; 62 db files hashed;
`C:\data` untouched.

**Flag-OFF pass (port 8636), `docs/notebook/evidence/wave13-13b/walk-baec92b22c-off/` — ALL 5 PASS:**

| check | result |
|---|---|
| F0 payload flag off | `notebook_playbook_enabled: false` |
| F1 API 404 | `GET /api/j2/my-playbook` → 404 |
| F2 page redirects | lands on `/journal/insights`, 0 `my-playbook` nodes in the DOM |
| F3 no door in Insights | 0 `open-my-playbook` nodes |
| W9 no page errors | none |

Sandbox integrity: **CLEAN** at pre-boot, +15s, +120s and shutdown; 62 db files hashed;
`C:\data` untouched.

## 6. Decisions (this lane's own, for the controller)

1. **The A2 finding was a test gap, not a product fix.** The product's `created_at` guard was
   always correct; the suite never exercised the one data shape (independently-set
   `created_at`/`updated_at` from an import) where it is the ONLY thing standing between a row
   and a fabricated finding. Closed with a test plus a one-line comment, no behaviour change.
2. **Untagged trades sit on no card and are counted, never hidden** (`untagged.count`),
   matching the plan's "Not: a fourth per-setup computation" — the existing per-setup authority
   is reused byte for byte, only additive fields were appended.
3. **The frozen snapshot never embeds a live widget** — `playbookSnapshot.js`'s
   `SNAPSHOT_NODE_TYPES` allowlist is the enforcement; the S1 mutation (a live `widgetEmbed`
   slipped into the note) is in the proof set and killed.

## 7. Handoffs and overlaps

* **13I-2** (visual playbook) and **13J** (board + find-similar) are scheduled to land on this
  lane per the plan's dependency order (`13B lands -> 13I-2 / 13J`); nothing in this lane blocks
  them beyond the flag.
* **13F** and **13I** are listed as future consumers of `sample_size.py` / `sampleSize.js`
  (plan §"Sample-size wording") — no code from this lane needs to change for them.
* No file outside `journal-2-0/`, the two `sample_size` homes, `notebook_playbook.py`, and the
  flag-roster append-points was touched.

## 8. Verification (scoped, by named file)

* `tests/test_notebook_sample_size.py` — 19 passed.
* `tests/test_notebook_playbook.py` — 17 passed (16 at hand-off + the new A2-closing test).
* `python -m pytest tests/test_notebook_playbook.py tests/test_notebook_sample_size.py -q` —
  36 passed in 25.76s (run together, this session).
* `npx vitest run src/pages/journal-2-0/components/insights/MyPlaybook.test.jsx
  src/pages/journal-2-0/lib/playbookSnapshot.test.js src/pages/journal-2-0/lib/sampleSize.test.js
  --maxWorkers=1` — 17 passed (3 files), confirmed inside the mutation-proof CONTROL steps.
* a11y: `myPlaybook.a11y.test.jsx`, 2 recipes, 0 violations (part of the CONTROL vitest set).
* Mutation proof: 14 of 14 killed, `docs/notebook/evidence/wave13-13b/mutation-dd1f99bf46.txt`
  (VERDICT: PASS). First run superseded: `mutation-ba3b6b3efe.txt` (VERDICT: FAIL, A2 surviving),
  kept for history.
* Real-browser walk: flag-ON 10/10 PASS, `walk-baec92b22c/` (integrity CLEAN). Flag-OFF
  5/5 PASS, `walk-baec92b22c-off/` (integrity CLEAN).

## 9. Open items

None outstanding against Appendix A.13B. The flag stays dark (unset = OFF) until the wave-13 PR
merges and the owner arms it per P6.
