# Share strips run reads (2026-11-13)

Owner ruling: **the author's Pine never travels with a share.** Engine 53's review (PR #1179) found
two run-read features that put the whole script inside an `ast` document, and two doors that
handed it on:

| Part | Where the script sits | Preview before | Copy before |
|---|---|---|---|
| DIV-4 run-read colours | `compute.runtimeColours.source` | returned | **kept** |
| Engine 53 run half | `compute.runtimeObjects.source` | returned | dropped |

Production exposure was believed to be zero (both mint only for allowlisted scripts; the allowlist
holds only `adx-and-di-for-v4`, no `barcolor`; `PINE_RUNTIME_ALLOWLIST` unset). Fixed before
admission widens.

## The fix

- **One function**, `runtime_definitions.without_run_reads` (replaces `without_run_half`). It
  removes `compute.runtimeObjects`, `compute.runtimeColours`, the paints that read a run-read
  column (and `paints` when none is left), `meta.pineSourceSha256`, the served run stamps
  (`runtimeKilled`/`runtimeNotGraded`) that answered for the removed part, and the disclosures
  that promised the run. A plain document comes back as the same object.
- **One edge.** `user_definitions.resolve_share` calls it. The preview (`GET /shared/{token}`) and
  the copy (`install_share`, which reads only through `resolve_share`) both carry the stripped
  document. `install_share` no longer strips on its own (a guard repeated is a guard unproved).
- **The owner's reads and forks are unchanged.**
- No `SCRIPT_ENGINE_VERSION` bump: nothing engine-minted changes; this strips at the outbound edge.

## A DIV-4 copy draws host colours

Why the paints go too: the schema refuses a paint naming a column nobody declares
(`presentation_schema._check_paints`, `defSchema`), so dropping `runtimeColours` alone would make
the copy invalid. With the paints gone, the copy equals the document the member door writes with
the runtime lane **off**, in every field but one disclosure sentence, measured on the cross-suite
fixture `tests/fixtures/share_strip_div4.json`.

How the client handles the absence: `computeFor` runs `withRuntimeColours` only when
`def.compute.runtimeColours` is present, and `runtimeColourStopOf` returns null without it. The
vitest twin `memberPane/shareStripCopy.test.js` measures it: the copy's columns equal the lane-off
document's; on a fake chart (on and off the listing) the bar colours set and the runtime strip's
notices equal the lane-off document's, and the strip is silent. Control: the author's document off
the listing does say why its colour is missing.

The copy's disclosure for the paint reads: "`barcolor` (line 13) is not drawn: its colour is
worked out by running the author's script bar by bar, and a shared copy does not carry the
script." The run half's drawing sentence (`objectLoss.js::RUN_HALF_DRAWING_SENTENCE`, read from the
JS by the test, never restated) is cut from the drawing note, as the client's own `withoutRunHalf`
does.

## Every outbound path

| Path | Hands out another member's definition? | Covered by |
|---|---|---|
| `GET /shared/{token}` (`resolve_share`, `SharedFormula.jsx`) | yes | the strip |
| `POST /shared/{token}/install` (`install_share`) | yes (a copy) | reads via `resolve_share` |
| `GET /library` (`public_library`) | a closed meta projection, no document | rail: entry keys are a closed set |
| the 14 other routes of `/api/user-definitions` that touch a definition | no (caller's own namespace) | probed with another member's ids |
| `propose`, `converse`, `runtime-kill` | no stored definition | classified `none` |
| `definition_record`, `pine_strategy_backtest`, `screener_backtest` routers | no (`user["id"]` only) | AST rail |
| chart layout shares (`charts_layout_service.resolve_share`) | no definition in a layout | read, not railed |
| note shares, template gallery, notebook widgets | no indicator definition | read, not railed |
| `live_definitions` (sweep, relint) | server-internal, never returned | AST rail: no router calls it |

Rails in `tests/test_share_strips_run_reads.py`: every route of the router is classified (a new
route fails until classified) and every non-`none` route is probed as another member with the
author's ids; an AST walk of `user_definitions.py` asserts the only cross-member reads are
`resolve_share` (which must call the strip) and `public_library`, and that `install_share` reads
only through `resolve_share`; the routers importing the store read only the caller's rows.

## Open, owner call: runtime documents

**DECIDED 2026-11-13: shares carry the source, and say so.** The xfail below is now a normal
rail (`test_a_runtime_document_share_carries_its_script_AND_says_so`): the source is carried AND
the answer carries `includesSource: true`, which the share panel shows the author before a link
is made. See `docs/pine/evidence/2026-11-13-share-privacy/EVIDENCE.md`. The original note:

A **runtime document** (`compute.kind == "runtime"`) IS its Pine: `compute.source` is the whole
script, and WS-H S4 (2026-10-31) deliberately previews and installs it whole. `SharedFormula.jsx`
then renders `compute.source` under "What it computes". It is not a run-read part, and stripping it
would leave nothing to draw, so the only fix is refusing to share a runtime document at all (at
`share`/`publish` and at `resolve_share` for links already minted). That removes a shipped feature,
so it is left to the owner. Recorded as a strict xfail
(`test_OPEN_a_runtime_document_share_still_carries_its_script`), which turns red when it is fixed.
Same exposure gate as above (runtime saves need `PINE_RUNTIME_SAVE_ENABLED` and the allowlist).

## Results

Focused, local (Windows, Python 3.14, vitest 4.0.18 `--maxWorkers=1`):

- `tests/test_share_strips_run_reads.py`: 24 passed, 1 xfailed (the open runtime-document case).
- `tests/test_run_half_source_binding.py`: 12 passed.
- vitest `shareStripCopy.test.js` + `div4RuntimeReadPaint.test.js` + `runHalf.test.jsx`: 80 passed.
- The user-definitions-related pytest set, run file by file (68 files): all green except 14 reds,
  each also red with `origin/master`'s two service files in place (identical list): definition_concierge
  x5, starter_library x5, user_definitions_auth x1, breadth_library_serve x1, shared_state_landmines
  x1, shared_data_root_guard x1. None names a file this change touches.

Mutation proof (copy, edit, run, restore from the saved copy, `git hash-object` == the committed
blob every time; C0 unmutated control green):

| Mutant | Red |
|---|---|
| M1 `resolve_share` does not strip | 8 (preview x2, install x2, route probe x2, store AST rail, run-half copy test) |
| M2 strip drops only the run half | 6 (all DIV-4 doors, C0 detector, served stamps) |
| M3 run-read paints kept | 2 (lane-off equality, installed copy schema check) |
| M4 run-read paint note not rewritten | 1 (lane-off equality) |
| M5 run-half sentence kept | 1 (run-half copy) |
| M6 `pineSourceSha256` kept | 6 (run-half doors, C0 detector) |
| M7 identity broken (always a copy) | 4 (identity, every case with a dict) |
| M8 served run stamps kept | 1 |
| M9 a new cross-member read in the store | 1 (store AST rail) |
| M10 a new route on the router | 1 (route classification rail) |
| V1 fixture copy keeps `runtimeColours` + paint | 3 vitest |
| V2 fixture copy keeps the run-promising note | 1 vitest |
| V3 fixture copy keeps the paint only | 2 vitest |
