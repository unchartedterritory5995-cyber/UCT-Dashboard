# U15 Phase A — Pine libraries pinned by sha256 (2026-11-15)

Coordinator rulings (2026-11-15, U15):
- A library version is served only with the sha256 of its own source.
- A document is held to the library versions it was saved against.
- Runtime-pane admission is **per library version**:
  - one row `library:Author/Library/N`, pinned by `sha256`;
  - at least 2 distinct importing scripts graded MATCH with the runtime pane on, at least 1 of them community;
  - a fixture or probe library never counts.
- Fetching stays owner-run (`tools/pine_library/fetch_library.py`); nothing fetches at member request.
- Phase B (a v5 library inside a v6 script, library types and methods) is a separate PR.

No library source is in this repository. Every library in the rails is a fixture written from
scratch for that rail.

## What changed

| Where | Change |
|---|---|
| `api/services/pine_library_store.py` | `sha256` is a required field, and must be the source's own (64 lowercase hex). `entry_status` tells held-unservable apart from missing. `pinned_entries(pins)` returns the entries a document's pins name, or `(guard, sentence)`: `pine:library-changed`, `pine:library-no-sha` or `runtime:library`. |
| `api/routers/pine_libraries.py` | A held but unservable entry answers **409** `{code: library:no-sha, reason}`. Missing is still 404. |
| `ast/pineLibraryStore.js` | `registerPineLibrary` keeps `sha256` and refuses an entry whose sha is not its source's. It remembers the path as unservable, by name; `ensurePineLibraries` records a 409 the same way. `libraryEntryProblem` is the one rule, cached per entry. |
| `ast/pineLibraries.js` | The linker refuses a no-sha entry (`pine:library-no-sha`) and a pin mismatch (`pine:library-changed`, from `opts.libraryPins`). The linked record carries `sha256`. |
| `pine.js`, `pineRuntimeFrontend.js` | Both lanes refuse the import line under the named code. `t.libraries` / `built.libraries` carry `sha256`. |
| `memberPaneDefinition.js` | Host and runtime documents are stamped `meta.libraries = [{path, sha256}]`, only when the script imports something. |
| `runtimeColumns.js`, `nativeRegistry.js` | Every run that links the source again is held to the document's pins: a runtime document, the run half, and a runtime colour. |
| `serverEntry.js` + `services/pine_runtime/{protocol,pool,sandbox,job}.mjs` | The web server sends the pinned entries with the request (`definition.libraries`). The protocol recomputes each sha256 and treats a mismatch as integrity. The job registers exactly the pinned entries for that one run, then clears them. A pin the request does not meet refuses the run by name. The bundle's run call is unchanged, so the HP-7 adapter rail is unchanged. |
| `api/services/pine_runtime_client.py` | Reads the pinned entries from this server's store. A pin it cannot honour withholds every job by name and sends nothing. |
| `api/services/pine_capabilities.py` | One capability per imported version (`library:Author/Library/N`). `DETECTOR_VERSION` 1 → 2, with its fingerprint recorded. |
| `api/services/rollout_gate.py`, `runtime_definitions.py` | The library row rule (above). `import` is met only when every imported version is admitted. A library row is recognised as an open family beside the closed vocabulary. |
| Licence gate (ruling 2026-11-15) | A **non-commercial** licence is never served on this paid product: `NC` as a token in the licence id, or the `nonCommercial` flag `fetch_library.py` now records. ONE rule per language: `pine_library_store.licence_problem` and `pineLibraryStore.libraryLicenceProblem`, both held to `tests/fixtures/ast/library_licence_cases.json`. The store keeps such an entry and answers it **409** `{code: library:licence, reason}`. Both lanes refuse the import line as `pine:library-licence`, naming the licence. `pinned_entries` refuses the server run under the same guard. |
| Deny list (ruling 2026-11-15) | `app/src/components/chart/engine/ast/pineLibraryDeny.json` is ONE file read by the browser bundle, the server bundle and the Python store. It denies `Fontiramisu/fontilab/11` (ATR Trend Bands DIVERGE), `loxx/loxxexpandedsourcetypes/4` (Black-Scholes DIVERGE) and `TradingView/ValueAtTime/2` (Performance DIVERGE). A denied version is never served, whatever a store holds: 409 `library:denied`, and both lanes refuse the import line as `pine:library-denied`: "this library version is withheld until its drawing is verified against TradingView". If the list cannot be read, every version is denied (fail closed). Deliberately NOT denied: `TradingView/ta/11` (three scripts MATCH; Aroon's DIVERGE is the engine's tie bug) and `PineCoders/VisibleChart/3` (INCONCLUSIVE is not wrong). An entry is removed only by a re-grade to MATCH. This closes the risk that production already serves those versions, the moment Phase A deploys. |
| `tools/pine_library/promotion_allowlist.json` | The ONLY versions that may be copied into the production store, each pinned by the sha256 graded, with its reason. The held-out versions and the never-promoted NC versions are listed too. |
| `api/data/pine_runtime_allowlist.json` | The rule is documented. **No library row is admitted** (no evidence has been graded against the store yet). |

