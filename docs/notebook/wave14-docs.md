# Wave 14, docs lane: the sample's resurfacing notice, the handoff, the onboarding guide

Branch `feat/notebook-w14-docs`, from `c55d73ae69` (integration round 2).

## 1. The sample's resurfacing notice (code, commit `36ede703cf`)

**What was wrong.** W14-E's thesis example called `voice_proactive_service.add_insight` at
importance 8. That one call:

- ranked the sample above every real resurfacing (R7-R9 never exceed 7; the inbox and the voice
  opener sort `importance DESC`), at the away floor of 8;
- mirrored it into the member's Compass chat thread, which `dismiss()` does not undo, so
  Remove could never fully clear it;
- spent one of the two resurfacing slots a day (`MAX_RESURFACE_PER_USER_PER_DAY`) and put
  `(NVDA, note_level_touch)` on a 6-hour cooldown, so a REAL NVDA resurfacing that day was
  dropped;
- wrote a ledger row, so the next review draft listed the example as "resurfaced".

Separately, the thesis note's projected NVDA stop was read by the resurfacing scan, so an 8% NVDA
day (R8) or a cross of 110 (R7) would have fired a real notice from the sample note.

**Choice: visible only where the sample explains it.** Minimal importance was rejected: at 4 it
still reaches the inbox, the chat mirror and the voice opener, and still spends the budget and
the cooldown (mutant M1b below proves the rails catch it). Now:

- seeding writes no insight and no ledger row; the notice is a callout inside the thesis note,
  starting "Example:", worded like a real R7 notice and saying it is not a live alert. Trashing
  the note (Remove) clears it;
- `note_levels.load_index` skips `j2_notes.import_source = 'sample'` (`IS NOT`, so NULL sources
  are kept). The level rows still exist, so the thesis chip still shows the stop;
- `sample_examples.remove` still dismisses an `insightId` recorded by the earlier version.

Known edge: a member who edits the sample thesis note into a real one keeps `import_source =
'sample'`, so that note will not resurface. A sample note is the member's to delete, and a
member's own notes are unaffected.

**Rails** (`tests/test_sample_notebook_examples.py`): `test_seeding_queues_no_insight_at_all`,
`test_the_example_notice_is_shown_in_the_thesis_note_and_labelled`,
`test_the_sample_leaves_the_real_resurfacing_budget_untouched`,
`test_a_sample_note_is_never_read_by_the_resurfacing_scan` (with a member's own NVDA note as the
control), `test_remove_still_clears_an_insight_recorded_by_the_earlier_version`. Three existing
assertions in `test_sample_notebook.py` / `..._examples.py` now expect `insightId` None.

**Mutation proof** (applied by text, restored from captured bytes and checked equal):

| mutant | result |
|---|---|
| M1 restore the importance-8 insight + ledger fire | 7 failed, 44 passed |
| M1b the same insight at importance 4 | 4 failed, 47 passed |
| M2 drop the `load_index` sample filter | 1 failed, 50 passed |
| M3 drop the in-note callout | 1 failed, 50 passed |
| M4 `remove()` ignores a recorded `insightId` | 1 failed, 50 passed |
| control after restore | 51 passed |

**Test runs.** `pytest tests/test_sample_notebook.py tests/test_sample_notebook_examples.py
tests/test_sample_notebook_trade_exclusion.py`: `85 passed in 117.08s`. With
`test_awareness_resurface.py`, `test_awareness_engine.py`, `test_notebook_thesis_chips.py` and
`test_review_drafts.py` added: `164 passed in 226.86s`.

**`entry_context.freeze_static` is dead.** No caller in `api/`, `tests/`, `tools/` or the app
(its only caller was the sample trade's entry context, removed in integration round 2). Left in
place, as asked; `entry_context.forget` is still reached by `sample_examples.remove` for an
old preference.

## 2. Docs

- `BETA-HANDOFF.md`: section 1c rewritten (the getting-started switch and its three parts, every
  tour and the switch it rides, the four tours that appear with no flip because their features
  are already armed, W14-C2 not yet merged, how to check); new section 1d, one proposed arming
  order for every dark Notebook switch from waves 11-14 (formulas, gallery, the wave-13
  fourteen unchanged as steps 3-16, getting started last; voice notes and meaning search held;
  the wave-K gates never). 1b now points to 1d instead of carrying its own list.
- `onboarding.md`: a wave-14 section for a maintainer (the registry and how to add a tour, its
  rails, seen state, the C2 prompt, Help's Walkthroughs and What's new, the preview and the
  checklist, the sample's capability examples and their two hard rules).
