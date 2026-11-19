# The library store fails closed (2026-11-17)

Branch `fix/pine-library-store-fail-closed`, base `origin/master` `66dd41b3e8` (engine 66). NUMBER PENDING
(see the end).

## The finding

Measured on production 2026-11-17 ~02:58Z by `tools/pine_library/promotion_check.py check` on the web pod
(store `/data/pine_libraries`), after the owner-approved promotion:
- 6 allowlisted versions PROMOTED: TradingView/ta/11, TradingView/RelativeValue/3,
  theEccentricTrader/PubLib{Swing/3, Pattern/4, CandleTrend/2, Trend/3}.
- 45 other versions: 42 `not on the allowlist, store status ok`; `Fontiramisu/fontilab/11` and
  `loxx/loxxexpandedsourcetypes/4` held out, `store status denied`; `PineCoders/ConditionalAverages/2`
  held out, `store status ok`.

`ok` meant served: `GET /api/pine/libraries/<path>` answered 200 with the source, and the member door linked it.

## 1. Provenance: how the 42 got there, and under what rule

- **L1 (`a30aa584c0`, 2026-10-02)** added the store and the fetch tool. Its usage line is
  `fetch_library.py --from-corpus corpus/committed --recursive`, and it writes into `store_root()`, which on
  the pod is `$DATA_DIR/pine_libraries`. Every entry it writes carries the sha256 of its source
  (`fetch_library.py` at that commit, line 167).
- **L2 (`f5bf0a7da5`, 2026-10-02)** recorded the result: *"Production's library store holds all 50 libraries
  the corpus imports"* (`docs/pine/vendor-harness/objects-triage-2026-09-28.md:6174`;
  `docs/pine/capture-queue-2026-10-02-l2-libraries.md:6`, *"the 50 production libraries"*). Two documents
  contradict it: the same table's column header *"empty registry (production today)"* (`:6181`) and
  `docs/pine/COVERAGE-MAP.md:384`, *"the production registry is empty"*. U15 noted the contradiction
  (`docs/pine/evidence/2026-11-15-u15-library-pinning/EVIDENCE.md:155`) and never read the store.
- **The set matches.** The committed corpus imports 42 distinct paths directly (34 importing scripts), and
  their nested imports bring the closure to about 50. Every example production printed (ta/7, 9, 10, 12, 14,
  ZigZag/7, RelativeValue/2, TFlab/\*, jdehorty/\*, reees/\*, kaigouthro/\*, boitoki/\*, loxx/loxxmas/1) is in
  that closure. Three things production does NOT hold are in the U15 sample's closure and not the corpus's:
  ValueAtTime/2, VisibleChart/3 and Trendoscope/\*. So the store came from an L1 corpus fetch, not from U15
  Phase A's P0 fetch (that went to a scratch store, U15 `EVIDENCE.md:74`). It did not come from the
  promotion run either: `install` copies only `promote` rows, through staging (`promotion_check.py`
  `install`).
- **Grading rule then: none.** L1/L2 predate U15 (2026-11-15) by six weeks. L1's store served any entry that
  had a licence, a `library()` declaration and a sha256 matching its source if one was present. No promotion
  or grade existed.
- **Why `ok` today.** The L1 fetch recorded each entry's sha256. The licences are MPL-2.0, and none of these
  versions is on the deny list. So U15's `validate_entry` passes and `entry_status` answers `ok`
  (`api/services/pine_library_store.py:131-180` before this change).
- **Committed record that grades them: none.** None of the 42 appears in `promotion_allowlist.json`
  (`promote` / `heldOut` / `neverPromoted`). The only record is a negative one: on engine 61, *"every other
  version the sample imports has no importer that attaches host-only ... no MATCH witness and no promotion"*
  (`docs/pine/evidence/2026-11-16-u15b-libraries/EVIDENCE.md:105`).

## 2. Reach: what a member got for a version served `ok` (master `66dd41b3e8`)