## Rails

**`app/src/components/chart/engine/ast/pineLibraryPinning.test.js`**
- No sha, a wrong sha, or a malformed sha: refused in both lanes (`pine:library-no-sha`).
- A 409 from the store: refused with the store's reason.
- A missing library keeps `pine:module` (control).
- The pin rides the translation in both lanes.
- A pin mismatch is `pine:library-changed` in both lanes; the pin's own code links.
- The door stamps the pins; a script with no import carries none.
- A runtime document draws against its pinned code and is refused once the registry holds other code.

**`engine/__tests__/libraryLinkParity.test.js` + `tests/test_pine_library_link_parity.py`**
- The JS lane writes `tests/fixtures/ast/library_link_parity.json` (fixture library, RDDT 1D bars from a committed capture).
- The Python lane (`ast_interpret`, the alert and scan evaluator) reproduces the chart's columns for the imported document and for the same functions pasted in.
- The trees name no library.
- That is the **splice check**: the server lanes never need a store, because the code is in the saved trees.

**`tests/test_pine_library_pinning.py`**
- Store: no sha is not served; 409 vs 404.
- Pinned entries: changed, missing and no-sha.
- The server client withholds and sends nothing on a changed library; it sends the pinned entries otherwise.
- The detector names each version.
- The admission rule: needs the sha pin; other code, another version, a fixture, or no `library` field never counts; one script, or probes only, is not enough.
- `import` is met only by its libraries.

**`services/pine_runtime/test/library.test.mjs`**
- The protocol validates `definition.libraries` and recomputes each sha.
- The job registers only the pinned entries, refuses an unmet pin by name, never reaches the bundle when refused, and clears the registry before and after.

**Existing library rails** now stamp their fixture libraries through `ast/__tests__/libraryFixture.js`, so they go through the same sha rule a member's chart does.

## Mutants (each restored from a saved copy, byte-equal)
See the PR body for the run. J1–J5 (JS), P1–P4 (Python), S1–S2 (service):
- J1 pin ignored · J2 linker skips the sha · J3 registry skips the sha · J4 door stamps no pins · J5 run ignores pins
- P1 store sha optional · P2 pins not compared · P3 evidence counted on any sha · P4 `import` met alone
- S1 job skips the pin · S2 protocol skips the sha

## P0 — the local library store, measured (owner-approved local fetch)
- **Fetch:** `fetch_library.py --recursive` over the 72 import paths of the 65 sample scripts. 83 entries stored, with nested imports, into a scratch `PINE_LIBRARY_DIR` outside the repository. 1 failed: `algotraderdev/contrast/1` (the search does not surface it; it needs `--pub-id`).
- **Licences, from each library's own header:**
  - 66 MPL-2.0 (header), 6 MPL-2.0 (TradingView default, no header);
  - **10 CC-BY-NC-SA (Trendoscope)**: a non-commercial licence, flagged for an owner ruling before any of them is served.
  - Every `TradingView/ta` version (7, 8, 9, 10, 11, 12, 14) carries an MPL-2.0 header.
