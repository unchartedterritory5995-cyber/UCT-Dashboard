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

**`engine/__tests__/libraryLinkParity.test.js` + `tests/test_library_link_parity.py`**
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
- ⛔ **Promotion note:** the host lane serves a linked import WITHOUT runtime admission. Promoting a store that holds those versions makes the four DIVERGE scripts draw where they now refuse. The promotion is the coordinator's call after this merges.

## Engine number
Changes door outcomes, so it takes the next free engine number at push (number-last).