| lane | before this change |
|---|---|
| member door, host lane (members' lane, runtime pane off) | `usePineLibraries` → `ensurePineLibraries` (`pineLibraryStore.js:160-193`) → 200 → `registerPineLibrary` → `linkLibraries` (`pineLibraries.js:311-376`). It checks the deny list, licence, sha, pin, version, and cross-version admission (v5 library in a v6 script only). A same-version import is LINKED, with **no grade gate**: *"the host lane serves a linked import WITHOUT runtime admission"* (U15 `EVIDENCE.md:94`). Drawn whenever the rest of the script passes the door. Measured on engine 61: no importer of these versions in the sample attached host-only (U15b `EVIDENCE.md:105`). So no known script drew through them, and nothing in the code would have stopped one as coverage grew. |
| runtime pane | Dark for members. Capability admission needs a `library:A/L/N` row per version (`pine_capabilities.py:399-416`, `runtime_definitions.py:1129-1134`), and no library row is admitted (`api/data/pine_runtime_allowlist.json`). Refused. |
| server runtime jobs | `pine_runtime_client.py:476-482` → `pinned_entries` → `entry_status` `ok` → the entries were sent. In practice they are gated upstream by runtime admission. |
| alerts / scans / backtests (host definitions) | They run the SAVED tree, which already holds the spliced library code. **They never ask the store or the deny list**: the only server reader of the store is `pine_runtime_client`. A definition saved while a version linked keeps evaluating until it is re-translated. That is what an engine number does (`savedScriptUpgrade`, `definition_engine_status`). |
| v5 library in a v6 script | Refused `pine:library-version` unless on `pineLibraryCrossVersion.json` (empty). |

## 3. ConditionalAverages/2: held out, yet `ok`

- **"Held" is the allowlist's `heldOut` list** (`tools/pine_library/promotion_allowlist.json`). The row says:
  INCONCLUSIVE ×3 host-only (Rolling VWAP is `pine:block`), MATCH ×3 only with the runtime pane on.
- **The store's deny rule reads a different file:** `pineLibraryDeny.json` (`DENY_FILE`, `denied()`,
  `pine_library_store.py:62-91` at `66dd41b3e8`). That file lists a version only for a DIVERGE: *"INCONCLUSIVE is not wrong and
  is not a reason to list a version"* (`pineLibraryDeny.json` `_`[2]).
- **Before this change nothing that serves read the allowlist.** Its readers were `promotion_check.py` (the
  owner's tool) and `tests/test_pine_library_pinning.py`. So held out meant "not to be copied in", never "not
  to be served once present". ConditionalAverages/2 was already in the store from L1 (Rolling VWAP is a
  corpus script).

## The fix

`pine_library_store.entry_status` (every serving door: the read door, the list, `read_entry`, and
`pinned_entries` for the server run) answers `ok` only when two things hold. The promotion allowlist must
have a `promote` row for the path, and the store must hold the code that row pins (its sha256).

**Every other valid stored entry is refused by name.**
- Store status `held` for a `heldOut` row.
- Store status `unpromoted` for a version on no list, or for a promoted version held under other code.
- The read door answers 409 `{code: library:denied, reason: <the deny list's member sentence>}`.
- The client already maps that 409 to `pine:library-denied`, so the import line reads *"the library `X` is not
  served: this library version is withheld until its drawing is verified against TradingView"*. That is the
  same sentence a deny-listed version gets.
- The server run's pins refuse it under `pine:library-denied`.

**Why reuse `library:denied` instead of a new code.** The sentence is literally true of a held-out or
ungraded version: it is withheld until verified. A new code would add a guard id that the member could not
tell apart from this one, plus a client mapping and a refusal-code entry, for no difference in what the
member should do.

**One authority.** The served set is `promoted_versions()`, derived from
`tools/pine_library/promotion_allowlist.json` and read per call. Nothing is retyped.
- **Fail closed:** a missing file, a file that is not JSON, a `promote` that is not a list, or one row without
  a path or sha256 (or a path promoted twice) means nothing is served.
- **Deploys:** `railway.web.json` now watches the file, so a change to it redeploys `web`.

**Unchanged:**
- A version the store does not hold is still a 404, refused as missing.
- The deny list is still read first: fontilab/11 and loxxexpandedsourcetypes/4 stay `denied`.
- The licence and sha rules still answer first for an entry they reject.
- Nothing is deleted from the store.