- **Member door, objects pane plus runtime pane ON, 65 importing scripts:**
  - 10 attach only with the store (8 host lane, 2 runtime lane).
  - 55 still refuse. `pine:module` 16 (15 are a v5 library in a v6 script, Phase B; 1 is the missing `contrast`), `pine:no-output` 8, `pine:tuple` 6, `pine:block` 5, `pine:state` 4, `pine:type` 3, and a tail of others.
- **The captures of the 10 newly attaching scripts:**
  - MATCH: all-chart-patterns (RDDT, SPY), Chandelier exit, Pring's special K (SPY), Rolling VWAP (RDDT, SPY), Ulcer index. **Firm unlock: 5 scripts.**
  - DIVERGE:
    - Aroon oscillator (bar 116, a tie in `highestbars`; engine 56 values-v2 fixes it);
    - ATR Trend Bands (bar 0 colour);
    - Black-Scholes (4 captures, objects);
    - Performance (2 captures).
  - INCONCLUSIVE: Volume Profile Heatmap.
- **Promotion allowlist** (`tools/pine_library/promotion_allowlist.json`, ruling 2026-11-15). A version is promoted only when every newly-attaching importing script grades MATCH, and NC is excluded:
  - promote: the four theEccentricTrader libraries behind All Chart Patterns, and PineCoders/ConditionalAverages/2 behind Rolling VWAP (⚰️ ConditionalAverages/2 left `promote` after the host-only re-grade: see the next section);
  - held out: TradingView/ta/11 (with its dependency RelativeValue/3), because Aroon oscillator DIVERGEs on it; it joins once values-v2 merges and Aroon re-grades MATCH. Also held out: fontilab/11, loxxexpandedsourcetypes/4, ValueAtTime/2 and VisibleChart/3;
  - never promoted: the ten Trendoscope CC-BY-NC-SA versions.
- ⛔ **Promotion note:** the host lane serves a linked import WITHOUT runtime admission. Promoting a store that holds those versions makes the four DIVERGE scripts draw where they now refuse. The promotion is the coordinator's call after this merges.

## Host-only re-grade (2026-11-15, after merging origin/master `771264afff`, engine 57)
The runtime pane is off for members, so the picture a promoted library would draw is the host lane's.
The probe is `f4Sweep.measure.test.js` narrowed to the importing scripts (`F4_SWEEP_ONLY`, with the
out-of-git capture folders in `F4_SWEEP_DIRS` and the scratch store in `PINE_LIBRARY_STORE`). Its `on`
state is the objects pane on with `VITE_PINE_RUNTIME_PANE_ENABLED` unset; its `runtime` state is the same
capture with the pane on.

| Importing script (captures) | Libraries | Host-only | Runtime pane on |
|---|---|---|---|
| All Chart Patterns (RDDT 1D, SPY 1D) | theEccentricTrader PubLibSwing/3, PubLibPattern/4, PubLibCandleTrend/2, PubLibTrend/3 | MATCH, MATCH | MATCH, MATCH |
| Rolling VWAP (RDDT 1D, SPY 1D) | PineCoders/ConditionalAverages/2 | INCONCLUSIVE, INCONCLUSIVE: the door refuses the script (`pine:block`, a `while` reached through the library), so nothing is drawn | MATCH, MATCH |
| Chandelier exit (RDDT), Pring's special K (SPY), Ulcer index (RDDT) | TradingView/ta/11 (+ RelativeValue/3) | MATCH, MATCH, MATCH | MATCH, MATCH, MATCH |
| Aroon oscillator (RDDT) | TradingView/ta/11 | DIVERGE | DIVERGE |
| Volume Profile Heatmap (RDDT) | PineCoders/VisibleChart/3 | INCONCLUSIVE | INCONCLUSIVE |
| ATR Trend Bands (RDDT) | Fontiramisu/fontilab/11 (denied) | refused, `pine:library-denied` | refused, `pine:library-denied` |
| Black-Scholes (RDDT, AAPL, JPM, SPY) | loxx/loxxexpandedsourcetypes/4 (denied) | refused, `pine:library-denied` | refused, `pine:library-denied` |
| Performance (RDDT, SPY) | TradingView/ValueAtTime/2 (denied) | refused, `pine:library-denied` | refused, `pine:library-denied` |

