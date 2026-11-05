VERDICT: GO-WITH-NOTES @558c7a5c25

Lane: E evidence-engine lows (fix/pine-evidence-engine-lows). Reviewed merge-base 52f76f9b4f..558c7a5c25 (2 commits: code e58edcbeaf, EVIDENCE-only 558c7a5c25). Spec: origin/docs/pine-language-coverage (397ecee294) `docs/pine/EVIDENCE-ENGINE-DESIGN.md` - the tip's design doc is byte-identical to the spec branch's.

## Scope / member safety
Files: `tools/vendor_harness/evidence_engine.py`, `evidence_engine_mutations.py`, `tests/test_evidence_engine.py`, `docs/pine/EVIDENCE-ENGINE-DESIGN.md`, `docs/pine/vendor-harness/capture-queue.json`, EVIDENCE.md = exactly the files EVIDENCE.md lists. Nothing under `app/` or `api/`; offline tooling only; no flag, env var or secret. Engine bump: NO.

## The five lows vs the code
1. Manifest stem: `gate_capture(..., manifest_entry)` (evidence_engine.py ~944-961) holds the id to the run manifest's `captureStem` only if it matches `STEM_RX` AND the entry's `sha256` equals the capture's source sha; else falls back to `capture_stem` of the world's source. `build_packet` (~1012) passes the entry by file stem. Manifest entries do carry `sha256` (~895). No-overwrite and licence gates unchanged. Correct.
2. Section chart over preamble: rail-only (master already right); 4 mutations on the selection/listing logic are killed. OK.
3. Prose cells: `PROSE_HEAD_RX` on the cleaned lowercased header (~552, ~597-602); prose cells go through `resolve_sources(refs_only=True)` -> fixture refs only, never sources/owed. Rail `test_a_probe_named_in_a_prose_cell_is_a_reference_never_a_request` asserts sources, needsProbe and fixtureRefs per row. OK.
4. Headings: `FINISHED_HEAD_RX` (~86) case-insensitive, optional number/letter prefix, `(?!-)` excludes `Built-in`; emphasis stripped before match. A misread heading drops a table only into counted `contextTables`, not silently.
5. Doc promises: `--local-evidence` removed from parser and `batch`; doc sections 2.4/3/5/7 rewritten; `LICENCE_HOLD` kept as a guard state (evidence_engine.py:787). Rail `test_there_is_no_local_evidence_mode_and_the_design_doc_says_so` asserts argparse rejects the flag, doc text, and no real-queue target is LICENCE_HOLD.

## Proof
Spot-checked rails low 1/1b (tests:654-685) - each has a negative half proving teeth (without the manifest stem the same capture is REFUSED; a manifest entry for another sha is ignored). Mutations 71/71 killed, 19 new, 2 re-pointed with named rails; red-on-master 5 failed/36 passed with low-2 explained. final-tip at baseline (pollingSites.rail only). Claims match the diff.

## Notes (non-blocking)
1. `capture-queue.json` is generated and has no freshness rail. Merge order with W2 r3: W2 adds `docs/pine/capture-queue-2026-11-02-w2.md`; whichever of E / W2 merges second must regenerate `capture-queue.json`.
2. `PROSE_HEAD_RX` includes `served`, `evidence`, `reading`, `where`: a future queue doc that puts a real request in a column so headed would be read as a reference (fails safe: no target, not a wrong target). Worth a line in the design doc's header list if new columns appear.
3. Merge hazards: `git merge-tree` vs origin/master 7f570a02ad CLEAN; master delta since 52f76f9b4f touches none of the lane's files, queue docs, fixtures or corpus. Landing: merge origin/master, short landing checks (deploy-gate pytest, hygiene, tests/test_evidence_engine.py).
