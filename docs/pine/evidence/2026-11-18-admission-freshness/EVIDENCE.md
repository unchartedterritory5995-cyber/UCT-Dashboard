# Capability admission: evidence must be graded at today's engine (2026-11-18)

## The gap

The A8 rail (`tests/test_pine_capability_admission.py`, `_phantoms`) checked that every evidence id of an admitted
capability row EXISTS in `docs/pine/vendor-harness/runtime-on/verdicts.json` and grades MATCH. It never checked
WHICH engine graded it. Both snapshots were last regenerated at engine 78 (`f9a976fb47`, 2026-11-18 13:13) while
master shipped engine 80, so a row added on master could have been admitted on evidence graded two engines ago.
Ledger evidence already counted only at today's engine (`rollout_gate._pine_ledger_entry_fresh`); committed-snapshot
evidence had no such rule. No row was in violation on 2026-11-18: the allowlist had not changed since the regrade.

## The change

1. **Each snapshot names its engine.** The corpus writer (`vendorHarness.corpus.test.js`) imports
   `SCRIPT_ENGINE_VERSION` from `scriptEngineVersion.js` and writes `"scriptEngineVersion"` into `verdicts.json`
   (and a line in `summary.md`). No commit SHA: a file cannot name the commit that contains it, and a SHA would break
   the byte-identical before/after comparison every regeneration is judged by. `git log -1 -- <snapshot>` names the
   commit, and the rail's message says so.
2. **Seed (coordinator ruling C2):** both committed snapshots carry `"scriptEngineVersion": 78`, inserted by hand as
   text at the position the writer now emits; every other byte unchanged (verified: the parsed documents are equal
   apart from the key). The next train regenerates both at its own engine.
3. **Each admitted row carries a stamp** `"admission": {"scriptEngineVersion": N, "rowSha256": <digest>}`, written by
   `tools/pine_coverage/stamp_admission.py` as a one-line TEXT edit (the allowlist is hand-formatted and is never
   round-tripped through a serialiser). The digest covers `admitted, status, scope, sha256, evidence` (not `note`).
   The tool REFUSES unless the runtime-on snapshot is at today's engine, so a new or changed row needs fresh evidence.
   All 30 existing rows were stamped at 78 with `--seed` (they pass A8 against the engine-78 snapshot today).
4. **The rail (A10)** holds every admitted row to its stamp: the digest must match (a NEW row with a copied stamp, or
   evidence edited after stamping, does not), and the stamp's engine may not be newer than the snapshot's or today's.
   An engine bump invalidates no existing row (coordinator ruling). Why not merge-base: `pine-gate-rails-pr.yml`
   checks out `refs/pull/N/merge` at depth 1, so a git-history rail would need a CI change or would have to skip.
   Why not a bare `admittedAtEngine`: copying the neighbouring row's number, the likeliest accident, passes it.

`rollout_gate.py` is unchanged: nothing a member sees changes.

## Regenerating the snapshots (what a train does after an engine bump)

From `app/`, under the heavy lock, both lanes:

    VENDOR_HARNESS_RUNTIME_ON=0 VENDOR_HARNESS_OUT=../docs/pine/vendor-harness/production npx vitest run src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js
    VENDOR_HARNESS_RUNTIME_ON=1 VENDOR_HARNESS_OUT=../docs/pine/vendor-harness/runtime-on npx vitest run src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js

then `python tools/pine_coverage/stamp_admission.py <capability>` for each row the change adds or alters.
`python tools/pine_coverage/stamp_admission.py --check` prints every row's stamp and whether it still matches.

## Rails and their mutation proof

`tests/test_pine_capability_admission.py` A10: C1 both snapshots carry an engine <= today's, and the tool and the
server read the same engine number; C2 every admitted row matches its stamp; C3 a snapshot without an engine, or
newer than today's, is red; C4 an engine bump invalidates no row; C5 the tool refuses a stale snapshot and writes
nothing, and stamps against a fresh one; C6 a new row with a copied stamp is red, a properly stamped one is not, a
stamp newer than the snapshot is red, an unstamped row is red; C7 the writer imports the engine from its one
authority and writes it; plus: the digest covers the evidence and not the note.

Each mutant was applied exactly once, run with `pytest -k A10`, then restored from saved bytes (sha256 checked; never
`git checkout`). All seven KILLED:

| mutant | what it breaks | red |
|---|---|---|
| C-M1 | the digest covers only `admitted, status` | C6, digest test |
| C-M2 | the rail stops comparing the digest | C6 |
| C-M3 | the rail stops comparing the stamp with the snapshot's engine | C6 |
| C-M4 | the tool stops refusing a stale snapshot | C5 |
| C-M5 | the writer stops writing `scriptEngineVersion` | C7 |
| C-M6 | an engine bump would invalidate existing rows (`at != current`) | C4 (and C2) |
| C-M7 | the runtime-on snapshot loses its engine | C1 (and C2-C6) |