What it changed in `tools/pine_library/promotion_allowlist.json`:
- **`promote` is now the four theEccentricTrader versions only.** Each row carries `hostOnly` and `runtimeOn` per capture.
- **PineCoders/ConditionalAverages/2 moved to `heldOut`.** It was listed on the pane-on grade alone. In the lane members are served its importing script draws nothing, which is not a MATCH.
- **TradingView/ta/11 stays held out.** Aroon oscillator still DIVERGEs on engine 57, pane off and on. (The note above expected engine 56 to fix it. It did not re-grade MATCH.)
- The three denied versions are refused by name in both states, on real captures of real importing scripts.

`tests/test_pine_library_pinning.py` now holds the file to its rule: every promoted row has a sha256, a licence the store serves, is not on the deny list, and is MATCH host-only on every capture.

## The three security properties, each with a rail a mutant turns red (2026-11-15)
**No library source is in the repository** (`tests/test_pine_library_pinning.py`):
- Every tracked or addable file holding a Pine library declaration (the word, an opening bracket and a quoted title, at the start of a line) must be a named fixture file (two tables, each row with its reason). A new one is red until it is named.
- No library source in those files is longer than 40 lines (a fixture is a handful; a real library runs to hundreds).
- No `pine_libraries/` store folder is tracked or addable.
- The scan is shown to see a declaration written seven ways (plain, indented, single-quoted, inside a Python string, a JSON string, a JS template, a store entry) and to ignore three look-alikes.
- One-off check, not a rail: the longest code lines of all 83 fetched sources (759 lines) were searched for in every tracked file. No file changed by this PR holds one. 19 files already on master do: 7 community scripts in `corpus/committed/` and 12 captures of them, where an author's own script shares a line with that author's library. None of them holds a library declaration.

**The deny list fails closed**, in both languages:
- Before this pass the JavaScript side did not: a deny document with no `deny` array, or with a row that named no path, denied nothing (the bad row was dropped). `denyTableOf` now returns null for any document that cannot be read as a list, and null denies every version.
- The Python store treated a row with no path the same way (dropped it). It now treats the whole list as unreadable.
- Rails: 8 unreadable shapes in Python, 11 in JavaScript, each denying everything; a control that a readable list denies only what it names and an empty list denies nothing.

**A non-commercial licence is never served:** unchanged rules (`licence_problem`, `libraryLicenceProblem`, one shared table of cases), re-proved by mutants on this head.

Mutants on this head, each restored from a saved copy and checked byte-equal:

| Mutant | Rail that went red |
|---|---|
| P-D1 an unreadable deny list fails open (Python) | `test_an_unreadable_deny_list_denies_every_version` |
| P-D2 a deny row with no path is dropped (Python) | `test_a_deny_list_that_cannot_be_read_as_one_denies_every_version[row-without-path]` |
| P-D3 the deny list is not consulted (Python) | `test_a_denied_version_is_never_served_whatever_the_store_holds` |
| P-L1 the licence rule answers nothing (Python) | `test_the_licence_rule_is_the_tables[CC-BY-NC-SA]` |
| P-L2 the `nonCommercial` flag is ignored (Python) | `test_the_licence_rule_is_the_tables[MPL-2.0+flag]` |
| S-1 a new file holds a library declaration | `test_no_file_holds_a_library_declaration_that_is_not_a_named_fixture` |
| S-2 an 81-line library pasted into a named fixture file | `test_every_library_fixture_is_fixture_sized` |
| S-3 a `pine_libraries/` folder appears | `test_no_library_store_is_in_the_repository` |
| A-1 a library INCONCLUSIVE host-only is promoted | `test_every_promoted_library_is_pinned_licensed_undenied_and_match_host_only` |
| J-D1 to J-D4, J-L1 (JavaScript deny and licence) | `pineLibraryPinning.test.js` (each one named in the status section below) |

