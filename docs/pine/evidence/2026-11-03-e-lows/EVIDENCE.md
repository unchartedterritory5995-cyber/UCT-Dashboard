# E evidence-engine lows: evidence

Branch `fix/pine-evidence-engine-lows`. Code tip `e58edcbeaf` (this file is a docs-only commit on top).
Tested on master `52f76f9b4f` (merge-base of the tip; origin/master has since moved to `0aeac8cfdb`, a deploy-gate timeout change that touches none of these files).
Engine bump: NO. Nothing under `app/` changed: the five files are `tools/vendor_harness/evidence_engine.py`, `tools/vendor_harness/evidence_engine_mutations.py`, `tests/test_evidence_engine.py`, `docs/pine/EVIDENCE-ENGINE-DESIGN.md`, `docs/pine/vendor-harness/capture-queue.json`. `SCRIPT_ENGINE_VERSION` not touched.

## The five lows
1. Manifest stem: `gate_capture` holds a capture id to the run manifest's own `captureStem` (when that entry carries the capture's source sha), so a same-slug file added between capture and promote cannot unpromote a valid capture. `build_packet` hands the gate the entry.
2. Section chart: a section's chart beats the preamble's, and the listing flag follows the chart that was used. Rail-only: this behaviour was already right on master; the commit adds the rail.
3. Prose cells: a probe named in a prose-headed column (`PROSE_HEAD_RX`) is a fixture reference, never a request or an owed probe.
4. Headings: the finished-capture heading rule (`FINISHED_HEAD_RX`) takes numbered, lettered and mixed-case headings; `Built-in ...` is not one.
5. Design doc: no LICENCE_HOLD targets, no `--local-evidence` (flag removed from `manifest`/`batch`, rail added that fails if the flag or the doc's promise returns).
Also: `capture-queue.json` regenerated (stale on master).

## Rails
`tests/test_evidence_engine.py`, 41 tests. New (one or two per low):
- low 1: `test_a_capture_is_held_to_the_stem_its_run_manifest_asked_for_not_to_todays_world`, `test_a_manifest_stem_is_still_the_stem_an_id_must_open_with_and_only_for_its_own_source`
- low 2: `test_a_sections_chart_beats_the_preambles_and_the_listing_flag_follows_the_chart_that_was_used`
- low 3: `test_a_probe_named_in_a_prose_cell_is_a_reference_never_a_request`
- low 4: `test_a_finished_capture_heading_is_recognised_numbered_or_in_any_case`
- low 5: `test_there_is_no_local_evidence_mode_and_the_design_doc_says_so`

Red on master: `evidence_engine.py` and the design doc swapped to merge-base bytes (`git show HEAD~1:<path>`), tip tests kept, restored byte-exact (assert after write): `5 failed, 36 passed`. The five failures are the five rails for lows 1, 1b, 3, 4, 5. Low 2's rail PASSES on master by design (rail-only); its proof is the mutations below (4 killed, one of them the section chart ignored outright). Green on tip: `41 passed`.

## Mutations (`python -B tools/vendor_harness/evidence_engine_mutations.py`, in the hl job)
`VERDICT: PASS (71/71 KILLED; control exit 0)`, `CONTROL: 41 passed`, 0 survivors, 0 equivalent. 19 are new for these lows (2 older ones were re-pointed):
| mutation | killed by |
|---|---|
| gate ignores the manifest captureStem; packet does not hand the entry (2) | low-1 rail |
| a manifest stem is taken for another source's capture | low-1b rail |
| section chart ignored; section listing wording flags a row on its own chart; section listing wording ignored; preamble listing flags a section-chart row (4) | low-2 rail |
| prose cell can ask; no column read as prose; bare stem in prose not filed as ref; `.pine` name in prose not filed as ref (4) | low-3 rail |
| heading must be upper case; may not be numbered; `Built-in` reads as finished; emphasis hides the heading (4) | low-4 rail |
| manifest takes `--local-evidence` again; doc promises the mode again; doc offers the flag on manifest; doc says LICENCE_HOLD is a state again (4) | low-5 rail |
| gate holds id to the raw stem (re-pointed to the bad-id rail); fixture-reference-as-source (re-pointed to the prose rail) | as named |

## final-tip
Command: `hl elows-final -- bash job.sh` = mutations, then `final-tip.sh pine-dsk-elows elows-final tests/test_evidence_engine.py`, on tip `e58edcbeaff87d2280ea93376d4bc4c5b0159e56` (log dir `_resume-2026-11-01/runs/elows-final/`).
- gate pytest: `46 passed` (rc=0). Hygiene rc=0: `clean: 34655 tracked file(s)...`. `tests/test_evidence_engine.py`: `41 passed`.
- full chart+hooks vitest: `Test Files  1 failed | 1333 passed | 27 skipped (1361)`; the one failure is `src/hooks/pollingSites.rail.test.js`, the known desktop baseline (exactly the baseline). No other file failed.
- measure-pair: not applicable (no engine/runtime source changed).

## Open items
- None blocking. `capture-queue.json` is a generated file: whoever merges after a queue-doc change should regenerate it.
- Local-evidence mode stays unbuilt (design doc section 7 says how); builtin/reference scripts are captured by hand.
