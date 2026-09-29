# Rolling the Notebook back: newest landing first, the schema guard kept

> ⭐ **EXECUTABLE AT `38bb9a421` (production's tip, 2026-09-28), AND REHEARSED STEP BY STEP ON A
> SANDBOX** (lane R1, scorecard clause 3b). Every Notebook landing from wave 10 down to wave 5 was
> reverted newest first, and each step booted from a `git archive` of its own tree on the tip's
> data. All 19 boots were CLEAN. The procedure's check list ran green inside every step's tree.
> Evidence: `docs/notebook/evidence/rollback-rehearsal-2026-09-28/` (raw chain `chain/`, raw boots `sandbox/`, mechanical tables `chain/step-table.md` and
> `sandbox-results.md`). The table is in *Measured, 2026-09-28* below.
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
> 2. **The guard commits `8167f7aa0` and `fd87271fd`** (tags `notebook-wave5-guard-*`) are
>    re-applied after wave 5's revert. **`82c56dd63` is NOT re-applied**: it does not apply to the
>    fully rolled-back tree, and there it is not needed (see the keep-list). Above wave 5 all three
>    stay in the tree, because wave 5's squash is never reverted.
> 3. **The server H14 hotfixes #204 (`2ab637644`) and #203 (`c6a8a9d3a`)** stay. They were measured
>    merge-clean at every step below them.
> 4. **Records and the operator's tools stay as the tip has them: `docs/`, `tools/`, `scripts/`, and
>    `CLAUDE.md`.** A rollback reverts what ships to members. It does not revert the records, this
>    runbook, or the instruments that check the rollback.

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

`--through wave8` reverts every row from `L1c` down to `wave8`, skipping the two kept rows.
⚠️ #225 and #201 fix CSS that wave 8 added. They cannot be kept below wave 8: measured, keeping
them stops the wave-8 revert on `NotebookTab.module.css`.

**1. Build the rollback chain.** This uses objects only. It touches no worktree, no index, and no
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
    `REVIEWED_NOT_LANDINGS` names. Either of two things is enough: its subject names the
    Notebook, OR it touches a file in the Notebook file set. That set is DERIVED from git: the
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
files is enough for the refusal. The rail `test_no_notebook_landing_after_MEASURED_AT_is_left_out`
goes red on it by name too.

⚠️ **The file criterion is broad on purpose, and that is its cost.** The Notebook file set is 815
files at `MEASURED_AT`. It includes shared files every workstream edits, such as `app/src/App.jsx`
and `api/main.py`. Measured: between wave 5 and `MEASURED_AT`, 23 commits that were not Notebook
landings touched a file in the set. So another workstream's commit on master will stop the tool.
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