## Engine number: NUMBER PENDING (the coordinator assigns it at merge)
This PR takes no number: no `scriptEngineVersion.js` change, no host-parity `--write`, no service smoke re-record.
- **A script that imports nothing is served exactly as before.** Host parity `--check` on this head: 164 of 166 cases equal the committed digests (the 2 others are the known Node-version report, not gated), with no digest re-recorded. pine-heavy grades both harness lanes on the committed captures.
- **A script that imports a library can be served differently**, wherever a store holds that version: the three denied versions and any non-commercial version stop being served, and a version held without a sha256 stops being served. `docs/pine/capture-queue-2026-10-02-l2-libraries.md` speaks of "the 50 production libraries", and `docs/pine/COVERAGE-MAP.md` says the production registry is empty. This pass did not read the production store, so it cannot say which is true today.
- So the change needs a number unless the production store is confirmed empty. If it is empty, no existing document changes and no number is needed.

## Status 2026-11-15 (resumed after the park; local runs, before the push)
The resume note that stood here is done, with three changes from what it asked: master was MERGED (a merge commit, nothing rebased or squashed), no engine number was taken (see above), and the "known pre-existing" detector-worker failure it named is fixed on master (#1377) and did not appear.

**Merge of origin/master `771264afff`.** Two conflicts:
- `api/data/pine_runtime_allowlist.json` `_readme`: both paragraphs kept (U15 libraries, then U3b and S28). No capability row conflicted: this PR adds none.
- `memberPaneDefinition.js`, one import line: `libraryPinsOf` and `requestTargetsUnservable` both kept.
- `evidence_engine.py queue` rewrote the queue with no change in content; `queue --check` PASS; `pins --check` PASS.

**The `watch-list` check.** `api/services/pine_library_store.py` reads `app/src/components/chart/engine/ast/pineLibraryDeny.json` while `web` serves. The file is now declared in `tools/web_frontend_reads.py` (`DECLARED_READS`) and named in `railway.web.json` `watchPatterns`, so a change to the deny list redeploys `web`. `tests/test_web_frontend_reads.py`: 18 passed.

**Gate, `pine-runtime` job, on Node 20.20.2 (the image's major):**
- the server bundle builds and imports;
- step 5, `node --test services/pine_runtime/test/*.test.mjs`: **147 tests, 147 pass, 0 fail**;
- host parity `--host node --check`: HP-1 GREEN, 164/166 (2 REPORTED, not gated); `--mutation-control`: HP-4 GREEN (red on 35 cases);
- closure `--check`: host-neutral, 107/107 watched;
- section 8 pytest, one file at a time: client 131, codec 211, composition 39, deploy_gate 27, dockerfile 15, engine_identity 6, result_integrity 6, run_telemetry 47, service_smoke 23, shared_stamp 4, stop_telemetry 30, switch_on 65. All passed.

**Focused rails:**
- vitest, 7 files, **69 passed**: `pineLibraryPinning` 16, `pineLibraries` 20, `libraryLinkParity` 2, `usePineLibraries` 2, `runtimeLibraryDoor` 3, `libraryImportRefusal` 7, `memberPaneDefinition` 19.
- pytest: `test_pine_library_pinning.py` 46, `test_pine_library_link_parity.py` 3, `test_pine_library_store.py` 8, `test_pine_capability_admission.py` 134, `test_pine_allowlist_measured_verdicts.py` 5, `test_pine_capabilities.py` 68, `test_pine_capability_detector_worker.py` 47. All passed.
- `tests/test_library_link_parity.py` was renamed `tests/test_pine_library_link_parity.py`: under its old name no pull-request job ran it (pine-heavy's Python leg globs `tests/test_pine_*.py`).

**JavaScript mutants** (`pineLibraryPinning.test.js`, 16 passed before and after; each file restored byte-equal):
- J-D1 an unreadable deny document read as an empty list: red (the fail-closed rail);
- J-D2 a deny row with no path dropped: red (the fail-closed rail);
- J-D3 a null table denies nothing: red (the fail-closed rail);
- J-D4 the deny list not consulted: red (2 tests);
- J-L1 the licence rule answers nothing: red (2 tests).

**Not done here, by instruction:** nothing was enabled for members and nothing was promoted to any store. The pull-request checks (pine-heavy, watch-list) ran after the push: their results are in the PR body.

## flow-worker watch coverage: classification (required by `docs/runbooks/deploy-windows.md`)
`python tools/flow_worker_watch_coverage.py` against origin/master is red on six files: `api/routers/pine_libraries.py`, `api/services/pine_capabilities.py`, `api/services/pine_library_store.py`, `api/services/pine_runtime_client.py`, `api/services/rollout_gate.py`, `api/services/runtime_definitions.py`.

**flow-worker stranded: NOT EXERCISED, safe. No marker bump.**
- flow-worker reaches all six by import only, nine to eleven hops from `api/flow_worker_main.py` through `api/auth_surface_check.py` (traced file by file, shortest chain each).
- What changed in them is the library store's read rules, the per-library admission rule and the pinned entries the runtime client sends. Those run behind `/api/pine/libraries` and `/api/user-definitions/*` and in `web`'s runtime-job client. `api/flow_worker_main.py` mounts none of those routes, and no line of its code calls a Pine or user-definition function (its header comments name `alert_user_series` and `user_definitions` only as past deploy triggers). This is a reading of that file, not a run of flow-worker.
- So flow-worker on the older copies behaves the same as on the new ones. If some path in it did run a user-formula alert through the older runtime client, a document that imports a library would be withheld by name (the runtime service refuses a pin the request does not meet), never drawn wrong. Its deploys have been manual since 2026-11-12, so a marker bump would restart nothing; the next manual deploy picks these files up.

## Landing train 2 (engine 60, 2026-11-16)

This PR lands as the third input of landing train 2 (`land/pine-engine-train-2`), under engine number 60. The
"NUMBER PENDING" section above is answered: the number is 60, taken with host parity `--write` and the service
smoke re-record in the train's number step.

- **Merge onto master 8cdb0af178 (engine 59).** Two conflicts: `memberPaneDefinition.js` (master's one stamp
  writer `pineTreeStamps` and `calcBarsMeta` kept, `meta.libraries` added beside them on the host document and on
  the runtime document) and `symbolRosterSpeaks.test.js` (47 + the four library names = 51). Everything else
  merged without a conflict and its rail is green on the merged tree.
- **The three security properties, mutant-proved again on the merged tree**, each file restored byte-equal:
  the deny list fails closed and is consulted (JavaScript UJ-D1 to UJ-D4, Python UP-D1 to UP-D3), a
  non-commercial licence is never served (UJ-L1, UP-L1, UP-L2), a denied version cannot be listed for promotion
  (UA-2): 11 killed through `ci/mutants/landing-train-2.json`. No library source in the repository (S-1 a new
  file with a declaration, S-2 an 81-line library in a named fixture, S-3 a `pine_libraries/` folder) and A-1
  (an INCONCLUSIVE host-only library promoted): 4 killed by hand, since a manifest holding a library declaration
  is itself a file the scan refuses. `tests/test_pine_library_pinning.py` 46 passed after the restores.
- Nothing was promoted to any store and nothing is enabled for members. The production library store was still
  not read.
