# Rolling the Notebook back: newest landing first, the schema guard kept

> ⚠️ **READ THIS FIRST, 2026-10-06 (lane ROLLBACK, the wave 12-15 finish program). THE CHAIN
> BELOW IS NOT CURRENT AT PRODUCTION'S TIP.**
> - Wave 11 (#263, `f473d00b3`) is now the top row, key `W11`. `MEASURED_AT` is `f473d00b3`, wave
>   11's own squash. At that tree its revert has 0 conflicts and all seventeen pins came back
>   byte-identical. Below it, every step differs from the tree lane R1h rehearsed only in the
>   paths a rollback never reverts and in files other workstreams changed between L15 and wave
>   11 (a rail checks this, step by step).
> - Master is more than 600 commits past wave 11. `--check --from origin/master` says **stale**.
>   Measured at `0ae75faf37`: 100 path-only commits to rule on, and the chain meets 30 conflicts
>   at 15 of its 26 steps (23 with no rule, 7 recorded ones whose lines moved), starting with wave
>   11's own revert (four product files, the account-deletion list and its rail). Both lists
>   are recorded for the next re-measure: `docs/notebook/evidence/rollback-rehearsal-2026-10-06-fin/census-*.json` and
>   `docs/notebook/evidence/rollback-rehearsal-2026-10-06-fin/conflict-map-origin-master.txt`. Until someone does that work, **`--through` cannot be
>   used on production's tip.**
> - **One landing can still be rolled back alone.** `--landing <squash>` reverts a single landing
>   on top of any base with the keep-list kept, uses no recorded rule, and stops on any product
>   conflict. That is the code lever for the wave 12-15 landing, rehearsed before it merged:
>   **`docs/notebook/landing-12-15-rollback.md`**.
> - This lane booted no sandbox. What it ran is in *Measured, 2026-10-06* below.

> ⭐ **EXECUTABLE AT `38bb9a421` (production's tip, 2026-09-28), AND REHEARSED STEP BY STEP ON A
> SANDBOX** (lane R1, scorecard clause 3b). Every Notebook landing from wave 10 down to wave 5 was
> reverted newest first, and each step booted from a `git archive` of its own tree on the tip's
> data. All 19 boots were CLEAN. The procedure's check list ran green inside every step's tree.
> Evidence: `docs/notebook/evidence/rollback-rehearsal-2026-09-28/` (raw chain `chain/`, raw boots `sandbox/`, mechanical tables `chain/step-table.md` and
> `sandbox-results.md`). The table is in *Measured, 2026-09-28* below.
>
> ⭐ **RE-MEASURED AT `f4cec49be` (L2 #242, production's tip, 2026-09-29; lane R1b).** L2 is the
> new top row. Its revert is conflict-free. The whole chain was rebuilt from the new tip: the ten
> pins recorded at `38bb9a421` came back byte-identical, and later Terminal work added four new
> conflicts, each now a rule and a pin (*Measured, 2026-09-29*). `MEASURED_AT` is `f4cec49be`.
> Rehearsed on a sandbox through `L2`, `L1a` and `wave7`. Evidence:
> `docs/notebook/evidence/rollback-rehearsal-2026-09-29/`.
>
> ⭐ **RE-MEASURED AGAIN AT `0812b5ec3` (L4 #251 + L5 #252, production's tip, 2026-09-29; lane
> R1c).** L5 and L4 are the new top two rows; both revert with 0 conflicts. The whole chain was
> rebuilt from the new tip: all ten pins recorded at `f4cec49be` came back byte-identical, and one
> new conflict was found four steps further down, at wave 8's own revert (`caf6d1b9e`,
> `app/src/pages/Support.jsx` -- TERM-039's import sits on lines wave 8's revert also touches),
> now a rule and a pin (*Measured, 2026-09-29, lane R1c*). `MEASURED_AT` is `0812b5ec3`.
> Rehearsed on a sandbox: the tip, `L5` and `L4`, all three boots CLEAN. ⚠️ Mid-lane the box's `C:`
> drive measured **0 bytes free** -- a machine-wide condition this lane did not cause, reported as
> a refusal rather than worked around (`sandbox/BLOCKED-disk-exhaustion.md`) -- and free space
> returned on its own before the re-run that produced the results below. Evidence:
> `docs/notebook/evidence/rollback-rehearsal-2026-09-29-r1c/` (`sandbox-results.md` is the table).
>
> ⭐ **RE-MEASURED AGAIN AT `8d08da86f` (L6 #253 + L7 #254, production's tip, 2026-09-29; lane
> R1d).** L7 and L6 are the new top two rows; both revert with 0 conflicts. L6 ships zero `app/`
> or `api/` files (rollback-chain tooling + rehearsal evidence for L4/L5, a restore-drill fix,
> proof-walk evidence) -- a real wave-10 landing anyway, selected by PATH only (its one
> Notebook-owned file is `tests/test_notebook_rollback_chain.py`), declared in
> `CHAIN_BY_PATH_ONLY`. The whole chain was rebuilt from the new tip: all fifteen pins recorded at
> `0812b5ec3` came back byte-identical, and one new conflict was found four steps further down, at
> wave 5's own revert (`2c3ed3093`, `app/src/components/CommandPalette.jsx` -- TERM-038 built its
> dark "saved" rows inside the same functions wave 5's own quick-switcher introduced, seven hunks
> deep with no separable lines), ruled "ours" (keep the newer work), now a rule and a pin
> (*Measured, 2026-09-29, lane R1d*). `MEASURED_AT` is `8d08da86f`. Rehearsed on a sandbox: the
> tip, `L7` and `L6`, all three boots CLEAN; L7's Find-in-note touch-tier floor measured 44px at
> the tip, 18px through `L7` and through `L6`. Evidence:
> `docs/notebook/evidence/rollback-rehearsal-2026-09-29-r1d/` (`sandbox-results.md` is the table).
>
> ⭐ **RE-MEASURED A THIRD TIME AT `6f563c158` (L8 #255, production's tip, 2026-09-29; lane R1d,
> continued).** L8 landed while this lane was working (controller note). L8 is the new top row;
> like L6, it ships zero `app/` or `api/` files (a parity-scorecard re-score + writing-help
> production evidence) -- a real wave-10 landing anyway, selected by PATH only (its one
> Notebook-owned file is `tests/test_parity_scorecard.py`), declared in `CHAIN_BY_PATH_ONLY`
> alongside L6. A fifth path-only commit landed alongside it, `cd9ecc833` (Fundamentals V5
> cutover, dark), touching only `api/main.py` (a lifespan scheduler-registration block moved to
> the worker pod) -- reviewed, not a landing. The whole chain was rebuilt from `origin/master`
> (`5b4da7874` at measurement time, one unrelated breadth commit past `MEASURED_AT` itself): all
> sixteen pins recorded at `8d08da86f` came back byte-identical, no new conflict anywhere in the
> chain. `MEASURED_AT` is `6f563c158`. Rehearsed on a sandbox (its own data dir/port,
> `rehearse_round2.py`): the new tip and `L8`, both boots CLEAN, `L7`'s door still 44px at the new
> tip (unaffected) and every probe identical between the tip and `L8` reverted (L8 has no door of
> its own, same shape as L6). `--check --from origin/master` reports `current`. Evidence:
> `docs/notebook/evidence/rollback-rehearsal-2026-09-29-r1d/` (round 2 files:
> `chain/chain-through-L8.jsonl`, `check-origin-master-round2-*.log`,
> `rehearse_round2.py`, `sandbox/s01-tip2/`, `sandbox/s-L8/`).
>
> ⭐ **RE-MEASURED A FOURTH TIME AT `599cd44f1` (L9 #256 + L10 #257 + L12 #258, production's tip,
> 2026-09-30; lane R1e).** `L12` is the new top row; `L10` and `L9` are the next two. L9 (R1d's own
> PR, merged after R1d wrote `MEASURED_AT=6f563c158` so it could not measure itself) ships zero
> `app/` or `api/` files -- same shape as L6/L8 -- selected by PATH only (its one Notebook-owned
> file is `tests/test_notebook_rollback_chain.py`), declared in `CHAIN_BY_PATH_ONLY`. L10 and L12
> DO ship real `app/`/`api/` Notebook code, but their squash subjects read "Notebook w10 LN: ..."
> rather than "Notebook 10/10 -- wave 10 LN: ...", dropping the word "wave" `NOTEBOOK_SUBJECT`
> requires -- a NEW, different reason for the same declared PATH-only exception. All three revert
> with 0 conflicts. The whole chain was rebuilt from the new tip: all sixteen pins recorded at
> `8d08da86f` came back byte-identical, no new conflict anywhere in the chain. Nine more path-only
> commits in the window were read and ruled NOT Notebook landings (two econ-harness entries to the
> shared `reachable.test.js` rail, an event-loop fix and a Terminal-Next router mount each touching
> only `api/main.py`, a Terminal-Next flag reader touching only `api/routers/auth.py`, a BRK-01
> router+flag mount, a revert/reapply pair of another workstream's wave-3 Pine-engine integrate
> merge, and a clock/build-budget perf commit sharing the wave-3 pair's `vite.config.js` plugin),
> all added to `REVIEWED_NOT_LANDINGS`. `MEASURED_AT` is `599cd44f1`. Rehearsed on a sandbox: the
> tip, through `L12` and through `L10`. L12's door (`sort=updated_asc` on `GET /api/j2/notes`) and
> L10's door (the template-gallery card count) are read in the table below. Evidence:
> `docs/notebook/evidence/rollback-rehearsal-2026-09-30-r1e/` (`sandbox-results.md` is the table).
>
> ⭐ **RE-MEASURED A FIFTH TIME AT `a680b0d40` (L13 #259, production's tip, 2026-09-30; lane
> R1f).** `L13` is the new top row. It ships real `app/`/`api/` Notebook code AND its squash
> subject kept the literal word "wave" ("Notebook 10/10 wave 10 L13: ..."), so unlike L10/L12 it
> is selected by SUBJECT AND PATH both -- no new `CHAIN_BY_PATH_ONLY` exception needed. It reverts
> with 0 conflicts, not even a doc-only one. The whole chain was rebuilt from the new tip: all
> seven pins recorded at `599cd44f1` came back byte-identical, no new conflict anywhere in the
> chain. One more path-only commit in the window was read and ruled NOT a Notebook landing --
> `69beea8d1` (Terminal TERM-073, the nightly analyst-revisions "what changed" timeline, dark),
> touching only `api/main.py` (one router mount behind `ANALYST_REVISIONS_ENABLED`) -- added to
> `REVIEWED_NOT_LANDINGS`. `MEASURED_AT` is `a680b0d40`. Rehearsed on a sandbox: the tip, through
> `L13` and through `L12`. L13's door -- `POST /api/j2/notes/{id}/facts` with
> `factType=analyst_price_target_consensus` -- is read in the table below. Evidence:
> `docs/notebook/evidence/rollback-rehearsal-2026-09-30-r1f/` (`sandbox-results.md` is the table).
>
> ⭐ **RE-MEASURED A SIXTH TIME AT `c75bf6ea0` (L14 #260 + hotfix #261, production's tip,
> 2026-10-01; lane R1g).** `L14` is the new top row. It ships real `app/`/`api/` Notebook code AND
> its squash subject kept the literal word "wave" ("Notebook 10/10 wave 10 L14: ..."), so like L13
> it is selected by SUBJECT AND PATH both -- no new `CHAIN_BY_PATH_ONLY` exception needed. Five
> more path-only commits landed in the window (`a680b0d40..c75bf6ea0`): four are a Terminal
> TERM-067 accessible-name pass, each touching exactly one shared file already in the derived
> Notebook set (`desk/TeamSection.jsx`, `Settings.jsx` twice, `styles/tokens.css`) -- added to
> `REVIEWED_NOT_LANDINGS`. The fifth is `c75bf6ea0` itself, `hotfix(tools) #261`: it un-pins
> `tools/record_clock_parity.py` (a CI job without pytest runs it; `tools/` is a kept path
> regardless) and adds a test to `tests/test_tools_pin_the_root.py` -- selected by the census ONLY
> because L14 itself created that file -- also added to `REVIEWED_NOT_LANDINGS`. `MEASURED_AT`
> moves past the hotfix, not left at L14's own sha, because a `REVIEWED_NOT_LANDINGS` entry must
> fall inside the window the rail checks. **Unlike every prior re-measure, this one is NOT
> conflict-free**: reverting L14 onto the new tip collides with the hotfix's own edit to
> `tests/test_tools_pin_the_root.py` (a real modify/delete conflict, that file is not a
> `KEEP_PATH`) -- resolved `"ours"` (keep the hotfix's newer, non-Notebook test-rail work, the same
> shape as wave 7's `daily_counters.py` rule), one new rule and one new pin. All seven pins
> recorded at `a680b0d40` for the steps below L14 came back byte-identical. `MEASURED_AT` is
> `c75bf6ea0`. Rehearsed on a sandbox: the tip, through `L14` and through `L13`. L14's two doors --
> a locked note's three append endpoints (`POST /api/j2/notes/{id}/embeds`,
> `/facts/{id}/insert`, `/excerpts`) all answering 423, and `App.jsx`'s `INTRO_SKIP_PREFIXES`
> keeping the brand film off `/share/n/:token` and `/p/:slug` for a signed-out stranger -- are read
> in the table below. ⚠️ `origin/master` moved 46 commits further during this lane (an unrelated
> Pine vendor-harness merge wave); none of it is selected by the census (`--check --from
> origin/master` still reports `current`), and extending the chain to cover it is explicitly out
> of this lane's scope -- the next lane re-reads `--check` from the live tip. Evidence:
> `docs/notebook/evidence/rollback-rehearsal-2026-10-01-r1g/` (`sandbox-results.md` is the table).
>
> ⭐ **RE-MEASURED A SEVENTH TIME AT `b529c8a786` (L15 #262, production's tip, 2026-10-01; lane
> R1h).** `L15` is the new top row. It ships real `app/`/`api/` Notebook code (keyboard-access
> fixes -- the `shift+slash` hotkey chord, TickerPopup's trigger gaining a `tabIndex` and a key
> handler, `/journal/notebook?view=graph` recognising every `VIEW_MODES` id instead of falling
> through to Research Home -- a PNG-export size guard for very long notes, and the rollback chain
> through L14, i.e. lane R1g's own work, landed as part of this same squash) AND its squash
> subject kept the literal word "wave" ("Notebook 10/10 wave 10 L15: ..."), so like L13/L14 it is
> selected by SUBJECT AND PATH both -- no new `CHAIN_BY_PATH_ONLY` exception needed. It reverts
> with 0 conflicts, not even against the hotfix's own test-rail file the step below carries. One
> more path-only commit landed in the window (`c75bf6ea0..b529c8a786`), older than L15: `726586201`
> (feat(charts): Technical library Tier 1 -- 33 studies, 9 MA types, real fixed scales), touching
> `app/src/pages/Settings.jsx` only to widen the Moving Average overlay's type `<select>` for an
> adopted engine-instance slot (shared file); every other file it ships sits outside the derived
> Notebook set -- added to `REVIEWED_NOT_LANDINGS`. `L15` is the newest commit the census selects
> in this window and is itself the tip, so `MEASURED_AT` moves to its own sha, `b529c8a786` --
> unlike L14's window, nothing REVIEWED lands after it here. The whole chain was rebuilt from the
> new tip: all eight pins recorded at `c75bf6ea0` came back byte-identical, no new conflict
> anywhere in the chain. `MEASURED_AT` is `b529c8a786`. Rehearsed on a sandbox: the tip, through
> `L15` and through `L14`. Three of L15's doors -- `/journal/notebook?view=graph` rendering the
> graph canvas instead of Research Home, a real Shift+/ keypress opening the Keyboard Shortcuts
> dialog, and FuturesStrip's TickerPopup trigger carrying `tabIndex=0` with Enter opening its chart
> dialog -- are exercised behaviourally in a real browser against the real served bundle and read
> in the table below; the fourth (the PNG export size guard's own refusal text) is checked against
> the BUILT `app/dist/assets/*.js` output instead of a live click -- see "What was NOT measured
> here" for why. Evidence: `docs/notebook/evidence/rollback-rehearsal-2026-10-01-r1h/`
> (`sandbox-results.md` is the table).
>
> ⛔⛔ **"Roll back wave N" means: revert EVERY Notebook landing newer than or equal to N,
> newest first.** Every wave is built on the ones before it and every one landed as a squash.
> Reverting one old wave alone is not a procedure: measured 2026-09-26, reverting wave 5 by itself
> stopped on 68 unmerged paths, the guard's own two table files among them.
>
> ⛔⛔ **THE KEEP-LIST: never reverted, at any step** (details in *The keep-list*):
> 1. **Both schema tables, and the two rails that test them**, stay byte-identical to the tip:
>    - the tables: `app/src/pages/journal-2-0/lib/notebookSchema.js` and
>      `api/services/journal_two/notebook_schema.py`;
>    - their rails: `notebookSchema.rail.test.js` and `tests/test_notebook_schema_guard.py`.
>    The reverts of wave 6 and of wave 5 would change them. The procedure puts the tip's copies back.
>    Since wave 13 (13H-1) the two files hold TWO tables each -- the type table and the attribute
>    table `NOTEBOOK_ATTR_SCHEMA` (`widgetEmbed.ta`, level 4) -- and both are kept (*Level 4*).
> 2. **The guard commits `8167f7aa0` and `fd87271fd`** (tags `notebook-wave5-guard-*`) are
>    re-applied after wave 5's revert. **`82c56dd63` is NOT re-applied**: it does not apply to the
>    fully rolled-back tree, and there it is not needed (see the keep-list). Above wave 5 all three
>    stay in the tree, because wave 5's squash is never reverted.
> 3. **The server H14 hotfixes #204 (`2ab637644`) and #203 (`c6a8a9d3a`)** stay. They were measured
>    merge-clean at every step below them.
> 4. **Records and the operator's tools stay as the tip has them: `docs/`, `tools/`, `scripts/`, and
>    `CLAUDE.md`.** A rollback reverts what ships to members. It does not revert the records, this
>    runbook, or the instruments that check the rollback.
>    ⚠️ **The SK question, raised not silently decided (lane R1c):** L4 (#251) touches
>    `scripts/hub_sandbox_boot.py` and `scripts/hub-sandbox.ps1` (the sandbox-boot model-key
>    policy, lane SK). `scripts/` was already in `KEEP_PATHS` before L4 landed, so this is NOT a
>    new decision: reverting L4 (or any landing) never touches those two files -- they stay at the
>    tip's content at every step, same as every other operator tool. That is almost certainly
>    correct (a rolled-back member build should still be tested with the operator's current,
>    safest sandbox launcher, not an older one with a weaker model-key policy). The alternative --
>    carving `scripts/` out of `KEEP_PATHS` so a rollback also reverts the operator's own tools --
>    is NOT proposed: it would also un-revert `scripts/notebook_switch_rehearsal.py`,
>    `scripts/sandbox_identity.py` and every other instrument this runbook and its rehearsals
>    depend on, for no product-facing benefit. Flagged here for a person to confirm, not decided
>    by this lane.

## The procedure

Use the fast lever first. A Notebook problem that one switch can stop is stopped with the switch:
`NOTEBOOK_OFFLINE_DEFAULT_ON=0` or a gate on `web` (`docs/notebook/kill-switch-flip-packet.md`,
`docs/notebook/rehearsal-2026-09-26.md`). The steps below remove CODE. Use them when no switch
reaches the problem.

**0. Pick the oldest landing to remove**, then list the chain. `--through` takes the key in the
first column:

```sh
git fetch origin --tags
python tools/notebook_rollback_chain.py --list
```

| key | squash | landing | kept? |
|---|---|---|---|
| `W11` | `f473d00b3` | wave 10 L16 + wave 11 #263 | |
| `L15` | `b529c8a78` | wave 10 L15 #262 | |
| `L14` | `0e7d0561a` | wave 10 L14 #260 | |
| `L13` | `a680b0d40` | wave 10 L13 #259 | |
| `L12` | `599cd44f1` | wave 10 L12 #258 | |
| `L10` | `8eb7f008b` | wave 10 L10 #257 | |
| `L9` | `89390fb85` | wave 10 L9 #256 | |
| `L8` | `6f563c158` | wave 10 L8 #255 | |
| `L7` | `8d08da86f` | wave 10 L7 #254 | |
| `L6` | `3fb184cdf` | wave 10 L6 #253 | |
| `L5` | `0812b5ec3` | wave 10 L5 #252 | |
| `L4` | `7bd834b9f` | wave 10 L4 #251 | |
| `L2` | `f4cec49be` | wave 10 L2 #242 | |
| `L1c` | `38bb9a421` | wave 10 L1c #228 | |
| `225` | `4bba30b73` | #225 H14: the phone skip link (a fix to wave-8 CSS) | |
| `L1b` | `d9e887ca0` | wave 10 L1b #224 | |
| `L1a` | `4f708a0d2` | wave 10 L1a #205 | |
| `204` | `2ab637644` | #204 H14: every read-then-write note door takes the write lock | **kept** |
| `203` | `c6a8a9d3a` | #203 H14: depth cap, Word intake, PDF extraction budget | **kept** |
| `wave9` | `1c4b0bf74` | wave 9 #202 | |
| `201` | `7e3f9e117` | #201 H14: the pane heading never moves the toolbar (a fix to wave-8 CSS) | |
| `wave8` | `caf6d1b9e` | wave 8 #198 | |
| `9C` | `2e0598bfa` | wave 9C #197, the soak instrument | |
| `wave7` | `f883e0996` | wave 7 #196 | |
| `wave6` | `271a078b6` | wave 6 #193 | |
| `wave5` | `2c3ed3093` | wave 5 #186, then re-apply `8167f7aa0` and `fd87271fd` | |

`--through wave8` reverts every row from `L2` down to `wave8`, skipping the two kept rows.
`L2` is frontend only (46 files under `app/src/pages/journal-2-0/`, no server change), so
`--through L2` changes no API door. Its revert takes out the phone Journal header and deep links,
the template gallery, the editor header's More menu (D-3) and keyboard 9d.
⚠️ #225 and #201 fix CSS that wave 8 added. They cannot be kept below wave 8: measured, keeping
them stops the wave-8 revert on `NotebookTab.module.css`.

**1. Check that the chain is current, then build it.** First ask the tool whether it was measured
on the base you are about to roll back:

```sh
python tools/notebook_rollback_chain.py --check --from origin/master
# {"check": "current", ...}  exit 0 -> build the chain below
# {"check": "stale", "stopped": "<why>", ...}  exit 2 -> re-measure first ("If the tool stops")
```

`--check` asks exactly what the build asks before it writes anything, and the build still asks it
itself. A stale answer names each uncharted commit. Most are other workstreams' commits that touch a
shared file. Measured 2026-09-29 07:19Z: origin/master `9f9d60b4b` is stale by two path-only
commits after `f4cec49be` (`evidence/.../check-origin-master.log`).

The build uses objects only. It touches no worktree, no index, and no
ref. It writes ONE commit per reverted landing, each on top of the last, so the result is a chain
of commits on top of `--from`. Its last line names the chain's tip and the next command:

```sh
python tools/notebook_rollback_chain.py --from origin/master --through wave7
# {"result": "<sha>", "tree": "<tree>", ..., "next": "git switch -c rollback/notebook-through-wave7 <sha>"}
```

- **Exit 2 with `{"stopped": ...}`** means the tool refused, and the message says why and what to
  re-measure. It refuses, failing closed on anything it did not measure, when:
  - `--from` does not contain `MEASURED_AT` (the tree the chain and its rules were measured on);
  - a commit after `MEASURED_AT` looks like a Notebook landing that neither `CHAIN` nor
    `REVIEWED_NOT_LANDINGS` names. Either of two things is enough. The first is its subject: it
    takes a landing's form (`Notebook … wave …`, `fix(notebook):` or `hotfix(notebook):`, or
    `Wave 9C`), read off `CHAIN`'s own squash subjects; a subject that only MENTIONS the Notebook,
    such as 3e5153f1d's "(Notebook bytes back under budget)", no longer counts. The second is that
    it touches a file in the Notebook file set. That set is DERIVED from git: the
    union of the files every `CHAIN` landing's squash changed, minus the kept paths;
  - a conflict is not the one its rule was measured on. Every rule is pinned to the conflict's
    content (`PINS`), so a later commit that changed those lines stops the chain;
  - a conflict has no rule at all;
  - `--through` names a kept hotfix (`204`, `203`).
  Read *If the tool stops*. Never resolve a stop by editing the rule or the pin for a different
  conflict.
- **A first line `{"warning": ...}`** means `--from` is newer than `MEASURED_AT` but passed every
  refusal above. Steps 2 and 3 are then MANDATORY, not advisable.
- Every step's JSON line names its conflicts and the rule that resolved each. It also reports
  `schema_identical_to_tip`, which must be `true` on every line, and `schema_change_undone`,
  which lists the table changes the step would have made and the tool put back.

**2. Check it.** Run each command in its own call, never through a pipe.

First, in a checkout OF THE BASE (`--from`, not the rollback branch), run the rollback rail. It
proves the census and the tool still agree with git at that base. It rebuilds the measured chain
tree for tree, pins included, and checks every refusal:

```sh
python -m pytest tests/test_notebook_rollback_chain.py tests/test_notebook_schema_guard.py -q
```

Then check the rollback itself, in a worktree of its own:

```sh
git worktree add ../notebook-rollback <sha>                  # write the .uct-session-owner file (CLAUDE.md)
cd ../notebook-rollback && git switch -c rollback/notebook-through-wave7
git diff origin/master HEAD -- app/src/pages/journal-2-0/lib/notebookSchema.js api/services/journal_two/notebook_schema.py \
  app/src/pages/journal-2-0/lib/notebookSchema.rail.test.js tests/test_notebook_schema_guard.py
#   ^ must print NOTHING (the tables and their two rails stay at the tip)
python -m pytest tests/test_notebook_schema_guard.py -q
cd app && npx vitest run --maxWorkers=2 src/pages/journal-2-0/lib/notebookSchema.rail.test.js \
  src/hub/writePathsTransitive.test.js src/hub/writePaths.test.js src/pages/journal-2-0/lib/importer \
  src/pages/journal-2-0/lib/offline/writtenSchemaDrain.test.js \
  src/pages/journal-2-0/lib/offline/writtenSchemaCapture.test.js \
  src/pages/journal-2-0/components/notebook/NoteEditorPage.writtenSchema.test.jsx
```

After `--through wave5`, the last three files do not exist, because `82c56dd63` is not re-applied.
Leave them off the vitest command.
A fresh worktree has no `node_modules`. Run `npm ci` in `app/` first on a quiet box, or use a
junction and remove it the way CLAUDE.md says.

**3. Rehearse it on a sandbox.** This is the same method as the 2026-09-28 rehearsal. Boot the tip
first as the control. The control also seeds the three fixture notes (levels 0, 1 and 2). Then
boot the rollback commit on the SAME data dir. Build `app/dist` in each checkout first
(`cd app && npm run build`). Pass the data dir from PowerShell, or in single quotes; never
`C:\data`:

```powershell
python scripts/hub_sandbox_boot.py --data-dir 'C:\data-rb' --port 8229 --host 127.0.0.1   # from the checkout under test
# in a second shell, the log path is the launcher's "[pre-boot] integrity log:" line:
python docs/notebook/evidence/rollback-rehearsal-2026-09-28/probe.py --base http://127.0.0.1:8229 `
  --integrity-log <log> --out <dir> --mode seed --fixtures <dir>\fixtures.json --label tip      # the tip; then --mode check on the rollback
```

For a chain that includes `L2`, use `evidence/rollback-rehearsal-2026-09-29/probe.py` instead: it
runs the 2026-09-28 probe unchanged and adds L2's door (the editor's More-menu button) and the
writing-help and meters doors the 2026-09-29 rules move.

The first line of the launcher's integrity log must read CLEAN at pre-boot, +15 s, +120 s and
shutdown. The probe must show three things:
- the reverted landings' doors are gone (the table in *Measured* gives each landing's door);
- the kept landings' doors are still present;
- the three notes behave as the *Measured* table's last rows do for the same depth.

**4. Ship it: a revert on master is a production deploy.** It is never an agent's call. It needs:
- the owner's explicit "deploy";
- a member-impact paragraph;
- one master merge at a time;
- the rollback branch landing as ONE SQUASH-MERGE. Rolling forward is then one revert of that
  squash. Merged as a chain instead, `git revert <result>` would undo only the last step;
  the whole range `<from>..<result>` would have to be reverted.

⚠️ **The rollback changes what gates production promotion.** Through `L1b` it deletes
`notebook-latency.yml` and `notebook-bytes.yml` (`promotion-gate: yes`) and takes `notebook-a11y.yml`
back to its wave-8 state. Through `wave8` it deletes `notebook-a11y.yml`. The gating set is read
from `.github/workflows/` (`promote-production.yml`), so the revert commit is promoted without the
checks it removed. That is what lets it deploy at all: a kept a11y workflow would run tests the
revert deleted. After the deploy:
- verify by a NEW BOOT (uptime reset);
- verify by `hub_nav_smoke --auth`;
- apply H15: a failing smoke is rolled FORWARD by reverting the rollback's one squash-merge.

### If the tool stops

The rules in `tools/notebook_rollback_chain.py` (`RULES`) and their pins (`PINS`) were measured at
`MEASURED_AT`. A newer commit on master that changes the lines of a recorded conflict, or adds a
new conflict, stops the chain, and the stop names the file. Resolve it the way every recorded rule
does:
- keep the newer work;
- take out only the reverted landing's own lines (`ours_drop` wherever it fits);
- add the rule, then re-record the pins (`python tools/notebook_rollback_chain.py --record-pins
  --through wave5`, run once `MEASURED_AT` is moved to the new tip);
- re-run the tool, then the rail `tests/test_notebook_rollback_chain.py`;
- rehearse the changed step on a sandbox.

⛔⛔ **NEVER hand-pick `82c56dd63` below wave 5**, however the stop reads. That applies to a stop at
the `8167f7aa0` pick too.
- Measured: `82c56dd63` conflicts in five files whose context wave 5's revert removes.
- Resolving those conflicts to the rolled-back side leaves its clean hunks calling `OWN_READ`,
  `keepRefusedWords` and `lowerStamp`, with nothing defining them. `NoteEditorPage` then throws a
  ReferenceError when it mounts, and the Notebook editor is down for every member.
- A bundle rolled back through wave 5 declares 0 from every door and does not need it (*Why
  `82c56dd63` rides along*).

⛔ A **new Notebook landing** makes the procedure stale: the chain cannot revert what it does not
list. The tool refuses to run on a base that holds one, and names it. Its subject or one of its
files is enough for the refusal, and `--check` names it (step 1). The rails do NOT look at a live
base. They assert that the chain is current AT `MEASURED_AT`, and they rail `--check` on synthetic
commits. ⚰️ Until 2026-09-29 a rail asked `HEAD`, and it went red whenever the world moved on
(another workstream's commit on master, a lane's own commits) while the chain was still correct.

⚠️ **The file criterion is broad on purpose, and that is its cost.** The Notebook file set is 834
files at `MEASURED_AT` `f4cec49be` (815 at `38bb9a421`; L2 added 19). It includes shared files every
workstream edits, such as `app/src/App.jsx` and `api/main.py`. Measured
(`evidence/rollback-rehearsal-2026-09-29/chain/census-*.txt`):
- between wave 5 and `f4cec49be`, 847 one-parent commits; the census selects 49. 14 are the
  landings in `CHAIN` (the subject criterion selects exactly those). 35 are not landings
  (23 up to `38bb9a421`, 12 after it);
- 21 of those 35 are selected ONLY through six shared files: `api/main.py` (10 of the 35),
  `api/routers/auth.py`, `api/services/auth_db.py`, `app/src/App.jsx`, `app/src/pages/Settings.jsx`
  and `app/src/components/screener/reachable.test.js`;
- in the L2 window (`38bb9a421..f4cec49be`, 58 commits) it selected 13, and 1 was a landing.

So the criterion is over-broad by that measure: about 12 false positives per landing in the last
window. It is NOT narrowed, because nothing yet rails a narrower one. The same window also shows
what the breadth buys: two of the twelve (`948af2c17` and `c26c8f863`) sit on lines the reverts
conflict with, four conflicts between them. The chain would have stopped on those anyway, but the
census named them first. Another workstream's commit on master will stop the tool.
A person then reads it and does one of two things:
- adds it to `REVIEWED_NOT_LANDINGS` with the reason it is not a Notebook landing, then re-runs;
- or treats it as a landing, following the four steps below.

That is the intended fail-closed behaviour. A hand-typed path list was tried first, in fix round
1, and it missed real Notebook files: `hooks/useJ2Notes.js`, `lib/importer/commit.js`, and the
`public_note_payload.py` the tool's own rules name. It was replaced by the derivation.

A landing that has to be added goes through four steps:
1. add the landing to `CHAIN`, newest first;
2. run the tool from the new tip and record a rule for each conflict;
3. rehearse the new step;
4. move `MEASURED_AT` and re-record the chain (`python tools/notebook_rollback_chain.py --from <tip> --through wave5`) as the file the rail reads (`RECORD`).

## Why a rollback needs the guard

TipTap reads a stored note body whole or not at all. If a note contains even one
node or mark type the loading editor does not register, the note opens **empty**:
`createNodeFromContent` catches the `nodeFromJSON` error and returns an empty
document. That editor's next save then writes the empty document over the note.
The compare-and-set on `updated_at` cannot stop it, because the old tab holds the
current revision.

Wave 5 and G-064 add six such types: `inlineMath`, `blockMath`, `highlight`,
`textColor`, `askInsert` and `askCitation`. Once the features are reverted, the
rolled-back bundle can read none of them, and members have already written notes
that contain them.

Opening such a note is enough to cause the damage. On origin/master,
`UpbRichEditor.jsx` (lines 224-256) calls `setContent(docJson, false)`. TipTap
3.23.6 declares that command as
`setContent(content, { errorOnInvalidContent, emitUpdate = true, ... } = {})`. The
`false` is not an options object, so `emitUpdate` keeps its default of `true`.
That fires `onUpdate`, which schedules the autosave, and the autosave writes the
empty document. So opening a Model Book entry the editor cannot read saves a
blank body. This was read from the code, not measured on the wire.

## What the guard is

**`8167f7aa0`** adds the guard and the map.

- **One fact, stored in two files.** `NOTEBOOK_TYPE_SCHEMA` maps each type to the
  schema level that introduced it. It lives in
  `app/src/pages/journal-2-0/lib/notebookSchema.js` and in
  `api/services/journal_two/notebook_schema.py`.
  - Production's 28 nodes and 7 marks are level 0.
  - The six types above are level 1.
  - `tests/test_notebook_schema_guard.py` parses the JS table and asserts it
    equals the Python one.
- **The client declares what it can read.** Each body write sends
  `X-UCT-Notebook-Schema: <N>`. N is **derived** from the live editor schema: it
  is the largest N for which every table type at or below N is registered. N is
  never simply `max(table)`.
- **The server refuses stale writers.** `update_note` and `update_entry` refuse a
  body write when the maximum level over the **stored** body's types exceeds the
  declared N. The refusal is a 409 with the detail *"This note has content from a
  newer version of the app. Reload to edit it."*
  - A missing or unparseable header counts as 0.
  - A type the map does not know counts as 0.
  - Metadata-only writes are never checked.

**`fd87271fd`** adds two more doors that declare the schema, and makes the rail
rollback-safe.

- **Two more doors.** The importer's media rewrite (`lib/importer/commit.js`)
  and the enrichment undo (`revertChartEmbed`) both PUT a body. Both now send the
  header.
- **An enumerating rail.** The rail now finds every client body PUT through the
  AST, instead of naming the known ones.
- **A rollback-safe control.** The rail's non-vacuity control used to name wave-5
  types. It now names level-0 types, because the old version went red in the
  rolled-back state (see *Measured* below).

**`82c56dd63`** fixes the sender-vs-writer gap the whole-branch re-review found in
the guard above: `8167f7aa0`+`fd87271fd` judge the bundle that SENDS a body, never
the bundle that WROTE it, so a body captured offline by a stale bundle and sent
later by a fresh one could slip past the refusal. It stamps `writtenSchema` on
every capture that might be sent by a later page load and forwards it at
`min(stamp, sender's own level)`. It is load-bearing in every bundle that
declares level 1 or higher — see *"Why `82c56dd63` rides along"* below for the
rule and what it means for a full versus a partial rollback.

## Why `82c56dd63` rides along

The original guard (`8167f7aa0`+`fd87271fd`) judges the **sending** bundle's
level. `82c56dd63` fixes a hole the whole-branch re-review found: a body queued
by one bundle can be **sent later by a different one**, and the guard must judge
the bundle that **wrote** the body, not whichever bundle's turn it is to send it
— tracked as a `writtenSchema` stamp on every capture (the durable record, the
outbox entry, the crash draft), forwarded at `min(stamp, sender's own level)`.
An entry with no stamp reads as 0.

**The rule: every bundle that declares level 1 or higher must carry
`82c56dd63`.** The hole it closes needs exactly one thing to open — a sender
that declares a level the *writer* of a queued body could not read. A bundle
that declares ≥ 1 and lacks the stamp logic sends every queued entry, including
a stale tab's blank, at its own level, and the server accepts it. A bundle that
declares 0 cannot do that: it sends 0 from every door, stamp or no stamp, and a
level-1 note refuses it.

What that means for each rollback depth (the procedure above, measured 2026-09-28):

- **Down to `wave6`** (wave 5's squash is never reverted, so `82c56dd63` is in the tree). Through
  `wave7` the bundle registers every type and declares **2**. Through `wave6`, the level-1 types
  are all still registered and the level-2 types are not, so it declares **1** (measured: the
  level-1 and level-0 notes' body PUTs declared 1). A bundle declaring 1 or more is exactly the
  one the bold rule is about, and it carries `82c56dd63`.
- **Through `wave5`** every level-1 type is unregistered, and the declaration is the largest N
  whose every table type is registered, so the bundle derives **0** (measured: every body PUT the
  probe sent declared 0). A bundle that declares 0 is safe without `82c56dd63`. The commit is also
  NOT re-applied there, because it does not apply to that tree (*The keep-list*, 3). The
  never-revert set a rollback re-applies is therefore **two** commits: `8167f7aa0` and
  `fd87271fd`.
- ⛔ A revert that leaves only SOME level-1 types registered (reverting only G-064, say) does NOT
  derive 1. One unregistered level-1 type caps the declaration at 0 (*Coarse levels*, below).
  The only way to derive 1 or more is to keep every level-1 type, which means keeping wave 5's
  squash and, with it, `82c56dd63`.

⚰️ **What this section said until 2026-09-28, and why it was wrong.** It described the full
rollback as "Procedure A", which is now superseded (*History*), and ended: "Keeping it costs
nothing and keeps the never-revert set a single rule, which is why the banner says three
commits". It also said reverting only G-064 "still derives 1". Both were false:
- `82c56dd63` cannot be kept below wave 5 (it does not apply);
- one unregistered level-1 type makes the declaration 0, not 1.
A reader following that text on a stopped chain would hand-pick the commit and break the editor.

⚰️ **What this section said before the fix round's re-review, and why it was
wrong.** It argued that a rollback deploy is a bundle-transition window (no
service worker, so tabs do not all reload at once) in which a still-open wave-5
tab, acting as outbox leader, could drain a freshly rolled-back tab's queued
blank at its own level 1. But every still-open wave-5 tab *already carries*
`82c56dd63` — it is the current tip — and every rolled-back tab declares 0. So
that story only proves wave 5 must never **ship** without the commit, which it
does not; it says nothing about re-applying the commit in a rollback. It also
claimed "the rolled-back bundle does not need `82c56dd63`'s code", which is
false for the partial case above. The rule is the one in bold, and it needs no
window story at all. Reasoned, not measured: the simulation in *Measured* ran
before `82c56dd63` existed.

### Why the derived declaration keeps a rollback safe

After the features are reverted, the six level-1 types are still in the table but
no longer registered, so the bundle derives **N = 0**. The server then refuses
this bundle's body writes to any note whose stored body contains a level-1 type.
Notes with only level-0 types save normally.

A declaration hard-coded as `max(table)` would say 1 and let the blank write
through. That is the whole reason the declaration is derived.

⚠️ If a rollback drops the `editorSchema()` export from `tiptap.js` by mistake,
`declaredNotebookSchema()` catches the TypeError and declares 0
(`notebookSchema.js`, the `.catch(() => ... 0)` branch). The product stays safe.
The vitest rail goes red, because it imports `editorSchema`.


## The keep-list, and why each entry is on it

1. **Both schema tables, byte-identical to the tip, at every step.** A type missing from the table
   counts as level 0, which means "every client can read this". That is exactly how a note gets
   blanked (*Rules that outlive this wave*).
   - Measured: the wave-6 revert would remove the eight level-2 entries from both tables.
   - Measured: the wave-5 revert would delete both files (a modify/delete conflict).
   - The tool puts the tip's copies back in both cases. Every other step leaves the tables
     untouched.
   - The check after any step is `git diff <tip> HEAD -- <both tables>`, and it must print
     nothing.
   - **The two rails that test the tables stay at the tip with them** (`SCHEMA_RAILS`):
     `notebookSchema.rail.test.js` and `tests/test_notebook_schema_guard.py`.
     ⚰️ Measured in the first round of this rehearsal, the reverts brought back older copies of
     the rails while the tables stayed at the tip:
     - after the wave-6 revert, `notebookSchema.rail.test.js` came back at its wave-5 version and
       failed `declares the newest level when every type is registered`: it expected 1 and got 2;
     - after the `8167f7aa0` pick, `test_notebook_schema_guard.py` came back at its wave-5 version,
       which asserts that the table holds levels {0, 1} only.
     Those are red rails on a correct tree (`sandbox/p12-*`, `sandbox/p13b-*`). The second round,
     `chain/chain-primary-r2.jsonl`, keeps the rails at the tip. Its trees differ from round 1's
     only in those two test files, and every check-list run is green.
2. **`8167f7aa0` + `fd87271fd`, re-applied after wave 5's revert.** `8167f7aa0` is the guard
   itself: the server refusal and the derived declaration. Measured, its cherry-pick conflicts in
   three files:
   - the two tables: the tip's copies win, because they are a superset;
   - `tiptap.js`: the rolled-back side wins, and the one `editorSchema()` export the declaration
     reads is added back.
   `fd87271fd` applies cleanly: two more doors declare, and the rail is rollback-safe.
3. **`82c56dd63` rides along above wave 5, and is NOT re-applied below it.**
   - Measured: its cherry-pick onto the fully rolled-back tree conflicts in five files:
     `NoteEditorPage.jsx`, `recoverLocalState.js`, `useDurableNote.js`, and `noteContentGuard.js`
     with its test. Their context is wave-5 code that the revert removes: D3 adoption and the
     content guard.
   - Resolving each conflict to the rolled-back side does not work either. It leaves the commit's
     clean hunks using `OWN_READ`, `bodyWrittenSchema`, `isSchemaRefusal`, `keepRefusedWords` and
     `lowerStamp`, and nothing defines or imports them. The editor would throw a ReferenceError
     when it mounts (evidence `chain/82c56dd63-all-ours-leaves-undefined-names.txt`).
   - It is also not needed there: *Why `82c56dd63` rides along* shows that a bundle declaring 0
     is safe without it. At the wave-5 rollback the declaration of 0 was **measured on one door**,
     the editor's autosave: every body PUT the probe saw declared 0 (*Measured*). The other
     client body-PUT doors were **established by reading the code**, not measured. Every door
     goes through `notebookSchemaHeaders(forwarded)` (`lib/notebookSchema.js:186-191`, kept at
     the tip). With no argument it returns the derived level. With one, it returns
     `min(writtenSchemaOf(stamp), derived)`. So no door can declare more than the derived level,
     and a wave-5 rollback derives 0.
     - In the wave-5 rollback tree (`832bd5b759`), all five call it with no argument:
       - `hooks/useJ2Notes.js:164`;
       - `lib/importer/commit.js:437`;
       - `lib/importer/enrichment.js:84`;
       - `lib/offline/useOutboxDrain.js:111`;
       - the Model Book `UpbEntryPage.jsx:158`.
     - ⚠️ At the tip, and in every rollback above wave 5, two doors DO pass an argument:
       - `hooks/useJ2Notes.js:226-227`, the `forwarded` stamp;
       - `lib/offline/useOutboxDrain.js:118`, `{ writtenSchema: entry.writtenSchema }`.

       That is `82c56dd63`'s plumbing. The value is still capped at the derived level.
     - ⚰️ Fix round 1 said all five call it "with no argument" without naming the tree. That is
       true of the wave-5 rollback tree and false at the tip.
   - ⚰️ The earlier text of this runbook said to cherry-pick all three commits "in that order" and
     called the third "reasoned, not yet re-simulated". Measured now, that pick cannot be applied
     to the rolled-back tree.
4. **The server H14 hotfixes #204 and #203.**
   - #204 is the `BEGIN IMMEDIATE` compare-and-set lock on every read-then-write note door.
     Reverting it would bring back a lost-update race to take features away.
   - #203 is the depth cap, the Word intake and the PDF budget. Reverting it would bring back a
     note that answers 500 on every read.
   - Both were measured merge-clean at every step below them. The depth cap still refuses a
     60-deep body at every rehearsed step (*Measured*).
   - `--revert-hotfixes` reverts them too. That chain is also merge-clean, but it was built from
     objects only and never booted.
5. **`docs/`, `tools/`, `scripts/`, `CLAUDE.md` stay at the tip.**
   - Reverted with the squashes, they conflict at 9 of the 11 steps with later records.
   - They would delete this runbook.
   - They would remove the launcher's identity check and the instruments this procedure runs:
     `scripts/sandbox_identity.py` and `tools/notebook_perf_harness.py` came with wave 7.
   - ⚠️ Kept tools can import code the rollback removed. Measured by the chain's import lint:
     `tools/notebook_switch_rehearsal.py` imports `api.services.notebook_flags`, which is gone
     after the wave-8 revert. After the wave-6 revert, `tools/notebook_personal_api_walk.py`
     (`note_daily`) and `tools/note_tasks_bridge.py` (`note_tasks`) lose their imports the same way.
   - Those tools do not run against a rolled-back tree. The server never imports them.

6. **For one named landing only: `account_purge.py` and the rails that prove it**
   (`KEEP_WITH_LANDING` in the tool; today one entry, the wave 12-15 landing, key `W12-15`).
   - The landing adds twelve tables to the account-deletion list. A revert leaves the tables and
     the member rows in them; a reverted list would leave those rows behind when the member
     deletes their account. Kept at the tip, the list still names them.
   - Measured on the rolled-back tree: every module the tip's copy imports exists there, a
     deleted member's rows leave all twelve tables, and a pod that never created a table is a
     quiet no-op (`tests/test_notebook_rollback_never_revert.py`, which is kept with it).
   - ⛔ **Not kept at `W11` or below.** The tip's copy imports `voice_notes` (wave 11) and
     `account_tombstones` (wave 10 L1a). Kept under a revert of either, it would report an error
     on every deletion or fail to import. Those steps revert the file with the code, as they
     always have, and so they drop their own landing's rows from the list. For `W11` that is
     `j2_ai_change_sets` and `j2_ai_change_items`, and AI actions is armed in production. The
     lasting fix is on the product side (the table list kept apart from the code that reads it,
     so the list can be never-revert data like the schema tables). It is recorded as an open
     item in `landing-12-15-rollback.md`, not solved here.

## Measured, 2026-10-06: wave 11 #263 on top, from `f473d00b3` (lane ROLLBACK)

**The chain from `f473d00b3`** (`docs/notebook/evidence/rollback-rehearsal-2026-10-06-fin/chain/chain-through-wave5.jsonl`, the record the rail
rebuilds tree for tree):

| `--through` key | product conflicts | new since 2026-10-01 (R1h) |
|---|---|---|
| `W11` | 0 | the new top step. Wave 10's close (L16) and wave 11 in one squash: voice notes, formulas and rollups, AI actions, the trade-plan canvas. Its subject reads "Notebook: wave 10 close (L16) + wave 11 ...", so SUBJECT and PATH both select it. Its revert would also take schema level 3 (`tradeCanvas`) out of both tables; the tool puts the tip's copies back |
| `L15`...`wave5`, guards | unchanged | none: same rules, same pins |

- **All seventeen pins came back byte-identical** (`--record-pins --through wave5`, raw output
  `docs/notebook/evidence/rollback-rehearsal-2026-10-06-fin/chain/record-pins-output.json`).
- **The census of the window** (`docs/notebook/evidence/rollback-rehearsal-2026-10-06-fin/check-before-at-f473d00b3.log`, the unpatched tool's
  refusal): six commits selected. Wave 11 by subject and path; five more by path only
  (`c4d31ba61`, `dd7bf82c3`, `8881660a4`, `85ea66ccf`, `1368fbebe`), each read through its own
  diff and added to `REVIEWED_NOT_LANDINGS`. None edits Notebook-owned code.
- **Below wave 11 no Notebook file moved.** `test_under_wave_11_the_chain_differs_from_what_R1h_rehearsed_only_where_it_must`
  compares every lower step with R1h's record. The trees differ only in `docs/`, `tools/`,
  `scripts/`, `CLAUDE.md`, the two schema tables and their two rails (the newer tip's), and in
  the files other workstreams changed between L15 and wave 11, which no Notebook step reverts.
  The same rail checks that W11's revert left none of wave 11's own changes behind.
- **What this lane did not do.** No sandbox boot, so wave 11's revert was never served to a
  browser. It was not measured at production's tip (the banner at the top of this file says what
  is in the way). `docs/notebook/evidence/rollback-rehearsal-2026-10-06-fin/check-after-at-origin-master.log` is the tool saying so.
- **`--landing`, new.** One landing, the keep-list kept, no rules, fail closed. Railed on
  synthetic commits (a pending landing, a base that moved, a conflict, a later commit that
  merged clean, a merge commit, a landing that is not in the base). Mutation record:
  `docs/notebook/evidence/rollback-rehearsal-2026-10-06-fin/mutations-fin.log`.

## Measured, 2026-09-29: L2 #242 on top, from `f4cec49be` (lane R1b)

**The chain from the new tip** (`evidence/rollback-rehearsal-2026-09-29/chain/chain-through-wave5.jsonl`,
the record the rail rebuilds tree for tree):

| `--through` key | conflicts (all) / in shipped code | new since 2026-09-28 |
|---|---|---|
| `L2` | 0 / 0 | the new step. Its tree equals L2's parent outside `docs/`, `tools/`, `scripts/`, and differs from the tip in exactly L2's 46 shipped files |
| `L1c`, `225` | 0 / 0 | — |
| `L1b` | 3 / 2 | — (same rules, same pins) |
| `L1a` | 5 / 1 (`notebook_writing_help.py`) | **new rule**: TERM-078 (`948af2c17`) put one population-gate line inside L1a's property-autofill route. The route is L1a's own, so the hunk takes the pre-L1a side (`theirs`): the route goes whole. The `_population_gate` helper stays, because wave 7's stream route still calls it |
| `wave9`, `201` | 5 / 0, 0 / 0 | — |
| `wave8` | 7 / 4 | — (same rules, same pins) |
| `9C` | 6 / 0 | — |
| `wave7` | 13 / 3 | **two new rules** (modify/delete: wave 7 added both files, `948af2c17` edited both). `api/routers/notebook_writing_help.py` is deleted: it is wave 7's door, and its one later edit gates only that door. ⛔ `api/services/daily_counters.py` is KEPT (`ours`): TERM-078's `ai_population_cap.py` and the Compass caps' `compass_daily_caps.py` (`c7a8a7309`) import it at module level, and `journal_two.py` imports `compass_daily_caps`, so deleting it leaves a server that cannot import |
| `wave6` | 9 / 2 | — (same rules, same pins) |
| `wave5` + guards | 14 / 1; 5 / 1; 1 / 0 | **new rule**: TERM-089 (`c26c8f863`) appended its two `/api/wire/archive` rows to `tests/test_paywall_gate_free_tier.py` right after wave 5's five editor-widget rows. The pre-wave-5 side of the hunk is empty, so the resolution is exactly TERM-089's rows |

- **The ten pins recorded at `38bb9a421` came back byte-identical** from `f4cec49be`. Nothing that
  landed in between changed the lines of a conflict the chain already resolves.
- **A pin over a whole-file rule is now the previous step's file.** A modify/delete conflict leaves
  no conflict markers, so the hunk fingerprint was `sha256(b"")`, which matches every such conflict
  and can never stop the chain. The first record of the `daily_counters.py` rule came back
  `e3b0c44298fc1c14`, the empty hash. `_fingerprint` now pins `ours` the way it always pinned
  `delete`. A rail refuses an empty pin and a rule without a pin. Another rail edits
  `daily_counters.py` on top of the tip and watches the chain stop at wave 7.
- **The census of the new window, commit by commit** (`chain/census-38bb9a421..f4cec49be.txt`).
  It selected 13: L2 by subject and path, and 12 by path only. The 12 are in
  `REVIEWED_NOT_LANDINGS`, each with its reason. A rail derives the window from the tool's own
  census and fails on any selected commit that is neither in `CHAIN` nor reviewed. Another rail
  refuses a reviewed entry that the SUBJECT criterion selects, because that entry is a landing.
- ⚠️ **RAISED: `948af2c17` (TERM-078, AI meters and a population-wide cap) edits Notebook code and
  is not a Notebook landing.** It adds a dark population gate to the writing-help router
  (`notebook_writing_help.py`, both routes) and to the Ask door (`journal_two.py`), and adds
  `read()` to `daily_counters.py`. The L1a and wave-7 rules above resolve its lines. Two
  consequences outlive the rules:
  - its `ai_meters.py` lazily imports `api.services.journal_two.writing_help`, which the wave-7
    revert deletes (`evidence/.../objects.log`: the only new unresolved `api.*` import in any step
    tree, from `wave7` down). `meters_for` catches a failing meter and skips it. Measured on the
    sandbox (below): through `wave7`, `/api/ai-search/meters` still answers 200 JSON, and the log
    shows two meters dropped, `notebook_writing_help` (ImportError) and **`notebook_ask`
    (AttributeError: the wave-7 revert takes the `note_ask` constant the meter reads)**. So a member
    on a wave-7 rollback loses the Ask Notebook row from the AI allowances card while Ask itself
    stays. That is TERM-078's code, not this chain's: raised, not fixed here
    (`sandbox/ai-meters-warnings.log`);
  - **Expect these rails red in a rolled-back tree.** Neither was run there, because this lane
    runs pytest only on its own files, and neither is in step 2's list. Both were established from
    the objects and confirmed by the lane's reviewer:
    - `tests/test_ai_doors_census.py` (TERM-078), **from `L1a` down**. The L1a revert deletes
      `api/services/journal_two/property_autofill.py` (absent in tree `c8f7738a51`), and
      `ai_doors.py:94` still describes it as a door. From `wave7` down it also names the deleted
      writing-help router;
    - `api/services/journal_two/test_coach_chat_spend_caps.py:209` (`c7a8a7309`, the Compass
      caps), **from `wave7` down**. It patches `coach_chat_tools._TOOLS_UNGATED`, which the wave-7
      revert takes out of `coach_chat_tools.py`, so the test fails with an AttributeError.

**The sandbox rehearsal, 2026-09-29.** The method is lane R1's
(`evidence/rollback-rehearsal-2026-09-29/rehearse.py`, `probe.py`, `results.py`):
- four trees, each extracted with `git archive` and re-hashed IDENTICAL to its git tree: the tip
  `f4cec49be` (the control, which seeds the three fixture notes), through `L2`, through `L1a`
  (the new L1a rule) and through `wave7` (the two new wave-7 rules);
- one data dir, `C:\data-w10r1b` on :8231, with the Notebook gates at production's values;
- **every boot CLEAN** at pre-boot, +15 s, +120 s and shutdown, with 62 db files hashed. The
  launcher's identity was proven before each probe.

| step | L2 More-menu button | L1a autofill POST | wave-7 writing-help stream POST | TERM-078 meters (kept) | other doors | levels 2 / 1 / 0 notes |
|---|---|---|---|---|---|---|
| tip | 1 | 422, its own sentence | 422, its own sentence | 200 JSON | as on 2026-09-28's tip | PUT declares 2, 200, node/mark kept, words saved |
| through `L2` | **0** | 422 | 422 | 200 JSON | every door as on the tip | same as the tip |
| through `L1a` | 0 | **405, route gone** | 422 (wave 7's door stays) | 200 JSON | L1c recall 1 → 0, L1b SLO → HTML, L1a empty-text create 400 → 200, #225's skip link back to its pre-fix CSS; #203's depth cap still 400 | same |
| through `wave7` | 0 | 405 | **405, route gone** | **200 JSON** (two meters dropped, see above) | wave 7's personal tokens → HTML; wave 8's CSS doors gone; #203 still 400 | same (a wave-7 rollback declares 2) |

- The step-2 check list inside the three rollback trees: the schema diff is empty, and
  `test_notebook_schema_guard.py` gives 17 passed. The vitest list gives 272 passed (`L2`),
  244 (`L1a`) and 221 (`wave7`), the same counts as lane R1's for those depths.
- `objects.py` is an import lint over all 15 step trees of `--through wave5`. Every `api.*` import
  under `api/` resolves, except the `ai_meters.py` one above, from `wave7` down. It also checks the
  wave-5 rule's file: it parses, TERM-089's rows are kept in both tables, and wave 5's five rows are
  gone.
- Not booted: `wave6`, `wave5` and the guards. Their rules and pins are unchanged since 2026-09-28,
  except the wave-5 test-file rule, which touches no shipped code.
- In every boot, including the tip, the sandbox made real Anthropic calls, which were refused for
  credit balance. This comes from the launcher, not the chain. It is recorded, not investigated.

## Measured, 2026-10-01: L15 #262 on top, from `c75bf6ea0` (lane R1h)

**The chain from the new tip** (`evidence/rollback-rehearsal-2026-10-01-r1h/chain/chain-through-wave5.jsonl`,
the record the rail rebuilds tree for tree):

| `--through` key | product conflicts | new since 2026-10-01 (R1g) |
|---|---|---|
| `L15` | 0 | the new top step. Ships real `app/`/`api/` Notebook code (keyboard-access fixes, a PNG-export size guard, lane R1g's own rollback-chain work through L14) -- its squash subject reads "Notebook 10/10 wave 10 L15: ..." (kept "wave"), so SUBJECT selects it directly; no `CHAIN_BY_PATH_ONLY` exception needed |
| `L14`...`wave5`, guards | unchanged | -- (same rules, same pins) |

- **All eight pins recorded at `c75bf6ea0` came back byte-identical** from the new tip
  (`--record-pins --through wave5`, raw output
  `evidence/rollback-rehearsal-2026-10-01-r1h/chain/record-pins-output.json`). L15 reverts with
  zero conflicts of any kind -- not even against the hotfix's own `tests/test_tools_pin_the_root.py`
  edit the step below carries.
- **The census of the new window** (`evidence/rollback-rehearsal-2026-10-01-r1h/check-before.log`,
  the raw `--check` refusal before this lane's edit, from `origin/master` at `b529c8a786`): 2
  commits selected -- `L15` by subject AND path (a real landing, selected without any declared
  exception) and one more, `726586201` (feat(charts): Technical library Tier 1 -- 33 studies, 9 MA
  types, real fixed scales), by path only, older than L15, added to `REVIEWED_NOT_LANDINGS`. A rail
  derives the window from the tool's own census and fails on any selected commit that is neither in
  `CHAIN` nor reviewed.
- **`726586201` edits no Notebook-owned code**: its only touch among shared files is
  `app/src/pages/Settings.jsx`, widening the Moving Average overlay's type `<select>` from a
  hardcoded SMA/EMA pair to the full `MA_TYPES` kit for an adopted (engine-instance) overlay slot;
  every other file it ships (`movingAverages.js`, `technicalStudies.js`, `technicalCategories.js`,
  `indicatorCatalog.js`, the chart engine's `readout`/`sourceRef`/`registrySizes` modules, their
  tests, a decision-record doc) sits outside the derived Notebook set.
- **`MEASURED_AT` moves to `b529c8a786` (L15's own sha)**, not past it as L14's move was: L15 is
  the newest commit the census selects in this window and is itself the tip -- no
  `REVIEWED_NOT_LANDINGS` commit lands after it here, unlike the hotfix that trailed L14.
- `origin/master` had not moved further than `b529c8a786` by the time this lane's `--check
  --from origin/master` was re-read after the edit (`evidence/rollback-rehearsal-2026-10-01-r1h/check-origin-master-after.log`),
  so there is nothing further to carry into a future lane's scope statement.

**The sandbox rehearsal, 2026-10-01 (lane R1h).**
`evidence/rollback-rehearsal-2026-10-01-r1h/rehearse.py` (same method as R1's through R1g's) and
`probe.py` (imports R1g's probe for the never-revert set, the per-landing doors, L7's door, L12's
sort door, L10's template door, L13's analyst-consensus door and L14's two doors; adds three of
L15's four doors, exercised behaviourally in a real browser against the real served bundle):

| L15 door | tip | through `L15` | through `L14` |
|---|---|---|---|
| `/journal/notebook?view=graph` renders the graph canvas, not Research Home | **graph canvas** | **Research Home** | **Research Home** |
| A real Shift+/ keypress opens the Keyboard Shortcuts dialog | **opens** | **nothing** | **nothing** |
| FuturesStrip's TickerPopup tile carries `tabIndex=0`; Enter opens its chart dialog | **tabIndex=0, opens** | **no tabIndex, nothing** | **no tabIndex, nothing** |

The fourth door -- the PNG export size guard's own refusal text
(`"...too long for one PNG image..."`, `exportNote.js`) -- is checked against the BUILT
`app/dist/assets/*.js` output for each tree (`evidence/rollback-rehearsal-2026-10-01-r1h/sandbox/<step>/png-guard-dist-check.json`),
never by clicking PNG export on a note tall enough to need it: reverting L15 removes the guard
entirely (its own first sub-commit is what introduces any size check at all), so the pre-L15 code
has no guard and would attempt a real, unguarded, multi-hundred-megapixel canvas allocation in the
browser -- precisely the bug this landing fixes -- which this rehearsal does not reproduce three
times against this box's own memory budget. Present at the tip
(`NotebookFlagGate-CssHds9m.js`), absent through both `L15` and `L14`.

All three boots CLEAN at every checkpoint (pre-boot, +15s, +120s, shutdown; 62 db files hashed
each time). Every earlier landing's door (L1a through L14) and the never-revert set behave
identically at all three steps -- L14's two doors (the locked-note append refusals, the public-
route intro-skip) stay ACTIVE at the tip and through `L15` (L14 itself is still live at that step)
and flip to their pre-L14 state only once the chain reaches through `L14`, exactly R1g's own
measurement. Zero page errors at any step. Full table:
`evidence/rollback-rehearsal-2026-10-01-r1h/sandbox-results.md`.

## Measured, 2026-10-01: L14 #260 + hotfix #261 on top, from `a680b0d40` (lane R1g)

**The chain from the new tip** (`evidence/rollback-rehearsal-2026-10-01-r1g/chain/chain-through-wave5.jsonl`,
the record the rail rebuilds tree for tree):

| `--through` key | product conflicts | new since 2026-09-30 (R1f) |
|---|---|---|
| `L14` | 1 (`tests/test_tools_pin_the_root.py`) | the new top step. Ships real `app/`/`api/` Notebook code (public links skip the intro, locked notes refuse captures, links open, tools kept off live data) -- its squash subject reads "Notebook 10/10 wave 10 L14: ..." (kept "wave"), so SUBJECT selects it directly; no `CHAIN_BY_PATH_ONLY` exception needed. **New rule**: hotfix #261 (`c75bf6ea0`, REVIEWED_NOT_LANDINGS, one commit above MEASURED_AT) further edits `tests/test_tools_pin_the_root.py` (L14's own tools-census-pin rail file); a real modify/delete conflict, resolved `"ours"` (keep the hotfix's newer, non-Notebook test-rail work -- same shape as wave 7's `daily_counters.py` rule) |
| `L13`...`wave5`, guards | unchanged | -- (same rules, same pins) |

- **All seven pins recorded at `a680b0d40` for the steps below L14 came back byte-identical**
  from the new tip (`--record-pins --through wave5`, raw output
  `evidence/rollback-rehearsal-2026-10-01-r1g/chain/record-pins-output.json`). L14's own revert is
  **not** conflict-free -- one new rule and one new pin, `RULES["0e7d0561a"]["tests/test_tools_pin_the_root.py"] = "ours"`.
- **The census of the new window** (`evidence/rollback-rehearsal-2026-10-01-r1g/check-before.log`,
  the raw `--check` refusal before this lane's edit, from `origin/master` at `c75bf6ea0` before a
  later, unrelated Pine merge wave landed): 5 commits selected -- `L14` by subject AND path (a real
  landing, selected without any declared exception) and four more Terminal TERM-067 accessible-name
  commits by path only (`f771f3d0b` Admin + Desk team form, `9601fe2c2` a Textarea primitive + Model
  Book, `3735184f7` the whole Settings page, `79e16f694` Input/Select/Checkbox/FieldError + density
  tokens), each touching exactly one shared file already in the derived Notebook set. A fifth
  commit, the hotfix `c75bf6ea0` itself, was NOT yet selected at that census run (it only becomes
  selectable once L14's own `tests/test_tools_pin_the_root.py` joins the derived Notebook set);
  re-running `--check` after adding `L14` to `CHAIN` selects it too, by path. All five added to
  `REVIEWED_NOT_LANDINGS`. A rail derives the window from the tool's own census and fails on any
  selected commit that is neither in `CHAIN` nor reviewed.
- **None of the four TERM-067 commits edits Notebook-owned code**: each touches its one shared file
  (`desk/TeamSection.jsx`, `Settings.jsx` twice, `tokens.css`) purely to add an accessible name or a
  UI primitive/density token -- read via their own diffs and commit messages.
- **`MEASURED_AT` moves to `c75bf6ea0` (the hotfix), not to `L14`'s own sha** -- a
  `REVIEWED_NOT_LANDINGS` entry must fall inside the window the rail checks
  (`WAVE5^..MEASURED_AT`), and the hotfix is one commit above L14. The rail's own invariant was
  generalised accordingly: the newest `CHAIN` landing must be an ancestor of (or equal to)
  `MEASURED_AT`, not literally equal to it (`tests/test_notebook_rollback_chain.py::test_every_commit_since_the_previous_measurement_is_in_CHAIN_or_reviewed`).
- ⚠️ **`origin/master` moved 46 commits further during this lane** (an unrelated Pine
  vendor-harness/runtime merge wave, `19bcbf278c`..`46f54d80b5`). None of it is selected by the
  census -- `--check --from origin/master` still reports `current` against the live tip
  (`evidence/rollback-rehearsal-2026-10-01-r1g/check-origin-master-after.log`). Extending the chain
  to cover it is out of this lane's scope; the next lane re-reads `--check` from the live tip.

**The sandbox rehearsal, 2026-10-01 (lane R1g).**
`evidence/rollback-rehearsal-2026-10-01-r1g/rehearse.py` (same method as R1's through R1f's) and
`probe.py` (imports R1f's probe for the never-revert set, the per-landing doors, L7's door, L12's
sort door, L10's template door and L13's analyst-consensus door; adds L14's two doors). First
attempt at `s-L14` collided with another session's sandbox that had independently bound the same
port (8231) in the 8230-8250 band; the identity proof refused to write and named the mismatch
(`http://127.0.0.1:8231 is a hub sandbox, but not the one that writes ...`) -- moved to port 8242
and re-ran clean. Full table:
`evidence/rollback-rehearsal-2026-10-01-r1g/sandbox-results.md`.

## Measured, 2026-09-30: L13 #259 on top, from `599cd44f1` (lane R1f)

**The chain from the new tip** (`evidence/rollback-rehearsal-2026-09-30-r1f/chain/chain-through-wave5.jsonl`,
the record the rail rebuilds tree for tree):

| `--through` key | product conflicts | new since 2026-09-30 (R1e) |
|---|---|---|
| `L13` | 0 | the new top step. Ships real `app/`/`api/` Notebook code (G-062 analyst-consensus capture, smoke + master-red fixes) -- its squash subject reads "Notebook 10/10 wave 10 L13: ..." (kept "wave"), so SUBJECT selects it directly; no `CHAIN_BY_PATH_ONLY` exception needed |
| `L12`...`wave5`, guards | unchanged | -- (same rules, same pins) |

- **All seven pins recorded at `599cd44f1` came back byte-identical** from the new tip
  (`--record-pins --through wave5`, raw output
  `evidence/rollback-rehearsal-2026-09-30-r1f/chain/record-pins-output.json`). L13 reverts with
  zero conflicts of any kind -- not even a doc-only one.
- **The census of the new window** (`evidence/rollback-rehearsal-2026-09-30-r1f/check-before.log`,
  the raw `--check` refusal before this lane's edit): 2 commits selected -- `L13` by subject AND
  path (a real landing, selected without any declared exception) and one more, `69beea8d1`
  (Terminal TERM-073, the nightly analyst-revisions "what changed" timeline, dark), by path only,
  added to `REVIEWED_NOT_LANDINGS`. A rail derives the window from the tool's own census and fails
  on any selected commit that is neither in `CHAIN` nor reviewed.
- **`69beea8d1` edits no Notebook-owned code**: its only touch among shared files is one router
  mount in `api/main.py` behind `ANALYST_REVISIONS_ENABLED`; its own router, service and panel
  files are all outside the derived Notebook set.

**The sandbox rehearsal, 2026-09-30 (lane R1f).**
`evidence/rollback-rehearsal-2026-09-30-r1f/rehearse.py` (same method as R1's, R1b's, R1c's, R1d's
and R1e's) and `probe.py` (imports R1e's probe for the never-revert set, the per-landing doors,
L7's door, L12's sort door and L10's template door; adds L13's door -- `POST
/api/j2/notes/{id}/facts` with `factType=analyst_price_target_consensus`, accepted (200,
`rightsClass=conditional`/`temporalMode=snapshot`/`source=fmp`) at the tip and refused (400, the
pre-G-062 inactive-type rejection) once L13 is reverted). Full table:
`evidence/rollback-rehearsal-2026-09-30-r1f/sandbox-results.md`.

## Measured, 2026-09-30: L9 #256 + L10 #257 + L12 #258 on top, from `6f563c158` (lane R1e)

**The chain from the new tip** (`evidence/rollback-rehearsal-2026-09-30-r1e/chain/chain-through-wave5.jsonl`,
the record the rail rebuilds tree for tree):

| `--through` key | product conflicts | new since 2026-09-29 (R1d) |
|---|---|---|
| `L12` | 0 | the new top step. Ships real `app/`/`api/` Notebook code (silent failures, the server-side `updated_asc`/`title_desc` sort toggle, typing fixes, the quote-in-list disable) -- its squash subject reads "Notebook w10 L12: ..." (drops "wave"), so SUBJECT still does not select it; in CHAIN by path |
| `L10` | 0 | the second new step. Ships real `app/`/`api/` Notebook code (the 25-template gallery, design-review close-out) -- same subject-format reason as L12, in CHAIN by path |
| `L9` | 0 | the third new step. Ships zero `app/` or `api/` file at all (the rollback tool's own coverage for L6/L7/L8 -- R1d's own PR, merged after R1d wrote `MEASURED_AT=6f563c158`); in CHAIN by path, same reason as L6/L8 |
| `L8`...`wave5`, guards | unchanged | -- (same rules, same pins) |

- **All sixteen pins recorded at `8d08da86f` came back byte-identical** from the new tip
  (`--record-pins --through wave5`, raw output
  `evidence/rollback-rehearsal-2026-09-30-r1e/chain/record-pins-output.json`). Nothing that landed
  between `6f563c158` and `599cd44f1` changed the lines of a conflict the chain already resolves.
- **The census of the new window** (`evidence/rollback-rehearsal-2026-09-30-r1e/check-before.log`,
  the raw `--check` refusal before this lane's edit): 12 commits selected -- `L12`, `L10` and `L9`
  by path only (real landings, declared in `CHAIN_BY_PATH_ONLY` -- see the tool's own comment), and
  9 more by path only, all added to `REVIEWED_NOT_LANDINGS` with a reason apiece. A rail derives the
  window from the tool's own census and fails on any selected commit that is neither in `CHAIN` nor
  reviewed.
- **None of the 9 reviewed commits edits Notebook-owned code** (no `app/src/pages/journal-2-0/**`,
  no `api/services/journal_two/**`, no `notebook_*.py` router). Two were handed down already ruled
  by the controller and reverified here by reading them: `df82f7a1e` (a revert of another
  workstream's wave-3 Pine-engine integrate merge `a3afa840d` -- a 2-parent merge commit, never
  itself selected by the census) and `da7d23f49` (a clock/build-budget perf commit sharing
  `vite.config.js`'s manifest-stripping plugin). `ae60a34b3` is the mirror-image reapply of
  `df82f7a1e`'s own revert (the same workstream toggling itself), read side by side with it and
  confirmed byte-identical except for the one async/await pairing each one flips.

**The sandbox rehearsal, 2026-09-30 (lane R1e).**
`evidence/rollback-rehearsal-2026-09-30-r1e/rehearse.py` (same method as R1's, R1b's, R1c's and
R1d's) and `probe.py` (imports R1d's probe for the never-revert set, the per-landing doors and L7's
door; adds L12's door -- `sort=updated_asc` on `GET /api/j2/notes`, honored at the tip and fallen
back to `updated_at DESC` through `L12` and through `L10` -- and L10's door -- the template
gallery's `[data-template-card]` count, 27 at the tip and through `L12`, 11 through `L10`, gone
exactly at L10's own step; L9 ships no door, verified as a pure behaviour-preservation check like
L6's and L8's). Full table: `evidence/rollback-rehearsal-2026-09-30-r1e/sandbox-results.md`.

## Measured, 2026-09-29: L6 #253 + L7 #254 on top, from `8d08da86f` (lane R1d)

**The chain from the new tip** (`evidence/rollback-rehearsal-2026-09-29-r1d/chain/chain-through-wave5.jsonl`,
the record the rail rebuilds tree for tree):

| `--through` key | conflicts (all) / in shipped code | new since 2026-09-29 (R1c) |
|---|---|---|
| `L7` | 0 / 0 | the new top step. Its tree equals L7's parent outside `docs/`, `tools/`, `scripts/`, and differs from the tip in exactly L7's own shipped files (three touch-tier CSS floors + the proof-walk instrument) |
| `L6` | 0 / 0 | the second new step. Ships no `app/` or `api/` file at all (rollback-chain tooling + rehearsal evidence for L4/L5, a restore-drill fix, proof-walk evidence); its revert is a no-op for members and, measured, conflict-free |
| `L5`, `L2`, `225` | 0 / 0 each | -- (same rules, same pins) |
| `L4` | 2 / 0 | both conflicts are `KEEP_PATHS` (`docs/notebook/wave5-rollback.md`, `tools/notebook_rollback_chain.py`, this lane's own edits) restored to the tip's copy -- no product conflict, no new rule |
| `L1c` | 8 / 0 | -- (same rules, same pins) |
| `L1b` | 4 / 2 | -- (same rules, same pins) |
| `L1a` | 6 / 1 | -- (same rule, same pin) |
| `wave9`, `201` | 5 / 0, 0 / 0 | -- |
| `wave8` | 8 / 5 | -- (same rules, same pins) |
| `9C` | 7 / 0 | -- |
| `wave7` | 13 / 3 | -- (same rules, same pins) |
| `wave6` | 9 / 2 | -- (same rules, same pins) |
| `wave5` | **15 / 2** | **new rule**: TERM-038 (8393002716, REVIEWED_NOT_LANDINGS) built its dark "saved things" palette rows INSIDE the same functions wave 5's own quick-switcher introduced in `app/src/components/CommandPalette.jsx` -- seven conflict hunks, none separable (TERM-038's added lines are single statements inside wave-5-authored function bodies, not lines beside them). Ruled "ours" (keep the whole file as the accumulated tree has it), the same shape as wave 7's `api/services/daily_counters.py` rule below |
| guards | 5 / 1; 1 / 0 | -- (same rule, same pin) |

- **All fifteen pins recorded at `0812b5ec3` came back byte-identical** from the new tip
  (`--record-pins --through wave5`, raw output
  `evidence/rollback-rehearsal-2026-09-29-r1d/chain/record-pins-output.json`). Nothing that
  landed between `0812b5ec3` and `8d08da86f` changed the lines of a conflict the chain already
  resolves, except the one new CommandPalette.jsx conflict above.
- **The census of the new window, commit by commit**
  (`evidence/rollback-rehearsal-2026-09-29-r1d/check-origin-master-before.log`, the raw `--check`
  refusal before this lane's edit). It selected 6: `L7` by subject and path, `L6` by path only (a
  real landing, declared in `CHAIN_BY_PATH_ONLY` -- see the tool's own comment), and 4 more by path
  only. The 4 are in `REVIEWED_NOT_LANDINGS`, each with its reason. A rail derives the window from
  the tool's own census and fails on any selected commit that is neither in `CHAIN` nor reviewed.
- **None of the 4 reviewed commits edits Notebook-owned code** (no `app/src/pages/journal-2-0/**`,
  no `api/services/journal_two/**`, no `notebook_*.py` router). One, TERM-038 (`8393002716`),
  edits a file the chain's own reverts also touch (`app/src/components/CommandPalette.jsx`, the
  new wave-5 conflict above); one, `9633d68e8`, is the RE-LAND of the H15 rollback `1be4b9a2b`
  already reviewed above -- a different "wave 2" (the Pine vendor-harness / deploy-integration
  branch, not a Notebook wave), confirmed by reading `1be4b9a2b`'s own commit message and diffing
  both commits' hunks on `reachable.test.js` and `vite.config.js` side by side (exact mirror
  images).

**The sandbox rehearsal, 2026-09-29 (lane R1d).** `evidence/rollback-rehearsal-2026-09-29-r1d/rehearse.py`
(same method as R1's, R1b's and R1c's) and `probe.py` (imports R1c's probe for the never-revert
set, the per-landing doors, L4's door and L5's behaviour-preservation check; adds L6's own check --
a pure BEHAVIOUR-preservation check like L5's, since L6 ships no door to remove: the `--check`
CLI's own verdict, run inside each tree, must read `"current"` at that tree's own `MEASURED_AT` --
and L7's door, the touch-tier CSS floor on NoteFindBar's Find input (`min-height` at the
touch tier), present (44px) at the tip and absent (18px) through both `L7` and `L6`, gone exactly
at L7's own step). Full table: `evidence/rollback-rehearsal-2026-09-29-r1d/sandbox-results.md`.

## Measured, 2026-09-29 (round 2): L8 #255 on top, from `6f563c158` (lane R1d, continued)

L8 landed on master while this lane was mid-rehearsal (controller note); this round covers just
that one new step. Same shape as L6: zero `app/` or `api/` files shipped (the diff is entirely
`docs/notebook/**`, `tests/test_parity_scorecard.py`, `tools/parity_scorecard.py` and
`tools/notebook_wh_writing_help_prod_check.py`), selected by PATH only, no door of its own.

- **The chain from `origin/master`** (`5b4da7874` at measurement time -- one unrelated breadth
  commit past `MEASURED_AT` itself, selected by neither census criterion): `--through wave5`
  builds end to end, exit 0
  (`evidence/rollback-rehearsal-2026-09-29-r1d/chain/chain-through-wave5.jsonl`, regenerated).
  `--record-pins --through wave5` returns all **sixteen** pins recorded at `8d08da86f`
  byte-identical -- L8 and the one reviewed commit alongside it (`cd9ecc833`, Fundamentals V5,
  touching only a lifespan scheduler-registration block in `api/main.py`) introduce **zero** new
  conflicts anywhere in the chain.
- **The census of the new window** (`8d08da86f..6f563c158`) selected exactly two: `L8` by path
  (added to `CHAIN`, `CHAIN_BY_PATH_ONLY`) and `cd9ecc833` by path (added to
  `REVIEWED_NOT_LANDINGS`).
- **The sandbox rehearsal** (`evidence/rollback-rehearsal-2026-09-29-r1d/rehearse_round2.py`, its
  own data dir `C:\data-w10r1d-2` : 8240 so it never collides with round 1's boots): the new tip
  `s01-tip2` (`6f563c158`, includes L8 + the dark Fundamentals V5 work) and `s-L8`
  (`--through L8`), both extracted trees IDENTICAL to their git trees, both boots CLEAN. `s01-tip2`
  reproduces round 1's tip exactly (L7's door 44px, every earlier landing's probe byte-identical).
  `s-L8` is byte-identical to `s01-tip2` on every shared probe (landings, the never-revert set,
  L7's door still 44px, unaffected) -- L8 has no door of its own to lose, so "identical" IS the
  expected result, the same shape as L6's own rehearsal in round 1.
- **`--check --from origin/master` reports `current`** at `MEASURED_AT` `6f563c158`
  (`evidence/rollback-rehearsal-2026-09-29-r1d/check-origin-master-round2-after.log`).

## Measured, 2026-09-29: L4 #251 + L5 #252 on top, from `0812b5ec3` (lane R1c)

**The chain from the new tip** (`evidence/rollback-rehearsal-2026-09-29-r1c/chain/chain-through-wave5.jsonl`,
the record the rail rebuilds tree for tree):

| `--through` key | conflicts (all) / in shipped code | new since 2026-09-29 (R1b) |
|---|---|---|
| `L5` | 0 / 0 | the new top step. Its tree equals L5's parent outside `docs/`, `tools/`, `scripts/`, and differs from the tip in exactly L5's own shipped files |
| `L4` | 0 / 0 | the second new step. Same shape: 0 conflicts. Carries `scripts/hub_sandbox_boot.py` / `hub-sandbox.ps1` (lane SK, the sandbox model-key policy) -- already covered by the existing `KEEP_PATHS` rule; see the SK note in the banner above |
| `L2`, `L1c`, `225` | 0 / 0 each | -- (same rules, same pins) |
| `L1b` | 3 / 2 | -- (same rules, same pins) |
| `L1a` | 6 / 1 | -- (same rule, same pin) |
| `wave9`, `201` | 5 / 0, 0 / 0 | -- |
| `wave8` | **8 / 5** | **new rule**: TERM-039 (e90fddc34, REVIEWED_NOT_LANDINGS) added a `FeatureStatusStrip` import + render to `app/src/pages/Support.jsx` right after wave 8's own two notebook-article imports. The hunk's "ours" side (the current tree) carries all three imports; the resolution drops only wave 8's own two lines (`ours_drop`) and keeps TERM-039's import, which is not this landing's to revert |
| `9C` | 6 / 0 | -- |
| `wave7` | 13 / 3 | -- (same rules, same pins) |
| `wave6` | 9 / 2 | -- (same rules, same pins) |
| `wave5` + guards | 14 / 1; 5 / 1; 1 / 0 | -- (same rule, same pin) |

- **All eleven pins recorded at `f4cec49be` came back byte-identical** from the new tip
  (`--record-pins --through wave5`, raw output
  `evidence/rollback-rehearsal-2026-09-29-r1c/chain/record-pins-output.json`). Nothing that
  landed between `f4cec49be` and `0812b5ec3` changed the lines of a conflict the chain already
  resolves, except the one new Support.jsx conflict above.
- **The census of the new window, commit by commit**
  (`evidence/rollback-rehearsal-2026-09-29-r1c/check-origin-master-before.log`, the raw `--check`
  refusal before this lane's edit). It selected 15: `L5` and `L4` by subject and path, and 13 by
  path only. The 13 are in `REVIEWED_NOT_LANDINGS`, each with its reason. A rail derives the
  window from the tool's own census and fails on any selected commit that is neither in `CHAIN`
  nor reviewed.
- **None of the 13 path-only commits edits Notebook-owned code** (no
  `app/src/pages/journal-2-0/**`, no `api/services/journal_two/**`, no `notebook_*.py` router) --
  unlike R1b's `948af2c17` (TERM-078), nothing here is RAISED as editing Notebook code. One of the
  13, TERM-039 (`e90fddc34`), edits a file the chain's own reverts also touch
  (`app/src/pages/Support.jsx`), which is exactly the new conflict above -- reported, not buried.
- **SK, raised not silently decided:** see the banner above and the keep-list, item 4.

**The sandbox rehearsal, 2026-09-29 (lane R1c).** `evidence/rollback-rehearsal-2026-09-29-r1c/rehearse.py`
(same method as R1's and R1b's) and `probe.py` (imports R1's probe for the never-revert set and
the per-landing doors; adds L4's own door -- `button[data-format-toggle]`, the phone format
disclosure (D3P), present at the tip and through `L5`, gone through `L4` -- and an L5
behaviour-preservation check, since L5 is a pure query optimisation with no removable door:
`GET /api/j2/notes/backlinks?symbol=` must answer the identical shape before and after its
revert). Full table: `evidence/rollback-rehearsal-2026-09-29-r1c/sandbox-results.md`.

- `git archive` extraction + re-hash verified **IDENTICAL** for the tip (`s00-tip`, 17,102 files),
  `--through L5` (`s-L5`, 17,101 files) and `--through L4` (`s-L4`, 17,096 files).
- **All three boots CLEAN**: pre-boot, +15s, +120s and shutdown, 62 db files hashed each time, one
  data dir (`C:\data-w10r1c` :8238) seeded by the tip boot so every rolled-back server read data
  the tip had written.
- **L4's door** (`button[data-format-toggle]`): 1 at the tip, 1 through `L5`, **0** through `L4` --
  gone exactly at L4's own step.
- **L5's behaviour-preservation check**: the symbol-backlinks endpoint answers the identical shape
  and value (`count: 0`, same keys) at the tip, through `L5` and through `L4` -- consistent with
  L5 being a pure query optimisation with no door to remove.
- **The never-revert set** (three fixture notes, levels 0/1/2): identical at every step -- the
  level-2 note declares schema 2, its PUT answers 200, the stored body keeps its node and the
  typed words, at the tip, through `L5` and through `L4`.
- **Every earlier landing's door** (`w8_share_links`, `w7_personal_tokens`, `w6_note_templates`,
  `L1b_admin_notebook_slo`, etc.) answers identically at all three steps -- correct, since neither
  L5 nor L4 reverts anything below them.
- **The step-2 check list inside all three trees**: the schema diff against the tip is EMPTY,
  `tests/test_notebook_schema_guard.py` gives 17 passed, and the vitest list gives 272 passed --
  the same counts as lane R1b's at `L2` depth, since neither L5 nor L4 changes that file set.
- ⚠️ **Mid-lane refusal, resolved before the results above.** The first attempt hit the box's `C:`
  drive at **0 bytes free, machine-wide** (`Get-Volume C`), partway through extracting the third
  tree -- reported as a refusal and NOT worked around (nothing outside this lane's own,
  already-logged scratch extractions was deleted to try to make room). Free space returned on its
  own (measured ~142 GB, not this lane's doing); this lane's own scratch extraction directory was
  separately found wiped by an unrelated concurrent session's own cleanup before the successful
  re-run. Full account: `evidence/rollback-rehearsal-2026-09-29-r1c/sandbox/BLOCKED-disk-exhaustion.md`.

## Measured, 2026-09-28: every step, on a sandbox (lane R1, scorecard clause 3b)

**Method.**
- The chain was built from objects at `origin/master` `38bb9a421`
  (round 1: `chain/chain-primary.jsonl`). Round 2 is `chain/chain-primary-r2.jsonl`, which
  `tools/notebook_rollback_chain.py` writes and its rail rebuilds tree for tree.
- Each step's tree was taken with `git archive`, re-hashed file by file, and was IDENTICAL to its
  git tree (`sandbox/extract-verify.log`).
- Each tree built its own `app/dist` and booted with `scripts/hub_sandbox_boot.py`.
- All boots used ONE data dir, `C:\data-w10rb` on :8229, that the tip boot seeded first. So every
  rolled-back server read data the tip had written, the way a real rollback does.
- The Notebook gates were set to production's armed values for every boot. A door that disappears
  is therefore absent, not switched off.
- **19 boots (17 in round 1, 2 in round 2), every one CLEAN** at pre-boot, +15 s, +120 s and shutdown, with 62 db files hashed
  each time. The integrity verdict is the first line of each `sandbox/<label>/sandbox-integrity.txt`.
- Raw data: `sandbox-results.md`, and `probe.json` plus screenshots per boot.

**The chain, and each landing's door.** A GET door counts only when it answers JSON: an
unmounted `/api` path gets `200 text/html` from the SPA catch-all, so "HTML" below means the route
is gone.

| `--through` key | reverts | merge conflicts (all) / in shipped code | schema tables | the door that left, tip → this step |
|---|---|---|---|---|
| `L1c` | L1c `38bb9a421` | 0 / 0 | untouched | the switcher finds a word that is only in a note's body: 1 match → 0 |
| `225` | #225 `4bba30b73` | 0 / 0 | untouched | the Notebook's skip link, unfocused: `pointer-events: none` → `auto` (the pre-fix CSS) |
| `L1b` | L1b `d9e887ca0` | 3 / 2 (`CommandPalette.jsx`, `tests/test_alert_destination.py`: later Terminal work on the same lines, resolved by rule) | untouched | `GET /api/admin/notebook-slo`: 200 JSON → HTML (gone) |
| `L1a` | L1a `4f708a0d2` | 4 / 0 | untouched | `POST /api/j2/notes` with an empty text node: 400 → 200 (no longer refused) |
| — | #204, #203 | kept | — | #203's depth cap still refuses a 60-deep body: **400 at every step** |
| `wave9` | wave 9 `1c4b0bf74` | 5 / 0 | untouched | `batch/export?format=__bogus__`: 422 → 200 |
| `201` | #201 `7e3f9e117` | 0 / 0 | untouched | the pane heading after a mouse click: `position: absolute` → `static` (the pre-fix CSS) |
| `wave8` | wave 8 `caf6d1b9e` | 7 / 4 (`api/main.py`, `api/routers/auth.py`, two files #200 had touched) | untouched | `GET /api/j2/share/links` and `/api/j2/publish`: 200 JSON → HTML |
| `9C` | 9C `2e0598bfa` | 6 / 0 | untouched | `GET /api/admin/notebook-soak`: 422 JSON → HTML |
| `wave7` | wave 7 `f883e0996` | 11 / 1 (`api/main.py`) | untouched | `GET /api/j2/personal/tokens`: 200 JSON → HTML |
| `wave6` | wave 6 `271a078b6` | 9 / 2 (`api/main.py`, `client_errors.py`) | **the revert would drop the 8 level-2 entries; the tip's tables were put back** | `GET /api/j2/note-templates`: 200 JSON → HTML |
| `wave5` | wave 5 `2c3ed3093`, then `8167f7aa0`, `fd87271fd` | 13 / 0 (the tables and their rails, kept at the tip by rule); `8167f7aa0` 5 / 1 (`tiptap.js`; the rest kept by rule); `fd87271fd` 1 / 0 (a kept rail) | **the revert would delete both; the tip's tables and rails were put back** | `GET /api/j2/notes/switcher`: 200 JSON → 404 |

Counts are round 2's (`chain/chain-primary-r2.jsonl`; round 1 is `chain/chain-primary.jsonl`,
which differs only at `wave6` and `wave5`). Every conflict outside shipped code was in `docs/`,
`tools/`, `scripts/`, `CLAUDE.md`, or the two schema tables and their two rails. Those paths are
kept by rule, so those conflicts are never resolved at all. The resolutions for shipped
code are `RULES` in `tools/notebook_rollback_chain.py`, measured at `38bb9a421`.

**Each landing's door FIRST moved at its own step.** Every door of a landing not yet reverted
still answered as it does on the tip at every step before its own (`sandbox-results.md` §A).
Two doors move a second time, at the wave-5 step, because the routes they ride on were created by
wave 5: L1c's switcher-recall door goes 200 → 404, and wave 9's export-format door goes 200 → 405. The kept #203 depth cap answered 400 from the tip down
to the wave-5 rollback.

**The never-revert set, per step.** Three notes were created on the TIP: level 0 (text only),
level 1 (a `highlight` mark, wave 5) and level 2 (a `tableOfContents` node, wave 6). Each step
opened them in its own served editor, typed into them, and read them back.

| steps | level-2 note | level-1 note | level-0 note |
|---|---|---|---|
| the tip, and every rollback down to `wave7` | opens; body PUT declares **2**; 200; node kept, words saved | same, declares 2 | same, declares 2 |
| through `wave6` | **locked**: "…newer version of the app. Reload to edit it."; not editable; **no PUT sent**; node kept | opens; PUT declares **1**; 200; mark kept, words saved | declares 1; 200; words saved |
| through `wave5` (guard re-applied) | PUT declares **0**; **409 twice in the 7 s watched, no third send**; the refusal sentence shown; **server copy untouched** (node kept, typed words NOT stored) | same: declares 0, 409 twice, mark kept, words not stored | declares 0; 200; words saved |

This is the guard doing its job at the depth it was built for:
- a rolled-back bundle declares exactly what it can read;
- the server refuses it on a note it cannot read;
- no note was blanked at any step.

The wave-5 editor has no content guard, so it opens the note it cannot read as empty. Its save is
refused and the server keeps the note, as *What a member sees* below describes.

**The procedure's check list, run inside each step's tree** (`verify_list.py`; the totals line of
every run is in `sandbox-results.md` §C):
- `tests/test_notebook_schema_guard.py` passed 17 in every tree.
- The vitest list (`--maxWorkers=2`) was green in every tree:
  - 272 tests: tip down to `L1b`;
  - 244: `L1a` down to `201`;
  - 221: `wave8` down to `wave6`;
  - 175 through `wave5`, where the three files of `82c56dd63` do not exist.
- This holds in round 2. Round 1 had two reds at `wave6` and `wave5`, explained in *The keep-list*, 1.
- The wave6 and wave5 trees in the table above are round 2's (`bfb45998cd` and `832bd5b759`).
  Both booted CLEAN and answered exactly as round 1 did (`sandbox/r2-*`).

**Also measured, and not a finding about the product:**
- The strict chain (every landing, hotfixes included, `chain-strict.jsonl`) is merge-clean with the
  same rules. It was built from objects and not booted.
- Keeping #225 and #201 as well stops the chain at wave 8, on `NotebookTab.module.css`
  (`chain-keepallhotfix.jsonl`).
- The controller's landing list left out #225 and #201. Both were found by ancestry
  (`chain/sha-verification.txt`) and are now in `CHAIN`, which a rail derives from git.

## ⚰️ History: the procedures this replaced, and their measurements

Kept for the record, not to be followed. Procedure A reverted wave 5 alone and re-applied three
commits. At 2026-09-26 it stopped on 68 unmerged paths (below), and its third cherry-pick
(`82c56dd63`) does not apply to a rolled-back tree (*The keep-list*, 3). Procedure B was never
simulated. The 2026-09-24 simulation and the 2026-09-26 wave-9 measurement are the ground the
2026-09-28 rehearsal built on. The three guard tags are on `origin` (`git ls-remote --tags origin
'notebook-wave5-guard-*'`, checked 2026-09-28).

### ⚰️ Procedure A (SUPERSEDED 2026-09-28): revert the merge, re-apply the guard (measured for `8167f7aa0` + `fd87271fd`; `82c56dd63` reasoned)

```sh
git revert -m 1 <wave-5 merge commit>
git cherry-pick 8167f7aa0          # expect ONE conflict: app/src/pages/journal-2-0/lib/tiptap.js
# resolve it as below, then:
git add app/src/pages/journal-2-0/lib/tiptap.js && git cherry-pick --continue
git cherry-pick fd87271fd          # applies cleanly (measured)
git cherry-pick 82c56dd63          # NOT YET MEASURED against a rolled-back tree —
                                    # see the warning at the top of this document.
                                    # It touches NoteEditorPage.jsx and several
                                    # offline/*.js files wave-5 also touches, so
                                    # expect at least one conflict and resolve by
                                    # keeping the rolled-back side's CONTENT while
                                    # preserving 82c56dd63's writtenSchema plumbing
                                    # (the stamp fields and the min()-forwarding
                                    # calls), the same principle as the tiptap.js
                                    # resolution above.
```

**Resolving the `tiptap.js` conflict.** Keep the rolled-back side of the hunk.
Wave 5's `plainLeafText`, `PLAIN_TEXT_BLOCK_SEPARATOR` and the textBetween-based
`extractPlainText` belong to the features. Then add back the one export the guard
needs:

```js
import { getSchema } from '@tiptap/core'            // with the other imports

let editorSchemaCache = null
/**
 * The app's REAL editor schema, built once from `buildExtensions()`. It is
 * what notebookSchema.js::declaredNotebookSchema reads to declare which note
 * types this bundle can read (X-UCT-Notebook-Schema).
 */
export function editorSchema() {
  if (!editorSchemaCache) editorSchemaCache = getSchema(buildExtensions())
  return editorSchemaCache
}
```

**Verify before pushing.** Run each command in its own call, never through a
pipe:

```sh
python -m pytest tests/test_notebook_schema_guard.py -q
cd app && npx vitest run src/pages/journal-2-0/lib/notebookSchema.rail.test.js \
  src/hub/writePathsTransitive.test.js src/hub/writePaths.test.js src/pages/journal-2-0/lib/importer \
  src/pages/journal-2-0/lib/offline/writtenSchemaDrain.test.js \
  src/pages/journal-2-0/lib/offline/writtenSchemaCapture.test.js \
  src/pages/journal-2-0/components/notebook/NoteEditorPage.writtenSchema.test.jsx
```

⚠️ The last three files are `82c56dd63`'s own rails (the writtenSchema stamp,
capture, drain-forwarding and refusal-fork behaviour) and are NOT YET verified
against a rolled-back tree — see the warning at the top of this document.

⚠️ Step 1 also reverts this file. Read it beforehand, or read it from the feature
branch (`git show <merge>^2:docs/notebook/wave5-rollback.md`).

### Before a squash merge: tag the three commits

If `feat/notebook-10` lands as a squash commit (or the branch is otherwise
deleted after merging), `8167f7aa0`, `fd87271fd` and `82c56dd63` stop being
reachable from any ref and become eligible for garbage collection. Tag all
three before that happens:

```sh
git tag notebook-wave5-guard-8167f7aa0 8167f7aa0
git tag notebook-wave5-guard-fd87271fd fd87271fd
git tag notebook-wave5-guard-82c56dd63 82c56dd63
git push origin notebook-wave5-guard-8167f7aa0 notebook-wave5-guard-fd87271fd notebook-wave5-guard-82c56dd63
```

### ⚰️ Procedure B (SUPERSEDED 2026-09-28): revert everything except the guard (not simulated)

Revert the feature commits newest first, and skip **all three** guard commits:
`8167f7aa0`, `fd87271fd` and `82c56dd63`. Any conflicts will be between feature
commits, and this path was **not** simulated. Procedure A is the measured path.
If wave 5 landed as a squash commit, revert that squash commit, then run the
same **three** cherry-picks as Procedure A, in that order. That variant was not
simulated either.

⛔ This is the procedure where `82c56dd63` is most likely to be load-bearing:
if the revert leaves any level-1 type registered (see *Coarse levels* below),
the bundle still declares 1, and without `82c56dd63` the B1 overwrite is back.
Do not drop it to make a conflict go away. ⚰️ This section said "skip
`8167f7aa0` and `fd87271fd`" and "the same two cherry-picks" until the fix
round's re-review caught it — an operator following it would have reverted
`82c56dd63` against the three-commit rule in this file's own banner.

### Measured: the rollback simulation, 2026-09-24

I ran the simulation in a throwaway worktree, since removed:

1. Detached the worktree at origin/master `acd230c15`.
2. Merged `feat/notebook-10` at `18855753c` with `--no-ff`.
3. Ran `git revert -m 1` on that merge.
4. Cherry-picked `8167f7aa0`.

| Step | Result |
|---|---|
| Cherry-pick `8167f7aa0` | One conflict, `tiptap.js`, resolved as above |
| `tests/test_notebook_schema_guard.py` | 13 passed |
| `notebookSchema.rail.test.js` as `8167f7aa0` left it | **RED.** Its non-vacuity control asserted `inlineMath`. That control is fixed by `fd87271fd` |
| Cherry-pick `fd87271fd` | Clean |
| Rail, enumeration, hub write-path rails, importer suites | 16 files, 175 tests passed |
| Probe: types registered by the rolled-back editor | `[]`, none of the six |
| Probe: header the rolled-back bundle sends | `X-UCT-Notebook-Schema: 0` |

### Measured at production's tip, 2026-09-26 (wave 10, lane 10C, ruling R-11)

Rehearsed on a SANDBOX, never a production revert (R-11). An isolated local
clone at production's tip, `origin/master` `6e7785b52` (own index, refs and
stash). Raw runs committed before this reading: `6252d03bc`,
`docs/notebook/evidence/wave10-10c/rollback/`.

| Step | Result |
|---|---|
| Procedure A step 1, literally: `git revert -m 1 2c3ed3093` | git 2.53 **accepts** `-m 1` on the one-parent squash and reverts it as a plain commit. It stops on **68 unmerged paths** (36 content, 32 modify/delete) — `notebookSchema.js`, `notebook_schema.py`, `notebookSchema.rail.test.js`, `noteContentGuard.js` among them. Aborted cleanly. `procedure-a-literal-*.{log,txt}` |
| The newest wave instead: `git revert --no-edit 1c4b0bf74` (wave 9's squash) | **0 conflicts.** The two schema-table files are byte-identical before and after (`git diff` empty). Tree `93d7d0288`. `revert-wave9-squash.log` |
| `tests/test_notebook_schema_guard.py` on that tree | 17 passed |
| This file's *Verify before pushing* vitest list on that tree | 20 files, 243 passed |
| A sandbox booted from a `git archive` of `93d7d0288`, its own `app/dist`, on the tip's data dir (`C:\data-w10c`) | SANDBOX INTEGRITY CLEAN at pre-boot, +15 s, +120 s and shutdown |
| The reverted wave is gone: `POST /api/j2/notes/batch/export?format=__bogus__` | tip **422** (wave 9 checks the format) → rolled back **200** (the Markdown zip it always sent) |
| The never-revert set is not: a note holding a level-2 node (`tableOfContents`, wave 6) | opens with no unreadable notice on both; the editor's body PUT declares `X-UCT-Notebook-Schema: 2` on both; the stored body keeps the node and the typed words on both |

**What this changes for whoever rolls back next:**

1. ⛔ **Reverting wave 5 alone is no longer a procedure.** Waves 6–9 extend the
   guard's own files, so the wave-5 revert would DELETE `notebookSchema.js` and
   `notebook_schema.py` out from under them — the one outcome this document
   forbids ("never remove a table entry"). To remove wave 5's features today,
   revert the waves **newest first** (9, 8, 7, 6, then 5), and at each step keep
   both schema-table files exactly as the tip has them. ⚠️ **Only the first step
   of that sequence, wave 9, was rehearsed.** Reverting 8, 7, 6 and then 5 is the
   prescribed order but **UNREHEARSED** — its conflicts, and the table restore
   that wave 6's revert needs, have never been run.
2. ⭐ **The check after every revert is one command**, and it is the rule that
   outlives every wave: `git diff <tip> HEAD -- app/src/pages/journal-2-0/lib/notebookSchema.js api/services/journal_two/notebook_schema.py`
   must print **nothing**. A revert whose squash added table entries (wave 6
   added the eight level-2 types) removes them — restore both files from the
   tip before committing the revert. A bundle that still registers a type keeps
   declaring its level; a table without the entry declares 0 for a type members
   have already written (*Rules that outlive this wave*).
3. `git revert -m 1` on a squash does not fail on this git; do not read "the
   flag was accepted" as "this was a merge revert". Every Notebook wave on
   master is a one-parent squash (`git show --no-patch --format=%P <sha>`).
4. The rehearsal did not re-run `82c56dd63`'s cherry-pick: in a newest-first
   rollback that stops above wave 5, all three never-revert commits stay in the
   tree because wave 5's squash is never reverted.

## What a member sees after a rollback

A note or Model Book entry that contains a level-1 type opens **empty** in the
rolled-back editor, because the pre-wave-5 editor has no content check. Its save
is refused, and **the server copy is untouched.** What happens next depends on
the door. These paths were read from the origin/master code, not measured on the
wire:

- **Note editor.** One reconcile and one retry, then it shows the refusal
  sentence as the save error. No loop and no overwrite.
- **Offline outbox.** It rebases once, then forks a *conflicted copy* holding
  what that tab had, which may be empty. The original note is untouched. The
  copy is litter, not loss.
- **Model Book entry editor.** It treats a 4xx as non-retryable and stops. This
  is the path that save-on-open reaches.

⚠️ The sentence says *"Reload to edit it."* After a rollback, reloading loads the
same rolled-back bundle. The note stays safe but cannot be edited until the
features return.

**Open tabs.** There is no service worker. A tab opened before the rollback
deploy keeps the bundle it loaded, the TIP's, until it reloads. That bundle reads every type,
declares **2**, and saves normally, which is correct. It carries `82c56dd63`, so a body it
forwards from a rolled-back tab's capture (unstamped, so 0) goes out at `min(0, 2) = 0`.
Nothing needs to be flushed.

**Coarse levels.** Rolling back only one of the two level-1 feature sets, such as
G-064 alone, still drops the declaration to 0 for every level-1 note, including
notes the bundle could read. That errs safe. It is also why the next wave that
adds a type should use **level 2**.


**Measured 2026-09-28** (*Measured*, the never-revert table):
- through `wave6`: a level-2 note opened LOCKED, with the sentence, and sent no PUT;
- through `wave5`: the level-1 and level-2 notes each sent two body PUTs declaring 0, both were
  refused 409, the sentence was shown, and the server copy kept its content and not the typed
  words;
- in every case a level-0 note saved normally.

## Rules that outlive this wave

- ⛔ **Never remove a table entry**, in a rollback or ever. A type missing from
  the map counts as level 0, meaning "every client can read this". That is
  exactly how a note blanks.
- ⛔ **Never hand-set the header.** It is derived from the live editor schema. A
  constant is how a rolled-back bundle would claim to read what it cannot.
- **A new node or mark type** gets the next level, currently 2, in **both**
  files. The Python rail parses the JS table. The vitest rail fails on any
  registered name the table lacks.
- **A new client door that PUTs a note or entry body** must send
  `notebookSchemaHeaders()`. The enumerating rail in
  `notebookSchema.rail.test.js` finds every `fetch` or `upbFetch` PUT to
  `/api/j2/notes/${id}` or `/api/upb/entries/${id}`. It fails on any body PUT
  that does not declare.
- **A new door that CAPTURES a body for a later page load to send** (a durable
  record, an outbox entry, a crash draft, anything a different bundle might
  adopt and forward) must stamp `writtenSchema` at capture time from that
  bundle's OWN derived level, and any door that FORWARDS a body it did not just
  freshly read from the server must send `min(writtenSchemaOf(stamp), its own
  derived level)`, never its own level unconditionally. This is `82c56dd63`'s
  fix (see *"Why `82c56dd63` rides along"* above) — skipping it on a new
  capture/forward door reopens the exact hole that commit closed.
- ⚠️ **The table expresses new NODE and MARK TYPES — not a new, non-optional
  ATTRIBUTE on an existing type.** An older bundle drops an attribute it does
  not know (TipTap discards unknown attrs at parse time; it is a missing TYPE
  that blanks the document), so an attribute addition needs no level bump and
  the table cannot express one. That is fine while every new attribute is
  optional or has a fallback: `widgetEmbed.embedId` degrades through its own
  fallback key today (see the comment beside the attr in
  `lib/widgetEmbedNode.jsx`). A future attribute that a NEW bundle requires and
  an OLD bundle would silently drop — one whose absence changes what the note
  MEANS — needs its own mechanism (a versioned attr with a reader that treats
  absence as the old meaning, or a new node type), and this document does not
  provide one. Decide that when the first such attribute is proposed, not after.
  ⭐ **Decided 2026-10-02 (wave 13, lane 13H-1): an attribute row in
  `NOTEBOOK_ATTR_SCHEMA`**, the second table in the same two files, sharing the
  type table's numbering and its rules. A new non-optional attribute gets the
  next level there, in both files. See *Level 4* at the end of this document.

## The doors, and why each one is or is not guarded

**Guarded on the server:**

- `PUT /api/j2/notes/{id}`: `update_note`, body writes only.
- `PUT /api/upb/entries/{id}`: `update_entry`, body writes only.

**Clients that declare:**

- `useJ2Note.update`, when the patch carries a body.
- The outbox drain's `sendNoteUpdate`.
- `saveEntryBody`, the Model Book entry editor.
- The importer's media rewrite.
- `revertChartEmbed`.

**Server writers that are not guarded, because none of them serialises an editor
that failed to read the note:**

| Writer | Why it is safe |
|---|---|
| `POST /api/j2/notes` (create) | There is no stored body to lose |
| Version restore (`restore_note_version` → `update_note` with no declaration) | The body is the server's own stored version; the client sends only an id |
| `import_confirm` re-import UPDATE (`notes.py`, in `import_confirm`) | It replaces the note from a file the member chose to re-import; **the client parses it** (`generateJSON`) and sends `bodyJson`, but it loads no editor and blanks nothing — the member picked this exact file, and a parse failure fails the import, it does not silently save an empty note |
| `append_widget_embed`, `append_financial_fact`, `append_document_excerpt` | They load the stored JSON, append one node and save; unknown types pass through untouched |
| Connector sync `_apply_resolved_body` (`note_connectors/engine.py`) | It rewrites placeholders in a body the same sync just wrote, locked on `updated_at` |
| Notebook migration v1 insert (`db.py`) | It is a one-time creation |

## Level 3 -- wave 11 lane 11D, the trade-plan canvas (2026-10-01)

⛔ **NEVER-REVERT, like levels 1 and 2.** Lane 11D adds ONE type, `tradeCanvas`, at level 3 in
both tables (`lib/notebookSchema.js` and `notebook_schema.py`). A canvas note's body is that one
block atom (plus TipTap's trailing empty paragraph) holding the whole board in its `board`
attribute.

- **Why a new type, not a property or an existing node.** Every other place the board could
  live loses it to an older editor without the server noticing: an existing node's unknown
  attribute is DROPPED by an editor that does not declare it (and its next save writes the plan
  away), and a note property rides neither the offline outbox nor the body's compare-and-set.
  A new type is the only shape the schema guard can protect: a bundle without it declares 2 and
  is refused (409) on any note whose stored body holds the canvas.
- **What a rollback of 11D must keep:** both table entries. The node itself
  (`lib/tradeCanvasNode.js`, registered in `tiptap.js`) may be reverted with the feature; the
  derived declaration then drops to 2 and every canvas note becomes read-only (refused), never
  blanked. Restoring the feature restores editing.
- **The gate is not the schema.** `NOTEBOOK_TRADE_CANVAS_ENABLED` gates the doors that make a
  canvas and the board's editing controls; the node is registered unconditionally so a gate-off
  tab still declares 3.

## Level 4 -- wave 13 lane 13H-1, the `ta` attribute on `widgetEmbed` (2026-10-02)

⛔ **NEVER-REVERT, like levels 1 to 3. On the keep-list** (item 1: both schema tables and their
two rails, byte-identical to the tip). Controller ruling P1 (`WAVE-13-PLAN.md` section 8) accepted
it as the wave's one schema change.

This is the first **attribute** with a level, and the mechanism *Rules that outlive this wave*
asked for "when the first such attribute is proposed":

- **Why an attribute needs one.** `widgetEmbed.ta` holds a chart's plan data -- the member's
  setup tag, the technical fingerprint frozen at insert, and the plan block (planned shares and
  which engine sized them). An editor that does not declare `ta` does NOT blank the note (the
  type is known); TipTap drops the unknown attribute at parse time and the next save writes the
  note without it. Silent data loss, and no type-table row can see it.
- **The mechanism: a second table in the same two files.** `NOTEBOOK_ATTR_SCHEMA`
  (`{"widgetEmbed.ta": 4}`) sits beside `NOTEBOOK_TYPE_SCHEMA` in `lib/notebookSchema.js` and
  `notebook_schema.py`, shares its numbering (a client declares "every type AND every attribute at
  or below N"), and follows its rules: one fact in two files pinned by
  `tests/test_notebook_schema_guard.py` (Node-imported), never remove a row, never revert.
  - The server (`required_schema`) counts a row only when the stored node **carries a value**:
    `null`, `{}`, `[]` and `""` are nothing an older editor could lose. Every chart a 13H bundle
    saves carries `ta: null` until the member gives it plan data, and those notes stay writable
    by a level-3 tab.
  - The client (`deriveDeclaredSchema`) declares below 4 when the live `widgetEmbed` node does
    not register `ta` -- production before 13H, or a rollback of the attribute.
- **Rolling the whole wave 12-15 landing back** has its own page, with the commands and what
  was rehearsed: `docs/notebook/landing-12-15-rollback.md`.
- **What a rollback of 13H must keep:** both table rows (they are in the keep-list files). The
  attribute line in `lib/widgetEmbedNode.jsx` may be reverted with the feature; the derived
  declaration then drops to 3 and every note carrying a `ta` value becomes read-only (409 with
  the refusal sentence), never stripped. Restoring the attribute restores editing.
- **Plan roles are NOT in `ta`.** An entry/stop/target role rides the drawing itself inside the
  existing `annotations` attribute (a level-0 JSON attribute every bundle round-trips), which
  `plan_extract.py` reads. A rollback keeps them; only an older bundle's drawing editor could
  rewrite a drawing without its `role` field, and that is a drawing edit, not a load.
- **Public copies:** `public_note_payload.ATTR_POLICY` drops `ta` in share, publish and gallery
  (it is private trading intent, like `tradeRef`), enforced by the embed allowlist.
- **The gate is not the schema.** `NOTEBOOK_CHART_PLAN_ENABLED` gates 13H's doors (the plan
  panel, alerts from drawn levels, sizing); the attribute is registered unconditionally so a
  gate-off tab still declares 4.