**The owner's tools read the store's own rule** (`stored_status` / `stored_entry`).
- `fetch_library.py` never re-fetches, and so never overwrites, a version it holds just because that version
  is not promoted.
- `promotion_check.py install` copies from staging by the same rule.
- `promotion_check.py check` prints every OTHER version with the status this server now serves it with.
  After deploy the 42 read `store status unpromoted`, ConditionalAverages/2 reads `held`, and the two denied
  read `denied`.

## Rails (`tests/test_pine_library_pinning.py`)

| rail | what it holds | control |
|---|---|---|
| `test_a_held_out_version_is_refused_by_name` | `PineCoders/ConditionalAverages/2`, written as a fixture stand-in under the COMMITTED allowlist, is `held` at every door: 409 `library:denied` with the sentence, not listed, `read_entry` None, pins refused `pine:library-denied`. Non-vacuity: it is in `heldOut`, not in `promote`, not denied. | the same entry under an allowlist that promotes it at its sha is served |
| `test_a_version_on_no_list_is_refused_by_name` | `TradingView/ta/7` stand-in, committed allowlist: `unpromoted`, refused at every door. A version not held is still a 404. | promoted at its sha: served |
| `test_a_promoted_version_is_served_only_at_its_pinned_sha` | a promoted version is served at its pinned sha. The same version under other code is `unpromoted`, refused. | the graded code back: served again |
| `test_the_served_set_is_derived_from_the_committed_allowlist` | `promoted_versions()` equals the committed file's `promote` rows (path → sha256), 6 or more | — |
| `test_an_unreadable_allowlist_serves_nothing` (9 cases) | missing, not JSON, a list, no `promote`, `promote` not a list, a row without sha / path / a bad path / not an object: nothing served | `test_control_a_readable_allowlist_serves_exactly_what_it_promotes` (an empty readable list serves nothing too) |
| `test_the_owner_tools_still_see_what_the_store_holds` | the fetch tool does not re-fetch a held version. `promotion_check` prints `held` and `unpromoted`. | — |

The existing store rails now run against a fixture allowlist that promotes their fixture versions:
- an autouse fixture in `test_pine_library_pinning.py`;
- the `root` fixture in `test_pine_library_store.py`.

Two expectations changed to the new truth:
- the `--exact` problem reads "is a valid entry in this store";
- the install test reads the target's stored status.

## Mutants

How each one ran:
- the file was copied aside (outside the repository) and mutated;
- `tests/test_pine_library_pinning.py` and `tests/test_pine_library_store.py` were run with `-x`, no bytecode;
- the file was restored from the copy and checked byte-equal to HEAD (`git hash-object` = `HEAD:<file>`).

M1-M4 ran on `fbc5d7e016`; M5-M9 on `0222195af6`, whose code files are identical to it.
**9 of 9 killed:**

| mutant | killed by |
|---|---|
| M1 the gate never refuses (`if True:`) | `test_a_held_out_version_is_refused_by_name` |
| M2 the pinned sha is not compared (`path in promoted`) | `test_a_promoted_version_is_served_only_at_its_pinned_sha` |
| M3 an unreadable allowlist serves everything (`promoted is None or ...`) | `test_an_unreadable_allowlist_serves_nothing[missing]` |
| M4 held out not told apart (always `unpromoted`) | `test_a_held_out_version_is_refused_by_name` |
| M5 a row without a sha256 is read | `test_an_unreadable_allowlist_serves_nothing[row-without-sha]` |
| M6 the read door lets held / unpromoted through | `test_a_held_out_version_is_refused_by_name` |
| M7 the server run's pins ignore held / unpromoted | `test_a_held_out_version_is_refused_by_name` |
| M8 the fetch tool reads the served set (re-fetches a held version) | `test_the_owner_tools_still_see_what_the_store_holds` |
| M9 `promotion_check` prints the stored status | `test_the_owner_tools_still_see_what_the_store_holds` |

M8's first run saved its copy inside the repository, and the library-declaration scan went red on that copy
first. It was re-run with the copy outside the repository and killed by its own rail, as above.

## Member-facing cost: who imports each version that is now refused

These are importers (committed corpus `corpus/committed`, 266 scripts; committed captures
`tests/fixtures/vendor/harness`), not scripts that draw.
- **On engine 61** (U15b `EVIDENCE.md:105`, 92 captures of the sample's importing scripts, full scratch
  store), **none of them attached host-only**. So no committed or sampled script is known to lose a drawing.
- **Not re-measured on engine 66.** That needs the licence-held store and the census lock.

**Totals.** 29 corpus scripts / 36 captures import an unlisted version. 1 / 3 import the held-out one.

| version | class | corpus scripts | captures |
|---|---|---|---|
| PineCoders/ConditionalAverages/2 | held out | 1 (rolling-vwap) | 3 |
| TradingView/ta/7 | unlisted | 3 | 4 (incl. the Q-L1 probe `vw-library-import`) |
| TradingView/ta/9 | unlisted | 1 | 1 |
| TradingView/ta/10 | unlisted | 2 | 2 |
| TradingView/ta/12 | unlisted | 4 | 6 |
| TradingView/ta/14 | unlisted | 1 | 0 |
| TradingView/ZigZag/7 | unlisted | 1 | 2 |
| PineCoders/Time/2, Time/5 | unlisted | 1, 3 | 2, 6 |
| PineCoders/VisibleChart/5 | unlisted | 2 | 3 |
| PineCoders/lower_tf/4, lower_tf/5 | unlisted | 1, 2 | 2, 4 |
| TFlab/* (5 versions) | unlisted | 2 scripts in all | 2 |
| jdehorty/KernelFunctions/2, MLExtensions/2 | unlisted | 2, 2 | 2, 2 |
| reees/Algebra/3, TA/11 | unlisted | 1, 1 | 1, 1 |
| boitoki/AwesomeColor/9, Utilities/11 | unlisted | 1, 1 | 1, 2 |
| loxx/loxxmas/1 | unlisted | 1 | 2 |
| ClassicScott/MyMovingAveragesLibrary/4, MyVolatilityBands/7 | unlisted | 1, 1 | 2, 2 |
| HoanGhetti/SimpleTrendlines/3, /4 | unlisted | 1, 1 | 2, 1 |
| LucF/ta/3 | unlisted | 1 | 2 |
| MUQWISHI/CandlestickPatterns/2 | unlisted | 1 | 1 |
| ZenAndTheArtOfTrading/ZenLibrary/9 | unlisted | 1 | 1 |
| jason5480/chrono_utils/7 | unlisted | 1 | 1 |
| jordanfray/obvFilter/2, threengine_global_automation_library/89 | unlisted | 1, 1 | 2, 2 |
| HeWhoMustNotBeNamed/arraymethods/1, RicardoSantos/MathOperator/2, kaigouthro/hsvColor/15 | unlisted | 1 (bull-vs-bear) | 0 |

Nested-only versions (RelativeValue/2 and the like) have no direct importer in the corpus.

**Harness and census are untouched.** They link libraries through `PINE_LIBRARY_STORE` / `opts.libraries` /
fixture registration, never through this read door, so no capture verdict and no coverage-ratchet number can
move. Host-parity digests do not move either: no engine code changed.

## Owner actions (none required for the code to take effect)

- **The merge deploys `web`, and the gate is live from that boot.** Nothing is written to the store, and
  nothing in it needs removing.
- **Optional:** re-run `promotion_check.py check` on the pod to read the new statuses.
- **After 2026-12-01, when Railway's stored settings become the authority:**
  `python tools/railway_stored_settings.py --apply --service web` stores the new watch pattern.

## Engine number: NUMBER PENDING

No engine code changes, but what production's store hands the translators does: a script that imports a
non-promoted version is now refused at its import line. A number makes every saved script re-translate once.
That is the only path by which the alert / scan / backtest lanes stop running a saved tree that holds an
unpromoted library's spliced code. The coordinator numbers it, or rules that the engine-61 measurement (no
attaching importer) means no saved tree holds one.
